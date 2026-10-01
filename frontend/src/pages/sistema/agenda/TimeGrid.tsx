// Grade de horarios usada nas visoes Dia e Semana.
// Cada coluna tem janelas de trabalho (area clicavel), pausas/fora da jornada (apagado) e itens
// (agendamentos com faixa de intervalo hachurada, bloqueios e eventos do Google).
import { useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { useCountdown } from '../../../lib/hooks'
import { countdown, STATUS_AGENDAMENTO, statusEfetivo } from '../../../lib/format'
import type { Agendamento } from '../../../types'
import { AlertIcon, GoogleIcon, LockIcon, PagamentoIcon, RepeatIcon } from './icons'
import type { BloqueioVisao, EventoVisao } from './types'
import { agInterval, layoutLanes, minutesStr, podeReagendar, PX_PER_MIN, SNAP, type Intervalo } from './utils'

export type GridItem =
  | { kind: 'ag'; id: string; start: number; end: number; ag: Agendamento; readOnly: boolean }
  | { kind: 'bloqueio'; id: string; start: number; end: number; bloqueio: BloqueioVisao; readOnly: boolean }
  | { kind: 'evento'; id: string; start: number; end: number; evento: EventoVisao }

export interface GridColumn {
  key: string
  date: string
  header: ReactNode
  /** coluna de um unico profissional (permite clicar horario vago com profissional e arrastar) */
  profissionalId: string | null
  /** janelas de trabalho (minutos do dia), ja unidas */
  abertas: Intervalo[]
  pausas: Intervalo[]
  editable: boolean
  /** dia sem expediente: 'rotina' | 'fora' | 'folga' */
  fechado?: 'rotina' | 'fora' | 'folga' | null
  fechadoLabel?: string | null
  hoje?: boolean
  items: GridItem[]
}

interface Props {
  columns: GridColumn[]
  range: Intervalo
  nowMin: number | null
  colorByProf?: boolean
  minColWidth?: number
  onSlot?: (col: GridColumn, minute: number) => void
  onAg: (ag: Agendamento) => void
  onBloqueio: (b: BloqueioVisao, readOnly: boolean) => void
  onDropAg?: (ag: Agendamento, col: GridColumn, minute: number) => void
}

export function TimeGrid({ columns, range, nowMin, colorByProf, minColWidth = 180, onSlot, onAg, onBloqueio, onDropAg }: Props) {
  const height = (range.fim - range.inicio) * PX_PER_MIN
  const dragRef = useRef<{ ag: Agendamento; offsetMin: number; dur: number } | null>(null)
  const [ghost, setGhost] = useState<{ col: string; minute: number; dur: number } | null>(null)

  const hours: number[] = []
  for (let t = range.inicio; t <= range.fim; t += 60) hours.push(t)

  const top = (m: number) => (m - range.inicio) * PX_PER_MIN

  function minuteFromEvent(e: DragEvent<HTMLDivElement>, offsetMin: number) {
    const rect = e.currentTarget.getBoundingClientRect()
    const raw = range.inicio + (e.clientY - rect.top) / PX_PER_MIN - offsetMin
    return Math.max(0, Math.min(1440 - SNAP, Math.round(raw / SNAP) * SNAP))
  }

  function onDragOver(e: DragEvent<HTMLDivElement>, col: GridColumn) {
    const d = dragRef.current
    if (!d || !onDropAg || !col.editable || !col.profissionalId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const minute = minuteFromEvent(e, d.offsetMin)
    if (!ghost || ghost.col !== col.key || ghost.minute !== minute) setGhost({ col: col.key, minute, dur: d.dur })
  }

  function onDrop(e: DragEvent<HTMLDivElement>, col: GridColumn) {
    const d = dragRef.current
    if (!d || !onDropAg || !col.editable || !col.profissionalId) return
    e.preventDefault()
    const minute = minuteFromEvent(e, d.offsetMin)
    dragRef.current = null
    setGhost(null)
    onDropAg(d.ag, col, minute)
  }

  return (
    <div className="ag-grid-scroll">
      <div className="ag-grid" style={{ gridTemplateColumns: `58px repeat(${columns.length}, minmax(${minColWidth}px, 1fr))` }}>
        <div className="ag-corner" />
        {columns.map((col) => (
          <div key={col.key} className={`ag-col-head ${col.hoje ? 'is-today' : ''}`}>
            {col.header}
          </div>
        ))}

        <div className="ag-gutter" style={{ height }}>
          {hours.map((h) => (
            <div key={h} className="ag-hour-label" style={{ top: top(h) }}>
              {minutesStr(h)}
            </div>
          ))}
        </div>

        {columns.map((col) => {
          const laid = layoutLanes(col.items)
          const abertas = col.abertas
            .map((a) => ({ inicio: Math.max(a.inicio, range.inicio), fim: Math.min(a.fim, range.fim) }))
            .filter((a) => a.fim > a.inicio)
          return (
            <div
              key={col.key}
              className={`ag-col-body ${col.fechado ? `ag-col-${col.fechado}` : ''}`}
              style={{ height }}
              onDragOver={(e) => onDragOver(e, col)}
              onDrop={(e) => onDrop(e, col)}
            >
              {abertas.map((a) => (
                <div key={`${a.inicio}`} className="ag-open" style={{ top: top(a.inicio), height: (a.fim - a.inicio) * PX_PER_MIN }}>
                  {col.editable && onSlot
                    ? slotsOf(a).map((t) => (
                        <button
                          type="button"
                          key={t}
                          className="ag-slot"
                          style={{ top: (t - a.inicio) * PX_PER_MIN, height: Math.min(SNAP, a.fim - t) * PX_PER_MIN }}
                          onClick={() => onSlot(col, t)}
                          title={`Novo agendamento às ${minutesStr(t)}`}
                        >
                          <span>+ {minutesStr(t)}</span>
                        </button>
                      ))
                    : null}
                </div>
              ))}
              {col.pausas.map((p) =>
                p.fim > range.inicio && p.inicio < range.fim ? (
                  <div key={`p${p.inicio}`} className="ag-pausa" style={{ top: top(Math.max(p.inicio, range.inicio)), height: (Math.min(p.fim, range.fim) - Math.max(p.inicio, range.inicio)) * PX_PER_MIN }}>
                    <span>Pausa</span>
                  </div>
                ) : null
              )}
              <div className="ag-lines" />
              {col.fechadoLabel ? <div className="ag-closed-label">{col.fechadoLabel}</div> : null}

              {laid.map((it) => {
                const pos: CSSProperties = {
                  top: top(Math.max(it.start, range.inicio)),
                  height: Math.max(14, (Math.min(it.end, range.fim) - Math.max(it.start, range.inicio)) * PX_PER_MIN),
                  left: `calc(${(it.lane * 100) / it.lanes}% + 2px)`,
                  width: `calc(${100 / it.lanes}% - 4px)`,
                }
                if (it.kind === 'ag') {
                  const draggable = Boolean(onDropAg) && !it.readOnly && Boolean(col.profissionalId) && podeReagendar(it.ag)
                  return (
                    <AgBlock
                      key={it.id}
                      ag={it.ag}
                      style={pos}
                      rangeInicio={range.inicio}
                      colorByProf={colorByProf}
                      readOnly={it.readOnly}
                      draggable={draggable}
                      dragging={Boolean(ghost) && dragRef.current?.ag.id === it.ag.id}
                      onClick={() => onAg(it.ag)}
                      onDragStart={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const { start, end } = agInterval(it.ag)
                        dragRef.current = { ag: it.ag, offsetMin: (e.clientY - rect.top) / PX_PER_MIN, dur: end - start }
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', it.ag.id)
                      }}
                      onDragEnd={() => {
                        dragRef.current = null
                        setGhost(null)
                      }}
                    />
                  )
                }
                if (it.kind === 'bloqueio') {
                  return (
                    <button type="button" key={`b${it.id}${it.start}`} className="ag-item ag-bloq" style={pos} onClick={() => onBloqueio(it.bloqueio, it.readOnly)} title={it.bloqueio.motivo || 'Bloqueado'}>
                      <div className="ag-item-time">
                        <LockIcon /> {minutesStr(it.start)}–{minutesStr(it.end)} {it.bloqueio.semanal ? <RepeatIcon /> : null}
                      </div>
                      <div className="ag-item-title">{it.bloqueio.motivo || 'Bloqueado'}</div>
                    </button>
                  )
                }
                return (
                  <div key={`e${it.id}`} className="ag-item ag-evento" style={pos} title={`Google Calendar: ${it.evento.titulo}`}>
                    <div className="ag-item-time">
                      <GoogleIcon /> {minutesStr(it.start)}–{minutesStr(it.end)}
                    </div>
                    <div className="ag-item-title">{it.evento.titulo}</div>
                  </div>
                )
              })}

              {ghost && ghost.col === col.key ? (
                <div className="ag-ghost" style={{ top: top(ghost.minute), height: ghost.dur * PX_PER_MIN }}>
                  <span>{minutesStr(ghost.minute)}</span>
                </div>
              ) : null}

              {col.hoje && nowMin !== null && nowMin >= range.inicio && nowMin <= range.fim ? <div className="ag-now" style={{ top: top(nowMin) }} /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function slotsOf(a: Intervalo) {
  const out: number[] = []
  const first = Math.ceil(a.inicio / SNAP) * SNAP
  for (let t = first; t < a.fim; t += SNAP) out.push(t)
  return out
}

function AgBlock({
  ag,
  style,
  rangeInicio,
  colorByProf,
  readOnly,
  draggable,
  dragging,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  ag: Agendamento
  style: CSSProperties
  rangeInicio: number
  colorByProf?: boolean
  readOnly: boolean
  draggable: boolean
  dragging: boolean
  onClick: () => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
}) {
  const st = statusEfetivo(ag)
  const segundos = useCountdown(ag.status === 'AGUARDANDO_PAGAMENTO' ? ag.segundosRestantesReserva : null)
  const { start, fim, end } = agInterval(ag)
  const visStart = Math.max(start, rangeInicio)
  const mainH = Math.max(0, fim - visStart) * PX_PER_MIN
  const intH = Math.max(0, end - Math.max(fim, visStart)) * PX_PER_MIN
  const compacto = mainH < 40
  const cls = [
    'ag-item',
    'ag-block',
    `st-${st}`,
    colorByProf ? 'ag-block-prof' : '',
    ag.status === 'CANCELADO' || ag.status === 'NO_SHOW' ? 'is-out' : '',
    ag.pendenteFinalizacao ? 'is-alert' : '',
    readOnly ? 'is-readonly' : '',
    draggable ? 'is-draggable' : '',
    dragging ? 'is-dragging' : '',
  ].join(' ')
  const servicos = ag.servicos.map((s) => s.nome).join(' + ')
  const styleFinal = { ...style, ...(colorByProf ? ({ '--pc': ag.profissional?.cor || '#64748b' } as CSSProperties) : {}) }
  return (
    <div
      className={cls}
      style={styleFinal}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      title={`${ag.hora}–${ag.horaFim} · ${ag.cliente?.nome} · ${servicos} · ${STATUS_AGENDAMENTO[st] || st}${ag.horaFimIntervalo !== ag.horaFim ? ` · intervalo até ${ag.horaFimIntervalo}` : ''}`}
    >
      <div className={`ag-block-main ${compacto ? 'is-compact' : ''}`} style={{ height: mainH }}>
        <div className="ag-item-time">
          <span>
            {ag.hora}–{ag.horaFim}
          </span>
          <span className="ag-block-icons">
            {ag.encaixe ? (
              <span className="ag-tag" title="Encaixe">
                E
              </span>
            ) : null}
            {ag.pendenteFinalizacao ? <AlertIcon title="Pendente de finalização" /> : null}
            <PagamentoIcon situacao={ag.situacaoPagamento} />
          </span>
        </div>
        <div className="ag-item-title">
          {colorByProf ? <span className="dot" style={{ background: ag.profissional?.cor }} /> : null} {ag.cliente?.nome}
        </div>
        {!compacto ? <div className="ag-item-sub">{servicos}</div> : null}
        {segundos !== null && ag.status === 'AGUARDANDO_PAGAMENTO' ? (
          <div className="ag-countdown" title="Tempo restante da reserva">
            {segundos > 0 ? `Reserva ${countdown(segundos)}` : 'Reserva expirando…'}
          </div>
        ) : null}
        {ag.pendenteFinalizacao && !compacto ? <div className="ag-alert-text">Pendente de finalização</div> : null}
      </div>
      {intH > 0 ? <div className="ag-block-int" style={{ height: intH }} title={`Intervalo até ${ag.horaFimIntervalo}`} /> : null}
    </div>
  )
}
