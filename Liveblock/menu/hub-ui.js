// hub-ui.js — UI do Sang Hub 
(function() {
    'use strict';
    if (window._hubUI) return;
    const B = window._hubBridge;
    if (!B) { console.warn('[hub-ui] _hubBridge ausente'); return; }
    const { util, STATUS, TABS, HUB_VERSION, state } = B;

    const UID = '_hub';
    const ac = new AbortController();
    let _antiLag = B.antiLag;

    // ── SVG/ICO ──
    const MAIN_ICON = `<img src="https://raw.githubusercontent.com/zBeyond5/Liveblock/main/assets/PNG/menu2.png" style="width:30px; height:30px; object-fit:contain;" />`;
    const MAIN_ICON_SM = `<img src="https://raw.githubusercontent.com/zBeyond5/Liveblock/main/assets/PNG/menu2.png" style="width:28px; height:28px; object-fit:contain;" />`;
    const REFRESH_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>`;
    const UPDATE_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    const MIC_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
    const VOL_ON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    const VOL_OFF_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

    // ── Estilos ──
    const style = document.createElement('style');
    style.setAttribute('data-hub', '1');
    style.textContent = `
    @keyframes hubItemIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
    @keyframes hubPulse{0%,100%{opacity:1}50%{opacity:.35}}
    @keyframes hubSpin{to{transform:rotate(360deg)}}
    @keyframes hubShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
    @keyframes hubTitleShine{to{background-position:-200% center}}
    @keyframes hubIconRing{to{--hub-angle:360deg}}
    @keyframes hubPillRing{to{--hub-angle:360deg}}
    @keyframes hubFlashOk{0%{box-shadow:0 0 0 0 rgba(52,211,153,.45)}100%{box-shadow:0 0 0 16px rgba(52,211,153,0)}}
    @keyframes hubFlashErr{0%{box-shadow:0 0 0 0 rgba(251,113,133,.45)}100%{box-shadow:0 0 0 16px rgba(251,113,133,0)}}
    @keyframes _hbMicPulse{0%,100%{transform:translate(-50%,-50%) scale(1);box-shadow:0 0 0 0 rgba(34,211,238,.6)}50%{transform:translate(-50%,-50%) scale(1.02);box-shadow:0 0 0 14px rgba(34,211,238,0)}}
    @keyframes _hubMicShellIn{from{opacity:0;transform:translateX(-50%) translateY(12px) scale(.96)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
    @keyframes _hubMicVibrate{0%{transform:translateX(0)}2%{transform:translateX(-3px)}4%{transform:translateX(3px)}6%{transform:translateX(-3px)}8%{transform:translateX(3px)}10%{transform:translateX(-2px)}12%{transform:translateX(2px)}14%{transform:translateX(-2px)}16%{transform:translateX(2px)}18%{transform:translateX(-1px)}20%{transform:translateX(1px)}22%,100%{transform:translateX(0)}}
    @property --hub-angle{syntax:'<angle>';inherits:false;initial-value:0deg}

    #${UID}{
        --hub-cyan:#22d3ee; --hub-violet:#a78bfa; --hub-grad:linear-gradient(120deg,var(--hub-cyan),var(--hub-violet));
        --hub-ok:#34d399; --hub-err:#fb7185; --hub-muted:#8b8fa3;
        --tx:0deg; --ty:0deg; --rz:0deg; --sc:1; --sx:1; --sy:1; --persp:1200px;
        position:fixed;top:20px;left:20px;width:336px;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;font-size:13px;
        color:#f1f2f8;background:linear-gradient(175deg,rgba(20,20,28,0.92),rgba(9,9,14,0.97));backdrop-filter:blur(18px) saturate(140%);
        border:1px solid rgba(255,255,255,0.08);border-radius:20px;
        box-shadow:0 20px 50px rgba(0,0,0,0.55),0 2px 8px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06);
        z-index:2147483647;overflow:hidden;user-select:none;
        max-height:85vh;display:flex;flex-direction:column;
        isolation:isolate;
        opacity:1;
        transform-origin:50% 50%;
        backface-visibility:hidden;
        transform:
            perspective(var(--persp))
            rotateX(var(--tx))
            rotateY(var(--ty))
            rotate(var(--rz))
            scale(calc(var(--sc) * var(--sx)), calc(var(--sc) * var(--sy)));
        transition:transform .38s cubic-bezier(.22,1,.36,1),
                   opacity .32s cubic-bezier(.22,1,.36,1),
                   visibility 0s}
    #${UID}.hidden{
        opacity:0;pointer-events:none;visibility:hidden;
        --sc:.985;
        transition:transform .3s cubic-bezier(.22,1,.36,1),
                   opacity .3s cubic-bezier(.22,1,.36,1),
                   visibility 0s linear .3s}
    #${UID}.dragging{
        transition:opacity .3s cubic-bezier(.22,1,.36,1),visibility 0s}
    #${UID}::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--hub-grad);
        background-size:200% 100%;animation:hubShimmer 4s linear infinite;z-index:3;pointer-events:none}
    #${UID} .hub-hdr{padding:14px 16px;display:flex;align-items:center;justify-content:space-between;cursor:grab;flex-shrink:0}
    #${UID} .hub-hdr:active{cursor:grabbing}
    #${UID} .hub-brand{display:flex;align-items:center;gap:11px;min-width:0}
    #${UID} .hub-key{flex-shrink:0;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;
        background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);box-shadow:0 0 16px rgba(34,211,238,0.15);padding:5px;box-sizing:border-box}
    #${UID} .hub-title{font-weight:800;font-size:13.5px;letter-spacing:.06em;white-space:nowrap;
        background:linear-gradient(100deg,var(--hub-cyan) 0%,var(--hub-violet) 35%,#fff 50%,var(--hub-violet) 65%,var(--hub-cyan) 100%);
        background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;
        animation:hubTitleShine 3.2s linear infinite}
    #${UID} .hub-subtitle{font-size:9.5px;color:var(--hub-muted);display:flex;align-items:center;gap:5px;margin-top:3px}
    #${UID} .hub-sync-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
    #${UID} .hub-sync-dot.loading{background:var(--hub-cyan);animation:hubPulse 1s infinite}
    #${UID} .hub-sync-dot.synced{background:var(--hub-ok);box-shadow:0 0 6px rgba(52,211,153,0.7)}
    #${UID} .hub-sync-dot.error{background:var(--hub-err)}
    #${UID} .hub-actions{display:flex;gap:6px;flex-shrink:0}
    #${UID} .hub-hbtn{width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
        color:#c7cad6;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;
        transition:color .22s cubic-bezier(.22,1,.36,1),
                   background .22s cubic-bezier(.22,1,.36,1),
                   border-color .22s cubic-bezier(.22,1,.36,1),
                   box-shadow .22s cubic-bezier(.22,1,.36,1),
                   transform .3s cubic-bezier(.22,1,.36,1);flex-shrink:0}
    #${UID} .hub-hbtn:hover{color:#0b0b10;background:var(--hub-grad);border-color:transparent;box-shadow:0 0 14px rgba(34,211,238,0.35);transform:translateY(-1px)}
    #${UID} .hub-hbtn:focus-visible,#${UID} .hub-item:focus-visible,#${UID} .hub-tab:focus-visible{outline:2px solid var(--hub-cyan);outline-offset:2px}
    #${UID} .hub-hbtn.spin svg{animation:hubSpin .6s linear infinite}
    #${UID} .hub-hbtn.listening{color:#0b0b10;background:var(--hub-grad);border-color:transparent;box-shadow:0 0 10px rgba(34,211,238,.5)}
    #${UID} .hub-hbtn.hearing{animation:hubPulse .35s ease-in-out}
    #${UID} .hub-hbtn.cedido{opacity:.4;pointer-events:none}
    #${UID} .hub-hbtn.muted{color:#8b8fa3}
    #${UID} .hub-hbtn.muted svg{opacity:.55}
    #${UID} .hub-tabs{display:flex;gap:4px;padding:0 12px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.06)}
    #${UID} .hub-tab{flex:1;text-align:center;padding:9px 6px 10px;font-size:10.5px;font-weight:800;letter-spacing:.05em;
        text-transform:uppercase;color:var(--hub-muted);background:transparent;border:none;cursor:pointer;position:relative;
        transition:color .22s cubic-bezier(.22,1,.36,1);font-family:inherit}
    #${UID} .hub-tab:hover{color:#d1d5db}
    #${UID} .hub-tab.active{color:#fff}
    #${UID} .hub-tab.active::after{content:'';position:absolute;left:14px;right:14px;bottom:-1px;height:2px;
        background:var(--hub-grad);border-radius:2px}
    #${UID} .hub-body{padding:12px;overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:7px}
    #${UID} .hub-body::-webkit-scrollbar{width:5px}
    #${UID} .hub-body::-webkit-scrollbar-thumb{background:linear-gradient(var(--hub-cyan),var(--hub-violet));border-radius:3px}
    #${UID} .hub-empty,#${UID} .hub-error-box{padding:20px;text-align:center;color:var(--hub-muted);font-size:11px}
    #${UID} .hub-error-box{color:#fca5b1}
    #${UID} .hub-retry{display:inline-block;padding:6px 14px;margin-top:10px;border-radius:8px;
        background:rgba(251,113,133,0.12);border:1px solid rgba(251,113,133,0.35);color:#fca5b1;cursor:pointer;font-size:10px;font-weight:700;
        transition:all .22s cubic-bezier(.22,1,.36,1)}
    #${UID} .hub-item{display:flex;align-items:center;gap:14px;padding:11px 13px;
        border-radius:13px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.05);cursor:pointer;
        transition:background .3s cubic-bezier(.22,1,.36,1),
                   border-color .3s cubic-bezier(.22,1,.36,1),
                   transform .4s cubic-bezier(.22,1,.36,1),
                   box-shadow .4s cubic-bezier(.22,1,.36,1);
        position:relative;overflow:hidden;
        animation:hubItemIn .3s cubic-bezier(.22,1,.36,1) backwards}
    #${UID} .hub-item::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent;transition:background .3s cubic-bezier(.22,1,.36,1)}
    #${UID} .hub-item.state-loaded::before{background:var(--hub-grad)}
    #${UID} .hub-item.state-loading::before{background:var(--hub-cyan);animation:hubPulse 1s infinite}
    #${UID} .hub-item.state-error::before{background:var(--hub-err)}
    #${UID} .hub-item:hover{background:rgba(255,255,255,0.05);border-color:rgba(167,139,250,0.32);
        transform:translateY(-1px);box-shadow:0 8px 20px rgba(0,0,0,0.35),0 0 0 1px rgba(34,211,238,0.08)}
    #${UID} .hub-item:active{transform:translateY(-1px) scale(0.995)}
    #${UID} .hub-item.hub-flash-ok{animation:hubItemIn .3s cubic-bezier(.22,1,.36,1) backwards,hubFlashOk .7s ease-out}
    #${UID} .hub-item.hub-flash-error{animation:hubItemIn .3s cubic-bezier(.22,1,.36,1) backwards,hubFlashErr .7s ease-out}
    #${UID} .hub-item.admin-locked{cursor:not-allowed}
    #${UID} .hub-item.admin-locked::after{content:'Módulo em fase de Testes';
        position:absolute;inset:0;z-index:2;pointer-events:none;
        display:flex;align-items:center;justify-content:center;
        font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
        color:#fca5b1;
        background:linear-gradient(175deg,rgba(8,8,12,.72),rgba(8,8,12,.82));
        backdrop-filter:blur(1.6px);-webkit-backdrop-filter:blur(1.6px);
        text-shadow:0 0 12px rgba(251,113,133,.5)}
    #${UID} .hub-icon{width:48px;height:48px;min-width:48px;min-height:48px;display:flex;align-items:center;justify-content:center;position:relative}
    #${UID} .hub-icon img,#${UID} .hub-icon svg,#${UID} .hub-icon canvas{width:100%;height:100%;object-fit:contain;display:block;border-radius:10px;
        filter:drop-shadow(0 3px 7px rgba(0,0,0,0.4));transition:filter .22s cubic-bezier(.22,1,.36,1)}
    #${UID} .hub-icon [hidden]{display:none !important}
    #${UID} .hub-icon::before{content:'';position:absolute;inset:-6px;border-radius:15px;padding:1.5px;
        background:conic-gradient(from var(--hub-angle),var(--hub-cyan),var(--hub-violet),#fff,var(--hub-violet),var(--hub-cyan));
        -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
        -webkit-mask-composite:xor;mask-composite:exclude;
        opacity:0;transition:opacity .4s cubic-bezier(.22,1,.36,1);animation:hubIconRing 4.5s linear infinite;animation-play-state:paused;pointer-events:none}
    #${UID} .hub-item:hover .hub-icon::before{opacity:.55;animation-play-state:running}
    #${UID} .hub-info{flex:1;min-width:0}
    #${UID} .hub-name{font-weight:700;color:#ffffff;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #${UID} .hub-desc{font-size:9.5px;color:var(--hub-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
    #${UID} .hub-chip{flex-shrink:0;display:flex;align-items:center;gap:5px;font-size:8.5px;font-weight:800;padding:4px 9px;
        border-radius:20px;text-transform:uppercase;letter-spacing:0.06em;border:1px solid transparent}
    #${UID} .hub-chip::before{content:'';width:5px;height:5px;border-radius:50%;flex-shrink:0}
    #${UID} .hub-chip.unloaded{background:rgba(255,255,255,0.04);color:#8b8fa3;border-color:rgba(255,255,255,0.06)}
    #${UID} .hub-chip.unloaded::before{background:#5b5f70}
    #${UID} .hub-chip.loading{background:rgba(34,211,238,0.1);color:var(--hub-cyan);border-color:rgba(34,211,238,0.25)}
    #${UID} .hub-chip.loading::before{background:var(--hub-cyan);animation:hubPulse 1s infinite}
    #${UID} .hub-chip.loaded{background:rgba(52,211,153,0.1);color:var(--hub-ok);border-color:rgba(52,211,153,0.25)}
    #${UID} .hub-chip.loaded::before{background:var(--hub-ok);box-shadow:0 0 5px rgba(52,211,153,0.8)}
    #${UID} .hub-chip.error{background:rgba(251,113,133,0.1);color:var(--hub-err);border-color:rgba(251,113,133,0.25)}
    #${UID} .hub-chip.error::before{background:var(--hub-err)}
    #${UID} .hub-ftr{padding:10px 16px;background:rgba(0,0,0,0.25);border-top:1px solid rgba(255,255,255,0.05);
        font-size:9.5px;color:var(--hub-muted);display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
    #${UID} .hub-toast{position:absolute;left:14px;right:14px;bottom:40px;padding:9px 14px;border-radius:11px;
        font-size:10.5px;font-weight:700;text-align:center;opacity:0;transform:translateY(8px);
        transition:opacity .3s cubic-bezier(.22,1,.36,1),transform .3s cubic-bezier(.22,1,.36,1);
        pointer-events:none;z-index:20;border:1px solid;background:rgba(14,14,20,0.96);backdrop-filter:blur(10px);color:#f3f4f6}
    #${UID} .hub-toast.show{opacity:1;transform:translateY(0)}
    #${UID} .hub-toast.ok{border-color:rgba(52,211,153,0.5);color:#a7f3d0}
    #${UID} .hub-toast.error{border-color:rgba(251,113,133,0.5);color:#fecdd3}
    #${UID} .hub-toast.warn,#${UID} .hub-toast.info{border-color:rgba(34,211,238,0.5);color:#cffafe}

    #${UID}pill{
        --hub-cyan:#22d3ee; --hub-violet:#a78bfa; --hub-grad:linear-gradient(120deg,var(--hub-cyan),var(--hub-violet));
        --tx:0deg; --ty:0deg; --rz:0deg; --sc:1; --sx:1; --sy:1; --persp:900px;
        position:fixed;top:20px;left:20px;width:250px;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;
        border-radius:20px;z-index:2147483647;user-select:none;padding:2px;
        opacity:1;
        transform-origin:50% 50%;
        backface-visibility:hidden;
        transform:
            perspective(var(--persp))
            rotateX(var(--tx))
            rotateY(var(--ty))
            rotate(var(--rz))
            scale(calc(var(--sc) * var(--sx)), calc(var(--sc) * var(--sy)));
        transition:transform .42s cubic-bezier(.22,1,.36,1),
                   opacity .32s cubic-bezier(.22,1,.36,1),
                   visibility 0s}
    #${UID}pill.hidden{
        opacity:0;pointer-events:none;visibility:hidden;
        --sc:.97;
        transition:transform .3s cubic-bezier(.22,1,.36,1),
                   opacity .3s cubic-bezier(.22,1,.36,1),
                   visibility 0s linear .3s}
    #${UID}pill.dragging{
        transition:opacity .3s cubic-bezier(.22,1,.36,1),visibility 0s}
    #${UID}pill:hover:not(.dragging){--sc:1.035}
    #${UID}pill::before{content:'';position:absolute;inset:0;border-radius:20px;padding:2px;
        background:conic-gradient(from var(--hub-angle),var(--hub-cyan),var(--hub-violet),#fff,var(--hub-violet),var(--hub-cyan));
        -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
        -webkit-mask-composite:xor;mask-composite:exclude;
        animation:hubPillRing 6s linear infinite;pointer-events:none;
        box-shadow:0 0 14px rgba(34,211,238,0.35),0 0 22px rgba(167,139,250,0.2);
        transition:box-shadow .5s cubic-bezier(.22,1,.36,1)}
    #${UID}pill:hover:not(.dragging)::before{
        box-shadow:0 0 30px rgba(34,211,238,0.85),
                   0 0 60px rgba(167,139,250,0.6),
                   0 0 100px rgba(34,211,238,0.35)}
    #${UID}pill:hover:not(.dragging) #${UID}pillinner{
        box-shadow:0 26px 62px rgba(0,0,0,0.62),
                   0 0 36px rgba(34,211,238,0.20)}
    #${UID}pill.dragging{cursor:grabbing}

    #${UID}pillinner{display:block;border-radius:18px;cursor:grab;color:#f1f2f8;
        background:linear-gradient(175deg,rgba(20,20,28,0.94),rgba(9,9,14,0.98));
        box-shadow:0 20px 50px rgba(0,0,0,0.55);overflow:hidden;
        transition:box-shadow .5s cubic-bezier(.22,1,.36,1)}
    #${UID}pillinner:active{cursor:grabbing}
    #${UID}pill .hub-p-hdr{padding:11px 13px;display:flex;align-items:center;gap:9px}
    #${UID}pill .hub-p-icon{flex-shrink:0;width:28px;height:28px;border-radius:9px;background:rgba(255,255,255,0.05);
        border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center}
    #${UID}pill .hub-p-icon img{width:16px;height:16px;object-fit:contain}
    #${UID}pill .hub-p-title{flex:1;min-width:0;font-weight:800;font-size:11.5px;letter-spacing:.05em;white-space:nowrap;
        background:linear-gradient(100deg,var(--hub-cyan) 0%,var(--hub-violet) 35%,#fff 50%,var(--hub-violet) 65%,var(--hub-cyan) 100%);
        background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;
        animation:hubTitleShine 3.2s linear infinite}
    #${UID}pill .hub-p-clock{flex-shrink:0;font-size:10px;font-weight:700;color:#e5e7eb;font-variant-numeric:tabular-nums}
    #${UID}pill .hub-p-divider{height:1px;background:rgba(255,255,255,0.06);margin:0 13px}
    #${UID}pill .hub-p-player{margin:9px 13px 0;display:flex;align-items:center;gap:9px;
        background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:10px;padding:7px 8px}
    #${UID}pill .hub-p-player-avatar{width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.05);flex-shrink:0;
        overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;color:#8b8fa3;font-size:13px}
    #${UID}pill .hub-p-player-info{flex:1;min-width:0}
    #${UID}pill .hub-p-player-name{font-size:10.5px;font-weight:700;color:#e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #${UID}pill .hub-p-player-mission{font-size:9px;color:#8b8fa3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
    #${UID}pill .hub-p-stats{margin:9px 13px 11px;display:flex;gap:8px}
    #${UID}pill .hub-p-stat{flex:1;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:6px 8px}
    #${UID}pill .hub-p-stat-label{font-size:8px;color:#8b8fa3;text-transform:uppercase;letter-spacing:.05em}
    #${UID}pill .hub-p-stat-value{font-size:12.5px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
    #${UID}pill .hub-p-stat-value.session{color:var(--hub-cyan)}
    #${UID}pill .hub-p-stat-value.total{color:var(--hub-violet)}

    #${UID} .hub-antilag-btn {
        width: 18px; height: 18px;
        border-radius: 5px;
        display: inline-flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        color: #c7cad6;
        font-size: 10px; line-height: 1;
        cursor: pointer;
        transition: all .18s cubic-bezier(.22,1,.36,1);
        user-select: none;
        font-family: inherit;
    }
    #${UID} .hub-antilag-btn:hover {
        color: #fbbf24;
        border-color: rgba(251,191,36,0.4);
        background: rgba(251,191,36,0.1);
        transform: translateY(-1px);
    }
    #${UID} .hub-antilag-btn.active {
        color: #fbbf24;
        background: rgba(251,191,36,0.15);
        border-color: rgba(251,191,36,0.5);
        box-shadow: 0 0 8px rgba(251,191,36,0.35);
    }

    #${UID}.anti-lag,
    #${UID}pill.anti-lag {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
    }
    #${UID}.anti-lag,
    #${UID}pill.anti-lag {
        background: linear-gradient(175deg, #14141c, #09090e) !important;
    }
    #${UID}.anti-lag::before,
    #${UID}pill.anti-lag::before {
        display: none !important;
    }
    #${UID}.anti-lag .hub-key,
    #${UID}.anti-lag .hub-title,
    #${UID}.anti-lag .hub-item,
    #${UID}.anti-lag .hub-icon::before,
    #${UID}.anti-lag .hub-hbtn,
    #${UID}.anti-lag .hub-tab,
    #${UID}.anti-lag .hub-toast,
    #${UID}pill.anti-lag .hub-p-title,
    #${UID}pill.anti-lag .hub-p-icon {
        animation: none !important;
        transition: none !important;
        box-shadow: none !important;
    }
    #${UID}.anti-lag .hub-title,
    #${UID}pill.anti-lag .hub-p-title {
        background: none !important;
        -webkit-background-clip: unset !important;
        background-clip: unset !important;
        color: #f1f2f8 !important;
    }
    #${UID}.anti-lag .hub-item::before,
    #${UID}.anti-lag .hub-icon::before {
        display: none !important;
    }
    #${UID}.anti-lag .hub-item:hover,
    #${UID}.anti-lag .hub-hbtn:hover,
    #${UID}.anti-lag .hub-item:active,
    #${UID}.anti-lag .hub-btn:active {
        transform: none !important;
        box-shadow: none !important;
    }
    #${UID}pill.anti-lag:hover:not(.dragging) { --sc: 1; }
    #${UID}pill.anti-lag::before { box-shadow: none !important; }
    #${UID}pill.anti-lag:hover:not(.dragging) #${UID}pillinner { box-shadow: 0 20px 50px rgba(0,0,0,0.55) !important; }
    `;
    document.head.appendChild(style);

    // ── DOM ──
    const tabsHtml = TABS.map(t =>
        `<button class="hub-tab${t.id === state.activeTab ? ' active' : ''}" data-tab="${t.id}" role="button" tabindex="0" aria-pressed="${t.id === state.activeTab}">${util.escapeHtml(t.label)}</button>`
    ).join('');

    const root = document.createElement('div');
    root.id = UID;
    root.setAttribute('data-hub', '1');
    root.setAttribute('data-sang-ui', '');
    root.classList.add('hidden');
    root.innerHTML = `
    <div class="hub-hdr" id="${UID}hdr">
        <div class="hub-brand">
            <span class="hub-key">${MAIN_ICON}</span>
            <div>
                <div class="hub-title">SANG HUB</div>
                <div class="hub-subtitle"><span class="hub-sync-dot loading" id="${UID}syncdot"></span><span id="${UID}syncsubtitle">iniciando…</span></div>
            </div>
        </div>
        <div class="hub-actions" id="${UID}actions">
            <div class="hub-hbtn" id="${UID}sfx" title="Som" role="button" tabindex="0">${VOL_ON_SVG}</div>
            <div class="hub-hbtn" id="${UID}voice" title="Voz" role="button" tabindex="0">${MIC_SVG}</div>
            <div class="hub-hbtn" id="${UID}update" title="Auto-update" role="button" tabindex="0">${UPDATE_SVG}</div>
            <div class="hub-hbtn" id="${UID}refresh" title="Recarregar manifesto" role="button" tabindex="0">${REFRESH_SVG}</div>
            <div class="hub-hbtn" id="${UID}min" title="Minimizar" role="button" tabindex="0">−</div>
            <div class="hub-hbtn" id="${UID}cls" title="Fechar" role="button" tabindex="0">✕</div>
        </div>
    </div>
    <div class="hub-tabs" id="${UID}tabs">${tabsHtml}</div>
    <div class="hub-body" id="${UID}list"></div>
    <div class="hub-ftr">
        <span>v${HUB_VERSION}</span>
        <span id="${UID}ftrmid">·</span>
        <span style="display:inline-flex;align-items:center;gap:7px;">
            <span class="hub-antilag-btn" id="${UID}antilag" title="Modo anti-lag (desligar efeitos)" role="button" tabindex="0">⚡</span>
            <span>Alt+Shift+H</span>
        </span>
    </div>
    <div class="hub-toast" id="${UID}toast"></div>
    `;
    document.body.appendChild(root);

    const pill = document.createElement('div');
    pill.id = UID + 'pill';
    pill.setAttribute('data-hub', '1');
    pill.setAttribute('data-sang-ui', '');
    pill.innerHTML = `
    <div id="${UID}pillinner">
        <div class="hub-p-hdr">
            <span class="hub-p-icon">${MAIN_ICON_SM}</span>
            <span class="hub-p-title">SANG HUB</span>
            <span class="hub-p-clock" id="${UID}clock">--:--</span>
        </div>
        <div class="hub-p-divider"></div>
        <div class="hub-p-player">
            <span class="hub-p-player-avatar" id="${UID}playeravatar">👤</span>
            <div class="hub-p-player-info">
                <div class="hub-p-player-name" id="${UID}playername">—</div>
                <div class="hub-p-player-mission" id="${UID}playermission">—</div>
            </div>
        </div>
        <div class="hub-p-stats">
            <div class="hub-p-stat"><div class="hub-p-stat-label">Sessão</div><div class="hub-p-stat-value session" id="${UID}sessiontime">00:00:00</div></div>
            <div class="hub-p-stat"><div class="hub-p-stat-label">Total</div><div class="hub-p-stat-value total" id="${UID}totaltime">00:00:00</div></div>
        </div>
    </div>`;
    document.body.appendChild(pill);

    // ── SFX nos botões ──
    root.querySelectorAll('.hub-hbtn, .hub-tab').forEach(n =>
        n.addEventListener('mouseenter', () => window._hubSFX?.hover?.(), { signal: ac.signal }));
    pill.addEventListener('mouseenter', () => window._hubSFX?.expand?.(), { signal: ac.signal });

    // ── Referências ──
    const listEl = root.querySelector('#' + UID + 'list');
    const syncDot = root.querySelector('#' + UID + 'syncdot');
    const syncSubtitle = root.querySelector('#' + UID + 'syncsubtitle');
    const ftrMid = root.querySelector('#' + UID + 'ftrmid');
    const toastEl = root.querySelector('#' + UID + 'toast');
    const clockEl = pill.querySelector('#' + UID + 'clock');
    const sessionEl = pill.querySelector('#' + UID + 'sessiontime');
    const totalEl = pill.querySelector('#' + UID + 'totaltime');
    const nameEl = pill.querySelector('#' + UID + 'playername');
    const missionEl = pill.querySelector('#' + UID + 'playermission');
    const avatarEl = pill.querySelector('#' + UID + 'playeravatar');
    const btnSfx = root.querySelector('#' + UID + 'sfx');
    const btnVoice = root.querySelector('#' + UID + 'voice');
    const btnAntilag = root.querySelector('#' + UID + 'antilag');

    // ── Toast ──
    let toastTm = null;
    function toast(msg, kind) {
        toastEl.textContent = msg;
        toastEl.className = 'hub-toast show ' + (kind || 'info');
        clearTimeout(toastTm);
        toastTm = setTimeout(() => toastEl.classList.remove('show'), 2200);
    }

    // ── Ícone GIF / parse ──
    function setupGifIcon(item, canvas, liveImg, originalUrl) {
        const c2d = canvas.getContext('2d');
        const probe = new Image();
        probe.src = originalUrl;
        probe.onload = () => { canvas.width = probe.naturalWidth || 32; canvas.height = probe.naturalHeight || 32; c2d.drawImage(probe, 0, 0); };
        let playTimer = null;
        const play = () => { liveImg.src = originalUrl; liveImg.hidden = false; canvas.hidden = true; clearTimeout(playTimer); playTimer = setTimeout(stop, 2000); };
        const stop = () => { clearTimeout(playTimer); liveImg.hidden = true; canvas.hidden = false; };
        item.addEventListener('mouseenter', play);
        item.addEventListener('mouseleave', stop);
    }
    function parseIcon(icon) {
        if (!icon) return '<span style="font-size:26px;">📦</span>';
        icon = icon.trim();
        if (/^<svg/i.test(icon)) return icon;
        if (/^https?:\/\//i.test(icon) || /^data:image/i.test(icon) || /\.(png|svg|jpg|jpeg|webp)(\?.*)?$/i.test(icon))
            return `<img src="${icon}" alt="icon" />`;
        if (/\.gif(\?.*)?$/i.test(icon))
            return `<canvas class="hub-gif-frozen"></canvas><img class="hub-gif-live" data-original="${icon}" alt="icon" hidden />`;
        return icon;
    }
    function modulesForTab(tabId) {
        return (state.manifest.modules || []).filter(m => {
            if (m.enabled === false || m.secret === true) return false;
            const isMisc = m.misc === true;
            return tabId === 'misc' ? isMisc : !isMisc;
        });
    }

    // ── Render lista ──
    function renderList() {
        listEl.innerHTML = '';
        if (state.syncState === 'error' && !state.manifest.modules.length) {
            listEl.innerHTML = `<div class="hub-error-box">Erro ao carregar manifesto.<div class="hub-retry" id="${UID}retry" role="button" tabindex="0">Tentar novamente</div></div>`;
            const r = listEl.querySelector('#' + UID + 'retry');
            r.addEventListener('mouseenter', () => window._hubSFX?.hover?.());
            r.addEventListener('click', () => B.refreshManifest(true));
            return;
        }
        const visible = modulesForTab(state.activeTab);
        if (!visible.length) {
            listEl.innerHTML = `<div class="hub-empty">${state.activeTab === 'misc' ? 'Nenhum adicional.' : 'Nenhum módulo.'}</div>`;
            return;
        }
        visible.forEach((mod, idx) => {
            const status = state.moduleStates[mod.id] || STATUS.UNLOADED;
            const isAdminMod = mod.admin === true;
            const adminLocked = isAdminMod && !B.admin.unlocked();
            const item = document.createElement('div');
            item.className = 'hub-item state-' + status + (adminLocked ? ' admin-locked' : '');
            item.dataset.modId = mod.id;
            item.style.animationDelay = Math.min(idx * 32, 220) + 'ms';
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
            item.innerHTML = `
                <div class="hub-icon">${parseIcon(mod.icon)}</div>
                <div class="hub-info">
                    <div class="hub-name">${util.escapeHtml(mod.name)}</div>
                    <div class="hub-desc">${util.escapeHtml(mod.description || '')}</div>
                </div>
                <span class="hub-chip ${status}">${status === STATUS.UNLOADED ? 'OFF' : status === STATUS.LOADING ? '...' : status === STATUS.LOADED ? 'ATIVO' : 'ERR'}</span>
            `;
            const c = item.querySelector('.hub-gif-frozen');
            const l = item.querySelector('.hub-gif-live');
            if (c && l) setupGifIcon(item, c, l, l.getAttribute('data-original'));
            item.addEventListener('mouseenter', () => window._hubSFX?.hover?.());
            item.addEventListener('click', () => B.handleModuleClick(mod));
            listEl.appendChild(item);
        });
    }
    function renderChrome() {
        syncDot.className = 'hub-sync-dot ' + state.syncState;
        syncSubtitle.textContent = state.syncState === 'loading' ? 'sincronizando…' :
                                   state.syncState === 'synced' ? 'sync ' + (state.lastSyncAt || '') : 'falha';
        ftrMid.textContent = state.manifest.version ? 'v' + state.manifest.version : '·';
    }
    function flashItem(modId, kind) {
        const el = root.querySelector('.hub-item[data-mod-id="' + CSS.escape(String(modId)) + '"]');
        if (!el) return;
        const cls = 'hub-flash-' + kind;
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), 700);
    }

    // ── Tabs ──
    const tabsEl = root.querySelector('#' + UID + 'tabs');
    function setActiveTab(tabId) {
        if (state.activeTab === tabId) return;
        state.activeTab = tabId;
        tabsEl.querySelectorAll('.hub-tab').forEach(btn => {
            const a = btn.dataset.tab === tabId;
            btn.classList.toggle('active', a);
            btn.setAttribute('aria-pressed', String(a));
        });
        renderList();
    }
    tabsEl.querySelectorAll('.hub-tab').forEach(btn =>
        btn.addEventListener('click', () => setActiveTab(btn.dataset.tab), { signal: ac.signal }));

    // ── Drag ──
    let _dragOff = null, _dragTarget = null, _dragCurrent = null, _dragVel = { x: 0, y: 0 }, _dragRaf = null;
    let _pDragOff = null, _pDragTarget = null, _pDragCurrent = null, _pDragVel = { x: 0, y: 0 }, _pDragRaf = null, _pDragMoved = false;
    let _dragDropPending = false, _pDragDropPending = false, _crossfadeTimer = null;
    function _resetTf(el) {
        el.style.setProperty('--tx', '0deg'); el.style.setProperty('--ty', '0deg');
        el.style.setProperty('--rz', '0deg'); el.style.setProperty('--sx', '1'); el.style.setProperty('--sy', '1');
    }
    function _cancelDrags() {
        if (_dragRaf)  { cancelAnimationFrame(_dragRaf);  _dragRaf  = null; }
        if (_pDragRaf) { cancelAnimationFrame(_pDragRaf); _pDragRaf = null; }
        if (_dragOff) window._hubSFX?.endDrag?.();
        if (_pDragOff) window._hubSFX?.endDrag?.();
        _dragOff = _dragTarget = _dragCurrent = null;
        _pDragOff = _pDragTarget = _pDragCurrent = null;
        _pDragMoved = false;
        _dragDropPending = _pDragDropPending = false;
        root.classList.remove('dragging');
        pill.classList.remove('dragging');
        _resetTf(root); _resetTf(pill);
    }
    function syncPos(from, to) {
        const r = from.getBoundingClientRect();
        to.style.left = r.left + 'px'; to.style.top = r.top + 'px';
    }
    function showPanel() {
        _cancelDrags();
        if (!pill.classList.contains('hidden')) {
            syncPos(pill, root);
            pill.classList.add('hidden');
            window._hubSFX?.whoosh?.('open');
            clearTimeout(_crossfadeTimer);
            _crossfadeTimer = setTimeout(() => {
                root.classList.remove('hidden');
                root.querySelectorAll('.hub-item').forEach((it, i) => {
                    it.style.animationDelay = Math.min(i * 28, 200) + 'ms';
                });
            }, 90);
        } else {
            syncPos(pill, root);
            window._hubSFX?.whoosh?.('open');
            root.classList.remove('hidden');
        }
    }
    function showPill() {
        _cancelDrags();
        if (!root.classList.contains('hidden')) {
            syncPos(root, pill);
            window._hubSFX?.whoosh?.('close');
            root.classList.add('hidden');
            clearTimeout(_crossfadeTimer);
            _crossfadeTimer = setTimeout(() => pill.classList.remove('hidden'), 90);
        } else {
            syncPos(root, pill);
            window._hubSFX?.whoosh?.('close');
            pill.classList.remove('hidden');
        }
    }
    function hideAll() { _cancelDrags(); root.classList.add('hidden'); pill.classList.add('hidden'); }
    function onKeyActivate(h) { return (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); h(); } }; }
    function _squashScale(vx, vy, maxAmount) {
        const s = Math.min(Math.hypot(vx, vy) * 0.006, maxAmount);
        return { sx: 1 + s, sy: 1 - s };
    }
    function _dragLoop() {
        if (!_dragTarget || !_dragCurrent) { _dragRaf = null; return; }
        const S = 0.16, D = 0.72;
        const dx = _dragTarget.x - _dragCurrent.x, dy = _dragTarget.y - _dragCurrent.y;
        _dragVel.x = (_dragVel.x + dx * S) * D;
        _dragVel.y = (_dragVel.y + dy * S) * D;
        _dragCurrent.x += _dragVel.x; _dragCurrent.y += _dragVel.y;
        root.style.left = _dragCurrent.x + 'px'; root.style.top = _dragCurrent.y + 'px';
        const rot = Math.max(-2.5, Math.min(2.5, _dragVel.x * 0.4));
        const { sx, sy } = _squashScale(_dragVel.x, _dragVel.y, 0.015);
        root.style.setProperty('--rz', rot.toFixed(2) + 'deg');
        root.style.setProperty('--sx', sx.toFixed(3));
        root.style.setProperty('--sy', sy.toFixed(3));
        const dist = Math.hypot(dx, dy) + Math.hypot(_dragVel.x, _dragVel.y);
        if (_dragOff || dist > 0.4) _dragRaf = requestAnimationFrame(_dragLoop);
        else {
            _resetTf(root);
            if (_dragDropPending) { _dragDropPending = false; window._hubSFX?.drop?.(); }
            _dragRaf = null;
        }
    }
    function _pDragLoop() {
        if (!_pDragTarget || !_pDragCurrent) { _pDragRaf = null; return; }
        const S = 0.22, D = 0.70;
        const dx = _pDragTarget.x - _pDragCurrent.x, dy = _pDragTarget.y - _pDragCurrent.y;
        _pDragVel.x = (_pDragVel.x + dx * S) * D;
        _pDragVel.y = (_pDragVel.y + dy * S) * D;
        _pDragCurrent.x += _pDragVel.x; _pDragCurrent.y += _pDragVel.y;
        pill.style.left = _pDragCurrent.x + 'px'; pill.style.top = _pDragCurrent.y + 'px';
        const rot = Math.max(-4, Math.min(4, _pDragVel.x * 0.7));
        const { sx, sy } = _squashScale(_pDragVel.x, _pDragVel.y, 0.022);
        pill.style.setProperty('--rz', rot.toFixed(2) + 'deg');
        pill.style.setProperty('--sx', sx.toFixed(3));
        pill.style.setProperty('--sy', sy.toFixed(3));
        const dist = Math.hypot(dx, dy) + Math.hypot(_pDragVel.x, _pDragVel.y);
        if (_pDragOff || dist > 0.4) _pDragRaf = requestAnimationFrame(_pDragLoop);
        else {
            _resetTf(pill);
            if (_pDragDropPending) { _pDragDropPending = false; window._hubSFX?.drop?.(); }
            _pDragRaf = null;
        }
    }
    const hdr = root.querySelector('#' + UID + 'hdr');
    hdr.addEventListener('mousedown', e => {
        if (e.target.closest('.hub-hbtn')) return;
        const r = root.getBoundingClientRect();
        root.style.setProperty('--tx', '0deg'); root.style.setProperty('--ty', '0deg');
        _dragOff = { ox: e.clientX - r.left, oy: e.clientY - r.top };
        _dragTarget = { x: r.left, y: r.top }; _dragCurrent = { x: r.left, y: r.top };
        _dragVel = { x: 0, y: 0 }; _dragDropPending = true;
        root.style.left = r.left + 'px'; root.style.top = r.top + 'px';
        root.classList.add('dragging');
        window._hubSFX?.beginDrag?.(); window._hubSFX?.pickup?.();
        if (!_dragRaf) _dragRaf = requestAnimationFrame(_dragLoop);
    }, { signal: ac.signal });
    document.addEventListener('mousemove', e => {
        if (!_dragOff || !_dragTarget) return;
        _dragTarget.x = Math.max(0, e.clientX - _dragOff.ox);
        _dragTarget.y = Math.max(0, e.clientY - _dragOff.oy);
    }, { signal: ac.signal });
    document.addEventListener('mouseup', () => {
        if (_dragOff) { window._hubSFX?.endDrag?.(); _resetTf(root); root.classList.remove('dragging'); }
        _dragOff = null;
    }, { signal: ac.signal });

    const pillInner = pill.querySelector('#' + UID + 'pillinner');
    pillInner.addEventListener('mousedown', e => {
        const r = pill.getBoundingClientRect();
        pill.style.setProperty('--tx', '0deg'); pill.style.setProperty('--ty', '0deg');
        _pDragOff = { ox: e.clientX - r.left, oy: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
        _pDragTarget = { x: r.left, y: r.top }; _pDragCurrent = { x: r.left, y: r.top };
        _pDragVel = { x: 0, y: 0 }; _pDragMoved = false; _pDragDropPending = true;
        pill.classList.add('dragging');
        pill.style.left = r.left + 'px'; pill.style.top = r.top + 'px';
        window._hubSFX?.beginDrag?.(); window._hubSFX?.pickup?.();
        if (!_pDragRaf) _pDragRaf = requestAnimationFrame(_pDragLoop);
    }, { signal: ac.signal });
    document.addEventListener('mousemove', e => {
        if (!_pDragOff || !_pDragTarget) return;
        if (Math.abs(e.clientX - _pDragOff.sx) > 3 || Math.abs(e.clientY - _pDragOff.sy) > 3) _pDragMoved = true;
        _pDragTarget.x = Math.max(0, e.clientX - _pDragOff.ox);
        _pDragTarget.y = Math.max(0, e.clientY - _pDragOff.oy);
    }, { signal: ac.signal });
    document.addEventListener('mouseup', () => {
        if (_pDragOff) {
            if (!_pDragMoved) showPanel();
            window._hubSFX?.endDrag?.(); _resetTf(pill);
        }
        _pDragOff = null;
        pill.classList.remove('dragging');
    }, { signal: ac.signal });
    pillInner.addEventListener('keydown', onKeyActivate(showPanel), { signal: ac.signal });

    // ── Botões topo ──
    function _updateSfxBtn() {
        const muted = window._hubSFX?.isMuted?.() || false;
        btnSfx.classList.toggle('muted', muted);
        btnSfx.innerHTML = muted ? VOL_OFF_SVG : VOL_ON_SVG;
        btnSfx.title = muted ? 'Som desligado (clique para ativar)' : 'Som ligado (clique para silenciar)';
    }
    btnSfx.addEventListener('click', () => {
        window._hubSFX?.toggleMute?.();
        _updateSfxBtn();
        if (!window._hubSFX?.isMuted?.()) window._hubSFX?.toggleOn?.();
    }, { signal: ac.signal });
    _updateSfxBtn();

    root.querySelector('#' + UID + 'min').addEventListener('click', showPill, { signal: ac.signal });
    root.querySelector('#' + UID + 'cls').addEventListener('click', hideAll, { signal: ac.signal });
    root.querySelector('#' + UID + 'refresh').addEventListener('click', () => B.refreshManifest(true), { signal: ac.signal });
    root.querySelector('#' + UID + 'update').addEventListener('click', () => { toast('Verificando…', 'info'); B.autoUpdateLoop(); }, { signal: ac.signal });

    // ── Anti-lag ──
    function _aplicarAntiLag(on) {
        root.classList.toggle('anti-lag', !!on);
        pill.classList.toggle('anti-lag', !!on);
        btnAntilag.classList.toggle('active', !!on);
        btnAntilag.title = on ? 'Modo anti-lag ATIVO (clique para desligar)' : 'Modo anti-lag (desligar efeitos)';
    }
    _aplicarAntiLag(_antiLag);
    btnAntilag.addEventListener('click', () => {
        _antiLag = !_antiLag;
        B.setAntiLag(_antiLag);
        _aplicarAntiLag(_antiLag);
        if (!_antiLag) window._hubSFX?.toggleOn?.(); else window._hubSFX?.toggleOff?.();
        toast(_antiLag ? 'Modo anti-lag ativado' : 'Modo anti-lag desativado', _antiLag ? 'ok' : 'info');
    }, { signal: ac.signal });
    btnAntilag.addEventListener('mouseenter', () => window._hubSFX?.hover?.(), { signal: ac.signal });

    window.addEventListener('sang:antilag-changed', (e) => {
        _antiLag = !!e.detail?.active;
        _aplicarAntiLag(_antiLag);
    }, { signal: ac.signal });

    // ── Voz — botão ──
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null, voiceActive = false, lastVoiceAt = 0;
    let vozHabilitado = !!(window._voz?.habilitado);
    function updateVoiceBtn() {
        btnVoice.classList.toggle('listening', voiceActive);
        btnVoice.classList.toggle('cedido', vozHabilitado);
    }
    function ensureRecognition() {
        if (recognition) return recognition;
        recognition = new SpeechRecognitionAPI();
        recognition.lang = 'pt-BR';
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.onresult = e => {
            const now = Date.now();
            if (now - lastVoiceAt < 1200) return;
            lastVoiceAt = now;
            B.handleVoiceCommand(e.results[e.results.length - 1][0].transcript);
        };
        recognition.onerror = () => { voiceActive = false; updateVoiceBtn(); };
        recognition.onend = () => { if (!voiceActive || vozHabilitado) return; try { recognition.start(); } catch(e) {} };
        return recognition;
    }
    function setVoiceActive(on) {
        voiceActive = on;
        updateVoiceBtn();
        on ? window._hubSFX?.toggleOn?.() : window._hubSFX?.toggleOff?.();
        try { localStorage.setItem('sanghub_voice_enabled', on ? '1' : '0'); } catch(e) {}
        const rec = ensureRecognition();
        if (on) { if (!vozHabilitado) try { rec.start(); } catch(e) {} }
        else try { rec.stop(); } catch(e) {}
    }
    if (!SpeechRecognitionAPI) btnVoice.style.display = 'none';
    else {
        btnVoice.addEventListener('click', () => setVoiceActive(!voiceActive), { signal: ac.signal });
        window.addEventListener('sang:voz-state', (e) => {
            const novo = !!e?.detail?.habilitado;
            if (novo === vozHabilitado) return;
            vozHabilitado = novo;
            if (vozHabilitado && voiceActive && recognition) try { recognition.stop(); } catch(_) {}
            else if (!vozHabilitado && voiceActive && recognition) try { recognition.start(); } catch(_) {}
            updateVoiceBtn();
        }, { signal: ac.signal });
        try { if (localStorage.getItem('sanghub_voice_enabled') === '1') setVoiceActive(true); } catch(_) {}
        updateVoiceBtn();
    }

    // ── Player info na pill ──
    function aplicarInfoJogadorNaPill() {
        const c = util.loadPlayerCache();
        if (!c) return;
        nameEl.textContent = c.name || '—';
        missionEl.textContent = c.mission || '—';
        if (c.avatarUrl) {
            avatarEl.innerHTML = `<img src="${c.avatarUrl}" style="position:absolute;top:-25%;left:-40%;width:210%;height:210%;object-fit:cover" alt="avatar" />`;
        }
    }
    aplicarInfoJogadorNaPill();
    window.addEventListener('sang:player-updated', aplicarInfoJogadorNaPill, { signal: ac.signal });

 // ── Pill stats ──
function renderPillStats() {
    clockEl.textContent = util.formatClock();
    const getP = util.getPlaytime || (() => ({ session: 0, total: 0 }));
    const p = getP();
    sessionEl.textContent = util.formatDuration(p.session || 0);
    totalEl.textContent = util.formatDuration(p.total || 0);
}
    const clockTimer = setInterval(() => {
        if (state.killFlag) return;
        if (!pill.classList.contains('hidden')) renderPillStats();
    }, 1000);
    renderPillStats();

    // ── Atalho Alt+Shift+H ──
    document.addEventListener('keydown', e => {
        if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'h') {
            e.preventDefault();
            root.classList.contains('hidden') ? showPanel() : showPill();
        }
    }, { signal: ac.signal });

    // ── Reação a mudanças ──
    window.addEventListener('sang:hub-ui-update', (e) => {
        const r = e.detail?.reason;
        if (r === 'state' || r === 'manifest') renderList();
        if (r === 'manifest' || r === 'chrome') renderChrome();
    }, { signal: ac.signal });

    window.addEventListener('sang:module-close', (e) => {
        const id = e?.detail?.id;
        if (!id || state.moduleStates[id] !== STATUS.LOADED) return;
        state.moduleStates[id] = STATUS.UNLOADED;
        renderList();
        flashItem(id, 'ok');
    }, { signal: ac.signal });

    window.addEventListener('sang:admin-state', () => renderList(), { signal: ac.signal });

    renderList();
    renderChrome();
    showPill();

    // ── kill ──
    function kill() {
        _cancelDrags();
        clearTimeout(_crossfadeTimer);
        clearInterval(clockTimer);
        B.limparHandlerVoz?.();
        state.killFlag = true;
        voiceActive = false;
        if (recognition) try { recognition.stop(); } catch(e) {}
        ac.abort();
        try { root.remove(); } catch(_) {}
        try { pill.remove(); } catch(_) {}
        try { style.remove(); } catch(_) {}
        delete window._hubUI;
    }

    window._hubUI = {
        kill, toast, flashItem, showPanel, showPill, hideAll, renderList, renderChrome
    };
    B.ui = { toast, flashItem, showPanel, showPill, hideAll, renderList, renderChrome };
})();
