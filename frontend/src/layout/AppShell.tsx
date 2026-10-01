// Layout do painel no mesmo padrao do Gestor SMG (AppLayout + AppSidebar do smg-gestor):
// dock de modulos no topo da sidebar, itens do modulo ativo abaixo, sidebar recolhivel e
// rodape com perfil + engrenagem.
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  BarChart3,
  Bot,
  CalendarDays,
  DollarSign,
  ExternalLink,
  LayoutDashboard,
  Menu,
  MessageCircle,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Repeat,
  Scissors,
  Settings,
  Star,
  TrendingUp,
  UserCog,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Link, navigate } from '../lib/router'
import { cn } from '../lib/utils'
import type { Aba } from '../types'
import PerfilModal from './PerfilModal'

type Icon = ComponentType<{ className?: string }>

interface NavItem {
  key: Aba
  label: string
  icon: Icon
}

interface ModuleDef {
  id: string
  label: string
  icon: Icon
  items: NavItem[]
}

export const MODULES: ModuleDef[] = [
  {
    id: 'operacao',
    label: 'Operação',
    icon: CalendarDays,
    items: [
      { key: 'visao-geral', label: 'Visão Geral', icon: LayoutDashboard },
      { key: 'agenda', label: 'Agenda', icon: CalendarDays },
    ],
  },
  {
    id: 'clientes',
    label: 'Clientes',
    icon: Users,
    items: [
      { key: 'clientes', label: 'Base de Clientes', icon: Users },
      { key: 'fidelidade', label: 'Fidelidade', icon: Star },
    ],
  },
  {
    id: 'catalogo',
    label: 'Catálogo e Equipe',
    icon: Scissors,
    items: [
      { key: 'servicos', label: 'Serviços / Produtos', icon: Scissors },
      { key: 'equipe', label: 'Equipe', icon: UserCog },
    ],
  },
  {
    id: 'gestao',
    label: 'Gestão',
    icon: BarChart3,
    items: [
      { key: 'financeiro', label: 'Financeiro', icon: DollarSign },
      { key: 'desempenho', label: 'Desempenho', icon: TrendingUp },
      { key: 'automacoes', label: 'Automações', icon: Repeat },
      { key: 'configuracoes', label: 'Configurações', icon: Settings },
    ],
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    items: [
      { key: 'atendimento', label: 'Atendimentos', icon: MessageSquare },
      { key: 'agentes', label: 'Agentes de IA', icon: Bot },
    ],
  },
]

/** Ordem das abas (escopo, secao 3) — usada para achar a primeira aba liberada. */
export const NAV_ITEMS = MODULES.flatMap((m) => m.items)

const PERFIL_LABEL = { DONO: 'Dono', RECEPCAO: 'Recepção', PROFISSIONAL: 'Profissional' }
const CHAVE_RECOLHIDA = 'app_sidebar_recolhida'

