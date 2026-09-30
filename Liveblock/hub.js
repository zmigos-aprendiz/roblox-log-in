// ==UserScript==
// @name         Sang Hub — ScriptLoader
// @namespace    http://tampermonkey.net/
// @version      2.2.4
// @description  Gerenciador de módulos
// @author       Sang
// @match        *://*.habblive.in/bigclient*
// @match        *://*.habblet.city/bigclient*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/hub.js
// @downloadURL  https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/hub.js
// ==/UserScript==

(function() {
    'use strict';

    const HUB_VERSION = "2.2.4";
    const HUB_UPDATE_URL = "https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/hub.js";
    const MANIFEST_URL = "https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/manifest.json";

    const UPDATE_INTERVAL_MS = 3 * 60 * 1000;
    const MANIFEST_CACHE_MS = 2 * 60 * 1000;
    const FETCH_TIMEOUT_MS = 5000;
    const FETCH_RETRIES = 2;

    const SHORTCUT_KEY = 'h';
    const SHORTCUT_LABEL = 'Alt+Shift+H';
    const AUTOLOAD_ENABLED = false;

    const LOG_PREFIX = '🔶 [Hub]';
    const HLOG = (...a) => console.log(LOG_PREFIX, ...a);
    const HWARN = (...a) => console.warn(LOG_PREFIX, ...a);
    const HERR = (...a) => console.error(LOG_PREFIX, ...a);

    const state = {
        manifest: { modules: [] },
        moduleStates: {},
        syncState: 'loading',
        lastSyncAt: null,
        killFlag: false,
        currentHubVersion: HUB_VERSION,
        updateTimer: null,
        heartbeatTimer: null,
        isUpdating: false,
        loadedInstances: {}
    };

    let renderListFn = null;
    let renderChromeFn = null;
    let toastFn = null;
    let uiRoot = null;
    let uiPill = null;

    // ==========================================
    // WEBSOCKET HOOK GLOBAL
    // ==========================================
    (function setupSocketHook() {
        if (window._hubSocket) return;

        const connectCbs = [];
        const messageCbs = [];
        let active = null;

        const OriginalWebSocket = window.WebSocket;

        function HookedWebSocket(...args) {
            const ws = new OriginalWebSocket(...args);
            active = ws;
            connectCbs.forEach(cb => { try { cb(ws); } catch(e) { console.error('[Hub Socket] onConnect cb error:', e); } });

            ws.addEventListener('message', (event) => {
                messageCbs.forEach(cb => { try { cb(event, ws); } catch(e) { console.error('[Hub Socket] onMessage cb error:', e); } });
            });

            ws.addEventListener('close', () => {
                if (active === ws) active = null;
            });

            return ws;
        }

        HookedWebSocket.prototype = OriginalWebSocket.prototype;
        Object.keys(OriginalWebSocket).forEach(key => {
            HookedWebSocket[key] = OriginalWebSocket[key];
        });

        window.WebSocket = HookedWebSocket;

        window._hubSocket = {
            getActive: () => active,
            onConnect: (cb) => { connectCbs.push(cb); if (active) cb(active); },
            onMessage: (cb) => { messageCbs.push(cb); },
            _original: OriginalWebSocket
        };

        HLOG('🔌 Hook de WebSocket instalado');
    })();

    function injectCode(code, id) {
        const tag = document.createElement('script');
        tag.textContent = code;
        if (id) tag.setAttribute('data-module', id);
        (document.head || document.documentElement).appendChild(tag);
        tag.remove();
    }

    function killInstance(instanceKey) {
        if (!instanceKey) return false;
        try {
            if (window[instanceKey] && typeof window[instanceKey].kill === 'function') {
                HLOG('💀 Matando instância antiga: ' + instanceKey);
                window[instanceKey].kill();
                delete window[instanceKey];
                HLOG('✅ Instância ' + instanceKey + ' removida');
                return true;
            }
            if (window[instanceKey]) {
                delete window[instanceKey];
                HLOG('⚠️ Instância ' + instanceKey + ' removida (sem kill)');
                return true;
            }
        } catch(e) {
            HWARN('Erro ao matar instância ' + instanceKey + ':', e);
            try { delete window[instanceKey]; } catch(e) {}
        }
        return false;
    }

    async function loadModule(mod) {
        if (mod.instanceKey) {
            killInstance(mod.instanceKey);
        }

        const url = mod.url + (mod.url.includes('?') ? '&' : '?') + 't=' + Date.now();
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const code = await res.text();
        injectCode(code, mod.id);

        if (mod.instanceKey) {
            state.loadedInstances[mod.id] = mod.instanceKey;
        }

        HLOG('✅ Módulo "' + mod.name + '" carregado');
    }

    function tryUnload(mod) {
        const key = mod.instanceKey;
        if (key) {
            return killInstance(key);
        }
        return false;
    }

    function getCache(key, ttl) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed.t || Date.now() - parsed.t > ttl) return null;
            return parsed.data;
        } catch(e) { return null; }
    }

    function setCache(key, data) {
        try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch(e) {}
    }

    function getCachedManifest() {
        return getCache('sanghub_manifest_cache', MANIFEST_CACHE_MS);
    }

    function setCachedManifest(data) {
        setCache('sanghub_manifest_cache', data);
    }

    function getCachedHubVersion() {
        return getCache('sanghub_version_cache', MANIFEST_CACHE_MS);
    }

    function setCachedHubVersion(version) {
        setCache('sanghub_version_cache', version);
    }

    async function fetchWithRetry(url, opts, timeout, retries) {
        let lastErr = null;
        for (let i = 0; i <= retries; i++) {
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), timeout);
                const res = await fetch(url, { ...opts, signal: ctrl.signal });
                clearTimeout(timer);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res;
            } catch(e) {
                lastErr = e;
                if (i < retries) await new Promise(r => setTimeout(r, 600 * (i + 1)));
            }
        }
        throw lastErr;
    }

    async function fetchManifest(bypassCache) {
        if (!bypassCache) {
            const cached = getCachedManifest();
            if (cached) return cached;
        }
        const res = await fetchWithRetry(
            MANIFEST_URL + '?t=' + Date.now(),
            { cache: 'no-store' },
            FETCH_TIMEOUT_MS,
            FETCH_RETRIES
        );
        const data = await res.json();
        setCachedManifest(data);
        return data;
    }

    async function checkHubUpdate() {
        if (state.isUpdating) return;
        state.isUpdating = true;
        try {
            const res = await fetchWithRetry(HUB_UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' }, 5000, 1);
            const code = await res.text();
            const versionMatch = code.match(/HUB_VERSION\s*=\s*["']([^"']+)["']/);
            if (!versionMatch) return;
            const remoteVersion = versionMatch[1];
            if (remoteVersion !== state.currentHubVersion) {
                HLOG('🔄 Nova versão do Hub: v' + remoteVersion + ' (atual: v' + state.currentHubVersion + ')');
                if (toastFn) toastFn('Atualizando Hub para v' + remoteVersion + '...', 'ok');
                applyHubUpdate(code);
            }
        } catch(e) {
            HWARN('Erro ao verificar Hub:', e);
        } finally {
            state.isUpdating = false;
        }
    }

    function applyHubUpdate(code) {
        try {
            if (window._hubUI && typeof window._hubUI.kill === 'function') {
                window._hubUI.kill();
            }
            document.querySelectorAll('[data-hub], [data-lb]').forEach(el => el.remove());

            const script = document.createElement('script');
            script.textContent = code;
            document.documentElement.appendChild(script);
            script.remove();

            HLOG('✅ Hub atualizado (hot reload)');
            if (toastFn) toastFn('Hub atualizado!', 'ok');
        } catch(e) {
            HERR('❌ Falha ao aplicar atualização:', e);
        }
    }

    async function loadSecretModules(manifest) {
        const secretModules = manifest.modules.filter(m => m.secret === true && m.enabled !== false);
        if (!secretModules.length) return;

        for (const mod of secretModules) {
            try {
                state.moduleStates[mod.id] = 'loading';
                await loadModule(mod);
                state.moduleStates[mod.id] = 'loaded';
            } catch(e) {
                state.moduleStates[mod.id] = 'error';
            }
        }
        if (renderListFn) renderListFn();
        if (renderChromeFn) renderChromeFn();
    }

    async function refreshManifest(bypassCache) {
        state.syncState = 'loading';
        if (renderChromeFn) renderChromeFn();
        if (renderListFn) renderListFn();

        try {
            const manifest = await fetchManifest(bypassCache);
            const oldVersion = state.manifest.version;
            const newVersion = manifest.version;

            if (oldVersion && oldVersion !== newVersion) {
                HLOG('📋 Manifesto v' + oldVersion + ' → v' + newVersion);
                if (toastFn) toastFn('Manifesto v' + newVersion, 'ok');

                const newIds = new Set(manifest.modules.map(m => m.id));
                (state.manifest.modules || []).forEach(mod => {
                    if (!newIds.has(mod.id) && state.moduleStates[mod.id] === 'loaded') {
                        tryUnload(mod);
                        state.moduleStates[mod.id] = 'unloaded';
                    }
                });
            }

            state.manifest = manifest;
            state.syncState = 'synced';
            state.lastSyncAt = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            await loadSecretModules(manifest);

            if (AUTOLOAD_ENABLED) {
                manifest.modules
                    .filter(m => m.enabled !== false && m.autoload === true && m.secret !== true && state.moduleStates[m.id] !== 'loaded')
                    .forEach(mod => activateModule(mod));
            }
        } catch(e) {
            HERR('❌ Falha no manifesto:', e);
            state.syncState = 'error';
            if (toastFn) toastFn('Erro ao carregar manifesto', 'error');
        }

        if (renderChromeFn) renderChromeFn();
        if (renderListFn) renderListFn();
    }

    async function autoUpdateLoop() {
        if (state.killFlag) return;
        HLOG('🔄 Verificando atualizações...');
        await checkHubUpdate();

        try {
            const cached = getCachedManifest();
            const fresh = await fetchManifest(true);
            if (cached && fresh && cached.version !== fresh.version) {
                HLOG('📋 Manifesto atualizado: v' + cached.version + ' → v' + fresh.version);
                await refreshManifest(true);
            } else if (!cached) {
                await refreshManifest(true);
            }
        } catch(e) {
            HWARN('Erro no auto-update:', e);
        }

        if (!state.killFlag) {
            if (state.updateTimer) clearTimeout(state.updateTimer);
            state.updateTimer = setTimeout(autoUpdateLoop, UPDATE_INTERVAL_MS);
        }
    }

    async function activateModule(mod) {
        if (state.moduleStates[mod.id] === 'loading') return;
        state.moduleStates[mod.id] = 'loading';
        if (renderListFn) renderListFn();

        try {
            await loadModule(mod);
            state.moduleStates[mod.id] = 'loaded';
            if (toastFn) toastFn(mod.name + ' carregado', 'ok');
        } catch(e) {
            HERR('Falha em "' + mod.name + '":', e);
            state.moduleStates[mod.id] = 'error';
            if (toastFn) toastFn('Falha em ' + mod.name, 'error');
        }
        if (renderListFn) renderListFn();
    }

    function deactivateModule(mod) {
        const ok = tryUnload(mod);
        state.moduleStates[mod.id] = 'unloaded';
        if (toastFn) toastFn(mod.name + (ok ? ' desativado' : ' — recarregue'), ok ? 'ok' : 'warn');
        if (renderListFn) renderListFn();
    }

    function handleModuleClick(mod) {
        if (mod.secret) return;
        const status = state.moduleStates[mod.id] || 'unloaded';
        if (status === 'loading') return;
        if (status === 'loaded') { deactivateModule(mod); return; }
        activateModule(mod);
    }

    function buildUI() {
        const UID = '_hub';

        const style = document.createElement('style');
        style.setAttribute('data-hub', '1');
        style.textContent = `
        @keyframes hubFade{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
        @keyframes hubPulse{0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes hubSpin{to{transform:rotate(360deg)}}

        #${UID}{position:fixed;top:16px;left:16px;width:280px;font-family:monospace;font-size:12px;
        color:#f3e3c4;background:linear-gradient(165deg,#4d2d10,#2b1608);border:1px solid #6b3f14;
        border-radius:10px;box-shadow:0 0 0 1px rgba(255,176,32,.18),0 16px 40px rgba(0,0,0,.55);
        z-index:2147483647;overflow:hidden;user-select:none;animation:hubFade .2s ease-out;max-height:90vh;display:flex;flex-direction:column}
        #${UID}.hidden{display:none}

        #${UID} .hub-hdr{padding:8px 10px;background:linear-gradient(180deg,rgba(255,176,32,.08),transparent);
        border-bottom:1px solid rgba(255,176,32,.2);display:flex;align-items:center;justify-content:space-between;cursor:grab;flex-shrink:0}
        #${UID} .hub-hdr:active{cursor:grabbing}
        #${UID} .hub-brand{display:flex;align-items:center;gap:6px;min-width:0}
        #${UID} .hub-key{flex-shrink:0}
        #${UID} .hub-title{font-weight:700;color:#ffd479;font-size:12px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
        #${UID} .hub-subtitle{font-size:8px;color:#a67c4a;display:flex;align-items:center;gap:4px}
        #${UID} .hub-sync-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
        #${UID} .hub-sync-dot.loading{background:#ffd479;animation:hubPulse 1s infinite}
        #${UID} .hub-sync-dot.synced{background:#4ade80}
        #${UID} .hub-sync-dot.error{background:#f04a4a}

        #${UID} .hub-actions{display:flex;gap:3px;flex-shrink:0}
        #${UID} .hub-hbtn{width:20px;height:20px;border-radius:4px;background:rgba(0,0,0,.25);border:1px solid rgba(255,176,32,.25);
        color:#ffd479;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:10px;transition:all .12s;flex-shrink:0}
        #${UID} .hub-hbtn:hover{background:rgba(255,176,32,.2);border-color:#ffb020}
        #${UID} .hub-hbtn.spin svg{animation:hubSpin .6s linear infinite}

        #${UID} .hub-body{padding:8px;overflow-y:auto;flex:1;min-height:0}
        #${UID} .hub-body::-webkit-scrollbar{width:4px}
        #${UID} .hub-body::-webkit-scrollbar-thumb{background:rgba(255,176,32,.25);border-radius:2px}

        #${UID} .hub-empty,#${UID} .hub-error-box{padding:12px 8px;text-align:center;color:#c9a06a;font-size:10px}
        #${UID} .hub-error-box{color:#f4a3a3}
        #${UID} .hub-retry{display:inline-block;padding:4px 10px;margin-top:6px;border-radius:4px;
        background:rgba(240,74,74,.12);border:1px solid rgba(240,74,74,.35);color:#f4a3a3;cursor:pointer;font-size:9px;font-weight:700}

        #${UID} .hub-item{display:flex;align-items:center;gap:7px;padding:6px 8px;margin-bottom:4px;
        border-radius:6px;background:rgba(255,176,32,.04);border:1px solid rgba(255,176,32,.12);cursor:pointer;transition:all .12s;position:relative}
        #${UID} .hub-item::before{content:'';position:absolute;left:0;top:4px;bottom:4px;width:2px;border-radius:2px;background:#6b5233}
        #${UID} .hub-item.state-loaded::before{background:#4ade80}
        #${UID} .hub-item.state-loading::before{background:#ffd479;animation:hubPulse 1s infinite}
        #${UID} .hub-item.state-error::before{background:#f04a4a}
        #${UID} .hub-item:hover{background:rgba(255,176,32,.1);border-color:rgba(255,176,32,.3)}
        #${UID} .hub-item:active{transform:scale(.98)}
        #${UID} .hub-item:last-child{margin-bottom:0}

        #${UID} .hub-icon{font-size:14px;width:18px;text-align:center;flex-shrink:0}
        #${UID} .hub-info{flex:1;min-width:0}
        #${UID} .hub-name{font-weight:700;color:#f3e3c4;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        #${UID} .hub-desc{font-size:8px;color:#b78e5c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        #${UID} .hub-chip{flex-shrink:0;font-size:7px;font-weight:700;padding:1px 5px;border-radius:10px;text-transform:uppercase}
        #${UID} .hub-chip.unloaded{background:rgba(255,255,255,.05);color:#8a7150}
        #${UID} .hub-chip.loading{background:rgba(255,212,121,.12);color:#ffd479}
        #${UID} .hub-chip.loaded{background:rgba(74,222,128,.12);color:#4ade80}
        #${UID} .hub-chip.error{background:rgba(240,74,74,.12);color:#f4a3a3}

        #${UID} .hub-ftr{padding:4px 10px;background:rgba(0,0,0,.2);border-top:1px solid rgba(255,176,32,.12);
        font-size:7.5px;color:#8a7150;display:flex;justify-content:space-between;flex-shrink:0}
        #${UID} .hub-ftr b{color:#c9a06a}

        #${UID} .hub-toast{position:absolute;left:8px;right:8px;bottom:28px;padding:5px 8px;border-radius:5px;
        font-size:9px;font-weight:700;text-align:center;opacity:0;transform:translateY(3px);transition:all .18s;
        pointer-events:none;z-index:20;border:1px solid;background:#1a0d04;color:#f3e3c4;border-color:#ffb020}
        #${UID} .hub-toast.show{opacity:1;transform:translateY(0)}
        #${UID} .hub-toast.ok{border-color:#4ade80;color:#c9f7d9}
        #${UID} .hub-toast.error{border-color:#f04a4a;color:#f9c9c9}
        #${UID} .hub-toast.warn{border-color:#ffd479;color:#ffe9c2}

        #${UID}pill{position:fixed;top:16px;left:16px;display:flex;align-items:center;gap:5px;
        padding:6px 10px 6px 8px;border-radius:999px;background:linear-gradient(165deg,#4d2d10,#2b1608);
        border:1px solid #6b3f14;box-shadow:0 0 0 1px rgba(255,176,32,.15),0 8px 20px rgba(0,0,0,.5);
        color:#ffd479;font-family:monospace;font-size:10px;font-weight:700;cursor:grab;z-index:2147483647;user-select:none;animation:hubFade .2s ease-out}
        #${UID}pill:active{cursor:grabbing}
        #${UID}pill:hover{border-color:#ffb020}
        #${UID}pill.hidden{display:none}
        `;
        document.head.appendChild(style);

        const KEY_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffb020" stroke-width="2"><circle cx="8" cy="8" r="4.5"/><path d="M11.5 11.5L20 20M20 20L17.5 22.5M20 20L22.5 17.5" stroke-linecap="round"/></svg>`;
        const REFRESH_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>`;
        const UPDATE_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

        const root = document.createElement('div');
        root.id = UID;
        root.setAttribute('data-hub', '1');
        root.innerHTML = `
        <div class="hub-hdr" id="${UID}hdr">
            <div class="hub-brand">
                <span class="hub-key">${KEY_SVG}</span>
                <div>
                    <div class="hub-title">Sang Hub</div>
                    <div class="hub-subtitle"><span class="hub-sync-dot loading" id="${UID}syncdot"></span><span id="${UID}syncsubtitle">iniciando…</span></div>
                </div>
            </div>
            <div class="hub-actions">
                <div class="hub-hbtn" id="${UID}update" title="Auto-update (${UPDATE_INTERVAL_MS/60000}min)">${UPDATE_SVG}</div>
                <div class="hub-hbtn" id="${UID}refresh" title="Recarregar manifesto">${REFRESH_SVG}</div>
                <div class="hub-hbtn" id="${UID}min" title="Minimizar">−</div>
                <div class="hub-hbtn" id="${UID}cls" title="Fechar (${SHORTCUT_LABEL})">✕</div>
            </div>
        </div>
        <div class="hub-body" id="${UID}list"></div>
        <div class="hub-ftr">
            <span>v${HUB_VERSION}</span>
            <span id="${UID}ftrmid">·</span>
            <span>${SHORTCUT_LABEL}</span>
        </div>
        <div class="hub-toast" id="${UID}toast"></div>
        `;
        document.body.appendChild(root);
        uiRoot = root;

        const pill = document.createElement('div');
        pill.id = UID + 'pill';
        pill.className = 'hidden';
        pill.innerHTML = KEY_SVG + '<span>HUB</span>';
        document.body.appendChild(pill);
        uiPill = pill;

        function showPanel() { root.classList.remove('hidden'); pill.classList.add('hidden'); }
        function showPill() { root.classList.add('hidden'); pill.classList.remove('hidden'); }
        function hideAll() { root.classList.add('hidden'); pill.classList.add('hidden'); }

        let drag = null;
        const hdr = root.querySelector('#' + UID + 'hdr');
        hdr.addEventListener('mousedown', e => {
            if (e.target.closest('.hub-hbtn')) return;
            const r = root.getBoundingClientRect();
            drag = { x: e.clientX - r.left, y: e.clientY - r.top };
            root.style.left = r.left + 'px';
            root.style.top = r.top + 'px';
        });
        document.addEventListener('mousemove', e => {
            if (!drag) return;
            const x = Math.max(0, e.clientX - drag.x);
            const y = Math.max(0, e.clientY - drag.y);
            root.style.left = x + 'px';
            root.style.top = y + 'px';
        });
        document.addEventListener('mouseup', () => { drag = null; });

        let pillDrag = null;
        let pillDidDrag = false;
        pill.addEventListener('mousedown', e => {
            const r = pill.getBoundingClientRect();
            pillDrag = { x: e.clientX - r.left, y: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
            pillDidDrag = false;
            pill.style.left = r.left + 'px';
            pill.style.top = r.top + 'px';
        });
        document.addEventListener('mousemove', e => {
            if (!pillDrag) return;
            if (Math.abs(e.clientX - pillDrag.sx) > 3 || Math.abs(e.clientY - pillDrag.sy) > 3) pillDidDrag = true;
            pill.style.left = Math.max(0, e.clientX - pillDrag.x) + 'px';
            pill.style.top = Math.max(0, e.clientY - pillDrag.y) + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (pillDrag && !pillDidDrag) showPanel();
            pillDrag = null;
        });

        let toastTm = null;
        toastFn = (msg, kind) => {
            const el = root.querySelector('#' + UID + 'toast');
            el.textContent = msg;
            el.className = 'hub-toast show ' + (kind || 'info');
            clearTimeout(toastTm);
            toastTm = setTimeout(() => el.classList.remove('show'), 2000);
        };

        root.querySelector('#' + UID + 'min').addEventListener('click', showPill);
        root.querySelector('#' + UID + 'cls').addEventListener('click', hideAll);
        root.querySelector('#' + UID + 'refresh').addEventListener('click', () => refreshManifest(true));
        root.querySelector('#' + UID + 'update').addEventListener('click', () => {
            toastFn('Verificando…', 'info');
            autoUpdateLoop();
        });

        document.addEventListener('keydown', e => {
            if (e.altKey && e.shiftKey && e.key.toLowerCase() === SHORTCUT_KEY) {
                e.preventDefault();
                root.classList.contains('hidden') ? showPanel() : showPill();
            }
        });

        const listEl = root.querySelector('#' + UID + 'list');
        const syncDot = root.querySelector('#' + UID + 'syncdot');
        const syncSubtitle = root.querySelector('#' + UID + 'syncsubtitle');
        const ftrMid = root.querySelector('#' + UID + 'ftrmid');

        renderListFn = () => {
            listEl.innerHTML = '';
            if (state.syncState === 'error' && !state.manifest.modules.length) {
                listEl.innerHTML = `<div class="hub-error-box">Erro ao carregar manifesto.<div class="hub-retry" id="${UID}retry">Tentar novamente</div></div>`;
                listEl.querySelector('#' + UID + 'retry').addEventListener('click', () => refreshManifest(true));
                return;
            }

            const visible = state.manifest.modules.filter(m => m.enabled !== false && m.secret !== true);
            if (!visible.length) {
                listEl.innerHTML = '<div class="hub-empty">Nenhum módulo disponível.</div>';
                return;
            }

            visible.forEach(mod => {
                const status = state.moduleStates[mod.id] || 'unloaded';
                const item = document.createElement('div');
                item.className = 'hub-item state-' + status;
                item.innerHTML = `
                    <span class="hub-icon">${mod.icon || '📦'}</span>
                    <div class="hub-info">
                        <div class="hub-name">${mod.name}</div>
                        <div class="hub-desc">${mod.description || ''}</div>
                    </div>
                    <span class="hub-chip ${status}">${status === 'unloaded' ? '⏸' : status === 'loading' ? '⟳' : status === 'loaded' ? '✓' : '✗'}</span>
                `;
                item.addEventListener('click', () => handleModuleClick(mod));
                listEl.appendChild(item);
            });
        };

        renderChromeFn = () => {
            syncDot.className = 'hub-sync-dot ' + state.syncState;
            syncSubtitle.textContent = state.syncState === 'loading' ? 'sincronizando…' :
                                       state.syncState === 'synced' ? 'sync ' + (state.lastSyncAt || '') : 'falha';
            ftrMid.textContent = state.manifest.version ? 'v' + state.manifest.version : '·';
        };

        renderListFn();
        renderChromeFn();

        function kill() {
            state.killFlag = true;
            if (state.updateTimer) clearTimeout(state.updateTimer);
            if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
            document.querySelectorAll('#' + UID + ', #' + UID + 'pill, style[data-hub]').forEach(el => el.remove());
        }
        window._hubUI = { kill };
    }

    async function boot() {
        await new Promise(resolve => {
            if (document.body) return resolve();
            const iv = setInterval(() => { if (document.body) { clearInterval(iv); resolve(); } }, 80);
        });

        buildUI();
        await refreshManifest(false);

        if (!state.killFlag) {
            state.updateTimer = setTimeout(autoUpdateLoop, UPDATE_INTERVAL_MS);
            HLOG('🔄 Auto-update: ' + (UPDATE_INTERVAL_MS / 60000) + 'min');
        }

        state.heartbeatTimer = setInterval(() => {
            if (state.killFlag) return;
            if (!state.updateTimer) {
                HLOG('🔄 Reiniciando auto-update');
                state.updateTimer = setTimeout(autoUpdateLoop, UPDATE_INTERVAL_MS);
            }
        }, 60000);
    }

    boot().catch(e => HERR('❌ Erro fatal:', e));
})();
