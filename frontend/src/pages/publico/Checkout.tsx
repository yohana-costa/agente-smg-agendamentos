import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, errorMessage, get, post } from '../../lib/api'
import { brl, countdown, dateLong } from '../../lib/format'
import { useCountdown } from '../../lib/hooks'
import { Link, useQueryParam } from '../../lib/router'
import { DevNotice, PbAlert, PbLogo, PbShell, PbSpinner, SummaryRow } from './shared/components'
import type { CheckoutInfo } from './shared/types'
import { copiarTexto, primeiroNome, srcQrCode } from './shared/utils'

const POLL_MS = 4000

/** Checkout SMG (/pagamento/:id): Pix ou cartao, com contagem regressiva da reserva. */
export default function Checkout({ pagamentoId }: { pagamentoId: string }) {
  const simularParam = useQueryParam('simular')
  const [info, setInfo] = useState<CheckoutInfo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState('')

  const carregou = useRef(false)

  const carregar = useCallback(async () => {
    try {
      const d = await get<CheckoutInfo>(`/checkout/${pagamentoId}`, undefined, { publico: true })
      carregou.current = true
      setInfo(d)
      setErroCarga('')
    } catch (e) {
      // falha pontual no polling nao derruba a tela
      if (!carregou.current) setErroCarga(e instanceof ApiError && e.status === 404 ? 'Pagamento não encontrado. Confira o link recebido.' : errorMessage(e))
    } finally {
      setCarregando(false)
    }
  }, [pagamentoId])

  useEffect(() => {
    setCarregando(true)
    carregar()
  }, [carregar])

  const segundos = useCountdown(info?.segundosRestantes ?? null)
  const expiradoLocal = info?.status === 'PENDENTE' && info.segundosRestantes !== null && segundos !== null && segundos <= 0
  const pendente = info?.status === 'PENDENTE' && !expiradoLocal

  // polling enquanto o pagamento estiver pendente
  useEffect(() => {
    if (!pendente) return
    const t = setInterval(carregar, POLL_MS)
    return () => clearInterval(t)
  }, [pendente, carregar])

  if (carregando && !info) {
    return (
      <PbShell titulo="Pagamento">
        <PbSpinner label="Carregando pagamento..." />
      </PbShell>
    )
  }
  if (!info) {
    return (
      <PbShell titulo="Pagamento">
        <div className="pb-center-page">
          <div className="pb-card pb-empty">
            <div className="pb-empty-icon">🔎</div>
            {erroCarga || 'Não foi possível carregar o pagamento.'}
          </div>
        </div>
      </PbShell>
    )
  }

  const est = info.estabelecimento
  const siteUrl = `/s/${est.slug}`

  return (
    <PbShell cor={est.corPrimaria} titulo={`Pagamento · ${est.nome}`}>
      <div className="pb-checkout">
        <div className="pb-co-brand">
          <PbLogo url={est.logoUrl} nome={est.nome} size="md" />
          <div className="pb-co-brand-text">
            <div className="pb-co-brand-name">{est.nome}</div>
            <div className="pb-co-secure">🔒 Pagamento seguro</div>
          </div>
        </div>

        {info.status === 'APROVADO' ? (
          <Confirmacao info={info} />
        ) : info.status === 'EXPIRADO' || expiradoLocal ? (
          <Encerrado
            icone="⌛"
            titulo={info.venda ? 'Pedido expirado' : 'Reserva expirada — horário liberado'}
            texto={
              info.venda
                ? 'O prazo para pagamento terminou e o pedido foi cancelado. Você pode fazer um novo pedido quando quiser.'
                : 'O prazo de pagamento terminou e o horário voltou a ficar disponível. Você pode fazer uma nova reserva em poucos passos.'
            }
            siteUrl={siteUrl}
            acao={info.venda ? 'Voltar à loja' : 'Agendar novamente'}
          />
        ) : info.status === 'CANCELADO' ? (
          <Encerrado
            icone="✕"
            titulo={info.venda ? 'Pedido cancelado' : 'Agendamento cancelado'}
            texto="Este pagamento não está mais disponível. Se quiser, faça uma nova reserva pelo site."
            siteUrl={siteUrl}
            acao="Ir para o site"
          />
        ) : info.status === 'REEMBOLSADO' || info.status === 'REEMBOLSADO_PARCIAL' ? (
          <Encerrado
            icone="↩"
            titulo={info.status === 'REEMBOLSADO' ? 'Pagamento reembolsado' : 'Pagamento parcialmente reembolsado'}
            texto="Este pagamento já foi confirmado e depois reembolsado conforme a política do estabelecimento."
            siteUrl={siteUrl}
            acao="Ir para o site"
          />
        ) : (
          <Pagamento info={info} segundos={segundos} onAtualizar={carregar} simularCartao={simularParam === 'cartao'} />
        )}
      </div>
    </PbShell>
  )
}

