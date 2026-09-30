// modules/phone/download.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx) { console.warn('[Download] ctx ausente'); return; }
    if (ctx.download && typeof ctx.download.item === 'function') return;

    const URL_REVOKE_MS = 5000;

    function normalizeMime(mime) {
        if (!mime) return '';
        return String(mime).split(';')[0].trim().toLowerCase();
    }
    function pad(n) { return String(n).padStart(2, '0'); }
    function fileStamp(d) {
        d = d || new Date();
        return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }
    function extFromMime(mime) {
        const m = normalizeMime(mime);
        if (!m) return '';
        if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
        if (m === 'image/png')  return 'png';
        if (m === 'image/webp') return 'webp';
        if (m === 'image/gif')  return 'gif';
        if (m === 'image/bmp')  return 'bmp';
        if (m === 'image/avif') return 'avif';
        if (m === 'image/heic') return 'heic';
        if (m === 'image/heif') return 'heif';
        if (m === 'video/webm') return 'webm';
        if (m === 'video/mp4')  return 'mp4';
        if (m === 'video/quicktime') return 'mov';
        if (m === 'video/ogg')  return 'ogg';
        if (m === 'video/x-matroska') return 'mkv';
        if (m === 'audio/webm') return 'webm';
        if (m === 'audio/mpeg') return 'mp3';
        if (m === 'audio/ogg')  return 'ogg';
        return '';
    }

    function _isTouchDevice() {
        try {
            const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
            const touch = (navigator.maxTouchPoints || 0) > 0;
            return !!coarse && touch;
        } catch(_) { return false; }
    }

    function dataUrlToBlob(dataUrl) {
        try {
            const s = String(dataUrl);
            const idx = s.indexOf(',');
            if (idx < 0) return null;
            const header = s.slice(0, idx);
            const b64 = s.slice(idx + 1);
            const mimeMatch = header.match(/:(.*?);/);
            const mime = (mimeMatch && mimeMatch[1]) || 'application/octet-stream';
            const isB64 = /;base64/i.test(header);
            let bytes;
            if (isB64) {
                const bin = atob(b64);
                const len = bin.length;
                bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
            } else {
                bytes = new TextEncoder().encode(decodeURIComponent(b64));
            }
            return new Blob([bytes], { type: mime });
        } catch (e) {
            console.warn('[Download] dataUrlToBlob:', e);
            return null;
        }
    }

    async function itemToBlob(item) {
        if (!item) return null;
        if (item.blob instanceof Blob) return item.blob;
        if (item.dataUrl) return dataUrlToBlob(item.dataUrl);
        if (typeof item.url === 'string' && /^https?:/i.test(item.url)) {
            try {
                const r = await fetch(item.url);
                if (r.ok) return await r.blob();
                console.warn('[Download] fetch remoto HTTP', r.status, item.url);
            } catch (e) {
                console.warn('[Download] fetch remoto:', e);
            }
        }
        return null;
    }

    function buildFilename(item, blob) {
        const isVideo = (item && item.kind === 'video') || (blob && /^video\//i.test(blob.type || ''));
        const mimeRaw = (blob && blob.type) || (item && item.mime) || '';
        const mimeExt = extFromMime(mimeRaw);
        const fallbackExt = mimeExt || (isVideo ? 'webm' : 'jpg');

        let name = String((item && item.name) || '').trim();
        if (!name) return `${isVideo ? 'video' : 'photo'}-${fileStamp()}.${fallbackExt}`;
        if (!/\.[a-z0-9]{2,5}$/i.test(name)) return `${name}.${fallbackExt}`;

        const curExt = name.split('.').pop().toLowerCase();
        if (mimeExt && curExt !== mimeExt) {
            const known = ['webm','mp4','mov','ogg','mkv','m4v','jpg','jpeg','png','webp','gif','bmp','avif','heic','heif'];
            if (known.includes(curExt)) name = name.replace(/\.[a-z0-9]+$/i, '.' + mimeExt);
        }
        return name;
    }

    function anchorDownload(url, name) {
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = name || 'download';
            a.rel = 'noopener';
            a.style.display = 'none';
            (document.body || document.documentElement).appendChild(a);
            a.click();
            setTimeout(() => { try { a.remove(); } catch(_) {} }, 1000);
            return true;
        } catch (e) {
            console.warn('[Download] anchor:', e);
            return false;
        }
    }

    function tryGM(blob, filename) {
        if (typeof GM_download !== 'function') return false;
        let u = '';
        try {
            u = URL.createObjectURL(blob);
            const cleanup = () => { try { URL.revokeObjectURL(u); } catch(_) {} };
            const r = GM_download({
                url: u,
                name: filename,
                saveAs: false,
                onload: cleanup,
                onerror: cleanup,
                ontimeout: cleanup
            });
            if (r !== false) return true;
            cleanup();
        } catch (e) {
            if (u) { try { URL.revokeObjectURL(u); } catch(_) {} }
            console.warn('[Download] GM_download:', e);
        }
        return false;
    }

    async function downloadItem(item) {
        if (!item) return { ok: false, reason: 'no-item' };

        const blob = await itemToBlob(item);
        if (!blob) return { ok: false, reason: 'no-blob' };

        const filename = buildFilename(item, blob);
        const cleanMime = normalizeMime(blob.type || item.mime)
            || (item.kind === 'video' ? 'video/webm' : 'image/jpeg');

        // 1. GM_download — caminho preferencial quando rodando em Tampermonkey com grant.
        if (tryGM(blob, filename)) {
            return { ok: true, reason: null, via: 'gm', filename };
        }

        // 2. share nativo — apenas em mobile real. No Windows/Linux desktop o
        //    navigator.share também existe e abre o painel de compartilhamento,
        //    que não baixa o arquivo. Detecção por (pointer: coarse) + touch.
        if (_isTouchDevice() && typeof navigator.share === 'function' && typeof File === 'function') {
            try {
                const file = new File([blob], filename, { type: cleanMime });
                const canShare = typeof navigator.canShare !== 'function'
                    || navigator.canShare({ files: [file] });
                if (canShare) {
                    await navigator.share({ files: [file] });
                    return { ok: true, reason: null, via: 'share', filename };
                }
            } catch (err) {
                if (err && err.name === 'AbortError') {
                    return { ok: false, reason: 'cancelled' };
                }
                // qualquer outro erro cai pro anchor
            }
        }

        // 3. anchor clássico.
        let url;
        try { url = URL.createObjectURL(blob); }
        catch (e) {
            console.warn('[Download] createObjectURL:', e);
            return { ok: false, reason: 'blob-url-failed' };
        }

        const ok = anchorDownload(url, filename);
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch(_) {} }, URL_REVOKE_MS);

        return ok
            ? { ok: true, reason: null, via: 'anchor', filename }
            : { ok: false, reason: 'anchor-failed' };
    }

    ctx.download = {
        item: downloadItem,
        toBlob: itemToBlob,
        dataUrlToBlob
    };
})();
