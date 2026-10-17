import { normalizeMission } from '../services/edgeApi'
import type { Detection, MissionData, PathPoint } from '../types'

const fallbackPath: PathPoint[] = Array.from({ length: 121 }, (_, index) => {
  const t = index
  const lane = Math.min(3, Math.floor(t / 30))
  const k = (t % 30) / 30
  const x = lane % 2 === 0 ? -1.4 + k * 2.8 : 1.4 - k * 2.8
  return [t, Number(x.toFixed(3)), Number((0.75 - lane * 0.5).toFixed(3))]
})

const base = { type: 'Rachadura', status: 'nova', coordinateSource: 'demo', observations: 6 } as const

const fallbackDetections: Detection[] = [
  { ...base, id: 'CRK-001', confidence: 0.91, severity: 'moderada', timestamp: 18, firstSeen: 18, lastSeen: 21, position: [0.28, 0.62, 0], sizeM: { width: 0.12, height: 0.27, diagonal: 0.3 }, bbox: { x: 25, y: 41, width: 24, height: 58 }, frameUrl: '/frames/crack-01.jpg' },
  { ...base, id: 'CRK-002', confidence: 0.84, severity: 'baixa', timestamp: 47, firstSeen: 47, lastSeen: 50, position: [-0.9, 0.18, 0], sizeM: { width: 0.07, height: 0.12, diagonal: 0.14 }, bbox: { x: 30, y: 32, width: 18, height: 40 }, frameUrl: '/frames/crack-02.jpg' },
  { ...base, id: 'CRK-003', confidence: 0.78, severity: 'alta', timestamp: 96, firstSeen: 96, lastSeen: 101, position: [0.7, -0.78, 0], sizeM: { width: 0.18, height: 0.42, diagonal: 0.46 }, bbox: { x: 38, y: 22, width: 22, height: 62 }, frameUrl: '/frames/crack-03.jpg' },
]

export const fallbackDemo: MissionData = {
  mission: { id: 'INSP-DEMO', startedAt: '2026-09-30T20:00:00', source: 'demonstração', endedAt: '2026-09-30T20:02:00' },
  duration: 120,
  detections: fallbackDetections,
  path: fallbackPath,
  telemetry: { fps: 9.8, latencyMs: 74, frames: 1180, resolution: '640×480', coveredAreaM2: 1.9, footprintM: [0.72, 0.54], distanceM: 0.6, trackingQuality: 0.42 },
  mosaic: { revision: 0, width: 10, height: 6 },
  mosaicUrl: null,
}

export async function loadDemo(): Promise<MissionData> {
  try {
    const response = await fetch('/demo/mission.json', { signal: AbortSignal.timeout(3000) })
    if (!response.ok) throw new Error('sem demo gravada')
    const raw = await response.json()
    const rewrite = (url: string) => url.replace(/^\/media\/[^/]+\//, '/demo/')
    raw.mission = { ...raw.mission, id: 'DEMO-VOO-SIMULADO', source: 'voo simulado sobre frames reais' }
    raw.detections = raw.detections.map((d: Detection) => ({ ...d, frameUrl: rewrite(d.frameUrl) }))
    return normalizeMission(raw, '/demo/mosaic.webp')
  } catch {
    return fallbackDemo
  }
}
