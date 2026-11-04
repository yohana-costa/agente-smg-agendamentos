// Ferramentas do assistente pessoal dentro do Agente de Gestao: respondem na hora os mesmos
// assuntos que o assistente avisa sozinho (lista da Dra. Barbara, 28/10/2026): validade,
// estoque de materiais, pagamentos pendentes, desistencias, queda de vendas/faturamento,
// cancelamentos, duvidas que a IA nao respondeu e avisos recentes. Inativos, retorno, horarios
// vagos, agenda e financeiro ja existiam no agent.js. Todas so consultam.
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const metricas = require("../../services/metricas.service");
const { todayStr, addDays, rangeUtc, zonedParts } = require("../../lib/time");
const { brl } = require("../../lib/helpers");

const dataBr = (d, tz) => {
  if (!d) return null;
  const p = zonedParts(d, tz);
  return `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`;
};

function assistenteTools(ctx) {
  const { tenant } = ctx;
  const tenantId = tenant.id;
  const tz = tenant.timezone;

  return [
    {
      modulo: "agenda",
      acao: "consultar",
      name: "resumo_do_dia",
      description: "Resumo de hoje: atendimentos do dia, faturamento de ontem, pagamentos aguardando, estoque baixo e itens vencendo. Use para 'como esta o dia?', 'resumo', 'alertas'.",
      schema: z.object({}),
      handler: async () => {
        const alertas = require("../../services/alertas.service");
        const r = await alertas.montarResumo(tenantId);
        return { ok: true, resumo: r.texto };
      },
    },
    {
      modulo: "produtos",
      acao: "consultar",
      name: "produtos_vencendo",
      description: "Produtos a venda e materiais de uso interno vencidos ou que vencem nos proximos dias (padrao 30). So entram itens com validade cadastrada.",
      schema: z.object({ dias: z.number().int().min(1).max(365).optional() }),
      handler: async ({ dias = 30 } = {}) => {
        const limite = rangeUtc(todayStr(tz), addDays(todayStr(tz), dias), tz).end;
        const hoje = rangeUtc(todayStr(tz), todayStr(tz), tz).start;
        const [produtos, materiais, semValidade] = await Promise.all([
          prisma.produto.findMany({ where: { tenantId, ativo: true, validade: { not: null, lt: limite } }, orderBy: { validade: "asc" }, select: { nome: true, validade: true, estoque: true } }),
          prisma.material.findMany({ where: { tenantId, ativo: true, validade: { not: null, lt: limite } }, orderBy: { validade: "asc" }, select: { nome: true, validade: true, quantidade: true, unidade: true } }),
          prisma.produto.count({ where: { tenantId, ativo: true, validade: null } }),
        ]);
        const item = (nome, validade, qtd) => ({ nome, validade: dataBr(validade, tz), quantidade: qtd, vencido: validade < hoje });
        return {
          ok: true,
          dias,
          produtos: produtos.map((p) => item(p.nome, p.validade, p.estoque)),
          materiais: materiais.map((m) => item(m.nome, m.validade, `${m.quantidade} ${m.unidade}`)),
          aviso: semValidade ? `${semValidade} produto(s) sem validade cadastrada nao entram nesta conta.` : null,
        };
      },
    },
    {
      modulo: "produtos",
      acao: "consultar",
      name: "estoque_materiais",
      description: "Materiais de uso interno (ferramentas, descartaveis, insumos): quantidade, minimo e os que precisam repor.",
      schema: z.object({}),
      handler: async () => {
        const materiais = await prisma.material.findMany({ where: { tenantId, ativo: true }, orderBy: { nome: "asc" } });
        return {
          ok: true,
          materiais: materiais.map((m) => ({
            nome: m.nome,
            quantidade: `${m.quantidade} ${m.unidade}`,
            minimo: m.minimo ? `${m.minimo} ${m.unidade}` : null,
            repor: m.minimo > 0 && m.quantidade <= m.minimo,
            validade: dataBr(m.validade, tz),
          })),
        };
      },
    },
    {
      modulo: "financeiro",
      acao: "consultar",
      name: "pagamentos_pendentes",
      description: "Pagamentos que ainda nao entraram: reservas aguardando pagamento, vendas aguardando e atendimentos dos ultimos 60 dias com valor em aberto.",
      schema: z.object({}),
      handler: async () => {
        const agora = new Date();
        const desde = new Date(Date.now() - 60 * 86400000);
        const [reservas, vendas, concluidos] = await Promise.all([
          prisma.agendamento.findMany({
            where: { tenantId, status: "AGUARDANDO_PAGAMENTO", expiraEm: { gt: agora } },
            include: { cliente: { select: { nome: true } }, servicos: { select: { nome: true } } },
            orderBy: { inicio: "asc" },
          }),
          prisma.venda.findMany({ where: { tenantId, status: "AGUARDANDO_PAGAMENTO", OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] }, include: { cliente: { select: { nome: true } } } }),
          prisma.agendamento.findMany({
            where: { tenantId, status: "CONCLUIDO", inicio: { gte: desde } },
            include: { cliente: { select: { nome: true } }, pagamentos: { select: { status: true, valorBruto: true, valorReembolsado: true } } },
          }),
        ]);
        const emAberto = concluidos
          .map((a) => {
            const pago = a.pagamentos.filter((p) => ["APROVADO", "REEMBOLSADO_PARCIAL"].includes(p.status)).reduce((s, p) => s + p.valorBruto - (p.valorReembolsado || 0), 0);
            return { cliente: a.cliente?.nome, data: dataBr(a.inicio, tz), falta: a.valorTotal - pago };
          })
          .filter((x) => x.falta > 0);
        return {
          ok: true,
          reservasAguardando: reservas.map((a) => ({ cliente: a.cliente?.nome, servicos: a.servicos.map((s) => s.nome).join(" + "), data: dataBr(a.inicio, tz), valor: brl(a.valorTotal) })),
          vendasAguardando: vendas.map((v) => ({ cliente: v.cliente?.nome || "Sem cliente", valor: brl(v.valorTotal), criadaEm: dataBr(v.createdAt, tz) })),
          atendimentosEmAberto: emAberto.slice(0, 30).map((x) => ({ ...x, falta: brl(x.falta) })),
          totalEmAberto: brl(emAberto.reduce((s, x) => s + x.falta, 0)),
        };
      },
    },
    {
      modulo: "clientes",
      acao: "consultar",
      name: "desistencias",
      description: "Clientes interessados que nao concluiram o agendamento nos ultimos dias (padrao 14): reservas que expiraram sem pagamento e conversas no WhatsApp sobre agendar/precos sem agendamento depois.",
      schema: z.object({ dias: z.number().int().min(1).max(90).optional() }),
      handler: async ({ dias = 14 } = {}) => {
        const desde = new Date(Date.now() - dias * 86400000);
        const expiradas = await prisma.agendamento.findMany({
          where: { tenantId, expirado: true, createdAt: { gte: desde } },
          include: { cliente: { select: { nome: true, telefone: true } }, servicos: { select: { nome: true } } },
          orderBy: { createdAt: "desc" },
          take: 30,
        });
        const conversas = await prisma.conversa.findMany({
          where: { tenantId, canal: "ATENDIMENTO", ultimaMensagemEm: { gte: desde } },
          select: { id: true, telefone: true, nomeContato: true, clienteId: true, cliente: { select: { nome: true } } },
          take: 200,
        });
        const interesse = /agend|marcar|marca[cç]|hor[aá]rio|vaga|valor|pre[cç]o|quanto (custa|fica)/i;
        const semAgendar = [];
        for (const c of conversas) {
          const msgs = await prisma.mensagem.findMany({
            where: { conversaId: c.id, autor: "CLIENTE", createdAt: { gte: desde } },
            orderBy: { createdAt: "asc" },
            select: { texto: true, createdAt: true },
          });
          const primeira = msgs.find((m) => interesse.test(m.texto || ""));
          if (!primeira) continue;
          const agendou = c.clienteId
            ? await prisma.agendamento.count({ where: { tenantId, clienteId: c.clienteId, createdAt: { gte: primeira.createdAt }, status: { not: "CANCELADO" } } })
            : 0;
          if (agendou) continue;
          semAgendar.push({
            nome: c.cliente?.nome || c.nomeContato || null,
            telefone: c.telefone,
            quando: dataBr(primeira.createdAt, tz),
            ultimaMensagem: String(msgs[msgs.length - 1]?.texto || "").slice(0, 140),
          });
          if (semAgendar.length >= 25) break;
        }
        return {
          ok: true,
          dias,
          reservasExpiradas: expiradas.map((a) => ({ cliente: a.cliente?.nome, telefone: a.cliente?.telefone, servicos: a.servicos.map((s) => s.nome).join(" + "), em: dataBr(a.createdAt, tz) })),
          conversasSemAgendamento: semAgendar,
        };
      },
    },
    {
      modulo: "desempenho",
      acao: "consultar",
      name: "comparar_periodos",
      description: "Compara os ultimos N dias (padrao 30) com os N dias anteriores: faturamento, atendimentos, servicos e produtos que mais cairam. Use para queda de vendas ou de faturamento.",
      schema: z.object({ dias: z.number().int().min(7).max(180).optional() }),
      handler: async ({ dias = 30 } = {}) => {
        const hoje = todayStr(tz);
        const atual = { from: addDays(hoje, -(dias - 1)), to: hoje };
        const anterior = { from: addDays(hoje, -(2 * dias - 1)), to: addDays(hoje, -dias) };
        const [dA, dB, fA, fB] = await Promise.all([
          metricas.desempenho({ tenantId, ...atual }),
          metricas.desempenho({ tenantId, ...anterior }),
          metricas.resultadoFinanceiro({ tenantId, ...atual, ...rangeUtc(atual.from, atual.to, tz) }),
          metricas.resultadoFinanceiro({ tenantId, ...anterior, ...rangeUtc(anterior.from, anterior.to, tz) }),
        ]);
        const variacao = (a, b) => (b ? `${Math.round(((a - b) / b) * 100)}%` : a ? "novo" : "0%");
        const porServico = {};
        for (const s of dB.servicos.maisRealizados) porServico[s.nome] = { antes: s.quantidade, agora: 0 };
        for (const s of dA.servicos.maisRealizados) porServico[s.nome] = { ...(porServico[s.nome] || { antes: 0 }), agora: s.quantidade };
        const vendidos = async (p) => {
          const r = rangeUtc(p.from, p.to, tz);
          const itens = await prisma.vendaItem.findMany({ where: { venda: { tenantId, status: "PAGO", createdAt: { gte: r.start, lt: r.end } } }, select: { nome: true, quantidade: true } });
          return itens.reduce((acc, i) => ({ ...acc, [i.nome]: (acc[i.nome] || 0) + i.quantidade }), {});
        };
        const [pA, pB] = await Promise.all([vendidos(atual), vendidos(anterior)]);
        const produtos = [...new Set([...Object.keys(pA), ...Object.keys(pB)])].map((nome) => ({ nome, antes: pB[nome] || 0, agora: pA[nome] || 0 }));
        return {
          ok: true,
          periodoAtual: `${atual.from} a ${atual.to}`,
          periodoAnterior: `${anterior.from} a ${anterior.to}`,
          faturamento: { agora: brl(fA.faturamento), antes: brl(fB.faturamento), variacao: variacao(fA.faturamento, fB.faturamento) },
          atendimentos: { agora: dA.capacidade.servicosRealizados, antes: dB.capacidade.servicosRealizados, variacao: variacao(dA.capacidade.servicosRealizados, dB.capacidade.servicosRealizados) },
          servicosQueMaisCairam: Object.entries(porServico)
            .map(([nome, v]) => ({ nome, ...v, diferenca: v.agora - v.antes }))
            .filter((s) => s.diferenca < 0)
            .sort((a, b) => a.diferenca - b.diferenca)
            .slice(0, 8),
          produtosQueMaisCairam: produtos.map((p) => ({ ...p, diferenca: p.agora - p.antes })).filter((p) => p.diferenca < 0).sort((a, b) => a.diferenca - b.diferenca).slice(0, 8),
        };
      },
    },
    {
      modulo: "agenda",
      acao: "consultar",
      name: "cancelamentos_recentes",
      description: "Agendamentos cancelados ou com falta (no-show) nos ultimos dias (padrao 7).",
      schema: z.object({ dias: z.number().int().min(1).max(90).optional() }),
      handler: async ({ dias = 7 } = {}) => {
        const desde = new Date(Date.now() - dias * 86400000);
        const ags = await prisma.agendamento.findMany({
          where: { tenantId, status: { in: ["CANCELADO", "NO_SHOW"] }, canceladoEm: { gte: desde }, expirado: false },
          include: { cliente: { select: { nome: true } }, servicos: { select: { nome: true } } },
          orderBy: { canceladoEm: "desc" },
          take: 40,
        });
        return {
          ok: true,
          dias,
          cancelamentos: ags.map((a) => ({
            cliente: a.cliente?.nome,
            servicos: a.servicos.map((s) => s.nome).join(" + "),
            horario: dataBr(a.inicio, tz),
            status: a.status,
            canceladoEm: dataBr(a.canceladoEm, tz),
            motivo: a.motivoCancelamento,
          })),
        };
      },
    },
    {
      modulo: "agenda",
      acao: "consultar",
      name: "duvidas_pendentes",
      description: "Clientes esperando resposta da equipe: duvidas que a IA de atendimento nao soube responder e pedidos de atendimento humano.",
      schema: z.object({}),
      handler: async () => {
        const conversas = await prisma.conversa.findMany({
          where: { tenantId, escalonamentoPendente: true },
          select: { telefone: true, nomeContato: true, motivoEscalonamento: true, escalonadoEm: true, cliente: { select: { nome: true } } },
          orderBy: { escalonadoEm: "desc" },
          take: 20,
        });
        return {
          ok: true,
          pendentes: conversas.map((c) => ({ cliente: c.cliente?.nome || c.nomeContato, telefone: c.telefone, pergunta: c.motivoEscalonamento, desde: dataBr(c.escalonadoEm, tz) })),
        };
      },
    },
    {
      modulo: "agenda",
      acao: "consultar",
      name: "avisos_recentes",
      description: "Ultimos avisos do assistente pessoal (novos agendamentos, cancelamentos, duvidas, resumos).",
      schema: z.object({ limite: z.number().int().min(1).max(40).optional() }),
      handler: async ({ limite = 15 } = {}) => {
        const avisos = await prisma.alerta.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limite });
        return { ok: true, avisos: avisos.map((a) => ({ quando: dataBr(a.createdAt, tz), titulo: a.titulo, texto: a.texto })) };
      },
    },
  ];
}

module.exports = { assistenteTools };
