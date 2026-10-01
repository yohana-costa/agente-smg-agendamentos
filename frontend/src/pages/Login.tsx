import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { ArrowUpRight, CalendarCheck, CalendarDays, Lock, Mail, ShieldCheck, Sparkles, TrendingUp, UserX } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { Link } from '../lib/router'
import { ErrorBanner } from '../components/ui'

/** Painel de marca da tela de login (mesmo formato do Gestor SMG: gradiente + mini cards de vidro). */
export function AuthHero() {
  const agenda = [
    { hora: '09:00', nome: 'Corte + Escova', pct: 100 },
    { hora: '10:30', nome: 'Coloração', pct: 72 },
    { hora: '13:00', nome: 'Manicure', pct: 45 },
    { hora: '15:00', nome: 'Corte', pct: 30 },
  ]
  return (
    <div className="relative hidden overflow-hidden lg:flex lg:w-1/2">
      <div className="absolute inset-0" style={{ background: 'linear-gradient(150deg, hsl(222 30% 10%) 0%, hsl(var(--primary) / 0.55) 55%, hsl(var(--brand-2) / 0.7) 100%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(600px 400px at 85% 10%, hsl(var(--brand-2) / 0.35), transparent 60%)' }} />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: 'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)', backgroundSize: '44px 44px' }}
      />
      <div className="relative z-10 flex w-full flex-col gap-6 overflow-y-auto p-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-sm font-bold text-white backdrop-blur-sm">SG</div>
          <span className="font-semibold text-white">Gestor SMG · Agendamentos</span>
        </div>

        <div className="space-y-3.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/80">
            <Sparkles className="h-3 w-3" /> Agenda + IA no WhatsApp
          </span>
          <h1 className="max-w-lg text-[2.3rem] font-bold leading-[1.08] tracking-tight text-white">
            Sua agenda cheia, <span className="text-white/45">sem no-show e sem planilha.</span>
          </h1>
          <p className="max-w-md text-[15px] leading-relaxed text-white/60">
            Pagamento antecipado, site de agendamento, portal do cliente e agentes de IA que atendem e gerenciam pelo WhatsApp.
          </p>
        </div>

        <div className="grid max-w-lg grid-cols-3 gap-3">
          <MiniKpi icon={<CalendarCheck className="h-4 w-4 text-white" />} valor="38" rotulo="atendimentos hoje" delta="+12%" />
          <MiniKpi icon={<TrendingUp className="h-4 w-4 text-white" />} valor="86%" rotulo="ocupação" delta="+9 pts" />
          <MiniKpi icon={<UserX className="h-4 w-4 text-white" />} valor="2,1%" rotulo="no-show" delta="-6 pts" />
        </div>

        <div className="grid max-w-lg grid-cols-5 gap-3">
          <div className="col-span-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur-sm">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[11px] font-medium text-white/70">Agenda de hoje</span>
              <CalendarDays className="h-3.5 w-3.5 text-white/40" />
            </div>
            <div className="space-y-2">
              {agenda.map((a) => (
                <div key={a.hora} className="flex items-center gap-2.5">
                  <span className="w-10 shrink-0 text-[10px] text-white/55">{a.hora}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-white/70" style={{ width: `${a.pct}%` }} />
                  </div>
                  <span className="w-24 shrink-0 truncate text-right text-[10px] text-white/70">{a.nome}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur-sm">
            <p className="mb-1 text-[11px] text-white/55">Faturamento do mês</p>
            <p className="text-lg font-bold text-white">R$ 18.420</p>
            <p className="mt-1 text-[11px] font-medium text-emerald-300">↑ 14% vs. mês anterior</p>
            <div className="mt-3 flex h-10 items-end gap-1">
              {[40, 55, 35, 70, 60, 85, 75].map((h, i) => (
                <div key={i} className="flex-1 rounded-t bg-white/30" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-auto flex items-center gap-2 text-[12px] text-white/50">
          <ShieldCheck className="h-4 w-4" /> SMG Company · dados protegidos
        </div>
      </div>
    </div>
  )
}

function MiniKpi({ icon, valor, rotulo, delta }: { icon: ReactNode; valor: string; rotulo: string; delta: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur-sm">
      {icon}
      <p className="mt-2 text-lg font-bold leading-none text-white">{valor}</p>
      <div className="mt-1.5 flex items-center gap-1">
        <span className="truncate text-[11px] text-white/55">{rotulo}</span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-emerald-300">
          <ArrowUpRight className="h-3 w-3" />
          {delta}
        </span>
      </div>
    </div>
  )
}

export function AuthFormShell({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <AuthHero />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary text-sm font-bold text-white">SG</div>
            <span className="font-semibold">Gestor SMG · Agendamentos</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">{titulo}</h2>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">{subtitulo}</p>
          {children}
        </div>
      </div>
    </div>
  )
}

export function IconInput({ icon, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>
      <input className="input" style={{ paddingLeft: 38 }} {...props} />
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
    <AuthFormShell titulo="Bem-vindo de volta" subtitulo="Entre com o seu login de dono, recepção ou profissional.">
      <form className="stack" onSubmit={onSubmit}>
        <ErrorBanner message={erro} />
        <div className="field">
          <label>E-mail</label>
          <IconInput icon={<Mail className="h-4 w-4" />} type="email" autoComplete="email" placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label>Senha</label>
          <IconInput icon={<Lock className="h-4 w-4" />} type="password" autoComplete="current-password" placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </div>
        <button className="btn btn-primary btn-lg btn-block" disabled={enviando}>
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
        <p className="center text-sm text-muted-foreground">
          Novo por aqui? <Link to="/cadastro">Cadastre seu estabelecimento</Link>
        </p>
      </form>
    </AuthFormShell>
  )
}
