// Modais de acoes do painel: cancelar/no-show, pagamento no local, adicionar produto, reagendar, finalizar.
import { useEffect, useMemo, useState } from 'react'
import { errorMessage, get, post } from '../../../lib/api'
import { addDays, brl, dateBr, dateLong, pct, REGRA_REEMBOLSO, todayStr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { useAuth } from '../../../lib/auth'
import { ErrorBanner, Field, Loading, Modal, Toggle } from '../../../components/ui'
import type { Agendamento, Conflito, SimulacaoReembolso } from '../../../types'
import type { PreviaFinalizacao, Referencias } from './types'
import { conflitosDoErro, pagamentoPixPendente, valorPago } from './utils'
import { ConflitosAviso, HorariosPicker, PixBox } from './Widgets'

// ---------- cancelar / no-show ----------

export function CancelarModal({ ag, tipo, onClose, onDone }: { ag: Agendamento; tipo: 'CANCELAMENTO' | 'NO_SHOW'; onClose: () => void; onDone: (msg: string) => void }) {
  const [porEstabelecimento, setPorEstabelecimento] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sim = useAsync(
    () => get<SimulacaoReembolso>(`/agenda/agendamentos/${ag.id}/simular-cancelamento`, { tipo, porEstabelecimento: porEstabelecimento ? 'true' : undefined }),
    [ag.id, tipo, porEstabelecimento]
  )
  const noShow = tipo === 'NO_SHOW'

  async function confirmar() {
    setBusy(true)
    setError('')
    try {
      const r = await post<{ reembolso: SimulacaoReembolso }>(`/agenda/agendamentos/${ag.id}/cancelar`, { tipo, porEstabelecimento, motivo: motivo.trim() || undefined })
      const valor = r.reembolso?.valor || 0
      onDone(`${noShow ? 'No-show registrado' : 'Agendamento cancelado'}. ${valor > 0 ? `Reembolso de ${brl(valor)} enviado automaticamente.` : 'Sem valor a devolver.'}`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const s = sim.data
  return (
    <Modal
      title={noShow ? 'Registrar no-show' : 'Cancelar agendamento'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Voltar
          </button>
          <button className="btn btn-danger" onClick={confirmar} disabled={busy || sim.loading || !s}>
            {busy ? 'Aguarde…' : noShow ? 'Confirmar no-show' : 'Confirmar cancelamento'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="small muted">
          {ag.cliente?.nome} · {ag.servicos.map((x) => x.nome).join(' + ')} · {dateBr(ag.data)} às {ag.hora}
        </div>
        {!noShow ? <Toggle checked={porEstabelecimento} onChange={setPorEstabelecimento} label="Cancelamento pelo estabelecimento – reembolso integral" /> : null}
        {sim.loading && !s ? <Loading label="Calculando reembolso..." /> : null}
        <ErrorBanner message={sim.error} />
        {s ? (
          <div className="ag-reembolso">
            <div className="ag-reembolso-regra">
              <span className="badge badge-info">{REGRA_REEMBOLSO[s.regra] || s.regra}</span>
              <span className="small">{s.descricao}</span>
            </div>
            <div className="ag-reembolso-grid">
              <div>
                <div className="small muted">Valor pago</div>
                <div className="strong">{brl(s.valorPago)}</div>
              </div>
              <div>
                <div className="small muted">Percentual</div>
                <div className="strong">{pct(s.percentual)}</div>
              </div>
              {s.taxaDescontada ? (
                <div>
                  <div className="small muted">Taxa descontada</div>
                  <div className="strong">− {brl(s.taxaDescontada)}</div>
                </div>
              ) : null}
              <div className="ag-reembolso-valor">
                <div className="small muted">Será devolvido</div>
                <div>{brl(s.valor)}</div>
              </div>
            </div>
            {s.valorPago === 0 ? <div className="small muted">Nenhum valor foi pago neste agendamento.</div> : <div className="small muted">O reembolso é executado automaticamente após a confirmação e o horário é liberado.</div>}
          </div>
        ) : null}
        <Field label="Motivo (opcional)">
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={noShow ? 'Cliente não compareceu' : 'Ex.: cliente pediu para cancelar'} />
        </Field>
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}

// ---------- pagamento no local ----------

export function PagamentoLocalModal({ ag, onClose, onDone }: { ag: Agendamento; onClose: () => void; onDone: (msg: string) => void }) {
  const [forma, setForma] = useState<'DINHEIRO' | 'MAQUININHA' | 'PIX'>('DINHEIRO')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pixAg, setPixAg] = useState<Agendamento | null>(null)
  const pix = pagamentoPixPendente(pixAg)

  async function confirmar() {
    setBusy(true)
    setError('')
    try {
      const r = await post<Agendamento>(`/agenda/agendamentos/${ag.id}/pagamento-local`, { forma })
      if (forma === 'PIX') {
        setPixAg(r)
        onDone('Pix gerado. Mostre o QR code ao cliente.')
      } else {
        onDone('Pagamento registrado. Agendamento confirmado.')
        onClose()
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Registrar pagamento no local"
      onClose={onClose}
      footer={
        pixAg ? (
          <button className="btn btn-primary" onClick={onClose}>
            Concluir
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={busy}>
              Voltar
            </button>
            <button className="btn btn-primary" onClick={confirmar} disabled={busy}>
              {busy ? 'Aguarde…' : forma === 'PIX' ? 'Gerar Pix' : 'Registrar pagamento'}
            </button>
          </>
        )
      }
    >
      <div className="stack">
        {pixAg ? (
          pix ? (
            <PixBox pagamento={pix} />
          ) : (
            <div className="banner info-banner">Pix gerado. Atualize o painel se o QR code não aparecer.</div>
          )
        ) : (
          <>
            <div className="row-between">
              <span className="muted">Valor do agendamento</span>
              <strong className="ag-big">{brl(ag.valorTotal)}</strong>
            </div>
            <Field label="Forma de pagamento">
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
            </Field>
            <div className="small muted">A cobrança online pendente é cancelada. {forma === 'PIX' ? 'O agendamento é confirmado quando o Pix for aprovado.' : 'O agendamento é confirmado na hora.'}</div>
          </>
        )}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}

// ---------- adicionar produto ----------

export function AdicionarProdutoModal({ ag, refs, onClose, onDone }: { ag: Agendamento; refs: Referencias; onClose: () => void; onDone: (msg: string) => void }) {
  const disponiveis = refs.produtos.filter((p) => p.ativo !== false)
  const [produtoId, setProdutoId] = useState(disponiveis[0]?.id || '')
  const [quantidade, setQuantidade] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const produto = disponiveis.find((p) => p.id === produtoId)

  async function confirmar() {
    if (!produtoId) return setError('Escolha o produto.')
    setBusy(true)
    setError('')
    try {
      await post(`/agenda/agendamentos/${ag.id}/produtos`, { produtoId, quantidade })
      onDone('Produto adicionado ao atendimento.')
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Adicionar produto"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Voltar
          </button>
          <button className="btn btn-primary" onClick={confirmar} disabled={busy || !produtoId}>
            {busy ? 'Aguarde…' : 'Adicionar'}
          </button>
        </>
      }
    >
      <div className="stack">
        {!disponiveis.length ? <div className="banner info-banner">Nenhum produto ativo disponível para venda.</div> : null}
        <div className="form-grid">
          <Field label="Produto" className="full">
            <select className="select" value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
              {disponiveis.map((p) => (
                <option key={p.id} value={p.id} disabled={p.estoque <= 0}>
                  {p.nome} — {brl(p.preco)} ({p.estoque} em estoque)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantidade">
            <input type="number" className="input" min={1} max={99} value={quantidade} onChange={(e) => setQuantidade(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Subtotal">
            <div className="ag-big">{brl((produto?.preco || 0) * quantidade)}</div>
          </Field>
        </div>
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}

// ---------- reagendar ----------

export function ReagendarModal({ ag, refs, onClose, onDone }: { ag: Agendamento; refs: Referencias; onClose: () => void; onDone: (msg: string) => void }) {
  const { usuario } = useAuth()
  const [data, setData] = useState(ag.data)
  const [hora, setHora] = useState('')
  const [profissionalId, setProfissionalId] = useState(ag.profissionalId)
  const [conflitos, setConflitos] = useState<Conflito[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const servicoIds = ag.servicos.map((s) => s.servicoId)
  const habilitados = refs.profissionais.filter((p) => {
    if (usuario?.perfil === 'PROFISSIONAL' && p.id !== usuario.profissionalId) return false
    return servicoIds.every((id) => {
      const s = refs.servicos.find((x) => x.id === id)
      return s ? s.profissionalIds.includes(p.id) : p.id === ag.profissionalId
    })
  })

  async function salvar(encaixe: boolean) {
    if (!/^\d{2}:\d{2}$/.test(hora)) return setError('Escolha o novo horário.')
    setBusy(true)
    setError('')
    try {
      await post(`/agenda/agendamentos/${ag.id}/reagendar`, { data, hora, profissionalId, encaixe })
      onDone(`Reagendado para ${dateBr(data)} às ${hora}. O cliente foi avisado automaticamente.`)
      onClose()
    } catch (e) {
      const c = conflitosDoErro(e)
      if (c) setConflitos(c)
      else setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Reagendar"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Voltar
          </button>
          {conflitos ? (
            <button className="btn btn-danger" onClick={() => salvar(true)} disabled={busy}>
              {busy ? 'Aguarde…' : 'Confirmar encaixe'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => salvar(false)} disabled={busy}>
              {busy ? 'Aguarde…' : 'Reagendar'}
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="ag-subcard small">
          <strong>{ag.cliente?.nome}</strong> · {ag.servicos.map((s) => s.nome).join(' + ')}
          <div className="muted">
            Atual: {dateLong(ag.data)}, {ag.hora}–{ag.horaFim} com {ag.profissional?.nome}
          </div>
        </div>
        <div className="form-grid">
          <Field label="Nova data">
            <input
              type="date"
              className="input"
              value={data}
              onChange={(e) => {
                setData(e.target.value)
                setConflitos(null)
              }}
            />
          </Field>
          <Field label="Profissional">
            <select
              className="select"
              value={profissionalId}
              onChange={(e) => {
                setProfissionalId(e.target.value)
                setConflitos(null)
              }}
            >
              {habilitados.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Horários livres">
          <HorariosPicker
            servicoIds={servicoIds}
            data={data}
            profissionalId={profissionalId}
            excluirAgendamentoId={ag.id}
            value={hora}
            onChange={(h) => {
              setHora(h)
              setConflitos(null)
            }}
          />
        </Field>
        <div className="small muted">O pagamento continua vinculado e o cliente é avisado automaticamente da nova data.</div>
        {conflitos ? <ConflitosAviso conflitos={conflitos} /> : null}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}

// ---------- finalizar ----------

type RetornoAcao = 'ACEITAR' | 'ALTERAR' | 'AGENDAR' | 'SEM'

export function FinalizarModal({
  agendamentoId,
  refs,
  onClose,
  onDone,
}: {
  agendamentoId: string
  refs: Referencias
  onClose: () => void
  onDone: (msg: string, proximo?: { ag: Agendamento; data: string }) => void
}) {
  const previa = useAsync(() => get<PreviaFinalizacao>(`/agenda/agendamentos/${agendamentoId}/finalizacao`), [agendamentoId])
  const [realizados, setRealizados] = useState<string[]>([])
  const [adicionais, setAdicionais] = useState<Array<{ produtoId: string; quantidade: number }>>([])
  const [forma, setForma] = useState<'' | 'DINHEIRO' | 'MAQUININHA' | 'PIX'>('')
  const [retorno, setRetorno] = useState<RetornoAcao>('SEM')
  const [retornoData, setRetornoData] = useState(addDays(todayStr(), 30))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pixAg, setPixAg] = useState<Agendamento | null>(null)

  const p = previa.data
  const ag = p?.agendamento
  useEffect(() => {
    if (!p) return
    setRealizados(p.agendamento.servicos.map((s) => s.id))
    setRetorno(p.retornoSugerido ? 'ACEITAR' : 'SEM')
    if (p.retornoSugerido) setRetornoData(p.retornoSugerido)
  }, [p])

  const emAberto = useMemo(() => {
    if (!ag) return 0
    const reducao = ag.servicos.filter((s) => !realizados.includes(s.id)).reduce((acc, s) => acc + s.preco, 0)
    const extra = adicionais.reduce((acc, a) => acc + (refs.produtos.find((x) => x.id === a.produtoId)?.preco || 0) * a.quantidade, 0)
    return Math.max(0, Math.max(0, ag.valorTotal - reducao) + extra - valorPago(ag))
  }, [ag, realizados, adicionais, refs.produtos])

  async function confirmar() {
    if (!ag) return
    if (!realizados.length) return setError('Confirme pelo menos um serviço realizado.')
    if (emAberto > 0 && !forma) return setError('Informe a forma de pagamento do valor em aberto.')
    if (retorno === 'ALTERAR' && !/^\d{4}-\d{2}-\d{2}$/.test(retornoData)) return setError('Informe a data do retorno.')
    setBusy(true)
    setError('')
    try {
      const r = await post<Agendamento>(`/agenda/agendamentos/${ag.id}/finalizar`, {
        servicosRealizados: realizados,
        produtosAdicionais: adicionais.filter((a) => a.produtoId && a.quantidade > 0),
        formaPagamento: emAberto > 0 ? forma : undefined,
        retorno: {
          acao: retorno === 'AGENDAR' ? (p?.retornoSugerido ? 'ACEITAR' : 'SEM') : retorno,
          data: retorno === 'ALTERAR' ? retornoData : undefined,
        },
      })
      const msg = 'Atendimento finalizado.'
      if (emAberto > 0 && forma === 'PIX' && pagamentoPixPendente(r)) {
        setPixAg(r)
        onDone(`${msg} Mostre o QR code do Pix ao cliente.`)
        return
      }
      if (retorno === 'AGENDAR') onDone(msg, { ag: r, data: p?.retornoSugerido || addDays(todayStr(), 7) })
      else onDone(msg)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const pixPend = pagamentoPixPendente(pixAg)
  if (pixAg) {
    return (
      <Modal
        title="Pix do atendimento"
        onClose={onClose}
        footer={
          <button
            className="btn btn-primary"
            onClick={() => {
              if (retorno === 'AGENDAR') onDone('Atendimento finalizado.', { ag: pixAg, data: p?.retornoSugerido || addDays(todayStr(), 7) })
              onClose()
            }}
          >
            {retorno === 'AGENDAR' ? 'Concluir e agendar o próximo' : 'Concluir'}
          </button>
        }
      >
        {pixPend ? <PixBox pagamento={pixPend} /> : <div className="banner info-banner">Pix gerado.</div>}
      </Modal>
    )
  }

  return (
    <Modal
      title="Finalizar atendimento"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Voltar
          </button>
          <button className="btn btn-primary" onClick={confirmar} disabled={busy || !ag}>
            {busy ? 'Finalizando…' : retorno === 'AGENDAR' ? 'Finalizar e agendar o próximo' : 'Finalizar'}
          </button>
        </>
      }
    >
      {!ag ? (
        previa.loading ? (
          <Loading />
        ) : (
          <ErrorBanner message={previa.error || 'Não foi possível carregar.'} />
        )
      ) : (
        <div className="stack ag-form">
          <div className="small muted">
            {ag.cliente?.nome} · {dateLong(ag.data)}, {ag.hora}–{ag.horaFim}
            {!ag.iniciadoEm ? ' · finalizando sem ter clicado em Iniciar' : ''}
          </div>

          <section className="ag-step">
            <div className="ag-step-title">Serviços realizados</div>
            {ag.servicos.map((s) => (
              <label key={s.id} className="checkbox ag-check-line">
                <input type="checkbox" checked={realizados.includes(s.id)} onChange={(e) => setRealizados(e.target.checked ? [...realizados, s.id] : realizados.filter((x) => x !== s.id))} />
                <span style={{ flex: 1 }}>{s.nome}</span>
                <span className="muted small">{brl(s.preco)}</span>
              </label>
            ))}
          </section>

          {refs.venderProdutos ? (
            <section className="ag-step">
              <div className="ag-step-title">Produtos vendidos agora</div>
              {ag.produtos.length ? (
                <div className="small muted">
                  Já no agendamento: {ag.produtos.map((x) => `${x.quantidade}× ${x.nome}`).join(', ')}
                </div>
              ) : null}
              {adicionais.map((a, i) => (
                <div key={i} className="row">
                  <select className="select input-sm" style={{ flex: 1, minWidth: 180 }} value={a.produtoId} onChange={(e) => setAdicionais(adicionais.map((x, j) => (j === i ? { ...x, produtoId: e.target.value } : x)))}>
                    <option value="">Escolha…</option>
                    {refs.produtos
                      .filter((x) => x.ativo !== false)
                      .map((x) => (
                        <option key={x.id} value={x.id} disabled={x.estoque <= 0}>
                          {x.nome} — {brl(x.preco)} ({x.estoque} em estoque)
                        </option>
                      ))}
                  </select>
                  <input type="number" className="input input-sm ag-w-80" min={1} max={99} value={a.quantidade} onChange={(e) => setAdicionais(adicionais.map((x, j) => (j === i ? { ...x, quantidade: Math.max(1, Number(e.target.value) || 1) } : x)))} />
                  <button type="button" className="icon-btn" onClick={() => setAdicionais(adicionais.filter((_, j) => j !== i))} aria-label="Remover">
                    ×
                  </button>
                </div>
              ))}
              <div>
                <button type="button" className="btn btn-sm" onClick={() => setAdicionais([...adicionais, { produtoId: '', quantidade: 1 }])}>
                  + Adicionar produto
                </button>
              </div>
            </section>
          ) : null}

          <section className="ag-step">
            <div className="ag-step-title">Pagamento</div>
            {emAberto > 0 ? (
              <>
                <div className="row-between">
                  <span>Valor em aberto</span>
                  <strong className="ag-big">{brl(emAberto)}</strong>
                </div>
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
              </>
            ) : (
              <div className="small success-text">Nada em aberto: o valor já foi pago.</div>
            )}
          </section>

          <section className="ag-step">
            <div className="ag-step-title">Retorno do cliente</div>
            {p?.retornoSugerido ? (
              <div className="small">
                Retorno sugerido: <strong>{dateLong(p.retornoSugerido)}</strong>
              </div>
            ) : (
              <div className="small muted">Os serviços não têm retorno recomendado cadastrado.</div>
            )}
            <div className="ag-radio-list">
              {p?.retornoSugerido ? (
                <label className="checkbox">
                  <input type="radio" name="retorno" checked={retorno === 'ACEITAR'} onChange={() => setRetorno('ACEITAR')} /> Aceitar a data sugerida
                </label>
              ) : null}
              <label className="checkbox">
                <input type="radio" name="retorno" checked={retorno === 'ALTERAR'} onChange={() => setRetorno('ALTERAR')} /> Alterar a data
              </label>
              {retorno === 'ALTERAR' ? <input type="date" className="input input-sm ag-w-170 ag-indent" value={retornoData} onChange={(e) => setRetornoData(e.target.value)} /> : null}
              <label className="checkbox">
                <input type="radio" name="retorno" checked={retorno === 'AGENDAR'} onChange={() => setRetorno('AGENDAR')} /> Agendar o próximo agora
              </label>
              <label className="checkbox">
                <input type="radio" name="retorno" checked={retorno === 'SEM'} onChange={() => setRetorno('SEM')} /> Sem previsão
              </label>
            </div>
          </section>
          <ErrorBanner message={error} />
        </div>
      )}
    </Modal>
  )
}
