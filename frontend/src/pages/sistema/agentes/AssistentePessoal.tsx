import { useEffect, useState } from 'react'
import { errorMessage, get, patch, post } from '../../../lib/api'
import { dateTimeBr, phone } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Field, Loading, SuccessBanner, Toggle } from '../../../components/ui'

/**
 * Assistente pessoal: avisos para a dona/equipe pelo WhatsApp conectado.
 * No numero oficial (Meta/Datafy) o resumo diario sai por template com o botao "Ver alertas",
 * que abre a janela de 24h; ver alertas.service no backend.
 */
type Template = { nome: string; status: string; motivo?: string | null }
type Alerta = { id: string; tipo: string; titulo: string; texto: string; urgente: boolean; enviadoEm: string | null; templateEm: string | null; createdAt: string }
type Dados = {
  numeros: string[]
  tipos: string[]
  horaResumo: string
  provider: string
  templates: { necessario: boolean; wabaId?: string | null; erro?: string; templates: Template[] }
  recentes: Alerta[]
}

const TIPOS: { key: string; titulo: string; descricao: string }[] = [
  { key: 'RESUMO_DIARIO', titulo: 'Resumo diário', descricao: 'Atendimentos do dia, faturamento de ontem, pagamentos pendentes, estoque baixo e avisos.' },
  { key: 'EQUIPE', titulo: 'Dúvidas e atendimento humano', descricao: 'Quando a IA não sabe responder ou a cliente pede para falar com alguém. Responder a mensagem devolve a resposta para a cliente.' },
  { key: 'NOVO_AGENDAMENTO', titulo: 'Novos agendamentos', descricao: 'Horários marcados pelo site, pela IA ou pela área da cliente.' },
  { key: 'CANCELAMENTO', titulo: 'Cancelamentos', descricao: 'Quando a cliente cancela e o horário fica livre.' },
]

const STATUS_TEMPLATE: Record<string, { rotulo: string; classe: string }> = {
  APPROVED: { rotulo: 'Aprovado', classe: 'badge-success' },
  PENDING: { rotulo: 'Em análise na Meta', classe: 'badge-warning' },
  REJECTED: { rotulo: 'Recusado', classe: 'badge-danger' },
  NAO_CRIADO: { rotulo: 'Não criado', classe: 'badge-gray' },
  SEM_WABA: { rotulo: 'Falta o WABA ID', classe: 'badge-gray' },
  DESCONHECIDO: { rotulo: 'Não consegui consultar', classe: 'badge-gray' },
}

const ROTULO_TIPO: Record<string, string> = {
  RESUMO_DIARIO: 'Resumo',
  EQUIPE: 'Dúvida',
  NOVO_AGENDAMENTO: 'Agendamento',
  CANCELAMENTO: 'Cancelamento',
  TESTE: 'Teste',
}

