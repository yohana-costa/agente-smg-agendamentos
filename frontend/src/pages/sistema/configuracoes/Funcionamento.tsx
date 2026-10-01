import { useState } from 'react'
import { put } from '../../../lib/api'
import { WEEKDAYS } from '../../../lib/format'
import { Card, Toggle } from '../../../components/ui'
import { SaveBar, useSalvar, type ConfigDados, type HorarioDia } from './shared'

const ORDEM = [1, 2, 3, 4, 5, 6, 0]

function montar(lista: HorarioDia[]): HorarioDia[] {
  return ORDEM.map((d) => {
    const h = lista.find((x) => x.diaSemana === d)
    return h ? { diaSemana: d, aberto: h.aberto, inicio: h.inicio, fim: h.fim } : { diaSemana: d, aberto: d >= 1 && d <= 5, inicio: '08:00', fim: '18:00' }
  })
}

export function Funcionamento({ dados, onChange }: { dados: ConfigDados; onChange: (p: Partial<ConfigDados>) => void }) {
  const [dias, setDias] = useState<HorarioDia[]>(() => montar(dados.funcionamento))
  const s = useSalvar()

  const set = (d: number, patchDia: Partial<HorarioDia>) => setDias((l) => l.map((x) => (x.diaSemana === d ? { ...x, ...patchDia } : x)))

  const salvar = () =>
    s.salvar(async () => {
      const invalido = dias.find((d) => d.aberto && (!d.inicio || !d.fim || d.fim <= d.inicio))
      if (invalido) throw new Error(`${WEEKDAYS[invalido.diaSemana]}: o horário de fechamento deve ser depois da abertura.`)
      const r = await put<HorarioDia[]>('/configuracoes/funcionamento', { funcionamento: dias })
      onChange({ funcionamento: r })
      setDias(montar(r))
    }, 'Horário de funcionamento salvo.')

  const copiarSegunda = () => {
    const seg = dias.find((d) => d.diaSemana === 1)
    if (!seg) return
    setDias((l) => l.map((x) => (x.aberto && x.diaSemana !== 1 ? { ...x, inicio: seg.inicio, fim: seg.fim } : x)))
  }

  return (
    <Card
      title="Funcionamento"
      subtitle="Dias e horários da rotina do estabelecimento."
      actions={
        <button className="btn btn-sm btn-ghost" onClick={copiarSegunda}>
          Copiar horário de segunda para os dias abertos
        </button>
      }
    >
      <div className="banner info-banner" style={{ marginBottom: 12 }}>
        Dias marcados como fechados aqui são fechados da rotina (por exemplo, sábado e domingo) e não contam como capacidade perdida. Fechamentos pontuais feitos na Agenda, em dias normalmente abertos, aparecem como capacidade perdida no Desempenho.
      </div>
      <div className="cf-days">
        {dias.map((d) => (
          <div className="cf-day" key={d.diaSemana}>
            <div className="cf-day-name">{WEEKDAYS[d.diaSemana]}</div>
            <Toggle checked={d.aberto} onChange={(aberto) => set(d.diaSemana, { aberto })} label={<span className="small">{d.aberto ? 'Aberto' : 'Fechado'}</span>} />
            {d.aberto ? (
              <div className="cf-day-times">
                <input className="input input-sm" type="time" value={d.inicio} onChange={(e) => set(d.diaSemana, { inicio: e.target.value })} />
                <span className="muted">às</span>
                <input className="input input-sm" type="time" value={d.fim} onChange={(e) => set(d.diaSemana, { fim: e.target.value })} />
              </div>
            ) : (
              <span className="cf-closed">Fechado na rotina</span>
            )}
          </div>
        ))}
      </div>
      <SaveBar {...s} onSave={salvar} />
    </Card>
  )
}
