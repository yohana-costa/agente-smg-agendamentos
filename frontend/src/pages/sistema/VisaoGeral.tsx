import { useState, type ReactNode } from 'react'
import { get } from '../../lib/api'
import { brl, countdown, dateBr, dateLong, dateTimeBr, pct, todayStr } from '../../lib/format'
import { useAsync, useCountdown, useEventStream } from '../../lib/hooks'
import { navigate } from '../../lib/router'
import { useAuth } from '../../lib/auth'
import { Card, Empty, ErrorBanner, Loading, Progress, Stat, StatusBadge } from '../../components/ui'
import type { Agendamento } from '../../types'
import './visao-geral/visao-geral.css'

interface MetaItem {
  meta: number
  realizado: number
  progresso: number
}

interface Escalonamento {
  id: string
  telefone: string
  nome: string
  motivo: string | null
  escalonadoEm: string | null
}

interface Alerta {
  tipo: 'OCUPACAO_BAIXA' | 'NO_SHOW_ALTO' | 'ESTOQUE_BAIXO' | string
  mensagem: string
  produtoId?: string
}

interface VisaoGeralData {
  hoje: string
  agendaDia: Agendamento[]
  pendencias: {
    aguardandoPagamento: Agendamento[]
    pendentesFinalizacao: Agendamento[]
    escalonamentos: Escalonamento[]
  }
  resumo: { periodo: { from: string; to: string }; atendimentos: number; servicos: number; faturamento: number | null }
  meta: { servicos: MetaItem; valor: MetaItem | null }
  alertas: Alerta[]
  mostraFinanceiro: boolean
}

const ALERTA_INFO: Record<string, { icon: string; titulo: string; destino?: string; aba?: 'agenda' | 'desempenho' | 'servicos' }> = {
  OCUPACAO_BAIXA: { icon: '📉', titulo: 'Ocupação baixa', destino: '/app/agenda', aba: 'agenda' },
  NO_SHOW_ALTO: { icon: '⚠️', titulo: 'No-show em alta', destino: '/app/desempenho', aba: 'desempenho' },
  ESTOQUE_BAIXO: { icon: '📦', titulo: 'Estoque baixo', destino: '/app/servicos', aba: 'servicos' },
}

// As mensagens do backend vêm sem acentos; ajusta as palavras conhecidas para exibição.
const ACENTOS: Array<[RegExp, string]> = [
  [/\bOcupacao\b/g, 'Ocupação'],
  [/\bproximos\b/g, 'próximos'],
  [/\bultimos\b/g, 'últimos'],
  [/\bminimo\b/g, 'mínimo'],
]
function acentuar(s: string) {
  return ACENTOS.reduce((acc, [re, rep]) => acc.replace(re, rep), s)
}

function saudacao() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

function nomesServicos(a: Agendamento) {
  return a.servicos.map((s) => s.nome).join(', ') || '—'
}

function abrirAgendamento(id: string) {
  navigate(`/app/agenda?agendamento=${encodeURIComponent(id)}`)
}

function ReservaCountdown({ segundos }: { segundos: number | null }) {
  const s = useCountdown(segundos)
  if (s === null) return null
  if (s <= 0) return <span className="vg-countdown vg-expired">Expirando</span>
  return (
    <span className="vg-countdown" title="Tempo restante da reserva">
      ⏱ {countdown(s)}
    </span>
  )
}

function PendenciaGrupo({ titulo, total, children }: { titulo: string; total: number; children: ReactNode }) {
  if (!total) return null
  return (
    <div className="vg-pend-group">
      <div className="vg-pend-head">
        <span className="vg-pend-title">{titulo}</span>
        <span className="badge badge-warning">{total}</span>
      </div>
      <div className="vg-pend-list">{children}</div>
    </div>
  )
}

