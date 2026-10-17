import type { Detection, DetectionStatus, EdgeStatus, MissionData, MissionSummary, StartSettings } from '../types'

async function request<T>(url: string, init?: RequestInit & { timeout?: number }): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(init?.timeout ?? 4000),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null
    const detail = typeof body?.detail === 'string' ? body.detail : `Erro ${response.status}`
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

type RawMission = Omit<MissionData, 'duration' | 'mosaicUrl'> & { duration?: number; elapsed?: number; mosaicUrl?: string | null }

export function normalizeMission(raw: RawMission, mosaicUrl: string | null): MissionData {
  return {
    mission: raw.mission,
    duration: raw.duration ?? raw.elapsed ?? 0,
    detections: raw.detections ?? [],
    path: raw.path ?? [],
    telemetry: raw.telemetry ?? {},
    mosaic: raw.mosaic ?? { revision: 0, width: 10, height: 6 },
    mosaicUrl,
  }
}

export const edgeApi = {
  status: () => request<EdgeStatus>('/api/status', { timeout: 1500 }),
  start: (settings: StartSettings) => request<EdgeStatus>('/api/stream/start', { method: 'POST', body: JSON.stringify(settings), timeout: 8000 }),
  stop: () => request<EdgeStatus>('/api/stream/stop', { method: 'POST', timeout: 10000 }),
  missions: () => request<MissionSummary[]>('/api/missions'),
  mission: async (id: string) => {
    const raw = await request<RawMission>(`/api/missions/${encodeURIComponent(id)}`)
    return normalizeMission(raw, raw.mosaicUrl ?? null)
  },
  setStatus: (id: string, status: DetectionStatus) => request<Detection>(`/api/detections/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  socketUrl: () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/inspection`,
  liveFeedUrl: (missionId: string | null) => `/api/live.mjpg?m=${missionId ?? ''}`,
}
