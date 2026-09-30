# pip install pygame numpy
import numpy as np, pygame

# CONFIG
W, H, N, G = 1280, 720, 9000, 2500.0
C = np.array([W / 2, H / 2])

# STATE
def spawn(n):
    a = np.random.rand(n) * 2 * np.pi
    r = 30 + np.random.rand(n) ** 0.6 * 320
    d = np.c_[np.cos(a), np.sin(a)]
    v = np.c_[-d[:, 1], d[:, 0]] * np.sqrt(G / r)[:, None] * (0.9 + np.random.rand(n, 1) * 0.2)
    return C + d * r[:, None], v

def color(v):
    s = np.clip(np.hypot(v[:, 0], v[:, 1]) / 9, 0, 1)[:, None]
    return (np.hstack([s ** 0.6 * 255, 90 + s * 165, 255 - s * 120])).astype(np.uint8)

# INIT
pygame.init()
screen = pygame.display.set_mode((W, H))
clock = pygame.time.Clock()
p, v = spawn(N)
run = True
while run:
    for e in pygame.event.get():
        if e.type == pygame.QUIT or (e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE):
            run = False
        elif e.type == pygame.KEYDOWN and e.key == pygame.K_SPACE:
            p, v = spawn(N)

    d = C - p
    v += G * d / ((d ** 2).sum(1, keepdims=True) + 400) ** 1.5
    b = pygame.mouse.get_pressed()
    if b[0] or b[2]:
        dm = np.array(pygame.mouse.get_pos()) - p
        v += (1 if b[0] else -1) * 9000 * dm / ((dm ** 2).sum(1, keepdims=True) + 900) ** 1.5
    p += v

    out = (p[:, 0] < 0) | (p[:, 0] >= W) | (p[:, 1] < 0) | (p[:, 1] >= H)
    if out.any():
        p[out], v[out] = spawn(out.sum())

    screen.fill((7, 7, 10), special_flags=pygame.BLEND_RGB_SUB)
    ix = p.astype(int)
    px = pygame.surfarray.pixels3d(screen)
    px[ix[:, 0], ix[:, 1]] = color(v)
    del px
    pygame.display.flip()
    pygame.display.set_caption(f"Galaxy  |  {clock.get_fps():.0f} FPS  |  botão esq: atrai  dir: repele  espaço: reiniciar")
    clock.tick(60)
pygame.quit()
