"""Galaxy GPU — simulação interativa de galáxias em Taichi.

Renomeado de galaxy_gpu.py. Configuração integrada como dataclasses/enums.

Uso:
    python galaxy.py --preset collision --n 300000 --res 1280 720
    python galaxy.py --quality low --perf
    python galaxy.py --ui ggui          # requer driver Vulkan <= 1.3

Dependências: taichi, numpy. Opcional: pygame (UI padrão), sounddevice (áudio).
"""
from __future__ import annotations

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

# Constantes físicas / de render — antes espalhadas como literais.
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


BLOOM_KERNEL: tuple[float, ...] = _normalized_gaussian()


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
N = A.n
W, H = A.width, A.height
QW, QH = A.quarter_w, A.quarter_h
ASP = A.aspect
KW = BLOOM_KERNEL

ti.init(arch=ti.cpu if A.use_cpu else ti.gpu)


# ================================================================ STATE
pos = ti.Vector.field(2, ti.f32, N)
vel = ti.Vector.field(2, ti.f32, N)
col = ti.Vector.field(3, ti.f32, N)
p3 = ti.Vector.field(3, ti.f32, N)
zoff = ti.field(ti.f32, N)
gid = ti.field(ti.i32, N)
img = ti.Vector.field(3, ti.f32, (W, H))
out = ti.Vector.field(3, ti.f32, (W, H))
bl = ti.Vector.field(3, ti.f32, (QW, QH))
bl2 = ti.Vector.field(3, ti.f32, (QW, QH))
cp = ti.Vector.field(2, ti.f32, 2)
cv = ti.Vector.field(2, ti.f32, 2)
cm = ti.field(ti.f32, 2)
nc = ti.field(ti.i32, ())
pal = ti.field(ti.i32, ())
outu = ti.field(ti.u8, shape=(H, W, 3))
na = ti.field(ti.i32, ())
P = ti.field(ti.f32, 8)  # 0 G, 1 halo, 2 mouse, 3 dt, 4 brilho, 5 rastro, 6 bloom


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
na[None] = N
if not A.bloom_enabled:
    S.bloom = 0.0

# Áudio: callback roda em thread separada; protegemos o float compartilhado.
_lvl_lock = threading.Lock()
lvl = [0.0]


# ================================================================ SIM
@ti.func
def spawn(i):
    n = nc[None]
    g = 0
    if n == 2 and i % 5 >= 3:
        g = 1
    gid[i] = g
    s = ti.select(n == 2, 0.22 * (1.0 - 0.2 * g), 0.42)
    r = 0.02 - ti.log(1.0 - 0.98 * ti.random()) * s * 0.28
    a = ti.random() * 2 * math.pi
    if ti.random() < 0.7:
        a = ti.cast(ti.random() * 2, ti.i32) * math.pi + 2.2 * ti.log(r / 0.02) + (ti.random() + ti.random() - 1) * 0.45
    d = ti.Vector([ti.cos(a), ti.sin(a)])
    acc = P[0] * cm[g] * r / (r * r + EPS) ** 1.5 + P[1] * cm[g] * r / (r * r + RC)
    v = ti.sqrt(r * acc) * (0.92 + 0.16 * ti.random())
    pos[i] = cp[g] + d * r
    vel[i] = cv[g] + ti.Vector([-d.y, d.x]) * v
    zoff[i] = (ti.random() - 0.5) * (0.01 + 0.05 * ti.exp(-r / 0.06))
    p3[i] = ti.Vector([pos[i].x - ASP / 2, zoff[i], pos[i].y - 0.5])


@ti.kernel
def reset():
    for i in pos:
        spawn(i)


@ti.kernel
def move_centers():
    """Leapfrog KDK nos centros — conserva energia melhor que Euler."""
    dt = P[3]
    if nc[None] == 2:
        d = cp[1] - cp[0]
        a = P[0] * d / (d.norm_sqr() + EPS) ** 1.5
        cv[0] += a * cm[1] * 0.5 * dt
        cv[1] -= a * cm[0] * 0.5 * dt
        cp[0] += cv[0] * dt
        cp[1] += cv[1] * dt
        d = cp[1] - cp[0]
        a = P[0] * d / (d.norm_sqr() + EPS) ** 1.5
        cv[0] += a * cm[1] * 0.5 * dt
        cv[1] -= a * cm[0] * 0.5 * dt


