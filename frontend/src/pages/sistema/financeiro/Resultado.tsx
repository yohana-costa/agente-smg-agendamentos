import { get } from '../../../lib/api'
import { brl, MONTHS, pct, todayStr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, ErrorBanner, Loading, Progress, Stat, type Periodo } from '../../../components/ui'
import type { Resultado as ResultadoT } from './types'

export default function Resultado({ periodo }: { periodo: Periodo }) {
  const { data, loading, error } = useAsync(() => get<ResultadoT>('/financeiro/resultado', { de: periodo.de, ate: periodo.ate }), [periodo.de, periodo.ate])

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBanner message={error} />
  if (!data) return null

  const fat = data.faturamento
  const parte = (v: number) => (fat ? <span className="fi-dre-pct">{pct((v / fat) * 100)}</span> : null)
  const linhas: Array<{ label: string; valor: number; tipo: 'pos' | 'sub' }> = [
    { label: 'Faturamento', valor: data.faturamento, tipo: 'pos' },
    { label: 'Reembolsos', valor: data.reembolsos, tipo: 'sub' },
    { label: 'Taxas do gateway', valor: data.taxas, tipo: 'sub' },
    { label: 'Comissões e remuneração', valor: data.comissoes, tipo: 'sub' },
    { label: 'Despesas', valor: data.despesas, tipo: 'sub' },
  ]
  const margemFinal = fat ? (data.resultado / fat) * 100 : 0
  const mesAtual = MONTHS[Number(todayStr().slice(5, 7)) - 1]
  const meta = data.metaMes

  return (
    <div className="stack">
      <div className="stats-grid">
        <Stat label="Faturamento" value={brl(data.faturamento)} />
        <Stat label="Saídas" value={<span className="fi-neg">{brl(data.reembolsos + data.taxas + data.comissoes + data.despesas)}</span>} hint="Reembolsos, taxas, comissões e despesas" />
        <Stat label="Resultado final" value={<span className={data.resultado < 0 ? 'fi-neg' : 'success-text'}>{brl(data.resultado)}</span>} hint={fat ? `Margem de ${pct(margemFinal)}` : undefined} />
      </div>
      <div className="grid-2">
        <Card title="Resultado do período" subtitle="Tudo o que entrou, saiu e sobrou.">
          <div className="fi-dre">
            {linhas.map((l) => (
              <div key={l.label} className={`fi-dre-row ${l.tipo === 'pos' ? 'fi-pos' : 'fi-sub'}`}>
                <span className="fi-dre-lbl">
                  <span className="fi-dre-sign">{l.tipo === 'pos' ? '+' : '−'}</span>
                  {l.label}
                </span>
                <span className="strong nowrap">
                  {l.tipo === 'sub' && l.valor ? '− ' : ''}
                  {brl(l.valor)}
                  {l.tipo === 'sub' ? parte(l.valor) : null}
                </span>
              </div>
            ))}
            <div className="fi-dre-total">
              <span>Resultado final</span>
              <span className={data.resultado < 0 ? 'fi-neg' : 'success-text'}>{brl(data.resultado)}</span>
            </div>
          </div>
        </Card>
        <Card title={`Meta geral de ${mesAtual.toLowerCase()}`} subtitle="Faturamento do mês atual, já descontados os reembolsos.">
          {meta.meta > 0 ? (
            <div className="stack">
              <div>
                <span className="fi-meta-num">{brl(meta.realizado)}</span> <span className="muted">de {brl(meta.meta)}</span>
              </div>
              <Progress value={meta.progresso} label={<><span>{pct(meta.progresso)} da meta</span><span className="muted">{meta.realizado >= meta.meta ? 'Meta atingida 🎉' : `Faltam ${brl(meta.meta - meta.realizado)}`}</span></>} />
            </div>
          ) : (
            <div className="stack">
              <div>
                <span className="fi-meta-num">{brl(meta.realizado)}</span> <span className="muted">no mês</span>
              </div>
              <div className="small muted">Nenhuma meta de valor definida. Defina a meta geral do mês em Configurações.</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