function iniciais(nome: string) {
  return nome
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function LogoEmpresa({ nome, className }: { nome: string; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-lg gradient-primary font-bold text-white', className)}>
      {iniciais(nome) || 'SG'}
    </div>
  )
}

export function AppShell({ aba, children }: { aba: Aba; children: ReactNode }) {
  const { usuario, podeVer } = useAuth()
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_RECOLHIDA) === '1'
    } catch {
      return false
    }
  })
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [perfilAberto, setPerfilAberto] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_RECOLHIDA, isCollapsed ? '1' : '0')
    } catch {
      /* sem storage */
    }
  }, [isCollapsed])

  const modulosAcessiveis = useMemo(
    () => MODULES.map((m) => ({ ...m, items: m.items.filter((i) => podeVer(i.key)) })).filter((m) => m.items.length),
    [podeVer]
  )
  const moduloAtivo = modulosAcessiveis.find((m) => m.items.some((i) => i.key === aba)) || modulosAcessiveis[0]

  if (!usuario) return null
  const nomeEmpresa = usuario.tenant.nome

  const abrirModulo = (mod: ModuleDef) => {
    navigate(`/app/${mod.items[0].key}`)
    setIsMobileOpen(false)
  }

  const recolhida = isCollapsed && !isMobileOpen

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      {/* Cabecalho mobile */}
      <div className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-sidebar px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <LogoEmpresa nome={nomeEmpresa} className="h-6 w-6 text-[10px]" />
          <span className="text-sm font-bold text-sidebar-foreground">{nomeEmpresa}</span>
        </div>
        <button
          type="button"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="Menu"
        >
          {isMobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>
      <div className="h-14 lg:hidden" />

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,transform] duration-300',
          'hidden lg:flex',
          isCollapsed ? 'lg:w-14' : 'lg:w-[220px]',
          isMobileOpen && '!flex w-[220px] shadow-2xl'
        )}
        style={{ top: isMobileOpen ? '56px' : '0', height: isMobileOpen ? 'calc(100dvh - 56px)' : '100dvh' }}
      >
        {/* Logo + recolher */}
        <div className={cn('flex flex-shrink-0 items-center justify-between border-b border-sidebar-border', recolhida ? 'h-14 justify-center px-2' : 'h-20 px-3')}>
          {!recolhida ? (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
                <LogoEmpresa nome={nomeEmpresa} className="h-7 w-7 text-[10px]" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold leading-tight text-sidebar-foreground">{nomeEmpresa}</p>
                  <p className="truncate text-[10px] leading-tight text-sidebar-muted">Sistema de Agendamentos</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                title="Recolher menu"
                className="hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:flex"
              >
                <PanelLeftClose className="h-5 w-5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsCollapsed(false)}
              title="Expandir menu"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <PanelLeft className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Dock de modulos */}
        <div className={cn('flex flex-shrink-0 items-center border-b border-sidebar-border', recolhida ? 'flex-col gap-1 px-1 py-2' : 'flex-row flex-wrap justify-center gap-1 px-2 py-2')}>
          {modulosAcessiveis.map((mod) => {
            const ativo = moduloAtivo?.id === mod.id
            return (
              <button
                key={mod.id}
                type="button"
                title={mod.label}
                onClick={() => abrirModulo(mod)}
                className={cn(
                  'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-all',
                  ativo ? 'gradient-primary text-white shadow-glow' : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <mod.icon className="h-[18px] w-[18px]" />
              </button>
            )
          })}
        </div>

        {/* Itens do modulo ativo */}
        {recolhida || !moduloAtivo ? null : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex-shrink-0 px-4 pb-1 pt-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">{moduloAtivo.label}</span>
            </div>
            <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pb-2">
              {moduloAtivo.items.map((item) => {
                const ativo = item.key === aba
                return (
                  <Link
                    key={item.key}
                    to={`/app/${item.key}`}
                    onClick={() => setIsMobileOpen(false)}
                    className={cn(
                      'group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all hover:no-underline',
                      ativo
                        ? 'gradient-primary text-white shadow-glow'
                        : 'text-sidebar-muted hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                )
              })}
            </nav>
          </div>
        )}

        {/* Rodape: perfil + engrenagem */}
        <div className="mt-auto flex-shrink-0 border-t border-sidebar-border p-2" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
          {recolhida ? (
            <button
              type="button"
              title="Meu perfil"
              onClick={() => setPerfilAberto(true)}
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Settings className="h-5 w-5" />
            </button>
          ) : (
            <div className="flex w-full items-center gap-2.5 rounded-lg p-2">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full gradient-primary text-xs font-bold text-white">{iniciais(usuario.nome)}</div>
              <div className="flex-1 overflow-hidden text-left">
                <p className="truncate text-xs font-semibold text-sidebar-accent-foreground">{usuario.nome}</p>
                <p className="truncate text-[10px] text-sidebar-muted">{PERFIL_LABEL[usuario.perfil]}</p>
              </div>
              <a
                href={`/s/${usuario.tenant.slug}`}
                target="_blank"
                rel="noreferrer"
                title="Ver site de agendamento"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
              <button
                type="button"
                title="Meu perfil e aparência"
                onClick={() => setPerfilAberto(true)}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {isMobileOpen ? <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setIsMobileOpen(false)} /> : null}

      <main className={cn('min-h-screen max-w-full overflow-x-hidden transition-[margin] duration-300', isCollapsed ? 'lg:ml-14' : 'lg:ml-[220px]', 'ml-0')}>
        <div className="max-w-full overflow-x-hidden p-4 md:p-6">{children}</div>
      </main>

      {perfilAberto ? <PerfilModal onClose={() => setPerfilAberto(false)} /> : null}
    </div>
  )
}
