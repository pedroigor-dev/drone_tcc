import { useCallback, useEffect, useRef, useState } from 'react'
import { edgeApi, normalizeMission } from '../services/edgeApi'
import type { DetectionStatus, EdgeStatus, MissionData, StartSettings } from '../types'

type Connection = 'connecting' | 'online' | 'offline'

type SocketPayload = Parameters<typeof normalizeMission>[0] & { kind: string; status: EdgeStatus }

export function useEdge() {
  const [connection, setConnection] = useState<Connection>('connecting')
  const [status, setStatus] = useState<EdgeStatus | null>(null)
  const [live, setLive] = useState<MissionData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const mosaicRef = useRef({ url: null as string | null, at: 0, mission: '' })

  useEffect(() => {
    let disposed = false
    let retry: number | undefined

    const schedule = () => {
      if (!disposed) retry = window.setTimeout(connect, 3000)
    }

    const connect = async () => {
      try {
        const current = await edgeApi.status()
        if (disposed) return
        setStatus(current)
        const socket = new WebSocket(edgeApi.socketUrl())
        socketRef.current = socket
        socket.onopen = () => setConnection('online')
        socket.onmessage = (message) => {
          const payload = JSON.parse(message.data) as SocketPayload
          if (payload.kind !== 'snapshot') return
          setStatus(payload.status)
          if (!payload.mission) { setLive(null); return }
          const cache = mosaicRef.current
          const now = performance.now()
          const changedMission = cache.mission !== payload.mission.id
          if (changedMission) Object.assign(cache, { url: null, at: 0, mission: payload.mission.id })
          if (payload.mosaic?.revision && (now - cache.at > 1500 || !payload.status.running)) {
            cache.url = `/api/mosaic?r=${payload.mosaic.revision}&m=${payload.mission.id}`
            cache.at = now
          }
          setLive(normalizeMission(payload, cache.url))
        }
        socket.onclose = () => {
          socketRef.current = null
          if (disposed) return
          setConnection('offline')
          schedule()
        }
      } catch {
        if (disposed) return
        setConnection('offline')
        schedule()
      }
    }

    connect()
    return () => {
      disposed = true
      window.clearTimeout(retry)
      socketRef.current?.close()
    }
  }, [])

  const run = useCallback(async (action: () => Promise<EdgeStatus>) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await action())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  const start = useCallback((settings: StartSettings) => run(() => edgeApi.start(settings)), [run])
  const stop = useCallback(() => run(() => edgeApi.stop()), [run])
  const review = useCallback(async (id: string, value: DetectionStatus) => {
    try {
      await edgeApi.setStatus(id, value)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  return { connection, status, live, busy, error, start, stop, review }
}
