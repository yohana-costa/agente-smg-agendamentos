import { useEffect, useState } from 'react'
import { get, errorMessage } from '../../../lib/api'
import { dateLong, monthRange, todayStr } from '../../../lib/format'
import { Calendario, HorariosGrid, PbAlert, PbSpinner } from '../shared/components'
import type { HorariosResposta } from '../shared/types'

/** Passo 3: calendario do mes (dias com horario livre via /dias) + horarios do dia (via /horarios). */
export default function HorarioStep({
  slug,
  servicoIds,
  profissionalId,
  data,
  hora,
  onData,
  onHora,
  recarregar,
}: {
  slug: string
  servicoIds: string[]
  profissionalId: string
  data: string
  hora: string
  onData: (d: string) => void
  onHora: (h: string) => void
  recarregar: number
}) {
  const [mes, setMes] = useState(() => monthRange(data || todayStr()).from)
  const [dias, setDias] = useState<string[]>([])
  const [carregandoDias, setCarregandoDias] = useState(true)
  const [erroDias, setErroDias] = useState('')
  const [horarios, setHorarios] = useState<string[]>([])
  const [carregandoHorarios, setCarregandoHorarios] = useState(false)
  const [erroHorarios, setErroHorarios] = useState('')
  const ids = servicoIds.join(',')

  // dias com horario livre no mes exibido
  useEffect(() => {
    let ativo = true
    const hoje = todayStr()
    const de = mes < hoje ? hoje : mes
    const fimMes = monthRange(mes).to
    setCarregandoDias(true)
    setErroDias('')
    get<string[]>(`/publico/${slug}/dias`, { servicoIds: ids, profissionalId, de }, { publico: true })
      .then((lista) => {
        if (!ativo) return
        const doMes = (lista || []).filter((d) => d >= de && d <= fimMes)
        setDias(doMes)
        // seleciona automaticamente o primeiro dia livre para poupar toques
        const selecionadaIndisponivel = Boolean(data) && data >= de && data <= fimMes && !doMes.includes(data)
        if ((!data || data < hoje || selecionadaIndisponivel) && doMes.length) {
          onData(doMes[0])
          onHora('')
        }
      })
      .catch((e) => ativo && setErroDias(errorMessage(e)))
      .finally(() => ativo && setCarregandoDias(false))
    return () => {
      ativo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, ids, profissionalId, mes, recarregar])

  // horarios do dia escolhido
  useEffect(() => {
    if (!data) {
      setHorarios([])
      return
    }
    let ativo = true
    setCarregandoHorarios(true)
    setErroHorarios('')
    get<HorariosResposta>(`/publico/${slug}/horarios`, { servicoIds: ids, profissionalId, data }, { publico: true })
      .then((r) => {
        if (!ativo) return
        const prof = r.profissionais.find((p) => p.profissionalId === profissionalId) || r.profissionais[0]
        const lista = prof?.horarios || []
        setHorarios(lista)
        if (hora && !lista.includes(hora)) onHora('')
      })
      .catch((e) => ativo && setErroHorarios(errorMessage(e)))
      .finally(() => ativo && setCarregandoHorarios(false))
    return () => {
      ativo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, ids, profissionalId, data, recarregar])

  const mesSemDias = !carregandoDias && !erroDias && dias.length === 0

  return (
    <div className="stack">
      <div className="pb-card">
        <Calendario
          mes={mes}
          onMes={setMes}
          selecionado={data}
          onSelect={(d) => {
            onData(d)
            onHora('')
          }}
          habilitado={(d) => dias.includes(d)}
          carregando={carregandoDias}
        />
        <PbAlert tipo="erro">{erroDias}</PbAlert>
        {mesSemDias ? (
          <div className="pb-empty-inline">
            Não há horários livres neste mês.{' '}
            <button type="button" className="pb-link" onClick={() => setMes(new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1)).toISOString().slice(0, 10))}>
              Ver o próximo mês ›
            </button>
          </div>
        ) : null}
      </div>

      {data ? (
        <div className="pb-card">
          <div className="pb-card-title">{dateLong(data)}</div>
          {carregandoHorarios ? (
            <PbSpinner label="Buscando horários livres..." />
          ) : erroHorarios ? (
            <PbAlert tipo="erro">{erroHorarios}</PbAlert>
          ) : horarios.length ? (
            <HorariosGrid horarios={horarios} selecionado={hora} onSelect={onHora} />
          ) : (
            <div className="pb-empty-inline">Nenhum horário livre neste dia. Escolha outra data no calendário.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
