import { useState } from 'react'
import { ApiError, get } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { Link, useQueryParam } from '../../lib/router'
import { PbLogo, PbShell, PbSpinner } from './shared/components'
import type { SitePublico } from './shared/types'
import BookingWizard from './site/BookingWizard'
import Loja from './site/Loja'

type Aba = 'servicos' | 'produtos'

/** Site publico do estabelecimento (/s/:slug): agendamento sem conta e compra de produtos. */
export default function Site({ slug }: { slug: string }) {
  const abaQ = useQueryParam('aba')
  const [aba, setAba] = useState<Aba>(abaQ === 'produtos' ? 'produtos' : 'servicos')
  const { data: site, loading, error } = useAsync(
    () =>
      get<SitePublico>(`/publico/${slug}`, undefined, { publico: true }).catch((e) => {
        if (e instanceof ApiError && e.status === 404) throw new Error('Não encontramos este estabelecimento. Confira o link recebido.')
        throw e
      }),
    [slug]
  )

  if (loading && !site) {
    return (
      <PbShell>
        <PbSpinner />
      </PbShell>
    )
  }
  if (error || !site) {
    return (
      <PbShell>
        <div className="pb-center-page">
          <div className="pb-card pb-empty">
            <div className="pb-empty-icon">🔎</div>
            {error || 'Não foi possível carregar a página.'}
          </div>
        </div>
      </PbShell>
    )
  }

  const est = site.estabelecimento
  const mostrarProdutos = site.venderProdutos
  const abaAtual: Aba = mostrarProdutos ? aba : 'servicos'

  return (
    <PbShell cor={est.corPrimaria} titulo={est.titulo}>
      <div className="pb-cover" style={est.bannerUrl ? { backgroundImage: `url("${est.bannerUrl}")` } : undefined}>
        <div className="pb-cover-actions">
          <Link to={`/s/${slug}/portal`} className="pb-glass-btn">
            <span aria-hidden>👤</span> Minha conta
          </Link>
        </div>
      </div>

      <header className="pb-profile">
        <PbLogo url={est.logoUrl} nome={est.titulo || est.nome} size="lg" />
        <h1 className="pb-title">{est.titulo || est.nome}</h1>
        {est.descricao ? <p className="pb-desc">{est.descricao}</p> : null}
        {est.endereco ? (
          <p className="pb-address">
            <span aria-hidden>📍</span>
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(est.endereco)}`} target="_blank" rel="noreferrer">
              {est.endereco}
            </a>
          </p>
        ) : null}
      </header>

      <main className="public-container pb-main">
        {mostrarProdutos ? (
          <div className="pb-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={abaAtual === 'servicos'} className={`pb-tab ${abaAtual === 'servicos' ? 'active' : ''}`} onClick={() => setAba('servicos')}>
              Serviços
            </button>
            <button type="button" role="tab" aria-selected={abaAtual === 'produtos'} className={`pb-tab ${abaAtual === 'produtos' ? 'active' : ''}`} onClick={() => setAba('produtos')}>
              Produtos
            </button>
          </div>
        ) : null}

        {/* as duas abas ficam montadas para nao perder o que o cliente ja escolheu */}
        <div hidden={abaAtual !== 'servicos'}>
          <BookingWizard slug={slug} site={site} />
        </div>
        {mostrarProdutos ? (
          <div hidden={abaAtual !== 'produtos'}>
            <Loja slug={slug} site={site} />
          </div>
        ) : null}
      </main>

      <footer className="pb-footer">
        {est.nome}
        {est.endereco ? ` · ${est.endereco}` : ''}
      </footer>
    </PbShell>
  )
}
