// Roteador minimo baseado em history API (o Gestor SMG varejo nao usa biblioteca de rotas).
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react'

const EVENT = 'smg:navigate'

export function navigate(to: string, { replace = false } = {}) {
  if (replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.dispatchEvent(new Event(EVENT))
  window.scrollTo(0, 0)
}

export function useLocation() {
  const read = () => ({ pathname: window.location.pathname, search: window.location.search })
  const [loc, setLoc] = useState(read)
  useEffect(() => {
    const update = () => setLoc(read())
    window.addEventListener('popstate', update)
    window.addEventListener(EVENT, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener(EVENT, update)
    }
  }, [])
  return loc
}

export function useQueryParam(name: string) {
  const { search } = useLocation()
  return new URLSearchParams(search).get(name)
}

/** Casa um padrao como "/s/:slug/portal" com o pathname. Retorna params ou null. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean)
  const a = pathname.split('/').filter(Boolean)
  if (p.length !== a.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i])
    else if (p[i] !== a[i]) return null
  }
  return params
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
      {...rest}
    />
  )
}
