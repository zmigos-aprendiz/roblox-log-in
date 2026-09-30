// modules/voz.js
(function() {
    'use strict';
    const UID = '_voz';
    if (window[UID]) return;

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
        console.warn('[Voz] Web Speech API não suportada.');
        return;
    }

    const STATE_KEY = 'sang_voz_state';
    const DEFAULT_CONFIG = {
        modo: 'manual',
        motor: 'nativo',
        silencioMs: 2500,
        minChars: 2,
        lang: 'pt-BR',
        left: null,
        top: null,
        pontuacao: 'pausa',
        pausaVirgulaMs: 250,
        modoComando: 'prefixo',
        streaming: true,
        maxCharsFallback: 100,
        delayEntreBlocos: 320,
        bilingue: false,
        bilingueIdioma: 'en'
    };

    const MIN_INTERVALO_STREAM = 350;

    // ─── Bilingue ───
    const IDIOMAS_BILINGUE = {
        en: 'English',
        es: 'Spanish',
        fr: 'French',
        de: 'German',
        it: 'Italian',
        ja: 'Japanese',
        ko: 'Korean',
        zh: 'Chinese',
        ru: 'Russian'
    };

    // ─── Whisper (Groq) ───
    const WHISPER_MODEL = 'whisper-large-v3';
    const WHISPER_VAD_START = 0.040;
    const WHISPER_VAD_STOP  = 0.020;
    const WHISPER_SILENCIO_MS = 900;
    const WHISPER_MIN_FALA_MS = 1000;
    const WHISPER_MAX_SEGMENT_MS = 30000;
    const WHISPER_PROMPT = 'Transcrição de conversa informal em português brasileiro. Preserve nomes próprios, gírias e termos técnicos como estão.';
    const MIME_CANDIDATES = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4'
    ];

    // ─── Detecção de comando em texto ───
    const CMD_LINK_RE  = /youtube\.com|youtu\.be/i;
    const CMD_WAKE_RE  = /^(youtube|yt)\s+/i;
    const CMD_VERBO_RE = /\b(coloca|colocar|toca|tocar|p[oõ]e|bota|abre|abrir|busca|buscar|pesquisa|pesquisar|procura|procurar|mostra|mostrar)\b/i;
    const CMD_MIDIA_RE = /\b(v[ií]deo|v[ií]deozinho|clipe|m[uú]sica)\b/i;

    // ─── Persistência ───
    const loadConfig = () => {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
        } catch { return { ...DEFAULT_CONFIG }; }
    };
    const saveConfig = c => {
        try { localStorage.setItem(STATE_KEY, JSON.stringify(c)); } catch {}
    };

    // ─── Chaves Groq (rotação compartilhada com o Sang Bot) ───
    const BOT_KEYS_KEY = 'sanghub_aibot_apiKeys';
    const VOZ_KEY_CD = new Map();

    function lerPoolBot() {
        try {
            const raw = localStorage.getItem(BOT_KEYS_KEY);
            if (!raw) return [];
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            return arr
                .filter(k => k && typeof k.key === 'string' && k.key.trim())
                .map(k => ({
                    key: k.key.trim(),
                    cooldownUntil: Number(k.cooldownUntil) || 0,
                    resetAt: Number(k.resetAt) || 0,
                    limit: Number(k.limit) || 200000,
                    usedToday: Number(k.usedToday) || 0
                }));
        } catch { return []; }
    }

    function salvarPoolBot(pool) {
        try { localStorage.setItem(BOT_KEYS_KEY, JSON.stringify(pool)); } catch {}
    }

    function lerChaveLegado() {
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

    function chavesDisponiveis() {
        const agora = Date.now();
        const pool = lerPoolBot();
        if (pool.length) {
            return pool
                .filter(k => !k.cooldownUntil || k.cooldownUntil < agora)
                .map(k => k.key);
        }
        const leg = lerChaveLegado();
        if (!leg) return [];
        return (VOZ_KEY_CD.get(leg) || 0) > agora ? [] : [leg];
    }

    function getGroqKey() {
        const d = chavesDisponiveis();
        return d.length ? d[0] : '';
    }

    function marcarKeyCooldown(key, ms) {
        if (!key) return;
        const ate = Date.now() + Math.max(60000, ms);
        const pool = lerPoolBot();
        const idx = pool.findIndex(k => k.key === key);
        if (idx >= 0) {
            pool[idx].cooldownUntil = ate;
            salvarPoolBot(pool);
        } else {
            VOZ_KEY_CD.set(key, ate);
        }
    }

    // ─── Utilidades ───
    const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
    const normalize = s => String(s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    function detectarMimeGravar() {
        if (typeof MediaRecorder === 'undefined') return '';
        for (const m of MIME_CANDIDATES) {
            try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
        }
        return '';
    }

    function extDoMime(mime) {
        if (!mime) return 'webm';
        if (mime.includes('ogg')) return 'ogg';
        if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
        return 'webm';
    }

    // ═══ COMANDOS ═══
    const PREFIXO_FORCAR_CHAT = /^(ditar|digitar|escrever|escreve|falar|fala)\s+(.+)$/i;

    const PALAVRAS_COMANDO = ['menu', 'sang', 'comando', 'comandar', 'catapimbas', 'youtube', 'yt'];
    const PREFIXO_COMANDO = new RegExp('^(' + PALAVRAS_COMANDO.join('|') + ')[,\\s]+(.+)$', 'i');
    const COMANDO_MENU_SEM_PREFIXO = /^(mostrar?|mostra|abrir?|abre|abra|fechar?|fecha|feche|esconder?|esconde)\s+(o\s+)?menu$/;

    const COMANDOS_VOZ = [
        { re: /^(enviar?|envia|mandar?|manda|manda\s+isso|manda\s+essa|envia\s+isso|envia\s+essa|pode\s+enviar|pode\s+mandar)$/, acao: 'enviar' },
        { re: /^(cancelar?|cancela|apagar?|apaga|limpar?|limpa|limpa\s+isso|apaga\s+isso|descarta(r)?|descarta|deixa\s+pra\s+la|deixa\s+pra\s+lá)$/, acao: 'cancelar' }
    ];

    const COMANDOS_RESERVADOS = [
        /^(abrir?|abre|abra|ativar?|ativa|ligar?|liga|iniciar?|inicia|fechar?|feche|fecha|desativar?|desativa|desligar?|desliga|parar?|para)\s+(o\s+|a\s+|os\s+|as\s+)?(menu|iptv|tv|youtube|yt|packet|blocklive|liveblock|adblock|bloqueador|booster|jogos|games|gameslive|photoswap|fotoswap|foto|prozilla|galeria|voz|chat|groq|gemini|sang)$/,
        /^(mostrar?|mostra|esconder?|esconde|abrir?|abre|fechar?|fecha)\s+menu$/,
        /^menu$/,
        /^(modo\s+)?(voz|microfone|mic)$/,
        /^(tirar?|tira)\s+print$/,
        /^(capturar?|captura)\s+(a\s+)?tela$/,
        /^print$/,
        /^(salvar?|salva)\s+(na\s+pasta|solto|solta)$/,
        /^(criar?|cria|nova?|novo)\s+(anotacao|anotação|nota)$/,
        /^(salvar?|salva)\s+nota$/,
        /^(concluir?|conclui|finalizar?|finaliza)(\s+(nota|anotacao|anotação))?$/,
        /^anotacao$/,
        /^anotação$/,
        /^nota$/,
        /^(fechar?|fecha|confirmar?|confirma|voltar?|volta)(\s+(isso|tudo|janela|painel))?$/,
        /^criar?\s+pasta(\s+.+)?$/,
        /^(abrir?|abre|abra|entrar?|entra|ir\s+para)\s+(na\s+)?pasta\s+.+$/,
        /^(voltar?|volta)\s+(para\s+)?(o\s+)?(inicio|início|raiz|home)$/,
        /^listar?\s+pastas$/,
        /^(excluir?|apagar?|deletar?|remover?)\s+(a\s+)?pasta\s+atual$/,
        /^(selecionar?|seleciona|marcar?|marca)\s+tudo$/,
        /^(desmarcar?|desmarca|limpar?|limpa|cancelar?|cancela)\s+(selecao|seleção|tudo)$/,
        /^(mover?|move)\s+(a\s+)?(selecao|seleção|selecionadas?)$/,
        /^(excluir?|exclui|apagar?|apaga|deletar?|deleta|remover?|remove)\s+(a\s+)?(selecao|seleção|selecionadas?)$/,
        /^(proxima|próxima|avancar?|avanca|avança|proximo|próximo|anterior|retroceder?|retrocede)\s*(foto|imagem)?$/,
        /^(fechar?|feche|fecha)\s+(a\s+)?(imagem|foto|lightbox)$/,
        /^(exportar?|exporta|fazer?|faz|salvar?|salva)\s+(backup|backup\s+da\s+galeria)$/,
        /^(exportar?|exporta)\s+(galeria|fotos|notas)$/,
        /^(salvar?|salva|tirar?|tira|capturar?|captura)\s+(print\s+)?na\s+pasta\s+.+$/,
        /^(salvar?|salva)\s+(solto|solta|na\s+raiz|no\s+inicio|no\s+início)$/
    ];

    window._voiceCommands = window._voiceCommands || {
        _extras: [],
        _handlers: [],
        adicionar(re) { if (re instanceof RegExp) this._extras.push(re); },
        registrar(re, cb, prioridade) {
            if (!(re instanceof RegExp) || typeof cb !== 'function') return false;
            this._handlers.push({ re, cb, prioridade: prioridade ?? 0 });
            return true;
        },
        remover(cb) {
            const antes = this._handlers.length;
            this._handlers = this._handlers.filter(h => h.cb !== cb);
            return this._handlers.length < antes;
        },
        tem(texto) {
            const n = normalize(texto);
            return COMANDOS_RESERVADOS.some(r => r.test(n)) || this._extras.some(r => r.test(n));
        },
        despachar(texto, meta) {
            const n = normalize(texto);
            const minPrio = meta?.fallback ? 0 : -Infinity;
            const ordenados = [...this._handlers]
                .filter(h => h.prioridade >= minPrio)
                .sort((a, b) => b.prioridade - a.prioridade);
            for (const h of ordenados) {
                if (!h.re.test(n)) continue;
                try {
                    const r = h.cb(texto, n, meta);
                    if (r !== false) return true;
                } catch (e) {
                    console.error('[Voz] handler error:', e);
                }
            }
            return false;
        },
        acaoLocal(texto) {
            const n = normalize(texto);
            for (const cmd of COMANDOS_VOZ) if (cmd.re.test(n)) return cmd.acao;
            return null;
        },
        extrairForcarChat(texto) {
            const m = String(texto || '').match(PREFIXO_FORCAR_CHAT);
            return m ? m[2].trim() : null;
        }
    };

    // ═══ CHAT DO JOGO ═══
    function encontrarInputChat() {
        const sels = [
            'input[placeholder*="onversa"]',
            'input[placeholder*="alar"]',
            'input[placeholder*="ensagem"]',
            'input[placeholder*="hat"]',
            'input[placeholder*="escreva"]',
            '.chat-input input',
            '.chatbox input',
            '.chat input',
            'input[type="text"][maxlength]'
        ];
        for (const sel of sels) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) return el;
        }
        return [...document.querySelectorAll('input[type="text"], textarea')]
            .find(el => el.getBoundingClientRect().top > window.innerHeight * 0.65 && el.offsetParent) || null;
    }

    function maxLenDoInput(inp) {
        if (!inp) return DEFAULT_CONFIG.maxCharsFallback;
        const m = inp.getAttribute('maxlength');
        if (m) {
            const n = parseInt(m, 10);
            if (Number.isFinite(n) && n > 20) return n;
        }
        return DEFAULT_CONFIG.maxCharsFallback;
    }

    function setInputValue(el, texto) {
        if (el.isContentEditable) {
            el.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('insertText', false, texto);
            return;
        }
        const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) desc.set.call(el, texto); else el.value = texto;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function pressEnter(el) {
        el.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true
        }));
    }

    function dividirEmBlocos(texto, maxLen) {
        const t = String(texto || '').trim();
        if (!t) return [];
        if (t.length <= maxLen) return [t];
        const blocos = [];
        let resto = t;
        const CONECTORES_BLOCO = new Set(['e','ou','mas','que','porque','pois','de','do','da','no','na','em','com','por','pra','para','a','o']);
        while (resto.length > maxLen) {
            let corte = resto.lastIndexOf(' ', maxLen);
            if (corte < Math.floor(maxLen * 0.6)) corte = maxLen;
            let bloco = resto.slice(0, corte).trimEnd();
            if (!bloco) bloco = resto.slice(0, corte);
            const ultima = bloco.split(/\s+/).pop()?.toLowerCase();
            if (ultima && CONECTORES_BLOCO.has(ultima) && bloco.length > 20) {
                const reduzido = bloco.slice(0, bloco.length - ultima.length).trimEnd();
                if (reduzido) bloco = reduzido;
            }
            blocos.push(bloco);
            resto = resto.slice(bloco.length).trimStart();
        }
        if (resto) blocos.push(resto);
        return blocos;
    }

    // ═══ MÓDULO ═══
    function init() {
        const config = loadConfig();
        const recorderMime = detectarMimeGravar();

        const host = document.createElement('div');
        host.id = UID + '_host';
        host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483000;';
        document.body.appendChild(host);
        const root = host.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = `
        :host { all: initial; }
        * { box-sizing: border-box; }

        .fab {
            position: fixed; width: 46px; height: 46px; border-radius: 50%;
            background: linear-gradient(135deg, #1e1e28, #2a2a3a);
            border: 2px solid rgba(255,255,255,.12);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; user-select: none; touch-action: none;
            box-shadow: 0 6px 20px rgba(0,0,0,.5);
            transition: transform .15s, background .15s, border-color .15s, opacity .2s;
            color: #b8b8d0;
        }
        .fab:hover { transform: scale(1.08); color: #fff; }
        .fab.ativo {
            background: linear-gradient(135deg, #ef4444, #b91c1c);
            border-color: #fca5a5; color: #fff;
            animation: pulse 1.5s ease-in-out infinite;
        }
        .fab.hearing { animation: pulse 1.5s ease-in-out infinite, hear .35s ease-out; }
        .fab.pausado { opacity: .55; }
        .fab.pausado::after {
            content: '⏸';
            position: absolute; top: -3px; right: -3px;
            background: #f5b942; color: #1a1410;
            font-size: 9px; font-weight: 900;
            width: 14px; height: 14px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 2px 6px rgba(0,0,0,.5);
        }
        .fab.reconfig { opacity: .5; pointer-events: none; }
        .fab.reconfig svg { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        @keyframes pulse {
            0%,100% { box-shadow: 0 6px 20px rgba(239,68,68,.4), 0 0 0 0 rgba(239,68,68,.6); }
            50% { box-shadow: 0 6px 20px rgba(239,68,68,.6), 0 0 0 14px rgba(239,68,68,0); }
        }
        @keyframes hear { 0% { transform: scale(1.14); } 100% { transform: scale(1); } }
        .fab svg { width: 22px; height: 22px; pointer-events: none; }

        .nivel {
            position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%);
            width: 3px; height: 3px; border-radius: 2px; background: #fca5a5;
            opacity: 0; transition: opacity .2s, height .15s;
        }
        .fab.ativo .nivel { opacity: 1; }
        .nivel.pico { height: 11px; }

        .motor-badge {
            position: absolute; top: -3px; left: -3px;
            width: 15px; height: 15px; border-radius: 50%;
            background: #2a2a3a; color: #b8b8d0;
            border: 1px solid rgba(255,255,255,.15);
            font-size: 8.5px; font-weight: 900;
            display: flex; align-items: center; justify-content: center;
            line-height: 1;
            pointer-events: none;
            box-shadow: 0 2px 6px rgba(0,0,0,.5);
        }
        .motor-badge[data-motor="whisper"] {
            background: linear-gradient(135deg, #a78bfa, #6d28d9);
            color: #fff;
            border-color: rgba(167,139,250,.55);
        }
        .bil-badge {
            position: absolute; top: -3px; right: -3px;
            width: 15px; height: 15px; border-radius: 50%;
            background: linear-gradient(135deg, #22d3ee, #0891b2);
            color: #fff;
            border: 1px solid rgba(34,211,238,.55);
            font-size: 9px; font-weight: 900;
            display: none; align-items: center; justify-content: center;
            line-height: 1;
            pointer-events: none;
            box-shadow: 0 2px 6px rgba(0,0,0,.5);
        }
        .bil-badge.on { display: flex; }

        .preview {
            position: fixed;
            background: rgba(15,15,20,.96);
            border: 1px solid rgba(139,92,246,.3);
            border-radius: 10px;
            padding: 10px 14px;
            color: #e8e8f0;
            font-size: 13px;
            font-family: -apple-system, system-ui, sans-serif;
            max-width: min(460px, 92vw);
            min-width: 220px;
            max-height: 60vh;
            overflow-y: auto;
            box-shadow: 0 8px 28px rgba(0,0,0,.7), 0 0 18px rgba(139,92,246,.2);
            display: none;
            backdrop-filter: blur(10px);
            z-index: 2147483000;
        }
        .preview.visivel { display: block; }
        .preview::-webkit-scrollbar { width: 5px; }
        .preview::-webkit-scrollbar-thumb { background: rgba(139,92,246,.4); border-radius: 3px; }
        .preview-hdr {
            display: flex; align-items: center; gap: 8px;
            font-size: 10px; color: #8b8fa3; margin-bottom: 6px;
            text-transform: uppercase; letter-spacing: .06em; font-weight: 700;
        }
        .preview-hdr .dot { width: 7px; height: 7px; border-radius: 50%; }
        .preview-hdr .dot.interim { background: #f5b942; animation: pulse 1s infinite; }
        .preview-hdr .dot.final   { background: #34d399; }
        .preview-hdr .dot.envio   { background: #22d3ee; animation: pulse .6s infinite; }
        .preview-hdr .aviso {
            margin-left: auto; font-size: 9px; font-weight: 700;
            padding: 2px 6px; border-radius: 4px;
            text-transform: none; letter-spacing: 0;
        }
        .preview-hdr .aviso.cmd {
            color: #f5b942; background: rgba(245,185,66,.12);
            border: 1px solid rgba(245,185,66,.3);
        }
        .preview-hdr .aviso.forcar {
            color: #22d3ee; background: rgba(34,211,238,.12);
            border: 1px solid rgba(34,211,238,.3);
        }
        .preview-hdr .aviso.envio {
            color: #22d3ee; background: rgba(34,211,238,.2);
            border: 1px solid rgba(34,211,238,.45);
        }
        .preview-texto { line-height: 1.4; word-break: break-word; min-height: 1.4em; }
        .preview-texto .interim { color: #8b8fa3; font-style: italic; }
        .preview-acoes {
            display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end;
        }
        .preview-acoes button {
            background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
            color: #e8e8f0; border-radius: 6px; padding: 4px 12px;
            font-size: 11px; cursor: pointer; font-family: inherit; font-weight: 600;
            transition: background .15s;
        }
        .preview-acoes button:hover { background: rgba(255,255,255,.16); }
        .preview-acoes button.primario {
            background: linear-gradient(135deg, #8b5cf6, #6d28d9);
            border-color: transparent;
        }
        .preview-acoes button.primario:hover { filter: brightness(1.15); }

        .popover {
            position: fixed;
            background: rgba(15,15,20,.98);
            border: 1px solid rgba(139,92,246,.25);
            border-radius: 12px;
            padding: 14px;
            color: #e8e8f0;
            font-size: 12px;
            font-family: -apple-system, system-ui, sans-serif;
            width: 290px;
            box-shadow: 0 12px 32px rgba(0,0,0,.8);
            display: none;
            z-index: 2147483001;
            max-height: 90vh;
            overflow-y: auto;
        }
        .popover.visivel { display: block; }
        .popover::-webkit-scrollbar { width: 5px; }
        .popover::-webkit-scrollbar-thumb { background: rgba(139,92,246,.4); border-radius: 3px; }
        .popover-hdr {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 12px;
        }
        .popover-hdr h3 {
            margin: 0; font-size: 11px; font-weight: 800;
            text-transform: uppercase; letter-spacing: .08em; color: #a78bfa;
        }
        .popover-close {
            width: 22px; height: 22px; padding: 0;
            background: transparent; border: 1px solid rgba(255,255,255,.1);
            color: #8b8fa3; border-radius: 6px;
            cursor: pointer; font-size: 14px; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            transition: background .15s, color .15s, border-color .15s;
            font-family: inherit;
        }
        .popover-close:hover {
            background: rgba(255,255,255,.08); color: #fff;
            border-color: rgba(255,255,255,.2);
        }
        .campo { margin-bottom: 11px; }
        .campo label {
            display: block; font-size: 9.5px; color: #8b8fa3;
            text-transform: uppercase; letter-spacing: .05em;
            margin-bottom: 4px; font-weight: 700;
        }
        .campo select {
            width: 100%; background: #14141e; border: 1px solid rgba(255,255,255,.12);
            border-radius: 6px; padding: 7px 9px; color: #e8e8f0;
            font-size: 12px; font-family: inherit; outline: none; cursor: pointer;
        }
        .campo select:focus { border-color: #8b5cf6; }
        .campo.subordinado { padding-left: 10px; border-left: 2px solid rgba(34,211,238,.25); }
        .ajuda {
            font-size: 10px; color: #8b8fa3; line-height: 1.55;
            border-top: 1px solid rgba(255,255,255,.06);
            padding-top: 10px; margin-top: 12px;
        }
        .ajuda code {
            background: rgba(255,255,255,.06); padding: 1px 4px;
            border-radius: 3px; font-size: 9.5px;
            font-family: ui-monospace, Menlo, Consolas, monospace;
        }
        .ajuda .dica-foco {
            display: flex; align-items: flex-start; gap: 6px;
            color: #f5b942; margin-top: 8px;
        }
        `;
        root.appendChild(style);

        // ─── FAB ───
        const fab = document.createElement('div');
        fab.className = 'fab';
        fab.title = 'Voz → Chat · clique = ativar/desativar · clique direito ou Alt+V = opções';
        fab.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <span class="nivel"></span>
            <span class="motor-badge" aria-hidden="true"></span>
            <span class="bil-badge" aria-hidden="true">🌐</span>`;
        const pos = {
            left: config.left ?? (window.innerWidth - 66),
            top: config.top ?? (window.innerHeight - 66)
        };
        fab.style.left = Math.max(0, Math.min(window.innerWidth - 56, pos.left)) + 'px';
        fab.style.top = Math.max(0, Math.min(window.innerHeight - 56, pos.top)) + 'px';
        root.appendChild(fab);

        // ─── Preview ───
        const preview = document.createElement('div');
        preview.className = 'preview';
        preview.innerHTML = `
            <div class="preview-hdr">
                <span class="dot final"></span>
                <span>Transcrição</span>
                <span class="aviso" id="aviso"></span>
            </div>
            <div class="preview-texto" id="txt"></div>
            <div class="preview-acoes">
                <button id="cancelar">Cancelar</button>
                <button id="enviar" class="primario">Enviar</button>
            </div>
        `;
        root.appendChild(preview);

        // ─── Popover ───
        const popover = document.createElement('div');
        popover.className = 'popover';
        popover.innerHTML = `
            <div class="popover-hdr">
                <h3>Voz → Texto</h3>
                <button type="button" class="popover-close" id="popoverClose" aria-label="Fechar opções">×</button>
            </div>
            <div class="campo">
                <label>Modo de envio</label>
                <select id="cfgModo">
                    <option value="manual">Manual (Enter/botão)</option>
                    <option value="auto">Automático (pausa)</option>
                </select>
            </div>
            <div class="campo">
                <label>Pausa antes de enviar</label>
                <select id="cfgSilencio">
                    <option value="500">500ms</option>
                    <option value="1000">1 segundo</option>
                    <option value="1800">1,8 segundos</option>
                    <option value="2500">2,5 segundos</option>
                    <option value="3500">3,5 segundos</option>
                </select>
            </div>
            <div class="campo">
                <label>Idioma da fala</label>
                <select id="cfgLang">
                    <option value="pt-BR">Português (Brasil)</option>
                    <option value="pt-PT">Português (Portugal)</option>
                    <option value="en-US">English (US)</option>
                    <option value="es-ES">Español</option>
                </select>
            </div>
            <div class="campo">
                <label>Motor de captura</label>
                <select id="cfgMotor">
                    <option value="nativo">Navegador (Web Speech API)</option>
                    <option value="whisper">Groq (Whisper large v3)</option>
                </select>
            </div>
            <div class="campo">
                <label>Pontuação</label>
                <select id="cfgPontuacao">
                    <option value="off">Nenhuma</option>
                    <option value="pausa">Vírgula nas pausas</option>
                    <option value="groq">Formatar com Sang AI</option>
                </select>
            </div>
            <div class="campo">
                <label>Modo de comando</label>
                <select id="cfgModoComando">
                    <option value="prefixo">Prefixado (menu, sang, youtube…)</option>
                    <option value="livre">Livre (atual)</option>
                </select>
            </div>
            <div class="campo">
                <label>Envio contínuo</label>
                <select id="cfgStreaming">
                    <option value="on">Ativado (envia enquanto fala)</option>
                    <option value="off">Desativado (junta tudo)</option>
                </select>
            </div>
            <div class="campo">
                <label>Modo bilíngue</label>
                <select id="cfgBilingue">
                    <option value="off">Desativado</option>
                    <option value="on">Ativado (traduz antes de enviar)</option>
                </select>
            </div>
            <div class="campo subordinado" id="campoBilingueIdioma">
                <label>Traduzir para</label>
                <select id="cfgBilingueIdioma">
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                    <option value="it">Italiano</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                    <option value="zh">中文</option>
                    <option value="ru">Русский</option>
                </select>
            </div>
            <div class="ajuda">
                <strong>Modo prefixado:</strong> comandos começam com
                <code>menu</code>, <code>sang</code>, <code>comando</code>,
                <code>catapimbas</code>, <code>youtube</code> ou <code>yt</code>.
                Ex: <code>youtube metallica</code>.<br><br>
                <strong>Modo bilíngue:</strong> envia a fala original e em seguida
                a tradução no idioma escolhido, como mensagens separadas.
                Exige a chave Groq configurada (mesma do Whisper).<br><br>
                <strong>Envio contínuo:</strong> quando a transcrição bate no limite do
                chat, ela é enviada na hora e o restante continua acumulando.
                Desativado automaticamente quando a pontuação é "Formatar com Sang AI",
                pra não misturar trecho formatado com trecho cru.<br><br>
                <strong>Modo livre:</strong> comandos disparam direto.
                <code>enviar</code> força envio, <code>cancelar</code> limpa.
                Use <code>digitar</code> para forçar texto ao chat.<br><br>
                <strong>Motor:</strong> <code>Navegador</code> usa a Web Speech API
                (mostra parcial em tempo real, sem custo). <code>Groq</code> usa
                Whisper large v3 (mais preciso em sotaque e ruído; o recorder só
                roda durante a fala pra evitar alucinação e gasto de cota).
                <div class="dica-foco">💡 Pausa sozinho quando você troca de aba ou janela — e preserva o texto pendente.</div>
            </div>
        `;
        root.appendChild(popover);

        const txtEl = preview.querySelector('#txt');
        const avisoEl = preview.querySelector('#aviso');
        const nivelEl = fab.querySelector('.nivel');
        const motorBadge = fab.querySelector('.motor-badge');
        const bilBadge = fab.querySelector('.bil-badge');
        const cfgModo = popover.querySelector('#cfgModo');
        const cfgSilencio = popover.querySelector('#cfgSilencio');
        const cfgLang = popover.querySelector('#cfgLang');
        const cfgMotor = popover.querySelector('#cfgMotor');
        const cfgPontuacao = popover.querySelector('#cfgPontuacao');
        const cfgModoComando = popover.querySelector('#cfgModoComando');
        const cfgStreaming = popover.querySelector('#cfgStreaming');
        const cfgBilingue = popover.querySelector('#cfgBilingue');
        const cfgBilingueIdioma = popover.querySelector('#cfgBilingueIdioma');
        const campoBilingueIdioma = popover.querySelector('#campoBilingueIdioma');
        const btnPopoverClose = popover.querySelector('#popoverClose');

        cfgModo.value = config.modo;
        cfgSilencio.value = String(config.silencioMs);
        cfgLang.value = config.lang;
        cfgMotor.value = config.motor;
        cfgPontuacao.value = config.pontuacao;
        cfgModoComando.value = config.modoComando;
        cfgStreaming.value = config.streaming ? 'on' : 'off';
        cfgBilingue.value = config.bilingue ? 'on' : 'off';
        cfgBilingueIdioma.value = IDIOMAS_BILINGUE[config.bilingueIdioma] ? config.bilingueIdioma : 'en';

        function atualizarMotorBadge() {
            motorBadge.textContent = config.motor === 'whisper' ? 'W' : 'N';
            motorBadge.dataset.motor = config.motor;
        }
        function atualizarBilBadge() {
            bilBadge.classList.toggle('on', config.bilingue === true);
            campoBilingueIdioma.style.opacity = config.bilingue ? '1' : '.45';
        }
        atualizarMotorBadge();
        atualizarBilBadge();

        // ─── Estado ───
        let rec = null;
        let habilitado = false;
        let ativo = false;
        let pausado = false;
        let textoFinal = '';
        let textoInterim = '';
        let ultimoResultadoEm = 0;
        let timerSilencio = null;
        let tentativasRestart = 0;
        let timerRestart = null;
        let timerReconfig = null;
        let ultimoOnStartEm = 0;
        let enviando = false;
        let enviandoGen = 0;
        let silencioAte = 0;
        let ultimoStreamEm = 0;
        let ultimoValorProprio = '';
        let flashTimer = null;

        // Whisper
        let whisperStream = null, whisperCtx = null, whisperAnalyser = null, whisperRecorder = null;
        let whisperVadTimer = null, whisperChunks = [], whisperFalando = false;
        let whisperSilencioDesde = 0, whisperFalaDesde = 0;
        let whisperFila = Promise.resolve();
        let whisperGen = 0;
        let whisperFalhasSeguidas = 0;
        let whisperRecording = false;
        const WHISPER_MAX_FALHAS = 4;
        let timerAutoWhisper = null;
        let pisoRuido = 0.008;

        function onSilenciar(e) {
            silencioAte = Date.now() + (e?.detail?.ms || 1500);
        }
        window.addEventListener('sang:voz-silenciar', onSilenciar);

        function dispararEstadoVoz() {
            window.dispatchEvent(new CustomEvent('sang:voz-state', {
                detail: { habilitado }
            }));
        }

        // ─── Reconhecimento nativo ───
        function criarRecognition() {
            const r = new SpeechRecognitionAPI();
            r.lang = config.lang;
            r.continuous = true;
            r.interimResults = true;
            r.maxAlternatives = 1;

            r.onstart = () => {
                ultimoOnStartEm = Date.now();
                tentativasRestart = 0;
                ativo = true;
                fab.classList.add('ativo');
                fab.classList.remove('pausado');
            };

            r.onresult = (event) => {
                if (Date.now() < silencioAte) return;

                const agora = Date.now();
                const tevePausa = ultimoResultadoEm &&
                    (agora - ultimoResultadoEm) > config.pausaVirgulaMs;
                const aplicarPausa = config.pontuacao === 'pausa' && tevePausa;

                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const res = event.results[i];
                    if (res.isFinal) {
                        const trecho = res[0].transcript.trim();
                        if (!trecho) continue;

                        if (aplicarPausa && textoFinal.trim()
                            && !/[.,!?;:]\s*$/.test(textoFinal.trimEnd())) {
                            textoFinal = textoFinal.trimEnd() + ', ';
                        } else if (textoFinal && !textoFinal.endsWith(' ')) {
                            textoFinal += ' ';
                        }
                        textoFinal += trecho;
                    } else {
                        interim += res[0].transcript;
                    }
                }
                textoInterim = interim;
                ultimoResultadoEm = agora;

                fab.classList.add('hearing');
                nivelEl.classList.add('pico');
                setTimeout(() => {
                    fab.classList.remove('hearing');
                    nivelEl.classList.remove('pico');
                }, 350);

                tentarStreaming();
                renderPreview();
                posicionarPreview();
            };

            r.onerror = (e) => {
                const tipo = e.error;
                if (tipo === 'no-speech' || tipo === 'aborted') return;
                if (tipo === 'not-allowed' || tipo === 'service-not-allowed') {
                    console.warn('[Voz] Permissão de microfone negada.');
                    habilitado = false;
                    pausado = false;
                    _parar();
                    dispararEstadoVoz();
                    return;
                }
                if (tipo === 'network') {
                    console.warn('[Voz] Erro de rede — vai tentar reconectar.');
                    return;
                }
                console.warn('[Voz] Erro:', tipo);
            };

            r.onend = () => {
                if (!ativo) { fab.classList.remove('ativo'); return; }
                const rodouEstavel = (Date.now() - ultimoOnStartEm) > 1000;
                tentativasRestart = rodouEstavel ? 0 : tentativasRestart + 1;
                if (tentativasRestart > 8) {
                    console.warn('[Voz] Muitas falhas seguidas — desativando.');
                    habilitado = false;
                    pausado = false;
                    _parar();
                    dispararEstadoVoz();
                    return;
                }
                const espera = rodouEstavel ? 0 : Math.min(30000, 1000 * Math.pow(2, tentativasRestart - 1));
                if (timerRestart) clearTimeout(timerRestart);
                timerRestart = setTimeout(() => {
                    if (!ativo) return;
                    rec = criarRecognition();
                    try { rec.start(); }
                    catch (e) {
                        console.warn('[Voz] Falha ao reiniciar:', e);
                        rec = null;
                        tentativasRestart++;
                        if (tentativasRestart <= 8) {
                            timerRestart = setTimeout(() => {
                                if (!ativo) return;
                                rec = criarRecognition();
                                try { rec.start(); } catch {}
                            }, 500);
                        } else {
                            habilitado = false;
                            pausado = false;
                            _parar();
                            dispararEstadoVoz();
                        }
                    }
                }, espera);
            };

            return r;
        }

        // ─── Whisper (Groq) ───
        async function iniciarWhisper() {
            if (typeof MediaRecorder === 'undefined') {
                console.warn('[Voz] MediaRecorder não disponível — Whisper indisponível.');
                avisarFalhaWhisper('⚠ Whisper indisponível neste navegador');
                return false;
            }
            try {
                whisperStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (e) {
                console.warn('[Voz] Permissão de microfone negada (Whisper).');
                return false;
            }
            if (!ativo) {
                whisperStream.getTracks().forEach(t => t.stop());
                whisperStream = null;
                return false;
            }
            pisoRuido = 0.008;
            whisperCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = whisperCtx.createMediaStreamSource(whisperStream);
            whisperAnalyser = whisperCtx.createAnalyser();
            whisperAnalyser.fftSize = 512;
            source.connect(whisperAnalyser);

            whisperStream.getAudioTracks()[0]?.addEventListener('ended', () => {
                if (ativo && config.motor === 'whisper') { pararWhisper(); iniciarWhisper(); }
            });

            // MediaRecorder só começa quando a VAD detectar fala (ver loopVad).
            whisperVadTimer = setInterval(loopVad, 60);
            return true;
        }

        function iniciarSegmentoWhisper() {
            if (!whisperStream || whisperRecording) return;
            if (whisperRecorder && whisperRecorder.state === 'recording') return;
            whisperChunks = [];
            try {
                whisperRecorder = recorderMime
                    ? new MediaRecorder(whisperStream, { mimeType: recorderMime })
                    : new MediaRecorder(whisperStream);
            } catch (e) {
                try { whisperRecorder = new MediaRecorder(whisperStream); }
                catch (e2) {
                    console.warn('[Voz] Falha ao criar MediaRecorder:', e2);
                    return;
                }
            }
            whisperRecorder.ondataavailable = e => {
                if (e.data.size > 0) whisperChunks.push(e.data);
            };
            try {
                whisperRecorder.start();
                whisperRecording = true;
            } catch (e) {
                whisperRecording = false;
            }
        }

        function loopVad() {
            if (!whisperAnalyser || !ativo) return;
            if (Date.now() < silencioAte) return;
            const buf = new Uint8Array(whisperAnalyser.fftSize);
            whisperAnalyser.getByteTimeDomainData(buf);
            let soma = 0;
            for (let i = 0; i < buf.length; i++) {
                const v = (buf[i] - 128) / 128;
                soma += v * v;
            }
            const rms = Math.sqrt(soma / buf.length);
            const agora = Date.now();

            if (!whisperFalando) {
                pisoRuido = pisoRuido * 0.95 + rms * 0.05;
            }
            const startLimiar = Math.max(WHISPER_VAD_START, pisoRuido * 2.5);
            const stopLimiar  = Math.max(WHISPER_VAD_STOP,  pisoRuido * 1.4);
            const limiar = whisperFalando ? stopLimiar : startLimiar;

            if (rms > limiar) {
                if (!whisperFalando) {
                    whisperFalando = true;
                    whisperFalaDesde = agora;
                    iniciarSegmentoWhisper();
                }
                whisperSilencioDesde = 0;
                fab.classList.add('hearing');
                nivelEl.classList.add('pico');
                return;
            }

            fab.classList.remove('hearing');
            nivelEl.classList.remove('pico');
            if (!whisperFalando) return;
            if (!whisperSilencioDesde) whisperSilencioDesde = agora;

            const durFala = agora - whisperFalaDesde;
            const durSilencio = agora - whisperSilencioDesde;

            if (durSilencio >= WHISPER_SILENCIO_MS || durFala >= WHISPER_MAX_SEGMENT_MS) {
                const valido = durFala >= WHISPER_MIN_FALA_MS;
                pararSegmentoWhisper(valido);
                whisperFalando = false;
                whisperSilencioDesde = 0;
                whisperFalaDesde = 0;
            }
        }

        function pararSegmentoWhisper(enviar) {
            if (!whisperRecorder || whisperRecorder.state === 'inactive') {
                whisperRecording = false;
                whisperRecorder = null;
                whisperChunks = [];
                return;
            }
            const rec = whisperRecorder;
            const chunks = whisperChunks;
            whisperRecorder = null;
            whisperRecording = false;
            whisperChunks = [];

            rec.onstop = () => {
                if (enviar && chunks.length) {
                    const tipo = rec.mimeType || recorderMime || 'audio/webm';
                    const blob = new Blob(chunks, { type: tipo });
                    if (blob.size >= 1024) enfileirarTranscricao(blob);
                }
            };
            try { rec.stop(); } catch (e) {}
        }

        function enfileirarTranscricao(blob) {
            const gen = whisperGen;
            whisperFila = whisperFila
                .then(() => transcreverComWhisper(blob, gen))
                .catch(e => console.warn('[Voz] Fila de transcrição:', e));
        }

        function avisarFalhaWhisper(msg) {
            avisoEl.textContent = msg;
            avisoEl.className = 'aviso cmd';
            preview.classList.add('visivel');
        }

        async function transcreverComWhisper(blob, gen) {
            if (gen !== whisperGen) return;
            if (!blob || blob.size < 1024) return;
            const mime = blob.type || recorderMime || 'audio/webm';

            let ultimaFalha = '';
            const tentativas = Math.max(2, chavesDisponiveis().length + 1);

            for (let tent = 0; tent < tentativas; tent++) {
                if (gen !== whisperGen) return;
                const key = getGroqKey();
                if (!key) {
                    avisarFalhaWhisper('⚠ sem chave Groq disponível');
                    return;
                }

                const form = new FormData();
                form.append('file', blob, 'audio.' + extDoMime(mime));
                form.append('model', WHISPER_MODEL);
                form.append('language', (config.lang || 'pt-BR').split('-')[0]);
                form.append('response_format', 'json');
                form.append('temperature', '0');
                form.append('prompt', WHISPER_PROMPT);

                try {
                    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                        method: 'POST',
                        headers: { Authorization: 'Bearer ' + key },
                        body: form
                    });

                    if (res.status === 429) {
                        const ra = parseInt(res.headers.get('retry-after') || '0', 10);
                        marcarKeyCooldown(key, ra > 0 ? ra * 1000 : 60000);
                        ultimaFalha = 'rate limit';
                        continue;
                    }
                    if (res.status === 401) {
                        marcarKeyCooldown(key, 24 * 60 * 60 * 1000);
                        ultimaFalha = 'chave inválida';
                        continue;
                    }
                    if (!res.ok) throw new Error('HTTP ' + res.status);

                    const data = await res.json();
                    if (gen !== whisperGen) return;
                    whisperFalhasSeguidas = 0;
                    const trecho = (data.text || '').trim();
                    if (!trecho) return;

                    if (textoFinal && !textoFinal.endsWith(' ')) textoFinal += ' ';
                    textoFinal += trecho;
                    ultimoResultadoEm = Date.now();
                    renderPreview();
                    posicionarPreview();
                    tentarStreaming();

                    if (config.modo === 'auto') {
                        if (timerAutoWhisper) clearTimeout(timerAutoWhisper);
                        timerAutoWhisper = setTimeout(() => {
                            timerAutoWhisper = null;
                            if (ativo && !enviando && !whisperFalando) enviar(false);
                        }, 400);
                    }
                    return;
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    console.warn('[Voz] Falha na transcrição Whisper:', e);
                    ultimaFalha = e.message || String(e);
                    continue;
                }
            }

            if (gen !== whisperGen) return;
            whisperFalhasSeguidas++;
            if (whisperFalhasSeguidas >= WHISPER_MAX_FALHAS) {
                avisarFalhaWhisper('⚠ Groq indisponível — voz desativada');
                habilitado = false;
                pausado = false;
                _parar();
                dispararEstadoVoz();
            } else {
                avisarFalhaWhisper(ultimaFalha ? ('⚠ ' + ultimaFalha + ' — tentando de novo') : '⚠ falha na transcrição');
            }
        }

        function pararWhisper() {
            if (whisperVadTimer) { clearInterval(whisperVadTimer); whisperVadTimer = null; }
            if (whisperRecorder && whisperRecorder.state !== 'inactive') {
                whisperRecorder.onstop = null;
                try { whisperRecorder.stop(); } catch (e) {}
            }
            whisperRecorder = null;
            whisperRecording = false;
            if (whisperStream) { whisperStream.getTracks().forEach(t => t.stop()); whisperStream = null; }
            if (whisperCtx) { try { whisperCtx.close(); } catch (e) {} whisperCtx = null; }
            whisperAnalyser = null;
            whisperChunks = [];
            whisperFalando = false;
            whisperSilencioDesde = 0;
            whisperFalaDesde = 0;
        }

        // ─── Parada interna ───
        function _parar(opts = {}) {
            const { preservarTexto = false } = opts;
            enviandoGen++;
            enviando = false;
            if (!preservarTexto) whisperGen++;
            ativo = false;
            if (timerRestart) { clearTimeout(timerRestart); timerRestart = null; }
            if (timerAutoWhisper) { clearTimeout(timerAutoWhisper); timerAutoWhisper = null; }
            if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
            if (rec) {
                try { rec.onend = null; rec.stop(); } catch {}
                rec = null;
            }
            pararWhisper();
            pararTimerSilencio();
            fab.classList.remove('ativo', 'hearing', 'reconfig');
            nivelEl.classList.remove('pico');
            if (!preservarTexto) {
                textoFinal = '';
                textoInterim = '';
                delete preview.dataset.busy;
            }
            renderPreview();
        }

        function _iniciarCaptura(opts = {}) {
            const { preservarTexto = false } = opts;
            if (ativo) return true;
            if (preservarTexto) {
                ultimoResultadoEm = Date.now();
            } else {
                textoFinal = '';
                textoInterim = '';
                ultimoResultadoEm = 0;
            }
            tentativasRestart = 0;
            whisperFalhasSeguidas = 0;

            if (config.motor === 'whisper') {
                ativo = true;
                fab.classList.add('ativo');
                fab.classList.remove('pausado');
                iniciarTimerSilencio();
                iniciarWhisper().then(ok => {
                    if (!ok && ativo) {
                        ativo = false;
                        habilitado = false;
                        pausado = false;
                        fab.classList.remove('ativo');
                        pararTimerSilencio();
                        dispararEstadoVoz();
                    } else if (ok && !ativo) {
                        pararWhisper();
                    }
                });
                return true;
            }

            ativo = true;
            rec = criarRecognition();
            try { rec.start(); }
            catch (e) {
                console.error('[Voz] Falha ao iniciar:', e);
                ativo = false;
                rec = null;
                return false;
            }
            fab.classList.add('ativo');
            fab.classList.remove('pausado');
            iniciarTimerSilencio();
            return true;
        }

        function ligar() {
            if (habilitado && ativo) return;
            habilitado = true;
            pausado = false;
            if (!_iniciarCaptura()) habilitado = false;
            dispararEstadoVoz();
        }

        function desligar() {
            if (!habilitado && !ativo) return;
            habilitado = false;
            pausado = false;
            _parar();
            dispararEstadoVoz();
        }

        function toggle() {
            if (habilitado) desligar(); else ligar();
        }

        // ─── Foco / Visibilidade ───
        function _pausarPorFoco() {
            if (!ativo) return;
            pausado = true;
            _parar({ preservarTexto: true });
            fab.classList.add('pausado');
        }

        function _retomarDoFoco() {
            if (!pausado) return;
            pausado = false;
            fab.classList.remove('pausado');
            if (habilitado) _iniciarCaptura({ preservarTexto: true });
        }

        function verificarFoco() {
            const focado = !document.hidden && document.hasFocus();
            if (!focado && ativo) _pausarPorFoco();
            else if (focado && pausado) _retomarDoFoco();
        }

        function onVisibility() { verificarFoco(); }
        function onFocus()      { verificarFoco(); }
        function onBlur()       { setTimeout(verificarFoco, 60); }

        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onFocus);
        window.addEventListener('blur', onBlur);

        // ─── Timer de silêncio ───
        function iniciarTimerSilencio() {
            if (timerSilencio) return;
            timerSilencio = setInterval(() => {
                if (!ativo || config.modo !== 'auto') return;
                if (enviando) return;
                const t = (textoFinal + textoInterim).trim();
                if (!t || t.length < config.minChars) return;
                if (terminaComConector(t)) return;
                if (Date.now() - ultimoResultadoEm >= config.silencioMs) enviar(false);
            }, 220);
        }
        function pararTimerSilencio() {
            if (timerSilencio) { clearInterval(timerSilencio); timerSilencio = null; }
        }

        const CONECTORES = new Set([
            'e','ou','mas','que','porque','pois','entao','então','tambem','também',
            'ainda','ja','já','se','quando','como','para','pra','de','do','da',
            'no','na','em','com','sem','por','ao','aos','as','às','os','um','uma','uns','umas'
        ]);
        function terminaComConector(t) {
            const p = normalize(t).split(/\s+/);
            return CONECTORES.has(p[p.length - 1]);
        }

        // ─── Preview ───
        function renderPreview() {
            if (preview.dataset.busy === '1') return;
            const completo = (textoFinal + textoInterim).trim();
            if (!completo) {
                preview.classList.remove('visivel');
                avisoEl.textContent = '';
                avisoEl.className = 'aviso';
                return;
            }
            txtEl.innerHTML = escapeHtml(textoFinal) +
                (textoInterim ? `<span class="interim">${escapeHtml(textoInterim)}</span>` : '');
            preview.querySelector('.dot').className = 'dot ' + (textoInterim ? 'interim' : 'final');

            const forcar = window._voiceCommands.extrairForcarChat(completo);
            if (forcar) {
                avisoEl.textContent = '→ vai pro chat';
                avisoEl.className = 'aviso forcar';
            } else if (config.modoComando === 'livre' && window._voiceCommands.tem(completo)) {
                avisoEl.textContent = '⚠ comando reservado';
                avisoEl.className = 'aviso cmd';
            } else if (config.modoComando === 'prefixo' && PREFIXO_COMANDO.test(completo)) {
                avisoEl.textContent = '⚡ comando';
                avisoEl.className = 'aviso cmd';
            } else if (config.bilingue) {
                avisoEl.textContent = '🌐 + ' + (IDIOMAS_BILINGUE[config.bilingueIdioma] || 'EN');
                avisoEl.className = 'aviso forcar';
            } else {
                avisoEl.textContent = '';
                avisoEl.className = 'aviso';
            }

            preview.classList.add('visivel');
        }

        function flashEnvio(len) {
            preview.dataset.busy = '1';
            avisoEl.textContent = `📤 ${len} enviados`;
            avisoEl.className = 'aviso envio';
            preview.querySelector('.dot').className = 'dot envio';
            if (flashTimer) clearTimeout(flashTimer);
            flashTimer = setTimeout(() => {
                flashTimer = null;
                delete preview.dataset.busy;
                renderPreview();
            }, 550);
        }

        function posicionarPreview() {
            const inp = encontrarInputChat();
            let left, top;
            if (inp) {
                const r = inp.getBoundingClientRect();
                left = Math.max(10, r.left);
                top = Math.max(10, r.top - 130);
            } else {
                left = window.innerWidth / 2 - 230;
                top = window.innerHeight - 240;
            }
            const largura = Math.min(460, window.innerWidth - 20);
            preview.style.maxWidth = largura + 'px';
            preview.style.left = Math.max(10, Math.min(left, window.innerWidth - largura - 10)) + 'px';
            preview.style.top = Math.min(top, window.innerHeight - 140) + 'px';
        }

        // ─── Heurística de "isso é comando?" ───
        function ehInicioDeComando(texto) {
            const n = normalize(texto);
            if (PREFIXO_COMANDO.test(n)) return true;
            if (COMANDO_MENU_SEM_PREFIXO.test(n)) return true;
            if (config.modoComando === 'livre' && window._voiceCommands.tem(n)) return true;
            if (CMD_LINK_RE.test(texto)) return true;
            if (CMD_WAKE_RE.test(n)) return true;
            if (CMD_VERBO_RE.test(n) && CMD_MIDIA_RE.test(n)) return true;
            return false;
        }

        // ─── Envio contínuo ───
        function tentarStreaming() {
            if (!config.streaming) return;
            if (config.pontuacao === 'groq') return;
            if (config.bilingue) return;
            if (enviando) return;
            if (!ativo) return;
            if (textoFinal.length < 20) return;
            if (Date.now() - ultimoStreamEm < MIN_INTERVALO_STREAM) return;

            const inp = encontrarInputChat();
            if (!inp) return;
            const maxLen = maxLenDoInput(inp);

            if (textoFinal.length < maxLen) return;
            if (ehInicioDeComando(textoFinal) && textoFinal.length < maxLen * 4) return;

            let corte = textoFinal.lastIndexOf(' ', maxLen);
            if (corte < Math.floor(maxLen * 0.5)) corte = maxLen;
            const bloco = textoFinal.slice(0, corte).trimEnd();
            if (!bloco) return;

            textoFinal = textoFinal.slice(bloco.length).trimStart();

            enviando = true;
            ultimoStreamEm = Date.now();

            try {
                setInputValue(inp, bloco);
                ultimoValorProprio = bloco;
                inp.focus();
            } catch (e) {
                enviando = false;
                return;
            }

            setTimeout(() => {
                if (ativo) { try { pressEnter(inp); } catch {} }
                enviando = false;
                flashEnvio(bloco.length);
                setTimeout(() => { ultimoValorProprio = ''; }, 250);
                tentarStreaming();
            }, 60);
        }

        // ─── Formatação via Sang AI ───
        async function formatarComSangAI(texto) {
            if (!window._apis?.groq || !window._apis.getKey?.('groq')) return texto;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 8000);
            try {
                const r = await window._apis.groq({
                    mensagens: [
                        {
                            role: 'system',
                            content: `
Você é um formatador inteligente de transcrições de áudio em português brasileiro.

Sua tarefa é transformar a transcrição bruta em uma mensagem natural, clara e bem pontuada, preservando fielmente o que a pessoa quis dizer.

Identifique corretamente: perguntas, afirmações, dúvidas, pedidos, ordens, sugestões, desabafos, exclamações, falas informais.

Regras:
1. Responda SOMENTE com o texto formatado.
2. Não responda ao conteúdo da fala.
3. Não explique nada.
4. Não resuma, expanda, invente ou altere o sentido.
5. Preserve o tom informal e as gírias.
6. Preserve nomes próprios, projetos, jogos, empresas e termos técnicos.
7. Corrija apenas erros claros de transcrição.
8. Use ponto de interrogação quando a fala for uma pergunta.
9. Use exclamação somente quando houver entusiasmo, surpresa ou ênfase evidente.
10. Use vírgulas em pausas naturais, sem exagerar.
11. Separe ideias diferentes em frases distintas.
12. Não transforme uma fala informal em texto formal demais.
13. Preserve expressões como "tá", "tô", "pra", "pro", "mano", "tipo", "né", "kkkk", "véi" e "pô".
14. Se uma palavra parecer um nome próprio, comando ou termo técnico, mantenha-a.
15. Retorne somente a versão final da transcrição, sem aspas, markdown ou comentários.

Exemplos:

Entrada:
qual é o melhor jeito de fazer um botão no javascript
Saída:
Qual é o melhor jeito de fazer um botão no JavaScript?

Entrada:
mano que interface bonita
Saída:
Mano, que interface bonita!

Entrada:
tipo assim eu queria saber se você consegue me ajudar
Saída:
Tipo assim, eu queria saber se você consegue me ajudar.

Entrada:
eu tava indo pra casa mais aí eu vi ele
Saída:
Eu tava indo pra casa, mas aí eu vi ele.
`,
                        },
                        { role: 'user', content: texto }
                    ],
                    maxTokens: 600,
                    temperature: 0.15,
                    topP: 0.9
                }, { signal: ctrl.signal, forceRefresh: true });
                const limpo = String(r || '').trim()
                    .replace(/^["'`]+|["'`]+$/g, '')
                    .replace(/^[-–—]\s*/, '')
                    .replace(/\n+/g, ' ')
                    .trim();
                return limpo || texto;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.warn('[Voz] Formatação Sang AI falhou:', e);
                }
                return texto;
            } finally {
                clearTimeout(timer);
            }
        }

        // ─── Tradução via Groq (modo bilíngue) ───
        async function traduzirComGroq(texto, codigoIdioma) {
            const nomeIdioma = IDIOMAS_BILINGUE[codigoIdioma] || 'English';
            const tentativas = Math.max(2, chavesDisponiveis().length + 1);

            for (let tent = 0; tent < tentativas; tent++) {
                const key = getGroqKey();
                if (!key) return '';

                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 8000);
                try {
                    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + key,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'openai/gpt-oss-20b',
                            messages: [
                                {
                                    role: 'system',
                                    content: `Você é um tradutor direto. Traduza o texto do usuário para ${nomeIdioma}.

Regras:
1. Responda SOMENTE com a tradução, sem aspas, sem markdown, sem explicações.
2. Preserve o tom informal, gírias e expressões coloquiais.
3. Preserve nomes próprios, marcas, jogos, empresas e termos técnicos como estão.
4. Não adicione nem remova informação.
5. Não responda ao conteúdo — apenas traduza.
6. Se o texto já estiver em ${nomeIdioma}, repita-o.
7. Retorne o texto em uma única linha, sem quebras.

Exemplos:
Entrada: e aí mano, tudo bem?
Saída (English): hey dude, all good?
Saída (Spanish): ¿qué pasa tío, todo bien?

Entrada: abre o youtube pra mim
Saída (English): open youtube for me
Saída (Japanese): ユーチューブを開いて`
                                },
                                { role: 'user', content: texto }
                            ],
                            max_tokens: 400,
                            temperature: 0.2,
                            top_p: 0.9
                        }),
                        signal: ctrl.signal
                    });

                    if (res.status === 429) {
                        const ra = parseInt(res.headers.get('retry-after') || '0', 10);
                        marcarKeyCooldown(key, ra > 0 ? ra * 1000 : 60000);
                        clearTimeout(timer);
                        continue;
                    }
                    if (res.status === 401) {
                        marcarKeyCooldown(key, 24 * 60 * 60 * 1000);
                        clearTimeout(timer);
                        continue;
                    }
                    if (!res.ok) throw new Error('HTTP ' + res.status);

                    const data = await res.json();
                    const bruto = data?.choices?.[0]?.message?.content || '';
                    return String(bruto).trim()
                        .replace(/^["'`]+|["'`]+$/g, '')
                        .replace(/^[-–—]\s*/, '')
                        .replace(/\n+/g, ' ')
                        .trim();
                } catch (e) {
                    if (e.name !== 'AbortError') {
                        console.warn('[Voz] Tradução bilíngue falhou:', e);
                    }
                    clearTimeout(timer);
                    return '';
                } finally {
                    clearTimeout(timer);
                }
            }
            return '';
        }

        // ─── Envio de um bloco ───
        async function enviarBloco(bloco, combinavel) {
            for (let tentativa = 0; tentativa < 3; tentativa++) {
                const inp = encontrarInputChat();
                if (inp) {
                    let final = bloco;
                    const maxLen = maxLenDoInput(inp);
                    const existente = inp.value.trim();
                    if (combinavel && existente && existente !== ultimoValorProprio.trim()) {
                        const combinado = existente + ' ' + final;
                        final = combinado.length > maxLen ? combinado.slice(-maxLen) : combinado;
                    }
                    setInputValue(inp, final);
                    ultimoValorProprio = final;
                    inp.focus();
                    setTimeout(() => {
                        pressEnter(inp);
                        setTimeout(() => { ultimoValorProprio = ''; }, 250);
                    }, 80);
                    return true;
                }
                await new Promise(r => setTimeout(r, 800));
            }
            return false;
        }

        // ─── Envio final ───
        async function enviar(forcado) {
            if (enviando) return;

            let texto = (textoFinal + textoInterim).trim();
            if (texto.length < config.minChars) return;

            const forcarPrefixo = window._voiceCommands.extrairForcarChat(texto);
            if (forcarPrefixo) {
                texto = forcarPrefixo;
            } else if (!forcado) {
                const acao = window._voiceCommands.acaoLocal(texto);
                if (acao === 'enviar') {
                    textoFinal = ''; textoInterim = ''; ultimoResultadoEm = 0;
                    renderPreview(); return;
                }
                if (acao === 'cancelar') { cancelar(); return; }

                if (config.modoComando === 'prefixo') {
                    if (COMANDO_MENU_SEM_PREFIXO.test(texto)) {
                        window._voiceCommands.despachar(texto, { wake: 'menu' });
                        textoFinal = ''; textoInterim = ''; ultimoResultadoEm = 0;
                        renderPreview(); return;
                    }
                    const m = texto.match(PREFIXO_COMANDO);
                    if (m) {
                        const comando = m[2].trim();
                        const wake = m[1].toLowerCase();
                        const consumido = window._voiceCommands.despachar(comando, { wake });
                        if (!consumido) {
                            console.log('[Voz] Wake word sem handler:', comando);
                            avisoEl.textContent = '⚠ comando não reconhecido';
                            avisoEl.className = 'aviso cmd';
                        }
                        textoFinal = ''; textoInterim = ''; ultimoResultadoEm = 0;
                        renderPreview(); return;
                    }

                    if (window._voiceCommands.despachar(texto, { fallback: true })) {
                        textoFinal = ''; textoInterim = ''; ultimoResultadoEm = 0;
                        renderPreview(); return;
                    }
                } else {
                    if (window._voiceCommands.despachar(texto)) {
                        textoFinal = ''; textoInterim = ''; ultimoResultadoEm = 0;
                        renderPreview(); return;
                    }
                    if (window._voiceCommands.tem(texto)) {
                        console.log('[Voz] Comando reservado sem handler:', texto);
                        textoFinal = ''; textoInterim = ''; ultimoResultadoEm = 0;
                        renderPreview(); return;
                    }
                }
            }

            const inp = encontrarInputChat();
            if (!inp) {
                avisoEl.textContent = '⚠ chat não encontrado';
                avisoEl.className = 'aviso cmd';
                return;
            }

            textoFinal = '';
            textoInterim = '';
            ultimoResultadoEm = 0;

            enviando = true;
            const gen = ++enviandoGen;

            try {
                if (config.pontuacao === 'groq' && !forcarPrefixo) {
                    preview.dataset.busy = '1';
                    avisoEl.textContent = '✨ formatando…';
                    avisoEl.className = 'aviso forcar';
                    const formatado = await formatarComSangAI(texto);
                    if (gen !== enviandoGen) return;
                    if (formatado) texto = formatado;
                }

                const maxLen = maxLenDoInput(inp);
                const blocos = dividirEmBlocos(texto, maxLen);

                if (config.bilingue && !forcarPrefixo) {
                    preview.dataset.busy = '1';
                    avisoEl.textContent = '🌐 traduzindo…';
                    avisoEl.className = 'aviso forcar';
                    const traducao = await traduzirComGroq(texto, config.bilingueIdioma);
                    if (gen !== enviandoGen) return;
                    if (traducao && traducao.toLowerCase() !== texto.toLowerCase()) {
                        const blocosTrad = dividirEmBlocos(traducao, maxLen);
                        for (const b of blocosTrad) blocos.push(b);
                    }
                }

                for (let i = 0; i < blocos.length; i++) {
                    if (gen !== enviandoGen) return;
                    if (blocos.length > 1) {
                        preview.dataset.busy = '1';
                        txtEl.textContent = blocos[i];
                        avisoEl.textContent = `📤 ${i + 1}/${blocos.length}`;
                        avisoEl.className = 'aviso envio';
                    }
                    const ok = await enviarBloco(blocos[i], i === 0);
                    if (gen !== enviandoGen) return;
                    if (!ok) {
                        avisoEl.textContent = '⚠ chat não encontrado';
                        avisoEl.className = 'aviso cmd';
                        break;
                    }
                    if (i < blocos.length - 1) {
                        await new Promise(r => setTimeout(r, config.delayEntreBlocos));
                    }
                }
            } catch (e) {
                console.warn('[Voz] Falha ao enviar:', e);
            } finally {
                if (gen === enviandoGen) {
                    enviando = false;
                    delete preview.dataset.busy;
                    renderPreview();
                }
            }
        }

        function cancelar() {
            enviandoGen++;
            enviando = false;
            textoFinal = '';
            textoInterim = '';
            ultimoResultadoEm = 0;
            if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
            delete preview.dataset.busy;
            renderPreview();
        }

        // ─── Eventos preview ───
        preview.querySelector('#enviar').addEventListener('click', e => {
            e.stopPropagation();
            enviar(true);
        });
        preview.querySelector('#cancelar').addEventListener('click', e => {
            e.stopPropagation();
            cancelar();
        });

        // ─── FAB ───
        let fabDrag = null, fabMoved = false;
        fab.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            fabDrag = {
                sx: e.clientX, sy: e.clientY,
                left: parseInt(fab.style.left, 10),
                top: parseInt(fab.style.top, 10)
            };
            fabMoved = false;
            try { fab.setPointerCapture(e.pointerId); } catch {}
        });
        fab.addEventListener('pointermove', e => {
            if (!fabDrag) return;
            const dx = e.clientX - fabDrag.sx;
            const dy = e.clientY - fabDrag.sy;
            if (!fabMoved && Math.hypot(dx, dy) < 4) return;
            fabMoved = true;
            fab.style.left = Math.max(0, Math.min(window.innerWidth - 56, fabDrag.left + dx)) + 'px';
            fab.style.top = Math.max(0, Math.min(window.innerHeight - 56, fabDrag.top + dy)) + 'px';
        });
        fab.addEventListener('pointerup', e => {
            if (!fabDrag) return;
            try { fab.releasePointerCapture(e.pointerId); } catch {}
            if (!fabMoved) toggle();
            else {
                config.left = parseInt(fab.style.left, 10);
                config.top = parseInt(fab.style.top, 10);
                saveConfig(config);
            }
            fabDrag = null;
        });
        fab.addEventListener('contextmenu', e => {
            e.preventDefault();
            const r = fab.getBoundingClientRect();
            popover.style.left = Math.max(10, Math.min(r.left - 300, window.innerWidth - 310)) + 'px';
            popover.style.top = Math.max(10, Math.min(r.top, window.innerHeight - 540)) + 'px';
            popover.classList.toggle('visivel');
        });

        // ─── Config ───
        cfgModo.addEventListener('change', () => { config.modo = cfgModo.value; saveConfig(config); });
        cfgSilencio.addEventListener('change', () => { config.silencioMs = parseInt(cfgSilencio.value, 10); saveConfig(config); });
        function reiniciarCapturaComDelay() {
            if (timerReconfig) clearTimeout(timerReconfig);
            const eraHabilitado = habilitado;
            _parar({ preservarTexto: true });
            if (!eraHabilitado) return;
            fab.classList.add('reconfig');
            timerReconfig = setTimeout(() => {
                timerReconfig = null;
                fab.classList.remove('reconfig');
                _iniciarCaptura({ preservarTexto: true });
            }, 300);
        }
        cfgLang.addEventListener('change', () => {
            config.lang = cfgLang.value;
            saveConfig(config);
            if (ativo) reiniciarCapturaComDelay();
        });
        cfgMotor.addEventListener('change', () => {
            config.motor = cfgMotor.value;
            saveConfig(config);
            atualizarMotorBadge();
            whisperFalhasSeguidas = 0;
            if (ativo) reiniciarCapturaComDelay();
        });
        cfgPontuacao.addEventListener('change', () => {
            config.pontuacao = cfgPontuacao.value;
            saveConfig(config);
        });
        cfgModoComando.addEventListener('change', () => {
            config.modoComando = cfgModoComando.value;
            saveConfig(config);
            renderPreview();
        });
        cfgStreaming.addEventListener('change', () => {
            config.streaming = cfgStreaming.value === 'on';
            saveConfig(config);
        });
        cfgBilingue.addEventListener('change', () => {
            config.bilingue = cfgBilingue.value === 'on';
            saveConfig(config);
            atualizarBilBadge();
            renderPreview();
        });
        cfgBilingueIdioma.addEventListener('change', () => {
            const cod = cfgBilingueIdioma.value;
            config.bilingueIdioma = IDIOMAS_BILINGUE[cod] ? cod : 'en';
            saveConfig(config);
            renderPreview();
        });

        btnPopoverClose.addEventListener('click', e => {
            e.stopPropagation();
            popover.classList.remove('visivel');
        });

        // ─── Popover fecha ao clicar fora ───
        function fecharPopoverFora(e) {
            if (!popover.classList.contains('visivel')) return;
            const path = e.composedPath ? e.composedPath() : [];
            if (path.includes(popover) || path.includes(fab)) return;
            popover.classList.remove('visivel');
        }
        document.addEventListener('pointerdown', fecharPopoverFora, true);

        // ─── Hotkeys ───
        const estaDigitando = () => {
            let el = document.activeElement;
            while (el?.shadowRoot?.activeElement) {
                el = el.shadowRoot.activeElement;
            }
            if (!el) return false;
            const tag = el.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
        };

        function onKeydown(e) {
            if (e.altKey && e.key.toLowerCase() === 'v' && !estaDigitando()) {
                e.preventDefault(); e.stopPropagation(); toggle(); return;
            }
            if (e.key === 'Escape' && ativo && (textoFinal || textoInterim)) {
                cancelar(); return;
            }
            if (e.key === 'Enter' && ativo && config.modo === 'manual'
                && (textoFinal || textoInterim) && !estaDigitando()) {
                e.preventDefault(); e.stopPropagation(); enviar(true);
            }
        }
        document.addEventListener('keydown', onKeydown, true);

        // ─── Resize ───
        function onResize() {
            const l = parseInt(fab.style.left, 10);
            const t = parseInt(fab.style.top, 10);
            fab.style.left = Math.max(0, Math.min(window.innerWidth - 56, l)) + 'px';
            fab.style.top = Math.max(0, Math.min(window.innerHeight - 56, t)) + 'px';
            if (preview.classList.contains('visivel')) posicionarPreview();
        }
        window.addEventListener('resize', onResize);

        // ─── API ───
        window[UID] = {
            kill() {
                desligar();
                window.removeEventListener('sang:voz-silenciar', onSilenciar);
                document.removeEventListener('keydown', onKeydown, true);
                document.removeEventListener('pointerdown', fecharPopoverFora, true);
                document.removeEventListener('visibilitychange', onVisibility);
                window.removeEventListener('focus', onFocus);
                window.removeEventListener('blur', onBlur);
                window.removeEventListener('resize', onResize);
                if (timerRestart) clearTimeout(timerRestart);
                if (timerReconfig) clearTimeout(timerReconfig);
                if (timerSilencio) clearInterval(timerSilencio);
                if (flashTimer) clearTimeout(flashTimer);
                if (timerAutoWhisper) clearTimeout(timerAutoWhisper);
                host.remove();
                delete window[UID];
                const vc = window._voiceCommands;
                if (vc && vc._handlers.length === 0 && vc._extras.length === 0) {
                    delete window._voiceCommands;
                }
            },
            show() { fab.style.display = 'flex'; },
            hide() { fab.style.display = 'none'; },
            toggle,
            get ativo() { return ativo; },
            get habilitado() { return habilitado; },
            get pausado() { return pausado; }
        };

        window.dispatchEvent(new CustomEvent('sang:voz-ready'));
    }

    if (document.body) init();
    else new MutationObserver((_, o) => {
        if (document.body) { o.disconnect(); init(); }
    }).observe(document.documentElement, { childList: true });
})();
