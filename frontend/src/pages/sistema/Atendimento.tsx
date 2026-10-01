import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, get } from '../../lib/api'
import { phone } from '../../lib/format'
import { useDebounced, useEventStream } from '../../lib/hooks'
import { navigate, useQueryParam } from '../../lib/router'
import { Empty, ErrorBanner, Loading, PageHeader, Toggle } from '../../components/ui'
import { ConversaAberta } from './atendimento/ConversaAberta'
import { StatusConversaBadges, horaLista, iniciais } from './atendimento/StatusConversa'
import { AUTOR_LABEL, type ConversaResumo } from './atendimento/types'
import './atendimento/atendimento.css'

type Filtro = 'todas' | 'escalonamentos' | 'pausadas'

export default function Atendimento() {
  const selecionada = useQueryParam('conversa')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [busca, setBusca] = useState('')
  const buscaDeb = useDebounced(busca.trim())
  const [incluirGestao, setIncluirGestao] = useState(false)
  const [lista, setLista] = useState<ConversaResumo[] | null>(null)
  const [pendentes, setPendentes] = useState(0)
  const [erro, setErro] = useState('')
  const [tick, setTick] = useState(0)
  const reqRef = useRef(0)

  const carregar = useCallback(async () => {
    const req = ++reqRef.current
    try {
      const base = { filtro: filtro === 'todas' ? undefined : filtro, busca: buscaDeb || undefined }
      const reqs = [get<ConversaResumo[]>('/atendimento/conversas', { ...base, canal: 'ATENDIMENTO' })]
      if (incluirGestao) reqs.push(get<ConversaResumo[]>('/atendimento/conversas', { ...base, canal: 'GESTAO' }))
      reqs.push(get<ConversaResumo[]>('/atendimento/conversas', { filtro: 'escalonamentos', canal: 'ATENDIMENTO' }))
      const res = await Promise.all(reqs)
      if (req !== reqRef.current) return
      const esc = res.pop() || []
      const todas = res.flat().sort((a, b) => String(b.ultimaMensagemEm).localeCompare(String(a.ultimaMensagemEm)))
      setLista(todas)
      setPendentes(esc.length)
      setErro('')
    } catch (e) {
      if (req === reqRef.current) setErro(errorMessage(e))
    }
  }, [filtro, buscaDeb, incluirGestao])

  useEffect(() => {
    setLista(null)
    carregar()
  }, [carregar])

  useEventStream(['conversa.mensagem', 'conversa.status'], (_tipo, payload) => {
    carregar()
    if (selecionada && (!payload?.conversaId || payload.conversaId === selecionada)) setTick((t) => t + 1)
  })

  const abrir = (id: string | null) => navigate(id ? `/app/atendimento?conversa=${id}` : '/app/atendimento', { replace: true })

  const filtros: Array<{ key: Filtro; label: string }> = [
    { key: 'todas', label: 'Todas' },
    { key: 'escalonamentos', label: `Escalonamentos pendentes${pendentes ? ` (${pendentes})` : ''}` },
    { key: 'pausadas', label: 'Pausadas' },
  ]

  return (
    <div>
      <PageHeader
        title="Atendimento"
        subtitle="Conversas do Agente de Atendimento no WhatsApp. Acompanhe o agente e assuma quando necessário."
        actions={
          pendentes ? (
            <button className="btn btn-sm" onClick={() => setFiltro('escalonamentos')}>
              <span className="dot" style={{ background: 'var(--danger)' }} /> {pendentes} escalonamento{pendentes > 1 ? 's' : ''} aguardando
            </button>
          ) : null
        }
      />
      <div className={`at-layout ${selecionada ? 'has-open' : ''}`}>
        <aside className="at-sidebar">
          <div className="at-sidebar-head">
            <input className="input input-sm" placeholder="Buscar por nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <div className="at-filters">
              {filtros.map((f) => (
                <button key={f.key} type="button" className={`chip ${filtro === f.key ? 'active' : ''}`} onClick={() => setFiltro(f.key)} style={{ fontSize: 12, padding: '4px 10px' }}>
                  {f.label}
                </button>
              ))}
            </div>
            <Toggle checked={incluirGestao} onChange={setIncluirGestao} label={<span className="small">Mostrar conversas do Agente de Gestão</span>} />
          </div>
          <div className="at-list">
            {erro ? (
              <div style={{ padding: 12 }}>
                <ErrorBanner message={erro} />
              </div>
            ) : null}
            {lista === null && !erro ? <Loading /> : null}
            {lista && lista.length === 0 ? (
              <Empty icon="✉">
                {filtro === 'escalonamentos' ? 'Nenhum escalonamento pendente.' : filtro === 'pausadas' ? 'Nenhuma conversa pausada.' : buscaDeb ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda.'}
              </Empty>
            ) : null}
            {lista?.map((c) => (
              <div key={c.id} className={`at-item ${selecionada === c.id ? 'active' : ''}`} onClick={() => abrir(c.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && abrir(c.id)}>
                <div className={`at-avatar ${c.canal === 'GESTAO' ? 'gestao' : ''}`}>{iniciais(c.nome)}</div>
                <div className="at-item-main">
                  <div className="at-item-top">
                    <span className="at-item-name">{c.nome === c.telefone ? phone(c.telefone) : c.nome}</span>
                    <span className="at-item-time">{horaLista(c.ultimaMensagemEm)}</span>
                  </div>
                  {c.nome !== c.telefone ? <div className="small muted">{phone(c.telefone)}</div> : null}
                  <div className="at-item-preview">
                    {c.ultimaMensagem ? (
                      <>
                        {c.ultimaMensagem.autor !== 'CLIENTE' ? <strong>{AUTOR_LABEL[c.ultimaMensagem.autor]}: </strong> : null}
                        {c.ultimaMensagem.texto}
                      </>
                    ) : (
                      'Sem mensagens'
                    )}
                  </div>
                  <div className="at-item-badges">
                    <StatusConversaBadges conversa={c} />
                  </div>
                  {c.escalonamentoPendente && c.motivoEscalonamento ? <div className="at-motivo">Motivo: {c.motivoEscalonamento}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </aside>
        {selecionada ? (
          <ConversaAberta id={selecionada} tick={tick} onChanged={carregar} onBack={() => abrir(null)} />
        ) : (
          <div className="at-chat">
            <div className="at-empty-chat">
              <div style={{ fontSize: 34 }}>💬</div>
              <strong>Selecione uma conversa</strong>
              <span className="small">O histórico completo, os agendamentos do cliente e as ações de assumir ou devolver ao agente aparecem aqui.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
