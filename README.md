# Inspeção estrutural com drone e YOLO

Projeto de TCC para inspeção visual de superfícies utilizando uma ESP32-CAM ou outra fonte de vídeo, detecção de rachaduras com YOLO e visualização dos resultados em um gêmeo digital interativo.

## Componentes

- `live_gui.py`: interface desktop original para captura da ESP32-CAM, inferência YOLO e integração com o Labelme.
- `backend/`: serviço FastAPI responsável pela captura, inferência, odometria visual, mosaico da superfície e persistência das missões.
- `frontend/`: interface React com evidências, ocorrências, telemetria, linha do tempo e representação 3D da inspeção.
- `models/`: pesos utilizados pelo detector de rachaduras.
- `frames/`: imagens coletadas e pequena base anotada no formato YOLO.
- `runs/`: resultados experimentais dos treinamentos e validações.
- `tools/`: utilitários, incluindo a geração de um voo simulado a partir de uma imagem.

## Execução do backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app:app --port 8000
```

## Execução do frontend

```powershell
cd frontend
npm install
npm run dev
```

Abra `http://localhost:5173` no navegador. A interface possui um modo de demonstração gravado e também pode se conectar ao backend para acompanhar uma missão.

## Fontes de vídeo aceitas

- Endereço IP ou URL de stream da ESP32-CAM.
- Webcam local.
- Arquivo de vídeo, como `backend/data/voo-simulado.mp4`.

## Observação sobre o modelo

Os resultados presentes neste repositório são experimentais. A base inicial é pequena e o modelo ainda deve ser retreinado com mais imagens e uma divisão de dados mais representativa antes de qualquer uso em inspeções reais. O sistema funciona como apoio à análise e não substitui a avaliação de um profissional qualificado.
