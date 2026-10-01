import { useEffect, type ReactNode } from 'react'
import { addDays, monthRange, MONTHS, todayStr, weekdayOf, WEEKDAYS_SHORT } from '../../../lib/format'
import { Link } from '../../../lib/router'
import { iniciais, mascaraTelefone, periodoDoHorario, temaEstilo } from './utils'
import '../publico.css'

/** Raiz das paginas publicas: aplica a cor do estabelecimento como --pb-primary. */
export function PbShell({ cor, titulo, children }: { cor?: string | null; titulo?: string; children: ReactNode }) {
  useEffect(() => {
    if (titulo) document.title = titulo
  }, [titulo])
  return (
    <div className="public-shell pb-root" style={temaEstilo(cor)}>
      {children}
    </div>
  )
}

export function PbLogo({ url, nome, size = 'md' }: { url?: string | null; nome: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`pb-logo pb-logo-${size}`} aria-hidden={!url}>
      {url ? <img src={url} alt={nome} /> : <span>{iniciais(nome)}</span>}
    </span>
  )
}

/** Barra superior compacta (portal e checkout). */
export function PbTopbar({ nome, logoUrl, href, children }: { nome: string; logoUrl?: string | null; href?: string; children?: ReactNode }) {
  const brand = (
    <>
      <PbLogo url={logoUrl} nome={nome} size="sm" />
      <span className="pb-topbar-name">{nome}</span>
    </>
  )
  return (
    <header className="pb-topbar">
      <div className="pb-topbar-inner">
        {href ? (
          <Link className="pb-brand-mini" to={href}>
            {brand}
          </Link>
        ) : (
          <div className="pb-brand-mini">{brand}</div>
        )}
        {children ? <div className="pb-topbar-actions">{children}</div> : null}
      </div>
    </header>
  )
}

export function PbSpinner({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className="pb-loading">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  )
}

export function PbAlert({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'sucesso' | 'aviso'; children: ReactNode }) {
  if (!children) return null
  return (
    <div className={`pb-alert pb-alert-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

/** Caixa de desenvolvimento (codigo de verificacao, pagamento simulado). */
export function DevNotice({ titulo = 'Ambiente de testes', children }: { titulo?: string; children: ReactNode }) {
  return (
    <div className="pb-dev">
      <div className="pb-dev-tag">{titulo}</div>
      <div>{children}</div>
    </div>
  )
}

export function Avatar({ nome, cor }: { nome: string; cor?: string | null }) {
  return (
    <span className="pb-avatar" style={cor ? { background: cor } : undefined}>
      {iniciais(nome)}
    </span>
  )
}

export function QtyStepper({ value, onChange, max = 99, label }: { value: number; onChange: (v: number) => void; max?: number; label: string }) {
  return (
    <div className="pb-qty" role="group" aria-label={`Quantidade de ${label}`}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} aria-label="Diminuir">
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Aumentar">
        +
      </button>
    </div>
  )
}

export function PhoneField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      className="input"
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      placeholder="(11) 98765-4321"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(mascaraTelefone(e.target.value))}
    />
  )
}

/** Calendario mensal. `mes` = "AAAA-MM-01". `habilitado(dia)` define os dias clicaveis. */
export function Calendario({
  mes,
  onMes,
  selecionado,
  onSelect,
  habilitado,
  carregando,
  maxMesesFrente = 6,
}: {
  mes: string
  onMes: (mes: string) => void
  selecionado: string
  onSelect: (dia: string) => void
  habilitado: (dia: string) => boolean
  carregando?: boolean
  maxMesesFrente?: number
}) {
  const hoje = todayStr()
  const mesAtual = monthRange(hoje).from
  const { to } = monthRange(mes)
  const [ano, m] = mes.split('-').map(Number)
  const totalDias = Number(to.slice(8, 10))
  const offset = weekdayOf(mes)
  const anterior = monthRange(addDays(mes, -1)).from
  const proximo = addDays(to, 1)
  let limite = mesAtual
  for (let i = 0; i < maxMesesFrente; i += 1) limite = addDays(monthRange(limite).to, 1)

  const celulas: Array<string | null> = []
  for (let i = 0; i < offset; i += 1) celulas.push(null)
  for (let d = 1; d <= totalDias; d += 1) celulas.push(`${mes.slice(0, 8)}${String(d).padStart(2, '0')}`)

  return (
    <div className={`pb-cal ${carregando ? 'is-loading' : ''}`}>
      <div className="pb-cal-head">
        <button type="button" className="pb-cal-nav" onClick={() => onMes(anterior)} disabled={mes <= mesAtual} aria-label="Mês anterior">
          ‹
        </button>
        <div className="pb-cal-title">
          {MONTHS[m - 1]} <span className="muted">{ano}</span>
          {carregando ? <span className="spinner pb-cal-spinner" /> : null}
        </div>
        <button type="button" className="pb-cal-nav" onClick={() => onMes(proximo)} disabled={proximo >= limite} aria-label="Próximo mês">
          ›
        </button>
      </div>
      <div className="pb-cal-grid">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="pb-cal-wd">
            {w}
          </div>
        ))}
        {celulas.map((dia, i) => {
          if (!dia) return <span key={`v${i}`} />
          const ativo = !carregando && dia >= hoje && habilitado(dia)
          const cls = ['pb-cal-day', ativo ? 'available' : '', dia === selecionado ? 'selected' : '', dia === hoje ? 'today' : ''].join(' ')
          return (
            <button key={dia} type="button" className={cls} disabled={!ativo} onClick={() => onSelect(dia)} aria-pressed={dia === selecionado} aria-label={dia}>
              {Number(dia.slice(8, 10))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Horarios livres agrupados em manha / tarde / noite. */
export function HorariosGrid({ horarios, selecionado, onSelect }: { horarios: string[]; selecionado: string; onSelect: (h: string) => void }) {
  const grupos: Array<{ nome: string; itens: string[] }> = []
  for (const h of horarios) {
    const nome = periodoDoHorario(h)
    const g = grupos.find((x) => x.nome === nome)
    if (g) g.itens.push(h)
    else grupos.push({ nome, itens: [h] })
  }
  return (
    <div className="stack">
      {grupos.map((g) => (
        <div key={g.nome}>
          <div className="pb-label">{g.nome}</div>
          <div className="pb-times">
            {g.itens.map((h) => (
              <button key={h} type="button" className={`pb-time ${h === selecionado ? 'selected' : ''}`} onClick={() => onSelect(h)} aria-pressed={h === selecionado}>
                {h}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Linha de resumo (label + valor). */
export function SummaryRow({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`pb-summary-row ${strong ? 'is-strong' : ''}`}>
      <span className="pb-summary-label">{label}</span>
      <span className="pb-summary-value">{children}</span>
    </div>
  )
}
