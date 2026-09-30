markdown
# Sang Hub — README técnico

Gerenciador de módulos embutido no Habbo privado (userscript Tampermonkey).
Carrega, ativa, desativa e atualiza módulos dinamicamente via manifesto
remoto. Expõe uma bridge única (`window._hubBridge`) para todos os módulos.
Divide-se em 3 arquivos: orquestrador + UI + RTC.

**Repositório:** `github.com/zBeyond5/Liveblock`
**Base:** `https://raw.githubusercontent.com/zBeyond5/Liveblock/refs/heads/main/menu`

---

## 1. Estrutura
menu/
├── hub2.js # Orquestrador — gate, identidade de device, sessão,
│ # Firestore/RTDB, SFX, WebSocket hook, loader, manifesto,
│ # auto-update, comandos de voz, playtime, boot
├── hub-ui.js # UI — painel, pill, drag, toast, tabs, lista, anti-lag,
│ # botão de voz, info do player
├── hub-rtc.js # WebRTC — listener de signaling/{deviceId}, banner de
│ # chamada recebida, accept/reject/stop, MediaStream
├── phone-firebase.js # Firebase exclusivo do phone (carregado pelo hub)
├── admin.js # Painel admin (carregado sob demanda por Ctrl+B)
└── manifest.json # Manifesto de módulos

text

Ordem de boot:

1. `hub2.js` é o userscript entry point. Executa `boot()`
2. Boot: `_gate()` → `_iniciarHeartbeat()` → `_iniciarBlockWatcher()`
3. Carrega `hub-ui.js` via próprio `loadModule`
4. Carrega `hub-rtc.js` via próprio `loadModule`
5. Baixa e injeta `phone-firebase.js` (opcional, não bloqueia)
6. `refreshManifest(false)` — carrega módulos com `autoload: true`
7. `_carregarAdmin()` em 1.5s
8. Watchdog agenda `autoUpdateLoop` a cada 3min

**`hub-ui.js` e `hub-rtc.js` não têm boot próprio.** São scripts injetados
via `<script>` inline. Cada um se registra em `_hubBridge.ui` / `_hubBridge.mic`
ao final da execução. Se um falhar, o hub continua rodando com `?.` em tudo.

---

## 2. Bridge central

`window._hubBridge` é o **único** ponto de contato entre o hub e qualquer
coisa externa (sub-módulos, UI, RTC, admin, phone, outros módulos do
manifesto). Nunca acesse variáveis internas de outro arquivo.

### 2.1 Superfície

| Chave | Tipo | Descrição |
|---|---|---|
| `HUB_VERSION` | string | Versão atual (ex.: `"1.5.1"`) |
| `STATUS` | object | `{ UNLOADED, LOADING, LOADED, ERROR }` |
| `TABS` | array | `[{ id: 'modules', label }, { id: 'misc', label }]` |
| `state` | getter | Objeto de estado (`manifest`, `moduleStates`, `syncState`, `killFlag`, `activeTab`) |
| `deviceId` | getter | UUID do device (`sanghub_device_id`) |
| `fingerprint` | getter | SHA-256 do device estável |
| `secretOn` | getter | Módulos secret liberados? |
| `blocked` | getter | Device bloqueado remotamente? |
| `antiLag` | getter | Modo anti-lag ativo? |
| `setAntiLag(v)` | fn | Liga/desliga anti-lag; emite `sang:antilag-changed` |

### 2.2 Métodos

| Método | O que faz |
|---|---|
| `refreshManifest(bypassCache?)` | Recarrega manifesto; ativa módulos `autoload` |
| `activateModule(mod)` | Baixa + injeta um módulo |
| `deactivateModule(mod)` | Mata instância do módulo |
| `handleModuleClick(mod)` | Alterna on/off |
| `loadModule(mod)` | Baixa + injeta código por URL |
| `handleVoiceCommand(text)` | Processa comando de voz já transcrito |
| `tentarRegistrarHandlerVoz()` | Registra handler em `_voiceCommands` |
| `limparHandlerVoz()` | Remove handler |
| `autoUpdateLoop()` | Força checagem de update + manifesto |
| `kill()` | Desmonta UI, RTC, admin, timers. Seta `killFlag = true` |
| `destroy()` | Alias de `_autodestruir` (usado em bloqueio runtime) |
| `toast(msg, kind)` | Delega pro `_hubBridge.ui.toast` |
| `log` / `warn` / `err` | Logs com prefixo `🔶 [Hub]` |

