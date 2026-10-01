// Visoes Dia (uma coluna por profissional) e Semana (um profissional ou todos sobrepostos por cor).
import { useEffect, useMemo, useState } from 'react'
import { get } from '../../../lib/api'
import { addDays, dateBr, startOfWeek, todayStr, weekdayOf, WEEKDAYS_SHORT } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Empty, ErrorBanner, Loading, Segmented } from '../../../components/ui'
import type { Agendamento } from '../../../types'
import { TimeGrid, type GridColumn, type GridItem } from './TimeGrid'
import type { BloqueioVisao, DiaVisao, Filtros, ProfVisao, SemanaModo, VisaoResponse } from './types'
import { agInterval, clipToDay, computeRange, faixaToMin, filtrarPorStatus, localParts, mergeIntervals, minutesStr, MOTIVO_FECHADO, queryFiltros, type Intervalo } from './utils'

export interface CalendarHandlers {
  onSlot: (profissionalId: string | null, data: string, hora: string) => void
  onAg: (ag: Agendamento) => void
  onBloqueio: (b: BloqueioVisao, readOnly: boolean) => void
  onDropAg: (ag: Agendamento, profissionalId: string, data: string, hora: string) => void
  onReabrir: (dia: { id: string; data: string; motivo: string | null }) => void
  onPickDay: (data: string) => void
}

function useVisao(de: string, ate: string, profissionalIds: string, filtros: Filtros, refreshKey: number) {
  return useAsync(
    () => get<VisaoResponse>('/agenda/visao', { de, ate, profissionalIds: profissionalIds || undefined, ...queryFiltros(filtros) }),
    [de, ate, profissionalIds, filtros.servicoId, filtros.mostrarCancelados, filtros.status === 'CANCELADO', refreshKey]
  )
}

/** minuto atual no fuso do estabelecimento, atualizado a cada 30s */
function useNow(tz: string) {
  const [now, setNow] = useState(() => localParts(new Date(), tz))
  useEffect(() => {
    const t = setInterval(() => setNow(localParts(new Date(), tz)), 30000)
    return () => clearInterval(t)
  }, [tz])
  return now
}

function itensDoDia(v: VisaoResponse, data: string, profIds: string[], status: string, tz: string, readOnlyOf: (profId: string) => boolean): GridItem[] {
  const items: GridItem[] = []
  for (const ag of filtrarPorStatus(v.agendamentos, status)) {
    if (ag.data !== data || !profIds.includes(ag.profissionalId)) continue
    const { start, end } = agInterval(ag)
    items.push({ kind: 'ag', id: ag.id, start, end, ag, readOnly: readOnlyOf(ag.profissionalId) })
  }
  for (const b of v.bloqueios) {
    if (!profIds.includes(b.profissionalId)) continue
    const c = clipToDay(b.inicio, b.fim, data, tz)
    if (c) items.push({ kind: 'bloqueio', id: b.id, start: c.inicio, end: c.fim, bloqueio: b, readOnly: readOnlyOf(b.profissionalId) })
  }
  for (const e of v.eventos) {
    if (!profIds.includes(e.profissionalId)) continue
    const c = clipToDay(e.inicio, e.fim, data, tz)
    if (c) items.push({ kind: 'evento', id: e.id, start: c.inicio, end: c.fim, evento: e })
  }
  return items
}

function fechadoDe(dia: DiaVisao | undefined): 'rotina' | 'fora' | null {
  if (!dia) return null
  if (dia.fechadoForaRotina) return 'fora'
  if (dia.fechadoRotina) return 'rotina'
  return null
}

function rangeOf(v: VisaoResponse, columns: GridColumn[]) {
  const extras: Intervalo[] = []
  columns.forEach((c) => c.items.forEach((i) => extras.push({ inicio: i.start, fim: i.end })))
  return computeRange(v.dias, extras)
}

function DiaFechadoBanners({ dias, podeReabrir, onReabrir }: { dias: DiaVisao[]; podeReabrir: boolean; onReabrir: CalendarHandlers['onReabrir'] }) {
  return (
    <>
      {dias.map((d) =>
        d.fechadoForaRotina ? (
          <div key={`f${d.data}`} className="banner warning-banner ag-banner">
            <div>
              <strong>{dias.length > 1 ? `${dateBr(d.data)}: ` : ''}Dia fechado fora da rotina</strong>
              {d.fechadoForaRotina.motivo ? ` — ${d.fechadoForaRotina.motivo}` : ''}. Conta como capacidade perdida.
            </div>
            {podeReabrir ? (
              <button className="btn btn-sm" onClick={() => onReabrir({ id: d.fechadoForaRotina!.id, data: d.data, motivo: d.fechadoForaRotina!.motivo })}>
                Reabrir dia
              </button>
            ) : null}
          </div>
        ) : d.fechadoRotina && dias.length === 1 ? (
          <div key={`r${d.data}`} className="banner info-banner ag-banner">
            <div>
              <strong>Fechado pela rotina do estabelecimento.</strong> Os dias de funcionamento são definidos em Configurações e não contam como perda.
            </div>
          </div>
        ) : null
      )}
    </>
  )
}

