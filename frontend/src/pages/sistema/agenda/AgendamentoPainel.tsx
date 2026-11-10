// Painel do agendamento (escopo 6.4): dados, pagamento, resumo do cliente e botoes por status.
import { useEffect, useState, type ReactNode } from 'react'
import { ApiError, del, errorMessage, get, patch, post, put } from '../../../lib/api'
import { brl, countdown, dateLong, dateTimeBr, duration, FORMA_PAGAMENTO, ORIGEM, phone } from '../../../lib/format'
import { useAsync, useCountdown } from '../../../lib/hooks'
import { useAuth } from '../../../lib/auth'
import { ConfirmModal, Drawer, ErrorBanner, Field, Loading, Modal, MoneyInput, StatusBadge, SuccessBanner } from '../../../components/ui'
import type { Agendamento, PacoteCliente, Pagamento } from '../../../types'
import { AdicionarProdutoModal, CancelarModal, FinalizarModal, PagamentoLocalModal, ReagendarModal } from './AcoesModais'
import { AlertIcon, PagamentoIcon } from './icons'
import type { NovoPrefill, PreviaFinalizacao, Referencias } from './types'
import { pagamentoPixPendente } from './utils'
import { PixBox } from './Widgets'

type Acao = 'cancelar' | 'noshow' | 'reagendar' | 'finalizar' | 'pagLocal' | 'produto' | 'excluir' | 'editar' | 'servicos' | 'receber' | null

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
    } else if (ag.status === 'CONCLUIDO' && ag.situacaoPagamento === 'COMANDA_ABERTA') {
      botoes = (
        <button className="btn btn-primary" onClick={() => setAcao('receber')}>
          Receber pagamento
        </button>
      )
    }
  }

  // concluido e pagamento recebido o backend recusa, com a explicacao
  const podeExcluir = Boolean(ag && !readOnly && usuario?.perfil !== 'PROFISSIONAL' && ag.status !== 'CONCLUIDO')
  const podeEditar = Boolean(ag && !readOnly && usuario?.perfil !== 'PROFISSIONAL' && ['AGUARDANDO_PAGAMENTO', 'CONFIRMADO', 'EM_ATENDIMENTO'].includes(ag.status))
  const podeEditarServicos = podeEditar && ['CONFIRMADO', 'EM_ATENDIMENTO'].includes(ag?.status || '')
  const excluir = podeExcluir ? (
    <button className="btn btn-ghost danger-text" style={{ marginRight: 'auto' }} onClick={() => setAcao('excluir')}>
      Excluir
    </button>
  ) : null

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
        footer={botoes || excluir ? <div className="ag-panel-actions">{excluir}{botoes}</div> : ag ? <span className="small muted">{readOnly ? 'Agenda de outro profissional: somente leitura.' : 'Somente consulta.'}</span> : null}
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
              {ag.presencaConfirmadaEm ? <div className="small success-text">✅ Cliente confirmou presença em {dateTimeBr(ag.presencaConfirmadaEm)}</div> : null}
              {podeEditar ? (
                <div>
                  <button className="btn btn-sm" onClick={() => setAcao('editar')}>
                    ✎ Editar horário de término e valor
                  </button>
                </div>
              ) : null}
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

            <Section
              title={
                <span className="row-between">
                  <span>Serviços</span>
                  {podeEditarServicos ? (
                    <button className="btn btn-sm" onClick={() => setAcao('servicos')}>
                      ✎ Editar / incluir procedimento
                    </button>
                  ) : null}
                </span>
              }
            >
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
                  <span>{s.pacoteSaldoId && !s.pacoteDevolvido && !s.preco ? 'pacote' : brl(s.preco)}</span>
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
              {ag.ajusteValor ? (
                <div className="row-between ag-line">
                  <span>Ajuste de valor</span>
                  <span>
                    {ag.ajusteValor > 0 ? '+' : '−'} {brl(Math.abs(ag.ajusteValor))}
                  </span>
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

      {ag && acao === 'excluir' ? (
        <ConfirmModal
          title="Excluir agendamento"
          confirmLabel="Excluir"
          danger
          onClose={() => setAcao(null)}
          onConfirm={async () => {
            await del(`/agenda/agendamentos/${ag.id}`)
            onChanged('Agendamento excluído.')
            onClose()
          }}
        >
          <p>
            O agendamento de <strong>{ag.cliente.nome}</strong> em <strong>{dateTimeBr(ag.inicio)}</strong> será apagado da agenda e o horário fica livre. Não dá para desfazer.
          </p>
          <p className="small muted">A cliente não recebe aviso. Se quiser avisar, use Cancelar em vez de Excluir.</p>
        </ConfirmModal>
      ) : null}
      {ag && acao === 'receber' ? <ReceberModal ag={ag} onClose={() => setAcao(null)} onDone={concluido} /> : null}
      {ag && acao === 'editar' ? (
        <EditarModal
          ag={ag}
          onClose={() => setAcao(null)}
          onDone={(t) => {
            setAcao(null)
            concluido(t)
          }}
        />
      ) : null}
      {ag && acao === 'servicos' ? (
        <ProcedimentosModal
          ag={ag}
          refs={refs}
          onClose={() => setAcao(null)}
          onDone={(t) => {
            setAcao(null)
            concluido(t)
          }}
        />
      ) : null}
      {ag && acao === 'cancelar' ?<CancelarModal ag={ag} tipo="CANCELAMENTO" onClose={() => setAcao(null)} onDone={(t) => { setAcao(null); concluido(t) }} /> : null}
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

/** Comanda aberta: recebe o que ficou em aberto no Finalizar ("Pagar depois"), com os outros da cliente se quiser. */
function ReceberModal({ ag, onClose, onDone }: { ag: Agendamento; onClose: () => void; onDone: (msg: string) => void }) {
  const previa = useAsync(() => get<PreviaFinalizacao>(`/agenda/agendamentos/${ag.id}/finalizacao`), [ag.id])
  const [forma, setForma] = useState<'' | 'DINHEIRO' | 'MAQUININHA' | 'PIX'>('')
  const [incluir, setIncluir] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [pixAg, setPixAg] = useState<Agendamento | null>(null)
  const comanda = previa.data?.comanda || []
  const juntar = comanda.length > 0 && incluir
  const total = (previa.data?.valorEmAberto || 0) + (juntar ? comanda.reduce((acc, c) => acc + c.valorEmAberto, 0) : 0)

  async function receber() {
    if (!forma) return setErro('Escolha a forma de pagamento.')
    if (juntar && forma === 'PIX') return setErro('A comanda junta só pode ser recebida em dinheiro ou maquininha. No Pix, desmarque os outros atendimentos.')
    setSalvando(true)
    setErro('')
    try {
      const r = await post<Agendamento>(`/agenda/agendamentos/${ag.id}/receber`, { formaPagamento: forma, incluirComanda: juntar })
      if (forma === 'PIX' && pagamentoPixPendente(r)) {
        setPixAg(r)
        return
      }
      onDone('Pagamento recebido.')
      onClose()
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  const pix = pagamentoPixPendente(pixAg)
  if (pixAg) {
    return (
      <Modal
        title="Pix do atendimento"
        onClose={() => {
          onDone('Pix gerado. O pagamento entra assim que a cliente pagar.')
          onClose()
        }}
      >
        {pix ? <PixBox pagamento={pix} /> : <div className="banner info-banner">Pix gerado.</div>}
      </Modal>
    )
  }

  return (
    <Modal
      title="Receber pagamento"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={salvando}>
            Voltar
          </button>
          <button className="btn btn-primary" onClick={receber} disabled={salvando || !previa.data}>
            {salvando ? 'Recebendo…' : `Receber ${brl(total)}`}
          </button>
        </>
      }
    >
      {!previa.data ? (
        previa.loading ? <Loading /> : <ErrorBanner message={previa.error || 'Não foi possível carregar.'} />
      ) : (
        <div className="stack">
          <ErrorBanner message={erro} />
          <div className="row-between">
            <span>
              {ag.servicos.map((s) => s.nome).join(' + ')} · {ag.hora}
            </span>
            <strong>{brl(previa.data.valorEmAberto)}</strong>
          </div>
          {comanda.length ? (
            <div className="banner warning-banner small">
              <div className="strong">Outros atendimentos em aberto da cliente</div>
              {comanda.map((c) => (
                <div key={c.id} className="row-between">
                  <span>
                    {c.servicos} · {c.hora}
                  </span>
                  <span>{brl(c.valorEmAberto)}</span>
                </div>
              ))}
              <label className="checkbox" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={incluir} onChange={(e) => setIncluir(e.target.checked)} /> Receber tudo junto
              </label>
            </div>
          ) : null}
          <div className="chips">
            {(
              [
                ['DINHEIRO', 'Dinheiro'],
                ['MAQUININHA', 'Maquininha'],
                ['PIX', 'Pix (QR na tela)'],
              ] as const
            ).map(([k, l]) => (
              <button type="button" key={k} className={`chip ${forma === k ? 'active' : ''}`} onClick={() => setForma(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Ajuste manual: termino (ex.: reservou 13h-15h e vai ate 14h) e valor (fez mais ou menos que a tabela). */
function EditarModal({ ag, onClose, onDone }: { ag: Agendamento; onClose: () => void; onDone: (msg: string) => void }) {
  const [horaFim, setHoraFim] = useState(ag.horaFim)
  const [valor, setValor] = useState(ag.valorTotal)
  const [encaixe, setEncaixe] = useState(false)
  const [pedirEncaixe, setPedirEncaixe] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const valorBloqueado = ag.pagamentos.some((p) => p.status === 'PENDENTE' && p.modo === 'ONLINE')

  async function salvar() {
    const body: Record<string, unknown> = {}
    if (horaFim && horaFim !== ag.horaFim) body.horaFim = horaFim
    if (!valorBloqueado && valor !== ag.valorTotal) body.valorTotal = valor
    if (!Object.keys(body).length) return onClose()
    if (encaixe) body.encaixe = true
    setSalvando(true)
    setErro('')
    try {
      await patch(`/agenda/agendamentos/${ag.id}/ajustar`, body)
      onDone('Agendamento atualizado.')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.details?.requerEncaixe) setPedirEncaixe(true)
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      title="Editar agendamento"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={salvando}>
            Voltar
          </button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando || (pedirEncaixe && !encaixe)}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="stack">
        <ErrorBanner message={erro} />
        <Field label="Horário de término" hint={`Início às ${ag.hora}. Diminua para liberar o resto do horário na agenda.`}>
          <input className="input" type="time" step={300} value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
        </Field>
        {pedirEncaixe ? (
          <label className="row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={encaixe} onChange={(e) => setEncaixe(e.target.checked)} />
            Confirmar mesmo assim (encaixe por cima do outro agendamento)
          </label>
        ) : null}
        <Field
          label="Valor total"
          hint={
            valorBloqueado
              ? 'Tem uma cobrança online em aberto: o valor só pode ser mudado depois que ela for paga ou cancelada.'
              : `Valor pela tabela: ${brl(ag.valorServicos + ag.valorProdutos - ag.desconto)}. O que faltar pagar é cobrado ao finalizar.`
          }
        >
          <MoneyInput value={valor} onChange={setValor} disabled={valorBloqueado} />
        </Field>
      </div>
    </Modal>
  )
}

/** Inclui, tira ou troca procedimentos do agendamento (ex.: veio fazer mão e fez pé e mão) e usa o pacote da cliente. */
function ProcedimentosModal({ ag, refs, onClose, onDone }: { ag: Agendamento; refs: Referencias; onClose: () => void; onDone: (msg: string) => void }) {
  const [ids, setIds] = useState(() => ag.servicos.map((s) => s.servicoId))
  const [busca, setBusca] = useState('')
  const [usarPacote, setUsarPacote] = useState(true)
  const [encaixe, setEncaixe] = useState(false)
  const [pedirEncaixe, setPedirEncaixe] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const { data: pacotes } = useAsync(() => get<PacoteCliente[]>(`/clientes/${encodeURIComponent(ag.clienteId)}/pacotes`), [ag.clienteId])

  // saldo livre do pacote por servico, para mostrar o que ele cobre antes de salvar
  const livres = (pacotes || [])
    .filter((pc) => pc.status === 'ATIVO' && (!pc.validoAte || String(pc.validoAte).slice(0, 10) >= ag.data))
    .flatMap((pc) => pc.saldos.filter((s) => s.restante > 0).map((s) => ({ servicoId: s.servicoId, livre: s.restante, preco: pc.porSessao ? s.valorSessao : 0 })))
  const linhas = ids.map((id) => {
    const item = ag.servicos.find((s) => s.servicoId === id)
    const ref = refs.servicos.find((s) => s.id === id)
    const noPacote = Boolean(item?.pacoteSaldoId && !item.pacoteDevolvido)
    let preco = item ? item.preco : ref?.preco || 0
    let vaiUsarPacote = false
    if (!noPacote && usarPacote) {
      const saldo = livres.find((l) => l.servicoId === id && l.livre > 0)
      if (saldo) {
        saldo.livre -= 1
        preco = saldo.preco
        vaiUsarPacote = true
      }
    }
    return { id, nome: item?.nome || ref?.nome || 'Serviço', preco, duracaoMin: item ? item.duracaoMin : ref?.duracaoMin || 0, novo: !item, noPacote, vaiUsarPacote }
  })
  const temPacote = (pacotes || []).some((pc) => pc.status === 'ATIVO')
  const valorServicos = linhas.reduce((acc, l) => acc + l.preco, 0)
  const ajuste = valorServicos === ag.valorServicos ? ag.ajusteValor || 0 : 0
  const total = Math.max(0, valorServicos + ag.valorProdutos - Math.min(ag.desconto, valorServicos + ag.valorProdutos) + ajuste)
  const opcoes = refs.servicos.filter(
    (s) => s.profissionalIds.includes(ag.profissionalId) && !ids.includes(s.id) && (!busca || s.nome.toLowerCase().includes(busca.toLowerCase()) || (s.categoria || '').toLowerCase().includes(busca.toLowerCase()))
  )

  async function salvar() {
    if (!ids.length) return setErro('Deixe pelo menos um procedimento.')
    setSalvando(true)
    setErro('')
    try {
      const r = await put<Agendamento & { pacotesUsados: number }>(`/agenda/agendamentos/${ag.id}/servicos`, { servicoIds: ids, usarPacote, encaixe })
      onDone(r.pacotesUsados ? `Procedimentos atualizados. ${r.pacotesUsados} sessão(ões) do pacote usada(s).` : 'Procedimentos atualizados.')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.details?.requerEncaixe) setPedirEncaixe(true)
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      title="Procedimentos do agendamento"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={salvando}>
            Voltar
          </button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando || !ids.length || (pedirEncaixe && !encaixe)}>
            {salvando ? 'Salvando…' : `Salvar · ${brl(total)}`}
          </button>
        </>
      }
    >
      <div className="stack">
        <ErrorBanner message={erro} />
        <div className="stack-sm">
          {linhas.map((l) => (
            <div key={l.id} className="row-between ag-line">
              <span>
                {l.nome}
                <span className="small muted"> · {duration(l.duracaoMin)}</span>
                {l.novo ? <span className="badge badge-success" style={{ marginLeft: 6 }}>novo</span> : null}
                {l.noPacote || l.vaiUsarPacote ? <span className="badge badge-primary" style={{ marginLeft: 6 }}>pacote</span> : null}
              </span>
              <span className="row" style={{ gap: 8 }}>
                {l.preco ? brl(l.preco) : l.noPacote || l.vaiUsarPacote ? 'pacote' : brl(0)}
                <button className="btn btn-sm btn-ghost danger-text" title="Tirar do agendamento" onClick={() => setIds((x) => x.filter((i) => i !== l.id))}>
                  ✕
                </button>
              </span>
            </div>
          ))}
          <div className="row-between ag-line ag-total">
            <span>Novo total</span>
            <span>{brl(total)}</span>
          </div>
          {ag.ajusteValor && !ajuste ? <div className="small muted">O ajuste manual de valor sai, porque os procedimentos mudaram. Se precisar, ajuste de novo depois.</div> : null}
        </div>

        {temPacote ? (
          <label className="row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={usarPacote} onChange={(e) => setUsarPacote(e.target.checked)} />
            Usar o pacote da cliente no que ele cobrir
          </label>
        ) : null}

        <Field label="Incluir procedimento" hint={`Aparecem os procedimentos que ${ag.profissional?.nome || 'o profissional'} faz. A duração do atendimento é recalculada.`}>
          <input className="input" placeholder="Buscar procedimento" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </Field>
        <div className="stack-sm" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {opcoes.slice(0, 30).map((s) => (
            <button
              key={s.id}
              className="btn btn-sm"
              style={{ justifyContent: 'space-between', width: '100%' }}
              onClick={() => {
                setIds((x) => [...x, s.id])
                setBusca('')
              }}
            >
              <span>+ {s.nome}</span>
              <span className="small muted">
                {brl(s.preco)} · {duration(s.duracaoMin)}
              </span>
            </button>
          ))}
          {!opcoes.length ? <div className="small muted">Nenhum procedimento encontrado.</div> : null}
        </div>

        {pedirEncaixe ? (
          <label className="row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={encaixe} onChange={(e) => setEncaixe(e.target.checked)} />
            Confirmar mesmo assim (encaixe por cima do outro agendamento)
          </label>
        ) : null}
      </div>
    </Modal>
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
