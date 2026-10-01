import { useState, type ReactNode } from 'react'
import './agentes.css'

export async function copiarTexto(texto: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    // cai no fallback abaixo
  }
  try {
    const el = document.createElement('textarea')
    el.value = texto
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

/** Campo somente leitura com botao de copiar (URLs de webhook, link do site). */
export function CopyField({ value, extra }: { value: string; extra?: ReactNode }) {
  const [estado, setEstado] = useState<'idle' | 'ok' | 'erro'>('idle')
  return (
    <div className="ia-copy">
      <input className="input mono" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className={`btn ${estado === 'ok' ? 'btn-primary' : ''}`}
        onClick={async () => {
          const ok = await copiarTexto(value)
          setEstado(ok ? 'ok' : 'erro')
          setTimeout(() => setEstado('idle'), 1800)
        }}
      >
        {estado === 'ok' ? '✓ Copiado' : estado === 'erro' ? 'Falhou' : 'Copiar'}
      </button>
      {extra}
    </div>
  )
}