### 2.3 Namespaces

**`util`** — helpers puros:
- `escapeHtml(str)` — escapa `& < > " '`
- `loadPlayerCache()` — lê `sanghub_player_cache`
- `formatDuration(ms)` — `HH:MM:SS`
- `formatClock()` — `HH:MM` pt-BR
- `getPlaytime()` → `{ session, total }` em ms

**`player`** — info do jogador (getters):
- `raw`, `name`, `mission`, `avatarUrl`, `capturedAt`
- `refresh()` — reenvia heartbeat e reemite `sang:player-updated`

**`sfx`** — `muted()`, `setMuted(v)`, `play(name)`

**`admin`** — `unlocked()`, `notify()` (emite `sang:admin-state`)

**`gate`** — `fp`, `secretOn`, `blocked`, `mode` (`'auto'|'on'|'off'`), `setMode(m)`, `recompute()`

**`blk`** — `fixed()`, `extra()`, `add(fp)`, `remove(fp)`, `full()`

**`firestore`** — `configured()`, `request(method, path, body, query)`, `parseDoc(doc)`, `value(v)`

**`rtdb`** — `url`, `get(path)`, `put(path, v)`, `post(path, v)`, `del(path)`

**`phone`** — `registerMissedCall(payload)` (POST em `phone_missed`)

**`ui`** — populado por `hub-ui.js`:
- `toast(msg, kind)`, `flashItem(id, kind)`
- `showPanel()`, `showPill()`, `hideAll()`
- `renderList()`, `renderChrome()`

**`mic`** — populado por `hub-rtc.js`:
- `available()`, `state()` (`'idle'|'incoming'|'connected'`), `currentCaller()`
- `accept()`, `reject()`, `stop()`

---

## 3. Módulos em detalhe

### 3.1 `hub2.js`

Coração do hub. Tudo que **não é visual nem RTC** mora aqui.

**Gate:**
- Fingerprint estável = SHA-256 de `UA + lang + cores + tela + tz + platform`
- Device ID = UUID persistido em `sanghub_device_id` (criado 1× no primeiro boot)
- Modo secret: `auto` (bloqueia se fingerprint em `_blk` ou `_blkExtra`), `on`, `off`
- Bloqueio remoto: `sessions/{deviceId}.blocked` no Firestore
- `_iniciarBlockWatcher()` roda a cada 60s e reage a mudanças

**Sessão / heartbeat:**
- `_criarOuAtualizarSessao()` no boot — cria/atualiza `sessions/{deviceId}`
- `_enviarHeartbeat()` a cada 2min — atualiza `name`, `mission`, `hubVersion`, `lastSeen`, `ua`
- `_aplicarCacheJogador()` — reenvia heartbeat + emite `sang:player-updated`

**SFX:** sintetizado via WebAudio (não usa samples). Métodos: `hover`, `expand`, `toggleOn/Off`, `success`, `error`, `alert`, `unblocked`, `whoosh`, `pickup`, `drop`, `ring`, `micOn`, `micOff`. Respeita `sanghub_sfx_muted`.

**WebSocket hook:** intercepta `window.WebSocket` e expõe `window._hubSocket` com `getActive()`, `onConnect(cb)`, `onMessage(cb)`. Módulos podem observar tráfego do client Habbo.

**Loader:** `loadModule({ id, url, instanceKey })` — se `instanceKey` já existe em `window`, chama `.kill()` antes de reinstalar. Injeta via `<script>` inline, `?t=Date.now()` anti-cache.