function Resumo({ info, titulo = 'Resumo' }: { info: CheckoutInfo; titulo?: string }) {
  const ag = info.agendamento
  const venda = info.venda
  return (
    <div className="pb-card">
      <div className="pb-card-title">{titulo}</div>
      {ag ? (
        <div className="pb-facts pb-facts-top">
          <div>
            <span className="pb-fact-label">Data</span>
            <span className="pb-fact-value">{dateLong(ag.data)}</span>
          </div>
          <div>
            <span className="pb-fact-label">Horário</span>
            <span className="pb-fact-value">{ag.hora}</span>
          </div>
          {ag.profissional ? (
            <div>
              <span className="pb-fact-label">Profissional</span>
              <span className="pb-fact-value">{ag.profissional}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="pb-summary">
        {ag?.servicos.map((s, i) => (
          <SummaryRow key={`s${i}`} label={s.nome}>
            {brl(s.preco)}
          </SummaryRow>
        ))}
        {ag?.produtos.map((p, i) => (
          <SummaryRow key={`p${i}`} label={`${p.quantidade}× ${p.nome}`}>
            {brl(p.precoUnit * p.quantidade)}
          </SummaryRow>
        ))}
        {venda?.itens.map((p, i) => (
          <SummaryRow key={`v${i}`} label={`${p.quantidade}× ${p.nome}`}>
            {brl(p.precoUnit * p.quantidade)}
          </SummaryRow>
        ))}
        {ag && ag.desconto > 0 ? <SummaryRow label="Desconto">− {brl(ag.desconto)}</SummaryRow> : null}
        <SummaryRow label="Total" strong>
          {brl(info.valor)}
        </SummaryRow>
      </div>
      {venda ? (
        <div className="pb-note pb-note-soft">
          📍 <strong>Retirada no local</strong> — não fazemos entrega.
          {info.estabelecimento.endereco ? ` ${info.estabelecimento.endereco}` : ''}
        </div>
      ) : null}
    </div>
  )
}

function Pagamento({ info, segundos, onAtualizar, simularCartao }: { info: CheckoutInfo; segundos: number | null; onAtualizar: () => Promise<void>; simularCartao: boolean }) {
  const [metodo, setMetodo] = useState<'PIX' | 'CARTAO' | ''>(info.pix ? 'PIX' : simularCartao ? 'CARTAO' : '')
  const [pix, setPix] = useState(info.pix)
  const [ocupado, setOcupado] = useState<'' | 'pix' | 'cartao' | 'simular'>('')
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)
  const urgente = segundos !== null && segundos <= 180

  useEffect(() => {
    if (info.pix && !pix) setPix(info.pix)
  }, [info.pix, pix])

  async function gerarPix() {
    setOcupado('pix')
    setErro('')
    try {
      const r = await post<{ copiaCola: string; qrCodeBase64: string | null }>(`/checkout/${info.id}/pix`, {}, { publico: true })
      setPix(r)
    } catch (e) {
      setErro(errorMessage(e, 'Não foi possível gerar o Pix.'))
      onAtualizar()
    } finally {
      setOcupado('')
    }
  }

  async function pagarCartao() {
    setOcupado('cartao')
    setErro('')
    try {
      const r = await post<{ url: string }>(`/checkout/${info.id}/cartao`, {}, { publico: true })
      window.location.href = r.url
    } catch (e) {
      setErro(errorMessage(e, 'Não foi possível abrir o pagamento com cartão.'))
      setOcupado('')
      onAtualizar()
    }
  }

  async function simular(forma: 'PIX' | 'CARTAO') {
    setOcupado('simular')
    setErro('')
    try {
      await post(`/checkout/${info.id}/simular`, { forma }, { publico: true })
      await onAtualizar()
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setOcupado('')
    }
  }

  async function copiar() {
    if (!pix?.copiaCola) return
    const ok = await copiarTexto(pix.copiaCola)
    setCopiado(ok)
    if (ok) setTimeout(() => setCopiado(false), 2500)
  }

  return (
    <div className="stack">
      <div className="pb-co-hero">
        <div className="pb-co-hello">{info.cliente?.nome ? `${primeiroNome(info.cliente.nome)}, falta pouco!` : 'Falta pouco!'}</div>
        <div className="pb-co-amount">{brl(info.valor)}</div>
        <div className="muted">{info.venda ? 'Pague para confirmar seu pedido.' : 'Pague para confirmar seu agendamento.'}</div>
      </div>

      {segundos !== null ? (
        <div className={`pb-timer ${urgente ? 'urgent' : ''}`} role="timer" aria-live="off">
          <span className="pb-timer-icon" aria-hidden>
            ⏳
          </span>
          <div className="pb-timer-text">
            <div className="pb-timer-label">{info.venda ? 'Seu pedido está reservado por' : 'Seu horário está reservado por'}</div>
            <div className="small muted">Depois disso, {info.venda ? 'o pedido é cancelado' : 'o horário é liberado'}.</div>
          </div>
          <div className="pb-timer-value">{countdown(segundos)}</div>
        </div>
      ) : null}

      <Resumo info={info} />

      <div className="pb-card">
        <div className="pb-card-title">Como você prefere pagar?</div>
        <div className="pb-options">
          <button type="button" className={`pb-option pb-option-center ${metodo === 'PIX' ? 'selected' : ''}`} onClick={() => setMetodo('PIX')} aria-pressed={metodo === 'PIX'}>
            <span className="pb-method-icon">◈</span>
            <span className="pb-option-main">
              <span className="pb-option-title">Pix</span>
              <span className="pb-option-desc">Aprovação na hora</span>
            </span>
            <span className="pb-check pb-radio">{metodo === 'PIX' ? '✓' : ''}</span>
          </button>
          <button type="button" className={`pb-option pb-option-center ${metodo === 'CARTAO' ? 'selected' : ''}`} onClick={() => setMetodo('CARTAO')} aria-pressed={metodo === 'CARTAO'}>
            <span className="pb-method-icon">▭</span>
            <span className="pb-option-main">
              <span className="pb-option-title">Cartão de crédito</span>
              <span className="pb-option-desc">Você será levado ao ambiente seguro de pagamento</span>
            </span>
            <span className="pb-check pb-radio">{metodo === 'CARTAO' ? '✓' : ''}</span>
          </button>
        </div>

        {metodo === 'PIX' ? (
          <div className="pb-pay-panel">
            {pix ? (
              <div className="stack">
                {pix.qrCodeBase64 ? (
                  <>
                    <img className="pb-qr" src={srcQrCode(pix.qrCodeBase64)} alt="QR code Pix" />
                    <p className="center small muted">Abra o app do seu banco, escolha pagar com Pix e aponte a câmera para o QR code.</p>
                  </>
                ) : (
                  <p className="small muted">Copie o código abaixo e cole no app do seu banco, na opção Pix Copia e Cola.</p>
                )}
                <div className="pb-copy-code" aria-label="Código Pix copia e cola">
                  {pix.copiaCola}
                </div>
                <button type="button" className="btn btn-primary btn-lg btn-block" onClick={copiar}>
                  {copiado ? '✓ Código copiado!' : 'Copiar código Pix'}
                </button>
                <div className="pb-waiting">
                  <span className="spinner" /> Aguardando a confirmação do pagamento...
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={gerarPix} disabled={ocupado !== ''}>
                {ocupado === 'pix' ? 'Gerando Pix...' : 'Gerar Pix'}
              </button>
            )}
          </div>
        ) : null}

        {metodo === 'CARTAO' ? (
          <div className="pb-pay-panel stack">
            {simularCartao && info.modoGateway === 'simulado' ? (
              <PbAlert tipo="info">Ambiente de testes: use o botão “Simular pagamento aprovado (Cartão)” abaixo.</PbAlert>
            ) : null}
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={pagarCartao} disabled={ocupado !== ''}>
              {ocupado === 'cartao' ? 'Abrindo...' : `Pagar ${brl(info.valor)} com cartão`}
            </button>
          </div>
        ) : null}

        <PbAlert tipo="erro">{erro}</PbAlert>
      </div>

      {info.modoGateway === 'simulado' ? (
        <DevNotice titulo="Modo de testes · gateway simulado">
          <p>Nenhuma cobrança real é feita. Use os botões para simular a aprovação:</p>
          <div className="pb-dev-actions">
            <button type="button" className="btn" disabled={ocupado !== ''} onClick={() => simular('PIX')}>
              Simular pagamento aprovado (Pix)
            </button>
            <button type="button" className="btn" disabled={ocupado !== ''} onClick={() => simular('CARTAO')}>
              Simular pagamento aprovado (Cartão)
            </button>
          </div>
        </DevNotice>
      ) : null}
    </div>
  )
}

function Confirmacao({ info }: { info: CheckoutInfo }) {
  const est = info.estabelecimento
  const nome = primeiroNome(info.cliente?.nome)
  return (
    <div className="stack">
      <div className="pb-card pb-confirm">
        <div className="pb-success-icon">✓</div>
        <h1 className="pb-confirm-title">{info.venda ? 'Compra confirmada!' : 'Agendamento confirmado!'}</h1>
        <p className="center muted">
          {nome ? `Obrigado, ${nome}! ` : 'Obrigado! '}
          Recebemos seu pagamento de <strong>{brl(info.valor)}</strong>.
        </p>
        <div className="pb-whats">
          <span aria-hidden>💬</span> Confirmação enviada pelo WhatsApp
        </div>
      </div>

      <Resumo info={info} titulo={info.venda ? 'Seu pedido' : 'Seu agendamento'} />

      {info.venda ? (
        <div className="pb-pickup-card">
          <div className="pb-pickup-title">📍 Retire seus produtos no local</div>
          <p>
            Não fazemos entrega. Seus produtos estarão à sua espera em <strong>{est.nome}</strong>
            {est.endereco ? (
              <>
                , <strong>{est.endereco}</strong>
              </>
            ) : null}
            .
          </p>
        </div>
      ) : est.endereco ? (
        <div className="pb-note pb-note-soft">
          📍 {est.endereco}.{' '}
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(est.endereco)}`} target="_blank" rel="noreferrer">
            Ver no mapa
          </a>
        </div>
      ) : null}

      <div className="pb-invite">
        <div className="pb-invite-title">Crie sua conta no Portal do cliente</div>
        <p>Acompanhe seus agendamentos, reagende ou cancele quando precisar e veja seu histórico — tudo em um só lugar.</p>
        <Link to={`/s/${est.slug}/portal?cadastro=1`} className="btn btn-primary btn-lg btn-block">
          Criar minha conta
        </Link>
      </div>

      <div className="center">
        <Link to={`/s/${est.slug}`} className="pb-link">
          Voltar para o site
        </Link>
      </div>
    </div>
  )
}

function Encerrado({ icone, titulo, texto, siteUrl, acao }: { icone: string; titulo: string; texto: string; siteUrl: string; acao: string }) {
  return (
    <div className="pb-card pb-confirm">
      <div className="pb-ended-icon">{icone}</div>
      <h1 className="pb-confirm-title">{titulo}</h1>
      <p className="center muted">{texto}</p>
      <Link to={siteUrl} className="btn btn-primary btn-lg btn-block">
        {acao}
      </Link>
    </div>
  )
}
