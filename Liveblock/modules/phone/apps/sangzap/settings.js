// modules/phone/apps/sangzap/settings.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    const S = window._sangzapCtx;
    if (!ctx || !S) return;
    if (S.settings) return;

    // ═══ FS HELPERS — tradução inline Firestore REST ═══
    // Idempotente. Instala uma única vez.
    (function ensureFsHelpers() {
        if (S.__fsFull) return;
        S.__fsFull = true;

        function toFs(v) {
            if (v === null || v === undefined) return { nullValue: null };
            if (typeof v === 'string')  return { stringValue: v };
            if (typeof v === 'boolean') return { booleanValue: v };
            if (typeof v === 'number')  return Number.isInteger(v)
                ? { integerValue: String(v) }
                : { doubleValue: v };
            if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
            if (typeof v === 'object') {
                const fields = {};
                for (const k in v) fields[k] = toFs(v[k]);
                return { mapValue: { fields } };
            }
            return { nullValue: null };
        }

        function fromFs(v) {
            if (!v || typeof v !== 'object') return null;
            if ('nullValue' in v)      return null;
            if ('stringValue' in v)    return v.stringValue;
            if ('booleanValue' in v)   return v.booleanValue;
            if ('integerValue' in v)   return parseInt(v.integerValue, 10);
            if ('doubleValue' in v)    return v.doubleValue;
            if ('timestampValue' in v) return v.timestampValue;
            if ('arrayValue' in v)     return (v.arrayValue?.values || []).map(fromFs);
            if ('mapValue' in v) {
                const out = {};
                const f = v.mapValue?.fields || {};
                for (const k in f) out[k] = fromFs(f[k]);
                return out;
            }
            return null;
        }

        try {
            ctx.bridge.firestore.value = toFs;
            ctx.bridge.firestore.parseDoc = function(doc) {
                const out = {};
                const fields = doc?.fields || {};
                for (const k in fields) out[k] = fromFs(fields[k]);
                return out;
            };
        } catch(_) {}

        S.fsWrite = async function(path, payload, extraQuery) {
            const fields = {};
            for (const k in payload) fields[k] = toFs(payload[k]);
            const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
            const q = extraQuery ? (extraQuery + '&' + mask) : mask;
            return ctx.bridge.firestore.request('PATCH', path, { fields }, q);
        };

        S.fsCreate = async function(collectionPath, payload, docId) {
            const fields = {};
            for (const k in payload) fields[k] = toFs(payload[k]);
            const url = docId
                ? `${collectionPath}?documentId=${encodeURIComponent(docId)}`
                : collectionPath;
            return ctx.bridge.firestore.request('POST', url, { fields });
        };

        S.fsGet = async function(path) {
            const raw = await ctx.bridge.firestore.request('GET', path);
            if (!raw) return null;
            if (Array.isArray(raw.documents)) {
                return raw.documents.map(d => ({
                    id: d.name.split('/').pop(),
                    ...ctx.bridge.firestore.parseDoc(d)
                }));
            }
            if (raw.fields) {
                return {
                    id: (raw.name || '').split('/').pop(),
                    ...ctx.bridge.firestore.parseDoc(raw)
                };
            }
            return null;
        };

        S.fsQuery = async function(structuredQuery) {
            const res = await ctx.bridge.firestore.request('POST', ':runQuery', { structuredQuery });
            return (Array.isArray(res) ? res : []).map(r => {
                if (!r || !r.document) return null;
                return {
                    id: (r.document.name || '').split('/').pop(),
                    ...ctx.bridge.firestore.parseDoc(r.document)
                };
            }).filter(Boolean);
        };

        S.fsDel = async function(path) {
            return ctx.bridge.firestore.request('DELETE', path);
        };
    })();

    const ST = {};
    const AV_SIZE = 256;
    const JPEG_Q = 0.85;
    const MAX_FILE = 8 * 1024 * 1024;
    const LS_WP = 'sangzap_chat_wallpapers';
    const LS_BLOCKED = 'sanghub_phone_blocked';

    const WP_PRESETS = {
        p1: 'linear-gradient(135deg,#0b141a 0%,#1f2c34 100%)',
        p2: 'linear-gradient(135deg,#0a1f0f 0%,#1a3a22 100%)',
        p3: 'linear-gradient(135deg,#1a0b2e 0%,#2d1b4e 100%)',
        p4: 'linear-gradient(135deg,#2e0b0b 0%,#4e1b1b 100%)'
    };
    const PRIVACY_DEFAULT = { avatar: 'todos', recado: 'todos', lastSeen: 'todos' };
    const NOTIF_DEFAULT   = { sound: true, vibrate: true, preview: true };

    // ═══ CRUD ═══
    ST.get = async function(number) {
        try {
            const base = await S.fsGet('/sangzap_profiles/' + number) || {};
            return {
                displayName: base.displayName || '',
                bio: base.bio || '',
                recado: base.recado || '',
                avatar: base.avatar || '',
                theme: base.theme || 'verde',
                readReceipts: base.readReceipts !== false,
                privacy: { ...PRIVACY_DEFAULT, ...(base.privacy || {}) },
                notif:   { ...NOTIF_DEFAULT,   ...(base.notif   || {}) },
                updatedAt: base.updatedAt || 0
            };
        } catch(_) {
            return {
                displayName: '', bio: '', recado: '', avatar: '',
                theme: 'verde', readReceipts: true,
                privacy: { ...PRIVACY_DEFAULT },
                notif:   { ...NOTIF_DEFAULT },
                updatedAt: 0
            };
        }
    };

    ST.save = async function(number, patch) {
        const doc = { ...patch, updatedAt: Date.now() };
        await S.fsWrite('/sangzap_profiles/' + number, doc);
        if (patch.avatar !== undefined) {
            try {
                await S.fsWrite('/phone_numbers/' + number, { avatarUrl: patch.avatar || '' });
            } catch(_) {}
        }
        return doc;
    };

    // ═══ IMAGE PIPELINE ═══
    function cropSquare(img) {
        const sw = img.naturalWidth || img.width;
        const sh = img.naturalHeight || img.height;
        if (!sw || !sh) throw new Error('imagem vazia');
        const side = Math.min(sw, sh);
        const sx = (sw - side) / 2;
        const sy = (sh - side) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = AV_SIZE; canvas.height = AV_SIZE;
        const g = canvas.getContext('2d');
        try { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; } catch(_) {}
        g.drawImage(img, sx, sy, side, side, 0, 0, AV_SIZE, AV_SIZE);
        return canvas.toDataURL('image/jpeg', JPEG_Q);
    }

    function pickFile() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.style.cssText = 'position:fixed;top:-100px;left:-100px;width:0;height:0;opacity:0;';
            document.body.appendChild(input);
            let done = false;
            const fin = (f) => { if (done) return; done = true; try { input.remove(); } catch(_) {} resolve(f || null); };
            input.addEventListener('change', () => fin(input.files?.[0] || null));
            input.addEventListener('cancel', () => fin(null));
            setTimeout(() => { if (!done && (!input.files || !input.files.length)) fin(null); }, 60000);
            input.click();
        });
    }

    function loadImgFromFile(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => resolve({ img, url });
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load falhou')); };
            img.src = url;
        });
    }

    ST.pickAndCropSquare = async function() {
        const file = await pickFile();
        if (!file) return null;
        if (!/^image\//i.test(file.type)) { ctx.toast?.('Arquivo não é imagem', 'err'); return null; }
        if (file.size > MAX_FILE) { ctx.toast?.('Imagem muito grande', 'err'); return null; }
        const { img, url } = await loadImgFromFile(file);
        try { return cropSquare(img); }
        finally { try { URL.revokeObjectURL(url); } catch(_) {} }
    };

    function fileToWallpaper(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                try { URL.revokeObjectURL(url); } catch(_) {}
                const sw = img.naturalWidth || img.width;
                const sh = img.naturalHeight || img.height;
                if (!sw || !sh) return reject(new Error('img vazia'));
                const ratio = Math.min(1, 1280 / sw, 1280 / sh);
                const w = Math.max(1, Math.round(sw * ratio));
                const h = Math.max(1, Math.round(sh * ratio));
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                const g = c.getContext('2d');
                try { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; } catch(_) {}
                g.drawImage(img, 0, 0, w, h);
                resolve(c.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = () => { try { URL.revokeObjectURL(url); } catch(_) {} reject(new Error('load falhou')); };
            img.src = url;
        });
    }

    // ═══ WALLPAPER STORE ═══
    function readWpMap() {
        try { return JSON.parse(localStorage.getItem(LS_WP) || '{}') || {}; }
        catch(_) { return {}; }
    }
    function writeWpMap(m) {
        try { localStorage.setItem(LS_WP, JSON.stringify(m)); } catch(_) {}
    }
    ST.wallpaperFor = function(chatId) {
        const spec = readWpMap()[chatId];
        if (!spec) return null;
        if (spec.kind === 'preset') return WP_PRESETS[spec.value] || null;
        if (spec.kind === 'data') return `url("${spec.value}") center/cover no-repeat`;
        return null;
    };
    ST.setWallpaper = function(chatId, spec) {
        const m = readWpMap();
        if (spec) m[chatId] = spec; else delete m[chatId];
        writeWpMap(m);
    };
    ST.clearWallpaper = function(chatId) { ST.setWallpaper(chatId, null); };

    // ═══ BLOCKED STORE ═══
    function readBlocked() {
        try {
            const raw = localStorage.getItem(LS_BLOCKED);
            if (!raw) return [];
            const v = JSON.parse(raw);
            if (Array.isArray(v)) return v.map(String);
            if (v && typeof v === 'object') return Object.keys(v).filter(k => v[k]).map(String);
            return [];
        } catch(_) { return []; }
    }
    function writeBlocked(list) {
        try {
            const raw = localStorage.getItem(LS_BLOCKED);
            let asObject = false;
            try {
                const v = JSON.parse(raw);
                if (v && !Array.isArray(v) && typeof v === 'object') asObject = true;
            } catch(_) {}
            const out = asObject
                ? Object.fromEntries(list.map(n => [n, true]))
                : list;
            localStorage.setItem(LS_BLOCKED, JSON.stringify(out));
        } catch(_) {}
    }

    // ═══ CHAT LIST (for wallpapers) ═══
    async function fetchChats(number) {
        try {
            const chats = await S.fsQuery({
                from: [{ collectionId: 'sangzap_chats' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: 'members' },
                        op: 'ARRAY_CONTAINS',
                        value: { stringValue: String(number) }
                    }
                }
            });
            return (chats || []).map(c => ({
                id: c.id,
                name: c.name || '',
                kind: c.kind || '1:1',
                members: c.members || []
            })).filter(c => c.id);
        } catch(e) {
            console.warn('[Sangzap/settings] fetchChats:', e);
            return [];
        }
    }

    function chatLabel(c, me) {
        if (c.kind === 'group') return c.name || 'Grupo';
        const peer = (c.members || []).find(m => String(m) !== String(me));
        return peer ? S.shortNum(peer) : c.id.slice(0, 8);
    }

    // ═══ BACKUP ═══
    ST.exportProfile = async function(number) {
        const prof = await ST.get(number);
        const payload = {
            kind: 'sangzap-profile',
            version: 1,
            profile: prof,
            chatWallpapers: readWpMap(),
            blocked: readBlocked()
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sangzap-profile-${number}.json`;
        document.body.appendChild(a);
        a.click();
        try { a.remove(); } catch(_) {}
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch(_) {} }, 2000);
    };

    ST.importProfile = function() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json,.json';
            input.style.cssText = 'position:fixed;top:-100px;left:-100px;width:0;height:0;opacity:0;';
            document.body.appendChild(input);
            let done = false;
            const fin = async (file) => {
                if (done) return; done = true;
                try { input.remove(); } catch(_) {}
                if (!file) return resolve(null);
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (data?.kind !== 'sangzap-profile') throw new Error('formato inválido');
                    resolve(data);
                } catch(e) {
                    ctx.toast?.('Arquivo inválido', 'err');
                    resolve(null);
                }
            };
            input.addEventListener('change', () => fin(input.files?.[0] || null));
            input.addEventListener('cancel', () => fin(null));
            setTimeout(() => { if (!done) fin(null); }, 60000);
            input.click();
        });
    };

    // ═══ HELPERS ═══
    function privRadio(key, val) {
        const opts = [['todos', 'Todos'], ['contatos', 'Contatos'], ['ninguem', 'Ninguém']];
        return opts.map(([v, l]) =>
            `<button class="sz-radio${val === v ? ' active' : ''}" data-value="${v}">${l}</button>`
        ).join('');
    }

    function notifToggle(id, label, sub, checked) {
        return `
            <div class="sz-toggle-row">
                <div class="sz-toggle-text">
                    <div class="sz-toggle-label">${label}</div>
                    ${sub ? `<div class="sz-toggle-sub">${sub}</div>` : ''}
                </div>
                <label class="sz-switch">
                    <input type="checkbox" data-notif="${id}" ${checked ? 'checked' : ''} />
                    <span class="sz-switch-track"></span>
                </label>
            </div>
        `;
    }

    // ═══ RENDER ═══
    ST.render = function(body, myNumber) {
        body.innerHTML = `<div class="sz-profile-loading">Carregando…</div>`;
        ST.get(myNumber).then(prof => {
            const avatar = prof.avatar
                ? `<img src="${S.escape(prof.avatar)}" alt="" />`
                : `<span class="sz-av-fallback">${S.escape((prof.displayName || myNumber || '?')[0].toUpperCase())}</span>`;

            body.innerHTML = `
                <div class="sz-settings">
                    <div class="sz-settings-hero">
                        <div class="sz-avatar sz-avatar-lg" id="szProfAv">${avatar}</div>
                        <div class="sz-settings-num">${S.escape(S.shortNum(myNumber))}</div>
                    </div>

                    <div class="sz-section">
                        <div class="sz-section-title">Perfil</div>
                        <input class="sz-input" id="szProfName" type="text" maxlength="32"
                            value="${S.escape(prof.displayName || '')}"
                            placeholder="Seu nome" />
                        <textarea class="sz-input sz-textarea" id="szProfBio" maxlength="140"
                            placeholder="Bio curta">${S.escape(prof.bio || '')}</textarea>
                        <div class="sz-profile-photo-actions">
                            <button class="sz-btn" id="szProfPick">Trocar foto</button>
                            <button class="sz-btn ghost" id="szProfClear">Remover</button>
                        </div>
                    </div>

                    <div class="sz-section">
                        <div class="sz-section-title">Recado</div>
                        <textarea class="sz-input sz-textarea" id="szProfRecado" maxlength="120"
                            placeholder="Uma frase que aparece no topo das conversas">${S.escape(prof.recado || '')}</textarea>
                        <div class="sz-field-hint">Visível para todos os contatos.</div>
                    </div>

                    <div class="sz-section">
                        <div class="sz-section-title">Aparência</div>
                        <div class="sz-option-row">
                            <div class="sz-option-label">Tema</div>
                            <div class="sz-radio-group" data-key="theme">
                                <button class="sz-radio${(prof.theme || 'verde') === 'verde' ? ' active' : ''}" data-value="verde">Verde</button>
                                <button class="sz-radio${prof.theme === 'roxo' ? ' active' : ''}" data-value="roxo">Roxo</button>
                                <button class="sz-radio${prof.theme === 'azul' ? ' active' : ''}" data-value="azul">Azul</button>
                            </div>
                        </div>
                    </div>

                    <div class="sz-section">
                        <div class="sz-section-title">Privacidade</div>
                        <div class="sz-toggle-row">
                            <div class="sz-toggle-text">
                                <div class="sz-toggle-label">Confirmação de leitura</div>
                                <div class="sz-toggle-sub">Enviar ✓✓ quando ler</div>
                            </div>
                            <label class="sz-switch">
                                <input type="checkbox" id="szProfRead" ${prof.readReceipts !== false ? 'checked' : ''} />
                                <span class="sz-switch-track"></span>
                            </label>
                        </div>

                        <div class="sz-option-row">
                            <div class="sz-option-label">Foto do perfil</div>
                            <div class="sz-radio-group" data-priv="avatar">${privRadio('avatar', prof.privacy.avatar)}</div>
                        </div>
                        <div class="sz-option-row">
                            <div class="sz-option-label">Recado</div>
                            <div class="sz-radio-group" data-priv="recado">${privRadio('recado', prof.privacy.recado)}</div>
                        </div>
                        <div class="sz-option-row">
                            <div class="sz-option-label">Última vez</div>
                            <div class="sz-radio-group" data-priv="lastSeen">${privRadio('lastSeen', prof.privacy.lastSeen)}</div>
                        </div>
                    </div>

                    <div class="sz-section">
                        <div class="sz-section-title">Notificações</div>
                        ${notifToggle('sound',   'Som',                 'Tocar ao receber',       prof.notif.sound)}
                        ${notifToggle('vibrate', 'Vibração',            'Vibrar ao receber',      prof.notif.vibrate)}
                        ${notifToggle('preview', 'Prévia da mensagem',  'Mostrar texto na notificação', prof.notif.preview)}
                    </div>

                    <div class="sz-section">
                        <div class="sz-section-title">Bloqueados</div>
                        <div id="szBlockedList"><div class="sz-profile-loading">Carregando…</div></div>
                    </div>

                    <div class="sz-section">
                        <div class="sz-section-title">Wallpaper por conversa</div>
                        <div id="szWpList"><div class="sz-profile-loading">Carregando…</div></div>
                    </div>

                    <div class="sz-section">
                        <div class="sz-section-title">Backup</div>
                        <div class="sz-profile-photo-actions">
                            <button class="sz-btn" id="szExportBtn">Exportar perfil</button>
                            <button class="sz-btn ghost" id="szImportBtn">Importar</button>
                        </div>
                    </div>

                    <button class="sz-btn sz-btn-primary" id="szProfSave">Salvar</button>
                    <div class="sz-profile-foot">Sangzap · perfil local ao telefone</div>
                </div>
            `;

            const av = body.querySelector('#szProfAv');
            let pendingAvatar = null;
            let pendingTheme = prof.theme || 'verde';
            let pendingPrivacy = { ...prof.privacy };
            let pendingNotif = { ...prof.notif };

            body.querySelector('#szProfPick').addEventListener('click', async () => {
                const dataUrl = await ST.pickAndCropSquare();
                if (!dataUrl) return;
                pendingAvatar = dataUrl;
                av.innerHTML = `<img src="${S.escape(dataUrl)}" alt="" />`;
                ctx.toast?.('Foto pronta — clique em Salvar', 'ok');
            });
            body.querySelector('#szProfClear').addEventListener('click', () => {
                pendingAvatar = '';
                av.innerHTML = `<span class="sz-av-fallback">${S.escape((body.querySelector('#szProfName').value || '?')[0].toUpperCase())}</span>`;
            });

            body.querySelectorAll('.sz-radio-group[data-key="theme"] .sz-radio').forEach(btn => {
                btn.addEventListener('click', () => {
                    pendingTheme = btn.dataset.value;
                    body.querySelectorAll('.sz-radio-group[data-key="theme"] .sz-radio').forEach(b => b.classList.toggle('active', b === btn));
                });
            });

            body.querySelectorAll('.sz-radio-group[data-priv]').forEach(group => {
                const key = group.dataset.priv;
                group.querySelectorAll('.sz-radio').forEach(btn => {
                    btn.addEventListener('click', () => {
                        pendingPrivacy[key] = btn.dataset.value;
                        group.querySelectorAll('.sz-radio').forEach(b => b.classList.toggle('active', b === btn));
                    });
                });
            });

            body.querySelectorAll('input[data-notif]').forEach(inp => {
                inp.addEventListener('change', () => {
                    pendingNotif[inp.dataset.notif] = !!inp.checked;
                });
            });

            // Bloqueados
            const blockedList = body.querySelector('#szBlockedList');
            const blocked = readBlocked();
            blockedList.innerHTML = blocked.length
                ? blocked.map(n => `
                    <div class="sz-blocked-row" data-num="${S.escape(n)}">
                        <span class="sz-blocked-num">${S.escape(S.shortNum(n))}</span>
                        <button class="sz-btn-mini sz-unblock">Desbloquear</button>
                    </div>
                `).join('')
                : `<div class="sz-field-hint">Nenhum contato bloqueado.</div>`;
            blockedList.querySelectorAll('.sz-unblock').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const row = e.target.closest('.sz-blocked-row');
                    const num = row?.dataset.num;
                    if (!num) return;
                    const next = readBlocked().filter(x => x !== num);
                    writeBlocked(next);
                    row.remove();
                    if (!next.length) blockedList.innerHTML = `<div class="sz-field-hint">Nenhum contato bloqueado.</div>`;
                    ctx.toast?.('Desbloqueado', 'ok');
                });
            });

            // Wallpapers por conversa
            const wpList = body.querySelector('#szWpList');
            fetchChats(myNumber).then(chats => {
                if (!chats.length) {
                    wpList.innerHTML = `<div class="sz-field-hint">Nenhuma conversa ainda.</div>`;
                    return;
                }
                const wpMap = readWpMap();
                wpList.innerHTML = chats.map(c => {
                    const cur = wpMap[c.id];
                    const swatches = Object.keys(WP_PRESETS).map(k =>
                        `<button class="sz-wp-sw${cur?.kind === 'preset' && cur.value === k ? ' active' : ''}"
                            data-preset="${k}" data-chat="${S.escape(c.id)}"
                            style="background:${WP_PRESETS[k]}"></button>`
                    ).join('');
                    return `
                        <div class="sz-wp-row">
                            <div class="sz-wp-name">${S.escape(chatLabel(c, myNumber))}</div>
                            <div class="sz-wp-swatches">
                                ${swatches}
                                <button class="sz-wp-sw sz-wp-up" data-up data-chat="${S.escape(c.id)}" title="Upload">↑</button>
                                <button class="sz-wp-sw sz-wp-clr" data-clr data-chat="${S.escape(c.id)}" title="Remover">×</button>
                            </div>
                        </div>
                    `;
                }).join('');

                wpList.addEventListener('click', async (e) => {
                    const sw = e.target.closest('.sz-wp-sw');
                    if (!sw) return;
                    const chatId = sw.dataset.chat;
                    if (!chatId) return;
                    if (sw.dataset.preset) {
                        ST.setWallpaper(chatId, { kind: 'preset', value: sw.dataset.preset });
                        wpList.querySelectorAll(`.sz-wp-sw[data-chat="${CSS.escape(chatId)}"]`).forEach(b => b.classList.remove('active'));
                        sw.classList.add('active');
                        return;
                    }
                    if (sw.dataset.clr !== undefined) {
                        ST.clearWallpaper(chatId);
                        wpList.querySelectorAll(`.sz-wp-sw[data-chat="${CSS.escape(chatId)}"]`).forEach(b => b.classList.remove('active'));
                        return;
                    }
                    if (sw.dataset.up !== undefined) {
                        const file = await pickFile();
                        if (!file) return;
                        if (!/^image\//i.test(file.type)) { ctx.toast?.('Arquivo não é imagem', 'err'); return; }
                        if (file.size > MAX_FILE) { ctx.toast?.('Imagem muito grande', 'err'); return; }
                        try {
                            const dataUrl = await fileToWallpaper(file);
                            ST.setWallpaper(chatId, { kind: 'data', value: dataUrl });
                            wpList.querySelectorAll(`.sz-wp-sw[data-chat="${CSS.escape(chatId)}"]`).forEach(b => b.classList.remove('active'));
                            sw.classList.add('active');
                            ctx.toast?.('Wallpaper salvo', 'ok');
                        } catch(_) {
                            ctx.toast?.('Falha ao processar', 'err');
                        }
                    }
                });
            });

            // Backup
            body.querySelector('#szExportBtn').addEventListener('click', () => ST.exportProfile(myNumber));
            body.querySelector('#szImportBtn').addEventListener('click', async () => {
                const data = await ST.importProfile();
                if (!data) return;
                const p = data.profile || {};
                body.querySelector('#szProfName').value = p.displayName || '';
                body.querySelector('#szProfBio').value = p.bio || '';
                body.querySelector('#szProfRecado').value = p.recado || '';
                pendingTheme = p.theme || 'verde';
                body.querySelectorAll('.sz-radio-group[data-key="theme"] .sz-radio').forEach(b =>
                    b.classList.toggle('active', b.dataset.value === pendingTheme));
                body.querySelector('#szProfRead').checked = p.readReceipts !== false;
                pendingPrivacy = { ...PRIVACY_DEFAULT, ...(p.privacy || {}) };
                body.querySelectorAll('.sz-radio-group[data-priv]').forEach(group => {
                    const key = group.dataset.priv;
                    group.querySelectorAll('.sz-radio').forEach(b =>
                        b.classList.toggle('active', b.dataset.value === pendingPrivacy[key]));
                });
                pendingNotif = { ...NOTIF_DEFAULT, ...(p.notif || {}) };
                body.querySelectorAll('input[data-notif]').forEach(inp =>
                    inp.checked = !!pendingNotif[inp.dataset.notif]);
                if (p.avatar) { pendingAvatar = p.avatar; av.innerHTML = `<img src="${S.escape(p.avatar)}" alt="" />`; }
                if (data.chatWallpapers) writeWpMap(data.chatWallpapers);
                if (Array.isArray(data.blocked)) writeBlocked(data.blocked);
                ctx.toast?.('Importado — clique em Salvar', 'ok');
            });

            // Save
            body.querySelector('#szProfSave').addEventListener('click', async () => {
                const name = body.querySelector('#szProfName').value.trim().slice(0, 32);
                const bio = body.querySelector('#szProfBio').value.trim().slice(0, 140);
                const recado = body.querySelector('#szProfRecado').value.trim().slice(0, 120);
                const readReceipts = body.querySelector('#szProfRead').checked;
                const patch = {
                    displayName: name, bio, recado, theme: pendingTheme, readReceipts,
                    privacy: pendingPrivacy, notif: pendingNotif
                };
                if (pendingAvatar !== null) patch.avatar = pendingAvatar;
                try {
                    await ST.save(myNumber, patch);
                    pendingAvatar = null;
                    document.documentElement.dataset.szTheme = pendingTheme;
                    ctx.toast?.('Perfil salvo', 'ok');
                } catch(e) {
                    console.warn('[Sangzap/settings] save:', e);
                    ctx.toast?.('Falha ao salvar', 'err');
                }
            });
        });
    };

    S.settings = ST;
})();
