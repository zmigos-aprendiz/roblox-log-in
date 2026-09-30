// menu/phone-firebase.js
// Firebase exclusivo do telefone — modo EMULADOR LOCAL.
// Aponta o Firestore para o emulador rodando em 127.0.0.1:8080.
// Auth é bypassado com token fake (o emulador não valida Bearer).
// Para voltar a produção, troca FS_BASE para o endpoint real e restaura _getToken.
(function () {
    'use strict';
    if (!window._hubBridge) { console.warn('[Phone Firebase] hub ausente'); return; }
    if (window._hubBridge.phone) return;

    // ═══ CONFIG — EMULADOR LOCAL ═══
    const PROJECT_ID = 'phonelive-67143';        // qualquer nome; o emulador usa como pasta local
    const EMULATOR_HOST = '127.0.0.1:8080';
    const FS_BASE = `http://${EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
    // RTDB continua no projeto antigo (o emulador não emula RTDB aqui)
    const RTDB_URL = 'https://sanghub-ecf46-default-rtdb.firebaseio.com';

    function configured() { return true; }   // emulador sempre disponível

    // ═══ AUTH — fake (emulador aceita qualquer Bearer) ═══
    async function _getToken() { return 'owner'; }   // "owner" libera bypass de regras no emulador

    // ═══ VALUE / PARSEDOC ═══
    function value(v) {
        if (v === null || v === undefined) return { nullValue: null };
        if (typeof v === 'boolean') return { booleanValue: v };
        if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
        return { stringValue: String(v) };
    }
    function parseDoc(doc) {
        const out = {};
        const fields = doc?.fields || {};
        for (const k in fields) {
            const v = fields[k];
            const t = Object.keys(v)[0];
            out[k] = t === 'integerValue' ? parseInt(v[t], 10) : v[t];
        }
        return out;
    }

    // ═══ REQUEST ═══
    async function request(method, path, body, extraQuery) {
        const token = await _getToken();
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

    // ═══ RTDB (não emulado — aponta pro real) ═══
    function _rtdbUrl(path) { return RTDB_URL + '/' + path + '.json'; }
    async function rtdbGet(path) {
        try {
            const res = await fetch(_rtdbUrl(path), { cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json();
        } catch(_) { return null; }
    }
    async function rtdbPut(path, val) {
        try {
            const res = await fetch(_rtdbUrl(path), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(val)
            });
            return res.ok;
        } catch(_) { return false; }
    }
    async function rtdbPost(path, val) {
        try {
            const res = await fetch(_rtdbUrl(path), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(val)
            });
            return res.ok;
        } catch(_) { return false; }
    }
    async function rtdbDel(path) {
        try { await fetch(_rtdbUrl(path), { method: 'DELETE' }); } catch(_) {}
    }

    // ═══ EXPORT ═══
    window._hubBridge.phone = {
        firestore: { configured, value, parseDoc, request },
        rtdb: { url: RTDB_URL, get: rtdbGet, put: rtdbPut, post: rtdbPost, del: rtdbDel }
    };

    console.log('[Phone Firebase] emulador apontado:', FS_BASE);
})();