**Manifesto:** cacheado em `sanghub_manifest_cache` por 2min. Estrutura: `{ version, modules: [...] }`. Cada módulo tem `id`, `name`, `icon`, `description`, `url`, `enabled`, `autoload`, `secret?`, `admin?`, `misc?`, `instanceKey?`.

**Auto-update:** a cada 3min baixa `HUB_UPDATE_URL`, compara `HUB_VERSION` por regex. Se diferir, aplica (remove scripts `[data-hub]` não-block, mata UI/RTC, seta `killFlag`, re-injeta). Watchdog de 1min reagenda `autoUpdateLoop` se sumir.

**Comandos de voz:** recebe texto transcrito, casa com nome/alias do módulo. Aliases em `VOICE_ALIASES`. Verbos de abertura em `VOICE_OPEN`, fechamento em `VOICE_CLOSE`. Delega pro `_voiceCommands` (módulo `voz`).

**Missed calls:** `_registrarMissedCall(payload)` faz `POST /phone_missed`. Usado pelo phone e pelo `hub-rtc.js` quando recebe oferta de phone com `window._phone` ausente.

### 3.2 `hub-ui.js`

Toda a UI. CSS inteiro no bloco `style.textContent` (não delegar a módulos externos).

**Estrutura do DOM:**
- `#_hub` — painel (336×85vh)
- `#_hubpill` — pill (250×auto)
- `#_hubhdr` — header com drag handle
- `#_hubtabs` — tabs Módulos / Adicionais
- `#_hubtabs` + `#_hublist` — corpo
- `#_hubtoast` — toast absoluto

**Estado local:** `_antiLag`, `voiceActive`, `vozHabilitado`, `recognition`. Nenhum escreve em `state` do hub — leem via bridge.

**Drag:** dois loops `requestAnimationFrame` independentes (painel e pill). Sistema massa-mola: `_dragVel.x = (_dragVel.x + dx * S) * D`. Squash & stretch via `--sx` / `--sy`. Cross-fade entre painel/pill via timer 90ms.

**Render:** escuta `sang:hub-ui-update` com `{ reason: 'state'|'manifest'|'chrome' }`. Também reage a `sang:module-close` e `sang:admin-state`.

**`renderPillStats()`** — chamada a cada 1s. Lê `util.getPlaytime()` (dentro de `util`, não na raiz da bridge) e escreve em `sessionEl` / `totalEl`.

**Anti-lag:** adiciona classe `.anti-lag` em painel + pill + botão. Remove animações, gradientes, backdrop-filter. Persiste em `sanghub_antilag`. Emite `sang:antilag-changed`.

### 3.3 `hub-rtc.js`

Listener de WebRTC para chamadas recebidas (mic global do hub, separado do phone).

- `EventSource` em `signaling/{deviceId}/offer`
- Ofertas com `kind: 'phone'` são delegadas via `sang:phone-incoming`
- Ofertas com `type: 'offer'` são tratadas localmente (banner + ring)
- `type: 'hangup'` cancela ring se o `fromId` casar
- Accept: cria `RTCPeerConnection`, escreve `answer` em `signaling/{deviceId}/answer`
- ICE: POST em `signaling/{deviceId}/ice/hub`, listener em `signaling/{deviceId}/ice/admin`

**Banner:** `#_hubMicBanner` — fixo bottom-center. Botões Aceitar/Recusar. Reaproveita keyframes `_hubMicShellIn`, `_hubMicVibrate`, `_hbMicPulse` de `hub2.js::_ensureBlockStyle`.

**Auto-start:** chama `_micStartListener()` no final do arquivo. Se RTDB não responde em 6s, marca `_micReady = { ok: false, reason: 'rtdb' }`.

---

## 4. Eventos globais (`window`)

