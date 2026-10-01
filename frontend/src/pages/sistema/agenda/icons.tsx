// Icones pequenos (SVG inline) usados nos blocos da agenda.
import { SITUACAO_PAGAMENTO } from '../../../lib/format'

const svg = { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function PagamentoIcon({ situacao, comTexto = false }: { situacao: string; comTexto?: boolean }) {
  const label = SITUACAO_PAGAMENTO[situacao] || situacao
  let icon = null
  if (situacao === 'PAGO_ONLINE' || situacao === 'PAGO_LOCAL') {
    icon = (
      <svg {...svg}>
        <circle cx="8" cy="8" r="6.5" />
        <path d="M5 8.2l2 2 4-4.4" />
      </svg>
    )
  } else if (situacao === 'PAGAR_NO_LOCAL') {
    icon = (
      <svg {...svg}>
        <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
        <circle cx="8" cy="8" r="1.8" />
      </svg>
    )
  } else if (situacao === 'AGUARDANDO') {
    icon = (
      <svg {...svg}>
        <path d="M4 1.8h8M4 14.2h8M5 1.8c0 3.2 3 4.2 3 6.2s-3 3-3 6.2M11 1.8c0 3.2-3 4.2-3 6.2s3 3 3 6.2" />
      </svg>
    )
  } else {
    icon = (
      <svg {...svg}>
        <path d="M4 8h8" />
      </svg>
    )
  }
  return (
    <span className={`ag-pay ag-pay-${situacao}`} title={label}>
      {icon}
      {comTexto ? <span>{label}</span> : null}
    </span>
  )
}

export function GoogleIcon() {
  return (
    <span className="ag-g" title="Evento do Google Calendar">
      G
    </span>
  )
}

export function AlertIcon({ title }: { title?: string }) {
  return (
    <span className="ag-alert-icon" title={title}>
      <svg {...svg} width={12} height={12}>
        <path d="M8 1.8l6.5 12H1.5z" />
        <path d="M8 6.5v3.2M8 11.8v.1" />
      </svg>
    </span>
  )
}

export function LockIcon() {
  return (
    <svg {...svg} width={11} height={11}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </svg>
  )
}

export function RepeatIcon() {
  return (
    <svg {...svg} width={11} height={11}>
      <path d="M2.5 7a5 5 0 018.6-3.4L13 5.5M13 2v3.5H9.5M13.5 9a5 5 0 01-8.6 3.4L3 10.5M3 14v-3.5h3.5" />
    </svg>
  )
}
