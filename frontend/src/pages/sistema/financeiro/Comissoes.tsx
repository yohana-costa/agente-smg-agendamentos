import { useState } from 'react'
import { CheckCircle2, Clock, Wallet } from 'lucide-react'
import { del, errorMessage, get, patch, post } from '../../../lib/api'
import { brl, dateBr, dateTimeBr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Loading, Modal, MoneyInput, Stat, SuccessBanner, type Periodo } from '../../../components/ui'
import type { Comissao, ComissaoItem, OrigemPct } from './types'

export default function Comissoes({ periodo }: { periodo: Periodo }) {
  const [detalhe, setDetalhe] = useState<Comissao | null>(null)
  const { data, loading, error, setData, reload } = useAsync(
    () => get<{ periodo: { de: string; ate: string }; comissoes: Comissao[] }>('/financeiro/comissoes', { de: periodo.de, ate: periodo.ate }),
    [periodo.de, periodo.ate]
  )
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [msg, setMsg] = useState('')

  async function marcar(c: Comissao, paga: boolean) {
    setSalvando(c.profissionalId)
    setErro('')
    try {
      if (paga) {
        const r = await post<{ pagoEm: string; valor: number }>('/financeiro/comissoes/pagar', { de: periodo.de, ate: periodo.ate, profissionalId: c.profissionalId })
        setData((d) => (d ? { ...d, comissoes: d.comissoes.map((x) => (x.profissionalId === c.profissionalId ? { ...x, paga: true, pagaEm: r.pagoEm } : x)) } : d))
        setMsg(`Pagamento de ${brl(c.valor)} para ${c.nome} marcado como pago.`)
      } else {
        await del('/financeiro/comissoes/pagar', { de: periodo.de, ate: periodo.ate, profissionalId: c.profissionalId })
        setData((d) => (d ? { ...d, comissoes: d.comissoes.map((x) => (x.profissionalId === c.profissionalId ? { ...x, paga: false, pagaEm: null } : x)) } : d))
        setMsg(`Pagamento de ${c.nome} desmarcado.`)
      }
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(null)
    }
  }

  const lista = data?.comissoes || []
  const total = lista.reduce((a, c) => a + c.valor, 0)
  const pago = lista.filter((c) => c.paga).reduce((a, c) => a + c.valor, 0)

  return (
    <div className="stack">
      <SuccessBanner message={msg} />
      <ErrorBanner message={erro} />
      <div className="stats-grid">
        <Stat icon={Wallet} grad="indigo" label="Total a pagar no período" value={brl(total)} hint={`${lista.length} profissional(is)`} />
        <Stat icon={CheckCircle2} grad="lime" label="Já pago" value={<span className="success-text">{brl(pago)}</span>} />
        <Stat icon={Clock} grad="amber" label="Pendente" value={<span className={total - pago > 0 ? 'fi-neg' : ''}>{brl(total - pago)}</span>} />
      </div>
      <Card title="Comissões e remuneração" subtitle={`Período ${dateBr(periodo.de)} a ${dateBr(periodo.ate)} · conforme a remuneração configurada na aba Equipe. A marcação de pago vale para este período exato.`}>
        <ErrorBanner message={error} />
        {loading && !data ? (
          <Loading />
        ) : !lista.length ? (
          <Empty icon="👥">Nenhum profissional cadastrado.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Profissional</th>
                  <th>Remuneração</th>
                  <th className="right">Serviços</th>
                  <th className="right">Base (serviços)</th>
                  <th className="right">Valor a pagar</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.profissionalId}>
                    <td className="strong">{c.nome}</td>
                    <td>{c.remuneracaoTipo === 'FIXO' ? <span className="badge badge-info">Fixo · {brl(c.valorFixo)}/mês</span> : <span className="badge badge-primary">Comissão · {textoPcts(c)}</span>}</td>
                    <td className="right">
                      {c.servicosRealizados ? (
                        <button className="btn btn-sm btn-ghost" title="Ver e corrigir os serviços" onClick={() => setDetalhe(c)}>
                          {c.servicosRealizados} · ver serviços
                        </button>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="right nowrap">{brl(c.baseServicos)}</td>
                    <td className="right strong nowrap">{brl(c.valor)}</td>
                    <td>
                      {c.paga ? (
                        <>
                          <span className="badge badge-success" title={c.pagaEm ? `Pago em ${dateTimeBr(c.pagaEm)}` : undefined}>
                            Pago{c.pagaEm ? ` em ${dateTimeBr(c.pagaEm).slice(0, 10)}` : ''}
                          </span>
                          {c.valorPago !== null && c.valorPago !== c.valor ? (
                            <div className="small danger-text">
                              Foi pago {brl(c.valorPago)}; com as correções o valor é {brl(c.valor)}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="badge badge-warning">Pendente</span>
                      )}
                    </td>
                    <td className="right">
                      {c.paga ? (
                        <button className="btn btn-sm btn-ghost" disabled={salvando === c.profissionalId} onClick={() => marcar(c, false)}>
                          {salvando === c.profissionalId ? 'Aguarde...' : 'Desmarcar'}
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-primary" disabled={salvando === c.profissionalId || c.valor <= 0} onClick={() => marcar(c, true)}>
                          {salvando === c.profissionalId ? 'Aguarde...' : 'Marcar como pago'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="right nowrap">{brl(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      {detalhe ? <ServicosModal profissional={detalhe} periodo={periodo} onClose={() => setDetalhe(null)} onChanged={reload} /> : null}
    </div>
  )
}

function textoPcts(c: Comissao) {
  const p = c.pctsAplicadas || []
  if (!p.length) return `${c.comissaoPct}%`
  if (p.length === 1) return `${p[0]}%`
  return `${p[0]}% a ${p[p.length - 1]}% (por serviço)`
}

const ORIGEM_PCT: Record<OrigemPct, string> = {
  MANUAL: 'corrigida aqui',
  PROFISSIONAL_SERVICO: 'da profissional neste serviço',
  SERVICO: 'do serviço',
  PROFISSIONAL: 'da profissional',
}

/** Servicos realizados no periodo, um por um: confere o valor e a % e corrige o que estiver errado. */
function ServicosModal({ profissional, periodo, onClose, onChanged }: { profissional: Comissao; periodo: Periodo; onClose: () => void; onChanged: () => void }) {
  const { data, loading, error, reload } = useAsync(
    () =>
      get<{ comissao: Comissao }>(`/financeiro/comissoes/${encodeURIComponent(profissional.profissionalId)}/servicos`, { de: periodo.de, ate: periodo.ate }).then(
        (r) => r.comissao
      ),
    [profissional.profissionalId, periodo.de, periodo.ate]
  )
  const [editando, setEditando] = useState<string | null>(null)
  const itens = data?.itens || []

  return (
    <Modal title={`Serviços de ${profissional.nome}`} size="xl" onClose={onClose}>
      <div className="stack">
        <div className="small muted">
          {dateBr(periodo.de)} a {dateBr(periodo.ate)}. A % de cada serviço vem, nesta ordem: da correção feita aqui, da % da profissional naquele serviço (ficha da
          profissional), da % do cadastro do serviço e, por último, da % geral da profissional ({profissional.comissaoPct}%). Mudou uma %? A conta é refeita na hora para o
          período inteiro.
        </div>
        <ErrorBanner message={error} />
        {loading && !data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Serviço</th>
                  <th className="right">Valor</th>
                  <th className="right">%</th>
                  <th className="right">Comissão</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {itens.map((it) =>
                  editando === it.id ? (
                    <EditarItem
                      key={it.id}
                      item={it}
                      onCancel={() => setEditando(null)}
                      onSaved={() => {
                        setEditando(null)
                        reload()
                        onChanged()
                      }}
                    />
                  ) : (
                    <tr key={it.id}>
                      <td className="nowrap" data-label="Data">
                        {dateTimeBr(it.inicio)}
                      </td>
                      <td data-label="Cliente">{it.cliente}</td>
                      <td data-label="Serviço">
                        {it.servico}
                        {it.pacote ? (
                          <span className="badge badge-info" style={{ marginLeft: 6 }}>
                            Pacote
                          </span>
                        ) : null}
                      </td>
                      <td className="right nowrap" data-label="Valor">
                        {brl(it.base)}
                        {it.baseManual ? <div className="small muted">corrigido (era {brl(it.baseCalculada)})</div> : null}
                      </td>
                      <td className="right nowrap" data-label="%">
                        {it.pct}%<div className="small muted">{ORIGEM_PCT[it.origemPct]}</div>
                      </td>
                      <td className="right strong nowrap" data-label="Comissão">
                        {brl(it.comissao)}
                      </td>
                      <td className="right">
                        <button className="btn btn-sm" onClick={() => setEditando(it.id)}>
                          Corrigir
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
              {data ? (
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total ({itens.length} serviços)</td>
                    <td className="right nowrap">{brl(data.baseServicos)}</td>
                    <td />
                    <td className="right nowrap">{brl(data.valor)}</td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
        {data?.remuneracaoTipo === 'FIXO' ? <div className="small muted">Esta profissional recebe valor fixo: as % acima não mudam o que ela recebe.</div> : null}
      </div>
    </Modal>
  )
}

function EditarItem({ item, onCancel, onSaved }: { item: ComissaoItem; onCancel: () => void; onSaved: () => void }) {
  const [base, setBase] = useState(item.base)
  const [pct, setPct] = useState(String(item.pct))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const n = Number(pct)
  const valido = pct.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100

  async function salvar(body: { comissaoBase: number | null; comissaoPct: number | null }) {
    setSalvando(true)
    setErro('')
    try {
      await patch(`/financeiro/comissoes/itens/${item.id}`, body)
      onSaved()
    } catch (e) {
      setErro(errorMessage(e))
      setSalvando(false)
    }
  }

  return (
    <tr>
      <td colSpan={7}>
        <div className="stack-sm">
          <div className="strong small">
            {dateTimeBr(item.inicio)} · {item.cliente} · {item.servico}
          </div>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label className="stack-sm small" style={{ width: 170 }}>
              Valor do serviço
              <MoneyInput value={base} onChange={setBase} />
            </label>
            <label className="stack-sm small" style={{ width: 90 }}>
              %
              <input className="input" type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} />
            </label>
            <div className="small">
              Comissão: <strong>{valido ? brl(Math.round((base * n) / 100)) : '-'}</strong>
            </div>
          </div>
          <div className="small muted">A correção vale só para a comissão deste serviço. O valor cobrado da cliente não muda.</div>
          <ErrorBanner message={erro} />
          <div className="row">
            <button
              className="btn btn-primary btn-sm"
              disabled={salvando || !valido}
              onClick={() =>
                salvar({
                  comissaoBase: !item.baseManual && base === item.baseCalculada ? null : base,
                  comissaoPct: item.origemPct !== 'MANUAL' && n === item.pct ? null : n,
                })
              }
            >
              {salvando ? 'Salvando…' : 'Salvar correção'}
            </button>
            {item.baseManual || item.origemPct === 'MANUAL' ? (
              <button className="btn btn-sm" disabled={salvando} onClick={() => salvar({ comissaoBase: null, comissaoPct: null })}>
                Voltar ao calculado
              </button>
            ) : null}
            <button className="btn btn-ghost btn-sm" disabled={salvando} onClick={onCancel}>
              Voltar
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}
