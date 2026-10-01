import { useState } from 'react'
import { duration } from '../../../lib/format'
import { Empty } from '../../../components/ui'
import type { Servico } from '../../../types'
import { CORES, type Convite } from './tipos'

export function CorPicker({ value, onChange, disabled }: { value: string; onChange: (cor: string) => void; disabled?: boolean }) {
  return (
    <div className="eq-colors">
      {CORES.map((c) => (
        <button
          key={c}
          type="button"
          className={`eq-swatch ${value.toLowerCase() === c ? 'active' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          disabled={disabled}
          aria-label={`Cor ${c}`}
        />
      ))}
      <input type="color" className="eq-color-input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} title="Outra cor" />
    </div>
  )
}

export function ServicosCheckboxes({
  servicos,
  selecionados,
  onChange,
  disabled,
}: {
  servicos: Servico[]
  selecionados: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  if (!servicos.length) return <Empty icon="✂️">Nenhum serviço cadastrado ainda.</Empty>
  const grupos = new Map<string, Servico[]>()
  for (const s of servicos) {
    const k = s.categoria || 'Sem categoria'
    grupos.set(k, [...(grupos.get(k) || []), s])
  }
  const set = new Set(selecionados)
  const toggle = (id: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(id)
    else next.delete(id)
    onChange([...next])
  }
  const todos = servicos.every((s) => set.has(s.id))
  return (
    <div className="stack-sm">
      <div className="row-between small">
        <span className="muted">{selecionados.length} de {servicos.length} selecionado(s)</span>
        {!disabled ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(todos ? [] : servicos.map((s) => s.id))}>
            {todos ? 'Desmarcar todos' : 'Marcar todos'}
          </button>
        ) : null}
      </div>
      <div className="eq-servicos">
        {[...grupos.entries()].map(([cat, lista]) => (
          <div key={cat} style={{ display: 'contents' }}>
            {grupos.size > 1 ? <div className="eq-servicos-cat">{cat}</div> : null}
            {lista.map((s) => (
              <label key={s.id} className="checkbox">
                <input type="checkbox" checked={set.has(s.id)} disabled={disabled} onChange={(e) => toggle(s.id, e.target.checked)} />
                <span>
                  {s.nome}
                  <span className="muted small"> · {duration(s.duracaoMin)}</span>
                  {!s.ativo ? <span className="badge badge-gray" style={{ marginLeft: 6 }}>Inativo</span> : null}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setOk(true)
          setTimeout(() => setOk(false), 1500)
        } catch {
          /* clipboard indisponível */
        }
      }}
    >
      {ok ? 'Copiado ✓' : 'Copiar'}
    </button>
  )
}

/** Exibe as credenciais de acesso geradas (convite / nova senha temporária). */
export function Credenciais({ convite }: { convite: Convite }) {
  const tudo = `Acesso ao Gestor SMG Agendamentos\nLogin: ${window.location.origin}/login\nE-mail: ${convite.email}\nSenha temporária: ${convite.senhaTemporaria}`
  return (
    <div className="stack">
      <div className="eq-cred">
        <span className="eq-cred-label">E-mail de login</span>
        <span className="eq-cred-value">{convite.email}</span>
        <CopyButton text={convite.email} />
        <span className="eq-cred-label">Senha temporária</span>
        <span className="eq-cred-value">{convite.senhaTemporaria}</span>
        <CopyButton text={convite.senhaTemporaria} />
      </div>
      <div className="row-between">
        <span className="small muted">Guarde ou envie agora: esta senha não será exibida novamente.</span>
        <CopyButton text={tudo} />
      </div>
    </div>
  )
}
