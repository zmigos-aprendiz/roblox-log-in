// modules/phone/apps/sangzap/shell.js
(function() {
    'use strict';

    // ═══ BOOT GUARD ═══
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Sangzap] phone ctx ausente'); return; }
    if (ctx.apps?.get?.('sangzap')) return;

    const APP_ID = 'sangzap';
    const APP_VERSION = '0.6.1';
    const DEFAULT_MODULE_BASE = 'https://raw.githubusercontent.com/zBeyond5/Liveblock/main/modules/phone';
    const DEFAULT_APP_BG = '#0e1621';

    const MODULE_BASE = (ctx.moduleBase || DEFAULT_MODULE_BASE).replace(/\/+$/, '');
    const BASE = MODULE_BASE + '/apps/sangzap';

    const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;

    // ═══ STATE ═══
    const _state = {
        activeTab: 'chats',
        activeChatId: null,
        chatMeta: null,
        searchQuery: '',
        rosterChip: 'all',
        rosterSections: [],
        rosterCounts: { all: 0, unread: 0, groups: 0, archived: 0 },
        myNumber: null,
        myName: '',
        root: null,
        screenEl: null,
        appBg: DEFAULT_APP_BG,
        mounted: false,
        destroyed: false,
        online: navigator.onLine !== false,
        pendingOpen: null
    };

    let S = null;
    let _moduleLoaded = false;
    let _loadPromise = null;
    let _loadFailed = false;
    let _moduleDiagnostic = null;
    let _unreadTotal = 0;
    let _historyBound = false;
    let _histPushed = false;
    let _connBound = false;
    let _rosterStarted = false;
    let _micCleanup = null;

    // ═══ SAFE BINDING ═══
    function bindS() { S = window._sangzapCtx || null; return S; }
    function safe(fn, fallback) {
        try { return fn(); } catch(e) { console.warn('[Sangzap] safe:', e); return fallback; }
    }
    const esc = (s) => safe(() => S?.escape?.(s), String(s ?? ''));
    const fmtTime = (ts) => safe(() => S?.fmtTime?.(ts), '');
    const fmtRelative = (ts) => safe(() => S?.fmtRelative?.(ts), '');
    const timeAgo = (ts) => safe(() => S?.timeAgo?.(ts), '');
    const shortNum = (n) => safe(() => S?.shortNum?.(n), String(n ?? ''));
    const chatIdFor = (a, b) => safe(() => S?.chatIdFor?.(a, b), [String(a), String(b)].sort().join('-'));

    // ═══ MODULE LOADER ═══
    async function loadScript(src, timeoutMs) {
        timeoutMs = timeoutMs || 8000;
        const ctrl = new AbortController();
        const t = setTimeout(() => { try { ctrl.abort(); } catch(_) {} }, timeoutMs);
        try {
            const res = await fetch(src, { cache: 'no-store', signal: ctrl.signal });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const code = await res.text();
            const s = document.createElement('script');
            s.textContent = code;
            document.head.appendChild(s);
            s.remove();
            return true;
        } catch(e) {
            console.warn('[Sangzap] falha ao carregar', src, e.message || e);
            return false;
        } finally {
            clearTimeout(t);
        }
    }

    function loadModules() {
        if (_loadPromise) return _loadPromise;
        _loadPromise = (async () => {
            if (_moduleLoaded) return;

            const commonUrl = `${BASE}/common.js?v=${APP_VERSION}`;
            const commonOk = await loadScript(commonUrl);
            const results = [{ file: 'common.js', url: commonUrl, ok: commonOk }];
            bindS();

            if (!commonOk || !S) {
                console.error('[Sangzap] FALHA CRÍTICA em common.js. ok:', commonOk, '| S:', S, '| Base:', BASE);
                _loadFailed = true;
                _moduleDiagnostic = { base: BASE, results, missing: ['common'] };
                return;
            }

            const rest = ['style.js', 'roster.js', 'chat.js', 'audio.js', 'groups.js', 'settings.js', 'stories.js'];
            const restResults = await Promise.all(rest.map(async (f) => {
                const url = `${BASE}/${f}?v=${APP_VERSION}`;
                const ok = await loadScript(url);
                return { file: f, url, ok };
            }));
            results.push(...restResults);

            const missing = [];
            if (!S.roster)   missing.push('roster');
            if (!S.chat)     missing.push('chat');
            if (!S.audio)    missing.push('audio');
            if (!S.groups)   missing.push('groups');
            if (!S.settings) missing.push('settings');
            if (!S.stories)  missing.push('stories');

            _moduleDiagnostic = { base: BASE, results, missing };
            _loadFailed = missing.length >= 5;

            if (missing.length) console.warn('[Sangzap] módulos faltando:', missing.join(', '));
            else console.log('[Sangzap] todos os módulos prontos de', BASE);

            _moduleLoaded = true;
        })();
        return _loadPromise;
    }

    // ═══ APP BAR / BG / BADGE ═══
    function hidePhoneBar() { try { _state.screenEl?.classList?.add('sz-hide-bar'); } catch(_) {} }
    function showPhoneBar() { try { _state.screenEl?.classList?.remove('sz-hide-bar'); } catch(_) {} }
    function refreshAppBadge(total) { _unreadTotal = total || 0; try { ctx.apps?._notify?.(); } catch(_) {} }
    function applyAppBg() {
        const bg = _state.appBg || DEFAULT_APP_BG;
        try {
            _state.root?.style?.setProperty('--sz-app-bg', bg);
            _state.screenEl?.style?.setProperty('--sz-app-bg', bg);
        } catch(_) {}
    }

    // ═══ CONEXÃO ═══
    function bindConnection() {
        if (_connBound) return;
        _connBound = true;
        window.addEventListener('online', () => {
            _state.online = true;
            updateConnBar();
            try { S?.chat?.drainQueue?.(); } catch(_) {}
        });
        window.addEventListener('offline', () => {
            _state.online = false;
            updateConnBar();
        });
        updateConnBar();
    }
    function updateConnBar() {
        const bar = _state.root?.querySelector('.sz-conn-bar');
        if (!bar) return;
        const off = !_state.online;
        bar.classList.toggle('on', off);
        bar.textContent = off ? 'Sem conexão — mensagens serão reenviadas quando voltar' : '';
    }

    // ═══ HISTORY / ANDROID BACK ═══
    function historyPush() {
        try {
            history.pushState({ __sz: 1, t: Date.now() }, '');
            _histPushed = true;
        } catch(_) {}
    }
    function historyExit() {
        try { history.back(); } catch(_) {}
    }
    function bindHistory() {
        if (_historyBound) return;
        _historyBound = true;
        window.addEventListener('popstate', () => {
            if (!_state.mounted) { _histPushed = false; return; }
            if (_state.activeChatId) {
                closeChat(false);
                historyPush();
                return;
            }
            if (_state.activeTab === 'settings') {
                _state.activeTab = 'chats';
                render();
                historyPush();
                return;
            }
            _histPushed = false;
            try { ctx.closeApp?.(); } catch(_) {}
        });
    }

    // ═══ NAV ═══
    function goHome() {
        if (_state.activeChatId) { historyExit(); return; }
        if (_state.activeTab === 'settings') { historyExit(); return; }
        try { ctx.closeApp?.(); } catch(_) {}
    }

    // ═══ HEADER DO CHAT — helpers ═══
    function chatAvatarHTML(meta) {
        const m = meta || {};
        const entry = S?.roster?.getEntry?.(_state.activeChatId);
        const avatar = m.avatar || entry?.avatar || '';
        if (avatar) return `<img src="${esc(avatar)}" alt="" />`;
        const title = m.title || entry?.title || (m.number ? shortNum(m.number) : '?');
        const initial = (title || '?').trim()[0]?.toUpperCase() || '?';
        return esc(initial);
    }
    function chatSubtitle() {
        const meta = _state.chatMeta || {};
        if (meta.kind === 'group') {
            const n = (meta.members || []).length;
            return n > 0 ? `${n} membro${n === 1 ? '' : 's'}` : 'Grupo';
        }
        const entry = S?.roster?.getEntry?.(_state.activeChatId);
        if (entry?.online) return 'online';
        if (entry?.lastSeen) return 'visto ' + (timeAgo(entry.lastSeen) || 'recentemente');
        if (meta.number) return shortNum(meta.number);
        return '';
    }

    // ═══ MENU DE OPÇÕES DO CHAT ═══
    function openChatOptions() {
        if (!_state.root) return;
        _state.root.querySelector('.sz-chat-opts')?.remove();

        const meta = _state.chatMeta || {};
        const isGroup = meta.kind === 'group';
        const entry = S?.roster?.getEntry?.(_state.activeChatId) || meta;

        const pinned = !!entry.pinned;
        const muted = !!entry.muted;
        const archived = !!entry.archived;
        const blocked = meta.number && ctx.contacts?.isBlocked?.(meta.number);

        const wrap = document.createElement('div');
        wrap.className = 'sz-chat-opts';
        wrap.innerHTML = `
            <div class="sz-chat-opts-card">
                <div class="sz-chat-opts-hdr">
                    <div class="sz-chat-opts-hdr-av">${chatAvatarHTML(meta)}</div>
                    <div class="sz-chat-opts-hdr-info">
                        <div class="sz-chat-opts-hdr-name">${esc(meta.title || '—')}</div>
                        <div class="sz-chat-opts-hdr-num">${esc(chatSubtitle())}</div>
                    </div>
                </div>
                <div class="sz-chat-opts-list">
                    <button class="sz-chat-opt" data-act="pin">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
                        <span>${pinned ? 'Desafixar' : 'Fixar conversa'}</span>
                    </button>
                    <button class="sz-chat-opt" data-act="mute">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6"/><path d="M16 9l6 6"/></svg>
                        <span>${muted ? 'Ativar som' : 'Silenciar'}</span>
                    </button>
                    <button class="sz-chat-opt" data-act="archive">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                        <span>${archived ? 'Desarquivar' : 'Arquivar'}</span>
                    </button>
                    ${!isGroup && meta.number ? `
                        <button class="sz-chat-opt ${blocked ? '' : 'danger'}" data-act="block">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                            <span>${blocked ? 'Desbloquear contato' : 'Bloquear contato'}</span>
                        </button>
                    ` : ''}
                    ${isGroup ? `
                        <button class="sz-chat-opt danger" data-act="leave">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                            <span>Sair do grupo</span>
                        </button>
                    ` : ''}
                    <button class="sz-chat-opt" data-act="close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        <span>Fechar</span>
                    </button>
                </div>
            </div>
        `;
        _state.root.appendChild(wrap);

        const close = () => { try { wrap.remove(); } catch(_) {} };
        wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });

        wrap.querySelectorAll('.sz-chat-opt').forEach(btn => {
            btn.addEventListener('click', async () => {
                const act = btn.dataset.act;
                if (act === 'close') { close(); return; }
                if (act === 'pin' && S?.roster?.pin) {
                    try { await S.roster.pin(_state.activeChatId, !pinned); ctx.toast?.(!pinned ? 'Fixada' : 'Desafixada', 'ok'); } catch(_) {}
                    close(); return;
                }
                if (act === 'mute' && S?.roster?.mute) {
                    try { await S.roster.mute(_state.activeChatId, !muted); ctx.toast?.(!muted ? 'Silenciada' : 'Som ativado', 'ok'); } catch(_) {}
                    close(); return;
                }
                if (act === 'archive' && S?.roster?.archive) {
                    try { await S.roster.archive(_state.activeChatId, !archived); ctx.toast?.(!archived ? 'Arquivada' : 'Desarquivada', 'ok'); } catch(_) {}
                    close(); return;
                }
                if (act === 'block' && meta.number && ctx.contacts?.toggleBlock) {
                    const nowBlk = ctx.contacts.toggleBlock(meta.number);
                    ctx.toast?.(nowBlk ? 'Contato bloqueado' : 'Contato desbloqueado', nowBlk ? 'err' : 'ok');
                    close(); return;
                }
                if (act === 'leave' && S?.groups?.leave) {
                    if (!confirm('Sair do grupo?')) return;
                    try { await S.groups.leave(_state.activeChatId); closeChat(); } catch(_) {}
                    return;
                }
            });
        });
    }

    // ═══ RENDER ═══
    function render() {
        if (!_state.root || _state.destroyed) return;
        bindS();
        const root = _state.root;
        const inSettings = _state.activeTab === 'settings' && !_state.activeChatId;
        const inChat = !!_state.activeChatId;
        const showTabs = !inChat && !inSettings;
        const isGroup = _state.chatMeta?.kind === 'group';
        const chatTitle = isGroup
            ? (_state.chatMeta?.title || 'Grupo')
            : (_state.chatMeta?.number ? shortNum(_state.chatMeta.number) : 'Chat');

        root.innerHTML = `
            <div class="sz-app${inSettings ? ' sz-settings-mode' : ''}">
                <div class="sz-conn-bar"></div>
                <header class="sz-hdr">
                    ${inChat
                        ? `<button class="sz-hdr-back" id="szBack" aria-label="Voltar">‹</button>
                           <button class="sz-chat-ident" id="szChatIdent" type="button" aria-label="Opções da conversa">
                               <span class="sz-chat-ident-av">${chatAvatarHTML(_state.chatMeta)}</span>
                               <span class="sz-chat-ident-info">
                                   <span class="sz-chat-ident-name">${esc(chatTitle)}</span>
                                   <span class="sz-chat-ident-sub">${esc(chatSubtitle())}</span>
                               </span>
                           </button>
                           ${!isGroup && _state.chatMeta?.number
                                ? `<button class="sz-hdr-call" id="szCall" aria-label="Ligar">📞</button>` : ''}`
                        : `<button class="sz-hdr-back" id="szBack" aria-label="Voltar">${ctx.I?.back || '←'}</button>
                           <div class="sz-hdr-title">SANGZAP</div>
                           ${!inSettings
                                ? `<button class="sz-hdr-gear" id="szGear" aria-label="Configurações">
                                       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                                   </button>`
                                : ''}`
                    }
                </header>

                ${showTabs ? `
                    <div class="sz-tabs" id="szTabs" role="tablist">
                        <button class="sz-tab${_state.activeTab === 'chats' ? ' active' : ''}" data-tab="chats" role="tab">Conversas</button>
                        <button class="sz-tab${_state.activeTab === 'stories' ? ' active' : ''}" data-tab="stories" role="tab">Stories</button>
                    </div>
                ` : ''}

                <div class="sz-body" id="szBody"></div>
            </div>
        `;

        updateConnBar();

        root.querySelector('#szBack')?.addEventListener('click', goHome);
        root.querySelector('#szChatIdent')?.addEventListener('click', openChatOptions);
        root.querySelector('#szGear')?.addEventListener('click', () => {
            _state.activeTab = 'settings';
            _state.activeChatId = null;
            _state.chatMeta = null;
            historyPush();
            render();
        });
        root.querySelector('#szCall')?.addEventListener('click', () => {
            const num = _state.chatMeta?.number;
            if (!num) return;
            try {
                if (typeof ctx.contacts?.callByNumber === 'function') {
                    ctx.contacts.callByNumber(num);
                } else if (typeof ctx.calls?.call === 'function') {
                    const name = _state.chatMeta?.title || num;
                    ctx.calls.call([{ id: '', name, avatarUrl: '', number: num }]);
                } else {
                    ctx.toast?.('Chamadas indisponíveis', 'err');
                }
            } catch(e) { console.warn('[Sangzap] call:', e); }
        });
        root.querySelectorAll('.sz-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.tab === _state.activeTab) return;
                _state.activeTab = btn.dataset.tab;
                _state.activeChatId = null;
                _state.chatMeta = null;
                render();
            });
        });

        const body = root.querySelector('#szBody');
        if (!body) return;

        if (_loadFailed && !inChat && _state.activeTab === 'chats') {
            renderDiagnostic(body);
            return;
        }

        try {
            if (inChat) renderChat(body);
            else if (_state.activeTab === 'chats') renderRoster(body);
            else if (_state.activeTab === 'stories') {
                if (S?.stories?.renderTab) S.stories.renderTab(body, _state.myNumber);
                else renderStub(body, 'Stories', 'Módulo indisponível.');
            }
            else if (inSettings) {
                if (S?.settings?.render) S.settings.render(body, _state.myNumber);
                else renderStub(body, 'Ajustes', 'Módulo indisponível.');
            }
        } catch(e) {
            console.error('[Sangzap] erro de render:', e);
            renderStub(body, 'Erro', 'Falha ao montar esta tela.');
        }
    }

    function renderDiagnostic(body) {
        const d = _moduleDiagnostic || { base: BASE, results: [], missing: ['?'] };
        const rows = d.results.map(r => `
            <div class="sz-diag-row ${r.ok ? 'ok' : 'fail'}">
                <span class="sz-diag-ico">${r.ok ? '✓' : '✗'}</span>
                <span class="sz-diag-file">${esc(r.file)}</span>
                <span class="sz-diag-status">${r.ok ? 'ok' : '404/timeout'}</span>
            </div>
        `).join('');
        const missingTxt = (d.missing || []).join(', ') || '—';
        body.innerHTML = `
            <div class="sz-diag">
                <div class="sz-diag-icon">⚠</div>
                <div class="sz-diag-title">Módulos não carregaram</div>
                <div class="sz-diag-sub">Base consultada:</div>
                <code class="sz-diag-base">${esc(d.base)}</code>
                <div class="sz-diag-list">${rows || '<div class="sz-diag-row">sem dados</div>'}</div>
                <div class="sz-diag-hint">
                    Ausentes: <b>${esc(missingTxt)}</b><br>
                    Abra o console (F12) → aba Network → filtre por <b>sangzap</b> e veja o status HTTP.
                </div>
                <button class="sz-btn sz-btn-primary" id="szDiagRetry" type="button">Tentar de novo</button>
            </div>
        `;
        body.querySelector('#szDiagRetry')?.addEventListener('click', () => {
            _loadPromise = null;
            _moduleLoaded = false;
            _loadFailed = false;
            _moduleDiagnostic = null;
            render();
        });
    }

    function renderStub(body, title, sub) {
        body.innerHTML = `
            <div class="sz-stub">
                <div class="sz-stub-icon">💬</div>
                <div class="sz-stub-title">${esc(title)}</div>
                <div class="sz-stub-sub">${esc(sub || '')}</div>
            </div>
        `;
    }

    // ═══ ROSTER ═══
    function renderRoster(body) {
        body.innerHTML = `
            <div class="sz-roster">
                <div class="sz-roster-head">
                    <div class="sz-search-wrap">
                        <input class="sz-search" id="szSearch" type="text" placeholder="Buscar…" value="${esc(_state.searchQuery)}" autocomplete="off" spellcheck="false" />
                    </div>
                    <button class="sz-new-btn" id="szNew" title="Nova conversa">+</button>
                </div>
                <div class="sz-chips" id="szChips">
                    <button class="sz-chip${_state.rosterChip === 'all' ? ' on' : ''}" data-chip="all">Todas</button>
                    <button class="sz-chip${_state.rosterChip === 'unread' ? ' on' : ''}" data-chip="unread">Não lidas <span class="sz-chip-n" data-n="unread">0</span></button>
                    <button class="sz-chip${_state.rosterChip === 'groups' ? ' on' : ''}" data-chip="groups">Grupos <span class="sz-chip-n" data-n="groups">0</span></button>
                    <button class="sz-chip${_state.rosterChip === 'archived' ? ' on' : ''}" data-chip="archived">Arquivadas <span class="sz-chip-n" data-n="archived">0</span></button>
                </div>
                <div class="sz-roster-list" id="szRosterList"><div class="sz-empty">Carregando…</div></div>
            </div>
        `;

        body.querySelector('#szNew')?.addEventListener('click', openNewChatPicker);
        const searchEl = body.querySelector('#szSearch');
        const chips = body.querySelector('#szChips');
        const list = body.querySelector('#szRosterList');
        if (!searchEl || !chips || !list) return;

        searchEl.addEventListener('input', () => {
            _state.searchQuery = searchEl.value;
            repaint();
        });
        chips.addEventListener('click', (e) => {
            const b = e.target.closest('.sz-chip');
            if (!b) return;
            _state.rosterChip = b.dataset.chip;
            chips.querySelectorAll('.sz-chip').forEach(c => c.classList.toggle('on', c === b));
            repaint();
        });

        function updateCounts(counts) {
            _state.rosterCounts = counts || _state.rosterCounts;
            chips.querySelectorAll('.sz-chip-n').forEach(el => {
                const k = el.dataset.n;
                const n = _state.rosterCounts[k] || 0;
                el.textContent = n > 99 ? '99+' : String(n);
                el.style.display = n > 0 ? '' : 'none';
            });
        }

        function repaint() {
            const opts = {
                query: _state.searchQuery,
                chip: _state.rosterChip === 'archived' ? 'all' : _state.rosterChip,
                includeArchived: _state.rosterChip === 'archived'
            };
            const sections = S?.roster?.sections
                ? S.roster.sections(opts)
                : [{ id: 'main', title: '', items: [] }];
            _state.rosterSections = sections;
            paint(sections);
        }

        function paint(sections) {
            const flat = sections.flatMap(s => s.items);
            if (!flat.length) {
                list.innerHTML = `<div class="sz-empty">${_state.searchQuery ? 'Nada encontrado.' : (S?.roster ? 'Sem contatos. Adicione no telefone.' : 'Módulo indisponível.')}</div>`;
                refreshAppBadge(0);
                return;
            }
            let totalUnread = 0;
            const html = sections.map(sec => {
                const items = sec.items.map(c => {
                    if (!c || !c.chatId) return '';
                    const unread = c.muted ? 0 : (c.unread || 0);
                    totalUnread += unread;
                    const isGroup = c.kind === 'group';
                    const online = !isGroup && c.online;
                    const title = c.title || shortNum(c.number || '');
                    const initial = (title || '?').trim()[0]?.toUpperCase() || '?';
                    const avatar = c.avatar
                        ? `<img src="${esc(c.avatar)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${esc(initial)}'))" />`
                        : `<span class="sz-av-fallback">${esc(initial)}</span>`;
                    const dot = online ? `<span class="sz-online-dot" title="Online"></span>` : '';
                    const pin = c.pinned ? `<span class="sz-pin" title="Fixado">📌</span>` : '';
                    const mute = c.muted ? `<span class="sz-mute" title="Silenciado">🔇</span>` : '';

                    let previewHtml = '';
                    if (S?.roster?.previewParts) {
                        const parts = S.roster.previewParts(c);
                        if (parts.kind === 'typing') {
                            previewHtml = `<span class="sz-item-preview sz-item-typing">${esc(parts.text)}</span>`;
                        } else {
                            const recado = c.recado && !c.lastMessage;
                            previewHtml = `<span class="sz-item-preview${recado ? ' sz-item-recado' : ''}">${parts.icon ? esc(parts.icon) + ' ' : ''}${esc(parts.text || (isGroup ? '' : 'Toque para conversar'))}</span>`;
                        }
                    } else {
                        previewHtml = `<span class="sz-item-preview">${esc(c.lastMessage || (isGroup ? '' : c.recado || 'Toque para conversar'))}</span>`;
                    }
                    const timeTxt = c.lastMessageAt
                        ? fmtRelative(c.lastMessageAt)
                        : (online ? 'online' : (c.lastSeen ? timeAgo(c.lastSeen) : ''));

                    return `
                        <button class="sz-item" data-chat="${esc(c.chatId)}" data-num="${esc(c.number || '')}" type="button">
                            <div class="sz-avatar">${avatar}${dot}</div>
                            <div class="sz-item-body">
                                <div class="sz-item-top">
                                    <span class="sz-item-title">${pin}${esc(title)}${mute}</span>
                                    <span class="sz-item-time">${esc(timeTxt)}</span>
                                </div>
                                <div class="sz-item-bot">
                                    ${previewHtml}
                                    ${unread ? `<span class="sz-item-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
                                </div>
                            </div>
                        </button>
                    `;
                }).filter(Boolean).join('');
                return sec.title
                    ? `<div class="sz-roster-section-title">${esc(sec.title)}</div>${items}`
                    : items;
            }).join('');
            list.innerHTML = html;
            refreshAppBadge(totalUnread);

            list.querySelectorAll('.sz-item').forEach(btn => {
                const entry = flat.find(x => x.chatId === btn.dataset.chat);
                if (!entry) return;
                let lpTimer = null, lpFired = false;
                btn.addEventListener('click', () => {
                    if (lpFired) { lpFired = false; return; }
                    openChat(entry.chatId, entry);
                });
                btn.addEventListener('contextmenu', (ev) => {
                    ev.preventDefault();
                    openContextMenu(entry);
                });
                btn.addEventListener('pointerdown', (ev) => {
                    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
                    lpFired = false;
                    lpTimer = setTimeout(() => { lpFired = true; openContextMenu(entry); }, 550);
                });
                ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt =>
                    btn.addEventListener(evt, () => {
                        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
                    })
                );
            });
        }

        if (S?.roster?.start && !_rosterStarted) {
            _rosterStarted = true;
            S.roster.start(_state.myNumber, (entries, counts) => {
                if (!_state.mounted) return;
                updateCounts(counts);
                repaint();
            });
            setTimeout(() => updateCounts(S.roster.counts?.()), 60);
        } else if (S?.roster?.counts) {
            updateCounts(S.roster.counts());
        }
        repaint();
    }

    function openContextMenu(entry) {
        const body = _state.root?.querySelector('#szBody');
        if (!body) return;
        const menu = document.createElement('div');
        menu.className = 'sz-ctx-menu sz-ctx-center';
        menu.innerHTML = `
            <button class="sz-ctx-item" data-act="pin">${entry.pinned ? 'Desafixar' : 'Fixar'}</button>
            <button class="sz-ctx-item" data-act="mute">${entry.muted ? 'Ativar som' : 'Silenciar'}</button>
            <button class="sz-ctx-item" data-act="archive">${entry.archived ? 'Restaurar' : 'Arquivar'}</button>
        `;
        body.appendChild(menu);
        const close = () => { try { menu.remove(); } catch(_) {} };
        setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
        menu.querySelectorAll('.sz-ctx-item').forEach(btn => {
            btn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const act = btn.dataset.act;
                try {
                    if (act === 'pin' && S?.roster?.pin) await S.roster.pin(entry.chatId, !entry.pinned);
                    if (act === 'mute' && S?.roster?.mute) await S.roster.mute(entry.chatId, !entry.muted);
                    if (act === 'archive' && S?.roster?.archive) await S.roster.archive(entry.chatId, !entry.archived);
                } catch(_) {}
                close();
            });
        });
    }

    // ═══ NEW CHAT / GROUP ═══
    function openNewChatPicker() {
        const contacts = S?.getContacts?.() || [];
        const body = _state.root?.querySelector('#szBody');
        if (!body) return;
        const modal = document.createElement('div');
        modal.className = 'sz-modal';
        modal.innerHTML = `
            <div class="sz-modal-card">
                <div class="sz-modal-title">Nova conversa</div>
                <div class="sz-modal-list">
                    ${contacts.length ? contacts.map(c => {
                        const n = c?.number || c?.num;
                        if (!n || n === _state.myNumber) return '';
                        const name = c.name || shortNum(n);
                        const initial = (name || '?')[0].toUpperCase();
                        return `<button class="sz-item sz-pick" data-num="${esc(n)}" type="button">
                            <div class="sz-avatar"><span class="sz-av-fallback">${esc(initial)}</span></div>
                            <div class="sz-item-body">
                                <div class="sz-item-title">${esc(name)}</div>
                                <div class="sz-item-preview">${esc(shortNum(n))}</div>
                            </div>
                        </button>`;
                    }).join('') : `<div class="sz-empty">Sem contatos no telefone.</div>`}
                </div>
                <button class="sz-btn ghost" id="szNewGroupBtn" type="button">Novo grupo</button>
                <button class="sz-modal-cancel" id="szPickCancel" type="button">Cancelar</button>
            </div>
        `;
        body.appendChild(modal);

        modal.querySelector('#szPickCancel')?.addEventListener('click', () => modal.remove());
        modal.querySelector('#szNewGroupBtn')?.addEventListener('click', () => {
            modal.remove();
            openGroupPicker();
        });
        modal.querySelectorAll('.sz-pick').forEach(btn => {
            btn.addEventListener('click', async () => {
                const num = btn.dataset.num;
                if (!num || num === _state.myNumber) return;
                const chatId = chatIdFor(_state.myNumber, num);
                modal.remove();
                // chat.js (via S.chat.open → ensureChatDoc) garante a criação do doc.
                openChat(chatId, { chatId, kind: '1:1', number: num, title: shortNum(num) });
            });
        });
    }

    function openGroupPicker() {
        const contacts = S?.getContacts?.() || [];
        const sel = new Set();
        const body = _state.root?.querySelector('#szBody');
        if (!body) return;
        const m = document.createElement('div');
        m.className = 'sz-modal';
        m.innerHTML = `
            <div class="sz-modal-card">
                <div class="sz-modal-title">Novo grupo</div>
                <div class="sz-modal-body">
                    <input class="sz-input" id="szGroupName" placeholder="Nome do grupo" maxlength="40" />
                </div>
                <div class="sz-modal-list">
                    ${contacts.map(c => {
                        const n = c?.number || c?.num;
                        if (!n || n === _state.myNumber) return '';
                        const name = c.name || shortNum(n);
                        const initial = (name || '?')[0].toUpperCase();
                        return `<button class="sz-item sz-gpick" data-num="${esc(n)}" type="button">
                            <div class="sz-avatar"><span class="sz-av-fallback">${esc(initial)}</span></div>
                            <div class="sz-item-body"><div class="sz-item-title">${esc(name)}</div></div>
                            <span class="sz-check">○</span>
                        </button>`;
                    }).join('')}
                </div>
                <div class="sz-modal-actions">
                    <button class="sz-btn" id="szGCancel" type="button">Cancelar</button>
                    <button class="sz-btn sz-btn-primary" id="szGCreate" type="button">Criar</button>
                </div>
            </div>
        `;
        body.appendChild(m);

        m.querySelectorAll('.sz-gpick').forEach(btn => {
            btn.addEventListener('click', () => {
                const n = btn.dataset.num;
                if (sel.has(n)) sel.delete(n); else sel.add(n);
                btn.classList.toggle('selected', sel.has(n));
                const chk = btn.querySelector('.sz-check');
                if (chk) chk.textContent = sel.has(n) ? '●' : '○';
            });
        });
        m.querySelector('#szGCancel')?.addEventListener('click', () => m.remove());
        m.querySelector('#szGCreate')?.addEventListener('click', async () => {
            const name = (m.querySelector('#szGroupName')?.value || '').trim() || 'Grupo';
            if (sel.size < 2) { ctx.toast?.('Escolha 2+ contatos', 'err'); return; }
            try {
                if (!S?.groups?.create) throw new Error('sem groups');
                const chat = await S.groups.create(name, [...sel]);
                m.remove();
                ctx.toast?.('Grupo criado', 'ok');
                openChat(chat.id, { chatId: chat.id, kind: 'group', title: chat.name, members: chat.members });
            } catch(e) { ctx.toast?.('Falha ao criar grupo', 'err'); }
        });
    }

    // ═══ CHAT ═══
    function openChat(chatId, meta) {
        _state.activeChatId = chatId;
        _state.chatMeta = meta || {};
        historyPush();
        render();
    }
    function closeChat(fromUI) {
        if (fromUI !== false) { historyExit(); return; }
        try { _micCleanup?.(); } catch(_) {}
        _micCleanup = null;
        try { S?.chat?.close?.(); } catch(_) {}
        try { S?.audio?.clearCache?.(); } catch(_) {}
        _state.activeChatId = null;
        _state.chatMeta = null;
        render();
    }

    function renderChat(body) {
        const meta = _state.chatMeta || {};

        const host = document.createElement('div');
        host.className = 'sz-chat-host';
        body.appendChild(host);

        const chatMeta = {
            chatId: _state.activeChatId,
            kind: meta.kind || '1:1',
            number: meta.number || '',
            title: meta.title || '',
            members: meta.members || (meta.number ? [_state.myNumber, meta.number] : [_state.myNumber]),
            myName: _state.myName || '',
            nameFor: nameForNumber,
            onForward: (msg) => {
                ctx.toast?.('Encaminhar: escolha o destino', 'info');
            },
            onForwardMany: (list) => {
                ctx.toast?.(`${list.length} mensagens prontas`, 'info');
            },
            onOpenChat: (num) => {
                if (!num) return;
                const cid = chatIdFor(_state.myNumber, num);
                openChat(cid, { chatId: cid, kind: '1:1', number: num, title: shortNum(num) });
            }
        };

        if (S?.chat?.open) {
            try { S.chat.open(_state.activeChatId, _state.myNumber, chatMeta, host); }
            catch(e) {
                console.warn('[Sangzap] chat.open:', e);
                renderStub(body, 'Erro', 'Chat indisponível.');
                return;
            }
        } else {
            renderStub(body, 'Chat indisponível', 'Recarregue o telefone.');
            return;
        }

        setTimeout(bindMicGesture, 40);
    }

    // ═══ NAME RESOLVER ═══
    const _nameCache = new Map();
    function nameForNumber(num) {
        if (!num) return '';
        if (num === _state.myNumber) return _state.myName || 'Você';
        if (_nameCache.has(num)) return _nameCache.get(num);
        try {
            const entry = S?.roster?.getEntry?.(chatIdFor(_state.myNumber, num)) ||
                          S?.roster?.all?.()?.find(x => x.number === num);
            if (entry?.title) { _nameCache.set(num, entry.title); return entry.title; }
        } catch(_) {}
        const contacts = S?.getContacts?.() || [];
        const c = contacts.find(x => (x.number || x.num) === num);
        if (c?.name) { _nameCache.set(num, c.name); return c.name; }
        return shortNum(num);
    }

    // ═══ MIC GESTURE (integra audio v2) ═══
    function bindMicGesture() {
        const host = _state.root?.querySelector('.sz-chat-host');
        if (!host) return;

        let mic = host.querySelector('[data-act="mic"], .sz-mic-btn');
        if (!mic) {
            const bar = host.querySelector('.sz-input-bar');
            if (!bar) return;
            mic = document.createElement('button');
            mic.className = 'sz-mic-btn';
            mic.type = 'button';
            mic.setAttribute('aria-label', 'Gravar áudio');
            mic.innerHTML = '🎤';
            bar.insertBefore(mic, bar.querySelector('.sz-send-btn') || null);
        }

        if (!S?.audio?.startGesture) {
            mic.addEventListener('click', () => ctx.toast?.('Áudio indisponível', 'err'));
            return;
        }

        const rec = S.audio.startGesture({
            trigger: mic,
            onState: (state, m) => {
                mic.classList.toggle('rec', state === 'rec');
                mic.classList.toggle('cancel', state === 'cancel');
                mic.classList.toggle('locked', state === 'locked' || state === 'paused');
                mic.classList.toggle('paused', state === 'paused');
            },
            onDone: (payload) => {
                try { S.chat?.sendAudio?.(payload); } catch(_) {}
            },
            onCancel: () => {},
            onError: (msg) => ctx.toast?.(msg, 'err'),
            onLevel: () => {}
        });
        if (rec && typeof rec.destroy === 'function') {
            _micCleanup = () => { try { rec.destroy(); } catch(_) {} };
        } else {
            _micCleanup = () => {};
        }
    }

    // ═══ DEEP-LINK / PENDING DATA ═══
    function handleOpenWithData(data) {
        if (!data) return;
        if (data.kind === 'chat' && data.chatId) {
            openChat(data.chatId, data.meta || {
                chatId: data.chatId,
                kind: data.meta?.kind || (data.meta?.number ? '1:1' : 'group'),
                number: data.number || '',
                title: data.title || ''
            });
        } else if (data.kind === 'story' && data.author) {
            _state.activeTab = 'stories';
            _state.activeChatId = null;
            render();
        }
    }

    // ═══ APP REGISTRATION ═══
    ctx.apps.register({
        id: APP_ID,
        name: 'Sangzap',
        icon: ICON,
        accent: '#25d366',
        bg: 'linear-gradient(135deg, #25d366, #128c7e)',
        appBg: DEFAULT_APP_BG,
        order: 5,
        dock: true,
        get badge() { return _unreadTotal || 0; },

        onOpenWithData(data) {
            if (!_state.mounted) { _state.pendingOpen = data; return; }
            handleOpenWithData(data);
        },

        async mount(root, appCtx) {
            if (!root) { console.warn('[Sangzap] mount sem root'); return; }
            if (_state.mounted) { try { this.unmount(); } catch(_) {} }

            _state.root = root;
            _state.myNumber = appCtx?.myNumber || ctx.myNumber || '';
            _state.screenEl = appCtx?.screenEl || ctx.screenEl || null;
            _state.appBg = appCtx?.appBg || ctx.appBg || DEFAULT_APP_BG;
            _state.activeTab = 'chats';
            _state.activeChatId = null;
            _state.chatMeta = null;
            _state.searchQuery = '';
            _state.rosterChip = 'all';
            _state.mounted = true;
            _state.destroyed = false;
            _state.online = navigator.onLine !== false;
            _nameCache.clear();

            hidePhoneBar();
            applyAppBg();
            bindHistory();
            bindConnection();

            root.style.position = 'relative';
            root.style.height = '100%';
            root.style.minHeight = '0';
            root.style.overflow = 'hidden';
            root.style.display = 'block';

            root.innerHTML = `
                <div class="sz-app">
                    <div class="sz-conn-bar"></div>
                    <header class="sz-hdr">
                        <button class="sz-hdr-back" aria-label="Voltar">${ctx.I?.back || '←'}</button>
                        <div class="sz-hdr-title">SANGZAP</div>
                    </header>
                    <div class="sz-body">
                        <div class="sz-skeleton">
                            <div class="sz-skel-row"><div class="sz-skel-av"></div><div class="sz-skel-lines"><div class="sz-skel-line w70"></div><div class="sz-skel-line w40"></div></div></div>
                            <div class="sz-skel-row"><div class="sz-skel-av"></div><div class="sz-skel-lines"><div class="sz-skel-line w55"></div><div class="sz-skel-line w30"></div></div></div>
                            <div class="sz-skel-row"><div class="sz-skel-av"></div><div class="sz-skel-lines"><div class="sz-skel-line w80"></div><div class="sz-skel-line w45"></div></div></div>
                            <div class="sz-skel-row"><div class="sz-skel-av"></div><div class="sz-skel-lines"><div class="sz-skel-line w60"></div><div class="sz-skel-line w35"></div></div></div>
                        </div>
                    </div>
                </div>
            `;

            await loadModules();
            if (_state.destroyed) return;
            bindS();

            try {
                if (S?.settings?.get && _state.myNumber) {
                    const prof = await S.settings.get(_state.myNumber);
                    if (prof?.displayName) _state.myName = prof.displayName;
                    if (prof?.theme) _state.screenEl?.setAttribute?.('data-sz-theme', prof.theme);
                }
            } catch(_) {}
            if (_state.destroyed) return;

            historyPush();
            render();

            if (_state.pendingOpen) {
                const p = _state.pendingOpen;
                _state.pendingOpen = null;
                handleOpenWithData(p);
            }
        },

        unmount() {
            _state.mounted = false;
            _state.destroyed = true;
            _rosterStarted = false;
            showPhoneBar();
            try { _micCleanup?.(); } catch(_) {}
            _micCleanup = null;
            try { S?.roster?.stop?.(); } catch(_) {}
            try { S?.chat?.close?.(); } catch(_) {}
            try { S?.stories?.stop?.(); } catch(_) {}
            try { S?.audio?.cancel?.(); } catch(_) {}
            try { S?.audio?.clearCache?.(); } catch(_) {}
            try {
                _state.root?.querySelectorAll('audio,video').forEach(el => {
                    try { el.pause(); } catch(_) {}
                });
            } catch(_) {}
            _state.root = null;
            _state.chatMeta = null;
            _state.activeChatId = null;
            _histPushed = false;
        }
    });

    // ═══ CSS ═══
    ctx.appendStyle(`
        :host { --sz-accent: #25d366; --sz-accent2: #128c7e; --sz-app-bg: ${DEFAULT_APP_BG}; }
        [data-sz-theme="roxo"] { --sz-accent: #a78bfa; --sz-accent2: #7c3aed; }
        [data-sz-theme="azul"] { --sz-accent: #38bdf8; --sz-accent2: #0284c7; }
        .ph-screen.sz-hide-bar .ph-app-bar { display: none !important; }

        .sz-app {
            position: absolute; inset: 0;
            display: flex; flex-direction: column;
            min-height: 0; overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #e9ecf5;
            background: var(--sz-app-bg, #0e1621);
            transition: background .22s ease;
        }
        .sz-app.sz-settings-mode { background: #0b0f14; }
        .sz-app.sz-settings-mode .sz-hdr { background: rgba(255,255,255,.02); }

        /* ═══ SCROLLBAR ═══ */
        .sz-thread,
        .sz-roster-list,
        .sz-stories-list,
        .sz-settings,
        .sz-modal-list,
        .sz-pick-contact-list,
        .sz-chat-opts-list,
        .sz-mention-pop,
        .sz-viewers-list {
            scrollbar-width: none;
            -ms-overflow-style: none;
        }
        .sz-thread::-webkit-scrollbar,
        .sz-roster-list::-webkit-scrollbar,
        .sz-stories-list::-webkit-scrollbar,
        .sz-settings::-webkit-scrollbar,
        .sz-modal-list::-webkit-scrollbar,
        .sz-pick-contact-list::-webkit-scrollbar,
        .sz-chat-opts-list::-webkit-scrollbar,
        .sz-mention-pop::-webkit-scrollbar,
        .sz-viewers-list::-webkit-scrollbar {
            width: 0; height: 0; display: none;
        }

        /* ═══ CONN BAR ═══ */
        .sz-conn-bar {
            display: none; padding: 5px 12px;
            background: #b45309; color: #fff;
            font-size: 10.5px; font-weight: 700;
            text-align: center; letter-spacing: .02em;
            animation: szFadeIn .2s ease;
            flex-shrink: 0;
        }
        .sz-conn-bar.on { display: block; }

        /* ═══ HEADER DO APP ═══ */
        .sz-hdr {
            display: flex; align-items: center; gap: 6px;
            padding: 6px 10px;
            background: linear-gradient(180deg, rgba(255,255,255,.02), transparent);
            border-bottom: 1px solid rgba(255,255,255,.04);
            flex-shrink: 0;
        }
        .sz-hdr-back, .sz-hdr-gear, .sz-hdr-call {
            width: 28px; height: 28px; flex-shrink: 0;
            border-radius: 8px;
            background: rgba(255,255,255,.04);
            border: 1px solid rgba(255,255,255,.06);
            color: #c7cad6; cursor: pointer; padding: 0;
            display: flex; align-items: center; justify-content: center;
            transition: background .16s, color .16s, border-color .16s;
            font-size: 13px;
        }
        .sz-hdr-back svg { width: 12px; height: 12px; }
        .sz-hdr-back:hover, .sz-hdr-gear:hover, .sz-hdr-call:hover {
            background: rgba(37,211,102,.12);
            color: #86efac;
            border-color: rgba(37,211,102,.28);
        }
        .sz-hdr-back:active, .sz-hdr-gear:active, .sz-hdr-call:active { transform: scale(.94); }
        .sz-hdr-title {
            flex: 1;
            font-size: 12px; font-weight: 800; letter-spacing: .1em;
            background: linear-gradient(100deg, var(--sz-accent), #22d3ee, var(--sz-accent));
            background-size: 220% auto;
            -webkit-background-clip: text; background-clip: text; color: transparent;
            animation: szBlink 3.2s ease-in-out infinite;
            text-transform: uppercase;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .sz-hdr-call { font-size: 14px; }

        /* ═══ CHAT IDENT (avatar + nome + subtítulo clicável) ═══ */
        .sz-chat-ident {
            flex: 1; min-width: 0;
            display: flex; align-items: center; gap: 9px;
            background: transparent; border: none; cursor: pointer;
            padding: 2px 6px; border-radius: 10px;
            transition: background .16s;
            font-family: inherit; text-align: left;
        }
        .sz-chat-ident:hover { background: rgba(255,255,255,.04); }
        .sz-chat-ident:active { background: rgba(255,255,255,.07); }
        .sz-chat-ident-av {
            width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            display: flex; align-items: center; justify-content: center;
            overflow: hidden; color: #fff; font-weight: 800; font-size: 12px;
            border: 1px solid rgba(255,255,255,.06);
        }
        .sz-chat-ident-av img { width: 100%; height: 100%; object-fit: cover; }
        .sz-chat-ident-info {
            flex: 1; min-width: 0;
            display: flex; flex-direction: column; gap: 0;
        }
        .sz-chat-ident-name {
            font-size: 12px; font-weight: 700; color: #e9ecf5; line-height: 1.15;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .sz-chat-ident-sub {
            font-size: 9.5px; color: #8a90a8; line-height: 1.15;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        /* ═══ BOTTOM SHEET DE OPÇÕES ═══ */
        .sz-chat-opts {
            position: absolute; inset: 0; z-index: 25;
            background: rgba(0,0,0,.55);
            backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            display: flex; align-items: flex-end; justify-content: center;
            animation: szFadeIn .18s ease;
        }
        .sz-chat-opts-card {
            width: 100%; max-height: 72%;
            background: linear-gradient(180deg, #131a24, #0b1218);
            border-top-left-radius: 18px; border-top-right-radius: 18px;
            border-top: 1px solid rgba(255,255,255,.08);
            padding: 14px 0 18px;
            display: flex; flex-direction: column;
            animation: szSlideUp .24s cubic-bezier(.22,1,.36,1);
        }
        .sz-chat-opts-hdr {
            display: flex; align-items: center; gap: 12px;
            padding: 0 16px 14px;
            border-bottom: 1px solid rgba(255,255,255,.05);
        }
        .sz-chat-opts-hdr-av {
            width: 46px; height: 46px; border-radius: 50%; flex-shrink: 0;
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            display: flex; align-items: center; justify-content: center;
            overflow: hidden; color: #fff; font-weight: 800; font-size: 18px;
            border: 1px solid rgba(255,255,255,.06);
        }
        .sz-chat-opts-hdr-av img { width: 100%; height: 100%; object-fit: cover; }
        .sz-chat-opts-hdr-info { flex: 1; min-width: 0; }
        .sz-chat-opts-hdr-name {
            font-size: 14px; font-weight: 800; color: #e9ecf5;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .sz-chat-opts-hdr-num {
            font-size: 11px; color: #86efac; margin-top: 2px;
            letter-spacing: .04em;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .sz-chat-opts-list { padding: 8px; overflow-y: auto; }
        .sz-chat-opt {
            display: flex; align-items: center; gap: 12px;
            width: 100%; padding: 11px 12px;
            background: transparent; border: none; cursor: pointer;
            color: #e9ecf5; font-family: inherit;
            font-size: 12.5px; font-weight: 600; text-align: left;
            border-radius: 10px;
            transition: background .14s;
        }
        .sz-chat-opt:hover { background: rgba(255,255,255,.05); }
        .sz-chat-opt:active { background: rgba(255,255,255,.08); }
        .sz-chat-opt svg { width: 16px; height: 16px; flex-shrink: 0; color: #8a90a8; }
        .sz-chat-opt.danger { color: #fca5b1; }
        .sz-chat-opt.danger svg { color: #fca5b1; }

        /* ═══ TABS ═══ */
        .sz-tabs {
            display: grid; grid-template-columns: repeat(2, 1fr);
            border-bottom: 1px solid rgba(255,255,255,.04);
            background: rgba(0,0,0,.15);
            flex-shrink: 0;
        }
        .sz-tab {
            padding: 10px 4px; font-size: 11px; font-weight: 700;
            color: #8a90a8; background: transparent; border: none; cursor: pointer;
            font-family: inherit; position: relative;
            transition: color .16s, background .16s;
        }
        .sz-tab:hover { color: #d1d5db; background: rgba(255,255,255,.03); }
        .sz-tab.active { color: var(--sz-accent); }
        .sz-tab.active::after {
            content: ''; position: absolute; bottom: 0; left: 30%; right: 30%;
            height: 2px; background: linear-gradient(90deg, var(--sz-accent), #22d3ee);
            border-radius: 2px 2px 0 0;
        }

        .sz-body {
            flex: 1 1 auto; min-height: 0; overflow: hidden;
            display: flex; flex-direction: column; position: relative;
        }

        /* ═══ SKELETON ═══ */
        .sz-skeleton { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
        .sz-skel-row { display: flex; align-items: center; gap: 11px; padding: 4px 0; }
        .sz-skel-av {
            width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
            background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.09), rgba(255,255,255,.04));
            background-size: 200% 100%;
            animation: szSkel 1.4s ease-in-out infinite;
        }
        .sz-skel-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
        .sz-skel-line {
            height: 10px; border-radius: 5px;
            background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.09), rgba(255,255,255,.04));
            background-size: 200% 100%;
            animation: szSkel 1.4s ease-in-out infinite;
        }
        .sz-skel-line.w70 { width: 70%; }
        .sz-skel-line.w55 { width: 55%; }
        .sz-skel-line.w80 { width: 80%; }
        .sz-skel-line.w60 { width: 60%; }
        .sz-skel-line.w40 { width: 40%; }
        .sz-skel-line.w30 { width: 30%; }
        .sz-skel-line.w45 { width: 45%; }
        .sz-skel-line.w35 { width: 35%; }

        /* ═══ STUB / DIAGNÓSTICO ═══ */
        .sz-stub {
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 8px; padding: 32px; text-align: center;
        }
        .sz-stub-icon { font-size: 38px; opacity: .35; margin-bottom: 6px; }
        .sz-stub-title { font-size: 15px; font-weight: 800; color: #e9ecf5; }
        .sz-stub-sub { font-size: 11px; color: #6b7280; line-height: 1.5; max-width: 240px; }

        .sz-diag { padding: 24px 18px; display: flex; flex-direction: column; gap: 12px; }
        .sz-diag-icon { font-size: 34px; text-align: center; opacity: .8; }
        .sz-diag-title { font-size: 14px; font-weight: 800; color: #fca5b1; text-align: center; }
        .sz-diag-sub { font-size: 10px; color: #8a90a8; letter-spacing: .05em; text-transform: uppercase; }
        .sz-diag-base { font-family: ui-monospace, Menlo, monospace; font-size: 9.5px; color: #86efac;
            background: rgba(255,255,255,.04); padding: 6px 8px; border-radius: 6px; word-break: break-all; }
        .sz-diag-list { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
        .sz-diag-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px;
            background: rgba(255,255,255,.03); border-radius: 6px; font-size: 11px; }
        .sz-diag-row.ok .sz-diag-ico { color: #86efac; }
        .sz-diag-row.fail { background: rgba(251,113,133,.08); }
        .sz-diag-row.fail .sz-diag-ico { color: #fca5b1; }
        .sz-diag-ico { font-weight: 800; width: 14px; text-align: center; }
        .sz-diag-file { flex: 1; color: #e9ecf5; font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; }
        .sz-diag-status { font-size: 9.5px; color: #8a90a8; }
        .sz-diag-hint { font-size: 10px; color: #8a90a8; line-height: 1.5; margin-top: 6px; }
        .sz-diag-hint b { color: #86efac; }

        /* ═══ ROSTER ═══ */
        .sz-roster { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .sz-roster-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px 6px; flex-shrink: 0; }
        .sz-search-wrap { flex: 1; min-width: 0; }
        .sz-search {
            width: 100%; padding: 8px 14px; border-radius: 20px;
            background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.06);
            color: #e9ecf5; font-family: inherit; font-size: 11.5px; outline: none;
            box-sizing: border-box;
            transition: border-color .16s, background .16s, box-shadow .16s;
        }
        .sz-search::placeholder { color: #5c6280; }
        .sz-search:focus { border-color: rgba(37,211,102,.45); background: rgba(255,255,255,.07); box-shadow: 0 0 0 3px rgba(37,211,102,.1); }

        .sz-new-btn {
            width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            border: none; color: #fff; font-size: 18px; font-weight: 700;
            cursor: pointer; line-height: 1;
            box-shadow: 0 3px 10px rgba(37,211,102,.3);
            transition: transform .16s cubic-bezier(.22,1,.36,1);
        }
        .sz-new-btn:hover { transform: scale(1.05); }
        .sz-new-btn:active { transform: scale(.94); }

        .sz-chips {
            display: flex; gap: 6px; padding: 0 12px 8px; flex-shrink: 0;
            overflow-x: auto; scrollbar-width: none;
        }
        .sz-chips::-webkit-scrollbar { display: none; }
        .sz-chip {
            flex-shrink: 0;
            padding: 6px 11px; border-radius: 14px;
            background: rgba(255,255,255,.04);
            border: 1px solid rgba(255,255,255,.06);
            color: #b4bac8; font-family: inherit; font-size: 10.5px; font-weight: 700;
            cursor: pointer;
            display: flex; align-items: center; gap: 5px;
            transition: background .14s, border-color .14s, color .14s;
        }
        .sz-chip:hover { background: rgba(255,255,255,.07); }
        .sz-chip.on {
            background: rgba(37,211,102,.12);
            border-color: rgba(37,211,102,.35);
            color: var(--sz-accent);
        }
        .sz-chip-n {
            display: inline-block;
            min-width: 16px; height: 16px; padding: 0 5px;
            border-radius: 8px;
            background: rgba(255,255,255,.14); color: #e9ecf5;
            font-size: 9px; font-weight: 800; line-height: 16px; text-align: center;
        }
        .sz-chip.on .sz-chip-n { background: var(--sz-accent); color: #06280f; }

        .sz-roster-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 8px 12px; }
        .sz-roster-section-title {
            font-size: 9.5px; font-weight: 800; letter-spacing: .12em;
            text-transform: uppercase; color: #6b7280;
            padding: 10px 10px 6px;
        }

        .sz-item {
            display: flex; align-items: center; gap: 11px;
            width: 100%; padding: 9px 10px;
            background: transparent; border: none; cursor: pointer;
            font-family: inherit; color: inherit; text-align: left;
            border-radius: 12px;
            transition: background .14s;
            -webkit-tap-highlight-color: transparent;
        }
        .sz-item:hover { background: rgba(255,255,255,.04); }
        .sz-item:active { background: rgba(255,255,255,.07); }

        .sz-avatar {
            position: relative;
            width: 44px; height: 44px; flex-shrink: 0;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            display: flex; align-items: center; justify-content: center;
            border: 1px solid rgba(255,255,255,.06);
            overflow: hidden;
        }
        .sz-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
        .sz-av-fallback { font-size: 17px; font-weight: 800; color: #fff; }
        .sz-online-dot {
            position: absolute; right: -2px; bottom: -2px;
            width: 12px; height: 12px; border-radius: 50%;
            background: #22c55e; border: 2px solid var(--sz-app-bg, #0e1621);
            box-shadow: 0 0 6px rgba(34,197,94,.6);
            animation: szPulse 2s ease-in-out infinite;
        }
        .sz-avatar-lg { width: 84px; height: 84px; }
        .sz-avatar-sm { width: 30px; height: 30px; }
        .sz-avatar-sm .sz-av-fallback { font-size: 12px; }

        .sz-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .sz-item-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
        .sz-item-title { font-size: 12.5px; font-weight: 700; color: #e9ecf5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sz-item-time { font-size: 9.5px; color: #6b7280; flex-shrink: 0; font-variant-numeric: tabular-nums; }
        .sz-item-bot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .sz-item-preview { font-size: 11px; color: #8a90a8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
        .sz-item-recado { color: #86efac; font-style: italic; }
        .sz-item-typing { color: var(--sz-accent); font-style: italic; }
        .sz-item-badge {
            min-width: 18px; height: 18px; padding: 0 6px;
            border-radius: 9px; background: var(--sz-accent); color: #06280f;
            font-size: 10px; font-weight: 800; line-height: 18px; text-align: center;
            flex-shrink: 0;
        }
        .sz-pin, .sz-mute { font-size: 10px; margin-right: 4px; opacity: .75; }

        .sz-empty { padding: 32px 16px; text-align: center; font-size: 11.5px; color: #6b7280; line-height: 1.6; }
        .sz-empty b { color: var(--sz-accent); }

        /* ═══ CONTEXT MENU ═══ */
        .sz-ctx-menu {
            position: absolute; z-index: 40;
            background: #1a222d; border: 1px solid rgba(255,255,255,.1);
            border-radius: 12px; padding: 5px;
            box-shadow: 0 12px 32px rgba(0,0,0,.65);
            min-width: 150px;
            animation: szFadeIn .16s ease;
        }
        .sz-ctx-menu.sz-ctx-center { top: 50%; left: 50%; transform: translate(-50%, -50%); }
        .sz-ctx-item {
            display: block; width: 100%;
            padding: 10px 12px;
            background: transparent; border: none;
            color: #e9ecf5; font-family: inherit;
            font-size: 11.5px; text-align: left; cursor: pointer;
            border-radius: 8px;
            transition: background .12s;
        }
        .sz-ctx-item:hover { background: rgba(255,255,255,.06); }
        .sz-ctx-item.danger { color: #fca5b1; }

        /* ═══ MODAL ═══ */
        .sz-modal {
            position: absolute; inset: 0; z-index: 30;
            background: rgba(0,0,0,.6);
            backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            display: flex; align-items: flex-end; justify-content: center;
            animation: szFadeIn .18s ease;
        }
        .sz-modal-card {
            width: 100%; max-height: 85%;
            background: linear-gradient(180deg, #131a24, #0b1218);
            border-top-left-radius: 18px; border-top-right-radius: 18px;
            border-top: 1px solid rgba(255,255,255,.08);
            display: flex; flex-direction: column;
            padding: 14px 0 0;
            animation: szSlideUp .28s cubic-bezier(.22,1,.36,1);
        }
        .sz-modal-title {
            font-size: 13px; font-weight: 800; color: #e9ecf5;
            padding: 0 16px 10px;
            border-bottom: 1px solid rgba(255,255,255,.05);
        }
        .sz-modal-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
        .sz-modal-list { flex: 1; overflow-y: auto; padding: 8px; }
        .sz-modal-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px 14px 14px; }
        .sz-modal-cancel {
            margin: 8px 14px 14px;
            padding: 11px; border-radius: 10px;
            background: rgba(255,255,255,.05);
            border: 1px solid rgba(255,255,255,.1);
            color: #c7cad6; font-family: inherit;
            font-size: 11.5px; font-weight: 700; cursor: pointer;
            transition: background .14s;
        }
        .sz-modal-cancel:hover { background: rgba(255,255,255,.09); }

        .sz-gpick .sz-check { font-size: 16px; color: #8a90a8; margin-left: 8px; }
        .sz-gpick.selected { background: rgba(37,211,102,.08); }
        .sz-gpick.selected .sz-check { color: var(--sz-accent); }

        /* ═══ INPUTS ═══ */
        .sz-input {
            width: 100%; padding: 10px 12px;
            background: rgba(255,255,255,.05);
            border: 1px solid rgba(255,255,255,.1);
            border-radius: 10px; color: #e9ecf5;
            font-family: inherit; font-size: 12px; outline: none;
            box-sizing: border-box;
            transition: border-color .16s, background .16s, box-shadow .16s;
        }
        .sz-input:focus { border-color: rgba(37,211,102,.5); background: rgba(255,255,255,.07); box-shadow: 0 0 0 3px rgba(37,211,102,.1); }
        .sz-textarea { min-height: 60px; resize: vertical; font-family: inherit; }
        .sz-field-hint { font-size: 9px; color: #6b7280; }

        .sz-btn {
            padding: 10px 14px; border-radius: 10px;
            background: rgba(255,255,255,.06);
            border: 1px solid rgba(255,255,255,.12);
            color: #e9ecf5; font-family: inherit;
            font-size: 11.5px; font-weight: 700; cursor: pointer;
            transition: background .16s, transform .16s;
            text-align: center;
        }
        .sz-btn:hover { background: rgba(255,255,255,.1); }
        .sz-btn:active { transform: scale(.98); }
        .sz-btn-primary {
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            border-color: transparent; color: #fff;
            box-shadow: 0 4px 12px rgba(37,211,102,.25);
        }
        .sz-btn.ghost { background: transparent; }

        .sz-chat-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }

        /* ═══ ANIMAÇÕES ═══ */
        @keyframes szSlideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes szFadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes szSlideIn { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes szBlink   { 0%,100% { background-position: 0% center; } 50% { background-position: 100% center; } }
        @keyframes szPulse   { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
        @keyframes szSkel    { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        @media (prefers-reduced-motion: reduce) {
            .sz-hdr-title, .sz-online-dot, .sz-skel-av, .sz-skel-line { animation: none !important; }
            .sz-item, .sz-tab, .sz-hdr-back, .sz-hdr-gear, .sz-hdr-call, .sz-new-btn, .sz-btn, .sz-ctx-item, .sz-chip, .sz-chat-ident, .sz-chat-back, .sz-chat-opt { transition-duration: .01ms !important; }
        }
    `);
})();
