// modules/phone/apps/config.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Phone/config] shell não inicializado.'); return; }
    if (ctx.apps.get('settings')) return;
    if (!ctx.userKey) { console.warn('[Phone/config] sem userKey — abortando.'); return; }

    // ═══ CONFIG ═══
    const APP_ID = 'settings';
    const APP_VERSION = '1.5.0';

    // Sufixos — prefixo real vem de ctx.ls (sanghub_phone_<userKey>_*)
    const LS_KEY = 'settings';
    const LS_PIN = 'pin';

    const _ls = ctx.ls || {
        get: () => null, set: () => {}, del: () => {},
        json: (k, fb) => fb
    };

    const SCREEN_W = 260;
    const SCREEN_H = 550;
    const TARGET_ASPECT = SCREEN_W / SCREEN_H;
    const OUTPUT_W = 520;
    const OUTPUT_H = 1100;
    const MAX_FILE_BYTES = 20 * 1024 * 1024;
    const JPEG_QUALITY = 0.88;

    const WALLPAPER_PRESETS = [
        {
            id: 'aurora',
            label: 'Aurora',
            url: 'https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=1040&q=85&fm=jpg&fit=crop'
        },
        {
            id: 'noite',
            label: 'Noite',
            url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1040&q=85&fm=jpg&fit=crop'
        },
        {
            id: 'claro',
            label: 'Claro',
            url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1040&q=85&fm=jpg&fit=crop'
        }
    ];

    const DEFAULT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

    const UPLOAD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    const LINK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

    const DEFAULTS = {
        theme: 'aurora',
        sound: true,
        previewOnCall: true,
        iconUrl: '',
        wallpaperUrl: '',
        presetId: ''
    };

    const esc = ctx.esc;

    // ═══ STORAGE ═══
    function load() {
        const raw = _ls.json(LS_KEY, {});
        return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
    }
    function save(cfg) {
        try { _ls.set(LS_KEY, JSON.stringify(cfg)); return true; }
        catch(e) { console.warn('[Phone/config] save falhou:', e); return false; }
    }
    function getPin() {
        return _ls.get(LS_PIN) || '';
    }
    function setPin(pin) {
        if (pin) _ls.set(LS_PIN, pin);
        else _ls.del(LS_PIN);
        // Sincroniza estado do shell (fallback se home re-renderizar)
        try { if (ctx._phone?.state) ctx._phone.state.pinSet = pin || ''; } catch(_) {}
    }

    // ═══ HELPERS ═══
    function safeUrl(url) {
        if (!url) return '';
        const s = String(url).trim();
        if (/^https?:\/\//i.test(s)) return s.replace(/['"()\\\s]/g, '');
        if (/^data:image\//i.test(s)) return s;
        return '';
    }
    function iconHtmlFor(cfg) {
        const url = safeUrl(cfg.iconUrl);
        if (!url) return DEFAULT_ICON;
        return `<img src="${esc(url)}" alt="icon" style="width:100%;height:100%;object-fit:contain;display:block;border-radius:8px;" />`;
    }
    function applyWallpaper(cfg) {
        const el = ctx.root?.querySelector('#phWallpaper');
        if (!el) return;
        const url = safeUrl(cfg.wallpaperUrl);
        if (url) el.style.setProperty('--phone-wallpaper', `url("${url}")`);
        else el.style.removeProperty('--phone-wallpaper');
    }

    // ═══ IMAGE PIPELINE ═══
    function cropToPhone(img) {
        const sw = img.naturalWidth || img.width;
        const sh = img.naturalHeight || img.height;
        if (!sw || !sh) throw new Error('imagem vazia');

        let cropW, cropH, cropX, cropY;
        if (sw / sh > TARGET_ASPECT) {
            cropH = sh;
            cropW = sh * TARGET_ASPECT;
            cropX = (sw - cropW) / 2;
            cropY = 0;
        } else {
            cropW = sw;
            cropH = sw / TARGET_ASPECT;
            cropX = 0;
            cropY = (sh - cropH) / 2;
        }

        const canvas = document.createElement('canvas');
        canvas.width = OUTPUT_W;
        canvas.height = OUTPUT_H;
        const g = canvas.getContext('2d');
        if (!g) throw new Error('canvas 2d indisponível');
        try { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; } catch(_) {}
        g.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, OUTPUT_W, OUTPUT_H);

        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        if (!/^data:image\/jpeg/i.test(dataUrl)) throw new Error('export falhou');
        return dataUrl;
    }

    function pickFile() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/*';
            input.style.cssText = 'position:fixed;top:-100px;left:-100px;width:0;height:0;opacity:0;pointer-events:none;';
            document.body.appendChild(input);

            let resolved = false;
            const cleanup = () => { try { input.remove(); } catch(_) {} };
            const done = (file) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(file || null);
            };
            input.addEventListener('change', () => {
                const f = input.files && input.files[0];
                done(f || null);
            });
            input.addEventListener('cancel', () => done(null));
            setTimeout(() => { if (!resolved && (!input.files || !input.files.length)) done(null); }, 60000);

            input.click();
        });
    }

    function loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { resolve({ img, url }); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load falhou')); };
            img.src = url;
        });
    }

    function loadImageFromUrl(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('load falhou'));
            img.src = url;
        });
    }

    function fetchImageViaGM(url) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                return reject(new Error('GM_xmlhttpRequest indisponível'));
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'blob',
                onload(res) {
                    if (!res || res.status < 200 || res.status >= 300) {
                        return reject(new Error('HTTP ' + (res && res.status)));
                    }
                    const blob = res.response;
                    if (!blob) return reject(new Error('blob vazio'));
                    const objUrl = URL.createObjectURL(blob);
                    const img = new Image();
                    img.onload = () => resolve({ img, revoke: () => URL.revokeObjectURL(objUrl) });
                    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('decode falhou')); };
                    img.src = objUrl;
                },
                onerror() { reject(new Error('network falhou')); },
                ontimeout() { reject(new Error('timeout')); },
                timeout: 20000
            });
        });
    }

    async function loadPresetImage(url) {
        try {
            const img = await loadImageFromUrl(url);
            try {
                const c = document.createElement('canvas');
                c.width = 1; c.height = 1;
                c.getContext('2d').drawImage(img, 0, 0, 1, 1);
                c.toDataURL('image/png');
                return { img, revoke: null };
            } catch(_) {
                throw new Error('canvas tainted — cai pro GM');
            }
        } catch(_) {
            return await fetchImageViaGM(url);
        }
    }

    setTimeout(() => { try { applyWallpaper(load()); } catch(_) {} }, 0);

    // ═══ REGISTRO ═══
    ctx.apps.register({
        id: APP_ID,
        name: 'Ajustes',
        get icon() { return iconHtmlFor(load()); },
        accent: '#94a3b8',
        bg: 'linear-gradient(135deg, #94a3b8, #64748b)',
        appBg: 'linear-gradient(180deg, #1a1a20 0%, #0e0e12 100%)',
        order: 10,

        mount(root, ctx) {
            ctx.screenEl?.classList.add('cfg-hide-bar');
            applyWallpaper(load());
            let cfg = load();
            renderApp(root, () => cfg, (next) => { cfg = next; });
        },

        unmount() {
            ctx.screenEl?.classList.remove('cfg-hide-bar');
        }
    });

    // ═══ NAV ═══
    function goHome() {
        if (typeof ctx.closeApp === 'function') { try { return ctx.closeApp(); } catch(_) {} }
        if (typeof ctx.goHome === 'function') { try { return ctx.goHome(); } catch(_) {} }
        try {
            const backBtn = ctx.frameEl?.querySelector('#phViewApp .ph-app-back');
            if (backBtn) return backBtn.click();
        } catch(_) {}
    }

    // ═══ RENDER ═══
    function renderApp(root, getCfg, setCfg) {
        const cfg = getCfg();
        const initialIcon = iconHtmlFor(cfg);
        const initialWallpaper = safeUrl(cfg.wallpaperUrl);
        const hasPin = !!getPin();

        root.innerHTML = `
            <div class="cfg-app">
                <header class="cfg-hdr">
                    <button class="cfg-hdr-back" id="cfgBack" title="Voltar ao início" aria-label="Voltar ao início">
                        ${ctx.I.back}
                    </button>
                    <div class="cfg-hdr-title">AJUSTES</div>
                    <div class="cfg-hdr-ver">v${APP_VERSION}</div>
                </header>

                <div class="cfg-app-body">
                    <div class="cfg-hero">
                        <div class="cfg-hero-icon" id="cfgHeroIcon">${initialIcon}</div>
                        <div class="cfg-hero-info">
                            <div class="cfg-hero-title">Personalizar celular</div>
                            <div class="cfg-hero-sub">Tema, ícone, papel de parede e segurança</div>
                        </div>
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">Segurança</div>
                        ${hasPin ? `
                            <button class="cfg-action" data-act="change-pin">
                                <span class="cfg-action-text">
                                    <span class="cfg-action-lbl">Alterar PIN</span>
                                    <span class="cfg-action-sub">Trocar o PIN de desbloqueio</span>
                                </span>
                                <span class="cfg-action-val">›</span>
                            </button>
                            <button class="cfg-action danger" data-act="remove-pin">
                                <span class="cfg-action-text">
                                    <span class="cfg-action-lbl">Remover PIN</span>
                                    <span class="cfg-action-sub">Sem PIN, a tela desbloqueia só com toque</span>
                                </span>
                                <span class="cfg-action-val">›</span>
                            </button>
                            <button class="cfg-action" data-act="lock-now">
                                <span class="cfg-action-text">
                                    <span class="cfg-action-lbl">Bloquear agora</span>
                                    <span class="cfg-action-sub">Volta para a tela de bloqueio</span>
                                </span>
                                <span class="cfg-action-val">›</span>
                            </button>
                        ` : `
                            <button class="cfg-action" data-act="set-pin">
                                <span class="cfg-action-text">
                                    <span class="cfg-action-lbl">Definir PIN</span>
                                    <span class="cfg-action-sub">Protege o desbloqueio com 4 dígitos</span>
                                </span>
                                <span class="cfg-action-val">›</span>
                            </button>
                        `}
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">Ícone do app</div>
                        <div class="cfg-field">
                            <label class="cfg-field-label" for="cfgIconUrl">URL do ícone</label>
                            <input class="cfg-input" id="cfgIconUrl" type="url"
                                placeholder="https://exemplo.com/icon.png"
                                value="${esc(cfg.iconUrl || '')}"
                                spellcheck="false" autocomplete="off" autocapitalize="off" />
                            <div class="cfg-field-hint">.png, .jpg, .svg ou data URL. Vazio = ícone padrão.</div>
                        </div>
                        <button class="cfg-mini-btn" id="cfgIconReset">Restaurar ícone padrão</button>
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">Aparência</div>
                        <div class="cfg-option-row">
                            <div class="cfg-option-label">Tema</div>
                            <div class="cfg-radio-group" data-key="theme">
                                <button class="cfg-radio${cfg.theme === 'aurora' ? ' active' : ''}" data-value="aurora">Aurora</button>
                                <button class="cfg-radio${cfg.theme === 'noite' ? ' active' : ''}" data-value="noite">Noite</button>
                                <button class="cfg-radio${cfg.theme === 'claro' ? ' active' : ''}" data-value="claro">Claro</button>
                            </div>
                        </div>
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">Wallpapers padrão</div>
                        <div class="cfg-preset-grid" id="cfgPresetGrid">
                            ${WALLPAPER_PRESETS.map(p => {
                                const active = cfg.presetId === p.id ? ' active' : '';
                                return `
                                    <button class="cfg-preset${active}" data-preset="${p.id}" type="button" title="${esc(p.label)}">
                                        <span class="cfg-preset-thumb" style="background-image:url('${esc(p.url)}')"></span>
                                        <span class="cfg-preset-lbl">${esc(p.label)}</span>
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">Papel de parede</div>
                        <div class="cfg-wall-block">
                            <div class="cfg-wall-preview" id="cfgWallPreview">
                                ${initialWallpaper
                                    ? `<img src="${esc(initialWallpaper)}" alt="preview" />`
                                    : `<span class="cfg-wall-empty">Sem papel de parede</span>`}
                            </div>
                            <div class="cfg-wall-meta">
                                <div class="cfg-wall-meta-title">Proporção ${SCREEN_W}×${SCREEN_H}</div>
                                <div class="cfg-wall-meta-sub">Imagens são auto-recortadas e otimizadas</div>
                            </div>
                        </div>
                        <div class="cfg-wall-actions">
                            <button class="cfg-file-btn" id="cfgWallPick" type="button">
                                ${UPLOAD_ICON}<span>Do computador</span>
                            </button>
                            <button class="cfg-file-btn ghost" id="cfgWallUrl" type="button">
                                ${LINK_ICON}<span>Por URL</span>
                            </button>
                            <button class="cfg-file-btn ghost danger" id="cfgWallClear" type="button">
                                ${TRASH_ICON}<span>Remover</span>
                            </button>
                        </div>
                        <div class="cfg-url-wrap" id="cfgWallUrlWrap" style="display:none;">
                            <input class="cfg-input" id="cfgWallUrlInput" type="url"
                                placeholder="https://exemplo.com/fundo.jpg"
                                value="${esc(/^data:/i.test(cfg.wallpaperUrl || '') ? '' : (cfg.wallpaperUrl || ''))}"
                                spellcheck="false" autocomplete="off" autocapitalize="off" />
                            <button class="cfg-mini-btn" id="cfgWallUrlApply" type="button">Aplicar</button>
                        </div>
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">Comportamento</div>
                        <div class="cfg-toggle-row">
                            <div class="cfg-toggle-text">
                                <div class="cfg-toggle-label">Som</div>
                                <div class="cfg-toggle-sub">Tons de chamada, teclado e notificações</div>
                            </div>
                            <label class="cfg-switch">
                                <input type="checkbox" data-key="sound" ${cfg.sound ? 'checked' : ''} />
                                <span class="cfg-switch-track"></span>
                            </label>
                        </div>
                        <div class="cfg-toggle-row">
                            <div class="cfg-toggle-text">
                                <div class="cfg-toggle-label">Prévia em chamada</div>
                                <div class="cfg-toggle-sub">Expandir telefone automaticamente</div>
                            </div>
                            <label class="cfg-switch">
                                <input type="checkbox" data-key="previewOnCall" ${cfg.previewOnCall ? 'checked' : ''} />
                                <span class="cfg-switch-track"></span>
                            </label>
                        </div>
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">Sobre</div>
                        <div class="cfg-info-row">
                            <span class="cfg-info-label">Sistema</span>
                            <span class="cfg-info-val">Android ${esc(window._phoneCtx?.__ANDROID_VERSION || '14')}</span>
                        </div>
                        <div class="cfg-info-row">
                            <span class="cfg-info-label">App</span>
                            <span class="cfg-info-val">v${APP_VERSION}</span>
                        </div>
                        <div class="cfg-info-row">
                            <span class="cfg-info-label">Armazenamento</span>
                            <span class="cfg-info-val"><code>${esc(ctx.ls?.key?.(LS_KEY) || LS_KEY)}</code></span>
                        </div>
                    </div>

                    <button class="cfg-reset-btn" id="cfgReset">Restaurar configurações padrão</button>
                    <div class="cfg-app-foot">Sang Phone · ajustes salvos por conta</div>
                </div>
            </div>
        `;

        root.querySelector('#cfgBack').addEventListener('click', goHome);

        function updateHero() {
            const hero = root.querySelector('#cfgHeroIcon');
            if (hero) hero.innerHTML = iconHtmlFor(getCfg());
        }

        // ═══ Icon ═══
        const iconInput = root.querySelector('#cfgIconUrl');
        let iconDebounce = null;
        iconInput.addEventListener('input', () => {
            clearTimeout(iconDebounce);
            iconDebounce = setTimeout(() => {
                const c = getCfg(); c.iconUrl = iconInput.value.trim(); setCfg(c); save(c);
                updateHero();
                try { ctx.apps._notify?.(); } catch(_) {}
            }, 350);
        });
        root.querySelector('#cfgIconReset').addEventListener('click', () => {
            const c = getCfg(); c.iconUrl = ''; setCfg(c); save(c);
            iconInput.value = '';
            updateHero();
            try { ctx.apps._notify?.(); } catch(_) {}
            ctx.toast('Ícone restaurado', 'ok');
        });

        // ═══ Theme ═══
        root.querySelectorAll('.cfg-radio').forEach(btn => {
            btn.addEventListener('click', () => {
                const c = getCfg(); c.theme = btn.dataset.value; setCfg(c); save(c);
                root.querySelectorAll('.cfg-radio').forEach(b => b.classList.toggle('active', b === btn));
                ctx.toast('Tema: ' + btn.dataset.value, 'ok');
            });
        });

        // ═══ Wallpaper helpers ═══
        const preview = root.querySelector('#cfgWallPreview');
        function renderPreview() {
            const url = safeUrl(getCfg().wallpaperUrl);
            if (url) preview.innerHTML = `<img src="${esc(url)}" alt="preview" />`;
            else preview.innerHTML = `<span class="cfg-wall-empty">Sem papel de parede</span>`;
        }
        function applyAndPreview() {
            const c = getCfg();
            applyWallpaper(c);
            renderPreview();
            const urlInput = root.querySelector('#cfgWallUrlInput');
            if (urlInput) urlInput.value = /^data:/i.test(c.wallpaperUrl || '') ? '' : (c.wallpaperUrl || '');
        }
        function syncPresetActive() {
            const cur = getCfg().presetId || '';
            root.querySelectorAll('.cfg-preset').forEach(b => {
                b.classList.toggle('active', b.dataset.preset === cur);
            });
        }

        // ═══ Presets ═══
        root.querySelectorAll('.cfg-preset').forEach(btn => {
            btn.addEventListener('click', async () => {
                const preset = WALLPAPER_PRESETS.find(p => p.id === btn.dataset.preset);
                if (!preset || btn.disabled) return;
                btn.disabled = true;
                btn.classList.add('loading');
                ctx.toast('Baixando wallpaper…', 'info');
                let revoke = null;
                try {
                    const { img, revoke: r } = await loadPresetImage(preset.url);
                    revoke = r;
                    const dataUrl = cropToPhone(img);
                    const c = getCfg();
                    c.wallpaperUrl = dataUrl;
                    c.presetId = preset.id;
                    setCfg(c);
                    if (!save(c)) { ctx.toast('Sem espaço no armazenamento', 'err'); return; }
                    applyAndPreview();
                    syncPresetActive();
                    ctx.toast('Wallpaper aplicado', 'ok');
                } catch(e) {
                    console.warn('[Phone/config] preset falhou:', e);
                    ctx.toast('Falha ao baixar wallpaper', 'err');
                } finally {
                    if (revoke) try { revoke(); } catch(_) {}
                    btn.disabled = false;
                    btn.classList.remove('loading');
                }
            });
        });

        // ═══ File picker ═══
        root.querySelector('#cfgWallPick').addEventListener('click', async () => {
            const btn = root.querySelector('#cfgWallPick');
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                const file = await pickFile();
                if (!file) return;
                if (!/^image\//i.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '')) {
                    ctx.toast('Arquivo não é uma imagem', 'err');
                    return;
                }
                if (file.size > MAX_FILE_BYTES) {
                    ctx.toast('Imagem muito grande (máx 20MB)', 'err');
                    return;
                }
                ctx.toast('Processando imagem…', 'info');
                const { img, url } = await loadImageFromFile(file);
                let dataUrl;
                try { dataUrl = cropToPhone(img); }
                finally { try { URL.revokeObjectURL(url); } catch(_) {} }
                const c = getCfg();
                c.wallpaperUrl = dataUrl;
                c.presetId = '';
                setCfg(c);
                if (!save(c)) { ctx.toast('Sem espaço no armazenamento', 'err'); return; }
                applyAndPreview();
                syncPresetActive();
                ctx.toast('Papel de parede atualizado', 'ok');
            } catch(e) {
                console.warn('[Phone/config] pick/crop falhou:', e);
                ctx.toast('Falha ao processar imagem', 'err');
            } finally {
                btn.disabled = false;
            }
        });

        // ═══ URL toggle ═══
        const urlWrap = root.querySelector('#cfgWallUrlWrap');
        const urlInput = root.querySelector('#cfgWallUrlInput');
        root.querySelector('#cfgWallUrl').addEventListener('click', () => {
            urlWrap.style.display = urlWrap.style.display === 'none' ? '' : 'none';
            if (urlWrap.style.display !== 'none') setTimeout(() => urlInput.focus(), 30);
        });
        root.querySelector('#cfgWallUrlApply').addEventListener('click', () => {
            const raw = urlInput.value.trim();
            if (!raw) { ctx.toast('Cole uma URL', 'err'); return; }
            const clean = safeUrl(raw);
            if (!clean) { ctx.toast('URL inválida', 'err'); return; }
            const c = getCfg();
            c.wallpaperUrl = clean;
            c.presetId = '';
            setCfg(c);
            if (!save(c)) { ctx.toast('Sem espaço no armazenamento', 'err'); return; }
            applyAndPreview();
            syncPresetActive();
            ctx.toast('Papel de parede atualizado', 'ok');
        });
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); root.querySelector('#cfgWallUrlApply').click(); }
        });

        // ═══ Clear ═══
        root.querySelector('#cfgWallClear').addEventListener('click', () => {
            const btn = root.querySelector('#cfgWallClear');
            if (!btn.dataset.confirm) {
                btn.dataset.confirm = '1';
                btn.querySelector('span').textContent = 'Confirmar?';
                btn.classList.add('armed');
                setTimeout(() => {
                    if (btn.dataset.confirm) {
                        delete btn.dataset.confirm;
                        btn.querySelector('span').textContent = 'Remover';
                        btn.classList.remove('armed');
                    }
                }, 2200);
                return;
            }
            delete btn.dataset.confirm;
            btn.querySelector('span').textContent = 'Remover';
            btn.classList.remove('armed');
            const c = getCfg();
            c.wallpaperUrl = '';
            c.presetId = '';
            setCfg(c);
            save(c);
            applyAndPreview();
            syncPresetActive();
            ctx.toast('Papel de parede removido', 'ok');
        });

        // ═══ Toggles ═══
        root.querySelectorAll('.cfg-switch input[data-key]').forEach(input => {
            input.addEventListener('change', () => {
                const c = getCfg(); c[input.dataset.key] = input.checked; setCfg(c); save(c);
                // Sincroniza com P.state.settings (mesma chave de storage)
                try {
                    const P = ctx._phone;
                    if (P?.state) {
                        if (!P.state.settings) P.state.settings = {};
                        P.state.settings[input.dataset.key] = input.checked;
                    }
                } catch(_) {}
                ctx.toast(input.checked ? 'Ativado' : 'Desativado', 'ok');
            });
        });

        // ═══ PIN actions ═══
        root.querySelectorAll('.cfg-action[data-act]').forEach(btn => {
            btn.addEventListener('click', () => handlePinAction(btn.dataset.act, root, getCfg, setCfg));
        });

        // ═══ Reset geral ═══
        const resetBtn = root.querySelector('#cfgReset');
        resetBtn.addEventListener('click', () => {
            if (!resetBtn.dataset.confirm) {
                resetBtn.dataset.confirm = '1';
                resetBtn.textContent = 'Confirmar? Toque de novo';
                resetBtn.classList.add('danger');
                setTimeout(() => {
                    if (resetBtn.dataset.confirm) {
                        delete resetBtn.dataset.confirm;
                        resetBtn.textContent = 'Restaurar configurações padrão';
                        resetBtn.classList.remove('danger');
                    }
                }, 2500);
                return;
            }
            const next = { ...DEFAULTS };
            setCfg(next); save(next);
            applyWallpaper(next);
            try { ctx.apps._notify?.(); } catch(_) {}
            try { ctx.tone.fav?.(); } catch(_) {}
            ctx.toast('Configurações restauradas', 'ok');
            root.innerHTML = '';
            renderApp(root, getCfg, setCfg);
        });
    }

    // ═══ PIN FLOW ═══
    function handlePinAction(act, root, getCfg, setCfg) {
        if (act === 'set-pin') {
            openPinModal(root, {
                title: 'Definir PIN',
                sub: 'Escolha 4 dígitos',
                mode: 'set-new',
                onDone: () => { ctx.toast('PIN definido', 'ok'); rerender(root, getCfg, setCfg); }
            });
        } else if (act === 'change-pin') {
            openPinModal(root, {
                title: 'PIN atual',
                sub: 'Digite o PIN atual para continuar',
                mode: 'check-current',
                onDone: () => {
                    openPinModal(root, {
                        title: 'Novo PIN',
                        sub: 'Escolha 4 dígitos',
                        mode: 'set-new',
                        onDone: () => { ctx.toast('PIN alterado', 'ok'); rerender(root, getCfg, setCfg); }
                    });
                }
            });
        } else if (act === 'remove-pin') {
            openPinModal(root, {
                title: 'Confirmar',
                sub: 'Digite o PIN atual para remover',
                mode: 'check-current',
                onDone: () => {
                    setPin('');
                    ctx.toast('PIN removido', 'ok');
                    rerender(root, getCfg, setCfg);
                }
            });
        } else if (act === 'lock-now') {
            try { if (typeof window._phone?._forceLock === 'function') return window._phone._forceLock(); } catch(_) {}
            goHome();
        }
    }

    function rerender(root, getCfg, setCfg) {
        root.innerHTML = '';
        renderApp(root, getCfg, setCfg);
    }

    function openPinModal(root, opts) {
        root.querySelector('.cfg-pin-modal')?.remove();
        const modal = ctx.el('div', { class: 'cfg-pin-modal' });
        modal.innerHTML = `
            <div class="cfg-pin-title">${esc(opts.title)}</div>
            <div class="cfg-pin-sub" id="cfgPinSub">${esc(opts.sub)}</div>
            <div class="cfg-pin-dots" id="cfgPinDots">
                <span class="cfg-pin-dot"></span>
                <span class="cfg-pin-dot"></span>
                <span class="cfg-pin-dot"></span>
                <span class="cfg-pin-dot"></span>
            </div>
            <div class="cfg-pin-pad" id="cfgPinPad"></div>
            <button class="cfg-pin-cancel" id="cfgPinCancel">Cancelar</button>
        `;
        root.appendChild(modal);

        let buf = '';
        let firstPin = '';
        let mode = opts.mode;
        let completing = false;

        const dots = modal.querySelectorAll('.cfg-pin-dot');
        const subEl = modal.querySelector('#cfgPinSub');
        const updateDots = () => dots.forEach((d, i) => d.classList.toggle('filled', i < buf.length));

        const pad = modal.querySelector('#cfgPinPad');
        const keys = [
            { d: '1' }, { d: '2', sub: 'ABC' }, { d: '3', sub: 'DEF' },
            { d: '4', sub: 'GHI' }, { d: '5', sub: 'JKL' }, { d: '6', sub: 'MNO' },
            { d: '7', sub: 'PQRS' }, { d: '8', sub: 'TUV' }, { d: '9', sub: 'WXYZ' },
            { util: 'back' }, { d: '0' }, { util: 'ok' }
        ];
        pad.innerHTML = keys.map(k => {
            if (k.util === 'back') return `<button class="cfg-pin-key util" data-util="back">${ctx.I.backspace}</button>`;
            if (k.util === 'ok') return `<button class="cfg-pin-key util ok" data-util="ok">✓</button>`;
            return `<button class="cfg-pin-key" data-digit="${k.d}">${k.d}${k.sub ? `<span class="sub">${k.sub}</span>` : ''}</button>`;
        }).join('');

        const closeModal = () => modal.remove();
        const shake = () => {
            const wrap = modal.querySelector('#cfgPinDots');
            if (wrap) { wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake'); }
        };
        const fail = (msg) => {
            try { ctx.tone.errorPin?.(); } catch(_) {}
            shake();
            if (subEl) subEl.textContent = msg;
            buf = ''; updateDots();
            setTimeout(() => { if (subEl) subEl.textContent = opts.sub; }, 900);
            completing = false;
        };

        const complete = (pinArg) => {
            if (completing) return;
            completing = true;
            const pin = pinArg != null ? pinArg : buf;

            if (mode === 'check-current') {
                if (pin !== getPin()) { return fail('PIN incorreto'); }
                try { ctx.tone.unlock?.(); } catch(_) {}
                closeModal();
                opts.onDone?.();
                return;
            }
            if (mode === 'set-new') {
                firstPin = pin;
                mode = 'set-confirm';
                buf = '';
                if (subEl) subEl.textContent = 'Repita os 4 dígitos';
                updateDots();
                completing = false;
                return;
            }
            if (mode === 'set-confirm') {
                if (pin !== firstPin) {
                    firstPin = ''; mode = 'set-new';
                    return fail('PINs não coincidem');
                }
                setPin(pin);
                try { ctx.tone.unlock?.(); } catch(_) {}
                closeModal();
                opts.onDone?.();
            }
        };

        pad.querySelectorAll('.cfg-pin-key').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.remove('pressed'); void btn.offsetWidth; btn.classList.add('pressed');
                if (btn.dataset.digit != null) {
                    try { ctx.tone.key?.(); } catch(_) {}
                    if (buf.length < 4) buf += btn.dataset.digit;
                } else if (btn.dataset.util === 'back') {
                    try { ctx.tone.key?.(); } catch(_) {}
                    buf = buf.slice(0, -1);
                } else if (btn.dataset.util === 'ok') {
                    if (buf.length === 4) { const p = buf; complete(p); }
                    return;
                }
                updateDots();
                if (buf.length === 4) { const p = buf; setTimeout(() => complete(p), 60); }
            });
        });
        modal.querySelector('#cfgPinCancel').addEventListener('click', closeModal);
    }

    // ═══ CSS ═══
    ctx.appendStyle(`
        .ph-screen.cfg-hide-bar .ph-app-bar { display: none !important; }

        /* ═══ APP ROOT ═══ */
        .cfg-app {
            display: flex; flex-direction: column;
            min-height: 0; height: 100%;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #e5e7eb;
            position: relative;
        }

        /* ═══ HEADER ═══ */
        .cfg-hdr {
            position: sticky; top: 0; z-index: 12;
            display: flex; align-items: center; gap: 10px;
            padding: 10px 14px 10px;
            background: linear-gradient(180deg, #1c1c24 0%, #141420 100%);
            border-bottom: 1px solid rgba(148,163,184,.16);
            box-shadow: 0 4px 14px rgba(0,0,0,.4);
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            flex-shrink: 0;
        }
        .cfg-hdr-back {
            width: 32px; height: 32px; flex-shrink: 0;
            border-radius: 10px;
            background: linear-gradient(180deg, rgba(148,163,184,.14), rgba(148,163,184,.06));
            border: 1px solid rgba(148,163,184,.3);
            color: #cbd5e1;
            cursor: pointer; font-family: inherit; padding: 0;
            display: flex; align-items: center; justify-content: center;
            transition: all .16s cubic-bezier(.22,1,.36,1);
            box-shadow: inset 0 1px 0 rgba(203,213,225,.18);
        }
        .cfg-hdr-back svg { width: 14px; height: 14px; }
        .cfg-hdr-back:hover {
            background: linear-gradient(180deg, rgba(148,163,184,.24), rgba(148,163,184,.12));
            color: #f1f5f9;
            border-color: rgba(148,163,184,.55);
            transform: translateX(-1px);
            box-shadow: 0 4px 12px rgba(148,163,184,.2), inset 0 1px 0 rgba(203,213,225,.26);
        }
        .cfg-hdr-back:active { transform: translateX(-1px) scale(.94); }

        .cfg-hdr-title {
            flex: 1; min-width: 0;
            font-size: 13px; font-weight: 800; letter-spacing: .1em;
            background: linear-gradient(100deg, #cbd5e1 0%, #f1f5f9 50%, #cbd5e1 100%);
            background-size: 220% auto;
            -webkit-background-clip: text; background-clip: text; color: transparent;
            animation: phScreenBlink 3.2s ease-in-out infinite;
            text-transform: uppercase;
        }
        .cfg-hdr-ver {
            font-size: 9px; color: #94a3b8; letter-spacing: .06em;
            padding: 3px 7px; border-radius: 6px;
            background: rgba(148,163,184,.1);
            border: 1px solid rgba(148,163,184,.2);
            font-variant-numeric: tabular-nums;
            flex-shrink: 0;
        }

        .cfg-app-body {
            flex: 1; min-height: 0; overflow-y: auto;
            padding: 8px 14px 22px;
            display: flex; flex-direction: column; gap: 12px;
        }
        .cfg-app-body::-webkit-scrollbar { width: 4px; }
        .cfg-app-body::-webkit-scrollbar-thumb { background: rgba(148,163,184,.28); border-radius: 2px; }
        .cfg-app-foot {
            text-align: center; font-size: 9px; color: #71717a;
            letter-spacing: .06em; padding: 12px 0 4px;
        }

        /* ═══ HERO ═══ */
        .cfg-hero {
            display: flex; align-items: center; gap: 14px;
            padding: 14px; border-radius: 16px;
            background:
                radial-gradient(circle at 15% 20%, rgba(148,163,184,.14), transparent 55%),
                radial-gradient(circle at 85% 90%, rgba(100,116,139,.18), transparent 55%),
                linear-gradient(175deg, rgba(30,30,38,.88), rgba(18,18,24,.92));
            border: 1px solid rgba(148,163,184,.18);
            box-shadow: inset 0 1px 0 rgba(203,213,225,.12), 0 6px 18px rgba(0,0,0,.35);
        }
        .cfg-hero-icon {
            width: 58px; height: 58px; flex-shrink: 0;
            border-radius: 16px;
            background: linear-gradient(135deg, rgba(148,163,184,.26), rgba(100,116,139,.22));
            border: 1px solid rgba(148,163,184,.4);
            display: flex; align-items: center; justify-content: center;
            color: #e2e8f0; overflow: hidden;
            box-shadow: 0 12px 26px rgba(0,0,0,.45), inset 0 1px 0 rgba(203,213,225,.2);
        }
        .cfg-hero-icon svg { width: 30px; height: 30px; }
        .cfg-hero-info { flex: 1; min-width: 0; }
        .cfg-hero-title { font-size: 13px; font-weight: 800; color: #f1f5f9; letter-spacing: .01em; }
        .cfg-hero-sub { font-size: 9.5px; color: #94a3b8; margin-top: 3px; line-height: 1.4; }

        /* ═══ SECTIONS ═══ */
        .cfg-section {
            display: flex; flex-direction: column; gap: 8px;
            padding: 12px; border-radius: 14px;
            background: linear-gradient(180deg, rgba(30,30,38,.68), rgba(18,18,24,.78));
            border: 1px solid rgba(148,163,184,.12);
            box-shadow: inset 0 1px 0 rgba(203,213,225,.06);
        }
        .cfg-section-title {
            font-size: 9px; font-weight: 800; letter-spacing: .12em;
            text-transform: uppercase; color: #94a3b8;
            padding-bottom: 7px;
            border-bottom: 1px solid rgba(148,163,184,.12);
            margin-bottom: 2px;
        }

        /* ═══ ACTIONS ═══ */
        .cfg-action {
            display: flex; align-items: center; justify-content: space-between;
            gap: 10px; padding: 11px 12px;
            background: linear-gradient(180deg, rgba(40,40,48,.9), rgba(24,24,30,.95));
            border: 1px solid rgba(148,163,184,.18);
            border-radius: 11px;
            cursor: pointer; font-family: inherit; color: inherit; text-align: left;
            box-shadow:
                inset 0 1px 0 rgba(203,213,225,.12),
                0 2px 8px rgba(0,0,0,.35);
            transition: background .18s, border-color .18s, transform .15s, box-shadow .18s;
        }
        .cfg-action:hover {
            background: linear-gradient(180deg, rgba(52,52,62,.96), rgba(32,32,40,.98));
            border-color: rgba(148,163,184,.45);
            box-shadow:
                inset 0 1px 0 rgba(203,213,225,.2),
                0 6px 18px rgba(148,163,184,.15);
        }
        .cfg-action:active {
            transform: scale(.985);
            box-shadow:
                inset 0 2px 6px rgba(0,0,0,.5),
                inset 0 1px 0 rgba(203,213,225,.06);
        }
        .cfg-action-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .cfg-action-lbl { font-size: 12px; font-weight: 700; color: #f1f5f9; }
        .cfg-action-sub { font-size: 9.5px; color: #94a3b8; line-height: 1.4; }
        .cfg-action-val { font-size: 16px; color: #cbd5e1; flex-shrink: 0; line-height: 1; font-weight: 700; }
        .cfg-action.danger { border-color: rgba(251,113,133,.26); }
        .cfg-action.danger .cfg-action-lbl { color: #fca5b1; }
        .cfg-action.danger .cfg-action-val { color: #fca5b1; }
        .cfg-action.danger:hover {
            border-color: rgba(251,113,133,.5);
            background: linear-gradient(180deg, rgba(60,28,32,.9), rgba(40,18,22,.95));
            box-shadow:
                inset 0 1px 0 rgba(252,165,177,.16),
                0 6px 18px rgba(251,113,133,.2);
        }

        /* ═══ FIELDS ═══ */
        .cfg-field { display: flex; flex-direction: column; gap: 6px; }
        .cfg-field-label {
            font-size: 9.5px; font-weight: 800; letter-spacing: .06em;
            text-transform: uppercase; color: #a1a1aa;
        }
        .cfg-input {
            width: 100%; padding: 9px 11px;
            background: rgba(10,10,14,.65);
            border: 1px solid rgba(148,163,184,.18);
            border-radius: 9px; color: #f1f5f9;
            font-family: inherit; font-size: 11.5px; outline: none;
            transition: border-color .18s, box-shadow .18s, background .18s;
            box-sizing: border-box;
            box-shadow: inset 0 1px 2px rgba(0,0,0,.4);
        }
        .cfg-input::placeholder { color: #52525b; }
        .cfg-input:focus {
            border-color: rgba(148,163,184,.55);
            box-shadow: 0 0 0 3px rgba(148,163,184,.14), inset 0 1px 2px rgba(0,0,0,.4);
            background: rgba(20,20,26,.85);
        }
        .cfg-field-hint { font-size: 9px; color: #71717a; line-height: 1.5; }

        .cfg-mini-btn {
            align-self: flex-start;
            padding: 8px 14px; border-radius: 9px;
            background: linear-gradient(180deg, rgba(148,163,184,.18), rgba(148,163,184,.08));
            border: 1px solid rgba(148,163,184,.35);
            color: #cbd5e1;
            font-family: inherit; font-size: 10px; font-weight: 800;
            letter-spacing: .04em; cursor: pointer;
            box-shadow: inset 0 1px 0 rgba(203,213,225,.2), 0 2px 6px rgba(0,0,0,.3);
            transition: all .16s cubic-bezier(.22,1,.36,1);
        }
        .cfg-mini-btn:hover {
            background: linear-gradient(180deg, rgba(148,163,184,.28), rgba(148,163,184,.14));
            color: #f1f5f9;
            border-color: rgba(148,163,184,.6);
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(148,163,184,.22), inset 0 1px 0 rgba(203,213,225,.28);
        }
        .cfg-mini-btn:active {
            transform: translateY(0) scale(.96);
            box-shadow: inset 0 2px 5px rgba(0,0,0,.4);
        }

        /* ═══ RADIO ═══ */
        .cfg-option-row { display: flex; flex-direction: column; gap: 6px; }
        .cfg-option-label {
            font-size: 9.5px; font-weight: 800; letter-spacing: .06em;
            text-transform: uppercase; color: #a1a1aa;
        }
        .cfg-radio-group {
            display: grid; grid-template-columns: repeat(3, 1fr);
            gap: 5px; background: rgba(0,0,0,.4);
            border: 1px solid rgba(148,163,184,.14);
            border-radius: 10px; padding: 3px;
            box-shadow: inset 0 1px 3px rgba(0,0,0,.5);
        }
        .cfg-radio {
            padding: 8px 4px; border-radius: 7px;
            background: transparent; border: none;
            color: #94a3b8;
            font-family: inherit; font-size: 10px; font-weight: 800;
            letter-spacing: .04em; text-transform: uppercase;
            cursor: pointer;
            transition: all .18s cubic-bezier(.22,1,.36,1);
        }
        .cfg-radio:hover:not(.active) { color: #e5e7eb; background: rgba(148,163,184,.08); }
        .cfg-radio.active {
            background: linear-gradient(135deg, #cbd5e1, #94a3b8);
            color: #0a0a10;
            box-shadow: 0 4px 14px rgba(148,163,184,.35), inset 0 1px 0 rgba(255,255,255,.35);
        }
        .cfg-radio:active:not(.active) { transform: scale(.96); }

        /* ═══ PRESETS ═══ */
        .cfg-preset-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }
        .cfg-preset {
            display: flex; flex-direction: column; gap: 5px;
            padding: 6px; border-radius: 11px;
            background: linear-gradient(180deg, rgba(40,40,48,.75), rgba(20,20,26,.88));
            border: 1px solid rgba(148,163,184,.16);
            cursor: pointer; font-family: inherit;
            box-shadow: inset 0 1px 0 rgba(203,213,225,.08), 0 2px 6px rgba(0,0,0,.3);
            transition: all .18s cubic-bezier(.22,1,.36,1);
        }
        .cfg-preset:hover:not(:disabled) {
            background: linear-gradient(180deg, rgba(52,52,62,.92), rgba(28,28,36,.96));
            border-color: rgba(148,163,184,.42);
            transform: translateY(-2px);
            box-shadow: inset 0 1px 0 rgba(203,213,225,.14), 0 8px 20px rgba(148,163,184,.16);
        }
        .cfg-preset:active:not(:disabled) { transform: translateY(0) scale(.97); }
        .cfg-preset:disabled { opacity: .5; cursor: wait; }
        .cfg-preset.active {
            border-color: rgba(203,213,225,.75);
            box-shadow: 0 0 0 2px rgba(203,213,225,.3), 0 8px 22px rgba(148,163,184,.25);
        }
        .cfg-preset.loading .cfg-preset-thumb { animation: phSpeaking 1.2s ease-in-out infinite; }
        .cfg-preset-thumb {
            display: block; width: 100%; aspect-ratio: 260 / 550;
            border-radius: 8px; background-size: cover; background-position: center;
            background-color: rgba(0,0,0,.4);
            border: 1px solid rgba(148,163,184,.1);
        }
        .cfg-preset-lbl {
            font-size: 9px; font-weight: 800; letter-spacing: .06em;
            text-transform: uppercase; color: #a1a1aa; text-align: center;
        }
        .cfg-preset.active .cfg-preset-lbl { color: #e2e8f0; }

        /* ═══ WALLPAPER ═══ */
        .cfg-wall-block { display: flex; gap: 12px; align-items: stretch; }
        .cfg-wall-preview {
            width: 70px; height: 148px;
            flex-shrink: 0;
            border-radius: 12px;
            background-color: rgba(10,10,14,.55);
            background-image:
                linear-gradient(45deg, rgba(148,163,184,.06) 25%, transparent 25%),
                linear-gradient(-45deg, rgba(148,163,184,.06) 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, rgba(148,163,184,.06) 75%),
                linear-gradient(-45deg, transparent 75%, rgba(148,163,184,.06) 75%);
            background-size: 12px 12px;
            background-position: 0 0, 0 6px, 6px -6px, -6px 0;
            border: 1px solid rgba(148,163,184,.2);
            box-shadow: inset 0 1px 0 rgba(203,213,225,.08), 0 4px 12px rgba(0,0,0,.35);
            display: flex; align-items: center; justify-content: center;
            overflow: hidden; position: relative;
        }
        .cfg-wall-preview img {
            position: absolute; inset: 0;
            width: 100%; height: 100%;
            object-fit: cover; display: block;
        }
        .cfg-wall-empty {
            font-size: 8.5px; color: #71717a;
            letter-spacing: .06em; text-transform: uppercase; font-weight: 700;
            text-align: center; padding: 0 6px; line-height: 1.4;
        }
        .cfg-wall-meta {
            flex: 1; min-width: 0;
            display: flex; flex-direction: column; justify-content: center; gap: 4px;
        }
        .cfg-wall-meta-title { font-size: 11px; font-weight: 700; color: #e5e7eb; }
        .cfg-wall-meta-sub { font-size: 9px; color: #71717a; line-height: 1.4; }

        .cfg-wall-actions {
            display: grid; grid-template-columns: 1fr 1fr 1fr;
            gap: 5px;
        }
        .cfg-file-btn {
            display: flex; align-items: center; justify-content: center; gap: 5px;
            padding: 10px 6px; border-radius: 10px;
            background: linear-gradient(135deg, rgba(148,163,184,.3), rgba(100,116,139,.28));
            border: 1px solid rgba(148,163,184,.5);
            color: #f1f5f9;
            font-family: inherit; font-size: 9.5px; font-weight: 800;
            letter-spacing: .04em; cursor: pointer; text-align: center;
            box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 3px 10px rgba(148,163,184,.14);
            transition: all .16s cubic-bezier(.22,1,.36,1);
            min-width: 0; overflow: hidden;
        }
        .cfg-file-btn svg { width: 12px; height: 12px; flex-shrink: 0; }
        .cfg-file-btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cfg-file-btn:hover:not(:disabled) {
            background: linear-gradient(135deg, rgba(148,163,184,.42), rgba(100,116,139,.4));
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(148,163,184,.28), inset 0 1px 0 rgba(255,255,255,.22);
        }
        .cfg-file-btn:active:not(:disabled) {
            transform: translateY(0) scale(.96);
            box-shadow: inset 0 2px 6px rgba(0,0,0,.4);
        }
        .cfg-file-btn:disabled { opacity: .45; cursor: not-allowed; }
        .cfg-file-btn.ghost {
            background: linear-gradient(180deg, rgba(40,40,48,.85), rgba(20,20,26,.92));
            border-color: rgba(148,163,184,.22);
            color: #a1a1aa;
            box-shadow: inset 0 1px 0 rgba(203,213,225,.08), 0 2px 6px rgba(0,0,0,.3);
        }
        .cfg-file-btn.ghost:hover:not(:disabled) {
            background: linear-gradient(180deg, rgba(52,52,62,.95), rgba(28,28,36,.98));
            border-color: rgba(148,163,184,.42);
            color: #e5e7eb;
            box-shadow: inset 0 1px 0 rgba(203,213,225,.16), 0 6px 16px rgba(148,163,184,.16);
        }
        .cfg-file-btn.ghost.danger { color: #fca5b1; border-color: rgba(251,113,133,.26); }
        .cfg-file-btn.ghost.danger:hover:not(:disabled) {
            background: linear-gradient(180deg, rgba(60,28,32,.9), rgba(40,18,22,.95));
            border-color: rgba(251,113,133,.5);
            color: #fecdd3;
            box-shadow: inset 0 1px 0 rgba(252,165,177,.16), 0 6px 16px rgba(251,113,133,.22);
        }
        .cfg-file-btn.ghost.danger.armed {
            background: linear-gradient(180deg, rgba(251,113,133,.32), rgba(251,113,133,.18));
            color: #fff;
            border-color: rgba(251,113,133,.65);
            animation: phSpeaking 1.4s ease-in-out infinite;
        }

        .cfg-url-wrap { display: flex; gap: 6px; align-items: center; }
        .cfg-url-wrap .cfg-input { flex: 1; min-width: 0; }
        .cfg-url-wrap .cfg-mini-btn { align-self: stretch; padding: 0 14px; }

        /* ═══ TOGGLES ═══ */
        .cfg-toggle-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
        .cfg-toggle-row + .cfg-toggle-row { border-top: 1px dashed rgba(148,163,184,.1); padding-top: 11px; }
        .cfg-toggle-text { flex: 1; min-width: 0; }
        .cfg-toggle-label { font-size: 11.5px; font-weight: 700; color: #e5e7eb; }
        .cfg-toggle-sub { font-size: 9px; color: #71717a; margin-top: 2px; line-height: 1.4; }

        .cfg-switch { position: relative; display: inline-block; width: 36px; height: 20px; flex-shrink: 0; cursor: pointer; }
        .cfg-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .cfg-switch-track {
            position: absolute; inset: 0; border-radius: 20px;
            background: rgba(0,0,0,.5);
            border: 1px solid rgba(148,163,184,.18);
            transition: background .24s, border-color .24s, box-shadow .24s;
            box-shadow: inset 0 1px 3px rgba(0,0,0,.5);
        }
        .cfg-switch-track::before {
            content: ''; position: absolute;
            width: 14px; height: 14px; left: 2px; top: 2px;
            background: #71717a; border-radius: 50%;
            transition: transform .24s cubic-bezier(.22,1,.36,1), background .24s, box-shadow .24s;
        }
        .cfg-switch input:checked + .cfg-switch-track {
            background: linear-gradient(120deg, rgba(203,213,225,.5), rgba(148,163,184,.5));
            border-color: rgba(203,213,225,.65);
            box-shadow: inset 0 0 10px rgba(203,213,225,.2);
        }
        .cfg-switch input:checked + .cfg-switch-track::before {
            background: linear-gradient(135deg, #f1f5f9, #cbd5e1);
            transform: translateX(16px);
            box-shadow: 0 0 10px rgba(203,213,225,.75);
        }

        /* ═══ INFO ═══ */
        .cfg-info-row {
            display: flex; align-items: center; justify-content: space-between; gap: 10px;
            padding: 7px 0; font-size: 11px;
        }
        .cfg-info-row + .cfg-info-row { border-top: 1px dashed rgba(148,163,184,.1); }
        .cfg-info-label { color: #94a3b8; }
        .cfg-info-val { color: #e5e7eb; font-weight: 700; font-variant-numeric: tabular-nums; }
        .cfg-info-val code {
            background: rgba(148,163,184,.14);
            padding: 2px 6px; border-radius: 4px;
            font-family: ui-monospace, 'SF Mono', Menlo, monospace;
            font-size: 9px; color: #cbd5e1; letter-spacing: .02em;
            border: 1px solid rgba(148,163,184,.18);
            word-break: break-all;
        }

        /* ═══ RESET ═══ */
        .cfg-reset-btn {
            padding: 12px; border-radius: 11px;
            background: linear-gradient(180deg, rgba(40,40,48,.88), rgba(20,20,26,.92));
            border: 1px solid rgba(148,163,184,.2);
            color: #a1a1aa;
            font-family: inherit; font-size: 11px; font-weight: 800;
            letter-spacing: .04em; cursor: pointer;
            box-shadow: inset 0 1px 0 rgba(203,213,225,.08), 0 2px 8px rgba(0,0,0,.3);
            transition: all .18s cubic-bezier(.22,1,.36,1);
        }
        .cfg-reset-btn:hover {
            background: linear-gradient(180deg, rgba(52,52,62,.95), rgba(28,28,36,.98));
            border-color: rgba(148,163,184,.42);
            color: #e5e7eb;
            transform: translateY(-1px);
            box-shadow: inset 0 1px 0 rgba(203,213,225,.16), 0 6px 16px rgba(148,163,184,.18);
        }
        .cfg-reset-btn:active { transform: translateY(0) scale(.98); }
        .cfg-reset-btn.danger {
            background: linear-gradient(180deg, rgba(60,28,32,.85), rgba(40,18,22,.92));
            border-color: rgba(251,113,133,.45);
            color: #fca5b1;
            animation: phSpeaking 1.4s ease-in-out infinite;
        }
        .cfg-reset-btn.danger:hover { background: rgba(251,113,133,.26); }

        /* ═══ PIN MODAL ═══ */
        .cfg-pin-modal {
            position: absolute; inset: 0; z-index: 30;
            background: linear-gradient(175deg, rgba(20,20,26,.98), rgba(8,8,12,.99));
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 14px; padding: 22px;
            animation: phFadeIn .22s ease;
        }
        .cfg-pin-title { font-size: 13px; font-weight: 800; color: #f1f5f9; text-align: center; letter-spacing: .02em; }
        .cfg-pin-sub { font-size: 10.5px; color: #94a3b8; text-align: center; line-height: 1.5; max-width: 200px; min-height: 15px; }
        .cfg-pin-dots { display: flex; gap: 14px; justify-content: center; padding: 6px 0; }
        .cfg-pin-dot {
            width: 12px; height: 12px; border-radius: 50%;
            background: transparent; border: 2px solid rgba(148,163,184,.4);
            transition: background .15s, border-color .15s, transform .15s;
        }
        .cfg-pin-dot.filled {
            background: #cbd5e1; border-color: #cbd5e1;
            box-shadow: 0 0 14px rgba(203,213,225,.75);
            transform: scale(1.15);
        }
        .cfg-pin-dots.shake { animation: phPinShake .5s cubic-bezier(.36,.07,.19,.97); }
        .cfg-pin-pad {
            display: grid; grid-template-columns: repeat(3, 1fr);
            gap: 8px; width: 100%; max-width: 200px;
        }
        .cfg-pin-key {
            padding: 12px 0 10px; border-radius: 14px;
            background: linear-gradient(180deg, rgba(40,40,48,.88), rgba(20,20,26,.95));
            border: 1px solid rgba(148,163,184,.2);
            color: #e5e7eb; font-family: inherit;
            font-size: 19px; font-weight: 700;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            cursor: pointer; user-select: none;
            transition: background .12s, border-color .12s, transform .12s, box-shadow .12s;
            line-height: 1;
            box-shadow: inset 0 1px 0 rgba(203,213,225,.12), 0 2px 8px rgba(0,0,0,.4);
        }
        .cfg-pin-key .sub { font-size: 7.5px; color: #71717a; letter-spacing: .06em; margin-top: 3px; font-weight: 800; text-transform: uppercase; }
        .cfg-pin-key:hover {
            background: linear-gradient(180deg, rgba(52,52,62,.95), rgba(28,28,36,.98));
            border-color: rgba(148,163,184,.45);
            box-shadow: inset 0 1px 0 rgba(203,213,225,.2), 0 4px 12px rgba(148,163,184,.16);
        }
        .cfg-pin-key:active {
            transform: scale(.94);
            background: linear-gradient(180deg, rgba(148,163,184,.28), rgba(148,163,184,.12));
            box-shadow: inset 0 2px 6px rgba(0,0,0,.45);
        }
        .cfg-pin-key.pressed { animation: phKeyPress .25s cubic-bezier(.22,1,.36,1); }
        .cfg-pin-key.util { color: #94a3b8; font-size: 15px; }
        .cfg-pin-key.util:hover { color: #cbd5e1; }
        .cfg-pin-key.util svg { width: 16px; height: 16px; }
        .cfg-pin-key.util.ok { color: #cbd5e1; }
        .cfg-pin-key.util.ok:hover { color: #fff; background: rgba(148,163,184,.22); }
        .cfg-pin-cancel {
            background: transparent; border: 1px solid rgba(148,163,184,.22);
            color: #a1a1aa; font-family: inherit; font-size: 10.5px; font-weight: 700;
            padding: 9px 20px; border-radius: 9px; cursor: pointer;
            transition: background .15s, color .15s, border-color .15s;
        }
        .cfg-pin-cancel:hover {
            background: rgba(148,163,184,.12);
            color: #e5e7eb;
            border-color: rgba(148,163,184,.45);
        }

        @keyframes phPinShake { 10%,90%{transform:translateX(-3px)} 20%,80%{transform:translateX(4px)} 30%,50%,70%{transform:translateX(-6px)} 40%,60%{transform:translateX(6px)} }

        @media (prefers-reduced-motion: reduce) {
            .cfg-hdr-title, .cfg-reset-btn.danger, .cfg-file-btn.ghost.danger.armed, .cfg-pin-key.pressed, .cfg-pin-dots.shake, .cfg-preset.loading .cfg-preset-thumb { animation: none !important; }
            .cfg-action, .cfg-mini-btn, .cfg-radio, .cfg-reset-btn, .cfg-hdr-back, .cfg-file-btn, .cfg-preset { transition-duration: .01ms; }
        }
    `);
})();
