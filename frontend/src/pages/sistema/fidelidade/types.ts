export interface FidelidadeConfig {
  fidelidadeAtiva: boolean
  pontosPorReal: number
  pontosPorAtendimento: number
}

export interface Recompensa {
  id: string
  nome: string
  tipo: 'SERVICO_GRATIS' | 'SERVICO_DESCONTO'
  servicoId: string | null
  descontoPct: number
  pontosCusto: number
  ativo: boolean
  servico?: { nome: string } | null
}

export interface Cupom {
  id: string
  codigo: string
  tipo: 'PERCENTUAL' | 'VALOR'
  valor: number
  clienteId: string | null
  validade: string | null
  limiteUsos: number | null
  usos: number
  ativo: boolean
  createdAt?: string
  cliente?: { nome: string; telefone: string } | null
}

export interface FidelidadeDados {
  config: FidelidadeConfig
  recompensas: Recompensa[]
  cupons: Cupom[]
}

export interface ClienteRef {
  id: string
  nome: string
  telefone: string
  pontos?: number
}

export interface MovimentoPontos {
  id: string
  tipo: 'GANHO' | 'USO' | 'AJUSTE'
  pontos: number
  descricao: string | null
  agendamentoId: string | null
  createdAt: string
}

export interface Extrato {
  cliente: ClienteRef
  saldo: number
  ganhos: number
  usados: number
  movimentos: MovimentoPontos[]
}

export const TIPO_MOVIMENTO: Record<MovimentoPontos['tipo'], string> = { GANHO: 'Ganho', USO: 'Uso', AJUSTE: 'Ajuste manual' }

export const pts = (n: number) => `${Number(n || 0).toLocaleString('pt-BR')} pt${Math.abs(n) === 1 ? '' : 's'}`
