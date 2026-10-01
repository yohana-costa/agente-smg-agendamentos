import { useState } from 'react'
import { errorMessage, get, patch } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { useQueryParam } from '../../lib/router'
import { ErrorBanner, Loading, PageHeader, Tabs, Toggle } from '../../components/ui'
import { Cupons } from './fidelidade/Cupons'
import { Extrato } from './fidelidade/Extrato'
import { Recompensas } from './fidelidade/Recompensas'
import { Regras } from './fidelidade/Regras'
import type { FidelidadeConfig, FidelidadeDados } from './fidelidade/types'
import './fidelidade/fidelidade.css'

type Aba = 'regras' | 'recompensas' | 'cupons' | 'extrato'

export default function Fidelidade() {
  const { recarregar } = useAuth()
  const clienteParam = useQueryParam('cliente')
  const [aba, setAba] = useState<Aba>(clienteParam ? 'extrato' : 'regras')
  const dados = useAsync(() => get<FidelidadeDados>('/fidelidade'), [])
  const [alternando, setAlternando] = useState(false)
  const [erroToggle, setErroToggle] = useState('')

  const setConfig = (config: FidelidadeConfig) => dados.data && dados.setData({ ...dados.data, config })

  async function alternarPrograma(ativo: boolean) {
    setAlternando(true)
    setErroToggle('')
    try {
      const config = await patch<FidelidadeConfig>('/fidelidade/config', { fidelidadeAtiva: ativo })
      setConfig(config)
      recarregar().catch(() => undefined)
    } catch (e) {
      setErroToggle(errorMessage(e))
    } finally {
      setAlternando(false)
    }
  }

  const d = dados.data
  return (
    <div>
      <PageHeader title="Fidelidade" subtitle="Pontos, recompensas e cupons de desconto. Tudo definido pelo próprio estabelecimento." />
      {dados.loading && !d ? <Loading /> : null}
      <ErrorBanner message={dados.error} />
      {d ? (
        <>
          <div className="fd-program">
            <div>
              <div className="fd-program-title">Programa de fidelidade</div>
              <div className="fd-program-sub">
                {d.config.fidelidadeAtiva
                  ? 'Ativado: os clientes acumulam pontos a cada atendimento e veem saldo e recompensas no Portal do cliente.'
                  : 'Desativado: nenhum ponto é creditado e o programa não aparece no Portal do cliente.'}
              </div>
            </div>
            <Toggle checked={d.config.fidelidadeAtiva} disabled={alternando} onChange={alternarPrograma} label={d.config.fidelidadeAtiva ? 'Ativado' : 'Desativado'} />
          </div>
          <ErrorBanner message={erroToggle} />
          {!d.config.fidelidadeAtiva ? (
            <div className="banner warning-banner" style={{ marginBottom: 14 }}>
              O programa está desativado. Você pode configurar regras, recompensas e cupons normalmente; eles só passam a valer quando o programa for ativado.
            </div>
          ) : null}

          <Tabs<Aba>
            tabs={[
              { key: 'regras', label: 'Regras de pontuação' },
              { key: 'recompensas', label: `Recompensas (${d.recompensas.length})` },
              { key: 'cupons', label: `Cupons (${d.cupons.length})` },
              { key: 'extrato', label: 'Extrato por cliente' },
            ]}
            value={aba}
            onChange={setAba}
          />
          {aba === 'regras' ? <Regras config={d.config} onSaved={setConfig} /> : null}
          {aba === 'recompensas' ? <Recompensas recompensas={d.recompensas} onChange={dados.reload} /> : null}
          {aba === 'cupons' ? <Cupons cupons={d.cupons} onChange={dados.reload} /> : null}
          {aba === 'extrato' ? <Extrato clienteInicial={clienteParam} /> : null}
        </>
      ) : null}
    </div>
  )
}
