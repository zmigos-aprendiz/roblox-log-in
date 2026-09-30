// ==UserScript==
// @name         Games
// @namespace    devchris
// @version      9.5-chrome-fix
// @description  Biblioteca de jogos estilo launcher
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      api.github.com
// @noframes
// ==/UserScript==
(function () {
  'use strict';

  if (window._games) return;
  const api = { kill: () => {} };
  window._games = api;

  const ac = new AbortController();
  let host = null;
  let root = null;

  // ======= CONFIGURAÇÃO =======
  const MANIFEST_URL = 'https://raw.githubusercontent.com/zBeyond5/GamesHUB/refs/heads/main/TMGames/manifest.json';

  const TIMEOUT_DETECCAO_MS = 6000;
  const TIMEOUT_MANIFEST_MS = 8000;
  const LARGURA_MIN = 280;
  const ALTURA_MIN = 200;
  const RAZAO_16_9 = 16 / 9;
  const PAINEL_ALTURA_MAX_VH = 82;
  const FAB_SEGURAR_MS = 200;
  const BUSCA_DEBOUNCE_MS = 150;
  const SHELF_MAX_ITENS = 6;

  const PREFIXO_LOG = '[Game Launcher]';
  const GM_SINCRONO = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const GM_ASSINCRONO = typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function' && typeof GM.setValue === 'function';

  if (!GM_SINCRONO && !GM_ASSINCRONO) {
    console.warn(
      `${PREFIXO_LOG} GM_setValue/GM_getValue não disponíveis (verifique os @grant no gerenciador de userscripts). ` +
      `Usando localStorage como fallback — isso persiste só neste domínio.`
    );
  }

  // ================= FONTE =================
  function ensureFont() {
    if (document.querySelector('link[data-sang-font]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap';
    link.setAttribute('data-sang-font', '');
    document.head.appendChild(link);
  }

  // ================= ESTILO (aurora glass + biblioteca) =================
  function injetarEstilos() {
    if (root.getElementById('gl-estilos')) return;
    const style = document.createElement('style');
    style.id = 'gl-estilos';
    style.textContent = `
:host {
  all: initial;
  --hub-cyan: #22d3ee;
  --hub-violet: #a78bfa;
  --hub-grad: linear-gradient(120deg, var(--hub-cyan), var(--hub-violet));
  --hub-ok: #34d399;
  --hub-err: #fb7185;
  --hub-warn: #f59e0b;
  --hub-muted: #8b8fa3;
  --hub-text: #f1f2f5;
  --hub-radius: 20px;
  --hub-radius-sm: 12px;
  --hub-font: 'Geist', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
}
.gl-scope, .gl-scope * {
  box-sizing: border-box;
  font-family: var(--hub-font);
  color-scheme: dark;
}
.gl-scope { color: var(--hub-text); }

@keyframes gl-fade-in { from { opacity: 0; transform: translateY(4px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes gl-fade-in-center { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes gl-pulse-ring {
  0%   { box-shadow: 0 0 0 0 rgba(34,211,238,.5), 0 4px 18px rgba(0,0,0,.5); }
  70%  { box-shadow: 0 0 0 10px rgba(34,211,238,0), 0 4px 18px rgba(0,0,0,.5); }
  100% { box-shadow: 0 0 0 0 rgba(34,211,238,0), 0 4px 18px rgba(0,0,0,.5); }
}
@keyframes gl-spin { to { transform: rotate(360deg); } }
@keyframes gl-img-in { from { opacity: 0; } to { opacity: 1; } }

.gl-fab {
  position: fixed; z-index: 999999; width: 56px; height: 56px; border-radius: 50%;
  background: var(--hub-grad);
  border: 1px solid rgba(255,255,255,.18);
  color: #06080d; display: flex; align-items: center; justify-content: center;
  cursor: pointer; user-select: none;
  box-shadow: 0 4px 18px rgba(0,0,0,.5);
  transition: transform 150ms ease, filter 150ms ease, box-shadow 150ms ease;
}
.gl-fab.gl-fab-pulsando { animation: gl-pulse-ring 2.4s ease-out 3; }
.gl-fab:hover { transform: scale(1.06); filter: brightness(1.08); }
.gl-fab:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,211,238,.5); }
.gl-fab.gl-fab-liberado {
  cursor: grab; box-shadow: 0 0 0 3px rgba(34,211,238,.4), 0 4px 18px rgba(0,0,0,.5);
  animation: none;
}
.gl-fab.gl-fab-arrastando { cursor: grabbing; transform: scale(0.97); animation: none; }
.gl-fab svg { width: 26px; height: 26px; pointer-events: none; }

.gl-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid rgba(255,255,255,.1); border-radius: var(--hub-radius-sm);
  background: rgba(255,255,255,.04); color: var(--hub-text);
  font-size: 12px; font-weight: 600; padding: 8px 12px; cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, transform 100ms ease, filter 150ms ease;
}
.gl-btn:hover { border-color: rgba(34,211,238,.4); background: rgba(255,255,255,.07); }
.gl-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(34,211,238,.5); }
.gl-btn:active { transform: scale(0.97); }
.gl-btn:disabled { opacity: 0.5; cursor: default; transform: none; }
.gl-btn-primary { background: var(--hub-grad); border-color: transparent; color: #06080d; font-weight: 700; }
.gl-btn-primary:hover { filter: brightness(1.08); }
.gl-btn-danger { background: rgba(251,113,133,.14); border-color: rgba(251,113,133,.35); color: #fda4af; }
.gl-btn-icon { padding: 7px; border-radius: var(--hub-radius-sm); }
.gl-btn-icon svg { width: 15px; height: 15px; }
.gl-btn-play { background: rgba(52,211,153,.14); border-color: rgba(52,211,153,.4); color: #86efac; }

.gl-label { display: block; font-size: 10.5px; color: var(--hub-muted); margin-bottom: 4px; }
.gl-input, .gl-select {
  width: 100%; background: rgba(255,255,255,.04); color: var(--hub-text);
  border: 1px solid rgba(255,255,255,.1); border-radius: var(--hub-radius-sm);
  padding: 9px 11px; font-size: 12.5px; outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.gl-input:focus, .gl-select:focus { border-color: var(--hub-cyan); box-shadow: 0 0 0 3px rgba(34,211,238,.15); }
.gl-input::placeholder { color: var(--hub-muted); }

/* Fix: dropdown e campos nativos do Chrome/Edge/Brave em dark */
.gl-select { color-scheme: dark; background-color: #0f0f16; }
.gl-select option {
  background: #0f0f16;
  color: var(--hub-text);
  padding: 6px 10px;
}
.gl-select option:checked {
  background: linear-gradient(120deg, #22d3ee, #a78bfa);
  color: #06080d;
}

.gl-backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(5,8,15,.65); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
}
.gl-card {
  width: 280px;
  background: linear-gradient(175deg, rgba(20,20,28,.94) 0%, rgba(9,9,14,.98) 100%);
  backdrop-filter: blur(18px) saturate(140%);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: var(--hub-radius); padding: 18px;
  box-shadow: 0 20px 50px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.06);
  animation: gl-fade-in 160ms ease;
}
.gl-card-title { font-size: 14px; font-weight: 700; letter-spacing: .2px; margin-bottom: 3px; display: flex; align-items: center; gap: 7px; }
.gl-card-title svg { width: 16px; height: 16px; color: var(--hub-cyan); }
.gl-card-sub { font-size: 11px; color: var(--hub-muted); margin-bottom: 12px; line-height: 1.4; }
.gl-card-error { color: var(--hub-err); font-size: 11px; min-height: 14px; margin: 2px 0 8px; }
.gl-card-row { display: flex; gap: 8px; margin-top: 4px; }
.gl-field { margin-bottom: 8px; }

.gl-panel {
  position: fixed; z-index: 2147483647;
  top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 720px; max-width: 92vw; max-height: ${PAINEL_ALTURA_MAX_VH}vh;
  display: flex; flex-direction: column;
  background: linear-gradient(175deg, rgba(20,20,28,.92) 0%, rgba(9,9,14,.97) 100%);
  backdrop-filter: blur(18px) saturate(140%);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: var(--hub-radius); overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06);
  animation: gl-fade-in-center 180ms ease;
}
.gl-panel.gl-no-transform { transform: none; }
.gl-panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 13px 14px; background: rgba(255,255,255,.02);
  border-bottom: 1px solid rgba(255,255,255,.06); flex-shrink: 0;
  cursor: move; user-select: none;
}
.gl-panel-title {
  font-size: 13.5px; font-weight: 600; letter-spacing: .2px; display: flex; align-items: center; gap: 8px; pointer-events: none;
  background: var(--hub-grad); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.gl-panel-title svg { color: var(--hub-cyan); }
.gl-panel-actions { display: flex; gap: 6px; }
.gl-spin { animation: gl-spin 800ms linear infinite; }

.gl-banner {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 9px 14px; font-size: 11px; color: #fcd34d; background: rgba(245,158,11,.1);
  border-bottom: 1px solid rgba(255,255,255,.06); flex-shrink: 0;
}
.gl-banner svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; color: var(--hub-warn); }

/* ======= TOOLBAR (busca + ordenação) ======= */
.gl-toolbar {
  display: flex; gap: 8px; align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255,255,255,.06);
  background: rgba(255,255,255,.015);
  flex-shrink: 0;
}
.gl-search { position: relative; flex: 1; display: flex; align-items: center; }
.gl-search svg {
  position: absolute; left: 10px; width: 14px; height: 14px; color: var(--hub-muted); pointer-events: none;
}
.gl-search input { padding-left: 30px; }
.gl-sort { width: 168px; flex-shrink: 0; }

/* ======= CORPO: sidebar + conteúdo ======= */
.gl-body { flex: 1; min-height: 0; display: flex; }
.gl-sidebar {
  width: 136px; flex-shrink: 0; overflow-y: auto;
  padding: 10px 8px; display: flex; flex-direction: column; gap: 2px;
  border-right: 1px solid rgba(255,255,255,.06);
  background: rgba(255,255,255,.01);
}
.gl-sidebar::-webkit-scrollbar { width: 4px; }
.gl-sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 2px; }
.gl-nav-item {
  display: block;
  padding: 7px 9px; border-radius: 8px;
  font-size: 11.5px; font-weight: 600; color: var(--hub-muted);
  cursor: pointer; border: 1px solid transparent;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.gl-nav-item:hover { background: rgba(255,255,255,.05); color: var(--hub-text); }
.gl-nav-item.ativo {
  background: rgba(34,211,238,.12); color: var(--hub-cyan);
  border-color: rgba(34,211,238,.25);
}

.gl-content { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-y: auto; }
.gl-content::-webkit-scrollbar { width: 6px; }
.gl-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 3px; }

.gl-shelf-titulo {
  font-size: 10.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--hub-muted); padding: 12px 12px 8px;
  display: none; align-items: center; gap: 5px;
}
.gl-shelf-titulo svg { width: 12px; height: 12px; }
.gl-shelf {
  display: none; gap: 10px; overflow-x: auto; overflow-y: hidden;
  padding: 0 12px 14px; flex-shrink: 0;
}
.gl-shelf::-webkit-scrollbar { height: 5px; }
.gl-shelf::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 3px; }
.gl-shelf .gl-game-card { width: 172px; flex-shrink: 0; }

/* ======= GRID DE CAPAS ======= */
.gl-grid {
  padding: 4px 12px 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  align-content: start;
}
.gl-empty {
  grid-column: 1 / -1;
  color: var(--hub-muted); font-size: 12px; padding: 40px 16px; text-align: center; line-height: 1.55;
}

.gl-game-card {
  display: flex; flex-direction: column;
  border-radius: var(--hub-radius-sm);
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.06);
  overflow: hidden;
  position: relative;
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}
.gl-game-card:hover {
  transform: translateY(-3px);
  border-color: rgba(34,211,238,.35);
  background: rgba(255,255,255,.05);
  box-shadow: 0 12px 28px rgba(0,0,0,.4), 0 0 0 1px rgba(34,211,238,.15);
}

.gl-cover {
  position: relative; width: 100%; aspect-ratio: 16 / 9;
  background: rgba(255,255,255,.04);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.gl-cover img { width: 100%; height: 100%; object-fit: cover; display: block; animation: gl-img-in 200ms ease; }
.gl-cover-fallback-letra { font-size: 32px; font-weight: 700; color: rgba(255,255,255,.62); pointer-events: none; }

.gl-cover-scrim {
  position: absolute; left: 0; right: 0; bottom: 0; height: 50%;
  background: linear-gradient(180deg, transparent 0%, rgba(6,8,13,.65) 100%);
  pointer-events: none;
}
.gl-cover-status {
  position: absolute; top: 7px; left: 7px; z-index: 2;
  width: 20px; height: 20px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(6px);
}
.gl-cover-status svg { width: 11px; height: 11px; }
.gl-cover-status.status-ok { background: rgba(52,211,153,.85); color: #06080d; }
.gl-cover-status.status-bloqueado { background: rgba(251,113,133,.88); color: #06080d; }

.gl-cover-actions {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(180deg, rgba(6,8,13,.15) 0%, rgba(6,8,13,.7) 100%);
  opacity: 0;
  transition: opacity 160ms ease;
}
.gl-game-card:hover .gl-cover-actions { opacity: 1; }

.gl-play-btn {
  width: 46px; height: 46px; border-radius: 50%;
  background: var(--hub-grad);
  color: #06080d; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(34,211,238,.45);
  transform: scale(0.85);
  transition: transform 160ms ease, filter 160ms ease;
}
.gl-game-card:hover .gl-play-btn { transform: scale(1); }
.gl-play-btn:hover { filter: brightness(1.1); transform: scale(1.08) !important; }
.gl-play-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,211,238,.55), 0 8px 24px rgba(34,211,238,.45); }
.gl-play-btn svg { width: 18px; height: 18px; margin-left: 2px; pointer-events: none; }

.gl-remove-btn {
  position: absolute; top: 7px; right: 7px; z-index: 2;
  width: 26px; height: 26px; border-radius: 7px;
  background: rgba(251,113,133,.92);
  border: none; color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  transition: opacity 160ms ease, transform 120ms ease, filter 120ms ease;
  box-shadow: 0 4px 12px rgba(0,0,0,.35);
}
.gl-game-card:hover .gl-remove-btn { opacity: 1; }
.gl-remove-btn:hover { filter: brightness(1.1); }
.gl-remove-btn:active { transform: scale(0.92); }
.gl-remove-btn svg { width: 13px; height: 13px; pointer-events: none; }

.gl-game-info { padding: 9px 11px 10px; display: flex; flex-direction: column; gap: 3px; }
.gl-game-name {
  font-size: 12.5px; font-weight: 600; line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.gl-game-meta-linha {
  font-size: 10.5px; color: var(--hub-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.gl-hover-info {
  position: fixed; z-index: 2147483647; max-width: 220px;
  background: linear-gradient(175deg, rgba(20,20,28,.95) 0%, rgba(9,9,14,.98) 100%);
  backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid rgba(255,255,255,.08); border-radius: var(--hub-radius-sm);
  padding: 10px 12px; font-size: 11.5px; line-height: 1.6; color: var(--hub-text);
  box-shadow: 0 16px 40px rgba(0,0,0,.55); pointer-events: none;
}
.gl-hover-info-title { font-weight: 700; font-size: 12.5px; margin-bottom: 5px; }
.gl-hover-info-row { display: flex; justify-content: space-between; gap: 12px; color: var(--hub-muted); }
.gl-hover-info-row span:last-child { color: var(--hub-text); text-align: right; }

.gl-panel-footer { border-top: 1px solid rgba(255,255,255,.06); padding: 11px 12px; background: rgba(255,255,255,.015); flex-shrink: 0; }

.gl-overlay {
  position: fixed; z-index: 2147483647;
  background: #07090f; display: flex; flex-direction: column;
  border: 1px solid rgba(255,255,255,.08); border-radius: var(--hub-radius); overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.05);
  transition: left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease, border-radius 180ms ease;
}
.gl-overlay.gl-no-transition { transition: none; }
.gl-overlay-bar {
  display: flex; justify-content: space-between; align-items: center;
  background: rgba(255,255,255,.03); backdrop-filter: blur(18px) saturate(140%);
  padding: 7px 8px 7px 12px;
  cursor: move; user-select: none; flex-shrink: 0; border-bottom: 1px solid rgba(255,255,255,.06);
}
.gl-overlay-title { font-size: 12px; font-weight: 600; color: var(--hub-muted); pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
.gl-overlay-title svg { width: 13px; height: 13px; color: var(--hub-cyan); flex-shrink: 0; }
.gl-overlay-controls { display: flex; gap: 4px; flex-shrink: 0; }
.gl-overlay-body { flex: 1; position: relative; min-height: 0; overflow: hidden; }
.gl-overlay-body iframe { width: 100%; height: 100%; border: none; display: block; }
.gl-resize-handle {
  position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; z-index: 10;
  cursor: nwse-resize;
}
.gl-resize-handle::after {
  content: ''; position: absolute; right: 4px; bottom: 4px; width: 9px; height: 9px;
  background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,.2) 50%);
  border-radius: 0 0 3px 0; transition: background 150ms ease;
}
.gl-resize-handle:hover::after { background: linear-gradient(135deg, transparent 50%, var(--hub-cyan) 50%); }
.gl-dica {
  position: absolute; top: 44px; right: 8px; z-index: 20; max-width: 260px;
  background: linear-gradient(175deg, rgba(20,20,28,.95) 0%, rgba(9,9,14,.98) 100%);
  backdrop-filter: blur(14px) saturate(140%);
  color: var(--hub-text); font-size: 11.5px; line-height: 1.5;
  padding: 10px 12px; border-radius: var(--hub-radius-sm); border: 1px solid rgba(34,211,238,.3);
  box-shadow: 0 8px 24px rgba(0,0,0,.5); animation: gl-fade-in 150ms ease;
}
    `;
    root.appendChild(style);
  }

  // ================= ÍCONES =================
  function icone(nome, tamanho) {
    const t = tamanho || 18;
    const mapa = {
      gamepad: '<path d="M6 11h4M8 9v4"/><circle cx="16" cy="10.5" r="0.6" fill="currentColor" stroke="none"/><circle cx="18" cy="12.5" r="0.6" fill="currentColor" stroke="none"/><rect x="2" y="7" width="20" height="10" rx="5"/>',
      fechar: '<path d="M18 6 6 18M6 6l12 12"/>',
      play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
      voltar: '<path d="M15 18l-6-6 6-6"/>',
      somOn: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a9 9 0 0 1 0 12"/>',
      somOff: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/>',
      minimizar: '<path d="M5 12h14"/>',
      maximizar: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
      restaurar: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
      atualizar: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>',
      mais: '<path d="M12 5v14M5 12h14"/>',
      lixeira: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
      alerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      bloqueio: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
      baixar: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
      relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
      buscar: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
      linkExterno: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    };
    return `<svg viewBox="0 0 24 24" width="${t}" height="${t}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${mapa[nome] || ''}</svg>`;
  }

  // ---------- Storage ----------
  async function lerStorage(chave, padrao) {
    let bruto = null;
    try {
      if (GM_SINCRONO) bruto = GM_getValue(chave, null);
      else if (GM_ASSINCRONO) bruto = await GM.getValue(chave, null);
    } catch (e) {
      console.error(`${PREFIXO_LOG} erro ao ler "${chave}" via GM storage:`, e);
    }
    if (bruto === null || bruto === undefined) {
      try {
        bruto = localStorage.getItem('launcher-backup-' + chave) || localStorage.getItem(chave);
      } catch (e) { /* localStorage indisponível */ }
    }
    if (bruto === null || bruto === undefined) return padrao;
    try {
      return typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
    } catch (e) {
      console.error(`${PREFIXO_LOG} erro ao interpretar "${chave}":`, e, bruto);
      return padrao;
    }
  }

  async function salvarStorage(chave, valor) {
    const json = JSON.stringify(valor);
    try {
      if (GM_SINCRONO) GM_setValue(chave, json);
      else if (GM_ASSINCRONO) await GM.setValue(chave, json);
    } catch (e) {
      console.error(`${PREFIXO_LOG} erro ao salvar "${chave}" via GM storage:`, e);
    }
    try {
      localStorage.setItem('launcher-backup-' + chave, json);
    } catch (e) {
      console.error(`${PREFIXO_LOG} erro ao salvar backup de "${chave}" em localStorage:`, e);
    }
  }

  async function carregarConfigJanela() {
    const padrao = { x: null, y: null, w: 480, h: 360, maximizado: false };
    return { ...padrao, ...(await lerStorage('launcher-layout', padrao)) };
  }
  function salvarConfigJanela(cfg) { salvarStorage('launcher-layout', cfg); }

  async function carregarPosicaoFab() { return await lerStorage('launcher-fab-pos', null); }
  function salvarPosicaoFab(pos) { salvarStorage('launcher-fab-pos', pos); }

  async function carregarPosicaoPainel() { return await lerStorage('launcher-painel-pos', null); }
  function salvarPosicaoPainel(pos) { salvarStorage('launcher-painel-pos', pos); }

  function gerarId(prefixo) {
    return (prefixo || 'g') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---------- Estatísticas ----------
  async function carregarEstatisticas() {
    const dados = await lerStorage('launcher-estatisticas', {});
    return dados && typeof dados === 'object' ? dados : {};
  }
  function salvarEstatisticas(dados) { salvarStorage('launcher-estatisticas', dados); }

  async function registrarSessao(jogoId, duracaoMs) {
    if (!jogoId || !duracaoMs || duracaoMs < 3000) return;
    const estatisticas = await carregarEstatisticas();
    const atual = estatisticas[jogoId] || { tempoJogadoMs: 0, vezesJogado: 0, ultimaSessaoEm: null };
    atual.tempoJogadoMs = (atual.tempoJogadoMs || 0) + duracaoMs;
    atual.vezesJogado = (atual.vezesJogado || 0) + 1;
    atual.ultimaSessaoEm = new Date().toISOString();
    estatisticas[jogoId] = atual;
    salvarEstatisticas(estatisticas);
  }
  function formatarDuracao(ms) {
    if (!ms || ms < 60000) return '< 1 min';
    const minutos = Math.floor(ms / 60000);
    const horas = Math.floor(minutos / 60);
    const minRestantes = minutos % 60;
    return horas > 0 ? `${horas}h ${minRestantes}min` : `${minutos}min`;
  }
  function formatarRelativo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'agora mesmo';
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffHoras = Math.floor(diffMin / 60);
    if (diffHoras < 24) return `há ${diffHoras}h`;
    const diffDias = Math.floor(diffHoras / 24);
    if (diffDias === 1) return 'ontem';
    if (diffDias < 30) return `há ${diffDias} dias`;
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  // ---------- Exportar manifest.json ----------
  function paraSlug(texto) {
    return (
      (texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-+|-+$)/g, '') || 'jogo'
    );
  }
  async function exportarManifestArquivo() {
    const manifest = await carregarJogosManifest(false);
    const temporarios = await carregarJogosTemporarios();
    const jogosManifest = Array.isArray(manifest.jogos) ? manifest.jogos : [];
    const todos = [...jogosManifest, ...temporarios];

    const idsUsados = new Set();
    const exportado = todos.map((j) => {
      const base = paraSlug(j.nome);
      let id = base, contador = 2;
      while (idsUsados.has(id)) id = `${base}-${contador++}`;
      idsUsados.add(id);
      const obj = { id, nome: j.nome, url: j.url };
      if (j.imagem) obj.imagem = j.imagem;
      if (j.genero) obj.genero = j.genero;
      if (j.adicionadoEm) obj.adicionadoEm = j.adicionadoEm;
      return obj;
    });

    const json = JSON.stringify(exportado, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manifest.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ---------- Manifest remoto ----------
  function buscarTexto(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: timeoutMs,
          onload: (res) => {
            clearTimeout(timer);
            if (res.status >= 200 && res.status < 300) resolve(res.responseText);
            else reject(new Error('status ' + res.status));
          },
          onerror: () => { clearTimeout(timer); reject(new Error('erro de rede')); },
          ontimeout: () => { clearTimeout(timer); reject(new Error('timeout')); },
        });
      } else {
        const controlador = new AbortController();
        const timer = setTimeout(() => controlador.abort(), timeoutMs);
        fetch(url, { signal: controlador.signal, cache: 'no-store' })
          .then((res) => {
            clearTimeout(timer);
            if (!res.ok) throw new Error('status ' + res.status);
            return res.text();
          })
          .then(resolve)
          .catch(reject);
      }
    });
  }

  function normalizarUrlManifest(url) {
    const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
    return url;
  }

  function normalizarJogoManifest(item) {
    if (!item || typeof item.nome !== 'string' || typeof item.url !== 'string') return null;
    let url = item.url.trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let imagem = typeof item.imagem === 'string' ? item.imagem.trim() : '';
    if (imagem && !/^https?:\/\//i.test(imagem)) imagem = 'https://' + imagem;
    const genero = typeof item.genero === 'string' && item.genero.trim() ? item.genero.trim() : null;
    const adicionadoEm = typeof item.adicionadoEm === 'string' && item.adicionadoEm.trim() ? item.adicionadoEm.trim() : null;
    return {
      id: typeof item.id === 'string' && item.id ? 'manifest-' + item.id : gerarId('manifest-'),
      nome: item.nome.trim(),
      url,
      imagem: imagem || null,
      genero,
      adicionadoEm,
      origem: 'manifest',
      status: 'nao-testado',
      ultimoTeste: null,
    };
  }

  async function carregarJogosManifest(forcarAtualizacao) {
    const cacheBruto = await lerStorage('launcher-manifest-cache', { jogos: [], atualizadoEm: null, erro: null });
    const cache = { ...cacheBruto, jogos: Array.isArray(cacheBruto.jogos) ? cacheBruto.jogos : [] };
    if (!forcarAtualizacao && cache.jogos.length) {
      atualizarManifestEmSegundoPlano();
      return cache;
    }
    try {
      const url = normalizarUrlManifest(MANIFEST_URL);
      const texto = await buscarTexto(url, TIMEOUT_MANIFEST_MS);
      if (texto.trim().startsWith('<')) {
        throw new Error(
          'a URL devolveu HTML em vez de JSON — confira se MANIFEST_URL aponta pro link "raw" ' +
          '(raw.githubusercontent.com), e não pra página normal do arquivo no GitHub.'
        );
      }
      const bruto = JSON.parse(texto);
      const listaBruta = Array.isArray(bruto) ? bruto : Array.isArray(bruto.jogos) ? bruto.jogos : null;
      if (!listaBruta) throw new Error('formato inválido: esperava um array ou { "jogos": [...] }');
      const jogos = listaBruta.map(normalizarJogoManifest).filter(Boolean);
      const novoCache = { jogos, atualizadoEm: new Date().toISOString(), erro: null };
      salvarStorage('launcher-manifest-cache', novoCache);
      return novoCache;
    } catch (e) {
      console.error(`${PREFIXO_LOG} falha ao buscar manifest:`, e);
      const comErro = { ...cache, erro: String(e.message || e) };
      salvarStorage('launcher-manifest-cache', comErro);
      return comErro;
    }
  }

  let atualizandoEmSegundoPlano = false;
  function atualizarManifestEmSegundoPlano() {
    if (atualizandoEmSegundoPlano) return;
    atualizandoEmSegundoPlano = true;
    carregarJogosManifest(true).finally(() => { atualizandoEmSegundoPlano = false; });
  }

  // ---------- Jogos temporários ----------
  async function carregarJogosTemporarios() {
    const lista = await lerStorage('launcher-jogos-temporarios', []);
    return Array.isArray(lista) ? lista : [];
  }
  function salvarJogosTemporarios(lista) { salvarStorage('launcher-jogos-temporarios', lista); }

  function statusInfo(status) {
    if (status === 'ok') return { icone: 'check', classe: 'gl-badge-ok', texto: 'Funcionou' };
    if (status === 'bloqueado') return { icone: 'bloqueio', classe: 'gl-badge-bloqueado', texto: 'Bloqueado' };
    return { icone: null, classe: 'gl-badge-neutro', texto: 'Não testado' };
  }

  // ---------- Modal de jogo temporário ----------
  function abrirModalJogoTemporario(aoConfirmar) {
    if (root.getElementById('gl-temp-modal')) return;
    injetarEstilos();

    const fundo = document.createElement('div');
    fundo.id = 'gl-temp-modal';
    fundo.className = 'gl-scope gl-backdrop';
    fundo.dataset.hub = '1';
    fundo.setAttribute('data-sang-ui', '');

    const card = document.createElement('div');
    card.className = 'gl-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Adicionar jogo temporário');

    // Impede que cliques no card borbulhem para o backdrop e fechem o modal
    card.addEventListener('mousedown', (e) => e.stopPropagation());

    const titulo = document.createElement('div');
    titulo.className = 'gl-card-title';
    titulo.innerHTML = `${icone('mais', 16)} Jogo temporário`;

    const legenda = document.createElement('div');
    legenda.className = 'gl-card-sub';
    legenda.textContent = 'Fica salvo só neste dispositivo, separado da lista do manifest.';

    function campoComLabel(labelTexto, inputEl, idSufixo) {
      const campo = document.createElement('div');
      campo.className = 'gl-field';
      const label = document.createElement('label');
      label.className = 'gl-label';
      label.textContent = labelTexto;
      const id = 'gl-campo-' + idSufixo;
      label.htmlFor = id;
      inputEl.id = id;
      campo.appendChild(label);
      campo.appendChild(inputEl);
      return campo;
    }

    function criarInput(placeholder) {
      const i = document.createElement('input');
      i.className = 'gl-input';
      i.type = 'text';
      i.placeholder = placeholder;
      i.autocomplete = 'off';
      i.autocorrect = 'off';
      i.autocapitalize = 'off';
      i.spellcheck = false;
      return i;
    }

    const inputNome = criarInput('Nome do jogo');
    const campoNome = campoComLabel('Nome', inputNome, 'nome');

    const inputUrl = criarInput('https://...');
    const campoUrl = campoComLabel('URL', inputUrl, 'url');

    const inputImagem = criarInput('URL da imagem (opcional)');
    const campoImagem = campoComLabel('Imagem (opcional)', inputImagem, 'imagem');

    const inputGenero = criarInput('ex: Corrida, RPG');
    const campoGenero = campoComLabel('Gênero (opcional)', inputGenero, 'genero');

    const erro = document.createElement('div');
    erro.className = 'gl-card-error';
    erro.setAttribute('role', 'alert');

    const linhaBotoes = document.createElement('div');
    linhaBotoes.className = 'gl-card-row';

    const confirmarBtn = document.createElement('button');
    confirmarBtn.className = 'gl-btn gl-btn-primary';
    confirmarBtn.style.flex = '1';
    confirmarBtn.textContent = 'Adicionar';

    const cancelarBtn = document.createElement('button');
    cancelarBtn.className = 'gl-btn';
    cancelarBtn.style.flex = '1';
    cancelarBtn.textContent = 'Cancelar';

    card.appendChild(titulo);
    card.appendChild(legenda);
    card.appendChild(campoNome);
    card.appendChild(campoUrl);
    card.appendChild(campoImagem);
    card.appendChild(campoGenero);
    card.appendChild(erro);
    linhaBotoes.appendChild(confirmarBtn);
    linhaBotoes.appendChild(cancelarBtn);
    card.appendChild(linhaBotoes);
    fundo.appendChild(card);
    root.appendChild(fundo);

    // Foco com rAF duplo — garante que o shadow DOM já esteja pintado
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { inputNome.focus(); } catch (e) {}
      });
    });

    function fechar() {
      fundo.remove();
      document.removeEventListener('keydown', aoTeclar);
    }

    function aoTeclar(e) {
      if (e.key === 'Escape') { fechar(); return; }
      if (e.key !== 'Enter') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'TEXTAREA') return; // Enter em textarea = quebra de linha
      e.preventDefault();
      confirmarBtn.click();
    }
    document.addEventListener('keydown', aoTeclar, { signal: ac.signal });
    cancelarBtn.addEventListener('click', fechar);
    fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(); });

    confirmarBtn.addEventListener('click', () => {
      const nome = inputNome.value.trim();
      let url = inputUrl.value.trim();
      if (!nome || !url) {
        erro.textContent = 'Preencha nome e URL.';
        return;
      }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      let imagem = inputImagem.value.trim();
      if (imagem && !/^https?:\/\//i.test(imagem)) imagem = 'https://' + imagem;
      const genero = inputGenero.value.trim();
      fechar();
      aoConfirmar({
        id: gerarId('temp-'),
        nome,
        url,
        imagem: imagem || null,
        genero: genero || null,
        adicionadoEm: new Date().toISOString(),
        origem: 'temporario',
        status: 'nao-testado',
        ultimoTeste: null,
      });
    });
  }

  // ---------- Tratamento de capa: crop consistente + fallback com iniciais ----------
  function corDeterministica(nome) {
    let hash = 0;
    const texto = nome || '?';
    for (let i = 0; i < texto.length; i++) hash = (hash * 31 + texto.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `linear-gradient(135deg, hsla(${hue},65%,50%,.38), hsla(${(hue + 55) % 360},65%,50%,.38))`;
  }
  function aplicarCoverFallback(cover, nome) {
    cover.style.background = corDeterministica(nome);
    const letra = document.createElement('span');
    letra.className = 'gl-cover-fallback-letra';
    letra.textContent = (nome || '?').trim().charAt(0).toUpperCase();
    cover.appendChild(letra);
  }
  function criarCover(jogo) {
    const cover = document.createElement('div');
    cover.className = 'gl-cover';

    if (jogo.imagem) {
      const img = document.createElement('img');
      img.src = jogo.imagem;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => {
        img.remove();
        aplicarCoverFallback(cover, jogo.nome);
      });
      cover.appendChild(img);
    } else {
      aplicarCoverFallback(cover, jogo.nome);
    }

    const scrim = document.createElement('div');
    scrim.className = 'gl-cover-scrim';
    cover.appendChild(scrim);

    if (jogo.status === 'ok' || jogo.status === 'bloqueado') {
      const chip = document.createElement('span');
      chip.className = 'gl-cover-status status-' + jogo.status;
      chip.title = jogo.status === 'ok' ? 'Já funcionou antes' : 'Bloqueado por embed';
      chip.innerHTML = icone(jogo.status === 'ok' ? 'check' : 'bloqueio', 11);
      cover.appendChild(chip);
    }

    return cover;
  }

  // ---------- Painel biblioteca (sidebar + busca + ordenação + prateleira) ----------
  async function abrirPainelJogos() {
    if (root.getElementById('gl-painel')) return;
    injetarEstilos();

    const painel = document.createElement('div');
    painel.id = 'gl-painel';
    painel.className = 'gl-scope gl-panel';
    painel.dataset.hub = '1';
    painel.setAttribute('data-sang-ui', '');

    const posSalva = await carregarPosicaoPainel();
    if (posSalva && typeof posSalva.left === 'number' && typeof posSalva.top === 'number') {
      const left = Math.max(4, Math.min(posSalva.left, window.innerWidth - 40));
      const top = Math.max(4, Math.min(posSalva.top, window.innerHeight - 40));
      painel.classList.add('gl-no-transform');
      painel.style.left = left + 'px';
      painel.style.top = top + 'px';
    }

    // ---- cabeçalho ----
    const cabecalho = document.createElement('div');
    cabecalho.className = 'gl-panel-header';

    const titulo = document.createElement('span');
    titulo.className = 'gl-panel-title';
    titulo.innerHTML = `${icone('gamepad', 17)} Biblioteca`;

    const botoesCabecalho = document.createElement('div');
    botoesCabecalho.className = 'gl-panel-actions';

    const atualizarBtn = document.createElement('button');
    atualizarBtn.className = 'gl-btn gl-btn-icon';
    atualizarBtn.title = 'Atualizar lista do manifest';
    atualizarBtn.setAttribute('aria-label', 'Atualizar lista do manifest');
    atualizarBtn.innerHTML = icone('atualizar', 15);
    atualizarBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    atualizarBtn.addEventListener('click', async () => {
      atualizarBtn.disabled = true;
      atualizarBtn.querySelector('svg').classList.add('gl-spin');
      await carregarJogosManifest(true);
      atualizarBtn.disabled = false;
      atualizarBtn.querySelector('svg').classList.remove('gl-spin');
      renderizarLista();
    });

    const baixarBtn = document.createElement('button');
    baixarBtn.className = 'gl-btn gl-btn-icon';
    baixarBtn.title = 'Baixar manifest.json (jogos do manifest + temporários)';
    baixarBtn.setAttribute('aria-label', 'Baixar manifest.json');
    baixarBtn.innerHTML = icone('baixar', 15);
    baixarBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    baixarBtn.addEventListener('click', () => exportarManifestArquivo());

    const fecharBtn = document.createElement('button');
    fecharBtn.className = 'gl-btn gl-btn-icon gl-btn-danger';
    fecharBtn.title = 'Fechar';
    fecharBtn.setAttribute('aria-label', 'Fechar painel de jogos');
    fecharBtn.innerHTML = icone('fechar', 15);
    fecharBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    fecharBtn.addEventListener('click', fecharPainel);

    botoesCabecalho.appendChild(baixarBtn);
    botoesCabecalho.appendChild(atualizarBtn);
    botoesCabecalho.appendChild(fecharBtn);
    cabecalho.appendChild(titulo);
    cabecalho.appendChild(botoesCabecalho);

    const avisoManifest = document.createElement('div');
    avisoManifest.className = 'gl-banner';
    avisoManifest.style.display = 'none';

    // ---- toolbar: busca + ordenação ----
    const buscaWrap = document.createElement('div');
    buscaWrap.className = 'gl-search';
    buscaWrap.innerHTML = icone('buscar', 14);
    const buscaInput = document.createElement('input');
    buscaInput.className = 'gl-input';
    buscaInput.type = 'text';
    buscaInput.placeholder = 'Buscar na biblioteca...';
    buscaInput.setAttribute('aria-label', 'Buscar jogo pelo nome');
    buscaInput.autocomplete = 'off';
    buscaInput.spellcheck = false;
    let buscaTimer = null;
    buscaInput.addEventListener('input', () => {
      clearTimeout(buscaTimer);
      buscaTimer = setTimeout(() => {
        buscaTexto = buscaInput.value.trim().toLowerCase();
        aplicarFiltroErenderizar();
      }, BUSCA_DEBOUNCE_MS);
    });
    buscaWrap.appendChild(buscaInput);

    const sortSelect = document.createElement('select');
    sortSelect.className = 'gl-select gl-sort';
    sortSelect.setAttribute('aria-label', 'Ordenar jogos');
    sortSelect.innerHTML = `
      <option value="recentes">Adicionados recentemente</option>
      <option value="nome">Nome (A–Z)</option>
      <option value="jogados">Mais jogados</option>
    `;
    sortSelect.addEventListener('change', () => {
      ordenacao = sortSelect.value;
      aplicarFiltroErenderizar();
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'gl-toolbar';
    toolbar.appendChild(buscaWrap);
    toolbar.appendChild(sortSelect);

    // ---- corpo: sidebar de gêneros + conteúdo ----
    const corpoPainel = document.createElement('div');
    corpoPainel.className = 'gl-body';

    const sidebar = document.createElement('div');
    sidebar.className = 'gl-sidebar';

    const conteudo = document.createElement('div');
    conteudo.className = 'gl-content';

    const shelfTitulo = document.createElement('div');
    shelfTitulo.className = 'gl-shelf-titulo';
    shelfTitulo.innerHTML = `${icone('relogio', 12)} Continuar jogando`;

    const shelf = document.createElement('div');
    shelf.className = 'gl-shelf';

    const lista = document.createElement('div');
    lista.className = 'gl-grid';

    conteudo.appendChild(shelfTitulo);
    conteudo.appendChild(shelf);
    conteudo.appendChild(lista);
    corpoPainel.appendChild(sidebar);
    corpoPainel.appendChild(conteudo);

    // ---- rodapé ----
    const rodape = document.createElement('div');
    rodape.className = 'gl-panel-footer';
    const addTempBtn = document.createElement('button');
    addTempBtn.className = 'gl-btn gl-btn-primary';
    addTempBtn.style.width = '100%';
    addTempBtn.innerHTML = `${icone('mais', 14)} Adicionar jogo temporário`;
    addTempBtn.addEventListener('click', () => {
      abrirModalJogoTemporario(async (novoJogo) => {
        const temporarios = await carregarJogosTemporarios();
        temporarios.push(novoJogo);
        salvarJogosTemporarios(temporarios);
        renderizarLista();
      });
    });
    rodape.appendChild(addTempBtn);

    painel.appendChild(cabecalho);
    painel.appendChild(avisoManifest);
    painel.appendChild(toolbar);
    painel.appendChild(corpoPainel);
    painel.appendChild(rodape);
    root.appendChild(painel);
    document.addEventListener('keydown', aoTeclarEscPainel, { signal: ac.signal });

    // ---- arrastar o painel pela barra de cabeçalho ----
    let arrastandoPainel = false, offPX = 0, offPY = 0;
    cabecalho.addEventListener('mousedown', (e) => {
      if (e.target !== cabecalho && e.target !== titulo && !titulo.contains(e.target)) return;
      arrastandoPainel = true;
      const rect = painel.getBoundingClientRect();
      painel.classList.add('gl-no-transform');
      painel.style.left = rect.left + 'px';
      painel.style.top = rect.top + 'px';
      offPX = e.clientX - rect.left;
      offPY = e.clientY - rect.top;
      e.preventDefault();
    });
    function aoMoverPainel(e) {
      if (!arrastandoPainel) return;
      let novoX = e.clientX - offPX;
      let novoY = e.clientY - offPY;
      novoX = Math.max(4, Math.min(novoX, window.innerWidth - painel.offsetWidth - 4));
      novoY = Math.max(4, Math.min(novoY, window.innerHeight - painel.offsetHeight - 4));
      painel.style.left = novoX + 'px';
      painel.style.top = novoY + 'px';
    }
    function aoSoltarPainel() {
      if (!arrastandoPainel) return;
      arrastandoPainel = false;
      salvarPosicaoPainel({ left: parseInt(painel.style.left, 10), top: parseInt(painel.style.top, 10) });
    }
    window.addEventListener('mousemove', aoMoverPainel, { signal: ac.signal });
    window.addEventListener('mouseup', aoSoltarPainel, { signal: ac.signal });

    function aoTeclarEscPainel(e) {
      if (e.key === 'Escape') fecharPainel();
    }
    function fecharPainel() {
      esconderInfoHover();
      clearTimeout(buscaTimer);
      painel.remove();
      document.removeEventListener('keydown', aoTeclarEscPainel);
      window.removeEventListener('mousemove', aoMoverPainel);
      window.removeEventListener('mouseup', aoSoltarPainel);
    }

    let generoSelecionado = 'todos';
    let buscaTexto = '';
    let ordenacao = 'recentes';
    let ultimaListaCombinada = [];
    let estatisticasCache = {};
    let elementoTooltip = null;

    function esconderInfoHover() {
      if (elementoTooltip) {
        elementoTooltip.remove();
        elementoTooltip = null;
      }
    }
    function mostrarInfoHover(card, jogo, estat) {
      esconderInfoHover();
      const tip = document.createElement('div');
      tip.className = 'gl-scope gl-hover-info';

      const tipTitulo = document.createElement('div');
      tipTitulo.className = 'gl-hover-info-title';
      tipTitulo.textContent = jogo.nome;
      tip.appendChild(tipTitulo);

      function linhaInfo(label, valor) {
        const row = document.createElement('div');
        row.className = 'gl-hover-info-row';
        const l = document.createElement('span');
        l.textContent = label;
        const v = document.createElement('span');
        v.textContent = valor;
        row.appendChild(l);
        row.appendChild(v);
        tip.appendChild(row);
      }
      if (jogo.genero) linhaInfo('Gênero', jogo.genero);
      linhaInfo('Tempo jogado', formatarDuracao(estat.tempoJogadoMs || 0));
      linhaInfo('Vezes jogado', String(estat.vezesJogado || 0));
      linhaInfo('Última vez', estat.ultimaSessaoEm ? formatarRelativo(estat.ultimaSessaoEm) : 'nunca');

      root.appendChild(tip);
      const rectCard = card.getBoundingClientRect();
      const rectTip = tip.getBoundingClientRect();
      let left = rectCard.right + 10;
      if (left + rectTip.width > window.innerWidth - 8) left = rectCard.left - rectTip.width - 10;
      left = Math.max(8, left);
      let top = rectCard.top;
      if (top + rectTip.height > window.innerHeight - 8) top = window.innerHeight - rectTip.height - 8;
      top = Math.max(8, top);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      elementoTooltip = tip;
    }
    lista.addEventListener('scroll', esconderInfoHover);
    shelf.addEventListener('scroll', esconderInfoHover);

    function popularSidebar(jogos) {
      const generosUnicos = Array.from(
        new Set(jogos.map((j) => (j.genero || '').trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

      if (generoSelecionado !== 'todos' && !generosUnicos.includes(generoSelecionado)) {
        generoSelecionado = 'todos';
      }

      sidebar.innerHTML = '';

      const itemTodos = document.createElement('div');
      itemTodos.className = 'gl-nav-item' + (generoSelecionado === 'todos' ? ' ativo' : '');
      itemTodos.textContent = 'Todos os jogos';
      itemTodos.dataset.genero = 'todos';
      itemTodos.addEventListener('click', () => selecionarGenero('todos'));
      sidebar.appendChild(itemTodos);

      generosUnicos.forEach((g) => {
        const item = document.createElement('div');
        item.className = 'gl-nav-item' + (generoSelecionado === g ? ' ativo' : '');
        item.textContent = g;
        item.dataset.genero = g;
        item.addEventListener('click', () => selecionarGenero(g));
        sidebar.appendChild(item);
      });
    }
    function selecionarGenero(g) {
      generoSelecionado = g;
      sidebar.querySelectorAll('.gl-nav-item').forEach((el) => {
        el.classList.toggle('ativo', el.dataset.genero === g);
      });
      aplicarFiltroErenderizar();
    }

    function criarCardJogo(jogo, permiteRemover, estat) {
      const card = document.createElement('div');
      card.className = 'gl-game-card';
      card.addEventListener('mouseenter', () => mostrarInfoHover(card, jogo, estat || {}));
      card.addEventListener('mouseleave', esconderInfoHover);

      const cover = criarCover(jogo);

      if (permiteRemover) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'gl-remove-btn';
        removeBtn.title = 'Remover';
        removeBtn.setAttribute('aria-label', 'Remover ' + jogo.nome);
        removeBtn.innerHTML = icone('lixeira', 13);
        removeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const temporarios = (await carregarJogosTemporarios()).filter((j) => j.id !== jogo.id);
          salvarJogosTemporarios(temporarios);
          renderizarLista();
        });
        cover.appendChild(removeBtn);
      }

      const acoesCover = document.createElement('div');
      acoesCover.className = 'gl-cover-actions';
      const playBtn = document.createElement('button');
      playBtn.className = 'gl-play-btn';
      playBtn.title = 'Jogar';
      playBtn.setAttribute('aria-label', 'Jogar ' + jogo.nome);
      playBtn.innerHTML = icone('play', 18);
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fecharPainel();
        abrirJogo(jogo, async (novoStatus) => {
          jogo.status = novoStatus;
          jogo.ultimoTeste = new Date().toISOString();
          if (jogo.origem === 'temporario') {
            const temporarios = await carregarJogosTemporarios();
            const idx = temporarios.findIndex((j) => j.id === jogo.id);
            if (idx !== -1) {
              temporarios[idx] = jogo;
              salvarJogosTemporarios(temporarios);
            }
          }
        });
      });
      acoesCover.appendChild(playBtn);
      cover.appendChild(acoesCover);

      const info = document.createElement('div');
      info.className = 'gl-game-info';

      const nome = document.createElement('div');
      nome.className = 'gl-game-name';
      nome.textContent = jogo.nome;
      nome.title = jogo.nome;

      const metaLinha = document.createElement('div');
      metaLinha.className = 'gl-game-meta-linha';
      const partes = [jogo.genero || 'Sem gênero'];
      if (jogo.origem === 'temporario') partes.push('Temporário');
      metaLinha.textContent = partes.join(' · ');

      info.appendChild(nome);
      info.appendChild(metaLinha);

      card.appendChild(cover);
      card.appendChild(info);
      return card;
    }

    function ordenarLista(jogos) {
      if (ordenacao === 'nome') {
        return jogos.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      }
      if (ordenacao === 'jogados') {
        return jogos.slice().sort((a, b) =>
          (estatisticasCache[b.id]?.vezesJogado || 0) - (estatisticasCache[a.id]?.vezesJogado || 0)
        );
      }
      return jogos; // 'recentes' já vem ordenado por adicionadoEm desc
    }

    function popularShelfContinuar() {
      const recentes = ultimaListaCombinada
        .filter((j) => estatisticasCache[j.id]?.ultimaSessaoEm)
        .sort((a, b) => new Date(estatisticasCache[b.id].ultimaSessaoEm) - new Date(estatisticasCache[a.id].ultimaSessaoEm))
        .slice(0, SHELF_MAX_ITENS);

      shelf.innerHTML = '';
      if (!recentes.length) {
        shelfTitulo.style.display = 'none';
        shelf.style.display = 'none';
        return;
      }
      shelfTitulo.style.display = 'flex';
      shelf.style.display = 'flex';
      recentes.forEach((jogo) => {
        shelf.appendChild(criarCardJogo(jogo, jogo.origem === 'temporario', estatisticasCache[jogo.id]));
      });
    }

    function aplicarFiltroErenderizar() {
      esconderInfoHover();
      lista.innerHTML = '';
      let jogosFiltrados = ultimaListaCombinada;
      if (generoSelecionado !== 'todos') {
        jogosFiltrados = jogosFiltrados.filter((j) => (j.genero || '').trim() === generoSelecionado);
      }
      if (buscaTexto) {
        jogosFiltrados = jogosFiltrados.filter((j) => j.nome.toLowerCase().includes(buscaTexto));
      }
      jogosFiltrados = ordenarLista(jogosFiltrados);

      if (!jogosFiltrados.length) {
        lista.innerHTML =
          '<div class="gl-empty">' +
          (buscaTexto
            ? 'Nenhum jogo encontrado pra essa busca.'
            : generoSelecionado !== 'todos'
              ? 'Nenhum jogo nesse gênero.'
              : 'Nenhum jogo disponível.<br>Configure o manifest ou adicione um jogo temporário.') +
          '</div>';
        return;
      }
      jogosFiltrados.forEach((jogo) => {
        lista.appendChild(criarCardJogo(jogo, jogo.origem === 'temporario', estatisticasCache[jogo.id]));
      });
    }

    async function renderizarLista() {
      lista.innerHTML = '<div class="gl-empty">Carregando...</div>';
      shelf.style.display = 'none';
      shelfTitulo.style.display = 'none';

      const [manifest, temporarios, estatisticas] = await Promise.all([
        carregarJogosManifest(false),
        carregarJogosTemporarios(),
        carregarEstatisticas(),
      ]);
      estatisticasCache = estatisticas || {};

      if (manifest.erro) {
        avisoManifest.style.display = 'flex';
        avisoManifest.innerHTML = icone('alerta', 14);
        const avisoTexto = document.createElement('span');
        avisoTexto.textContent = manifest.atualizadoEm
          ? `Não deu pra atualizar o manifest agora (usando cache de ${new Date(manifest.atualizadoEm).toLocaleString()}).`
          : `Não deu pra carregar o manifest: ${manifest.erro}`;
        avisoManifest.appendChild(avisoTexto);
      } else {
        avisoManifest.style.display = 'none';
      }

      const jogosManifest = Array.isArray(manifest.jogos) ? manifest.jogos : [];
      const jogosTemp = Array.isArray(temporarios) ? temporarios : [];

      ultimaListaCombinada = [...jogosManifest, ...jogosTemp].sort((a, b) => {
        const da = a.adicionadoEm ? new Date(a.adicionadoEm).getTime() : 0;
        const db = b.adicionadoEm ? new Date(b.adicionadoEm).getTime() : 0;
        return db - da;
      });

      popularSidebar(ultimaListaCombinada);
      popularShelfContinuar();
      aplicarFiltroErenderizar();
    }

    renderizarLista();
  }

  // ---------- Overlay do jogo ----------
  async function abrirJogo(jogo, aoMudarStatus) {
    if (root.getElementById('gl-overlay')) return;
    injetarEstilos();

    const cfg = await carregarConfigJanela();
    const larguraInicial = Math.min(Math.max(cfg.w, LARGURA_MIN), window.innerWidth - 20);
    const alturaInicial = Math.min(Math.max(cfg.h, ALTURA_MIN), window.innerHeight - 20);
    const xInicial = cfg.x !== null ? Math.min(cfg.x, window.innerWidth - larguraInicial) : (window.innerWidth - larguraInicial) / 2;
    const yInicial = cfg.y !== null ? Math.min(cfg.y, window.innerHeight - alturaInicial) : (window.innerHeight - alturaInicial) / 2;

    const overlay = document.createElement('div');
    overlay.id = 'gl-overlay';
    overlay.className = 'gl-scope gl-overlay gl-no-transition';
    overlay.dataset.hub = '1';
    overlay.setAttribute('data-sang-ui', '');
    overlay.style.left = xInicial + 'px';
    overlay.style.top = yInicial + 'px';
    overlay.style.width = larguraInicial + 'px';
    overlay.style.height = alturaInicial + 'px';
    overlay.style.minWidth = LARGURA_MIN + 'px';
    overlay.style.minHeight = ALTURA_MIN + 'px';
    requestAnimationFrame(() => overlay.classList.remove('gl-no-transition'));

    let maximizado = !!cfg.maximizado;
    let estadoAntesMaximizar = null;
    const tempoInicio = Date.now();

    const barra = document.createElement('div');
    barra.className = 'gl-overlay-bar';

    const status = document.createElement('span');
    status.className = 'gl-overlay-title';
    status.innerHTML = icone('gamepad', 13);
    const statusTexto = document.createElement('span');
    statusTexto.textContent = `${jogo.nome} — Carregando...`;
    status.appendChild(statusTexto);

    const controles = document.createElement('div');
    controles.className = 'gl-overlay-controls';

    function botao(nomeIcone, titulo, extraClasse) {
      const b = document.createElement('button');
      b.className = 'gl-btn gl-btn-icon' + (extraClasse ? ' ' + extraClasse : '');
      b.title = titulo;
      b.setAttribute('aria-label', titulo);
      b.innerHTML = icone(nomeIcone, 14);
      return b;
    }

    const voltarBtn = botao('voltar', 'Voltar pro menu de jogos');
    const mutarBtn = botao('somOn', 'Mutar (clique se quiser ver como silenciar pelo navegador)');
    const novaAbaBtn = botao('linkExterno', 'Abrir em nova aba (fallback manual)');
    const minimizarBtn = botao('minimizar', 'Minimizar');
    const maximizarBtn = botao('maximizar', 'Maximizar');
    const fecharBtn = botao('fechar', 'Fechar', 'gl-btn-danger');

    novaAbaBtn.addEventListener('click', () => window.open(jogo.url, '_blank', 'noopener'));

    controles.appendChild(voltarBtn);
    controles.appendChild(mutarBtn);
    controles.appendChild(novaAbaBtn);
    controles.appendChild(minimizarBtn);
    controles.appendChild(maximizarBtn);
    controles.appendChild(fecharBtn);
    barra.appendChild(status);
    barra.appendChild(controles);

    const corpo = document.createElement('div');
    corpo.className = 'gl-overlay-body';

    const iframe = document.createElement('iframe');
    iframe.setAttribute('allow', 'autoplay; fullscreen');
    corpo.appendChild(iframe);

    const alca = document.createElement('div');
    alca.className = 'gl-resize-handle';
    alca.title = 'Arraste para redimensionar (trava em 16:9). Segure Shift para redimensionar livremente.';
    corpo.appendChild(alca);

    overlay.appendChild(barra);
    overlay.appendChild(corpo);
    root.appendChild(overlay);

    const capa = document.createElement('div');
    capa.style.cssText = 'position: absolute; inset: 0; z-index: 5; display: none;';
    corpo.appendChild(capa);

    let carregou = false;

    iframe.addEventListener('load', () => {
      carregou = true;
      statusTexto.textContent = jogo.nome;
      if (aoMudarStatus) aoMudarStatus('ok');
      const dicaAberta = overlay.querySelector('#gl-dica');
      if (dicaAberta) dicaAberta.style.display = 'none';
    });

    iframe.src = jogo.url;

    // Se demorar pra dar load, mostra dica discreta.
    // NÃO abre nova aba automaticamente — o usuário decide pelo botão 🔗.
    setTimeout(() => {
      if (carregou) return;
      statusTexto.textContent = `${jogo.nome} — se a tela ficar em branco, use 🔗`;
      mostrarDica(
        'Alguns sites bloqueiam ser exibidos dentro de outros (X-Frame-Options/CSP). ' +
        'Se a área abaixo ficar em branco, clique no botão 🔗 do cabeçalho pra abrir em nova aba.'
      );
    }, TIMEOUT_DETECCAO_MS);

    function estadoAtual() {
      return {
        x: parseInt(overlay.style.left, 10),
        y: parseInt(overlay.style.top, 10),
        w: parseInt(overlay.style.width, 10),
        h: parseInt(overlay.style.height, 10),
        maximizado,
      };
    }

    function fecharJogo() {
      salvarConfigJanela(estadoAtual());
      registrarSessao(jogo.id, Date.now() - tempoInicio);
      overlay.remove();
      document.removeEventListener('keydown', aoTeclarEsc);
      window.removeEventListener('mousemove', aoMoverOverlay);
      window.removeEventListener('mouseup', aoSoltarOverlay);
    }

    function aoTeclarEsc(e) {
      if (e.key === 'Escape') fecharJogo();
    }
    document.addEventListener('keydown', aoTeclarEsc, { signal: ac.signal });

    fecharBtn.addEventListener('click', fecharJogo);
    voltarBtn.addEventListener('click', () => {
      fecharJogo();
      abrirPainelJogos();
    });

    let mutado = false;
    let dicaTimeout = null;
    function mostrarDica(texto) {
      let dica = overlay.querySelector('#gl-dica');
      if (!dica) {
        dica = document.createElement('div');
        dica.id = 'gl-dica';
        dica.className = 'gl-dica';
        corpo.appendChild(dica);
      }
      dica.textContent = texto;
      dica.style.display = 'block';
      clearTimeout(dicaTimeout);
      dicaTimeout = setTimeout(() => { dica.style.display = 'none'; }, 8000);
    }
    mutarBtn.addEventListener('click', () => {
      mutado = !mutado;
      let conseguiuMutarDireto = false;
      try {
        const doc = iframe.contentDocument;
        doc.querySelectorAll('audio, video').forEach((m) => { m.muted = mutado; });
        conseguiuMutarDireto = true;
      } catch (e) {
        conseguiuMutarDireto = false;
      }
      mutarBtn.innerHTML = icone(mutado ? 'somOff' : 'somOn', 14);
      if (!conseguiuMutarDireto) {
        mostrarDica(
          mutado
            ? 'O navegador bloqueia mutar áudio de sites de outra origem por script. Clique com o botão direito na aba do navegador → "Silenciar site" (ou clique no ícone de alto-falante na própria aba).'
            : 'Pra reativar o som, use a mesma opção na aba do navegador ("Silenciar site" de novo).'
        );
      }
    });

    let minimizado = false;
    let alturaAntesMinimizar = alturaInicial;
    minimizarBtn.addEventListener('click', () => {
      minimizado = !minimizado;
      if (minimizado) {
        alturaAntesMinimizar = parseInt(overlay.style.height, 10);
        overlay.style.height = barra.offsetHeight + 'px';
        minimizarBtn.innerHTML = icone('maximizar', 14);
        minimizarBtn.title = 'Restaurar';
        minimizarBtn.setAttribute('aria-label', 'Restaurar');
      } else {
        overlay.style.height = alturaAntesMinimizar + 'px';
        minimizarBtn.innerHTML = icone('minimizar', 14);
        minimizarBtn.title = 'Minimizar';
        minimizarBtn.setAttribute('aria-label', 'Minimizar');
      }
    });

    function aplicarMaximizado() {
      if (maximizado) {
        estadoAntesMaximizar = {
          x: overlay.style.left, y: overlay.style.top,
          w: overlay.style.width, h: overlay.style.height,
        };
        overlay.style.left = '0px';
        overlay.style.top = '0px';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.borderRadius = '0';
        maximizarBtn.innerHTML = icone('restaurar', 14);
        maximizarBtn.title = 'Restaurar';
        maximizarBtn.setAttribute('aria-label', 'Restaurar');
      } else if (estadoAntesMaximizar) {
        overlay.style.left = estadoAntesMaximizar.x;
        overlay.style.top = estadoAntesMaximizar.y;
        overlay.style.width = estadoAntesMaximizar.w;
        overlay.style.height = estadoAntesMaximizar.h;
        overlay.style.borderRadius = '';
        maximizarBtn.innerHTML = icone('maximizar', 14);
        maximizarBtn.title = 'Maximizar';
        maximizarBtn.setAttribute('aria-label', 'Maximizar');
      }
    }
    maximizarBtn.addEventListener('click', () => {
      maximizado = !maximizado;
      aplicarMaximizado();
    });
    if (maximizado) aplicarMaximizado();

    let arrastando = false, offX = 0, offY = 0;
    barra.addEventListener('mousedown', (e) => {
      if (maximizado || (e.target !== barra && e.target !== status && !status.contains(e.target))) return;
      arrastando = true;
      overlay.classList.add('gl-no-transition');
      capa.style.display = 'block';
      offX = e.clientX - overlay.offsetLeft;
      offY = e.clientY - overlay.offsetTop;
      e.preventDefault();
    });

    let redimensionando = false, startX = 0, startY = 0, startW = 0, startH = 0;
    alca.addEventListener('mousedown', (e) => {
      if (maximizado) return;
      redimensionando = true;
      overlay.classList.add('gl-no-transition');
      capa.style.display = 'block';
      startX = e.clientX;
      startY = e.clientY;
      startW = overlay.offsetWidth;
      startH = overlay.offsetHeight;
      e.preventDefault();
      e.stopPropagation();
    });

    function aoMoverOverlay(e) {
      if (arrastando) {
        let novoX = e.clientX - offX;
        let novoY = e.clientY - offY;
        novoX = Math.max(0, Math.min(novoX, window.innerWidth - overlay.offsetWidth));
        novoY = Math.max(0, Math.min(novoY, window.innerHeight - overlay.offsetHeight));
        overlay.style.left = novoX + 'px';
        overlay.style.top = novoY + 'px';
      } else if (redimensionando) {
        let novaW = startW + (e.clientX - startX);
        let novaH;
        const livre = e.shiftKey;

        if (livre) {
          novaH = startH + (e.clientY - startY);
        } else {
          const alturaBarra = barra.offsetHeight;
          const alturaCorpo16x9 = novaW / RAZAO_16_9;
          novaH = alturaCorpo16x9 + alturaBarra;
        }

        novaW = Math.max(LARGURA_MIN, Math.min(novaW, window.innerWidth - overlay.offsetLeft));
        novaH = Math.max(ALTURA_MIN, Math.min(novaH, window.innerHeight - overlay.offsetTop));

        if (!livre) {
          const alturaBarra = barra.offsetHeight;
          const larguraMaxima = window.innerWidth - overlay.offsetLeft;
          const alturaMaxima = window.innerHeight - overlay.offsetTop;
          const wPelaAltura = (novaH - alturaBarra) * RAZAO_16_9;
          const hPelaLargura = (novaW / RAZAO_16_9) + alturaBarra;
          if (hPelaLargura <= alturaMaxima) {
            novaH = hPelaLargura;
          } else {
            novaW = Math.min(wPelaAltura, larguraMaxima);
            novaH = alturaMaxima;
          }
        }

        overlay.style.width = novaW + 'px';
        overlay.style.height = novaH + 'px';
        if (!minimizado) alturaAntesMinimizar = novaH;
      }
    }

    function aoSoltarOverlay() {
      if (arrastando || redimensionando) {
        salvarConfigJanela(estadoAtual());
      }
      arrastando = false;
      redimensionando = false;
      overlay.classList.remove('gl-no-transition');
      capa.style.display = 'none';
    }

    window.addEventListener('mousemove', aoMoverOverlay, { signal: ac.signal });
    window.addEventListener('mouseup', aoSoltarOverlay, { signal: ac.signal });
  }

  // ---------- FAB ----------
  async function criarBotaoFlutuante() {
    if (root.getElementById('gl-fab')) return;
    injetarEstilos();

    const btn = document.createElement('button');
    btn.id = 'gl-fab';
    btn.className = 'gl-scope gl-fab';
    btn.title = 'Jogos (segure para arrastar)';
    btn.setAttribute('aria-label', 'Abrir lista de jogos (segure para arrastar)');
    btn.dataset.hub = '1';
    btn.setAttribute('data-sang-ui', '');
    btn.innerHTML = icone('gamepad', 26);

    const posSalva = await carregarPosicaoFab();
    if (posSalva && typeof posSalva.left === 'number' && typeof posSalva.top === 'number') {
      btn.style.left = posSalva.left + 'px';
      btn.style.top = posSalva.top + 'px';
    } else {
      btn.style.bottom = '20px';
      btn.style.right = '20px';
    }

    root.appendChild(btn);

    btn.classList.add('gl-fab-pulsando');
    btn.addEventListener('animationend', () => btn.classList.remove('gl-fab-pulsando'), { signal: ac.signal, once: true });

    let timerSegurar = null;
    let dragLiberado = false;
    let arrastando = false;
    let moveuDurante = false;
    let offX = 0, offY = 0;

    function liberarDrag() {
      dragLiberado = true;
      btn.classList.add('gl-fab-liberado');
      if (navigator.vibrate) navigator.vibrate(15);
    }

    function resetarEstado() {
      clearTimeout(timerSegurar);
      timerSegurar = null;
      dragLiberado = false;
      arrastando = false;
      moveuDurante = false;
      btn.classList.remove('gl-fab-liberado', 'gl-fab-arrastando');
    }

    btn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      moveuDurante = false;
      dragLiberado = false;
      const rect = btn.getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;

      timerSegurar = setTimeout(liberarDrag, FAB_SEGURAR_MS);
      e.preventDefault();
    });

    function aoMoverFab(e) {
      if (!dragLiberado) return;
      if (!arrastando) {
        arrastando = true;
        btn.classList.add('gl-fab-arrastando');
        const rect = btn.getBoundingClientRect();
        btn.style.left = rect.left + 'px';
        btn.style.top = rect.top + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
      }
      moveuDurante = true;
      let novoX = e.clientX - offX;
      let novoY = e.clientY - offY;
      novoX = Math.max(4, Math.min(novoX, window.innerWidth - btn.offsetWidth - 4));
      novoY = Math.max(4, Math.min(novoY, window.innerHeight - btn.offsetHeight - 4));
      btn.style.left = novoX + 'px';
      btn.style.top = novoY + 'px';
    }

    function aoSoltarFab() {
      const foiDrag = dragLiberado && moveuDurante;
      if (foiDrag) {
        salvarPosicaoFab({ left: parseInt(btn.style.left, 10), top: parseInt(btn.style.top, 10) });
      }
      resetarEstado();
    }

    window.addEventListener('mousemove', aoMoverFab, { signal: ac.signal });
    window.addEventListener('mouseup', aoSoltarFab, { signal: ac.signal });

    btn.addEventListener('click', () => {
      if (dragLiberado && moveuDurante) return;
      clearTimeout(timerSegurar);
      abrirPainelJogos();
    });
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Abrir lista de jogos', abrirPainelJogos);
    GM_registerMenuCommand('Atualizar manifest agora', () => carregarJogosManifest(true));
  }

  // ---- Kill ----
  function kill() {
    const steps = [
      ['abort', () => ac.abort()],
      ['dom', () => host?.remove()],
      ['global', () => { delete window._games; }],
    ];
    for (const [name, step] of steps) {
      try { step(); } catch (e) { console.warn('[games] kill step ' + name + ' falhou:', e); }
    }
  }

  function boot() {
    ensureFont();

    host = document.createElement('div');
    host.id = '_games_host';
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483000;';
    document.body.appendChild(host);
    window._hubUI?.markProtected?.(host);
    root = host.attachShadow({ mode: 'open' });

    // ═══════════════════════════════════════════════════════════════
    // Blindagem de eventos — evita que teclas vazem pro site hospedeiro,
    // MAS libera completamente os campos de formulário do nosso UI.
    // ═══════════════════════════════════════════════════════════════
    function ehCampoFormulario(el) {
      if (!el) return false;
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function bloquearSeForaDeCampo(e) {
      if (ehCampoFormulario(e.target)) return;  // campo trabalha normalmente
      if (e.key === 'Escape') return;            // deixa Escape passar
      e.stopPropagation();
    }

    ['keydown', 'keyup', 'keypress', 'input', 'beforeinput',
     'compositionstart', 'compositionupdate', 'compositionend']
      .forEach((t) => host.addEventListener(t, bloquearSeForaDeCampo, { signal: ac.signal }));

    injetarEstilos();
    criarBotaoFlutuante();
    carregarJogosManifest(false);

    api.kill = kill;
  }

  if (document.body) {
    boot();
  } else {
    new MutationObserver((_, obs) => {
      if (document.body) { obs.disconnect(); boot(); }
    }).observe(document.documentElement, { childList: true });
  }
})();
