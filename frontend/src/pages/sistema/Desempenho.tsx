import { useState } from 'react'
import { get } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { dateBr } from '../../lib/format'
import { useAsync } from '../../lib/hooks'
import { Card, ErrorBanner, Loading, PageHeader, PeriodFilter, periodoMesAtual, type Periodo } from '../../components/ui'
import { carregarReferencias, type DesempenhoResp } from './desempenho/types'
import { Capacidade, Clientes, Comparecimento, Produtos, Profissionais, Receita, Servicos } from './desempenho/Secoes'
import './desempenho/desempenho.css'

export default function Desempenho() {
  const { usuario } = useAuth()
  const ehProfissional = usuario?.perfil === 'PROFISSIONAL'
  const [periodo, setPeriodo] = useState<Periodo>(periodoMesAtual())
  const [profissionalId, setProfissionalId] = useState('')
  const [servicoId, setServicoId] = useState('')

  const refs = useAsync(carregarReferencias, [])
  const { data, loading, error } = useAsync(
    () =>
      get<DesempenhoResp>('/desempenho', {
        de: periodo.de,
        ate: periodo.ate,
        profissionalId: ehProfissional ? undefined : profissionalId || undefined,
        servicoId: servicoId || undefined,
      }),
    [periodo.de, periodo.ate, profissionalId, servicoId, ehProfissional]
  )

  const profissionais = refs.data?.profissionais || []
  const servicos = refs.data?.servicos || []
  const mostrarPorProfissional = !ehProfissional && !profissionalId && (data?.capacidade.porProfissional.length || 0) > 1

  return (
    <div>
      <PageHeader
        title="Desempenho"
        subtitle={ehProfissional ? 'Seus indicadores de ocupação, clientes, serviços e receita.' : 'Visão completa do desempenho do negócio.'}
      />
      <Card>
        <div className="de-filtros">
          <PeriodFilter value={periodo} onChange={setPeriodo} />
          <div className="row">
            {!ehProfissional ? (
              <select className="select input-sm" value={profissionalId} onChange={(e) => setProfissionalId(e.target.value)} aria-label="Profissional">
                <option value="">Todos os profissionais</option>
                {profissionais.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            ) : null}
            <select className="select input-sm" value={servicoId} onChange={(e) => setServicoId(e.target.value)} aria-label="Serviço">
              <option value="">Todos os serviços</option>
              {servicos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.categoria ? `${s.categoria} · ` : ''}
                  {s.nome}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <ErrorBanner message={error} />
      {loading && !data ? (
        <Loading label="Calculando indicadores do período..." />
      ) : data ? (
        <div className={loading ? 'de-updating' : ''}>
          <div className="row small muted" style={{ marginTop: 12 }}>
            {loading ? <span className="spinner" /> : null}
            {loading ? 'Atualizando indicadores...' : `Período de ${dateBr(data.periodo.de)} a ${dateBr(data.periodo.ate)}`}
          </div>
          <Capacidade d={data} mostrarPorProfissional={mostrarPorProfissional} />
          <Comparecimento d={data} />
          <Clientes d={data} />
          <Servicos d={data} />
          {data.produtos !== null ? <Produtos produtos={data.produtos} /> : null}
          {!ehProfissional ? <Profissionais d={data} /> : null}
          <Receita d={data} />
        </div>
      ) : null}
    </div>
  )
}
