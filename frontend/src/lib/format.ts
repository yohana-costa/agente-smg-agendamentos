// Formatadores. Valores monetarios da API sao SEMPRE inteiros em centavos.

export function brl(cents: number | null | undefined) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** "49,90" | "49.90" | "R$ 1.234,56" -> centavos */
export function parseReais(value: string | number): number {
  if (typeof value === 'number') return Math.round(value * 100)
  const clean = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .trim()
  if (!clean) return 0
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean
  const n = Number(normalized)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** centavos -> "49,90" (para inputs) */
export function centsToInput(cents: number | null | undefined) {
  return (Number(cents || 0) / 100).toFixed(2).replace('.', ',')
}

export function phone(value: string | null | undefined) {
  const d = String(value || '').replace(/\D/g, '')
  const local = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return value || ''
}

/** "2026-10-01" -> "01/10/2026" */
export function dateBr(dateStr: string | null | undefined) {
  if (!dateStr) return ''
  const s = String(dateStr).slice(0, 10)
  const [y, m, d] = s.split('-')
  return d ? `${d}/${m}/${y}` : s
}

/** ISO -> "01/10/2026 14:30" no fuso do navegador */
export function dateTimeBr(iso: string | Date | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

export function timeBr(iso: string | Date | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

// ---- datas "YYYY-MM-DD" (calendario, sem fuso) ----

export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function weekdayOf(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function startOfWeek(dateStr: string) {
  return addDays(dateStr, -weekdayOf(dateStr))
}

export function monthRange(dateStr: string) {
  const [y, m] = dateStr.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { from, to }
}

export function dateLong(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${WEEKDAYS[weekdayOf(dateStr)]}, ${d} de ${MONTHS[m - 1].toLowerCase()} de ${y}`
}

export function timeToMinutes(t: string) {
  const [h, m] = String(t || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function minutesToTime(total: number) {
  const s = Math.max(0, Math.round(total))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function duration(min: number | null | undefined) {
  const m = Number(min || 0)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
}

export function countdown(seconds: number | null | undefined) {
  const s = Math.max(0, Number(seconds || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function pct(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

// ---- rotulos de dominio ----

export const STATUS_AGENDAMENTO: Record<string, string> = {
  AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
  CONFIRMADO: 'Confirmado',
  EM_ATENDIMENTO: 'Em atendimento',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  NO_SHOW: 'No-show',
  PENDENTE_FINALIZACAO: 'Pendente de finalização',
}

export const SITUACAO_PAGAMENTO: Record<string, string> = {
  AGUARDANDO: 'Aguardando pagamento',
  PAGO_ONLINE: 'Pago online',
  PAGO_LOCAL: 'Pago no local',
  PAGAR_NO_LOCAL: 'Pagar no local',
  SEM_COBRANCA: 'Sem cobrança',
}

export const ORIGEM: Record<string, string> = { SITE: 'Site', AGENTE: 'Agente', MANUAL: 'Manual', BALCAO: 'Balcão', OUTRO: 'Outro' }
export const FORMA_PAGAMENTO: Record<string, string> = { PIX: 'Pix', CARTAO: 'Cartão', DINHEIRO: 'Dinheiro', MAQUININHA: 'Maquininha' }
export const REGRA_REEMBOLSO: Record<string, string> = {
  DENTRO_PRAZO: 'Cancelamento dentro do prazo',
  FORA_PRAZO: 'Cancelamento fora do prazo',
  NO_SHOW: 'No-show',
  ESTABELECIMENTO: 'Cancelado pelo estabelecimento',
}
export const SEGMENTO_CLIENTE: Record<string, string> = {
  ATIVO: 'Ativo',
  RETORNO_PROXIMO: 'Retorno próximo',
  RETORNO_ATRASADO: 'Retorno atrasado',
  INATIVO: 'Inativo',
}

/** status efetivo considerando o alerta de pendente de finalizacao */
export function statusEfetivo(a: { status: string; pendenteFinalizacao?: boolean }) {
  return a.pendenteFinalizacao ? 'PENDENTE_FINALIZACAO' : a.status
}
