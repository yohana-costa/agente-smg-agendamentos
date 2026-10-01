import { useEffect, useState } from 'react'
import { errorMessage } from '../../../lib/api'
import { addDays, brl, countdown, dateLong, MONTHS, monthRange, REGRA_REEMBOLSO, todayStr, weekdayOf, WEEKDAYS_SHORT } from '../../../lib/format'
import { useAsync, useCountdown } from '../../../lib/hooks'
import { navigate } from '../../../lib/router'
import { Modal, StatusBadge } from '../../../components/ui'
import { Calendario, HorariosGrid, PbAlert, PbSpinner } from '../shared/components'
import type { AgendamentoPortal, CalculoReembolso, HorariosResposta, SimulacaoReagendamento } from '../shared/types'
import { caminhoCheckout } from '../shared/utils'
import type { PortalClient } from './client'

export function DataBloco({ data }: { data: string }) {
  return (
    <div className="pb-date-block">
      <div className="pb-date-wd">{WEEKDAYS_SHORT[weekdayOf(data)]}</div>
      <div className="pb-date-day">{Number(data.slice(8, 10))}</div>
      <div className="pb-date-mon">{MONTHS[Number(data.slice(5, 7)) - 1].slice(0, 3)}</div>
    </div>
  )
}

function ReservaPendente({ ag, onExpirou }: { ag: AgendamentoPortal; onExpirou: () => void }) {
  const segundos = useCountdown(ag.segundosRestantesReserva)
  const caminho = caminhoCheckout(ag.linkPagamento)
  const expirou = segundos !== null && segundos <= 0
  useEffect(() => {
    if (expirou) {
      const t = setTimeout(onExpirou, 1500)
      return () => clearTimeout(t)
    }
  }, [expirou, onExpirou])
  if (!caminho) return null
  return (
    <div className={`pb-pending ${expirou ? 'is-expired' : ''}`}>
      <div>
        <div className="strong">{expirou ? 'Reserva expirada' : 'Pagamento pendente'}</div>
        <div className="small">{expirou ? 'O horário foi liberado.' : <>Pague em até <span className="mono strong">{countdown(segundos)}</span> para confirmar.</>}</div>
      </div>
      {!expirou ? (
        <button type="button" className="btn btn-primary" onClick={() => navigate(caminho)}>
          Pagar agora
        </button>
      ) : null}
    </div>
  )
}

export default function MeusAgendamentos({ client, slug }: { client: PortalClient; slug: string }) {
  const { data, loading, error, reload } = useAsync(() => client.get<AgendamentoPortal[]>('/agendamentos'), [client])
  const [cancelando, setCancelando] = useState<AgendamentoPortal | null>(null)
  const [reagendando, setReagendando] = useState<AgendamentoPortal | null>(null)
  const [sucesso, setSucesso] = useState('')

  if (loading && !data) return <PbSpinner />
  if (error && !data) return <PbAlert tipo="erro">{error}</PbAlert>
  const lista = data || []

  return (
    <div className="stack">
      <PbAlert tipo="sucesso">{sucesso}</PbAlert>
      {!lista.length ? (
        <div className="pb-card pb-empty">
          <div className="pb-empty-icon">📅</div>
          <p>Você não tem agendamentos futuros.</p>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate(`/s/${slug}`)}>
            Agendar agora
          </button>
        </div>
      ) : (
        lista.map((ag) => {
          const podeAlterar = ag.status === 'AGUARDANDO_PAGAMENTO' || ag.status === 'CONFIRMADO'
          return (
            <article key={ag.id} className="pb-card pb-appt">
              <div className="pb-appt-top">
                <DataBloco data={ag.data} />
                <div className="pb-appt-main">
                  <div className="pb-appt-time">
                    {ag.hora} – {ag.horaFim}
                  </div>
                  <div className="pb-option-title">{ag.servicos.map((s) => s.nome).join(' + ')}</div>
                  {ag.profissional ? <div className="small muted">com {ag.profissional}</div> : null}
                  <div className="pb-appt-meta">
                    <StatusBadge status={ag.status} />
                    <span className="strong">{brl(ag.valorTotal)}</span>
                  </div>
                  {ag.produtos.length ? <div className="small muted">+ {ag.produtos.map((p) => `${p.quantidade}× ${p.nome}`).join(', ')} (retirada no local)</div> : null}
                </div>
              </div>
              {ag.status === 'AGUARDANDO_PAGAMENTO' ? <ReservaPendente ag={ag} onExpirou={reload} /> : null}
              {podeAlterar ? (
                <div className="pb-appt-actions">
                  <button type="button" className="btn" onClick={() => setReagendando(ag)}>
                    Reagendar
                  </button>
                  <button type="button" className="btn pb-btn-danger-ghost" onClick={() => setCancelando(ag)}>
                    Cancelar
                  </button>
                </div>
              ) : null}
            </article>
          )
        })
      )}

      {cancelando ? (
        <CancelarModal
          client={client}
          ag={cancelando}
          onClose={() => setCancelando(null)}
          onFeito={(msg) => {
            setCancelando(null)
            setSucesso(msg)
            reload()
          }}
        />
      ) : null}
      {reagendando ? (
        <ReagendarModal
          client={client}
          ag={reagendando}
          onClose={() => setReagendando(null)}
          onFeito={(msg) => {
            setReagendando(null)
            setSucesso(msg)
            reload()
          }}
        />
      ) : null}
    </div>
  )
}

