// ==UserScript==
// @name         Sang Hub
// @namespace    http://tampermonkey.net/
// @version      1.5.2
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
            if (captureFromMePage() || attempts >= 20) clearInterval(captureInterval);
        }, 500);
        return;
    }

    // ═══ LOG ═══
    const HLOG  = (...a) => console.log('🔶 [Hub]', ...a);
    const HWARN = (...a) => console.warn('🔶 [Hub]', ...a);
    const HERR  = (...a) => console.error('🔶 [Hub]', ...a);

    // ═══ CONSTANTES ═══
    const HUB_VERSION = "1.5.2";
    const HUB_UPDATE_URL = "https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/hub2.js";
    const MANIFEST_URL = "https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/manifest.json";
    const PHONE_FIREBASE_URL = "https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/phone-firebase.js";
    const HUB_UI_URL = "https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/hub-ui.js";
    const HUB_RTC_URL = "https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/hub-rtc.js";
    const UPDATE_INTERVAL_MS = 3 * 60 * 1000;
    const MANIFEST_CACHE_MS  = 2 * 60 * 1000;
    const FETCH_TIMEOUT_MS   = 5000;
    const FETCH_RETRIES      = 2;
    const SHORTCUT_KEY   = 'h';
    const SHORTCUT_LABEL = 'Alt+Shift+H';
    const PLAYTIME_KEY       = 'sanghub_playtime_total_ms';
    const PLAYTIME_FLUSH_MS  = 60 * 1000;
    const PLAYER_CACHE_KEY   = 'sanghub_player_cache';
    const VOICE_KEY          = 'sanghub_voice_enabled';
    const VOICE_COOLDOWN_MS  = 1200;
    const SFX_MUTED_KEY      = 'sanghub_sfx_muted';
    const ANTILAG_KEY        = 'sanghub_antilag';
    const RTDB_URL = 'https://sanghub-ecf46-default-rtdb.firebaseio.com';
    const MIC_OFFER_TTL_MS = 60000;
    const COL_MISSED = 'phone_missed';
    const FIREBASE_PROJECT_ID = 'sanghub-ecf46';
    const FIREBASE_API_KEY    = 'AIzaSyCffa6tw3mSzTJtq_u2AVz9w1PRnTAGJyI';
    const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const FS_AUTH_KEY = 'sanghub_fs_auth';
    const FS_READS_KEY = 'sanghub_fs_reads';
    const HEARTBEAT_MS = 2 * 60 * 1000;
    const BLOCK_POLL_MS = 60 * 1000;
    const DEVICE_ID_KEY = 'sanghub_device_id';
    const ADMIN_TOKEN_KEY = 'sanghub_admin_token';
    const ADMIN_TTL = 30 * 24 * 60 * 60 * 1000;
    const LEADER_KEY = 'sanghub_leader_v1';
    const LEADER_TTL_MS = 6000;
    const LEADER_TICK_MS = 2000;
    const TAB_ID = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const ADMIN_MODULE = {
        id: 'admin', name: 'Admin', instanceKey: '_admin',
        url: 'https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu/admin.js'
    };
    const STATUS = { UNLOADED: 'unloaded', LOADING: 'loading', LOADED: 'loaded', ERROR: 'error' };
    const TABS   = [{ id: 'modules', label: 'Módulos' }, { id: 'misc', label: 'Adicionais' }];
    const SESSION_STATIC_FIELDS = ['name', 'mission', 'ua', 'sessionStart', 'fingerprint', 'expireAt'];

    // ═══ STATE ═══
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

    // ═══ TIMERS REGISTRY ═══
    const _timers = { heartbeat: null, blockWatcher: null, playtimeFlush: null, watchdog: null };
    function _clearAllTimers() {
        for (const k of Object.keys(_timers)) {
            const t = _timers[k];
            if (t) { try { clearInterval(t); } catch(_) {} try { clearTimeout(t); } catch(_) {} _timers[k] = null; }
        }
        if (state.updateTimer) { try { clearTimeout(state.updateTimer); } catch(_) {} state.updateTimer = null; }
        if (_heartbeatTimer) { try { clearInterval(_heartbeatTimer); } catch(_) {} _heartbeatTimer = null; }
        if (_blockWatcherId) { try { clearInterval(_blockWatcherId); } catch(_) {} _blockWatcherId = null; }
        if (playtime.flushTimer) { try { clearInterval(playtime.flushTimer); } catch(_) {} playtime.flushTimer = null; }
    }

    // ═══ UTILS ═══
    function escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }
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

    // ═══ GATE / IDENTIDADE ═══
    const _blk = ['fa58cccd9de60c7a30726b2c23670a5747d4b5e684a935fae5954548873f1031'];
    const _blkExtraKey = 'sanghub_blk_extra';
    const _ovr = 'sanghub_p2';
    let _secretOn = true, _blocked = false, _fp = '', _deviceId = '';
    let _antiLag = false;
    try { _antiLag = localStorage.getItem(ANTILAG_KEY) === '1'; } catch(e) {}

    function _stableUA() { return navigator.userAgent.replace(/\d+\.\d+\.\d+\.\d+/g, ''); }
    async function _calc() {
        const parts = [
            _stableUA(), navigator.language.split('-')[0], navigator.hardwareConcurrency,
            screen.width + 'x' + screen.height, new Date().getTimezoneOffset(),
            Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.platform
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
    function _setBlkExtra(arr) { try { localStorage.setItem(_blkExtraKey, JSON.stringify(arr)); } catch(e) {} }
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
        } catch(e) { _secretOn = true; _blocked = false; }
    }

    // ═══ FIRESTORE ═══
    function fsConfigured() { return FIREBASE_PROJECT_ID !== 'SEU_PROJECT_ID' && FIREBASE_API_KEY !== 'SUA_WEB_API_KEY'; }
    function fsValue(v) {
        if (v === null || v === undefined) return { nullValue: null };
        if (typeof v === 'boolean') return { booleanValue: v };
        if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
        return { stringValue: String(v) };
    }
    function fsTimestamp(ms) { return { timestampValue: new Date(ms).toISOString() }; }
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
    function _contarRead() {
        try {
            const hoje = new Date().toISOString().slice(0, 10);
            const raw = JSON.parse(localStorage.getItem(FS_READS_KEY) || '{}');
            if (raw.date !== hoje) { raw.date = hoje; raw.count = 0; }
            raw.count = (raw.count || 0) + 1;
            localStorage.setItem(FS_READS_KEY, JSON.stringify(raw));
        } catch(_) {}
    }
    function _readsHoje() {
        try {
            const raw = JSON.parse(localStorage.getItem(FS_READS_KEY) || '{}');
            if (raw.date !== new Date().toISOString().slice(0, 10)) return 0;
            return raw.count || 0;
        } catch(_) { return 0; }
    }
    let _fsAuth = null;
    function _fsLoadAuth() { try { return JSON.parse(localStorage.getItem(FS_AUTH_KEY) || 'null'); } catch(e) { return null; } }
    function _fsSaveAuth(a) { try { localStorage.setItem(FS_AUTH_KEY, JSON.stringify(a)); } catch(e) {} }
    async function _fsSignUp() {
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ returnSecureToken: true })
        });
        if (!res.ok) throw new Error('auth HTTP ' + res.status);
        const d = await res.json();
        const ttl = Number(d.expiresIn) || 3600;
        return { idToken: d.idToken, refreshToken: d.refreshToken, expiresAt: Date.now() + (ttl * 1000) - 60000 };
    }
    async function _fsRefresh(refreshToken) {
        const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
        try { _fsAuth = (_fsAuth && _fsAuth.refreshToken) ? await _fsRefresh(_fsAuth.refreshToken) : await _fsSignUp(); }
        catch(e) { _fsAuth = await _fsSignUp(); }
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
        if (res.ok && method === 'GET') _contarRead();
        if (!res.ok) throw new Error('FS HTTP ' + res.status + ' (' + path + ')');
        if (res.status === 204) return null;
        return res.json();
    }
    async function fsRunQuery(collectionId, fieldPaths, extraWhere) {
        if (!fsConfigured()) throw new Error('Firestore não configurado');
        const token = await _fsGetToken();
        const structuredQuery = {
            from: [{ collectionId }],
            select: { fields: (fieldPaths || ['name', 'lastSeen', 'blocked', 'hubVersion']).map(f => ({ fieldPath: f })) }
        };
        if (extraWhere) structuredQuery.where = extraWhere;
        const res = await fetch(FS_BASE + ':runQuery', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery })
        });
        if (!res.ok) throw new Error('FS runQuery HTTP ' + res.status);
        _contarRead();
        const arr = await res.json();
        return (arr || []).filter(r => r.document).map(r => ({ name: r.document.name, fields: r.document.fields }));
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
        } catch(e) { return false; }
    }

    // ═══ LEADER ELECTION (multi-tab) ═══
    let _isLeader = false;
    let _leaderTimer = null;
    let _onLeaderGained = null;

    function _lerLeader() {
        try {
            const raw = localStorage.getItem(LEADER_KEY);
            if (!raw) return null;
            const o = JSON.parse(raw);
            if (!o || Date.now() - o.ts > LEADER_TTL_MS) return null;
            return o;
        } catch(_) { return null; }
    }
    function _escreverLeader() {
        try { localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, ts: Date.now() })); } catch(_) {}
    }
    function _tickLeader() {
        const atual = _lerLeader();
        if (!atual || atual.id === TAB_ID) {
            _escreverLeader();
            if (!_isLeader) {
                _isLeader = true;
                HLOG('👑 aba líder — loops de rede neste contexto');
                try { _onLeaderGained?.(); } catch(_) {}
            }
        } else if (_isLeader) {
            _isLeader = false;
            HLOG('aba secundária — loops de rede delegados');
        }
    }
    function _iniciarLeaderElection() {
        if (_leaderTimer) return;
        _tickLeader();
        _leaderTimer = setInterval(_tickLeader, LEADER_TICK_MS);
        window.addEventListener('beforeunload', () => {
            try { if (_isLeader) localStorage.removeItem(LEADER_KEY); } catch(_) {}
        });
    }

    // ═══ SESSÃO / HEARTBEAT ═══
    let _heartbeatTimer = null;
    let _hbTick = 0;

    async function _upsertSession(completo) {
        if (!fsConfigured() || !_deviceId) return;
        const player = loadPlayerCache() || {};
        const now = Date.now();
        const campos = { lastSeen: fsValue(now), hubVersion: fsValue(HUB_VERSION) };
        let mask = 'updateMask.fieldPaths=lastSeen&updateMask.fieldPaths=hubVersion';
        if (completo) {
            campos.name         = fsValue(player.name || '');
            campos.mission      = fsValue(player.mission || '');
            campos.ua           = fsValue(navigator.userAgent.slice(0, 120));
            campos.sessionStart = fsValue(now);
            campos.fingerprint  = fsValue(_fp || '');
            campos.expireAt     = fsTimestamp(now + SESSION_TTL_MS);
            mask += SESSION_STATIC_FIELDS.map(f => '&updateMask.fieldPaths=' + f).join('');
        }
        try { await fsRequest('PATCH', '/sessions/' + _deviceId, { fields: campos }, mask); }
        catch(e) { HWARN('Upsert sessão falhou:', e); }
    }
    async function _iniciarHeartbeat() {
        if (!fsConfigured() || _heartbeatTimer) return;
        _hbTick = 0;
        await _upsertSession(true);
        _heartbeatTimer = setInterval(async () => {
            if (!_isLeader) return;
            if (state.killFlag && !_blocked) return;
            _hbTick++;
            await _upsertSession(_hbTick % 5 === 0);
        }, HEARTBEAT_MS);
        _timers.heartbeat = _heartbeatTimer;
    }
    function _aplicarCacheJogador() {
        try { _upsertSession(true); } catch(e) {}
        try { window.dispatchEvent(new CustomEvent('sang:player-updated', { detail: loadPlayerCache() })); }
        catch(e) { HWARN('dispatch player-updated falhou:', e); }
    }

    // ═══ BLOQUEIO — SSE via RTDB (sinal instantâneo) ═══
    let _blockEsDev = null;
    let _blockEsFp  = null;
    let _blockUntilTimer = null;

    function _aplicarBlockState(novo) {
        const antes = _blocked;
        if (antes === novo) return;
        _blocked = novo;
        if (novo) {
            HLOG('🚫 Bloqueio detectado — encerrando');
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
    }
    async function _recheckBlockOneShot() {
        const antes = _blocked;
        const agora = await _verificarBloqueioRemoto();
        if (agora === antes) return;
        if (!agora && _deviceId) {
            try { await _rtdbPut('blocks/' + _deviceId, false); } catch(_) {}
            if (_fp) { try { await _rtdbPut('blocks/fp/' + _fp, false); } catch(_) {} }
        }
        _aplicarBlockState(agora);
    }
    function _agendarRecheckUntil(until) {
        if (_blockUntilTimer) { clearTimeout(_blockUntilTimer); _blockUntilTimer = null; }
        if (!until || until <= Date.now()) return;
        _blockUntilTimer = setTimeout(() => {
            _blockUntilTimer = null;
            _recheckBlockOneShot();
        }, until - Date.now() + 1000);
    }
    function _abrirBlockSse(path, isFp) {
        try {
            const es = new EventSource(`${RTDB_URL}/${path}.json`);
            const onVal = (raw) => {
                try {
                    const env = JSON.parse(raw);
                    const v = env?.data;
                    let agora = false, until = 0;
                    if (v === true) agora = true;
                    else if (v && typeof v === 'object') {
                        until = v.until || 0;
                        agora = v.blocked === true && (!until || until > Date.now());
                    }
                    if (until > Date.now()) _agendarRecheckUntil(until);
                    _aplicarBlockState(agora);
                } catch(_) {}
            };
            es.addEventListener('put', e => onVal(e.data));
            es.addEventListener('patch', e => onVal(e.data));
            es.onopen = () => { if (!isFp) _recheckBlockOneShot(); };
            es.onerror = () => {};
            return es;
        } catch(_) { return null; }
    }
    function _iniciarBlockSse() {
        if (_blockEsDev || !_deviceId) return;
        _blockEsDev = _abrirBlockSse('blocks/' + _deviceId, false);
        if (_fp) _blockEsFp = _abrirBlockSse('blocks/fp/' + _fp, true);
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
        el.style.cssText = `position:fixed;inset:-30px;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 35%,rgba(251,113,133,0.10),transparent 55%),radial-gradient(circle at 20% 80%,rgba(167,139,250,0.06),transparent 50%),rgba(0,0,0,0.72);backdrop-filter:blur(10px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;animation:_hbFadeIn .3s ease,_hbScreenShake .62s cubic-bezier(.36,.07,.19,.97) .05s;will-change:transform;`;
        el.innerHTML = `<div style="max-width:380px;padding:30px 26px;text-align:center;border-radius:18px;border:1px solid rgba(251,113,133,0.28);background:linear-gradient(175deg,rgba(22,16,26,0.96),rgba(10,8,14,0.98));box-shadow:0 30px 80px rgba(0,0,0,0.8),0 0 80px rgba(251,113,133,0.12);animation:_hbPopIn .35s cubic-bezier(0.16,1,0.3,1);">
            <div style="width:54px;height:54px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;border-radius:15px;background:rgba(251,113,133,0.12);border:1px solid rgba(251,113,133,0.35);">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fb7185" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9.5" y1="9.5" x2="14.5" y2="14.5"/><line x1="14.5" y1="9.5" x2="9.5" y2="14.5"/></svg>
            </div>
            <div style="font-size:16px;font-weight:800;color:#fff;letter-spacing:.02em;margin-bottom:6px;">Dispositivo bloqueado</div>
            <div style="font-size:11.5px;color:#9ca3af;line-height:1.55;margin-bottom:18px;">Sua sessão foi bloqueada pelo administrador.<br>O acesso ao hub foi encerrado.</div>
            <button id="_hubBlockClose" style="cursor:pointer;font-family:inherit;padding:9px 22px;border-radius:9px;font-size:11px;font-weight:700;background:rgba(251,113,133,0.12);border:1px solid rgba(251,113,133,0.35);color:#fca5b1;letter-spacing:.04em;">Fechar</button>
        </div>`;
        document.body.appendChild(el);
        _blockOverlayEl = el;
        el.querySelector('#_hubBlockClose').addEventListener('click', () => _removerBloqueioOverlay());
    }
    function _removerBloqueioOverlay() {
        if (!_blockOverlayEl) return;
        const el = _blockOverlayEl;
        _blockOverlayEl = null;
        try { el.style.transition = 'opacity .2s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 220); }
        catch(e) { el.remove(); }
    }
    function _mostrarBloqueioToast() {
        _ensureBlockStyle();
        const el = document.createElement('div');
        el.id = '_hubBlockToast';
        el.setAttribute('data-hub-block', '1');
        el.setAttribute('data-sang-ui', '');
        el.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483646;display:flex;align-items:center;gap:11px;padding:12px 16px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(175deg,rgba(22,16,26,0.96),rgba(10,8,14,0.98));border:1px solid rgba(251,113,133,0.32);box-shadow:0 12px 32px rgba(0,0,0,0.6),0 0 40px rgba(251,113,133,0.1);backdrop-filter:blur(12px);animation:_hbSlideIn .35s cubic-bezier(0.16,1,0.3,1),_hbToastShake .5s cubic-bezier(.36,.07,.19,.97) .1s;max-width:300px;`;
        el.innerHTML = `<span style="flex-shrink:0;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:rgba(251,113,133,0.12);border:1px solid rgba(251,113,133,0.32);"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fb7185" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span><div style="min-width:0;"><div style="font-size:11.5px;font-weight:800;color:#fff;letter-spacing:.02em;">Você está bloqueado</div><div style="font-size:9.5px;color:#9ca3af;margin-top:2px;">O acesso ao hub foi desativado.</div></div>`;
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
        el.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483647;display:flex;align-items:center;gap:11px;padding:12px 16px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(175deg,rgba(16,26,22,0.96),rgba(8,14,12,0.98));border:1px solid rgba(52,211,153,0.36);box-shadow:0 12px 32px rgba(0,0,0,0.6),0 0 40px rgba(52,211,153,0.15);backdrop-filter:blur(12px);animation:_hbSlideIn .35s cubic-bezier(0.16,1,0.3,1);max-width:320px;`;
        el.innerHTML = `<span style="flex-shrink:0;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:rgba(52,211,153,0.12);border:1px solid rgba(52,211,153,0.36);"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg></span><div style="min-width:0;"><div style="font-size:11.5px;font-weight:800;color:#fff;letter-spacing:.02em;">Desbloqueado</div><div style="font-size:9.5px;color:#9ca3af;margin-top:2px;">Recarregando o hub…</div></div>`;
        document.body.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity .3s, transform .3s';
            el.style.opacity = '0';
            el.style.transform = 'translateX(20px)';
            setTimeout(() => el.remove(), 300);
        }, 1200);
    }
    function _autodestruir() {
        HLOG('💥 Autodestruindo hub (UI/RTC/admin) — session watchdog segue vivo');
        state.killFlag = true;
        try { window._admin?.kill?.(); } catch(e) {}
        try { window._hubUI?.kill?.(); } catch(e) {}
        try { window._hubRTC?.kill?.(); } catch(e) {}
        // limpa apenas os timers de UI/refresh; preserva heartbeat e block watcher
        if (state.updateTimer) { try { clearTimeout(state.updateTimer); } catch(_) {} state.updateTimer = null; }
        if (playtime.flushTimer) { try { clearInterval(playtime.flushTimer); } catch(_) {} playtime.flushTimer = null; }
        _timers.playtimeFlush = null;
        _timers.watchdog = null;
        // garante heartbeat e block watcher vivos para detectar o desbloqueio
        if (!_heartbeatTimer && fsConfigured() && _deviceId && _isLeader) {
            _upsertSession(false);
            _heartbeatTimer = setInterval(() => { if (_isLeader) _upsertSession(false); }, HEARTBEAT_MS);
            _timers.heartbeat = _heartbeatTimer;
        }
        if (!_blockWatcherId && _isLeader) _iniciarBlockWatcher();
        if (!_blockEsDev) _iniciarBlockSse();
    }
    let _blockWatcherId = null;
    function _iniciarBlockWatcher() {
        if (_blockWatcherId) return;
        _blockWatcherId = setInterval(async () => {
            if (!_isLeader) return;
            if (state.killFlag && !_blocked) return;
            try {
                const antesB = _blocked, antesS = _secretOn;
                await _gate();
                if (antesB !== _blocked) {
                    _aplicarBlockState(_blocked);
                    return;
                }
                if (antesS !== _secretOn) {
                    HLOG('🔐 Módulos secret mudaram — refresh');
                    try { refreshManifest(true); } catch(e) {}
                }
            } catch(e) { HWARN('blockWatcher:', e); }
        }, BLOCK_POLL_MS);
        _timers.blockWatcher = _blockWatcherId;
    }
    async function _carregarAdmin() {
        if (window._admin) return;
        try { await loadModule(ADMIN_MODULE); }
        catch(e) { HERR('Falha admin:', e); }
    }
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            if (_blocked || state.killFlag) return;
            if (window._admin?.toggle) window._admin.toggle();
            else _carregarAdmin().then(() => window._admin?.toggle?.());
        }
    });

    // ═══ RTDB ═══
    function _rtdbUrl(path) { return RTDB_URL + '/' + path + '.json'; }
    async function _rtdbGet(path) {
        try { const r = await fetch(_rtdbUrl(path), { cache: 'no-store' }); return r.ok ? await r.json() : null; }
        catch(e) { return null; }
    }
    async function _rtdbPut(path, value) {
        try { const r = await fetch(_rtdbUrl(path), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); return r.ok; }
        catch(e) { return false; }
    }
    async function _rtdbPost(path, value) {
        try { const r = await fetch(_rtdbUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); return r.ok; }
        catch(e) { return false; }
    }
    async function _rtdbDelete(path) { try { await fetch(_rtdbUrl(path), { method: 'DELETE' }); } catch(e) {} }

    // ═══ SFX ═══
    (function setupSfx() {
        if (window._hubSFX) return;
        let actx = null, muted = false, _dragCount = 0;
        try { muted = localStorage.getItem(SFX_MUTED_KEY) === '1'; } catch(e) {}
        function ctx() {
            if (actx) return actx;
            try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { actx = null; }
            return actx;
        }
        function tone(freq, dur, type, peak, attack) {
            if (muted) return;
            const c = ctx(); if (!c) return;
            if (c.state === 'suspended') c.resume().catch(() => {});
            const now = c.currentTime;
            const osc = c.createOscillator(), lp = c.createBiquadFilter(), gain = c.createGain();
            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freq, now);
            lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.min(freq * 2.6, 3200), now); lp.Q.setValueAtTime(0.6, now);
            const a = attack != null ? attack : 0.012;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(peak || 0.03, now + a);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            osc.connect(lp).connect(gain).connect(c.destination);
            osc.start(now); osc.stop(now + dur + 0.03);
        }
        function sweep(f1, f2, dur, peak) {
            if (muted) return;
            const c = ctx(); if (!c) return;
            if (c.state === 'suspended') c.resume().catch(() => {});
            const now = c.currentTime;
            const osc = c.createOscillator(), lp = c.createBiquadFilter(), gain = c.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f1, now);
            osc.frequency.exponentialRampToValueAtTime(f2, now + dur);
            lp.type = 'lowpass'; lp.frequency.setValueAtTime(f2 > f1 ? 2200 : 1600, now); lp.Q.setValueAtTime(0.5, now);
            const attack = f2 > f1 ? 0.10 : 0.03;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(peak || 0.011, now + attack);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.06);
            osc.connect(lp).connect(gain).connect(c.destination);
            osc.start(now); osc.stop(now + dur + 0.10);
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
            hover() { if (_dragCount > 0) return; const t = performance.now(); if (t - lastHover < 70) return; lastHover = t; tone(320, 0.13, 'sine', 0.0055, 0.045); },
            expand() { if (_dragCount > 0) return; sweep(420, 720, 0.30, 0.0075); setTimeout(() => tone(880, 0.18, 'sine', 0.0045, 0.06), 55); },
            toggleOn() { tone(392, 0.14, 'sine', 0.0085, 0.05); setTimeout(() => tone(523.25, 0.16, 'sine', 0.0065, 0.055), 60); },
            toggleOff() { tone(349.23, 0.15, 'sine', 0.0085, 0.05); setTimeout(() => tone(261.63, 0.20, 'sine', 0.006, 0.06), 65); },
            success() { tone(659.25, 0.09, 'sine', 0.020, 0.014); setTimeout(() => tone(783.99, 0.10, 'sine', 0.017, 0.014), 70); setTimeout(() => tone(987.77, 0.16, 'sine', 0.014, 0.016), 140); },
            error() { tone(330, 0.11, 'sine', 0.020, 0.014); setTimeout(() => tone(262, 0.18, 'sine', 0.017, 0.018), 80); },
            alert() { tone(240, 0.16, 'sine', 0.055, 0.006); setTimeout(() => tone(190, 0.20, 'sine', 0.050, 0.008), 80); setTimeout(() => tone(145, 0.34, 'sine', 0.042, 0.012), 175); },
            unblocked() { tone(523.25, 0.10, 'sine', 0.028, 0.010); setTimeout(() => tone(659.25, 0.11, 'sine', 0.026, 0.012), 70); setTimeout(() => tone(880.00, 0.18, 'sine', 0.022, 0.014), 150); },
            whoosh(direction) { if (direction === 'open') sweep(240, 1320, 0.38, 0.009); else sweep(1320, 240, 0.26, 0.013); },
            pickup() { tone(760, 0.05, 'sine', 0.014, 0.010); },
            drop()   { tone(200, 0.16, 'sine', 0.015, 0.026); },
            ring() { if (muted) return; const burst = (d) => setTimeout(() => { tone(440, 0.42, 'sine', 0.032, 0.028); tone(659.25, 0.42, 'sine', 0.024, 0.028); }, d); burst(0); burst(620); },
            micOn()  { tone(523.25, 0.10, 'sine', 0.024, 0.012); setTimeout(() => tone(783.99, 0.14, 'sine', 0.020, 0.014), 70); },
            micOff() { tone(523.25, 0.11, 'sine', 0.022, 0.012); setTimeout(() => tone(311.13, 0.16, 'sine', 0.018, 0.014), 70); }
        };
        document.addEventListener('click', () => { try { ctx()?.resume(); } catch(e) {} }, { once: true, capture: true });
    })();

    // ═══ WEBSOCKET HOOK ═══
    (function setupSocketHook() {
        if (window._hubSocket) return;
        const connectCbs = [], messageCbs = [];
        let active = null;
        const OriginalWebSocket = window.WebSocket;
        function HookedWebSocket(...args) {
            const ws = new OriginalWebSocket(...args);
            active = ws;
            connectCbs.forEach(cb => { try { cb(ws); } catch(e) {} });
            ws.addEventListener('message', (event) => { messageCbs.forEach(cb => { try { cb(event, ws); } catch(e) {} }); });
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
    function setCache(key, data) { try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch(e) {} }
    function getCachedManifest() { return getCache('sanghub_manifest_cache', MANIFEST_CACHE_MS); }
    function setCachedManifest(data) { setCache('sanghub_manifest_cache', data); }

    // ═══ PLAYTIME ═══
    function loadTotalPlaytimeMs() { try { return parseInt(localStorage.getItem(PLAYTIME_KEY) || '0', 10) || 0; } catch(e) { return 0; } }
    function saveTotalPlaytimeMs(ms) { try { localStorage.setItem(PLAYTIME_KEY, String(Math.floor(ms))); } catch(e) {} }
    const playtime = { baseTotalMs: loadTotalPlaytimeMs(), sessionStartedAt: Date.now(), flushTimer: null };
    function sessionElapsedMs() { return Date.now() - playtime.sessionStartedAt; }
    function currentTotalMs() { return playtime.baseTotalMs + sessionElapsedMs(); }
    function flushPlaytime() { saveTotalPlaytimeMs(currentTotalMs()); }

    // ═══ MODULE LOADER ═══
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
        } catch(e) { try { delete window[instanceKey]; } catch(e2) {} }
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
    function tryUnload(mod) { return mod.instanceKey ? killInstance(mod.instanceKey) : false; }

    // ═══ FETCH / MANIFEST / UPDATE ═══
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
            } catch(e) { lastErr = e; if (i < retries) await new Promise(r => setTimeout(r, 600 * (i + 1))); }
        }
        throw lastErr;
    }
    async function fetchManifest(bypassCache) {
        if (!bypassCache) { const c = getCachedManifest(); if (c) return c; }
        const res = await fetchWithRetry(MANIFEST_URL + '?t=' + Date.now(), { cache: 'no-store' }, FETCH_TIMEOUT_MS, FETCH_RETRIES);
        const data = await res.json();
        setCachedManifest(data);
        return data;
    }
    async function checkHubUpdate() {
        if (state.isUpdating || state.killFlag) return;
        state.isUpdating = true;
        try {
            const res = await fetchWithRetry(HUB_UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' }, 5000, 1);
            const code = await res.text();
            const m = code.match(/HUB_VERSION\s*=\s*["']([^"']+)["']/);
            if (!m) return;
            const v = m[1];
            if (v !== state.currentHubVersion) {
                window._hubBridge.ui?.toast?.('Atualizando Hub para v' + v + '...', 'ok');
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
            state.killFlag = true;
            if (window._hubUI?.kill) window._hubUI.kill();
            if (window._hubRTC?.kill) window._hubRTC.kill();
            _clearAllTimers();
            document.querySelectorAll('[data-hub]:not([data-hub-block]), [data-lb]').forEach(el => el.remove());
            const script = document.createElement('script');
            script.textContent = code;
            document.documentElement.appendChild(script);
            script.remove();
        } catch(e) { HERR('Falha ao aplicar:', e); }
    }
    function _emitUIUpdate(reason) {
        if (state.killFlag) return;
        try { window.dispatchEvent(new CustomEvent('sang:hub-ui-update', { detail: { reason } })); } catch(_) {}
    }
    async function refreshManifest(bypassCache) {
        if (state.killFlag) return;
        state.syncState = 'loading';
        _emitUIUpdate('chrome');
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
            window._hubBridge.ui?.toast?.('Erro ao carregar manifesto', 'error');
        }
        _emitUIUpdate('manifest');
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
    async function activateModule(mod) {
        if (state.moduleStates[mod.id] === STATUS.LOADING) return;
        if (mod.admin === true && !_adminUnlocked()) {
            window._hubSFX?.error?.();
            window._hubBridge.ui?.toast?.('Módulo em fase de Testes', 'error');
            _emitUIUpdate('state');
            return;
        }
        state.moduleStates[mod.id] = STATUS.LOADING;
        _emitUIUpdate('state');
        try {
            await loadModule(mod);
            state.moduleStates[mod.id] = STATUS.LOADED;
            tentarRegistrarHandlerVoz();
            window._hubBridge.ui?.toast?.(mod.name + ' carregado', 'ok');
            window._hubSFX?.success?.();
            _emitUIUpdate('state');
        } catch(e) {
            HERR('Falha em "' + mod.name + '":', e);
            state.moduleStates[mod.id] = STATUS.ERROR;
            window._hubBridge.ui?.toast?.('Falha em ' + mod.name, 'error');
            window._hubSFX?.error?.();
            _emitUIUpdate('state');
        }
    }
    function deactivateModule(mod) {
        state.moduleStates[mod.id] = STATUS.UNLOADED;
        const ok = tryUnload(mod);
        if (!window._voiceCommands?.registrar) limparHandlerVoz();
        window._hubBridge.ui?.toast?.(mod.name + (ok ? ' desativado' : ' — recarregue'), ok ? 'ok' : 'warn');
        _emitUIUpdate('state');
    }
    function handleModuleClick(mod) {
        if (mod.secret) return;
        if (mod.admin === true && !_adminUnlocked()) {
            window._hubSFX?.error?.();
            window._hubBridge.ui?.toast?.('Módulo em fase de Testes', 'error');
            _emitUIUpdate('state');
            return;
        }
        const status = state.moduleStates[mod.id] || STATUS.UNLOADED;
        if (status === STATUS.LOADING) return;
        if (status === STATUS.LOADED) { deactivateModule(mod); return; }
        activateModule(mod);
    }

    // ═══ VOZ ═══
    const VOICE_OPEN = ['abra', 'abre', 'abrir', 'ativa', 'ativar', 'liga', 'ligar', 'inicia', 'iniciar'];
    const VOICE_CLOSE = ['feche', 'fecha', 'fechar', 'desativa', 'desativar', 'desliga', 'desligar', 'para', 'parar'];
    const VOICE_ALIASES = {
        packetlive: ['packet', 'packet manager', 'analisador', 'analyzer'],
        blocklive: ['liveblock', 'adblock', 'bloqueador'],
        boosterlive: ['booster', 'booster fps'],
        gameslive: ['jogos', 'games', 'gameslive'],
        photolive: ['photoswap', 'fotoswap', 'foto'],
        yt: ['youtube'], iptv: ['iptv', 'tv'], prozilla: ['prozilla'],
        galeria: ['galeria'], voz: ['voz', 'microfone', 'mic'], groq: ['sang', 'sang ai', 'chat ia', 'ia']
    };
    const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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
            if (/^(mostrar?|mostra|abrir?|abre|abra)/.test(transcript)) window._hubBridge.ui?.showPanel?.();
            else window._hubBridge.ui?.showPill?.();
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
    let _vozHandlerRegistrado = null;
    function tentarRegistrarHandlerVoz() {
        if (!window._voiceCommands?.registrar) return false;
        if (_vozHandlerRegistrado) return true;
        _vozHandlerRegistrado = (texto) => handleVoiceCommand(texto);
        window._voiceCommands.registrar(/.*/, _vozHandlerRegistrado, -1);
        return true;
    }
    function limparHandlerVoz() {
        if (_vozHandlerRegistrado && window._voiceCommands?.remover) window._voiceCommands.remover(_vozHandlerRegistrado);
        _vozHandlerRegistrado = null;
    }

    // ═══ MISSED CALLS ═══
    async function _registrarMissedCall(payload) {
        if (!fsConfigured()) return false;
        if (!payload || (!payload.toDeviceId && !payload.toNumber)) return false;
        try {
            const fields = {
                toDeviceId: fsValue(payload.toDeviceId || ''), toNumber: fsValue(payload.toNumber || ''),
                fromDeviceId: fsValue(payload.fromId || payload.fromDeviceId || ''),
                fromNumber: fsValue(payload.fromNumber || ''), fromName: fsValue(payload.fromName || ''),
                fromAvatar: fsValue(payload.fromAvatar || ''), reason: fsValue(payload.reason || 'missed'),
                ts: fsValue(payload.ts || Date.now())
            };
            await fsRequest('POST', '/' + COL_MISSED, { fields });
            HLOG('📭 Missed call registrada para', payload.toNumber || payload.toDeviceId);
            return true;
        } catch(e) { HWARN('Falha ao registrar missed call:', e); return false; }
    }

    // ═══ BRIDGE ═══
    window._hubBridge = {
        HUB_VERSION, STATUS, TABS,
        get state()         { return state; },
        get deviceId()      { return _deviceId; },
        get fingerprint()   { return _fp; },
        get secretOn()      { return _secretOn; },
        get blocked()       { return _blocked; },
        get antiLag()       { return _antiLag; },
        setAntiLag(v) {
            _antiLag = !!v;
            try { localStorage.setItem(ANTILAG_KEY, _antiLag ? '1' : '0'); } catch(e) {}
            try { window.dispatchEvent(new CustomEvent('sang:antilag-changed', { detail: { active: _antiLag } })); } catch(_) {}
            return _antiLag;
        },

        refreshManifest, deactivateModule, activateModule, handleModuleClick,
        loadModule, handleVoiceCommand,
        tentarRegistrarHandlerVoz, limparHandlerVoz,
        autoUpdateLoop,

        kill() {
            HLOG('💥 kill() chamado pela bridge');
            try { window._hubUI?.kill?.(); } catch(_) {}
            try { window._hubRTC?.kill?.(); } catch(_) {}
            try { window._admin?.kill?.(); } catch(_) {}
            _clearAllTimers();
            try { window._hubSFX?.setMuted?.(true); } catch(_) {}
            state.killFlag = true;
        },
        destroy: _autodestruir,

        toast: (msg, kind) => window._hubBridge.ui?.toast?.(msg, kind),
        log: HLOG, warn: HWARN, err: HERR,

        util: {
            escapeHtml, loadPlayerCache, formatDuration, formatClock,
            getPlaytime: () => ({ session: sessionElapsedMs(), total: currentTotalMs() })
        },

        player: {
            get raw()        { return loadPlayerCache(); },
            get name()       { return (loadPlayerCache() || {}).name || ''; },
            get mission()    { return (loadPlayerCache() || {}).mission || ''; },
            get avatarUrl()  { return (loadPlayerCache() || {}).avatarUrl || ''; },
            get capturedAt() { return (loadPlayerCache() || {}).capturedAt || 0; },
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
        gate: {
            get fp() { return _fp; }, get secretOn() { return _secretOn; }, get blocked() { return _blocked; },
            get mode() { const o = localStorage.getItem(_ovr); return o === '0' ? 'off' : o === '1' ? 'on' : 'auto'; },
            async setMode(m) { if (m === 'auto') localStorage.removeItem(_ovr); else localStorage.setItem(_ovr, m === 'on' ? '1' : '0'); await _gate(); return _secretOn; },
            recompute: _gate
        },
        blk: {
            fixed: () => _blk.slice(), extra: _getBlkExtra,
            async add(fp) { const a = _getBlkExtra(); if (!a.includes(fp) && !_blk.includes(fp)) { a.push(fp); _setBlkExtra(a); } await _gate(); },
            async remove(fp) { const a = _getBlkExtra(); const i = a.indexOf(fp); if (i > -1) { a.splice(i, 1); _setBlkExtra(a); } await _gate(); },
            full: _fullBlk
        },
        firestore: {
            configured: fsConfigured,
            request: fsRequest,
            runQuery: fsRunQuery,
            parseDoc: fsParseDoc,
            value: fsValue,
            timestamp: fsTimestamp
        },
        rtdb: { url: RTDB_URL, get: _rtdbGet, put: _rtdbPut, post: _rtdbPost, del: _rtdbDelete },
        phone: { registerMissedCall: (p) => _registrarMissedCall(p) },

        debug: {
            readsToday: _readsHoje,
            resetReads: () => { try { localStorage.removeItem(FS_READS_KEY); } catch(_) {} }
        },
        leader: {
            get isLeader() { return _isLeader; },
            get tabId() { return TAB_ID; }
        },
        block: {
            get blocked() { return _blocked; },
            async forceRecheck() { await _recheckBlockOneShot(); }
        },

        ui: null,
        mic: null
    };

    // ═══ BOOT ═══
    async function boot() {
        await new Promise(resolve => {
            if (document.body) return resolve();
            const iv = setInterval(() => { if (document.body) { clearInterval(iv); resolve(); } }, 80);
        });

        await _gate();

        // SSE do bloqueio roda em todas as abas (barato, sem polling)
        _iniciarBlockSse();

        // recheck ao voltar o foco (cobre SSE silencioso / aba em background)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) _recheckBlockOneShot();
        });

        // loops de rede só na aba líder
        _onLeaderGained = () => {
            _iniciarHeartbeat();
            _iniciarBlockWatcher();
        };
        _iniciarLeaderElection();

        window.addEventListener('storage', (e) => {
            if (e.key === PLAYER_CACHE_KEY && e.newValue) {
                HLOG('📥 Cache do jogador atualizado em outra aba — reenviando heartbeat');
                _aplicarCacheJogador();
            }
            if (e.key === ADMIN_TOKEN_KEY) { _emitUIUpdate('state'); }
            if (e.key === ANTILAG_KEY) {
                _antiLag = e.newValue === '1';
                try { window.dispatchEvent(new CustomEvent('sang:antilag-changed', { detail: { active: _antiLag } })); } catch(_) {}
            }
        });

        if (_blocked) {
            HLOG('🚫 Bloqueado no boot — toast apenas');
            _mostrarBloqueioToast();
            return;
        }

        HLOG('🖼️  Carregando hub-ui.js…');
        try { await loadModule({ id: 'hub-ui', url: HUB_UI_URL }); }
        catch(e) { HERR('Falha ao carregar hub-ui.js:', e); }

        HLOG('📡 Carregando hub-rtc.js…');
        try { await loadModule({ id: 'hub-rtc', url: HUB_RTC_URL }); }
        catch(e) { HERR('Falha ao carregar hub-rtc.js:', e); }

        HLOG('📱 Carregando phone-firebase.js…');
        try {
            const r = await fetch(PHONE_FIREBASE_URL + '?t=' + Date.now(), { cache: 'no-store' });
            if (r.ok) {
                const s = document.createElement('script');
                s.textContent = await r.text();
                document.documentElement.appendChild(s);
                s.remove();
                HLOG('📱 Phone Firebase carregado');
            } else { HWARN('Phone Firebase: HTTP', r.status); }
        } catch(e) { HWARN('Phone Firebase falhou:', e); }

        await refreshManifest(false);
        setTimeout(_carregarAdmin, 1500);

        // rede de segurança: limpa missed calls órfãs se o phone não estiver rodando
        setTimeout(async () => {
            if (state.killFlag) return;
            if (window._phone) return;
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

        playtime.flushTimer = setInterval(() => {
            if (state.killFlag) return;
            flushPlaytime();
        }, PLAYTIME_FLUSH_MS);
        _timers.playtimeFlush = playtime.flushTimer;

        // unload — keepalive fetch substitui sendBeacon (não manda Authorization)
        window.addEventListener('beforeunload', () => {
            flushPlaytime();
            if (!_isLeader || !fsConfigured() || !_deviceId || !_fsAuth?.idToken) return;
            try {
                fetch(`${FS_BASE}/sessions/${_deviceId}?updateMask.fieldPaths=lastSeen`, {
                    method: 'PATCH',
                    headers: { Authorization: 'Bearer ' + _fsAuth.idToken, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: { lastSeen: fsValue(Date.now()) } }),
                    keepalive: true
                }).catch(() => {});
            } catch(_) {}
        });

        if (!state.killFlag) state.updateTimer = setTimeout(autoUpdateLoop, UPDATE_INTERVAL_MS);

        state.heartbeatTimer = setInterval(() => {
            if (state.killFlag) return;
            if (!state.updateTimer) state.updateTimer = setTimeout(autoUpdateLoop, UPDATE_INTERVAL_MS);
        }, 60000);
        _timers.watchdog = state.heartbeatTimer;

        tentarRegistrarHandlerVoz();
        window.addEventListener('sang:voz-state', tentarRegistrarHandlerVoz);
        window.addEventListener('sang:voz-ready', tentarRegistrarHandlerVoz);
        try { window.dispatchEvent(new CustomEvent('sang:voz-query')); } catch(_) {}
    }

    boot().catch(e => HERR('❌ Erro fatal:', e));
})();
