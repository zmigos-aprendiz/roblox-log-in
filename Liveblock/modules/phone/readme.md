markdown
# Sang Phone — README técnico

Telefone P2P embutido no Sang Hub (userscript para Habbo privado). Provê
tela de bloqueio com notificações, home com apps, chamadas de voz,
contatos, recados e um subsistema de chat (Sangzap). Roda isolado em
Shadow DOM, carrega módulos por URL, e usa Firestore (dados) + Realtime
Database (sinalização WebRTC).

**Repositório:** `github.com/zBeyond5/Liveblock`
**Base:** `https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/modules/phone`

---

## 1. Estrutura
modules/phone/
├── shell.js # Orquestrador + host Shadow DOM + tags <style>
├── core.js # Sistema de views (lock / home / app / call)
├── config.js # Constantes globais (P.config)
├── state.js # Estado compartilhado (P.state)
├── style.js # CSS global do phone (ctx._phoneCss)
├── home.js # Lock (PIN/swipe + notif feed) + Home (grid, dock, drag, ctx menu)
├── apps.js # Registry de apps + builtin fallbacks + openApp
├── notifications.js # Sistema de notificações (som, vibra, lock feed)
├── contacts.js # Agenda, números, histórico, card, inbox de recados
├── calls.js # WebRTC 1:1 + grupo (host-anchored com mixer)
├── notes.js # Recados de voz (MediaRecorder + Firestore)
├── apps/ # Apps do phone (executam dentro da home)
│ ├── config.js # App de ajustes (ícone, wallpaper, tema)
│ └── ... # Outros apps entram aqui
└── sangzap/ # Subsistema de chat (roda como app)
├── shell.js
├── chat.js
├── roster.js
├── stories.js
└── stories-viewer.js

text

Ordem de boot:
1. `shell.js` cria host `_phone_host` (shadow root `open`)
2. `style.js` escreve `ctx._phoneCss`; shell injeta no shadow
3. `core.js` monta a estrutura: `frame / screen / stage / views`
4. `notifications.js`, `contacts.js`, `calls.js`, `notes.js` são
   carregados em paralelo por `shell.js` via `fetch + <script>` inline
5. `apps.js` registra builtins; `apps/*.js` registram os próprios
6. `home.js::renderLock()` roda — telefone abre travado

---

## 2. Bridge central

Todos os módulos conversam via duas globais. **Nenhum módulo importa
outro diretamente** — sempre via bridge.

### 2.1 `window._phoneCtx` (ctx)

Helpers comuns, injetados pelo shell:

| Chave | Descrição |
|---|---|
| `ctx.el(tag, attrs, ...children)` | Criador de nó DOM |
| `ctx.esc(str)` | Escapa HTML |
| `ctx.I` | Biblioteca de ícones SVG |
| `ctx.root` | Shadow root (nó raiz do phone) |
| `ctx.screenEl` / `ctx.frameEl` | Tela / moldura do aparelho |
| `ctx.toast(msg, kind)` | Toast interno (`ok` / `err` / `warn` / `fav`) |
| `ctx.tone.*` | Tons (key, dial, ring, hangup, recStart, etc.) |
| `ctx.getAudioCtx()` | AudioContext compartilhado |
| `ctx.appendStyle(css)` | Injeta CSS no shadow root |
| `ctx.setMinimized(bool)` | Tuck do aparelho |
| `ctx.goToTab(id)` | Salta para uma tab do app de telefone |
| `ctx.renderTab()` | Redesenha a tab ativa |
| `ctx.openApp(id)` | Abre app pelo id (registrado em `ctx.apps`) |
| `ctx.setNotifDot(bool)` | Dot de notificação na status bar |
| `ctx.setRecording(bool)` | Pulso vermelho durante gravação |

### 2.2 `window._phone` (P — módulos)

Namespaces por módulo. Cada módulo anexa o seu em `P.<nome>`:
P.config → constantes globais
P.state → estado compartilhado (S.frameEl, S.pinSet, S.settings)
P.core → showView('lock'|'home'|'app'|'call'), montagem de views
P.apps → registry (resolveAppDef, builtinFallbacks, openApp)
P.home → renderLock/renderHome, openHomeCtx, applyHomeCfg
P.notify → push/dismiss/clear/list, unreadCount, markAllRead
P.contacts → agenda, números, histórico, inbox
P.calls → call/onIncoming/accept/reject/endCall, group mgmt
P.notes → wireNoteButton, startFromCard, renderInbox, unread

text

Cada módulo declara `P.home` / `P.contacts` / etc. e guarda uma flag
`_loaded` para idempotência.

