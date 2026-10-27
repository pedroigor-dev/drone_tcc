from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import shutil
import unicodedata
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "dataset"
SOURCES = DATASET / "fontes"
NEGATIVES = DATASET / "negativas"
PENDING = DATASET / "pendentes"
YOLO = DATASET / "yolo"
CLASS_NAME = "rachadura"
NEGATIVE_MARKERS = ("sem", "nada", "negativ", "none")
SPLITS = {"train": 0.7, "val": 0.15, "test": 0.15}


def slug(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    plain = re.sub(r"\s*-\s*copia", "", plain)
    plain = re.sub(r"[^a-z0-9]+", "-", plain).strip("-")
    return plain[:80] or "imagem"


def image_hash(image: np.ndarray) -> str:
    small = cv2.resize(image, (64, 64), interpolation=cv2.INTER_AREA)
    return hashlib.sha1(small.tobytes()).hexdigest()[:12]


def is_negative_label(label: str) -> bool:
    plain = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode().lower()
    return any(marker in plain for marker in NEGATIVE_MARKERS)


def load_labelme(path: Path) -> tuple[dict, np.ndarray | None]:
    data = json.loads(path.read_text(encoding="utf-8"))
    image = None
    if data.get("imageData"):
        image = cv2.imdecode(np.frombuffer(base64.b64decode(data["imageData"]), np.uint8), cv2.IMREAD_COLOR)
    if image is None and data.get("imagePath"):
        candidate = (path.parent / data["imagePath"].replace("\\", "/")).resolve()
        if not candidate.is_file():
            candidate = path.parent / Path(data["imagePath"].replace("\\", "/")).name
        if candidate.is_file():
            image = cv2.imread(str(candidate))
    return data, image


def import_folder(folder: Path) -> None:
    for directory in (SOURCES, NEGATIVES, PENDING):
        directory.mkdir(parents=True, exist_ok=True)
    known = {image_hash(cv2.imread(str(p))) for d in (SOURCES, NEGATIVES, PENDING) for p in d.glob("*.jpg")}
    annotated_images: set[str] = set()
    report = {"anotadas": 0, "negativas": 0, "duplicadas": 0, "sem_imagem": 0, "rotulos_corrigidos": 0}
    for path in sorted(folder.glob("*.json")):
        data, image = load_labelme(path)
        if image is None:
            report["sem_imagem"] += 1
            continue
        digest = image_hash(image)
        if data.get("imagePath"):
            annotated_images.add(Path(data["imagePath"].replace("\\", "/")).name)
        if digest in known:
            report["duplicadas"] += 1
            continue
        known.add(digest)
        shapes = data.get("shapes", [])
        positives = [s for s in shapes if not is_negative_label(str(s.get("label", "")))]
        name = f"{slug(path.stem)}-{digest[:6]}"
        if not positives:
            cv2.imwrite(str(NEGATIVES / f"{name}.jpg"), image, [cv2.IMWRITE_JPEG_QUALITY, 95])
            report["negativas"] += 1
            continue
        for shape in positives:
            if shape.get("label") != CLASS_NAME:
                report["rotulos_corrigidos"] += 1
            shape["label"] = CLASS_NAME
        cv2.imwrite(str(SOURCES / f"{name}.jpg"), image, [cv2.IMWRITE_JPEG_QUALITY, 95])
        clean = {**data, "shapes": positives, "imagePath": f"{name}.jpg", "imageData": None, "imageHeight": image.shape[0], "imageWidth": image.shape[1]}
        (SOURCES / f"{name}.json").write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
        report["anotadas"] += 1
    loose = [p for p in sorted(folder.glob("*.jpg")) if p.name not in annotated_images]
    for path in loose:
        image = cv2.imread(str(path))
        if image is None:
            continue
        digest = image_hash(image)
        if digest in known:
            report["duplicadas"] += 1
            continue
        known.add(digest)
        cv2.imwrite(str(PENDING / f"{slug(path.stem)}-{digest[:6]}.jpg"), image, [cv2.IMWRITE_JPEG_QUALITY, 95])
    report["sem_anotacao_em_pendentes"] = len(loose)
    print(json.dumps(report, ensure_ascii=False, indent=2))


def shape_box(shape: dict, width: int, height: int) -> tuple[float, float, float, float] | None:
    points = np.array(shape["points"], dtype=np.float32)
    if len(points) < 2:
        return None
    x1, y1 = points.min(axis=0)
    x2, y2 = points.max(axis=0)
    if shape.get("shape_type") in ("linestrip", "line", "polyline"):
        pad = max(6.0, 0.015 * min(width, height))
        x1, y1, x2, y2 = x1 - pad, y1 - pad, x2 + pad, y2 + pad
    x1, x2 = max(0.0, float(x1)), min(float(width), float(x2))
    y1, y2 = max(0.0, float(y1)), min(float(height), float(y2))
    if x2 - x1 < 2 or y2 - y1 < 2:
        return None
    return (x1 + x2) / 2 / width, (y1 + y2) / 2 / height, (x2 - x1) / width, (y2 - y1) / height


def assign_splits(names: list[str]) -> dict[str, str]:
    ordered = sorted(names, key=lambda n: hashlib.md5(n.encode()).hexdigest())
    total = len(ordered)
    val = max(1, round(total * SPLITS["val"])) if total >= 3 else 0
    test = max(1, round(total * SPLITS["test"])) if total >= 3 else 0
    result = {}
    for index, name in enumerate(ordered):
        result[name] = "val" if index < val else "test" if index < val + test else "train"
    return result


def build() -> None:
    if YOLO.exists():
        shutil.rmtree(YOLO)
    for split in SPLITS:
        (YOLO / "images" / split).mkdir(parents=True, exist_ok=True)
        (YOLO / "labels" / split).mkdir(parents=True, exist_ok=True)
    groups: dict[str, list[tuple[str, Path, list[str]]]] = {"camera": [], "web": [], "negativa": []}
    for json_path in sorted(SOURCES.glob("*.json")):
        data = json.loads(json_path.read_text(encoding="utf-8"))
        image_path = SOURCES / data["imagePath"]
        image = cv2.imread(str(image_path))
        if image is None:
            continue
        height, width = image.shape[:2]
        lines = []
        for shape in data["shapes"]:
            box = shape_box(shape, width, height)
            if box:
                lines.append("0 " + " ".join(f"{v:.6f}" for v in box))
        if lines:
            group = "camera" if json_path.stem.startswith("frame-") else "web"
            groups[group].append((json_path.stem, image_path, lines))
    for image_path in sorted(NEGATIVES.glob("*.jpg")):
        groups["negativa"].append((image_path.stem, image_path, []))
    summary = {split: {"imagens": 0, "caixas": 0, "negativas": 0} for split in SPLITS}
    for items in groups.values():
        splits = assign_splits([name for name, _, _ in items])
        for name, image_path, lines in items:
            split = splits[name]
            shutil.copy2(image_path, YOLO / "images" / split / f"{name}.jpg")
            (YOLO / "labels" / split / f"{name}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
            summary[split]["imagens"] += 1
            summary[split]["caixas"] += len(lines)
            summary[split]["negativas"] += 0 if lines else 1
    (YOLO / "dataset.yaml").write_text(
        "train: images/train\nval: images/val\ntest: images/test\n\nnames:\n  0: rachadura\n",
        encoding="utf-8",
    )
    print(json.dumps({"grupos": {k: len(v) for k, v in groups.items()}, "divisao": summary}, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa anotações do Labelme e monta o dataset YOLO do projeto.")
    parser.add_argument("--importar", type=Path, help="pasta com .json do Labelme e/ou .jpg para incorporar")
    args = parser.parse_args()
    if args.importar:
        import_folder(args.importar)
    build()


if __name__ == "__main__":
    main()
