import { get } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { navigate, useQueryParam } from '../../lib/router'
import { Empty, ErrorBanner, Loading, PageHeader, Tabs } from '../../components/ui'
import { AgendaCfg, Metas } from './configuracoes/AgendaMetas'
import { Empresa } from './configuracoes/Empresa'
import { Funcionamento } from './configuracoes/Funcionamento'
import { Integracoes, Plano } from './configuracoes/Integracoes'
import { Pagamentos } from './configuracoes/Pagamentos'
import { Politicas } from './configuracoes/Politicas'
import { Site } from './configuracoes/Site'
import { Usuarios } from './configuracoes/Usuarios'
import type { ConfigDados } from './configuracoes/shared'
import './configuracoes/configuracoes.css'

type Aba = 'empresa' | 'funcionamento' | 'politicas' | 'agenda' | 'metas' | 'pagamentos' | 'site' | 'integracoes' | 'usuarios' | 'plano'

const ABAS: Array<{ key: Aba; label: string }> = [
  { key: 'empresa', label: 'Empresa' },
  { key: 'funcionamento', label: 'Funcionamento' },
  { key: 'politicas', label: 'Políticas' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'metas', label: 'Metas' },
  { key: 'pagamentos', label: 'Pagamentos' },
  { key: 'site', label: 'Site' },
  { key: 'integracoes', label: 'Integrações' },
  { key: 'usuarios', label: 'Usuários e permissões' },
  { key: 'plano', label: 'Plano' },
]

export default function Configuracoes() {
  const { usuario, recarregar } = useAuth()
  const tabParam = useQueryParam('tab')
  const aba: Aba = ABAS.some((a) => a.key === tabParam) ? (tabParam as Aba) : 'empresa'
  const isDono = usuario?.perfil === 'DONO'
  const dados = useAsync(() => (isDono ? get<ConfigDados>('/configuracoes') : Promise.resolve(null)), [isDono])

  if (!isDono) {
    return (
      <div>
        <PageHeader title="Configurações" />
        <Empty icon="🔒">Acesso exclusivo do dono do estabelecimento.</Empty>
      </div>
    )
  }

  const d = dados.data
  const onChange = (p: Partial<ConfigDados>) => d && dados.setData({ ...d, ...p })
  const irPara = (t: Aba) => navigate(t === 'empresa' ? '/app/configuracoes' : `/app/configuracoes?tab=${t}`, { replace: true })

  return (
    <div>
      <PageHeader title="Configurações" subtitle="Dados do estabelecimento, regras de operação, pagamentos, site e acessos." />
      {dados.loading && !d ? <Loading /> : null}
      <ErrorBanner message={dados.error} />
      {d ? (
        <>
          <Tabs<Aba> tabs={ABAS} value={aba} onChange={irPara} />
          {aba === 'empresa' ? <Empresa dados={d} onChange={onChange} recarregar={recarregar} /> : null}
          {aba === 'funcionamento' ? <Funcionamento dados={d} onChange={onChange} /> : null}
          {aba === 'politicas' ? <Politicas dados={d} onChange={onChange} /> : null}
          {aba === 'agenda' ? <AgendaCfg dados={d} onChange={onChange} /> : null}
          {aba === 'metas' ? <Metas dados={d} onChange={onChange} /> : null}
          {aba === 'pagamentos' ? <Pagamentos dados={d} onChange={onChange} /> : null}
          {aba === 'site' ? <Site dados={d} onChange={onChange} recarregar={recarregar} /> : null}
          {aba === 'integracoes' ? <Integracoes dados={d} /> : null}
          {aba === 'usuarios' ? <Usuarios /> : null}
          {aba === 'plano' ? <Plano dados={d} /> : null}
        </>
      ) : null}
    </div>
  )
}
