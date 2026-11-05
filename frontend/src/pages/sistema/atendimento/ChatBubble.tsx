import { timeBr } from '../../../lib/format'
import { AUTOR_LABEL, type AutorMensagem } from './types'
import './atendimento.css'

/** Balao de mensagem estilo WhatsApp. `lado` define de que lado o autor aparece. */
export function ChatBubble({
  autor,
  texto,
  quando,
  lado,
  rotulo,
  erroEnvio,
}: {
  autor: AutorMensagem
  texto: string
  quando?: string | null
  lado: 'esq' | 'dir'
  rotulo?: string
  /** preenchido quando o WhatsApp avisou que a mensagem nao foi entregue */
  erroEnvio?: string | null
}) {
  return (
    <div className={`at-msg-row ${lado === 'dir' ? 'at-right' : 'at-left'}`}>
      <div className={`at-bubble at-autor-${autor}`}>
        <div className="at-bubble-author">{rotulo || AUTOR_LABEL[autor]}</div>
        <div className="at-bubble-text">{texto}</div>
        {erroEnvio ? (
          <div className="at-bubble-falha" title={erroEnvio}>
            ⚠ Não entregue pelo WhatsApp
            {/131047/.test(erroEnvio) ? ': a cliente não falou com o número nas últimas 24h.' : '.'}
          </div>
        ) : null}
        {quando ? <div className="at-bubble-time">{timeBr(quando)}</div> : null}
      </div>
    </div>
  )
}

/** Separador de data entre mensagens. */
export function ChatDay({ label }: { label: string }) {
  return (
    <div className="at-day">
      <span>{label}</span>
    </div>
  )
}

export function diaLabel(iso: string) {
  const d = new Date(iso)
  const hoje = new Date()
  const ontem = new Date()
  ontem.setDate(hoje.getDate() - 1)
  if (d.toDateString() === hoje.toDateString()) return 'Hoje'
  if (d.toDateString() === ontem.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}
