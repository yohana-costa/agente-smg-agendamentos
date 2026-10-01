import { useState } from 'react'
import { errorMessage, get, post } from '../../../lib/api'
import { brl, dateTimeBr, FORMA_PAGAMENTO, ORIGEM, phone } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Loading, PeriodFilter, periodoMesAtual, Segmented, type Periodo } from '../../../components/ui'
import { STATUS_VENDA, type Venda } from './types'

type FiltroOrigem = 'TODAS' | 'SITE' | 'BALCAO'

export default function VendasList({ refreshKey }: { refreshKey: number }) {
  const [periodo, setPeriodo] = useState<Periodo>(periodoMesAtual())
  const [origem, setOrigem] = useState<FiltroOrigem>('TODAS')
  const [pendentes, setPendentes] = useState(false)
  const [marcando, setMarcando] = useState<string | null>(null)
  const [erro, setErro] = useState('')

  const { data, loading, error, setData } = useAsync(
    () =>
      get<Venda[]>('/produtos/vendas', {
        de: periodo.de,
        ate: periodo.ate,
        origem: origem === 'TODAS' ? undefined : origem,
        pendentesRetirada: pendentes ? 'true' : undefined,
      }),
    [periodo.de, periodo.ate, origem, pendentes, refreshKey]
  )

  async function marcarRetirado(v: Venda, retirado: boolean) {
    setMarcando(v.id)
    setErro('')
    try {
      const r = await post<Venda>(`/produtos/vendas/${v.id}/retirado`, { retirado })
      setData((lista) => (lista ? lista.map((x) => (x.id === v.id ? { ...x, retirado: r.retirado, retiradoEm: r.retiradoEm } : x)) : lista))
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setMarcando(null)
    }
  }

  const lista = data || []
  const pagas = lista.filter((v) => v.status === 'PAGO')
  const totalPago = pagas.reduce((acc, v) => acc + v.valorTotal, 0)
  const aguardandoRetirada = lista.filter((v) => v.origem === 'SITE' && v.status === 'PAGO' && !v.retirado).length

  return (
    <Card
      title="Vendas de produtos"
      subtitle={
        <>
          {pagas.length} venda(s) paga(s) · {brl(totalPago)}
          {aguardandoRetirada ? <> · <span className="strong" style={{ color: 'var(--amber)' }}>{aguardandoRetirada} aguardando retirada</span></> : null}
        </>
      }
    >
      <div className="stack">
        <div className="row-between">
          <PeriodFilter value={periodo} onChange={setPeriodo} />
          <div className="row">
            <Segmented<FiltroOrigem>
              value={origem}
              onChange={setOrigem}
              options={[
                { key: 'TODAS', label: 'Todas' },
                { key: 'SITE', label: 'Site' },
                { key: 'BALCAO', label: 'Balcão' },
              ]}
            />
            <label className="checkbox small">
              <input type="checkbox" checked={pendentes} onChange={(e) => setPendentes(e.target.checked)} />
              Só pendentes de retirada
            </label>
          </div>
        </div>
        <ErrorBanner message={erro || error} />
        {loading && !data ? (
          <Loading />
        ) : !lista.length ? (
          <Empty icon="🛍">Nenhuma venda no período.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Origem</th>
                  <th>Cliente</th>
                  <th>Itens</th>
                  <th>Pagamento</th>
                  <th className="right">Total</th>
                  <th>Status</th>
                  <th>Retirada</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((v) => {
                  const pg = v.pagamentos.find((p) => p.status === 'APROVADO') || v.pagamentos[0]
                  const st = STATUS_VENDA[v.status] || { label: v.status, cls: '' }
                  return (
                    <tr key={v.id}>
                      <td className="nowrap">{dateTimeBr(v.createdAt)}</td>
                      <td>
                        <span className={`badge ${v.origem === 'SITE' ? 'badge-info' : 'badge-primary'}`}>{ORIGEM[v.origem] || v.origem}</span>
                      </td>
                      <td>
                        {v.cliente ? (
                          <>
                            <div className="strong">{v.cliente.nome}</div>
                            <div className="small muted">{phone(v.cliente.telefone)}</div>
                          </>
                        ) : (
                          <span className="muted">Não informado</span>
                        )}
                      </td>
                      <td className="sv-itens">{v.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(', ')}</td>
                      <td className="nowrap">{pg ? (pg.modo === 'ONLINE' ? `Online${pg.forma ? ` · ${FORMA_PAGAMENTO[pg.forma]}` : ''}` : FORMA_PAGAMENTO[pg.forma || ''] || '—') : '—'}</td>
                      <td className="right strong nowrap">{brl(v.valorTotal)}</td>
                      <td>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                      </td>
                      <td>
                        {v.origem === 'SITE' ? (
                          v.status === 'PAGO' ? (
                            <label className="checkbox small" title={v.retiradoEm ? `Retirado em ${dateTimeBr(v.retiradoEm)}` : 'Marcar entrega ao cliente'}>
                              <input type="checkbox" checked={v.retirado} disabled={marcando === v.id} onChange={(e) => marcarRetirado(v, e.target.checked)} />
                              {v.retirado ? <span className="success-text strong">Retirado</span> : <span style={{ color: 'var(--amber)' }}>Aguardando</span>}
                            </label>
                          ) : (
                            <span className="muted small">—</span>
                          )
                        ) : (
                          <span className="muted small">No balcão</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}
