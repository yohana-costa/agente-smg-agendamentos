import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Building2, Check, Copy, CreditCard, FileText, Lock, Mail, Phone, QrCode, User } from 'lucide-react'
import { api, errorMessage, setToken } from '../lib/api'
import { Link } from '../lib/router'
import { ErrorBanner } from '../components/ui'
import { AuthHero, IconInput } from './Login'

/**
 * Assinatura do Gestor SMG Agendamentos (mesmo fluxo do Gestor SMG varejo):
 * a conta nasce bloqueada e so libera quando o pagamento confirma.
 *  - Pix: Pix Automatico do Asaas. Paga o QR uma vez e os meses seguintes debitam sozinhos.
 *  - Cartao: assinatura do Mercado Pago, na pagina deles. Volta por /assinar/retorno.
 */

export const CHAVE_ASSINATURA = 'smg-ag-assinatura'

type Metodo = 'PIX' | 'CREDIT_CARD'
interface Plano { valor: number; pix: boolean; cartao: boolean }
interface Inicio { referencia: string; metodo?: Metodo; pix?: { imagem: string | null; copiaCola: string | null } | null; linkPagamento?: string | null; liberado?: boolean }
interface Status { liberado: boolean; token: string | null }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function mascaraDoc(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2')
}

function mascaraFone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

export function entrarComToken(token: string | null) {
  if (token) {
    setToken(token)
    window.location.href = '/app/visao-geral'
  } else {
    window.location.href = '/login?liberado=1'
  }
}

const INCLUSO = [
  'Agenda online com pagamento antecipado (Pix e cartão)',
  'Site de agendamento e portal do cliente',
  'Agente de IA que atende e agenda no WhatsApp',
  'Agente de gestão: o dono consulta e opera pelo WhatsApp',
  'Equipe, comissões, financeiro, fidelidade e automações',
]

