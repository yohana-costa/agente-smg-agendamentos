import { useMemo, useState } from 'react'
import { phone } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { navigate } from '../../../lib/router'
import { PbAlert, PbSpinner } from '../shared/components'
import type { PortalMe } from '../shared/types'
import { primeiroNome } from '../shared/utils'
import { criarPortalClient } from './client'
import MeusAgendamentos from './MeusAgendamentos'
import { Historico, Perfil, Pontos } from './OutrasAreas'

type Area = 'agendamentos' | 'historico' | 'pontos' | 'perfil'

/** Portal logado: agendamentos, historico, pontos (se fidelidade ativa) e perfil. */
export default function AreaCliente({ slug, token, fidelidadeAtiva, onSair }: { slug: string; token: string; fidelidadeAtiva: boolean; onSair: () => void }) {
  const client = useMemo(() => criarPortalClient(token, onSair), [token, onSair])
  const { data: me, setData: setMe, loading, error } = useAsync(() => client.get<PortalMe>('/me'), [client])
  const [area, setArea] = useState<Area>('agendamentos')

  if (loading && !me) return <PbSpinner />
  if (error && !me) {
    return (
      <div className="pb-auth">
        <PbAlert tipo="erro">{error}</PbAlert>
      </div>
    )
  }
  if (!me) return null

  const comPontos = fidelidadeAtiva || me.estabelecimento.fidelidadeAtiva
  const areas: Array<{ key: Area; label: string }> = [
    { key: 'agendamentos', label: 'Meus agendamentos' },
    { key: 'historico', label: 'Histórico' },
    ...(comPontos ? [{ key: 'pontos' as Area, label: 'Pontos e recompensas' }] : []),
    { key: 'perfil', label: 'Perfil' },
  ]

  return (
    <div className="public-container pb-portal">
      <div className="pb-welcome">
        <div>
          <div className="pb-welcome-hello">Olá, {primeiroNome(me.cliente.nome)}! 👋</div>
          <div className="small muted">{phone(me.cliente.telefone)}</div>
        </div>
        <button type="button" className="btn btn-primary btn-lg pb-new-btn" onClick={() => navigate(`/s/${slug}`)}>
          + Novo agendamento
        </button>
      </div>

      <nav className="pb-nav" aria-label="Áreas do portal">
        {areas.map((a) => (
          <button key={a.key} type="button" className={area === a.key ? 'active' : ''} onClick={() => setArea(a.key)} aria-current={area === a.key ? 'page' : undefined}>
            {a.label}
            {a.key === 'pontos' && me.cliente.pontos ? <span className="pb-nav-count">{me.cliente.pontos}</span> : null}
          </button>
        ))}
      </nav>

      <div className="pb-portal-body">
        {area === 'agendamentos' ? <MeusAgendamentos client={client} slug={slug} /> : null}
        {area === 'historico' ? <Historico client={client} /> : null}
        {area === 'pontos' && comPontos ? <Pontos client={client} /> : null}
        {area === 'perfil' ? <Perfil client={client} me={me} onAtualizado={(c) => setMe({ ...me, cliente: { ...me.cliente, ...c } })} /> : null}
      </div>
    </div>
  )
}
