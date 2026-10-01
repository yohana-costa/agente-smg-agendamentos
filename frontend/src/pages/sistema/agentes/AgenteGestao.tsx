import { useState } from 'react'
import { del, errorMessage, patch, post } from '../../../lib/api'
import { phone } from '../../../lib/format'
import { Card, ConfirmModal, Empty, ErrorBanner, Field, Modal, Toggle } from '../../../components/ui'
import { moduloLabel, semSegredos, type AgenteConfig, type AgentesDados, type NumeroAutorizado, type PermissoesNumero } from './types'

type Form = { id?: string; nome: string; telefone: string; ativo: boolean; permissoes: PermissoesNumero }

export function AgenteGestao({
  dados,
  isDono,
  onConfig,
  onNumeros,
  irPara,
}: {
  dados: AgentesDados
  isDono: boolean
  onConfig: (c: Partial<AgenteConfig>) => void
  onNumeros: (n: NumeroAutorizado[]) => void
  irPara: (tab: 'simulador') => void
}) {
  const numeros = dados.numerosAutorizados
  const modulos = dados.modulos
  const [form, setForm] = useState<Form | null>(null)
  const [remover, setRemover] = useState<NumeroAutorizado | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [erroLista, setErroLista] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)

  async function alternarAgente(ativo: boolean) {
    setOcupado('agente')
    setErroLista('')
    try {
      const r = await patch<AgenteConfig>('/agentes/atendimento', { gestaoAtivo: ativo })
      onConfig(semSegredos(r))
    } catch (e) {
      setErroLista(errorMessage(e))
    } finally {
      setOcupado(null)
    }
  }

  async function alternarNumero(n: NumeroAutorizado, ativo: boolean) {
    setOcupado(n.id)
    setErroLista('')
    try {
      const r = await patch<NumeroAutorizado>(`/agentes/numeros/${n.id}`, { ativo })
      onNumeros(numeros.map((x) => (x.id === n.id ? r : x)))
    } catch (e) {
      setErroLista(errorMessage(e))
    } finally {
      setOcupado(null)
    }
  }

  function toggleMatriz(modulo: string, tipo: 'consultar' | 'alterar', marcado: boolean) {
    if (!form) return
    const p = { consultar: [...form.permissoes.consultar], alterar: [...form.permissoes.alterar] }
    const add = (lista: string[]) => (lista.includes(modulo) ? lista : [...lista, modulo])
    const rem = (lista: string[]) => lista.filter((m) => m !== modulo)
    if (tipo === 'consultar') {
      p.consultar = marcado ? add(p.consultar) : rem(p.consultar)
      if (!marcado) p.alterar = rem(p.alterar) // sem consultar nao faz sentido alterar
    } else {
      p.alterar = marcado ? add(p.alterar) : rem(p.alterar)
      if (marcado) p.consultar = add(p.consultar)
    }
    setForm({ ...form, permissoes: p })
  }

  function marcarTodos(tipo: 'consultar' | 'alterar' | 'nenhum') {
    if (!form) return
    if (tipo === 'nenhum') return setForm({ ...form, permissoes: { consultar: [], alterar: [] } })
    if (tipo === 'consultar') return setForm({ ...form, permissoes: { consultar: [...modulos], alterar: form.permissoes.alterar } })
    setForm({ ...form, permissoes: { consultar: [...modulos], alterar: [...modulos] } })
  }

  async function salvar() {
    if (!form) return
    if (!form.nome.trim()) return setErro('Informe o nome da pessoa.')
    if (!form.id && form.telefone.replace(/\D/g, '').length < 10) return setErro('Informe o telefone com DDD.')
    setSalvando(true)
    setErro('')
    try {
      if (form.id) {
        const r = await patch<NumeroAutorizado>(`/agentes/numeros/${form.id}`, { nome: form.nome.trim(), permissoes: form.permissoes, ativo: form.ativo })
        onNumeros(numeros.map((x) => (x.id === r.id ? r : x)))
      } else {
        let r = await post<NumeroAutorizado>('/agentes/numeros', { nome: form.nome.trim(), telefone: form.telefone, permissoes: form.permissoes })
        if (!form.ativo) r = await patch<NumeroAutorizado>(`/agentes/numeros/${r.id}`, { ativo: false })
        onNumeros([...numeros, r].sort((a, b) => a.nome.localeCompare(b.nome)))
      }
      setForm(null)
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  const permLinha = (lista: string[]) => (lista.length ? lista.map((m) => <span key={m} className="badge badge-gray">{moduloLabel(m)}</span>) : <span className="muted">nada</span>)

  return (
    <div className="stack">
      <div className="ia-hero">
        <div>
          <div className="ia-hero-title">Agente de Gestão</div>
          <div className="ia-hero-sub">
            Funciona como um funcionário do estabelecimento dentro do WhatsApp: consulta a agenda, faturamento e clientes, cria e remarca agendamentos, bloqueia horários, registra despesas e gera relatórios. Só atende os números autorizados abaixo, e apenas no que cada um tem permissão.
          </div>
        </div>
        <Toggle checked={dados.config.gestaoAtivo} disabled={ocupado === 'agente'} onChange={alternarAgente} label={dados.config.gestaoAtivo ? 'Ativo' : 'Desativado'} />
      </div>

      <div className="banner info-banner">
        Mensagens que chegam de um número autorizado (e ativo) vão para o Agente de Gestão. Todos os demais números falam com o Agente de Atendimento.
      </div>

      <ErrorBanner message={erroLista} />

      <Card
        title="Números autorizados"
        subtitle="Cada número tem permissões próprias: o que pode consultar e o que pode alterar pelo agente."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => irPara('simulador')} disabled={!numeros.length}>
              Testar no simulador
            </button>
            {isDono ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setErro('')
                  setForm({ nome: '', telefone: '', ativo: true, permissoes: { consultar: [...modulos], alterar: [] } })
                }}
              >
                + Autorizar número
              </button>
            ) : null}
          </>
        }
      >
        {!isDono ? <div className="banner warning-banner" style={{ marginBottom: 12 }}>Apenas o dono pode autorizar números e alterar permissões.</div> : null}
        {numeros.length === 0 ? (
          <Empty icon="☎">Nenhum número autorizado. {isDono ? 'Autorize o seu número para começar a usar o Agente de Gestão.' : ''}</Empty>
        ) : (
          numeros.map((n) => (
            <div key={n.id} className={`ia-numero ${n.ativo ? '' : 'inativo'}`}>
              <div className="ia-numero-main">
                <div className="row">
                  <span className="strong">{n.nome}</span>
                  <span className="muted small">{phone(n.telefone)}</span>
                  {!n.ativo ? <span className="badge badge-gray">Inativo</span> : null}
                </div>
                <div className="ia-perm-line">
                  <span className="lbl">Consultar:</span>
                  {permLinha(n.permissoes?.consultar || [])}
                </div>
                <div className="ia-perm-line">
                  <span className="lbl">Alterar:</span>
                  {permLinha(n.permissoes?.alterar || [])}
                </div>
              </div>
              <div className="row" style={{ flexShrink: 0 }}>
                <Toggle checked={n.ativo} disabled={!isDono || ocupado === n.id} onChange={(v) => alternarNumero(n, v)} />
                {isDono ? (
                  <>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setErro('')
                        setForm({ id: n.id, nome: n.nome, telefone: n.telefone, ativo: n.ativo, permissoes: { consultar: [...(n.permissoes?.consultar || [])], alterar: [...(n.permissoes?.alterar || [])] } })
                      }}
                    >
                      Editar
                    </button>
                    <button className="btn btn-sm btn-ghost danger-text" onClick={() => setRemover(n)}>
                      Remover
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Card>

      {form ? (
        <Modal
          title={form.id ? 'Editar número autorizado' : 'Autorizar número'}
          onClose={() => setForm(null)}
          size="lg"
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)} disabled={salvando}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="form-grid">
              <Field label="Nome">
                <input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Ana (gerente)" />
              </Field>
              <Field label="WhatsApp" hint={form.id ? 'Para trocar o número, remova e autorize novamente.' : 'Com DDD. Ex.: (11) 99999-9999'}>
                <input className="input" inputMode="tel" value={form.id ? phone(form.telefone) : form.telefone} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
              </Field>
            </div>
            <Toggle checked={form.ativo} onChange={(ativo) => setForm({ ...form, ativo })} label="Número ativo" />
            <div>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <span className="field-label">Permissões pelo agente</span>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => marcarTodos('consultar')}>
                    Consultar tudo
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => marcarTodos('alterar')}>
                    Acesso total
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => marcarTodos('nenhum')}>
                    Limpar
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table className="ia-matrix">
                  <thead>
                    <tr>
                      <th>Módulo</th>
                      <th className="c">Consultar</th>
                      <th className="c">Alterar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modulos.map((m) => (
                      <tr key={m}>
                        <td className="strong">{moduloLabel(m)}</td>
                        <td className="c">
                          <input type="checkbox" checked={form.permissoes.consultar.includes(m)} onChange={(e) => toggleMatriz(m, 'consultar', e.target.checked)} aria-label={`Consultar ${moduloLabel(m)}`} />
                        </td>
                        <td className="c">
                          <input type="checkbox" checked={form.permissoes.alterar.includes(m)} onChange={(e) => toggleMatriz(m, 'alterar', e.target.checked)} aria-label={`Alterar ${moduloLabel(m)}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="field-hint" style={{ marginTop: 6 }}>
                Consultar: ver informações e relatórios. Alterar: criar, editar e cancelar registros naquele módulo (inclui consultar).
              </div>
            </div>
            <ErrorBanner message={erro} />
          </div>
        </Modal>
      ) : null}

      {remover ? (
        <ConfirmModal
          title="Remover número autorizado"
          danger
          confirmLabel="Remover"
          onClose={() => setRemover(null)}
          onConfirm={async () => {
            await del(`/agentes/numeros/${remover.id}`)
            onNumeros(numeros.filter((x) => x.id !== remover.id))
          }}
        >
          <p>
            <strong>{remover.nome}</strong> ({phone(remover.telefone)}) deixará de falar com o Agente de Gestão. Novas mensagens desse número serão tratadas pelo Agente de Atendimento.
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  )
}
