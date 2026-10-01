import { useState, type FormEvent } from 'react'
import { errorMessage, post } from '../../../lib/api'
import { DevNotice, PbAlert, PhoneField } from '../shared/components'
import { digitosTelefone, telefoneValido } from '../shared/utils'

type Aba = 'entrar' | 'criar'
type CodigoResposta = { enviado: boolean; codigoDev?: string }
type TokenResposta = { token: string; cliente: { nome: string; telefone: string } }

/** Portal sem login: Entrar (com "Esqueci minha senha") e Criar conta (com verificacao do telefone). */
export default function Acesso({ slug, nomeEstabelecimento, abaInicial, onLogin }: { slug: string; nomeEstabelecimento: string; abaInicial: Aba; onLogin: (token: string) => void }) {
  const [aba, setAba] = useState<Aba>(abaInicial)
  const [esqueci, setEsqueci] = useState(false)

  return (
    <div className="pb-auth">
      <div className="pb-auth-head">
        <h1>{aba === 'criar' ? 'Crie sua conta' : esqueci ? 'Redefinir senha' : 'Bem-vindo de volta!'}</h1>
        <p className="muted">
          {aba === 'criar'
            ? `Acompanhe seus agendamentos em ${nomeEstabelecimento}, reagende e veja seu histórico.`
            : esqueci
              ? 'Vamos enviar um código para o seu WhatsApp.'
              : `Entre para ver seus agendamentos em ${nomeEstabelecimento}.`}
        </p>
      </div>

      {!esqueci ? (
        <div className="pb-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={aba === 'entrar'} className={`pb-tab ${aba === 'entrar' ? 'active' : ''}`} onClick={() => setAba('entrar')}>
            Entrar
          </button>
          <button type="button" role="tab" aria-selected={aba === 'criar'} className={`pb-tab ${aba === 'criar' ? 'active' : ''}`} onClick={() => setAba('criar')}>
            Criar conta
          </button>
        </div>
      ) : null}

      <div className="pb-card">
        {aba === 'criar' ? (
          <CriarConta slug={slug} onLogin={onLogin} />
        ) : esqueci ? (
          <EsqueciSenha slug={slug} onLogin={onLogin} onVoltar={() => setEsqueci(false)} />
        ) : (
          <Entrar slug={slug} onLogin={onLogin} onEsqueci={() => setEsqueci(true)} />
        )}
      </div>
    </div>
  )
}

function Entrar({ slug, onLogin, onEsqueci }: { slug: string; onLogin: (t: string) => void; onEsqueci: () => void }) {
  const [telefone, setTelefone] = useState('')
  const [senha, setSenha] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!telefoneValido(telefone) || !senha) return
    setBusy(true)
    setErro('')
    try {
      const r = await post<TokenResposta>(`/publico/${slug}/portal/login`, { telefone: digitosTelefone(telefone), senha }, { publico: true })
      onLogin(r.token)
    } catch (err) {
      setErro(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={enviar}>
      <div className="field">
        <label>Telefone</label>
        <PhoneField value={telefone} onChange={setTelefone} />
      </div>
      <div className="field">
        <label htmlFor="pb-senha">Senha</label>
        <input id="pb-senha" className="input" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
      </div>
      <PbAlert tipo="erro">{erro}</PbAlert>
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !telefoneValido(telefone) || !senha}>
        {busy ? 'Entrando...' : 'Entrar'}
      </button>
      <button type="button" className="pb-link center" onClick={onEsqueci}>
        Esqueci minha senha
      </button>
    </form>
  )
}

function CodigoDev({ codigo }: { codigo?: string }) {
  if (!codigo) return null
  return (
    <DevNotice titulo="Desenvolvimento · WhatsApp não configurado">
      Código de verificação: <strong className="mono">{codigo}</strong>
    </DevNotice>
  )
}

function CodigoInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="input pb-code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      placeholder="000000"
      value={value}
      autoFocus
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  )
}

