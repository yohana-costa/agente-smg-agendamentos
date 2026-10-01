import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../../lib/api'
import { brl, dateBr, dateLong, phone } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { PbAlert, PbSpinner } from '../shared/components'
import type { AgendamentoPortal, PontosResposta, PortalMe } from '../shared/types'
import type { PortalClient } from './client'
import { DataBloco } from './MeusAgendamentos'

export function Historico({ client }: { client: PortalClient }) {
  const { data, loading, error } = useAsync(() => client.get<AgendamentoPortal[]>('/historico'), [client])
  if (loading && !data) return <PbSpinner />
  if (error && !data) return <PbAlert tipo="erro">{error}</PbAlert>
  const lista = data || []
  if (!lista.length) {
    return (
      <div className="pb-card pb-empty">
        <div className="pb-empty-icon">🗂</div>
        Seus atendimentos concluídos vão aparecer aqui.
      </div>
    )
  }
  return (
    <div className="stack-sm">
      {lista.map((a) => (
        <article key={a.id} className="pb-card pb-appt pb-appt-compact">
          <div className="pb-appt-top">
            <DataBloco data={a.data} />
            <div className="pb-appt-main">
              <div className="pb-option-title">{a.servicos.map((s) => s.nome).join(' + ')}</div>
              <div className="small muted">
                {dateLong(a.data)} · {a.hora}
                {a.profissional ? ` · ${a.profissional}` : ''}
              </div>
              {a.produtos.length ? <div className="small muted">+ {a.produtos.map((p) => `${p.quantidade}× ${p.nome}`).join(', ')}</div> : null}
            </div>
            <div className="pb-appt-value">{brl(a.valorTotal)}</div>
          </div>
        </article>
      ))}
    </div>
  )
}

