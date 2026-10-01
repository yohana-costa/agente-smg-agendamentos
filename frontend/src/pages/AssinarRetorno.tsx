import { useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { CHAVE_ASSINATURA, entrarComToken } from './Assinar'

/**
 * Volta do Mercado Pago (/assinar/retorno?preapproval_id=...).
 * O Mercado Pago nao sabe qual conta e a da pessoa: o navegador guardou a referencia
 * antes de sair. Quem confirma e o backend, consultando o Mercado Pago de verdade.
 */
export default function AssinarRetorno() {
  const [estado, setEstado] = useState<'verificando' | 'erro'>('verificando')
  const [mensagem, setMensagem] = useState('Confirmando seu pagamento...')
  const tentativas = useRef(0)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const preapprovalId = params.get('preapproval_id') || ''
    const referencia = sessionStorage.getItem(CHAVE_ASSINATURA) || ''
    if (!referencia) {
      setEstado('erro')
      setMensagem('Não encontramos seu cadastro neste navegador. Se você já pagou, a conta é liberada sozinha em alguns minutos: entre pelo login.')
      return
    }
    let cancelado = false
    const verificar = async () => {
      if (cancelado) return
      tentativas.current += 1
      try {
        const s =
          tentativas.current === 1 && preapprovalId
            ? await api<{ liberado: boolean; token: string | null }>('/assinatura/vincular', { method: 'POST', body: { referencia, preapprovalId }, publico: true })
            : await api<{ liberado: boolean; token: string | null }>(`/assinatura/status/${referencia}`, { publico: true })
        if (s.liberado) {
          sessionStorage.removeItem(CHAVE_ASSINATURA)
          return entrarComToken(s.token)
        }
      } catch (err) {
        // Erro no vinculo e definitivo; falha de rede no polling nao.
        if (tentativas.current === 1) {
          setEstado('erro')
          setMensagem(errorMessage(err, 'Não foi possível confirmar o pagamento.'))
          return
        }
      }
      if (tentativas.current >= 24) {
        setEstado('erro')
        setMensagem('O Mercado Pago ainda não confirmou o pagamento. Assim que confirmar, sua conta libera sozinha e você entra pelo login.')
        return
      }
      setMensagem('Aguardando a confirmação do Mercado Pago...')
      timer.current = window.setTimeout(verificar, 5000)
    }
    verificar()
    return () => {
      cancelado = true
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="card center w-full max-w-md" style={{ padding: '34px 28px' }}>
        {estado !== 'erro' && <div className="mx-auto mb-5 h-9 w-9 animate-spin rounded-full border-[3px] border-muted border-t-primary" />}
        <h1 className="mb-2 text-lg font-semibold">{estado === 'erro' ? 'Quase lá' : 'Confirmando seu pagamento'}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{mensagem}</p>
        {estado === 'erro' && (
          <a href="/login" className="btn btn-primary mt-5">
            Ir para o login
          </a>
        )}
      </div>
    </div>
  )
}
