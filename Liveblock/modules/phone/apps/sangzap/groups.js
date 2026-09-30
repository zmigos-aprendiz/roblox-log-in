// modules/phone/apps/sangzap/groups.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    const S = window._sangzapCtx;
    if (!ctx || !S) return;
    if (S.groups) return;

    const G = {};
    const MAX_AV = 256;
    const AV_Q = 0.85;
    const ALL_TOKEN = '@all';

    // ═══ CORE ═══
    G.create = async function(name, memberNums, avatar) {
        const myNumber = ctx.myNumber;
        const members = [...new Set([...memberNums, myNumber])];
        if (members.length < 3) throw new Error('mínimo 3 membros');
        const chatId = S.groupChatId();
        const now = Date.now();
        const doc = {
            kind: 'group',
            name: S.sanitize(name || 'Grupo').slice(0, 40),
            avatar: avatar || '',
            description: '',
            members,
            admins: [myNumber],
            createdAt: now,
            updatedAt: now,
            lastMessage: '',
            lastMessageAt: 0
        };
        await ctx.bridge.firestore.request('PATCH', `/sangzap_chats/${chatId}`, doc);
        await ctx.bridge.firestore.request('POST',
            `/sangzap_chats/${chatId}/messages?documentId=${S.msgId()}`,
            { from: myNumber, kind: 'system', body: 'Grupo criado', sentAt: now });
        return { id: chatId, ...doc };
    };

    G.addMember = async function(chatId, number) {
        const myNumber = ctx.myNumber;
        const doc = await ctx.bridge.firestore.parseDoc('sangzap_chats', chatId);
        if (!doc) return;
        const members = new Set(doc.members || []);
        if (members.has(number)) return;
        members.add(number);
        await ctx.bridge.firestore.request('PATCH', `/sangzap_chats/${chatId}`, {
            members: [...members], updatedAt: Date.now()
        });
        await ctx.bridge.firestore.request('POST',
            `/sangzap_chats/${chatId}/messages?documentId=${S.msgId()}`,
            { from: myNumber, kind: 'system',
              body: `${S.shortNum(number)} entrou`, sentAt: Date.now() });
    };

    G.removeMember = async function(chatId, number) {
        const myNumber = ctx.myNumber;
        const doc = await ctx.bridge.firestore.parseDoc('sangzap_chats', chatId);
        if (!doc) return;
        const members = (doc.members || []).filter(n => n !== number);
        const admins = (doc.admins || []).filter(n => n !== number);
        await ctx.bridge.firestore.request('PATCH', `/sangzap_chats/${chatId}`, {
            members, admins, updatedAt: Date.now()
        });
        const body = number === myNumber ? 'Você saiu' : `${S.shortNum(number)} saiu`;
        await ctx.bridge.firestore.request('POST',
            `/sangzap_chats/${chatId}/messages?documentId=${S.msgId()}`,
            { from: myNumber, kind: 'system', body, sentAt: Date.now() });
    };

    G.rename = async function(chatId, name) {
        await ctx.bridge.firestore.request('PATCH', `/sangzap_chats/${chatId}`, {
            name: S.sanitize(name || '').slice(0, 40), updatedAt: Date.now()
        });
    };

    G.setAvatar = async function(chatId, dataUrl) {
        await ctx.bridge.firestore.request('PATCH', `/sangzap_chats/${chatId}`, {
            avatar: dataUrl || '', updatedAt: Date.now()
        });
    };

    G.leave = async function(chatId) {
        await G.removeMember(chatId, ctx.myNumber);
    };

    // ═══ DESCRIPTION ═══
    G.setDescription = async function(chatId, desc) {
        await ctx.bridge.firestore.request('PATCH', `/sangzap_chats/${chatId}`, {
            description: S.sanitize(desc || '').slice(0, 200), updatedAt: Date.now()
        });
    };

    // ═══ ADMINS ═══
    G.promote = async function(chatId, number) {
        const doc = await ctx.bridge.firestore.parseDoc('sangzap_chats', chatId);
        if (!doc) return;
        const admins = new Set((doc.admins || []).map(String));
        if (admins.has(String(number))) return;
        admins.add(String(number));
        await ctx.bridge.firestore.request('PATCH', `/sangzap_chats/${chatId}`, {
            admins: [...admins], updatedAt: Date.now()
        });
        await ctx.bridge.firestore.request('POST',
            `/sangzap_chats/${chatId}/messages?documentId=${S.msgId()}`,
            { from: ctx.myNumber, kind: 'system',
              body: `${S.shortNum(number)} agora é admin`, sentAt: Date.now() });
    };

    G.demote = async function(chatId, number) {
        const doc = await ctx.bridge.firestore.parseDoc('sangzap_chats', chatId);
        if (!doc) return;
        const admins = (doc.admins || []).map(String).filter(n => n !== String(number));
        await ctx.bridge.firestore.request('PATCH', `/sangzap_chats/${chatId}`, {
            admins, updatedAt: Date.now()
        });
        await ctx.bridge.firestore.request('POST',
            `/sangzap_chats/${chatId}/messages?documentId=${S.msgId()}`,
            { from: ctx.myNumber, kind: 'system',
              body: `${S.shortNum(number)} não é mais admin`, sentAt: Date.now() });
    };

    // ═══ @ALL ═══
    G.ALL_TOKEN = ALL_TOKEN;

    G.hasAllMention = function(text) {
        const pat = new RegExp('(^|\\s)' + ALL_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        return pat.test(text || '');
    };

    G.membersOf = async function(chatId) {
        const doc = await ctx.bridge.firestore.parseDoc('sangzap_chats', chatId);
        return (doc?.members || []).map(String);
    };

    // chat.js calls this at send-time. nameToNum: { 'fulano': '123456', ... }
    G.expandMentions = function(text, members, nameToNum) {
        let mentions = [];
        try {
            if (typeof S.extractMentions === 'function') {
                const raw = S.extractMentions(text) || [];
                mentions = raw.map(m => {
                    const bare = String(m).replace(/^@/, '');
                    if (nameToNum && nameToNum[bare]) return String(nameToNum[bare]);
                    if (nameToNum && nameToNum[m]) return String(nameToNum[m]);
                    return String(m);
                });
            }
        } catch(_) {}
        if (G.hasAllMention(text)) {
            (members || []).forEach(n => { if (!mentions.includes(String(n))) mentions.push(String(n)); });
        }
        return mentions;
    };

    // ═══ MODAL ═══
    function confirmModal(title, bodyText, okLabel) {
        return new Promise(resolve => {
            const bd = document.createElement('div');
            bd.className = 'sz-modal-backdrop';
            bd.innerHTML = `
                <div class="sz-modal">
                    <div class="sz-modal-title">${S.escape(title)}</div>
                    <div class="sz-modal-body">${S.escape(bodyText)}</div>
                    <div class="sz-modal-actions">
                        <button class="sz-btn ghost" data-no>Cancelar</button>
                        <button class="sz-btn sz-btn-primary" data-yes>${S.escape(okLabel || 'Confirmar')}</button>
                    </div>
                </div>
            `;
            document.body.appendChild(bd);
            bd.addEventListener('click', e => {
                if (e.target === bd || e.target.closest('[data-no]')) { bd.remove(); resolve(false); }
                else if (e.target.closest('[data-yes]')) { bd.remove(); resolve(true); }
            });
        });
    }

    G.confirmLeave = async function(chatId) {
        const ok = await confirmModal('Sair do grupo?', 'Você deixará de receber mensagens deste grupo.', 'Sair');
        if (!ok) return false;
        await G.leave(chatId);
        return true;
    };

    // ═══ AVATAR PICKER ═══
    async function pickAvatar() {
        if (S.settings && typeof S.settings.pickAndCropSquare === 'function') {
            try { return await S.settings.pickAndCropSquare(); } catch(_) {}
        }
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.style.cssText = 'position:fixed;top:-100px;left:-100px;width:0;height:0;opacity:0;';
            document.body.appendChild(input);
            let done = false;
            const fin = (file) => {
                if (done) return; done = true;
                try { input.remove(); } catch(_) {}
                if (!file || !/^image\//i.test(file.type)) return resolve(null);
                const url = URL.createObjectURL(file);
                const img = new Image();
                img.onload = () => {
                    try { URL.revokeObjectURL(url); } catch(_) {}
                    const sw = img.naturalWidth || img.width;
                    const sh = img.naturalHeight || img.height;
                    if (!sw || !sh) return resolve(null);
                    const side = Math.min(sw, sh);
                    const c = document.createElement('canvas');
                    c.width = MAX_AV; c.height = MAX_AV;
                    const g = c.getContext('2d');
                    try { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; } catch(_) {}
                    g.drawImage(img, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, MAX_AV, MAX_AV);
                    resolve(c.toDataURL('image/jpeg', AV_Q));
                };
                img.onerror = () => { try { URL.revokeObjectURL(url); } catch(_) {} resolve(null); };
                img.src = url;
            };
            input.addEventListener('change', () => fin(input.files?.[0] || null));
            input.addEventListener('cancel', () => fin(null));
            setTimeout(() => { if (!done) fin(null); }, 60000);
            input.click();
        });
    }

    // ═══ MEMBER PICKER ═══
    function pickMembers(existing) {
        return new Promise(resolve => {
            const list = (ctx.contacts && Array.isArray(ctx.contacts.contacts)) ? ctx.contacts.contacts : [];
            const getNum = x => String(x.number || x.num || x.id || '');
            const getName = x => String(x.name || x.displayName || '');
            const taken = new Set((existing || []).map(String));
            const avail = list
                .map(x => ({ number: getNum(x), name: getName(x) }))
                .filter(c => c.number && !taken.has(c.number));
            if (!avail.length) {
                ctx.toast?.('Sem contatos disponíveis', 'err');
                return resolve(null);
            }
            const bd = document.createElement('div');
            bd.className = 'sz-modal-backdrop';
            bd.innerHTML = `
                <div class="sz-modal sz-modal-tall">
                    <div class="sz-modal-title">Adicionar membros</div>
                    <input class="sz-input" id="szPickSearch" placeholder="Buscar…" />
                    <div class="sz-pick-list" id="szPickList">
                        ${avail.map(c => `
                            <label class="sz-pick-row" data-name="${S.escape((c.name + ' ' + c.number).toLowerCase())}">
                                <input type="checkbox" value="${S.escape(c.number)}" />
                                <span class="sz-pick-name">${S.escape(c.name || S.shortNum(c.number))}</span>
                                <span class="sz-pick-num">${S.escape(S.shortNum(c.number))}</span>
                            </label>
                        `).join('')}
                    </div>
                    <div class="sz-modal-actions">
                        <button class="sz-btn ghost" data-no>Cancelar</button>
                        <button class="sz-btn sz-btn-primary" data-yes>Adicionar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(bd);
            const search = bd.querySelector('#szPickSearch');
            search.addEventListener('input', () => {
                const q = search.value.trim().toLowerCase();
                bd.querySelectorAll('.sz-pick-row').forEach(r => {
                    r.style.display = (!q || r.dataset.name.includes(q)) ? '' : 'none';
                });
            });
            bd.addEventListener('click', e => {
                if (e.target === bd || e.target.closest('[data-no]')) { bd.remove(); resolve(null); }
                else if (e.target.closest('[data-yes]')) {
                    const picked = [...bd.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
                    bd.remove();
                    resolve(picked.length ? picked : null);
                }
            });
        });
    }

    // ═══ PANEL RENDER ═══
    G.renderPanel = async function(body, chatId, opts) {
        opts = opts || {};
        body.innerHTML = `<div class="sz-profile-loading">Carregando…</div>`;
        const doc = await ctx.bridge.firestore.parseDoc('sangzap_chats', chatId);
        if (!doc || doc.kind !== 'group') {
            body.innerHTML = `<div class="sz-field-hint">Grupo não encontrado.</div>`;
            return;
        }
        const members = (doc.members || []).map(String);
        const admins = new Set((doc.admins || []).map(String));
        const me = String(ctx.myNumber);
        const iAmAdmin = admins.has(me);

        const profiles = {};
        await Promise.allSettled(members.map(async m => {
            try { profiles[m] = await ctx.bridge.firestore.parseDoc('sangzap_profiles', m); } catch(_) {}
        }));

        const avatarHtml = doc.avatar
            ? `<img src="${S.escape(doc.avatar)}" alt="" />`
            : `<span class="sz-av-fallback">${S.escape(((doc.name || 'G')[0] || 'G').toUpperCase())}</span>`;

        const rows = members.map(m => {
            const p = profiles[m] || {};
            const name = p.displayName || S.shortNum(m);
            const isAdmin = admins.has(m);
            const isMe = m === me;
            const av = p.avatar
                ? `<img src="${S.escape(p.avatar)}" alt="" />`
                : `<span class="sz-av-fallback">${S.escape((name || '?')[0].toUpperCase())}</span>`;
            const canManage = iAmAdmin && !isMe;
            return `
                <div class="sz-member-row" data-num="${S.escape(m)}">
                    <div class="sz-avatar sz-avatar-sm">${av}</div>
                    <div class="sz-member-info">
                        <div class="sz-member-name">${S.escape(name)}${isMe ? ' <span class="sz-member-you">(você)</span>' : ''}</div>
                        <div class="sz-member-role">${isAdmin ? 'admin' : 'membro'}</div>
                    </div>
                    ${canManage ? `
                        <div class="sz-member-actions">
                            <button class="sz-btn-mini" data-act="${isAdmin ? 'demote' : 'promote'}">${isAdmin ? 'Rebaixar' : 'Promover'}</button>
                            <button class="sz-btn-mini" data-act="remove">Remover</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        body.innerHTML = `
            <div class="sz-group-panel">
                <div class="sz-settings-hero">
                    <div class="sz-avatar sz-avatar-lg" id="szGrpAv">${avatarHtml}</div>
                    ${iAmAdmin ? `<button class="sz-btn-mini" id="szGrpPickAv">Trocar foto</button>` : ''}
                </div>

                <div class="sz-section">
                    <div class="sz-section-title">Nome</div>
                    ${iAmAdmin
                        ? `<input class="sz-input" id="szGrpName" type="text" maxlength="40" value="${S.escape(doc.name || '')}" />`
                        : `<div class="sz-field-hint">${S.escape(doc.name || 'Grupo')}</div>`}
                </div>

                <div class="sz-section">
                    <div class="sz-section-title">Descrição</div>
                    ${iAmAdmin
                        ? `<textarea class="sz-input sz-textarea" id="szGrpDesc" maxlength="200" placeholder="Descrição do grupo">${S.escape(doc.description || '')}</textarea>`
                        : `<div class="sz-field-hint">${S.escape(doc.description || 'Sem descrição.')}</div>`}
                </div>

                <div class="sz-section">
                    <div class="sz-section-title">Membros (${members.length})</div>
                    <div id="szGrpMembers">${rows}</div>
                    ${iAmAdmin ? `<button class="sz-btn" id="szGrpAdd">Adicionar membro</button>` : ''}
                </div>

                ${iAmAdmin ? `<button class="sz-btn sz-btn-primary" id="szGrpSave">Salvar</button>` : ''}
                <button class="sz-btn ghost" id="szGrpLeave">Sair do grupo</button>
            </div>
        `;

        const av = body.querySelector('#szGrpAv');
        let pendingAvatar = null;

        const pickBtn = body.querySelector('#szGrpPickAv');
        if (pickBtn) pickBtn.addEventListener('click', async () => {
            const dataUrl = await pickAvatar();
            if (!dataUrl) return;
            pendingAvatar = dataUrl;
            av.innerHTML = `<img src="${S.escape(dataUrl)}" alt="" />`;
        });

        const membersEl = body.querySelector('#szGrpMembers');
        if (membersEl) membersEl.addEventListener('click', async e => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            const row = btn.closest('.sz-member-row');
            const num = row && row.dataset.num;
            if (!num) return;
            const act = btn.dataset.act;
            try {
                if (act === 'promote') await G.promote(chatId, num);
                else if (act === 'demote') await G.demote(chatId, num);
                else if (act === 'remove') {
                    const ok = await confirmModal('Remover membro?', `${S.shortNum(num)} será removido do grupo.`, 'Remover');
                    if (!ok) return;
                    await G.removeMember(chatId, num);
                }
                G.renderPanel(body, chatId, opts);
            } catch(err) {
                console.warn('[Sangzap/groups] action:', err);
                ctx.toast?.('Falha', 'err');
            }
        });

        const addBtn = body.querySelector('#szGrpAdd');
        if (addBtn) addBtn.addEventListener('click', async () => {
            const picked = await pickMembers(members);
            if (!picked) return;
            try {
                for (const n of picked) await G.addMember(chatId, n);
                G.renderPanel(body, chatId, opts);
            } catch(err) {
                console.warn('[Sangzap/groups] add:', err);
                ctx.toast?.('Falha ao adicionar', 'err');
            }
        });

        const saveBtn = body.querySelector('#szGrpSave');
        if (saveBtn) saveBtn.addEventListener('click', async () => {
            const name = body.querySelector('#szGrpName').value.trim();
            const desc = body.querySelector('#szGrpDesc').value.trim();
            try {
                await G.rename(chatId, name);
                await G.setDescription(chatId, desc);
                if (pendingAvatar !== null) await G.setAvatar(chatId, pendingAvatar);
                pendingAvatar = null;
                ctx.toast?.('Grupo salvo', 'ok');
            } catch(err) {
                console.warn('[Sangzap/groups] save:', err);
                ctx.toast?.('Falha ao salvar', 'err');
            }
        });

        body.querySelector('#szGrpLeave').addEventListener('click', async () => {
            const ok = await G.confirmLeave(chatId);
            if (!ok) return;
            if (typeof opts.onLeave === 'function') { try { opts.onLeave(); } catch(_) {} }
            else body.innerHTML = '';
        });
    };

    S.groups = G;
})();
