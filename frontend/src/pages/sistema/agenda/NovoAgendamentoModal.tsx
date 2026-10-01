// Novo agendamento (escopo 6.3): cliente, servicos, profissional, data/horario, produtos, pagamento, observacoes.
import { useEffect, useMemo, useState } from 'react'
import { errorMessage, get, post } from '../../../lib/api'
import { brl, dateLong, duration, todayStr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { useAuth } from '../../../lib/auth'
import { ErrorBanner, Field, Modal, Segmented, StatusBadge } from '../../../components/ui'
import type { Agendamento, Cliente, Conflito } from '../../../types'
import type { ClienteMin, NovoPrefill, Referencias } from './types'
import { conflitosDoErro, pagamentoPixPendente } from './utils'
import { ClienteSelect, ConflitosAviso, HorariosPicker, PixBox } from './Widgets'

type FormaPagamento = 'LINK' | 'PIX' | 'LOCAL'

export function NovoAgendamentoModal({
  refs,
  prefill,
  refreshKey,
  onClose,
  onCreated,
}: {
  refs: Referencias
  prefill: NovoPrefill
  refreshKey: number
  onClose: () => void
  onCreated: (ag: Agendamento, mensagem: string) => void
}) {
  const { usuario } = useAuth()
  const ehProfissional = usuario?.perfil === 'PROFISSIONAL'
  const [cliente, setCliente] = useState<ClienteMin | null>(prefill.cliente || null)
  const [servicoIds, setServicoIds] = useState<string[]>(prefill.servicoIds || [])
  const [profissionalId, setProfissionalId] = useState(prefill.profissionalId || (ehProfissional ? usuario?.profissionalId || '' : ''))
  const [data, setData] = useState(prefill.data || todayStr())
  const [hora, setHora] = useState(prefill.hora || '')
  const [produtos, setProdutos] = useState<Record<string, number>>({})
  const [pagamento, setPagamento] = useState<FormaPagamento>('LINK')
  const [observacoes, setObservacoes] = useState('')
  const [cupom, setCupom] = useState('')
  const [buscaServico, setBuscaServico] = useState('')
  const [conflitos, setConflitos] = useState<Conflito[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [criadoId, setCriadoId] = useState<string | null>(null)

  // cliente pre-selecionado por deep link (?novo=1&clienteId=)
  useEffect(() => {
    if (prefill.cliente || !prefill.clienteId) return
    get<{ cliente: Cliente }>(`/clientes/${prefill.clienteId}`)
      .then((r) => setCliente({ id: r.cliente.id, nome: r.cliente.nome, telefone: r.cliente.telefone, observacoes: r.cliente.observacoes }))
      .catch((e) => setError(`Não foi possível carregar o cliente: ${errorMessage(e)}`))
  }, [prefill.cliente, prefill.clienteId])

  const selecionados = useMemo(() => servicoIds.map((id) => refs.servicos.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => Boolean(s)), [servicoIds, refs.servicos])
  const habilitados = useMemo(() => {
    let list = refs.profissionais.filter((p) => selecionados.every((s) => s.profissionalIds.includes(p.id)))
    if (ehProfissional) list = list.filter((p) => p.id === usuario?.profissionalId)
    return list
  }, [refs.profissionais, selecionados, ehProfissional, usuario?.profissionalId])
  const profInvalido = Boolean(profissionalId && selecionados.length && !habilitados.some((p) => p.id === profissionalId))
  const profNome = refs.profissionais.find((p) => p.id === profissionalId)?.nome

  const duracaoServicos = selecionados.reduce((acc, s) => acc + s.duracaoMin, 0)
  const intervalos = selecionados.reduce((acc, s) => acc + s.intervaloMin, 0)
  const valorServicos = selecionados.reduce((acc, s) => acc + s.preco, 0)

  const relacionados = useMemo(() => {
    if (!refs.venderProdutos) return []
    const ids = new Set(selecionados.flatMap((s) => s.produtosRelacionados))
    return refs.produtos.filter((p) => ids.has(p.id) && p.ativo !== false)
  }, [refs.venderProdutos, refs.produtos, selecionados])
  const valorProdutos = relacionados.reduce((acc, p) => acc + (produtos[p.id] || 0) * p.preco, 0)

  const servicosFiltrados = refs.servicos.filter((s) => !buscaServico || s.nome.toLowerCase().includes(buscaServico.toLowerCase()) || (s.categoria || '').toLowerCase().includes(buscaServico.toLowerCase()))
  const categorias = Array.from(new Set(servicosFiltrados.map((s) => s.categoria || 'Outros')))

  function toggleServico(id: string) {
    setServicoIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
    setConflitos(null)
  }

  async function salvar(encaixe = false) {
    setError('')
    if (!cliente) return setError('Escolha ou cadastre o cliente.')
    if (!servicoIds.length) return setError('Escolha pelo menos um serviço.')
    if (!profissionalId || profInvalido) return setError('Escolha um profissional habilitado para todos os serviços.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) return setError('Escolha a data e o horário.')
    setBusy(true)
    try {
      const ag = await post<Agendamento>('/agenda/agendamentos', {
        clienteId: cliente.id,
        servicoIds,
        profissionalId,
        data,
        hora,
        produtos: Object.entries(produtos)
          .filter(([, q]) => q > 0)
          .map(([produtoId, quantidade]) => ({ produtoId, quantidade })),
        pagamento,
        observacoes: observacoes.trim() || undefined,
        cupom: cupom.trim() || undefined,
        encaixe,
      })
      const msg =
        ag.status === 'CONFIRMADO'
          ? pagamento === 'LOCAL'
            ? 'Agendamento confirmado. Pagamento no local.'
            : 'Agendamento confirmado.'
          : pagamento === 'PIX'
            ? 'Agendamento criado. Mostre o QR code do Pix ao cliente.'
            : 'Agendamento criado. O link de pagamento foi enviado pelo WhatsApp.'
      onCreated(ag, msg)
      if (pagamento === 'PIX' && ag.status === 'AGUARDANDO_PAGAMENTO') setCriadoId(ag.id)
      else onClose()
    } catch (e) {
      const c = conflitosDoErro(e)
      if (c) setConflitos(c)
      else setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (criadoId) return <PixStep id={criadoId} refreshKey={refreshKey} onClose={onClose} />

  return (
    <Modal
      title="Novo agendamento"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <div className="ag-footer-total">
            Total <strong>{brl(valorServicos + valorProdutos)}</strong>
            {cupom.trim() ? <span className="small muted"> (antes do cupom)</span> : null}
          </div>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          {conflitos ? (
            <button className="btn btn-danger" onClick={() => salvar(true)} disabled={busy}>
              {busy ? 'Aguarde…' : 'Confirmar encaixe'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => salvar(false)} disabled={busy}>
              {busy ? 'Salvando…' : 'Criar agendamento'}
            </button>
          )}
        </>
      }
    >
      <div className="stack ag-form">
        <section className="ag-step">
          <div className="ag-step-title">
            <span className="ag-step-n">1</span> Cliente
          </div>
          <ClienteSelect value={cliente} onChange={setCliente} />
        </section>

        <section className="ag-step">
          <div className="ag-step-title">
            <span className="ag-step-n">2</span> Serviços
          </div>
          {refs.servicos.length > 8 ? <input className="input input-sm" placeholder="Filtrar serviços…" value={buscaServico} onChange={(e) => setBuscaServico(e.target.value)} /> : null}
          <div className="ag-servicos">
            {categorias.map((cat) => (
              <div key={cat} className="stack-sm">
                {categorias.length > 1 ? <div className="small muted strong">{cat}</div> : null}
                <div className="chips">
                  {servicosFiltrados
                    .filter((s) => (s.categoria || 'Outros') === cat)
                    .map((s) => (
                      <button type="button" key={s.id} className={`chip ${servicoIds.includes(s.id) ? 'active' : ''}`} onClick={() => toggleServico(s.id)} title={`${duration(s.duracaoMin)} + ${s.intervaloMin} min de intervalo · ${brl(s.preco)}`}>
                        {s.nome}
                      </button>
                    ))}
                </div>
              </div>
            ))}
            {!refs.servicos.length ? <div className="small muted">Nenhum serviço ativo cadastrado.</div> : null}
          </div>
          {selecionados.length ? (
            <div className="ag-subcard">
              {selecionados.map((s, i) => (
                <div key={s.id} className="row-between small ag-serv-line">
                  <span>
                    {i + 1}. {s.nome}
                  </span>
                  <span className="muted">
                    {duration(s.duracaoMin)}
                    {s.intervaloMin ? ` + ${s.intervaloMin} min intervalo` : ''} · {brl(s.preco)}
                  </span>
                </div>
              ))}
              <div className="ag-duracao">
                <span>
                  Atendimento <strong>{duration(duracaoServicos + intervalos - (selecionados[selecionados.length - 1]?.intervaloMin || 0))}</strong>
                </span>
                <span>
                  Intervalos <strong>{duration(intervalos)}</strong>
                </span>
                <span>
                  Ocupa na agenda <strong>{duration(duracaoServicos + intervalos)}</strong>
                </span>
              </div>
            </div>
          ) : null}
        </section>

        <section className="ag-step">
          <div className="ag-step-title">
            <span className="ag-step-n">3</span> Profissional
          </div>
          {profInvalido ? <div className="banner warning-banner">{profNome || 'O profissional escolhido'} não realiza todos os serviços escolhidos. Escolha outro.</div> : null}
          <div className="chips">
            {(selecionados.length ? habilitados : ehProfissional ? refs.profissionais.filter((p) => p.id === usuario?.profissionalId) : refs.profissionais).map((p) => (
              <button
                type="button"
                key={p.id}
                className={`chip ${profissionalId === p.id ? 'active' : ''}`}
                onClick={() => {
                  setProfissionalId(p.id)
                  setConflitos(null)
                }}
              >
                <span className="dot" style={{ background: p.cor, marginRight: 6 }} />
                {p.nome}
              </button>
            ))}
          </div>
          {selecionados.length && !habilitados.length ? <div className="small danger-text">Nenhum profissional realiza todos esses serviços juntos.</div> : null}
          {!selecionados.length ? <div className="small muted">Só aparecem os profissionais habilitados para todos os serviços escolhidos.</div> : null}
        </section>

        <section className="ag-step">
          <div className="ag-step-title">
            <span className="ag-step-n">4</span> Data e horário
          </div>
          <div className="row">
            <input
              type="date"
              className="input ag-w-170"
              value={data}
              onChange={(e) => {
                setData(e.target.value)
                setConflitos(null)
              }}
            />
            <span className="small muted">{/^\d{4}-\d{2}-\d{2}$/.test(data) ? dateLong(data) : ''}</span>
          </div>
          <HorariosPicker
            servicoIds={servicoIds}
            data={data}
            profissionalId={profInvalido ? undefined : profissionalId || undefined}
            value={hora}
            onChange={(h) => {
              setHora(h)
              setConflitos(null)
            }}
            onPickProf={(id) => setProfissionalId(id)}
          />
        </section>

        {relacionados.length ? (
          <section className="ag-step">
            <div className="ag-step-title">
              <span className="ag-step-n">5</span> Produtos sugeridos <span className="small muted">(opcional)</span>
            </div>
            <div className="stack-sm">
              {relacionados.map((p) => {
                const q = produtos[p.id] || 0
                return (
                  <div key={p.id} className="ag-prod-line">
                    <label className="checkbox" style={{ flex: 1 }}>
                      <input type="checkbox" checked={q > 0} disabled={p.estoque <= 0} onChange={(e) => setProdutos({ ...produtos, [p.id]: e.target.checked ? 1 : 0 })} />
                      <span>
                        {p.nome} <span className="small muted">· {brl(p.preco)}</span>
                        {p.estoque <= 0 ? <span className="small danger-text"> · sem estoque</span> : null}
                      </span>
                    </label>
                    {q > 0 ? (
                      <input type="number" min={1} max={Math.min(99, p.estoque)} className="input input-sm ag-w-80" value={q} onChange={(e) => setProdutos({ ...produtos, [p.id]: Math.max(1, Number(e.target.value) || 1) })} />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        <section className="ag-step">
          <div className="ag-step-title">
            <span className="ag-step-n">{relacionados.length ? 6 : 5}</span> Pagamento
          </div>
          <Segmented
            options={[
              { key: 'LINK', label: 'Enviar link' },
              { key: 'PIX', label: 'Pix agora' },
              { key: 'LOCAL', label: 'Pagar no local' },
            ]}
            value={pagamento}
            onChange={setPagamento}
          />
          <div className="small muted">
            {pagamento === 'LINK'
              ? 'O cliente recebe o link pelo WhatsApp e o agendamento fica Aguardando pagamento (reserva de 15 minutos).'
              : pagamento === 'PIX'
                ? 'O QR code do Pix aparece na tela logo após criar o agendamento.'
                : 'Dinheiro ou maquininha no dia do atendimento. O agendamento entra como Confirmado.'}
          </div>
        </section>

        <section className="ag-step">
          <div className="ag-step-title">
            <span className="ag-step-n">{relacionados.length ? 7 : 6}</span> Observações
          </div>
          <div className="form-grid">
            <Field label="Observações" className="full">
              <textarea className="textarea" rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Opcional" />
            </Field>
            <Field label="Cupom de desconto" hint="Opcional.">
              <input className="input" value={cupom} onChange={(e) => setCupom(e.target.value.toUpperCase())} placeholder="CÓDIGO" />
            </Field>
          </div>
        </section>

        {conflitos ? <ConflitosAviso conflitos={conflitos} /> : null}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  )
}

function PixStep({ id, refreshKey, onClose }: { id: string; refreshKey: number; onClose: () => void }) {
  const { data: ag, error } = useAsync(() => get<Agendamento>(`/agenda/agendamentos/${id}`), [id, refreshKey])
  const pix = pagamentoPixPendente(ag)
  return (
    <Modal
      title="Pix agora"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Concluir
        </button>
      }
    >
      <div className="stack">
        {ag ? (
          <div className="row-between">
            <div>
              <div className="strong">{ag.cliente?.nome}</div>
              <div className="small muted">
                {ag.servicos.map((s) => s.nome).join(' + ')} · {dateLong(ag.data)} às {ag.hora}
              </div>
            </div>
            <StatusBadge agendamento={ag} />
          </div>
        ) : null}
        <ErrorBanner message={error} />
        {ag && ag.status !== 'AGUARDANDO_PAGAMENTO' ? (
          <div className="banner success-banner">{ag.status === 'CONFIRMADO' ? 'Pagamento aprovado! Agendamento confirmado.' : 'O agendamento não está mais aguardando pagamento.'}</div>
        ) : pix ? (
          <PixBox pagamento={pix} segundosReserva={ag?.segundosRestantesReserva} />
        ) : ag ? (
          <div className="banner info-banner">O Pix ainda está sendo gerado. Se não aparecer, use “Reenviar link” no painel do agendamento.</div>
        ) : null}
      </div>
    </Modal>
  )
}
