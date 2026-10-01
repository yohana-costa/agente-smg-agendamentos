// Componentes de formulario reutilizados nos modais da agenda.
import { useState } from 'react'
import { get, post, errorMessage } from '../../../lib/api'
import { brl, countdown, phone } from '../../../lib/format'
import { useAsync, useCountdown, useDebounced } from '../../../lib/hooks'
import { ErrorBanner, Field } from '../../../components/ui'
import type { Cliente, Conflito, Pagamento } from '../../../types'
import type { ClienteMin, HorariosResponse } from './types'
import { MOTIVO_FECHADO, pixSrc } from './utils'

// ---------- horarios livres ----------

export function HorariosPicker({
  servicoIds,
  data,
  profissionalId,
  excluirAgendamentoId,
  value,
  onChange,
  onPickProf,
  permitirEncaixe = true,
}: {
  servicoIds: string[]
  data: string
  profissionalId?: string
  excluirAgendamentoId?: string
  value: string
  onChange: (hora: string) => void
  /** quando nenhum profissional foi escolhido, clicar num horario tambem escolhe o profissional */
  onPickProf?: (profissionalId: string) => void
  permitirEncaixe?: boolean
}) {
  const key = servicoIds.join(',')
  const pronto = Boolean(key && /^\d{4}-\d{2}-\d{2}$/.test(data))
  const { data: r, loading, error } = useAsync<HorariosResponse | null>(
    () => (pronto ? get<HorariosResponse>('/agenda/horarios', { servicoIds: key, data, profissionalId: profissionalId || undefined, excluirAgendamentoId }) : Promise.resolve(null)),
    [key, data, profissionalId, excluirAgendamentoId]
  )
  const profs = r?.profissionais || []
  const todosHorarios = profs.flatMap((p) => p.horarios)
  const custom = value && !todosHorarios.includes(value)

  return (
    <div className="stack-sm">
      {!pronto ? <div className="small muted">Escolha os serviços e a data para ver os horários livres.</div> : null}
      {pronto && loading ? <div className="small muted">Buscando horários livres…</div> : null}
      <ErrorBanner message={error} />
      {pronto && !loading && r ? (
        profs.length === 0 ? (
          <div className="small muted">Nenhum profissional habilitado para todos os serviços escolhidos.</div>
        ) : (
          profs.map((p) => (
            <div key={p.profissionalId} className="ag-horarios-prof">
              {profs.length > 1 || !profissionalId ? (
                <div className="small strong row" style={{ gap: 6 }}>
                  <span className="dot" style={{ background: p.cor }} /> {p.nome}
                </div>
              ) : null}
              {p.horarios.length ? (
                <div className="chips">
                  {p.horarios.map((h) => (
                    <button
                      type="button"
                      key={h}
                      className={`chip ag-chip-time ${value === h && (!profissionalId || profissionalId === p.profissionalId) ? 'active' : ''}`}
                      onClick={() => {
                        onChange(h)
                        if (!profissionalId && onPickProf) onPickProf(p.profissionalId)
                      }}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="small muted">{p.motivo ? MOTIVO_FECHADO[p.motivo] || 'Sem expediente' : 'Sem horários livres nesta data.'}</div>
              )}
            </div>
          ))
        )
      ) : null}
      {permitirEncaixe ? (
        <div className="row ag-encaixe-row">
          <span className="small muted">Outro horário (encaixe):</span>
          <input type="time" className={`input input-sm ag-w-120 ${custom ? 'ag-input-active' : ''}`} step={300} value={value} onChange={(e) => onChange(e.target.value)} />
          {custom ? <span className="badge badge-warning">Horário personalizado: conflitos serão verificados ao salvar</span> : null}
        </div>
      ) : null}
    </div>
  )
}

// ---------- conflitos (encaixe) ----------

export function ConflitosAviso({ conflitos }: { conflitos: Conflito[] }) {
  return (
    <div className="banner warning-banner ag-conflitos">
      <div className="stack-sm" style={{ width: '100%' }}>
        <strong>Este horário tem conflitos:</strong>
        <ul>
          {conflitos.map((c, i) => (
            <li key={`${c.tipo}${c.id || i}`}>
              {c.descricao}
              {c.motivo ? ` (${c.motivo})` : ''}
            </li>
          ))}
        </ul>
        <span className="small">Para manter este horário, confirme o encaixe. O site e o agente nunca fazem encaixe.</span>
      </div>
    </div>
  )
}

// ---------- Pix na tela ----------

export function PixBox({ pagamento, segundosReserva }: { pagamento: Pagamento; segundosReserva?: number | null }) {
  const [copiado, setCopiado] = useState(false)
  const segundos = useCountdown(segundosReserva ?? null)
  return (
    <div className="ag-pix">
      <div className="ag-pix-qr">
        {pagamento.pixQrCode ? <img src={pixSrc(pagamento.pixQrCode)} alt="QR code Pix" /> : <div className="ag-pix-noqr small muted">QR code indisponível. Use o Pix copia e cola.</div>}
      </div>
      <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
        <div className="small muted">Valor</div>
        <div className="ag-pix-valor">{brl(pagamento.valorBruto)}</div>
        {segundos !== null ? <div className="small ag-countdown-inline">Reserva expira em {countdown(segundos)}</div> : null}
        {pagamento.pixCopiaCola ? (
          <>
            <div className="small muted">Pix copia e cola</div>
            <textarea className="textarea mono ag-pix-code" readOnly value={pagamento.pixCopiaCola} onFocus={(e) => e.currentTarget.select()} />
            <div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(pagamento.pixCopiaCola || '')
                    setCopiado(true)
                    setTimeout(() => setCopiado(false), 2000)
                  } catch {
                    setCopiado(false)
                  }
                }}
              >
                {copiado ? 'Copiado!' : 'Copiar código'}
              </button>
            </div>
          </>
        ) : null}
        <div className="small muted">A confirmação chega automaticamente quando o pagamento for aprovado.</div>
      </div>
    </div>
  )
}

