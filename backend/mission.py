from __future__ import annotations

import json
import math
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any


def severity_from_length(length_m: float) -> str:
    if length_m >= 0.4:
        return "alta"
    if length_m >= 0.15:
        return "moderada"
    return "baixa"


class MissionStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.revision = 0
        self.mission: dict[str, Any] | None = None
        self.detections: list[dict[str, Any]] = []
        self.path: list[list[float]] = []
        self.telemetry: dict[str, Any] = {}
        self.mosaic: dict[str, Any] = {"revision": 0, "width": 0, "height": 0}
        self._counter = 0
        self._started = 0.0
        self._saved_at = 0.0
        self.max_extent = 2.5
        self._ended: float | None = None

    @property
    def directory(self) -> Path:
        assert self.mission is not None
        return self.root / self.mission["id"]

    def begin(self, source: str, settings: dict[str, Any]) -> str:
        stamp = datetime.now()
        mission_id = f"INSP-{stamp.strftime('%Y%m%d-%H%M%S')}"
        with self.lock:
            self.mission = {"id": mission_id, "startedAt": stamp.isoformat(timespec="seconds"), "source": source, "settings": settings, "endedAt": None}
            self.detections, self.path, self.telemetry = [], [[0.0, 0.0, 0.0]], {}
            self.mosaic = {"revision": 0, "width": 0, "height": 0}
            self._counter = 0
            self._started = time.monotonic()
            self._ended = None
            self.revision += 1
        (self.directory / "frames").mkdir(parents=True, exist_ok=True)
        return mission_id

    def reset_clock(self) -> None:
        with self.lock:
            self._started = time.monotonic()

    def elapsed(self) -> float:
        if not self.mission:
            return 0.0
        end = self._ended if self._ended is not None else time.monotonic()
        return round(end - self._started, 2)

    def track(self, x: float, y: float, min_step: float = 0.02) -> None:
        with self.lock:
            last = self.path[-1] if self.path else None
            if last is None or math.dist(last[1:], (x, y)) >= min_step:
                self.path.append([self.elapsed(), round(x, 3), round(y, 3)])
                if len(self.path) > 4000:
                    self.path = self.path[::2]
                self.revision += 1

    @staticmethod
    def _overlap(a: list[float], b: list[float]) -> float:
        width = min(a[2], b[2]) - max(a[0], b[0])
        height = min(a[3], b[3]) - max(a[1], b[1])
        if width <= 0 or height <= 0:
            return 0.0
        smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
        return width * height / max(smaller, 1e-9)

    @staticmethod
    def _apply_extent(item: dict[str, Any], rect: list[float]) -> None:
        item["extent"] = [round(v, 4) for v in rect]
        width, height = rect[2] - rect[0], rect[3] - rect[1]
        diagonal = math.hypot(width, height)
        item["position"] = [round((rect[0] + rect[2]) / 2, 3), round((rect[1] + rect[3]) / 2, 3), 0.0]
        item["sizeM"] = {"width": round(width, 3), "height": round(height, 3), "diagonal": round(diagonal, 3)}
        item["severity"] = severity_from_length(diagonal)

    def observe(self, candidate: dict[str, Any], rect: list[float]) -> tuple[dict[str, Any], bool]:
        with self.lock:
            matches = [item for item in self.detections if item["type"] == candidate["type"] and self._overlap(item["extent"], rect) >= 0.25]
            if matches:
                match = min(matches, key=lambda item: (item["firstSeen"], item["id"]))
                for other in matches:
                    if other is not match:
                        match["observations"] += other["observations"]
                        match["firstSeen"] = min(match["firstSeen"], other["firstSeen"])
                        rect = [min(rect[0], other["extent"][0]), min(rect[1], other["extent"][1]), max(rect[2], other["extent"][2]), max(rect[3], other["extent"][3])]
                        if other["confidence"] > match["confidence"]:
                            match.update({key: other[key] for key in ("confidence", "bbox", "frameUrl", "frameCenter") if key in other})
                        self.detections.remove(other)
                merged = [min(rect[0], match["extent"][0]), min(rect[1], match["extent"][1]), max(rect[2], match["extent"][2]), max(rect[3], match["extent"][3])]
                if (merged[2] - merged[0]) <= self.max_extent and (merged[3] - merged[1]) <= self.max_extent:
                    self._apply_extent(match, merged)
                match["observations"] += 1
                match["lastSeen"] = candidate["timestamp"]
                improved = candidate["confidence"] > match["confidence"]
                if improved:
                    match.update({key: candidate[key] for key in ("confidence", "bbox")})
                self.revision += 1
                return match, improved
            self._counter += 1
            detection = {**candidate, "id": f"CRK-{self._counter:03d}", "observations": 1, "firstSeen": candidate["timestamp"], "lastSeen": candidate["timestamp"], "status": "nova"}
            self._apply_extent(detection, rect)
            self.detections.insert(0, detection)
            self.revision += 1
            return detection, True

    def update_telemetry(self, values: dict[str, Any]) -> None:
        with self.lock:
            self.telemetry.update(values)
            self.revision += 1

    def update_mosaic(self, revision: int, extent: dict[str, float]) -> None:
        with self.lock:
            self.mosaic = {"revision": revision, **extent}
            self.revision += 1

    def set_status(self, detection_id: str, status: str) -> dict[str, Any] | None:
        with self.lock:
            item = next((d for d in self.detections if d["id"] == detection_id), None)
            if item:
                item["status"] = status
                self.revision += 1
        if item:
            self.save(force=True)
        return item

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "revision": self.revision,
                "mission": dict(self.mission) if self.mission else None,
                "elapsed": self.elapsed(),
                "detections": [dict(d) for d in self.detections],
                "path": list(self.path),
                "telemetry": dict(self.telemetry),
                "mosaic": dict(self.mosaic),
            }

    def save(self, force: bool = False, mosaic: bytes | None = None) -> None:
        if not self.mission or (not force and time.monotonic() - self._saved_at < 2):
            return
        self._saved_at = time.monotonic()
        data = self.snapshot()
        data["duration"] = data.pop("elapsed")
        (self.directory / "mission.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        if mosaic:
            (self.directory / "mosaic.webp").write_bytes(mosaic)

    def finish(self, mosaic: bytes | None) -> None:
        if not self.mission:
            return
        with self.lock:
            self._ended = time.monotonic()
            self.mission["endedAt"] = datetime.now().isoformat(timespec="seconds")
            self.revision += 1
        self.save(force=True, mosaic=mosaic)

    def list_missions(self) -> list[dict[str, Any]]:
        items = []
        for file in sorted(self.root.glob("*/mission.json"), reverse=True):
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            items.append({
                "id": data["mission"]["id"],
                "startedAt": data["mission"]["startedAt"],
                "source": data["mission"]["source"],
                "duration": data.get("duration", 0),
                "detections": len(data.get("detections", [])),
            })
        return items

    def load(self, mission_id: str) -> dict[str, Any] | None:
        file = self.root / mission_id / "mission.json"
        if not file.is_file() or file.parent.parent != self.root:
            return None
        return json.loads(file.read_text(encoding="utf-8"))
