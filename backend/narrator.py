from __future__ import annotations

import json
import os
import time
from typing import Any, Iterator

import requests

OLLAMA_URL = os.getenv("AEGIS_OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("AEGIS_OLLAMA_MODEL", "")
HF_TOKEN = os.getenv("HF_TOKEN", "")
HF_MODEL = os.getenv("AEGIS_HF_MODEL", "meta-llama/Llama-3.1-8B-Instruct")
HF_URL = "https://router.huggingface.co/v1/chat/completions"

SYSTEM_PROMPT = (
    "Você é o assistente técnico de um sistema de inspeção de fachadas por drone. "
    "Escreva em português do Brasil, em texto corrido, sem listas, sem markdown e sem títulos, entre 110 e 170 palavras. "
    "Use SOMENTE os dados fornecidos em JSON. Nunca invente números, normas, datas ou causas que não estejam nos dados. "
    "Explique a classificação da abertura, a orientação, a causa provável, o risco de evolução e a confiança da detecção. "
    "Sempre informe a incerteza de medição. Deixe claro que o risco é um índice indicativo calculado por regras e que a confirmação exige vistoria de um engenheiro."
)

_cache: dict[str, Any] = {"at": 0.0, "value": None}


def _ollama_models() -> list[str]:
    response = requests.get(f"{OLLAMA_URL}/api/tags", timeout=0.6)
    response.raise_for_status()
    return [item["name"] for item in response.json().get("models", [])]


def provider() -> dict[str, Any]:
    if time.monotonic() - _cache["at"] < 15 and _cache["value"]:
        return _cache["value"]
    value: dict[str, Any] = {"provider": "regras", "model": "modelo de regras local", "available": True}
    if os.getenv("AEGIS_LLM", "auto") != "off":
        try:
            models = _ollama_models()
            chosen = OLLAMA_MODEL if OLLAMA_MODEL in models else (models[0] if models else "")
            if chosen:
                value = {"provider": "ollama", "model": chosen, "available": True}
        except (requests.RequestException, ValueError):
            if HF_TOKEN:
                value = {"provider": "huggingface", "model": HF_MODEL, "available": True}
    _cache.update(at=time.monotonic(), value=value)
    return value


def facts(detection: dict[str, Any], mission: dict[str, Any] | None) -> dict[str, Any]:
    analysis = detection.get("analysis") or {}
    risk = detection.get("risk") or {}
    history = detection.get("history")
    return {
        "missao": (mission or {}).get("id"),
        "ocorrencia": detection.get("id"),
        "confianca_deteccao_percentual": round(detection.get("confidence", 0) * 100, 1),
        "observacoes_em_frames": detection.get("observations"),
        "posicao_m": {"x": detection["position"][0], "y": detection["position"][1]},
        "extensao_m": detection.get("sizeM"),
        "classificacao_abertura": analysis.get("category"),
        "abertura_mm": analysis.get("widthMm"),
        "incerteza_abertura_mm": analysis.get("widthUncertaintyMm"),
        "abertura_resolvida_pela_camera": analysis.get("resolved"),
        "comprimento_m": analysis.get("lengthM"),
        "orientacao": analysis.get("orientation"),
        "angulo_graus": analysis.get("angleDeg"),
        "causa_provavel": analysis.get("probableCause"),
        "risco_evolucao": {"nivel": risk.get("level"), "indice_0_100": risk.get("score"), "atividade": risk.get("activity"), "fatores": risk.get("factors")},
        "comparacao_missao_anterior": history,
        "status_revisao": detection.get("status"),
    }


def _fmt(value: Any, digits: int = 1) -> str:
    if value is None:
        return "não disponível"
    return f"{value:.{digits}f}".replace(".", ",") if isinstance(value, float) else str(value)


def rules_report(data: dict[str, Any]) -> str:
    parts = [f"A ocorrência {data['ocorrencia']} foi detectada com {_fmt(data['confianca_deteccao_percentual'])}% de confiança, observada em {data['observacoes_em_frames']} frames."]
    if data["classificacao_abertura"]:
        if data["abertura_resolvida_pela_camera"]:
            parts.append(f"A abertura estimada é de {_fmt(data['abertura_mm'])} mm, com incerteza de ±{_fmt(data['incerteza_abertura_mm'])} mm, o que a enquadra como {data['classificacao_abertura']}.")
        else:
            parts.append(f"A abertura está abaixo da resolução da câmera (cerca de {_fmt(data['incerteza_abertura_mm'])} mm por pixel), então o sistema só consegue afirmar que se trata de {data['classificacao_abertura']}.")
        parts.append(f"A orientação predominante é {data['orientacao']}, com cerca de {_fmt(data['angulo_graus'], 0)} graus, padrão associado a: {data['causa_provavel'].lower()}.")
    else:
        parts.append("Não foi possível medir a abertura nesta imagem, então a classificação técnica ficou pendente.")
    risk = data["risco_evolucao"]
    if risk["nivel"]:
        parts.append(f"O índice de risco de evolução ficou em {risk['indice_0_100']} de 100, nível {risk['nivel']}, considerando {', '.join(risk['fatores'])}.")
    history = data["comparacao_missao_anterior"]
    if history:
        if history["grew"]:
            parts.append(f"Em relação à missão {history['missionId']}, feita {_fmt(history['days'])} dias antes, a abertura variou {_fmt(history['deltaWidthMm'], 2)} mm e a extensão {_fmt(history['deltaLengthM'] * 100, 0)} cm, acima da tolerância de medição, o que indica fissura ativa.")
        else:
            parts.append(f"Comparada à missão {history['missionId']}, a variação ficou dentro da tolerância de medição, sem crescimento mensurável.")
    else:
        parts.append("Ainda não há missão anterior no mesmo trecho para medir se ela está crescendo.")
    parts.append("O índice é indicativo e calculado por regras; a confirmação da causa e da gravidade exige vistoria de um engenheiro.")
    return " ".join(parts)


def _stream_ollama(model: str, data: dict[str, Any]) -> Iterator[str]:
    payload = {"model": model, "stream": True, "options": {"temperature": 0.2}, "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": json.dumps(data, ensure_ascii=False)}]}
    with requests.post(f"{OLLAMA_URL}/api/chat", json=payload, stream=True, timeout=(2, 120)) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if line:
                chunk = json.loads(line)
                text = chunk.get("message", {}).get("content", "")
                if text:
                    yield text


def _stream_hf(data: dict[str, Any]) -> Iterator[str]:
    payload = {"model": HF_MODEL, "stream": True, "temperature": 0.2, "max_tokens": 450, "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": json.dumps(data, ensure_ascii=False)}]}
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}
    with requests.post(HF_URL, json=payload, headers=headers, stream=True, timeout=(4, 120)) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line.startswith(b"data:"):
                continue
            body = line[5:].strip()
            if body == b"[DONE]":
                break
            delta = json.loads(body)["choices"][0].get("delta", {}).get("content")
            if delta:
                yield delta


def stream_report(detection: dict[str, Any], mission: dict[str, Any] | None) -> Iterator[str]:
    data = facts(detection, mission)
    active = provider()
    if active["provider"] == "regras" or not data["classificacao_abertura"]:
        yield rules_report(data)
        return
    produced = False
    try:
        source = _stream_ollama(active["model"], data) if active["provider"] == "ollama" else _stream_hf(data)
        for text in source:
            produced = True
            yield text
    except (requests.RequestException, ValueError, KeyError):
        if not produced:
            yield rules_report(data)
