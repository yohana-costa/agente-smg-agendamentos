// Meu perfil: aparencia (SeletorTema do Gestor SMG), alterar senha e sair.
import { useState, type FormEvent } from 'react'
import { Check, LogOut, Palette } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { TEMAS, useTema } from '../lib/theme'
import { errorMessage, post } from '../lib/api'
import { cn } from '../lib/utils'
import { ErrorBanner, Field, Modal, SuccessBanner } from '../components/ui'

const PERFIL_LABEL = { DONO: 'Dono', RECEPCAO: 'Recepção', PROFISSIONAL: 'Profissional' }

export default function PerfilModal({ onClose }: { onClose: () => void }) {
  const { usuario, logout } = useAuth()
  const { tema, definirTema } = useTema()
  const [senhaAtual, setSenhaAtual] = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  async function alterarSenha(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setOk('')
    setSalvando(true)
    try {
      await post('/auth/senha', { senhaAtual, novaSenha })
      setOk('Senha alterada.')
      setSenhaAtual('')
      setNovaSenha('')
    } catch (err) {
      setErro(errorMessage(err))
    } finally {
      setSalvando(false)
    }
  }

  if (!usuario) return null

  return (
    <Modal
      title="Meu perfil"
      onClose={onClose}
      size="lg"
      footer={
        <button className="btn btn-danger" onClick={logout}>
          <LogOut /> Sair da conta
        </button>
      }
    >
      <div className="stack" style={{ gap: 20 }}>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full gradient-primary text-base font-bold text-white">
            {usuario.nome
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <p className="font-semibold">{usuario.nome}</p>
            <p className="text-sm text-muted-foreground">
              {usuario.email} · {PERFIL_LABEL[usuario.perfil]} · {usuario.tenant.nome}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-1 flex items-center gap-2 font-semibold">
            <Palette className="h-4 w-4 text-primary" /> Aparência
          </p>
          <p className="mb-3 text-sm text-muted-foreground">Escolha o tema do painel. A preferência vale só para você, neste navegador.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {TEMAS.map((opcao) => {
              const ativo = tema === opcao.id
              return (
                <button
                  key={opcao.id}
                  type="button"
                  onClick={() => definirTema(opcao.id)}
                  aria-pressed={ativo}
                  className={cn(
                    'group relative rounded-xl border p-3 text-left transition-all',
                    ativo ? 'border-primary shadow-glow' : 'border-border hover:-translate-y-0.5 hover:border-primary/40'
                  )}
                >
                  <div className="mb-3 flex h-16 items-end gap-1.5 rounded-lg p-2" style={{ backgroundColor: opcao.amostra[0] }}>
                    <span className="h-6 flex-1 rounded" style={{ backgroundColor: opcao.amostra[1] }} />
                    <span className="h-4 w-4 rounded" style={{ backgroundColor: opcao.amostra[2] }} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{opcao.nome}</span>
                    {ativo ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full gradient-primary text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{opcao.descricao}</p>
                </button>
              )
            })}
          </div>
        </div>

        <form onSubmit={alterarSenha} className="stack">
          <p className="font-semibold">Alterar senha</p>
          <div className="form-grid">
            <Field label="Senha atual">
              <input className="input" type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} required />
            </Field>
            <Field label="Nova senha" hint="Mínimo de 6 caracteres">
              <input className="input" type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} required minLength={6} />
            </Field>
          </div>
          <ErrorBanner message={erro} />
          <SuccessBanner message={ok} />
          <div>
            <button className="btn" disabled={salvando}>
              {salvando ? 'Salvando...' : 'Alterar senha'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
