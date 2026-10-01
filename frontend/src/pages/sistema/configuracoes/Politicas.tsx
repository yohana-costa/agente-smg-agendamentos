import { useState } from 'react'
import { patch } from '../../../lib/api'
import { Card, Field, Segmented } from '../../../components/ui'
import { SaveBar, useSalvar, type ConfigDados } from './shared'

type Unidade = 'horas' | 'dias'

function inicial(min: number): { valor: string; unidade: Unidade } {
  if (min > 0 && min % 1440 === 0) return { valor: String(min / 1440), unidade: 'dias' }
  return { valor: String(Math.round((min / 60) * 100) / 100), unidade: 'horas' }
}

function hm(totalMin: number) {
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h${String(m).padStart(2, '0')}`
}

/** "Prazo de 3 horas em um agendamento às 13h significa cancelar até 9h59." */
function exemplo(prazoMin: number, valor: string, unidade: Unidade) {
  const n = Number(valor) || 0
  const prazoTxt = `${valor.replace('.', ',')} ${unidade === 'dias' ? (n === 1 ? 'dia' : 'dias') : n === 1 ? 'hora' : 'horas'}`
  if (prazoMin <= 0) return { prazoTxt, limite: 'até 12h59 (qualquer momento antes do horário)' }
  const total = 13 * 60 - prazoMin - 1
  const diasAntes = total >= 0 ? 0 : Math.ceil(-total / 1440)
  const minutoDoDia = ((total % 1440) + 1440) % 1440
  const quando = diasAntes === 0 ? '' : diasAntes === 1 ? ' do dia anterior' : ` de ${diasAntes} dias antes`
  return { prazoTxt, limite: `até ${hm(minutoDoDia)}${quando}` }
}

function Percentual({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="cf-pct">
      <input type="range" min={0} max={100} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="input-group">
        <input className="input input-sm" type="number" min={0} max={100} value={value} onChange={(e) => onChange(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))} />
        <span className="addon">%</span>
      </div>
    </div>
  )
}

export function Politicas({ dados, onChange }: { dados: ConfigDados; onChange: (p: Partial<ConfigDados>) => void }) {
  const p = dados.politicas
  const ini = inicial(p.prazoCancelamentoMin)
  const [valor, setValor] = useState(ini.valor)
  const [unidade, setUnidade] = useState<Unidade>(ini.unidade)
  const [foraPrazo, setForaPrazo] = useState(p.reembolsoForaPrazoPct)
  const [noShow, setNoShow] = useState(p.reembolsoNoShowPct)
  const [descontaTaxa, setDescontaTaxa] = useState(p.reembolsoIntegralDescontaTaxa)
  const s = useSalvar()

  const prazoMin = Math.max(0, Math.round((Number(valor) || 0) * (unidade === 'dias' ? 1440 : 60)))
  const ex = exemplo(prazoMin, valor || '0', unidade)

  const salvar = () =>
    s.salvar(async () => {
      if (prazoMin > 60 * 24 * 60) throw new Error('O prazo máximo é de 60 dias.')
      const body = { prazoCancelamentoMin: prazoMin, reembolsoForaPrazoPct: foraPrazo, reembolsoNoShowPct: noShow, reembolsoIntegralDescontaTaxa: descontaTaxa }
      await patch('/configuracoes/politicas', body)
      onChange({ politicas: body })
    }, 'Políticas salvas. Elas valem para novos cancelamentos, no-shows e reagendamentos.')

  return (
    <div className="stack">
      <Card title="Cancelamento dentro do prazo" subtitle="Cancelamentos feitos com esta antecedência recebem reembolso integral. Dentro do prazo, o reagendamento mantém o pagamento.">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Prazo de cancelamento com reembolso integral">
            <div className="row">
              <input className="input" style={{ width: 110 }} type="number" min={0} step={unidade === 'horas' ? 0.5 : 1} value={valor} onChange={(e) => setValor(e.target.value)} />
              <Segmented
                options={[
                  { key: 'horas', label: 'Horas' },
                  { key: 'dias', label: 'Dias' },
                ]}
                value={unidade}
                onChange={setUnidade}
              />
              <span className="muted small">antes do horário</span>
            </div>
          </Field>
        </div>
        <div className="cf-example" style={{ marginTop: 12 }}>
          Prazo de <strong>{ex.prazoTxt}</strong> em um agendamento às <strong>13h</strong> significa cancelar <strong>{ex.limite}</strong> para ter reembolso integral.
        </div>
      </Card>

      <Card title="Fora do prazo e no-show" subtitle="Percentual do valor total pago que volta para o cliente. As taxas do gateway saem da parte que fica com o estabelecimento.">
        <div className="form-grid">
          <Field label="Reembolso para cancelamento fora do prazo" hint="Fora do prazo, o reagendamento também aplica esta regra e o novo horário exige novo pagamento.">
            <Percentual value={foraPrazo} onChange={setForaPrazo} />
          </Field>
          <Field label="Reembolso para no-show" hint="Cancelar depois do horário marcado conta como no-show.">
            <Percentual value={noShow} onChange={setNoShow} />
          </Field>
        </div>
      </Card>

      <Card title="Taxa do gateway em reembolso integral" subtitle="A taxa do gateway já foi cobrada no pagamento. Defina quem arca com ela quando o reembolso é integral (cancelamento dentro do prazo).">
        <label className={`cf-radio ${!descontaTaxa ? 'active' : ''}`}>
          <input type="radio" name="taxa" checked={!descontaTaxa} onChange={() => setDescontaTaxa(false)} />
          <div>
            <div className="cf-radio-title">Estabelecimento absorve a taxa</div>
            <div className="cf-radio-sub">O cliente recebe 100% do valor pago. A taxa do gateway fica como custo do estabelecimento.</div>
          </div>
        </label>
        <label className={`cf-radio ${descontaTaxa ? 'active' : ''}`}>
          <input type="radio" name="taxa" checked={descontaTaxa} onChange={() => setDescontaTaxa(true)} />
          <div>
            <div className="cf-radio-title">Descontar a taxa do valor devolvido</div>
            <div className="cf-radio-sub">O cliente recebe o valor pago menos a taxa do gateway. A tela de cancelamento sempre mostra o valor exato antes de confirmar.</div>
          </div>
        </label>
      </Card>

      <SaveBar {...s} onSave={salvar} label="Salvar políticas" />
    </div>
  )
}
