// modules/phone/core.js
// Infraestrutura e frame: helpers DOM, som, ícones, toast, registry de apps,
// host+shadow, frame do celular, roteador de views.
// NÃO tem lógica de home, PIN ou abrir app.
(function() {
    'use strict';
    const ctx = window._phoneCtx = window._phoneCtx || {};
    const P   = ctx._phone   = ctx._phone   || {};
    if (!P.config || !P.state) { console.warn('[Phone/core] shell.js não inicializado.'); return; }
    if (P.core) return;

    const C = P.config;
    const S = P.state;

    // DOM HELPERS
    function el(tag, attrs, ...children) {
        const n = document.createElement(tag);
        if (attrs) for (const k in attrs) {
            if (k === 'class') n.className = attrs[k];
            else if (k === 'html') n.innerHTML = attrs[k];
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
            else n.setAttribute(k, attrs[k]);
        }
        children.flat().forEach(c => {
            if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return n;
    }
    const esc = s => String(s ?? '').replace(/[&<>"']/g,
        c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    ctx.el  = el;
    ctx.esc = esc;

    // AUDIO
    let _actx = null;
    function _getAudioCtx() {
        if (_actx) {
            // ctx fechado (após teardown) → recria
            if (_actx.state === 'closed') _actx = null;
            else return _actx;
        }
        try { _actx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch(e) { _actx = null; }
        return _actx;
    }
    ctx.getAudioCtx = _getAudioCtx;

    function _tone(freq, dur, type, peak, attack) {
        const c = _getAudioCtx();
        if (!c) return;
        if (c.state === 'suspended') c.resume().catch(() => {});
        const now  = c.currentTime;
        const osc  = c.createOscillator();
        const lp   = c.createBiquadFilter();
        const gain = c.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, now);
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(Math.min(freq * 2.6, 3200), now);
        lp.Q.setValueAtTime(0.6, now);
        const a = attack != null ? attack : 0.02;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(peak || 0.04, now + a);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(lp).connect(gain).connect(c.destination);
        osc.start(now);
        osc.stop(now + dur + 0.03);
    }

    ctx.tone = {
        raw: _tone,
        ringback()  { _tone(425, 1.0, 'sine', 0.045, 0.03); },
        ring() {
            const c = _getAudioCtx(); if (!c) return;
            if (c.state === 'suspended') c.resume().catch(() => {});
            const now = c.currentTime;
            [425, 480].forEach(f => {
                const osc = c.createOscillator(); const gain = c.createGain();
                osc.type = 'sine'; osc.frequency.setValueAtTime(f, now);
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.035, now + 0.03);
                gain.gain.setValueAtTime(0.035, now + 0.72);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
                osc.connect(gain).connect(c.destination);
                osc.start(now); osc.stop(now + 0.83);
            });
        },
        busy()      { _tone(425, 0.25, 'sine', 0.05, 0.015); },
        hangup()    { _tone(320, 0.14, 'sine', 0.04, 0.006); setTimeout(() => _tone(240, 0.16, 'sine', 0.03, 0.008), 90); },
        dial()      { _tone(425, 0.08, 'sine', 0.035, 0.01); },
        key()       { _tone(880, 0.035, 'sine', 0.02, 0.006); },
        pickup()    { _tone(659.25, 0.09, 'sine', 0.03, 0.012); setTimeout(() => _tone(987.77, 0.13, 'sine', 0.025, 0.014), 70); },
        notify()    { _tone(880, 0.06, 'sine', 0.03, 0.01); setTimeout(() => _tone(1174.66, 0.09, 'sine', 0.025, 0.012), 55); },
        join()      { _tone(783.99, 0.07, 'sine', 0.028, 0.01); setTimeout(() => _tone(1046.5, 0.09, 'sine', 0.022, 0.012), 60); },
        tuck()      { _tone(660, 0.09, 'sine', 0.018, 0.012); setTimeout(() => _tone(440, 0.12, 'sine', 0.014, 0.014), 60); },
        pull()      { _tone(660, 0.08, 'sine', 0.02, 0.01); setTimeout(() => _tone(880, 0.1, 'sine', 0.018, 0.012), 70); setTimeout(() => _tone(1174.66, 0.12, 'sine', 0.014, 0.014), 150); },
        recStart()  { _tone(587.33, 0.06, 'sine', 0.024, 0.008); setTimeout(() => _tone(880, 0.06, 'sine', 0.02, 0.01), 55); },
        recSend()   { _tone(1046.5, 0.07, 'sine', 0.024, 0.008); setTimeout(() => _tone(1318.51, 0.09, 'sine', 0.02, 0.01), 55); },
        recCancel() { _tone(392, 0.08, 'sine', 0.022, 0.01); setTimeout(() => _tone(261.63, 0.1, 'sine', 0.018, 0.012), 60); },
        block()     { _tone(220, 0.12, 'sine', 0.026, 0.008); setTimeout(() => _tone(174.61, 0.13, 'sine', 0.02, 0.01), 80); },
        fav()       { _tone(1318.51, 0.06, 'sine', 0.02, 0.006); setTimeout(() => _tone(1760, 0.08, 'sine', 0.016, 0.008), 55); },
        unlock()    { _tone(659.25, 0.08, 'sine', 0.026, 0.012); setTimeout(() => _tone(987.77, 0.11, 'sine', 0.022, 0.014), 60); },
        errorPin()  { _tone(220, 0.1, 'sine', 0.03, 0.008); setTimeout(() => _tone(180, 0.14, 'sine', 0.024, 0.01), 70); },
        home()      { _tone(523.25, 0.05, 'sine', 0.02, 0.008); }
    };

    // ICONS
    ctx.I = {
        phone:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
        phoneDown:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
        micOff:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="21" y2="21"/><path d="M12 1a3 3 0 0 0-3 3v5"/><path d="M15 9v3a3 3 0 0 1-4.29 2.71"/><path d="M19 10v2a7 7 0 0 1-1.32 4.13"/><path d="M5 10v2a7 7 0 0 0 3 5.71"/><line x1="12" y1="19" x2="12" y2="23"/></svg>`,
        mic:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
        off:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
        backspace:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>`,
        clear:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
        save:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
        copy:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
        plus:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
        arrowIn:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(135deg)"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
        arrowOut:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(-45deg)"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
        star:       `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/></svg>`,
        starOutline:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/></svg>`,
        block:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
        note:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>`,
        apps:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
        back:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
        gear:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        lock:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></svg>`,
        unlock:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0"/></svg>`,
        search:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>`,
        wifi:       `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 18a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 12.5a10 10 0 0 1 14 0l-1.5 1.5a8 8 0 0 0-11 0L5 12.5zm-3.5-3.5a15 15 0 0 1 21 0l-1.5 1.5a13 13 0 0 0-18 0L1.5 9z"/></svg>`
    };

    // TOAST
    function _toast(msg, kind) {
        if (!S.screenEl || !S.screenEl.isConnected) return;
        const t = el('div', { class: 'ph-toast' + (kind ? ' ' + kind : '') }, msg);
        S.screenEl.appendChild(t);
        setTimeout(() => { try { t.classList.add('out'); } catch(_) {} }, 1800);
        setTimeout(() => { try { t.remove(); } catch(_) {} }, 2100);
    }
    ctx.toast = _toast;

    // APPS REGISTRY
    ctx.apps = ctx.apps || {
        _registry:  [],
        _listeners: [],
        register(app) {
            if (!app || !app.id || !app.mount) return false;
            if (this._registry.find(a => a.id === app.id)) return false;
            this._registry.push(app);
            this._registry.sort((a, b) => (a.order || 100) - (b.order || 100));
            this._notify();
            return true;
        },
        get(id) { return this._registry.find(a => a.id === id) || null; },
        all()   { return this._registry.slice(); },
        onChange(fn) { if (typeof fn === 'function') this._listeners.push(fn); },
        offChange(fn) {
            const i = this._listeners.indexOf(fn);
            if (i >= 0) this._listeners.splice(i, 1);
        },
        _notify() {
            for (let i = this._listeners.length - 1; i >= 0; i--) {
                try { this._listeners[i](); } catch(_) {}
            }
        },
        open(id) { P.apps?.openApp?.(id); }  // lazy: apps.js pode não ter carregado ainda
    };

    // HOST + SHADOW
    let _host = null, _shadow = null, _root = null;

    function _ensureHost() {
        // se o host foi removido do DOM por fora, recria
        if (_host && !_host.isConnected) {
            _host = _shadow = _root = null;
        }
        if (_host && _shadow && _root) return;
        _host = document.createElement('div');
        _host.id = '_phone_host';
        _host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none;';
        document.documentElement.appendChild(_host);
        _shadow = _host.attachShadow({ mode: 'open' });
        _root = document.createElement('div');
        _root.setAttribute('data-hub', '1');
        _root.setAttribute('data-sang-ui', '');
        _shadow.appendChild(_root);
        try { window._hubUI?.markProtected?.(_host); } catch(e) {}
        ctx.root = _root;
        ['keydown','input','beforeinput','keyup'].forEach(ev => {
            _root.addEventListener(ev, e => e.stopPropagation());
        });
    }

    function _appendStyle(css) {
        if (!_shadow) { _ensureHost(); }
        if (!_shadow) return;
        const s = document.createElement('style');
        s.textContent = css;
        _shadow.appendChild(s);
    }
    ctx.appendStyle = _appendStyle;

    // STYLE — pega a string de style.js (já carregado pelo shell)
    function _injectBaseStyle() {
        _appendStyle(ctx._phoneCss || '');
    }

    // FRAME
    let _clockTimer = null;

    function _ensureFrame() {
        // se o frame existia e foi removido por fora, refaz
        if (S.frameEl && !S.frameEl.isConnected) {
            S.frameEl = S.screenEl = S.stageEl = S.contentEl = null;
        }
        if (S.frameEl) return;
        _ensureHost();

        const frame = el('div', { class: 'ph-frame' + (S.minimized ? ' min' : ''), id: 'phFrame' });
        frame.innerHTML = `
            <div class="ph-side vol1"></div>
            <div class="ph-side vol2"></div>
            <div class="ph-side pwr"></div>
            <div class="ph-notch" id="phNotch" title="Clique para ${S.minimized ? 'expandir' : 'minimizar'}"></div>
            <div class="ph-screen">
                <div class="ph-wallpaper" id="phWallpaper"></div>
                <div class="ph-status">
                    <span class="ph-status-time" id="phTime">--:--</span>
                    <span class="ph-status-icons">
                        <span class="sig"><i></i><i></i><i></i><i></i></span>
                        <span class="wifi">${ctx.I.wifi}</span>
                        <span style="font-size:9px;font-weight:800;letter-spacing:.02em;">LTE</span>
                        <span class="dot-notif" id="phNotifDot"></span>
                    </span>
                </div>
                <div class="ph-stage" id="phStage">
                    <div class="ph-view ph-view-lock" id="phViewLock"></div>
                    <div class="ph-view ph-view-home" id="phViewHome"></div>
                    <div class="ph-view ph-view-app"  id="phViewApp"></div>
                    <div class="ph-view ph-view-call" id="phViewCall"></div>
                </div>
                <button class="ph-home-bar" id="phHomeBar" type="button" title="Início" aria-label="Ir para o início"></button>
            </div>
        `;
        _root.appendChild(frame);
        S.frameEl  = frame;
        S.screenEl = frame.querySelector('.ph-screen');
        S.stageEl  = frame.querySelector('#phStage');
        ctx.frameEl  = S.frameEl;
        ctx.screenEl = S.screenEl;

        const contentEl = document.createElement('div');
        contentEl.className = 'ph-content';
        contentEl.id = 'phContent';
        S.contentEl = contentEl;

        _tickClock();
        if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
        _clockTimer = setInterval(() => { if (!S.dying) _tickClock(); }, 15000);

        const notch = frame.querySelector('#phNotch');
        notch.addEventListener('click', (e) => { e.stopPropagation(); _setMinimized(!S.minimized); });
        frame.addEventListener('click', (e) => {
            if (!S.minimized) return;
            if (e.target.closest('#phNotch')) return;
            _setMinimized(false);
        });

        const homeBar = frame.querySelector('#phHomeBar');
        homeBar.addEventListener('click', (e) => {
            e.stopPropagation();
            if (S.inCallView || (ctx.phase !== 'idle' && ctx.phase !== 'busy')) return;
            if (S.view === 'lock' || S.view === 'home') return;
            try { ctx.tone.home(); } catch(_) {}
            P.apps?.goHome?.();  // lazy: apps.js pode não ter carregado ainda
        });

        frame.addEventListener('contextmenu', (e) => {
            if (S.view !== 'home') return;
            if (e.target.closest('input, textarea')) return;
            e.preventDefault();
            P.home?.openHomeCtx?.(e.clientX, e.clientY);  // lazy
        });
    }

    function _tickClock() {
        const d  = new Date();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        if (!S.frameEl) return;
        const t1 = S.frameEl.querySelector('#phTime');
        if (t1) t1.textContent = hh + ':' + mm;
        const t2 = S.frameEl.querySelector('#phLockTime');
        if (t2) t2.textContent = hh + ':' + mm;
        const t3 = S.frameEl.querySelector('#phHomeTime');
        if (t3) t3.textContent = hh + ':' + mm;
    }

    function _setMinimized(v) {
    if (v === S.minimized) return;
    S.minimized = !!v;
    try { localStorage.setItem(C.LS_MINIMIZED, S.minimized ? '1' : '0'); } catch(_) {}
    if (!S.frameEl) return;
    S.frameEl.classList.toggle('min', S.minimized);
    _syncFrameMode();
    const notch = S.frameEl.querySelector('#phNotch');
    if (notch) notch.title = S.minimized ? 'Clique para expandir' : 'Clique para minimizar';
    try { if (S.minimized) ctx.tone.tuck(); else ctx.tone.pull(); } catch(_) {}
    }
    
    ctx.setMinimized = _setMinimized;
    ctx.getMinimized = () => S.minimized;

    function _syncFrameMode() {
    const f = S.frameEl;
    if (!f) return;
    const appDef = S.view === 'app' && S.activeAppId
        ? P.apps?.resolveAppDef?.(S.activeAppId)
        : null;
    const isGame = !S.minimized && !S.dying && !!appDef?.gameMode;
    f.classList.toggle('game-mode', isGame);
    }
    // VIEW ROUTER
function _showView(name) {
    S.view = name;
    const f = S.frameEl;
    if (!f) return;
    _syncFrameMode();
    const views = {
        lock: f.querySelector('#phViewLock'),
        home: f.querySelector('#phViewHome'),
        app:  f.querySelector('#phViewApp'),
        call: f.querySelector('#phViewCall')
    };
    for (const k in views) {
        if (!views[k]) continue;
        views[k].classList.toggle('active', k === name);
    }
    if (name !== 'app' && name !== 'call' && S.contentEl) {
        const p = S.contentEl.parentElement;
        if (p) p.removeChild(S.contentEl);
    }
    if (name !== 'home') P.home?.closeHomeCtx?.();
    if (S.screenEl) S.screenEl.classList.toggle('app-active', name === 'app' || name === 'call');
}

    function _teardown() {
        if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
        try { if (_host) _host.remove(); } catch(_) {}
        try { if (_actx) _actx.close(); } catch(_) {}
        _actx = null;                               // sinaliza contexto morto p/ recriar
        _host = _shadow = _root = null;
        S.frameEl = S.screenEl = S.stageEl = S.contentEl = null;
        ctx.root = ctx.frameEl = ctx.screenEl = null;
    }

    // EXPORT
    P.core = {
        ensureHost:       _ensureHost,
        ensureFrame:      _ensureFrame,
        injectBaseStyle:  _injectBaseStyle,
        showView:         _showView,
        tickClock:        _tickClock,
        setMinimized:     _setMinimized,
        teardown:         _teardown,
        getHost:          () => _host,
        getShadow:        () => _shadow,
        getFrameEl:       () => S.frameEl,
        getScreenEl:      () => S.screenEl,
        getContentEl:     () => S.contentEl
    };
})();
