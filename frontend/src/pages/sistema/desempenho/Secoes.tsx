import type { ReactNode } from 'react'
import { Banknote, CalendarClock, Clock, Gauge, Hourglass, Package, Repeat, ShoppingBag, TimerOff, TrendingUp, UserMinus, UserX, Users, XCircle } from 'lucide-react'
import { brl, duration, MONTHS, ORIGEM, pct, WEEKDAYS_SHORT } from '../../../lib/format'
import { BarList, Card, ColumnChart, Empty, Progress, Stat } from '../../../components/ui'
import { brlCompacto, horas, type DesempenhoResp } from './types'

function Secao({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) {
  return (
    <section className="de-section">
      <div className="de-section-head">
        <h3>{titulo}</h3>
        {sub ? <span>{sub}</span> : null}
      </div>
      <div className="stack">{children}</div>
    </section>
  )
}

// segunda a domingo
const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0]

export function Capacidade({ d, mostrarPorProfissional }: { d: DesempenhoResp; mostrarPorProfissional: boolean }) {
  const c = d.capacidade
  const porDia = ORDEM_SEMANA.map((i) => c.porDiaSemana.find((x) => x.diaSemana === i) || { diaSemana: i, disponiveis: 0, ocupados: 0, taxa: 0 })
  const meta = c.metaServicos
  const porDiaCard = (
    <Card title="Ocupação por dia da semana">
      <ColumnChart items={porDia.map((x) => ({ label: WEEKDAYS_SHORT[x.diaSemana], value: x.taxa }))} format={(v) => pct(v)} />
    </Card>
  )
  const faixaCard = (
    <Card title="Ocupação por faixa de horário" subtitle="Horas ocupadas por hora de início">
      {c.porFaixaHorario.length ? <ColumnChart items={c.porFaixaHorario.map((f) => ({ label: f.faixa, value: f.horasOcupadas }))} format={(v) => horas(v)} /> : <Empty>Sem dados no período.</Empty>}
    </Card>
  )
  return (
    <Secao titulo="Capacidade e ocupação" sub="Horas disponíveis reais: jornada, folgas, bloqueios e Google Calendar.">
      <div className="de-frase">
        Você comportava cerca de <strong>{c.capacidadeServicos.toLocaleString('pt-BR')} serviços</strong> neste período,{' '}
        {meta ? (
          <>
            a meta era <strong>{meta.toLocaleString('pt-BR')}</strong>
          </>
        ) : (
          'sem meta de serviços definida'
        )}{' '}
        e foram feitos <strong>{c.servicosRealizados.toLocaleString('pt-BR')}</strong>.
      </div>
      <div className="stats-grid">
        <Stat icon={Gauge} grad="sky" label="Taxa de ocupação" value={pct(c.taxaOcupacao)} hint={<Progress value={c.taxaOcupacao} />} />
        <Stat icon={Clock} grad="indigo" label="Horas ocupadas" value={horas(c.horasOcupadas)} hint={`de ${horas(c.horasDisponiveis)} disponíveis`} />
        <Stat icon={Hourglass} grad="teal" label="Horas ociosas" value={horas(c.horasOciosas)} hint="Capacidade sem cliente" />
        <Stat icon={UserX} grad="rose" label="Horas perdidas com no-show" value={<span className={c.horasPerdidasNoShow ? 'de-bad' : ''}>{horas(c.horasPerdidasNoShow)}</span>} hint="Vendidas que viraram ociosidade" />
        <Stat
          label="Dias fechados fora da rotina"
          value={c.diasFechadosForaRotina}
          hint={c.diasFechadosForaRotina ? `${horas(c.horasPerdidasFechamento)} de capacidade perdida` : 'Nenhum fechamento extra'}
        />
      </div>
      <div className="grid-2">
        <Card title="Capacidade x meta x realizado" subtitle="Em quantidade de serviços">
          <BarList
            items={[
              { key: 'cap', label: 'Capacidade', value: c.capacidadeServicos },
              { key: 'meta', label: 'Meta', value: meta },
              { key: 'real', label: 'Realizados', value: c.servicosRealizados },
            ]}
            format={(v) => v.toLocaleString('pt-BR')}
          />
          <div className="de-cmr">
            <div className="de-cmr-item">
              <div className="de-cmr-num">{pct(c.capacidadeServicos ? (c.servicosRealizados / c.capacidadeServicos) * 100 : 0)}</div>
              <div className="de-cmr-lbl">da capacidade usada</div>
            </div>
            <div className="de-cmr-item">
              <div className="de-cmr-num">{meta ? pct((c.servicosRealizados / meta) * 100) : '—'}</div>
              <div className="de-cmr-lbl">da meta atingida</div>
            </div>
            <div className="de-cmr-item">
              <div className="de-cmr-num">{Math.max(0, c.capacidadeServicos - c.servicosRealizados).toLocaleString('pt-BR')}</div>
              <div className="de-cmr-lbl">serviços de folga</div>
            </div>
          </div>
        </Card>
        {mostrarPorProfissional ? (
          <Card title="Ocupação por profissional">
            <BarList
              items={[...c.porProfissional].sort((a, b) => b.taxa - a.taxa).map((p) => ({ key: p.profissionalId, label: p.nome, value: p.taxa }))}
              format={(v) => pct(v)}
            />
          </Card>
        ) : (
          porDiaCard
        )}
      </div>
      {mostrarPorProfissional ? (
        <div className="grid-2">
          {porDiaCard}
          {faixaCard}
        </div>
      ) : (
        faixaCard
      )}
    </Secao>
  )
}

