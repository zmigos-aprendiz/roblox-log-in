// modules/phone/apps/cameffects.js
(function() {
    'use strict';
    if (window._camEffects) return;

    const DEFAULT_STATE = Object.freeze({
        zoom: 1.0,
        stabilization: 0.35,
        motionBlur: true,
        vignette: false,
        timestamp: false,
        flash: false,
        flashIntensity: 0.18
    });

    let state = { ...DEFAULT_STATE };

    // ═══ ESTABILIZAÇÃO ═══
    const JUMP_RESET_PX = 200;

    const _euro = {
        x: { v: null, raw: null, dx: 0 },
        y: { v: null, raw: null, dx: 0 },
        w: { v: null, raw: null, dx: 0 },
        h: { v: null, raw: null, dx: 0 }
    };

    let smoothZoom = state.zoom;
    let lastDrawX = 0, lastDrawY = 0, lastDrawAt = 0;
    let _lastFrameAt = 0;
    let _oneShotFlash = 0;

    function lerp(a, b, k) { return a + (b - a) * k; }

    function _euroReset() {
        for (const k of ['x', 'y', 'w', 'h']) {
            _euro[k].v = null;
            _euro[k].raw = null;
            _euro[k].dx = 0;
        }
    }

    function _euroAlpha(cutoff, dt) {
        const tau = 1 / (2 * Math.PI * cutoff);
        return 1 / (1 + tau / dt);
    }

    function _euroStep(s, raw, dt, fcMin, beta, dCutoff) {
        if (s.v === null || s.raw === null) {
            s.v = raw; s.raw = raw; s.dx = 0;
            return raw;
        }
        if (Math.abs(raw - s.v) > JUMP_RESET_PX) {
            s.v = raw; s.raw = raw; s.dx = 0;
            return raw;
        }
        const freq = 1 / dt;
        const dxRaw = (raw - s.raw) * freq;
        const aD = _euroAlpha(dCutoff, dt);
        s.dx = aD * dxRaw + (1 - aD) * s.dx;
        const cutoff = fcMin + beta * Math.abs(s.dx);
        const a = _euroAlpha(cutoff, dt);
        s.v = a * raw + (1 - a) * s.v;
        s.raw = raw;
        return s.v;
    }

    function _euroParams(stab) {
        const t = Math.min(1, Math.max(0, stab / 0.85));
        const fcMin = 2.5 - 2.0 * t;
        const beta  = 0.015 - 0.012 * t;
        return { fcMin, beta, dCutoff: 1.0 };
    }

    function resetTracking() {
        _euroReset();
        smoothZoom = state.zoom;
        lastDrawX = lastDrawY = 0;
        lastDrawAt = 0;
        _lastFrameAt = 0;
        _oneShotFlash = 0;
    }

    // ═══ TIMESTAMP ═══
    function formatTimestamp(d) {
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function drawTimestamp(ctx, rect) {
        const { dx, dy, dw, dh } = rect;
        const text = formatTimestamp(new Date());
        const fontSize = Math.max(10, Math.min(18, Math.round(dw / 42)));
        const padX = Math.round(fontSize * 0.55);
        const padY = Math.round(fontSize * 0.42);
        ctx.save();
        ctx.font = `600 ${fontSize}px "SF Mono", ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'rgba(0,0,0,0.75)';
        ctx.shadowBlur = Math.max(2, Math.round(fontSize * 0.35));
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillText(text, dx + dw - padX, dy + dh - padY);
        ctx.restore();
    }

    // ═══ FLASH ═══
    function _applyFlash(dstCtx, rect) {
        const persistent = state.flash
            ? Math.max(0, Math.min(1, Number(state.flashIntensity) || 0))
            : 0;
        const total = Math.min(1, persistent + _oneShotFlash);
        if (total <= 0.001) return;
        const { dx, dy, dw, dh } = rect;
        dstCtx.save();
        dstCtx.globalAlpha = total;
        dstCtx.fillStyle = '#fffaf2';
        dstCtx.fillRect(dx, dy, dw, dh);
        dstCtx.restore();
    }

    // ═══ PROCESS FRAME ═══
    function processFrame(srcEl, srcRect, dstCtx, dstRect, now, opts) {
        opts = opts || {};
        if (!srcEl || !srcRect || !dstCtx || !dstRect) return;
        let { sx, sy, sw, sh } = srcRect;
        const { dx, dy, dw, dh } = dstRect;
        if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;

        now = now || performance.now();
        const dtSec = _lastFrameAt > 0
            ? Math.max(0.016, Math.min(0.1, (now - _lastFrameAt) / 1000))
            : 0.05;
        _lastFrameAt = now;

        const targetZoom = Math.max(1, Math.min(3, state.zoom || 1));
        if (Math.abs(smoothZoom - targetZoom) > 0.001) {
            smoothZoom = lerp(smoothZoom, targetZoom, 0.18);
        } else {
            smoothZoom = targetZoom;
        }

        const smooth = Math.max(0, Math.min(0.85, state.stabilization || 0));
        let tx = sx, ty = sy;
        if (smooth > 0) {
            const p = _euroParams(smooth);
            tx = _euroStep(_euro.x, sx, dtSec, p.fcMin, p.beta, p.dCutoff);
            ty = _euroStep(_euro.y, sy, dtSec, p.fcMin, p.beta, p.dCutoff);
            sw = _euroStep(_euro.w, sw, dtSec, p.fcMin, p.beta, p.dCutoff);
            sh = _euroStep(_euro.h, sh, dtSec, p.fcMin, p.beta, p.dCutoff);
        } else {
            _euroReset();
        }

        if (smoothZoom > 1.001) {
            const cx = tx + sw / 2;
            const cy = ty + sh / 2;
            sw = sw / smoothZoom;
            sh = sh / smoothZoom;
            tx = cx - sw / 2;
            ty = cy - sh / 2;
        }

        let vx = 0, vy = 0;
        if (lastDrawAt > 0) {
            const dt = Math.max(16, now - lastDrawAt);
            vx = (tx - lastDrawX) / dt * 16;
            vy = (ty - lastDrawY) / dt * 16;
        }
        lastDrawX = tx;
        lastDrawY = ty;
        lastDrawAt = now;

        const allowMB = opts.allowMotionBlur !== false;
        const speed = Math.hypot(vx, vy);
        const MB_THRESHOLD = 1.5;

        if (allowMB && state.motionBlur && speed > MB_THRESHOLD) {
            const strength = Math.min(1, (speed - MB_THRESHOLD) / 12);
            const STEPS = strength > 0.55 ? 4 : 3;
            const ghostAlpha = 0.12 + 0.30 * strength;

            for (let i = 0; i < STEPS; i++) {
                if (i === Math.floor(STEPS / 2)) continue;
                const t = i / (STEPS - 1) - 0.5;
                dstCtx.globalAlpha = ghostAlpha;
                try {
                    dstCtx.drawImage(
                        srcEl,
                        tx + vx * t * 0.85, ty + vy * t * 0.85, sw, sh,
                        dx, dy, dw, dh
                    );
                } catch(_) {}
            }
            dstCtx.globalAlpha = 1;
            try {
                dstCtx.drawImage(srcEl, tx, ty, sw, sh, dx, dy, dw, dh);
            } catch(_) {}
        } else {
            try {
                dstCtx.drawImage(srcEl, tx, ty, sw, sh, dx, dy, dw, dh);
            } catch(_) {}
        }

        _applyFlash(dstCtx, dstRect);

        if (state.vignette) {
            const cx = dx + dw / 2;
            const cy = dy + dh / 2;
            const r = Math.max(dw, dh) * 0.75;
            const grad = dstCtx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, 'rgba(0,0,0,0.55)');
            dstCtx.save();
            dstCtx.fillStyle = grad;
            dstCtx.fillRect(dx, dy, dw, dh);
            dstCtx.restore();
        }

        if (state.timestamp) {
            drawTimestamp(dstCtx, dstRect);
        }

        if (_oneShotFlash > 0) {
            _oneShotFlash = Math.max(0, _oneShotFlash - dtSec * 2.8);
        }
    }

    // ═══ API ═══
    function triggerFlash(intensity) {
        const v = (intensity == null) ? 0.6 : Number(intensity);
        if (!Number.isFinite(v) || v <= 0) return;
        _oneShotFlash = Math.max(_oneShotFlash, Math.min(1, v));
    }

    function getState() { return { ...state }; }

    function setState(partial) {
        state = { ...state, ...partial };
        if (state.stabilization === 0) _euroReset();
        return { ...state };
    }

    function reset() {
        state = { ...DEFAULT_STATE };
        resetTracking();
        return { ...state };
    }

    window._camEffects = {
        processFrame,
        triggerFlash,
        getState,
        setState,
        reset,
        resetTracking
    };
})();
