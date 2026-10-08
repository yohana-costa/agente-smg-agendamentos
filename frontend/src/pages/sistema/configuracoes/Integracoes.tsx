import { useState } from 'react'
import { get, post } from '../../../lib/api'
import { dateBr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Link } from '../../../lib/router'
import { Card, ConfirmModal } from '../../../components/ui'
import type { ConfigDados } from './shared'

export function Integracoes({ dados }: { dados: ConfigDados }) {
  const agentes = useAsync(() => get<{ whatsappConectado: boolean; config: { whatsappNumero: string | null; whatsappProvider: string } }>('/agentes'), [])
  return (
    <div className="stack">
      <Card>
        <div className="cf-integ">
          <div className="cf-integ-icon">💬</div>
          <div style={{ flex: 1 }}>
            <div className="row-between">
              <div className="card-title">WhatsApp</div>
              {agentes.loading ? (
                <span className="badge">Verificando...</span>
              ) : agentes.data ? (
                agentes.data.whatsappConectado ? (
                  <span className="badge badge-success">● Conectado ({agentes.data.config.whatsappProvider === 'meta' ? 'Meta Cloud API' : 'Uazapi'})</span>
                ) : (
                  <span className="badge badge-danger">● Não conectado</span>
                )
              ) : (
                <span className="badge">Status indisponível</span>
              )}
            </div>
            <p className="small muted" style={{ margin: '4px 0 10px' }}>
              Número usado pelo Agente de Atendimento, pelo Agente de Gestão e pelas mensagens automáticas. A conexão (provedor, credenciais e webhook) é configurada na aba Agentes de IA.
            </p>
            <Link className="btn btn-sm" to="/app/agentes?tab=whatsapp">
              Abrir Conexão WhatsApp →
            </Link>
          </div>
        </div>
      </Card>
      <Card>
        <div className="cf-integ">
          <div className="cf-integ-icon">📆</div>
          <div style={{ flex: 1 }}>
            <div className="row-between">
              <div className="card-title">Google Calendar</div>
              {dados.integracoes.googleConfigurado ? <span className="badge badge-success">● Disponível</span> : <span className="badge badge-warning">● Não configurado no servidor</span>}
            </div>
            <p className="small muted" style={{ margin: '4px 0 10px' }}>
              Cada profissional conecta a própria conta do Google pelo seu login, na aba Equipe. Os eventos do Google bloqueiam os horários na agenda, no site e no agente.
              {dados.integracoes.googleConfigurado ? '' : ' A integração ainda não foi habilitada no servidor (credenciais OAuth do Google ausentes).'}
            </p>
            <Link className="btn btn-sm" to="/app/equipe">
              Ir para Equipe →
            </Link>
          </div>
        </div>
      </Card>
    </div>
  )
}

const PLANO_LABEL: Record<string, string> = { ESSENCIAL: 'Essencial', PROFISSIONAL: 'Profissional', PREMIUM: 'Premium' }

interface AssinaturaInfo {
  status: string
  assinatura: {
    metodo: 'PIX' | 'CREDIT_CARD'
    valor: number
    status: string
    proximoVencimento: string | null
    confirmadaEm: string | null
    canceladaEm: string | null
  } | null
  contatoWhatsapp: string
}

export function Plano({ dados }: { dados: ConfigDados }) {
  const p = dados.plano
  const info = useAsync(() => get<AssinaturaInfo>('/configuracoes/assinatura'), [])
  const a = info.data?.assinatura
  const contato = info.data?.contatoWhatsapp
  const [confirmando, setConfirmando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const cancelada = a?.status === 'CANCELADA'
  const dataBr = (d: string | null) => (d ? dateBr(String(d).slice(0, 10)) : '')
  return (
    <>
    <Card title="Plano" subtitle="Assinatura do estabelecimento com a SMG.">
      <div className="grid-3">
        <div className="stat-card">
          <div className="stat-label">Plano atual</div>
          <div className="stat-value">{a ? `${a.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês` : PLANO_LABEL[p.plano] || p.plano}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Situação</div>
          <div className="stat-value">{p.ativo ? <span className="success-text">Ativo</span> : <span className="danger-text">Inativo</span>}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{cancelada ? 'Acesso até' : a?.proximoVencimento ? 'Próxima cobrança' : 'Cliente desde'}</div>
          <div className="stat-value">{dateBr(String(a?.proximoVencimento || p.desde).slice(0, 10))}</div>
        </div>
      </div>
      {a && !cancelada && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Forma de pagamento: {a.metodo === 'PIX' ? 'Pix Automático (débito mensal autorizado no seu banco)' : 'cartão de crédito recorrente (Mercado Pago)'}.
        </p>
      )}
      {cancelada && (
        <p className="small" style={{ marginTop: 12 }}>
          Assinatura cancelada em {dataBr(a?.canceladaEm || null)}. Nenhuma nova cobrança será feita.
          {a?.proximoVencimento ? ` Você continua usando o sistema até ${dataBr(a.proximoVencimento)}; depois a conta é suspensa e os dados ficam guardados.` : ''}
        </p>
      )}
      {a && !cancelada && a.status === 'ATIVA' && (
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-sm" onClick={() => setConfirmando(true)}>
            Cancelar assinatura
          </button>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>
        Para trocar a forma de pagamento ou tirar dúvidas sobre a assinatura, fale com o suporte da SMG
        {contato ? (
          <>
            {' '}pelo{' '}
            <a href={`https://wa.me/${contato}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          </>
        ) : null}
        .
      </p>
    </Card>
    {confirmando && (
      <ConfirmModal
        title="Cancelar assinatura"
        confirmLabel="Cancelar assinatura"
        danger
        onClose={() => setConfirmando(false)}
        onConfirm={async () => {
          await post('/configuracoes/assinatura/cancelar', { motivo })
          info.reload()
        }}
      >
        <div className="stack">
          <p>
            A cobrança mensal será cancelada {a?.metodo === 'PIX' ? 'no Pix Automático (seu banco para de debitar)' : 'no cartão (Mercado Pago)'} e nada mais será cobrado.
          </p>
          {a?.proximoVencimento && (
            <p>
              Você continua usando o sistema até <b>{dataBr(a.proximoVencimento)}</b>, o fim do período já pago. Depois disso a conta é suspensa, mas seus dados
              ficam guardados caso queira voltar.
            </p>
          )}
          <div className="field">
            <label>Quer contar o motivo? (opcional)</label>
            <textarea className="textarea" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </div>
      </ConfirmModal>
    )}
    </>
  )
}
