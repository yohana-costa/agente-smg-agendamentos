import { get } from '../../../lib/api'

export interface ItemServicoDesempenho {
  servicoId: string
  nome: string
  quantidade: number
  faturamento: number
  duracaoInformada: number
  duracaoRealMedia: number | null
}

export interface DesempenhoResp {
  periodo: { de: string; ate: string }
  capacidade: {
    taxaOcupacao: number
    horasDisponiveis: number
    horasOcupadas: number
    porProfissional: Array<{ profissionalId: string; nome: string; disponiveis: number; ocupados: number; taxa: number }>
    porDiaSemana: Array<{ diaSemana: number; disponiveis: number; ocupados: number; taxa: number }>
    porFaixaHorario: Array<{ faixa: string; horasOcupadas: number }>
    capacidadeServicos: number
    metaServicos: number
    servicosRealizados: number
    horasPerdidasNoShow: number
    diasFechadosForaRotina: number
    horasPerdidasFechamento: number
    horasOciosas: number
  }
  comparecimento: {
    total: number
    noShows: number
    taxaNoShow: number
    cancelamentos: number
    taxaCancelamento: number
    expiradosSemPagamento: number
  }
  clientes: {
    atendidos: number
    novos: number
    recorrentes: number
    taxaRecorrencia: number
    retornoAtrasado: number
    inativos: number
  }
  servicos: {
    maisRealizados: ItemServicoDesempenho[]
    maisFaturam: ItemServicoDesempenho[]
    duracao: ItemServicoDesempenho[]
  }
  produtos: {
    maisVendidos: Array<{ produtoId: string; nome: string; quantidade: number; faturamento: number }>
    faturamento: number
  } | null
  profissionais: Array<{ profissionalId: string; nome: string; servicos: number; faturamento: number; ocupacao: number }>
  receita: {
    faturamento: number
    atendimentos: number
    ticketMedio: number
    evolucaoMensal: Array<{ mes: string; faturamento: number; atendimentos: number }>
    origem: { SITE: number; AGENTE: number; MANUAL: number }
    procura: { diasSemana: number[]; horarios: Record<string, number> }
  }
}

export interface Referencias {
  profissionais: Array<{ id: string; nome: string }>
  servicos: Array<{ id: string; nome: string; categoria: string | null }>
}

/** Profissionais e serviços para os filtros, com fallback quando o perfil não acessa a agenda. */
export async function carregarReferencias(): Promise<Referencias> {
  try {
    const r = await get<Referencias>('/agenda/referencias')
    return { profissionais: r.profissionais || [], servicos: r.servicos || [] }
  } catch {
    const [servicos, profissionais] = await Promise.all([
      get<Array<{ id: string; nome: string; categoria: string | null; ativo: boolean }>>('/servicos').catch(() => []),
      get<Array<{ id: string; nome: string }>>('/equipe').catch(() => []),
    ])
    return { profissionais: Array.isArray(profissionais) ? profissionais : [], servicos: Array.isArray(servicos) ? servicos : [] }
  }
}

/** centavos -> "R$ 12,3 mil" (rótulos de gráfico) */
export function brlCompacto(cents: number) {
  const reais = cents / 100
  if (Math.abs(reais) >= 1000) return `R$ ${(reais / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return `R$ ${Math.round(reais).toLocaleString('pt-BR')}`
}

export function horas(h: number) {
  return `${Number(h || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
}
