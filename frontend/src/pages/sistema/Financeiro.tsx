import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { PageHeader, PeriodFilter, periodoMesAtual, Tabs, type Periodo } from '../../components/ui'
import Recebimentos from './financeiro/Recebimentos'
import Reembolsos from './financeiro/Reembolsos'
import Despesas from './financeiro/Despesas'
import Comissoes from './financeiro/Comissoes'
import Resultado from './financeiro/Resultado'
import './financeiro/financeiro.css'

type Aba = 'recebimentos' | 'reembolsos' | 'despesas' | 'comissoes' | 'resultado'

export default function Financeiro() {
  const { usuario } = useAuth()
  const completo = usuario?.perfil === 'DONO' || Boolean(usuario?.permissoes.financeiroCompleto)
  const [periodo, setPeriodo] = useState<Periodo>(periodoMesAtual())
  const [aba, setAba] = useState<Aba>('recebimentos')

  const tabs: Array<{ key: Aba; label: string }> = completo
    ? [
        { key: 'recebimentos', label: 'Recebimentos' },
        { key: 'reembolsos', label: 'Reembolsos' },
        { key: 'despesas', label: 'Despesas' },
        { key: 'comissoes', label: 'Comissões' },
        { key: 'resultado', label: 'Resultado do período' },
      ]
    : [{ key: 'recebimentos', label: 'Recebimentos' }]
  const atual: Aba = completo ? aba : 'recebimentos'

  return (
    <div>
      <PageHeader title="Financeiro" subtitle={completo ? 'Tudo o que entrou, saiu e sobrou no período.' : 'Recebimentos de serviços e produtos.'} />
      <div className="fi-filtros">
        <PeriodFilter value={periodo} onChange={setPeriodo} />
      </div>
      {tabs.length > 1 ? <Tabs<Aba> tabs={tabs} value={atual} onChange={setAba} /> : null}
      {atual === 'recebimentos' ? <Recebimentos periodo={periodo} /> : null}
      {atual === 'reembolsos' ? <Reembolsos periodo={periodo} /> : null}
      {atual === 'despesas' ? <Despesas periodo={periodo} /> : null}
      {atual === 'comissoes' ? <Comissoes periodo={periodo} /> : null}
      {atual === 'resultado' ? <Resultado periodo={periodo} /> : null}
    </div>
  )
}
