import { ApiError, get, patch, post, type RequestOptions } from '../../../lib/api'

export interface PortalClient {
  get: <T = any>(path: string, query?: RequestOptions['query']) => Promise<T>
  post: <T = any>(path: string, body?: unknown) => Promise<T>
  patch: <T = any>(path: string, body?: unknown) => Promise<T>
}

/** Chamadas autenticadas do portal (/api/portal/*). Em 401 a sessao do cliente e encerrada. */
export function criarPortalClient(token: string, onExpirou: () => void): PortalClient {
  async function wrap<T>(p: Promise<T>): Promise<T> {
    try {
      return await p
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpirou()
      throw e
    }
  }
  return {
    get: <T = any>(path: string, query?: RequestOptions['query']) => wrap(get<T>(`/portal${path}`, query, { token })),
    post: <T = any>(path: string, body?: unknown) => wrap(post<T>(`/portal${path}`, body, { token })),
    patch: <T = any>(path: string, body?: unknown) => wrap(patch<T>(`/portal${path}`, body, { token })),
  }
}
