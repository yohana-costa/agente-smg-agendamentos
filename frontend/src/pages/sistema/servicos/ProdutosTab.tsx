import { useState } from 'react'
import { AlertTriangle, Boxes, Package } from 'lucide-react'
import { errorMessage, get, patch } from '../../../lib/api'
import { brl, pct } from '../../../lib/format'
import { useAuth } from '../../../lib/auth'
import { useAsync, useEventStream } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Loading, Stat, SuccessBanner, Toggle } from '../../../components/ui'
import type { Produto } from '../../../types'
import { AjusteEstoqueModal, ProdutoModal } from './ProdutoModals'
import VendaModal from './VendaModal'
import VendasList from './VendasList'
import { margem } from './types'

export default function ProdutosTab() {
  const { recarregar } = useAuth()
  const { data, loading, error, reload, setData } = useAsync(() => get<{ venderProdutos: boolean; produtos: Produto[] }>('/produtos'), [])
  const [editando, setEditando] = useState<Produto | 'novo' | null>(null)
  const [ajustando, setAjustando] = useState<Produto | null>(null)
  const [vendendo, setVendendo] = useState(false)
  const [salvandoConfig, setSalvandoConfig] = useState(false)
  const [busca, setBusca] = useState('')
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [vendasKey, setVendasKey] = useState(0)

  // vendas pelo site / Pix aprovado: atualiza estoque e lista de vendas
  useEventStream(['vendas.atualizada'], () => {
    reload()
    setVendasKey((k) => k + 1)
  })

  function feedback(m: string) {
    setErro('')
    setMsg(m)
    window.setTimeout(() => setMsg((atual) => (atual === m ? '' : atual)), 4500)
  }

  async function alternarVenda(v: boolean) {
    setSalvandoConfig(true)
    setErro('')
    try {
      const r = await patch<{ venderProdutos: boolean }>('/produtos/config', { venderProdutos: v })
      setData((d) => (d ? { ...d, venderProdutos: r.venderProdutos } : d))
      feedback(r.venderProdutos ? 'Venda de produtos ativada: a aba de produtos aparece no site.' : 'Venda de produtos desativada: produtos saem do site e das sugestões nos agendamentos.')
      recarregar().catch(() => undefined)
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvandoConfig(false)
    }
  }

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBanner message={error} />
  if (!data) return null

  const { venderProdutos, produtos } = data
  const termo = busca.trim().toLowerCase()
  const filtrados = produtos.filter((p) => !termo || p.nome.toLowerCase().includes(termo))
  const ativos = produtos.filter((p) => p.ativo)
  const baixo = ativos.filter((p) => p.estoque <= p.estoqueMinimo)
  const valorEstoqueCusto = ativos.reduce((acc, p) => acc + p.custo * p.estoque, 0)
  const valorEstoqueVenda = ativos.reduce((acc, p) => acc + p.preco * p.estoque, 0)

  return (
    <div className="stack">
      <Card>
        <div className="sv-config">
          <div className="sv-config-text">
            <div className="sv-config-title">Vender produtos</div>
            <div className="small muted">
              {venderProdutos
                ? 'Ativado: a aba de produtos aparece no site e os produtos relacionados são sugeridos nos agendamentos.'
                : 'Desativado: a aba de produtos some do site e os produtos não aparecem como sugestão nos agendamentos.'}
            </div>
          </div>
          <Toggle checked={venderProdutos} onChange={alternarVenda} disabled={salvandoConfig} label={salvandoConfig ? 'Salvando...' : venderProdutos ? 'Ativado' : 'Desativado'} />
        </div>
      </Card>

      <SuccessBanner message={msg} />
      <ErrorBanner message={erro} />

      <div className="stats-grid">
        <Stat icon={Package} grad="sky" label="Produtos ativos" value={ativos.length} hint={`${produtos.length} cadastrado(s)`} />
        <Stat icon={AlertTriangle} grad="amber" label="Estoque baixo" value={<span className={baixo.length ? 'danger-text' : ''}>{baixo.length}</span>} hint={baixo.length ? baixo.slice(0, 3).map((p) => p.nome).join(', ') + (baixo.length > 3 ? '…' : '') : 'Tudo em ordem'} />
        <Stat icon={Boxes} grad="indigo" label="Estoque a custo" value={brl(valorEstoqueCusto)} hint={`${brl(valorEstoqueVenda)} a preço de venda`} />
      </div>

      <Card
        title="Produtos"
        subtitle="Toda venda pelo site ou no balcão baixa o estoque automaticamente."
        actions={
          <>
            <input className="input input-sm" style={{ width: 200 }} placeholder="Buscar produto..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            <button className="btn" onClick={() => setVendendo(true)} disabled={!venderProdutos || !ativos.length} title={!venderProdutos ? 'Ative “Vender produtos” para registrar vendas' : undefined}>
              Registrar venda
            </button>
            <button className="btn btn-primary" onClick={() => setEditando('novo')}>
              + Novo produto
            </button>
          </>
        }
      >
        {!filtrados.length ? (
          <Empty icon="📦">{produtos.length ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="right">Estoque</th>
                  <th className="right">Mínimo</th>
                  <th className="right">Custo</th>
                  <th className="right">Preço</th>
                  <th className="right">Margem</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => {
                  const m = margem(p.preco, p.custo)
                  const low = p.estoque <= p.estoqueMinimo
                  return (
                    <tr key={p.id} className={p.ativo ? '' : 'sv-inativo'}>
                      <td>
                        <div className="sv-name">{p.nome}</div>
                        {p.descricao ? <div className="sv-desc" title={p.descricao}>{p.descricao}</div> : null}
                      </td>
                      <td className="right nowrap">
                        <span className="strong">{p.estoque}</span>{' '}
                        {p.estoque === 0 ? <span className="badge badge-danger">Esgotado</span> : low ? <span className="badge badge-warning">Estoque baixo</span> : null}
                      </td>
                      <td className="right muted">{p.estoqueMinimo}</td>
                      <td className="right nowrap">{brl(p.custo)}</td>
                      <td className="right strong nowrap">{brl(p.preco)}</td>
                      <td className={`right nowrap ${m < 0 ? 'danger-text' : m >= 40 ? 'success-text' : ''}`}>{pct(m)}</td>
                      <td className="sv-keep">
                        <span className={`badge ${p.ativo ? 'badge-success' : 'badge-gray'}`}>{p.ativo ? 'Ativo' : 'Inativo'}</span>
                      </td>
                      <td className="right nowrap sv-keep">
                        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <button className="btn btn-sm" onClick={() => setAjustando(p)}>
                            Ajustar estoque
                          </button>
                          <button className="btn btn-sm" onClick={() => setEditando(p)}>
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <VendasList refreshKey={vendasKey} />

      {editando ? (
        <ProdutoModal
          produto={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)}
          onSaved={(m) => {
            setEditando(null)
            feedback(m)
            reload()
          }}
        />
      ) : null}
      {ajustando ? (
        <AjusteEstoqueModal
          produto={ajustando}
          onClose={() => setAjustando(null)}
          onSaved={(m) => {
            setAjustando(null)
            feedback(m)
            reload()
          }}
        />
      ) : null}
      {vendendo ? (
        <VendaModal
          produtos={produtos}
          onClose={() => setVendendo(false)}
          onDone={(m) => {
            setVendendo(false)
            feedback(m)
            reload()
            setVendasKey((k) => k + 1)
          }}
        />
      ) : null}
    </div>
  )
}
