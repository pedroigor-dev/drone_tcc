from __future__ import annotations

import threading
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from capture import FrameGrabber
from mission import MissionStore
from surface import PlanarOdometry, SurfaceMosaic, meters_per_pixel

NEGATIVE_MARKERS = ("sem", "no crack", "nocrack", "negative", "background")
_model_cache: dict[str, Any] = {}
_model_lock = threading.Lock()


def normalize_label(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower().strip()
    return plain


def is_negative(name: str) -> bool:
    label = normalize_label(name)
    return any(marker in label for marker in NEGATIVE_MARKERS)


def load_model(path: Path) -> tuple[Any, str]:
    import torch
    from ultralytics import YOLO

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    key = f"{path}:{device}"
    with _model_lock:
        if key not in _model_cache:
            model = YOLO(str(path))
            model.predict(np.zeros((480, 640, 3), np.uint8), device=device, verbose=False)
            _model_cache[key] = model
        return _model_cache[key], device


@dataclass
class EdgeConfig:
    source: str
    model_path: Path
    confidence: float = 0.35
    iou: float = 0.45
    image_size: int = 640
    distance_m: float = 0.6
    hfov_deg: float = 62.0
    record: bool = True
    loop: bool = False
    settings: dict[str, Any] = field(default_factory=dict)


class EdgeWorker:
    def __init__(self, config: EdgeConfig, store: MissionStore) -> None:
        self.config = config
        self.store = store
        self.state = "idle"
        self.error: str | None = None
        self.device = "—"
        self.capture_backend = ""
        self.mosaic = SurfaceMosaic()
        self._grabber: FrameGrabber | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._preview: bytes | None = None
        self._preview_seq = 0
        self._preview_condition = threading.Condition()

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self.state = "connecting"
        self._thread = threading.Thread(target=self._run, name="edge-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def preview(self, after: int, timeout: float = 1.0) -> tuple[bytes | None, int]:
        with self._preview_condition:
            self._preview_condition.wait_for(lambda: self._preview_seq != after or self._stop.is_set(), timeout=timeout)
            return self._preview, self._preview_seq

    def _publish_preview(self, frame: np.ndarray) -> None:
        ok, data = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 78])
        if ok:
            with self._preview_condition:
                self._preview = data.tobytes()
                self._preview_seq += 1
                self._preview_condition.notify_all()

    def _run(self) -> None:
        mission_id = self.store.begin(self.config.source, self.config.settings)
        directory = self.store.directory
        try:
            model, self.device = load_model(self.config.model_path)
            positive = [index for index, name in model.names.items() if not is_negative(str(name))]
            if not positive:
                raise RuntimeError("O modelo não possui classes de anomalia")
            self._grabber = FrameGrabber(self.config.source, self.config.loop, directory / "raw.mp4" if self.config.record else None)
            self._grabber.open()
            self.capture_backend = self._grabber.backend
            self.store.reset_clock()
            self.state = "live"
            self._loop(model, positive, mission_id)
        except Exception as exc:
            self.error = str(exc)
            self.state = "error"
        finally:
            if self._grabber:
                self._grabber.close()
                if self._grabber.error and not self.error:
                    self.error = self._grabber.error
            self.store.finish(self.mosaic.encode() if self.mosaic.revision else None)
            if self.state != "error":
                self.state = "stopped"
            with self._preview_condition:
                self._preview_condition.notify_all()

    def _loop(self, model: Any, positive: list[int], mission_id: str) -> None:
        assert self._grabber is not None
        seq = 0
        odometry: PlanarOdometry | None = None
        meters_px = 0.0
        processed = 0
        window_start = time.monotonic()
        window_frames = 0
        loop_fps = 0.0
        while not self._stop.is_set():
            frame, seq = self._grabber.next(seq)
            if frame is None:
                if not self._grabber.alive:
                    break
                continue
            height, width = frame.shape[:2]
            if odometry is None:
                meters_px = meters_per_pixel(width, self.config.distance_m, self.config.hfov_deg)
                odometry = PlanarOdometry(meters_px)
            x, y, quality = odometry.update(frame)
            self.store.track(x, y)
            if self.mosaic.paste(frame, x, y, meters_px):
                self.store.update_mosaic(self.mosaic.revision, self.mosaic.extent)

            started = time.perf_counter()
            result = model.predict(frame, imgsz=self.config.image_size, conf=self.config.confidence, iou=self.config.iou, classes=positive, device=self.device, verbose=False)[0]
            latency_ms = (time.perf_counter() - started) * 1000
            processed += 1
            window_frames += 1
            elapsed = time.monotonic() - window_start
            if elapsed >= 1:
                loop_fps = window_frames / elapsed
                window_start, window_frames = time.monotonic(), 0

            preview = frame.copy()
            boxes = result.boxes if result.boxes is not None else []
            for box in boxes:
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
                confidence = float(box.conf[0])
                label = str(result.names.get(int(box.cls[0]), "rachadura"))
                self._draw_box(preview, x1, y1, x2, y2, confidence)
                self._register(frame, mission_id, x, y, meters_px, width, height, x1, y1, x2, y2, confidence, label)
            self._publish_preview(preview)
            self.store.update_telemetry({
                "fps": round(loop_fps, 1),
                "inputFps": round(self._grabber.input_fps, 1),
                "latencyMs": round(latency_ms, 1),
                "frames": processed,
                "resolution": f"{width}×{height}",
                "trackingQuality": round(quality, 3),
                "position": [round(x, 3), round(y, 3)],
                "coveredAreaM2": round(self.mosaic.covered_area_m2(), 3) if processed % 10 == 0 else self.store.telemetry.get("coveredAreaM2", 0),
                "footprintM": [round(width * meters_px, 3), round(height * meters_px, 3)],
                "distanceM": self.config.distance_m,
            })
            self.store.save(mosaic=self.mosaic.encode() if processed % 60 == 0 else None)

    def _register(self, frame: np.ndarray, mission_id: str, x: float, y: float, meters_px: float, width: int, height: int, x1: float, y1: float, x2: float, y2: float, confidence: float, label: str) -> None:
        left = x + (x1 - width / 2) * meters_px
        right = x + (x2 - width / 2) * meters_px
        top = y - (y1 - height / 2) * meters_px
        bottom = y - (y2 - height / 2) * meters_px
        candidate = {
            "type": "Rachadura",
            "label": label,
            "confidence": round(confidence, 4),
            "timestamp": self.store.elapsed(),
            "coordinateSource": "odometry",
            "bbox": {"x": x1 / width * 100, "y": y1 / height * 100, "width": (x2 - x1) / width * 100, "height": (y2 - y1) / height * 100},
            "frameUrl": "",
        }
        detection, improved = self.store.observe(candidate, [left, bottom, right, top])
        if improved:
            filename = f"{detection['id']}.jpg"
            cv2.imwrite(str(self.store.directory / "frames" / filename), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            with self.store.lock:
                detection["frameUrl"] = f"/media/{mission_id}/frames/{filename}?v={detection['observations']}"
                detection["frameCenter"] = [round(x, 3), round(y, 3)]
                self.store.revision += 1

    @staticmethod
    def _draw_box(image: np.ndarray, x1: float, y1: float, x2: float, y2: float, confidence: float) -> None:
        p1, p2 = (int(x1), int(y1)), (int(x2), int(y2))
        cv2.rectangle(image, p1, p2, (255, 255, 255), 1, cv2.LINE_AA)
        corner = max(6, int(min(x2 - x1, y2 - y1) * 0.18))
        for (px, py), (sx, sy) in (((p1[0], p1[1]), (1, 1)), ((p2[0], p1[1]), (-1, 1)), ((p1[0], p2[1]), (1, -1)), ((p2[0], p2[1]), (-1, -1))):
            cv2.line(image, (px, py), (px + corner * sx, py), (255, 255, 255), 2, cv2.LINE_AA)
            cv2.line(image, (px, py), (px, py + corner * sy), (255, 255, 255), 2, cv2.LINE_AA)
        text = f"RACHADURA {confidence * 100:.0f}%"
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
        top = max(0, p1[1] - th - 8)
        cv2.rectangle(image, (p1[0], top), (p1[0] + tw + 8, top + th + 8), (255, 255, 255), -1)
        cv2.putText(image, text, (p1[0] + 4, top + th + 3), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 1, cv2.LINE_AA)
