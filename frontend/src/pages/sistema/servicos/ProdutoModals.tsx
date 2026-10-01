import { useState, type FormEvent } from 'react'
import { errorMessage, patch, post } from '../../../lib/api'
import { brl, pct } from '../../../lib/format'
import { ErrorBanner, Field, Modal, MoneyInput, Segmented, Toggle } from '../../../components/ui'
import type { Produto } from '../../../types'
import { margem } from './types'

export function ProdutoModal({ produto, onClose, onSaved }: { produto: Produto | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [nome, setNome] = useState(produto?.nome || '')
  const [descricao, setDescricao] = useState(produto?.descricao || '')
  const [estoque, setEstoque] = useState(String(produto?.estoque ?? 0))
  const [custo, setCusto] = useState(produto?.custo || 0)
  const [preco, setPreco] = useState(produto?.preco || 0)
  const [estoqueMinimo, setEstoqueMinimo] = useState(String(produto?.estoqueMinimo ?? 0))
  const [ativo, setAtivo] = useState(produto?.ativo ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    setError('')
    if (!nome.trim()) return setError('Informe o nome do produto.')
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        custo,
        preco,
        estoqueMinimo: Math.max(0, Number(estoqueMinimo) || 0),
        ativo,
      }
      if (!produto) body.estoque = Math.max(0, Number(estoque) || 0)
      if (produto) await patch(`/produtos/${produto.id}`, body)
      else await post('/produtos', body)
      onSaved(produto ? 'Produto atualizado.' : 'Produto cadastrado.')
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const m = margem(preco, custo)
  return (
    <Modal
      title={produto ? 'Editar produto' : 'Novo produto'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => submit()} disabled={saving}>
            {saving ? 'Salvando...' : produto ? 'Salvar alterações' : 'Cadastrar produto'}
          </button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="Nome *" className="full">
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </Field>
        <Field label="Descrição" className="full">
          <textarea className="textarea" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </Field>
        <Field label="Custo">
          <MoneyInput value={custo} onChange={setCusto} />
        </Field>
        <Field label="Preço de venda">
          <MoneyInput value={preco} onChange={setPreco} />
        </Field>
        <div className="full sv-preview">
          Margem: <strong className={m < 0 ? 'danger-text' : ''}>{pct(m)}</strong> · lucro de <strong>{brl(preco - custo)}</strong> por unidade
        </div>
        {produto ? (
          <Field label="Quantidade em estoque" hint="Para alterar, use “Ajustar estoque”.">
            <input className="input" value={produto.estoque} disabled />
          </Field>
        ) : (
          <Field label="Quantidade em estoque">
            <input className="input" type="number" min={0} value={estoque} onChange={(e) => setEstoque(e.target.value)} />
          </Field>
        )}
        <Field label="Quantidade mínima" hint="Abaixo disso, alerta de estoque baixo.">
          <input className="input" type="number" min={0} value={estoqueMinimo} onChange={(e) => setEstoqueMinimo(e.target.value)} />
        </Field>
        <div className="full">
          <Toggle checked={ativo} onChange={setAtivo} label={ativo ? 'Ativo' : 'Inativo: não aparece no site nem nas vendas'} />
        </div>
        <div className="full">
          <ErrorBanner message={error} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

type TipoAjuste = 'ENTRADA' | 'CORRECAO'

export function AjusteEstoqueModal({ produto, onClose, onSaved }: { produto: Produto; onClose: () => void; onSaved: (msg: string) => void }) {
  const [tipo, setTipo] = useState<TipoAjuste>('ENTRADA')
  const [quantidade, setQuantidade] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const q = Math.floor(Number(quantidade) || 0)
  const novo = tipo === 'ENTRADA' ? produto.estoque + q : Math.max(0, q)
  const valido = quantidade.trim() !== '' && (tipo === 'ENTRADA' ? q > 0 : q >= 0)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!valido) return setError(tipo === 'ENTRADA' ? 'Informe a quantidade recebida.' : 'Informe a quantidade correta em estoque.')
    setSaving(true)
    setError('')
    try {
      await post(`/produtos/${produto.id}/ajuste`, { tipo, quantidade: q })
      onSaved(`Estoque de “${produto.nome}” atualizado para ${novo} un.`)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Ajustar estoque · ${produto.nome}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => submit()} disabled={saving || !valido}>
            {saving ? 'Salvando...' : 'Confirmar ajuste'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Segmented<TipoAjuste>
          value={tipo}
          onChange={(t) => {
            setTipo(t)
            setQuantidade('')
          }}
          options={[
            { key: 'ENTRADA', label: 'Entrada de mercadoria' },
            { key: 'CORRECAO', label: 'Correção' },
          ]}
        />
        <Field
          label={tipo === 'ENTRADA' ? 'Quantidade recebida' : 'Quantidade correta em estoque'}
          hint={tipo === 'ENTRADA' ? 'Será somada ao estoque atual.' : 'Substitui o estoque atual (contagem física).'}
        >
          <div className="input-group">
            <input className="input" type="number" min={tipo === 'ENTRADA' ? 1 : 0} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} autoFocus />
            <span className="addon">un.</span>
          </div>
        </Field>
        <div className="sv-preview">
          Estoque atual: <strong>{produto.estoque} un.</strong>
          {valido ? (
            <>
              {' '}
              → novo estoque: <strong>{novo} un.</strong>
              {novo <= produto.estoqueMinimo ? <span className="badge badge-warning" style={{ marginLeft: 8 }}>Abaixo do mínimo ({produto.estoqueMinimo})</span> : null}
            </>
          ) : null}
        </div>
        <ErrorBanner message={error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
