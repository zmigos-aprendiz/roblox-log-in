// hub-rtc.js — Recepção de chamadas de voz via WebRTC + RTDB
(function() {
    'use strict';
    if (window._hubRTC) return;
    const B = window._hubBridge;
    if (!B) { console.warn('[hub-rtc] _hubBridge ausente'); return; }

    const RTDB_URL = B.rtdb.url;
    const MIC_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
    const MIC_RING_MS = 2500;
    const MIC_OFFER_TTL_MS = 60000;
    const deviceId = B.deviceId;

    let _micReady = null;
    const _mic = { es: null, pc: null, iceEs: null, audio: null, offer: null, banner: null, ringTimer: null, active: false };

    function _micSignalUrl(path) { return `${RTDB_URL}/signaling/${deviceId}/${path}.json`; }
    function _micSupported() { return !!(window.RTCPeerConnection && window.EventSource && B.firestore.configured() && deviceId); }

    async function _micStartListener() {
        if (_mic.es || !_micSupported()) { if (!_micSupported()) _micReady = { ok: false, reason: 'unsupported' }; return; }
        const es = new EventSource(_micSignalUrl('offer'));
        _mic.es = es;
        let seen = false;
        const onValue = (raw) => {
            seen = true;
            _micReady = { ok: true };
            try {
                const envelope = JSON.parse(raw);
                const offer = envelope?.data;
                if (!offer || !offer.type) return;

                if (offer.kind === 'phone') {
                    const phoneMounted = !!window._phone;
                    try { window.dispatchEvent(new CustomEvent('sang:phone-incoming', { detail: offer })); } catch(_) {}
                    if (!phoneMounted) {
                        B.phone.registerMissedCall({
                            toDeviceId: deviceId,
                            fromId: offer.fromId, fromNumber: offer.fromNumber,
                            fromName: offer.fromName, fromAvatar: offer.fromAvatar,
                            reason: 'missed', ts: offer.ts || Date.now()
                        }).catch(() => {});
                    }
                    return;
                }
                if (offer.type === 'hangup') {
                    if (_mic.offer && _mic.offer.fromId && offer.fromId === _mic.offer.fromId) _micReject();
                    return;
                }
                if (offer.type !== 'offer' || !offer.sdp) return;
                if (offer.ts && Date.now() - offer.ts > MIC_OFFER_TTL_MS) return;
                _micOnOffer(offer);
            } catch(_) {}
        };
        es.addEventListener('put', (ev) => onValue(ev.data));
        es.addEventListener('patch', (ev) => onValue(ev.data));
        es.onerror = () => { if (!seen) _micReady = { ok: false, reason: 'rtdb' }; };
        setTimeout(() => { if (!seen) _micReady = _micReady || { ok: false, reason: 'timeout' }; }, 6000);
    }

    function _micOnOffer(offer) {
        if (_mic.active) return;
        _mic.offer = offer;
        _micShowBanner(offer);
        _micStartRing();
    }
    function _micStartRing() {
        _micStopRing();
        window._hubSFX?.ring?.();
        _mic.ringTimer = setInterval(() => window._hubSFX?.ring?.(), MIC_RING_MS);
    }
    function _micStopRing() { if (_mic.ringTimer) { clearInterval(_mic.ringTimer); _mic.ringTimer = null; } }

    async function _micAccept() {
        const offer = _mic.offer;
        if (!offer || _mic.active) return;
        _micStopRing();
        _micHideBanner();
        try {
            const pc = new RTCPeerConnection({ iceServers: MIC_ICE });
            _mic.pc = pc; _mic.active = true;
            pc.ontrack = (ev) => {
                try {
                    const audio = new Audio();
                    audio.srcObject = ev.streams[0];
                    audio.autoplay = true; audio.volume = 1.0;
                    audio.play().catch(() => {
                        try { B.toast('Clique na página para liberar o áudio', 'warn'); } catch(_) {}
                    });
                    _mic.audio = audio;
                } catch(_) {}
                window._hubSFX?.micOn?.();
            };
            pc.onicecandidate = async (ev) => {
                if (!ev.candidate) return;
                try {
                    await fetch(_micSignalUrl('ice/hub'), {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(ev.candidate.toJSON())
                    });
                } catch(_) {}
            };
            pc.onconnectionstatechange = () => {
                const s = pc.connectionState;
                if (s === 'failed' || s === 'closed' || s === 'disconnected') _micStop();
            };
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await fetch(_micSignalUrl('answer'), {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: answer.type, sdp: answer.sdp, ts: Date.now() })
            });
            const iceEs = new EventSource(_micSignalUrl('ice/admin'));
            _mic.iceEs = iceEs;
            const onIce = (raw) => {
                try {
                    const env = JSON.parse(raw);
                    const cand = env?.data;
                    if (cand && cand.candidate && _mic.pc) _mic.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                } catch(_) {}
            };
            iceEs.addEventListener('put', (ev) => onIce(ev.data));
            iceEs.addEventListener('patch', (ev) => onIce(ev.data));
        } catch(e) {
            console.error('[hub-rtc] Falha ao atender:', e);
            _micStop();
        }
    }
    function _micReject() {
        _micStopRing(); _micHideBanner(); _mic.offer = null;
        try {
            fetch(_micSignalUrl('answer'), {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'reject', ts: Date.now() })
            }).catch(() => {});
        } catch(_) {}
    }
    function _micStop() {
        _micStopRing(); _micHideBanner();
        if (_mic.pc) { try { _mic.pc.close(); } catch(_) {} _mic.pc = null; }
        if (_mic.iceEs) { try { _mic.iceEs.close(); } catch(_) {} _mic.iceEs = null; }
        if (_mic.audio) { try { _mic.audio.pause(); _mic.audio.srcObject = null; } catch(_) {} _mic.audio = null; }
        if (_mic.active) window._hubSFX?.micOff?.();
        _mic.active = false; _mic.offer = null;
    }

    function _micShowBanner(offer) {
        _micHideBanner();
        // reaproveita keyframes injetados por hub.js (`_ensureBlockStyle` já foi chamado no boot)
        const shell = document.createElement('div');
        shell.id = '_hubMicBanner';
        shell.setAttribute('data-hub', '1');
        shell.setAttribute('data-sang-ui', '');
        shell.style.cssText = `position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;pointer-events:auto;animation:_hubMicShellIn .35s cubic-bezier(0.16,1,0.3,1);transform-style:flat;`;
        const inner = document.createElement('div');
        inner.style.cssText = `display:flex;align-items:center;gap:14px;padding:14px 18px 14px 14px;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(175deg,rgba(16,22,30,0.97),rgba(8,10,16,0.99));border:1px solid rgba(34,211,238,0.42);box-shadow:0 22px 60px rgba(0,0,0,0.75),0 0 60px rgba(34,211,238,0.22);backdrop-filter:blur(14px) saturate(140%);max-width:420px;animation:_hubMicVibrate ${MIC_RING_MS}ms cubic-bezier(.36,.07,.19,.97) infinite;will-change:transform;`;
        const esc = B.util.escapeHtml;
        inner.innerHTML = `
            <span style="flex-shrink:0;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:rgba(34,211,238,0.14);border:1px solid rgba(34,211,238,0.4);animation:_hbMicPulse 1.8s ease-in-out infinite;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </span>
            <div style="flex:1;min-width:0;">
                <div style="font-size:12.5px;font-weight:800;color:#fff;letter-spacing:.02em;">Chamada de voz</div>
                <div style="font-size:10px;color:#9ca3af;margin-top:3px;line-height:1.4;"><b style="color:#67e8f9;">${esc(offer.fromName || 'Administrador')}</b> quer falar com você.</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
                <button id="_hubMicReject" style="cursor:pointer;font-family:inherit;padding:8px 14px;border-radius:9px;font-size:10.5px;font-weight:700;background:rgba(251,113,133,0.12);border:1px solid rgba(251,113,133,0.36);color:#fca5b1;letter-spacing:.03em;">Recusar</button>
                <button id="_hubMicAccept" style="cursor:pointer;font-family:inherit;padding:8px 16px;border-radius:9px;font-size:10.5px;font-weight:800;background:linear-gradient(120deg,#22d3ee,#a78bfa);border:none;color:#0b0b10;letter-spacing:.03em;">Atender</button>
            </div>`;
        shell.appendChild(inner);
        document.body.appendChild(shell);
        _mic.banner = shell;
        shell.querySelector('#_hubMicAccept').addEventListener('click', () => _micAccept());
        shell.querySelector('#_hubMicReject').addEventListener('click', () => _micReject());
    }
    function _micHideBanner() { if (_mic.banner) { try { _mic.banner.remove(); } catch(_) {} _mic.banner = null; } }

    // ── kill ──
    function kill() {
        _micStop();
        if (_mic.es) { try { _mic.es.close(); } catch(_) {} _mic.es = null; }
        delete window._hubRTC;
    }

    // ── Export ──
    window._hubRTC = { kill, accept: _micAccept, reject: _micReject, stop: _micStop };
    B.mic = {
        available: () => !!(_micReady && _micReady.ok),
        state: () => _mic.active ? 'connected' : (_mic.banner ? 'incoming' : 'idle'),
        currentCaller: () => _mic.offer?.fromName || null,
        accept: _micAccept, reject: _micReject, stop: _micStop
    };

    // Auto-inicia
    _micStartListener().catch(e => console.warn('[hub-rtc] listener falhou:', e));
})();
