import { useState } from 'react'
import { errorMessage, patch, post } from '../../../lib/api'
import { brl, dateBr, phone, todayStr } from '../../../lib/format'
import { Card, Empty, ErrorBanner, Field, Modal, MoneyInput, Segmented, Toggle } from '../../../components/ui'
import { ClienteBusca } from './ClienteBusca'
import type { ClienteRef, Cupom } from './types'

type Form = {
  id?: string
  codigo: string
  tipo: Cupom['tipo']
  percentual: string
  valorCentavos: number
  validade: string
  limiteUsos: string
  paraCliente: boolean
  cliente: ClienteRef | null
  ativo: boolean
}

const vazio: Form = { codigo: '', tipo: 'PERCENTUAL', percentual: '10', valorCentavos: 1000, validade: '', limiteUsos: '', paraCliente: false, cliente: null, ativo: true }

function situacao(c: Cupom): { label: string; cls: string } {
  if (!c.ativo) return { label: 'Inativo', cls: 'badge-gray' }
  if (c.validade && c.validade < todayStr()) return { label: 'Vencido', cls: 'badge-danger' }
  if (c.limiteUsos && c.usos >= c.limiteUsos) return { label: 'Esgotado', cls: 'badge-warning' }
  return { label: 'Ativo', cls: 'badge-success' }
}

