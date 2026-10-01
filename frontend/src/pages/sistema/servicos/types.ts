import { get } from '../../../lib/api'
import type { ProfissionalRef } from '../../../types'

export interface VendaItem {
  id: string
  produtoId: string
  nome: string
  quantidade: number
  precoUnit: number
}

export interface VendaPagamento {
  id: string
  status: string
  modo: 'ONLINE' | 'LOCAL'
  forma: 'PIX' | 'CARTAO' | 'DINHEIRO' | 'MAQUININHA' | null
  valorBruto: number
  pixCopiaCola: string | null
  pixQrCode: string | null
  pagoEm: string | null
}

export interface Venda {
  id: string
  clienteId: string | null
  origem: 'SITE' | 'BALCAO'
  status: 'AGUARDANDO_PAGAMENTO' | 'PAGO' | 'CANCELADO'
  valorTotal: number
  retirado: boolean
  retiradoEm: string | null
  createdAt: string
  itens: VendaItem[]
  cliente: { id: string; nome: string; telefone: string } | null
  pagamentos: VendaPagamento[]
}

export const STATUS_VENDA: Record<Venda['status'], { label: string; cls: string }> = {
  AGUARDANDO_PAGAMENTO: { label: 'Aguardando pagamento', cls: 'badge-warning' },
  PAGO: { label: 'Pago', cls: 'badge-success' },
  CANCELADO: { label: 'Cancelado', cls: 'badge-gray' },
}

/** Margem bruta em % sobre o preço de venda. */
export function margem(preco: number, custo: number) {
  if (!preco) return 0
  return ((preco - custo) / preco) * 100
}

/**
 * Lista de profissionais para os formulários. Usa /agenda/referencias (liberado para quem vê a agenda)
 * e cai para /equipe quando o perfil não acessa a agenda.
 */
export async function carregarProfissionais(): Promise<ProfissionalRef[]> {
  try {
    const r = await get<{ profissionais: ProfissionalRef[] }>('/agenda/referencias')
    return r.profissionais || []
  } catch {
    try {
      const r = await get<Array<{ id: string; nome: string; cor?: string; ativo?: boolean }> | { profissionais: Array<{ id: string; nome: string; cor?: string }> }>('/equipe')
      const lista = Array.isArray(r) ? r : r.profissionais || []
      return lista.map((p) => ({ id: p.id, nome: p.nome, cor: p.cor || '#007f64' }))
    } catch {
      return []
    }
  }
}
