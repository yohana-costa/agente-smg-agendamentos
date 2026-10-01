import { useState } from 'react'
import { get } from '../../../lib/api'
import { brl, dateBr, pct, dateTimeBr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, ErrorBanner, Loading, PeriodFilter, periodoMesAtual, Progress, Stat, type Periodo } from '../../../components/ui'
import type { Resultados } from './tipos'

export default function ResultadosTab({ profissionalId, mostraFinanceiro, mostraRemuneracao }: { profissionalId: string; mostraFinanceiro: boolean; mostraRemuneracao: boolean }) {
  const [periodo, setPeriodo] = useState<Periodo>(periodoMesAtual())
  const { data, loading, error } = useAsync(
    () => get<Resultados>(`/equipe/${profissionalId}/resultados`, { de: periodo.de, ate: periodo.ate }),
    [profissionalId, periodo.de, periodo.ate]
  )
  const rem = data?.remuneracao

  return (
    <div className="stack">
      <PeriodFilter value={periodo} onChange={setPeriodo} />
      <ErrorBanner message={error} />
      {!data ? (
        loading ? <Loading /> : null
      ) : (
        <div className="stack" style={{ opacity: loading ? 0.6 : 1 }}>
          <div className="muted small">
            Período: {dateBr(data.periodo.de)} a {dateBr(data.periodo.ate)}
          </div>
          <div className="stats-grid">
            <Stat label="Taxa de ocupação" value={pct(data.taxaOcupacao)} hint="Tempo ocupado ÷ tempo disponível" />
            <Stat label="Serviços realizados" value={data.servicosRealizados} hint="Atendimentos concluídos" />
            {mostraFinanceiro ? <Stat label="Faturamento gerado" value={brl(data.faturamento)} /> : null}
            {mostraRemuneracao && rem ? (
              <Stat
                label={rem.remuneracaoTipo === 'FIXO' ? 'Valor fixo a receber' : 'Comissão a receber'}
                value={brl(rem.valor)}
                hint={
                  rem.remuneracaoTipo === 'FIXO'
                    ? `${brl(rem.valorFixo)} por mês`
                    : `${rem.comissaoPct}% sobre ${brl(rem.baseServicos)} em serviços`
                }
              />
            ) : null}
          </div>

          {mostraRemuneracao && rem ? (
            <div>
              {rem.paga ? (
                <span className="badge badge-success">Pago{rem.pagaEm ? ` em ${dateTimeBr(rem.pagaEm)}` : ''}</span>
              ) : (
                <span className="badge badge-warning">Pagamento deste período ainda não registrado</span>
              )}
            </div>
          ) : null}

          <Card title="Progresso da meta individual" subtitle="A meta é mensal; o progresso considera o período selecionado.">
            <div className="eq-result-meta">
              {data.meta.servicos.meta > 0 ? (
                <Progress
                  value={data.meta.servicos.progresso}
                  label={
                    <>
                      <span>
                        Serviços: <strong>{data.meta.servicos.realizado}</strong> de {data.meta.servicos.meta}
                      </span>
                      <span className="muted">{pct(data.meta.servicos.progresso)}</span>
                    </>
                  }
                />
              ) : (
                <div className="small muted">Meta de serviços não definida.</div>
              )}
            </div>
            {mostraFinanceiro ? (
              <div className="eq-result-meta">
                {data.meta.valor.meta > 0 ? (
                  <Progress
                    value={data.meta.valor.progresso}
                    label={
                      <>
                        <span>
                          Valor: <strong>{brl(data.meta.valor.realizado)}</strong> de {brl(data.meta.valor.meta)}
                        </span>
                        <span className="muted">{pct(data.meta.valor.progresso)}</span>
                      </>
                    }
                  />
                ) : (
                  <div className="small muted">Meta de valor não definida.</div>
                )}
              </div>
            ) : null}
          </Card>
        </div>
      )}
    </div>
  )
}
