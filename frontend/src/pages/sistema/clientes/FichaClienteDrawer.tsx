import { useEffect, useState, type ReactNode } from 'react'
import { errorMessage, get, patch } from '../../../lib/api'
import { brl, dateTimeBr, phone, SEGMENTO_CLIENTE } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { navigate } from '../../../lib/router'
import { useAuth } from '../../../lib/auth'
import { Drawer, Empty, ErrorBanner, Field, Loading, StatusBadge, SuccessBanner } from '../../../components/ui'
import { dataCurta, iniciais, retornoAtrasado, SEGMENTO_BADGE, TIPO_MOVIMENTO, type FichaCliente } from './tipos'
import PacotesCliente from './PacotesCliente'

function Indicador({ label, value, danger }: { label: string; value: ReactNode; danger?: boolean }) {
  return (
    <div className="cl-ind">
      <div className="cl-ind-label">{label}</div>
      <div className={`cl-ind-value ${danger ? 'cl-danger' : ''}`}>{value}</div>
    </div>
  )
}

export default function FichaClienteDrawer({ clienteId, onClose, onSaved }: { clienteId: string; onClose: () => void; onSaved: () => void }) {
  const { usuario, podeVer } = useAuth()
  const podeEditar = usuario?.perfil === 'DONO' || usuario?.perfil === 'RECEPCAO'
  const { data, loading, error, reload } = useAsync(() => get<FichaCliente>(`/clientes/${encodeURIComponent(clienteId)}`), [clienteId])

  const [form, setForm] = useState({ nome: '', telefone: '', email: '', observacoes: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    if (!data) return
    setForm({
      nome: data.cliente.nome || '',
      telefone: phone(data.cliente.telefone),
      email: data.cliente.email || '',
      observacoes: data.cliente.observacoes || '',
    })
  }, [data])

  useEffect(() => {
    setSaved('')
    setSaveError('')
  }, [clienteId])

  const alterado =
    !!data &&
    (form.nome !== (data.cliente.nome || '') ||
      form.telefone.replace(/\D/g, '') !== phone(data.cliente.telefone).replace(/\D/g, '') ||
      form.email !== (data.cliente.email || '') ||
      form.observacoes !== (data.cliente.observacoes || ''))

  async function salvar() {
    if (!data) return
    if (!form.nome.trim()) {
      setSaveError('Informe o nome do cliente.')
      return
    }
    setSaving(true)
    setSaveError('')
    setSaved('')
    try {
      const body: Record<string, string> = { nome: form.nome.trim(), email: form.email.trim(), observacoes: form.observacoes }
      if (form.telefone.replace(/\D/g, '') !== phone(data.cliente.telefone).replace(/\D/g, '')) body.telefone = form.telefone
      await patch(`/clientes/${data.cliente.id}`, body)
      setSaved('Dados do cliente atualizados.')
      reload()
      onSaved()
    } catch (e) {
      setSaveError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const titulo = data ? 'Ficha do cliente' : 'Carregando...'
  const footer = (
    <>
      <button className="btn" onClick={onClose}>
        Fechar
      </button>
      {data && podeVer('agenda') ? (
        <button className="btn btn-primary" onClick={() => navigate(`/app/agenda?novo=1&clienteId=${encodeURIComponent(data.cliente.id)}`)}>
          + Novo agendamento
        </button>
      ) : null}
    </>
  )

  return (
    <Drawer title={titulo} onClose={onClose} footer={footer}>
      <div className="cl-ficha">
        {!data ? (
          loading ? <Loading /> : <ErrorBanner message={error || 'Cliente não encontrado.'} />
        ) : (
          <>
            <ErrorBanner message={error} />
            <div className="cl-ficha-head">
              <span className="cl-avatar cl-avatar-lg">{iniciais(data.cliente.nome)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cl-ficha-name">{data.cliente.nome}</div>
                <div className="muted">
                  {phone(data.cliente.telefone)}
                  {data.cliente.email ? ` · ${data.cliente.email}` : ''}
                </div>
              </div>
              {data.segmento ? <span className={`badge ${SEGMENTO_BADGE[data.segmento.segmento] || ''}`}>{SEGMENTO_CLIENTE[data.segmento.segmento]}</span> : null}
            </div>

            <div className="cl-indicadores">
              <Indicador label="Total gasto" value={brl(data.indicadores.totalGasto)} />
              <Indicador label="Visitas" value={data.indicadores.visitas} />
              <Indicador label="Frequência" value={data.indicadores.frequenciaDias !== null ? `A cada ${data.indicadores.frequenciaDias} dia(s)` : '—'} />
              <Indicador label="Último atendimento" value={dataCurta(data.indicadores.ultimoAtendimento)} />
              <Indicador
                label="Próximo retorno"
                value={dataCurta(data.indicadores.proximoRetorno)}
                danger={retornoAtrasado(data.indicadores.proximoRetorno)}
              />
              <Indicador label="No-shows" value={data.indicadores.noShows} danger={data.indicadores.noShows > 0} />
              <Indicador label="Cancelamentos" value={data.indicadores.cancelamentos} />
              {data.fidelidade ? <Indicador label="Pontos" value={data.fidelidade.saldo.toLocaleString('pt-BR')} /> : null}
            </div>

            <div className="cl-section">
              <div className="cl-section-title">
                <span>Dados cadastrais</span>
                {!podeEditar ? <span className="badge badge-gray">Somente leitura</span> : null}
              </div>
              {podeEditar ? (
                <div className="stack">
                  <div className="form-grid">
                    <Field label="Nome">
                      <input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
                    </Field>
                    <Field label="Telefone (WhatsApp)" hint="Identifica o cliente. Não pode repetir outro cadastro.">
                      <input className="input" inputMode="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
                    </Field>
                    <Field label="E-mail" className="full">
                      <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </Field>
                    <Field label="Observações" className="full">
                      <textarea className="textarea" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Preferências, alergias, informações importantes..." />
                    </Field>
                  </div>
                  <ErrorBanner message={saveError} />
                  <SuccessBanner message={saved} />
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-primary" onClick={salvar} disabled={saving || !alterado}>
                      {saving ? 'Salvando...' : 'Salvar alterações'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="form-grid">
                  <Field label="Nome">
                    <div>{data.cliente.nome}</div>
                  </Field>
                  <Field label="Telefone">
                    <div>{phone(data.cliente.telefone)}</div>
                  </Field>
                  <Field label="E-mail" className="full">
                    <div>{data.cliente.email || '—'}</div>
                  </Field>
                  <Field label="Observações" className="full">
                    <div className="cl-readonly">{data.cliente.observacoes || '—'}</div>
                  </Field>
                </div>
              )}
            </div>

            <PacotesCliente clienteId={data.cliente.id} podeEditar={podeEditar} />

            <div className="cl-section">
              <div className="cl-section-title">
                <span>Histórico de atendimentos</span>
                <span className="muted small">{data.historico.length} registro(s)</span>
              </div>
              {data.historico.length === 0 ? (
                <Empty icon="🗓">Nenhum atendimento registrado.</Empty>
              ) : (
                <div className="cl-hist-list">
                  {data.historico.map((a) => (
                    <div
                      key={a.id}
                      className="cl-hist-item"
                      role="button"
                      tabIndex={0}
                      title="Abrir na agenda"
                      onClick={() => navigate(`/app/agenda?agendamento=${encodeURIComponent(a.id)}`)}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/app/agenda?agendamento=${encodeURIComponent(a.id)}`)}
                    >
                      <div className="cl-hist-date">{dateTimeBr(a.inicio)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div className="strong">{a.servicos.map((s) => s.nome).join(', ') || '—'}</div>
                        <div className="small muted">
                          <span className="dot" style={{ background: a.profissional?.cor, marginRight: 6 }} />
                          {a.profissional?.nome}
                        </div>
                      </div>
                      <div className="cl-hist-right">
                        <span className="strong nowrap">{brl(a.valorTotal)}</span>
                        <StatusBadge agendamento={a} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {data.fidelidade ? (
              <div className="cl-section">
                <div className="cl-section-title">
                  <span>Fidelidade</span>
                  <span className="badge badge-primary">Saldo: {data.fidelidade.saldo.toLocaleString('pt-BR')} pontos</span>
                </div>
                {data.fidelidade.extrato.length === 0 ? (
                  <div className="muted small">Nenhuma movimentação de pontos.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Tipo</th>
                          <th>Descrição</th>
                          <th className="right">Pontos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.fidelidade.extrato.map((m) => (
                          <tr key={m.id}>
                            <td className="nowrap">{dateTimeBr(m.createdAt)}</td>
                            <td>{TIPO_MOVIMENTO[m.tipo] || m.tipo}</td>
                            <td>{m.descricao || '—'}</td>
                            <td className={`right ${m.pontos >= 0 ? 'cl-pontos-pos' : 'cl-pontos-neg'}`}>
                              {m.pontos > 0 ? '+' : ''}
                              {m.pontos.toLocaleString('pt-BR')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            <div className="small muted">Cliente desde {dataCurta(data.cliente.createdAt)}</div>
          </>
        )}
      </div>
    </Drawer>
  )
}