// ---------------- Dia ----------------

export function DayView({
  date,
  filtros,
  refreshKey,
  tz,
  podeFecharDia,
  handlers,
}: {
  date: string
  filtros: Filtros
  refreshKey: number
  tz: string
  podeFecharDia: boolean
  handlers: CalendarHandlers
}) {
  const { data, loading, error } = useVisao(date, date, filtros.profissionalId, filtros, refreshKey)
  const now = useNow(tz)

  const columns = useMemo<GridColumn[]>(() => {
    if (!data) return []
    const dia = data.dias.find((d) => d.data === date) || data.dias[0]
    const fechado = fechadoDe(dia)
    const ro = (id: string) => Boolean(data.profissionais.find((p) => p.id === id)?.somenteLeitura)
    return data.profissionais.map((p) => {
      const est = dia?.profissionais.find((x) => x.profissionalId === p.id)
      const items = itensDoDia(data, date, [p.id], filtros.status, tz, ro)
      const qtd = items.filter((i) => i.kind === 'ag' && !['CANCELADO', 'NO_SHOW'].includes(i.ag.status)).length
      const folga = !fechado && est && !est.aberto
      return {
        key: p.id,
        date,
        profissionalId: p.id,
        abertas: est?.aberto ? mergeIntervals(est.janelas.map(faixaToMin)) : [],
        pausas: est?.aberto ? est.pausas.map(faixaToMin) : [],
        editable: !p.somenteLeitura,
        fechado: fechado || (folga ? 'folga' : null),
        fechadoLabel: fechado === 'fora' ? 'Dia fechado' : fechado === 'rotina' ? 'Fechado (rotina)' : folga ? MOTIVO_FECHADO[est?.motivo || 'FOLGA_SEMANAL'] : null,
        hoje: date === now.date,
        items,
        header: <ProfHeader p={p} qtd={qtd} />,
      }
    })
  }, [data, date, filtros.status, tz, now.date])

  if (!data && loading) return <Loading label="Carregando agenda..." />
  if (!data) return <ErrorBanner message={error || 'Não foi possível carregar a agenda.'} />
  if (!data.profissionais.length) return <Empty icon="◷">Nenhum profissional ativo para exibir.</Empty>

  return (
    <div className="stack">
      <ErrorBanner message={error} />
      <DiaFechadoBanners dias={data.dias} podeReabrir={podeFecharDia} onReabrir={handlers.onReabrir} />
      <TimeGrid
        columns={columns}
        range={rangeOf(data, columns)}
        nowMin={now.minutes}
        onSlot={(col, m) => handlers.onSlot(col.profissionalId, col.date, minutesStr(m))}
        onAg={handlers.onAg}
        onBloqueio={handlers.onBloqueio}
        onDropAg={(ag, col, m) => col.profissionalId && handlers.onDropAg(ag, col.profissionalId, col.date, minutesStr(m))}
      />
    </div>
  )
}


function ProfHeader({ p, qtd }: { p: ProfVisao; qtd: number }) {
  return (
    <div className="ag-prof-head">
      <span className="ag-avatar" style={{ background: p.cor || '#64748b' }}>
        {p.nome.slice(0, 1).toUpperCase()}
      </span>
      <div className="ag-prof-head-text">
        <div className="strong ag-ellipsis">{p.nome}</div>
        <div className="small muted">
          {qtd} {qtd === 1 ? 'atendimento' : 'atendimentos'}
          {p.somenteLeitura ? ' · somente leitura' : ''}
        </div>
      </div>
    </div>
  )
}

// ---------------- Semana ----------------

