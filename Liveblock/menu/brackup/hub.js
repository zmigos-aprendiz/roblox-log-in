// ==UserScript==
// @name         Sang Hub
// @namespace    http://tampermonkey.net/
// @version      1.4.3
// @description  Gerenciador de módulos
// @author       Sang
// @match        *://*.habblive.in/bigclient*
// @match        *://*.habblet.city/bigclient*
// @match        *://*.habblive.in/me*
// @match        *://*.habblet.city/me*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/hub2.js
// @downloadURL  https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/hub2.js
// ==/UserScript==

(function() {
    'use strict';

    // ═══ CONTEXTO ═══
    const IS_CORE = /^https?:\/\/(?:[^/]*\.)?(?:habblive\.in|habblet\.city)\/(?:bigclient|me)/i.test(location.href);

    if (IS_CORE && /\/me(\/|$|\?)/.test(location.pathname)) {
        function buildHeadshotUrl(walkgifUrl) {
            try {
                const u = new URL(walkgifUrl);
                u.pathname = u.pathname.replace('/walkgif', '/avatarimage');
                u.searchParams.set('headonly', '1');
                u.searchParams.set('size', 'm');
                u.searchParams.set('direction', '2');
                u.searchParams.set('head_direction', '3');
                return u.toString();
            } catch(e) { return walkgifUrl; }
        }
        function captureFromMePage() {
            const nameEl = document.querySelector('#new-personal-info > div:nth-child(2) > a > div > img');
            const mottoEl = document.querySelector('#motto-container > div > p > input[type=text]');
            const name = nameEl ? nameEl.getAttribute('alt') || '' : '';
            const mission = mottoEl ? mottoEl.value.trim() : '';
            const rawAvatarUrl = nameEl ? nameEl.getAttribute('src') || '' : '';
            const avatarUrl = rawAvatarUrl ? buildHeadshotUrl(rawAvatarUrl) : '';
            if (!name) return false;
            try {
                localStorage.setItem('sanghub_player_cache', JSON.stringify({ name, mission, avatarUrl, capturedAt: Date.now() }));
            } catch(e) {}
            return true;
        }
        let attempts = 0;
        const captureInterval = setInterval(() => {
            attempts++;
            const ok = captureFromMePage();
            if (ok || attempts >= 20) clearInterval(captureInterval);
        }, 500);
        return;
    }

    // ═══ GATE ═══
    const _blk = ['fa58cccd9de60c7a30726b2c23670a5747d4b5e684a935fae5954548873f1031'];
    const _blkExtraKey = 'sanghub_blk_extra';
    const _ovr = 'sanghub_p2';
    const DEVICE_ID_KEY = 'sanghub_device_id';
    const ADMIN_TOKEN_KEY = 'sanghub_admin_token';
    const ADMIN_TTL = 30 * 24 * 60 * 60 * 1000;

    let _secretOn = true;
    let _blocked = false;
    let _fp = '';
    let _deviceId = '';
    let _antiLag = false;
    try { _antiLag = localStorage.getItem('sanghub_antilag') === '1'; } catch(e) {}

    function _stableUA() {
        return navigator.userAgent.replace(/\d+\.\d+\.\d+\.\d+/g, '');
    }
    async function _calc() {
        const parts = [
            _stableUA(),
            navigator.language.split('-')[0],
            navigator.hardwareConcurrency,
            screen.width + 'x' + screen.height,
            new Date().getTimezoneOffset(),
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            navigator.platform
        ].join('|');
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    function _getDeviceId() {
        try {
            let id = localStorage.getItem(DEVICE_ID_KEY);
            if (!id) {
                id = crypto.randomUUID ? crypto.randomUUID() :
                    Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
                localStorage.setItem(DEVICE_ID_KEY, id);
            }
            return id;
        } catch(e) { return 'unknown-' + Date.now(); }
    }
    function _getBlkExtra() {
        try { const a = JSON.parse(localStorage.getItem(_blkExtraKey) || '[]'); return Array.isArray(a) ? a : []; }
        catch(e) { return []; }
    }
    function _setBlkExtra(arr) {
        try { localStorage.setItem(_blkExtraKey, JSON.stringify(arr)); } catch(e) {}
    }
    function _fullBlk() { return _blk.concat(_getBlkExtra()); }

    function _adminUnlocked() {
        try {
            const raw = localStorage.getItem(ADMIN_TOKEN_KEY);
            if (!raw) return false;
            const o = JSON.parse(raw);
            if (!o || !o.t) return false;
            return (Date.now() - o.t) < ADMIN_TTL;
        } catch(e) { return false; }
    }

    async function _gate() {
        try {
            _fp = await _calc();
            if (!_deviceId) _deviceId = _getDeviceId();
            const o = localStorage.getItem(_ovr);
            if (o === '0') _secretOn = false;
            else if (o === '1') _secretOn = true;
            else _secretOn = !_fullBlk().includes(_fp);
            _blocked = await _verificarBloqueioRemoto();
        } catch(e) {
            _secretOn = true;
            _blocked = false;
        }
    }

    // ═══ LOG ═══
    const HLOG  = (...a) => console.log('🔶 [Hub]', ...a);
    const HWARN = (...a) => console.warn('🔶 [Hub]', ...a);
    const HERR  = (...a) => console.error('🔶 [Hub]', ...a);

    // ═══ CONSTANTES ═══
    const HUB_VERSION = "1.4.2";
    const HUB_UPDATE_URL = "https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/hub2.js";
    const MANIFEST_URL = "https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/manifest.json";
    const PHONE_FIREBASE_URL = "https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/phone-firebase.js";
    const UPDATE_INTERVAL_MS = 3 * 60 * 1000;
    const MANIFEST_CACHE_MS = 2 * 60 * 1000;
    const FETCH_TIMEOUT_MS = 5000;
    const FETCH_RETRIES = 2;
    const SHORTCUT_KEY = 'h';
    const SHORTCUT_LABEL = 'Alt+Shift+H';
    const GIF_PLAY_MS = 2000;
    const PLAYTIME_KEY = 'sanghub_playtime_total_ms';
    const PLAYTIME_FLUSH_MS = 60 * 1000;
    const CLOCK_TICK_MS = 1000;
    const PLAYER_CACHE_KEY = 'sanghub_player_cache';
    const VOICE_KEY = 'sanghub_voice_enabled';
    const VOICE_COOLDOWN_MS = 1200;
    const SFX_MUTED_KEY = 'sanghub_sfx_muted';
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    const RTDB_URL = 'https://sanghub-ecf46-default-rtdb.firebaseio.com';
    const MIC_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
    const MIC_OFFER_TTL_MS = 60000;
    const MIC_RING_MS = 2500;
    const ANTILAG_KEY = 'sanghub_antilag';
    const COL_MISSED = 'phone_missed';

    // ═══ FIRESTORE ═══
    const FIREBASE_PROJECT_ID = 'sanghub-ecf46';
    const FIREBASE_API_KEY    = 'AIzaSyCffa6tw3mSzTJtq_u2AVz9w1PRnTAGJyI';
    const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const FS_AUTH_KEY = 'sanghub_fs_auth';
    const HEARTBEAT_MS = 2 * 60 * 1000;
    const BLOCK_POLL_MS = 60 * 1000;

    function fsConfigured() {
        return FIREBASE_PROJECT_ID !== 'SEU_PROJECT_ID' && FIREBASE_API_KEY !== 'SUA_WEB_API_KEY';
    }
    function fsValue(v) {
        if (v === null || v === undefined) return { nullValue: null };
        if (typeof v === 'boolean') return { booleanValue: v };
        if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
        return { stringValue: String(v) };
    }
    function fsParseDoc(doc) {
        const out = {};
        const fields = doc?.fields || {};
        for (const k in fields) {
            const v = fields[k];
            const t = Object.keys(v)[0];
            out[k] = t === 'integerValue' ? parseInt(v[t], 10) : v[t];
        }
        return out;
    }

    let _fsAuth = null;
    function _fsLoadAuth() {
        try { return JSON.parse(localStorage.getItem(FS_AUTH_KEY) || 'null'); } catch(e) { return null; }
    }
    function _fsSaveAuth(a) {
        try { localStorage.setItem(FS_AUTH_KEY, JSON.stringify(a)); } catch(e) {}
    }
    async function _fsSignUp() {
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ returnSecureToken: true })
        });
        if (!res.ok) throw new Error('auth HTTP ' + res.status);
        const d = await res.json();
        const ttl = Number(d.expiresIn) || 3600;
        return { idToken: d.idToken, refreshToken: d.refreshToken, expiresAt: Date.now() + (ttl * 1000) - 60000 };
    }
    async function _fsRefresh(refreshToken) {
        const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken)
        });
        if (!res.ok) throw new Error('refresh HTTP ' + res.status);
        const d = await res.json();
        const ttl = Number(d.expires_in) || 3600;
        return { idToken: d.access_token, refreshToken: d.refresh_token, expiresAt: Date.now() + (ttl * 1000) - 60000 };
    }
    async function _fsGetToken() {
        _fsAuth = _fsAuth || _fsLoadAuth();
        if (_fsAuth && _fsAuth.expiresAt > Date.now()) return _fsAuth.idToken;
        try {
            _fsAuth = (_fsAuth && _fsAuth.refreshToken) ? await _fsRefresh(_fsAuth.refreshToken) : await _fsSignUp();
        } catch(e) {
            _fsAuth = await _fsSignUp();
        }
        _fsSaveAuth(_fsAuth);
        return _fsAuth.idToken;
    }
    async function fsRequest(method, path, body, extraQuery) {
        if (!fsConfigured()) throw new Error('Firestore não configurado');
        const token = await _fsGetToken();
        const url = FS_BASE + path + (extraQuery ? '?' + extraQuery : '');
        const res = await fetch(url, {
            method,
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!res.ok) throw new Error('FS HTTP ' + res.status + ' (' + path + ')');
        if (res.status === 204) return null;
        return res.json();
    }
    async function _verificarBloqueioRemoto() {
        if (!fsConfigured() || !_deviceId) return false;
        try {
            const doc = await fsRequest('GET', '/sessions/' + _deviceId);
            const s = fsParseDoc(doc);
            if (s.blocked !== true) return false;
            if (s.blockedUntil && Date.now() > s.blockedUntil) {
                try {
                    await fsRequest('PATCH', '/sessions/' + _deviceId, {
                        fields: { blocked: fsValue(false), blockedUntil: fsValue(0) }
                    }, 'updateMask.fieldPaths=blocked&updateMask.fieldPaths=blockedUntil');
                } catch(e) {}
                return false;
            }
            return true;
        } catch(e) {
            return false;
        }
    }

    let _heartbeatTimer = null;
    const SESSION_HEARTBEAT_FIELDS = ['name', 'mission', 'hubVersion', 'lastSeen', 'ua'];

    async function _criarOuAtualizarSessao() {
        if (!fsConfigured() || !_deviceId) return;
        const player = loadPlayerCache() || {};
        const now = Date.now();
        const campos = {
            name:         fsValue(player.name || ''),
            mission:      fsValue(player.mission || ''),
            hubVersion:   fsValue(HUB_VERSION),
            lastSeen:     fsValue(now),
            ua:           fsValue(navigator.userAgent.slice(0, 120)),
            sessionStart: fsValue(now),
            blocked:      fsValue(false),
            fingerprint:  fsValue(_fp || '')
        };
        const mask = Object.keys(campos).map(f => 'updateMask.fieldPaths=' + f).join('&');
        try {
            await fsRequest('PATCH', '/sessions/' + _deviceId, { fields: campos }, mask);
        } catch(e) { HWARN('Sessão inicial falhou:', e); }
    }

    async function _enviarHeartbeat() {
        if (!fsConfigured() || !_deviceId) return;
        const player = loadPlayerCache() || {};
        const mask = SESSION_HEARTBEAT_FIELDS.map(f => 'updateMask.fieldPaths=' + f).join('&');
        try {
            await fsRequest('PATCH', '/sessions/' + _deviceId, {
                fields: {
                    name:       fsValue(player.name || ''),
                    mission:    fsValue(player.mission || ''),
                    hubVersion: fsValue(HUB_VERSION),
                    lastSeen:   fsValue(Date.now()),
                    ua:         fsValue(navigator.userAgent.slice(0, 120))
                }
            }, mask);
        } catch(e) { HWARN('Heartbeat falhou:', e); }
    }
    function _iniciarHeartbeat() {
        if (!fsConfigured() || _heartbeatTimer) return;
        _criarOuAtualizarSessao();
        _heartbeatTimer = setInterval(_enviarHeartbeat, HEARTBEAT_MS);
    }

    function _aplicarCacheJogador() {
        try { _enviarHeartbeat(); } catch(e) {}
        try { window.dispatchEvent(new CustomEvent('sang:player-updated', { detail: loadPlayerCache() })); } catch(e) {}
    }

    // ═══ BLOQUEIO — UI ═══
    let _blockStyleInjected = false;
    function _ensureBlockStyle() {
        if (_blockStyleInjected) return;
        _blockStyleInjected = true;
        const st = document.createElement('style');
        st.setAttribute('data-hub-block', '1');
        st.textContent = `
            @keyframes _hbFadeIn{from{opacity:0}to{opacity:1}}
            @keyframes _hbPopIn{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
            @keyframes _hbSlideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}
            @keyframes _hbToastShake{0%,100%{transform:translateX(0)}15%{transform:translateX(-7px)}30%{transform:translateX(6px)}45%{transform:translateX(-5px)}60%{transform:translateX(4px)}75%{transform:translateX(-2px)}90%{transform:translateX(1px)}}
            @keyframes _hbScreenShake{0%,100%{transform:translate(0,0)}8%{transform:translate(-10px,5px)}16%{transform:translate(9px,-6px)}24%{transform:translate(-8px,7px)}32%{transform:translate(7px,-5px)}40%{transform:translate(-6px,4px)}48%{transform:translate(5px,-3px)}56%{transform:translate(-4px,3px)}64%{transform:translate(3px,-2px)}72%{transform:translate(-2px,2px)}80%{transform:translate(2px,-1px)}90%{transform:translate(-1px,1px)}}
            @keyframes _hbMicPulse{0%,100%{transform:translate(-50%,-50%) scale(1);box-shadow:0 0 0 0 rgba(34,211,238,.6)}50%{transform:translate(-50%,-50%) scale(1.02);box-shadow:0 0 0 14px rgba(34,211,238,0)}}
            @keyframes _hubMicShellIn{from{opacity:0;transform:translateX(-50%) translateY(12px) scale(.96)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
            @keyframes _hubMicVibrate{0%{transform:translateX(0)}2%{transform:translateX(-3px)}4%{transform:translateX(3px)}6%{transform:translateX(-3px)}8%{transform:translateX(3px)}10%{transform:translateX(-2px)}12%{transform:translateX(2px)}14%{transform:translateX(-2px)}16%{transform:translateX(2px)}18%{transform:translateX(-1px)}20%{transform:translateX(1px)}22%,100%{transform:translateX(0)}}
        `;
        document.head.appendChild(st);
    }

    let _blockOverlayEl = null;
    function _mostrarBloqueioOverlay() {
        if (_blockOverlayEl) return;
        _ensureBlockStyle();
        const el = document.createElement('div');
        el.id = '_hubBlockOverlay';
        el.setAttribute('data-hub-block', '1');
        el.setAttribute('data-sang-ui', '');
        el.style.cssText = `
            position: fixed; inset: -30px; z-index: 2147483646;
            display: flex; align-items: center; justify-content: center;
            background:
                radial-gradient(circle at 50% 35%, rgba(251,113,133,0.10), transparent 55%),
                radial-gradient(circle at 20% 80%, rgba(167,139,250,0.06), transparent 50%),
                rgba(0,0,0,0.72);
            backdrop-filter: blur(10px);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            animation: _hbFadeIn .3s ease, _hbScreenShake .62s cubic-bezier(.36,.07,.19,.97) .05s;
            will-change: transform;
        `;
        el.innerHTML = `
            <div style="max-width: 380px; padding: 30px 26px; text-align: center;
                border-radius: 18px; border: 1px solid rgba(251,113,133,0.28);
                background: linear-gradient(175deg, rgba(22,16,26,0.96), rgba(10,8,14,0.98));
                box-shadow: 0 30px 80px rgba(0,0,0,0.8), 0 0 80px rgba(251,113,133,0.12);
                animation: _hbPopIn .35s cubic-bezier(0.16,1,0.3,1);">
                <div style="width: 54px; height: 54px; margin: 0 auto 16px;
                    display: flex; align-items: center; justify-content: center;
                    border-radius: 15px; background: rgba(251,113,133,0.12);
                    border: 1px solid rgba(251,113,133,0.35);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fb7185" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        <line x1="9.5" y1="9.5" x2="14.5" y2="14.5"/>
                        <line x1="14.5" y1="9.5" x2="9.5" y2="14.5"/>
                    </svg>
                </div>
                <div style="font-size: 16px; font-weight: 800; color: #fff; letter-spacing: .02em; margin-bottom: 6px;">
                    Dispositivo bloqueado
                </div>
                <div style="font-size: 11.5px; color: #9ca3af; line-height: 1.55; margin-bottom: 18px;">
                    Sua sessão foi bloqueada pelo administrador.<br>O acesso ao hub foi encerrado.
                </div>
                <button id="_hubBlockClose" style="cursor: pointer; font-family: inherit;
                    padding: 9px 22px; border-radius: 9px; font-size: 11px; font-weight: 700;
                    background: rgba(251,113,133,0.12); border: 1px solid rgba(251,113,133,0.35);
                    color: #fca5b1; letter-spacing: .04em; transition: background .15s;">
                    Fechar
                </button>
            </div>
        `;
        document.body.appendChild(el);
        _blockOverlayEl = el;
        el.querySelector('#_hubBlockClose').addEventListener('click', () => { _removerBloqueioOverlay(); });
    }
    function _removerBloqueioOverlay() {
        if (!_blockOverlayEl) return;
        const el = _blockOverlayEl;
        _blockOverlayEl = null;
        try {
            el.style.transition = 'opacity .2s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 220);
        } catch(e) { el.remove(); }
    }

    function _mostrarBloqueioToast() {
        _ensureBlockStyle();
        const el = document.createElement('div');
        el.id = '_hubBlockToast';
        el.setAttribute('data-hub-block', '1');
        el.setAttribute('data-sang-ui', '');
        el.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 2147483646;
            display: flex; align-items: center; gap: 11px;
            padding: 12px 16px; border-radius: 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(175deg, rgba(22,16,26,0.96), rgba(10,8,14,0.98));
            border: 1px solid rgba(251,113,133,0.32);
            box-shadow: 0 12px 32px rgba(0,0,0,0.6), 0 0 40px rgba(251,113,133,0.1);
            backdrop-filter: blur(12px);
            animation: _hbSlideIn .35s cubic-bezier(0.16,1,0.3,1), _hbToastShake .5s cubic-bezier(.36,.07,.19,.97) .1s;
            max-width: 300px;
        `;
        el.innerHTML = `
            <span style="flex-shrink: 0; width: 30px; height: 30px;
                display: flex; align-items: center; justify-content: center;
                border-radius: 9px; background: rgba(251,113,133,0.12);
                border: 1px solid rgba(251,113,133,0.32);">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fb7185" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
            </span>
            <div style="min-width: 0;">
                <div style="font-size: 11.5px; font-weight: 800; color: #fff; letter-spacing: .02em;">Você está bloqueado</div>
                <div style="font-size: 9.5px; color: #9ca3af; margin-top: 2px;">O acesso ao hub foi desativado.</div>
            </div>
        `;
        document.body.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity .3s, transform .3s';
            el.style.opacity = '0';
            el.style.transform = 'translateX(20px)';
            setTimeout(() => el.remove(), 300);
        }, 8000);
    }

    function _mostrarDesbloqueioToast() {
        _ensureBlockStyle();
        const el = document.createElement('div');
        el.id = '_hubUnblockToast';
        el.setAttribute('data-hub-block', '1');
        el.setAttribute('data-sang-ui', '');
        el.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 2147483647;
            display: flex; align-items: center; gap: 11px;
            padding: 12px 16px; border-radius: 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(175deg, rgba(16,26,22,0.96), rgba(8,14,12,0.98));
            border: 1px solid rgba(52,211,153,0.36);
            box-shadow: 0 12px 32px rgba(0,0,0,0.6), 0 0 40px rgba(52,211,153,0.15);
            backdrop-filter: blur(12px);
            animation: _hbSlideIn .35s cubic-bezier(0.16,1,0.3,1);
            max-width: 320px;
        `;
        el.innerHTML = `
            <span style="flex-shrink: 0; width: 30px; height: 30px;
                display: flex; align-items: center; justify-content: center;
                border-radius: 9px; background: rgba(52,211,153,0.12);
                border: 1px solid rgba(52,211,153,0.36);">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    <polyline points="9 12 11 14 15 10"/>
                </svg>
            </span>
            <div style="min-width: 0;">
                <div style="font-size: 11.5px; font-weight: 800; color: #fff; letter-spacing: .02em;">Desbloqueado</div>
                <div style="font-size: 9.5px; color: #9ca3af; margin-top: 2px;">Recarregando o hub…</div>
            </div>
        `;
        document.body.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity .3s, transform .3s';
            el.style.opacity = '0';
            el.style.transform = 'translateX(20px)';
            setTimeout(() => el.remove(), 300);
        }, 1200);
    }

    function _autodestruir() {
        HLOG('💥 Autodestruindo hub');
        try { window._admin?.kill?.(); } catch(e) {}
        try { window._hubUI?.kill?.(); } catch(e) {}
        if (!_heartbeatTimer && fsConfigured() && _deviceId) {
            _enviarHeartbeat();
            _heartbeatTimer = setInterval(_enviarHeartbeat, HEARTBEAT_MS);
        }
    }

    let _blockWatcherId = null;
    function _iniciarBlockWatcher() {
        if (_blockWatcherId) return;
        _blockWatcherId = setInterval(async () => {
            try {
                const antesB = _blocked;
                const antesS = _secretOn;
                await _gate();
                if (antesB !== _blocked) {
                    if (_blocked) {
                        HLOG('🚫 Bloqueio em runtime detectado');
                        window._hubSFX?.alert?.();
                        _autodestruir();
                        _mostrarBloqueioOverlay();
                    } else {
                        HLOG('✅ Desbloqueado — recarregando');
                        window._hubSFX?.unblocked?.();
                        _removerBloqueioOverlay();
                        _mostrarDesbloqueioToast();
                        setTimeout(() => { try { location.reload(); } catch(e) {} }, 1050);
                    }
                    return;
                }
                if (antesS !== _secretOn) {
                    HLOG('🔐 Módulos secret mudaram — refresh');
                    try { refreshManifest(true); } catch(e) {}
                }
            } catch(e) { /* silencioso */ }
        }, BLOCK_POLL_MS);
    }

    // ═══ ADMIN LOADER ═══
    const ADMIN_MODULE = {
        id: 'admin',
        name: 'Admin',
        instanceKey: '_admin',
        url: 'https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/admin.js'
    };
    async function _carregarAdmin() {
        if (window._admin) return;
        try { await loadModule(ADMIN_MODULE); }
        catch(e) { HERR('Falha admin:', e); }
    }
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            if (_blocked) return;
            if (window._admin?.toggle) window._admin.toggle();
            else _carregarAdmin().then(() => window._admin?.toggle?.());
        }
    });

    const VOICE_OPEN = ['abra', 'abre', 'abrir', 'ativa', 'ativar', 'liga', 'ligar', 'inicia', 'iniciar'];
    const VOICE_CLOSE = ['feche', 'fecha', 'fechar', 'desativa', 'desativar', 'desliga', 'desligar', 'para', 'parar'];
    const VOICE_ALIASES = {
        packetlive:  ['packet', 'packet manager', 'analisador', 'analyzer'],
        blocklive:   ['liveblock', 'adblock', 'bloqueador'],
        boosterlive: ['booster', 'booster fps'],
        gameslive:   ['jogos', 'games', 'gameslive'],
        photolive:   ['photoswap', 'fotoswap', 'foto'],
        yt:          ['youtube'],
        iptv:        ['iptv', 'tv'],
        prozilla:    ['prozilla'],
        galeria:     ['galeria'],
        voz:         ['voz', 'microfone', 'mic'],
        groq:        ['sang', 'sang ai', 'chat ia', 'ia']
    };
    const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const STATUS = { UNLOADED: 'unloaded', LOADING: 'loading', LOADED: 'loaded', ERROR: 'error' };
    const TABS = [{ id: 'modules', label: 'Módulos' }, { id: 'misc', label: 'Adicionais' }];

    const state = {
        manifest: { modules: [] },
        moduleStates: {},
        syncState: 'loading',
        lastSyncAt: null,
        killFlag: false,
        currentHubVersion: HUB_VERSION,
        updateTimer: null,
        heartbeatTimer: null,
        isUpdating: false,
        activeTab: 'modules'
    };

    let renderListFn = null;
    let renderChromeFn = null;
    let toastFn = null;
    let uiRoot = null;
    let uiPill = null;
    let showPanelFn = null;
    let showPillFn = null;

    function escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    // ═══ WEBSOCKET HOOK ═══
    (function setupSocketHook() {
        if (window._hubSocket) return;
        const connectCbs = [];
        const messageCbs = [];
        let active = null;
        const OriginalWebSocket = window.WebSocket;
        function HookedWebSocket(...args) {
            const ws = new OriginalWebSocket(...args);
            active = ws;
            connectCbs.forEach(cb => { try { cb(ws); } catch(e) {} });
            ws.addEventListener('message', (event) => {
                messageCbs.forEach(cb => { try { cb(event, ws); } catch(e) {} });
            });
            ws.addEventListener('close', () => { if (active === ws) active = null; });
            return ws;
        }
        HookedWebSocket.prototype = OriginalWebSocket.prototype;
        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(k => { HookedWebSocket[k] = OriginalWebSocket[k]; });
        window.WebSocket = HookedWebSocket;
        window._hubSocket = {
            getActive: () => active,
            onConnect: (cb) => { connectCbs.push(cb); if (active) cb(active); },
            onMessage: (cb) => { messageCbs.push(cb); },
            _original: OriginalWebSocket
        };
    })();

    // ═══ SFX ═══
    (function setupSfx() {
        if (window._hubSFX) return;
        let actx = null;
        let muted = false;
        let _dragCount = 0;
        try { muted = localStorage.getItem(SFX_MUTED_KEY) === '1'; } catch(e) {}

        function ctx() {
            if (actx) return actx;
            try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { actx = null; }
            return actx;
        }
        function tone(freq, dur, type, peak, attack) {
            if (muted) return;
            const c = ctx();
            if (!c) return;
            if (c.state === 'suspended') c.resume().catch(() => {});
            const now = c.currentTime;
            const osc = c.createOscillator();
            const lp  = c.createBiquadFilter();
            const gain = c.createGain();
            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freq, now);
            lp.type = 'lowpass';
            lp.frequency.setValueAtTime(Math.min(freq * 2.6, 3200), now);
            lp.Q.setValueAtTime(0.6, now);
            const a = attack != null ? attack : 0.012;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(peak || 0.03, now + a);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            osc.connect(lp).connect(gain).connect(c.destination);
            osc.start(now);
            osc.stop(now + dur + 0.03);
        }
        function sweep(f1, f2, dur, peak) {
            if (muted) return;
            const c = ctx();
            if (!c) return;
            if (c.state === 'suspended') c.resume().catch(() => {});
            const now = c.currentTime;
            const osc = c.createOscillator();
            const lp = c.createBiquadFilter();
            const gain = c.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f1, now);
            osc.frequency.exponentialRampToValueAtTime(f2, now + dur);
            lp.type = 'lowpass';
            lp.frequency.setValueAtTime(f2 > f1 ? 2200 : 1600, now);
            lp.Q.setValueAtTime(0.5, now);
            const attack = f2 > f1 ? 0.10 : 0.03;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(peak || 0.011, now + attack);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.06);
            osc.connect(lp).connect(gain).connect(c.destination);
            osc.start(now);
            osc.stop(now + dur + 0.10);
        }

        let lastHover = 0;
        window._hubSFX = {
            warm() { ctx(); },
            isMuted() { return muted; },
            setMuted(v) { muted = !!v; try { localStorage.setItem(SFX_MUTED_KEY, muted ? '1' : '0'); } catch(e) {} return muted; },
            toggleMute() { return window._hubSFX.setMuted(!muted); },
            beginDrag() { _dragCount++; },
            endDrag() { _dragCount = Math.max(0, _dragCount - 1); },
            isDragging() { return _dragCount > 0; },
            hover() {
                if (_dragCount > 0) return;
                const t = performance.now();
                if (t - lastHover < 70) return;
                lastHover = t;
                tone(320, 0.13, 'sine', 0.0055, 0.045);
            },
            expand() {
                if (_dragCount > 0) return;
                sweep(420, 720, 0.30, 0.0075);
                setTimeout(() => tone(880, 0.18, 'sine', 0.0045, 0.06), 55);
            },
            toggleOn() { tone(392, 0.14, 'sine', 0.0085, 0.05); setTimeout(() => tone(523.25, 0.16, 'sine', 0.0065, 0.055), 60); },
            toggleOff() { tone(349.23, 0.15, 'sine', 0.0085, 0.05); setTimeout(() => tone(261.63, 0.20, 'sine', 0.006, 0.06), 65); },
            success() {
                tone(659.25, 0.09, 'sine', 0.020, 0.014);
                setTimeout(() => tone(783.99, 0.10, 'sine', 0.017, 0.014), 70);
                setTimeout(() => tone(987.77, 0.16, 'sine', 0.014, 0.016), 140);
            },
            error() { tone(330, 0.11, 'sine', 0.020, 0.014); setTimeout(() => tone(262, 0.18, 'sine', 0.017, 0.018), 80); },
            alert() {
                tone(240, 0.16, 'sine', 0.055, 0.006);
                setTimeout(() => tone(190, 0.20, 'sine', 0.050, 0.008), 80);
                setTimeout(() => tone(145, 0.34, 'sine', 0.042, 0.012), 175);
            },
            unblocked() {
                tone(523.25, 0.10, 'sine', 0.028, 0.010);
                setTimeout(() => tone(659.25, 0.11, 'sine', 0.026, 0.012), 70);
                setTimeout(() => tone(880.00, 0.18, 'sine', 0.022, 0.014), 150);
            },
            whoosh(direction) {
                if (direction === 'open') sweep(240, 1320, 0.38, 0.009);
                else sweep(1320, 240, 0.26, 0.013);
            },
            pickup() { tone(760, 0.05, 'sine', 0.014, 0.010); },
            drop()   { tone(200, 0.16, 'sine', 0.015, 0.026); },
            ring() {
                if (muted) return;
                const burst = (delay) => setTimeout(() => {
                    tone(440,    0.42, 'sine', 0.032, 0.028);
                    tone(659.25, 0.42, 'sine', 0.024, 0.028);
                }, delay);
                burst(0);
                burst(620);
            },
            micOn() {
                tone(523.25, 0.10, 'sine', 0.024, 0.012);
                setTimeout(() => tone(783.99, 0.14, 'sine', 0.020, 0.014), 70);
            },
            micOff() {
                tone(523.25, 0.11, 'sine', 0.022, 0.012);
                setTimeout(() => tone(311.13, 0.16, 'sine', 0.018, 0.014), 70);
            }
        };
        document.addEventListener('click', () => { try { ctx()?.resume(); } catch(e) {} }, { once: true, capture: true });
    })();

    // ═══ RTDB — helpers ═══
    function _rtdbUrl(path) { return RTDB_URL + '/' + path + '.json'; }
    async function _rtdbGet(path) {
        try {
            const res = await fetch(_rtdbUrl(path), { cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json();
        } catch(e) { return null; }
    }
    async function _rtdbPut(path, value) {
        try {
            const res = await fetch(_rtdbUrl(path), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(value)
            });
            return res.ok;
        } catch(e) { return false; }
    }
    async function _rtdbPost(path, value) {
        try {
            const res = await fetch(_rtdbUrl(path), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(value)
            });
            return res.ok;
        } catch(e) { return false; }
    }
    async function _rtdbDelete(path) {
        try { await fetch(_rtdbUrl(path), { method: 'DELETE' }); } catch(e) {}
    }

    // ═══ MIC — recepção (WebRTC + RTDB signaling) ═══
    let _micReady = null;
    let _mic = { es: null, pc: null, iceEs: null, audio: null, offer: null, banner: null, ringTimer: null, active: false };

    function _micSignalUrl(path) {
        return `${RTDB_URL}/signaling/${_deviceId}/${path}.json`;
    }
    function _micSupported() {
        return !!(window.RTCPeerConnection && window.EventSource && fsConfigured() && _deviceId);
    }

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

                // Chamadas de celular (P2P entre usuários) vão para o módulo phone
                if (offer.kind === 'phone') {
                    const phoneMounted = !!window._phone;
                    try { window.dispatchEvent(new CustomEvent('sang:phone-incoming', { detail: offer })); } catch(_) {}
                    // Phone desmontado → salva como missed para o usuário ver quando abrir
                    if (!phoneMounted) {
                        _registrarMissedCall({
                            toDeviceId: _deviceId,
                            fromId: offer.fromId,
                            fromNumber: offer.fromNumber,
                            fromName: offer.fromName,
                            fromAvatar: offer.fromAvatar,
                            reason: 'missed',
                            ts: offer.ts || Date.now()
                        }).catch(() => {});
                    }
                    return;
                }

                if (offer.type === 'hangup') {
                    if (_mic.offer && _mic.offer.fromId && offer.fromId === _mic.offer.fromId) {
                        _micReject();
                    }
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

    // Persiste uma chamada perdida no Firestore para o destinatário recuperar depois.
    // Usado em dois cenários:
    //  1. HUB recebe oferta de phone mas o módulo phone não está montado (aba fechada)
    //  2. Chamador chama alguém offline (o caller chama registerMissedCall explicitamente)
    async function _registrarMissedCall(payload) {
        if (!fsConfigured()) return false;
        if (!payload || (!payload.toDeviceId && !payload.toNumber)) return false;
        try {
            const fields = {
                toDeviceId:   fsValue(payload.toDeviceId || ''),
                toNumber:     fsValue(payload.toNumber || ''),
                fromDeviceId: fsValue(payload.fromId || payload.fromDeviceId || ''),
                fromNumber:   fsValue(payload.fromNumber || ''),
                fromName:     fsValue(payload.fromName || ''),
                fromAvatar:   fsValue(payload.fromAvatar || ''),
                reason:       fsValue(payload.reason || 'missed'),
                ts:           fsValue(payload.ts || Date.now())
            };
            await fsRequest('POST', '/' + COL_MISSED, { fields });
            HLOG('📭 Missed call registrada para', payload.toNumber || payload.toDeviceId);
            return true;
        } catch(e) {
            HWARN('Falha ao registrar missed call:', e);
            return false;
        }
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
    function _micStopRing() {
        if (_mic.ringTimer) { clearInterval(_mic.ringTimer); _mic.ringTimer = null; }
    }

    async function _micAccept() {
        const offer = _mic.offer;
        if (!offer || _mic.active) return;
        _micStopRing();
        _micHideBanner();
        try {
            const pc = new RTCPeerConnection({ iceServers: MIC_ICE });
            _mic.pc = pc;
            _mic.active = true;

            pc.ontrack = (ev) => {
                try {
                    const audio = new Audio();
                    audio.srcObject = ev.streams[0];
                    audio.autoplay = true;
                    audio.volume = 1.0;
                    audio.play().catch(() => {
                        try { if (typeof toastFn === 'function') toastFn('Clique na página para liberar o áudio', 'warn'); } catch(_) {}
                    });
                    _mic.audio = audio;
                } catch(_) {}
                window._hubSFX?.micOn?.();
            };
            pc.onicecandidate = async (ev) => {
                if (!ev.candidate) return;
                try {
                    await fetch(_micSignalUrl('ice/hub'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
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
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: answer.type, sdp: answer.sdp, ts: Date.now() })
            });

            const iceEs = new EventSource(_micSignalUrl('ice/admin'));
            _mic.iceEs = iceEs;
            const onIce = (raw) => {
                try {
                    const env = JSON.parse(raw);
                    const cand = env?.data;
                    if (cand && cand.candidate && _mic.pc) {
                        _mic.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                    }
                } catch(_) {}
            };
            iceEs.addEventListener('put', (ev) => onIce(ev.data));
            iceEs.addEventListener('patch', (ev) => onIce(ev.data));
        } catch(e) {
            HERR('Falha ao atender chamada:', e);
            _micStop();
        }
    }

    function _micReject() {
        _micStopRing();
        _micHideBanner();
        _mic.offer = null;
        try {
            fetch(_micSignalUrl('answer'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'reject', ts: Date.now() })
            }).catch(() => {});
        } catch(_) {}
    }

    function _micStop() {
        _micStopRing();
        _micHideBanner();
        if (_mic.pc) { try { _mic.pc.close(); } catch(_) {} _mic.pc = null; }
        if (_mic.iceEs) { try { _mic.iceEs.close(); } catch(_) {} _mic.iceEs = null; }
        if (_mic.audio) { try { _mic.audio.pause(); _mic.audio.srcObject = null; } catch(_) {} _mic.audio = null; }
        if (_mic.active) window._hubSFX?.micOff?.();
        _mic.active = false;
        _mic.offer = null;
    }

    function _micShowBanner(offer) {
        _micHideBanner();
        _ensureBlockStyle();

        const shell = document.createElement('div');
        shell.id = '_hubMicBanner';
        shell.setAttribute('data-hub', '1');
        shell.setAttribute('data-sang-ui', '');
        shell.style.cssText = `
            position: fixed; left: 50%; bottom: 28px;
            transform: translateX(-50%);
            z-index: 2147483647;
            pointer-events: auto;
            animation: _hubMicShellIn .35s cubic-bezier(0.16,1,0.3,1);
            transform-style: flat;
        `;

        const inner = document.createElement('div');
        inner.style.cssText = `
            display: flex; align-items: center; gap: 14px;
            padding: 14px 18px 14px 14px;
            border-radius: 16px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(175deg, rgba(16,22,30,0.97), rgba(8,10,16,0.99));
            border: 1px solid rgba(34,211,238,0.42);
            box-shadow: 0 22px 60px rgba(0,0,0,0.75), 0 0 60px rgba(34,211,238,0.22);
            backdrop-filter: blur(14px) saturate(140%);
            max-width: 420px;
            animation: _hubMicVibrate ${MIC_RING_MS}ms cubic-bezier(.36,.07,.19,.97) infinite;
            will-change: transform;
        `;
        inner.innerHTML = `
            <span style="flex-shrink: 0; width: 44px; height: 44px;
                display: flex; align-items: center; justify-content: center;
                border-radius: 12px; background: rgba(34,211,238,0.14);
                border: 1px solid rgba(34,211,238,0.4);
                animation: _hbMicPulse 1.8s ease-in-out infinite;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
            </span>
            <div style="flex: 1; min-width: 0;">
                <div style="font-size: 12.5px; font-weight: 800; color: #fff; letter-spacing: .02em;">
                    Chamada de voz
                </div>
                <div style="font-size: 10px; color: #9ca3af; margin-top: 3px; line-height: 1.4;">
                    <b style="color: #67e8f9;">${escapeHtml(offer.fromName || 'Administrador')}</b> quer falar com você.
                </div>
            </div>
            <div style="display: flex; gap: 6px; flex-shrink: 0;">
                <button id="_hubMicReject" style="cursor: pointer; font-family: inherit;
                    padding: 8px 14px; border-radius: 9px; font-size: 10.5px; font-weight: 700;
                    background: rgba(251,113,133,0.12); border: 1px solid rgba(251,113,133,0.36);
                    color: #fca5b1; letter-spacing: .03em; transition: background .15s;">Recusar</button>
                <button id="_hubMicAccept" style="cursor: pointer; font-family: inherit;
                    padding: 8px 16px; border-radius: 9px; font-size: 10.5px; font-weight: 800;
                    background: linear-gradient(120deg, #22d3ee, #a78bfa); border: none;
                    color: #0b0b10; letter-spacing: .03em; transition: filter .15s;">Atender</button>
            </div>
        `;
        shell.appendChild(inner);
        document.body.appendChild(shell);
        _mic.banner = shell;
        shell.querySelector('#_hubMicAccept').addEventListener('click', () => _micAccept());
        shell.querySelector('#_hubMicReject').addEventListener('click', () => _micReject());
    }
    function _micHideBanner() {
        if (_mic.banner) { try { _mic.banner.remove(); } catch(_) {} _mic.banner = null; }
    }

    // ═══ MODULE LOADING ═══
    function injectCode(code, id) {
        const tag = document.createElement('script');
        tag.textContent = code;
        if (id) tag.setAttribute('data-module', id);
        (document.head || document.documentElement).appendChild(tag);
        tag.remove();
    }
    function killInstance(instanceKey) {
        if (!instanceKey) return false;
        try {
            if (window[instanceKey] && typeof window[instanceKey].kill === 'function') {
                window[instanceKey].kill();
                delete window[instanceKey];
                return true;
            }
            if (window[instanceKey]) { delete window[instanceKey]; return true; }
        } catch(e) {
            try { delete window[instanceKey]; } catch(e2) {}
        }
        return false;
    }
    async function loadModule(mod) {
        if (!mod?.url) throw new Error('Módulo sem URL');
        if (mod.instanceKey) killInstance(mod.instanceKey);
        const url = mod.url + (mod.url.includes('?') ? '&' : '?') + 't=' + Date.now();
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        injectCode(await res.text(), mod.id);
    }
    function tryUnload(mod) {
        if (mod.instanceKey) return killInstance(mod.instanceKey);
        return false;
    }

    // ═══ CACHE ═══
    function getCache(key, ttl) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed.t || Date.now() - parsed.t > ttl) return null;
            return parsed.data;
        } catch(e) { return null; }
    }
    function setCache(key, data) {
        try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch(e) {}
    }
    function getCachedManifest() { return getCache('sanghub_manifest_cache', MANIFEST_CACHE_MS); }
    function setCachedManifest(data) { setCache('sanghub_manifest_cache', data); }

    // ═══ PLAYTIME ═══
    function loadTotalPlaytimeMs() {
        try { return parseInt(localStorage.getItem(PLAYTIME_KEY) || '0', 10) || 0; } catch(e) { return 0; }
    }
    function saveTotalPlaytimeMs(ms) {
        try { localStorage.setItem(PLAYTIME_KEY, String(Math.floor(ms))); } catch(e) {}
    }
    const playtime = { baseTotalMs: loadTotalPlaytimeMs(), sessionStartedAt: Date.now(), flushTimer: null };
    function sessionElapsedMs() { return Date.now() - playtime.sessionStartedAt; }
    function currentTotalMs() { return playtime.baseTotalMs + sessionElapsedMs(); }
    function flushPlaytime() { saveTotalPlaytimeMs(currentTotalMs()); }
    function formatDuration(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const pad = n => String(n).padStart(2, '0');
        return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
    }
    function formatClock() {
        return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    function loadPlayerCache() {
        try { return JSON.parse(localStorage.getItem(PLAYER_CACHE_KEY) || 'null'); } catch(e) { return null; }
    }

    // ═══ FETCH / MANIFEST ═══
    async function fetchWithRetry(url, opts, timeout, retries) {
        let lastErr;
        for (let i = 0; i <= retries; i++) {
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), timeout);
                const res = await fetch(url, { ...opts, signal: ctrl.signal });
                clearTimeout(timer);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res;
            } catch(e) {
                lastErr = e;
                if (i < retries) await new Promise(r => setTimeout(r, 600 * (i + 1)));
            }
        }
        throw lastErr;
    }
    async function fetchManifest(bypassCache) {
        if (!bypassCache) {
            const cached = getCachedManifest();
            if (cached) return cached;
        }
        const res = await fetchWithRetry(MANIFEST_URL + '?t=' + Date.now(), { cache: 'no-store' }, FETCH_TIMEOUT_MS, FETCH_RETRIES);
        const data = await res.json();
        setCachedManifest(data);
        return data;
    }
    async function checkHubUpdate() {
        if (state.isUpdating) return;
        state.isUpdating = true;
        try {
            const res = await fetchWithRetry(HUB_UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' }, 5000, 1);
            const code = await res.text();
            const m = code.match(/HUB_VERSION\s*=\s*["']([^"']+)["']/);
            if (!m) return;
            const v = m[1];
            if (v !== state.currentHubVersion) {
                if (toastFn) toastFn('Atualizando Hub para v' + v + '...', 'ok');
                applyHubUpdate(code);
            }
        } catch(e) { HWARN('Erro update:', e); }
        finally { state.isUpdating = false; }
    }
    function applyHubUpdate(code) {
        try { new Function(code); }
        catch(e) { HERR('Update inválido:', e); return; }
        try {
            flushPlaytime();
            if (window._hubUI?.kill) window._hubUI.kill();
            if (_blockWatcherId) { clearInterval(_blockWatcherId); _blockWatcherId = null; }
            if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
            document.querySelectorAll('[data-hub]:not([data-hub-block]), [data-lb]').forEach(el => el.remove());
            const script = document.createElement('script');
            script.textContent = code;
            document.documentElement.appendChild(script);
            script.remove();
        } catch(e) { HERR('Falha ao aplicar:', e); }
    }
    async function refreshManifest(bypassCache) {
        state.syncState = 'loading';
        if (renderChromeFn) renderChromeFn();
        if (renderListFn) renderListFn();
        try {
            const manifest = await fetchManifest(bypassCache);
            const oldV = state.manifest.version, newV = manifest.version;
            if (oldV && oldV !== newV) {
                const newIds = new Set(manifest.modules.map(m => m.id));
                (state.manifest.modules || []).forEach(mod => {
                    if (!newIds.has(mod.id) && state.moduleStates[mod.id] === STATUS.LOADED) {
                        tryUnload(mod);
                        state.moduleStates[mod.id] = STATUS.UNLOADED;
                    }
                });
            }
            state.manifest = manifest;
            state.syncState = 'synced';
            state.lastSyncAt = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            manifest.modules.filter(m => {
                if (state.moduleStates[m.id] === STATUS.LOADED) return false;
                if (m.admin === true && !_adminUnlocked()) return false;
                if (m.secret === true) return _secretOn;
                return m.enabled !== false && m.autoload === true;
            }).forEach(mod => activateModule(mod));
        } catch(e) {
            HERR('Falha manifesto:', e);
            state.syncState = 'error';
            if (toastFn) toastFn('Erro ao carregar manifesto', 'error');
        }
        if (renderChromeFn) renderChromeFn();
        if (renderListFn) renderListFn();
    }
    async function autoUpdateLoop() {
        if (state.killFlag) return;
        await checkHubUpdate();
        try {
            const cached = getCachedManifest();
            const fresh = await fetchManifest(true);
            if (cached && fresh && cached.version !== fresh.version) await refreshManifest(true);
            else if (!cached) await refreshManifest(true);
        } catch(e) { HWARN('Erro auto-update:', e); }
        if (!state.killFlag) {
            if (state.updateTimer) clearTimeout(state.updateTimer);
            state.updateTimer = setTimeout(autoUpdateLoop, UPDATE_INTERVAL_MS);
        }
    }

    // ═══ MODULE STATE ═══
    function flashItem(modId, kind) {
        if (!uiRoot) return;
        const el = uiRoot.querySelector('.hub-item[data-mod-id="' + CSS.escape(String(modId)) + '"]');
        if (!el) return;
        const cls = 'hub-flash-' + kind;
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), 700);
    }
    async function activateModule(mod) {
        if (state.moduleStates[mod.id] === STATUS.LOADING) return;
        if (mod.admin === true && !_adminUnlocked()) {
            window._hubSFX?.error?.();
            if (toastFn) toastFn('Módulo em fase de Testes', 'error');
            flashItem(mod.id, 'error');
            return;
        }
        state.moduleStates[mod.id] = STATUS.LOADING;
        if (renderListFn) renderListFn();
        try {
            await loadModule(mod);
            state.moduleStates[mod.id] = STATUS.LOADED;
            tentarRegistrarHandlerVoz();
            if (toastFn) toastFn(mod.name + ' carregado', 'ok');
            window._hubSFX?.success?.();
            if (renderListFn) renderListFn();
            flashItem(mod.id, 'ok');
        } catch(e) {
            HERR('Falha em "' + mod.name + '":', e);
            state.moduleStates[mod.id] = STATUS.ERROR;
            if (toastFn) toastFn('Falha em ' + mod.name, 'error');
            window._hubSFX?.error?.();
            if (renderListFn) renderListFn();
            flashItem(mod.id, 'error');
        }
    }
    function deactivateModule(mod) {
        state.moduleStates[mod.id] = STATUS.UNLOADED;
        const ok = tryUnload(mod);
        if (!window._voiceCommands?.registrar) vozHandlerRegistrado = null;
        if (toastFn) toastFn(mod.name + (ok ? ' desativado' : ' — recarregue'), ok ? 'ok' : 'warn');
        if (renderListFn) renderListFn();
    }
    function handleModuleClick(mod) {
        if (mod.secret) return;
        if (mod.admin === true && !_adminUnlocked()) {
            window._hubSFX?.error?.();
            if (toastFn) toastFn('Módulo em fase de Testes', 'error');
            flashItem(mod.id, 'error');
            return;
        }
        const status = state.moduleStates[mod.id] || STATUS.UNLOADED;
        if (status === STATUS.LOADING) return;
        if (status === STATUS.LOADED) { deactivateModule(mod); return; }
        activateModule(mod);
    }

    // ═══ VOZ ═══
    function matchModule(transcript) {
        const words = transcript.split(/\s+/);
        let best = null, bestScore = 0;
        state.manifest.modules.forEach(mod => {
            if (mod.secret || mod.enabled === false) return;
            if (mod.admin === true && !_adminUnlocked()) return;
            const aliasWords = (VOICE_ALIASES[mod.id] || []).flatMap(a => normalize(a).split(/\s+/));
            const nameWords = normalize(mod.name).split(/\s+/);
            const candidates = [...new Set([...nameWords, ...aliasWords])].filter(w => w.length > 2);
            const score = candidates.filter(w => words.includes(w)).length;
            if (score > bestScore) { bestScore = score; best = mod; }
        });
        return best;
    }
    function handleVoiceCommand(raw) {
        const transcript = normalize(raw);
        if (!transcript) return false;
        if (/^(mostrar?|mostra|esconder?|esconde|abrir?|abre|abra|fechar?|fecha|feche)\s+(o\s+)?menu$/.test(transcript)) {
            if (/^(mostrar?|mostra|abrir?|abre|abra)/.test(transcript)) showPanelFn?.();
            else showPillFn?.();
            return true;
        }
        const mod = matchModule(transcript);
        if (!mod) return false;
        const palavras = transcript.split(/\s+/);
        const primeira = palavras[0];
        const status = state.moduleStates[mod.id] || STATUS.UNLOADED;
        if (VOICE_CLOSE.includes(primeira) || VOICE_CLOSE.includes(primeira + 'r')) {
            if (status === STATUS.LOADED) deactivateModule(mod);
            return true;
        }
        if (VOICE_OPEN.includes(primeira) || VOICE_OPEN.includes(primeira + 'r')) {
            if (status !== STATUS.LOADED) activateModule(mod);
            return true;
        }
        if (palavras.length <= 3) { handleModuleClick(mod); return true; }
        return false;
    }
    let vozHandlerRegistrado = null;
    function tentarRegistrarHandlerVoz() {
        if (!window._voiceCommands?.registrar) return false;
        if (vozHandlerRegistrado) return true;
        vozHandlerRegistrado = (texto) => handleVoiceCommand(texto);
        window._voiceCommands.registrar(/.*/, vozHandlerRegistrado, -1);
        return true;
    }
    function limparHandlerVoz() {
        if (vozHandlerRegistrado && window._voiceCommands?.remover) window._voiceCommands.remover(vozHandlerRegistrado);
        vozHandlerRegistrado = null;
    }
    tentarRegistrarHandlerVoz();

    // ═══ UI HELPERS ═══
    function setupGifIcon(item, canvas, liveImg, originalUrl) {
        const ctx = canvas.getContext('2d');
        const probe = new Image();
        probe.src = originalUrl;
        probe.onload = () => {
            canvas.width = probe.naturalWidth || 32;
            canvas.height = probe.naturalHeight || 32;
            ctx.drawImage(probe, 0, 0);
        };
        let playTimer = null;
        function play() {
            liveImg.src = originalUrl;
            liveImg.hidden = false;
            canvas.hidden = true;
            clearTimeout(playTimer);
            playTimer = setTimeout(stop, GIF_PLAY_MS);
        }
        function stop() {
            clearTimeout(playTimer);
            liveImg.hidden = true;
            canvas.hidden = false;
        }
        item.addEventListener('mouseenter', play);
        item.addEventListener('mouseleave', stop);
    }
    function parseIcon(icon) {
        if (!icon) return '<span style="font-size:26px;">📦</span>';
        icon = icon.trim();
        if (/^<svg/i.test(icon)) return icon;
        if (/^https?:\/\//i.test(icon) || /^data:image/i.test(icon) || /\.(png|svg|jpg|jpeg|webp)(\?.*)?$/i.test(icon))
            return `<img src="${icon}" alt="icon" />`;
        if (/\.gif(\?.*)?$/i.test(icon))
            return `<canvas class="hub-gif-frozen"></canvas><img class="hub-gif-live" data-original="${icon}" alt="icon" hidden />`;
        return icon;
    }
    function modulesForTab(tabId) {
        return state.manifest.modules.filter(m => {
            if (m.enabled === false || m.secret === true) return false;
            const isMisc = m.misc === true;
            return tabId === 'misc' ? isMisc : !isMisc;
        });
    }

    // ═══ BUILD UI ═══
    function buildUI() {
        const UID = '_hub';
        const ac = new AbortController();
        const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const style = document.createElement('style');
        style.setAttribute('data-hub', '1');
        style.textContent = `
        @keyframes hubItemIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
        @keyframes hubPulse{0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes hubSpin{to{transform:rotate(360deg)}}
        @keyframes hubShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
        @keyframes hubTitleShine{to{background-position:-200% center}}
        @keyframes hubIconRing{to{--hub-angle:360deg}}
        @keyframes hubPillRing{to{--hub-angle:360deg}}
        @keyframes hubFlashOk{0%{box-shadow:0 0 0 0 rgba(52,211,153,.45)}100%{box-shadow:0 0 0 16px rgba(52,211,153,0)}}
        @keyframes hubFlashErr{0%{box-shadow:0 0 0 0 rgba(251,113,133,.45)}100%{box-shadow:0 0 0 16px rgba(251,113,133,0)}}
        @property --hub-angle{syntax:'<angle>';inherits:false;initial-value:0deg}

        #${UID}{
            --hub-cyan:#22d3ee; --hub-violet:#a78bfa; --hub-grad:linear-gradient(120deg,var(--hub-cyan),var(--hub-violet));
            --hub-ok:#34d399; --hub-err:#fb7185; --hub-muted:#8b8fa3;
            --tx:0deg; --ty:0deg; --rz:0deg; --sc:1; --sx:1; --sy:1; --persp:1200px;
            position:fixed;top:20px;left:20px;width:336px;
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;font-size:13px;
            color:#f1f2f8;background:linear-gradient(175deg,rgba(20,20,28,0.92),rgba(9,9,14,0.97));backdrop-filter:blur(18px) saturate(140%);
            border:1px solid rgba(255,255,255,0.08);border-radius:20px;
            box-shadow:0 20px 50px rgba(0,0,0,0.55),0 2px 8px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06);
            z-index:2147483647;overflow:hidden;user-select:none;
            max-height:85vh;display:flex;flex-direction:column;
            isolation:isolate;
            opacity:1;
            transform-origin:50% 50%;
            backface-visibility:hidden;
            transform:
                perspective(var(--persp))
                rotateX(var(--tx))
                rotateY(var(--ty))
                rotate(var(--rz))
                scale(calc(var(--sc) * var(--sx)), calc(var(--sc) * var(--sy)));
            transition:transform .38s cubic-bezier(.22,1,.36,1),
                       opacity .32s cubic-bezier(.22,1,.36,1),
                       visibility 0s}
        #${UID}.hidden{
            opacity:0;pointer-events:none;visibility:hidden;
            --sc:.985;
            transition:transform .3s cubic-bezier(.22,1,.36,1),
                       opacity .3s cubic-bezier(.22,1,.36,1),
                       visibility 0s linear .3s}
        #${UID}.dragging{
            transition:opacity .3s cubic-bezier(.22,1,.36,1),visibility 0s}
        #${UID}::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--hub-grad);
            background-size:200% 100%;animation:hubShimmer 4s linear infinite;z-index:3;pointer-events:none}
        #${UID} .hub-hdr{padding:14px 16px;display:flex;align-items:center;justify-content:space-between;cursor:grab;flex-shrink:0}
        #${UID} .hub-hdr:active{cursor:grabbing}
        #${UID} .hub-brand{display:flex;align-items:center;gap:11px;min-width:0}
        #${UID} .hub-key{flex-shrink:0;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;
            background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);box-shadow:0 0 16px rgba(34,211,238,0.15);padding:5px;box-sizing:border-box}
        #${UID} .hub-title{font-weight:800;font-size:13.5px;letter-spacing:.06em;white-space:nowrap;
            background:linear-gradient(100deg,var(--hub-cyan) 0%,var(--hub-violet) 35%,#fff 50%,var(--hub-violet) 65%,var(--hub-cyan) 100%);
            background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;
            animation:hubTitleShine 3.2s linear infinite}
        #${UID} .hub-subtitle{font-size:9.5px;color:var(--hub-muted);display:flex;align-items:center;gap:5px;margin-top:3px}
        #${UID} .hub-sync-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
        #${UID} .hub-sync-dot.loading{background:var(--hub-cyan);animation:hubPulse 1s infinite}
        #${UID} .hub-sync-dot.synced{background:var(--hub-ok);box-shadow:0 0 6px rgba(52,211,153,0.7)}
        #${UID} .hub-sync-dot.error{background:var(--hub-err)}
        #${UID} .hub-actions{display:flex;gap:6px;flex-shrink:0}
        #${UID} .hub-hbtn{width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
            color:#c7cad6;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;
            transition:color .22s cubic-bezier(.22,1,.36,1),
                       background .22s cubic-bezier(.22,1,.36,1),
                       border-color .22s cubic-bezier(.22,1,.36,1),
                       box-shadow .22s cubic-bezier(.22,1,.36,1),
                       transform .3s cubic-bezier(.22,1,.36,1);flex-shrink:0}
        #${UID} .hub-hbtn:hover{color:#0b0b10;background:var(--hub-grad);border-color:transparent;box-shadow:0 0 14px rgba(34,211,238,0.35);transform:translateY(-1px)}
        #${UID} .hub-hbtn:focus-visible,#${UID} .hub-item:focus-visible,#${UID} .hub-tab:focus-visible{outline:2px solid var(--hub-cyan);outline-offset:2px}
        #${UID} .hub-hbtn.spin svg{animation:hubSpin .6s linear infinite}
        #${UID} .hub-hbtn.listening{color:#0b0b10;background:var(--hub-grad);border-color:transparent;box-shadow:0 0 10px rgba(34,211,238,.5)}
        #${UID} .hub-hbtn.hearing{animation:hubPulse .35s ease-in-out}
        #${UID} .hub-hbtn.cedido{opacity:.4;pointer-events:none}
        #${UID} .hub-hbtn.muted{color:#8b8fa3}
        #${UID} .hub-hbtn.muted svg{opacity:.55}
        #${UID} .hub-tabs{display:flex;gap:4px;padding:0 12px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.06)}
        #${UID} .hub-tab{flex:1;text-align:center;padding:9px 6px 10px;font-size:10.5px;font-weight:800;letter-spacing:.05em;
            text-transform:uppercase;color:var(--hub-muted);background:transparent;border:none;cursor:pointer;position:relative;
            transition:color .22s cubic-bezier(.22,1,.36,1);font-family:inherit}
        #${UID} .hub-tab:hover{color:#d1d5db}
        #${UID} .hub-tab.active{color:#fff}
        #${UID} .hub-tab.active::after{content:'';position:absolute;left:14px;right:14px;bottom:-1px;height:2px;
            background:var(--hub-grad);border-radius:2px}
        #${UID} .hub-body{padding:12px;overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:7px}
        #${UID} .hub-body::-webkit-scrollbar{width:5px}
        #${UID} .hub-body::-webkit-scrollbar-thumb{background:linear-gradient(var(--hub-cyan),var(--hub-violet));border-radius:3px}
        #${UID} .hub-empty,#${UID} .hub-error-box{padding:20px;text-align:center;color:var(--hub-muted);font-size:11px}
        #${UID} .hub-error-box{color:#fca5b1}
        #${UID} .hub-retry{display:inline-block;padding:6px 14px;margin-top:10px;border-radius:8px;
            background:rgba(251,113,133,0.12);border:1px solid rgba(251,113,133,0.35);color:#fca5b1;cursor:pointer;font-size:10px;font-weight:700;
            transition:all .22s cubic-bezier(.22,1,.36,1)}
        #${UID} .hub-item{display:flex;align-items:center;gap:14px;padding:11px 13px;
            border-radius:13px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.05);cursor:pointer;
            transition:background .3s cubic-bezier(.22,1,.36,1),
                       border-color .3s cubic-bezier(.22,1,.36,1),
                       transform .4s cubic-bezier(.22,1,.36,1),
                       box-shadow .4s cubic-bezier(.22,1,.36,1);
            position:relative;overflow:hidden;
            animation:hubItemIn .3s cubic-bezier(.22,1,.36,1) backwards}
        #${UID} .hub-item::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent;transition:background .3s cubic-bezier(.22,1,.36,1)}
        #${UID} .hub-item.state-loaded::before{background:var(--hub-grad)}
        #${UID} .hub-item.state-loading::before{background:var(--hub-cyan);animation:hubPulse 1s infinite}
        #${UID} .hub-item.state-error::before{background:var(--hub-err)}
        #${UID} .hub-item:hover{background:rgba(255,255,255,0.05);border-color:rgba(167,139,250,0.32);
            transform:translateY(-1px);box-shadow:0 8px 20px rgba(0,0,0,0.35),0 0 0 1px rgba(34,211,238,0.08)}
        #${UID} .hub-item:active{transform:translateY(-1px) scale(0.995)}
        #${UID} .hub-item.hub-flash-ok{animation:hubItemIn .3s cubic-bezier(.22,1,.36,1) backwards,hubFlashOk .7s ease-out}
        #${UID} .hub-item.hub-flash-error{animation:hubItemIn .3s cubic-bezier(.22,1,.36,1) backwards,hubFlashErr .7s ease-out}
        #${UID} .hub-item.admin-locked{cursor:not-allowed}
        #${UID} .hub-item.admin-locked::after{content:'Módulo em fase de Testes';
            position:absolute;inset:0;z-index:2;pointer-events:none;
            display:flex;align-items:center;justify-content:center;
            font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
            color:#fca5b1;
            background:linear-gradient(175deg,rgba(8,8,12,.72),rgba(8,8,12,.82));
            backdrop-filter:blur(1.6px);-webkit-backdrop-filter:blur(1.6px);
            text-shadow:0 0 12px rgba(251,113,133,.5)}
        #${UID} .hub-icon{width:48px;height:48px;min-width:48px;min-height:48px;display:flex;align-items:center;justify-content:center;position:relative}
        #${UID} .hub-icon img,#${UID} .hub-icon svg,#${UID} .hub-icon canvas{width:100%;height:100%;object-fit:contain;display:block;border-radius:10px;
            filter:drop-shadow(0 3px 7px rgba(0,0,0,0.4));transition:filter .22s cubic-bezier(.22,1,.36,1)}
        #${UID} .hub-icon [hidden]{display:none !important}
        #${UID} .hub-icon::before{content:'';position:absolute;inset:-6px;border-radius:15px;padding:1.5px;
            background:conic-gradient(from var(--hub-angle),var(--hub-cyan),var(--hub-violet),#fff,var(--hub-violet),var(--hub-cyan));
            -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
            -webkit-mask-composite:xor;mask-composite:exclude;
            opacity:0;transition:opacity .4s cubic-bezier(.22,1,.36,1);animation:hubIconRing 4.5s linear infinite;animation-play-state:paused;pointer-events:none}
        #${UID} .hub-item:hover .hub-icon::before{opacity:.55;animation-play-state:running}
        #${UID} .hub-info{flex:1;min-width:0}
        #${UID} .hub-name{font-weight:700;color:#ffffff;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        #${UID} .hub-desc{font-size:9.5px;color:var(--hub-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
        #${UID} .hub-chip{flex-shrink:0;display:flex;align-items:center;gap:5px;font-size:8.5px;font-weight:800;padding:4px 9px;
            border-radius:20px;text-transform:uppercase;letter-spacing:0.06em;border:1px solid transparent}
        #${UID} .hub-chip::before{content:'';width:5px;height:5px;border-radius:50%;flex-shrink:0}
        #${UID} .hub-chip.unloaded{background:rgba(255,255,255,0.04);color:#8b8fa3;border-color:rgba(255,255,255,0.06)}
        #${UID} .hub-chip.unloaded::before{background:#5b5f70}
        #${UID} .hub-chip.loading{background:rgba(34,211,238,0.1);color:var(--hub-cyan);border-color:rgba(34,211,238,0.25)}
        #${UID} .hub-chip.loading::before{background:var(--hub-cyan);animation:hubPulse 1s infinite}
        #${UID} .hub-chip.loaded{background:rgba(52,211,153,0.1);color:var(--hub-ok);border-color:rgba(52,211,153,0.25)}
        #${UID} .hub-chip.loaded::before{background:var(--hub-ok);box-shadow:0 0 5px rgba(52,211,153,0.8)}
        #${UID} .hub-chip.error{background:rgba(251,113,133,0.1);color:var(--hub-err);border-color:rgba(251,113,133,0.25)}
        #${UID} .hub-chip.error::before{background:var(--hub-err)}
        #${UID} .hub-ftr{padding:10px 16px;background:rgba(0,0,0,0.25);border-top:1px solid rgba(255,255,255,0.05);
            font-size:9.5px;color:var(--hub-muted);display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
        #${UID} .hub-toast{position:absolute;left:14px;right:14px;bottom:40px;padding:9px 14px;border-radius:11px;
            font-size:10.5px;font-weight:700;text-align:center;opacity:0;transform:translateY(8px);
            transition:opacity .3s cubic-bezier(.22,1,.36,1),transform .3s cubic-bezier(.22,1,.36,1);
            pointer-events:none;z-index:20;border:1px solid;background:rgba(14,14,20,0.96);backdrop-filter:blur(10px);color:#f3f4f6}
        #${UID} .hub-toast.show{opacity:1;transform:translateY(0)}
        #${UID} .hub-toast.ok{border-color:rgba(52,211,153,0.5);color:#a7f3d0}
        #${UID} .hub-toast.error{border-color:rgba(251,113,133,0.5);color:#fecdd3}
        #${UID} .hub-toast.warn,#${UID} .hub-toast.info{border-color:rgba(34,211,238,0.5);color:#cffafe}

        #${UID}pill{
            --hub-cyan:#22d3ee; --hub-violet:#a78bfa; --hub-grad:linear-gradient(120deg,var(--hub-cyan),var(--hub-violet));
            --tx:0deg; --ty:0deg; --rz:0deg; --sc:1; --sx:1; --sy:1; --persp:900px;
            position:fixed;top:20px;left:20px;width:250px;
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;
            border-radius:20px;z-index:2147483647;user-select:none;padding:2px;
            opacity:1;
            transform-origin:50% 50%;
            backface-visibility:hidden;
            transform:
                perspective(var(--persp))
                rotateX(var(--tx))
                rotateY(var(--ty))
                rotate(var(--rz))
                scale(calc(var(--sc) * var(--sx)), calc(var(--sc) * var(--sy)));
            transition:transform .42s cubic-bezier(.22,1,.36,1),
                       opacity .32s cubic-bezier(.22,1,.36,1),
                       visibility 0s}
        #${UID}pill.hidden{
            opacity:0;pointer-events:none;visibility:hidden;
            --sc:.97;
            transition:transform .3s cubic-bezier(.22,1,.36,1),
                       opacity .3s cubic-bezier(.22,1,.36,1),
                       visibility 0s linear .3s}
        #${UID}pill.dragging{
            transition:opacity .3s cubic-bezier(.22,1,.36,1),visibility 0s}
        #${UID}pill:hover:not(.dragging){--sc:1.035}
        #${UID}pill::before{content:'';position:absolute;inset:0;border-radius:20px;padding:2px;
            background:conic-gradient(from var(--hub-angle),var(--hub-cyan),var(--hub-violet),#fff,var(--hub-violet),var(--hub-cyan));
            -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
            -webkit-mask-composite:xor;mask-composite:exclude;
            animation:hubPillRing 6s linear infinite;pointer-events:none;
            box-shadow:0 0 14px rgba(34,211,238,0.35),0 0 22px rgba(167,139,250,0.2);
            transition:box-shadow .5s cubic-bezier(.22,1,.36,1)}
        #${UID}pill:hover:not(.dragging)::before{
            box-shadow:0 0 30px rgba(34,211,238,0.85),
                       0 0 60px rgba(167,139,250,0.6),
                       0 0 100px rgba(34,211,238,0.35)}
        #${UID}pill:hover:not(.dragging) #${UID}pillinner{
            box-shadow:0 26px 62px rgba(0,0,0,0.62),
                       0 0 36px rgba(34,211,238,0.20)}
        #${UID}pill.dragging{cursor:grabbing}

        #${UID}pillinner{display:block;border-radius:18px;cursor:grab;color:#f1f2f8;
            background:linear-gradient(175deg,rgba(20,20,28,0.94),rgba(9,9,14,0.98));
            box-shadow:0 20px 50px rgba(0,0,0,0.55);overflow:hidden;
            transition:box-shadow .5s cubic-bezier(.22,1,.36,1)}
        #${UID}pillinner:active{cursor:grabbing}
        #${UID}pill .hub-p-hdr{padding:11px 13px;display:flex;align-items:center;gap:9px}
        #${UID}pill .hub-p-icon{flex-shrink:0;width:28px;height:28px;border-radius:9px;background:rgba(255,255,255,0.05);
            border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center}
        #${UID}pill .hub-p-icon img{width:16px;height:16px;object-fit:contain}
        #${UID}pill .hub-p-title{flex:1;min-width:0;font-weight:800;font-size:11.5px;letter-spacing:.05em;white-space:nowrap;
            background:linear-gradient(100deg,var(--hub-cyan) 0%,var(--hub-violet) 35%,#fff 50%,var(--hub-violet) 65%,var(--hub-cyan) 100%);
            background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;
            animation:hubTitleShine 3.2s linear infinite}
        #${UID}pill .hub-p-clock{flex-shrink:0;font-size:10px;font-weight:700;color:#e5e7eb;font-variant-numeric:tabular-nums}
        #${UID}pill .hub-p-divider{height:1px;background:rgba(255,255,255,0.06);margin:0 13px}
        #${UID}pill .hub-p-player{margin:9px 13px 0;display:flex;align-items:center;gap:9px;
            background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:10px;padding:7px 8px}
        #${UID}pill .hub-p-player-avatar{width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.05);flex-shrink:0;
            overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;color:#8b8fa3;font-size:13px}
        #${UID}pill .hub-p-player-info{flex:1;min-width:0}
        #${UID}pill .hub-p-player-name{font-size:10.5px;font-weight:700;color:#e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        #${UID}pill .hub-p-player-mission{font-size:9px;color:#8b8fa3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
        #${UID}pill .hub-p-stats{margin:9px 13px 11px;display:flex;gap:8px}
        #${UID}pill .hub-p-stat{flex:1;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:6px 8px}
        #${UID}pill .hub-p-stat-label{font-size:8px;color:#8b8fa3;text-transform:uppercase;letter-spacing:.05em}
        #${UID}pill .hub-p-stat-value{font-size:12.5px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
        #${UID}pill .hub-p-stat-value.session{color:var(--hub-cyan)}
        #${UID}pill .hub-p-stat-value.total{color:var(--hub-violet)}

        /* ═══ ANTI-LAG BUTTON ═══ */
        #${UID} .hub-antilag-btn {
            width: 18px; height: 18px;
            border-radius: 5px;
            display: inline-flex; align-items: center; justify-content: center;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            color: #c7cad6;
            font-size: 10px; line-height: 1;
            cursor: pointer;
            transition: all .18s cubic-bezier(.22,1,.36,1);
            user-select: none;
            font-family: inherit;
        }
        #${UID} .hub-antilag-btn:hover {
            color: #fbbf24;
            border-color: rgba(251,191,36,0.4);
            background: rgba(251,191,36,0.1);
            transform: translateY(-1px);
        }
        #${UID} .hub-antilag-btn.active {
            color: #fbbf24;
            background: rgba(251,191,36,0.15);
            border-color: rgba(251,191,36,0.5);
            box-shadow: 0 0 8px rgba(251,191,36,0.35);
        }

        /* ═══ MODO ANTI-LAG — menu seco ═══ */
        #${UID}.anti-lag,
        #${UID}pill.anti-lag {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
        }
        #${UID}.anti-lag,
        #${UID}pill.anti-lag {
            background: linear-gradient(175deg, #14141c, #09090e) !important;
        }
        #${UID}.anti-lag::before,
        #${UID}pill.anti-lag::before {
            display: none !important;
        }
        #${UID}.anti-lag .hub-key,
        #${UID}.anti-lag .hub-title,
        #${UID}.anti-lag .hub-item,
        #${UID}.anti-lag .hub-icon::before,
        #${UID}.anti-lag .hub-hbtn,
        #${UID}.anti-lag .hub-tab,
        #${UID}.anti-lag .hub-toast,
        #${UID}pill.anti-lag .hub-p-title,
        #${UID}pill.anti-lag .hub-p-icon {
            animation: none !important;
            transition: none !important;
            box-shadow: none !important;
        }
        #${UID}.anti-lag .hub-title,
        #${UID}pill.anti-lag .hub-p-title {
            background: none !important;
            -webkit-background-clip: unset !important;
            background-clip: unset !important;
            color: #f1f2f8 !important;
        }
        #${UID}.anti-lag .hub-item::before,
        #${UID}.anti-lag .hub-icon::before {
            display: none !important;
        }
        #${UID}.anti-lag .hub-item:hover,
        #${UID}.anti-lag .hub-hbtn:hover,
        #${UID}.anti-lag .hub-item:active,
        #${UID}.anti-lag .hub-btn:active {
            transform: none !important;
            box-shadow: none !important;
        }
        #${UID}pill.anti-lag:hover:not(.dragging) { --sc: 1; }
        #${UID}pill.anti-lag::before { box-shadow: none !important; }
        #${UID}pill.anti-lag:hover:not(.dragging) #${UID}pillinner { box-shadow: 0 20px 50px rgba(0,0,0,0.55) !important; }
        `;
        document.head.appendChild(style);

        const MAIN_ICON = `<img src="https://raw.githubusercontent.com/zBeyond5/Liveblock/main/assets/PNG/menu2.png" style="width:30px; height:30px; object-fit:contain;" />`;
        const MAIN_ICON_SM = `<img src="https://raw.githubusercontent.com/zBeyond5/Liveblock/main/assets/PNG/menu2.png" style="width:28px; height:28px; object-fit:contain;" />`;
        const REFRESH_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>`;
        const UPDATE_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
        const MIC_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
        const VOL_ON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
        const VOL_OFF_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

        const tabsHtml = TABS.map(t =>
            `<button class="hub-tab${t.id === state.activeTab ? ' active' : ''}" data-tab="${t.id}" role="button" tabindex="0" aria-pressed="${t.id === state.activeTab}">${escapeHtml(t.label)}</button>`
        ).join('');

        const root = document.createElement('div');
        root.id = UID;
        root.setAttribute('data-hub', '1');
        root.setAttribute('data-sang-ui', '');
        root.classList.add('hidden');
        root.innerHTML = `
        <div class="hub-hdr" id="${UID}hdr">
            <div class="hub-brand">
                <span class="hub-key">${MAIN_ICON}</span>
                <div>
                    <div class="hub-title">SANG HUB</div>
                    <div class="hub-subtitle"><span class="hub-sync-dot loading" id="${UID}syncdot"></span><span id="${UID}syncsubtitle">iniciando…</span></div>
                </div>
            </div>
            <div class="hub-actions" id="${UID}actions">
                <div class="hub-hbtn" id="${UID}sfx" title="Som" role="button" tabindex="0">${VOL_ON_SVG}</div>
                <div class="hub-hbtn" id="${UID}voice" title="Voz" role="button" tabindex="0">${MIC_SVG}</div>
                <div class="hub-hbtn" id="${UID}update" title="Auto-update" role="button" tabindex="0">${UPDATE_SVG}</div>
                <div class="hub-hbtn" id="${UID}refresh" title="Recarregar manifesto" role="button" tabindex="0">${REFRESH_SVG}</div>
                <div class="hub-hbtn" id="${UID}min" title="Minimizar" role="button" tabindex="0">−</div>
                <div class="hub-hbtn" id="${UID}cls" title="Fechar" role="button" tabindex="0">✕</div>
            </div>
        </div>
        <div class="hub-tabs" id="${UID}tabs">${tabsHtml}</div>
        <div class="hub-body" id="${UID}list"></div>
        <div class="hub-ftr">
            <span>v${HUB_VERSION}</span>
            <span id="${UID}ftrmid">·</span>
            <span style="display:inline-flex;align-items:center;gap:7px;">
                <span class="hub-antilag-btn" id="${UID}antilag" title="Modo anti-lag (desligar efeitos)" role="button" tabindex="0">⚡</span>
                <span>${SHORTCUT_LABEL}</span>
            </span>
        </div>
        <div class="hub-toast" id="${UID}toast"></div>
        `;
        document.body.appendChild(root);
        uiRoot = root;

        root.querySelectorAll('.hub-hbtn, .hub-tab').forEach(n =>
            n.addEventListener('mouseenter', () => window._hubSFX?.hover?.(), { signal: ac.signal }));

        const pill = document.createElement('div');
        pill.id = UID + 'pill';
        pill.setAttribute('data-hub', '1');
        pill.setAttribute('data-sang-ui', '');
        pill.innerHTML = `
        <div id="${UID}pillinner">
            <div class="hub-p-hdr">
                <span class="hub-p-icon">${MAIN_ICON_SM}</span>
                <span class="hub-p-title">SANG HUB</span>
                <span class="hub-p-clock" id="${UID}clock">--:--</span>
            </div>
            <div class="hub-p-divider"></div>
            <div class="hub-p-player">
                <span class="hub-p-player-avatar" id="${UID}playeravatar">👤</span>
                <div class="hub-p-player-info">
                    <div class="hub-p-player-name" id="${UID}playername">—</div>
                    <div class="hub-p-player-mission" id="${UID}playermission">—</div>
                </div>
            </div>
            <div class="hub-p-stats">
                <div class="hub-p-stat"><div class="hub-p-stat-label">Sessão</div><div class="hub-p-stat-value session" id="${UID}sessiontime">00:00:00</div></div>
                <div class="hub-p-stat"><div class="hub-p-stat-label">Total</div><div class="hub-p-stat-value total" id="${UID}totaltime">00:00:00</div></div>
            </div>
        </div>`;
        document.body.appendChild(pill);
        uiPill = pill;
        pill.addEventListener('mouseenter', () => window._hubSFX?.expand?.(), { signal: ac.signal });

        // ── Drag ──
        let _dragOff = null, _dragTarget = null, _dragCurrent = null, _dragVel = { x: 0, y: 0 }, _dragRaf = null;
        let _pDragOff = null, _pDragTarget = null, _pDragCurrent = null, _pDragVel = { x: 0, y: 0 }, _pDragRaf = null, _pDragMoved = false;
        let _dragDropPending = false;
        let _pDragDropPending = false;
        let _crossfadeTimer = null;

        function _resetTf(el) {
            el.style.setProperty('--tx', '0deg');
            el.style.setProperty('--ty', '0deg');
            el.style.setProperty('--rz', '0deg');
            el.style.setProperty('--sx', '1');
            el.style.setProperty('--sy', '1');
        }
        function _cancelDrags() {
            if (_dragRaf)  { cancelAnimationFrame(_dragRaf);  _dragRaf  = null; }
            if (_pDragRaf) { cancelAnimationFrame(_pDragRaf); _pDragRaf = null; }
            if (_dragOff) window._hubSFX?.endDrag?.();
            if (_pDragOff) window._hubSFX?.endDrag?.();
            _dragOff = _dragTarget = _dragCurrent = null;
            _pDragOff = _pDragTarget = _pDragCurrent = null;
            _pDragMoved = false;
            _dragDropPending = false;
            _pDragDropPending = false;
            root.classList.remove('dragging');
            pill.classList.remove('dragging');
            _resetTf(root);
            _resetTf(pill);
        }

        function syncPos(from, to) {
            const r = from.getBoundingClientRect();
            to.style.left = r.left + 'px';
            to.style.top = r.top + 'px';
        }
        function showPanel() {
            _cancelDrags();
            if (!pill.classList.contains('hidden')) {
                syncPos(pill, root);
                pill.classList.add('hidden');
                window._hubSFX?.whoosh?.('open');
                clearTimeout(_crossfadeTimer);
                _crossfadeTimer = setTimeout(() => {
                    root.classList.remove('hidden');
                    root.querySelectorAll('.hub-item').forEach((it, i) => {
                        it.style.animationDelay = Math.min(i * 28, 200) + 'ms';
                    });
                }, 90);
            } else {
                syncPos(pill, root);
                window._hubSFX?.whoosh?.('open');
                root.classList.remove('hidden');
            }
        }
        function showPill() {
            _cancelDrags();
            if (!root.classList.contains('hidden')) {
                syncPos(root, pill);
                window._hubSFX?.whoosh?.('close');
                root.classList.add('hidden');
                clearTimeout(_crossfadeTimer);
                _crossfadeTimer = setTimeout(() => { pill.classList.remove('hidden'); }, 90);
            } else {
                syncPos(root, pill);
                window._hubSFX?.whoosh?.('close');
                pill.classList.remove('hidden');
            }
        }
        function hideAll() { _cancelDrags(); root.classList.add('hidden'); pill.classList.add('hidden'); }
        showPanelFn = showPanel;
        showPillFn = showPill;

        function onKeyActivate(h) {
            return (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); h(); } };
        }
        function _squashScale(vx, vy, maxAmount) {
            const speed = Math.hypot(vx, vy);
            const s = Math.min(speed * 0.006, maxAmount);
            return { sx: 1 + s, sy: 1 - s };
        }

        function _dragLoop() {
            if (!_dragTarget || !_dragCurrent) { _dragRaf = null; return; }
            const S = 0.16, D = 0.72;
            const dx = _dragTarget.x - _dragCurrent.x;
            const dy = _dragTarget.y - _dragCurrent.y;
            _dragVel.x = (_dragVel.x + dx * S) * D;
            _dragVel.y = (_dragVel.y + dy * S) * D;
            _dragCurrent.x += _dragVel.x;
            _dragCurrent.y += _dragVel.y;
            root.style.left = _dragCurrent.x + 'px';
            root.style.top  = _dragCurrent.y + 'px';
            const rot = Math.max(-2.5, Math.min(2.5, _dragVel.x * 0.4));
            const { sx, sy } = _squashScale(_dragVel.x, _dragVel.y, 0.015);
            root.style.setProperty('--rz', rot.toFixed(2) + 'deg');
            root.style.setProperty('--sx', sx.toFixed(3));
            root.style.setProperty('--sy', sy.toFixed(3));
            const dist = Math.hypot(dx, dy) + Math.hypot(_dragVel.x, _dragVel.y);
            if (_dragOff || dist > 0.4) { _dragRaf = requestAnimationFrame(_dragLoop); }
            else {
                _resetTf(root);
                if (_dragDropPending) { _dragDropPending = false; window._hubSFX?.drop?.(); }
                _dragRaf = null;
            }
        }

        const hdr = root.querySelector('#' + UID + 'hdr');
        hdr.addEventListener('mousedown', e => {
            if (e.target.closest('.hub-hbtn')) return;
            const r = root.getBoundingClientRect();
            root.style.setProperty('--tx', '0deg');
            root.style.setProperty('--ty', '0deg');
            _dragOff = { ox: e.clientX - r.left, oy: e.clientY - r.top };
            _dragTarget  = { x: r.left, y: r.top };
            _dragCurrent = { x: r.left, y: r.top };
            _dragVel = { x: 0, y: 0 };
            _dragDropPending = true;
            root.style.left = r.left + 'px';
            root.style.top  = r.top  + 'px';
            root.classList.add('dragging');
            window._hubSFX?.beginDrag?.();
            window._hubSFX?.pickup?.();
            if (!_dragRaf) _dragRaf = requestAnimationFrame(_dragLoop);
        }, { signal: ac.signal });

        document.addEventListener('mousemove', e => {
            if (!_dragOff || !_dragTarget) return;
            _dragTarget.x = Math.max(0, e.clientX - _dragOff.ox);
            _dragTarget.y = Math.max(0, e.clientY - _dragOff.oy);
        }, { signal: ac.signal });

        document.addEventListener('mouseup', () => {
            if (_dragOff) {
                window._hubSFX?.endDrag?.();
                _resetTf(root);
                root.classList.remove('dragging');
            }
            _dragOff = null;
        }, { signal: ac.signal });

        function _pDragLoop() {
            if (!_pDragTarget || !_pDragCurrent) { _pDragRaf = null; return; }
            const S = 0.22, D = 0.70;
            const dx = _pDragTarget.x - _pDragCurrent.x;
            const dy = _pDragTarget.y - _pDragCurrent.y;
            _pDragVel.x = (_pDragVel.x + dx * S) * D;
            _pDragVel.y = (_pDragVel.y + dy * S) * D;
            _pDragCurrent.x += _pDragVel.x;
            _pDragCurrent.y += _pDragVel.y;
            pill.style.left = _pDragCurrent.x + 'px';
            pill.style.top  = _pDragCurrent.y + 'px';
            const rot = Math.max(-4, Math.min(4, _pDragVel.x * 0.7));
            const { sx, sy } = _squashScale(_pDragVel.x, _pDragVel.y, 0.022);
            pill.style.setProperty('--rz', rot.toFixed(2) + 'deg');
            pill.style.setProperty('--sx', sx.toFixed(3));
            pill.style.setProperty('--sy', sy.toFixed(3));
            const dist = Math.hypot(dx, dy) + Math.hypot(_pDragVel.x, _pDragVel.y);
            if (_pDragOff || dist > 0.4) { _pDragRaf = requestAnimationFrame(_pDragLoop); }
            else {
                _resetTf(pill);
                if (_pDragDropPending) { _pDragDropPending = false; window._hubSFX?.drop?.(); }
                _pDragRaf = null;
            }
        }

        const pillInner = pill.querySelector('#' + UID + 'pillinner');
        pillInner.addEventListener('mousedown', e => {
            const r = pill.getBoundingClientRect();
            pill.style.setProperty('--tx', '0deg');
            pill.style.setProperty('--ty', '0deg');
            _pDragOff = { ox: e.clientX - r.left, oy: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
            _pDragTarget  = { x: r.left, y: r.top };
            _pDragCurrent = { x: r.left, y: r.top };
            _pDragVel = { x: 0, y: 0 };
            _pDragMoved = false;
            _pDragDropPending = true;
            pill.classList.add('dragging');
            pill.style.left = r.left + 'px';
            pill.style.top  = r.top  + 'px';
            window._hubSFX?.beginDrag?.();
            window._hubSFX?.pickup?.();
            if (!_pDragRaf) _pDragRaf = requestAnimationFrame(_pDragLoop);
        }, { signal: ac.signal });

        document.addEventListener('mousemove', e => {
            if (!_pDragOff || !_pDragTarget) return;
            if (Math.abs(e.clientX - _pDragOff.sx) > 3 || Math.abs(e.clientY - _pDragOff.sy) > 3) _pDragMoved = true;
            _pDragTarget.x = Math.max(0, e.clientX - _pDragOff.ox);
            _pDragTarget.y = Math.max(0, e.clientY - _pDragOff.oy);
        }, { signal: ac.signal });

        document.addEventListener('mouseup', () => {
            if (_pDragOff) {
                if (!_pDragMoved) showPanel();
                window._hubSFX?.endDrag?.();
                _resetTf(pill);
            }
            _pDragOff = null;
            pill.classList.remove('dragging');
        }, { signal: ac.signal });

        pillInner.addEventListener('keydown', onKeyActivate(showPanel), { signal: ac.signal });

        let toastTm = null;
        toastFn = (msg, kind) => {
            const el = root.querySelector('#' + UID + 'toast');
            el.textContent = msg;
            el.className = 'hub-toast show ' + (kind || 'info');
            clearTimeout(toastTm);
            toastTm = setTimeout(() => el.classList.remove('show'), 2200);
        };

        const btnMin = root.querySelector('#' + UID + 'min');
        const btnCls = root.querySelector('#' + UID + 'cls');
        const btnRefresh = root.querySelector('#' + UID + 'refresh');
        const btnUpdate = root.querySelector('#' + UID + 'update');
        const btnVoice = root.querySelector('#' + UID + 'voice');
        const btnSfx = root.querySelector('#' + UID + 'sfx');

        function _updateSfxBtn() {
            const muted = window._hubSFX?.isMuted?.() || false;
            btnSfx.classList.toggle('muted', muted);
            btnSfx.innerHTML = muted ? VOL_OFF_SVG : VOL_ON_SVG;
            btnSfx.title = muted ? 'Som desligado (clique para ativar)' : 'Som ligado (clique para silenciar)';
        }
        btnSfx.addEventListener('click', () => {
            window._hubSFX?.toggleMute?.();
            _updateSfxBtn();
            if (!window._hubSFX?.isMuted?.()) window._hubSFX?.toggleOn?.();
        }, { signal: ac.signal });
        _updateSfxBtn();

        // ── Anti-lag ──
        const btnAntilag = root.querySelector('#' + UID + 'antilag');

        function _aplicarAntiLag(on) {
            root.classList.toggle('anti-lag', !!on);
            pill.classList.toggle('anti-lag', !!on);
            if (btnAntilag) {
                btnAntilag.classList.toggle('active', !!on);
                btnAntilag.title = on ? 'Modo anti-lag ATIVO (clique para desligar)' : 'Modo anti-lag (desligar efeitos)';
            }
        }
        _aplicarAntiLag(_antiLag);

        btnAntilag.addEventListener('click', () => {
            _antiLag = !_antiLag;
            try { localStorage.setItem(ANTILAG_KEY, _antiLag ? '1' : '0'); } catch(e) {}
            _aplicarAntiLag(_antiLag);
            if (!_antiLag) window._hubSFX?.toggleOn?.();
            else window._hubSFX?.toggleOff?.();
            if (toastFn) toastFn(_antiLag ? 'Modo anti-lag ativado' : 'Modo anti-lag desativado', _antiLag ? 'ok' : 'info');
        }, { signal: ac.signal });
        btnAntilag.addEventListener('mouseenter', () => window._hubSFX?.hover?.(), { signal: ac.signal });

        btnMin.addEventListener('click', showPill, { signal: ac.signal });
        btnCls.addEventListener('click', hideAll, { signal: ac.signal });
        btnRefresh.addEventListener('click', () => refreshManifest(true), { signal: ac.signal });
        btnUpdate.addEventListener('click', () => { toastFn('Verificando…', 'info'); autoUpdateLoop(); }, { signal: ac.signal });

        let recognition = null, voiceActive = false, lastVoiceAt = 0;
        let vozHabilitado = !!(window._voz?.habilitado);
        function updateVoiceBtn() {
            btnVoice.classList.toggle('listening', voiceActive);
            btnVoice.classList.toggle('cedido', vozHabilitado);
        }
        function ensureRecognition() {
            if (recognition) return recognition;
            recognition = new SpeechRecognitionAPI();
            recognition.lang = 'pt-BR';
            recognition.continuous = true;
            recognition.interimResults = false;
            recognition.onresult = e => {
                const now = Date.now();
                if (now - lastVoiceAt < VOICE_COOLDOWN_MS) return;
                lastVoiceAt = now;
                handleVoiceCommand(e.results[e.results.length - 1][0].transcript);
            };
            recognition.onerror = () => { voiceActive = false; updateVoiceBtn(); };
            recognition.onend = () => {
                if (!voiceActive || vozHabilitado) return;
                try { recognition.start(); } catch(e) {}
            };
            return recognition;
        }
        function setVoiceActive(on) {
            voiceActive = on;
            updateVoiceBtn();
            on ? window._hubSFX?.toggleOn?.() : window._hubSFX?.toggleOff?.();
            try { localStorage.setItem(VOICE_KEY, on ? '1' : '0'); } catch(e) {}
            const rec = ensureRecognition();
            if (on) { if (!vozHabilitado) try { rec.start(); } catch(e) {} }
            else try { rec.stop(); } catch(e) {}
        }
        if (!SpeechRecognitionAPI) btnVoice.style.display = 'none';
        else {
            btnVoice.addEventListener('click', () => setVoiceActive(!voiceActive), { signal: ac.signal });
            window.addEventListener('sang:voz-state', (e) => {
                const novo = !!e?.detail?.habilitado;
                if (novo === vozHabilitado) return;
                vozHabilitado = novo;
                if (vozHabilitado && voiceActive && recognition) try { recognition.stop(); } catch(_) {}
                else if (!vozHabilitado && voiceActive && recognition) try { recognition.start(); } catch(_) {}
                updateVoiceBtn();
            }, { signal: ac.signal });
            if (localStorage.getItem(VOICE_KEY) === '1') setVoiceActive(true);
            updateVoiceBtn();
        }

        const tabsEl = root.querySelector('#' + UID + 'tabs');
        function setActiveTab(tabId) {
            if (state.activeTab === tabId) return;
            state.activeTab = tabId;
            tabsEl.querySelectorAll('.hub-tab').forEach(btn => {
                const a = btn.dataset.tab === tabId;
                btn.classList.toggle('active', a);
                btn.setAttribute('aria-pressed', String(a));
            });
            if (renderListFn) renderListFn();
        }
        tabsEl.querySelectorAll('.hub-tab').forEach(btn => {
            btn.addEventListener('click', () => setActiveTab(btn.dataset.tab), { signal: ac.signal });
        });

        document.addEventListener('keydown', e => {
            if (e.altKey && e.shiftKey && e.key.toLowerCase() === SHORTCUT_KEY) {
                e.preventDefault();
                root.classList.contains('hidden') ? showPanel() : showPill();
            }
        }, { signal: ac.signal });

        const listEl = root.querySelector('#' + UID + 'list');
        const syncDot = root.querySelector('#' + UID + 'syncdot');
        const syncSubtitle = root.querySelector('#' + UID + 'syncsubtitle');
        const ftrMid = root.querySelector('#' + UID + 'ftrmid');

        renderListFn = () => {
            listEl.innerHTML = '';
            if (state.syncState === 'error' && !state.manifest.modules.length) {
                listEl.innerHTML = `<div class="hub-error-box">Erro ao carregar manifesto.<div class="hub-retry" id="${UID}retry" role="button" tabindex="0">Tentar novamente</div></div>`;
                const r = listEl.querySelector('#' + UID + 'retry');
                r.addEventListener('mouseenter', () => window._hubSFX?.hover?.());
                r.addEventListener('click', () => refreshManifest(true));
                return;
            }
            const visible = modulesForTab(state.activeTab);
            if (!visible.length) {
                listEl.innerHTML = `<div class="hub-empty">${state.activeTab === 'misc' ? 'Nenhum adicional.' : 'Nenhum módulo.'}</div>`;
                return;
            }
            visible.forEach((mod, idx) => {
                const status = state.moduleStates[mod.id] || STATUS.UNLOADED;
                const isAdminMod = mod.admin === true;
                const adminLocked = isAdminMod && !_adminUnlocked();
                const item = document.createElement('div');
                item.className = 'hub-item state-' + status + (adminLocked ? ' admin-locked' : '');
                item.dataset.modId = mod.id;
                item.style.animationDelay = Math.min(idx * 32, 220) + 'ms';
                item.setAttribute('role', 'button');
                item.setAttribute('tabindex', '0');
                item.innerHTML = `
                    <div class="hub-icon">${parseIcon(mod.icon)}</div>
                    <div class="hub-info">
                        <div class="hub-name">${escapeHtml(mod.name)}</div>
                        <div class="hub-desc">${escapeHtml(mod.description || '')}</div>
                    </div>
                    <span class="hub-chip ${status}">${status === STATUS.UNLOADED ? 'OFF' : status === STATUS.LOADING ? '...' : status === STATUS.LOADED ? 'ATIVO' : 'ERR'}</span>
                `;
                const c = item.querySelector('.hub-gif-frozen');
                const l = item.querySelector('.hub-gif-live');
                if (c && l) setupGifIcon(item, c, l, l.getAttribute('data-original'));
                item.addEventListener('mouseenter', () => window._hubSFX?.hover?.());
                item.addEventListener('click', () => handleModuleClick(mod));
                listEl.appendChild(item);
            });
        };
        renderChromeFn = () => {
            syncDot.className = 'hub-sync-dot ' + state.syncState;
            syncSubtitle.textContent = state.syncState === 'loading' ? 'sincronizando…' :
                                       state.syncState === 'synced' ? 'sync ' + (state.lastSyncAt || '') : 'falha';
            ftrMid.textContent = state.manifest.version ? 'v' + state.manifest.version : '·';
        };

        window.addEventListener('sang:module-close', (e) => {
            const id = e?.detail?.id;
            if (!id || state.moduleStates[id] !== STATUS.LOADED) return;
            state.moduleStates[id] = STATUS.UNLOADED;
            if (renderListFn) renderListFn();
            flashItem(id, 'ok');
        }, { signal: ac.signal });
        window.addEventListener('sang:voz-state', tentarRegistrarHandlerVoz, { signal: ac.signal });
        window.addEventListener('sang:voz-ready', tentarRegistrarHandlerVoz, { signal: ac.signal });
        window.addEventListener('sang:admin-state', () => { if (renderListFn) renderListFn(); }, { signal: ac.signal });
        try { window.dispatchEvent(new CustomEvent('sang:voz-query')); } catch(_) {}

        const clockEl = pill.querySelector('#' + UID + 'clock');
        const sessionEl = pill.querySelector('#' + UID + 'sessiontime');
        const totalEl = pill.querySelector('#' + UID + 'totaltime');
        function renderPillStats() {
            clockEl.textContent = formatClock();
            sessionEl.textContent = formatDuration(sessionElapsedMs());
            totalEl.textContent = formatDuration(currentTotalMs());
        }
        const clockTimer = setInterval(() => {
            if (state.killFlag) return;
            if (!pill.classList.contains('hidden')) renderPillStats();
        }, CLOCK_TICK_MS);
        renderPillStats();
        renderListFn();
        renderChromeFn();

        const nameEl = pill.querySelector('#' + UID + 'playername');
        const missionEl = pill.querySelector('#' + UID + 'playermission');
        const avatarEl = pill.querySelector('#' + UID + 'playeravatar');

        function aplicarInfoJogadorNaPill() {
            const c = loadPlayerCache();
            if (!c) return;
            nameEl.textContent = c.name || '—';
            missionEl.textContent = c.mission || '—';
            if (c.avatarUrl) {
                avatarEl.innerHTML = `<img src="${c.avatarUrl}" style="position:absolute;top:-25%;left:-40%;width:210%;height:210%;object-fit:cover" alt="avatar" />`;
            }
        }
        aplicarInfoJogadorNaPill();
        window.addEventListener('sang:player-updated', aplicarInfoJogadorNaPill, { signal: ac.signal });

        function kill() {
            _cancelDrags();
            clearTimeout(_crossfadeTimer);
            limparHandlerVoz();
            state.killFlag = true;
            voiceActive = false;
            if (recognition) try { recognition.stop(); } catch(e) {}
            flushPlaytime();
            if (state.updateTimer) clearTimeout(state.updateTimer);
            if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
            clearInterval(clockTimer);
            if (playtime.flushTimer) clearInterval(playtime.flushTimer);
            if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
            ac.abort();
            document.querySelectorAll('#' + UID + ', #' + UID + 'pill, style[data-hub]').forEach(el => el.remove());
        }
        window._hubUI = { kill, markProtected(el) { el?.setAttribute?.('data-sang-ui', ''); return el; } };

        window._hubBridge = {
            get state() { return state; },
            STATUS,
            HUB_VERSION,
            get deviceId() { return _deviceId; },
            get fingerprint() { return _fp; },
            get antiLag() { return _antiLag; },
            setAntiLag(v) {
                _antiLag = !!v;
                try { localStorage.setItem(ANTILAG_KEY, _antiLag ? '1' : '0'); } catch(e) {}
                _aplicarAntiLag(_antiLag);
                return _antiLag;
            },
            refreshManifest,
            deactivateModule,
            activateModule,
            toast: (msg, kind) => { if (toastFn) toastFn(msg, kind); },
            log: HLOG, warn: HWARN, err: HERR,

            player: {
                get raw()         { return loadPlayerCache(); },
                get name()        { return (loadPlayerCache() || {}).name || ''; },
                get mission()     { return (loadPlayerCache() || {}).mission || ''; },
                get avatarUrl()   { return (loadPlayerCache() || {}).avatarUrl || ''; },
                get capturedAt()  { return (loadPlayerCache() || {}).capturedAt || 0; },
                refresh() { _aplicarCacheJogador(); return loadPlayerCache(); }
            },

            sfx: {
                muted: () => !!window._hubSFX?.isMuted?.(),
                setMuted: (v) => window._hubSFX?.setMuted?.(v),
                play: (name) => { try { window._hubSFX?.[name]?.(); } catch(_) {} }
            },

            admin: {
                unlocked: _adminUnlocked,
                notify() { try { window.dispatchEvent(new CustomEvent('sang:admin-state')); } catch(_) {} }
            },

            mic: {
                available: () => !!(_micReady && _micReady.ok),
                state: () => _mic.active ? 'connected' : (_mic.banner ? 'incoming' : 'idle'),
                currentCaller: () => _mic.offer?.fromName || null,
                accept: _micAccept,
                reject: _micReject,
                stop: _micStop
            },

            phone: {
                // phone module chama isso quando:
                //  - tenta ligar para alguém offline (reason 'offline')
                //  - chamou, mas timeout (reason 'no_answer')
                //  - alvo estava ocupado (reason 'busy')
                registerMissedCall: (payload) => _registrarMissedCall(payload)
            },

            gate: {
                get fp() { return _fp; },
                get secretOn() { return _secretOn; },
                get blocked() { return _blocked; },
                get mode() {
                    const o = localStorage.getItem(_ovr);
                    return o === '0' ? 'off' : o === '1' ? 'on' : 'auto';
                },
                async setMode(m) {
                    if (m === 'auto') localStorage.removeItem(_ovr);
                    else localStorage.setItem(_ovr, m === 'on' ? '1' : '0');
                    await _gate();
                    return _secretOn;
                },
                recompute: _gate
            },
            blk: {
                fixed: () => _blk.slice(),
                extra: _getBlkExtra,
                async add(fp) {
                    const a = _getBlkExtra();
                    if (!a.includes(fp) && !_blk.includes(fp)) { a.push(fp); _setBlkExtra(a); }
                    await _gate();
                },
                async remove(fp) {
                    const a = _getBlkExtra();
                    const i = a.indexOf(fp);
                    if (i > -1) { a.splice(i, 1); _setBlkExtra(a); }
                    await _gate();
                },
                full: _fullBlk
            },
            firestore: {
                configured: fsConfigured,
                request: fsRequest,
                parseDoc: fsParseDoc,
                value: fsValue
            },
            rtdb: {
                url: RTDB_URL,
                get: _rtdbGet,
                put: _rtdbPut,
                post: _rtdbPost,
                del: _rtdbDelete
            }
        };

        showPill();
    }

    // ═══ BOOT ═══
    async function boot() {
        await new Promise(resolve => {
            if (document.body) return resolve();
            const iv = setInterval(() => { if (document.body) { clearInterval(iv); resolve(); } }, 80);
        });

        await _gate();
        _iniciarHeartbeat();
        _iniciarBlockWatcher();

        window.addEventListener('storage', (e) => {
            if (e.key === PLAYER_CACHE_KEY && e.newValue) {
                HLOG('📥 Cache do jogador atualizado em outra aba — reenviando heartbeat');
                _aplicarCacheJogador();
            }
            if (e.key === ADMIN_TOKEN_KEY) {
                try { if (renderListFn) renderListFn(); } catch(_) {}
            }
            if (e.key === ANTILAG_KEY) {
                try {
                    _antiLag = e.newValue === '1';
                    if (uiRoot) uiRoot.classList.toggle('anti-lag', _antiLag);
                    if (uiPill) uiPill.classList.toggle('anti-lag', _antiLag);
                    const btn = uiRoot?.querySelector('#_hubantilag');
                    if (btn) {
                        btn.classList.toggle('active', _antiLag);
                        btn.title = _antiLag ? 'Modo anti-lag ATIVO (clique para desligar)' : 'Modo anti-lag (desligar efeitos)';
                    }
                } catch(_) {}
            }
        });

        if (_blocked) {
            HLOG('🚫 Bloqueado no boot — toast apenas');
            _mostrarBloqueioToast();
            return;
        }

        buildUI();

        // ═══ PHONE FIREBASE ═══
        // Carrega o Firebase exclusivo do telefone ANTES do autoload do manifesto.
        // O shell do phone faz fallback transparente para o bridge do hub se este
        // arquivo não carregar — não quebra se o worker estiver fora do ar.
        try {
            const r = await fetch(PHONE_FIREBASE_URL + '?t=' + Date.now(), { cache: 'no-store' });
            if (r.ok) {
                const s = document.createElement('script');
                s.textContent = await r.text();
                document.documentElement.appendChild(s);
                s.remove();
                HLOG('📱 Phone Firebase carregado');
            } else {
                HWARN('Phone Firebase: HTTP', r.status);
            }
        } catch(e) { HWARN('Phone Firebase falhou:', e); }

        await refreshManifest(false);
        setTimeout(_carregarAdmin, 1500);

        setTimeout(() => { _micStartListener().catch(e => HWARN('Mic listener falhou:', e)); }, 2500);

        // Rede de segurança: limpa missed calls órfãs se o phone não estiver rodando
        setTimeout(async () => {
            if (window._phone) return; // phone cuida do próprio ciclo
            try {
                const data = await fsRequest('GET', '/' + COL_MISSED);
                const docs = data?.documents || [];
                let n = 0;
                for (const d of docs) {
                    const id = d.name.split('/').pop();
                    const parsed = fsParseDoc(d);
                    if (parsed.toDeviceId !== _deviceId) continue;
                    n++;
                    try { await fsRequest('DELETE', '/' + COL_MISSED + '/' + id); } catch(_) {}
                }
                if (n > 0) HLOG('📭', n, 'chamada(s) perdida(s) pendente(s) para o phone consumir');
            } catch(e) {}
        }, 4000);

        playtime.flushTimer = setInterval(flushPlaytime, PLAYTIME_FLUSH_MS);
        window.addEventListener('beforeunload', flushPlaytime);

        if (!state.killFlag) {
            state.updateTimer = setTimeout(autoUpdateLoop, UPDATE_INTERVAL_MS);
        }

        state.heartbeatTimer = setInterval(() => {
            if (state.killFlag) return;
            if (!state.updateTimer) state.updateTimer = setTimeout(autoUpdateLoop, UPDATE_INTERVAL_MS);
        }, 60000);
    }

    boot().catch(e => HERR('❌ Erro fatal:', e));
})();
