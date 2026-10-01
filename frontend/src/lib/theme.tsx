// Temas do painel (mesmo modelo do Gestor SMG): classe `tema-*` no <html>, cores em index.css.
// A preferencia e por navegador (localStorage): duas pessoas da mesma empresa podem querer temas diferentes.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from './router'

export type Tema = 'escuro' | 'violeta' | 'claro'

export const TEMAS: { id: Tema; nome: string; descricao: string; escuro: boolean; amostra: string[] }[] = [
  { id: 'escuro', nome: 'Escuro', descricao: 'Escuro neutro com destaque azul. O padrão do sistema.', escuro: true, amostra: ['#12161f', '#0ea5e9', '#14b8a6'] },
  { id: 'violeta', nome: 'Violeta', descricao: 'Escuro com destaque roxo.', escuro: true, amostra: ['#140f1d', '#8b5cf6', '#d946ef'] },
  { id: 'claro', nome: 'Claro', descricao: 'Fundo claro, menu claro.', escuro: false, amostra: ['#f5f5f8', '#7c3aed', '#c026d3'] },
]

const CHAVE = 'app_tema'
const TEMA_PADRAO: Tema = 'escuro'

export function lerTemaSalvo(): Tema {
  try {
    const salvo = localStorage.getItem(CHAVE)
    return TEMAS.some((t) => t.id === salvo) ? (salvo as Tema) : TEMA_PADRAO
  } catch {
    return TEMA_PADRAO
  }
}

/** Troca o tema desligando as transicoes por um instante (evita cores presas no tema anterior). */
export function aplicarTema(tema: Tema) {
  const raiz = document.documentElement
  const config = TEMAS.find((t) => t.id === tema) ?? TEMAS[0]
  raiz.classList.add('trocando-tema')
  TEMAS.forEach((t) => raiz.classList.remove(`tema-${t.id}`))
  raiz.classList.add(`tema-${config.id}`)
  raiz.classList.toggle('dark', config.escuro)
  void raiz.offsetHeight
  window.setTimeout(() => raiz.classList.remove('trocando-tema'), 50)
}

interface ThemeState {
  tema: Tema
  definirTema: (t: Tema) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

/** Site publico, portal e checkout usam sempre o tema claro (com a cor do estabelecimento). */
export function rotaPublica(pathname: string) {
  return /^\/(s|pagamento)\//.test(pathname)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(lerTemaSalvo)
  const { pathname } = useLocation()
  const publica = rotaPublica(pathname)
  useEffect(() => aplicarTema(publica ? 'claro' : tema), [tema, publica])
  const definirTema = useCallback((t: Tema) => {
    try {
      localStorage.setItem(CHAVE, t)
    } catch {
      /* navegador sem storage: vale so nesta sessao */
    }
    setTema(t)
  }, [])
  return <ThemeContext.Provider value={{ tema, definirTema }}>{children}</ThemeContext.Provider>
}

export function useTema() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTema fora do ThemeProvider')
  return ctx
}
