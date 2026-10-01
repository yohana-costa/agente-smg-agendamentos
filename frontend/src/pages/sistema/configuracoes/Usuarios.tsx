import { useEffect, useState } from 'react'
import { errorMessage, get, patch, post, put } from '../../../lib/api'
import { useAuth } from '../../../lib/auth'
import { dateTimeBr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, ConfirmModal, ErrorBanner, Field, Loading, Modal, Tabs, Toggle } from '../../../components/ui'
import { NAV_ITEMS } from '../../../layout/AppShell'
import type { Aba } from '../../../types'
import { CopyField } from '../agentes/CopyField'
import { SaveBar, useSalvar, type PermissoesPerfil, type UsuariosDados } from './shared'

const PERFIL: Record<string, { label: string; cls: string }> = {
  DONO: { label: 'Dono', cls: 'badge-primary' },
  RECEPCAO: { label: 'Recepção', cls: 'badge-info' },
  PROFISSIONAL: { label: 'Profissional', cls: 'badge-gray' },
}

const abaLabel = (a: Aba) => NAV_ITEMS.find((i) => i.key === a)?.label || a

type Usuario = UsuariosDados['usuarios'][number]

export function Usuarios() {
  const { usuario: eu } = useAuth()
  const dados = useAsync(() => get<UsuariosDados>('/configuracoes/usuarios'), [])
  const [novo, setNovo] = useState(false)
  const [redefinir, setRedefinir] = useState<Usuario | null>(null)
  const [senha, setSenha] = useState<{ titulo: string; email: string; senha: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erroLista, setErroLista] = useState('')

  async function alternar(u: Usuario, ativo: boolean) {
    setOcupado(u.id)
    setErroLista('')
    try {
      await patch(`/configuracoes/usuarios/${u.id}`, { ativo })
      if (dados.data) dados.setData({ ...dados.data, usuarios: dados.data.usuarios.map((x) => (x.id === u.id ? { ...x, ativo } : x)) })
    } catch (e) {
      setErroLista(errorMessage(e))
    } finally {
      setOcupado(null)
    }
  }

  if (dados.loading && !dados.data) return <Loading />
  if (!dados.data) return <ErrorBanner message={dados.error || 'Não foi possível carregar os usuários.'} />
  const d = dados.data

  return (
    <div className="stack">
      <Card
        title="Usuários"
        subtitle="Cada pessoa tem login próprio. Profissionais recebem acesso pela aba Equipe."
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setNovo(true)}>
            + Novo usuário de recepção
          </button>
        }
      >
        <ErrorBanner message={erroLista} />
        <div className="table-wrap" style={{ marginTop: erroLista ? 10 : 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Último acesso</th>
                <th>Ativo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.usuarios.map((u) => (
                <tr key={u.id}>
                  <td className="strong">
                    {u.nome} {u.id === eu?.id ? <span className="muted small">(você)</span> : null}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <span className={`badge ${PERFIL[u.perfil]?.cls || ''}`}>{PERFIL[u.perfil]?.label || u.perfil}</span>
                  </td>
                  <td className="small">{u.ultimoLoginEm ? dateTimeBr(u.ultimoLoginEm) : <span className="muted">Nunca acessou</span>}</td>
                  <td>
                    <Toggle checked={u.ativo} disabled={u.perfil === 'DONO' || ocupado === u.id} onChange={(v) => alternar(u, v)} />
                  </td>
                  <td className="right">
                    <button className="btn btn-sm" onClick={() => setRedefinir(u)}>
                      Redefinir senha
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <PermissoesEditor dados={d} onSalvo={(permissoes) => dados.setData({ ...d, permissoes })} />

      {novo ? (
        <NovoUsuario
          onClose={() => setNovo(false)}
          onCriado={(email, senhaTemp) => {
            setNovo(false)
            dados.reload()
            if (senhaTemp) setSenha({ titulo: 'Usuário criado', email, senha: senhaTemp })
          }}
        />
      ) : null}

      {redefinir ? (
        <ConfirmModal
          title="Redefinir senha"
          confirmLabel="Gerar senha temporária"
          onClose={() => setRedefinir(null)}
          onConfirm={async () => {
            const r = await patch<{ senhaTemporaria: string | null }>(`/configuracoes/usuarios/${redefinir.id}`, { redefinirSenha: true })
            if (r.senhaTemporaria) setSenha({ titulo: 'Senha redefinida', email: redefinir.email, senha: r.senhaTemporaria })
          }}
        >
          <p>
            Uma nova senha temporária será gerada para <strong>{redefinir.nome}</strong> ({redefinir.email}). A senha atual deixa de funcionar imediatamente.
          </p>
        </ConfirmModal>
      ) : null}

      {senha ? (
        <Modal
          title={senha.titulo}
          onClose={() => setSenha(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setSenha(null)}>
              Entendi
            </button>
          }
        >
          <div className="stack">
            <p>
              Envie estes dados de acesso para a pessoa. <strong>A senha temporária não será mostrada novamente.</strong>
            </p>
            <Field label="E-mail de login">
              <CopyField value={senha.email} />
            </Field>
            <Field label="Senha temporária">
              <div className="cf-temp-pass">{senha.senha}</div>
            </Field>
            <CopyField value={senha.senha} />
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function NovoUsuario({ onClose, onCriado }: { onClose: () => void; onCriado: (email: string, senha: string | null) => void }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function criar() {
    if (!nome.trim()) return setErro('Informe o nome.')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErro('Informe um e-mail válido.')
    setSalvando(true)
    setErro('')
    try {
      const r = await post<{ email: string; senhaTemporaria: string | null }>('/configuracoes/usuarios', { nome: nome.trim(), email: email.trim() })
      onCriado(r.email, r.senhaTemporaria)
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      title="Novo usuário de recepção"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={salvando}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={criar} disabled={salvando}>
            {salvando ? 'Criando...' : 'Criar usuário'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">A recepção cuida da operação do dia a dia. As abas liberadas seguem as permissões do perfil Recepção, logo abaixo da lista de usuários.</p>
        <Field label="Nome">
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </Field>
        <Field label="E-mail de login">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <p className="small muted">Uma senha temporária será gerada e mostrada uma única vez.</p>
        <ErrorBanner message={erro} />
      </div>
    </Modal>
  )
}

type PerfilEditavel = 'RECEPCAO' | 'PROFISSIONAL'

function PermissoesEditor({ dados, onSalvo }: { dados: UsuariosDados; onSalvo: (p: UsuariosDados['permissoes']) => void }) {
  const [perfil, setPerfil] = useState<PerfilEditavel>('RECEPCAO')
  const [perms, setPerms] = useState(dados.permissoes)
  const s = useSalvar()
  useEffect(() => setPerms(dados.permissoes), [dados.permissoes])

  const abas = dados.abas.filter((a) => a !== 'configuracoes')
  const atual = perms[perfil]
  const setAtual = (p: Partial<PermissoesPerfil>) => {
    setPerms((x) => ({ ...x, [perfil]: { ...x[perfil], ...p } }))
    s.setOk('')
  }
  const toggleAba = (a: Aba, v: boolean) => setAtual({ abas: v ? [...atual.abas.filter((x) => x !== a), a] : atual.abas.filter((x) => x !== a) })

  const salvar = () =>
    s.salvar(async () => {
      const r = await put<UsuariosDados['permissoes']>('/configuracoes/permissoes', {
        RECEPCAO: { abas: perms.RECEPCAO.abas, verFinanceiroVisaoGeral: Boolean(perms.RECEPCAO.verFinanceiroVisaoGeral), financeiroCompleto: Boolean(perms.RECEPCAO.financeiroCompleto) },
        PROFISSIONAL: { abas: perms.PROFISSIONAL.abas, verAgendaColegas: Boolean(perms.PROFISSIONAL.verAgendaColegas) },
      })
      onSalvo(r)
    }, 'Permissões salvas. Valem a partir do próximo carregamento de página de cada usuário.')

  return (
    <Card
      title="Permissões por perfil"
      subtitle="Ajuste o que cada perfil acessa. Configurações é sempre exclusiva do dono; o dono tem acesso total."
      actions={
        <button className="btn btn-sm btn-ghost" onClick={() => setAtual({ ...dados.padrao[perfil], abas: [...dados.padrao[perfil].abas] })}>
          Restaurar padrão de {perfil === 'RECEPCAO' ? 'Recepção' : 'Profissional'}
        </button>
      }
    >
      <Tabs<PerfilEditavel>
        tabs={[
          { key: 'RECEPCAO', label: 'Recepção' },
          { key: 'PROFISSIONAL', label: 'Profissional' },
        ]}
        value={perfil}
        onChange={setPerfil}
      />
      <div className="section-title" style={{ marginTop: 0 }}>
        Abas liberadas
      </div>
      <div className="cf-perm-grid">
        {abas.map((a) => (
          <label key={a} className="checkbox">
            <input type="checkbox" checked={atual.abas.includes(a)} onChange={(e) => toggleAba(a, e.target.checked)} />
            {abaLabel(a)}
          </label>
        ))}
      </div>
      <div className="section-title">Opções do perfil</div>
      {perfil === 'RECEPCAO' ? (
        <div className="stack-sm">
          <label className="checkbox">
            <input type="checkbox" checked={Boolean(atual.verFinanceiroVisaoGeral)} onChange={(e) => setAtual({ verFinanceiroVisaoGeral: e.target.checked })} />
            Ver números financeiros na Visão Geral
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={Boolean(atual.financeiroCompleto)} onChange={(e) => setAtual({ financeiroCompleto: e.target.checked })} />
            Acessar o Financeiro completo (desmarcado: apenas Recebimentos)
          </label>
        </div>
      ) : (
        <div className="stack-sm">
          <label className="checkbox">
            <input type="checkbox" checked={Boolean(atual.verAgendaColegas)} onChange={(e) => setAtual({ verAgendaColegas: e.target.checked })} />
            Ver a agenda dos colegas (somente leitura)
          </label>
          <span className="small muted">O profissional sempre opera apenas a própria agenda, os próprios clientes e o próprio desempenho.</span>
        </div>
      )}
      <SaveBar {...s} onSave={salvar} label="Salvar permissões" />
    </Card>
  )
}
