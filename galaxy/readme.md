markdown
# Galaxy GPU

Simulação interativa de galáxias com 200k+ partículas em tempo real, usando
[Taichi](https://www.taichi-lang.org/) para computação em GPU.

Duas cenas prontas (`single` e `collision`), física gravitacional de dois
centros com halo, integração leapfrog, bloom pós-processado, modo 3D opcional,
reação a microfone, gravação de GIF e painel de ajuste em tempo real.

![preview](docs/preview.png)

---

## Requisitos

| Componente | Versão | Necessário |
|---|---|---|
| Python | 3.12+ | sim |
| `taichi` | 1.7+ | sim |
| `numpy` | 1.24+ | sim |
| `pygame` | 2.5+ | UI padrão (`--ui pygame`) |
| `sounddevice` | opcional | reação a microfone (`--ui` qualquer) |
| `ffmpeg` | opcional | exportar GIF pela tecla `G` |
| Vulkan ≤ 1.3 | opcional | `--ui ggui` |

Backends suportados pelo Taichi: **CUDA**, **Vulkan**, **Metal**, **CPU**.
Sem GPU compatível, use `--cpu` (mais lento, mas funcional).

---

## Instalação

```bash
# ambiente virtual (recomendado)
python -m venv .venv
source .venv/bin/activate        # Linux/macOS
.venv\Scripts\activate           # Windows

# dependências principais
pip install taichi numpy pygame

# opcionais
pip install sounddevice          # microfone
Uso
bash
python galaxy.py                                  # padrão: colisão, medium, 200k partículas
python galaxy.py --preset single                  # galáxia única
python galaxy.py --quality low                    # PC lento
python galaxy.py --n 500000 --res 1920 1080       # modo "showcase"
python galaxy.py --cpu --perf                     # diagnóstico em CPU
python galaxy.py --ui ggui                        # UI alternativa (Vulkan)
Argumentos
Flag	Valores	Default	Descrição
--n	inteiro	perfil	Número de partículas
--preset	single, collision	collision	Cena inicial
--res	LARG ALT	perfil	Resolução (arredondada para múltiplo de 4)
--quality	low, medium, high	medium	Preset de resolução + partículas + bloom
--ui	pygame, ggui	pygame	Front-end
--cpu	flag	—	Força backend CPU do Taichi
--perf	flag	—	Loga ms/frame por estágio a cada 60 frames
Perfis de qualidade:

Perfil	Resolução	Partículas	Subpassos	Bloom
low	640×360	80 000	1	off
medium	960×540	200 000	2	on
high	1280×720	300 000	2	on
Controles
Teclado
Tecla	Ação
1	Carrega galáxia única
2	Carrega colisão de galáxias
R	Reinicia a simulação
Espaço	Pausa / retoma
P	Cicla paleta de cores (4 opções)
V	Alterna modo 3D
H	Mostra / esconde o painel
A	Liga / desliga reação ao microfone
G	Inicia / finaliza gravação de GIF
X	Salva screenshot em PNG
Q	Restaura qualidade original (após degrade() automático)
F11	Alterna tela cheia
ESC	Sai
Mouse
Ação	Efeito
Botão esquerdo (arrastar)	Atrai partículas
Botão direito (arrastar)	Repulsa partículas
Botão esquerdo (fora do painel, 3D)	Gira a câmera
Roda	Zoom no modo 3D
Arrastar sobre os sliders	Ajusta em tempo real
Arquitetura
O projeto é deliberadamente um único arquivo por enquanto. Está organizado
em seções claras:

text
┌───────────────────────────────────────────────────────────────┐
│ CONFIG           dataclasses + enums + parsing da CLI         │
│ STATE            ti.fields (GPU) + SimState/RuntimeParams     │
│ SIM              kernels de física (spawn, move_centers, step)│
│ RENDER           splat, bloom, compose (tone-map + gamma)     │
│ HELPERS          push(), load(), sim(), post_*()              │
│ EXTRAS           Extras: gerencia microfone + gravação        │
│ UI PYGAME        run_pygame()                                 │
│ UI GGUI          run_ggui()                                   │
│ MAIN             entrypoint                                   │
└───────────────────────────────────────────────────────────────┘
Fluxo por frame (pygame):

text
input  →  push()  →  sim()  →  splat()/splat3d()  →  bloom
       →  compose_u8()  →  to_numpy()  →  frombuffer  →  blit
       →  overlay do painel  →  flip  →  recorder
Decisões de projeto
Física analítica de 2 centros (não N-corpos). Custo O(N), estável e
visualmente convincente. Não há auto-gravidade entre partículas.

Integrador leapfrog (KDK) tanto nos centros quanto nas partículas —
conserva energia em órbitas longas; Euler injetava energia e fazia a
galáxia "evaporar" em minutos.

Bloom em resolução /4 com gaussiana separável de 13 taps × 2 passadas.

Composição num único kernel (compose_u8): tone-map 1 - e^-c,
correção gamma sRGB, conversão para u8 e Y-flip em uma passada só.

Apresentação via pygame.image.frombuffer — o outu é um
ti.field(u8, (H, W, 3)) row-major que casa direto com o buffer protocol,
evitando a cópia intermediária que surfarray.blit_array fazia.

Degradação automática: se FPS fica abaixo de 24 por 2,5 s, o sistema
reduz bloom → subpassos → número de partículas. Q restaura.

Parâmetros ajustáveis
Via painel (pygame/ggui) ou edição direta em SimState/RuntimeParams:

Parâmetro	Faixa	Efeito
g (Gravidade)	0.1 – 1.5	Força do potencial 1/r²
halo	0.0 – 1.5	Termo de halo (potencial tipo isothermal)
mouse	0.0 – 4.0	Intensidade do arrasto
time	0.0 – 3.0	Multiplicador de dt
br (Brilho)	0.02 – 0.6	Ganho do splat
fade (Rastro)	0.6 – 0.98	Decaimento do buffer acumulador
bloom	0.0 – 3.0	Intensidade do glow
pal (Paleta)	0 – 3	0=clássica, 1=chama, 2=gelo, 3=dupla
Constantes físicas em galaxy.py: EPS, RC, DT, EXPO, GAMMA.

Saída
Arquivo	Quando	Observação
galaxy_YYYYMMDD_HHMMSS_mmm.png	Tecla X ou botão "Screenshot"	PNG full-resolution
rec_YYYYMMDD_HHMMSS_mmm/	Tecla G (início)	Diretório de frames
rec_.../video.gif	Tecla G (fim)	Requer ffmpeg no PATH
Diagnóstico
Ative --perf para logar, a cada 60 frames:

text
ms/frame  sim 3.1  render 2.4  xfer 1.8  ui 0.9  |  58 FPS
Estágio	O que mede	Gargalo típico
sim	move_centers + step	--n muito alto
render	splat + bloom + compose	resolução + bloom
xfer	outu.to_numpy() (GPU→CPU)	tráfego PCIe
ui	Overlay + pygame.display.flip	resolução + vsync
Logging via logging no nível INFO. Para silenciar:
python -c "import logging; logging.disable(logging.INFO)" ou editar
basicConfig em __main__.

Empacotamento
bash
pyinstaller --onefile galaxy.py
Notas:

Taichi + PyInstaller exige que os arquivos de runtime do backend sejam
incluídos (normalmente resolvido por hooks do próprio Taichi 1.7+).

sounddevice e pygame precisam ser declarados como --hidden-import
se forem opcionais no ambiente de build.

O binário resultante é específico do backend (CUDA/Vulkan/CPU) da máquina
de build.

Limitações conhecidas
Sem auto-gravidade N-corpos. É uma aproximação de 2 centros — rápido e
estável, mas não é uma simulação cosmológica realista.

Bloom tem resolução fixa em 1/4 da tela. Em --quality low (640×360),
o buffer fica 160×90 e o resultado é bastante borrado — é intencional, mas
visível.

--ui ggui depende de Vulkan ≤ 1.3; em drivers mais novos o Taichi
ainda não expõe suporte estável. Use --ui pygame como padrão.

Modo 3D só funciona com projeção perspectiva simplificada (sem
z-buffer, sem ordenação) — correto para splat aditivo, mas não serve para
geometria sólida.

Sem persistência de configuração. Ajustes do painel não são salvos
entre execuções.

--perf adiciona ti.sync() por estágio — use só para diagnóstico,
não em produção.

Roadmap
Itens em ordem de prioridade (ver CHANGELOG interno para detalhes):

□ Extrair classe Simulation (encapsula fields/kernels, destrava testes)
□ Módulos separados (sim.py, render.py, ui_pygame.py, ...)
□ Testes pytest de sanidade da física (finito, conservação aproximada)
□ Presets em JSON + save/load de configuração
□ Overlay de ajuda em runtime (tecla ?)
□ Auto-gravidade via TreePM (mudança arquitetural grande)
□ Fusão de buracos negros quando centros colidem
Licença
(não definida — adicione um LICENSE antes de publicar)

text

---

## Notas sobre escolhas do README

- **Estrutura**: começa com *o que é* → *como instalar* → *como usar* →
  *como funciona* → *como estender*. Padrão de projetos sérios.
- **Seções "Arquitetura" e "Decisões de projeto"** existem para economizar
  tempo de quem for manter depois — explicam *por que* leapfrog, *por que*
  `frombuffer`, *por que* bloom em /4. Coisas que o código não conta sozinho.
- **Tabela de `--perf`** mapeia cada estágio ao gargalo típico. Sem isso, o
  usuário não sabe o que fazer com o número.
- **Limitações e Roadmap** estão explícitos — sinaliza maturidade e evita que
  alguém reporte "bug" do que é escolha de design.
- **Não incluí badges** (CI, downloads, etc.) porque não há CI nem release
  ainda; badges falsos são pior que ausência de badges.
- **`docs/preview.png`** está referenciado no topo — o README só fica bom
  quando você adicionar um screenshot real. Recomendo gravar 5 s de
  `--preset collision --res 1280 720` e salvar como `docs/preview.png`.
