import { useEffect, useState } from 'react'
import { Check, ChevronRight, CircleDot, Crosshair, Eye, Pause, Play, Power, Radio, ScanLine, Video, X, XCircle } from 'lucide-react'
import { formatTime } from '../utils/format'
import { categoryLabel, num, ORIENTATION_LABEL } from '../utils/report'
import type { Detection, DetectionStatus, EdgeStatus, MissionData, StartSettings } from '../types'


const STATUS_LABEL: Record<DetectionStatus, string> = { nova: 'Nova', 'em análise': 'Em análise', confirmada: 'Confirmada', descartada: 'Descartada' }

export function EvidenceFrame({ detection, compact = false }: { detection: Detection; compact?: boolean }) {
  return <div className={compact ? 'evidence compact' : 'evidence'}>
    <img src={detection.frameUrl} alt={`Frame da ocorrência ${detection.id}`} />
    <div className="bbox" style={{ left: `${detection.bbox.x}%`, top: `${detection.bbox.y}%`, width: `${detection.bbox.width}%`, height: `${detection.bbox.height}%` }}>
      <span>{Math.round(detection.confidence * 100)}%</span>
    </div>
  </div>
}

export function CameraFeed({ status, liveUrl, data, selected }: { status: EdgeStatus | null; liveUrl: string | null; data: MissionData; selected: Detection | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [liveUrl])
  const streaming = Boolean(liveUrl) && !failed
  const t = data.telemetry
  return <section className="card feed">
    <header className="card-head">
      <span><Video size={14} /> {streaming ? 'Câmera do drone' : 'Evidência'}</span>
      {streaming ? <b className="rec"><i /> AO VIVO</b> : <b>{selected?.id ?? '—'}</b>}
    </header>
    <div className="feed-frame">
      {streaming && liveUrl && <img src={liveUrl} alt="Transmissão ao vivo da câmera" onError={() => setFailed(true)} />}
      {!streaming && selected && <EvidenceFrame detection={selected} />}
      {!streaming && !selected && <div className="feed-empty"><ScanLine size={22} /><span>{status?.state === 'connecting' ? 'Conectando à câmera…' : 'Sem imagem'}</span></div>}
      <div className="feed-hud">
        <span>{t.resolution ?? '640×480'}</span>
        {streaming && <span>{(t.fps ?? 0).toFixed(1)} FPS · {Math.round(t.latencyMs ?? 0)} ms</span>}
      </div>
      <Crosshair className="feed-cross" size={20} />
    </div>
    <footer className="card-foot"><span>{status?.capture ? `Captura ${status.capture}` : 'ESP32-CAM'}</span><span>YOLOv8 · {status?.device ?? 'local'}</span></footer>
  </section>
}

export function EventList({ detections, selected, onSelect, time, replay }: { detections: Detection[]; selected: Detection | null; onSelect: (d: Detection) => void; time: number; replay: boolean }) {
  return <section className="card events">
    <header className="card-head"><span><CircleDot size={14} /> Ocorrências</span><em>{detections.length}</em></header>
    <div className="event-list">
      {!detections.length && <p className="empty-note">Nenhuma anomalia detectada ainda.</p>}
      {detections.map((d) => <button key={d.id} className={`event ${d.id === selected?.id ? 'active' : ''} ${replay && d.firstSeen > time ? 'future' : ''} ${d.status === 'descartada' ? 'dismissed' : ''}`} onClick={() => onSelect(d)}>
        <span className={`sev ${d.severity}`} />
        <span className="event-main"><b>{d.id}</b><small>{d.analysis ? categoryLabel(d) : formatTime(d.firstSeen)} · {d.risk ? `risco ${d.risk.level}` : `${(d.sizeM.diagonal * 100).toFixed(0)} cm`} · {STATUS_LABEL[d.status]}</small></span>
        <span className="event-conf">{Math.round(d.confidence * 100)}%</span>
        <ChevronRight size={14} />
      </button>)}
    </div>
  </section>
}

