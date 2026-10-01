import { useMemo, useState, type FormEvent } from 'react'
import { Receipt, Tag } from 'lucide-react'
import { del, errorMessage, get, post } from '../../../lib/api'
import { brl, dateBr, todayStr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { BarList, Card, ConfirmModal, Empty, ErrorBanner, Field, Loading, Modal, MoneyInput, Stat, SuccessBanner, type Periodo } from '../../../components/ui'
import type { Despesa } from './types'

export default function Despesas({ periodo }: { periodo: Periodo }) {
  const { data, loading, error, reload } = useAsync(
    () => get<{ despesas: Despesa[]; categorias: string[] }>('/financeiro/despesas', { de: periodo.de, ate: periodo.ate }),
    [periodo.de, periodo.ate]
  )
  const [novo, setNovo] = useState(false)
  const [excluir, setExcluir] = useState<Despesa | null>(null)
  const [categoria, setCategoria] = useState('')
  const [msg, setMsg] = useState('')

  const todas = data?.despesas || []
  const lista = categoria ? todas.filter((d) => d.categoria === categoria) : todas
  const total = todas.reduce((a, d) => a + d.valor, 0)
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of todas) m.set(d.categoria, (m.get(d.categoria) || 0) + d.valor)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [todas])

  function feedback(m: string) {
    setMsg(m)
    window.setTimeout(() => setMsg((a) => (a === m ? '' : a)), 4000)
  }

  return (
    <div className="stack">
      <SuccessBanner message={msg} />
      <div className="grid-2">
        <div className="stats-grid" style={{ alignContent: 'start' }}>
          <Stat icon={Receipt} grad="rose" label="Total de despesas" value={<span className="fi-neg">{brl(total)}</span>} hint={`${todas.length} lançamento(s)`} />
          <Stat icon={Tag} grad="violet" label="Maior categoria" value={porCategoria[0] ? porCategoria[0][0] : '—'} hint={porCategoria[0] ? brl(porCategoria[0][1]) : undefined} />
        </div>
        <Card title="Por categoria">
          <BarList items={porCategoria.map(([k, v]) => ({ key: k, label: k, value: v }))} format={(v) => brl(v)} />
        </Card>
      </div>

      <Card
        title="Despesas"
        actions={
          <>
            {porCategoria.length > 1 ? (
              <select className="select input-sm" style={{ width: 180 }} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">Todas as categorias</option>
                {porCategoria.map(([k]) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            ) : null}
            <button className="btn btn-primary" onClick={() => setNovo(true)}>
              + Nova despesa
            </button>
          </>
        }
      >
        <ErrorBanner message={error} />
        {loading && !data ? (
          <Loading />
        ) : !lista.length ? (
          <Empty icon="🧾">Nenhuma despesa no período.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Categoria</th>
                  <th>Descrição</th>
                  <th className="right">Valor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.map((d) => (
                  <tr key={d.id}>
                    <td className="nowrap">{dateBr(d.data)}</td>
                    <td>
                      <span className="badge badge-gray">{d.categoria}</span>
                    </td>
                    <td>{d.descricao || <span className="muted">—</span>}</td>
                    <td className="right strong nowrap">{brl(d.valor)}</td>
                    <td className="right">
                      <button className="btn btn-sm btn-ghost danger-text" onClick={() => setExcluir(d)}>
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total{categoria ? ` (${categoria})` : ''}</td>
                  <td className="right nowrap">{brl(lista.reduce((a, d) => a + d.valor, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {novo ? (
        <NovaDespesaModal
          categorias={data?.categorias || []}
          onClose={() => setNovo(false)}
          onSaved={() => {
            setNovo(false)
            feedback('Despesa registrada.')
            reload()
          }}
        />
      ) : null}
      {excluir ? (
        <ConfirmModal
          title="Excluir despesa"
          danger
          confirmLabel="Excluir"
          onClose={() => setExcluir(null)}
          onConfirm={async () => {
            await del(`/financeiro/despesas/${excluir.id}`)
            feedback('Despesa excluída.')
            reload()
          }}
        >
          <p>
            Excluir a despesa <strong>{excluir.descricao || excluir.categoria}</strong> de {dateBr(excluir.data)} no valor de <strong>{brl(excluir.valor)}</strong>?
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  )
}

function NovaDespesaModal({ categorias, onClose, onSaved }: { categorias: string[]; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState(todayStr())
  const [categoria, setCategoria] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    setError('')
    if (!categoria.trim()) return setError('Informe a categoria.')
    if (valor <= 0) return setError('Informe o valor.')
    setSaving(true)
    try {
      await post('/financeiro/despesas', { data, categoria: categoria.trim(), descricao: descricao.trim() || null, valor })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Nova despesa"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => submit()} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar despesa'}
          </button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="Data">
          <input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
        <Field label="Valor *">
          <MoneyInput value={valor} onChange={setValor} />
        </Field>
        <Field label="Categoria *" hint="Escolha uma existente ou crie uma nova digitando." className="full">
          <input className="input" list="fi-categorias" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ex.: Aluguel, Materiais, Marketing" autoFocus />
          <datalist id="fi-categorias">
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Descrição" className="full">
          <input className="input" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </Field>
        <div className="full">
          <ErrorBanner message={error} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
