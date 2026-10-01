import { useState } from 'react'
import { del, errorMessage, get, post } from '../../../lib/api'
import { brl, dateBr, dateTimeBr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Loading, Stat, SuccessBanner, type Periodo } from '../../../components/ui'
import type { Comissao } from './types'

export default function Comissoes({ periodo }: { periodo: Periodo }) {
  const { data, loading, error, setData } = useAsync(
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
        <Stat label="Total a pagar no período" value={brl(total)} hint={`${lista.length} profissional(is)`} />
        <Stat label="Já pago" value={<span className="success-text">{brl(pago)}</span>} />
        <Stat label="Pendente" value={<span className={total - pago > 0 ? 'fi-neg' : ''}>{brl(total - pago)}</span>} />
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
                    <td>{c.remuneracaoTipo === 'FIXO' ? <span className="badge badge-info">Fixo · {brl(c.valorFixo)}/mês</span> : <span className="badge badge-primary">Comissão · {c.comissaoPct}%</span>}</td>
                    <td className="right">{c.servicosRealizados}</td>
                    <td className="right nowrap">{brl(c.baseServicos)}</td>
                    <td className="right strong nowrap">{brl(c.valor)}</td>
                    <td>
                      {c.paga ? (
                        <span className="badge badge-success" title={c.pagaEm ? `Pago em ${dateTimeBr(c.pagaEm)}` : undefined}>
                          Pago{c.pagaEm ? ` em ${dateTimeBr(c.pagaEm).slice(0, 10)}` : ''}
                        </span>
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
    </div>
  )
}
