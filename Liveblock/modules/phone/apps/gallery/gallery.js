// modules/phone/apps/gallery/gallery.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Gallery] phone ctx ausente'); return; }
    if (ctx.apps.get('gallery')) return;

    const GALLERY_STYLE_VERSION = '0.1.0';

    // ═══ CONFIG ═══
    const APP_ID = 'gallery';
    const DB_NAME = 'ga_module_db';
    const STORE = 'photos';
    const FOLDER_STORE = 'folders';
    const LS_PIN_HASH = 'sanghub_phone_app_gallery_pin';
    const PRIVATE_FOLDER_ID = '__private__';
    const PRIVATE_FOLDER_NAME = 'Privado';
    const SOFT_DELETE_MS = 4500;
    const MAX_DIM = 1600;
    const JPEG_QUALITY = 0.85;
    const HIDE_BAR_CLASS = 'sz-hide-bar';
    const LONG_PRESS_MS = 450;
    const MOVE_CANCEL_PX = 8;

    const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-11 11"/></svg>`;

    // ═══ STYLE MODULE LOADER ═══
    let _stylePromise = null;

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
                console.warn('[Gallery] ' + label + ' não carregou:', e);
                return false;
            }
        })();
    }

    function loadStyleModule() {
        if (window._galleryStyle) { try { window._galleryStyle.install(); } catch(_) {} return Promise.resolve(true); }
        if (_stylePromise) return _stylePromise;
        const base = (ctx.moduleBase || '').replace(/\/+$/, '');
        const url = base + '/apps/gallery/gallerystyle.js?v=' + GALLERY_STYLE_VERSION;
        _stylePromise = _injectModule(url, () => window._galleryStyle, 'gallerystyle.js')
            .then((ok) => { if (ok) try { window._galleryStyle.install(); } catch(_) {} return ok; })
            .finally(() => { _stylePromise = null; });
        return _stylePromise;
    }

    // ═══ STORAGE — singleton compartilhado com camera.js ═══
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
                req.onsuccess = () => {
                    const db = req.result;
                    db.onclose = () => { dbPromise = null; };
                    res(db);
                };
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
        S.deleteFolder = async (id) => {
            const db = await openDb();
            const all = await S.getAllPhotos();
            const toDelete = all.filter(p => p.folderId === id);
            return new Promise((res, rej) => {
                const tx = db.transaction([FOLDER_STORE, STORE], 'readwrite');
                tx.objectStore(FOLDER_STORE).delete(id);
                const ps = tx.objectStore(STORE);
                toDelete.forEach(p => ps.delete(p.id));
                tx.oncomplete = res;
                tx.onerror = () => rej(tx.error);
            });
        };
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

    // ═══ HIDE PHONE BAR / CLOSE APP ═══
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
        if (tryCall(P?.home, 'renderHome')) return;
        try { window.dispatchEvent(new CustomEvent('sang:phone-close-app')); } catch(_) {}
        ctx.toast?.('Não consegui fechar — use o botão físico', 'warn');
    }

    // ═══ HELPERS ═══
    const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const pad = (n) => String(n).padStart(2, '0');
    const fileStamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const fmtRelative = (ts) => {
        const s = Math.floor((Date.now() - ts) / 1000);
        if (s < 60) return 'agora';
        if (s < 3600) return Math.floor(s / 60) + 'min';
        if (s < 86400) return Math.floor(s / 3600) + 'h';
        if (s < 604800) return Math.floor(s / 86400) + 'd';
        const d = new Date(ts);
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2);
    };
    const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + pad(s % 60); };
    const monthLabel = (d) => d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase());
    function groupByMonth(photos) {
        const map = new Map();
        for (const p of photos) {
            const d = new Date(p.createdAt);
            const key = d.getFullYear() + '-' + d.getMonth();
            if (!map.has(key)) map.set(key, { label: monthLabel(d), items: [] });
            map.get(key).items.push(p);
        }
        return [...map.values()];
    }
    function fileToDataUrl(file) {
        return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = rej; r.readAsDataURL(file); });
    }
    function compressImage(file, maxDim = MAX_DIM, quality = JPEG_QUALITY) {
        return fileToDataUrl(file).then(dataUrl => new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    const s = maxDim / Math.max(width, height);
                    width = Math.round(width * s); height = Math.round(height * s);
                }
                const cv = document.createElement('canvas');
                cv.width = width; cv.height = height;
                const g = cv.getContext('2d');
                g.fillStyle = '#fff'; g.fillRect(0, 0, width, height);
                g.drawImage(img, 0, 0, width, height);
                try { resolve({ dataUrl: cv.toDataURL('image/jpeg', quality), width, height }); }
                catch { resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight }); }
            };
            img.onerror = () => resolve({ dataUrl, width: 0, height: 0 });
            img.src = dataUrl;
        }));
    }
    async function hashPin(pin) {
        try {
            const buf = new TextEncoder().encode('sangphone-gallery:' + pin);
            const hash = await crypto.subtle.digest('SHA-256', buf);
            return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
        } catch(_) {
            let h = 0; const s = 'sangphone-gallery:' + pin;
            for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            return 'f' + (h >>> 0).toString(16);
        }
    }
    function getStoredPinHash() { try { return localStorage.getItem(LS_PIN_HASH) || ''; } catch(_) { return ''; } }
    function setStoredPinHash(h) { try { if (h) localStorage.setItem(LS_PIN_HASH, h); else localStorage.removeItem(LS_PIN_HASH); } catch(_) {} }

    // ═══ BLOB URLs ═══
    const _blobUrls = new Map();
    function getBlobUrl(item) {
        if (!item || !item.blob) return '';
        if (_blobUrls.has(item.id)) return _blobUrls.get(item.id);
        try {
            const url = URL.createObjectURL(item.blob);
            _blobUrls.set(item.id, url);
            return url;
        } catch(_) { return ''; }
    }
    function revokeBlobUrl(id) {
        const u = _blobUrls.get(id);
        if (u) { try { URL.revokeObjectURL(u); } catch(_) {} _blobUrls.delete(id); }
    }
    function revokeAllBlobUrls() {
        _blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(_) {} });
        _blobUrls.clear();
    }

    // ═══ STATE ═══
    let _root = null;
    let _appEl = null;
    let _tab = 'photos';
    let _currentAlbumId = null;
    let _privateUnlocked = false;
    let _selectionMode = false;
    let _selected = new Set();
    let _photos = [];
    let _folders = [];
    let _pendingDeletes = new Map();
    let _pendingCommitTimer = null;
    let _loaded = false;
    let _viewer = null;
    let _pinFlow = null;
    let _toastTimer = null;
    let _longPressTimer = null;
    let _lpFiredId = null;
    let _lpStartX = 0;
    let _lpStartY = 0;
    let _lastViewSig = '';

    // ═══ TOAST ═══
    function showToast(msg, opts = {}) {
        const el = _root?.querySelector('.gx-toast');
        if (!el) return;
        clearTimeout(_toastTimer);
        el.innerHTML = '';
        const span = document.createElement('span');
        span.textContent = msg;
        el.appendChild(span);
        if (opts.action && opts.onAction) {
            const b = document.createElement('button');
            b.className = 'gx-toast-action';
            b.textContent = opts.action;
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                try { opts.onAction(); } catch(_) {}
                el.classList.remove('on');
                clearTimeout(_toastTimer);
            });
            el.appendChild(b);
        }
        el.classList.add('on');
        const ms = opts.duration || 2000;
        _toastTimer = setTimeout(() => {
            el.classList.remove('on');
            if (opts.onExpire) try { opts.onExpire(); } catch(_) {}
        }, ms);
    }

    // ═══ SOFT DELETE ═══
    function commitPendingDeletes() {
        if (!_pendingDeletes.size) return;
        const toDelete = [..._pendingDeletes.values()];
        _pendingDeletes.clear();
        for (const it of toDelete) {
            revokeBlobUrl(it.id);
            Store.deletePhoto(it.id).catch(() => {});
        }
        _photos = _photos.filter(p => !toDelete.find(x => x.id === p.id));
        if (_viewer) {
            const stillHere = _viewer.items.filter(x => _photos.some(p => p.id === x.id));
            if (!stillHere.length) closeViewer();
            else { _viewer.items = stillHere; _viewer.idx = Math.min(_viewer.idx, stillHere.length - 1); }
        }
    }

    function softDeleteItems(items) {
        if (!items.length) return;
        if (_pendingDeletes.size) commitPendingDeletes();
        if (_pendingCommitTimer) { clearTimeout(_pendingCommitTimer); _pendingCommitTimer = null; }

        for (const it of items) _pendingDeletes.set(it.id, it);
        _selectionMode = false; _selected = new Set();
        rerender();

        showToast(
            items.length === 1 ? 'Item excluído' : items.length + ' itens excluídos',
            {
                action: 'Desfazer',
                duration: SOFT_DELETE_MS,
                onAction: () => {
                    for (const it of items) _pendingDeletes.delete(it.id);
                    if (_pendingCommitTimer) { clearTimeout(_pendingCommitTimer); _pendingCommitTimer = null; }
                    rerender();
                }
            }
        );

        _pendingCommitTimer = setTimeout(() => {
            _pendingCommitTimer = null;
            commitPendingDeletes();
        }, SOFT_DELETE_MS);
    }

    // ═══ VISIBILITY ═══
    function visiblePhotos() { return _photos.filter(p => !_pendingDeletes.has(p.id)); }
    function photosForAlbum(folderId) {
        const list = visiblePhotos();
        if (folderId === null) return list.filter(p => p.folderId !== PRIVATE_FOLDER_ID);
        return list.filter(p => p.folderId === folderId);
    }
    function albumsVisible() { return _folders.filter(f => f.id !== PRIVATE_FOLDER_ID); }
    function privateCount() { return visiblePhotos().filter(p => p.folderId === PRIVATE_FOLDER_ID).length; }

    // ═══ LOAD ═══
    async function loadAll() {
        try {
            const [photos, folders] = await Promise.all([Store.getAllPhotos(), Store.getAllFolders()]);
            _photos = photos || [];
            _folders = folders || [];
            _loaded = true;
        } catch(e) {
            console.warn('[Gallery] loadAll:', e);
            _photos = []; _folders = []; _loaded = true;
        }
    }

    // ═══ RENDER — shell ═══
    function renderShell() {
        _root.innerHTML = `
            <div class="gx-app">
                <header class="gx-topbar">
                    <button class="gx-iconbtn gx-back" id="gxBack" type="button" aria-label="Voltar">‹</button>
                    <div class="gx-title" id="gxTitle">Galeria</div>
                    <button class="gx-iconbtn gx-select" id="gxSelect" type="button" aria-label="Selecionar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    </button>
                    <button class="gx-iconbtn gx-more" id="gxMore" type="button" aria-label="Mais">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                    </button>
                </header>

                <div class="gx-tabs" id="gxTabs">
                    <button class="gx-tab on" data-tab="photos" type="button">Fotos</button>
                    <button class="gx-tab" data-tab="albums" type="button">Álbuns</button>
                </div>

                <div class="gx-body" id="gxBody"></div>

                <div class="gx-selbar" id="gxSelBar">
                    <button class="gx-selbtn" data-act="move" type="button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M3 7a1 1 0 0 1 1-1h4.5l2 2H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>
                        Mover
                    </button>
                    <button class="gx-selbtn danger" data-act="delete" type="button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/></svg>
                        Excluir
                    </button>
                    <button class="gx-selbtn ghost" data-act="cancel" type="button">Cancelar</button>
                </div>

                <div class="gx-toast"></div>
            </div>
        `;

        _appEl = _root.querySelector('.gx-app');

        _root.querySelector('#gxBack').addEventListener('click', onBack);
        _root.querySelector('#gxSelect').addEventListener('click', toggleSelectionMode);
        _root.querySelector('#gxMore').addEventListener('click', openMoreMenu);

        _root.querySelector('#gxTabs').addEventListener('click', (e) => {
            const b = e.target.closest('.gx-tab');
            if (!b) return;
            if (_selectionMode) exitSelection();
            _tab = b.dataset.tab;
            _currentAlbumId = null;
            rerender();
        });

        _root.querySelector('#gxSelBar').addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]');
            if (!b) return;
            const act = b.dataset.act;
            if (act === 'cancel') exitSelection();
            else if (act === 'delete') bulkDeleteSelected();
            else if (act === 'move') bulkMoveSelected();
        });
    }

    // ═══ RENDER — dispatcher ═══
    function rerender() {
        if (!_root) return;
        const tabsEl = _root.querySelector('#gxTabs');
        const titleEl = _root.querySelector('#gxTitle');
        const selectBtn = _root.querySelector('#gxSelect');
        const body = _root.querySelector('#gxBody');
        if (!body) return;

        const atRoot = _currentAlbumId === null && !_selectionMode;
        tabsEl.style.display = atRoot ? '' : 'none';
        _root.querySelectorAll('.gx-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === _tab));

        if (_selectionMode) {
            titleEl.textContent = _selected.size + (_selected.size === 1 ? ' selecionado' : ' selecionados');
        } else if (_currentAlbumId === null) {
            titleEl.textContent = 'Galeria';
        } else if (_currentAlbumId === PRIVATE_FOLDER_ID) {
            titleEl.textContent = PRIVATE_FOLDER_NAME;
        } else {
            const f = _folders.find(x => x.id === _currentAlbumId);
            titleEl.textContent = f ? f.name : 'Álbum';
        }

        selectBtn.style.display = (_selectionMode || _currentAlbumId === PRIVATE_FOLDER_ID) ? 'none' : '';
        _root.querySelector('#gxSelBar').classList.toggle('on', _selectionMode);
        if (_appEl) _appEl.classList.toggle('selection', _selectionMode);

        if (!_loaded) { body.innerHTML = `<div class="gx-loading"><div class="gx-spinner"></div></div>`; return; }

        const sig = _tab + '|' + (_currentAlbumId || '') + '|' + (_selectionMode ? 's' : '');
        const viewChanged = sig !== _lastViewSig;
        _lastViewSig = sig;

        if (_tab === 'photos') renderTimeline(body);
        else if (_currentAlbumId === PRIVATE_FOLDER_ID) renderPrivate(body);
        else if (_currentAlbumId === null) renderAlbums(body);
        else renderAlbumView(body);

        if (viewChanged) {
            body.classList.remove('gx-body-enter');
            void body.offsetWidth;
            body.classList.add('gx-body-enter');
        }
    }

    // ═══ RENDER — timeline ═══
    function renderTimeline(body) {
        const all = photosForAlbum(null);
        if (!all.length) {
            body.innerHTML = `
                <div class="gx-empty">
                    <div class="gx-empty-ico">🖼</div>
                    <div class="gx-empty-title">Sem fotos ainda</div>
                    <div class="gx-empty-sub">Abra a <b>Câmera</b> pra capturar, ou importe uma foto pelo menu <b>⋯</b>.</div>
                </div>
            `;
            return;
        }
        const groups = groupByMonth(all);
        body.innerHTML = groups.map(g => `
            <section class="gx-section">
                <h2 class="gx-section-title">${escape(g.label)} <span class="gx-section-count">${g.items.length}</span></h2>
                <div class="gx-grid">${g.items.map(p => cellHTML(p)).join('')}</div>
            </section>
        `).join('');

        body.querySelectorAll('.gx-cell').forEach(el => wireCell(el, all));
    }

    // ═══ RENDER — albums grid ═══
    function renderAlbums(body) {
        const albums = albumsVisible();
        const all = visiblePhotos();
        const total = all.filter(p => p.folderId !== PRIVATE_FOLDER_ID).length;
        const priv = privateCount();

        const cards = [];
        cards.push(`
            <button class="gx-album private" data-album="${PRIVATE_FOLDER_ID}" type="button">
                <div class="gx-album-cover"><div class="gx-album-lock">🔒</div></div>
                <div class="gx-album-meta">
                    <div class="gx-album-name">${PRIVATE_FOLDER_NAME}</div>
                    <div class="gx-album-count">${priv} ${priv === 1 ? 'item' : 'itens'}</div>
                </div>
            </button>
        `);

        for (const f of albums) {
            const list = all.filter(p => p.folderId === f.id);
            const cover = list[0];
            let coverHTML;
            if (!cover) {
                coverHTML = `<div class="gx-album-empty">📁</div>`;
            } else if (cover.kind === 'video' && cover.blob) {
                const url = getBlobUrl(cover);
                coverHTML = `<video src="${url}" muted playsinline preload="metadata"></video><span class="gx-album-play">▶</span>`;
            } else if (cover.dataUrl) {
                coverHTML = `<img src="${cover.dataUrl}" alt="" loading="lazy" />`;
            } else if (cover.blob) {
                coverHTML = `<img src="${getBlobUrl(cover)}" alt="" loading="lazy" />`;
            } else {
                coverHTML = `<div class="gx-album-empty">📁</div>`;
            }
            cards.push(`
                <button class="gx-album" data-album="${escape(f.id)}" type="button">
                    <div class="gx-album-cover">${coverHTML}</div>
                    <div class="gx-album-meta">
                        <div class="gx-album-name">${escape(f.name)}</div>
                        <div class="gx-album-count">${list.length} ${list.length === 1 ? 'item' : 'itens'}</div>
                    </div>
                </button>
            `);
        }

        body.innerHTML = `
            <div class="gx-albums-stats">${total} ${total === 1 ? 'item' : 'itens'} · ${albums.length} ${albums.length === 1 ? 'álbum' : 'álbuns'}</div>
            <div class="gx-albums">${cards.join('')}</div>
        `;

        body.querySelectorAll('.gx-album').forEach(el => {
            const id = el.dataset.album;
            if (id === PRIVATE_FOLDER_ID) {
                el.addEventListener('click', () => openPrivate());
                return;
            }
            el.addEventListener('click', () => {
                if (_selectionMode) return;
                _currentAlbumId = id;
                rerender();
            });
        });
    }

    // ═══ RENDER — album view ═══
    function renderAlbumView(body) {
        const list = photosForAlbum(_currentAlbumId);
        if (!list.length) {
            body.innerHTML = `
                <div class="gx-empty">
                    <div class="gx-empty-ico">📂</div>
                    <div class="gx-empty-title">Álbum vazio</div>
                    <div class="gx-empty-sub">Em <b>Fotos</b>, toque em <b>Selecionar</b> e mova itens pra cá.</div>
                </div>
            `;
            return;
        }
        const groups = groupByMonth(list);
        body.innerHTML = groups.map(g => `
            <section class="gx-section">
                <h2 class="gx-section-title">${escape(g.label)} <span class="gx-section-count">${g.items.length}</span></h2>
                <div class="gx-grid">${g.items.map(p => cellHTML(p)).join('')}</div>
            </section>
        `).join('');

        body.querySelectorAll('.gx-cell').forEach(el => wireCell(el, list));
    }

    // ═══ RENDER — privado ═══
    function renderPrivate(body) {
        if (!_privateUnlocked) {
            const hasPin = !!getStoredPinHash();
            body.innerHTML = `
                <div class="gx-empty">
                    <div class="gx-empty-ico">🔒</div>
                    <div class="gx-empty-title">${hasPin ? 'Álbum privado' : 'Sem senha definida'}</div>
                    <div class="gx-empty-sub">${hasPin ? 'Digite sua senha pra acessar.' : 'Defina uma senha pra proteger suas fotos.'}</div>
                    <button class="gx-primary" id="gxPrivAction" type="button">${hasPin ? 'Desbloquear' : 'Definir senha'}</button>
                </div>
            `;
            body.querySelector('#gxPrivAction').addEventListener('click', () => {
                if (getStoredPinHash()) openPinModal('verify');
                else openPinModal('set');
            });
            return;
        }

        const list = photosForAlbum(PRIVATE_FOLDER_ID);
        if (!list.length) {
            body.innerHTML = `
                <div class="gx-empty">
                    <div class="gx-empty-ico">🔓</div>
                    <div class="gx-empty-title">Privado desbloqueado</div>
                    <div class="gx-empty-sub">Mova itens pra cá usando <b>Selecionar</b> → <b>Mover</b> → <b>Privado</b>.</div>
                    <button class="gx-secondary" id="gxLock" type="button">Bloquear agora</button>
                </div>
            `;
            body.querySelector('#gxLock').addEventListener('click', () => { _privateUnlocked = false; rerender(); });
            return;
        }

        const groups = groupByMonth(list);
        body.innerHTML = `
            <div class="gx-private-bar">
                <span>🔓 Desbloqueado</span>
                <button class="gx-private-lock" id="gxLock" type="button">Bloquear</button>
            </div>
            ${groups.map(g => `
                <section class="gx-section">
                    <h2 class="gx-section-title">${escape(g.label)} <span class="gx-section-count">${g.items.length}</span></h2>
                    <div class="gx-grid">${g.items.map(p => cellHTML(p)).join('')}</div>
                </section>
            `).join('')}
        `;
        body.querySelector('#gxLock').addEventListener('click', () => { _privateUnlocked = false; rerender(); });
        body.querySelectorAll('.gx-cell').forEach(el => wireCell(el, list));
    }

    // ═══ CELL HTML ═══
    function cellHTML(p) {
        const sel = _selected.has(p.id) ? ' selected' : '';
        const isVideo = p.kind === 'video';
        let media;
        if (isVideo && p.blob) {
            const url = getBlobUrl(p);
            media = `<video class="gx-cell-media" src="${url}#t=0.1" muted playsinline preload="metadata"></video>`;
        } else if (p.dataUrl) {
            media = `<img src="${p.dataUrl}" alt="" loading="lazy" />`;
        } else if (p.blob) {
            media = `<img src="${getBlobUrl(p)}" alt="" loading="lazy" />`;
        } else {
            media = '<div class="gx-cell-empty">?</div>';
        }
        return `
            <div class="gx-cell${sel}" data-id="${escape(p.id)}" role="button" tabindex="0">
                ${media}
                ${isVideo ? `<span class="gx-cell-video"><svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M8 5v14l11-7z"/></svg>${p.durationMs ? `<span class="gx-cell-dur">${fmtDur(p.durationMs)}</span>` : ''}</span>` : ''}
                <span class="gx-cell-check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M5 12l5 5L19 7"/></svg>
                </span>
            </div>
        `;
    }

    function wireCell(el, currentList) {
        const id = el.dataset.id;
        const item = _photos.find(p => p.id === id);
        if (!item) return;

        el.addEventListener('click', () => {
            if (_lpFiredId === id) { _lpFiredId = null; return; }
            if (_selectionMode) { toggleSelect(id); return; }
            const idx = currentList.findIndex(x => x.id === id);
            if (idx >= 0) openViewer(currentList, idx);
        });

        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (_selectionMode) { toggleSelect(id); return; }
            const idx = currentList.findIndex(x => x.id === id);
            if (idx >= 0) openViewer(currentList, idx);
        });

        el.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            _lpStartX = e.clientX; _lpStartY = e.clientY;
            clearTimeout(_longPressTimer);
            _longPressTimer = setTimeout(() => {
                if (_selectionMode) return;
                _lpFiredId = id;
                enterSelection(id);
                try { navigator.vibrate?.(12); } catch(_) {}
            }, LONG_PRESS_MS);
        });
        el.addEventListener('pointermove', (e) => {
            if (!_longPressTimer) return;
            const dx = Math.abs(e.clientX - _lpStartX);
            const dy = Math.abs(e.clientY - _lpStartY);
            if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
                clearTimeout(_longPressTimer);
                _longPressTimer = null;
            }
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
            el.addEventListener(ev, () => { clearTimeout(_longPressTimer); _longPressTimer = null; })
        );
    }

    // ═══ SELECTION ═══
    function enterSelection(id) {
        _selectionMode = true;
        _selected = new Set();
        if (id) _selected.add(id);
        rerender();
    }
    function exitSelection() {
        _selectionMode = false;
        _selected = new Set();
        rerender();
    }
    function toggleSelectionMode() {
        if (_selectionMode) exitSelection(); else enterSelection();
    }
    function toggleSelect(id) {
        if (_selected.has(id)) _selected.delete(id); else _selected.add(id);
        if (!_selected.size) { exitSelection(); return; }
        rerender();
    }
    function bulkDeleteSelected() {
        const items = _photos.filter(p => _selected.has(p.id));
        if (!items.length) return;
        softDeleteItems(items);
    }
    async function bulkMoveSelected() {
        const items = _photos.filter(p => _selected.has(p.id));
        if (!items.length) return;
        openMovePicker(items);
    }

    // ═══ MOVE PICKER ═══
    function openMovePicker(items) {
        closeMovePicker();
        const overlay = document.createElement('div');
        overlay.className = 'gx-move-overlay';
        const albums = albumsVisible();
        const isPrivateLocked = !_privateUnlocked && getStoredPinHash();

        overlay.innerHTML = `
            <div class="gx-move-card">
                <div class="gx-move-title">Mover ${items.length} ${items.length === 1 ? 'item' : 'itens'} para…</div>
                <div class="gx-move-list">
                    <button class="gx-move-item" data-target="" type="button">
                        <span class="gx-move-ico">🖼</span>
                        <span class="gx-move-name">Galeria (sem álbum)</span>
                    </button>
                    ${albums.map(f => `
                        <button class="gx-move-item" data-target="${escape(f.id)}" type="button">
                            <span class="gx-move-ico">📁</span>
                            <span class="gx-move-name">${escape(f.name)}</span>
                        </button>
                    `).join('')}
                    <button class="gx-move-item ${isPrivateLocked ? 'disabled' : ''}" data-target="${PRIVATE_FOLDER_ID}" type="button">
                        <span class="gx-move-ico">🔒</span>
                        <span class="gx-move-name">${PRIVATE_FOLDER_NAME}${isPrivateLocked ? ' (bloqueado)' : ''}</span>
                    </button>
                    <button class="gx-move-item new" data-target="__new__" type="button">
                        <span class="gx-move-ico">+</span>
                        <span class="gx-move-name">Novo álbum…</span>
                    </button>
                </div>
                <button class="gx-modal-cancel" type="button" data-cancel>Cancelar</button>
            </div>
        `;
        _root.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('[data-cancel]').addEventListener('click', close);

        overlay.querySelectorAll('.gx-move-item').forEach(btn => {
            btn.addEventListener('click', async () => {
                const target = btn.dataset.target;
                if (target === '__new__') {
                    close();
                    const name = prompt('Nome do novo álbum');
                    if (!name || !name.trim()) return;
                    const id = Store.uid();
                    await Store.putFolder({ id, name: name.trim().slice(0, 40), createdAt: Date.now() });
                    await doMove(items, id);
                    return;
                }
                if (target === PRIVATE_FOLDER_ID && isPrivateLocked) return;
                close();
                await doMove(items, target || null);
            });
        });
    }
    function closeMovePicker() {
        _root?.querySelectorAll('.gx-move-overlay').forEach(el => el.remove());
    }
    async function doMove(items, targetFolderId) {
        for (const it of items) {
            const next = { ...it, folderId: targetFolderId };
            try { await Store.putPhoto(next); } catch(_) {}
            const idx = _photos.findIndex(p => p.id === it.id);
            if (idx > -1) _photos[idx] = next;
        }
        exitSelection();
        showToast(targetFolderId ? 'Movido' : 'Removido do álbum');
        rerender();
    }

    // ═══ MORE MENU ═══
    function openMoreMenu() {
        closeMoreMenu();
        const overlay = document.createElement('div');
        overlay.className = 'gx-menu-overlay';
        const items = [];
        if (_tab === 'albums' && _currentAlbumId === null) {
            items.push({ label: 'Novo álbum', act: 'new-album', icon: '＋' });
            items.push({ label: getStoredPinHash() ? 'Alterar senha do privado' : 'Definir senha do privado', act: 'private', icon: '🔒' });
            if (getStoredPinHash()) items.push({ label: 'Remover senha do privado', act: 'remove-pin', icon: '🔓', danger: true });
        } else if (_currentAlbumId !== null && _currentAlbumId !== PRIVATE_FOLDER_ID) {
            items.push({ label: 'Renomear álbum', act: 'rename-album', icon: '✎' });
            items.push({ label: 'Excluir álbum', act: 'delete-album', icon: '🗑', danger: true });
        }
        items.push({ label: 'Importar do dispositivo', act: 'import', icon: '⬆' });
        if (_tab === 'photos' && _currentAlbumId === null && photosForAlbum(null).length) {
            items.push({ label: 'Selecionar tudo', act: 'select-all', icon: '☑' });
        }
        overlay.innerHTML = `
            <div class="gx-menu-card">
                ${items.map(it => `
                    <button class="gx-menu-item${it.danger ? ' danger' : ''}" data-act="${it.act}" type="button">
                        <span class="gx-menu-ico">${it.icon}</span>
                        <span class="gx-menu-label">${escape(it.label)}</span>
                    </button>
                `).join('')}
                <button class="gx-modal-cancel" type="button" data-cancel>Cancelar</button>
            </div>
        `;
        _root.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('[data-cancel]').addEventListener('click', close);
        overlay.querySelectorAll('.gx-menu-item').forEach(btn => {
            btn.addEventListener('click', async () => {
                const act = btn.dataset.act;
                close();
                if (act === 'new-album') return createAlbumPrompt();
                if (act === 'private') return openPrivate();
                if (act === 'remove-pin') return removePinConfirm();
                if (act === 'rename-album') return renameAlbumPrompt();
                if (act === 'delete-album') return deleteAlbumConfirm();
                if (act === 'import') return importFromDevice();
                if (act === 'select-all') return selectAll();
            });
        });
    }
    function closeMoreMenu() {
        _root?.querySelectorAll('.gx-menu-overlay').forEach(el => el.remove());
    }

    async function createAlbumPrompt() {
        const name = prompt('Nome do álbum');
        if (!name || !name.trim()) return;
        const id = Store.uid();
        await Store.putFolder({ id, name: name.trim().slice(0, 40), createdAt: Date.now() });
        _folders = await Store.getAllFolders();
        showToast('Álbum criado');
        rerender();
    }
    async function renameAlbumPrompt() {
        const f = _folders.find(x => x.id === _currentAlbumId);
        if (!f) return;
        const name = prompt('Novo nome', f.name);
        if (!name || !name.trim()) return;
        f.name = name.trim().slice(0, 40);
        await Store.putFolder(f);
        _folders = await Store.getAllFolders();
        showToast('Renomeado');
        rerender();
    }
    async function deleteAlbumConfirm() {
        const f = _folders.find(x => x.id === _currentAlbumId);
        if (!f) return;
        const items = photosForAlbum(f.id);
        const msg = items.length
            ? `Excluir "${f.name}" e seus ${items.length} itens?`
            : `Excluir "${f.name}"?`;
        if (!confirm(msg)) return;
        for (const it of items) revokeBlobUrl(it.id);
        await Store.deleteFolder(f.id);
        _photos = _photos.filter(p => p.folderId !== f.id);
        _folders = await Store.getAllFolders();
        _currentAlbumId = null;
        showToast('Álbum excluído');
        rerender();
    }
    async function removePinConfirm() {
        if (!confirm('Remover a senha? O álbum privado ficará acessível sem PIN.')) return;
        setStoredPinHash('');
        _privateUnlocked = false;
        showToast('Senha removida');
        rerender();
    }
    function selectAll() {
        const list = photosForAlbum(null);
        if (!list.length) return;
        _selectionMode = true;
        _selected = new Set(list.map(p => p.id));
        rerender();
    }

    // ═══ IMPORT ═══
    function importFromDevice() {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.multiple = true;
        inp.style.cssText = 'position:fixed;top:-100px;left:-100px;width:0;height:0;opacity:0;';
        document.body.appendChild(inp);
        inp.addEventListener('change', async () => {
            const files = Array.from(inp.files || []);
            try { inp.remove(); } catch(_) {}
            if (!files.length) return;
            const targetFolder = _currentAlbumId && _currentAlbumId !== PRIVATE_FOLDER_ID ? _currentAlbumId : null;
            let ok = 0;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    const { dataUrl, width, height } = await compressImage(file);
                    await Store.putPhoto({
                        id: Store.uid(),
                        kind: 'photo',
                        name: file.name || ('import-' + fileStamp() + '.jpg'),
                        createdAt: Date.now(),
                        folderId: targetFolder,
                        mime: 'image/jpeg',
                        width, height,
                        dataUrl
                    });
                    ok++;
                } catch(e) { console.warn('[Gallery] import fail:', e); }
            }
            await loadAll();
            showToast(ok + (ok === 1 ? ' item importado' : ' itens importados'));
            rerender();
        });
        inp.addEventListener('cancel', () => { try { inp.remove(); } catch(_) {} });
        inp.click();
    }

    // ═══ PRIVATE ═══
    function openPrivate() {
        _tab = 'albums';
        _currentAlbumId = PRIVATE_FOLDER_ID;
        rerender();
        if (getStoredPinHash() && !_privateUnlocked) {
            setTimeout(() => openPinModal('verify'), 50);
        }
    }

    function openPinModal(mode) {
        closePinModal();
        _pinFlow = { mode, firstPin: '' };

        const overlay = document.createElement('div');
        overlay.className = 'gx-pin-overlay';
        overlay.innerHTML = `
            <div class="gx-pin-card">
                <div class="gx-pin-icon">${mode === 'set' ? '🔐' : '🔒'}</div>
                <div class="gx-pin-title">${mode === 'set' ? 'Definir senha' : 'Digite a senha'}</div>
                <div class="gx-pin-sub" id="gxPinSub">${mode === 'set' ? 'Proteja suas fotos privadas' : 'Acesso ao álbum privado'}</div>
                <div class="gx-pin-dots" id="gxPinDots">
                    <span></span><span></span><span></span><span></span>
                </div>
                <div class="gx-pin-error" id="gxPinError"></div>
                <div class="gx-pin-pad">
                    <button data-k="1" type="button">1</button>
                    <button data-k="2" type="button">2</button>
                    <button data-k="3" type="button">3</button>
                    <button data-k="4" type="button">4</button>
                    <button data-k="5" type="button">5</button>
                    <button data-k="6" type="button">6</button>
                    <button data-k="7" type="button">7</button>
                    <button data-k="8" type="button">8</button>
                    <button data-k="9" type="button">9</button>
                    <button data-k="del" class="gx-pin-del" type="button">⌫</button>
                    <button data-k="0" type="button">0</button>
                    <button data-k="ok" class="gx-pin-ok" type="button">✓</button>
                </div>
                <button class="gx-modal-cancel" data-cancel type="button">Cancelar</button>
            </div>
        `;
        _root.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) closePinModal(); });
        overlay.querySelector('[data-cancel]').addEventListener('click', closePinModal);

        let buf = '';
        const dots = overlay.querySelector('#gxPinDots').children;
        const err = overlay.querySelector('#gxPinError');
        const sub = overlay.querySelector('#gxPinSub');

        function updateDots() { for (let i = 0; i < 4; i++) dots[i].classList.toggle('on', i < buf.length); }
        function setErr(msg) { err.textContent = msg || ''; err.classList.toggle('on', !!msg); }
        function reset(m) { buf = ''; updateDots(); setErr(m || ''); }

        overlay.querySelectorAll('.gx-pin-pad button').forEach(btn => {
            btn.addEventListener('click', async () => {
                const k = btn.dataset.k;
                if (k === 'del') { buf = buf.slice(0, -1); updateDots(); setErr(''); return; }
                if (k === 'ok') return submit();
                if (buf.length >= 4) return;
                buf += k; updateDots(); setErr('');
                if (buf.length === 4) setTimeout(() => submit(), 120);
            });
        });

        async function submit() {
            if (buf.length < 4) { setErr('Digite 4 dígitos'); return; }
            const m = _pinFlow.mode;
            if (m === 'set') {
                if (!_pinFlow.firstPin) {
                    _pinFlow.firstPin = buf;
                    sub.textContent = 'Confirme a senha';
                    reset();
                    return;
                }
                if (_pinFlow.firstPin !== buf) {
                    _pinFlow.firstPin = '';
                    sub.textContent = 'Proteja suas fotos privadas';
                    reset('As senhas não conferem');
                    return;
                }
                const h = await hashPin(buf);
                setStoredPinHash(h);
                _privateUnlocked = true;
                closePinModal();
                showToast('Senha definida');
                rerender();
                return;
            }
            const h = await hashPin(buf);
            if (h !== getStoredPinHash()) {
                reset('Senha incorreta');
                try { navigator.vibrate?.(60); } catch(_) {}
                return;
            }
            _privateUnlocked = true;
            closePinModal();
            showToast('Desbloqueado');
            rerender();
        }
    }
    function closePinModal() {
        _pinFlow = null;
        _root?.querySelectorAll('.gx-pin-overlay').forEach(el => el.remove());
    }

    // ═══ VIEWER ═══
    function openViewer(items, idx) {
        if (idx < 0 || idx >= items.length) return;
        closeViewer();
        const overlay = document.createElement('div');
        overlay.className = 'gx-viewer';
        _root.appendChild(overlay);
        _viewer = { items, idx, el: overlay, chromeVisible: true, cleanup: null };

        overlay.innerHTML = `
            <div class="gx-v-bg" id="gxVBg"></div>
            <div class="gx-v-chrome gx-v-top" id="gxVTop">
                <button class="gx-iconbtn" data-act="close" aria-label="Fechar">✕</button>
                <div class="gx-v-meta" id="gxVMeta"></div>
                <button class="gx-iconbtn" data-act="download" aria-label="Baixar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 19h16"/></svg>
                </button>
                <button class="gx-iconbtn danger" data-act="delete" aria-label="Excluir">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/></svg>
                </button>
            </div>
            <div class="gx-v-stage" id="gxVStage"></div>
            <button class="gx-v-nav prev" id="gxVPrev" data-act="prev" type="button" aria-label="Anterior">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="gx-v-nav next" id="gxVNext" data-act="next" type="button" aria-label="Próxima">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <div class="gx-v-chrome gx-v-bottom" id="gxVBottom">
                <div class="gx-v-count" id="gxVCount"></div>
            </div>
        `;

        const stage = overlay.querySelector('#gxVStage');
        const bg = overlay.querySelector('#gxVBg');
        const meta = overlay.querySelector('#gxVMeta');
        const count = overlay.querySelector('#gxVCount');
        const top = overlay.querySelector('#gxVTop');
        const bottom = overlay.querySelector('#gxVBottom');
        const prevBtn = overlay.querySelector('#gxVPrev');
        const nextBtn = overlay.querySelector('#gxVNext');

        let slideDir = 0;

        function current() { return _viewer ? _viewer.items[_viewer.idx] : null; }

        function updateNav() {
            if (!_viewer || !prevBtn || !nextBtn) return;
            const many = _viewer.items.length > 1;
            const atStart = _viewer.idx <= 0;
            const atEnd = _viewer.idx >= _viewer.items.length - 1;
            prevBtn.classList.toggle('hidden', !many || atStart);
            nextBtn.classList.toggle('hidden', !many || atEnd);
        }

        function renderSlide() {
            const it = current();
            if (!it) return closeViewer();
            stage.innerHTML = '';
            bg.innerHTML = '';

            if (it.kind === 'video' && it.blob) {
                const url = getBlobUrl(it);
                const v = document.createElement('video');
                v.src = url;
                v.controls = true;
                v.autoplay = true;
                v.playsInline = true;
                v.className = 'gx-v-video';
                stage.appendChild(v);
            } else if (it.dataUrl || it.blob) {
                const img = document.createElement('img');
                img.className = 'gx-v-img';
                const src = it.dataUrl || getBlobUrl(it);
                img.src = src;
                stage.appendChild(img);
                const bimg = document.createElement('img');
                bimg.src = src;
                bimg.className = 'gx-v-bg-img';
                bg.appendChild(bimg);
            }

            stage.classList.remove('gx-slide-next', 'gx-slide-prev', 'gx-slide-init');
            if (slideDir > 0) stage.classList.add('gx-slide-next');
            else if (slideDir < 0) stage.classList.add('gx-slide-prev');
            else stage.classList.add('gx-slide-init');

            meta.textContent = it.name || (it.kind === 'video' ? 'Vídeo' : 'Foto');
            count.textContent = (_viewer.idx + 1) + ' / ' + _viewer.items.length + ' · ' + fmtRelative(it.createdAt);
            updateNav();
        }

        function nav(dir) {
            if (!_viewer) return;
            const next = _viewer.idx + dir;
            if (next < 0 || next >= _viewer.items.length) return;
            slideDir = dir;
            _viewer.idx = next;
            renderSlide();
        }

        function toggleChrome() {
            if (!_viewer) return;
            _viewer.chromeVisible = !_viewer.chromeVisible;
            top.classList.toggle('hidden', !_viewer.chromeVisible);
            bottom.classList.toggle('hidden', !_viewer.chromeVisible);
        }

        overlay.addEventListener('click', async e => {
            const btn = e.target.closest('[data-act]');
            if (btn) {
                const act = btn.dataset.act;
                if (act === 'close') closeViewer();
                else if (act === 'prev') nav(-1);
                else if (act === 'next') nav(1);
                else if (act === 'delete') {
                    const it = current();
                    closeViewer();
                    if (it) softDeleteItems([it]);
                } else if (act === 'download') {
                    const it = current();
                    if (!it) return;
                    const dl = ctx.download;
                    if (!dl || typeof dl.item !== 'function') { showToast('Download indisponível'); return; }
                    try {
                        const res = await dl.item(it);
                        if (res && res.ok) showToast('Download iniciado');
                        else if (res && res.reason === 'cancelled') { /* usuário cancelou */ }
                        else showToast('Não foi possível baixar');
                    } catch (err) {
                        console.warn('[Gallery] download:', err);
                        showToast('Não foi possível baixar');
                    }
                }
                return;
            }
            if (e.target.closest('.gx-v-stage') && !e.target.closest('video')) toggleChrome();
        });

        let sx = 0, sy = 0, swiping = false;
        overlay.addEventListener('pointerdown', e => {
            if (e.target.closest('video, button, .gx-v-chrome')) return;
            sx = e.clientX; sy = e.clientY; swiping = true;
        });
        overlay.addEventListener('pointermove', e => {
            if (!swiping) return;
            const dx = e.clientX - sx;
            const dy = e.clientY - sy;
            if (Math.abs(dy) > Math.abs(dx) && dy > 0) {
                stage.style.transform = `translateY(${Math.min(dy, 200)}px)`;
                overlay.style.opacity = String(Math.max(0.4, 1 - dy / 400));
            }
        });
        overlay.addEventListener('pointerup', e => {
            if (!swiping) return;
            swiping = false;
            const dx = e.clientX - sx;
            const dy = e.clientY - sy;
            stage.style.transform = '';
            overlay.style.opacity = '';
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                if (dx < 0) nav(1); else nav(-1);
            } else if (dy > 100 && Math.abs(dy) > Math.abs(dx)) {
                closeViewer();
            }
        });
        overlay.addEventListener('pointercancel', () => {
            swiping = false;
            stage.style.transform = '';
            overlay.style.opacity = '';
        });

        function onKey(e) {
            if (!_viewer) return;
            if (e.key === 'Escape') { e.preventDefault(); closeViewer(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); nav(-1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); nav(1); }
        }
        document.addEventListener('keydown', onKey, true);
        _viewer.cleanup = () => { try { document.removeEventListener('keydown', onKey, true); } catch(_) {} };

        renderSlide();
    }
    function closeViewer() {
        if (!_viewer) return;
        if (_viewer.cleanup) { try { _viewer.cleanup(); } catch(_) {} }
        try { _viewer.el.remove(); } catch(_) {}
        _viewer = null;
    }

    // ═══ NAV ═══
    function onBack() {
        if (_viewer) return closeViewer();
        if (_selectionMode) return exitSelection();
        if (_currentAlbumId !== null) {
            if (_currentAlbumId === PRIVATE_FOLDER_ID) _privateUnlocked = false;
            _currentAlbumId = null;
            rerender();
            return;
        }
        closeApp();
    }

    // ═══ APP REGISTRATION ═══
    ctx.apps.register({
        id: APP_ID,
        name: 'Galeria',
        icon: ICON,
        accent: '#f9a8d4',
        bg: 'linear-gradient(135deg, #831843, #4c0519)',
        order: 7,
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

            _tab = 'photos';
            _currentAlbumId = null;
            _selectionMode = false;
            _selected = new Set();
            _pendingDeletes = new Map();
            _pendingCommitTimer = null;
            _loaded = false;
            _viewer = null;
            _pinFlow = null;
            _privateUnlocked = false;
            _lpFiredId = null;
            _lastViewSig = '';

            await loadStyleModule();
            renderShell();
            hidePhoneBar();
            rerender();
            await loadAll();
            if (_root) rerender();
        },

        unmount() {
            closeViewer();
            closeMoreMenu();
            closeMovePicker();
            closePinModal();
            showPhoneBar();

            if (_pendingCommitTimer) { clearTimeout(_pendingCommitTimer); _pendingCommitTimer = null; }
            if (_pendingDeletes.size) commitPendingDeletes();

            revokeAllBlobUrls();
            if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
            if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }

            _root = null;
            _appEl = null;
            _photos = [];
            _folders = [];
            _pendingDeletes = new Map();
            _selectionMode = false;
            _selected = new Set();
            _loaded = false;
            _pinFlow = null;
            _lpFiredId = null;
            _lastViewSig = '';
        }
    });
})();
