"""Galaxy GPU — simulação interativa de galáxias em Taichi.

Física (Simulation) e render (Renderer) são @ti.data_oriented, permitindo
instanciar sem UI e testar em pytest.

Uso:
    python galaxy.py --preset collision --n 300000 --res 1280 720
    python galaxy.py --quality low --perf
    python galaxy.py --ui ggui          # requer driver Vulkan <= 1.3

Dependências: taichi, numpy. Opcional: pygame (UI padrão), sounddevice (áudio).
"""
import argparse
import logging
import math
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

import numpy as np
import taichi as ti

try:
    import sounddevice as sd
except Exception:  # dependência opcional
    sd = None


log = logging.getLogger("galaxy")


# ================================================================ CONFIG
class Quality(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Preset(str, Enum):
    SINGLE = "single"
    COLLISION = "collision"


class UIMode(str, Enum):
    PYGAME = "pygame"
    GGUI = "ggui"


@dataclass(frozen=True)
class QualityProfile:
    """Resolução, partículas, subpassos e bloom por nível de qualidade."""
    width: int
    height: int
    particles: int
    substeps: int
    bloom_enabled: int


QUALITY_PROFILES: dict[Quality, QualityProfile] = {
    Quality.LOW:    QualityProfile(640, 360, 80_000, 1, 0),
    Quality.MEDIUM: QualityProfile(960, 540, 200_000, 2, 1),
    Quality.HIGH:   QualityProfile(1280, 720, 300_000, 2, 1),
}

# Constantes físicas / de render.
EPS: float = 9e-4
RC: float = 0.02
DT: float = 0.004
EXPO: float = 1.2
GAMMA: float = 1.0 / 2.2  # sRGB aproximado


def _normalized_gaussian(n: int = 6, denom: float = 18.0) -> tuple[float, ...]:
    """Kernel gaussiano simétrico de 2n+1 taps para o bloom separável."""
    raw = [math.exp(-(k * k) / denom) for k in range(-n, n + 1)]
    total = sum(raw)
    return tuple(w / total for w in raw)


KW: tuple[float, ...] = _normalized_gaussian()


@dataclass(frozen=True)
class Config:
    """Configuração resolvida (CLI + perfil de qualidade)."""
    n: int
    width: int
    height: int
    quality: Quality
    ui: UIMode
    preset: Preset
    use_cpu: bool
    perf: bool
    substeps: int
    bloom_enabled: int

    @property
    def aspect(self) -> float:
        return self.width / self.height

    @property
    def quarter_w(self) -> int:
        return self.width // 4

    @property
    def quarter_h(self) -> int:
        return self.height // 4


def _build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="galaxy")
    ap.add_argument("--n", type=int)
    ap.add_argument("--preset", choices=[p.value for p in Preset],
                    default=Preset.COLLISION.value)
    ap.add_argument("--res", type=int, nargs=2)
    ap.add_argument("--quality", choices=[q.value for q in Quality],
                    default=Quality.MEDIUM.value)
    ap.add_argument("--ui", choices=[u.value for u in UIMode],
                    default=UIMode.PYGAME.value)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--perf", action="store_true")
    return ap


def parse_config(argv: list[str] | None = None) -> Config:
    """Resolve a configuração a partir da CLI. Args desconhecidos são tolerados."""
    ap = _build_parser()
    ns, _unknown = ap.parse_known_args(argv)

    quality = Quality(ns.quality)
    profile = QUALITY_PROFILES[quality]

    n = ns.n or profile.particles
    raw_w, raw_h = ns.res or (profile.width, profile.height)
    return Config(
        n=n,
        width=raw_w // 4 * 4,
        height=raw_h // 4 * 4,
        quality=quality,
        ui=UIMode(ns.ui),
        preset=Preset(ns.preset),
        use_cpu=ns.cpu,
        perf=ns.perf,
        substeps=profile.substeps,
        bloom_enabled=profile.bloom_enabled,
    )


A: Config = parse_config()
ti.init(arch=ti.cpu if A.use_cpu else ti.gpu)


# ================================================================ RUNTIME STATE
@dataclass
class SimState:
    """Parâmetros controláveis em runtime pela UI."""
    g: float = 0.4
    halo: float = 0.25
    mouse: float = 1.5
    time: float = 1.0
    br: float = 0.5
    fade: float = 0.9
    bloom: float = 1.2
    pal: int = 0
    pause: bool = False
    v3d: bool = False
    audio: bool = False
    rec: bool = False
    panel: bool = True


