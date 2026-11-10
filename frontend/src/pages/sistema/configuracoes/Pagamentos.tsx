import { useEffect, useState } from 'react'
import { errorMessage, get, patch, post } from '../../../lib/api'
import { navigate, useQueryParam } from '../../../lib/router'
import { Card, ConfirmModal, ErrorBanner, SuccessBanner, Toggle } from '../../../components/ui'
import { SaveBar, useSalvar, type ConfigDados } from './shared'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** Site e agente: a cliente escolhe pagar online ou na clínica, menos nos meses marcados. */
function PagarNoLocal({ dados, onChange }: { dados: ConfigDados; onChange: (p: Partial<ConfigDados>) => void }) {
  const pg = dados.pagamentos
  const [ativo, setAtivo] = useState(pg.pagarNoLocalAtivo)
  const [meses, setMeses] = useState<number[]>(pg.mesesPagamentoAntecipado || [])
  const [sinal, setSinal] = useState<number>(pg.sinalPct ?? 100)
  const s = useSalvar()

  const alternarMes = (m: number) => setMeses((atual) => (atual.includes(m) ? atual.filter((x) => x !== m) : [...atual, m].sort((a, b) => a - b)))

  const salvar = () =>
    s.salvar(async () => {
      const r = await patch<ConfigDados['pagamentos']>('/configuracoes/pagamentos/regras', { pagarNoLocalAtivo: ativo, mesesPagamentoAntecipado: meses, sinalPct: sinal })
      onChange({ pagamentos: r })
    }, 'Regras de pagamento salvas. Valem para os próximos agendamentos.')

  return (
    <Card title="Pagar no local" subtitle="No site e no WhatsApp, a cliente pode escolher pagar agora (Pix ou cartão) ou pagar no dia, na clínica.">
      <div className="stack">
        <Toggle checked={ativo} onChange={setAtivo} label="Permitir que a cliente escolha pagar no local" />
        {ativo ? (
          <>
            <div>
              <div className="strong small" style={{ marginBottom: 6 }}>
                Meses com pagamento antecipado obrigatório
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {MESES.map((nome, i) => {
                  const m = i + 1
                  const sel = meses.includes(m)
                  return (
                    <button key={m} type="button" className={`btn btn-sm ${sel ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={sel} onClick={() => alternarMes(m)}>
                      {nome}
                    </button>
                  )
                })}
              </div>
            </div>
            {meses.length ? (
              <label className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="strong">Cobrar antecipado</span>
                <select className="select" style={{ width: 'auto' }} value={sinal} onChange={(e) => setSinal(Number(e.target.value))}>
                  {[20, 30, 40, 50, 100].map((p) => (
                    <option key={p} value={p}>
                      {p === 100 ? 'o valor inteiro' : `sinal de ${p}%`}
                    </option>
                  ))}
                </select>
                <span className="muted">{sinal < 100 ? 'o restante é pago no dia, na clínica' : ''}</span>
              </label>
            ) : null}
            <p className="small muted">
              {meses.length
                ? `Atendimentos em ${meses.map((m) => MESES_LONGOS[m - 1]).join(', ')} só são confirmados com ${sinal < 100 ? `o sinal de ${sinal}% pago online antes` : 'o pagamento online antes'}. Nos outros meses, a cliente escolhe.`
                : 'Nenhum mês marcado: a cliente sempre pode escolher pagar no local.'}{' '}
              Quem escolhe pagar no local já fica com o horário confirmado, e o valor é recebido ao finalizar o atendimento.
            </p>
          </>
        ) : (
          <p className="small muted">Desligado: todo agendamento pelo site e pelo WhatsApp exige o pagamento online antes.</p>
        )}
        <SaveBar {...s} onSave={salvar} label="Salvar regras de pagamento" />
      </div>
    </Card>
  )
}

/**
 * Conexão com o Mercado Pago pelo botão "Conectar" (OAuth), igual ao Gestor SMG varejo.
 * O dono autoriza a própria conta no site do Mercado Pago: o dinheiro dos agendamentos cai
 * na conta dele e ninguém precisa copiar token. A volta do OAuth chega com ?mp=ok|erro.
 */
export function Pagamentos({ dados, onChange }: { dados: ConfigDados; onChange: (p: Partial<ConfigDados>) => void }) {
  const pg = dados.pagamentos
  const retorno = useQueryParam('mp')
  const [msg, setMsg] = useState<{ ok?: string; erro?: string }>({})
  const [abrindo, setAbrindo] = useState(false)
  const [desconectar, setDesconectar] = useState(false)

  useEffect(() => {
    if (!retorno) return
    if (retorno === 'ok') setMsg({ ok: 'Mercado Pago conectado! Os pagamentos dos agendamentos já caem na sua conta.' })
    else setMsg({ erro: 'Não foi possível conectar o Mercado Pago. Tente de novo.' })
    navigate('/app/configuracoes?tab=pagamentos', { replace: true })
  }, [retorno])

  async function conectar() {
    setAbrindo(true)
    setMsg({})
    try {
      const { url } = await get<{ url: string }>('/configuracoes/pagamentos/conectar')
      window.location.href = url
    } catch (e) {
      setMsg({ erro: errorMessage(e) })
      setAbrindo(false)
    }
  }

  const badge =
    pg.modo === 'mercadopago' ? (
      <span className="badge badge-success">● Mercado Pago conectado</span>
    ) : pg.modo === 'simulado' ? (
      <span className="badge badge-warning">● Modo simulado (teste)</span>
    ) : (
      <span className="badge badge-danger">● Não conectado</span>
    )

  return (
    <div className="stack">
      <Card title="Gateway de pagamentos SMG" subtitle="Pix e cartão pelo gateway da SMG, conectado ao Mercado Pago." actions={badge}>
        {pg.conectado ? (
          <div className="banner success-banner" style={{ marginBottom: 12 }}>
            Pagamentos reais ativos. Os valores caem na sua conta Mercado Pago{pg.contaId ? ` (conta ${pg.contaId})` : ''} e os reembolsos são
            executados automaticamente.
            {!pg.viaOauth ? ' Esta conta foi ligada por token manual: reconecte pelo botão para a renovação automática.' : ''}
          </div>
        ) : (
          <div className="banner warning-banner" style={{ marginBottom: 12 }}>
            {pg.modo === 'simulado'
              ? 'Ambiente de teste: sem conta conectada, os links abrem uma tela de simulação e nada é cobrado.'
              : 'Conecte sua conta do Mercado Pago para receber pelos agendamentos. Enquanto isso, o site e o agente não conseguem gerar cobranças online.'}
          </div>
        )}

        <ErrorBanner message={msg.erro} />
        <SuccessBanner message={msg.ok} />

        <div className="form-actions">
          {pg.conectado ? (
            <>
              {!pg.viaOauth && pg.oauthDisponivel ? (
                <button className="btn btn-primary" onClick={conectar} disabled={abrindo}>
                  {abrindo ? 'Abrindo o Mercado Pago...' : 'Reconectar Mercado Pago'}
                </button>
              ) : null}
              <button className="btn btn-ghost danger-text" onClick={() => setDesconectar(true)}>
                Desconectar
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={conectar} disabled={abrindo || !pg.oauthDisponivel}>
              {abrindo ? 'Abrindo o Mercado Pago...' : 'Conectar Mercado Pago'}
            </button>
          )}
        </div>
        {!pg.oauthDisponivel ? <p className="small muted">A conexão com o Mercado Pago ainda não foi configurada na plataforma. Fale com o suporte da SMG.</p> : null}
      </Card>

      <PagarNoLocal dados={dados} onChange={onChange} />

      {desconectar ? (
        <ConfirmModal
          title="Desconectar Mercado Pago"
          danger
          confirmLabel="Desconectar"
          onClose={() => setDesconectar(false)}
          onConfirm={async () => {
            const r = await post<ConfigDados['pagamentos']>('/configuracoes/pagamentos/desconectar')
            onChange({ pagamentos: r })
            setMsg({ ok: 'Mercado Pago desconectado.' })
          }}
        >
          <p>O site e o agente param de gerar cobranças online até você conectar de novo. Os pagamentos já feitos continuam na sua conta.</p>
        </ConfirmModal>
      ) : null}
    </div>
  )
}
