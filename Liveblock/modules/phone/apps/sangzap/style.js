// modules/phone/apps/sangzap/style.js
// Só o CSS do Sangzap. Nada de lógica.
// Requer: window._phoneCtx (core do telefone) e window._sangzapCtx (common.js).
// Expõe: window._sangzapCtx.style = { css, append(css) } para módulos futuros.
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Sangzap/style] phone ctx ausente'); return; }
    if (!ctx.root) { console.warn('[Sangzap/style] ctx.root ausente'); return; }

    // Idempotência auto-corretiva:
    // se o shadow root foi recriado (kill + remount do telefone), a marca
    // <style data-sz-style> some junto e a gente re-injeta sem duplicar.
    if (ctx.root.querySelector('style[data-sz-style]')) return;

    const S = window._sangzapCtx;
    if (!S) { console.warn('[Sangzap/style] common.js deve carregar antes'); return; }

    const DEFAULT_APP_BG = '#0e1621';

    const SZ_CSS = `
        :root { --sz-accent: #25d366; --sz-accent2: #128c7e; --sz-app-bg: ${DEFAULT_APP_BG}; }
        :root[data-sz-theme="roxo"] { --sz-accent: #a78bfa; --sz-accent2: #7c3aed; }
        :root[data-sz-theme="azul"] { --sz-accent: #38bdf8; --sz-accent2: #0284c7; }
        .ph-screen.sz-hide-bar .ph-app-bar { display: none !important; }

        .sz-app {
            position: absolute; inset: 0;
            display: flex; flex-direction: column;
            min-height: 0; overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #e9ecf5;
            background: var(--sz-app-bg, #0e1621);
            transition: background .22s ease;
        }
        .sz-app.sz-settings-mode { background: #0b0f14; }
        .sz-app.sz-settings-mode .sz-hdr { background: rgba(255,255,255,.02); }

        .sz-conn-bar {
            display: none; padding: 6px 12px;
            background: #b45309; color: #fff;
            font-size: 10.5px; font-weight: 700;
            text-align: center; letter-spacing: .02em;
            animation: szFadeIn .2s ease;
            flex-shrink: 0;
        }
        .sz-conn-bar.on { display: block; }

        .sz-hdr {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 12px;
            background: linear-gradient(180deg, rgba(255,255,255,.03), transparent);
            border-bottom: 1px solid rgba(255,255,255,.05);
            flex-shrink: 0;
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        }
        .sz-hdr-back, .sz-hdr-gear, .sz-hdr-call {
            width: 30px; height: 30px; flex-shrink: 0;
            border-radius: 9px;
            background: rgba(255,255,255,.06);
            border: 1px solid rgba(255,255,255,.12);
            color: #c7cad6; cursor: pointer; padding: 0;
            display: flex; align-items: center; justify-content: center;
            transition: all .18s cubic-bezier(.22,1,.36,1);
            font-size: 14px;
        }
        .sz-hdr-back svg { width: 13px; height: 13px; }
        .sz-hdr-back:hover, .sz-hdr-gear:hover, .sz-hdr-call:hover {
            background: rgba(37,211,102,.16); color: #86efac; border-color: rgba(37,211,102,.4);
            transform: translateY(-1px);
        }
        .sz-hdr-back:active, .sz-hdr-gear:active, .sz-hdr-call:active { transform: translateY(0) scale(.94); }
        .sz-hdr-title {
            flex: 1;
            font-size: 13px; font-weight: 800; letter-spacing: .1em;
            background: linear-gradient(100deg, var(--sz-accent), #22d3ee, var(--sz-accent));
            background-size: 220% auto;
            -webkit-background-clip: text; background-clip: text; color: transparent;
            animation: szBlink 3.2s ease-in-out infinite;
            text-transform: uppercase;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .sz-hdr-title-chat {
            font-size: 13.5px; letter-spacing: 0;
            text-transform: none;
            background: none; color: #e9ecf5;
            -webkit-text-fill-color: currentColor;
            animation: none;
        }

        .sz-tabs {
            display: grid; grid-template-columns: repeat(2, 1fr);
            border-bottom: 1px solid rgba(255,255,255,.05);
            background: rgba(0,0,0,.15);
            flex-shrink: 0;
        }
        .sz-tab {
            padding: 11px 4px; font-size: 11px; font-weight: 700;
            color: #8a90a8; background: transparent; border: none; cursor: pointer;
            font-family: inherit; position: relative;
            transition: color .18s, background .18s;
        }
        .sz-tab:hover { color: #d1d5db; background: rgba(255,255,255,.03); }
        .sz-tab.active { color: var(--sz-accent); }
        .sz-tab.active::after {
            content: ''; position: absolute; bottom: 0; left: 30%; right: 30%;
            height: 2px; background: linear-gradient(90deg, var(--sz-accent), #22d3ee);
            border-radius: 2px 2px 0 0;
            animation: szSlideIn .28s cubic-bezier(.22,1,.36,1);
        }

        .sz-body {
            flex: 1 1 auto; min-height: 0; overflow: hidden;
            display: flex; flex-direction: column; position: relative;
        }

        .sz-skeleton { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
        .sz-skel-row { display: flex; align-items: center; gap: 11px; padding: 4px 0; }
        .sz-skel-av {
            width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
            background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.09), rgba(255,255,255,.04));
            background-size: 200% 100%;
            animation: szSkel 1.4s ease-in-out infinite;
        }
        .sz-skel-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
        .sz-skel-line {
            height: 10px; border-radius: 5px;
            background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.09), rgba(255,255,255,.04));
            background-size: 200% 100%;
            animation: szSkel 1.4s ease-in-out infinite;
        }
        .sz-skel-line.w70 { width: 70%; }
        .sz-skel-line.w55 { width: 55%; }
        .sz-skel-line.w80 { width: 80%; }
        .sz-skel-line.w60 { width: 60%; }
        .sz-skel-line.w40 { width: 40%; }
        .sz-skel-line.w30 { width: 30%; }
        .sz-skel-line.w45 { width: 45%; }
        .sz-skel-line.w35 { width: 35%; }

        .sz-stub {
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 8px; padding: 32px; text-align: center;
        }
        .sz-stub-icon { font-size: 38px; opacity: .35; margin-bottom: 6px; }
        .sz-stub-title { font-size: 15px; font-weight: 800; color: #e9ecf5; }
        .sz-stub-sub { font-size: 11px; color: #6b7280; line-height: 1.5; max-width: 240px; }

        .sz-diag {
            padding: 24px 16px;
            display: flex; flex-direction: column; gap: 10px;
            overflow-y: auto; flex: 1;
            font-size: 12px;
        }
        .sz-diag-icon { font-size: 42px; text-align: center; opacity: .5; }
        .sz-diag-title { font-size: 15px; font-weight: 800; color: #e9ecf5; text-align: center; }
        .sz-diag-sub { font-size: 11px; color: #8a90a8; text-align: center; }
        .sz-diag-base {
            display: block; padding: 8px 10px;
            background: rgba(0,0,0,.35);
            border: 1px solid rgba(255,255,255,.08);
            border-radius: 8px;
            font-family: ui-monospace, Menlo, monospace;
            font-size: 10px; color: #67e8f9;
            word-break: break-all;
        }
        .sz-diag-list {
            display: flex; flex-direction: column; gap: 4px;
            padding: 8px; border-radius: 10px;
            background: rgba(0,0,0,.22);
            border: 1px solid rgba(255,255,255,.06);
        }
        .sz-diag-row {
            display: flex; align-items: center; gap: 8px;
            padding: 5px 8px; border-radius: 6px;
            font-family: ui-monospace, Menlo, monospace;
            font-size: 10.5px;
        }
        .sz-diag-row.ok { color: #86efac; }
        .sz-diag-row.fail { color: #fca5b1; background: rgba(229,72,77,.08); }
        .sz-diag-ico { width: 12px; text-align: center; font-weight: 800; }
        .sz-diag-file { flex: 1; }
        .sz-diag-status { font-size: 9.5px; opacity: .8; }
        .sz-diag-hint {
            font-size: 10px; color: #8a90a8; line-height: 1.6;
            padding: 8px 10px; border-radius: 8px;
            background: rgba(37,211,102,.05);
            border: 1px solid rgba(37,211,102,.15);
        }
        .sz-diag-hint b { color: #86efac; }

        .sz-roster { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .sz-roster-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; flex-shrink: 0; }
        .sz-search-wrap { flex: 1; min-width: 0; }
        .sz-search {
            width: 100%; padding: 9px 14px; border-radius: 20px;
            background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08);
            color: #e9ecf5; font-family: inherit; font-size: 11.5px; outline: none;
            box-sizing: border-box;
            transition: border-color .18s, background .18s, box-shadow .18s;
        }
        .sz-search::placeholder { color: #5c6280; }
        .sz-search:focus { border-color: rgba(37,211,102,.5); background: rgba(255,255,255,.07); box-shadow: 0 0 0 3px rgba(37,211,102,.12); }

        .sz-new-btn {
            width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            border: none; color: #fff; font-size: 18px; font-weight: 700;
            cursor: pointer; line-height: 1;
            box-shadow: 0 4px 12px rgba(37,211,102,.35);
            transition: transform .18s cubic-bezier(.22,1,.36,1), box-shadow .18s;
        }
        .sz-new-btn:hover { transform: scale(1.06); box-shadow: 0 6px 16px rgba(37,211,102,.5); }
        .sz-new-btn:active { transform: scale(.94); }

        .sz-chips {
            display: flex; gap: 6px; padding: 0 12px 8px; flex-shrink: 0;
            overflow-x: auto; scrollbar-width: none;
        }
        .sz-chips::-webkit-scrollbar { display: none; }
        .sz-chip {
            flex-shrink: 0;
            padding: 6px 11px; border-radius: 14px;
            background: rgba(255,255,255,.04);
            border: 1px solid rgba(255,255,255,.08);
            color: #b4bac8; font-family: inherit; font-size: 10.5px; font-weight: 700;
            cursor: pointer;
            display: flex; align-items: center; gap: 5px;
            transition: background .16s, border-color .16s, color .16s;
        }
        .sz-chip:hover { background: rgba(255,255,255,.07); }
        .sz-chip.on {
            background: rgba(37,211,102,.14);
            border-color: rgba(37,211,102,.4);
            color: var(--sz-accent);
        }
        .sz-chip-n {
            display: inline-block;
            min-width: 16px; height: 16px; padding: 0 5px;
            border-radius: 8px;
            background: rgba(255,255,255,.14); color: #e9ecf5;
            font-size: 9px; font-weight: 800; line-height: 16px; text-align: center;
        }
        .sz-chip.on .sz-chip-n { background: var(--sz-accent); color: #06280f; }

        .sz-roster-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 8px 12px; }
        .sz-roster-list::-webkit-scrollbar { width: 4px; }
        .sz-roster-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 2px; }
        .sz-roster-section-title {
            font-size: 9.5px; font-weight: 800; letter-spacing: .12em;
            text-transform: uppercase; color: #6b7280;
            padding: 10px 10px 6px;
        }

        .sz-item {
            display: flex; align-items: center; gap: 11px;
            width: 100%; padding: 10px;
            background: transparent; border: none; cursor: pointer;
            font-family: inherit; color: inherit; text-align: left;
            border-radius: 12px;
            transition: background .16s;
            -webkit-tap-highlight-color: transparent;
        }
        .sz-item:hover { background: rgba(255,255,255,.045); }
        .sz-item:active { background: rgba(255,255,255,.08); }

        .sz-avatar {
            position: relative;
            width: 44px; height: 44px; flex-shrink: 0;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            display: flex; align-items: center; justify-content: center;
            border: 1px solid rgba(255,255,255,.08);
            overflow: hidden;
        }
        .sz-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
        .sz-av-fallback { font-size: 17px; font-weight: 800; color: #fff; }
        .sz-online-dot {
            position: absolute; right: -2px; bottom: -2px;
            width: 12px; height: 12px; border-radius: 50%;
            background: #22c55e; border: 2px solid var(--sz-app-bg, #0e1621);
            box-shadow: 0 0 8px rgba(34,197,94,.7);
            animation: szPulse 2s ease-in-out infinite;
        }
        .sz-avatar-lg { width: 84px; height: 84px; }
        .sz-avatar-sm { width: 30px; height: 30px; }
        .sz-avatar-sm .sz-av-fallback { font-size: 12px; }

        .sz-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .sz-item-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
        .sz-item-title { font-size: 12.5px; font-weight: 700; color: #e9ecf5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sz-item-time { font-size: 9.5px; color: #6b7280; flex-shrink: 0; font-variant-numeric: tabular-nums; }
        .sz-item-bot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .sz-item-preview { font-size: 11px; color: #8a90a8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
        .sz-item-recado { color: #86efac; font-style: italic; }
        .sz-item-typing { color: var(--sz-accent); font-style: italic; }
        .sz-item-badge {
            min-width: 18px; height: 18px; padding: 0 6px;
            border-radius: 9px; background: var(--sz-accent); color: #06280f;
            font-size: 10px; font-weight: 800; line-height: 18px; text-align: center;
            flex-shrink: 0;
            box-shadow: 0 2px 8px rgba(37,211,102,.5);
        }
        .sz-pin, .sz-mute { font-size: 10px; margin-right: 4px; opacity: .75; }

        .sz-empty { padding: 32px 16px; text-align: center; font-size: 11.5px; color: #6b7280; line-height: 1.6; }
        .sz-empty b { color: var(--sz-accent); }

        .sz-ctx-menu {
            position: absolute; z-index: 40;
            background: #1a222d; border: 1px solid rgba(255,255,255,.12);
            border-radius: 12px; padding: 5px;
            box-shadow: 0 12px 32px rgba(0,0,0,.7);
            min-width: 150px;
            animation: szFadeIn .16s ease;
        }
        .sz-ctx-menu.sz-ctx-center { top: 50%; left: 50%; transform: translate(-50%, -50%); }
        .sz-ctx-item {
            display: block; width: 100%;
            padding: 10px 12px;
            background: transparent; border: none;
            color: #e9ecf5; font-family: inherit;
            font-size: 11.5px; text-align: left; cursor: pointer;
            border-radius: 8px;
            transition: background .14s;
        }
        .sz-ctx-item:hover { background: rgba(255,255,255,.06); }
        .sz-ctx-item.danger { color: #fca5b1; }

        .sz-modal {
            position: absolute; inset: 0; z-index: 30;
            background: rgba(0,0,0,.65);
            backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            display: flex; align-items: flex-end; justify-content: center;
            animation: szFadeIn .2s ease;
        }
        .sz-modal-card {
            width: 100%; max-height: 85%;
            background: linear-gradient(180deg, #131a24, #0b1218);
            border-top-left-radius: 18px; border-top-right-radius: 18px;
            border-top: 1px solid rgba(255,255,255,.08);
            display: flex; flex-direction: column;
            padding: 14px 0 0;
            animation: szSlideUp .3s cubic-bezier(.22,1,.36,1);
        }
        .sz-modal-title {
            font-size: 13px; font-weight: 800; color: #e9ecf5;
            padding: 0 16px 10px;
            border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .sz-modal-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
        .sz-modal-list { flex: 1; overflow-y: auto; padding: 8px; }
        .sz-modal-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px 14px 14px; }
        .sz-modal-cancel {
            margin: 8px 14px 14px;
            padding: 11px; border-radius: 10px;
            background: rgba(255,255,255,.05);
            border: 1px solid rgba(255,255,255,.1);
            color: #c7cad6; font-family: inherit;
            font-size: 11.5px; font-weight: 700; cursor: pointer;
            transition: background .16s;
        }
        .sz-modal-cancel:hover { background: rgba(255,255,255,.09); }

        .sz-gpick .sz-check { font-size: 16px; color: #8a90a8; margin-left: 8px; }
        .sz-gpick.selected { background: rgba(37,211,102,.08); }
        .sz-gpick.selected .sz-check { color: var(--sz-accent); }

        .sz-chat-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }

        .sz-chat { display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative; }
        .sz-thread {
            flex: 1 1 auto; min-height: 0; overflow-y: auto;
            padding: 12px 12px 4px;
            display: flex; flex-direction: column; gap: 4px;
            background:
                radial-gradient(circle at 20% 10%, rgba(37,211,102,.04), transparent 45%),
                radial-gradient(circle at 80% 90%, rgba(34,211,238,.04), transparent 45%);
        }
        .sz-thread::-webkit-scrollbar { width: 4px; }
        .sz-thread::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 2px; }

        .sz-row { display: flex; justify-content: flex-start; margin-top: 6px; }
        .sz-row.me { justify-content: flex-end; }
        .sz-row.tight { margin-top: 2px; }
        .sz-row.head { margin-top: 10px; }
        .sz-row.head.tight { margin-top: 2px; }
        .sz-row.flash .sz-bubble { animation: szFlash 1.2s ease; }
        .sz-row.selected .sz-bubble { box-shadow: 0 0 0 2px var(--sz-accent); }

        .sz-bubble {
            position: relative;
            max-width: 78%;
            padding: 7px 10px 5px;
            border-radius: 12px;
            background: rgba(255,255,255,.06);
            border: 1px solid rgba(255,255,255,.05);
            animation: szFadeIn .18s ease;
            word-break: break-word;
        }
        .sz-row.me .sz-bubble {
            background: linear-gradient(135deg, rgba(37,211,102,.24), rgba(18,140,126,.24));
            border-color: rgba(37,211,102,.3);
        }
        .sz-row.head .sz-bubble { border-top-left-radius: 12px; border-top-right-radius: 12px; }
        .sz-row.tail .sz-bubble { border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }
        .sz-row:not(.head) .sz-bubble { border-top-left-radius: 4px; border-top-right-radius: 4px; }
        .sz-row:not(.tail) .sz-bubble { border-bottom-left-radius: 4px; border-bottom-right-radius: 4px; }
        .sz-row.pending .sz-bubble { opacity: .7; }
        .sz-row.failed .sz-bubble { border-color: rgba(229,72,77,.5); }

        .sz-author { font-size: 10px; font-weight: 800; color: var(--sz-accent); margin-bottom: 3px; }
        .sz-body { min-width: 0; }
        .sz-text { font-size: 12.5px; color: #e9ecf5; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
        .sz-deleted { font-size: 11px; font-style: italic; color: #8a90a8; }
        .sz-forwarded { font-size: 9.5px; font-style: italic; color: #86efac; margin-bottom: 3px; display: flex; align-items: center; gap: 4px; }
        .sz-caption { font-size: 12px; color: #e9ecf5; margin-top: 6px; line-height: 1.4; }

        .sz-meta {
            display: flex; align-items: center; justify-content: flex-end; gap: 4px;
            font-size: 9px; color: #8a90a8; margin-top: 2px;
            font-variant-numeric: tabular-nums;
        }
        .sz-row.me .sz-meta { color: rgba(134,239,172,.7); }
        .sz-tick { color: var(--sz-accent); font-weight: 700; }
        .sz-tick.delivered { color: #86efac; }
        .sz-tick.read { color: #67e8f9; }
        .sz-tick.failed { color: #fca5b1; }
        .sz-tick.pending { opacity: .75; }
        .sz-edited { font-size: 8px; opacity: .7; }
        .sz-retry {
            display: block; margin-top: 6px;
            background: rgba(229,72,77,.14); border: 1px solid rgba(229,72,77,.4);
            color: #fca5b1; border-radius: 6px;
            padding: 4px 8px; font-size: 10px; font-weight: 700;
            cursor: pointer; font-family: inherit;
        }
        .sz-retry:hover { background: rgba(229,72,77,.22); }

        .sz-date-sep {
            align-self: center; margin: 12px auto 6px;
            font-size: 9.5px; color: #8a90a8;
            padding: 3px 10px; border-radius: 10px;
            background: rgba(255,255,255,.05);
            border: 1px solid rgba(255,255,255,.06);
            font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
        }

        .sz-quote {
            display: block;
            width: 100%;
            text-align: left;
            padding: 5px 8px; border-left: 2px solid var(--sz-accent);
            background: rgba(0,0,0,.24); border-radius: 6px;
            margin-bottom: 5px;
            border: none; border-left: 2px solid var(--sz-accent);
            font-family: inherit; cursor: pointer;
        }
        .sz-quote-author { font-size: 9.5px; font-weight: 800; color: var(--sz-accent); }
        .sz-quote-body {
            font-size: 10px; color: #b4bac8; margin-top: 1px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        .sz-msg-system, .sz-system {
            align-self: center; margin: 6px auto;
            font-size: 9.5px; color: #8a90a8;
            padding: 3px 10px; border-radius: 10px;
            background: rgba(255,255,255,.05);
            border: 1px solid rgba(255,255,255,.06);
        }

        .sz-reactions { display: flex; gap: 3px; margin-top: 4px; flex-wrap: wrap; }
        .sz-reactions .sz-react {
            flex: none;
            padding: 2px 7px; border-radius: 12px;
            background: rgba(255,255,255,.08);
            border: 1px solid rgba(255,255,255,.12);
            cursor: pointer; font-size: 12px;
            display: flex; align-items: center; gap: 3px;
            transition: background .14s, transform .14s;
        }
        .sz-reactions .sz-react.mine { background: rgba(37,211,102,.2); border-color: rgba(37,211,102,.5); }
        .sz-reactions .sz-react:hover { transform: scale(1.05); }
        .sz-react-n { font-size: 9px; color: #e9ecf5; font-weight: 700; }

        .sz-react-picker {
            position: fixed; z-index: 100;
            display: flex; gap: 4px;
            background: #1a222d; border: 1px solid rgba(255,255,255,.12);
            border-radius: 22px; padding: 6px;
            box-shadow: 0 12px 32px rgba(0,0,0,.7);
            animation: szSlideUp .2s cubic-bezier(.22,1,.36,1);
        }
        .sz-react-picker button {
            width: 34px; height: 34px; border-radius: 50%;
            background: transparent; border: none; cursor: pointer;
            font-size: 18px; line-height: 1;
            transition: background .14s, transform .14s;
        }
        .sz-react-picker button:hover { background: rgba(255,255,255,.08); transform: scale(1.15); }

        .sz-typing {
            font-size: 9.5px; color: var(--sz-accent);
            padding: 0 14px 3px; min-height: 0;
            font-style: italic; flex-shrink: 0;
            opacity: 0; transition: opacity .2s;
        }
        .sz-typing.on { min-height: 15px; opacity: 1; }

        .sz-scroll-btn {
            position: absolute; right: 14px; bottom: 90px;
            width: 34px; height: 34px; border-radius: 50%;
            background: #1a222d; border: 1px solid rgba(255,255,255,.14);
            color: #e9ecf5; font-size: 16px;
            cursor: pointer; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 6px 20px rgba(0,0,0,.5);
            opacity: 0; pointer-events: none;
            transition: opacity .2s, transform .2s;
            transform: translateY(6px);
            z-index: 5;
        }
        .sz-scroll-btn.on { opacity: 1; pointer-events: auto; transform: translateY(0); }

        .sz-composer-bar {
            display: none;
            align-items: center; gap: 10px;
            padding: 8px 12px;
            background: rgba(0,0,0,.4);
            border-top: 1px solid rgba(255,255,255,.05);
            flex-shrink: 0;
        }
        .sz-composer-bar.on { display: flex; }
        .sz-bar-ico { font-size: 16px; color: var(--sz-accent); }
        .sz-bar-text { flex: 1; min-width: 0; }
        .sz-bar-title { font-size: 10.5px; font-weight: 800; color: var(--sz-accent); }
        .sz-bar-body {
            font-size: 10.5px; color: #8a90a8; margin-top: 1px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .sz-bar-x {
            background: transparent; border: none; color: #8a90a8;
            font-size: 14px; cursor: pointer; padding: 4px 6px;
            font-family: inherit;
        }
        .sz-bar-x:hover { color: #e9ecf5; }

        .sz-sel-bar {
            display: none;
            align-items: center; gap: 6px;
            padding: 8px 12px;
            background: rgba(37,211,102,.14);
            border-top: 1px solid rgba(37,211,102,.3);
            flex-shrink: 0;
        }
        .sz-sel-bar.on { display: flex; }
        .sz-sel-bar button {
            background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12);
            color: #e9ecf5; font-size: 14px; cursor: pointer;
            width: 32px; height: 32px; border-radius: 9px;
            display: flex; align-items: center; justify-content: center;
            font-family: inherit;
        }
        .sz-sel-bar button:disabled { opacity: .4; cursor: default; }
        .sz-sel-bar button:hover:not(:disabled) { background: rgba(255,255,255,.1); }
        .sz-sel-count { flex: 1; font-size: 12px; font-weight: 800; color: #e9ecf5; }
        .sz-sel-spacer { flex: 1; }

        .sz-input-bar {
            display: flex; align-items: flex-end; gap: 6px;
            padding: 10px;
            background: rgba(0,0,0,.3);
            border-top: 1px solid rgba(255,255,255,.06);
            flex-shrink: 0;
        }
        .sz-attach-btn, .sz-mic-btn {
            width: 34px; height: 34px; flex-shrink: 0;
            border-radius: 50%; border: 1px solid rgba(255,255,255,.12);
            background: rgba(255,255,255,.05); color: #c7cad6;
            font-size: 18px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            line-height: 1; font-family: inherit;
            transition: background .16s, color .16s, transform .16s;
        }
        .sz-attach-btn:hover, .sz-mic-btn:hover { background: rgba(37,211,102,.14); color: #86efac; }
        .sz-mic-btn.rec { background: #e5484d; border-color: #e5484d; color: #fff; animation: szPulse 1.2s ease-in-out infinite; }
        .sz-mic-btn.cancel { background: #6b7280; border-color: #6b7280; color: #fff; }
        .sz-mic-btn.locked { background: var(--sz-accent); border-color: var(--sz-accent); color: #06280f; }
        .sz-mic-btn.paused { background: #b45309; border-color: #b45309; color: #fff; }

        .sz-input {
            flex: 1; min-width: 0;
            padding: 9px 14px;
            border-radius: 20px;
            background: rgba(255,255,255,.06);
            border: 1px solid rgba(255,255,255,.1);
            color: #e9ecf5; font-family: inherit; font-size: 12.5px; outline: none;
            resize: none; max-height: 120px;
            line-height: 1.4;
            transition: border-color .16s, background .16s, box-shadow .16s;
            overflow-y: auto;
        }
        .sz-input::placeholder { color: #5c6280; }
        .sz-input:focus { border-color: rgba(37,211,102,.5); background: rgba(255,255,255,.08); box-shadow: 0 0 0 3px rgba(37,211,102,.12); }

        .sz-send-btn {
            width: 36px; height: 36px; flex-shrink: 0;
            border-radius: 50%; border: none;
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            color: #fff; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 12px rgba(37,211,102,.35);
            transition: transform .16s, box-shadow .16s;
        }
        .sz-send-btn:hover { transform: scale(1.06); box-shadow: 0 6px 16px rgba(37,211,102,.5); }
        .sz-send-btn:active { transform: scale(.92); }

        .sz-emoji-picker { display: none; }
        .sz-emoji-picker.on { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 12px; background: rgba(0,0,0,.35); border-top: 1px solid rgba(255,255,255,.06); }
        .sz-emoji-picker button {
            width: 30px; height: 30px; border-radius: 8px;
            background: transparent; border: none; cursor: pointer;
            font-size: 16px; line-height: 1;
        }
        .sz-emoji-picker button:hover { background: rgba(255,255,255,.08); }

        .sz-mention-pop {
            position: absolute; left: 10px; right: 10px; bottom: 100%;
            max-height: 180px; overflow-y: auto;
            background: #1a222d; border: 1px solid rgba(255,255,255,.12);
            border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.7);
            display: none; z-index: 6;
        }
        .sz-mention-pop.on { display: block; }
        .sz-mention-pop button {
            display: block; width: 100%;
            padding: 9px 12px;
            background: transparent; border: none;
            color: #e9ecf5; font-family: inherit;
            font-size: 12px; text-align: left; cursor: pointer;
            border-radius: 8px;
        }
        .sz-mention-pop button:hover { background: rgba(255,255,255,.06); }

        .sz-audio { display: flex; align-items: center; gap: 8px; padding: 2px; }
        .sz-audio-container { min-width: 180px; }
        .sz-audio-play {
            width: 32px; height: 32px; flex-shrink: 0;
            border-radius: 50%; border: none;
            background: rgba(255,255,255,.14); color: #e9ecf5;
            cursor: pointer; line-height: 1;
            display: flex; align-items: center; justify-content: center;
        }
        .sz-audio-play svg { width: 14px; height: 14px; }
        .sz-row.me .sz-audio-play { background: rgba(37,211,102,.4); color: #06280f; }
        .sz-audio-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .sz-audio-wave {
            position: relative; display: flex; align-items: center; gap: 1px;
            height: 24px; cursor: pointer;
        }
        .sz-bar {
            flex: 1; min-width: 2px;
            background: rgba(255,255,255,.28);
            border-radius: 1px;
            transition: background .12s;
        }
        .sz-bar.played { background: #86efac; }
        .sz-row.me .sz-bar { background: rgba(255,255,255,.35); }
        .sz-row.me .sz-bar.played { background: #fff; }
        .sz-audio-cursor {
            position: absolute; top: -2px; bottom: -2px;
            width: 2px; background: var(--sz-accent);
            border-radius: 1px; pointer-events: none;
            transition: left .08s linear;
        }
        .sz-audio-meta {
            display: flex; align-items: center; justify-content: space-between; gap: 6px;
        }
        .sz-audio-time { font-size: 9px; color: #8a90a8; font-variant-numeric: tabular-nums; }
        .sz-audio-speed {
            background: transparent; border: none; color: #8a90a8;
            font-size: 9px; font-weight: 800; cursor: pointer;
            padding: 0 4px; font-family: inherit;
        }
        .sz-audio-speed:hover { color: var(--sz-accent); }

        .sz-image-wrap { cursor: pointer; border-radius: 10px; overflow: hidden; }
        .sz-image-wrap img { display: block; max-width: 100%; max-height: 300px; border-radius: 10px; }
        .sz-video-wrap video { display: block; max-width: 100%; max-height: 300px; border-radius: 10px; background: #000; }

        .sz-doc {
            display: flex; align-items: center; gap: 10px;
            width: 100%; padding: 8px;
            background: rgba(255,255,255,.04);
            border: 1px solid rgba(255,255,255,.08);
            border-radius: 10px;
            cursor: pointer; font-family: inherit;
            text-align: left;
        }
        .sz-doc:hover { background: rgba(255,255,255,.08); }
        .sz-doc-ico { font-size: 22px; flex-shrink: 0; }
        .sz-doc-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .sz-doc-name { font-size: 11.5px; font-weight: 700; color: #e9ecf5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sz-doc-size { font-size: 9.5px; color: #8a90a8; }

        .sz-loc {
            display: block; width: 100%;
            padding: 0; border: none; background: transparent;
            border-radius: 10px; overflow: hidden;
            cursor: pointer; font-family: inherit; text-align: left;
        }
        .sz-loc-img { display: block; width: 100%; height: 130px; background: rgba(255,255,255,.04); overflow: hidden; }
        .sz-loc-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .sz-loc-place { font-size: 11.5px; font-weight: 700; color: #e9ecf5; margin-top: 6px; }
        .sz-loc-coords { font-size: 9.5px; color: #8a90a8; display: block; margin-top: 2px; }

        .sz-contact {
            display: flex; align-items: center; gap: 10px;
            width: 100%; padding: 8px;
            background: rgba(255,255,255,.04);
            border: 1px solid rgba(255,255,255,.08);
            border-radius: 10px;
            cursor: pointer; font-family: inherit;
            text-align: left;
        }
        .sz-contact:hover { background: rgba(255,255,255,.08); }
        .sz-contact-av {
            width: 36px; height: 36px; border-radius: 50%;
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            display: flex; align-items: center; justify-content: center;
            font-size: 14px; font-weight: 800; color: #fff;
            flex-shrink: 0;
        }
        .sz-contact-info { flex: 1; min-width: 0; }
        .sz-contact-name { font-size: 11.5px; font-weight: 700; color: #e9ecf5; }
        .sz-contact-num { font-size: 10px; color: #8a90a8; margin-top: 2px; }

        .sz-attach-sheet {
            position: absolute; left: 0; right: 0; bottom: 0; z-index: 25;
            background: linear-gradient(180deg, #131a24, #0b1218);
            border-top-left-radius: 18px; border-top-right-radius: 18px;
            border-top: 1px solid rgba(255,255,255,.08);
            padding: 14px 14px 18px;
            display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
            animation: szSlideUp .24s cubic-bezier(.22,1,.36,1);
        }
        .sz-attach-sheet button {
            padding: 14px 12px; border-radius: 12px;
            background: rgba(255,255,255,.05);
            border: 1px solid rgba(255,255,255,.1);
            color: #e9ecf5; font-family: inherit;
            font-size: 11.5px; font-weight: 700;
            cursor: pointer;
            display: flex; align-items: center; gap: 8px;
            transition: background .14s;
        }
        .sz-attach-sheet button:hover { background: rgba(37,211,102,.14); }
        .sz-attach-sheet button span { font-size: 18px; }
        .sz-attach-cancel { grid-column: 1 / -1; justify-content: center; }

        .sz-media-preview {
            position: absolute; inset: 0; z-index: 26;
            background: rgba(0,0,0,.85);
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            display: flex; flex-direction: column;
            animation: szFadeIn .2s ease;
        }
        .sz-media-preview-top { padding: 10px 12px; display: flex; justify-content: flex-end; }
        .sz-media-close {
            width: 34px; height: 34px; border-radius: 50%;
            background: rgba(255,255,255,.1); border: none; color: #fff;
            font-size: 16px; cursor: pointer; font-family: inherit;
        }
        .sz-media-preview-body {
            flex: 1; min-height: 0;
            display: flex; align-items: center; justify-content: center;
            padding: 8px;
        }
        .sz-media-preview-body img,
        .sz-media-preview-body video {
            max-width: 100%; max-height: 100%; border-radius: 10px;
            object-fit: contain;
        }
        .sz-doc-big {
            font-size: 48px; text-align: center; color: #e9ecf5;
            display: flex; flex-direction: column; align-items: center; gap: 10px;
        }
        .sz-doc-big div { font-size: 14px; font-weight: 700; }
        .sz-media-preview-bottom { display: flex; gap: 8px; padding: 12px; background: rgba(0,0,0,.5); }
        .sz-media-caption {
            flex: 1;
            padding: 10px 14px; border-radius: 20px;
            background: rgba(255,255,255,.08);
            border: 1px solid rgba(255,255,255,.12);
            color: #e9ecf5; font-family: inherit; font-size: 12px; outline: none;
        }
        .sz-media-caption::placeholder { color: #6b7280; }
        .sz-media-send {
            padding: 10px 20px; border-radius: 20px;
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            border: none; color: #fff;
            font-family: inherit; font-size: 12px; font-weight: 800;
            cursor: pointer;
            box-shadow: 0 6px 16px rgba(37,211,102,.4);
        }

        .sz-lightbox {
            position: fixed; inset: 0; z-index: 200;
            background: rgba(0,0,0,.92);
            display: flex; align-items: center; justify-content: center;
            animation: szFadeIn .2s ease;
            cursor: zoom-out;
        }
        .sz-lightbox img {
            max-width: 100%; max-height: 100%; object-fit: contain;
            transition: transform .3s cubic-bezier(.22,1,.36,1);
        }
        .sz-lightbox.zoomed img { transform: scale(1.8); cursor: zoom-in; }
        .sz-lightbox video { max-width: 100%; max-height: 100%; }
        .sz-lb-close, .sz-lb-save {
            position: absolute; top: 16px;
            width: 38px; height: 38px; border-radius: 50%;
            background: rgba(255,255,255,.14); border: none; color: #fff;
            font-size: 16px; cursor: pointer;
            font-family: inherit;
        }
        .sz-lb-close { right: 16px; }
        .sz-lb-save { right: 62px; }

        .sz-pick-contact {
            position: absolute; inset: 0; z-index: 27;
            background: rgba(0,0,0,.65);
            backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            display: flex; align-items: flex-end; justify-content: center;
        }
        .sz-pick-contact-card {
            width: 100%; max-height: 80%;
            background: linear-gradient(180deg, #131a24, #0b1218);
            border-top-left-radius: 18px; border-top-right-radius: 18px;
            display: flex; flex-direction: column;
            padding: 14px 0 0;
        }
        .sz-pick-contact-title {
            font-size: 13px; font-weight: 800; color: #e9ecf5;
            padding: 0 16px 10px;
            border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .sz-pick-contact-list { flex: 1; overflow-y: auto; padding: 8px; }

        .sz-settings { padding: 16px 14px 22px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; flex: 1; min-height: 0; }
        .sz-profile-loading { padding: 32px; text-align: center; color: #6b7280; font-size: 11px; }
        .sz-settings-hero { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px 0; }
        .sz-settings-num { font-size: 11px; color: var(--sz-accent); letter-spacing: .08em; font-variant-numeric: tabular-nums; }
        .sz-section { display: flex; flex-direction: column; gap: 6px; }
        .sz-section-title {
            font-size: 9px; font-weight: 800; letter-spacing: .12em;
            text-transform: uppercase; color: #8a90a8;
            padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .sz-input {
            width: 100%; padding: 10px 12px;
            background: rgba(255,255,255,.05);
            border: 1px solid rgba(255,255,255,.1);
            border-radius: 10px; color: #e9ecf5;
            font-family: inherit; font-size: 12px; outline: none;
            box-sizing: border-box;
            transition: border-color .16s, background .16s, box-shadow .16s;
        }
        .sz-textarea { min-height: 60px; resize: vertical; font-family: inherit; }
        .sz-field-hint { font-size: 9px; color: #6b7280; }
        .sz-profile-photo-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .sz-btn {
            padding: 10px 14px; border-radius: 10px;
            background: rgba(255,255,255,.06);
            border: 1px solid rgba(255,255,255,.12);
            color: #e9ecf5; font-family: inherit;
            font-size: 11.5px; font-weight: 700; cursor: pointer;
            transition: all .18s cubic-bezier(.22,1,.36,1);
            text-align: center;
        }
        .sz-btn:hover { background: rgba(255,255,255,.1); transform: translateY(-1px); }
        .sz-btn:active { transform: translateY(0) scale(.98); }
        .sz-btn-primary {
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            border-color: transparent; color: #fff;
            box-shadow: 0 6px 16px rgba(37,211,102,.3);
        }
        .sz-btn.ghost { background: transparent; }
        .sz-profile-foot { text-align: center; font-size: 9px; color: #6b7280; padding-top: 6px; }

        .sz-option-row { display: flex; flex-direction: column; gap: 6px; }
        .sz-option-label { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #a8aec4; }
        .sz-radio-group {
            display: grid; grid-template-columns: repeat(3, 1fr);
            gap: 5px; background: rgba(0,0,0,.22);
            border: 1px solid rgba(255,255,255,.06);
            border-radius: 10px; padding: 3px;
        }
        .sz-radio {
            padding: 7px 4px; border-radius: 7px;
            background: transparent; border: none;
            color: #8a90a8; font-family: inherit;
            font-size: 10px; font-weight: 800;
            letter-spacing: .04em; text-transform: uppercase;
            cursor: pointer; transition: all .18s cubic-bezier(.22,1,.36,1);
        }
        .sz-radio.active {
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            color: #0b0b10;
        }

        .sz-toggle-row { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
        .sz-toggle-text { flex: 1; min-width: 0; }
        .sz-toggle-label { font-size: 11.5px; font-weight: 700; color: #e8eaf4; }
        .sz-toggle-sub { font-size: 9px; color: #6b7280; margin-top: 2px; }
        .sz-switch { position: relative; display: inline-block; width: 36px; height: 20px; flex-shrink: 0; cursor: pointer; }
        .sz-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .sz-switch-track {
            position: absolute; inset: 0; border-radius: 20px;
            background: rgba(255,255,255,.08);
            border: 1px solid rgba(255,255,255,.12);
            transition: background .24s, border-color .24s;
        }
        .sz-switch-track::before {
            content: ''; position: absolute;
            width: 14px; height: 14px; left: 2px; top: 2px;
            background: #8a90a8; border-radius: 50%;
            transition: transform .24s cubic-bezier(.22,1,.36,1), background .24s;
        }
        .sz-switch input:checked + .sz-switch-track {
            background: linear-gradient(120deg, rgba(52,211,153,.42), rgba(34,211,238,.42));
            border-color: rgba(52,211,153,.6);
        }
        .sz-switch input:checked + .sz-switch-track::before {
            background: linear-gradient(135deg, #34d399, #22d3ee);
            transform: translateX(16px);
        }

        .sz-stories-tab { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .sz-stories-head {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 14px 8px; flex-shrink: 0;
        }
        .sz-stories-title { font-size: 14px; font-weight: 800; color: #e9ecf5; }
        .sz-stories-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 8px 16px; }

        .sz-ring {
            display: flex; align-items: center; gap: 11px;
            width: 100%; padding: 10px;
            background: transparent; border: none; cursor: pointer;
            font-family: inherit; color: inherit; text-align: left;
            border-radius: 12px;
            transition: background .14s;
        }
        .sz-ring:hover { background: rgba(255,255,255,.04); }
        .sz-ring-av {
            position: relative;
            width: 52px; height: 52px; flex-shrink: 0;
            border-radius: 50%; padding: 2px;
            background: linear-gradient(135deg, var(--sz-accent), #22d3ee);
            display: flex; align-items: center; justify-content: center;
        }
        .sz-ring.seen .sz-ring-av { background: rgba(255,255,255,.14); }
        .sz-ring.mine .sz-ring-av { background: linear-gradient(135deg, #a78bfa, #22d3ee); }
        .sz-ring-av img,
        .sz-ring-av .sz-av-fallback {
            width: 100%; height: 100%; border-radius: 50%;
            background: #0e1621;
            display: flex; align-items: center; justify-content: center;
            font-size: 17px; font-weight: 800; color: #fff;
            object-fit: cover;
        }
        .sz-ring-av .sz-av-fallback { border: 2px solid #0e1621; }
        .sz-ring-info { flex: 1; min-width: 0; }
        .sz-ring-name { font-size: 12.5px; font-weight: 700; color: #e9ecf5; }
        .sz-ring-sub { font-size: 10px; color: #8a90a8; margin-top: 2px; }
        .sz-ring.unseen .sz-ring-sub { color: var(--sz-accent); font-weight: 700; }

        .sz-viewer {
            position: absolute; inset: 0; z-index: 100;
            background: rgba(0,0,0,.96);
            display: flex; align-items: stretch; justify-content: center;
            animation: szFadeIn .22s ease;
            transition: transform .22s cubic-bezier(.22,1,.36,1), opacity .22s;
            touch-action: none;
        }
        .sz-viewer-inner {
            position: relative; width: 100%; height: 100%;
            display: flex; flex-direction: column;
        }
        .sz-viewer-bars {
            display: flex; gap: 3px; padding: 8px 10px 4px; flex-shrink: 0;
        }
        .sz-viewer-bar {
            flex: 1; height: 3px; border-radius: 2px;
            background: rgba(255,255,255,.28);
            overflow: hidden;
        }
        .sz-viewer-bar-fill {
            display: block; width: 100%; height: 100%;
            background: #fff;
            transform-origin: left center;
        }
        .sz-viewer-head {
            display: flex; align-items: center; gap: 10px;
            padding: 6px 12px 10px; flex-shrink: 0;
        }
        .sz-viewer-head-info { flex: 1; min-width: 0; }
        .sz-viewer-head-name { font-size: 12px; font-weight: 800; color: #fff; }
        .sz-viewer-head-time { font-size: 10px; color: rgba(255,255,255,.7); margin-top: 1px; }
        .sz-viewer-viewers, .sz-viewer-del, .sz-viewer-close {
            background: rgba(255,255,255,.14); border: none;
            color: #fff; font-family: inherit; cursor: pointer;
            height: 30px; padding: 0 10px; border-radius: 15px;
            font-size: 11px; font-weight: 700;
            display: flex; align-items: center; justify-content: center;
            transition: background .14s;
        }
        .sz-viewer-close { width: 30px; padding: 0; font-size: 15px; }
        .sz-viewer-viewers:hover, .sz-viewer-del:hover, .sz-viewer-close:hover { background: rgba(255,255,255,.24); }

        .sz-viewer-body {
            flex: 1; min-height: 0;
            display: flex; align-items: center; justify-content: center;
            position: relative;
            padding: 8px 12px;
        }
        .sz-viewer-img {
            max-width: 100%; max-height: 100%;
            object-fit: contain;
            border-radius: 12px;
        }
        .sz-viewer-caption {
            position: absolute; bottom: 16px; left: 20px; right: 20px;
            text-align: center; color: #fff;
            font-size: 13px; line-height: 1.5;
            background: rgba(0,0,0,.45);
            padding: 8px 14px; border-radius: 10px;
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        }

        .sz-viewer-reactions {
            display: flex; gap: 6px; justify-content: center;
            padding: 6px 12px 8px; flex-shrink: 0;
        }
        .sz-viewer-react {
            width: 40px; height: 40px; border-radius: 50%;
            background: rgba(255,255,255,.14); border: none;
            font-size: 20px; cursor: pointer; line-height: 1;
            transition: background .14s, transform .14s;
        }
        .sz-viewer-react:hover { background: rgba(255,255,255,.24); transform: scale(1.1); }
        .sz-viewer-react.mine {
            background: rgba(37,211,102,.4);
            box-shadow: 0 0 0 2px rgba(37,211,102,.6);
        }

        .sz-viewer-reply {
            display: flex; gap: 8px; padding: 8px 12px 14px;
            background: rgba(0,0,0,.5);
            flex-shrink: 0;
        }
        .sz-viewer-reply-input {
            flex: 1; padding: 10px 16px;
            border-radius: 22px;
            background: rgba(255,255,255,.14);
            border: 1px solid rgba(255,255,255,.2);
            color: #fff; font-family: inherit; font-size: 12.5px; outline: none;
        }
        .sz-viewer-reply-input::placeholder { color: rgba(255,255,255,.6); }
        .sz-viewer-reply-send {
            width: 40px; height: 40px; border-radius: 50%;
            background: linear-gradient(135deg, var(--sz-accent), var(--sz-accent2));
            border: none; color: #fff; font-size: 16px;
            cursor: pointer; font-family: inherit;
        }

        .sz-viewer-tap {
            position: absolute; top: 60px; bottom: 130px;
            width: 30%; z-index: 2; cursor: pointer;
        }
        .sz-viewer-tap.left { left: 0; }
        .sz-viewer-tap.right { right: 0; }

        .sz-viewers-modal {
            position: absolute; inset: 0; z-index: 110;
            background: rgba(0,0,0,.6);
            backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            display: flex; align-items: flex-end; justify-content: center;
            animation: szFadeIn .2s ease;
        }
        .sz-viewers-card {
            width: 100%; max-height: 70%;
            background: #131a24;
            border-top-left-radius: 18px; border-top-right-radius: 18px;
            padding: 14px 0 0;
            display: flex; flex-direction: column;
        }
        .sz-viewers-title {
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 18px 10px;
            border-bottom: 1px solid rgba(255,255,255,.06);
            font-size: 13px; font-weight: 800; color: #e9ecf5;
        }
        .sz-viewers-count {
            background: rgba(37,211,102,.2); color: var(--sz-accent);
            font-size: 10px; font-weight: 800;
            padding: 2px 8px; border-radius: 8px;
        }
        .sz-viewers-list { flex: 1; overflow-y: auto; padding: 8px; }
        .sz-viewers-item {
            display: flex; align-items: center; gap: 10px;
            padding: 8px 10px; border-radius: 10px;
        }
        .sz-viewers-item:hover { background: rgba(255,255,255,.04); }
        .sz-viewers-name { font-size: 12px; font-weight: 700; color: #e9ecf5; }

        @keyframes szSlideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes szFadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes szSlideIn { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes szBlink   { 0%,100% { background-position: 0% center; } 50% { background-position: 100% center; } }
        @keyframes szPulse   { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
        @keyframes szSkel    { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes szFlash   { 0%,100% { background-color: transparent; } 40% { background-color: rgba(37,211,102,.24); } }

        @media (prefers-reduced-motion: reduce) {
            .sz-hdr-title, .sz-chat-mic.rec, .sz-online-dot, .sz-mic-btn.rec, .sz-skel-av, .sz-skel-line { animation: none !important; }
            .sz-item, .sz-tab, .sz-hdr-back, .sz-hdr-gear, .sz-hdr-call, .sz-new-btn, .sz-send-btn, .sz-attach-btn, .sz-mic-btn, .sz-btn, .sz-ctx-item, .sz-chip { transition-duration: .01ms !important; }
        }
    `;

    const st = document.createElement('style');
    st.setAttribute('data-sz-style', '1');
    st.textContent = SZ_CSS;
    ctx.root.appendChild(st);

    // API para módulos futuros (chat-extras.js, polls.js, etc.) que precisem
    // injetar CSS próprio no mesmo shadow root do telefone.
    // Ex: S.style.append('.sz-polls { display: flex; }');
    S.style = {
        css: SZ_CSS,
        append(css) {
            if (!css) return;
            try {
                const s = document.createElement('style');
                s.textContent = css;
                ctx.root.appendChild(s);
            } catch(e) { console.warn('[Sangzap/style] append:', e); }
        }
    };
})();
