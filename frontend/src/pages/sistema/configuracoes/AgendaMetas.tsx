import { useState } from 'react'
import { patch } from '../../../lib/api'
import { brl, duration } from '../../../lib/format'
import { Card, Field, MoneyInput } from '../../../components/ui'
import { SaveBar, useSalvar, type ConfigDados } from './shared'

const INTERVALOS = [15, 30, 60, 90, 120]

export function AgendaCfg({ dados, onChange }: { dados: ConfigDados; onChange: (p: Partial<ConfigDados>) => void }) {
  const [tolerancia, setTolerancia] = useState(String(dados.agenda.toleranciaPendenteMin))
  const [intervalo, setIntervalo] = useState(dados.agenda.intervaloSlotsMin)
  const [custom, setCustom] = useState(!INTERVALOS.includes(dados.agenda.intervaloSlotsMin))
  const s = useSalvar()

  const salvar = () =>
    s.salvar(async () => {
      const tol = Math.round(Number(tolerancia))
      if (!(tol >= 0 && tol <= 240)) throw new Error('A tolerância deve ser entre 0 e 240 minutos.')
      if (!(intervalo >= 5 && intervalo <= 240)) throw new Error('O intervalo dos horários deve ser entre 5 e 240 minutos.')
      await patch('/configuracoes/agenda', { toleranciaPendenteMin: tol, intervaloSlotsMin: intervalo })
      onChange({ agenda: { toleranciaPendenteMin: tol, intervaloSlotsMin: intervalo } })
    }, 'Configurações da agenda salvas.')

  const exemploSlots = (() => {
    const out: string[] = []
    for (let m = 9 * 60; m <= 12 * 60 && out.length < 6 && intervalo > 0; m += intervalo) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
    return out
  })()

  return (
    <Card title="Agenda" subtitle="Regras de operação da agenda, do site e do agente.">
      <div className="stack">
        <Field
          label="Tolerância para Pendente de finalização"
          hint="Depois do horário previsto de término mais esta tolerância, o atendimento não finalizado vira Pendente de finalização. Padrão: 10 minutos."
        >
          <div className="input-group" style={{ maxWidth: 180 }}>
            <input className="input" type="number" min={0} max={240} value={tolerancia} onChange={(e) => setTolerancia(e.target.value)} />
            <span className="addon">min</span>
          </div>
        </Field>
        <Field label="Intervalo dos horários oferecidos no site e no agente" hint="O site e o agente oferecem horários neste intervalo fixo. Padrão: 1 hora.">
          <div className="row">
            <div className="chips">
              {INTERVALOS.map((i) => (
                <button
                  key={i}
                  type="button"
                  className={`chip ${!custom && intervalo === i ? 'active' : ''}`}
                  onClick={() => {
                    setCustom(false)
                    setIntervalo(i)
                  }}
                >
                  {duration(i)}
                </button>
              ))}
              <button type="button" className={`chip ${custom ? 'active' : ''}`} onClick={() => setCustom(true)}>
                Personalizado
              </button>
            </div>
            {custom ? (
              <div className="input-group" style={{ width: 150 }}>
                <input className="input input-sm" type="number" min={5} max={240} value={intervalo} onChange={(e) => setIntervalo(Math.round(Number(e.target.value) || 0))} />
                <span className="addon">min</span>
              </div>
            ) : null}
          </div>
        </Field>
        {exemploSlots.length ? (
          <div className="small muted">
            Exemplo de horários oferecidos a partir das 9h: <strong>{exemploSlots.join(', ')}</strong>… (somente onde cabem a duração total e o intervalo do serviço).
          </div>
        ) : null}
      </div>
      <SaveBar {...s} onSave={salvar} />
    </Card>
  )
}

export function Metas({ dados, onChange }: { dados: ConfigDados; onChange: (p: Partial<ConfigDados>) => void }) {
  const [servicos, setServicos] = useState(String(dados.metas.metaServicosMes || 0))
  const [valor, setValor] = useState(dados.metas.metaValorMes || 0)
  const s = useSalvar()

  const salvar = () =>
    s.salvar(async () => {
      const n = Math.max(0, Math.round(Number(servicos) || 0))
      await patch('/configuracoes/metas', { metaServicosMes: n, metaValorMes: valor })
      onChange({ metas: { metaServicosMes: n, metaValorMes: valor } })
    }, 'Metas salvas.')

  const n = Math.max(0, Math.round(Number(servicos) || 0))
  return (
    <Card title="Metas do mês" subtitle="Meta geral do estabelecimento. O progresso aparece na Visão Geral, no Financeiro e no Desempenho. Metas individuais ficam na aba Equipe.">
      <div className="form-grid">
        <Field label="Meta de serviços por mês">
          <div className="input-group">
            <input className="input" type="number" min={0} value={servicos} onChange={(e) => setServicos(e.target.value)} />
            <span className="addon">serviços</span>
          </div>
        </Field>
        <Field label="Meta de faturamento por mês">
          <MoneyInput value={valor} onChange={setValor} />
        </Field>
      </div>
      {n > 0 && valor > 0 ? (
        <div className="small muted" style={{ marginTop: 10 }}>
          Ticket médio implícito: <strong>{brl(Math.round(valor / n))}</strong> por serviço.
        </div>
      ) : null}
      <SaveBar {...s} onSave={salvar} />
    </Card>
  )
}