@ti.func
def accel(p, mx, my, mode, n):
    """Aceleração total numa posição: 2 centros + força do mouse."""
    a = ti.Vector([0.0, 0.0])
    for c in ti.static(range(2)):
        if c < n:
            d = cp[c] - p
            r2 = d.norm_sqr()
            a += P[0] * cm[c] * d / (r2 + EPS) ** 1.5 + P[1] * cm[c] * d / (r2 + RC)
    if mode != 0:
        m = ti.Vector([mx, my]) - p
        a += mode * P[2] * m / (m.norm_sqr() + 1.6e-3) ** 1.5
    return a


@ti.kernel
def step(mx: ti.f32, my: ti.f32, mode: ti.i32):
    """Leapfrog KDK por partícula (kick-drift-kick)."""
    dt = P[3]
    hdt = 0.5 * dt
    n = nc[None]
    for i in range(na[None]):
        p = pos[i]
        v = vel[i]
        v += accel(p, mx, my, mode, n) * hdt
        p = p + v * dt
        v += accel(p, mx, my, mode, n) * hdt

        pos[i] = p
        vel[i] = v
        q = p
        if q.x < -0.5 or q.x >= ASP + 0.5 or q.y < -0.5 or q.y >= 1.5:
            spawn(i)
        p3[i] = ti.Vector([pos[i].x - ASP / 2, zoff[i], pos[i].y - 0.5])
        g = gid[i]
        s = ti.min((vel[i] - cv[g]).norm() / 2.2, 1.0)
        k = ti.min((cp[g] - pos[i]).norm() / 0.35, 1.0)
        if pal[None] == 0:
            col[i] = ti.Vector([s ** 0.6, 0.35 + 0.65 * s, 1.0 - 0.5 * s])
        elif pal[None] == 1:
            col[i] = ti.Vector([1.0, 0.25 + 0.6 * s, 0.05 + 0.7 * s * s])
        elif pal[None] == 2:
            col[i] = ti.Vector([1.0 - 0.65 * k, 0.75 - 0.15 * k, 0.35 + 0.65 * k])
        elif g == 0:
            col[i] = ti.Vector([0.3, 0.7, 1.0]) * (0.5 + 0.5 * s)
        else:
            col[i] = ti.Vector([1.0, 0.5, 0.25]) * (0.5 + 0.5 * s)


# ================================================================ RENDER
@ti.kernel
def splat():
    for x, y in img:
        img[x, y] *= P[5]
    for i in range(na[None]):
        ix = ti.cast(pos[i] * H, ti.i32)
        if 0 <= ix.x < W and 0 <= ix.y < H:
            img[ix] += col[i] * P[4]


@ti.kernel
def splat3d(yaw: ti.f32, pitch: ti.f32, dist: ti.f32):
    for x, y in img:
        img[x, y] *= P[5]
    cy, sy, cx, sx = ti.cos(yaw), ti.sin(yaw), ti.cos(pitch), ti.sin(pitch)
    for i in range(na[None]):
        q = p3[i]
        x1 = q.x * cy + q.z * sy
        z1 = -q.x * sy + q.z * cy
        y2 = q.y * cx - z1 * sx
        z2 = q.y * sx + z1 * cx + dist
        if z2 > 0.05:
            f = 1.6 * H / z2
            ix = ti.cast(ti.Vector([W * 0.5 + x1 * f, H * 0.5 + y2 * f]), ti.i32)
            if 0 <= ix.x < W and 0 <= ix.y < H:
                img[ix] += col[i] * P[4] * ti.min(dist / z2, 2.0)


@ti.kernel
def bloom_down():
    for x, y in bl:
        s = ti.Vector([0.0, 0.0, 0.0])
        for i, j in ti.static(ti.ndrange(4, 4)):
            s += img[x * 4 + i, y * 4 + j]
        bl[x, y] = s / 16


@ti.kernel
def blur_h():
    for x, y in bl2:
        a = ti.Vector([0.0, 0.0, 0.0])
        for j in ti.static(range(13)):
            a += bl[ti.min(ti.max(x + j - 6, 0), QW - 1), y] * KW[j]
        bl2[x, y] = a