@dataclass
class RuntimeParams:
    sub: int


S = SimState()
Q = RuntimeParams(sub=A.substeps)
if not A.bloom_enabled:
    S.bloom = 0.0

# Áudio: callback roda em thread separada; protegemos o float compartilhado.
_lvl_lock = threading.Lock()
lvl = [0.0]


# ================================================================ SIMULATION
@ti.data_oriented
class Simulation:
    """Física: partículas orbitando 1 ou 2 centros analíticos + força do mouse.

    Todos os kernels que tocam estado físico vivem aqui. A UI só interage via
    `load()`, `reset()`, `set_params()` e `tick()`. O Renderer lê os campos
    `pos`, `col`, `p3` e `na` diretamente.
    """

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.N = cfg.n
        self.ASP = cfg.aspect

        # Estado das partículas
        self.pos = ti.Vector.field(2, ti.f32, self.N)
        self.vel = ti.Vector.field(2, ti.f32, self.N)
        self.col = ti.Vector.field(3, ti.f32, self.N)
        self.p3 = ti.Vector.field(3, ti.f32, self.N)
        self.zoff = ti.field(ti.f32, self.N)
        self.gid = ti.field(ti.i32, self.N)

        # Centros galácticos
        self.cp = ti.Vector.field(2, ti.f32, 2)
        self.cv = ti.Vector.field(2, ti.f32, 2)
        self.cm = ti.field(ti.f32, 2)
        self.nc = ti.field(ti.i32, ())

        # Parâmetros compartilhados com os kernels: [g, halo, mouse, dt]
        self.SP = ti.field(ti.f32, 4)
        self.pal = ti.field(ti.i32, ())
        self.na = ti.field(ti.i32, ())
        self.na[None] = self.N

    # -------------------------------------------------------- ti.func helpers
    @ti.func
    def _accel(self, p, mx, my, mode, n):
        """Aceleração total numa posição: 2 centros + força do mouse."""
        a = ti.Vector([0.0, 0.0])
        for c in ti.static(range(2)):
            if c < n:
                d = self.cp[c] - p
                r2 = d.norm_sqr()
                a += self.SP[0] * self.cm[c] * d / (r2 + EPS) ** 1.5 \
                   + self.SP[1] * self.cm[c] * d / (r2 + RC)
        if mode != 0:
            m = ti.Vector([mx, my]) - p
            a += mode * self.SP[2] * m / (m.norm_sqr() + 1.6e-3) ** 1.5
        return a

    @ti.func
    def _spawn(self, i):
        """Reposiciona a partícula i numa órbita aproximadamente circular."""
        n = self.nc[None]
        g = 0
        if n == 2 and i % 5 >= 3:
            g = 1
        self.gid[i] = g
        s = ti.select(n == 2, 0.22 * (1.0 - 0.2 * g), 0.42)
        r = 0.02 - ti.log(1.0 - 0.98 * ti.random()) * s * 0.28
        a = ti.random() * 2 * math.pi
        if ti.random() < 0.7:
            a = ti.cast(ti.random() * 2, ti.i32) * math.pi \
              + 2.2 * ti.log(r / 0.02) + (ti.random() + ti.random() - 1) * 0.45
        d = ti.Vector([ti.cos(a), ti.sin(a)])
        acc = self.SP[0] * self.cm[g] * r / (r * r + EPS) ** 1.5 \
            + self.SP[1] * self.cm[g] * r / (r * r + RC)
        v = ti.sqrt(r * acc) * (0.92 + 0.16 * ti.random())
        self.pos[i] = self.cp[g] + d * r
        self.vel[i] = self.cv[g] + ti.Vector([-d.y, d.x]) * v
        self.zoff[i] = (ti.random() - 0.5) * (0.01 + 0.05 * ti.exp(-r / 0.06))
        self.p3[i] = ti.Vector([
            self.pos[i].x - self.ASP / 2,
            self.zoff[i],
            self.pos[i].y - 0.5,
        ])

    # -------------------------------------------------------- kernels
    @ti.kernel
    def _move_centers(self):
        """Leapfrog KDK nos centros — conserva energia melhor que Euler."""
        dt = self.SP[3]
        if self.nc[None] == 2:
            d = self.cp[1] - self.cp[0]
            a = self.SP[0] * d / (d.norm_sqr() + EPS) ** 1.5
            self.cv[0] += a * self.cm[1] * 0.5 * dt
            self.cv[1] -= a * self.cm[0] * 0.5 * dt
            self.cp[0] += self.cv[0] * dt
            self.cp[1] += self.cv[1] * dt
            d = self.cp[1] - self.cp[0]
            a = self.SP[0] * d / (d.norm_sqr() + EPS) ** 1.5
            self.cv[0] += a * self.cm[1] * 0.5 * dt
            self.cv[1] -= a * self.cm[0] * 0.5 * dt

    @ti.kernel
    def _step(self, mx: ti.f32, my: ti.f32, mode: ti.i32):
        """Leapfrog KDK por partícula (kick-drift-kick)."""
        dt = self.SP[3]
        hdt = 0.5 * dt
        n = self.nc[None]
        for i in range(self.na[None]):
            p = self.pos[i]
            v = self.vel[i]
            v += self._accel(p, mx, my, mode, n) * hdt
            p = p + v * dt
            v += self._accel(p, mx, my, mode, n) * hdt

            self.pos[i] = p
            self.vel[i] = v
            q = p
            if q.x < -0.5 or q.x >= self.ASP + 0.5 or q.y < -0.5 or q.y >= 1.5:
                self._spawn(i)
            self.p3[i] = ti.Vector([
                self.pos[i].x - self.ASP / 2,
                self.zoff[i],
                self.pos[i].y - 0.5,
            ])
            g = self.gid[i]
            s = ti.min((self.vel[i] - self.cv[g]).norm() / 2.2, 1.0)
            k = ti.min((self.cp[g] - self.pos[i]).norm() / 0.35, 1.0)
            if self.pal[None] == 0:
                self.col[i] = ti.Vector([s ** 0.6, 0.35 + 0.65 * s, 1.0 - 0.5 * s])
            elif self.pal[None] == 1:
                self.col[i] = ti.Vector([1.0, 0.25 + 0.6 * s, 0.05 + 0.7 * s * s])
            elif self.pal[None] == 2:
                self.col[i] = ti.Vector([1.0 - 0.65 * k, 0.75 - 0.15 * k, 0.35 + 0.65 * k])
            elif g == 0:
                self.col[i] = ti.Vector([0.3, 0.7, 1.0]) * (0.5 + 0.5 * s)
            else:
                self.col[i] = ti.Vector([1.0, 0.5, 0.25]) * (0.5 + 0.5 * s)

    @ti.kernel
    def _reset(self):
        for i in self.pos:
            self._spawn(i)

    # -------------------------------------------------------- Python-side API
    def set_params(self, *, g: float, halo: float, mouse: float,
                   dt: float, pal: int) -> None:
        """Empurra os parâmetros controláveis para a GPU."""
        self.SP.from_numpy(np.array([g, halo, mouse, dt], np.float32))
        self.pal[None] = pal

    def load(self, k: int) -> None:
        """Configura 1 (galáxia única) ou 2 (colisão). Não toca em paleta."""
        self.nc[None] = k
        self.cm.from_numpy(np.array([1.0, 0.8], np.float32))
        if k == 1:
            self.cp.from_numpy(np.tile(np.array([self.ASP / 2, 0.5], np.float32), (2, 1)))
            self.cv.from_numpy(np.zeros((2, 2), np.float32))
        else:
            self.cp.from_numpy(np.array(
                [[0.32 * self.ASP, 0.42], [0.68 * self.ASP, 0.60]], np.float32))
            self.cv.from_numpy(np.array(
                [[0.35, 0.12], [-0.4375, -0.15]], np.float32))
        self._reset()

    def reset(self) -> None:
        self._reset()

    def tick(self, mx: float, my: float, mode: int, substeps: int) -> None:
        """Avança a simulação `substeps` vezes com o mesmo input."""
        for _ in range(substeps):
            self._move_centers()
            self._step(mx, my, mode)