export function DetailPanel({ detection, onLocate, onReview, canReview }: { detection: Detection | null; onLocate: () => void; onReview: (status: DetectionStatus) => void; canReview: boolean }) {
  if (!detection) return <aside className="card detail empty"><ScanLine size={24} /><p>Selecione uma ocorrência para ver os detalhes.</p></aside>
  const a = detection.analysis
  const risk = detection.risk
  const history = detection.history
  const rows: [string, string][] = [
    ['Posição na superfície', `x ${num(detection.position[0], 2)} · y ${num(detection.position[1], 2)} m`],
    ['Primeira detecção', formatTime(detection.firstSeen)],
    ['Observações', `${detection.observations} frame${detection.observations > 1 ? 's' : ''}`],
    ['Origem espacial', detection.coordinateSource === 'odometry' ? 'Odometria visual' : detection.coordinateSource === 'gps' ? 'GPS' : 'Demonstração'],
  ]
  const length = a ? Math.max(a.lengthM, detection.sizeM.height, detection.sizeM.width) : detection.sizeM.diagonal
  return <aside className="card detail">
    <div className="detail-kicker"><span className={`sev ${detection.severity}`} /> {risk ? `Risco de evolução ${risk.level}` : `Severidade ${detection.severity}`}</div>
    <div className="detail-title"><h1>{a ? categoryLabel(detection) : detection.type}</h1><span className={`status-pill ${detection.status.replace(' ', '-')}`}>{STATUS_LABEL[detection.status]}</span></div>
    <p className="detail-id">{detection.id}</p>
    <EvidenceFrame detection={detection} compact />
    <div className="class-grid">
      <div><span>Abertura</span><b>{a ? (a.resolved ? `${num(a.widthMm)} mm` : `< ${num(a.resolutionMm)} mm`) : '—'}</b><small>{a ? `± ${num(a.widthUncertaintyMm)} mm` : 'sem medição'}</small></div>
      <div><span>Comprimento</span><b>{Math.round(length * 100)} cm</b><small>estimado</small></div>
      <div><span>Orientação</span><b>{a ? ORIENTATION_LABEL[a.orientation] : '—'}</b><small>{a ? `${Math.round(a.angleDeg)}°` : ''}</small></div>
      <div><span>Confiança</span><b>{num(detection.confidence * 100)}%</b><small>modelo YOLO</small></div>
    </div>
    {a && <p className="cause"><span>Causa provável</span>{a.probableCause}</p>}
    {risk && <div className={`risk ${risk.level}`}>
      <div className="risk-head"><span>Risco de evolução</span><b>{risk.score}<small>/100</small></b></div>
      <div className="risk-bar"><i style={{ width: `${risk.score}%` }} /><em style={{ left: '35%' }} /><em style={{ left: '60%' }} /></div>
      <p>{history ? (history.grew ? `Cresceu ${num(history.deltaWidthMm, 2)} mm desde ${history.missionId} (${num(history.days)} dias). Fissura ativa.` : `Sem crescimento mensurável desde ${history.missionId}.`) : 'Sem missão anterior para medir crescimento.'}</p>
    </div>}
    <dl className="facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    <div className="detail-actions">
      <button onClick={onLocate}><Eye size={14} /> Localizar</button>
      <button disabled={!canReview || detection.status === 'confirmada'} onClick={() => onReview('confirmada')}><Check size={14} /> Confirmar</button>
      <button disabled={!canReview || detection.status === 'descartada'} onClick={() => onReview('descartada')}><XCircle size={14} /> Descartar</button>
    </div>
  </aside>
}

export function Timeline({ duration, time, onSeek, playing, onToggle, detections, live, speed, onSpeed, onSelect }: { duration: number; time: number; onSeek: (t: number) => void; playing: boolean; onToggle: () => void; detections: Detection[]; live: boolean; speed: number; onSpeed: () => void; onSelect: (d: Detection) => void }) {
  const total = Math.max(duration, 1)
  const progress = Math.min(1, time / total)
  return <footer className="timeline">
    {live ? <span className="live-chip"><i /> AO VIVO</span> : <button className="play" onClick={onToggle} aria-label={playing ? 'Pausar' : 'Reproduzir'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>}
    <span className="time">{formatTime(time)}</span>
    <div className="track">
      <input type="range" min={0} max={total} step={0.1} value={Math.min(time, total)} disabled={live} onChange={(e) => onSeek(Number(e.target.value))} style={{ '--p': `${progress * 100}%` } as React.CSSProperties} aria-label="Tempo da missão" />
      {detections.map((d) => <button key={d.id} className={`tick ${d.severity}`} style={{ left: `${Math.min(1, d.firstSeen / total) * 100}%` }} title={`${d.id} · ${formatTime(d.firstSeen)}`} onClick={() => onSelect(d)} />)}
    </div>
    <span className="time muted">{formatTime(duration)}</span>
    {!live && <button className="speed" onClick={onSpeed}>{speed}×</button>}
  </footer>
}

const SETTINGS_KEY = 'aegis.settings'
const DEFAULT_SETTINGS: StartSettings = { source: '192.168.1.33', confidence: 0.03, iou: 0.45, distanceM: 0.6, hfovDeg: 62, record: true, loop: false }

function loadSettings(): StartSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: StartSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}

