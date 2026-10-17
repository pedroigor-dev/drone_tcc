import type { Detection, Telemetry, Vector3 } from '../types'

// DEMO DATA BOUNDARY — replace this module with the API/WebSocket gateway.
export const missionDuration = 124

export const trajectory: Vector3[] = [
  [-5, -1.8, 3.5], [-4.2, -0.6, 2.4], [-3.1, 1.1, 2.2], [-1.5, 2.1, 2.8],
  [0.2, 2.2, 3.1], [2.2, 1.4, 2.5], [3.6, 0.2, 2.1], [3.2, -1.4, 2.8],
]

export const detections: Detection[] = [
  { id: 'CRK-014', type: 'Rachadura', confidence: .94, severity: 'alta', status: 'confirmada', timestamp: 22, firstSeen: 22, lastSeen: 25, observations: 8, position: [-2.7, .8, 1.45], coordinateSource: 'demo', sizeM: { width: .12, height: .38, diagonal: .4 }, bbox: { x: 39, y: 28, width: 18, height: 57 }, frameUrl: '/frames/crack-01.jpg', zone: 'Painel B · Junta 04' },
  { id: 'CRK-021', type: 'Rachadura', confidence: .87, severity: 'moderada', status: 'em análise', timestamp: 58, firstSeen: 58, lastSeen: 61, observations: 6, position: [.2, 1.03, 2.35], coordinateSource: 'demo', sizeM: { width: .09, height: .24, diagonal: .26 }, bbox: { x: 48, y: 24, width: 20, height: 51 }, frameUrl: '/frames/crack-02.jpg', zone: 'Painel C · Face norte' },
  { id: 'CRK-027', type: 'Rachadura', confidence: .78, severity: 'baixa', status: 'nova', timestamp: 91, firstSeen: 91, lastSeen: 93, observations: 4, position: [2.55, -.4, 1.1], coordinateSource: 'demo', sizeM: { width: .06, height: .15, diagonal: .16 }, bbox: { x: 36, y: 34, width: 15, height: 42 }, frameUrl: '/frames/crack-03.jpg', zone: 'Painel D · Base' },
]

export const telemetry: Telemetry = {
  fps: 18.4, latencyMs: 82, signal: 91, battery: 74, altitudeM: 6.8, speedMs: 1.2,
}
