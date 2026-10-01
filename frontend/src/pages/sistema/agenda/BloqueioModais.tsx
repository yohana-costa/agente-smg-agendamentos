// Bloqueios de horario e fechamento de dias (escopo 6.8), com decisao por agendamento afetado.
import { useState } from 'react'
import { ApiError, del, errorMessage, get, post } from '../../../lib/api'
import { dateBr, dateLong, phone, todayStr, weekdayOf, WEEKDAYS } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { useAuth } from '../../../lib/auth'
import { ConfirmModal, Empty, ErrorBanner, Field, Loading, Modal, Segmented, StatusBadge, Toggle } from '../../../components/ui'
import type { Agendamento } from '../../../types'
import { RepeatIcon } from './icons'
import type { Afetado, BloqueioPrefill, BloqueioVisao, Referencias } from './types'
import { formatLocal, localParts, minutesStr } from './utils'
import { HorariosPicker } from './Widgets'

interface Decisao {
  agendamentoId: string
  acao: '' | 'CANCELAR' | 'REAGENDAR'
  data: string
  hora: string
  encaixe: boolean
}

function afetadosDoErro(err: unknown): Afetado[] | null {
  if (err instanceof ApiError && err.status === 409 && err.details?.requerDecisao) return (err.details.afetados || []) as Afetado[]
  return null
}

function useDecisoes() {
  const [afetados, setAfetados] = useState<Afetado[] | null>(null)
  const [decisoes, setDecisoes] = useState<Record<string, Decisao>>({})
  function receber(lista: Afetado[]) {
    setAfetados(lista)
    setDecisoes((prev) => {
      const next: Record<string, Decisao> = {}
      for (const a of lista) next[a.id] = prev[a.id] || { agendamentoId: a.id, acao: '', data: a.data, hora: '', encaixe: false }
      return next
    })
  }
  function validar(): string {
    if (!afetados) return ''
    for (const a of afetados) {
      const d = decisoes[a.id]
      if (!d?.acao) return `Escolha o que fazer com o agendamento de ${a.cliente} (${dateBr(a.data)} ${a.hora}).`
      if (d.acao === 'REAGENDAR' && (!/^\d{4}-\d{2}-\d{2}$/.test(d.data) || !/^\d{2}:\d{2}$/.test(d.hora))) return `Informe a nova data e horário para ${a.cliente}.`
    }
    return ''
  }
  const payload = () =>
    afetados
      ? afetados.map((a) => {
          const d = decisoes[a.id]
          return d.acao === 'REAGENDAR' ? { agendamentoId: a.id, acao: 'REAGENDAR', data: d.data, hora: d.hora, encaixe: d.encaixe } : { agendamentoId: a.id, acao: 'CANCELAR' }
        })
      : []
  return { afetados, decisoes, setDecisoes, receber, validar, payload }
}

function DecisoesAfetados({ afetados, decisoes, onChange }: { afetados: Afetado[]; decisoes: Record<string, Decisao>; onChange: (d: Record<string, Decisao>) => void }) {
  return (
    <div className="stack">
      <div className="banner warning-banner">
        <div>
          <strong>
            {afetados.length} {afetados.length === 1 ? 'agendamento será afetado' : 'agendamentos serão afetados'}.
          </strong>{' '}
          Decida para cada um: reagendar ou cancelar com reembolso integral. Os clientes são avisados automaticamente.
        </div>
      </div>
      {afetados.map((a) => {
        const d = decisoes[a.id]
        if (!d) return null
        const set = (patch: Partial<Decisao>) => onChange({ ...decisoes, [a.id]: { ...d, ...patch } })
        return (
          <div key={a.id} className="ag-afetado">
            <div className="row-between">
              <div>
                <div className="strong">
                  {dateBr(a.data)} às {a.hora} · {a.cliente}
                </div>
                <div className="small muted">
                  {a.servicos} · {a.profissional} · {phone(a.telefone)}
                </div>
              </div>
              <StatusBadge status={a.status} />
            </div>
            <Segmented
              options={[
                { key: 'CANCELAR', label: 'Cancelar com reembolso integral' },
                { key: 'REAGENDAR', label: 'Reagendar' },
              ]}
              value={d.acao || ('' as 'CANCELAR')}
              onChange={(acao) => set({ acao })}
            />
            {d.acao === 'REAGENDAR' ? <ReagendarAfetado agendamentoId={a.id} d={d} set={set} /> : null}
          </div>
        )
      })}
    </div>
  )
}

