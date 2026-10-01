import { useEffect, useState } from 'react'
import { get } from '../../lib/api'
import { phone, SEGMENTO_CLIENTE } from '../../lib/format'
import { useAsync, useDebounced } from '../../lib/hooks'
import { useQueryParam } from '../../lib/router'
import { useAuth } from '../../lib/auth'
import { Empty, ErrorBanner, Loading, PageHeader, SuccessBanner } from '../../components/ui'
import FichaClienteDrawer from './clientes/FichaClienteDrawer'
import NovoClienteModal, { type ClienteCriado } from './clientes/NovoClienteModal'
import MesclarModal from './clientes/MesclarModal'
import { dataCurta, iniciais, retornoAtrasado, SEGMENTO_BADGE, type ClientesResposta, type Segmento } from './clientes/tipos'
import './clientes/clientes.css'

const SEGMENTOS: Array<{ key: '' | Segmento; label: string }> = [
  { key: '', label: 'Todos' },
  { key: 'ATIVO', label: 'Ativos' },
  { key: 'RETORNO_PROXIMO', label: 'Retorno próximo' },
  { key: 'RETORNO_ATRASADO', label: 'Retorno atrasado' },
  { key: 'INATIVO', label: 'Inativos' },
]

function setUrlCliente(id: string | null) {
  const params = new URLSearchParams(window.location.search)
  if (id) params.set('cliente', id)
  else params.delete('cliente')
  const qs = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
}

export default function Clientes() {
  const { usuario } = useAuth()
  const ehProfissional = usuario?.perfil === 'PROFISSIONAL'
  const podeMesclar = !ehProfissional
  const fidelidade = Boolean(usuario?.tenant.fidelidadeAtiva)

  const [busca, setBusca] = useState('')
  const termo = useDebounced(busca.trim(), 350)
  const [segmento, setSegmento] = useState<'' | Segmento>('')
  const [pagina, setPagina] = useState(1)

  const clienteParam = useQueryParam('cliente')
  const [fichaId, setFichaId] = useState<string | null>(clienteParam)
  const [novo, setNovo] = useState(false)
  const [mesclar, setMesclar] = useState(false)
  const [mensagem, setMensagem] = useState('')

  useEffect(() => {
    if (clienteParam) setFichaId(clienteParam)
  }, [clienteParam])

  useEffect(() => setPagina(1), [termo, segmento])

  const { data, loading, error, reload } = useAsync(
    () => get<ClientesResposta>('/clientes', { busca: termo, segmento, pagina }),
    [termo, segmento, pagina]
  )

  function abrirFicha(id: string | null) {
    setFichaId(id)
    setUrlCliente(id)
  }

  function onCreated(c: ClienteCriado) {
    setNovo(false)
    setMensagem(
      c.jaExistia
        ? `Já existia um cliente com o telefone ${phone(c.telefone)}. O cadastro existente foi usado${c.nome ? ` e atualizado (${c.nome})` : ''}.`
        : `Cliente ${c.nome} cadastrado com sucesso.`
    )
    reload()
    abrirFicha(c.id)
  }

  const totalGeral = data ? Object.values(data.contagem).reduce((acc, n) => acc + n, 0) : 0
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.porPagina)) : 1

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle={ehProfissional ? 'Clientes que você atendeu ou que têm agendamento com você.' : 'Base única de clientes do estabelecimento.'}
        actions={
          <>
            {podeMesclar ? (
              <button className="btn" onClick={() => setMesclar(true)}>
                Mesclar cadastros
              </button>
            ) : null}
            <button className="btn btn-primary" onClick={() => setNovo(true)}>
              + Cadastrar cliente
            </button>
          </>
        }
      />

      {mensagem ? (
        <div style={{ marginBottom: 12 }}>
          <SuccessBanner message={mensagem} />
        </div>
      ) : null}

      <div className="card">
        <div className="cl-toolbar">
          <div className="cl-search">
            <span className="cl-search-icon">🔍</span>
            <input className="input" placeholder="Buscar por nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="chips">
            {SEGMENTOS.map((s) => (
              <button key={s.key || 'todos'} type="button" className={`chip ${segmento === s.key ? 'active' : ''}`} onClick={() => setSegmento(s.key)}>
                {s.label}
                {data ? <span className="cl-chip-count">{s.key ? data.contagem[s.key] ?? 0 : totalGeral}</span> : null}
              </button>
            ))}
          </div>
        </div>

        <ErrorBanner message={error} />

        {!data && loading ? (
          <Loading />
        ) : data && data.clientes.length === 0 ? (
          <Empty icon="👥">
            {termo || segmento ? 'Nenhum cliente encontrado com esses filtros.' : 'Nenhum cliente cadastrado ainda.'}
          </Empty>
        ) : data ? (
          <>
            <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Telefone</th>
                    <th>Segmento</th>
                    <th>Último atendimento</th>
                    <th>Retorno sugerido</th>
                    {fidelidade ? <th className="right">Pontos</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.clientes.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => abrirFicha(c.id)}>
                      <td>
                        <div className="cl-name-cell">
                          <span className="cl-avatar">{iniciais(c.nome)}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="cl-name">{c.nome}</div>
                            {c.email ? <div className="small muted">{c.email}</div> : null}
                          </div>
                        </div>
                      </td>
                      <td className="nowrap">{phone(c.telefone)}</td>
                      <td>{c.segmento ? <span className={`badge ${SEGMENTO_BADGE[c.segmento] || ''}`}>{SEGMENTO_CLIENTE[c.segmento] || c.segmento}</span> : '—'}</td>
                      <td className="nowrap">{dataCurta(c.ultimoAtendimento)}</td>
                      <td className={`nowrap ${c.segmento === 'RETORNO_ATRASADO' || (c.segmento !== 'INATIVO' && retornoAtrasado(c.retornoSugerido)) ? 'cl-late' : ''}`}>
                        {dataCurta(c.retornoSugerido)}
                      </td>
                      {fidelidade ? <td className="right">{(c.pontos || 0).toLocaleString('pt-BR')}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cl-pagination">
              <span className="muted small">
                {data.total} cliente(s) · página {data.pagina} de {totalPaginas}
              </span>
              {totalPaginas > 1 ? (
                <div className="row">
                  <button className="btn btn-sm" disabled={pagina <= 1 || loading} onClick={() => setPagina((p) => p - 1)}>
                    ‹ Anterior
                  </button>
                  <button className="btn btn-sm" disabled={pagina >= totalPaginas || loading} onClick={() => setPagina((p) => p + 1)}>
                    Próxima ›
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {fichaId ? <FichaClienteDrawer clienteId={fichaId} onClose={() => abrirFicha(null)} onSaved={reload} /> : null}
      {novo ? <NovoClienteModal onClose={() => setNovo(false)} onCreated={onCreated} /> : null}
      {mesclar ? (
        <MesclarModal
          onClose={() => setMesclar(false)}
          onMerged={(id) => {
            setMesclar(false)
            setMensagem('Cadastros mesclados. O histórico dos dois foi unido no cadastro mantido.')
            reload()
            abrirFicha(id)
          }}
        />
      ) : null}
    </div>
  )
}
