import { useState } from 'react'
import { del, errorMessage, get, post } from '../../../lib/api'
import { dateTimeBr } from '../../../lib/format'
import { useAsync } from '../../../lib/hooks'
import { Card, ErrorBanner, Loading, SuccessBanner } from '../../../components/ui'

interface MeuGoogle {
  configurado: boolean
  conectado: boolean
  email: string | null
  sincronizadoEm: string | null
}

/** Conexão do Google Calendar do próprio usuário logado (cada profissional conecta o seu). */
export default function MeuGoogleCard({ compacto = false, onChange }: { compacto?: boolean; onChange?: () => void }) {
  const { data, loading, error, reload } = useAsync(() => get<MeuGoogle>('/equipe/meu-google'), [])
  const [busy, setBusy] = useState<'' | 'conectar' | 'sincronizar' | 'desconectar'>('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function acao(tipo: 'conectar' | 'sincronizar' | 'desconectar') {
    setBusy(tipo)
    setErr('')
    setMsg('')
    try {
      if (tipo === 'conectar') {
        const r = await get<{ url: string }>('/equipe/meu-google/conectar')
        window.location.href = r.url
        return
      }
      if (tipo === 'sincronizar') {
        const r = await post<{ eventos: number | unknown[] }>('/equipe/meu-google/sincronizar')
        const n = Array.isArray(r?.eventos) ? r.eventos.length : typeof r?.eventos === 'number' ? r.eventos : null
        setMsg(n !== null ? `Sincronizado: ${n} evento(s) importado(s).` : 'Agenda sincronizada.')
      } else {
        await del('/equipe/meu-google')
        setMsg('Google Calendar desconectado.')
      }
      reload()
      onChange?.()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <Card title="Meu Google Calendar" subtitle={compacto ? undefined : 'Eventos da sua agenda pessoal bloqueiam horários no sistema.'}>
      {!data ? (
        loading ? <Loading /> : <ErrorBanner message={error || 'Não foi possível carregar.'} />
      ) : (
        <div className="stack">
          <div className="eq-google">
            <span className="eq-google-icon">G</span>
            <div className="eq-google-main">
              {data.conectado ? (
                <>
                  <div className="strong">
                    Conectado <span className="badge badge-success">Ativo</span>
                  </div>
                  <div className="small muted">
                    {data.email || 'Conta Google'}
                    {data.sincronizadoEm ? ` · última sincronização ${dateTimeBr(data.sincronizadoEm)}` : ''}
                  </div>
                </>
              ) : (
                <>
                  <div className="strong">Não conectado</div>
                  <div className="small muted">
                    {data.configurado ? 'Conecte sua conta para bloquear automaticamente os horários ocupados.' : 'A integração com o Google ainda não foi configurada no servidor.'}
                  </div>
                </>
              )}
            </div>
            <div className="row">
              {data.conectado ? (
                <>
                  <button className="btn btn-sm" onClick={() => acao('sincronizar')} disabled={!!busy}>
                    {busy === 'sincronizar' ? 'Sincronizando...' : 'Sincronizar agora'}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => acao('desconectar')} disabled={!!busy}>
                    {busy === 'desconectar' ? 'Desconectando...' : 'Desconectar'}
                  </button>
                </>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={() => acao('conectar')} disabled={!!busy || !data.configurado}>
                  {busy === 'conectar' ? 'Redirecionando...' : 'Conectar Google'}
                </button>
              )}
            </div>
          </div>
          <ErrorBanner message={err} />
          <SuccessBanner message={msg} />
        </div>
      )}
    </Card>
  )
}
