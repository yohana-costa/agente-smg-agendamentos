import { useEffect, useState, type ReactNode } from 'react'
import { errorMessage, get, post } from '../../../lib/api'
import { phone, SEGMENTO_CLIENTE } from '../../../lib/format'
import { useAsync, useDebounced } from '../../../lib/hooks'
import { ErrorBanner, Loading, Modal } from '../../../components/ui'
import type { Cliente } from '../../../types'
import { dataCurta, iniciais, SEGMENTO_BADGE, type ClientesResposta } from './tipos'

type Lado = 'A' | 'B'
type ObsEscolha = 'A' | 'B' | 'AMBAS'

function ClientePicker({
  label,
  value,
  onChange,
  excluirId,
}: {
  label: string
  value: Cliente | null
  onChange: (c: Cliente | null) => void
  excluirId?: string
}) {
  const [busca, setBusca] = useState('')
  const termo = useDebounced(busca.trim(), 300)
  const { data, loading, error } = useAsync(
    () => (termo.length >= 2 ? get<ClientesResposta>('/clientes', { busca: termo }) : Promise.resolve(null)),
    [termo]
  )
  const resultados = (data?.clientes || []).filter((c) => c.id !== excluirId).slice(0, 8)

  return (
    <div className="cl-picker">
      <div className="field-label" style={{ marginBottom: 6 }}>
        {label}
      </div>
      {value ? (
        <div className="cl-picker-selected">
          <span className="cl-avatar">{iniciais(value.nome)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="strong">{value.nome}</div>
            <div className="small muted">{phone(value.telefone)}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>
            Trocar
          </button>
        </div>
      ) : (
        <>
          <input className="input" placeholder="Buscar por nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {termo.length >= 2 ? (
            <div className="cl-picker-results">
              {loading ? (
                <Loading label="Buscando..." />
              ) : error ? (
                <div style={{ padding: 8 }}>
                  <ErrorBanner message={error} />
                </div>
              ) : resultados.length === 0 ? (
                <div className="small muted" style={{ padding: 10 }}>
                  Nenhum cliente encontrado.
                </div>
              ) : (
                <div className="list">
                  {resultados.map((c) => (
                    <div key={c.id} className="list-item clickable" onClick={() => onChange(c)}>
                      <span className="cl-avatar">{iniciais(c.nome)}</span>
                      <div className="list-item-main">
                        <div className="list-item-title">{c.nome}</div>
                        <div className="list-item-sub">{phone(c.telefone)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="small muted" style={{ marginTop: 6 }}>
              Digite ao menos 2 caracteres.
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Opcao({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="cl-option">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  )
}

function Valor({ v }: { v: string | null | undefined }) {
  return v ? <span>{v}</span> : <span className="cl-option-empty">(vazio)</span>
}

export default function MesclarModal({ inicial, onClose, onMerged }: { inicial?: Cliente | null; onClose: () => void; onMerged: (mantidoId: string) => void }) {
  const [a, setA] = useState<Cliente | null>(inicial || null)
  const [b, setB] = useState<Cliente | null>(null)
  const [telefone, setTelefone] = useState<Lado>('A')
  const [nome, setNome] = useState<Lado>('A')
  const [email, setEmail] = useState<Lado>('A')
  const [obs, setObs] = useState<ObsEscolha>('AMBAS')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  // padroes inteligentes: email/observacoes preenchidos sao preferidos
  useEffect(() => {
    if (!a || !b) return
    setEmail(!a.email && b.email ? 'B' : 'A')
    setObs(a.observacoes && b.observacoes ? 'AMBAS' : !a.observacoes && b.observacoes ? 'B' : 'A')
    setConfirmando(false)
  }, [a, b])

  const pronto = Boolean(a && b)
  const manter = telefone === 'A' ? a : b
  const remover = telefone === 'A' ? b : a
  const pick = (lado: Lado) => (lado === 'A' ? a : b)

  async function mesclar() {
    if (!a || !b || !manter || !remover) return
    setSaving(true)
    setError('')
    try {
      const observacoes =
        obs === 'AMBAS' ? [a.observacoes, b.observacoes].filter(Boolean).join('\n') : (pick(obs)?.observacoes ?? '')
      const r = await post<{ mantidoId: string }>('/clientes/mesclar', {
        manterId: manter.id,
        removerId: remover.id,
        telefone: manter.telefone,
        nome: pick(nome)?.nome,
        email: pick(email)?.email ?? '',
        observacoes,
      })
      onMerged(r.mantidoId)
    } catch (e) {
      setError(errorMessage(e))
      setConfirmando(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Mesclar cadastros duplicados"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={confirmando ? () => setConfirmando(false) : onClose} disabled={saving}>
            {confirmando ? 'Voltar' : 'Cancelar'}
          </button>
          {confirmando ? (
            <button className="btn btn-danger" onClick={mesclar} disabled={saving}>
              {saving ? 'Mesclando...' : 'Confirmar mesclagem'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => setConfirmando(true)} disabled={!pronto}>
              Continuar
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="muted">
          Una dois cadastros da mesma pessoa (por exemplo, quando ela usou outro número). Você escolhe qual telefone e quais dados ficam; o histórico de
          atendimentos, pagamentos, pontos e conversas dos dois cadastros é unido.
        </div>

        <div className="cl-merge-pick">
          <ClientePicker label="Cadastro 1" value={a} onChange={setA} excluirId={b?.id} />
          <ClientePicker label="Cadastro 2" value={b} onChange={setB} excluirId={a?.id} />
        </div>

        {a && b ? (
          <>
            <div className="table-wrap">
              <table className="table cl-merge-table">
                <thead>
                  <tr>
                    <th>Campo</th>
                    <th>Cadastro 1</th>
                    <th>Cadastro 2</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Telefone</td>
                    <td>
                      <Opcao name="tel" checked={telefone === 'A'} onChange={() => setTelefone('A')}>
                        {phone(a.telefone)}
                      </Opcao>
                    </td>
                    <td>
                      <Opcao name="tel" checked={telefone === 'B'} onChange={() => setTelefone('B')}>
                        {phone(b.telefone)}
                      </Opcao>
                    </td>
                  </tr>
                  <tr>
                    <td>Nome</td>
                    <td>
                      <Opcao name="nome" checked={nome === 'A'} onChange={() => setNome('A')}>
                        {a.nome}
                      </Opcao>
                    </td>
                    <td>
                      <Opcao name="nome" checked={nome === 'B'} onChange={() => setNome('B')}>
                        {b.nome}
                      </Opcao>
                    </td>
                  </tr>
                  <tr>
                    <td>E-mail</td>
                    <td>
                      <Opcao name="email" checked={email === 'A'} onChange={() => setEmail('A')}>
                        <Valor v={a.email} />
                      </Opcao>
                    </td>
                    <td>
                      <Opcao name="email" checked={email === 'B'} onChange={() => setEmail('B')}>
                        <Valor v={b.email} />
                      </Opcao>
                    </td>
                  </tr>
                  <tr>
                    <td>Observações</td>
                    <td>
                      <Opcao name="obs" checked={obs === 'A'} onChange={() => setObs('A')}>
                        <Valor v={a.observacoes} />
                      </Opcao>
                    </td>
                    <td>
                      <Opcao name="obs" checked={obs === 'B'} onChange={() => setObs('B')}>
                        <Valor v={b.observacoes} />
                      </Opcao>
                      <Opcao name="obs" checked={obs === 'AMBAS'} onChange={() => setObs('AMBAS')}>
                        Juntar as duas
                      </Opcao>
                    </td>
                  </tr>
                  <tr>
                    <td>Situação</td>
                    <td>
                      {a.segmento ? <span className={`badge ${SEGMENTO_BADGE[a.segmento] || ''}`}>{SEGMENTO_CLIENTE[a.segmento]}</span> : '—'}
                      <div className="small muted">Último atendimento: {dataCurta(a.ultimoAtendimento)}</div>
                    </td>
                    <td>
                      {b.segmento ? <span className={`badge ${SEGMENTO_BADGE[b.segmento] || ''}`}>{SEGMENTO_CLIENTE[b.segmento]}</span> : '—'}
                      <div className="small muted">Último atendimento: {dataCurta(b.ultimoAtendimento)}</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {confirmando && manter && remover ? (
              <div className="banner warning-banner">
                <div>
                  <strong>Confirme a mesclagem.</strong> O cadastro final ficará com o telefone <strong>{phone(manter.telefone)}</strong> e o nome{' '}
                  <strong>{pick(nome)?.nome}</strong>. O cadastro com o telefone {phone(remover.telefone)} deixará de existir e todo o histórico dele
                  (incluindo pontos) será transferido. Esta ação não pode ser desfeita.
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="banner info-banner">Selecione os dois cadastros que deseja unir.</div>
        )}

        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}