---

## 3. Módulos em detalhe

### 3.1 `shell.js`

- Cria host `_phone_host` com `attachShadow({ mode: 'open' })`
- Injeta `ctx._phoneCss` (de `style.js`) no shadow
- Carrega módulos irmãos via `fetch + <script>` inline
- Expõe `ctx.*` inteiro
- Kill switch: `window._phone.kill()` desmonta tudo

**Não faz regra de negócio.** Só orquestra ciclo de vida.

### 3.2 `core.js`

- `showView('lock'|'home'|'app'|'call')` — só uma view `.ph-view.active` por vez
- `.ph-view` são filhos absolutos do `.ph-stage`
- `frameEl` guarda a moldura do aparelho (`.ph-frame`)

### 3.3 `config.js`

Constantes exportadas em `P.config`:

| Constante | Uso |
|---|---|
| `FRAME_HALF_H` | Metade da altura da moldura (para `margin-top`) |
| `MIN_TUCK_X` / `MIN_TUCK_Y` | Deslocamento do minimize |
| `PAGE_SIZE` | Apps por página da home |
| `MAX_DOCK_APPS` | Slots da dock |
| `GRID_COLS` | Colunas da grade |
| `LS_LAYOUT`, `LS_HOME_CFG`, `LS_MY_NUMBER`, `LS_CONTACTS`, `LS_HISTORY`, `LS_BLOCKED`, `LS_MISSED_READ`, `LS_NOTIFICATIONS` | Chaves de localStorage |
| `DEFAULT_APP_BG`, `DEFAULT_APP_BG_SOLID` | Fundo do `.ph-screen` quando app está ativo |

### 3.4 `state.js`

Estado compartilhado mutável (`S`):

- `S.frameEl` — nó raiz do phone (set por core)
- `S.pinSet` — PIN atual (string vazia = sem PIN)
- `S.settings` — preferências (ver §5)

### 3.5 `style.js`

Só CSS. Retorna uma string gigante em `ctx._phoneCss`. Escopo:

- Reset `:host, *` (box-sizing)
- Keyframes comuns (`phFadeIn`, `phPulseDot`, `phKeyPress`, `phRingGlow`, …)
- Estrutura do aparelho (`.ph-frame`, `.ph-screen`, `.ph-notch`, `.ph-side`)
- Views (`.ph-lock`, `.ph-home`, `.ph-view-app`, `.ph-view-call`)
- Componentes transversais (`.ph-toast`, `.ph-ctx-menu`, `.ph-app-bar`,
  `.ph-notif-card`)

**Nenhum seletor de módulo específico mora aqui.** Cada módulo injeta
o próprio CSS via `ctx.appendStyle`.

### 3.6 `home.js`

Duas responsabilidades: **lock screen** e **home**.

**Lock:**
- Tela dividida em duas views internas (`.ph-lock-view`): **notifs** e
  **pin**, com transição vertical suave entre elas
- Sem PIN → hint verde "Toque para desbloquear" no rodapé, unlock direto
- Com PIN → hint semitransparente com chevron pulsante "Deslize para o
  PIN". Swipe-up (ou tap no hint) revela o keypad. Swipe-down volta pra
  notificações. ESC também.
- PIN errado → `shake` + label `PIN incorreto`, limpa em 600ms
- Feed de notificações acima (máx 20 visíveis), clique no card descarta

**Home:**
- Grid paginado (`.ph-home-pages` com swipe horizontal)
- Dock fixa no rodapé (`.ph-dock`)
- Apps renderizados por `_resolveAppDef(id)` (delega para `P.apps`)
- Relógio e busca **arrastáveis** (offset salvo em `LS_HOME_CFG`)
- **Context menu:**
  - **Área vazia / relógio / busca** → menu Home (relógio on/off, busca
    on/off, tamanho de ícone, espaçamento, reset posições, reset grade)
  - **Ícone** → menu de App (Abrir, Fixar/Desafixar dock, Mover para
    início, Remover — só para apps não-builtin)
- Gatilhos do menu de App: `contextmenu`, `ctrl/cmd + click`, `long-press`
- **Drag & drop:** entre slots de grade, entre páginas, para dentro/fora
  da dock. Auto-flip de página quando arrasta na borda (só na view home)
- Layout compacta ao remover e poda páginas vazias

**Persistência:**
- `LS_LAYOUT` → `{ pages: [[id|null,...],...], dock: [id,...] }`
- `LS_HOME_CFG` → `{ clockX, clockY, searchX, searchY, showClock,
  showSearch, iconSize, gridGap, currentPage }`

