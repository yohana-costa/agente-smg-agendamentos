import { useState } from 'react'
import { errorMessage, get, patch, post } from '../../../lib/api'
import { brl } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Field, Modal, Segmented, Toggle } from '../../../components/ui'
import type { Servico } from '../../../types'
import { pts, type Recompensa } from './types'

type Form = { id?: string; nome: string; tipo: Recompensa['tipo']; servicoId: string; descontoPct: string; pontosCusto: string; ativo: boolean }

const vazio: Form = { nome: '', tipo: 'SERVICO_GRATIS', servicoId: '', descontoPct: '20', pontosCusto: '100', ativo: true }

export function Recompensas({ recompensas, onChange }: { recompensas: Recompensa[]; onChange: () => void }) {
  const servicos = useAsync(() => get<Servico[]>('/servicos'), [])
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [alternando, setAlternando] = useState<string | null>(null)
  const [erroLista, setErroLista] = useState('')

  const servicoNome = (id: string | null) => servicos.data?.find((s) => s.id === id)?.nome
  const servicoPreco = (id: string | null) => servicos.data?.find((s) => s.id === id)?.preco

  function editar(r: Recompensa) {
    setErro('')
    setForm({ id: r.id, nome: r.nome, tipo: r.tipo, servicoId: r.servicoId || '', descontoPct: String(r.descontoPct || 20), pontosCusto: String(r.pontosCusto), ativo: r.ativo })
  }

  async function salvar() {
    if (!form) return
    if (!form.nome.trim()) return setErro('Informe o nome da recompensa.')
    if (!form.servicoId) return setErro('Escolha o serviço da recompensa.')
    if (!(Number(form.pontosCusto) >= 1)) return setErro('Informe quantos pontos a recompensa custa.')
    if (form.tipo === 'SERVICO_DESCONTO' && !(Number(form.descontoPct) >= 1 && Number(form.descontoPct) <= 100)) return setErro('O desconto deve ser entre 1% e 100%.')
    setSalvando(true)
    setErro('')
    const body = {
      nome: form.nome.trim(),
      tipo: form.tipo,
      servicoId: form.servicoId,
      descontoPct: form.tipo === 'SERVICO_DESCONTO' ? Number(form.descontoPct) : 0,
      pontosCusto: Number(form.pontosCusto),
      ativo: form.ativo,
    }
    try {
      if (form.id) await patch(`/fidelidade/recompensas/${form.id}`, body)
      else await post('/fidelidade/recompensas', body)
      setForm(null)
      onChange()
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  async function alternar(r: Recompensa, ativo: boolean) {
    setAlternando(r.id)
    setErroLista('')
    try {
      await patch(`/fidelidade/recompensas/${r.id}`, { ativo })
      onChange()
    } catch (e) {
      setErroLista(errorMessage(e))
    } finally {
      setAlternando(null)
    }
  }

  const servicosOpcoes = (servicos.data || []).filter((s) => s.ativo || s.id === form?.servicoId)

  return (
    <Card
      title="Recompensas"
      subtitle="O que o cliente pode trocar pelos pontos. Ele vê as recompensas e o saldo no Portal do cliente."
      actions={
        <button className="btn btn-primary btn-sm" onClick={() => (setErro(''), setForm({ ...vazio }))}>
          + Nova recompensa
        </button>
      }
    >
      <ErrorBanner message={erroLista} />
      {recompensas.length === 0 ? (
        <Empty icon="★">Nenhuma recompensa cadastrada. Crie a primeira, por exemplo “Serviço grátis com 500 pontos”.</Empty>
      ) : (
        <div className="fd-grid" style={{ marginTop: erroLista ? 10 : 0 }}>
          {recompensas.map((r) => (
            <div key={r.id} className={`fd-reward ${r.ativo ? '' : 'inativo'}`}>
              <div className="row-between">
                <span className={`badge ${r.tipo === 'SERVICO_GRATIS' ? 'badge-success' : 'badge-info'}`}>{r.tipo === 'SERVICO_GRATIS' ? 'Serviço grátis' : `${r.descontoPct}% de desconto`}</span>
                {!r.ativo ? <span className="badge badge-gray">Inativa</span> : null}
              </div>
              <div className="fd-reward-name">{r.nome}</div>
              <div className="small muted">
                {r.servico?.nome || servicoNome(r.servicoId) || 'Serviço não definido'}
                {servicoPreco(r.servicoId) ? ` · ${brl(servicoPreco(r.servicoId))}` : ''}
              </div>
              <div className="fd-reward-cost">{pts(r.pontosCusto)}</div>
              <div className="fd-reward-foot">
                <Toggle checked={r.ativo} disabled={alternando === r.id} onChange={(v) => alternar(r, v)} label={<span className="small">{r.ativo ? 'Ativa' : 'Inativa'}</span>} />
                <button className="btn btn-sm" onClick={() => editar(r)}>
                  Editar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form ? (
        <Modal
          title={form.id ? 'Editar recompensa' : 'Nova recompensa'}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)} disabled={salvando}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Nome da recompensa">
              <input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Serviço grátis de aniversário" />
            </Field>
            <Field label="Tipo">
              <Segmented
                options={[
                  { key: 'SERVICO_GRATIS', label: 'Serviço grátis' },
                  { key: 'SERVICO_DESCONTO', label: 'Serviço com desconto %' },
                ]}
                value={form.tipo}
                onChange={(tipo) => setForm({ ...form, tipo })}
              />
            </Field>
            <Field label="Serviço" hint={servicos.error ? `Não foi possível carregar os serviços: ${servicos.error}` : undefined}>
              <select className="select" value={form.servicoId} onChange={(e) => setForm({ ...form, servicoId: e.target.value })} disabled={servicos.loading}>
                <option value="">{servicos.loading ? 'Carregando...' : 'Selecione o serviço'}</option>
                {servicosOpcoes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome} · {brl(s.preco)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              {form.tipo === 'SERVICO_DESCONTO' ? (
                <Field label="Desconto">
                  <div className="input-group">
                    <input className="input" type="number" min={1} max={100} value={form.descontoPct} onChange={(e) => setForm({ ...form, descontoPct: e.target.value })} />
                    <span className="addon">%</span>
                  </div>
                </Field>
              ) : null}
              <Field label="Custo em pontos">
                <div className="input-group">
                  <input className="input" type="number" min={1} value={form.pontosCusto} onChange={(e) => setForm({ ...form, pontosCusto: e.target.value })} />
                  <span className="addon">pts</span>
                </div>
              </Field>
            </div>
            <Toggle checked={form.ativo} onChange={(ativo) => setForm({ ...form, ativo })} label="Recompensa ativa (visível no Portal do cliente)" />
            <ErrorBanner message={erro} />
          </div>
        </Modal>
      ) : null}
    </Card>
  )
}
