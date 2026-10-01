import { useMemo, useRef, useState } from 'react'
import { ApiError, errorMessage, post } from '../../../lib/api'
import { brl, dateLong, duration } from '../../../lib/format'
import { navigate, useQueryParam } from '../../../lib/router'
import { Avatar, PbAlert, PhoneField, QtyStepper, SummaryRow } from '../shared/components'
import type { ReservaResposta, ServicoPublico, SitePublico } from '../shared/types'
import { caminhoCheckout, digitosTelefone, mascaraTelefone, plural, telefoneValido } from '../shared/utils'
import HorarioStep from './HorarioStep'

type Passo = 'servicos' | 'profissional' | 'horario' | 'extras' | 'dados' | 'resumo'

const ROTULOS: Record<Passo, string> = {
  servicos: 'Serviços',
  profissional: 'Profissional',
  horario: 'Data e horário',
  extras: 'Adicionais',
  dados: 'Seus dados',
  resumo: 'Resumo',
}

const TITULOS: Record<Passo, string> = {
  servicos: 'O que você gostaria de agendar?',
  profissional: 'Com quem você quer ser atendido?',
  horario: 'Escolha o dia e o horário',
  extras: 'Que tal levar junto?',
  dados: 'Como podemos te chamar?',
  resumo: 'Confira e confirme sua reserva',
}

function habilitadosPara(servicos: ServicoPublico[], ids: string[]) {
  const escolhidos = ids.map((id) => servicos.find((x) => x.id === id)).filter((s): s is ServicoPublico => Boolean(s))
  if (!escolhidos.length) return []
  return escolhidos.slice(1).reduce((acc, s) => acc.filter((p) => s.profissionalIds.includes(p)), [...escolhidos[0].profissionalIds])
}

