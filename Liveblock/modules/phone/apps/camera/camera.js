// modules/phone/apps/camera/camera.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Camera] phone ctx ausente'); return; }
    if (ctx.apps.get('camera')) return;

    // ═══ CONFIG ═══
    const APP_ID = 'camera';
    const DB_NAME = 'ga_module_db';
    const STORE = 'photos';
    const FOLDER_STORE = 'folders';
    const CAM_FOLDER_NAME = 'Câmera';
    const PREVIEW_FPS = 20;
    const HIDE_BAR_CLASS = 'sz-hide-bar';
    const UNLOCK_CLASS = 'cam-unlocked';
    const LS_SETTINGS = 'sanghub_phone_app_camera_settings';
    const FIND_BACKOFF_MS = 600;
    const EFFECTS_VERSION = '0.2.0';
    const AUDIO_VERSION = '0.1.0';
    const STYLE_VERSION = '0.1.0';

    const PHOTO_QUALITY_PRESETS = Object.freeze({
        low:    { jpeg: 0.72, pngScale: 0.6 },
        normal: { jpeg: 0.85, pngScale: 0.85 },
        high:   { jpeg: 0.95, pngScale: 1.0 }
    });
    const VIDEO_QUALITY_PRESETS = Object.freeze({
        low:    { maxDim: 480,  bitrate: 1500000 },
        normal: { maxDim: 720,  bitrate: 2500000 },
        high:   { maxDim: 1080, bitrate: 4000000 }
    });
    const VIDEO_MAX_SEC_OPTIONS = [15, 30, 60];
    const SELF_TIMER_OPTIONS = [0, 3, 10];
    const PHOTO_FORMAT_OPTIONS = ['jpg', 'png'];

    const DEFAULT_SETTINGS = Object.freeze({
        pageAudio: false,
        voice: false,
        photoQuality: 'normal',
        photoFormat: 'jpg',
        videoQuality: 'normal',
        videoMaxSec: 15,
        selfTimer: 0,
        zoom: 1.0,
        stabilization: 0.35,
        motionBlur: true,
        vignette: false,
        timestamp: false
    });

    const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.3"/></svg>`;

    // ═══ STATE ═══
    let _root = null;
    let _previewBox = null;
    let _previewCanvas = null;
    let _flashEl = null;
    let _countdownEl = null;
    let _zoomIndicatorEl = null;
    let _recIndicator = null;
    let _recTimerEl = null;
    let _thumbEl = null;
    let _shutterBtn = null;
    let _videoBtn = null;
    let _statusEl = null;
    let _settingsPanel = null;

    let _targetCanvas = null;
    let _rafId = 0;
    let _lastDraw = 0;
    let _previewRunning = false;
    let _lastFindAttempt = 0;
    let _frameRef = null;

    let _captureVideo = null;
    let _captureStream = null;

    let _recorder = null;
    let _recChunks = [];
    let _recStartedAt = 0;
    let _recTimer = null;
    let _recTimeout = null;
    let _recording = false;
    let _recCancelled = false;
    let _recordCanvas = null;
    let _recordStream = null;
    let _activeAudioCleanup = null;

    let _phoneDragCleanup = null;
    let _dragRetryCount = 0;
    let _frameUnlockLog = null;
    let _frameObserver = null;
    let _stickyExiter = null;

    let _lastThumbUrl = null;
    let _effectsPromise = null;
    let _audioPromise = null;
    let _stylePromise = null;

    let _countdownTimer = null;
    let _countdownValue = 0;
    let _zoomIndicatorTimer = null;

    // ═══ DRAG FILTER ═══
    const _dragEuro = {
        x: { v: null, raw: null, dx: 0 },
        y: { v: null, raw: null, dx: 0 }
    };
    let _dragEuroLastT = 0;

    // ═══ AUDIO BRIDGE ═══
    const _camAudioStub = {
        setRecording: () => {},
        isRecording: () => false,
        duckHubSfx: () => {},
        unduckHubSfx: () => {},
        playShutter: () => {},
        playRecStart: () => {},
        playRecStop: () => {},
        playError: () => {},
        playToggle: () => {},
        playCountdownBeep: () => {},
        playZoomTick: () => {},
        buildMixedAudioTrack: async () => null,
        releaseMic: () => {},
        releasePageAudio: () => {}
    };
    function _A() { return window._camAudio || _camAudioStub; }

    // ═══ STORAGE ═══
    (function installStorage() {
        if (window._gaStorage) return;
        const S = {};
        let dbPromise = null;
        function openDb() {
            if (dbPromise) return dbPromise;
            dbPromise = new Promise((res, rej) => {
                const req = indexedDB.open(DB_NAME, 2);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
                    if (!db.objectStoreNames.contains(FOLDER_STORE)) db.createObjectStore(FOLDER_STORE, { keyPath: 'id' });
                };
                req.onsuccess = () => { const db = req.result; db.onclose = () => { dbPromise = null; }; res(db); };
                req.onerror = () => { dbPromise = null; rej(req.error); };
            });
            return dbPromise;
        }
        S.openDb = openDb;
        S.putPhoto = async (p) => { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(p); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
        S.getAllPhotos = async () => { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const r = tx.objectStore(STORE).getAll(); r.onsuccess = () => res(r.result.sort((a, b) => b.createdAt - a.createdAt)); r.onerror = () => rej(r.error); }); };
        S.deletePhoto = async (id) => { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
        S.putFolder = async (f) => { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction(FOLDER_STORE, 'readwrite'); tx.objectStore(FOLDER_STORE).put(f); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
        S.getAllFolders = async () => { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction(FOLDER_STORE, 'readonly'); const r = tx.objectStore(FOLDER_STORE).getAll(); r.onsuccess = () => res(r.result.sort((a, b) => a.createdAt - b.createdAt)); r.onerror = () => rej(r.error); }); };
        S.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        S.ensureFolder = async (name) => {
            const all = await S.getAllFolders();
            const existing = all.find(f => f.name.toLowerCase() === name.toLowerCase());
            if (existing) return existing.id;
            const id = S.uid();
            await S.putFolder({ id, name, createdAt: Date.now() });
            return id;
        };
        window._gaStorage = S;
    })();
    const Store = window._gaStorage;

    // ═══ HELPERS ═══
    function tsName(prefix, ext) {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
        return `${prefix}_${stamp}.${ext}`;
    }
    function pickVideoMime() {
        const candidates = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4;codecs=h264,aac',
            'video/mp4'
        ];
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
        for (const m of candidates) {
            try { if (MediaRecorder.isTypeSupported(m)) return m; } catch(_) {}
        }
        return '';
    }
    function mimeToExt(mime) {
        if (!mime) return 'webm';
        const m = String(mime).toLowerCase();
        if (m.includes('mp4')) return 'mp4';
        if (m.includes('webm')) return 'webm';
        return 'webm';
    }

    // ═══ SETTINGS ═══
    function getSettings() {
        try {
            const raw = localStorage.getItem(LS_SETTINGS);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed ? { ...DEFAULT_SETTINGS, ...parsed } : { ...DEFAULT_SETTINGS };
        } catch(_) { return { ...DEFAULT_SETTINGS }; }
    }
    function saveSettings(s) {
        try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch(_) {}
    }
    function updateSetting(key, val) {
        const s = getSettings();
        s[key] = val;
        saveSettings(s);
        return s;
    }
    function getPhotoFormat() {
        const f = String(getSettings().photoFormat || 'jpg').toLowerCase();
        return PHOTO_FORMAT_OPTIONS.includes(f) ? f : 'jpg';
    }
    function getPhotoQuality() {
        return PHOTO_QUALITY_PRESETS[getSettings().photoQuality] || PHOTO_QUALITY_PRESETS.normal;
    }
    function getVideoPreset() {
        return VIDEO_QUALITY_PRESETS[getSettings().videoQuality] || VIDEO_QUALITY_PRESETS.normal;
    }
    function getVideoMaxMs() {
        const n = Number(getSettings().videoMaxSec);
        return (VIDEO_MAX_SEC_OPTIONS.includes(n) ? n : 15) * 1000;
    }
    function getSelfTimerSec() {
        const n = Number(getSettings().selfTimer);
        return SELF_TIMER_OPTIONS.includes(n) ? n : 0;
    }

    // ═══ ENV para o módulo de áudio ═══
    window._camAudioEnv = { getSettings };

    // ═══ MODULE LOADERS ═══
    function _injectModule(url, check, label) {
        return (async () => {
            try {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const code = await res.text();
                const s = document.createElement('script');
                s.textContent = code;
                document.documentElement.appendChild(s);
                s.remove();
                return !!check();
            } catch(e) {
                console.warn('[Camera] ' + label + ' não carregou:', e);
                return false;
            }
        })();
    }

    function loadStyleModule() {
        if (window._camStyle) { try { window._camStyle.install(); } catch(_) {} return Promise.resolve(true); }
        if (_stylePromise) return _stylePromise;
        const base = (ctx.moduleBase || '').replace(/\/+$/, '');
        const url = base + '/apps/camera/camerastyle.js?v=' + STYLE_VERSION;
        _stylePromise = _injectModule(url, () => window._camStyle, 'camerastyle.js')
            .then((ok) => { if (ok) try { window._camStyle.install(); } catch(_) {} return ok; })
            .finally(() => { _stylePromise = null; });
        return _stylePromise;
    }

    function loadAudioModule() {
        if (window._camAudio) return Promise.resolve(true);
        if (_audioPromise) return _audioPromise;
        const base = (ctx.moduleBase || '').replace(/\/+$/, '');
        const url = base + '/apps/camera/camera-audio.js?v=' + AUDIO_VERSION;
        _audioPromise = _injectModule(url, () => window._camAudio, 'camera-audio.js')
            .finally(() => { _audioPromise = null; });
        return _audioPromise;
    }

    function loadEffects() {
        if (window._camEffects) return Promise.resolve(true);
        if (_effectsPromise) return _effectsPromise;
        const base = (ctx.moduleBase || '').replace(/\/+$/, '');
        const url = base + '/apps/camera/cameffects.js?v=' + EFFECTS_VERSION;
        _effectsPromise = _injectModule(url, () => window._camEffects, 'cameffects.js')
            .finally(() => { _effectsPromise = null; });
        return _effectsPromise;
    }

    // Sincroniza o estado com o módulo de efeitos. Se o módulo ainda não
    // chegou, enfileira a aplicação para quando ele carregar.
    function syncEffectsState() {
        const s = getSettings();
        const payload = {
            zoom: Number(s.zoom) || 1,
            motionBlur: !!s.motionBlur,
            vignette: !!s.vignette,
            timestamp: !!s.timestamp
        };
        const apply = () => {
            const EF = window._camEffects;
            if (!EF || !EF.setState) return false;
            try { EF.setState(payload); } catch(_) { return false; }
            return true;
        };
        if (apply()) return;
        loadEffects().then((ok) => { if (ok) apply(); });
    }

    // ═══ DRAG FILTER — One Euro no input ═══
    function _dragEuroAlpha(cutoff, dt) {
        const tau = 1 / (2 * Math.PI * cutoff);
        return 1 / (1 + tau / dt);
    }
    function _dragEuroReset(baseX, baseY) {
        const now = performance.now();
        _dragEuro.x.v = baseX; _dragEuro.x.raw = baseX; _dragEuro.x.dx = 0;
        _dragEuro.y.v = baseY; _dragEuro.y.raw = baseY; _dragEuro.y.dx = 0;
        _dragEuroLastT = now;
    }
    function _dragEuroStep(s, raw, dt, fcMin, beta, dCutoff) {
        const freq = 1 / dt;
        const dxRaw = (raw - s.raw) * freq;
        const aD = _dragEuroAlpha(dCutoff, dt);
        s.dx = aD * dxRaw + (1 - aD) * s.dx;
        const cutoff = fcMin + beta * Math.abs(s.dx);
        const a = _dragEuroAlpha(cutoff, dt);
        s.v = a * raw + (1 - a) * s.v;
        s.raw = raw;
        return s.v;
    }
    function _dragEuroParams(stab) {
        const t = Math.min(1, Math.max(0, stab / 0.85));
        const fcMin = 2.0 - 1.5 * t;
        const beta  = 0.015 - 0.010 * t;
        return { fcMin, beta, dCutoff: 1.0 };
    }
    function _filterDragTarget(targetX, targetY, stab) {
        if (stab <= 0.001) return { x: targetX, y: targetY };
        const now = performance.now();
        const dt = Math.max(0.008, Math.min(0.05, (now - _dragEuroLastT) / 1000));
        _dragEuroLastT = now;
        const p = _dragEuroParams(stab);
        return {
            x: _dragEuroStep(_dragEuro.x, targetX, dt, p.fcMin, p.beta, p.dCutoff),
            y: _dragEuroStep(_dragEuro.y, targetY, dt, p.fcMin, p.beta, p.dCutoff)
        };
    }

    // ═══ ZOOM ═══
    function adjustZoom(delta) {
        const cur = Number(getSettings().zoom) || 1;
        const next = Math.min(3, Math.max(1, Math.round((cur + delta) * 10) / 10));
        if (next === cur) return;
        updateSetting('zoom', next);
        syncEffectsState();
        showZoomIndicator(next);
        _A().playZoomTick(delta > 0);
    }
    function showZoomIndicator(zoom) {
        if (!_zoomIndicatorEl) return;
        _zoomIndicatorEl.textContent = zoom.toFixed(1) + '×';
        _zoomIndicatorEl.classList.add('on');
        if (_zoomIndicatorTimer) clearTimeout(_zoomIndicatorTimer);
        _zoomIndicatorTimer = setTimeout(() => {
            _zoomIndicatorTimer = null;
            if (_zoomIndicatorEl) _zoomIndicatorEl.classList.remove('on');
        }, 900);
    }

    // ═══ SELF-TIMER ═══
    function clearCountdown() {
        if (_countdownTimer) { clearTimeout(_countdownTimer); _countdownTimer = null; }
        _countdownValue = 0;
        if (_countdownEl) {
            _countdownEl.classList.remove('on', 'pulse');
            _countdownEl.textContent = '';
        }
    }
    function startSelfTimer(seconds, onDone) {
        clearCountdown();
        _countdownValue = seconds;
        const tick = () => {
            if (_countdownValue <= 0) {
                clearCountdown();
                onDone();
                return;
            }
            if (_countdownEl) {
                _countdownEl.textContent = String(_countdownValue);
                _countdownEl.classList.remove('pulse');
                void _countdownEl.offsetWidth;
                _countdownEl.classList.add('on', 'pulse');
            }
            _A().playCountdownBeep(_countdownValue === 1);
            try { navigator.vibrate?.(20); } catch(_) {}
            _countdownValue--;
            _countdownTimer = setTimeout(tick, 1000);
        };
        tick();
    }
    function _triggerSnapshot() {
        if (_recording) return;
        if (_countdownTimer) { clearCountdown(); return; }
        const sec = getSelfTimerSec();
        if (sec > 0) startSelfTimer(sec, () => takePhoto());
        else takePhoto();
    }
    function _toggleRecording() {
        if (_recording) stopRecording(false);
        else startRecording();
    }

    // ═══ CANVAS FINDER ═══
    function findTargetCanvas() {
        const candidates = [];
        const seen = new WeakSet();
        function collectFrom(doc, depth) {
            if (!doc || depth > 3) return;
            try {
                const list = doc.querySelectorAll('canvas');
                for (const c of list) {
                    if (seen.has(c)) continue;
                    seen.add(c);
                    const w = c.offsetWidth || c.width || 0;
                    const h = c.offsetHeight || c.height || 0;
                    if (w > 80 && h > 80) candidates.push(c);
                }
                const iframes = doc.querySelectorAll('iframe');
                for (const f of iframes) {
                    try {
                        const inner = f.contentDocument || (f.contentWindow && f.contentWindow.document);
                        if (inner) collectFrom(inner, depth + 1);
                    } catch(_) {}
                }
            } catch(_) {}
        }
        collectFrom(document, 0);
        candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height));
        return candidates[0] || null;
    }

    // ═══ CAPTURE STREAM ═══
    function setupCaptureVideo(target) {
        teardownCaptureVideo();
        if (!target || typeof target.captureStream !== 'function') return;
        try {
            const stream = target.captureStream(30);
            if (!stream || !stream.getVideoTracks().length) return;
            const v = document.createElement('video');
            v.srcObject = stream;
            v.muted = true;
            v.playsInline = true;
            v.autoplay = true;
            const p = v.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
            _captureVideo = v;
            _captureStream = stream;
        } catch(e) {
            console.warn('[Camera] captureStream falhou:', e);
            _captureVideo = null;
            _captureStream = null;
        }
    }
    function teardownCaptureVideo() {
        if (_captureVideo) {
            try { _captureVideo.pause(); _captureVideo.srcObject = null; } catch(_) {}
            _captureVideo = null;
        }
        if (_captureStream) {
            try { _captureStream.getTracks().forEach(t => t.stop()); } catch(_) {}
            _captureStream = null;
        }
    }
    function hasLiveVideo() {
        return _captureVideo && _captureVideo.readyState >= 2 && _captureVideo.videoWidth > 0;
    }

    // ═══ LAYOUT ═══
    function computeLayout() {
        const target = _targetCanvas;
        const box = _previewBox;
        if (!target || !box) return null;
        const cr = target.getBoundingClientRect();
        const pr = box.getBoundingClientRect();
        if (!cr.width || !cr.height || !pr.width || !pr.height) return null;

        const ix1 = Math.max(cr.left, pr.left);
        const iy1 = Math.max(cr.top, pr.top);
        const ix2 = Math.min(cr.right, pr.right);
        const iy2 = Math.min(cr.bottom, pr.bottom);

        const srcEl = hasLiveVideo() ? _captureVideo : target;
        const srcPixelW = srcEl.videoWidth || srcEl.width || target.width || 1;
        const srcPixelH = srcEl.videoHeight || srcEl.height || target.height || 1;

        const boxW = Math.round(pr.width);
        const boxH = Math.round(pr.height);

        if (ix2 - ix1 < 4 || iy2 - iy1 < 4) {
            return { empty: true, srcEl, boxW, boxH };
        }

        const scaleX = srcPixelW / cr.width;
        const scaleY = srcPixelH / cr.height;

        const sx = (ix1 - cr.left) * scaleX;
        const sy = (iy1 - cr.top)  * scaleY;
        const sw = (ix2 - ix1)     * scaleX;
        const sh = (iy2 - iy1)     * scaleY;

        const dx = ix1 - pr.left;
        const dy = iy1 - pr.top;
        const dw = ix2 - ix1;
        const dh = iy2 - iy1;

        return { empty: false, srcEl, sx, sy, sw, sh, dx, dy, dw, dh, boxW, boxH };
    }

    // ═══ FRAME REF ═══
    function findFrameEl() {
        let el = _root;
        let hops = 0;
        while (el && hops < 30) {
            hops++;
            if (el.classList && el.classList.contains('ph-frame')) return el;
            const parent = el.parentElement;
            if (parent) { el = parent; continue; }
            const rootNode = el.getRootNode && el.getRootNode();
            if (rootNode && rootNode.host && rootNode.host !== el) { el = rootNode.host; continue; }
            break;
        }
        const candidates = [
            ctx.frameEl,
            window._phone?.state?.frameEl,
            (() => { try { return ctx.root?.querySelector?.('.ph-frame'); } catch(_) { return null; } })(),
            (() => { try { return window._phone?.core?.getShadow?.()?.querySelector?.('.ph-frame'); } catch(_) { return null; } })(),
            (() => { try { return window._phone?.core?.getFrame?.(); } catch(_) { return null; } })()
        ];
        for (const c of candidates) if (c && c.style) return c;
        return null;
    }
    function getFrame() {
        if (_frameRef && _frameRef.isConnected) return _frameRef;
        _frameRef = findFrameEl();
        return _frameRef;
    }
    function frameIsMinimized() {
        const f = getFrame();
        return !!(f && f.classList.contains('min'));
    }
    function _cameraVisible() {
        if (!_root || !_root.isConnected) return false;
        if (document.hidden) return false;
        const f = getFrame();
        if (f && (f.classList.contains('hidden') || f.classList.contains('min'))) return false;
        return true;
    }
    function _inSettingsPanel(node) {
        let el = node;
        while (el) {
            if (el.classList && el.classList.contains('cam-settings-overlay')) return true;
            el = el.parentNode;
        }
        return false;
    }

    // ═══ PREVIEW LOOP ═══
    function setStatus(msg) {
        if (!_statusEl) return;
        if (_statusEl.textContent !== (msg || '')) _statusEl.textContent = msg || '';
        _statusEl.classList.toggle('on', !!msg);
    }

    function startPreview() {
        stopPreview();
        _previewRunning = true;
        _lastDraw = 0;
        if (!_previewCanvas) return;
        const g = _previewCanvas.getContext('2d');

        function frame(ts) {
            if (!_previewRunning) return;
            _rafId = requestAnimationFrame(frame);

            if (document.hidden) return;
            if (!_recording && frameIsMinimized()) return;

            if (ts - _lastDraw < 1000 / PREVIEW_FPS) return;
            _lastDraw = ts;

            if (!_targetCanvas || !_targetCanvas.isConnected) {
                if (ts - _lastFindAttempt > FIND_BACKOFF_MS) {
                    _lastFindAttempt = ts;
                    teardownCaptureVideo();
                    _targetCanvas = findTargetCanvas();
                    if (_targetCanvas) setupCaptureVideo(_targetCanvas);
                }
            }
            if (!_targetCanvas) {
                setStatus('Procurando tela do jogo…');
                paintEmptyPreview();
                return;
            }
            if (!_captureStream) setupCaptureVideo(_targetCanvas);

            const layout = computeLayout();
            if (!layout) { paintEmptyPreview(); return; }
            if (layout.empty) {
                setStatus('Aponte o celular para o jogo');
                paintEmptyPreview(layout.boxW, layout.boxH);
                return;
            }
            setStatus('');

            if (_previewCanvas.width !== layout.boxW || _previewCanvas.height !== layout.boxH) {
                _previewCanvas.width = layout.boxW;
                _previewCanvas.height = layout.boxH;
            }

            g.fillStyle = '#050505';
            g.fillRect(0, 0, _previewCanvas.width, _previewCanvas.height);

            const EF = window._camEffects;
            if (EF && EF.processFrame) {
                EF.processFrame(
                    layout.srcEl,
                    { sx: layout.sx, sy: layout.sy, sw: layout.sw, sh: layout.sh },
                    g,
                    { dx: layout.dx, dy: layout.dy, dw: layout.dw, dh: layout.dh },
                    ts
                );
            } else {
                try {
                    g.drawImage(
                        layout.srcEl,
                        layout.sx, layout.sy, layout.sw, layout.sh,
                        layout.dx, layout.dy, layout.dw, layout.dh
                    );
                } catch(_) {}
            }

            if (_recording) mirrorToRecordCanvas(layout);
        }
        _rafId = requestAnimationFrame(frame);
    }

    function paintEmptyPreview(w, h) {
        if (!_previewCanvas) return;
        const bw = w || _previewCanvas.width || 300;
        const bh = h || _previewCanvas.height || 400;
        if (_previewCanvas.width !== bw || _previewCanvas.height !== bh) {
            _previewCanvas.width = bw;
            _previewCanvas.height = bh;
        }
        const g = _previewCanvas.getContext('2d');
        g.fillStyle = '#050505';
        g.fillRect(0, 0, bw, bh);
    }

    function stopPreview() {
        _previewRunning = false;
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
    }

    // ═══ PHOTO ═══
    async function takePhoto() {
        if (_recording) return;
        const layout = computeLayout();
        if (!layout) { _A().playError(); ctx.toast?.('Nada para capturar', 'err'); return; }
        if (layout.empty) { _A().playError(); ctx.toast?.('Aponte o celular para o jogo', 'err'); return; }

        const format = getPhotoFormat();
        const quality = getPhotoQuality();

        const cv = document.createElement('canvas');
        let outW = Math.max(1, Math.round(layout.sw));
        let outH = Math.max(1, Math.round(layout.sh));

        if (format === 'png' && quality.pngScale < 1) {
            outW = Math.max(1, Math.round(outW * quality.pngScale));
            outH = Math.max(1, Math.round(outH * quality.pngScale));
        }

        cv.width = outW;
        cv.height = outH;
        const g = cv.getContext('2d');

        const ok = await new Promise(resolve => {
            requestAnimationFrame(() => {
                try {
                    const EF = window._camEffects;
                    if (EF && EF.processFrame) {
                        EF.processFrame(
                            layout.srcEl,
                            { sx: layout.sx, sy: layout.sy, sw: layout.sw, sh: layout.sh },
                            g,
                            { dx: 0, dy: 0, dw: cv.width, dh: cv.height },
                            performance.now(),
                            { allowMotionBlur: false, snapshot: true }
                        );
                    } else {
                        g.drawImage(
                            layout.srcEl,
                            layout.sx, layout.sy, layout.sw, layout.sh,
                            0, 0, cv.width, cv.height
                        );
                    }
                    resolve(true);
                } catch(_) { resolve(false); }
            });
        });
        if (!ok) { _A().playError(); ctx.toast?.('Falha ao capturar', 'err'); return; }

        let blob;
        try {
            if (format === 'png') {
                blob = await new Promise(r => cv.toBlob(r, 'image/png'));
            } else {
                blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', quality.jpeg));
            }
        } catch(_) { blob = null; }

        if (!blob) { _A().playError(); ctx.toast?.('Falha ao gerar imagem', 'err'); return; }

        const ext = format === 'png' ? 'png' : 'jpg';
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';

        const folderId = await Store.ensureFolder(CAM_FOLDER_NAME);
        const item = {
            id: Store.uid(),
            kind: 'photo',
            name: tsName('IMG', ext),
            createdAt: Date.now(),
            folderId,
            mime,
            width: cv.width,
            height: cv.height,
            blob
        };
        try { await Store.putPhoto(item); }
        catch(e) { console.warn('[Camera] putPhoto:', e); _A().playError(); ctx.toast?.('Falha ao salvar', 'err'); return; }

        _A().playShutter();
        fireFlash();
        try { navigator.vibrate?.(20); } catch(_) {}
        updateThumb(URL.createObjectURL(blob), 'photo');
        ctx.toast?.('Foto salva', 'ok');
    }

    // ═══ VIDEO ═══
    function computeRecordDimensions(layout) {
        const preset = getVideoPreset();
        const maxDim = preset.maxDim;
        const srcAr = layout.sw / layout.sh;
        let w, h;
        if (srcAr >= 1) {
            w = maxDim;
            h = Math.round(maxDim / srcAr);
        } else {
            h = maxDim;
            w = Math.round(maxDim * srcAr);
        }
        if (w < 2) w = 2;
        if (h < 2) h = 2;
        if (w % 2) w++;
        if (h % 2) h++;
        return { w, h };
    }
    function ensureRecordCanvas(w, h) {
        if (!_recordCanvas || _recordCanvas.width !== w || _recordCanvas.height !== h) {
            _recordCanvas = document.createElement('canvas');
            _recordCanvas.width = w;
            _recordCanvas.height = h;
        }
        return _recordCanvas;
    }
    function mirrorToRecordCanvas(layout) {
        if (!_recordCanvas || !layout || layout.empty || !_previewCanvas) return;
        const W = _recordCanvas.width;
        const H = _recordCanvas.height;
        const rg = _recordCanvas.getContext('2d');
        rg.fillStyle = '#000';
        rg.fillRect(0, 0, W, H);

        const srcAr = layout.dw / layout.dh;
        const dstAr = W / H;
        let dw, dh, dx, dy;
        if (Math.abs(srcAr - dstAr) < 0.001) {
            dx = 0; dy = 0; dw = W; dh = H;
        } else if (srcAr > dstAr) {
            dw = W; dh = W / srcAr;
            dx = 0; dy = (H - dh) / 2;
        } else {
            dh = H; dw = H * srcAr;
            dx = (W - dw) / 2; dy = 0;
        }

        try {
            rg.drawImage(
                _previewCanvas,
                layout.dx, layout.dy, layout.dw, layout.dh,
                dx, dy, dw, dh
            );
        } catch(_) {}
    }

    function startRecording() {
        if (_recording) return;
        if (!_targetCanvas) { _A().playError(); ctx.toast?.('Nada para gravar', 'err'); return; }
        const layout = computeLayout();
        if (!layout || layout.empty) { _A().playError(); ctx.toast?.('Aponte o celular para o jogo', 'err'); return; }

        const dims = computeRecordDimensions(layout);
        const rc = ensureRecordCanvas(dims.w, dims.h);
        mirrorToRecordCanvas(layout);

        let videoStream;
        try { videoStream = rc.captureStream(30); }
        catch(e) { _A().playError(); ctx.toast?.('Gravação não suportada', 'err'); return; }
        if (!videoStream || !videoStream.getVideoTracks().length) {
            _A().playError();
            ctx.toast?.('Sem stream de vídeo', 'err');
            return;
        }

        const combined = new MediaStream();
        videoStream.getVideoTracks().forEach(t => combined.addTrack(t));

        (async () => {
            await loadAudioModule();
            if (!_root || !_root.isConnected) {
                try { combined.getTracks().forEach(t => t.stop()); } catch(_) {}
                return;
            }

            let audioCleanup = null;
            try {
                const audio = await _A().buildMixedAudioTrack();
                if (audio && audio.track) {
                    combined.addTrack(audio.track);
                    audioCleanup = audio.cleanup;
                }
            } catch(e) {
                console.warn('[Camera] audio build fail:', e);
            }

            if (!_root || !_root.isConnected) {
                try { combined.getTracks().forEach(t => t.stop()); } catch(_) {}
                if (audioCleanup) { try { audioCleanup(); } catch(_) {} }
                _A().unduckHubSfx();
                return;
            }

            _activeAudioCleanup = audioCleanup;
            _recordStream = videoStream;

            let recorder;
            const mime = pickVideoMime();
            const bitrate = getVideoPreset().bitrate;
            try {
                recorder = mime
                    ? new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: bitrate })
                    : new MediaRecorder(combined);
            } catch(e) {
                try { combined.getTracks().forEach(t => t.stop()); } catch(_) {}
                _recordStream = null;
                if (_activeAudioCleanup) { try { _activeAudioCleanup(); } catch(_) {} _activeAudioCleanup = null; }
                _A().unduckHubSfx();
                _A().playError();
                ctx.toast?.('Gravador indisponível', 'err');
                return;
            }

            _recorder = recorder;
            _recChunks = [];
            _recording = true;
            _recCancelled = false;
            _recStartedAt = Date.now();

            _A().setRecording(true);
            if (getSettings().voice || getSettings().pageAudio) _A().duckHubSfx();

            recorder.ondataavailable = (e) => { if (e.data && e.data.size) _recChunks.push(e.data); };
            recorder.onerror = () => { stopRecording(true); };

            recorder.onstop = async () => {
                const wasCancelled = _recCancelled;
                _recCancelled = false;
                const chunks = _recChunks;
                const mimeOut = recorder.mimeType || 'video/webm';
                const durMs = Date.now() - _recStartedAt;

                _recorder = null;
                _recChunks = [];
                _recording = false;
                _A().setRecording(false);
                try { _recordStream?.getTracks().forEach(t => t.stop()); } catch(_) {}
                _recordStream = null;
                if (_activeAudioCleanup) {
                    try { _activeAudioCleanup(); } catch(_) {}
                    _activeAudioCleanup = null;
                }
                _A().unduckHubSfx();

                if (wasCancelled || !chunks.length) {
                    ctx.toast?.('Gravação cancelada', 'warn');
                    return;
                }
                const blob = new Blob(chunks, { type: mimeOut });
                const ext = mimeToExt(mimeOut);
                const folderId = await Store.ensureFolder(CAM_FOLDER_NAME);
                const item = {
                    id: Store.uid(),
                    kind: 'video',
                    name: tsName('VID', ext),
                    createdAt: Date.now(),
                    folderId,
                    mime: mimeOut,
                    durationMs: durMs,
                    blob
                };
                try {
                    await Store.putPhoto(item);
                    const url = URL.createObjectURL(blob);
                    updateThumb(url, 'video');
                    ctx.toast?.('Vídeo salvo', 'ok');
                } catch(e) {
                    console.warn('[Camera] video putPhoto:', e);
                    ctx.toast?.('Falha ao salvar vídeo', 'err');
                }
            };

            try { recorder.start(250); }
            catch(e) {
                _A().playError();
                ctx.toast?.('Falha ao iniciar gravação', 'err');
                _recording = false;
                _A().setRecording(false);
                try { combined.getTracks().forEach(t => t.stop()); } catch(_) {}
                _recordStream = null;
                if (_activeAudioCleanup) { try { _activeAudioCleanup(); } catch(_) {} _activeAudioCleanup = null; }
                _A().unduckHubSfx();
                _recorder = null;
                return;
            }

            _A().playRecStart();
            try { navigator.vibrate?.([15, 40, 15]); } catch(_) {}
            if (_recIndicator) _recIndicator.classList.add('on');
            if (_videoBtn) {
                _videoBtn.classList.add('rec');
                _videoBtn.textContent = '■';
            }
            startRecTimer();

            const maxMs = getVideoMaxMs();
            _recTimeout = setTimeout(() => {
                if (_recording) {
                    ctx.toast?.('Tempo máximo atingido', 'warn');
                    stopRecording(false);
                }
            }, maxMs);
        })();
    }

    function stopRecording(cancel) {
        if (!_recording || !_recorder) return;
        _recCancelled = !!cancel;
        _A().playRecStop();
        try { navigator.vibrate?.(15); } catch(_) {}
        if (_recIndicator) _recIndicator.classList.remove('on');
        if (_videoBtn) {
            _videoBtn.classList.remove('rec');
            _videoBtn.textContent = '▶';
        }
        stopRecTimer();
        if (_recTimeout) { clearTimeout(_recTimeout); _recTimeout = null; }
        try { _recorder.stop(); } catch(_) {}
    }

    function startRecTimer() {
        stopRecTimer();
        _recTimer = setInterval(() => {
            const ms = Date.now() - _recStartedAt;
            const s = Math.floor(ms / 1000);
            const m = Math.floor(s / 60);
            const ss = s % 60;
            if (_recTimerEl) _recTimerEl.textContent = `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
        }, 200);
    }
    function stopRecTimer() {
        if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
        if (_recTimerEl) _recTimerEl.textContent = '00:00';
    }

    // ═══ FLASH / THUMB ═══
    function fireFlash() {
        if (!_flashEl) return;
        _flashEl.classList.remove('fire');
        void _flashEl.offsetWidth;
        _flashEl.classList.add('fire');
    }
    function updateThumb(url, kind) {
        if (!_thumbEl) return;
        if (_lastThumbUrl && _lastThumbUrl.startsWith('blob:') && _lastThumbUrl !== url) {
            try { URL.revokeObjectURL(_lastThumbUrl); } catch(_) {}
        }
        _lastThumbUrl = url || null;
        if (!url) {
            _thumbEl.innerHTML = `<span class="cam-thumb-empty">🖼</span>`;
            return;
        }
        if (kind === 'video') {
            _thumbEl.innerHTML = `<video src="${url}" muted playsinline></video><span class="cam-thumb-play">▶</span>`;
        } else {
            _thumbEl.innerHTML = `<img src="${url}" alt="" />`;
        }
    }
    async function refreshThumbFromStore() {
        try {
            const all = await Store.getAllPhotos();
            const last = all[0];
            if (!last) { updateThumb(null, 'photo'); return; }
            if (last.kind === 'video' && last.blob) updateThumb(URL.createObjectURL(last.blob), 'video');
            else if (last.blob) updateThumb(URL.createObjectURL(last.blob), 'photo');
            else if (last.dataUrl) updateThumb(last.dataUrl, 'photo');
            else updateThumb(null, 'photo');
        } catch(_) {
            updateThumb(null, 'photo');
        }
    }

    // ═══ HIDE PHONE BAR ═══
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

    // ═══ CLOSE APP ═══
    function tryCall(obj, name) {
        try {
            if (obj && typeof obj[name] === 'function') { obj[name](); return true; }
        } catch(_) {}
        return false;
    }
    function closeApp() {
        const P = window._phone;
        if (tryCall(P?.apps, 'closeApp')) return;
        if (tryCall(P?.apps, 'close'))    return;
        if (tryCall(P?.core, 'closeApp')) return;
        if (tryCall(ctx,     'closeApp')) return;
        if (tryCall(P?.apps, 'openHome')) return;
        if (tryCall(P?.home, 'renderHome')) return;
        try { window.dispatchEvent(new CustomEvent('sang:phone-close-app')); } catch(_) {}
        ctx.toast?.('Não consegui fechar — use o botão físico', 'warn');
    }

    // ═══ FRAME UNLOCK ═══
    const LOCK_CLASS_PATTERN = /(^|-)(locked?|no-?drag|no-?move|fixed|pinned|frozen|static|disabled|trava(do)?)($|-)/i;

    function unlockFrame(frame) {
        if (!frame) return null;
        const log = { frame, classes: [], pe: [] };

        try {
            Array.from(frame.classList).forEach(c => {
                if (c !== UNLOCK_CLASS && LOCK_CLASS_PATTERN.test(c)) {
                    frame.classList.remove(c);
                    log.classes.push(c);
                }
            });
        } catch(_) {}

        try { frame.classList.add(UNLOCK_CLASS); } catch(_) {}

        try {
            if (frame.style.pointerEvents === 'none') {
                frame.style.pointerEvents = 'auto';
                log.pe.push({ el: frame, prev: 'none' });
            }
            let el = frame.parentElement;
            let hops = 0;
            while (el && hops < 8) {
                hops++;
                if (el.style && el.style.pointerEvents === 'none') {
                    el.style.pointerEvents = 'auto';
                    log.pe.push({ el, prev: 'none' });
                }
                if (el === document.body || el === document.documentElement) break;
                const rn = el.getRootNode && el.getRootNode();
                if (rn && rn.host && rn.host !== el) { el = rn.host; continue; }
                el = el.parentElement;
            }
        } catch(_) {}

        stopFrameObserver();
        try {
            _frameObserver = new MutationObserver(() => {
                try {
                    if (!frame.isConnected) return;
                    if (!frame.classList.contains(UNLOCK_CLASS)) {
                        frame.classList.add(UNLOCK_CLASS);
                    }
                    Array.from(frame.classList).forEach(c => {
                        if (c !== UNLOCK_CLASS && LOCK_CLASS_PATTERN.test(c)) {
                            frame.classList.remove(c);
                        }
                    });
                    if (frame.style.pointerEvents === 'none') {
                        frame.style.pointerEvents = 'auto';
                    }
                } catch(_) {}
            });
            _frameObserver.observe(frame, { attributes: true, attributeFilter: ['class', 'style'] });
        } catch(_) {}

        return log;
    }

    function lockFrameBack(log) {
        if (!log) return;
        try {
            log.frame.classList.remove(UNLOCK_CLASS);
            log.classes.forEach(c => { try { log.frame.classList.add(c); } catch(_) {} });
            log.pe.forEach(({ el, prev }) => { try { el.style.pointerEvents = prev; } catch(_) {} });
        } catch(_) {}
    }

    function stopFrameObserver() {
        if (_frameObserver) {
            try { _frameObserver.disconnect(); } catch(_) {}
            _frameObserver = null;
        }
    }

    // ═══ DRAG — grab e sticky, com filtro One Euro no input ═══
    function enablePhoneDrag(handle) {
        if (_phoneDragCleanup || !handle) return;
        const frame = getFrame();
        if (!frame) {
            if (_dragRetryCount < 15) {
                _dragRetryCount++;
                setTimeout(() => { if (_root && !_phoneDragCleanup) enablePhoneDrag(handle); }, 400);
            }
            return;
        }
        _dragRetryCount = 0;

        _frameUnlockLog = unlockFrame(frame);

        let stickyActive = false;
        let grabActive = false;
        let grabPid = null;
        let curX = 0, curY = 0;
        let baseMouseX = 0, baseMouseY = 0;
        let basePhoneX = 0, basePhoneY = 0;
        let dragStab = 0;
        let hasBase = false;

        try {
            curX = parseFloat(getComputedStyle(frame).getPropertyValue('--cam-drag-x')) || 0;
            curY = parseFloat(getComputedStyle(frame).getPropertyValue('--cam-drag-y')) || 0;
        } catch(_) {}

        function applyDrag() {
            frame.style.setProperty('--cam-drag-x', curX + 'px');
            frame.style.setProperty('--cam-drag-y', curY + 'px');
        }

        function beginBase(e) {
            baseMouseX = e.clientX;
            baseMouseY = e.clientY;
            basePhoneX = curX;
            basePhoneY = curY;
            dragStab = Number(getSettings().stabilization) || 0;
            _dragEuroReset(curX, curY);
            hasBase = true;
        }

        function applyMove(e) {
            if (!hasBase) beginBase(e);
            const targetX = basePhoneX + (e.clientX - baseMouseX);
            const targetY = basePhoneY + (e.clientY - baseMouseY);
            const filtered = _filterDragTarget(targetX, targetY, dragStab);
            curX = filtered.x;
            curY = filtered.y;
            applyDrag();
        }

        function onGrabDown(e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (stickyActive) return;
            if (e.detail > 1) { e.preventDefault(); return; }
            grabActive = true;
            grabPid = e.pointerId;
            beginBase(e);
            try { handle.setPointerCapture?.(e.pointerId); } catch(_) {}
            frame.style.transition = 'none';
            e.preventDefault();
            e.stopPropagation();
        }
        function onGrabMove(e) {
            if (!grabActive || e.pointerId !== grabPid) return;
            applyMove(e);
            e.preventDefault();
        }
        function onGrabUp(e) {
            if (!grabActive || e.pointerId !== grabPid) return;
            grabActive = false;
            grabPid = null;
            hasBase = false;
            try { handle.releasePointerCapture?.(e.pointerId); } catch(_) {}
            requestAnimationFrame(() => { try { frame.style.transition = ''; } catch(_) {} });
        }

        function onStickyMove(e) {
            if (!stickyActive) return;
            applyMove(e);
        }
        function onStickyRightClick(e) {
            if (!stickyActive) return;
            if (e.button === 2 || e.type === 'contextmenu') {
                e.preventDefault();
                e.stopPropagation();
                exitSticky();
            }
        }
        function onStickyKey(e) {
            if (!stickyActive) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                exitSticky();
            }
        }
        function enterSticky() {
            if (stickyActive) return;
            stickyActive = true;
            hasBase = false;
            frame.classList.add('cam-sticky-move');
            frame.style.transition = 'none';
            handle.classList.add('grip-active');
            document.addEventListener('mousemove', onStickyMove, true);
            document.addEventListener('mousedown', onStickyRightClick, true);
            document.addEventListener('contextmenu', onStickyRightClick, true);
            document.addEventListener('keydown', onStickyKey, true);
            try { ctx.toast?.('Modo mover ativo — duplo clique ou botão direito sai', 'info'); } catch(_) {}
        }
        function exitSticky() {
            if (!stickyActive) return;
            stickyActive = false;
            hasBase = false;
            frame.classList.remove('cam-sticky-move');
            requestAnimationFrame(() => { try { frame.style.transition = ''; } catch(_) {} });
            handle.classList.remove('grip-active');
            document.removeEventListener('mousemove', onStickyMove, true);
            document.removeEventListener('mousedown', onStickyRightClick, true);
            document.removeEventListener('contextmenu', onStickyRightClick, true);
            document.removeEventListener('keydown', onStickyKey, true);
        }
        function onDblClick(e) {
            e.preventDefault();
            e.stopPropagation();
            if (stickyActive) exitSticky();
            else enterSticky();
        }
        function onCtx(e) {
            e.preventDefault();
            e.stopPropagation();
            if (stickyActive) exitSticky();
        }

        handle.addEventListener('pointerdown', onGrabDown);
        window.addEventListener('pointermove', onGrabMove, true);
        window.addEventListener('pointerup', onGrabUp, true);
        window.addEventListener('pointercancel', onGrabUp, true);

        handle.addEventListener('dblclick', onDblClick);
        handle.addEventListener('contextmenu', onCtx);

        _stickyExiter = exitSticky;

        _phoneDragCleanup = () => {
            handle.removeEventListener('pointerdown', onGrabDown);
            window.removeEventListener('pointermove', onGrabMove, true);
            window.removeEventListener('pointerup', onGrabUp, true);
            window.removeEventListener('pointercancel', onGrabUp, true);
            handle.removeEventListener('dblclick', onDblClick);
            handle.removeEventListener('contextmenu', onCtx);
            if (stickyActive) exitSticky();
            _stickyExiter = null;
            stopFrameObserver();
            try { frame.style.transition = ''; } catch(_) {}
            try { frame.style.removeProperty('--cam-drag-x'); } catch(_) {}
            try { frame.style.removeProperty('--cam-drag-y'); } catch(_) {}
            lockFrameBack(_frameUnlockLog);
            _frameUnlockLog = null;
            _phoneDragCleanup = null;
        };
    }
    function disablePhoneDrag() {
        if (_phoneDragCleanup) { try { _phoneDragCleanup(); } catch(_) {} }
    }

    // ═══ GLOBAL WHEEL ═══
    function _onWheel(e) {
        if (!_cameraVisible()) return;
        const path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
        const realTarget = path[0] || e.target;
        if (_inSettingsPanel(realTarget)) return;
        const mode = e.deltaMode || 0;
        let d = e.deltaY;
        if (mode === 1) d *= 16;
        else if (mode === 2) d *= 400;
        if (Math.abs(d) < 1) return;
        e.preventDefault();
        e.stopPropagation();
        adjustZoom(d < 0 ? 0.1 : -0.1);
    }

    // ═══ GLOBAL KEYBOARD ═══
    function _onKey(e) {
        if (!_cameraVisible()) return;

        if (_settingsPanel) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeSettings();
            }
            return;
        }

        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

        if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            e.stopPropagation();
            _toggleRecording();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            _triggerSnapshot();
            return;
        }
    }

    // ═══ VISIBILITY ═══
    let _onVisibility = null;
    function _installVisibilityWatcher() {
        if (_onVisibility) return;
        _onVisibility = () => {
            if (!_previewRunning && _root && _root.isConnected && !document.hidden && !frameIsMinimized()) {
                startPreview();
            }
        };
        document.addEventListener('visibilitychange', _onVisibility);
    }
    function _uninstallVisibilityWatcher() {
        if (_onVisibility) {
            document.removeEventListener('visibilitychange', _onVisibility);
            _onVisibility = null;
        }
    }

    // ═══ SETTINGS UI ═══
    function openSettings() {
        closeSettings();
        try { _stickyExiter?.(); } catch(_) {}
        const s = getSettings();
        const photoQ = s.photoQuality || 'normal';
        const photoFmt = PHOTO_FORMAT_OPTIONS.includes(String(s.photoFormat)) ? String(s.photoFormat) : 'jpg';
        const videoQ = s.videoQuality || 'normal';
        const videoMax = VIDEO_MAX_SEC_OPTIONS.includes(Number(s.videoMaxSec)) ? Number(s.videoMaxSec) : 15;
        const selfTimer = SELF_TIMER_OPTIONS.includes(Number(s.selfTimer)) ? Number(s.selfTimer) : 0;

        const zoomNum = Number.isFinite(Number(s.zoom)) ? Number(s.zoom) : 1;
        const stabNum = Number.isFinite(Number(s.stabilization)) ? Number(s.stabilization) : 0.35;
        const zoomStr = String(Math.round(zoomNum * 10) / 10);
        const stabStr = String(stabNum);

        const panel = document.createElement('div');
        panel.className = 'cam-settings-overlay';
        panel.innerHTML = `
            <div class="cam-settings-card">
                <div class="cam-settings-head">
                    <div class="cam-settings-title">Configurações</div>
                    <button class="cam-settings-close" type="button" aria-label="Fechar">✕</button>
                </div>
                <div class="cam-settings-body">
                    <label class="cam-setting-row" data-key="pageAudio">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8 8 0 0 1 0 12"/></svg>
                                Áudio da página
                            </div>
                            <div class="cam-setting-desc">Grava o som do jogo (áudio da aba)</div>
                        </div>
                        <span class="cam-toggle ${s.pageAudio ? 'on' : ''}"><span></span></span>
                    </label>
                    <label class="cam-setting-row" data-key="voice">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3M8 21h8"/></svg>
                                Microfone
                            </div>
                            <div class="cam-setting-desc">Captura sua voz durante a gravação</div>
                        </div>
                        <span class="cam-toggle ${s.voice ? 'on' : ''}"><span></span></span>
                    </label>

                    <div class="cam-setting-row seg" data-key="photoFormat">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                Formato da foto
                            </div>
                            <div class="cam-setting-desc">PNG tem qualidade máxima, arquivo maior</div>
                        </div>
                        <div class="cam-seg">
                            <button type="button" data-val="jpg" class="${photoFmt==='jpg'?'on':''}">JPG</button>
                            <button type="button" data-val="png" class="${photoFmt==='png'?'on':''}">PNG</button>
                        </div>
                    </div>

                    <div class="cam-setting-row seg" data-key="photoQuality">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-11 11"/></svg>
                                Qualidade das fotos
                            </div>
                            <div class="cam-setting-desc">Mais alta = arquivos maiores</div>
                        </div>
                        <div class="cam-seg">
                            <button type="button" data-val="low"    class="${photoQ==='low'?'on':''}">Baixa</button>
                            <button type="button" data-val="normal" class="${photoQ==='normal'?'on':''}">Normal</button>
                            <button type="button" data-val="high"   class="${photoQ==='high'?'on':''}">Alta</button>
                        </div>
                    </div>

                    <div class="cam-setting-row seg" data-key="videoQuality">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M22 8l-6 4 6 4V8z"/></svg>
                                Qualidade do vídeo
                            </div>
                            <div class="cam-setting-desc">Resolução e bitrate da gravação</div>
                        </div>
                        <div class="cam-seg">
                            <button type="button" data-val="low"    class="${videoQ==='low'?'on':''}">Baixa</button>
                            <button type="button" data-val="normal" class="${videoQ==='normal'?'on':''}">Normal</button>
                            <button type="button" data-val="high"   class="${videoQ==='high'?'on':''}">Alta</button>
                        </div>
                    </div>

                    <div class="cam-setting-row seg" data-key="videoMaxSec">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                                Duração máxima
                            </div>
                            <div class="cam-setting-desc">Tempo limite de cada vídeo</div>
                        </div>
                        <div class="cam-seg">
                            ${VIDEO_MAX_SEC_OPTIONS.map(sv => `
                                <button type="button" data-val="${sv}" class="${videoMax===sv?'on':''}">${sv}s</button>
                            `).join('')}
                        </div>
                    </div>

                    <div class="cam-settings-sep"></div>
                    <div class="cam-settings-subtitle">Captura</div>

                    <div class="cam-setting-row seg" data-key="selfTimer">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/></svg>
                                Temporizador
                            </div>
                            <div class="cam-setting-desc">Contagem antes de tirar a foto</div>
                        </div>
                        <div class="cam-seg">
                            ${SELF_TIMER_OPTIONS.map(sv => `
                                <button type="button" data-val="${sv}" class="${selfTimer===sv?'on':''}">${sv === 0 ? 'Off' : sv + 's'}</button>
                            `).join('')}
                        </div>
                    </div>

                    <div class="cam-settings-sep"></div>
                    <div class="cam-settings-subtitle">Efeitos</div>

                    <div class="cam-setting-row seg" data-key="zoom">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                                Zoom
                            </div>
                            <div class="cam-setting-desc">Use o scroll no preview pra ajustar fino</div>
                        </div>
                        <div class="cam-seg">
                            <button type="button" data-val="1"   class="${zoomStr==='1'?'on':''}">1×</button>
                            <button type="button" data-val="1.5" class="${zoomStr==='1.5'?'on':''}">1.5×</button>
                            <button type="button" data-val="2"   class="${zoomStr==='2'?'on':''}">2×</button>
                            <button type="button" data-val="3"   class="${zoomStr==='3'?'on':''}">3×</button>
                        </div>
                    </div>

                    <div class="cam-setting-row seg" data-key="stabilization">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/></svg>
                                Estabilização
                            </div>
                            <div class="cam-setting-desc">Suaviza o movimento ao arrastar o celular</div>
                        </div>
                        <div class="cam-seg">
                            <button type="button" data-val="0"    class="${stabStr==='0'?'on':''}">Off</button>
                            <button type="button" data-val="0.35" class="${stabStr==='0.35'?'on':''}">Leve</button>
                            <button type="button" data-val="0.65" class="${stabStr==='0.65'?'on':''}">Forte</button>
                        </div>
                    </div>

                    <label class="cam-setting-row" data-key="motionBlur">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
                                Desfoque de movimento
                            </div>
                            <div class="cam-setting-desc">Borra em movimentos rápidos</div>
                        </div>
                        <span class="cam-toggle ${s.motionBlur ? 'on' : ''}"><span></span></span>
                    </label>

                    <label class="cam-setting-row" data-key="vignette">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/></svg>
                                Vinheta
                            </div>
                            <div class="cam-setting-desc">Escurece as bordas</div>
                        </div>
                        <span class="cam-toggle ${s.vignette ? 'on' : ''}"><span></span></span>
                    </label>

                    <label class="cam-setting-row" data-key="timestamp">
                        <div class="cam-setting-info">
                            <div class="cam-setting-name">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 15h4"/></svg>
                                Data e hora
                            </div>
                            <div class="cam-setting-desc">Marca discreta no canto da foto</div>
                        </div>
                        <span class="cam-toggle ${s.timestamp ? 'on' : ''}"><span></span></span>
                    </label>
                </div>
                <div class="cam-settings-note">
                    Espaço inicia a gravação · Enter tira foto · Scroll ajusta o zoom
                </div>
            </div>
        `;
        _root.appendChild(panel);
        _settingsPanel = panel;

        // Fecha via closeSettings para zerar o marcador — sem isso, o teclado
        // global fica achando que o painel está aberto para sempre.
        const close = () => closeSettings();
        panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
        panel.querySelector('.cam-settings-close').addEventListener('click', close);

        panel.querySelectorAll('.cam-setting-row[data-key]:not(.seg)').forEach(row => {
            row.addEventListener('click', (e) => {
                e.preventDefault();
                const key = row.dataset.key;
                const cur = getSettings()[key];
                const next = !cur;
                updateSetting(key, next);
                row.querySelector('.cam-toggle')?.classList.toggle('on', next);
                _A().playToggle(next);
                if (key === 'pageAudio' && !next) _A().releasePageAudio();
                if (key === 'voice' && !next) _A().releaseMic();
                syncEffectsState();
            });
        });

        const NUMERIC_SEGS = new Set(['videoMaxSec', 'selfTimer', 'zoom', 'stabilization']);
        panel.querySelectorAll('.cam-setting-row.seg').forEach(row => {
            const key = row.dataset.key;
            row.querySelectorAll('.cam-seg button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const raw = btn.dataset.val;
                    const val = NUMERIC_SEGS.has(key) ? Number(raw) : raw;
                    updateSetting(key, val);
                    row.querySelectorAll('.cam-seg button').forEach(b => b.classList.toggle('on', b === btn));
                    _A().playToggle(true);
                    syncEffectsState();
                });
            });
        });
    }
    function closeSettings() {
        if (_settingsPanel) {
            try { _settingsPanel.remove(); } catch(_) {}
            _settingsPanel = null;
        }
    }

    // ═══ UI ═══
    function renderShell() {
        _root.innerHTML = `
            <div class="cam-app">
                <header class="cam-topbar">
                    <button class="cam-back" id="camBack" type="button" aria-label="Voltar">‹</button>
                    <div class="cam-grip" id="camGrip" title="Segure para mover · duplo clique fixa · botão direito solta">⠿</div>
                    <button class="cam-settings-btn" id="camSettingsBtn" type="button" aria-label="Configurações">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    </button>
                    <button class="cam-gallery" id="camGallery" type="button" aria-label="Abrir galeria">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-11 11"/></svg>
                    </button>
                </header>

                <div class="cam-preview" id="camPreview">
                    <canvas id="camCanvas" width="300" height="400"></canvas>
                    <div class="cam-flash" id="camFlash"></div>
                    <div class="cam-zoom-ind" id="camZoomInd"></div>
                    <div class="cam-countdown" id="camCountdown"></div>
                    <div class="cam-status" id="camStatus">Procurando tela do jogo…</div>
                    <div class="cam-rec-indicator" id="camRecInd">
                        <span class="cam-rec-dot"></span>
                        <span id="camRecTimer">00:00</span>
                    </div>
                </div>

                <div class="cam-bottombar">
                    <button class="cam-thumb" id="camThumb" type="button" aria-label="Abrir galeria">
                        <span class="cam-thumb-empty">🖼</span>
                    </button>
                    <button class="cam-shutter" id="camShutter" type="button" aria-label="Tirar foto"></button>
                    <button class="cam-video" id="camVideo" type="button" aria-label="Gravar vídeo">▶</button>
                </div>
            </div>
        `;

        _previewBox = _root.querySelector('#camPreview');
        _previewCanvas = _root.querySelector('#camCanvas');
        _flashEl = _root.querySelector('#camFlash');
        _zoomIndicatorEl = _root.querySelector('#camZoomInd');
        _countdownEl = _root.querySelector('#camCountdown');
        _recIndicator = _root.querySelector('#camRecInd');
        _recTimerEl = _root.querySelector('#camRecTimer');
        _thumbEl = _root.querySelector('#camThumb');
        _shutterBtn = _root.querySelector('#camShutter');
        _videoBtn = _root.querySelector('#camVideo');
        _statusEl = _root.querySelector('#camStatus');

        _root.querySelector('#camBack').addEventListener('click', closeApp);
        _root.querySelector('#camSettingsBtn').addEventListener('click', openSettings);
        _root.querySelector('#camGallery').addEventListener('click', openGalleryApp);
        _thumbEl.addEventListener('click', openGalleryApp);

        _shutterBtn.addEventListener('click', _triggerSnapshot);
        _videoBtn.addEventListener('click', _toggleRecording);

        enablePhoneDrag(_root.querySelector('#camGrip'));
        refreshThumbFromStore();
    }

    function openGalleryApp() {
        try {
            const P = window._phone;
            if (P?.apps?.openApp) { P.apps.openApp('gallery'); return; }
            if (typeof ctx.openApp === 'function') { ctx.openApp('gallery'); return; }
        } catch(_) {}
        ctx.toast?.('Galeria ainda não instalada', 'info');
    }

    // ═══ APP REGISTRATION ═══
    ctx.apps.register({
        id: APP_ID,
        name: 'Câmera',
        icon: ICON,
        accent: '#f472b6',
        bg: 'linear-gradient(135deg, #1f2937, #0f172a)',
        order: 6,
        dock: false,
        fullscreen: true,

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

            _frameRef = null;
            _lastFindAttempt = 0;

            await loadStyleModule();

            renderShell();
            hidePhoneBar();
            startPreview();
            _installVisibilityWatcher();

            // Efeitos e áudio carregam em paralelo. O estado dos efeitos é
            // aplicado assim que o módulo chega — cobre o caso do usuário
            // interagir antes do fetch terminar.
            loadEffects().then(() => syncEffectsState());
            loadAudioModule();

            try { ctx.setRecording?.(false); } catch(_) {}

            document.addEventListener('wheel', _onWheel, { passive: false, capture: true });
            document.addEventListener('keydown', _onKey, true);
        },

        unmount() {
            document.removeEventListener('wheel', _onWheel, true);
            document.removeEventListener('keydown', _onKey, true);
            stopPreview();
            teardownCaptureVideo();
            if (_recording) stopRecording(true);
            if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
            if (_recTimeout) { clearTimeout(_recTimeout); _recTimeout = null; }
            closeSettings();
            clearCountdown();
            if (_zoomIndicatorTimer) { clearTimeout(_zoomIndicatorTimer); _zoomIndicatorTimer = null; }
            disablePhoneDrag();
            _uninstallVisibilityWatcher();
            _A().setRecording(false);
            _A().releaseMic();
            _A().releasePageAudio();
            _A().unduckHubSfx();
            if (_activeAudioCleanup) { try { _activeAudioCleanup(); } catch(_) {} _activeAudioCleanup = null; }
            try { window._camEffects?.resetTracking?.(); } catch(_) {}
            showPhoneBar();
            if (_lastThumbUrl && _lastThumbUrl.startsWith('blob:')) {
                try { URL.revokeObjectURL(_lastThumbUrl); } catch(_) {}
                _lastThumbUrl = null;
            }
            _root = null;
            _previewBox = null;
            _previewCanvas = null;
            _flashEl = null;
            _zoomIndicatorEl = null;
            _countdownEl = null;
            _recIndicator = null;
            _recTimerEl = null;
            _thumbEl = null;
            _shutterBtn = null;
            _videoBtn = null;
            _statusEl = null;
            _settingsPanel = null;
            _targetCanvas = null;
            _recordCanvas = null;
            _frameRef = null;
            _lastFindAttempt = 0;
        }
    });
})();