export function WeekView({
  date,
  filtros,
  refreshKey,
  tz,
  modo,
  setModo,
  profId,
  setProfId,
  profissionais,
  podeFecharDia,
  handlers,
}: {
  date: string
  filtros: Filtros
  refreshKey: number
  tz: string
  modo: SemanaModo
  setModo: (m: SemanaModo) => void
  profId: string
  setProfId: (id: string) => void
  profissionais: Array<{ id: string; nome: string; cor: string }>
  podeFecharDia: boolean
  handlers: CalendarHandlers
}) {
  const de = startOfWeek(date)
  const ate = addDays(de, 6)
  const profAtual = modo === 'um' ? profId || filtros.profissionalId || profissionais[0]?.id || '' : filtros.profissionalId
  const { data, loading, error } = useVisao(de, ate, profAtual, filtros, refreshKey)
  const now = useNow(tz)

  const columns = useMemo<GridColumn[]>(() => {
    if (!data) return []
    const ro = (id: string) => Boolean(data.profissionais.find((p) => p.id === id)?.somenteLeitura)
    const profs = modo === 'um' ? data.profissionais.filter((p) => p.id === profAtual).slice(0, 1) : data.profissionais
    const ids = profs.map((p) => p.id)
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(de, i)
      const dia = data.dias.find((x) => x.data === d)
      const fechado = fechadoDe(dia)
      const ests = (dia?.profissionais || []).filter((x) => ids.includes(x.profissionalId))
      const abertas = mergeIntervals(ests.filter((e) => e.aberto).flatMap((e) => e.janelas.map(faixaToMin)))
      const folga = !fechado && ests.length > 0 && ests.every((e) => !e.aberto)
      const items = itensDoDia(data, d, ids, filtros.status, tz, ro)
      const qtd = items.filter((it) => it.kind === 'ag' && !['CANCELADO', 'NO_SHOW'].includes(it.ag.status)).length
      const single = modo === 'um' ? profs[0] : null
      return {
        key: d,
        date: d,
        profissionalId: single ? single.id : null,
        abertas,
        pausas: modo === 'um' ? ests.filter((e) => e.aberto).flatMap((e) => e.pausas.map(faixaToMin)) : [],
        editable: single ? !single.somenteLeitura : profs.some((p) => !p.somenteLeitura),
        fechado: fechado || (folga ? 'folga' : null),
        fechadoLabel: fechado === 'fora' ? 'Dia fechado' : fechado === 'rotina' ? 'Fechado (rotina)' : folga ? 'Folga' : null,
        hoje: d === now.date,
        items,
        header: (
          <button type="button" className="ag-day-head" onClick={() => handlers.onPickDay(d)} title="Abrir este dia">
            <span className="small muted">{WEEKDAYS_SHORT[weekdayOf(d)]}</span>
            <span className={`ag-day-num ${d === todayStr() ? 'is-today' : ''}`}>{Number(d.slice(8))}</span>
            <span className="small muted">{qtd ? `${qtd} atend.` : ''}</span>
            {fechado === 'fora' ? <span className="badge badge-warning">Fechado</span> : fechado === 'rotina' ? <span className="badge badge-gray">Rotina</span> : null}
          </button>
        ),
      }
    })
  }, [data, de, modo, profAtual, filtros.status, tz, now.date, handlers])

  const lista = profissionais.filter((p) => !filtros.profissionalId || modo === 'um' || p.id === filtros.profissionalId)

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <Segmented
            options={[
              { key: 'um', label: 'Um profissional' },
              { key: 'todos', label: 'Todos sobrepostos' },
            ]}
            value={modo}
            onChange={setModo}
          />
          {modo === 'um' ? (
            <select className="select input-sm ag-w-200" value={profAtual} onChange={(e) => setProfId(e.target.value)}>
              {profissionais.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        {modo === 'todos' ? (
          <div className="ag-prof-legend">
            {(data?.profissionais || lista).map((p) => (
              <span key={p.id} className="row small" style={{ gap: 6 }}>
                <span className="dot" style={{ background: p.cor }} /> {p.nome}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {!data && loading ? <Loading label="Carregando semana..." /> : null}
      {!data && !loading ? <ErrorBanner message={error || 'Não foi possível carregar a agenda.'} /> : null}
      {data ? (
        <>
          <ErrorBanner message={error} />
          <DiaFechadoBanners dias={data.dias} podeReabrir={podeFecharDia} onReabrir={handlers.onReabrir} />
          {modo === 'um' && !data.profissionais.some((p) => p.id === profAtual) ? (
            <Empty icon="◷">Escolha um profissional para ver a semana.</Empty>
          ) : (
            <TimeGrid
              columns={columns}
              range={rangeOf(data, columns)}
              nowMin={now.minutes}
              colorByProf={modo === 'todos'}
              minColWidth={modo === 'todos' ? 150 : 130}
              onSlot={(col, m) => handlers.onSlot(col.profissionalId, col.date, minutesStr(m))}
              onAg={handlers.onAg}
              onBloqueio={handlers.onBloqueio}
              onDropAg={modo === 'um' ? (ag, col, m) => col.profissionalId && handlers.onDropAg(ag, col.profissionalId, col.date, minutesStr(m)) : undefined}
            />
          )}
        </>
      ) : null}
    </div>
  )
}