export function Pontos({ client }: { client: PortalClient }) {
  const { data, loading, error } = useAsync(() => client.get<PontosResposta>('/pontos'), [client])
  if (loading && !data) return <PbSpinner />
  if (error && !data) return <PbAlert tipo="erro">{error}</PbAlert>
  if (!data?.ativo) return <PbAlert tipo="info">O programa de fidelidade não está ativo no momento.</PbAlert>
  const saldo = data.saldo || 0
  const recompensas = data.recompensas || []
  const movimentos = data.movimentos || []
  return (
    <div className="stack">
      <div className="pb-points-hero">
        <div className="pb-points-label">Seu saldo</div>
        <div className="pb-points-value">
          {saldo.toLocaleString('pt-BR')} <span>pontos</span>
        </div>
        <div className="pb-points-sub">Você ganha pontos a cada atendimento concluído.</div>
      </div>

      <section className="stack-sm">
        <div className="pb-label">Recompensas</div>
        {!recompensas.length ? (
          <div className="pb-card pb-empty-inline">Nenhuma recompensa cadastrada ainda.</div>
        ) : (
          recompensas.map((r) => {
            const faltam = Math.max(0, r.pontosCusto - saldo)
            const pct = Math.min(100, Math.round((saldo / Math.max(1, r.pontosCusto)) * 100))
            return (
              <div key={r.id} className={`pb-card pb-reward ${r.disponivel ? 'is-available' : ''}`}>
                <div className="row-between">
                  <div className="pb-option-title">{r.nome}</div>
                  {r.disponivel ? <span className="pb-badge-ok">Disponível</span> : <span className="pb-pill">faltam {faltam.toLocaleString('pt-BR')} pts</span>}
                </div>
                <div className="small muted">
                  {r.tipo === 'SERVICO_GRATIS' ? 'Serviço grátis' : `${r.descontoPct}% de desconto`}
                  {r.servico?.nome ? ` em ${r.servico.nome}` : ''} · {r.pontosCusto.toLocaleString('pt-BR')} pontos
                </div>
                {!r.disponivel ? (
                  <div className="pb-reward-bar">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                ) : (
                  <div className="small">Peça para usar no seu próximo atendimento.</div>
                )}
              </div>
            )
          })
        )}
      </section>

      <section className="stack-sm">
        <div className="pb-label">Extrato</div>
        {!movimentos.length ? (
          <div className="pb-card pb-empty-inline">Nenhuma movimentação ainda.</div>
        ) : (
          <div className="pb-card pb-list">
            {movimentos.map((m) => (
              <div key={m.id} className="pb-list-row">
                <div>
                  <div className="strong">{m.descricao || (m.tipo === 'GANHO' ? 'Pontos ganhos' : m.tipo === 'USO' ? 'Recompensa usada' : 'Ajuste')}</div>
                  <div className="small muted">{dateBr(m.createdAt)}</div>
                </div>
                <div className={`pb-points-delta ${m.pontos >= 0 ? 'is-plus' : 'is-minus'}`}>
                  {m.pontos >= 0 ? '+' : '−'}
                  {Math.abs(m.pontos).toLocaleString('pt-BR')}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export function Perfil({ client, me, onAtualizado }: { client: PortalClient; me: PortalMe; onAtualizado: (c: { nome: string; email: string | null }) => void }) {
  const [nome, setNome] = useState(me.cliente.nome)
  const [email, setEmail] = useState(me.cliente.email || '')
  const [salvando, setSalvando] = useState(false)
  const [msgPerfil, setMsgPerfil] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null)

  const [senhaAtual, setSenhaAtual] = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [alterando, setAlterando] = useState(false)
  const [msgSenha, setMsgSenha] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null)

  async function salvarPerfil(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    setMsgPerfil(null)
    try {
      const r = await client.patch<{ nome: string; telefone: string; email: string | null }>('/perfil', { nome: nome.trim(), email: email.trim() })
      onAtualizado({ nome: r.nome, email: r.email })
      setMsgPerfil({ tipo: 'sucesso', texto: 'Dados atualizados!' })
    } catch (err) {
      setMsgPerfil({ tipo: 'erro', texto: errorMessage(err) })
    } finally {
      setSalvando(false)
    }
  }

  async function alterarSenha(e: FormEvent) {
    e.preventDefault()
    if (novaSenha.length < 6 || novaSenha !== confirmar) return
    setAlterando(true)
    setMsgSenha(null)
    try {
      await client.post('/senha', { senhaAtual, novaSenha })
      setSenhaAtual('')
      setNovaSenha('')
      setConfirmar('')
      setMsgSenha({ tipo: 'sucesso', texto: 'Senha alterada com sucesso.' })
    } catch (err) {
      setMsgSenha({ tipo: 'erro', texto: errorMessage(err) })
    } finally {
      setAlterando(false)
    }
  }

  return (
    <div className="stack">
      <form className="pb-card stack" onSubmit={salvarPerfil}>
        <div className="pb-card-title">Seus dados</div>
        <div className="field">
          <label htmlFor="pb-p-nome">Nome</label>
          <input id="pb-p-nome" className="input" autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pb-p-email">E-mail</label>
          <input id="pb-p-email" className="input" type="email" autoComplete="email" placeholder="opcional" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Telefone</label>
          <input className="input" value={phone(me.cliente.telefone)} disabled />
          <span className="field-hint">O telefone identifica seu cadastro e não pode ser alterado por aqui.</span>
        </div>
        {msgPerfil ? <PbAlert tipo={msgPerfil.tipo}>{msgPerfil.texto}</PbAlert> : null}
        <button type="submit" className="btn btn-primary btn-lg" disabled={salvando || nome.trim().length < 2}>
          {salvando ? 'Salvando...' : 'Salvar dados'}
        </button>
      </form>

      <form className="pb-card stack" onSubmit={alterarSenha}>
        <div className="pb-card-title">Alterar senha</div>
        <div className="field">
          <label htmlFor="pb-s-atual">Senha atual</label>
          <input id="pb-s-atual" className="input" type="password" autoComplete="current-password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pb-s-nova">Nova senha</label>
          <input id="pb-s-nova" className="input" type="password" autoComplete="new-password" placeholder="Mínimo de 6 caracteres" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pb-s-conf">Confirme a nova senha</label>
          <input id="pb-s-conf" className="input" type="password" autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
          {confirmar && novaSenha !== confirmar ? <span className="field-hint danger-text">As senhas não conferem.</span> : null}
        </div>
        {msgSenha ? <PbAlert tipo={msgSenha.tipo}>{msgSenha.texto}</PbAlert> : null}
        <button type="submit" className="btn btn-lg" disabled={alterando || !senhaAtual || novaSenha.length < 6 || novaSenha !== confirmar}>
          {alterando ? 'Alterando...' : 'Alterar senha'}
        </button>
      </form>
    </div>
  )
}
