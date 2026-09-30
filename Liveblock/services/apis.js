(function() {
    'use strict';
    const UID = '_apis';
    if (window[UID]) return;

    // ============================================================
    // CONFIGURAÇÃO
    // ============================================================
    const CONFIG_KEY = 'sang_api_keys';
    const CACHE_PREFIX = 'sang_api_cache_';
    const COTA_PREFIX = 'sang_api_cota_';
    const DEBUG = false;

    // ============================================================
    // LOG
    // ============================================================
    function log(...args) {
        if (DEBUG) console.log('[apis]', ...args);
    }
    function erro(...args) {
        console.warn('[apis]', ...args);
    }

    // ============================================================
    // CHAVES
    // ============================================================
    function getKey(nome) {
        try {
            const keys = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
            return keys[nome] || '';
        } catch (_) { return ''; }
    }

    function setKey(nome, valor) {
        try {
            const keys = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
            if (valor) keys[nome] = String(valor).trim();
            else delete keys[nome];
            localStorage.setItem(CONFIG_KEY, JSON.stringify(keys));
            return true;
        } catch (_) { return false; }
    }

    function listarChaves() {
        try {
            return Object.keys(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'));
        } catch (_) { return []; }
    }

    // ============================================================
    // CACHE (localStorage + TTL)
    // ============================================================
    function cacheGet(chave) {
        try {
            const raw = localStorage.getItem(CACHE_PREFIX + chave);
            if (!raw) return null;
            const { valor, expira } = JSON.parse(raw);
            if (Date.now() > expira) {
                localStorage.removeItem(CACHE_PREFIX + chave);
                return null;
            }
            return valor;
        } catch (_) { return null; }
    }

    function cacheSet(chave, valor, ttlMs) {
        try {
            localStorage.setItem(CACHE_PREFIX + chave, JSON.stringify({
                valor,
                expira: Date.now() + (ttlMs || 3600000)
            }));
        } catch (_) {
            // Quota estourada — limpa cache antigo e tenta de novo
            limparCacheExpirado();
            try {
                localStorage.setItem(CACHE_PREFIX + chave, JSON.stringify({
                    valor, expira: Date.now() + (ttlMs || 3600000)
                }));
            } catch (_) {}
        }
    }

    function cacheDel(chave) {
        try { localStorage.removeItem(CACHE_PREFIX + chave); } catch (_) {}
    }

    function limparCacheExpirado() {
        try {
            const agora = Date.now();
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith(CACHE_PREFIX)) continue;
                try {
                    const { expira } = JSON.parse(localStorage.getItem(k) || '{}');
                    if (agora > expira) localStorage.removeItem(k);
                } catch (_) { localStorage.removeItem(k); }
            }
        } catch (_) {}
    }

    function limparTodoCache() {
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
            }
        } catch (_) {}
    }

    function hashChave(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
    }

    const cotasMemoria = {}; 

    function _carregarCota(servicoId) {
        if (cotasMemoria[servicoId]) return cotasMemoria[servicoId];
        let usadosHoje = 0, ultimoReset = Date.now();
        try {
            const raw = localStorage.getItem(COTA_PREFIX + servicoId);
            if (raw) {
                const parsed = JSON.parse(raw);
                usadosHoje = parsed.usadosHoje || 0;
                ultimoReset = parsed.ultimoReset || Date.now();
            }
        } catch (_) {}
        cotasMemoria[servicoId] = { timestamps: [], usadosHoje, ultimoReset };
        return cotasMemoria[servicoId];
    }

    function _persistirCota(servicoId) {
        const c = cotasMemoria[servicoId];
        if (!c) return;
        try {
            localStorage.setItem(COTA_PREFIX + servicoId, JSON.stringify({
                usadosHoje: c.usadosHoje,
                ultimoReset: c.ultimoReset
            }));
        } catch (_) {}
    }

    function podeChamar(servicoId) {
        const servico = servicos[servicoId];
        if (!servico || !servico.cota) return true;

        const c = _carregarCota(servicoId);
        const agora = Date.now();

        // Reset diário
        if (agora - c.ultimoReset > 86400000) {
            c.usadosHoje = 0;
            c.ultimoReset = agora;
            c.timestamps = [];
            _persistirCota(servicoId);
        }

        // Janela deslizante de 1 minuto
        c.timestamps = c.timestamps.filter(t => agora - t < 60000);

        if (servico.cota.rpm && c.timestamps.length >= servico.cota.rpm) return false;
        if (servico.cota.rpd && c.usadosHoje >= servico.cota.rpd) return false;
        return true;
    }

    function registrarChamada(servicoId) {
        const servico = servicos[servicoId];
        if (!servico || !servico.cota) return;
        const c = _carregarCota(servicoId);
        c.timestamps.push(Date.now());
        c.usadosHoje++;
        _persistirCota(servicoId);
    }

    function statusCota(servicoId) {
        const servico = servicos[servicoId];
        if (!servico || !servico.cota) return null;
        const c = _carregarCota(servicoId);
        const agora = Date.now();
        const naUltimaHora = c.timestamps.filter(t => agora - t < 60000).length;
        return {
            rpm: servico.cota.rpm,
            rpd: servico.cota.rpd,
            usadoNaUltimaHora: naUltimaHora,
            usadoHoje: c.usadosHoje,
            restanteMinuto: Math.max(0, (servico.cota.rpm || Infinity) - naUltimaHora),
            restanteDia: Math.max(0, (servico.cota.rpd || Infinity) - c.usadosHoje)
        };
    }

    // ============================================================
    // ERROS PADRONIZADOS
    // ============================================================
    class ApiError extends Error {
        constructor(servico, codigo, mensagem, detalhes) {
            super(mensagem);
            this.name = 'ApiError';
            this.servico = servico;
            this.codigo = codigo; 
            this.detalhes = detalhes;
        }
    }

    const servicos = {};

    function registrar(servico) {
        if (!servico || !servico.id) {
            erro('registrar(): serviço inválido', servico);
            return false;
        }
        if (servicos[servico.id]) {
            erro(`registrar(): "${servico.id}" já registrado`);
            return false;
        }
        servicos[servico.id] = Object.assign({
            nome: servico.id,
            chave: null,
            cota: null,
            cacheTtl: 0,
            requerUI: false,
            chamar: async () => { throw new ApiError(servico.id, 'nao-implementado', 'Serviço ainda não implementado'); }
        }, servico);
        log('registrado:', servico.id);
        return true;
    }

    function remover(id) {
        if (!servicos[id]) return false;
        delete servicos[id];
        delete cotasMemoria[id];
        try { localStorage.removeItem(COTA_PREFIX + id); } catch (_) {}
        return true;
    }

    function listarServicos() {
        return Object.values(servicos).map(s => ({
            id: s.id,
            nome: s.nome,
            requerUI: s.requerUI,
            temChave: s.chave ? !!getKey(s.chave) : true,
            chaveNome: s.chave,
            cota: s.cota,
            cacheTtl: s.cacheTtl,
            statusCota: statusCota(s.id)
        }));
    }

    // ============================================================
    // DESPACHO UNIFICADO
    // ============================================================
    async function chamar(id, params, opts) {
        const servico = servicos[id];
        if (!servico) throw new ApiError(id, 'inexistente', `Serviço "${id}" não registrado`);

        opts = opts || {};

        // 1. Chave
        if (servico.chave && !getKey(servico.chave)) {
            throw new ApiError(id, 'sem-chave', `Chave "${servico.chave}" não configurada`);
        }

        // 2. Cota
        if (!podeChamar(id)) {
            throw new ApiError(id, 'cota-local', `Cota local de "${servico.nome}" esgotada`);
        }

        // 3. Cache
        const cacheHabilitado = opts.cache !== false && (opts.cacheTtl || servico.cacheTtl) > 0;
        const cacheChave = cacheHabilitado
            ? id + '_' + hashChave(JSON.stringify(params || {}))
            : null;

        if (cacheHabilitado && !opts.forceRefresh) {
            const cached = cacheGet(cacheChave);
            if (cached !== null) {
                log('cache hit:', id);
                return cached;
            }
        }

        // 4. Chamada real
        try {
            const resultado = await servico.chamar(params || {}, {
                cache: cacheHabilitado,
                cacheTtl: opts.cacheTtl || servico.cacheTtl,
                forceRefresh: !!opts.forceRefresh,
                signal: opts.signal
            });

            registrarChamada(id);

            if (cacheHabilitado) {
                cacheSet(cacheChave, resultado, opts.cacheTtl || servico.cacheTtl);
            }
            return resultado;

        } catch (e) {
            if (e instanceof ApiError) throw e;
            if (e && e.name === 'AbortError') throw e;
            throw new ApiError(id, 'desconhecido', e?.message || String(e), e);
        }
    }

    // ============================================================
    // STUBS DOS SERVIÇOS (a preencher depois)
    // ============================================================

    registrar({
        id: 'gemini',
        nome: 'Gemini',
        chave: 'gemini',
        cota: { rpm: 15, rpd: 1500 },
        cacheTtl: 3600000, // 1h
        requerUI: true,    
        chamar: async (params, ctx) => {
            throw new ApiError('gemini', 'nao-implementado', 'Gemini ainda não implementado');
        }
    });

    registrar({
        id: 'search',
        nome: 'Custom Search',
        chave: 'search',
        cota: { rpm: 10, rpd: 100 },
        cacheTtl: 86400000, // 24h
        requerUI: false,
        chamar: async (params, ctx) => {
            throw new ApiError('search', 'nao-implementado', 'Custom Search ainda não implementado');
        }
    });

    registrar({
        id: 'vision',
        nome: 'Vision',
        chave: 'vision',
        cota: { rpm: 10, rpd: 1000 },
        cacheTtl: 0, 
        requerUI: false,
        chamar: async (params, ctx) => {
            throw new ApiError('vision', 'nao-implementado', 'Vision ainda não implementado');
        }
    });

    registrar({
        id: 'firestore',
        nome: 'Firestore',
        chave: 'firebase_config',
        cota: { rpm: 60, rpd: 20000 }, 
        cacheTtl: 300000, // 5min
        requerUI: false,
        chamar: async (params, ctx) => {
            throw new ApiError('firestore', 'nao-implementado', 'Firestore ainda não implementado');
        }
    });

    registrar({
        id: 'functions',
        nome: 'Cloud Functions',
        chave: 'functions_url',
        cota: { rpm: 120, rpd: 10000 },
        cacheTtl: 0, 
        requerUI: false,
        chamar: async (params, ctx) => {
            throw new ApiError('functions', 'nao-implementado', 'Cloud Functions ainda não implementado');
        }
    });

    registrar({
        id: 'speech',
        nome: 'Speech-to-Text',
        chave: 'speech',
        cota: { rpm: 5, rpd: 100 },
        cacheTtl: 0, // áudio é único
        requerUI: false,
        chamar: async (params, ctx) => {
            throw new ApiError('speech', 'nao-implementado', 'Speech ainda não implementado');
        }
    });
