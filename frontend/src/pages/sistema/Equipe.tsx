import { useEffect, useState } from 'react'
import { get } from '../../lib/api'
import { brl, pct } from '../../lib/format'
import { useAsync } from '../../lib/hooks'
import { useQueryParam } from '../../lib/router'
import { useAuth } from '../../lib/auth'
import { Empty, ErrorBanner, Loading, PageHeader, Progress, Segmented } from '../../components/ui'
import AdicionarProfissionalModal from './equipe/AdicionarProfissionalModal'
import FichaProfissional from './equipe/FichaProfissional'
import MeuGoogleCard from './equipe/MeuGoogleCard'
import { corVar, iniciais, type ProfissionalLista } from './equipe/tipos'
import './equipe/equipe.css'

type Filtro = 'ativos' | 'inativos' | 'todos'

function setUrlProfissional(id: string | null) {
  const params = new URLSearchParams(window.location.search)
  if (id) params.set('profissional', id)
  else params.delete('profissional')
  const qs = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
}

function ProfissionalCard({ p, mostraFinanceiro, onOpen, ehEu }: { p: ProfissionalLista; mostraFinanceiro: boolean; onOpen: () => void; ehEu: boolean }) {
  const ind = p.indicadoresMes
  return (
    <div
      className={`card eq-card ${p.ativo ? '' : 'eq-inativo'}`}
      style={corVar(p.cor)}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="eq-card-head">
        <span className="eq-avatar">{iniciais(p.nome)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eq-name">{p.nome}</div>
          <div className="eq-badges">
            <span className={`badge ${p.ativo ? 'badge-success' : 'badge-gray'}`}>{p.ativo ? 'Ativo' : 'Inativo'}</span>
            {!p.usuario ? <span className="badge badge-warning">Sem login</span> : p.usuario.perfil === 'DONO' ? <span className="badge badge-info">Dono</span> : null}
            {p.googleConectado ? <span className="badge badge-primary">Google</span> : null}
            {ehEu ? <span className="badge badge-gray">Você</span> : null}
          </div>
        </div>
        <span className="muted" style={{ fontSize: 18 }}>
          ›
        </span>
      </div>

      <div className="eq-kpis">
        <div className="eq-kpi">
          <div className="eq-kpi-label">Ocupação</div>
          <div className="eq-kpi-value">{pct(ind.ocupacao)}</div>
        </div>
        <div className="eq-kpi">
          <div className="eq-kpi-label">Serviços</div>
          <div className="eq-kpi-value">{ind.servicos}</div>
        </div>
        <div className="eq-kpi">
          <div className="eq-kpi-label">Faturamento</div>
          <div className="eq-kpi-value">{mostraFinanceiro ? brl(ind.faturamento) : '—'}</div>
        </div>
      </div>

      {p.metaServicosMes > 0 || (mostraFinanceiro && p.metaValorMes > 0) ? (
        <div className="stack-sm">
          {p.metaServicosMes > 0 ? (
            <Progress
              value={ind.progressoMetaServicos}
              label={
                <>
                  <span className="muted">Meta de serviços ({p.metaServicosMes})</span>
                  <span className="strong">{pct(ind.progressoMetaServicos)}</span>
                </>
              }
            />
          ) : null}
          {mostraFinanceiro && p.metaValorMes > 0 ? (
            <Progress
              value={ind.progressoMetaValor}
              label={
                <>
                  <span className="muted">Meta de valor ({brl(p.metaValorMes)})</span>
                  <span className="strong">{pct(ind.progressoMetaValor)}</span>
                </>
              }
            />
          ) : null}
        </div>
      ) : (
        <div className="small muted">Sem meta individual definida.</div>
      )}
    </div>
  )
}

export default function Equipe() {
  const { usuario } = useAuth()
  const ehDono = usuario?.perfil === 'DONO'
  const mostraFinanceiro = ehDono || Boolean(usuario?.permissoes.financeiroCompleto)
  const { data, loading, error, reload } = useAsync(() => get<ProfissionalLista[]>('/equipe'), [])

  const profParam = useQueryParam('profissional')
  const [fichaId, setFichaId] = useState<string | null>(profParam)
  const [adicionar, setAdicionar] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('ativos')

  useEffect(() => {
    if (profParam) setFichaId(profParam)
  }, [profParam])

  function abrir(id: string | null) {
    setFichaId(id)
    setUrlProfissional(id)
    window.scrollTo(0, 0)
  }

  if (fichaId) {
    return (
      <div className="eq-scope">
        <FichaProfissional profissionalId={fichaId} onBack={() => abrir(null)} onChanged={reload} />
      </div>
    )
  }

  const lista = data || []
  const ativos = lista.filter((p) => p.ativo).length
  const visiveis = lista.filter((p) => (filtro === 'todos' ? true : filtro === 'ativos' ? p.ativo : !p.ativo))
  const totalServicos = lista.reduce((acc, p) => acc + p.indicadoresMes.servicos, 0)
  const totalFaturamento = lista.reduce((acc, p) => acc + p.indicadoresMes.faturamento, 0)

  return (
    <div className="eq-scope">
      <PageHeader
        title="Equipe"
        subtitle={data ? `${ativos} profissional(is) ativo(s) · indicadores do mês atual` : 'Cadastro, jornada e resultados de cada profissional.'}
        actions={
          ehDono ? (
            <button className="btn btn-primary" onClick={() => setAdicionar(true)}>
              + Adicionar profissional
            </button>
          ) : null
        }
      />

      {usuario?.profissionalId ? (
        <div className="eq-top">
          <MeuGoogleCard compacto onChange={reload} />
        </div>
      ) : null}

      <ErrorBanner message={error} />

      {!data ? (
        loading ? <Loading /> : null
      ) : lista.length === 0 ? (
        <div className="card">
          <Empty icon="👥">
            Nenhum profissional cadastrado.
            {ehDono ? (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primary" onClick={() => setAdicionar(true)}>
                  + Adicionar profissional
                </button>
              </div>
            ) : null}
          </Empty>
        </div>
      ) : (
        <div className="stack">
          <div className="row-between">
            <Segmented
              options={[
                { key: 'ativos', label: `Ativos (${ativos})` },
                { key: 'inativos', label: `Inativos (${lista.length - ativos})` },
                { key: 'todos', label: `Todos (${lista.length})` },
              ]}
              value={filtro}
              onChange={setFiltro}
            />
            <span className="small muted">
              Equipe no mês: <strong>{totalServicos}</strong> serviço(s)
              {mostraFinanceiro ? (
                <>
                  {' '}
                  · <strong>{brl(totalFaturamento)}</strong>
                </>
              ) : null}
            </span>
          </div>
          {visiveis.length === 0 ? (
            <div className="card">
              <Empty>Nenhum profissional {filtro === 'inativos' ? 'inativo' : 'ativo'}.</Empty>
            </div>
          ) : (
            <div className="eq-grid">
              {visiveis.map((p) => (
                <ProfissionalCard key={p.id} p={p} mostraFinanceiro={mostraFinanceiro} ehEu={usuario?.profissionalId === p.id} onOpen={() => abrir(p.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {adicionar ? (
        <AdicionarProfissionalModal
          totalAtual={lista.length}
          onClose={() => setAdicionar(false)}
          onCreated={reload}
          onOpen={(id) => {
            setAdicionar(false)
            abrir(id)
          }}
        />
      ) : null}
    </div>
  )
}
