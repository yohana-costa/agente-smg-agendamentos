import { useState } from 'react'
import { patch } from '../../../lib/api'
import { Card, ConfirmModal, Field } from '../../../components/ui'
import { CopyField } from '../agentes/CopyField'
import { SaveBar, useSalvar, type ConfigDados } from './shared'

export function Pagamentos({ dados, onChange }: { dados: ConfigDados; onChange: (p: Partial<ConfigDados>) => void }) {
  const pg = dados.pagamentos
  const [token, setToken] = useState('')
  const [publicKey, setPublicKey] = useState(pg.mpPublicKey || '')
  const [remover, setRemover] = useState(false)
  const s = useSalvar()

  const salvar = () =>
    s.salvar(async () => {
      const body: Record<string, string> = { mpPublicKey: publicKey.trim() }
      if (token.trim()) body.mpAccessToken = token.trim()
      const r = await patch<{ modo: ConfigDados['pagamentos']['modo']; mpAccessTokenConfigurado: boolean }>('/configuracoes/pagamentos', body)
      onChange({ pagamentos: { ...pg, ...r, mpPublicKey: publicKey.trim() || null } })
      setToken('')
    }, 'Configuração de pagamentos salva.')

  return (
    <div className="stack">
      <Card
        title="Gateway de pagamentos SMG"
        subtitle="Pix e cartão pelo gateway da SMG, conectado ao Mercado Pago."
        actions={pg.modo === 'mercadopago' ? <span className="badge badge-success">● Mercado Pago (produção)</span> : <span className="badge badge-warning">● Modo simulado</span>}
      >
        {pg.modo === 'simulado' ? (
          <div className="banner warning-banner" style={{ marginBottom: 12 }}>
            Sem access token, o gateway funciona em modo simulado: os links de pagamento abrem uma tela de teste e nenhum valor é cobrado de verdade. Informe as credenciais do Mercado Pago para receber pagamentos reais.
          </div>
        ) : (
          <div className="banner success-banner" style={{ marginBottom: 12 }}>
            Pagamentos reais ativos. Os valores caem na conta Mercado Pago vinculada e os reembolsos são executados automaticamente.
          </div>
        )}
        <div className="form-grid">
          <Field
            label={
              <>
                Access token do Mercado Pago {pg.mpAccessTokenConfigurado ? <span className="badge badge-success" style={{ marginLeft: 6 }}>configurado</span> : null}
              </>
            }
            hint={pg.mpAccessTokenConfigurado ? 'O token salvo fica oculto. Deixe em branco para manter; digite para substituir.' : 'Encontrado em Mercado Pago > Suas integrações > Credenciais de produção.'}
          >
            <input className="input mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={pg.mpAccessTokenConfigurado ? '•••••••••••• (salvo)' : 'APP_USR-...'} />
          </Field>
          <Field label="Public key">
            <input className="input mono" value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder="APP_USR-..." />
          </Field>
        </div>
        {pg.mpAccessTokenConfigurado ? (
          <button className="btn btn-sm btn-ghost danger-text" style={{ marginTop: 8 }} onClick={() => setRemover(true)}>
            Remover access token
          </button>
        ) : null}
        <SaveBar {...s} onSave={salvar} />
      </Card>

      <Card title="Webhook de notificações" subtitle="Cadastre esta URL em Mercado Pago > Suas integrações > Webhooks (evento Pagamentos) para que as confirmações cheguem na hora.">
        <CopyField value={pg.webhookUrl} />
      </Card>

      {remover ? (
        <ConfirmModal
          title="Remover access token"
          danger
          confirmLabel="Remover"
          onClose={() => setRemover(false)}
          onConfirm={async () => {
            const r = await patch<{ modo: ConfigDados['pagamentos']['modo']; mpAccessTokenConfigurado: boolean }>('/configuracoes/pagamentos', { mpAccessToken: '' })
            onChange({ pagamentos: { ...pg, ...r } })
          }}
        >
          <p>Sem o token do estabelecimento, o gateway volta ao modo simulado (ou usa a conta padrão da SMG, se configurada no servidor). Novos pagamentos não serão cobrados na sua conta.</p>
        </ConfirmModal>
      ) : null}
    </div>
  )
}