# ================================================================ RENDERER
@ti.data_oriented
class Renderer:
    """Splat aditivo, bloom separável e composição tone-mapped.

    Depende de `Simulation` apenas para ler `pos`/`col`/`p3`/`na`.
    """

    def __init__(self, cfg: Config, sim: Simulation) -> None:
        self.cfg = cfg
        self.sim = sim
        self.W = cfg.width
        self.H = cfg.height
        self.QW = cfg.quarter_w
        self.QH = cfg.quarter_h

        self.img = ti.Vector.field(3, ti.f32, (self.W, self.H))
        self.out = ti.Vector.field(3, ti.f32, (self.W, self.H))
        self.bl = ti.Vector.field(3, ti.f32, (self.QW, self.QH))
        self.bl2 = ti.Vector.field(3, ti.f32, (self.QW, self.QH))
        self.outu = ti.field(ti.u8, shape=(self.H, self.W, 3))

        # Parâmetros de render: [br, fade, bloom]
        self.RP = ti.field(ti.f32, 3)

    # -------------------------------------------------------- ti.func helpers
    @ti.func
    def _samp(self, x, y):
        """Sample bilinear do buffer de bloom."""
        fx, fy = x - 0.5, y - 0.5
        x0, y0 = ti.cast(ti.floor(fx), ti.i32), ti.cast(ti.floor(fy), ti.i32)
        tx, ty = fx - x0, fy - y0
        xa = ti.min(ti.max(x0, 0), self.QW - 1)
        xb = ti.min(ti.max(x0 + 1, 0), self.QW - 1)
        ya = ti.min(ti.max(y0, 0), self.QH - 1)
        yb = ti.min(ti.max(y0 + 1, 0), self.QH - 1)
        return (self.bl[xa, ya] * (1 - tx) + self.bl[xb, ya] * tx) * (1 - ty) \
             + (self.bl[xa, yb] * (1 - tx) + self.bl[xb, yb] * tx) * ty

    # -------------------------------------------------------- kernels
    @ti.kernel
    def splat(self):
        for x, y in self.img:
            self.img[x, y] *= self.RP[1]
        for i in range(self.sim.na[None]):
            ix = ti.cast(self.sim.pos[i] * self.H, ti.i32)
            if 0 <= ix.x < self.W and 0 <= ix.y < self.H:
                self.img[ix] += self.sim.col[i] * self.RP[0]

    @ti.kernel
    def splat3d(self, yaw: ti.f32, pitch: ti.f32, dist: ti.f32):
        for x, y in self.img:
            self.img[x, y] *= self.RP[1]
        cy, sy, cx, sx = ti.cos(yaw), ti.sin(yaw), ti.cos(pitch), ti.sin(pitch)
        for i in range(self.sim.na[None]):
            q = self.sim.p3[i]
            x1 = q.x * cy + q.z * sy
            z1 = -q.x * sy + q.z * cy
            y2 = q.y * cx - z1 * sx
            z2 = q.y * sx + z1 * cx + dist
            if z2 > 0.05:
                f = 1.6 * self.H / z2
                ix = ti.cast(ti.Vector([
                    self.W * 0.5 + x1 * f,
                    self.H * 0.5 + y2 * f,
                ]), ti.i32)
                if 0 <= ix.x < self.W and 0 <= ix.y < self.H:
                    self.img[ix] += self.sim.col[i] * self.RP[0] * ti.min(dist / z2, 2.0)

    @ti.kernel
    def bloom_down(self):
        for x, y in self.bl:
            s = ti.Vector([0.0, 0.0, 0.0])
            for i, j in ti.static(ti.ndrange(4, 4)):
                s += self.img[x * 4 + i, y * 4 + j]
            self.bl[x, y] = s / 16

    @ti.kernel
    def blur_h(self):
        for x, y in self.bl2:
            a = ti.Vector([0.0, 0.0, 0.0])
            for j in ti.static(range(13)):
                a += self.bl[ti.min(ti.max(x + j - 6, 0), self.QW - 1), y] * KW[j]
            self.bl2[x, y] = a

    @ti.kernel
    def blur_v(self):
        for x, y in self.bl:
            a = ti.Vector([0.0, 0.0, 0.0])
            for j in ti.static(range(13)):
                a += self.bl2[x, ti.min(ti.max(y + j - 6, 0), self.QH - 1)] * KW[j]
            self.bl[x, y] = a

    @ti.kernel
    def compose_u8(self):
        """Tone-map + gamma + u8 + Y-flip num passe único (caminho pygame)."""
        for x, y in self.img:
            c = (self.img[x, y] + self.RP[2] * self._samp((x + 0.5) / 4, (y + 0.5) / 4)) * EXPO
            for k in ti.static(range(3)):
                lin = 1.0 - ti.exp(-c[k])
                v = ti.pow(lin, GAMMA) * 255.0 + 0.5
                self.outu[self.H - 1 - y, x, k] = ti.cast(ti.min(v, 255.0), ti.u8)

    @ti.kernel
    def compose(self):
        """Tone-map + gamma em float (caminho GGUI; canvas lê `out`)."""
        for x, y in self.out:
            c = (self.img[x, y] + self.RP[2] * self._samp((x + 0.5) / 4, (y + 0.5) / 4)) * EXPO
            self.out[x, y] = ti.Vector([
                ti.pow(1 - ti.exp(-c[0]), GAMMA),
                ti.pow(1 - ti.exp(-c[1]), GAMMA),
                ti.pow(1 - ti.exp(-c[2]), GAMMA),
            ])

    # -------------------------------------------------------- Python-side API
    def set_params(self, *, br: float, fade: float, bloom: float) -> None:
        self.RP.from_numpy(np.array([br, fade, bloom], np.float32))

    def _bloom_pass(self) -> None:
        self.bloom_down()
        for _ in range(2):
            self.blur_h()
            self.blur_v()

    def post_pygame(self, bloom_level: float) -> None:
        if bloom_level > 0.01:
            self._bloom_pass()
        self.compose_u8()

    def post_ggui(self, bloom_level: float) -> None:
        if bloom_level > 0.01:
            self._bloom_pass()
        self.compose()


