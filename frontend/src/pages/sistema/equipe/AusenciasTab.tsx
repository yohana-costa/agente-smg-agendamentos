import { useState } from 'react'
import { del, errorMessage, post } from '../../../lib/api'
import { todayStr } from '../../../lib/format'
import { navigate } from '../../../lib/router'
import { useAuth } from '../../../lib/auth'
import { ConfirmModal, Empty, ErrorBanner, Field, SuccessBanner } from '../../../components/ui'
import type { Ausencia } from './tipos'

function descreverPeriodo(a: Ausencia) {
  const ini = new Date(a.inicio)
  const fim = new Date(a.fim)
  const data = (d: Date) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  const hora = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const meiaNoite = (d: Date) => d.getHours() === 0 && d.getMinutes() === 0
  if (meiaNoite(ini) && meiaNoite(fim)) {
    const ultimoDia = new Date(fim.getTime() - 60000)
    const mesmoDia = ini.toDateString() === ultimoDia.toDateString()
    return { titulo: mesmoDia ? data(ini) : `${data(ini)} a ${data(ultimoDia)}`, sub: 'Dia inteiro' }
  }
  if (ini.toDateString() === fim.toDateString()) return { titulo: data(ini), sub: `Das ${hora(ini)} às ${hora(fim)}` }
  return { titulo: `${data(ini)} ${hora(ini)} a ${data(fim)} ${hora(fim)}`, sub: 'Período' }
}

export default function AusenciasTab({ profissionalId, ausencias, onChanged }: { profissionalId: string; ausencias: Ausencia[]; onChanged: () => void }) {
  const { podeVer } = useAuth()
  const vazio = { dataInicio: todayStr(), dataFim: '', parcial: false, horaInicio: '09:00', horaFim: '12:00', motivo: '' }
  const [form, setForm] = useState(vazio)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [aviso, setAviso] = useState(0)
  const [remover, setRemover] = useState<Ausencia | null>(null)

  async function adicionar() {
    if (!form.dataInicio) return setError('Informe a data inicial.')
    if (form.dataFim && form.dataFim < form.dataInicio) return setError('A data final deve ser igual ou posterior à inicial.')
    const mesmoDia = !form.dataFim || form.dataFim === form.dataInicio
    if (form.parcial && (!form.horaInicio || !form.horaFim || (mesmoDia && form.horaFim <= form.horaInicio))) return setError('Informe um horário válido.')
    setSaving(true)
    setError('')
    setOk('')
    setAviso(0)
    try {
      const r = await post<{ agendamentosNoPeriodo: number }>(`/equipe/${profissionalId}/ausencias`, {
        dataInicio: form.dataInicio,
        dataFim: form.dataFim || undefined,
        horaInicio: form.parcial ? form.horaInicio : undefined,
        horaFim: form.parcial ? form.horaFim : undefined,
        motivo: form.motivo.trim() || undefined,
      })
      setOk('Ausência registrada. Os horários deixam de ser oferecidos no site e pelo agente.')
      setAviso(r.agendamentosNoPeriodo || 0)
      setForm(vazio)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="stack">
        <div className="strong">Próximas folgas e ausências</div>
        {ausencias.length === 0 ? (
          <div className="table-wrap">
            <Empty icon="🌴">Nenhuma ausência programada.</Empty>
          </div>
        ) : (
          <div className="table-wrap">
            {ausencias.map((a) => {
              const p = descreverPeriodo(a)
              return (
                <div key={a.id} className="eq-aus-item">
                  <span className="eq-aus-icon">🌴</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="strong">{p.titulo}</div>
                    <div className="small muted">
                      {p.sub}
                      {a.motivo ? ` · ${a.motivo}` : ''}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-ghost" onClick={() => setRemover(a)}>
                    Remover
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 0 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>
          Programar folga ou ausência
        </div>
        <div className="stack">
          <div className="form-grid">
            <Field label="Data inicial *">
              <input className="input" type="date" value={form.dataInicio} onChange={(e) => setForm({ ...form, dataInicio: e.target.value })} />
            </Field>
            <Field label="Data final" hint="Deixe vazio para um único dia.">
              <input className="input" type="date" value={form.dataFim} min={form.dataInicio} onChange={(e) => setForm({ ...form, dataFim: e.target.value })} />
            </Field>
            <div className="full">
              <label className="checkbox">
                <input type="checkbox" checked={form.parcial} onChange={(e) => setForm({ ...form, parcial: e.target.checked })} />
                Apenas algumas horas
              </label>
            </div>
            {form.parcial ? (
              <>
                <Field label="Das">
                  <input className="input" type="time" value={form.horaInicio} onChange={(e) => setForm({ ...form, horaInicio: e.target.value })} />
                </Field>
                <Field label="Até">
                  <input className="input" type="time" value={form.horaFim} onChange={(e) => setForm({ ...form, horaFim: e.target.value })} />
                </Field>
              </>
            ) : null}
            <Field label="Motivo" className="full">
              <input className="input" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="Ex.: férias, consulta médica, curso" />
            </Field>
          </div>
          <ErrorBanner message={error} />
          <SuccessBanner message={ok} />
          {aviso > 0 ? (
            <div className="banner warning-banner">
              <div>
                <strong>Atenção:</strong> há {aviso} agendamento(s) ativo(s) neste período. Reagende ou cancele pela Agenda para avisar os clientes.
                {podeVer('agenda') ? (
                  <div style={{ marginTop: 6 }}>
                    <button className="btn btn-sm" onClick={() => navigate(`/app/agenda?profissional=${encodeURIComponent(profissionalId)}`)}>
                      Abrir agenda
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={adicionar} disabled={saving}>
              {saving ? 'Salvando...' : 'Adicionar ausência'}
            </button>
          </div>
        </div>
      </div>

      {remover ? (
        <ConfirmModal
          title="Remover ausência"
          danger
          confirmLabel="Remover"
          onClose={() => setRemover(null)}
          onConfirm={async () => {
            await del(`/equipe/ausencias/${remover.id}`)
            setOk('Ausência removida.')
            setAviso(0)
            onChanged()
          }}
        >
          <p>
            Remover a ausência de <strong>{descreverPeriodo(remover).titulo}</strong>? Os horários voltam a ficar disponíveis para agendamento.
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  )
}
