import { useEffect, useState } from 'react'
import { errorMessage, get, patch, post } from '../../../lib/api'
import { dateTimeBr, phone } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { useAuth } from '../../../lib/auth'
import { Card, ErrorBanner, Field, Loading, MoneyInput, Segmented, SuccessBanner, Tabs, Toggle } from '../../../components/ui'
import type { Servico } from '../../../types'
import { CorPicker, Credenciais, ServicosCheckboxes } from './campos'
import JornadaEditor from './JornadaEditor'
import AusenciasTab from './AusenciasTab'
import ResultadosTab from './ResultadosTab'
import MeuGoogleCard from './MeuGoogleCard'
import { corVar, iniciais, type Convite, type ProfissionalDetalhe } from './tipos'

type Aba = 'dados' | 'jornada' | 'ausencias' | 'remuneracao' | 'acesso' | 'resultados'

// ---------------- Dados ----------------

function DadosTab({ p, ehDono, onSaved }: { p: ProfissionalDetalhe; ehDono: boolean; onSaved: () => void }) {
  const servicos = useAsync(() => get<Servico[]>('/servicos'), [])
  const inicial = () => ({ nome: p.nome, telefone: phone(p.telefone), email: p.email || '', cor: p.cor || '#007f64', ativo: p.ativo, servicoIds: p.servicoIds })
  const [form, setForm] = useState(inicial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    setForm(inicial())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p])

  async function salvar() {
    if (!form.nome.trim()) return setError('Informe o nome.')
    setSaving(true)
    setError('')
    setOk('')
    try {
      const body: Record<string, unknown> = {
        nome: form.nome.trim(),
        telefone: form.telefone,
        email: form.email.trim(),
        cor: form.cor,
        servicoIds: form.servicoIds,
      }
      if (ehDono) body.ativo = form.ativo
      await patch(`/equipe/${p.id}`, body)
      setOk('Dados atualizados.')
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="Nome *">
          <input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        </Field>
        <Field label="Telefone (WhatsApp)">
          <input className="input" inputMode="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
        </Field>
        <Field label="E-mail" hint={p.usuario ? `O login de acesso usa ${p.usuario.email}.` : undefined}>
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Situação" hint={ehDono ? 'Inativo não aparece na agenda, no site nem para o agente, e o login é bloqueado.' : 'Apenas o dono altera.'}>
          <div style={{ paddingTop: 6 }}>
            <Toggle checked={form.ativo} onChange={(ativo) => setForm({ ...form, ativo })} disabled={!ehDono} label={form.ativo ? 'Ativo' : 'Inativo'} />
          </div>
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
      <SuccessBanner message={ok} />
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" onClick={salvar} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar dados'}
        </button>
      </div>
    </div>
  )
}

// ---------------- Remuneração e meta ----------------

