import { useState } from 'react'
import { Gift, Star, TrendingUp } from 'lucide-react'
import { errorMessage, get, post } from '../../../lib/api'
import { dateTimeBr, phone } from '../../../lib/format'
import { useAsync, useDebounced } from '../../../lib/hooks'
import { Card, Drawer, Empty, ErrorBanner, Field, Loading, Segmented, Stat, SuccessBanner } from '../../../components/ui'
import { pts, TIPO_MOVIMENTO, type ClienteRef, type Extrato as ExtratoT } from './types'

export function Extrato({ clienteInicial }: { clienteInicial?: string | null }) {
  const [busca, setBusca] = useState('')
  const termo = useDebounced(busca.trim())
  const saldos = useAsync(() => get<ClienteRef[]>('/fidelidade/saldos', { busca: termo || undefined }), [termo])
  const [aberto, setAberto] = useState<string | null>(clienteInicial || null)

  return (
    <Card title="Extrato de pontos por cliente" subtitle="Pontos ganhos, usados e saldo de cada cliente. Sem busca, a lista mostra quem tem saldo.">
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 360 }} placeholder="Buscar cliente por nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <ErrorBanner message={saldos.error} />
      {saldos.loading && !saldos.data ? <Loading /> : null}
      {saldos.data && saldos.data.length === 0 ? (
        <Empty icon="★">{termo ? 'Nenhum cliente encontrado.' : 'Nenhum cliente com pontos ainda. Busque um cliente para ver o extrato ou fazer um ajuste.'}</Empty>
      ) : null}
      {saldos.data && saldos.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Telefone</th>
                <th className="right">Saldo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {saldos.data.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setAberto(c.id)}>
                  <td className="strong">{c.nome}</td>
                  <td>{phone(c.telefone)}</td>
                  <td className="right strong">{pts(c.pontos || 0)}</td>
                  <td className="right">
                    <button className="btn btn-sm">Ver extrato</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {aberto ? <ExtratoDrawer clienteId={aberto} onClose={() => setAberto(null)} onAjuste={saldos.reload} /> : null}
    </Card>
  )
}

function ExtratoDrawer({ clienteId, onClose, onAjuste }: { clienteId: string; onClose: () => void; onAjuste: () => void }) {
  const extrato = useAsync(() => get<ExtratoT>(`/fidelidade/extrato/${clienteId}`), [clienteId])
  const [sinal, setSinal] = useState<'add' | 'rem'>('add')
  const [quantidade, setQuantidade] = useState('')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  async function ajustar() {
    const q = Math.floor(Number(quantidade))
    if (!(q >= 1)) return setErro('Informe a quantidade de pontos.')
    setSalvando(true)
    setErro('')
    setOk('')
    try {
      await post('/fidelidade/ajuste', { clienteId, pontos: sinal === 'add' ? q : -q, descricao: descricao.trim() || undefined })
      setOk(`Ajuste de ${sinal === 'add' ? '+' : '−'}${pts(q)} registrado.`)
      setQuantidade('')
      setDescricao('')
      extrato.reload()
      onAjuste()
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  const d = extrato.data
  return (
    <Drawer title={d ? `Extrato · ${d.cliente.nome}` : 'Extrato de pontos'} onClose={onClose}>
      {extrato.loading && !d ? <Loading /> : null}
      <ErrorBanner message={extrato.error} />
      {d ? (
        <div className="stack">
          <div className="small muted">{phone(d.cliente.telefone)}</div>
          <div className="grid-3">
            <Stat icon={TrendingUp} grad="lime" label="Ganhos" value={<span className="fd-pts-pos">{d.ganhos.toLocaleString('pt-BR')}</span>} />
            <Stat icon={Gift} grad="violet" label="Usados" value={<span className="fd-pts-neg">{d.usados.toLocaleString('pt-BR')}</span>} />
            <Stat icon={Star} grad="amber" label="Saldo" value={d.saldo.toLocaleString('pt-BR')} />
          </div>

          <div className="card" style={{ background: 'var(--bg-muted)' }}>
            <div className="card-title" style={{ marginBottom: 10 }}>
              Ajuste manual
            </div>
            <div className="stack">
              <Segmented
                options={[
                  { key: 'add', label: '+ Adicionar pontos' },
                  { key: 'rem', label: '− Remover pontos' },
                ]}
                value={sinal}
                onChange={setSinal}
              />
              <div className="form-grid">
                <Field label="Pontos">
                  <input className="input" type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
                </Field>
                <Field label="Motivo (opcional)">
                  <input className="input" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: correção, bônus de indicação" />
                </Field>
              </div>
              <ErrorBanner message={erro} />
              <SuccessBanner message={ok} />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-primary btn-sm" onClick={ajustar} disabled={salvando}>
                  {salvando ? 'Registrando...' : 'Registrar ajuste'}
                </button>
              </div>
            </div>
          </div>

          <div className="section-title">Movimentos</div>
          {d.movimentos.length === 0 ? (
            <Empty>Nenhum movimento de pontos.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Descrição</th>
                    <th className="right">Pontos</th>
                  </tr>
                </thead>
                <tbody>
                  {d.movimentos.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap">{dateTimeBr(m.createdAt)}</td>
                      <td>{TIPO_MOVIMENTO[m.tipo] || m.tipo}</td>
                      <td>{m.descricao || <span className="muted">—</span>}</td>
                      <td className={`right ${m.pontos >= 0 ? 'fd-pts-pos' : 'fd-pts-neg'}`}>
                        {m.pontos > 0 ? '+' : ''}
                        {m.pontos.toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </Drawer>
  )
}
