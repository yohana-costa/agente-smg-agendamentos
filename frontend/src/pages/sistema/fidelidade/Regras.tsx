import { useEffect, useState } from 'react'
import { errorMessage, patch } from '../../../lib/api'
import { brl } from '../../../lib/format'
import { Card, ErrorBanner, MoneyInput, SuccessBanner } from '../../../components/ui'
import { pts, type FidelidadeConfig } from './types'

export function Regras({ config, onSaved }: { config: FidelidadeConfig; onSaved: (c: FidelidadeConfig) => void }) {
  const [porReal, setPorReal] = useState(String(config.pontosPorReal ?? 0))
  const [porAtendimento, setPorAtendimento] = useState(String(config.pontosPorAtendimento ?? 0))
  const [exemplo, setExemplo] = useState(12000)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    setPorReal(String(config.pontosPorReal ?? 0))
    setPorAtendimento(String(config.pontosPorAtendimento ?? 0))
  }, [config.pontosPorReal, config.pontosPorAtendimento])

  const nReal = Math.max(0, Math.floor(Number(porReal) || 0))
  const nAtend = Math.max(0, Math.floor(Number(porAtendimento) || 0))
  const pontosExemplo = Math.floor(exemplo / 100) * nReal + nAtend

  async function salvar() {
    setSalvando(true)
    setErro('')
    setOk('')
    try {
      const r = await patch<FidelidadeConfig>('/fidelidade/config', { pontosPorReal: nReal, pontosPorAtendimento: nAtend })
      onSaved(r)
      setOk('Regras de pontuação salvas.')
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Card title="Regras de pontuação" subtitle="Defina como o cliente ganha pontos. Os pontos são creditados quando o atendimento é concluído e pago.">
      <div className="fd-rule">
        <div>
          <div className="fd-rule-title">Pontos por R$ 1,00 pago</div>
          <div className="small muted">Cada real inteiro pago no atendimento vale esta quantidade de pontos. Use 0 para não pontuar por valor.</div>
        </div>
        <div className="input-group">
          <input className="input" type="number" min={0} max={1000} value={porReal} onChange={(e) => setPorReal(e.target.value)} />
          <span className="addon">pts / R$</span>
        </div>
      </div>
      <div className="fd-rule">
        <div>
          <div className="fd-rule-title">Pontos por atendimento concluído</div>
          <div className="small muted">Pontos fixos a cada visita concluída, independentemente do valor. Use 0 para não pontuar por visita.</div>
        </div>
        <div className="input-group">
          <input className="input" type="number" min={0} value={porAtendimento} onChange={(e) => setPorAtendimento(e.target.value)} />
          <span className="addon">pts</span>
        </div>
      </div>

      <div className="fd-example" style={{ marginTop: 14 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="small strong">Simular um atendimento de</span>
          <div style={{ width: 160 }}>
            <MoneyInput value={exemplo} onChange={setExemplo} />
          </div>
        </div>
        Um atendimento de <strong>{brl(exemplo)}</strong> rende <strong>{pts(pontosExemplo)}</strong> ao cliente
        {nReal || nAtend ? (
          <span className="muted">
            {' '}
            ({Math.floor(exemplo / 100)} × {nReal} + {nAtend})
          </span>
        ) : null}
        .
      </div>

      <div className="stack" style={{ marginTop: 12 }}>
        <ErrorBanner message={erro} />
        <SuccessBanner message={ok} />
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando...' : 'Salvar regras'}
        </button>
      </div>
    </Card>
  )
}
