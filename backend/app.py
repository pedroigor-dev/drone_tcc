from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from edge_worker import EdgeConfig, EdgeWorker
from mission import MissionStore

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(__file__).resolve().parent / "data"
MISSIONS = DATA / "missions"
MODEL_PATH = Path(os.getenv("AEGIS_MODEL", ROOT / "models" / "best.pt"))
MISSION_ID = re.compile(r"^INSP-\d{8}-\d{6}$")


class StartRequest(BaseModel):
    source: str = Field(default="0", min_length=1)
    confidence: float = Field(default=0.03, ge=0.005, le=0.99)
    iou: float = Field(default=0.45, ge=0.05, le=0.95)
    distanceM: float = Field(default=0.6, gt=0.05, le=20)
    hfovDeg: float = Field(default=62.0, gt=10, lt=170)
    record: bool = True
    loop: bool = False


class StatusRequest(BaseModel):
    status: str = Field(pattern="^(nova|em análise|confirmada|descartada)$")


store = MissionStore(MISSIONS)
worker: EdgeWorker | None = None

app = FastAPI(title="Aegis Edge Bridge", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/media", StaticFiles(directory=MISSIONS), name="media")


def status_payload() -> dict[str, Any]:
    return {
        "service": "online",
        "state": worker.state if worker else "idle",
        "running": bool(worker and worker.running),
        "device": worker.device if worker else None,
        "capture": worker.capture_backend if worker else None,
        "source": worker.config.source if worker else None,
        "model": MODEL_PATH.name,
        "modelAvailable": MODEL_PATH.is_file(),
        "missionId": store.mission["id"] if store.mission else None,
        "error": worker.error if worker else None,
    }


@app.get("/api/status")
def get_status() -> dict[str, Any]:
    return status_payload()


@app.get("/api/snapshot")
def get_snapshot() -> dict[str, Any]:
    return {**store.snapshot(), "status": status_payload()}


@app.post("/api/stream/start")
def start_stream(request: StartRequest) -> dict[str, Any]:
    global worker
    if worker and worker.running:
        return status_payload()
    if not MODEL_PATH.is_file():
        raise HTTPException(400, f"Modelo não encontrado em {MODEL_PATH}")
    worker = EdgeWorker(
        EdgeConfig(
            source=request.source,
            model_path=MODEL_PATH,
            confidence=request.confidence,
            iou=request.iou,
            distance_m=request.distanceM,
            hfov_deg=request.hfovDeg,
            record=request.record,
            loop=request.loop,
            settings=request.model_dump(),
        ),
        store,
    )
    worker.start()
    return status_payload()


@app.post("/api/stream/stop")
async def stop_stream() -> dict[str, Any]:
    if worker:
        await run_in_threadpool(worker.stop)
    return status_payload()


@app.get("/api/live.mjpg")
async def live_stream() -> StreamingResponse:
    if not worker or not worker.running:
        raise HTTPException(409, "Nenhuma captura ativa")
    current = worker

    async def frames():
        seq = 0
        while current.running:
            data, next_seq = await run_in_threadpool(current.preview, seq, 1.0)
            if data is None or next_seq == seq:
                continue
            seq = next_seq
            yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(data)).encode() + b"\r\n\r\n" + data + b"\r\n"

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame", headers={"Cache-Control": "no-store"})


@app.get("/api/mosaic")
def current_mosaic() -> Response:
    if worker and worker.mosaic.revision:
        return Response(worker.mosaic.encode(), media_type="image/webp", headers={"Cache-Control": "no-store"})
    if store.mission:
        file = store.directory / "mosaic.webp"
        if file.is_file():
            return Response(file.read_bytes(), media_type="image/webp", headers={"Cache-Control": "no-store"})
    raise HTTPException(404, "Mosaico indisponível")


@app.post("/api/detections/{detection_id}/status")
def update_detection(detection_id: str, request: StatusRequest) -> dict[str, Any]:
    item = store.set_status(detection_id, request.status)
    if not item:
        raise HTTPException(404, "Ocorrência não encontrada")
    return item


@app.get("/api/missions")
def list_missions() -> list[dict[str, Any]]:
    return store.list_missions()


@app.get("/api/missions/{mission_id}")
def get_mission(mission_id: str) -> dict[str, Any]:
    if not MISSION_ID.match(mission_id):
        raise HTTPException(400, "Identificador inválido")
    data = store.load(mission_id)
    if not data:
        raise HTTPException(404, "Missão não encontrada")
    data["mosaicUrl"] = f"/media/{mission_id}/mosaic.webp" if (MISSIONS / mission_id / "mosaic.webp").is_file() else None
    return data


@app.websocket("/ws/inspection")
async def inspection_socket(socket: WebSocket) -> None:
    await socket.accept()
    delivered = None
    try:
        while True:
            snapshot = store.snapshot()
            status = status_payload()
            key = (snapshot["revision"], status["state"], status["error"])
            if key != delivered:
                await socket.send_json({"kind": "snapshot", **snapshot, "status": status})
                delivered = key
            await asyncio.sleep(0.15)
    except (WebSocketDisconnect, asyncio.CancelledError, RuntimeError):
        return


if os.getenv("AEGIS_AUTO_START") == "1":
    start_stream(StartRequest(source=os.getenv("AEGIS_SOURCE", "0")))
