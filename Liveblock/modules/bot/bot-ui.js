// modules/bot-ui.js  (UI do bot — depende de bot.js via window._aibot.kit)
(function() {
    'use strict';
    const UID = '_aibotUI';
    if (window[UID]) return;

// STATE
let unready=null;

function mount(){
if(window[UID]&&window[UID].mounted)return;
const bot=window._aibot;
const K=bot&&bot.kit;
if(!K){console.warn('[aibot-ui] core ausente');return;}
const {settings,stats,PERSONAS,MODELS,REASONING_EFFORTS,HUMAN_DEFAULTS,DEFAULT_BOTCHAT_USER,DEFAULT_READALL_DELAY,DEFAULT_READALL_TURNS,DEFAULT_DAILY_LIMIT,MAX_QUEUE,UserStore,responseCache,queue,esc,truncate,fmtTok,dbg}=K;
let host=null,shadow=null,ac=new AbortController(),toastTimer=null;
const ui={};

// STYLE
function buildStyle(){
return `
*{box-sizing:border-box;margin:0;padding:0}
.panel{position:relative;width:520px;max-height:88vh;display:flex;flex-direction:column;
background:linear-gradient(175deg,rgba(20,20,28,.94),rgba(9,9,14,.98));
backdrop-filter:blur(18px) saturate(140%);
border:1px solid rgba(255,255,255,.08);border-radius:16px;
box-shadow:0 20px 50px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06);
color:#f1f2f8;font-size:12px;overflow:hidden;transition:max-height .22s ease,width .22s ease;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.panel.collapsed{width:260px;max-height:50px}
.panel.collapsed .body,.panel.collapsed .foot,.panel.collapsed .tabs{display:none}
.panel button:focus-visible,.panel input:focus-visible,.panel textarea:focus-visible,.panel select:focus-visible{outline:2px solid #22d3ee;outline-offset:2px}
.head{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;cursor:grab;flex-shrink:0;user-select:none;
background:linear-gradient(120deg,rgba(34,211,238,.14),rgba(167,139,250,.14));
border-bottom:1px solid rgba(255,255,255,.06)}
.head:active{cursor:grabbing}
.brand{display:flex;align-items:center;gap:9px;min-width:0}
.dot{width:8px;height:8px;border-radius:50%;background:#5b5f70;flex-shrink:0;transition:all .2s}
.dot.on{background:#34d399;box-shadow:0 0 8px rgba(52,211,153,.8)}
.dot.busy{background:#fbbf24;box-shadow:0 0 8px rgba(251,191,36,.9);animation:pulse 1s infinite}
.dot.chat{background:#a78bfa;box-shadow:0 0 8px rgba(167,139,250,.9)}
.dot.solo{background:#fbbf24;box-shadow:0 0 8px rgba(251,191,36,.9);animation:pulse 1.4s infinite}
.dot.room{background:#f472b6;box-shadow:0 0 8px rgba(244,114,182,.9);animation:pulse 1.6s infinite}
.dot.human{background:#22d3ee;box-shadow:0 0 10px rgba(34,211,238,.95);animation:pulse 1.2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.title{font-weight:800;font-size:11.5px;letter-spacing:.08em;
background:linear-gradient(100deg,#22d3ee,#a78bfa,#fff,#a78bfa,#22d3ee);
background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;
animation:shine 3.2s linear infinite;white-space:nowrap}
@keyframes shine{to{background-position:-200% center}}
.actions{display:flex;gap:5px;flex-shrink:0}
.btn{min-width:24px;height:24px;padding:0 7px;border-radius:7px;
background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
color:#c7cad6;cursor:pointer;font-size:11px;line-height:1;
display:flex;align-items:center;justify-content:center;font-family:inherit;transition:all .16s}
.btn:hover{color:#0b0b10;background:linear-gradient(120deg,#22d3ee,#a78bfa);border-color:transparent}
.btn.on{background:linear-gradient(120deg,#22d3ee,#a78bfa);color:#0b0b10;border-color:transparent}
.tabs{display:flex;gap:4px;padding:0 12px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.06)}
.tab{flex:1;text-align:center;padding:9px 4px 10px;font-size:10px;font-weight:800;
letter-spacing:.05em;text-transform:uppercase;color:#8b8fa3;
background:transparent;border:none;cursor:pointer;position:relative;font-family:inherit}
.tab.active{color:#fff}
.tab.active::after{content:'';position:absolute;left:14px;right:14px;bottom:-1px;height:2px;
background:linear-gradient(120deg,#22d3ee,#a78bfa);border-radius:2px}
.body{flex:1;overflow-y:auto;min-height:0;padding:12px;display:flex;flex-direction:column;gap:12px}
.body::-webkit-scrollbar{width:5px}
.body::-webkit-scrollbar-thumb{background:linear-gradient(#22d3ee,#a78bfa);border-radius:3px}
.sec{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);border-radius:11px;padding:11px 13px}
.sec-label{font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8b8fa3;margin-bottom:9px}
.sec-group{display:flex;flex-direction:column;gap:8px}
.sec-title{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#6b6f82;margin:2px 0 -2px;padding-left:2px}
.sec-title .num{width:16px;height:16px;border-radius:5px;background:rgba(255,255,255,.06);color:#c7cad6;font-size:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sec-title::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.06)}
label.f{display:block;font-size:9.5px;color:#8b8fa3;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:5px}
.inp{width:100%;padding:9px 11px;border-radius:8px;background:rgba(255,255,255,.04);
border:1px solid rgba(255,255,255,.1);color:#f1f2f8;font-size:12px;outline:none;
font-family:inherit;transition:border-color .15s}
.inp:focus{border-color:rgba(34,211,238,.6);box-shadow:0 0 0 3px rgba(34,211,238,.12)}
.inp:disabled{opacity:.55;cursor:not-allowed}
textarea.inp{resize:vertical;min-height:90px;line-height:1.5;font-size:11.5px}
textarea.inp.tall{min-height:60px}
select.inp{cursor:pointer;appearance:none;background-image:url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238b8fa3' stroke-width='3'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:30px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.toggle{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;
border-radius:11px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);cursor:pointer}
.toggle.on{border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.06)}
.toggle.violet.on{border-color:rgba(167,139,250,.4);background:rgba(167,139,250,.08)}
.toggle.pink.on{border-color:rgba(244,114,182,.4);background:rgba(244,114,182,.08)}
.toggle.amber.on{border-color:rgba(251,191,36,.45);background:rgba(251,191,36,.08);box-shadow:0 0 12px rgba(251,191,36,.12)}
.toggle.cyan.on{border-color:rgba(34,211,238,.55);background:rgba(34,211,238,.1);box-shadow:0 0 14px rgba(34,211,238,.18)}
.toggle .switch{pointer-events:none}
.switch{position:relative;width:42px;height:22px;border-radius:22px;
background:rgba(255,255,255,.08);transition:all .2s;flex:0 0 auto;
border:1px solid rgba(255,255,255,.1)}
.switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
background:#8b8fa3;transition:all .2s}
.switch.on{background:linear-gradient(120deg,#22d3ee,#a78bfa);border-color:transparent}
.switch.on::after{left:22px;background:#fff}
.switch.pink.on{background:linear-gradient(120deg,#f472b6,#a78bfa)}
.switch.amber.on{background:linear-gradient(120deg,#fbbf24,#f472b6)}
.switch.cyan.on{background:linear-gradient(120deg,#22d3ee,#34d399)}
.presets{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.preset{padding:6px 11px;border-radius:8px;cursor:pointer;font-family:inherit;
font-size:10.5px;font-weight:700;letter-spacing:.03em;
background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
color:#c7cad6;transition:all .15s}
.preset:hover{background:rgba(255,255,255,.08)}
.preset.active{background:linear-gradient(120deg,#22d3ee,#a78bfa);color:#0b0b10;border-color:transparent}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(52px,1fr));gap:6px;margin-top:8px}
.stat-cell{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:9px;padding:8px;text-align:center}
.stat-v{font-size:12.5px;font-weight:800;color:#22d3ee;font-variant-numeric:tabular-nums}
.stat-v.warn{color:#fbbf24}
.stat-v.err{color:#fb7185}
.stat-v.pink{color:#f472b6}
.stat-v.cyan{color:#34d399}
.stat-l{font-size:8px;color:#8b8fa3;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
.diag{display:flex;align-items:center;justify-content:space-between;gap:8px;
margin-top:10px;padding-top:9px;border-top:1px dashed rgba(255,255,255,.08);
font-size:10px;color:#8b8fa3}
.diag b{color:#c7cad6;font-weight:700}
.log-row{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:8px;
background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);
font-size:10.5px;font-family:ui-monospace,SF Mono,Menlo,monospace}
.log-head{display:flex;justify-content:space-between;font-size:9px;color:#8b8fa3;gap:8px}
.log-user{color:#22d3ee;font-weight:700;font-size:11px;font-family:inherit}
.log-q{color:#c7cad6}
.log-r{color:#e5e7eb;font-family:inherit;font-size:11px;line-height:1.4;word-break:break-word}
.log-row.ok{border-color:rgba(52,211,153,.2)}
.log-row.fail{border-color:rgba(251,113,133,.25);background:rgba(251,113,133,.04)}
.log-row.capture{border-color:rgba(34,211,238,.2);background:rgba(34,211,238,.03);opacity:.85}
.log-row.chat{border-color:rgba(167,139,250,.25);background:rgba(167,139,250,.04)}
.log-row.solo{border-color:rgba(251,191,36,.28);background:rgba(251,191,36,.05)}
.log-row.room{border-color:rgba(244,114,182,.22);background:rgba(244,114,182,.03);opacity:.85}
.log-row.human{border-color:rgba(34,211,238,.35);background:rgba(34,211,238,.06)}
.log-row.skip{border-color:rgba(251,191,36,.2);background:rgba(251,191,36,.03);opacity:.85}
.log-tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:8.5px;font-weight:800;
letter-spacing:.05em;text-transform:uppercase;background:rgba(255,255,255,.06);color:#8b8fa3;margin-right:5px}
.log-tag.ok{background:rgba(52,211,153,.15);color:#a7f3d0}
.log-tag.fail{background:rgba(251,113,133,.15);color:#fca5b1}
.log-tag.capture{background:rgba(34,211,238,.15);color:#67e8f9}
.log-tag.chat{background:rgba(167,139,250,.18);color:#ddd6fe}
.log-tag.solo{background:rgba(251,191,36,.18);color:#fde68a}
.log-tag.room{background:rgba(244,114,182,.18);color:#fbcfe8}
.log-tag.human{background:rgba(34,211,238,.22);color:#a5f3fc}
.log-tag.skip{background:rgba(251,191,36,.15);color:#fde68a}
.empty{padding:30px 10px;text-align:center;color:#5b5f70;font-size:10.5px}
.foot{display:flex;justify-content:space-between;align-items:center;gap:8px;
padding:9px 14px;background:rgba(0,0,0,.22);
border-top:1px solid rgba(255,255,255,.05);
font-size:9.5px;color:#8b8fa3;flex-shrink:0}
.foot b{color:#c7cad6;font-weight:700}
.hint{font-size:9.5px;color:#8b8fa3;line-height:1.5;margin-top:6px}
.hint.warn{color:#fbbf24}
.hint.ok{color:#a7f3d0}
.hint.pink{color:#f472b6}
.hint.amber{color:#fbbf24}
.hint.cyan{color:#22d3ee}
.btn-primary{width:100%;padding:10px;border-radius:9px;cursor:pointer;font-family:inherit;
font-size:11px;font-weight:800;letter-spacing:.03em;
background:linear-gradient(120deg,#22d3ee,#a78bfa);color:#0b0b10;border:none;
transition:transform .15s,box-shadow .15s}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(34,211,238,.35)}
.btn-primary:active{transform:scale(.98)}
.btn-secondary{width:100%;padding:8px;border-radius:8px;cursor:pointer;font-family:inherit;
font-size:10.5px;font-weight:700;
background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
color:#c7cad6;transition:all .15s}
.btn-secondary:hover{background:rgba(255,255,255,.1)}
.sub-block{margin-top:10px;padding:10px 12px;border-radius:10px;
background:rgba(244,114,182,.04);border:1px solid rgba(244,114,182,.18)}
.sub-block.amber{background:rgba(251,191,36,.04);border-color:rgba(251,191,36,.2)}
.sub-block.cyan{background:rgba(34,211,238,.05);border-color:rgba(34,211,238,.22)}
.sub-block .grid2{margin-bottom:8px}
.sub-block .grid3{margin-bottom:8px}
.toast{position:absolute;left:50%;bottom:10px;transform:translate(-50%,8px);
opacity:0;pointer-events:none;z-index:5;
background:linear-gradient(120deg,#22d3ee,#a78bfa);color:#0b0b10;
font-weight:800;font-size:10.5px;padding:7px 14px;border-radius:20px;
white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.35);
transition:opacity .18s ease,transform .18s ease}
.toast.show{opacity:1;transform:translate(-50%,0)}
.badge-human{display:inline-block;padding:1px 7px;border-radius:10px;font-size:8.5px;font-weight:900;
letter-spacing:.08em;text-transform:uppercase;background:linear-gradient(120deg,#22d3ee,#34d399);
color:#0b0b10;margin-left:6px;animation:pulse 1.4s infinite}
`;
}

// HTML
function buildHTML(){
return `
<div class="head" id="head">
<div class="brand">
<span class="dot" id="dot"></span>
<span class="title">SANG BOT · GROQ</span>
<span class="badge-human" id="badgeHuman" style="display:none;">HUMANO</span>
</div>
<div class="actions">
<button class="btn" id="btnMin" type="button" title="Minimizar">−</button>
</div>
</div>
<div class="tabs" role="tablist">
<button class="tab active" data-tab="bot" role="tab" aria-selected="true">Bot</button>
<button class="tab" data-tab="config" role="tab" aria-selected="false">Config</button>
<button class="tab" data-tab="log" role="tab" aria-selected="false">Log</button>
</div>
<div class="body" id="body">
<div class="view" data-view="bot">

<div class="sec-title"><span class="num">1</span>Ligar o bot</div>
<div class="sec-group">
<div class="toggle" id="toggleEnable" role="switch" tabindex="0" aria-checked="false">
<div>
<div style="font-weight:700;font-size:12px;color:#fff;">Bot ativo</div>
<div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;" id="personaLine">Nordestino Lerdão</div>
</div>
<div class="switch" id="switchEnable"></div>
</div>
<div class="toggle cyan" id="toggleHuman" role="switch" tabindex="0" aria-checked="false">
<div>
<div style="font-weight:700;font-size:12.5px;color:#fff;">Modo Humano</div>
<div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;" id="humanLine">Ritmo natural, reação curta, typo ocasional, ajuste de tom</div>
</div>
<div class="switch cyan" id="switchHuman"></div>
</div>
<div class="sub-block cyan" id="humanCfg" style="display:none;">
<div class="hint cyan">Afeta todos os modos abaixo. Desligado volta ao comportamento original.</div>
<div class="grid3" style="margin-top:8px;">
<div><label class="f">Skip solo %</label><input class="inp" id="inpHSkipSolo" type="number" min="0" max="50" step="1" /></div>
<div><label class="f">Skip chat %</label><input class="inp" id="inpHSkipChat" type="number" min="0" max="50" step="1" /></div>
<div><label class="f">Reação %</label><input class="inp" id="inpHReact" type="number" min="0" max="50" step="1" /></div>
<div><label class="f">Ask-back %</label><input class="inp" id="inpHAsk" type="number" min="0" max="50" step="1" /></div>
<div><label class="f">Typo %</label><input class="inp" id="inpHTypo" type="number" min="0" max="20" step="1" /></div>
<div><label class="f">No-pont %</label><input class="inp" id="inpHNoPunct" type="number" min="0" max="80" step="5" /></div>
<div><label class="f">Delay base ms</label><input class="inp" id="inpHDelayBase" type="number" min="200" max="5000" step="100" /></div>
<div><label class="f">Delay/char ms</label><input class="inp" id="inpHDelayChar" type="number" min="0" max="100" step="1" /></div>
<div><label class="f">Jitter ms</label><input class="inp" id="inpHJitter" type="number" min="0" max="5000" step="100" /></div>
</div>
<button class="btn-secondary" id="btnHumanReset" type="button">Restaurar padrões</button>
</div>
</div>

<div class="sec-title"><span class="num">2</span>Como o bot responde (escolha 1)</div>
<div class="sec-group">
<div class="hint" style="margin:0 2px;">Trigger (padrão): só responde quando alguém escreve o comando em Config. Solo OU Conversa de Bot — exclusivos entre si.</div>
<div class="toggle amber" id="toggleSolo" role="switch" tabindex="0" aria-checked="false">
<div>
<div style="font-weight:700;font-size:12px;color:#fff;">Modo Solo</div>
<div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;" id="soloLine">Bot lê tudo e responde todos</div>
</div>
<div class="switch amber" id="switchSolo"></div>
</div>
<div class="sub-block amber" id="soloCfg" style="display:none;">
<div class="grid2">
<div><label class="f">Delay (ms)</label><input class="inp" id="inpSoloDelay" type="number" min="200" max="10000" step="100" /></div>
<div><label class="f">Turnos da sala</label><input class="inp" id="inpSoloTurns" type="number" min="5" max="100" step="5" /></div>
</div>
<label class="f" style="margin-top:8px;">Excluir usernames</label>
<textarea class="inp tall" id="inpSoloBlacklist" spellcheck="false" placeholder="Um nome por linha (ou vírgula)"></textarea>
<div class="hint amber" id="soloBlacklistHint">Nenhum nome excluído.</div>
<div class="hint" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
<span>Contexto: <b id="soloCtxInfo" style="color:#fde68a;">0 msgs · 0 users</b></span>
<button class="btn" id="btnClearSoloRoom" type="button" style="font-size:10px; padding:0 10px; height:22px;">Limpar contexto</button>
</div>
<div id="soloPreview" style="margin-top:10px; display:none;"></div>
</div>
<div class="toggle violet" id="toggleBotChat" role="switch" tabindex="0" aria-checked="false">
<div>
<div style="font-weight:700;font-size:12px;color:#fff;">Modo Conversa de Bot</div>
<div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;" id="botChatLine">User alvo: cariocaIA</div>
</div>
<div class="switch" id="switchBotChat"></div>
</div>
<div class="sec" id="botChatCfg" style="display:none;">
<div class="grid2">
<div><label class="f">User alvo</label><input class="inp" id="inpBotChatUser" type="text" placeholder="cariocaIA" spellcheck="false" autocomplete="off" /></div>
<div><label class="f">Turnos de contexto</label><input class="inp" id="inpBotChatTurns" type="number" min="5" max="200" step="5" /></div>
</div>
<div class="hint">Contexto persistente via UserStore.</div>
<div class="hint" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
<span>Histórico: <b id="botChatHistInfo" style="color:#c7cad6;">0 turnos</b></span>
<button class="btn" id="btnClearBotChat" type="button" style="font-size:10px; padding:0 10px; height:22px;">Limpar histórico</button>
</div>
<div class="toggle pink" id="toggleReadAll" role="switch" tabindex="0" aria-checked="false" style="margin-top:12px;">
<div>
<div style="font-weight:700;font-size:12px;color:#fff;">Ler sala toda</div>
<div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;" id="readAllLine">Contexto de todos os usuários</div>
</div>
<div class="switch pink" id="switchReadAll"></div>
</div>
<div class="sub-block" id="readAllCfg" style="display:none;">
<div class="grid2">
<div><label class="f">Delay (ms)</label><input class="inp" id="inpReadAllDelay" type="number" min="200" max="10000" step="100" /></div>
<div><label class="f">Turnos da sala</label><input class="inp" id="inpReadAllTurns" type="number" min="5" max="100" step="5" /></div>
</div>
<div class="hint pink">Só o User alvo dispara. Os outros alimentam o contexto.</div>
<div class="hint" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
<span>Contexto da sala: <b id="roomCtxInfo" style="color:#fbcfe8;">0 msgs · 0 users</b></span>
<button class="btn" id="btnClearRoom" type="button" style="font-size:10px; padding:0 10px; height:22px;">Limpar sala</button>
</div>
<div id="roomPreview" style="margin-top:10px; display:none;"></div>
</div>
</div>
</div>

<div class="sec-title"><span class="num">3</span>Memória e eficiência</div>
<div class="sec">
<div class="toggle cyan" id="toggleUserStore" role="switch" tabindex="0" aria-checked="true" style="margin-bottom:8px;">
<div><div style="font-weight:700;font-size:12px;color:#fff;">UserStore</div><div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;">Persistência por nickname (payload mínimo)</div></div>
<div class="switch cyan" id="switchUserStore"></div>
</div>
<div class="toggle cyan" id="toggleCache" role="switch" tabindex="0" aria-checked="true" style="margin-bottom:8px;">
<div><div style="font-weight:700;font-size:12px;color:#fff;">Cache semântico</div><div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;">Pega pergunta parecida, não só idêntica</div></div>
<div class="switch cyan" id="switchCache"></div>
</div>
<div class="toggle cyan" id="toggleSummaries" role="switch" tabindex="0" aria-checked="true" style="margin-bottom:8px;">
<div><div style="font-weight:700;font-size:12px;color:#fff;">Sumário progressivo</div><div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;">Comprime turnos antigos</div></div>
<div class="switch cyan" id="switchSummaries"></div>
</div>
<div class="toggle cyan" id="toggleProfile" role="switch" tabindex="0" aria-checked="true" style="margin-bottom:8px;">
<div><div style="font-weight:700;font-size:12px;color:#fff;">Perfil de usuário</div><div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;">Mini-perfil após 10 interações</div></div>
<div class="switch cyan" id="switchProfile"></div>
</div>
<div class="toggle cyan" id="toggleTopics" role="switch" tabindex="0" aria-checked="true" style="margin-bottom:8px;">
<div><div style="font-weight:700;font-size:12px;color:#fff;">Índice de tópicos</div><div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;">Rastreia quem falou sobre o quê</div></div>
<div class="switch cyan" id="switchTopics"></div>
</div>
<div class="toggle cyan" id="toggleAnchors" role="switch" tabindex="0" aria-checked="true" style="margin-bottom:8px;">
<div><div style="font-weight:700;font-size:12px;color:#fff;">Compressão em âncoras</div><div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;">Turnos antigos viram bullets de 1 linha</div></div>
<div class="switch cyan" id="switchAnchors"></div>
</div>
<div class="toggle cyan" id="toggleStripR" role="switch" tabindex="0" aria-checked="true">
<div><div style="font-weight:700;font-size:12px;color:#fff;">Anti-vazamento de pensamento</div><div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;">Remove reasoning que vaza no chat (THINK)</div></div>
<div class="switch cyan" id="switchStripR"></div>
</div>
<div class="hint" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
<span>Users: <b id="usInfo" style="color:#a7f3d0;">0</b> · Cache: <b id="cacheInfo" style="color:#a7f3d0;">0</b> · Sum: <b id="summInfo" style="color:#a7f3d0;">0</b> · Perf: <b id="profInfo" style="color:#a7f3d0;">0</b></span>
<button class="btn" id="btnClearCache" type="button" style="font-size:10px; padding:0 10px; height:22px;">Limpar cache</button>
</div>
<div class="grid2" style="margin-top:8px;">
<button class="btn-secondary" id="btnUsExport" type="button">Exportar UserStore</button>
<button class="btn-secondary" id="btnUsClear" type="button">Apagar UserStore</button>
</div>
<div class="hint" style="margin-top:6px;"><input class="inp" id="inpUsNick" type="text" placeholder="nickname pra inspecionar" /></div>
<button class="btn-secondary" id="btnUsInspect" type="button" style="margin-top:6px;">Ver dados do nick</button>
<div id="usPreview" style="margin-top:10px;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#c7cad6;max-height:200px;overflow-y:auto;"></div>
</div>

<div class="sec-title"><span class="num">4</span>Status e testes</div>
<div class="sec">
<div class="sec-label">Status</div>
<div class="stat-grid">
<div class="stat-cell"><div class="stat-v" id="stReq">0</div><div class="stat-l">Req</div></div>
<div class="stat-cell"><div class="stat-v" id="stOk">0</div><div class="stat-l">OK</div></div>
<div class="stat-cell"><div class="stat-v" id="stFail">0</div><div class="stat-l">Fail</div></div>
<div class="stat-cell"><div class="stat-v" id="stRetry">0</div><div class="stat-l">Retry</div></div>
<div class="stat-cell"><div class="stat-v warn" id="stEmpty">0</div><div class="stat-l">Vazias</div></div>
<div class="stat-cell"><div class="stat-v cyan" id="stCache">0</div><div class="stat-l">Cache</div></div>
<div class="stat-cell"><div class="stat-v warn" id="stSkip">0</div><div class="stat-l">Skip</div></div>
<div class="stat-cell"><div class="stat-v cyan" id="stCoa">0</div><div class="stat-l">Coal</div></div>
<div class="stat-cell"><div class="stat-v" id="stTok">0</div><div class="stat-l">Tokens</div></div>
</div>
<div class="hint" id="keyHint">—</div>
<div class="diag">
<span>Chat: <b id="chatDiagState">não verificado</b></span>
<button class="btn" id="btnCheckChat" type="button">Verificar</button>
</div>
</div>
<div class="sec">
<div class="sec-label">Testar</div>
<input class="inp" id="testInput" type="text" placeholder="pergunta + Enter..." />
<div class="hint">Chama Groq direto. Sem memória, sem fila, sem contexto.</div>
<div id="testOutput" style="margin-top:10px;"></div>
</div>
</div>
<div class="view" data-view="config" style="display:none;">
<div class="sec">
<div class="sec-label">API Keys · rotação automática</div>
<div id="keyList" style="display:flex;flex-direction:column;gap:6px;"></div>
<div style="display:flex;gap:6px;margin-top:10px;">
<input class="inp" id="inpNewKey" type="text" placeholder="Cole uma ou mais keys (gsk_...)" autocomplete="off" spellcheck="false" />
<button class="btn-secondary" id="btnAddKey" type="button" style="width:auto;padding:0 14px;flex-shrink:0;">Adicionar</button>
</div>
<div class="grid2" style="margin-top:10px;">
<div><label class="f">Limite diário / key</label><input class="inp" id="inpKeyLimit" type="number" min="1000" step="1000" /></div>
<div><label class="f">Modelo</label><input class="inp" type="text" value="GPT-OSS 120B" disabled /></div>
</div>
<div class="hint">Uso reseta automaticamente à meia-noite UTC (limites do Groq). Rotação automática ao esgotar.</div>
</div>
<div class="sec">
<div class="sec-label">Persona</div>
<div class="presets" id="presets"></div>
<label class="f">System prompt</label>
<textarea class="inp" id="inpPrompt" spellcheck="false"></textarea>
</div>
<div class="sec">
<div class="sec-label">Comportamento</div>
<div class="grid2">
<div><label class="f">Trigger</label><input class="inp" id="inpTrigger" type="text" spellcheck="false" /></div>
<div><label class="f">Cooldown (ms)</label><input class="inp" id="inpCooldown" type="number" min="0" step="100" /></div>
<div><label class="f">Temperature</label><input class="inp" id="inpTemp" type="number" min="0" max="2" step="0.1" /></div>
<div><label class="f">Max tokens</label><input class="inp" id="inpMaxTok" type="number" min="50" max="4000" step="50" /></div>
</div>
<label class="f" style="margin-top:10px;">Reasoning Effort</label>
<select class="inp" id="selReasoning">
<option value="low">Low (rápido, sem raciocínio exposto)</option>
<option value="medium">Medium (raciocínio interno — não vaza)</option>
<option value="high">High (raciocínio profundo — não vaza)</option>
</select>
<div class="hint">Trigger em qualquer posição da msg. Fila: ${MAX_QUEUE}. Comandos: reset · status · silence &lt;min&gt; · help.</div>
<div class="toggle" id="togglePrefix" role="switch" tabindex="0" aria-checked="true" style="margin-top:10px;">
<div><div style="font-weight:700;font-size:12px;color:#fff;">Prefixo @user</div><div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;">Menciona quem perguntou</div></div>
<div class="switch" id="switchPrefix"></div>
</div>
</div>
<button class="btn-primary" id="btnSave" type="button">Salvar tudo</button>
</div>
<div class="view" data-view="log" style="display:none;">
<div class="sec" style="padding:9px 11px;">
<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
<div style="display:flex;align-items:center;gap:8px;">
<span class="sec-label" style="margin:0;">Histórico</span>
<button class="btn" id="btnDebugToggle" type="button" title="Log verboso">DBG</button>
</div>
<div style="display:flex;gap:6px;">
<button class="btn" id="btnClearLog" type="button">Limpar log</button>
<button class="btn" id="btnClearMemory" type="button">Limpar memória</button>
</div>
</div>
</div>
<div id="logList" style="display:flex;flex-direction:column;gap:5px;"></div>
</div>
</div>
<div class="foot">
<span id="footLeft">—</span>
<span><b id="footQueue">0</b> na fila</span>
</div>
<div class="toast" id="toast"></div>
`;
}

// DOM
function buildHost(){
host=document.createElement('div');
host.id='_aibot_host';
host.setAttribute('data-hub','1');
host.setAttribute('data-sang-ui','');
host.style.cssText='all:initial;position:fixed;top:20px;right:20px;z-index:2147483647;';
document.documentElement.appendChild(host);
try{window._hubUI?.markProtected?.(host);}catch(e){}
shadow=host.attachShadow({mode:'open'});
const style=document.createElement('style');
style.textContent=buildStyle();
shadow.appendChild(style);
const panel=document.createElement('div');
panel.className='panel';
panel.innerHTML=buildHTML();
shadow.appendChild(panel);
const $=id=>shadow.getElementById(id);
ui.panel=panel;ui.dot=$('dot');ui.body=$('body');ui.head=$('head');ui.badgeHuman=$('badgeHuman');
ui.switchHuman=$('switchHuman');ui.toggleHuman=$('toggleHuman');ui.humanLine=$('humanLine');ui.humanCfg=$('humanCfg');
ui.inpHSkipSolo=$('inpHSkipSolo');ui.inpHSkipChat=$('inpHSkipChat');ui.inpHReact=$('inpHReact');ui.inpHAsk=$('inpHAsk');
ui.inpHTypo=$('inpHTypo');ui.inpHNoPunct=$('inpHNoPunct');ui.inpHDelayBase=$('inpHDelayBase');ui.inpHDelayChar=$('inpHDelayChar');ui.inpHJitter=$('inpHJitter');
ui.switchE=$('switchEnable');ui.toggleE=$('toggleEnable');
ui.switchSolo=$('switchSolo');ui.toggleSolo=$('toggleSolo');ui.soloLine=$('soloLine');ui.soloCfg=$('soloCfg');ui.soloCtxInfo=$('soloCtxInfo');ui.soloPreview=$('soloPreview');
ui.inpSoloDelay=$('inpSoloDelay');ui.inpSoloTurns=$('inpSoloTurns');ui.inpSoloBlacklist=$('inpSoloBlacklist');ui.soloBlacklistHint=$('soloBlacklistHint');
ui.switchBC=$('switchBotChat');ui.toggleBC=$('toggleBotChat');ui.botChatLine=$('botChatLine');ui.botChatCfg=$('botChatCfg');ui.botChatHistInfo=$('botChatHistInfo');
ui.inpBotChatUser=$('inpBotChatUser');ui.inpBotChatTurns=$('inpBotChatTurns');
ui.switchRA=$('switchReadAll');ui.toggleRA=$('toggleReadAll');ui.readAllLine=$('readAllLine');ui.readAllCfg=$('readAllCfg');
ui.inpReadAllDelay=$('inpReadAllDelay');ui.inpReadAllTurns=$('inpReadAllTurns');
ui.roomCtxInfo=$('roomCtxInfo');ui.roomPreview=$('roomPreview');
ui.switchUs=$('switchUserStore');ui.toggleUs=$('toggleUserStore');
ui.switchCache=$('switchCache');ui.toggleCache=$('toggleCache');
ui.switchSumm=$('switchSummaries');ui.toggleSumm=$('toggleSummaries');
ui.switchProf=$('switchProfile');ui.toggleProf=$('toggleProfile');
ui.switchTop=$('switchTopics');ui.toggleTop=$('toggleTopics');
ui.switchAnch=$('switchAnchors');ui.toggleAnch=$('toggleAnchors');
ui.switchStrip=$('switchStripR');ui.toggleStrip=$('toggleStripR');
ui.usInfo=$('usInfo');ui.cacheInfo=$('cacheInfo');ui.summInfo=$('summInfo');ui.profInfo=$('profInfo');
ui.usPreview=$('usPreview');ui.inpUsNick=$('inpUsNick');
ui.personaLine=$('personaLine');
ui.stReq=$('stReq');ui.stOk=$('stOk');ui.stFail=$('stFail');ui.stRetry=$('stRetry');ui.stEmpty=$('stEmpty');ui.stCache=$('stCache');ui.stSkip=$('stSkip');ui.stCoa=$('stCoa');ui.stTok=$('stTok');
ui.keyHint=$('keyHint');ui.chatDiagState=$('chatDiagState');
ui.keyList=$('keyList');ui.inpNewKey=$('inpNewKey');ui.btnAddKey=$('btnAddKey');ui.inpKeyLimit=$('inpKeyLimit');
ui.presets=$('presets');ui.inpPrompt=$('inpPrompt');
ui.inpTrigger=$('inpTrigger');ui.inpCooldown=$('inpCooldown');ui.inpTemp=$('inpTemp');ui.inpMaxTok=$('inpMaxTok');ui.selReasoning=$('selReasoning');
ui.switchP=$('switchPrefix');ui.toggleP=$('togglePrefix');
ui.testInput=$('testInput');ui.testOutput=$('testOutput');
ui.logList=$('logList');ui.footLeft=$('footLeft');ui.footQueue=$('footQueue');
ui.toast=$('toast');ui.btnDebugToggle=$('btnDebugToggle');
Object.entries(PERSONAS).forEach(([k,p])=>{const b=document.createElement('button');b.type='button';b.className='preset';b.dataset.persona=k;b.textContent=p.label;b.addEventListener('click',()=>K.selectPersona(k));ui.presets.appendChild(b);});
}

// SYNC (settings → inputs)
function sync(){
ui.inpPrompt.value=settings.systemPrompt;
ui.inpTrigger.value=settings.trigger;ui.inpCooldown.value=settings.cooldownMs;
ui.inpTemp.value=settings.temperature;ui.inpMaxTok.value=settings.maxTokens;
ui.selReasoning.value=settings.reasoningEffort;
ui.inpBotChatUser.value=settings.botChatUser||DEFAULT_BOTCHAT_USER;
ui.inpBotChatTurns.value=settings.botChatTurns;
ui.inpReadAllDelay.value=settings.botChatReadAllDelay;ui.inpReadAllTurns.value=settings.botChatReadAllTurns;
ui.inpSoloDelay.value=settings.soloDelay;ui.inpSoloTurns.value=settings.soloTurns;
ui.inpSoloBlacklist.value=(settings.soloBlacklist||[]).join('\n');
ui.inpKeyLimit.value=settings.keyLimit;
ui.btnDebugToggle.classList.toggle('on',K.debugEnabled);
const hc=settings.humanConfig;
ui.inpHSkipSolo.value=Math.round(hc.skipSolo*100);
ui.inpHSkipChat.value=Math.round(hc.skipChat*100);
ui.inpHReact.value=Math.round(hc.reaction*100);
ui.inpHAsk.value=Math.round(hc.askBack*100);
ui.inpHTypo.value=Math.round(hc.typo*100);
ui.inpHNoPunct.value=Math.round(hc.noPunct*100);
ui.inpHDelayBase.value=hc.delayBase;
ui.inpHDelayChar.value=hc.delayPerChar;
ui.inpHJitter.value=hc.delayJitter;
ui.presets.querySelectorAll('.preset').forEach(b=>b.classList.toggle('active',b.dataset.persona===settings.personaKey));
}

// UI
function setTgl(sw,tg,on){sw.classList.toggle('on',on);tg.classList.toggle('on',on);tg.setAttribute('aria-checked',String(on));}

function renderKeys(){
if(!ui.keyList)return;
if(!settings.apiKeys.length){ui.keyList.innerHTML='<div class="hint warn">Nenhuma key cadastrada — o bot não vai responder.</div>';return;}
const now=Date.now();
ui.keyList.innerHTML=settings.apiKeys.map((k,i)=>{
K.refreshKeyDaily(k,now);
const limit=Number(k.limit)||DEFAULT_DAILY_LIMIT;
const used=k.usedToday||0;
const pct=Math.min(1,used/limit);
const color=pct>=0.9?'#fb7185':pct>=0.7?'#fbbf24':'#34d399';
const cd=k.cooldownUntil&&k.cooldownUntil>now;
const st=cd?'<span style="color:#fb7185;font-size:9px;font-weight:800;letter-spacing:.05em;">COOLDOWN</span>':'';
return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);font-size:11px;">'
+'<div style="width:38px;height:22px;border-radius:6px;background:rgba(255,255,255,.05);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px;color:'+color+';">'+Math.round(pct*100)+'%</div>'
+'<span style="color:#c7cad6;font-family:ui-monospace,monospace;flex:1;">…'+esc((k.key||'').slice(-6))+'</span>'
+'<span style="color:'+color+';font-weight:800;font-variant-numeric:tabular-nums;font-size:10.5px;">'+fmtTok(used)+'/'+fmtTok(limit)+'</span>'
+st
+'<button class="btn" data-kr="'+i+'" type="button" title="Remover" style="min-width:22px;padding:0 6px;">×</button>'
+'</div>';
}).join('');
ui.keyList.querySelectorAll('[data-kr]').forEach(b=>{
b.addEventListener('click',()=>{
const i=parseInt(b.dataset.kr,10);if(Number.isNaN(i))return;
settings.apiKeys.splice(i,1);K.persistKeys();renderKeys();refreshStatus();
showToast('Key removida');
});
});
}

function refreshToggle(){
setTgl(ui.switchHuman,ui.toggleHuman,settings.humanMode);
ui.humanLine.textContent=settings.humanMode?'ATIVO · ritmo, reação, typo, tom':'Ritmo natural, reação curta, typo ocasional';
ui.humanCfg.style.display=settings.humanMode?'':'none';
ui.badgeHuman.style.display=settings.humanMode?'':'none';
setTgl(ui.switchE,ui.toggleE,settings.enabled);
setTgl(ui.switchSolo,ui.toggleSolo,settings.soloMode);
ui.soloLine.textContent=settings.soloMode?'Ativo · '+settings.soloDelay+'ms · '+settings.soloTurns+' turnos':'Bot lê tudo e responde todos';
ui.soloCfg.style.display=settings.soloMode?'':'none';
if(ui.soloBlacklistHint){const n=(settings.soloBlacklist||[]).length;ui.soloBlacklistHint.textContent=n===0?'Nenhum nome excluído.':n+' nome'+(n===1?'':'s')+' excluído'+(n===1?'':'s')+': '+settings.soloBlacklist.join(', ');}
setTgl(ui.switchBC,ui.toggleBC,settings.botChatMode);
ui.botChatLine.textContent='User alvo: '+(settings.botChatUser||DEFAULT_BOTCHAT_USER)+' · '+settings.botChatTurns+' turnos';
ui.botChatCfg.style.display=settings.botChatMode?'':'none';
setTgl(ui.switchRA,ui.toggleRA,settings.botChatReadAll);
ui.readAllLine.textContent=settings.botChatReadAll?'Ativo · '+settings.botChatReadAllDelay+'ms · '+settings.botChatReadAllTurns+' turnos':'Contexto de todos os usuários';
ui.readAllCfg.style.display=settings.botChatReadAll?'':'none';
setTgl(ui.switchUs,ui.toggleUs,settings.userStoreEnabled);
setTgl(ui.switchCache,ui.toggleCache,settings.cacheEnabled);
setTgl(ui.switchSumm,ui.toggleSumm,settings.summariesEnabled);
setTgl(ui.switchProf,ui.toggleProf,settings.profileEnabled);
setTgl(ui.switchTop,ui.toggleTop,settings.topicsEnabled);
setTgl(ui.switchAnch,ui.toggleAnch,settings.anchorsEnabled);
setTgl(ui.switchStrip,ui.toggleStrip,settings.stripReasoningEnabled);
setTgl(ui.switchP,ui.toggleP,settings.prefixReply);
UserStore.load();
ui.cacheInfo.textContent=responseCache.size;
ui.summInfo.textContent=(()=>{let n=0;for(const v of UserStore.map.values())if(v.summary)n++;return n;})();
ui.profInfo.textContent=(()=>{let n=0;for(const v of UserStore.map.values())if(v.profile&&(v.profile.text||v.profile.notes))n++;return n;})();
const us=UserStore.stats();
ui.usInfo.textContent=us.users+' · '+(us.bytes/1024).toFixed(1)+'KB';
ui.personaLine.textContent=PERSONAS[settings.personaKey]?.label||'Custom';
const bc=K.botChatMemoryCount(settings.botChatUser);const users=K.botChatUsersCount();
ui.botChatHistInfo.textContent=bc+' turno'+(bc===1?'':'s')+(users>1?' (+'+(users-1)+' users)':'');
const sum=K.roomContextSummary();const ctxInfo=sum.total+' msgs · '+sum.users+' user'+(sum.users===1?'':'s');
ui.roomCtxInfo.textContent=ctxInfo;
ui.soloCtxInfo.textContent=ctxInfo;
renderRoomPreview(ui.roomPreview);
renderRoomPreview(ui.soloPreview);
renderKeys();
updateDot();updateFoot();
}

function renderRoomPreview(target){
if(!target)return;
const roomContext=K.roomContext;
const isSolo=target===ui.soloPreview;
const active=isSolo?settings.soloMode:(settings.botChatMode&&settings.botChatReadAll);
if(!active||!roomContext.length){target.style.display='none';return;}
target.style.display='block';
const lastFew=roomContext.slice(-6);
const accent=isSolo?'#fbbf24':'#f472b6';
const html=lastFew.map(m=>{const bl=isSolo&&K.isBlacklisted(m.user);return '<div style="padding:3px 0;font-size:10px;color:#8b8fa3;font-family:ui-monospace,Menlo,monospace;border-bottom:1px dashed rgba(255,255,255,.04);'+(bl?'opacity:.35;text-decoration:line-through;':'')+'">'+'<span style="color:'+accent+';font-weight:700;">'+esc(m.user)+'</span>'+'<span style="color:#c7cad6;"> · '+esc(truncate(m.msg,80))+'</span>'+'</div>';}).join('');
target.innerHTML='<div style="font-size:9px;color:'+accent+';text-transform:uppercase;letter-spacing:.06em;font-weight:800;margin-bottom:6px;">Últimas '+lastFew.length+'</div>'+html;
}

function updateDot(){
if(!ui.dot)return;
ui.dot.classList.remove('on','busy','chat','room','solo','human');
if(!settings.enabled)return;
if(K.processing)ui.dot.classList.add('busy');
else if(settings.humanMode)ui.dot.classList.add('human');
else if(settings.soloMode)ui.dot.classList.add('solo');
else if(settings.botChatMode&&settings.botChatReadAll)ui.dot.classList.add('room');
else if(settings.botChatMode)ui.dot.classList.add('chat');
else ui.dot.classList.add('on');
}

function updateFoot(){
if(!ui.footLeft)return;
const model=MODELS.find(m=>m.id===settings.model);
const tags=[];
if(settings.humanMode)tags.push('humano');
if(settings.soloMode)tags.push('solo');
if(settings.botChatMode)tags.push('chat:'+(settings.botChatUser||DEFAULT_BOTCHAT_USER));
if(settings.botChatMode&&settings.botChatReadAll)tags.push('sala');
if(settings.userStoreEnabled)tags.push('store');
if(settings.cacheEnabled)tags.push('cache');
if(settings.apiKeys.length)tags.push(settings.apiKeys.length+' keys');
const tag=tags.length?' · '+tags.join(' · '):'';
ui.footLeft.textContent=(model?model.label:settings.model)+' · '+settings.reasoningEffort+tag;
}

function refreshStatus(){
if(!ui.stReq)return;
ui.stReq.textContent=stats.requests;ui.stOk.textContent=stats.ok;ui.stFail.textContent=stats.fail;
ui.stRetry.textContent=stats.retries;ui.stEmpty.textContent=stats.empty;
ui.stCache.textContent=stats.cacheHits||0;
ui.stSkip.textContent=stats.skips||0;
ui.stCoa.textContent=stats.coalesced||0;
ui.stTok.textContent=stats.tokens;
const a=K.getActiveKey();
if(!a){
const anyKey=settings.apiKeys.length>0;
ui.keyHint.innerHTML='<span style="color:#fbbf24;">⚠ '+(anyKey?'todas as keys esgotadas':'nenhuma API key cadastrada')+'.</span>';
}else{
const limit=Number(a.limit)||DEFAULT_DAILY_LIMIT;
const used=a.usedToday||0;
const pct=used/limit;
const col=pct>=0.9?'#fb7185':pct>=0.7?'#fbbf24':'#a7f3d0';
const suffix=' <span style="color:#8b8fa3;font-family:ui-monospace,monospace;">…'+esc(a.key.slice(-4))+'</span>';
const prefix='<b style="color:'+col+';">'+fmtTok(used)+'/'+fmtTok(limit)+'</b>'+suffix+' · ';
if(!settings.enabled){ui.keyHint.innerHTML=prefix+'<span>Bot desligado.</span>';}
else{
const parts=[];
const cbOpenUntil=K.cbOpenUntil,silencedUntil=K.silencedUntil;
if(cbOpenUntil&&Date.now()<cbOpenUntil){const s=Math.ceil((cbOpenUntil-Date.now())/1000);parts.push('<b style="color:#fb7185;">CB '+s+'s</b>');}
if(silencedUntil&&Date.now()<silencedUntil){const min=Math.ceil((silencedUntil-Date.now())/60000);parts.push('<b style="color:#fb7185;">silenciado '+min+'min</b>');}
if(settings.humanMode)parts.push('<b style="color:#22d3ee;">humano</b>');
if(settings.soloMode){const bl=(settings.soloBlacklist||[]).length;parts.push('<b style="color:#fbbf24;">solo</b>'+(bl?' · '+bl+' excluído'+(bl===1?'':'s'):''));}
else{parts.push('trigger <b style="color:#22d3ee;">'+esc(settings.trigger)+'</b>');if(settings.botChatMode)parts.push('conversa <b style="color:#a78bfa;">'+esc(settings.botChatUser)+'</b>');if(settings.botChatMode&&settings.botChatReadAll)parts.push('<b style="color:#f472b6;">sala</b>');}
ui.keyHint.innerHTML=prefix+'Escutando '+parts.join(' · ')+'.';
}
}
}
function updateStats(){refreshStatus();updateDot();refreshToggle();}
function updateQueue(){if(ui.footQueue)ui.footQueue.textContent=queue.length;}
function showToast(msg){if(!ui.toast)return;ui.toast.textContent=msg;ui.toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>ui.toast&&ui.toast.classList.remove('show'),1800);}

// LOG
function renderLog(){
if(!ui.logList)return;
const logs=K.logs,debugLog=K.debugLog,debugEnabled=K.debugEnabled;
const items=[];
logs.forEach(l=>{
const isHuman=l.info&&l.info.indexOf('humano')!==-1;
const isSolo=l.info&&l.info.indexOf('solo')!==-1;
const isChat=l.info&&l.info.indexOf('conversa')!==-1;
const isRoom=l.info&&l.info.indexOf('sala')!==-1;
const isCmd=l.info&&l.info.indexOf('comando')!==-1;
let cls;
if(l.status==='ok')cls=isCmd?'capture':(isHuman?'human':(isSolo?'solo':(isRoom?'room':(isChat?'chat':'ok'))));
else if(l.status==='error'||l.status==='send-fail'||l.status==='no-key')cls='fail';
else cls='skip';
const tag='<span class="log-tag '+cls+'">'+esc(l.status)+'</span>';
const info=l.info?'<span style="color:#fbbf24;font-size:9px;">'+esc(l.info)+'</span>':'';
items.push({sortId:l.id,html:'<div class="log-row '+cls+'"><div class="log-head"><span class="log-user">'+esc(l.user)+'</span><span>'+esc(l.t)+'</span></div><div class="log-q">'+tag+'→ '+esc(truncate(l.q,140))+'</div>'+(l.r&&l.r!=='—'?'<div class="log-r">← '+esc(truncate(l.r,200))+'</div>':'')+info+'</div>'});
});
if(debugEnabled){
debugLog.forEach(d=>{
let cls='';
if(d.tag==='capture')cls='capture';
else if(d.tag==='trigger')cls='ok';
else if(d.tag==='solo')cls='solo';
else if(d.tag==='botchat')cls='chat';
else if(d.tag==='room')cls='room';
else if(d.tag==='human')cls='human';
else if(d.tag==='summ'||d.tag==='prof'||d.tag==='userstore'||d.tag==='budget')cls='capture';
else if(d.tag==='cmd')cls='capture';
else if(d.tag==='cache')cls='ok';
else if(d.tag==='cb')cls='fail';
else if(d.tag==='key')cls='human';
else if(d.tag==='coalesce')cls='human';
else if(d.tag==='miss'||d.tag==='cooldown'||d.tag==='empty'||d.tag==='silence')cls='skip';
items.push({sortId:1000000+d.id,html:'<div class="log-row '+cls+'"><div class="log-head"><span><span class="log-tag '+cls+'">'+esc(d.tag)+'</span></span><span>'+esc(d.t)+'</span></div><div class="log-q">'+esc(d.text)+'</div></div>'});
});
}
if(!items.length){ui.logList.innerHTML='<div class="empty">Nenhuma atividade ainda.</div>';return;}
ui.logList.innerHTML=items.map(i=>i.html).join('');
ui.logList.parentElement.scrollTop=ui.logList.parentElement.scrollHeight;
}

// EVENTS
function bindToggle(el,onClick,sig){el.addEventListener('click',onClick,sig);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}},sig);}
function flip(key,el,label){bindToggle(el,()=>{K.saveSetting(key,!settings[key]);refreshToggle();showToast(label+' '+(settings[key]?'ligado':'desligado'));},{signal:ac.signal});}