export function ControlSheet({ open, onClose, status, online, busy, error, onStart, onStop }: { open: boolean; onClose: () => void; status: EdgeStatus | null; online: boolean; busy: boolean; error: string | null; onStart: (s: StartSettings) => void; onStop: () => void }) {
  const [settings, setSettings] = useState<StartSettings>(loadSettings)
  const running = Boolean(status?.running)
  const update = <K extends keyof StartSettings>(key: K, value: StartSettings[K]) => setSettings((current) => ({ ...current, [key]: value }))
  const submit = () => {
    saveSettings(settings)
    onStart(settings)
  }
  if (!open) return null
  const footprintW = 2 * settings.distanceM * Math.tan(settings.hfovDeg * Math.PI / 360)
  return <div className="sheet-backdrop" onClick={onClose}>
    <section className="sheet" onClick={(e) => e.stopPropagation()} aria-label="Controle do drone">
      <header className="sheet-head"><div><strong>Controle da captura</strong><span>{online ? 'Edge Python conectado' : 'Backend offline'}</span></div><button onClick={onClose} aria-label="Fechar"><X size={16} /></button></header>
      {!online && <div className="notice">Inicie o backend: <code>cd backend</code> e <code>.venv\Scripts\python -m uvicorn app:app --port 8000</code></div>}
      <label className="field"><span>Fonte de vídeo</span><input value={settings.source} onChange={(e) => update('source', e.target.value)} placeholder="IP da ESP32-CAM, URL, 0 ou caminho do vídeo" disabled={running} /></label>
      <div className="chips">
        <button onClick={() => update('source', '192.168.1.33')} disabled={running}>ESP32-CAM</button>
        <button onClick={() => update('source', '0')} disabled={running}>Webcam</button>
        <button onClick={() => { update('source', 'data/voo-simulado.mp4'); update('loop', true) }} disabled={running}>Voo simulado</button>
      </div>
      <label className="field range"><span>Confiança mínima <b>{Math.round(settings.confidence * 100)}%</b></span><input type="range" min={0.01} max={0.95} step={0.01} value={settings.confidence} onChange={(e) => update('confidence', Number(e.target.value))} disabled={running} /></label>
      <div className="field-row">
        <label className="field"><span>Distância da parede (m)</span><input type="number" min={0.1} step={0.05} value={settings.distanceM} onChange={(e) => update('distanceM', Number(e.target.value))} disabled={running} /></label>
        <label className="field"><span>FOV horizontal (°)</span><input type="number" min={20} max={160} step={1} value={settings.hfovDeg} onChange={(e) => update('hfovDeg', Number(e.target.value))} disabled={running} /></label>
      </div>
      <p className="hint">Cada frame cobre ≈ {(footprintW * 100).toFixed(0)} × {(footprintW * 75).toFixed(0)} cm da parede. Esse valor define a escala do mosaico e das medidas.</p>
      <label className="toggle"><input type="checkbox" checked={settings.record} onChange={(e) => update('record', e.target.checked)} disabled={running} /><span>Gravar vídeo bruto da missão</span></label>
      <label className="toggle"><input type="checkbox" checked={settings.loop} onChange={(e) => update('loop', e.target.checked)} disabled={running} /><span>Repetir arquivo de vídeo</span></label>
      {(error || status?.error) && <div className="notice error">{error ?? status?.error}</div>}
      <dl className="sheet-status">
        <div><dt>Estado</dt><dd>{status?.state ?? '—'}</dd></div>
        <div><dt>Modelo</dt><dd>{status ? `${status.model}${status.modelAvailable ? '' : ' (ausente)'}` : '—'}</dd></div>
        <div><dt>Dispositivo</dt><dd>{status?.device ?? '—'}</dd></div>
      </dl>
      {running
        ? <button className="sheet-main stop" onClick={onStop} disabled={busy}><Power size={15} /> Encerrar missão</button>
        : <button className="sheet-main" onClick={submit} disabled={busy || !online}><Radio size={15} /> Iniciar missão</button>}
    </section>
  </div>
}
