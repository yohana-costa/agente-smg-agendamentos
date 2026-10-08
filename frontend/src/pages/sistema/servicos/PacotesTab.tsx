import { useState } from 'react'
import { errorMessage, get, patch, post } from '../../../lib/api'
import { brl } from '../../../lib/format'
import { useAsync, useEventStream } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Field, Loading, Modal, MoneyInput, SuccessBanner, Toggle } from '../../../components/ui'
import type { Pacote, Servico } from '../../../types'

/**
 * Pacotes de sessões (ex.: 4 manicures por R$ 120). Aqui só o cadastro; a venda é feita na
 * ficha do cliente e cada agendamento coberto usa uma sessão.
 */
export default function PacotesTab() {
  const { data, loading, error, reload } = useAsync(
    async () => {
      const [pacotes, servicos] = await Promise.all([get<Pacote[]>('/pacotes'), get<Servico[]>('/servicos')])
      return { pacotes, servicos }
    },
    []
  )
  const [editando, setEditando] = useState<Pacote | 'novo' | null>(null)
  const [msg, setMsg] = useState('')
  const [erroAcao, setErroAcao] = useState('')
  useEventStream(['catalogo.atualizado'], () => reload())

  async function alternar(p: Pacote) {
    setErroAcao('')
    try {
      await patch(`/pacotes/${p.id}`, { ativo: !p.ativo })
      reload()
    } catch (e) {
      setErroAcao(errorMessage(e))
    }
  }

  if (loading && !data) return <Loading />
  return (
    <div className="stack">
      <ErrorBanner message={error || erroAcao} />
      <SuccessBanner message={msg} />
      <div className="row-between">
        <div className="small muted">Monte o pacote aqui e venda na ficha do cliente. Cada atendimento coberto usa uma sessão do saldo.</div>
        <button className="btn btn-primary" onClick={() => setEditando('novo')}>
          Novo pacote
        </button>
      </div>
      {!data?.pacotes.length ? (
        <Empty icon="🎁">Nenhum pacote cadastrado.</Empty>
      ) : (
        <div className="stack">
          {data.pacotes.map((p) => {
            const tabela = p.itens.reduce((acc, i) => acc + i.precoServico * i.quantidade, 0)
            return (
              <Card key={p.id}>
                <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="strong">
                      {p.nome} {!p.ativo ? <span className="badge badge-gray">Inativo</span> : null}
                    </div>
                    <div className="small muted">
                      {p.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(' + ')}
                      {p.validadeDias ? ` · validade ${p.validadeDias} dias` : ' · sem validade'}
                      {p.vendidos ? ` · ${p.vendidos} vendido(s)` : ''}
                    </div>
                  </div>
                  <div className="right">
                    <div className="strong">{brl(p.preco)}</div>
                    {tabela > p.preco ? <div className="small muted">avulso {brl(tabela)}</div> : null}
                  </div>
                </div>
                <div className="row" style={{ marginTop: 10, gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => setEditando(p)}>
                    Editar
                  </button>
                  <button className="btn btn-sm" onClick={() => alternar(p)}>
                    {p.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {editando && data ? (
        <PacoteModal
          pacote={editando === 'novo' ? null : editando}
          servicos={data.servicos}
          onClose={() => setEditando(null)}
          onSaved={(m) => {
            setEditando(null)
            setMsg(m)
            reload()
          }}
        />
      ) : null}
    </div>
  )
}

function PacoteModal({ pacote, servicos, onClose, onSaved }: { pacote: Pacote | null; servicos: Servico[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [nome, setNome] = useState(pacote?.nome || '')
  const [descricao, setDescricao] = useState(pacote?.descricao || '')
  const [preco, setPreco] = useState(pacote?.preco || 0)
  const [validade, setValidade] = useState(pacote?.validadeDias ? String(pacote.validadeDias) : '')
  const [ativo, setAtivo] = useState(pacote?.ativo ?? true)
  const [itens, setItens] = useState<Array<{ servicoId: string; quantidade: string }>>(
    pacote?.itens.length ? pacote.itens.map((i) => ({ servicoId: i.servicoId, quantidade: String(i.quantidade) })) : [{ servicoId: '', quantidade: '4' }]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const ativos = servicos.filter((s) => s.ativo || itens.some((i) => i.servicoId === s.id))
  const tabela = itens.reduce((acc, i) => acc + (servicos.find((s) => s.id === i.servicoId)?.preco || 0) * (Number(i.quantidade) || 0), 0)

  async function salvar() {
    setError('')
    const validos = itens.filter((i) => i.servicoId && Number(i.quantidade) > 0)
    if (!nome.trim()) return setError('Informe o nome do pacote.')
    if (!validos.length) return setError('Inclua pelo menos um serviço com a quantidade de sessões.')
    setSaving(true)
    try {
      const body = {
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        preco,
        validadeDias: validade.trim() ? Number(validade) : null,
        ativo,
        itens: validos.map((i) => ({ servicoId: i.servicoId, quantidade: Number(i.quantidade) })),
      }
      if (pacote) await patch(`/pacotes/${pacote.id}`, body)
      else await post('/pacotes', body)
      onSaved(pacote ? 'Pacote atualizado. Quem já comprou mantém o saldo da compra.' : 'Pacote criado. Venda pela ficha do cliente.')
    } catch (e) {
      setError(errorMessage(e))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={pacote ? 'Editar pacote' : 'Novo pacote'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? 'Salvando...' : pacote ? 'Salvar alterações' : 'Criar pacote'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Nome *">
            <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: 4 manicures" autoFocus />
          </Field>
          <Field label="Preço do pacote" hint={tabela ? `Avulso sairia ${brl(tabela)}.` : undefined}>
            <MoneyInput value={preco} onChange={setPreco} />
          </Field>
          <Field label="Validade" hint="Vazio = sem validade.">
            <div className="input-group">
              <input className="input" type="number" min={1} value={validade} onChange={(e) => setValidade(e.target.value)} placeholder="Sem validade" />
              <span className="addon">dias</span>
            </div>
          </Field>
          <Field label="Descrição" className="full">
            <textarea className="textarea" rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Opcional" />
          </Field>
        </div>

        <Field label="Serviços e sessões *">
          <div className="stack-sm">
            {itens.map((it, idx) => (
              <div key={idx} className="row" style={{ gap: 8 }}>
                <select
                  className="select"
                  style={{ flex: 1 }}
                  value={it.servicoId}
                  onChange={(e) => setItens(itens.map((x, i) => (i === idx ? { ...x, servicoId: e.target.value } : x)))}
                >
                  <option value="">Escolha o serviço</option>
                  {ativos.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome} ({brl(s.preco)})
                    </option>
                  ))}
                </select>
                <div className="input-group" style={{ width: 130 }}>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={it.quantidade}
                    onChange={(e) => setItens(itens.map((x, i) => (i === idx ? { ...x, quantidade: e.target.value } : x)))}
                  />
                  <span className="addon">sessões</span>
                </div>
                <button className="btn btn-sm" type="button" onClick={() => setItens(itens.filter((_, i) => i !== idx))} disabled={itens.length === 1}>
                  Remover
                </button>
              </div>
            ))}
            <div>
              <button className="btn btn-sm" type="button" onClick={() => setItens([...itens, { servicoId: '', quantidade: '1' }])}>
                + Adicionar serviço
              </button>
            </div>
          </div>
        </Field>

        <Toggle checked={ativo} onChange={setAtivo} label={ativo ? 'Ativo: pode ser vendido' : 'Inativo: não aparece para venda'} />
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}
