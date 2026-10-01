import { useState } from 'react'
import { errorMessage, patch } from '../../../lib/api'
import { phone } from '../../../lib/format'
import { Card, ErrorBanner, Field, Segmented, SuccessBanner } from '../../../components/ui'
import { CopyField } from './CopyField'
import type { AgenteConfig, AgentesDados, Provider } from './types'

type Campo = { key: string; label: string; secreto: boolean; hint?: string; placeholder?: string }

const CAMPOS: Record<Provider, Campo[]> = {
  uazapi: [
    { key: 'baseUrl', label: 'URL do servidor Uazapi', secreto: false, hint: 'Em branco: usa o servidor padrão configurado pela SMG.', placeholder: 'https://suaempresa.uazapi.com' },
    { key: 'instanceToken', label: 'Token da instância', secreto: true },
    { key: 'webhookSecret', label: 'Segredo do webhook (opcional)', secreto: true, hint: 'Se preenchido, a Uazapi deve enviar o cabeçalho x-webhook-secret (ou ?secret=) com este valor.' },
  ],
  meta: [
    { key: 'accessToken', label: 'Access token (permanente)', secreto: true },
    { key: 'phoneNumberId', label: 'Phone number ID', secreto: false, placeholder: 'Ex.: 109876543210987' },
    { key: 'verifyToken', label: 'Verify token do webhook', secreto: false, hint: 'Defina um texto qualquer e use o mesmo valor ao cadastrar o webhook no painel da Meta.' },
    { key: 'appSecret', label: 'App secret (opcional)', secreto: true, hint: 'Com ele o sistema também confere a assinatura de cada mensagem enviada pela Meta.' },
  ],
}