function ResumoAgendamento({ ag }: { ag: AgendamentoPortal }) {
  return (
    <div className="pb-mini-summary">
      <div className="strong">{ag.servicos.map((s) => s.nome).join(' + ')}</div>
      <div className="small muted">
        {dateLong(ag.data)} às {ag.hora}
        {ag.profissional ? ` · ${ag.profissional}` : ''}
      </div>
    </div>
  )
}

function ReembolsoInfo({ calc }: { calc: CalculoReembolso }) {
  return (
    <div className="pb-refund">
      <div className="pb-refund-rule">{REGRA_REEMBOLSO[calc.regra] || calc.regra}</div>
      <p className="small">{calc.descricao}</p>
      <div className="pb-refund-grid">
        <div>
          <span className="pb-fact-label">Valor pago</span>
          <span className="pb-fact-value">{brl(calc.valorPago)}</span>
        </div>
        <div>
          <span className="pb-fact-label">Será devolvido</span>
          <span className="pb-fact-value pb-refund-value">{brl(calc.valor)}</span>
        </div>
      </div>
    </div>
  )
}

function CancelarModal({ client, ag, onClose, onFeito }: { client: PortalClient; ag: AgendamentoPortal; onClose: () => void; onFeito: (msg: string) => void }) {
  const sim = useAsync(() => client.get<CalculoReembolso>(`/agendamentos/${ag.id}/simular-cancelamento`), [ag.id])
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')

  async function confirmar() {
    setBusy(true)
    setErro('')
    try {
      const r = await client.post<{ status: string; reembolso: CalculoReembolso }>(`/agendamentos/${ag.id}/cancelar`)
      onFeito(r.reembolso?.valor > 0 ? `Agendamento cancelado. ${brl(r.reembolso.valor)} serão devolvidos para você.` : 'Agendamento cancelado.')
    } catch (e) {
      setErro(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Cancelar agendamento"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Manter agendamento
          </button>
          <button type="button" className="btn btn-danger" onClick={confirmar} disabled={busy || sim.loading || Boolean(sim.error)}>
            {busy ? 'Cancelando...' : 'Confirmar cancelamento'}
          </button>
        </>
      }
    >
      <div className="stack">
        <ResumoAgendamento ag={ag} />
        {sim.loading ? (
          <PbSpinner label="Calculando reembolso..." />
        ) : sim.error ? (
          <PbAlert tipo="erro">{sim.error}</PbAlert>
        ) : sim.data ? (
          ag.status === 'AGUARDANDO_PAGAMENTO' && sim.data.valorPago === 0 ? (
            <PbAlert tipo="info">Este agendamento ainda não foi pago, então nada será cobrado. O horário será liberado.</PbAlert>
          ) : (
            <ReembolsoInfo calc={sim.data} />
          )
        ) : null}
        <PbAlert tipo="erro">{erro}</PbAlert>
      </div>
    </Modal>
  )
}

function ReagendarModal({ client, ag, onClose, onFeito }: { client: PortalClient; ag: AgendamentoPortal; onClose: () => void; onFeito: (msg: string) => void }) {
  const sim = useAsync(() => client.get<SimulacaoReagendamento>(`/agendamentos/${ag.id}/simular-reagendamento`), [ag.id])
  const [fase, setFase] = useState<'regra' | 'horario' | 'confirmar'>('regra')
  const hoje = todayStr()
  const [mes, setMes] = useState(monthRange(hoje).from)
  const [data, setData] = useState('')
  const [hora, setHora] = useState('')
  const [horarios, setHorarios] = useState<string[]>([])
  const [carregandoHorarios, setCarregandoHorarios] = useState(false)
  const [erroHorarios, setErroHorarios] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [recarregar, setRecarregar] = useState(0)
  const limite = addDays(hoje, 120)
  // dias com horario livre no mes exibido (mesmos servicos e profissional)
  const [diasLivres, setDiasLivres] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (fase !== 'horario') return
    let ativo = true
    setDiasLivres(null)
    client
      .get<string[]>(`/agendamentos/${ag.id}/dias`, { de: mes < hoje ? hoje : mes })
      .then((dias) => ativo && setDiasLivres(new Set(dias)))
      .catch(() => ativo && setDiasLivres(new Set()))
    return () => {
      ativo = false
    }
  }, [client, ag.id, mes, fase, hoje, recarregar])

  useEffect(() => {
    if (!data) return
    let ativo = true
    setCarregandoHorarios(true)
    setErroHorarios('')
    client
      .get<HorariosResposta>(`/agendamentos/${ag.id}/horarios`, { data })
      .then((r) => {
        if (!ativo) return
        setHorarios(r.profissionais[0]?.horarios || [])
      })
      .catch((e) => ativo && setErroHorarios(errorMessage(e)))
      .finally(() => ativo && setCarregandoHorarios(false))
    return () => {
      ativo = false
    }
  }, [client, ag.id, data, recarregar])

  async function confirmar() {
    setBusy(true)
    setErro('')
    try {
      const r = await client.post<{ agendamento: AgendamentoPortal; novoAgendamento: boolean; reembolso: CalculoReembolso | null }>(`/agendamentos/${ag.id}/reagendar`, { data, hora })
      if (r.novoAgendamento) {
        const caminho = caminhoCheckout(r.agendamento.linkPagamento)
        if (caminho) {
          navigate(caminho)
          return
        }
        onFeito('Reagendado! O novo horário aguarda pagamento — use o botão “Pagar agora”.')
        return
      }
      onFeito(`Pronto! Seu agendamento foi para ${dateLong(data)} às ${hora}. Você vai receber a confirmação pelo WhatsApp.`)
    } catch (e) {
      setErro(errorMessage(e))
      setBusy(false)
      setHora('')
      setRecarregar((n) => n + 1)
      setFase('horario')
    }
  }

  const exigeNovo = Boolean(sim.data?.exigeNovoPagamento)

  const footer =
    fase === 'regra' ? (
      <>
        <button type="button" className="btn" onClick={onClose}>
          Voltar
        </button>
        <button type="button" className="btn btn-primary" disabled={sim.loading || Boolean(sim.error)} onClick={() => setFase('horario')}>
          Escolher novo horário
        </button>
      </>
    ) : fase === 'horario' ? (
      <>
        <button type="button" className="btn" onClick={() => setFase('regra')}>
          Voltar
        </button>
        <button type="button" className="btn btn-primary" disabled={!data || !hora} onClick={() => setFase('confirmar')}>
          Continuar
        </button>
      </>
    ) : (
      <>
        <button type="button" className="btn" onClick={() => setFase('horario')} disabled={busy}>
          Voltar
        </button>
        <button type="button" className="btn btn-primary" onClick={confirmar} disabled={busy}>
          {busy ? 'Reagendando...' : exigeNovo ? 'Confirmar e ir para o pagamento' : 'Confirmar reagendamento'}
        </button>
      </>
    )

  return (
    <Modal title="Reagendar" onClose={onClose} footer={footer}>
      <div className="stack">
        {fase === 'regra' ? (
          <>
            <ResumoAgendamento ag={ag} />
            {sim.loading ? (
              <PbSpinner label="Verificando a política..." />
            ) : sim.error ? (
              <PbAlert tipo="erro">{sim.error}</PbAlert>
            ) : sim.data ? (
              <>
                <PbAlert tipo={sim.data.exigeNovoPagamento ? 'aviso' : 'sucesso'}>{sim.data.descricao}</PbAlert>
                {sim.data.exigeNovoPagamento && sim.data.reembolso ? <ReembolsoInfo calc={sim.data.reembolso} /> : null}
              </>
            ) : null}
          </>
        ) : null}

        {fase === 'horario' ? (
          <>
            <Calendario
              mes={mes}
              onMes={setMes}
              selecionado={data}
              onSelect={(d) => {
                setData(d)
                setHora('')
              }}
              habilitado={(d) => d >= hoje && d <= limite && (diasLivres ? diasLivres.has(d) : false)}
              carregando={diasLivres === null}
              maxMesesFrente={4}
            />
            {data ? (
              <div className="stack-sm">
                <div className="pb-card-title">{dateLong(data)}</div>
                {carregandoHorarios ? (
                  <PbSpinner label="Buscando horários livres..." />
                ) : erroHorarios ? (
                  <PbAlert tipo="erro">{erroHorarios}</PbAlert>
                ) : horarios.length ? (
                  <HorariosGrid horarios={horarios} selecionado={hora} onSelect={setHora} />
                ) : (
                  <div className="pb-empty-inline">Nenhum horário livre neste dia. Tente outra data.</div>
                )}
              </div>
            ) : (
              <p className="muted small center">Toque em um dia para ver os horários livres.</p>
            )}
            <PbAlert tipo="erro">{erro}</PbAlert>
          </>
        ) : null}

        {fase === 'confirmar' ? (
          <>
            <div className="pb-move">
              <div>
                <span className="pb-fact-label">De</span>
                <span className="pb-fact-value pb-strike">
                  {dateLong(ag.data)} às {ag.hora}
                </span>
              </div>
              <div className="pb-move-arrow">↓</div>
              <div>
                <span className="pb-fact-label">Para</span>
                <span className="pb-fact-value">
                  {dateLong(data)} às {hora}
                </span>
              </div>
            </div>
            {exigeNovo ? (
              <PbAlert tipo="aviso">
                Como está fora do prazo, o agendamento atual será cancelado conforme a política
                {sim.data?.reembolso ? ` (devolução de ${brl(sim.data.reembolso.valor)})` : ''} e o novo horário exige um novo pagamento.
              </PbAlert>
            ) : (
              <PbAlert tipo="sucesso">O pagamento acompanha o novo horário.</PbAlert>
            )}
            <PbAlert tipo="erro">{erro}</PbAlert>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
