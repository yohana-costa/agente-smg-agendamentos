import { get } from '../../../lib/api'
import { brl, dateTimeBr, REGRA_REEMBOLSO } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Loading, Stat, type Periodo } from '../../../components/ui'
import type { Reembolso } from './types'

const REGRA_CLS: Record<string, string> = { DENTRO_PRAZO: 'badge-info', FORA_PRAZO: 'badge-warning', NO_SHOW: 'badge-danger', ESTABELECIMENTO: 'badge-gray' }

export default function Reembolsos({ periodo }: { periodo: Periodo }) {
  const { data, loading, error } = useAsync(() => get<Reembolso[]>('/financeiro/reembolsos', { de: periodo.de, ate: periodo.ate }), [periodo.de, periodo.ate])
  const lista = data || []
  const executados = lista.filter((r) => r.status === 'EXECUTADO')
  const falhas = lista.filter((r) => r.status === 'FALHOU')
  const total = executados.reduce((a, r) => a + r.valor, 0)
  const porRegra = (regra: string) => executados.filter((r) => r.regra === regra).reduce((a, r) => a + r.valor, 0)

  return (
    <div className="stack">
      <div className="stats-grid">
        <Stat label="Total devolvido" value={<span className="fi-neg">{brl(total)}</span>} hint={`${executados.length} reembolso(s) executado(s)`} />
        <Stat label="Dentro do prazo" value={brl(porRegra('DENTRO_PRAZO'))} />
        <Stat label="Fora do prazo" value={brl(porRegra('FORA_PRAZO'))} />
        <Stat label="No-show" value={brl(porRegra('NO_SHOW'))} />
      </div>
      {falhas.length ? (
        <div className="banner error-banner">
          {falhas.length} reembolso(s) falharam no gateway. Verifique os detalhes abaixo e, se necessário, devolva manualmente ao cliente.
        </div>
      ) : null}
      <Card title="Reembolsos" subtitle="Executados automaticamente ao registrar cancelamento ou no-show, conforme as políticas.">
        <ErrorBanner message={error} />
        {loading && !data ? (
          <Loading />
        ) : !lista.length ? (
          <Empty icon="↩">Nenhum reembolso no período.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Agendamento</th>
                  <th>Regra aplicada</th>
                  <th className="right">Percentual</th>
                  <th className="right">Valor devolvido</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{dateTimeBr(r.createdAt)}</td>
                    <td>{r.cliente?.nome || <span className="muted">—</span>}</td>
                    <td>
                      {r.agendamento ? (
                        <>
                          <div className="nowrap">{dateTimeBr(r.agendamento.inicio)}</div>
                          <div className="fi-servicos">{r.agendamento.servicos.map((s) => s.nome).join(' + ')}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${REGRA_CLS[r.regra] || ''}`}>{REGRA_REEMBOLSO[r.regra] || r.regra}</span>
                    </td>
                    <td className="right">{r.percentual}%</td>
                    <td className="right strong nowrap">{brl(r.valor)}</td>
                    <td>
                      {r.status === 'FALHOU' ? (
                        <>
                          <span className="badge badge-danger">Falhou</span>
                          {r.erro ? <div className="fi-erro">{r.erro}</div> : null}
                        </>
                      ) : (
                        <span className="badge badge-success">Executado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total devolvido</td>
                  <td className="right nowrap">{brl(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
