import { detections, missionDuration, telemetry, trajectory } from '../data/mockMission'

export type DataMode = 'demo' | 'live'
export const dataMode: DataMode = 'demo'

// Single integration seam for the future Python edge service.
// A real adapter can expose GET /mission and WS /events without changing the UI.
export const inspectionGateway = {
  getSnapshot: () => ({ detections, missionDuration, telemetry, trajectory }),
}
