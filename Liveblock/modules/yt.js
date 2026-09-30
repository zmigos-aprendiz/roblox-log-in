// modules/yt.js — YouTube embed
(function () {
    'use strict';
    const UID = '_yt';
    if (window[UID]) return;

    // CONFIG
    const GEOM_KEY = 'sang_panel_yt_state';
    const APIKEY_KEY = 'sang_yt_api_key';
    const SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
    const MIN_W = 460, MIN_H = 280;
    const MAX_W = 2400;
    const RESULTS_W = 260;

    // IA
    const IA_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
    const IA_MODEL = 'openai/gpt-oss-20b';
    const IA_TIMEOUT_MS = 5000;
    const IA_SYSTEM = `Você é um normalizador de comandos de voz para o YouTube. Sua ÚNICA função é transformar pedidos em linguagem natural numa query curta de busca no YouTube.

## Regras de saída (obrigatórias)
1. Responda com UMA linha só, sem quebras.
2. Sem aspas, crases, markdown ou prefixo ("Query:", "Busca:", "→").
3. Sem pontuação final.
4. Entre 2 e 6 palavras-chave essenciais.
5. Preserve o idioma da fala original — não traduza.
6. Preserve nomes próprios, marcas, artistas e títulos exatos.
7. Se a fala NÃO for sobre buscar, tocar ou assistir um vídeo/música, responda EXATAMENTE: NULL
8. Se for ambíguo, responda NULL.

## Quando responder NULL
- Perguntas gerais, comandos do Hub, conversa, controle de voz, qualquer coisa que não seja pedido de vídeo ou música.

## Exemplos
"coloca o vídeo do leo stronda com o cariani" → leo stronda cariani
"quero ouvir metallica" → metallica
"aquele vídeo do cara caindo de skate" → queda skate compilado
"me mostra o trailer do gta 6" → gta 6 trailer
"toca aquela música do linkin park que fala de dor" → linkin park numb
"coloca o clipe da taylor swift" → taylor swift clipe
"bota um funk pra tocar" → funk 2024
"youtube the weeknd blinding lights" → the weeknd blinding lights
"abre o iptv" → NULL
"qual a capital da frança" → NULL
"oi tudo bem" → NULL
"fecha o menu" → NULL
"cancela isso" → NULL

Responda APENAS a saída. Nada mais antes ou depois.`;

    // VOZ
    const YT_WAKE = ['youtube', 'yt'];
    const YT_VERBOS = /\b(coloca|colocar|toca|tocar|p[oõ]e|bota|abre|abrir|busca|buscar|pesquisa|pesquisar|procura|procurar|mostra|mostrar|quero\s+ver|quero\s+ouvir)\b/i;
    const YT_MIDIA  = /\b(v[ií]deo|v[ií]deozinho|clipe|m[uú]sica)\b/i;

    // HELPERS
    function loadGeom() {
        try {
            const s = JSON.parse(localStorage.getItem(GEOM_KEY) || 'null');
            if (s && typeof s.left === 'number' && typeof s.top === 'number' &&
                typeof s.width === 'number' && typeof s.height === 'number') return s;
        } catch (_) {}
        return null;
    }

    function extractVideoId(raw) {
        const v = String(raw || '').trim();
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
            /^([a-zA-Z0-9_-]{11})$/
        ];
        for (const re of patterns) { const m = v.match(re); if (m) return m[1]; }
        return null;
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    // Normalização pra parsing de comandos: minúsculas, sem acento, sem pontuação.
    // É isso que resolve "youtube, metallica" virar "youtube metallica".
    function limparComando(s) {
        return String(s || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[,;.!?]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Pega a chave do Groq de `sang_api_keys`.
    function getGroqKey() {
        try {
            const viaApis = window._apis?.getKey?.('groq');
            if (viaApis) return viaApis;
        } catch (_) {}
        try {
            const raw = localStorage.getItem('sang_api_keys');
            if (!raw) return '';
            const obj = JSON.parse(raw);
            const v = obj?.groq;
            if (typeof v === 'string') return v;
            if (v && typeof v === 'object' && typeof v.key === 'string') return v.key;
        } catch (_) {}
        return '';
    }

    // ─── Classificação de comandos de controle ───
    const ORDINAIS = {
        'primeiro': 1, 'primeira': 1, 'um': 1, 'uma': 1, '1': 1,
        'segundo': 2, 'segunda': 2, 'dois': 2, 'duas': 2, '2': 2,
        'terceiro': 3, 'terceira': 3, 'tres': 3, '3': 3,
        'quarto': 4, 'quarta': 4, 'quatro': 4, '4': 4,
        'quinto': 5, 'quinta': 5, 'cinco': 5, '5': 5,
        'sexto': 6, 'sexta': 6, 'seis': 6, '6': 6,
        'setimo': 7, 'setima': 7, 'sete': 7, '7': 7,
        'oitavo': 8, 'oitava': 8, 'oito': 8, '8': 8,
        'nono': 9, 'nona': 9, 'nove': 9, '9': 9,
        'decimo': 10, 'decima': 10, 'dez': 10, '10': 10
    };
    const ORDINAL_WORDS = 'primeiro|primeira|segundo|segunda|terceiro|terceira|quarto|quarta|quinto|quinta|sexto|sexta|setimo|setima|oitavo|oitava|nono|nona|decimo|decima|1|2|3|4|5|6|7|8|9|10';

    const POS_VERB_PREFIX_RE = new RegExp(
        '^(?:coloca|colocar|toca|tocar|abre|abrir|bota|poe|p[oõ]e|escolhe|escolher|seleciona|selecionar|vai|ir|play|quero(?:\\s+ver|\\s+ouvir)?|mostra|mostrar)\\s+(?:(?:o|a|os|as)\\s+)?',
        'i'
    );
    const POS_TAIL_RE = new RegExp(
        '^(' + ORDINAL_WORDS + ')\\s*(?:video|clipe|item|resultado|linha|opcao|da\\s+lista|na\\s+lista)?$',
        'i'
    );
    const MEDIA_CTX_RE = /\b(?:video|clipe|item|resultado|linha|opcao|lista)\b/;

    const CMD_LITE_RE = /^(?:modo\s+)?(?:lite|limpo|cinema|imersivo|tela\s+limpa)$|^(?:so|apenas)\s+o\s+video$/;
    const CMD_UNLITE_RE = /^(?:sai|sair|desativa|desativar|desliga|desligar|encerra|encerrar|fecha|fechar)\s+(?:(?:do|de|o|a)\s+)?(?:modo\s+)?(?:lite|limpo|cinema|imersivo|tela\s+limpa)$|^(?:modo\s+)?(?:normal|padrao|completo|cheio)$/;
    const CMD_HIDE_LIST_RE = /^(?:oculta|ocultar|esconde|esconder|tira|tirar|fecha|fechar)\s+(?:(?:a|o|as|os)\s+)?(?:lista|resultados|painel|barra|lateral|sidebar)$/;
    const CMD_SHOW_LIST_RE = /^(?:mostra|mostrar|abre|abrir|exibe|exibir|volta|voltar)\s+(?:(?:a|o|as|os)\s+)?(?:lista|resultados|painel|barra|lateral|sidebar)$/;
    const CMD_PAUSE_RE = /^(?:pausa|pausar|pause)\s*(?:(?:o|a)\s+)?(?:video|musica|clipe)?$|^(?:para|parar)\s+(?:(?:o|a)\s+)?(?:video|musica|clipe)$/;
    const CMD_PLAY_RE = /^(?:play|resume)\s*(?:(?:o|a)\s+)?(?:video|musica|clipe)?$|^(?:continua|continuar|continue|retoma|retomar)\s*(?:(?:o|a)\s+)?(?:video|musica|clipe)?$|^(?:da|dar)\s+play$/;

    // Retorna { tipo, valor } ou null.
    function classificarComando(n) {
        // Modo lite — entrada
        if (CMD_LITE_RE.test(n)) return { tipo: 'lite' };

        // Modo lite — saída
        if (CMD_UNLITE_RE.test(n)) return { tipo: 'unlite' };

        // Ocultar/mostrar lista
        if (CMD_HIDE_LIST_RE.test(n)) return { tipo: 'hide_list' };
        if (CMD_SHOW_LIST_RE.test(n)) return { tipo: 'show_list' };

        // Posição na lista
        let posText = n;
        const verbM = n.match(POS_VERB_PREFIX_RE);
        if (verbM) {
            posText = n.slice(verbM[0].length);
        } else {
            posText = posText.replace(/^(?:o|a|os|as)\s+/, '');
        }
        const posM = posText.match(POS_TAIL_RE);
        if (posM) {
            const hadVerb = !!verbM;
            const hadMedia = MEDIA_CTX_RE.test(n);
            if (hadVerb || hadMedia) {
                const num = ORDINAIS[posM[1]];
                if (num) return { tipo: 'position', valor: num };
            }
        }

        // Pause / Play
        if (CMD_PAUSE_RE.test(n)) return { tipo: 'pause' };
        if (CMD_PLAY_RE.test(n)) return { tipo: 'play' };

        return null;
    }

    // ─── Parser de linguagem natural ───
    // Retorna { tipo, valor }.
    function interpretar(fala) {
        const raw = String(fala || '');

        // 1) Link/ID direto — antes de limpar (limparComando destrói pontos de URL)
        const vid = extractVideoId(raw);
        if (vid) return { tipo: 'video', valor: vid };

        const t = limparComando(raw);
        if (!t) return { tipo: null, valor: '' };

        // 2) Comandos de controle
        const cmd = classificarComando(t);
        if (cmd) return cmd;

        // 3) Wake word no começo ("youtube X", "yt X")
        const wakeRe = new RegExp('^(?:' + YT_WAKE.join('|') + ')\\s+(.+)$', 'i');
        const wake = t.match(wakeRe);
        if (wake) return { tipo: 'query', valor: wake[1].trim() };

        // 4) Verbo + mídia
        if (YT_VERBOS.test(t) && YT_MIDIA.test(t)) {
            const limpo = t
                .replace(/^(?:coloca|colocar|toca|tocar|p[oõ]e|bota|abre|abrir|busca|buscar|pesquisa|pesquisar|procura|procurar|mostra|mostrar)\b\s*/i, '')
                .replace(/\b(?:pra|para)\s+(?:mim|mim\s+ver)\b\s*/i, '')
                .replace(/^o\s+/i, '')
                .replace(/^(?:video|clipe|musica)\s+(?:do|da|de|com)\s+/i, '')
                .trim();
            return { tipo: 'query', valor: limpo || t };
        }

        return { tipo: null, valor: t };
    }

    // ─── IA: fala livre → query ───
    async function normalizarComIA(fala) {
        const key = getGroqKey();
        if (!key) return null;

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), IA_TIMEOUT_MS);
        try {
            const res = await fetch(IA_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: IA_MODEL,
                    messages: [
                        { role: 'system', content: IA_SYSTEM },
                        { role: 'user', content: String(fala || '') }
                    ],
                    max_tokens: 60,
                    temperature: 0.1,
                    top_p: 0.9,
                    reasoning_effort: 'low'
                }),
                signal: ctrl.signal
            });

            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const bruto = data?.choices?.[0]?.message?.content || '';

            const linhas = String(bruto).split('\n').map(l => l.trim()).filter(Boolean);
            if (!linhas.length) return null;

            const limpo = linhas[0]
                .replace(/^["'`]+|["'`]+$/g, '')
                .replace(/^(?:query|busca|saida|resposta|output|→)\s*[:\-]?\s*/i, '')
                .replace(/^[-–—]\s*/, '')
                .trim();

            if (!limpo) return null;

            const canonico = limpo.replace(/[.,;:!?]+$/, '').trim();
            if (/^(null|none|nada|nenhum[a]?|n\/a|na)$/i.test(canonico)) return null;

            if (canonico.split(/\s+/).length > 8) {
                console.warn('[YouTube] IA devolveu query longa, usando mesmo assim:', canonico);
            }

            return canonico;
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.warn('[YouTube] Normalização IA falhou:', e);
            }
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    function ensureFont() {
        if (document.querySelector('link[data-sang-font]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap';
        link.setAttribute('data-sang-font', '');
        document.head.appendChild(link);
    }

    function init() {
        if (window[UID]) return;

        ensureFont();

        const host = document.createElement('div');
        host.id = UID + '_host';
        host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483000;';
        document.body.appendChild(host);
        window._hubUI?.markProtected?.(host);
        const root = host.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = `
        :host {
            all: initial;
            --hub-cyan: #22d3ee;
            --hub-violet: #a78bfa;
            --hub-grad: linear-gradient(120deg, var(--hub-cyan), var(--hub-violet));
            --hub-ok: #34d399;
            --hub-err: #fb7185;
            --hub-muted: #8b8fa3;
        }
        * { box-sizing: border-box; }
        .panel {
            position: fixed; display: flex; flex-direction: column;
            font-family: 'Geist', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(175deg, rgba(20,20,28,.92) 0%, rgba(9,9,14,.97) 100%);
            backdrop-filter: blur(18px) saturate(140%);
            border: 1px solid rgba(255,255,255,.08);
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 20px 50px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06);
            contain: layout style paint;
        }
        .hdr {
            height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
            padding: 0 12px; cursor: grab; user-select: none; touch-action: none;
            border-bottom: 1px solid rgba(255,255,255,.06); background: rgba(255,255,255,.02);
        }
        .hdr.dragging { cursor: grabbing; }
        .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .logo { width: 20px; height: 14px; border-radius: 4px; background: #ff0000; position: relative; flex-shrink: 0; }
        .logo::after { content: ''; position: absolute; left: 7px; top: 3px; border: 4px solid transparent; border-left-color: #fff; }
        .title {
            font-weight: 600; font-size: 13px; letter-spacing: .2px; white-space: nowrap;
            background: var(--hub-grad); -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .actions { display: flex; gap: 4px; flex-shrink: 0; }
        .btn {
            width: 28px; height: 28px; border-radius: 50%; background: transparent; border: none;
            color: var(--hub-muted); display: flex; align-items: center; justify-content: center;
            cursor: pointer; font-size: 13px; transition: background .15s ease, color .15s ease;
        }
        .btn:hover { background: rgba(255,255,255,.08); color: #f4f5f8; }
        .btn:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(34,211,238,.5); }
        .btn.active { background: rgba(34,211,238,.16); color: var(--hub-cyan); }
        .searchbar { display: flex; gap: 8px; padding: 10px 12px; flex-shrink: 0; }
        .searchbar input {
            flex: 1; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); border-radius: 12px;
            padding: 8px 14px; color: #f1f2f5; font-size: 13px; outline: none;
            transition: border-color .15s ease, box-shadow .15s ease;
        }
        .searchbar input:focus { border-color: var(--hub-cyan); box-shadow: 0 0 0 3px rgba(34,211,238,.15); }
        .searchbar input::placeholder { color: var(--hub-muted); }
        .searchbar button {
            background: var(--hub-grad); border: none; border-radius: 12px;
            padding: 0 18px; color: #06080d; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap;
            transition: filter .15s ease, transform .1s ease;
        }
        .searchbar button:hover { filter: brightness(1.08); }
        .searchbar button:active { transform: scale(.97); }
        .searchbar button:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(34,211,238,.5); }
        .body { flex: 1; min-height: 0; display: flex; background: #000; }
        .player { flex: 1; min-width: 0; position: relative; background: #000; }
        .player iframe { width: 100%; height: 100%; border: 0; }
        .results {
            width: ${RESULTS_W}px; flex-shrink: 0; overflow-y: auto; background: rgba(255,255,255,.015);
            border-left: 1px solid rgba(255,255,255,.06);
        }
        .results.hidden { display: none; }
        .results::-webkit-scrollbar { width: 4px; }
        .results::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 2px; }
        .item { display: flex; gap: 8px; padding: 8px; cursor: pointer; transition: background .12s ease; }
        .item:hover { background: rgba(255,255,255,.05); }
        .item.active { background: rgba(34,211,238,.10); box-shadow: inset 3px 0 0 var(--hub-cyan); }
        .item img { width: 88px; height: 50px; object-fit: cover; border-radius: 8px; flex-shrink: 0; background: rgba(255,255,255,.05); }
        .item-info { flex: 1; min-width: 0; }
        .item-title { font-size: 12px; color: #eef0f5; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .item-channel { font-size: 10.5px; color: var(--hub-muted); margin-top: 3px; }
        .empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: var(--hub-muted); font-size: 12px; text-align: center; padding: 20px; }
        .empty.flow { position: static; height: 100%; }
        .spin { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,.15); border-top-color: var(--hub-cyan); border-radius: 50%; animation: spin .7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .resize-handle {
            position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; touch-action: none;
            background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,.18) 50%);
        }
        /* Modo lite: só o vídeo. Cabeçalho, barra, lista e handle escondidos. */
        .panel.lite .hdr,
        .panel.lite .searchbar,
        .panel.lite .results,
        .panel.lite .resize-handle { display: none !important; }
        .panel.lite { border-radius: 0; border-color: transparent; box-shadow: 0 12px 40px rgba(0,0,0,.7); }
        `;
        root.appendChild(style);

        // STATE
        const geom = loadGeom() || { left: 70, top: 70, width: 820, height: 540 };
        const state = {
            searchController: null,
            results: [],
            resultsVisible: true,
            hasVideo: false,
            liteMode: false,
            currentVideoId: null
        };
        let minimized = false;

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.dataset.hub = '1';
        panel.setAttribute('data-sang-ui', '');
        panel.innerHTML = `
            <div class="hdr" id="hdr">
                <div class="brand"><div class="logo"></div><span class="title">YouTube</span></div>
                <div class="actions">
                    <button class="btn" id="btnToggle" title="Mostrar/ocultar lista de resultados" aria-label="Alternar painel de resultados">▤</button>
                    <button class="btn" id="btnKey" title="Configurar API key" aria-label="Configurar API key">⚙</button>
                    <button class="btn" id="btnMin" title="Minimizar" aria-label="Minimizar">−</button>
                    <button class="btn" id="btnCls" title="Fechar" aria-label="Fechar">✕</button>
                </div>
            </div>
            <div class="searchbar">
                <input type="text" id="input" placeholder="Pesquisar ou colar um link do YouTube" aria-label="Buscar no YouTube" />
                <button id="btnGo">Buscar</button>
            </div>
            <div class="body" id="body">
                <div class="player" id="playerWrap">
                    <div class="empty">Pesquise um vídeo ou cole um link do YouTube acima</div>
                </div>
                <div class="results" id="results"></div>
            </div>
            <div class="resize-handle" id="resizeHandle" aria-hidden="true"></div>
        `;
        root.appendChild(panel);

        const hdr = panel.querySelector('#hdr');
        const btnToggle = panel.querySelector('#btnToggle');
        const btnKey = panel.querySelector('#btnKey');
        const btnMin = panel.querySelector('#btnMin');
        const btnCls = panel.querySelector('#btnCls');
        const input = panel.querySelector('#input');
        const btnGo = panel.querySelector('#btnGo');
        const playerWrap = panel.querySelector('#playerWrap');
        const resultsEl = panel.querySelector('#results');
        const resizeHandle = panel.querySelector('#resizeHandle');
        const searchbarEl = panel.querySelector('.searchbar');

        function onHostKeydown(e) {
            if (e.key === 'Escape') {
                // Em modo lite, Esc sai do lite antes de fechar o painel.
                if (state.liteMode) { sairLite(); e.stopPropagation(); return; }
                if (!minimized) { kill(); return; }
            }
            e.stopPropagation();
        }
        function stopProp(e) { e.stopPropagation(); }
        const LEAK_EVENTS = ['keydown', 'keyup', 'keypress', 'input', 'beforeinput'];
        LEAK_EVENTS.forEach(t => host.addEventListener(t, t === 'keydown' ? onHostKeydown : stopProp));

        // Geometria & 16:9
        function chromeHeight() {
            const h = hdr.getBoundingClientRect().height + searchbarEl.getBoundingClientRect().height;
            return h + 2;
        }

        function computeHeightForWidth(width) {
            const resultsW = (state.resultsVisible && !state.liteMode) ? RESULTS_W : 0;
            const playerW = width - resultsW - 2;
            if (playerW <= 0) return MIN_H;
            return Math.round(playerW * 9 / 16 + chromeHeight());
        }

        function clampGeom(s) {
            s.width = Math.max(MIN_W, Math.min(MAX_W, s.width));
            s.height = Math.max(MIN_H, s.height);
            s.left = Math.min(Math.max(0, s.left), Math.max(0, window.innerWidth - s.width));
            s.top = Math.min(Math.max(0, s.top), Math.max(0, window.innerHeight - s.height));
        }

        function applySize(width, applyPos) {
            geom.width = Math.max(MIN_W, Math.min(MAX_W, width));
            geom.height = computeHeightForWidth(geom.width);
            clampGeom(geom);
            panel.style.width = geom.width + 'px';
            panel.style.height = geom.height + 'px';
            if (applyPos) {
                panel.style.left = geom.left + 'px';
                panel.style.top = geom.top + 'px';
            }
        }

        applySize(geom.width, true);

        // STORAGE
        let saveTimer = null;
        function scheduleSaveGeom() {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                try { localStorage.setItem(GEOM_KEY, JSON.stringify(geom)); } catch (_) {}
            }, 300);
        }

        function getYtApiKey() {
            try { return localStorage.getItem(APIKEY_KEY) || ''; } catch (_) { return ''; }
        }

        function garantirVisivel() {
            if (minimized) {
                minimized = false;
                panel.style.display = 'flex';
            }
        }

        // PLAYER — enablejsapi=1 permite pausar/retomar via postMessage.
        function loadVideo(videoId) {
            const origin = encodeURIComponent(location.origin);
            const params = `autoplay=1&rel=0&iv_load_policy=3&playsinline=1&modestbranding=1&enablejsapi=1&origin=${origin}`;
            playerWrap.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?${params}"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
            state.hasVideo = true;
            state.currentVideoId = videoId;
        }

        // Envia comando pro iframe do YouTube.
        function postYT(func) {
            const ifr = playerWrap.querySelector('iframe');
            if (!ifr || !ifr.contentWindow) return false;
            try {
                ifr.contentWindow.postMessage(JSON.stringify({
                    event: 'command',
                    func,
                    args: []
                }), '*');
                return true;
            } catch (e) {
                console.warn('[YouTube] postMessage falhou:', e);
                return false;
            }
        }

        // SEARCH
        async function runSearch(query) {
            const key = getYtApiKey();
            if (!key) {
                resultsEl.innerHTML = `<div class="empty flow">Configure sua API key do YouTube (⚙) para buscar.<br>Ou cole um link direto do vídeo.</div>`;
                return;
            }

            if (state.searchController) state.searchController.abort();
            const controller = new AbortController();
            state.searchController = controller;

            resultsEl.innerHTML = `<div class="empty flow"><div class="spin"></div></div>`;

            const url = `${SEARCH_ENDPOINT}?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
            try {
                const res = await fetch(url, { signal: controller.signal });
                const data = await res.json();
                if (!res.ok) {
                    const msg = data?.error?.message || 'Erro na busca';
                    resultsEl.innerHTML = `<div class="empty flow">${escapeHtml(msg)}</div>`;
                    return;
                }

                const items = data.items || [];
                state.results = items.map(it => ({
                    id: it.id.videoId,
                    title: it.snippet.title,
                    channel: it.snippet.channelTitle,
                    thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url
                }));

                if (!state.results.length) {
                    resultsEl.innerHTML = `<div class="empty flow">Nenhum resultado.</div>`;
                    return;
                }

                if (!state.resultsVisible && !state.liteMode) {
                    state.resultsVisible = true;
                    resultsEl.classList.remove('hidden');
                    btnToggle.classList.remove('active');
                    applySize(geom.width, false);
                    scheduleSaveGeom();
                }

                renderResults();
                tocar(state.results[0].id);
            } catch (e) {
                if (e.name === 'AbortError') return;
                resultsEl.innerHTML = `<div class="empty flow">Falha na busca.</div>`;
            }
        }

        function renderResults() {
            resultsEl.innerHTML = state.results.map((v, i) => `
                <div class="item" data-index="${i}">
                    <img src="${v.thumb}" alt="" loading="lazy" />
                    <div class="item-info">
                        <div class="item-title">${escapeHtml(v.title)}</div>
                        <div class="item-channel">${escapeHtml(v.channel)}</div>
                    </div>
                </div>
            `).join('');

            resultsEl.querySelectorAll('.item').forEach(el => {
                el.addEventListener('click', () => {
                    const v = state.results[parseInt(el.dataset.index, 10)];
                    if (v) {
                        tocar(v.id);
                        marcarAtivo(parseInt(el.dataset.index, 10));
                    }
                });
            });
        }

        function marcarAtivo(idx) {
            const items = resultsEl.querySelectorAll('.item');
            items.forEach((el, i) => el.classList.toggle('active', i === idx));
        }

        function runAction() {
            const value = input.value.trim();
            if (!value) return;
            const videoId = extractVideoId(value);
            if (videoId) {
                tocar(videoId);
                resultsEl.innerHTML = '';
                if (state.resultsVisible && !state.liteMode) {
                    state.resultsVisible = false;
                    resultsEl.classList.add('hidden');
                    btnToggle.classList.add('active');
                    applySize(geom.width, false);
                    scheduleSaveGeom();
                }
                return;
            }
            runSearch(value);
        }

        // EVENTS
        btnGo.addEventListener('click', runAction);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') runAction(); });

        btnKey.addEventListener('click', () => {
            const current = getYtApiKey();
            const next = window.prompt('Cole sua API key do YouTube Data API v3 (Google Cloud Console):', current);
            if (next === null) return;
            try { localStorage.setItem(APIKEY_KEY, next.trim()); } catch (_) {}
        });

        function toggleResults() {
            state.resultsVisible = !state.resultsVisible;
            resultsEl.classList.toggle('hidden', !state.resultsVisible);
            btnToggle.classList.toggle('active', !state.resultsVisible);
            applySize(geom.width, false);
            scheduleSaveGeom();
        }
        btnToggle.addEventListener('click', toggleResults);

        // Drag
        let dragPointerId = null, dragStart = null, dragMoved = false;
        const DRAG_THRESHOLD = 3;

        function onPointerDown(e) {
            if (e.target.closest('.btn')) return;
            dragPointerId = e.pointerId;
            dragMoved = false;
            dragStart = { mouseX: e.clientX, mouseY: e.clientY, left: geom.left, top: geom.top };
            hdr.setPointerCapture(dragPointerId);
            hdr.classList.add('dragging');
        }
        function onPointerMove(e) {
            if (dragPointerId === null || e.pointerId !== dragPointerId) return;
            const dx = e.clientX - dragStart.mouseX, dy = e.clientY - dragStart.mouseY;
            if (!dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            dragMoved = true;
            geom.left = dragStart.left + dx; geom.top = dragStart.top + dy;
            clampGeom(geom);
            panel.style.left = geom.left + 'px'; panel.style.top = geom.top + 'px';
        }
        function endDrag(e) {
            if (dragPointerId === null || (e && e.pointerId !== dragPointerId)) return;
            try { hdr.releasePointerCapture(dragPointerId); } catch (_) {}
            hdr.classList.remove('dragging');
            dragPointerId = null;
            if (dragMoved) scheduleSaveGeom();
        }
        hdr.addEventListener('pointerdown', onPointerDown);
        hdr.addEventListener('pointermove', onPointerMove);
        hdr.addEventListener('pointerup', endDrag);
        hdr.addEventListener('pointercancel', endDrag);

        // Resize 16:9
        let resizePointerId = null, resizeStart = null;
        function onResizeDown(e) {
            e.stopPropagation();
            resizePointerId = e.pointerId;
            resizeStart = { mouseX: e.clientX, mouseY: e.clientY, width: geom.width };
            resizeHandle.setPointerCapture(resizePointerId);
        }
        function onResizeMove(e) {
            if (resizePointerId === null || e.pointerId !== resizePointerId) return;
            const dx = e.clientX - resizeStart.mouseX;
            const dy = e.clientY - resizeStart.mouseY;
            const dyAsDx = dy * 16 / 9;
            const delta = Math.abs(dx) > Math.abs(dyAsDx) ? dx : dyAsDx;
            applySize(resizeStart.width + delta, false);
        }
        function endResize(e) {
            if (resizePointerId === null || (e && e.pointerId !== resizePointerId)) return;
            try { resizeHandle.releasePointerCapture(resizePointerId); } catch (_) {}
            resizePointerId = null;
            scheduleSaveGeom();
        }
        resizeHandle.addEventListener('pointerdown', onResizeDown);
        resizeHandle.addEventListener('pointermove', onResizeMove);
        resizeHandle.addEventListener('pointerup', endResize);
        resizeHandle.addEventListener('pointercancel', endResize);

        function onWindowResize() {
            clampGeom(geom);
            panel.style.left = geom.left + 'px'; panel.style.top = geom.top + 'px';
            panel.style.width = geom.width + 'px'; panel.style.height = geom.height + 'px';
        }
        window.addEventListener('resize', onWindowResize);

        // Minimizar / fechar
        function toggleMinimize() { minimized = !minimized; panel.style.display = minimized ? 'none' : 'flex'; }
        btnMin.addEventListener('click', toggleMinimize);
        btnCls.addEventListener('click', kill);

        // ─── Ações internas ───
        function tocar(videoId) {
            if (!videoId) return false;
            garantirVisivel();
            loadVideo(videoId);
            input.value = `https://youtu.be/${videoId}`;
            return true;
        }

        function pesquisar(query) {
            const q = String(query || '').trim();
            if (!q) return false;
            garantirVisivel();
            input.value = q;
            runSearch(q);
            return true;
        }

        function pausar() {
            if (!state.hasVideo) return false;
            postYT('pauseVideo');
            return true;
        }

        function continuar() {
            if (!state.hasVideo) return false;
            postYT('playVideo');
            return true;
        }

        function escolherPorPosicao(n) {
            if (!state.results.length) return false;
            const idx = Math.max(0, Math.min(state.results.length - 1, n - 1));
            const v = state.results[idx];
            if (!v) return false;
            tocar(v.id);
            marcarAtivo(idx);
            // Rolagem suave até o item ativo
            const item = resultsEl.querySelectorAll('.item')[idx];
            if (item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return true;
        }

        function esconderLista() {
            if (!state.resultsVisible) return true;
            state.resultsVisible = false;
            resultsEl.classList.add('hidden');
            btnToggle.classList.add('active');
            applySize(geom.width, false);
            scheduleSaveGeom();
            return true;
        }

        function mostrarLista() {
            if (state.resultsVisible) return true;
            state.resultsVisible = true;
            resultsEl.classList.remove('hidden');
            btnToggle.classList.remove('active');
            applySize(geom.width, false);
            scheduleSaveGeom();
            return true;
        }

        function entrarLite() {
            if (state.liteMode) return true;
            state.liteMode = true;
            panel.classList.add('lite');
            applySize(geom.width, true);
            return true;
        }

        function sairLite() {
            if (!state.liteMode) return true;
            state.liteMode = false;
            panel.classList.remove('lite');
            applySize(geom.width, true);
            return true;
        }

        function executarComando(cmd) {
            if (!cmd) return false;
            switch (cmd.tipo) {
                case 'pause':     return pausar();
                case 'play':      return continuar();
                case 'position':  return escolherPorPosicao(cmd.valor);
                case 'hide_list': return esconderLista();
                case 'show_list': return mostrarLista();
                case 'lite':      return entrarLite();
                case 'unlite':    return sairLite();
            }
            return false;
        }

        // Fala → ação. Comandos têm prioridade; fallback IA só se não casar nada.
        async function tocarPorFala(fala) {
            const p = interpretar(fala);
            if (p.tipo === 'video') return tocar(p.valor);
            if (p.tipo === 'query') return pesquisar(p.valor);
            if (p.tipo) return executarComando(p);

            const viaIA = await normalizarComIA(fala);
            if (viaIA) return pesquisar(viaIA);
            return false;
        }

        // ─── Integração voz.js ───
        let vozHandler = null;

        function deveInterceptar(texto, meta) {
            const wake = meta?.wake?.toLowerCase();
            if (wake === 'youtube' || wake === 'yt') return true;

            if (extractVideoId(texto)) return true;

            const t = limparComando(texto);
            if (!t) return false;

            if (/^(?:youtube|yt)\s+/.test(t)) return true;

            if (YT_VERBOS.test(t) && YT_MIDIA.test(t)) return true;

            const cmd = classificarComando(t);
            if (cmd) {
                switch (cmd.tipo) {
                    case 'pause':
                    case 'play':
                        return state.hasVideo;
                    case 'position':
                        return state.results.length > 0;
                    case 'hide_list':
                        return state.resultsVisible && !state.liteMode;
                    case 'show_list':
                        return !state.resultsVisible && !state.liteMode;
                    case 'lite':
                        return !state.liteMode;
                    case 'unlite':
                        return state.liteMode;
                }
            }

            return false;
        }

        function registrarHandlerVoz() {
            if (!window._voiceCommands?.registrar) return false;
            if (vozHandler) return true;
            vozHandler = (texto, n, meta) => {
                const wake = meta?.wake?.toLowerCase();
                // Wake word explícita: o texto depois dela pode ser comando OU query.
                if (wake === 'youtube' || wake === 'yt') {
                    const cmd = classificarComando(limparComando(texto));
                    if (cmd) { executarComando(cmd); return true; }
                    pesquisar(texto);
                    return true;
                }
                if (!deveInterceptar(texto, meta)) return false;
                tocarPorFala(texto);
                return true;
            };
            window._voiceCommands.registrar(/.*/, vozHandler, 0);
            return true;
        }

        function limparHandlerVoz() {
            if (vozHandler && window._voiceCommands?.remover) {
                window._voiceCommands.remover(vozHandler);
            }
            vozHandler = null;
        }

        // Registro idempotente — cobre caso de yt.js carregado antes de voz.js.
        function forcarRegistroVoz() {
            if (!window._voiceCommands?.registrar) return false;
            if (vozHandler) limparHandlerVoz();
            return registrarHandlerVoz();
        }

        forcarRegistroVoz();
        window.addEventListener('sang:voz-ready', forcarRegistroVoz);
        window.addEventListener('sang:voz-state', forcarRegistroVoz);

        function kill() {
            limparHandlerVoz();
            window.removeEventListener('sang:voz-ready', forcarRegistroVoz);
            window.removeEventListener('sang:voz-state', forcarRegistroVoz);

            if (saveTimer) clearTimeout(saveTimer);
            if (state.searchController) state.searchController.abort();
            window.removeEventListener('resize', onWindowResize);

            hdr.removeEventListener('pointerdown', onPointerDown);
            hdr.removeEventListener('pointermove', onPointerMove);
            hdr.removeEventListener('pointerup', endDrag);
            hdr.removeEventListener('pointercancel', endDrag);

            resizeHandle.removeEventListener('pointerdown', onResizeDown);
            resizeHandle.removeEventListener('pointermove', onResizeMove);
            resizeHandle.removeEventListener('pointerup', endResize);
            resizeHandle.removeEventListener('pointercancel', endResize);

            playerWrap.innerHTML = '';
            host.remove();
            delete window[UID];
        }

        window[UID] = {
            kill,
            show: garantirVisivel,
            hide: () => { minimized = true; panel.style.display = 'none'; },
            tocar,
            pesquisar,
            tocarPorFala,
            interpretar,
            // extras pra debug/teste manual
            pausar,
            continuar,
            escolherPorPosicao,
            entrarLite,
            sairLite
        };
    }

    // INIT
    if (document.body) {
        init();
    } else {
        new MutationObserver((_, obs) => {
            if (document.body) { obs.disconnect(); init(); }
        }).observe(document.documentElement, { childList: true });
    }
})();