export default function VisaoGeral() {
  const { usuario, podeVer } = useAuth()
  const { data, loading, error, reload } = useAsync(() => get<VisaoGeralData>('/visao-geral'), [])
  const [mostrarConcluidos, setMostrarConcluidos] = useState(true)

  useEventStream(['agenda.atualizada', 'pagamento.aprovado', 'conversa.status'], () => reload())

  const primeiroNome = (usuario?.nome || '').split(' ')[0]
  const hoje = data?.hoje || todayStr()

  const header = (
    <div className="vg-hero">
      <div>
        <h2>
          {saudacao()}
          {primeiroNome ? `, ${primeiroNome}` : ''}!
        </h2>
        <div className="vg-date">{dateLong(hoje)}</div>
      </div>
      <div className="row">
        <span className="vg-live">
          <span className="dot" /> Atualização em tempo real
        </span>
        <button className="btn btn-sm" onClick={reload} disabled={loading}>
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>
    </div>
  )

  if (!data) {
    return (
      <div>
        {header}
        {loading ? <Loading /> : <ErrorBanner message={error || 'Não foi possível carregar a visão geral.'} />}
      </div>
    )
  }

  const { pendencias, resumo, meta, alertas, mostraFinanceiro } = data
  const totalPendencias = pendencias.aguardandoPagamento.length + pendencias.pendentesFinalizacao.length + pendencias.escalonamentos.length
  const agora = Date.now()
  const agendaVisivel = mostrarConcluidos ? data.agendaDia : data.agendaDia.filter((a) => !['CONCLUIDO', 'NO_SHOW'].includes(a.status))
  const restantesHoje = data.agendaDia.filter((a) => ['AGUARDANDO_PAGAMENTO', 'CONFIRMADO', 'EM_ATENDIMENTO'].includes(a.status)).length
  const ehProfissional = usuario?.perfil === 'PROFISSIONAL'

  return (
    <div>
      {header}
      <ErrorBanner message={error} />

      <div className="stats-grid">
        <Stat label="Atendimentos hoje" value={data.agendaDia.length} hint={`${restantesHoje} ainda por atender`} />
        <Stat label="Pendências" value={totalPendencias} hint={totalPendencias ? 'Precisam de ação agora' : 'Tudo em dia'} />
        <Stat label="Atendimentos no mês" value={resumo.atendimentos} hint={`${resumo.servicos} serviço(s) realizados`} />
        {mostraFinanceiro && resumo.faturamento !== null ? (
          <Stat label="Faturamento do mês" value={brl(resumo.faturamento)} hint={resumo.atendimentos ? `Ticket médio ${brl(Math.round(resumo.faturamento / resumo.atendimentos))}` : 'Atendimentos concluídos'} />
        ) : null}
      </div>

      <div className="vg-layout">
        <div className="vg-col">
          <Card
            title={ehProfissional ? 'Minha agenda de hoje' : 'Agenda do dia'}
            subtitle={`${data.agendaDia.length} agendamento(s)`}
            actions={
              <>
                <label className="checkbox small">
                  <input type="checkbox" checked={mostrarConcluidos} onChange={(e) => setMostrarConcluidos(e.target.checked)} />
                  Mostrar finalizados
                </label>
                <button className="btn btn-sm" onClick={() => navigate('/app/agenda')}>
                  Abrir agenda
                </button>
              </>
            }
          >
            {agendaVisivel.length === 0 ? (
              <Empty icon="📅">Nenhum atendimento {mostrarConcluidos ? 'para hoje' : 'restante hoje'}.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Horário</th>
                      <th>Cliente</th>
                      <th>Serviço</th>
                      {!ehProfissional ? <th>Profissional</th> : null}
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agendaVisivel.map((a) => {
                      const passado = new Date(a.fim).getTime() < agora && ['CONCLUIDO', 'NO_SHOW'].includes(a.status)
                      return (
                        <tr key={a.id} className={`clickable vg-agenda-row ${passado ? 'vg-past' : ''}`} onClick={() => abrirAgendamento(a.id)}>
                          <td className="vg-time">
                            {a.hora}
                            <span className="muted small"> – {a.horaFim}</span>
                          </td>
                          <td className="strong">{a.cliente?.nome}</td>
                          <td>{nomesServicos(a)}</td>
                          {!ehProfissional ? (
                            <td>
                              <span className="vg-prof">
                                <span className="dot" style={{ background: a.profissional?.cor }} />
                                {a.profissional?.nome}
                              </span>
                            </td>
                          ) : null}
                          <td>
                            <StatusBadge agendamento={a} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Alertas" subtitle="Ocupação, comparecimento e estoque">
            {alertas.length === 0 ? (
              <div className="vg-all-clear">✓ Nenhum alerta no momento.</div>
            ) : (
              alertas.map((al, idx) => {
                const info = ALERTA_INFO[al.tipo] || { icon: 'ℹ️', titulo: 'Alerta' }
                const podeAbrir = info.destino && info.aba && podeVer(info.aba)
                return (
                  <div key={`${al.tipo}-${al.produtoId || idx}`} className={`vg-alert vg-alert-${al.tipo}`}>
                    <span className="vg-alert-icon">{info.icon}</span>
                    <div>
                      <div className="vg-alert-title">{info.titulo}</div>
                      <div className="vg-alert-msg">{acentuar(al.mensagem)}</div>
                    </div>
                    {podeAbrir ? (
                      <button className="btn btn-sm btn-ghost" onClick={() => navigate(info.destino!)}>
                        Ver →
                      </button>
                    ) : null}
                  </div>
                )
              })
            )}
          </Card>
        </div>

        <div className="vg-col">
          <Card title="Pendências" subtitle="Clique para ir direto ao item">
            {totalPendencias === 0 ? (
              <div className="vg-all-clear">✓ Nenhuma pendência. Tudo em dia!</div>
            ) : (
              <>
                <PendenciaGrupo titulo="Aguardando pagamento" total={pendencias.aguardandoPagamento.length}>
                  {pendencias.aguardandoPagamento.map((a) => (
                    <button key={a.id} type="button" className="vg-pend-item" onClick={() => abrirAgendamento(a.id)}>
                      <div className="vg-pend-main">
                        <div className="vg-pend-name">{a.cliente?.nome}</div>
                        <div className="vg-pend-sub">
                          {a.data === hoje ? 'Hoje' : dateBr(a.data)} às {a.hora} · {nomesServicos(a)}
                          {mostraFinanceiro ? ` · ${brl(a.valorTotal)}` : ''}
                        </div>
                      </div>
                      <ReservaCountdown segundos={a.segundosRestantesReserva} />
                      <span className="vg-pend-arrow">›</span>
                    </button>
                  ))}
                </PendenciaGrupo>

                <PendenciaGrupo titulo="Pendentes de finalização" total={pendencias.pendentesFinalizacao.length}>
                  {pendencias.pendentesFinalizacao.map((a) => (
                    <button key={a.id} type="button" className="vg-pend-item" onClick={() => abrirAgendamento(a.id)}>
                      <div className="vg-pend-main">
                        <div className="vg-pend-name">{a.cliente?.nome}</div>
                        <div className="vg-pend-sub">
                          {a.data === hoje ? 'Hoje' : dateBr(a.data)} · {a.hora}–{a.horaFim} · {a.profissional?.nome}
                        </div>
                      </div>
                      <StatusBadge status="PENDENTE_FINALIZACAO" />
                      <span className="vg-pend-arrow">›</span>
                    </button>
                  ))}
                </PendenciaGrupo>

                <PendenciaGrupo titulo="Escalonamentos do agente" total={pendencias.escalonamentos.length}>
                  {pendencias.escalonamentos.map((c) => (
                    <button key={c.id} type="button" className="vg-pend-item" onClick={() => navigate(`/app/atendimento?conversa=${encodeURIComponent(c.id)}`)}>
                      <div className="vg-pend-main">
                        <div className="vg-pend-name">{c.nome}</div>
                        <div className="vg-pend-sub">
                          {c.motivo || 'Aguardando resposta humana'}
                          {c.escalonadoEm ? ` · ${dateTimeBr(c.escalonadoEm)}` : ''}
                        </div>
                      </div>
                      <span className="badge badge-danger">Responder</span>
                      <span className="vg-pend-arrow">›</span>
                    </button>
                  ))}
                </PendenciaGrupo>
              </>
            )}
          </Card>

          <Card title={ehProfissional ? 'Minha meta do mês' : 'Meta do mês'} subtitle="Atendimentos concluídos no mês atual">
            <div className="vg-meta">
              <div className="vg-meta-values">
                <span className="muted small">Serviços</span>
                <span>
                  <span className="vg-meta-big">{meta.servicos.realizado}</span>
                  <span className="muted"> / {meta.servicos.meta || '—'}</span>
                </span>
              </div>
              {meta.servicos.meta > 0 ? (
                <Progress value={meta.servicos.progresso} label={<span className="muted">{pct(meta.servicos.progresso)} da meta</span>} />
              ) : (
                <div className="small muted">Meta de serviços não definida.</div>
              )}
            </div>
            {meta.valor ? (
              <div className="vg-meta">
                <div className="vg-meta-values">
                  <span className="muted small">Valor</span>
                  <span>
                    <span className="vg-meta-big">{brl(meta.valor.realizado)}</span>
                    <span className="muted"> / {meta.valor.meta ? brl(meta.valor.meta) : '—'}</span>
                  </span>
                </div>
                {meta.valor.meta > 0 ? (
                  <Progress value={meta.valor.progresso} label={<span className="muted">{pct(meta.valor.progresso)} da meta</span>} />
                ) : (
                  <div className="small muted">Meta de valor não definida.</div>
                )}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  )
}
