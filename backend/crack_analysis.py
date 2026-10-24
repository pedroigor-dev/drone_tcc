from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np

APERTURE_CLASSES = [
    (0.5, "fissura"),
    (1.5, "trinca"),
    (5.0, "rachadura"),
    (10.0, "fenda"),
    (math.inf, "brecha"),
]

APERTURE_SCORE = {"fissura": 10, "trinca": 25, "rachadura": 45, "fenda": 62, "brecha": 78}

ORIENTATION_CAUSES = {
    "vertical": "Movimentação térmica, retração da alvenaria ou sobrecarga concentrada",
    "horizontal": "Expansão por umidade, sobrecarga ou movimentação da laje de cobertura",
    "diagonal": "Recalque diferencial de fundação ou esforço de cisalhamento",
    "mapeada": "Retração da argamassa de revestimento",
}

ORIENTATION_SCORE = {"diagonal": 20, "horizontal": 12, "vertical": 6, "mapeada": 0}


def classify_aperture(width_mm: float) -> str:
    return next(name for limit, name in APERTURE_CLASSES if width_mm <= limit)


def _crack_mask(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    height, width = gray.shape
    size = max(9, (min(height, width) // 6) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    smooth = cv2.GaussianBlur(blackhat, (3, 3), 0)
    threshold, mask = cv2.threshold(smooth, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if threshold < 8:
        return np.zeros_like(mask), blackhat
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros_like(mask)
    min_area = max(12, int(height * width * 0.0015))
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        elongation = max(w, h) / max(1, min(w, h))
        if area >= min_area and (elongation >= 2.2 or area >= min_area * 6):
            keep[labels == index] = 255
    return keep, blackhat


def analyze_crack(frame: np.ndarray, box: tuple[float, float, float, float], mm_per_px: float) -> dict[str, Any] | None:
    x1, y1, x2, y2 = box
    pad_x, pad_y = (x2 - x1) * 0.08, (y2 - y1) * 0.08
    height, width = frame.shape[:2]
    left, top = max(0, int(x1 - pad_x)), max(0, int(y1 - pad_y))
    right, bottom = min(width, int(x2 + pad_x)), min(height, int(y2 + pad_y))
    if right - left < 8 or bottom - top < 8:
        return None
    gray = cv2.cvtColor(frame[top:bottom, left:right], cv2.COLOR_BGR2GRAY)
    mask, blackhat = _crack_mask(gray)
    area = int(np.count_nonzero(mask))
    if area < 12:
        return None

    ys, xs = np.nonzero(mask)
    coords = np.column_stack([xs, ys]).astype(np.float32)
    coords -= coords.mean(axis=0)
    eigenvalues, eigenvectors = np.linalg.eigh(np.cov(coords.T))
    major = eigenvectors[:, int(np.argmax(eigenvalues))]
    angle = (math.degrees(math.atan2(-major[1], major[0])) + 180) % 180
    elongation = math.sqrt(max(eigenvalues) / max(min(eigenvalues), 1e-6))
    components = cv2.connectedComponents(mask, connectivity=8)[0] - 1

    projection = coords @ major
    span_px = float(np.percentile(projection, 98) - np.percentile(projection, 2))
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 3)
    ridge = (distance >= cv2.dilate(distance, np.ones((3, 3), np.uint8))) & (distance > 0)
    ridge_count = int(np.count_nonzero(ridge))
    length_px = max(span_px, min(ridge_count, span_px * 1.6))
    darkness = blackhat[mask > 0].astype(np.float32)
    peak = float(np.percentile(darkness, 90))
    width_px = float(darkness.sum() / max(peak, 1.0) / max(length_px, 1.0))
    width_px = max(1.0, width_px)

    if components >= 4 and elongation < 3:
        orientation = "mapeada"
    elif abs(angle - 90) <= 20:
        orientation = "vertical"
    elif angle <= 20 or angle >= 160:
        orientation = "horizontal"
    else:
        orientation = "diagonal"

    width_mm = width_px * mm_per_px
    resolved = width_px > 1.5
    category = classify_aperture(width_mm) if resolved else ("fissura ou trinca" if mm_per_px <= 1.5 else "não classificável")
    return {
        "widthMm": round(width_mm, 2),
        "widthUncertaintyMm": round(mm_per_px, 2),
        "lengthM": round(length_px * mm_per_px / 1000, 3),
        "angleDeg": round(angle, 1),
        "orientation": orientation,
        "elongation": round(elongation, 1),
        "category": category,
        "resolved": resolved,
        "resolutionMm": round(mm_per_px, 2),
        "probableCause": ORIENTATION_CAUSES[orientation],
    }


def growth_risk(analysis: dict[str, Any], length_m: float, history: dict[str, Any] | None) -> dict[str, Any]:
    factors: list[str] = []
    score = APERTURE_SCORE.get(analysis["category"], 20)
    factors.append(f"abertura classificada como {analysis['category']}")
    score += ORIENTATION_SCORE[analysis["orientation"]]
    factors.append(f"orientação {analysis['orientation']}")
    if length_m >= 1.0:
        score += 10
        factors.append("comprimento acima de 1 m")
    elif length_m >= 0.5:
        score += 5
        factors.append("comprimento acima de 50 cm")
    activity = "indeterminada"
    if history:
        if history["grew"]:
            score += 25
            activity = "ativa"
            factors.append("crescimento medido desde a missão anterior")
        else:
            score -= 8
            activity = "sem crescimento mensurável"
            factors.append("sem crescimento desde a missão anterior")
    score = int(max(0, min(100, score)))
    level = "alto" if score >= 60 else "moderado" if score >= 35 else "baixo"
    return {"score": score, "level": level, "activity": activity, "factors": factors}


def compare_history(current: dict[str, Any], previous: dict[str, Any], previous_mission: dict[str, Any], days: float) -> dict[str, Any]:
    now, before = current["analysis"], previous.get("analysis") or {}
    delta_width = round(now["widthMm"] - before.get("widthMm", now["widthMm"]), 2)
    now_length = current["sizeM"]["diagonal"]
    delta_length = round(now_length - previous["sizeM"]["diagonal"], 3)
    width_tolerance = now["widthUncertaintyMm"] + before.get("widthUncertaintyMm", now["widthUncertaintyMm"])
    length_tolerance = max(0.05, 0.1 * previous["sizeM"]["diagonal"])
    grew = delta_width > width_tolerance or delta_length > length_tolerance
    return {
        "missionId": previous_mission["id"],
        "detectionId": previous["id"],
        "days": round(days, 1),
        "previousWidthMm": before.get("widthMm"),
        "deltaWidthMm": delta_width,
        "deltaLengthM": delta_length,
        "widthToleranceMm": round(width_tolerance, 2),
        "lengthToleranceM": round(length_tolerance, 3),
        "grew": bool(grew),
    }
