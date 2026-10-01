// Utilitarios da aba Agenda: fuso do estabelecimento, intervalos em minutos, layout de colunas.
import { ApiError } from '../../../lib/api'
import { addDays, dateBr, MONTHS, monthRange, startOfWeek, timeToMinutes } from '../../../lib/format'
import type { Agendamento, Conflito, Pagamento } from '../../../types'
import type { DiaVisao, Filtros, ListaPeriodo, View } from './types'

/** pixels por minuto na grade de horarios (1h = 84px) */
export const PX_PER_MIN = 1.4
/** encaixe da grade e do arrastar (minutos) */
export const SNAP = 15

export interface Intervalo {
  inicio: number
  fim: number
}

// ---------- fuso horario ----------

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string) {
  let f = fmtCache.get(tz)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    } catch {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    }
    fmtCache.set(tz, f)
  }
  return f
}

/** ISO (UTC) -> data "YYYY-MM-DD" e minutos do dia no fuso do estabelecimento */
export function localParts(iso: string | Date, tz: string) {
  const parts = formatter(tz).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00'
  let h = Number(get('hour'))
  if (h === 24) h = 0
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: h * 60 + Number(get('minute')) }
}

/** Recorta um periodo UTC ao dia informado, em minutos do dia local. */
export function clipToDay(inicio: string, fim: string, date: string, tz: string): Intervalo | null {
  const a = localParts(inicio, tz)
  const b = localParts(fim, tz)
  if (a.date > date || b.date < date) return null
  const s = a.date < date ? 0 : a.minutes
  const e = b.date > date ? 1440 : b.minutes
  return e > s ? { inicio: s, fim: e } : null
}

export function formatLocal(iso: string, tz: string) {
  const p = localParts(iso, tz)
  return `${dateBr(p.date)} ${minutesStr(p.minutes)}`
}

export function minutesStr(m: number) {
  const v = Math.max(0, Math.min(1440, Math.round(m)))
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}

// ---------- intervalos ----------

export function faixaToMin(f: { inicio: string; fim: string }): Intervalo {
  const inicio = timeToMinutes(f.inicio)
  let fim = timeToMinutes(f.fim)
  if (fim <= inicio) fim = 1440
  return { inicio, fim }
}

export function mergeIntervals(list: Intervalo[]): Intervalo[] {
  const sorted = [...list].filter((i) => i.fim > i.inicio).sort((a, b) => a.inicio - b.inicio)
  const out: Intervalo[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (last && i.inicio <= last.fim) last.fim = Math.max(last.fim, i.fim)
    else out.push({ ...i })
  }
  return out
}

/** Distribui itens sobrepostos em faixas lado a lado. */
export function layoutLanes<T extends { start: number; end: number }>(items: T[]): Array<T & { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const result: Array<T & { lane: number; lanes: number }> = []
  let cluster: Array<T & { lane: number; lanes: number }> = []
  let laneEnds: number[] = []
  let clusterEnd = -1
  const flush = () => {
    const lanes = Math.max(1, laneEnds.length)
    cluster.forEach((c) => (c.lanes = lanes))
    result.push(...cluster)
    cluster = []
    laneEnds = []
  }
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= it.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(it.end)
    } else laneEnds[lane] = it.end
    cluster.push({ ...it, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, it.end)
  }
  flush()
  return result
}

/** Faixa de horas exibida na grade: do inicio mais cedo ao fim mais tarde (arredondado a hora cheia). */
export function computeRange(dias: DiaVisao[], extras: Intervalo[]): Intervalo {
  let min = Infinity
  let max = -Infinity
  const consider = (i: Intervalo) => {
    min = Math.min(min, i.inicio)
    max = Math.max(max, i.fim)
  }
  for (const d of dias) {
    if (d.funcionamento) consider(faixaToMin(d.funcionamento))
    for (const p of d.profissionais) {
      p.janelas.forEach((j) => consider(faixaToMin(j)))
      p.pausas.forEach((j) => consider(faixaToMin(j)))
    }
  }
  extras.forEach(consider)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return { inicio: 8 * 60, fim: 19 * 60 }
  return { inicio: Math.max(0, Math.floor(min / 60) * 60), fim: Math.min(1440, Math.ceil(max / 60) * 60) }
}

