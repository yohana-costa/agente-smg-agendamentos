// Aba Agenda (escopo secao 6): visoes Dia/Semana/Mes/Lista, criar, painel, finalizar, cancelar,
// reagendar (botao e arrastar), bloqueios e fechamentos, tempo real via SSE.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { del, errorMessage, get, post } from '../../lib/api'
import { addDays, dateBr, dateLong, startOfWeek, todayStr } from '../../lib/format'
import { useAsync, useEventStream } from '../../lib/hooks'
import { navigate, useQueryParam } from '../../lib/router'
import { useAuth } from '../../lib/auth'
import { ConfirmModal, ErrorBanner, Loading, Modal, PageHeader, Segmented, Toggle } from '../../components/ui'
import MeuGoogleCard from './equipe/MeuGoogleCard'
import type { Agendamento, Conflito } from '../../types'
import { AgendamentoPainel } from './agenda/AgendamentoPainel'
import { BloqueioDetalheModal, BloquearHorarioModal, FecharDiaModal, GerenciarBloqueiosModal } from './agenda/BloqueioModais'
import { DayView, WeekView, type CalendarHandlers } from './agenda/CalendarViews'
import { ListView, MonthView } from './agenda/MonthListViews'
import { NovoAgendamentoModal } from './agenda/NovoAgendamentoModal'
import type { BloqueioPrefill, BloqueioVisao, Filtros, ListaFiltro, ListaPeriodo, NovoPrefill, Referencias, SemanaModo, View } from './agenda/types'
import { conflitosDoErro, monthLabel, rangeLista, shiftDate, shortDate, STATUS_FILTRO } from './agenda/utils'
import { ConflitosAviso } from './agenda/Widgets'
import './agenda/agenda.css'

const VIEWS: View[] = ['dia', 'semana', 'mes', 'lista']
const FILTROS_VAZIOS: Filtros = { profissionalId: '', servicoId: '', status: '', mostrarCancelados: false }