registrar({
    id: 'groq',
    nome: 'Groq',
    chave: 'groq',
    cota: { rpm: 30, rpd: 1000 },
    cacheTtl: 0, // chat nunca deve cachear
    requerUI: true,
    chamar: async (params, ctx) => {
        const key = getKey('groq');
        const modelo = params.modelo || 'openai/gpt-oss-120b';
        const mensagens = params.mensagens || [{ role: 'user', content: params.prompt || '' }];

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + key
            },
            body: JSON.stringify({
                model: modelo,
                messages: mensagens,
                temperature: params.temperature ?? 0.7,
                max_completion_tokens: params.maxTokens ?? 2048
            }),
            signal: ctx.signal
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const msg = res.status === 401 ? 'API key inválida'
                      : res.status === 429 ? 'Cota esgotada'
                      : (err.error?.message || 'HTTP ' + res.status);
            throw new ApiError('groq', 'http', msg);
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }
});
    // ============================================================
    // ATALHOS DIRETOS 
    // ============================================================
    function criarAtalho(id) {
        return (params, opts) => chamar(id, params, opts);
    }

    // ============================================================
    // API PÚBLICA
    // ============================================================
    const api = {
        // Despacho
        chamar,
        registrar,
        remover,
        listarServicos,

        // Chaves
        getKey,
        setKey,
        listarChaves,

        // Cache
        limparCacheExpirado,
        limparTodoCache,

        // Cota
        podeChamar,
        statusCota,

        // Utilitários
        ApiError,

        // kill
        kill: () => {
            limparCacheExpirado();
            delete window[UID];
        }
    };

    // Gera atalho pra cada serviço registrado: _apis.gemini(), _apis.search(), ...
    Object.keys(servicos).forEach(id => {
        api[id] = criarAtalho(id);
    });

    window[UID] = api;

    // Limpa cache expirado no boot
    limparCacheExpirado();

    log('pronto. Serviços registrados:', Object.keys(servicos).join(', '));
})();
