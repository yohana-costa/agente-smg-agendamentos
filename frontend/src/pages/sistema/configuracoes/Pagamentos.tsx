import { useEffect, useState } from 'react'
import { errorMessage, get, post } from '../../../lib/api'
import { navigate, useQueryParam } from '../../../lib/router'
import { Card, ConfirmModal, ErrorBanner, SuccessBanner } from '../../../components/ui'
import type { ConfigDados } from './shared'

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