function RemuneracaoTab({ p, onSaved }: { p: ProfissionalDetalhe; onSaved: () => void }) {
  const inicial = () => ({
    remuneracaoTipo: p.remuneracaoTipo,
    comissaoPct: p.comissaoPct,
    valorFixo: p.valorFixo,
    metaServicosMes: p.metaServicosMes,
    metaValorMes: p.metaValorMes,
  })
  const [form, setForm] = useState(inicial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    setForm(inicial())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p])

  async function salvar() {
    if (form.comissaoPct < 0 || form.comissaoPct > 100) return setError('A comissão deve ficar entre 0% e 100%.')
    setSaving(true)
    setError('')
    setOk('')
    try {
      await patch(`/equipe/${p.id}`, form)
      setOk('Remuneração e meta atualizadas.')
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack">
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title="Remuneração" subtitle="Definida pelo dono. Usada no cálculo de comissões do Financeiro.">
          <div className="stack">
            <Segmented
              options={[
                { key: 'COMISSAO', label: 'Comissão (%)' },
                { key: 'FIXO', label: 'Valor fixo' },
              ]}
              value={form.remuneracaoTipo}
              onChange={(remuneracaoTipo) => setForm({ ...form, remuneracaoTipo })}
            />
            {form.remuneracaoTipo === 'COMISSAO' ? (
              <Field label="Percentual sobre os serviços realizados" hint="Calculado sobre o valor dos serviços concluídos, já descontados os descontos.">
                <div className="input-group" style={{ maxWidth: 180 }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    value={form.comissaoPct}
                    onChange={(e) => setForm({ ...form, comissaoPct: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
                  />
                  <span className="addon">%</span>
                </div>
              </Field>
            ) : (
              <Field label="Valor fixo mensal">
                <div style={{ maxWidth: 220 }}>
                  <MoneyInput value={form.valorFixo} onChange={(valorFixo) => setForm({ ...form, valorFixo })} />
                </div>
              </Field>
            )}
          </div>
        </Card>
        <Card title="Meta individual do mês" subtitle="Acompanhe o progresso em Resultados e na Visão Geral do profissional.">
          <div className="stack">
            <Field label="Quantidade de serviços">
              <input
                className="input"
                type="number"
                min={0}
                style={{ maxWidth: 180 }}
                value={form.metaServicosMes}
                onChange={(e) => setForm({ ...form, metaServicosMes: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              />
            </Field>
            <Field label="Valor (faturamento)">
              <div style={{ maxWidth: 220 }}>
                <MoneyInput value={form.metaValorMes} onChange={(metaValorMes) => setForm({ ...form, metaValorMes })} />
              </div>
            </Field>
          </div>
        </Card>
      </div>
      <ErrorBanner message={error} />
      <SuccessBanner message={ok} />
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" onClick={salvar} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar remuneração e meta'}
        </button>
      </div>
    </div>
  )
}

// ---------------- Acesso e Google ----------------

function AcessoTab({ p, ehDono, ehEu, onSaved }: { p: ProfissionalDetalhe; ehDono: boolean; ehEu: boolean; onSaved: () => void }) {
  const [email, setEmail] = useState(p.email || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [convite, setConvite] = useState<Convite | null>(null)

  async function criarAcesso() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Informe um e-mail válido.')
    setBusy(true)
    setError('')
    try {
      setConvite(await post<Convite>(`/equipe/${p.id}/criar-acesso`, { email: email.trim() }))
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function reenviar() {
    setBusy(true)
    setError('')
    try {
      setConvite(await post<Convite>(`/equipe/${p.id}/reenviar-convite`))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const u = p.usuario
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <Card title="Login de acesso" subtitle="Cada profissional entra com o próprio login e vê apenas o que é dele.">
        <div className="stack">
          {u ? (
            <>
              <div className="row">
                <span className="strong">{u.email}</span>
                <span className={`badge ${u.ativo ? 'badge-success' : 'badge-gray'}`}>{u.ativo ? 'Login ativo' : 'Login bloqueado'}</span>
                {u.perfil === 'DONO' ? <span className="badge badge-primary">Dono</span> : null}
              </div>
              {u.perfil === 'DONO' ? (
                <div className="small muted">Este é o login do dono do estabelecimento. A senha é alterada pelo próprio dono.</div>
              ) : ehDono ? (
                <>
                  <div className="small muted">Se o profissional esqueceu a senha ou não recebeu o convite, gere uma nova senha temporária.</div>
                  <div>
                    <button className="btn" onClick={reenviar} disabled={busy}>
                      {busy ? 'Gerando...' : 'Gerar nova senha temporária'}
                    </button>
                  </div>
                </>
              ) : null}
            </>
          ) : ehDono ? (
            <>
              <div className="banner warning-banner">Este profissional ainda não tem login.</div>
              <Field label="E-mail de login">
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@exemplo.com" />
              </Field>
              <div>
                <button className="btn btn-primary" onClick={criarAcesso} disabled={busy}>
                  {busy ? 'Criando...' : 'Criar acesso'}
                </button>
              </div>
            </>
          ) : (
            <div className="muted">Este profissional ainda não tem login. Apenas o dono pode criar o acesso.</div>
          )}
          <ErrorBanner message={error} />
          {convite ? (
            <>
              <SuccessBanner message="Credenciais geradas. Repasse ao profissional." />
              <Credenciais convite={convite} />
            </>
          ) : null}
        </div>
      </Card>

      {ehEu ? (
        <MeuGoogleCard onChange={onSaved} />
      ) : (
        <Card title="Google Calendar" subtitle="Cada profissional conecta o próprio Google pelo seu login.">
          <div className="eq-google">
            <span className="eq-google-icon">G</span>
            <div className="eq-google-main">
              {p.googleConectado ? (
                <>
                  <div className="strong">
                    Conectado <span className="badge badge-success">Ativo</span>
                  </div>
                  <div className="small muted">
                    {p.googleEmail || 'Conta Google'}
                    {p.googleSyncEm ? ` · última sincronização ${dateTimeBr(p.googleSyncEm)}` : ''}
                  </div>
                </>
              ) : (
                <>
                  <div className="strong">Não conectado</div>
                  <div className="small muted">
                    {p.googleConfigurado
                      ? 'O profissional pode conectar a própria conta ao entrar no sistema com o login dele.'
                      : 'A integração com o Google ainda não foi configurada no servidor.'}
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

// ---------------- Ficha ----------------

export default function FichaProfissional({ profissionalId, onBack, onChanged }: { profissionalId: string; onBack: () => void; onChanged: () => void }) {
  const { usuario } = useAuth()
  const ehDono = usuario?.perfil === 'DONO'
  const ehEu = usuario?.profissionalId === profissionalId
  const mostraFinanceiro = ehDono || ehEu || Boolean(usuario?.permissoes.financeiroCompleto)
  const { data: p, loading, error, reload } = useAsync(() => get<ProfissionalDetalhe>(`/equipe/${encodeURIComponent(profissionalId)}`), [profissionalId])
  const [aba, setAba] = useState<Aba>('dados')

  function salvo() {
    reload()
    onChanged()
  }

  const tabs: Array<{ key: Aba; label: string }> = [
    { key: 'dados', label: 'Dados' },
    { key: 'jornada', label: 'Jornada semanal' },
    { key: 'ausencias', label: `Folgas e ausências${p?.ausencias.length ? ` (${p.ausencias.length})` : ''}` },
    ...(ehDono ? [{ key: 'remuneracao' as Aba, label: 'Remuneração e meta' }] : []),
    { key: 'acesso', label: 'Acesso e Google' },
    { key: 'resultados', label: 'Resultados' },
  ]

  return (
    <div>
      <button className="btn btn-sm btn-ghost eq-back" onClick={onBack}>
        ‹ Voltar para a equipe
      </button>
      {!p ? (
        loading ? <Loading /> : <ErrorBanner message={error || 'Profissional não encontrado.'} />
      ) : (
        <>
          <div className="eq-ficha-head" style={corVar(p.cor)}>
            <span className="eq-avatar eq-avatar-lg">{iniciais(p.nome)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>{p.nome}</h2>
              <div className="eq-badges">
                <span className={`badge ${p.ativo ? 'badge-success' : 'badge-gray'}`}>{p.ativo ? 'Ativo' : 'Inativo'}</span>
                {p.usuario ? <span className="badge badge-info">{p.usuario.perfil === 'DONO' ? 'Dono' : 'Com login'}</span> : <span className="badge badge-warning">Sem login</span>}
                {p.googleConectado ? <span className="badge badge-primary">Google conectado</span> : null}
                {ehEu ? <span className="badge badge-gray">Você</span> : null}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {[p.telefone ? phone(p.telefone) : null, p.email].filter(Boolean).join(' · ') || 'Sem contato cadastrado'}
              </div>
            </div>
          </div>
          <ErrorBanner message={error} />
          <Tabs tabs={tabs} value={aba} onChange={setAba} />
          <div className="card">
            {aba === 'dados' ? <DadosTab p={p} ehDono={ehDono} onSaved={salvo} /> : null}
            {aba === 'jornada' ? <JornadaEditor profissionalId={p.id} jornada={p.jornada} onSaved={salvo} /> : null}
            {aba === 'ausencias' ? <AusenciasTab profissionalId={p.id} ausencias={p.ausencias} onChanged={reload} /> : null}
            {aba === 'remuneracao' && ehDono ? <RemuneracaoTab p={p} onSaved={salvo} /> : null}
            {aba === 'acesso' ? <AcessoTab p={p} ehDono={ehDono} ehEu={ehEu} onSaved={salvo} /> : null}
            {aba === 'resultados' ? <ResultadosTab profissionalId={p.id} mostraFinanceiro={mostraFinanceiro} mostraRemuneracao={ehDono || ehEu} /> : null}
          </div>
        </>
      )}
    </div>
  )
}