// ---------- cliente: busca + cadastro rapido ----------

export function ClienteSelect({ value, onChange }: { value: ClienteMin | null; onChange: (c: ClienteMin | null) => void }) {
  const [busca, setBusca] = useState('')
  const termo = useDebounced(busca.trim(), 300)
  const [novo, setNovo] = useState<{ nome: string; telefone: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const { data, loading } = useAsync(
    () => (termo.length >= 2 ? get<{ clientes: Cliente[] }>('/clientes', { busca: termo }).then((r) => r.clientes.slice(0, 8)) : Promise.resolve([] as Cliente[])),
    [termo]
  )

  if (value) {
    return (
      <div className="ag-cliente-sel">
        <span className="ag-avatar ag-avatar-cliente">{value.nome.slice(0, 1).toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="strong">{value.nome}</div>
          <div className="small muted">{phone(value.telefone)}</div>
          {value.observacoes ? <div className="small ag-obs">Obs.: {value.observacoes}</div> : null}
          {aviso ? <div className="small success-text">{aviso}</div> : null}
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            onChange(null)
            setAviso('')
          }}
        >
          Trocar
        </button>
      </div>
    )
  }

  if (novo) {
    return (
      <div className="ag-subcard stack-sm">
        <div className="strong small">Cadastro rápido</div>
        <div className="form-grid">
          <Field label="Nome">
            <input className="input" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} autoFocus />
          </Field>
          <Field label="Telefone (WhatsApp)" hint="O cliente é identificado pelo telefone.">
            <input className="input" inputMode="tel" placeholder="(11) 98888-7777" value={novo.telefone} onChange={(e) => setNovo({ ...novo, telefone: e.target.value })} />
          </Field>
        </div>
        <ErrorBanner message={erro} />
        <div className="row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={salvando}
            onClick={async () => {
              if (!novo.nome.trim() || novo.telefone.replace(/\D/g, '').length < 10) {
                setErro('Informe o nome e um telefone válido com DDD.')
                return
              }
              setSalvando(true)
              setErro('')
              try {
                const c = await post<Cliente & { jaExistia: boolean }>('/clientes', { nome: novo.nome.trim(), telefone: novo.telefone })
                setAviso(c.jaExistia ? 'Telefone já cadastrado: o agendamento será vinculado a este cliente.' : 'Cliente cadastrado.')
                onChange({ id: c.id, nome: c.nome, telefone: c.telefone, observacoes: c.observacoes })
                setNovo(null)
              } catch (e) {
                setErro(errorMessage(e))
              } finally {
                setSalvando(false)
              }
            }}
          >
            {salvando ? 'Salvando…' : 'Cadastrar e usar'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNovo(null)}>
            Voltar à busca
          </button>
        </div>
      </div>
    )
  }

  const digits = busca.replace(/\D/g, '')
  return (
    <div className="stack-sm">
      <input className="input" placeholder="Buscar por telefone ou nome…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
      {termo.length >= 2 ? (
        <div className="ag-cliente-results">
          {loading && !data?.length ? <div className="small muted ag-pad">Buscando…</div> : null}
          {(data || []).map((c) => (
            <button type="button" key={c.id} className="ag-cliente-opt" onClick={() => onChange({ id: c.id, nome: c.nome, telefone: c.telefone, observacoes: c.observacoes })}>
              <span className="strong">{c.nome}</span>
              <span className="small muted">{phone(c.telefone)}</span>
            </button>
          ))}
          {!loading && data && !data.length ? <div className="small muted ag-pad">Nenhum cliente encontrado.</div> : null}
        </div>
      ) : null}
      <div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setNovo(digits.length >= 8 && digits.length === busca.replace(/[\s()-]/g, '').length ? { nome: '', telefone: busca } : { nome: busca, telefone: '' })}
        >
          + Cadastrar novo cliente
        </button>
      </div>
    </div>
  )
}
