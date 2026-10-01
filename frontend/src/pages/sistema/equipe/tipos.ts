import type { CSSProperties } from 'react'

export interface UsuarioVinculado {
  id: string
  email: string
  perfil: 'DONO' | 'RECEPCAO' | 'PROFISSIONAL'
  ativo: boolean
}

export interface ProfissionalBase {
  id: string
  nome: string
  telefone: string | null
  email: string | null
  cor: string
  ativo: boolean
  remuneracaoTipo: 'COMISSAO' | 'FIXO'
  comissaoPct: number
  valorFixo: number
  metaServicosMes: number
  metaValorMes: number
  googleConectado: boolean
  googleEmail: string | null
  googleSyncEm: string | null
  usuario: UsuarioVinculado | null
}

export interface ProfissionalLista extends ProfissionalBase {
  indicadoresMes: {
    ocupacao: number
    servicos: number
    faturamento: number
    progressoMetaServicos: number
    progressoMetaValor: number
  }
}

export interface Pausa {
  inicio: string
  fim: string
}

export interface JornadaDia {
  diaSemana: number
  trabalha: boolean
  inicio: string
  fim: string
  pausas: Pausa[]
}

export interface Ausencia {
  id: string
  inicio: string
  fim: string
  motivo: string | null
  createdAt: string
}

export interface ProfissionalDetalhe extends ProfissionalBase {
  jornada: JornadaDia[]
  ausencias: Ausencia[]
  servicoIds: string[]
  googleConfigurado: boolean
}

export interface Convite {
  email: string
  senhaTemporaria: string
  enviadoWhatsApp?: boolean
}

export interface Resultados {
  periodo: { de: string; ate: string }
  taxaOcupacao: number
  servicosRealizados: number
  faturamento: number
  remuneracao?: {
    remuneracaoTipo: 'COMISSAO' | 'FIXO'
    comissaoPct: number
    valorFixo: number
    servicosRealizados: number
    baseServicos: number
    valor: number
    paga: boolean
    pagaEm: string | null
  }
  meta: {
    servicos: { meta: number; realizado: number; progresso: number }
    valor: { meta: number; realizado: number; progresso: number }
  }
}

export const CORES = ['#007f64', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#0891b2', '#475569']

export function iniciais(nome: string | null | undefined) {
  const partes = String(nome || '?').trim().split(/\s+/)
  return ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase() || '?'
}

/** Variável CSS com a cor do profissional (usada por .eq-avatar e .eq-card). */
export function corVar(cor: string | null | undefined): CSSProperties {
  return { '--eq-cor': cor || '#007f64' } as CSSProperties
}
