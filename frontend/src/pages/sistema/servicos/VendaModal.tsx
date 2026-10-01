import { useMemo, useState } from 'react'
import { errorMessage, post } from '../../../lib/api'
import { brl } from '../../../lib/format'
import { useEventStream } from '../../../lib/hooks'
import { ErrorBanner, Field, Modal, Segmented } from '../../../components/ui'
import type { Produto } from '../../../types'
import type { Venda, VendaPagamento } from './types'

type Forma = 'DINHEIRO' | 'MAQUININHA' | 'PIX'

export default function VendaModal({ produtos, onClose, onDone }: { produtos: Produto[]; onClose: () => void; onDone: (msg: string) => void }) {
  const disponiveis = useMemo(() => produtos.filter((p) => p.ativo), [produtos])
  const [carrinho, setCarrinho] = useState<Array<{ produtoId: string; quantidade: number }>>([])
  const [selecionado, setSelecionado] = useState('')
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [forma, setForma] = useState<Forma>('DINHEIRO')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pix, setPix] = useState<{ venda: Venda; pagamento: VendaPagamento } | null>(null)
  const [pixPago, setPixPago] = useState(false)
  const [copiado, setCopiado] = useState(false)

  useEventStream(['pagamento.aprovado'], (_tipo, payload) => {
    if (pix && payload?.vendaId === pix.venda.id) setPixPago(true)
  })

  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos])
  const total = carrinho.reduce((acc, i) => acc + (porId.get(i.produtoId)?.preco || 0) * i.quantidade, 0)

  function adicionar(id: string) {
    if (!id) return
    const p = porId.get(id)
    if (!p) return
    setCarrinho((c) => {
      const atual = c.find((i) => i.produtoId === id)
      if (atual) return c.map((i) => (i.produtoId === id ? { ...i, quantidade: Math.min(p.estoque, i.quantidade + 1) } : i))
      return [...c, { produtoId: id, quantidade: 1 }]
    })
    setSelecionado('')
  }

  function alterarQtd(id: string, delta: number) {
    const p = porId.get(id)
    setCarrinho((c) => c.map((i) => (i.produtoId === id ? { ...i, quantidade: Math.max(1, Math.min(p?.estoque || 1, i.quantidade + delta)) } : i)))
  }

  async function registrar() {
    setError('')
    if (!carrinho.length) return setError('Adicione pelo menos um produto.')
    if (telefone.trim() && telefone.replace(/\D/g, '').length < 10) return setError('Telefone do cliente inválido. Informe DDD + número.')
    setSaving(true)
    try {
      const body: Record<string, unknown> = { itens: carrinho, forma }
      if (telefone.trim()) body.cliente = { nome: nome.trim() || 'Cliente', telefone: telefone.trim() }
      const r = await post<{ venda: Venda; pagamento: VendaPagamento }>('/produtos/vendas', body)
      if (forma === 'PIX') {
        setPix(r)
        setSaving(false)
      } else {
        onDone(`Venda de ${brl(r.venda.valorTotal)} registrada (${forma === 'DINHEIRO' ? 'dinheiro' : 'maquininha'}). Estoque atualizado.`)
      }
    } catch (e) {
      setError(errorMessage(e))
      setSaving(false)
    }
  }

  if (pix) {
    return (
      <Modal
        title="Pagamento via Pix"
        onClose={() => onDone(pixPago ? 'Pix recebido. Venda confirmada e estoque atualizado.' : 'Venda registrada. Aguardando confirmação do Pix.')}
        footer={
          <button className="btn btn-primary" onClick={() => onDone(pixPago ? 'Pix recebido. Venda confirmada e estoque atualizado.' : 'Venda registrada. Aguardando confirmação do Pix.')}>
            Concluir
          </button>
        }
      >
        <div className="sv-pix">
          <div className="stat-value">{brl(pix.venda.valorTotal)}</div>
          {pixPago ? (
            <div className="banner success-banner">Pagamento confirmado! A venda foi concluída e o estoque baixado.</div>
          ) : (
            <div className="row muted small">
              <span className="spinner" /> Peça para o cliente escanear o QR code. A confirmação aparece aqui automaticamente.
            </div>
          )}
          {pix.pagamento.pixQrCode ? <img src={`data:image/png;base64,${pix.pagamento.pixQrCode}`} alt="QR code Pix" /> : null}
          {pix.pagamento.pixCopiaCola ? (
            <Field label="Pix copia e cola" className="full">
              <textarea className="textarea" readOnly value={pix.pagamento.pixCopiaCola} onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginTop: 6 }}
                onClick={() => {
                  navigator.clipboard?.writeText(pix.pagamento.pixCopiaCola || '').then(() => setCopiado(true), () => setCopiado(false))
                }}
              >
                {copiado ? 'Copiado ✓' : 'Copiar código'}
              </button>
            </Field>
          ) : null}
          {!pix.pagamento.pixQrCode && !pix.pagamento.pixCopiaCola ? <div className="banner warning-banner">Não foi possível gerar o QR code. Tente novamente pela lista de vendas.</div> : null}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Registrar venda no balcão"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={registrar} disabled={saving || !carrinho.length}>
            {saving ? 'Registrando...' : forma === 'PIX' ? `Gerar Pix de ${brl(total)}` : `Registrar venda de ${brl(total)}`}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Adicionar produto">
          <select className="select" value={selecionado} onChange={(e) => adicionar(e.target.value)}>
            <option value="">Selecione um produto...</option>
            {disponiveis.map((p) => {
              const noCarrinho = carrinho.find((i) => i.produtoId === p.id)?.quantidade || 0
              const esgotado = p.estoque - noCarrinho <= 0
              return (
                <option key={p.id} value={p.id} disabled={esgotado}>
                  {p.nome} · {brl(p.preco)} · {p.estoque} em estoque{esgotado ? ' (indisponível)' : ''}
                </option>
              )
            })}
          </select>
        </Field>

        {carrinho.length ? (
          <div className="sv-cart">
            {carrinho.map((i) => {
              const p = porId.get(i.produtoId)
              if (!p) return null
              return (
                <div className="sv-cart-row" key={i.produtoId}>
                  <div>
                    <div className="strong">{p.nome}</div>
                    <div className="small muted">
                      {brl(p.preco)} / un. · {p.estoque} em estoque
                    </div>
                  </div>
                  <div className="sv-qty">
                    <button type="button" onClick={() => alterarQtd(i.produtoId, -1)} disabled={i.quantidade <= 1}>
                      −
                    </button>
                    <span>{i.quantidade}</span>
                    <button type="button" onClick={() => alterarQtd(i.produtoId, 1)} disabled={i.quantidade >= p.estoque}>
                      +
                    </button>
                  </div>
                  <div className="right strong sv-cart-sub">{brl(p.preco * i.quantidade)}</div>
                  <button type="button" className="icon-btn" aria-label="Remover" onClick={() => setCarrinho((c) => c.filter((x) => x.produtoId !== i.produtoId))}>
                    ×
                  </button>
                </div>
              )
            })}
            <div className="sv-cart-total">
              <span>Total</span>
              <span>{brl(total)}</span>
            </div>
          </div>
        ) : (
          <div className="sv-preview muted">Nenhum produto no carrinho.</div>
        )}

        <div className="section-title" style={{ margin: '4px 0 0' }}>
          Cliente (opcional)
        </div>
        <div className="form-grid">
          <Field label="Telefone" hint="O cliente é identificado pelo telefone.">
            <input className="input" inputMode="tel" placeholder="(11) 99999-9999" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          </Field>
          <Field label="Nome">
            <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" />
          </Field>
        </div>

        <Field label="Forma de pagamento">
          <Segmented<Forma>
            value={forma}
            onChange={setForma}
            options={[
              { key: 'DINHEIRO', label: 'Dinheiro' },
              { key: 'MAQUININHA', label: 'Maquininha' },
              { key: 'PIX', label: 'Pix (QR code)' },
            ]}
          />
        </Field>
        {forma === 'PIX' ? <div className="small muted">O QR code é gerado pelo sistema. A venda é confirmada e o estoque baixado quando o Pix for pago.</div> : null}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}