export function AssistentePessoal({ isDono }: { isDono: boolean }) {
  const { data, loading, error, reload } = useAsync(() => get<Dados>('/agentes/alertas'), [])
  const [numeros, setNumeros] = useState<string[]>([])
  const [novoNumero, setNovoNumero] = useState('')
  const [tipos, setTipos] = useState<string[]>([])
  const [hora, setHora] = useState('08:00')
  const [wabaId, setWabaId] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [acao, setAcao] = useState('')
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    if (!data) return
    setNumeros(data.numeros)
    setTipos(data.tipos)
    setHora(data.horaResumo)
    setWabaId(data.templates.wabaId || '')
  }, [data])

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBanner message={error} />
  if (!data) return null

  const oficial = data.templates.necessario
  const aprovados = data.templates.templates.filter((t) => t.status === 'APPROVED').length

  function adicionarNumero() {
    const d = novoNumero.replace(/\D/g, '')
    if (d.length < 10) return setErro('Informe o número com DDD.')
    const n = d.length <= 11 ? `55${d}` : d
    if (!numeros.includes(n)) setNumeros([...numeros, n])
    setNovoNumero('')
    setErro('')
  }

  async function salvar() {
    setSalvando(true)
    setErro('')
    setOk('')
    try {
      await patch('/agentes/alertas', { numeros, tipos, horaResumo: hora, ...(oficial ? { wabaId } : {}) })
      setOk('Assistente pessoal salvo.')
      reload()
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  async function executar(nome: string, fn: () => Promise<string>) {
    setAcao(nome)
    setErro('')
    setOk('')
    try {
      setOk(await fn())
      reload()
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setAcao('')
    }
  }

  return (
    <div className="stack">
      <div className="ia-hero">
        <div>
          <div className="ia-hero-title">Assistente pessoal</div>
          <div className="ia-hero-sub">Avisos para você e sua equipe no WhatsApp, enviados pelo número conectado do estabelecimento.</div>
        </div>
      </div>

      <SuccessBanner message={ok} />
      <ErrorBanner message={erro} />

      <Card title="Quem recebe os avisos" subtitle="O WhatsApp pessoal da dona ou de quem cuida da recepção. Não use o número do próprio estabelecimento.">
        <div className="stack">
          {numeros.length ? (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {numeros.map((n) => (
                <span key={n} className="badge badge-gray" style={{ padding: '6px 10px' }}>
                  {phone(n)}{' '}
                  {isDono ? (
                    <button className="icon-btn" style={{ marginLeft: 4 }} onClick={() => setNumeros(numeros.filter((x) => x !== n))} aria-label="Remover">
                      ×
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : (
            <div className="small muted">Nenhum número ainda. Sem número, os avisos ficam só aqui no painel.</div>
          )}
          {isDono ? (
            <div className="row">
              <input className="input" style={{ maxWidth: 240 }} inputMode="tel" placeholder="(11) 99999-9999" value={novoNumero} onChange={(e) => setNovoNumero(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adicionarNumero()} />
              <button className="btn" onClick={adicionarNumero}>
                Adicionar
              </button>
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="Quais avisos receber">
        <div className="stack">
          {TIPOS.map((t) => (
            <div key={t.key} className="row-between" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="strong">{t.titulo}</div>
                <div className="small muted">{t.descricao}</div>
                {t.key === 'RESUMO_DIARIO' && tipos.includes('RESUMO_DIARIO') ? (
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="small">Enviar às</span>
                    <input className="input input-sm" type="time" style={{ width: 120 }} value={hora} disabled={!isDono} onChange={(e) => setHora(e.target.value)} />
                  </div>
                ) : null}
              </div>
              <Toggle
                checked={tipos.includes(t.key)}
                disabled={!isDono}
                onChange={(v) => setTipos(v ? [...tipos, t.key] : tipos.filter((x) => x !== t.key))}
              />
            </div>
          ))}
        </div>
      </Card>

      {oficial ? (
        <Card
          title="Templates da Meta"
          subtitle="No WhatsApp oficial, mensagem para quem não falou com o número nas últimas 24h só sai por template aprovado. São dois: o resumo diário e o aviso urgente, os dois com o botão “Ver alertas”."
        >
          <div className="stack">
            <Field label="WABA ID do número conectado" hint="Fica no painel da Datafy, nos dados do canal (WhatsApp Business Account ID).">
              <input className="input mono" style={{ maxWidth: 260 }} value={wabaId} disabled={!isDono} onChange={(e) => setWabaId(e.target.value.replace(/\D/g, ''))} />
            </Field>
            {data.templates.erro ? <div className="small danger-text">{data.templates.erro}</div> : null}
            <div className="stack-sm">
              {data.templates.templates.map((t) => {
                const s = STATUS_TEMPLATE[t.status] || { rotulo: t.status, classe: 'badge-gray' }
                return (
                  <div key={t.nome} className="row">
                    <span className="mono small">{t.nome}</span>
                    <span className={`badge ${s.classe}`}>{s.rotulo}</span>
                    {t.motivo ? <span className="small muted">({t.motivo})</span> : null}
                  </div>
                )
              })}
            </div>
            {isDono ? (
              <div className="row">
                <button
                  className="btn"
                  disabled={!!acao || !data.templates.wabaId || aprovados === data.templates.templates.length}
                  onClick={() =>
                    executar('templates', async () => {
                      const r = await post<{ criados: string[] }>('/agentes/alertas/templates', {})
                      return r.criados.length ? `Enviados para análise da Meta: ${r.criados.join(', ')}. A aprovação leva de minutos a 1 dia.` : 'Os templates já existem.'
                    })
                  }
                >
                  {acao === 'templates' ? 'Criando...' : 'Criar templates na Meta'}
                </button>
                {!data.templates.wabaId ? <span className="small muted">Salve o WABA ID primeiro.</span> : null}
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {isDono ? (
        <div className="form-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            className="btn"
            disabled={!!acao || !data.numeros.length}
            onClick={() =>
              executar('teste', async () => {
                const r = await post<{ alerta: Alerta | null }>('/agentes/alertas/teste', {})
                if (r.alerta?.enviadoEm) return 'Teste enviado como mensagem.'
                if (r.alerta?.templateEm) return 'Teste enviado pelo template urgente (a janela de 24h estava fechada).'
                return 'O teste ficou no painel, mas não saiu no WhatsApp. Com o número oficial, isso acontece quando o template ainda não foi aprovado.'
              })
            }
          >
            {acao === 'teste' ? 'Enviando...' : 'Enviar teste'}
          </button>
          <button
            className="btn"
            disabled={!!acao || !data.numeros.length}
            onClick={() =>
              executar('resumo', async () => {
                const r = await post<{ enviados: number }>('/agentes/alertas/resumo', {})
                return r.enviados ? 'Resumo enviado agora.' : 'Não consegui enviar o resumo.'
              })
            }
          >
            {acao === 'resumo' ? 'Enviando...' : 'Enviar resumo agora'}
          </button>
          {!data.numeros.length ? <span className="small muted">Salve um número para testar.</span> : null}
        </div>
      ) : null}

      <Card title="Avisos recentes" subtitle="Todos os avisos ficam aqui, mesmo os que não saíram no WhatsApp.">
        {!data.recentes.length ? (
          <Empty icon="🔔">Nenhum aviso ainda.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Aviso</th>
                  <th>Quando</th>
                  <th>WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {data.recentes.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="strong">
                        {a.titulo} <span className="badge badge-gray">{ROTULO_TIPO[a.tipo] || a.tipo}</span>
                      </div>
                      <div className="small muted" style={{ whiteSpace: 'pre-line' }}>{a.texto}</div>
                    </td>
                    <td className="nowrap small">{dateTimeBr(a.createdAt)}</td>
                    <td className="nowrap small">
                      {a.enviadoEm ? 'Entregue' : a.templateEm ? 'Template enviado' : data.numeros.length ? 'Pendente' : 'Só no painel'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
