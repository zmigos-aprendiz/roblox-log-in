# pip install PyQt6 pyautogui pydirectinput
import sys, time, threading
import pyautogui, pydirectinput
from PyQt6.QtCore import QThread, pyqtSignal, Qt, QPropertyAnimation, QEasingCurve
from PyQt6.QtWidgets import (QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel,
                             QLineEdit, QPushButton, QProgressBar, QListWidget)
try:
    import winsound
except ImportError:
    winsound = None
try:
    import pygetwindow as gw
except Exception:
    gw = None

# CONFIG
DEFAULT_USER = "nayuara10"
FOCUS_POS = (756, 380)
CLICK_A = (681, 316)
CLICK_B = (692, 459)
WINDOW_TIMEOUT = 40
pyautogui.FAILSAFE = True
pydirectinput.PAUSE = 0.05

# SOUND
def beep(f, d=90):
    if winsound:
        threading.Thread(target=winsound.Beep, args=(f, d), daemon=True).start()
    else:
        QApplication.beep()

# WORKER
class Worker(QThread):
    step = pyqtSignal(int, int, str)
    done = pyqtSignal(bool, str)

    def __init__(self, user):
        super().__init__()
        self.user = user
        self._stop = False

    def stop(self):
        self._stop = True

    def pause(self, s):
        end = time.time() + s
        while time.time() < end:
            if self._stop:
                raise InterruptedError
            time.sleep(0.05)

    def wait_window(self):
        if not gw:
            return self.pause(18)
        end = time.time() + WINDOW_TIMEOUT
        while time.time() < end:
            if gw.getWindowsWithTitle("Roblox"):
                return self.pause(3)
            self.pause(0.5)
        raise TimeoutError("Janela do Roblox não apareceu")

    def run(self):
        U = self.user
        steps = [
            ("Iniciando em 3s", lambda: None, 3),
            ("Abrindo menu Iniciar", lambda: pyautogui.press("win"), 2),
            ("Buscando Roblox", lambda: pyautogui.write("roblox", interval=0.05), 2),
            ("Abrindo Roblox", lambda: pyautogui.press("enter"), 0),
            ("Aguardando janela", self.wait_window, 0),
            ("Focando janela", lambda: pydirectinput.rightClick(*FOCUS_POS), 1),
            ("Confirmando foco", lambda: pydirectinput.rightClick(*FOCUS_POS), 2),
            ("Clique 1", lambda: pydirectinput.click(*CLICK_A), 3),
            ("Clique 2", lambda: pydirectinput.click(*CLICK_A), 3),
            (f"Digitando {U}", lambda: pyautogui.write(U, interval=0.05), 0.5),
            ("Clique 3", lambda: pydirectinput.click(*CLICK_B), 3),
            ("Clique 4", lambda: pydirectinput.click(*CLICK_B), 0.5),
        ]
        try:
            for i, (label, fn, delay) in enumerate(steps, 1):
                if self._stop:
                    raise InterruptedError
                self.step.emit(i, len(steps), label)
                fn()
                self.pause(delay)
            self.done.emit(True, "Concluído")
        except InterruptedError:
            self.done.emit(False, "Cancelado")
        except Exception as e:
            self.done.emit(False, f"Erro: {e}")

# UI
QSS = """
QWidget{background:#0f1117;color:#e6e8ee;font:13px 'Segoe UI'}
QLabel#title{font:600 20px 'Segoe UI'}
QLabel#status{color:#8b93a7}
QLineEdit{background:#181b24;border:1px solid #262a37;border-radius:8px;padding:9px 12px}
QLineEdit:focus{border-color:#6c7cff}
QPushButton{background:#6c7cff;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600}
QPushButton:hover{background:#8391ff}
QPushButton:pressed{background:#5566e6}
QPushButton:disabled{background:#262a37;color:#5b6274}
QPushButton#stop{background:#2a1a20;color:#ff6b81}
QPushButton#stop:hover{background:#3a2028}
QProgressBar{background:#181b24;border:0;border-radius:4px;height:8px;text-visible:false}
QProgressBar::chunk{background:#6c7cff;border-radius:4px}
QProgressBar[state="ok"]::chunk{background:#3ddc97}
QProgressBar[state="err"]::chunk{background:#ff6b81}
QListWidget{background:#181b24;border:1px solid #262a37;border-radius:8px;padding:6px;outline:0}
QListWidget::item{padding:3px 4px}
"""

class App(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Roblox Auto")
        self.setStyleSheet(QSS)
        self.resize(420, 480)
        self.worker = None

        title = QLabel("Roblox Auto"); title.setObjectName("title")
        self.user = QLineEdit(DEFAULT_USER); self.user.setPlaceholderText("Usuário")
        self.start = QPushButton("Iniciar"); self.start.clicked.connect(self.run_)
        self.stopb = QPushButton("Parar"); self.stopb.setObjectName("stop")
        self.stopb.setEnabled(False); self.stopb.clicked.connect(self.cancel)
        self.status = QLabel("Pronto"); self.status.setObjectName("status")
        self.bar = QProgressBar(); self.bar.setRange(0, 100)
        self.anim = QPropertyAnimation(self.bar, b"value", self)
        self.anim.setEasingCurve(QEasingCurve.Type.OutCubic); self.anim.setDuration(350)
        self.log = QListWidget()
        hint = QLabel("Emergência: mova o mouse para o canto superior esquerdo")
        hint.setObjectName("status")

        row = QHBoxLayout(); row.addWidget(self.start, 2); row.addWidget(self.stopb, 1)
        lay = QVBoxLayout(self); lay.setContentsMargins(22, 20, 22, 18); lay.setSpacing(12)
        for w in (title, self.user): lay.addWidget(w)
        lay.addLayout(row)
        for w in (self.status, self.bar, self.log, hint): lay.addWidget(w)

    def add(self, txt):
        self.log.addItem(f"{time.strftime('%H:%M:%S')}  {txt}")
        self.log.scrollToBottom()

    def set_state(self, s):
        self.bar.setProperty("state", s)
        self.bar.style().unpolish(self.bar); self.bar.style().polish(self.bar)

    def run_(self):
        u = self.user.text().strip()
        if not u:
            self.user.setFocus(); return beep(400, 150)
        self.log.clear(); self.set_state(""); self.bar.setValue(0)
        self.start.setEnabled(False); self.stopb.setEnabled(True); self.user.setEnabled(False)
        beep(880)
        self.worker = Worker(u)
        self.worker.step.connect(self.on_step)
        self.worker.done.connect(self.on_done)
        self.worker.start()

    def cancel(self):
        if self.worker:
            self.worker.stop()

    def on_step(self, i, n, label):
        self.status.setText(f"[{i}/{n}] {label}")
        self.add(label); beep(1000, 40)
        self.anim.stop(); self.anim.setEndValue(int(i / n * 100)); self.anim.start()

    def on_done(self, ok, msg):
        self.status.setText(msg); self.add(("✔ " if ok else "✖ ") + msg)
        self.set_state("ok" if ok else "err")
        if ok:
            self.anim.stop(); self.bar.setValue(100)
        if winsound:
            for f in ((660, 880, 1100) if ok else (500, 300)):
                beep(f, 120); time.sleep(0.13)
        self.start.setEnabled(True); self.stopb.setEnabled(False); self.user.setEnabled(True)

    def closeEvent(self, e):
        if self.worker and self.worker.isRunning():
            self.worker.stop(); self.worker.wait(2000)
        e.accept()

# INIT
if __name__ == "__main__":
    app = QApplication(sys.argv)
    w = App(); w.show()
    sys.exit(app.exec())