export default function BookingWizard({ slug, site }: { slug: string; site: SitePublico }) {
  const nomeQ = useQueryParam('nome')
  const telefoneQ = useQueryParam('telefone')
  const topoRef = useRef<HTMLDivElement>(null)

  const [passo, setPasso] = useState<Passo>('servicos')
  const [servicoIds, setServicoIds] = useState<string[]>([])
  const [profissionalId, setProfissionalId] = useState('')
  const [data, setData] = useState('')
  const [hora, setHora] = useState('')
  const [extras, setExtras] = useState<Record<string, number>>({})
  const [nome, setNome] = useState(nomeQ || '')
  const [telefone, setTelefone] = useState(mascaraTelefone(telefoneQ || ''))
  const [cupom, setCupom] = useState('')
  const [mostrarCupom, setMostrarCupom] = useState(false)
  const [aviso, setAviso] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [recarregar, setRecarregar] = useState(0)
  const [semCobranca, setSemCobranca] = useState(false)

  const escolhidos = useMemo(() => servicoIds.map((id) => site.servicos.find((s) => s.id === id)).filter((s): s is ServicoPublico => Boolean(s)), [servicoIds, site.servicos])
  const habilitadosIds = useMemo(() => habilitadosPara(site.servicos, servicoIds), [site.servicos, servicoIds])
  const habilitados = site.profissionais.filter((p) => habilitadosIds.includes(p.id))
  const profissional = site.profissionais.find((p) => p.id === profissionalId)

  const relacionados = useMemo(() => {
    if (!site.venderProdutos) return []
    const ids = new Set(escolhidos.flatMap((s) => s.produtoIds))
    return site.produtos.filter((p) => ids.has(p.id) && p.disponivel)
  }, [escolhidos, site.produtos, site.venderProdutos])

  const passos: Passo[] = ['servicos', 'profissional', 'horario', ...(relacionados.length ? (['extras'] as Passo[]) : []), 'dados', 'resumo']
  const indice = passos.indexOf(passo)

  const totalServicos = escolhidos.reduce((acc, s) => acc + s.preco, 0)
  const duracaoTotal = escolhidos.reduce((acc, s) => acc + s.duracaoMin, 0)
  const itensExtras = relacionados.filter((p) => (extras[p.id] || 0) > 0).map((p) => ({ produto: p, quantidade: extras[p.id] }))
  const totalExtras = itensExtras.reduce((acc, i) => acc + i.produto.preco * i.quantidade, 0)
  const total = totalServicos + totalExtras

  const categorias = useMemo(() => {
    const grupos: Array<{ nome: string; itens: ServicoPublico[] }> = []
    for (const s of site.servicos) {
      const nomeCat = s.categoria?.trim() || 'Outros serviços'
      const g = grupos.find((x) => x.nome === nomeCat)
      if (g) g.itens.push(s)
      else grupos.push({ nome: nomeCat, itens: [s] })
    }
    return grupos
  }, [site.servicos])

  function irPara(p: Passo) {
    setPasso(p)
    setErro('')
    requestAnimationFrame(() => {
      const el = topoRef.current
      if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 12), behavior: 'smooth' })
    })
  }

  function toggleServico(id: string) {
    const novos = servicoIds.includes(id) ? servicoIds.filter((x) => x !== id) : [...servicoIds, id]
    setServicoIds(novos)
    const hab = habilitadosPara(site.servicos, novos)
    if (hab.length === 1) setProfissionalId(hab[0])
    else if (!hab.includes(profissionalId)) setProfissionalId('')
    setHora('')
    // remove adicionais que deixaram de ser relacionados
    const relacionadosIds = new Set(novos.flatMap((sid) => site.servicos.find((s) => s.id === sid)?.produtoIds || []))
    setExtras((atual) => Object.fromEntries(Object.entries(atual).filter(([pid]) => relacionadosIds.has(pid))))
    setAviso('')
  }

  function compativel(s: ServicoPublico) {
    if (!servicoIds.length || servicoIds.includes(s.id)) return true
    return s.profissionalIds.some((p) => habilitadosIds.includes(p))
  }

  const podeAvancar: Record<Passo, boolean> = {
    servicos: escolhidos.length > 0 && habilitadosIds.length > 0,
    profissional: Boolean(profissionalId),
    horario: Boolean(data && hora),
    extras: true,
    dados: nome.trim().length >= 2 && telefoneValido(telefone),
    resumo: !enviando,
  }

  function avancar() {
    if (!podeAvancar[passo]) return
    if (passo === 'resumo') {
      reservar()
      return
    }
    let proximo = passos[indice + 1]
    // com um unico profissional habilitado, ele ja vem escolhido e o passo e pulado
    if (proximo === 'profissional' && habilitados.length === 1) {
      setProfissionalId(habilitados[0].id)
      proximo = 'horario'
    }
    irPara(proximo)
  }

  function voltar() {
    let anterior = passos[indice - 1]
    if (anterior === 'profissional' && habilitados.length === 1) anterior = 'servicos'
    if (anterior) irPara(anterior)
  }

  async function reservar() {
    setEnviando(true)
    setErro('')
    try {
      const r = await post<ReservaResposta>(
        `/publico/${slug}/agendamentos`,
        {
          servicoIds,
          profissionalId,
          data,
          hora,
          produtos: itensExtras.map((i) => ({ produtoId: i.produto.id, quantidade: i.quantidade })),
          cliente: { nome: nome.trim(), telefone: digitosTelefone(telefone) },
          cupom: cupom.trim() || undefined,
        },
        { publico: true }
      )
      const caminho = caminhoCheckout(r.linkPagamento, r.pagamentoId)
      if (caminho) navigate(caminho)
      else setSemCobranca(true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setHora('')
        setAviso('Poxa, esse horário acabou de ser reservado por outra pessoa. Escolha outro horário, por favor.')
        setRecarregar((n) => n + 1)
        irPara('horario')
      } else {
        setErro(errorMessage(e, 'Não foi possível concluir a reserva. Tente novamente.'))
      }
    } finally {
      setEnviando(false)
    }
  }

  if (!site.servicos.length) {
    return (
      <div className="pb-card pb-empty">
        <div className="pb-empty-icon">✂</div>
        Nenhum serviço disponível para agendamento online no momento.
      </div>
    )
  }

  if (semCobranca) {
    return (
      <div className="pb-card pb-confirm">
        <div className="pb-success-icon">✓</div>
        <h2 className="pb-confirm-title">Agendamento registrado!</h2>
        <p className="muted center">
          {dateLong(data)} às {hora} com {profissional?.nome}. Você vai receber a confirmação pelo WhatsApp.
        </p>
      </div>
    )
  }

  return (
    <>
      <div ref={topoRef} className="pb-wizard">
        <div className="pb-stepper-wrap">
          <div className="pb-stepper-caption">
            Passo {indice + 1} de {passos.length} · <strong>{ROTULOS[passo]}</strong>
          </div>
          <ol className="pb-stepper">
            {passos.map((p, i) => {
              const estado = i < indice ? 'done' : i === indice ? 'active' : ''
              return (
                <li key={p} className={`pb-step ${estado}`}>
                  <button type="button" disabled={i >= indice || enviando} onClick={() => irPara(p === 'profissional' && habilitados.length === 1 ? 'servicos' : p)}>
                    <span className="pb-step-bar" />
                    <span className="pb-step-label">{ROTULOS[p]}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="pb-step-head">
          {indice > 0 ? (
            <button type="button" className="pb-back" onClick={voltar} disabled={enviando} aria-label="Voltar">
              ‹
            </button>
          ) : null}
          <h2 className="pb-step-title">{TITULOS[passo]}</h2>
        </div>

        {/* 1. servicos */}
        {passo === 'servicos' ? (
          <div className="stack">
            <p className="muted">Você pode escolher mais de um serviço — eles serão feitos em sequência, com o mesmo profissional.</p>
            {categorias.map((g) => (
              <section key={g.nome} className="stack-sm">
                {categorias.length > 1 ? <div className="pb-label">{g.nome}</div> : null}
                <div className="pb-options">
                  {g.itens.map((s) => {
                    const sel = servicoIds.includes(s.id)
                    const ok = compativel(s)
                    return (
                      <button key={s.id} type="button" className={`pb-option ${sel ? 'selected' : ''}`} onClick={() => toggleServico(s.id)} disabled={!ok} aria-pressed={sel}>
                        <span className="pb-check">{sel ? '✓' : ''}</span>
                        <span className="pb-option-main">
                          <span className="pb-option-title">{s.nome}</span>
                          {s.descricao ? <span className="pb-option-desc">{s.descricao}</span> : null}
                          <span className="pb-option-meta">
                            <span className="pb-price">{brl(s.preco)}</span>
                            <span className="pb-pill">⏱ {duration(s.duracaoMin)}</span>
                            {!ok ? <span className="pb-pill pb-pill-warn">Não pode ser combinado com sua seleção</span> : null}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {/* 2. profissional */}
        {passo === 'profissional' ? (
          <div className="stack">
            <p className="muted">Mostramos apenas quem realiza {escolhidos.length > 1 ? 'todos os serviços escolhidos' : 'este serviço'}.</p>
            <div className="pb-options">
              {habilitados.map((p) => {
                const sel = p.id === profissionalId
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`pb-option pb-option-center ${sel ? 'selected' : ''}`}
                    onClick={() => {
                      if (p.id !== profissionalId) setHora('')
                      setProfissionalId(p.id)
                    }}
                    aria-pressed={sel}
                  >
                    <Avatar nome={p.nome} cor={p.cor} />
                    <span className="pb-option-main">
                      <span className="pb-option-title">{p.nome}</span>
                    </span>
                    <span className="pb-check pb-radio">{sel ? '✓' : ''}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* 3. data e horario */}
        {passo === 'horario' ? (
          <div className="stack">
            <PbAlert tipo="aviso">{aviso}</PbAlert>
            <p className="muted">
              Duração total: <strong>{duration(duracaoTotal)}</strong>
              {profissional ? (
                <>
                  {' '}
                  · com <strong>{profissional.nome}</strong>
                </>
              ) : null}
              . Os dias destacados têm horários livres.
            </p>
            <HorarioStep
              slug={slug}
              servicoIds={servicoIds}
              profissionalId={profissionalId}
              data={data}
              hora={hora}
              onData={(d) => {
                setData(d)
              }}
              onHora={(h) => {
                setHora(h)
                if (h) setAviso('')
              }}
              recarregar={recarregar}
            />
          </div>
        ) : null}

        {/* 4. order bump */}
        {passo === 'extras' ? (
          <div className="stack">
            <p className="muted">Produtos que combinam com o seu atendimento. Você retira no dia, aqui no estabelecimento. É opcional!</p>
            <div className="pb-options">
              {relacionados.map((p) => {
                const qtd = extras[p.id] || 0
                return (
                  <div key={p.id} className={`pb-option pb-option-static ${qtd ? 'selected' : ''}`}>
                    <span className="pb-option-main">
                      <span className="pb-option-title">{p.nome}</span>
                      {p.descricao ? <span className="pb-option-desc">{p.descricao}</span> : null}
                      <span className="pb-option-meta">
                        <span className="pb-price">{brl(p.preco)}</span>
                      </span>
                    </span>
                    {qtd ? (
                      <QtyStepper label={p.nome} value={qtd} max={Math.min(99, p.estoque)} onChange={(v) => setExtras((x) => ({ ...x, [p.id]: v }))} />
                    ) : (
                      <button type="button" className="btn pb-add-btn" onClick={() => setExtras((x) => ({ ...x, [p.id]: 1 }))}>
                        + Adicionar
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* 5. dados */}
        {passo === 'dados' ? (
          <form
            className="pb-card stack"
            onSubmit={(e) => {
              e.preventDefault()
              avancar()
            }}
          >
            <div className="field">
              <label htmlFor="pb-nome">Nome</label>
              <input id="pb-nome" className="input" autoComplete="name" placeholder="Seu nome completo" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="field">
              <label>Telefone (WhatsApp)</label>
              <PhoneField value={telefone} onChange={setTelefone} />
            </div>
            <div className="pb-note">
              <span aria-hidden>📱</span>
              <span>
                Seu telefone vincula este agendamento ao seu cadastro aqui no estabelecimento e é por ele que enviamos a confirmação pelo WhatsApp. Use sempre o
                mesmo número.
              </span>
            </div>
            <button type="submit" hidden />
          </form>
        ) : null}

        {/* 6. resumo */}
        {passo === 'resumo' ? (
          <div className="stack">
            <div className="pb-card">
              <div className="pb-card-title">Seu agendamento</div>
              <div className="pb-summary">
                {escolhidos.map((s) => (
                  <SummaryRow key={s.id} label={`${s.nome} · ${duration(s.duracaoMin)}`}>
                    {brl(s.preco)}
                  </SummaryRow>
                ))}
                {itensExtras.map((i) => (
                  <SummaryRow key={i.produto.id} label={`${i.quantidade}× ${i.produto.nome}`}>
                    {brl(i.produto.preco * i.quantidade)}
                  </SummaryRow>
                ))}
                <SummaryRow label="Total" strong>
                  {brl(total)}
                </SummaryRow>
              </div>
              <div className="pb-facts">
                <div>
                  <span className="pb-fact-label">Profissional</span>
                  <span className="pb-fact-value">{profissional?.nome}</span>
                </div>
                <div>
                  <span className="pb-fact-label">Data</span>
                  <span className="pb-fact-value">{dateLong(data)}</span>
                </div>
                <div>
                  <span className="pb-fact-label">Horário</span>
                  <span className="pb-fact-value">
                    {hora} <span className="muted">({duration(duracaoTotal)})</span>
                  </span>
                </div>
                <div>
                  <span className="pb-fact-label">Cliente</span>
                  <span className="pb-fact-value">
                    {nome.trim()} · {telefone}
                  </span>
                </div>
              </div>
              {itensExtras.length ? <div className="pb-note pb-note-soft">Os produtos são retirados no local, no dia do atendimento.</div> : null}
            </div>

            <div className="pb-card">
              {mostrarCupom ? (
                <div className="field">
                  <label htmlFor="pb-cupom">Cupom de desconto</label>
                  <input id="pb-cupom" className="input" placeholder="Digite o código" value={cupom} autoCapitalize="characters" onChange={(e) => setCupom(e.target.value.toUpperCase())} />
                  <span className="field-hint">O desconto já aparece no valor final, na tela de pagamento.</span>
                </div>
              ) : (
                <button type="button" className="pb-link" onClick={() => setMostrarCupom(true)}>
                  Tem um cupom de desconto?
                </button>
              )}
            </div>

            <div className="pb-policy">
              <div className="pb-policy-title">Política de cancelamento e reembolso</div>
              <p>{site.politica.texto}</p>
            </div>

            <div className="pb-note">
              <span aria-hidden>⏳</span>
              <span>
                Ao reservar, seu horário fica guardado por <strong>{site.reservaMinutos} minutos</strong> até a confirmação do pagamento (Pix ou cartão).
              </span>
            </div>
            <PbAlert tipo="erro">{erro}</PbAlert>
          </div>
        ) : null}
      </div>

      <div className="pb-bottombar">
        <div className="pb-bottombar-inner">
          <div className="pb-bottombar-info">
            {escolhidos.length ? (
              <>
                <div className="pb-total-label">
                  {plural(escolhidos.length, 'serviço', 'serviços')} · {duration(duracaoTotal)}
                  {itensExtras.length ? ` · ${plural(itensExtras.reduce((a, i) => a + i.quantidade, 0), 'produto', 'produtos')}` : ''}
                </div>
                <div className="pb-total">{brl(total)}</div>
              </>
            ) : (
              <div className="pb-total-label">Escolha ao menos um serviço</div>
            )}
          </div>
          <button type="button" className="btn btn-primary btn-lg pb-cta" disabled={!podeAvancar[passo] || enviando} onClick={avancar}>
            {passo === 'resumo' ? (enviando ? 'Reservando...' : 'Reservar e pagar') : passo === 'extras' && !itensExtras.length ? 'Pular' : 'Continuar'}
          </button>
        </div>
      </div>
    </>
  )
}