export function Comparecimento({ d }: { d: DesempenhoResp }) {
  const c = d.comparecimento
  return (
    <Secao titulo="Comparecimento" sub={`${c.total} agendamento(s) válidos no período`}>
      <div className="stats-grid">
        <Stat icon={UserX} grad="rose" label="Taxa de no-show" value={<span className={c.taxaNoShow >= 10 ? 'de-bad' : ''}>{pct(c.taxaNoShow)}</span>} hint={`${c.noShows} no-show(s)`} />
        <Stat icon={XCircle} grad="amber" label="Taxa de cancelamento" value={pct(c.taxaCancelamento)} hint={`${c.cancelamentos} cancelamento(s)`} />
        <Stat icon={TimerOff} grad="violet" label="Expirados sem pagamento" value={c.expiradosSemPagamento} hint="Reservas canceladas após 15 min sem pagamento" />
      </div>
    </Secao>
  )
}

export function Clientes({ d }: { d: DesempenhoResp }) {
  const c = d.clientes
  const totalNR = c.novos + c.recorrentes
  const pNovos = totalNR ? (c.novos / totalNR) * 100 : 0
  return (
    <Secao titulo="Clientes">
      <div className="grid-2">
        <div className="stats-grid" style={{ alignContent: 'start' }}>
          <Stat icon={Users} grad="sky" label="Clientes atendidos" value={c.atendidos} />
          <Stat icon={Repeat} grad="lime" label="Recorrência" value={pct(c.taxaRecorrencia)} hint={`${c.recorrentes} voltaram no período`} />
          <Stat icon={CalendarClock} grad="amber" label="Retorno atrasado" value={<span className={c.retornoAtrasado ? 'de-bad' : ''}>{c.retornoAtrasado}</span>} hint="Passaram do retorno sugerido" />
          <Stat icon={UserMinus} grad="rose" label="Inativos" value={c.inativos} hint="Sem atendimento há muito tempo" />
        </div>
        <Card title="Novos x recorrentes">
          {totalNR ? (
            <>
              <div className="row-between">
                <div>
                  <div className="stat-value">{c.novos}</div>
                  <div className="small muted">novos</div>
                </div>
                <div className="right">
                  <div className="stat-value">{c.recorrentes}</div>
                  <div className="small muted">recorrentes</div>
                </div>
              </div>
              <div className="de-split">
                <span style={{ width: `${pNovos}%` }} />
                <span style={{ width: `${100 - pNovos}%` }} />
              </div>
              <div className="de-legend">
                <span>
                  <i style={{ background: 'hsl(var(--primary))' }} />
                  Novos {pct(pNovos)}
                </span>
                <span>
                  <i style={{ background: '#7de2c0' }} />
                  Recorrentes {pct(100 - pNovos)}
                </span>
              </div>
            </>
          ) : (
            <Empty>Nenhum cliente atendido no período.</Empty>
          )}
        </Card>
      </div>
    </Secao>
  )
}

