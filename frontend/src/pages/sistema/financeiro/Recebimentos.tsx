import { useState, type FormEvent } from 'react'
import { Banknote, CreditCard, Percent, PiggyBank } from 'lucide-react'
import { errorMessage, get, post } from '../../../lib/api'
import { brl, dateTimeBr, ORIGEM, phone, todayStr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Field, Loading, Modal, MoneyInput, Segmented, Stat, SuccessBanner, type Periodo } from '../../../components/ui'
import { formaLabel, type Recebimento, type RecebimentosResp } from './types'

type FiltroTipo = 'TODOS' | Recebimento['tipo']
const TIPO_LABEL: Record<Recebimento['tipo'], string> = { SERVICO: 'Serviço', PRODUTO: 'Produto', OUTRO: 'Outro' }

export default function Recebimentos({ periodo }: { periodo: Periodo }) {
  const { data, loading, error, reload } = useAsync(() => get<RecebimentosResp>('/financeiro/recebimentos', { de: periodo.de, ate: periodo.ate }), [periodo.de, periodo.ate])
  const [tipo, setTipo] = useState<FiltroTipo>('TODOS')
  const [novo, setNovo] = useState(false)
  const [msg, setMsg] = useState('')

  const lista = (data?.recebimentos || []).filter((r) => tipo === 'TODOS' || r.tipo === tipo)
  const totais = lista.reduce((acc, r) => ({ bruto: acc.bruto + r.valorBruto, taxas: acc.taxas + r.taxaGateway, liquido: acc.liquido + r.valorLiquido }), { bruto: 0, taxas: 0, liquido: 0 })
  const online = (data?.recebimentos || []).filter((r) => r.modo === 'ONLINE').reduce((a, r) => a + r.valorBruto, 0)
  const local = (data?.totais.bruto || 0) - online

  return (
    <div className="stack">
      <SuccessBanner message={msg} />
      <div className="stats-grid">
        <Stat icon={Banknote} grad="indigo" label="Valor bruto" value={brl(data?.totais.bruto)} hint={`${data?.recebimentos.length || 0} recebimento(s)`} />
        <Stat icon={Percent} grad="rose" label="Taxas do gateway" value={<span className="fi-neg">{brl(data?.totais.taxas)}</span>} />
        <Stat icon={PiggyBank} grad="lime" label="Valor líquido" value={<span className="success-text">{brl(data?.totais.liquido)}</span>} />
        <Stat icon={CreditCard} grad="sky" label="Online x no local" value={brl(online)} hint={`${brl(local)} no local`} />
      </div>

      <Card
        title="Recebimentos"
        subtitle="Serviços, produtos e outros recebimentos do período."
        actions={
          <button className="btn btn-primary" onClick={() => setNovo(true)}>
            + Registrar recebimento
          </button>
        }
      >
        <div className="fi-toolbar">
          <Segmented<FiltroTipo>
            value={tipo}
            onChange={setTipo}
            options={[
              { key: 'TODOS', label: 'Todos' },
              { key: 'SERVICO', label: 'Serviços' },
              { key: 'PRODUTO', label: 'Produtos' },
              { key: 'OUTRO', label: 'Outros' },
            ]}
          />
        </div>
        <ErrorBanner message={error} />
        {loading && !data ? (
          <Loading />
        ) : !lista.length ? (
          <Empty icon="💰">Nenhum recebimento no período.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Descrição</th>
                  <th>Origem</th>
                  <th>Forma</th>
                  <th className="right">Bruto</th>
                  <th className="right">Taxa</th>
                  <th className="right">Líquido</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{dateTimeBr(r.data)}</td>
                    <td>
                      {r.cliente ? (
                        <>
                          <div className="strong">{r.cliente.nome}</div>
                          <div className="small muted">{phone(r.cliente.telefone)}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <div>{r.descricao || <span className="muted">—</span>}</div>
                      <div className="fi-tipo">
                        {TIPO_LABEL[r.tipo]}
                        {r.valorReembolsado ? (
                          <span className={`badge ${r.status === 'REEMBOLSADO' ? 'badge-danger' : 'badge-warning'}`} style={{ marginLeft: 6 }}>
                            {r.status === 'REEMBOLSADO' ? 'Reembolsado' : 'Reemb. parcial'} {brl(r.valorReembolsado)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-gray">{ORIGEM[r.origem] || r.origem}</span>
                    </td>
                    <td className="nowrap">{formaLabel(r.modo, r.forma)}</td>
                    <td className="right nowrap">{brl(r.valorBruto)}</td>
                    <td className="right nowrap fi-neg">{r.taxaGateway ? `− ${brl(r.taxaGateway)}` : <span className="muted">—</span>}</td>
                    <td className="right nowrap strong">{brl(r.valorLiquido)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total{tipo !== 'TODOS' ? ' (filtrado)' : ''}</td>
                  <td className="right nowrap">{brl(totais.bruto)}</td>
                  <td className="right nowrap fi-neg">{totais.taxas ? `− ${brl(totais.taxas)}` : '—'}</td>
                  <td className="right nowrap">{brl(totais.liquido)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {novo ? (
        <NovoRecebimentoModal
          onClose={() => setNovo(false)}
          onSaved={() => {
            setNovo(false)
            setMsg('Recebimento registrado.')
            window.setTimeout(() => setMsg(''), 4000)
            reload()
          }}
        />
      ) : null}
    </div>
  )
}

type FormaManual = 'DINHEIRO' | 'MAQUININHA' | 'PIX' | 'CARTAO'

function NovoRecebimentoModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState(todayStr())
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState(0)
  const [forma, setForma] = useState<FormaManual>('DINHEIRO')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    setError('')
    if (!descricao.trim()) return setError('Informe a descrição.')
    if (valor <= 0) return setError('Informe o valor.')
    setSaving(true)
    try {
      await post('/financeiro/recebimentos', { data, descricao: descricao.trim(), valor, forma })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Registrar recebimento"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => submit()} disabled={saving}>
            {saving ? 'Salvando...' : 'Registrar'}
          </button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="Descrição *" className="full">
          <input className="input" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Aluguel de sala, gorjeta, pacote" autoFocus />
        </Field>
        <Field label="Data">
          <input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
        <Field label="Valor *">
          <MoneyInput value={valor} onChange={setValor} />
        </Field>
        <Field label="Forma de recebimento" className="full">
          <Segmented<FormaManual>
            value={forma}
            onChange={setForma}
            options={[
              { key: 'DINHEIRO', label: 'Dinheiro' },
              { key: 'MAQUININHA', label: 'Maquininha' },
              { key: 'PIX', label: 'Pix' },
              { key: 'CARTAO', label: 'Cartão' },
            ]}
          />
        </Field>
        <div className="full">
          <ErrorBanner message={error} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
