"""Configuração, presets e constantes tunáveis do galaxy_gpu.

Mantido separado da simulação/render para que testes e front-ends alternativos
possam construir um Config sem importar taichi ou pygame.
"""
from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from enum import Enum


# ---------------------------------------------------------------- enums
class Quality(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Preset(str, Enum):
    SINGLE = "single"
    COLLISION = "collision"


class UI(str, Enum):
    PYGAME = "pygame"
    GGUI = "ggui"


# ---------------------------------------------------------------- presets
@dataclass(frozen=True)
class QualityProfile:
    """Resolução/partículas/subpassos/bloom por nível de qualidade.

    `bloom_enabled` é mantido numérico (0/1) para preservar a semântica original
    usada nos checks `if QP[4]` / `if not QP[4]`.
    """
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


# ---------------------------------------------------------------- constantes físicas/render
# Antes espalhadas como literais no módulo principal.
EPS: float = 9e-4
RC: float = 0.02
DT: float = 0.004
EXPO: float = 1.2


def _normalized_gaussian(n: int = 6, denom: float = 18.0) -> tuple[float, ...]:
    """Kernel gaussiano simétrico de 2n+1 taps usado no bloom separável."""
    raw = [math.exp(-(k * k) / denom) for k in range(-n, n + 1)]
    total = sum(raw)
    return tuple(w / total for w in raw)


BLOOM_KERNEL: tuple[float, ...] = _normalized_gaussian()


# ---------------------------------------------------------------- config resolvido
@dataclass(frozen=True)
class Config:
    """Configuração totalmente resolvida.

    Reúne o que antes vinha do argparse + as quantidades derivadas
    (resolução múltipla de 4, perfil de qualidade, aspect ratio).
    """
    n: int
    width: int
    height: int
    quality: Quality
    ui: UI
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


# ---------------------------------------------------------------- parsing
def _build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="galaxy_gpu")
    ap.add_argument("--n", type=int)
    ap.add_argument("--preset", choices=[p.value for p in Preset],
                    default=Preset.COLLISION.value)
    ap.add_argument("--res", type=int, nargs=2)
    ap.add_argument("--quality", choices=[q.value for q in Quality],
                    default=Quality.MEDIUM.value)
    ap.add_argument("--ui", choices=[u.value for u in UI],
                    default=UI.PYGAME.value)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--perf", action="store_true")
    return ap


def parse_config(argv: list[str] | None = None) -> Config:
    """Resolve a configuração a partir da linha de comando.

    Args desconhecidos são tolerados (mesmo comportamento do `parse_known_args`
    usado anteriormente).
    """
    ap = _build_parser()
    ns, _unknown = ap.parse_known_args(argv)

    quality = Quality(ns.quality)
    profile = QUALITY_PROFILES[quality]

    # Mesma semântica de `or` do original: 0/None cai no perfil.
    n = ns.n or profile.particles
    raw_w, raw_h = ns.res or (profile.width, profile.height)
    w = raw_w // 4 * 4
    h = raw_h // 4 * 4

    return Config(
        n=n,
        width=w,
        height=h,
        quality=quality,
        ui=UI(ns.ui),
        preset=Preset(ns.preset),
        use_cpu=ns.cpu,
        perf=ns.perf,
        substeps=profile.substeps,
        bloom_enabled=profile.bloom_enabled,
    )
