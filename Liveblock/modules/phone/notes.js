// modules/phone/notes.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Phone/notes] shell não inicializado.'); return; }
    if (ctx.notes._loaded) return;
    ctx.notes._loaded = true;
    if (!ctx.userKey) { console.warn('[Phone/notes] sem userKey — abortando.'); return; }

    const bridge = window._hubBridge;
    if (!bridge) return;

    // ═══ CONFIG ═══
    const COL_NOTES = 'phone_notes';
    const NOTES_POLL_MS = 20000;
    const MAX_REC_MS = 180000;
    const MAX_REC_BYTES = 700 * 1024;
    const MIN_REC_BYTES = 800;
    const AUDIO_BPS = 24000;
    const INBOX_MAX = 30;
    const SESSION_CACHE_MAX = 6;

    // Sufixos — prefixo real vem de ctx.ls (sanghub_phone_<userKey>_*)
    const LS_PLAYED_NOTES = 'notes_played';
    const LS_INBOX = 'notes_inbox';

    const _ls = ctx.ls || {
        get: () => null, set: () => {}, del: () => {},
        json: (k, fb) => fb
    };

    // ═══ STATE ═══
    let _rec = null;
    let _recChunks = [];
    let _recTarget = null;
    let _recStartedAt = 0;
    let _recTimer = null;
    let _recTimeout = null;
    let _recOriginBtn = null;
    let _voiceHandle = null;
    let _pendingStart = null;
    let _globalPointerUp = null;
    let _escHandler = null;

    let _notesPollTimer = null;
    let _startupTimer = null;
    let _playedNotes = new Set();
    let _inbox = [];
    let _sessionCache = new Map();
    let _playingNote = null;
    let _playBannerEl = null;
    let _inboxContainer = null;
    let _unreadSubs = [];

    const esc = ctx.esc;
    const el = ctx.el;
    const I = ctx.I;
    const tone = ctx.tone;

    // ═══ HELPERS ═══
    function fmtDur(ms) {
        const s = Math.floor(ms / 1000), m = Math.floor(s / 60), ss = s % 60;
        return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }
    function fmtNumber(n) {
        if (!n) return '';
        const clean = String(n).replace(/\D/g, '');
        if (clean.length !== 6) return clean;
        return clean.slice(0, 3) + '-' + clean.slice(3);
    }
    function timeAgo(ts) {
        if (!ts) return '';
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
    function _canPlayNow() {
        return ctx.phase === 'idle' || ctx.phase === 'busy';
    }

    // ═══ VOICE ACQUIRE ═══
    async function _acquireVoiceHandle(purpose) {
        if (ctx.voice && typeof ctx.voice.acquire === 'function') {
            try {
                return await ctx.voice.acquire({ purpose: purpose || 'note' });
            } catch(e) {
                console.warn('[Phone/notes] voice.acquire falhou, caindo pro getUserMedia:', e.message);
            }
        } else {
            console.warn('[Phone/notes] ctx.voice indisponível — fallback getUserMedia');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
        });
        return {
            id: 'legacy',
            stream,
            release: () => { try { stream.getTracks().forEach(t => t.stop()); } catch(_) {} }
        };
    }

    // ═══ PERSISTÊNCIA ═══
    function loadPlayed() {
        const arr = _ls.json(LS_PLAYED_NOTES, []);
        _playedNotes = new Set(Array.isArray(arr) ? arr : []);
    }
    function savePlayed() {
        const arr = Array.from(_playedNotes).slice(-200);
        _playedNotes = new Set(arr);
        _ls.set(LS_PLAYED_NOTES, JSON.stringify(arr));
    }
    function loadInbox() {
        const arr = _ls.json(LS_INBOX, []);
        _inbox = Array.isArray(arr) ? arr.filter(n => n && n.id) : [];
        if (_inbox.length > INBOX_MAX) _inbox = _inbox.slice(0, INBOX_MAX);
    }
    function saveInbox() {
        if (_inbox.length > INBOX_MAX) _inbox = _inbox.slice(0, INBOX_MAX);
        _ls.set(LS_INBOX, JSON.stringify(_inbox));
    }
    function _pushToInbox(note) {
        if (_inbox.some(n => n.id === note.id)) return;
        _inbox.unshift({
            id: note.id,
            fromNumber: note.fromNumber || '',
            fromName: note.fromName || '',
            fromAvatar: note.fromAvatar || '',
            createdAt: note.createdAt || Date.now(),
            size: note.size || 0,
            playedAt: null
        });
        saveInbox();
        _notifyUnread();
    }
    function _markInboxPlayed(id) {
        const entry = _inbox.find(n => n.id === id);
        if (!entry || entry.playedAt) return;
        entry.playedAt = Date.now();
        saveInbox();
        _notifyUnread();
    }
    function _deleteInbox(id) {
        _inbox = _inbox.filter(n => n.id !== id);
        _sessionCache.delete(id);
        saveInbox();
        _notifyUnread();
        try {
            bridge.firestore.request('DELETE', '/' + COL_NOTES + '/' + id).catch(() => {});
        } catch(_) {}
    }
    function _cacheAudio(id, b64) {
        _sessionCache.set(id, b64);
        if (_sessionCache.size > SESSION_CACHE_MAX) {
            const first = _sessionCache.keys().next().value;
            _sessionCache.delete(first);
        }
    }
    function _notifyUnread() {
        const n = getUnreadCount();
        try {
            const missed = ctx.contacts?.getUnreadMissedCount?.() || 0;
            ctx.setNotifDot?.(n > 0 || missed > 0);
        } catch(_) {}
        _unreadSubs.forEach(fn => { try { fn(n); } catch(_) {} });
    }
    function getUnreadCount() {
        return _inbox.filter(n => !n.playedAt).length;
    }
    function _onUnreadChange(fn) {
        if (typeof fn === 'function') _unreadSubs.push(fn);
    }

    // ═══ POINTER HANDLER GLOBAL ═══
    function _handleRelease(e) {
        if (!_rec) return;
        if (_recOriginBtn) {
            const rect = _recOriginBtn.getBoundingClientRect();
            const pad = 40;
            const inside = e.clientX >= rect.left - pad && e.clientX <= rect.right + pad
                        && e.clientY >= rect.top - pad && e.clientY <= rect.bottom + pad;
            if (inside) _sendRecording();
            else _cancelRecording();
        } else {
            _sendRecording();
        }
    }
    function _beginPointerTracking() {
        if (_globalPointerUp) {
            try { document.removeEventListener('pointerup', _globalPointerUp, true); } catch(_) {}
            _globalPointerUp = null;
        }
        const onUp = (e) => {
            if (_globalPointerUp !== onUp) return;
            document.removeEventListener('pointerup', onUp, true);
            _globalPointerUp = null;
            if (_pendingStart) { _pendingStart = null; return; }
            if (_rec) _handleRelease(e);
        };
        _globalPointerUp = onUp;
        document.addEventListener('pointerup', onUp, true);
    }

    // ═══ GRAVAÇÃO ═══
    async function _startRecording(target, originBtn) {
        if (_rec || _pendingStart) return false;
        _recTarget = target;
        _recOriginBtn = originBtn || null;
        _pendingStart = 'ps_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        _beginPointerTracking();

        let handle;
        try { handle = await _acquireVoiceHandle('note'); }
        catch(e) {
            _pendingStart = null;
            _recTarget = null;
            _recOriginBtn = null;
            ctx.toast('Microfone negado', 'err');
            return false;
        }

        if (!_pendingStart) {
            try { handle.release(); } catch(_) {}
            _recTarget = null;
            _recOriginBtn = null;
            return false;
        }
        _pendingStart = null;
        _voiceHandle = handle;
        const stream = handle.stream;

        _recChunks = [];
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        try { _rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: AUDIO_BPS }); }
        catch(e) { _rec = new MediaRecorder(stream); }

        _recStartedAt = Date.now();
        _rec.ondataavailable = (e) => { if (e.data.size > 0) _recChunks.push(e.data); };
        _rec.onerror = () => _cancelRecording();

        try { _rec.start(250); }
        catch(e) {
            _rec = null;
            try { _voiceHandle?.release(); } catch(_) {}
            _voiceHandle = null;
            _recTarget = null;
            _recOriginBtn = null;
            return false;
        }

        if (originBtn) originBtn.classList.add('recording');
        try { ctx.setRecording?.(true); } catch(_) {}
        _showOverlay(!!originBtn);
        tone.recStart();

        if (_recTimer) clearInterval(_recTimer);
        _recTimer = setInterval(() => {
            const elt = ctx.root?.querySelector('#phRecTimer');
            if (elt) elt.textContent = fmtDur(Date.now() - _recStartedAt);
        }, 200);

        if (_recTimeout) clearTimeout(_recTimeout);
        _recTimeout = setTimeout(() => {
            if (_rec) {
                ctx.toast('Tempo máximo atingido', 'warn');
                _sendRecording();
            }
        }, MAX_REC_MS);

        _escHandler = (e) => {
            if (e.key === 'Escape' && _rec) {
                e.preventDefault();
                e.stopPropagation();
                _cancelRecording();
            }
        };
        document.addEventListener('keydown', _escHandler, true);

        return true;
    }

    async function _sendRecording() {
        if (!_rec) return;
        const rec = _rec;
        const target = _recTarget;
        const chunks = _recChunks;
        const originBtn = _recOriginBtn;

        _rec = null;
        _recTarget = null;
        _recChunks = [];
        _recOriginBtn = null;
        _clearTimers();
        _removeListeners();
        try { ctx.setRecording?.(false); } catch(_) {}
        if (originBtn) originBtn.classList.remove('recording');
        ctx.root?.querySelectorAll('.ph-note-btn.recording').forEach(b => b.classList.remove('recording'));
        _hideOverlay();

        return new Promise((resolve) => {
            rec.onstop = async () => {
                try { _voiceHandle?.release(); } catch(_) {}
                _voiceHandle = null;

                let blob;
                try { blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); }
                catch(_) { resolve(); return; }
                if (blob.size < MIN_REC_BYTES) { ctx.toast('Gravação muito curta', 'err'); resolve(); return; }
                if (blob.size > MAX_REC_BYTES) { ctx.toast('Recado muito grande (max ~3min)', 'err'); resolve(); return; }

                tone.recSend();
                ctx.toast('Enviando recado…', 'ok');
                try {
                    const b64 = await blobToB64(blob);
                    const myAvatar = bridge.player?.avatarUrl || '';
                    const fields = {
                        fromNumber: bridge.firestore.value(ctx.myNumber || ''),
                        fromName: bridge.firestore.value(bridge.player?.name || ''),
                        fromAvatar: bridge.firestore.value(myAvatar),
                        toNumber: bridge.firestore.value(target.number || ''),
                        mimeType: bridge.firestore.value(blob.type || 'audio/webm'),
                        audio: bridge.firestore.value(b64),
                        size: bridge.firestore.value(blob.size),
                        createdAt: bridge.firestore.value(Date.now())
                    };
                    await bridge.firestore.request('POST', '/' + COL_NOTES, { fields });
                    ctx.toast('Recado enviado', 'ok');
                } catch(e) {
                    console.warn('[Phone/notes] envio falhou:', e);
                    ctx.toast('Falha ao enviar', 'err');
                }
                resolve();
            };
            try { rec.stop(); } catch(e) {
                try { _voiceHandle?.release(); } catch(_) {}
                _voiceHandle = null;
                resolve();
            }
        });
    }

    function _cancelRecording() {
        const rec = _rec;
        const originBtn = _recOriginBtn;
        _rec = null;
        _recTarget = null;
        _recChunks = [];
        _recOriginBtn = null;
        _clearTimers();
        _removeListeners();
        try { ctx.setRecording?.(false); } catch(_) {}
        if (originBtn) originBtn.classList.remove('recording');
        ctx.root?.querySelectorAll('.ph-note-btn.recording').forEach(b => b.classList.remove('recording'));
        _hideOverlay();
        if (rec && rec.state !== 'inactive') { try { rec.onstop = null; rec.stop(); } catch(_) {} }
        try { _voiceHandle?.release(); } catch(_) {}
        _voiceHandle = null;
        tone.recCancel();
        ctx.toast('Cancelado', 'err');
    }

    function _clearTimers() {
        if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
        if (_recTimeout) { clearTimeout(_recTimeout); _recTimeout = null; }
    }
    function _removeListeners() {
        if (_globalPointerUp) {
            try { document.removeEventListener('pointerup', _globalPointerUp, true); } catch(_) {}
            _globalPointerUp = null;
        }
        if (_escHandler) {
            try { document.removeEventListener('keydown', _escHandler, true); } catch(_) {}
            _escHandler = null;
        }
    }

    // ═══ OVERLAY ═══
    function _showOverlay(isListMode) {
        if (!ctx.screenEl) return;
        _hideOverlay();
        const target = _recTarget || {};
        const ov = el('div', { class: 'ph-rec-overlay', id: 'phRecOverlay' });
        ov.innerHTML = `
            <div class="ph-rec-circle">${I.mic}</div>
            <div class="ph-rec-waves"><span></span><span></span><span></span><span></span><span></span></div>
            <div class="ph-rec-info">
                <div class="name">${esc(target.name || fmtNumber(target.number) || 'Recado')}</div>
                <div class="timer" id="phRecTimer">00:00</div>
                <div class="hint">${isListMode ? 'Solte para enviar · arraste para fora para cancelar' : 'Solte para enviar · ESC cancela'}</div>
            </div>
            ${!isListMode ? `<button class="ph-rec-cancel-btn" id="phRecCancelBtn">Cancelar</button>` : ''}
        `;
        ctx.screenEl.appendChild(ov);
        const cancelBtn = ov.querySelector('#phRecCancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); _cancelRecording(); });
    }
    function _hideOverlay() {
        try { ctx.root?.querySelector('#phRecOverlay')?.remove(); } catch(_) {}
    }

    // ═══ WIRING — LISTA DE CONTATOS ═══
    function _wireNoteButton(btn, target) {
        btn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (_rec || _pendingStart) return;
            _startRecording(target, btn);
            try { btn.setPointerCapture(e.pointerId); } catch(_) {}
        });
        btn.addEventListener('pointercancel', (e) => {
            e.stopPropagation();
            if (_rec && _recTarget?.number === target.number) _cancelRecording();
        });
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // ═══ WIRING — CARD DE CONTATO ═══
    async function _startFromCard(target) {
        if (_rec || _pendingStart) { ctx.toast('Já está gravando', 'err'); return false; }
        if (!_canPlayNow()) { ctx.toast('Ocupado', 'err'); return false; }
        return _startRecording(target, null);
    }

    // ═══ RECEBER ═══
    function _startNotesPoll() {
        if (_notesPollTimer) return;
        _notesPollTimer = setInterval(_pollNotes, NOTES_POLL_MS);
        if (_startupTimer) clearTimeout(_startupTimer);
        _startupTimer = setTimeout(() => {
            _startupTimer = null;
            _pollNotes();
        }, 3000);
    }
    function _stopPoll() {
        if (_notesPollTimer) { clearInterval(_notesPollTimer); _notesPollTimer = null; }
        if (_startupTimer) { clearTimeout(_startupTimer); _startupTimer = null; }
    }

    async function _pollNotes() {
        if (!ctx.myNumber) return;
        if (!_canPlayNow()) return;
        if (_playingNote) return;
        try {
            const data = await bridge.firestore.request('GET', '/' + COL_NOTES);
            const docs = data?.documents || [];
            const incoming = [];
            for (const d of docs) {
                const id = d.name.split('/').pop();
                if (_playedNotes.has(id)) continue;
                const parsed = { id, ...bridge.firestore.parseDoc(d) };
                if (parsed.toNumber !== ctx.myNumber) continue;
                if (parsed.fromNumber === ctx.myNumber) continue;
                if (parsed.fromNumber && ctx.contacts.isBlocked?.(parsed.fromNumber)) {
                    _playedNotes.add(id);
                    continue;
                }
                incoming.push(parsed);
            }
            incoming.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            const next = incoming[0];
            if (!next) { savePlayed(); return; }
            await _receiveNote(next);
            savePlayed();
        } catch(_) {}
    }

    function _notifyIncoming(note) {
        const phone = window._phone;
        if (!phone?.notify?.push) return;
        const num = note.fromNumber || '';
        const name = note.fromName
            || (num ? fmtNumber(num) : '')
            || 'Recado';
        try {
            phone.notify.push({
                appId:   'notes',
                appName: 'Recados',
                accent:  '#a78bfa',
                title:   name,
                body:    'Recado de voz recebido',
                meta:    { kind: 'voice-note', from: num, id: note.id }
            });
        } catch(_) {}
    }

    async function _receiveNote(note) {
        // Nunca toca automático. Só arquiva no inbox e mostra o banner.
        // O usuário decide se ouve — clicando em "Ouvir" no banner ou no inbox.
        _playedNotes.add(note.id);
        _cacheAudio(note.id, note.audio);
        _notifyIncoming(note);
        _pushToInbox(note);
        if (ctx.getMinimized && ctx.getMinimized()) {
            try { ctx.setMinimized(false); } catch(_) {}
        }
        _showPlayBanner(note);
    }

    function _stopCurrentPlayback() {
        if (!_playingNote) return;
        try { _playingNote.audio.pause(); } catch(_) {}
        try { URL.revokeObjectURL(_playingNote.url); } catch(_) {}
        _playingNote = null;
        window._phoneNoteEl = null;
    }

    async function _tryPlay(note, b64, mime) {
        _stopCurrentPlayback();
        try {
            const blob = b64ToBlob(b64, mime);
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.autoplay = true;
            audio.volume = 1.0;
            window._phoneNoteEl = audio;

            const p = audio.play();
            if (p && typeof p.then === 'function') {
                try { await p; }
                catch(_) {
                    try { URL.revokeObjectURL(url); } catch(_) {}
                    if (window._phoneNoteEl === audio) window._phoneNoteEl = null;
                    return false;
                }
            }

            _playingNote = { id: note.id, audio, url };

            const cleanup = () => {
                try { URL.revokeObjectURL(url); } catch(_) {}
                if (window._phoneNoteEl === audio) window._phoneNoteEl = null;
                if (_playingNote?.audio === audio) _playingNote = null;
                _renderInboxIfVisible();
            };
            audio.onended = cleanup;
            audio.onerror = cleanup;

            _renderInboxIfVisible();
            return true;
        } catch(_) {
            return false;
        }
    }

    function _showPlayBanner(note) {
        if (!ctx.screenEl) return;
        _hidePlayBanner();
        const banner = el('div', { class: 'ph-note-banner', id: 'phNoteBanner' });
        const initial = (note.fromName || '?')[0]?.toUpperCase() || '?';
        const av = note.fromAvatar
            ? `<div class="ph-note-banner-av"><img src="${esc(note.fromAvatar)}" alt="" onerror="this.remove()" /><span>${esc(initial)}</span></div>`
            : `<div class="ph-note-banner-av"><span>${esc(initial)}</span></div>`;
        banner.innerHTML = `
            <div class="ph-note-banner-hdr">RECADO RECEBIDO</div>
            ${av}
            <div class="ph-note-banner-name">${esc(note.fromName || fmtNumber(note.fromNumber))}</div>
            <div class="ph-note-banner-hint">Toque para ouvir</div>
            <div class="ph-note-banner-actions">
                <button class="ph-note-banner-btn play" id="phNotePlay">${I.mic}<span>Ouvir</span></button>
                <button class="ph-note-banner-btn skip" id="phNoteSkip">Depois</button>
            </div>
        `;
        ctx.screenEl.appendChild(banner);
        _playBannerEl = banner;
        banner.querySelector('#phNotePlay').addEventListener('click', async () => {
            _hidePlayBanner();
            const ok = await _tryPlay(note, note.audio, note.mimeType);
            if (!ok) ctx.toast('Falha ao tocar', 'err');
            _markInboxPlayed(note.id);
            _renderInboxIfVisible();
        });
        banner.querySelector('#phNoteSkip').addEventListener('click', () => {
            _hidePlayBanner();
            _renderInboxIfVisible();
        });
    }
    function _hidePlayBanner() {
        if (_playBannerEl) { try { _playBannerEl.remove(); } catch(_) {} _playBannerEl = null; }
    }

    // ═══ INBOX UI ═══
    function _renderInbox(root) {
        if (!root) return;
        _inboxContainer = root;
        if (!_inbox.length) {
            root.innerHTML = `<div class="ph-list"><div class="ph-empty">
                <strong>Sem recados.</strong>
                <div class="hint">Recados que você receber aparecem aqui.</div>
            </div></div>`;
            return;
        }
        const rows = _inbox.map(n => {
            const initial = (n.fromName || '?')[0]?.toUpperCase() || '?';
            const av = n.fromAvatar
                ? `<div class="ph-av"><span class="ph-av-ini">${esc(initial)}</span><img src="${esc(n.fromAvatar)}" alt="" onerror="this.remove()" /></div>`
                : `<div class="ph-av"><span class="ph-av-ini">${esc(initial)}</span></div>`;
            const unplayed = !n.playedAt;
            const playing = _playingNote?.id === n.id;
            const durSec = n.size ? Math.max(1, Math.round(n.size / 3000)) : 0;
            return `<div class="ph-contact ph-note-row ${unplayed ? 'unread' : ''} ${playing ? 'playing' : ''}" data-note-id="${esc(n.id)}">
                ${av}
                <div class="ph-info">
                    <div class="ph-name">${esc(n.fromName || fmtNumber(n.fromNumber))}</div>
                    <div class="ph-meta">
                        <span class="when">${timeAgo(n.createdAt)}</span>
                        ${durSec ? `<span>·</span><span class="dur">${durSec}s</span>` : ''}
                        ${unplayed ? `<span class="unread-dot"></span>` : ''}
                    </div>
                </div>
                <button class="ph-note-play" title="Reproduzir">${I.mic}</button>
                <button class="ph-rm" data-rm-note="${esc(n.id)}" title="Apagar">✕</button>
            </div>`;
        }).join('');
        root.innerHTML = `<div class="ph-list">${rows}</div>`;
        root.querySelectorAll('[data-note-id]').forEach(row => {
            const id = row.dataset.noteId;
            const playBtn = row.querySelector('.ph-note-play');
            if (playBtn) playBtn.addEventListener('click', (e) => { e.stopPropagation(); _replayNote(id); });
            const rmBtn = row.querySelector('[data-rm-note]');
            if (rmBtn) rmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                _deleteInbox(id);
                _renderInbox(root);
            });
        });
    }

    async function _replayNote(id) {
        const entry = _inbox.find(n => n.id === id);
        if (!entry) return;
        let b64 = _sessionCache.get(id);
        let mime = 'audio/webm';
        if (!b64) {
            try {
                const doc = await bridge.firestore.request('GET', '/' + COL_NOTES + '/' + id);
                if (!doc?.fields) { ctx.toast('Recado expirado', 'err'); _deleteInbox(id); return; }
                const parsed = bridge.firestore.parseDoc(doc);
                b64 = parsed.audio;
                mime = parsed.mimeType || 'audio/webm';
                _cacheAudio(id, b64);
            } catch(_) { ctx.toast('Falha ao carregar', 'err'); return; }
        }
        const ok = await _tryPlay(
            { id, fromNumber: entry.fromNumber, fromName: entry.fromName, fromAvatar: entry.fromAvatar },
            b64, mime
        );
        if (!ok) { ctx.toast('Falha ao tocar', 'err'); return; }
        _markInboxPlayed(id);
        _renderInboxIfVisible();
    }

    function _renderInboxIfVisible() {
        if (_inboxContainer && document.contains(_inboxContainer)) {
            _renderInbox(_inboxContainer);
        }
    }

    // ═══ PARAR EM CHAMADA RECEBIDA ═══
    window.addEventListener('sang:phone-incoming', () => {
        if (_playingNote) _stopCurrentPlayback();
    });

    // ═══ DESTROY ═══
    function _destroy() {
        if (_rec) { try { _cancelRecording(); } catch(_) {} }
        if (_pendingStart) _pendingStart = null;
        try { _stopCurrentPlayback(); } catch(_) {}
        try { _voiceHandle?.release(); } catch(_) {}
        _voiceHandle = null;
        _stopPoll();
        _removeListeners();
        _hidePlayBanner();
        _hideOverlay();
        _unreadSubs.length = 0;
    }

    try {
        if (typeof ctx._registerCleanup === 'function') {
            ctx._registerCleanup(_destroy);
        }
    } catch(_) {}

    // ═══ ESTILO ═══
    ctx.appendStyle(`
        .ph-rec-overlay {
            position: absolute; inset: 0;
            background: radial-gradient(circle at 50% 60%, rgba(251,113,133,.22), rgba(16,14,32,.97) 55%);
            backdrop-filter: blur(10px);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 18px; z-index: 40; animation: phFadeIn .22s ease; padding: 30px;
        }
        .ph-rec-circle {
            width: 120px; height: 120px; border-radius: 50%;
            background: radial-gradient(circle at 30% 30%, rgba(251,113,133,.4), rgba(244,114,182,.22));
            border: 2px solid rgba(251,113,133,.6);
            display: flex; align-items: center; justify-content: center;
            color: #fff; position: relative;
            box-shadow: 0 20px 60px rgba(251,113,133,.3), inset 0 1px 0 rgba(255,255,255,.18);
        }
        .ph-rec-circle svg { width: 40px; height: 40px; }
        .ph-rec-circle::after {
            content: ''; position: absolute; inset: -8px; border-radius: 50%;
            border: 2px solid rgba(251,113,133,.32);
            animation: phRingGlow 1.6s ease-in-out infinite;
        }
        .ph-rec-waves { display: flex; align-items: center; gap: 4px; height: 34px; }
        .ph-rec-waves span {
            width: 4px; height: 100%;
            background: linear-gradient(180deg, #fb7185, #f472b6);
            border-radius: 2px;
            transform-origin: center;
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
        .ph-rec-info .hint { font-size: 10px; color: #a8aec4; margin-top: 8px; }
        .ph-rec-cancel-btn {
            position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%);
            padding: 8px 18px; border-radius: 10px;
            background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14);
            color: #c7cad6; font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: .04em;
            cursor: pointer; transition: all .16s;
        }
        .ph-rec-cancel-btn:hover { background: rgba(251,113,133,.16); color: #fca5b1; border-color: rgba(251,113,133,.4); }

        .ph-note-banner {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 240px; padding: 18px 16px 14px;
            border-radius: 16px;
            background: linear-gradient(175deg, #1f1c38 0%, #16132c 60%, #0f0d22 100%);
            border: 1px solid rgba(167,139,250,.4);
            box-shadow: 0 24px 60px rgba(0,0,0,.75), 0 0 40px rgba(167,139,250,.15);
            display: flex; flex-direction: column; align-items: center; gap: 8px;
            z-index: 35; animation: ccSlideIn .3s cubic-bezier(.16,1,.3,1);
        }
        .ph-note-banner-hdr { font-size: 8.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #c4b5fd; }
        .ph-note-banner-av {
            width: 56px; height: 56px; border-radius: 18px;
            background: linear-gradient(135deg, rgba(167,139,250,.24), rgba(244,114,182,.24));
            border: 1px solid rgba(255,255,255,.12);
            display: flex; align-items: center; justify-content: center;
            overflow: hidden; position: relative; color: #c4b5fd; font-size: 20px; font-weight: 800;
        }
        .ph-note-banner-av img { position: absolute; top: -25%; left: -40%; width: 210%; height: 210%; object-fit: cover; z-index: 2; }
        .ph-note-banner-name { font-size: 13px; font-weight: 800; color: #f1f2f8; }
        .ph-note-banner-hint { font-size: 9.5px; color: #8a90a8; }
        .ph-note-banner-actions { display: flex; gap: 6px; width: 100%; margin-top: 4px; }
        .ph-note-banner-btn {
            flex: 1; padding: 9px 10px; border-radius: 10px; border: none;
            font-family: inherit; font-size: 10.5px; font-weight: 800; letter-spacing: .03em;
            display: flex; align-items: center; justify-content: center; gap: 5px;
            cursor: pointer; transition: all .16s;
        }
        .ph-note-banner-btn svg { width: 12px; height: 12px; }
        .ph-note-banner-btn.play { background: linear-gradient(135deg, #a78bfa, #f472b6); color: #0b0b10; box-shadow: 0 6px 16px rgba(167,139,250,.3); }
        .ph-note-banner-btn.play:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(167,139,250,.4); }
        .ph-note-banner-btn.skip { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); color: #c7cad6; }
        .ph-note-banner-btn.skip:hover { background: rgba(255,255,255,.1); }

        .ph-note-row.unread .ph-name { color: #f1f2f8; font-weight: 800; }
        .ph-note-row.unread { border-color: rgba(167,139,250,.34); background: rgba(167,139,250,.05); }
        .ph-note-row.playing { border-color: rgba(52,211,153,.5); box-shadow: 0 0 0 1px rgba(52,211,153,.15); }
        .ph-note-row .unread-dot { width: 6px; height: 6px; border-radius: 50%; background: #a78bfa; box-shadow: 0 0 6px rgba(167,139,250,.8); }
        .ph-note-play {
            flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
            border: 1px solid rgba(167,139,250,.4); background: rgba(167,139,250,.14);
            color: #c4b5fd; cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: all .2s;
        }
        .ph-note-play:hover { background: rgba(167,139,250,.24); box-shadow: 0 0 12px rgba(167,139,250,.35); }
        .ph-note-play svg { width: 12px; height: 12px; }
    `);

    // ═══ INIT ═══
    loadPlayed();
    loadInbox();

    // ═══ EXPORTAR ═══
    Object.assign(ctx.notes, {
        wireNoteButton: _wireNoteButton,
        startFromCard: _startFromCard,
        startNotesPoll: _startNotesPoll,
        stopPoll: _stopPoll,
        sendNote: _sendRecording,
        cancelNote: _cancelRecording,
        stopNote: _stopCurrentPlayback,
        getInbox: () => _inbox.map(n => ({ ...n })),
        getUnreadCount,
        onUnreadChange: _onUnreadChange,
        renderInbox: _renderInbox,
        replayNote: _replayNote,
        deleteNote: _deleteInbox,
        markAllRead: () => {
            let changed = false;
            _inbox.forEach(n => { if (!n.playedAt) { n.playedAt = Date.now(); changed = true; } });
            if (changed) { saveInbox(); _notifyUnread(); }
        },
        isRecording: () => !!_rec || !!_pendingStart,
        isPlaying: () => !!_playingNote
    });
})();
