import { useState } from 'react'
import { errorMessage, post } from '../../../lib/api'
import { brl } from '../../../lib/format'
import { navigate, useQueryParam } from '../../../lib/router'
import { PbAlert, PhoneField, QtyStepper, SummaryRow } from '../shared/components'
import type { ReservaResposta, SitePublico } from '../shared/types'
import { caminhoCheckout, digitosTelefone, mascaraTelefone, plural, telefoneValido } from '../shared/utils'

/** Aba Produtos: catalogo, carrinho e compra com retirada no local. */
export default function Loja({ slug, site }: { slug: string; site: SitePublico }) {
  const nomeQ = useQueryParam('nome')
  const telefoneQ = useQueryParam('telefone')
  const [carrinho, setCarrinho] = useState<Record<string, number>>({})
  const [fase, setFase] = useState<'catalogo' | 'finalizar'>('catalogo')
  const [nome, setNome] = useState(nomeQ || '')
  const [telefone, setTelefone] = useState(mascaraTelefone(telefoneQ || ''))
  const [cienteRetirada, setCienteRetirada] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const itens = site.produtos.filter((p) => (carrinho[p.id] || 0) > 0).map((p) => ({ produto: p, quantidade: carrinho[p.id] }))
  const total = itens.reduce((acc, i) => acc + i.produto.preco * i.quantidade, 0)
  const qtdTotal = itens.reduce((acc, i) => acc + i.quantidade, 0)
  const dadosOk = nome.trim().length >= 2 && telefoneValido(telefone) && cienteRetirada

  function setQtd(id: string, v: number) {
    setCarrinho((c) => ({ ...c, [id]: v }))
  }

  async function comprar() {
    if (!dadosOk || !itens.length) return
    setEnviando(true)
    setErro('')
    try {
      const r = await post<ReservaResposta>(
        `/publico/${slug}/pedidos`,
        {
          itens: itens.map((i) => ({ produtoId: i.produto.id, quantidade: i.quantidade })),
          cliente: { nome: nome.trim(), telefone: digitosTelefone(telefone) },
        },
        { publico: true }
      )
      const caminho = caminhoCheckout(r.linkPagamento, r.pagamentoId)
      if (caminho) navigate(caminho)
      else setErro('Pedido criado, mas não encontramos o link de pagamento. Fale com o estabelecimento.')
    } catch (e) {
      setErro(errorMessage(e, 'Não foi possível finalizar a compra. Tente novamente.'))
    } finally {
      setEnviando(false)
    }
  }

  if (!site.produtos.length) {
    return (
      <div className="pb-card pb-empty">
        <div className="pb-empty-icon">🛍</div>
        Nenhum produto disponível no momento.
      </div>
    )
  }

  return (
    <>
      <div className="pb-wizard">
        <div className="pb-pickup-banner">
          <span aria-hidden>📍</span>
          <span>
            <strong>Retirada no local — não fazemos entrega.</strong>
            {site.estabelecimento.endereco ? ` ${site.estabelecimento.endereco}` : ''}
          </span>
        </div>

        {fase === 'catalogo' ? (
          <div className="pb-products">
            {site.produtos.map((p) => {
              const qtd = carrinho[p.id] || 0
              return (
                <div key={p.id} className={`pb-product ${!p.disponivel ? 'is-out' : ''} ${qtd ? 'selected' : ''}`}>
                  <div className="pb-product-main">
                    <div className="pb-option-title">{p.nome}</div>
                    {p.descricao ? <div className="pb-option-desc">{p.descricao}</div> : null}
                  </div>
                  <div className="pb-product-foot">
                    <span className="pb-price">{brl(p.preco)}</span>
                    {!p.disponivel ? (
                      <span className="pb-pill">Esgotado</span>
                    ) : qtd ? (
                      <QtyStepper label={p.nome} value={qtd} max={Math.min(99, p.estoque)} onChange={(v) => setQtd(p.id, v)} />
                    ) : (
                      <button type="button" className="btn pb-add-btn" onClick={() => setQtd(p.id, 1)}>
                        + Adicionar
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="stack">
            <div className="pb-step-head">
              <button type="button" className="pb-back" onClick={() => setFase('catalogo')} disabled={enviando} aria-label="Voltar">
                ‹
              </button>
              <h2 className="pb-step-title">Finalizar compra</h2>
            </div>
            <div className="pb-card">
              <div className="pb-card-title">Seu pedido</div>
              <div className="pb-summary">
                {itens.map((i) => (
                  <SummaryRow key={i.produto.id} label={`${i.quantidade}× ${i.produto.nome}`}>
                    {brl(i.produto.preco * i.quantidade)}
                  </SummaryRow>
                ))}
                <SummaryRow label="Total" strong>
                  {brl(total)}
                </SummaryRow>
              </div>
            </div>

            <div className="pb-pickup-card">
              <div className="pb-pickup-title">📍 Retirada no local</div>
              <p>
                Não fazemos entrega. Depois do pagamento, é só retirar seus produtos em <strong>{site.estabelecimento.nome}</strong>
                {site.estabelecimento.endereco ? (
                  <>
                    , <strong>{site.estabelecimento.endereco}</strong>
                  </>
                ) : null}
                .
              </p>
              <label className="pb-checkline">
                <input type="checkbox" checked={cienteRetirada} onChange={(e) => setCienteRetirada(e.target.checked)} />
                <span>Entendi que vou retirar os produtos no local.</span>
              </label>
            </div>

            <form
              className="pb-card stack"
              onSubmit={(e) => {
                e.preventDefault()
                comprar()
              }}
            >
              <div className="field">
                <label htmlFor="pb-loja-nome">Nome</label>
                <input id="pb-loja-nome" className="input" autoComplete="name" placeholder="Seu nome completo" value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div className="field">
                <label>Telefone (WhatsApp)</label>
                <PhoneField value={telefone} onChange={setTelefone} />
              </div>
              <div className="pb-note">
                <span aria-hidden>📱</span>
                <span>A confirmação da compra chega pelo WhatsApp neste número.</span>
              </div>
              <button type="submit" hidden />
            </form>
            <PbAlert tipo="erro">{erro}</PbAlert>
          </div>
        )}
      </div>

      <div className="pb-bottombar">
        <div className="pb-bottombar-inner">
          <div className="pb-bottombar-info">
            {itens.length ? (
              <>
                <div className="pb-total-label">{plural(qtdTotal, 'item', 'itens')} no carrinho</div>
                <div className="pb-total">{brl(total)}</div>
              </>
            ) : (
              <div className="pb-total-label">Seu carrinho está vazio</div>
            )}
          </div>
          {fase === 'catalogo' ? (
            <button
              type="button"
              className="btn btn-primary btn-lg pb-cta"
              disabled={!itens.length}
              onClick={() => {
                setFase('finalizar')
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              Finalizar compra
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg pb-cta" disabled={!dadosOk || !itens.length || enviando} onClick={comprar}>
              {enviando ? 'Aguarde...' : 'Ir para o pagamento'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
