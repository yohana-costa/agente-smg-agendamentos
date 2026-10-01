import { Fragment, useEffect, useRef, useState } from 'react'
import { del, errorMessage, get, post } from '../../../lib/api'
import { phone } from '../../../lib/format'
import { Card, ConfirmModal, ErrorBanner, Field, Segmented } from '../../../components/ui'
import { ChatBubble } from '../atendimento/ChatBubble'
import type { AutorMensagem, ConversaDetalhe, ConversaResumo, Mensagem } from '../atendimento/types'
import { normalizarTelefone, type AgentesDados } from './types'

type Canal = 'ATENDIMENTO' | 'GESTAO'
type Item = { key: string; autor?: AutorMensagem; texto: string; createdAt?: string; nota?: boolean }

const TELEFONE_PADRAO = '5500000000000'

interface SimularResposta {
  conversaId: string
  respostas: Mensagem[]
  resultado: { escalonado?: boolean; motivo?: string; texto?: string; usedTools?: string[] } | null
}

export function Simulador({ dados }: { dados: AgentesDados }) {
  const autorizados = dados.numerosAutorizados
  const [canal, setCanal] = useState<Canal>('ATENDIMENTO')
  const [telAtendimento, setTelAtendimento] = useState('')
  const [numeroGestao, setNumeroGestao] = useState(autorizados.find((n) => n.ativo)?.telefone || '')
  const [itens, setItens] = useState<Item[]>([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [limpar, setLimpar] = useState(false)
  const [carregandoHist, setCarregandoHist] = useState(false)
  const msgsRef = useRef<HTMLDivElement>(null)

  const telefone = canal === 'GESTAO' ? numeroGestao : normalizarTelefone(telAtendimento) || TELEFONE_PADRAO
  const telValido = canal === 'GESTAO' ? Boolean(numeroGestao) : !telAtendimento.trim() || normalizarTelefone(telAtendimento).length >= 12
  const agenteAtivo = canal === 'GESTAO' ? dados.config.gestaoAtivo : dados.config.atendimentoAtivo

  // carrega o historico que ja existe no servidor para este numero (quando o usuario tem acesso ao Atendimento)
  useEffect(() => {
    setItens([])
    setErro('')
    if (!telefone || !telValido) return
    let ativo = true
    const t = setTimeout(async () => {
      setCarregandoHist(true)
      try {
        const lista = await get<ConversaResumo[]>('/atendimento/conversas', { canal, busca: telefone })
        const conversa = lista.find((c) => c.telefone === telefone)
        if (!conversa || !ativo) return
        const det = await get<ConversaDetalhe>(`/atendimento/conversas/${conversa.id}`)
        if (ativo) setItens(det.mensagens.map((m) => ({ key: m.id, autor: m.autor, texto: m.texto, createdAt: m.createdAt })))
      } catch {
        // sem acesso ao historico: comeca vazio
      } finally {
        if (ativo) setCarregandoHist(false)
      }
    }, 400)
    return () => {
      ativo = false
      clearTimeout(t)
    }
  }, [canal, telefone, telValido])

  useEffect(() => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [itens.length, enviando])

  async function enviar() {
    const t = texto.trim()
    if (!t || enviando) return
    if (!telValido) return setErro(canal === 'GESTAO' ? 'Escolha um número autorizado.' : 'Telefone de teste inválido. Informe DDD e número.')
    setErro('')
    setTexto('')
    setEnviando(true)
    setItens((l) => [...l, { key: `local-${Date.now()}`, autor: 'CLIENTE', texto: t, createdAt: new Date().toISOString() }])
    try {
      const r = await post<SimularResposta>('/agentes/simular', { telefone, texto: t, canal })
      const novos: Item[] = (r.respostas || []).map((m) => ({ key: m.id, autor: m.autor, texto: m.texto, createdAt: m.createdAt }))
      if (r.resultado?.escalonado) {
        novos.push({
          key: `nota-${Date.now()}`,
          nota: true,
          texto: `Conversa escalonada${r.resultado.motivo ? ` (motivo: ${r.resultado.motivo})` : ''}. O agente fica pausado nesta conversa. Use “Limpar conversa” para recomeçar o teste.`,
        })
      } else if (!novos.length) {
        novos.push({
          key: `nota-${Date.now()}`,
          nota: true,
          texto: agenteAtivo
            ? 'O agente não respondeu. A conversa pode estar pausada (escalonada ou assumida por um humano) ou a IA está indisponível. Use “Limpar conversa” para recomeçar.'
            : 'O agente está desativado e não responde. Ative-o na sub-aba correspondente.',
        })
      }
      setItens((l) => [...l, ...novos])
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setEnviando(false)
    }
  }

  async function limparConversa() {
    await del('/agentes/simular', { telefone, canal })
    setItens([])
    setErro('')
  }

  const autorizadosAtivos = autorizados.filter((n) => n.ativo)

  return (
    <div className="ia-sim">
      <div>
        <Card title="Configurar teste">
          <div className="stack">
            <Field label="Agente">
              <Segmented
                options={[
                  { key: 'ATENDIMENTO', label: 'Atendimento' },
                  { key: 'GESTAO', label: 'Gestão' },
                ]}
                value={canal}
                onChange={setCanal}
              />
            </Field>
            {canal === 'ATENDIMENTO' ? (
              <Field label="Telefone de teste" hint="Simula um cliente com este número. Em branco: número de teste padrão. Se o número já for de um cliente, o agente usa o cadastro dele.">
                <input className="input" inputMode="tel" placeholder="(00) 00000-0000" value={telAtendimento} onChange={(e) => setTelAtendimento(e.target.value)} />
              </Field>
            ) : (
              <Field label="Número autorizado" hint="O Agente de Gestão só responde a números autorizados e ativos, com as permissões de cada um.">
                {autorizadosAtivos.length ? (
                  <select className="select" value={numeroGestao} onChange={(e) => setNumeroGestao(e.target.value)}>
                    <option value="">Selecione</option>
                    {autorizadosAtivos.map((n) => (
                      <option key={n.id} value={n.telefone}>
                        {n.nome} · {phone(n.telefone)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="banner warning-banner">Nenhum número autorizado ativo. Autorize um número na sub-aba Agente de Gestão.</div>
                )}
              </Field>
            )}
            {!agenteAtivo ? <div className="banner warning-banner">Este agente está desativado, então não vai responder.</div> : null}
            {!dados.iaDisponivel ? <div className="banner warning-banner">A IA não está disponível no servidor (OPENAI_API_KEY ausente).</div> : null}
            <div className="small muted">
              As respostas do simulador não são enviadas pelo WhatsApp. A conversa fica registrada no sistema; agendamentos criados no teste são reais e aparecem na agenda.
            </div>
          </div>
        </Card>
      </div>

      <div className="ia-sim-chat">
        <div className="ia-sim-head">
          <div>
            <div className="strong">{canal === 'GESTAO' ? 'Agente de Gestão' : dados.config.personaNome || 'Agente de Atendimento'}</div>
            <div className="small muted">Conversando como {telefone ? phone(telefone) : '—'}</div>
          </div>
          <button className="btn btn-sm" onClick={() => setLimpar(true)} disabled={!telValido || enviando}>
            Limpar conversa
          </button>
        </div>
        <div className="at-messages" ref={msgsRef}>
          {carregandoHist && !itens.length ? <div className="at-note">Carregando histórico...</div> : null}
          {!carregandoHist && !itens.length ? (
            <div className="at-note">{canal === 'GESTAO' ? 'Peça algo como “qual a agenda de hoje?” ou “quanto faturamos esta semana?”.' : 'Envie uma mensagem como se fosse um cliente, por exemplo “quero agendar um horário”.'}</div>
          ) : null}
          {itens.map((m) => (
            <Fragment key={m.key}>
              {m.nota ? (
                <div className="at-note">{m.texto}</div>
              ) : (
                <ChatBubble
                  autor={m.autor || 'AGENTE'}
                  texto={m.texto}
                  quando={m.createdAt}
                  lado={m.autor === 'CLIENTE' ? 'dir' : 'esq'}
                  rotulo={m.autor === 'CLIENTE' ? (canal === 'GESTAO' ? 'Você (equipe)' : 'Você (cliente)') : undefined}
                />
              )}
            </Fragment>
          ))}
          {enviando ? (
            <div className="ia-typing">
              digitando<span>.</span>
              <span>.</span>
              <span>.</span>
            </div>
          ) : null}
        </div>
        <div className="at-composer">
          <ErrorBanner message={erro} />
          <div className="at-composer-row">
            <textarea
              className="textarea"
              rows={2}
              placeholder="Digite a mensagem de teste..."
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  enviar()
                }
              }}
            />
            <button className="btn btn-primary" onClick={enviar} disabled={enviando || !texto.trim() || !telValido}>
              {enviando ? 'Aguardando...' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>

      {limpar ? (
        <ConfirmModal title="Limpar conversa de teste" danger confirmLabel="Limpar" onClose={() => setLimpar(false)} onConfirm={limparConversa}>
          <p>
            Isso apaga o histórico de conversa do número <strong>{phone(telefone)}</strong> no sistema (inclusive na aba Atendimento) e remove pausas e escalonamentos dele.
          </p>
          {telefone !== TELEFONE_PADRAO ? <div className="banner warning-banner">Atenção: se este número for de um cliente ou membro da equipe real, as conversas reais dele também serão apagadas.</div> : null}
        </ConfirmModal>
      ) : null}
    </div>
  )
}
