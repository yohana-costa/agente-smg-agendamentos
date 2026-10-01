import { useEffect, useState } from 'react'
import { errorMessage, get } from '../../../lib/api'
import { phone } from '../../../lib/format'
import { useDebounced } from '../../../lib/hooks'
import type { ClienteRef } from './types'
import './fidelidade.css'

/** Busca de cliente por nome ou telefone (GET /clientes?busca=). */
export function ClienteBusca({ value, onChange }: { value: ClienteRef | null; onChange: (c: ClienteRef | null) => void }) {
  const [busca, setBusca] = useState('')
  const termo = useDebounced(busca.trim(), 300)
  const [resultados, setResultados] = useState<ClienteRef[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (termo.length < 2) {
      setResultados([])
      return
    }
    let ativo = true
    setCarregando(true)
    setErro('')
    get<{ clientes: ClienteRef[] }>('/clientes', { busca: termo })
      .then((r) => ativo && setResultados((r?.clientes || []).slice(0, 8)))
      .catch((e) => ativo && setErro(errorMessage(e)))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [termo])

  if (value) {
    return (
      <div className="fd-cliente-sel">
        <div>
          <div className="strong">{value.nome}</div>
          <div className="small muted">{phone(value.telefone)}</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => onChange(null)}>
          Trocar
        </button>
      </div>
    )
  }

  return (
    <div className="fd-busca">
      <input className="input" placeholder="Digite nome ou telefone do cliente" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
      {termo.length >= 2 ? (
        <div className="fd-busca-results">
          {carregando ? <div className="fd-busca-item muted">Buscando...</div> : null}
          {erro ? <div className="fd-busca-item danger-text">{erro}</div> : null}
          {!carregando && !erro && resultados.length === 0 ? <div className="fd-busca-item muted">Nenhum cliente encontrado.</div> : null}
          {resultados.map((c) => (
            <button
              key={c.id}
              type="button"
              className="fd-busca-item clickable"
              onClick={() => {
                onChange({ id: c.id, nome: c.nome, telefone: c.telefone })
                setBusca('')
              }}
            >
              <span className="strong">{c.nome}</span>
              <span className="small muted">{phone(c.telefone)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
