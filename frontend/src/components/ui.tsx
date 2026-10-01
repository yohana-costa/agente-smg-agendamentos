// Componentes de UI compartilhados. Use estes em todas as telas para manter o visual consistente.
import { useEffect, useState, type ReactNode } from 'react'
import { brl, centsToInput, parseReais, STATUS_AGENDAMENTO, statusEfetivo, todayStr, monthRange, addDays } from '../lib/format'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  )
}

export function Card({ title, subtitle, actions, children, className = '' }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <div className="card-header">
          <div>
            {title ? <div className="card-title">{title}</div> : null}
            {subtitle ? <div className="card-sub">{subtitle}</div> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  )
}

export function Loading({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" /> {label}
    </div>
  )
}

export function Empty({ icon = '∅', children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      {children}
    </div>
  )
}

export function ErrorBanner({ message }: { message?: string | null }) {
  return message ? <div className="banner error-banner">{message}</div> : null
}

export function SuccessBanner({ message }: { message?: string | null }) {
  return message ? <div className="banner success-banner">{message}</div> : null
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : size === 'xl' ? 'modal-xl' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </aside>
    </div>
  )
}

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      {label ? <span>{label}</span> : null}
    </label>
  )
}

/** Input de dinheiro: valor externo em centavos, digitacao em reais ("49,90"). */
export function MoneyInput({ value, onChange, placeholder = '0,00', disabled }: { value: number; onChange: (cents: number) => void; placeholder?: string; disabled?: boolean }) {
  const [text, setText] = useState(centsToInput(value))
  useEffect(() => {
    if (parseReais(text) !== value) setText(centsToInput(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <div className="input-group">
      <span className="addon" style={{ borderRadius: '10px 0 0 10px', borderLeft: '1px solid var(--border-strong)', borderRight: 0 }}>
        R$
      </span>
      <input
        className="input"
        style={{ borderRadius: '0 10px 10px 0' }}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value)
          onChange(parseReais(e.target.value))
        }}
        onBlur={() => setText(centsToInput(parseReais(text)))}
      />
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ key: T; label: ReactNode }>; value: T; onChange: (k: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.key} type="button" className={`tab ${value === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ key: T; label: ReactNode }>; value: T; onChange: (k: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.key} type="button" className={value === o.key ? 'active' : ''} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function StatusBadge({ agendamento, status }: { agendamento?: { status: string; pendenteFinalizacao?: boolean }; status?: string }) {
  const s = agendamento ? statusEfetivo(agendamento) : status || ''
  return <span className={`badge status-badge st-${s}`}>{STATUS_AGENDAMENTO[s] || s}</span>
}

export function Progress({ value, label }: { value: number; label?: ReactNode }) {
  const v = Math.max(0, Math.min(100, Number(value || 0)))
  return (
    <div className="stack-sm">
      {label ? <div className="row-between small">{label}</div> : null}
      <div className="progress">
        <span style={{ width: `${v}%` }} />
      </div>
    </div>
  )
}

export function Money({ value }: { value: number | null | undefined }) {
  return <span className="nowrap">{brl(value)}</span>
}

/** Confirmacao simples com texto e acao. */
export function ConfirmModal({
  title,
  children,
  confirmLabel = 'Confirmar',
  danger,
  onConfirm,
  onClose,
}: {
  title: ReactNode
  children: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Voltar
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await onConfirm()
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Erro')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Aguarde...' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        {children}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}

export type Periodo = { de: string; ate: string }

/** Filtro de periodo com atalhos (mes atual, mes anterior, 7 e 30 dias). */
export function PeriodFilter({ value, onChange }: { value: Periodo; onChange: (p: Periodo) => void }) {
  const hoje = todayStr()
  const mes = monthRange(hoje)
  const anterior = monthRange(addDays(mes.from, -1))
  const atalhos: Array<{ label: string; p: Periodo }> = [
    { label: 'Este mês', p: { de: mes.from, ate: mes.to } },
    { label: 'Mês anterior', p: { de: anterior.from, ate: anterior.to } },
    { label: '7 dias', p: { de: addDays(hoje, -6), ate: hoje } },
    { label: '30 dias', p: { de: addDays(hoje, -29), ate: hoje } },
  ]
  return (
    <div className="row">
      <div className="chips">
        {atalhos.map((a) => (
          <button key={a.label} type="button" className={`chip ${value.de === a.p.de && value.ate === a.p.ate ? 'active' : ''}`} onClick={() => onChange(a.p)}>
            {a.label}
          </button>
        ))}
      </div>
      <input type="date" className="input input-sm" style={{ width: 150 }} value={value.de} onChange={(e) => onChange({ ...value, de: e.target.value })} />
      <span className="muted">até</span>
      <input type="date" className="input input-sm" style={{ width: 150 }} value={value.ate} onChange={(e) => onChange({ ...value, ate: e.target.value })} />
    </div>
  )
}

export function periodoMesAtual(): Periodo {
  const m = monthRange(todayStr())
  return { de: m.from, ate: m.to }
}

/** Barras horizontais simples (ranking). */
export function BarList({ items, format = (v: number) => String(v) }: { items: Array<{ label: ReactNode; value: number; key?: string }>; format?: (v: number) => ReactNode }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (!items.length) return <Empty>Sem dados no período.</Empty>
  return (
    <div className="bars">
      {items.map((i, idx) => (
        <div className="bar-row" key={i.key || idx}>
          <div className="nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {i.label}
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
          <div className="right strong">{format(i.value)}</div>
        </div>
      ))}
    </div>
  )
}

/** Colunas verticais simples (evolucao mensal, dias da semana). */
export function ColumnChart({ items, format = (v: number) => String(v) }: { items: Array<{ label: string; value: number }>; format?: (v: number) => ReactNode }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="columns-chart">
      {items.map((i) => (
        <div className="col" key={i.label} title={`${i.label}: ${format(i.value)}`}>
          <div className="small muted">{i.value ? format(i.value) : ''}</div>
          <div className="col-bar" style={{ height: `${(i.value / max) * 100}%` }} />
          <div className="col-label">{i.label}</div>
        </div>
      ))}
    </div>
  )
}
