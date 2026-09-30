// modules/phone/apps/sangzap/stories.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    const S = window._sangzapCtx;
    if (!ctx || !S) return;
    if (S.stories) return;

    (function ensureFsHelpers() {
        if (S.fsQuery) return;

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
            const res = await ctx.bridge.firestore.request('POST', '/:runQuery', { structuredQuery });
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
        S.__fsFull = true;
    })();

    const SG = {};
    const TTL = 24 * 60 * 60 * 1000;
    const POLL_MS = 15000;
    const PROFILE_TTL = 60_000;
    const VIEWER_DURATION = 5000;
    const VIDEO_DURATION = 15000;
    const PREVIEW_MAX_H = 320;

    const REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];

    let _myNumber = null;
    let _timer = null;
    let _onUpdate = null;
    let _cache = [];
    let _groups = [];
    let _lastHash = 0;
    let _profileCache = new Map();
    let _openOverlay = null;
    let _viewerCleanup = null;

    // ═══ CSS ═══
    ctx.appendStyle(`
        /* Imagem do viewer — contain + fundo desfocado (padrão WhatsApp) */
        .sz-viewer-body {
            position: relative;
            display: flex; align-items: center; justify-content: center;
            overflow: hidden;
            background: #000;
        }
        .sz-viewer-bg {
            position: absolute; inset: 0;
            width: 100%; height: 100%;
            object-fit: cover;
            filter: blur(28px) brightness(.45) saturate(1.2);
            transform: scale(1.15);
            z-index: 0;
            pointer-events: none;
        }
        .sz-viewer-img {
            position: relative;
            z-index: 1;
            max-width: 100%; max-height: 100%;
            object-fit: contain;
            display: block;
            border-radius: 6px;
            box-shadow: 0 12px 40px rgba(0,0,0,.55);
        }
        .sz-viewer-caption {
            position: absolute; left: 0; right: 0; bottom: 0;
            z-index: 2;
            padding: 14px 16px;
            background: linear-gradient(180deg, transparent, rgba(0,0,0,.75));
            color: #f1f2f8; font-size: 12px; line-height: 1.4;
            text-align: center;
            pointer-events: none;
        }

        /* Preview no composer — contain, sem crop */
        .sz-story-img-preview:empty { display: none; }
        .sz-story-img-preview {
            margin-top: 6px;
            border-radius: 10px;
            overflow: hidden;
            background: #0a0d12;
            display: flex; align-items: center; justify-content: center;
            min-height: 80px;
        }
        .sz-story-img-preview img {
            display: block;
            width: auto; max-width: 100%;
            max-height: ${PREVIEW_MAX_H}px;
            object-fit: contain;
        }

        /* Spinner + publishing overlay */
        .sz-stories-publishing {
            position: absolute; inset: 0; z-index: 40;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 14px;
            background: rgba(0,0,0,.6);
            backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
            animation: szFadeIn .18s ease;
            color: #e9ecf5; font-size: 12px; font-weight: 700;
            letter-spacing: .02em;
        }
        .sz-spinner {
            width: 32px; height: 32px;
            border-radius: 50%;
            border: 3px solid rgba(255,255,255,.15);
            border-top-color: var(--sz-accent, #25d366);
            animation: szSpin .8s linear infinite;
        }
        @keyframes szSpin { to { transform: rotate(360deg); } }

        /* Reação com pop */
        .sz-viewer-react { transition: transform .15s ease, background .15s; }
        .sz-viewer-react.pop { animation: szReactPop .32s cubic-bezier(.34,1.56,.64,1); }
        @keyframes szReactPop {
            0%   { transform: scale(.7); }
            60%  { transform: scale(1.25); }
            100% { transform: scale(1); }
        }
        .sz-viewer-react.mine {
            background: rgba(37,211,102,.18);
            border-color: rgba(37,211,102,.5);
        }

        /* Reply input — estado sending + check */
        .sz-viewer-reply.sending .sz-viewer-reply-input { opacity: .55; }
        .sz-viewer-reply.sending .sz-viewer-reply-send { pointer-events: none; opacity: .55; }
        .sz-viewer-reply.sent .sz-viewer-reply-send {
            background: rgba(37,211,102,.25);
            color: #86efac;
        }

        /* Botão publicar em loading */
        .sz-btn.loading { opacity: .7; pointer-events: none; }
        .sz-btn.loading::after {
            content: ''; display: inline-block;
            width: 10px; height: 10px; margin-left: 6px;
            border: 2px solid currentColor; border-top-color: transparent;
            border-radius: 50%;
            animation: szSpin .7s linear infinite;
            vertical-align: middle;
        }
    `);

    // ═══ PROFILE CACHE ═══
    async function getProfile(num) {
        if (!num) return {};
        const c = _profileCache.get(num);
        if (c && Date.now() - c.ts < PROFILE_TTL) return c.data;
        try {
            const p = await S.fsGet('/sangzap_profiles/' + num) || {};
            _profileCache.set(num, { data: p, ts: Date.now() });
            return p;
        } catch(_) {
            return c?.data || {};
        }
    }

    // ═══ FETCH ═══
    async function fetchFeed() {
        try {
            const docs = await S.fsGet(
                `/sangzap_stories?orderBy=${encodeURIComponent('createdAt desc')}&pageSize=80`
            );
            const now = Date.now();
            return (docs || []).filter(s => s && s.expiresAt > now);
        } catch(_) { return []; }
    }

    async function groupStories(stories) {
        const byAuthor = new Map();
        for (const s of stories) {
            if (!s.author) continue;
            if (!byAuthor.has(s.author)) byAuthor.set(s.author, []);
            byAuthor.get(s.author).push(s);
        }
        const groups = [];
        for (const [author, list] of byAuthor) {
            list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            const profile = await getProfile(author);
            const allSeen = list.every(s => (s.viewers || []).includes(_myNumber));
            const latest = list[list.length - 1];
            groups.push({ author, profile, stories: list, allSeen, latest });
        }
        groups.sort((a, b) => {
            const mineA = a.author === _myNumber;
            const mineB = b.author === _myNumber;
            if (mineA !== mineB) return mineA ? -1 : 1;
            if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1;
            return (b.latest.createdAt || 0) - (a.latest.createdAt || 0);
        });
        return groups;
    }

    async function tick() {
        try {
            const stories = await fetchFeed();
            const groups = await groupStories(stories);
            const h = hashGroups(groups);
            _cache = stories;
            _groups = groups;
            if (h !== _lastHash) {
                _lastHash = h;
                _onUpdate?.(groups);
            }
        } catch(e) { console.warn('[Sangzap/stories] tick:', e); }
    }

    function hashGroups(groups) {
        let h = 5381;
        for (const g of groups) {
            const s = `${g.author}|${g.stories.length}|${g.allSeen?1:0}|${(g.stories.map(x=>x.id).join(','))}`;
            for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        }
        return h;
    }

    // ═══ CRUD ═══
    SG.post = async function(media, caption, dims) {
        const now = Date.now();
        const id = 'sg' + now.toString(36) + Math.random().toString(36).slice(2, 6);
        const doc = {
            author: _myNumber,
            media: media || '',
            caption: S.sanitize ? S.sanitize(caption || '').slice(0, 200) : (caption || '').slice(0, 200),
            createdAt: now,
            expiresAt: now + TTL,
            viewers: [],
            reactions: {}
        };
        if (dims && dims.w && dims.h) {
            doc.width = dims.w;
            doc.height = dims.h;
        }
        await S.fsCreate('/sangzap_stories', doc, id);
        return { id, ...doc };
    };

    SG.delete = async function(storyId) {
        try {
            await S.fsDel('/sangzap_stories/' + storyId);
            return true;
        } catch(e) { console.warn('[Sangzap/stories] delete:', e); return false; }
    };

    // Recebe viewers já computados quando o chamador já tem o estado.
    // Sem isso, chamada + resposta duplicam fetch (fsGet em SG.markViewed).
    SG.markViewed = async function(storyId, viewersArray) {
        try {
            let viewers;
            if (Array.isArray(viewersArray)) {
                viewers = viewersArray.slice();
            } else {
                const doc = await S.fsGet('/sangzap_stories/' + storyId);
                viewers = (doc?.viewers || []).slice();
            }
            if (viewers.includes(_myNumber)) return;
            viewers.push(_myNumber);
            await S.fsWrite('/sangzap_stories/' + storyId, { viewers });
        } catch(_) {}
    };

    // Recebe reactions já computado. Evita race de cliques rápidos em emojis
    // diferentes: o estado local é fonte de verdade, o write é atômico.
    SG.react = async function(storyId, reactions) {
        try {
            await S.fsWrite('/sangzap_stories/' + storyId, { reactions });
        } catch(_) {}
    };

    async function replyToStory(story, text) {
        if (!story || !text) return false;
        try {
            const chatId = S.chatIdFor(_myNumber, story.author);
            const now = Date.now();
            await S.fsWrite('/sangzap_chats/' + chatId, {
                kind: '1:1',
                members: [_myNumber, story.author].sort(),
                createdAt: now,
                updatedAt: now,
                lastMessage: '',
                lastMessageAt: 0
            }).catch(() => {});
            await S.fsCreate('/sangzap_chats/' + chatId + '/messages', {
                from: _myNumber,
                kind: 'story-reply',
                body: text,
                storyId: story.id,
                storyReply: {
                    author: story.author,
                    caption: (story.caption || '').slice(0, 100),
                    createdAt: story.createdAt || now
                },
                sentAt: now
            }, S.msgId());
            await S.fsWrite('/sangzap_chats/' + chatId, {
                lastMessage: '💬 Respondeu ao story',
                lastMessageAt: now,
                updatedAt: now
            });
            return true;
        } catch(e) { console.warn('[Sangzap/stories] reply:', e); return false; }
    }
    SG.reply = replyToStory;

    // ═══ TAB ═══
    SG.renderTab = function(body, myNumber) {
        _myNumber = myNumber;
        body.innerHTML = `
            <div class="sz-stories-tab">
                <div class="sz-stories-head">
                    <div class="sz-stories-title">Atualizações</div>
                    <button class="sz-new-btn" id="szStoryNew" type="button" title="Novo story" aria-label="Novo story">+</button>
                </div>
                <div class="sz-stories-list" id="szStoriesList">
                    <div class="sz-empty">Carregando…</div>
                </div>
            </div>
        `;
        const list = body.querySelector('#szStoriesList');
        body.querySelector('#szStoryNew').addEventListener('click', () => openComposer(body, myNumber));

        function paint(groups) {
            if (!groups.length) {
                list.innerHTML = `<div class="sz-empty">Nenhuma atualização. Toque em <b>+</b> pra publicar.</div>`;
                return;
            }
            const mine = groups.find(g => g.author === _myNumber);
            const others = groups.filter(g => g.author !== _myNumber);
            const parts = [];
            if (mine) parts.push(renderRing(mine));
            for (const g of others) parts.push(renderRing(g));
            list.innerHTML = parts.join('');

            list.querySelectorAll('.sz-ring[data-author]').forEach(el => {
                el.addEventListener('click', () => {
                    const author = el.dataset.author;
                    const groupIdx = _groups.findIndex(g => g.author === author);
                    if (groupIdx >= 0) openViewer(body, groupIdx, 0);
                });
            });
        }

        SG.start(myNumber, paint);
    };

    function renderRing(g) {
        const name = g.profile?.displayName || S.shortNum(g.author);
        const avatar = g.profile?.avatar
            ? `<img src="${S.escape(g.profile.avatar)}" alt="" />`
            : `<span class="sz-av-fallback">${S.escape((name || '?')[0].toUpperCase())}</span>`;
        const mine = g.author === _myNumber;
        const cls = [
            'sz-ring',
            mine ? 'mine' : '',
            g.allSeen && !mine ? 'seen' : 'unseen'
        ].filter(Boolean).join(' ');
        const when = S.fmtRelative ? S.fmtRelative(g.latest.createdAt) : '';
        const count = g.stories.length;
        const sub = mine
            ? `${count} ${count === 1 ? 'atualização' : 'atualizações'}`
            : (g.allSeen ? `${count} ${count === 1 ? 'vista' : 'vistas'}` : `${count} nova${count > 1 ? 's' : ''}`);
        const preview = mine ? '' : `<div class="sz-ring-preview">${S.escape(when)}</div>`;
        return `<button class="${cls}" data-author="${S.escape(g.author)}" type="button">
            <span class="sz-ring-av${g.allSeen && !mine ? ' seen' : ''}">${avatar}</span>
            <span class="sz-ring-info">
                <span class="sz-ring-name">${mine ? 'Meu status' : S.escape(name)}</span>
                <span class="sz-ring-sub">${S.escape(sub)}</span>
                ${preview}
            </span>
        </button>`;
    }

    // ═══ VIEWER ═══
    function openViewer(body, groupIdx, storyIdx) {
        closeViewer();
        const root = body.closest('.sz-app') || body;
        const overlay = document.createElement('div');
        overlay.className = 'sz-viewer';
        root.appendChild(overlay);
        _openOverlay = overlay;

        let gIdx = groupIdx;
        let sIdx = storyIdx;
        let autoTimer = null;
        let rafId = null;
        let progressStart = 0;
        let progressPaused = false;
        let progressPausedAt = 0;
        let progressPausedTotal = 0;
        let done = false;

        function currentGroup() { return _groups[gIdx]; }
        function currentStory() { const g = currentGroup(); return g ? g.stories[sIdx] : null; }

        function stopProgress() {
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
        }

        function next() {
            stopProgress();
            const g = currentGroup();
            if (!g) return close();
            if (sIdx < g.stories.length - 1) { sIdx++; render(); return; }
            if (gIdx < _groups.length - 1) { gIdx++; sIdx = 0; render(); return; }
            close();
        }
        function prev() {
            stopProgress();
            if (sIdx > 0) { sIdx--; render(); return; }
            if (gIdx > 0) { gIdx--; const g = currentGroup(); sIdx = g ? g.stories.length - 1 : 0; render(); return; }
            sIdx = 0;
            render();
        }
        function close() {
            if (done) return;
            done = true;
            stopProgress();
            try { overlay.remove(); } catch(_) {}
            if (_openOverlay === overlay) _openOverlay = null;
            if (_viewerCleanup === close) _viewerCleanup = null;
            tick();
        }

        async function markViewed(story) {
            if (!story) return;
            if (story.author === _myNumber) return;
            if ((story.viewers || []).includes(_myNumber)) return;
            story.viewers = [...(story.viewers || []), _myNumber];
            await SG.markViewed(story.id, story.viewers);
        }

        function progressDuration(story) {
            if (story && story.kind === 'video') return VIDEO_DURATION;
            return VIEWER_DURATION;
        }

        function startProgress() {
            stopProgress();
            const story = currentStory();
            if (!story) return;
            const dur = progressDuration(story);
            progressStart = performance.now();
            progressPaused = false;
            progressPausedAt = 0;
            progressPausedTotal = 0;

            const fill = overlay.querySelector('.sz-viewer-bar.active .sz-viewer-bar-fill');
            if (!fill) return;

            function frame() {
                if (done) return;
                rafId = requestAnimationFrame(frame);
                if (progressPaused) return;
                const elapsed = performance.now() - progressStart - progressPausedTotal;
                const ratio = Math.min(1, elapsed / dur);
                fill.style.transform = `scaleX(${ratio})`;
                if (ratio >= 1) {
                    stopProgress();
                    next();
                }
            }
            rafId = requestAnimationFrame(frame);
        }

        function pauseProgress() {
            if (progressPaused) return;
            progressPaused = true;
            progressPausedAt = performance.now();
        }
        function resumeProgress() {
            if (!progressPaused) return;
            progressPausedTotal += performance.now() - progressPausedAt;
            progressPaused = false;
            progressPausedAt = 0;
        }

        async function render() {
            const g = currentGroup();
            if (!g) return close();
            const story = g.stories[sIdx];
            if (!story) return close();

            const name = g.profile?.displayName || S.shortNum(g.author);
            const avatar = g.profile?.avatar
                ? `<img src="${S.escape(g.profile.avatar)}" alt="" />`
                : `<span class="sz-av-fallback">${S.escape((name || '?')[0].toUpperCase())}</span>`;
            const when = S.fmtRelative ? S.fmtRelative(story.createdAt) : '';
            const mine = story.author === _myNumber;
            const mediaUrl = S.escape(story.media || '');
            const ar = (story.width && story.height) ? ` style="aspect-ratio:${story.width}/${story.height};"` : '';
            const media = story.media
                ? `<img class="sz-viewer-bg" src="${mediaUrl}" alt="" aria-hidden="true" />
                   <img class="sz-viewer-img" src="${mediaUrl}" alt=""${ar} />`
                : '';
            const caption = story.caption
                ? `<div class="sz-viewer-caption">${S.escape(story.caption)}</div>`
                : '';
            const viewersCount = (story.viewers || []).length;
            const mineBar = mine
                ? `<button class="sz-viewer-viewers" data-act="open-viewers" type="button">
                       <span>👁 ${viewersCount}</span>
                   </button>
                   <button class="sz-viewer-del" data-act="delete" type="button" title="Apagar">🗑</button>`
                : '';
            const replyBar = !mine ? `
                <div class="sz-viewer-reply">
                    <input class="sz-viewer-reply-input" type="text" placeholder="Responder…" maxlength="400" />
                    <button class="sz-viewer-reply-send" data-act="send-reply" type="button">➤</button>
                </div>` : '';

            const bars = g.stories.map((_, i) => {
                const cls = i < sIdx ? 'done' : i === sIdx ? 'active' : '';
                return `<span class="sz-viewer-bar ${cls}"><span class="sz-viewer-bar-fill" style="transform:scaleX(${i < sIdx ? 1 : 0})"></span></span>`;
            }).join('');

            overlay.innerHTML = `
                <div class="sz-viewer-inner">
                    <div class="sz-viewer-bars">${bars}</div>
                    <header class="sz-viewer-head">
                        <div class="sz-avatar sz-avatar-sm sz-ring-av">${avatar}</div>
                        <div class="sz-viewer-head-info">
                            <div class="sz-viewer-head-name">${S.escape(name)}</div>
                            <div class="sz-viewer-head-time">${S.escape(when)}</div>
                        </div>
                        ${mineBar}
                        <button class="sz-viewer-close" data-act="close" type="button" aria-label="Fechar">✕</button>
                    </header>
                    <div class="sz-viewer-body">
                        ${media}
                        ${caption}
                    </div>
                    <div class="sz-viewer-reactions">
                        ${REACTIONS.map(e => `<button class="sz-viewer-react${story.reactions?.[_myNumber] === e ? ' mine' : ''}" data-emoji="${S.escape(e)}" type="button">${e}</button>`).join('')}
                    </div>
                    ${replyBar}
                    <div class="sz-viewer-tap left" data-dir="prev"></div>
                    <div class="sz-viewer-tap right" data-dir="next"></div>
                </div>
            `;

            markViewed(story);
            startProgress();

            overlay.querySelectorAll('[data-act]').forEach(el => {
                const act = el.dataset.act;
                if (act === 'close') el.addEventListener('click', close);
                else if (act === 'open-viewers') el.addEventListener('click', () => openViewersList(story));
                else if (act === 'delete') el.addEventListener('click', async () => {
                    if (!confirm('Apagar este story?')) return;
                    const ok = await SG.delete(story.id);
                    if (ok) { ctx.toast?.('Story apagado', 'ok'); next(); }
                    else ctx.toast?.('Falha ao apagar', 'err');
                });
                else if (act === 'send-reply') el.addEventListener('click', () => sendReplyFromViewer(story, el));
            });
            const replyInput = overlay.querySelector('.sz-viewer-reply-input');
            if (replyInput) {
                replyInput.addEventListener('keydown', e => {
                    if (e.key === 'Enter') { e.preventDefault(); sendReplyFromViewer(story, overlay.querySelector('.sz-viewer-reply-send')); }
                });
                replyInput.addEventListener('focus', pauseProgress);
                replyInput.addEventListener('blur', resumeProgress);
            }

            // Reação: estado local é fonte de verdade; write atômico sem re-render.
            overlay.querySelectorAll('.sz-viewer-react').forEach(btn => {
                btn.addEventListener('click', async ev => {
                    ev.stopPropagation();
                    const emoji = btn.dataset.emoji;
                    story.reactions = { ...(story.reactions || {}) };
                    if (story.reactions[_myNumber] === emoji) delete story.reactions[_myNumber];
                    else story.reactions[_myNumber] = emoji;

                    btn.classList.remove('pop');
                    void btn.offsetWidth;
                    btn.classList.add('pop');
                    setTimeout(() => btn.classList.remove('pop'), 340);

                    overlay.querySelectorAll('.sz-viewer-react').forEach(b => {
                        b.classList.toggle('mine', story.reactions[_myNumber] === b.dataset.emoji);
                    });

                    await SG.react(story.id, story.reactions);
                });
            });

            overlay.querySelectorAll('.sz-viewer-tap').forEach(tap => {
                tap.addEventListener('click', e => {
                    e.stopPropagation();
                    if (tap.dataset.dir === 'prev') prev();
                    else next();
                });
            });

            const body_el = overlay.querySelector('.sz-viewer-body');
            body_el?.addEventListener('click', () => { next(); });

            let sx = 0, sy = 0, swiping = false;
            overlay.addEventListener('pointerdown', e => {
                if (e.target.closest('input, button')) return;
                sx = e.clientX; sy = e.clientY; swiping = true;
                pauseProgress();
            });
            overlay.addEventListener('pointermove', e => {
                if (!swiping) return;
                const dx = e.clientX - sx;
                const dy = e.clientY - sy;
                if (dy > 60 && Math.abs(dy) > Math.abs(dx)) {
                    overlay.style.transform = `translateY(${Math.min(dy, 200)}px)`;
                    overlay.style.opacity = String(Math.max(0.3, 1 - dy / 300));
                }
            });
            overlay.addEventListener('pointerup', e => {
                if (!swiping) return;
                swiping = false;
                overlay.style.transform = '';
                overlay.style.opacity = '';
                const dy = e.clientY - sy;
                const dx = e.clientX - sx;
                if (dy > 80 && Math.abs(dy) > Math.abs(dx)) close();
                else resumeProgress();
            });
            overlay.addEventListener('pointercancel', () => {
                swiping = false;
                overlay.style.transform = '';
                overlay.style.opacity = '';
                resumeProgress();
            });
            overlay.addEventListener('mousedown', e => {
                if (e.target.closest('input, button')) return;
                pauseProgress();
            });
            overlay.addEventListener('mouseup', () => resumeProgress());
        }

        async function sendReplyFromViewer(story, sendBtn) {
            const wrap = overlay.querySelector('.sz-viewer-reply');
            const inp = overlay.querySelector('.sz-viewer-reply-input');
            if (!inp || !wrap) return;
            const txt = inp.value.trim();
            if (!txt) return;
            inp.value = '';
            wrap.classList.add('sending');
            const ok = await replyToStory(story, txt);
            wrap.classList.remove('sending');
            if (ok) {
                wrap.classList.add('sent');
                inp.placeholder = 'Enviado ✓';
                setTimeout(() => {
                    if (!wrap.isConnected) return;
                    wrap.classList.remove('sent');
                    inp.placeholder = 'Responder…';
                }, 1400);
            } else {
                ctx.toast?.('Falha ao responder', 'err');
            }
        }

        render();
        _viewerCleanup = close;
    }

    function closeViewer() {
        if (_openOverlay) { try { _openOverlay.remove(); } catch(_) {} _openOverlay = null; }
        _viewerCleanup = null;
    }

    // ═══ VIEWERS LIST ═══
    async function openViewersList(story) {
        if (!story) return;
        const viewers = story.viewers || [];
        const root = _openOverlay || document.body;
        const m = document.createElement('div');
        m.className = 'sz-viewers-modal';
        m.innerHTML = `
            <div class="sz-viewers-card">
                <div class="sz-viewers-title">
                    <span>Visualizações</span>
                    <span class="sz-viewers-count">${viewers.length}</span>
                </div>
                <div class="sz-viewers-list" id="szViewersList">
                    ${viewers.length ? '<div class="sz-empty">Carregando…</div>' : '<div class="sz-empty">Ninguém viu ainda.</div>'}
                </div>
                <button class="sz-modal-cancel" data-act="close-viewers" type="button">Fechar</button>
            </div>
        `;
        root.appendChild(m);
        m.querySelector('[data-act="close-viewers"]').addEventListener('click', () => m.remove());

        if (!viewers.length) return;
        const list = m.querySelector('#szViewersList');
        const rows = await Promise.all(viewers.map(async num => {
            const prof = await getProfile(num);
            const name = prof?.displayName || S.shortNum(num);
            const av = prof?.avatar
                ? `<img src="${S.escape(prof.avatar)}" alt="" />`
                : `<span class="sz-av-fallback">${S.escape((name || '?')[0].toUpperCase())}</span>`;
            return `<div class="sz-viewers-item">
                <div class="sz-avatar sz-avatar-sm">${av}</div>
                <div class="sz-viewers-name">${S.escape(name)}</div>
            </div>`;
        }));
        list.innerHTML = rows.join('');
    }

    // ═══ COMPOSER ═══
    function openComposer(body, myNumber) {
        const modal = document.createElement('div');
        modal.className = 'sz-modal';
        modal.innerHTML = `
            <div class="sz-modal-card">
                <div class="sz-modal-title">Novo story</div>
                <div class="sz-modal-body" style="flex:1 1 auto;min-height:0;overflow-y:auto;">
                    <button class="sz-btn" id="szStoryPick" type="button">Escolher foto</button>
                    <div class="sz-story-img-preview" id="szStoryImgPreview"></div>
                    <textarea class="sz-input sz-textarea" id="szStoryCaption"
                        maxlength="200" placeholder="Legenda (opcional)"></textarea>
                </div>
                <div class="sz-modal-actions">
                    <button class="sz-btn" id="szStoryCancel" type="button">Cancelar</button>
                    <button class="sz-btn sz-btn-primary" id="szStoryPost" type="button">Publicar</button>
                </div>
            </div>
        `;
        body.appendChild(modal);

        let media = '';
        let dims = null;
        const imgPreview = modal.querySelector('#szStoryImgPreview');
        const capEl = modal.querySelector('#szStoryCaption');
        const postBtn = modal.querySelector('#szStoryPost');

        modal.querySelector('#szStoryPick').addEventListener('click', async () => {
            const dataUrl = await S.settings?.pickAndCropSquare?.();
            if (!dataUrl) return;
            media = dataUrl;
            // Mede a imagem para salvar aspect-ratio — evita CLS no viewer.
            dims = await new Promise(resolve => {
                const im = new Image();
                im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
                im.onerror = () => resolve(null);
                im.src = dataUrl;
            });
            imgPreview.innerHTML = `<img src="${S.escape(dataUrl)}" alt="" />`;
        });
        modal.querySelector('#szStoryCancel').addEventListener('click', closeModal);
        postBtn.addEventListener('click', async () => {
            if (!media) { ctx.toast?.('Escolha uma foto', 'err'); return; }
            const caption = capEl.value.trim();
            postBtn.classList.add('loading');
            postBtn.disabled = true;
            const busy = document.createElement('div');
            busy.className = 'sz-stories-publishing';
            busy.innerHTML = `<div class="sz-spinner"></div><div>Publicando…</div>`;
            modal.querySelector('.sz-modal-card')?.appendChild(busy);
            try {
                await SG.post(media, caption, dims);
                closeModal();
                ctx.toast?.('Story publicado', 'ok');
                _lastHash = 0;
                tick();
            } catch(e) {
                console.warn('[Sangzap/stories] post:', e);
                ctx.toast?.('Falha ao publicar', 'err');
                busy.remove();
                postBtn.classList.remove('loading');
                postBtn.disabled = false;
            }
        });

        function onKey(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeModal();
            }
        }
        function closeModal() {
            document.removeEventListener('keydown', onKey, true);
            try { modal.remove(); } catch(_) {}
        }
        document.addEventListener('keydown', onKey, true);
    }

    // ═══ LIFECYCLE ═══
    SG.start = function(myNumber, onUpdate) {
        _myNumber = myNumber;
        _onUpdate = onUpdate;
        SG.stop();
        tick();
        _timer = setInterval(tick, POLL_MS);
    };
    SG.stop = function() {
        if (_timer) { clearInterval(_timer); _timer = null; }
        closeViewer();
    };
    SG.get = () => _cache;
    SG.groups = () => _groups;

    S.stories = SG;
})();