export default function Agenda() {
  const { usuario } = useAuth()
  const tz = usuario?.tenant.timezone || 'America/Sao_Paulo'
  const ehProfissional = usuario?.perfil === 'PROFISSIONAL'
  const podeFecharDia = !ehProfissional
  const veColegas = !ehProfissional || Boolean(usuario?.permissoes.verAgendaColegas)

  const [view, setView] = useState<View>('dia')
  const [date, setDate] = useState(todayStr())
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS)
  const [semanaModo, setSemanaModo] = useState<SemanaModo>('um')
  const [semanaProf, setSemanaProf] = useState(usuario?.profissionalId || '')
  const [listaFiltro, setListaFiltro] = useState<ListaFiltro>('todos')
  const [listaPeriodo, setListaPeriodo] = useState<ListaPeriodo>('semana')
  const [refreshKey, setRefreshKey] = useState(0)

  const [painelId, setPainelId] = useState<string | null>(null)
  const [novo, setNovo] = useState<NovoPrefill | null>(null)
  const [bloquear, setBloquear] = useState<BloqueioPrefill | null>(null)
  const [fecharDia, setFecharDia] = useState<string | null>(null)
  const [gerenciar, setGerenciar] = useState(false)
  const [bloqueioSel, setBloqueioSel] = useState<{ b: BloqueioVisao; readOnly: boolean } | null>(null)
  const [reabrir, setReabrir] = useState<{ id: string; data: string; motivo: string | null } | null>(null)
  const [encaixe, setEncaixe] = useState<{ titulo: string; conflitos: Conflito[]; confirmar: () => Promise<void> } | null>(null)
  const [flash, setFlash] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const sincronizarData = useRef(false)

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])
  useEventStream(['agenda.atualizada', 'pagamento.aprovado'], refresh)

  // atualiza contadores/pendencias periodicamente mesmo sem eventos (ex.: pendente de finalizacao)
  useEffect(() => {
    const t = setInterval(refresh, 120000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 6000)
    return () => clearTimeout(t)
  }, [flash])

  const refsQ = useAsync(() => get<Referencias>('/agenda/referencias'), [])
  const refs = refsQ.data

  // ---------- deep links ----------
  const qData = useQueryParam('data')
  const qAg = useQueryParam('agendamento')
  const qNovo = useQueryParam('novo')
  const qCliente = useQueryParam('clienteId')
  const qView = useQueryParam('view')
  const qFiltro = useQueryParam('filtro')
  // retorno do OAuth do Google (?google=conectado|erro) e acesso do profissional ao proprio Google Calendar
  const qGoogle = useQueryParam('google')
  const [googleAberto, setGoogleAberto] = useState(false)
  useEffect(() => {
    if (qGoogle) setGoogleAberto(true)
  }, [qGoogle])
  useEffect(() => {
    if (!qData && !qAg && !qNovo && !qView) return
    const dataValida = qData && /^\d{4}-\d{2}-\d{2}$/.test(qData) ? qData : null
    if (dataValida) setDate(dataValida)
    if (qView && (VIEWS as string[]).includes(qView)) setView(qView as View)
    if (qView === 'lista') {
      if (qFiltro === 'pendentes' || qFiltro === 'aguardando') {
        setListaFiltro(qFiltro)
        if (!dataValida) setListaPeriodo('30d')
      }
    }
    if (qAg) {
      setPainelId(qAg)
      sincronizarData.current = !dataValida && (!qView || qView === 'dia' || qView === 'semana')
    }
    if (qNovo === '1') setNovo({ clienteId: qCliente || undefined, data: dataValida || undefined })
    navigate(window.location.pathname, { replace: true })
  }, [qData, qAg, qNovo, qCliente, qView, qFiltro])

  const ok = useCallback(
    (texto?: string) => {
      if (texto) setFlash({ tipo: 'ok', texto })
      refresh()
    },
    [refresh]
  )

  // ---------- handlers da grade ----------
  const handlers: CalendarHandlers = useMemo(
    () => ({
      onSlot: (profissionalId, data, hora) => setNovo({ profissionalId: profissionalId || undefined, data, hora }),
      onAg: (ag) => setPainelId(ag.id),
      onBloqueio: (b, readOnly) => setBloqueioSel({ b, readOnly }),
      onReabrir: (d) => setReabrir(d),
      onPickDay: (d) => {
        setDate(d)
        setView('dia')
      },
      onDropAg: async (ag: Agendamento, profissionalId: string, data: string, hora: string) => {
        if (ag.data === data && ag.hora === hora && ag.profissionalId === profissionalId) return
        const enviar = (forcar: boolean) => post(`/agenda/agendamentos/${ag.id}/reagendar`, { data, hora, profissionalId, encaixe: forcar })
        const sucesso = `${ag.cliente?.nome || 'Agendamento'} reagendado para ${dateBr(data)} às ${hora}. O cliente foi avisado.`
        try {
          await enviar(false)
          ok(sucesso)
        } catch (e) {
          const c = conflitosDoErro(e)
          if (c) {
            setEncaixe({
              titulo: `Reagendar ${ag.cliente?.nome || ''} para ${dateBr(data)} às ${hora}`,
              conflitos: c,
              confirmar: async () => {
                await enviar(true)
                ok(sucesso)
              },
            })
          } else setFlash({ tipo: 'erro', texto: errorMessage(e) })
          refresh()
        }
      },
    }),
    [ok, refresh]
  )

  // ---------- rotulos ----------
  const titulo = useMemo(() => {
    if (view === 'dia') return dateLong(date)
    if (view === 'semana') {
      const de = startOfWeek(date)
      return `${shortDate(de)} – ${dateBr(addDays(de, 6))}`
    }
    if (view === 'mes') return monthLabel(date)
    const r = rangeLista(listaPeriodo, date)
    return r.de === r.ate ? dateLong(r.de) : `${dateBr(r.de)} – ${dateBr(r.ate)}`
  }, [view, date, listaPeriodo])

  const profsVisiveis = useMemo(() => {
    const all = refs?.profissionais || []
    return veColegas ? all : all.filter((p) => p.id === usuario?.profissionalId)
  }, [refs, veColegas, usuario?.profissionalId])

  const setFiltro = <K extends keyof Filtros>(k: K, v: Filtros[K]) => setFiltros((f) => ({ ...f, [k]: v }))
  const filtrosAtivos = Boolean(filtros.profissionalId || filtros.servicoId || filtros.status || filtros.mostrarCancelados)

  return (
    <div className="ag-page">
      <PageHeader
        title="Agenda"
        subtitle="Capacidade de cada profissional e tudo o que ocupa essa capacidade."
        actions={
          <>
            {usuario?.profissionalId ? (
              <button className="btn" onClick={() => setGoogleAberto(true)} title="Conectar o seu Google Calendar">
                Google Calendar
              </button>
            ) : null}
            <button className="btn" onClick={() => setGerenciar(true)}>
              Bloqueios
            </button>
            <button className="btn" onClick={() => setBloquear({ data: date, profissionalId: filtros.profissionalId || (ehProfissional ? usuario?.profissionalId || undefined : undefined) })} disabled={!refs}>
              Bloquear horário
            </button>
            {podeFecharDia ? (
              <button className="btn" onClick={() => setFecharDia(date)}>
                Fechar dia
              </button>
            ) : null}
            <button className="btn btn-primary" onClick={() => setNovo({ data: date >= todayStr() ? date : todayStr(), profissionalId: filtros.profissionalId || undefined })} disabled={!refs}>
              + Novo agendamento
            </button>
          </>
        }
      />

      {googleAberto ? (
        <Modal title="Meu Google Calendar" onClose={() => setGoogleAberto(false)}>
          {qGoogle === 'conectado' ? <div className="banner success-banner" style={{ marginBottom: 12 }}>Google Calendar conectado com sucesso.</div> : null}
          {qGoogle === 'erro' ? <div className="banner error-banner" style={{ marginBottom: 12 }}>Não foi possível conectar o Google Calendar. Tente novamente.</div> : null}
          <MeuGoogleCard />
        </Modal>
      ) : null}

      <div className="card ag-toolbar">
        <div className="ag-toolbar-row">
          <div className="ag-nav">
            <button className="btn btn-sm" onClick={() => setDate(todayStr())}>
              Hoje
            </button>
            <button className="icon-btn ag-arrow" onClick={() => setDate(shiftDate(view, listaPeriodo, date, -1))} aria-label="Anterior">
              ‹
            </button>
            <button className="icon-btn ag-arrow" onClick={() => setDate(shiftDate(view, listaPeriodo, date, 1))} aria-label="Próximo">
              ›
            </button>
            <input type="date" className="input input-sm ag-w-150" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Escolher data" />
            <div className="ag-title">{titulo}</div>
          </div>
          <Segmented
            options={[
              { key: 'dia', label: 'Dia' },
              { key: 'semana', label: 'Semana' },
              { key: 'mes', label: 'Mês' },
              { key: 'lista', label: 'Lista' },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
        <div className="ag-toolbar-row ag-filters">
          {veColegas ? (
            <select className="select input-sm ag-w-200" value={filtros.profissionalId} onChange={(e) => setFiltro('profissionalId', e.target.value)} aria-label="Profissional">
              <option value="">Todos os profissionais</option>
              {profsVisiveis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          ) : null}
          <select className="select input-sm ag-w-200" value={filtros.servicoId} onChange={(e) => setFiltro('servicoId', e.target.value)} aria-label="Serviço">
            <option value="">Todos os serviços</option>
            {(refs?.servicos || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
          <select className="select input-sm ag-w-200" value={filtros.status} onChange={(e) => setFiltro('status', e.target.value)} aria-label="Status">
            {STATUS_FILTRO.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <Toggle checked={filtros.mostrarCancelados} onChange={(v) => setFiltro('mostrarCancelados', v)} label="Mostrar cancelados" />
          {filtrosAtivos ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setFiltros(FILTROS_VAZIOS)}>
              Limpar filtros
            </button>
          ) : null}
          <span className="ag-live" title="Agendamentos feitos pelo site e pelo agente aparecem na hora">
            <span className="ag-live-dot" /> Tempo real
          </span>
        </div>
      </div>

      {flash ? <div className={`banner ${flash.tipo === 'ok' ? 'success-banner' : 'error-banner'} ag-flash`}>{flash.texto}</div> : null}
      <ErrorBanner message={refsQ.error} />

      <div className="card ag-main">
        {view === 'dia' ? <DayView date={date} filtros={filtros} refreshKey={refreshKey} tz={tz} podeFecharDia={podeFecharDia} handlers={handlers} /> : null}
        {view === 'semana' ? (
          <WeekView
            date={date}
            filtros={filtros}
            refreshKey={refreshKey}
            tz={tz}
            modo={semanaModo}
            setModo={setSemanaModo}
            profId={semanaProf}
            setProfId={setSemanaProf}
            profissionais={profsVisiveis}
            podeFecharDia={podeFecharDia}
            handlers={handlers}
          />
        ) : null}
        {view === 'mes' ? <MonthView date={date} filtros={filtros} refreshKey={refreshKey} onPickDay={handlers.onPickDay} /> : null}
        {view === 'lista' ? (
          <ListView date={date} filtros={filtros} refreshKey={refreshKey} filtro={listaFiltro} setFiltro={setListaFiltro} periodo={listaPeriodo} setPeriodo={setListaPeriodo} onAg={handlers.onAg} />
        ) : null}
      </div>

      {view === 'dia' || view === 'semana' ? <Legenda /> : null}

      {/* ---------- modais ---------- */}
      {novo && refs ? <NovoAgendamentoModal refs={refs} prefill={novo} refreshKey={refreshKey} onClose={() => setNovo(null)} onCreated={(_, msg) => ok(msg)} /> : null}
      {novo && !refs && refsQ.loading ? <Loading /> : null}

      {painelId && refs ? (
        <AgendamentoPainel
          id={painelId}
          refs={refs}
          refreshKey={refreshKey}
          onClose={() => setPainelId(null)}
          onChanged={(msg) => ok(msg)}
          onNovo={(p) => {
            setPainelId(null)
            setNovo(p)
          }}
          onLoaded={(ag) => {
            if (sincronizarData.current) {
              sincronizarData.current = false
              setDate(ag.data)
            }
          }}
        />
      ) : null}

      {bloquear && refs ? <BloquearHorarioModal refs={refs} prefill={bloquear} onClose={() => setBloquear(null)} onDone={ok} /> : null}
      {fecharDia ? <FecharDiaModal dataInicial={fecharDia} onClose={() => setFecharDia(null)} onDone={ok} /> : null}
      {gerenciar ? <GerenciarBloqueiosModal tz={tz} podeFecharDia={podeFecharDia} refreshKey={refreshKey} onClose={() => setGerenciar(false)} onDone={ok} /> : null}
      {bloqueioSel ? (
        <BloqueioDetalheModal
          bloqueio={bloqueioSel.b}
          readOnly={bloqueioSel.readOnly}
          tz={tz}
          profNome={refs?.profissionais.find((p) => p.id === bloqueioSel.b.profissionalId)?.nome || ''}
          onClose={() => setBloqueioSel(null)}
          onDone={ok}
        />
      ) : null}
      {reabrir ? (
        <ConfirmModal
          title="Reabrir dia"
          confirmLabel="Reabrir dia"
          onClose={() => setReabrir(null)}
          onConfirm={async () => {
            await del(`/agenda/dias-fechados/${reabrir.id}`)
            ok(`Dia ${dateBr(reabrir.data)} reaberto.`)
          }}
        >
          <div>
            Reabrir <strong>{dateLong(reabrir.data)}</strong>
            {reabrir.motivo ? ` (fechado por: ${reabrir.motivo})` : ''}?
          </div>
          <div className="small muted">Os horários deste dia voltam a ficar disponíveis no site e no agente.</div>
        </ConfirmModal>
      ) : null}
      {encaixe ? (
        <ConfirmModal title={encaixe.titulo} confirmLabel="Confirmar encaixe" danger onClose={() => setEncaixe(null)} onConfirm={encaixe.confirmar}>
          <ConflitosAviso conflitos={encaixe.conflitos} />
        </ConfirmModal>
      ) : null}
    </div>
  )
}

function Legenda() {
  const itens: Array<[string, string]> = [
    ['st-AGUARDANDO_PAGAMENTO', 'Aguardando pagamento'],
    ['st-CONFIRMADO', 'Confirmado'],
    ['st-EM_ATENDIMENTO', 'Em atendimento'],
    ['st-PENDENTE_FINALIZACAO', 'Pendente de finalização'],
    ['st-CONCLUIDO', 'Concluído'],
    ['st-NO_SHOW', 'No-show'],
  ]
  return (
    <div className="ag-legend">
      {itens.map(([cls, label]) => (
        <span key={cls} className={`ag-legend-item ${cls}`}>
          <span className="ag-legend-sw ag-legend-status" /> {label}
        </span>
      ))}
      <span className="ag-legend-item">
        <span className="ag-legend-sw ag-legend-int" /> Intervalo após o serviço
      </span>
      <span className="ag-legend-item">
        <span className="ag-legend-sw ag-legend-bloq" /> Bloqueio / Google
      </span>
      <span className="ag-legend-item">
        <span className="ag-legend-sw ag-legend-off" /> Fora da jornada
      </span>
      <span className="ag-legend-item muted">Arraste um bloco para reagendar · clique num horário vago para agendar</span>
    </div>
  )
}