export function Servicos({ d }: { d: DesempenhoResp }) {
  const s = d.servicos
  return (
    <Secao titulo="Serviços">
      <div className="grid-2">
        <Card title="Mais realizados">
          <BarList items={s.maisRealizados.slice(0, 8).map((x) => ({ key: x.servicoId, label: x.nome, value: x.quantidade }))} format={(v) => `${v}x`} />
        </Card>
        <Card title="Que mais faturam">
          <BarList items={s.maisFaturam.slice(0, 8).map((x) => ({ key: x.servicoId, label: x.nome, value: x.faturamento }))} format={(v) => brl(v)} />
        </Card>
      </div>
      <Card title="Duração real x duração informada" subtitle="Apenas atendimentos com Iniciar e Finalizar no momento certo. Atualize a duração na aba Serviços / Produtos.">
        {s.duracao.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th className="right">Realizados</th>
                  <th className="right">Informada</th>
                  <th className="right">Real média</th>
                  <th className="right">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {s.duracao.map((x) => {
                  const diff = (x.duracaoRealMedia || 0) - x.duracaoInformada
                  return (
                    <tr key={x.servicoId}>
                      <td className="strong">{x.nome}</td>
                      <td className="right">{x.quantidade}</td>
                      <td className="right nowrap">{duration(x.duracaoInformada)}</td>
                      <td className="right nowrap strong">{duration(x.duracaoRealMedia)}</td>
                      <td className={`right nowrap ${diff > 0 ? 'de-diff-up' : diff < 0 ? 'de-diff-down' : 'de-good'}`}>{diff === 0 ? 'igual' : `${diff > 0 ? '+' : ''}${diff} min`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Ainda não há durações reais registradas no período.</Empty>
        )}
      </Card>
    </Secao>
  )
}

export function Produtos({ produtos }: { produtos: NonNullable<DesempenhoResp['produtos']> }) {
  const qtd = produtos.maisVendidos.reduce((a, p) => a + p.quantidade, 0)
  return (
    <Secao titulo="Produtos">
      <div className="grid-2">
        <div className="stats-grid" style={{ alignContent: 'start' }}>
          <Stat icon={ShoppingBag} grad="indigo" label="Faturamento com produtos" value={brl(produtos.faturamento)} />
          <Stat icon={Package} grad="teal" label="Unidades vendidas" value={qtd.toLocaleString('pt-BR')} hint="Site, balcão e atendimentos" />
        </div>
        <Card title="Mais vendidos">
          <BarList items={produtos.maisVendidos.slice(0, 8).map((p) => ({ key: p.produtoId, label: p.nome, value: p.quantidade }))} format={(v) => `${v} un.`} />
        </Card>
      </div>
    </Secao>
  )
}

export function Profissionais({ d }: { d: DesempenhoResp }) {
  const lista = d.profissionais
  return (
    <Secao titulo="Profissionais" sub="Ranking por faturamento, serviços realizados e ocupação">
      <Card>
        {lista.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Profissional</th>
                  <th className="right">Serviços</th>
                  <th className="right">Faturamento</th>
                  <th>Ocupação</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p, i) => (
                  <tr key={p.profissionalId}>
                    <td>
                      <span className={`de-rank ${i === 0 ? 'de-top' : ''}`}>{i + 1}</span>
                    </td>
                    <td className="strong">{p.nome}</td>
                    <td className="right">{p.servicos}</td>
                    <td className="right strong nowrap">{brl(p.faturamento)}</td>
                    <td>
                      <div className="de-occ">
                        <Progress value={p.ocupacao} />
                        <span className="small strong nowrap">{pct(p.ocupacao)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Sem dados no período.</Empty>
        )}
      </Card>
    </Secao>
  )
}

function mesCurto(mes: string) {
  const [y, m] = mes.split('-')
  return `${MONTHS[Number(m) - 1].slice(0, 3)}/${y.slice(2)}`
}

export function Receita({ d }: { d: DesempenhoResp }) {
  const r = d.receita
  const totalOrigem = r.origem.SITE + r.origem.AGENTE + r.origem.MANUAL
  const origemItens = (['SITE', 'AGENTE', 'MANUAL'] as const).map((k) => ({
    key: k,
    label: k === 'AGENTE' ? 'Agente de atendimento' : ORIGEM[k],
    value: r.origem[k],
  }))
  const horarios = Object.entries(r.procura.horarios)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }))
  const diaTop = ORDEM_SEMANA.reduce((best, i) => (r.procura.diasSemana[i] > r.procura.diasSemana[best] ? i : best), ORDEM_SEMANA[0])
  const horaTop = horarios.reduce<{ label: string; value: number } | null>((best, h) => (!best || h.value > best.value ? h : best), null)
  const evol = r.evolucaoMensal
  const atual = evol[evol.length - 1]
  const anterior = evol[evol.length - 2]
  const variacao = anterior && anterior.faturamento ? ((atual.faturamento - anterior.faturamento) / anterior.faturamento) * 100 : null

  return (
    <Secao titulo="Receita">
      <div className="stats-grid">
        <Stat icon={Banknote} grad="indigo" label="Faturamento no período" value={brl(r.faturamento)} hint={`${r.atendimentos} atendimento(s) concluído(s)`} />
        <Stat icon={TrendingUp} grad="violet" label="Ticket médio" value={brl(r.ticketMedio)} />
        <Stat
          label="Mês atual x anterior"
          value={variacao === null ? '—' : <span className={variacao >= 0 ? 'de-good' : 'de-bad'}>{`${variacao >= 0 ? '+' : ''}${pct(variacao)}`}</span>}
          hint={atual ? `${brl(atual.faturamento)} em ${mesCurto(atual.mes)}` : undefined}
        />
      </div>
      <Card title="Evolução mês a mês" subtitle="Faturamento dos últimos 12 meses (atendimentos concluídos)">
        <ColumnChart items={evol.map((m) => ({ label: mesCurto(m.mes), value: m.faturamento }))} format={(v) => brlCompacto(v)} />
      </Card>
      <div className="grid-2">
        <Card title="Origem dos agendamentos" subtitle={`${totalOrigem} agendamento(s)`}>
          <BarList items={totalOrigem ? origemItens : []} format={(v) => `${v} · ${pct(totalOrigem ? (v / totalOrigem) * 100 : 0)}`} />
        </Card>
        <Card title="Dias mais procurados" subtitle={totalOrigem ? `Pico: ${WEEKDAYS_SHORT[diaTop]}` : undefined}>
          <ColumnChart items={ORDEM_SEMANA.map((i) => ({ label: WEEKDAYS_SHORT[i], value: r.procura.diasSemana[i] || 0 }))} />
        </Card>
      </div>
      <Card title="Horários mais procurados" subtitle={horaTop ? `Pico às ${horaTop.label}` : undefined}>
        {horarios.length ? <ColumnChart items={horarios} /> : <Empty>Sem agendamentos no período.</Empty>}
      </Card>
    </Secao>
  )
}
