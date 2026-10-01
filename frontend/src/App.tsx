import { useEffect, type ComponentType } from 'react'
import { useAuth } from './lib/auth'
import { matchPath, navigate, useLocation } from './lib/router'
import { AppShell, NAV_ITEMS } from './layout/AppShell'
import { Loading } from './components/ui'
import type { Aba } from './types'

import Login from './pages/Login'
import Cadastro from './pages/Cadastro'
import VisaoGeral from './pages/sistema/VisaoGeral'
import Agenda from './pages/sistema/Agenda'
import Clientes from './pages/sistema/Clientes'
import ServicosProdutos from './pages/sistema/ServicosProdutos'
import Equipe from './pages/sistema/Equipe'
import Financeiro from './pages/sistema/Financeiro'
import Desempenho from './pages/sistema/Desempenho'
import Atendimento from './pages/sistema/Atendimento'
import Fidelidade from './pages/sistema/Fidelidade'
import AgentesIA from './pages/sistema/AgentesIA'
import Automacoes from './pages/sistema/Automacoes'
import Configuracoes from './pages/sistema/Configuracoes'
import Site from './pages/publico/Site'
import Portal from './pages/publico/Portal'
import Checkout from './pages/publico/Checkout'

const PAGINAS: Record<Aba, ComponentType> = {
  'visao-geral': VisaoGeral,
  agenda: Agenda,
  clientes: Clientes,
  servicos: ServicosProdutos,
  equipe: Equipe,
  financeiro: Financeiro,
  desempenho: Desempenho,
  atendimento: Atendimento,
  fidelidade: Fidelidade,
  agentes: AgentesIA,
  automacoes: Automacoes,
  configuracoes: Configuracoes,
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to])
  return null
}

function Sistema({ aba }: { aba: string }) {
  const { usuario, carregando, podeVer } = useAuth()
  if (carregando) return <Loading />
  if (!usuario) return <Redirect to="/login" />
  const primeira = NAV_ITEMS.find((i) => podeVer(i.key))?.key || 'agenda'
  if (!(aba in PAGINAS) || !podeVer(aba as Aba)) return <Redirect to={`/app/${primeira}`} />
  const Pagina = PAGINAS[aba as Aba]
  return (
    <AppShell aba={aba as Aba}>
      <Pagina />
    </AppShell>
  )
}

export default function App() {
  const { pathname } = useLocation()
  const { usuario, carregando } = useAuth()

  let params: Record<string, string> | null
  if ((params = matchPath('/s/:slug', pathname))) return <Site slug={params.slug} />
  if ((params = matchPath('/s/:slug/portal', pathname))) return <Portal slug={params.slug} />
  if ((params = matchPath('/pagamento/:id', pathname))) return <Checkout pagamentoId={params.id} />
  if (pathname === '/login') return usuario ? <Redirect to="/app/visao-geral" /> : <Login />
  if (pathname === '/cadastro') return usuario ? <Redirect to="/app/visao-geral" /> : <Cadastro />
  if ((params = matchPath('/app/:aba', pathname))) return <Sistema aba={params.aba} />
  if (carregando) return <Loading />
  return <Redirect to={usuario ? '/app/visao-geral' : '/login'} />
}