export function ConexaoWhatsApp({
  dados,
  isDono,
  onSalvo,
}: {
  dados: AgentesDados
  isDono: boolean
  onSalvo: (r: { config: Partial<AgenteConfig>; whatsappConectado: boolean }) => void
}) {
  const salvo = dados.config
  const [provider, setProvider] = useState<Provider>(salvo.whatsappProvider === 'meta' ? 'meta' : 'uazapi')
  const [numero, setNumero] = useState(salvo.whatsappNumero ? phone(salvo.whatsappNumero) : '')
  const valoresIniciais = (p: Provider) => {
    const v: Record<string, string> = {}
    for (const c of CAMPOS[p]) v[c.key] = !c.secreto && p === salvo.whatsappProvider ? String(salvo.whatsappConfig?.[c.key] || '') : ''
    return v
  }
  const [valores, setValores] = useState<Record<string, string>>(() => valoresIniciais(provider))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  const mesmoProvider = provider === salvo.whatsappProvider
  const mascarado = (k: string) => (mesmoProvider ? salvo.whatsappConfig?.[k] : undefined)

  function trocarProvider(p: Provider) {
    setProvider(p)
    setValores(valoresIniciais(p))
    setOk('')
  }

  async function salvar() {
    setSalvando(true)
    setErro('')
    setOk('')
    const body: Record<string, string> = { whatsappProvider: provider, whatsappNumero: numero }
    for (const c of CAMPOS[provider]) {
      const v = (valores[c.key] || '').trim()
      if (c.secreto) {
        if (v) body[c.key] = v // so envia credencial quando o usuario digitou um valor novo
      } else body[c.key] = v
    }
    try {
      const r = await patch<AgenteConfig & { whatsappConectado: boolean }>('/agentes/whatsapp', body)
      onSalvo({
        config: { whatsappProvider: r.whatsappProvider, whatsappNumero: r.whatsappNumero, whatsappConfig: r.whatsappConfig },
        whatsappConectado: r.whatsappConectado,
      })
      const novos: Record<string, string> = {}
      for (const c of CAMPOS[provider]) novos[c.key] = c.secreto ? '' : String(r.whatsappConfig?.[c.key] || '')
      setValores(novos)
      setOk(r.whatsappConectado ? 'Conexão salva. O WhatsApp está conectado.' : 'Conexão salva, mas ainda faltam credenciais para conectar.')
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  const webhook = provider === 'meta' ? dados.webhook.meta : dados.webhook.uazapi

  return (
    <div className="stack">
      <div className="ia-hero">
        <div>
          <div className="ia-hero-title">Conexão WhatsApp</div>
          <div className="ia-hero-sub">Um número de WhatsApp por estabelecimento, usado pelos dois agentes e pelas automações.</div>
        </div>
        <div className="ia-status-row">
          {dados.whatsappConectado ? <span className="badge badge-success">● Conectado</span> : <span className="badge badge-danger">● Não conectado</span>}
          {salvo.whatsappNumero ? <span className="badge badge-gray">{phone(salvo.whatsappNumero)}</span> : null}
        </div>
      </div>

      <div className="ia-layout">
        <div>
          <Card title="Provedor e credenciais">
            {!isDono ? <div className="banner warning-banner" style={{ marginBottom: 12 }}>Apenas o dono pode alterar a conexão do WhatsApp.</div> : null}
            <div className="stack">
              <Field label="Provedor">
                <Segmented
                  options={[
                    { key: 'uazapi', label: 'Uazapi' },
                    { key: 'meta', label: 'Meta Cloud API' },
                  ]}
                  value={provider}
                  onChange={(p) => isDono && trocarProvider(p)}
                />
              </Field>
              {!mesmoProvider ? (
                <div className="banner warning-banner">Ao trocar de provedor, as credenciais do provedor anterior são descartadas ao salvar. Preencha todos os campos abaixo.</div>
              ) : null}
              <Field label="Número do WhatsApp" hint="Número que os clientes usam para falar com o estabelecimento.">
                <input className="input" style={{ maxWidth: 280 }} inputMode="tel" value={numero} disabled={!isDono} onChange={(e) => setNumero(e.target.value)} placeholder="(11) 99999-9999" />
              </Field>
              {CAMPOS[provider].map((c) => {
                const atual = c.secreto ? mascarado(c.key) : undefined
                return (
                  <Field
                    key={c.key}
                    label={
                      <>
                        {c.label} {c.secreto && atual ? <span className="badge badge-success" style={{ marginLeft: 6 }}>salvo</span> : null}
                      </>
                    }
                    hint={c.secreto && atual ? 'O valor salvo fica oculto. Deixe em branco para manter; digite para substituir.' : c.hint}
                  >
                    <input
                      className="input mono"
                      type={c.secreto ? 'password' : 'text'}
                      autoComplete="off"
                      disabled={!isDono}
                      value={valores[c.key] || ''}
                      placeholder={atual ? String(atual) : c.placeholder || ''}
                      onChange={(e) => setValores((v) => ({ ...v, [c.key]: e.target.value }))}
                    />
                  </Field>
                )
              })}
              <ErrorBanner message={erro} />
              <SuccessBanner message={ok} />
            </div>
            {isDono ? (
              <div className="form-actions">
                <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
                  {salvando ? 'Salvando...' : 'Salvar conexão'}
                </button>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="ia-side">
          <Card title="URL do webhook" subtitle={provider === 'meta' ? 'Cadastre no painel da Meta (WhatsApp > Configuração > Webhook) junto com o verify token.' : 'Cadastre na sua instância Uazapi para receber as mensagens. Use a URL inteira: o token no final é o que protege o webhook.'}>
            <div className="stack">
              <CopyField value={webhook} />
              <details>
                <summary className="small muted" style={{ cursor: 'pointer' }}>
                  Ver URL do outro provedor
                </summary>
                <div style={{ marginTop: 8 }}>
                  <div className="small muted" style={{ marginBottom: 4 }}>
                    {provider === 'meta' ? 'Uazapi' : 'Meta Cloud API'}
                  </div>
                  <CopyField value={provider === 'meta' ? dados.webhook.uazapi : dados.webhook.meta} />
                </div>
              </details>
            </div>
          </Card>
          <Card title="Roteamento das mensagens">
            <div className="small stack-sm">
              <span>
                Números autorizados na sub-aba <strong>Agente de Gestão</strong> são atendidos pelo Agente de Gestão.
              </span>
              <span>Todos os demais números falam com o Agente de Atendimento.</span>
              <span className="muted">Mensagens enviadas pela equipe direto no WhatsApp também são registradas e pausam o agente naquela conversa.</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
