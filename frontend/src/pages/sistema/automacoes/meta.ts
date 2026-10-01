export type TipoAutomacao = 'LEMBRETE_PAGAMENTO' | 'CONFIRMACAO' | 'LEMBRETE_ATENDIMENTO' | 'POS_ATENDIMENTO' | 'AVISO_RETORNO' | 'AVISO_REAGENDAMENTO' | 'AVISO_CANCELAMENTO'

export interface Automacao {
  id: string
  tipo: TipoAutomacao
  ativo: boolean
  disparoMin: number
  texto: string
}

/**
 * Como o disparoMin e interpretado em cada tipo (ver scheduler do backend):
 * - apos-criacao: minutos apos a criacao do agendamento
 * - antes: minutos antes do horario do atendimento
 * - apos-final: minutos apos finalizar o atendimento
 * - dias-antes: minutos antes da data de retorno sugerida (editado em dias)
 * - imediato: enviado na hora do evento
 */
export type ModoDisparo = 'apos-criacao' | 'antes' | 'apos-final' | 'dias-antes' | 'imediato'

export interface Placeholder {
  key: string
  label: string
  exemplo: string
}

const BASE: Placeholder[] = [
  { key: 'cliente', label: 'Primeiro nome do cliente', exemplo: 'Maria' },
  { key: 'cliente_nome', label: 'Nome completo do cliente', exemplo: 'Maria Souza' },
  { key: 'servicos', label: 'Serviços do agendamento', exemplo: 'Corte + Escova' },
  { key: 'profissional', label: 'Profissional', exemplo: 'Ana' },
  { key: 'data', label: 'Data do atendimento', exemplo: '15/10/2026' },
  { key: 'hora', label: 'Horário', exemplo: '14:00' },
  { key: 'valor', label: 'Valor total', exemplo: 'R$ 120,00' },
  { key: 'estabelecimento', label: 'Nome do estabelecimento', exemplo: '' },
  { key: 'link_site', label: 'Link do site para agendar', exemplo: '' },
]

const LINK_PAGAMENTO: Placeholder = { key: 'link_pagamento', label: 'Link de pagamento', exemplo: 'https://pagar.exemplo.com/abc123' }
const MINUTOS: Placeholder = { key: 'minutos_restantes', label: 'Minutos até o cancelamento automático', exemplo: '10' }
const REEMBOLSO: Placeholder = { key: 'reembolso', label: 'Texto do reembolso (vazio quando não há)', exemplo: 'Valor a ser devolvido: R$ 120,00.' }

export const META: Record<TipoAutomacao, { titulo: string; descricao: string; modo: ModoDisparo; icone: string; placeholders: Placeholder[] }> = {
  LEMBRETE_PAGAMENTO: {
    titulo: 'Lembrete de pagamento pendente',
    descricao: 'Para agendamentos feitos pelo site ou pelo agente que ainda não foram pagos. O horário fica reservado por 15 minutos e é cancelado automaticamente depois disso.',
    modo: 'apos-criacao',
    icone: '⏳',
    placeholders: [...BASE, LINK_PAGAMENTO, MINUTOS],
  },
  CONFIRMACAO: {
    titulo: 'Confirmação do agendamento',
    descricao: 'Enviada assim que o pagamento é confirmado e o agendamento passa para Confirmado.',
    modo: 'imediato',
    icone: '✅',
    placeholders: BASE,
  },
  LEMBRETE_ATENDIMENTO: {
    titulo: 'Lembrete antes do atendimento',
    descricao: 'Lembra o cliente do horário marcado. Enviado apenas para agendamentos confirmados.',
    modo: 'antes',
    icone: '🔔',
    placeholders: BASE,
  },
  POS_ATENDIMENTO: {
    titulo: 'Pós-atendimento',
    descricao: 'Agradecimento depois que o atendimento é finalizado.',
    modo: 'apos-final',
    icone: '💬',
    placeholders: BASE,
  },
  AVISO_RETORNO: {
    titulo: 'Aviso de retorno',
    descricao: 'Convida o cliente a voltar com base no retorno recomendado do serviço. Não é enviado se o cliente já voltou ou já tem um novo horário marcado.',
    modo: 'dias-antes',
    icone: '↻',
    placeholders: BASE,
  },
  AVISO_REAGENDAMENTO: {
    titulo: 'Aviso de reagendamento',
    descricao: 'Avisa o cliente da nova data sempre que o agendamento é reagendado (pelo portal, pelo agente ou pelo estabelecimento).',
    modo: 'imediato',
    icone: '📅',
    placeholders: BASE,
  },
  AVISO_CANCELAMENTO: {
    titulo: 'Aviso de cancelamento',
    descricao: 'Avisa o cliente quando o agendamento é cancelado, informando o valor que será devolvido conforme as políticas.',
    modo: 'imediato',
    icone: '✖',
    placeholders: [...BASE, REEMBOLSO],
  },
}

export const TODOS_PLACEHOLDERS = new Set([...BASE, LINK_PAGAMENTO, MINUTOS, REEMBOLSO].map((p) => p.key))
