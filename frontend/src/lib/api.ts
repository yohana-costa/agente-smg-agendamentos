// Cliente HTTP. Todas as respostas seguem { success, data } / { success: false, error, details }.
export const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

const TOKEN_KEY = 'smg-ag-token'
const PORTAL_TOKEN_KEY = 'smg-ag-portal-token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}
export function getPortalToken(slug: string) {
  return localStorage.getItem(`${PORTAL_TOKEN_KEY}:${slug}`) || ''
}
export function setPortalToken(slug: string, token: string | null) {
  if (token) localStorage.setItem(`${PORTAL_TOKEN_KEY}:${slug}`, token)
  else localStorage.removeItem(`${PORTAL_TOKEN_KEY}:${slug}`)
}

export class ApiError extends Error {
  status: number
  details: any
  constructor(message: string, status: number, details?: any) {
    super(message)
    this.status = status
    this.details = details
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface RequestOptions {
  method?: Method
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  /** token alternativo (ex.: portal do cliente). Por padrao usa o token do sistema. */
  token?: string
  /** nao enviar token */
  publico?: boolean
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export function buildQuery(query?: RequestOptions['query']) {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export async function api<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = options.publico ? '' : options.token ?? getToken()
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${API_BASE}${path}${buildQuery(options.query)}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  let payload: any = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok || payload?.success === false) {
    if (response.status === 401 && !options.publico && !options.token && onUnauthorized) onUnauthorized()
    throw new ApiError(payload?.error || `Falha na requisicao (${response.status})`, response.status, payload?.details)
  }
  return payload?.data as T
}

export const get = <T = any>(path: string, query?: RequestOptions['query'], opts: RequestOptions = {}) => api<T>(path, { ...opts, query })
export const post = <T = any>(path: string, body?: unknown, opts: RequestOptions = {}) => api<T>(path, { ...opts, method: 'POST', body: body ?? {} })
export const patch = <T = any>(path: string, body?: unknown, opts: RequestOptions = {}) => api<T>(path, { ...opts, method: 'PATCH', body: body ?? {} })
export const put = <T = any>(path: string, body?: unknown, opts: RequestOptions = {}) => api<T>(path, { ...opts, method: 'PUT', body: body ?? {} })
export const del = <T = any>(path: string, query?: RequestOptions['query'], opts: RequestOptions = {}) => api<T>(path, { ...opts, method: 'DELETE', query })

export function errorMessage(err: unknown, fallback = 'Algo deu errado.') {
  return err instanceof Error ? err.message : fallback
}
