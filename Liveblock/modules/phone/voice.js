// modules/phone/voice.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Phone/voice] ctx ausente'); return; }
    if (ctx.voice?._loaded) return;

    // ═══ CONFIG ═══
    const CONSTRAINTS = {
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 48000
        }
    };
    const LEVEL_HZ = 20;                 // emite nível 20x por segundo
    const HP_FREQ = 80,   HP_Q = 0.7;    // corta rumble
    const NOTCH_50 = 50,  NOTCH_60 = 60; // zumbido de rede elétrica
    const NOTCH_Q = 30;
    const PEAK_CUT_FREQ = 250, PEAK_CUT_GAIN = -4, PEAK_CUT_Q = 1.2;
    const PEAK_BOOST_FREQ = 3000, PEAK_BOOST_GAIN = 3, PEAK_BOOST_Q = 1.5;
    const COMP_THRESHOLD = -24, COMP_KNEE = 30, COMP_RATIO = 4,
          COMP_ATTACK = 0.003, COMP_RELEASE = 0.25;
    const LIMIT_THRESHOLD = -1;

    const V = { _loaded: true };

    // ═══ STATE ═══
    let _raw = null;             // MediaStream cru do getUserMedia
    let _source = null;          // MediaStreamAudioSourceNode
    let _chain = null;           // { hp, n50, n60, cut, boost, comp, limiter, split }
    let _analyser = null;        // AnalyserNode compartilhado
    let _levelBuf = null;
    let _waveBuf = null;
    const _pool = new Map();     // handleId -> { id, dest, stream, purpose }
    let _nextId = 1;
    let _levelRaf = null;
    let _lastLevelAt = 0;
    let _warmUpBound = false;
    const _levelListeners = new Set();
    let _gestureResolved = false;

    // ═══ DSP CHAIN ═══
    function buildChain() {
        const ac = ctx.getAudioCtx();
        if (!ac) return null;

        const hp = ac.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = HP_FREQ;
        hp.Q.value = HP_Q;

        const n50 = ac.createBiquadFilter();
        n50.type = 'notch';
        n50.frequency.value = NOTCH_50;
        n50.Q.value = NOTCH_Q;

        const n60 = ac.createBiquadFilter();
        n60.type = 'notch';
        n60.frequency.value = NOTCH_60;
        n60.Q.value = NOTCH_Q;

        const cut = ac.createBiquadFilter();
        cut.type = 'peaking';
        cut.frequency.value = PEAK_CUT_FREQ;
        cut.gain.value = PEAK_CUT_GAIN;
        cut.Q.value = PEAK_CUT_Q;

        const boost = ac.createBiquadFilter();
        boost.type = 'peaking';
        boost.frequency.value = PEAK_BOOST_FREQ;
        boost.gain.value = PEAK_BOOST_GAIN;
        boost.Q.value = PEAK_BOOST_Q;

        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = COMP_THRESHOLD;
        comp.knee.value = COMP_KNEE;
        comp.ratio.value = COMP_RATIO;
        comp.attack.value = COMP_ATTACK;
        comp.release.value = COMP_RELEASE;

        const limiter = ac.createDynamicsCompressor();
        limiter.threshold.value = LIMIT_THRESHOLD;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.1;

        const split = ac.createGain();
        split.gain.value = 1;

        // cadeia serial
        hp.connect(n50);
        n50.connect(n60);
        n60.connect(cut);
        cut.connect(boost);
        boost.connect(comp);
        comp.connect(limiter);
        limiter.connect(split);

        return { hp, n50, n60, cut, boost, comp, limiter, split };
    }

    function ensureAnalyser() {
        if (_analyser) return _analyser;
        const ac = ctx.getAudioCtx();
        if (!ac) return null;
        const an = ac.createAnalyser();
        an.fftSize = 1024;
        an.smoothingTimeConstant = 0.6;
        _analyser = an;
        _levelBuf = new Uint8Array(an.fftSize);
        _waveBuf = new Uint8Array(an.fftSize);
        if (_chain) _chain.split.connect(an);
        return an;
    }

    // ═══ POOL — abrir / fechar ═══
    async function openPool() {
        if (_raw && _raw.active) return true;

        // stream cru
        try {
            _raw = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
        } catch(e) {
            console.warn('[Phone/voice] getUserMedia falhou:', e.message);
            throw e;
        }

        const ac = ctx.getAudioCtx();
        if (!ac) {
            try { _raw.getTracks().forEach(t => t.stop()); } catch(_) {}
            _raw = null;
            throw new Error('AudioContext indisponível');
        }
        if (ac.state === 'suspended') {
            try { await ac.resume(); } catch(_) {}
        }

        _source = ac.createMediaStreamSource(_raw);
        _chain = buildChain();
        if (!_chain) {
            try { _raw.getTracks().forEach(t => t.stop()); } catch(_) {}
            _raw = null;
            _source = null;
            throw new Error('falha ao montar cadeia DSP');
        }

        _source.connect(_chain.hp);
        ensureAnalyser();

        return true;
    }

    function closePool() {
        if (_levelRaf) { cancelAnimationFrame(_levelRaf); _levelRaf = null; }
        // parar tracks
        try { _raw?.getTracks().forEach(t => t.stop()); } catch(_) {}
        _raw = null;

        // desconectar nós
        try { _source?.disconnect(); } catch(_) {}
        _source = null;

        // limpar cadeia
        if (_chain) {
            for (const k of ['hp','n50','n60','cut','boost','comp','limiter','split']) {
                try { _chain[k].disconnect(); } catch(_) {}
            }
            _chain = null;
        }
        try { _analyser?.disconnect(); } catch(_) {}
        _analyser = null;
        _levelBuf = null;
        _waveBuf = null;
    }

    // ═══ ACQUIRE / RELEASE ═══
    V.acquire = async function(opts) {
        opts = opts || {};
        const purpose = opts.purpose || 'misc';

        if (_pool.size === 0) await openPool();

        const ac = ctx.getAudioCtx();
        if (!ac || !_chain) throw new Error('voice não inicializado');

        const dest = ac.createMediaStreamDestination();
        _chain.split.connect(dest);

        const id = _nextId++;
        const handle = {
            id,
            purpose,
            stream: dest.stream,
            release: () => V.release(handle)
        };
        _pool.set(id, { id, dest, stream: dest.stream, purpose });

        return handle;
    };

    V.release = function(handle) {
        if (!handle || !_pool.has(handle.id)) return;
        const entry = _pool.get(handle.id);
        _pool.delete(handle.id);
        try { entry.dest.disconnect(); } catch(_) {}
        try { entry.stream.getTracks().forEach(t => t.stop()); } catch(_) {}
        if (_pool.size === 0) closePool();
    };

    V.isBusy = () => _pool.size > 0;
    V.consumers = () => [..._pool.values()].map(e => ({ id: e.id, purpose: e.purpose }));

    // ═══ LEVEL / WAVEFORM ═══
    function startLevelLoop() {
        if (_levelRaf) return;
        const ac = ctx.getAudioCtx();
        if (!ac) return;
        function frame() {
            if (!_analyser) { _levelRaf = null; return; }
            const now = performance.now();
            if (now - _lastLevelAt >= 1000 / LEVEL_HZ) {
                _lastLevelAt = now;
                _analyser.getByteTimeDomainData(_levelBuf);
                let sum = 0;
                for (let i = 0; i < _levelBuf.length; i++) {
                    const v = (_levelBuf[i] - 128) / 128;
                    sum += v * v;
                }
                const rms = Math.sqrt(sum / _levelBuf.length);
                const level = Math.min(1, rms * 3.2);
                for (const cb of _levelListeners) {
                    try { cb(level); } catch(_) {}
                }
            }
            _levelRaf = requestAnimationFrame(frame);
        }
        _levelRaf = requestAnimationFrame(frame);
    }

    V.getLevel = function() {
        if (!_analyser || !_levelBuf) return 0;
        _analyser.getByteTimeDomainData(_levelBuf);
        let sum = 0;
        for (let i = 0; i < _levelBuf.length; i++) {
            const v = (_levelBuf[i] - 128) / 128;
            sum += v * v;
        }
        return Math.min(1, Math.sqrt(sum / _levelBuf.length) * 3.2);
    };

    V.getWaveform = function() {
        if (!_analyser || !_waveBuf) return null;
        _analyser.getByteTimeDomainData(_waveBuf);
        return _waveBuf;
    };

    V.on = function(evt, cb) {
        if (evt === 'level' && typeof cb === 'function') {
            _levelListeners.add(cb);
            if (_analyser) startLevelLoop();
        }
    };
    V.off = function(evt, cb) {
        if (evt === 'level' && typeof cb === 'function') {
            _levelListeners.delete(cb);
        }
    };

    // auto-inicia o loop quando o pool abre
    const _origAcquire = V.acquire;
    V.acquire = async function(opts) {
        const h = await _origAcquire(opts);
        if (_analyser && _levelListeners.size) startLevelLoop();
        return h;
    };

    // ═══ GESTURE WARM-UP ═══
    V.warmUp = function() {
        try {
            const ac = ctx.getAudioCtx();
            if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
            _gestureResolved = true;
        } catch(_) {}
    };

    function bindGesture() {
        if (_warmUpBound) return;
        _warmUpBound = true;
        const opts = { once: true, capture: true, passive: true };
        document.addEventListener('pointerdown', () => V.warmUp(), opts);
        document.addEventListener('touchstart', () => V.warmUp(), opts);
        document.addEventListener('keydown', () => V.warmUp(), opts);
    }
    bindGesture();

    // ═══ DESTROY ═══
    V.destroy = function() {
        // solta todos os consumidores
        for (const id of [..._pool.keys()]) {
            const entry = _pool.get(id);
            _pool.delete(id);
            try { entry.dest.disconnect(); } catch(_) {}
            try { entry.stream.getTracks().forEach(t => t.stop()); } catch(_) {}
        }
        _levelListeners.clear();
        closePool();
    };

    // ═══ EXPORT ═══
    ctx.voice = V;

    // Se o phone shell tem kill(), enrola o destroy junto
    try {
        if (typeof ctx._registerCleanup === 'function') {
            ctx._registerCleanup(V.destroy);
        }
    } catch(_) {}

    console.log('[Phone/voice] pronto · DSP ativo · gesture warm-up armado');
})();
