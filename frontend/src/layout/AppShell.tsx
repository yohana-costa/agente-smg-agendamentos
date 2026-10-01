import { useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import type { Aba } from '../types'

export const NAV_ITEMS: Array<{ key: Aba; label: string; icon: string; hint: string }> = [
  { key: 'visao-geral', label: 'Visão Geral', icon: '◎', hint: 'O que precisa de ação agora' },
  { key: 'agenda', label: 'Agenda', icon: '▦', hint: 'Capacidade e agendamentos' },
  { key: 'clientes', label: 'Clientes', icon: '☺', hint: 'Base única de clientes' },
  { key: 'servicos', label: 'Serviços / Produtos', icon: '✂', hint: 'Catálogo e estoque' },
  { key: 'equipe', label: 'Equipe', icon: '♟', hint: 'Profissionais e jornada' },
  { key: 'financeiro', label: 'Financeiro', icon: '$', hint: 'Entradas, saídas e resultado' },
  { key: 'desempenho', label: 'Desempenho', icon: '↗', hint: 'Indicadores do negócio' },
  { key: 'atendimento', label: 'Atendimento', icon: '✉', hint: 'Conversas do agente' },
  { key: 'fidelidade', label: 'Fidelidade', icon: '★', hint: 'Pontos, recompensas e cupons' },
  { key: 'agentes', label: 'Agentes de IA', icon: '◆', hint: 'Atendimento e Gestão' },
  { key: 'automacoes', label: 'Automações', icon: '⟳', hint: 'Mensagens automáticas' },
  { key: 'configuracoes', label: 'Configurações', icon: '⚙', hint: 'Empresa, políticas e acessos' },
]

const PERFIL_LABEL = { DONO: 'Dono', RECEPCAO: 'Recepção', PROFISSIONAL: 'Profissional' }

export function AppShell({ aba, children }: { aba: Aba; children: ReactNode }) {
  const { usuario, logout, podeVer } = useAuth()
  const [aberto, setAberto] = useState(false)
  if (!usuario) return null
  const itens = NAV_ITEMS.filter((i) => podeVer(i.key))

  return (
    <div className="app-shell">
      <div className="mobile-topbar">
        <button className="icon-btn" onClick={() => setAberto(true)} aria-label="Abrir menu">
          ☰
        </button>
        <strong>{NAV_ITEMS.find((i) => i.key === aba)?.label}</strong>
      </div>
      <aside className={`nav-sidebar ${aberto ? 'open' : ''}`}>
        <div className="brand-panel">
          <div className="brand-kicker">Gestor SMG</div>
          <div className="brand-title">Agendamentos</div>
          <div className="brand-sub">{usuario.tenant.nome}</div>
        </div>
        <nav className="menu-list">
          {itens.map((item) => (
            <Link key={item.key} to={`/app/${item.key}`} className={`nav-item ${aba === item.key ? 'active' : ''}`} onClick={() => setAberto(false)} title={item.hint}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">{usuario.nome}</div>
          <div className="sidebar-role">{PERFIL_LABEL[usuario.perfil]}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <a className="btn btn-light btn-sm" href={`/s/${usuario.tenant.slug}`} target="_blank" rel="noreferrer">
              Ver site
            </a>
            <button className="btn btn-light btn-sm" onClick={logout}>
              Sair
            </button>
          </div>
        </div>
      </aside>
      {aberto ? <div className="drawer-backdrop" style={{ zIndex: 110 }} onClick={() => setAberto(false)} /> : null}
      <main className="content">{children}</main>
    </div>
  )
}
