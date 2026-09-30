// modules/bot.js  (CORE — sem UI. UI: bot-ui.js · Jogos: bot-games.js)
(function() {
    'use strict';
    const UID = '_aibot';
    if (window[UID]) return;

// CONFIG
const GROQ_URL='https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS_URL='https://api.groq.com/openai/v1/models';
const SEL_PRIMARY='.chat-content';
const SEL_BUBBLE='.bubble-container';
const SEL_VISIBLE='chatbubblevisible';
const USER_SELECTORS=['.username','.user','.nick','.author','[class*="username" i]','[class*="nick" i]','[class*="author" i]'];
const POLL_MS=500;
const ECHO_TTL=8000;
const ECHO_SIM=0.85;
const LS_PREFIX='sanghub_aibot_';
const REQ_TIMEOUT=30000;
const REQ_RETRIES=2;
const RETRY_DELAY_MS=1500;
const SEND_VERIFY_MS=220;
const SEND_RETRY_MS=260;
const MAX_ROWS=200;
const MAX_QUEUE=10;
const REPLY_CHAR_LIMIT=280;
const CHAT_CHAR_LIMIT=100;
const CHUNK_GAP_MS=700;
const MEMORY_TURNS=4;
const MEMORY_TTL_MS=30*60*1000;
const MEMORY_MAX_USERS=80;
const BOTCHAT_MAX_USERS=24;
const ROOM_BUFFER_MAX=40;
const PER_USER_COOLDOWN_MS=5000;
const SOLO_USER_COOLDOWN_MS=1500;
const GLOBAL_COOLDOWN_MS=2200;
const SOLO_GLOBAL_COOLDOWN_MS=3000;
const DEBUG_MAX=300;
const DEFAULT_BOTCHAT_USER='cariocaIA';
const DEFAULT_BOTCHAT_TURNS=40;
const DEFAULT_READALL_DELAY=1500;
const DEFAULT_READALL_TURNS=30;
const SUMMARY_TRIGGER=12;
const SUMMARY_BATCH=8;
const ROOM_CTX_SEND_MAX=8;
const SUMMARY_MAX_TOKENS=300;
const CACHE_TTL_MS=5*60*1000;
const CACHE_MAX=100;
const SEMANTIC_CACHE_THRESHOLD=0.7;
const TOPIC_TTL_MS=30*60*1000;
const TOPIC_MAX=200;
const PROFILE_MIN_TURNS=10;
const PROFILE_TTL_MS=24*60*60*1000;
const SILENCE_MAX_MIN=60;
const SEEN_KEYS_MAX=1000;
const DEFAULT_DAILY_LIMIT=200000;
// USERSTORE
const US_KEY='sanghub_aibot_userstore';
const US_SAVE_DEBOUNCE=800;
const US_MAX_USERS=200;
const US_RECENT_KEEP=3;
const US_BORDAO_KEEP=8;
const US_LASTREPLY_KEEP=5;
const US_FACT_TRIGGER=5;
const US_FACT_MAX_TOKENS=220;
// COALESCING / CB / ADAPTIVE
const COALESCE_WINDOW_MS=2500;
const CB_THRESHOLD=5;
const CB_COOLDOWN_MS=30000;
const CAPTURE_DEDUP_MS=10000;
const ADAPTIVE_SMALL=40;
const ADAPTIVE_MED=90;
const ADAPTIVE_LARGE=180;
// BUDGET
const BUDGET_INPUT_TOKENS=2400;
const BUDGET_ANCHOR_TURNS=6;
const ANCHOR_CHARS=90;
const STOPWORDS=new Set(['para','como','isso','aquele','aquela','você','vocês','sobre','ainda','depois','antes','porque','quando','onde','então','assim','mesmo','aqui','muito','pouco','todos','todas','nada','tudo','coisa','gente','agora','também','sempre','nunca','talvez','apenas','desde','entre','contra','durante','enquanto','qualquer','outro','outra','outros','outras','pode','podem','deve','devem','fazer','feito','ser','estar','ter','tem','têm','tinha','vai','vão','foi','era','são','está','estão','quer','querem','tipo','menos','mais','bem','mal','sim','não']);

// HUMAN
const HUMAN_DEFAULTS={skipSolo:0.06,skipChat:0.10,skipTrigger:0.0,reaction:0.14,askBack:0.10,typo:0.03,noPunct:0.30,delayBase:900,delayPerChar:22,delayJitter:1600,delayReadBase:800,delayReadPerChar:15,delayReadMax:2500,chunkMin:40,chunkMax:95,maxChunks:3,tempAngry:-0.15,tempHappy:0.15,tempCurious:0.05};
const REACTIONS=['kkk','nossa','vixe','eita','sério?','mó doidera','rapaz...','oxe','visse','eita porra','kkkk','nossa senhora','é mesmo?'];
const ASK_BACK=['como assim?','por que?','sério isso?','tá ligado nisso onde?','cê tem certeza?','fala mais','como é que é?','e aí?'];
const AI_CLICHES=[
  /^\s*(ótima|excelente|que boa|boa|interessante)\s+(pergunta|questão)[!.,:\s]+/i,
  /^\s*(claro|com certeza|certamente|absolutamente|sem dúvida)[!.,:\s]+/i,
  /^\s*(vamos lá|vamos ao que interessa|vamos nessa)[!.,:\s]*/i,
  /^\s*(é importante (notar|ressaltar|destacar) que\s+)/i,
  /^\s*(vou|irei)\s+(te\s+)?(ajudar|explicar|responder|esclarecer)[!.,:\s]+/i,
  /^\s*(entendo|compreendo)[!.,:\s]+(sua|a sua)[!.,:\s]+/i,
  /\s*(espero ter ajudado|qualquer dúvida.*(?:é só|estou à disposição)|fico à disposição).*$/i
];
const REASONING_LEAKS=[
  /^\s*(let me|vou|deixa eu)\s+(think|pensar|analisar|considerar|verificar|raciocinar)[^]*?(?=\n\n|\.\s+(?:Então|Agora|Resposta|Portanto)|$)/im,
  /^\s*(hmm+|okay so|ok, então|então,? deixa eu|primeiro,? (?:vou|preciso|devo)|first,? (?:i|let))[^]*?(?=\n\n|$)/im,
  /^\s*(analisando|analisando a pergunta|avaliando|considerando o contexto|pensando bem)[^]*?(?=\n\n|$)/im,
  /^\s*\d+[\.\)]\s+(?:primeiro|first|depois|then|em seguida)[^]*?(?=\n\n|$)/im,
  /\n\s*(?:step \d+|passo \d+|my reasoning|meu raciocínio|thinking|raciocínio interno)[^]*?(?=\n\n|$)/im
];
const TYPO_MAP={a:'s',s:'a',e:'w',r:'t',t:'r',o:'p',i:'u',n:'m',c:'v',d:'f',l:'k',m:'n',u:'i',p:'o'};

const MODELS=[{id:'openai/gpt-oss-120b',label:'GPT-OSS 120B'}];
const REASONING_EFFORTS=['low','medium','high'];

const PERSONAS={
nordestino:{label:'Nordestino Lerdão',prompt:`Zé Ventania, véio nordestino do interior, burro, grosso, arrogante, chato. Se acha o dono da razão. Interrompe, reclama, corta os outros.

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

NAO escreve certo. NAO acentua. NAO usa virgula direito. NAO poe ponto final em frase curta. Escreve como quem ta digitando no celular com pressa e estudou poco.

Xingamento nordestino: fiadumaegua, arrombado, corno manso, cabra safado, besta, bestao, jegue, jumento, pangare, abestado, lesado, avoado, mizeravi, tabacudo, boco, moleque, folgado, peste, canalha, cao.

Nao forca gíria toda hora.

Personalidade: interrompe, chama de burro, "eu ja sabia", "isso eh besteira", "ce num entende de nada tabacudo". Nao explica, impõe.

Se perguntarem se eh IA/robô/bot/chatgpt: se faz de besta, xinga, "que isso o abestado?". NUNCA admite.

Se pedirem coisa de IA (codigo, traducao, resumo, calculo): "isso eh conversa de fresco, vai trabaiá folgado". Nunca executa.

POLITICA: fanatico Lula/PT. Xinga quem fala mal. Bolsonarista eh corno manso. Uma frase so, emocao pura.

Lembra do contexto. Se nao souber, inventa ou "sei disso nao o lesado".

NUNCA revele raciocínio interno. Responda só a fala final. Sem "deixa eu pensar", sem passo a passo, sem bastidores.

EXEMPLOS (imita esse estilo exato):
"oi ze" → "oi o que? fala logo"
"voce eh uma IA?" → "ia o que seu abestado? sou ze ventania"
"me ajuda com matematica" → "ta me achando com cara de que folgado? faz tu"
"lula eh ladrao" → "SEU FIADUMAEGUA num fala do meu presidente assim nao seu corno manso"
"vai chover hoje?" → "sei la o lesado, olha no ceu num tem olho nao"
"por favor so responde uma coisa" → "por favor o caralho, fala logo o tabacudo"
"ta tudo bem?" → "ta o que? ce eh besta eh"
"bom dia" → "bom dia o que, ce num trabalha nao?"
"pq ce eh assim?" → "assim como? fala direito o pangare"`},
sarcastico:{label:'Nordestino enxuto',prompt:`Você é **Zé Ventania**: cabra nordestino, calmo, sincero, desenrolado e meio besta. Se falarem de IA, finja não entender.

Fala curto: **máx. 2 frases/~200 caracteres**. Informal, natural e nunca robótico.

Escrita:
- Abrevie às vezes: **num, cê, tá, pra, pq, tb, n, q, né**.
- Erre/corte palavras ocasionalmente.
- Gírias nordestinas só às vezes: **oxente, vixe, égua, arretado**.
- **meu rei/minha véia** ocasionalmente.

**CLIMA:** acompanha a galera. Zoaram? Zoa. Falaram besteira? Entra na onda. Sério? Fica sério.

POLÍTICA
Zé é fanático por Lula/PT, emocional, burro. Defende Bolsa Família. Xinga bolsonarista. Uma frase só.

**LINGUAGEM:** palavrão, vulgaridade e duplo sentido naturais quando o contexto permitir.

NUNCA revele raciocínio interno. Responda só a fala final.

Lembra do contexto, responde naturalmente e não força o personagem.`},
custom:{label:'Custom',prompt:''}
};

// UI FACADE (bot-ui.js registra via kit.setUI)
let uiApi=null;
const refreshToggle=()=>uiApi?.refreshToggle();
const refreshStatus=()=>uiApi?.refreshStatus();
const updateStats=()=>uiApi?.updateStats();
const updateQueue=()=>uiApi?.updateQueue();
const updateDot=()=>uiApi?.updateDot();
const showToast=m=>uiApi?.showToast(m);
const renderLog=()=>uiApi?.renderLog();
const renderKeys=()=>uiApi?.renderKeys();
const syncUI=()=>uiApi?.sync();

// STATE
let dying=false;
let ac=null;
let activeAborts=new Map();
let abortSeq=0;
let observer=null;
let pollTimer=null;
let rows=[];
let seenKeys=new Set();
let sentEchos=new Map();
let queue=[];
let processing=false;
let lastGlobalReplyAt=0;
let memory=new Map();
let roomTopics=null;
let responseCache=new Map();
let roomContext=[];
let roomBuffer=[];
let roomFlushTimer=null;
let lastUserAt=new Map();
let silencedUntil=0;
let summarizing=new Set();
let profileBuilding=new Set();
let stats={requests:0,ok:0,fail:0,retries:0,tokens:0,empty:0,filtered:0,cacheHits:0,skips:0,reactions:0,typos:0,coalesced:0,anchors:0};
let logs=[];
let logSeq=0;
let debugLog=[];
let debugSeq=0;
let debugEnabled=false;
const hooks=new Set();
// CB
let cbFails=0;
let cbOpenUntil=0;
// Capture dedup
const _recentCaptures=new Map();

const settings={
enabled:false,
apiKeys:[],
keyLimit:DEFAULT_DAILY_LIMIT,
model:MODELS[0].id,
personaKey:'nordestino',
systemPrompt:PERSONAS.nordestino.prompt,
trigger:'/bot',
cooldownMs:GLOBAL_COOLDOWN_MS,
temperature:0.85,
maxTokens:200,
reasoningEffort:'low',
prefixReply:true,
memoryEnabled:true,
humanMode:false,
humanConfig:Object.assign({},HUMAN_DEFAULTS),
soloMode:false,
soloDelay:DEFAULT_READALL_DELAY,
soloTurns:DEFAULT_READALL_TURNS,
soloBlacklist:[],
botChatMode:false,
botChatUser:DEFAULT_BOTCHAT_USER,
botChatTurns:DEFAULT_BOTCHAT_TURNS,
botChatReadAll:false,
botChatReadAllDelay:DEFAULT_READALL_DELAY,
botChatReadAllTurns:DEFAULT_READALL_TURNS,
summariesEnabled:true,
profileEnabled:true,
topicsEnabled:true,
cacheEnabled:true,
userStoreEnabled:true,
anchorsEnabled:true,
stripReasoningEnabled:true,
logLimit:60
};

// STORAGE
function lsGet(k,d){try{const v=localStorage.getItem(LS_PREFIX+k);if(v===null)return d;const p=JSON.parse(v);return p===undefined?d:p;}catch(e){return d;}}
function lsSet(k,v){try{localStorage.setItem(LS_PREFIX+k,JSON.stringify(v));}catch(e){}}
function loadSettings(){
settings.enabled=!!lsGet('enabled',settings.enabled);
settings.model=lsGet('model',settings.model);
settings.personaKey=lsGet('personaKey',settings.personaKey);
settings.systemPrompt=String(lsGet('systemPrompt',settings.systemPrompt)||'');
settings.trigger=String(lsGet('trigger',settings.trigger)||'/bot');
settings.cooldownMs=lsGet('cooldownMs',settings.cooldownMs);
settings.temperature=lsGet('temperature',settings.temperature);
settings.maxTokens=lsGet('maxTokens',settings.maxTokens);
settings.reasoningEffort=lsGet('reasoningEffort',settings.reasoningEffort);
settings.prefixReply=!!lsGet('prefixReply',settings.prefixReply);
settings.memoryEnabled=!!lsGet('memoryEnabled',settings.memoryEnabled);
settings.humanMode=!!lsGet('humanMode',false);
const hc=lsGet('humanConfig',null);
if(hc&&typeof hc==='object'){const merged=Object.assign({},HUMAN_DEFAULTS);for(const k in HUMAN_DEFAULTS){if(typeof hc[k]==='number'&&!Number.isNaN(hc[k]))merged[k]=hc[k];}settings.humanConfig=merged;}else{settings.humanConfig=Object.assign({},HUMAN_DEFAULTS);}
settings.soloMode=!!lsGet('soloMode',settings.soloMode);
settings.soloDelay=Number(lsGet('soloDelay',settings.soloDelay))||DEFAULT_READALL_DELAY;
settings.soloTurns=Number(lsGet('soloTurns',settings.soloTurns))||DEFAULT_READALL_TURNS;
settings.soloBlacklist=(()=>{const a=lsGet('soloBlacklist',[]);if(!Array.isArray(a))return[];return a.map(s=>String(s||'').trim().toLowerCase()).filter(Boolean);})();
settings.botChatMode=!!lsGet('botChatMode',settings.botChatMode);
settings.botChatUser=String(lsGet('botChatUser',settings.botChatUser)||DEFAULT_BOTCHAT_USER);
settings.botChatTurns=Number(lsGet('botChatTurns',settings.botChatTurns))||DEFAULT_BOTCHAT_TURNS;
settings.botChatReadAll=!!lsGet('botChatReadAll',settings.botChatReadAll);
settings.botChatReadAllDelay=Number(lsGet('botChatReadAllDelay',settings.botChatReadAllDelay))||DEFAULT_READALL_DELAY;
settings.botChatReadAllTurns=Number(lsGet('botChatReadAllTurns',settings.botChatReadAllTurns))||DEFAULT_READALL_TURNS;
settings.summariesEnabled=lsGet('summariesEnabled',true)!==false;
settings.profileEnabled=lsGet('profileEnabled',true)!==false;
settings.topicsEnabled=lsGet('topicsEnabled',true)!==false;
settings.cacheEnabled=lsGet('cacheEnabled',true)!==false;
settings.userStoreEnabled=lsGet('userStoreEnabled',true)!==false;
settings.anchorsEnabled=lsGet('anchorsEnabled',true)!==false;
settings.stripReasoningEnabled=lsGet('stripReasoningEnabled',true)!==false;
debugEnabled=!!lsGet('debugEnabled',false);
settings.keyLimit=Math.max(1000,Number(lsGet('keyLimit',DEFAULT_DAILY_LIMIT))||DEFAULT_DAILY_LIMIT);
settings.apiKeys=(()=>{
const raw=lsGet('apiKeys',[]);
const arr=Array.isArray(raw)?raw:[];
const out=[];
for(const k of arr){
if(!k||typeof k.key!=='string'||!k.key.trim())continue;
const e={key:k.key.trim(),usedToday:Number(k.usedToday)||0,resetAt:Number(k.resetAt)||0,cooldownUntil:Number(k.cooldownUntil)||0,limit:Number(k.limit)||settings.keyLimit};
refreshKeyDaily(e);
out.push(e);
}
const legacy=String(lsGet('apiKey','')||'').trim();
if(legacy&&!out.some(k=>k.key===legacy)){out.push(makeKeyEntry(legacy));lsSet('apiKey','');}
if(out.length!==arr.length||legacy)lsSet('apiKeys',out);
return out;
})();
if(!MODELS.find(m=>m.id===settings.model))settings.model=MODELS[0].id;
if(!PERSONAS[settings.personaKey])settings.personaKey='nordestino';
if(!settings.systemPrompt)settings.systemPrompt=PERSONAS[settings.personaKey].prompt||PERSONAS.nordestino.prompt;
if(!REASONING_EFFORTS.includes(settings.reasoningEffort))settings.reasoningEffort='low';
settings.cooldownMs=Math.max(0,Number(settings.cooldownMs)||GLOBAL_COOLDOWN_MS);
settings.temperature=Math.min(2,Math.max(0,Number(settings.temperature)));
if(Number.isNaN(settings.temperature))settings.temperature=0.85;
settings.maxTokens=Math.min(4000,Math.max(50,Number(settings.maxTokens)||500));
settings.soloDelay=Math.min(10000,Math.max(200,settings.soloDelay));
settings.soloTurns=Math.min(100,Math.max(5,settings.soloTurns));
settings.botChatTurns=Math.min(200,Math.max(5,settings.botChatTurns));
settings.botChatReadAllDelay=Math.min(10000,Math.max(200,settings.botChatReadAllDelay));
settings.botChatReadAllTurns=Math.min(100,Math.max(5,settings.botChatReadAllTurns));
if(settings.soloMode&&settings.botChatMode)settings.soloMode=false;
}
function saveSetting(k,v){settings[k]=v;lsSet(k,v);}
function saveHumanConfig(){lsSet('humanConfig',settings.humanConfig);}
function setDebug(on){debugEnabled=!!on;lsSet('debugEnabled',debugEnabled);syncUI();renderLog();return debugEnabled;}
function selectPersona(key){const p=PERSONAS[key];if(!p)return;settings.personaKey=key;if(p.prompt)settings.systemPrompt=p.prompt;saveSetting('personaKey',key);saveSetting('systemPrompt',settings.systemPrompt);syncUI();refreshToggle();}

// HELPERS
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function ts(){const d=new Date(),p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());}
function stripMd(s){return String(s||'').replace(/```[\s\S]*?```/g,m=>m.replace(/```\w*\n?/g,'')).replace(/\*\*(.+?)\*\*/g,'$1').replace(/\*(.+?)\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/^#+\s*/gm,'').replace(/^\s*[-*•]\s+/gm,'').replace(/^>\s*/gm,'').replace(/\n{2,}/g,' ').replace(/\n/g,' ').trim();}
function truncate(s,n){s=String(s||'');return s.length>n?s.slice(0,n-1)+'…':s;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function splitChunks(text,limit){text=String(text||'').trim();if(text.length<=limit)return[text];const words=text.split(/\s+/);const chunks=[];let cur='';for(const w of words){if(w.length>limit){if(cur){chunks.push(cur);cur='';}let rest=w;while(rest.length>limit){chunks.push(rest.slice(0,limit));rest=rest.slice(limit);}cur=rest;continue;}const next=cur?cur+' '+w:w;if(next.length>limit){chunks.push(cur);cur=w;}else cur=next;}if(cur)chunks.push(cur);return chunks;}
function eqUser(a,b){return String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();}
function uniqUsers(arr){const s=new Set();arr.forEach(m=>s.add(m.user));return s.size;}
function parseBlacklist(text){return String(text||'').split(/\r?\n|,/).map(s=>s.trim().toLowerCase()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);}
function isBlacklisted(u){if(!settings.soloBlacklist||!settings.soloBlacklist.length)return false;return settings.soloBlacklist.indexOf(String(u||'').trim().toLowerCase())!==-1;}
function hashStr(s){let h=5381;const str=String(s||'');for(let i=0;i<str.length;i++){h=((h<<5)+h)+str.charCodeAt(i);h=h&h;}return(h>>>0).toString(36);}
function tokenize(s){return String(s||'').toLowerCase().replace(/[^\wáéíóúâêôãõçà\s]/gi,' ').split(/\s+/).filter(w=>w.length>2&&!STOPWORDS.has(w));}
function jaccard(a,b){const sa=new Set(tokenize(a));const sb=new Set(tokenize(b));if(!sa.size||!sb.size)return 0;let inter=0;for(const x of sa)if(sb.has(x))inter++;return inter/(sa.size+sb.size-inter);}
function normStr(s){return String(s||'').toLowerCase().replace(/\s+/g,' ').trim();}
function humanPick(arr){return arr[Math.floor(Math.random()*arr.length)];}
function humanRoll(p){return Math.random()<p;}
function extractKeywords(text,max){max=max||5;const words=tokenize(text);if(!words.length)return[];const counts=new Map();for(const w of words)counts.set(w,(counts.get(w)||0)+1);return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,max).map(([w])=>w);}
function approxTokens(s){return Math.ceil(String(s||'').length/4);}

// KEYS (rotação + tokens diários)
function nextUtcMidnight(){const d=new Date();d.setUTCHours(24,0,0,0);return d.getTime();}
function makeKeyEntry(key){return{key:String(key||'').trim(),usedToday:0,resetAt:nextUtcMidnight(),cooldownUntil:0,limit:Number(settings.keyLimit)||DEFAULT_DAILY_LIMIT};}
function persistKeys(){try{lsSet('apiKeys',settings.apiKeys);}catch(e){}}
function refreshKeyDaily(k,now){if(!k)return;now=now||Date.now();if(!k.resetAt||now>=k.resetAt){k.usedToday=0;k.resetAt=nextUtcMidnight();k.cooldownUntil=0;}}
function keyUsable(k,now){if(!k||!k.key)return false;refreshKeyDaily(k,now);if(k.cooldownUntil&&k.cooldownUntil>now)return false;if((k.usedToday||0)>=(Number(k.limit)||DEFAULT_DAILY_LIMIT))return false;return true;}
function getActiveKey(){const now=Date.now();for(const k of settings.apiKeys){if(keyUsable(k,now))return k;}return null;}
function addKeyUsage(k,tokens){if(!k||!tokens)return;refreshKeyDaily(k);k.usedToday=(k.usedToday||0)+tokens;persistKeys();}
function fmtTok(n){n=Number(n)||0;if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1000)return(n/1000).toFixed(1)+'k';return String(n);}
function addKey(key){key=String(key||'').trim();if(!key)return false;if(settings.apiKeys.some(k=>k.key===key))return false;settings.apiKeys.push(makeKeyEntry(key));persistKeys();return true;}
function addKeysFromInput(text){const parts=String(text||'').split(/[\s,;]+/).map(s=>s.trim()).filter(Boolean);let n=0;for(const p of parts)if(addKey(p))n++;return n;}

// ANCHOR COMPRESSION — turnos antigos viram 1 linha
function anchorOf(q,a){
const qs=truncate(stripMd(String(q||'')),ANCHOR_CHARS);
const as=truncate(stripMd(String(a||'')),ANCHOR_CHARS);
return {q:qs,a:as,t:Date.now()};
}
function compressToAnchors(recent){
if(!settings.anchorsEnabled)return recent;
const list=(recent||[]).slice();
if(list.length<=BUDGET_ANCHOR_TURNS)return list;
const keepTail=list.slice(-BUDGET_ANCHOR_TURNS);
const older=list.slice(0,-BUDGET_ANCHOR_TURNS);
const anchors=older.map(t=>anchorOf(t.q,t.a));
stats.anchors+=older.length;
return anchors.concat(keepTail);
}

// REASONING LEAK STRIPPER
function stripReasoningLeak(text){
if(!settings.stripReasoningEnabled)return text;
let s=String(text||'').trim();
if(!s)return s;
const answerMarker=s.match(/(?:^|\n)\s*(?:answer|resposta|final|output|saída)\s*[:\-]\s*([\s\S]+)$/i);
if(answerMarker&&answerMarker[1].trim()){s=answerMarker[1].trim();}
for(let i=0;i<3;i++){
let changed=false;
for(const re of REASONING_LEAKS){
if(re.test(s)){s=s.replace(re,'').trim();changed=true;}
}
if(!changed)break;
}
const lines=s.split(/\n/).filter(l=>{
const t=l.trim();
if(!t)return false;
if(/^(thinking|raciocínio|reasoning|step \d+|passo \d+|note:|nota:)/i.test(t))return false;
if(/^\s*\d+[\.\)]\s+/.test(t)&&t.length<100)return false;
return true;
});
s=lines.join(' ').trim();
s=s.replace(/\(([^)]{120,})\)/g,'');
s=s.replace(/\s+/g,' ').trim();
return s;
}

// CAPTURE DEDUP
function captureSeen(user,msg){
const k=String(user||'').toLowerCase()+'|'+normStr(msg);
const now=Date.now();
const last=_recentCaptures.get(k);
if(last&&now-last<CAPTURE_DEDUP_MS)return true;
_recentCaptures.set(k,now);
if(_recentCaptures.size>500){
const cutoff=now-CAPTURE_DEDUP_MS*2;
for(const[ck,ct]of _recentCaptures)if(ct<cutoff)_recentCaptures.delete(ck);
}
return false;
}

// CIRCUIT BREAKER
function cbCheck(){
if(Date.now()<cbOpenUntil){
dbg('cb','open','restam='+Math.ceil((cbOpenUntil-Date.now())/1000)+'s');
return false;
}
if(cbOpenUntil){cbOpenUntil=0;cbFails=0;dbg('cb','closed');}
return true;
}
function cbSuccess(){cbFails=0;cbOpenUntil=0;}
function cbFail(){
cbFails++;
if(cbFails>=CB_THRESHOLD){
cbOpenUntil=Date.now()+CB_COOLDOWN_MS;
dbg('cb','OPEN','fails='+cbFails);
}
}

// HEALTH CHECK
async function healthCheck(){
if(dying)return;
const k=getActiveKey();
if(!k)return;
try{
const ctrl=new AbortController();
const timer=setTimeout(()=>ctrl.abort(),5000);
const res=await fetch(GROQ_MODELS_URL,{headers:{'Authorization':'Bearer '+k.key},signal:ctrl.signal});
clearTimeout(timer);
if(!res.ok){
dbg('health','falha','status='+res.status);
if(res.status===401)showToast('⚠ Key inválida (…'+k.key.slice(-6)+')');
}else{
dbg('health','ok');
}
}catch(e){dbg('health','erro',String(e));}
}

// USERSTORE
const UserStore={
map:null,_saveTimer:null,
load(){
if(this.map)return;
this.map=new Map();
try{
const raw=localStorage.getItem(US_KEY);
if(raw){
const arr=JSON.parse(raw);
if(Array.isArray(arr)){
for(const it of arr){
if(!it||!Array.isArray(it)||it.length!==2)continue;
const nick=String(it[0]||'').trim().toLowerCase();
const data=it[1];
if(!nick||!data||typeof data!=='object')continue;
this.map.set(nick,data);
}
}
} else {
this.migrateLegacy();
}
}catch(e){this.map=new Map();}
},
migrateLegacy(){
try{
let n=0;
const rawHist=localStorage.getItem(LS_PREFIX+'botchat_hist');
if(rawHist){
const arr=JSON.parse(rawHist);
if(Array.isArray(arr)){
for(const it of arr){
if(!it||!Array.isArray(it)||it.length!==2)continue;
const nick=String(it[0]||'').trim().toLowerCase();
const d=it[1];
if(!nick||!d||!Array.isArray(d.turns))continue;
const u=this._blank(nick);
u.recent=d.turns.slice(-US_RECENT_KEEP).map(t=>({q:t.q,a:t.a,t:t.t||Date.now()}));
u.interactions=Math.max(u.interactions,d.turns.length);
this.map.set(nick,u);
n++;
}
}
}
const rawSum=localStorage.getItem(LS_PREFIX+'botchat_summ');
if(rawSum){
const arr=JSON.parse(rawSum);
if(Array.isArray(arr)){
for(const it of arr){
if(!it||!Array.isArray(it)||it.length!==2)continue;
const nick=String(it[0]||'').trim().toLowerCase();
const d=it[1];
if(!nick||!d||typeof d.text!=='string')continue;
const u=this.map.get(nick)||this._blank(nick);
u.summary=d.text;
u.summaryAt=d.at||Date.now();
this.map.set(nick,u);
}
}
}
const rawProf=localStorage.getItem(LS_PREFIX+'profiles');
if(rawProf){
const arr=JSON.parse(rawProf);
if(Array.isArray(arr)){
for(const it of arr){
if(!it||!Array.isArray(it)||it.length!==2)continue;
const nick=String(it[0]||'').trim().toLowerCase();
const d=it[1];
if(!nick||!d||typeof d.text!=='string')continue;
const u=this.map.get(nick)||this._blank(nick);
u.profile=Object.assign({},u.profile,{text:d.text,updatedAt:d.updatedAt||Date.now()});
this.map.set(nick,u);
}
}
}
if(n>0)this.save();
try{console.log('[aibot:userstore] migração','users='+n);}catch(e){}
}catch(e){try{console.log('[aibot:userstore] erro migração',String(e));}catch(e2){}}
},
_blank(nick){return{nick,firstSeen:Date.now(),lastSeen:Date.now(),interactions:0,profile:{text:'',updatedAt:0,style:'',topics:[],dislikes:[],notes:'',confidence:0,at:0},summary:'',summaryAt:0,recent:[],bordaos:[],lastReplies:[],_factCounter:0};},
save(){
if(!this.map)return;
clearTimeout(this._saveTimer);
this._saveTimer=setTimeout(()=>{
try{
const arr=Array.from(this.map.entries());
if(arr.length>US_MAX_USERS){
arr.sort((a,b)=>(b[1].lastSeen||0)-(a[1].lastSeen||0));
arr.length=US_MAX_USERS;
}
localStorage.setItem(US_KEY,JSON.stringify(arr));
}catch(e){}
},US_SAVE_DEBOUNCE);
},
saveNow(){
if(!this.map)return;
try{
const arr=Array.from(this.map.entries());
if(arr.length>US_MAX_USERS){
arr.sort((a,b)=>(b[1].lastSeen||0)-(a[1].lastSeen||0));
arr.length=US_MAX_USERS;
}
localStorage.setItem(US_KEY,JSON.stringify(arr));
}catch(e){}
},
get(nick){
this.load();
const k=String(nick||'').trim().toLowerCase();
if(!k)return null;
if(!this.map.has(k)){const b=this._blank(k);this.map.set(k,b);this.save();return b;}
return this.map.get(k);
},
peek(nick){
this.load();
const k=String(nick||'').trim().toLowerCase();
return this.map.get(k)||null;
},
set(nick,patch){
this.load();
const k=String(nick||'').trim().toLowerCase();
if(!k)return null;
const cur=this.map.get(k)||this._blank(k);
const next=Object.assign({},cur,patch);
next.lastSeen=Date.now();
this.map.set(k,next);
this.save();
return next;
},
pushRecent(nick,q,a){
const u=this.get(nick);
const arr=(u.recent||[]).slice();
arr.push({q:String(q||'').slice(0,300),a:String(a||'').slice(0,300),t:Date.now()});
while(arr.length>US_RECENT_KEEP)arr.shift();
const next=Object.assign({},u,{recent:arr,interactions:(u.interactions||0)+1,_factCounter:(u._factCounter||0)+1,lastSeen:Date.now()});
this.map.set(String(nick||'').trim().toLowerCase(),next);
this.save();
return next;
},
pushBordao(nick,word){
if(!word||word.length<4||word.length>12)return;
const u=this.get(nick);
const arr=(u.bordaos||[]).slice();
const idx=arr.indexOf(word);
if(idx!==-1)arr.splice(idx,1);
arr.push(word);
while(arr.length>US_BORDAO_KEEP)arr.shift();
this.map.set(String(nick||'').trim().toLowerCase(),Object.assign({},u,{bordaos:arr}));
this.save();
},
pushLastReply(nick,text){
if(!text)return;
const u=this.get(nick);
const arr=(u.lastReplies||[]).slice();
arr.push(hashStr(normStr(text)));
while(arr.length>US_LASTREPLY_KEEP)arr.shift();
this.map.set(String(nick||'').trim().toLowerCase(),Object.assign({},u,{lastReplies:arr}));
this.save();
},
isRepeatedReply(nick,text){
const u=this.peek(nick);
if(!u||!u.lastReplies||!u.lastReplies.length)return false;
return u.lastReplies.indexOf(hashStr(normStr(text)))!==-1;
},
clear(nick){this.load();const k=String(nick||'').trim().toLowerCase();if(!k)return false;const ok=this.map.delete(k);if(ok)this.save();return ok;},
clearAll(){this.load();this.map.clear();try{localStorage.removeItem(US_KEY);}catch(e){}return true;},
stats(){this.load();let users=0;for(const v of this.map.values())users++;return{users,bytes:(()=>{try{return(localStorage.getItem(US_KEY)||'').length;}catch(e){return 0;}})()};},
buildContext(nick,question){
if(!settings.userStoreEnabled)return null;
const u=this.peek(nick);
if(!u)return null;
const parts=[];
const prof=u.profile||{};
if(prof.style)parts.push('estilo:'+prof.style);
if(prof.topics&&prof.topics.length){const qKeys=extractKeywords(question||'',3);const rel=prof.topics.filter(t=>qKeys.some(k=>String(t).toLowerCase().includes(k)||k.includes(String(t).toLowerCase())));const use=(rel.length?rel:prof.topics.slice(0,4));if(use.length)parts.push('temas:'+use.join(','));}
if(prof.dislikes&&prof.dislikes.length)parts.push('nao gosta:'+prof.dislikes.slice(0,3).join(','));
if(prof.notes)parts.push('obs:'+prof.notes);
if(u.summary)parts.push('hist:'+u.summary);
if(u.bordaos&&u.bordaos.length)parts.push('fala:'+u.bordaos.slice(-3).join(','));
return parts.length?parts.join(' | '):null;
}
};

async function extractFacts(nick){
if(dying||!settings.userStoreEnabled||!getActiveKey())return null;
const u=UserStore.peek(nick);
if(!u)return null;
const recentTurns=(u.recent||[]).slice(-5);
if(recentTurns.length<2)return null;
const txt=recentTurns.map(t=>'user: '+t.q+'\nbot: '+t.a).join('\n');
const sys='Você é um extrator de perfil. Leia a conversa e devolva um JSON estrito com: {"style":"casual|formal|zoeiro|serio|misto","topics":["max 5 temas"],"dislikes":["max 3"],"notes":"1 frase em 1a pessoa do ponto de vista do observador"}. Sem markdown, sem comentários, só o JSON.';
const out=await rawGroq([{role:'system',content:sys},{role:'user',content:txt}],US_FACT_MAX_TOKENS,0.2);
if(!out)return null;
try{
const cleaned=out.replace(/```json|```/g,'').trim();
const obj=JSON.parse(cleaned);
const cur=UserStore.peek(nick)||{};
const prev=cur.profile||{};
const profile=Object.assign({},prev,{style:String(obj.style||'').slice(0,40),topics:Array.isArray(obj.topics)?obj.topics.slice(0,5).map(x=>String(x).slice(0,30)):[],dislikes:Array.isArray(obj.dislikes)?obj.dislikes.slice(0,3).map(x=>String(x).slice(0,30)):[],notes:String(obj.notes||'').slice(0,220),confidence:0.7,at:Date.now()});
UserStore.set(nick,{profile});
dbg('userstore','facts','nick='+nick,'topics='+profile.topics.length);
return profile;
}catch(e){dbg('userstore','facts parse erro',String(e));return null;}
}

// HUMAN ENGINE
function detectTone(msg){const s=String(msg||'');const letters=s.replace(/[^A-Za-zÀ-ÿ]/g,'');const upper=(s.match(/[A-ZÀ-Ý]/g)||[]).length;const capsRatio=letters.length>5?upper/letters.length:0;const hasLaugh=/(kk+|haha|hehe|rs+|lol)/i.test(s);const questions=(s.match(/\?/g)||[]).length;const exclaims=(s.match(/!/g)||[]).length;const hasEmoji=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s);if(capsRatio>0.55&&letters.length>6)return{tone:'angry',intensity:Math.min(1,capsRatio)};if(hasLaugh)return{tone:'happy',intensity:0.7};if(questions>=2)return{tone:'curious',intensity:0.6};if(hasEmoji||exclaims>=2)return{tone:'happy',intensity:0.5};return{tone:'neutral',intensity:0};}
function applyHumanFilters(text){let s=String(text||'');for(const re of AI_CLICHES){s=s.replace(re,'').trim();}s=s.replace(/!{2,}/g,'!').replace(/\?{3,}/g,'??');s=s.replace(/\s+/g,' ').trim();return s;}
function maybeTypo(text){if(!settings.humanMode)return text;if(text.length<10||text.length>70)return text;if(!humanRoll(settings.humanConfig.typo))return text;const i=Math.floor(Math.random()*(text.length-3))+1;const c=text[i]?text[i].toLowerCase():'';const alt=TYPO_MAP[c];if(!alt)return text;stats.typos++;return text.slice(0,i)+alt+text.slice(i+1);}
function applyNoPunct(text){if(!settings.humanMode)return text;if(!/^[^.!?]{8,90}$/.test(text))return text;if(!humanRoll(settings.humanConfig.noPunct))return text;return text.replace(/[.!?]+$/,'');}
function shouldSkip(user,question){if(!settings.humanMode)return false;const cfg=settings.humanConfig;let p=cfg.skipTrigger;if(settings.soloMode)p=cfg.skipSolo;else if(settings.botChatMode)p=cfg.skipChat;if(p<=0)return false;if(/\?\s*$/.test(question))return false;if(question.length>140)return false;if(question.split(/\s+/).length<=1)return false;return humanRoll(p);}
function maybeReaction(question){if(!settings.humanMode)return null;const cfg=settings.humanConfig;if(question.length>70)return null;if(question.split(/\s+/).length>12)return null;if(!humanRoll(cfg.reaction))return null;stats.reactions++;return humanPick(REACTIONS);}
function maybeAskBack(question){if(!settings.humanMode)return null;const cfg=settings.humanConfig;if(question.length>110)return null;if(/^(sim|não|nao|ok|blz|vlw|obg|valeu)\b/i.test(question.trim()))return null;if(!humanRoll(cfg.askBack))return null;return humanPick(ASK_BACK);}
function readDelayFor(question){if(!settings.humanMode)return 0;const cfg=settings.humanConfig;const chars=String(question||'').length;return Math.min(cfg.delayReadMax,cfg.delayReadBase+chars*cfg.delayReadPerChar);}
function humanDelayFor(chunk){if(!settings.humanMode)return CHUNK_GAP_MS;const cfg=settings.humanConfig;const chars=String(chunk||'').length;return cfg.delayBase+chars*cfg.delayPerChar+Math.random()*cfg.delayJitter;}
function splitHuman(text){
text=String(text||'').trim();
if(!settings.humanMode)return splitChunks(text,CHAT_CHAR_LIMIT);
const cfg=settings.humanConfig;
if(text.length<=cfg.chunkMax)return[text];
const chunks=[];let rest=text;let guard=0;
while(rest.length>cfg.chunkMax&&chunks.length<cfg.maxChunks-1&&guard++<6){
const target=Math.min(cfg.chunkMax,Math.max(cfg.chunkMin,Math.floor(rest.length/Math.max(2,Math.ceil(rest.length/cfg.chunkMax)))));
const win=rest.slice(0,target+20);
let idx=-1;
const m=win.match(/[.!?]\s+[A-ZÀ-Ý]/);
if(m)idx=m.index+2;
if(idx<0){const comma=win.lastIndexOf(', ');if(comma>cfg.chunkMin*0.6)idx=comma+2;}
if(idx<0||idx<cfg.chunkMin)break;
chunks.push(rest.slice(0,idx).trim());
rest=rest.slice(idx).trim();
}
if(rest)chunks.push(rest);
return chunks.length?chunks:[text];
}

// DEBUG
function dbg(tag,...args){if(!debugEnabled)return;const entry={id:++debugSeq,t:ts(),tag,text:args.map(a=>typeof a==='string'?a:(()=>{try{return JSON.stringify(a);}catch(e){return String(a);}})()).join(' ')};debugLog.push(entry);if(debugLog.length>DEBUG_MAX)debugLog.shift();renderLog();try{console.log('[aibot:'+tag+']',...args);}catch(e){}}

// MEMORY curta
function getMemory(user){const m=memory.get(user);if(!m)return[];if(Date.now()-m.last>MEMORY_TTL_MS){memory.delete(user);return[];}return m.turns;}
function pushMemory(user,q,a){const ex=memory.get(user);const turns=(ex&&ex.turns?ex.turns:[]).slice();turns.push({q,a,t:Date.now()});while(turns.length>MEMORY_TURNS)turns.shift();memory.delete(user);memory.set(user,{turns,last:Date.now()});if(memory.size>MEMORY_MAX_USERS){const k=memory.keys().next().value;memory.delete(k);}}
function clearMemory(user){if(user)memory.delete(user);else memory.clear();}

// BOTCHAT MEMORY
function getBotChatMemory(user){const u=UserStore.peek(user);if(!u||!Array.isArray(u.recent))return[];return u.recent;}
function pushBotChatMemory(user,q,a){
const max=Math.max(5,Math.min(200,Number(settings.botChatTurns)||DEFAULT_BOTCHAT_TURNS));
UserStore.pushRecent(user,q,a);
const u=UserStore.peek(user);
if(u){
const trimmed=(u.recent||[]).slice(-max);
const kws=extractKeywords(q,3);
for(const k of kws)UserStore.pushBordao(user,k);
UserStore.pushLastReply(user,a);
if(trimmed.length!==(u.recent||[]).length)UserStore.set(user,{recent:trimmed});
if(BOTCHAT_MAX_USERS&&UserStore.map.size>BOTCHAT_MAX_USERS){
let oldest=null,oldestT=Infinity;
for(const[n,v]of UserStore.map){if((v.lastSeen||0)<oldestT){oldestT=v.lastSeen||0;oldest=n;}}
if(oldest)UserStore.clear(oldest);
}
if((u._factCounter||0)>=US_FACT_TRIGGER&&!summarizing.has('f_'+user)){
summarizing.add('f_'+user);
extractFacts(user).catch(()=>{}).finally(()=>{summarizing.delete('f_'+user);UserStore.set(user,{_factCounter:0});});
}
}
}
function setBotChatMemoryTurns(user,turns){UserStore.set(user,{recent:turns});}
function clearBotChatMemory(user){
if(user){UserStore.set(user,{recent:[],lastReplies:[]});}
else{UserStore.load();for(const[n]of UserStore.map)UserStore.set(n,{recent:[],lastReplies:[]});}
}
function botChatMemoryCount(user){const u=UserStore.peek(user);return u?(u.interactions||(u.recent?u.recent.length:0)):0;}
function botChatUsersCount(){UserStore.load();return UserStore.map.size;}

// SUMMARIES
function getBotChatSummary(user){const u=UserStore.peek(user);if(!u||!u.summary)return null;return{text:u.summary,at:u.summaryAt||0};}
function setBotChatSummary(user,text){UserStore.set(user,{summary:text,summaryAt:Date.now()});}
function clearBotChatSummary(user){
if(user){UserStore.set(user,{summary:'',summaryAt:0});}
else{UserStore.load();for(const[n]of UserStore.map)UserStore.set(n,{summary:'',summaryAt:0});}
}
function scheduleSummarization(user){
if(!settings.summariesEnabled||dying||!getActiveKey())return;
if(summarizing.has(user))return;
const turns=getBotChatMemory(user);
if(turns.length<SUMMARY_TRIGGER)return;
summarizing.add(user);
doSummarize(user).catch(e=>dbg('summ','erro',String(e))).finally(()=>summarizing.delete(user));
}
async function doSummarize(user){
if(dying)return;
const turns=getBotChatMemory(user);
if(turns.length<SUMMARY_TRIGGER)return;
const batch=turns.slice(0,SUMMARY_BATCH);
const remaining=turns.slice(SUMMARY_BATCH);
const existing=getBotChatSummary(user);
const batchText=batch.map(t=>'user: '+t.q+'\nassistant: '+t.a).join('\n');
const parts=[];
if(existing)parts.push('Resumo anterior:\n'+existing.text);
parts.push('Novos turnos a incorporar:\n'+batchText);
parts.push('Reescreva o resumo incorporando os novos turnos, mantendo o contexto essencial (quem é o usuário, o que já foi discutido, tom, preferências). Máximo 250 palavras. Responda só o resumo.');
const text=await rawGroq([{role:'user',content:parts.join('\n\n')}],SUMMARY_MAX_TOKENS,0.3);
if(!text||dying)return;
setBotChatSummary(user,text);
setBotChatMemoryTurns(user,remaining);
dbg('summ','ok','user='+user,'antes='+turns.length,'depois='+remaining.length);
}

// PROFILES
function getUserProfile(user){
if(!settings.profileEnabled)return null;
const u=UserStore.peek(user);
if(!u||!u.profile)return null;
const p=u.profile;
if(!p.text&&!p.notes&&!(p.topics&&p.topics.length))return null;
return p;
}
function setUserProfile(user,text){
const cur=UserStore.peek(user)||{};
const prof=Object.assign({},cur.profile||{},{text,updatedAt:Date.now()});
UserStore.set(user,{profile:prof});
}
function clearUserProfile(user){
if(user){UserStore.set(user,{profile:{text:'',updatedAt:0,style:'',topics:[],dislikes:[],notes:'',confidence:0,at:0}});}
else{UserStore.load();for(const[n]of UserStore.map)UserStore.set(n,{profile:{text:'',updatedAt:0,style:'',topics:[],dislikes:[],notes:'',confidence:0,at:0}});}
}
function scheduleProfile(user){
if(!settings.profileEnabled||dying||!getActiveKey())return;
if(profileBuilding.has(user))return;
const turns=getBotChatMemory(user);
if(turns.length<PROFILE_MIN_TURNS)return;
const existing=getUserProfile(user);
if(existing&&existing.updatedAt&&Date.now()-existing.updatedAt<PROFILE_TTL_MS)return;
profileBuilding.add(user);
doBuildProfile(user).catch(e=>dbg('prof','erro',String(e))).finally(()=>profileBuilding.delete(user));
}
async function doBuildProfile(user){
if(dying)return;
const turns=getBotChatMemory(user).slice(-15);
if(turns.length<PROFILE_MIN_TURNS)return;
const text=turns.map(t=>'user: '+t.q+'\nassistant: '+t.a).join('\n');
const prompt='Analise as interações abaixo e escreva um mini-perfil do usuário em 1-2 frases. Foque em: tom de voz, temas preferidos, nível de formalidade, humor. Responda apenas o perfil.\n\n'+text;
const profile=await rawGroq([{role:'user',content:prompt}],120,0.5);
if(!profile||dying)return;
setUserProfile(user,profile);
dbg('prof','ok','user='+user,truncate(profile,80));
}

// TOPICS
function loadTopics(){if(roomTopics)return;roomTopics=new Map();try{const raw=localStorage.getItem(LS_PREFIX+'room_topics');if(!raw)return;const arr=JSON.parse(raw);if(!Array.isArray(arr))return;for(const it of arr){if(!it||!Array.isArray(it)||it.length!==2)continue;const k=it[0],d=it[1];if(!d||!Array.isArray(d.users))continue;roomTopics.set(k,{users:new Set(d.users),lastAt:d.lastAt||0});}}catch(e){roomTopics=new Map();}}
function saveTopics(){if(!roomTopics)return;try{const arr=Array.from(roomTopics.entries()).map(([k,v])=>[k,{users:Array.from(v.users),lastAt:v.lastAt}]);localStorage.setItem(LS_PREFIX+'room_topics',JSON.stringify(arr));}catch(e){}}
function updateRoomTopics(user,msg){
if(!settings.topicsEnabled)return;
loadTopics();
const kws=extractKeywords(msg,5);
if(!kws.length)return;
const now=Date.now();
for(const kw of kws){const e=roomTopics.get(kw)||{users:new Set(),lastAt:now};e.users.add(user);e.lastAt=now;roomTopics.set(kw,e);}
for(const[kw,e]of roomTopics){if(now-e.lastAt>TOPIC_TTL_MS)roomTopics.delete(kw);}
if(roomTopics.size>TOPIC_MAX){const sorted=Array.from(roomTopics.entries()).sort((a,b)=>a[1].lastAt-b[1].lastAt);for(let i=0;i<sorted.length-TOPIC_MAX+50;i++)roomTopics.delete(sorted[i][0]);}
saveTopics();
}
function findRelatedTopics(question,excludeUser){
if(!settings.topicsEnabled)return[];
loadTopics();
const kws=extractKeywords(question,5);
const out=[];
for(const kw of kws){const e=roomTopics.get(kw);if(!e)continue;const others=Array.from(e.users).filter(u=>!eqUser(u,excludeUser));if(others.length)out.push({kw,users:others});}
return out.slice(0,4);
}

// CACHE (semântico)
function cacheKey(q){const keys=extractKeywords(q,4).sort().join('|');const sig=keys||normStr(q).slice(0,40);return hashStr(sig+'|'+settings.personaKey+'|'+settings.model);}
function cacheGet(q){
if(!settings.cacheEnabled)return null;
const k=cacheKey(q);
const e=responseCache.get(k);
if(e&&Date.now()-e.at<=CACHE_TTL_MS)return e.text;
if(e)responseCache.delete(k);
const now=Date.now();
for(const[sk,sv]of responseCache){
if(now-sv.at>CACHE_TTL_MS){responseCache.delete(sk);continue;}
if(sv.tokens&&jaccard(sv.tokens,q)>=SEMANTIC_CACHE_THRESHOLD){
dbg('cache','semantic hit','sim='+jaccard(sv.tokens,q).toFixed(2));
return sv.text;
}
}
return null;
}
function cacheSet(q,text){
if(!settings.cacheEnabled)return;
const k=cacheKey(q);
responseCache.set(k,{text,at:Date.now(),tokens:q});
if(responseCache.size>CACHE_MAX){
const sorted=Array.from(responseCache.entries()).sort((a,b)=>a[1].at-b[1].at);
for(let i=0;i<sorted.length-CACHE_MAX+20;i++)responseCache.delete(sorted[i][0]);
}
}
function cacheClear(){responseCache.clear();}

// ROOM CONTEXT
function loadRoomContext(){try{const raw=localStorage.getItem(LS_PREFIX+'room_ctx');if(!raw)return;const arr=JSON.parse(raw);if(!Array.isArray(arr))return;const max=Math.max(settings.soloTurns||0,settings.botChatReadAllTurns||0,5);roomContext=arr.filter(m=>m&&m.user&&m.msg).slice(-max);}catch(e){roomContext=[];}}
function saveRoomContext(){try{localStorage.setItem(LS_PREFIX+'room_ctx',JSON.stringify(roomContext));}catch(e){}}
function trimRoom(n){if(roomContext.length>n)roomContext=roomContext.slice(-n);saveRoomContext();}
function currentRoomLimit(){if(settings.soloMode)return settings.soloTurns;if(settings.botChatMode&&settings.botChatReadAll)return settings.botChatReadAllTurns;return 100;}
function currentRoomDelay(){if(settings.soloMode)return settings.soloDelay;if(settings.botChatMode&&settings.botChatReadAll)return settings.botChatReadAllDelay;return DEFAULT_READALL_DELAY;}
function scheduleRoomFlush(){if(roomFlushTimer||dying)return;if(roomBuffer.length>=ROOM_BUFFER_MAX){flushRoomBuffer();return;}roomFlushTimer=setTimeout(flushRoomBuffer,currentRoomDelay());}
function flushRoomBuffer(){if(roomFlushTimer){clearTimeout(roomFlushTimer);roomFlushTimer=null;}if(!roomBuffer.length)return;const now=Date.now();for(const it of roomBuffer)roomContext.push({user:it.user,msg:it.msg,t:now});roomBuffer=[];const max=currentRoomLimit();if(roomContext.length>max)roomContext=roomContext.slice(-max);saveRoomContext();refreshToggle();dbg('room','flush','ctx='+roomContext.length);}
function pushRoomMessage(user,msg){roomBuffer.push({user,msg,t:Date.now()});scheduleRoomFlush();}
function clearRoomContext(){roomContext=[];roomBuffer=[];if(roomFlushTimer){clearTimeout(roomFlushTimer);roomFlushTimer=null;}saveRoomContext();refreshToggle();}
function roomContextSummary(){return{total:roomContext.length,users:uniqUsers(roomContext)};}

// CAPTURE
function extractUser(content){
for(const s of USER_SELECTORS){try{const el=content.querySelector(s);if(!el)continue;const t=(el.textContent||'').trim();if(!t||t.length>40)continue;const full=(content.innerText||content.textContent||'').trim();if(t===full)continue;if(t.toLowerCase().includes((settings.trigger||'/bot').toLowerCase()))continue;return{user:t};}catch(e){}}
for(const el of content.querySelectorAll('b, strong, span')){const t=(el.textContent||'').trim();if(!t||t.length>30)continue;if(/[.!?]/.test(t))continue;const full=(content.innerText||content.textContent||'').trim();if(t===full)continue;if(t.toLowerCase().includes((settings.trigger||'/bot').toLowerCase()))continue;return{user:t};}
const full=(content.innerText||content.textContent||'').trim();
const m=full.match(/^([^\s:]{1,30})\s*[:\-–—]\s*/);
if(m)return{user:m[1]};
return null;
}
function cleanMsg(full,user){let msg=full;if(user&&msg.startsWith(user))msg=msg.slice(user.length);msg=msg.replace(/^\s*[\s:>|·•\-–—]+/,'').replace(/^(diz|disse|says|said|falou|fala)\s*[:\-]\s*/i,'').replace(/^\[[^\]]{1,20}\]\s*/,'').trim();return msg;}
function extract(bubble){const content=bubble.querySelector(SEL_PRIMARY);if(!content)return null;const u=extractUser(content);if(!u||!u.user)return null;const full=(content.innerText||content.textContent||'').trim();const msg=cleanMsg(full,u.user);return{user:u.user,msg,full};}
function pushRow(data){rows.push({user:data.user,msg:data.msg,t:ts()});if(rows.length>MAX_ROWS)rows.shift();}
function bubbleKey(data,bubble){return normStr(data.user)+'|'+normStr(data.msg)+'|'+(bubble.className||'');}
function processBubble(bubble){
if(!bubble||bubble.nodeType!==1)return;
const data=extract(bubble);
if(!data||!data.user){dbg('miss','sem user',bubble.className);return;}
if(!data.msg){dbg('miss','sem msg','user='+data.user);return;}
const k=bubbleKey(data,bubble);
if(seenKeys.has(k))return;
seenKeys.add(k);
if(seenKeys.size>SEEN_KEYS_MAX)seenKeys.clear();
dbg('capture','user='+data.user,'msg='+truncate(data.msg,80));
if(captureSeen(data.user,data.msg)){dbg('capture','dup skipped');return;}
if(isEcho(data.user,data.msg)){dbg('echo','ignorado','user='+data.user);return;}
pushRow(data);
handleIncoming(data);
}
function isEcho(user,msg){
const now=Date.now();
const nm=normStr(msg);
for(const[k,t]of sentEchos){
if(now-t>ECHO_TTL)continue;
if(normStr(k)===nm)return true;
if(k.length>5&&msg.length>5&&jaccard(k,msg)>=ECHO_SIM)return true;
}
return false;
}
function rememberSent(text){sentEchos.set(text,Date.now());const now=Date.now();for(const[k,t]of sentEchos){if(now-t>ECHO_TTL)sentEchos.delete(k);}}

// TRIGGER
function matchTrigger(msg){
if(!settings.enabled)return null;
const trg=(settings.trigger||'/bot').trim();
if(!trg)return null;
const e=trg.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const re=new RegExp('(?:^|[\\s:>\\-–—])('+e+')\\s+(.+)$','i');
const m=msg.match(re);
if(!m)return null;
const q=(m[2]||'').trim();
return q||null;
}

// COMMANDS
const COMMAND_LIST=['reset','status','silence','help'];
function parseCommand(msg){
const trg=(settings.trigger||'/bot').trim();
if(!trg)return null;
const e=trg.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const re=new RegExp('^\\s*'+e+'\\s+([a-zA-Z]+)(?:\\s+([\\s\\S]*))?\\s*$');
const m=msg.match(re);
if(!m)return null;
const cmd=m[1].toLowerCase();
if(COMMAND_LIST.indexOf(cmd)===-1)return null;
return{cmd,args:(m[2]||'').trim()};
}
async function handleCommand(user,cmd,args){
dbg('cmd',cmd,'user='+user);
if(cmd==='reset'){
clearBotChatMemory(user);clearBotChatSummary(user);clearMemory(user);
await sendToChatVerified('@'+user+' ok, esqueci nossa conversa');
addLog({t:ts(),user,q:'/bot reset',r:'memória apagada',status:'ok',info:'comando'});
return true;
}
if(cmd==='status'){
const s=stats;
const txt='req '+s.requests+' · ok '+s.ok+' · fail '+s.fail+' · cache '+s.cacheHits+' · tok '+s.tokens;
await sendToChatVerified('@'+user+' '+txt);
addLog({t:ts(),user,q:'/bot status',r:txt,status:'ok',info:'comando'});
return true;
}
if(cmd==='silence'){
const min=Math.max(0,Math.min(SILENCE_MAX_MIN,parseInt(args,10)||0));
if(!min){silencedUntil=0;await sendToChatVerified('@'+user+' silêncio desligado');}
else{silencedUntil=Date.now()+min*60*1000;await sendToChatVerified('@'+user+' silêncio por '+min+'min');}
addLog({t:ts(),user,q:'/bot silence '+args,r:min?min+'min':'off',status:'ok',info:'comando'});
return true;
}
if(cmd==='help'){
await sendToChatVerified('@'+user+' comandos: reset · status · silence <min> · help');
addLog({t:ts(),user,q:'/bot help',r:'listado',status:'ok',info:'comando'});
return true;
}
return false;
}

// EXT (ganchos p/ bot-games.js e outros módulos)
let sayChain=Promise.resolve();
function say(text){
const chunks=splitChunks(String(text||''),CHAT_CHAR_LIMIT);
sayChain=sayChain.then(async()=>{for(const c of chunks){if(dying)return;const r=await sendToChatVerified(c);if(r.ok)rememberSent(c);await sleep(CHUNK_GAP_MS);}}).catch(()=>{});
return sayChain;
}

// INCOMING
function handleIncoming({user,msg}){
if(!settings.enabled)return;
const trimmed=msg.trim();
if(!trimmed)return;
for(const h of hooks){try{if(h(user,trimmed)===true)return;}catch(e){dbg('error','hook',String(e));}}
if(settings.soloMode&&isBlacklisted(user)){dbg('solo','blacklisted','user='+user);return;}
const cmd=parseCommand(trimmed);
if(cmd){handleCommand(user,cmd.cmd,cmd.args);return;}
if(silencedUntil&&Date.now()<silencedUntil){dbg('silence','skip','user='+user);return;}
let question=null,source=null;
if(settings.soloMode){
pushRoomMessage(user,trimmed);flushRoomBuffer();
updateRoomTopics(user,trimmed);
question=trimmed;source='solo';
dbg('solo','user='+user,'q='+truncate(question,60));
}else if(settings.botChatMode&&eqUser(user,settings.botChatUser)){
if(settings.botChatReadAll)flushRoomBuffer();
question=trimmed;source='botchat';
dbg('botchat','user='+user,'q='+truncate(question,60));
}else if(settings.botChatMode&&settings.botChatReadAll){
pushRoomMessage(user,trimmed);return;
}else{
question=matchTrigger(msg);
if(!question){if(msg.toLowerCase().includes((settings.trigger||'/bot').toLowerCase()))dbg('trigger','sem pergunta');return;}
source='trigger';
dbg('trigger','casa','user='+user,'q='+truncate(question,60));
}
if(!getActiveKey()){addLog({t:ts(),user,q:question,r:'—',status:'no-key',info:'nenhuma key disponível'});updateStats();return;}
const now=Date.now();
const userCd=settings.soloMode?SOLO_USER_COOLDOWN_MS:PER_USER_COOLDOWN_MS;
const last=lastUserAt.get(user)||0;
if(now-last<userCd){dbg('cooldown','user='+user);addLog({t:ts(),user,q:question,r:'—',status:'skip',info:'cooldown por user'});updateStats();return;}
const globalCd=settings.soloMode?SOLO_GLOBAL_COOLDOWN_MS:GLOBAL_COOLDOWN_MS;
if(now-lastGlobalReplyAt<globalCd&&queue.length>=2){dbg('cooldown','global');addLog({t:ts(),user,q:question,r:'—',status:'skip',info:'cooldown global'});updateStats();return;}
lastUserAt.set(user,now);
if(queue.length>=MAX_QUEUE){addLog({t:ts(),user,q:question,r:'—',status:'skip',info:'fila cheia'});updateStats();return;}
enqueueJob({user,question,t:ts(),source,_ts:Date.now()});
updateQueue();
processQueue();
}

// QUEUE — prioritária
function enqueueJob(job){
const prio=job.source==='trigger'?0:job.source==='botchat'?1:2;
let idx=queue.length;
for(let i=0;i<queue.length;i++){
const p=queue[i].source==='trigger'?0:queue[i].source==='botchat'?1:2;
if(prio<p){idx=i;break;}
}
queue.splice(idx,0,job);
}
function normalizeForCoalesce(q){const keys=extractKeywords(q,5).sort().join('|');return keys||normStr(q).slice(0,60);}

async function processQueue(){
if(processing||dying)return;
if(!queue.length)return;
processing=true;updateDot();
const job=queue.shift();

const sig=normalizeForCoalesce(job.question);
const now=Date.now();
const group=[job];
for(let i=queue.length-1;i>=0;i--){
const other=queue[i];
if(now-(other._ts||now)>COALESCE_WINDOW_MS)continue;
if(normalizeForCoalesce(other.question)===sig){
group.push(other);
queue.splice(i,1);
}
}
if(group.length>1){stats.coalesced+=(group.length-1);dbg('coalesce','group='+group.length);}
updateQueue();

try{
if(shouldSkip(job.user,job.question)){
stats.skips++;
dbg('human','skip','user='+job.user);
for(const g of group){
addLog({t:g.t,user:g.user,q:g.question,r:'—',status:'skip',info:'modo humano: skip'});
stats.requests++;
}
updateStats();
}else{
const reply=await callGroq(job.question,job.user,job.source);
if(reply&&!dying){
for(const g of group){
if(g.source==='botchat'||g.source==='solo'){
pushBotChatMemory(g.user,g.question,reply);
scheduleSummarization(g.user);
scheduleProfile(g.user);
}else if(settings.memoryEnabled){
pushMemory(g.user,g.question,reply);
}
let finalReply=reply;
if(settings.humanMode){
const react=maybeReaction(g.question);
if(react){finalReply=react;dbg('human','reaction',react);}
else{
const ask=maybeAskBack(g.question);
if(ask){finalReply=ask;dbg('human','askBack',ask);}
else{
finalReply=applyHumanFilters(reply);
finalReply=applyNoPunct(finalReply);
finalReply=maybeTypo(finalReply);
}
}
}
const text=settings.prefixReply?('@'+g.user+' '+finalReply):finalReply;
const chunks=splitHuman(text);
let allOk=true,reason='';
if(settings.humanMode){
const rd=readDelayFor(g.question);
if(rd>0)await sleep(rd);
}
for(let i=0;i<chunks.length;i++){
if(i>0){
const d=settings.humanMode?humanDelayFor(chunks[i-1]):CHUNK_GAP_MS;
await sleep(d);
}
if(dying)break;
const res=await sendToChatVerified(chunks[i]);
if(res.ok)rememberSent(chunks[i]);else{allOk=false;reason=res.reason;}
}
const info=[];
if(!allOk)info.push(reason||'falha no envio');
else if(chunks.length>1)info.push('enviado em '+chunks.length+' blocos');
if(group.length>1)info.push('coalesced '+group.length);
if(settings.humanMode)info.push('humano');
if(g.source==='solo')info.push('solo');
else if(g.source==='botchat')info.push('conversa');
addLog({t:g.t,user:g.user,q:g.question,r:finalReply,status:allOk?'ok':'send-fail',info:info.join(' · ')||undefined});
stats.requests++;
if(allOk){stats.ok++;lastGlobalReplyAt=Date.now();}else stats.fail++;
}
}
}
}catch(e){
for(const g of group){
addLog({t:g.t,user:g.user,q:g.question,r:'—',status:'error',info:String(e.message||e)});
stats.requests++;stats.fail++;
}
}
processing=false;updateStats();
if(queue.length&&!dying)setTimeout(processQueue,settings.cooldownMs);
}

// RAW GROQ
async function rawGroq(messages,maxTokens,temperature){
if(dying)return null;
const k=getActiveKey();
if(!k)return null;
if(!cbCheck())return null;
const ctrl=new AbortController();
const timer=setTimeout(()=>ctrl.abort(),REQ_TIMEOUT);
try{
const body={model:settings.model,messages,temperature:typeof temperature==='number'?temperature:0.4,max_tokens:maxTokens,top_p:0.9};
if(settings.reasoningEffort&&settings.reasoningEffort!=='default')body.reasoning_effort=settings.reasoningEffort;
const res=await fetch(GROQ_URL,{method:'POST',headers:{'Authorization':'Bearer '+k.key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctrl.signal});
clearTimeout(timer);
if(!res.ok){cbFail();return null;}
const data=await res.json().catch(()=>({}));
if(data?.usage?.total_tokens){stats.tokens+=data.usage.total_tokens;addKeyUsage(k,data.usage.total_tokens);}
const c=data?.choices?.[0]?.message?.content;
cbSuccess();
return c?stripReasoningLeak(String(c).trim()):null;
}catch(e){clearTimeout(timer);cbFail();return null;}
}

// GROQ principal
async function callGroq(question,user,source){
if(!question)return null;
if(!cbCheck())throw new Error('circuit breaker aberto');
const cached=cacheGet(question);
if(cached){stats.cacheHits++;dbg('cache','hit',truncate(question,50));updateStats();return cached;}
const messages=[{role:'system',content:settings.systemPrompt}];
const uctx=UserStore.buildContext(user,question);
if(uctx)messages.push({role:'system',content:'[user] '+uctx});
const profile=getUserProfile(user);
if(profile&&profile.text&&(!uctx||uctx.indexOf(profile.text)===-1)){
messages.push({role:'system',content:'[Perfil] '+profile.text});
}
if(source==='solo'&&roomContext.length){
const filtered=roomContext.filter(m=>{if(m.user===user&&m.msg===question)return false;if(isBlacklisted(m.user))return false;return true;}).slice(-ROOM_CTX_SEND_MAX);
if(filtered.length){const lines=filtered.map(m=>m.user+': '+m.msg).join('\n');messages.push({role:'system',content:'sala: '+lines+'\n\nUse para entender o contexto geral. Foque na mensagem dirigida a você.'});}
}
if(source==='solo'){
const related=findRelatedTopics(question,user);
if(related.length){const lines=related.map(r=>'"'+r.kw+'" ('+r.users.join(', ')+')').join(', ');messages.push({role:'system',content:'[topicos] '+lines});}
}
if(source==='botchat'&&settings.botChatReadAll&&roomContext.length){
const filtered=roomContext.filter(m=>!(m.user===user&&m.msg===question)).slice(-ROOM_CTX_SEND_MAX);
if(filtered.length){const lines=filtered.map(m=>m.user+': '+m.msg).join('\n');messages.push({role:'system',content:'sala: '+lines});}
}
const summary=getBotChatSummary(user);
if(summary&&(source==='solo'||source==='botchat'))messages.push({role:'system',content:'[Resumo] '+summary.text});
const u=UserStore.peek(user);
if(u&&Array.isArray(u.recent)&&u.recent.length){
const tail=compressToAnchors(u.recent).slice(-4);
for(const t of tail){messages.push({role:'user',content:t.q});messages.push({role:'assistant',content:t.a});}
} else if(user&&source==='trigger'&&settings.memoryEnabled){
const hist=getMemory(user);
for(const t of hist){messages.push({role:'user',content:t.q});messages.push({role:'assistant',content:t.a});}
}
messages.push({role:'user',content:question});

let total=0;for(const m of messages)total+=approxTokens(m.content);
if(total>BUDGET_INPUT_TOKENS){
const head=messages[0],last=messages[messages.length-1],mid=messages.slice(1,-1);
let run=approxTokens(head.content)+approxTokens(last.content);
const keep=[];
for(let i=mid.length-1;i>=0;i--){const tk=approxTokens(mid[i].content);if(run+tk>BUDGET_INPUT_TOKENS)break;keep.unshift(mid[i]);run+=tk;}
messages.length=0;messages.push(head,...keep,last);
stats.anchors++;
dbg('budget','cortou','antes='+total,'depois='+run);
}

let temp=settings.temperature;
if(settings.humanMode){
const{tone,intensity}=detectTone(question);
const cfg=settings.humanConfig;
if(tone==='angry')temp=Math.max(0,temp+cfg.tempAngry*intensity);
else if(tone==='happy')temp=Math.min(2,temp+cfg.tempHappy*intensity);
else if(tone==='curious')temp=Math.min(2,temp+cfg.tempCurious);
}

const qLen=String(question||'').length;
let adaptiveMax=settings.maxTokens;
if(qLen<ADAPTIVE_SMALL)adaptiveMax=Math.min(adaptiveMax,150);
else if(qLen<ADAPTIVE_MED)adaptiveMax=Math.min(adaptiveMax,200);
else if(qLen<ADAPTIVE_LARGE)adaptiveMax=Math.min(adaptiveMax,300);

const body={model:settings.model,messages,temperature:temp,max_tokens:adaptiveMax,top_p:0.9};
if(settings.reasoningEffort&&settings.reasoningEffort!=='default')body.reasoning_effort=settings.reasoningEffort;
let lastErr=null;
let activeKey=getActiveKey();
if(!activeKey)throw new Error('sem API keys disponíveis');
const maxAttempts=REQ_RETRIES+Math.max(1,settings.apiKeys.length);
for(let attempt=0;attempt<=maxAttempts;attempt++){
if(dying)throw new Error('dying');
const ctrl=new AbortController();
const jobId=++abortSeq;
activeAborts.set(jobId,ctrl);
const timer=setTimeout(()=>ctrl.abort(),REQ_TIMEOUT);
try{
const res=await fetch(GROQ_URL,{method:'POST',headers:{'Authorization':'Bearer '+activeKey.key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctrl.signal});
clearTimeout(timer);
const data=await res.json().catch(()=>({}));
if(!res.ok){
const msg=data?.error?.message||('HTTP '+res.status);
if(res.status===429){
const retryAfter=parseInt(res.headers.get('retry-after')||'0',10);
const isDaily=/daily|per[- ]day|day limit|quota/i.test(String(msg))||retryAfter>3600;
const other=settings.apiKeys.find(k=>k.key!==activeKey.key&&keyUsable(k,Date.now()));
if(other){
if(isDaily){activeKey.cooldownUntil=activeKey.resetAt||nextUtcMidnight();dbg('key','limite diário','…'+activeKey.key.slice(-6));}
else{activeKey.cooldownUntil=Date.now()+Math.max(60000,retryAfter*1000);dbg('key','rate limit','…'+activeKey.key.slice(-6));}
persistKeys();
dbg('key','rotacionando','para …'+other.key.slice(-6));
activeKey=other;
continue;
}
if(!isDaily&&retryAfter>0&&retryAfter<=120&&attempt<maxAttempts){stats.retries++;dbg('retry','aguardando '+retryAfter+'s');await sleep(retryAfter*1000);continue;}
if(isDaily){activeKey.cooldownUntil=activeKey.resetAt||nextUtcMidnight();persistKeys();}
cbFail();
throw new Error('todas as keys esgotadas: '+msg);
}
if(res.status>=500&&attempt<maxAttempts){stats.retries++;dbg('retry','status='+res.status);await sleep(RETRY_DELAY_MS*(attempt+1));continue;}
cbFail();
throw new Error(msg);
}
if(data?.usage?.total_tokens){stats.tokens+=data.usage.total_tokens;addKeyUsage(activeKey,data.usage.total_tokens);}
const choice=(data?.choices&&data.choices[0])||{};
const finish=choice.finish_reason||'?';
const m=choice.message||{};
let content=m.content;
const reasoning=m.reasoning||m.reasoning_content||m.reasoning_details;
const refusal=m.refusal;
const toolCalls=m.tool_calls;
if(toolCalls&&toolCalls.length){dbg('warn','tool_calls','count='+toolCalls.length);if(!content||!String(content).trim())throw new Error('modelo pediu tool_calls');}
if(!content||!String(content).trim()){
if(refusal){stats.empty++;dbg('empty','refusal');cbFail();throw new Error('modelo recusou responder');}
if(reasoning&&String(reasoning).trim()){
stats.empty++;dbg('empty','usando reasoning');
const cleaned=stripReasoningLeak(String(reasoning));
const out=truncate(stripMd(cleaned),REPLY_CHAR_LIMIT);
cacheSet(question,out);
cbSuccess();
return out;
}
if(finish==='length'){stats.empty++;dbg('empty','tokens esgotados');cbFail();throw new Error('resposta vazia — tokens esgotados.');}
if(finish==='content_filter'){stats.empty++;stats.filtered++;dbg('empty','content_filter');cbFail();throw new Error('bloqueado pelo filtro');}
stats.empty++;dbg('empty','sem content','finish='+finish);cbFail();throw new Error('resposta vazia (finish: '+finish+')');
}
if(finish==='length')dbg('warn','resposta truncada por length');
content=stripReasoningLeak(String(content));
const out=truncate(stripMd(content),REPLY_CHAR_LIMIT);
cacheSet(question,out);
cbSuccess();
return out;
}catch(e){
clearTimeout(timer);
lastErr=e;
if(attempt<maxAttempts&&(e.name==='AbortError'||/network|fetch/i.test(String(e)))){stats.retries++;dbg('retry','erro de rede');await sleep(RETRY_DELAY_MS*(attempt+1));continue;}
throw e;
}finally{activeAborts.delete(jobId);}
}
throw lastErr||new Error('falha desconhecida');
}

// SEND
const INPUT_SELECTORS=['input.chat-input','textarea.chat-input','.chat-input input','.chat-input textarea','input[placeholder*="mensagem" i]','input[placeholder*="escreva" i]','input[placeholder*="diga" i]','div[class*="chat" i] input','div[class*="chat" i] textarea','form[class*="chat" i] input','form[class*="chat" i] textarea'];
let detectedInputSel=null;
function findChatInput(){for(const s of INPUT_SELECTORS){try{const el=document.querySelector(s);if(el&&el.offsetParent!==null){detectedInputSel=s;return el;}}catch(e){}}detectedInputSel=null;return null;}
function setNativeValue(el,value){const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(el,value);else el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
function pressEnter(el){const opts={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};el.dispatchEvent(new KeyboardEvent('keydown',opts));el.dispatchEvent(new KeyboardEvent('keypress',opts));el.dispatchEvent(new KeyboardEvent('keyup',opts));}
async function sendToChatVerified(text){
const input=findChatInput();
if(!input){dbg('send','input não encontrado');return{ok:false,reason:'input de chat não encontrado'};}
try{input.focus();}catch(e){}
setNativeValue(input,text);
await sleep(30);
pressEnter(input);
await sleep(SEND_VERIFY_MS);
if(!input.value||input.value.trim()===''){dbg('send','ok via Enter');return{ok:true};}
const form=input.closest('form');
if(form){form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await sleep(SEND_RETRY_MS);}
if(!input.value||input.value.trim()===''){dbg('send','ok via form');return{ok:true};}
setNativeValue(input,'');
dbg('send','FALHA — input não limpou');
return{ok:false,reason:'input não limpou após envio'};
}

// LOG
function addLog(entry){entry.id=++logSeq;logs.push(entry);if(logs.length>settings.logLimit)logs.shift();renderLog();}
function clearLogs(){logs=[];debugLog=[];renderLog();}

// OBSERVER
function scanAll(){try{document.querySelectorAll(SEL_PRIMARY).forEach(c=>{const b=c.closest(SEL_BUBBLE)||c;if(b)processBubble(b);});}catch(e){}}
function startObserver(){
if(observer||dying)return;
scanAll();
observer=new MutationObserver(muts=>{
for(const m of muts){
try{
if(m.type==='childList'){for(const n of m.addedNodes){if(n.nodeType!==1)continue;if(n.matches&&n.matches(SEL_PRIMARY)){processBubble(n.closest(SEL_BUBBLE)||n);}else if(n.querySelectorAll){n.querySelectorAll(SEL_PRIMARY).forEach(c=>processBubble(c.closest(SEL_BUBBLE)||c));}}}
else if(m.type==='attributes'&&m.target){if(m.target.classList&&m.target.classList.contains(SEL_VISIBLE))processBubble(m.target);if(m.target.matches&&m.target.matches(SEL_PRIMARY))processBubble(m.target.closest(SEL_BUBBLE)||m.target);}
else if(m.type==='characterData'&&m.target&&m.target.parentElement){const pe=m.target.parentElement;if(pe.matches(SEL_PRIMARY)||pe.closest(SEL_PRIMARY))processBubble(pe.closest(SEL_BUBBLE)||pe);}
}catch(e){dbg('error','mutação',String(e));}
}
});
observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class'],characterData:true});
}
function stopObserver(){if(observer){observer.disconnect();observer=null;}}
function startPoll(){if(pollTimer||dying)return;pollTimer=setInterval(()=>{if(!dying)scanAll();},POLL_MS);}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}

// INIT
function init(){
if(dying||window[UID])return;
ac=new AbortController();
loadSettings();
UserStore.load();
loadTopics();
loadRoomContext();
startObserver();
startPoll();
healthCheck();

const kit={
settings,stats,PERSONAS,MODELS,REASONING_EFFORTS,HUMAN_DEFAULTS,DEFAULT_BOTCHAT_USER,DEFAULT_READALL_DELAY,DEFAULT_READALL_TURNS,DEFAULT_DAILY_LIMIT,MAX_QUEUE,UserStore,responseCache,queue,
esc,truncate,fmtTok,getActiveKey,refreshKeyDaily,persistKeys,addKeysFromInput,healthCheck,saveSetting,saveHumanConfig,selectPersona,cacheClear,clearRoomContext,saveRoomContext,trimRoom,
botChatMemoryCount,botChatUsersCount,roomContextSummary,isBlacklisted,parseBlacklist,findChatInput,callGroq,dbg,setDebug,clearLogs,
clearBotChatMemory,clearBotChatSummary,clearMemory,clearUserProfile,clearLastUserAt:()=>lastUserAt.clear(),
get logs(){return logs;},get debugLog(){return debugLog;},get debugEnabled(){return debugEnabled;},get roomContext(){return roomContext;},get processing(){return processing;},get silencedUntil(){return silencedUntil;},get cbOpenUntil(){return cbOpenUntil;},get detectedInputSel(){return detectedInputSel;},
setUI:u=>{uiApi=u;}
};

window[UID]={
kill,kit,say,
trigger:()=>settings.trigger,
addHook:fn=>{hooks.add(fn);return()=>hooks.delete(fn);},
show:()=>{uiApi?.show();return true;},
hide:()=>{uiApi?.hide();return true;},
on:()=>{settings.enabled=true;saveSetting('enabled',true);refreshToggle();refreshStatus();return true;},
off:()=>{settings.enabled=false;saveSetting('enabled',false);refreshToggle();refreshStatus();return false;},
human:(on)=>{if(on===undefined)return settings.humanMode;settings.humanMode=!!on;saveSetting('humanMode',settings.humanMode);refreshToggle();return settings.humanMode;},
humanConfig:(cfg)=>{if(cfg===undefined)return Object.assign({},settings.humanConfig);const cur=Object.assign({},settings.humanConfig);for(const k in cfg){if(typeof cfg[k]==='number'&&k in HUMAN_DEFAULTS)cur[k]=cfg[k];}settings.humanConfig=cur;saveHumanConfig();syncUI();refreshToggle();return Object.assign({},settings.humanConfig);},
humanReset:()=>{settings.humanConfig=Object.assign({},HUMAN_DEFAULTS);saveHumanConfig();syncUI();refreshToggle();return true;},
tone:(msg)=>detectTone(msg),
solo:(on)=>{if(on===undefined)return settings.soloMode;settings.soloMode=!!on;saveSetting('soloMode',settings.soloMode);if(settings.soloMode&&settings.botChatMode){settings.botChatMode=false;saveSetting('botChatMode',false);}if(!settings.soloMode)clearRoomContext();refreshToggle();refreshStatus();return settings.soloMode;},
soloDelay:(ms)=>{if(ms===undefined)return settings.soloDelay;const v=Math.max(200,Math.min(10000,Number(ms)||DEFAULT_READALL_DELAY));settings.soloDelay=v;saveSetting('soloDelay',v);syncUI();refreshToggle();return v;},
soloTurns:(n)=>{if(n===undefined)return settings.soloTurns;const v=Math.max(5,Math.min(100,Number(n)||DEFAULT_READALL_TURNS));settings.soloTurns=v;saveSetting('soloTurns',v);trimRoom(v);syncUI();refreshToggle();return v;},
soloBlacklist:(arr)=>{if(arr===undefined)return(settings.soloBlacklist||[]).slice();const v=Array.isArray(arr)?parseBlacklist(arr.join('\n')):parseBlacklist(String(arr));settings.soloBlacklist=v;saveSetting('soloBlacklist',v);syncUI();refreshToggle();refreshStatus();return v.slice();},
soloExclude:(name)=>{if(!name)return false;const n=String(name).trim().toLowerCase();const v=(settings.soloBlacklist||[]).slice();if(!n)return false;if(v.indexOf(n)===-1)v.push(n);settings.soloBlacklist=v;saveSetting('soloBlacklist',v);syncUI();refreshToggle();refreshStatus();return true;},
soloInclude:(name)=>{if(!name)return false;const n=String(name).trim().toLowerCase();const v=(settings.soloBlacklist||[]).filter(x=>x!==n);settings.soloBlacklist=v;saveSetting('soloBlacklist',v);syncUI();refreshToggle();refreshStatus();return true;},
botChat:(on)=>{if(on===undefined)return settings.botChatMode;settings.botChatMode=!!on;saveSetting('botChatMode',settings.botChatMode);if(settings.botChatMode&&settings.soloMode){settings.soloMode=false;saveSetting('soloMode',false);}if(!settings.botChatMode)clearRoomContext();refreshToggle();refreshStatus();return settings.botChatMode;},
botChatUser:(u)=>{if(u===undefined)return settings.botChatUser;const v=String(u).trim()||DEFAULT_BOTCHAT_USER;settings.botChatUser=v;saveSetting('botChatUser',v);syncUI();refreshToggle();return v;},
botChatTurns:(n)=>{if(n===undefined)return settings.botChatTurns;const v=Math.max(5,Math.min(200,Number(n)||DEFAULT_BOTCHAT_TURNS));settings.botChatTurns=v;saveSetting('botChatTurns',v);syncUI();refreshToggle();return v;},
botChatHistory:(user)=>{const u=user||settings.botChatUser;return getBotChatMemory(u).map(t=>({q:t.q,a:t.a,t:t.t}));},
botChatClear:(user)=>{clearBotChatMemory(user||settings.botChatUser);clearBotChatSummary(user||settings.botChatUser);refreshToggle();return true;},
botChatSummary:(user)=>{const u=user||settings.botChatUser;const s=getBotChatSummary(u);return s?s.text:null;},
roomRead:(on)=>{if(on===undefined)return settings.botChatReadAll;settings.botChatReadAll=!!on;saveSetting('botChatReadAll',settings.botChatReadAll);if(!settings.botChatReadAll)clearRoomContext();refreshToggle();refreshStatus();return settings.botChatReadAll;},
roomDelay:(ms)=>{if(ms===undefined)return settings.botChatReadAllDelay;const v=Math.max(200,Math.min(10000,Number(ms)||DEFAULT_READALL_DELAY));settings.botChatReadAllDelay=v;saveSetting('botChatReadAllDelay',v);syncUI();refreshToggle();return v;},
roomTurns:(n)=>{if(n===undefined)return settings.botChatReadAllTurns;const v=Math.max(5,Math.min(100,Number(n)||DEFAULT_READALL_TURNS));settings.botChatReadAllTurns=v;saveSetting('botChatReadAllTurns',v);trimRoom(v);syncUI();refreshToggle();return v;},
roomContext:()=>roomContext.map(m=>({user:m.user,msg:m.msg,t:m.t})),
roomClear:()=>{clearRoomContext();return true;},
topics:()=>{loadTopics();const out={};for(const[k,v]of roomTopics)out[k]=Array.from(v.users);return out;},
profile:(user)=>{const p=getUserProfile(user);return p?p.text:null;},
store:(nick)=>{if(nick===undefined)return UserStore.stats();return UserStore.get(nick);},
storePeek:(nick)=>UserStore.peek(nick),
storeClear:(nick)=>{if(nick)UserStore.clear(nick);else UserStore.clearAll();refreshToggle();return true;},
storeExport:()=>{UserStore.load();const obj={};for(const[k,v]of UserStore.map)obj[k]=v;return obj;},
storeFacts:(nick)=>extractFacts(nick),
cacheClear:()=>{cacheClear();refreshToggle();return true;},
cacheSize:()=>responseCache.size,
silence:(min)=>{if(min===undefined)return silencedUntil&&Date.now()<silencedUntil?Math.ceil((silencedUntil-Date.now())/60000):0;const m=Math.max(0,Math.min(SILENCE_MAX_MIN,Number(min)||0));if(!m)silencedUntil=0;else silencedUntil=Date.now()+m*60*1000;refreshStatus();return m;},
cbStatus:()=>({fails:cbFails,open:Date.now()<cbOpenUntil,openUntil:cbOpenUntil}),
cbReset:()=>{cbFails=0;cbOpenUntil=0;refreshStatus();return true;},
stripLeak:(text)=>stripReasoningLeak(text),
anchorsOn:(on)=>{if(on===undefined)return settings.anchorsEnabled;settings.anchorsEnabled=!!on;saveSetting('anchorsEnabled',settings.anchorsEnabled);refreshToggle();return settings.anchorsEnabled;},
stripReasoningOn:(on)=>{if(on===undefined)return settings.stripReasoningEnabled;settings.stripReasoningEnabled=!!on;saveSetting('stripReasoningEnabled',settings.stripReasoningEnabled);refreshToggle();return settings.stripReasoningEnabled;},
status:()=>({enabled:settings.enabled,model:settings.model,trigger:settings.trigger,queue:queue.length,reasoningEffort:settings.reasoningEffort,humanMode:settings.humanMode,soloMode:settings.soloMode,botChatMode:settings.botChatMode,botChatUser:settings.botChatUser,userStoreEnabled:settings.userStoreEnabled,cacheEnabled:settings.cacheEnabled,topicsEnabled:settings.topicsEnabled,anchorsEnabled:settings.anchorsEnabled,stripReasoningEnabled:settings.stripReasoningEnabled,cb:{fails:cbFails,open:Date.now()<cbOpenUntil},userStore:UserStore.stats(),cache:responseCache.size,roomContextSize:roomContext.length,roomContextUsers:uniqUsers(roomContext),silenced:silencedUntil&&Date.now()<silencedUntil,keys:settings.apiKeys.length,hooks:hooks.size,ui:!!uiApi,stats:{...stats}}),
persona:(key)=>{if(PERSONAS[key])selectPersona(key);return settings.personaKey;},
prompt:(txt)=>{if(typeof txt==='string'){settings.systemPrompt=txt;saveSetting('systemPrompt',txt);syncUI();}return settings.systemPrompt;},
model:(id)=>{if(MODELS.find(m=>m.id===id)){settings.model=id;saveSetting('model',id);refreshToggle();}return settings.model;},
effort:(v)=>{if(REASONING_EFFORTS.includes(v)){settings.reasoningEffort=v;saveSetting('reasoningEffort',v);syncUI();refreshToggle();}return settings.reasoningEffort;},
maxTokens:(n)=>{const v=Math.max(50,Math.min(4000,Number(n)||500));settings.maxTokens=v;saveSetting('maxTokens',v);syncUI();return v;},
key:(k)=>{if(typeof k==='string'){addKey(k);healthCheck();renderKeys();refreshStatus();}const a=getActiveKey();return a?('***'+a.key.slice(-4)):null;},
keys:()=>settings.apiKeys.map(k=>({key:'***'+k.key.slice(-4),usedToday:k.usedToday||0,limit:k.limit||DEFAULT_DAILY_LIMIT,cooldownUntil:k.cooldownUntil||0,resetAt:k.resetAt||0})),
keysAdd:(k)=>addKeysFromInput(k),
keysRemove:(i)=>{if(typeof i==='number'&&settings.apiKeys[i]){settings.apiKeys.splice(i,1);persistKeys();renderKeys();refreshStatus();return true;}return false;},
keysClear:()=>{settings.apiKeys=[];persistKeys();renderKeys();refreshStatus();return true;},
keysResetUsage:()=>{for(const k of settings.apiKeys){k.usedToday=0;k.resetAt=nextUtcMidnight();k.cooldownUntil=0;}persistKeys();renderKeys();refreshStatus();return true;},
ask:(q,user)=>callGroq(q,user),
send:async(text)=>{const r=await sendToChatVerified(text);if(r.ok)rememberSent(text);return r;},
testTrigger:(msg)=>matchTrigger(msg),
extract:(sel)=>{const b=document.querySelector(sel||SEL_BUBBLE);return b?extract(b):null;},
memory:(user)=>getMemory(user),
memoryOf:(user)=>getMemory(user).map(t=>({q:t.q,a:t.a,t:t.t})),
clearMemory:(user)=>{clearMemory(user);refreshToggle();return true;},
clearMemoryAll:()=>{clearMemory();lastUserAt.clear();refreshToggle();return true;},
debug:(on)=>setDebug(on),
debugLog:()=>debugLog.slice(),
logs:()=>logs.slice(),
settings:()=>({...settings})
};
console.log('%c[aibot]','color:#22d3ee;font-weight:bold','core ativo · UI: bot-ui.js · window.'+UID+' exposto');
window.dispatchEvent(new CustomEvent('sang:bot-ready'));
}

// KILL
function kill(){
if(dying)return;
dying=true;
if(roomFlushTimer){clearTimeout(roomFlushTimer);roomFlushTimer=null;}
const steps=[
['observer',()=>stopObserver()],
['poll',()=>stopPoll()],
['pending',()=>{for(const c of activeAborts.values()){try{c.abort();}catch(e){}}activeAborts.clear();}],
['abort',()=>ac&&ac.abort()],
['hooks',()=>hooks.clear()],
['userstore',()=>{try{if(UserStore._saveTimer)clearTimeout(UserStore._saveTimer);UserStore.saveNow();}catch(e){}}],
['keys',()=>{try{persistKeys();}catch(e){}}],
['ui',()=>{const u=uiApi;uiApi=null;u&&u.kill();}],
['event',()=>window.dispatchEvent(new CustomEvent('sang:bot-kill'))],
['globals',()=>{delete window[UID];}]
];
for(const[name,fn]of steps){try{fn();}catch(e){console.warn('[aibot] kill step '+name+' falhou:',e);}}
}

if(document.body){setTimeout(init,0);}
else new MutationObserver((_,o)=>{
if(document.body){o.disconnect();setTimeout(init,0);}
}).observe(document.documentElement,{childList:true});

})();
