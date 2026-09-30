// modules/phone/apps/youtube.js
(function() {
    'use strict';
    try {
        const ctx = window._phoneCtx;
        if (!ctx) { console.warn('[YouTube] phone ctx ausente'); return; }
        if (!ctx.apps || typeof ctx.apps.get !== 'function') {
            console.warn('[YouTube] ctx.apps indisponível — abortando'); return;
        }
        if (ctx.apps.get('youtube')) { console.log('[YouTube] já registrado'); return; }

        console.log('[YouTube] módulo carregado');

    // ═══ CONFIG ═══
    const APP_ID = 'youtube';
    const LS_STATE = 'sanghub_phone_app_youtube_state';
    const YT_API_SRC = 'https://www.youtube.com/iframe_api';
    const YT_API_TIMEOUT_MS = 8000;
    const PROGRESS_TICK_MS = 250;
    const Z_YT_HOST = 2147483646;
    const Z_MINI = 2147483647;
    const ACCENT = '#ff0033';
    const ACCENT_SOFT = '#ff5577';

    const ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.5 15.6V8.4l6.3 3.6z"/></svg>`;

    const ICON_PLAY  = `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="6 4 20 12 6 20 6 4"/></svg>`;
    const ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
    const ICON_VOL   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    const ICON_MUTE  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
    const ICON_EXPAND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>`;
    const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const ICON_SPINNER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" width="14" height="14" style="animation:ytSpin 0.9s linear infinite;"><circle cx="12" cy="12" r="9" opacity="0.18"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>`;

    // ═══ STATE ═══
    let _ytHost = null;
    let _ytContainer = null;
    let _ytPlayer = null;
    let _ytReady = false;
    const _ytQueue = [];

    let _mini = null;
    let _miniEls = null;
    let _miniProgressTimer = null;
    let _miniVisible = false;

    let _appRoot = null;
    let _placeholder = null;
    let _progressEls = null;
    let _appProgressTimer = null;
    let _loadingEls = null;

    let _rafId = 0;
    let _tickActive = false;
    let _mode = 'hidden';
    let _lastMode = null;
    let _lastSyncKey = '';

    let _apiPromise = null;
    let _loadToken = 0;

    const _state = {
        videoId: '',
        name: '',
        artist: '',
        volume: 0.8,
        muted: false,
        playing: false,
        miniClosed: false
    };

    // ═══ PERSISTENCE ═══
    function _loadState() {
        try {
            const raw = localStorage.getItem(LS_STATE);
            if (!raw) return;
            const p = JSON.parse(raw);
            if (typeof p.videoId === 'string') _state.videoId = p.videoId;
            if (typeof p.name === 'string') _state.name = p.name;
            if (typeof p.artist === 'string') _state.artist = p.artist;
            if (typeof p.volume === 'number') _state.volume = Math.max(0, Math.min(1, p.volume));
            if (typeof p.muted === 'boolean') _state.muted = p.muted;
            if (typeof p.miniClosed === 'boolean') _state.miniClosed = p.miniClosed;
        } catch(_) {}
    }
    function _saveState() {
        try {
            localStorage.setItem(LS_STATE, JSON.stringify({
                videoId: _state.videoId,
                name: _state.name,
                artist: _state.artist,
                volume: _state.volume,
                muted: _state.muted,
                miniClosed: _state.miniClosed
            }));
        } catch(_) {}
    }
    _loadState();

    // ═══ PARSER ═══
    function parseVideoId(input) {
        if (!input) return '';
        const s = String(input).trim();
        if (/^[\w-]{11}$/.test(s)) return s;
        try {
            const u = new URL(s);
            if (u.hostname === 'youtu.be') {
                const p = u.pathname.slice(1).split('/')[0];
                if (/^[\w-]{11}$/.test(p)) return p;
            }
            if (u.pathname === '/watch') {
                const v = u.searchParams.get('v') || '';
                if (/^[\w-]{11}$/.test(v)) return v;
            }
            const m = u.pathname.match(/\/(?:embed|shorts|v)\/([\w-]{11})/);
            if (m) return m[1];
        } catch(_) {}
        return '';
    }

    // ═══ OEMBED (com token anti-race) ═══
    async function _fetchMeta(videoId, token) {
        try {
            const res = await fetch(
                'https://www.youtube.com/oembed?url=' +
                encodeURIComponent('https://www.youtube.com/watch?v=' + videoId) +
                '&format=json',
                { cache: 'no-store' }
            );
            if (!res.ok) return null;
            const d = await res.json();
            if (token !== _loadToken) return null;
            return { name: d.title || '', artist: d.author_name || '' };
        } catch(_) { return null; }
    }

    // ═══ YT API LOADER ═══
    function loadYouTubeApi() {
        if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
        if (_apiPromise) return _apiPromise;
        _apiPromise = new Promise((resolve, reject) => {
            let done = false;
            const prev = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                if (done) return;
                done = true;
                try { prev && prev(); } catch(_) {}
                if (window.YT && window.YT.Player) resolve(window.YT);
                else reject(new Error('YT indisponível após callback'));
            };
            const s = document.createElement('script');
            s.src = YT_API_SRC;
            s.async = true;
            s.onerror = () => { if (!done) { done = true; reject(new Error('YT script falhou')); } };
            document.head.appendChild(s);
            setTimeout(() => {
                if (done) return;
                if (window.YT && window.YT.Player) { done = true; resolve(window.YT); }
                else { done = true; reject(new Error('YT timeout')); }
            }, YT_API_TIMEOUT_MS);
        }).finally(() => { _apiPromise = null; });
        return _apiPromise;
    }

    // ═══ HOST ═══
    function _ensureHost() {
        if (_ytHost && _ytHost.isConnected) return;
        _ytHost = document.createElement('div');
        _ytHost.setAttribute('data-sang-ui', '');
        _ytHost.setAttribute('data-youtube', '1');
        _ytHost.style.cssText = `
            position: fixed;
            z-index: ${Z_YT_HOST};
            pointer-events: none;
            opacity: 0;
            overflow: hidden;
            border-radius: 14px;
            background: #000;
            will-change: left, top, width, height, opacity;
            transition: opacity .24s cubic-bezier(.22,1,.36,1);
            box-shadow: 0 0 0 1px rgba(255,255,255,.04), 0 12px 40px rgba(0,0,0,.5);
        `;
        _ytContainer = document.createElement('div');
        _ytContainer.style.cssText = 'width:100%;height:100%;';
        _ytHost.appendChild(_ytContainer);
        document.documentElement.appendChild(_ytHost);
    }

    // ═══ PLAYER ═══
    function _ytCmd(fn) {
        if (!fn) return;
        if (_ytReady && _ytPlayer) { try { fn(_ytPlayer); } catch(_) {} }
        else _ytQueue.push(fn);
    }
    function _drainQueue() {
        while (_ytQueue.length) {
            const fn = _ytQueue.shift();
            try { fn(_ytPlayer); } catch(_) {}
        }
    }

    async function _ensurePlayer(videoId) {
        _ensureHost();
        if (_ytPlayer) { _ytCmd((p) => p.loadVideoById(videoId)); return; }
        let YT;
        try { YT = await loadYouTubeApi(); }
        catch(e) {
            console.warn('[YouTube] API falhou:', e);
            ctx.toast?.('Não foi possível carregar o player', 'err');
            return;
        }
        _ytReady = false;
        _ytQueue.length = 0;

        _ytPlayer = new YT.Player(_ytContainer, {
            videoId,
            playerVars: {
                autoplay: 1,
                controls: 0,
                disablekb: 1,
                fs: 0,
                iv_load_policy: 3,
                modestbranding: 1,
                playsinline: 1,
                rel: 0,
                origin: location.origin
            },
            events: {
                onReady: () => {
                    _ytReady = true;
                    _ytPlayer.setVolume(Math.round(_state.volume * 100));
                    if (_state.muted) _ytPlayer.mute();
                    _drainQueue();
                },
                onStateChange: (e) => {
                    const S = (window.YT && window.YT.PlayerState) || {};
                    if (e.data === S.PLAYING)          _state.playing = true;
                    else if (e.data === S.PAUSED)      _state.playing = false;
                    else if (e.data === S.ENDED)       _state.playing = false;
                    else if (e.data === S.BUFFERING)   _state.playing = true;
                    else return;
                    _saveState();
                    _renderMiniContent();
                    _renderAppProgress();
                },
                onError: (e) => {
                    console.warn('[YouTube] erro', e && e.data);
                    if (e && (e.data === 101 || e.data === 150)) {
                        ctx.toast?.('Vídeo não permite embed', 'err');
                    }
                }
            }
        });
    }

    function _play()    { _ytCmd((p) => p.playVideo()); }
    function _pause()   { _ytCmd((p) => p.pauseVideo()); }
    function _toggle()  { _state.playing ? _pause() : _play(); }
    function _seek(sec) { _ytCmd((p) => p.seekTo(sec, true)); }

    function _setVolume(v) {
        _state.volume = Math.max(0, Math.min(1, v));
        _ytCmd((p) => p.setVolume(Math.round(_state.volume * 100)));
        _saveState();
    }
    function _setMuted(m) {
        _state.muted = !!m;
        _ytCmd((p) => _state.muted ? p.mute() : p.unMute());
        _saveState();
        _renderMiniContent();
    }
    function _toggleMute() { _setMuted(!_state.muted); }

    function _getTime() {
        if (!_ytReady || !_ytPlayer || !_ytPlayer.getCurrentTime) return { cur: 0, dur: 0 };
        try {
            return { cur: _ytPlayer.getCurrentTime() || 0, dur: _ytPlayer.getDuration() || 0 };
        } catch(_) { return { cur: 0, dur: 0 }; }
    }

    // ═══ LOAD ═══
    async function _loadUrl(input) {
        const id = parseVideoId(input);
        if (!id) { ctx.toast?.('Link do YouTube inválido', 'err'); return false; }

        const token = ++_loadToken;
        _state.videoId = id;
        _state.name = '';
        _state.artist = '';
        _state.playing = false;
        _state.miniClosed = false;
        _saveState();

        await _ensurePlayer(id);
        if (token !== _loadToken) return false;

        const meta = await _fetchMeta(id, token);
        if (token !== _loadToken) return false;

        if (meta) {
            _state.name = meta.name || '';
            _state.artist = meta.artist || '';
            _saveState();
        }
        _renderMiniContent();
        _renderAppContent();
        return true;
    }

    function _clear() {
        _loadToken++;
        _state.videoId = '';
        _state.name = '';
        _state.artist = '';
        _state.playing = false;
        _state.miniClosed = false;
        _saveState();
        if (_ytPlayer && _ytReady) {
            try { _ytPlayer.stopVideo(); } catch(_) {}
        }
        _renderAppContent();
        _renderMiniContent();
        _lastMode = null;
        _applyMode();
    }

    // ═══ MINI PLAYER ═══
    function _ensureMini() {
        if (_mini && _mini.isConnected) return;
        _mini = document.createElement('div');
        _mini.setAttribute('data-sang-ui', '');
        _mini.setAttribute('data-youtube-mini', '1');
        _mini.style.cssText = `
            position: fixed;
            z-index: ${Z_MINI};
            right: 16px;
            bottom: 16px;
            width: 328px;
            background: linear-gradient(175deg, rgba(22,22,30,0.97), rgba(10,10,16,0.99));
            border: 1px solid rgba(255,0,51,0.34);
            border-radius: 16px;
            box-shadow:
                0 22px 55px rgba(0,0,0,0.72),
                0 0 60px rgba(255,0,51,0.14),
                inset 0 1px 0 rgba(255,255,255,0.05);
            backdrop-filter: blur(16px) saturate(150%);
            -webkit-backdrop-filter: blur(16px) saturate(150%);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #e9ecf5;
            user-select: none;
            opacity: 0;
            transform: translateY(14px) scale(.97);
            transition:
                opacity .26s cubic-bezier(.22,1,.36,1),
                transform .3s cubic-bezier(.22,1,.36,1);
            pointer-events: none;
            overflow: hidden;
        `;
        _mini.innerHTML = `
            <div data-yt-mini-head class="yt-mini-head">
                <span class="yt-mini-badge">${ICON.replace('<svg ', '<svg width="18" height="18" ')}</span>
                <div style="flex:1;min-width:0;">
                    <div data-yt-mini-name class="yt-mini-name">YouTube</div>
                    <div data-yt-mini-artist class="yt-mini-artist">—</div>
                </div>
                <button data-yt-mini-close class="yt-mini-btn yt-mini-close" aria-label="Fechar">${ICON_CLOSE}</button>
            </div>

            <div data-yt-mini-progress-wrap class="yt-mini-prog">
                <div class="yt-mini-prog-track">
                    <div data-yt-mini-progress-fill class="yt-mini-prog-fill"></div>
                    <div data-yt-mini-progress-thumb class="yt-mini-prog-thumb"></div>
                </div>
            </div>

            <div class="yt-mini-controls">
                <button data-yt-mini-mute class="yt-mini-btn" aria-label="Mudo">${ICON_VOL}</button>
                <input data-yt-mini-vol type="range" min="0" max="100" step="1" value="80" aria-label="Volume" class="yt-mini-range" />
                <button data-yt-mini-play class="yt-mini-btn yt-mini-play" aria-label="Tocar/Pausar"></button>
                <button data-yt-mini-expand class="yt-mini-btn" aria-label="Abrir">${ICON_EXPAND}</button>
            </div>
        `;
        document.documentElement.appendChild(_mini);

        _miniEls = {
            head:      _mini.querySelector('[data-yt-mini-head]'),
            name:      _mini.querySelector('[data-yt-mini-name]'),
            artist:    _mini.querySelector('[data-yt-mini-artist]'),
            vol:       _mini.querySelector('[data-yt-mini-vol]'),
            mute:      _mini.querySelector('[data-yt-mini-mute]'),
            play:      _mini.querySelector('[data-yt-mini-play]'),
            expand:    _mini.querySelector('[data-yt-mini-expand]'),
            close:     _mini.querySelector('[data-yt-mini-close]'),
            progWrap:  _mini.querySelector('[data-yt-mini-progress-wrap]'),
            progFill:  _mini.querySelector('[data-yt-mini-progress-fill]'),
            progThumb: _mini.querySelector('[data-yt-mini-progress-thumb]')
        };

        _miniEls.vol.addEventListener('input', (e) => _setVolume(parseInt(e.target.value, 10) / 100));
        _miniEls.mute.addEventListener('click', (e) => { e.stopPropagation(); _toggleMute(); });
        _miniEls.play.addEventListener('click', (e) => { e.stopPropagation(); _toggle(); });
        _miniEls.expand.addEventListener('click', (e) => { e.stopPropagation(); _openApp(); });
        _miniEls.close.addEventListener('click', (e) => { e.stopPropagation(); _closeMini(); });
        _miniEls.head.addEventListener('click', (e) => {
            if (e.target.closest('[data-yt-mini-close]')) return;
            _openApp();
        });
        _miniEls.progWrap.addEventListener('click', (e) => {
            const { dur } = _getTime();
            if (!dur) return;
            const r = _miniEls.progWrap.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            _seek(dur * pct);
        });
    }

    function _renderMiniContent() {
        if (!_miniEls) return;
        _miniEls.name.textContent = _state.name || 'YouTube';
        _miniEls.artist.textContent = _state.artist || '—';
        _miniEls.vol.value = String(Math.round(_state.volume * 100));
        _miniEls.play.innerHTML = _state.playing ? ICON_PAUSE : ICON_PLAY;
        const silent = _state.muted || _state.volume <= 0.001;
        _miniEls.mute.innerHTML = silent ? ICON_MUTE : ICON_VOL;
        _miniEls.mute.classList.toggle('is-muted', silent);
    }

    function _renderMiniProgress() {
        if (!_miniEls) return;
        const { cur, dur } = _getTime();
        const pct = dur ? (cur / dur) * 100 : 0;
        _miniEls.progFill.style.width = pct.toFixed(2) + '%';
        _miniEls.progThumb.style.left = pct.toFixed(2) + '%';
    }

    function _startMiniProgress() {
        if (_miniProgressTimer) return;
        _miniProgressTimer = setInterval(_renderMiniProgress, PROGRESS_TICK_MS);
    }
    function _stopMiniProgress() {
        if (_miniProgressTimer) { clearInterval(_miniProgressTimer); _miniProgressTimer = null; }
    }

    function _closeMini() {
        _state.miniClosed = true;
        _saveState();
        _lastMode = null;
        _applyMode();
    }

    function _openApp() {
        try {
            const P = window._phone;
            if (P?.apps?.openApp) { P.apps.openApp(APP_ID); return; }
            if (typeof ctx.openApp === 'function') { ctx.openApp(APP_ID); }
        } catch(_) {}
    }

    // ═══ MODE ═══
    function _phoneMinimized() {
        const f = window._phone?.state?.frameEl;
        return !!(f && f.classList.contains('min'));
    }
    function _phoneHidden() {
        const f = window._phone?.state?.frameEl;
        return !!(f && f.classList.contains('hidden'));
    }
    function _placeholderVisible() {
        if (!_placeholder || !_placeholder.isConnected) return false;
        if (window._phone?.state?.view !== 'app') return false;
        const r = _placeholder.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
    }

    function _computeMode() {
        if (!_state.videoId) return 'hidden';
        if (_phoneMinimized() || _phoneHidden()) {
            if (_state.miniClosed) return 'hidden';
            return 'mini';
        }
        if (_placeholderVisible()) return 'app';
        return 'hidden';
    }

    function _applyMode() {
        const next = _computeMode();
        if (next === _lastMode) return;
        _lastMode = next;
        _mode = next;

        if (_ytHost) {
            const app = next === 'app';
            _ytHost.style.opacity = app ? '1' : '0';
            _ytHost.style.pointerEvents = app ? 'auto' : 'none';
        }
        if (_mini) {
            if (next === 'mini') {
                _renderMiniContent();
                _renderMiniProgress();
                _mini.style.opacity = '1';
                _mini.style.transform = 'translateY(0) scale(1)';
                _mini.style.pointerEvents = 'auto';
                _miniVisible = true;
                _startMiniProgress();
            } else {
                _mini.style.opacity = '0';
                _mini.style.transform = 'translateY(14px) scale(.97)';
                _mini.style.pointerEvents = 'none';
                _miniVisible = false;
                _stopMiniProgress();
            }
        }
    }

    function _syncToPlaceholder(force) {
        if (!_ytHost || !_placeholder || !_placeholder.isConnected) return;
        const r = _placeholder.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;

        const vw = window.innerWidth, vh = window.innerHeight;
        const left = Math.max(0, r.left);
        const top  = Math.max(0, r.top);
        const right  = Math.min(vw, r.right);
        const bottom = Math.min(vh, r.bottom);
        const w = Math.max(0, right - left);
        const h = Math.max(0, bottom - top);
        if (w < 4 || h < 4) return;

        const key = left + ',' + top + ',' + w + ',' + h;
        if (!force && key === _lastSyncKey) return;
        _lastSyncKey = key;
        _ytHost.style.left   = left + 'px';
        _ytHost.style.top    = top + 'px';
        _ytHost.style.width  = w + 'px';
        _ytHost.style.height = h + 'px';
    }

    function _tick() {
        if (!_tickActive) return;
        _rafId = requestAnimationFrame(_tick);
        if (!_state.videoId) return;
        _applyMode();
        if (_mode === 'app') _syncToPlaceholder(false);
    }
    function _startTick() {
        if (_tickActive) return;
        _tickActive = true;
        _tick();
    }
    function _stopTick() {
        _tickActive = false;
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
        _lastSyncKey = '';
    }

    // ═══ FORMAT ═══
    function _fmtTime(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return m + ':' + String(s).padStart(2, '0');
    }

    // ═══ APP UI ═══
    function _renderAppContent() {
        if (!_appRoot || !_appRoot.isConnected) return;
        const wrap  = _appRoot.querySelector('[data-yt-input-wrap]');
        const stage = _appRoot.querySelector('[data-yt-stage]');
        const info  = _appRoot.querySelector('[data-yt-info]');
        if (!wrap || !stage || !info) return;

        const hasVideo = !!_state.videoId;
        const showingInput = wrap.style.display !== 'none';

        if (!hasVideo) {
            wrap.style.display = 'flex';
            stage.style.display = 'none';
            info.style.display = 'none';
            _placeholder = null;
            _progressEls = null;
            _loadingEls = null;
            return;
        }
        if (showingInput) return;

        wrap.style.display = 'none';
        stage.style.display = 'flex';
        info.style.display = 'flex';

        const nameEl = info.querySelector('[data-yt-info-name]');
        const artEl  = info.querySelector('[data-yt-info-artist]');
        if (nameEl) nameEl.textContent = _state.name || '—';
        if (artEl)  artEl.textContent  = _state.artist || '';

        _placeholder = stage.querySelector('[data-yt-ph]');

        if (!_progressEls) {
            _progressEls = {
                fill: info.querySelector('[data-yt-prog-fill]'),
                thumb: info.querySelector('[data-yt-prog-thumb]'),
                cur:  info.querySelector('[data-yt-prog-cur]'),
                dur:  info.querySelector('[data-yt-prog-dur]'),
                wrap: info.querySelector('[data-yt-prog-wrap]')
            };
            if (_progressEls.wrap) {
                _progressEls.wrap.addEventListener('click', (e) => {
                    const { dur } = _getTime();
                    if (!dur) return;
                    const r = _progressEls.wrap.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                    _seek(dur * pct);
                });
            }
            if (!_appProgressTimer) {
                _appProgressTimer = setInterval(_renderAppProgress, PROGRESS_TICK_MS);
            }
        }
        _renderAppProgress();
        _lastSyncKey = '';
    }

    function _renderAppProgress() {
        if (!_progressEls || !_progressEls.fill) return;
        const { cur, dur } = _getTime();
        const pct = dur ? (cur / dur) * 100 : 0;
        _progressEls.fill.style.width = pct.toFixed(2) + '%';
        _progressEls.thumb.style.left = pct.toFixed(2) + '%';
        _progressEls.cur.textContent = _fmtTime(cur);
        _progressEls.dur.textContent = _fmtTime(dur);
    }

    function _stopAppProgress() {
        if (_appProgressTimer) { clearInterval(_appProgressTimer); _appProgressTimer = null; }
        _progressEls = null;
    }

    function _wireApp(root) {
        const input  = root.querySelector('[data-yt-input]');
        const load   = root.querySelector('[data-yt-load]');
        const change = root.querySelector('[data-yt-change]');
        const clear  = root.querySelector('[data-yt-clear]');
        _loadingEls = { btn: load };

        load.addEventListener('click', async () => {
            const v = input.value.trim();
            if (!v) { ctx.toast?.('Cole um link do YouTube', 'warn'); return; }
            if (load.dataset.busy === '1') return;
            load.dataset.busy = '1';
            load.disabled = true;
            load.classList.add('is-loading');
            load.innerHTML = `${ICON_SPINNER}<span>Carregando…</span>`;
            try {
                const ok = await _loadUrl(v);
                if (ok) {
                    input.value = '';
                    root.querySelector('[data-yt-input-wrap]').style.display = 'none';
                    _renderAppContent();
                }
            } finally {
                load.dataset.busy = '0';
                load.disabled = false;
                load.classList.remove('is-loading');
                load.innerHTML = 'Carregar';
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); load.click(); }
        });
        change.addEventListener('click', () => {
            const wrap  = root.querySelector('[data-yt-input-wrap]');
            const stage = root.querySelector('[data-yt-stage]');
            const info  = root.querySelector('[data-yt-info]');
            const showing = wrap.style.display !== 'none';
            if (showing) {
                wrap.style.display = 'none';
                stage.style.display = 'flex';
                info.style.display = 'flex';
                _placeholder = stage.querySelector('[data-yt-ph]');
                _lastSyncKey = '';
            } else {
                wrap.style.display = 'flex';
                stage.style.display = 'none';
                info.style.display = 'none';
                _placeholder = null;
                input.focus();
            }
        });
        clear.addEventListener('click', () => {
            _clear();
            const wrap = root.querySelector('[data-yt-input-wrap]');
            const stage = root.querySelector('[data-yt-stage]');
            const info = root.querySelector('[data-yt-info]');
            wrap.style.display = 'flex';
            stage.style.display = 'none';
            info.style.display = 'none';
        });
    }

    function _mountApp(root) {
        _appRoot = root;
        root.style.cssText = 'position:relative;height:100%;display:flex;flex-direction:column;min-height:0;background:#0a0a0f;overflow:hidden;';

        root.innerHTML = `
            <div data-yt-input-wrap class="yt-screen yt-input-screen">
                <div class="yt-hero-icon">${ICON.replace('<svg ', '<svg width="36" height="36" ')}</div>
                <div style="text-align:center;">
                    <div class="yt-hero-title">YouTube</div>
                    <div class="yt-hero-sub">Cole um link de <b>vídeo</b>, <b>shorts</b> ou use o ID direto.</div>
                </div>
                <input data-yt-input type="text" placeholder="https://youtube.com/watch?v=…"
                    autocomplete="off" spellcheck="false" class="yt-input" />
                <button data-yt-load class="yt-btn-primary">
                    Carregar
                </button>
                <div class="yt-hero-note">
                    Player embutido do YouTube. Áudio continua tocando mesmo fora do app.
                </div>
            </div>

            <div data-yt-stage class="yt-stage">
                <div data-yt-ph class="yt-ph"></div>
            </div>

            <div data-yt-info class="yt-info">
                <div data-yt-prog-wrap class="yt-prog-wrap">
                    <span data-yt-prog-cur class="yt-time">0:00</span>
                    <div class="yt-prog-track">
                        <div data-yt-prog-fill class="yt-prog-fill"></div>
                        <div data-yt-prog-thumb class="yt-prog-thumb"></div>
                    </div>
                    <span data-yt-prog-dur class="yt-time" style="text-align:right;">0:00</span>
                </div>
                <div class="yt-info-row">
                    <div style="flex:1;min-width:0;">
                        <div data-yt-info-name class="yt-info-name">—</div>
                        <div data-yt-info-artist class="yt-info-artist">—</div>
                    </div>
                    <button data-yt-change class="yt-btn-ghost">Trocar</button>
                    <button data-yt-clear class="yt-btn-danger">Sair</button>
                </div>
            </div>
        `;

        _wireApp(root);
        _ensureHost();
        _ensureMini();
        _renderMiniContent();
        _renderAppContent();
        _lastMode = null;
        _startTick();
    }

    function _unmountApp() {
        _stopAppProgress();
        _appRoot = null;
        _placeholder = null;
        _loadingEls = null;
        _lastMode = null;
        _lastSyncKey = '';
    }

    // ═══ REGISTER ═══
    ctx.apps.register({
        id: APP_ID,
        name: 'YouTube',
        icon: ICON,
        accent: ACCENT,
        bg: 'linear-gradient(135deg, #1a0508, #0a0305)',
        order: 8,
        dock: false,
        fullscreen: true,

        mount(root) { if (root) _mountApp(root); },
        unmount() { _unmountApp(); }
    });

    // ═══ RE-RENDER HOME (register tardio) ═══
    try {
        const P = window._phone;
        if (P?.state?.view === 'home') P.home?.renderHome?.();
    } catch(_) {}

    // ═══ TEARDOWN ═══
    try {
        ctx._registerCleanup?.(() => {
            _stopTick();
            _stopMiniProgress();
            _stopAppProgress();
            if (_ytPlayer && _ytReady) {
                try { _ytPlayer.destroy(); } catch(_) {}
            }
            _ytPlayer = null;
            _ytReady = false;
            _ytQueue.length = 0;
            if (_ytHost) { try { _ytHost.remove(); } catch(_) {} _ytHost = null; _ytContainer = null; }
            if (_mini) { try { _mini.remove(); } catch(_) {} _mini = null; _miniEls = null; }
        });
    } catch(_) {}

    // ═══ CSS ═══
    ctx.appendStyle(`
        @keyframes ytSpin { to { transform: rotate(360deg); } }
        @keyframes ytFadeUp {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ytPop {
            0%   { opacity: 0; transform: scale(.94); }
            60%  { opacity: 1; transform: scale(1.02); }
            100% { opacity: 1; transform: scale(1); }
        }
        @keyframes ytPulse {
            0%,100% { box-shadow: 0 0 0 0 rgba(255,0,51,0.35); }
            50%     { box-shadow: 0 0 0 14px rgba(255,0,51,0); }
        }
        @keyframes ytShimmer {
            0%   { background-position: -180% 0; }
            100% { background-position: 180% 0; }
        }

        [data-youtube] *, [data-youtube-mini] * {
            scrollbar-width: none;
            -ms-overflow-style: none;
        }
        [data-youtube] *::-webkit-scrollbar,
        [data-youtube-mini] *::-webkit-scrollbar {
            width: 0 !important; height: 0 !important; display: none !important;
        }

        [data-youtube] { border: 0 !important; }
        [data-youtube] > div { width: 100%; height: 100%; }

        [data-yt-stage] {
            display: none;
            flex: 1;
            min-height: 0;
            padding: 12px 14px 6px;
            align-items: center;
            justify-content: center;
            animation: ytFadeUp .32s cubic-bezier(.22,1,.36,1);
        }
        .yt-ph {
            width: 100%;
            max-height: 100%;
            aspect-ratio: 16 / 9;
            border-radius: 14px;
            background: #050505;
            border: 1px solid rgba(255,255,255,.05);
            box-shadow: 0 12px 40px rgba(0,0,0,.5);
        }

        .yt-input-screen {
            flex: 1;
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 24px 22px;
            gap: 14px;
            animation: ytFadeUp .32s cubic-bezier(.22,1,.36,1);
        }
        .yt-hero-icon {
            width: 66px;
            height: 66px;
            border-radius: 20px;
            background: radial-gradient(circle at 50% 30%, rgba(255,0,51,0.24), rgba(255,0,51,0.08));
            border: 1px solid rgba(255,0,51,0.42);
            display: flex; align-items: center; justify-content: center;
            color: ${ACCENT};
            animation: ytPop .5s cubic-bezier(.22,1,.36,1);
            box-shadow: 0 0 40px rgba(255,0,51,0.18), inset 0 1px 0 rgba(255,255,255,.08);
        }
        .yt-hero-title {
            font-size: 16px; font-weight: 800; color: #fff;
            letter-spacing: .01em; margin-bottom: 6px;
        }
        .yt-hero-sub {
            font-size: 11px; color: #9ca3af; line-height: 1.55;
        }
        .yt-hero-sub b { color: ${ACCENT_SOFT}; font-weight: 700; }
        .yt-hero-note {
            font-size: 9.5px; color: #6b7280; text-align: center;
            max-width: 280px; line-height: 1.5;
        }

        .yt-input {
            width: 100%; max-width: 300px;
            padding: 11px 14px;
            border-radius: 12px;
            background: rgba(255,255,255,.045);
            border: 1px solid rgba(255,255,255,.1);
            color: #e9ecf5;
            font-family: inherit;
            font-size: 11.5px;
            outline: none;
            transition: border-color .2s, box-shadow .2s, background .2s;
        }
        .yt-input::placeholder { color: #6b7280; }
        .yt-input:hover { border-color: rgba(255,255,255,.16); background: rgba(255,255,255,.06); }
        .yt-input:focus {
            border-color: rgba(255,0,51,.55);
            background: rgba(255,255,255,.07);
            box-shadow: 0 0 0 3px rgba(255,0,51,.14), 0 0 22px rgba(255,0,51,.12);
        }

        .yt-btn-primary {
            width: 100%; max-width: 300px;
            padding: 12px;
            border-radius: 12px;
            background: linear-gradient(120deg, ${ACCENT}, ${ACCENT_SOFT});
            border: none;
            color: #fff;
            font-family: inherit;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: .04em;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: transform .15s cubic-bezier(.22,1,.36,1), box-shadow .22s, filter .2s;
            box-shadow: 0 8px 24px rgba(255,0,51,.28), inset 0 1px 0 rgba(255,255,255,.2);
        }
        .yt-btn-primary:hover:not(:disabled) {
            filter: brightness(1.08);
            box-shadow: 0 12px 30px rgba(255,0,51,.4), inset 0 1px 0 rgba(255,255,255,.24);
            transform: translateY(-1px);
        }
        .yt-btn-primary:active:not(:disabled) {
            transform: translateY(0) scale(.98);
        }
        .yt-btn-primary:disabled { opacity: .65; cursor: wait; }
        .yt-btn-primary.is-loading { animation: ytPulse 1.4s ease-in-out infinite; }

        .yt-info {
            display: none;
            flex-direction: column;
            gap: 10px;
            padding: 12px 14px 14px;
            background: linear-gradient(180deg, rgba(0,0,0,.5), rgba(0,0,0,.62));
            backdrop-filter: blur(14px) saturate(140%);
            -webkit-backdrop-filter: blur(14px) saturate(140%);
            border-top: 1px solid rgba(255,255,255,.06);
            flex-shrink: 0;
            animation: ytFadeUp .3s cubic-bezier(.22,1,.36,1);
        }
        .yt-info-row {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .yt-info-name {
            font-size: 11.5px; font-weight: 700; color: #fff;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .yt-info-artist {
            font-size: 9.5px; color: #9ca3af;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            margin-top: 2px;
        }

        .yt-prog-wrap {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            padding: 3px 0;
            border-radius: 8px;
            transition: background .18s;
        }
        .yt-prog-wrap:hover { background: rgba(255,255,255,.03); }
        .yt-time {
            font-size: 9.5px;
            color: #9ca3af;
            font-variant-numeric: tabular-nums;
            flex-shrink: 0;
            min-width: 34px;
        }
        .yt-prog-track {
            flex: 1;
            position: relative;
            height: 4px;
            border-radius: 3px;
            background: rgba(255,255,255,.09);
            overflow: visible;
        }
        .yt-prog-fill {
            position: absolute; left: 0; top: 0; bottom: 0;
            width: 0%;
            background: linear-gradient(90deg, ${ACCENT}, ${ACCENT_SOFT});
            border-radius: 3px;
            transition: width .15s linear;
            box-shadow: 0 0 10px rgba(255,0,51,.4);
        }
        .yt-prog-thumb {
            position: absolute;
            top: 50%;
            left: 0%;
            width: 10px; height: 10px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 0 0 2px ${ACCENT}, 0 0 8px rgba(255,0,51,.7);
            transform: translate(-50%, -50%) scale(0);
            transition: left .15s linear, transform .2s;
            pointer-events: none;
        }
        .yt-prog-wrap:hover .yt-prog-thumb { transform: translate(-50%, -50%) scale(1); }

        .yt-btn-ghost, .yt-btn-danger {
            padding: 6px 11px;
            border-radius: 8px;
            font-family: inherit;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .02em;
            cursor: pointer;
            transition: background .16s, border-color .16s, transform .12s, color .16s;
            flex-shrink: 0;
        }
        .yt-btn-ghost {
            background: rgba(255,255,255,.05);
            border: 1px solid rgba(255,255,255,.1);
            color: #c7cad6;
        }
        .yt-btn-ghost:hover {
            background: rgba(255,255,255,.1);
            border-color: rgba(255,255,255,.2);
            color: #fff;
        }
        .yt-btn-ghost:active { transform: scale(.96); }
        .yt-btn-danger {
            background: rgba(251,113,133,.1);
            border: 1px solid rgba(251,113,133,.3);
            color: #fca5b1;
        }
        .yt-btn-danger:hover {
            background: rgba(251,113,133,.2);
            border-color: rgba(251,113,133,.5);
            color: #fff;
        }
        .yt-btn-danger:active { transform: scale(.96); }

        .yt-mini-head {
            padding: 12px 14px 8px;
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            transition: background .18s;
        }
        .yt-mini-head:hover { background: rgba(255,255,255,.025); }
        .yt-mini-badge {
            width: 34px; height: 34px; flex-shrink: 0;
            border-radius: 10px;
            background: radial-gradient(circle at 50% 30%, rgba(255,0,51,.22), rgba(255,0,51,.06));
            border: 1px solid rgba(255,0,51,.4);
            display: flex; align-items: center; justify-content: center;
            color: ${ACCENT_SOFT};
            transition: transform .22s cubic-bezier(.22,1,.36,1), box-shadow .22s;
            box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
        }
        .yt-mini-head:hover .yt-mini-badge {
            transform: scale(1.05);
            box-shadow: 0 0 14px rgba(255,0,51,.35), inset 0 1px 0 rgba(255,255,255,.1);
        }
        .yt-mini-name {
            font-size: 12px; font-weight: 800; color: #fff;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .yt-mini-artist {
            font-size: 10px; color: #9ca3af;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            margin-top: 1px;
        }

        .yt-mini-btn {
            width: 26px; height: 26px;
            border-radius: 8px;
            background: transparent;
            border: 1px solid rgba(255,255,255,.12);
            color: #c7cad6;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            padding: 0;
            flex-shrink: 0;
            transition: background .16s, border-color .16s, color .16s, transform .12s;
        }
        .yt-mini-btn:hover {
            background: rgba(255,255,255,.06);
            border-color: rgba(255,255,255,.2);
            color: #fff;
            transform: translateY(-1px);
        }
        .yt-mini-btn:active { transform: scale(.92); }
        .yt-mini-btn.is-muted {
            color: #fca5b1;
            border-color: rgba(251,113,133,.35);
            background: rgba(251,113,133,.08);
        }
        .yt-mini-close:hover {
            background: rgba(251,113,133,.15) !important;
            border-color: rgba(251,113,133,.4) !important;
            color: #fca5b1 !important;
        }

        .yt-mini-play {
            width: 30px; height: 30px;
            background: rgba(255,0,51,.14);
            border: 1px solid rgba(255,0,51,.42);
            color: ${ACCENT_SOFT};
            transition: background .18s, box-shadow .22s, transform .18s;
        }
        .yt-mini-play:hover {
            background: rgba(255,0,51,.24) !important;
            box-shadow: 0 0 16px rgba(255,0,51,.45);
            border-color: rgba(255,0,51,.6) !important;
            color: #fff !important;
            transform: translateY(-1px) scale(1.04) !important;
        }
        .yt-mini-play:active { transform: scale(.94) !important; }

        .yt-mini-prog {
            padding: 4px 14px 2px;
            cursor: pointer;
            border-radius: 8px;
        }
        .yt-mini-prog-track {
            position: relative;
            height: 3px;
            border-radius: 2px;
            background: rgba(255,255,255,.14);
        }
        .yt-mini-prog-fill {
            position: absolute; left: 0; top: 0; bottom: 0;
            width: 0%;
            background: linear-gradient(90deg, ${ACCENT}, ${ACCENT_SOFT});
            border-radius: 2px;
            transition: width .15s linear;
            box-shadow: 0 0 8px rgba(255,0,51,.5);
        }
        .yt-mini-prog-thumb {
            position: absolute;
            top: 50%;
            left: 0%;
            width: 9px; height: 9px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 0 0 2px ${ACCENT}, 0 0 8px rgba(255,0,51,.7);
            transform: translate(-50%, -50%) scale(0);
            transition: left .15s linear, transform .22s cubic-bezier(.22,1,.36,1);
            pointer-events: none;
        }
        .yt-mini-prog:hover .yt-mini-prog-thumb { transform: translate(-50%, -50%) scale(1); }

        .yt-mini-controls {
            padding: 8px 14px 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .yt-mini-range {
            flex: 1;
            -webkit-appearance: none;
            appearance: none;
            background: transparent;
            height: 4px;
            padding: 0;
            margin: 0;
            cursor: pointer;
            outline: none;
        }
        .yt-mini-range::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 2px;
            background: rgba(255,255,255,.15);
            transition: background .18s;
        }
        .yt-mini-range:hover::-webkit-slider-runnable-track {
            background: rgba(255,255,255,.25);
        }
        .yt-mini-range::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 11px; height: 11px;
            border-radius: 50%;
            background: #fff;
            border: 2px solid ${ACCENT};
            margin-top: -4px;
            box-shadow: 0 0 8px rgba(255,0,51,.7);
            cursor: pointer;
            transition: transform .14s, box-shadow .2s;
        }
        .yt-mini-range:hover::-webkit-slider-thumb { transform: scale(1.12); }
        .yt-mini-range:active::-webkit-slider-thumb {
            transform: scale(1.25);
            box-shadow: 0 0 12px rgba(255,0,51,.95);
        }
        .yt-mini-range::-moz-range-track {
            height: 3px;
            border-radius: 2px;
            background: rgba(255,255,255,.15);
        }
        .yt-mini-range::-moz-range-thumb {
            width: 9px; height: 9px;
            border-radius: 50%;
            background: #fff;
            border: 2px solid ${ACCENT};
            box-shadow: 0 0 8px rgba(255,0,51,.7);
            cursor: pointer;
        }
    `);

    console.log('[YouTube] registrado com sucesso');

    } catch (e) {
        console.error('[YouTube] falha no boot:', e);
    }
})();
