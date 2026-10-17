import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, ChevronDown, Crosshair, Focus, Grid3x3, Layers3, Maximize2, Radio, Route, ScanLine, Square, Video } from 'lucide-react'
import { useEdge } from './hooks/useEdge'
import { loadDemo, fallbackDemo } from './data/demoMission'
import { edgeApi } from './services/edgeApi'
import { CameraFeed, ControlSheet, DetailPanel, EventList, Timeline } from './components/Panels'
import { formatTime } from './utils/format'
import type { CameraView } from './components/InspectionScene'
import type { Detection, DetectionStatus, LayerState, MissionData, MissionSummary, Vector2, ViewSource } from './types'

const InspectionScene = lazy(() => import('./components/InspectionScene').then((module) => ({ default: module.InspectionScene })))

const EMPTY: MissionData = { mission: null, duration: 0, detections: [], path: [], telemetry: {}, mosaic: { revision: 0, width: 10, height: 6 }, mosaicUrl: null }
const LAYER_LABEL: Record<keyof LayerState, string> = { mosaic: 'Mosaico capturado', trajectory: 'Trajetória', detections: 'Ocorrências', grid: 'Grade métrica', frustum: 'Campo de visão' }

export default function App() {
  const edge = useEdge()
  const [source, setSource] = useState<ViewSource | null>(null)
  const [demo, setDemo] = useState<MissionData>(fallbackDemo)
  const [archive, setArchive] = useState<MissionData | null>(null)
  const [missions, setMissions] = useState<MissionSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [view, setView] = useState<CameraView>('inspection')
  const [fitKey, setFitKey] = useState(0)
  const [layers, setLayers] = useState<LayerState>({ mosaic: true, trajectory: true, detections: true, grid: false, frustum: true })
  const [layersOpen, setLayersOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [demoReview, setDemoReview] = useState<Record<string, DetectionStatus>>({})
  const lastInteraction = useRef(0)
  const knownIds = useRef(new Set<string>())

  useEffect(() => { loadDemo().then(setDemo) }, [])

  useEffect(() => {
    if (source || edge.connection === 'connecting') return
    setSource(edge.connection === 'online' ? { kind: 'live' } : { kind: 'demo' })
  }, [edge.connection, source])

  const refreshMissions = useCallback(() => { edgeApi.missions().then(setMissions).catch(() => setMissions([])) }, [])
  useEffect(() => { if (edge.connection === 'online') refreshMissions() }, [edge.connection, edge.status?.state, refreshMissions])

  useEffect(() => {
    if (source?.kind !== 'archive') return
    setArchive(null)
    edgeApi.mission(source.id).then(setArchive).catch(() => setSource({ kind: 'demo' }))
  }, [source])

  const isLive = source?.kind === 'live'
  const running = Boolean(edge.status?.running)
  const following = isLive && running
  const rawData = source?.kind === 'live' ? edge.live ?? EMPTY : source?.kind === 'archive' ? archive ?? EMPTY : source?.kind === 'demo' ? demo : EMPTY
  const data = useMemo(() => source?.kind === 'demo' ? { ...rawData, detections: rawData.detections.map((d) => demoReview[d.id] ? { ...d, status: demoReview[d.id] } : d) } : rawData, [rawData, source, demoReview])
  const currentTime = following ? data.duration : time
  const selected = data.detections.find((d) => d.id === selectedId) ?? null

  useEffect(() => {
    setPlaying(false)
    setSelectedId(null)
    knownIds.current = new Set()
    setFitKey((k) => k + 1)
  }, [source])

  useEffect(() => {
    if (!following) setTime(data.duration)
  }, [data.mission?.id, data.duration, following])

  useEffect(() => {
    const fresh = data.detections.filter((d) => !knownIds.current.has(d.id))
    fresh.forEach((d) => knownIds.current.add(d.id))
    if (fresh.length && following && performance.now() - lastInteraction.current > 8000) setSelectedId(fresh[0].id)
    else if (!selectedId && data.detections.length) setSelectedId(data.detections[0].id)
  }, [data.detections, following, selectedId])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const delta = (now - last) / 1000
      last = now
      setTime((current) => {
        const next = current + delta * speed
        if (next >= data.duration) { setPlaying(false); return data.duration }
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, data.duration])

  const select = (detection: Detection) => {
    lastInteraction.current = performance.now()
    setSelectedId(detection.id)
    if (!following && detection.firstSeen > time) setTime(detection.firstSeen)
    setFitKey((k) => k + 1)
  }

  const togglePlay = () => {
    if (playing) { setPlaying(false); return }
    if (time >= data.duration - 0.05) setTime(0)
    setPlaying(true)
  }

  const review = (status: DetectionStatus) => {
    if (!selected) return
    if (source?.kind === 'demo') setDemoReview((current) => ({ ...current, [selected.id]: status }))
    else edge.review(selected.id, status)
  }

  const canReview = source?.kind === 'demo' || (isLive && Boolean(data.mission))
  const footprint: Vector2 = data.telemetry.footprintM ?? [0.72, 0.54]
  const distance = data.telemetry.distanceM ?? 0.6
  const t = data.telemetry
  const coverage = t.coveredAreaM2 ?? 0
  const liveUrl = following && edge.status?.state === 'live' ? edgeApi.liveFeedUrl(edge.status.missionId) : null
  const sourceLabel = source?.kind === 'live' ? 'Ao vivo' : source?.kind === 'archive' ? 'Missão gravada' : 'Demonstração'
  const stateLabel = following ? (edge.status?.state === 'connecting' ? 'Conectando à câmera' : 'Inspeção em andamento') : data.mission ? (isLive ? 'Última missão' : 'Revisão') : 'Aguardando missão'

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="logo"><ScanLine size={16} /></span><b>Aegis</b><span>Inspeção estrutural</span></div>
      <div className="mission">
        <div className="source-menu">
          <button className="source-button" onClick={() => setMenuOpen(!menuOpen)}><span className={`dot ${source?.kind ?? 'demo'} ${following ? 'on' : ''}`} />{sourceLabel}<ChevronDown size={14} /></button>
          {menuOpen && <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
            <button disabled={edge.connection !== 'online'} onClick={() => { setSource({ kind: 'live' }); setMenuOpen(false) }}><Radio size={14} /> Ao vivo {edge.connection !== 'online' && <small>backend offline</small>}</button>
            <button onClick={() => { setSource({ kind: 'demo' }); setMenuOpen(false) }}><Box size={14} /> Demonstração</button>
            {missions.length > 0 && <div className="menu-label">Missões gravadas</div>}
            {missions.slice(0, 8).map((m) => <button key={m.id} onClick={() => { setSource({ kind: 'archive', id: m.id }); setMenuOpen(false) }}><Video size={14} /> {m.id.replace('INSP-', '')}<small>{m.detections} ocorr. · {formatTime(m.duration)}</small></button>)}
          </div>}
        </div>
        <span className="sep" />
        <span className="mission-id">{data.mission?.id ?? '—'}</span>
        <span className="sep" />
        <span className="mission-state">{stateLabel}</span>
      </div>
      <div className="actions">
        <span className={`conn ${edge.connection}`}><i />{edge.connection === 'online' ? 'Edge conectado' : edge.connection === 'connecting' ? 'Conectando' : 'Edge offline'}</span>
        <button className={`primary-btn ${running ? 'running' : ''}`} onClick={() => setSheetOpen(true)}>{running ? <><Square size={13} /> Missão ativa</> : <><Radio size={14} /> Iniciar missão</>}</button>
        <button className="icon-btn" aria-label="Tela cheia" onClick={() => document.documentElement.requestFullscreen?.()}><Maximize2 size={15} /></button>
      </div>
    </header>

    <div className="workspace">
      <aside className="rail">
        <CameraFeed status={edge.status} liveUrl={liveUrl} data={data} selected={selected} />
        <EventList detections={data.detections} selected={selected} onSelect={select} time={currentTime} replay={!following} />
      </aside>

      <section className="stage">
        <div className="stage-head">
          <div><strong>Gêmeo digital da superfície</strong><span>{data.mosaicUrl ? 'Mosaico real reconstruído a partir dos frames da câmera' : 'Evidências posicionadas sobre a parede'}</span></div>
        </div>
        <div className="stats">
          <div><span>Área coberta</span><b>{coverage.toFixed(2)}<small>m²</small></b></div>
          <div><span>Frames</span><b>{t.frames ?? 0}</b></div>
          <div><span>Inferência</span><b>{(t.fps ?? 0).toFixed(1)}<small>fps</small></b></div>
          <div><span>Latência</span><b>{Math.round(t.latencyMs ?? 0)}<small>ms</small></b></div>
          <div><span>Rastreamento</span><b className={(t.trackingQuality ?? 0) > 0.15 ? 'ok' : 'warn'}>{Math.round(Math.min(1, (t.trackingQuality ?? 0) * 2) * 100)}<small>%</small></b></div>
        </div>
        <Suspense fallback={<div className="scene-loading"><ScanLine /><span>Carregando cena</span></div>}>
          <InspectionScene data={data} time={currentTime} selected={selected} onSelect={select} layers={layers} view={view} fitKey={fitKey} live={following} distance={distance} footprint={footprint} />
        </Suspense>
        <div className="scene-tools">
          <div className="segmented">
            {([['inspection', 'Inspeção'], ['frontal', 'Frontal'], ['follow', 'Drone']] as [CameraView, string][]).map(([key, label]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => { setView(key); setFitKey((k) => k + 1) }}>{label}</button>)}
          </div>
          <button className="tool" onClick={() => { setSelectedId(null); setFitKey((k) => k + 1) }} title="Enquadrar missão"><Focus size={15} /></button>
          <button className={`tool ${layersOpen ? 'active' : ''}`} onClick={() => setLayersOpen(!layersOpen)} title="Camadas"><Layers3 size={15} /></button>
        </div>
        {layersOpen && <div className="layers">
          {(Object.keys(layers) as (keyof LayerState)[]).map((key) => <label key={key}>
            <span>{key === 'grid' ? <Grid3x3 size={13} /> : key === 'trajectory' ? <Route size={13} /> : key === 'frustum' ? <Crosshair size={13} /> : <Layers3 size={13} />}{LAYER_LABEL[key]}</span>
            <input type="checkbox" checked={layers[key]} onChange={() => setLayers((current) => ({ ...current, [key]: !current[key] }))} />
            <i />
          </label>)}
        </div>}
        <div className="scale-note">Distância de voo {distance.toFixed(2)} m · campo {Math.round(footprint[0] * 100)}×{Math.round(footprint[1] * 100)} cm</div>
      </section>

      <DetailPanel detection={selected} onLocate={() => { setView('inspection'); setFitKey((k) => k + 1) }} onReview={review} canReview={canReview} />
    </div>

    <Timeline duration={data.duration} time={currentTime} onSeek={(value) => { setPlaying(false); setTime(value) }} playing={playing} onToggle={togglePlay} detections={data.detections} live={following} speed={speed} onSpeed={() => setSpeed((s) => s === 1 ? 2 : s === 2 ? 4 : 1)} onSelect={select} />

    <ControlSheet open={sheetOpen} onClose={() => setSheetOpen(false)} status={edge.status} online={edge.connection === 'online'} busy={edge.busy} error={edge.error} onStart={(settings) => { setSource({ kind: 'live' }); edge.start(settings) }} onStop={edge.stop} />
  </main>
}
