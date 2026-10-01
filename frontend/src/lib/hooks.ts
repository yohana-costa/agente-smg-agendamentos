import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE, errorMessage, getToken } from './api'

/**
 * Carrega dados com estados de loading/erro (padrao loading/error/message do Gestor SMG varejo).
 * `deps` dispara recarga; `reload()` forca recarga manual.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let ativo = true
    setLoading(true)
    setError('')
    fnRef
      .current()
      .then((d) => ativo && setData(d))
      .catch((e) => ativo && setError(errorMessage(e)))
      .finally(() => ativo && setLoading(false))
    return () => {
      ativo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, setData, loading, error, reload }
}

/**
 * Assina o stream SSE do estabelecimento (/api/eventos/stream).
 * Tipos: agenda.atualizada, pagamento.aprovado, conversa.mensagem, conversa.status, vendas.atualizada, catalogo.atualizado
 */
export function useEventStream(tipos: string[], onEvent: (tipo: string, payload: any) => void) {
  const cb = useRef(onEvent)
  cb.current = onEvent
  const key = tipos.join(',')
  useEffect(() => {
    const token = getToken()
    if (!token) return
    const es = new EventSource(`${API_BASE}/eventos/stream?token=${encodeURIComponent(token)}`)
    const handlers = key.split(',').map((tipo) => {
      const h = (e: MessageEvent) => {
        try {
          cb.current(tipo, JSON.parse(e.data)?.payload)
        } catch {
          cb.current(tipo, null)
        }
      }
      es.addEventListener(tipo, h as EventListener)
      return [tipo, h] as const
    })
    return () => {
      handlers.forEach(([tipo, h]) => es.removeEventListener(tipo, h as EventListener))
      es.close()
    }
  }, [key])
}

/** Contador regressivo em segundos (reserva aguardando pagamento, retorno do agente). */
export function useCountdown(initialSeconds: number | null | undefined) {
  const [seconds, setSeconds] = useState<number | null>(initialSeconds ?? null)
  useEffect(() => setSeconds(initialSeconds ?? null), [initialSeconds])
  useEffect(() => {
    if (seconds === null || seconds <= 0) return
    const t = setTimeout(() => setSeconds((s) => (s === null ? null : Math.max(0, s - 1))), 1000)
    return () => clearTimeout(t)
  }, [seconds])
  return seconds
}

/** Debounce simples para campos de busca. */
export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
