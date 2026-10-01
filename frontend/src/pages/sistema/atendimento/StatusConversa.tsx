import type { ConversaResumo } from './types'

/** Badges de status da conversa: Agente ativo / Pausado / Escalonado. */
export function StatusConversaBadges({ conversa }: { conversa: Pick<ConversaResumo, 'status' | 'escalonamentoPendente' | 'canal'> }) {
  const pausada = conversa.status !== 'ATIVO'
  return (
    <>
      {conversa.canal === 'GESTAO' ? <span className="badge badge-info">Gestão</span> : null}
      {conversa.escalonamentoPendente ? <span className="badge badge-danger">Escalonado</span> : null}
      {pausada ? <span className="badge badge-warning">Pausado</span> : null}
      {!pausada && !conversa.escalonamentoPendente ? <span className="badge badge-success">Agente ativo</span> : null}
    </>
  )
}

export function iniciais(nome: string) {
  const partes = String(nome || '?')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!partes.length) return '?'
  return ((partes[0][0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}

export function horaLista(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  const hoje = new Date()
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const ontem = new Date()
  ontem.setDate(hoje.getDate() - 1)
  if (d.toDateString() === ontem.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