function ReagendarAfetado({ agendamentoId, d, set }: { agendamentoId: string; d: Decisao; set: (p: Partial<Decisao>) => void }) {
  const { data: ag } = useAsync(() => get<Agendamento>(`/agenda/agendamentos/${agendamentoId}`), [agendamentoId])
  return (
    <div className="stack-sm ag-indent">
      <div className="row">
        <span className="small muted">Nova data</span>
        <input type="date" className="input input-sm ag-w-170" value={d.data} onChange={(e) => set({ data: e.target.value, hora: '' })} />
      </div>
      {ag ? (
        <HorariosPicker servicoIds={ag.servicos.map((s) => s.servicoId)} data={d.data} profissionalId={ag.profissionalId} excluirAgendamentoId={ag.id} value={d.hora} onChange={(hora) => set({ hora })} />
      ) : (
        <div className="row">
          <span className="small muted">Horário</span>
          <input type="time" className="input input-sm ag-w-120" value={d.hora} onChange={(e) => set({ hora: e.target.value })} />
        </div>
      )}
      <label className="checkbox small">
        <input type="checkbox" checked={d.encaixe} onChange={(e) => set({ encaixe: e.target.checked })} /> Forçar encaixe se houver conflito
      </label>
    </div>
  )
}

// ---------- Bloquear horario ----------

