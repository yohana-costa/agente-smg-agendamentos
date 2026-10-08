import { useState } from 'react'
import { errorMessage, post } from '../../../lib/api'
import { ErrorBanner, Field, Modal } from '../../../components/ui'
import type { Cliente } from '../../../types'

export type ClienteCriado = Cliente & { jaExistia: boolean }

export default function NovoClienteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: ClienteCriado) => void }) {
  const [form, setForm] = useState({ nome: '', telefone: '', observacoes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function salvar() {
    if (!form.nome.trim()) return setError('Informe o nome.')
    const digitos = form.telefone.replace(/\D/g, '')
    if (!form.nome.trim()) return setError('Informe o nome do cliente.')
    if (digitos && digitos.length < 10) return setError('Informe o telefone com DDD (ou deixe em branco).')
    setSaving(true)
    setError('')
    try {
      const body: Record<string, string> = { nome: form.nome.trim(), telefone: form.telefone }
      if (form.observacoes.trim()) body.observacoes = form.observacoes.trim()
      const c = await post<ClienteCriado>('/clientes', body)
      onCreated(c)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Cadastrar cliente"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? 'Salvando...' : 'Cadastrar'}
          </button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          salvar()
        }}
      >
        <div className="banner info-banner">
          O cliente é identificado pelo telefone. Se o número já estiver cadastrado, o cadastro existente será usado e o nome atualizado. O telefone é
          opcional, mas sem ele o cliente não recebe lembretes nem mensagens no WhatsApp.
        </div>
        <Field label="Nome *">
          <input className="input" autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome do cliente" />
        </Field>
        <Field label="Telefone (WhatsApp)">
          <input className="input" inputMode="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="(11) 99999-9999" />
        </Field>
        <Field label="Observações">
          <textarea className="textarea" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Opcional" />
        </Field>
        <ErrorBanner message={error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
