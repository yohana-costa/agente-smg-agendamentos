// Painel do agendamento (escopo 6.4): dados, pagamento, resumo do cliente e botoes por status.
import { useEffect, useState, type ReactNode } from 'react'
import { errorMessage, get, post } from '../../../lib/api'
import { brl, countdown, dateLong, dateTimeBr, duration, FORMA_PAGAMENTO, ORIGEM, phone } from '../../../lib/format'
import { useAsync, useCountdown } from '../../../lib/hooks'
import { useAuth } from '../../../lib/auth'
import { Drawer, ErrorBanner, Loading, StatusBadge, SuccessBanner } from '../../../components/ui'
import type { Agendamento, Pagamento } from '../../../types'
import { AdicionarProdutoModal, CancelarModal, FinalizarModal, PagamentoLocalModal, ReagendarModal } from './AcoesModais'
import { AlertIcon, PagamentoIcon } from './icons'
import type { NovoPrefill, Referencias } from './types'
import { pagamentoPixPendente } from './utils'
import { PixBox } from './Widgets'

type Acao = 'cancelar' | 'noshow' | 'reagendar' | 'finalizar' | 'pagLocal' | 'produto' | null

const STATUS_PAGAMENTO: Record<Pagamento['status'], string> = {
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  REEMBOLSADO: 'Reembolsado',
  REEMBOLSADO_PARCIAL: 'Reembolso parcial',
  CANCELADO: 'Cancelado',
  EXPIRADO: 'Expirado',
}

