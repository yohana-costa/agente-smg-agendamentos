import { useRef, useState, type ReactNode } from 'react'
import { errorMessage, patch } from '../../../lib/api'
import { ErrorBanner, Toggle } from '../../../components/ui'
import { META, TODOS_PLACEHOLDERS, type Automacao } from './meta'

type Unidade = 'min' | 'h'

function estadoInicial(a: Automacao) {
  const modo = META[a.tipo].modo
  if (modo === 'dias-antes') return { valor: String(Math.round(a.disparoMin / 1440)), unidade: 'min' as Unidade }
  if ((modo === 'antes' || modo === 'apos-final') && a.disparoMin >= 60 && a.disparoMin % 60 === 0) return { valor: String(a.disparoMin / 60), unidade: 'h' as Unidade }
  return { valor: String(a.disparoMin), unidade: 'min' as Unidade }
}

function paraMinutos(modo: string, valor: string, unidade: Unidade) {
  const n = Math.max(0, Number(valor) || 0)
  if (modo === 'dias-antes') return Math.round(n * 1440)
  if (unidade === 'h') return Math.round(n * 60)
  return Math.round(n)
}

/** Renderiza o texto com dados de exemplo destacando as variaveis. */
function renderPreview(texto: string, exemplos: Record<string, string>): { nodes: ReactNode[]; desconhecidas: string[] } {
  const nodes: ReactNode[] = []
  const desconhecidas: string[] = []
  const re = /\{(\w+)\}/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(texto))) {
    if (m.index > last) nodes.push(texto.slice(last, m.index))
    const key = m[1]
    if (TODOS_PLACEHOLDERS.has(key)) {
      const v = exemplos[key] ?? ''
      if (v) nodes.push(<span key={i++} className="au-var">{v}</span>)
    } else {
      desconhecidas.push(key)
      nodes.push(
        <span key={i++} className="au-var-bad" title="Variável desconhecida: será enviada vazia">
          {m[0]}
        </span>
      )
    }
    last = m.index + m[0].length
  }
  if (last < texto.length) nodes.push(texto.slice(last))
  return { nodes, desconhecidas: [...new Set(desconhecidas)] }
}

