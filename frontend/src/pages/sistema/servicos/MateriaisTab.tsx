import { useState, type FormEvent } from 'react'
import { AlertTriangle, Boxes, Wrench } from 'lucide-react'
import { errorMessage, get, patch, post } from '../../../lib/api'
import { brl } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, Empty, ErrorBanner, Field, Loading, Modal, Segmented, Stat, SuccessBanner } from '../../../components/ui'

/**
 * Materiais de uso interno: ferramentas, descartaveis e insumos que a clinica usa e nao vende.
 * Estoque separado dos Produtos (que vao para o site e para as vendas).
 */
type Material = {
  id: string
  nome: string
  unidade: string
  quantidade: number
  minimo: number
  custo: number
  observacao: string | null
  ativo: boolean
  abaixoDoMinimo: boolean
}

type Movimento = {
  id: string
  tipo: 'ENTRADA' | 'SAIDA' | 'CORRECAO'
  quantidade: number
  saldo: number
  observacao: string | null
  usuarioNome: string | null
  createdAt: string
}

type TipoMov = Movimento['tipo']

const UNIDADES = ['un', 'caixa', 'pacote', 'frasco', 'ml', 'litro', 'g', 'kg', 'par', 'rolo']

const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export default function MateriaisTab() {
  const { data, loading, error, reload } = useAsync(() => get<Material[]>('/materiais'), [])
  const [editando, setEditando] = useState<Material | 'novo' | null>(null)
  const [movendo, setMovendo] = useState<{ material: Material; tipo: TipoMov } | null>(null)
  const [historico, setHistorico] = useState<Material | null>(null)
  const [busca, setBusca] = useState('')
  const [verArquivados, setVerArquivados] = useState(false)
  const [msg, setMsg] = useState('')

  function feedback(m: string) {
    setMsg(m)
    window.setTimeout(() => setMsg((atual) => (atual === m ? '' : atual)), 4500)
  }

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBanner message={error} />
  if (!data) return null

  const ativos = data.filter((m) => m.ativo)
  const abaixo = ativos.filter((m) => m.abaixoDoMinimo)
  const valor = ativos.reduce((acc, m) => acc + m.custo * m.quantidade, 0)
  const termo = busca.trim().toLowerCase()
  const lista = data.filter((m) => (verArquivados || m.ativo) && (!termo || m.nome.toLowerCase().includes(termo)))

  return (
    <div className="stack">
      <SuccessBanner message={msg} />

      <div className="stats-grid">
        <Stat icon={Wrench} grad="sky" label="Materiais" value={ativos.length} hint="Itens de uso interno" />
        <Stat
          icon={AlertTriangle}
          grad="amber"
          label="Abaixo do mínimo"
          value={<span className={abaixo.length ? 'danger-text' : ''}>{abaixo.length}</span>}
          hint={abaixo.length ? abaixo.slice(0, 3).map((m) => m.nome).join(', ') + (abaixo.length > 3 ? '…' : '') : 'Tudo em ordem'}
        />
        <Stat icon={Boxes} grad="indigo" label="Valor em estoque" value={brl(Math.round(valor))} hint="Pelo custo informado" />
      </div>

      <Card
        title="Materiais de uso interno"
        subtitle="Ferramentas, descartáveis e insumos que a clínica usa. Não aparecem no site nem nas vendas."
        actions={
          <>
            <input className="input input-sm" style={{ width: 200 }} placeholder="Buscar material..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            <button className="btn" onClick={() => setVerArquivados((v) => !v)}>
              {verArquivados ? 'Esconder arquivados' : 'Ver arquivados'}
            </button>
            <button className="btn btn-primary" onClick={() => setEditando('novo')}>
              + Novo material
            </button>
          </>
        }
      >
        {!lista.length ? (
          <Empty icon="🧰">{data.length ? 'Nenhum material encontrado.' : 'Nenhum material cadastrado ainda.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="right">Em estoque</th>
                  <th className="right">Mínimo</th>
                  <th className="right">Custo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.map((m) => (
                  <tr key={m.id} className={m.ativo ? '' : 'sv-inativo'}>
                    <td>
                      <div className="sv-name">{m.nome}</div>
                      {m.observacao ? <div className="sv-desc" title={m.observacao}>{m.observacao}</div> : null}
                    </td>
                    <td className="right nowrap">
                      <span className="strong">
                        {num(m.quantidade)} {m.unidade}
                      </span>{' '}
                      {m.quantidade <= 0 ? <span className="badge badge-danger">Acabou</span> : m.abaixoDoMinimo ? <span className="badge badge-warning">Repor</span> : null}
                    </td>
                    <td className="right muted nowrap">{m.minimo ? `${num(m.minimo)} ${m.unidade}` : '—'}</td>
                    <td className="right muted nowrap">{m.custo ? `${brl(m.custo)} / ${m.unidade}` : '—'}</td>
                    <td className="right nowrap sv-keep">
                      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button className="btn btn-sm" onClick={() => setMovendo({ material: m, tipo: 'ENTRADA' })} disabled={!m.ativo}>
                          Entrada
                        </button>
                        <button className="btn btn-sm" onClick={() => setMovendo({ material: m, tipo: 'SAIDA' })} disabled={!m.ativo || m.quantidade <= 0}>
                          Uso
                        </button>
                        <button className="btn btn-sm" onClick={() => setMovendo({ material: m, tipo: 'CORRECAO' })} disabled={!m.ativo}>
                          Correção
                        </button>
                        <button className="btn btn-sm" onClick={() => setHistorico(m)}>
                          Histórico
                        </button>
                        <button className="btn btn-sm" onClick={() => setEditando(m)}>
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editando ? (
        <MaterialModal
          material={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)}
          onSaved={(m) => {
            setEditando(null)
            reload()
            feedback(m)
          }}
        />
      ) : null}
      {movendo ? (
        <MovimentoModal
          material={movendo.material}
          tipoInicial={movendo.tipo}
          onClose={() => setMovendo(null)}
          onSaved={(m) => {
            setMovendo(null)
            reload()
            feedback(m)
          }}
        />
      ) : null}
      {historico ? <HistoricoModal material={historico} onClose={() => setHistorico(null)} /> : null}
    </div>
  )
}

function MaterialModal({ material, onClose, onSaved }: { material: Material | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [nome, setNome] = useState(material?.nome || '')
  const [unidade, setUnidade] = useState(material?.unidade || 'un')
  const [quantidade, setQuantidade] = useState('')
  const [minimo, setMinimo] = useState(material?.minimo ? String(material.minimo) : '')
  const [custo, setCusto] = useState(material?.custo ? (material.custo / 100).toFixed(2) : '')
  const [observacao, setObservacao] = useState(material?.observacao || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function salvar(e?: FormEvent) {
    e?.preventDefault()
    if (!nome.trim()) return setError('Informe o nome do material.')
    setSaving(true)
    setError('')
    const body: Record<string, unknown> = {
      nome: nome.trim(),
      unidade,
      minimo: minimo.replace(',', '.'),
      custo: Math.round((Number(custo.replace(',', '.')) || 0) * 100),
      observacao,
    }
    try {
      if (material) await patch(`/materiais/${material.id}`, body)
      else await post('/materiais', { ...body, quantidade: quantidade.replace(',', '.') })
      onSaved(material ? `“${nome.trim()}” atualizado.` : `“${nome.trim()}” cadastrado.`)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  async function arquivar(ativo: boolean) {
    if (!material) return
    setSaving(true)
    try {
      await patch(`/materiais/${material.id}`, { ativo })
      onSaved(ativo ? `“${material.nome}” reativado.` : `“${material.nome}” arquivado.`)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={material ? `Editar · ${material.nome}` : 'Novo material'}
      onClose={onClose}
      footer={
        <>
          {material ? (
            <button className="btn" style={{ marginRight: 'auto' }} onClick={() => arquivar(!material.ativo)} disabled={saving}>
              {material.ativo ? 'Arquivar' : 'Reativar'}
            </button>
          ) : null}
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => salvar()} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={salvar}>
        <Field label="Nome">
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Luva descartável, Lixa, Algodão" autoFocus />
        </Field>
        <div className="form-grid">
          <Field label="Unidade">
            <select className="select" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
              {(UNIDADES.includes(unidade) ? UNIDADES : [unidade, ...UNIDADES]).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
          {material ? (
            <Field label="Em estoque" hint="Para mudar, use Entrada, Uso ou Correção.">
              <input className="input" value={`${num(material.quantidade)} ${material.unidade}`} disabled />
            </Field>
          ) : (
            <Field label="Quantidade atual">
              <input className="input" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="0" />
            </Field>
          )}
          <Field label="Quantidade mínima" hint="Abaixo disso, aparece o aviso de repor.">
            <input className="input" inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Custo por unidade (R$)" hint="Opcional. Só para saber o valor parado em estoque.">
            <input className="input" inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} placeholder="0,00" />
          </Field>
        </div>
        <Field label="Observação">
          <input className="input" value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: fornecedor, marca, onde fica guardado" />
        </Field>
        <ErrorBanner message={error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function MovimentoModal({
  material,
  tipoInicial,
  onClose,
  onSaved,
}: {
  material: Material
  tipoInicial: TipoMov
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const [tipo, setTipo] = useState<TipoMov>(tipoInicial)
  const [quantidade, setQuantidade] = useState('')
  const [observacao, setObservacao] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const q = Number(quantidade.replace(',', '.'))
  const valido = quantidade.trim() !== '' && Number.isFinite(q) && (tipo === 'CORRECAO' ? q >= 0 : q > 0)
  const novo = !valido ? null : tipo === 'ENTRADA' ? material.quantidade + q : tipo === 'SAIDA' ? material.quantidade - q : q

  async function salvar(e?: FormEvent) {
    e?.preventDefault()
    if (!valido) return setError('Informe a quantidade.')
    if (novo !== null && novo < 0) return setError(`Só há ${num(material.quantidade)} ${material.unidade} em estoque.`)
    setSaving(true)
    setError('')
    try {
      const r = await post<Material>(`/materiais/${material.id}/movimento`, { tipo, quantidade: q, observacao })
      onSaved(`“${material.nome}”: agora ${num(r.quantidade)} ${r.unidade}.`)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`${material.nome}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => salvar()} disabled={saving || !valido}>
            {saving ? 'Salvando...' : 'Confirmar'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={salvar}>
        <Segmented<TipoMov>
          value={tipo}
          onChange={(t) => {
            setTipo(t)
            setQuantidade('')
          }}
          options={[
            { key: 'ENTRADA', label: 'Entrada' },
            { key: 'SAIDA', label: 'Uso / saída' },
            { key: 'CORRECAO', label: 'Correção' },
          ]}
        />
        <Field
          label={tipo === 'ENTRADA' ? 'Quanto chegou' : tipo === 'SAIDA' ? 'Quanto foi usado' : 'Quantidade contada agora'}
          hint={tipo === 'CORRECAO' ? 'Substitui a quantidade atual (contagem física).' : undefined}
        >
          <div className="input-group">
            <input className="input" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} autoFocus />
            <span className="addon">{material.unidade}</span>
          </div>
        </Field>
        <Field label="Observação (opcional)">
          <input
            className="input"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder={tipo === 'ENTRADA' ? 'Ex.: compra no fornecedor X' : tipo === 'SAIDA' ? 'Ex.: usado na sala 2' : 'Ex.: contagem do mês'}
          />
        </Field>
        <div className="sv-preview">
          Agora: <strong>{num(material.quantidade)} {material.unidade}</strong>
          {novo !== null && novo >= 0 ? (
            <>
              {' '}
              → depois: <strong>{num(Math.round(novo * 1000) / 1000)} {material.unidade}</strong>
              {material.minimo > 0 && novo <= material.minimo ? <span className="badge badge-warning" style={{ marginLeft: 8 }}>Abaixo do mínimo</span> : null}
            </>
          ) : null}
        </div>
        <ErrorBanner message={error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

const ROTULO_TIPO: Record<TipoMov, string> = { ENTRADA: 'Entrada', SAIDA: 'Uso', CORRECAO: 'Correção' }

function HistoricoModal({ material, onClose }: { material: Material; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => get<Movimento[]>(`/materiais/${material.id}/movimentos`), [material.id])
  return (
    <Modal title={`Histórico · ${material.nome}`} onClose={onClose} size="lg">
      {loading && !data ? <Loading /> : null}
      <ErrorBanner message={error} />
      {data && !data.length ? <Empty icon="🗒️">Nenhuma movimentação ainda.</Empty> : null}
      {data && data.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Movimento</th>
                <th className="right">Saldo</th>
                <th>Quem</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {data.map((mv) => (
                <tr key={mv.id}>
                  <td className="nowrap">{new Date(mv.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="nowrap">
                    {ROTULO_TIPO[mv.tipo]}{' '}
                    <span className="strong">
                      {mv.tipo === 'ENTRADA' ? '+' : mv.tipo === 'SAIDA' ? '−' : '='}
                      {num(mv.quantidade)} {material.unidade}
                    </span>
                  </td>
                  <td className="right nowrap">
                    {num(mv.saldo)} {material.unidade}
                  </td>
                  <td className="muted">{mv.usuarioNome || '—'}</td>
                  <td className="muted">{mv.observacao || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  )
}
