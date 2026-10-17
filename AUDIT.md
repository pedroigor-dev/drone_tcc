# Auditoria técnica — 21/09/2026

## Estado atual confirmado

- Aplicação única em `live_gui.py`, Python + Tkinter.
- Entrada MJPEG da ESP32-CAM por quatro variantes de URL HTTP.
- Fallback de captura: OpenCV/FFmpeg e depois parser MJPEG via `requests`.
- Inferência local com Ultralytics YOLO; preferência por `models/best.pt` e fallback para `yolov8n.pt`.
- Exibição das caixas feita por `results[0].plot()`; os eventos não são serializados nem persistidos.
- Captura manual de frames e abertura do Labelme.
- Não há API, WebSocket, MQTT, banco, GPS, telemetria de voo ou modelo 3D.
- Não há repositório Git ou arquivos de dependências reproduzíveis.

## Riscos encontrados

1. O `.venv` foi copiado de outro computador e aponta para `C:\Users\joao1`; ele não executa nesta máquina.
2. O dataset tem somente 5 arquivos de label YOLO (4 treino/val efetivos visíveis) e quatro classes que representam variações ortográficas de apenas dois conceitos.
3. `sem rachadura` foi anotado como objeto, o que é inadequado para detecção: imagens negativas normalmente devem ter label vazio.
4. A validação contém amostra insuficiente. Métricas como recall 1.0 e mAP50 1.0 não são evidência de generalização; a precisão final observada no treino 10 está abaixo de 1%.
5. Caminhos absolutos do computador original permanecem no `dataset.yaml` e nos artefatos de treino.
6. A GUI atual chama widgets Tkinter a partir da thread de captura, o que pode causar instabilidade.
7. O IP padrão da câmera está fixo no código e não existe configuração persistente.

## Arquitetura recomendada

Manter captura e inferência no edge Python. Extrair gradualmente um serviço de eventos que publique snapshots REST e detecções WebSocket. O frontend consome um contrato independente, preservando o processamento existente. GPS/posição deve ser opcional; até existir, ocorrências podem ser associadas a zonas locais de inspeção, sem fingir coordenadas reais.
