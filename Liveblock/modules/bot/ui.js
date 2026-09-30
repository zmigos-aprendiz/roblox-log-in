// ============================================================
// ui.js — painel visual (tabs, toggles, logs)
// ============================================================
(function(){
'use strict';
const root = window._sangbot;
if (!root || !root.motor || root.ui) return;
const C = root.C, U = root.utils, L = root.log, rt = root.rt;

let host = null, shadow = null;
const ui = {};

// ═══ CSS ═══
const STYLE = `
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
.dot.game{background:#a78bfa;box-shadow:0 0 10px rgba(167,139,250,.95);animation:pulse 1s infinite}
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
textarea.inp{resize:vertical;min-height:90px;line-height:1.5;font-size:11.5px}
textarea.inp.tall{min-height:60px}
select.inp{cursor:pointer;appearance:none;background-image:url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238b8fa3' stroke-width='3'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:30px}
.inp-group{position:relative}
.inp-group .inp{padding-right:36px}
.eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);
width:26px;height:26px;border-radius:6px;background:transparent;border:none;
color:#8b8fa3;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center}
.eye:hover{color:#fff;background:rgba(255,255,255,.06)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.toggle{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;
border-radius:11px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);cursor:pointer;transition:all .15s}
.toggle.on{border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.06)}
.toggle.violet.on{border-color:rgba(167,139,250,.4);background:rgba(167,139,250,.08)}
.toggle.pink.on{border-color:rgba(244,114,182,.4);background:rgba(244,114,182,.08)}
.toggle.amber.on{border-color:rgba(251,191,36,.45);background:rgba(251,191,36,.08)}
.toggle.cyan.on{border-color:rgba(34,211,238,.55);background:rgba(34,211,238,.1)}
.switch{position:relative;width:42px;height:22px;border-radius:22px;
background:rgba(255,255,255,.08);transition:all .2s;flex:0 0 auto;
border:1px solid rgba(255,255,255,.1);pointer-events:none}
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
.stat-v.cyan{color:#34d399}
.stat-l{font-size:8px;color:#8b8fa3;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
.hint{font-size:9.5px;color:#8b8fa3;line-height:1.5;margin-top:6px}
.hint.warn{color:#fbbf24}
.hint.ok{color:#a7f3d0}
.btn-primary{width:100%;padding:10px;border-radius:9px;cursor:pointer;font-family:inherit;
font-size:11px;font-weight:800;letter-spacing:.03em;
background:linear-gradient(120deg,#22d3ee,#a78bfa);color:#0b0b10;border:none;
transition:transform .15s,box-shadow .15s}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(34,211,238,.35)}
.btn-secondary{width:100%;padding:8px;border-radius:8px;cursor:pointer;font-family:inherit;
font-size:10.5px;font-weight:700;
background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
color:#c7cad6;transition:all .15s}
.btn-secondary:hover{background:rgba(255,255,255,.1)}
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

// ═══ HTML ═══
const HTML = `
<div class="head" id="head">
  <div class="brand">
    <span class="dot" id="dot"></span>
    <span class="title">SANG BOT</span>
    <span class="badge-human" id="badgeHuman" style="display:none;">HUMANO</span>
  </div>
  <div class="actions">
    <button class="btn" id="btnMin" type="button" title="Minimizar">−</button>
  </div>
</div>
<div class="tabs" role="tablist">
  <button class="tab active" data-tab="bot" role="tab">Bot</button>
  <button class="tab" data-tab="games" role="tab">Jogos</button>
  <button class="tab" data-tab="config" role="tab">Config</button>
  <button class="tab" data-tab="log" role="tab">Log</button>
</div>
<div class="body" id="body">

  <div class="view" data-view="bot">
    <div class="sec-title"><span class="num">1</span>Ligar o bot</div>
    <div class="sec-group">
      <div class="toggle" id="toggleEnable" role="switch" tabindex="0">
        <div><div style="font-weight:700;font-size:12px;color:#fff;">Bot ativo</div>
        <div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;" id="personaLine">—</div></div>
        <div class="switch" id="switchEnable"></div>
      </div>
      <div class="toggle cyan" id="toggleHuman" role="switch" tabindex="0">
        <div><div style="font-weight:700;font-size:12px;color:#fff;">Modo Humano</div>
        <div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;" id="humanLine">Ritmo natural, reação curta, typo ocasional</div></div>
        <div class="switch cyan" id="switchHuman"></div>
      </div>
    </div>
    <div class="sec-title" style="margin-top:14px;"><span class="num">2</span>Como responde</div>
    <div class="sec-group">
      <div class="toggle amber" id="toggleSolo" role="switch" tabindex="0">
        <div><div style="font-weight:700;font-size:12px;color:#fff;">Modo Solo</div>
        <div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;" id="soloLine">Lê tudo e responde todos</div></div>
        <div class="switch amber" id="switchSolo"></div>
      </div>
      <div class="toggle violet" id="toggleBotChat" role="switch" tabindex="0">
        <div><div style="font-weight:700;font-size:12px;color:#fff;">Conversa de Bot</div>
        <div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;" id="botChatLine">User alvo: cariocaIA</div></div>
        <div class="switch" id="switchBotChat"></div>
      </div>
      <div class="toggle pink" id="toggleReadAll" role="switch" tabindex="0">
        <div><div style="font-weight:700;font-size:12px;color:#fff;">Ler sala toda</div>
        <div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;">Contexto de todos os usuários</div></div>
        <div class="switch pink" id="switchReadAll"></div>
      </div>
    </div>
  </div>

  <div class="view" data-view="games" style="display:none;">
    <div class="sec-title"><span class="num">J</span>Jogos instalados</div>
    <div class="sec-group" id="gamesList"></div>
    <div class="hint" style="margin-top:10px;">
      Comandos: <b id="gamesHelp">—</b>
    </div>
    <div id="gameActive" class="sec" style="margin-top:12px;display:none;">
      <div class="sec-label">Rodada ativa</div>
      <div id="gameActiveInfo"></div>
      <button class="btn-secondary" id="btnStopGame" type="button" style="margin-top:8px;">Parar rodada</button>
    </div>
    <div class="sec-title" style="margin-top:14px;"><span class="num">P</span>Placar</div>
    <div class="sec">
      <div id="quizRanking"></div>
      <button class="btn-secondary" id="btnClearScore" type="button" style="margin-top:8px;">Zerar placar</button>
    </div>
  </div>

  <div class="view" data-view="config" style="display:none;">
    <div class="sec">
      <div class="sec-label">API Key</div>
      <div class="inp-group">
        <input class="inp" id="inpKey" type="password" placeholder="gsk_..." autocomplete="off" spellcheck="false" />
        <button class="eye" id="btnEyeKey" type="button">👁</button>
      </div>
    </div>
    <div class="sec">
      <div class="sec-label">Persona</div>
      <div class="presets" id="presets"></div>
      <textarea class="inp" id="inpPrompt" spellcheck="false"></textarea>
    </div>
    <div class="sec">
      <div class="sec-label">Comportamento</div>
      <div class="grid2">
        <div><label class="f">Trigger</label><input class="inp" id="inpTrigger" type="text" spellcheck="false" /></div>
        <div><label class="f">Cooldown</label><input class="inp" id="inpCooldown" type="number" min="0" step="100" /></div>
        <div><label class="f">Temperature</label><input class="inp" id="inpTemp" type="number" min="0" max="2" step="0.1" /></div>
        <div><label class="f">Max tokens</label><input class="inp" id="inpMaxTok" type="number" min="50" max="4000" step="50" /></div>
      </div>
      <label class="f" style="margin-top:10px;">Effort</label>
      <select class="inp" id="selReasoning">
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
      <div class="toggle" id="togglePrefix" role="switch" tabindex="0" style="margin-top:10px;">
        <div><div style="font-weight:700;font-size:12px;color:#fff;">Prefixo @user</div></div>
        <div class="switch" id="switchPrefix"></div>
      </div>
    </div>
    <button class="btn-primary" id="btnSave" type="button">Salvar</button>
  </div>

  <div class="view" data-view="log" style="display:none;">
    <div class="sec" style="padding:9px 11px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <button class="btn" id="btnDebugToggle" type="button">DBG</button>
        <div style="display:flex;gap:6px;">
          <button class="btn" id="btnClearLog" type="button">Limpar log</button>
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

// ═══ BUILD / BIND ═══
ui.build = function(){
    if (host) return;
    host = document.createElement('div');
    host.id = '_sangbot_host';
    host.setAttribute('data-hub','1');
    host.setAttribute('data-sang-ui','');
    host.style.cssText = 'all:initial;position:fixed;top:20px;right:20px;z-index:2147483647;';
    document.documentElement.appendChild(host);
    try { window._hubUI?.markProtected?.(host); } catch(_) {}
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = HTML;
    shadow.appendChild(panel);
    ui.panel = panel;
    ui.host = host;
    ui.shadow = shadow;
    const $ = id => shadow.getElementById(id);
    ui.$ = $;
    cache();
    populate();
    bind();
    ui.refreshAll();
};

function cache(){
    const $ = ui.$;
    ui.dot = $('dot'); ui.badgeHuman = $('badgeHuman');
    ui.switchEnable = $('switchEnable'); ui.toggleEnable = $('toggleEnable');
    ui.switchHuman = $('switchHuman'); ui.toggleHuman = $('toggleHuman');
    ui.humanLine = $('humanLine');
    ui.switchSolo = $('switchSolo'); ui.toggleSolo = $('toggleSolo'); ui.soloLine = $('soloLine');
    ui.switchBotChat = $('switchBotChat'); ui.toggleBotChat = $('toggleBotChat'); ui.botChatLine = $('botChatLine');
    ui.switchReadAll = $('switchReadAll'); ui.toggleReadAll = $('toggleReadAll');
    ui.gamesList = $('gamesList'); ui.gamesHelp = $('gamesHelp');
    ui.gameActive = $('gameActive'); ui.gameActiveInfo = $('gameActiveInfo');
    ui.quizRanking = $('quizRanking');
    ui.inpKey = $('inpKey'); ui.btnEyeKey = $('btnEyeKey');
    ui.presets = $('presets'); ui.inpPrompt = $('inpPrompt');
    ui.inpTrigger = $('inpTrigger'); ui.inpCooldown = $('inpCooldown');
    ui.inpTemp = $('inpTemp'); ui.inpMaxTok = $('inpMaxTok'); ui.selReasoning = $('selReasoning');
    ui.switchPrefix = $('switchPrefix'); ui.togglePrefix = $('togglePrefix');
    ui.logList = $('logList'); ui.footLeft = $('footLeft'); ui.footQueue = $('footQueue');
    ui.toast = $('toast'); ui.btnDebugToggle = $('btnDebugToggle');
    ui.personaLine = $('personaLine');
}

function populate(){
    const s = root.settings, $ = ui.$;
    ui.inpKey.value = s.apiKey;
    ui.inpPrompt.value = s.systemPrompt;
    ui.inpTrigger.value = s.trigger;
    ui.inpCooldown.value = s.cooldownMs;
    ui.inpTemp.value = s.temperature;
    ui.inpMaxTok.value = s.maxTokens;
    ui.selReasoning.value = s.reasoningEffort;
    ui.btnDebugToggle.classList.toggle('on', rt.debugEnabled);
    ui.presets.innerHTML = '';
    Object.entries(root.prompts.PERSONAS).forEach(([k, p]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'preset' + (s.personaKey === k ? ' active' : '');
        b.dataset.persona = k;
        b.textContent = p.label;
        b.addEventListener('click', () => selectPersona(k));
        ui.presets.appendChild(b);
    });
    renderGames();
}

function bind(){
    const $ = ui.$, sig = {};
    ['keydown','keyup','keypress','input','beforeinput'].forEach(ev => host.addEventListener(ev, e => e.stopPropagation(), sig));
    shadow.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        shadow.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
        shadow.querySelectorAll('.view').forEach(v => { v.style.display = v.dataset.view === t.dataset.tab ? '' : 'none'; });
    }, sig));
    $('btnMin').addEventListener('click', () => ui.panel.classList.toggle('collapsed'), sig);
    
    bindToggle(ui.toggleEnable, () => { s('enabled', !root.settings.enabled); ui.refreshAll(); });
    bindToggle(ui.toggleHuman, () => { s('humanMode', !root.settings.humanMode); ui.refreshAll(); });
    bindToggle(ui.toggleSolo, () => {
        const next = !root.settings.soloMode;
        s('soloMode', next);
        if (next && root.settings.botChatMode) s('botChatMode', false);
        if (!next) root.room.clear();
        ui.refreshAll();
    });
    bindToggle(ui.toggleBotChat, () => {
        const next = !root.settings.botChatMode;
        s('botChatMode', next);
        if (next && root.settings.soloMode) s('soloMode', false);
        if (!next) root.room.clear();
        ui.refreshAll();
    });
    bindToggle(ui.toggleReadAll, () => {
        s('botChatReadAll', !root.settings.botChatReadAll);
        if (!root.settings.botChatReadAll) root.room.clear();
        ui.refreshAll();
    });
    bindToggle(ui.togglePrefix, () => { s('prefixReply', !root.settings.prefixReply); ui.refreshAll(); });
    
    $('btnEyeKey').addEventListener('click', () => {
        const t = ui.inpKey.type === 'text';
        ui.inpKey.type = t ? 'password' : 'text';
        ui.btnEyeKey.textContent = t ? '👁' : '🙈';
    }, sig);
    $('btnDebugToggle').addEventListener('click', () => { L.setDebug(!rt.debugEnabled); ui.btnDebugToggle.classList.toggle('on', rt.debugEnabled); renderLog(); }, sig);
    $('btnClearLog').addEventListener('click', () => { L.clear(); renderLog(); }, sig);
    $('btnSave').addEventListener('click', () => {
        s('apiKey', ui.inpKey.value.trim());
        s('systemPrompt', ui.inpPrompt.value);
        s('trigger', ui.inpTrigger.value.trim() || '/bot');
        s('cooldownMs', Math.max(0, parseInt(ui.inpCooldown.value,10) || 0));
        s('temperature', Math.min(2, Math.max(0, parseFloat(ui.inpTemp.value) || 0.85)));
        s('maxTokens', Math.max(50, Math.min(4000, parseInt(ui.inpMaxTok.value,10) || 500)));
        s('reasoningEffort', ['low','medium','high'].includes(ui.selReasoning.value) ? ui.selReasoning.value : 'low');
        if (ui.inpPrompt.value !== root.prompts.PERSONAS[root.settings.personaKey]?.prompt) s('personaKey','custom');
        ui.presets.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b.dataset.persona === root.settings.personaKey));
        ui.refreshAll();
        toast('Configurações salvas ✓');
    }, sig);
    $('btnStopGame').addEventListener('click', () => { root.games.stopAll(); refreshGames(); }, sig);
    $('btnClearScore').addEventListener('click', () => { root.quizScore.clear(); refreshGames(); }, sig);
    
    // drag
    let drag = null;
    $('head').addEventListener('mousedown', e => {
        if (e.target.closest('.btn')) return;
        e.preventDefault();
        const r = host.getBoundingClientRect();
        drag = { x: e.clientX - r.left, y: e.clientY - r.top };
        host.style.right = 'auto';
        host.style.left = r.left + 'px';
        host.style.top = r.top + 'px';
    }, sig);
    window.addEventListener('mousemove', e => {
        if (!drag) return;
        host.style.left = Math.max(0, e.clientX - drag.x) + 'px';
        host.style.top = Math.max(0, e.clientY - drag.y) + 'px';
    }, sig);
    window.addEventListener('mouseup', () => { drag = null; }, sig);
    window.addEventListener('keydown', e => {
        if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'b'){
            e.preventDefault();
            host.style.display = host.style.display === 'none' ? '' : 'none';
        }
    }, sig);
    
    L.onChange(renderLog);
    root.games.onChange(refreshGames);
}

