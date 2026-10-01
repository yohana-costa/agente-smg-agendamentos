import { useState } from 'react'
import { errorMessage, patch } from '../../../lib/api'
import { phone } from '../../../lib/format'
import { Card, ErrorBanner, Field, SuccessBanner, Toggle } from '../../../components/ui'
import { semSegredos, type AgenteConfig, type AgentesDados } from './types'

const TEMPOS = [5, 10, 15, 20]

export function AgenteAtendimento({ dados, onConfig, irPara }: { dados: AgentesDados; onConfig: (c: Partial<AgenteConfig>) => void; irPara: (tab: 'whatsapp' | 'simulador') => void }) {
  const c = dados.config
  const [form, setForm] = useState({
    personaNome: c.personaNome || '',
    personaTom: c.personaTom || '',
    personaApresentacao: c.personaApresentacao || '',
    informacoesNegocio: c.informacoesNegocio || '',
    mensagemEscalonamento: c.mensagemEscalonamento || '',
    numeroEscalonamento: c.numeroEscalonamento ? phone(c.numeroEscalonamento) : '',
    tempoRetornoMin: c.tempoRetornoMin || 15,
  })
  const [outro, setOutro] = useState(!TEMPOS.includes(c.tempoRetornoMin))
  const [salvando, setSalvando] = useState(false)
  const [alternando, setAlternando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setOk('')
  }

  async function alternar(ativo: boolean) {
    setAlternando(true)
    setErro('')
    try {
      const r = await patch<AgenteConfig>('/agentes/atendimento', { atendimentoAtivo: ativo })
      onConfig(semSegredos(r))
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setAlternando(false)
    }
  }

  async function salvar() {
    if (!form.personaNome.trim()) return setErro('Informe o nome da persona.')
    if (!form.mensagemEscalonamento.trim()) return setErro('Informe a mensagem de escalonamento.')
    const tempo = Math.round(Number(form.tempoRetornoMin))
    if (!(tempo >= 1 && tempo <= 1440)) return setErro('O tempo de retorno deve ser entre 1 e 1440 minutos.')
    setSalvando(true)
    setErro('')
    setOk('')
    try {
      const r = await patch<AgenteConfig>('/agentes/atendimento', {
        personaNome: form.personaNome.trim(),
        personaTom: form.personaTom.trim(),
        personaApresentacao: form.personaApresentacao.trim(),
        informacoesNegocio: form.informacoesNegocio,
        mensagemEscalonamento: form.mensagemEscalonamento.trim(),
        numeroEscalonamento: form.numeroEscalonamento.replace(/\D/g, '') ? form.numeroEscalonamento : null,
        tempoRetornoMin: tempo,
      })
      onConfig(semSegredos(r))
      setOk('Configuração do Agente de Atendimento salva.')
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="stack">
      <div className="ia-hero">
        <div>
          <div className="ia-hero-title">Agente de Atendimento</div>
          <div className="ia-hero-sub">
            Fala com os clientes no WhatsApp. Responsável apenas por agendamentos: informa horários, registra o agendamento e envia o link de pagamento.
          </div>
        </div>
        <Toggle checked={c.atendimentoAtivo} disabled={alternando} onChange={alternar} label={c.atendimentoAtivo ? 'Ativo' : 'Desativado'} />
      </div>

      <div className="ia-rules">
        <div className="ia-rule">
          <strong>Só agendamento</strong>
          Não vende nem tira dúvidas fora do escopo: agenda, reagenda, cancela e confirma pagamento.
        </div>
        <div className="ia-rule">
          <strong>Nunca inventa</strong>
          Usa apenas os dados do sistema e as informações do negócio abaixo. O que não está lá, ele não responde.
        </div>
        <div className="ia-rule">
          <strong>Link do site primeiro</strong>
          Quem quer agendar recebe primeiro o link do site. Se preferir, o agente agenda pela conversa.
        </div>
        <div className="ia-rule">
          <strong>Escala quando não sabe</strong>
          Envia a mensagem de escalonamento, avisa o número configurado e pausa na conversa.
        </div>
      </div>

      <div className="ia-layout">
        <div>
          <Card title="Persona" subtitle="Como o agente se apresenta e fala com os clientes.">
            <div className="form-grid">
              <Field label="Nome do agente">
                <input className="input" value={form.personaNome} onChange={(e) => set('personaNome', e.target.value)} placeholder="Ex.: Bia" />
              </Field>
              <Field label="Tom de voz">
                <input className="input" value={form.personaTom} onChange={(e) => set('personaTom', e.target.value)} placeholder="Ex.: Cordial, objetivo e acolhedor" />
              </Field>
              <Field label="Forma de se apresentar" className="full" hint="Primeira mensagem quando o cliente inicia a conversa.">
                <textarea className="textarea" rows={2} value={form.personaApresentacao} onChange={(e) => set('personaApresentacao', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card
            title="Informações do negócio"
            subtitle="Texto livre que o agente pode usar para responder, além dos dados do sistema (serviços, preços, profissionais e horários já são lidos automaticamente)."
          >
            <textarea
              className="textarea"
              style={{ minHeight: 220 }}
              value={form.informacoesNegocio}
              onChange={(e) => set('informacoesNegocio', e.target.value)}
              placeholder={'Ex.:\n- Estacionamento conveniado na rua de trás.\n- Aceitamos Pix e cartão pelo link de pagamento.\n- Atendemos crianças a partir de 5 anos.'}
              maxLength={20000}
            />
            <div className="field-hint right">{form.informacoesNegocio.length.toLocaleString('pt-BR')} / 20.000 caracteres</div>
          </Card>

          <Card title="Escalonamento para humano" subtitle="Quando o agente não tem a informação ou o assunto foge do agendamento.">
            <div className="stack">
              <Field label="Mensagem de escalonamento" hint="O que o agente diz ao cliente ao encaminhar para uma pessoa.">
                <textarea className="textarea" rows={3} value={form.mensagemEscalonamento} onChange={(e) => set('mensagemEscalonamento', e.target.value)} />
              </Field>
              <Field label="Número que recebe as notificações de escalonamento" hint="Recebe pelo WhatsApp o aviso de qual cliente precisa de atenção. Em branco: apenas a aba Atendimento é sinalizada.">
                <input className="input" style={{ maxWidth: 280 }} inputMode="tel" value={form.numeroEscalonamento} onChange={(e) => set('numeroEscalonamento', e.target.value)} placeholder="(11) 99999-9999" />
              </Field>
              <Field label="Tempo de retorno após a pausa" hint="Quanto tempo o agente espera para voltar a responder numa conversa pausada (escalonada ou em que um humano respondeu).">
                <div className="ia-chips-row">
                  {TEMPOS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`chip ${!outro && form.tempoRetornoMin === t ? 'active' : ''}`}
                      onClick={() => {
                        setOutro(false)
                        set('tempoRetornoMin', t)
                      }}
                    >
                      {t} min
                    </button>
                  ))}
                  <button type="button" className={`chip ${outro ? 'active' : ''}`} onClick={() => setOutro(true)}>
                    Outro
                  </button>
                  {outro ? (
                    <div className="input-group" style={{ width: 150 }}>
                      <input className="input input-sm" type="number" min={1} max={1440} value={form.tempoRetornoMin} onChange={(e) => set('tempoRetornoMin', Number(e.target.value))} />
                      <span className="addon">min</span>
                    </div>
                  ) : null}
                </div>
              </Field>
            </div>
          </Card>

          <div className="stack" style={{ marginTop: 14 }}>
            <ErrorBanner message={erro} />
            <SuccessBanner message={ok} />
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => irPara('simulador')}>
              Testar no simulador
            </button>
            <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando...' : 'Salvar configuração'}
            </button>
          </div>
        </div>

        <div className="ia-side">
          <Card title="Número de WhatsApp conectado">
            <div className="stack-sm">
              <div className="strong" style={{ fontSize: 16 }}>
                {c.whatsappNumero ? phone(c.whatsappNumero) : <span className="muted">Nenhum número informado</span>}
              </div>
              <div>{dados.whatsappConectado ? <span className="badge badge-success">● Conectado</span> : <span className="badge badge-danger">● Não conectado</span>}</div>
              <button className="btn btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => irPara('whatsapp')}>
                Configurar conexão
              </button>
            </div>
          </Card>
          <Card title="Como funciona a pausa">
            <div className="small muted stack-sm">
              <span>O agente pausa numa conversa quando escala para um humano ou quando alguém da equipe manda mensagem ao cliente (pelo sistema ou direto no WhatsApp).</span>
              <span>Depois do tempo de retorno ele volta a responder sozinho. Na aba Atendimento é possível devolver a conversa ao agente a qualquer momento.</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