export function Cupons({ cupons, onChange }: { cupons: Cupom[]; onChange: () => void }) {
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [erroLista, setErroLista] = useState('')
  const [alternando, setAlternando] = useState<string | null>(null)

  function editar(c: Cupom) {
    setErro('')
    setForm({
      id: c.id,
      codigo: c.codigo,
      tipo: c.tipo,
      percentual: c.tipo === 'PERCENTUAL' ? String(c.valor) : '10',
      valorCentavos: c.tipo === 'VALOR' ? c.valor : 1000,
      validade: c.validade || '',
      limiteUsos: c.limiteUsos ? String(c.limiteUsos) : '',
      paraCliente: Boolean(c.clienteId),
      cliente: c.clienteId ? { id: c.clienteId, nome: c.cliente?.nome || 'Cliente', telefone: c.cliente?.telefone || '' } : null,
      ativo: c.ativo,
    })
  }

  async function salvar() {
    if (!form) return
    const codigo = form.codigo.trim().toUpperCase().replace(/\s+/g, '')
    if (!codigo) return setErro('Informe o código do cupom.')
    const valor = form.tipo === 'PERCENTUAL' ? Math.round(Number(form.percentual)) : form.valorCentavos
    if (form.tipo === 'PERCENTUAL' && !(valor >= 1 && valor <= 100)) return setErro('O percentual deve ser entre 1% e 100%.')
    if (form.tipo === 'VALOR' && !(valor >= 1)) return setErro('Informe o valor do desconto.')
    if (form.paraCliente && !form.cliente) return setErro('Escolha o cliente que poderá usar o cupom.')
    if (form.limiteUsos && !(Number(form.limiteUsos) >= 1)) return setErro('O limite de usos deve ser pelo menos 1.')
    setSalvando(true)
    setErro('')
    const body = {
      codigo,
      tipo: form.tipo,
      valor,
      validade: form.validade || null,
      limiteUsos: form.limiteUsos ? Number(form.limiteUsos) : null,
      clienteId: form.paraCliente ? form.cliente?.id || null : null,
      ativo: form.ativo,
    }
    try {
      if (form.id) await patch(`/fidelidade/cupons/${form.id}`, body)
      else await post('/fidelidade/cupons', body)
      setForm(null)
      onChange()
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  async function alternar(c: Cupom, ativo: boolean) {
    setAlternando(c.id)
    setErroLista('')
    try {
      await patch(`/fidelidade/cupons/${c.id}`, { ativo })
      onChange()
    } catch (e) {
      setErroLista(errorMessage(e))
    } finally {
      setAlternando(null)
    }
  }

  return (
    <Card
      title="Cupons de desconto"
      subtitle="Cupons para todos os clientes ou para um cliente específico. O cliente informa o código ao agendar."
      actions={
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            setErro('')
            setForm({ ...vazio })
          }}
        >
          + Novo cupom
        </button>
      }
    >
      <ErrorBanner message={erroLista} />
      {cupons.length === 0 ? (
        <Empty icon="%">Nenhum cupom criado ainda.</Empty>
      ) : (
        <div className="table-wrap" style={{ marginTop: erroLista ? 10 : 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Desconto</th>
                <th>Para</th>
                <th>Validade</th>
                <th>Usos</th>
                <th>Situação</th>
                <th>Ativo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cupons.map((c) => {
                const s = situacao(c)
                return (
                  <tr key={c.id}>
                    <td>
                      <span className="fd-code">{c.codigo}</span>
                    </td>
                    <td className="strong">{c.tipo === 'PERCENTUAL' ? `${c.valor}%` : brl(c.valor)}</td>
                    <td>
                      {c.clienteId ? (
                        <div>
                          <div>{c.cliente?.nome || 'Cliente específico'}</div>
                          {c.cliente?.telefone ? <div className="small muted">{phone(c.cliente.telefone)}</div> : null}
                        </div>
                      ) : (
                        <span className="muted">Todos os clientes</span>
                      )}
                    </td>
                    <td>{c.validade ? dateBr(c.validade) : <span className="muted">Sem validade</span>}</td>
                    <td>
                      {c.usos}
                      {c.limiteUsos ? ` / ${c.limiteUsos}` : <span className="muted"> / ilimitado</span>}
                    </td>
                    <td>
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                    </td>
                    <td>
                      <Toggle checked={c.ativo} disabled={alternando === c.id} onChange={(v) => alternar(c, v)} />
                    </td>
                    <td className="right">
                      <button className="btn btn-sm" onClick={() => editar(c)}>
                        Editar
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {form ? (
        <Modal
          title={form.id ? 'Editar cupom' : 'Novo cupom'}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)} disabled={salvando}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando...' : 'Salvar cupom'}
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Código" hint="Letras e números, sem espaços. O cliente digita este código.">
              <input
                className="input mono"
                value={form.codigo}
                onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase().replace(/\s+/g, '') })}
                placeholder="EX.: BEMVINDO10"
              />
            </Field>
            <Field label="Tipo de desconto">
              <Segmented
                options={[
                  { key: 'PERCENTUAL', label: 'Percentual (%)' },
                  { key: 'VALOR', label: 'Valor fixo (R$)' },
                ]}
                value={form.tipo}
                onChange={(tipo) => setForm({ ...form, tipo })}
              />
            </Field>
            <div className="form-grid">
              {form.tipo === 'PERCENTUAL' ? (
                <Field label="Percentual">
                  <div className="input-group">
                    <input className="input" type="number" min={1} max={100} value={form.percentual} onChange={(e) => setForm({ ...form, percentual: e.target.value })} />
                    <span className="addon">%</span>
                  </div>
                </Field>
              ) : (
                <Field label="Valor do desconto">
                  <MoneyInput value={form.valorCentavos} onChange={(valorCentavos) => setForm({ ...form, valorCentavos })} />
                </Field>
              )}
              <Field label="Validade" hint="Em branco: sem data de validade.">
                <input className="input" type="date" value={form.validade} onChange={(e) => setForm({ ...form, validade: e.target.value })} />
              </Field>
              <Field label="Limite de usos" hint="Em branco: usos ilimitados.">
                <input className="input" type="number" min={1} value={form.limiteUsos} onChange={(e) => setForm({ ...form, limiteUsos: e.target.value })} placeholder="Ilimitado" />
              </Field>
            </div>
            <Field label="Quem pode usar">
              <Segmented
                options={[
                  { key: 'todos', label: 'Todos os clientes' },
                  { key: 'cliente', label: 'Cliente específico' },
                ]}
                value={form.paraCliente ? 'cliente' : 'todos'}
                onChange={(k) => setForm({ ...form, paraCliente: k === 'cliente' })}
              />
            </Field>
            {form.paraCliente ? <ClienteBusca value={form.cliente} onChange={(cliente) => setForm({ ...form, cliente })} /> : null}
            <Toggle checked={form.ativo} onChange={(ativo) => setForm({ ...form, ativo })} label="Cupom ativo" />
            <ErrorBanner message={erro} />
          </div>
        </Modal>
      ) : null}
    </Card>
  )
}