function bindUI(){
const sig={signal:ac.signal};
const stop=e=>e.stopPropagation();
['keydown','keyup','keypress','input','beforeinput'].forEach(evt=>host.addEventListener(evt,stop,sig));
shadow.querySelectorAll('.tab').forEach(t=>{t.addEventListener('click',()=>{shadow.querySelectorAll('.tab').forEach(x=>{x.classList.toggle('active',x===t);x.setAttribute('aria-selected',String(x===t));});shadow.querySelectorAll('.view').forEach(v=>{v.style.display=v.dataset.view===t.dataset.tab?'':'none';});},sig);});
shadow.getElementById('btnMin').addEventListener('click',()=>{ui.panel.classList.toggle('collapsed');},sig);
bindToggle(ui.toggleHuman,()=>{K.saveSetting('humanMode',!settings.humanMode);refreshToggle();showToast(settings.humanMode?'Modo Humano LIGADO':'Modo Humano desligado');dbg('human','mode='+settings.humanMode);},sig);
const hcInputs=[['inpHSkipSolo','skipSolo',0.01,0.5,100],['inpHSkipChat','skipChat',0.01,0.5,100],['inpHReact','reaction',0.01,0.5,100],['inpHAsk','askBack',0.01,0.5,100],['inpHTypo','typo',0.01,0.2,100],['inpHNoPunct','noPunct',0.01,0.8,100],['inpHDelayBase','delayBase',200,5000,1],['inpHDelayChar','delayPerChar',0,100,1],['inpHJitter','delayJitter',0,5000,1]];
hcInputs.forEach(([id,key,min,max,scale])=>{const el=ui[id];if(!el)return;el.addEventListener('change',()=>{let v=parseFloat(el.value);if(Number.isNaN(v))v=0;if(scale===100)v=Math.min(max,Math.max(min,v/100));else v=Math.min(max,Math.max(min,v));settings.humanConfig[key]=v;K.saveHumanConfig();el.value=scale===100?Math.round(v*100):v;dbg('human','cfg '+key+'='+v);},sig);});
shadow.getElementById('btnHumanReset').addEventListener('click',()=>{settings.humanConfig=Object.assign({},HUMAN_DEFAULTS);K.saveHumanConfig();sync();showToast('Padrões restaurados ✓');},sig);
bindToggle(ui.toggleE,()=>{K.saveSetting('enabled',!settings.enabled);refreshToggle();refreshStatus();},sig);
bindToggle(ui.toggleSolo,()=>{const next=!settings.soloMode;K.saveSetting('soloMode',next);if(next&&settings.botChatMode)K.saveSetting('botChatMode',false);if(!next)K.clearRoomContext();refreshToggle();refreshStatus();},sig);
bindToggle(ui.toggleBC,()=>{const next=!settings.botChatMode;K.saveSetting('botChatMode',next);if(next&&settings.soloMode)K.saveSetting('soloMode',false);if(!next)K.clearRoomContext();refreshToggle();refreshStatus();},sig);
bindToggle(ui.toggleRA,()=>{K.saveSetting('botChatReadAll',!settings.botChatReadAll);if(!settings.botChatReadAll)K.clearRoomContext();refreshToggle();refreshStatus();},sig);
flip('userStoreEnabled',ui.toggleUs,'UserStore');
flip('cacheEnabled',ui.toggleCache,'Cache');
flip('summariesEnabled',ui.toggleSumm,'Sumário');
flip('profileEnabled',ui.toggleProf,'Perfil');
flip('topicsEnabled',ui.toggleTop,'Tópicos');
flip('anchorsEnabled',ui.toggleAnch,'Âncoras');
flip('stripReasoningEnabled',ui.toggleStrip,'Anti-vazamento');
bindToggle(ui.toggleP,()=>{K.saveSetting('prefixReply',!settings.prefixReply);refreshToggle();},sig);
ui.inpSoloDelay.addEventListener('change',()=>{const v=Math.max(200,Math.min(10000,parseInt(ui.inpSoloDelay.value,10)||DEFAULT_READALL_DELAY));ui.inpSoloDelay.value=v;K.saveSetting('soloDelay',v);refreshToggle();},sig);
ui.inpSoloTurns.addEventListener('change',()=>{const v=Math.max(5,Math.min(100,parseInt(ui.inpSoloTurns.value,10)||DEFAULT_READALL_TURNS));ui.inpSoloTurns.value=v;K.saveSetting('soloTurns',v);K.trimRoom(v);refreshToggle();},sig);
ui.inpSoloBlacklist.addEventListener('change',()=>{const arr=K.parseBlacklist(ui.inpSoloBlacklist.value);K.saveSetting('soloBlacklist',arr);refreshToggle();refreshStatus();showToast(arr.length+' nome'+(arr.length===1?'':'s')+' excluído'+(arr.length===1?'':'s'));},sig);
ui.inpSoloBlacklist.addEventListener('blur',()=>{ui.inpSoloBlacklist.value=K.parseBlacklist(ui.inpSoloBlacklist.value).join('\n');},sig);
ui.inpBotChatUser.addEventListener('change',()=>{K.saveSetting('botChatUser',ui.inpBotChatUser.value.trim()||DEFAULT_BOTCHAT_USER);refreshToggle();},sig);
ui.inpBotChatTurns.addEventListener('change',()=>{const v=Math.max(5,Math.min(200,parseInt(ui.inpBotChatTurns.value,10)||40));ui.inpBotChatTurns.value=v;K.saveSetting('botChatTurns',v);refreshToggle();},sig);
ui.inpReadAllDelay.addEventListener('change',()=>{const v=Math.max(200,Math.min(10000,parseInt(ui.inpReadAllDelay.value,10)||DEFAULT_READALL_DELAY));ui.inpReadAllDelay.value=v;K.saveSetting('botChatReadAllDelay',v);refreshToggle();},sig);
ui.inpReadAllTurns.addEventListener('change',()=>{const v=Math.max(5,Math.min(100,parseInt(ui.inpReadAllTurns.value,10)||DEFAULT_READALL_TURNS));ui.inpReadAllTurns.value=v;K.saveSetting('botChatReadAllTurns',v);K.trimRoom(v);refreshToggle();},sig);
shadow.getElementById('btnClearBotChat').addEventListener('click',()=>{K.clearBotChatMemory(settings.botChatUser);K.clearBotChatSummary(settings.botChatUser);refreshToggle();showToast('Histórico do user alvo apagado ✓');},sig);
shadow.getElementById('btnClearRoom').addEventListener('click',()=>{K.clearRoomContext();showToast('Contexto da sala apagado ✓');},sig);
shadow.getElementById('btnClearSoloRoom').addEventListener('click',()=>{K.clearRoomContext();showToast('Contexto do solo apagado ✓');},sig);
shadow.getElementById('btnClearCache').addEventListener('click',()=>{K.cacheClear();refreshToggle();showToast('Cache apagado ✓');},sig);
shadow.getElementById('btnUsClear').addEventListener('click',()=>{if(!confirm('Apagar UserStore de todos?'))return;UserStore.clearAll();refreshToggle();showToast('UserStore apagado ✓');},sig);
shadow.getElementById('btnUsExport').addEventListener('click',()=>{UserStore.load();const obj={};for(const[k,v]of UserStore.map)obj[k]=v;const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='userstore-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},sig);
shadow.getElementById('btnUsInspect').addEventListener('click',()=>{const nick=(ui.inpUsNick.value||'').trim().toLowerCase();if(!nick){showToast('Digite um nickname');return;}ui.usPreview.textContent=JSON.stringify(UserStore.get(nick),null,2);},sig);
ui.btnAddKey.addEventListener('click',()=>{const n=K.addKeysFromInput(ui.inpNewKey.value);if(n){ui.inpNewKey.value='';showToast(n+' key'+(n===1?'':'s')+' adicionada'+(n===1?'':'s'));K.healthCheck();renderKeys();refreshStatus();}else showToast('Nenhuma key válida');},sig);
ui.inpNewKey.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();ui.btnAddKey.click();}},sig);
ui.inpKeyLimit.addEventListener('change',()=>{const v=Math.max(1000,parseInt(ui.inpKeyLimit.value,10)||DEFAULT_DAILY_LIMIT);ui.inpKeyLimit.value=v;K.saveSetting('keyLimit',v);for(const k of settings.apiKeys)k.limit=v;K.persistKeys();renderKeys();refreshStatus();},sig);
ui.inpPrompt.addEventListener('input',()=>{const cur=PERSONAS[settings.personaKey]?.prompt;const drift=ui.inpPrompt.value!==cur;ui.presets.querySelectorAll('.preset').forEach(b=>{b.classList.toggle('active',drift?b.dataset.persona==='custom':b.dataset.persona===settings.personaKey);});},sig);
shadow.getElementById('btnCheckChat').addEventListener('click',()=>{const el=K.findChatInput();if(el){ui.chatDiagState.textContent='detectado';ui.chatDiagState.style.color='#34d399';ui.chatDiagState.title=K.detectedInputSel;}else{ui.chatDiagState.textContent='não encontrado';ui.chatDiagState.style.color='#fb7185';ui.chatDiagState.title='';}},sig);
shadow.getElementById('btnSave').addEventListener('click',()=>{
K.saveSetting('systemPrompt',ui.inpPrompt.value);
K.saveSetting('trigger',ui.inpTrigger.value.trim()||'/bot');
K.saveSetting('cooldownMs',Math.max(0,parseInt(ui.inpCooldown.value,10)||0));
K.saveSetting('temperature',Math.min(2,Math.max(0,parseFloat(ui.inpTemp.value)||0.85)));
K.saveSetting('maxTokens',Math.max(50,Math.min(4000,parseInt(ui.inpMaxTok.value,10)||500)));
K.saveSetting('reasoningEffort',REASONING_EFFORTS.includes(ui.selReasoning.value)?ui.selReasoning.value:'low');
K.saveSetting('botChatUser',ui.inpBotChatUser.value.trim()||DEFAULT_BOTCHAT_USER);
K.saveSetting('botChatTurns',Math.max(5,Math.min(200,parseInt(ui.inpBotChatTurns.value,10)||40)));
K.saveSetting('botChatReadAllDelay',Math.max(200,Math.min(10000,parseInt(ui.inpReadAllDelay.value,10)||DEFAULT_READALL_DELAY)));
K.saveSetting('botChatReadAllTurns',Math.max(5,Math.min(100,parseInt(ui.inpReadAllTurns.value,10)||DEFAULT_READALL_TURNS)));
K.saveSetting('soloDelay',Math.max(200,Math.min(10000,parseInt(ui.inpSoloDelay.value,10)||DEFAULT_READALL_DELAY)));
K.saveSetting('soloTurns',Math.max(5,Math.min(100,parseInt(ui.inpSoloTurns.value,10)||DEFAULT_READALL_TURNS)));
K.saveSetting('soloBlacklist',K.parseBlacklist(ui.inpSoloBlacklist.value));
if(ui.inpPrompt.value!==PERSONAS[settings.personaKey]?.prompt)settings.personaKey='custom';
K.saveSetting('personaKey',settings.personaKey);
sync();refreshToggle();refreshStatus();showToast('Configurações salvas ✓');
},sig);
ui.testInput.addEventListener('keydown',async e=>{if(e.key!=='Enter')return;e.preventDefault();const q=ui.testInput.value.trim();if(!q)return;if(!K.getActiveKey()){ui.testOutput.innerHTML='<div class="hint warn">Sem API key disponível.</div>';return;}ui.testOutput.innerHTML='<div class="hint" style="color:#22d3ee;">consultando…</div>';try{const r=await K.callGroq(q);ui.testOutput.innerHTML='<div class="hint ok">'+esc(r||'(vazio)')+'</div>';}catch(err){ui.testOutput.innerHTML='<div class="hint warn">'+esc(String(err.message||err))+'</div>';}},sig);
shadow.getElementById('btnClearLog').addEventListener('click',()=>K.clearLogs(),sig);
shadow.getElementById('btnClearMemory').addEventListener('click',()=>{K.clearMemory();K.clearBotChatMemory();K.clearBotChatSummary();K.clearUserProfile();K.clearLastUserAt();refreshToggle();showToast('Memória total apagada ✓');},sig);
ui.btnDebugToggle.addEventListener('click',()=>{K.setDebug(!K.debugEnabled);showToast('Debug '+(K.debugEnabled?'ligado':'desligado'));},sig);
let drag=null;
ui.head.addEventListener('mousedown',e=>{if(e.target.closest('.btn'))return;e.preventDefault();const r=host.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};host.style.right='auto';host.style.left=r.left+'px';host.style.top=r.top+'px';},sig);
window.addEventListener('mousemove',e=>{if(!drag)return;host.style.left=Math.max(0,e.clientX-drag.x)+'px';host.style.top=Math.max(0,e.clientY-drag.y)+'px';},sig);
window.addEventListener('mouseup',()=>{drag=null;},sig);
window.addEventListener('keydown',e=>{if(e.altKey&&e.shiftKey&&e.key.toLowerCase()==='b'){e.preventDefault();host.style.display=host.style.display==='none'?'':'none';}},sig);
}

// INIT
function kill(){
ac.abort();
clearTimeout(toastTimer);
try{host&&host.remove();}catch(e){}
K.setUI(null);
delete window[UID];
}
buildHost();
bindUI();
sync();
window[UID]={kill,mounted:true};
K.setUI({refreshToggle,refreshStatus,updateStats,updateQueue,updateDot,showToast,renderLog,renderKeys,sync,kill,show:()=>{host.style.display='';},hide:()=>{host.style.display='none';}});
refreshToggle();refreshStatus();renderLog();updateQueue();
window.addEventListener('sang:bot-kill',kill,{once:true});
}

// BOOT
if(window._aibot&&window._aibot.kit)mount();
else{unready=()=>mount();window.addEventListener('sang:bot-ready',unready,{once:true});}
window[UID]=window[UID]||{kill:()=>{if(unready)window.removeEventListener('sang:bot-ready',unready);delete window[UID];}};
})();
