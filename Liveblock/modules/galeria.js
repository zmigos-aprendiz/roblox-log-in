(function () {
  'use strict';
  const _galeria = '_galeria';
  if (window[_galeria]) { try { window[_galeria].kill(); } catch (e) {} }

  const DB_NAME = 'ga_module_db', STORE = 'photos', FOLDER_STORE = 'folders';
  const NOTES_KEY = 'ga_module_notes_v1', POS_KEY = 'ga_module_pos_v1';
  const MAX_DIM = 1600, JPEG_QUALITY = 0.82, SOFT_DELETE_MS = 4500;

  const cleanup = [];
  const on = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); cleanup.push(() => t.removeEventListener(type, fn, opt)); };
  const onKeyActivate = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- IndexedDB (conexão cacheada) ----------
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
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; rej(req.error); };
      function resolve(db) { db.onclose = () => { dbPromise = null; }; res(db); }
    });
    return dbPromise;
  }
  const dbGetAllPhotos = async () => { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const r = tx.objectStore(STORE).getAll(); r.onsuccess = () => res(r.result.sort((a, b) => b.createdAt - a.createdAt)); r.onerror = () => rej(r.error); }); };
  const dbPutPhoto = async (p) => { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(p); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
  const dbDeletePhoto = async (id) => { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
  const dbGetAllFolders = async () => { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction(FOLDER_STORE, 'readonly'); const r = tx.objectStore(FOLDER_STORE).getAll(); r.onsuccess = () => res(r.result.sort((a, b) => a.createdAt - b.createdAt)); r.onerror = () => rej(r.error); }); };
  const dbPutFolder = async (f) => { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction(FOLDER_STORE, 'readwrite'); tx.objectStore(FOLDER_STORE).put(f); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
  const dbDeleteFolder = async (id) => {
    const db = await openDb();
    const toDelete = (await dbGetAllPhotos()).filter((p) => p.folderId === id);
    return new Promise((res, rej) => {
      const tx = db.transaction([FOLDER_STORE, STORE], 'readwrite');
      tx.objectStore(FOLDER_STORE).delete(id);
      const ps = tx.objectStore(STORE);
      toDelete.forEach((p) => ps.delete(p.id));
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  };

  const loadNotes = () => { try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); } catch { return []; } };
  const saveNotes = (n) => localStorage.setItem(NOTES_KEY, JSON.stringify(n));
  const loadPos = () => { try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (p && typeof p.left === 'number') return p; } catch {} return null; };
  const savePos = (left, top) => localStorage.setItem(POS_KEY, JSON.stringify({ left, top }));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const fileToDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const clamp = (v, mn, mx) => Math.min(Math.max(v, mn), mx);

  // Redimensiona/comprime a imagem via canvas antes de salvar (fundo branco p/ manter transparência sem artefatos)
  function compressImage(file, maxDim = MAX_DIM, quality = JPEG_QUALITY) {
    return fileToDataUrl(file).then((dataUrl) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        try { resolve(canvas.toDataURL('image/jpeg', quality)); } catch { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    }));
  }

  const ICONS = {
    camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.3"/></svg>`,
    note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l5 5v13H6z"/><path d="M15 3v5h5"/><path d="M9 12h6M9 16h6"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
    folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a1 1 0 0 1 1-1h4.5l2 2H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>`,
    chevronLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>`,
    chevronBig: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 19h16"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9m0 0-4 4m4-4 4 4M4 5h16"/></svg>`,
  };

  const host = document.createElement('div');
  host.id = 'ga-module-host';
  Object.assign(host.style, { all: 'initial', position: 'fixed', zIndex: '2147483000' });
  (document.body || document.documentElement).appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `<style>
:host{all:initial}
*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@keyframes gaPulse{0%,100%{opacity:1}50%{opacity:.35}}
.toggle{width:52px;height:52px;border-radius:16px;background:linear-gradient(160deg,#C99383,#B77E6E);border:none;cursor:grab;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(90,60,45,.28);color:#FBF7F1;transition:transform .18s ease,box-shadow .18s ease;touch-action:none}
.toggle:hover{transform:translateY(-2px);box-shadow:0 10px 20px rgba(90,60,45,.32)}
.toggle.dragging{cursor:grabbing;transform:none}
.toggle svg{width:22px;height:22px;pointer-events:none}
.panel{position:absolute;width:320px;max-width:min(320px,92vw);background:#FBF7F1;border:1px solid #E9E0D3;border-radius:18px;box-shadow:0 18px 40px rgba(70,50,35,.22);display:none;flex-direction:column;overflow:hidden}
.panel.open{display:flex}
.titlebar{display:flex;align-items:center;justify-content:space-between;padding:12px 12px 8px 16px;cursor:grab;touch-action:none;user-select:none}
.titlebar.dragging{cursor:grabbing}
.titlebar .title{font-size:14.5px;font-weight:700;color:#6E4B3B;letter-spacing:.2px}
.head{display:flex;align-items:center;justify-content:space-between;padding:0 14px 10px;border-bottom:1px solid #EFE7D9}
.tabs{display:flex;gap:6px}
.tab{border:none;background:transparent;cursor:pointer;padding:7px 11px;border-radius:10px;font-size:13px;font-weight:600;color:#8B7E6E;display:flex;align-items:center;gap:6px;transition:background .15s ease,color .15s ease}
.tab svg{width:15px;height:15px}
.tab.active{background:#EFE1D8;color:#6E4B3B}
.close-btn{border:none;background:transparent;cursor:pointer;color:#A99B8A;padding:4px;border-radius:8px}
.close-btn:hover{background:#F1E9DC;color:#6E4B3B}
.close-btn svg{width:16px;height:16px}
.body{padding:12px 14px 14px;overflow-y:auto;flex:1;max-height:400px}
.body::-webkit-scrollbar{width:6px}
.body::-webkit-scrollbar-thumb{background:#E3D8C7;border-radius:6px}
.toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;min-height:20px;gap:8px}
.breadcrumb{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:#8B7E6E;min-width:0}
.breadcrumb button{border:none;background:transparent;cursor:pointer;color:#B77E6E;display:flex;align-items:center;padding:2px;border-radius:6px;flex-shrink:0}
.breadcrumb button:hover{background:#F1E9DC}
.breadcrumb button svg{width:14px;height:14px}
.breadcrumb .current{color:#6E4B3B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sel-toggle{border:none;background:transparent;color:#A99B8A;font-size:10.5px;font-weight:700;display:flex;align-items:center;gap:4px;cursor:pointer;padding:4px 7px;border-radius:8px;flex-shrink:0}
.sel-toggle svg{width:12px;height:12px}
.sel-toggle:hover{background:#F1E9DC;color:#6E4B3B}
.sel-toggle.active{background:#EFE1D8;color:#6E4B3B}
.actions-row{display:flex;gap:7px;margin-bottom:10px}
.action-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:9px;border-radius:12px;border:1.5px dashed #D9C7B4;background:#FFFDFB;color:#8F7C68;font-size:12px;font-weight:600;cursor:pointer;transition:border-color .15s ease,color .15s ease}
.action-btn:hover{border-color:#C99383;color:#B77E6E}
.action-btn.processing{opacity:.65;pointer-events:none}
.action-btn svg{width:14px;height:14px;flex-shrink:0}
input[type=file]{display:none}
.new-folder-row{display:flex;gap:6px;margin-bottom:10px}
.new-folder-row input{flex:1;border:1.5px solid #E3D8C7;border-radius:10px;padding:7px 10px;font-size:12.5px;color:#4A4239;outline:none;background:#FFFDFB}
.new-folder-row input:focus{border-color:#C99383}
.new-folder-row button{border:none;border-radius:10px;width:32px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.new-folder-row .confirm{background:#90A88C;color:#fff}
.new-folder-row .cancel{background:#F1E9DC;color:#8B7E6E}
.new-folder-row svg{width:14px;height:14px}
.sel-bar{display:none;align-items:center;justify-content:space-between;background:#F3E9DC;border-radius:12px;padding:7px 10px;margin-bottom:10px;font-size:11.5px;font-weight:700;color:#6E4B3B}
.sel-bar .sel-actions{display:flex;gap:6px}
.sel-bar button{border:1px solid #E9DDC9;background:#fff;border-radius:8px;padding:5px 9px;font-size:11px;font-weight:700;color:#6E4B3B;cursor:pointer;display:flex;align-items:center;gap:4px}
.sel-bar button svg{width:12px;height:12px}
.sel-bar button:hover{background:#FFFDFB}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.thumb{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;cursor:pointer;background:#F1E9DC}
.thumb:focus-visible,.folder-tile:focus-visible,.sel-toggle:focus-visible,.tab:focus-visible,.action-btn:focus-visible,.close-btn:focus-visible,.toggle:focus-visible{outline:2px solid #C99383;outline-offset:2px}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.thumb .del,.thumb .move{position:absolute;top:3px;width:20px;height:20px;border-radius:7px;background:rgba(60,40,30,.55);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;opacity:0;transition:opacity .12s ease}
.thumb .del{right:3px}
.thumb .move{left:3px}
.thumb:hover .del,.thumb:hover .move{opacity:1}
.thumb .del svg,.thumb .move svg{width:11px;height:11px}
.thumb.selectable{cursor:pointer}
.thumb.selected{outline:2.5px solid #C99383;outline-offset:-2.5px}
.thumb .check{position:absolute;top:4px;left:4px;width:19px;height:19px;border-radius:6px;background:rgba(255,255,255,.9);border:1.5px solid #C99383;display:flex;align-items:center;justify-content:center;color:#C99383}
.thumb.selected .check{background:#C99383;color:#fff}
.thumb .check svg{width:12px;height:12px}
.folder-tile{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;cursor:pointer;background:#F3E9DC;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:1px solid #EAD9C4}
.folder-tile:hover{background:#EFE1D0}
.folder-tile svg{width:26px;height:26px;color:#B77E6E}
.folder-tile .fname{font-size:10.5px;font-weight:700;color:#6E4B3B;text-align:center;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.folder-tile .rename-input{width:88%;font-size:10.5px;font-weight:700;color:#6E4B3B;text-align:center;border:1px solid #C99383;border-radius:6px;padding:1px 4px;background:#FFFDFB;outline:none}
.folder-tile .fcount{font-size:9px;color:#A99584}
.folder-tile .del{position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:6px;background:rgba(60,40,30,.55);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;opacity:0;transition:opacity .12s ease}
.folder-tile:hover .del{opacity:1}
.folder-tile .del svg{width:10px;height:10px;color:#fff}
.empty{text-align:center;color:#B3A392;font-size:12.5px;padding:22px 6px;line-height:1.5;grid-column:1/-1}
.move-menu{position:fixed;background:#FBF7F1;border:1px solid #E9E0D3;border-radius:10px;box-shadow:0 12px 26px rgba(70,50,35,.24);padding:4px;z-index:30;max-height:180px;overflow-y:auto;min-width:150px}
.move-menu button{display:flex;align-items:center;gap:6px;width:100%;text-align:left;padding:7px 8px;border:none;background:transparent;font-size:12px;color:#4A4239;border-radius:7px;cursor:pointer}
.move-menu button:hover{background:#F1E9DC}
.move-menu button svg{width:13px;height:13px;color:#B77E6E;flex-shrink:0}
.backup-row{display:flex;justify-content:center;gap:16px;padding:7px 10px;border-top:1px solid #EFE7D9;background:#F7F1E7;flex-shrink:0}
.backup-row button{border:none;background:transparent;color:#A99B8A;font-size:10px;font-weight:700;display:flex;align-items:center;gap:4px;cursor:pointer}
.backup-row button:hover{color:#6E4B3B}
.backup-row svg{width:12px;height:12px}
.toast{position:absolute;left:50%;bottom:12px;transform:translate(-50%,8px);background:#6E4B3B;color:#FBF7F1;font-size:12px;font-weight:600;padding:7px 10px 7px 14px;border-radius:20px;opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;white-space:nowrap;display:flex;align-items:center;gap:8px;max-width:90%}
.toast.show{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.toast-action{border:1px solid rgba(251,247,241,.4);background:transparent;color:#FBF7F1;border-radius:8px;padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0}
.toast-action:hover{background:rgba(255,255,255,.15)}
.lightbox{position:fixed;inset:0;background:rgba(40,28,22,.55);display:none;align-items:center;justify-content:center;z-index:10}
.lightbox.open{display:flex}
.lightbox img{max-width:88%;max-height:82%;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.4)}
.lightbox .close-btn{position:absolute;top:16px;right:16px;color:#fff;background:rgba(255,255,255,.15)}
.lightbox .close-btn:hover{background:rgba(255,255,255,.28);color:#fff}
.lightbox .nav{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.15);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer}
.lightbox .nav:hover{background:rgba(255,255,255,.28)}
.lightbox .nav svg{width:20px;height:20px}
.lightbox .nav.prev{left:16px}
.lightbox .nav.next{right:16px}
.lightbox .lb-del{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer}
.lightbox .lb-del:hover{background:rgba(251,113,133,.55)}
.lightbox .lb-del svg{width:13px;height:13px}
.add-note{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:8px;border-radius:12px;margin-bottom:10px;border:none;background:#EFE1D8;color:#6E4B3B;font-size:12.5px;font-weight:600;cursor:pointer;transition:background .15s ease}
.add-note:hover{background:#E8D5C6}
.add-note svg{width:13px;height:13px}
.note{background:#FFFDFB;border:1px solid #EFE7D9;border-left:3px solid #90A88C;border-radius:10px;padding:9px 10px;margin-bottom:8px}
.note textarea{width:100%;border:none;resize:none;background:transparent;font-size:13px;color:#4A4239;line-height:1.45;font-family:inherit;min-height:40px;outline:none;overflow:hidden}
.note-foot{display:flex;align-items:center;justify-content:space-between;margin-top:4px}
.note-status{display:flex;align-items:center;gap:5px;font-size:10.5px;color:#B3A392}
.status-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;background:#C9BBA5}
.status-dot.saved{background:#90A88C}
.status-dot.editing{background:#D9A55A;animation:gaPulse 1s ease-in-out infinite}
.note-del{border:none;background:transparent;cursor:pointer;color:#C4A995;padding:3px;border-radius:6px}
.note-del:hover{background:#F5EBDE;color:#B77E6E}
.note-del svg{width:12px;height:12px}
</style>
<button class="toggle" title="Galeria e anotações" aria-label="Abrir galeria e anotações">${ICONS.camera}</button>
<div class="panel">
<div class="titlebar"><span class="title">Galeria</span><button class="close-btn" data-close title="Fechar" aria-label="Fechar painel">${ICONS.close}</button></div>
<div class="head"><div class="tabs"><button class="tab active" data-tab="gallery">${ICONS.camera} Fotos</button><button class="tab" data-tab="notes">${ICONS.note} Notas</button></div></div>
<div class="body">
<div class="view" data-view="gallery">
<div class="toolbar">
<div class="breadcrumb" style="display:none"><button class="bc-back" title="Voltar" aria-label="Voltar para o início">${ICONS.chevronLeft}</button><span class="bc-root">Início</span><span>/</span><span class="current bc-name"></span></div>
<button class="sel-toggle" title="Selecionar fotos">${ICONS.check}<span>Selecionar</span></button>
</div>
<div class="actions-row"><label class="action-btn upload-label">${ICONS.plus}<span class="upload-label-text">Adicionar fotos</span><input type="file" accept="image/*" multiple></label><button class="action-btn new-folder-btn">${ICONS.folder} Nova pasta</button></div>
<div class="new-folder-row" style="display:none"><input type="text" maxlength="40" placeholder="Nome da pasta"><button class="confirm" aria-label="Confirmar">${ICONS.check}</button><button class="cancel" aria-label="Cancelar">${ICONS.close}</button></div>
<div class="sel-bar"><span class="sel-count"></span><div class="sel-actions"><button class="sel-move">${ICONS.folder} Mover</button><button class="sel-delete">${ICONS.trash} Excluir</button></div></div>
<div class="grid"></div>
</div>
<div class="view" data-view="notes" style="display:none"><button class="add-note">${ICONS.plus} Nova nota</button><div class="notes-list"></div></div>
</div>
<div class="backup-row">
<button class="export-btn">${ICONS.download}<span>Exportar</span></button>
<button class="import-btn">${ICONS.upload}<span>Importar</span></button>
<input type="file" accept="application/json" class="import-input" hidden>
</div>
<div class="toast"></div>
</div>
<div class="lightbox" tabindex="-1">
<button class="close-btn" data-lb-close title="Fechar" aria-label="Fechar imagem">${ICONS.close}</button>
<button class="nav prev" title="Anterior" aria-label="Foto anterior">${ICONS.chevronBig}</button>
<img src="" alt="">
<button class="nav next" title="Próxima" aria-label="Próxima foto"><span style="display:inline-block;transform:rotate(180deg)">${ICONS.chevronBig}</span></button>
<button class="lb-del" aria-label="Excluir esta foto">${ICONS.trash} Excluir</button>
</div>`;

  const $ = (s) => shadow.querySelector(s);
  const toggleBtn = $('.toggle'), panel = $('.panel'), titlebar = $('.titlebar'), closeBtn = $('[data-close]');
  const tabs = shadow.querySelectorAll('.tab'), views = shadow.querySelectorAll('.view'), grid = $('.grid');
  const fileInput = $('input[type=file]'), uploadLabel = $('.upload-label'), uploadLabelText = $('.upload-label-text');
  const lightbox = $('.lightbox'), lightboxImg = lightbox.querySelector('img'), lbClose = $('[data-lb-close]');
  const lbPrev = $('.nav.prev'), lbNext = $('.nav.next'), lbDel = $('.lb-del');
  const addNoteBtn = $('.add-note'), notesList = $('.notes-list');
  const breadcrumb = $('.breadcrumb'), bcBack = $('.bc-back'), bcRoot = $('.bc-root'), bcName = $('.bc-name');
  const newFolderBtn = $('.new-folder-btn'), newFolderRow = $('.new-folder-row');
  const newFolderInput = newFolderRow.querySelector('input'), newFolderConfirm = newFolderRow.querySelector('.confirm'), newFolderCancel = newFolderRow.querySelector('.cancel');
  const selToggle = $('.sel-toggle'), selBar = $('.sel-bar'), selCount = $('.sel-count'), selMoveBtn = $('.sel-move'), selDeleteBtn = $('.sel-delete');
  const toastEl = $('.toast');

  // ---------- Bloqueia teclas/entrada de vazar para a página (jogo) SEM quebrar os listeners internos ----------
  ['keydown', 'keyup', 'keypress', 'input', 'beforeinput'].forEach((t) => on(host, t, (e) => e.stopPropagation()));

  let currentFolderId = null, toastTimer = null;
  let selectionMode = false, selectedIds = new Set();
  let hiddenPhotoIds = new Set(), hiddenFolderIds = new Set();
  let pending = null;
  let currentVisiblePhotos = [], lightboxIndex = -1;

  function showToast(msg, opts = {}) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = msg;
    toastEl.appendChild(span);
    if (opts.actionLabel && opts.onAction) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = opts.actionLabel;
      btn.addEventListener('click', () => { opts.onAction(); toastEl.classList.remove('show'); clearTimeout(toastTimer); });
      toastEl.appendChild(btn);
    }
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), opts.duration || 1800);
  }

  function commitPending() { if (!pending) return; clearTimeout(pending.timer); const p = pending; pending = null; p.commit(); }
  function cancelPending() { if (!pending) return; clearTimeout(pending.timer); const p = pending; pending = null; p.undo(); }
  function scheduleSoftDelete({ label, commit, undo }) {
    if (pending) commitPending();
    const timer = setTimeout(() => { pending = null; commit(); }, SOFT_DELETE_MS);
    pending = { commit, undo, timer };
    showToast(label, { actionLabel: 'Desfazer', onAction: cancelPending, duration: SOFT_DELETE_MS });
  }

  function softDeletePhoto(photo) {
    hiddenPhotoIds.add(photo.id);
    renderGallery();
    scheduleSoftDelete({
      label: 'Foto excluída',
      commit: async () => { hiddenPhotoIds.delete(photo.id); await dbDeletePhoto(photo.id); },
      undo: () => { hiddenPhotoIds.delete(photo.id); renderGallery(); showToast('Foto restaurada'); },
    });
  }

  function softDeleteFolder(folder) {
    hiddenFolderIds.add(folder.id);
    if (currentFolderId === folder.id) currentFolderId = null;
    renderGallery();
    scheduleSoftDelete({
      label: `Pasta "${folder.name}" excluída`,
      commit: async () => { hiddenFolderIds.delete(folder.id); await dbDeleteFolder(folder.id); },
      undo: () => { hiddenFolderIds.delete(folder.id); renderGallery(); showToast('Pasta restaurada'); },
    });
  }

  function bulkSoftDeleteSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    ids.forEach((id) => hiddenPhotoIds.add(id));
    selectionMode = false; selectedIds = new Set();
    renderGallery();
    scheduleSoftDelete({
      label: ids.length + (ids.length === 1 ? ' foto excluída' : ' fotos excluídas'),
      commit: async () => { for (const id of ids) { hiddenPhotoIds.delete(id); await dbDeletePhoto(id); } },
      undo: () => { ids.forEach((id) => hiddenPhotoIds.delete(id)); renderGallery(); showToast('Restauradas'); },
    });
  }

  async function bulkMoveSelected(targetId) {
    const ids = [...selectedIds];
    const photos = await dbGetAllPhotos();
    for (const id of ids) { const p = photos.find((x) => x.id === id); if (p) await dbPutPhoto({ ...p, folderId: targetId }); }
    selectionMode = false; selectedIds = new Set();
    showToast('Fotos movidas');
    renderGallery();
  }

  function closeMoveMenu() { const m = shadow.querySelector('.move-menu'); if (m) m.remove(); }
  async function openMoveMenu(anchorEl, excludeFolderId, onPick) {
    closeMoveMenu();
    const folders = await dbGetAllFolders();
    const menu = document.createElement('div');
    menu.className = 'move-menu';
    const items = [];
    if (excludeFolderId !== null) items.push(`<button data-target="">${ICONS.folder} Início (sem pasta)</button>`);
    folders.forEach((f) => { if (f.id !== excludeFolderId) items.push(`<button data-target="${f.id}">${ICONS.folder} ${escapeHtml(f.name)}</button>`); });
    menu.innerHTML = items.length ? items.join('') : '<div style="padding:8px;font-size:11px;color:#B3A392">Nenhuma outra pasta</div>';
    shadow.appendChild(menu);
    const r = anchorEl.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    requestAnimationFrame(() => {
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      let left = r.left, top = r.bottom + 4;
      if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
      if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
      menu.style.left = Math.max(4, left) + 'px';
      menu.style.top = Math.max(4, top) + 'px';
    });
    menu.querySelectorAll('button[data-target]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); onPick(btn.dataset.target || null); closeMoveMenu(); });
    });
  }
  on(window, 'pointerdown', (e) => {
    const menu = shadow.querySelector('.move-menu');
    if (!menu) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (!path.includes(menu)) closeMoveMenu();
  });

  function applyHostPosition(left, top) {
    const r = host.getBoundingClientRect(), w = r.width || 52, h = r.height || 52;
    left = clamp(left, 4, window.innerWidth - w - 4);
    top = clamp(top, 4, window.innerHeight - h - 4);
    Object.assign(host.style, { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' });
  }
  function initPosition() {
    const saved = loadPos();
    if (saved) applyHostPosition(saved.left, saved.top);
    else applyHostPosition(window.innerWidth - 72, window.innerHeight - 72);
  }
  function positionPanel() {
    const tr = toggleBtn.getBoundingClientRect(), gap = 8;
    const spaceBelow = window.innerHeight - tr.bottom - gap, spaceAbove = tr.top - gap;
    const spaceRight = window.innerWidth - tr.left;
    const up = spaceAbove > spaceBelow, left = spaceRight < 340;
    panel.style.top = up ? 'auto' : (tr.height + gap) + 'px';
    panel.style.bottom = up ? (tr.height + gap) + 'px' : 'auto';
    panel.style.left = left ? 'auto' : '0';
    panel.style.right = left ? '0' : 'auto';
    const avail = (up ? spaceAbove : spaceBelow) - 4;
    panel.style.maxHeight = clamp(avail, 220, Math.min(window.innerHeight * 0.75, 620)) + 'px';
  }
  const onResize = () => { const r = host.getBoundingClientRect(); applyHostPosition(r.left, r.top); if (panel.classList.contains('open')) positionPanel(); };
  on(window, 'resize', onResize);

  function makeDraggable(handle, onClick) {
    let dragging = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0;
    on(handle, 'pointerdown', (e) => {
      if (e.button) return;
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
      const r = host.getBoundingClientRect(); sl = r.left; st = r.top;
      handle.setPointerCapture(e.pointerId); handle.classList.add('dragging');
    });
    on(handle, 'pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
      if (!moved) return;
      applyHostPosition(sl + dx, st + dy);
      if (panel.classList.contains('open')) positionPanel();
    });
    const end = () => {
      if (!dragging) return;
      dragging = false; handle.classList.remove('dragging');
      if (moved) { const r = host.getBoundingClientRect(); savePos(r.left, r.top); }
      else if (onClick) onClick();
    };
    on(handle, 'pointerup', end);
    on(handle, 'pointercancel', end);
  }
  makeDraggable(toggleBtn, () => { panel.classList.toggle('open'); if (panel.classList.contains('open')) positionPanel(); });
  makeDraggable(titlebar);

  on(closeBtn, 'click', () => panel.classList.remove('open'));
  tabs.forEach((tab) => on(tab, 'click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    views.forEach((v) => { v.style.display = v.dataset.view === tab.dataset.tab ? 'block' : 'none'; });
  }));

  const fmtDate = (ts) => { const d = new Date(ts); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };

  // ---------- Galeria ----------

  function startRenameFolder(tileEl, folder) {
    const fnameEl = tileEl.querySelector('.fname');
    const input = document.createElement('input');
    input.type = 'text'; input.value = folder.name; input.maxLength = 40; input.className = 'rename-input';
    fnameEl.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = async () => {
      if (done) return; done = true;
      const val = input.value.trim() || folder.name;
      await dbPutFolder({ ...folder, name: val });
      renderGallery();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { done = true; renderGallery(); } });
    input.addEventListener('blur', commit);
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  function updateToolbar(folders) {
    if (currentFolderId === null) { breadcrumb.style.display = 'none'; }
    else { const f = folders.find((x) => x.id === currentFolderId); breadcrumb.style.display = 'flex'; bcName.textContent = f ? f.name : ''; }
    newFolderBtn.style.display = (currentFolderId === null && !selectionMode) ? 'flex' : 'none';
    selToggle.querySelector('span').textContent = selectionMode ? 'Cancelar' : 'Selecionar';
    selToggle.classList.toggle('active', selectionMode);
    selBar.style.display = (selectionMode && selectedIds.size) ? 'flex' : 'none';
    if (selectedIds.size) selCount.textContent = selectedIds.size + (selectedIds.size === 1 ? ' selecionada' : ' selecionadas');
  }

  function toggleSelect(id) { if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id); renderGallery(); }

  async function renderGallery() {
    const [photosRaw, foldersRaw] = await Promise.all([dbGetAllPhotos(), dbGetAllFolders()]);
    const photos = photosRaw.filter((p) => !hiddenPhotoIds.has(p.id));
    const folders = foldersRaw.filter((f) => !hiddenFolderIds.has(f.id));
    updateToolbar(folders);
    grid.innerHTML = '';

    if (currentFolderId === null && !selectionMode) {
      for (const f of folders) {
        const count = photos.filter((p) => p.folderId === f.id).length;
        const div = document.createElement('div');
        div.className = 'folder-tile';
        div.tabIndex = 0; div.setAttribute('role', 'button'); div.setAttribute('aria-label', 'Abrir pasta ' + f.name);
        div.innerHTML = `${ICONS.folder}<span class="fname"></span><span class="fcount">${count} foto${count === 1 ? '' : 's'}</span><button class="del" aria-label="Excluir pasta" title="Excluir pasta">${ICONS.trash}</button>`;
        div.querySelector('.fname').textContent = f.name;
        const openFolder = () => { currentFolderId = f.id; renderGallery(); };
        div.addEventListener('click', (e) => { if (e.target.closest('.del')) return; openFolder(); });
        div.addEventListener('keydown', onKeyActivate(openFolder));
        div.querySelector('.fname').addEventListener('dblclick', (e) => { e.stopPropagation(); startRenameFolder(div, f); });
        div.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); softDeleteFolder(f); });
        grid.appendChild(div);
      }
    }

    const visible = photos.filter((p) => (p.folderId || null) === currentFolderId);
    currentVisiblePhotos = visible;

    if (!visible.length && (currentFolderId !== null || !folders.length || selectionMode)) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = currentFolderId !== null ? 'Pasta vazia.<br>Adicione fotos ou cole com Ctrl+V.' : 'Sem fotos ainda.<br>Adicione a primeira acima ou cole com Ctrl+V.';
      grid.appendChild(empty);
    }

    visible.forEach((p) => {
      const isSel = selectedIds.has(p.id);
      const div = document.createElement('div');
      div.className = 'thumb' + (selectionMode ? ' selectable' : '') + (isSel ? ' selected' : '');
      div.tabIndex = 0; div.setAttribute('role', 'button');
      div.setAttribute('aria-label', selectionMode ? (isSel ? 'Foto selecionada' : 'Selecionar foto') : 'Abrir foto');
      div.innerHTML = `<img loading="lazy" src="${p.dataUrl}" alt="">` + (selectionMode
        ? `<span class="check">${isSel ? ICONS.check : ''}</span>`
        : `<button class="del" aria-label="Excluir foto" title="Excluir">${ICONS.trash}</button><button class="move" aria-label="Mover foto" title="Mover para pasta">${ICONS.folder}</button>`);
      const mainAction = () => {
        if (selectionMode) { toggleSelect(p.id); return; }
        openLightbox(visible, visible.findIndex((x) => x.id === p.id));
      };
      div.addEventListener('click', (e) => { if (e.target.closest('.del') || e.target.closest('.move')) return; mainAction(); });
      div.addEventListener('keydown', onKeyActivate(mainAction));
      if (!selectionMode) {
        div.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); softDeletePhoto(p); });
        div.querySelector('.move').addEventListener('click', (e) => {
          e.stopPropagation();
          openMoveMenu(div.querySelector('.move'), p.folderId || null, async (targetId) => {
            await dbPutPhoto({ ...p, folderId: targetId });
            showToast('Foto movida');
            renderGallery();
          });
        });
      }
      grid.appendChild(div);
    });
  }

  on(bcRoot, 'click', () => { currentFolderId = null; renderGallery(); });
  on(bcBack, 'click', () => { currentFolderId = null; renderGallery(); });
  on(newFolderBtn, 'click', () => { newFolderRow.style.display = 'flex'; newFolderInput.value = ''; newFolderInput.focus(); });

  async function confirmNewFolder() {
    const name = newFolderInput.value.trim();
    if (!name) return newFolderInput.focus();
    await dbPutFolder({ id: uid(), name, createdAt: Date.now() });
    newFolderRow.style.display = 'none'; showToast('Pasta criada'); renderGallery();
  }
  on(newFolderConfirm, 'click', confirmNewFolder);
  on(newFolderCancel, 'click', () => { newFolderRow.style.display = 'none'; });
  on(newFolderInput, 'keydown', (e) => { if (e.key === 'Enter') confirmNewFolder(); if (e.key === 'Escape') newFolderRow.style.display = 'none'; });

  on(selToggle, 'click', () => { selectionMode = !selectionMode; if (!selectionMode) selectedIds = new Set(); renderGallery(); });
  on(selMoveBtn, 'click', () => { if (!selectedIds.size) return; openMoveMenu(selMoveBtn, null, (targetId) => bulkMoveSelected(targetId)); });
  on(selDeleteBtn, 'click', () => { if (!selectedIds.size) return; bulkSoftDeleteSelected(); });

  async function processFiles(files, folderId) {
    if (!files.length) return;
    uploadLabel.classList.add('processing');
    const originalText = uploadLabelText.textContent;
    let done = 0;
    for (const file of files) {
      done++;
      uploadLabelText.textContent = `Processando ${done}/${files.length}...`;
      try {
        const dataUrl = await compressImage(file);
        await dbPutPhoto({ id: uid(), dataUrl, name: file.name || ('foto-' + Date.now()), createdAt: Date.now(), folderId });
      } catch (e) {}
    }
    uploadLabelText.textContent = originalText;
    uploadLabel.classList.remove('processing');
    showToast(files.length > 1 ? 'Fotos adicionadas' : 'Foto adicionada');
    renderGallery();
  }

  on(fileInput, 'change', async () => {
    const files = Array.from(fileInput.files || []);
    await processFiles(files, currentFolderId);
    fileInput.value = '';
  });

  // ---------- Lightbox ----------

  function updateLightboxImage() {
    const p = currentVisiblePhotos[lightboxIndex];
    if (!p) { lightbox.classList.remove('open'); return; }
    lightboxImg.src = p.dataUrl;
    const multi = currentVisiblePhotos.length > 1;
    lbPrev.style.visibility = multi ? 'visible' : 'hidden';
    lbNext.style.visibility = multi ? 'visible' : 'hidden';
  }
  function openLightbox(list, idx) {
    if (idx < 0) return;
    currentVisiblePhotos = list;
    lightboxIndex = idx;
    updateLightboxImage();
    lightbox.classList.add('open');
    lightbox.focus();
  }
  on(lbClose, 'click', () => lightbox.classList.remove('open'));
  on(lightbox, 'click', (e) => { if (e.target === lightbox) lightbox.classList.remove('open'); });
  on(lbPrev, 'click', () => { if (!currentVisiblePhotos.length) return; lightboxIndex = (lightboxIndex - 1 + currentVisiblePhotos.length) % currentVisiblePhotos.length; updateLightboxImage(); });
  on(lbNext, 'click', () => { if (!currentVisiblePhotos.length) return; lightboxIndex = (lightboxIndex + 1) % currentVisiblePhotos.length; updateLightboxImage(); });
  on(lbDel, 'click', () => {
    const p = currentVisiblePhotos[lightboxIndex];
    if (!p) return;
    lightbox.classList.remove('open');
    softDeletePhoto(p);
  });
  on(lightbox, 'keydown', (e) => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbPrev.click(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbNext.click(); }
    else if (e.key === 'Escape') { e.preventDefault(); lightbox.classList.remove('open'); }
  });

  const onPaste = async (e) => {
    if (!panel.classList.contains('open')) return;
    const activeTab = shadow.querySelector('.tab.active');
    if (!activeTab || activeTab.dataset.tab !== 'gallery') return;
    const items = (e.clipboardData || window.clipboardData)?.items;
    if (!items) return;
    const files = Array.from(items).filter((it) => it.type && it.type.startsWith('image/')).map((it) => it.getAsFile()).filter(Boolean);
    if (!files.length) return;
    e.preventDefault(); e.stopPropagation();
    await processFiles(files, currentFolderId);
  };
  on(window, 'paste', onPaste, true);

  // ---------- Notas ----------

  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

  function renderNotes() {
    const notes = loadNotes().sort((a, b) => b.updatedAt - a.updatedAt);
    if (!notes.length) { notesList.innerHTML = '<div class="empty">Nenhuma nota ainda.</div>'; return; }
    notesList.innerHTML = '';
    for (const n of notes) {
      const div = document.createElement('div');
      div.className = 'note';

      const ta = document.createElement('textarea');
      ta.placeholder = 'Escreva aqui...';
      ta.value = n.text;

      const foot = document.createElement('div');
      foot.className = 'note-foot';
      foot.innerHTML = `<span class="note-status"><span class="status-dot saved"></span><span class="status-text">${escapeHtml(fmtDate(n.updatedAt))}</span></span><button class="note-del" aria-label="Excluir nota" title="Excluir">${ICONS.trash}</button>`;

      div.appendChild(ta); div.appendChild(foot);
      notesList.appendChild(div);

      const dot = foot.querySelector('.status-dot');
      const statusText = foot.querySelector('.status-text');
      requestAnimationFrame(() => autoGrow(ta));

      let debounce;
      ta.addEventListener('input', () => {
        dot.className = 'status-dot editing';
        statusText.textContent = 'Editando…';
        autoGrow(ta);
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const all = loadNotes();
          const idx = all.findIndex((x) => x.id === n.id);
          if (idx > -1) {
            all[idx].text = ta.value;
            all[idx].updatedAt = Date.now();
            saveNotes(all);
            dot.className = 'status-dot saved';
            statusText.textContent = 'Salvo · ' + fmtDate(all[idx].updatedAt);
          }
        }, 500);
      });

      foot.querySelector('.note-del').addEventListener('click', () => {
        saveNotes(loadNotes().filter((x) => x.id !== n.id));
        renderNotes();
      });
    }
  }

  on(addNoteBtn, 'click', () => {
    const all = loadNotes();
    all.push({ id: uid(), text: '', createdAt: Date.now(), updatedAt: Date.now() });
    saveNotes(all); renderNotes();
    const first = notesList.querySelector('textarea');
    if (first) first.focus();
  });

  // ---------- Backup (exportar / importar) ----------

  async function exportBackup() {
    const [photos, folders] = await Promise.all([dbGetAllPhotos(), dbGetAllFolders()]);
    const notes = loadNotes();
    const payload = { version: 1, exportedAt: Date.now(), photos, folders, notes };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'galeria-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Backup exportado');
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (Array.isArray(data.folders)) for (const f of data.folders) await dbPutFolder(f);
        if (Array.isArray(data.photos)) for (const p of data.photos) await dbPutPhoto(p);
        if (Array.isArray(data.notes) && data.notes.length) saveNotes([...loadNotes(), ...data.notes]);
        showToast('Backup importado');
        renderGallery(); renderNotes();
      } catch (e) { showToast('Arquivo inválido'); }
    };
    reader.readAsText(file);
  }

  on($('.export-btn'), 'click', exportBackup);
  on($('.import-btn'), 'click', () => $('.import-input').click());
  on($('.import-input'), 'change', (e) => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; });

  // ═══════════════════════════════════════════════════════════════
  // Comandos de voz + helpers de UI reaproveitados
  // ═══════════════════════════════════════════════════════════════
  function abrirPainel() {
    if (!panel.classList.contains('open')) {
      panel.classList.add('open');
      positionPanel();
    }
  }
  function fecharPainel() { panel.classList.remove('open'); }
  function irParaAba(nome) {
    const tab = [...tabs].find(t => t.dataset.tab === nome);
    if (tab) tab.click();
  }
  function novaNotaRapida() {
    abrirPainel();
    irParaAba('notes');
    addNoteBtn.click();
  }

  // Feedback auditivo: silencia o voz.js por 2s antes de falar,
  // para o próprio TTS não ser reconhecido como fala do usuário.
  function falar(texto) {
    if (!window.speechSynthesis) return;
    try {
      window.dispatchEvent(new CustomEvent('sang:voz-silenciar', { detail: { ms: 2000 } }));
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'pt-BR';
      u.rate = 1.2;
      u.pitch = 1.05;
      u.volume = 0.9;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ─── Print ───
  const normalizarNome = s => String(s || '')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  async function encontrarPastaPorNome(nome) {
    const alvo = normalizarNome(nome);
    if (!alvo) return null;
    const pastas = await dbGetAllFolders();
    const nomeExato = String(nome).toLowerCase().trim();
    let p = pastas.find(x => x.name.toLowerCase().trim() === nomeExato);
    if (p) return p;
    p = pastas.find(x => normalizarNome(x.name) === alvo);
    if (p) return p;
    return pastas.find(x => normalizarNome(x.name).includes(alvo)) || null;
  }

  function capturarCanvas() {
    const canvases = [...document.querySelectorAll('canvas')]
      .filter(c => c.offsetWidth > 100 && c.offsetHeight > 100)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height));
    for (const c of canvases) {
      try {
        const d = c.toDataURL('image/png');
        if (d && d.length > 200) return d;
      } catch (e) {}
    }
    return null;
  }

  async function salvarPrintNaPasta(folderId, folderNome) {
    const dataUrl = capturarCanvas();
    if (!dataUrl) {
      falar('Falha ao capturar');
      showToast('Nenhum canvas capturável');
      return;
    }
    const nome = 'print-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png';
    try {
      await dbPutPhoto({ id: uid(), dataUrl, name: nome, createdAt: Date.now(), folderId });
      renderGallery();
      falar('Captura feita');
      showToast(folderNome ? `Print salvo em "${folderNome}"` : 'Print salvo');
    } catch (e) {
      falar('Falha ao salvar');
      showToast('Falha ao salvar print');
    }
  }

  function comandoPrint()      { salvarPrintNaPasta(currentFolderId, null); }
  function comandoPrintRaiz()  { salvarPrintNaPasta(null, null); }
  async function comandoPrintNaPasta(nome) {
    const pasta = await encontrarPastaPorNome(nome);
    if (!pasta) { falar('Pasta não encontrada'); showToast(`Pasta "${nome}" não existe`); return; }
    salvarPrintNaPasta(pasta.id, pasta.name);
  }

  // ─── Registro ───
  const voiceHandlers = [];

  function registrarComandosVoz() {
    if (!window._voiceCommands?.registrar) return false;
    if (voiceHandlers.length) return true;

    const R = (re, cb) => {
      const wrapped = (texto, norm) => {
        try { cb(texto, norm); }
        catch (e) { console.error('[Galeria] handler voz:', e); }
        return true;
      };
      window._voiceCommands.registrar(re, wrapped, 0);
      voiceHandlers.push(wrapped);
    };

    // Painel / abas
    R(/^(abrir?|abre|abra|ativar?|ativa|ligar?|liga|mostrar?|mostra)\s+(a\s+)?(galeria|fotos)$/,
      () => { abrirPainel(); irParaAba('gallery'); });

    R(/^(abrir?|abre|abra|ativar?|ativa|ligar?|liga|mostrar?|mostra)\s+(a\s+)?(notas|anotacoes|anotações)$/,
      () => { abrirPainel(); irParaAba('notes'); });

    R(/^(fechar?|feche|fecha|esconder?|esconde|desativar?|desativa|desligar?|desliga)\s+(a\s+)?(galeria|fotos|notas|anotacoes|anotações)$/,
      () => fecharPainel());

    // Pasta: criar (só abre input)
    R(/^(criar?|cria|nova?|novo|adicionar?|adiciona)\s+pasta$/,
      () => { abrirPainel(); irParaAba('gallery'); newFolderBtn.click(); newFolderInput.focus(); });

    // Pasta: criar com nome
    R(/^(criar?|cria|nova?|novo|adicionar?|adiciona)\s+pasta\s+.+$/,
      async (texto) => {
        const m = texto.match(/pasta\s+(?:chamada\s+|com\s+nome\s+)?(.+)$/i);
        const nome = m ? m[1].trim().slice(0, 40) : '';
        if (!nome) return;
        await dbPutFolder({ id: uid(), name: nome, createdAt: Date.now() });
        showToast(`Pasta "${nome}" criada`);
        renderGallery();
      });

    // Pasta: abrir por nome
    R(/^(abrir?|abre|abra|entrar?|entra|ir\s+para)\s+(?:na\s+)?pasta\s+.+$/,
      async (texto) => {
        const m = texto.match(/pasta\s+(.+)$/i);
        const nome = m ? m[1].trim() : '';
        const pasta = await encontrarPastaPorNome(nome);
        if (!pasta) { showToast(`Pasta "${nome}" não existe`); return; }
        currentFolderId = pasta.id;
        abrirPainel(); irParaAba('gallery');
        renderGallery();
        showToast(`Pasta "${pasta.name}" aberta`);
      });

    // Pasta: voltar para o início
    R(/^(voltar?|volta)\s+(para\s+)?(o\s+)?(inicio|início|raiz|home)$/,
      () => { currentFolderId = null; renderGallery(); showToast('Voltando para o início'); });

    // Pasta: listar
    R(/^listar?\s+pastas$/,
      async () => {
        const pastas = await dbGetAllFolders();
        if (!pastas.length) { showToast('Nenhuma pasta'); return; }
        const nomes = pastas.slice(0, 5).map(p => `"${p.name}"`).join(', ');
        showToast(pastas.length + (pastas.length === 1 ? ' pasta: ' : ' pastas: ') + nomes + (pastas.length > 5 ? '…' : ''));
      });

    // Pasta: excluir atual
    R(/^(excluir?|apagar?|deletar?|remover?)\s+(a\s+)?pasta\s+atual$/,
      async () => {
        if (currentFolderId === null) { showToast('Nenhuma pasta aberta'); return; }
        const pastas = await dbGetAllFolders();
        const f = pastas.find(x => x.id === currentFolderId);
        if (f) softDeleteFolder(f);
      });

    // Seleção
    R(/^(selecionar?|seleciona|marcar?|marca)\s+tudo$/,
      () => {
        if (!currentVisiblePhotos.length) { showToast('Nenhuma foto para selecionar'); return; }
        if (!selectionMode) selectionMode = true;
        selectedIds = new Set(currentVisiblePhotos.map(p => p.id));
        renderGallery();
        showToast(selectedIds.size + ' fotos selecionadas');
      });

    R(/^(desmarcar?|desmarca|limpar?|limpa|cancelar?|cancela)\s+(selecao|seleção|tudo)$/,
      () => { selectedIds = new Set(); renderGallery(); showToast('Seleção limpa'); });

    R(/^(mover?|move)\s+(a\s+)?(selecao|seleção|selecionadas?)$/,
      () => {
        if (!selectedIds.size) { showToast('Nada selecionado'); return; }
        abrirPainel(); irParaAba('gallery');
        openMoveMenu(selMoveBtn, null, (targetId) => bulkMoveSelected(targetId));
      });

    R(/^(excluir?|exclui|apagar?|apaga|deletar?|deleta|remover?|remove)\s+(a\s+)?(selecao|seleção|selecionadas?)$/,
      () => { if (!selectedIds.size) { showToast('Nada selecionado'); return; } bulkSoftDeleteSelected(); });

    // Lightbox
    R(/^(proxima|próxima|avancar?|avanca|avança|proximo|próximo)\s*(foto|imagem)?$/,
      () => { if (!lightbox.classList.contains('open')) { showToast('Nenhuma imagem aberta'); return; } lbNext.click(); });

    R(/^(anterior|retroceder?|retrocede)\s*(foto|imagem)?$/,
      () => { if (!lightbox.classList.contains('open')) { showToast('Nenhuma imagem aberta'); return; } lbPrev.click(); });

    R(/^(fechar?|feche|fecha)\s+(a\s+)?(imagem|foto|lightbox)$/,
      () => { if (lightbox.classList.contains('open')) lightbox.classList.remove('open'); });

    // Notas
    R(/^(criar?|cria|nova?|novo|adicionar?|adiciona)\s+(anotacao|anotação|nota)$/,
      () => novaNotaRapida());

    R(/^(salvar?|salva)\s+nota$/,
      () => { abrirPainel(); irParaAba('notes'); showToast('Notas salvam automaticamente'); });

    R(/^(concluir?|conclui|finalizar?|finaliza)(\s+(nota|anotacao|anotação))?$/,
      () => { abrirPainel(); irParaAba('notes'); showToast('Notas salvam automaticamente'); });

    // Print
    R(/^(tirar?|tira)\s+print$/, comandoPrint);
    R(/^(capturar?|captura)\s+(a\s+)?tela$/, comandoPrint);
    R(/^print$/, comandoPrint);
    R(/^(salvar?|salva)\s+(solto|solta|na\s+raiz|no\s+inicio|no\s+início)$/, comandoPrintRaiz);

    R(/^(salvar?|salva|tirar?|tira|capturar?|captura)\s+(?:print\s+)?na\s+pasta\s+.+$/,
      async (texto) => {
        const m = texto.match(/pasta\s+(.+)$/i);
        await comandoPrintNaPasta(m ? m[1].trim() : '');
      });

    // Backup
    R(/^(exportar?|exporta|fazer?|faz|salvar?|salva)\s+(backup|backup\s+da\s+galeria)$/,
      () => exportBackup());

    R(/^(exportar?|exporta)\s+(galeria|fotos|notas)$/,
      () => exportBackup());

    return true;
  }

  function limparComandosVoz() {
    if (!window._voiceCommands?.remover) return;
    voiceHandlers.forEach(h => window._voiceCommands.remover(h));
    voiceHandlers.length = 0;
  }

  if (!registrarComandosVoz()) {
    window.addEventListener('sang:voz-ready', registrarComandosVoz, { once: true });
  }

  initPosition();
  renderGallery();
  renderNotes();

  window[_galeria] = {
    kill() {
      if (pending) commitPending();
      closeMoveMenu();
      limparComandosVoz();
      if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} }
      cleanup.forEach((fn) => { try { fn(); } catch (e) {} });
      host.remove();
      delete window[_galeria];
    },
  };
})();
