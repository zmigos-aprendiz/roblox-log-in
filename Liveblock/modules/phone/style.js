// modules/phone/style.js
// Só o CSS. Nada de lógica. Expõe ctx._phoneCss para core.js injetar no shadow DOM.
(function() {
    'use strict';
    const ctx = window._phoneCtx = window._phoneCtx || {};
    const P   = ctx._phone   = ctx._phone   || {};
    if (!P.config) { console.warn('[Phone/style] shell.js não inicializado.'); return; }
    if (ctx._phoneCss) return;

    const C = P.config;

    ctx._phoneCss = `
    :host, * { box-sizing: border-box; }

    /* ═══ SCROLLBAR KILL SWITCH — todas as barras somem do telefone inteiro ═══ */
    :host, :host * {
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    :host *::-webkit-scrollbar {
        width: 0 !important;
        height: 0 !important;
        display: none !important;
        background: transparent !important;
    }

    @keyframes phFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes phScreenBlink { 0%,100%{opacity:.6} 50%{opacity:1} }
    @keyframes phPulseDot { 0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.55)} 50%{box-shadow:0 0 0 6px rgba(52,211,153,0)} }
    @keyframes phKeyPress { 0%{transform:scale(1)} 40%{transform:scale(.9)} 100%{transform:scale(1)} }
    @keyframes phToastIn { from{opacity:0;transform:translateY(-8px) scale(.94)} to{opacity:1;transform:none} }
    @keyframes phRingGlow {
        0%, 100% { box-shadow: 0 30px 80px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.03), inset 0 1px 0 rgba(255,255,255,.06), inset 0 -1px 0 rgba(0,0,0,.7), 0 0 0 0 rgba(52,211,153,.5); }
        50% { box-shadow: 0 30px 80px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.03), inset 0 1px 0 rgba(255,255,255,.06), inset 0 -1px 0 rgba(0,0,0,.7), 0 0 0 12px rgba(52,211,153,0); }
    }
    @keyframes phRecordPulse {
        0%,100% { box-shadow: 0 30px 80px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.03), inset 0 1px 0 rgba(255,255,255,.06), inset 0 -1px 0 rgba(0,0,0,.7), 0 0 0 0 rgba(251,113,133,.55); }
        50% { box-shadow: 0 30px 80px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.03), inset 0 1px 0 rgba(255,255,255,.06), inset 0 -1px 0 rgba(0,0,0,.7), 0 0 0 14px rgba(251,113,133,0); }
    }
    @keyframes phPinShake { 10%,90%{transform:translateX(-3px)} 20%,80%{transform:translateX(4px)} 30%,50%,70%{transform:translateX(-6px)} 40%,60%{transform:translateX(6px)} }
    @keyframes phSwipeHint { 0%,100%{transform:translateY(0);opacity:.55} 50%{transform:translateY(-6px);opacity:.9} }
    @keyframes phStageFadeIn { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
    @keyframes phSpeaking { 0%,100%{opacity:1} 50%{opacity:.55} }
    @keyframes phNotifIn {
        from { opacity: 0; transform: translateY(-14px) scale(.96); }
        to   { opacity: 1; transform: none; }
    }
    @keyframes phBuzz {
        0%, 100% { transform: translate(0,0); }
        10%,30%,50%,70%,90% { transform: translateX(-1.5px); }
        20%,40%,60%,80% { transform: translateX(1.5px); }
    }

.ph-frame {
    position: fixed; top: 50%; right: 24px;
    margin-top: -285px;
    width: 280px; height: 570px;
    transform-origin: 100% 50%;
    transform: translate(0, 0) rotate(0deg);
    transition: transform 1.05s cubic-bezier(.7, 0, .3, 1),
                width .42s cubic-bezier(.22,1,.36,1),
                height .42s cubic-bezier(.22,1,.36,1),
                margin-top .42s cubic-bezier(.22,1,.36,1);
    pointer-events: auto;
    border-radius: 44px;
    padding: 9px;
    background:
        linear-gradient(155deg, #3a3a3f 0%, #2b2b30 22%, #1c1c20 55%, #131316 100%);
    box-shadow:
        0 26px 60px rgba(0,0,0,.72),
        0 8px 20px rgba(0,0,0,.55),
        inset 0 1px 1px rgba(255,255,255,.22),
        inset 0 -1px 1px rgba(0,0,0,.85),
        inset 1px 0 0 rgba(255,255,255,.06),
        inset -1px 0 0 rgba(0,0,0,.5),
        0 0 0 1px rgba(0,0,0,.85);
    user-select: none;
    isolation: isolate;
    will-change: transform, width, height;
    animation: phFadeIn .35s ease;
}
.ph-frame.game-mode {
    width: 360px; height: 740px;
    margin-top: -370px;
}
    .ph-frame::before {
        content: '';
        position: absolute; inset: 7px;
        border-radius: 38px;
        pointer-events: none;
        background: transparent;
        box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.9),
            inset 0 0 0 2px rgba(255,255,255,.02);
        z-index: 2;
    }
    .ph-frame::after {
        content: '';
        position: absolute; inset: 0;
        border-radius: inherit;
        pointer-events: none;
        background:
            radial-gradient(140% 90% at 8% 4%, rgba(255,255,255,.14), transparent 42%),
            radial-gradient(120% 90% at 100% 100%, rgba(0,0,0,.5), transparent 55%);
        z-index: 1;
        mix-blend-mode: overlay;
        opacity: .9;
    }
    .ph-frame.min {
        transform: translate(${C.MIN_TUCK_X}px, ${C.MIN_TUCK_Y}px) rotate(-90deg);
        box-shadow:
            0 0 24px rgba(0,0,0,.55),
            0 0 0 1px rgba(0,0,0,.85),
            inset 0 1px 1px rgba(255,255,255,.16),
            inset 0 -1px 1px rgba(0,0,0,.7);
    }
    .ph-frame.ringing:not(.min) { animation: phRingGlow 1.6s ease-in-out infinite; }
    .ph-frame.recording:not(.min) { animation: phRecordPulse 1.4s ease-in-out infinite; }
    .ph-frame.hidden { opacity: 0; pointer-events: none; }
    .ph-frame.min::after {
        content: ''; position: absolute; top: 14px; bottom: 14px; left: 0; width: 10px;
        border-radius: 42px 0 0 42px;
        background: linear-gradient(90deg, rgba(52,211,153,.25), transparent);
        animation: phSwipeHint 3.2s ease-in-out infinite;
        pointer-events: none;
        mix-blend-mode: normal;
        opacity: 1;
        z-index: 4;
    }

    .ph-side {
        position: absolute; right: -2px; width: 3px;
        border-radius: 2px;
        background: linear-gradient(90deg, #2f2f34 0%, #4a4a52 40%, #2a2a2e 100%);
        box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.7),
            1px 0 3px rgba(0,0,0,.5);
        z-index: 3;
    }
    .ph-side.vol1 { top: 118px; height: 42px; border-radius: 2px 2px 1px 1px; }
    .ph-side.vol2 { top: 168px; height: 42px; border-radius: 2px 2px 1px 1px; }
    .ph-side.pwr  {
        top: 128px; right: auto; left: -2px; height: 62px;
        border-radius: 1px 2px 2px 1px;
        background: linear-gradient(90deg, #2a2a2e 0%, #4a4a52 60%, #2f2f34 100%);
        box-shadow:
            inset 0 0 0 1px rgba(0,0,0,.7),
            -1px 0 3px rgba(0,0,0,.5);
    }

    .ph-notch {
        position: absolute; top: 9px; left: 50%; transform: translateX(-50%);
        width: 88px; height: 22px;
        border-radius: 0 0 16px 16px;
        background: #030408;
        display: flex; align-items: center; justify-content: center; gap: 6px;
        z-index: 40; pointer-events: auto; cursor: pointer;
        transition: background .2s, transform .15s;
        box-shadow:
            inset 0 -1px 0 rgba(255,255,255,.06),
            inset 0 1px 2px rgba(0,0,0,.9),
            0 1px 0 rgba(255,255,255,.03);
    }
    .ph-notch:hover { background: #0a0c14; }
    .ph-notch:active { transform: translateX(-50%) scale(.94); }
    .ph-notch::before {
        content: ''; width: 44px; height: 4px; border-radius: 2px;
        background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.01));
        box-shadow: inset 0 1px 1px rgba(0,0,0,.9);
    }
    .ph-notch::after {
        content: ''; width: 6px; height: 6px; border-radius: 50%;
        background:
            radial-gradient(circle at 35% 30%, #1a1c26 0%, #05060a 70%);
        box-shadow:
            inset 0 0 3px rgba(80,160,220,.5),
            0 0 2px rgba(80,160,220,.3);
    }

    .ph-screen {
        position: relative; width: 100%; height: 100%;
        border-radius: 36px; overflow: hidden;
        background:
            radial-gradient(circle at 15% 10%, rgba(52,211,153,.22), transparent 52%),
            radial-gradient(circle at 88% 88%, rgba(16,185,129,.25), transparent 55%),
            radial-gradient(circle at 50% 55%, rgba(52,211,153,.10), transparent 65%),
            linear-gradient(175deg, #1e3028 0%, #16241e 45%, #0c1a14 100%);
        display: flex; flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #e9ecf5;
        box-shadow:
            inset 0 0 30px rgba(0,0,0,.55),
            inset 0 0 0 1px rgba(0,0,0,.95),
            inset 0 1px 0 rgba(255,255,255,.05),
            0 0 0 1px rgba(255,255,255,.03);
        transition: background .3s ease;
    }
    .ph-screen.buzz { animation: phBuzz .55s cubic-bezier(.36,.07,.19,.97); }

    .ph-screen.app-active {
        background: var(--active-app-bg-solid, ${C.DEFAULT_APP_BG_SOLID});
    }
    .ph-screen.app-active .ph-wallpaper { opacity: 0; }
    .ph-screen.app-active .ph-status {
        background: var(--active-app-bg-solid, ${C.DEFAULT_APP_BG_SOLID});
        border-bottom: 1px solid rgba(255,255,255,.03);
    }
    .ph-screen.app-active .ph-home-bar {
        background: var(--active-app-bg-solid, ${C.DEFAULT_APP_BG_SOLID});
    }

    .ph-wallpaper {
        position: absolute; inset: 0; z-index: 0;
        background-image: var(--phone-wallpaper, none);
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        border-radius: 36px;
        pointer-events: none;
        transition: opacity .25s ease;
    }
    .ph-screen::before {
        content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
        background:
            linear-gradient(155deg,
                rgba(255,255,255,.08) 0%,
                rgba(255,255,255,.02) 12%,
                transparent 32%);
        border-radius: 36px;
    }
    .ph-screen::after {
        content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 4;
        border-radius: 36px;
        background:
            radial-gradient(120% 90% at 50% 50%, transparent 60%, rgba(0,0,0,.35) 100%);
        mix-blend-mode: multiply;
        opacity: .85;
    }

    .ph-status {
        padding: 10px 22px 6px;
        display: flex; align-items: center; justify-content: space-between;
        font-size: 10px; color: #c2c8dc; flex-shrink: 0;
        position: relative; z-index: 6;
        background: linear-gradient(180deg, rgba(8,20,14,.72) 0%, rgba(8,20,14,.35) 60%, rgba(8,20,14,0) 100%);
        text-shadow: 0 1px 2px rgba(0,0,0,.6);
        transition: background .3s ease;
    }
    .ph-status-time { font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
    .ph-status-icons { display: flex; align-items: center; gap: 5px; font-size: 9px; }
    .ph-status-icons .sig { display: inline-flex; gap: 1px; align-items: flex-end; height: 8px; }
    .ph-status-icons .sig i { display: inline-block; width: 2px; background: currentColor; border-radius: 1px; }
    .ph-status-icons .sig i:nth-child(1){ height: 3px; opacity: .5; }
    .ph-status-icons .sig i:nth-child(2){ height: 5px; opacity: .7; }
    .ph-status-icons .sig i:nth-child(3){ height: 7px; }
    .ph-status-icons .sig i:nth-child(4){ height: 9px; }
    .ph-status-icons .wifi svg { width: 10px; height: 10px; }
    .ph-status-icons .dot-notif {
        width: 5px; height: 5px; border-radius: 50%; background: #fb7185;
        box-shadow: 0 0 6px rgba(251,113,133,.85);
        animation: phPulseDot 1.8s ease-in-out infinite;
        display: none;
    }
    .ph-status-icons .dot-notif.on { display: inline-block; }

    .ph-stage {
        flex: 1; min-height: 0; position: relative; z-index: 3;
        display: flex; flex-direction: column;
    }
    .ph-view {
        position: absolute; inset: 0;
        display: none; flex-direction: column; min-height: 0;
    }
    .ph-view.active { display: flex; animation: phStageFadeIn .32s cubic-bezier(.22,1,.36,1); }

    .ph-view-app { background: var(--app-bg, ${C.DEFAULT_APP_BG}); }
    .ph-view-call { background: linear-gradient(175deg, #12241d 0%, #08140f 100%); }

    /* ═══ LOCK ═══ */
    .ph-lock {
        flex: 1; min-height: 0;
        display: flex; flex-direction: column;
        padding: 12px 20px 16px;
    }
    .ph-lock-clock { padding-top: 30px; text-align: center; }
    .ph-lock-time {
        font-size: 60px; font-weight: 800; letter-spacing: -.035em;
        color: #f6f7fb; line-height: 1;
        font-variant-numeric: tabular-nums;
        text-shadow: 0 4px 24px rgba(0,0,0,.55), 0 0 40px rgba(52,211,153,.18);
    }
    .ph-lock-date {
        font-size: 12px; color: #c2c8dc; margin-top: 6px;
        letter-spacing: .02em; font-weight: 600;
        text-transform: capitalize;
        text-shadow: 0 1px 3px rgba(0,0,0,.5);
    }
    .ph-lock-mid { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .ph-lock-swipe {
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        color: #c8d6cc; cursor: pointer; user-select: none;
        padding: 14px 22px; border-radius: 14px;
        background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.02));
        border: 1px solid rgba(255,255,255,.1);
        box-shadow: 0 6px 20px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.08);
        transition: background .2s, border-color .2s, transform .15s;
    }
    .ph-lock-swipe:hover { background: linear-gradient(180deg, rgba(52,211,153,.14), rgba(52,211,153,.05)); border-color: rgba(52,211,153,.4); }
    .ph-lock-swipe:active { transform: scale(.96); }
    .ph-lock-swipe-icon { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
        animation: phSwipeHint 2.6s ease-in-out infinite; }
    .ph-lock-swipe-icon svg { width: 26px; height: 26px; }
    .ph-lock-swipe-text { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }

    /* ═══ LOCK: duas views (notificações + PIN) ═══ */
    .ph-lock-body {
        flex: 1; min-height: 0; position: relative;
        display: flex; flex-direction: column;
        margin-top: 14px;
    }

    .ph-lock-view {
        position: absolute; inset: 0;
        display: flex; flex-direction: column;
        transition: transform .34s cubic-bezier(.22,1,.36,1), opacity .26s ease;
    }
    .ph-lock-view.notifs { transform: translateY(0); opacity: 1; pointer-events: auto; }
    .ph-lock-view.pin    { transform: translateY(60%); opacity: 0; pointer-events: none; }
    .ph-lock.mode-pin .ph-lock-view.notifs { transform: translateY(-30%); opacity: 0; pointer-events: none; }
    .ph-lock.mode-pin .ph-lock-view.pin    { transform: translateY(0); opacity: 1; pointer-events: auto; }

    .ph-lock-notifs {
        flex: 1; min-height: 0; overflow-y: auto;
        display: flex; flex-direction: column; gap: 8px;
        padding: 4px 2px 4px;
    }

    .ph-lock-empty {
        flex: 1; display: flex; align-items: center; justify-content: center;
        font-size: 10.5px; color: #6b7280; letter-spacing: .04em;
        text-transform: uppercase;
    }
    .ph-lock-empty-txt { opacity: .8; }

    .ph-notif-card {
        display: flex; gap: 10px; align-items: flex-start;
        padding: 10px 12px;
        border-radius: 14px;
        background: linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.03));
        border: 1px solid rgba(255,255,255,.1);
        box-shadow: 0 6px 20px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.1);
        backdrop-filter: blur(14px) saturate(160%);
        -webkit-backdrop-filter: blur(14px) saturate(160%);
        animation: phNotifIn .32s cubic-bezier(.22,1,.36,1) both;
        cursor: pointer;
        transition: background .18s, border-color .18s, transform .15s;
    }
    .ph-notif-card:hover { background: linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,.05)); transform: translateY(-1px); }
    .ph-notif-card.unread { border-color: rgba(52,211,153,.4); }
    .ph-notif-card.unread::before {
        content: ''; width: 3px; align-self: stretch;
        margin-right: -6px; border-radius: 3px;
        background: linear-gradient(180deg, #6ee7b7, #10a37f);
        box-shadow: 0 0 8px rgba(52,211,153,.5);
    }
    .ph-notif-icon {
        width: 32px; height: 32px; flex-shrink: 0;
        border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        background: var(--nf-accent-bg, rgba(52,211,153,.16));
        border: 1px solid var(--nf-accent-border, rgba(52,211,153,.34));
        color: var(--nf-accent, #6ee7b7);
    }
    .ph-notif-icon svg { width: 15px; height: 15px; }
    .ph-notif-icon img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
    .ph-notif-body { flex: 1; min-width: 0; }
    .ph-notif-app {
        font-size: 8.5px; font-weight: 800; letter-spacing: .06em;
        text-transform: uppercase; color: #8890a8;
    }
    .ph-notif-title {
        font-size: 12px; font-weight: 700; color: #e9ecf5; margin-top: 2px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .ph-notif-text {
        font-size: 10.5px; color: #a8aec4; margin-top: 1px; line-height: 1.4;
        overflow: hidden; display: -webkit-box;
        -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .ph-notif-time {
        font-size: 9px; color: #6b7280; flex-shrink: 0; margin-left: auto;
        font-variant-numeric: tabular-nums;
    }

    .ph-lock-swipe-hint {
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        padding: 8px 0 4px; cursor: pointer;
        color: rgba(255,255,255,.42);
        font-family: inherit;
        background: transparent; border: none;
        opacity: 0; pointer-events: none;
        transition: color .2s, opacity .25s;
    }
    .ph-lock.has-pin .ph-lock-swipe-hint { opacity: 1; pointer-events: auto; }
    .ph-lock-swipe-hint:hover { color: rgba(255,255,255,.75); }
    .ph-lock-swipe-chevron {
        display: block; width: 22px; height: 12px;
        opacity: .55;
        animation: phSwipeHint 2.6s ease-in-out infinite;
    }
    .ph-lock-swipe-chevron svg { width: 100%; height: 100%; display: block; }
    .ph-lock-swipe-label {
        font-size: 9.5px; font-weight: 700; letter-spacing: .08em;
        text-transform: uppercase;
    }

    .ph-lock:not(.has-pin) .ph-lock-swipe-hint {
        opacity: 1; pointer-events: auto;
        color: rgba(110,231,183,.85);
    }
    .ph-lock:not(.has-pin) .ph-lock-swipe-hint:hover { color: #6ee7b7; }

    .ph-lock-pin-wrap {
        display: flex; flex-direction: column; align-items: center; gap: 14px;
        width: 100%; max-width: 220px;
        margin: 0 auto;
    }
    .ph-lock-pin-dots { display: flex; gap: 14px; justify-content: center; padding: 6px 0; }
    .ph-lock-pin-dot {
        width: 12px; height: 12px; border-radius: 50%;
        background: transparent; border: 2px solid rgba(255,255,255,.35);
        transition: background .15s, border-color .15s, transform .15s;
    }
    .ph-lock-pin-dot.filled {
        background: #6ee7b7; border-color: #6ee7b7;
        box-shadow: 0 0 12px rgba(52,211,153,.75);
        transform: scale(1.1);
    }
    .ph-lock-pin-label {
        font-size: 10.5px; color: #c2c8dc; letter-spacing: .06em;
        text-transform: uppercase; font-weight: 700;
    }
    .ph-lock-pin.shake .ph-lock-pin-dots { animation: phPinShake .5s cubic-bezier(.36,.07,.19,.97); }

    .ph-lock-view.pin .ph-keypad {
        margin-top: 18px;
        max-width: 220px;
        width: 100%;
        align-self: center;
    }

    .ph-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .ph-key {
        padding: 12px 0 10px; border-radius: 14px;
        background: linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.03));
        border: 1px solid rgba(255,255,255,.1);
        color: #e5e7eb; font-family: inherit;
        font-size: 19px; font-weight: 700;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        cursor: pointer; user-select: none;
        transition: background .12s, border-color .12s, transform .12s, box-shadow .12s;
        line-height: 1;
        box-shadow:
            inset 0 1px 0 rgba(255,255,255,.1),
            0 2px 6px rgba(0,0,0,.28);
    }
    .ph-key .sub { font-size: 7.5px; color: #7b8296; letter-spacing: .06em; margin-top: 3px; font-weight: 800; text-transform: uppercase; }
    .ph-key:hover { background: linear-gradient(180deg, rgba(52,211,153,.16), rgba(52,211,153,.06)); border-color: rgba(52,211,153,.4); }
    .ph-key:active { transform: scale(.94); background: linear-gradient(180deg, rgba(52,211,153,.28), rgba(52,211,153,.12)); box-shadow: inset 0 1px 0 rgba(255,255,255,.12); }
    .ph-key.pressed { animation: phKeyPress .25s cubic-bezier(.22,1,.36,1); }
    .ph-key.util { color: #8890a4; font-size: 15px; }
    .ph-key.util:hover { color: #6ee7b7; }
    .ph-key.util svg { width: 16px; height: 16px; }
    .ph-key.util.ok { color: #a7f3d0; }
    .ph-key.util.ok:hover { color: #fff; background: rgba(52,211,153,.2); }

    .ph-home {
        flex: 1; min-height: 0;
        display: flex; flex-direction: column;
        padding: 10px 14px 0;
    }
    .ph-home-clock {
        position: relative;
        z-index: 20;
        padding: 4px 6px 6px;
        flex-shrink: 0;
        cursor: grab;
        touch-action: none;
        user-select: none;
        transition: transform .18s cubic-bezier(.22,1,.36,1);
    }
    .ph-home-clock.dragging { cursor: grabbing; transition: none; }
    .ph-home-time {
        font-size: 48px; font-weight: 800; letter-spacing: -.035em; color: #f6f7fb; line-height: 1;
        font-variant-numeric: tabular-nums;
        text-shadow: 0 2px 14px rgba(0,0,0,.5);
    }
    .ph-home-date {
        font-size: 11px; color: #a8aec4; letter-spacing: .02em; margin-top: 2px;
        text-transform: capitalize; font-weight: 600;
        text-shadow: 0 1px 2px rgba(0,0,0,.4);
    }

    .ph-home-search {
        position: relative;
        z-index: 20;
        display: flex; align-items: center; gap: 8px;
        padding: 7px 14px; border-radius: 22px;
        background: linear-gradient(120deg, #10a37f, #16c596);
        color: #fff; margin-bottom: 10px;
        font-size: 11px; font-weight: 700; letter-spacing: .02em;
        box-shadow: 0 6px 18px rgba(16,163,127,.4), inset 0 1px 0 rgba(255,255,255,.28);
        cursor: grab;
        flex-shrink: 0;
        touch-action: none;
        user-select: none;
        transition: transform .18s cubic-bezier(.22,1,.36,1);
    }
    .ph-home-search.dragging { cursor: grabbing; transition: none; }
    .ph-home-search svg { width: 12px; height: 12px; margin-left: auto; opacity: .9; }
    .ph-home-search input {
        flex: 1; background: transparent; border: none; outline: none;
        color: #fff; font-family: inherit; font-size: 11px; font-weight: 700;
        padding: 0;
        cursor: text;
        user-select: text;
        -webkit-user-select: text;
    }
    .ph-home-search input::placeholder { color: rgba(255,255,255,.75); }

    .ph-home-pages-wrap {
        flex: 1; min-height: 0;
        margin: 0 -14px;
        overflow: hidden;
        position: relative;
        touch-action: pan-y;
    }
    .ph-home-pages {
        display: flex;
        height: 100%;
        transition: transform .32s cubic-bezier(.22,1,.36,1);
        will-change: transform;
    }
    .ph-home-page {
        flex: 0 0 100%;
        min-width: 100%;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 0 14px 10px;
        box-sizing: border-box;
        -webkit-overflow-scrolling: touch;
    }

    .ph-home-grid {
        display: grid;
        grid-template-columns: repeat(${C.GRID_COLS}, 1fr);
        grid-auto-rows: minmax(68px, auto);
        gap: 4px 4px;
    }
    .ph-home-slot {
        position: relative;
        border-radius: 12px;
        border: 1px dashed rgba(255,255,255,0);
        background: transparent;
        transition: border-color .16s, background .16s;
        min-height: 68px;
    }
    .ph-home-slot.drag-over {
        border-color: rgba(110,231,183,.6);
        background: rgba(52,211,153,.1);
    }
    .ph-home-slot.drag-over::after {
        content: ''; position: absolute; inset: 6px;
        border-radius: 10px;
        background: rgba(52,211,153,.06);
    }

    .ph-home-app {
        position: relative;
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 6px 2px 4px; border-radius: 12px;
        background: transparent; border: none;
        cursor: pointer; font-family: inherit;
        color: inherit; text-align: center;
        transition: background .18s, transform .15s, opacity .15s;
        -webkit-tap-highlight-color: transparent;
        min-height: 68px;
        justify-content: flex-start;
    }
    .ph-home-app:hover { background: rgba(255,255,255,.08); }
    .ph-home-app:active { transform: scale(.94); }
    .ph-home-app[draggable="true"] { cursor: grab; }
    .ph-home-app.dragging { opacity: .3; cursor: grabbing; }
    .ph-home-app.drop-before::before,
    .ph-home-app.drop-after::after {
        content: ''; position: absolute; top: 4px; bottom: 4px; width: 2px;
        background: #6ee7b7; border-radius: 2px;
        box-shadow: 0 0 8px rgba(52,211,153,.8);
        pointer-events: none;
        z-index: 2;
    }
    .ph-home-app.drop-before::before { left: -2px; }
    .ph-home-app.drop-after::after { right: -2px; }
    .ph-home-app-icon {
        width: 42px; height: 42px; border-radius: 13px;
        display: inline-flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,.1);
        border: 1px solid rgba(255,255,255,.14);
        box-shadow: 0 6px 16px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.16);
        position: relative;
        flex-shrink: 0;
    }
    .ph-home-app-icon svg { width: 22px; height: 22px; }
    .ph-home-app-name {
        font-size: 9px; font-weight: 700; color: #dfe3ef;
        max-width: 100%; overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap; letter-spacing: .01em;
        text-shadow: 0 1px 2px rgba(0,0,0,.6);
    }
    .ph-home-empty {
        grid-column: 1 / -1;
        padding: 24px 10px; text-align: center;
        font-size: 10.5px; color: #6b7280; line-height: 1.5;
    }

    .ph-home-dots { display: flex; gap: 5px; justify-content: center; padding: 6px 0 6px; flex-shrink: 0; }
    .ph-home-dots span {
        width: 5px; height: 5px; border-radius: 50%;
        background: rgba(255,255,255,.32);
        cursor: pointer;
        transition: background .2s, transform .2s;
    }
    .ph-home-dots span.active { background: #6ee7b7; box-shadow: 0 0 6px rgba(52,211,153,.8); transform: scale(1.15); }

    .ph-dock {
        flex-shrink: 0;
        margin: 0 -6px;
        padding: 8px 10px 4px;
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(52,211,153,.14), rgba(52,211,153,.05));
        backdrop-filter: blur(16px) saturate(150%);
        -webkit-backdrop-filter: blur(16px) saturate(150%);
        border: 1px solid rgba(52,211,153,.22);
        box-shadow: 0 8px 24px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.08);
        display: grid;
        grid-template-columns: repeat(${C.MAX_DOCK_APPS}, 1fr);
        gap: 4px;
        margin-bottom: 6px;
        min-height: 56px;
    }
    .ph-dock .ph-home-app { padding: 4px 2px; min-height: 0; }
    .ph-dock .ph-home-app-icon { width: 38px; height: 38px; border-radius: 12px; }
    .ph-dock .ph-home-app-icon svg { width: 20px; height: 20px; }
    .ph-dock .ph-home-app-name { display: none; }

    .ph-dock-slot {
        border-radius: 12px;
        border: 1px dashed rgba(255,255,255,0);
        background: transparent;
        transition: border-color .16s, background .16s;
        min-height: 56px;
    }
    .ph-dock-slot.drag-over {
        border-color: rgba(110,231,183,.6);
        background: rgba(52,211,153,.1);
    }

    .ph-app-bar {
        display: flex; align-items: center; gap: 8px;
        padding: 9px 12px; margin: 0 12px 8px;
        border-radius: 11px;
        background: linear-gradient(180deg, #16382c 0%, #0f2820 100%);
        border: 1px solid rgba(52,211,153,.34);
        box-shadow:
            inset 0 1px 0 rgba(110,231,183,.16),
            inset 0 -1px 0 rgba(0,0,0,.4),
            0 6px 16px rgba(0,0,0,.4);
        flex-shrink: 0;
    }
    .ph-app-bar > span.ph-app-title {
        font-size: 12px; font-weight: 800; color: #d1fae5;
        letter-spacing: .02em; text-shadow: 0 1px 2px rgba(0,0,0,.5);
        flex: 1;
    }
    .ph-app-back {
        width: 26px; height: 26px; border-radius: 7px;
        background: transparent; border: none;
        color: #6ee7b7; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        transition: color .15s, background .15s;
        flex-shrink: 0;
    }
    .ph-app-back:hover { color: #a7f3d0; background: rgba(52,211,153,.2); }
    .ph-app-back svg { width: 14px; height: 14px; }

    .ph-app-num {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 4px 9px;
        border-radius: 9px;
        background: rgba(52,211,153,.16);
        border: 1px solid rgba(52,211,153,.34);
        color: #a7f3d0;
        font-family: inherit;
        font-size: 10px; font-weight: 800;
        letter-spacing: .04em;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        transition: background .15s, border-color .15s, transform .12s;
        flex-shrink: 0;
    }
    .ph-app-num:hover { background: rgba(52,211,153,.28); border-color: rgba(52,211,153,.6); }
    .ph-app-num:active { transform: scale(.94); }
    .ph-app-num svg { width: 10px; height: 10px; opacity: .85; }
    .ph-app-num.loading { color: #5c6280; background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.1); letter-spacing: .14em; }

    .ph-tabs {
        display: flex; gap: 2px;
        padding: 6px 10px 0;
        flex-shrink: 0;
        margin: 0 12px 8px;
        background: linear-gradient(180deg, #123028 0%, #0d2320 100%);
        border: 1px solid rgba(52,211,153,.22);
        border-radius: 11px;
        box-shadow:
            inset 0 1px 0 rgba(110,231,183,.1),
            0 6px 16px rgba(0,0,0,.35);
    }
    .ph-tab {
        flex: 1; padding: 8px 0 9px;
        font-size: 8px; font-weight: 800;
        text-transform: uppercase; letter-spacing: .03em;
        color: #8fa79a; background: transparent; border: none; cursor: pointer;
        border-bottom: 2px solid transparent; font-family: inherit;
        transition: color .2s, border-color .2s;
        display: inline-flex; align-items: center; justify-content: center; gap: 3px;
        -webkit-tap-highlight-color: transparent;
    }
    .ph-tab:hover { color: #d1fae5; }
    .ph-tab.active { color: #6ee7b7; border-color: #34d399; }
    .ph-tab .tab-badge {
        display: none;
        min-width: 11px; height: 11px;
        padding: 0 3px;
        border-radius: 6px;
        background: linear-gradient(135deg, #fb7185, #f472b6);
        color: #fff;
        font-size: 7px; font-weight: 900;
        line-height: 11px;
        letter-spacing: 0;
        box-shadow: 0 0 6px rgba(251,113,133,.55);
        animation: phPulseDot 1.8s ease-in-out infinite;
    }
    .ph-tab .tab-badge.on { display: inline-flex; align-items: center; justify-content: center; }

    .ph-content { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }

    .ph-settings { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 14px 14px; }
    .ph-settings-group-title {
        font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
        color: #8890a8; padding: 14px 4px 6px;
    }
    .ph-setting-item {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; padding: 12px 14px;
        background: linear-gradient(180deg, rgba(20,40,32,.92), rgba(12,28,22,.95));
        border: 1px solid rgba(52,211,153,.14);
        border-radius: 12px; margin-bottom: 6px;
        cursor: pointer; font-family: inherit; color: inherit; text-align: left;
        width: 100%;
        box-shadow: inset 0 1px 0 rgba(110,231,183,.08);
        transition: background .2s, border-color .2s, transform .15s;
    }
    .ph-setting-item:hover { background: linear-gradient(180deg, rgba(24,52,40,.98), rgba(16,36,28,.98)); border-color: rgba(52,211,153,.4); }
    .ph-setting-item:active { transform: scale(.985); }
    .ph-setting-item-lbl { font-size: 12px; font-weight: 700; color: #e9ecf5; letter-spacing: .01em; }
    .ph-setting-item-sub { font-size: 9.5px; color: #8fa79a; margin-top: 2px; }
    .ph-setting-item-val { font-size: 10px; font-weight: 800; color: #6ee7b7; letter-spacing: .04em; }
    .ph-setting-item.danger .ph-setting-item-lbl { color: #fca5b1; }
    .ph-setting-item.danger .ph-setting-item-val { color: #fca5b1; }
    .ph-setting-item.danger:hover { border-color: rgba(251,113,133,.4); background: rgba(251,113,133,.08); }

    .ph-pin-modal {
        position: absolute; inset: 0; z-index: 30;
        background: linear-gradient(175deg, rgba(12,28,22,.98), rgba(6,16,12,.99));
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px; padding: 24px;
        animation: phFadeIn .22s ease;
    }
    .ph-pin-modal-title { font-size: 13px; font-weight: 800; color: #e9ecf5; text-align: center; letter-spacing: .02em; }
    .ph-pin-modal-sub { font-size: 10.5px; color: #8fa79a; text-align: center; line-height: 1.5; max-width: 200px; }
    .ph-pin-modal-cancel {
        background: transparent; border: 1px solid rgba(255,255,255,.14);
        color: #a8aec4; font-family: inherit; font-size: 10.5px; font-weight: 700;
        padding: 8px 18px; border-radius: 8px; cursor: pointer;
        transition: background .15s, color .15s, border-color .15s;
    }
    .ph-pin-modal-cancel:hover { background: rgba(255,255,255,.06); color: #e9ecf5; }

    .ph-home-bar {
        padding: 6px 0 8px; flex-shrink: 0; display: flex; justify-content: center;
        position: relative; z-index: 6;
        background: transparent; border: none; width: 100%; cursor: pointer;
        font-family: inherit;
        transition: background .18s, opacity .15s;
        -webkit-tap-highlight-color: transparent;
    }
    .ph-home-bar:hover { background: rgba(255,255,255,.03); }
    .ph-home-bar:active { opacity: .55; }
    .ph-home-bar::before {
        content: ''; width: 100px; height: 4px; border-radius: 2px;
        background: rgba(255,255,255,.28);
        box-shadow: 0 1px 2px rgba(0,0,0,.4);
        transition: background .2s, width .2s;
    }
    .ph-home-bar:hover::before { background: rgba(255,255,255,.5); width: 112px; }
    .ph-home-bar:active::before { background: rgba(110,231,183,.85); }

    .ph-toast { position: absolute; top: 74px; left: 50%; transform: translateX(-50%);
        padding: 8px 14px; border-radius: 9px; font-size: 10.5px; font-weight: 700; letter-spacing: .02em;
        background: linear-gradient(175deg, rgba(16,36,28,.98), rgba(8,20,14,.99));
        border: 1px solid rgba(52,211,153,.5); color: #d1fae5;
        box-shadow: 0 10px 26px rgba(0,0,0,.55), 0 0 24px rgba(52,211,153,.18);
        backdrop-filter: blur(10px); animation: phToastIn .22s cubic-bezier(.22,1,.36,1);
        transition: opacity .2s, transform .2s; z-index: 50; pointer-events: none;
        max-width: 240px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ph-toast.ok { color: #a7f3d0; border-color: rgba(52,211,153,.65); }
    .ph-toast.err { color: #fecdd3; border-color: rgba(251,113,133,.55); }
    .ph-toast.fav { color: #fde68a; border-color: rgba(251,191,36,.6); }
    .ph-toast.out { opacity: 0; transform: translateX(-50%) translateY(-8px); }

    .ph-home[data-icon-size="small"] .ph-home-app-icon { width: 36px; height: 36px; border-radius: 11px; }
    .ph-home[data-icon-size="small"] .ph-home-app-icon svg { width: 18px; height: 18px; }
    .ph-home[data-icon-size="large"] .ph-home-app-icon { width: 48px; height: 48px; border-radius: 14px; }
    .ph-home[data-icon-size="large"] .ph-home-app-icon svg { width: 26px; height: 26px; }
    .ph-home[data-grid-gap="tight"] .ph-home-grid { gap: 2px 2px; }
    .ph-home[data-grid-gap="wide"]  .ph-home-grid { gap: 10px 8px; }

    .ph-ctx-menu {
        position: fixed;
        z-index: 60;
        min-width: 210px;
        padding: 6px;
        border-radius: 12px;
        background: linear-gradient(180deg, rgba(16,36,28,.98), rgba(8,20,14,.99));
        border: 1px solid rgba(52,211,153,.32);
        box-shadow: 0 16px 42px rgba(0,0,0,.7), 0 0 0 1px rgba(0,0,0,.5);
        color: #e9ecf5;
        pointer-events: auto;
        animation: phFadeIn .16s ease;
    }
    .ph-ctx-item {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 12px; border-radius: 8px;
        font-size: 11px; font-weight: 700;
        cursor: pointer; border: none;
        background: transparent; color: inherit;
        width: 100%; text-align: left; font-family: inherit;
        transition: background .12s;
    }
    .ph-ctx-item:hover { background: rgba(52,211,153,.16); }
    .ph-ctx-item .ctx-val { margin-left: auto; color: #6ee7b7; font-weight: 800; font-size: 10px; letter-spacing: .04em; }
    .ph-ctx-sep { height: 1px; margin: 4px 6px; background: rgba(255,255,255,.08); }
    .ph-ctx-label {
        font-size: 9px; font-weight: 800; letter-spacing: .12em;
        text-transform: uppercase; color: #8890a8;
        padding: 8px 12px 4px;
    }

    @media (prefers-reduced-motion: reduce) {
        .ph-frame, .ph-frame.min { transition-duration: .01ms; }
        .ph-frame.ringing, .ph-frame.recording { animation: none !important; }
        .ph-frame.min::after { animation: none !important; }
        .ph-view.active { animation: none !important; }
        .ph-home-pages { transition-duration: .01ms; }
        .ph-home-clock, .ph-home-search { transition-duration: .01ms; }
        .ph-screen.buzz { animation: none !important; }
        .ph-lock-swipe-chevron { animation: none !important; }
        .ph-lock-swipe-icon { animation: none !important; }
        .ph-notif-card { animation: none !important; }
        .ph-frame { transition-duration: .01ms !important; }
    }
    `;
})();
