import { useEffect, useState } from 'react'
import { errorMessage, put } from '../../../lib/api'
import { WEEKDAYS } from '../../../lib/format'
import { ErrorBanner, SuccessBanner, Toggle } from '../../../components/ui'
import type { JornadaDia } from './tipos'

const ORDEM = [1, 2, 3, 4, 5, 6, 0]

function normalizar(jornada: JornadaDia[]): JornadaDia[] {
  return Array.from({ length: 7 }, (_, dia) => {
    const j = jornada.find((x) => x.diaSemana === dia)
    return {
      diaSemana: dia,
      trabalha: j ? j.trabalha : false,
      inicio: j?.inicio || '08:00',
      fim: j?.fim || '18:00',
      pausas: Array.isArray(j?.pausas) ? j!.pausas.map((p) => ({ inicio: p.inicio, fim: p.fim })) : [],
    }
  })
}

function validar(dias: JornadaDia[]) {
  for (const d of dias) {
    if (!d.trabalha) continue
    const nome = WEEKDAYS[d.diaSemana]
    if (!d.inicio || !d.fim || d.fim <= d.inicio) return `${nome}: o fim da jornada deve ser depois do início.`
    for (const p of d.pausas) {
      if (!p.inicio || !p.fim || p.fim <= p.inicio) return `${nome}: pausa com horário inválido.`
      if (p.inicio < d.inicio || p.fim > d.fim) return `${nome}: a pausa ${p.inicio}–${p.fim} está fora da jornada.`
    }
    const ord = [...d.pausas].sort((a, b) => a.inicio.localeCompare(b.inicio))
    for (let i = 1; i < ord.length; i += 1) if (ord[i].inicio < ord[i - 1].fim) return `${nome}: há pausas sobrepostas.`
  }
  return ''
}

export default function JornadaEditor({ profissionalId, jornada, onSaved }: { profissionalId: string; jornada: JornadaDia[]; onSaved: () => void }) {
  const [dias, setDias] = useState<JornadaDia[]>(() => normalizar(jornada))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [sujo, setSujo] = useState(false)

  useEffect(() => {
    setDias(normalizar(jornada))
    setSujo(false)
  }, [jornada])

  function update(dia: number, fn: (d: JornadaDia) => JornadaDia) {
    setDias((prev) => prev.map((d) => (d.diaSemana === dia ? fn(d) : d)))
    setSujo(true)
    setOk('')
  }

  function copiarParaTodos(origem: JornadaDia) {
    setDias((prev) => prev.map((d) => (d.trabalha && d.diaSemana !== origem.diaSemana ? { ...d, inicio: origem.inicio, fim: origem.fim, pausas: origem.pausas.map((p) => ({ ...p })) } : d)))
    setSujo(true)
    setOk('')
  }

  async function salvar() {
    const v = validar(dias)
    if (v) {
      setError(v)
      return
    }
    setSaving(true)
    setError('')
    setOk('')
    try {
      await put(`/equipe/${profissionalId}/jornada`, { jornada: dias })
      setOk('Jornada semanal salva. A agenda já considera os novos horários.')
      setSujo(false)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const horasSemana = dias.reduce((acc, d) => {
    if (!d.trabalha) return acc
    const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
    const pausas = d.pausas.reduce((s, p) => s + Math.max(0, min(p.fim) - min(p.inicio)), 0)
    return acc + Math.max(0, min(d.fim) - min(d.inicio) - pausas)
  }, 0)

  return (
    <div className="stack">
      <div className="row-between">
        <div className="muted small">
          Dias de trabalho, horários e pausas fixas. Total: <strong>{Math.round((horasSemana / 60) * 10) / 10}h</strong> por semana.
        </div>
        {sujo ? <span className="badge badge-warning">Alterações não salvas</span> : null}
      </div>
      <div className="eq-jornada">
        {ORDEM.map((idx) => {
          const d = dias[idx]
          return (
            <div key={idx} className={`eq-dia ${d.trabalha ? '' : 'eq-folga'}`}>
              <div className="eq-dia-nome">
                <Toggle checked={d.trabalha} onChange={(v) => update(idx, (x) => ({ ...x, trabalha: v }))} />
                {WEEKDAYS[idx]}
              </div>
              {d.trabalha ? (
                <div className="eq-dia-body">
                  <div className="eq-time-row">
                    <input className="input input-sm" type="time" value={d.inicio} onChange={(e) => update(idx, (x) => ({ ...x, inicio: e.target.value }))} />
                    <span className="muted">às</span>
                    <input className="input input-sm" type="time" value={d.fim} onChange={(e) => update(idx, (x) => ({ ...x, fim: e.target.value }))} />
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => update(idx, (x) => ({ ...x, pausas: [...x.pausas, { inicio: '12:00', fim: '13:00' }] }))}
                    >
                      + Pausa
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" title="Aplicar estes horários e pausas aos demais dias de trabalho" onClick={() => copiarParaTodos(d)}>
                      Copiar para os outros dias
                    </button>
                  </div>
                  {d.pausas.map((p, i) => (
                    <div className="eq-pausa" key={i}>
                      <span className="small muted">Pausa</span>
                      <input
                        className="input input-sm"
                        type="time"
                        value={p.inicio}
                        onChange={(e) => update(idx, (x) => ({ ...x, pausas: x.pausas.map((pp, j) => (j === i ? { ...pp, inicio: e.target.value } : pp)) }))}
                      />
                      <span className="muted">às</span>
                      <input
                        className="input input-sm"
                        type="time"
                        value={p.fim}
                        onChange={(e) => update(idx, (x) => ({ ...x, pausas: x.pausas.map((pp, j) => (j === i ? { ...pp, fim: e.target.value } : pp)) }))}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Remover pausa"
                        title="Remover pausa"
                        onClick={() => update(idx, (x) => ({ ...x, pausas: x.pausas.filter((_, j) => j !== i) }))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ alignSelf: 'center' }}>
                  Folga
                </div>
              )}
            </div>
          )
        })}
      </div>
      <ErrorBanner message={error} />
      <SuccessBanner message={ok} />
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn" onClick={() => { setDias(normalizar(jornada)); setSujo(false); setError('') }} disabled={saving || !sujo}>
          Descartar
        </button>
        <button className="btn btn-primary" onClick={salvar} disabled={saving || !sujo}>
          {saving ? 'Salvando...' : 'Salvar jornada'}
        </button>
      </div>
    </div>
  )
}
