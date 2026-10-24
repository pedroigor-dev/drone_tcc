# Aegis Edge Bridge

Serviço Python que roda no computador conectado à ESP32-CAM. Ele captura o vídeo, executa o YOLO, estima o deslocamento do drone sobre a parede e publica tudo para o frontend em tempo real.

## Instalação

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app:app --port 8000
```

Com o backend rodando, abra o frontend (`npm run dev` em `frontend`) e use o botão **Iniciar missão**.

## Fontes aceitas

| Fonte | Exemplo |
| --- | --- |
| IP da ESP32-CAM | `192.168.1.33` (testa `/stream`, `:81/stream` e `:81/?action=stream`, via OpenCV e via parser MJPEG) |
| URL completa | `http://192.168.1.33:81/stream` |
| Webcam | `0` |
| Arquivo de vídeo | `data/voo-simulado.mp4` |

## Pipeline

1. `capture.py` abre a fonte e mantém sempre o frame mais recente (sem acumular atraso).
2. `surface.py` calcula o deslocamento entre frames por correlação de fase (odometria visual planar) e monta o mosaico real da parede.
3. `edge_worker.py` roda o YOLO, ignora classes negativas (`sem rachadura`), converte cada caixa para metros na parede e salva o frame da evidência.
4. `mission.py` agrupa detecções da mesma fissura entre frames, calcula extensão estimada e persiste a missão em `data/missions/<id>/`.

A escala em metros depende de **distância da parede** e **FOV horizontal**, configuráveis na tela. Sem GPS/SLAM, a posição é relativa ao ponto onde a missão começou.

## Endpoints

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/api/status` | Estado do serviço |
| POST | `/api/stream/start` | Inicia missão (`source`, `confidence`, `distanceM`, `hfovDeg`, `record`, `loop`) |
| POST | `/api/stream/stop` | Encerra missão |
| GET | `/api/live.mjpg` | Vídeo ao vivo com as caixas desenhadas |
| GET | `/api/mosaic` | Mosaico atual (WebP com transparência) |
| WS | `/ws/inspection` | Snapshot da missão em tempo real |
| GET | `/api/missions` · `/api/missions/{id}` | Histórico de missões |
| POST | `/api/detections/{id}/status` | Confirmar ou descartar ocorrência |
| GET | `/api/assistant` | Provedor de IA ativo |
| POST | `/api/report` | Laudo da ocorrência em streaming (`missionId`, `detectionId`) |

## Voo simulado

`tools/simulate_flight.py` gera um vídeo de varredura a partir de uma foto real da parede, útil para demonstrar sem o drone:

```powershell
python ..\tools\simulate_flight.py --image foto_da_parede.jpg --out data\voo-simulado.mp4 --wall-scale 3 --rows 3
```

## Classificação técnica e risco de evolução

Para cada ocorrência, `crack_analysis.py` mede a fissura no frame de maior confiança:

- **Abertura (mm)**: largura equivalente da linha escura (soma da intensidade da fissura ÷ pico ÷ comprimento), resistente a desfoque. A incerteza é de ±1 pixel, convertido em mm pela distância e FOV.
- **Classe por abertura**: fissura (≤ 0,5 mm), trinca (0,5–1,5 mm), rachadura (1,5–5 mm), fenda (5–10 mm) e brecha (> 10 mm). Se a abertura fica abaixo da resolução da câmera, o sistema informa só o intervalo possível.
- **Orientação**: vertical, horizontal, diagonal ou mapeada, com a causa provável associada a cada padrão.
- **Risco de evolução (0–100)**: índice por regras que soma abertura, orientação e comprimento. Quando existe uma missão anterior do mesmo trecho, compara abertura e extensão. Crescimento acima da tolerância de medição marca a fissura como **ativa**.

Para comparar missões, decole sempre do mesmo ponto de referência, porque a posição é relativa ao início do voo. Voe mais perto da parede para medir aberturas menores: a 0,25 m cada pixel vale ≈ 0,47 mm.

## Assistente (laudo com IA)

`narrator.py` gera um laudo em texto a partir **apenas** das medições calculadas. A ordem de escolha é:

1. **Ollama local**, se estiver rodando em `127.0.0.1:11434`. Usa o modelo em `AEGIS_OLLAMA_MODEL` ou o primeiro instalado. Exemplo: `ollama pull llama3.2`.
2. **Hugging Face**, se a variável `HF_TOKEN` existir. O modelo padrão é `meta-llama/Llama-3.1-8B-Instruct` e pode ser trocado em `AEGIS_HF_MODEL`.
3. **Modelo de regras local**, sem internet.

`AEGIS_LLM=off` força o modo por regras.

## Modelo

`models/best.pt` atual localiza as fissuras, mas com confiança muito baixa (3–9%), por isso o limiar padrão é 3%. Após retreinar com mais imagens, aumente o limiar na tela de controle.
