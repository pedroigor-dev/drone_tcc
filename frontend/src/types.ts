export type Vector3 = [number, number, number]
export type Vector2 = [number, number]
export type PathPoint = [number, number, number]

export type DetectionStatus = 'nova' | 'em análise' | 'confirmada' | 'descartada'
export type Severity = 'baixa' | 'moderada' | 'alta'

export type Detection = {
  id: string
  type: string
  label?: string
  confidence: number
  severity: Severity
  status: DetectionStatus
  timestamp: number
  firstSeen: number
  lastSeen: number
  observations: number
  position: Vector3
  coordinateSource: 'demo' | 'odometry' | 'gps'
  sizeM: { width: number; height: number; diagonal: number }
  bbox: { x: number; y: number; width: number; height: number }
  frameUrl: string
  zone?: string
  frameCenter?: Vector2
  extent?: [number, number, number, number]
}

export type Telemetry = {
  fps?: number
  inputFps?: number
  latencyMs?: number
  frames?: number
  resolution?: string
  trackingQuality?: number
  position?: Vector2
  coveredAreaM2?: number
  footprintM?: Vector2
  distanceM?: number
  signal?: number
  battery?: number
  altitudeM?: number
  speedMs?: number
}

export type MissionInfo = {
  id: string
  startedAt: string
  source: string
  endedAt: string | null
  settings?: Record<string, unknown>
}

export type MosaicInfo = { revision: number; width: number; height: number }

export type MissionData = {
  mission: MissionInfo | null
  duration: number
  detections: Detection[]
  path: PathPoint[]
  telemetry: Telemetry
  mosaic: MosaicInfo
  mosaicUrl: string | null
}

export type EdgeState = 'idle' | 'connecting' | 'live' | 'stopped' | 'error'

export type EdgeStatus = {
  service: string
  state: EdgeState
  running: boolean
  device: string | null
  capture: string | null
  source: string | null
  model: string
  modelAvailable: boolean
  missionId: string | null
  error: string | null
}

export type MissionSummary = {
  id: string
  startedAt: string
  source: string
  duration: number
  detections: number
}

export type StartSettings = {
  source: string
  confidence: number
  iou: number
  distanceM: number
  hfovDeg: number
  record: boolean
  loop: boolean
}

export type ViewSource = { kind: 'live' } | { kind: 'demo' } | { kind: 'archive'; id: string }

export type LayerState = {
  mosaic: boolean
  trajectory: boolean
  detections: boolean
  grid: boolean
  frustum: boolean
}
