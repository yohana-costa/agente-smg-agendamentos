import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, get, post } from '../../../lib/api'
import { countdown, dateBr, dateTimeBr, phone } from '../../../lib/format'
import { useCountdown } from '../../../lib/hooks'
import { Link } from '../../../lib/router'
import { ErrorBanner, Loading, StatusBadge } from '../../../components/ui'
import { ChatBubble, ChatDay, diaLabel } from './ChatBubble'
import { StatusConversaBadges } from './StatusConversa'
import type { ConversaDetalhe, ConversaResumo } from './types'

type Acao = 'assumir' | 'devolver' | 'resolver' | 'enviar'

export function ConversaAberta({ id, tick, onChanged, onBack }: { id: string; tick: number; onChanged: () => void; onBack: () => void }) {
  const [det, setDet] = useState<ConversaDetalhe | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [erroAcao, setErroAcao] = useState('')
  const [aviso, setAviso] = useState('')
  const [acao, setAcao] = useState<Acao | null>(null)
  const [texto, setTexto] = useState('')
  const msgsRef = useRef<HTMLDivElement>(null)
  const reqRef = useRef(0)

  const carregar = useCallback(
    async (silencioso = false) => {
      const req = ++reqRef.current
      if (!silencioso) setLoading(true)
      try {
        const d = await get<ConversaDetalhe>(`/atendimento/conversas/${id}`)
        if (req !== reqRef.current) return
        setDet(d)
        setErro('')
      } catch (e) {
        if (req === reqRef.current) setErro(errorMessage(e))
      } finally {
        if (req === reqRef.current) setLoading(false)
      }
    },
    [id]
  )

  useEffect(() => {
    setDet(null)
    setTexto('')
    setAviso('')
    setErroAcao('')
    carregar()
  }, [carregar])

  useEffect(() => {
    if (tick) carregar(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const conversa = det?.conversa
  const pausada = Boolean(conversa && conversa.status !== 'ATIVO')
  const segundos = useCountdown(pausada ? conversa?.segundosParaRetorno : null)

  // quando a contagem termina o agente volta sozinho: atualiza a tela
  useEffect(() => {
    if (segundos === 0 && pausada) {
      const t = setTimeout(() => {
        carregar(true)
        onChanged()
      }, 1500)
      return () => clearTimeout(t)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segundos, pausada])

  const qtdMensagens = det?.mensagens.length || 0
  useEffect(() => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [qtdMensagens, id])

  async function executar(tipo: Acao, fn: () => Promise<void>) {
    setAcao(tipo)
    setErroAcao('')
    setAviso('')
    try {
      await fn()
      await carregar(true)
      onChanged()
    } catch (e) {
      setErroAcao(errorMessage(e))
    } finally {
      setAcao(null)
    }
  }

  const assumir = () =>
    executar('assumir', async () => {
      const r = await post<ConversaResumo>(`/atendimento/conversas/${id}/assumir`)
      const min = r?.segundosParaRetorno ? Math.round(r.segundosParaRetorno / 60) : null
      setAviso(`Conversa assumida. O agente fica pausado${min ? ` por ${min} min` : ''} e você pode responder por aqui.`)
    })

  const devolver = () =>
    executar('devolver', async () => {
      await post(`/atendimento/conversas/${id}/devolver`)
      setAviso('Conversa devolvida ao agente. Ele volta a responder na próxima mensagem do cliente.')
    })

  const resolver = () =>
    executar('resolver', async () => {
      await post(`/atendimento/conversas/${id}/resolver-escalonamento`)
      setAviso('Escalonamento marcado como resolvido.')
    })

  const enviar = () => {
    const t = texto.trim()
    if (!t) return
    executar('enviar', async () => {
      const r = await post<{ enviado?: boolean; motivo?: string | null }>(`/atendimento/conversas/${id}/mensagens`, { texto: t })
      setTexto('')
      if (r && r.enviado === false) {
        setAviso(`Mensagem registrada no histórico, mas não foi entregue pelo WhatsApp${r.motivo ? ` (${r.motivo})` : ''}. Verifique a conexão em Agentes de IA.`)
      } else if (conversa?.canal === 'ATENDIMENTO') {
        setAviso('Mensagem enviada. O agente foi pausado nesta conversa enquanto você atende.')
      }
    })
  }

  if (loading && !det) return <div className="at-chat"><Loading label="Carregando conversa..." /></div>
  if (erro && !det)
    return (
      <div className="at-chat">
        <div style={{ padding: 16 }}>
          <button className="btn btn-sm at-back" onClick={onBack} style={{ marginBottom: 10 }}>
            ← Conversas
          </button>
          <ErrorBanner message={erro} />
        </div>
      </div>
    )
  if (!det || !conversa) return null

  const atendimento = conversa.canal === 'ATENDIMENTO'
  let ultimoDia = ''

  return (
    <div className="at-chat">
      <div className="at-chat-head">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <button className="btn btn-sm btn-ghost at-back" onClick={onBack} aria-label="Voltar para a lista">
            ←
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="at-chat-title">{conversa.nome}</div>
            <div className="at-chat-sub">
              <span>{phone(conversa.telefone)}</span>
              <StatusConversaBadges conversa={conversa} />
              {det.cliente ? (
                <Link to={`/app/clientes?cliente=${det.cliente.id}`}>Ver ficha do cliente →</Link>
              ) : (
                <span className="muted">Sem cadastro vinculado</span>
              )}
            </div>
          </div>
        </div>
        {atendimento ? (
          <div className="at-chat-actions">
            {conversa.escalonamentoPendente ? (
              <button className="btn btn-sm" onClick={resolver} disabled={acao !== null}>
                {acao === 'resolver' ? 'Salvando...' : '✓ Marcar escalonamento resolvido'}
              </button>
            ) : null}
            {pausada ? (
              <button className="btn btn-sm btn-primary" onClick={devolver} disabled={acao !== null}>
                {acao === 'devolver' ? 'Devolvendo...' : 'Devolver ao agente'}
              </button>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={assumir} disabled={acao !== null}>
                {acao === 'assumir' ? 'Assumindo...' : 'Assumir conversa'}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {conversa.escalonamentoPendente ? (
        <div className="at-strip escalonado">
          <strong>Escalonamento pendente</strong>
          <span>
            {conversa.motivoEscalonamento ? `Motivo informado pelo agente: ${conversa.motivoEscalonamento}` : 'O agente encaminhou esta conversa para um humano.'}
            {conversa.escalonadoEm ? ` · ${dateTimeBr(conversa.escalonadoEm)}` : ''}
          </span>
        </div>
      ) : null}

      {atendimento && pausada ? (
        <div className="at-strip pausa">
          <span>⏸ Agente pausado nesta conversa. Volta a responder sozinho em</span>
          <span className="at-countdown">{countdown(segundos)}</span>
          {conversa.pausadoAte ? <span className="small">(às {new Date(conversa.pausadoAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})</span> : null}
        </div>
      ) : null}

      {!atendimento ? (
        <div className="at-strip agendamentos">
          <span className="small muted">Conversa do Agente de Gestão (número autorizado da equipe). O agente de gestão não é pausado.</span>
        </div>
      ) : null}

      {det.agendamentos.length ? (
        <div className="at-strip agendamentos">
          <span className="small strong">Agendamentos ativos:</span>
          {det.agendamentos.map((a) => (
            <Link key={a.id} className="at-ag-link" to={`/app/agenda?agendamento=${a.id}`} title="Abrir na agenda">
              <span>
                {dateBr(a.data)} {a.hora}
              </span>
              <span className="muted">{a.servicos.map((s) => s.nome).join(' + ')}</span>
              <StatusBadge agendamento={a} />
            </Link>
          ))}
        </div>
      ) : null}

      <div className="at-messages" ref={msgsRef}>
        {det.mensagens.length === 0 ? <div className="at-note">Nenhuma mensagem nesta conversa ainda.</div> : null}
        {det.mensagens.map((m) => {
          const dia = diaLabel(m.createdAt)
          const separador = dia !== ultimoDia
          ultimoDia = dia
          return (
            <Fragment key={m.id}>
              {separador ? <ChatDay label={dia} /> : null}
              <ChatBubble autor={m.autor} texto={m.texto} quando={m.createdAt} lado={m.autor === 'CLIENTE' ? 'esq' : 'dir'} rotulo={m.autor === 'CLIENTE' ? conversa.nome : undefined} />
            </Fragment>
          )
        })}
      </div>

      <div className="at-composer">
        {aviso ? <div className="banner info-banner">{aviso}</div> : null}
        <ErrorBanner message={erroAcao} />
        <div className="at-composer-row">
          <textarea
            className="textarea"
            placeholder="Escreva uma mensagem como atendente..."
            value={texto}
            disabled={acao === 'enviar'}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                enviar()
              }
            }}
            rows={2}
          />
          <button className="btn btn-primary" onClick={enviar} disabled={!texto.trim() || acao !== null}>
            {acao === 'enviar' ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
        <div className="at-composer-hint">
          {atendimento
            ? 'Enter envia, Shift+Enter quebra linha. Ao enviar, o agente é pausado nesta conversa e volta sozinho após o tempo configurado (ou quando você devolver).'
            : 'Enter envia, Shift+Enter quebra linha.'}
        </div>
      </div>
    </div>
  )
}
