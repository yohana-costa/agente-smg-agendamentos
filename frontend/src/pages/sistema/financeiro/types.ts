import { FORMA_PAGAMENTO } from '../../../lib/format'

export interface Recebimento {
  id: string
  data: string
  cliente: { id: string; nome: string; telefone: string } | null
  origem: 'SITE' | 'AGENTE' | 'MANUAL' | 'BALCAO' | 'OUTRO'
  tipo: 'SERVICO' | 'PRODUTO' | 'OUTRO'
  descricao: string | null
  modo: 'ONLINE' | 'LOCAL'
  forma: 'PIX' | 'CARTAO' | 'DINHEIRO' | 'MAQUININHA' | null
  valorBruto: number
  taxaGateway: number
  valorLiquido: number
  valorReembolsado: number
  status: 'APROVADO' | 'REEMBOLSADO' | 'REEMBOLSADO_PARCIAL'
}

export interface RecebimentosResp {
  periodo: { de: string; ate: string }
  totais: { bruto: number; taxas: number; liquido: number }
  recebimentos: Recebimento[]
}

export interface Reembolso {
  id: string
  regra: 'DENTRO_PRAZO' | 'FORA_PRAZO' | 'NO_SHOW' | 'ESTABELECIMENTO'
  percentual: number
  valor: number
  status: 'EXECUTADO' | 'FALHOU' | string
  erro: string | null
  createdAt: string
  cliente: { id: string; nome: string } | null
  agendamento: { id: string; inicio: string; servicos: Array<{ nome: string }> } | null
}

export interface Despesa {
  id: string
  data: string
  categoria: string
  descricao: string | null
  valor: number
}

export interface Comissao {
  profissionalId: string
  nome: string
  remuneracaoTipo: 'COMISSAO' | 'FIXO'
  comissaoPct: number
  valorFixo: number
  servicosRealizados: number
  baseServicos: number
  valor: number
  paga: boolean
  pagaEm: string | null
}

export interface Resultado {
  periodo: { de: string; ate: string }
  faturamento: number
  reembolsos: number
  taxas: number
  comissoes: number
  despesas: number
  resultado: number
  metaMes: { meta: number; realizado: number; progresso: number }
}

/** "Online · Pix" | "Dinheiro" | "Maquininha" | "Pix (no local)" */
export function formaLabel(modo: 'ONLINE' | 'LOCAL', forma: string | null) {
  if (modo === 'ONLINE') return `Online${forma ? ` · ${FORMA_PAGAMENTO[forma] || forma}` : ''}`
  if (forma === 'PIX') return 'Pix (QR no local)'
  return forma ? FORMA_PAGAMENTO[forma] || forma : '—'
}
