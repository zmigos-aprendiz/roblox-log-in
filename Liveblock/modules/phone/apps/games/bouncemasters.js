// modules/phone/games/bouncemasters.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Bouncemasters] phone ctx ausente'); return; }
    if (ctx.apps.get('bouncemasters')) return;

    // ═══ CONFIG ═══
    const APP_ID = 'bouncemasters';
    const APP_NAME = 'Bouncemasters';
    const GAME_URL = 'https://3eq3pd4fpqal0.h5games.usercontent.goog/v/1k13nb2q2q9q0/?origin=https%3A%2F%2Fgamesnacks.com&gameCenterId=gamesnacks&userActivityMetrics=true&eids=95322736%2C95329199%2C95336219%2C95379098&features=GameRendering__enforce_csp%2CGameRendering__support_offline_feature%2CInterstitialFreqCap__freq_cap_60s%2CMonetization__run_slotcar_ads_in_game_center#pc=1082707071479003&preStart=1790553713676&enable-backend-update-score=true&is1on1=false&language=pt-PT';
    const GAME_ICON_URL = 'https://cdn1.epicgames.com/spt-assets/c0ee39442aff4a9198e0b1df04087e8d/bouncemasters-1qjlf.jpeg';
    const ACCENT = '#f97316';
    const HIDE_BAR_CLASS = 'sz-hide-bar';
    const LOAD_TIMEOUT_MS = 25000;

    const ICON = `<img src="${GAME_ICON_URL}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;" onerror="this.style.display='none'">`;

    // ═══ STATE ═══
    let _root = null;
    let _frameEl = null;
    let _loadingEl = null;
    let _errorEl = null;
    let _loadTimeout = null;
    let _loaded = false;

    // ═══ HELPERS ═══
    function getScreenEl() {
        return ctx.screenEl || window._phone?.state?.screenEl || null;
    }
    function hidePhoneBar() {
        const el = getScreenEl();
        if (el) try { el.classList.add(HIDE_BAR_CLASS); } catch(_) {}
    }
    function showPhoneBar() {
        const el = getScreenEl();
        if (el) try { el.classList.remove(HIDE_BAR_CLASS); } catch(_) {}
    }
    function openExternal() {
        try {
            const w = window.open(GAME_URL, '_blank', 'noopener,noreferrer');
            if (w) return;
        } catch(_) {}
        ctx.toast?.('Pop-up bloqueado', 'warn');
    }

    // ═══ GAME LOAD ═══
    function beginLoad() {
        if (!_frameEl || !_loadingEl || !_errorEl) return;
        _loaded = false;
        _loadingEl.classList.add('on');
        _errorEl.classList.remove('on');
        if (_loadTimeout) { clearTimeout(_loadTimeout); _loadTimeout = null; }
        _loadTimeout = setTimeout(() => {
            _loadTimeout = null;
            if (_loaded) return;
            _loadingEl.classList.remove('on');
            _errorEl.classList.add('on');
        }, LOAD_TIMEOUT_MS);
        try { _frameEl.src = GAME_URL; } catch(_) {}
    }
    function stopLoad() {
        if (_loadTimeout) { clearTimeout(_loadTimeout); _loadTimeout = null; }
        _loaded = false;
    }

    // ═══ UI ═══
    function renderShell() {
        _root.innerHTML = `
            <div class="arc-app">
                <div class="arc-stage" id="arcStage">
                    <iframe class="arc-frame" id="arcFrame"
                        src="about:blank"
                        title="${APP_NAME}"
                        allow="autoplay; fullscreen; gamepad; accelerometer; gyroscope; microphone; camera; clipboard-read; clipboard-write; encrypted-media; picture-in-picture"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-orientation-lock allow-pointer-lock allow-presentation allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-downloads allow-storage-access-by-user-activation"
                        referrerpolicy="no-referrer-when-downgrade"
                        allowfullscreen
                        loading="eager"></iframe>

                    <div class="arc-loading on" id="arcLoading">
                        <div class="arc-spinner"></div>
                        <div class="arc-loading-text">Carregando jogo…</div>
                        <div class="arc-loading-sub">Pode levar alguns segundos</div>
                    </div>

                    <div class="arc-error" id="arcError">
                        <div class="arc-error-icon">⚠</div>
                        <div class="arc-error-title">Não consegui carregar</div>
                        <div class="arc-error-sub">O jogo pode estar bloqueado por política do navegador ou demorando demais.</div>
                        <div class="arc-error-actions">
                            <button class="arc-action primary" id="arcRetry" type="button">Tentar de novo</button>
                            <button class="arc-action" id="arcOpen" type="button">Abrir em nova aba</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        _frameEl = _root.querySelector('#arcFrame');
        _loadingEl = _root.querySelector('#arcLoading');
        _errorEl = _root.querySelector('#arcError');

        _root.querySelector('#arcRetry').addEventListener('click', beginLoad);
        _root.querySelector('#arcOpen').addEventListener('click', openExternal);

        _frameEl.addEventListener('load', () => {
            if (!_frameEl || _frameEl.src === 'about:blank') return;
            _loaded = true;
            stopLoad();
            _loadingEl.classList.remove('on');
            _errorEl.classList.remove('on');
        });

        beginLoad();
    }

    // ═══ APP REGISTRATION ═══
    ctx.apps.register({
        id: APP_ID,
        name: APP_NAME,
        icon: ICON,
        accent: ACCENT,
        bg: 'linear-gradient(135deg, #7c2d12, #1c1917)',
        order: 9,
        dock: false,
        gameMode: true,

        async mount(root, appCtx) {
            if (!root) return;
            if (_root) { try { this.unmount(); } catch(_) {} }
            _root = root;
            if (appCtx?.screenEl) ctx.screenEl = appCtx.screenEl;

            root.style.position = 'relative';
            root.style.height = '100%';
            root.style.minHeight = '0';
            root.style.overflow = 'hidden';
            root.style.display = 'block';

            hidePhoneBar();
            try { renderShell(); }
            catch(e) {
                console.warn('[Bouncemasters] renderShell falhou:', e);
                showPhoneBar();
                _root = null;
            }
        },

        unmount() {
            stopLoad();

            const f = _frameEl;
            if (f) {
                try { f.src = 'about:blank'; } catch(_) {}
                try { f.remove(); } catch(_) {}
            }

            try {
                document.querySelectorAll('audio, video').forEach(el => {
                    try { el.pause(); el.currentTime = 0; } catch(_) {}
                });
            } catch(_) {}

            showPhoneBar();
            _root = null;
            _frameEl = null;
            _loadingEl = null;
            _errorEl = null;
            _loaded = false;
        }
    });

    // ═══ CSS ═══
    ctx.appendStyle(`
        .ph-screen.${HIDE_BAR_CLASS} .ph-app-bar { display: none !important; }

        .arc-app {
            position: absolute; inset: 0;
            display: flex; flex-direction: column;
            min-height: 0; overflow: hidden;
            background: #000;
            color: #e9ecf5;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .arc-stage {
            flex: 1 1 auto; min-height: 0;
            position: relative;
            background: #000;
        }

        .arc-frame {
            position: absolute; inset: 0;
            width: 100%; height: 100%;
            border: none;
            display: block;
            background: #000;
            color-scheme: dark;
        }

        .arc-loading {
            position: absolute; inset: 0;
            display: none; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 12px;
            background: #000;
            z-index: 5;
        }
        .arc-loading.on { display: flex; }
        .arc-spinner {
            width: 34px; height: 34px;
            border-radius: 50%;
            border: 3px solid rgba(255,255,255,.12);
            border-top-color: ${ACCENT};
            animation: arcSpin .85s linear infinite;
        }
        @keyframes arcSpin { to { transform: rotate(360deg); } }
        .arc-loading-text {
            font-size: 12px; font-weight: 700;
            color: #e9ecf5;
            letter-spacing: .02em;
        }
        .arc-loading-sub {
            font-size: 10.5px; color: #8a90a8;
            margin-top: -4px;
        }

        .arc-error {
            position: absolute; inset: 0;
            display: none; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 8px;
            padding: 28px 22px;
            background: #0b0f14;
            z-index: 6;
            text-align: center;
        }
        .arc-error.on { display: flex; }
        .arc-error-icon {
            font-size: 40px;
            opacity: .45;
            margin-bottom: 4px;
        }
        .arc-error-title {
            font-size: 14px; font-weight: 800;
            color: #e9ecf5;
        }
        .arc-error-sub {
            font-size: 11px;
            color: #8a90a8;
            line-height: 1.55;
            max-width: 260px;
            margin-bottom: 8px;
        }
        .arc-error-actions {
            display: flex; gap: 8px;
            margin-top: 4px;
            flex-wrap: wrap;
            justify-content: center;
        }
        .arc-action {
            padding: 9px 16px;
            border-radius: 10px;
            background: rgba(255,255,255,.06);
            border: 1px solid rgba(255,255,255,.12);
            color: #e9ecf5;
            font-family: inherit;
            font-size: 11.5px; font-weight: 700;
            cursor: pointer;
            transition: background .15s, border-color .15s, transform .12s;
        }
        .arc-action:hover { background: rgba(255,255,255,.1); }
        .arc-action:active { transform: scale(.97); }
        .arc-action.primary {
            background: linear-gradient(135deg, ${ACCENT}, #ea580c);
            border-color: transparent;
            color: #1c1917;
            box-shadow: 0 6px 18px rgba(249,115,22,.25);
        }
        .arc-action.primary:hover { filter: brightness(1.06); }

        @media (prefers-reduced-motion: reduce) {
            .arc-spinner { animation: none !important; }
            .arc-action { transition-duration: .01ms !important; }
        }
    `);
})();
