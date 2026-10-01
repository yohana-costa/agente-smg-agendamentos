// Visoes Mes (quantidade por dia e dias fechados) e Lista (pendencias).
import { useMemo } from 'react'
import { get } from '../../../lib/api'
import { brl, dateBr, monthRange, phone, todayStr, weekdayOf, WEEKDAYS_SHORT, countdown } from '../../../lib/format'
import { useAsync, useCountdown } from '../../../lib/hooks'
import { Empty, ErrorBanner, Loading, Segmented, StatusBadge } from '../../../components/ui'
import type { Agendamento } from '../../../types'
import { AlertIcon, PagamentoIcon } from './icons'
import type { Filtros, ListaFiltro, ListaPeriodo, MesResponse } from './types'
import { filtrarPorStatus, queryFiltros, rangeLista } from './utils'

// ---------------- Mes ----------------

export function MonthView({
  date,
  filtros,
  refreshKey,
  onPickDay,
}: {
  date: string
  filtros: Filtros
  refreshKey: number
  onPickDay: (d: string) => void
}) {
  const { from, to } = monthRange(date)
  const { data, loading, error } = useAsync(
    () =>
      Promise.all([
        get<MesResponse>('/agenda/mes', { mes: from.slice(0, 7), profissionalIds: filtros.profissionalId || undefined }),
        get<Agendamento[]>('/agenda/agendamentos', { de: from, ate: to, profissionalIds: filtros.profissionalId || undefined, ...queryFiltros(filtros) }),
      ]),
    [from, filtros.profissionalId, filtros.servicoId, filtros.mostrarCancelados, filtros.status === 'CANCELADO', refreshKey]
  )

  const porDia = useMemo(() => {
    const map: Record<string, { total: number; aguardando: number; pendentes: number; cancelados: number }> = {}
    for (const a of filtrarPorStatus(data?.[1] || [], filtros.status)) {
      const m = (map[a.data] ||= { total: 0, aguardando: 0, pendentes: 0, cancelados: 0 })
      if (a.status === 'CANCELADO') m.cancelados += 1
      else m.total += 1
      if (a.status === 'AGUARDANDO_PAGAMENTO') m.aguardando += 1
      if (a.pendenteFinalizacao) m.pendentes += 1
    }
    return map
  }, [data, filtros.status])

  if (!data && loading) return <Loading label="Carregando mês..." />
  if (!data) return <ErrorBanner message={error || 'Não foi possível carregar o mês.'} />

  const [mes] = data
  const lead = weekdayOf(from)
  const hoje = todayStr()
  const totalMes = Object.values(porDia).reduce((acc, d) => acc + d.total, 0)
  const fechadosFora = mes.dias.filter((d) => d.fechadoForaRotina).length

  return (
    <div className="stack">
      <ErrorBanner message={error} />
      <div className="row small muted">
        <span>
          <strong className="ag-text-main">{totalMes}</strong> atendimentos no mês
        </span>
        {fechadosFora ? <span>· {fechadosFora} dia(s) fechado(s) fora da rotina</span> : null}
      </div>
      <div className="ag-month">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="ag-month-wd">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`v${i}`} className="ag-month-cell is-empty" />
        ))}
        {mes.dias.map((d) => {
          const c = porDia[d.data]
          const cls = ['ag-month-cell', d.fechadoForaRotina ? 'is-fora' : d.fechadoRotina ? 'is-rotina' : '', d.data === hoje ? 'is-today' : '', d.data === date ? 'is-selected' : ''].join(' ')
          return (
            <button type="button" key={d.data} className={cls} onClick={() => onPickDay(d.data)} title={`Abrir ${dateBr(d.data)}`}>
              <div className="ag-month-top">
                <span className="ag-month-num">{Number(d.data.slice(8))}</span>
                {d.fechadoForaRotina ? <span className="badge badge-warning">Fechado</span> : d.fechadoRotina ? <span className="badge badge-gray">Rotina</span> : null}
              </div>
              {d.fechadoForaRotina?.motivo ? <div className="small ag-ellipsis ag-month-motivo">{d.fechadoForaRotina.motivo}</div> : null}
              <div className="ag-month-body">
                {c?.total ? (
                  <div className="ag-month-count">
                    <strong>{c.total}</strong> <span className="small muted">{c.total === 1 ? 'atendimento' : 'atendimentos'}</span>
                  </div>
                ) : !d.fechadoRotina && !d.fechadoForaRotina ? (
                  <div className="small muted">—</div>
                ) : null}
                <div className="ag-month-flags">
                  {c?.aguardando ? <span className="badge st-AGUARDANDO_PAGAMENTO status-badge">{c.aguardando} aguard.</span> : null}
                  {c?.pendentes ? <span className="badge st-PENDENTE_FINALIZACAO status-badge">{c.pendentes} pend.</span> : null}
                  {c?.cancelados ? <span className="badge badge-gray">{c.cancelados} canc.</span> : null}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------- Lista ----------------

export function ListView({
  date,
  filtros,
  refreshKey,
  filtro,
  setFiltro,
  periodo,
  setPeriodo,
  onAg,
}: {
  date: string
  filtros: Filtros
  refreshKey: number
  filtro: ListaFiltro
  setFiltro: (f: ListaFiltro) => void
  periodo: ListaPeriodo
  setPeriodo: (p: ListaPeriodo) => void
  onAg: (ag: Agendamento) => void
}) {
  const { de, ate } = rangeLista(periodo, date)
  const { data, loading, error } = useAsync(
    () =>
      get<Agendamento[]>('/agenda/agendamentos', {
        de,
        ate,
        profissionalIds: filtros.profissionalId || undefined,
        ...queryFiltros(filtros),
        status: filtro === 'aguardando' ? 'AGUARDANDO_PAGAMENTO' : undefined,
        pendentesFinalizacao: filtro === 'pendentes' ? 'true' : undefined,
      }),
    [de, ate, filtros.profissionalId, filtros.servicoId, filtros.mostrarCancelados, filtros.status === 'CANCELADO', filtro, refreshKey]
  )
  const lista = useMemo(() => filtrarPorStatus(data || [], filtros.status), [data, filtros.status])

  return (
    <div className="stack">
      <div className="row-between">
        <div className="chips">
          {(
            [
              ['todos', 'Todos'],
              ['pendentes', 'Pendentes de finalização'],
              ['aguardando', 'Aguardando pagamento'],
            ] as Array<[ListaFiltro, string]>
          ).map(([k, l]) => (
            <button key={k} type="button" className={`chip ${filtro === k ? 'active' : ''}`} onClick={() => setFiltro(k)}>
              {l}
            </button>
          ))}
        </div>
        <Segmented
          options={[
            { key: 'dia', label: 'Dia' },
            { key: 'semana', label: 'Semana' },
            { key: 'mes', label: 'Mês' },
            { key: '30d', label: '±30 dias' },
          ]}
          value={periodo}
          onChange={setPeriodo}
        />
      </div>
      <div className="small muted">
        {dateBr(de)} a {dateBr(ate)} · {lista.length} {lista.length === 1 ? 'agendamento' : 'agendamentos'}
        {loading && data ? ' · atualizando…' : ''}
      </div>
      <ErrorBanner message={error} />
      {!data && loading ? (
        <Loading />
      ) : !lista.length ? (
        <Empty icon="✓">{filtro === 'pendentes' ? 'Nenhum atendimento pendente de finalização no período.' : filtro === 'aguardando' ? 'Nenhum agendamento aguardando pagamento.' : 'Nenhum agendamento no período.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Horário</th>
                <th>Cliente</th>
                <th>Serviços</th>
                <th>Profissional</th>
                <th>Status</th>
                <th>Pagamento</th>
                <th className="right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <ListaRow key={a.id} ag={a} onClick={() => onAg(a)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ListaRow({ ag, onClick }: { ag: Agendamento; onClick: () => void }) {
  const segundos = useCountdown(ag.status === 'AGUARDANDO_PAGAMENTO' ? ag.segundosRestantesReserva : null)
  return (
    <tr className={`clickable ${ag.pendenteFinalizacao ? 'ag-row-alert' : ''} ${ag.status === 'CANCELADO' ? 'ag-row-out' : ''}`} onClick={onClick}>
      <td className="nowrap">
        {WEEKDAYS_SHORT[weekdayOf(ag.data)]} {dateBr(ag.data)}
      </td>
      <td className="nowrap mono">
        {ag.hora}–{ag.horaFim}
      </td>
      <td>
        <div className="strong">{ag.cliente?.nome}</div>
        <div className="small muted">{phone(ag.cliente?.telefone)}</div>
      </td>
      <td>{ag.servicos.map((s) => s.nome).join(' + ')}</td>
      <td className="nowrap">
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: ag.profissional?.cor }} /> {ag.profissional?.nome}
        </span>
      </td>
      <td className="nowrap">
        <span className="row" style={{ gap: 6 }}>
          <StatusBadge agendamento={ag} />
          {ag.pendenteFinalizacao ? <AlertIcon title="Pendente de finalização" /> : null}
        </span>
      </td>
      <td className="nowrap">
        <PagamentoIcon situacao={ag.situacaoPagamento} comTexto />
        {segundos !== null ? <div className="small ag-countdown-inline">reserva {countdown(segundos)}</div> : null}
      </td>
      <td className="right nowrap strong">{brl(ag.valorTotal)}</td>
    </tr>
  )
}
