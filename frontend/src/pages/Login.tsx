import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { Link } from '../lib/router'
import { ErrorBanner, Field } from '../components/ui'

export function AuthHero() {
  return (
    <div className="auth-hero">
      <div>
        <div className="brand-kicker">Gestor SMG</div>
        <h1>Agendamentos</h1>
        <p style={{ marginTop: 12, color: '#cfe6de', maxWidth: 420 }}>Para qualquer negócio que vive de atendimento com hora marcada.</p>
      </div>
      <ul>
        <li>Agenda com capacidade real de cada profissional</li>
        <li>Pagamento antecipado para reduzir no-show</li>
        <li>Site de agendamento e portal do cliente</li>
        <li>Agentes de IA no WhatsApp: atendimento e gestão</li>
      </ul>
      <div className="small" style={{ color: '#a9c9bf' }}>SMG Company</div>
    </div>
  )
}

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await login(email, senha)
    } catch (err) {
      setErro(errorMessage(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="auth-page">
      <AuthHero />
      <div className="auth-form-wrap">
        <form className="card auth-card stack" onSubmit={onSubmit}>
          <div>
            <h2>Entrar</h2>
            <p className="muted">Acesse com o seu login (dono, recepção ou profissional).</p>
          </div>
          <ErrorBanner message={erro} />
          <Field label="E-mail">
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Senha">
            <input className="input" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </Field>
          <button className="btn btn-primary btn-lg btn-block" disabled={enviando}>
            {enviando ? 'Entrando...' : 'Entrar'}
          </button>
          <p className="muted center small">
            Novo por aqui? <Link to="/cadastro">Cadastre seu estabelecimento</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
