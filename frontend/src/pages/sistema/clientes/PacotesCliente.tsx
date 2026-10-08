import { useState } from 'react'
import { errorMessage, get, post } from '../../../lib/api'
import { brl, dateBr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { ConfirmModal, ErrorBanner, Field, Modal, MoneyInput, Segmented } from '../../../components/ui'
import type { Pacote, PacoteCliente } from '../../../types'

const STATUS: Record<PacoteCliente['status'], { label: string; cls: string }> = {
  ATIVO: { label: 'Ativo', cls: 'badge-success' },
  FINALIZADO: { label: 'Finalizado', cls: 'badge-gray' },
  VENCIDO: { label: 'Vencido', cls: 'badge-warning' },
  CANCELADO: { label: 'Cancelado', cls: 'badge-gray' },
}

type Forma = 'DINHEIRO' | 'MAQUININHA' | 'PIX'

/** Pacotes do cliente na ficha: saldo de sessões, venda e cancelamento. */
export default function PacotesCliente({ clienteId, podeEditar }: { clienteId: string; podeEditar: boolean }) {
  const { data, loading, error, reload } = useAsync(() => get<PacoteCliente[]>(`/clientes/${encodeURIComponent(clienteId)}/pacotes`), [clienteId])
  const [vendendo, setVendendo] = useState(false)
  const [cancelando, setCancelando] = useState<PacoteCliente | null>(null)
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
                </div>
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                {pc.saldos.map((s) => (
                  <div key={s.id}>
                    {s.nome}: <strong>{s.restante}</strong> de {s.total} sessão(ões) restante(s)
                  </div>
                ))}
              </div>
              <div className="row-between small muted" style={{ marginTop: 6 }}>
                <span>{pc.validoAte ? `Válido até ${dateBr(String(pc.validoAte).slice(0, 10))}` : 'Sem validade'}</span>
                {podeEditar && pc.status !== 'CANCELADO' ? (
                  <button className="btn btn-sm btn-ghost" onClick={() => setCancelando(pc)}>
                    Cancelar pacote
                  </button>
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
          {cancelando.saldos.some((s) => s.restante < s.total)
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
            {busy ? 'Registrando...' : `Registrar venda${escolhido ? ` de ${brl(valor)}` : ''}`}
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
            <Field label="Valor cobrado" hint="Altere se der desconto.">
              <MoneyInput value={valor} onChange={setValor} />
            </Field>
            <Field label="Forma de pagamento">
              <Segmented<Forma>
                options={[
                  { key: 'PIX', label: 'Pix' },
                  { key: 'MAQUININHA', label: 'Maquininha' },
                  { key: 'DINHEIRO', label: 'Dinheiro' },
                ]}
                value={forma}
                onChange={setForma}
              />
            </Field>
            <div className="small muted">O valor entra no caixa agora. Nos agendamentos, os serviços cobertos pelo pacote saem sem cobrança.</div>
          </>
        )}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}