// ---------- agendamento ----------

export function agInterval(ag: Agendamento): { start: number; fim: number; end: number } {
  const start = timeToMinutes(ag.hora)
  let fim = timeToMinutes(ag.horaFim)
  let end = timeToMinutes(ag.horaFimIntervalo)
  if (fim < start) fim = 1440
  if (end < fim) end = 1440
  return { start, fim, end }
}

export function podeReagendar(ag: Agendamento) {
  return ['AGUARDANDO_PAGAMENTO', 'CONFIRMADO'].includes(ag.status)
}

export function pagamentoPixPendente(ag: Agendamento | null | undefined): Pagamento | undefined {
  return ag?.pagamentos?.find((p) => p.status === 'PENDENTE' && (p.pixCopiaCola || p.pixQrCode))
}

export function pixSrc(qr: string) {
  return qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`
}

export function valorPago(ag: Agendamento) {
  return (ag.pagamentos || []).filter((p) => ['APROVADO', 'REEMBOLSADO_PARCIAL', 'REEMBOLSADO'].includes(p.status)).reduce((acc, p) => acc + p.valorBruto, 0)
}

/** Conflitos de um erro 409 com details.requerEncaixe; null se for outro erro. */
export function conflitosDoErro(err: unknown): Conflito[] | null {
  if (err instanceof ApiError && err.status === 409 && err.details?.requerEncaixe) return (err.details.conflitos || []) as Conflito[]
  return null
}

export function filtrarPorStatus(lista: Agendamento[], status: string) {
  if (!status) return lista
  return lista.filter((a) => (status === 'PENDENTE_FINALIZACAO' ? a.pendenteFinalizacao : a.status === status))
}

export function queryFiltros(f: Filtros) {
  return {
    servicoId: f.servicoId || undefined,
    mostrarCancelados: f.mostrarCancelados || f.status === 'CANCELADO' ? 'true' : undefined,
  }
}

export const STATUS_FILTRO: Array<{ key: string; label: string }> = [
  { key: '', label: 'Todos os status' },
  { key: 'AGUARDANDO_PAGAMENTO', label: 'Aguardando pagamento' },
  { key: 'CONFIRMADO', label: 'Confirmado' },
  { key: 'EM_ATENDIMENTO', label: 'Em atendimento' },
  { key: 'PENDENTE_FINALIZACAO', label: 'Pendente de finalização' },
  { key: 'CONCLUIDO', label: 'Concluído' },
  { key: 'NO_SHOW', label: 'No-show' },
  { key: 'CANCELADO', label: 'Cancelado' },
]

export const MOTIVO_FECHADO: Record<string, string> = {
  FECHADO_ROTINA: 'Fechado (rotina)',
  FECHADO_FORA_ROTINA: 'Dia fechado',
  FOLGA_SEMANAL: 'Folga',
}

// ---------- navegacao de datas ----------

export function addMonths(date: string, n: number) {
  const [y, m] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

export function shiftDate(view: View, periodo: ListaPeriodo, date: string, dir: 1 | -1) {
  const unidade = view === 'lista' ? periodo : view
  if (unidade === 'semana') return addDays(date, 7 * dir)
  if (unidade === 'mes') return addMonths(date, dir)
  if (unidade === '30d') return addDays(date, 30 * dir)
  return addDays(date, dir)
}

export function rangeLista(periodo: ListaPeriodo, date: string) {
  if (periodo === 'dia') return { de: date, ate: date }
  if (periodo === 'semana') {
    const de = startOfWeek(date)
    return { de, ate: addDays(de, 6) }
  }
  if (periodo === 'mes') {
    const r = monthRange(date)
    return { de: r.from, ate: r.to }
  }
  return { de: addDays(date, -30), ate: addDays(date, 30) }
}

export function shortDate(date: string) {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

export function monthLabel(date: string) {
  const [y, m] = date.split('-').map(Number)
  return `${MONTHS[m - 1]} de ${y}`
}
