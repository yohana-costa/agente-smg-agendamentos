import { useMemo, useState } from 'react'
import { errorMessage, get, patch, post } from '../../../lib/api'
import { brl, duration } from '../../../lib/format'
import { useAsync, useEventStream } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Loading, Segmented, SuccessBanner, Toggle } from '../../../components/ui'
import type { ProfissionalRef, Produto, Servico } from '../../../types'
import ServicoModal from './ServicoModal'
import { carregarProfissionais } from './types'

type FiltroStatus = 'todos' | 'ativos' | 'inativos'

interface Dados {
  servicos: Servico[]
  categorias: string[]
  profissionais: ProfissionalRef[]
  produtos: Produto[]
  venderProdutos: boolean
}

async function carregar(): Promise<Dados> {
  const [servicos, categorias, profissionais, prod] = await Promise.all([
    get<Servico[]>('/servicos'),
    get<string[]>('/servicos/categorias').catch(() => [] as string[]),
    carregarProfissionais(),
    get<{ venderProdutos: boolean; produtos: Produto[] }>('/produtos').catch(() => ({ venderProdutos: false, produtos: [] as Produto[] })),
  ])
  return { servicos, categorias, profissionais, produtos: prod.produtos, venderProdutos: prod.venderProdutos }
}

export default function ServicosTab() {
  const { data, loading, error, reload, setData } = useAsync(carregar, [])
  const [busca, setBusca] = useState('')
  const [status, setStatus] = useState<FiltroStatus>('todos')
  const [editando, setEditando] = useState<Servico | 'novo' | null>(null)
  const [aplicando, setAplicando] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [erroAcao, setErroAcao] = useState('')

  useEventStream(['catalogo.atualizado'], () => reload())

  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const lista = (data?.servicos || []).filter((s) => {
      if (status === 'ativos' && !s.ativo) return false
      if (status === 'inativos' && s.ativo) return false
      if (termo && !`${s.nome} ${s.categoria || ''}`.toLowerCase().includes(termo)) return false
      return true
    })
    const mapa = new Map<string, Servico[]>()
    for (const s of lista) {
      const k = s.categoria || 'Sem categoria'
      mapa.set(k, [...(mapa.get(k) || []), s])
    }
    return [...mapa.entries()].sort(([a], [b]) => (a === 'Sem categoria' ? 1 : b === 'Sem categoria' ? -1 : a.localeCompare(b, 'pt-BR')))
  }, [data, busca, status])

  const profMap = useMemo(() => new Map((data?.profissionais || []).map((p) => [p.id, p])), [data])

  function feedback(m: string) {
    setErroAcao('')
    setMsg(m)
    window.setTimeout(() => setMsg((atual) => (atual === m ? '' : atual)), 4000)
  }

  async function aplicarDuracao(s: Servico) {
    setAplicando(s.id)
    setErroAcao('')
    try {
      await post(`/servicos/${s.id}/aplicar-duracao-real`)
      feedback(`Duração de “${s.nome}” atualizada para ${s.duracaoRealMedia} min.`)
      reload()
    } catch (e) {
      setErroAcao(errorMessage(e))
    } finally {
      setAplicando(null)
    }
  }

  async function alternarAtivo(s: Servico, ativo: boolean) {
    setErroAcao('')
    setData((d) => (d ? { ...d, servicos: d.servicos.map((x) => (x.id === s.id ? { ...x, ativo } : x)) } : d))
    try {
      await patch(`/servicos/${s.id}`, { ativo })
      feedback(ativo ? `“${s.nome}” ativado e visível no site.` : `“${s.nome}” desativado: não aparece mais no site nem para o agente.`)
    } catch (e) {
      setErroAcao(errorMessage(e))
      reload()
    }
  }

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBanner message={error} />
  if (!data) return null

  const total = data.servicos.length
  const ativos = data.servicos.filter((s) => s.ativo).length
  const comSugestao = data.servicos.filter((s) => s.duracaoRealMedia && s.duracaoRealMedia !== s.duracaoMin).length

  return (
    <div className="stack">
      <div className="sv-toolbar">
        <div className="row">
          <input className="input" placeholder="Buscar serviço ou categoria..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Segmented<FiltroStatus>
            value={status}
            onChange={setStatus}
            options={[
              { key: 'todos', label: `Todos (${total})` },
              { key: 'ativos', label: `Ativos (${ativos})` },
              { key: 'inativos', label: `Inativos (${total - ativos})` },
            ]}
          />
        </div>
        <button className="btn btn-primary" onClick={() => setEditando('novo')}>
          + Novo serviço
        </button>
      </div>

      <SuccessBanner message={msg} />
      <ErrorBanner message={erroAcao} />
      {comSugestao ? (
        <div className="banner info-banner">
          {comSugestao} serviço(s) têm duração real média diferente da informada. Compare lado a lado e atualize quando fizer sentido — a troca nunca é automática.
        </div>
      ) : null}

      {!grupos.length ? (
        <Card>
          <Empty icon="✂">{total ? 'Nenhum serviço encontrado com esses filtros.' : 'Nenhum serviço cadastrado ainda. Crie o primeiro para começar a receber agendamentos.'}</Empty>
        </Card>
      ) : (
        grupos.map(([cat, lista]) => (
          <Card
            key={cat}
            title={
              <span className="sv-cat-title">
                {cat} <span className="sv-cat-count">{lista.length} serviço(s)</span>
              </span>
            }
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Serviço</th>
                    <th className="right">Preço</th>
                    <th>Duração informada x real</th>
                    <th>Intervalo</th>
                    <th>Retorno</th>
                    <th>Profissionais</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((s) => (
                    <tr key={s.id} className={s.ativo ? '' : 'sv-inativo'}>
                      <td>
                        <div className="sv-name">{s.nome}</div>
                        {s.descricao ? <div className="sv-desc" title={s.descricao}>{s.descricao}</div> : null}
                      </td>
                      <td className="right strong nowrap">{brl(s.preco)}</td>
                      <td className="sv-keep">
                        <DuracaoCell servico={s} aplicando={aplicando === s.id} onAplicar={() => aplicarDuracao(s)} />
                      </td>
                      <td className="nowrap">{s.intervaloMin ? duration(s.intervaloMin) : <span className="muted">—</span>}</td>
                      <td className="nowrap">{s.retornoDias ? `${s.retornoDias} dias` : <span className="muted">—</span>}</td>
                      <td>
                        {s.profissionalIds.length ? (
                          <div className="sv-profs">
                            {s.profissionalIds.map((id) => {
                              const p = profMap.get(id)
                              return p ? (
                                <span className="sv-prof-chip" key={id}>
                                  <span className="dot" style={{ background: p.cor }} />
                                  {p.nome}
                                </span>
                              ) : null
                            })}
                          </div>
                        ) : (
                          <span className="badge badge-warning">Nenhum</span>
                        )}
                      </td>
                      <td className="sv-keep">
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <Toggle checked={s.ativo} onChange={(v) => alternarAtivo(s, v)} />
                          <span className={`badge ${s.ativo ? 'badge-success' : 'badge-gray'}`}>{s.ativo ? 'Ativo' : 'Inativo'}</span>
                        </div>
                      </td>
                      <td className="right">
                        <button className="btn btn-sm" onClick={() => setEditando(s)}>
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      {editando ? (
        <ServicoModal
          servico={editando === 'novo' ? null : editando}
          categorias={data.categorias}
          profissionais={data.profissionais}
          produtos={data.produtos}
          venderProdutos={data.venderProdutos}
          onClose={() => setEditando(null)}
          onSaved={(m) => {
            setEditando(null)
            feedback(m)
            reload()
          }}
        />
      ) : null}
    </div>
  )
}

function DuracaoCell({ servico: s, aplicando, onAplicar }: { servico: Servico; aplicando: boolean; onAplicar: () => void }) {
  const real = s.duracaoRealMedia
  const diff = real !== null ? real - s.duracaoMin : 0
  return (
    <div className="sv-dur">
      <div className="sv-dur-pair">
        <span className="sv-dur-lbl">Informada</span>
        <strong>{duration(s.duracaoMin)}</strong>
        <span className="muted">·</span>
        <span className="sv-dur-lbl">Real</span>
        {real !== null ? <strong>{duration(real)}</strong> : <span className="muted small">sem registros</span>}
      </div>
      {real !== null ? (
        <div className="row" style={{ gap: 6 }}>
          {diff === 0 ? (
            <span className="sv-dur-ok">✓ Igual à informada</span>
          ) : (
            <>
              <span className={diff > 0 ? 'sv-dur-diff-up' : 'sv-dur-diff-down'}>
                {diff > 0 ? '+' : ''}
                {diff} min
              </span>
              <button className="btn btn-sm" onClick={onAplicar} disabled={aplicando} title={`Média de ${s.amostrasDuracaoReal} atendimento(s)`}>
                {aplicando ? 'Atualizando...' : `Atualizar para ${real}min`}
              </button>
            </>
          )}
          <span className="small muted">{s.amostrasDuracaoReal} atend.</span>
        </div>
      ) : null}
    </div>
  )
}
