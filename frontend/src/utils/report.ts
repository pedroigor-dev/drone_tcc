import type { Detection, MissionInfo } from '../types'

export const num = (value: number, digits = 1) => value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const ORIENTATION_LABEL: Record<string, string> = { vertical: 'Vertical', horizontal: 'Horizontal', diagonal: 'Diagonal', mapeada: 'Mapeada' }

export function categoryLabel(detection: Detection) {
  const category = detection.analysis?.category
  if (!category) return 'Pendente'
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export function rulesReport(detection: Detection, mission: MissionInfo | null) {
  const a = detection.analysis
  const r = detection.risk
  const h = detection.history
  const parts = [`A ocorrência ${detection.id}${mission ? ` da missão ${mission.id}` : ''} foi detectada com ${num(detection.confidence * 100)}% de confiança, observada em ${detection.observations} frames.`]
  if (a) {
    parts.push(a.resolved
      ? `A abertura estimada é de ${num(a.widthMm)} mm, com incerteza de ±${num(a.widthUncertaintyMm)} mm, o que a enquadra como ${a.category}.`
      : `A abertura está abaixo da resolução da câmera (cerca de ${num(a.resolutionMm)} mm por pixel), então o sistema só consegue afirmar que se trata de ${a.category}.`)
    parts.push(`A orientação predominante é ${a.orientation}, com cerca de ${Math.round(a.angleDeg)} graus, padrão associado a: ${a.probableCause.toLowerCase()}.`)
  } else {
    parts.push('Não foi possível medir a abertura nesta imagem, então a classificação técnica ficou pendente.')
  }
  if (r) parts.push(`O índice de risco de evolução ficou em ${r.score} de 100, nível ${r.level}, considerando ${r.factors.join(', ')}.`)
  if (h) {
    parts.push(h.grew
      ? `Em relação à missão ${h.missionId}, feita ${num(h.days)} dias antes, a abertura variou ${num(h.deltaWidthMm, 2)} mm e a extensão ${Math.round(h.deltaLengthM * 100)} cm, acima da tolerância de medição, o que indica fissura ativa.`
      : `Comparada à missão ${h.missionId}, a variação ficou dentro da tolerância de medição, sem crescimento mensurável.`)
  } else {
    parts.push('Ainda não há missão anterior no mesmo trecho para medir se ela está crescendo.')
  }
  parts.push('O índice é indicativo e calculado por regras; a confirmação da causa e da gravidade exige vistoria de um engenheiro.')
  return parts.join(' ')
}