function CriarConta({ slug, onLogin }: { slug: string; onLogin: (t: string) => void }) {
  const [fase, setFase] = useState<'dados' | 'codigo'>('dados')
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [codigo, setCodigo] = useState('')
  const [codigoDev, setCodigoDev] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')

  const senhaOk = senha.length >= 6 && senha === confirmar
  const dadosOk = nome.trim().length >= 2 && telefoneValido(telefone) && senhaOk

  async function enviarCodigo(e?: FormEvent) {
    e?.preventDefault()
    if (!dadosOk) return
    setBusy(true)
    setErro('')
    setInfo('')
    try {
      const r = await post<CodigoResposta>(`/publico/${slug}/portal/codigo`, { telefone: digitosTelefone(telefone), finalidade: 'CADASTRO' }, { publico: true })
      setCodigoDev(r.codigoDev)
      setCodigo('')
      setFase('codigo')
      setInfo(r.enviado ? `Enviamos um código de 6 dígitos para ${telefone}.` : r.codigoDev ? 'WhatsApp não configurado: use o código de testes exibido abaixo.' : 'Não conseguimos enviar o código agora. Tente reenviar em instantes.')
    } catch (err) {
      setErro(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmarCodigo(e: FormEvent) {
    e.preventDefault()
    if (codigo.length !== 6) return
    setBusy(true)
    setErro('')
    try {
      const r = await post<TokenResposta>(`/publico/${slug}/portal/cadastro`, { nome: nome.trim(), telefone: digitosTelefone(telefone), senha, codigo }, { publico: true })
      onLogin(r.token)
    } catch (err) {
      setErro(errorMessage(err))
      setBusy(false)
    }
  }

  if (fase === 'codigo') {
    return (
      <form className="stack" onSubmit={confirmarCodigo}>
        <div className="pb-card-title">Confirme seu telefone</div>
        <PbAlert tipo="info">{info}</PbAlert>
        <div className="field">
          <label>Código de verificação</label>
          <CodigoInput value={codigo} onChange={setCodigo} />
        </div>
        <CodigoDev codigo={codigoDev} />
        <PbAlert tipo="erro">{erro}</PbAlert>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || codigo.length !== 6}>
          {busy ? 'Criando conta...' : 'Confirmar e criar conta'}
        </button>
        <div className="row-between small">
          <button type="button" className="pb-link" onClick={() => setFase('dados')} disabled={busy}>
            ‹ Alterar dados
          </button>
          <button type="button" className="pb-link" onClick={() => enviarCodigo()} disabled={busy}>
            Reenviar código
          </button>
        </div>
      </form>
    )
  }

  return (
    <form className="stack" onSubmit={enviarCodigo}>
      <div className="field">
        <label htmlFor="pb-c-nome">Nome</label>
        <input id="pb-c-nome" className="input" autoComplete="name" placeholder="Seu nome completo" value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div className="field">
        <label>Telefone (WhatsApp)</label>
        <PhoneField value={telefone} onChange={setTelefone} />
      </div>
      <div className="pb-note pb-note-warn">
        <span aria-hidden>⚠</span>
        <span>
          Use o <strong>mesmo telefone usado nos seus agendamentos</strong> para que seu histórico seja encontrado.
        </span>
      </div>
      <div className="field">
        <label htmlFor="pb-c-senha">Senha</label>
        <input id="pb-c-senha" className="input" type="password" autoComplete="new-password" placeholder="Mínimo de 6 caracteres" value={senha} onChange={(e) => setSenha(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pb-c-senha2">Confirme a senha</label>
        <input id="pb-c-senha2" className="input" type="password" autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
        {confirmar && senha !== confirmar ? <span className="field-hint danger-text">As senhas não conferem.</span> : null}
      </div>
      <PbAlert tipo="erro">{erro}</PbAlert>
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !dadosOk}>
        {busy ? 'Enviando código...' : 'Enviar código de verificação'}
      </button>
      <p className="small muted center">Vamos enviar um código por WhatsApp para confirmar que o número é seu.</p>
    </form>
  )
}

function EsqueciSenha({ slug, onLogin, onVoltar }: { slug: string; onLogin: (t: string) => void; onVoltar: () => void }) {
  const [fase, setFase] = useState<'telefone' | 'codigo'>('telefone')
  const [telefone, setTelefone] = useState('')
  const [codigo, setCodigo] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [codigoDev, setCodigoDev] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')

  async function pedirCodigo(e?: FormEvent) {
    e?.preventDefault()
    if (!telefoneValido(telefone)) return
    setBusy(true)
    setErro('')
    try {
      const r = await post<CodigoResposta>(`/publico/${slug}/portal/codigo`, { telefone: digitosTelefone(telefone), finalidade: 'SENHA' }, { publico: true })
      setCodigoDev(r.codigoDev)
      setFase('codigo')
      setInfo(r.enviado ? `Enviamos um código para ${telefone}.` : r.codigoDev ? 'WhatsApp não configurado: use o código de testes exibido abaixo.' : 'Não conseguimos enviar o código agora. Tente reenviar em instantes.')
    } catch (err) {
      setErro(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function redefinir(e: FormEvent) {
    e.preventDefault()
    if (codigo.length !== 6 || senha.length < 6 || senha !== confirmar) return
    setBusy(true)
    setErro('')
    try {
      const r = await post<TokenResposta>(`/publico/${slug}/portal/redefinir-senha`, { telefone: digitosTelefone(telefone), codigo, senha }, { publico: true })
      onLogin(r.token)
    } catch (err) {
      setErro(errorMessage(err))
      setBusy(false)
    }
  }

  if (fase === 'codigo') {
    return (
      <form className="stack" onSubmit={redefinir}>
        <PbAlert tipo="info">{info}</PbAlert>
        <div className="field">
          <label>Código de verificação</label>
          <CodigoInput value={codigo} onChange={setCodigo} />
        </div>
        <CodigoDev codigo={codigoDev} />
        <div className="field">
          <label htmlFor="pb-r-senha">Nova senha</label>
          <input id="pb-r-senha" className="input" type="password" autoComplete="new-password" placeholder="Mínimo de 6 caracteres" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pb-r-senha2">Confirme a nova senha</label>
          <input id="pb-r-senha2" className="input" type="password" autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
          {confirmar && senha !== confirmar ? <span className="field-hint danger-text">As senhas não conferem.</span> : null}
        </div>
        <PbAlert tipo="erro">{erro}</PbAlert>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || codigo.length !== 6 || senha.length < 6 || senha !== confirmar}>
          {busy ? 'Salvando...' : 'Salvar nova senha e entrar'}
        </button>
        <div className="row-between small">
          <button type="button" className="pb-link" onClick={onVoltar} disabled={busy}>
            ‹ Voltar ao login
          </button>
          <button type="button" className="pb-link" onClick={() => pedirCodigo()} disabled={busy}>
            Reenviar código
          </button>
        </div>
      </form>
    )
  }

  return (
    <form className="stack" onSubmit={pedirCodigo}>
      <div className="field">
        <label>Telefone da sua conta</label>
        <PhoneField value={telefone} onChange={setTelefone} autoFocus />
      </div>
      <PbAlert tipo="erro">{erro}</PbAlert>
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !telefoneValido(telefone)}>
        {busy ? 'Enviando...' : 'Enviar código'}
      </button>
      <button type="button" className="pb-link center" onClick={onVoltar}>
        ‹ Voltar ao login
      </button>
    </form>
  )
}
