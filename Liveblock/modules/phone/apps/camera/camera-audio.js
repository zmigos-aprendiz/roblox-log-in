// modules/phone/apps/camera-audio.js
// Subsistema de áudio da câmera: feedback sonoro, microfone, captura de
// áudio da aba e mixagem para gravação. Exposto em window._camAudio.
(function() {
    'use strict';
    if (window._camAudio) return;

    const LS_SETTINGS = 'sanghub_phone_app_camera_settings';
    const DEFAULT_SETTINGS = Object.freeze({
        pageAudio: false,
        voice: false
    });

    // ═══ STATE ═══
    let _micStream = null;
    let _pageAudioTrack = null;
    let _pageAudioStream = null;
    let _hubSfxDucked = false;
    let _hubSfxWasMuted = false;
    let _recordingFlag = false;

    // ═══ SETTINGS — via env injetado pelo camera.js ═══
    function _getSettings() {
        try {
            const env = window._camAudioEnv;
            if (env && typeof env.getSettings === 'function') return env.getSettings();
        } catch(_) {}
        try {
            const raw = localStorage.getItem(LS_SETTINGS);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed ? { ...DEFAULT_SETTINGS, ...parsed } : { ...DEFAULT_SETTINGS };
        } catch(_) { return { ...DEFAULT_SETTINGS }; }
    }

    // ═══ RECORDING FLAG ═══
    function setRecording(on) { _recordingFlag = !!on; }
    function isRecording() { return _recordingFlag; }

    function _audioCaptureActive() {
        try {
            const s = _getSettings();
            return !!(_recordingFlag && (s.voice || s.pageAudio));
        } catch(_) { return false; }
    }

    // ═══ HUB SFX DUCK ═══
    function duckHubSfx() {
        if (_hubSfxDucked) return;
        try {
            _hubSfxWasMuted = !!window._hubSFX?.isMuted?.();
            if (!_hubSfxWasMuted) {
                window._hubSFX?.setMuted?.(true);
                _hubSfxDucked = true;
            }
        } catch(_) {}
    }
    function unduckHubSfx() {
        if (!_hubSfxDucked) return;
        try {
            if (!_hubSfxWasMuted) window._hubSFX?.setMuted?.(false);
        } catch(_) {}
        _hubSfxDucked = false;
        _hubSfxWasMuted = false;
    }

    // ═══ SOUND GATE ═══
    function _soundOn() {
        try {
            if (_audioCaptureActive()) return false;
            if (window._hubSFX?.isMuted?.()) return false;
            const phoneSettings = window._phone?.state?.settings;
            if (phoneSettings && phoneSettings.sound === false) return false;
        } catch(_) {}
        return true;
    }

    // ═══ LOW-LEVEL SYNTH ═══
    function _ac() {
        try {
            const ac = window._phoneCtx?.getAudioCtx?.();
            if (!ac) return null;
            if (ac.state === 'suspended') { try { ac.resume(); } catch(_) {} }
            return ac;
        } catch(_) { return null; }
    }

    function _noiseBurst(ac, when, dur, hpHz, gainVal) {
        const len = Math.max(1, Math.floor(ac.sampleRate * dur));
        const buf = ac.createBuffer(1, len, ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.pow(1 - i / len, 2.5);
            d[i] = (Math.random() * 2 - 1) * env;
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        const hp = ac.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = hpHz;
        const g = ac.createGain();
        g.gain.value = gainVal;
        src.connect(hp).connect(g).connect(ac.destination);
        src.start(when);
    }

    function _tone(ac, when, freq, dur, gainVal, type) {
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, when);
        const gv = (gainVal == null) ? 0.12 : gainVal;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(gv, when + 0.008);
        g.gain.setValueAtTime(gv, when + Math.max(0.01, dur - 0.015));
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        osc.connect(g).connect(ac.destination);
        osc.start(when);
        osc.stop(when + dur + 0.02);
    }

    // ═══ FEEDBACK SOUNDS ═══
    function playShutter() {
        if (!_soundOn()) return;
        const ac = _ac(); if (!ac) return;
        const t = ac.currentTime;
        _noiseBurst(ac, t, 0.035, 1800, 0.45);
        _noiseBurst(ac, t + 0.045, 0.028, 2800, 0.28);
    }
    function playRecStart() {
        if (!_soundOn()) return;
        const ac = _ac(); if (!ac) return;
        const t = ac.currentTime;
        _tone(ac, t, 780, 0.09, 0.14, 'sine');
        _tone(ac, t + 0.09, 1100, 0.11, 0.14, 'sine');
    }
    function playRecStop() {
        if (!_soundOn()) return;
        const ac = _ac(); if (!ac) return;
        const t = ac.currentTime;
        _tone(ac, t, 900, 0.09, 0.13, 'sine');
        _tone(ac, t + 0.09, 620, 0.13, 0.13, 'sine');
    }
    function playError() {
        if (!_soundOn()) return;
        const ac = _ac(); if (!ac) return;
        const t = ac.currentTime;
        _tone(ac, t, 240, 0.14, 0.14, 'triangle');
        _tone(ac, t + 0.14, 200, 0.16, 0.14, 'triangle');
    }
    function playToggle(on) {
        if (!_soundOn()) return;
        const ac = _ac(); if (!ac) return;
        const t = ac.currentTime;
        _tone(ac, t, on ? 660 : 440, 0.07, 0.10, 'sine');
    }
    function playCountdownBeep(isLast) {
        if (!_soundOn()) return;
        const ac = _ac(); if (!ac) return;
        const t = ac.currentTime;
        if (isLast) _tone(ac, t, 1320, 0.14, 0.16, 'sine');
        else        _tone(ac, t, 880,  0.07, 0.12, 'sine');
    }
    function playZoomTick(zoomIn) {
        if (!_soundOn()) return;
        const ac = _ac(); if (!ac) return;
        const t = ac.currentTime;
        _tone(ac, t, zoomIn ? 1400 : 900, 0.02, 0.05, 'sine');
    }

    // ═══ MIC / PAGE AUDIO ═══
    function findPageAudioStreams() {
        const streams = [];
        const seen = new WeakSet();
        function scan(doc, depth) {
            if (!doc || depth > 3) return;
            try {
                doc.querySelectorAll('audio, video').forEach(el => {
                    if (seen.has(el)) return;
                    seen.add(el);
                    try {
                        if (typeof el.captureStream !== 'function') return;
                        const s = el.captureStream();
                        if (s && s.getAudioTracks().length) streams.push(s);
                    } catch(_) {}
                });
                doc.querySelectorAll('iframe').forEach(f => {
                    try {
                        const inner = f.contentDocument || (f.contentWindow && f.contentWindow.document);
                        if (inner) scan(inner, depth + 1);
                    } catch(_) {}
                });
            } catch(_) {}
        }
        scan(document, 0);
        return streams;
    }

    async function acquireMic() {
        if (_micStream) {
            const alive = _micStream.getAudioTracks().some(t => t.readyState === 'live');
            if (alive) return _micStream;
            try { _micStream.getTracks().forEach(t => t.stop()); } catch(_) {}
            _micStream = null;
        }
        try {
            const s = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                }
            });
            _micStream = s;
            return s;
        } catch(e) {
            console.warn('[Camera-audio] mic negado:', e);
            try { window._phoneCtx?.toast?.('Microfone negado', 'warn'); } catch(_) {}
            return null;
        }
    }

    async function acquirePageAudio() {
        if (_pageAudioTrack && _pageAudioTrack.readyState === 'live') {
            return new MediaStream([_pageAudioTrack]);
        }
        _pageAudioTrack = null;

        const els = findPageAudioStreams();
        if (els.length) return els[0];

        try {
            const display = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true,
                preferCurrentTab: true,
                selfBrowserSurface: 'include'
            });
            const at = display.getAudioTracks()[0];
            display.getVideoTracks().forEach(t => t.stop());
            if (!at) {
                try { window._phoneCtx?.toast?.('Nenhum áudio capturado — escolha a aba do jogo', 'warn'); } catch(_) {}
                try { display.getTracks().forEach(t => t.stop()); } catch(_) {}
                return null;
            }
            _pageAudioTrack = at;
            _pageAudioStream = display;
            at.addEventListener('ended', () => {
                if (_pageAudioTrack === at) _pageAudioTrack = null;
            });
            return new MediaStream([at]);
        } catch(e) {
            console.warn('[Camera-audio] display capture negado:', e);
            return null;
        }
    }

    function releaseMic() {
        if (_micStream) {
            try { _micStream.getTracks().forEach(t => t.stop()); } catch(_) {}
            _micStream = null;
        }
    }
    function releasePageAudio() {
        if (_pageAudioStream) {
            try { _pageAudioStream.getTracks().forEach(t => t.stop()); } catch(_) {}
            _pageAudioStream = null;
        }
        _pageAudioTrack = null;
    }

    // ═══ MIX ═══
    async function buildMixedAudioTrack() {
        const settings = _getSettings();
        const sources = [];

        if (settings.voice) {
            const mic = await acquireMic();
            if (mic) sources.push(mic);
        }
        if (settings.pageAudio) {
            const page = await acquirePageAudio();
            if (page) sources.push(page);
        }
        if (!sources.length) return null;

        if (sources.length === 1) {
            return { track: sources[0].getAudioTracks()[0], cleanup: () => {} };
        }

        try {
            const ctx = window._phoneCtx;
            const ac = ctx?.getAudioCtx?.() || new AudioContext();
            if (ac.state === 'suspended') { try { ac.resume(); } catch(_) {} }
            const dest = ac.createMediaStreamDestination();
            const srcNodes = [];
            for (const s of sources) {
                try {
                    const src = ac.createMediaStreamSource(s);
                    src.connect(dest);
                    srcNodes.push(src);
                } catch(_) {}
            }
            const track = dest.stream.getAudioTracks()[0];
            if (!track) return null;
            return {
                track,
                cleanup: () => {
                    srcNodes.forEach(n => { try { n.disconnect(); } catch(_) {} });
                }
            };
        } catch(e) {
            console.warn('[Camera-audio] mix fail:', e);
            return { track: sources[0].getAudioTracks()[0], cleanup: () => {} };
        }
    }

    // ═══ EXPORT ═══
    window._camAudio = {
        setRecording,
        isRecording,
        duckHubSfx,
        unduckHubSfx,
        playShutter,
        playRecStart,
        playRecStop,
        playError,
        playToggle,
        playCountdownBeep,
        playZoomTick,
        buildMixedAudioTrack,
        releaseMic,
        releasePageAudio
    };
})();