@ti.kernel
def blur_v():
    for x, y in bl:
        a = ti.Vector([0.0, 0.0, 0.0])
        for j in ti.static(range(13)):
            a += bl2[x, ti.min(ti.max(y + j - 6, 0), QH - 1)] * KW[j]
        bl[x, y] = a


@ti.func
def samp(x, y):
    """Bilinear sample do buffer de bloom."""
    fx, fy = x - 0.5, y - 0.5
    x0, y0 = ti.cast(ti.floor(fx), ti.i32), ti.cast(ti.floor(fy), ti.i32)
    tx, ty = fx - x0, fy - y0
    xa, xb = ti.min(ti.max(x0, 0), QW - 1), ti.min(ti.max(x0 + 1, 0), QW - 1)
    ya, yb = ti.min(ti.max(y0, 0), QH - 1), ti.min(ti.max(y0 + 1, 0), QH - 1)
    return (bl[xa, ya] * (1 - tx) + bl[xb, ya] * tx) * (1 - ty) + (bl[xa, yb] * (1 - tx) + bl[xb, yb] * tx) * ty


@ti.kernel
def compose_u8():
    """Tone-map + gamma + u8 num passe único (caminho pygame, com Y-flip)."""
    for x, y in img:
        c = (img[x, y] + P[6] * samp((x + 0.5) / 4, (y + 0.5) / 4)) * EXPO
        for k in ti.static(range(3)):
            lin = 1.0 - ti.exp(-c[k])
            v = ti.pow(lin, GAMMA) * 255.0 + 0.5
            outu[H - 1 - y, x, k] = ti.cast(ti.min(v, 255.0), ti.u8)


@ti.kernel
def compose():
    """Tone-map + gamma em float (caminho GGUI, canvas consome `out`)."""
    for x, y in out:
        c = (img[x, y] + P[6] * samp((x + 0.5) / 4, (y + 0.5) / 4)) * EXPO
        out[x, y] = ti.Vector([
            ti.pow(1 - ti.exp(-c[0]), GAMMA),
            ti.pow(1 - ti.exp(-c[1]), GAMMA),
            ti.pow(1 - ti.exp(-c[2]), GAMMA),
        ])


# ================================================================ HELPERS
def push() -> None:
    with _lvl_lock:
        l = lvl[0]
    dt = 0.0 if S.pause else DT * S.time * 2 / Q.sub
    P.from_numpy(np.array(
        [S.g, S.halo, S.mouse, dt, S.br * (1 + 2.5 * l),
         S.fade, S.bloom * (1 + l), 0],
        np.float32,
    ))
    pal[None] = S.pal


def load(k: int, *, preserve_palette: bool = False) -> None:
    """Configura 1 (galáxia única) ou 2 (colisão) e reinicia o estado."""
    nc[None] = k
    cm.from_numpy(np.array([1.0, 0.8], np.float32))
    if k == 1:
        cp.from_numpy(np.tile(np.array([ASP / 2, 0.5], np.float32), (2, 1)))
        cv.from_numpy(np.zeros((2, 2), np.float32))
    else:
        cp.from_numpy(np.array([[0.32 * ASP, 0.42], [0.68 * ASP, 0.60]], np.float32))
        cv.from_numpy(np.array([[0.35, 0.12], [-0.4375, -0.15]], np.float32))
    if not preserve_palette:
        S.pal = 0 if k == 1 else 3
    push()
    reset()


def sim(mx: float, my: float, mode: int) -> None:
    for _ in range(Q.sub):
        move_centers()
        step(mx, my, mode)


def post_bloom() -> None:
    if S.bloom > 0.01:
        bloom_down()
        for _ in range(2):
            blur_h()
            blur_v()


def post_pygame() -> None:
    post_bloom()
    compose_u8()


def post_ggui() -> None:
    post_bloom()
    compose()


