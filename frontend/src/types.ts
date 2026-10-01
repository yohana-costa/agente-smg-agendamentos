// Tipos compartilhados. Valores monetarios sao inteiros em centavos.

export type Aba =
  | 'visao-geral'
  | 'agenda'
  | 'clientes'
  | 'servicos'
  | 'equipe'
  | 'financeiro'
  | 'desempenho'
  | 'atendimento'
  | 'fidelidade'
  | 'agentes'
  | 'automacoes'
  | 'configuracoes'

export type Perfil = 'DONO' | 'RECEPCAO' | 'PROFISSIONAL'

export interface Permissoes {
  abas: Aba[]
  verFinanceiroVisaoGeral?: boolean
  financeiroCompleto?: boolean
  verAgendaColegas?: boolean
}

export interface UsuarioSessao {
  id: string
  nome: string
  email: string
  perfil: Perfil
  profissionalId: string | null
  permissoes: Permissoes
  tenant: { id: string; nome: string; slug: string; timezone: string; venderProdutos: boolean; fidelidadeAtiva: boolean }
}

export type StatusAgendamento = 'AGUARDANDO_PAGAMENTO' | 'CONFIRMADO' | 'EM_ATENDIMENTO' | 'CONCLUIDO' | 'CANCELADO' | 'NO_SHOW'

export interface Cliente {
  id: string
  nome: string
  telefone: string
  email?: string | null
  observacoes?: string | null
  pontos: number
  createdAt?: string
  segmento?: string
  ultimoAtendimento?: string | null
  retornoSugerido?: string | null
}

export interface ItemServicoAgendamento {
  id: string
  servicoId: string
  nome: string
  preco: number
  duracaoMin: number
  intervaloMin: number
  ordem: number
  duracaoRealMin: number | null
}

export interface ItemProdutoAgendamento {
  id: string
  produtoId: string
  nome: string
  quantidade: number
  precoUnit: number
  adicionadoNoAtendimento: boolean
}

export interface Pagamento {
  id: string
  status: 'PENDENTE' | 'APROVADO' | 'REEMBOLSADO' | 'REEMBOLSADO_PARCIAL' | 'CANCELADO' | 'EXPIRADO'
  modo: 'ONLINE' | 'LOCAL'
  forma: 'PIX' | 'CARTAO' | 'DINHEIRO' | 'MAQUININHA' | null
  valorBruto: number
  taxaGateway: number
  valorLiquido: number
  valorReembolsado: number
  linkPagamento: string | null
  pixCopiaCola: string | null
  pixQrCode: string | null
  pagoEm: string | null
  createdAt: string
}

/** Agendamento serializado pela API (agendamento.service.serializar) */
export interface Agendamento {
  id: string
  clienteId: string
  profissionalId: string
  inicio: string
  fim: string
  fimIntervalo: string
  data: string // YYYY-MM-DD (fuso do estabelecimento)
  hora: string // HH:mm
  horaFim: string
  horaFimIntervalo: string
  status: StatusAgendamento
  origem: 'SITE' | 'AGENTE' | 'MANUAL'
  modoPagamento: 'ONLINE' | 'LOCAL'
  valorServicos: number
  valorProdutos: number
  desconto: number
  valorTotal: number
  expiraEm: string | null
  expirado: boolean
  encaixe: boolean
  observacoes: string | null
  iniciadoEm: string | null
  finalizadoEm: string | null
  retornoSugerido: string | null
  motivoCancelamento: string | null
  pendenteFinalizacao: boolean
  situacaoPagamento: 'AGUARDANDO' | 'PAGO_ONLINE' | 'PAGO_LOCAL' | 'PAGAR_NO_LOCAL' | 'SEM_COBRANCA'
  segundosRestantesReserva: number | null
  linkPagamento: string | null
  cliente: Cliente
  profissional: { id: string; nome: string; cor: string }
  servicos: ItemServicoAgendamento[]
  produtos: ItemProdutoAgendamento[]
  pagamentos: Pagamento[]
  clienteResumo?: {
    totalVisitas: number
    noShows: number
    observacoes: string | null
    ultimoAtendimento: { data: string; servicos: string } | null
  }
}

export interface ProfissionalRef {
  id: string
  nome: string
  cor: string
}

export interface ServicoRef {
  id: string
  nome: string
  categoria: string | null
  preco: number
  duracaoMin: number
  intervaloMin: number
  profissionalIds: string[]
  produtosRelacionados: string[]
}

export interface Produto {
  id: string
  nome: string
  descricao: string | null
  estoque: number
  custo: number
  preco: number
  estoqueMinimo: number
  ativo: boolean
  estoqueBaixo?: boolean
}

export interface Servico {
  id: string
  nome: string
  categoria: string | null
  descricao: string | null
  preco: number
  duracaoMin: number
  intervaloMin: number
  retornoDias: number | null
  ativo: boolean
  profissionalIds: string[]
  produtoIds: string[]
  duracaoRealMedia: number | null
  amostrasDuracaoReal: number
}

export interface Conflito {
  tipo: string
  descricao: string
  id?: string
  motivo?: string | null
}

export interface SimulacaoReembolso {
  regra: 'DENTRO_PRAZO' | 'FORA_PRAZO' | 'NO_SHOW' | 'ESTABELECIMENTO'
  percentual: number
  valorPago: number
  valor: number
  taxaDescontada: number
  prazoLimite: string
  dentroDoPrazo: boolean
  descricao: string
}
