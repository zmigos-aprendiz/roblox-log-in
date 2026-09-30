"""Galaxy GPU — simulador interativo de galáxias em Taichi.

Arquitetura:
    Config          dataclasses + enums + parsing da CLI
    Simulation      física 3D (analítica + PM opcional)
    Renderer        splat 2D/3D, bloom seletivo, compose filmic, atmosfera
    UI              pygame (padrão) ou ggui (Vulkan)

Física:
    - Partículas 3D reais: disco no plano (x, y) com espessura vertical (z).
    - Leapfrog KDK (kick-drift-kick) tanto para partículas quanto para centros.
    - Potencial analítico de 1 ou 2 centros + halo, esférico (3D).
    - Auto-gravidade PM opcional: grade 2D projetada no plano do disco.

Pipeline visual (2D):
    splat (soft 3×3)  →  Hα nebula (buffer separado)
    img*fade          →  bloom por luminância  →  2× gaussiana separável
    compose           →  aberração cromática no bloom
                      →  + Hα
                      →  + diffraction spikes (analítico por núcleo)
                      →  exposição  →  ACES filmic  →  + sky  →  dither  →  vignette
                      →  u8

Uso:
    python galaxy.py --preset collision --n 300000 --res 1280 720
    python galaxy.py --physics both --pm-grid 256
    python galaxy.py --quality low --perf

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
except Exception:
    sd = None


log = logging.getLogger("galaxy")


# ══════════════════════════════════════════════════════════════════ CONFIG
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


class Physics(str, Enum):
    ANALYTIC = "analytic"
    BOTH = "both"
    PM = "pm"


@dataclass(frozen=True)
class QualityProfile:
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

# ───── constantes físicas / render
EPS: float = 9e-4
RC: float = 0.02
DT: float = 0.004
EXPO: float = 1.2

# ───── espessura vertical do disco (unidades do disco)
Z_BASE: float = 0.010
Z_FLARE: float = 0.015
Z_TAU: float = 0.15
VZ_FRACTION: float = 0.20

# ───── PM defaults
PM_GRID_DEFAULT: int = 256
PM_ITERS_DEFAULT: int = 15
PM_STRENGTH_DEFAULT: float = 1.0

# ───── atmosfera / óptica
CHROMA_OFFSET: float = 0.008
SPIKE_ARM_PX: float = 80.0
SPIKE_WIDTH_K: float = 80.0
SPIKE_FALLOFF_K: float = 4.0
SPIKE_BBOX: float = 250.0
BLOOM_LUM_R: float = 0.2126
BLOOM_LUM_G: float = 0.7152
BLOOM_LUM_B: float = 0.0722

# ───── paletas
PALETTE_CLASSIC: int = 0
PALETTE_REALISTIC: int = 4
PALETTE_COUNT: int = 5


def _normalized_gaussian(n: int = 6, denom: float = 18.0) -> tuple[float, ...]:
    raw = [math.exp(-(k * k) / denom) for k in range(-n, n + 1)]
    total = sum(raw)
    return tuple(w / total for w in raw)


KW: tuple[float, ...] = _normalized_gaussian()


@dataclass(frozen=True)
class Config:
    n: int
    width: int
    height: int
    quality: Quality
    ui: UIMode
    preset: Preset
    physics: Physics
    use_cpu: bool
    perf: bool
    substeps: int
    bloom_enabled: int
    pm_grid: int
    pm_strength: float

    @property
    def aspect(self) -> float:
        return self.width / self.height

    @property
    def quarter_w(self) -> int:
        return self.width // 4

    @property
    def quarter_h(self) -> int:
        return self.height // 4

    @property
    def use_analytic(self) -> bool:
        return self.physics in (Physics.ANALYTIC, Physics.BOTH)

    @property
    def use_pm(self) -> bool:
        return self.physics in (Physics.BOTH, Physics.PM)


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
    ap.add_argument("--physics", choices=[p.value for p in Physics],
                    default=Physics.ANALYTIC.value)
    ap.add_argument("--pm-grid", type=int, default=PM_GRID_DEFAULT)
    ap.add_argument("--pm-strength", type=float, default=PM_STRENGTH_DEFAULT)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--perf", action="store_true")
    return ap


def parse_config(argv: list[str] | None = None) -> Config:
    ap = _build_parser()
    ns, _unknown = ap.parse_known_args(argv)

    quality = Quality(ns.quality)
    profile = QUALITY_PROFILES[quality]

    grid = ns.pm_grid
    if grid & (grid - 1) != 0 or grid < 32:
        raise SystemExit(f"--pm-grid precisa ser potência de 2 ≥ 32 (recebi {grid})")

    n = ns.n or profile.particles
    raw_w, raw_h = ns.res or (profile.width, profile.height)
    return Config(
        n=n,
        width=raw_w // 4 * 4,
        height=raw_h // 4 * 4,
        quality=quality,
        ui=UIMode(ns.ui),
        preset=Preset(ns.preset),
        physics=Physics(ns.physics),
        use_cpu=ns.cpu,
        perf=ns.perf,
        substeps=profile.substeps,
        bloom_enabled=profile.bloom_enabled,
        pm_grid=grid,
        pm_strength=ns.pm_strength,
    )


A: Config = parse_config()
ti.init(arch=ti.cpu if A.use_cpu else ti.gpu)


# ══════════════════════════════════════════════════════════════════ STATE
@dataclass
class SimState:
    """Parâmetros controláveis em runtime pela UI."""
    # física
    g: float = 0.4
    halo: float = 0.25
    mouse: float = 1.5
    time: float = 1.0
    pm_strength: float = PM_STRENGTH_DEFAULT

    # render básico
    br: float = 0.5
    fade: float = 0.9
    bloom: float = 1.2
    bloom_thr: float = 0.6
    pal: int = PALETTE_CLASSIC

    # efeitos visuais (0 desativa o kernel por early-out)
    vignette_amt: float = 0.35
    neb_amt: float = 0.6
    spike_amt: float = 0.8

    # toggles
    dust: bool = True
    stars: bool = True
    filmic: bool = True
    soft_splat: bool = True
    chroma: bool = True
    dither: bool = True

    # estado de UI
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
if A.use_pm:
    S.pal = PALETTE_REALISTIC

_lvl_lock = threading.Lock()
lvl = [0.0]


# ══════════════════════════════════════════════════════════════════ SIMULATION
@ti.data_oriented
class Simulation:
    """Física 3D: partículas + 1/2 centros + PM opcional.

    Sistema de coordenadas:
        pos.x ∈ ℝ  — horizontal do disco
        pos.y ∈ ℝ  — vertical do disco (na tela 2D)
        pos.z ∈ ℝ  — espessura vertical (|z| ≲ 0.03)

    Mapeamento para "mundo" (usado pelo splat 3D):
        world.x = pos.x - ASP/2
        world.y = pos.z
        world.z = pos.y - 0.5

    PM: grade 2D projetada em (x, y). Força aplicada só em (x, y). Válido
    porque h/r ~ 0.05 — a força vertical é dominada pelo analítico.
    """

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.N = cfg.n
        self.ASP = cfg.aspect

        # ───── partículas
        self.pos = ti.Vector.field(3, ti.f32, self.N)
        self.vel = ti.Vector.field(3, ti.f32, self.N)
        self.col = ti.Vector.field(3, ti.f32, self.N)
        self.p3 = ti.Vector.field(3, ti.f32, self.N)
        self.spd = ti.field(ti.f32, self.N)
        self.gid = ti.field(ti.i32, self.N)

        # ───── centros (plano z=0)
        self.cp = ti.Vector.field(2, ti.f32, 2)
        self.cv = ti.Vector.field(2, ti.f32, 2)
        self.cm = ti.field(ti.f32, 2)
        self.nc = ti.field(ti.i32, ())

        # ───── [g, halo, mouse, dt, analytic_on, pm_strength]
        self.SP = ti.field(ti.f32, 6)
        self.pal = ti.field(ti.i32, ())
        self.na = ti.field(ti.i32, ())
        self.na[None] = self.N

        # ───── grade PM
        G = cfg.pm_grid
        self.G = G
        self.h = 1.0 / G
        self.h2 = self.h * self.h
        self.rho = ti.field(ti.f32, (G, G))
        self.phi = ti.field(ti.f32, (G, G))
        self.fxg = ti.field(ti.f32, (G, G))
        self.fyg = ti.field(ti.f32, (G, G))

    # ──────────────────────────────────────────────── ti.func: física
    @ti.func
    def _analytic_accel(self, p, n):
        """Aceleração gravitacional 3D dos centros (cada um em z=0)."""
        a = ti.Vector([0.0, 0.0, 0.0])
        for c in ti.static(range(2)):
            if c < n:
                dx = self.cp[c].x - p.x
                dy = self.cp[c].y - p.y
                dz = -p.z
                r2 = dx * dx + dy * dy + dz * dz
                gm = self.SP[0] * self.cm[c]
                ha = self.SP[1] * self.cm[c]
                f = gm / (r2 + EPS) ** 1.5 + ha / (r2 + RC)
                a += ti.Vector([f * dx, f * dy, f * dz])
        return a

    @ti.func
    def _pm_force(self, p):
        """Força PM (CIC) nas coordenadas do disco. z=0 por design."""
        G = self.G
        gx = p.x / self.ASP * G
        gy = p.y * G
        ix = ti.cast(ti.floor(gx), ti.i32)
        iy = ti.cast(ti.floor(gy), ti.i32)
        fx = gx - ix
        fy = gy - iy
        ix0 = (ix + G) % G
        ix1 = (ix + 1 + G) % G
        iy0 = (iy + G) % G
        iy1 = (iy + 1 + G) % G
        w00 = (1.0 - fx) * (1.0 - fy)
        w10 = fx * (1.0 - fy)
        w01 = (1.0 - fx) * fy
        w11 = fx * fy
        ax = (self.fxg[ix0, iy0] * w00 + self.fxg[ix1, iy0] * w10
            + self.fxg[ix0, iy1] * w01 + self.fxg[ix1, iy1] * w11)
        ay = (self.fyg[ix0, iy0] * w00 + self.fyg[ix1, iy0] * w10
            + self.fyg[ix0, iy1] * w01 + self.fyg[ix1, iy1] * w11)
        return ti.Vector([ax / self.ASP, ay, 0.0])

    @ti.func
    def _accel(self, p, mx, my, mode, n):
        a = ti.Vector([0.0, 0.0, 0.0])
        if self.SP[4] > 0.5:
            a += self._analytic_accel(p, n)
        if mode != 0:
            dx = mx - p.x
            dy = my - p.y
            f = mode * self.SP[2] / (dx * dx + dy * dy + 1.6e-3) ** 1.5
            a += ti.Vector([f * dx, f * dy, 0.0])
        if self.SP[5] > 0.0:
            a += self._pm_force(p) * self.SP[5]
        return a

    @ti.func
    def _spawn(self, i):
        """Reposiciona partícula i numa órbita 3D quase circular."""
        n = self.nc[None]
        g = 0
        if n == 2 and i % 5 >= 3:
            g = 1
        self.gid[i] = g

        s = ti.select(n == 2, 0.22 * (1.0 - 0.2 * g), 0.42)
        r = 0.02 - ti.log(1.0 - 0.98 * ti.random()) * s * 0.28

        a = ti.random() * 2 * math.pi
        if ti.random() < 0.7:
            a = (ti.cast(ti.random() * 2, ti.i32) * math.pi
                 + 2.2 * ti.log(r / 0.02)
                 + (ti.random() + ti.random() - 1) * 0.45)
        ca, sa = ti.cos(a), ti.sin(a)

        acc_r = (self.SP[0] * self.cm[g] * r / (r * r + EPS) ** 1.5
                 + self.SP[1] * self.cm[g] * r / (r * r + RC))
        v_circ = ti.sqrt(r * acc_r) * (0.92 + 0.16 * ti.random())

        z_scale = Z_BASE + Z_FLARE * ti.exp(-r / Z_TAU)
        dz = (ti.random() - 0.5) * 2.0 * z_scale
        vz = (ti.random() - 0.5) * VZ_FRACTION * v_circ

        self.pos[i] = ti.Vector([
            self.cp[g].x + ca * r,
            self.cp[g].y + sa * r,
            dz,
        ])
        self.vel[i] = ti.Vector([
            self.cv[g].x - sa * v_circ,
            self.cv[g].y + ca * v_circ,
            vz,
        ])
        self.spd[i] = 0.5
        self._write_p3(i)

    @ti.func
    def _write_p3(self, i):
        self.p3[i] = ti.Vector([
            self.pos[i].x - self.ASP * 0.5,
            self.pos[i].z,
            self.pos[i].y - 0.5,
        ])

    # ──────────────────────────────────────────────── kernels: partículas
    @ti.kernel
    def _move_centers(self):
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

            if (p.x < -0.5 or p.x >= self.ASP + 0.5
                    or p.y < -0.5 or p.y >= 1.5):
                self._spawn(i)

            self._write_p3(i)

            g = self.gid[i]
            rel_v = self.vel[i] - ti.Vector([self.cv[g].x, self.cv[g].y, 0.0])
            s = ti.min(rel_v.norm() / 2.2, 1.0)
            self.spd[i] = s

            r_vec = self.pos[i] - ti.Vector([self.cp[g].x, self.cp[g].y, 0.0])
            r_mag = r_vec.norm()
            k = ti.min(r_mag / 0.35, 1.0)
            pal_id = self.pal[None]

            if pal_id == 0:
                self.col[i] = ti.Vector([s ** 0.6, 0.35 + 0.65 * s, 1.0 - 0.5 * s])
            elif pal_id == 1:
                self.col[i] = ti.Vector([1.0, 0.25 + 0.6 * s, 0.05 + 0.7 * s * s])
            elif pal_id == 2:
                self.col[i] = ti.Vector([1.0 - 0.65 * k, 0.75 - 0.15 * k, 0.35 + 0.65 * k])
            elif pal_id == 3:
                if g == 0:
                    self.col[i] = ti.Vector([0.3, 0.7, 1.0]) * (0.5 + 0.5 * s)
                else:
                    self.col[i] = ti.Vector([1.0, 0.5, 0.25]) * (0.5 + 0.5 * s)
            else:
                # PALETTE_REALISTIC: populações estelares por raio.
                r_norm = ti.min(r_mag / 0.45, 1.0)
                # `base` é declarada antes do if/else porque o Taichi escopa
                # cada ramo isoladamente — sem isto o compilador falha com
                # "Name base is not defined".
                base = ti.Vector([0.0, 0.0, 0.0])
                if r_norm < 0.25:
                    t = r_norm / 0.25
                    base = ti.Vector([1.0, 0.78, 0.45]) * (1 - t) \
                         + ti.Vector([1.0, 0.95, 0.9]) * t
                else:
                    t = (r_norm - 0.25) / 0.75
                    base = ti.Vector([1.0, 0.95, 0.9]) * (1 - t) \
                         + ti.Vector([0.95, 0.55, 0.45]) * t
                blue = s * ti.max(0.0, 1.0 - r_norm * 2.0) * 0.4
                self.col[i] = base * (0.35 + 0.65 * s) \
                            + ti.Vector([0.0, 0.05 * blue, blue])

    @ti.kernel
    def _reset(self):
        for i in self.pos:
            self._spawn(i)

    # ──────────────────────────────────────────────── kernels: PM
    @ti.kernel
    def _pm_clear(self):
        for i, j in self.rho:
            self.rho[i, j] = 0.0

    @ti.kernel
    def _pm_deposit(self, inv_n: ti.f32):
        G = self.G
        ASP = self.ASP
        for p in range(self.na[None]):
            pos = self.pos[p]
            gx = pos.x / ASP * G
            gy = pos.y * G
            ix = ti.cast(ti.floor(gx), ti.i32)
            iy = ti.cast(ti.floor(gy), ti.i32)
            fx = gx - ix
            fy = gy - iy
            ix0 = (ix + G) % G
            ix1 = (ix + 1 + G) % G
            iy0 = (iy + G) % G
            iy1 = (iy + 1 + G) % G
            self.rho[ix0, iy0] += (1.0 - fx) * (1.0 - fy) * inv_n
            self.rho[ix1, iy0] += fx * (1.0 - fy) * inv_n
            self.rho[ix0, iy1] += (1.0 - fx) * fy * inv_n
            self.rho[ix1, iy1] += fx * fy * inv_n

    @ti.kernel
    def _pm_subtract_mean(self):
        s = 0.0
        for i, j in self.rho:
            s += self.rho[i, j]
        avg = s / (self.G * self.G)
        for i, j in self.rho:
            self.rho[i, j] -= avg

    @ti.kernel
    def _pm_red(self):
        G = self.G
        h2 = self.h2
        for i, j in ti.ndrange(G, G):
            if (i + j) % 2 == 0:
                self.phi[i, j] = 0.25 * (
                    self.phi[(i - 1 + G) % G, j] +
                    self.phi[(i + 1) % G, j] +
                    self.phi[i, (j - 1 + G) % G] +
                    self.phi[i, (j + 1) % G] -
                    h2 * self.rho[i, j]
                )

    @ti.kernel
    def _pm_black(self):
        G = self.G
        h2 = self.h2
        for i, j in ti.ndrange(G, G):
            if (i + j) % 2 == 1:
                self.phi[i, j] = 0.25 * (
                    self.phi[(i - 1 + G) % G, j] +
                    self.phi[(i + 1) % G, j] +
                    self.phi[i, (j - 1 + G) % G] +
                    self.phi[i, (j + 1) % G] -
                    h2 * self.rho[i, j]
                )

    @ti.kernel
    def _pm_gradient(self):
        G = self.G
        inv_2h = 0.5 / self.h
        for i, j in ti.ndrange(G, G):
            self.fxg[i, j] = -0.5 * (
                self.phi[(i + 1) % G, j] - self.phi[(i - 1 + G) % G, j]
            ) * inv_2h
            self.fyg[i, j] = -0.5 * (
                self.phi[i, (j + 1) % G] - self.phi[i, (j - 1 + G) % G]
            ) * inv_2h

    # ──────────────────────────────────────────────── Python-side API
    def set_params(self, *, g: float, halo: float, mouse: float, dt: float,
                   pal: int, analytic_on: bool, pm_strength: float) -> None:
        self.SP.from_numpy(np.array(
            [g, halo, mouse, dt, 1.0 if analytic_on else 0.0, pm_strength],
            np.float32,
        ))
        self.pal[None] = pal

    def load(self, k: int) -> None:
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

    def solve_pm(self) -> None:
        inv_n = 1.0 / max(self.na[None], 1)
        self._pm_clear()
        self._pm_deposit(inv_n)
        self._pm_subtract_mean()
        for _ in range(PM_ITERS_DEFAULT):
            self._pm_red()
            self._pm_black()
        self._pm_gradient()

    def tick(self, mx: float, my: float, mode: int, substeps: int,
             pm_active: bool) -> None:
        if pm_active:
            self.solve_pm()
        for _ in range(substeps):
            self._move_centers()
            self._step(mx, my, mode)


# ══════════════════════════════════════════════════════════════════ RENDERER
@ti.data_oriented
class Renderer:
    """Pipeline visual: splat → Hα → bloom seletivo → filmic compose + FX."""

    def __init__(self, cfg: Config, sim: Simulation) -> None:
        self.cfg = cfg
        self.sim = sim
        self.W = cfg.width
        self.H = cfg.height
        self.QW = cfg.quarter_w
        self.QH = cfg.quarter_h

        # buffers
        self.img = ti.Vector.field(3, ti.f32, (self.W, self.H))
        self.neb = ti.Vector.field(3, ti.f32, (self.W, self.H))
        self.out = ti.Vector.field(3, ti.f32, (self.W, self.H))
        self.bl = ti.Vector.field(3, ti.f32, (self.QW, self.QH))
        self.bl2 = ti.Vector.field(3, ti.f32, (self.QW, self.QH))
        self.outu = ti.field(ti.u8, shape=(self.H, self.W, 3))

        # [br, fade, bloom, vignette_amt, neb_amt, spike_amt, bloom_thr]
        self.RP = ti.field(ti.f32, 7)

        # atmosfera
        self.dust = ti.field(ti.f32, (self.W, self.H))
        self.sky = ti.Vector.field(3, ti.f32, (self.W, self.H))
        self._init_atmosphere()

    # ──────────────────────────────────────────────── ti.func: utilidades
    @ti.func
    def _hash21(self, x: ti.f32, y: ti.f32) -> ti.f32:
        n = ti.sin(x * 127.1 + y * 311.7) * 43758.5453
        return n - ti.floor(n)

    @ti.func
    def _vnoise(self, x: ti.f32, y: ti.f32) -> ti.f32:
        ix = ti.floor(x)
        iy = ti.floor(y)
        fx = x - ix
        fy = y - iy
        ux = fx * fx * (3.0 - 2.0 * fx)
        uy = fy * fy * (3.0 - 2.0 * fy)
        a = self._hash21(ix, iy)
        b = self._hash21(ix + 1.0, iy)
        c = self._hash21(ix, iy + 1.0)
        d = self._hash21(ix + 1.0, iy + 1.0)
        return (a * (1.0 - ux) + b * ux) * (1.0 - uy) \
             + (c * (1.0 - ux) + d * ux) * uy

    @ti.func
    def _fbm(self, x: ti.f32, y: ti.f32) -> ti.f32:
        v = 0.0
        amp = 0.5
        freq = 1.0
        for _ in ti.static(range(4)):
            v += amp * self._vnoise(x * freq, y * freq)
            freq *= 2.0
            amp *= 0.5
        return v

    @ti.func
    def _aces(self, x: ti.f32) -> ti.f32:
        """ACES filmic (aprox. Narkowicz). Linear HDR → display."""
        a = 2.51
        b = 0.03
        c = 2.43
        d = 0.59
        e = 0.14
        v = (x * (a * x + b)) / (x * (c * x + d) + e)
        return ti.max(0.0, ti.min(1.0, v))

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

    # ──────────────────────────────────────────────── init atmosfera
    @ti.kernel
    def _init_atmosphere(self):
        # Dust: fbm em máscara anelar no disco médio.
        for x, y in self.dust:
            nx = x / self.W * 4.0
            ny = y / self.H * 4.0
            n = self._fbm(nx, ny)
            dx = (x - self.W * 0.5) / self.W
            dy = (y - self.H * 0.5) / self.H
            r = ti.sqrt(dx * dx + dy * dy) * 2.0
            mask = ti.max(0.0, 1.0 - ti.abs(r - 0.55) * 3.5)
            dust_amt = mask * ti.max(0.0, n * 1.6 - 0.35)
            self.dust[x, y] = 1.0 - 0.55 * ti.min(dust_amt, 1.0)
            self.sky[x, y] = ti.Vector([0.0, 0.0, 0.0])
        # Starfield: pontos com brilho e cor variados.
        n_stars = self.W * self.H // 400
        for _ in range(n_stars):
            px = ti.cast(ti.random() * self.W, ti.i32)
            py = ti.cast(ti.random() * self.H, ti.i32)
            b = 0.15 + 0.85 * ti.random() ** 3
            rb = 0.7 + 0.35 * ti.random()
            bb = 0.7 + 0.5 * ti.random()
            self.sky[px, py] += ti.Vector([b * rb, b * 0.95, b * bb]) * 0.55

    # ──────────────────────────────────────────────── kernels: splat
    @ti.kernel
    def splat(self, soft: ti.i32, emit_neb: ti.i32):
        """Splat 2D ortográfico com soft 3×3 adaptativo + emissão Hα."""
        for x, y in self.img:
            self.img[x, y] *= self.RP[1]
        # neb decai sempre: evita Hα "fantasma" ao reativar o slider.
        for x, y in self.neb:
            self.neb[x, y] *= self.RP[1]

        for i in range(self.sim.na[None]):
            p = self.sim.pos[i]
            c = self.sim.col[i]
            px = ti.cast(p.x * self.H, ti.i32)
            py = ti.cast(p.y * self.H, ti.i32)
            lum = BLOOM_LUM_R * c[0] + BLOOM_LUM_G * c[1] + BLOOM_LUM_B * c[2]

            if soft == 1 and lum > 0.5:
                for di, dj in ti.static(ti.ndrange(3, 3)):
                    sx = di - 1
                    sy = dj - 1
                    w = (2.0 - ti.abs(sx)) * (2.0 - ti.abs(sy)) / 16.0
                    xi = px + sx
                    yi = py + sy
                    if 0 <= xi < self.W and 0 <= yi < self.H:
                        self.img[xi, yi] += c * w * self.RP[0]
            else:
                if 0 <= px < self.W and 0 <= py < self.H:
                    self.img[px, py] += c * self.RP[0]

            # Hα: só estrelas jovens (rápidas)
            if emit_neb == 1:
                s = self.sim.spd[i]
                young = ti.max(0.0, s - 0.6) * 2.5
                if young > 0.0:
                    neb_col = ti.Vector([0.9, 0.15, 0.2]) * young * 0.5 * self.RP[0]
                    for di, dj in ti.static(ti.ndrange(3, 3)):
                        sx = di - 1
                        sy = dj - 1
                        w = (2.0 - ti.abs(sx)) * (2.0 - ti.abs(sy)) / 16.0
                        xi = px + sx
                        yi = py + sy
                        if 0 <= xi < self.W and 0 <= yi < self.H:
                            self.neb[xi, yi] += neb_col * w

    @ti.kernel
    def splat3d(self, yaw: ti.f32, pitch: ti.f32, dist: ti.f32):
        """Splat 3D com câmera orbital e projeção perspectiva."""
        for x, y in self.img:
            self.img[x, y] *= self.RP[1]
        cy, sy = ti.cos(yaw), ti.sin(yaw)
        cx, sx = ti.cos(pitch), ti.sin(pitch)
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

    # ──────────────────────────────────────────────── kernels: bloom
    @ti.kernel
    def bloom_down(self):
        """Downsample 4×4 com threshold por luminância (bloom seletivo)."""
        thr = self.RP[6]
        for x, y in self.bl:
            s = ti.Vector([0.0, 0.0, 0.0])
            for i, j in ti.static(ti.ndrange(4, 4)):
                c = self.img[x * 4 + i, y * 4 + j]
                lum = BLOOM_LUM_R * c[0] + BLOOM_LUM_G * c[1] + BLOOM_LUM_B * c[2]
                w = ti.max(0.0, lum - thr) / (lum + 1e-3)
                s += c * w
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

    # ──────────────────────────────────────────────── kernels: compose
    @ti.kernel
    def compose_u8(self, dust_on: ti.i32, stars_on: ti.i32,
                   aces_on: ti.i32, vignette_on: ti.i32,
                   dither_on: ti.i32, chroma_on: ti.i32,
                   spikes_on: ti.i32, neb_on: ti.i32):
        """Compose final em u8 (caminho pygame)."""
        vgn = self.RP[3]
        neb_amt = self.RP[4]
        spike_amt = self.RP[5]
        bloom_amt = self.RP[2]
        nc = self.sim.nc[None]
        qw_h = self.QW * 0.5
        qh_h = self.QH * 0.5

        for x, y in self.img:
            bx = (x + 0.5) / 4
            by = (y + 0.5) / 4

            # Pré-declarados: Taichi escopa cada ramo do if/else isoladamente.
            bloom = ti.Vector([0.0, 0.0, 0.0])
            spike = ti.Vector([0.0, 0.0, 0.0])
            sky = ti.Vector([0.0, 0.0, 0.0])

            if chroma_on == 1:
                dcx = bx - qw_h
                dcy = by - qh_h
                rr = ti.sqrt(dcx * dcx + dcy * dcy) + 1e-3
                ux = dcx / rr
                uy = dcy / rr
                off = rr * CHROMA_OFFSET
                br_ = self._samp(bx - ux * off, by - uy * off)[0]
                bg_ = self._samp(bx, by)[1]
                bb_ = self._samp(bx + ux * off, by + uy * off)[2]
                bloom = ti.Vector([br_, bg_, bb_]) * bloom_amt
            else:
                bloom = self._samp(bx, by) * bloom_amt

            c = self.img[x, y]

            if dust_on == 1:
                c = c * self.dust[x, y]
            if neb_on == 1:
                c = c + self.neb[x, y] * neb_amt

            if spikes_on == 1:
                fx = ti.cast(x, ti.f32)
                fy = ti.cast(y, ti.f32)
                for cc in ti.static(range(2)):
                    if cc < nc:
                        cxx = self.sim.cp[cc].x * self.H
                        cyy = self.sim.cp[cc].y * self.H
                        if (ti.abs(fx - cxx) < SPIKE_BBOX
                                and ti.abs(fy - cyy) < SPIKE_BBOX):
                            dx = (fx - cxx) / SPIKE_ARM_PX
                            dy = (fy - cyy) / SPIKE_ARM_PX
                            horiz = (1.0 / (1.0 + dx * dx * SPIKE_FALLOFF_K)
                                     * ti.exp(-dy * dy * SPIKE_WIDTH_K))
                            vert = (1.0 / (1.0 + dy * dy * SPIKE_FALLOFF_K)
                                    * ti.exp(-dx * dx * SPIKE_WIDTH_K))
                            sp = (horiz + vert) * spike_amt
                            spike = ti.Vector([sp, sp * 0.85, sp * 0.7])

            c = c + spike
            c = (c + bloom) * EXPO

            if stars_on == 1:
                sky = self.sky[x, y]

            for kk in ti.static(range(3)):
                lin = 1.0 - ti.exp(-c[kk])
                if aces_on == 1:
                    lin = self._aces(c[kk])
                v = lin + sky[kk] * (1.0 - lin)
                if vignette_on == 1:
                    vx = (x / self.W - 0.5) * 2.0
                    vy = (y / self.H - 0.5) * 2.0
                    v = v * ti.max(0.0, 1.0 - vgn * (vx * vx + vy * vy) * 0.25)
                if dither_on == 1:
                    h = self._hash21(ti.cast(x, ti.f32) + 0.5,
                                     ti.cast(y, ti.f32) + 0.5)
                    v = v + (h - 0.5) / 255.0
                self.outu[self.H - 1 - y, x, kk] = ti.cast(
                    ti.min(ti.max(v * 255.0 + 0.5, 0.0), 255.0), ti.u8)

    @ti.kernel
    def compose(self, dust_on: ti.i32, stars_on: ti.i32,
                aces_on: ti.i32, vignette_on: ti.i32,
                dither_on: ti.i32, chroma_on: ti.i32,
                spikes_on: ti.i32, neb_on: ti.i32):
        """Compose float (caminho ggui)."""
        vgn = self.RP[3]
        neb_amt = self.RP[4]
        spike_amt = self.RP[5]
        bloom_amt = self.RP[2]
        nc = self.sim.nc[None]
        qw_h = self.QW * 0.5
        qh_h = self.QH * 0.5

        for x, y in self.out:
            bx = (x + 0.5) / 4
            by = (y + 0.5) / 4

            bloom = ti.Vector([0.0, 0.0, 0.0])
            spike = ti.Vector([0.0, 0.0, 0.0])
            sky = ti.Vector([0.0, 0.0, 0.0])

            if chroma_on == 1:
                dcx = bx - qw_h
                dcy = by - qh_h
                rr = ti.sqrt(dcx * dcx + dcy * dcy) + 1e-3
                ux = dcx / rr
                uy = dcy / rr
                off = rr * CHROMA_OFFSET
                br_ = self._samp(bx - ux * off, by - uy * off)[0]
                bg_ = self._samp(bx, by)[1]
                bb_ = self._samp(bx + ux * off, by + uy * off)[2]
                bloom = ti.Vector([br_, bg_, bb_]) * bloom_amt
            else:
                bloom = self._samp(bx, by) * bloom_amt

            c = self.img[x, y]

            if dust_on == 1:
                c = c * self.dust[x, y]
            if neb_on == 1:
                c = c + self.neb[x, y] * neb_amt

            if spikes_on == 1:
                fx = ti.cast(x, ti.f32)
                fy = ti.cast(y, ti.f32)
                for cc in ti.static(range(2)):
                    if cc < nc:
                        cxx = self.sim.cp[cc].x * self.H
                        cyy = self.sim.cp[cc].y * self.H
                        if (ti.abs(fx - cxx) < SPIKE_BBOX
                                and ti.abs(fy - cyy) < SPIKE_BBOX):
                            dx = (fx - cxx) / SPIKE_ARM_PX
                            dy = (fy - cyy) / SPIKE_ARM_PX
                            horiz = (1.0 / (1.0 + dx * dx * SPIKE_FALLOFF_K)
                                     * ti.exp(-dy * dy * SPIKE_WIDTH_K))
                            vert = (1.0 / (1.0 + dy * dy * SPIKE_FALLOFF_K)
                                    * ti.exp(-dx * dx * SPIKE_WIDTH_K))
                            sp = (horiz + vert) * spike_amt
                            spike = ti.Vector([sp, sp * 0.85, sp * 0.7])

            c = c + spike
            c = (c + bloom) * EXPO

            if stars_on == 1:
                sky = self.sky[x, y]

            r0 = 1.0 - ti.exp(-c[0])
            g0 = 1.0 - ti.exp(-c[1])
            b0 = 1.0 - ti.exp(-c[2])
            if aces_on == 1:
                r0 = self._aces(c[0])
                g0 = self._aces(c[1])
                b0 = self._aces(c[2])

            out_c = ti.Vector([
                r0 + sky[0] * (1.0 - r0),
                g0 + sky[1] * (1.0 - g0),
                b0 + sky[2] * (1.0 - b0),
            ])

            if vignette_on == 1:
                vx = (x / self.W - 0.5) * 2.0
                vy = (y / self.H - 0.5) * 2.0
                out_c = out_c * ti.max(0.0, 1.0 - vgn * (vx * vx + vy * vy) * 0.25)

            self.out[x, y] = out_c

    # ──────────────────────────────────────────────── Python-side API
    def set_params(self, *, br: float, fade: float, bloom: float,
                   vignette_amt: float, neb_amt: float, spike_amt: float,
                   bloom_thr: float) -> None:
        self.RP.from_numpy(np.array(
            [br, fade, bloom, vignette_amt, neb_amt, spike_amt, bloom_thr],
            np.float32,
        ))

    def _bloom_pass(self) -> None:
        self.bloom_down()
        for _ in range(2):
            self.blur_h()
            self.blur_v()

    def post_pygame(self, *, bloom_level: float, dust: bool, stars: bool,
                    aces: bool, vignette: bool, dither: bool,
                    chroma: bool, spikes: bool, neb: bool) -> None:
        if bloom_level > 0.01:
            self._bloom_pass()
        self.compose_u8(
            1 if dust else 0, 1 if stars else 0,
            1 if aces else 0, 1 if vignette else 0,
            1 if dither else 0, 1 if chroma else 0,
            1 if spikes else 0, 1 if neb else 0,
        )

    def post_ggui(self, *, bloom_level: float, dust: bool, stars: bool,
                  aces: bool, vignette: bool, dither: bool,
                  chroma: bool, spikes: bool, neb: bool) -> None:
        if bloom_level > 0.01:
            self._bloom_pass()
        self.compose(
            1 if dust else 0, 1 if stars else 0,
            1 if aces else 0, 1 if vignette else 0,
            1 if dither else 0, 1 if chroma else 0,
            1 if spikes else 0, 1 if neb else 0,
        )


# ══════════════════════════════════════════════════════════════════ GLUE
def push_state(sim: Simulation, ren: Renderer) -> None:
    """Sincroniza S/Q/lvl → campos GPU de sim e render."""
    with _lvl_lock:
        l = lvl[0]
    dt = 0.0 if S.pause else DT * S.time * 2 / Q.sub
    sim.set_params(
        g=S.g, halo=S.halo, mouse=S.mouse, dt=dt, pal=S.pal,
        analytic_on=A.use_analytic,
        pm_strength=S.pm_strength if A.use_pm else 0.0,
    )
    ren.set_params(
        br=S.br * (1 + 2.5 * l),
        fade=S.fade,
        bloom=S.bloom * (1 + l),
        vignette_amt=S.vignette_amt,
        neb_amt=S.neb_amt,
        spike_amt=S.spike_amt,
        bloom_thr=S.bloom_thr,
    )


def load_scene(sim: Simulation, k: int, *, preserve_palette: bool = False) -> None:
    if not preserve_palette:
        S.pal = PALETTE_REALISTIC if A.use_pm else (0 if k == 1 else 3)
    sim.load(k)


def stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]


def audio_cb(data, *_args) -> None:
    val = lvl[0] * 0.8 + min(1.0, float(np.sqrt((data ** 2).mean())) * 8) * 0.2
    with _lvl_lock:
        lvl[0] = val


# ══════════════════════════════════════════════════════════════════ EXTRAS
class Extras:
    """Microfone e gravador de GIF, opcionais e preguiçosos."""

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


KEYS = """1 única | 2 colisão | R reinicia | ESPAÇO pausa | P paleta | V 3D | D dust | T stars
F filmic (ACES) | Y soft splat | B aberração cromática | H painel | A mic
G GIF | X screenshot | Q restaurar qualidade | F11 cheia | ESC sair"""


# ══════════════════════════════════════════════════════════════════ UI PYGAME
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
        S.pal = (S.pal + 1) % PALETTE_COUNT

    def foto() -> None:
        st["shot"] = True

    SL = [
        ("g", "Gravidade", 0.1, 1.5),
        ("halo", "Halo", 0.0, 1.5),
        ("mouse", "Mouse", 0.0, 4.0),
        ("time", "Tempo", 0.0, 3.0),
        ("pm_strength", "PM", 0.0, 4.0),
        ("br", "Brilho", 0.02, 0.6),
        ("fade", "Rastro", 0.6, 0.98),
        ("bloom", "Bloom", 0.0, 3.0),
        ("bloom_thr", "Bloom thr", 0.0, 2.0),
        ("vignette_amt", "Vignette", 0.0, 1.0),
        ("neb_amt", "Neb Hα", 0.0, 2.0),
        ("spike_amt", "Spikes", 0.0, 2.0),
    ]
    BT = [
        ("Única", lambda: load_scene(sim, 1, preserve_palette=True), None),
        ("Colisão", lambda: load_scene(sim, 2, preserve_palette=True), None),
        ("Reiniciar", sim.reset, None),
        ("Pausar", lambda: tog("pause"), "pause"),
        ("3D", lambda: tog("v3d"), "v3d"),
        ("Paleta", cyc, None),
        ("Dust", lambda: tog("dust"), "dust"),
        ("Stars", lambda: tog("stars"), "stars"),
        ("Filmic", lambda: tog("filmic"), "filmic"),
        ("Soft", lambda: tog("soft_splat"), "soft_splat"),
        ("Chroma", lambda: tog("chroma"), "chroma"),
        ("Dither", lambda: tog("dither"), "dither"),
    ]

    pw, x0, y0 = min(W - 20, max(260, W // 4)), 10, 10
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
    log.info("physics: %s%s", A.physics.value,
             f"  (pm-grid={A.pm_grid})" if A.use_pm else "")
    load_scene(sim, 1 if A.preset is Preset.SINGLE else 2)
    ex = Extras()
    t_start = time.time()
    slow = 0.0
    n_frame = 0
    running = True
    pm_active = A.use_pm

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
                elif k == pygame.K_d: tog("dust")
                elif k == pygame.K_t: tog("stars")
                elif k == pygame.K_f: tog("filmic")
                elif k == pygame.K_y: tog("soft_splat")
                elif k == pygame.K_b: tog("chroma")
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
        sim.tick(mpos[0] / H, 1 - mpos[1] / H, mode, Q.sub, pm_active)
        lap("sim")

        if S.v3d:
            ren.splat3d(*cam)
            neb_render = False
        else:
            neb_render = S.neb_amt > 0.001
            ren.splat(
                1 if S.soft_splat else 0,
                1 if neb_render else 0,
            )
        ren.post_pygame(
            bloom_level=S.bloom,
            dust=S.dust and not S.v3d,
            stars=S.stars,
            aces=S.filmic,
            vignette=S.vignette_amt > 0.001,
            dither=S.dither,
            chroma=S.chroma,
            spikes=S.spike_amt > 0.001 and not S.v3d,
            neb=neb_render,
        )
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
            hud = f"{fps:.0f} FPS  |  {int(sim.na[None]):,} partículas"
            if A.use_pm:
                hud += f"  |  PM {A.pm_grid}²"
            if S.v3d:
                hud += f"  |  3D yaw={cam[0]:.2f} pitch={cam[1]:.2f} d={cam[2]:.2f}"
            txt(hud, (x0 + 8, y0 + 2), (140, 150, 175))
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


# ══════════════════════════════════════════════════════════════════ UI GGUI
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
    S.pm_strength = w.slider_float("PM força", S.pm_strength, 0.0, 4.0)
    S.br = w.slider_float("Brilho", S.br, 0.02, 0.6)
    S.fade = w.slider_float("Rastro", S.fade, 0.6, 0.98)
    S.bloom = w.slider_float("Bloom", S.bloom, 0.0, 3.0)
    S.bloom_thr = w.slider_float("Bloom threshold", S.bloom_thr, 0.0, 2.0)
    S.vignette_amt = w.slider_float("Vignette", S.vignette_amt, 0.0, 1.0)
    S.neb_amt = w.slider_float("Neb Hα", S.neb_amt, 0.0, 2.0)
    S.spike_amt = w.slider_float("Spikes", S.spike_amt, 0.0, 2.0)
    S.pal = w.slider_int("Paleta (0-4)", S.pal, 0, PALETTE_COUNT - 1)
    S.filmic = w.checkbox("Filmic (ACES)", S.filmic)
    S.soft_splat = w.checkbox("Soft splat", S.soft_splat)
    S.chroma = w.checkbox("Aberração cromática", S.chroma)
    S.dither = w.checkbox("Dithering", S.dither)
    S.dust = w.checkbox("Dust lanes (D)", S.dust)
    S.stars = w.checkbox("Starfield (T)", S.stars)
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
    pm_active = A.use_pm

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
            elif e.key == "d":
                S.dust = not S.dust
            elif e.key == "t":
                S.stars = not S.stars
            elif e.key == "f":
                S.filmic = not S.filmic
            elif e.key == "y":
                S.soft_splat = not S.soft_splat
            elif e.key == "b":
                S.chroma = not S.chroma
        mx, my = win.get_cursor_pos()
        busy = S.panel and mx < 0.29 and my > 0.18
        mode = 0 if (busy or S.v3d) else 1 if win.is_pressed(ti.ui.LMB) else -1 if win.is_pressed(ti.ui.RMB) else 0
        push_state(sim, ren)
        sim.tick(mx * sim.ASP, my, mode, Q.sub, pm_active)
        if S.v3d:
            canvas.set_background_color((0.01, 0.01, 0.03))
            cam.track_user_inputs(win, movement_speed=0.02, hold_key=ti.ui.RMB)
            scene.set_camera(cam)
            scene.ambient_light((1, 1, 1))
            scene.particles(sim.p3, radius=0.0016, per_vertex_color=sim.col)
            canvas.scene(scene)
        else:
            neb_render = S.neb_amt > 0.001
            ren.splat(1 if S.soft_splat else 0, 1 if neb_render else 0)
            ren.post_ggui(
                bloom_level=S.bloom,
                dust=S.dust,
                stars=S.stars,
                aces=S.filmic,
                vignette=S.vignette_amt > 0.001,
                dither=S.dither,
                chroma=S.chroma,
                spikes=S.spike_amt > 0.001,
                neb=neb_render,
            )
            canvas.set_image(ren.out)
            if ex.rec:
                ex.write(np.ascontiguousarray(
                    (ren.out.to_numpy().transpose(1, 0, 2)[::-1] * 255).astype(np.uint8)))
        if S.panel:
            with gui.sub_window("Galáxia", 0.01, 0.01, 0.27, 0.95) as w:
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


# ══════════════════════════════════════════════════════════════════ MAIN
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    sim = Simulation(A)
    ren = Renderer(A, sim)
    if A.ui is UIMode.GGUI:
        run_ggui(sim, ren)
    else:
        run_pygame(sim, ren)
