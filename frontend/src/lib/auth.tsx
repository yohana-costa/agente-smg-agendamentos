import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from './api'
import type { Aba, UsuarioSessao } from '../types'

interface AuthState {
  usuario: UsuarioSessao | null
  carregando: boolean
  login: (email: string, senha: string) => Promise<void>
  registrar: (body: Record<string, unknown>) => Promise<void>
  logout: () => void
  recarregar: () => Promise<void>
  podeVer: (aba: Aba) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null)
  const [carregando, setCarregando] = useState(true)

  const logout = useCallback(() => {
    setToken(null)
    setUsuario(null)
  }, [])

  const recarregar = useCallback(async () => {
    if (!getToken()) {
      setUsuario(null)
      setCarregando(false)
      return
    }
    try {
      setUsuario(await api<UsuarioSessao>('/auth/me'))
    } catch {
      setToken(null)
      setUsuario(null)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    recarregar()
  }, [logout, recarregar])

  const login = useCallback(async (email: string, senha: string) => {
    const r = await api<{ token: string; usuario: UsuarioSessao }>('/auth/login', { method: 'POST', body: { email, senha }, publico: true })
    setToken(r.token)
    setUsuario(r.usuario)
  }, [])

  const registrar = useCallback(async (body: Record<string, unknown>) => {
    const r = await api<{ token: string; usuario: UsuarioSessao }>('/auth/registrar', { method: 'POST', body, publico: true })
    setToken(r.token)
    setUsuario(r.usuario)
  }, [])

  const podeVer = useCallback((aba: Aba) => Boolean(usuario?.permissoes.abas.includes(aba)), [usuario])

  const value = useMemo(() => ({ usuario, carregando, login, registrar, logout, recarregar, podeVer }), [usuario, carregando, login, registrar, logout, recarregar, podeVer])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
