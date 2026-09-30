// modules/phone/notifications.js
// Sistema de notificações do phone. Registro persistido, som, vibração.
// Qualquer módulo empurra via P.notify.push({...}).
(function() {
    'use strict';
    const ctx = window._phoneCtx = window._phoneCtx || {};
    const P   = ctx._phone   = ctx._phone   || {};
    if (!P.config || !P.state) { console.warn('[Phone/notify] pré-requisitos ausentes.'); return; }
    if (P.notify) return;

    const C = P.config;
    const S = P.state;

    // Sufixo — prefixo real vem de ctx.ls (sanghub_phone_<userKey>_*)
    const LS_KEY = 'notifications';
    const MAX = 50;
    const SOUND_DEBOUNCE_MS = 700;
    const VIBRATE_PATTERN = [70, 45, 70, 45, 140];

    let _items = [];
    let _subs  = [];
    let _lastSoundAt = 0;
    let _seq = 0;

    // Stub seguro caso ctx.ls não exista (não deve ocorrer — shell cria antes).
    const _ls = ctx.ls || {
        get: () => null,
        set: () => {},
        del: () => {},
        json: (k, fb) => fb
    };

    // ── CARREGAR ──
    (function _load() {
        if (!ctx.userKey) return;
        const arr = _ls.json(LS_KEY, []);
        if (!Array.isArray(arr)) return;
        _items = arr
            .filter(n => n && n.id && typeof n.title === 'string')
            .slice(0, MAX)
            .map(n => ({
                id:       String(n.id),
                appId:    n.appId || 'system',
                appName:  n.appName || 'Sistema',
                icon:     n.icon || null,
                accent:   n.accent || '#6ee7b7',
                title:    String(n.title),
                body:     n.body != null ? String(n.body) : '',
                priority: n.priority || 'normal',
                sound:    n.sound !== false,
                vibrate:  n.vibrate !== false,
                ts:       Number(n.ts) || Date.now(),
                readAt:   n.readAt || null,
                meta:     n.meta || null
            }));
    })();

    // ── SALVAR ──
    function _save() {
        if (!ctx.userKey) return;
        try {
            if (_items.length > MAX) _items = _items.slice(0, MAX);
            _ls.set(LS_KEY, JSON.stringify(_items));
        } catch(_) {}
    }

    // ── SOM ──
    function _whistle() {
        if (window._hubSFX?.isMuted?.()) return;
        if (S.settings && S.settings.sound === false) return;
        const now = Date.now();
        if (now - _lastSoundAt < SOUND_DEBOUNCE_MS) return;
        _lastSoundAt = now;

        const c = ctx.getAudioCtx?.();
        if (!c) return;
        if (c.state === 'suspended') c.resume().catch(() => {});

        const t0 = c.currentTime + 0.01;
        const notes = [
            { freq: 880.00,  at: 0.00, dur: 0.16 },
            { freq: 1174.66, at: 0.09, dur: 0.20 }
        ];
        notes.forEach(({ freq, at, dur }) => {
            const osc  = c.createOscillator();
            const gain = c.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t0 + at);
            gain.gain.setValueAtTime(0, t0 + at);
            gain.gain.linearRampToValueAtTime(0.055, t0 + at + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
            osc.connect(gain).connect(c.destination);
            osc.start(t0 + at);
            osc.stop(t0 + at + dur + 0.02);
        });
    }

    // ── VIBRAÇÃO ──
    function _vibrate() {
        try { navigator.vibrate?.(VIBRATE_PATTERN); } catch(_) {}
    }

    // ── SHAKE VISUAL ──
    function _buzzScreen() {
        const s = ctx.screenEl;
        if (!s) return;
        s.classList.remove('buzz'); void s.offsetWidth;
        s.classList.add('buzz');
        setTimeout(() => s.classList.remove('buzz'), 620);
    }

    // ── API ──
    function push(entry) {
        if (!entry || !entry.title) return null;
        const item = {
            id:       entry.id || ('n' + Date.now().toString(36) + (_seq++).toString(36)),
            appId:    entry.appId || 'system',
            appName:  entry.appName || 'Sistema',
            icon:     entry.icon || null,
            accent:   entry.accent || '#6ee7b7',
            title:    String(entry.title),
            body:     entry.body != null ? String(entry.body) : '',
            priority: entry.priority || 'normal',
            sound:    entry.sound !== false,
            vibrate:  entry.vibrate !== false,
            ts:       Number(entry.ts) || Date.now(),
            readAt:   null,
            meta:     entry.meta || null
        };
        _items.unshift(item);
        if (_items.length > MAX) _items = _items.slice(0, MAX);
        _save();

        if (item.sound)   _whistle();
        if (item.vibrate) { _vibrate(); _buzzScreen(); }

        _emit('push', item);
        _notifySubs();
        try {
            window.dispatchEvent(new CustomEvent('sang:phone-notify', { detail: item }));
        } catch(_) {}
        return item;
    }

    function dismiss(id) {
        const before = _items.length;
        _items = _items.filter(n => n.id !== id);
        if (_items.length !== before) { _save(); _emit('dismiss', id); _notifySubs(); }
    }

    function clear() {
        if (!_items.length) return;
        _items = [];
        _save();
        _emit('clear');
        _notifySubs();
    }

    function list() { return _items.slice(); }

    function unreadCount() { return _items.filter(n => !n.readAt).length; }

    function markAllRead() {
        let changed = false;
        const now = Date.now();
        _items.forEach(n => { if (!n.readAt) { n.readAt = now; changed = true; } });
        if (changed) { _save(); _notifySubs(); }
    }

    function onChange(fn) {
        if (typeof fn === 'function') _subs.push(fn);
    }

    function _notifySubs() {
        _subs.forEach(fn => { try { fn(); } catch(_) {} });
    }

    const _events = {};
    function _emit(kind, detail) {
        (_events[kind] || []).forEach(fn => { try { fn(detail); } catch(_) {} });
    }
    function on(kind, fn) {
        if (typeof fn !== 'function') return;
        (_events[kind] = _events[kind] || []).push(fn);
    }

    P.notify = { push, dismiss, clear, list, unreadCount, markAllRead, onChange, on };
})();
