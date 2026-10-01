import { useMemo } from 'react'
import { get } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { Link } from '../../lib/router'
import { Empty, ErrorBanner, Loading, PageHeader } from '../../components/ui'
import { AutomacaoCard } from './automacoes/AutomacaoCard'
import { META, type Automacao } from './automacoes/meta'
import './automacoes/automacoes.css'

export default function Automacoes() {
  const { usuario } = useAuth()
  const lista = useAsync(() => get<Automacao[]>('/automacoes'), [])

  const exemplos = useMemo(() => {
    const ex: Record<string, string> = {}
    for (const m of Object.values(META)) for (const p of m.placeholders) ex[p.key] = p.exemplo
    ex.estabelecimento = usuario?.tenant.nome || 'Seu estabelecimento'
    ex.link_site = `${window.location.origin}/s/${usuario?.tenant.slug || 'seu-negocio'}`
    return ex
  }, [usuario])

  const atualizar = (a: Automacao) => lista.data && lista.setData(lista.data.map((x) => (x.tipo === a.tipo ? a : x)))

  return (
    <div>
      <PageHeader
        title="Automações"
        subtitle={
          <>
            Mensagens automáticas enviadas ao cliente pelo WhatsApp do estabelecimento. A conexão do número fica em{' '}
            <Link to="/app/agentes?tab=whatsapp">Agentes de IA &gt; Conexão WhatsApp</Link>.
          </>
        }
      />
      {lista.loading && !lista.data ? <Loading /> : null}
      <ErrorBanner message={lista.error} />
      {lista.data && lista.data.length === 0 ? <Empty>Nenhuma automação encontrada.</Empty> : null}
      {lista.data ? (
        <div className="au-list">
          {lista.data
            .filter((a) => META[a.tipo])
            .map((a) => (
              <AutomacaoCard key={a.tipo} automacao={a} exemplos={exemplos} onSalvo={atualizar} />
            ))}
        </div>
      ) : null}
    </div>
  )
}
