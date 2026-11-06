import { useState } from 'react'
import { errorMessage, get, post } from '../../../lib/api'
import { brl, dateBr, dateLong } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { ConfirmModal, ErrorBanner, Field, Modal, MoneyInput, Segmented, SuccessBanner } from '../../../components/ui'
import type { Pacote, PacoteCliente } from '../../../types'

const STATUS: Record<PacoteCliente['status'], { label: string; cls: string }> = {
  ATIVO: { label: 'Ativo', cls: 'badge-success' },
  FINALIZADO: { label: 'Finalizado', cls: 'badge-gray' },
  VENCIDO: { label: 'Vencido', cls: 'badge-warning' },
  CANCELADO: { label: 'Cancelado', cls: 'badge-gray' },
}

type Forma = 'DINHEIRO' | 'MAQUININHA' | 'PIX' | 'POR_SESSAO'

interface AgendamentoParaPacote {
  id: string
  data: string
  hora: string
  profissional: string
  valorTotal: number
  itens: Array<{ nome: string; preco: number; jaCoberto: boolean; cabe: boolean }>
}

/** Pacotes do cliente na ficha: saldo de sessões, venda e cancelamento. */
export default function PacotesCliente({ clienteId, podeEditar }: { clienteId: string; podeEditar: boolean }) {
  const { data, loading, error, reload } = useAsync(() => get<PacoteCliente[]>(`/clientes/${encodeURIComponent(clienteId)}/pacotes`), [clienteId])
  const [vendendo, setVendendo] = useState(false)
  const [cancelando, setCancelando] = useState<PacoteCliente | null>(null)
  const [aplicando, setAplicando] = useState(false)
  const lista = data || []

  return (
    <div className="cl-section">
      <div className="cl-section-title">
        <span>Pacotes</span>
        {podeEditar ? (
          <button className="btn btn-sm" onClick={() => setVendendo(true)}>
            Vender pacote
          </button>
        ) : null}
      </div>
      <ErrorBanner message={error} />
      {loading && !data ? (
        <div className="muted small">Carregando...</div>
      ) : !lista.length ? (
        <div className="muted small">Nenhum pacote comprado.</div>
      ) : (
        <div className="stack-sm">
          {lista.map((pc) => (
            <div key={pc.id} className="card" style={{ padding: 12 }}>
              <div className="row-between">
                <div className="strong">
                  {pc.nome} <span className={`badge ${STATUS[pc.status].cls}`}>{STATUS[pc.status].label}</span>
                </div>
                <div className="small muted">
                  {brl(pc.valorPago)} em {dateBr(String(pc.compradoEm).slice(0, 10))}
                  {pc.porSessao ? ' · paga por sessão' : ''}
                </div>
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                {pc.saldos.map((s) => (
                  <div key={s.id}>
                    {s.nome}: <strong>{s.restante}</strong> de {s.total} sessão(ões) restante(s)
                    {pc.porSessao ? <span className="muted"> · {brl(s.valorSessao)} por sessão</span> : null}
                  </div>
                ))}
              </div>
              <div className="row-between small muted" style={{ marginTop: 6 }}>
                <span>{pc.validoAte ? `Válido até ${dateBr(String(pc.validoAte).slice(0, 10))}` : 'Sem validade'}</span>
                {podeEditar && pc.status !== 'CANCELADO' ? (
                  <span className="row" style={{ gap: 6 }}>
                    {pc.status === 'ATIVO' ? (
                      <button className="btn btn-sm" onClick={() => setAplicando(true)}>
                        Usar nos horários já marcados
                      </button>
                    ) : null}
                    <button className="btn btn-sm btn-ghost" onClick={() => setCancelando(pc)}>
                      Cancelar pacote
                    </button>
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {vendendo ? (
        <VenderPacoteModal
          clienteId={clienteId}
          onClose={() => setVendendo(false)}
          onSold={() => {
            setVendendo(false)
            reload()
            setAplicando(true)
          }}
        />
      ) : null}
      {aplicando ? (
        <AplicarPacoteModal
          clienteId={clienteId}
          onClose={() => setAplicando(false)}
          onDone={() => {
            setAplicando(false)
            reload()
          }}
        />
      ) : null}
      {cancelando ? (
        <ConfirmModal
          title="Cancelar pacote"
          confirmLabel="Cancelar pacote"
          danger
          onClose={() => setCancelando(null)}
          onConfirm={async () => {
            await post(`/clientes/${encodeURIComponent(clienteId)}/pacotes/${cancelando.id}/cancelar`, {})
            reload()
          }}
        >
          {cancelando.porSessao
            ? 'As sessões restantes deixam de valer. Como o pacote é pago por sessão, nada foi recebido na venda. Os horários já marcados com o pacote continuam com o valor da sessão.'
            : cancelando.saldos.some((s) => s.restante < s.total)
            ? 'O cliente já usou sessões deste pacote. As sessões restantes deixam de valer e o valor recebido continua no caixa (devolva o que for combinado com o cliente).'
            : 'Nenhuma sessão foi usada: o pacote é cancelado e o recebimento sai do caixa. Devolva o valor ao cliente.'}
        </ConfirmModal>
      ) : null}
    </div>
  )
}

function VenderPacoteModal({ clienteId, onClose, onSold }: { clienteId: string; onClose: () => void; onSold: () => void }) {
  const { data: pacotes, loading } = useAsync(() => get<Pacote[]>('/pacotes', { ativos: true }), [])
  const [pacoteId, setPacoteId] = useState('')
  const [valor, setValor] = useState(0)
  const [forma, setForma] = useState<Forma>('PIX')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const escolhido = (pacotes || []).find((p) => p.id === pacoteId)
  const sessoes = escolhido ? escolhido.itens.reduce((acc, i) => acc + i.quantidade, 0) : 0
  const porSessao = forma === 'POR_SESSAO'

  async function vender() {
    setError('')
    if (!escolhido) return setError('Escolha o pacote.')
    setBusy(true)
    try {
      await post(`/clientes/${encodeURIComponent(clienteId)}/pacotes`, { pacoteId, valor, forma })
      onSold()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Vender pacote"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={vender} disabled={busy || !escolhido}>
            {busy ? 'Registrando...' : porSessao ? 'Registrar pacote' : `Registrar venda${escolhido ? ` de ${brl(valor)}` : ''}`}
          </button>
        </>
      }
    >
      <div className="stack">
        {loading ? (
          <div className="muted small">Carregando pacotes...</div>
        ) : !(pacotes || []).length ? (
          <div className="banner info-banner">Nenhum pacote ativo. Cadastre em Serviços / Produtos &gt; Pacotes.</div>
        ) : (
          <>
            <Field label="Pacote">
              <select
                className="select"
                value={pacoteId}
                onChange={(e) => {
                  setPacoteId(e.target.value)
                  setValor((pacotes || []).find((p) => p.id === e.target.value)?.preco || 0)
                }}
              >
                <option value="">Escolha</option>
                {(pacotes || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} ({brl(p.preco)})
                  </option>
                ))}
              </select>
            </Field>
            {escolhido ? (
              <div className="small muted">
                {escolhido.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(' + ')}
                {escolhido.validadeDias ? ` · validade ${escolhido.validadeDias} dias` : ''}
              </div>
            ) : null}
            <Field label="Valor do pacote" hint="Altere se der desconto.">
              <MoneyInput value={valor} onChange={setValor} />
            </Field>
            <Field label="Forma de pagamento">
              <Segmented<Forma>
                options={[
                  { key: 'PIX', label: 'Pix' },
                  { key: 'MAQUININHA', label: 'Maquininha' },
                  { key: 'DINHEIRO', label: 'Dinheiro' },
                  { key: 'POR_SESSAO', label: 'Paga por sessão' },
                ]}
                value={forma}
                onChange={setForma}
              />
            </Field>
            <div className="small muted">
              {porSessao
                ? `Nada entra no caixa agora. O valor é dividido pelas ${sessoes} sessões (cerca de ${brl(Math.round(valor / Math.max(1, sessoes)))} cada) e cada agendamento coberto cobra a sua parte no dia.`
                : 'O valor entra no caixa agora. Nos agendamentos, os serviços cobertos pelo pacote saem sem cobrança.'}
            </div>
          </>
        )}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}

/** Pacote vendido depois de já ter marcado as sessões: usa o pacote nos agendamentos já marcados. */
function AplicarPacoteModal({ clienteId, onClose, onDone }: { clienteId: string; onClose: () => void; onDone: () => void }) {
  const { data, loading, error } = useAsync(() => get<AgendamentoParaPacote[]>(`/clientes/${encodeURIComponent(clienteId)}/pacotes/agendamentos`), [clienteId])
  const [desmarcados, setDesmarcados] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState('')
  const lista = data || []
  const escolhidos = lista.filter((a) => !desmarcados.includes(a.id)).map((a) => a.id)

  async function aplicar() {
    setBusy(true)
    setErro('')
    try {
      const r = await post<{ sessoesUsadas: number; resultado: Array<{ ok: boolean; erro?: string }> }>(`/clientes/${encodeURIComponent(clienteId)}/pacotes/aplicar`, { agendamentoIds: escolhidos })
      const falhas = r.resultado.filter((x) => !x.ok)
      if (falhas.length) setErro(`${falhas.length} agendamento(s) não foram alterados: ${falhas.map((x) => x.erro).join(' ')}`)
      setResultado(`${r.sessoesUsadas} sessão(ões) do pacote usada(s) nos horários marcados.`)
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Usar o pacote nos horários já marcados"
      onClose={resultado ? onDone : onClose}
      footer={
        <>
          <button className="btn" onClick={resultado ? onDone : onClose} disabled={busy}>
            {resultado ? 'Fechar' : 'Agora não'}
          </button>
          {!resultado && lista.length ? (
            <button className="btn btn-primary" onClick={aplicar} disabled={busy || !escolhidos.length}>
              {busy ? 'Aplicando...' : `Usar o pacote em ${escolhidos.length} horário(s)`}
            </button>
          ) : null}
        </>
      }
    >
      <div className="stack">
        <ErrorBanner message={error || erro} />
        <SuccessBanner message={resultado} />
        {loading ? (
          <div className="muted small">Procurando horários marcados...</div>
        ) : !lista.length ? (
          <div className="small muted">Nenhum horário já marcado que esse pacote cubra. Nos próximos agendamentos, marque "Usar pacote do cliente" ao agendar.</div>
        ) : (
          <>
            <div className="small muted">Horários da cliente com procedimento do pacote. Os marcados passam a usar uma sessão do pacote (o horário não muda).</div>
            {lista.map((a) => (
              <label key={a.id} className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={!desmarcados.includes(a.id)}
                  disabled={Boolean(resultado)}
                  onChange={(e) => setDesmarcados((x) => (e.target.checked ? x.filter((i) => i !== a.id) : [...x, a.id]))}
                />
                <span>
                  <strong>
                    {dateLong(a.data)} às {a.hora}
                  </strong>
                  {a.profissional ? <span className="muted"> · {a.profissional}</span> : null}
                  <br />
                  {a.itens.map((i, n) => (
                    <span key={n}>
                      {n ? ' + ' : ''}
                      {i.nome}
                      {i.cabe ? (
                        <span className="badge badge-primary" style={{ marginLeft: 4 }}>
                          pacote
                        </span>
                      ) : i.jaCoberto ? (
                        <span className="muted"> (já no pacote)</span>
                      ) : (
                        <span className="muted"> ({brl(i.preco)})</span>
                      )}
                    </span>
                  ))}
                </span>
              </label>
            ))}
          </>
        )}
      </div>
    </Modal>
  )
}
