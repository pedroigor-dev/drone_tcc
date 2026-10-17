# Aegis · Frontend

Painel de inspeção em React + React Three Fiber.

```bash
npm install
npm run dev
```

O painel conecta sozinho ao backend em `127.0.0.1:8000` (proxy do Vite). Sem backend, abre no modo **Demonstração**.

## Modos

- **Ao vivo**: vídeo da câmera, detecções e mosaico chegam por WebSocket enquanto o drone voa.
- **Missões gravadas**: qualquer missão salva em `backend/data/missions` pode ser revista com replay.
- **Demonstração**: missão real processada pelo pipeline sobre um voo simulado (`public/demo`).

## Cena 3D

A parede é um plano com textura de reboco. Por cima dela entra o mosaico real reconstruído a partir dos frames da câmera, na escala correta em metros. Trajetória, campo de visão e ocorrências usam as mesmas coordenadas calculadas no backend.
