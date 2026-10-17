# ================================================================
# live_gui.py
# Interface gráfica para ESP32-CAM + YOLO + Labelme
# Agora 100% estável, com suporte a Labelme dentro da venv
# ================================================================

import os
import sys
import time
import threading
import subprocess
from datetime import datetime

import cv2
import numpy as np
from PIL import Image, ImageTk
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

# --- YOLO (tenta importar) ---
try:
    from ultralytics import YOLO
    import torch
    YOLO_AVAILABLE = True
except Exception:
    YOLO_AVAILABLE = False

# ===================== CONFIG =========================
DEFAULT_IP = "192.168.1.33"   # coloque qualquer IP padrão
SAVE_DIR = "frames"
DEFAULT_MODEL_PATH = "models/best.pt"
IMGSZ_DEFAULT = 640
CONF_DEFAULT = 0.20
IOU_DEFAULT = 0.40
# =======================================================

os.makedirs(SAVE_DIR, exist_ok=True)


def now_filename(prefix="frame", ext="jpg"):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    return f"{prefix}_{ts}.{ext}"


# ======================================================
#                     CLASSE PRINCIPAL
# ======================================================
class ESP32ViewerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("ESP32-CAM • Coleta + YOLO (MJPEG porta 80)")
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        # Estado
        self.running = False
        self.capture_thread = None
        self.backend = None
        self.cap = None
        self.req = None
        self.last_frame_bgr = None
        self.fps_text = tk.StringVar(value="FPS: --")
        self.show_yolo = tk.BooleanVar(value=False)

        # YOLO
        self.model = None
        self.device = None
        self.model_path = tk.StringVar(value=DEFAULT_MODEL_PATH)
        self.model_loaded_text = tk.StringVar(value="Modelo: (nenhum)")

        # Hiperparâmetros
        self.conf_var = tk.DoubleVar(value=CONF_DEFAULT)
        self.iou_var = tk.DoubleVar(value=IOU_DEFAULT)
        self.imgsz_var = tk.IntVar(value=IMGSZ_DEFAULT)

        self._build_ui()

        self.root.bind("<s>", lambda e: self.save_frame())
        self.root.bind("<S>", lambda e: self.save_frame())
        self.root.bind("<l>", lambda e: self.save_and_label())
        self.root.bind("<L>", lambda e: self.save_and_label())

    # -----------------------------------------------------
    #                   INTERFACE
    # -----------------------------------------------------
    def _build_ui(self):

        top = ttk.Frame(self.root)
        top.pack(side=tk.TOP, fill=tk.X, padx=8, pady=6)

        ttk.Label(top, text="IP do ESP32-CAM:").pack(side=tk.LEFT)
        self.ip_var = tk.StringVar(value=DEFAULT_IP)
        ttk.Entry(top, width=18, textvariable=self.ip_var).pack(side=tk.LEFT, padx=6)

        ttk.Button(top, text="Iniciar (Stream)", command=self.start_stream).pack(side=tk.LEFT)
        ttk.Button(top, text="Parar", command=self.stop_stream).pack(side=tk.LEFT, padx=5)
        ttk.Label(top, textvariable=self.fps_text).pack(side=tk.RIGHT)

        # YOLO BAR
        ybar = ttk.Frame(self.root)
        ybar.pack(side=tk.TOP, fill=tk.X, padx=8)

        ttk.Checkbutton(
            ybar, text="YOLO em tempo real",
            variable=self.show_yolo,
            command=self._toggle_yolo
        ).pack(side=tk.LEFT)

        ttk.Button(
            ybar, text="Escolher modelo...", command=self._choose_model
        ).pack(side=tk.LEFT, padx=6)

        ttk.Label(
            ybar, textvariable=self.model_loaded_text
        ).pack(side=tk.LEFT, padx=10)

        # SLIDERS
        sbar = ttk.Frame(self.root)
        sbar.pack(side=tk.TOP, fill=tk.X, padx=8)

        ttk.Label(sbar, text="Conf:").pack(side=tk.LEFT)
        tk.Scale(sbar, from_=0.01, to=0.90, resolution=0.01,
                 orient=tk.HORIZONTAL, variable=self.conf_var, length=150).pack(side=tk.LEFT, padx=8)

        ttk.Label(sbar, text="IoU:").pack(side=tk.LEFT)
        tk.Scale(sbar, from_=0.10, to=0.90, resolution=0.01,
                 orient=tk.HORIZONTAL, variable=self.iou_var, length=150).pack(side=tk.LEFT, padx=8)

        ttk.Label(sbar, text="ImgSz:").pack(side=tk.LEFT)
        tk.Scale(sbar, from_=320, to=960, resolution=32,
                 orient=tk.HORIZONTAL, variable=self.imgsz_var, length=150).pack(side=tk.LEFT, padx=8)

        # CANVAS
        self.video_label = tk.Label(self.root, bg="black")
        self.video_label.pack(fill=tk.BOTH, expand=True, padx=8, pady=10)

        # BOTTOM BUTTONS
        bottom = ttk.Frame(self.root)
        bottom.pack(side=tk.BOTTOM, fill=tk.X, padx=8, pady=8)

        ttk.Button(bottom, text="Salvar (S)", command=self.save_frame).pack(side=tk.LEFT)
        ttk.Button(bottom, text="Salvar + Labelme (L)", command=self.save_and_label).pack(side=tk.LEFT, padx=5)

    # -----------------------------------------------------
    #                   YOLO
    # -----------------------------------------------------
    def _choose_model(self):
        path = filedialog.askopenfilename(
            filetypes=[("YOLO weights", "*.pt"), ("Todos", "*.*")]
        )
        if path:
            self.model_path.set(path)
            if self.show_yolo.get():
                self._load_model()

    def _toggle_yolo(self):
        if not self.show_yolo.get():
            self.model_loaded_text.set("Modelo: (desligado)")
            return
        if not YOLO_AVAILABLE:
            messagebox.showwarning("YOLO", "Pacote 'ultralytics' não está instalado.")
            self.show_yolo.set(False)
            return
        self._load_model()

    def _load_model(self):
        try:
            path = self.model_path.get()
            if not os.path.isfile(path):
                path = "yolov8n.pt"

            self.device = "cuda" if (torch.cuda.is_available()) else "cpu"
            self.model = YOLO(path)
            self.model.to(self.device)

            self.model_loaded_text.set(f"Modelo: {os.path.basename(path)} ({self.device})")

        except Exception as e:
            self.model_loaded_text.set("Modelo: (erro)")
            self.show_yolo.set(False)
            messagebox.showerror("YOLO", f"Erro ao carregar modelo:\n{e}")

    # -----------------------------------------------------
    #              STREAM DO ESP32-CAM
    # -----------------------------------------------------
    def _build_urls(self):
        ip = self.ip_var.get().strip()
        return [
            f"http://{ip}/stream",
            f"http://{ip}:80/stream",
            f"http://{ip}:81/stream",
            f"http://{ip}:81/?action=stream",
        ]

    def start_stream(self):
        if self.running:
            return

        self.running = True
        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.capture_thread.start()

    def stop_stream(self):
        self.running = False

    def _open_opencv(self, url):
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def _open_mjpeg(self, url):
        import requests
        session = requests.Session()
        try:
            resp = session.get(url, stream=True, timeout=4)
            resp.raise_for_status()
            return session, resp
        except Exception:
            return None, None

    # loop de captura
    def _capture_loop(self):

        # 1) TENTA OPENCV
        for url in self._build_urls():
            cap = self._open_opencv(url)
            ok, frame = cap.read()
            if ok:
                self.backend = "opencv"
                self.cap = cap
                return self._stream_loop_opencv()
            cap.release()

        # 2) TENTA MJPEG
        for url in self._build_urls():
            session, resp = self._open_mjpeg(url)
            if resp:
                self.backend = "mjpeg"
                self.req = (session, resp)
                return self._stream_loop_mjpeg()

        # 3) ERRO
        self._error_stream()

    # ------------------------
    # STREAM COM OPENCV
    # ------------------------
    def _stream_loop_opencv(self):

        while self.running:
            ok, frame = self.cap.read()
            if not ok:
                break

            self._show_frame(frame)

        self.cap.release()

    # ------------------------
    # STREAM VIA MJPEG MANUAL
    # ------------------------
    def _stream_loop_mjpeg(self):
        session, resp = self.req
        boundary = b"--frame"

        buffer = b""

        for chunk in resp.iter_content(chunk_size=1024):
            if not self.running:
                break

            buffer += chunk
            a = buffer.find(b'\xff\xd8')
            b = buffer.find(b'\xff\xd9')

            if a != -1 and b != -1:
                jpg = buffer[a:b+2]
                buffer = buffer[b+2:]

                frame = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
                if frame is not None:
                    self._show_frame(frame)

        session.close()

    # -----------------------------------------------------
    #                EXIBIR FRAME + YOLO
    # -----------------------------------------------------
    def _show_frame(self, frame_bgr):

        self.last_frame_bgr = frame_bgr
        frame_show = frame_bgr.copy()

        # YOLO
        if self.show_yolo.get() and self.model:
            try:
                results = self.model.predict(
                    frame_bgr,
                    imgsz=self.imgsz_var.get(),
                    conf=self.conf_var.get(),
                    iou=self.iou_var.get(),
                    device=self.device,
                    verbose=False
                )
                r = results[0]
                frame_show = r.plot()

                n = len(r.boxes) if r.boxes is not None else 0
                conf_max = r.boxes.conf.max().item() if n else 0.0

                cv2.putText(frame_show, f"rachaduras: {n}  |  conf_max: {conf_max:.2f}",
                            (12, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0,255,255), 2)

            except Exception as e:
                print("YOLO ERR:", e)

        # render no tkinter
        rgb = cv2.cvtColor(frame_show, cv2.COLOR_BGR2RGB)
        imgtk = ImageTk.PhotoImage(Image.fromarray(rgb))
        self.video_label.imgtk = imgtk
        self.video_label.configure(image=imgtk)

    # -----------------------------------------------------
    #                SALVAR IMAGEM
    # -----------------------------------------------------
    def save_frame(self):
        if self.last_frame_bgr is None:
            return
        p = os.path.join(SAVE_DIR, now_filename())
        cv2.imwrite(p, self.last_frame_bgr)
        print("[save]", p)

    # -----------------------------------------------------
    #              SALVAR + ABRIR LABELME
    # -----------------------------------------------------
    def save_and_label(self):
        if self.last_frame_bgr is None:
            return

        p = os.path.join(SAVE_DIR, now_filename())
        cv2.imwrite(p, self.last_frame_bgr)
        print("[save+label]", p)

        # 1) tenta labelme.exe da venv
        try:
            venv_scripts = os.path.dirname(sys.executable)
            exe = os.path.join(venv_scripts, "labelme.exe")
            if os.path.isfile(exe):
                subprocess.Popen([exe, p])
                return
        except:
            pass

        # 2) tenta só "labelme"
        try:
            subprocess.Popen(["labelme", p])
            return
        except:
            pass

        # 3) tenta python -m labelme
        try:
            subprocess.Popen([sys.executable, "-m", "labelme", p])
            return
        except Exception as e:
            messagebox.showerror("Labelme", "Não foi possível abrir o Labelme.\nInstale com:\npip install labelme==5.2.1")

    # -----------------------------------------------------
    def _error_stream(self):
        urls = "\n".join(self._build_urls())
        messagebox.showerror("Stream",
            "Não consegui abrir o stream.\n\n"
            "Tente no navegador uma das URLs abaixo:\n\n"
            f"{urls}\n\n"
            "Se abrir no navegador, copie exatamente o MESMO IP aqui."
        )

    # -----------------------------------------------------
    def on_close(self):
        self.running = False
        time.sleep(0.1)
        self.root.destroy()


# ======================================================
#                   MAIN
# ======================================================
def main():
    root = tk.Tk()
    app = ESP32ViewerApp(root)
    root.geometry("1024x680")
    root.mainloop()


if __name__ == "__main__":
    main()
