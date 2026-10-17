from __future__ import annotations

import argparse
import math
from pathlib import Path

import cv2
import numpy as np


def serpentine(rows: int, steps: int) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for row in range(rows):
        v = row / max(rows - 1, 1)
        for step in range(steps):
            u = step / (steps - 1)
            points.append((u if row % 2 == 0 else 1 - u, v))
        if row < rows - 1:
            for step in range(1, steps // 4):
                points.append((1.0 if row % 2 == 0 else 0.0, v + step / (steps // 4) / max(rows - 1, 1)))
    return points


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera um vídeo de voo simulado a partir de uma foto real da parede.")
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--wall-scale", type=float, default=2.0, help="quantas vezes a largura da parede é maior que a largura de um frame")
    parser.add_argument("--rows", type=int, default=3)
    parser.add_argument("--seconds", type=float, default=40)
    parser.add_argument("--fps", type=int, default=12)
    parser.add_argument("--size", default="640x480")
    args = parser.parse_args()

    width, height = (int(v) for v in args.size.split("x"))
    photo = cv2.imread(str(args.image))
    if photo is None:
        raise SystemExit(f"Imagem não encontrada: {args.image}")
    wall_w = int(width * args.wall_scale)
    wall_h = max(height, int(wall_w * photo.shape[0] / photo.shape[1]))
    wall = cv2.resize(photo, (wall_w, wall_h), interpolation=cv2.INTER_CUBIC)

    total = int(args.seconds * args.fps)
    route = serpentine(args.rows, max(8, total // args.rows))
    route = [route[int(i / total * (len(route) - 1))] for i in range(total)]
    writer = cv2.VideoWriter(str(args.out), cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (width, height))
    rng = np.random.default_rng(7)
    previous = None
    for index, (u, v) in enumerate(route):
        jitter = np.array([math.sin(index * 0.37) * 3 + rng.normal(0, 1.2), math.cos(index * 0.29) * 2.5 + rng.normal(0, 1.2)])
        x = int(np.clip(u * (wall_w - width) + jitter[0], 0, wall_w - width))
        y = int(np.clip(v * (wall_h - height) + jitter[1], 0, wall_h - height))
        frame = wall[y:y + height, x:x + width].copy()
        if previous is not None:
            dx, dy = x - previous[0], y - previous[1]
            length = int(min(9, max(1, math.hypot(dx, dy) * 0.6)))
            if length > 1:
                kernel = np.zeros((length, length), np.float32)
                cv2.line(kernel, (0, length // 2), (length - 1, length // 2), 1, 1)
                frame = cv2.filter2D(frame, -1, kernel / kernel.sum())
        noise = rng.normal(0, 3.5, frame.shape).astype(np.float32)
        frame = np.clip(frame.astype(np.float32) + noise, 0, 255).astype(np.uint8)
        writer.write(frame)
        previous = (x, y)
    writer.release()
    print(f"{args.out} · {total} frames · parede simulada {wall_w}×{wall_h} px")


if __name__ == "__main__":
    main()
