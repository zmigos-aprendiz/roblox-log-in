// modules/phone/shell.js
(function() {
    'use strict';
    const UID = '_phone';
    if (window[UID]) return;

    // ═══ CTX ═══
    const ctx = window._phoneCtx = window._phoneCtx || {};
    ctx.phase    = 'idle';
    ctx.myNumber = ctx.myNumber || null;
    ctx.contacts = ctx.contacts || {};
    ctx.calls    = ctx.calls    || {};
    ctx.notes    = ctx.notes    || {};
    ctx.voice    = ctx.voice    || {};

    if (!Array.isArray(ctx._cleanups)) ctx._cleanups = [];
    ctx._registerCleanup = function(fn) {
        if (typeof fn === 'function') ctx._cleanups.push(fn);
    };
    ctx._runCleanups = function() {
        while (ctx._cleanups.length) {
            const fn = ctx._cleanups.pop();
            try { fn(); } catch(e) { console.warn('[Phone] cleanup falhou:', e); }
        }
    };

    const P = window[UID] = ctx._phone = ctx._phone || {};

    // ═══ GUARDS ═══
    const bridge = window._hubBridge;
    if (!bridge || !bridge.rtdb) { console.warn('[Phone] _hubBridge.rtdb ausente.'); return; }

    const phoneBridge = bridge.phone
        ? Object.assign({}, bridge, bridge.phone)
        : bridge;

    if (!phoneBridge.firestore || !phoneBridge.firestore.configured || !phoneBridge.firestore.configured()) {
        console.warn('[Phone] Firestore off.'); return;
    }

    console.log('[Phone] usando', bridge.phone ? 'phoneBridge' : 'bridge do hub');

    // ═══ FIRESTORE GATE ═══
    (function installFirestoreGate() {
        const fs = phoneBridge.firestore;
        if (!fs || fs.__gated) return;
        fs.__gated = true;
        const origRequest = fs.request.bind(fs);

        const MAX_CONCURRENT = 3;
        const MIN_GAP_MS     = 120;
        const BACKOFF_STEPS  = [1500, 3000, 6000, 12000];

        let inFlight      = 0;
        let lastDispatch  = 0;
        let backoffUntil  = 0;
        let backoffIdx    = 0;
        const readQ  = [];
        const writeQ = [];

        const isWrite = (m) => m === 'POST' || m === 'PATCH' || m === 'DELETE' || m === 'PUT';

        function pump() {
            if (inFlight >= MAX_CONCURRENT) return;
            if (!readQ.length && !writeQ.length) return;
            const now = Date.now();
            if (now < backoffUntil) { setTimeout(pump, backoffUntil - now + 50); return; }
            const since = now - lastDispatch;
            if (since < MIN_GAP_MS) { setTimeout(pump, MIN_GAP_MS - since); return; }
            const item = writeQ.shift() || readQ.shift();
            lastDispatch = Date.now();
            inFlight++;
            origRequest(item.method, item.path, item.body, item.q)
                .then((r) => { backoffIdx = 0; item.resolve(r); })
                .catch((e) => {
                    const msg = String(e?.message || e);
                    if (/\b429\b/.test(msg) && (item.attempt || 0) < 2) {
                        item.attempt = (item.attempt || 0) + 1;
                        backoffUntil = Date.now() + BACKOFF_STEPS[Math.min(backoffIdx, BACKOFF_STEPS.length - 1)];
                        backoffIdx = Math.min(backoffIdx + 1, BACKOFF_STEPS.length - 1);
                        (isWrite(item.method) ? writeQ : readQ).unshift(item);
                    } else {
                        item.reject(e);
                    }
                })
                .finally(() => { inFlight--; setTimeout(pump, 10); });
        }

        fs.request = function(method, path, body, q) {
            return new Promise((resolve, reject) => {
                const item = { method, path, body, q, resolve, reject, attempt: 0 };
                (isWrite(method) ? writeQ : readQ).push(item);
                pump();
            });
        };
    })();

    // ═══ IDENTIDADE ═══
    function _resolveUserKey() {
        const raw = (bridge.player && bridge.player.name)
            || (bridge.util && bridge.util.loadPlayerCache && bridge.util.loadPlayerCache()?.name)
            || '';
        if (!raw) return '';
        return String(raw).toLowerCase().replace(/[^a-z0-9_\-]/g, '_').slice(0, 40);
    }

    ctx.userKey     = _resolveUserKey();
    ctx.hubDeviceId = phoneBridge.deviceId || '';
    ctx.deviceId    = ctx.hubDeviceId;
    ctx.bridge      = phoneBridge;

    // ═══ STORAGE ═══
    function _buildLs(userKey) {
        const prefix = 'sanghub_phone_' + userKey + '_';
        return {
            key: (k) => prefix + k,
            get: (k) => { try { return localStorage.getItem(prefix + k); } catch(_) { return null; } },
            set: (k, v) => { try { localStorage.setItem(prefix + k, String(v)); } catch(_) {} },
            del: (k) => { try { localStorage.removeItem(prefix + k); } catch(_) {} },
            json: (k, fb) => {
                try {
                    const raw = localStorage.getItem(prefix + k);
                    if (raw == null) return fb;
                    const v = JSON.parse(raw);
                    return v == null ? fb : v;
                } catch(_) { return fb; }
            }
        };
    }
    function _buildLsStub() {
        return { key: () => '', get: () => null, set: () => {}, del: () => {}, json: (k, fb) => fb };
    }

    ctx.ls = ctx.userKey ? _buildLs(ctx.userKey) : _buildLsStub();

    // ═══ MIGRAÇÃO ═══
    function _migratePhoneStorageV1() {
        if (!ctx.userKey) return;
        try {
            if (localStorage.getItem('sanghub_phone_migrated_v1') === '1') return;
            const LEGACY = [
                'minimized', 'pin', 'layout', 'home_cfg',
                'my_number', 'contacts', 'history', 'blocked',
                'notes_played', 'notes_inbox', 'notifications',
                'notif_asked', 'settings'
            ];
            for (const k of LEGACY) {
                const oldKey = 'sanghub_phone_' + k;
                const legacy = localStorage.getItem(oldKey);
                if (legacy == null) continue;
                const newKey = ctx.ls.key(k);
                if (localStorage.getItem(newKey) == null) {
                    try { localStorage.setItem(newKey, legacy); } catch(_) {}
                }
                try { localStorage.removeItem(oldKey); } catch(_) {}
            }
            localStorage.setItem('sanghub_phone_migrated_v1', '1');
            console.log('[Phone] migração v1 concluída para', ctx.userKey);
        } catch(e) {
            console.warn('[Phone] migração v1 falhou:', e);
        }
    }
    _migratePhoneStorageV1();

    // ═══ CONFIG ═══
    if (!P.config) {
        P.config = Object.freeze({
            ANDROID_VERSION: '14',
            PHONE_VERSION:   '1.5.1',
            MIN_TUCK_X:      260,
            MIN_TUCK_Y:     -140,
            FRAME_HALF_H:    285,
            LS_MINIMIZED:    'minimized',
            LS_PIN:          'pin',
            LS_LAYOUT:       'layout',
            LS_HOME_CFG:     'home_cfg',
            MODULES_BASE:    'https://raw.githubusercontent.com/zBeyond5/Liveblock/main/modules/phone',
            MAX_DOCK_APPS:   4,
            GRID_COLS:       4,
            GRID_ROWS:       4,
            PAGE_SIZE:       16,
            DEFAULT_APP_BG:        'linear-gradient(180deg, #16181c 0%, #0d0f12 100%)',
            DEFAULT_APP_BG_SOLID:  '#0f1115',
            URLS: Object.freeze({
                style:         '/style.js',
                core:          '/core.js',
                home:          '/home.js',
                apps:          '/apps.js',
                notifications: '/notifications.js',
                voice:         '/voice.js',
                contacts:      '/contacts.js',
                calls:         '/calls.js',
                notes:         '/notes.js',
                config:        '/apps/config.js',
                youtube:       '/apps/youtube.js',
                camera:        '/apps/camera/camera.js',
                gallery:       '/apps/gallery/gallery.js',
                download:      '/apps/gallery/download.js',
                idleexplorers: '/apps/games/idleexplorers.js',
                bouncemasters: '/apps/games/bouncemasters.js',
                comfyfarm:     '/apps/games/comfyfarm.js',
                sangzap:       '/apps/sangzap/shell.js'
            })
        });
    }
    const C = P.config;
    ctx.moduleBase = C.MODULES_BASE;

    // ═══ STATE ═══
    if (!P.state) P.state = {};
    Object.assign(P.state, {
        view:         'lock',
        activeAppId:  null,
        chamadasTab:  'contatos',
        inCallView:   false,
        prevView:     'home',
        dying:        false,
        frameEl:      null, screenEl: null, stageEl: null, contentEl: null
    });
    if (typeof P.state.bootToken !== 'number') P.state.bootToken = 0;
    P.state.minimized = true;
    P.state.pinSet    = ctx.ls.get(C.LS_PIN) || '';
    P.state.settings  = ctx.ls.json('settings', P.state.settings || {});

    // ═══ CTA ═══
    function _getScreenEl() {
        return ctx.screenEl || P.state.screenEl || null;
    }
    function _clearCTA() {
        try {
            const el = _getScreenEl()?.querySelector('.ph-noidentity');
            if (el) el.remove();
        } catch(_) {}
    }
    function _injectCTAStyle(shadow) {
        if (!shadow || shadow.querySelector('style[data-cta]')) return;
        const st = document.createElement('style');
        st.setAttribute('data-cta', '1');
        st.textContent = `
            .ph-noidentity { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
                padding: 24px; background: rgba(10, 10, 20, 0.92); z-index: 20; }
            .ph-noidentity-card { max-width: 260px; padding: 22px 18px; border-radius: 16px;
                border: 1px solid rgba(34, 211, 238, 0.32);
                background: linear-gradient(175deg, rgba(20, 18, 40, 0.96), rgba(10, 8, 20, 0.98));
                box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7), 0 0 60px rgba(34, 211, 238, 0.12);
                text-align: center; font-family: inherit; }
            .ph-noidentity-icon { width: 52px; height: 52px; margin: 0 auto 12px; display: flex; align-items: center;
                justify-content: center; border-radius: 14px; background: rgba(34, 211, 238, 0.14);
                border: 1px solid rgba(34, 211, 238, 0.4); color: #67e8f9; }
            .ph-noidentity-icon svg { width: 24px; height: 24px; }
            .ph-noidentity-title { font-size: 14px; font-weight: 800; color: #fff; letter-spacing: .02em; margin-bottom: 8px; }
            .ph-noidentity-text { font-size: 11px; color: #a8aec4; line-height: 1.5; margin-bottom: 10px; }
            .ph-noidentity-warn { font-size: 10px; color: #fbbf24; line-height: 1.5; padding: 8px 10px;
                margin-bottom: 14px; background: rgba(251, 191, 36, 0.08);
                border: 1px solid rgba(251, 191, 36, 0.24); border-radius: 8px; text-align: left; }
            .ph-noidentity-btn { width: 100%; padding: 11px 16px; border-radius: 10px; border: none; cursor: pointer;
                background: linear-gradient(120deg, #22d3ee, #a78bfa); color: #0b0b10;
                font-family: inherit; font-size: 11.5px; font-weight: 800; letter-spacing: .03em;
                transition: transform .15s, filter .15s; }
            .ph-noidentity-btn:hover { transform: translateY(-1px); filter: brightness(1.08); }
            .ph-noidentity-btn:active { transform: scale(.98); }
        `;
        shadow.appendChild(st);
    }
    function _renderNoIdentityCTA() {
        const base = C.MODULES_BASE;

        const proceed = () => {
            P.core.ensureHost();
            P.core.injectBaseStyle();
            P.core.ensureFrame();
            P.core.showView('lock');

            const shadow = P.core.getShadow?.();
            _injectCTAStyle(shadow);

            const screen = _getScreenEl();
            if (!screen) return;
            if (screen.querySelector('.ph-noidentity')) return;

            const host = location.hostname.includes('habblet') ? 'habblet.city'
                       : location.hostname.includes('habblive') ? 'habblive.in'
                       : 'habblive.in';
            const meUrl = 'https://' + host + '/me';

            const ov = document.createElement('div');
            ov.className = 'ph-noidentity';
            ov.innerHTML =
                '<div class="ph-noidentity-card">' +
                    '<div class="ph-noidentity-icon">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                            '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="ph-noidentity-title">Você ainda não tem um número</div>' +
                    '<div class="ph-noidentity-text">Para gerar seu número, precisamos carregar as informações do seu personagem.</div>' +
                    '<div class="ph-noidentity-warn">' +
                        'Você será redirecionado para <b>' + host + '/me</b>.<br>' +
                        'Após a página carregar, <b>volte</b> e reentre no jogo.' +
                    '</div>' +
                    '<button class="ph-noidentity-btn" id="phGenNumber">Clique aqui para gerar seu número</button>' +
                '</div>';
            screen.appendChild(ov);
            ov.querySelector('#phGenNumber').addEventListener('click', () => {
                try { location.href = meUrl; } catch(_) {}
            });
        };

        (async () => {
            await P.loadModule('style', base + C.URLS.style);
            await P.loadModule('core',  base + C.URLS.core);
            if (!P.core) { console.error('[Phone] core.js falhou — CTA não renderiza.'); return; }
            proceed();
        })();
    }

    // ═══ MODULE LOADER ═══
    P.loadModule = async function(name, url) {
        try {
            const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const code = await res.text();
            const s = document.createElement('script');
            s.textContent = code;
            document.documentElement.appendChild(s);
            s.remove();
            return true;
        } catch(e) {
            console.warn('[Phone] Falha ao carregar ' + name + ':', e);
            return false;
        }
    };

    // ═══ BOOT ═══
    async function _boot() {
        const myToken = ++P.state.bootToken;
        const alive = () => P.state.bootToken === myToken && !P.state.dying;

        if (!ctx.userKey) {
            console.log('[Phone] sem identidade — CTA /me');
            _renderNoIdentityCTA();
            return;
        }

        const base = C.MODULES_BASE;

        await P.loadModule('style', base + C.URLS.style);
        if (!alive()) return;

        await P.loadModule('core', base + C.URLS.core);
        if (!alive()) return;
        if (!P.core) { console.error('[Phone] core.js falhou — abortando boot.'); return; }

        await Promise.all([
            P.loadModule('home',          base + C.URLS.home),
            P.loadModule('apps',          base + C.URLS.apps),
            P.loadModule('notifications', base + C.URLS.notifications)
        ]);
        if (!alive()) return;
        if (!P.home)   console.warn('[Phone] home.js falhou — modo degradado.');
        if (!P.apps)   console.warn('[Phone] apps.js falhou — modo degradado.');
        if (!P.notify) console.warn('[Phone] notifications.js falhou — lock sem feed.');

        P.core.ensureHost();
        P.core.injectBaseStyle();
        P.core.ensureFrame();

        if (P.home) P.home.renderLock();
        else        P.core.showView('lock');

        await P.loadModule('voice', base + C.URLS.voice);
        if (!alive()) return;

        await Promise.all([
            P.loadModule('contacts', base + C.URLS.contacts),
            P.loadModule('calls',    base + C.URLS.calls),
            P.loadModule('notes',    base + C.URLS.notes),
            P.loadModule('config',   base + C.URLS.config),
            P.loadModule('youtube',  base + C.URLS.youtube),
            P.loadModule('camera',   base + C.URLS.camera),
            P.loadModule('gallery',  base + C.URLS.gallery),
            P.loadModule('download', base + C.URLS.download),
            P.loadModule('idleexplorers', base + C.URLS.idleexplorers),
            P.loadModule('bouncemasters', base + C.URLS.bouncemasters),
            P.loadModule('comfyfarm', base + C.URLS.comfyfarm),
            P.loadModule('sangzap',  base + C.URLS.sangzap)
        ]);
        if (!alive()) return;

        try {
            const onChange = P.apps?.onChange || ctx.apps?.onChange;
            if (typeof onChange === 'function') {
                onChange(() => {
                    if (!alive()) return;
                    if (P.state.view === 'home') P.home?.renderHome?.();
                    if (P.state.view === 'app' && P.state.activeAppId === 'calls') P.apps?.updateMyNumberUI?.();
                });
            }
        } catch(e) { console.warn('[Phone] apps.onChange falhou:', e); }

        try {
            ctx.notes?.onUnreadChange?.(() => {
                if (alive()) P.apps?.refreshRecadosBadge?.();
            });
            P.apps?.refreshRecadosBadge?.();
        } catch(_) {}

        if (ctx.contacts.ensureMyNumber) {
            ctx.contacts.ensureMyNumber().then(() => {
                if (alive()) P.apps?.updateMyNumberUI?.();
            });
        }

        ctx.notes.startNotesPoll?.();
        P.apps?.startPhasePoll?.();
    }

    // ═══ MINIMIZE / RESTORE ═══
    // Ocultar sempre trava a tela (fora de chamada ativa). Ao reabrir,
    // o usuário cai no lock — não na última view aberta.
    function _hideAndLock() {
        const s = P.state;
        if (!s.frameEl) return;
        s.frameEl.classList.add('hidden');
        s.frameEl.classList.remove('min');
        s.minimized = true;

        // Durante chamada ativa preserva a view de call — reabrir volta direto pra ela.
        if (s.inCallView) return;

        // Descarta app aberto — reabrir cai no lock, não no app.
        s.activeAppId = null;
        s.view = 'lock';
        try { P.home?.lock?.(); } catch(e) { console.warn('[Phone] lock falhou:', e); }
    }

    function _showFrame() {
        const s = P.state;
        P.core?.ensureFrame?.();
        if (!s.frameEl) return;
        s.frameEl.classList.remove('hidden');
        s.frameEl.classList.remove('min');
        s.minimized = false;
        P.core?.tickClock?.();
    }

    // ═══ TOGGLE ═══
    function toggle() {
        if (!ctx.userKey) return;
        ctx.getAudioCtx?.();
        const frame = P.state.frameEl;

        const visible = frame && frame.isConnected && !frame.classList.contains('hidden');
        if (visible) { _hideAndLock(); return; }

        _showFrame();
        if (!ctx.myNumber) ctx.contacts.ensureMyNumber?.();

        const s = P.state;
        if (s.inCallView)                           P.core?.showView?.('call');
        else if (s.view === 'app' && s.activeAppId) P.core?.showView?.('app');
        else if (s.view === 'home')                 P.home?.renderHome?.();
        else                                        P.home?.renderLock?.();
    }

    // ═══ KILL ═══
    function kill() {
        const s = P.state;
        if (s.dying) return;
        s.dying = true;
        s.bootToken++;

        try { ctx._runCleanups?.(); } catch(e) { console.warn('[Phone] _runCleanups:', e); }

        try { ctx.calls.cleanup?.(); }    catch(_) {}
        try { ctx.notes.cancelNote?.(); } catch(_) {}
        try { ctx.notes.stopPoll?.(); }   catch(_) {}

        try { document.removeEventListener('keydown', _onPhysicalKey, true); } catch(_) {}
        try { window.removeEventListener('sang:phone-incoming', _onPhoneIncoming); } catch(_) {}
        try { window.removeEventListener('sang:player-updated', _onPlayerUpdated); } catch(_) {}
        try { window.removeEventListener('sang:player-updated', _onAccountSwitch); } catch(_) {}

        P.home?.teardown?.();
        P.apps?.teardown?.();
        P.core?.teardown?.();

        if (ctx.apps && Array.isArray(ctx.apps._listeners)) ctx.apps._listeners.length = 0;

        delete P.home;
        delete P.apps;
        delete P.core;
        delete P.notify;
        delete ctx._phoneCss;

        try { delete window[UID]; } catch(_) {}
    }

    // ═══ TECLADO ═══
    function _onPhysicalKey(e) {
        const s = P.state;
        if (s.dying) return;
        const frame = s.frameEl;
        if (!frame || frame.classList.contains('hidden')) return;
        if (s.minimized) return;

        const shadow = P.core?.getShadow?.();
        const ae = shadow?.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const outAe = document.activeElement;
        const host  = P.core?.getHost?.();
        if (outAe && outAe !== host &&
            (outAe.tagName === 'INPUT' || outAe.tagName === 'TEXTAREA' || outAe.isContentEditable)) return;

        const k = e.key;
        let sel = null, scope = null;

        if (s.view === 'lock' && s.pinSet) {
            scope = frame.querySelector('#phLockPad');
        } else if (s.view === 'app' && s.activeAppId === 'calls' && s.chamadasTab === 'discar') {
            scope = frame.querySelector('#phContent');
        } else return;

        if (!scope) return;

        if (k.length === 1 && k >= '0' && k <= '9')      sel = `.ph-key[data-digit="${k}"]`;
        else if (k === 'Backspace')                       sel = `.ph-key[data-util="back"]`;
        else if (k === 'Enter' || k === 'Escape') {
            if (s.view === 'lock')   sel = `.ph-key[data-util="ok"]`;
            else if (k === 'Enter')  sel = `#phCall`;
            else                     sel = `.ph-key[data-util="clear"]`;
        } else return;

        const btn = scope.querySelector(sel);
        if (!btn || btn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        btn.click();
    }

    // ═══ LISTENERS ═══
    function _onPhoneIncoming(e) {
        if (P.state.dying) return;
        if (!ctx.userKey) return;

        const d = e?.detail || {};
        if (d.toNumber && ctx.myNumber && d.toNumber !== ctx.myNumber) return;

        P.core?.ensureFrame?.();
        if (P.state.frameEl) {
            P.state.frameEl.classList.remove('hidden');
            P.state.frameEl.classList.remove('min');
        }
        P.state.minimized  = false;
        P.state.inCallView = true;
        P.state.view       = 'call';
        P.core?.showView?.('call');

        try { ctx.calls.onIncoming?.(d); } catch(_) {}
    }

    function _onPlayerUpdated() {
        if (P.state.dying) return;
        try { if (ctx.myNumber) ctx.contacts.refreshMyDirectory?.(); } catch(_) {}
    }

    let _rebooting = false;
    function _onAccountSwitch() {
        if (P.state.dying) return;
        const novo = _resolveUserKey();
        if (!novo) return;
        if (novo === ctx.userKey) return;

        if (!ctx.userKey) {
            console.log('[Phone] identidade disponível:', novo);
            ctx.userKey = novo;
            ctx.ls = _buildLs(novo);
            _migratePhoneStorageV1();
            P.state.pinSet   = ctx.ls.get(C.LS_PIN) || '';
            P.state.settings = ctx.ls.json('settings', {});
            _clearCTA();
            _boot().catch(e => console.error('[Phone] boot pós-identidade falhou:', e));
            return;
        }

        if (_rebooting) return;
        _rebooting = true;
        setTimeout(() => { _rebooting = false; }, 3000);
        console.log('[Phone] troca de conta:', ctx.userKey, '→', novo);
        P.reboot();
    }

    document.addEventListener('keydown', _onPhysicalKey, true);
    window.addEventListener('sang:phone-incoming', _onPhoneIncoming);
    window.addEventListener('sang:player-updated', _onPlayerUpdated);
    window.addEventListener('sang:player-updated', _onAccountSwitch);

    // ═══ REBOOT ═══
    P.reboot = function() {
        try {
            const mod = bridge.state && bridge.state.manifest
                && bridge.state.manifest.modules.find(m => m.instanceKey === '_phone');
            if (!mod) {
                console.warn('[Phone] manifesto sem phone — recarregando');
                location.reload();
                return;
            }
            kill();
            bridge.deactivateModule(mod);
            bridge.activateModule(mod);
        } catch(e) {
            console.error('[Phone] reboot falhou, recarregando:', e);
            try { location.reload(); } catch(_) {}
        }
    };

    // ═══ EXPORT ═══
    P.toggle       = toggle;
    P.kill         = kill;
    P.hideAndLock  = _hideAndLock;
    P.showFrame    = _showFrame;
    P._lock        = () => P.home?.lock?.();
    P._forceLock   = () => P.home?.lock?.();
    P.ctx = ctx;

    _boot().catch(e => console.error('[Phone] boot falhou:', e));
})();