function bindToggle(el, onClick){
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); el.click(); } });
}
function s(k, v){ root.saveSetting(k, v); }

function selectPersona(key){
    const p = root.prompts.PERSONAS[key];
    if (!p) return;
    root.saveSetting('personaKey', key);
    if (p.prompt){ root.saveSetting('systemPrompt', p.prompt); ui.inpPrompt.value = p.prompt; }
    ui.presets.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b.dataset.persona === key));
    ui.refreshAll();
}

// ═══ GAMES SECTION ═══
function renderGames(){
    const list = ui.gamesList;
    list.innerHTML = '';
    for (const g of root.games.all()){
        const row = document.createElement('div');
        row.className = 'toggle cyan';
        row.innerHTML = `
            <div>
                <div style="font-weight:700;font-size:11.5px;color:#fff;">${U.esc(g.label || g.id)}</div>
                ${g.help ? `<div style="font-size:9.5px;color:#8b8fa3;margin-top:2px;">${U.esc(g.help)}</div>` : ''}
            </div>
            <div class="switch cyan"></div>`;
        const sw = row.querySelector('.switch');
        sw.classList.toggle('on', typeof g.enabled === 'function' && g.enabled());
        row.addEventListener('click', () => {
            const next = !(typeof g.enabled === 'function' && g.enabled());
            g.setEnabled && g.setEnabled(next);
            sw.classList.toggle('on', next);
        });
        list.appendChild(row);
    }
    ui.gamesHelp.textContent = root.games.all().map(g => g.trigger || g.id).join(' · ') || '—';
}
function refreshGames(){
    renderGames();
    // placar
    const top = root.quizScore.top(5);
    ui.quizRanking.innerHTML = top.length
        ? top.map(([u,p],i) => `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-bottom:1px dashed rgba(255,255,255,.06);">
            <span style="color:#c7cad6;">${i+1}. ${U.esc(u)}</span>
            <span style="color:#22d3ee;font-weight:700;">${p}</span>
          </div>`).join('')
        : '<div class="hint">Sem placar ainda.</div>';
    // rodada ativa
    if (root.games.anyActive()){
        ui.gameActive.style.display = '';
        const id = root.games.activeId();
        const g = root.games.get(id);
        ui.gameActiveInfo.textContent = 'Ativo: ' + (g ? g.label : id);
    } else {
        ui.gameActive.style.display = 'none';
    }
}

