from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np
import requests


def candidate_sources(source: str) -> list[int | str]:
    value = source.strip()
    if value.isdigit():
        return [int(value)]
    if "://" in value or Path(value).exists():
        return [value]
    host = value.rstrip("/")
    if ":" in host:
        return [f"http://{host}/stream", f"http://{host}/?action=stream", f"http://{host}/"]
    return [
        f"http://{host}/stream",
        f"http://{host}:81/stream",
        f"http://{host}:81/?action=stream",
        f"http://{host}/",
    ]


class _OpenCVReader:
    def __init__(self, source: int | str) -> None:
        params = [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 4000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 4000]
        backend = cv2.CAP_ANY if isinstance(source, int) else cv2.CAP_FFMPEG
        self.capture = cv2.VideoCapture(source, backend, params)
        self.capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not self.capture.isOpened():
            raise RuntimeError("opencv não abriu")
        ok, frame = self.capture.read()
        if not ok or frame is None:
            self.capture.release()
            raise RuntimeError("opencv sem frames")
        self.first: np.ndarray | None = frame
        fps = self.capture.get(cv2.CAP_PROP_FPS)
        self.fps = fps if 1 <= fps <= 120 else 0.0

    def read(self) -> np.ndarray | None:
        if self.first is not None:
            frame, self.first = self.first, None
            return frame
        ok, frame = self.capture.read()
        return frame if ok else None

    def rewind(self) -> bool:
        return bool(self.capture.set(cv2.CAP_PROP_POS_FRAMES, 0))

    def close(self) -> None:
        self.capture.release()


class _MjpegReader:
    def __init__(self, url: str) -> None:
        self.session = requests.Session()
        self.response = self.session.get(url, stream=True, timeout=(4, 6))
        self.response.raise_for_status()
        self.chunks: Iterator[bytes] = self.response.iter_content(chunk_size=8192)
        self.buffer = b""
        self.fps = 0.0
        first = self.read()
        if first is None:
            self.close()
            raise RuntimeError("mjpeg sem frames")
        self.first: np.ndarray | None = first

    def read(self) -> np.ndarray | None:
        if getattr(self, "first", None) is not None:
            frame, self.first = self.first, None
            return frame
        for chunk in self.chunks:
            self.buffer += chunk
            start = self.buffer.find(b"\xff\xd8")
            end = self.buffer.find(b"\xff\xd9", start + 2) if start != -1 else -1
            if start != -1 and end != -1:
                jpg = self.buffer[start:end + 2]
                self.buffer = self.buffer[end + 2:]
                frame = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
                if frame is not None:
                    return frame
            if len(self.buffer) > 4_000_000:
                self.buffer = b""
        return None

    def rewind(self) -> bool:
        return False

    def close(self) -> None:
        self.response.close()
        self.session.close()


class FrameGrabber:
    def __init__(self, source: str, loop_files: bool = False, record_path: Path | None = None) -> None:
        self.source = source
        self.loop_files = loop_files
        self.record_path = record_path
        self.backend = ""
        self.url = ""
        self.is_file = False
        self.error: str | None = None
        self._reader: _OpenCVReader | _MjpegReader | None = None
        self._writer: cv2.VideoWriter | None = None
        self._frame: np.ndarray | None = None
        self._seq = 0
        self._condition = threading.Condition()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.input_fps = 0.0

    def open(self) -> None:
        errors: list[str] = []
        for candidate in candidate_sources(self.source):
            try:
                self._reader = _OpenCVReader(candidate)
                self.backend = "opencv"
                self.url = str(candidate)
                break
            except Exception as exc:
                errors.append(f"{candidate}: {exc}")
            if isinstance(candidate, str) and candidate.startswith("http"):
                try:
                    self._reader = _MjpegReader(candidate)
                    self.backend = "mjpeg"
                    self.url = candidate
                    break
                except Exception as exc:
                    errors.append(f"{candidate} (mjpeg): {exc}")
        if self._reader is None:
            raise RuntimeError("Não foi possível abrir a câmera. Tentativas: " + " | ".join(errors))
        self.is_file = Path(self.url).exists()
        self._thread = threading.Thread(target=self._loop, name="frame-grabber", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        assert self._reader is not None
        interval = 1 / self._reader.fps if self.is_file and self._reader.fps else 0
        window_start = time.monotonic()
        window_frames = 0
        try:
            while not self._stop.is_set():
                started = time.monotonic()
                frame = self._reader.read()
                if frame is None:
                    if self.is_file and self.loop_files and self._reader.rewind():
                        continue
                    if not self.is_file:
                        self.error = "A câmera parou de enviar frames"
                    break
                if self.record_path and not self.is_file:
                    if self._writer is None:
                        height, width = frame.shape[:2]
                        self._writer = cv2.VideoWriter(str(self.record_path), cv2.VideoWriter_fourcc(*"mp4v"), 15, (width, height))
                    self._writer.write(frame)
                with self._condition:
                    self._frame = frame
                    self._seq += 1
                    self._condition.notify_all()
                window_frames += 1
                elapsed = time.monotonic() - window_start
                if elapsed >= 1:
                    self.input_fps = window_frames / elapsed
                    window_start, window_frames = time.monotonic(), 0
                if interval:
                    time.sleep(max(0.0, interval - (time.monotonic() - started)))
        except Exception as exc:
            self.error = str(exc)
        finally:
            with self._condition:
                self._condition.notify_all()

    @property
    def alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def next(self, after: int, timeout: float = 2.0) -> tuple[np.ndarray | None, int]:
        with self._condition:
            self._condition.wait_for(lambda: self._seq != after or not self.alive, timeout=timeout)
            return self._frame if self._seq != after else None, self._seq

    def close(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        if self._reader:
            self._reader.close()
        if self._writer:
            self._writer.release()