export function AgendamentoPainel({
  id,
  refs,
  refreshKey,
  onClose,
  onChanged,
  onNovo,
  onLoaded,
}: {
  id: string
  refs: Referencias
  refreshKey: number
  onClose: () => void
  onChanged: (msg?: string) => void
  onNovo: (prefill: NovoPrefill) => void
  onLoaded?: (ag: Agendamento) => void
}) {
  const { usuario } = useAuth()
  const { data: ag, loading, error, reload } = useAsync(() => get<Agendamento>(`/agenda/agendamentos/${id}`), [id, refreshKey])
  const [acao, setAcao] = useState<Acao>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const segundos = useCountdown(ag?.status === 'AGUARDANDO_PAGAMENTO' ? ag.segundosRestantesReserva : null)

  useEffect(() => {
    if (ag && onLoaded) onLoaded(ag)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ag?.id])

  const readOnly = Boolean(ag && usuario?.perfil === 'PROFISSIONAL' && ag.profissionalId !== usuario.profissionalId)

  async function executar(nome: string, fn: () => Promise<unknown>, sucesso: string) {
    setBusy(nome)
    setErro('')
    setMsg('')
    try {
      await fn()
      setMsg(sucesso)
      onChanged()
      reload()
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setBusy('')
    }
  }

  function concluido(texto: string) {
    setMsg(texto)
    onChanged(texto)
    reload()
  }

  const pix = pagamentoPixPendente(ag)
  const pendente = Boolean(ag?.pendenteFinalizacao)

  let botoes: ReactNode = null
  if (ag && !readOnly) {
    if (ag.status === 'AGUARDANDO_PAGAMENTO') {
      botoes = (
        <>
          <button className="btn btn-danger" onClick={() => setAcao('cancelar')}>
            Cancelar
          </button>
          <button className="btn" disabled={busy === 'link'} onClick={() => executar('link', () => post(`/agenda/agendamentos/${ag.id}/reenviar-link`), 'Link de pagamento reenviado pelo WhatsApp.')}>
            {busy === 'link' ? 'Enviando…' : 'Reenviar link'}
          </button>
          <button className="btn btn-primary" onClick={() => setAcao('pagLocal')}>
            Registrar pagamento no local
          </button>
        </>
      )
    } else if (pendente) {
      botoes = (
        <button className="btn btn-primary" onClick={() => setAcao('finalizar')}>
          Finalizar
        </button>
      )
    } else if (ag.status === 'CONFIRMADO') {
      botoes = (
        <>
          <button className="btn btn-danger" onClick={() => setAcao('noshow')}>
            No-show
          </button>
          <button className="btn" onClick={() => setAcao('cancelar')}>
            Cancelar
          </button>
          <button className="btn" onClick={() => setAcao('reagendar')}>
            Reagendar
          </button>
          <button className="btn btn-primary" disabled={busy === 'iniciar'} onClick={() => executar('iniciar', () => post(`/agenda/agendamentos/${ag.id}/iniciar`), 'Atendimento iniciado.')}>
            {busy === 'iniciar' ? 'Iniciando…' : 'Iniciar'}
          </button>
        </>
      )
    } else if (ag.status === 'EM_ATENDIMENTO') {
      botoes = (
        <>
          {refs.venderProdutos ? (
            <button className="btn" onClick={() => setAcao('produto')}>
              Adicionar produto
            </button>
          ) : null}
          <button className="btn btn-primary" onClick={() => setAcao('finalizar')}>
            Finalizar
          </button>
        </>
      )
    }
  }

  return (
    <>
      <Drawer
        title={
          ag ? (
            <span className="row" style={{ gap: 8 }}>
              Agendamento <StatusBadge agendamento={ag} />
            </span>
          ) : (
            'Agendamento'
          )
        }
        onClose={onClose}
        footer={botoes ? <div className="ag-panel-actions">{botoes}</div> : ag ? <span className="small muted">{readOnly ? 'Agenda de outro profissional: somente leitura.' : 'Somente consulta.'}</span> : null}
      >
        {!ag && loading ? <Loading /> : null}
        {!ag && !loading ? <ErrorBanner message={error || 'Agendamento não encontrado.'} /> : null}
        {ag ? (
          <div className="stack ag-panel">
            <SuccessBanner message={msg} />
            <ErrorBanner message={erro} />

            <div className={`ag-panel-hero st-${pendente ? 'PENDENTE_FINALIZACAO' : ag.status}`}>
              <div className="ag-panel-when">
                <div className="ag-panel-date">{dateLong(ag.data)}</div>
                <div className="ag-panel-time">
                  {ag.hora} – {ag.horaFim}
                  {ag.horaFimIntervalo !== ag.horaFim ? <span className="small muted"> · intervalo até {ag.horaFimIntervalo}</span> : null}
                </div>
              </div>
              <div className="row small" style={{ gap: 6 }}>
                <span className="dot" style={{ background: ag.profissional?.cor }} /> {ag.profissional?.nome}
                <span className="muted">· {ORIGEM[ag.origem] || ag.origem}</span>
                {ag.encaixe ? <span className="badge badge-warning">Encaixe</span> : null}
              </div>
              {segundos !== null && ag.status === 'AGUARDANDO_PAGAMENTO' ? (
                <div className="ag-countdown-big">
                  Reserva expira em <strong>{countdown(segundos)}</strong>
                </div>
              ) : null}
              {pendente ? (
                <div className="ag-alert-line">
                  <AlertIcon /> Passou do horário previsto de término sem ser finalizado.
                </div>
              ) : null}
            </div>

            <Section title="Cliente">
              <div className="row-between">
                <div>
                  <div className="strong">{ag.cliente?.nome}</div>
                  <div className="small muted">{phone(ag.cliente?.telefone)}</div>
                </div>
              </div>
              {ag.clienteResumo ? (
                <div className="ag-kpis">
                  <div>
                    <span className="small muted">Visitas</span>
                    <strong>{ag.clienteResumo.totalVisitas}</strong>
                  </div>
                  <div>
                    <span className="small muted">No-shows</span>
                    <strong className={ag.clienteResumo.noShows ? 'danger-text' : ''}>{ag.clienteResumo.noShows}</strong>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <span className="small muted">Último atendimento</span>
                    <strong className="ag-ellipsis">{ag.clienteResumo.ultimoAtendimento ? `${dateTimeBr(ag.clienteResumo.ultimoAtendimento.data).slice(0, 10)} ·${ag.clienteResumo.ultimoAtendimento.servicos}` : 'Primeira visita'}</strong>
                  </div>
                </div>
              ) : null}
              {ag.clienteResumo?.observacoes ? <div className="ag-obs small">Obs. do cliente: {ag.clienteResumo.observacoes}</div> : null}
            </Section>

            <Section title="Serviços">
              {ag.servicos.map((s) => (
                <div key={s.id} className="row-between ag-line">
                  <span>
                    {s.nome}
                    <span className="small muted">
                      {' '}
                      · {duration(s.duracaoMin)}
                      {s.intervaloMin ? ` + ${s.intervaloMin} min intervalo` : ''}
                      {s.duracaoRealMin ? ` · real ${duration(s.duracaoRealMin)}` : ''}
                    </span>
                    {s.pacoteSaldoId && !s.pacoteDevolvido ? <span className="badge badge-primary" style={{ marginLeft: 6 }}>pacote</span> : null}
                  </span>
                  <span>{s.pacoteSaldoId && !s.pacoteDevolvido ? 'pacote' : brl(s.preco)}</span>
                </div>
              ))}
              {ag.produtos.length ? (
                <>
                  <div className="small muted strong" style={{ marginTop: 6 }}>
                    Produtos
                  </div>
                  {ag.produtos.map((p) => (
                    <div key={p.id} className="row-between ag-line">
                      <span>
                        {p.quantidade}× {p.nome}
                        {p.adicionadoNoAtendimento ? <span className="small muted"> · no atendimento</span> : null}
                      </span>
                      <span>{brl(p.precoUnit * p.quantidade)}</span>
                    </div>
                  ))}
                </>
              ) : null}
              {ag.desconto ? (
                <div className="row-between ag-line success-text">
                  <span>Desconto</span>
                  <span>− {brl(ag.desconto)}</span>
                </div>
              ) : null}
              <div className="row-between ag-line ag-total">
                <span>Total</span>
                <span>{brl(ag.valorTotal)}</span>
              </div>
            </Section>

            <Section
              title={
                <span className="row" style={{ gap: 8 }}>
                  Pagamento <PagamentoIcon situacao={ag.situacaoPagamento} comTexto />
                </span>
              }
            >
              {!ag.pagamentos.length ? <div className="small muted">{ag.modoPagamento === 'LOCAL' ? 'Pagamento no local (dinheiro ou maquininha) no dia do atendimento.' : 'Nenhum pagamento registrado.'}</div> : null}
              {ag.pagamentos.map((p) => (
                <div key={p.id} className="ag-pag-line">
                  <div>
                    <div className="small strong">
                      {p.forma ? FORMA_PAGAMENTO[p.forma] : p.modo === 'ONLINE' ? 'Online' : 'No local'} <span className="muted">· {p.modo === 'ONLINE' ? 'online' : 'no local'}</span>
                    </div>
                    <div className="small muted">{p.pagoEm ? `Pago em ${dateTimeBr(p.pagoEm)}` : `Criado em ${dateTimeBr(p.createdAt)}`}</div>
                    {p.valorReembolsado ? <div className="small danger-text">Reembolsado {brl(p.valorReembolsado)}</div> : null}
                  </div>
                  <div className="right">
                    <div className="strong">{brl(p.valorBruto)}</div>
                    <span className={`badge ${p.status === 'APROVADO' ? 'badge-success' : p.status === 'PENDENTE' ? 'badge-warning' : 'badge-gray'}`}>{STATUS_PAGAMENTO[p.status] || p.status}</span>
                  </div>
                </div>
              ))}
              {ag.linkPagamento && ag.status === 'AGUARDANDO_PAGAMENTO' ? (
                <div className="small ag-ellipsis">
                  Link:{' '}
                  <a href={ag.linkPagamento} target="_blank" rel="noreferrer">
                    {ag.linkPagamento}
                  </a>
                </div>
              ) : null}
              {pix && ['AGUARDANDO_PAGAMENTO', 'CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO'].includes(ag.status) ? <PixBox pagamento={pix} segundosReserva={ag.segundosRestantesReserva} /> : null}
            </Section>

            {ag.observacoes || ag.motivoCancelamento || ag.retornoSugerido ? (
              <Section title="Observações">
                {ag.observacoes ? <div className="small">{ag.observacoes}</div> : null}
                {ag.motivoCancelamento ? <div className="small danger-text">Motivo do cancelamento: {ag.motivoCancelamento}</div> : null}
                {ag.retornoSugerido ? <div className="small">Retorno sugerido: {dateTimeBr(ag.retornoSugerido).slice(0, 10)}</div> : null}
              </Section>
            ) : null}

            {ag.status === 'CONCLUIDO' && !readOnly ? (
              <div>
                <button
                  className="btn btn-sm"
                  onClick={() => onNovo({ cliente: { id: ag.clienteId, nome: ag.cliente.nome, telefone: ag.cliente.telefone, observacoes: ag.cliente.observacoes }, servicoIds: ag.servicos.map((s) => s.servicoId), profissionalId: ag.profissionalId })}
                >
                  Agendar novamente
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      {ag && acao === 'cancelar' ? <CancelarModal ag={ag} tipo="CANCELAMENTO" onClose={() => setAcao(null)} onDone={(t) => { setAcao(null); concluido(t) }} /> : null}
      {ag && acao === 'noshow' ? <CancelarModal ag={ag} tipo="NO_SHOW" onClose={() => setAcao(null)} onDone={(t) => { setAcao(null); concluido(t) }} /> : null}
      {ag && acao === 'pagLocal' ? <PagamentoLocalModal ag={ag} onClose={() => setAcao(null)} onDone={concluido} /> : null}
      {ag && acao === 'produto' ? <AdicionarProdutoModal ag={ag} refs={refs} onClose={() => setAcao(null)} onDone={concluido} /> : null}
      {ag && acao === 'reagendar' ? <ReagendarModal ag={ag} refs={refs} onClose={() => setAcao(null)} onDone={concluido} /> : null}
      {ag && acao === 'finalizar' ? (
        <FinalizarModal
          agendamentoId={ag.id}
          refs={refs}
          onClose={() => setAcao(null)}
          onDone={(t, proximo) => {
            concluido(t)
            if (proximo) {
              setAcao(null)
              onNovo({
                cliente: { id: ag.clienteId, nome: ag.cliente.nome, telefone: ag.cliente.telefone, observacoes: ag.cliente.observacoes },
                servicoIds: proximo.ag.servicos.map((s) => s.servicoId),
                profissionalId: ag.profissionalId,
                data: proximo.data,
              })
            }
          }}
        />
      ) : null}
    </>
  )
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="ag-panel-sec">
      <div className="ag-panel-sec-title">{title}</div>
      {children}
    </section>
  )
}
