import type { Agendamento, Cliente } from '../../../types'

export type Segmento = 'ATIVO' | 'RETORNO_PROXIMO' | 'RETORNO_ATRASADO' | 'INATIVO'

export interface ClientesResposta {
  total: number
  pagina: number
  porPagina: number
  contagem: Record<Segmento, number>
  clientes: Cliente[]
}

export interface MovimentoPontos {
  id: string
  tipo: 'GANHO' | 'USO' | 'AJUSTE'
  pontos: number
  descricao: string | null
  agendamentoId: string | null
  createdAt: string
}

export interface FichaCliente {
  cliente: Cliente & { updatedAt?: string }
  segmento: { segmento: Segmento; ultimoAtendimento: string | null; retornoSugerido: string | null } | null
  indicadores: {
    totalGasto: number
    visitas: number
    frequenciaDias: number | null
    noShows: number
    cancelamentos: number
    ultimoAtendimento: string | null
    proximoRetorno: string | null
  }
  historico: Agendamento[]
  fidelidade: { saldo: number; extrato: MovimentoPontos[] } | null
}

export const SEGMENTO_BADGE: Record<string, string> = {
  ATIVO: 'badge-success',
  RETORNO_PROXIMO: 'badge-info',
  RETORNO_ATRASADO: 'badge-warning',
  INATIVO: 'badge-gray',
}

export const TIPO_MOVIMENTO: Record<string, string> = { GANHO: 'Ganho', USO: 'Resgate', AJUSTE: 'Ajuste' }

export function iniciais(nome: string | null | undefined) {
  const partes = String(nome || '?').trim().split(/\s+/)
  return ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase() || '?'
}

/** Data (ISO ou YYYY-MM-DD) em dd/mm/aaaa sem deslocamento de fuso para datas puras. */
export function dataCurta(value: string | null | undefined) {
  if (!value) return '—'
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-')
    return `${d}/${m}/${y}`
  }
  return new Date(s).toLocaleDateString('pt-BR')
}

export function retornoAtrasado(value: string | null | undefined) {
  if (!value) return false
  return new Date(value).getTime() < Date.now()
}