// ═══ REFRESH ═══
ui.refreshDot = function(){
    const d = ui.dot;
    d.classList.remove('on','busy','chat','room','solo','human','game');
    if (!root.settings.enabled) return;
    if (root.games.anyActive()) d.classList.add('game');
    else if (rt.processing) d.classList.add('busy');
    else if (root.settings.humanMode) d.classList.add('human');
    else if (root.settings.soloMode) d.classList.add('solo');
    else if (root.settings.botChatMode && root.settings.botChatReadAll) d.classList.add('room');
    else if (root.settings.botChatMode) d.classList.add('chat');
    else d.classList.add('on');
};
ui.refreshQueue = function(){ if (ui.footQueue) ui.footQueue.textContent = rt.queue.length; };
ui.refreshStatus = function(){
    const model = root.settings.model;
    const tags = [];
    if (root.settings.humanMode) tags.push('humano');
    if (root.settings.soloMode) tags.push('solo');
    if (root.settings.botChatMode) tags.push('chat:' + root.settings.botChatUser);
    if (root.settings.botChatReadAll) tags.push('sala');
    if (root.games.anyActive()) tags.push('jogo:' + root.games.activeId());
    ui.footLeft.textContent = model + ' · ' + root.settings.reasoningEffort + (tags.length ? ' · ' + tags.join(' · ') : '');
};
ui.refreshToggle = function(){
    const s = root.settings;
    setSwitch(ui.switchEnable, s.enabled); ui.toggleEnable.classList.toggle('on', s.enabled);
    setSwitch(ui.switchHuman, s.humanMode); ui.toggleHuman.classList.toggle('on', s.humanMode);
    ui.badgeHuman.style.display = s.humanMode ? '' : 'none';
    ui.humanLine.textContent = s.humanMode ? 'ATIVO · ritmo, reação, typo, tom' : 'Ritmo natural, reação curta, typo ocasional';
    setSwitch(ui.switchSolo, s.soloMode); ui.toggleSolo.classList.toggle('on', s.soloMode);
    ui.soloLine.textContent = s.soloMode ? 'Ativo · ' + s.soloDelay + 'ms · ' + s.soloTurns + ' turnos' : 'Lê tudo e responde todos';
    setSwitch(ui.switchBotChat, s.botChatMode); ui.toggleBotChat.classList.toggle('on', s.botChatMode);
    ui.botChatLine.textContent = 'User alvo: ' + (s.botChatUser || '—') + ' · ' + s.botChatTurns + ' turnos';
    setSwitch(ui.switchReadAll, s.botChatReadAll); ui.toggleReadAll.classList.toggle('on', s.botChatReadAll);
    setSwitch(ui.switchPrefix, s.prefixReply); ui.togglePrefix.classList.toggle('on', s.prefixReply);
    ui.personaLine.textContent = root.prompts.PERSONAS[s.personaKey]?.label || 'Custom';
};
function setSwitch(el, on){ el.classList.toggle('on', on); el.parentElement?.setAttribute('aria-checked', String(on)); }

