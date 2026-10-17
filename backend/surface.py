from __future__ import annotations

import math
import threading

import cv2
import numpy as np


class PlanarOdometry:
    def __init__(self, meters_per_px: float, work_width: int = 320, min_response: float = 0.06) -> None:
        self.meters_per_px = meters_per_px
        self.work_width = work_width
        self.min_response = min_response
        self.x = 0.0
        self.y = 0.0
        self.quality = 0.0
        self._previous: np.ndarray | None = None
        self._window: np.ndarray | None = None

    def update(self, frame: np.ndarray) -> tuple[float, float, float]:
        height, width = frame.shape[:2]
        scale = self.work_width / width
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (self.work_width, max(1, int(height * scale))), interpolation=cv2.INTER_AREA)
        small = cv2.GaussianBlur(small, (3, 3), 0).astype(np.float32)
        small -= small.mean()
        if self._window is None or self._window.shape != small.shape[::-1]:
            self._window = cv2.createHanningWindow(small.shape[::-1], cv2.CV_32F)
        if self._previous is not None and self._previous.shape == small.shape:
            (dx, dy), response = cv2.phaseCorrelate(self._previous, small, self._window)
            limit_x, limit_y = small.shape[1] * 0.4, small.shape[0] * 0.4
            if response >= self.min_response and abs(dx) < limit_x and abs(dy) < limit_y:
                step = self.meters_per_px / scale
                self.x -= dx * step
                self.y += dy * step
                self.quality = float(response)
            else:
                self.quality = float(response) * 0.5
        self._previous = small
        return self.x, self.y, self.quality


class SurfaceMosaic:
    def __init__(self, width_m: float = 8.0, height_m: float = 5.0, px_per_m: int = 320) -> None:
        self.width_m = width_m
        self.height_m = height_m
        self.px_per_m = px_per_m
        self.canvas = np.zeros((int(height_m * px_per_m), int(width_m * px_per_m), 4), np.uint8)
        self.revision = 0
        self._lock = threading.Lock()
        self._last: tuple[float, float] | None = None
        self._mask_cache: dict[tuple[int, int], np.ndarray] = {}
        self._encoded: tuple[int, bytes] | None = None

    @property
    def extent(self) -> dict[str, float]:
        return {"width": self.width_m, "height": self.height_m}

    def _feather(self, width: int, height: int) -> np.ndarray:
        key = (width, height)
        if key not in self._mask_cache:
            border = max(2, int(min(width, height) * 0.12))
            mask = np.zeros((height, width), np.float32)
            mask[border:-border or None, border:-border or None] = 1
            mask = cv2.GaussianBlur(mask, (0, 0), border / 2)
            self._mask_cache[key] = np.clip(mask * 1.15, 0, 1)[..., None]
        return self._mask_cache[key]

    def paste(self, frame: np.ndarray, x: float, y: float, meters_per_px: float, min_step: float = 0.015) -> bool:
        if self._last and math.dist(self._last, (x, y)) < min_step and self.revision:
            return False
        height, width = frame.shape[:2]
        target_w = max(4, int(width * meters_per_px * self.px_per_m))
        target_h = max(4, int(height * meters_per_px * self.px_per_m))
        tile = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA).astype(np.float32)
        mask = self._feather(target_w, target_h)
        cx = (x + self.width_m / 2) * self.px_per_m
        cy = (self.height_m / 2 - y) * self.px_per_m
        left, top = int(cx - target_w / 2), int(cy - target_h / 2)
        canvas_h, canvas_w = self.canvas.shape[:2]
        x0, y0 = max(0, left), max(0, top)
        x1, y1 = min(canvas_w, left + target_w), min(canvas_h, top + target_h)
        if x1 <= x0 or y1 <= y0:
            return False
        tile = tile[y0 - top:y1 - top, x0 - left:x1 - left]
        weight = mask[y0 - top:y1 - top, x0 - left:x1 - left]
        with self._lock:
            region = self.canvas[y0:y1, x0:x1]
            existing = region[..., 3:4].astype(np.float32) / 255
            blend = np.where(existing > 0, weight * 0.75, weight)
            region[..., :3] = (region[..., :3] * (1 - blend) + tile * blend).astype(np.uint8)
            region[..., 3:4] = np.maximum(region[..., 3:4], (weight * 255).astype(np.uint8))
            self.revision += 1
        self._last = (x, y)
        return True

    def covered_area_m2(self) -> float:
        with self._lock:
            painted = int(np.count_nonzero(self.canvas[..., 3] > 128))
        return painted / (self.px_per_m ** 2)

    def encode(self) -> bytes:
        with self._lock:
            if self._encoded and self._encoded[0] == self.revision:
                return self._encoded[1]
            revision = self.revision
            ok, data = cv2.imencode(".webp", self.canvas, [cv2.IMWRITE_WEBP_QUALITY, 82])
        if not ok:
            raise RuntimeError("falha ao codificar mosaico")
        self._encoded = (revision, data.tobytes())
        return self._encoded[1]


def meters_per_pixel(frame_width: int, distance_m: float, hfov_deg: float) -> float:
    return 2 * distance_m * math.tan(math.radians(hfov_deg) / 2) / frame_width
