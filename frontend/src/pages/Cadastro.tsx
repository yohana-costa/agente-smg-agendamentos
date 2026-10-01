import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { Link } from '../lib/router'
import { ErrorBanner, Field } from '../components/ui'
import { AuthHero } from './Login'

export default function Cadastro() {
  const { registrar } = useAuth()
  const [form, setForm] = useState({ nomeEstabelecimento: '', nome: '', email: '', telefone: '', senha: '' })
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await registrar(form)
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
            <h2>Cadastrar estabelecimento</h2>
            <p className="muted">Você entra como dono e também como o primeiro profissional da equipe.</p>
          </div>
          <ErrorBanner message={erro} />
          <Field label="Nome do estabelecimento">
            <input className="input" value={form.nomeEstabelecimento} onChange={set('nomeEstabelecimento')} required />
          </Field>
          <Field label="Seu nome">
            <input className="input" value={form.nome} onChange={set('nome')} required />
          </Field>
          <div className="form-grid">
            <Field label="E-mail">
              <input className="input" type="email" value={form.email} onChange={set('email')} required />
            </Field>
            <Field label="WhatsApp">
              <input className="input" value={form.telefone} onChange={set('telefone')} placeholder="(11) 99999-9999" />
            </Field>
          </div>
          <Field label="Senha" hint="Mínimo de 6 caracteres">
            <input className="input" type="password" value={form.senha} onChange={set('senha')} required minLength={6} />
          </Field>
          <button className="btn btn-primary btn-lg btn-block" disabled={enviando}>
            {enviando ? 'Criando...' : 'Criar conta'}
          </button>
          <p className="muted center small">
            Já tem conta? <Link to="/login">Entrar</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
