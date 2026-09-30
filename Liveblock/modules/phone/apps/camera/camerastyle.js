// modules/phone/apps/camerastyle.js
// CSS do app Câmera. Instalado uma vez via ctx.appendStyle.
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Camera-style] phone ctx ausente'); return; }
    if (window._camStyle) return;

    // Devem ser idênticos aos definidos em camera.js — usados nos seletores
    // .ph-screen.<HIDE_BAR_CLASS> e .ph-frame.<UNLOCK_CLASS>.
    const HIDE_BAR_CLASS = 'sz-hide-bar';
    const UNLOCK_CLASS   = 'cam-unlocked';

    let _installed = false;

    function install() {
        if (_installed) return;
        _installed = true;
        ctx.appendStyle(`
            .ph-screen.${HIDE_BAR_CLASS} .ph-app-bar { display: none !important; }

            .ph-frame.${UNLOCK_CLASS}:not(.min) {
                transform: translate(var(--cam-drag-x, 0px), var(--cam-drag-y, 0px));
                touch-action: none;
            }

            .cam-app {
                position: absolute; inset: 0;
                display: flex; flex-direction: column;
                background: #000;
                color: #e9ecf5;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                overflow: hidden;
                user-select: none; -webkit-user-select: none;
            }

            .cam-topbar {
                display: flex; align-items: center; gap: 8px;
                padding: 8px 10px;
                background: rgba(0,0,0,.55);
                backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
                border-bottom: 1px solid rgba(255,255,255,.05);
                flex-shrink: 0;
                z-index: 3;
            }
            .cam-back, .cam-gallery, .cam-settings-btn {
                width: 32px; height: 32px; flex-shrink: 0;
                border-radius: 9px;
                background: rgba(255,255,255,.06);
                border: 1px solid rgba(255,255,255,.09);
                color: #e9ecf5; cursor: pointer; padding: 0;
                display: flex; align-items: center; justify-content: center;
                transition: background .15s, border-color .15s;
            }
            .cam-back { font-size: 22px; line-height: 1; font-family: inherit; }
            .cam-back:hover, .cam-gallery:hover, .cam-settings-btn:hover {
                background: rgba(255,255,255,.12);
                border-color: rgba(244,114,182,.4);
            }
            .cam-back:active, .cam-gallery:active, .cam-settings-btn:active { transform: scale(.94); }

            .cam-grip {
                flex: 1; min-width: 0;
                height: 32px;
                border-radius: 9px;
                background: linear-gradient(180deg, rgba(244,114,182,.14), rgba(244,114,182,.04));
                border: 1px dashed rgba(244,114,182,.45);
                display: flex; align-items: center; justify-content: center;
                color: #fbcfe8;
                font-size: 15px; letter-spacing: 4px;
                cursor: grab;
                touch-action: none;
                -webkit-user-select: none; user-select: none;
                -webkit-tap-highlight-color: transparent;
                transition: background .15s, border-color .15s, color .15s, transform .12s;
            }
            .cam-grip:hover {
                background: linear-gradient(180deg, rgba(244,114,182,.22), rgba(244,114,182,.08));
                border-color: rgba(244,114,182,.7);
                color: #fff;
            }
            .cam-grip:active {
                cursor: grabbing;
                background: rgba(244,114,182,.28);
                color: #fff;
                transform: scale(.98);
            }

            .cam-grip.grip-active {
                background: linear-gradient(180deg, rgba(244,114,182,.42), rgba(244,114,182,.16));
                border-style: solid;
                border-color: rgba(244,114,182,.9);
                color: #fff;
                animation: camGripPulse 1.6s ease-in-out infinite;
            }
            .cam-grip.grip-active:hover {
                background: linear-gradient(180deg, rgba(244,114,182,.5), rgba(244,114,182,.22));
                color: #fff;
            }
            @keyframes camGripPulse {
                0%, 100% { box-shadow: 0 0 12px rgba(244,114,182,.5), inset 0 1px 0 rgba(255,255,255,.12); }
                50%      { box-shadow: 0 0 24px rgba(244,114,182,.95), inset 0 1px 0 rgba(255,255,255,.28); }
            }

            .ph-frame.cam-sticky-move {
                cursor: move;
                box-shadow:
                    0 26px 60px rgba(0,0,0,.72),
                    0 0 0 2px rgba(244,114,182,.5),
                    0 0 44px rgba(244,114,182,.35),
                    inset 0 1px 1px rgba(255,255,255,.22),
                    inset 0 -1px 1px rgba(0,0,0,.85),
                    inset 1px 0 0 rgba(255,255,255,.06),
                    inset -1px 0 0 rgba(0,0,0,.5);
            }
            .ph-frame.cam-sticky-move .ph-notch {
                background: #0a0c14;
            }

            .cam-preview {
                flex: 1 1 auto;
                min-height: 0;
                position: relative;
                display: flex; align-items: center; justify-content: center;
                background: #000;
                overflow: hidden;
                cursor: zoom-in;
                overscroll-behavior: contain;
                touch-action: pan-y;
            }
            .cam-preview canvas {
                width: 100%; height: 100%;
                display: block;
                pointer-events: none;
                background: #050505;
            }
            .cam-status {
                position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
                background: rgba(0,0,0,.6);
                padding: 6px 12px; border-radius: 20px;
                font-size: 10.5px; color: #b4bac8;
                letter-spacing: .02em;
                pointer-events: none;
                transition: opacity .3s ease;
                max-width: 90%;
                text-align: center;
                opacity: 0;
            }
            .cam-status.on { opacity: 1; }

            .cam-flash {
                position: absolute; inset: 0;
                background: #fff;
                opacity: 0;
                pointer-events: none;
                z-index: 2;
            }
            .cam-flash.fire { animation: camFlash .28s ease; }
            @keyframes camFlash {
                0% { opacity: .9; }
                100% { opacity: 0; }
            }

            .cam-zoom-ind {
                position: absolute;
                top: 12px; left: 50%;
                transform: translateX(-50%) translateY(-6px);
                background: rgba(0,0,0,.7);
                backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
                color: #f9a8d4;
                font-size: 12px;
                font-weight: 800;
                letter-spacing: .04em;
                font-variant-numeric: tabular-nums;
                padding: 5px 12px;
                border-radius: 14px;
                border: 1px solid rgba(244,114,182,.35);
                box-shadow: 0 6px 18px rgba(0,0,0,.45);
                opacity: 0;
                pointer-events: none;
                transition: opacity .18s ease, transform .18s ease;
                z-index: 6;
            }
            .cam-zoom-ind.on {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }

            .cam-countdown {
                position: absolute; inset: 0;
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 5;
                pointer-events: none;
                font-size: 96px;
                font-weight: 900;
                color: #fff;
                font-variant-numeric: tabular-nums;
                letter-spacing: -.02em;
                text-shadow:
                    0 8px 32px rgba(0,0,0,.75),
                    0 0 60px rgba(244,114,182,.55);
            }
            .cam-countdown.on { display: flex; }
            .cam-countdown.pulse { animation: camCdPulse .9s ease-out; }
            @keyframes camCdPulse {
                0%   { opacity: 0; transform: scale(1.5); }
                18%  { opacity: 1; transform: scale(1); }
                80%  { opacity: 1; transform: scale(1); }
                100% { opacity: .35; transform: scale(.92); }
            }

            .cam-rec-indicator {
                position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
                background: rgba(220,40,60,.92);
                color: #fff;
                font-size: 10.5px; font-weight: 800;
                padding: 5px 12px; border-radius: 14px;
                display: none; align-items: center; gap: 7px;
                letter-spacing: .05em;
                font-variant-numeric: tabular-nums;
                z-index: 3;
                box-shadow: 0 6px 16px rgba(220,40,60,.35);
            }
            .cam-rec-indicator.on { display: flex; }
            .cam-rec-dot {
                width: 8px; height: 8px; border-radius: 50%; background: #fff;
                animation: camPulse 1s ease-in-out infinite;
            }
            @keyframes camPulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }

            .cam-bottombar {
                display: flex; align-items: center; justify-content: space-around;
                padding: 14px 20px 20px;
                background: rgba(0,0,0,.7);
                backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
                border-top: 1px solid rgba(255,255,255,.05);
                flex-shrink: 0;
                z-index: 3;
            }

            .cam-thumb {
                width: 48px; height: 48px; border-radius: 12px;
                background: rgba(255,255,255,.06);
                border: 1px solid rgba(255,255,255,.14);
                overflow: hidden; cursor: pointer; padding: 0;
                position: relative;
                display: flex; align-items: center; justify-content: center;
                color: #8a90a8;
                flex-shrink: 0;
                transition: transform .15s, border-color .15s;
            }
            .cam-thumb:hover { border-color: rgba(244,114,182,.5); transform: scale(1.03); }
            .cam-thumb:active { transform: scale(.95); }
            .cam-thumb img, .cam-thumb video {
                width: 100%; height: 100%; object-fit: cover; display: block;
            }
            .cam-thumb-empty { font-size: 20px; opacity: .55; }
            .cam-thumb-play {
                position: absolute; right: 3px; bottom: 3px;
                background: rgba(0,0,0,.65); color: #fff;
                font-size: 9px; padding: 1px 4px; border-radius: 4px;
                line-height: 1;
            }

            .cam-shutter {
                width: 72px; height: 72px; border-radius: 50%;
                background: #fff;
                border: 4px solid rgba(255,255,255,.35);
                box-shadow: 0 0 0 2px rgba(0,0,0,.4);
                cursor: pointer; padding: 0;
                transition: transform .1s, background .2s;
                flex-shrink: 0;
            }
            .cam-shutter:hover { background: #f8f8f8; }
            .cam-shutter:active { transform: scale(.92); }

            .cam-video {
                width: 48px; height: 48px; border-radius: 50%;
                background: rgba(255,255,255,.06);
                border: 1px solid rgba(255,255,255,.14);
                color: #e9ecf5; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0;
                font-size: 14px; font-family: inherit;
                transition: background .2s, border-color .2s, color .2s;
            }
            .cam-video:hover { background: rgba(255,255,255,.12); }
            .cam-video:active { transform: scale(.94); }
            .cam-video.rec {
                background: rgba(220,40,60,.22);
                border-color: rgba(220,40,60,.6);
                color: #fca5b1;
                animation: camPulse 1.2s ease-in-out infinite;
            }

            .cam-settings-overlay {
                position: absolute; inset: 0; z-index: 40;
                background: rgba(0,0,0,.6);
                backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
                display: flex; align-items: flex-end; justify-content: center;
                animation: camFadeIn .18s ease;
            }
            .cam-settings-card {
                width: 100%;
                max-height: 85%;
                background: linear-gradient(180deg, #131a24, #0b1218);
                border-top-left-radius: 18px; border-top-right-radius: 18px;
                border-top: 1px solid rgba(255,255,255,.08);
                padding: 14px 0 18px;
                display: flex; flex-direction: column;
                animation: camSlideUp .26s cubic-bezier(.22,1,.36,1);
            }
            .cam-settings-head {
                display: flex; align-items: center; justify-content: space-between;
                padding: 0 16px 12px;
                border-bottom: 1px solid rgba(255,255,255,.05);
                flex-shrink: 0;
            }
            .cam-settings-title {
                font-size: 13px; font-weight: 800; color: #e9ecf5;
                letter-spacing: .02em;
            }
            .cam-settings-close {
                width: 26px; height: 26px; border-radius: 7px;
                background: transparent; border: 1px solid rgba(255,255,255,.12);
                color: #a8aec4; cursor: pointer; font-size: 14px;
                font-family: inherit;
                display: flex; align-items: center; justify-content: center;
                transition: background .15s, color .15s, border-color .15s;
            }
            .cam-settings-close:hover { background: rgba(251,113,133,.16); color: #fca5b1; border-color: rgba(251,113,133,.4); }

            .cam-settings-body {
                padding: 6px 8px;
                display: flex; flex-direction: column;
                gap: 2px;
                overflow-y: auto;
                min-height: 0;
            }
            .cam-setting-row {
                display: flex; align-items: center; justify-content: space-between;
                gap: 12px;
                padding: 12px 12px;
                border-radius: 12px;
                cursor: pointer;
                transition: background .14s;
                user-select: none;
            }
            .cam-setting-row:hover { background: rgba(255,255,255,.04); }
            .cam-setting-row.seg { cursor: default; }
            .cam-setting-info { flex: 1; min-width: 0; }
            .cam-setting-name {
                display: flex; align-items: center; gap: 8px;
                font-size: 12.5px; font-weight: 700; color: #e9ecf5;
            }
            .cam-setting-name svg { color: #f9a8d4; flex-shrink: 0; }
            .cam-setting-desc {
                font-size: 10.5px; color: #8a90a8;
                margin-top: 3px; margin-left: 23px;
                line-height: 1.4;
            }

            .cam-toggle {
                display: inline-block;
                width: 40px; height: 22px;
                border-radius: 22px;
                background: rgba(255,255,255,.12);
                border: 1px solid rgba(255,255,255,.08);
                position: relative;
                flex-shrink: 0;
                transition: background .18s, border-color .18s;
            }
            .cam-toggle span {
                position: absolute; top: 2px; left: 2px;
                width: 16px; height: 16px;
                border-radius: 50%;
                background: #c7cad6;
                transition: transform .2s cubic-bezier(.22,1,.36,1), background .18s;
                display: block;
            }
            .cam-toggle.on {
                background: rgba(244,114,182,.4);
                border-color: rgba(244,114,182,.6);
            }
            .cam-toggle.on span {
                background: #f9a8d4;
                transform: translateX(18px);
                box-shadow: 0 0 8px rgba(249,168,212,.6);
            }

            .cam-seg {
                display: inline-flex;
                gap: 2px;
                background: rgba(255,255,255,.05);
                border: 1px solid rgba(255,255,255,.08);
                border-radius: 9px;
                padding: 2px;
                flex-shrink: 0;
            }
            .cam-seg button {
                padding: 5px 9px;
                border: none;
                background: transparent;
                color: #8a90a8;
                font-family: inherit;
                font-size: 10px;
                font-weight: 800;
                letter-spacing: .02em;
                cursor: pointer;
                border-radius: 6px;
                transition: background .12s, color .12s;
                min-width: 38px;
            }
            .cam-seg button:hover { color: #c7cad6; }
            .cam-seg button.on {
                background: rgba(244,114,182,.22);
                color: #f9a8d4;
                box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
            }
            .cam-seg button:active:not(.on) { transform: scale(.96); }

            .cam-settings-sep {
                height: 1px;
                background: rgba(255,255,255,.05);
                margin: 8px 12px;
            }
            .cam-settings-subtitle {
                font-size: 9.5px;
                font-weight: 800;
                letter-spacing: .1em;
                text-transform: uppercase;
                color: #8a90a8;
                padding: 4px 12px 2px;
            }

            .cam-settings-note {
                text-align: center;
                font-size: 10px;
                color: #6b7280;
                padding: 12px 16px 4px;
                line-height: 1.5;
                flex-shrink: 0;
            }

            @keyframes camFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes camSlideUp {
                from { transform: translateY(40px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }

            @media (prefers-reduced-motion: reduce) {
                .cam-video.rec, .cam-rec-dot, .cam-countdown.pulse, .cam-grip.grip-active { animation: none !important; }
                .cam-settings-overlay, .cam-settings-card, .cam-toggle span, .cam-seg button, .cam-zoom-ind { transition: none !important; animation: none !important; }
            }
        `);
    }

    window._camStyle = {
        install,
        HIDE_BAR_CLASS,
        UNLOCK_CLASS,
        get installed() { return _installed; }
    };
})();