**Não abre apps.** Chama `P.apps.openApp(id)`.

### 3.7 `apps.js`

Registry central:

- `P.apps.all()` → lista de apps registrados via `ctx.apps.register()`
- `P.apps.builtinFallbacks()` → apps builtin (Contatos, Discador,
  Recentes, Recados, Ajustes) que existem mesmo antes do registro dinâmico
- `P.apps.resolveAppDef(id)` → objeto `{ id, name, icon, accent, bg, ... }`
- `P.apps.openApp(id)` → monta o app na view `.ph-view-app`
- `P.apps.onChange(fn)` → notifica quando o registry muda

### 3.8 `notifications.js`

Sistema de notificações do phone. Qualquer módulo (ou app) empurra
notificação via `P.notify.push(...)`; o sistema cuida de som, vibração,
shake visual, persistência e exibição no lock screen.

**Anatomia de uma notificação:**

```js
P.notify.push({
    appId:    'meuapp',           // casa com o id do app
    appName:  'Meu App',           // rótulo exibido no card
    icon:     '<svg>…</svg>',      // opcional, cai pro padrão do sistema
    accent:   '#a78bfa',           // cor do card; cai pro accent do app
    title:    'Título',            // obrigatório
    body:     'Texto do corpo',    // opcional
    priority: 'high',              // 'low' | 'normal' | 'high'
    sound:    true,                // default true
    vibrate:  true,                // default true
    meta:     { chatId: '123' }    // livre, app lê depois se quiser
});
Feedback ao entrar:

Som — whistle sintetizado de duas notas (880Hz → 1174Hz), estilo
WhatsApp. Respeita window._hubSFX.isMuted() e S.settings.sound.

Vibração — navigator.vibrate([70,45,70,45,140]) se disponível
(mobile). Silencioso em desktop.

Shake visual — classe .buzz aplicada no .ph-screen por 620ms.

Debounce de som: 700ms. Cinco notificações em rajada → só a
primeira apita. Intencional, evita fuzilaria sonora.

Persistência: LS_NOTIFICATIONS → array, máx 50. Sobrevive reload.

API:

Chamada	O que faz
P.notify.push(entry)	Cria notificação, emite som/vibra/shake
P.notify.list()	Snapshot das notificações ativas
P.notify.dismiss(id)	Remove uma
P.notify.clear()	Remove todas
P.notify.unreadCount()	Quantas não lidas
P.notify.markAllRead()	Marca todas como lidas
P.notify.onChange(fn)	Assina mudanças no registry
P.notify.on('push', fn)	Assina só eventos de push
Quem empurra hoje:

calls.js — chamada recebida (accent cyan), chamada perdida
(accent rosa)

notes.js — recado de voz recebido (accent violeta)

Qualquer app via P.notify.push({ appId: '<id>', … })

3.9 contacts.js
Agenda + números + histórico + inbox de recados.

Número por conta:

phone_numbers/{num} → diretório reverso (username, displayName,
avatarUrl, createdAt, updatedAt)

phone_owners/{username} → dono (number, createdAt)

Alocação: cache local → lookup owner → gerar 6 dígitos → reivindicar
(até 8 tentativas se colidir)

Espelha phoneNumber em sessions/{deviceId} (acelera discagem)

Contatos:

{ number, username, savedName, savedAvatar, savedAt, fav, manualName, lastSeenAt }

manualName: true → nome do usuário nunca é sobrescrito por live.name

_avatarHtml(contact, opts) → fallback em cadeia: `live > savedAvatar

