import { useEffect, useState } from 'react'
import { inspectionGateway } from '../services/inspectionGateway'
import type { Detection, Telemetry } from '../types'

type ConnectionState = 'connecting' | 'live' | 'demo'
const demoSnapshot = inspectionGateway.getSnapshot()

export function useInspectionStream() {
  const demo = demoSnapshot
  const [detections, setDetections] = useState<Detection[]>(demo.detections)
  const [telemetry, setTelemetry] = useState<Telemetry>(demo.telemetry)
  const [connection, setConnection] = useState<ConnectionState>('connecting')

  useEffect(() => {
    let socket: WebSocket | undefined
    let disposed = false
    let retryTimer: number | undefined

    const connect = async () => {
      try {
        const response = await fetch('/api/status', { signal: AbortSignal.timeout(1400) })
        if (!response.ok) throw new Error('edge offline')
        socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/inspection`)
        socket.onopen = () => setConnection('live')
        socket.onmessage = (message) => {
          const payload = JSON.parse(message.data) as { kind: string; detections: Detection[]; telemetry: Telemetry }
          if (payload.kind !== 'snapshot') return
          // Preserve the occurrences already bundled with the project as mission
          // history while live Edge detections are added at the top of the list.
          const liveIds = new Set(payload.detections.map((detection) => detection.id))
          setDetections([
            ...payload.detections,
            ...demoSnapshot.detections.filter((detection) => !liveIds.has(detection.id)),
          ])
          setTelemetry((current) => ({ ...current, ...payload.telemetry }))
        }
        socket.onerror = () => setConnection('demo')
        socket.onclose = () => {
          if (disposed) return
          setConnection('demo')
          retryTimer = window.setTimeout(connect, 3000)
        }
      } catch {
        setConnection('demo')
        if (!disposed) retryTimer = window.setTimeout(connect, 3000)
      }
    }
    connect()
    return () => { disposed = true; window.clearTimeout(retryTimer); socket?.close() }
  }, [])

  return { ...demo, detections, telemetry, connection }
}
