// Tipos das respostas das rotas publicas (/publico, /portal, /checkout). Valores em centavos.

export interface EstabelecimentoPublico {
  nome: string
  slug: string
  endereco?: string | null
  telefone?: string | null
  titulo: string
  descricao?: string | null
  corPrimaria?: string | null
  logoUrl?: string | null
  bannerUrl?: string | null
}

export interface ServicoPublico {
  id: string
  nome: string
  categoria?: string | null
  descricao?: string | null
  preco: number
  duracaoMin: number
  intervaloMin: number
  profissionalIds: string[]
  produtoIds: string[]
}

export interface ProfissionalPublico {
  id: string
  nome: string
  cor?: string | null
}

export interface ProdutoPublico {
  id: string
  nome: string
  descricao?: string | null
  preco: number
  disponivel: boolean
  estoque: number
}

export interface SitePublico {
  estabelecimento: EstabelecimentoPublico
  servicos: ServicoPublico[]
  profissionais: ProfissionalPublico[]
  venderProdutos: boolean
  produtos: ProdutoPublico[]
  fidelidadeAtiva: boolean
  politica: { texto: string; prazoCancelamentoMin: number; reembolsoForaPrazoPct: number; reembolsoNoShowPct: number }
  reservaMinutos: number
  /** false quando o estabelecimento ainda nao ligou o pagamento online */
  pagamentoOnline?: boolean
}

export interface HorariosResposta {
  data: string
  profissionais: Array<{ profissionalId: string; nome: string; cor?: string | null; horarios: string[]; motivo?: string }>
}

export interface ReservaResposta {
  agendamentoId?: string
  vendaId?: string
  status?: string
  valorTotal: number
  expiraEm: string | null
  pagamentoId: string | null
  linkPagamento: string | null
}

export type StatusPagamento = 'PENDENTE' | 'APROVADO' | 'REEMBOLSADO' | 'REEMBOLSADO_PARCIAL' | 'CANCELADO' | 'EXPIRADO'

export interface CheckoutInfo {
  id: string
  status: StatusPagamento
  valor: number
  forma: string | null
  modoGateway: 'simulado' | 'mercadopago'
  expiraEm: string | null
  segundosRestantes: number | null
  pix: { copiaCola: string; qrCodeBase64: string | null } | null
  estabelecimento: { nome: string; slug: string; corPrimaria?: string | null; logoUrl?: string | null; endereco?: string | null }
  cliente: { nome: string } | null
  agendamento: {
    status: string
    data: string
    hora: string
    profissional?: string | null
    servicos: Array<{ nome: string; preco: number }>
    produtos: Array<{ nome: string; quantidade: number; precoUnit: number }>
    desconto: number
  } | null
  venda: { status: string; itens: Array<{ nome: string; quantidade: number; precoUnit: number }>; retiradaNoLocal: boolean } | null
}

// ---------- portal ----------

export interface PortalMe {
  cliente: { nome: string; telefone: string; email: string | null; pontos: number }
  estabelecimento: { nome: string; slug: string; corPrimaria?: string | null; logoUrl?: string | null; fidelidadeAtiva: boolean }
}

export interface AgendamentoPortal {
  id: string
  data: string
  hora: string
  horaFim: string
  status: string
  servicos: Array<{ nome: string; preco: number }>
  produtos: Array<{ nome: string; quantidade: number; precoUnit: number }>
  profissional?: string | null
  valorTotal: number
  situacaoPagamento: string
  linkPagamento: string | null
  segundosRestantesReserva: number | null
}

export interface CalculoReembolso {
  regra: 'DENTRO_PRAZO' | 'FORA_PRAZO' | 'NO_SHOW' | 'ESTABELECIMENTO'
  percentual: number
  valorPago: number
  valor: number
  taxaDescontada: number
  prazoLimite: string
  dentroDoPrazo: boolean
  descricao: string
}

export interface SimulacaoReagendamento {
  mantemPagamento: boolean
  exigeNovoPagamento: boolean
  descricao: string
  reembolso?: CalculoReembolso
}

export interface PontosResposta {
  ativo: boolean
  saldo?: number
  movimentos?: Array<{ id: string; tipo: 'GANHO' | 'USO' | 'AJUSTE'; pontos: number; descricao: string | null; createdAt: string }>
  recompensas?: Array<{
    id: string
    nome: string
    tipo: 'SERVICO_GRATIS' | 'SERVICO_DESCONTO'
    descontoPct: number
    pontosCusto: number
    servico?: { nome: string } | null
    disponivel: boolean
  }>
}