inicial.<img onerror>` remove a imagem quebrada.

Histórico:

máx 60 entradas (LS_HISTORY)

entry: { id, direction, kind, status, members[], at, durationMs, readAt }

status: answered / missed / rejected

Filtro all | incoming | outgoing | missed

Agrupamento por data (hoje / ontem / semana / antigo)

Chamadas perdidas não-lidas têm destaque + badge no tab Recados

Missed calls persistidas (phone fechado):

Hub grava em phone_missed quando recebe oferta com kind: 'phone' e
o phone não está montado

_consumeMissedCalls() lê, deduplica (±2min), mescla em _history,
apaga docs. Roda no boot, em focus e em sang:player-updated.

Casa por toDeviceId ou toNumber

Card de contato:

Clique no row → card com avatar, nome editável, número copiável,
status, última chamada, contagem de chamadas

Duplo-clique → ligar direto

Ações: Ligar, Recado, Favoritar, Restaurar nome, Bloquear, Remover

3.10 calls.js
WebRTC 1:1 e grupo.

Arquitetura de chamada:

1:1: dois peers, signaling direto em signaling/{deviceId}

Grupo (host-anchored): o host mantém N conexões 1:1 (uma por
membro). Para cada callee, sintetiza um stream via
MediaStreamAudioDestinationNode contendo mic do host + todos os
outros callees, exceto o próprio. Adicionar alguém no meio é
replaceTrack, sem renegociação. Não é mesh.

Signaling (RTDB):

1:1: signaling/{deviceId}/offer, answer, ice/caller/*,
ice/callee/*

Grupo: gcall/{callId} com hostId, members/{devId},
speaking/{devId}

Não usa trickle ICE. Espera iceGatheringState === 'complete' antes
de escrever o SDP (~2s no setup, evita correio de candidatos).

Regras de ouro:

Reject e hangup do callee vão para o próprio path
(signaling/{bridge.deviceId}/answer, etc.) — é de lá que o caller lê

ICE buffered: candidates que chegam antes do setRemoteDescription
ficam em _icePending e são drenados depois

Promoção a active cobre a corrida entre connectionState e
iceConnectionState

Oferta expirada (ts > 60s) → reject silencioso com reason: 'stale'

API pública:

ctx.calls.call(targets[]) — inicia chamada

ctx.calls.onIncoming(offer) — tratado pelo shell no evento
sang:phone-incoming

ctx.calls.accept(), reject(reason), endCall()

ctx.calls.registerMissedForOffline(payload) — chamado por
contacts.js quando o alvo está offline

Notifica via P.notify.push:

Chamada recebida (accent #22d3ee)

Chamada perdida ao encerrar com status missed (accent #fb7185)

3.11 notes.js
Recados de voz assíncronos.

Fluxo:

Segurar botão de recado → começa gravação (MediaRecorder, Opus 24kbps)

Soltar dentro do botão → envia

Soltar fora / arrastar para fora / ESC → cancela

Auto-encerra em 3min (teto rígido)

Envia via POST /phone_notes (base64, cap 700KB)

Recebimento:

Poll a cada 9s em /phone_notes, filtra por toNumber

Uma por ciclo (evita overlap)

Autoplay bloqueado → banner com botão "Ouvir"

Inbox persistida em LS_INBOX (últimos 30, replay possível)

Badge de unread no tab Recados + ctx.setNotifDot

Para de tocar quando chega sang:phone-incoming

Empurra P.notify.push ao receber (accent #a78bfa)

API:

ctx.notes.wireNoteButton(btn, {number, name}) — attach na lista

ctx.notes.startFromCard({number, name}) — botão do card (1 arg)

ctx.notes.renderInbox(root) — renderiza no container

ctx.notes.getUnreadCount() / onUnreadChange(fn) / markAllRead()

ctx.notes.replayNote(id) / deleteNote(id)

3.12 apps/config.js
App de ajustes. Exemplo de app registrado via ctx.apps.register().
Fullscreen (classe cfg-fullscreen no .ph-screen esconde header/tabs).
Cobre: URL de ícone, URL de wallpaper, tema, som, prévia em chamada.

3.13 sangzap/ (subsistema)
Chat tipo WhatsApp com stories, grupos, recados e chamadas. É um app
dentro do phone — tem shell.js próprio que monta na .ph-view-app.

Módulos internos: chat.js (thread), roster.js (lista), stories.js
(stories), stories-viewer.js. Persiste em sangzap_chats/{chatId}.

Bug conhecido: doc do chat só é criado no openNewChatPicker do
shell. Abrir por outro caminho (deep-link, notificação) não cria. Fix
pendente em chat.js (chamado ensureChatDoc).

4. Contratos entre módulos
Regra absoluta: nenhum módulo importa outro diretamente. Toda
comunicação via ctx.* ou P.<namespace>.

Quem chama	O que	Contrato
contacts.js	ligar	ctx.calls.call([{ id, name, avatarUrl, number }])
contacts.js	recado	ctx.notes.wireNoteButton(btn, target) ou ctx.notes.startFromCard(target)
contacts.js	offline miss	ctx.calls.registerMissedForOffline(payload)
calls.js	render	ctx.contacts.pushHistory(entry)
calls.js	avatar do callee	ctx.contacts.getContact(number) (helper)
calls.js	notificar	P.notify.push({ appId: 'phone', … })
notes.js	badge	ctx.setNotifDot(true)
notes.js	notificar	P.notify.push({ appId: 'notes', … })
notes.js	tocar recado	detecta ctx.getMinimized() e chama ctx.setMinimized(false)
home.js	abrir app	P.apps.openApp(id)
home.js	resolver def	P.apps.resolveAppDef(id)
home.js	render lock	P.notify.list(), P.notify.onChange(fn)
apps/*.js	registro	ctx.apps.register({ id, name, icon, mount, unmount })
apps/*.js	notificar	P.notify.push({ appId: '<id>', … })
Eventos globais (window):

sang:phone-incoming — hub recebe oferta de chamada do phone

sang:phone-notify — notificação interna (para integração com hub)

sang:player-updated — hub atualiza cache do jogador

sang:module-close — módulo do hub foi desligado

sang:voz-state — estado do módulo de voz global

5. Preferências do usuário (S.settings)
Salvas em localStorage sob sanghub_phone_settings:

Chave	Padrão	Uso
theme	'aurora'	Tema visual do phone
sound	true	Tons de teclado, chamada, notificação
previewOnCall	true	Expandir phone automaticamente em chamada
iconUrl	''	URL do ícone do app Ajustes
wallpaperUrl	''	URL do papel de parede
6. Armazenamento local
Chave	Conteúdo
sanghub_device_id	UUID do dispositivo (herdado do hub)
sanghub_player_cache	{ name, mission, avatarUrl, capturedAt }
sanghub_phone_my_number	Número do usuário (6 dígitos)
sanghub_phone_contacts	Array de contatos
sanghub_phone_history	Array de chamadas (máx 60)
sanghub_phone_blocked	Array de números bloqueados
sanghub_phone_notes_played	IDs de notas já tocadas
sanghub_phone_notes_inbox	Array de recados recebidos (máx 30)
sanghub_phone_notifications	Array de notificações (máx 50)
sanghub_phone_notif_asked	'1' se já pediu permissão de Notification
sanghub_phone_minimized	'0' / '1'
sanghub_phone_layout	Layout da home (pages + dock)
sanghub_phone_home_cfg	Config visual da home
sanghub_phone_settings	Preferências do app Ajustes
Prefixo unificado: sanghub_phone_* (exceto device_id e
player_cache, herdados do hub).

Apps usam sanghub_phone_app_<id>_* (ver §10.4).

7. Firestore
Coleção	Doc	Campos
phone_numbers	{123456}	username, displayName, avatarUrl, createdAt, updatedAt
phone_owners	{username}	number, createdAt
phone_notes	auto	fromNumber, fromName, fromAvatar, toNumber, mimeType, audio(b64), size, createdAt
phone_missed	auto	toDeviceId, toNumber, fromDeviceId, fromNumber, fromName, fromAvatar, reason, ts
sessions	{deviceId}	(do hub) name, mission, hubVersion, lastSeen, ua, phoneNumber, blocked, blockedUntil, fingerprint
Regras mínimas:

text
match /phone_numbers/{doc}  { allow read, write: if true; }
match /phone_owners/{doc}   { allow read, write: if true; }
match /phone_notes/{doc}    { allow read, write: if true; }
match /phone_missed/{doc}   { allow read, write: if true; }
match /sessions/{doc}       { allow read, write: if true; }
8. Realtime Database
Path	Uso
signaling/{deviceId}/offer	Oferta 1:1 (SDP)
signaling/{deviceId}/answer	Answer ou reject
signaling/{deviceId}/ice/caller/*	Candidatos do caller
signaling/{deviceId}/ice/callee/*	Candidatos do callee
gcall/{callId}	Doc de grupo (hostId, members, speaking, status)
gcall/{callId}/members/{devId}	Membro (name, avatar, number, joinedAt, isHost)
gcall/{callId}/speaking/{devId}	VAD (s: 0/1, ts)
Regras mínimas:

json
{
  "rules": {
    "signaling": { "$sessionId": { ".read": true, ".write": true } },
    "gcall": { "$callId": { ".read": true, ".write": true } }
  }
}
9. Convenções de código
Nomenclatura: _camelCase para internos, UPPER_SNAKE para
constantes. Sem this, sem classes.

Nó único por módulo: cada módulo checa P.X._loaded no topo.

Guard clause pattern: if (!ctx) return; / if (P.X) return; no
topo de cada IIFE.

CSS via template literal com ctx.appendStyle — nunca <style>
direto no DOM.

Nunca document.body.appendChild — só ctx.root / ctx.screenEl
/ container passado por parâmetro.

Ícones: SVG inline, sempre passados por ctx.I ou pelo módulo.

Estados: guardados em ctx.phase (do calls.js) ou flags locais.
Nunca mutação cruzada de state entre módulos.

10. Criar um app
Qualquer módulo que se registre via ctx.apps.register({...}) vira um
app do phone — ícone na home, badge no launcher, notificações próprias.

10.1 Contrato mínimo
js
// modules/phone/apps/meuapp.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx || ctx.apps.get('meuapp')) return;

    ctx.apps.register({
        id:       'meuapp',          // estável, único, sem espaço
        name:     'Meu App',         // rótulo humano (home, notif, busca)
        icon:     '<svg>…</svg>',    // SVG inline, URL ou emoji
        accent:   '#a78bfa',         // cor do card de notificação
        order:    50,                // ordem no launcher (opcional)
        dock:     false,             // true = entra na dock por padrão
        builtin:  false,             // true = não pode ser removido da home
        mount(root, ctx) {           // obrigatório
            root.innerHTML = '<div>oi</div>';
        },
        unmount() {                  // opcional, mas fortemente recomendado
            // limpa timers, listeners, streams
        }
    });

    ctx.appendStyle(`/* css do app */`);
})();
Regras duras:

mount(root, ctx) recebe um root — tudo que o app renderiza
vai dentro dele. Nunca document.body, nunca ctx.root direto.

unmount() deve limpar timers (clearInterval/clearTimeout),
listeners globais (document.addEventListener), streams
(getUserMedia → track.stop()), e observers.

Se o app monta um overlay que precisa cobrir o phone inteiro,
adiciona a classe cfg-fullscreen no ctx.screenEl. O shell esconde
header/tabs nesse modo.

Se o app precisa de fundo próprio (não o gradient do phone), define
bg no def e/ou aplica --app-bg em ctx.screenEl.

10.2 Ciclo de vida
Fase	Quando	O que fazer
mount(root, ctx)	App aberto pelo usuário	Montar UI, iniciar timers locais
unmount()	App fechado, phone desligado, P.apps.openApp de outro	Parar timers, desconectar streams
foreground() (opcional)	Voltou do background	Re-fetch de dados, retomar polling
background() (opcional)	Foi pra segundo plano	Pausar polling caro
Se você declara foreground/background, o registry chama nos
momentos certos. Se não, o app fica parado enquanto não é chamado.

10.3 Notificações
Empurre via P.notify.push(...). Qualquer app pode notificar; o sistema
cuida de som, vibração, shake visual, persistência e exibição no lock
screen.

js
P.notify.push({
    appId:    'meuapp',         // casa com o id do app
    appName:  'Meu App',         // rótulo exibido no card
    icon:     '<svg>…</svg>',    // opcional, cai pro padrão do sistema
    accent:   '#a78bfa',         // cor do card; cai pro accent do app
    title:    'Título',          // obrigatório
    body:     'Texto do corpo',  // opcional
    priority: 'high',            // 'low' | 'normal' | 'high'
    sound:    true,              // default true
    vibrate:  true,              // default true
    meta:     { chatId: '123' }  // livre, app lê depois se quiser
});
Notificações de alta prioridade aparecem primeiro e têm o pulso do dot
na status bar mais forte. O sistema aplica debounce de 700ms no som
para não empilhar whistle quando várias chegam juntas.

API completa:

Chamada	O que faz
P.notify.push(entry)	Cria notificação, emite som/vibra/shake
P.notify.list()	Snapshot das notificações ativas
P.notify.dismiss(id)	Remove uma
P.notify.clear()	Remove todas
P.notify.unreadCount()	Quantas não lidas
P.notify.markAllRead()	Marca todas como lidas
P.notify.onChange(fn)	Assina mudanças no registry
P.notify.on('push', fn)	Assina só eventos de push
Exemplo — Sangzap:

js
function onMessage(msg) {
    P.notify.push({
        appId: 'sangzap',
        appName: 'Sangzap',
        icon: '<svg>…</svg>',
        accent: '#22d3ee',
        title: msg.fromName,
        body: msg.text.slice(0, 80),
        priority: msg.mention ? 'high' : 'normal',
        meta: { chatId: msg.chatId }
    });
}
10.4 Storage por app
Prefixo obrigatório: sanghub_phone_app_<id>_<chave>. Sem namespace, o
app colide com o phone ou com outro app.

js
const LS_KEY = 'sanghub_phone_app_meuapp_state';
try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(_) {}
Volume alto (mais de ~5KB por sessão) → Firestore em coleção própria
com prefixo phone_<appId>_.

10.5 Exemplo completo — app "Contador"
js
// modules/phone/apps/counter.js
(function() {
    'use strict';
    const ctx = window._phoneCtx;
    if (!ctx || ctx.apps.get('counter')) return;

    const LS_KEY = 'sanghub_phone_app_counter_count';
    let _timer = null;

    ctx.apps.register({
        id: 'counter',
        name: 'Contador',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
        accent: '#34d399',
        order: 40,

        mount(root, ctx) {
            const count = parseInt(localStorage.getItem(LS_KEY) || '0', 10) || 0;
            root.innerHTML = `
                <div class="counter-app">
                    <div class="counter-num" id="cntNum">${count}</div>
                    <button class="counter-btn" id="cntAdd">+1</button>
                </div>
            `;
            const num = root.querySelector('#cntNum');
            const add = root.querySelector('#cntAdd');

            add.addEventListener('click', () => {
                const next = parseInt(num.textContent, 10) + 1;
                num.textContent = next;
                try { localStorage.setItem(LS_KEY, String(next)); } catch(_) {}

                if (next % 10 === 0) {
                    P.notify.push({
                        appId: 'counter',
                        appName: 'Contador',
                        accent: '#34d399',
                        title: 'Marco de ' + next,
                        body: 'Você chegou em ' + next + ' cliques'
                    });
                }
            });

            _timer = setInterval(() => { /* ... */ }, 5000);
        },

        unmount() {
            if (_timer) { clearInterval(_timer); _timer = null; }
        }
    });

    ctx.appendStyle(`
        .counter-app {
            flex: 1;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 20px;
        }
        .counter-num {
            font-size: 56px; font-weight: 800;
            color: #6ee7b7;
            font-variant-numeric: tabular-nums;
        }
        .counter-btn {
            padding: 12px 28px;
            border-radius: 12px;
            background: linear-gradient(135deg, #34d399, #22d3ee);
            color: #062420; border: none;
            font-family: inherit; font-size: 14px; font-weight: 800;
            cursor: pointer;
        }
        .counter-btn:hover { transform: translateY(-1px); }
    `);
})();
Adicionar 'counter' na lista de apps carregados em shell.js:

js
await Promise.all([
    _loadModule('counter', base + '/apps/counter.js')
]);
10.6 Convenções obrigatórias
id: [a-z][a-z0-9_-]*. Estável pra sempre — o layout da home
guarda ele em localStorage. Renomear quebra o layout dos usuários.

icon: SVG inline com fill="none" stroke="currentColor" para
herdar a cor de destaque. Sem width/height — o container define.

accent: cor hex de 6 dígitos. Casa com a paleta do phone (verde
#34d399, cyan #22d3ee, violeta #a78bfa, rosa #fb7185, âmbar
#fbbf24).

CSS: sempre por ctx.appendStyle. Classes prefixadas pelo id do
app (cnt-*, sz-*, meuapp-*) para não colidir no shadow root.

Nunca: usar document.querySelector para nós do phone. Sempre
root.querySelector.

Nunca: window.open, location.href = …, document.write.
Escreve dentro de root.

Nunca: bloquear o mount. Se precisa fetch, mostra estado de
loading dentro do próprio root, retorna de mount cedo, atualiza
quando chegar.

10.7 Anti-padrões
❌	Motivo
document.body.appendChild(el)	Vaza do shadow, colide com a página
<style> injetado fora do shadow	Estilo vaza pro site do Habbo
Nome do app com espaço em id	Quebra data-app-id e busca
setInterval sem guard no unmount	Fica rodando, consome CPU, vaza
Overlay sem z-index alto	Cai atrás do header do phone
localStorage sem prefixo sanghub_phone_app_<id>_	Colide com outros apps
Emitir som próprio para notificação	Usar P.notify.push — ele já cuida
Chamar P.notify.push com sound: false + tocar manual	Duplo som quando o sistema já faz
Render do app inteiro num innerHTML gigante com listeners inline (onclick="...")	CSP quebra, listeners ficam órfãos no unmount
App que não limpa getUserMedia no unmount	Mic fica "quente", LED vermelho aceso
10.8 Descoberta de apps
Quem quiser listar apps disponíveis (launcher, busca, "Compartilhar
para…") usa o registry:

js
const apps = [...P.apps.builtinFallbacks(), ...ctx.apps.all()];
// [{ id, name, icon, accent, builtin?, dock? }, ...]
Cada def é imutável depois do registro. Não mutar def.name ou
def.icon em runtime — pra atualizar, unmount e re-register.

11. Armadilhas conhecidas
renderThread() a cada poll causa flicker. Deve comparar hash
(msgs.length | lastMsg.id | last.updatedAt | pending.size | failed.size)
antes de reconstruir o DOM.

Restaurar scroll por cálculo não funciona com imagens carregando.
Salvar scrollTop antes do innerHTML e restaurar exato quando
stick === false.

startFromCard deve aceitar 1 argumento ({ number, name }) —
o botão original é destruído quando o card fecha, o flow usa
pointerup global.

_rowHtml de contacts.js precisa renderizar .ph-note-btn senão
wireNoteButton fica órfão (bug já corrigido, não regredir).

_rejectCall e bloqueio escrevem no próprio path — nunca no path
do caller (bug já corrigido).

ICE do callee precisa ser bufferizado se chega antes do
setRemoteDescription(answer) — senão candidatos são perdidos.

home.js::_handleDragEdge só deve agir quando #phViewHome.active
existe — caso contrário auto-flip dispara em outros apps.

_syncLayout precisa deduplicar builtins + ctx.apps.all() — o
mesmo app pode vir 2×.

PIN e telefone compartilham _pinBuf — limpar ao desbloquear e ao
errar.

Notificações usam debounce de 700ms no som. Se um app empurrar 5
em rajada, só a primeira apita — é o comportamento correto. Para
tocar cada uma, quebra o debounce só no seu app.

renderLock só deve assinar P.notify.onChange uma vez. Se
assinar em cada render, o lock acumula listeners e re-renderiza N
vezes por push. Assinar no boot da home, não a cada renderLock().

12. Não fazer
❌ Criar abstração para 2 usos.

❌ Passar callback quando dá pra usar evento (sang:*).

❌ Guardar estado em window.* fora do bridge.

❌ Mexer em document.body direto.

❌ Usar setInterval para o que evento resolve (MutationObserver,
pointerup, visibilitychange).

❌ Introduzir biblioteca (lodash, moment, etc.).

❌ Sobrepor CSS de módulo no style.js — cada módulo injeta o seu.

❌ Chamar _renderHome() sem snapshot de scrollTop.

❌ Reescrever innerHTML de container que o usuário está interagindo.

❌ Refatorar por estética.

❌ Duplicar som de notificação manualmente — deixar o sistema fazer.

13. Fluxo típico de sessão
Usuário abre Habbo → hub carrega hub2.js

hub2.js monta UI do hub + injeta módulos do manifesto

Módulo phone é carregado (shell.js)

Shell baixa irmãos em paralelo; home monta; lock aparece com notif
feed

Chega notificação → whistle + buzz + card no lock, badge atualiza

Usuário desbloqueia (swipe-up pra PIN ou tap direto) → home

Abre um app → P.apps.openApp(id) → .ph-view-app.active

Fecha app → volta pra home (não destrói o phone, só troca view)

Recebe chamada → sang:phone-incoming → calls.onIncoming → view
de chamada + notif push

Minimize → .ph-frame.min (rotação + tuck na borda direita)

F5 → estado persistido em localStorage, tudo volta onde estava

14. Checklist para novas IAs
Antes de propor código, verifique:

□ A mudança já foi tentada antes nesta sessão? (memória)
□ Ela respeita a bridge (ctx.* / P.<módulo>)?
□ Ela evita as armadilhas da §11?
□ Ela não reintroduz nada da §12?
□ O CSS vai pelo ctx.appendStyle, não solto no <head>?
□ O localStorage usa o prefixo sanghub_phone_*?
□ Se é chamada WebRTC, escreve no path próprio?
□ Se é Firestore, casa por deviceId ou number?
□ Se mexe na home, preserva scrollTop antes do rebuild?
□ Se é app novo, segue o contrato da §10?
□ Se notifica, usa P.notify.push em vez de tocar som próprio?
Se todas ✓, entregar direto sem reexplicar arquitetura.

text

**o que mudou, resumo:**

- **§1:** `notifications.js` na árvore + ordem de boot atualizada.
- **§2.2:** `P.notify` na lista de namespaces.
- **§3:** novo §3.8 `notifications.js` (som, vibração, shake, API completa, quem empurra). Renumerado o resto (3.8→3.9, até 3.13).
- **§3.6 (home):** lock reescrito — duas views internas (notifs + pin), swipe-up pra PIN, chevron pulsante, feed de notificações.
- **§3.10 (calls):** menção de notificação via `P.notify.push`.
- **§3.11 (notes):** idem.
- **§4:** linhas de contrato para notificações + evento `sang:phone-notify`.
- **§6:** `sanghub_phone_notifications` + nota sobre prefixo por app.
- **§10:** substituído pelo guia completo de criação de apps (contrato, ciclo de vida, notificações, storage, exemplo, convenções, anti-padrões, descoberta).
- **§11:** duas armadilhas novas (debounce do som, listener duplicado no lock).
- **§12:** anti-padrão de duplicar som.
- **§13:** fluxo de sessão menciona notificação no lock.
- **§14:** dois itens novos de checklist.
