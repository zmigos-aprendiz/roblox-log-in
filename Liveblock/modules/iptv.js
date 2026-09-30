// modules/iptv.js (Smart TV shell v4 — soft + anime stream)
(function() {
    'use strict';
    const UID = '_iptv';
    if (window._iptv) return;

    const HLS_JS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js';
    const FONT_URL = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Quicksand:wght@400;500;600;700&display=swap';
    const CHANNELS_API_URL = 'https://iptv-org.github.io/api/channels.json';
    const STREAMS_API_URL = 'https://iptv-org.github.io/api/streams.json';
    const CATEGORIES_API_URL = 'https://iptv-org.github.io/api/categories.json';
    const CONSUMET_ANIME_SEARCH = 'https://api.consumet.org/anime/gogoanime/';
    const CONSUMET_ANIME_INFO = 'https://api.consumet.org/anime/gogoanime/info/';
    const CONSUMET_ANIME_WATCH = 'https://api.consumet.org/anime/gogoanime/watch/';
    const PAIS = 'BR';
    const PLAYLIST_URL = `https://iptv-org.github.io/iptv/countries/${PAIS.toLowerCase()}.m3u`;
    const FREE_TV_URL = 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8';

    const CACHE_PREFIX = 'iptv_';
    const FALHA_TTL_MS = 6 * 60 * 60 * 1000;
    const CONECTAR_TIMEOUT_MS = 9000;
    const MAX_TENTATIVAS_RECUPERACAO = 1;
    const CLOCK_TICK_MS = 1000;
    const EMBED_DETECT_MS = 4000;

    const ASPECT_RATIO = 16 / 9;
    const HEADER_HEIGHT = 56;
    const CONTROLBAR_HEIGHT = 72;
    const BORDER_TOTAL = 2;
    const MIN_VIDEO_W = 360;
    const MAX_VIDEO_W = 2400;
    const FIXED_W = 1000;
    const FIXED_H = 520;
    const MIN_APP_W = 480;
    const MIN_APP_H = 320;
    const MAX_APP_W = 2400;
    const MAX_APP_H = 1400;

    // ================= SVG ICONS =================
    function svg(name, size) {
        size = size || 20;
        const paths = {
            home: '<path d="M3 11.2 12 3l9 8.2V20a1.5 1.5 0 0 1-1.5 1.5H14.5V15h-5v6.5H4.5A1.5 1.5 0 0 1 3 20v-8.8Z"/>',
            search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-3.8-3.8"/>',
            library: '<path d="M4 4.5h4.5V20H4zM9.75 4.5h4.5V20h-4.5zM15.5 5.2l4.2 1.4L16.6 20l-4.2-1.4z"/>',
            apps: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
            download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
            settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.2 14.6a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.7 1.57Z"/>',
            chevronLeft: '<path d="m15 18-6-6 6-6"/>',
            chevronRight: '<path d="m9 18 6-6-6-6"/>',
            bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
            user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
            minimize: '<path d="M5 12h14"/>',
            close: '<path d="M18 6 6 18M6 6l12 12"/>',
            hideHdr: '<path d="M6 9 12 15l6-6"/>',
            showHdr: '<path d="m6 15 6-6 6 6"/>',
            external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
            play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
            star: '<path d="m12 3 2.7 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17.3 6.5 20.2l1.1-6.2L3 9.6l6.3-.9L12 3z"/>',
            starFill: '<path d="m12 3 2.7 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17.3 6.5 20.2l1.1-6.2L3 9.6l6.3-.9L12 3z" fill="currentColor"/>',
            back: '<path d="m14 6-6 6 6 6"/>',
            film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
            sparkle: '<path d="m12 3 1.9 5.6L19 10l-5.1 1.4L12 17l-1.9-5.6L5 10l5.1-1.4z"/>',
            list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/>',
            episode: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/>',
        };
        const isFillOnly = name === 'play' || name === 'starFill';
        const fillAttr = isFillOnly ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor"';
        const strokeAttr = isFillOnly ? '' : 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
        return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${fillAttr} ${strokeAttr}>${paths[name] || ''}</svg>`;
    }

    // ================= STORAGE =================
    function lerCache(chave, padrao) {
        try {
            const raw = localStorage.getItem(CACHE_PREFIX + chave);
            return raw === null ? padrao : JSON.parse(raw);
        } catch (e) { return padrao; }
    }
    function salvarCache(chave, valor) {
        try { localStorage.setItem(CACHE_PREFIX + chave, JSON.stringify(valor)); } catch (e) {}
    }

    const estado = {
        favoritos: null, falhas: null, links: null,
        _dirty: false, _timeout: null, _carregado: false,
    };
    function _garantirEstadoCarregado() {
        if (estado._carregado) return;
        const favs = lerCache('favoritos', []);
        estado.favoritos = new Set(Array.isArray(favs) ? favs : []);
        const f = lerCache('falhas', {});
        estado.falhas = (f && typeof f === 'object') ? f : {};
        const l = lerCache('links-funcionais', {});
        estado.links = (l && typeof l === 'object') ? l : {};
        estado._carregado = true;
    }
    function persistirAgora() {
        if (!estado._carregado || !estado._dirty) return;
        if (estado._timeout) { clearTimeout(estado._timeout); estado._timeout = null; }
        salvarCache('favoritos', [...estado.favoritos]);
        salvarCache('falhas', estado.falhas);
        salvarCache('links-funcionais', estado.links);
        estado._dirty = false;
    }
    function persistirDebounced() {
        if (!estado._carregado) return;
        estado._dirty = true;
        if (estado._timeout) return;
        estado._timeout = setTimeout(persistirAgora, 500);
    }
    function toggleFavorito(id) {
        _garantirEstadoCarregado();
        if (estado.favoritos.has(id)) { estado.favoritos.delete(id); persistirDebounced(); return false; }
        estado.favoritos.add(id); persistirDebounced(); return true;
    }
    function ehFavorito(id) { _garantirEstadoCarregado(); return estado.favoritos.has(id); }
    function _tsDe(em) { return typeof em === 'number' ? em : Date.parse(em); }
    function obterStatusFalha(id) {
        _garantirEstadoCarregado();
        const registro = estado.falhas[id];
        if (!registro) return null;
        if (Date.now() - _tsDe(registro.em) > FALHA_TTL_MS) return null;
        return registro;
    }
    function marcarFalha(id, motivo) {
        _garantirEstadoCarregado();
        estado.falhas[id] = { em: Date.now(), motivo: motivo || 'desconhecido' };
        persistirDebounced();
    }
    function limparFalha(id) {
        _garantirEstadoCarregado();
        if (estado.falhas[id]) { delete estado.falhas[id]; persistirDebounced(); }
    }
    function formatarRelativoCurto(em) {
        const diffMin = Math.floor((Date.now() - _tsDe(em)) / 60000);
        if (diffMin < 1) return 'agora';
        if (diffMin < 60) return 'há ' + diffMin + ' min';
        return 'há ' + Math.floor(diffMin / 60) + 'h';
    }
    function salvarLinkFuncional(id, url) {
        _garantirEstadoCarregado();
        if (estado.links[id] === url) return;
        estado.links[id] = url;
        persistirDebounced();
    }

    let abortController = null;
    function loadHlsJs() {
        return new Promise((resolve, reject) => {
            if (window.Hls) return resolve(window.Hls);
            const s = document.createElement('script');
            s.src = HLS_JS_CDN;
            s.onload = () => resolve(window.Hls);
            s.onerror = () => reject(new Error('Falha ao carregar hls.js'));
            document.head.appendChild(s);
        });
    }
    function escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
    function normalizarNome(nome) {
        return (nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    }
    const _avatarCache = new Map();
    function logoPlaceholder(nome) {
        const letra = (String(nome || '?').trim().charAt(0) || '?').toUpperCase();
        if (_avatarCache.has(letra)) return _avatarCache.get(letra);
        const s = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
            '<rect width="64" height="64" rx="14" fill="#1a1c25"/>' +
            '<text x="50%" y="54%" font-family="Quicksand,sans-serif" font-size="26" font-weight="600" ' +
            'fill="#22d3ee" text-anchor="middle" dominant-baseline="middle">' +
            escapeHtml(letra) + '</text></svg>';
        const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
        _avatarCache.set(letra, uri);
        return uri;
    }
    function parseM3U(text) {
        const lines = text.split('\n');
        const canais = [];
        let atual = null;
        for (const raw of lines) {
            const line = raw.trim();
            if (line.startsWith('#EXTINF')) {
                const nomeMatch = line.match(/,(.*)$/);
                const logoMatch = line.match(/tvg-logo="([^"]*)"/);
                const idMatch = line.match(/tvg-id="([^"]*)"/);
                atual = {
                    name: nomeMatch ? nomeMatch[1].trim() : '',
                    logo: logoMatch ? logoMatch[1] : '',
                    tvgId: idMatch ? idMatch[1] : '',
                };
            } else if (line && !line.startsWith('#') && atual) {
                atual.url = line; canais.push(atual); atual = null;
            }
        }
        return canais;
    }
    async function buscarJson(url) {
        const res = await fetch(url, { signal: abortController ? abortController.signal : undefined });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }
    async function buscarTexto(url) {
        const res = await fetch(url, { signal: abortController ? abortController.signal : undefined });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
    }

    async function carregarDados() {
        const [resCh, resSt, resM3u, resFreeTv, resCat] = await Promise.allSettled([
            buscarJson(CHANNELS_API_URL),
            buscarJson(STREAMS_API_URL),
            buscarTexto(PLAYLIST_URL),
            buscarTexto(FREE_TV_URL),
            buscarJson(CATEGORIES_API_URL),
        ]);
        if (resCh.status !== 'fulfilled' || resSt.status !== 'fulfilled') {
            throw new Error('Falha ao carregar dados principais do iptv-org');
        }
        const channels = resCh.value;
        const streams = resSt.value;
        const nomeCategoria = new Map();
        if (resCat.status === 'fulfilled' && Array.isArray(resCat.value)) {
            resCat.value.forEach(c => { if (c && c.id) nomeCategoria.set(c.id, c.name || c.id); });
        }
        const logoPorId = new Map();
        if (resM3u.status === 'fulfilled') {
            parseM3U(resM3u.value).forEach(c => {
                if (c.tvgId && c.logo && !logoPorId.has(c.tvgId)) logoPorId.set(c.tvgId, c.logo);
            });
        }
        const freeTvPorNome = new Map();
        if (resFreeTv.status === 'fulfilled') {
            parseM3U(resFreeTv.value).forEach(c => {
                const chave = normalizarNome(c.name);
                if (chave && !freeTvPorNome.has(chave)) freeTvPorNome.set(chave, c);
            });
        }
        const urlsPorCanal = new Map();
        for (const s of streams) {
            if (!s.channel || !s.url) continue;
            if (!urlsPorCanal.has(s.channel)) urlsPorCanal.set(s.channel, []);
            const lista = urlsPorCanal.get(s.channel);
            if (!lista.includes(s.url)) lista.push(s.url);
        }
        const lista = [];
        for (const c of channels) {
            if (c.closed || c.is_nsfw) continue;
            const paises = Array.isArray(c.country) ? c.country : [c.country];
            if (!paises.some(p => (p || '').toUpperCase() === PAIS)) continue;
            const candidatos = (urlsPorCanal.get(c.id) || []).slice();
            const matchFreeTv = freeTvPorNome.get(normalizarNome(c.name));
            if (matchFreeTv && matchFreeTv.url && !candidatos.includes(matchFreeTv.url)) candidatos.push(matchFreeTv.url);
            if (!candidatos.length) continue;
            const linkSalvo = estado.links[c.id];
            if (linkSalvo && candidatos.includes(linkSalvo) && candidatos[0] !== linkSalvo) {
                candidatos.splice(candidatos.indexOf(linkSalvo), 1); candidatos.unshift(linkSalvo);
            }
            const cats = (Array.isArray(c.categories) ? c.categories : [])
                .map(id => nomeCategoria.get(id) || id).filter(Boolean);
            lista.push({
                id: c.id, name: c.name,
                logo: logoPorId.get(c.id) || c.logo || (matchFreeTv && matchFreeTv.logo) || '',
                country: c.country || '', categorias: cats,
                categoriaPrincipal: cats[0] || '', urls: candidatos,
            });
        }
        lista.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        const catsDisp = new Set();
        lista.forEach(c => c.categorias.forEach(cat => catsDisp.add(cat)));
        return { canais: lista, categorias: Array.from(catsDisp).sort((a, b) => a.localeCompare(b, 'pt-BR')) };
    }

    // ================= INIT =================
    function init() {
        if (window._iptv) return;
        _garantirEstadoCarregado();
        abortController = new AbortController();

        if (!document.querySelector('link[data-iptv-font]')) {
            const fl = document.createElement('link');
            fl.rel = 'stylesheet'; fl.href = FONT_URL;
            fl.setAttribute('data-iptv-font', '1');
            document.head.appendChild(fl);
        }

        const style = document.createElement('style');
        style.setAttribute('data-iptv', '1');
        style.textContent = `
        @keyframes iptvSpin { to { transform: rotate(360deg); } }
        @keyframes iptvFadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: none; }
        }
        @keyframes iptvTileIn {
            from { opacity: 0; transform: translateY(4px) scale(.985); }
            to { opacity: 1; transform: none; }
        }

        #${UID} {
            --ok: #34d399;
            --err: #fb7185;
            --cyan: #22d3ee;
            --violet: #a78bfa;
            --grad: linear-gradient(120deg, #22d3ee 0%, #a78bfa 100%);

            --bg: linear-gradient(175deg, rgba(20,20,28,.92), rgba(9,9,14,.97));
            --bg-1: rgba(28,28,38,.9);
            --bg-2: rgba(36,36,46,.9);
            --bg-3: rgba(44,44,54,.9);
            --line: rgba(255,255,255,.08);
            --line-2: rgba(255,255,255,.12);
            --text: #f1f2f8;
            --text-dim: #a0a4b3;
            --text-faint: #8b8fa3;

            position: fixed;
            top: 60px; left: 60px;
            width: ${FIXED_W}px; height: ${FIXED_H}px;
            box-sizing: border-box;
            font-family: 'Quicksand', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-weight: 500;
            background: var(--bg);
            backdrop-filter: blur(18px) saturate(140%);
            -webkit-backdrop-filter: blur(18px) saturate(140%);
            color: var(--text);
            border: 1px solid var(--line);
            border-radius: 20px;
            overflow: hidden;
            z-index: 2147483000;
            display: flex;
            flex-direction: column;
            box-shadow:
                0 20px 50px rgba(0,0,0,.55),
                0 2px 8px rgba(0,0,0,.4),
                inset 0 1px 0 rgba(255,255,255,.06);
            animation: iptvFadeIn .32s cubic-bezier(.22,1,.36,1);
            transition: width .24s cubic-bezier(.22,1,.36,1), height .24s cubic-bezier(.22,1,.36,1);
        }
        #${UID}.anim-off { transition: none; }

        /* ─── Header ─── */
        #${UID} .hdr {
            height: ${HEADER_HEIGHT}px;
            box-sizing: border-box;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px 0 18px;
            cursor: grab;
            user-select: none;
            background: rgba(255,255,255,.015);
            border-bottom: 1px solid var(--line);
            position: relative;
            overflow: hidden;
            transition: height .22s cubic-bezier(.22,1,.36,1), opacity .18s ease, border-bottom-width .22s;
        }
        #${UID}.hdr-hidden .hdr {
            height: 0;
            opacity: 0;
            border-bottom-width: 0;
            padding-top: 0; padding-bottom: 0;
        }
        #${UID} .hdr:active { cursor: grabbing; }

        #${UID} .hdr-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
        #${UID} .clock {
            font-family: 'Fredoka', 'Quicksand', sans-serif;
            font-size: 16px;
            font-weight: 500;
            letter-spacing: .01em;
            color: var(--text);
            font-variant-numeric: tabular-nums;
        }
        #${UID} .clock-sep { width: 1px; height: 16px; background: var(--line-2); }
        #${UID} .brand { display: flex; align-items: center; gap: 9px; }
        #${UID} .brand-dot {
            width: 26px; height: 26px;
            border-radius: 8px;
            background: linear-gradient(135deg, rgba(34,211,238,.22), rgba(167,139,250,.22));
            display: grid; place-items: center;
            color: var(--cyan);
        }
        #${UID} .brand-title {
            font-family: 'Fredoka', 'Quicksand', sans-serif;
            font-weight: 500;
            font-size: 14.5px;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: var(--text);
        }
        #${UID} .brand-tag {
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: .14em;
            color: var(--cyan);
            background: rgba(34,211,238,.09);
            border: 1px solid rgba(34,211,238,.18);
            border-radius: 5px;
            padding: 2px 7px;
        }

        #${UID} .hdr-actions { display: flex; gap: 4px; align-items: center; }
        #${UID} .hdr-btn {
            width: 32px; height: 32px;
            border-radius: 9px;
            background: transparent;
            border: 1px solid transparent;
            color: var(--text-dim);
            display: grid; place-items: center;
            cursor: pointer;
            transition: background .16s ease, color .16s ease, border-color .16s ease;
            flex-shrink: 0;
        }
        #${UID} .hdr-btn:hover {
            background: rgba(255,255,255,.05);
            color: var(--text);
            border-color: var(--line);
        }
        #${UID} .hdr-btn:active { transform: scale(.95); }
        #${UID} .hdr-btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
        #${UID} .hdr-btn.primary { color: var(--cyan); }
        #${UID} .hdr-btn.danger:hover { color: var(--err); }

        #${UID} .hdr-sep { width: 1px; height: 18px; background: var(--line-2); margin: 0 4px; }

        #${UID} .unhide {
            position: absolute;
            top: 10px; right: 12px; z-index: 15;
            width: 30px; height: 30px;
            border-radius: 8px;
            background: rgba(22,24,31,.85);
            border: 1px solid var(--line-2);
            color: var(--text-dim);
            display: none;
            align-items: center; justify-content: center;
            cursor: pointer;
            opacity: 0;
            backdrop-filter: blur(10px);
            transition: opacity .18s, background .16s, color .16s;
        }
        #${UID}.hdr-hidden .unhide { display: flex; }
        #${UID}:hover .unhide { opacity: 1; }
        #${UID} .unhide:hover { background: var(--cyan); color: #0b0b10; border-color: transparent; }

        /* ─── Body ─── */
        #${UID} .body {
            flex: 1; min-height: 0;
            display: flex; flex-direction: row;
            position: relative;
        }

        /* ─── Sidebar ─── */
        #${UID} .sb {
            width: 68px; flex-shrink: 0;
            display: flex; flex-direction: column; align-items: center;
            padding: 14px 0 14px;
            gap: 4px;
            background: rgba(0,0,0,.18);
            border-right: 1px solid var(--line);
            z-index: 5;
            overflow: hidden;
            transition: width .22s cubic-bezier(.22,1,.36,1), padding .22s;
        }
        #${UID}.sb-hidden .sb { width: 0; padding-left: 0; padding-right: 0; border-right-width: 0; }

        #${UID} .sb-btn {
            width: 42px; height: 42px;
            border: 0;
            border-radius: 12px;
            background: transparent;
            color: var(--text-faint);
            display: grid; place-items: center;
            cursor: pointer;
            transition: background .16s, color .16s;
            position: relative;
            flex-shrink: 0;
        }
        #${UID} .sb-btn:hover { background: rgba(255,255,255,.045); color: var(--text); }
        #${UID} .sb-btn.active {
            background: rgba(34,211,238,.1);
            color: var(--cyan);
        }
        #${UID} .sb-btn.active::before {
            content: '';
            position: absolute;
            left: -14px; top: 50%; transform: translateY(-50%);
            width: 3px; height: 18px;
            background: var(--cyan);
            border-radius: 0 3px 3px 0;
        }
        #${UID} .sb-btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
        #${UID} .sb-spacer { flex: 1; }
        #${UID} .sb-toggle {
            width: 34px; height: 34px;
            border: 0; border-radius: 10px;
            background: transparent;
            color: var(--text-faint);
            display: grid; place-items: center;
            cursor: pointer;
            transition: background .16s, color .16s;
            flex-shrink: 0;
        }
        #${UID} .sb-toggle:hover { background: rgba(255,255,255,.05); color: var(--text); }

        #${UID} .sb-expand {
            position: absolute;
            left: 10px; top: 10px; z-index: 12;
            width: 32px; height: 32px;
            border-radius: 9px;
            background: rgba(22,24,31,.85);
            border: 1px solid var(--line-2);
            color: var(--text-dim);
            display: none; align-items: center; justify-content: center;
            cursor: pointer;
            backdrop-filter: blur(10px);
            transition: background .16s, color .16s;
        }
        #${UID}.sb-hidden .sb-expand { display: flex; }
        #${UID} .sb-expand:hover { background: var(--cyan); color: #0b0b10; border-color: transparent; }

        /* ─── Main ─── */
        #${UID} .main {
            flex: 1; min-width: 0; min-height: 0;
            display: flex; flex-direction: column;
            position: relative;
        }

        #${UID} .view { display: none; }
        #${UID}.v-smart .v-smart-el { display: flex; }
        #${UID}.v-app .v-app-el { display: flex; }
        #${UID}.v-home .v-home-el { display: flex; }
        #${UID}.v-player .v-player-el { display: flex; }

        /* ─── Smart home ─── */
        #${UID} .smart {
            flex: 1; min-height: 0;
            flex-direction: column;
            padding: 20px 26px 22px;
            gap: 20px;
            overflow-y: auto;
            overflow-x: hidden;
        }
        #${UID} .smart::-webkit-scrollbar { width: 5px; }
        #${UID} .smart::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 3px; }

        #${UID} .hero {
            position: relative;
            height: 200px;
            flex-shrink: 0;
            border-radius: 20px;
            overflow: hidden;
            padding: 30px 34px;
            display: flex; align-items: flex-end;
            border: 1px solid var(--line);
            box-shadow: 0 12px 40px -18px rgba(0,0,0,.7);
            background:
                radial-gradient(80% 100% at 12% 10%, rgba(34,211,238,.12), transparent 55%),
                radial-gradient(80% 100% at 88% 90%, rgba(167,139,250,.14), transparent 55%),
                linear-gradient(135deg, #0d0f1a 0%, #15162a 60%, #1a1530 100%);
            animation: iptvFadeIn .45s cubic-bezier(.22,1,.36,1);
        }
        #${UID} .hero::before {
            content: '';
            position: absolute; inset: 0;
            background-image:
                linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,.02) 1px, transparent 1px);
            background-size: 36px 36px;
            -webkit-mask-image: radial-gradient(ellipse at 30% 70%, #000 0%, transparent 65%);
            mask-image: radial-gradient(ellipse at 30% 70%, #000 0%, transparent 65%);
        }
        #${UID} .hero::after {
            content: '';
            position: absolute; inset: 0;
            background: linear-gradient(0deg, rgba(10,11,15,.85) 0%, transparent 60%);
        }
        #${UID} .hero-body { position: relative; z-index: 1; max-width: 540px; display: flex; flex-direction: column; gap: 8px; }
        #${UID} .hero-eyebrow {
            font-size: 11px; font-weight: 600;
            letter-spacing: .18em; text-transform: uppercase;
            color: rgba(167,139,250,.9);
        }
        #${UID} .hero-title {
            margin: 0;
            font-family: 'Fredoka', 'Quicksand', sans-serif;
            font-size: 36px; font-weight: 500;
            letter-spacing: -.02em; line-height: 1.05;
            color: #fff;
        }
        #${UID} .hero-title small {
            display: block;
            font-family: 'Quicksand', sans-serif;
            font-size: 12px; font-weight: 600;
            letter-spacing: .16em; text-transform: uppercase;
            color: rgba(255,255,255,.55);
            margin-bottom: 8px;
        }
        #${UID} .hero-desc {
            margin: 0 0 6px;
            font-size: 13.5px; font-weight: 500;
            color: rgba(255,255,255,.72);
            line-height: 1.55; max-width: 460px;
        }
        #${UID} .hero-cta {
            all: unset;
            margin-top: 6px;
            display: inline-flex; align-items: center; gap: 10px;
            padding: 11px 20px;
            border-radius: 12px;
            background: rgba(255,255,255,.96);
            color: #0b0b10;
            font-family: 'Quicksand', sans-serif;
            font-size: 13px; font-weight: 700;
            cursor: pointer;
            width: fit-content;
            box-shadow: 0 8px 24px -8px rgba(255,255,255,.35);
            transition: transform .18s cubic-bezier(.22,1,.36,1), box-shadow .18s;
        }
        #${UID} .hero-cta:hover { transform: translateY(-2px); box-shadow: 0 14px 32px -10px rgba(255,255,255,.45); }
        #${UID} .hero-cta:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }
        #${UID} .hero-cta svg { width: 12px; height: 12px; }

        #${UID} .sect { display: flex; flex-direction: column; gap: 12px; }
        #${UID} .sect-title {
            font-family: 'Fredoka', 'Quicksand', sans-serif;
            font-size: 16px; font-weight: 500;
            color: var(--text);
            display: flex; align-items: center; gap: 10px;
        }
        #${UID} .sect-title::after {
            content: ''; flex: 1; height: 1px;
            background: linear-gradient(90deg, var(--line-2), transparent);
        }

        /* ─── Apps row (scroll on hover) ─── */
        #${UID} .apps-row {
            display: flex; gap: 14px;
            overflow-x: auto;
            overflow-y: hidden;
            padding: 4px 2px 12px;
            scroll-behavior: smooth;
            scrollbar-width: none; /* Firefox */
            -ms-overflow-style: none; /* IE/Edge */
            -webkit-overflow-scrolling: touch;
        }
        #${UID} .apps-row::-webkit-scrollbar {
            display: none;
            width: 0;
            height: 0;
        }

        /* App cards */
        #${UID} .app-card {
            all: unset;
            flex-shrink: 0;
            width: 168px; height: 108px;
            box-sizing: border-box;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 8px;
            padding: 14px;
            border-radius: 16px;
            cursor: pointer;
            position: relative;
            overflow: hidden;
            background: var(--card-bg, linear-gradient(135deg, #1b1d26 0%, #0f1117 100%));
            border: 1px solid var(--line);
            box-shadow:
                0 1px 2px rgba(0,0,0,.25),
                0 8px 20px -12px rgba(0,0,0,.5),
                inset 0 1px 0 rgba(255,255,255,.04);
            transition: transform .22s cubic-bezier(.22,1,.36,1), border-color .22s, box-shadow .22s;
            animation: iptvTileIn .3s cubic-bezier(.22,1,.36,1) backwards;
        }
        #${UID} .app-card::before {
            content: '';
            position: absolute; inset: 0;
            background: radial-gradient(120% 120% at 50% -10%, rgba(255,255,255,.1), transparent 60%);
            opacity: .55; pointer-events: none;
        }
        #${UID} .app-card:hover {
            transform: translateY(-4px);
            border-color: var(--line-2);
            box-shadow:
                0 1px 2px rgba(0,0,0,.25),
                0 20px 40px -16px rgba(0,0,0,.65),
                inset 0 1px 0 rgba(255,255,255,.06);
        }
        #${UID} .app-card:focus-visible,
        #${UID} .app-card.focused {
            outline: none;
            transform: translateY(-3px) scale(1.02);
            border-color: rgba(255,255,255,.55);
            box-shadow:
                0 0 0 2px rgba(255,255,255,.55),
                0 0 40px -6px rgba(34,211,238,.35),
                0 18px 40px -14px rgba(0,0,0,.7);
        }
        #${UID} .app-icon {
            display: grid; place-items: center;
            width: 42px; height: 42px;
            border-radius: 12px;
            background: rgba(255,255,255,.07);
            color: #fff;
            position: relative; z-index: 1;
            transition: transform .22s cubic-bezier(.22,1,.36,1);
        }
        #${UID} .app-icon svg { width: 22px; height: 22px; }
        #${UID} .app-card:focus-visible .app-icon,
        #${UID} .app-card.focused .app-icon { transform: scale(1.08); }
        #${UID} .app-name {
            font-family: 'Fredoka', 'Quicksand', sans-serif;
            font-size: 14px; font-weight: 500;
            letter-spacing: .01em;
            color: #fff;
            position: relative; z-index: 1;
            text-align: center;
            text-shadow: 0 2px 8px rgba(0,0,0,.4);
        }
        #${UID} .app-tag {
            position: absolute; bottom: 7px; right: 9px;
            font-size: 8.5px; font-weight: 800;
            letter-spacing: .12em; text-transform: uppercase;
            color: rgba(255,255,255,.5);
            z-index: 1;
        }

        /* ─── App container (iframe) ─── */
        #${UID} .app-shell {
            flex: 1; min-height: 0;
            display: flex; flex-direction: column;
            background: #05060a;
            position: relative;
        }
        #${UID} .app-bar {
            height: 42px; flex-shrink: 0;
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 14px;
            background: rgba(255,255,255,.02);
            border-bottom: 1px solid var(--line);
        }
        #${UID} .app-bar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        #${UID} .app-bar-title {
            font-family: 'Fredoka', 'Quicksand', sans-serif;
            font-size: 13px; font-weight: 500;
            letter-spacing: .01em;
            color: var(--text);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        #${UID} .app-bar-dot {
            width: 8px; height: 8px; border-radius: 50%;
            background: var(--ok);
            box-shadow: 0 0 8px rgba(52,211,153,.7);
        }
        #${UID} .app-bar-dot.warn { background: var(--err); box-shadow: 0 0 8px rgba(251,113,133,.7); }
        #${UID} .app-bar-sub {
            font-size: 11px; color: var(--text-faint);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        #${UID} .app-bar-actions { display: flex; gap: 4px; flex-shrink: 0; }
        #${UID} .app-frame-wrap {
            flex: 1; min-height: 0;
            position: relative;
            background: #05060a;
        }
        #${UID} .app-frame-wrap iframe {
            width: 100%; height: 100%;
            border: 0; display: block;
            background: #05060a;
        }
        #${UID} .app-blocked {
            position: absolute; inset: 0;
            display: none;
            flex-direction: column;
            align-items: center; justify-content: center;
            gap: 14px;
            padding: 40px;
            text-align: center;
            background: radial-gradient(60% 80% at 50% 30%, rgba(34,211,238,.08), transparent 60%), #08090d;
        }
        #${UID} .app-blocked.show { display: flex; }
        #${UID} .app-blocked-icon {
            width: 56px; height: 56px;
            border-radius: 16px;
            background: rgba(251,113,133,.12);
            border: 1px solid rgba(251,113,133,.3);
            display: grid; place-items: center;
            color: var(--err);
        }
        #${UID} .app-blocked-title {
            font-family: 'Fredoka', 'Quicksand', sans-serif;
            font-size: 20px; font-weight: 500;
            color: #fff;
        }
        #${UID} .app-blocked-desc {
            font-size: 13.5px; color: var(--text-dim);
            max-width: 400px; line-height: 1.55;
        }
        #${UID} .app-blocked-btn {
            all: unset;
            margin-top: 6px;
            padding: 11px 22px;
            border-radius: 12px;
            background: var(--grad);
            color: #0b0b10;
            font-family: 'Quicksand', sans-serif;
            font-size: 13px; font-weight: 700;
            cursor: pointer;
            box-shadow: 0 10px 26px -10px rgba(34,211,238,.45);
            transition: transform .18s;
        }
        #${UID} .app-blocked-btn:hover { transform: translateY(-2px); }
        #${UID} .app-blocked-btn:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }

        /* ─── Anime ─── */
        #${UID} .anime-wrap {
            flex: 1; min-height: 0;
            overflow-y: auto;
            padding: 20px 22px 24px;
            background: radial-gradient(60% 70% at 50% 0%, rgba(167,139,250,.08), transparent 60%), #08090d;
        }
        #${UID} .anime-wrap::-webkit-scrollbar { width: 5px; }
        #${UID} .anime-wrap::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 3px; }
        #${UID} .anime-head {
            display: flex; align-items: baseline; justify-content: space-between;
            margin-bottom: 16px; gap: 12px;
        }
        #${UID} .anime-head h2 {
            margin: 0;
            font-family: 'Fredoka', 'Quicksand', sans-serif;
            font-size: 20px; font-weight: 500;
            color: #fff; letter-spacing: -.005em;
        }
        #${UID} .anime-head small {
            display: block;
            font-family: 'Quicksand', sans-serif;
            font-size: 10px; font-weight: 700;
            letter-spacing: .18em; text-transform: uppercase;
            color: var(--violet);
            margin-bottom: 4px;
        }
        #${UID} .anime-head-sub { font-size: 12px; color: var(--text-faint); }
        #${UID} .anime-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
            gap: 14px;
        }
        #${UID} .anime-card {
            all: unset;
            display: flex; flex-direction: column;
            gap: 8px;
            cursor: pointer;
            border-radius: 12px;
            overflow: hidden;
            background: rgba(255,255,255,.025);
            border: 1px solid var(--line);
            transition: transform .2s cubic-bezier(.22,1,.36,1), border-color .2s, background .2s;
            position: relative;
        }
        #${UID} .anime-card:hover {
            transform: translateY(-3px);
            border-color: rgba(167,139,250,.4);
            background: rgba(255,255,255,.045);
        }
        #${UID} .anime-card:focus-visible,
        #${UID} .anime-card.focused {
            outline: none;
            border-color: var(--violet);
            box-shadow: 0 0 0 2px rgba(167,139,250,.5), 0 12px 28px -12px rgba(0,0,0,.6);
        }
        #${UID} .anime-poster {
            aspect-ratio: 2 / 3;
            width: 100%;
            object-fit: cover;
            display: block;
            background: #10131a;
        }
        #${UID} .anime-info { padding: 0 10px 12px; }
        #${UID} .anime-name {
            font-size: 11.5px; font-weight: 600;
            color: var(--text);
            line-height: 1.3;
            overflow: hidden; text-overflow: ellipsis;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        }
        #${UID} .anime-meta {
            margin-top: 4px;
            font-size: 10px; font-weight: 500;
            color: var(--text-faint);
        }
        #${UID} .anime-state {
            grid-column: 1 / -1;
            text-align: center;
            padding: 60px 20px;
            font-size: 13.5px; color: var(--text-faint);
        }
        #${UID} .anime-episodes {
            display: flex; flex-direction: column; gap: 6px;
            padding: 16px 20px;
            background: #0a0b0f;
            border-top: 1px solid var(--line);
            max-height: 220px;
            overflow-y: auto;
        }
        #${UID} .anime-episode {
            all: unset;
            display: flex; align-items: center; gap: 10px;
            padding: 8px 12px;
            border-radius: 8px;
            background: rgba(255,255,255,.025);
            border: 1px solid var(--line);
            cursor: pointer;
            font-size: 12.5px; font-weight: 600;
            color: var(--text);
            transition: background .16s, border-color .16s;
        }
        #${UID} .anime-episode:hover {
            background: rgba(34,211,238,.08);
            border-color: rgba(34,211,238,.3);
        }
        #${UID} .anime-episode .ep-num {
            font-family: 'Fredoka', 'Quicksand', sans-serif;
            color: var(--cyan);
            min-width: 40px;
        }
        #${UID} .anime-player {
            width: 100%; height: 100%;
            background: #000;
        }

        /* ─── TV home ─── */
        #${UID} .tv-home { flex: 1; min-height: 0; flex-direction: column; }
        #${UID} .tv-toolbar {
            flex-shrink: 0;
            padding: 16px 22px 10px;
            display: flex; flex-direction: column; gap: 10px;
        }
        #${UID} .tv-search input {
            width: 100%;
            background: rgba(255,255,255,.03);
            border: 1px solid var(--line);
            border-radius: 11px;
            padding: 11px 14px;
            color: var(--text);
            font-family: 'Quicksand', sans-serif;
            font-size: 13.5px; font-weight: 500;
            outline: none; box-sizing: border-box;
            transition: border-color .18s, box-shadow .18s, background .18s;
        }
        #${UID} .tv-search input::placeholder { color: var(--text-faint); }
        #${UID} .tv-search input:focus {
            border-color: rgba(34,211,238,.45);
            background: rgba(255,255,255,.045);
            box-shadow: 0 0 0 3px rgba(34,211,238,.1);
        }
        #${UID} .tv-chips {
            display: flex; gap: 7px;
            overflow-x: auto; padding-bottom: 2px;
            scrollbar-width: none;
        }
        #${UID} .tv-chips::-webkit-scrollbar { display: none; }
        #${UID} .tv-chip {
            flex-shrink: 0;
            font-family: 'Quicksand', sans-serif;
            font-size: 11.5px; font-weight: 600;
            padding: 6px 14px;
            border-radius: 99px;
            cursor: pointer; white-space: nowrap;
            background: rgba(255,255,255,.03);
            border: 1px solid var(--line);
            color: var(--text-dim);
            transition: all .16s;
        }
        #${UID} .tv-chip:hover {
            border-color: rgba(34,211,238,.35);
            color: var(--text);
            background: rgba(255,255,255,.05);
        }
        #${UID} .tv-chip.active {
            background: var(--grad);
            color: #0b0b10;
            border-color: transparent;
            box-shadow: 0 4px 14px -6px rgba(34,211,238,.5);
        }
        #${UID} .tv-chip:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        #${UID} .tv-chip.fav-chip {
            border-color: rgba(251,191,36,.3);
            color: #fbbf24;
        }
        #${UID} .tv-chip.fav-chip.active {
            background: #fbbf24;
            color: #1a1410;
            border-color: transparent;
        }
        #${UID} .tv-grid {
            flex: 1; min-height: 0;
            overflow-y: auto;
            padding: 6px 22px 22px;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
            gap: 14px;
            align-content: start;
        }
        #${UID} .tv-grid::-webkit-scrollbar { width: 5px; }
        #${UID} .tv-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 3px; }

        #${UID} .tv-tile {
            position: relative;
            display: flex; flex-direction: column;
            align-items: center; gap: 10px;
            padding: 16px 10px 12px;
            border-radius: 14px;
            cursor: pointer;
            background: rgba(255,255,255,.025);
            border: 1px solid var(--line);
            transition: transform .2s cubic-bezier(.22,1,.36,1), background .2s, border-color .2s, box-shadow .2s;
        }
        #${UID} .tv-tile:hover {
            transform: translateY(-3px);
            background: rgba(255,255,255,.045);
            border-color: var(--line-2);
        }
        #${UID} .tv-tile:focus-visible,
        #${UID} .tv-tile.focused {
            outline: none;
            transform: translateY(-3px) scale(1.03);
            background: rgba(255,255,255,.05);
            border-color: rgba(34,211,238,.5);
            box-shadow: 0 0 0 2px rgba(34,211,238,.4), 0 12px 30px -14px rgba(0,0,0,.6);
        }
        #${UID} .tv-tile.tv-tile-off { opacity: .35; }
        #${UID} .tv-tile-logo {
            width: 60px; height: 60px;
            border-radius: 12px; overflow: hidden;
            background: rgba(255,255,255,.03);
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0;
        }
        #${UID} .tv-tile-logo img { width: 100%; height: 100%; object-fit: contain; }
        #${UID} .tv-tile-name {
            font-family: 'Quicksand', sans-serif;
            font-size: 12.5px; font-weight: 600;
            text-align: center; line-height: 1.3;
            max-width: 100%;
            overflow: hidden; text-overflow: ellipsis;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
            color: var(--text);
        }
        #${UID} .tv-tile-meta {
            font-size: 10px; font-weight: 500;
            color: var(--text-faint);
            text-align: center;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            max-width: 100%;
        }
        #${UID} .tv-tile-badge {
            position: absolute;
            bottom: 8px; left: 50%; transform: translateX(-50%);
            font-size: 8px; font-weight: 800;
            letter-spacing: .08em;
            color: var(--err);
            background: rgba(251,113,133,.12);
            border: 1px solid rgba(251,113,133,.3);
            border-radius: 5px;
            padding: 2px 6px;
        }
        #${UID} .tv-star {
            position: absolute;
            top: 8px; right: 8px;
            width: 24px; height: 24px;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,.4);
            border: 0;
            color: var(--text-faint);
            cursor: pointer;
            transition: color .15s, transform .15s, background .15s;
        }
        #${UID} .tv-star:hover { transform: scale(1.12); background: rgba(0,0,0,.6); color: var(--text); }
        #${UID} .tv-star.faved { color: #fbbf24; }
        #${UID} .tv-star:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

        #${UID} .tv-loading, #${UID} .tv-empty {
            grid-column: 1 / -1;
            padding: 60px 20px;
            text-align: center;
            color: var(--text-faint);
            font-size: 13.5px;
        }
        #${UID} .tv-spin {
            width: 20px; height: 20px;
            border: 2px solid rgba(34,211,238,.2);
            border-top-color: var(--cyan);
            border-radius: 50%;
            margin: 0 auto 12px;
            animation: iptvSpin .7s linear infinite;
        }

        /* ─── Player ─── */
        #${UID} .tv-player { flex: 1; min-height: 0; flex-direction: column; }
        #${UID} .tv-video-wrap {
            flex: 1; min-height: 0;
            position: relative;
            background: #000;
            display: flex; align-items: center; justify-content: center;
            overflow: hidden;
        }
        #${UID} .tv-video-wrap video { width: 100%; height: 100%; object-fit: contain; display: block; }
        #${UID} .tv-placeholder {
            color: var(--text-faint);
            font-size: 13.5px;
            text-align: center;
            padding: 24px;
            line-height: 1.55;
        }
        #${UID} .tv-controlbar {
            height: ${CONTROLBAR_HEIGHT}px;
            flex-shrink: 0;
            box-sizing: border-box;
            display: flex; align-items: center;
            gap: 14px; padding: 0 22px;
            background: rgba(255,255,255,.015);
            border-top: 1px solid var(--line);
        }
        #${UID} .tv-back {
            flex-shrink: 0;
            display: flex; align-items: center; gap: 8px;
            padding: 9px 16px;
            border-radius: 11px;
            background: rgba(255,255,255,.04);
            border: 1px solid var(--line);
            color: var(--text);
            font-family: 'Quicksand', sans-serif;
            font-size: 12.5px; font-weight: 600;
            cursor: pointer;
            transition: background .16s, border-color .16s, color .16s, transform .16s;
        }
        #${UID} .tv-back:hover {
            background: rgba(34,211,238,.1);
            border-color: rgba(34,211,238,.35);
            color: var(--cyan);
            transform: translateY(-1px);
        }
        #${UID} .tv-back:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        #${UID} .tv-now { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; }
        #${UID} .tv-now-logo {
            width: 42px; height: 42px;
            border-radius: 10px;
            flex-shrink: 0;
            background: rgba(255,255,255,.03);
            object-fit: contain;
            border: 1px solid var(--line);
        }
        #${UID} .tv-now-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        #${UID} .tv-now-name {
            font-family: 'Quicksand', sans-serif;
            font-size: 14px; font-weight: 600;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            color: var(--text);
        }
        #${UID} .tv-now-meta {
            font-size: 11px; font-weight: 500;
            color: var(--text-dim);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        #${UID} .tv-controlbar .tv-star {
            position: static;
            flex-shrink: 0;
            background: rgba(255,255,255,.04);
            border: 1px solid var(--line);
            width: 42px; height: 42px;
            border-radius: 11px;
        }
        #${UID} .tv-controlbar .tv-star:hover { background: rgba(255,255,255,.07); transform: scale(1.04); }

        /* Resize handle (only in app view) */
        #${UID} .resize {
            position: absolute;
            right: 4px; bottom: 4px;
            width: 18px; height: 18px;
            cursor: nwse-resize;
            z-index: 20;
            opacity: .22;
            display: none;
            transition: opacity .18s;
        }
        #${UID}.can-resize .resize { display: block; }
        #${UID} .resize:hover { opacity: .9; }
        #${UID} .resize::before,
        #${UID} .resize::after {
            content: '';
            position: absolute;
            right: 0; bottom: 0;
            background: var(--cyan);
            border-radius: 2px;
        }
        #${UID} .resize::before { width: 10px; height: 1.5px; bottom: 4px; right: 1px; }
        #${UID} .resize::after { width: 1.5px; height: 10px; bottom: 1px; right: 4px; }

        /* ─── SVI ─── */
        #${UID} .svi-wrap {
            flex: 1; min-height: 0;
            overflow-y: auto;
            padding: 20px 22px 24px;
            background: radial-gradient(60% 70% at 50% 0%, rgba(124,58,237,.1), transparent 60%), #08090d;
        }
        #${UID} .svi-wrap::-webkit-scrollbar { width: 5px; }
        #${UID} .svi-wrap::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 3px; }
        #${UID} .svi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 14px;
        }
        #${UID} .svi-card {
            all: unset;
            display: block;
            cursor: pointer;
            border-radius: 12px;
            overflow: hidden;
            background: rgba(255,255,255,.025);
            border: 1px solid var(--line);
            transition: transform .2s cubic-bezier(.22,1,.36,1), border-color .2s, background .2s;
            position: relative;
        }
        #${UID} .svi-card:hover {
            transform: translateY(-3px);
            border-color: rgba(167,139,250,.5);
            background: rgba(255,255,255,.045);
        }
        #${UID} .svi-card:focus-visible {
            outline: none;
            border-color: var(--violet);
            box-shadow: 0 0 0 2px rgba(167,139,250,.5), 0 12px 28px -12px rgba(0,0,0,.6);
        }
        #${UID} .svi-card-thumb {
            width: 100%;
            aspect-ratio: 16 / 9;
            object-fit: cover;
            display: block;
            background: #10131a;
        }
        #${UID} .svi-card-thumb-fallback {
            display: grid; place-items: center;
            color: var(--violet);
            background: linear-gradient(135deg, #1e1b4b, #0c0a30);
        }
        #${UID} .svi-card-label {
            padding: 8px 10px;
            font-size: 11px;
            font-weight: 600;
            color: var(--text-dim);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        #${UID} .svi-player {
            flex: 1; min-height: 0;
            background: #000;
            position: relative;
        }
        #${UID} .svi-player iframe {
            width: 100%; height: 100%;
            border: 0; display: block;
            background: #000;
        }
        `;
        document.head.appendChild(style);

        const win = document.createElement('div');
        win.id = UID;
        win.className = 'v-smart';
        win.setAttribute('data-sang-ui', '');
        win.setAttribute('data-hub', '1');
        win.innerHTML = `
            <div class="hdr" id="${UID}hdr">
                <div class="hdr-left">
                    <span class="clock" id="${UID}clock">--:--</span>
                    <span class="clock-sep" aria-hidden="true"></span>
                    <div class="brand">
                        <span class="brand-dot">${svg('sparkle', 14)}</span>
                        <span class="brand-title">Sang TV</span>
                        <span class="brand-tag">BR</span>
                    </div>
                </div>
                <div class="hdr-actions">
                    <button class="hdr-btn" id="${UID}actSearch" title="Buscar">${svg('search', 16)}</button>
                    <button class="hdr-btn" id="${UID}actBell" title="Notificações">${svg('bell', 16)}</button>
                    <button class="hdr-btn" id="${UID}actUser" title="Perfil">${svg('user', 16)}</button>
                    <span class="hdr-sep"></span>
                    <button class="hdr-btn" id="${UID}actExternal" title="Abrir app em nova aba" style="display:none">${svg('external', 16)}</button>
                    <button class="hdr-btn primary" id="${UID}actHome" title="Início">${svg('home', 16)}</button>
                    <button class="hdr-btn" id="${UID}actHdr" title="Ocultar cabeçalho">${svg('hideHdr', 16)}</button>
                    <button class="hdr-btn" id="${UID}actMin" title="Minimizar">${svg('minimize', 16)}</button>
                    <button class="hdr-btn danger" id="${UID}actClose" title="Fechar">${svg('close', 16)}</button>
                </div>
            </div>
            <div class="body">
                <aside class="sb" id="${UID}sb">
                    <button class="sb-btn active" data-nav="home" title="Início">${svg('home', 18)}</button>
                    <button class="sb-btn" data-nav="library" title="TV Aberta">${svg('library', 18)}</button>
                    <button class="sb-btn" data-nav="apps" title="Apps">${svg('apps', 18)}</button>
                    <button class="sb-btn" data-nav="search" title="Buscar">${svg('search', 18)}</button>
                    <div class="sb-spacer"></div>
                    <button class="sb-btn" data-nav="downloads" title="Downloads">${svg('download', 18)}</button>
                    <button class="sb-btn" data-nav="settings" title="Ajustes">${svg('settings', 18)}</button>
                    <button class="sb-toggle" id="${UID}sbToggle" title="Ocultar barra">${svg('chevronLeft', 16)}</button>
                </aside>
                <button class="sb-expand" id="${UID}sbExpand" title="Mostrar barra">${svg('chevronRight', 16)}</button>
                <div class="main">
                    <div class="view v-smart-el smart" id="${UID}smart">
                        <div class="hero">
                            <div class="hero-body">
                                <span class="hero-eyebrow" id="${UID}greet">Bom dia</span>
                                <h1 class="hero-title"><small>Sua central de mídia</small>Bem-vindo</h1>
                                <p class="hero-desc">Canais abertos brasileiros, streaming, anime — tudo em um lugar só. Escolha um app abaixo para começar.</p>
                                <button class="hero-cta" type="button" data-app="tv">
                                    ${svg('play', 12)}
                                    <span>Assistir TV Aberta</span>
                                </button>
                            </div>
                        </div>
                        <div class="sect">
                            <div class="sect-title">Seus apps</div>
                            <div class="apps-row" id="${UID}apps"></div>
                        </div>
                    </div>
                    <div class="view v-app-el app-shell" id="${UID}appShell" style="display:none"></div>
                    <div class="view v-home-el tv-home">
                        <div class="tv-toolbar">
                            <div class="tv-search"><input type="text" id="${UID}search" placeholder="Buscar canal…" /></div>
                            <div class="tv-chips" id="${UID}filters"></div>
                        </div>
                        <div class="tv-grid" id="${UID}grid">
                            <div class="tv-loading"><div class="tv-spin"></div>Carregando canais…</div>
                        </div>
                    </div>
                    <div class="view v-player-el tv-player">
                        <div class="tv-video-wrap" id="${UID}video-wrap">
                            <div class="tv-placeholder">${svg('play', 26)}<div style="margin-top:10px">Selecione um canal</div></div>
                        </div>
                        <div class="tv-controlbar">
                            <button class="tv-back" id="${UID}back">${svg('back', 16)}<span>Canais</span></button>
                            <div class="tv-now">
                                <img class="tv-now-logo" id="${UID}nowLogo" alt="" />
                                <div class="tv-now-text">
                                    <div class="tv-now-name" id="${UID}nowName">—</div>
                                    <div class="tv-now-meta" id="${UID}nowMeta"></div>
                                </div>
                            </div>
                            <button class="tv-star" id="${UID}nowStar" title="Favoritar">${svg('star', 16)}</button>
                        </div>
                    </div>
                </div>
            </div>
            <button class="unhide" id="${UID}unhide" title="Mostrar cabeçalho">${svg('showHdr', 14)}</button>
            <div class="resize" id="${UID}resize" title="Redimensionar"></div>
        `;
        document.body.appendChild(win);
        window._hubUI?.markProtected?.(win);

        const gridEl = win.querySelector('#' + UID + 'grid');
        const videoWrapEl = win.querySelector('#' + UID + 'video-wrap');
        const searchEl = win.querySelector('#' + UID + 'search');
        const filtersEl = win.querySelector('#' + UID + 'filters');
        const hdr = win.querySelector('#' + UID + 'hdr');
        const resizeHandle = win.querySelector('#' + UID + 'resize');
        const backBtn = win.querySelector('#' + UID + 'back');
        const appsRowEl = win.querySelector('#' + UID + 'apps');
        const greetEl = win.querySelector('#' + UID + 'greet');
        const appShell = win.querySelector('#' + UID + 'appShell');
        const clockEl = win.querySelector('#' + UID + 'clock');
        const sbEl = win.querySelector('#' + UID + 'sb');

        // Scroll horizontal com a roda do mouse (sem scrollbar visível)
        appsRowEl.addEventListener('wheel', (e) => {
            if (e.deltaY === 0) return;
            if (appsRowEl.scrollWidth <= appsRowEl.clientWidth) return;
            e.preventDefault();
            appsRowEl.scrollLeft += e.deltaY;
        }, { passive: false });

        // Clock
        let clockTimer = null; let clockUltimo = '';
        function atualizarRelogio() {
            if (!clockEl) return;
            const d = new Date();
            const txt = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
            if (txt !== clockUltimo) { clockEl.textContent = txt; clockUltimo = txt; }
        }
        atualizarRelogio();
        clockTimer = setInterval(atualizarRelogio, CLOCK_TICK_MS);

        let allChannels = [];
        let allCategories = [];
        let hls = null;
        let conectarTimeout = null;
        let chamadaAtual = 0;
        let filtroCategoria = null;
        let mostrarSoFavoritos = false;
        let termoBusca = '';
        let vista = 'smart';
        let layoutTimeout = null;
        let sidebarHidden = false;

        const state = { winW: FIXED_W, winHApp: FIXED_H };

        // ---------- Apps registry ----------
        const apps = new Map();
        let appAtualId = null;
        let appCleanup = null;
        let appUrlAtual = null;
        let focoEl = null;

        // Helper: mount iframe com detecção de bloqueio
        function mountIframeApp({ id, name, url, icon, tag, cardBg }) {
            apps.set(id, {
                id, name, icon, tag, cardBg, url,
                mount(container) {
                    container.innerHTML = '';
                    const bar = document.createElement('div');
                    bar.className = 'app-bar';
                    bar.innerHTML = `
                        <div class="app-bar-left">
                            <span class="app-bar-dot" id="${UID}appDot"></span>
                            <span class="app-bar-title">${escapeHtml(name)}</span>
                            <span class="app-bar-sub" id="${UID}appSub">tentando incorporar…</span>
                        </div>
                        <div class="app-bar-actions">
                            <button class="hdr-btn" id="${UID}appReload" title="Recarregar">${svg('chevronRight', 16)}</button>
                            <button class="hdr-btn" id="${UID}appOpen" title="Abrir em nova aba">${svg('external', 16)}</button>
                        </div>
                    `;
                    const wrap = document.createElement('div');
                    wrap.className = 'app-frame-wrap';
                    const iframe = document.createElement('iframe');
                    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
                    iframe.setAttribute('referrerpolicy', 'no-referrer');
                    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-presentation');
                    const blocked = document.createElement('div');
                    blocked.className = 'app-blocked';
                    blocked.innerHTML = `
                        <div class="app-blocked-icon">${svg('external', 22)}</div>
                        <div class="app-blocked-title">${escapeHtml(name)} bloqueia incorporação</div>
                        <div class="app-blocked-desc">Este serviço impede ser mostrado dentro de outros sites por questões de segurança. Abra em uma nova aba para usar normalmente.</div>
                        <button class="app-blocked-btn" id="${UID}appBlockedOpen">Abrir em nova aba</button>
                    `;
                    wrap.appendChild(iframe);
                    wrap.appendChild(blocked);
                    container.appendChild(bar);
                    container.appendChild(wrap);
                    appUrlAtual = url;

                    // Estado do iframe
                    let carregou = false;
                    iframe.addEventListener('load', () => {
                        carregou = true;
                        const dot = win.querySelector('#' + UID + 'appDot');
                        const sub = win.querySelector('#' + UID + 'appSub');
                        if (dot) dot.classList.remove('warn');
                        if (sub) sub.textContent = 'conectado';
                    });
                    iframe.src = url;

                    // Detecta bloqueio
                    const t = setTimeout(() => {
                        if (!carregou) {
                            blocked.classList.add('show');
                            const dot = win.querySelector('#' + UID + 'appDot');
                            const sub = win.querySelector('#' + UID + 'appSub');
                            if (dot) dot.classList.add('warn');
                            if (sub) sub.textContent = 'bloqueado pelo site';
                        }
                    }, EMBED_DETECT_MS);

                    // Handlers
                    win.querySelector('#' + UID + 'appOpen').onclick = () => window.open(url, '_blank', 'noopener');
                    win.querySelector('#' + UID + 'appBlockedOpen').onclick = () => window.open(url, '_blank', 'noopener');
                    win.querySelector('#' + UID + 'appReload').onclick = () => {
                        carregou = false;
                        iframe.src = 'about:blank';
                        setTimeout(() => { iframe.src = url; }, 30);
                        blocked.classList.remove('show');
                    };

                    return () => {
                        clearTimeout(t);
                        iframe.src = 'about:blank';
                    };
                }
            });
        }

        // TV Aberta (builtin)
        apps.set('tv', {
            id: 'tv', name: 'TV Aberta', icon: 'library', tag: 'BR',
            cardBg: 'linear-gradient(135deg, #0c4a6e 0%, #082f49 100%)',
            isBuiltin: true,
        });

        // YouTube (embed real funciona)
        apps.set('youtube', {
            id: 'youtube', name: 'YouTube', icon: 'play', tag: 'GRÁTIS',
            cardBg: 'linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)',
            url: 'https://www.youtube.com/embed/?listType=search&list=lofi+radio',
            mount(container) {
                container.innerHTML = '';
                const bar = document.createElement('div');
                bar.className = 'app-bar';
                bar.innerHTML = `
                    <div class="app-bar-left">
                        <span class="app-bar-dot"></span>
                        <span class="app-bar-title">YouTube</span>
                        <span class="app-bar-sub">embed</span>
                    </div>
                    <div class="app-bar-actions">
                        <button class="hdr-btn" id="${UID}ytOpen" title="Abrir em nova aba">${svg('external', 16)}</button>
                    </div>
                `;
                const wrap = document.createElement('div');
                wrap.className = 'app-frame-wrap';
                const iframe = document.createElement('iframe');
                iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
                iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                iframe.src = 'https://www.youtube.com/embed/?listType=search&list=lofi+radio';
                wrap.appendChild(iframe);
                container.appendChild(bar);
                container.appendChild(wrap);
                appUrlAtual = 'https://www.youtube.com/';
                win.querySelector('#' + UID + 'ytOpen').onclick = () => window.open('https://www.youtube.com/', '_blank', 'noopener');
                return () => { iframe.src = 'about:blank'; };
            }
        });

        // Streaming apps (splash + tentativa de embed)
        function registrarAppExterno({ id, name, url, icon, tag, cardBg }) {
            apps.set(id, {
                id, name, icon, tag, cardBg, url,
                mount(container) {
                    container.innerHTML = '';
                    const bar = document.createElement('div');
                    bar.className = 'app-bar';
                    bar.innerHTML = `
                        <div class="app-bar-left">
                            <span class="app-bar-dot" id="${UID}xDot"></span>
                            <span class="app-bar-title">${escapeHtml(name)}</span>
                            <span class="app-bar-sub" id="${UID}xSub">tentando incorporar…</span>
                        </div>
                        <div class="app-bar-actions">
                            <button class="hdr-btn" id="${UID}xOpen" title="Abrir em nova aba">${svg('external', 16)}</button>
                        </div>
                    `;
                    const wrap = document.createElement('div');
                    wrap.className = 'app-frame-wrap';
                    const iframe = document.createElement('iframe');
                    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
                    iframe.setAttribute('referrerpolicy', 'no-referrer');
                    const blocked = document.createElement('div');
                    blocked.className = 'app-blocked';
                    blocked.innerHTML = `
                        <div class="app-blocked-icon">${svg('external', 22)}</div>
                        <div class="app-blocked-title">${escapeHtml(name)} não permite incorporação</div>
                        <div class="app-blocked-desc">Este serviço restringe a exibição dentro de outros sites. Abra em uma nova aba para usar a sua conta normalmente.</div>
                        <button class="app-blocked-btn" id="${UID}xBlockedOpen">Abrir em nova aba</button>
                    `;
                    wrap.appendChild(iframe);
                    wrap.appendChild(blocked);
                    container.appendChild(bar);
                    container.appendChild(wrap);
                    appUrlAtual = url;
                    let carregou = false;
                    iframe.addEventListener('load', () => {
                        carregou = true;
                        const d = win.querySelector('#' + UID + 'xDot');
                        const s = win.querySelector('#' + UID + 'xSub');
                        if (d) d.classList.remove('warn');
                        if (s) s.textContent = 'conectado';
                    });
                    iframe.src = url;
                    const t = setTimeout(() => {
                        if (!carregou) {
                            blocked.classList.add('show');
                            const d = win.querySelector('#' + UID + 'xDot');
                            const s = win.querySelector('#' + UID + 'xSub');
                            if (d) d.classList.add('warn');
                            if (s) s.textContent = 'bloqueado pelo site';
                        }
                    }, EMBED_DETECT_MS);
                    win.querySelector('#' + UID + 'xOpen').onclick = () => window.open(url, '_blank', 'noopener');
                    win.querySelector('#' + UID + 'xBlockedOpen').onclick = () => window.open(url, '_blank', 'noopener');
                    return () => { clearTimeout(t); iframe.src = 'about:blank'; };
                }
            });
        }

        registrarAppExterno({ id:'netflix', name:'Netflix', url:'https://www.netflix.com/browse', icon:'play', tag:'ASSINATURA', cardBg:'linear-gradient(135deg, #991b1b 0%, #450a0a 100%)' });
        registrarAppExterno({ id:'prime',   name:'Prime Video', url:'https://www.primevideo.com/', icon:'film', tag:'ASSINATURA', cardBg:'linear-gradient(135deg, #075985 0%, #082f49 100%)' });
        registrarAppExterno({ id:'disney',  name:'Disney+', url:'https://www.disneyplus.com/', icon:'sparkle', tag:'ASSINATURA', cardBg:'linear-gradient(135deg, #1e1b4b 0%, #0c0a30 100%)' });
        registrarAppExterno({ id:'voot',    name:'Voot', url:'https://www.voot.com/', icon:'film', tag:'GRÁTIS', cardBg:'linear-gradient(135deg, #5b21b6 0%, #2e1065 100%)' });
        registrarAppExterno({ id:'twitch',  name:'Twitch', url:'https://www.twitch.tv/', icon:'play', tag:'GRÁTIS', cardBg:'linear-gradient(135deg, #6d28d9 0%, #3b0764 100%)' });

        // ---------- Anime App (stream via Consumet) ----------
        apps.set('anime', {
            id: 'anime', name: 'Anime', icon: 'film', tag: 'STREAM',
            cardBg: 'linear-gradient(135deg, #c2410c 0%, #7c2d12 100%)',
            mount(container) {
                container.innerHTML = '';
                const bar = document.createElement('div');
                bar.className = 'app-bar';
                bar.innerHTML = `
                    <div class="app-bar-left">
                        <span class="app-bar-dot" id="${UID}animeDot"></span>
                        <span class="app-bar-title">Anime</span>
                        <span class="app-bar-sub" id="${UID}animeSub">catálogo</span>
                    </div>
                    <div class="app-bar-actions">
                        <button class="hdr-btn" id="${UID}animeBack" title="Voltar ao catálogo" style="display:none">${svg('back', 16)}</button>
                        <button class="hdr-btn" id="${UID}animeExternal" title="Abrir fonte em nova aba">${svg('external', 16)}</button>
                    </div>
                `;

                const wrap = document.createElement('div');
                wrap.className = 'app-frame-wrap';
                wrap.style.display = 'flex';
                wrap.style.flexDirection = 'column';

                const catalog = document.createElement('div');
                catalog.className = 'anime-wrap';
                catalog.innerHTML = `
                    <div class="anime-head">
                        <div>
                            <small>Anime</small>
                            <h2>Top do momento</h2>
                        </div>
                        <div class="anime-head-sub">clique pra ver episódios · fonte: Consumet</div>
                    </div>
                    <div class="anime-grid" id="${UID}animeGrid"><div class="anime-state"><div class="tv-spin"></div>Carregando…</div></div>
                `;

                const episodesPanel = document.createElement('div');
                episodesPanel.className = 'anime-episodes';
                episodesPanel.style.display = 'none';
                episodesPanel.innerHTML = '<div class="tv-empty" style="padding:20px">Clique em um anime para ver os episódios.</div>';

                const playerWrap = document.createElement('div');
                playerWrap.className = 'app-frame-wrap';
                playerWrap.style.display = 'none';
                playerWrap.style.flex = '1';

                wrap.appendChild(catalog);
                wrap.appendChild(episodesPanel);
                wrap.appendChild(playerWrap);

                container.appendChild(bar);
                container.appendChild(wrap);

                const grid = win.querySelector('#' + UID + 'animeGrid');
                const sub = win.querySelector('#' + UID + 'animeSub');
                const backA = win.querySelector('#' + UID + 'animeBack');
                const extBtn = win.querySelector('#' + UID + 'animeExternal');

                let cancelado = false;
                let tituloAtual = '';
                let slugAtual = '';
                let hlsAnime = null;
                const fetchAc = new AbortController();

                function limparPlayerAnime() {
                    if (hlsAnime) { try { hlsAnime.destroy(); } catch (_) {} hlsAnime = null; }
                    const v = playerWrap.querySelector('video');
                    if (v) { try { v.pause(); v.src = ''; } catch (_) {} }
                    playerWrap.innerHTML = '';
                }

                function voltarAoCatalogo() {
                    limparPlayerAnime();
                    playerWrap.style.display = 'none';
                    episodesPanel.style.display = 'none';
                    episodesPanel.innerHTML = '<div class="tv-empty" style="padding:20px">Clique em um anime para ver os episódios.</div>';
                    catalog.style.display = 'block';
                    backA.style.display = 'none';
                    sub.textContent = 'catálogo';
                }

                async function carregarEpisodios(slug, titulo) {
                    tituloAtual = titulo;
                    slugAtual = slug;
                    sub.textContent = titulo;
                    catalog.style.display = 'none';
                    playerWrap.style.display = 'none';
                    episodesPanel.style.display = 'block';
                    episodesPanel.innerHTML = '<div class="tv-empty" style="padding:20px"><div class="tv-spin"></div>Carregando episódios…</div>';
                    backA.style.display = 'grid';

                    try {
                        const res = await fetch(CONSUMET_ANIME_INFO + encodeURIComponent(slug), { signal: fetchAc.signal });
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        const data = await res.json();
                        const eps = Array.isArray(data.episodes) ? data.episodes : [];
                        if (!eps.length) {
                            episodesPanel.innerHTML = '<div class="tv-empty" style="padding:20px">Nenhum episódio disponível.</div>';
                            return;
                        }
                        episodesPanel.innerHTML = '';
                        eps.forEach(ep => {
                            const btn = document.createElement('button');
                            btn.className = 'anime-episode';
                            btn.type = 'button';
                            const num = document.createElement('span');
                            num.className = 'ep-num';
                            num.textContent = 'EP ' + ep.number;
                            const t = document.createElement('span');
                            t.textContent = ep.title || ('Episódio ' + ep.number);
                            btn.appendChild(num);
                            btn.appendChild(t);
                            btn.addEventListener('click', () => tocarEpisodio(ep.id, ep.number));
                            episodesPanel.appendChild(btn);
                        });
                    } catch (e) {
                        if (cancelado || e.name === 'AbortError') return;
                        episodesPanel.innerHTML = '<div class="tv-empty" style="padding:20px">⚠ Falha ao carregar episódios.<br>' + escapeHtml(e.message) + '</div>';
                    }
                }

                async function tocarEpisodio(episodeId, epNumero) {
                    sub.textContent = tituloAtual + ' — EP ' + epNumero;
                    episodesPanel.style.display = 'none';
                    playerWrap.style.display = 'block';
                    playerWrap.innerHTML = '<div class="tv-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%"><div class="tv-spin"></div></div>';

                    try {
                        const res = await fetch(CONSUMET_ANIME_WATCH + encodeURIComponent(episodeId), { signal: fetchAc.signal });
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        const data = await res.json();
                        const sources = Array.isArray(data.sources) ? data.sources : [];
                        const hlsSource = sources.find(s => s.isM3U8) || sources.find(s => (s.url || '').includes('.m3u8')) || sources[0];
                        if (!hlsSource || !hlsSource.url) throw new Error('Nenhuma fonte HLS encontrada.');

                        limparPlayerAnime();
                        const video = document.createElement('video');
                        video.className = 'anime-player';
                        video.controls = true;
                        video.autoplay = true;
                        playerWrap.appendChild(video);

                        const Hls = await loadHlsJs();
                        if (cancelado) return;

                        if (Hls.isSupported()) {
                            const instancia = new Hls();
                            hlsAnime = instancia;
                            instancia.loadSource(hlsSource.url);
                            instancia.attachMedia(video);
                            instancia.on(Hls.Events.ERROR, (event, errData) => {
                                if (hlsAnime !== instancia) return;
                                if (!errData.fatal) return;
                                if (errData.type === Hls.ErrorTypes.NETWORK_ERROR) instancia.startLoad();
                                else if (errData.type === Hls.ErrorTypes.MEDIA_ERROR) instancia.recoverMediaError();
                                else {
                                    playerWrap.innerHTML = '<div class="tv-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%">⚠ Falha na reprodução.</div>';
                                }
                            });
                        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                            video.src = hlsSource.url;
                        } else {
                            playerWrap.innerHTML = '<div class="tv-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%">Seu navegador não suporta HLS.</div>';
                        }
                    } catch (e) {
                        if (cancelado || e.name === 'AbortError') return;
                        playerWrap.innerHTML = '<div class="tv-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%">⚠ ' + escapeHtml(e.message) + '</div>';
                    }
                }

                // Catálogo inicial: usa Jikan para popular pôsteres e o slug do Consumet (por título)
                fetch('https://api.jikan.moe/v4/top/anime?limit=24', { signal: fetchAc.signal })
                    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                    .then(data => {
                        if (cancelado) return;
                        const lista = Array.isArray(data?.data) ? data.data : [];
                        if (!lista.length) { grid.innerHTML = '<div class="anime-state">Nenhum anime encontrado.</div>'; return; }
                        grid.innerHTML = '';
                        lista.forEach(a => {
                            const titulo = a.title_english || a.title || 'Anime';
                            const img = a.images?.jpg?.image_url || '';
                            const nota = a.score ? '★ ' + a.score.toFixed(1) : '—';
                            const ano = a.year || (a.aired?.prop?.from?.year) || '—';

                            const card = document.createElement('button');
                            card.className = 'anime-card';
                            card.type = 'button';
                            card.title = titulo;

                            const poster = document.createElement('img');
                            poster.className = 'anime-poster';
                            poster.loading = 'lazy';
                            poster.referrerPolicy = 'no-referrer';
                            poster.src = img;
                            poster.alt = '';

                            const info = document.createElement('div');
                            info.className = 'anime-info';
                            const nome = document.createElement('div');
                            nome.className = 'anime-name';
                            nome.textContent = titulo;
                            const meta = document.createElement('div');
                            meta.className = 'anime-meta';
                            meta.textContent = nota + ' · ' + ano;
                            info.appendChild(nome);
                            info.appendChild(meta);

                            card.appendChild(poster);
                            card.appendChild(info);

                            // Ao clicar, busca no Consumet pelo título e pega o primeiro resultado
                            card.addEventListener('click', async () => {
                                try {
                                    const r = await fetch(CONSUMET_ANIME_SEARCH + encodeURIComponent(titulo), { signal: fetchAc.signal });
                                    if (!r.ok) throw new Error('HTTP ' + r.status);
                                    const d = await r.json();
                                    const results = Array.isArray(d.results) ? d.results : [];
                                    if (!results.length) throw new Error('Anime não encontrado na fonte de streaming.');
                                    const first = results[0];
                                    carregarEpisodios(first.id, titulo);
                                } catch (e) {
                                    if (cancelado || e.name === 'AbortError') return;
                                    // fallback: abre trailer no YouTube dentro do script
                                    const q = encodeURIComponent(titulo + ' official trailer');
                                    sub.textContent = titulo + ' (trailer)';
                                    catalog.style.display = 'none';
                                    playerWrap.style.display = 'block';
                                    backA.style.display = 'grid';
                                    limparPlayerAnime();
                                    const iframe = document.createElement('iframe');
                                    iframe.className = 'anime-player';
                                    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
                                    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                                    iframe.src = 'https://www.youtube.com/embed/?listType=search&list=' + q;
                                    playerWrap.appendChild(iframe);
                                    playerWrap.querySelector('.anime-player').dataset.tipo = 'trailer';
                                }
                            });

                            grid.appendChild(card);
                        });
                    })
                    .catch(e => {
                        if (cancelado || e.name === 'AbortError') return;
                        grid.innerHTML = '<div class="anime-state">⚠ Falha ao carregar catálogo.<br>' + escapeHtml(e.message) + '</div>';
                    });

                backA.onclick = () => {
                    voltarAoCatalogo();
                };
                extBtn.onclick = () => {
                    if (slugAtual) window.open('https://gogoanime3.co/category/' + encodeURIComponent(slugAtual), '_blank', 'noopener');
                    else window.open('https://gogoanime3.co/', '_blank', 'noopener');
                };

                return () => {
                    cancelado = true;
                    try { fetchAc.abort(); } catch(_) {}
                    limparPlayerAnime();
                };
            }
        });

        // ---------- SVI (embeds via CSV) ----------
        apps.set('svi', {
            id: 'svi', name: 'SVI', icon: 'play', tag: 'STREAM',
            cardBg: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)',
            mount(container) {
                const SVI_CSV_URL = 'https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/assets/PNG/AI/embed.csv';
                container.innerHTML = '';

                const bar = document.createElement('div');
                bar.className = 'app-bar';
                bar.innerHTML = `
                    <div class="app-bar-left">
                        <span class="app-bar-dot" id="${UID}sviDot"></span>
                        <span class="app-bar-title">SVI</span>
                        <span class="app-bar-sub" id="${UID}sviSub">carregando…</span>
                    </div>
                    <div class="app-bar-actions">
                        <button class="hdr-btn" id="${UID}sviBack" title="Voltar ao catálogo" style="display:none">${svg('back', 16)}</button>
                        <button class="hdr-btn" id="${UID}sviReload" title="Recarregar catálogo">${svg('chevronRight', 16)}</button>
                    </div>
                `;

                const wrap = document.createElement('div');
                wrap.className = 'app-frame-wrap';
                wrap.style.overflow = 'hidden';
                wrap.style.display = 'flex';
                wrap.style.flexDirection = 'column';
                wrap.style.background = '#08090d';

                const gridWrap = document.createElement('div');
                gridWrap.className = 'svi-wrap';
                gridWrap.innerHTML = `
                    <div class="anime-head">
                        <div>
                            <small>SVI</small>
                            <h2>Catálogo</h2>
                        </div>
                        <div class="anime-head-sub" id="${UID}sviCount"></div>
                    </div>
                    <div class="svi-grid" id="${UID}sviGrid">
                        <div class="anime-state"><div class="tv-spin"></div>Carregando catálogo…</div>
                    </div>
                `;

                const playerWrap = document.createElement('div');
                playerWrap.className = 'svi-player';
                playerWrap.style.display = 'none';

                wrap.appendChild(gridWrap);
                wrap.appendChild(playerWrap);
                container.appendChild(bar);
                container.appendChild(wrap);

                const grid = win.querySelector('#' + UID + 'sviGrid');
                const sub = win.querySelector('#' + UID + 'sviSub');
                const count = win.querySelector('#' + UID + 'sviCount');
                const backA = win.querySelector('#' + UID + 'sviBack');
                const reloadBtn = win.querySelector('#' + UID + 'sviReload');

                let cancelado = false;
                const fetchAc = new AbortController();

                // ─── CSV parser robusto (RFC 4180-ish, detecta delimitador) ───
                function detectDelimiter(line) {
                    const counts = { ',': 0, ';': 0, '\t': 0 };
                    let inQuotes = false;
                    for (let i = 0; i < line.length; i++) {
                        const ch = line[i];
                        if (ch === '"') inQuotes = !inQuotes;
                        else if (!inQuotes && ch in counts) counts[ch]++;
                    }
                    let best = ',', bestN = -1;
                    for (const d in counts) if (counts[d] > bestN) { bestN = counts[d]; best = d; }
                    return best;
                }
                function parseCSV(text) {
                    const firstLine = text.split(/\r?\n/).find(l => l.trim().length) || '';
                    const delim = detectDelimiter(firstLine);
                    const rows = [];
                    let row = [], field = '', inQuotes = false, i = 0;
                    while (i < text.length) {
                        const ch = text[i];
                        if (inQuotes) {
                            if (ch === '"') {
                                if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                                inQuotes = false; i++; continue;
                            }
                            field += ch; i++; continue;
                        }
                        if (ch === '"') { inQuotes = true; i++; continue; }
                        if (ch === delim) { row.push(field); field = ''; i++; continue; }
                        if (ch === '\r') { i++; continue; }
                        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
                        field += ch; i++;
                    }
                    if (field.length || row.length) { row.push(field); rows.push(row); }
                    return rows;
                }
                function extractIframeSrc(html) {
                    if (!html) return null;
                    const m = html.match(/<iframe[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/i);
                    return m ? m[1] : null;
                }
                const isUrl = s => /^https?:\/\//i.test((s || '').trim());
                const isIframeHtml = s => /<iframe/i.test(s || '');

                function limparPlayerSVI() {
                    const ifr = playerWrap.querySelector('iframe');
                    if (ifr) { try { ifr.src = 'about:blank'; } catch(_) {} }
                    playerWrap.innerHTML = '';
                }
                function voltarCatalogo() {
                    limparPlayerSVI();
                    playerWrap.style.display = 'none';
                    gridWrap.style.display = 'block';
                    backA.style.display = 'none';
                    sub.textContent = count.textContent || 'catálogo';
                }
                function abrirVideo(item) {
                    gridWrap.style.display = 'none';
                    playerWrap.style.display = 'block';
                    backA.style.display = 'grid';
                    sub.textContent = item.label;
                    limparPlayerSVI();
                    const iframe = document.createElement('iframe');
                    iframe.src = item.embedSrc;
                    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
                    iframe.setAttribute('referrerpolicy', 'no-referrer');
                    iframe.setAttribute('allowfullscreen', 'true');
                    iframe.setAttribute('scrolling', 'no');
                    iframe.setAttribute('frameborder', '0');
                    playerWrap.appendChild(iframe);
                }

                function extrairLabel(thumb, embedSrc) {
                    try {
                        const u = new URL(thumb);
                        const parts = u.pathname.split('/').filter(Boolean);
                        const last = (parts[parts.length - 1] || '').replace(/\.[a-z0-9]+$/i, '');
                        if (last && last.length > 1) return last;
                    } catch(_) {}
                    try {
                        const u = new URL(embedSrc);
                        const parts = u.pathname.split('/').filter(Boolean);
                        return parts[parts.length - 1] || 'Vídeo';
                    } catch(_) {}
                    return 'Vídeo';
                }

                function renderCards(items) {
                    if (!items.length) {
                        grid.innerHTML = '<div class="anime-state">Nenhum vídeo encontrado no catálogo.</div>';
                        return;
                    }
                    grid.innerHTML = '';
                    items.forEach((item, idx) => {
                        const card = document.createElement('button');
                        card.className = 'svi-card';
                        card.type = 'button';
                        card.title = item.label;
                        card.style.animation = `iptvTileIn .3s cubic-bezier(.22,1,.36,1) ${Math.min(idx * 22, 280)}ms backwards`;

                        if (item.thumb) {
                            const thumb = document.createElement('img');
                            thumb.className = 'svi-card-thumb';
                            thumb.loading = 'lazy';
                            thumb.decoding = 'async';
                            thumb.referrerPolicy = 'no-referrer';
                            thumb.alt = '';
                            thumb.src = item.thumb;
                            thumb.onerror = () => {
                                thumb.remove();
                                const ph = document.createElement('div');
                                ph.className = 'svi-card-thumb svi-card-thumb-fallback';
                                ph.innerHTML = svg('play', 22);
                                card.insertBefore(ph, card.firstChild);
                            };
                            card.appendChild(thumb);
                        } else {
                            const ph = document.createElement('div');
                            ph.className = 'svi-card-thumb svi-card-thumb-fallback';
                            ph.innerHTML = svg('play', 22);
                            card.appendChild(ph);
                        }

                        const label = document.createElement('div');
                        label.className = 'svi-card-label';
                        label.textContent = item.label;
                        card.appendChild(label);

                        card.addEventListener('click', () => abrirVideo(item));
                        grid.appendChild(card);
                    });
                }

                async function carregarCatalogo() {
                    sub.textContent = 'carregando…';
                    count.textContent = '';
                    grid.innerHTML = '<div class="anime-state"><div class="tv-spin"></div>Carregando catálogo…</div>';
                    try {
                        const res = await fetch(SVI_CSV_URL, { cache: 'no-store', signal: fetchAc.signal });
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        const text = await res.text();
                        if (cancelado) return;

                        const rows = parseCSV(text);
                        if (!rows.length) throw new Error('CSV vazio');

                        // Se primeira linha for cabeçalho (sem http e sem iframe), pula
                        let start = 0;
                        const firstRowStr = rows[0].join(' ');
                        if (!isUrl(firstRowStr) && !isIframeHtml(firstRowStr)) start = 1;

                        const items = [];
                        for (let r = start; r < rows.length; r++) {
                            const cells = rows[r].map(c => c.trim()).filter(Boolean);
                            if (!cells.length) continue;

                            let thumb = null, iframeHtml = null, embedSrc = null;
                            for (const c of cells) {
                                if (!thumb && isUrl(c) && /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(c)) {
                                    thumb = c;
                                }
                                if (!iframeHtml && isIframeHtml(c)) {
                                    iframeHtml = c;
                                    embedSrc = extractIframeSrc(c);
                                }
                            }
                            // Fallback: pega primeira URL que não seja o embed
                            if (!thumb) {
                                for (const c of cells) {
                                    if (isUrl(c) && c !== embedSrc) { thumb = c; break; }
                                }
                            }
                            if (!embedSrc) continue;

                            items.push({
                                thumb,
                                embedSrc,
                                label: extrairLabel(thumb || embedSrc, embedSrc),
                            });
                        }

                        if (!items.length) throw new Error('Nenhum embed válido no CSV');

                        renderCards(items);
                        sub.textContent = items.length + ' vídeos';
                        count.textContent = items.length + ' itens';
                    } catch (e) {
                        if (cancelado || e.name === 'AbortError') return;
                        sub.textContent = 'erro';
                        grid.innerHTML = '<div class="anime-state">⚠ Falha ao carregar catálogo.<br>' + escapeHtml(e.message) + '</div>';
                    }
                }

                backA.onclick = voltarCatalogo;
                reloadBtn.onclick = carregarCatalogo;

                carregarCatalogo();

                return () => {
                    cancelado = true;
                    try { fetchAc.abort(); } catch(_) {}
                    limparPlayerSVI();
                };
            }
        });

        function fecharAppAtual() {
            if (appCleanup) {
                try { appCleanup(); } catch (e) { console.warn('[IPTV] app cleanup falhou:', e); }
                appCleanup = null;
            }
            appShell.innerHTML = '';
            appAtualId = null;
            appUrlAtual = null;
            win.querySelector('#' + UID + 'actExternal').style.display = 'none';
        }

        function abrirApp(id) {
            const app = apps.get(id);
            if (!app) return;
            if (appAtualId && appAtualId !== id) fecharAppAtual();
            appAtualId = id;
            setSidebarAtivo(id === 'tv' ? 'library' : 'apps');

            if (app.isBuiltin) {
                vista = 'home';
                win.classList.remove('v-smart', 'v-app', 'v-player');
                win.classList.add('v-home');
                win.querySelector('#' + UID + 'appShell').style.display = 'none';
                aplicarLayout(true);
                return;
            }

            appShell.innerHTML = '';
            win.classList.remove('v-smart', 'v-home', 'v-player');
            win.classList.add('v-app');
            appShell.style.display = 'flex';
            vista = 'app';

            try {
                const r = app.mount?.(appShell);
                appCleanup = typeof r === 'function' ? r : null;
            } catch (e) {
                console.warn('[IPTV] app mount falhou:', e);
                appShell.innerHTML = '<div class="tv-empty">App indisponível.</div>';
            }
            if (app.url) win.querySelector('#' + UID + 'actExternal').style.display = 'grid';
            aplicarLayout(true);
        }

        function irParaSmart() {
            if (vista === 'player') pararReproducao();
            if (vista === 'app') fecharAppAtual();
            vista = 'smart';
            win.classList.remove('v-home', 'v-player', 'v-app');
            win.classList.add('v-smart');
            setSidebarAtivo('home');
            renderApps();
            aplicarLayout(true);
        }

        function setSidebarAtivo(nav) {
            win.querySelectorAll('.sb-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === nav));
        }

        function renderApps() {
            const h = new Date().getHours();
            if (greetEl) greetEl.textContent = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
            appsRowEl.innerHTML = [...apps.values()].map((a, i) => `
                <button class="app-card" data-app="${escapeHtml(a.id)}"
                        style="--card-bg:${a.cardBg || 'linear-gradient(135deg, #1b1d26 0%, #0f1117 100%)'};animation-delay:${Math.min(i * 40, 240)}ms"
                        type="button">
                    <div class="app-icon">${svg(a.icon || 'apps', 22)}</div>
                    <div class="app-name">${escapeHtml(a.name)}</div>
                    ${a.tag ? `<span class="app-tag">${escapeHtml(a.tag)}</span>` : ''}
                </button>
            `).join('');
            focarPrimeiro();
        }

        function focar(el) {
            if (focoEl) focoEl.classList.remove('focused');
            focoEl = el;
            if (focoEl) {
                focoEl.classList.add('focused');
                try { focoEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); } catch (_) {}
            }
        }
        function focarPrimeiro() {
            if (vista !== 'smart') return;
            const first = appsRowEl.querySelector('.app-card');
            if (first) focar(first);
        }

        function aoDescarregar() { persistirAgora(); }
        window.addEventListener('beforeunload', aoDescarregar);
        window.addEventListener('pagehide', aoDescarregar);

        // Layout
        function aplicarLayout(animar) {
            const headerVisible = !win.classList.contains('hdr-hidden');
            const headerH = headerVisible ? HEADER_HEIGHT : 0;

            win.style.transition = animar ? '' : 'none';
            win.classList.toggle('anim-off', !animar);

            const resizable = (vista === 'app' || vista === 'player');
            win.classList.toggle('can-resize', resizable);

            if (vista === 'player') {
                const videoW = state.winW - BORDER_TOTAL;
                const videoH = videoW / ASPECT_RATIO;
                const winH = videoH + headerH + CONTROLBAR_HEIGHT + BORDER_TOTAL;
                win.style.width = Math.round(state.winW) + 'px';
                win.style.height = Math.round(winH) + 'px';
            } else if (vista === 'app') {
                win.style.width = Math.round(state.winW) + 'px';
                win.style.height = Math.round(state.winHApp) + 'px';
            } else {
                state.winW = FIXED_W;
                state.winHApp = FIXED_H;
                win.style.width = FIXED_W + 'px';
                win.style.height = FIXED_H + 'px';
            }

            if (animar) {
                clearTimeout(layoutTimeout);
                layoutTimeout = setTimeout(() => {
                    win.classList.remove('anim-off');
                    layoutTimeout = null;
                }, 260);
            }
        }

        // Drag
        let drag = null;
        hdr.addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            const r = win.getBoundingClientRect();
            drag = { x: e.clientX - r.left, y: e.clientY - r.top };
        });
        function aoMoverJanela(e) {
            if (!drag) return;
            win.style.left = Math.max(0, e.clientX - drag.x) + 'px';
            win.style.top = Math.max(0, e.clientY - drag.y) + 'px';
        }
        function aoSoltarJanela() { drag = null; }
        document.addEventListener('mousemove', aoMoverJanela);
        document.addEventListener('mouseup', aoSoltarJanela);

        // Resize
        let resizeState = null;
        resizeHandle.addEventListener('mousedown', e => {
            e.preventDefault(); e.stopPropagation();
            if (vista !== 'app' && vista !== 'player') return;
            resizeState = { startX: e.clientX, startY: e.clientY, startWinW: state.winW, startWinH: state.winHApp };
            win.style.transition = 'none';
        });
        function aoMoverResize(e) {
            if (!resizeState) return;
            const dx = e.clientX - resizeState.startX;
            const dy = e.clientY - resizeState.startY;
            if (vista === 'player') {
                const dyAsDx = dy * ASPECT_RATIO;
                const delta = Math.abs(dx) > Math.abs(dyAsDx) ? dx : dyAsDx;
                state.winW = Math.max(MIN_VIDEO_W + BORDER_TOTAL, Math.min(MAX_VIDEO_W + BORDER_TOTAL, resizeState.startWinW + delta));
            } else {
                state.winW = Math.max(MIN_APP_W, Math.min(MAX_APP_W, resizeState.startWinW + dx));
                state.winHApp = Math.max(MIN_APP_H, Math.min(MAX_APP_H, resizeState.startWinH + dy));
            }
            aplicarLayout(false);
        }
        function aoSoltarResize() {
            if (!resizeState) return;
            resizeState = null;
            win.style.transition = '';
        }
        document.addEventListener('mousemove', aoMoverResize);
        document.addEventListener('mouseup', aoSoltarResize);

        // Sidebar toggle
        function setSidebarHidden(v) {
            sidebarHidden = v;
            win.classList.toggle('sb-hidden', v);
        }
        win.querySelector('#' + UID + 'sbToggle').addEventListener('click', () => setSidebarHidden(true));
        win.querySelector('#' + UID + 'sbExpand').addEventListener('click', () => setSidebarHidden(false));

        // Navegação
        function irParaPlayer() {
            vista = 'player';
            win.classList.remove('v-smart', 'v-home', 'v-app');
            win.classList.add('v-player');
            setSidebarAtivo('library');
            aplicarLayout(true);
        }
        function pararReproducao() {
            chamadaAtual++;
            clearTimeout(conectarTimeout);
            if (hls) { hls.destroy(); hls = null; }
            videoWrapEl.innerHTML = '<div class="tv-placeholder">' + svg('play', 26) + '<div style="margin-top:10px">Selecione um canal</div></div>';
        }
        function voltarParaHome() {
            pararReproducao();
            vista = 'home';
            win.classList.remove('v-smart', 'v-player', 'v-app');
            win.classList.add('v-home');
            setSidebarAtivo('library');
            aplicarLayout(true);
        }
        backBtn.addEventListener('click', voltarParaHome);

        function sincronizarEstrela(id) {
            const fav = ehFavorito(id);
            win.querySelectorAll(`[data-star="${CSS.escape(id)}"]`).forEach(btn => {
                btn.innerHTML = fav ? svg('starFill', 16) : svg('star', 16);
                btn.classList.toggle('faved', fav);
                btn.title = fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
            });
        }

        // Clique delegado
        win.addEventListener('click', (e) => {
            const heroCta = e.target.closest('.hero-cta');
            if (heroCta && vista === 'smart') { e.preventDefault(); abrirApp(heroCta.dataset.app || 'tv'); return; }

            const card = e.target.closest('.app-card');
            if (card && vista === 'smart') { e.preventDefault(); abrirApp(card.dataset.app); return; }

            const sbBtn = e.target.closest('.sb-btn');
            if (sbBtn) {
                const nav = sbBtn.dataset.nav;
                if (nav === 'home') irParaSmart();
                else if (nav === 'library') abrirApp('tv');
                else if (nav === 'apps') irParaSmart();
                else if (nav === 'search') { irParaSmart(); setTimeout(() => searchEl?.focus?.(), 120); }
                else setSidebarAtivo(nav);
                return;
            }

            const starBtn = e.target.closest('.tv-star');
            if (starBtn && starBtn.dataset.star) {
                e.stopPropagation();
                const id = starBtn.dataset.star;
                toggleFavorito(id);
                sincronizarEstrela(id);
                if (mostrarSoFavoritos && vista === 'home') renderChannels();
                return;
            }

            const tile = e.target.closest('.tv-tile');
            if (tile && vista === 'home') {
                const canal = allChannels.find(c => c.id === tile.dataset.id);
                if (canal) playChannel(canal, tile);
            }
        });

        // Teclado
        function aoTeclado(e) {
            if (win.style.display === 'none') return;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

            if (e.key === 'Escape') {
                if (vista === 'player') { e.preventDefault(); voltarParaHome(); return; }
                if (vista === 'home') { e.preventDefault(); irParaSmart(); return; }
                if (vista === 'app') { e.preventDefault(); irParaSmart(); return; }
                return;
            }

            if (vista !== 'smart') return;
            if (e.key === 'Enter' && focoEl) { e.preventDefault(); abrirApp(focoEl.dataset.app); return; }
            if (['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)) {
                const cards = [...appsRowEl.querySelectorAll('.app-card')];
                if (!cards.length) return;
                e.preventDefault();
                const forward = (e.key === 'ArrowRight' || e.key === 'ArrowDown');
                const idx = focoEl ? cards.indexOf(focoEl) : -1;
                let next = Math.max(0, Math.min(cards.length - 1, idx + (forward ? 1 : -1)));
                if (cards[next]) focar(cards[next]);
            }
        }
        document.addEventListener('keydown', aoTeclado);

        // Filtros
        filtersEl.addEventListener('click', (e) => {
            const chip = e.target.closest('.tv-chip');
            if (!chip) return;
            if (chip.dataset.fav !== undefined) mostrarSoFavoritos = !mostrarSoFavoritos;
            else {
                const cat = chip.dataset.cat || null;
                filtroCategoria = cat === '' ? null : cat;
            }
            renderFiltros(); renderChannels();
        });

        function renderFiltros() {
            const chips = [];
            chips.push(`<span class="tv-chip fav-chip${mostrarSoFavoritos ? ' active' : ''}" data-fav="1">★ Favoritos</span>`);
            chips.push(`<span class="tv-chip${filtroCategoria === null ? ' active' : ''}" data-cat="">Todos</span>`);
            allCategories.forEach(cat => {
                const ativo = filtroCategoria === cat ? ' active' : '';
                chips.push(`<span class="tv-chip${ativo}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</span>`);
            });
            filtersEl.innerHTML = chips.join('');
        }

        function badgeFalhaHtml(id) {
            const registro = obterStatusFalha(id);
            if (!registro) return '';
            return '<span class="tv-tile-badge" title="Falhou ' + escapeHtml(formatarRelativoCurto(registro.em)) + '">OFFLINE</span>';
        }

        function renderChannels() {
            const q = termoBusca.toLowerCase();
            let filtered = allChannels;
            if (mostrarSoFavoritos) filtered = filtered.filter(c => estado.favoritos.has(c.id));
            if (filtroCategoria) filtered = filtered.filter(c => c.categorias.includes(filtroCategoria));
            if (q) filtered = filtered.filter(c => c.name.toLowerCase().includes(q) || c.categoriaPrincipal.toLowerCase().includes(q));
            if (!filtered.length) { gridEl.innerHTML = '<div class="tv-empty">Nenhum canal encontrado.</div>'; return; }

            const limit = q || filtroCategoria || mostrarSoFavoritos ? filtered.length : 300;
            const visiveis = filtered.slice(0, limit);
            const agora = Date.now();
            const falhas = estado.falhas;
            const favs = estado.favoritos;

            gridEl.innerHTML = visiveis.map(c => {
                const reg = falhas[c.id];
                let falhou = false;
                if (reg) { const t = typeof reg.em === 'number' ? reg.em : Date.parse(reg.em); falhou = (agora - t) < FALHA_TTL_MS; }
                const fav = favs.has(c.id);
                const logoSrc = c.logo || logoPlaceholder(c.name);
                const fallback = logoPlaceholder(c.name);
                const meta = c.categorias.slice(0, 2).join(' · ');
                return `
                <div class="tv-tile${falhou ? ' tv-tile-off' : ''}" data-id="${escapeHtml(c.id)}">
                    <button class="tv-star${fav ? ' faved' : ''}" data-star="${escapeHtml(c.id)}" title="${fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">${fav ? svg('starFill', 14) : svg('star', 14)}</button>
                    <div class="tv-tile-logo"><img src="${escapeHtml(logoSrc)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${fallback}'"/></div>
                    <div class="tv-tile-name">${escapeHtml(c.name)}</div>
                    ${meta ? `<div class="tv-tile-meta">${escapeHtml(meta)}</div>` : ''}
                    ${badgeFalhaHtml(c.id)}
                </div>`;
            }).join('');
        }

        function atualizarControlbar(ch) {
            const nowLogo = win.querySelector('#' + UID + 'nowLogo');
            const nowName = win.querySelector('#' + UID + 'nowName');
            const nowMeta = win.querySelector('#' + UID + 'nowMeta');
            const nowStar = win.querySelector('#' + UID + 'nowStar');
            if (nowLogo) nowLogo.src = ch.logo || logoPlaceholder(ch.name);
            if (nowName) nowName.textContent = ch.name;
            if (nowMeta) nowMeta.textContent = ch.categorias.slice(0, 2).join(' · ');
            if (nowStar) {
                nowStar.dataset.star = ch.id;
                const fav = ehFavorito(ch.id);
                nowStar.innerHTML = fav ? svg('starFill', 16) : svg('star', 16);
                nowStar.classList.toggle('faved', fav);
            }
        }

        // HLS
        async function playChannel(ch, itemEl) {
            const minhaChamada = ++chamadaAtual;
            clearTimeout(conectarTimeout);
            irParaPlayer();
            atualizarControlbar(ch);

            const candidatos = ch.urls || [];
            if (!candidatos.length) {
                videoWrapEl.innerHTML = '<div class="tv-placeholder">⚠ Sem fonte disponível</div>';
                return;
            }

            let indice = 0;

            function sucesso(url) {
                if (minhaChamada !== chamadaAtual) return;
                clearTimeout(conectarTimeout);
                limparFalha(ch.id);
                salvarLinkFuncional(ch.id, url);
                if (itemEl) { itemEl.classList.remove('tv-tile-off'); itemEl.querySelector('.tv-tile-badge')?.remove(); }
            }
            function tudoFalhou() {
                if (minhaChamada !== chamadaAtual) return;
                marcarFalha(ch.id, 'todas-fontes');
                if (itemEl) {
                    itemEl.classList.add('tv-tile-off');
                    if (!itemEl.querySelector('.tv-tile-badge')) itemEl.insertAdjacentHTML('beforeend', badgeFalhaHtml(ch.id));
                }
                videoWrapEl.innerHTML = '<div class="tv-placeholder">⚠ Nenhuma fonte funcionou pra esse canal.<br>Volte e tente outro.</div>';
            }
            function proximaFonte() {
                if (minhaChamada !== chamadaAtual) return;
                clearTimeout(conectarTimeout);
                if (hls) { hls.destroy(); hls = null; }
                indice++;
                tentar();
            }
            async function tentar() {
                if (minhaChamada !== chamadaAtual) return;
                if (indice >= candidatos.length) { tudoFalhou(); return; }
                const url = candidatos[indice];
                let tentativasRecuperacao = 0;
                const rotulo = candidatos.length > 1 ? ` (${indice + 1}/${candidatos.length})` : '';
                videoWrapEl.innerHTML = '<div class="tv-placeholder"><div class="tv-spin"></div>Conectando' + rotulo + '…</div>';
                conectarTimeout = setTimeout(proximaFonte, CONECTAR_TIMEOUT_MS);
                try {
                    const Hls = await loadHlsJs();
                    if (minhaChamada !== chamadaAtual) return;
                    videoWrapEl.innerHTML = '<video id="' + UID + 'video" controls autoplay></video>';
                    const video = document.getElementById(UID + 'video');
                    video.addEventListener('playing', () => sucesso(url), { once: true });
                    if (hls) { hls.destroy(); hls = null; }
                    if (Hls.isSupported()) {
                        const instancia = new Hls();
                        hls = instancia;
                        instancia.loadSource(url);
                        instancia.attachMedia(video);
                        instancia.on(Hls.Events.ERROR, (event, data) => {
                            if (minhaChamada !== chamadaAtual || hls !== instancia) return;
                            if (!data.fatal) return;
                            if (tentativasRecuperacao < MAX_TENTATIVAS_RECUPERACAO) {
                                tentativasRecuperacao++;
                                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { instancia.startLoad(); return; }
                                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { instancia.recoverMediaError(); return; }
                            }
                            proximaFonte();
                        });
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.addEventListener('error', proximaFonte, { once: true });
                        video.src = url;
                    } else {
                        clearTimeout(conectarTimeout);
                        videoWrapEl.innerHTML = '<div class="tv-placeholder">Seu navegador não suporta streams HLS.</div>';
                    }
                } catch (e) { proximaFonte(); }
            }
            tentar();
        }

        let buscaDebounce = null;
        searchEl.addEventListener('input', () => {
            clearTimeout(buscaDebounce);
            buscaDebounce = setTimeout(() => { termoBusca = searchEl.value; renderChannels(); }, 180);
        });

        function toggleHeader() {
            win.classList.toggle('hdr-hidden');
            aplicarLayout(true);
        }
        win.querySelector('#' + UID + 'actHdr').addEventListener('click', toggleHeader);
        win.querySelector('#' + UID + 'unhide').addEventListener('click', toggleHeader);

        win.querySelector('#' + UID + 'actHome').addEventListener('click', irParaSmart);
        win.querySelector('#' + UID + 'actSearch').addEventListener('click', () => {
            irParaSmart();
            setTimeout(() => searchEl?.focus?.(), 120);
        });
        win.querySelector('#' + UID + 'actBell').addEventListener('click', () => {});
        win.querySelector('#' + UID + 'actUser').addEventListener('click', () => {});
        win.querySelector('#' + UID + 'actExternal').addEventListener('click', () => {
            if (appUrlAtual) window.open(appUrlAtual, '_blank', 'noopener');
        });

        aplicarLayout(false);
        irParaSmart();

        carregarDados()
            .then(({ canais, categorias }) => {
                if (abortController && abortController.signal.aborted) return;
                allChannels = canais; allCategories = categorias;
                renderFiltros(); renderChannels();
                if (!canais.length) gridEl.innerHTML = '<div class="tv-empty">Nenhum canal BR disponível.</div>';
            })
            .catch(e => {
                if (e && e.name === 'AbortError') return;
                gridEl.innerHTML = '<div class="tv-empty">⚠ Falha ao carregar canais.<br>' + escapeHtml(e.message) + '</div>';
            });

        function minimize() { win.style.display = 'none'; }
        function kill() {
            clearTimeout(conectarTimeout); clearTimeout(buscaDebounce); clearTimeout(layoutTimeout);
            if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
            chamadaAtual++;
            fecharAppAtual();
            if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
            if (abortController) { try { abortController.abort(); } catch (e) {} abortController = null; }
            persistirAgora();
            window.removeEventListener('beforeunload', aoDescarregar);
            window.removeEventListener('pagehide', aoDescarregar);
            document.removeEventListener('mousemove', aoMoverJanela);
            document.removeEventListener('mouseup', aoSoltarJanela);
            document.removeEventListener('mousemove', aoMoverResize);
            document.removeEventListener('mouseup', aoSoltarResize);
            document.removeEventListener('keydown', aoTeclado);
            win.remove();
            style.remove();
            delete window._iptv;
        }
        win.querySelector('#' + UID + 'actMin').addEventListener('click', minimize);
        win.querySelector('#' + UID + 'actClose').addEventListener('click', kill);

        window._iptv = {
            kill,
            show: () => { win.style.display = 'flex'; aplicarLayout(false); },
            hide: () => { win.style.display = 'none'; },
            registrarApp: (cfg) => {
                if (!cfg || !cfg.id || apps.has(cfg.id)) return false;
                apps.set(cfg.id, cfg);
                if (vista === 'smart') renderApps();
                return true;
            },
            abrirApp,
            irParaSmart,
        };
    }

    if (document.body) init();
    else {
        const iv = setInterval(() => { if (document.body) { clearInterval(iv); init(); } }, 80);
    }
})();
