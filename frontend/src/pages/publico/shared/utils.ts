import type { CSSProperties } from 'react'

const COR_PADRAO = '#007f64'

export function normalizarCor(cor?: string | null) {
  const c = String(cor || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    return `#${c
      .slice(1)
      .split('')
      .map((x) => x + x)
      .join('')}`
  }
  return COR_PADRAO
}

/** Cor de texto legivel sobre a cor primaria do estabelecimento. */
export function corSobre(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminancia > 0.64 ? '#111827' : '#ffffff'
}

export function temaEstilo(cor?: string | null): CSSProperties {
  const hex = normalizarCor(cor)
  return { '--pb-primary': hex, '--pb-on-primary': corSobre(hex) } as CSSProperties
}

/** Mascara de telefone brasileiro enquanto digita: (11) 98765-4321 */
export function mascaraTelefone(valor: string) {
  let d = String(valor || '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length > 11) d = d.slice(2)
  d = d.slice(0, 11)
  if (!d.length) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function digitosTelefone(valor: string) {
  return String(valor || '').replace(/\D/g, '')
}

export function telefoneValido(valor: string) {
  const d = digitosTelefone(valor)
  return d.length === 10 || d.length === 11
}

/** Caminho interno do checkout a partir do id ou do link absoluto de pagamento. */
export function caminhoCheckout(link?: string | null, pagamentoId?: string | null) {
  if (pagamentoId) return `/pagamento/${pagamentoId}`
  const m = String(link || '').match(/\/pagamento\/([^/?#]+)/)
  return m ? `/pagamento/${m[1]}` : null
}

export function iniciais(nome: string) {
  const partes = String(nome || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!partes.length) return '?'
  const a = partes[0][0] || ''
  const b = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (a + b).toUpperCase()
}

export function primeiroNome(nome?: string | null) {
  return String(nome || '').trim().split(/\s+/)[0] || ''
}

export function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`
}

export function periodoDoHorario(hora: string) {
  const h = Number(hora.slice(0, 2))
  if (h < 12) return 'Manhã'
  if (h < 18) return 'Tarde'
  return 'Noite'
}

export async function copiarTexto(texto: string) {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = texto
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(el)
    return ok
  }
}

export function srcQrCode(base64: string) {
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`
}
