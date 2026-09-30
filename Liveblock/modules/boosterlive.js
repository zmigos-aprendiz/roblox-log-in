// ==UserScript==
// @name         LiveBooster [by SANG]
// @namespace    livebooster-sang
// @version      5.1.0
// @description  Otimizador de performance
// @match        *://*.habblive.in/*
// @match        *://habblive.in/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '5.1.0';
  const INSTANCE_KEY = '_liveBooster';
  const STORAGE_KEY = 'livebooster-settings';
  const LITE_OPT_OUT_ATTR = 'data-sang-ui'; // [FIX 4] convenção entre módulos

  // [R16] Estado encapsulado — mutação centralizada e verificável.
  const state = {
    alive: true,
    dying: false
  };

  // [R14][R5] Helpers de log com prefixo padronizado.
  const log = (...a) => console.log(`[LiveBooster ${VERSION}]`, ...a);
  const warn = (...a) => console.warn(`[LiveBooster ${VERSION}]`, ...a);

  // Encerra instância anterior (mesmo se órfã).
  if (window[INSTANCE_KEY]?.kill) {
    try { window[INSTANCE_KEY].kill(); } catch (e) { warn('kill da instância anterior falhou:', e); }
  }

  const DEFAULTS = {
    liteMode: false,
    autoLite: true,
    panelVisible: true,
    panelMini: false,
    panelPos: null,
    upscaleEnabled: false,
    upscaleFactor: 0.5,
    accentColor: '#00f0ff',
    gpuBoost: true,
    force120Fps: true
  };

  const TYPE_VALIDATORS = {
    liteMode: v => typeof v === 'boolean',
    autoLite: v => typeof v === 'boolean',
    panelVisible: v => typeof v === 'boolean',
    panelMini: v => typeof v === 'boolean',
    panelPos: v => v === null || (typeof v === 'object' && Number.isFinite(v.left) && Number.isFinite(v.top)),
    upscaleEnabled: v => typeof v === 'boolean',
    upscaleFactor: v => typeof v === 'number' && v > 0 && v <= 1,
    accentColor: v => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v),
    gpuBoost: v => typeof v === 'boolean',
    force120Fps: v => typeof v === 'boolean'
  };

  function loadSettings() {
    const merged = { ...DEFAULTS };
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { stored = {}; }
    for (const key of Object.keys(DEFAULTS)) {
      if (key in stored && TYPE_VALIDATORS[key](stored[key])) merged[key] = stored[key];
    }
    return merged;
  }

  const settings = loadSettings();

  function saveSettings() {
    if (state.dying) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
    catch (e) { /* quota cheia — silencioso */ }
  }

  // ============================================================
  // [R6] Helper compartilhado — evitar acoplamento GpuBoost↔Upscale
  // ============================================================
  function isGameCanvas(canvas) {
    if (!canvas || canvas.width < 100 || canvas.height < 100) return false;
    const selectors = [
      '#client-box', '#game', '#room',
      '[class*="client"]', '[class*="game"]', '[id*="client"]'
    ];
    for (const sel of selectors) {
      try { if (canvas.closest(sel)) return true; } catch (e) {}
    }
    return false;
  }

  // ============================================================
  // [FIX 5] SharedObserver — um único MutationObserver compartilhado
  // com debounce de 100ms. Substitui 3 observers independentes.
  // ============================================================
  const SharedObserver = {
    observer: null,
    pending: false,
    callbacks: new Map(), // [R4] Map<name, fn> — dedupe por nome

    register(name, fn) {
      // [R4] Registro idempotente — se já existe, substitui sem duplicar
      this.callbacks.set(name, fn);
      this.ensure();
    },

    unregister(name) {
      this.callbacks.delete(name);
    },

    ensure() {
      if (this.observer || !document.body) return;
      this.observer = new MutationObserver(() => {
        if (this.pending || state.dying) return;
        this.pending = true;
        setTimeout(() => {
          this.pending = false;
          if (state.dying) return;
          // Snapshot antes de iterar — [R16] callbacks não mutam o Map durante execução
          for (const [name, fn] of Array.from(this.callbacks)) {
            try { fn(); } catch (e) { warn(`observer callback "${name}" falhou:`, e); }
          }
        }, 100);
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    },

    destroy() {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      this.callbacks.clear();
      this.pending = false;
    }
  };

  // ============================================================
  // [FIX 6] LongTaskMonitor — detecta a CAUSA do lag, não só o sintoma
  // ============================================================
  const LongTaskMonitor = {
    observer: null,
    recent: [],

    start(onSevere) {
      if (!('PerformanceObserver' in window)) return;
      // [R12] callback passado por parâmetro — sem propriedade global mutável
      try {
        this.observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const info = {
              start: entry.startTime,
              duration: entry.duration,
              source: entry.attribution?.[0]?.name || 'desconhecido'
            };
            this.recent.push(info);
            if (this.recent.length > 20) this.recent.shift();

            if (entry.duration > 150) {
              warn('long task:', Math.round(entry.duration) + 'ms', '@', info.source);
            }
            if (onSevere && entry.duration > 400) {
              try { onSevere(info); } catch (e) {}
            }
          }
        });
        this.observer.observe({ entryTypes: ['longtask'] });
      } catch (e) { /* navegador sem suporte — degrada silencioso */ }
    },

    stop() {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      this.recent = [];
    },

    getRecent() { return [...this.recent]; }
  };

  // ============================================================
  // [FIX 2][R3] GpuBoost — âncora persistente + marcador anti-encadeamento
  // ============================================================
  const GpuBoost = {
    patchedGetContext: null,
    boostedCanvases: new WeakSet(),

    apply() {
      const proto = HTMLCanvasElement.prototype;

      // [FIX 2] Âncora persistente — sobrevive à perda de closure
      if (!proto.__lbOriginalGetContext) {
        Object.defineProperty(proto, '__lbOriginalGetContext', {
          value: proto.getContext,
          writable: true,
          configurable: true,
          enumerable: false
        });
      }

      // [R3] Se já existe um patch nosso órfão no prototype, restaura antes
      // de patchar de novo — evita empilhar wrappers.
      if (proto.getContext?.__lbPatched) {
        proto.getContext = proto.__lbOriginalGetContext;
      }

      const original = proto.__lbOriginalGetContext;

      const patched = function (type, opts) {
        let newOpts = opts;
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
          // [G9] Só força high-performance se caller não especificou
          if (!opts || !opts.powerPreference) {
            newOpts = Object.assign({}, opts || {}, { powerPreference: 'high-performance' });
          }
        }
        return original.call(this, type, newOpts);
      };
      patched.__lbPatched = true; // [R3] marcador

      proto.getContext = patched;
      this.patchedGetContext = patched;

      SharedObserver.register('gpuBoost', () => this.boostMainCanvas());
      this.boostMainCanvas();
    },

    boostMainCanvas() {
      if (state.dying) return;
      // [R6] usa helper compartilhado
      const canvases = Array.from(document.querySelectorAll('canvas')).filter(isGameCanvas);
      if (!canvases.length) return;

      const main = canvases.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
      if (this.boostedCanvases.has(main)) return;

      for (const c of canvases) {
        if (c !== main && this.boostedCanvases.has(c)) this.unboostCanvas(c);
      }

      main.style.transform = 'translateZ(0)';
      main.style.willChange = 'transform';
      main.style.backfaceVisibility = 'hidden';

      // [G8] Handler para webglcontextlost — evita tela branca
      if (!main.__lbContextLossHandler) {
        main.__lbContextLossHandler = (e) => {
          e.preventDefault();
          warn('WebGL context lost, aguardando restore...');
        };
        main.addEventListener('webglcontextlost', main.__lbContextLossHandler);
      }

      this.boostedCanvases.add(main);
    },

    unboostCanvas(canvas) {
      canvas.style.removeProperty('transform');
      canvas.style.removeProperty('will-change');
      canvas.style.removeProperty('backface-visibility');
      if (canvas.__lbContextLossHandler) {
        try { canvas.removeEventListener('webglcontextlost', canvas.__lbContextLossHandler); }
        catch (e) {}
        delete canvas.__lbContextLossHandler;
      }
      this.boostedCanvases.delete(canvas);
    },

    remove() {
      const proto = HTMLCanvasElement.prototype;
      // [FIX 2][R3] Só restaura se o patch atual é o NOSSO (marcador)
      if (proto.__lbOriginalGetContext &&
          proto.getContext?.__lbPatched) {
        proto.getContext = proto.__lbOriginalGetContext;
      }
      this.patchedGetContext = null;

      // [R13] Loga em vez de engolir
      try {
        document.querySelectorAll('canvas').forEach(c => {
          if (this.boostedCanvases.has(c)) this.unboostCanvas(c);
        });
      } catch (e) { warn('erro ao desfazer boost de canvas:', e); }

      SharedObserver.unregister('gpuBoost');
    }
  };

  // ============================================================
  // FPSManager — alvo único: cap do jogo. Nunca toca em módulos.
  // ============================================================
  const FPSManager = {
    timeoutId: null,
    forced: false,
    attempt: 0,
    delays: [1000, 2000, 3000, 5000, 8000, 13000, 20000],

    start() {
      if (this.timeoutId || this.forced) return;
      this.attempt = 0;
      this.scheduleNext();
    },

    stop() {
      if (this.timeoutId) { clearTimeout(this.timeoutId); this.timeoutId = null; }
      this.forced = false;
    },

    scheduleNext() {
      if (state.dying) return;
      if (this.attempt >= this.delays.length) {
        warn('Não foi possível localizar um controle de FPS.');
        return;
      }
      const delay = this.delays[this.attempt++];
      this.timeoutId = setTimeout(() => this.tryForce(), delay);
    },

    tryForce() {
      if (this.forced || state.dying) return;
      if (this.tryElements() || this.tryLocalStorage() || this.tryGlobalObjects()) {
        this.markForced();
        return;
      }
      this.scheduleNext();
    },

    // [G17] Escopo limitado — containers de settings antes do body inteiro
    tryElements() {
      const scopes = [
        document.querySelector('#client-box'),
        document.querySelector('[class*="settings"]'),
        document.querySelector('[class*="config"]'),
        document.querySelector('[class*="options"]'),
        document.body
      ].filter(Boolean);

      const seen = new Set();
      for (const scope of scopes) {
        const candidates = scope.querySelectorAll('select, input[type="range"], input[type="number"]');
        for (const el of candidates) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (this.trySetElement(el)) return true;
        }
      }
      return false;
    },

    trySetElement(el) {
      try {
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || '').trim();
        const looksLikeFps = /\bfps\b|frame\s*rate/i.test(text) ||
                              /\bfps\b|frame\s*rate/i.test(el.id || '') ||
                              /\bfps\b|frame\s*rate/i.test(el.className || '');
        if (!looksLikeFps) return false;

        if (tag === 'select') {
          const options = Array.from(el.options);
          const target = options.find(opt => /\b120\b/.test(opt.textContent) || opt.value === '120');
          if (target && el.value !== target.value) {
            el.value = target.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return !!target;
        }

        if (tag === 'input' && (el.type === 'range' || el.type === 'number')) {
          const max = parseFloat(el.max);
          const val = parseFloat(el.value);
          if (!isNaN(max) && max >= 120 && val < 120) {
            el.value = '120';
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
        }
      } catch (e) {}
      return false;
    },

    // [G11][R10] Só chaves conhecidas + preserva tipo original
    tryLocalStorage() {
      const KNOWN_KEYS = [
        'settings', 'config', 'gameSettings',
        'habblive_settings', 'client_config', 'options'
      ];
      const PROP_RE = /^(fps|frameRate|frameCap|frameLimit|maxFps|targetFps)$/i;

      for (const key of KNOWN_KEYS) {
        let raw;
        try { raw = localStorage.getItem(key); } catch (e) { continue; }
        if (!raw) continue;
        try {
          const obj = JSON.parse(raw);
          if (!obj || typeof obj !== 'object') continue;
          let changed = false;
          for (const prop of Object.keys(obj)) {
            if (PROP_RE.test(prop) && this.isPlausibleFpsValue(obj[prop])) {
              // [R10] Preserva o tipo original (string vs number)
              obj[prop] = typeof obj[prop] === 'string' ? '120' : 120;
              changed = true;
            }
          }
          if (changed) {
            localStorage.setItem(key, JSON.stringify(obj));
            return true;
          }
        } catch (e) {}
      }
      return false;
    },

    isPlausibleFpsValue(v) {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 300;
    },

    // [G12] Só window.game e window.gameConfig — nomes inequívocos
    tryGlobalObjects() {
      const roots = [window.game, window.gameConfig].filter(Boolean);
      const props = ['fps', 'frameRate', 'maxFps', 'targetFps', 'fpsCap', 'frameLimit'];
      for (const obj of roots) {
        if (!obj || typeof obj !== 'object') continue;
        for (const prop of props) {
          try {
            if (prop in obj && this.isPlausibleFpsValue(obj[prop])) {
              const current = Number(obj[prop]);
              if (current >= 30 && current <= 90) {
                obj[prop] = 120;
                return true;
              }
            }
          } catch (e) {}
        }
      }
      return false;
    },

    markForced() {
      this.forced = true;
      if (this.timeoutId) { clearTimeout(this.timeoutId); this.timeoutId = null; }
      log('Configuração de FPS aplicada.');
    }
  };

  // ============================================================
  // Upscale — restrito ao canvas do jogo, com wrap idempotente
  // ============================================================
  const Upscale = {
    originalData: new WeakMap(),
    remapRegistry: new WeakMap(),

    createRemappedEvent(e, scaleX, scaleY) {
      const COORD_PROPS_X = ['clientX', 'pageX', 'screenX', 'offsetX'];
      const COORD_PROPS_Y = ['clientY', 'pageY', 'screenY', 'offsetY'];
      return new Proxy(e, {
        get(target, prop) {
          if (COORD_PROPS_X.includes(prop) && typeof target[prop] === 'number') return target[prop] * scaleX;
          if (COORD_PROPS_Y.includes(prop) && typeof target[prop] === 'number') return target[prop] * scaleY;
          if (prop === 'deltaY' && typeof target.deltaY === 'number') return target.deltaY * scaleY;
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    },

    applyToCanvas(canvas) {
      // [G10][R6] Só canvas do jogo, via helper compartilhado
      if (!canvas || this.originalData.has(canvas)) return;
      if (!isGameCanvas(canvas)) return;

      // [R17] Desativa imageSmoothing para pixel art nítida
      try {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.imageSmoothingEnabled = false;
      } catch (e) {}

      const origWidth = canvas.width, origHeight = canvas.height;
      const nw = Math.max(1, Math.floor(origWidth * settings.upscaleFactor));
      const nh = Math.max(1, Math.floor(origHeight * settings.upscaleFactor));

      this.originalData.set(canvas, {
        w: origWidth, h: origHeight,
        sw: canvas.style.width || '',
        sh: canvas.style.height || ''
      });

      const scaleX = origWidth / nw;
      const scaleY = origHeight / nh;
      const origAEL = canvas.addEventListener.bind(canvas);
      const origREL = canvas.removeEventListener.bind(canvas);
      const remapped = new Map();
      const REMAP_TYPES = new Set([
        'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'wheel',
        'pointerdown', 'pointerup', 'pointermove'
      ]);

      canvas.addEventListener = function (type, listener, options) {
        // [G13] Idempotência — não envolve o mesmo listener duas vezes
        if (listener && listener.__lbWrapped) {
          return origAEL(type, listener, options);
        }
        if (REMAP_TYPES.has(type) && typeof listener === 'function') {
          const wrapped = (e) => listener.call(canvas, Upscale.createRemappedEvent(e, scaleX, scaleY));
          wrapped.__lbWrapped = true;
          wrapped.__lbOriginal = listener;
          remapped.set(listener, wrapped);
          origAEL(type, wrapped, options);
        } else {
          origAEL(type, listener, options);
        }
      };

      canvas.removeEventListener = function (type, listener, options) {
        const target = remapped.get(listener) ||
                       (listener && listener.__lbWrapped ? listener : null);
        if (target) {
          origREL(type, target, options);
          remapped.delete(listener);
        } else {
          origREL(type, listener, options);
        }
      };

      this.remapRegistry.set(canvas, { addEventListener: origAEL, removeEventListener: origREL });

      canvas.width = nw;
      canvas.height = nh;
      canvas.style.width = origWidth + 'px';
      canvas.style.height = origHeight + 'px';
      canvas.style.imageRendering = 'pixelated';
    },

    removeFromCanvas(canvas) {
      const data = this.originalData.get(canvas);
      if (!data) return;

      const remap = this.remapRegistry.get(canvas);
      if (remap) {
        canvas.addEventListener = remap.addEventListener;
        canvas.removeEventListener = remap.removeEventListener;
        this.remapRegistry.delete(canvas);
      }

      canvas.width = data.w;
      canvas.height = data.h;
      if (data.sw) canvas.style.width = data.sw; else canvas.style.removeProperty('width');
      if (data.sh) canvas.style.height = data.sh; else canvas.style.removeProperty('height');
      canvas.style.removeProperty('image-rendering');
      this.originalData.delete(canvas);
    },

    scanAll() {
      try { document.querySelectorAll('canvas').forEach(c => this.applyToCanvas(c)); }
      catch (e) { warn('scanAll falhou:', e); }
    },

    removeAll() {
      try {
        document.querySelectorAll('canvas').forEach(c => {
          if (this.originalData.has(c)) this.removeFromCanvas(c);
        });
      } catch (e) { warn('removeAll falhou:', e); }
    },

    setEnabled(on) {
      settings.upscaleEnabled = on;
      if (on) {
        this.scanAll();
        SharedObserver.register('upscale', () => this.scanAll());
      } else {
        this.removeAll();
        SharedObserver.unregister('upscale');
      }
      saveSettings();
    },

    changeFactor(factor) {
      settings.upscaleFactor = factor;
      if (settings.upscaleEnabled) { this.removeAll(); this.scanAll(); }
      saveSettings();
    }
  };

  // ============================================================
  // [FIX 4] LiteMode — opt-out via [data-sang-ui]
  // ============================================================
  const LiteMode = {
    styleEl: null,

    buildExcludeSelector() {
      const selectors = [
        '#_hub', '#_hub *',
        '#_hubpill', '#_hubpill *',
        '#lb-panel', '#lb-panel *',
        `[${LITE_OPT_OUT_ATTR}]`, `[${LITE_OPT_OUT_ATTR}] *`
      ];
      return selectors.map(s => ':not(' + s + ')').join('');
    },

    ensureStyle() {
      if (this.styleEl) return this.styleEl;
      const el = document.createElement('style');
      el.id = 'lb-lite-style';
      const excl = this.buildExcludeSelector();
      el.textContent = `
        *${excl} {
          animation: none !important;
          transition: none !important;
          box-shadow: none !important;
          filter: none !important;
          backdrop-filter: none !important;
          text-shadow: none !important;
          background-attachment: initial !important;
        }
        img, canvas, video { image-rendering: optimizeSpeed !important; }
        *${excl} { will-change: auto !important; }
      `;
      this.styleEl = el;
      return el;
    },

    set(on) {
      settings.liteMode = on;
      if (on) {
        if (!document.getElementById('lb-lite-style')) {
          try { document.head.appendChild(this.ensureStyle()); } catch (e) {}
        }
      } else {
        const el = document.getElementById('lb-lite-style');
        if (el) el.remove();
      }
      saveSettings();
      try { UI.syncFromSettings(); } catch (e) {}
    }
  };

  // ============================================================
  // [FIX 7] Auto-Lite com histerese assimétrica
  // ============================================================
  /**
   * Ativa liteMode após N leituras consecutivas abaixo de LOW_THRESHOLD
   * (~1.5s a 2Hz), desativa após M leituras acima de HIGH_THRESHOLD
   * (~3s). Assimetria evita oscilação: threshold de saída mais alto
   * e tempo de saída maior que os de entrada.
   * Nunca desativa se o usuário ligou manualmente (autoActivated=false).
   */
  const AutoLite = {
    lowStreak: 0,
    highStreak: 0,
    autoActivated: false,
    LOW_THRESHOLD: 25,
    HIGH_THRESHOLD: 45,
    LOW_SAMPLES: 3,
    HIGH_SAMPLES: 6,

    onFpsSample(fps) {
      if (!settings.autoLite) { this.resetStreaks(); return; }

      if (settings.liteMode) {
        // [R7] Só conta para desativar se foi AutoLite que ativou
        if (!this.autoActivated) return;
        if (fps > this.HIGH_THRESHOLD) {
          this.highStreak++;
          if (this.highStreak >= this.HIGH_SAMPLES) {
            LiteMode.set(false);
            this.autoActivated = false;
            this.highStreak = 0;
          }
        } else {
          this.highStreak = 0;
        }
      } else {
        if (fps < this.LOW_THRESHOLD) {
          this.lowStreak++;
          if (this.lowStreak >= this.LOW_SAMPLES) {
            LiteMode.set(true);
            this.autoActivated = true;
            this.lowStreak = 0;
          }
        } else {
          this.lowStreak = 0;
        }
      }
    },

    onLongTask(info) {
      if (!settings.autoLite || settings.liteMode) return;
      if (info.duration > 400) {
        LiteMode.set(true);
        this.autoActivated = true;
        // [R8] Reseta streaks após ativar por long task
        this.resetStreaks();
      }
    },

    resetStreaks() {
      this.lowStreak = 0;
      this.highStreak = 0;
    },

    onManualToggle() {
      this.resetStreaks();
      this.autoActivated = false;
    }
  };

  // ============================================================
  // Loop de FPS
  // ============================================================
  let rafId = null;
  let lastTime = performance.now(), frames = 0, lastFpsUpdate = lastTime;
  let currentFps = 60, lastFrameTime = 16.67;

  function fpsLoop(now) {
    if (!state.alive || state.dying) return;
    frames++;
    lastFrameTime = now - lastTime;
    lastTime = now;

    if (now - lastFpsUpdate >= 500) {
      currentFps = Math.round((frames * 1000) / (now - lastFpsUpdate));
      frames = 0;
      lastFpsUpdate = now;
      try { UI.updateFps(currentFps, lastFrameTime); } catch (e) {}
      try { AutoLite.onFpsSample(currentFps); } catch (e) {}
    }
    rafId = requestAnimationFrame(fpsLoop);
  }

  // ============================================================
  // UI — template e CSS completos, refs e eventos implementados
  // [R1][R2] Corrigido nesta passada
  // ============================================================
  const UI = {
    host: null,
    shadow: null,
    refs: {},

    build() {
      if (this.host || state.dying) return;

      this.host = document.createElement('div');
      this.host.id = 'lb-panel';
      this.host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;';
      document.body.appendChild(this.host);

      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = this.template();
      this.cacheRefs();
      this.bindEvents();
      this.applyAccent(settings.accentColor);
      this.restorePosition();
      this.syncFromSettings();
      this.setVisible(settings.panelVisible);
      this.host.classList.toggle('lb-mini-mode', settings.panelMini);
    },

    template() {
      return `
        <style>${this.css()}</style>
        <div class="lb-card" part="card">
          <header class="lb-header" data-drag-handle>
            <span class="lb-logo">⚡</span>
            <div class="lb-title">
              <span class="lb-name">LiveBooster</span>
              <span class="lb-by">by SANG</span>
            </div>
            <button class="lb-collapse" data-action="collapse" title="Minimizar">–</button>
          </header>

          <div class="lb-body">
            <div class="lb-metrics">
              <div class="lb-ring-wrap">
                <svg class="lb-ring" viewBox="0 0 100 100">
                  <circle class="lb-ring-track" cx="50" cy="50" r="42"></circle>
                  <circle class="lb-ring-fill" cx="50" cy="50" r="42"></circle>
                </svg>
                <div class="lb-ring-label">
                  <span class="lb-fps-value" data-ref="fpsValue">--</span>
                  <span class="lb-fps-unit">FPS</span>
                </div>
              </div>
              <div class="lb-frametime" data-ref="frameTime">-- ms</div>
            </div>

            <nav class="lb-tabs">
              <button class="lb-tab active" data-tab="perf">Performance</button>
              <button class="lb-tab" data-tab="visual">Visual</button>
              <button class="lb-tab" data-tab="tema">Tema</button>
            </nav>

            <section class="lb-panel-tab active" data-panel="perf">
              ${this.rowToggle('force120Fps', 'Forçar 120 FPS', 'Tenta destravar o cap interno do jogo')}
              ${this.rowToggle('gpuBoost', 'GPU Boost', 'Prioriza GPU dedicada no canvas principal')}
              ${this.rowToggle('liteMode', 'Modo leve', 'Desativa efeitos visuais pesados')}
              ${this.rowToggle('autoLite', 'Auto modo leve', 'Ativa sozinho se o FPS cair abaixo de 25')}
            </section>

            <section class="lb-panel-tab" data-panel="visual">
              <div class="lb-row">
                <div class="lb-row-label">
                  <span class="lb-label-main">Upscaling</span>
                  <span class="lb-label-sub">Renderiza em resolução menor</span>
                </div>
                <div class="lb-row-controls">
                  <select class="lb-select" data-ref="upscaleFactor">
                    <option value="0.25">25%</option>
                    <option value="0.33">33%</option>
                    <option value="0.5">50%</option>
                    <option value="0.66">66%</option>
                    <option value="0.75">75%</option>
                  </select>
                  <label class="lb-switch">
                    <input type="checkbox" data-setting="upscaleEnabled">
                    <span class="lb-switch-track"></span>
                  </label>
                </div>
              </div>
            </section>

            <section class="lb-panel-tab" data-panel="tema">
              <div class="lb-row lb-row-column">
                <span class="lb-label-main">Cor de destaque</span>
                <div class="lb-swatches" data-ref="swatches">
                  ${['#00f0ff', '#a78bfa', '#34d399', '#fb7185', '#fbbf24'].map(c =>
                    `<button class="lb-swatch" style="--sw:${c}" data-color="${c}"></button>`
                  ).join('')}
                  <input type="color" class="lb-color-input" data-ref="colorInput" value="${settings.accentColor}">
                </div>
              </div>
            </section>
          </div>

          <footer class="lb-footer">
            <span>Alt+Shift+O para mostrar/ocultar</span>
          </footer>
        </div>

        <div class="lb-mini" data-ref="mini" title="Clique duas vezes para expandir">
          <span class="lb-mini-fps" data-ref="miniFps">--</span>
          <span class="lb-mini-unit">FPS</span>
        </div>
      `;
    },

    rowToggle(settingKey, label, sub) {
      return `
        <div class="lb-row">
          <div class="lb-row-label">
            <span class="lb-label-main">${label}</span>
            <span class="lb-label-sub">${sub}</span>
          </div>
          <label class="lb-switch">
            <input type="checkbox" data-setting="${settingKey}">
            <span class="lb-switch-track"></span>
          </label>
        </div>
      `;
    },

    css() {
      return `
        :host { all: initial; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
        * { box-sizing: border-box; }

        .lb-card {
          width: 272px;
          border-radius: 16px;
          background: linear-gradient(165deg, rgba(10,12,20,0.94) 0%, rgba(16,18,30,0.92) 100%);
          border: 1px solid color-mix(in srgb, var(--lb-accent, #00f0ff) 22%, transparent);
          box-shadow: 0 10px 40px rgba(0,0,0,0.5), 0 0 24px color-mix(in srgb, var(--lb-accent, #00f0ff) 12%, transparent);
          backdrop-filter: blur(18px) saturate(160%);
          -webkit-backdrop-filter: blur(18px) saturate(160%);
          color: #f4f6fb;
          overflow: hidden;
          transition: box-shadow .3s ease, border-color .3s ease;
          animation: lb-in .35s cubic-bezier(.16,1,.3,1);
        }
        @keyframes lb-in { from { opacity:0; transform: translateY(-8px) scale(.97); } to { opacity:1; transform:none; } }

        .lb-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 12px;
          cursor: move;
          user-select: none;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .lb-logo { font-size: 16px; filter: drop-shadow(0 0 6px var(--lb-accent, #00f0ff)); }
        .lb-title { display: flex; flex-direction: column; line-height: 1.1; flex: 1; }
        .lb-name { font-size: 13px; font-weight: 700; letter-spacing: .02em; }
        .lb-by { font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: rgba(255,255,255,0.4); }
        .lb-collapse {
          all: unset; cursor: pointer; color: rgba(255,255,255,0.5);
          width: 20px; height: 20px; display:flex; align-items:center; justify-content:center;
          border-radius: 6px; font-size: 14px; line-height: 1;
        }
        .lb-collapse:hover { background: rgba(255,255,255,0.08); color: #fff; }

        .lb-body { padding: 14px 14px 4px; transition: max-height .25s ease, opacity .2s ease; }
        .lb-card.lb-collapsed .lb-body,
        .lb-card.lb-collapsed .lb-footer { display: none; }

        .lb-metrics { display: flex; flex-direction: column; align-items: center; padding-bottom: 10px; }
        .lb-ring-wrap { position: relative; width: 108px; height: 108px; }
        .lb-ring { width: 100%; height: 100%; transform: rotate(-90deg); }
        .lb-ring-track { fill: none; stroke: rgba(255,255,255,0.08); stroke-width: 7; }
        .lb-ring-fill {
          fill: none; stroke: var(--lb-accent, #00f0ff); stroke-width: 7; stroke-linecap: round;
          stroke-dasharray: 264; stroke-dashoffset: 264;
          transition: stroke-dashoffset .4s ease, stroke .3s ease;
        }
        .lb-ring-label {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
        }
        .lb-fps-value { font-size: 26px; font-weight: 800; letter-spacing: -.02em; }
        .lb-fps-unit { font-size: 9px; letter-spacing: .1em; color: rgba(255,255,255,0.4); margin-top: -2px; }
        .lb-frametime { font-size: 10px; color: rgba(255,255,255,0.35); margin-top: 4px; }

        .lb-tabs { display: flex; gap: 4px; margin-bottom: 8px; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 3px; }
        .lb-tab {
          all: unset; flex: 1; text-align: center; font-size: 11px; font-weight: 600;
          padding: 6px 0; border-radius: 8px; color: rgba(255,255,255,0.55); cursor: pointer;
          transition: background .2s ease, color .2s ease;
        }
        .lb-tab:hover { color: #fff; }
        .lb-tab.active { background: color-mix(in srgb, var(--lb-accent, #00f0ff) 18%, transparent); color: #fff; }

        .lb-panel-tab { display: none; padding-bottom: 8px; }
        .lb-panel-tab.active { display: block; }

        .lb-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 2px; gap: 10px;
        }
        .lb-row + .lb-row { border-top: 1px solid rgba(255,255,255,0.05); }
        .lb-row-column { flex-direction: column; align-items: stretch; gap: 8px; }
        .lb-row-label { display: flex; flex-direction: column; gap: 1px; }
        .lb-label-main { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.85); }
        .lb-label-sub { font-size: 10px; color: rgba(255,255,255,0.35); }
        .lb-row-controls { display: flex; align-items: center; gap: 8px; }

        .lb-switch { position: relative; width: 38px; height: 21px; display: inline-block; flex-shrink: 0; cursor: pointer; }
        .lb-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .lb-switch-track {
          position: absolute; inset: 0; border-radius: 999px; background: rgba(255,255,255,0.12);
          transition: background .2s ease;
        }
        .lb-switch-track::before {
          content: ''; position: absolute; width: 15px; height: 15px; left: 3px; top: 3px;
          border-radius: 50%; background: #fff; transition: transform .2s ease;
        }
        .lb-switch input:checked + .lb-switch-track { background: var(--lb-accent, #00f0ff); }
        .lb-switch input:checked + .lb-switch-track::before { transform: translateX(17px); }

        .lb-select {
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
          color: #fff; font-size: 11px; padding: 4px 6px; border-radius: 6px; outline: none;
        }
        .lb-select:hover { border-color: var(--lb-accent, #00f0ff); }

        .lb-swatches { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .lb-swatch {
          all: unset; width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
          background: var(--sw); border: 2px solid transparent; transition: transform .15s ease, border-color .15s ease;
        }
        .lb-swatch:hover { transform: scale(1.12); }
        .lb-swatch.active { border-color: #fff; }
        .lb-color-input {
          width: 28px; height: 22px; border: none; border-radius: 6px; background: none;
          cursor: pointer; padding: 0;
        }

        .lb-footer {
          padding: 8px 14px 10px; text-align: center; font-size: 9px;
          color: rgba(255,255,255,0.25); border-top: 1px solid rgba(255,255,255,0.05);
        }

        .lb-mini {
          display: none;
          align-items: baseline;
          gap: 4px;
          padding: 2px 4px;
          cursor: move;
          user-select: none;
          font-family: 'Consolas', 'SF Mono', 'Segoe UI', monospace;
          width: fit-content;
        }
        .lb-mini-fps {
          font-size: 15px;
          font-weight: 700;
          color: var(--lb-fps-color, #34d399);
          text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.6);
        }
        .lb-mini-unit {
          font-size: 9px;
          font-weight: 600;
          letter-spacing: .05em;
          color: rgba(255,255,255,0.65);
          text-shadow: 0 1px 2px rgba(0,0,0,0.9);
        }

        :host(.lb-mini-mode) .lb-card { display: none; }
        :host(.lb-mini-mode) .lb-mini { display: flex; }
      `;
    },

    cacheRefs() {
      const s = this.shadow;
      this.refs.card = s.querySelector('.lb-card');
      this.refs.header = s.querySelector('.lb-header');
      this.refs.fpsValue = s.querySelector('[data-ref="fpsValue"]');
      this.refs.frameTime = s.querySelector('[data-ref="frameTime"]');
      this.refs.ringFill = s.querySelector('.lb-ring-fill');
      this.refs.collapseBtn = s.querySelector('[data-action="collapse"]');
      this.refs.tabs = Array.from(s.querySelectorAll('.lb-tab'));
      this.refs.panels = Array.from(s.querySelectorAll('.lb-panel-tab'));
      this.refs.toggles = Array.from(s.querySelectorAll('[data-setting]'));
      this.refs.upscaleFactor = s.querySelector('[data-ref="upscaleFactor"]');
      this.refs.swatches = Array.from(s.querySelectorAll('.lb-swatch'));
      this.refs.colorInput = s.querySelector('[data-ref="colorInput"]');
      this.refs.mini = s.querySelector('[data-ref="mini"]');
      this.refs.miniFps = s.querySelector('[data-ref="miniFps"]');
    },

    bindEvents() {
      // Tabs
      this.refs.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          this.refs.tabs.forEach(t => t.classList.remove('active'));
          this.refs.panels.forEach(p => p.classList.remove('active'));
          tab.classList.add('active');
          this.shadow.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
        });
      });

      // Toggles de configuração
      this.refs.toggles.forEach(input => {
        input.addEventListener('change', (e) => {
          const key = e.target.dataset.setting;
          this.onSettingToggle(key, e.target.checked);
        });
      });

      // Fator de upscale
      this.refs.upscaleFactor.addEventListener('change', (e) => {
        Upscale.changeFactor(parseFloat(e.target.value));
      });

      // Cor de destaque
      this.refs.swatches.forEach(btn => {
        btn.addEventListener('click', () => this.setAccent(btn.dataset.color));
      });
      this.refs.colorInput.addEventListener('input', (e) => this.setAccent(e.target.value));

      // Colapso / expansão
      this.refs.collapseBtn.addEventListener('click', () => this.setMiniMode(true));
      this.refs.mini.addEventListener('dblclick', () => this.setMiniMode(false));

      // Drag
      this.attachDragHandle(this.refs.header);
      this.attachDragHandle(this.refs.mini);

      // Atalho de teclado
      this._onKeyDown = (e) => {
        if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'o') {
          e.preventDefault();
          this.setVisible(!settings.panelVisible);
        }
      };
      document.addEventListener('keydown', this._onKeyDown);

      // Reage a ocultação da aba
      this._onVisibilityChange = () => {
        if (document.hidden && !settings.liteMode) LiteMode.set(true);
      };
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    },

    onSettingToggle(key, checked) {
      switch (key) {
        case 'force120Fps':
          settings.force120Fps = checked;
          checked ? FPSManager.start() : FPSManager.stop();
          saveSettings();
          break;
        case 'gpuBoost':
          settings.gpuBoost = checked;
          checked ? GpuBoost.apply() : GpuBoost.remove();
          saveSettings();
          break;
        case 'liteMode':
          AutoLite.onManualToggle();
          LiteMode.set(checked);
          break;
        case 'autoLite':
          settings.autoLite = checked;
          // [R9] Se desligou a automação e foi ela que ativou o LiteMode,
          // desliga o LiteMode junto — coerência de estado.
          if (!checked) {
            if (AutoLite.autoActivated) LiteMode.set(false);
            AutoLite.onManualToggle();
          }
          saveSettings();
          break;
        case 'upscaleEnabled':
          Upscale.setEnabled(checked);
          break;
      }
    },

    setAccent(color) {
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return;
      settings.accentColor = color;
      this.applyAccent(color);
      saveSettings();
    },

    applyAccent(color) {
      if (this.host) this.host.style.setProperty('--lb-accent', color);
      this.refs.swatches?.forEach(sw => sw.classList.toggle('active', sw.dataset.color === color));
      if (this.refs.colorInput) this.refs.colorInput.value = color;
    },

    updateFps(fps, frameTime) {
      if (!this.refs.fpsValue) return;
      let color = '#34d399';
      if (fps < 25) color = '#fb7185';
      else if (fps < 50) color = '#fbbf24';

      this.refs.fpsValue.textContent = fps;
      this.refs.frameTime.textContent = frameTime.toFixed(1) + ' ms';
      this.refs.ringFill.style.stroke = color;
      this.refs.fpsValue.style.color = color;
      const pct = Math.min(1, fps / 60);
      this.refs.ringFill.style.strokeDashoffset = String(264 * (1 - pct));

      if (this.refs.miniFps) {
        this.refs.miniFps.textContent = fps;
        this.refs.mini.style.setProperty('--lb-fps-color', color);
      }
    },

    // [G16] Sincroniza checkboxes E o select de upscale
    syncFromSettings() {
      this.refs.toggles?.forEach(input => {
        const key = input.dataset.setting;
        if (key in settings) input.checked = settings[key];
      });
      if (this.refs.upscaleFactor) {
        this.refs.upscaleFactor.value = String(settings.upscaleFactor);
      }
    },

    setVisible(visible) {
      settings.panelVisible = visible;
      if (this.host) this.host.style.display = visible ? 'block' : 'none';
      saveSettings();
    },

    restorePosition() {
      if (settings.panelPos && this.host) {
        this.host.style.left = settings.panelPos.left + 'px';
        this.host.style.top = settings.panelPos.top + 'px';
        this.host.style.right = 'auto';
      }
    },

    setMiniMode(on) {
      settings.panelMini = on;
      if (this.host) this.host.classList.toggle('lb-mini-mode', on);
      saveSettings();
    },

    // [G14] AbortController — sem acúmulo de listeners entre rebuilds
    attachDragHandle(handle) {
      const host = this.host;
      let dragging = false, moved = false, startX = 0, startY = 0;
      const ac = new AbortController();

      const onDown = (e) => {
        if (e.target.closest('button')) return;
        dragging = true; moved = false;
        const rect = host.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!dragging) return;
        moved = true;
        host.style.left = (e.clientX - startX) + 'px';
        host.style.top = (e.clientY - startY) + 'px';
        host.style.right = 'auto';
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        if (moved) {
          const rect = host.getBoundingClientRect();
          settings.panelPos = { left: rect.left, top: rect.top };
          saveSettings();
        }
      };

      handle.addEventListener('mousedown', onDown, { signal: ac.signal });
      document.addEventListener('mousemove', onMove, { signal: ac.signal });
      document.addEventListener('mouseup', onUp, { signal: ac.signal });

      if (!this._dragCleanups) this._dragCleanups = [];
      this._dragCleanups.push(() => ac.abort());
    },

    destroy() {
      try { if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown); } catch (e) {}
      try { if (this._onVisibilityChange) document.removeEventListener('visibilitychange', this._onVisibilityChange); } catch (e) {}
      if (this._dragCleanups) {
        for (const fn of this._dragCleanups) { try { fn(); } catch (e) {} }
        this._dragCleanups = [];
      }
      try { if (this.host) this.host.remove(); } catch (e) {}
      this.host = null;
      this.shadow = null;
      this.refs = {};
    }
  };

  // ============================================================
  // [FIX 3][R11] init() — sweep de lixo + restauração de patch órfão
  // ============================================================
  function init() {
    if (state.dying) return;

    // [FIX 3] Sweep de lixo de instâncias anteriores
    try {
      document.querySelectorAll('#lb-panel, #lb-lite-style').forEach(el => el.remove());
    } catch (e) {}

    // [FIX 3][R3] Se ficou um patch nosso órfão no prototype, restaura antes
    // de GpuBoost.apply() re-patchar. Marcador __lbPatched evita clobber de
    // patch de outro script.
    try {
      const proto = HTMLCanvasElement.prototype;
      if (proto.__lbOriginalGetContext && proto.getContext?.__lbPatched) {
        proto.getContext = proto.__lbOriginalGetContext;
      }
    } catch (e) {}

    if (settings.gpuBoost) {
      try { GpuBoost.apply(); } catch (e) { warn('GpuBoost.apply falhou:', e); }
    }
    if (settings.force120Fps) {
      try { FPSManager.start(); } catch (e) {}
    }

    try { LongTaskMonitor.start((info) => AutoLite.onLongTask(info)); } catch (e) {}

    rafId = requestAnimationFrame(fpsLoop);

    if (settings.liteMode) {
      try { LiteMode.set(true); } catch (e) {}
    }
    if (settings.upscaleEnabled) {
      try {
        Upscale.scanAll();
        SharedObserver.register('upscale', () => Upscale.scanAll());
      } catch (e) {}
    }

    try { UI.build(); } catch (e) { warn('UI.build falhou:', e); }

    // [R15] Log de startup com versão — facilita detectar múltiplas instâncias
    log(`inicializado · upscale=${settings.upscaleEnabled} · gpu=${settings.gpuBoost} · fps120=${settings.force120Fps}`);
  }

  if (document.body) {
    init();
  } else {
    const bootObserver = new MutationObserver(() => {
      if (document.body) {
        bootObserver.disconnect();
        // [R11] Pequeno delay garante que o hub2.js já criou seu container
        // antes de nossos observers começarem a escanear.
        setTimeout(init, 0);
      }
    });
    bootObserver.observe(document.documentElement, { childList: true });
  }

  // ============================================================
  // [FIX 1] kill() atômico — cada etapa isolada
  // ============================================================
  function kill() {
    if (state.dying) return;
    state.dying = true;
    state.alive = false;

    const steps = [
      ['cancel rafId', () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }],
      ['LongTaskMonitor.stop', () => LongTaskMonitor.stop()],
      ['SharedObserver.destroy', () => SharedObserver.destroy()],
      ['Upscale.removeAll', () => Upscale.removeAll()],
      ['GpuBoost.remove', () => GpuBoost.remove()],
      ['FPSManager.stop', () => FPSManager.stop()],
      ['remove lb-lite-style', () => {
        const el = document.getElementById('lb-lite-style');
        if (el) el.remove();
      }],
      ['UI.destroy', () => UI.destroy()]
    ];

    for (const [name, step] of steps) {
      try { step(); }
      catch (e) { warn(`kill step "${name}" falhou:`, e); }
    }

    // [R15] Log de shutdown — confirma que a instância morreu limpa
    log('finalizado.');
  }

  function isAlive() { return state.alive && !state.dying; }

  // API sempre exposta — mesmo se init() falhar, hub2.js consegue chamar kill().
  window[INSTANCE_KEY] = {
    version: VERSION,
    kill,
    isAlive,
    getState: () => ({ fps: currentFps, settings: { ...settings }, autoActivated: AutoLite.autoActivated }),
    getLongTasks: () => LongTaskMonitor.getRecent(),
    setLiteMode: (on) => { AutoLite.onManualToggle(); LiteMode.set(on); },
    setUpscale: (on) => Upscale.setEnabled(on),
    togglePanel: () => UI.setVisible(!settings.panelVisible)
  };

})();
