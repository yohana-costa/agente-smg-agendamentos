import type { Agendamento } from '../../../types'

export type AutorMensagem = 'CLIENTE' | 'AGENTE' | 'HUMANO' | 'SISTEMA'
export type StatusConversa = 'ATIVO' | 'PAUSADO' | 'ESCALONADO'
export type CanalConversa = 'ATENDIMENTO' | 'GESTAO'

export interface Mensagem {
  id: string
  conversaId: string
  autor: AutorMensagem
  texto: string
  createdAt: string
}

export interface ConversaResumo {
  id: string
  canal: CanalConversa
  telefone: string
  nome: string
  clienteId: string | null
  status: StatusConversa
  pausadoAte: string | null
  segundosParaRetorno: number | null
  escalonamentoPendente: boolean
  motivoEscalonamento: string | null
  escalonadoEm: string | null
  ultimaMensagemEm: string
  ultimaMensagem: { autor: AutorMensagem; texto: string } | null
}

export interface ConversaDetalhe {
  conversa: ConversaResumo
  cliente: { id: string; nome: string; telefone: string; observacoes: string | null } | null
  mensagens: Mensagem[]
  agendamentos: Agendamento[]
}

export const AUTOR_LABEL: Record<AutorMensagem, string> = {
  CLIENTE: 'Cliente',
  AGENTE: 'Agente de IA',
  HUMANO: 'Atendente',
  SISTEMA: 'Automação',
}