export default function Assinar() {
  const busca = new URLSearchParams(window.location.search)
  const [modo, setModo] = useState<'novo' | 'retomar'>(busca.get('retomar') ? 'retomar' : 'novo')
  const [plano, setPlano] = useState<Plano | null>(null)
  const [form, setForm] = useState({ nomeEstabelecimento: '', nome: '', email: busca.get('email') || '', telefone: '', cpfCnpj: '', senha: '' })
  const [metodo, setMetodo] = useState<Metodo>('PIX')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pix, setPix] = useState<{ referencia: string; imagem: string | null; copiaCola: string | null } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const timer = useRef<number | null>(null)

  const set = (k: keyof typeof form, mascara?: (v: string) => string) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: mascara ? mascara(e.target.value) : e.target.value })

  useEffect(() => {
    api<Plano>('/assinatura/plano', { publico: true })
      .then((p) => {
        setPlano(p)
        if (!p.pix && p.cartao) setMetodo('CREDIT_CARD')
      })
      .catch(() => setPlano({ valor: 197, pix: true, cartao: true }))
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  // Polling do Pix: o backend consulta o Asaas e devolve o token quando liberar.
  useEffect(() => {
    if (!pix) return
    let parar = false
    const verificar = async () => {
      if (parar) return
      try {
        const s = await api<Status>(`/assinatura/status/${pix.referencia}`, { publico: true })
        if (s.liberado) return entrarComToken(s.token)
      } catch {
        /* rede instavel: tenta de novo */
      }
      timer.current = window.setTimeout(verificar, 4000)
    }
    timer.current = window.setTimeout(verificar, 4000)
    return () => {
      parar = true
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [pix])

  function seguir(r: Inicio) {
    if (r.liberado) return entrarComToken(null)
    if (r.metodo === 'CREDIT_CARD' && r.linkPagamento) {
      sessionStorage.setItem(CHAVE_ASSINATURA, r.referencia)
      window.location.href = r.linkPagamento
      return
    }
    if (r.pix) setPix({ referencia: r.referencia, imagem: r.pix.imagem, copiaCola: r.pix.copiaCola })
  }

  async function assinar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      seguir(await api<Inicio>('/assinatura/assinar', { method: 'POST', body: { ...form, metodo }, publico: true }))
    } catch (err) {
      setErro(errorMessage(err))
    } finally {
      setEnviando(false)
    }
  }

  async function retomar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      seguir(await api<Inicio>('/assinatura/retomar', { method: 'POST', body: { email: form.email, senha: form.senha }, publico: true }))
    } catch (err) {
      setErro(errorMessage(err))
    } finally {
      setEnviando(false)
    }
  }

  async function copiar() {
    if (!pix?.copiaCola) return
    try {
      await navigator.clipboard.writeText(pix.copiaCola)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2500)
    } catch {
      /* navegador sem permissao: o campo continua selecionavel */
    }
  }

  const valor = plano ? brl(plano.valor) : '...'

  return (
    <div className="flex min-h-screen bg-background">
      <AuthHero />
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-6 lg:items-center">
        <div className="w-full max-w-md py-6">
          <a href="/" className="mb-6 flex items-center gap-3 text-foreground no-underline lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary text-sm font-bold text-white">SG</div>
            <span className="font-semibold">Gestor SMG · Agendamentos</span>
          </a>

          {pix ? (
            <div className="stack">
              <h2 className="text-2xl font-bold tracking-tight">Pague o Pix para liberar</h2>
              <p className="text-sm text-muted-foreground">
                Escaneie o QR no app do seu banco. Ao pagar, você autoriza o <b>Pix Automático</b> de {valor} por mês e não precisa pagar boleto nem QR nos
                próximos meses. Sua conta libera sozinha assim que o pagamento cair.
              </p>
              <div className="card center">
                {pix.imagem ? (
                  <img src={`data:image/png;base64,${pix.imagem}`} alt="QR Code Pix" className="mx-auto h-60 w-60 rounded-lg bg-white p-2" />
                ) : (
                  <p className="text-sm text-muted-foreground">QR indisponível, use o código abaixo.</p>
                )}
                {pix.copiaCola && (
                  <div className="stack-sm mt-4 text-left">
                    <label className="field-label">Pix copia e cola</label>
                    <textarea className="textarea" rows={3} readOnly value={pix.copiaCola} onFocus={(e) => e.target.select()} style={{ fontSize: 12 }} />
                    <button type="button" className="btn btn-block" onClick={copiar}>
                      {copiado ? <Check /> : <Copy />} {copiado ? 'Copiado' : 'Copiar código'}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                Aguardando o pagamento...
              </div>
              <p className="center text-xs text-muted-foreground">
                O QR vale 1 hora. Fechou a página? Entre em <Link to="/assinar?retomar=1">Concluir pagamento</Link> com seu e-mail e senha.
              </p>
            </div>
          ) : modo === 'retomar' ? (
            <form className="stack" onSubmit={retomar}>
              <h2 className="text-2xl font-bold tracking-tight">Concluir pagamento</h2>
              <p className="text-sm text-muted-foreground">
                Criou a conta e não pagou, ou quer reativar uma assinatura cancelada? Entre com o e-mail e a senha do cadastro.
              </p>
              <ErrorBanner message={erro} />
              <div className="field">
                <label>E-mail</label>
                <IconInput icon={<Mail className="h-4 w-4" />} type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
              </div>
              <div className="field">
                <label>Senha</label>
                <IconInput icon={<Lock className="h-4 w-4" />} type="password" autoComplete="current-password" value={form.senha} onChange={set('senha')} required />
              </div>
              <button className="btn btn-primary btn-lg btn-block" disabled={enviando}>
                {enviando ? 'Aguarde...' : 'Continuar'}
              </button>
              <p className="center text-sm text-muted-foreground">
                Ainda não tem conta?{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); setErro(''); setModo('novo') }}>
                  Assinar agora
                </a>
              </p>
            </form>
          ) : (
            <form className="stack" onSubmit={assinar}>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Assine o Gestor SMG Agendamentos</h2>
                <p className="mt-1 text-sm text-muted-foreground">Plano completo, sem fidelidade. Cancele quando quiser.</p>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">Plano mensal</span>
                  <span className="text-2xl font-bold">
                    {valor}
                    <span className="text-sm font-normal text-muted-foreground">/mês</span>
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {INCLUSO.map((i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> {i}
                    </li>
                  ))}
                </ul>
              </div>

              <ErrorBanner message={erro} />
              <div className="field">
                <label>Nome do estabelecimento</label>
                <IconInput icon={<Building2 className="h-4 w-4" />} value={form.nomeEstabelecimento} onChange={set('nomeEstabelecimento')} required />
              </div>
              <div className="field">
                <label>Seu nome</label>
                <IconInput icon={<User className="h-4 w-4" />} autoComplete="name" value={form.nome} onChange={set('nome')} required />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="field">
                  <label>WhatsApp</label>
                  <IconInput icon={<Phone className="h-4 w-4" />} inputMode="tel" placeholder="(99) 99999-9999" value={form.telefone} onChange={set('telefone', mascaraFone)} required />
                </div>
                <div className="field">
                  <label>CPF ou CNPJ</label>
                  <IconInput icon={<FileText className="h-4 w-4" />} inputMode="numeric" value={form.cpfCnpj} onChange={set('cpfCnpj', mascaraDoc)} required />
                </div>
              </div>
              <div className="field">
                <label>E-mail (será o seu login)</label>
                <IconInput icon={<Mail className="h-4 w-4" />} type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
              </div>
              <div className="field">
                <label>Senha</label>
                <IconInput icon={<Lock className="h-4 w-4" />} type="password" autoComplete="new-password" minLength={6} placeholder="mínimo 6 caracteres" value={form.senha} onChange={set('senha')} required />
              </div>

              <div className="field">
                <label>Forma de pagamento</label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { key: 'PIX', label: 'Pix', sub: 'débito automático', icon: <QrCode className="h-5 w-5" />, ok: plano?.pix !== false },
                      { key: 'CREDIT_CARD', label: 'Cartão', sub: 'crédito, recorrente', icon: <CreditCard className="h-5 w-5" />, ok: plano?.cartao !== false },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      disabled={!m.ok}
                      onClick={() => setMetodo(m.key)}
                      className="btn flex-col"
                      style={{ minHeight: 72, gap: 2, ...(metodo === m.key ? { borderColor: 'hsl(var(--primary))', boxShadow: '0 0 0 2px hsl(var(--primary) / 0.35)' } : {}) }}
                    >
                      {m.icon}
                      <span className="font-semibold">{m.label}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">{m.ok ? m.sub : 'indisponível'}</span>
                    </button>
                  ))}
                </div>
                <p className="field-hint">
                  {metodo === 'PIX'
                    ? 'Você paga um QR agora e autoriza o débito mensal no seu banco (Pix Automático).'
                    : 'Você conclui no Mercado Pago e volta para cá com a conta liberada.'}
                </p>
              </div>

              <button className="btn btn-primary btn-lg btn-block" disabled={enviando}>
                {enviando ? 'Preparando pagamento...' : `Assinar por ${valor}/mês`}
              </button>
              <p className="center text-sm text-muted-foreground">
                Já tem conta? <Link to="/login">Entrar</Link>
                {' · '}
                <a href="#" onClick={(e) => { e.preventDefault(); setErro(''); setModo('retomar') }}>
                  Concluir pagamento
                </a>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