def draw2d() -> None:
    splat()
    post_ggui()


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
            self.rec = ti.tools.VideoManager(f"rec_{stamp()}", framerate=30,
                                             automatic_build=False)
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
def run_pygame() -> None:
    import pygame
    pygame.init()
    try:
        screen = pygame.display.set_mode((W, H), pygame.SCALED | pygame.RESIZABLE, vsync=1)
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
    BT = [("Única", lambda: load(1, preserve_palette=True), None),
          ("Colisão", lambda: load(2, preserve_palette=True), None),
          ("Reiniciar", reset, None),
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
        bars.append(pygame.Rect(r.x + int(r.w * 0.45), r.y + rh // 2 - 3, r.w - int(r.w * 0.45), 6))
        y += rh
    y += 4
    bw = (pw - 20) // 3
    btr = [pygame.Rect(x0 + 6 + (i % 3) * (bw + 4), y + (i // 3) * rh, bw, rh - 4) for i in range(len(BT))]
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
        elif na[None] > 20000:
            na[None] = max(20000, int(na[None] * 0.6))
            say(f"FPS baixo: {na[None]:,} partículas")
        else:
            st["maxed"] = True
            say("Ainda lento: rode com --quality low")

    log.info(KEYS)
    load(1 if A.preset is Preset.SINGLE else 2)
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
                elif k == pygame.K_r: reset()
                elif k == pygame.K_1: load(1, preserve_palette=True)
                elif k == pygame.K_2: load(2, preserve_palette=True)
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
                    na[None] = N
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

        push()
        sim(mpos[0] / H, 1 - mpos[1] / H, mode)
        lap("sim")
        splat3d(*cam) if S.v3d else splat()
        post_pygame()
        lap("render")

        arr = outu.to_numpy()
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
            txt(f"{fps:.0f} FPS  |  {int(na[None]):,} partículas", (x0 + 8, y0 + 2), (140, 150, 175))
            for i, (k, l, lo, hi) in enumerate(SL):
                r, bar = slr[i], bars[i]
                val = getattr(S, k)
                t = (val - lo) / (hi - lo)
                txt(f"{l} {val:.2f}", (r.x, r.y + 1))
                pygame.draw.rect(screen, (38, 42, 58), bar, border_radius=3)
                pygame.draw.rect(screen, (108, 124, 255), (bar.x, bar.y, int(bar.w * t), bar.h), border_radius=3)
                pygame.draw.circle(screen, (235, 238, 255), (bar.x + int(bar.w * t), bar.centery), 5)
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
def panel(w, fps: float) -> bool:
    w.text(f"FPS: {fps:.0f}   Partículas: {N:,}")
    if w.button("Galáxia única"): load(1, preserve_palette=True)
    if w.button("Colisão de galáxias"): load(2, preserve_palette=True)
    if w.button("Reiniciar (R)"): reset()
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


def run_ggui() -> None:
    win = ti.ui.Window("Galaxy GPU", (W, H), vsync=True)
    canvas, gui = win.get_canvas(), win.get_gui()
    scene, cam = ti.ui.Scene(), ti.ui.Camera()
    cam.position(0, 0.55, 1.15)
    cam.lookat(0, 0, 0)
    cam.up(0, 1, 0)
    load(1 if A.preset is Preset.SINGLE else 2)
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
                reset()
        mx, my = win.get_cursor_pos()
        busy = S.panel and mx < 0.29 and my > 0.18
        mode = 0 if (busy or S.v3d) else 1 if win.is_pressed(ti.ui.LMB) else -1 if win.is_pressed(ti.ui.RMB) else 0
        push()
        sim(mx * ASP, my, mode)
        if S.v3d:
            canvas.set_background_color((0.01, 0.01, 0.03))
            cam.track_user_inputs(win, movement_speed=0.02, hold_key=ti.ui.RMB)
            scene.set_camera(cam)
            scene.ambient_light((1, 1, 1))
            scene.particles(p3, radius=0.0016, per_vertex_color=col)
            canvas.scene(scene)
        else:
            draw2d()
            canvas.set_image(out)
            if ex.rec:
                ex.write(np.ascontiguousarray((out.to_numpy().transpose(1, 0, 2)[::-1] * 255).astype(np.uint8)))
        if S.panel:
            with gui.sub_window("Galáxia", 0.01, 0.01, 0.27, 0.8) as w:
                shot = panel(w, fps)
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
    run_ggui() if A.ui is UIMode.GGUI else run_pygame()