export function BloquearHorarioModal({ refs, prefill, onClose, onDone }: { refs: Referencias; prefill: BloqueioPrefill; onClose: () => void; onDone: (msg: string) => void }) {
  const { usuario } = useAuth()
  const ehProfissional = usuario?.perfil === 'PROFISSIONAL'
  const profs = ehProfissional ? refs.profissionais.filter((p) => p.id === usuario?.profissionalId) : refs.profissionais
  const [profissionalId, setProfissionalId] = useState(prefill.profissionalId || (ehProfissional ? usuario?.profissionalId || '' : profs[0]?.id || ''))
  const [data, setData] = useState(prefill.data || todayStr())
  const [dataFim, setDataFim] = useState('')
  const [horaInicio, setHoraInicio] = useState(prefill.horaInicio || '12:00')
  const [horaFim, setHoraFim] = useState(prefill.horaInicio ? minutesStr(Math.min(1439, toMin(prefill.horaInicio) + 60)) : '13:00')
  const [motivo, setMotivo] = useState('')
  const [semanal, setSemanal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dec = useDecisoes()

  async function salvar() {
    setError('')
    if (!profissionalId) return setError('Escolha o profissional.')
    if (!data || !horaInicio || !horaFim) return setError('Informe a data e o período.')
    if (!dataFim && horaFim <= horaInicio) return setError('A hora final deve ser depois da inicial.')
    const v = dec.validar()
    if (v) return setError(v)
    setBusy(true)
    try {
      const r = await post<{ resultados: unknown[] }>('/agenda/bloqueios', {
        profissionalId,
        data,
        dataFim: !semanal && dataFim ? dataFim : undefined,
        horaInicio,
        horaFim,
        motivo: motivo.trim() || undefined,
        semanal,
        decisoes: dec.payload(),
      })
      onDone(`Horário bloqueado${r.resultados?.length ? ` e ${r.resultados.length} agendamento(s) tratado(s)` : ''}.`)
      onClose()
    } catch (e) {
      const af = afetadosDoErro(e)
      if (af) dec.receber(af)
      else setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Bloquear horário"
      size={dec.afetados?.length ? 'lg' : 'md'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={salvar} disabled={busy}>
            {busy ? 'Aguarde…' : dec.afetados?.length ? 'Aplicar decisões e bloquear' : 'Bloquear'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Profissional" className="full">
            <select className="select" value={profissionalId} onChange={(e) => setProfissionalId(e.target.value)} disabled={ehProfissional}>
              {profs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data">
            <input type="date" className="input" value={data} onChange={(e) => setData(e.target.value)} />
          </Field>
          <Field label="Até a data (opcional)" hint={semanal ? 'Não se aplica ao bloqueio semanal.' : 'Para bloqueios de vários dias.'}>
            <input type="date" className="input" value={dataFim} min={data} disabled={semanal} onChange={(e) => setDataFim(e.target.value)} />
          </Field>
          <Field label="Hora inicial">
            <input type="time" className="input" step={300} value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
          </Field>
          <Field label="Hora final">
            <input type="time" className="input" step={300} value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
          </Field>
          <Field label="Motivo" className="full">
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: consulta médica, curso, almoço estendido" />
          </Field>
          <div className="full">
            <Toggle checked={semanal} onChange={setSemanal} label={`Repetir toda semana${data ? ` (${WEEKDAYS[weekdayOf(data)].toLowerCase()})` : ''}`} />
          </div>
        </div>
        {dec.afetados ? <DecisoesAfetados afetados={dec.afetados} decisoes={dec.decisoes} onChange={dec.setDecisoes} /> : null}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}

function toMin(t: string) {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// ---------- Fechar dia ----------

export function FecharDiaModal({ dataInicial, onClose, onDone }: { dataInicial: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [data, setData] = useState(dataInicial)
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dec = useDecisoes()

  async function salvar() {
    setError('')
    if (!data) return setError('Informe a data.')
    const v = dec.validar()
    if (v) return setError(v)
    setBusy(true)
    try {
      await post('/agenda/dias-fechados', { data, motivo: motivo.trim() || undefined, decisoes: dec.payload() })
      onDone(`Dia ${dateBr(data)} fechado.`)
      onClose()
    } catch (e) {
      const af = afetadosDoErro(e)
      if (af) dec.receber(af)
      else setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Fechar dia"
      size={dec.afetados?.length ? 'lg' : 'md'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-danger" onClick={salvar} disabled={busy}>
            {busy ? 'Aguarde…' : dec.afetados?.length ? 'Aplicar decisões e fechar' : 'Fechar dia'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Data">
            <input
              type="date"
              className="input"
              value={data}
              onChange={(e) => {
                setData(e.target.value)
                dec.receber([])
              }}
            />
          </Field>
          <Field label="Motivo">
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: feriado, manutenção" />
          </Field>
        </div>
        <div className="small muted">{data ? `${dateLong(data)}. ` : ''}Em um dia de funcionamento normal, entra como fechado fora da rotina e conta como capacidade perdida.</div>
        {dec.afetados && dec.afetados.length ? <DecisoesAfetados afetados={dec.afetados} decisoes={dec.decisoes} onChange={dec.setDecisoes} /> : null}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}

// ---------- Detalhe de um bloqueio (clicado na grade) ----------

export function BloqueioDetalheModal({ bloqueio, readOnly, tz, profNome, onClose, onDone }: { bloqueio: BloqueioVisao; readOnly: boolean; tz: string; profNome: string; onClose: () => void; onDone: (msg: string) => void }) {
  const ini = localParts(bloqueio.inicio, tz)
  const fim = localParts(bloqueio.fim, tz)
  const descricao = bloqueio.semanal
    ? `Toda ${WEEKDAYS[weekdayOf(ini.date)].toLowerCase()}, das ${minutesStr(ini.minutes)} às ${minutesStr(fim.minutes)}`
    : ini.date === fim.date
      ? `${dateLong(ini.date)}, das ${minutesStr(ini.minutes)} às ${minutesStr(fim.minutes)}`
      : `De ${formatLocal(bloqueio.inicio, tz)} até ${formatLocal(bloqueio.fim, tz)}`
  if (readOnly || bloqueio.ausencia) {
    return (
      <Modal title={bloqueio.ausencia ? 'Folga / ausência' : 'Horário bloqueado'} onClose={onClose}>
        <BloqueioInfo motivo={bloqueio.motivo} descricao={descricao} profNome={profNome} semanal={bloqueio.semanal} />
        {bloqueio.ausencia ? <p className="small muted" style={{ marginTop: 10 }}>Folgas e ausências são gerenciadas na ficha do profissional, na aba Equipe.</p> : null}
      </Modal>
    )
  }
  return (
    <ConfirmModal
      title="Horário bloqueado"
      confirmLabel={bloqueio.semanal ? 'Remover bloqueio (todas as semanas)' : 'Remover bloqueio'}
      danger
      onClose={onClose}
      onConfirm={async () => {
        await del(`/agenda/bloqueios/${bloqueio.id}`)
        onDone('Bloqueio removido.')
      }}
    >
      <BloqueioInfo motivo={bloqueio.motivo} descricao={descricao} profNome={profNome} semanal={bloqueio.semanal} />
    </ConfirmModal>
  )
}

function BloqueioInfo({ motivo, descricao, profNome, semanal }: { motivo: string | null; descricao: string; profNome: string; semanal: boolean }) {
  return (
    <div className="stack-sm">
      <div className="strong">{motivo || 'Sem motivo informado'}</div>
      <div className="small">{descricao}</div>
      <div className="small muted">
        {profNome}
        {semanal ? ' · repete toda semana' : ''}
      </div>
    </div>
  )
}

// ---------- Gerenciar bloqueios e dias fechados ----------

interface BloqueioLista {
  id: string
  profissionalId: string
  inicio: string
  fim: string
  motivo: string | null
  semanal: boolean
  profissional?: { nome: string }
}

export function GerenciarBloqueiosModal({ tz, podeFecharDia, refreshKey, onClose, onDone }: { tz: string; podeFecharDia: boolean; refreshKey: number; onClose: () => void; onDone: (msg: string) => void }) {
  const { usuario } = useAuth()
  const { data, loading, error, reload } = useAsync(
    () => Promise.all([get<BloqueioLista[]>('/agenda/bloqueios'), get<Array<{ id: string; data: string; motivo: string | null }>>('/agenda/dias-fechados')]),
    [refreshKey]
  )
  const [remover, setRemover] = useState<{ tipo: 'bloqueio' | 'dia'; id: string; label: string } | null>(null)
  const [bloqueios, dias] = data || [[], []]

  function descricao(b: BloqueioLista) {
    const ini = localParts(b.inicio, tz)
    const fim = localParts(b.fim, tz)
    if (b.semanal) return `Toda ${WEEKDAYS[weekdayOf(ini.date)].toLowerCase()}, ${minutesStr(ini.minutes)}–${minutesStr(fim.minutes)} (desde ${dateBr(ini.date)})`
    if (ini.date === fim.date) return `${dateBr(ini.date)}, ${minutesStr(ini.minutes)}–${minutesStr(fim.minutes)}`
    return `${formatLocal(b.inicio, tz)} até ${formatLocal(b.fim, tz)}`
  }

  return (
    <>
      <Modal title="Bloqueios e dias fechados" size="lg" onClose={onClose}>
        {!data && loading ? (
          <Loading />
        ) : (
          <div className="stack">
            <ErrorBanner message={error} />
            <div className="section-title" style={{ marginTop: 0 }}>
              Bloqueios ativos
            </div>
            {!bloqueios.length ? (
              <Empty icon="—">Nenhum bloqueio ativo.</Empty>
            ) : (
              <div className="list ag-list-box">
                {bloqueios.map((b) => {
                  const pode = !(usuario?.perfil === 'PROFISSIONAL' && b.profissionalId !== usuario.profissionalId)
                  return (
                    <div key={b.id} className="list-item">
                      <div className="list-item-main">
                        <div className="list-item-title row" style={{ gap: 6 }}>
                          {b.motivo || 'Bloqueio'} {b.semanal ? <RepeatIcon /> : null}
                        </div>
                        <div className="list-item-sub">
                          {b.profissional?.nome} · {descricao(b)}
                        </div>
                      </div>
                      {pode ? (
                        <button className="btn btn-sm" onClick={() => setRemover({ tipo: 'bloqueio', id: b.id, label: `${b.motivo || 'Bloqueio'} — ${descricao(b)}` })}>
                          Remover
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
            <div className="section-title">Dias fechados fora da rotina</div>
            {!dias.length ? (
              <Empty icon="—">Nenhum dia fechado daqui para frente.</Empty>
            ) : (
              <div className="list ag-list-box">
                {dias.map((d) => (
                  <div key={d.id} className="list-item">
                    <div className="list-item-main">
                      <div className="list-item-title">{dateLong(d.data)}</div>
                      <div className="list-item-sub">{d.motivo || 'Sem motivo informado'}</div>
                    </div>
                    {podeFecharDia ? (
                      <button className="btn btn-sm" onClick={() => setRemover({ tipo: 'dia', id: d.id, label: dateLong(d.data) })}>
                        Reabrir
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
      {remover ? (
        <ConfirmModal
          title={remover.tipo === 'dia' ? 'Reabrir dia' : 'Remover bloqueio'}
          confirmLabel={remover.tipo === 'dia' ? 'Reabrir dia' : 'Remover'}
          danger={remover.tipo === 'bloqueio'}
          onClose={() => setRemover(null)}
          onConfirm={async () => {
            await del(remover.tipo === 'dia' ? `/agenda/dias-fechados/${remover.id}` : `/agenda/bloqueios/${remover.id}`)
            onDone(remover.tipo === 'dia' ? 'Dia reaberto.' : 'Bloqueio removido.')
            reload()
          }}
        >
          <div>{remover.label}</div>
          <div className="small muted">{remover.tipo === 'dia' ? 'Os horários deste dia voltam a ficar disponíveis.' : 'O período volta a ficar disponível para agendamentos.'}</div>
        </ConfirmModal>
      ) : null}
    </>
  )
}