| Evento | Emitido por | Consumido por |
|---|---|---|
| `sang:player-updated` | `hub2.js` (`_aplicarCacheJogador`, ou outra aba via `storage`) | UI (atualiza pill) |
| `sang:antilag-changed` | `hub2.js` (storage sync) ou UI (click) | UI |
| `sang:admin-state` | admin.js | UI (`renderList`) |
| `sang:hub-ui-update` | `hub2.js` (`refreshManifest`, `activateModule`, `deactivateModule`, storage `ADMIN_TOKEN_KEY`) | UI (`renderList`/`renderChrome`) |
| `sang:module-close` | qualquer módulo, com `{ id }` | UI (`renderList`) |
| `sang:voz-state` | módulo `voz` | `hub2.js` + UI |
| `sang:voz-ready` | módulo `voz` | `hub2.js` |
| `sang:voz-query` | `hub2.js` (no boot) | módulo `voz` |
| `sang:phone-incoming` | `hub-rtc.js` (repassa oferta `kind: 'phone'`) | `phone/shell.js` |
| `sang:phone-notify` | reservado | — |

**Regra:** eventos `sang:*` são fire-and-forget. Nunca use para sincronizar estado crítico; para isso use a bridge.

---

## 5. Armazenamento local

Prefixo: `sanghub_*`. **Device-scoped** (não user-scoped ainda — pendente camada de identidade).

| Chave | Conteúdo | Escopo |
|---|---|---|
| `sanghub_device_id` | UUID estável do device | device |
| `sanghub_player_cache` | `{ name, mission, avatarUrl, capturedAt }` | device |
| `sanghub_fs_auth` | `{ idToken, refreshToken, expiresAt }` | device |
| `sanghub_p2` | Modo secret (`'0'` / `'1'` / ausente) | device |
| `sanghub_blk_extra` | Array de fingerprints bloqueados | device |
| `sanghub_admin_token` | `{ t: timestamp }` | device |
| `sanghub_manifest_cache` | `{ t, data: manifest }` | device |
| `sanghub_playtime_total_ms` | Total acumulado em ms | device |
| `sanghub_sfx_muted` | `'0'` / `'1'` | device |
| `sanghub_antilag` | `'0'` / `'1'` | device |
| `sanghub_voice_enabled` | `'0'` / `'1'` | device |

**Módulos do manifesto:** cada um deve usar `sanghub_<moduleId>_*`. Ex.: `phone` usa `sanghub_phone_*`.

---

## 6. Firestore

`https://firestore.googleapis.com/v1/projects/sanghub-ecf46/databases/(default)/documents`

Auth anônima via Identity Toolkit. Token cacheado em `sanghub_fs_auth`, renovado via refresh token.

| Coleção | Doc | Campos |
|---|---|---|
| `sessions` | `{deviceId}` | `name`, `mission`, `hubVersion`, `lastSeen`, `ua`, `sessionStart`, `blocked`, `blockedUntil`, `fingerprint` |
| `phone_missed` | auto | `toDeviceId`, `toNumber`, `fromDeviceId`, `fromNumber`, `fromName`, `fromAvatar`, `reason`, `ts` |
| `phone_numbers` | `{6digits}` | (do phone) |
| `phone_owners` | `{username}` | (do phone) |
| `phone_notes` | auto | (do phone) |

**Regras mínimas:** leitura/escrita liberada nas coleções de phone; `sessions` controlado por `_deviceId`.

---

## 7. Realtime Database

`https://sanghub-ecf46-default-rtdb.firebaseio.com`

| Path | Uso |
|---|---|
| `signaling/{deviceId}/offer` | Oferta 1:1 (mic global do hub) |
| `signaling/{deviceId}/answer` | Answer ou reject |
| `signaling/{deviceId}/ice/hub` | ICE do hub |
| `signaling/{deviceId}/ice/admin` | ICE do admin |
| `signaling/{deviceId}/ice/caller` | ICE do caller (phone) |
| `signaling/{deviceId}/ice/callee` | ICE do callee (phone) |
| `gcall/{callId}` | Grupo (do phone) |

**Nota:** paths de signaling usam `deviceId` puro. Se a camada de identidade for implementada, deve virar `{deviceId}:{userKey}` para evitar colisão entre contas no mesmo browser.

---

## 8. Criar um sub-módulo do hub

