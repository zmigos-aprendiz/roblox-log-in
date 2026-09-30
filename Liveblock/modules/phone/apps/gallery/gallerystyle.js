// modules/phone/apps/gallery/gallerystyle.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[GalleryStyle] phone ctx ausente'); return; }
    if (window._galleryStyle) return;

    const EASE_SOFT = 'cubic-bezier(.22,1,.36,1)';
    const HIDE_BAR_CLASS = 'sz-hide-bar';

    const _installed = new WeakSet();

    function install() {
        const root = ctx.root || (window._phone?.core?.getShadow?.());
        if (!root) return;
        if (_installed.has(root)) return;
        _installed.add(root);

        ctx.appendStyle(`
            .ph-screen.${HIDE_BAR_CLASS} .ph-app-bar { display: none !important; }

            .gx-app {
                position: absolute; inset: 0;
                display: flex; flex-direction: column;
                min-height: 0; overflow: hidden;
                background: #0e1621;
                color: #e9ecf5;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }

            @keyframes gxBodyEnter {
                from { opacity: 0; transform: translateY(6px); }
                to   { opacity: 1; transform: none; }
            }
            .gx-body-enter { animation: gxBodyEnter .26s ${EASE_SOFT}; }

            .gx-topbar {
                display: flex; align-items: center; gap: 8px;
                padding: 8px 10px;
                background: linear-gradient(180deg, rgba(255,255,255,.03), transparent);
                border-bottom: 1px solid rgba(255,255,255,.05);
                flex-shrink: 0;
            }
            .gx-iconbtn {
                width: 30px; height: 30px; flex-shrink: 0;
                border-radius: 10px;
                background: rgba(255,255,255,.05);
                border: 1px solid rgba(255,255,255,.08);
                color: #c7cad6; cursor: pointer; padding: 0;
                display: flex; align-items: center; justify-content: center;
                font-size: 18px; line-height: 1; font-family: inherit;
                transition: background .16s ease, border-color .16s ease, color .16s ease, transform .16s ${EASE_SOFT};
            }
            .gx-iconbtn:hover { background: rgba(244,114,182,.14); color: #f9a8d4; border-color: rgba(244,114,182,.4); }
            .gx-iconbtn:active { transform: scale(.92); }
            .gx-iconbtn.danger:hover { background: rgba(251,113,133,.14); color: #fca5b1; border-color: rgba(251,113,133,.4); }
            .gx-back { font-size: 22px; }
            .gx-title {
                flex: 1; min-width: 0;
                font-size: 13px; font-weight: 800; letter-spacing: .02em;
                color: #e9ecf5;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                transition: opacity .2s ease;
            }
            .gx-select svg, .gx-more svg { pointer-events: none; }

            .gx-tabs {
                display: grid; grid-template-columns: 1fr 1fr;
                padding: 6px 12px 8px; gap: 6px;
                flex-shrink: 0;
            }
            .gx-tab {
                padding: 8px;
                border-radius: 11px;
                background: transparent; border: none;
                color: #8a90a8;
                font-family: inherit; font-size: 11.5px; font-weight: 800;
                letter-spacing: .02em;
                cursor: pointer;
                transition: background .2s ease, color .2s ease;
            }
            .gx-tab:hover { background: rgba(255,255,255,.04); color: #b4bac8; }
            .gx-tab.on { background: rgba(244,114,182,.14); color: #f9a8d4; }

            .gx-body {
                flex: 1 1 auto; min-height: 0; overflow-y: auto;
                overscroll-behavior: contain;
                padding-bottom: 12px;
                scrollbar-width: none; -ms-overflow-style: none;
                will-change: opacity;
            }
            .gx-body::-webkit-scrollbar { width: 0; height: 0; display: none; }

            .gx-loading { display: flex; align-items: center; justify-content: center; padding: 60px 20px; }
            .gx-spinner {
                width: 26px; height: 26px;
                border-radius: 50%;
                border: 3px solid rgba(255,255,255,.12);
                border-top-color: #f9a8d4;
                animation: gxSpin .8s linear infinite;
            }
            @keyframes gxSpin { to { transform: rotate(360deg); } }

            .gx-section { padding: 0 2px; }
            .gx-section-title {
                font-size: 11px; font-weight: 800;
                color: #8a90a8;
                text-transform: uppercase; letter-spacing: .1em;
                padding: 14px 12px 8px;
                display: flex; align-items: baseline; gap: 6px;
                margin: 0;
            }
            .gx-section-count {
                font-size: 9.5px; font-weight: 800;
                background: rgba(255,255,255,.06);
                border-radius: 8px;
                padding: 1px 6px;
                color: #b4bac8;
                letter-spacing: 0;
            }

            .gx-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 3px;
                padding: 0 2px;
            }
            .gx-cell {
                position: relative;
                aspect-ratio: 1;
                overflow: hidden;
                background: #1a222d;
                cursor: pointer;
                border-radius: 6px;
                -webkit-tap-highlight-color: transparent;
                transition: transform .16s ${EASE_SOFT}, box-shadow .16s ease;
            }
            .gx-cell:focus-visible { outline: 2px solid #f9a8d4; outline-offset: -2px; }
            .gx-cell:hover { box-shadow: inset 0 0 0 1px rgba(244,114,182,.25); }
            .gx-cell:active { transform: scale(.98); }
            .gx-cell img, .gx-cell video, .gx-cell-media {
                width: 100%; height: 100%;
                object-fit: cover;
                display: block;
                pointer-events: none;
                background: #000;
            }
            .gx-cell-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #4b5563; }
            .gx-cell-video {
                position: absolute; left: 5px; bottom: 5px;
                display: flex; align-items: center; gap: 3px;
                background: rgba(0,0,0,.6);
                color: #fff;
                padding: 2px 5px;
                border-radius: 6px;
                font-size: 9px; font-weight: 700;
                letter-spacing: .02em;
                font-variant-numeric: tabular-nums;
                z-index: 2;
            }
            .gx-cell-video svg { display: block; }
            .gx-cell-dur { margin-left: 1px; }
            .gx-cell-check {
                position: absolute; top: 5px; right: 5px;
                width: 20px; height: 20px;
                border-radius: 50%;
                background: rgba(255,255,255,.92);
                border: 1.5px solid rgba(255,255,255,.6);
                color: transparent;
                display: none;
                align-items: center; justify-content: center;
                transition: background .18s ease, color .18s ease, transform .18s ${EASE_SOFT};
                z-index: 3;
                transform: scale(.7);
                opacity: 0;
            }
            .gx-app.selection .gx-cell .gx-cell-check { display: flex; transform: scale(1); opacity: 1; }
            .gx-app.selection .gx-cell:not(.selected) .gx-cell-check {
                background: rgba(0,0,0,.4);
                border-color: rgba(255,255,255,.6);
                color: transparent;
            }
            .gx-cell.selected .gx-cell-check { background: #f9a8d4; color: #4c0519; }
            .gx-cell.selected::after {
                content: '';
                position: absolute; inset: 0;
                background: rgba(244,114,182,.22);
                pointer-events: none;
                z-index: 2;
                animation: gxCellSelect .2s ease;
            }
            @keyframes gxCellSelect { from { opacity: 0; } to { opacity: 1; } }

            .gx-albums-stats {
                font-size: 11px; color: #8a90a8;
                padding: 12px 14px 6px;
                letter-spacing: .02em;
            }
            .gx-albums {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
                padding: 6px 12px 12px;
            }
            .gx-album {
                background: #1a222d;
                border: 1px solid rgba(255,255,255,.04);
                border-radius: 16px;
                overflow: hidden;
                cursor: pointer;
                padding: 0;
                text-align: left;
                color: inherit;
                font-family: inherit;
                transition: transform .2s ${EASE_SOFT}, border-color .2s ease, background .2s ease, box-shadow .2s ease;
            }
            .gx-album:hover {
                background: #212b38;
                border-color: rgba(244,114,182,.28);
                transform: translateY(-2px);
                box-shadow: 0 12px 28px rgba(0,0,0,.35);
            }
            .gx-album:active { transform: translateY(-1px) scale(.985); }
            .gx-album-cover {
                aspect-ratio: 1;
                background: #0b1218;
                display: flex; align-items: center; justify-content: center;
                overflow: hidden;
                position: relative;
            }
            .gx-album-cover img, .gx-album-cover video {
                width: 100%; height: 100%; object-fit: cover; display: block;
            }
            .gx-album-empty { font-size: 32px; opacity: .35; }
            .gx-album-lock {
                font-size: 40px;
                background: linear-gradient(135deg, #4c0519, #831843);
                width: 100%; height: 100%;
                display: flex; align-items: center; justify-content: center;
            }
            .gx-album-play {
                position: absolute; right: 8px; bottom: 8px;
                background: rgba(0,0,0,.65); color: #fff;
                padding: 2px 7px; border-radius: 6px;
                font-size: 10px;
            }
            .gx-album-meta { padding: 9px 11px 11px; }
            .gx-album-name {
                font-size: 12px; font-weight: 700; color: #e9ecf5;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .gx-album-count {
                font-size: 10px; color: #8a90a8; margin-top: 3px;
                font-variant-numeric: tabular-nums;
            }
            .gx-album.private .gx-album-name { color: #f9a8d4; }

            .gx-empty {
                padding: 60px 24px 40px;
                text-align: center;
                display: flex; flex-direction: column; align-items: center; gap: 8px;
            }
            .gx-empty-ico { font-size: 48px; opacity: .3; margin-bottom: 4px; }
            .gx-empty-title { font-size: 14px; font-weight: 800; color: #e9ecf5; }
            .gx-empty-sub { font-size: 11.5px; color: #8a90a8; line-height: 1.55; max-width: 260px; }
            .gx-empty-sub b { color: #f9a8d4; }

            .gx-primary, .gx-secondary {
                margin-top: 10px;
                padding: 10px 22px;
                border-radius: 12px;
                font-family: inherit; font-size: 12px; font-weight: 800;
                cursor: pointer;
                transition: transform .16s ${EASE_SOFT}, background .16s ease, box-shadow .16s ease;
            }
            .gx-primary {
                background: linear-gradient(135deg, #f472b6, #ec4899);
                color: #fff; border: none;
                box-shadow: 0 8px 22px rgba(244,114,182,.3);
            }
            .gx-primary:hover { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(244,114,182,.38); }
            .gx-primary:active { transform: translateY(0) scale(.98); }
            .gx-secondary {
                background: rgba(255,255,255,.06);
                color: #c7cad6;
                border: 1px solid rgba(255,255,255,.12);
            }
            .gx-secondary:hover { background: rgba(255,255,255,.1); }

            .gx-private-bar {
                display: flex; align-items: center; justify-content: space-between;
                padding: 10px 14px;
                background: rgba(244,114,182,.08);
                border-bottom: 1px solid rgba(244,114,182,.16);
                font-size: 11px; font-weight: 700; color: #f9a8d4;
            }
            .gx-private-lock {
                background: transparent;
                border: 1px solid rgba(244,114,182,.35);
                color: #f9a8d4;
                padding: 4px 10px; border-radius: 9px;
                font-family: inherit; font-size: 10.5px; font-weight: 800;
                cursor: pointer;
                transition: background .16s ease;
            }
            .gx-private-lock:hover { background: rgba(244,114,182,.15); }

            .gx-selbar {
                display: none;
                align-items: center; justify-content: space-around; gap: 6px;
                padding: 10px 14px;
                background: rgba(10,15,22,.95);
                border-top: 1px solid rgba(255,255,255,.06);
                backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
                flex-shrink: 0;
                transform: translateY(100%);
                transition: transform .24s ${EASE_SOFT};
            }
            .gx-selbar.on {
                display: flex;
                transform: translateY(0);
                animation: gxSelBarIn .24s ${EASE_SOFT};
            }
            @keyframes gxSelBarIn {
                from { transform: translateY(100%); }
                to   { transform: translateY(0); }
            }
            .gx-selbtn {
                flex: 1;
                display: flex; align-items: center; justify-content: center; gap: 6px;
                padding: 9px 12px;
                border-radius: 11px;
                background: rgba(255,255,255,.05);
                border: 1px solid rgba(255,255,255,.08);
                color: #e9ecf5;
                font-family: inherit; font-size: 11.5px; font-weight: 700;
                cursor: pointer;
                transition: background .16s ease, border-color .16s ease, color .16s ease, transform .16s ${EASE_SOFT};
            }
            .gx-selbtn:hover { background: rgba(255,255,255,.1); }
            .gx-selbtn:active { transform: scale(.97); }
            .gx-selbtn.danger { color: #fca5b1; border-color: rgba(251,113,133,.28); }
            .gx-selbtn.danger:hover { background: rgba(251,113,133,.14); }
            .gx-selbtn.ghost { flex: 0 0 auto; color: #8a90a8; }

            .gx-toast {
                position: absolute;
                left: 50%; bottom: 76px;
                transform: translate(-50%, 12px) scale(.96);
                background: #1a222d;
                border: 1px solid rgba(255,255,255,.1);
                color: #e9ecf5;
                font-size: 11.5px; font-weight: 700;
                padding: 9px 12px 9px 14px;
                border-radius: 22px;
                opacity: 0; pointer-events: none;
                transition: opacity .22s ease, transform .28s ${EASE_SOFT};
                display: flex; align-items: center; gap: 10px;
                max-width: 90%;
                box-shadow: 0 16px 36px rgba(0,0,0,.55);
                z-index: 20;
            }
            .gx-toast.on {
                opacity: 1;
                transform: translate(-50%, 0) scale(1);
                pointer-events: auto;
            }
            .gx-toast-action {
                background: rgba(244,114,182,.18);
                border: 1px solid rgba(244,114,182,.4);
                color: #f9a8d4;
                border-radius: 14px;
                padding: 3px 10px;
                font-family: inherit;
                font-size: 10.5px; font-weight: 800;
                cursor: pointer;
                flex-shrink: 0;
                transition: background .16s ease;
            }
            .gx-toast-action:hover { background: rgba(244,114,182,.3); }

            .gx-move-overlay, .gx-menu-overlay {
                position: absolute; inset: 0; z-index: 30;
                background: rgba(0,0,0,.55);
                backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
                display: flex; align-items: flex-end; justify-content: center;
                animation: gxFadeIn .22s ease;
            }
            .gx-move-card, .gx-menu-card {
                width: 100%;
                max-height: 78%;
                background: linear-gradient(180deg, #131a24, #0b1218);
                border-top-left-radius: 22px; border-top-right-radius: 22px;
                border-top: 1px solid rgba(255,255,255,.08);
                display: flex; flex-direction: column;
                padding: 14px 0 16px;
                animation: gxSlideUp .32s ${EASE_SOFT};
                box-shadow: 0 -20px 50px rgba(0,0,0,.4);
            }
            .gx-move-title {
                font-size: 13px; font-weight: 800; color: #e9ecf5;
                padding: 0 18px 12px;
                border-bottom: 1px solid rgba(255,255,255,.05);
            }
            .gx-move-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; }
            .gx-move-item, .gx-menu-item {
                display: flex; align-items: center; gap: 12px;
                width: 100%;
                padding: 11px 14px;
                background: transparent; border: none;
                color: #e9ecf5;
                font-family: inherit; font-size: 12.5px; font-weight: 600;
                text-align: left;
                cursor: pointer;
                border-radius: 11px;
                transition: background .18s ease;
            }
            .gx-move-item:hover, .gx-menu-item:hover { background: rgba(255,255,255,.05); }
            .gx-move-item.disabled, .gx-menu-item.disabled { opacity: .45; cursor: not-allowed; }
            .gx-menu-item.danger { color: #fca5b1; }
            .gx-menu-ico, .gx-move-ico { width: 26px; text-align: center; font-size: 15px; flex-shrink: 0; }
            .gx-menu-label, .gx-move-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .gx-menu-item.danger .gx-menu-ico { color: #fca5b1; }

            .gx-modal-cancel {
                margin: 8px 14px 0;
                padding: 11px;
                border-radius: 12px;
                background: rgba(255,255,255,.05);
                border: 1px solid rgba(255,255,255,.1);
                color: #c7cad6;
                font-family: inherit; font-size: 11.5px; font-weight: 700;
                cursor: pointer;
                transition: background .18s ease;
            }
            .gx-modal-cancel:hover { background: rgba(255,255,255,.09); }

            .gx-pin-overlay {
                position: absolute; inset: 0; z-index: 40;
                background: rgba(0,0,0,.7);
                backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
                display: flex; align-items: center; justify-content: center;
                padding: 20px;
                animation: gxFadeIn .24s ease;
            }
            .gx-pin-card {
                width: 100%; max-width: 300px;
                background: linear-gradient(180deg, #131a24, #0b1218);
                border: 1px solid rgba(255,255,255,.08);
                border-radius: 22px;
                padding: 22px 18px 14px;
                display: flex; flex-direction: column; align-items: center;
                animation: gxSlideUp .34s ${EASE_SOFT};
                box-shadow: 0 24px 60px rgba(0,0,0,.6);
            }
            .gx-pin-icon { font-size: 34px; margin-bottom: 8px; }
            .gx-pin-title { font-size: 14px; font-weight: 800; color: #e9ecf5; letter-spacing: .02em; }
            .gx-pin-sub { font-size: 11px; color: #8a90a8; margin-top: 4px; text-align: center; }
            .gx-pin-dots { display: flex; gap: 12px; margin: 20px 0 8px; }
            .gx-pin-dots span {
                width: 14px; height: 14px;
                border-radius: 50%;
                background: transparent;
                border: 2px solid rgba(255,255,255,.16);
                transition: background .2s ease, border-color .2s ease, transform .2s ${EASE_SOFT}, box-shadow .2s ease;
            }
            .gx-pin-dots span.on {
                background: #f9a8d4;
                border-color: #f9a8d4;
                transform: scale(1.12);
                box-shadow: 0 0 14px rgba(249,168,212,.6);
            }
            .gx-pin-error {
                height: 16px;
                font-size: 11px; color: #fca5b1; font-weight: 700;
                opacity: 0; transition: opacity .18s ease; letter-spacing: .02em;
            }
            .gx-pin-error.on { opacity: 1; }
            .gx-pin-pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 100%; margin-top: 10px; }
            .gx-pin-pad button {
                aspect-ratio: 1.6;
                background: rgba(255,255,255,.05);
                border: 1px solid rgba(255,255,255,.08);
                border-radius: 13px;
                color: #e9ecf5;
                font-family: inherit;
                font-size: 18px; font-weight: 700;
                cursor: pointer;
                transition: background .16s ease, transform .16s ${EASE_SOFT};
            }
            .gx-pin-pad button:hover { background: rgba(255,255,255,.1); }
            .gx-pin-pad button:active { transform: scale(.94); }
            .gx-pin-pad .gx-pin-ok { background: linear-gradient(135deg, #f472b6, #ec4899); border-color: transparent; color: #fff; }
            .gx-pin-pad .gx-pin-del { font-size: 16px; }

            .gx-viewer {
                position: absolute; inset: 0; z-index: 50;
                background: #000;
                display: flex; flex-direction: column;
                animation: gxViewerIn .26s ${EASE_SOFT};
                touch-action: none;
            }
            @keyframes gxViewerIn {
                from { opacity: 0; }
                to   { opacity: 1; }
            }

            .gx-v-bg { position: absolute; inset: 0; overflow: hidden; z-index: 0; }
            .gx-v-bg-img {
                position: absolute; inset: -10%;
                width: 120%; height: 120%;
                object-fit: cover;
                filter: blur(30px) brightness(.5) saturate(1.15);
                transform: scale(1.2);
                opacity: .85;
            }
            .gx-v-chrome {
                position: relative; z-index: 2;
                display: flex; align-items: center; gap: 6px;
                padding: 10px 12px;
                background: linear-gradient(180deg, rgba(0,0,0,.6), transparent);
                transition: opacity .22s ease, transform .22s ${EASE_SOFT};
            }
            .gx-v-chrome.hidden {
                opacity: 0;
                pointer-events: none;
                transform: translateY(-4px);
            }
            .gx-v-top .gx-iconbtn { background: rgba(0,0,0,.45); border-color: rgba(255,255,255,.14); color: #fff; }
            .gx-v-top .gx-iconbtn:hover { background: rgba(255,255,255,.15); border-color: rgba(255,255,255,.28); color: #fff; }
            .gx-v-top .gx-iconbtn.danger:hover { background: rgba(251,113,133,.45); border-color: transparent; }
            .gx-v-meta {
                flex: 1; min-width: 0;
                display: flex; flex-direction: column;
                font-size: 11.5px; color: #e9ecf5; font-weight: 700;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .gx-v-stage {
                flex: 1 1 auto; min-height: 0;
                position: relative; z-index: 1;
                display: flex; align-items: center; justify-content: center;
                overflow: hidden;
                transition: transform .2s ease;
            }
            .gx-v-stage.gx-slide-init { animation: gxSlideInit .32s ${EASE_SOFT}; }
            .gx-v-stage.gx-slide-next { animation: gxSlideNext .28s ${EASE_SOFT}; }
            .gx-v-stage.gx-slide-prev { animation: gxSlidePrev .28s ${EASE_SOFT}; }
            @keyframes gxSlideInit {
                from { opacity: 0; transform: scale(.96); }
                to   { opacity: 1; transform: none; }
            }
            @keyframes gxSlideNext {
                from { opacity: 0; transform: translateX(32px); }
                to   { opacity: 1; transform: none; }
            }
            @keyframes gxSlidePrev {
                from { opacity: 0; transform: translateX(-32px); }
                to   { opacity: 1; transform: none; }
            }

            .gx-v-img {
                max-width: 100%; max-height: 100%;
                object-fit: contain;
                display: block;
                user-select: none; -webkit-user-drag: none;
                border-radius: 6px;
                box-shadow: 0 16px 48px rgba(0,0,0,.6);
            }
            .gx-v-video { max-width: 100%; max-height: 100%; display: block; background: #000; }

            .gx-v-nav {
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                width: 44px; height: 44px;
                border-radius: 50%;
                background: rgba(0,0,0,.5);
                border: 1px solid rgba(255,255,255,.14);
                color: #fff;
                cursor: pointer;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 3;
                transition: background .2s ease, opacity .22s ${EASE_SOFT}, transform .18s ${EASE_SOFT};
                -webkit-tap-highlight-color: transparent;
                backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            }
            .gx-v-nav svg { width: 20px; height: 20px; pointer-events: none; }
            .gx-v-nav.prev { left: 14px; }
            .gx-v-nav.next { right: 14px; }
            .gx-v-nav:hover { background: rgba(0,0,0,.78); transform: translateY(-50%) scale(1.05); }
            .gx-v-nav:active { transform: translateY(-50%) scale(.92); }
            .gx-v-nav.hidden {
                opacity: 0;
                pointer-events: none;
                transform: translateY(-50%) scale(.85);
            }

            .gx-v-chrome.gx-v-bottom { background: linear-gradient(0deg, rgba(0,0,0,.6), transparent); justify-content: center; }
            .gx-v-count {
                font-size: 11px; font-weight: 700;
                color: rgba(255,255,255,.72);
                letter-spacing: .04em;
                font-variant-numeric: tabular-nums;
            }

            @keyframes gxFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes gxSlideUp {
                from { transform: translateY(40px); opacity: 0; }
                to   { transform: translateY(0); opacity: 1; }
            }

            @media (prefers-reduced-motion: reduce) {
                .gx-cell, .gx-album, .gx-iconbtn, .gx-primary, .gx-secondary,
                .gx-selbtn, .gx-toast, .gx-move-item, .gx-menu-item, .gx-modal-cancel,
                .gx-pin-dots span, .gx-pin-pad button, .gx-v-chrome, .gx-v-stage, .gx-v-nav {
                    transition-duration: .01ms !important;
                }
                .gx-move-overlay, .gx-menu-overlay, .gx-pin-overlay, .gx-pin-card,
                .gx-viewer, .gx-spinner, .gx-body-enter, .gx-selbar.on,
                .gx-v-stage.gx-slide-init, .gx-v-stage.gx-slide-next, .gx-v-stage.gx-slide-prev {
                    animation: none !important;
                }
            }
        `);
    }

    window._galleryStyle = { install };
})();
