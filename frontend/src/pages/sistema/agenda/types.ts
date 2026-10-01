// Tipos locais da aba Agenda (respostas de /api/agenda/*).
import type { Agendamento, Pagamento, Produto, ProfissionalRef, ServicoRef } from '../../../types'

export type View = 'dia' | 'semana' | 'mes' | 'lista'
export type ListaFiltro = 'todos' | 'pendentes' | 'aguardando'
export type ListaPeriodo = 'dia' | 'semana' | 'mes' | '30d'
export type SemanaModo = 'um' | 'todos'

export interface Faixa {
  inicio: string
  fim: string
}

export type MotivoFechado = 'FECHADO_ROTINA' | 'FECHADO_FORA_ROTINA' | 'FOLGA_SEMANAL' | null

export interface ProfDia {
  profissionalId: string
  aberto: boolean
  motivo: MotivoFechado
  janelas: Faixa[]
  pausas: Faixa[]
}

export interface DiaVisao {
  data: string
  fechadoRotina: boolean
  fechadoForaRotina: { id: string; motivo: string | null } | null
  funcionamento: Faixa | null
  profissionais: ProfDia[]
}

export interface ProfVisao extends ProfissionalRef {
  somenteLeitura: boolean
}

export interface BloqueioVisao {
  id: string
  profissionalId: string
  inicio: string
  fim: string
  motivo: string | null
  semanal: boolean
  /** folga/ausencia programada (gerenciada na aba Equipe; nao removivel pela agenda) */
  ausencia?: boolean
}

export interface EventoVisao {
  id: string
  profissionalId: string
  inicio: string
  fim: string
  titulo: string
}

export interface VisaoResponse {
  de: string
  ate: string
  profissionais: ProfVisao[]
  dias: DiaVisao[]
  agendamentos: Agendamento[]
  bloqueios: BloqueioVisao[]
  eventos: EventoVisao[]
}

export interface MesResponse {
  mes: string
  dias: Array<{
    data: string
    atendimentos: number
    aguardandoPagamento: number
    fechadoRotina: boolean
    fechadoForaRotina: { id: string; motivo: string | null } | null
  }>
}

export interface Referencias {
  profissionais: ProfissionalRef[]
  servicos: ServicoRef[]
  produtos: Produto[]
  venderProdutos: boolean
  intervaloSlotsMin: number
  toleranciaPendenteMin: number
}

export interface DuracaoCalculada {
  duracaoServicos: number
  intervalos: number
  duracaoAtendimento: number
  ocupacaoTotal: number
  ultimoIntervalo: number
}

export interface HorariosResponse {
  data: string
  duracao: DuracaoCalculada
  profissionais: Array<{ profissionalId: string; nome: string; cor: string; horarios: string[]; motivo?: MotivoFechado }>
}

export interface PreviaFinalizacao {
  agendamento: Agendamento
  valorEmAberto: number
  retornoSugerido: string | null
}

export interface Afetado {
  id: string
  data: string
  hora: string
  cliente: string
  telefone: string
  servicos: string
  profissional: string
  status: string
}

export interface Filtros {
  profissionalId: string
  servicoId: string
  status: string
  mostrarCancelados: boolean
}

export interface ClienteMin {
  id: string
  nome: string
  telefone: string
  observacoes?: string | null
}

export interface NovoPrefill {
  profissionalId?: string
  data?: string
  hora?: string
  clienteId?: string
  cliente?: ClienteMin
  servicoIds?: string[]
}

export interface BloqueioPrefill {
  profissionalId?: string
  data?: string
  horaInicio?: string
}

export type { Agendamento, Pagamento }
