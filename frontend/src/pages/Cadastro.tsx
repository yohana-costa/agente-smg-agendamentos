import { useState, type FormEvent } from 'react'
import { Building2, Lock, Mail, Phone, User } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { Link } from '../lib/router'
import { ErrorBanner } from '../components/ui'
import { AuthFormShell, IconInput } from './Login'

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
    <AuthFormShell titulo="Cadastrar estabelecimento" subtitulo="Você entra como dono e também como o primeiro profissional da equipe.">
      <form className="stack" onSubmit={onSubmit}>
        <ErrorBanner message={erro} />
        <div className="field">
          <label>Nome do estabelecimento</label>
          <IconInput icon={<Building2 className="h-4 w-4" />} value={form.nomeEstabelecimento} onChange={set('nomeEstabelecimento')} required />
        </div>
        <div className="field">
          <label>Seu nome</label>
          <IconInput icon={<User className="h-4 w-4" />} value={form.nome} onChange={set('nome')} required />
        </div>
        <div className="field">
          <label>E-mail</label>
          <IconInput icon={<Mail className="h-4 w-4" />} type="email" value={form.email} onChange={set('email')} required />
        </div>
        <div className="field">
          <label>WhatsApp</label>
          <IconInput icon={<Phone className="h-4 w-4" />} value={form.telefone} onChange={set('telefone')} placeholder="(11) 99999-9999" />
        </div>
        <div className="field">
          <label>Senha</label>
          <IconInput icon={<Lock className="h-4 w-4" />} type="password" value={form.senha} onChange={set('senha')} required minLength={6} placeholder="Mínimo de 6 caracteres" />
        </div>
        <button className="btn btn-primary btn-lg btn-block" disabled={enviando}>
          {enviando ? 'Criando...' : 'Criar conta'}
        </button>
        <p className="center text-sm text-muted-foreground">
          Já tem conta? <Link to="/login">Entrar</Link>
        </p>
      </form>
    </AuthFormShell>
  )
}
