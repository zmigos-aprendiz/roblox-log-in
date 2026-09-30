// modules/phone.js
(function() {
    'use strict';
    const UID = '_phone';
    if (window[UID]) return;

    const bridge = window._hubBridge;
    if (!bridge || !bridge.rtdb) { console.warn('[Phone] _hubBridge.rtdb ausente.'); return; }
    if (!bridge.firestore || !bridge.firestore.configured || !bridge.firestore.configured()) { console.warn('[Phone] Firestore off.'); return; }

    // ═══ CONFIG ═══
    const PHONE_VERSION = '15.1';
    const ICE_SERVERS = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ];
    const POLL_MS = 400;
    const ONLINE_MS = 5 * 60 * 1000;
    const CALL_TIMEOUT_MS = 45000;
    const RINGBACK_CYCLE_MS = 4000;
    const RING_CYCLE_MS = 1500;
    const BUSY_CYCLE_MS = 500;
    const GROUP_POLL_MS = 1500;
    const NOTES_POLL_MS = 9000;
    const MAX_GROUP_MEMBERS = 5;
    const HISTORY_MAX = 40;

    const SPEAKING_THRESHOLD = 0.055;
    const SPEAKING_RELEASE_MS = 600;
    const ICE_RESTART_WINDOW_MS = 3000;

    const MIN_TUCK_X = 260;
    const MIN_TUCK_Y = -140;
    const FRAME_HALF_H = 285;

    const COL_DIR = 'phone_numbers';
    const COL_OWN = 'phone_owners';
    const COL_NOTES = 'phone_notes';
    const RTDB_GCALL = 'gcall';

    const LS_MY_NUMBER = 'sanghub_phone_my_number';
    const LS_CONTACTS = 'sanghub_phone_contacts';
    const LS_HISTORY = 'sanghub_phone_history';
    const LS_MINIMIZED = 'sanghub_phone_minimized';
    const LS_BLOCKED = 'sanghub_phone_blocked';
    const LS_PLAYED_NOTES = 'sanghub_phone_notes_played';
    const LS_NOTIF = 'sanghub_phone_notif_asked';

    const MAX_CLAIM_ATTEMPTS = 8;
    const SESSIONS_REFRESH_MS = 8000;

    // ═══ STATE ═══
    let _dying = false;
    let _phase = 'idle';
    let _pc = null;
    let _localStream = null;
    let _remoteAudio = null;
    let _pollTimer = null;
    let _durTimer = null;
    let _timeoutTimer = null;
    let _ringTimer = null;
    let _groupPollTimer = null;
    let _notesPollTimer = null;
    let _startedAt = 0;
    let _peer = null;
    let _incomingOffer = null;
    let _answered = false;
    let _iceSeen = new Set();
    let _busyDismissTimer = null;
    let _iceRestartTimer = null;

    // Group
    let _hostState = { callId: null, createdAt: 0 };
    const _hostMembers = new Map();
    let _mixCtx = null;
    let _isGroupCaller = false;
    let _groupRosterCache = null;
    let _vadRaf = null;
    const _speakingSet = new Set();
    const _individualMutes = new Set();

    // Numbers / contacts / history
    let _myNumber = null;
    let _contacts = [];
    let _history = [];
    let _blocked = [];
    let _sessionsCache = [];
    let _sessionsFetchedAt = 0;
    let _activeTab = 'contatos';
    let _dialBuffer = '';
    let _allocating = false;
    let _addPickerOpen = false;
    let _searchQuery = '';
    let _playedNotes = new Set();

    // Recording note
    let _rec = null;
    let _recChunks = [];
    let _recTarget = null;
    let _recStartedAt = 0;
    let _recTimer = null;

    // UI
    let _minimized = false;
    try { _minimized = localStorage.getItem(LS_MINIMIZED) === '1'; } catch(_) {}

    let _host = null, _shadow = null, _root = null;
    let _frameEl = null;
    let _screenEl = null;
    let _myNumEl = null;

    // ═══ UTILS ═══
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
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    function fmtDur(ms) {
        const s = Math.floor(ms / 1000), m = Math.floor(s / 60), ss = s % 60;
        return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }
    function fmtDurShort(ms) {
        const s = Math.floor(ms / 1000);
        if (s < 60) return s + 's';
        const m = Math.floor(s / 60);
        if (m < 60) return m + 'min ' + (s % 60) + 's';
        return Math.floor(m / 60) + 'h ' + (m % 60) + 'min';
    }
    function timeAgo(ts) {
        const s = Math.floor((Date.now() - ts) / 1000);
        if (s < 60) return 'agora';
        if (s < 3600) return Math.floor(s / 60) + 'min';
        if (s < 86400) return Math.floor(s / 3600) + 'h';
        if (s < 604800) return Math.floor(s / 86400) + 'd';
        const d = new Date(ts);
        return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    }
    function b64ToBlob(b64, mime) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime || 'audio/webm' });
    }
    function blobToB64(blob) {
        return new Promise(resolve => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1] || '');
            r.readAsDataURL(blob);
        });
    }

    // ═══ NUMBER ═══
    function fmtNumber(n) {
        if (!n) return '';
        const clean = String(n).replace(/\D/g, '');
        if (clean.length !== 6) return clean;
        return clean.slice(0, 3) + '-' + clean.slice(3);
    }
    function parseNumber(s) { return String(s || '').replace(/\D/g, '').slice(0, 6); }
    function randNumber() { return String(Math.floor(100000 + Math.random() * 900000)); }
    function getMyUsername() { return bridge.player?.username || bridge.player?.name || bridge.deviceId || ''; }

    async function _getDirectory(number) {
        try {
            const doc = await bridge.firestore.request('GET', '/' + COL_DIR + '/' + number);
            if (!doc || !doc.fields) return null;
            return bridge.firestore.parseDoc(doc);
        } catch(_) { return null; }
    }
    async function _getOwner(username) {
        try {
            const doc = await bridge.firestore.request('GET', '/' + COL_OWN + '/' + encodeURIComponent(username));
            if (!doc || !doc.fields) return null;
            return bridge.firestore.parseDoc(doc);
        } catch(_) { return null; }
    }
    async function _writeDirectory(number, payload) {
        const fields = {};
        for (const k in payload) fields[k] = bridge.firestore.value(payload[k]);
        const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
        await bridge.firestore.request('PATCH', '/' + COL_DIR + '/' + number, { fields }, mask);
    }
    async function _writeOwner(username, payload) {
        const fields = {};
        for (const k in payload) fields[k] = bridge.firestore.value(payload[k]);
        const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
        await bridge.firestore.request('PATCH', '/' + COL_OWN + '/' + encodeURIComponent(username), { fields }, mask);
    }
    async function _mirrorToSession() {
        if (!_myNumber || !bridge.deviceId) return;
        try {
            const fields = { phoneNumber: bridge.firestore.value(_myNumber) };
            await bridge.firestore.request('PATCH', '/sessions/' + bridge.deviceId, { fields }, 'updateMask.fieldPaths=phoneNumber');
        } catch(_) {}
    }
    async function _ensureMyNumber() {
        if (_myNumber) return _myNumber;
        if (_allocating) return null;
        _allocating = true;
        try {
            try {
                const cached = localStorage.getItem(LS_MY_NUMBER);
                if (cached && /^\d{6}$/.test(cached)) { _myNumber = cached; _updateMyNumberUI(); return _myNumber; }
            } catch(_) {}
            const username = getMyUsername();
            if (!username) return null;
            const owner = await _getOwner(username);
            if (owner && owner.number && /^\d{6}$/.test(String(owner.number))) {
                _myNumber = String(owner.number);
                try { localStorage.setItem(LS_MY_NUMBER, _myNumber); } catch(_) {}
                _updateMyNumberUI();
                _mirrorToSession();
                return _myNumber;
            }
            const displayName = bridge.player?.name || username;
            const avatarUrl = bridge.player?.avatarUrl || '';
            for (let i = 0; i < MAX_CLAIM_ATTEMPTS; i++) {
                const num = randNumber();
                const existing = await _getDirectory(num);
                if (existing && existing.username && existing.username !== username) continue;
                try {
                    const now = Date.now();
                    await _writeDirectory(num, { username, displayName, avatarUrl, createdAt: existing?.createdAt || now, updatedAt: now });
                    await _writeOwner(username, { number: num, createdAt: now });
                    _myNumber = num;
                    try { localStorage.setItem(LS_MY_NUMBER, num); } catch(_) {}
                    _updateMyNumberUI();
                    _mirrorToSession();
                    return num;
                } catch(e) { continue; }
            }
            console.warn('[Phone] Não foi possível alocar número após', MAX_CLAIM_ATTEMPTS, 'tentativas.');
            return null;
        } finally { _allocating = false; }
    }
    async function _refreshMyDirectory() {
        if (!_myNumber) return;
        try {
            await _writeDirectory(_myNumber, {
                username: getMyUsername(),
                displayName: bridge.player?.name || getMyUsername(),
                avatarUrl: bridge.player?.avatarUrl || '',
                updatedAt: Date.now()
            });
        } catch(_) {}
    }
    // Resolve avatar do usuário local: cache → diretório.
    async function _resolveMyAvatar() {
        let av = bridge.player?.avatarUrl || '';
        if (av) return av;
        if (!_myNumber) await _ensureMyNumber();
        if (!_myNumber) return '';
        const dir = await _getDirectory(_myNumber).catch(() => null);
        return dir?.avatarUrl || '';
    }

    // ═══ CONTATOS ═══
    function loadContacts() {
        try {
            const raw = localStorage.getItem(LS_CONTACTS);
            const parsed = raw ? JSON.parse(raw) : [];
            _contacts = Array.isArray(parsed) ? parsed.filter(c => c && /^\d{6}$/.test(String(c.number))) : [];
        } catch(_) { _contacts = []; }
    }
    function saveContacts() { try { localStorage.setItem(LS_CONTACTS, JSON.stringify(_contacts)); } catch(_) {} }
    function hasContact(number) { return _contacts.some(c => c.number === number); }
    function removeContact(number) { _contacts = _contacts.filter(c => c.number !== number); saveContacts(); }
    async function addContactByNumber(number) {
        const clean = parseNumber(number);
        if (clean.length !== 6) return { ok: false, err: 'Número incompleto' };
        if (hasContact(clean)) return { ok: false, err: 'Já está salvo' };
        let username = '', name = '', avatarUrl = '';
        const dir = await _getDirectory(clean);
        if (dir) {
            username = dir.username || '';
            name = dir.displayName || '';
            avatarUrl = dir.avatarUrl || '';
        }
        await _fetchSessions(false);
        const live = username ? _findLiveSession(username) : null;
        if (live) { name = live.name || name; avatarUrl = live.avatarUrl || avatarUrl; }
        _contacts.push({ number: clean, username, savedName: name, savedAvatar: avatarUrl, savedAt: Date.now(), fav: false });
        saveContacts();
        return { ok: true };
    }
    function updateContactMeta(number, patch) {
        const c = _contacts.find(x => x.number === number);
        if (!c) return;
        let changed = false;
        for (const k in patch) {
            if (patch[k] != null && patch[k] !== '' && c[k] !== patch[k]) { c[k] = patch[k]; changed = true; }
        }
        if (changed) saveContacts();
    }
    function toggleFav(number) {
        const c = _contacts.find(x => x.number === number);
        if (!c) return false;
        c.fav = !c.fav;
        saveContacts();
        return c.fav;
    }

    // ═══ HISTÓRICO ═══
    function loadHistory() {
        try {
            const raw = localStorage.getItem(LS_HISTORY);
            const arr = raw ? JSON.parse(raw) : [];
            _history = Array.isArray(arr) ? arr.filter(h => h && typeof h.at === 'number') : [];
        } catch(_) { _history = []; }
    }
    function saveHistory() {
        if (_history.length > HISTORY_MAX) _history = _history.slice(0, HISTORY_MAX);
        try { localStorage.setItem(LS_HISTORY, JSON.stringify(_history)); } catch(_) {}
    }
    function pushHistory(entry) { _history.unshift(entry); saveHistory(); }
    function removeHistoryAt(id) { _history = _history.filter(h => h.id !== id); saveHistory(); }

    // ═══ BLOQUEIO ═══
    function loadBlocked() {
        try {
            const raw = localStorage.getItem(LS_BLOCKED);
            _blocked = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(_blocked)) _blocked = [];
            _blocked = _blocked.filter(n => /^\d{6}$/.test(String(n)));
        } catch(_) { _blocked = []; }
    }
    function saveBlocked() { try { localStorage.setItem(LS_BLOCKED, JSON.stringify(_blocked)); } catch(_) {} }
    function isBlocked(number) { return _blocked.includes(number); }
    function toggleBlock(number) {
        if (isBlocked(number)) { _blocked = _blocked.filter(n => n !== number); saveBlocked(); return false; }
        _blocked.push(number); saveBlocked(); return true;
    }

    // ═══ NOTES / PLAYED ═══
    function loadPlayed() {
        try {
            const raw = localStorage.getItem(LS_PLAYED_NOTES);
            _playedNotes = new Set(raw ? JSON.parse(raw) : []);
        } catch(_) { _playedNotes = new Set(); }
    }
    function savePlayed() {
        const arr = Array.from(_playedNotes).slice(-120);
        _playedNotes = new Set(arr);
        try { localStorage.setItem(LS_PLAYED_NOTES, JSON.stringify(arr)); } catch(_) {}
    }

    // ═══ AUDIO ═══
    let _actx = null;
    function _ctx() {
        if (_actx) return _actx;
        try { _actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { _actx = null; }
        return _actx;
    }
    function tone(freq, dur, type, peak, attack) {
        const c = _ctx();
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
        const a = attack != null ? attack : 0.02;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(peak || 0.04, now + a);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(lp).connect(gain).connect(c.destination);
        osc.start(now);
        osc.stop(now + dur + 0.03);
    }
    function toneRingback() { tone(425, 1.0, 'sine', 0.045, 0.03); }
    function toneRing() {
        const c = _ctx();
        if (!c) return;
        if (c.state === 'suspended') c.resume().catch(() => {});
        const now = c.currentTime;
        [425, 480].forEach(f => {
            const osc = c.createOscillator();
            const gain = c.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, now);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.035, now + 0.03);
            gain.gain.setValueAtTime(0.035, now + 0.72);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
            osc.connect(gain).connect(c.destination);
            osc.start(now);
            osc.stop(now + 0.83);
        });
    }
    function toneBusy() { tone(425, 0.25, 'sine', 0.05, 0.015); }
    function toneHangup() { tone(320, 0.14, 'sine', 0.04, 0.006); setTimeout(() => tone(240, 0.16, 'sine', 0.03, 0.008), 90); }
    function toneDial() { tone(425, 0.08, 'sine', 0.035, 0.01); }
    function toneKey() { tone(880, 0.035, 'sine', 0.02, 0.006); }
    function tonePickup() { tone(659.25, 0.09, 'sine', 0.03, 0.012); setTimeout(() => tone(987.77, 0.13, 'sine', 0.025, 0.014), 70); }
    function toneNotify() { tone(880, 0.06, 'sine', 0.03, 0.01); setTimeout(() => tone(1174.66, 0.09, 'sine', 0.025, 0.012), 55); }
    function toneJoin() { tone(783.99, 0.07, 'sine', 0.028, 0.01); setTimeout(() => tone(1046.5, 0.09, 'sine', 0.022, 0.012), 60); }
    function toneTuck() { tone(587.33, 0.14, 'sine', 0.018, 0.03); setTimeout(() => tone(392, 0.22, 'sine', 0.014, 0.04), 90); }
    function tonePull() { tone(392, 0.16, 'sine', 0.018, 0.03); setTimeout(() => tone(587.33, 0.22, 'sine', 0.015, 0.04), 95); }
    function toneRecStart() { tone(587.33, 0.06, 'sine', 0.024, 0.008); setTimeout(() => tone(880, 0.06, 'sine', 0.02, 0.01), 55); }
    function toneRecSend() { tone(1046.5, 0.07, 'sine', 0.024, 0.008); setTimeout(() => tone(1318.51, 0.09, 'sine', 0.02, 0.01), 55); }
    function toneRecCancel() { tone(392, 0.08, 'sine', 0.022, 0.01); setTimeout(() => tone(261.63, 0.1, 'sine', 0.018, 0.012), 60); }
    function toneBlock() { tone(220, 0.12, 'sine', 0.026, 0.008); setTimeout(() => tone(174.61, 0.13, 'sine', 0.02, 0.01), 80); }
    function toneFav() { tone(1318.51, 0.06, 'sine', 0.02, 0.006); setTimeout(() => tone(1760, 0.08, 'sine', 0.016, 0.008), 55); }

    function stopRingLoop() { if (_ringTimer) { clearInterval(_ringTimer); _ringTimer = null; } }
    function startRingbackLoop() { stopRingLoop(); toneRingback(); _ringTimer = setInterval(toneRingback, RINGBACK_CYCLE_MS); }
    function startRingLoop() { stopRingLoop(); toneRing(); _ringTimer = setInterval(toneRing, RING_CYCLE_MS); }
    function startBusyLoop() { stopRingLoop(); let n = 0; toneBusy(); _ringTimer = setInterval(() => { toneBusy(); if (++n >= 10) stopRingLoop(); }, BUSY_CYCLE_MS); }

    // ═══ HOST SHADOW ═══
    function _ensureHost() {
        if (_host && _shadow) return;
        _host = document.createElement('div');
        _host.id = '_phone_host';
        _host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none;';
        document.documentElement.appendChild(_host);
        _shadow = _host.attachShadow({ mode: 'open' });
        _root = document.createElement('div');
        _root.setAttribute('data-hub', '1');
        _root.setAttribute('data-sang-ui', '');
        _shadow.appendChild(_root);
        try { window._hubUI?.markProtected?.(_host); } catch(e) {}
        _injectStyle();
        ['keydown','input','beforeinput','keyup'].forEach(ev => { _root.addEventListener(ev, e => e.stopPropagation()); });
    }

    // ═══ STYLE ═══
    function _injectStyle() {
        const st = document.createElement('style');
        st.textContent = `
        :host, * { box-sizing: border-box; }
        @keyframes phFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes phDots { 0%,20%{opacity:.3} 50%{opacity:1} 80%,100%{opacity:.3} }
        @keyframes phScreenBlink { 0%,100%{opacity:.6} 50%{opacity:1} }
        @keyframes phPulseDot { 0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.55)} 50%{box-shadow:0 0 0 6px rgba(52,211,153,0)} }
        @keyframes phKeyPress { 0%{transform:scale(1)} 40%{transform:scale(.9)} 100%{transform:scale(1)} }
        @keyframes phToastIn { from{opacity:0;transform:translateY(-8px) scale(.94)} to{opacity:1;transform:none} }
        @keyframes phStackIn { from{opacity:0;transform:scale(.85)} to{opacity:1;transform:none} }
        @keyframes phRingGlow {
            0%, 100% { box-shadow: 0 30px 80px rgba(0,0,0,.7), 0 0 0 2px rgba(255,255,255,.04), inset 0 1px 0 rgba(255,255,255,.12), inset 0 -1px 0 rgba(0,0,0,.5), 0 0 0 0 rgba(52,211,153,.5); }
            50% { box-shadow: 0 30px 80px rgba(0,0,0,.7), 0 0 0 2px rgba(255,255,255,.04), inset 0 1px 0 rgba(255,255,255,.12), inset 0 -1px 0 rgba(0,0,0,.5), 0 0 0 12px rgba(52,211,153,0); }
        }
        @keyframes phTipHint { 0%, 100% { box-shadow: 0 0 0 0 rgba(34,211,238,.35); } 50% { box-shadow: 0 0 0 6px rgba(34,211,238,0); } }
        @keyframes phNotchHint { 0%, 100% { box-shadow: 0 0 0 0 rgba(34,211,238,.4); } 50% { box-shadow: 0 0 0 5px rgba(34,211,238,0); } }
        @keyframes phSpeaking {
            0%,100% { box-shadow: 0 0 0 0 rgba(34,211,238,.55), 0 0 0 0 rgba(52,211,153,.35) inset; transform: scale(1); }
            50%     { box-shadow: 0 0 0 8px rgba(34,211,238,0), 0 0 6px 3px rgba(52,211,153,.35) inset; transform: scale(1.05); }
        }
        @keyframes phRecordPulse {
            0%,100% { box-shadow: 0 30px 80px rgba(0,0,0,.7), 0 0 0 2px rgba(255,255,255,.04), inset 0 1px 0 rgba(255,255,255,.12), inset 0 -1px 0 rgba(0,0,0,.5), 0 0 0 0 rgba(251,113,133,.6); }
            50% { box-shadow: 0 30px 80px rgba(0,0,0,.7), 0 0 0 2px rgba(255,255,255,.04), inset 0 1px 0 rgba(255,255,255,.12), inset 0 -1px 0 rgba(0,0,0,.5), 0 0 0 14px rgba(251,113,133,0); }
        }
        @keyframes phRecWave { 0%,100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
        @keyframes phAuroraLine { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        @keyframes phWallDriftA { 0%,100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(4%, 5%) scale(1.1); } }

        /* ═══ APARELHO ═══ */
        .ph-frame {
            position: fixed; top: 50%; right: 24px;
            margin-top: ${-FRAME_HALF_H}px;
            width: 280px; height: 570px;
            transform-origin: 100% 50%;
            transform: translate(0, 0) rotate(0deg) scale(1);
            transition: transform .9s cubic-bezier(.34, 1.18, .64, 1),
                        box-shadow .7s ease;
            pointer-events: auto;
            border-radius: 42px;
            padding: 10px;
            background: linear-gradient(160deg, #1e2233 0%, #12162a 55%, #0b0e20 100%);
            box-shadow:
                0 30px 80px rgba(0,0,0,.7),
                0 0 0 2px rgba(255,255,255,.04),
                inset 0 1px 0 rgba(255,255,255,.13),
                inset 0 -1px 0 rgba(0,0,0,.55);
            user-select: none;
            isolation: isolate;
            will-change: transform;
            animation: phFadeIn .35s ease;
        }
        .ph-frame::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: inherit;
            padding: 1px;
            pointer-events: none;
            background: linear-gradient(140deg, rgba(34,211,238,.35), rgba(167,139,250,.35) 35%, rgba(244,114,182,.28) 65%, rgba(52,211,153,.32));
            background-size: 200% 200%;
            animation: phAuroraLine 10s linear infinite;
            -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            z-index: 1;
            opacity: .85;
            transition: opacity .55s ease;
        }
        .ph-frame.min {
            transform: translate(${MIN_TUCK_X}px, ${MIN_TUCK_Y}px) rotate(-90deg) scale(.94);
            box-shadow: 0 0 22px rgba(0,0,0,.5), 0 0 0 2px rgba(255,255,255,.05), inset 0 1px 0 rgba(255,255,255,.12);
            transition: transform .8s cubic-bezier(.55, 0, .45, 1),
                        box-shadow .6s ease;
        }
        .ph-frame.min::before { opacity: .45; }
        .ph-frame.ringing:not(.min) { animation: phRingGlow 1.6s ease-in-out infinite; }
        .ph-frame.recording:not(.min) { animation: phRecordPulse 1.4s ease-in-out infinite; }
        .ph-frame.hidden { opacity: 0; pointer-events: none; }

        .ph-frame.min::after {
            content: ''; position: absolute; top: 14px; bottom: 14px; left: 0; width: 10px;
            border-radius: 42px 0 0 42px;
            background: linear-gradient(90deg, rgba(34,211,238,.25), transparent);
            animation: phTipHint 2.6s ease-in-out infinite;
            pointer-events: none;
        }

        .ph-side { position: absolute; right: -3px; width: 3px; border-radius: 2px;
            background: linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,.05)); }
        .ph-side.vol1 { top: 120px; height: 40px; }
        .ph-side.vol2 { top: 168px; height: 40px; }
        .ph-side.pwr  { top: 130px; right: auto; left: -3px; height: 60px; }

        .ph-notch {
            position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
            width: 90px; height: 22px;
            border-radius: 0 0 16px 16px;
            background: #05060a;
            display: flex; align-items: center; justify-content: center; gap: 6px;
            z-index: 40; pointer-events: auto; cursor: pointer;
            transition: background .2s, transform .2s;
        }
        .ph-notch:hover { background: #0a0c14; animation: phNotchHint 1.6s ease-in-out infinite; }
        .ph-notch:active { transform: translateX(-50%) scale(.94); }
        .ph-notch::before { content: ''; width: 46px; height: 4px; border-radius: 2px;
            background: rgba(255,255,255,.08); box-shadow: inset 0 1px 0 rgba(0,0,0,.6); }
        .ph-notch::after { content: ''; width: 6px; height: 6px; border-radius: 50%;
            background: radial-gradient(circle at 30% 30%, #1a1c26, #05060a);
            box-shadow: inset 0 0 3px rgba(80,160,220,.4); }

        .ph-screen {
            position: relative; width: 100%; height: 100%;
            border-radius: 32px; overflow: hidden;
            background: #0c1024;
            display: flex; flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #e9ecf5;
            box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
        }
        .ph-screen::before {
            content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
            background: linear-gradient(165deg, #1a2240 0%, #16203a 30%, #121a34 55%, #0e1830 80%, #0a1226 100%);
        }
        .ph-screen::after {
            content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
            background:
                radial-gradient(circle at 18% 12%, rgba(34,211,238,.22), transparent 42%),
                radial-gradient(circle at 88% 82%, rgba(167,139,250,.24), transparent 46%),
                radial-gradient(circle at 62% 40%, rgba(244,114,182,.08), transparent 52%);
            animation: phWallDriftA 22s ease-in-out infinite;
            opacity: .9;
        }
        .ph-screen > * { position: relative; z-index: 2; }
        .ph-screen > .ph-wall-shine {
            position: absolute; inset: 0; pointer-events: none; z-index: 1;
            background: linear-gradient(140deg, rgba(255,255,255,.06) 0%, transparent 22%);
            border-radius: 32px;
        }

        .ph-status { padding: 8px 18px 4px; display: flex; align-items: center; justify-content: space-between;
            font-size: 10px; color: #c8cee0; flex-shrink: 0; position: relative; z-index: 2; }
        .ph-status-time { font-weight: 700; font-variant-numeric: tabular-nums; }
        .ph-status-icons { display: flex; align-items: center; gap: 5px; font-size: 9px; }
        .ph-status-icons .sig { display: inline-flex; gap: 1px; align-items: flex-end; height: 8px; }
        .ph-status-icons .sig i { display: inline-block; width: 2px; background: currentColor; border-radius: 1px; }
        .ph-status-icons .sig i:nth-child(1){ height: 3px; opacity: .5; }
        .ph-status-icons .sig i:nth-child(2){ height: 5px; opacity: .7; }
        .ph-status-icons .sig i:nth-child(3){ height: 7px; }
        .ph-status-icons .sig i:nth-child(4){ height: 9px; }
        .ph-status-ver { font-size: 8.5px; font-weight: 700; letter-spacing: .04em; color: #8b93a8; }
        .ph-status-icons .dot-notif {
            width: 5px; height: 5px; border-radius: 50%; background: #fb7185;
            box-shadow: 0 0 6px rgba(251,113,133,.8);
            animation: phPulseDot 1.8s ease-in-out infinite;
            display: none;
        }
        .ph-status-icons .dot-notif.on { display: inline-block; }

        .ph-hdr { padding: 6px 18px 6px; flex-shrink: 0;
            display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 2; }
        .ph-hdr-title { font-size: 13px; font-weight: 800; letter-spacing: .04em;
            background: linear-gradient(100deg,#22d3ee 0%,#a78bfa 50%,#22d3ee 100%);
            background-size: 220% auto; -webkit-background-clip: text; background-clip: text; color: transparent;
            animation: phScreenBlink 3.2s ease-in-out infinite; }
        .ph-hdr-sub { font-size: 8.5px; color: #8b93a8; letter-spacing: .06em; text-transform: uppercase; margin-top: 2px; }
        .ph-hdr-count { font-size: 10px; font-weight: 800; color: #a7f3d0; }

        .ph-me { margin: 0 14px 8px; padding: 8px 12px; border-radius: 12px;
            background: linear-gradient(120deg, rgba(34,211,238,.12), rgba(167,139,250,.12));
            border: 1px solid rgba(34,211,238,.26);
            display: flex; align-items: center; justify-content: space-between;
            cursor: pointer; user-select: none;
            transition: background .2s, border-color .2s, transform .2s;
            position: relative; z-index: 2; }
        .ph-me:hover { background: linear-gradient(120deg, rgba(34,211,238,.18), rgba(167,139,250,.18)); border-color: rgba(34,211,238,.45); transform: translateY(-1px); }
        .ph-me:active { transform: scale(.98); }
        .ph-me-label { font-size: 8.5px; color: #8890a4; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; }
        .ph-me-number { font-size: 16px; font-weight: 800; letter-spacing: .06em; font-variant-numeric: tabular-nums;
            background: linear-gradient(100deg,#22d3ee 0%,#a78bfa 50%,#22d3ee 100%);
            background-size: 220% auto; -webkit-background-clip: text; background-clip: text; color: transparent;
            animation: phScreenBlink 4s ease-in-out infinite; }
        .ph-me-number.loading { color: #5c6478; background: none; animation: none; font-weight: 600; letter-spacing: .12em; }
        .ph-me-copy { font-size: 8px; font-weight: 800; color: #67e8f9; letter-spacing: .08em;
            padding: 2px 6px; border-radius: 5px; background: rgba(34,211,238,.14); border: 1px solid rgba(34,211,238,.3); }

        .ph-tabs { display: flex; gap: 2px; padding: 0 14px 8px; flex-shrink: 0; position: relative; z-index: 2; }
        .ph-tab { flex: 1; padding: 7px 0; font-size: 9px; font-weight: 800;
            text-transform: uppercase; letter-spacing: .06em;
            color: #7b8296; background: transparent; border: none; cursor: pointer;
            border-bottom: 2px solid transparent; font-family: inherit;
            transition: color .2s, border-color .2s; }
        .ph-tab:hover { color: #d1d5db; }
        .ph-tab.active { color: #67e8f9; border-color: #22d3ee; }
        .ph-tab:disabled { opacity: .35; cursor: not-allowed; }
        .ph-tab .badge { display: inline-block; min-width: 12px; padding: 0 3px; border-radius: 4px;
            background: rgba(34,211,238,.2); color: #67e8f9; font-size: 8px; margin-left: 2px; }
        .ph-tab .badge.red { background: rgba(251,113,133,.22); color: #fca5b1; }

        .ph-content { flex: 1; min-height: 0; position: relative; z-index: 2; display: flex; flex-direction: column; }

        .ph-search {
            margin: 0 12px 6px; padding: 6px 10px 6px 26px;
            background: rgba(255,255,255,.06);
            border: 1px solid rgba(255,255,255,.1);
            border-radius: 8px; color: #f1f2f8; font-size: 10.5px; font-family: inherit;
            outline: none;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.6' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.5' y2='16.5'/></svg>");
            background-repeat: no-repeat; background-position: 9px center;
            transition: border-color .2s, background-color .2s;
        }
        .ph-search:focus { border-color: rgba(34,211,238,.5); background-color: rgba(255,255,255,.08); }

        .ph-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 4px; }
        .ph-list::-webkit-scrollbar { width: 4px; }
        .ph-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 2px; }
        .ph-empty { padding: 30px 20px; text-align: center; font-size: 10.5px; color: #8890a4; line-height: 1.6; }
        .ph-empty strong { color: #a7f3d0; font-weight: 800; }
        .ph-empty .hint { font-size: 9.5px; color: #5c6478; margin-top: 8px; }

        .ph-section-hdr {
            padding: 8px 4px 4px; font-size: 8.5px; font-weight: 800;
            letter-spacing: .1em; text-transform: uppercase; color: #8890a4;
            display: flex; align-items: center; gap: 6px;
        }
        .ph-section-hdr .line { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(139,143,163,.22), transparent); }
        .ph-section-hdr.fav { color: #fbbf24; }
        .ph-section-hdr.blocked { color: #fb7185; }

        .ph-contact { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px;
            background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.07);
            cursor: pointer; position: relative;
            transition: background .2s cubic-bezier(.22,1,.36,1), border-color .2s cubic-bezier(.22,1,.36,1),
                        transform .25s cubic-bezier(.22,1,.36,1), box-shadow .25s cubic-bezier(.22,1,.36,1); }
        .ph-contact:hover { background: rgba(255,255,255,.09); border-color: rgba(34,211,238,.34);
            transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,.3), 0 0 0 1px rgba(34,211,238,.08); }
        .ph-contact:active { transform: translateY(0) scale(.985); }
        .ph-contact.offline { opacity: .55; }
        .ph-contact.offline:hover { opacity: .8; }
        .ph-contact.blocked { border-color: rgba(251,113,133,.28); background: rgba(251,113,133,.06); }
        .ph-contact.blocked .ph-name { text-decoration: line-through; color: #8b8fa3; }
        .ph-contact.fav { border-color: rgba(251,191,36,.24); }
        .ph-contact.fav:hover { border-color: rgba(251,191,36,.44); }

        .ph-av { width: 38px; height: 38px; border-radius: 12px; flex-shrink: 0;
            background: linear-gradient(135deg, rgba(34,211,238,.22), rgba(167,139,250,.22));
            border: 1px solid rgba(255,255,255,.1);
            display: flex; align-items: center; justify-content: center;
            overflow: hidden; position: relative; color: #b8c0d4; font-size: 14px; font-weight: 800; }
        .ph-av.sm { width: 30px; height: 30px; font-size: 11px; border-radius: 10px; }
        .ph-av img,
        .ph-call-av img {
            position: absolute;
            top: 50%; left: 50%;
            width: 210%; height: 210%;
            object-fit: cover;
            transform: translate(-50%, -50%);
        }
        .ph-av .dot-online { position: absolute; bottom: -1px; right: -1px; width: 10px; height: 10px; border-radius: 50%;
            background: #34d399; border: 2px solid #0c1024; animation: phPulseDot 2s ease-in-out infinite; z-index: 2; }
        .ph-av .fav-badge { position: absolute; top: -4px; left: -4px; width: 14px; height: 14px; border-radius: 50%;
            background: linear-gradient(135deg, #fbbf24, #f59e0b); border: 1px solid #0c1024;
            display: inline-flex; align-items: center; justify-content: center; font-size: 8px; color: #1a1410; z-index: 2; }

        .ph-info { flex: 1; min-width: 0; }
        .ph-name { font-size: 11.5px; font-weight: 700; color: #eaecf3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ph-meta { font-size: 9px; color: #8890a4; margin-top: 2px; font-variant-numeric: tabular-nums;
            display: flex; align-items: center; gap: 4px; }
        .ph-meta .num { color: #67e8f9; font-weight: 700; letter-spacing: .03em; }
        .ph-meta .off { color: #6b7280; }
        .ph-meta .dir-in { color: #a7f3d0; }
        .ph-meta .dir-out { color: #67e8f9; }
        .ph-meta .dir-miss { color: #fca5b1; }
        .ph-meta .grp { color: #c4b5fd; font-weight: 700; }

        .ph-call-btn { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
            border: 1px solid rgba(52,211,153,.4); background: rgba(52,211,153,.14);
            color: #a7f3d0; cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: all .2s cubic-bezier(.22,1,.36,1); pointer-events: auto; }
        .ph-call-btn:hover { background: rgba(52,211,153,.24); box-shadow: 0 0 12px rgba(52,211,153,.35); }
        .ph-call-btn:disabled { opacity: .35; cursor: not-allowed; }
        .ph-call-btn svg { width: 12px; height: 12px; }

        .ph-rm { flex-shrink: 0; width: 22px; height: 22px; border-radius: 6px; background: transparent;
            border: none; cursor: pointer; color: #6b7280; font-family: inherit; font-size: 12px; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity .15s, color .15s, background .15s; }
        .ph-contact:hover .ph-rm { opacity: 1; }
        .ph-rm:hover { color: #fca5b1; background: rgba(251,113,133,.14); }

        /* Discador */
        .ph-dial { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 18px 12px; }
        .ph-dial-display { padding: 12px 0 16px; text-align: center; min-height: 62px;
            display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
        .ph-dial-num { font-size: 28px; font-weight: 800; letter-spacing: .08em;
            font-variant-numeric: tabular-nums; color: #f1f2f8; transition: color .2s;
            min-height: 34px; display: flex; align-items: center; justify-content: center; }
        .ph-dial-num .dash { color: #22d3ee; margin: 0 2px; }
        .ph-dial-num.empty { color: #4b5060; }
        .ph-dial-hint { font-size: 9.5px; color: #8890a4; letter-spacing: .05em; min-height: 12px; }
        .ph-dial-hint.err { color: #fca5b1; }
        .ph-dial-hint.blocked { color: #fb7185; }
        .ph-dial-hint .name { color: #67e8f9; font-weight: 800; }

        .ph-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
        .ph-key {
            padding: 12px 0 10px; border-radius: 14px;
            background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.035));
            border: 1px solid rgba(255,255,255,.09);
            color: #e5e7eb; font-family: inherit;
            font-size: 19px; font-weight: 700;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            cursor: pointer; user-select: none;
            transition: background .12s, border-color .12s, transform .12s, box-shadow .12s;
            position: relative; line-height: 1;
            box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
        }
        .ph-key .sub { font-size: 7.5px; color: #7b8296; letter-spacing: .06em; margin-top: 3px; font-weight: 800; text-transform: uppercase; }
        .ph-key:hover { background: linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,.05)); border-color: rgba(34,211,238,.32); box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 1px rgba(34,211,238,.05); }
        .ph-key:active { transform: scale(.94); background: linear-gradient(180deg, rgba(34,211,238,.2), rgba(34,211,238,.08)); }
        .ph-key.pressed { animation: phKeyPress .25s cubic-bezier(.22,1,.36,1); }
        .ph-key.util { color: #8890a4; font-size: 15px; }
        .ph-key.util:hover { color: #67e8f9; }
        .ph-key.util svg { width: 16px; height: 16px; }

        .ph-dial-actions { display: flex; gap: 8px; }
        .ph-dial-btn { flex: 1; padding: 11px 10px; border-radius: 12px; border: none;
            font-family: inherit; font-size: 11px; font-weight: 800; letter-spacing: .04em;
            cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;
            transition: all .16s cubic-bezier(.22,1,.36,1); }
        .ph-dial-btn svg { width: 14px; height: 14px; }
        .ph-dial-btn.call { background: linear-gradient(135deg, #34d399, #22d3ee); color: #062420;
            box-shadow: 0 8px 20px rgba(52,211,153,.3), inset 0 1px 0 rgba(255,255,255,.25); }
        .ph-dial-btn.call:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(52,211,153,.4), inset 0 1px 0 rgba(255,255,255,.3); }
        .ph-dial-btn.save { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); color: #c7cad6; }
        .ph-dial-btn.save:hover:not(:disabled) { background: rgba(255,255,255,.12); transform: translateY(-1px); }
        .ph-dial-btn:disabled { opacity: .35; cursor: not-allowed; transform: none !important; box-shadow: none !important; }
        .ph-dial-btn:active:not(:disabled) { transform: translateY(0) scale(.97); }

        /* Chamada */
        .ph-call { position: absolute; inset: 0;
            display: flex; flex-direction: column; align-items: center; justify-content: space-between;
            padding: 34px 20px 30px;
            background: linear-gradient(180deg, rgba(12,16,36,0) 0%, rgba(12,16,36,.65) 55%, rgba(12,16,36,.9) 100%);
            animation: phFadeIn .3s ease; z-index: 5; }
        .ph-call-top { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; }
        .ph-call-av { width: 96px; height: 96px; border-radius: 32px;
            background: linear-gradient(135deg, rgba(34,211,238,.28), rgba(167,139,250,.28));
            border: 2px solid rgba(255,255,255,.14);
            display: flex; align-items: center; justify-content: center;
            overflow: hidden; position: relative; color: #b8c0d4; font-size: 34px; font-weight: 800;
            box-shadow: 0 20px 50px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.12); }
        .ph-call.outgoing .ph-call-av { box-shadow: 0 20px 50px rgba(0,0,0,.55), 0 0 0 6px rgba(34,211,238,.1), inset 0 1px 0 rgba(255,255,255,.12); }
        .ph-call.incoming .ph-call-av { box-shadow: 0 20px 50px rgba(0,0,0,.55), 0 0 0 6px rgba(52,211,153,.18), inset 0 1px 0 rgba(255,255,255,.12); }
        .ph-call.active  .ph-call-av { box-shadow: 0 20px 50px rgba(0,0,0,.55), 0 0 0 6px rgba(52,211,153,.28), inset 0 1px 0 rgba(255,255,255,.12); }

        .ph-av-stack { display: flex; align-items: center; justify-content: center; position: relative; height: 96px; width: 100%; }
        .ph-av-stack .stacked { position: absolute; animation: phStackIn .3s cubic-bezier(.22,1,.36,1); }
        .ph-av-stack .stacked:nth-child(1) { transform: translateX(-32px) scale(.78); z-index: 1; opacity: .85; }
        .ph-av-stack .stacked:nth-child(2) { transform: translateX(32px) scale(.78); z-index: 1; opacity: .85; }
        .ph-av-stack .stacked:nth-child(3) { transform: translateX(-64px) scale(.6); z-index: 0; opacity: .6; }
        .ph-av-stack .stacked:nth-child(4) { transform: translateX(64px) scale(.6); z-index: 0; opacity: .6; }
        .ph-av-stack .stacked:nth-child(5) { transform: translateY(40px) scale(.5); z-index: 0; opacity: .4; }
        .ph-av-stack .main { transform: none; z-index: 2; }
        .ph-av-stack.multi .ph-call-av { width: 88px; height: 88px; border-radius: 28px; font-size: 30px; }
        .ph-av-stack.multi .ph-call-av.mini { width: 62px; height: 62px; border-radius: 20px; font-size: 22px; }

        .ph-call-name { font-size: 15px; font-weight: 800; color: #f1f2f8; text-align: center; letter-spacing: .02em;
            max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ph-call-num { font-size: 10px; color: #67e8f9; letter-spacing: .08em; font-variant-numeric: tabular-nums; margin-top: 3px; }
        .ph-call-state { font-size: 10.5px; color: #9ca3af; display: flex; align-items: center; gap: 3px; letter-spacing: .04em; margin-top: 6px; }
        .ph-call-state .dot { animation: phDots 1.4s infinite; }
        .ph-call-state .dot:nth-child(2) { animation-delay: .2s; }
        .ph-call-state .dot:nth-child(3) { animation-delay: .4s; }
        .ph-call-timer { font-size: 22px; font-weight: 800; color: #a7f3d0; font-variant-numeric: tabular-nums; letter-spacing: .04em; margin-top: 4px; }

        .ph-roster { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; padding: 0 8px; margin-top: 6px; max-width: 100%; }
        .ph-roster .chip {
            display: inline-flex; align-items: center; gap: 5px;
            padding: 3px 8px 3px 4px; border-radius: 12px;
            background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
            font-size: 9px; color: #c7cad6; max-width: 110px;
            transition: box-shadow .25s, border-color .25s, background .25s, transform .25s cubic-bezier(.22,1,.36,1);
        }
        .ph-roster .chip img { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; }
        .ph-roster .chip .ini { width: 18px; height: 18px; border-radius: 50%;
            background: linear-gradient(135deg, rgba(34,211,238,.32), rgba(167,139,250,.32));
            display: inline-flex; align-items: center; justify-content: center;
            font-size: 9px; font-weight: 800; color: #f1f2f8; flex-shrink: 0; }
        .ph-roster .chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ph-roster .chip.host { border-color: rgba(167,139,250,.45); background: rgba(167,139,250,.14); }
        .ph-roster .chip.speaking {
            border-color: rgba(52,211,153,.7);
            background: linear-gradient(120deg, rgba(52,211,153,.18), rgba(34,211,238,.18));
            animation: phSpeaking 1.4s ease-in-out infinite;
        }
        .ph-roster .chip.muted {
            border-color: rgba(251,113,133,.4);
            background: rgba(251,113,133,.08);
            opacity: .7;
        }
        .ph-roster .chip.muted span { text-decoration: line-through; }
        .ph-roster .chip .kick {
            width: 12px; height: 12px; margin-left: 1px;
            border-radius: 50%; background: transparent; border: none; cursor: pointer;
            color: #8b8fa3; font-size: 11px; line-height: 1; padding: 0;
            display: inline-flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity .15s, color .15s, background .15s;
            font-family: inherit;
        }
        .ph-roster .chip:hover .kick { opacity: 1; }
        .ph-roster .chip .kick:hover { color: #fca5b1; background: rgba(251,113,133,.14); }
        .ph-roster .chip .mute-btn {
            width: 12px; height: 12px; margin-left: 1px;
            border-radius: 50%; background: transparent; border: none; cursor: pointer;
            color: #8b8fa3; font-size: 9px; line-height: 1; padding: 0;
            display: inline-flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity .15s, color .15s, background .15s;
            font-family: inherit;
        }
        .ph-roster .chip:hover .mute-btn { opacity: 1; }
        .ph-roster .chip .mute-btn:hover { color: #67e8f9; background: rgba(34,211,238,.14); }
        .ph-roster .chip.muted .mute-btn { opacity: 1; color: #fca5b1; }

        .ph-call-actions { display: flex; gap: 22px; align-items: center; justify-content: center; }
        .ph-round-btn { width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            color: #fff; font-family: inherit;
            transition: transform .2s cubic-bezier(.22,1,.36,1), box-shadow .2s cubic-bezier(.22,1,.36,1), filter .15s;
            position: relative; }
        .ph-round-btn:hover { transform: translateY(-2px) scale(1.04); }
        .ph-round-btn:active { transform: scale(.95); }
        .ph-round-btn svg { width: 24px; height: 24px; }
        .ph-round-btn.green { background: linear-gradient(135deg, #34d399, #22d3ee); box-shadow: 0 10px 26px rgba(52,211,153,.4), inset 0 1px 0 rgba(255,255,255,.25); }
        .ph-round-btn.red { background: linear-gradient(135deg, #fb7185, #f472b6); box-shadow: 0 10px 26px rgba(251,113,133,.4), inset 0 1px 0 rgba(255,255,255,.25); }
        .ph-round-btn.small { width: 46px; height: 46px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.14); box-shadow: none; color: #c7cad6; }
        .ph-round-btn.small:hover { background: rgba(255,255,255,.16); }
        .ph-round-btn.small.active { background: rgba(251,113,133,.2); color: #fca5b1; border-color: rgba(251,113,133,.42); }
        .ph-round-btn.small.add { color: #a7f3d0; border-color: rgba(52,211,153,.38); }
        .ph-round-btn.small.add:hover { background: rgba(52,211,153,.16); color: #fff; }

        .ph-round-btn-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .ph-round-btn-label { font-size: 8.5px; color: #9ca3af; letter-spacing: .05em; text-transform: uppercase; }

        .ph-busy { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 14px; padding: 30px; background: rgba(12,16,36,.94); animation: phFadeIn .25s ease; z-index: 6; }
        .ph-busy-icon { width: 68px; height: 68px; border-radius: 22px; background: rgba(251,113,133,.14);
            border: 1px solid rgba(251,113,133,.38);
            display: flex; align-items: center; justify-content: center; color: #fb7185; }
        .ph-busy-icon svg { width: 30px; height: 30px; }
        .ph-busy-title { font-size: 14px; font-weight: 800; color: #f1f2f8; text-align: center; }
        .ph-busy-sub { font-size: 10.5px; color: #9ca3af; text-align: center; line-height: 1.5; max-width: 200px; }

        .ph-add-overlay { position: absolute; inset: 0; background: rgba(10,14,32,.96); backdrop-filter: blur(8px);
            display: flex; flex-direction: column; z-index: 8; animation: phFadeIn .2s ease; }
        .ph-add-head { padding: 14px 16px 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,.07); }
        .ph-add-title { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #67e8f9; }
        .ph-add-close { width: 26px; height: 26px; border-radius: 7px; background: transparent; border: 1px solid rgba(255,255,255,.1);
            color: #8b8fa3; cursor: pointer; font-size: 14px; line-height: 1; font-family: inherit;
            display: flex; align-items: center; justify-content: center; }
        .ph-add-close:hover { background: rgba(251,113,133,.14); color: #fca5b1; border-color: rgba(251,113,133,.35); }
        .ph-add-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 12px 12px; }
        .ph-add-body::-webkit-scrollbar { width: 4px; }
        .ph-add-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 2px; }

        /* Recado overlay */
        .ph-rec-overlay {
            position: absolute; inset: 0;
            background: radial-gradient(circle at 50% 60%, rgba(251,113,133,.22), rgba(10,14,32,.96) 55%);
            backdrop-filter: blur(10px);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 18px; z-index: 10; animation: phFadeIn .22s ease;
            padding: 30px;
        }
        .ph-rec-circle {
            width: 120px; height: 120px; border-radius: 50%;
            background: radial-gradient(circle at 30% 30%, rgba(251,113,133,.38), rgba(244,114,182,.2));
            border: 2px solid rgba(251,113,133,.58);
            display: flex; align-items: center; justify-content: center;
            color: #fff; position: relative;
            box-shadow: 0 20px 60px rgba(251,113,133,.3), inset 0 1px 0 rgba(255,255,255,.15);
        }
        .ph-rec-circle svg { width: 40px; height: 40px; }
        .ph-rec-circle::after {
            content: ''; position: absolute; inset: -8px; border-radius: 50%;
            border: 2px solid rgba(251,113,133,.3);
            animation: phRingGlow 1.6s ease-in-out infinite;
        }
        .ph-rec-waves { display: flex; align-items: center; gap: 4px; height: 34px; }
        .ph-rec-waves span {
            width: 4px; height: 100%;
            background: linear-gradient(180deg, #fb7185, #f472b6);
            border-radius: 2px; transform-origin: center;
            animation: phRecWave 0.9s ease-in-out infinite;
        }
        .ph-rec-waves span:nth-child(1){ animation-delay: 0s;   height: 40%; }
        .ph-rec-waves span:nth-child(2){ animation-delay: .1s;  height: 70%; }
        .ph-rec-waves span:nth-child(3){ animation-delay: .2s;  height: 100%; }
        .ph-rec-waves span:nth-child(4){ animation-delay: .15s; height: 60%; }
        .ph-rec-waves span:nth-child(5){ animation-delay: .05s; height: 45%; }
        .ph-rec-info { text-align: center; color: #f1f2f8; }
        .ph-rec-info .name { font-size: 13px; font-weight: 800; margin-bottom: 4px; }
        .ph-rec-info .timer { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; color: #fca5b1; letter-spacing: .04em; }
        .ph-rec-info .hint { font-size: 10px; color: #9ca3af; margin-top: 8px; }

        .ph-home { padding: 6px 0 8px; flex-shrink: 0; display: flex; justify-content: center; position: relative; z-index: 2; }
        .ph-home::before { content: ''; width: 100px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.28); }

        .ph-toast { position: absolute; top: 74px; left: 50%; transform: translateX(-50%);
            padding: 8px 14px; border-radius: 9px; font-size: 10.5px; font-weight: 700; letter-spacing: .02em;
            background: linear-gradient(175deg, rgba(20,26,42,.97), rgba(12,16,32,.99));
            border: 1px solid rgba(34,211,238,.48); color: #cffafe;
            box-shadow: 0 10px 26px rgba(0,0,0,.55), 0 0 24px rgba(34,211,238,.16);
            backdrop-filter: blur(10px); animation: phToastIn .22s cubic-bezier(.22,1,.36,1);
            transition: opacity .2s, transform .2s; z-index: 20; pointer-events: none;
            max-width: 240px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ph-toast.ok { color: #a7f3d0; border-color: rgba(52,211,153,.55); }
        .ph-toast.err { color: #fecdd3; border-color: rgba(251,113,133,.55); }
        .ph-toast.fav { color: #fde68a; border-color: rgba(251,191,36,.58); }
        .ph-toast.out { opacity: 0; transform: translateX(-50%) translateY(-8px); }

        @media (prefers-reduced-motion: reduce) {
            .ph-frame, .ph-frame.min { transition-duration: .01ms; }
            .ph-frame.ringing, .ph-frame.recording, .ph-roster .chip.speaking, .ph-note-btn.recording { animation: none !important; }
            .ph-frame.min::after { animation: none !important; }
            .ph-screen::after { animation: none !important; }
        }
        `;
        _shadow.appendChild(st);
    }

    // ═══ ICONS ═══
    const I = {
        phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
        phoneDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
        micOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="21" y2="21"/><path d="M12 1a3 3 0 0 0-3 3v5"/><path d="M15 9v3a3 3 0 0 1-4.29 2.71"/><path d="M19 10v2a7 7 0 0 1-1.32 4.13"/><path d="M5 10v2a7 7 0 0 0 3 5.71"/><line x1="12" y1="19" x2="12" y2="23"/></svg>`,
        mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
        off: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
        backspace: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>`,
        clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
        save: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
        copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
        plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
        arrowIn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(135deg)"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
        arrowOut: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(-45deg)"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
        star: `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/></svg>`,
        starOutline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/></svg>`,
        block: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
        note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>`
    };

    // ═══ TOAST ═══
    function _toast(msg, kind) {
        if (!_screenEl) return;
        const t = el('div', { class: 'ph-toast' + (kind ? ' ' + kind : '') }, msg);
        _screenEl.appendChild(t);
        setTimeout(() => t.classList.add('out'), 1800);
        setTimeout(() => t.remove(), 2100);
    }

    // ═══ SESSION FETCH ═══
    async function _fetchSessions(force) {
        const now = Date.now();
        if (!force && _sessionsCache.length && (now - _sessionsFetchedAt) < SESSIONS_REFRESH_MS) return _sessionsCache;
        try {
            const data = await bridge.firestore.request('GET', '/sessions');
            _sessionsCache = (data?.documents || []).map(d => ({ id: d.name.split('/').pop(), ...bridge.firestore.parseDoc(d) }));
            _sessionsFetchedAt = now;
        } catch(_) {}
        return _sessionsCache;
    }
    function _findLiveSession(username) {
        if (!username) return null;
        const now = Date.now();
        const myId = bridge.deviceId || '';
        return _sessionsCache
            .filter(s => s.id !== myId && (now - (s.lastSeen || 0)) < ONLINE_MS)
            .find(s => s.name === username || s.username === username) || null;
    }
    function _enrichContact(c) {
        const live = _findLiveSession(c.username);
        const name = live?.name || c.savedName || c.username || fmtNumber(c.number);
        const avatarUrl = live?.avatarUrl || c.savedAvatar || '';
        if (live) {
            const patch = {};
            if (live.avatarUrl && live.avatarUrl !== c.savedAvatar) patch.savedAvatar = live.avatarUrl;
            if (live.name && live.name !== c.savedName) patch.savedName = live.name;
            if (Object.keys(patch).length) updateContactMeta(c.number, patch);
        }
        return {
            number: c.number,
            username: c.username,
            name,
            avatarUrl,
            online: !!live,
            sessionId: live?.id || null,
            fav: !!c.fav,
            blocked: isBlocked(c.number)
        };
    }

    // ═══ RTDB HELPERS ═══
    const sigPath = (targetId, sub) => 'signaling/' + targetId + (sub ? '/' + sub : '');
    const sigGet = (targetId, sub) => bridge.rtdb.get(sigPath(targetId, sub));
    const sigPut = (targetId, sub, v) => bridge.rtdb.put(sigPath(targetId, sub), v);
    const sigPost = (targetId, sub, v) => bridge.rtdb.post(sigPath(targetId, sub), v);
    const sigDel = (targetId, sub) => bridge.rtdb.del(sigPath(targetId, sub));
    const gcallPath = (callId) => RTDB_GCALL + '/' + callId;
    const gcallPut = (payload) => bridge.rtdb.put(gcallPath(_hostState.callId), payload);
    const gcallMemberPut = (devId, payload) => bridge.rtdb.put(gcallPath(_hostState.callId) + '/members/' + devId, payload);
    const gcallSpeakPut = (devId, speaking) => bridge.rtdb.put(gcallPath(_hostState.callId) + '/speaking/' + devId, { s: speaking ? 1 : 0, ts: Date.now() });

    // ═══ WEBRTC CORE ═══
    function _waitIce(pc, timeoutMs) {
        return new Promise(resolve => {
            if (pc.iceGatheringState === 'complete') return resolve();
            const onChange = () => {
                if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', onChange); resolve(); }
            };
            pc.addEventListener('icegatheringstatechange', onChange);
            setTimeout(() => { try { pc.removeEventListener('icegatheringstatechange', onChange); } catch(_) {} resolve(); }, timeoutMs || 2500);
        });
    }
    async function _ensureStream() {
        if (_localStream && _localStream.active) return _localStream;
        _localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        return _localStream;
    }

    // ═══ MIXER ═══
    function _ensureMixCtx() {
        if (_mixCtx) return _mixCtx;
        try { _mixCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) { _mixCtx = null; }
        if (_mixCtx && _mixCtx.state === 'suspended') _mixCtx.resume().catch(() => {});
        return _mixCtx;
    }
    function _rebuildMixerFor(devId) {
        const entry = _hostMembers.get(devId);
        if (!entry || !entry.pc) return;
        const ctx = _ensureMixCtx();
        if (!ctx) return;
        if (entry.mixer) {
            entry.mixer.sources.forEach(s => { try { s.disconnect(); } catch(_){} });
            try { entry.mixer.dest.disconnect(); } catch(_) {}
        }
        const dest = ctx.createMediaStreamDestination();
        const sources = [];
        if (_localStream) {
            try { const src = ctx.createMediaStreamSource(_localStream); src.connect(dest); sources.push(src); } catch(_) {}
        }
        for (const [otherId, other] of _hostMembers) {
            if (otherId === devId) continue;
            if (_individualMutes.has(otherId)) continue;
            if (!other.remoteStream) continue;
            try { const src = ctx.createMediaStreamSource(other.remoteStream); src.connect(dest); sources.push(src); } catch(_) {}
        }
        entry.mixer = { dest, sources };
        const newTrack = dest.stream.getAudioTracks()[0];
        const sender = entry.pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) sender.replaceTrack(newTrack).catch(() => {});
        else try { entry.pc.addTrack(newTrack, dest.stream); } catch(_) {}
    }
    function _rebuildAllHostMixers() { for (const devId of _hostMembers.keys()) _rebuildMixerFor(devId); }
    function _disposeHostMixer(devId) {
        const entry = _hostMembers.get(devId);
        if (!entry || !entry.mixer) return;
        entry.mixer.sources.forEach(s => { try { s.disconnect(); } catch(_) {} });
        try { entry.mixer.dest.disconnect(); } catch(_) {}
        entry.mixer = null;
    }

    // ═══ VAD ═══
    function _startVadFor(devId, stream) {
        const ctx = _ensureMixCtx();
        if (!ctx) return;
        try {
            const src = ctx.createMediaStreamSource(stream);
            const an = ctx.createAnalyser();
            an.fftSize = 256; an.smoothingTimeConstant = 0.5;
            src.connect(an);
            const entry = _hostMembers.get(devId);
            if (!entry) return;
            entry.vad = { an, src, buf: new Uint8Array(an.fftSize), speaking: false, lastLoudAt: 0 };
            if (!_vadRaf) _vadRaf = requestAnimationFrame(_vadTick);
        } catch(_) {}
    }
    function _stopVadFor(devId) {
        const entry = _hostMembers.get(devId);
        if (!entry || !entry.vad) return;
        try { entry.vad.src.disconnect(); } catch(_) {}
        entry.vad = null;
    }
    function _vadTick() {
        if (!_hostMembers.size) { _vadRaf = null; return; }
        const now = Date.now();
        for (const [devId, entry] of _hostMembers) {
            if (!entry.vad) continue;
            const buf = entry.vad.buf;
            entry.vad.an.getByteTimeDomainData(buf);
            let rms = 0;
            for (let i = 0; i < buf.length; i++) { const v = (buf[i]-128)/128; rms += v*v; }
            rms = Math.sqrt(rms / buf.length);
            if (rms > SPEAKING_THRESHOLD) entry.vad.lastLoudAt = now;
            const isSpeaking = (now - entry.vad.lastLoudAt) < SPEAKING_RELEASE_MS;
            if (isSpeaking !== entry.vad.speaking) {
                entry.vad.speaking = isSpeaking;
                gcallSpeakPut(devId, isSpeaking).catch(() => {});
                _updateSpeakingUI();
            }
        }
        _vadRaf = requestAnimationFrame(_vadTick);
    }
    function _updateSpeakingUI() {
        if (!_root) return;
        _root.querySelectorAll('.ph-roster .chip[data-dev-id]').forEach(chip => {
            const devId = chip.dataset.devId;
            const entry = _hostMembers.get(devId);
            const isSpk = entry ? !!entry.vad?.speaking : _speakingSet.has(devId);
            chip.classList.toggle('speaking', isSpk);
        });
    }

    // ═══ HOST CALL ═══
    async function _call(targets) {
        if (_phase !== 'idle' || !targets.length) return;
        if (targets.length > MAX_GROUP_MEMBERS) {
            _busyTone('Máximo excedido', 'Limite de ' + MAX_GROUP_MEMBERS + ' participantes.');
            return;
        }
        if (_minimized) _setMinimized(false);
        let stream;
        try { stream = await _ensureStream(); }
        catch (e) { _busyTone('Sem microfone', 'Permissão negada.'); return; }

        _hostState.callId = targets.length > 1 ? ('g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) : null;
        _hostState.createdAt = Date.now();
        _isGroupCaller = targets.length > 1;
        _answered = false;
        _iceSeen.clear();
        _hostMembers.clear();
        _individualMutes.clear();

        if (_hostState.callId) {
            try {
                await gcallPut({
                    hostId: bridge.deviceId || '', hostName: bridge.player?.name || 'Host',
                    hostAvatar: bridge.player?.avatarUrl || '', hostNumber: _myNumber || '',
                    createdAt: _hostState.createdAt, status: 'active', members: {}, speaking: {}
                });
                await gcallMemberPut(bridge.deviceId, {
                    name: bridge.player?.name || 'Host', avatarUrl: bridge.player?.avatarUrl || '',
                    number: _myNumber || '', joinedAt: _hostState.createdAt, isHost: true
                });
            } catch(_) {}
        }
        _peer = { id: targets[0].id, name: targets[0].name, avatarUrl: targets[0].avatarUrl, number: targets[0].number };
        _phase = 'outgoing';
        _renderCall();

        for (let i = 0; i < targets.length; i++) _spawnHostPeer(targets[i], i === 0);
        startRingbackLoop();
        _startTimeout(CALL_TIMEOUT_MS, () => {
            const anyAnswered = Array.from(_hostMembers.values()).some(m => m.answered);
            if (!anyAnswered) _endCall(true, 'Sem resposta');
        });
    }

    function _spawnHostPeer(target, isPrimary) {
        const devId = target.id;
        if (_hostMembers.has(devId)) return;
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        const entry = {
            pc, remoteStream: null, mixer: null, vad: null,
            name: target.name || 'Sem nome', avatarUrl: target.avatarUrl || '', number: target.number || '',
            joinedAt: Date.now(), answered: false, iceSeen: new Set(), disconnectedAt: 0
        };
        _hostMembers.set(devId, entry);

        // Fallback de avatar via diretório
        if (!entry.avatarUrl && target.number) {
            _getDirectory(target.number).then(dir => {
                const cur = _hostMembers.get(devId);
                if (dir?.avatarUrl && cur) {
                    cur.avatarUrl = dir.avatarUrl;
                    _renderCall();
                }
            }).catch(() => {});
        }

        const mixCtx = _ensureMixCtx();
        if (mixCtx && _localStream) {
            const tmpDest = mixCtx.createMediaStreamDestination();
            const tmpSrc = mixCtx.createMediaStreamSource(_localStream);
            tmpSrc.connect(tmpDest);
            entry.mixer = { dest: tmpDest, sources: [tmpSrc] };
        }
        if (entry.mixer) entry.mixer.dest.stream.getAudioTracks().forEach(t => pc.addTrack(t, entry.mixer.dest.stream));
        else if (_localStream) _localStream.getAudioTracks().forEach(t => pc.addTrack(t, _localStream));

        const remote = new MediaStream();
        pc.ontrack = (ev) => {
            ev.streams[0].getAudioTracks().forEach(t => remote.addTrack(t));
            entry.remoteStream = remote;
            if (!entry.audioEl) {
                entry.audioEl = new Audio();
                entry.audioEl.srcObject = remote;
                entry.audioEl.autoplay = true;
                entry.audioEl.play().catch(() => {});
            }
            _rebuildAllHostMixers();
            _startVadFor(devId, remote);
        };
        pc.onicecandidate = (ev) => {
            if (!ev.candidate) return;
            sigPost(devId, 'ice/caller', ev.candidate.toJSON()).catch(() => {});
        };
        pc.onconnectionstatechange = () => {
            const s = pc.connectionState;
            if (s === 'connected') {
                entry.disconnectedAt = 0;
                if (entry.iceRestartTimer) { clearTimeout(entry.iceRestartTimer); entry.iceRestartTimer = null; }
                if (!entry.answered) {
                    entry.answered = true;
                    if (_phase === 'outgoing') {
                        _phase = 'active'; _startedAt = Date.now();
                        stopRingLoop(); tonePickup(); _renderCall(); _startTimers();
                    } else { toneJoin(); _renderCall(); }
                }
            } else if (s === 'disconnected') {
                if (!entry.disconnectedAt) {
                    entry.disconnectedAt = Date.now();
                    try { entry.pc.restartIce(); } catch(_) {}
                    if (entry.iceRestartTimer) clearTimeout(entry.iceRestartTimer);
                    entry.iceRestartTimer = setTimeout(() => {
                        if (entry.pc.connectionState !== 'connected') _removeHostMember(devId, true);
                    }, ICE_RESTART_WINDOW_MS);
                }
            } else if (s === 'failed') {
                _removeHostMember(devId, true);
            }
        };

        (async () => {
            try {
                await sigDel(devId, '');
                await new Promise(r => setTimeout(r, 60));
                const offer = await pc.createOffer({ offerToReceiveAudio: true });
                await pc.setLocalDescription(offer);
                await _waitIce(pc, 2200);

                // Avatar confiável: cache local → diretório
                const myAvatar = await _resolveMyAvatar();

                const payload = {
                    type: 'offer', kind: 'phone', sdp: pc.localDescription.sdp,
                    fromId: bridge.deviceId || '', fromName: bridge.player?.name || 'Usuário',
                    fromAvatar: myAvatar, fromNumber: _myNumber || '', ts: Date.now()
                };
                if (_hostState.callId) { payload.groupId = _hostState.callId; payload.groupSize = _hostMembers.size; }
                const ok = await sigPut(devId, 'offer', payload);
                if (!ok) { _removeHostMember(devId, false); return; }
            } catch (e) { _removeHostMember(devId, false); }
        })();

        entry.pollTimer = setInterval(() => _pollHostSignal(devId), POLL_MS);
        _pollHostSignal(devId);
    }

    async function _pollHostSignal(devId) {
        const entry = _hostMembers.get(devId);
        if (!entry || !entry.pc) return;
        const doc = await sigGet(devId, '');
        if (!doc) return;
        if (doc.offer && doc.offer.type === 'hangup' && doc.offer.fromId && doc.offer.fromId !== bridge.deviceId) {
            _removeHostMember(devId, true); return;
        }
        if (!entry.answered && doc.answer) {
            if (doc.answer.type === 'reject') {
                const reason = doc.answer.reason || 'rejected';
                const label = reason === 'busy' ? 'Ocupado' : reason === 'timeout' ? 'Sem resposta' : reason === 'blocked' ? 'Bloqueada' : 'Recusada';
                _toast((entry.name || 'Sessão') + ' ' + label.toLowerCase(), 'err');
                _removeHostMember(devId, false);
                if (_hostMembers.size === 0 && _phase !== 'idle') _endCall(false, label);
                return;
            }
            if (doc.answer.sdp) {
                try { await entry.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: doc.answer.sdp })); entry.answered = true; } catch(_) {}
            }
        }
        const remoteIce = await sigGet(devId, 'ice/callee');
        if (remoteIce) {
            for (const k in remoteIce) {
                if (entry.iceSeen.has(k)) continue;
                entry.iceSeen.add(k);
                const cand = remoteIce[k];
                if (cand && cand.candidate) { try { await entry.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(_) {} }
            }
        }
    }

    function _removeHostMember(devId, notify) {
        const entry = _hostMembers.get(devId);
        if (!entry) return;
        if (entry.pollTimer) { clearInterval(entry.pollTimer); entry.pollTimer = null; }
        if (entry.iceRestartTimer) { clearTimeout(entry.iceRestartTimer); entry.iceRestartTimer = null; }
        _stopVadFor(devId);
        _disposeHostMixer(devId);
        if (entry.audioEl) { try { entry.audioEl.pause(); entry.audioEl.srcObject = null; } catch(_) {} }
        try { entry.pc.close(); } catch(_) {}
        _hostMembers.delete(devId);
        _individualMutes.delete(devId);
        if (notify) sigPut(devId, 'offer', { type: 'hangup', kind: 'phone', fromId: bridge.deviceId || '', ts: Date.now() }).catch(() => {});
        if (_hostState.callId && bridge.rtdb?.del) {
            bridge.rtdb.del(gcallPath(_hostState.callId) + '/members/' + devId).catch(() => {});
            bridge.rtdb.del(gcallPath(_hostState.callId) + '/speaking/' + devId).catch(() => {});
        }
        _rebuildAllHostMixers();
        if (_hostMembers.size === 0 && _phase !== 'idle') { _endCall(false, 'Encerrada'); return; }
        _renderCall();
    }

    async function _addMemberToCall(target) {
        if (_hostMembers.has(target.id)) return;
        if (!_hostState.callId) {
            _hostState.callId = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            _hostState.createdAt = Date.now();
            _isGroupCaller = true;
            try {
                await gcallPut({
                    hostId: bridge.deviceId || '', hostName: bridge.player?.name || 'Host',
                    hostAvatar: bridge.player?.avatarUrl || '', hostNumber: _myNumber || '',
                    createdAt: _hostState.createdAt, status: 'active', members: {}, speaking: {}
                });
                await gcallMemberPut(bridge.deviceId, {
                    name: bridge.player?.name || 'Host', avatarUrl: bridge.player?.avatarUrl || '',
                    number: _myNumber || '', joinedAt: _hostState.createdAt, isHost: true
                });
                for (const [devId, e] of _hostMembers) {
                    await gcallMemberPut(devId, { name: e.name, avatarUrl: e.avatarUrl, number: e.number, joinedAt: e.joinedAt });
                }
            } catch(_) {}
        } else {
            await gcallMemberPut(target.id, { name: target.name, avatarUrl: target.avatarUrl, number: target.number, joinedAt: Date.now() }).catch(() => {});
        }
        _spawnHostPeer(target, false);
    }

    function _toggleMuteMember(devId) {
        if (_individualMutes.has(devId)) _individualMutes.delete(devId);
        else _individualMutes.add(devId);
        _rebuildAllHostMixers();
        _renderCall();
    }

    // ═══ INCOMING ═══
    function _onIncoming(offer) {
        if (!offer) return;
        if (offer.type === 'hangup') {
            if (_peer && offer.fromId === _peer.id) _endCall(false, 'Encerrada');
            return;
        }
        if (offer.type !== 'offer' || !offer.sdp) return;
        if (offer.fromNumber && isBlocked(offer.fromNumber)) {
            sigPut(bridge.deviceId, 'answer', { type: 'reject', reason: 'blocked', ts: Date.now() }).catch(() => {});
            return;
        }
        if (_phase !== 'idle') {
            sigPut(bridge.deviceId, 'answer', { type: 'reject', reason: 'busy', ts: Date.now() }).catch(() => {});
            return;
        }
        if (_minimized) _setMinimized(false);
        _maybeNotify(offer.fromName, offer.fromAvatar);

        _incomingOffer = offer;
        _peer = { id: offer.fromId || '', name: offer.fromName || 'Sem nome', avatarUrl: offer.fromAvatar || '', number: offer.fromNumber || '' };
        _isGroupCaller = false;

        // Fallback: puxa avatar do caller via diretório se veio vazio
        if (!_peer.avatarUrl && offer.fromNumber) {
            _getDirectory(offer.fromNumber).then(dir => {
                if (dir?.avatarUrl && _peer && _peer.id === offer.fromId) {
                    _peer.avatarUrl = dir.avatarUrl;
                    _renderCall();
                }
            }).catch(() => {});
        }

        _phase = 'incoming';
        _renderCall();
        startRingLoop();
        toneNotify();
        _startTimeout(CALL_TIMEOUT_MS, () => { _rejectCall('timeout'); });
    }

    function _maybeNotify(name, avatar) {
        try {
            if (!document.hidden) return;
            if (typeof Notification === 'undefined') return;
            if (Notification.permission === 'granted') {
                const n = new Notification(name || 'Chamada', { body: 'Chamando no celular…', tag: 'sang-phone-call' });
                n.onclick = () => { window.focus(); if (_minimized) _setMinimized(false); n.close(); };
            } else if (Notification.permission === 'default' && !localStorage.getItem(LS_NOTIF)) {
                localStorage.setItem(LS_NOTIF, '1');
                Notification.requestPermission().catch(() => {});
            }
        } catch(_) {}
    }

    // ═══ ACCEPT ═══
    async function _acceptCall() {
        const offer = _incomingOffer;
        if (!offer || _phase !== 'incoming') return;
        stopRingLoop(); _cancelTimeout();
        let stream;
        try { stream = await _ensureStream(); } catch (e) { _rejectCall('no-mic'); return; }
        _phase = 'active';
        _startedAt = Date.now();
        _answered = true;
        _iceSeen.clear();
        _renderCall();
        _startTimers();

        if (offer.groupId) {
            _groupRosterCache = { callId: offer.groupId, host: offer.fromId, members: [] };
            _groupPollTimer = setInterval(_pollGroupRoster, GROUP_POLL_MS);
            _pollGroupRoster();
        }
        try {
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            _pc = pc;
            stream.getAudioTracks().forEach(t => pc.addTrack(t, stream));
            const remote = new MediaStream();
            pc.ontrack = (ev) => {
                ev.streams[0].getAudioTracks().forEach(t => remote.addTrack(t));
                _remoteAudio = new Audio();
                _remoteAudio.srcObject = remote;
                _remoteAudio.autoplay = true;
                _remoteAudio.play().catch(() => {});
                window._phoneRemoteEl = _remoteAudio;
            };
            pc.onicecandidate = (ev) => {
                if (!ev.candidate) return;
                sigPost(bridge.deviceId, 'ice/callee', ev.candidate.toJSON()).catch(() => {});
            };
            pc.onconnectionstatechange = () => {
                const s = pc.connectionState;
                if (s === 'disconnected' && !_iceRestartTimer) {
                    _iceRestartTimer = setTimeout(() => {
                        _iceRestartTimer = null;
                        if (_pc && _pc.connectionState !== 'connected' && _phase !== 'idle') {
                            _endCall(true, 'Conexão perdida');
                        }
                    }, ICE_RESTART_WINDOW_MS);
                    try { pc.restartIce(); } catch(_) {}
                } else if (s === 'connected') {
                    if (_iceRestartTimer) { clearTimeout(_iceRestartTimer); _iceRestartTimer = null; }
                } else if (s === 'failed') {
                    _endCall(true, 'Conexão perdida');
                }
            };
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offer.sdp }));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sigPut(bridge.deviceId, 'answer', { type: 'answer', sdp: answer.sdp, fromId: bridge.deviceId, ts: Date.now() });
            _pollTimer = setInterval(() => _pollSignal(bridge.deviceId, 'callee'), POLL_MS);
            _pollSignal(bridge.deviceId, 'callee');
        } catch (e) { _endCall(true, 'Erro ao atender'); }
    }

    async function _pollGroupRoster() {
        if (!_groupRosterCache || _phase !== 'active') return;
        try {
            const doc = await bridge.rtdb.get(RTDB_GCALL + '/' + _groupRosterCache.callId);
            if (!doc) return;
            const members = doc.members ? Object.entries(doc.members).map(([id, m]) => ({ id, ...m })) : [];
            _groupRosterCache.members = members;
            _groupRosterCache.hostName = doc.hostName || _peer?.name || 'Host';
            _groupRosterCache.hostAvatar = doc.hostAvatar || _peer?.avatarUrl || '';
            if (doc.status === 'ended') { _endCall(false, 'Encerrada'); return; }
            _speakingSet.clear();
            if (doc.speaking) {
                for (const devId in doc.speaking) {
                    if (doc.speaking[devId]?.s === 1) _speakingSet.add(devId);
                }
            }
            if (_peer && _incomingOffer?.groupId) _renderCall();
        } catch(_) {}
    }

    function _rejectCall(reason) {
        const offer = _incomingOffer;
        stopRingLoop(); _cancelTimeout();
        // Escreve no próprio path — é de lá que o caller está lendo
        if (offer) {
            sigPut(bridge.deviceId, 'answer', { type: 'reject', reason: reason || 'rejected', ts: Date.now() }).catch(() => {});
        }
        _cleanupCall();
        _phase = 'idle';
        _incomingOffer = null;
        _peer = null;
        _renderTab();
    }

    async function _pollSignal(targetId, role) {
        if (_phase === 'idle') return;
        const doc = await sigGet(targetId, '');
        if (!doc) return;
        if (doc.offer && doc.offer.type === 'hangup' && doc.offer.fromId && doc.offer.fromId !== bridge.deviceId) { _endCall(false, 'Encerrada'); return; }
        if (role === 'caller' && doc.answer && !_answered) {
            if (doc.answer.type === 'reject') {
                const reason = doc.answer.reason || 'rejected';
                const label = reason === 'busy' ? 'Ocupado' : reason === 'timeout' ? 'Sem resposta' : reason === 'blocked' ? 'Bloqueada' : 'Recusada';
                _endCall(true, label);
                return;
            }
            if (doc.answer.sdp && _pc) {
                try { await _pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: doc.answer.sdp })); _answered = true; } catch(_) {}
            }
        }
        const remoteIceKey = role === 'caller' ? 'ice/callee' : 'ice/caller';
        const remoteIce = await sigGet(targetId, remoteIceKey);
        if (remoteIce && _pc) {
            for (const k in remoteIce) {
                if (_iceSeen.has(k)) continue;
                _iceSeen.add(k);
                const cand = remoteIce[k];
                if (cand && cand.candidate) { try { await _pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(_) {} }
            }
        }
    }

    function _endCall(notifyRemote, label) {
        stopRingLoop(); _cancelTimeout();
        _recordHistory(label);

        if (_hostMembers.size) {
            for (const devId of _hostMembers.keys()) {
                if (notifyRemote) sigPut(devId, 'offer', { type: 'hangup', kind: 'phone', fromId: bridge.deviceId || '', ts: Date.now() }).catch(() => {});
                setTimeout(() => { sigDel(devId, '').catch(() => {}); }, 1500);
            }
        } else if (notifyRemote && _peer && _peer.id) {
            sigPut(_peer.id, 'offer', { type: 'hangup', kind: 'phone', fromId: bridge.deviceId || '', ts: Date.now() }).catch(() => {});
            const targetId = _peer.id;
            setTimeout(() => { sigDel(targetId, '').catch(() => {}); }, 1500);
        }
        if (_hostState.callId) {
            bridge.rtdb.put(gcallPath(_hostState.callId) + '/status', 'ended').catch(() => {});
            setTimeout(() => { bridge.rtdb.del(gcallPath(_hostState.callId)).catch(() => {}); }, 4000);
        }
        toneHangup();
        _cleanupCall();
        _phase = 'idle';
        _peer = null;
        _incomingOffer = null;
        _isGroupCaller = false;
        _groupRosterCache = null;
        _renderTab();
        if (label) _busyTone(label, '');
    }

    function _recordHistory(label) {
        if (!_peer && !_hostMembers.size) return;
        const dur = _startedAt ? (Date.now() - _startedAt) : 0;
        const wasGroup = _hostMembers.size > 1 || (_hostMembers.size === 1 && _isGroupCaller) || (_incomingOffer?.groupId);
        const members = [];
        if (_hostMembers.size) {
            for (const [, e] of _hostMembers) members.push({ number: e.number || '', name: e.name || '', avatarUrl: e.avatarUrl || '' });
        } else if (_peer) {
            members.push({ number: _peer.number || '', name: _peer.name || '', avatarUrl: _peer.avatarUrl || '' });
        }
        if (!members.length) return;
        const dir = _incomingOffer ? 'incoming' : 'outgoing';
        let status = 'answered';
        if (dur === 0) {
            if (label === 'Recusada' || label === 'Bloqueada') status = 'rejected';
            else if (['Sem resposta','Ocupado','Fora de área'].includes(label)) status = 'missed';
            else status = 'answered';
        }
        pushHistory({
            id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            direction: dir, kind: wasGroup ? 'group' : '1:1',
            members, at: Date.now(), durationMs: dur, status
        });
    }

    function _cleanupCall() {
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
        if (_durTimer) { clearInterval(_durTimer); _durTimer = null; }
        if (_timeoutTimer) { clearTimeout(_timeoutTimer); _timeoutTimer = null; }
        if (_groupPollTimer) { clearInterval(_groupPollTimer); _groupPollTimer = null; }
        if (_iceRestartTimer) { clearTimeout(_iceRestartTimer); _iceRestartTimer = null; }
        if (_vadRaf) { cancelAnimationFrame(_vadRaf); _vadRaf = null; }
        for (const devId of Array.from(_hostMembers.keys())) {
            const entry = _hostMembers.get(devId);
            if (entry.pollTimer) clearInterval(entry.pollTimer);
            if (entry.iceRestartTimer) clearTimeout(entry.iceRestartTimer);
            if (entry.audioEl) { try { entry.audioEl.pause(); entry.audioEl.srcObject = null; } catch(_) {} }
            _stopVadFor(devId);
            _disposeHostMixer(devId);
            try { entry.pc.close(); } catch(_) {}
        }
        _hostMembers.clear();
        _hostState.callId = null;
        _individualMutes.clear();
        _speakingSet.clear();
        if (_pc) {
            try { _pc.getSenders().forEach(s => { try { s.track?.stop?.(); } catch(e) {} }); } catch(e) {}
            try { _pc.close(); } catch(e) {}
            _pc = null;
        }
        if (_remoteAudio) { try { _remoteAudio.pause(); _remoteAudio.srcObject = null; } catch(e) {} _remoteAudio = null; delete window._phoneRemoteEl; }
        if (_localStream) { try { _localStream.getTracks().forEach(t => t.stop()); } catch(e) {} _localStream = null; }
        if (_mixCtx) { try { _mixCtx.close(); } catch(_) {} _mixCtx = null; }
        _startedAt = 0;
        _answered = false;
        _iceSeen.clear();
    }

    function _startTimeout(ms, cb) { _cancelTimeout(); _timeoutTimer = setTimeout(cb, ms); }
    function _cancelTimeout() { if (_timeoutTimer) { clearTimeout(_timeoutTimer); _timeoutTimer = null; } }
    function _startTimers() {
        if (_durTimer) clearInterval(_durTimer);
        _durTimer = setInterval(() => {
            const elt = _root.querySelector('#phTimer');
            if (elt) elt.textContent = _startedAt ? fmtDur(Date.now() - _startedAt) : '00:00';
        }, 250);
    }

    function _busyTone(title, sub) {
        _phase = 'busy';
        _renderBusy(title, sub);
        startBusyLoop();
        if (_busyDismissTimer) clearTimeout(_busyDismissTimer);
        _busyDismissTimer = setTimeout(() => {
            if (_phase === 'busy') { _phase = 'idle'; _renderTab(); }
        }, 4500);
    }

    // ═══ FRAME ═══
    function _ensureFrame() {
        if (_frameEl) return;
        _ensureHost();

        _frameEl = el('div', { class: 'ph-frame' + (_minimized ? ' min' : ''), id: 'phFrame' });
        _frameEl.innerHTML = `
            <div class="ph-side vol1"></div>
            <div class="ph-side vol2"></div>
            <div class="ph-side pwr"></div>
            <div class="ph-notch" id="phNotch" title="Clique para ${_minimized ? 'expandir' : 'minimizar'}"></div>
            <div class="ph-screen">
                <div class="ph-wall-shine"></div>
                <div class="ph-status">
                    <span class="ph-status-time" id="phTime">--:--</span>
                    <span class="ph-status-icons">
                        <span class="sig"><i></i><i></i><i></i><i></i></span>
                        <span style="font-size:9px;font-weight:800;letter-spacing:.02em;">LTE</span>
                        <span class="ph-status-ver">Android ${PHONE_VERSION}</span>
                        <span class="dot-notif" id="phNotifDot"></span>
                    </span>
                </div>
                <div class="ph-hdr">
                    <div>
                        <div class="ph-hdr-title">CELULAR</div>
                        <div class="ph-hdr-sub">Sang Hub · P2P</div>
                    </div>
                    <span class="ph-hdr-count" id="phCount">0</span>
                </div>
                <div class="ph-me" id="phMe" title="Clique para copiar">
                    <span class="ph-me-label">meu número</span>
                    <span class="ph-me-number loading" id="phMyNum">··· — ···</span>
                    <span class="ph-me-copy">${I.copy}</span>
                </div>
                <div class="ph-tabs">
                    <button class="ph-tab active" data-tab="contatos">Contatos</button>
                    <button class="ph-tab" data-tab="discar">Discar</button>
                    <button class="ph-tab" data-tab="recentes">Recentes</button>
                </div>
                <div class="ph-content" id="phContent"></div>
                <div class="ph-home"></div>
            </div>
        `;
        _root.appendChild(_frameEl);
        _screenEl = _frameEl.querySelector('.ph-screen');
        _myNumEl = _frameEl.querySelector('#phMyNum');

        _tickClock();
        setInterval(() => { if (!_dying) _tickClock(); }, 15000);

        const notch = _frameEl.querySelector('#phNotch');
        notch.addEventListener('click', (e) => { e.stopPropagation(); _setMinimized(!_minimized); });
        _frameEl.addEventListener('click', (e) => {
            if (!_minimized) return;
            if (e.target.closest('#phNotch')) return;
            _setMinimized(false);
        });
        _frameEl.querySelector('#phMe').addEventListener('click', (e) => { e.stopPropagation(); _copyMyNumber(); });
        _frameEl.querySelectorAll('.ph-tab').forEach(t => {
            t.addEventListener('click', () => {
                if (['outgoing','incoming','active'].includes(_phase)) return;
                _activeTab = t.dataset.tab;
                _frameEl.querySelectorAll('.ph-tab').forEach(b => b.classList.toggle('active', b === t));
                _renderTab();
            });
        });

        _ensureMyNumber().then(n => { if (n && !_minimized) _toast('Seu número: ' + fmtNumber(n), 'ok'); });
        _renderTab();
        _startNotesPoll();
    }

    function _setMinimized(v) {
        if (v === _minimized) return;
        _minimized = !!v;
        try { localStorage.setItem(LS_MINIMIZED, _minimized ? '1' : '0'); } catch(_) {}
        if (!_frameEl) return;
        _frameEl.classList.toggle('min', _minimized);
        const notch = _frameEl.querySelector('#phNotch');
        if (notch) notch.title = _minimized ? 'Clique para expandir' : 'Clique para minimizar';
        try { if (_minimized) toneTuck(); else tonePull(); } catch(_) {}
    }

    function _updateMyNumberUI() {
        if (!_myNumEl) return;
        if (_myNumber) { _myNumEl.textContent = fmtNumber(_myNumber); _myNumEl.classList.remove('loading'); }
        else { _myNumEl.textContent = '··· — ···'; _myNumEl.classList.add('loading'); }
    }
    async function _copyMyNumber() {
        if (!_myNumber) { _toast('Número ainda sendo gerado', 'err'); return; }
        try { await navigator.clipboard.writeText(fmtNumber(_myNumber)); _toast('Número copiado', 'ok'); }
        catch(_) { _toast('Falha ao copiar', 'err'); }
    }
    function _tickClock() {
        const t = _frameEl?.querySelector('#phTime');
        if (!t) return;
        const d = new Date();
        t.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    function _setNotifDot(on) {
        const d = _frameEl?.querySelector('#phNotifDot');
        if (d) d.classList.toggle('on', !!on);
    }

    // ═══ TABS ═══
    function _renderTab() {
        if (!_screenEl) return;
        if (!['idle', 'busy'].includes(_phase)) return;
        if (_activeTab === 'discar') _renderDial();
        else if (_activeTab === 'recentes') _renderHistory();
        else _renderContacts();
    }

    // ═══ CONTATOS ═══
    async function _renderContacts() {
        if (!_screenEl) return;
        const content = _screenEl.querySelector('#phContent');
        if (!content) return;

        content.innerHTML = `<div class="ph-list"><div class="ph-empty">Carregando…</div></div>`;
        await _fetchSessions(false);

        const all = _contacts.map(_enrichContact);
        const q = _searchQuery.trim().toLowerCase();
        const filtered = q
            ? all.filter(c => (c.name || '').toLowerCase().includes(q) || c.number.includes(q) || (c.username || '').toLowerCase().includes(q))
            : all;

        const onlineCount = all.filter(c => c.online && !c.blocked).length;
        const cntEl = _frameEl.querySelector('#phCount');
        if (cntEl) cntEl.textContent = String(onlineCount);

        if (!all.length) {
            content.innerHTML = `<div class="ph-list">
                <div class="ph-empty">
                    <strong>Sem contatos ainda.</strong><br>
                    Vá em <b>Discar</b>, digite o número de alguém e toque em <b>Salvar</b>.
                    <div class="hint">Passe o seu número clicando no cartão acima ☝</div>
                </div>
            </div>`;
            return;
        }

        const sortFn = (a, b) => {
            if (a.fav !== b.fav) return a.fav ? -1 : 1;
            if (a.online !== b.online) return a.online ? -1 : 1;
            return (a.name || '').localeCompare(b.name || '');
        };
        const favs = filtered.filter(c => c.fav).sort(sortFn);
        const others = filtered.filter(c => !c.fav && !c.blocked).sort(sortFn);
        const blocked = filtered.filter(c => c.blocked).sort(sortFn);

        const parts = [];
        parts.push(`<input class="ph-search" id="phSearch" type="text" placeholder="Buscar contato ou número…" value="${esc(_searchQuery)}" spellcheck="false" />`);
        parts.push(`<div class="ph-list" id="phListWrap">`);

        if (!favs.length && !others.length && !blocked.length) {
            parts.push(`<div class="ph-empty">Nada encontrado.</div>`);
        } else {
            const renderGroup = (arr) => arr.map(c => _rowHtml(c)).join('');
            if (favs.length) {
                parts.push(`<div class="ph-section-hdr fav">★ Favoritos <span class="line"></span></div>`);
                parts.push(renderGroup(favs));
            }
            if (others.length) {
                parts.push(renderGroup(others));
            }
            if (blocked.length) {
                parts.push(`<div class="ph-section-hdr blocked">Bloqueados <span class="line"></span></div>`);
                parts.push(renderGroup(blocked));
            }
        }
        parts.push(`</div>`);
        content.innerHTML = parts.join('');

        const searchInput = content.querySelector('#phSearch');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                _searchQuery = searchInput.value;
                _renderContacts();
            });
            if (q) { searchInput.focus(); searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length); }
        }

        content.querySelectorAll('.ph-contact').forEach(row => {
            const num = row.dataset.num;
            const callBtn = row.querySelector('.ph-call-btn');
            const rmBtn = row.querySelector('.ph-rm');
            const trigger = (e) => {
                if (e) e.stopPropagation();
                if (isBlocked(num)) { _toast('Contato bloqueado', 'err'); return; }
                toneDial();
                _callByNumber(num);
            };
            if (callBtn && !callBtn.disabled) callBtn.addEventListener('click', trigger);
            row.addEventListener('dblclick', (e) => trigger(e));
            if (rmBtn) rmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeContact(num);
                _toast('Contato removido', 'ok');
                _renderContacts();
            });
        });
    }

    function _rowHtml(c) {
        const initial = (c.name || '?')[0] || '?';
        const av = c.avatarUrl
            ? `<div class="ph-av"><img src="${esc(c.avatarUrl)}" alt="" />${c.fav ? '<span class="fav-badge">★</span>' : ''}${c.online && !c.blocked ? '<span class="dot-online"></span>' : ''}</div>`
            : `<div class="ph-av">${esc(initial.toUpperCase())}${c.fav ? '<span class="fav-badge">★</span>' : ''}${c.online && !c.blocked ? '<span class="dot-online"></span>' : ''}</div>`;
        const meta = c.blocked
            ? `<span class="num">${esc(fmtNumber(c.number))}</span> · <span class="off">bloqueado</span>`
            : c.online
                ? `<span class="num">${esc(fmtNumber(c.number))}</span> · <span>online</span>`
                : `<span class="num">${esc(fmtNumber(c.number))}</span> · <span class="off">offline</span>`;
        return `<div class="ph-contact ${c.blocked ? 'blocked' : (c.online ? '' : 'offline')} ${c.fav ? 'fav' : ''}" data-num="${esc(c.number)}" data-name="${esc(c.name)}">
            ${av}
            <div class="ph-info">
                <div class="ph-name">${esc(c.name)}</div>
                <div class="ph-meta">${meta}</div>
            </div>
            <button class="ph-rm" data-rm="${esc(c.number)}" title="Remover">✕</button>
            <button class="ph-call-btn" ${c.online && !c.blocked ? '' : 'disabled'} title="${c.blocked ? 'Bloqueado' : c.online ? 'Ligar' : 'Offline'}">${I.phone}</button>
        </div>`;
    }

    // ═══ RECENTES ═══
    function _renderHistory() {
        if (!_screenEl) return;
        const content = _screenEl.querySelector('#phContent');
        if (!content) return;
        if (!_history.length) {
            content.innerHTML = `<div class="ph-list">
                <div class="ph-empty">
                    <strong>Sem chamadas ainda.</strong>
                    <div class="hint">Ligue para alguém pelo número ou pela lista de contatos.</div>
                </div>
            </div>`;
            return;
        }
        const rows = _history.map(h => {
            const first = h.members[0] || {};
            const initial = (first.name || '?')[0] || '?';
            const av = first.avatarUrl
                ? `<div class="ph-av"><img src="${esc(first.avatarUrl)}" alt="" /></div>`
                : `<div class="ph-av">${esc(initial.toUpperCase())}</div>`;
            const label = h.kind === 'group'
                ? (first.name || 'Grupo') + ' +' + (h.members.length - 1)
                : (first.name || fmtNumber(first.number));
            const dirClass = (h.status === 'missed' || h.status === 'rejected') ? 'dir-miss'
                            : (h.direction === 'incoming' ? 'dir-in' : 'dir-out');
            const dirIcon = h.direction === 'incoming' ? I.arrowIn : I.arrowOut;
            const durTxt = h.durationMs > 0 ? fmtDurShort(h.durationMs)
                          : (h.status === 'missed' ? 'perdida'
                          : h.status === 'rejected' ? 'recusada' : '—');
            const metaParts = [
                `<span class="${dirClass}" style="display:inline-flex;align-items:center;width:10px;height:10px;">${dirIcon}</span>`,
                h.kind === 'group' ? `<span class="grp">${h.members.length} pessoas</span>` : `<span class="num">${esc(fmtNumber(first.number))}</span>`,
                `<span>${timeAgo(h.at)}</span>`,
                `<span>${durTxt}</span>`
            ];
            const canRecall = h.kind === '1:1' && first.number && first.number.length === 6 && !isBlocked(first.number);
            const callBtn = canRecall ? `<button class="ph-call-btn" data-num="${esc(first.number)}" title="Ligar">${I.phone}</button>` : '';
            return `<div class="ph-contact" data-history-id="${esc(h.id)}" ${canRecall ? `data-num="${esc(first.number)}"` : ''}>
                ${av}
                <div class="ph-info">
                    <div class="ph-name">${esc(label)}</div>
                    <div class="ph-meta">${metaParts.join('')}</div>
                </div>
                <button class="ph-rm" data-rm-id="${esc(h.id)}" title="Apagar">✕</button>
                ${callBtn}
            </div>`;
        }).join('');
        content.innerHTML = `<div class="ph-list">${rows}</div>`;
        content.querySelectorAll('.ph-contact').forEach(row => {
            const num = row.dataset.num;
            const id = row.dataset.historyId;
            const callBtn = row.querySelector('.ph-call-btn');
            const rmBtn = row.querySelector('.ph-rm');
            if (callBtn && num) callBtn.addEventListener('click', (e) => { e.stopPropagation(); toneDial(); _callByNumber(num); });
            if (rmBtn) rmBtn.addEventListener('click', (e) => { e.stopPropagation(); removeHistoryAt(id); _renderHistory(); });
        });
    }

    // ═══ DISCADOR ═══
    function _renderDial() {
        if (!_screenEl) return;
        const content = _screenEl.querySelector('#phContent');
        if (!content) return;
        const keys = [
            { d: '1', sub: '' }, { d: '2', sub: 'ABC' }, { d: '3', sub: 'DEF' },
            { d: '4', sub: 'GHI' }, { d: '5', sub: 'JKL' }, { d: '6', sub: 'MNO' },
            { d: '7', sub: 'PQRS' }, { d: '8', sub: 'TUV' }, { d: '9', sub: 'WXYZ' },
            { util: 'back', svg: I.backspace }, { d: '0', sub: '+' }, { util: 'clear', svg: I.clear }
        ];
        const keypadHtml = keys.map(k => k.util
            ? `<button class="ph-key util" data-util="${k.util}">${k.svg}</button>`
            : `<button class="ph-key" data-digit="${k.d}"><span>${k.d}</span>${k.sub ? `<span class="sub">${k.sub}</span>` : ''}</button>`
        ).join('');
        content.innerHTML = `
            <div class="ph-dial">
                <div class="ph-dial-display">
                    <div class="ph-dial-num empty" id="phDialNum">_ _ _ — _ _ _</div>
                    <div class="ph-dial-hint" id="phDialHint">digite um número de 6 dígitos</div>
                </div>
                <div class="ph-keypad">${keypadHtml}</div>
                <div class="ph-dial-actions">
                    <button class="ph-dial-btn save" id="phSave" disabled>${I.save}<span>Salvar</span></button>
                    <button class="ph-dial-btn call" id="phCall" disabled>${I.phone}<span>Ligar</span></button>
                </div>
            </div>`;
        content.querySelectorAll('.ph-key').forEach(k => {
            k.addEventListener('click', () => {
                toneKey();
                k.classList.remove('pressed'); void k.offsetWidth; k.classList.add('pressed');
                if (k.dataset.digit) { if (_dialBuffer.length < 6) _dialBuffer += k.dataset.digit; }
                else if (k.dataset.util === 'back') _dialBuffer = _dialBuffer.slice(0, -1);
                else if (k.dataset.util === 'clear') _dialBuffer = '';
                _updateDialDisplay();
            });
        });
        content.querySelector('#phCall').addEventListener('click', () => {
            if (_dialBuffer.length === 6) { toneDial(); _callByNumber(_dialBuffer); }
        });
        content.querySelector('#phSave').addEventListener('click', async () => {
            if (_dialBuffer.length !== 6) return;
            const res = await addContactByNumber(_dialBuffer);
            if (res.ok) {
                _toast('Contato salvo', 'ok');
                _dialBuffer = '';
                _updateDialDisplay();
                _activeTab = 'contatos';
                _frameEl.querySelectorAll('.ph-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'contatos'));
                setTimeout(_renderTab, 400);
            } else _toast(res.err || 'Erro', 'err');
        });
        _updateDialDisplay();
    }

    let _dialLookupSeq = 0;
    async function _updateDialDisplay() {
        const numEl = _screenEl?.querySelector('#phDialNum');
        const hintEl = _screenEl?.querySelector('#phDialHint');
        const callBtn = _screenEl?.querySelector('#phCall');
        const saveBtn = _screenEl?.querySelector('#phSave');
        if (!numEl || !hintEl) return;
        const b = _dialBuffer;
        numEl.innerHTML = _dialDisplayHtml(b);
        numEl.classList.toggle('empty', b.length === 0);
        const full = b.length === 6;
        if (callBtn) callBtn.disabled = !full || b === _myNumber || isBlocked(b);
        if (saveBtn) saveBtn.disabled = !full || hasContact(b) || b === _myNumber;

        if (!full) {
            hintEl.textContent = b.length === 0 ? 'digite um número de 6 dígitos' : (b.length + '/6');
            hintEl.className = 'ph-dial-hint';
            return;
        }
        if (b === _myNumber) { hintEl.innerHTML = 'este é o <span class="name">seu número</span>'; hintEl.className = 'ph-dial-hint'; return; }
        if (isBlocked(b)) { hintEl.textContent = 'número bloqueado'; hintEl.className = 'ph-dial-hint blocked'; return; }
        const seq = ++_dialLookupSeq;
        hintEl.textContent = 'consultando…'; hintEl.className = 'ph-dial-hint';
        const dir = await _getDirectory(b);
        if (seq !== _dialLookupSeq) return;
        if (dir && dir.username) {
            const name = dir.displayName || dir.username;
            hintEl.innerHTML = `<span class="name">${esc(name)}</span> · ${hasContact(b) ? 'salvo' : 'não salvo'}`;
        } else { hintEl.textContent = 'número não registrado'; hintEl.className = 'ph-dial-hint err'; }
    }
    function _dialDisplayHtml(b) {
        if (!b) return '_ _ _ — _ _ _';
        if (b.length <= 3) {
            const shown = b.split('').join(' ');
            const pad = Math.max(0, 3 - b.length);
            const rest = pad ? ' ' + '_ '.repeat(pad).trim() : '';
            return shown + rest + ' — _ _ _';
        }
        const head = b.slice(0, 3).split('').join(' ');
        const tail = b.slice(3).split('').join(' ');
        const padTail = Math.max(0, 3 - (b.length - 3));
        const tailPad = padTail ? ' ' + '_ '.repeat(padTail).trim() : '';
        return head + ' <span class="dash">—</span> ' + tail + tailPad;
    }

    // ═══ DISCAR ═══
    async function _callByNumber(number) {
        const clean = parseNumber(number);
        if (clean.length !== 6) { _toast('Número incompleto', 'err'); return; }
        if (clean === _myNumber) { _toast('Você não pode ligar para si mesmo', 'err'); return; }
        if (isBlocked(clean)) { _toast('Número bloqueado', 'err'); return; }
        await _fetchSessions(true);
        let username = '';
        const dir = await _getDirectory(clean);
        if (dir && dir.username) username = dir.username;
        let live = null;
        if (username) live = _findLiveSession(username);
        if (!live) {
            const now = Date.now();
            const myId = bridge.deviceId || '';
            live = _sessionsCache.find(s => s.id !== myId && s.phoneNumber === clean && (now - (s.lastSeen || 0)) < ONLINE_MS) || null;
        }
        if (!live) {
            if (dir) updateContactMeta(clean, { username: dir.username || '', savedName: dir.displayName || '', savedAvatar: dir.avatarUrl || '' });
            const name = dir?.displayName || username || fmtNumber(clean);
            pushHistory({
                id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                direction: 'outgoing', kind: '1:1', status: 'missed',
                members: [{ number: clean, name, avatarUrl: dir?.avatarUrl || '' }],
                at: Date.now(), durationMs: 0
            });
            _busyTone('Fora de área', name + ' não está disponível.');
            return;
        }
        if (hasContact(clean)) updateContactMeta(clean, { username: live.name || username || '', savedName: live.name || '', savedAvatar: live.avatarUrl || '' });
        _call([{
            id: live.id,
            name: live.name || username || fmtNumber(clean),
            avatarUrl: live.avatarUrl || dir?.avatarUrl || '',
            number: clean,
            lastSeen: live.lastSeen || 0
        }]);
    }

    // ═══ CHAMADA — UI ═══
    function _renderCall() {
        if (!_screenEl) return;
        const content = _screenEl.querySelector('#phContent');
        if (!content) return;
        const isGroup = _hostState.callId || _incomingOffer?.groupId || _hostMembers.size > 1;
        const members = _buildCallRoster();
        if (!isGroup && members.length <= 1) {
            const peer = members[0] || _peer || {};
            const initial = (peer.name || '?')[0] || '?';
            const av = peer.avatarUrl
                ? `<div class="ph-call-av"><img src="${esc(peer.avatarUrl)}" alt="" /></div>`
                : `<div class="ph-call-av">${esc(initial.toUpperCase())}</div>`;
            content.innerHTML = _renderCallShell(av, peer, false, []);
            _wireCallActions(content);
            return;
        }
        const stack = _renderAvatarStack(members);
        content.innerHTML = _renderCallShell(stack, { name: _groupLabel(members), number: '' }, true, members);
        _wireCallActions(content);
    }
    function _buildCallRoster() {
        if (_hostMembers.size) {
            const list = [];
            for (const [devId, e] of _hostMembers) list.push({ id: devId, name: e.name, avatarUrl: e.avatarUrl, number: e.number, joinedAt: e.joinedAt });
            return list;
        }
        if (_groupRosterCache && _groupRosterCache.members && _groupRosterCache.members.length) {
            const me = bridge.deviceId;
            return _groupRosterCache.members
                .filter(m => m.id !== me)
                .map(m => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl, number: m.number, isHost: m.isHost }));
        }
        return _peer ? [{ id: _peer.id, name: _peer.name, avatarUrl: _peer.avatarUrl, number: _peer.number }] : [];
    }
    function _groupLabel(members) { return 'Grupo (' + (members.length + 1) + ')'; }
    function _renderAvatarStack(members) {
        const sorted = [...members].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
        const slots = sorted.slice(0, 4);
        const main = slots.shift();
        const parts = [];
        if (main) {
            const initial = (main.name || '?')[0] || '?';
            parts.push(main.avatarUrl
                ? `<div class="ph-call-av main stacked"><img src="${esc(main.avatarUrl)}" alt="" /></div>`
                : `<div class="ph-call-av main stacked">${esc(initial.toUpperCase())}</div>`);
        }
        slots.forEach(m => {
            const initial = (m.name || '?')[0] || '?';
            parts.push(m.avatarUrl
                ? `<div class="ph-call-av mini stacked"><img src="${esc(m.avatarUrl)}" alt="" /></div>`
                : `<div class="ph-call-av mini stacked">${esc(initial.toUpperCase())}</div>`);
        });
        const remaining = members.length - 4;
        const badge = remaining > 0 ? `<div class="ph-call-av mini stacked" style="background:rgba(52,211,153,.2);color:#a7f3d0;font-size:14px;">+${remaining}</div>` : '';
        return `<div class="ph-av-stack multi">${parts.join('')}${badge}</div>`;
    }
    function _renderCallShell(avHtml, peer, isGroup, members) {
        const phase = _phase;
        let stateText = '', actions = '';
        if (phase === 'outgoing') {
            stateText = `<div class="ph-call-state">Chamando<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div>`;
            actions = `<div class="ph-round-btn red" id="phHangup" title="Cancelar">${I.phoneDown}</div>`;
        } else if (phase === 'incoming') {
            stateText = `<div class="ph-call-state">${isGroup ? 'Chamada em grupo' : 'Recebendo chamada'}</div>`;
            actions = `
                <div class="ph-round-btn-wrap"><div class="ph-round-btn red incoming" id="phReject" title="Recusar">${I.phoneDown}</div><div class="ph-round-btn-label">Recusar</div></div>
                <div class="ph-round-btn-wrap"><div class="ph-round-btn green" id="phAccept" title="Atender">${I.phone}</div><div class="ph-round-btn-label">Atender</div></div>`;
        } else if (phase === 'active') {
            stateText = `<div class="ph-call-timer" id="phTimer">00:00</div>`;
            const isHost = _hostMembers.size > 0 || _isGroupCaller;
            const atMax = (_hostMembers.size + 1) >= MAX_GROUP_MEMBERS;
            const canAdd = isHost && !atMax;
            const addBtn = canAdd ? `<div class="ph-round-btn-wrap"><div class="ph-round-btn small add" id="phAdd" title="Adicionar">${I.plus}</div><div class="ph-round-btn-label">Adicionar</div></div>` : '';
            actions = `
                <div class="ph-round-btn-wrap"><div class="ph-round-btn small" id="phMute" title="Mudo">${I.mic}</div><div class="ph-round-btn-label">Mudo</div></div>
                ${addBtn}
                <div class="ph-round-btn-wrap"><div class="ph-round-btn red" id="phHangup" title="Desligar">${I.phoneDown}</div><div class="ph-round-btn-label">Desligar</div></div>`;
        }
        const numLine = peer.number ? `<div class="ph-call-num">${esc(fmtNumber(peer.number))}</div>` : '';
        const rosterHtml = isGroup && members.length ? _renderRosterChips(members) : '';
        return `<div class="ph-call ${phase} ${isGroup ? 'group' : ''}">
            <div class="ph-call-top">
                ${avHtml}
                <div class="ph-call-name">${esc(peer.name || '—')}</div>
                ${numLine}${stateText}${rosterHtml}
            </div>
            <div class="ph-call-actions">${actions}</div>
        </div>`;
    }
    function _renderRosterChips(members) {
        const isHost = _hostMembers.size > 0;
        const chips = members.slice(0, 6).map(m => {
            const initial = (m.name || '?')[0] || '?';
            const img = m.avatarUrl ? `<img src="${esc(m.avatarUrl)}" alt="" />` : `<span class="ini">${esc(initial.toUpperCase())}</span>`;
            const isSpeaking = isHost ? (!!_hostMembers.get(m.id)?.vad?.speaking) : _speakingSet.has(m.id);
            const muted = isHost && _individualMutes.has(m.id);
            const cls = ['chip'];
            if (m.isHost) cls.push('host');
            if (isSpeaking) cls.push('speaking');
            if (muted) cls.push('muted');
            const ctrl = isHost
                ? `<button class="mute-btn" data-mute="${esc(m.id)}" title="${muted ? 'Reativar' : 'Silenciar'}">${muted ? '🔇' : '🔊'}</button>
                   <button class="kick" data-kick="${esc(m.id)}" title="Remover">✕</button>`
                : '';
            return `<div class="${cls.join(' ')}" data-dev-id="${esc(m.id)}">
                ${img}<span>${esc(m.name || '—')}</span>${ctrl}
            </div>`;
        }).join('');
        const more = members.length > 6 ? `<div class="chip">+${members.length - 6}</div>` : '';
        return `<div class="ph-roster">${chips}${more}</div>`;
    }
    function _wireCallActions(content) {
        const hangup = content.querySelector('#phHangup');
        if (hangup) hangup.addEventListener('click', () => _endCall(true, 'Encerrada'));
        const accept = content.querySelector('#phAccept');
        if (accept) accept.addEventListener('click', () => _acceptCall());
        const reject = content.querySelector('#phReject');
        if (reject) reject.addEventListener('click', () => _rejectCall('rejected'));
        const mute = content.querySelector('#phMute');
        if (mute) mute.addEventListener('click', () => {
            if (!_localStream) return;
            const track = _localStream.getAudioTracks()[0];
            if (!track) return;
            track.enabled = !track.enabled;
            mute.classList.toggle('active', !track.enabled);
            mute.innerHTML = track.enabled ? I.mic : I.micOff;
        });
        const addBtn = content.querySelector('#phAdd');
        if (addBtn) addBtn.addEventListener('click', () => _openAddPicker());
        content.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const devId = b.dataset.kick;
            const name = _hostMembers.get(devId)?.name || 'Membro';
            _removeHostMember(devId, true);
            _toast(name + ' removido', 'ok');
            _renderCall();
        }));
        content.querySelectorAll('[data-mute]').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            _toggleMuteMember(b.dataset.mute);
        }));
    }
    function _renderBusy(title, sub) {
        if (!_screenEl) return;
        const content = _screenEl.querySelector('#phContent');
        if (!content) return;
        content.innerHTML = `<div class="ph-busy">
            <div class="ph-busy-icon">${I.off}</div>
            <div class="ph-busy-title">${esc(title || 'Ocupado')}</div>
            <div class="ph-busy-sub">${esc(sub || 'O contato não pode atender agora.')}</div>
        </div>`;
    }

    // ═══ ADD PICKER ═══
    async function _openAddPicker() {
        if (!_screenEl || _addPickerOpen) return;
        if (!_hostMembers.size) { _toast('Você não é o anfitrião', 'err'); return; }
        if ((_hostMembers.size + 1) >= MAX_GROUP_MEMBERS) { _toast('Limite de ' + MAX_GROUP_MEMBERS + ' pessoas', 'err'); return; }
        _addPickerOpen = true;
        const inCall = new Set(_hostMembers.keys());
        const ov = el('div', { class: 'ph-add-overlay' });
        ov.innerHTML = `<div class="ph-add-head"><div class="ph-add-title">Adicionar à chamada</div><button class="ph-add-close" id="phAddClose">✕</button></div>
            <div class="ph-add-body" id="phAddBody"><div class="ph-empty">Carregando…</div></div>`;
        _screenEl.appendChild(ov);
        const body = ov.querySelector('#phAddBody');
        const close = () => { _addPickerOpen = false; ov.remove(); };
        ov.querySelector('#phAddClose').addEventListener('click', close);
        await _fetchSessions(false);
        const candidates = _contacts.map(_enrichContact)
            .filter(c => c.sessionId && !inCall.has(c.sessionId) && !c.blocked)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        if (!candidates.length) { body.innerHTML = `<div class="ph-empty">Nenhum contato disponível.<br><span class="hint">Só é possível adicionar contatos online que ainda não estão na chamada.</span></div>`; return; }
        body.innerHTML = candidates.map(c => {
            const initial = (c.name || '?')[0] || '?';
            const av = c.avatarUrl
                ? `<div class="ph-av sm"><img src="${esc(c.avatarUrl)}" alt="" /><span class="dot-online"></span></div>`
                : `<div class="ph-av sm">${esc(initial.toUpperCase())}<span class="dot-online"></span></div>`;
            return `<div class="ph-contact" data-add-id="${esc(c.sessionId)}" data-add-name="${esc(c.name)}" data-add-avatar="${esc(c.avatarUrl)}" data-add-number="${esc(c.number)}">
                ${av}
                <div class="ph-info"><div class="ph-name">${esc(c.name)}</div><div class="ph-meta"><span class="num">${esc(fmtNumber(c.number))}</span> · online</div></div>
                <button class="ph-call-btn" style="border-color:rgba(34,211,238,.4);background:rgba(34,211,238,.1);color:#67e8f9;">${I.plus}</button>
            </div>`;
        }).join('');
        body.querySelectorAll('.ph-contact').forEach(row => {
            row.addEventListener('click', async () => {
                const target = { id: row.dataset.addId, name: row.dataset.addName, avatarUrl: row.dataset.addAvatar, number: row.dataset.addNumber };
                await _addMemberToCall(target);
                _toast(target.name + ' adicionado', 'ok');
                close();
                _renderCall();
            });
        });
    }

    // ═══ VOICE NOTE — gravação ═══
    async function _startNote(target, btn) {
        try { _ensureStream().catch(() => {}); } catch(_) {}
        let stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch(e) { _toast('Microfone negado', 'err'); return; }
        _recChunks = [];
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        try { _rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 }); }
        catch(e) { _rec = new MediaRecorder(stream); }
        _recTarget = target;
        _recStartedAt = Date.now();
        _rec.ondataavailable = (e) => { if (e.data.size > 0) _recChunks.push(e.data); };
        _rec.onerror = () => _cancelNote();
        try { _rec.start(); } catch(e) { _rec = null; stream.getTracks().forEach(t => t.stop()); return; }
        _rec._stream = stream;
        if (btn) btn.classList.add('recording');
        _frameEl.classList.add('recording');
        _renderRecOverlay();
        toneRecStart();
        if (_recTimer) clearInterval(_recTimer);
        _recTimer = setInterval(() => {
            const el = _root.querySelector('#phRecTimer');
            if (el) el.textContent = fmtDur(Date.now() - _recStartedAt);
        }, 250);
    }

    function _renderRecOverlay() {
        if (!_screenEl) return;
        const target = _recTarget || {};
        const ov = el('div', { class: 'ph-rec-overlay', id: 'phRecOverlay' });
        ov.innerHTML = `
            <div class="ph-rec-circle">${I.mic}</div>
            <div class="ph-rec-waves"><span></span><span></span><span></span><span></span><span></span></div>
            <div class="ph-rec-info">
                <div class="name">${esc(target.name || fmtNumber(target.number))}</div>
                <div class="timer" id="phRecTimer">00:00</div>
                <div class="hint">Solte para enviar · arraste para fora para cancelar</div>
            </div>
        `;
        _screenEl.appendChild(ov);
    }

    async function _sendNote() {
        if (!_rec) return;
        const rec = _rec;
        const target = _recTarget;
        const chunks = _recChunks;
        const stream = rec._stream;
        _rec = null; _recTarget = null; _recChunks = [];
        if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
        _frameEl?.classList.remove('recording');
        _root.querySelectorAll('.ph-note-btn.recording').forEach(b => b.classList.remove('recording'));
        _root.querySelector('#phRecOverlay')?.remove();

        return new Promise((resolve) => {
            rec.onstop = async () => {
                if (stream) try { stream.getTracks().forEach(t => t.stop()); } catch(_) {}
                const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
                if (blob.size < 800) { _toast('Gravação muito curta', 'err'); return resolve(); }
                if (blob.size > 700 * 1024) { _toast('Recado muito longo (max ~3min)', 'err'); return resolve(); }
                toneRecSend();
                _toast('Enviando recado…', 'ok');
                try {
                    const b64 = await blobToB64(blob);
                    const fields = {
                        fromNumber: bridge.firestore.value(_myNumber || ''),
                        fromName: bridge.firestore.value(bridge.player?.name || ''),
                        fromAvatar: bridge.firestore.value(bridge.player?.avatarUrl || ''),
                        toNumber: bridge.firestore.value(target.number),
                        mimeType: bridge.firestore.value(blob.type || 'audio/webm'),
                        audio: bridge.firestore.value(b64),
                        size: bridge.firestore.value(blob.size),
                        createdAt: bridge.firestore.value(Date.now())
                    };
                    await bridge.firestore.request('POST', '/' + COL_NOTES, { fields });
                    _toast('Recado enviado', 'ok');
                } catch(e) { _toast('Falha ao enviar', 'err'); }
                resolve();
            };
            try { rec.stop(); } catch(e) { resolve(); }
        });
    }

    function _cancelNote() {
        const rec = _rec;
        const stream = rec?._stream;
        _rec = null; _recTarget = null; _recChunks = [];
        if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
        _frameEl?.classList.remove('recording');
        _root.querySelectorAll('.ph-note-btn.recording').forEach(b => b.classList.remove('recording'));
        _root.querySelector('#phRecOverlay')?.remove();
        if (rec && rec.state !== 'inactive') { try { rec.onstop = null; rec.stop(); } catch(_) {} }
        if (stream) try { stream.getTracks().forEach(t => t.stop()); } catch(_) {}
        toneRecCancel();
        _toast('Cancelado', 'err');
    }

    // ═══ VOICE NOTES — receber ═══
    function _startNotesPoll() {
        if (_notesPollTimer) return;
        _notesPollTimer = setInterval(_pollNotes, NOTES_POLL_MS);
        setTimeout(_pollNotes, 3000);
    }
    async function _pollNotes() {
        if (!_myNumber || _dying) return;
        try {
            const data = await bridge.firestore.request('GET', '/' + COL_NOTES);
            const docs = data?.documents || [];
            const incoming = [];
            for (const d of docs) {
                const id = d.name.split('/').pop();
                if (_playedNotes.has(id)) continue;
                const parsed = { id, ...bridge.firestore.parseDoc(d) };
                if (parsed.toNumber !== _myNumber) continue;
                if (parsed.fromNumber === _myNumber) continue;
                if (parsed.fromNumber && isBlocked(parsed.fromNumber)) { _playedNotes.add(id); continue; }
                incoming.push(parsed);
            }
            incoming.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            for (const note of incoming) {
                _playedNotes.add(note.id);
                _setNotifDot(true);
                await _playNote(note);
            }
            savePlayed();
        } catch(_) {}
    }
    function _playNote(note) {
        return new Promise(resolve => {
            try {
                const blob = b64ToBlob(note.audio, note.mimeType);
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.autoplay = true;
                _toast('Recado de ' + (note.fromName || fmtNumber(note.fromNumber)), 'ok');
                if (_minimized) _setMinimized(false);
                audio.onended = () => { URL.revokeObjectURL(url); setTimeout(() => _setNotifDot(false), 400); resolve(); };
                audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
                audio.play().catch(() => resolve());
                window._phoneNoteEl = audio;
            } catch(_) { resolve(); }
        });
    }

    // ═══ TOGGLE / KILL ═══
    function toggle() {
        _ctx();
        if (_frameEl && _frameEl.isConnected && !_frameEl.classList.contains('hidden')) {
            _frameEl.classList.add('hidden');
            return;
        }
        loadContacts(); loadHistory(); loadBlocked(); loadPlayed();
        _ensureFrame();
        _frameEl.classList.remove('hidden');
        _tickClock();
        _updateMyNumberUI();
        if (!_myNumber) _ensureMyNumber();
        if (['idle', 'busy'].includes(_phase)) _renderTab();
    }
    function kill() {
        if (_dying) return;
        _dying = true;
        stopRingLoop();
        _cleanupCall();
        _cancelTimeout();
        try { _cancelNote(); } catch(_) {}
        if (_busyDismissTimer) clearTimeout(_busyDismissTimer);
        if (_notesPollTimer) { clearInterval(_notesPollTimer); _notesPollTimer = null; }
        try { if (_host) _host.remove(); } catch(e) {}
        try { if (_actx) _actx.close(); } catch(e) {}
        try { delete window[UID]; } catch(e) {}
    }

    // ═══ EVENTS ═══
    window.addEventListener('sang:phone-incoming', (e) => { try { _onIncoming(e?.detail); } catch(_) {} });
    window.addEventListener('sang:player-updated', () => { if (_myNumber) _refreshMyDirectory(); });

    _fetchSessions(true).catch(() => {});
    window[UID] = { toggle, kill };

    try { toggle(); } catch(e) { console.warn('[Phone] auto-open falhou:', e); }
})();