# ================================================================ GLUE
def push_state(sim: Simulation, ren: Renderer) -> None:
    """Sincroniza o estado Python (S/Q/lvl) para os campos GPU de sim e render."""
    with _lvl_lock:
        l = lvl[0]
    dt = 0.0 if S.pause else DT * S.time * 2 / Q.sub
    sim.set_params(g=S.g, halo=S.halo, mouse=S.mouse, dt=dt, pal=S.pal)
    ren.set_params(br=S.br * (1 + 2.5 * l), fade=S.fade, bloom=S.bloom * (1 + l))


def load_scene(sim: Simulation, k: int, *, preserve_palette: bool = False) -> None:
    """Carrega preset k. Se `preserve_palette`, mantém a paleta atual do usuário."""
    if not preserve_palette:
        S.pal = 0 if k == 1 else 3
    sim.load(k)


def stamp() -> str:
    """Timestamp com milissegundos — evita colisão em screenshots seguidos."""
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]


def audio_cb(data, *_args) -> None:
    val = lvl[0] * 0.8 + min(1.0, float(np.sqrt((data ** 2).mean())) * 8) * 0.2
    with _lvl_lock:
        lvl[0] = val


# ================================================================ EXTRAS
class Extras:
    """Gerencia microfone e gravador de GIF de forma opcional e preguiçosa."""

    def __init__(self) -> None:
        self.stream = None
        self.rec = None

    def sync(self, can_rec: bool = True) -> None:
        if S.audio and not sd:
            log.warning("áudio: instale com  pip install sounddevice")
            S.audio = False
        if S.audio and not self.stream:
            try:
                self.stream = sd.InputStream(channels=1, callback=audio_cb)
                self.stream.start()
            except Exception as ex:
                log.warning("áudio: %s", ex)
                S.audio = False
        elif not S.audio and self.stream:
            self.stream.stop()
            self.stream = None
            with _lvl_lock:
                lvl[0] = 0.0
        if S.rec and not self.rec and can_rec:
            self.rec = ti.tools.VideoManager(
                f"rec_{stamp()}", framerate=30, automatic_build=False)
        elif not S.rec and self.rec:
            try:
                self.rec.make_video(gif=True, mp4=False)
            except Exception as ex:
                log.warning("gif (precisa de ffmpeg): %s", ex)
            self.rec = None

    def write(self, frame) -> None:
        if self.rec:
            self.rec.write_frame(frame)