export function AutomacaoCard({ automacao, exemplos, onSalvo }: { automacao: Automacao; exemplos: Record<string, string>; onSalvo: (a: Automacao) => void }) {
  const meta = META[automacao.tipo]
  const inicial = estadoInicial(automacao)
  const [valor, setValor] = useState(inicial.valor)
  const [unidade, setUnidade] = useState<Unidade>(inicial.unidade)
  const [texto, setTexto] = useState(automacao.texto)
  const [salvando, setSalvando] = useState(false)
  const [alternando, setAlternando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  const minutos = paraMinutos(meta.modo, valor, unidade)
  const alterado = texto !== automacao.texto || (meta.modo !== 'imediato' && minutos !== automacao.disparoMin)

  function inserir(key: string) {
    const el = ref.current
    const token = `{${key}}`
    const ini = el ? el.selectionStart : texto.length
    const fim = el ? el.selectionEnd : texto.length
    const novo = texto.slice(0, ini) + token + texto.slice(fim)
    setTexto(novo)
    setOk('')
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = ini + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function alternar(ativo: boolean) {
    setAlternando(true)
    setErro('')
    try {
      const r = await patch<Automacao>(`/automacoes/${automacao.tipo}`, { ativo })
      onSalvo(r)
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setAlternando(false)
    }
  }

  async function salvar() {
    if (!texto.trim()) return setErro('O texto da mensagem não pode ficar vazio.')
    setSalvando(true)
    setErro('')
    setOk('')
    try {
      const body: Record<string, unknown> = { texto }
      if (meta.modo !== 'imediato') body.disparoMin = minutos
      const r = await patch<Automacao>(`/automacoes/${automacao.tipo}`, body)
      onSalvo(r)
      const i = estadoInicial(r)
      setTexto(r.texto)
      setValor(i.valor)
      setUnidade(i.unidade)
      setOk('Salvo')
      setTimeout(() => setOk(''), 2500)
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }

  const preview = renderPreview(texto, exemplos)

  return (
    <section className={`au-card ${automacao.ativo ? '' : 'off'}`}>
      <div className="au-head">
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div className="au-icon">{meta.icone}</div>
          <div>
            <div className="au-title">{meta.titulo}</div>
            <div className="au-desc">{meta.descricao}</div>
          </div>
        </div>
        <Toggle checked={automacao.ativo} disabled={alternando} onChange={alternar} label={<span className="small strong">{automacao.ativo ? 'Ligada' : 'Desligada'}</span>} />
      </div>
      <div className="au-body">
        <div className="stack">
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>
              Momento de disparo
            </div>
            <Disparo modo={meta.modo} valor={valor} unidade={unidade} onValor={(v) => (setValor(v), setOk(''))} onUnidade={(u) => (setUnidade(u), setOk(''))} />
          </div>
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>
              Texto da mensagem
            </div>
            <textarea
              ref={ref}
              className="textarea"
              rows={5}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value)
                setOk('')
              }}
            />
            <div className="field-hint" style={{ marginTop: 4 }}>
              Clique numa variável para inserir no ponto do cursor:
            </div>
            <div className="au-chips">
              {meta.placeholders.map((p) => (
                <button key={p.key} type="button" className="au-chip" title={p.label} onClick={() => inserir(p.key)}>
                  {`{${p.key}}`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="au-preview-wrap">
          <div className="au-preview-label">Pré-visualização com dados de exemplo</div>
          <div className="au-preview">{preview.nodes.length ? preview.nodes : <span className="muted">Mensagem vazia</span>}</div>
          {preview.desconhecidas.length ? (
            <div className="small danger-text" style={{ marginTop: 8 }}>
              Variável desconhecida: {preview.desconhecidas.map((d) => `{${d}}`).join(', ')}. Ela será enviada vazia.
            </div>
          ) : null}
        </div>
      </div>
      <div className="au-foot">
        <div className="small">
          {erro ? <ErrorBanner message={erro} /> : ok ? <span className="success-text strong">✓ {ok}</span> : alterado ? <span className="badge badge-warning">Alterações não salvas</span> : <span className="muted">Sem alterações</span>}
        </div>
        <div className="row">
          {alterado ? (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                const i = estadoInicial(automacao)
                setValor(i.valor)
                setUnidade(i.unidade)
                setTexto(automacao.texto)
                setErro('')
              }}
              disabled={salvando}
            >
              Descartar
            </button>
          ) : null}
          <button className="btn btn-primary btn-sm" onClick={salvar} disabled={salvando || !alterado}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </section>
  )
}

function Disparo({ modo, valor, unidade, onValor, onUnidade }: { modo: string; valor: string; unidade: Unidade; onValor: (v: string) => void; onUnidade: (u: Unidade) => void }) {
  if (modo === 'imediato') {
    return (
      <div className="au-timing">
        <span className="badge badge-primary">⚡ Imediato</span>
        <span className="muted small">Enviada no momento do evento.</span>
      </div>
    )
  }
  const unidadeSelect = (
    <select className="select input-sm" value={unidade} onChange={(e) => onUnidade(e.target.value as Unidade)}>
      <option value="min">minutos</option>
      <option value="h">horas</option>
    </select>
  )
  const input = (max?: number) => <input className="input input-sm" type="number" min={0} max={max} value={valor} onChange={(e) => onValor(e.target.value)} />
  if (modo === 'apos-criacao') {
    const n = Number(valor) || 0
    return (
      <div className="stack-sm">
        <div className="au-timing">
          {input(120)}
          <span>minutos após a criação do agendamento</span>
        </div>
        {n >= 15 ? <span className="small danger-text">A reserva expira em 15 minutos: um lembrete depois disso não chega a ser enviado.</span> : null}
      </div>
    )
  }
  if (modo === 'antes') {
    return (
      <div className="au-timing">
        {input()}
        {unidadeSelect}
        <span>antes do horário do atendimento</span>
      </div>
    )
  }
  if (modo === 'apos-final') {
    return (
      <div className="au-timing">
        {input()}
        {unidadeSelect}
        <span>após finalizar o atendimento</span>
      </div>
    )
  }
  // dias-antes
  const n = Number(valor) || 0
  return (
    <div className="stack-sm">
      <div className="au-timing">
        {input(60)}
        <span>dias antes da data de retorno sugerida</span>
      </div>
      <span className="small muted">{n === 0 ? 'Enviada no próprio dia do retorno sugerido.' : `Enviada ${n} dia${n > 1 ? 's' : ''} antes do retorno sugerido.`}</span>
    </div>
  )
}
