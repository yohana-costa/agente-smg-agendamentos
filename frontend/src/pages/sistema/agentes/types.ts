export type Provider = 'uazapi' | 'meta'

export interface AgenteConfig {
  id: string
  tenantId: string
  whatsappNumero: string | null
  whatsappProvider: Provider
  whatsappConfig: Record<string, string | undefined>
  atendimentoAtivo: boolean
  personaNome: string
  personaTom: string
  personaApresentacao: string
  informacoesNegocio: string
  mensagemEscalonamento: string
  numeroEscalonamento: string | null
  tempoRetornoMin: number
  gestaoAtivo: boolean
  updatedAt?: string
}

export interface PermissoesNumero {
  consultar: string[]
  alterar: string[]
}

export interface NumeroAutorizado {
  id: string
  telefone: string
  nome: string
  permissoes: PermissoesNumero
  ativo: boolean
  createdAt?: string
}

export interface AgentesDados {
  config: AgenteConfig
  whatsappConectado: boolean
  iaDisponivel: boolean
  webhook: { uazapi: string; meta: string }
  numerosAutorizados: NumeroAutorizado[]
  modulos: string[]
}

export const MODULO_LABEL: Record<string, string> = {
  agenda: 'Agenda',
  clientes: 'Clientes',
  servicos: 'Serviços',
  produtos: 'Produtos',
  equipe: 'Equipe',
  financeiro: 'Financeiro',
  desempenho: 'Desempenho',
}

export const moduloLabel = (m: string) => MODULO_LABEL[m] || m

/** Mesmo criterio do backend (normalizePhone): 10/11 digitos ganham o 55. */
export function normalizarTelefone(v: string) {
  let d = String(v || '').replace(/\D+/g, '')
  if (d.length === 10 || d.length === 11) d = `55${d}`
  return d
}

/** Campos de configuracao que nao devem ser sobrescritos com dados nao mascarados. */
export function semSegredos(c: Partial<AgenteConfig>): Partial<AgenteConfig> {
  const copia = { ...c }
  delete copia.whatsappConfig
  return copia
}