KEYS = """1 única | 2 colisão | R reiniciar | ESPAÇO pausa | P paleta | V 3D (arraste = girar, roda = zoom)
H painel | A microfone | G gravar GIF | X screenshot | Q restaurar qualidade | F11 tela cheia | ESC sair"""


# ================================================================ UI PYGAME
def run_pygame(sim: Simulation, ren: Renderer) -> None:
    import pygame
    W, H = ren.W, ren.H
    pygame.init()
    try:
        screen = pygame.display.set_mode(
            (W, H), pygame.SCALED | pygame.RESIZABLE, vsync=1)
    except Exception:
        screen = pygame.display.set_mode((W, H))
    pygame.display.set_caption("Galaxy GPU")
    rh = max(20, H // 28)
    font = pygame.font.SysFont("segoeui,arial,dejavusans", max(11, rh - 8))
    clock = pygame.time.Clock()

    st = dict(shot=False, drag=None, maxed=False)
    toast = ["", 0.0]
    cam = [0.5, 0.9, 1.3]
    T = dict(sim=0.0, render=0.0, xfer=0.0, ui=0.0)
    mark = [0.0]

    def lap(k: str) -> None:
        if A.perf:
            ti.sync()
            t = time.perf_counter()
            T[k] += t - mark[0]
            mark[0] = t

    def say(m: str) -> None:
        toast[0], toast[1] = m, time.time() + 3

    def tog(k: str) -> None:
        setattr(S, k, not getattr(S, k))

    def cyc() -> None:
        S.pal = (S.pal + 1) % 4

    def foto() -> None:
        st["shot"] = True

    SL = [("g", "Gravidade", 0.1, 1.5), ("halo", "Halo", 0.0, 1.5), ("mouse", "Mouse", 0.0, 4.0),
          ("time", "Tempo", 0.0, 3.0), ("br", "Brilho", 0.02, 0.6), ("fade", "Rastro", 0.6, 0.98),
          ("bloom", "Bloom", 0.0, 3.0)]
    BT = [("Única", lambda: load_scene(sim, 1, preserve_palette=True), None),
          ("Colisão", lambda: load_scene(sim, 2, preserve_palette=True), None),
          ("Reiniciar", sim.reset, None),
          ("Pausar", lambda: tog("pause"), "pause"),
          ("3D", lambda: tog("v3d"), "v3d"),
          ("Paleta", cyc, None),
          ("Mic", lambda: tog("audio"), "audio"),
          ("GIF", lambda: tog("rec"), "rec"),
          ("Foto", foto, None)]

    pw, x0, y0 = min(W - 20, max(240, W // 4)), 10, 10
    y = y0 + rh + 4
    slr, bars = [], []
    for _ in SL:
        r = pygame.Rect(x0 + 6, y, pw - 12, rh - 2)
        slr.append(r)
        bars.append(pygame.Rect(r.x + int(r.w * 0.45), r.y + rh // 2 - 3,
                                r.w - int(r.w * 0.45), 6))
        y += rh
    y += 4
    bw = (pw - 20) // 3
    btr = [pygame.Rect(x0 + 6 + (i % 3) * (bw + 4), y + (i // 3) * rh, bw, rh - 4)
           for i in range(len(BT))]
    prect = pygame.Rect(x0, y0, pw, y + ((len(BT) + 2) // 3) * rh + 4 - y0)
    bg = pygame.Surface(prect.size, pygame.SRCALPHA)
    bg.fill((10, 12, 20, 205))

    def txt(s: str, pos, c=(220, 224, 235)) -> None:
        screen.blit(font.render(s, True, c), pos)

    def setv(i: int, mx: int) -> None:
        k, _, lo, hi = SL[i]
        setattr(S, k, lo + (hi - lo) * min(max((mx - bars[i].x) / bars[i].w, 0.0), 1.0))

    def degrade() -> None:
        if S.bloom > 0:
            S.bloom = 0.0
            say("FPS baixo: bloom desligado")
        elif Q.sub > 1:
            Q.sub = 1
            say("FPS baixo: física simplificada")
        elif sim.na[None] > 20000:
            sim.na[None] = max(20000, int(sim.na[None] * 0.6))
            say(f"FPS baixo: {sim.na[None]:,} partículas")
        else:
            st["maxed"] = True
            say("Ainda lento: rode com --quality low")

    log.info(KEYS)
    load_scene(sim, 1 if A.preset is Preset.SINGLE else 2)
    ex = Extras()
    t_start = time.time()
    slow = 0.0
    n_frame = 0
    running = True

    while running:
        dt = clock.tick(60) / 1000
        fps = clock.get_fps()
        mark[0] = time.perf_counter()
        mpos = pygame.mouse.get_pos()
        over = S.panel and prect.collidepoint(mpos)

        for e in pygame.event.get():
            if e.type == pygame.QUIT:
                running = False
            elif e.type == pygame.KEYDOWN:
                k = e.key
                if k == pygame.K_ESCAPE: running = False
                elif k == pygame.K_SPACE: tog("pause")
                elif k == pygame.K_r: sim.reset()
                elif k == pygame.K_1: load_scene(sim, 1, preserve_palette=True)
                elif k == pygame.K_2: load_scene(sim, 2, preserve_palette=True)
                elif k == pygame.K_p: cyc()
                elif k == pygame.K_v: tog("v3d")
                elif k == pygame.K_a: tog("audio")
                elif k == pygame.K_g: tog("rec")
                elif k == pygame.K_x: foto()
                elif k == pygame.K_h: tog("panel")
                elif k == pygame.K_F11: pygame.display.toggle_fullscreen()
                elif k == pygame.K_q:
                    S.bloom = 1.2 if A.bloom_enabled else 0.0
                    Q.sub = A.substeps
                    sim.na[None] = sim.N
                    st["maxed"] = False
                    say("qualidade restaurada")
            elif e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
                hit = False
                if S.panel:
                    for i, r in enumerate(slr):
                        if r.collidepoint(e.pos):
                            st["drag"] = i
                            setv(i, e.pos[0])
                            hit = True
                    for i, r in enumerate(btr):
                        if r.collidepoint(e.pos):
                            BT[i][1]()
                            hit = True
                if not hit and S.v3d:
                    st["drag"] = "cam"
            elif e.type == pygame.MOUSEMOTION:
                d = st["drag"]
                if isinstance(d, int):
                    setv(d, e.pos[0])
                elif d == "cam":
                    cam[0] += e.rel[0] * 0.01
                    cam[1] = min(max(cam[1] + e.rel[1] * 0.01, -1.5), 1.5)
            elif e.type == pygame.MOUSEBUTTONUP and e.button == 1:
                st["drag"] = None
            elif e.type == pygame.MOUSEWHEEL and S.v3d:
                cam[2] = min(max(cam[2] * 0.93 ** e.y, 0.6), 3.0)

        b = pygame.mouse.get_pressed()
        mode = 0 if (over or st["drag"] is not None or S.v3d) else 1 if b[0] else -1 if b[2] else 0
        if S.v3d and st["drag"] != "cam":
            cam[0] += 0.004

        push_state(sim, ren)
        sim.tick(mpos[0] / H, 1 - mpos[1] / H, mode, Q.sub)
        lap("sim")
        ren.splat3d(*cam) if S.v3d else ren.splat()
        ren.post_pygame(S.bloom)
        lap("render")

        arr = ren.outu.to_numpy()
        lap("xfer")
        frame_surf = pygame.image.frombuffer(arr, (W, H), "RGB")
        screen.blit(frame_surf, (0, 0))
        if st["shot"]:
            pygame.image.save(screen, f"galaxy_{stamp()}.png")
            st["shot"] = False
            say("screenshot salvo")
        n_frame += 1
        if ex.rec and n_frame % 2 == 0:
            ex.write(arr)

        if S.panel:
            screen.blit(bg, prect.topleft)
            txt(f"{fps:.0f} FPS  |  {int(sim.na[None]):,} partículas",
                (x0 + 8, y0 + 2), (140, 150, 175))
            for i, (k, l, lo, hi) in enumerate(SL):
                r, bar = slr[i], bars[i]
                val = getattr(S, k)
                t = (val - lo) / (hi - lo)
                txt(f"{l} {val:.2f}", (r.x, r.y + 1))
                pygame.draw.rect(screen, (38, 42, 58), bar, border_radius=3)
                pygame.draw.rect(screen, (108, 124, 255),
                                 (bar.x, bar.y, int(bar.w * t), bar.h), border_radius=3)
                pygame.draw.circle(screen, (235, 238, 255),
                                   (bar.x + int(bar.w * t), bar.centery), 5)
            for i, (l, _, key) in enumerate(BT):
                r = btr[i]
                active = key is not None and getattr(S, key)
                col_ = (108, 124, 255) if active else (64, 72, 118) if r.collidepoint(mpos) else (32, 36, 54)
                pygame.draw.rect(screen, col_, r, border_radius=6)
                ts = font.render(l, True, (240, 242, 250))
                screen.blit(ts, ts.get_rect(center=r.center))

        if time.time() < toast[1]:
            txt(toast[0], (12, H - rh))
        pygame.display.flip()
        lap("ui")
        ex.sync()

        slow = slow + dt if (0 < fps < 24 and time.time() - t_start > 4 and not st["maxed"]) else 0.0
        if slow > 2.5:
            degrade()
            slow = 0.0
        if A.perf and n_frame % 60 == 0:
            log.info("ms/frame  " + "  ".join(f"{k} {v / 60 * 1000:.1f}" for k, v in T.items())
                     + f"  |  {fps:.0f} FPS")
            for k in T:
                T[k] = 0.0

    S.audio = False
    S.rec = False
    ex.sync()
    pygame.quit()


# ================================================================ UI GGUI
def panel(w, fps: float, sim: Simulation) -> bool:
    w.text(f"FPS: {fps:.0f}   Partículas: {sim.N:,}")
    if w.button("Galáxia única"): load_scene(sim, 1, preserve_palette=True)
    if w.button("Colisão de galáxias"): load_scene(sim, 2, preserve_palette=True)
    if w.button("Reiniciar (R)"): sim.reset()
    S.pause = w.checkbox("Pausar (espaço)", S.pause)
    S.g = w.slider_float("Gravidade", S.g, 0.1, 1.5)
    S.halo = w.slider_float("Halo escuro", S.halo, 0.0, 1.5)
    S.mouse = w.slider_float("Força do mouse", S.mouse, 0.0, 4.0)
    S.time = w.slider_float("Tempo", S.time, 0.0, 3.0)
    S.br = w.slider_float("Brilho", S.br, 0.02, 0.6)
    S.fade = w.slider_float("Rastro", S.fade, 0.6, 0.98)
    S.bloom = w.slider_float("Bloom", S.bloom, 0.0, 3.0)
    S.pal = w.slider_int("Paleta (0-3)", S.pal, 0, 3)
    S.v3d = w.checkbox("Modo 3D (botão dir. = câmera)", S.v3d)
    S.audio = w.checkbox("Reagir ao microfone", S.audio)
    S.rec = w.checkbox("Gravar GIF (2D)", S.rec)
    return w.button("Screenshot")


def run_ggui(sim: Simulation, ren: Renderer) -> None:
    W, H = ren.W, ren.H
    win = ti.ui.Window("Galaxy GPU", (W, H), vsync=True)
    canvas, gui = win.get_canvas(), win.get_gui()
    scene, cam = ti.ui.Scene(), ti.ui.Camera()
    cam.position(0, 0.55, 1.15)
    cam.lookat(0, 0, 0)
    cam.up(0, 1, 0)
    load_scene(sim, 1 if A.preset is Preset.SINGLE else 2)
    ex = Extras()
    shot = False
    t0 = time.perf_counter()
    fps = 60.0

    while win.running:
        for e in win.get_events(ti.ui.PRESS):
            if e.key == ti.ui.ESCAPE:
                win.running = False
            elif e.key == ti.ui.SPACE:
                S.pause = not S.pause
            elif e.key == "h":
                S.panel = not S.panel
            elif e.key == "r":
                sim.reset()
        mx, my = win.get_cursor_pos()
        busy = S.panel and mx < 0.29 and my > 0.18
        mode = 0 if (busy or S.v3d) else 1 if win.is_pressed(ti.ui.LMB) else -1 if win.is_pressed(ti.ui.RMB) else 0
        push_state(sim, ren)
        sim.tick(mx * sim.ASP, my, mode, Q.sub)
        if S.v3d:
            canvas.set_background_color((0.01, 0.01, 0.03))
            cam.track_user_inputs(win, movement_speed=0.02, hold_key=ti.ui.RMB)
            scene.set_camera(cam)
            scene.ambient_light((1, 1, 1))
            scene.particles(sim.p3, radius=0.0016, per_vertex_color=sim.col)
            canvas.scene(scene)
        else:
            ren.splat()
            ren.post_ggui(S.bloom)
            canvas.set_image(ren.out)
            if ex.rec:
                ex.write(np.ascontiguousarray(
                    (ren.out.to_numpy().transpose(1, 0, 2)[::-1] * 255).astype(np.uint8)))
        if S.panel:
            with gui.sub_window("Galáxia", 0.01, 0.01, 0.27, 0.8) as w:
                shot = panel(w, fps, sim)
        if shot:
            try:
                win.save_image(f"galaxy_{stamp()}.png")
            except Exception as ex_:
                log.warning("screenshot: %s", ex_)
        win.show()
        ex.sync(not S.v3d)
        t1 = time.perf_counter()
        fps = 0.9 * fps + 0.1 / max(t1 - t0, 1e-4)
        t0 = t1


# ================================================================ MAIN
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    sim = Simulation(A)
    ren = Renderer(A, sim)
    if A.ui is UIMode.GGUI:
        run_ggui(sim, ren)
    else:
        run_pygame(sim, ren)