Um sub-módulo é um script carregado pelo `loadModule`. Não é um módulo do manifesto — é código que estende o hub.

### 8.1 Contrato

```js
// hub-meu.js
(function() {
    'use strict';
    if (window._hubMeu) return;               // idempotência
    const B = window._hubBridge;
    if (!B) { console.warn('[hub-meu] bridge ausente'); return; }

    // ... lógica ...

    function kill() {
        // limpa timers, listeners, DOM
        delete window._hubMeu;
    }

    window._hubMeu = { kill };
    // Se for UI:
    B.ui = Object.assign(B.ui || {}, { /* ... */ });
    // Se for RTC:
    B.mic = Object.assign(B.mic || {}, { /* ... */ });
})();
8.2 Carregamento
Adicione constante em hub2.js:

js
const HUB_MEU_URL = "https://.../menu/hub-meu.js";
E no boot(), após carregar UI e RTC:

js
HLOG('🛠️  Carregando hub-meu.js…');
try { await loadModule({ id: 'hub-meu', url: HUB_MEU_URL }); }
catch(e) { HERR('Falha ao carregar hub-meu.js:', e); }
8.3 Regras
Sempre checa if (window._hubXxx) return;

Sempre pega const B = window._hubBridge e usa só a bridge

Nunca acesse variáveis internas de hub2.js (elas vivem em closure)

Sempre exponha kill() que limpa 100% (timers, listeners, DOM)

Nunca escreva em state da bridge (é read-only na prática)

Sempre registre populates em B.ui / B.mic via Object.assign (não substitua)

Se falhar em carregar, hub2.js continua — seu código deve ser opcional

8.4 O que NÃO fazer
❌ document.body.appendChild(el) sem kill() correspondente
❌ setInterval sem guard de cleanup
❌ window._meuEstado = {} fora da bridge (colide com outros scripts)
❌ Duplicar CSS que já está em hub-ui.js (não sobrepor)
❌ Adicionar dependência entre sub-módulos (se A precisa de B, use evento sang:*)

9. Convenções
Nomenclatura:

_camelCase para internos

UPPER_SNAKE para constantes

_timers / _cleanup / _registry para objetos de rastreio

Prefixo _ em variáveis de módulo (não globais)

Estilo:

IIFE (function() { 'use strict'; ... })();

Guard clause no topo: if (window._x) return;

Sem this, sem classes, sem generators

Sem dependências externas (lodash, moment, etc.)

Template literals para HTML e CSS

Nada de innerHTML com input do usuário não escapado

Assíncrono:

async/await sempre

Timeout em todo fetch (via AbortController)

Retry em fetch com backoff linear (600ms × tentativa)

Erros silenciosos com console.warn, nunca throw propagando para fora do IIFE

Estado:

Nada em window.* fora da bridge

Nada em state mutado de fora da bridge

Preferir eventos sang:* a callbacks cross-module

10. Armadilhas conhecidas
_ensureBlockStyle vive em hub2.js, não em hub-ui.js — porque RTC precisa dos keyframes _hbMicPulse, _hubMicShellIn, _hubMicVibrate antes de rodar. Se mover keyframes pra UI, quebra o RTC.

getPlaytime vive em util, não na raiz da bridge. Chamar B.getPlaytime() retorna undefined. Sempre B.util.getPlaytime().

kill() exposta na bridge NÃO destrói _hubBridge — só desmonta recursos. A bridge continua viva para inspeção.

deactivateModule NÃO zera _hubBridge.tentarRegistrarHandlerVoz — bug crítico da v1.5.0. Só chama limparHandlerVoz() quando o módulo de voz não está disponível.

applyHubUpdate seta killFlag antes de limpar. Isso impede que timers internos disparem durante o teardown. Não inverter.

_timers é o registry central. Não adicione timers sem registrá-los — o _clearAllTimers() não os encontra.

phone-firebase.js é best-effort. Falha de carregamento não bloqueia o hub. O phone tem fallback pro bridge do hub.

_blockWatcher roda a cada 60s. Depois de state.killFlag = true, ele ainda chama _gate() mas retorna cedo. Não remova o guard.

checkHubUpdate compara versão por regex no HUB_VERSION. Se você renomear a constante, o auto-update para de detectar.

renderList faz innerHTML = '' seguido de rebuild. Não chame enquanto o usuário interage com um item (perde o foco).

storage event só dispara em OUTRAS abas. Para o mesmo tab, use a função diretamente.

sang:player-updated é emitido múltiplas vezes (storage sync, heartbeat, refresh manual). Listeners devem ser idempotentes.

11. Fluxo típico de sessão
Usuário abre Habbo → Tampermonkey injeta hub2.js

IS_CORE verdadeiro → não é /me, segue boot

document.body pronto → _gate() calcula fingerprint, carrega device ID, checa bloqueio remoto

_iniciarHeartbeat() — cria/atualiza sessions/{deviceId} no Firestore

_iniciarBlockWatcher() — agenda poll de 60s

Carrega hub-ui.js → painel e pill montam, B.ui populado

Carrega hub-rtc.js → listener de signaling inicia, B.mic populado

Baixa phone-firebase.js (não-bloqueante)

refreshManifest(false) → cache ou fetch → ativa módulos autoload

_carregarAdmin() em 1.5s (só se _adminUnlocked())

Watchdog agenda autoUpdateLoop a cada 3min

Usuário interage: clica módulo → handleModuleClick → activateModule → loadModule

Módulo novo é injetado no DOM, inicializa em IIFE, para quando precisar

Auto-update compara versões → se novo, applyHubUpdate (kill + re-inject)

F5 → estado persistido em localStorage, tudo volta onde estava

12. Trabalho futuro
12.1 Camada de identidade (pendente)
Motivação: hoje todas as chaves sanghub_* são device-scoped. Trocar de conta no mesmo browser herda sessão, playtime, preferências e (para o phone) número, contatos, histórico.

Plano:

_resolveUserKey() — deriva de sanghub_player_cache.name, normaliza para slug ([a-z0-9_-])

Gate de boot: espera sang:player-updated se cache ausente

B.util.lsKey(k) → `sanghub_${userKey}_${k}`

B.util.ls — wrapper { get, set, del, json }

Escopo por chave:

device: device_id, fs_auth, manifest_cache, blk_extra, p2

user: player_cache, playtime_total_ms, voice_enabled, sfx_muted, antilag, admin_token, todos os phone_*

Composição signalingId = ${deviceId}:${userKey} para paths de RTDB

Migração única via flag sanghub_identity_migrated_v1

Decisões pendentes: escopo de admin_token, modo guest quando sem cache, migração suave vs limpa.

12.2 Outras
Leader election entre abas via BroadcastChannel('hub') — evita ring duplicado, dois auto-updates simultâneos

Validação de payload em sang:phone-incoming (guard contra toNumber ausente)

ensureBlockStyle extraído para hub-ui.js e RTC consome via evento de "styles ready"

state.currentHubVersion sincronizado com HUB_VERSION após update remoto

13. Checklist para novas IAs
Antes de propor código:

□ Já foi tentado nesta sessão? (ver histórico)
□ Respeita a bridge (_hubBridge.*)?
□ Não duplica CSS que já existe em hub-ui.js?
□ Não reimplementa keyframes que estão em hub2.js::_ensureBlockStyle?
□ Usa B.util.getPlaytime() (não B.getPlaytime())?
□ Se é sub-módulo: tem kill() que limpa timers e DOM?
□ Se é sub-módulo: registra timers em _timers do hub (se aplicável)?
□ Se mexe em hub-ui.js: dispara sang:hub-ui-update pra re-render?
□ Se mexe em storage: usa o prefixo sanghub_<moduleId>_*?
□ Se é assíncrono: tem timeout + try/catch?
□ Se é evento sang:*: é fire-and-forget (não espera resposta)?
□ Se é kill(): para timers, remove listeners, limpa DOM, delete window._xxx?