ui.refreshAll = function(){ ui.refreshDot(); ui.refreshQueue(); ui.refreshStatus(); ui.refreshToggle(); refreshGames(); };
ui.toast = function(msg){
    if (!ui.toast) return;
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(ui._toastTimer);
    ui._toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1800);
};

// ═══ LOG RENDER ═══
function renderLog(){
    if (!ui.logList) return;
    const items = [];
    root.log.logs().forEach(l => {
        const info = l.info || '';
        const isHuman = info.includes('humano');
        const isSolo = info.includes('solo');
        const isChat = info.includes('conversa');
        const isRoom = info.includes('sala');
        const isQuiz = info.includes('quiz') || info.includes('forca');
        const isCmd = info.includes('comando');
        let cls;
        if (l.status === 'ok') cls = isCmd ? 'capture' : (isQuiz ? 'capture' : (isHuman ? 'human' : (isSolo ? 'solo' : (isRoom ? 'room' : (isChat ? 'chat' : 'ok')))));
        else if (l.status === 'error' || l.status === 'send-fail' || l.status === 'no-key') cls = 'fail';
        else cls = 'skip';
        const tag = '<span class="log-tag ' + cls + '">' + U.esc(l.status) + '</span>';
        const infoHtml = info ? '<span style="color:#fbbf24;font-size:9px;">' + U.esc(info) + '</span>' : '';
        items.push({ id: l.id, html: '<div class="log-row ' + cls + '"><div class="log-head"><span class="log-user">' + U.esc(l.user) + '</span><span>' + U.esc(l.t) + '</span></div><div class="log-q">' + tag + '→ ' + U.esc(U.truncate(l.q, 140)) + '</div>' + (l.r && l.r !== '—' ? '<div class="log-r">← ' + U.esc(U.truncate(l.r, 200)) + '</div>' : '') + infoHtml + '</div>' });
    });
    if (rt.debugEnabled){
        root.log.debugLogs().forEach(d => {
            let cls = 'capture';
            if (['miss','cooldown','empty','silence','skip'].includes(d.tag)) cls = 'skip';
            else if (d.tag === 'cb' || d.tag === 'error') cls = 'fail';
            items.push({ id: 1000000 + d.id, html: '<div class="log-row ' + cls + '"><div class="log-head"><span class="log-tag ' + cls + '">' + U.esc(d.tag) + '</span><span>' + U.esc(d.t) + '</span></div><div class="log-q">' + U.esc(d.text) + '</div></div>' });
        });
    }
    if (!items.length){ ui.logList.innerHTML = '<div class="empty">Nenhuma atividade ainda.</div>'; return; }
    ui.logList.innerHTML = items.map(i => i.html).join('');
    ui.logList.parentElement.scrollTop = ui.logList.parentElement.scrollHeight;
}

root.ui = ui;
console.log('%c[ui]','color:#22d3ee;font-weight:bold','pronto');
})();
