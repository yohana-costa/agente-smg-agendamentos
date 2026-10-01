import { useCallback, useState } from 'react'
import { get, getPortalToken, setPortalToken } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { Link, useQueryParam } from '../../lib/router'
import { PbShell, PbSpinner, PbTopbar } from './shared/components'
import type { SitePublico } from './shared/types'
import Acesso from './portal/Acesso'
import AreaCliente from './portal/AreaCliente'

/** Portal do cliente (/s/:slug/portal). Unico lugar onde o cliente ve o proprio historico. */
export default function Portal({ slug }: { slug: string }) {
  const cadastro = useQueryParam('cadastro')
  const [token, setToken] = useState(() => getPortalToken(slug))
  const site = useAsync(() => get<SitePublico>(`/publico/${slug}`, undefined, { publico: true }), [slug])

  const entrar = useCallback(
    (t: string) => {
      setPortalToken(slug, t)
      setToken(t)
      window.scrollTo(0, 0)
    },
    [slug]
  )
  const sair = useCallback(() => {
    setPortalToken(slug, null)
    setToken('')
  }, [slug])

  if (site.loading && !site.data) {
    return (
      <PbShell>
        <PbSpinner />
      </PbShell>
    )
  }
  if (!site.data) {
    return (
      <PbShell>
        <div className="pb-center-page">
          <div className="pb-card pb-empty">
            <div className="pb-empty-icon">🔎</div>
            {site.error || 'Não foi possível carregar a página.'}
          </div>
        </div>
      </PbShell>
    )
  }

  const est = site.data.estabelecimento
  const nome = est.titulo || est.nome

  return (
    <PbShell cor={est.corPrimaria} titulo={`Minha conta · ${nome}`}>
      <PbTopbar nome={nome} logoUrl={est.logoUrl} href={`/s/${slug}`}>
        {token ? (
          <button type="button" className="btn btn-ghost" onClick={sair}>
            Sair
          </button>
        ) : (
          <Link className="btn btn-ghost" to={`/s/${slug}`}>
            Agendar
          </Link>
        )}
      </PbTopbar>

      {token ? (
        <AreaCliente slug={slug} token={token} fidelidadeAtiva={site.data.fidelidadeAtiva} onSair={sair} />
      ) : (
        <Acesso slug={slug} nomeEstabelecimento={nome} abaInicial={cadastro === '1' ? 'criar' : 'entrar'} onLogin={entrar} />
      )}
    </PbShell>
  )
}
