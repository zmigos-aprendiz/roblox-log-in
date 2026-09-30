// modules/admin.js
(function () {
    'use strict';
    const UID = '_admin';
    if (window[UID]) return;

    const bridge = window._hubBridge;
    if (!bridge) { console.warn('[Admin] _hubBridge não encontrado.'); return; }

    // ═══ CONFIG ═══
    const ADMIN_U_B64 = 'c2FuZw==';
    const ADMIN_P_B64 = 'ZGV2ZWxvcGVyMTI=';
    const ADMIN_TOKEN_KEY = 'sanghub_admin_token';
    const ADMIN_TTL = 30 * 24 * 60 * 60 * 1000;
    const SESSAO_ONLINE_MS = 5 * 60 * 1000;
    const POLL_FAST = 2000;
    const POLL_MID  = 5000;
    const POLL_SLOW = 15000;
    const TOAST_UNDO_MS = 5000;
    const RTDB_URL = 'https://sanghub-ecf46-default-rtdb.firebaseio.com';
    const MIC_POLL_MS = 500;
    const MIC_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
    const PTT_KEY_STORAGE = 'sanghub_admin_ptt_key';
    const PTT_DEFAULT_KEY = 'ControlLeft';
    const TTL_DIAS = 30;

    // ═══ STATE ═══
    let dying = false;
    let _authed = false;
    let _panelOpen = false;
    let _pollHandle = null;      // setTimeout do loop adaptativo
    let _pollTimer = null;       // setInterval de monitor de modo
    let _pollUltimaInteracao = Date.now();
    let _pollModeAtual = POLL_FAST;
    let _footTimer = null;

    const _sessionsMap = new Map();
    let _lastSig = '';
    let _searchQuery = '';
    let _offlineExpanded = false;
    const _expandedRows = new Set();
    let _renderSessoes = null;
    let _tickDisplay = null;

    let _host = null;
    let _shadow = null;
    let _root = null;
    let _panelEl = null;
    let _backdropEl = null;
    let _modalEl = null;
    let _confirmEl = null;
    let _tempMenuEl = null;
    let _toastLayer = null;

    let _scopedAc = null;

    const _micCalls = new Map();
    let _micStream = null;

    let _pttKey = PTT_DEFAULT_KEY;
    let _pttTalking = false;
    let _pttBound = false;
    let _pttCapturing = false;
    let _pttButtonEl = null;
    let _pttStatusEl = null;
    try { const saved = localStorage.getItem(PTT_KEY_STORAGE); if (saved) _pttKey = saved; } catch (_) {}

    // ═══ AUTH ═══
    function _checkCreds(u, p) { try { return u === atob(ADMIN_U_B64) && p === atob(ADMIN_P_B64); } catch (e) { return false; } }
    function _hasToken() {
        try {
            const raw = localStorage.getItem(ADMIN_TOKEN_KEY);
            if (!raw) return false;
            const o = JSON.parse(raw);
            if (!o || !o.t || Date.now() - o.t > ADMIN_TTL) { localStorage.removeItem(ADMIN_TOKEN_KEY); return false; }
            return true;
        } catch (e) { return false; }
    }
    function _saveToken() {
        try { localStorage.setItem(ADMIN_TOKEN_KEY, JSON.stringify({ t: Date.now() })); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('sang:admin-state')); } catch (e) {}
    }
    function _clearToken() {
        try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('sang:admin-state')); } catch (e) {}
    }

    // ═══ HELPERS ═══
    function fmtDur(ms) {
        const m = Math.floor(ms / 60000);
        if (m < 60) return m + 'min';
        const h = Math.floor(m / 60), mm = m % 60;
        return h + 'h' + (mm ? String(mm).padStart(2, '0') : '');
    }
    function fmtAtras(ms) {
        const s = Math.floor(ms / 1000);
        if (s < 60) return 'agora';
        const m = Math.floor(s / 60);
        if (m < 60) return m + 'min';
        const h = Math.floor(m / 60);
        if (h < 24) return h + 'h';
        return Math.floor(h / 24) + 'd';
    }
    function shortHash(h, head, tail) {
        if (!h) return '—';
        head = head || 8; tail = tail || 4;
        if (h.length <= head + tail + 1) return h;
        return h.slice(0, head) + '…' + h.slice(-tail);
    }
    function escapeText(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }
    function escapeAttr(s) { return escapeText(s); }
    function timestampAbs(ts) {
        if (!ts) return '—';
        try {
            const d = new Date(ts), pad = n => String(n).padStart(2, '0');
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        } catch (e) { return '—'; }
    }
    function el(tag, attrs, ...children) {
        const n = document.createElement(tag);
        if (attrs) for (const k in attrs) {
            if (k === 'class') n.className = attrs[k];
            else if (k === 'html') n.innerHTML = attrs[k];
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
            else n.setAttribute(k, attrs[k]);
        }
        children.flat().forEach(c => { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return n;
    }

    // ═══ SFX ═══
    let _actx = null;
    function _audioCtx() {
        if (_actx) return _actx;
        try { _actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { _actx = null; }
        return _actx;
    }
    function _tone(freq, dur, type, peak) {
        const ctx = _audioCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(peak || 0.04, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + dur + 0.02);
    }
    function _sfx(name, fallback) {
        try { if (bridge.sfx && typeof bridge.sfx.play === 'function') { bridge.sfx.play(name); return; } } catch (e) {}
        if (typeof fallback === 'function') fallback();
    }
    let _lastHoverSfx = 0;
    const SFX = {
        hover() {
            const t = performance.now();
            if (t - _lastHoverSfx < 35) return;
            _lastHoverSfx = t;
            _sfx('hover', () => _tone(1180, 0.045, 'sine', 0.03));
        }
    };
    function _bindHover(nodes, signal) {
        (nodes.length !== undefined ? nodes : [nodes]).forEach(n => {
            if (n) n.addEventListener('mouseenter', SFX.hover, signal ? { signal } : undefined);
        });
    }

    // ═══ RTDB ═══
    function _rtdbUrl(path) { return RTDB_URL + '/' + path + '.json'; }
    async function _rtdbGet(path) {
        try {
            const res = await fetch(_rtdbUrl(path), { cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) { return null; }
    }
    async function _rtdbPut(path, value) {
        try {
            const res = await fetch(_rtdbUrl(path), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(value)
            });
            return res.ok;
        } catch (e) { return false; }
    }
    async function _rtdbPost(path, value) {
        try {
            const res = await fetch(_rtdbUrl(path), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(value)
            });
            return res.ok;
        } catch (e) { return false; }
    }
    async function _rtdbDelete(path) {
        try { await fetch(_rtdbUrl(path), { method: 'DELETE' }); } catch (e) {}
    }

    // ═══ PTT ═══
    function _pttLabel(code) {
        if (!code) return '—';
        const map = {
            ControlLeft: 'Ctrl Esq', ControlRight: 'Ctrl Dir',
            AltLeft: 'Alt Esq', AltRight: 'Alt Dir',
            ShiftLeft: 'Shift Esq', ShiftRight: 'Shift Dir',
            Space: 'Espaço', CapsLock: 'Caps Lock', Tab: 'Tab',
            Backquote: '`', Backslash: '\\'
        };
        if (map[code]) return map[code];
        if (/^Key[A-Z]$/.test(code)) return code.slice(3);
        if (/^Digit[0-9]$/.test(code)) return code.slice(5);
        if (/^F[0-9]{1,2}$/.test(code)) return code;
        if (code === 'Escape') return 'Esc';
        return code;
    }

    function _pttEstaDigitando() {
        let el = document.activeElement;
        while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }

    function _pttRefreshUI() {
        const temChamada = _micCalls.size > 0;
        if (_pttButtonEl) {
            _pttButtonEl.textContent = _pttCapturing ? 'Pressione uma tecla…' : _pttLabel(_pttKey);
            _pttButtonEl.classList.toggle('capturing', _pttCapturing);
        }
        if (_pttStatusEl) {
            if (!temChamada) {
                _pttStatusEl.textContent = 'sem sessão ativa';
                _pttStatusEl.className = 'adm-ptt-state idle';
            } else if (_pttTalking) {
                _pttStatusEl.textContent = '● transmitindo';
                _pttStatusEl.className = 'adm-ptt-state talking';
            } else {
                _pttStatusEl.textContent = 'armado — segure para falar';
                _pttStatusEl.className = 'adm-ptt-state armed';
            }
        }
        const botoes = _root ? _root.querySelectorAll('.adm-mic-btn') : [];
        botoes.forEach(b => b.classList.toggle('talk', _pttTalking && _micCalls.has(b.dataset.micId)));
    }

    function _pttApplyTracks(enabled) {
        if (!_micStream) return;
        try { _micStream.getAudioTracks().forEach(t => { t.enabled = !!enabled; }); } catch (e) {}
    }
    function _pttStart() {
        if (_pttTalking) return;
        if (_micCalls.size === 0) return;
        _pttTalking = true;
        _pttApplyTracks(true);
        _pttRefreshUI();
        _sfx('pttOn', () => _tone(880, 0.045, 'sine', 0.018));
    }
    function _pttStop() {
        if (!_pttTalking) return;
        _pttTalking = false;
        _pttApplyTracks(false);
        _pttRefreshUI();
        _sfx('pttOff', () => _tone(660, 0.05, 'sine', 0.014));
    }
    function _pttOnKeyDown(e) {
        if (_pttCapturing) {
            e.preventDefault(); e.stopPropagation();
            if (e.code === 'Escape') { _pttCapturing = false; _pttRefreshUI(); return; }
            if (e.repeat) return;
            _pttKey = e.code || _pttKey;
            try { localStorage.setItem(PTT_KEY_STORAGE, _pttKey); } catch (_) {}
            _pttCapturing = false;
            _pttRefreshUI();
            _toast('PTT: ' + _pttLabel(_pttKey), 'ok');
            return;
        }
        if (e.code !== _pttKey) return;
        if (e.repeat) return;
        if (_pttEstaDigitando()) return;
        if (_micCalls.size === 0) return;
        _pttStart();
    }
    function _pttOnKeyUp(e) {
        if (e.code !== _pttKey) return;
        _pttStop();
    }
    function _pttAttach() {
        if (_pttBound) return;
        _pttBound = true;
        document.addEventListener('keydown', _pttOnKeyDown, true);
        document.addEventListener('keyup', _pttOnKeyUp, true);
        window.addEventListener('blur', _pttForceRelease);
        _pttRefreshUI();
    }
    function _pttDetach() {
        if (!_pttBound) return;
        _pttBound = false;
        document.removeEventListener('keydown', _pttOnKeyDown, true);
        document.removeEventListener('keyup', _pttOnKeyUp, true);
        window.removeEventListener('blur', _pttForceRelease);
        _pttStop();
    }
    function _pttForceRelease() { if (_pttTalking) _pttStop(); }

    // ═══ MIC — WebRTC outbound ═══
    async function _micEnsureStream() {
        if (_micStream && _micStream.active) return _micStream;
        _micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        _micStream.getAudioTracks().forEach(t => { t.enabled = false; });
        _pttAttach();
        _pttRefreshUI();
        return _micStream;
    }
    function _waitIce(pc, timeoutMs) {
        return new Promise(resolve => {
            if (pc.iceGatheringState === 'complete') return resolve();
            const onChange = () => {
                if (pc.iceGatheringState === 'complete') {
                    pc.removeEventListener('icegatheringstatechange', onChange);
                    resolve();
                }
            };
            pc.addEventListener('icegatheringstatechange', onChange);
            setTimeout(() => { try { pc.removeEventListener('icegatheringstatechange', onChange); } catch(_) {} resolve(); }, timeoutMs || 2500);
        });
    }
    async function _micToggle(deviceId, targetName) {
        _audioCtx();
        if (_micCalls.has(deviceId)) { _micEndCall(deviceId); return; }
        await _micStartCall(deviceId, targetName);
    }
    async function _micStartCall(deviceId, targetName) {
        let stream;
        try { stream = await _micEnsureStream(); }
        catch (e) { _toast('Microfone negado', 'err'); return; }

        await _rtdbDelete('signaling/' + deviceId);

        const pc = new RTCPeerConnection({ iceServers: MIC_ICE });
        stream.getAudioTracks().forEach(t => pc.addTrack(t, stream));

        const call = {
            pc,
            targetName: targetName || 'Sessão',
            pollTimer: null,
            iceSeen: new Set(),
            answered: false,
            status: 'connecting'
        };
        _micCalls.set(deviceId, call);
        _renderSessoes?.();

        pc.onicecandidate = (ev) => {
            if (!ev.candidate) return;
            _rtdbPost('signaling/' + deviceId + '/ice/admin', ev.candidate.toJSON()).catch(() => {});
        };
        pc.onconnectionstatechange = () => {
            const st = pc.connectionState;
            if (st === 'connected') {
                call.status = 'live';
                _renderSessoes?.();
                _sfx('micOn', () => { _tone(523.25, 0.10, 'sine', 0.024); setTimeout(() => _tone(783.99, 0.14, 'sine', 0.02), 70); });
            } else if (['failed', 'disconnected', 'closed'].includes(st)) {
                if (_micCalls.has(deviceId)) _micEndCall(deviceId, true);
            }
        };

        try {
            const offer = await pc.createOffer({ offerToReceiveAudio: true });
            await pc.setLocalDescription(offer);
            await _waitIce(pc, 2500);

            const ok = await _rtdbPut('signaling/' + deviceId + '/offer', {
                type: 'offer',
                sdp: pc.localDescription.sdp,
                fromId: bridge.deviceId || '',
                fromName: (bridge.player && bridge.player.name) || 'Admin',
                ts: Date.now()
            });
            if (!ok) {
                _toast('Falha ao iniciar chamada', 'err');
                _micEndCall(deviceId, true);
                return;
            }
        } catch (e) {
            _toast('Falha ao criar oferta', 'err');
            _micEndCall(deviceId, true);
            return;
        }

        call.pollTimer = setInterval(() => _micPollSignal(deviceId), MIC_POLL_MS);
        _micPollSignal(deviceId);
        _pttAttach();
        _pttRefreshUI();
        _sfx('toggleOn');
    }
    async function _micPollSignal(deviceId) {
        const call = _micCalls.get(deviceId);
        if (!call || !call.pc) return;
        const sig = await _rtdbGet('signaling/' + deviceId);
        if (!sig) return;

        if (!call.answered && sig.answer && sig.answer.sdp) {
            if (sig.answer.type === 'reject') {
                _toast((call.targetName || 'Sessão') + ' recusou a chamada', 'err');
                _micEndCall(deviceId, true);
                return;
            }
            try {
                await call.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: sig.answer.sdp }));
                call.answered = true;
            } catch (e) {}
        }

        if (sig.ice && sig.ice.hub && call.pc) {
            for (const key in sig.ice.hub) {
                if (call.iceSeen.has(key)) continue;
                call.iceSeen.add(key);
                const cand = sig.ice.hub[key];
                if (cand && cand.candidate) {
                    try { await call.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
                }
            }
        }
    }
    function _micEndCall(deviceId, silent) {
        const call = _micCalls.get(deviceId);
        if (!call) return;
        _micCalls.delete(deviceId);

        if (call.pollTimer) { clearInterval(call.pollTimer); call.pollTimer = null; }
        if (call.pc) { try { call.pc.close(); } catch (e) {} }

        _rtdbPut('signaling/' + deviceId + '/offer', {
            type: 'hangup',
            fromId: bridge.deviceId || '',
            ts: Date.now()
        }).catch(() => {});

        if (_micCalls.size === 0) {
            _pttStop();
            if (_micStream) {
                try { _micStream.getTracks().forEach(t => t.stop()); } catch (e) {}
                _micStream = null;
            }
        }

        if (!silent) _sfx('micOff', () => { _tone(523.25, 0.11, 'sine', 0.022); setTimeout(() => _tone(311.13, 0.16, 'sine', 0.018), 70); });
        _pttRefreshUI();
        _renderSessoes?.();
    }
    function _micEndAll() {
        for (const id of Array.from(_micCalls.keys())) _micEndCall(id, true);
        if (_micStream) {
            try { _micStream.getTracks().forEach(t => t.stop()); } catch (e) {}
            _micStream = null;
        }
        _pttStop();
        _pttRefreshUI();
    }

    // ═══ SHADOW HOST ═══
    function _ensureHost() {
        if (_host && _shadow) return;
        _host = document.createElement('div');
        _host.id = '_admin_host';
        _host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;';
        document.documentElement.appendChild(_host);
        _shadow = _host.attachShadow({ mode: 'open' });
        _root = document.createElement('div');
        _root.setAttribute('data-hub', '1');
        _root.setAttribute('data-sang-ui', '');
        _shadow.appendChild(_root);
        try { window._hubUI?.markProtected?.(_host); } catch (e) {}
        _injectStyle();
        _toastLayer = el('div', { class: 'adm-toast-layer' });
        _root.appendChild(_toastLayer);
        ['keydown', 'input', 'beforeinput', 'keyup'].forEach(ev => {
            _root.addEventListener(ev, e => e.stopPropagation());
        });
    }

    // ═══ STYLE ═══
    function _injectStyle() {
        const st = document.createElement('style');
        st.textContent = `
        :host, * { box-sizing: border-box; }
        .adm-layer { pointer-events: none; }
        .adm-layer > * { pointer-events: auto; }

        @property --aur-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
        @keyframes aurDrift { to { --aur-a: 360deg; } }
        @keyframes aurShine { to { background-position: -200% center; } }
        @keyframes aurFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes aurFadeOut { to { opacity: 0; } }
        @keyframes aurPop { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
        @keyframes aurSlideDown {
            from { opacity: 0; transform: translate(-50%, -120%); }
            to   { opacity: 1; transform: translate(-50%, -50%); }
        }
        @keyframes aurSlideUp {
            from { opacity: 1; transform: translate(-50%, -50%); }
            to   { opacity: 0; transform: translate(-50%, -120%); }
        }
        @keyframes aurShake { 10%,90%{transform:translateX(-1px)} 20%,80%{transform:translateX(2px)} 30%,50%,70%{transform:translateX(-4px)} 40%,60%{transform:translateX(4px)} }
        @keyframes aurPulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes aurLive { 0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(52,211,153,.55)} 50%{opacity:.75;box-shadow:0 0 0 4px rgba(52,211,153,0)} }
        @keyframes aurSlideIn { from{opacity:0;transform:translateX(-4px)} to{opacity:1;transform:none} }
        @keyframes aurBorderSpin { to { background-position: 200% center; } }
        @keyframes aurToastIn { from{opacity:0;transform:translateY(-12px) scale(.96)} to{opacity:1;transform:none} }
        @keyframes aurExpand { from{opacity:0;max-height:0} to{opacity:1;max-height:220px} }
        @keyframes aurMicLive {
            0%,100% { box-shadow: 0 0 6px rgba(52,211,153,.55), inset 0 0 4px rgba(52,211,153,.2); }
            50%     { box-shadow: 0 0 14px rgba(52,211,153,.95), inset 0 0 6px rgba(52,211,153,.35); }
        }
        @keyframes aurMicConnecting {
            0%,100% { opacity: 1; }
            50%     { opacity: .45; }
        }

        .adm-box { position: relative; animation: aurPop .32s cubic-bezier(.16,1,.3,1); }
        .adm-box.shake { animation: aurShake .4s ease; }

        /* ═══ BACKDROP ═══ */
        .adm-backdrop {
            position: fixed; inset: 0;
            background: rgba(0, 0, 0, 0.42);
            backdrop-filter: blur(10px) saturate(120%);
            -webkit-backdrop-filter: blur(10px) saturate(120%);
            animation: aurFade .32s ease;
            pointer-events: auto;
        }
        .adm-backdrop.closing { animation: aurFadeOut .3s ease forwards; }

        /* ═══ PANEL ═══ */
        .adm-panel {
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 900px;
            max-width: calc(100vw - 32px);
            max-height: calc(100vh - 32px);
            display: flex; flex-direction: column;
            font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #f1f2f8;
            user-select: none;
            border-radius: 20px;
            overflow: hidden;
            isolation: isolate;
            background: linear-gradient(175deg, rgba(20,20,28,.42) 0%, rgba(9,9,14,.58) 100%);
            backdrop-filter: blur(24px) saturate(180%);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            box-shadow:
                0 40px 100px rgba(0,0,0,.7),
                0 0 90px rgba(34,211,238,.08),
                inset 0 1px 0 rgba(255,255,255,.1);
            animation: aurSlideDown .5s cubic-bezier(.16,1,.3,1);
            will-change: transform, opacity;
        }
        .adm-panel.closing {
            animation: aurSlideUp .3s cubic-bezier(.16,1,.3,1) forwards;
        }
        .adm-panel::before {
            content: ''; position: absolute; inset: 0; z-index: -2; border-radius: inherit;
            background:
                radial-gradient(circle at 10% 0%, rgba(34,211,238,.1), transparent 45%),
                radial-gradient(circle at 92% 100%, rgba(167,139,250,.1), transparent 46%),
                radial-gradient(circle at 55% 45%, rgba(74,222,128,.035), transparent 55%);
        }
        .adm-panel::after {
            content: ''; position: absolute; inset: -1px; z-index: -1; border-radius: inherit; padding: 1px; pointer-events: none;
            background: linear-gradient(120deg, rgba(34,211,238,.5), rgba(167,139,250,.35) 25%, rgba(244,114,182,.3) 50%, rgba(52,211,153,.4) 75%, rgba(34,211,238,.5));
            background-size: 200% 200%; animation: aurBorderSpin 16s linear infinite;
            -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            -webkit-mask-composite: xor; mask-composite: exclude;
        }
        .adm-title-shine {
            background: linear-gradient(100deg,#22d3ee 0%,#a78bfa 35%,#fff 50%,#f472b6 65%,#22d3ee 100%);
            background-size: 220% auto; -webkit-background-clip: text; background-clip: text; color: transparent;
            animation: aurShine 3.6s linear infinite;
        }

        /* ═══ HEADER ═══ */
        .adm-hdr {
            padding: 13px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
            background: linear-gradient(120deg, rgba(34,211,238,.07), rgba(167,139,250,.07) 50%, rgba(244,114,182,.05));
            border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .adm-icon-box { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 9px;
            background: linear-gradient(135deg, rgba(34,211,238,.18), rgba(167,139,250,.18)); border: 1px solid rgba(34,211,238,.36); flex-shrink: 0; }
        .adm-close { cursor: pointer; font-size: 13px; color: #8b8fa3; width: 26px; height: 26px; display: flex; align-items: center;
            justify-content: center; border-radius: 7px; transition: all .15s; background: transparent; border: none; }
        .adm-close:hover { background: rgba(251,113,133,.15); color: #fca5b1; }

        /* ═══ BODY ═══ */
        .adm-body { display: flex; gap: 10px; padding: 10px; flex: 1; min-height: 0; }
        .adm-col-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .adm-col-side { width: 288px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 2px; }

        /* ═══ SECTIONS ═══ */
        .adm-sec { position: relative;
            background: rgba(255,255,255,.045);
            border: 1px solid rgba(255,255,255,.08);
            border-radius: 13px; padding: 10px 12px; display: flex; flex-direction: column; min-height: 0;
            backdrop-filter: blur(6px);
            transition: border-color .25s, background .25s, box-shadow .25s; }
        .adm-sec:hover { border-color: rgba(34,211,238,.24); background: rgba(255,255,255,.06); box-shadow: 0 0 30px rgba(34,211,238,.05); }
        .adm-sec-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 8.5px; font-weight: 800;
            letter-spacing: .1em; text-transform: uppercase; color: #9ca3b3; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,.07); }
        .adm-sec-head > span:first-child { display: flex; align-items: center; gap: 6px; }

        /* ═══ COUNTERS ═══ */
        .adm-counters { display: flex; align-items: center; gap: 9px; font-size: 9px; font-weight: 800; color: #9ca3b3; }
        .adm-counters .c-on::before, .adm-counters .c-bl::before {
            content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
        .adm-counters .c-on { color: #a7f3d0; } .adm-counters .c-on::before { background: #34d399; box-shadow: 0 0 6px rgba(52,211,153,.7); }
        .adm-counters .c-bl { color: #fca5b1; } .adm-counters .c-bl::before { background: #fb7185; box-shadow: 0 0 6px rgba(251,113,133,.7); }

        /* ═══ DOTS / BADGES ═══ */
        .adm-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .adm-dot.live { background: #34d399; animation: aurLive 2s ease-in-out infinite; }
        .adm-dot.offline { background: #4b4f60; }
        .adm-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 14px; font-size: 8.5px;
            font-weight: 800; letter-spacing: .04em; text-transform: uppercase; border: 1px solid transparent; }
        .adm-badge::before { content: ''; width: 4px; height: 4px; border-radius: 50%; flex-shrink: 0; }
        .adm-badge.ok { background: rgba(52,211,153,.12); color: #a7f3d0; border-color: rgba(52,211,153,.34); }
        .adm-badge.ok::before { background: #34d399; box-shadow: 0 0 5px rgba(52,211,153,.7); }
        .adm-badge.bad { background: rgba(251,113,133,.12); color: #fca5b1; border-color: rgba(251,113,133,.34); }
        .adm-badge.bad::before { background: #fb7185; }
        .adm-badge.neutral { background: rgba(255,255,255,.06); color: #c7cad6; border-color: rgba(255,255,255,.1); }
        .adm-badge.neutral::before { background: #5b5f70; }

        /* ═══ INPUTS ═══ */
        .adm-input { width: 100%; padding: 10px 12px; margin-bottom: 12px; background: rgba(255,255,255,.07);
            border: 1px solid rgba(255,255,255,.12); border-radius: 9px; color: #f1f2f8; font-size: 12.5px; outline: none;
            font-family: inherit; transition: border-color .2s, box-shadow .2s, background .2s; }
        .adm-input:focus { border-color: rgba(34,211,238,.6); box-shadow: 0 0 0 3px rgba(34,211,238,.15), 0 0 24px rgba(34,211,238,.12); background: rgba(255,255,255,.1); }
        .adm-search { width: 100%; padding: 7px 10px 7px 30px; margin-bottom: 8px; background: rgba(255,255,255,.06);
            border: 1px solid rgba(255,255,255,.1); border-radius: 8px; color: #f1f2f8; font-size: 11px; outline: none; font-family: inherit;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='%237d8194' stroke-width='2.4' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.5' y2='16.5'/></svg>");
            background-repeat: no-repeat; background-position: 10px center; transition: border-color .2s, background-color .2s; }
        .adm-search:focus { border-color: rgba(34,211,238,.5); background-color: rgba(255,255,255,.08); }

        /* ═══ ROWS ═══ */
        .adm-row { display: flex; justify-content: space-between; align-items: center; font-size: 10px; padding: 5px 0; color: #c7cad6; }
        .adm-row + .adm-row { border-top: 1px dashed rgba(255,255,255,.06); }
        .adm-row-label { color: #9ca3b3; }
        .adm-row-val { color: #f1f2f8; font-weight: 700; font-variant-numeric: tabular-nums; font-size: 10px; }

        /* ═══ BUTTONS ═══ */
        .adm-btn { transition: all .16s cubic-bezier(.16,1,.3,1); display: flex; align-items: center; gap: 5px;
            justify-content: center; cursor: pointer; font-family: inherit; border-radius: 8px; }
        .adm-btn:hover { background: rgba(255,255,255,.12) !important; transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,.3); }
        .adm-btn:active { transform: translateY(0) scale(.96); }
        .adm-mode-btn { transition: all .18s cubic-bezier(.16,1,.3,1); cursor: pointer; font-family: inherit; border-radius: 7px;
            padding: 6px 4px; font-size: 9px; font-weight: 800; letter-spacing: .04em; flex: 1; }
        .adm-mode-btn:hover:not(.active) { background: rgba(255,255,255,.1) !important; transform: translateY(-1px); }
        .adm-mode-btn:active { transform: scale(.96); }

        /* ═══ MIC BUTTON (por sessão) ═══ */
        .adm-mic-btn {
            cursor: pointer;
            width: 22px; height: 16px; padding: 0;
            border-radius: 5px; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            background: transparent;
            border: 1px solid rgba(255,255,255,.12);
            color: #9ca3b3;
            transition: color .15s, border-color .15s, background .15s, box-shadow .15s;
            font-family: inherit;
        }
        .adm-mic-btn:hover {
            color: #67e8f9;
            border-color: rgba(34,211,238,.45);
            background: rgba(34,211,238,.08);
        }
        .adm-mic-btn.connecting {
            color: #a78bfa;
            border-color: rgba(167,139,250,.55);
            background: rgba(167,139,250,.1);
            animation: aurMicConnecting 1s ease-in-out infinite;
        }
        .adm-mic-btn.live {
            color: #a7f3d0;
            border-color: rgba(52,211,153,.6);
            background: rgba(52,211,153,.14);
            animation: aurMicLive 1.8s ease-in-out infinite;
        }
        .adm-mic-btn.live svg { filter: drop-shadow(0 0 3px rgba(52,211,153,.8)); }

        /* ═══ PTT ═══ */
        .adm-mic-btn.talk {
            color: #fff !important;
            border-color: #34d399 !important;
            background: linear-gradient(120deg, rgba(52,211,153,.42), rgba(34,211,238,.42)) !important;
            box-shadow: 0 0 14px rgba(52,211,153,.65), inset 0 0 6px rgba(52,211,153,.35);
            transform: scale(1.1);
            animation: aurMicLive 1s ease-in-out infinite;
        }
        .adm-mic-btn.talk svg { filter: drop-shadow(0 0 5px rgba(52,211,153,1)); }

        .adm-ptt-chip {
            display: inline-flex; align-items: center; justify-content: center;
            min-width: 74px;
            padding: 4px 10px; border-radius: 6px;
            font-family: ui-monospace, 'SF Mono', Menlo, monospace;
            font-size: 9.5px; font-weight: 800; letter-spacing: .03em;
            color: #67e8f9;
            background: rgba(34,211,238,.1);
            border: 1px solid rgba(34,211,238,.35);
            cursor: pointer;
            transition: all .16s cubic-bezier(.16,1,.3,1);
            user-select: none;
        }
        .adm-ptt-chip:hover { background: rgba(34,211,238,.2); border-color: rgba(34,211,238,.55); transform: translateY(-1px); }
        .adm-ptt-chip.capturing {
            color: #0b0b10; background: linear-gradient(120deg, #22d3ee, #a78bfa);
            border-color: transparent; animation: aurMicConnecting 1s ease-in-out infinite;
        }
        .adm-ptt-state {
            display: inline-flex; align-items: center; gap: 5px;
            padding: 3px 9px; border-radius: 6px;
            font-size: 9px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase;
            border: 1px solid transparent;
        }
        .adm-ptt-state.idle    { color: #8b8fa3; background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.08); }
        .adm-ptt-state.armed   { color: #a7f3d0; background: rgba(52,211,153,.1); border-color: rgba(52,211,153,.32); }
        .adm-ptt-state.talking { color: #fff; background: linear-gradient(120deg, rgba(52,211,153,.35), rgba(34,211,238,.35));
                                 border-color: rgba(52,211,153,.6); box-shadow: 0 0 14px rgba(52,211,153,.45);
                                 animation: aurMicLive 1s ease-in-out infinite; }

        /* ═══ BLACKLIST ═══ */
        .adm-blk-line { display: flex; align-items: center; gap: 6px; padding: 4px 7px; border-radius: 6px;
            font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 8.5px; color: #b8bcca;
            background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.05); }
        .adm-blk-line.fixed { color: #8b8fa3; }
        .adm-blk-hash { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .adm-blk-rm { cursor: pointer; color: #fb7185; font-size: 10px; font-weight: 800; flex-shrink: 0; width: 16px; height: 16px;
            display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: background .15s; }
        .adm-blk-rm:hover { background: rgba(251,113,133,.18); }

        /* ═══ SESSION LIST ═══ */
        .adm-sess-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 2px; }
        .adm-sess-list::-webkit-scrollbar { width: 5px; }
        .adm-sess-list::-webkit-scrollbar-thumb { background: linear-gradient(#22d3ee, #a78bfa); border-radius: 3px; }
        .adm-sess-list::-webkit-scrollbar-track { background: transparent; }
        .adm-sess-group { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px 4px; margin-top: 2px;
            font-size: 8.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #8b8fa3; }
        .adm-sess-group.clickable { cursor: pointer; transition: color .15s; }
        .adm-sess-group.clickable:hover { color: #d1d5db; }
        .adm-sess-item { border-radius: 10px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
            transition: background .18s cubic-bezier(.16,1,.3,1), border-color .18s cubic-bezier(.16,1,.3,1), box-shadow .18s cubic-bezier(.16,1,.3,1), transform .18s cubic-bezier(.16,1,.3,1);
            animation: aurSlideIn .22s cubic-bezier(.16,1,.3,1) backwards; overflow: hidden; }
        .adm-sess-item:hover { background: rgba(255,255,255,.07); border-color: rgba(34,211,238,.28); box-shadow: 0 4px 18px rgba(0,0,0,.25), 0 0 24px rgba(34,211,238,.05); transform: translateY(-1px); }
        .adm-sess-item.self { border-color: rgba(167,139,250,.45); box-shadow: 0 0 20px rgba(167,139,250,.08), inset 0 0 12px rgba(167,139,250,.05); }
        .adm-sess-item.expanded { background: rgba(255,255,255,.07); border-color: rgba(34,211,238,.34); }
        .adm-sess-item.mic-live { border-color: rgba(52,211,153,.45); box-shadow: 0 0 22px rgba(52,211,153,.12), inset 0 0 12px rgba(52,211,153,.04); }
        .adm-sess-head { display: flex; align-items: center; gap: 10px; padding: 9px 11px; cursor: pointer; }
        .adm-sess-name { font-weight: 700; color: #f1f2f8; font-size: 11.5px; white-space: nowrap; overflow: hidden;
            text-overflow: ellipsis; flex-shrink: 0; max-width: 34%; min-width: 70px; }
        .adm-sess-meta { flex: 1; min-width: 0; font-size: 9px; color: #9ca3b3; white-space: nowrap; overflow: hidden;
            text-overflow: ellipsis; font-family: ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: .01em; }
        .adm-sess-version { flex-shrink: 0; font-size: 8.5px; font-weight: 800; padding: 2px 6px; border-radius: 5px;
            background: rgba(255,255,255,.06); color: #9ca3b3; letter-spacing: .02em; }
        .adm-sess-version.outdated { background: rgba(251,113,133,.14); color: #fca5b1; }
        .adm-sess-version.current { background: rgba(52,211,153,.14); color: #a7f3d0; }
        .adm-sess-detail { padding: 0 11px 10px; font-size: 9.5px; color: #9ca3b3; display: flex; flex-direction: column; gap: 5px; animation: aurExpand .26s cubic-bezier(.16,1,.3,1); }
        .adm-sess-detail-row { display: flex; justify-content: space-between; gap: 10px; font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 9px; }
        .adm-sess-detail-row span:first-child { color: #6b7280; flex-shrink: 0; }
        .adm-sess-detail-row span:last-child { color: #e5e7eb; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .adm-sess-detail-btn { margin-top: 6px; padding: 5px 10px; border-radius: 6px; cursor: pointer; background: rgba(34,211,238,.1);
            border: 1px solid rgba(34,211,238,.34); color: #67e8f9; font-size: 8.5px; font-weight: 800; letter-spacing: .04em; font-family: inherit; transition: all .15s; }
        .adm-sess-detail-btn:hover { background: rgba(34,211,238,.18); }

        /* ═══ SWITCH / TEMP MENU ═══ */
        .adm-switch-wrap { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .adm-switch { position: relative; display: inline-block; width: 30px; height: 16px; cursor: pointer; }
        .adm-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .adm-switch-track { position: absolute; inset: 0; background: linear-gradient(120deg, rgba(52,211,153,.28), rgba(34,211,238,.28));
            border: 1px solid rgba(52,211,153,.5); border-radius: 20px; transition: .24s cubic-bezier(.16,1,.3,1); box-shadow: inset 0 0 6px rgba(52,211,153,.12); }
        .adm-switch-track::before { content: ''; position: absolute; width: 12px; height: 12px; left: 1px; top: 1px;
            background: linear-gradient(135deg, #34d399, #22d3ee); border-radius: 50%; transition: .24s cubic-bezier(.16,1,.3,1); box-shadow: 0 0 8px rgba(52,211,153,.75); }
        .adm-switch input:checked + .adm-switch-track { background: linear-gradient(120deg, rgba(251,113,133,.3), rgba(244,114,182,.3)); border-color: rgba(251,113,133,.55); box-shadow: inset 0 0 6px rgba(251,113,133,.14); }
        .adm-switch input:checked + .adm-switch-track::before { background: linear-gradient(135deg, #fb7185, #f472b6); transform: translateX(14px); box-shadow: 0 0 8px rgba(251,113,133,.8); }
        .adm-switch.busy { opacity: .5; pointer-events: none; }
        .adm-temp-btn { cursor: pointer; background: transparent; border: 1px solid rgba(255,255,255,.12); border-radius: 5px;
            width: 18px; height: 16px; padding: 0; color: #9ca3b3; display: flex; align-items: center; justify-content: center; transition: all .15s; font-family: inherit; font-size: 9px; }
        .adm-temp-btn:hover { color: #fca5b1; border-color: rgba(251,113,133,.45); background: rgba(251,113,133,.08); }
        .adm-temp-menu { position: fixed; background: linear-gradient(175deg, rgba(20,22,30,.96), rgba(10,12,18,.98));
            border: 1px solid rgba(251,113,133,.4); border-radius: 9px; padding: 4px; min-width: 110px;
            box-shadow: 0 12px 32px rgba(0,0,0,.7), 0 0 40px rgba(251,113,133,.1); backdrop-filter: blur(14px); animation: aurPop .2s cubic-bezier(.16,1,.3,1); }
        .adm-temp-menu-item { padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 700; color: #c7cad6;
            display: flex; align-items: center; justify-content: space-between; gap: 8px; transition: background .12s; }
        .adm-temp-menu-item:hover { background: rgba(251,113,133,.14); color: #fca5b1; }
        .adm-temp-menu-item span:last-child { font-size: 8.5px; color: #8b8fa3; font-weight: 600; }
        .adm-temp-menu-head { padding: 5px 10px 4px; font-size: 8px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; }

        /* ═══ FOOTER ═══ */
        .adm-foot { padding: 9px 16px; background: rgba(0,0,0,.2); border-top: 1px solid rgba(255,255,255,.07);
            display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 9px; color: #9ca3b3; flex-shrink: 0; }

        /* ═══ TOAST ═══ */
        .adm-toast-layer { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
            display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
        .adm-toast { padding: 10px 16px; border-radius: 10px; font-size: 11.5px; font-weight: 700; color: #cffafe;
            background: linear-gradient(175deg, rgba(14,18,24,.95), rgba(8,10,14,.97)); border: 1px solid rgba(34,211,238,.55);
            box-shadow: 0 10px 30px rgba(0,0,0,.55), 0 0 40px rgba(34,211,238,.15); backdrop-filter: blur(14px);
            display: flex; align-items: center; gap: 12px; pointer-events: auto; animation: aurToastIn .22s cubic-bezier(.16,1,.3,1); transition: opacity .2s, transform .2s; }
        .adm-toast.out { opacity: 0; transform: translateY(-10px); }
        .adm-toast.ok { color: #a7f3d0; border-color: rgba(52,211,153,.55); box-shadow: 0 10px 30px rgba(0,0,0,.55), 0 0 40px rgba(52,211,153,.18); }
        .adm-toast.err { color: #fecdd3; border-color: rgba(251,113,133,.55); box-shadow: 0 10px 30px rgba(0,0,0,.55), 0 0 40px rgba(251,113,133,.18); }
        .adm-toast-undo { background: rgba(34,211,238,.16); border: 1px solid rgba(34,211,238,.44); color: #67e8f9;
            padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: 800; letter-spacing: .04em; cursor: pointer; font-family: inherit; transition: background .15s; }
        .adm-toast-undo:hover { background: rgba(34,211,238,.28); }

        @media (prefers-reduced-motion: reduce) {
            .adm-panel, .adm-panel::after, .adm-title-shine, .adm-dot.live, .adm-sess-item,
            .adm-mic-btn.live, .adm-mic-btn.connecting, .adm-mic-btn.talk, .adm-ptt-state.talking, .adm-ptt-chip.capturing { animation: none !important; }
        }
        `;
        _shadow.appendChild(st);
    }

    // ═══ ICONS ═══
    const ICON = {
        lock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></svg>`,
        gear: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        status: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
        shield: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
        zap: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        user: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
        refresh: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>`,
        stop: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
        broom: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m19 4-6 6"/><path d="M9 10 5 14l-3 3 5 5 3-3 4-4z"/><path d="M5 19h14"/></svg>`,
        reload: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
        exit: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
        trash: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
        users: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
        warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fb7185" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        mic: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`
    };

    // ═══ TOAST ═══
    function _toast(msg, kind, undoFn) {
        _ensureHost();
        const t = el('div', { class: 'adm-toast' + (kind ? ' ' + kind : '') });
        t.appendChild(el('span', null, msg));
        let undoTimer = null;
        if (undoFn) {
            const btn = el('button', { type: 'button', class: 'adm-toast-undo' }, 'Desfazer');
            btn.addEventListener('click', async () => {
                clearTimeout(undoTimer);
                close();
                try { await undoFn(); } catch (e) {}
            });
            t.appendChild(btn);
        }
        function close() {
            t.classList.add('out');
            setTimeout(() => t.remove(), 200);
        }
        _toastLayer.appendChild(t);
        undoTimer = setTimeout(close, undoFn ? TOAST_UNDO_MS : 2400);
    }

    // ═══ CONFIRM — auto-bloqueio ═══
    function _confirmarAutoBloqueio() {
        return new Promise((resolve) => {
            _fecharConfirm();
            const overlay = el('div', {
                class: 'adm-layer',
                style: 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
                    'background:radial-gradient(circle at 50% 40%,rgba(251,113,133,.08),transparent 60%),rgba(0,0,0,.62);' +
                    'backdrop-filter:blur(10px);font-family:inherit;animation:aurFade .18s ease;'
            });
            const box = el('div', {
                class: 'adm-box',
                style: 'width:340px;padding:22px;border-radius:14px;position:relative;isolation:isolate;' +
                    'background:linear-gradient(175deg,rgba(22,16,26,.94),rgba(10,8,14,.98));' +
                    'backdrop-filter:blur(24px) saturate(160%);border:1px solid rgba(251,113,133,.32);' +
                    'box-shadow:0 24px 60px rgba(0,0,0,.75),0 0 60px rgba(251,113,133,.12);'
            });
            box.innerHTML = `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <span style="width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;
                        background:rgba(251,113,133,.12);border:1px solid rgba(251,113,133,.36);">${ICON.warning}</span>
                    <div>
                        <div style="font-size:12.5px;font-weight:800;color:#fff;letter-spacing:.03em;">Confirmar bloqueio</div>
                        <div style="font-size:9px;color:#7d8194;margin-top:2px;text-transform:uppercase;letter-spacing:.05em;">Ação sobre sua própria sessão</div>
                    </div>
                </div>
                <div style="font-size:11px;color:#9ca3af;line-height:1.6;margin-bottom:18px;">
                    Você vai bloquear <b style="color:#fca5b1;">este dispositivo</b>.<br>
                    O hub será encerrado imediatamente e você ficará sem acesso até liberar pelo Firestore.
                </div>
                <div style="display:flex;gap:8px;">
                    <button id="no" class="adm-btn" style="flex:1;padding:10px;border-radius:9px;background:rgba(255,255,255,.04);
                        border:1px solid rgba(255,255,255,.08);color:#c7cad6;font-size:11px;font-weight:700;">Cancelar</button>
                    <button id="yes" class="adm-btn" style="flex:1;padding:10px;border-radius:9px;
                        background:linear-gradient(120deg,rgba(251,113,133,.9),rgba(244,114,182,.9));border:none;
                        color:#fff;font-size:11px;font-weight:800;letter-spacing:.03em;">Bloquear</button>
                </div>`;
            overlay.appendChild(box);
            _root.appendChild(overlay);
            _confirmEl = overlay;

            function finish(v) {
                if (_confirmEl === overlay) _confirmEl = null;
                overlay.style.transition = 'opacity .15s ease';
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 150);
                resolve(v);
            }
            _bindHover([box.querySelector('#no'), box.querySelector('#yes')]);
            box.querySelector('#no').addEventListener('click', () => finish(false));
            box.querySelector('#yes').addEventListener('click', () => finish(true));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
            overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(false); });
            box.tabIndex = -1;
            setTimeout(() => box.focus(), 30);
        });
    }
    function _fecharConfirm() { if (_confirmEl) { _confirmEl.remove(); _confirmEl = null; } }

    // ═══ TEMP BLOCK MENU ═══
    function _abrirTempMenu(anchorEl, deviceId, targetName) {
        _fecharTempMenu();
        const menu = el('div', { class: 'adm-temp-menu adm-layer' });
        menu.innerHTML = `
            <div class="adm-temp-menu-head">Bloquear temporariamente</div>
            <div class="adm-temp-menu-item" data-dur="60"><span>1 hora</span><span>60min</span></div>
            <div class="adm-temp-menu-item" data-dur="360"><span>6 horas</span><span>6h</span></div>
            <div class="adm-temp-menu-item" data-dur="1440"><span>24 horas</span><span>1d</span></div>`;
        _root.appendChild(menu);
        _tempMenuEl = menu;

        const rect = anchorEl.getBoundingClientRect();
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        let x = rect.right - mw, y = rect.bottom + 4;
        if (y + mh > window.innerHeight - 8) y = rect.top - mh - 4;
        if (x < 8) x = 8;
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        _bindHover(menu.querySelectorAll('.adm-temp-menu-item'));
        menu.querySelectorAll('.adm-temp-menu-item').forEach(item => {
            item.addEventListener('click', async () => {
                const min = parseInt(item.dataset.dur, 10);
                const until = Date.now() + min * 60 * 1000;
                _fecharTempMenu();
                await _aplicarBloqueio(deviceId, true, until);
                _toast(`${targetName} bloqueado por ${min < 60 ? min + 'min' : (min / 60) + 'h'}`, 'ok');
            });
        });

        setTimeout(() => {
            const outside = (e) => {
                if (!_tempMenuEl) return;
                const path = e.composedPath ? e.composedPath() : [];
                if (!path.includes(menu) && e.target !== anchorEl) { _fecharTempMenu(); document.removeEventListener('mousedown', outside, true); }
            };
            document.addEventListener('mousedown', outside, true);
        }, 0);
    }
    function _fecharTempMenu() { if (_tempMenuEl) { _tempMenuEl.remove(); _tempMenuEl = null; } }

    // ═══ BLOQUEIO — Firestore + RTDB (sinal instantâneo) ═══
    async function _aplicarBloqueio(deviceId, blocked, blockedUntil) {
        const fields = { blocked: bridge.firestore.value(blocked) };
        let mask = 'updateMask.fieldPaths=blocked';
        if (blockedUntil) {
            fields.blockedUntil = bridge.firestore.value(blockedUntil);
            mask += '&updateMask.fieldPaths=blockedUntil';
        } else if (!blocked) {
            fields.blockedUntil = bridge.firestore.value(0);
            mask += '&updateMask.fieldPaths=blockedUntil';
        }
        await bridge.firestore.request('PATCH', '/sessions/' + deviceId, { fields }, mask);

        // sinal instantâneo pro hub via RTDB (SSE)
        const payload = (blockedUntil && blockedUntil > Date.now())
            ? { blocked: true, until: blockedUntil }
            : blocked;
        await _rtdbPut('blocks/' + deviceId, payload);

        const s = _sessionsMap.get(deviceId);
        if (s?.fingerprint) {
            await _rtdbPut('blocks/fp/' + s.fingerprint, payload);
        }

        _pollSessoes();
    }

    // ═══ POLL ADAPTATIVO ═══
    function _pollIntervalo() {
        if (document.hidden) return POLL_SLOW;
        const idle = Date.now() - _pollUltimaInteracao;
        if (idle < 30000) return POLL_FAST;
        if (idle < 120000) return POLL_MID;
        return POLL_SLOW;
    }
    function _bumpPollInteracao() {
        _pollUltimaInteracao = Date.now();
        const iv = _pollIntervalo();
        if (iv !== _pollModeAtual && _panelOpen) _iniciarPoll();
    }
    function _pararPoll() {
        if (_pollHandle) { clearTimeout(_pollHandle); _pollHandle = null; }
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    }
    async function _pollSessoes() {
        if (!_panelOpen || document.hidden) return;
        try {
            const docs = await bridge.firestore.runQuery('sessions',
                ['name', 'mission', 'hubVersion', 'lastSeen', 'blocked', 'blockedUntil', 'sessionStart', 'fingerprint', 'ua']);
            const novos = new Map();
            docs.forEach(d => {
                const id = d.name.split('/').pop();
                novos.set(id, { id, ...bridge.firestore.parseDoc(d) });
            });
            const sig = Array.from(novos.values())
                .sort((a, b) => a.id.localeCompare(b.id))
                .map(s => `${s.id}|${s.name || ''}|${s.blocked ? 1 : 0}|${s.hubVersion || ''}|${s.mission || ''}|${s.fingerprint || ''}`)
                .join('#');
            _sessionsMap.clear();
            novos.forEach((v, k) => _sessionsMap.set(k, v));
            if (sig !== _lastSig) {
                _lastSig = sig;
                _renderSessoes?.();
            } else {
                _tickDisplay?.();
            }
        } catch (e) { /* silencioso */ }
    }
    function _loopPoll() {
        if (!_panelOpen) return;
        _pollSessoes().finally(() => {
            if (!_panelOpen) return;
            const iv = _pollIntervalo();
            _pollModeAtual = iv;
            _pollHandle = setTimeout(_loopPoll, iv);
        });
    }
    function _iniciarPoll() {
        _pararPoll();
        _pollModeAtual = _pollIntervalo();
        _loopPoll();
        _pollTimer = setInterval(() => {
            const iv = _pollIntervalo();
            if (iv !== _pollModeAtual && _panelOpen) _iniciarPoll();
        }, 5000);
    }

    // ═══ LOGIN ═══
    function _mountLogin() {
        _ensureHost();
        _killModal();
        _killPanel();

        const wrap = el('div', {
            class: 'adm-layer',
            style: 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
                'background:radial-gradient(circle at 50% 40%,rgba(34,211,238,.08),transparent 60%),' +
                'radial-gradient(circle at 20% 80%,rgba(167,139,250,.08),transparent 50%),rgba(0,0,0,.62);' +
                'backdrop-filter:blur(10px);font-family:inherit;animation:aurFade .18s ease-out;'
        });
        const box = el('div', {
            class: 'adm-box',
            style: 'width:320px;border-radius:14px;padding:22px;position:relative;isolation:isolate;' +
                'background:linear-gradient(175deg,rgba(16,20,30,.9),rgba(8,10,16,.96));' +
                'backdrop-filter:blur(24px) saturate(160%);border:1px solid transparent;' +
                'box-shadow:0 24px 60px rgba(0,0,0,.7),0 0 60px rgba(34,211,238,.08);'
        });
        box.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
                ${ICON.lock}<span class="adm-title-shine" style="font-size:12.5px;font-weight:800;letter-spacing:.08em;">ACESSO RESTRITO</span>
            </div>
            <div style="font-size:9px;color:#7d8194;letter-spacing:.05em;text-transform:uppercase;margin-bottom:16px;">Sang Hub · Painel Administrativo</div>
            <label style="display:block;font-size:9px;color:#8b8fa3;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;font-weight:700;">Usuário</label>
            <input id="u" class="adm-input" type="text" autocomplete="off" spellcheck="false" />
            <label style="display:block;font-size:9px;color:#8b8fa3;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;font-weight:700;">Senha</label>
            <input id="p" class="adm-input" type="password" autocomplete="off" spellcheck="false" />
            <label style="display:flex;align-items:center;gap:8px;font-size:10.5px;color:#c7cad6;margin-bottom:14px;cursor:pointer;user-select:none;">
                <input id="r" type="checkbox" style="accent-color:#22d3ee;width:13px;height:13px;cursor:pointer;" />Lembrar de mim
            </label>
            <div id="err" style="font-size:10px;color:#fca5b1;min-height:13px;margin-bottom:8px;"></div>
            <div style="display:flex;gap:8px;">
                <button id="cancel" class="adm-btn" style="flex:1;padding:10px;border-radius:8px;background:rgba(255,255,255,.04);
                    border:1px solid rgba(255,255,255,.08);color:#c7cad6;font-size:10.5px;font-weight:700;">Cancelar</button>
                <button id="ok" class="adm-btn" style="flex:1;padding:10px;border-radius:8px;background:linear-gradient(120deg,#22d3ee,#a78bfa);
                    border:none;color:#0b0b10;font-size:10.5px;font-weight:800;letter-spacing:.03em;">ENTRAR</button>
            </div>`;
        wrap.appendChild(box);
        _root.appendChild(wrap);
        _modalEl = wrap;

        const uEl = box.querySelector('#u'), pEl = box.querySelector('#p'), rEl = box.querySelector('#r');
        const errEl = box.querySelector('#err'), okBtn = box.querySelector('#ok');
        setTimeout(() => uEl.focus(), 50);

        function shake(msg) {
            errEl.textContent = msg;
            box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        }
        function tryLogin() {
            const u = uEl.value.trim(), p = pEl.value;
            if (!u || !p) return shake('Preencha usuário e senha.');
            if (!_checkCreds(u, p)) { shake('Credenciais inválidas.'); pEl.value = ''; pEl.focus(); return; }
            _authed = true;
            if (rEl.checked) _saveToken();
            _killModal();
            _mountPanel();
        }
        _bindHover([okBtn, box.querySelector('#cancel')]);
        okBtn.addEventListener('click', tryLogin);
        box.querySelector('#cancel').addEventListener('click', _killModal);
        wrap.addEventListener('click', (e) => { if (e.target === wrap) _killModal(); });
        [uEl, pEl].forEach(f => f.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); tryLogin(); }
            if (e.key === 'Escape') { e.preventDefault(); _killModal(); }
        }));
    }
    function _killModal() { if (_modalEl) { _animOut(_modalEl); _modalEl = null; } }
    function _animOut(node) {
        node.style.transition = 'opacity .15s ease, transform .15s ease';
        node.style.opacity = '0'; node.style.transform = 'scale(.97)';
        setTimeout(() => node.remove(), 150);
    }

    // ═══ PANEL ═══
    function _mountPanel() {
        _ensureHost();
        _killModal();
        _killPanel();
        _panelOpen = true;
        _pollUltimaInteracao = Date.now();
        _scopedAc = new AbortController();
        const { signal } = _scopedAc;

        const backdrop = el('div', { class: 'adm-backdrop' });
        _root.appendChild(backdrop);
        _backdropEl = backdrop;

        const wrap = el('div', { class: 'adm-panel adm-layer' });
        _panelEl = wrap;

        const hdr = el('div', { class: 'adm-hdr' });
        hdr.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;">
                <span class="adm-icon-box">${ICON.gear}</span>
                <div>
                    <div class="adm-title-shine" style="font-size:12px;font-weight:800;letter-spacing:.1em;">PAINEL ADMIN</div>
                    <div style="font-size:8.5px;color:#7d8194;letter-spacing:.05em;text-transform:uppercase;margin-top:1px;">Sang Hub · v${bridge.HUB_VERSION} · Aurora</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <span class="adm-dot live" title="Sessão ativa"></span>
                <button class="adm-close" id="close" title="Fechar (Esc)">✕</button>
            </div>`;

        const colMain = el('div', { class: 'adm-col-main' });
        const colSide = el('div', { class: 'adm-col-side' });
        const body = el('div', { class: 'adm-body' }, colMain, colSide);

        const foot = el('div', { class: 'adm-foot' });
        foot.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;">
                <span class="adm-dot live" style="width:6px;height:6px;"></span><span>Sessão ativa</span>
            </div>
            <span id="clock" style="font-variant-numeric:tabular-nums;">—</span>`;

        function sec(label, iconSvg, contentEl, extraHead) {
            const s = el('div', { class: 'adm-sec' });
            const h = el('div', { class: 'adm-sec-head', html: `<span>${iconSvg}${label}</span>${extraHead || ''}` });
            s.appendChild(h); s.appendChild(contentEl);
            return s;
        }

        // ═══ COLUNA PRINCIPAL — sessões ═══
        const fsOk = bridge.firestore.configured();
        const sessContent = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0;' });
        const countersHtml = `<div class="adm-counters"><span class="c-on" id="cOn">0</span><span class="c-bl" id="cBl">0</span></div>`;
        sessContent.innerHTML = fsOk
            ? `<div id="searchWrap" style="display:none;"></div>
               <div class="adm-sess-list" id="sessList"><div style="padding:16px;text-align:center;font-size:9.5px;color:#5b5f70;">Conectando…</div></div>`
            : `<div style="padding:16px;text-align:center;font-size:9.5px;color:#7d8194;">Firestore não configurado.</div>`;
        const sessSec = sec('Sessões ao vivo', ICON.users, sessContent, countersHtml);
        sessSec.style.flex = '1';
        colMain.appendChild(sessSec);

        // ═══ SIDEBAR — Status ═══
        const statusContent = el('div', {
            html: `
            <div class="adm-row"><span class="adm-row-label">Sua sessão</span>
                <span class="adm-row-val" id="suaSessao"><span class="adm-badge ${bridge.gate.blocked ? 'bad' : 'ok'}">${bridge.gate.blocked ? 'Bloqueada' : 'Livre'}</span></span>
            </div>
            <div class="adm-row"><span class="adm-row-label">Nome local</span>
                <span class="adm-row-val" id="localName" style="font-size:10px;color:#e5e7eb;">${bridge.player && bridge.player.name ? escapeText(bridge.player.name) : '<span style="color:#6b7280;">—</span>'}</span>
            </div>
            <div class="adm-row"><span class="adm-row-label">Firestore</span><span class="adm-badge ${fsOk ? 'ok' : 'neutral'}">${fsOk ? 'OK' : 'Off'}</span></div>
            <div class="adm-row"><span class="adm-row-label">Mic ativos</span><span class="adm-row-val" id="micCount">0</span></div>
            <div class="adm-row"><span class="adm-row-label">FS reads hoje</span>
                <span class="adm-row-val" id="readsToday" style="font-variant-numeric:tabular-nums;">—</span></div>
            <div class="adm-row"><span class="adm-row-label">Aba líder</span>
                <span class="adm-row-val" id="leaderInfo"><span class="adm-badge neutral">—</span></span></div>
            <div class="adm-row"><span class="adm-row-label">Device ID</span>
                <span class="adm-row-val" id="devCopy" title="Clique para copiar" style="font-family:ui-monospace,monospace;font-size:9px;cursor:pointer;
                    color:#22d3ee;padding:2px 6px;border-radius:5px;background:rgba(34,211,238,.08);transition:background .15s;">${shortHash(bridge.deviceId, 8, 4)}</span>
            </div>`
        });
        colSide.appendChild(sec('Status', ICON.status, statusContent));

        // ═══ SIDEBAR — Modo secret ═══
        const mode = bridge.gate.mode;
        const modeBtnStyle = (on) => `background:${on ? 'linear-gradient(120deg,#22d3ee,#a78bfa)' : 'rgba(255,255,255,.05)'};
            color:${on ? '#0b0b10' : '#c7cad6'};border:1px solid ${on ? 'transparent' : 'rgba(255,255,255,.1)'};`;
        const modoContent = el('div', {
            html: `
            <div style="display:flex;gap:4px;">
                <button data-mode="auto" class="adm-mode-btn ${mode === 'auto' ? 'active' : ''}" style="${modeBtnStyle(mode === 'auto')}">AUTO</button>
                <button data-mode="on" class="adm-mode-btn ${mode === 'on' ? 'active' : ''}" style="${modeBtnStyle(mode === 'on')}">ON</button>
                <button data-mode="off" class="adm-mode-btn ${mode === 'off' ? 'active' : ''}" style="${modeBtnStyle(mode === 'off')}">OFF</button>
            </div>
            <div style="font-size:8.5px;color:#8b8fa3;margin-top:7px;line-height:1.45;">Afeta apenas <b style="color:#c7cad6;">módulos secret</b>. Não bloqueia o hub.</div>`
        });
        colSide.appendChild(sec('Módulos secret', ICON.zap, modoContent));

        // ═══ SIDEBAR — Blacklist ═══
        const blkContent = el('div', {
            html: `
            <div style="display:flex;gap:5px;margin-bottom:7px;">
                <button id="blkAdd" class="adm-btn" style="flex:1;padding:6px;font-size:9px;font-weight:700;
                    background:rgba(251,113,133,.1);border:1px solid rgba(251,113,133,.32);color:#fca5b1;">${ICON.shield}<span>Bloquear</span></button>
                <button id="blkRem" class="adm-btn" style="flex:1;padding:6px;font-size:9px;font-weight:700;
                    background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.32);color:#a7f3d0;">${ICON.zap}<span>Liberar</span></button>
            </div>
            <div id="blkList" style="display:flex;flex-direction:column;gap:3px;max-height:100px;overflow-y:auto;"></div>`
        });
        colSide.appendChild(sec('Blacklist local', ICON.shield, blkContent));

        // ═══ SIDEBAR — Push-to-talk ═══
        const pttContent = el('div', {
            html: `
            <div class="adm-row"><span class="adm-row-label">Tecla</span>
                <span class="adm-row-val"><span class="adm-ptt-chip" id="pttKey">${_pttLabel(_pttKey)}</span></span>
            </div>
            <div class="adm-row"><span class="adm-row-label">Estado</span>
                <span class="adm-row-val"><span class="adm-ptt-state idle" id="pttState">—</span></span>
            </div>
            <div style="font-size:8.5px;color:#8b8fa3;margin-top:7px;line-height:1.5;">
                Segure a tecla para falar. Clique no chip para trocar a tecla — depois pressione a nova.
                <b style="color:#c7cad6;">Esc</b> cancela a captura.
            </div>`
        });
        colSide.appendChild(sec('Push-to-talk', ICON.mic, pttContent));

        _pttButtonEl = pttContent.querySelector('#pttKey');
        _pttStatusEl = pttContent.querySelector('#pttState');
        _bindHover([_pttButtonEl], signal);
        _pttButtonEl.addEventListener('click', () => {
            _pttCapturing = true;
            _pttRefreshUI();
        }, { signal });
        _pttRefreshUI();

        // ═══ SIDEBAR — Ações ═══
        const acoesContent = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:5px;' });
        [
            { id: 'reload',   icon: ICON.refresh, label: 'Manifesto',   color: '#22d3ee' },
            { id: 'killMod',  icon: ICON.stop,    label: 'Desativar',   color: '#a78bfa' },
            { id: 'clean',    icon: ICON.broom,   label: 'Caches',      color: '#a78bfa' },
            { id: 'ttlSweep', icon: ICON.broom,   label: 'Limpar TTL',  color: '#fbbf24' },
            { id: 'micStop',  icon: ICON.stop,    label: 'Parar mics',  color: '#fb7185' },
            { id: 'rePage',   icon: ICON.reload,  label: 'Recarregar',  color: '#fb7185' }
        ].forEach(a => {
            acoesContent.appendChild(el('button', {
                id: a.id, class: 'adm-btn',
                style: `padding:6px;font-size:9px;font-weight:700;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:${a.color};`,
                html: `${a.icon}<span>${a.label}</span>`
            }));
        });
        colSide.appendChild(sec('Ações', ICON.refresh, acoesContent));

        // ═══ SIDEBAR — Sessão admin ═══
        const adminContent = el('div', {
            html: `
            <button id="logout" class="adm-btn" style="width:100%;padding:7px;font-size:9px;font-weight:700;
                background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#c7cad6;margin-bottom:5px;">${ICON.exit}<span>Sair</span></button>
            <button id="forget" class="adm-btn" style="width:100%;padding:7px;font-size:9px;font-weight:700;
                background:rgba(251,113,133,.1);border:1px solid rgba(251,113,133,.32);color:#fca5b1;">${ICON.trash}<span>Esquecer device</span></button>`
        });
        colSide.appendChild(sec('Sessão admin', ICON.user, adminContent));

        wrap.appendChild(hdr); wrap.appendChild(body); wrap.appendChild(foot);
        _root.appendChild(wrap);

        _bindHover(wrap.querySelectorAll('.adm-btn, .adm-mode-btn, .adm-close'), signal);

        // interação do admin reinicia o poll adaptativo para modo rápido
        ['mousemove', 'keydown', 'scroll', 'click'].forEach(ev =>
            wrap.addEventListener(ev, _bumpPollInteracao, { signal, passive: true })
        );

        hdr.querySelector('#close').addEventListener('click', _killPanel, { signal });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') _killPanel(); }, { signal });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && _panelOpen) { _bumpPollInteracao(); _pollSessoes(); }
        }, { signal });

        window.addEventListener('sang:player-updated', () => {
            _lastSig = '';
            _renderSessoes?.();
            _refreshLocalName();
        }, { signal });

        (function tick() {
            const now = new Date();
            const clockEl = foot.querySelector('#clock');
            if (clockEl) clockEl.textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        })();
        _footTimer = setInterval(() => {
            const now = new Date();
            const clockEl = wrap.querySelector('#clock');
            if (clockEl) clockEl.textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        }, 30000);

        const devCopyEl = statusContent.querySelector('#devCopy');
        _bindHover([devCopyEl], signal);
        devCopyEl.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(bridge.deviceId || ''); _toast('Device ID copiado', 'ok'); }
            catch (e) { _toast('Falha ao copiar', 'err'); }
        }, { signal });

        const localNameEl = statusContent.querySelector('#localName');
        function _refreshLocalName() {
            if (!localNameEl) return;
            const n = bridge.player && bridge.player.name ? bridge.player.name : '';
            localNameEl.innerHTML = n ? escapeText(n) : '<span style="color:#6b7280;">—</span>';
        }
        _refreshLocalName();

        const micCountEl = statusContent.querySelector('#micCount');
        function _refreshMicCount() {
            if (!micCountEl) return;
            const n = _micCalls.size;
            micCountEl.textContent = n === 0 ? '0' : String(n);
            micCountEl.style.color = n > 0 ? '#a7f3d0' : '';
        }
        _refreshMicCount();

        const readsEl = statusContent.querySelector('#readsToday');
        function _refreshReads() {
            if (!readsEl) return;
            const n = bridge.debug?.readsToday?.() || 0;
            readsEl.textContent = n.toLocaleString('pt-BR');
            readsEl.style.color = n > 20000 ? '#fca5b1' : n > 10000 ? '#fbbf24' : '#a7f3d0';
        }
        _refreshReads();

        const leaderEl = statusContent.querySelector('#leaderInfo');
        function _refreshLeader() {
            if (!leaderEl) return;
            const l = !!bridge.leader?.isLeader;
            leaderEl.innerHTML = `<span class="adm-badge ${l ? 'ok' : 'neutral'}">${l ? 'Sim' : 'Não'}</span>`;
        }
        _refreshLeader();

        // ═══ MODO SECRET ═══
        modoContent.querySelectorAll('button[data-mode]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await bridge.gate.setMode(btn.dataset.mode);
                _toast('Modo: ' + btn.dataset.mode.toUpperCase(), 'ok');
                try { bridge.refreshManifest(true); } catch (e) {}
                modoContent.querySelectorAll('button[data-mode]').forEach(b => {
                    const on = b.dataset.mode === btn.dataset.mode;
                    b.classList.toggle('active', on);
                    b.style.cssText += modeBtnStyle(on);
                });
            }, { signal });
        });

        // ═══ BLACKLIST ═══
        const fp = bridge.gate.fp;
        function _renderBlkList() {
            const listEl = blkContent.querySelector('#blkList');
            const fixos = bridge.blk.fixed(), extras = bridge.blk.extra();
            if (!extras.length && !fixos.length) {
                listEl.innerHTML = '<div style="padding:6px;text-align:center;font-size:8.5px;color:#5b5f70;">Vazia.</div>';
                return;
            }
            const parts = [];
            fixos.forEach(h => parts.push(`<div class="adm-blk-line fixed"><span class="adm-blk-hash">${shortHash(h, 8, 5)}</span>
                <span style="font-size:7px;padding:1px 5px;border-radius:4px;background:rgba(139,143,163,.16);color:#8b8fa3;font-weight:800;">FIXO</span></div>`));
            extras.forEach((h, i) => parts.push(`<div class="adm-blk-line"><span class="adm-blk-hash">${shortHash(h, 8, 5)}</span>
                <span data-rm="${i}" class="adm-blk-rm" title="Remover">✕</span></div>`));
            listEl.innerHTML = parts.join('');
            _bindHover(listEl.querySelectorAll('.adm-blk-rm'), signal);
            listEl.querySelectorAll('[data-rm]').forEach(node => node.addEventListener('click', async () => {
                await bridge.blk.remove(bridge.blk.extra()[parseInt(node.dataset.rm, 10)]);
                _renderBlkList();
            }, { signal }));
        }
        _renderBlkList();
        blkContent.querySelector('#blkAdd').addEventListener('click', async () => {
            if (!fp) return _toast('Fingerprint não calculado', 'err');
            if (bridge.blk.extra().includes(fp) || bridge.blk.fixed().includes(fp)) return _toast('Já está na lista', 'err');
            await bridge.blk.add(fp); _renderBlkList(); _toast('Fingerprint bloqueado', 'ok');
        }, { signal });
        blkContent.querySelector('#blkRem').addEventListener('click', async () => {
            if (!fp) return _toast('Fingerprint não calculado', 'err');
            if (!bridge.blk.extra().includes(fp)) return _toast(bridge.blk.fixed().includes(fp) ? 'Na lista fixa' : 'Não está na lista', 'err');
            await bridge.blk.remove(fp); _renderBlkList(); _toast('Fingerprint liberado', 'ok');
        }, { signal });

        // ═══ SESSÕES ═══
        const listEl = sessContent.querySelector('#sessList');
        const searchWrap = sessContent.querySelector('#searchWrap');
        const cOnline = sessSec.querySelector('#cOn');
        const cBlocked = sessSec.querySelector('#cBl');

        if (searchWrap) {
            searchWrap.innerHTML = `<input id="search" class="adm-search" type="text" placeholder="Buscar por nome ou device ID…" autocomplete="off" spellcheck="false" />`;
            const searchInput = searchWrap.querySelector('#search');
            searchInput.addEventListener('input', () => {
                _searchQuery = searchInput.value.trim().toLowerCase();
                _lastSig = ''; _renderSessoes?.();
            }, { signal });
        }

        function renderRow(s, idx, now) {
            const ago = now - (s.lastSeen || 0);
            const online = ago < SESSAO_ONLINE_MS;
            const bloq = s.blocked === true;
            const euMesmo = s.id === bridge.deviceId;
            const hubV = s.hubVersion || '?';
            const vCls = hubV === bridge.HUB_VERSION ? 'current' : 'outdated';
            const tempo = online ? 'ativa ' + fmtDur(now - (s.sessionStart || s.lastSeen || now)) : 'há ' + fmtAtras(ago);
            const expanded = _expandedRows.has(s.id);

            const micCall = _micCalls.get(s.id);
            const micStatus = micCall ? micCall.status : null;
            const micLive = micStatus === 'live';
            const micConnecting = micStatus === 'connecting';
            const micTalk = micCall && _pttTalking;
            const micTitle = micLive ? 'Transmitindo microfone — clique para parar'
                            : micConnecting ? 'Conectando… — clique para cancelar'
                            : 'Enviar microfone para esta sessão';

            const localPlayer = euMesmo && bridge.player ? bridge.player : null;
            const displayName = s.name || (localPlayer && localPlayer.name) || 'Sem nome';
            const displayMission = s.mission || (localPlayer && localPlayer.mission) || '';

            const micBtn = (online && !euMesmo)
                ? `<button class="adm-mic-btn ${micTalk ? 'talk' : (micLive ? 'live' : (micConnecting ? 'connecting' : ''))}"
                          data-mic-id="${escapeAttr(s.id)}"
                          data-mic-name="${escapeAttr(displayName)}"
                          title="${escapeAttr(micTitle)}">${ICON.mic}</button>`
                : '';

            return `<div class="adm-sess-item ${euMesmo ? 'self' : ''} ${expanded ? 'expanded' : ''} ${micLive ? 'mic-live' : ''}" data-sess-id="${s.id}" style="animation-delay:${Math.min(idx * 16, 220)}ms;">
                <div class="adm-sess-head" data-head>
                    <span class="adm-dot ${online ? 'live' : 'offline'}" data-dot title="${online ? 'Online' : 'Offline'}"></span>
                    <span class="adm-sess-name" title="${escapeText(displayName)}">${escapeText(displayName)}${euMesmo ? ' <span style="color:#a78bfa">(você)</span>' : ''}</span>
                    <span class="adm-sess-meta" data-meta>${shortHash(s.id, 7, 4)} · ${tempo}</span>
                    <span class="adm-sess-version ${vCls}">v${escapeText(hubV)}</span>
                    <span class="adm-switch-wrap">
                        ${micBtn}
                        <label class="adm-switch" title="${bloq ? 'Bloqueado — clique para liberar' : 'Livre — clique para bloquear'}">
                            <input type="checkbox" ${bloq ? 'checked' : ''} data-toggle-id="${s.id}" data-name="${escapeAttr(displayName)}" />
                            <span class="adm-switch-track"></span>
                        </label>
                        ${!bloq ? `<button class="adm-temp-btn" data-temp-id="${s.id}" data-temp-name="${escapeAttr(displayName)}" title="Bloquear temporariamente">⏱</button>` : ''}
                    </span>
                </div>
                ${expanded ? `<div class="adm-sess-detail">
                    <div class="adm-sess-detail-row"><span>deviceId</span><span title="${escapeText(s.id)}">${escapeText(s.id)}</span></div>
                    ${s.fingerprint ? `<div class="adm-sess-detail-row"><span>fingerprint</span><span title="${escapeText(s.fingerprint)}">${shortHash(s.fingerprint, 12, 6)}</span></div>` : ''}
                    ${s.sessionStart ? `<div class="adm-sess-detail-row"><span>início</span><span>${timestampAbs(s.sessionStart)}</span></div>` : ''}
                    <div class="adm-sess-detail-row"><span>último sinal</span><span data-lastseen>${timestampAbs(s.lastSeen)}</span></div>
                    ${micCall ? `<div class="adm-sess-detail-row"><span>mic</span><span style="color:#a7f3d0;">${micStatus === 'live' ? 'ao vivo' : 'conectando'}</span></div>` : ''}
                    ${s.ua ? `<div class="adm-sess-detail-row"><span>user agent</span><span title="${escapeText(s.ua)}">${escapeText(s.ua.slice(0, 42))}…</span></div>` : ''}
                    ${displayMission ? `<div class="adm-sess-detail-row"><span>missão</span><span title="${escapeText(displayMission)}">${escapeText(displayMission)}</span></div>` : ''}
                    <button class="adm-sess-detail-btn" data-copy-id="${s.id}">Copiar tudo</button>
                </div>` : ''}
            </div>`;
        }

        function recomputarFiltrados() {
            const all = Array.from(_sessionsMap.values());
            const q = _searchQuery;
            const filtrados = q ? all.filter(s => (s.name || '').toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || (s.mission || '').toLowerCase().includes(q)) : all;
            const now = Date.now();
            return { all, filtrados, online: filtrados.filter(s => (now - (s.lastSeen || 0)) < SESSAO_ONLINE_MS), offline: filtrados.filter(s => (now - (s.lastSeen || 0)) >= SESSAO_ONLINE_MS) };
        }
        function _renderCounters(all) {
            const now = Date.now();
            cOnline.textContent = all.filter(s => (now - (s.lastSeen || 0)) < SESSAO_ONLINE_MS).length;
            cBlocked.textContent = all.filter(s => s.blocked === true).length;
        }
        function _updateOwnSessionBadge() {
            const eu = _sessionsMap.get(bridge.deviceId);
            const suaEl = statusContent.querySelector('#suaSessao');
            if (!suaEl) return;
            suaEl.innerHTML = !eu ? `<span class="adm-badge neutral">sem registro</span>`
                : eu.blocked === true ? `<span class="adm-badge bad">Bloqueada</span>` : `<span class="adm-badge ok">Livre</span>`;
        }

        _tickDisplay = function() {
            if (!listEl) return;
            const now = Date.now();
            listEl.querySelectorAll('.adm-sess-item').forEach(item => {
                const id = item.dataset.sessId;
                const s = _sessionsMap.get(id);
                if (!s) return;
                const ago = now - (s.lastSeen || 0);
                const online = ago < SESSAO_ONLINE_MS;
                const dot = item.querySelector('[data-dot]');
                if (dot) {
                    dot.className = 'adm-dot ' + (online ? 'live' : 'offline');
                    dot.title = online ? 'Online' : 'Offline';
                }
                const meta = item.querySelector('[data-meta]');
                if (meta) {
                    const tempo = online ? 'ativa ' + fmtDur(now - (s.sessionStart || s.lastSeen || now)) : 'há ' + fmtAtras(ago);
                    meta.textContent = shortHash(s.id, 7, 4) + ' · ' + tempo;
                }
                if (item.classList.contains('expanded')) {
                    const ls = item.querySelector('[data-lastseen]');
                    if (ls) ls.textContent = timestampAbs(s.lastSeen);
                }
            });

            const { online, offline } = recomputarFiltrados();
            listEl.querySelectorAll('[data-group-count]').forEach(elc => {
                const kind = elc.dataset.groupCount;
                elc.textContent = kind === 'online' ? online.length : offline.length;
            });

            _renderCounters(Array.from(_sessionsMap.values()));
            _updateOwnSessionBadge();
            _pttRefreshUI();
        };

        _renderSessoes = function (skipRebuild) {
            if (!listEl) return;
            if (skipRebuild) { _tickDisplay?.(); return; }

            const { all, filtrados, online, offline } = recomputarFiltrados();
            _renderCounters(all);
            _updateOwnSessionBadge();
            _refreshMicCount();
            _refreshReads();
            _refreshLeader();

            if (searchWrap) {
                if (all.length > 5) searchWrap.style.display = '';
                else { searchWrap.style.display = 'none'; if (_searchQuery) { _searchQuery = ''; const si = searchWrap.querySelector('#search'); if (si) si.value = ''; } }
            }

            if (!filtrados.length) {
                listEl.innerHTML = `<div style="padding:16px;text-align:center;font-size:9.5px;color:#5b5f70;">
                    ${_searchQuery ? 'Nada encontrado.' : (all.length ? 'Nenhuma sessão com filtro.' : 'Nenhuma sessão registrada.')}</div>`;
                return;
            }

            const now = Date.now();
            let html = '', idx = 0;
            if (online.length) {
                html += `<div class="adm-sess-group">Online · <span data-group-count="online">${online.length}</span></div>`;
                html += online.map(s => renderRow(s, idx++, now)).join('');
            }
            if (offline.length) {
                const showOffline = _offlineExpanded || offline.length <= 5;
                html += `<div class="adm-sess-group clickable" data-toggle-offline="1"><span>Offline · <span data-group-count="offline">${offline.length}</span></span><span style="font-size:10px;">${showOffline ? '▾' : '▸'}</span></div>`;
                if (showOffline) html += offline.map(s => renderRow(s, idx++, now)).join('');
            }
            listEl.innerHTML = html;
            _bindHover(listEl.querySelectorAll('.adm-sess-group.clickable, .adm-sess-item [data-head], .adm-switch, .adm-temp-btn, .adm-mic-btn, .adm-sess-detail-btn'), signal);

            const grp = listEl.querySelector('[data-toggle-offline]');
            if (grp) grp.addEventListener('click', () => { _offlineExpanded = !_offlineExpanded; _lastSig = ''; _renderSessoes(); }, { signal });

            listEl.querySelectorAll('.adm-sess-item').forEach(item => {
                const head = item.querySelector('[data-head]');
                if (!head) return;
                head.addEventListener('click', (e) => {
                    if (e.target.closest('.adm-switch') || e.target.closest('.adm-temp-btn') || e.target.closest('.adm-mic-btn')) return;
                    const id = item.dataset.sessId;
                    _expandedRows.has(id) ? _expandedRows.delete(id) : _expandedRows.add(id);
                    _lastSig = ''; _renderSessoes();
                }, { signal });
            });

            listEl.querySelectorAll('input[data-toggle-id]').forEach(inp => {
                inp.addEventListener('change', async (e) => {
                    e.stopPropagation();
                    const alvoId = inp.dataset.toggleId, alvoNome = inp.dataset.name || 'Sessão';
                    const novo = inp.checked, euMesmo = alvoId === bridge.deviceId;
                    if (novo && euMesmo) {
                        inp.checked = false;
                        const ok = await _confirmarAutoBloqueio();
                        if (!ok) return;
                        inp.checked = true;
                    }
                    const sw = inp.closest('.adm-switch');
                    sw.classList.add('busy');
                    try {
                        await _aplicarBloqueio(alvoId, novo, 0);
                        if (novo) {
                            _toast(`${alvoNome} bloqueado`, 'ok', async () => {
                                try { await _aplicarBloqueio(alvoId, false, 0); _toast('Bloqueio desfeito', 'ok'); }
                                catch (err) { _toast('Falha ao desfazer', 'err'); }
                            });
                        } else _toast(`${alvoNome} liberado`, 'ok');
                    } catch (err) { _toast('Falha ao atualizar', 'err'); inp.checked = !novo; sw.classList.remove('busy'); }
                }, { signal });
            });

            listEl.querySelectorAll('[data-temp-id]').forEach(btn => btn.addEventListener('click', (e) => {
                e.stopPropagation(); _abrirTempMenu(btn, btn.dataset.tempId, btn.dataset.tempName);
            }, { signal }));

            listEl.querySelectorAll('[data-mic-id]').forEach(btn => btn.addEventListener('click', (e) => {
                e.stopPropagation();
                _micToggle(btn.dataset.micId, btn.dataset.micName);
            }, { signal }));

            listEl.querySelectorAll('[data-copy-id]').forEach(btn => btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const s = _sessionsMap.get(btn.dataset.copyId);
                if (!s) return;
                const euMesmo = s.id === bridge.deviceId;
                const localPlayer = euMesmo && bridge.player ? bridge.player : null;
                const nm = s.name || (localPlayer && localPlayer.name) || '';
                const ms = s.mission || (localPlayer && localPlayer.mission) || '';
                const txt = [
                    `deviceId: ${s.id}`, `nome: ${nm}`, `missão: ${ms}`,
                    `fingerprint: ${s.fingerprint || ''}`, `hub: v${s.hubVersion || '?'}`,
                    `sessionStart: ${timestampAbs(s.sessionStart)}`, `lastSeen: ${timestampAbs(s.lastSeen)}`,
                    `blocked: ${s.blocked === true}`, `ua: ${s.ua || ''}`
                ].join('\n');
                try { await navigator.clipboard.writeText(txt); _toast('Copiado', 'ok'); } catch (err) { _toast('Falha ao copiar', 'err'); }
            }, { signal }));

            _pttRefreshUI();
        };

        // ═══ AÇÕES ═══
        acoesContent.querySelector('#reload').addEventListener('click', () => {
            try { bridge.refreshManifest(true); _toast('Manifesto recarregado', 'ok'); } catch (e) { _toast('Erro', 'err'); }
        }, { signal });
        acoesContent.querySelector('#killMod').addEventListener('click', () => {
            try {
                let n = 0;
                (bridge.state.manifest.modules || []).forEach(mod => {
                    if (bridge.state.moduleStates[mod.id] === 'loaded') { bridge.deactivateModule(mod); n++; }
                });
                _toast(n + ' módulos desativados', 'ok');
            } catch (e) { _toast('Erro', 'err'); }
        }, { signal });
        acoesContent.querySelector('#clean').addEventListener('click', () => {
            try {
                localStorage.removeItem('sanghub_manifest_cache');
                localStorage.removeItem('sanghub_player_cache');
                _toast('Caches limpos', 'ok');
            } catch (e) { _toast('Erro', 'err'); }
        }, { signal });
        acoesContent.querySelector('#ttlSweep').addEventListener('click', async () => {
            const corte = Date.now() - TTL_DIAS * 24 * 60 * 60 * 1000;
            try {
                const docs = await bridge.firestore.runQuery('sessions', ['lastSeen']);
                let n = 0;
                for (const d of docs) {
                    const id = d.name.split('/').pop();
                    const parsed = bridge.firestore.parseDoc(d);
                    if ((parsed.lastSeen || 0) < corte) {
                        try { await bridge.firestore.request('DELETE', '/sessions/' + id); n++; } catch(_) {}
                    }
                }
                _toast(n + ' sessões antigas removidas', 'ok');
                _pollSessoes();
            } catch(e) { _toast('Falha no sweep', 'err'); }
        }, { signal });
        acoesContent.querySelector('#micStop').addEventListener('click', () => {
            const n = _micCalls.size;
            _micEndAll();
            _renderSessoes?.();
            _toast(n ? n + ' transmissões encerradas' : 'Nenhuma transmissão ativa', n ? 'ok' : 'err');
        }, { signal });
        acoesContent.querySelector('#rePage').addEventListener('click', () => location.reload(), { signal });

        // ═══ ADMIN ═══
        adminContent.querySelector('#logout').addEventListener('click', () => {
            _authed = false; _killPanel(); _toast('Sessão encerrada', 'ok');
        }, { signal });
        adminContent.querySelector('#forget').addEventListener('click', () => {
            _clearToken(); _authed = false; _killPanel(); _toast('Token removido', 'ok');
        }, { signal });

        if (fsOk) { _renderSessoes(); _iniciarPoll(); }
    }

    function _killPanel() {
        _panelOpen = false;
        _pararPoll();
        _fecharConfirm();
        _fecharTempMenu();
        if (_footTimer) { clearInterval(_footTimer); _footTimer = null; }
        if (_scopedAc) { _scopedAc.abort(); _scopedAc = null; }
        if (_panelEl) {
            const p = _panelEl; _panelEl = null;
            p.classList.add('closing');
            setTimeout(() => p.remove(), 320);
        }
        if (_backdropEl) {
            const b = _backdropEl; _backdropEl = null;
            b.classList.add('closing');
            setTimeout(() => b.remove(), 320);
        }
        _renderSessoes = null;
        _tickDisplay = null;
        _pttButtonEl = null;
        _pttStatusEl = null;
    }

    // ═══ OPEN / TOGGLE ═══
    function _open() {
        if (_authed || _hasToken()) { _authed = true; _mountPanel(); }
        else _mountLogin();
    }
    function toggle() {
        _audioCtx();
        if (_panelEl || _modalEl) { _killPanel(); _killModal(); return; }
        _open();
    }

    // ═══ KILL ═══
    function kill() {
        if (dying) return;
        dying = true;
        const steps = [
            ['mic', () => _micEndAll()],
            ['ptt', () => _pttDetach()],
            ['panel', () => _killPanel()],
            ['modal', () => _killModal()],
            ['confirm', () => _fecharConfirm()],
            ['tempMenu', () => _fecharTempMenu()],
            ['host', () => _host?.remove()],
            ['audio', () => { _actx?.close(); _actx = null; }],
            ['global', () => delete window[UID]]
        ];
        for (const [name, step] of steps) {
            try { step(); } catch (e) { console.warn('[admin] kill step ' + name + ' falhou:', e); }
        }
        try { window.dispatchEvent(new CustomEvent('sang:module-close', { detail: { id: 'admin' } })); } catch (e) {}
    }

    // ═══ EXPORT ═══
    window[UID] = { kill, toggle };
})();
