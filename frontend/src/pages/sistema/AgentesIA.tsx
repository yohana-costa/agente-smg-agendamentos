import { get } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { navigate, useQueryParam } from '../../lib/router'
import { ErrorBanner, Loading, PageHeader, Tabs } from '../../components/ui'
import { AgenteAtendimento } from './agentes/AgenteAtendimento'
import { AgenteGestao } from './agentes/AgenteGestao'
import { ConexaoWhatsApp } from './agentes/ConexaoWhatsApp'
import { Simulador } from './agentes/Simulador'
import type { AgenteConfig, AgentesDados, NumeroAutorizado } from './agentes/types'
import './agentes/agentes.css'
import './atendimento/atendimento.css'

type Aba = 'atendimento' | 'gestao' | 'whatsapp' | 'simulador'
const ABAS: Aba[] = ['atendimento', 'gestao', 'whatsapp', 'simulador']

export default function AgentesIA() {
  const { usuario } = useAuth()
  const isDono = usuario?.perfil === 'DONO'
  const tabParam = useQueryParam('tab')
  const aba: Aba = ABAS.includes(tabParam as Aba) ? (tabParam as Aba) : 'atendimento'
  const dados = useAsync(() => get<AgentesDados>('/agentes'), [])

  const irPara = (t: Aba) => navigate(t === 'atendimento' ? '/app/agentes' : `/app/agentes?tab=${t}`, { replace: true })

  const d = dados.data
  const atualizarConfig = (c: Partial<AgenteConfig>) => d && dados.setData({ ...d, config: { ...d.config, ...c } })
  const atualizarNumeros = (n: NumeroAutorizado[]) => d && dados.setData({ ...d, numerosAutorizados: n })

  return (
    <div>
      <PageHeader
        title="Agentes de IA"
        subtitle="Configuração do Agente de Atendimento (clientes) e do Agente de Gestão (equipe), ambos pelo WhatsApp."
        actions={
          d ? (
            <div className="ia-status-row">
              <span className={`badge ${d.whatsappConectado ? 'badge-success' : 'badge-danger'}`}>WhatsApp {d.whatsappConectado ? 'conectado' : 'não conectado'}</span>
              <span className={`badge ${d.config.atendimentoAtivo ? 'badge-success' : 'badge-gray'}`}>Atendimento {d.config.atendimentoAtivo ? 'ativo' : 'desativado'}</span>
              <span className={`badge ${d.config.gestaoAtivo ? 'badge-success' : 'badge-gray'}`}>Gestão {d.config.gestaoAtivo ? 'ativa' : 'desativada'}</span>
            </div>
          ) : null
        }
      />
      {dados.loading && !d ? <Loading /> : null}
      <ErrorBanner message={dados.error} />
      {d ? (
        <>
          {!d.iaDisponivel ? (
            <div className="banner warning-banner" style={{ marginBottom: 14 }}>
              A inteligência artificial não está disponível neste servidor (variável OPENAI_API_KEY não configurada). Os agentes não vão responder até que a chave seja configurada pela equipe técnica.
            </div>
          ) : null}
          {d.whatsappConectado ? null : (
            <div className="banner info-banner" style={{ marginBottom: 14 }}>
              O WhatsApp ainda não está conectado. Configure em{' '}
              <a href="/app/agentes?tab=whatsapp" onClick={(e) => (e.preventDefault(), irPara('whatsapp'))}>
                Conexão WhatsApp
              </a>
              . Enquanto isso, teste os agentes pelo Simulador.
            </div>
          )}
          <Tabs<Aba>
            tabs={[
              { key: 'atendimento', label: 'Agente de Atendimento' },
              { key: 'gestao', label: 'Agente de Gestão' },
              { key: 'whatsapp', label: 'Conexão WhatsApp' },
              { key: 'simulador', label: 'Simulador' },
            ]}
            value={aba}
            onChange={irPara}
          />
          {aba === 'atendimento' ? <AgenteAtendimento dados={d} onConfig={atualizarConfig} irPara={irPara} /> : null}
          {aba === 'gestao' ? <AgenteGestao dados={d} isDono={isDono} onConfig={atualizarConfig} onNumeros={atualizarNumeros} irPara={irPara} /> : null}
          {aba === 'whatsapp' ? (
            <ConexaoWhatsApp
              dados={d}
              isDono={isDono}
              onSalvo={({ config, whatsappConectado }) => dados.setData({ ...d, whatsappConectado, config: { ...d.config, ...config } })}
            />
          ) : null}
          {aba === 'simulador' ? <Simulador dados={d} /> : null}
        </>
      ) : null}
    </div>
  )
}
