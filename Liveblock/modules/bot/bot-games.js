// modules/bot-games.js  (jogos — depende de bot.js via window._aibot.addHook/say)
(function(){
'use strict';
const UID='_aibotGames';
if(window[UID])return;

// CONFIG
const LS_SCORES='sanghub_aibot_games_scores';
const IDLE_MS=120000;
const WORDS=['abacaxi','bicicleta','computador','elefante','janela','mochila','pipoca','sorvete','violao','foguete','tartaruga','guarda'];

// STATE
let B=null,unhook=null,active=null,idleTimer=null;

// HELPERS
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
const pick=a=>a[Math.floor(Math.random()*a.length)];
const rx=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// STORAGE
const loadScores=()=>{try{return JSON.parse(localStorage.getItem(LS_SCORES))||{};}catch(e){return{};}};
function addScore(user,pts){
if(!pts)return;
const s=loadScores(),k=norm(user);
s[k]=(s[k]||0)+pts;
try{localStorage.setItem(LS_SCORES,JSON.stringify(s));}catch(e){}
}

// GAMES
const GAMES={
dado:()=>({instant:true,start(g,arg){
const n=Math.min(1000,Math.max(2,parseInt(arg,10)||6));
g.say('@'+g.user+' rolou '+(1+Math.floor(Math.random()*n))+' (d'+n+')');
}}),
forca:()=>{
let w,hit,miss;
const view=()=>[...w].map(c=>hit.has(c)?c:'_').join(' ');
const win=g=>{g.score(3);g.say('@'+g.user+' acertou! '+w+' (+3)');g.end();return true;};
return{
start(g){w=pick(WORDS);hit=new Set();miss=new Set();g.say('forca! '+view()+' · manda uma letra ou a palavra');},
onMessage(g,t){
t=norm(t);
if(t===w)return win(g);
if(!/^[a-z]$/.test(t))return false;
if(hit.has(t)||miss.has(t))return true;
if(w.includes(t)){hit.add(t);if([...w].every(c=>hit.has(c)))return win(g);g.say(view());}
else{miss.add(t);if(miss.size>=6){g.say('perdeu! era '+w);g.end();return true;}g.say(view()+' · erros '+[...miss].join('')+' ('+(6-miss.size)+' vidas)');}
return true;
}};
}
};

// ENGINE
function end(){active=null;clearTimeout(idleTimer);idleTimer=null;}
function touch(){clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(active){B.say('jogo encerrado por inatividade');end();}},IDLE_MS);}
const ctxFor=user=>({user,say:B.say,score:p=>addScore(user,p),end});

function command(user,cmd,arg){
if(cmd==='placar'){
const top=Object.entries(loadScores()).sort((a,b)=>b[1]-a[1]).slice(0,5);
B.say(top.length?'placar: '+top.map(([n,p],i)=>(i+1)+'.'+n+' '+p).join(' · '):'ninguém pontuou ainda');
return;
}
if(cmd==='parar'){if(active){end();B.say('jogo cancelado');}return;}
const id=norm(arg).split(/\s+/)[0],rest=norm(arg).split(/\s+/).slice(1).join(' ');
if(!GAMES[id]){B.say('jogos: '+Object.keys(GAMES).join(' · ')+' · placar · parar');return;}
if(active){B.say('já tem jogo rolando: '+active.id+' · /bot parar');return;}
const game=GAMES[id](),g=ctxFor(user);
if(game.instant){game.start(g,rest);return;}
active={id,game};touch();game.start(g,rest);
}

function onMsg(user,msg){
const m=msg.match(new RegExp('^\\s*'+rx(B.trigger())+'\\s+(\\w+)(?:\\s+(.+))?$','i'));
if(m){
const c=norm(m[1]);
if(c==='jogo'||c==='jogos'){command(user,'jogo',m[2]||'');return true;}
if(c==='placar'||c==='parar'){command(user,c,'');return true;}
}
if(!active)return false;
touch();
return active.game.onMessage(ctxFor(user),msg)===true;
}

// INIT
function kill(){
if(unhook)unhook();
end();
window.removeEventListener('sang:bot-kill',kill);
delete window[UID];
}
function init(){
B=window._aibot;
if(!B||!B.addHook)return;
unhook=B.addHook(onMsg);
window.addEventListener('sang:bot-kill',kill,{once:true});
}
window[UID]={kill};
if(window._aibot&&window._aibot.addHook)init();
else window.addEventListener('sang:bot-ready',init,{once:true});
})();
