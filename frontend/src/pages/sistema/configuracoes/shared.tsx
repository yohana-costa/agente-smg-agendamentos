import { useState } from 'react'
import { errorMessage } from '../../../lib/api'
import { ErrorBanner, SuccessBanner } from '../../../components/ui'
import type { Aba } from '../../../types'

export interface HorarioDia {
  diaSemana: number
  aberto: boolean
  inicio: string
  fim: string
}

export interface ConfigDados {
  empresa: { nome: string; documento: string | null; telefone: string | null; email: string | null; endereco: string | null; timezone: string; slug: string }
  funcionamento: HorarioDia[]
  politicas: { prazoCancelamentoMin: number; reembolsoForaPrazoPct: number; reembolsoNoShowPct: number; reembolsoIntegralDescontaTaxa: boolean }
  agenda: { toleranciaPendenteMin: number; intervaloSlotsMin: number }
  metas: { metaServicosMes: number; metaValorMes: number }
  pagamentos: { modo: 'simulado' | 'mercadopago'; mpAccessTokenConfigurado: boolean; mpPublicKey: string | null; webhookUrl: string }
  site: { url: string; siteTitulo: string | null; siteDescricao: string | null; siteCorPrimaria: string | null; siteLogoUrl: string | null; siteBannerUrl: string | null }
  integracoes: { googleConfigurado: boolean }
  plano: { plano: string; ativo: boolean; desde: string }
}

export interface PermissoesPerfil {
  abas: Aba[]
  verFinanceiroVisaoGeral?: boolean
  financeiroCompleto?: boolean
  verAgendaColegas?: boolean
}

export interface UsuariosDados {
  usuarios: Array<{ id: string; nome: string; email: string; perfil: 'DONO' | 'RECEPCAO' | 'PROFISSIONAL'; ativo: boolean; profissionalId: string | null; ultimoLoginEm: string | null; createdAt: string }>
  abas: Aba[]
  permissoes: { RECEPCAO: PermissoesPerfil; PROFISSIONAL: PermissoesPerfil }
  padrao: { RECEPCAO: PermissoesPerfil; PROFISSIONAL: PermissoesPerfil }
}

/** Estado padrao de um formulario: salvando / erro / sucesso. */
export function useSalvar() {
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  async function salvar(fn: () => Promise<void>, mensagem = 'Alterações salvas.') {
    setSalvando(true)
    setErro('')
    setOk('')
    try {
      await fn()
      setOk(mensagem)
    } catch (e) {
      setErro(errorMessage(e))
    } finally {
      setSalvando(false)
    }
  }
  return { salvando, erro, ok, setErro, setOk, salvar }
}

export function SaveBar({ salvando, erro, ok, onSave, label = 'Salvar' }: { salvando: boolean; erro: string; ok: string; onSave: () => void; label?: string }) {
  return (
    <>
      {erro || ok ? (
        <div className="stack" style={{ marginTop: 14 }}>
          <ErrorBanner message={erro} />
          <SuccessBanner message={ok} />
        </div>
      ) : null}
      <div className="form-actions">
        <button className="btn btn-primary" onClick={onSave} disabled={salvando}>
          {salvando ? 'Salvando...' : label}
        </button>
      </div>
    </>
  )
}
