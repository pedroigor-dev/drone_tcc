import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, FileText, RotateCcw, Sparkles, Square } from 'lucide-react'
import { useTypewriter } from '../hooks/useTypewriter'
import { edgeApi } from '../services/edgeApi'
import { formatTime } from '../utils/format'
import { categoryLabel, num, rulesReport } from '../utils/report'
import type { AssistantInfo, Detection, EdgeStatus, MissionData } from '../types'

type Entry = { key: string; t: number; text: string; tone?: 'alert' | 'info' | 'done' }

function buildDiary(data: MissionData, status: EdgeStatus | null, time: number, following: boolean): Entry[] {
  if (!data.mission) return []
  const entries: Entry[] = [{ key: 'start', t: 0, tone: 'info', text: `Missão ${data.mission.id} iniciada. Fonte de vídeo: ${data.mission.source}.` }]
  const distance = data.telemetry.distanceM
  const footprint = data.telemetry.footprintM
  if (distance && footprint) entries.push({ key: 'scale', t: 0.01, text: `Escala calibrada para ${num(distance, 2)} m da parede: cada frame cobre ${Math.round(footprint[0] * 100)} × ${Math.round(footprint[1] * 100)} cm e cada pixel vale ≈ ${num(footprint[0] * 1000 / 640)} mm.` })
  const ordered = [...data.detections].sort((a, b) => a.firstSeen - b.firstSeen)
  for (const d of ordered) {
    entries.push({ key: `det-${d.id}`, t: d.firstSeen, tone: 'alert', text: `${d.id} detectada em x ${num(d.position[0], 2)} m · y ${num(d.position[1], 2)} m, confiança do modelo ${num(d.confidence * 100)}%.` })
    if (d.analysis) {
      const a = d.analysis
      const width = a.resolved ? `${num(a.widthMm)} ± ${num(a.widthUncertaintyMm)} mm` : `abaixo de ${num(a.resolutionMm)} mm`
      entries.push({ key: `cls-${d.id}-${a.category}-${d.risk?.level}`, t: d.firstSeen + 0.01, text: `${d.id} classificada como ${a.category} (${width}), orientação ${a.orientation}. Risco de evolução ${d.risk?.level ?? 'indefinido'} (${d.risk?.score ?? '—'}/100).` })
    }
    if (d.history) entries.push({ key: `hist-${d.id}-${d.history.grew}`, t: d.firstSeen + 0.02, tone: d.history.grew ? 'alert' : 'done', text: d.history.grew ? `${d.id} cresceu desde ${d.history.missionId}: +${num(d.history.deltaWidthMm, 2)} mm de abertura. Fissura ativa.` : `${d.id} comparada com ${d.history.missionId}: sem crescimento mensurável.` })
  }
  const ended = following ? status?.state === 'stopped' : Boolean(data.mission.endedAt) && time >= data.duration - 0.05
  if (ended) entries.push({ key: 'end', t: data.duration, tone: 'done', text: `Missão encerrada com ${data.detections.length} ocorrência${data.detections.length === 1 ? '' : 's'} e ${num(data.telemetry.coveredAreaM2 ?? 0, 2)} m² de superfície registrada.` })
  return following ? entries : entries.filter((entry) => entry.t <= time + 0.001)
}

function DiaryLine({ entry, animate }: { entry: Entry; animate: boolean }) {
  const { text, typing } = useTypewriter(entry.text, animate, 90)
  return <li className={`diary-line ${entry.tone ?? ''}`}><time>{formatTime(entry.t)}</time><p>{text}{typing && <i className="caret" />}</p></li>
}

export function AssistantPanel({ data, status, time, following, selected, online }: { data: MissionData; status: EdgeStatus | null; time: number; following: boolean; selected: Detection | null; online: boolean }) {
  const [info, setInfo] = useState<AssistantInfo | null>(null)
  const [report, setReport] = useState('')
  const [reportFor, setReportFor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (!online) { setInfo(null); return }
    edgeApi.assistant().then(setInfo).catch(() => setInfo(null))
  }, [online])

  const entries = useMemo(() => buildDiary(data, status, time, following), [data, status, time, following])
  const lastKey = entries[entries.length - 1]?.key

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [lastKey, entries.length])
  useEffect(() => () => abort.current?.abort(), [])

  const typed = useTypewriter(report, true, 75)
  const reportRef = useRef<HTMLDivElement>(null)
  useEffect(() => { reportRef.current?.scrollTo({ top: reportRef.current.scrollHeight }) }, [typed.text])
  const reportKey = selected ? `${data.mission?.id}-${selected.id}` : null

  const generate = async () => {
    if (!selected) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setReport('')
    setReportFor(reportKey)
    setLoading(true)
    try {
      if (!online) throw new Error('offline')
      const body = data.mission?.id?.startsWith('INSP-') ? { missionId: data.mission.id, detectionId: selected.id, detection: selected, mission: data.mission } : { detection: selected, mission: data.mission }
      await edgeApi.streamReport(body, setReport, controller.signal)
    } catch {
      if (!controller.signal.aborted) setReport(rulesReport(selected, data.mission))
    } finally {
      if (abort.current === controller) setLoading(false)
    }
  }

  const stop = () => { abort.current?.abort(); setLoading(false) }
  const providerLabel = info?.provider === 'ollama' ? `Ollama · ${info.model}` : info?.provider === 'huggingface' ? `Hugging Face · ${info.model.split('/').pop()}` : 'Modelo de regras local'
  const showReport = reportFor === reportKey && report

  return <div className="assistant">
    <section className="assistant-block report-block">
      <header><span><Sparkles size={14} /> Laudo da ocorrência</span><b className={`provider ${info?.provider ?? 'regras'}`}><Bot size={12} /> {providerLabel}</b></header>
      {selected ? <>
        <div className="report-target"><span className={`sev ${selected.severity}`} /><b>{selected.id}</b><small>{categoryLabel(selected)} · risco {selected.risk?.level ?? '—'}</small></div>
        <div ref={reportRef} className={`report-text ${showReport ? '' : 'placeholder'}`}>
          {showReport ? <p>{typed.text}{(typed.typing || loading) && <i className="caret" />}</p> : <p>Gere um laudo em linguagem natural a partir das medições desta ocorrência. O texto usa apenas os dados calculados pelo sistema.</p>}
        </div>
        <div className="report-actions">
          {loading ? <button onClick={stop}><Square size={13} /> Parar</button> : <button className="primary" onClick={generate}>{showReport ? <><RotateCcw size={13} /> Gerar novamente</> : <><FileText size={13} /> Gerar laudo</>}</button>}
        </div>
      </> : <p className="muted-note">Selecione uma ocorrência para gerar o laudo.</p>}
    </section>
    <section className="assistant-block diary-block">
      <header><span><Bot size={14} /> Diário da missão</span><em>{entries.length}</em></header>
      <ol ref={listRef} className="diary">
        {!entries.length && <li className="muted-note">Os eventos da missão aparecem aqui em tempo real.</li>}
        {entries.map((entry) => <DiaryLine key={entry.key} entry={entry} animate={entry.key === lastKey} />)}
      </ol>
    </section>
  </div>
}
