import { useState, type FormEvent } from 'react'
import { errorMessage, patch, post } from '../../../lib/api'
import { brl } from '../../../lib/format'
import { ErrorBanner, Field, Modal, MoneyInput, Toggle } from '../../../components/ui'
import type { ProfissionalRef, Produto, Servico } from '../../../types'

interface Props {
  servico: Servico | null
  categorias: string[]
  profissionais: ProfissionalRef[]
  produtos: Produto[]
  venderProdutos: boolean
  onClose: () => void
  onSaved: (msg: string) => void
}

export default function ServicoModal({ servico, categorias, profissionais, produtos, venderProdutos, onClose, onSaved }: Props) {
  const [nome, setNome] = useState(servico?.nome || '')
  const [categoria, setCategoria] = useState(servico?.categoria || '')
  const [descricao, setDescricao] = useState(servico?.descricao || '')
  const [preco, setPreco] = useState(servico?.preco || 0)
  const [duracaoMin, setDuracaoMin] = useState(String(servico?.duracaoMin ?? 30))
  const [intervaloMin, setIntervaloMin] = useState(String(servico?.intervaloMin ?? 0))
  const [retornoDias, setRetornoDias] = useState(servico?.retornoDias ? String(servico.retornoDias) : '')
  const [comissao, setComissao] = useState(servico?.comissaoPct != null ? String(servico.comissaoPct) : '')
  const [profissionalIds, setProfissionalIds] = useState<string[]>(servico?.profissionalIds || (profissionais.length === 1 ? [profissionais[0].id] : []))
  const [produtoIds, setProdutoIds] = useState<string[]>(servico?.produtoIds || [])
  const [ativo, setAtivo] = useState(servico?.ativo ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggleId = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const produtosVisiveis = produtos.filter((p) => p.ativo || produtoIds.includes(p.id))
  const ocupa = (Number(duracaoMin) || 0) + (Number(intervaloMin) || 0)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    setError('')
    if (!nome.trim()) return setError('Informe o nome do serviço.')
    if ((Number(duracaoMin) || 0) < 5) return setError('Informe a duração média (mínimo 5 minutos).')
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        nome: nome.trim(),
        categoria: categoria.trim() || null,
        descricao: descricao.trim() || null,
        preco,
        duracaoMin: Number(duracaoMin) || 0,
        intervaloMin: Number(intervaloMin) || 0,
        retornoDias: retornoDias.trim() ? Number(retornoDias) : null,
        comissaoPct: comissao.trim() ? Math.min(100, Math.max(0, Number(comissao) || 0)) : null,
        profissionalIds,
        ativo,
      }
      if (venderProdutos) body.produtoIds = produtoIds
      if (servico) await patch(`/servicos/${servico.id}`, body)
      else await post('/servicos', body)
      onSaved(servico ? 'Serviço atualizado. O site já reflete a alteração.' : 'Serviço criado. Ele já aparece no site.')
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={servico ? 'Editar serviço' : 'Novo serviço'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => submit()} disabled={saving}>
            {saving ? 'Salvando...' : servico ? 'Salvar alterações' : 'Criar serviço'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Nome *">
            <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus placeholder="Ex.: Corte, Limpeza de pele, Consulta" />
          </Field>
          <Field label="Categoria" hint="Escolha uma existente ou digite uma nova.">
            <input className="input" list="sv-categorias" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Sem categoria" />
            <datalist id="sv-categorias">
              {categorias.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Descrição" hint="Aparece no site para o cliente." className="full">
            <textarea className="textarea" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descreva o serviço em poucas palavras" />
          </Field>
          <Field label="Preço">
            <MoneyInput value={preco} onChange={setPreco} />
          </Field>
          <Field label="Retorno recomendado" hint="Opcional. Usado para sugerir o próximo retorno e nos segmentos de clientes.">
            <div className="input-group">
              <input className="input" type="number" min={1} value={retornoDias} onChange={(e) => setRetornoDias(e.target.value)} placeholder="Sem retorno" />
              <span className="addon">dias</span>
            </div>
          </Field>
          <Field label="Comissão do serviço" hint="Vazio = usa a comissão de cada profissional.">
            <div className="input-group">
              <input className="input" type="number" min={0} max={100} value={comissao} onChange={(e) => setComissao(e.target.value)} placeholder="Do profissional" />
              <span className="addon">%</span>
            </div>
          </Field>
          <Field label="Duração média *" hint="Usada na agenda desde o primeiro dia.">
            <div className="input-group">
              <input className="input" type="number" min={5} step={5} value={duracaoMin} onChange={(e) => setDuracaoMin(e.target.value)} />
              <span className="addon">min</span>
            </div>
          </Field>
          <Field label="Intervalo após o serviço" hint="Preparo, limpeza ou deslocamento.">
            <div className="input-group">
              <input className="input" type="number" min={0} step={5} value={intervaloMin} onChange={(e) => setIntervaloMin(e.target.value)} />
              <span className="addon">min</span>
            </div>
          </Field>
          <div className="full small muted">
            Na agenda, este serviço ocupa <strong>{ocupa} min</strong> ({Number(duracaoMin) || 0} de atendimento + {Number(intervaloMin) || 0} de intervalo).
          </div>
          {servico?.duracaoRealMedia ? (
            <div className="full banner info-banner">
              Duração real média registrada: {servico.duracaoRealMedia} min em {servico.amostrasDuracaoReal} atendimento(s). Use “Atualizar” na listagem para adotá-la.
            </div>
          ) : null}
        </div>

        <Field label={`Profissionais habilitados (${profissionalIds.length})`}>
          {profissionais.length ? (
            <div className="sv-checks">
              {profissionais.map((p) => (
                <label className="checkbox" key={p.id}>
                  <input type="checkbox" checked={profissionalIds.includes(p.id)} onChange={() => setProfissionalIds((l) => toggleId(l, p.id))} />
                  <span className="dot" style={{ background: p.cor }} />
                  {p.nome}
                </label>
              ))}
            </div>
          ) : (
            <div className="small muted">Nenhum profissional ativo encontrado. Cadastre a equipe na aba Equipe.</div>
          )}
        </Field>

        {venderProdutos ? (
          <Field label="Produtos relacionados (order bump)" hint="Sugeridos junto com este serviço no agendamento.">
            {produtosVisiveis.length ? (
              <div className="sv-checks">
                {produtosVisiveis.map((p) => (
                  <label className="checkbox" key={p.id}>
                    <input type="checkbox" checked={produtoIds.includes(p.id)} onChange={() => setProdutoIds((l) => toggleId(l, p.id))} />
                    <span>
                      {p.nome} <span className="muted small">{brl(p.preco)}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="small muted">Nenhum produto ativo cadastrado.</div>
            )}
          </Field>
        ) : null}

        <Toggle checked={ativo} onChange={setAtivo} label={ativo ? 'Ativo: aparece no site e para o agente' : 'Inativo: não aparece no site nem para o agente'} />
        <ErrorBanner message={error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
