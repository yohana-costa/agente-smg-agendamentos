const express = require("express");
const prisma = require("../lib/prisma");
const metricas = require("../services/metricas.service");
const { forbidden, badRequest, notFound } = require("../lib/errors");
const { asyncHandler, ok, requireText, textOrNull, toInt } = require("../lib/helpers");
const { parsePeriod, isDateStr, todayStr } = require("../lib/time");

const router = express.Router();

// Recepcao acessa apenas Recebimentos (a menos que o dono libere o financeiro completo).
function completo(req, _res, next) {
  if (req.auth.perfil === "DONO" || req.auth.permissoes.financeiroCompleto) return next();
  return next(forbidden("Seu perfil acessa apenas Recebimentos."));
}

router.get(
  "/recebimentos",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const p = parsePeriod(req.query, tenant.timezone);
    const pagamentos = await prisma.pagamento.findMany({
      where: { tenantId, status: { in: ["APROVADO", "REEMBOLSADO", "REEMBOLSADO_PARCIAL"] }, pagoEm: { gte: p.start, lt: p.end } },
      include: {
        cliente: { select: { id: true, nome: true, telefone: true } },
        agendamento: { select: { id: true, origem: true, servicos: { select: { nome: true } } } },
        venda: { select: { id: true, origem: true } },
      },
      orderBy: { pagoEm: "desc" },
    });
    const lista = pagamentos.map((pg) => ({
      id: pg.id,
      data: pg.pagoEm,
      cliente: pg.cliente,
      // origem: site, agente, manual ou balcao
      origem: pg.agendamento?.origem || (pg.venda ? (pg.venda.origem === "SITE" ? "SITE" : "BALCAO") : pg.origem),
      tipo: pg.agendamento ? "SERVICO" : pg.venda ? "PRODUTO" : "OUTRO",
      descricao: pg.descricao || pg.agendamento?.servicos.map((s) => s.nome).join(" + ") || null,
      modo: pg.modo,
      forma: pg.forma,
      valorBruto: pg.valorBruto,
      taxaGateway: pg.taxaGateway,
      valorLiquido: pg.valorLiquido,
      valorReembolsado: pg.valorReembolsado,
      status: pg.status,
    }));
    return ok(res, {
      periodo: { de: p.from, ate: p.to },
      totais: {
        bruto: lista.reduce((a, x) => a + x.valorBruto, 0),
        taxas: lista.reduce((a, x) => a + x.taxaGateway, 0),
        liquido: lista.reduce((a, x) => a + x.valorLiquido, 0),
      },
      recebimentos: lista,
    });
  })
);

// Registro manual de outros recebimentos
router.post(
  "/recebimentos",
  asyncHandler(async (req, res) => {
    const valor = toInt(req.body?.valor, 0, { min: 0 });
    if (!valor) throw badRequest("Informe o valor.");
    const forma = ["DINHEIRO", "MAQUININHA", "PIX", "CARTAO"].includes(req.body?.forma) ? req.body.forma : "DINHEIRO";
    const pagamento = await prisma.pagamento.create({
      data: {
        tenantId: req.auth.tenantId,
        descricao: requireText(req.body?.descricao, "Descricao"),
        origem: "OUTRO",
        modo: "LOCAL",
        forma,
        status: "APROVADO",
        valorBruto: valor,
        valorLiquido: valor,
        pagoEm: isDateStr(req.body?.data) ? new Date(`${req.body.data}T12:00:00Z`) : new Date(),
      },
    });
    return ok(res, pagamento);
  })
);

router.get(
  "/reembolsos",
  completo,
  asyncHandler(async (req, res) => {
    const p = parsePeriod(req.query, req.auth.tenant.timezone);
    const reembolsos = await prisma.reembolso.findMany({
      where: { tenantId: req.auth.tenantId, createdAt: { gte: p.start, lt: p.end } },
      include: {
        cliente: { select: { id: true, nome: true } },
        agendamento: { select: { id: true, inicio: true, servicos: { select: { nome: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, reembolsos);
  })
);

router.get(
  "/despesas",
  completo,
  asyncHandler(async (req, res) => {
    const p = parsePeriod(req.query, req.auth.tenant.timezone);
    const despesas = await prisma.despesa.findMany({ where: { tenantId: req.auth.tenantId, data: { gte: p.from, lte: p.to } }, orderBy: { data: "desc" } });
    const categorias = await prisma.despesa.findMany({ where: { tenantId: req.auth.tenantId }, distinct: ["categoria"], select: { categoria: true } });
    return ok(res, { despesas, categorias: categorias.map((c) => c.categoria).sort() });
  })
);

router.post(
  "/despesas",
  completo,
  asyncHandler(async (req, res) => {
    const valor = toInt(req.body?.valor, 0, { min: 0 });
    if (!valor) throw badRequest("Informe o valor.");
    const despesa = await prisma.despesa.create({
      data: {
        tenantId: req.auth.tenantId,
        data: isDateStr(req.body?.data) ? req.body.data : todayStr(req.auth.tenant.timezone),
        categoria: requireText(req.body?.categoria, "Categoria"),
        descricao: textOrNull(req.body?.descricao),
        valor,
      },
    });
    return ok(res, despesa);
  })
);

router.delete(
  "/despesas/:id",
  completo,
  asyncHandler(async (req, res) => {
    const r = await prisma.despesa.deleteMany({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!r.count) throw notFound("Despesa nao encontrada.");
    return ok(res, { removida: true });
  })
);

router.get(
  "/comissoes",
  completo,
  asyncHandler(async (req, res) => {
    const p = parsePeriod(req.query, req.auth.tenant.timezone);
    return ok(res, { periodo: { de: p.from, ate: p.to }, comissoes: await metricas.comissoes({ tenantId: req.auth.tenantId, ...p }) });
  })
);

router.post(
  "/comissoes/pagar",
  completo,
  asyncHandler(async (req, res) => {
    const p = parsePeriod(req.body || {}, req.auth.tenant.timezone);
    const profissionalId = String(req.body?.profissionalId || "");
    const [c] = await metricas.comissoes({ tenantId: req.auth.tenantId, ...p, profissionalId });
    if (!c) throw notFound("Profissional nao encontrado.");
    const paga = await prisma.comissaoPaga.upsert({
      where: { profissionalId_periodoInicio_periodoFim: { profissionalId, periodoInicio: p.from, periodoFim: p.to } },
      update: { valor: c.valor, pagoEm: new Date() },
      create: { tenantId: req.auth.tenantId, profissionalId, periodoInicio: p.from, periodoFim: p.to, valor: c.valor },
    });
    return ok(res, paga);
  })
);

router.delete(
  "/comissoes/pagar",
  completo,
  asyncHandler(async (req, res) => {
    const p = parsePeriod(req.query, req.auth.tenant.timezone);
    await prisma.comissaoPaga.deleteMany({
      where: { tenantId: req.auth.tenantId, profissionalId: String(req.query.profissionalId || ""), periodoInicio: p.from, periodoFim: p.to },
    });
    return ok(res, { desmarcada: true });
  })
);

router.get(
  "/resultado",
  completo,
  asyncHandler(async (req, res) => {
    const p = parsePeriod(req.query, req.auth.tenant.timezone);
    return ok(res, { periodo: { de: p.from, ate: p.to }, ...(await metricas.resultadoFinanceiro({ tenantId: req.auth.tenantId, ...p })) });
  })
);

module.exports = router;
