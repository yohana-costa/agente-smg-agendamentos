import { useState } from 'react'
import { errorMessage, get, post } from '../../../lib/api'
import { phone } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { ErrorBanner, Field, Loading, Modal } from '../../../components/ui'
import type { Servico } from '../../../types'
import { CorPicker, Credenciais, ServicosCheckboxes } from './campos'
import { CORES, type Convite, type ProfissionalBase } from './tipos'

export default function AdicionarProfissionalModal({
  totalAtual,
  onClose,
  onCreated,
  onOpen,
}: {
  totalAtual: number
  onClose: () => void
  onCreated: () => void
  onOpen: (id: string) => void
}) {
  const servicos = useAsync(() => get<Servico[]>('/servicos'), [])
  const [form, setForm] = useState({ nome: '', telefone: '', email: '', cor: CORES[totalAtual % CORES.length], servicoIds: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState<{ profissional: ProfissionalBase; convite: Convite | null } | null>(null)

  async function salvar() {
    if (!form.nome.trim()) return setError('Informe o nome do profissional.')
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('E-mail inválido.')
    setSaving(true)
    setError('')
    try {
      const r = await post<{ profissional: ProfissionalBase; convite: Convite | null }>('/equipe', {
        nome: form.nome.trim(),
        telefone: form.telefone,
        email: form.email.trim(),
        cor: form.cor,
        servicoIds: form.servicoIds,
      })
      setResultado(r)
      onCreated()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (resultado) {
    const { profissional, convite } = resultado
    return (
      <Modal
        title="Profissional adicionado"
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={onClose}>
              Concluir
            </button>
            <button className="btn btn-primary" onClick={() => onOpen(profissional.id)}>
              Abrir ficha e configurar jornada
            </button>
          </>
        }
      >
        <div className="stack">
          <div className="banner success-banner">
            <strong>{profissional.nome}</strong>&nbsp;foi adicionado(a) à equipe. A jornada inicial segue o horário de funcionamento do estabelecimento.
          </div>
          {convite ? (
            <>
              <div className="strong">Convite de acesso</div>
              <Credenciais convite={convite} />
              {convite.enviadoWhatsApp ? (
                <div className="banner info-banner">O convite com os dados de acesso foi enviado por WhatsApp para {phone(profissional.telefone)}.</div>
              ) : (
                <div className="banner warning-banner">
                  {profissional.telefone
                    ? 'Não foi possível enviar o convite por WhatsApp. Repasse os dados de acesso acima ao profissional.'
                    : 'Sem telefone cadastrado, o convite não foi enviado por WhatsApp. Repasse os dados de acesso acima ao profissional.'}
                </div>
              )}
            </>
          ) : (
            <div className="banner warning-banner">
              Nenhum e-mail foi informado, então nenhum login foi criado. Você pode criar o acesso depois, na ficha do profissional (aba Acesso e Google).
            </div>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Adicionar profissional"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={salvar} disabled={saving}>
            {saving ? 'Adicionando...' : 'Adicionar e enviar convite'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Nome *" className="full">
            <input className="input" autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome do profissional" />
          </Field>
          <Field label="Telefone (WhatsApp)" hint="O convite de acesso é enviado por WhatsApp.">
            <input className="input" inputMode="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="(11) 99999-9999" />
          </Field>
          <Field label="E-mail (login)" hint="Necessário para criar o login próprio.">
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nome@exemplo.com" />
          </Field>
          <Field label="Cor na agenda" className="full">
            <CorPicker value={form.cor} onChange={(cor) => setForm({ ...form, cor })} />
          </Field>
        </div>
        <Field label="Serviços que realiza">
          {servicos.loading ? (
            <Loading />
          ) : servicos.error ? (
            <ErrorBanner message={servicos.error} />
          ) : (
            <ServicosCheckboxes servicos={servicos.data || []} selecionados={form.servicoIds} onChange={(servicoIds) => setForm({ ...form, servicoIds })} />
          )}
        </Field>
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}
