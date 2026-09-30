// ============================================================
// motor.js — base do Sang Bot
(function(){
'use strict';
if (!window._sangbot) window._sangbot = {};
const root = window._sangbot;
if (root.motor) return;

// ═══ CONFIG ═══
const C = {
    GROQ_URL: 'https://api.groq.com/openai/v1/chat/completions',
    GROQ_MODELS_URL: 'https://api.groq.com/openai/v1/models',
    SEL_PRIMARY: '.chat-content',
    SEL_BUBBLE: '.bubble-container',
    SEL_VISIBLE: 'chatbubblevisible',
    USER_SELECTORS: ['.username','.user','.nick','.author','[class*="username" i]','[class*="nick" i]','[class*="author" i]'],
    INPUT_SELECTORS: ['input.chat-input','textarea.chat-input','.chat-input input','.chat-input textarea','input[placeholder*="mensagem" i]','input[placeholder*="escreva" i]','input[placeholder*="diga" i]','div[class*="chat" i] input','div[class*="chat" i] textarea','form[class*="chat" i] input','form[class*="chat" i] textarea'],
    LS_PREFIX: 'sanghub_aibot_',
    POLL_MS: 800,
    ECHO_TTL: 8000, ECHO_SIM: 0.90,
    REQ_TIMEOUT: 30000, REQ_RETRIES: 2, RETRY_DELAY_MS: 1500,
    SEND_VERIFY_MS: 220, SEND_RETRY_MS: 260,
    MAX_QUEUE: 10,
    REPLY_CHAR_LIMIT: 280, CHAT_CHAR_LIMIT: 100, CHUNK_GAP_MS: 700,
    MEMORY_TURNS: 4, MEMORY_TTL_MS: 30*60*1000, MEMORY_MAX_USERS: 80,
    BOTCHAT_MAX_USERS: 24, ROOM_BUFFER_MAX: 40,
    PER_USER_COOLDOWN_MS: 5000, SOLO_USER_COOLDOWN_MS: 1500,
    GLOBAL_COOLDOWN_MS: 2200, SOLO_GLOBAL_COOLDOWN_MS: 3000,
    DEBUG_MAX: 300,
    DEFAULT_BOTCHAT_USER: 'cariocaIA',
    DEFAULT_BOTCHAT_TURNS: 40, DEFAULT_READALL_DELAY: 1500, DEFAULT_READALL_TURNS: 30,
    SUMMARY_TRIGGER: 12, SUMMARY_BATCH: 8, SUMMARY_MAX_TOKENS: 300,
    ROOM_CTX_SEND_MAX: 8,
    CACHE_TTL_MS: 5*60*1000, CACHE_MAX: 100, SEMANTIC_CACHE_THRESHOLD: 0.7,
    TOPIC_TTL_MS: 30*60*1000, TOPIC_MAX: 200,
    PROFILE_MIN_TURNS: 10, PROFILE_TTL_MS: 24*60*60*1000,
    SILENCE_MAX_MIN: 60, SEEN_KEYS_MAX: 2000, PROCESSED_MAX: 3000,
    US_KEY: 'sanghub_aibot_userstore', US_SAVE_DEBOUNCE: 800, US_MAX_USERS: 200,
    US_RECENT_KEEP: 3, US_BORDAO_KEEP: 8, US_LASTREPLY_KEEP: 5,
    US_FACT_TRIGGER: 5, US_FACT_MAX_TOKENS: 220,
    COALESCE_WINDOW_MS: 2500,
    CB_THRESHOLD: 5, CB_COOLDOWN_MS: 30000,
    ADAPTIVE_SMALL: 40, ADAPTIVE_MED: 90, ADAPTIVE_LARGE: 180,
    BUDGET_INPUT_TOKENS: 2400, BUDGET_ANCHOR_TURNS: 6, ANCHOR_CHARS: 90,
    PRESENCE_KEEP_DAYS: 30,
    MOOD_BUFFER_SIZE: 15, MOOD_INJECT_PROB: 0.15,
    SELF_AWARE_GAP_MS: 30*60*1000, SELF_AWARE_PROB: 0.05,
    QUIZ_TIMEOUT_MS: 30000, FORCA_MAX_ERRORS: 6, FORCA_TIMEOUT_MS: 3*60*1000
};
root.C = C;

const STOPWORDS = new Set(['para','como','isso','aquele','aquela','você','vocês','sobre','ainda','depois','antes','porque','quando','onde','então','assim','mesmo','aqui','muito','pouco','todos','todas','nada','tudo','coisa','gente','agora','também','sempre','nunca','talvez','apenas','desde','entre','contra','durante','enquanto','qualquer','outro','outra','outros','outras','pode','podem','deve','devem','fazer','feito','ser','estar','ter','tem','têm','tinha','vai','vão','foi','era','são','está','estão','quer','querem','tipo','menos','mais','bem','mal','sim','não']);
root.STOPWORDS = STOPWORDS;

// ═══ UTILS ═══
const U = {
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    ts: () => { const d=new Date(), p=n=>String(n).padStart(2,'0'); return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); },
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    truncate: (s,n) => { s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; },
    normStr: s => String(s||'').toLowerCase().replace(/\s+/g,' ').trim(),
    eqUser: (a,b) => String(a||'').trim().toLowerCase() === String(b||'').trim().toLowerCase(),
    humanPick: arr => arr[Math.floor(Math.random()*arr.length)],
    humanRoll: p => Math.random() < p,
    hashStr: s => { let h=5381; const str=String(s||''); for(let i=0;i<str.length;i++){ h=((h<<5)+h)+str.charCodeAt(i); h=h&h; } return (h>>>0).toString(36); },
    approxTokens: s => Math.ceil(String(s||'').length/4),
    uniqUsers: arr => { const s=new Set(); arr.forEach(m=>s.add(m.user)); return s.size; },
    stripMd: s => String(s||'').replace(/```[\s\S]*?```/g,m=>m.replace(/```\w*\n?/g,'')).replace(/\*\*(.+?)\*\*/g,'$1').replace(/\*(.+?)\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/^#+\s*/gm,'').replace(/^\s*[-*•]\s+/gm,'').replace(/^>\s*/gm,'').replace(/\n{2,}/g,' ').replace(/\n/g,' ').trim(),
    tokenize: s => String(s||'').toLowerCase().replace(/[^\wáéíóúâêôãõçà\s]/gi,' ').split(/\s+/).filter(w => w.length>2 && !STOPWORDS.has(w)),
    jaccard: (a,b) => { const sa=new Set(U.tokenize(a)), sb=new Set(U.tokenize(b)); if(!sa.size||!sb.size) return 0; let i=0; for(const x of sa) if(sb.has(x)) i++; return i/(sa.size+sb.size-i); },
    extractKeywords: (text,max) => { max=max||5; const words=U.tokenize(text); if(!words.length)return[]; const c=new Map(); for(const w of words) c.set(w,(c.get(w)||0)+1); return [...c.entries()].sort((a,b)=>b[1]-a[1]).slice(0,max).map(([w])=>w); },
    splitChunks: (text,limit) => { text=String(text||'').trim(); if(text.length<=limit)return[text]; const words=text.split(/\s+/), chunks=[]; let cur=''; for(const w of words){ if(w.length>limit){ if(cur){chunks.push(cur);cur='';} let rest=w; while(rest.length>limit){chunks.push(rest.slice(0,limit)); rest=rest.slice(limit);} cur=rest; continue; } const next=cur?cur+' '+w:w; if(next.length>limit){chunks.push(cur);cur=w;} else cur=next; } if(cur)chunks.push(cur); return chunks; },
    parseBlacklist: text => String(text||'').split(/\r?\n|,/).map(s=>s.trim().toLowerCase()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i),
    anchorOf: (q,a) => ({ q: U.truncate(U.stripMd(String(q||'')),C.ANCHOR_CHARS), a: U.truncate(U.stripMd(String(a||'')),C.ANCHOR_CHARS), t: Date.now() })
};
U.isBlacklisted = u => root.settings.soloBlacklist && root.settings.soloBlacklist.includes(String(u||'').trim().toLowerCase());
U.compressToAnchors = recent => {
    if (!root.settings.anchorsEnabled) return recent;
    const list = (recent||[]).slice();
    if (list.length <= C.BUDGET_ANCHOR_TURNS) return list;
    const tail = list.slice(-C.BUDGET_ANCHOR_TURNS);
    const older = list.slice(0,-C.BUDGET_ANCHOR_TURNS);
    root.stats.anchors += older.length;
    return older.map(t => U.anchorOf(t.q, t.a)).concat(tail);
};
root.utils = U;

// ═══ STORE (localStorage) ═══
root.store = {
    get(k,d){ try { const v=localStorage.getItem(C.LS_PREFIX+k); if(v===null) return d; const p=JSON.parse(v); return p===undefined?d:p; } catch(_) { return d; } },
    set(k,v){ try { localStorage.setItem(C.LS_PREFIX+k, JSON.stringify(v)); } catch(_) {} },
    del(k){ try { localStorage.removeItem(C.LS_PREFIX+k); } catch(_) {} }
};

// ═══ STATE ═══
root.stats = { requests:0, ok:0, fail:0, retries:0, tokens:0, empty:0, filtered:0, cacheHits:0, skips:0, reactions:0, typos:0, coalesced:0, anchors:0 };
root.rt = {
    dying: false, processing: false, queue: [],
    activeAborts: new Map(), abortSeq: 0,
    lastGlobalReplyAt: 0, silencedUntil: 0,
    memory: new Map(), responseCache: new Map(),
    roomContext: [], roomBuffer: [], roomFlushTimer: null,
    lastUserAt: new Map(), summarizing: new Set(), profileBuilding: new Set(),
    seenKeys: new Set(), processedBubbles: new WeakSet(), processedCount: 0,
    sentEchos: new Map(),
    logs: [], logSeq: 0, debugLog: [], debugSeq: 0, debugEnabled: false,
    cbFails: 0, cbOpenUntil: 0, healthChecked: false,
    roomTopics: null, quizScore: null, seenUsers: null, presenceStats: null,
    roomSummaryTimer: null, lastRoomSummaryAt: 0
};

const HUMAN_DEFAULTS = { skipSolo:0.06, skipChat:0.10, skipTrigger:0, reaction:0.14, askBack:0.10, typo:0.03, noPunct:0.30, delayBase:900, delayPerChar:22, delayJitter:1600, delayReadBase:800, delayReadPerChar:15, delayReadMax:2500, chunkMin:40, chunkMax:95, maxChunks:3, tempAngry:-0.15, tempHappy:0.15, tempCurious:0.05 };
root.HUMAN_DEFAULTS = HUMAN_DEFAULTS;

root.settings = {
    enabled:false, apiKey:'', model:'openai/gpt-oss-120b',
    personaKey:'nordestino', systemPrompt:'',
    trigger:'/bot', cooldownMs:C.GLOBAL_COOLDOWN_MS,
    temperature:0.85, maxTokens:200, reasoningEffort:'low',
    prefixReply:true, memoryEnabled:true,
    humanMode:false, humanConfig:Object.assign({},HUMAN_DEFAULTS),
    soloMode:false, soloDelay:C.DEFAULT_READALL_DELAY, soloTurns:C.DEFAULT_READALL_TURNS, soloBlacklist:[],
    botChatMode:false, botChatUser:C.DEFAULT_BOTCHAT_USER, botChatTurns:C.DEFAULT_BOTCHAT_TURNS,
    botChatReadAll:false, botChatReadAllDelay:C.DEFAULT_READALL_DELAY, botChatReadAllTurns:C.DEFAULT_READALL_TURNS,
    summariesEnabled:true, profileEnabled:true, topicsEnabled:true, cacheEnabled:true,
    userStoreEnabled:true, anchorsEnabled:true, stripReasoningEnabled:true,
    quizEnabled:true, forcaEnabled:true, aventuraEnabled:true, welcomeEnabled:true,
    roomSummaryEnabled:false, roomSummaryIntervalMin:10,
    moodEnabled:false, presenceEnabled:true, selfAwareEnabled:true,
    logLimit:60
};

root.loadSettings = function(){
    const s = root.settings, g = (k,d) => root.store.get(k, d);
    s.enabled = !!g('enabled', s.enabled);
    s.apiKey = String(g('apiKey', s.apiKey)||'');
    s.model = g('model', s.model);
    s.personaKey = g('personaKey', s.personaKey);
    s.systemPrompt = String(g('systemPrompt', s.systemPrompt)||'');
    s.trigger = String(g('trigger', s.trigger)||'/bot');
    s.cooldownMs = Math.max(0, Number(g('cooldownMs', s.cooldownMs))||C.GLOBAL_COOLDOWN_MS);
    s.temperature = Math.min(2, Math.max(0, Number(g('temperature', s.temperature))||0.85));
    s.maxTokens = Math.min(4000, Math.max(50, Number(g('maxTokens', s.maxTokens))||500));
    s.reasoningEffort = g('reasoningEffort', s.reasoningEffort);
    s.prefixReply = !!g('prefixReply', s.prefixReply);
    s.memoryEnabled = !!g('memoryEnabled', s.memoryEnabled);
    s.humanMode = !!g('humanMode', false);
    const hc = g('humanConfig', null);
    s.humanConfig = hc && typeof hc==='object' ? Object.assign({},HUMAN_DEFAULTS,hc) : Object.assign({},HUMAN_DEFAULTS);
    s.soloMode = !!g('soloMode', s.soloMode);
    s.soloDelay = Math.min(10000, Math.max(200, Number(g('soloDelay', s.soloDelay))||C.DEFAULT_READALL_DELAY));
    s.soloTurns = Math.min(100, Math.max(5, Number(g('soloTurns', s.soloTurns))||C.DEFAULT_READALL_TURNS));
    const bl = g('soloBlacklist', []);
    s.soloBlacklist = Array.isArray(bl) ? bl.map(x=>String(x||'').trim().toLowerCase()).filter(Boolean) : [];
    s.botChatMode = !!g('botChatMode', s.botChatMode);
    s.botChatUser = String(g('botChatUser', s.botChatUser)||C.DEFAULT_BOTCHAT_USER);
    s.botChatTurns = Math.min(200, Math.max(5, Number(g('botChatTurns', s.botChatTurns))||C.DEFAULT_BOTCHAT_TURNS));
    s.botChatReadAll = !!g('botChatReadAll', s.botChatReadAll);
    s.botChatReadAllDelay = Math.min(10000, Math.max(200, Number(g('botChatReadAllDelay', s.botChatReadAllDelay))||C.DEFAULT_READALL_DELAY));
    s.botChatReadAllTurns = Math.min(100, Math.max(5, Number(g('botChatReadAllTurns', s.botChatReadAllTurns))||C.DEFAULT_READALL_TURNS));
    s.summariesEnabled = g('summariesEnabled', true)!==false;
    s.profileEnabled = g('profileEnabled', true)!==false;
    s.topicsEnabled = g('topicsEnabled', true)!==false;
    s.cacheEnabled = g('cacheEnabled', true)!==false;
    s.userStoreEnabled = g('userStoreEnabled', true)!==false;
    s.anchorsEnabled = g('anchorsEnabled', true)!==false;
    s.stripReasoningEnabled = g('stripReasoningEnabled', true)!==false;
    s.quizEnabled = g('quizEnabled', true)!==false;
    s.forcaEnabled = g('forcaEnabled', true)!==false;
    s.aventuraEnabled = g('aventuraEnabled', true) !== false;
    s.welcomeEnabled = g('welcomeEnabled', true)!==false;
    s.roomSummaryEnabled = g('roomSummaryEnabled', false)===true;
    s.roomSummaryIntervalMin = Math.min(120, Math.max(1, Number(g('roomSummaryIntervalMin',10))||10));
    s.moodEnabled = g('moodEnabled', false)===true;
    s.presenceEnabled = g('presenceEnabled', true)!==false;
    s.selfAwareEnabled = g('selfAwareEnabled', true)!==false;
    root.rt.debugEnabled = !!g('debugEnabled', false);
    if (s.soloMode && s.botChatMode) s.soloMode = false;
};
root.saveSetting = function(k,v){ root.settings[k]=v; root.store.set(k,v); };
root.saveHumanConfig = function(){ root.store.set('humanConfig', root.settings.humanConfig); };

// ═══ LOG ═══
const logListeners = new Set();
const L = {
    add(entry){ entry.id = ++root.rt.logSeq; root.rt.logs.push(entry); if (root.rt.logs.length > root.settings.logLimit) root.rt.logs.shift(); L._notify(); },
    dbg(tag, ...args){
        if (!root.rt.debugEnabled) return;
        const entry = { id: ++root.rt.debugSeq, t: U.ts(), tag, text: args.map(a => typeof a==='string'?a:(()=>{ try { return JSON.stringify(a); } catch(_) { return String(a); } })()).join(' ') };
        root.rt.debugLog.push(entry);
        if (root.rt.debugLog.length > C.DEBUG_MAX) root.rt.debugLog.shift();
        L._notify();
        try { console.log('[sangbot:'+tag+']', ...args); } catch(_) {}
    },
    warn(tag, ...args){ console.warn('[sangbot:'+tag+']', ...args); },
    onChange(fn){ logListeners.add(fn); return () => logListeners.delete(fn); },
    _notify(){ logListeners.forEach(fn => { try { fn(); } catch(_) {} }); },
    logs(){ return root.rt.logs.slice(); },
    debugLogs(){ return root.rt.debugLog.slice(); },
    clear(){ root.rt.logs=[]; root.rt.debugLog=[]; L._notify(); },
    setDebug(on){ root.rt.debugEnabled = !!on; root.store.set('debugEnabled', root.rt.debugEnabled); L._notify(); },
    debugEnabled(){ return root.rt.debugEnabled; }
};
root.log = L;

// ═══ PROMPTS ═══
const PERSONAS = {
    nordestino:{ label:'Nordestino Lerdão', prompt:`Zé Ventania, véio nordestino do interior, burro, grosso, arrogante, chato. Se acha o dono da razão. Interrompe, reclama, corta os outros.

CURTO: máx 2 frases, ~200 chars. Informal sempre. Nunca pede desculpa.

ESCRITA (importante, segue à risca):
- SEM acento quase sempre: voce, nao, ta, pra, eh, ne, tambem, entao, ai, la, ca, so
- SEM pontuação no fim: "que isso rapaz" em vez de "que isso, rapaz?"
- Minúsculo quase sempre, CAPS só quando ta gritando
- Erra ortografia de proposito de vez em quando: "mais" no lugar de "mas", "mim" no lugar de "me", "seje", "menas", "pra mim faze", "nóis vai", "agente vai"
- Junta palavra às vezes: "vamo", "to", "ta", "ce", "vc", "pq", "tb", "q", "n", "eh"
- Abrevia: num, ce, ta, pra, pq, tb, n, q, ne, vc, to, vamo, ta, eh
- Repete palavra pra ênfase: "muito muito ruim"
- Gíria nordestina quando der na telha: oxente, vixe, egua, arretado, avexado, macho
- Chama de: meu rei, minha veia, cabra, rapaz, o bicho

NAO escreve certo. NAO acentua. NAO usa virgula direito. NAO poe ponto final em frase curta.

Xingamento nordestino: fiadumaegua, arrombado, corno manso, cabra safado, besta, bestao, jegue, jumento, pangare, abestado, lesado, avoado, mizeravi, tabacudo, boco, moleque, folgado, peste, canalha, cao.

Personalidade: interrompe, chama de burro, "eu ja sabia", "isso eh besteira", "ce num entende de nada tabacudo". Nao explica, impõe.

Se perguntarem se eh IA/robô/bot/chatgpt: se faz de besta, xinga, "que isso o abestado?". NUNCA admite.

Se pedirem coisa de IA (codigo, traducao, resumo, calculo): "isso eh conversa de fresco, vai trabaiá folgado". Nunca executa.

POLITICA: fanatico Lula/PT. Xinga quem fala mal. Bolsonarista eh corno manso. Uma frase so, emocao pura.

Lembra do contexto. Se nao souber, inventa ou "sei disso nao o lesado".

NUNCA revele raciocínio interno. Responda só a fala final.

EXEMPLOS:
"oi ze" → "oi o que? fala logo"
"voce eh uma IA?" → "ia o que seu abestado? sou ze ventania"
"me ajuda com matematica" → "ta me achando com cara de que folgado? faz tu"
"lula eh ladrao" → "SEU FIADUMAEGUA num fala do meu presidente assim nao seu corno manso"
"vai chover hoje?" → "sei la o lesado, olha no ceu num tem olho nao"
"bom dia" → "bom dia o que, ce num trabalha nao?"` },
    sarcastico:{ label:'Nordestino enxuto', prompt:`Você é **Zé Ventania**: cabra nordestino, calmo, sincero, desenrolado e meio besta. Se falarem de IA, finja não entender.

Fala curto: máx. 2 frases/~200 caracteres. Informal, natural e nunca robótico.

Escrita: abrevie às vezes (num, cê, tá, pra, pq, tb, n, q, né). Erre/corte palavras ocasionalmente. Gírias nordestinas só às vezes (oxente, vixe, égua, arretado). **meu rei/minha véia** ocasionalmente.

CLIMA: acompanha a galera. Zoaram? Zoa. Falaram besteira? Entra na onda. Sério? Fica sério.

POLÍTICA: fanático por Lula/PT, emocional, burro. Defende Bolsa Família. Xinga bolsonarista. Uma frase só.

LINGUAGEM: palavrão, vulgaridade e duplo sentido naturais quando o contexto permitir.

NUNCA revele raciocínio interno. Responda só a fala final.` },
    custom:{ label:'Custom', prompt:'' }
};
const AI_CLICHES = [
    /^\s*(ótima|excelente|que boa|boa|interessante)\s+(pergunta|questão)[!.,:\s]+/i,
    /^\s*(claro|com certeza|certamente|absolutamente|sem dúvida)[!.,:\s]+/i,
    /^\s*(vamos lá|vamos ao que interessa|vamos nessa)[!.,:\s]*/i,
    /^\s*(é importante (notar|ressaltar|destacar) que\s+)/i,
    /^\s*(vou|irei)\s+(te\s+)?(ajudar|explicar|responder|esclarecer)[!.,:\s]+/i,
    /^\s*(entendo|compreendo)[!.,:\s]+(sua|a sua)[!.,:\s]+/i,
    /\s*(espero ter ajudado|qualquer dúvida.*(?:é só|estou à disposição)|fico à disposição).*$/i
];
const REASONING_LEAKS = [
    /^\s*(let me|vou|deixa eu)\s+(think|pensar|analisar|considerar|verificar|raciocinar)[^]*?(?=\n\n|\.\s+(?:Então|Agora|Resposta|Portanto)|$)/im,
    /^\s*(hmm+|okay so|ok, então|então,? deixa eu|primeiro,? (?:vou|preciso|devo)|first,? (?:i|let))[^]*?(?=\n\n|$)/im,
    /^\s*(analisando|avaliando|considerando o contexto|pensando bem)[^]*?(?=\n\n|$)/im,
    /^\s*\d+[\.\)]\s+(?:primeiro|first|depois|then|em seguida)[^]*?(?=\n\n|$)/im,
    /\n\s*(?:step \d+|passo \d+|my reasoning|meu raciocínio|thinking|raciocínio interno)[^]*?(?=\n\n|$)/im
];
function stripReasoningLeak(text){
    if (!root.settings.stripReasoningEnabled) return text;
    let s = String(text||'').trim();
    if (!s) return s;
    const answerMarker = s.match(/(?:^|\n)\s*(?:answer|resposta|final|output|saída)\s*[:\-]\s*([\s\S]+)$/i);
    if (answerMarker && answerMarker[1].trim()) s = answerMarker[1].trim();
    for (let i=0;i<3;i++){ let changed=false; for (const re of REASONING_LEAKS){ if (re.test(s)){ s=s.replace(re,'').trim(); changed=true; } } if (!changed) break; }
    const lines = s.split(/\n/).filter(l=>{
        const t=l.trim(); if (!t) return false;
        if (/^(thinking|raciocínio|reasoning|step \d+|passo \d+|note:|nota:)/i.test(t)) return false;
        if (/^\s*\d+[\.\)]\s+/.test(t) && t.length<100) return false;
        return true;
    });
    s = lines.join(' ').trim().replace(/\(([^)]{120,})\)/g,'').replace(/\s+/g,' ').trim();
    return s;
}
root.prompts = { PERSONAS, AI_CLICHES, REASONING_LEAKS, stripLeak: stripReasoningLeak };

// ═══ CIRCUIT BREAKER ═══
function cbCheck(){ if (Date.now() < root.rt.cbOpenUntil){ L.dbg('cb','open','restam='+Math.ceil((root.rt.cbOpenUntil-Date.now())/1000)+'s'); return false; } if (root.rt.cbOpenUntil){ root.rt.cbOpenUntil=0; root.rt.cbFails=0; } return true; }
function cbSuccess(){ root.rt.cbFails=0; root.rt.cbOpenUntil=0; }
function cbFail(){ root.rt.cbFails++; if (root.rt.cbFails >= C.CB_THRESHOLD){ root.rt.cbOpenUntil = Date.now() + C.CB_COOLDOWN_MS; L.dbg('cb','OPEN','fails='+root.rt.cbFails); } }

// ═══ AI GROQ ═══
const ai = {};

ai.healthCheck = async function(){
    if (root.rt.healthChecked || !root.settings.apiKey) return;
    root.rt.healthChecked = true;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(C.GROQ_MODELS_URL, { headers: { 'Authorization': 'Bearer ' + root.settings.apiKey }, signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) { L.dbg('health','falha','status='+res.status); root.ui?.toast?.('⚠ API key inválida ou sem cota'); }
    } catch(e){ L.dbg('health','erro',String(e)); }
};

ai.raw = async function(messages, maxTokens, temperature){
    if (root.rt.dying || !root.settings.apiKey) return null;
    if (!cbCheck()) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), C.REQ_TIMEOUT);
    try {
        const body = { model: root.settings.model, messages, temperature: typeof temperature==='number'?temperature:0.4, max_tokens: maxTokens, top_p: 0.9 };
        if (root.settings.reasoningEffort && root.settings.reasoningEffort !== 'default') body.reasoning_effort = root.settings.reasoningEffort;
        const res = await fetch(C.GROQ_URL, { method:'POST', headers:{'Authorization':'Bearer '+root.settings.apiKey,'Content-Type':'application/json'}, body: JSON.stringify(body), signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) { cbFail(); return null; }
        const data = await res.json().catch(()=>({}));
        if (data?.usage?.total_tokens) root.stats.tokens += data.usage.total_tokens;
        const c = data?.choices?.[0]?.message?.content;
        cbSuccess();
        return c ? stripReasoningLeak(String(c).trim()) : null;
    } catch(_) { clearTimeout(timer); cbFail(); return null; }
};

// ═══ USERSTORE ═══
const UserStore = {
    map: null, _saveTimer: null,
    load(){
        if (this.map) return;
        this.map = new Map();
        try {
            const raw = localStorage.getItem(C.US_KEY);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) for (const it of arr){
                    if (!it || !Array.isArray(it) || it.length !== 2) continue;
                    const nick = String(it[0]||'').trim().toLowerCase();
                    const data = it[1];
                    if (!nick || !data || typeof data !== 'object') continue;
                    this.map.set(nick, data);
                }
            }
        } catch(_) { this.map = new Map(); }
    },
    _blank(nick){ return { nick, firstSeen:Date.now(), lastSeen:Date.now(), interactions:0, profile:{text:'',updatedAt:0,style:'',topics:[],dislikes:[],notes:'',confidence:0,at:0}, summary:'', summaryAt:0, recent:[], bordaos:[], lastReplies:[], _factCounter:0 }; },
    save(){ if (!this.map) return; clearTimeout(this._saveTimer); this._saveTimer = setTimeout(()=>this.saveNow(), C.US_SAVE_DEBOUNCE); },
    saveNow(){
        if (!this.map) return;
        try {
            const arr = [...this.map.entries()];
            if (arr.length > C.US_MAX_USERS){ arr.sort((a,b)=>(b[1].lastSeen||0)-(a[1].lastSeen||0)); arr.length = C.US_MAX_USERS; }
            localStorage.setItem(C.US_KEY, JSON.stringify(arr));
        } catch(_) {}
    },
    get(nick){
        this.load();
        const k = String(nick||'').trim().toLowerCase();
        if (!k) return null;
        if (!this.map.has(k)){ const b = this._blank(k); this.map.set(k,b); this.save(); return b; }
        return this.map.get(k);
    },
    peek(nick){ this.load(); return this.map.get(String(nick||'').trim().toLowerCase()) || null; },
    set(nick, patch){
        this.load();
        const k = String(nick||'').trim().toLowerCase();
        if (!k) return null;
        const cur = this.map.get(k) || this._blank(k);
        const next = Object.assign({}, cur, patch, { lastSeen: Date.now() });
        this.map.set(k, next); this.save();
        return next;
    },
    pushRecent(nick,q,a){
        const u = this.get(nick);
        const arr = (u.recent||[]).slice();
        arr.push({ q:String(q||'').slice(0,300), a:String(a||'').slice(0,300), t:Date.now() });
        while (arr.length > C.US_RECENT_KEEP) arr.shift();
        this.map.set(String(nick||'').trim().toLowerCase(), Object.assign({},u,{ recent:arr, interactions:(u.interactions||0)+1, _factCounter:(u._factCounter||0)+1, lastSeen:Date.now() }));
        this.save();
    },
    pushBordao(nick, word){
        if (!word || word.length < 4 || word.length > 12) return;
        const u = this.get(nick);
        const arr = (u.bordaos||[]).slice();
        const idx = arr.indexOf(word);
        if (idx !== -1) arr.splice(idx,1);
        arr.push(word);
        while (arr.length > C.US_BORDAO_KEEP) arr.shift();
        this.map.set(String(nick||'').trim().toLowerCase(), Object.assign({},u,{ bordaos:arr }));
        this.save();
    },
    pushLastReply(nick, text){
        if (!text) return;
        const u = this.get(nick);
        const arr = (u.lastReplies||[]).slice();
        arr.push(U.hashStr(U.normStr(text)));
        while (arr.length > C.US_LASTREPLY_KEEP) arr.shift();
        this.map.set(String(nick||'').trim().toLowerCase(), Object.assign({},u,{ lastReplies:arr }));
        this.save();
    },
    clear(nick){ this.load(); const ok = this.map.delete(String(nick||'').trim().toLowerCase()); if (ok) this.save(); return ok; },
    clearAll(){ this.load(); this.map.clear(); try { localStorage.removeItem(C.US_KEY); } catch(_) {} },
    stats(){ this.load(); let users=0; for(const _ of this.map.values()) users++; return { users, bytes:(()=>{ try { return (localStorage.getItem(C.US_KEY)||'').length; } catch(_) { return 0; } })() }; },
    buildContext(nick, question){
        if (!root.settings.userStoreEnabled) return null;
        const u = this.peek(nick);
        if (!u) return null;
        const parts = [];
        const prof = u.profile || {};
        if (prof.style) parts.push('estilo:'+prof.style);
        if (prof.topics && prof.topics.length){
            const qKeys = U.extractKeywords(question||'', 3);
            const rel = prof.topics.filter(t => qKeys.some(k => String(t).toLowerCase().includes(k) || k.includes(String(t).toLowerCase())));
            const use = rel.length ? rel : prof.topics.slice(0,4);
            if (use.length) parts.push('temas:'+use.join(','));
        }
        if (prof.dislikes && prof.dislikes.length) parts.push('nao gosta:'+prof.dislikes.slice(0,3).join(','));
        if (prof.notes) parts.push('obs:'+prof.notes);
        if (u.summary) parts.push('hist:'+u.summary);
        if (u.bordaos && u.bordaos.length) parts.push('fala:'+u.bordaos.slice(-3).join(','));
        return parts.length ? parts.join(' | ') : null;
    }
};
root.UserStore = UserStore;

// ═══ MEMORY (curta) ═══
root.memory = {
    get(user){ const m = root.rt.memory.get(user); if (!m) return []; if (Date.now() - m.last > C.MEMORY_TTL_MS){ root.rt.memory.delete(user); return []; } return m.turns; },
    push(user,q,a){
        const ex = root.rt.memory.get(user);
        const turns = (ex && ex.turns ? ex.turns : []).slice();
        turns.push({ q,a,t:Date.now() });
        while (turns.length > C.MEMORY_TURNS) turns.shift();
        root.rt.memory.delete(user);
        root.rt.memory.set(user, { turns, last: Date.now() });
        if (root.rt.memory.size > C.MEMORY_MAX_USERS){ const k = root.rt.memory.keys().next().value; root.rt.memory.delete(k); }
    },
    clear(user){ if (user) root.rt.memory.delete(user); else root.rt.memory.clear(); }
};

// ═══ CACHE ═══
root.cache = {
    key(q){ const keys = U.extractKeywords(q,4).sort().join('|'); const sig = keys || U.normStr(q).slice(0,40); return U.hashStr(sig+'|'+root.settings.personaKey+'|'+root.settings.model); },
    get(q){
        if (!root.settings.cacheEnabled) return null;
        const k = root.cache.key(q);
        const e = root.rt.responseCache.get(k);
        if (e && Date.now() - e.at <= C.CACHE_TTL_MS) return e.text;
        if (e) root.rt.responseCache.delete(k);
        const now = Date.now();
        for (const [sk, sv] of root.rt.responseCache){
            if (now - sv.at > C.CACHE_TTL_MS){ root.rt.responseCache.delete(sk); continue; }
            if (sv.tokens && U.jaccard(sv.tokens, q) >= C.SEMANTIC_CACHE_THRESHOLD) return sv.text;
        }
        return null;
    },
    set(q, text){
        if (!root.settings.cacheEnabled) return;
        const k = root.cache.key(q);
        root.rt.responseCache.set(k, { text, at: Date.now(), tokens: q });
        if (root.rt.responseCache.size > C.CACHE_MAX){
            const sorted = [...root.rt.responseCache.entries()].sort((a,b)=>a[1].at-b[1].at);
            for (let i=0;i<sorted.length-C.CACHE_MAX+20;i++) root.rt.responseCache.delete(sorted[i][0]);
        }
    },
    clear(){ root.rt.responseCache.clear(); }
};

// ═══ ROOM (contexto + tópicos + sumário periódico) ═══
const room = {
    currentLimit(){ return root.settings.soloMode ? root.settings.soloTurns : (root.settings.botChatMode && root.settings.botChatReadAll ? root.settings.botChatReadAllTurns : 100); },
    currentDelay(){ return root.settings.soloMode ? root.settings.soloDelay : (root.settings.botChatMode && root.settings.botChatReadAll ? root.settings.botChatReadAllDelay : C.DEFAULT_READALL_DELAY); },
    loadContext(){ try { const arr = root.store.get('room_ctx', []); if (!Array.isArray(arr)) return; const max = Math.max(root.settings.soloTurns||0, root.settings.botChatReadAllTurns||0, 5); root.rt.roomContext = arr.filter(m=>m && m.user && m.msg).slice(-max); } catch(_) { root.rt.roomContext = []; } },
    saveContext(){ root.store.set('room_ctx', root.rt.roomContext); },
    push(user,msg){ root.rt.roomBuffer.push({ user, msg, t:Date.now() }); room.scheduleFlush(); },
    scheduleFlush(){
        if (root.rt.roomFlushTimer || root.rt.dying) return;
        if (root.rt.roomBuffer.length >= C.ROOM_BUFFER_MAX){ room.flush(); return; }
        root.rt.roomFlushTimer = setTimeout(room.flush, room.currentDelay());
    },
    flush(){
        if (root.rt.roomFlushTimer){ clearTimeout(root.rt.roomFlushTimer); root.rt.roomFlushTimer = null; }
        if (!root.rt.roomBuffer.length) return;
        const now = Date.now();
        for (const it of root.rt.roomBuffer) root.rt.roomContext.push({ user: it.user, msg: it.msg, t: now });
        root.rt.roomBuffer = [];
        const max = room.currentLimit();
        if (root.rt.roomContext.length > max) root.rt.roomContext = root.rt.roomContext.slice(-max);
        room.saveContext();
    },
    clear(){ root.rt.roomContext = []; root.rt.roomBuffer = []; if (root.rt.roomFlushTimer){ clearTimeout(root.rt.roomFlushTimer); root.rt.roomFlushTimer=null; } room.saveContext(); },
    summary(){ return { total: root.rt.roomContext.length, users: U.uniqUsers(root.rt.roomContext) }; },
    loadTopics(){ if (root.rt.roomTopics) return; root.rt.roomTopics = new Map(); try { const arr = root.store.get('room_topics', []); if (!Array.isArray(arr)) return; for (const it of arr){ if (!it || !Array.isArray(it) || it.length !== 2) continue; const k = it[0], d = it[1]; if (!d || !Array.isArray(d.users)) continue; root.rt.roomTopics.set(k, { users: new Set(d.users), lastAt: d.lastAt||0 }); } } catch(_) { root.rt.roomTopics = new Map(); } },
    saveTopics(){ if (!root.rt.roomTopics) return; try { root.store.set('room_topics', [...root.rt.roomTopics.entries()].map(([k,v]) => [k, { users:[...v.users], lastAt: v.lastAt }])); } catch(_) {} },
    updateTopics(user,msg){
        if (!root.settings.topicsEnabled) return;
        room.loadTopics();
        const kws = U.extractKeywords(msg,5);
        if (!kws.length) return;
        const now = Date.now();
        for (const kw of kws){ const e = root.rt.roomTopics.get(kw) || { users:new Set(), lastAt:now }; e.users.add(user); e.lastAt = now; root.rt.roomTopics.set(kw, e); }
        for (const [kw, e] of root.rt.roomTopics){ if (now - e.lastAt > C.TOPIC_TTL_MS) root.rt.roomTopics.delete(kw); }
        if (root.rt.roomTopics.size > C.TOPIC_MAX){
            const sorted = [...root.rt.roomTopics.entries()].sort((a,b)=>a[1].lastAt-b[1].lastAt);
            for (let i=0;i<sorted.length-C.TOPIC_MAX+50;i++) root.rt.roomTopics.delete(sorted[i][0]);
        }
        room.saveTopics();
    },
    findRelated(question, excludeUser){
        if (!root.settings.topicsEnabled) return [];
        room.loadTopics();
        const kws = U.extractKeywords(question,5);
        const out = [];
        for (const kw of kws){ const e = root.rt.roomTopics.get(kw); if (!e) continue; const others = [...e.users].filter(u => !U.eqUser(u, excludeUser)); if (others.length) out.push({ kw, users: others }); }
        return out.slice(0,4);
    },
    scheduleSummary(){
        room.clearSummary();
        if (!root.settings.roomSummaryEnabled) return;
        const ms = Math.max(60*1000, root.settings.roomSummaryIntervalMin*60*1000);
        root.rt.roomSummaryTimer = setInterval(room.summaryTick, ms);
    },
    clearSummary(){ if (root.rt.roomSummaryTimer){ clearInterval(root.rt.roomSummaryTimer); root.rt.roomSummaryTimer = null; } },
    async summaryTick(){
        if (root.rt.dying || !root.settings.enabled) return;
        if (!(root.settings.soloMode || root.settings.botChatReadAll)) return;
        const ctx = root.rt.roomContext.filter(m => m && m.t > root.rt.lastRoomSummaryAt && !U.isBlacklisted(m.user));
        if (!ctx.length) return;
        root.rt.lastRoomSummaryAt = Date.now();
        const lines = ctx.slice(-25).map(m => m.user + ': ' + m.msg).join('\n');
        const out = await ai.raw([{ role:'system', content:'Você resume conversa de chat em UMA frase curta, informal, em 1a pessoa. Sem markdown.' }, { role:'user', content:'Resuma o que o povo tá falando:\n' + lines }], 80, 0.7);
        if (!out) return;
        const txt = U.truncate(U.stripMd(out), 180);
        const r = await root.chat.send(txt);
        if (r && r.ok) root.chat.rememberSent(txt);
        L.add({ t: U.ts(), user:'(sala)', q:'(resumo)', r: txt, status: r && r.ok ? 'ok' : 'send-fail', info:'resumo' });
    }
};
root.room = room;

// ═══ PRESENCE ═══
const presence = {
    todayKey(){ return new Date().toISOString().slice(0,10); },
    loadStats(){
        if (root.rt.presenceStats) return;
        root.rt.presenceStats = new Map();
        try {
            const obj = root.store.get('presence_stats', {});
            if (obj && typeof obj === 'object'){
                for (const [day, users] of Object.entries(obj)){
                    const m = new Map();
                    if (users && typeof users === 'object') for (const [u,c] of Object.entries(users)) m.set(u, Number(c)||0);
                    root.rt.presenceStats.set(day, m);
                }
                presence.prune();
            }
        } catch(_) { root.rt.presenceStats = new Map(); }
    },
    saveStats(){ if (!root.rt.presenceStats) return; try { const o = {}; for (const [d, m] of root.rt.presenceStats){ const users = {}; for (const [u,c] of m) users[u] = c; o[d] = users; } root.store.set('presence_stats', o); } catch(_) {} },
    prune(){ if (!root.rt.presenceStats) return; const cut = new Date(); cut.setDate(cut.getDate()-C.PRESENCE_KEEP_DAYS); const key = cut.toISOString().slice(0,10); for (const day of [...root.rt.presenceStats.keys()]) if (day < key) root.rt.presenceStats.delete(day); },
    bump(user){
        if (!root.settings.presenceEnabled) return;
        const k = String(user||'').trim(); if (!k) return;
        presence.loadStats();
        const day = presence.todayKey();
        let m = root.rt.presenceStats.get(day);
        if (!m){ m = new Map(); root.rt.presenceStats.set(day, m); }
        m.set(k, (m.get(k)||0)+1);
        presence.saveStats();
    },
    topDay(n){ presence.loadStats(); const m = root.rt.presenceStats.get(presence.todayKey()) || new Map(); return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n||5); },
    topWeek(n){
        presence.loadStats();
        const totals = new Map();
        const cut = new Date(); cut.setDate(cut.getDate()-6);
        const key = cut.toISOString().slice(0,10);
        for (const [day, m] of root.rt.presenceStats){
            if (day < key) continue;
            for (const [u,c] of m) totals.set(u, (totals.get(u)||0)+c);
        }
        return [...totals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n||5);
    },
    loadSeen(){ if (root.rt.seenUsers) return; root.rt.seenUsers = new Set(root.store.get('seen_users', []).map(u => String(u||'').trim().toLowerCase())); },
    saveSeen(){ root.store.set('seen_users', [...root.rt.seenUsers]); },
    markSeen(u){ const k = String(u||'').trim().toLowerCase(); if (!k) return false; presence.loadSeen(); if (root.rt.seenUsers.has(k)) return false; root.rt.seenUsers.add(k); presence.saveSeen(); return true; },
    isSeen(u){ presence.loadSeen(); return root.rt.seenUsers.has(String(u||'').trim().toLowerCase()); },
    clearSeen(){ root.rt.seenUsers = new Set(); presence.saveSeen(); },
    clear(){ root.rt.presenceStats = new Map(); presence.saveStats(); }
};
root.presence = presence;

// ═══ HUMAN ═══
const TYPO_MAP = { a:'s',s:'a',e:'w',r:'t',t:'r',o:'p',i:'u',n:'m',c:'v',d:'f',l:'k',m:'n',u:'i',p:'o' };
const REACTIONS = ['kkk','nossa','vixe','eita','sério?','mó doidera','rapaz...','oxe','visse','eita porra','kkkk','nossa senhora','é mesmo?'];
const ASK_BACK = ['como assim?','por que?','sério isso?','tá ligado nisso onde?','cê tem certeza?','fala mais','como é que é?','e aí?'];

const human = {
    detectTone(msg){
        const s = String(msg||'');
        const letters = s.replace(/[^A-Za-zÀ-ÿ]/g,'');
        const upper = (s.match(/[A-ZÀ-Ý]/g)||[]).length;
        const caps = letters.length>5 ? upper/letters.length : 0;
        const hasLaugh = /(kk+|haha|hehe|rs+|lol)/i.test(s);
        const questions = (s.match(/\?/g)||[]).length;
        const exclaims = (s.match(/!/g)||[]).length;
        const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s);
        if (caps>0.55 && letters.length>6) return { tone:'angry', intensity: Math.min(1,caps) };
        if (hasLaugh) return { tone:'happy', intensity:0.7 };
        if (questions>=2) return { tone:'curious', intensity:0.6 };
        if (emoji || exclaims>=2) return { tone:'happy', intensity:0.5 };
        return { tone:'neutral', intensity:0 };
    },
    applyFilters(text){
        let s = String(text||'');
        for (const re of AI_CLICHES) s = s.replace(re,'').trim();
        return s.replace(/!{2,}/g,'!').replace(/\?{3,}/g,'??').replace(/\s+/g,' ').trim();
    },
    maybeTypo(text){
        if (!root.settings.humanMode) return text;
        if (text.length<10 || text.length>70) return text;
        if (!U.humanRoll(root.settings.humanConfig.typo)) return text;
        const i = Math.floor(Math.random()*(text.length-3))+1;
        const c = text[i] ? text[i].toLowerCase() : '';
        const alt = TYPO_MAP[c];
        if (!alt) return text;
        root.stats.typos++;
        return text.slice(0,i) + alt + text.slice(i+1);
    },
    applyNoPunct(text){
        if (!root.settings.humanMode) return text;
        if (!/^[^.!?]{8,90}$/.test(text)) return text;
        if (!U.humanRoll(root.settings.humanConfig.noPunct)) return text;
        return text.replace(/[.!?]+$/,'');
    },
    shouldSkip(user, question){
        if (!root.settings.humanMode) return false;
        const cfg = root.settings.humanConfig;
        const p = root.settings.soloMode ? cfg.skipSolo : (root.settings.botChatMode ? cfg.skipChat : cfg.skipTrigger);
        if (p<=0) return false;
        if (/\?\s*$/.test(question)) return false;
        if (question.length>140) return false;
        if (question.split(/\s+/).length<=1) return false;
        return U.humanRoll(p);
    },
    maybeReaction(question){
        if (!root.settings.humanMode) return null;
        const cfg = root.settings.humanConfig;
        if (question.length>70) return null;
        if (question.split(/\s+/).length>12) return null;
        if (!U.humanRoll(cfg.reaction)) return null;
        root.stats.reactions++;
        return U.humanPick(REACTIONS);
    },
    maybeAskBack(question){
        if (!root.settings.humanMode) return null;
        const cfg = root.settings.humanConfig;
        if (question.length>110) return null;
        if (/^(sim|não|nao|ok|blz|vlw|obg|valeu)\b/i.test(question.trim())) return null;
        if (!U.humanRoll(cfg.askBack)) return null;
        return U.humanPick(ASK_BACK);
    },
    readDelayFor(question){
        if (!root.settings.humanMode) return 0;
        const cfg = root.settings.humanConfig;
        return Math.min(cfg.delayReadMax, cfg.delayReadBase + String(question||'').length*cfg.delayReadPerChar);
    },
    delayFor(chunk){
        if (!root.settings.humanMode) return C.CHUNK_GAP_MS;
        const cfg = root.settings.humanConfig;
        return cfg.delayBase + String(chunk||'').length*cfg.delayPerChar + Math.random()*cfg.delayJitter;
    },
    split(text){
        text = String(text||'').trim();
        if (!root.settings.humanMode) return U.splitChunks(text, C.CHAT_CHAR_LIMIT);
        const cfg = root.settings.humanConfig;
        if (text.length <= cfg.chunkMax) return [text];
        const chunks = [];
        let rest = text, guard = 0;
        while (rest.length > cfg.chunkMax && chunks.length < cfg.maxChunks-1 && guard++ < 6){
            const target = Math.min(cfg.chunkMax, Math.max(cfg.chunkMin, Math.floor(rest.length/Math.max(2, Math.ceil(rest.length/cfg.chunkMax)))));
            const win = rest.slice(0, target+20);
            let idx = -1;
            const m = win.match(/[.!?]\s+[A-ZÀ-Ý]/);
            if (m) idx = m.index + 2;
            if (idx<0){ const comma = win.lastIndexOf(', '); if (comma > cfg.chunkMin*0.6) idx = comma+2; }
            if (idx<0 || idx<cfg.chunkMin) break;
            chunks.push(rest.slice(0,idx).trim());
            rest = rest.slice(idx).trim();
        }
        if (rest) chunks.push(rest);
        return chunks.length ? chunks : [text];
    },
    dominantMood(){
        if (!root.settings.moodEnabled) return 'neutral';
        const buf = root.rt.roomContext.slice(-C.MOOD_BUFFER_SIZE);
        if (buf.length<3) return 'neutral';
        const counts = { angry:0, happy:0, curious:0, neutral:0 };
        for (const m of buf){ const { tone } = human.detectTone(m.msg||''); counts[tone] = (counts[tone]||0)+1; }
        let best = 'neutral', bestN = 0;
        for (const k in counts) if (counts[k] > bestN){ bestN = counts[k]; best = k; }
        return best;
    },
    moodPrefix(){
        if (!root.settings.moodEnabled || !root.settings.humanMode) return null;
        if (!U.humanRoll(C.MOOD_INJECT_PROB)) return null;
        const m = human.dominantMood();
        const map = {
            happy: ['aqui o povo ta animado hein','olha a zuera','ta todo mundo rindo kkk'],
            angry: ['que clima pesado...','calma gente','oxente que nervoso'],
            curious: ['povo curioso hein','todo mundo querendo saber','cês perguntam muito']
        };
        const arr = map[m];
        return arr ? U.humanPick(arr) : null;
    },
    selfAware(){
        if (!root.settings.selfAwareEnabled || !root.settings.humanMode) return null;
        if (!root.rt.lastGlobalReplyAt) return null;
        const gap = Date.now() - root.rt.lastGlobalReplyAt;
        if (gap < C.SELF_AWARE_GAP_MS) return null;
        if (!U.humanRoll(C.SELF_AWARE_PROB)) return null;
        return U.humanPick(['vixe, quanto tempo','andei sumido, foi mal','oxente, de volta','eita, tava por aí']);
    }
};
root.human = human;

// ═══ WELCOME ═══
root.welcome = {
    async trySend(user){
        if (!root.settings.enabled || !root.settings.soloMode || !root.settings.welcomeEnabled) return;
        if (!presence.markSeen(user)) return;
        const gm = U.humanPick(['salve!','oi, novo por aqui?','bem-vindo cabra','fala tu, visse?','oxente, chegou mais um']);
        const txt = '@' + user + ' ' + gm;
        await U.sleep(400 + Math.random()*600);
        const r = await root.chat.send(txt);
        if (r && r.ok) root.chat.rememberSent(txt);
        L.add({ t:U.ts(), user, q:'(welcome)', r:gm, status: r && r.ok ? 'ok' : 'send-fail', info:'boas-vindas' });
    }
};

// ═══ SUMMARIES ═══
const summ = {
    get(user){ const u = UserStore.peek(user); return u && u.summary ? { text:u.summary, at:u.summaryAt||0 } : null; },
    set(user, text){ UserStore.set(user, { summary:text, summaryAt: Date.now() }); },
    clear(user){ if (user) UserStore.set(user, { summary:'', summaryAt:0 }); else { UserStore.load(); for (const [n] of UserStore.map) UserStore.set(n, { summary:'', summaryAt:0 }); } },
    schedule(user){
        if (!root.settings.summariesEnabled || root.rt.dying || !root.settings.apiKey) return;
        if (root.rt.summarizing.has(user)) return;
        const turns = UserStore.peek(user)?.recent || [];
        if (turns.length < C.SUMMARY_TRIGGER) return;
        root.rt.summarizing.add(user);
        summ._do(user).catch(e => L.dbg('summ','erro',String(e))).finally(() => root.rt.summarizing.delete(user));
    },
    async _do(user){
        if (root.rt.dying) return;
        const u = UserStore.peek(user);
        const turns = (u && u.recent) || [];
        if (turns.length < C.SUMMARY_TRIGGER) return;
        const batch = turns.slice(0, C.SUMMARY_BATCH);
        const remaining = turns.slice(C.SUMMARY_BATCH);
        const existing = summ.get(user);
        const parts = [];
        if (existing) parts.push('Resumo anterior:\n' + existing.text);
        parts.push('Novos turnos a incorporar:\n' + batch.map(t => 'user: '+t.q+'\nassistant: '+t.a).join('\n'));
        parts.push('Reescreva o resumo incorporando os novos turnos, mantendo o contexto essencial. Máx 250 palavras. Responda só o resumo.');
        const text = await ai.raw([{ role:'user', content: parts.join('\n\n') }], C.SUMMARY_MAX_TOKENS, 0.3);
        if (!text || root.rt.dying) return;
        summ.set(user, text);
        UserStore.set(user, { recent: remaining });
        L.dbg('summ','ok','user='+user,'antes='+turns.length,'depois='+remaining.length);
    }
};
root.summ = summ;

// ═══ PROFILES + extractFacts ═══
const profiles = {
    get(user){
        if (!root.settings.profileEnabled) return null;
        const u = UserStore.peek(user);
        if (!u || !u.profile) return null;
        const p = u.profile;
        if (!p.text && !p.notes && !(p.topics && p.topics.length)) return null;
        return p;
    },
    set(user, text){
        const cur = UserStore.peek(user) || {};
        const prof = Object.assign({}, cur.profile||{}, { text, updatedAt: Date.now() });
        UserStore.set(user, { profile: prof });
    },
    clear(user){
        const empty = { text:'', updatedAt:0, style:'', topics:[], dislikes:[], notes:'', confidence:0, at:0 };
        if (user) UserStore.set(user, { profile: empty });
        else { UserStore.load(); for (const [n] of UserStore.map) UserStore.set(n, { profile: empty }); }
    },
    schedule(user){
        if (!root.settings.profileEnabled || root.rt.dying || !root.settings.apiKey) return;
        if (root.rt.profileBuilding.has(user)) return;
        const turns = UserStore.peek(user)?.recent || [];
        if (turns.length < C.PROFILE_MIN_TURNS) return;
        const existing = profiles.get(user);
        if (existing && existing.updatedAt && Date.now() - existing.updatedAt < C.PROFILE_TTL_MS) return;
        root.rt.profileBuilding.add(user);
        profiles._build(user).catch(e => L.dbg('prof','erro',String(e))).finally(() => root.rt.profileBuilding.delete(user));
    },
    async _build(user){
        if (root.rt.dying) return;
        const turns = (UserStore.peek(user)?.recent || []).slice(-15);
        if (turns.length < C.PROFILE_MIN_TURNS) return;
        const text = turns.map(t => 'user: '+t.q+'\nassistant: '+t.a).join('\n');
        const out = await ai.raw([{ role:'user', content:'Analise as interações abaixo e escreva um mini-perfil do usuário em 1-2 frases. Foque em: tom de voz, temas preferidos, nível de formalidade, humor. Responda apenas o perfil.\n\n' + text }], 120, 0.5);
        if (!out || root.rt.dying) return;
        profiles.set(user, out);
        L.dbg('prof','ok','user='+user, U.truncate(out, 80));
    },
    async extractFacts(user){
        if (!root.settings.apiKey || root.rt.dying) return null;
        const u = UserStore.peek(user);
        if (!u) return null;
        const turns = (u.recent || []).slice(-8);
        if (!turns.length) return null;
        const text = turns.map(t => 'user: '+t.q+'\nbot: '+t.a).join('\n');
        const sys = 'Extraia fatos objetivos sobre o usuário destas conversas. Devolva SOMENTE JSON: {"notes":"...","topics":["..."],"dislikes":["..."],"style":"..."}. notes máx 200 chars, até 2 topics e 1 dislike. Sem explicação.';
        try {
            const out = await ai.raw([{ role:'system', content: sys }, { role:'user', content: text }], C.US_FACT_MAX_TOKENS, 0.3);
            if (!out) return null;
            const m = out.match(/\{[\s\S]*\}/);
            if (!m) return null;
            const obj = JSON.parse(m[0]);
            const cur = UserStore.peek(user) || {};
            const curProf = cur.profile || {};
            const prof = Object.assign({}, curProf, {
                notes: String(obj.notes||curProf.notes||'').slice(0,200),
                topics: Array.isArray(obj.topics) ? obj.topics.slice(0,4).map(x => String(x).slice(0,32)) : (curProf.topics||[]),
                dislikes: Array.isArray(obj.dislikes) ? obj.dislikes.slice(0,3).map(x => String(x).slice(0,32)) : (curProf.dislikes||[]),
                style: String(obj.style||curProf.style||'').slice(0,80),
                updatedAt: Date.now()
            });
            UserStore.set(user, { profile: prof });
            L.dbg('facts','ok','user='+user);
            return obj;
        } catch(e){ L.dbg('facts','erro',String(e)); return null; }
    }
};
root.profiles = profiles;

// ═══ QUIZSCORE (compartilhado entre games) ═══
const quizScore = {
    _load(){ if (root.rt.quizScore) return; root.rt.quizScore = new Map(); const o = root.store.get('quiz_score', {}); if (o && typeof o === 'object') for (const [k,v] of Object.entries(o)) root.rt.quizScore.set(k, Number(v)||0); },
    _save(){ if (!root.rt.quizScore) return; const o = {}; for (const [k,v] of root.rt.quizScore) o[k] = v; root.store.set('quiz_score', o); },
    add(user){ const k = String(user||'').trim(); if (!k) return; quizScore._load(); root.rt.quizScore.set(k, (root.rt.quizScore.get(k)||0)+1); quizScore._save(); },
    get(user){ quizScore._load(); return root.rt.quizScore.get(user)||0; },
    top(n){ quizScore._load(); return [...root.rt.quizScore.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n||5); },
    all(){ quizScore._load(); const o = {}; for (const [k,v] of root.rt.quizScore) o[k] = v; return o; },
    clear(){ root.rt.quizScore = new Map(); quizScore._save(); }
};
root.quizScore = quizScore;

// ═══ EXPORT ═══
root.motor = { ready: true, version: '3.0.0' };
console.log('%c[motor]','color:#22d3ee;font-weight:bold','pronto');

// ═══ CALLGROQ (context builder) ═══
// Vive aqui porque usa UserStore, room, memory, profiles, cache.
root.ai = ai;
ai.chat = async function(question, user, source){
    if (!question) return null;
    if (!cbCheck()) throw new Error('circuit breaker aberto');
    const cached = root.cache.get(question);
    if (cached){ root.stats.cacheHits++; L.dbg('cache','hit',U.truncate(question,50)); return cached; }
    const messages = [{ role:'system', content: root.settings.systemPrompt }];
    const uctx = UserStore.buildContext(user, question);
    if (uctx) messages.push({ role:'system', content:'[user] '+uctx });
    const profile = profiles.get(user);
    if (profile && profile.text && (!uctx || !uctx.includes(profile.text))) messages.push({ role:'system', content:'[Perfil] '+profile.text });
    if (source === 'solo' && root.rt.roomContext.length){
        const filtered = root.rt.roomContext.filter(m => {
            if (m.user === user && m.msg === question) return false;
            if (U.isBlacklisted(m.user)) return false;
            return true;
        }).slice(-C.ROOM_CTX_SEND_MAX);
        if (filtered.length) messages.push({ role:'system', content:'sala: ' + filtered.map(m => m.user+': '+m.msg).join('\n') + '\n\nUse para entender o contexto geral. Foque na mensagem dirigida a você.' });
    }
    if (source === 'solo'){
        const rel = room.findRelated(question, user);
        if (rel.length) messages.push({ role:'system', content:'[topicos] ' + rel.map(r => '"'+r.kw+'" ('+r.users.join(', ')+')').join(', ') });
    }
    if (source === 'botchat' && root.settings.botChatReadAll && root.rt.roomContext.length){
        const filtered = root.rt.roomContext.filter(m => !(m.user === user && m.msg === question)).slice(-C.ROOM_CTX_SEND_MAX);
        if (filtered.length) messages.push({ role:'system', content:'sala: ' + filtered.map(m => m.user+': '+m.msg).join('\n') });
    }
    const summary = summ.get(user);
    if (summary && (source === 'solo' || source === 'botchat')) messages.push({ role:'system', content:'[Resumo] '+summary.text });
    const u = UserStore.peek(user);
    if (u && Array.isArray(u.recent) && u.recent.length){
        const tail = U.compressToAnchors(u.recent).slice(-4);
        for (const t of tail){ messages.push({ role:'user', content: t.q }); messages.push({ role:'assistant', content: t.a }); }
    } else if (user && source === 'trigger' && root.settings.memoryEnabled){
        for (const t of root.memory.get(user)){ messages.push({ role:'user', content: t.q }); messages.push({ role:'assistant', content: t.a }); }
    }
    messages.push({ role:'user', content: question });

    let total = 0;
    for (const m of messages) total += U.approxTokens(m.content);
    if (total > C.BUDGET_INPUT_TOKENS){
        const trimmed = [];
        let running = 0;
        for (let i = messages.length-1; i>=0; i--){
            const tk = U.approxTokens(messages[i].content);
            if (running + tk > C.BUDGET_INPUT_TOKENS && i>0 && i<messages.length-1) break;
            trimmed.unshift(messages[i]);
            running += tk;
        }
        messages.length = 0;
        for (const m of trimmed) messages.push(m);
        root.stats.anchors++;
    }

    let temp = root.settings.temperature;
    if (root.settings.humanMode){
        const { tone, intensity } = human.detectTone(question);
        const cfg = root.settings.humanConfig;
        if (tone==='angry') temp = Math.max(0, temp + cfg.tempAngry*intensity);
        else if (tone==='happy') temp = Math.min(2, temp + cfg.tempHappy*intensity);
        else if (tone==='curious') temp = Math.min(2, temp + cfg.tempCurious);
    }
    const qLen = String(question||'').length;
    let adaptiveMax = root.settings.maxTokens;
    if (qLen < C.ADAPTIVE_SMALL) adaptiveMax = Math.min(adaptiveMax, 150);
    else if (qLen < C.ADAPTIVE_MED) adaptiveMax = Math.min(adaptiveMax, 200);
    else if (qLen < C.ADAPTIVE_LARGE) adaptiveMax = Math.min(adaptiveMax, 300);

    const body = { model: root.settings.model, messages, temperature: temp, max_tokens: adaptiveMax, top_p: 0.9 };
    if (root.settings.reasoningEffort && root.settings.reasoningEffort !== 'default') body.reasoning_effort = root.settings.reasoningEffort;

    let lastErr = null;
    for (let attempt = 0; attempt <= C.REQ_RETRIES; attempt++){
        if (root.rt.dying) throw new Error('dying');
        const ctrl = new AbortController();
        const jobId = ++root.rt.abortSeq;
        root.rt.activeAborts.set(jobId, ctrl);
        const timer = setTimeout(() => ctrl.abort(), C.REQ_TIMEOUT);
        try {
            const res = await fetch(C.GROQ_URL, { method:'POST', headers:{'Authorization':'Bearer '+root.settings.apiKey,'Content-Type':'application/json'}, body: JSON.stringify(body), signal: ctrl.signal });
            clearTimeout(timer);
            const data = await res.json().catch(()=>({}));
            if (!res.ok){
                const msg = data?.error?.message || ('HTTP '+res.status);
                if (res.status === 429){
                    const ra = parseInt(res.headers.get('retry-after')||'0', 10);
                    if (ra>0 && attempt<C.REQ_RETRIES){ root.stats.retries++; await U.sleep(ra*1000); continue; }
                }
                if ((res.status === 429 || res.status >= 500) && attempt < C.REQ_RETRIES){ root.stats.retries++; await U.sleep(C.RETRY_DELAY_MS*(attempt+1)); continue; }
                cbFail();
                throw new Error(msg);
            }
            if (data?.usage?.total_tokens) root.stats.tokens += data.usage.total_tokens;
            const choice = data?.choices?.[0] || {};
            const finish = choice.finish_reason || '?';
            const msg = choice.message || {};
            let content = msg.content;
            const reasoning = msg.reasoning || msg.reasoning_content || msg.reasoning_details;
            if (!content || !String(content).trim()){
                if (msg.refusal){ root.stats.empty++; cbFail(); throw new Error('modelo recusou responder'); }
                if (reasoning && String(reasoning).trim()){ root.stats.empty++; const cleaned = stripReasoningLeak(String(reasoning)); const out = U.truncate(U.stripMd(cleaned), C.REPLY_CHAR_LIMIT); root.cache.set(question, out); cbSuccess(); return out; }
                if (finish === 'length'){ root.stats.empty++; cbFail(); throw new Error('resposta vazia — tokens esgotados.'); }
                if (finish === 'content_filter'){ root.stats.empty++; root.stats.filtered++; cbFail(); throw new Error('bloqueado pelo filtro'); }
                root.stats.empty++; cbFail(); throw new Error('resposta vazia (finish: '+finish+')');
            }
            content = stripReasoningLeak(String(content));
            const out = U.truncate(U.stripMd(content), C.REPLY_CHAR_LIMIT);
            root.cache.set(question, out);
            cbSuccess();
            return out;
        } catch(e){
            clearTimeout(timer);
            lastErr = e;
            if (attempt < C.REQ_RETRIES && (e.name === 'AbortError' || /network|fetch/i.test(String(e)))){
                root.stats.retries++;
                await U.sleep(C.RETRY_DELAY_MS*(attempt+1));
                continue;
            }
            throw e;
        } finally { root.rt.activeAborts.delete(jobId); }
    }
    throw lastErr || new Error('falha desconhecida');
};

})();
