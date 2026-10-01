const express = require("express");
const prisma = require("../lib/prisma");
const fidelidade = require("../services/fidelidade.service");
const { badRequest, notFound } = require("../lib/errors");
const { asyncHandler, ok, requireText, textOrNull, toInt, toBool, textOrEmpty } = require("../lib/helpers");
const { isDateStr } = require("../lib/time");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const [recompensas, cupons] = await Promise.all([
      prisma.recompensa.findMany({ where: { tenantId }, include: { servico: { select: { nome: true } } }, orderBy: { pontosCusto: "asc" } }),
      prisma.cupom.findMany({ where: { tenantId }, include: { cliente: { select: { nome: true, telefone: true } } }, orderBy: { createdAt: "desc" } }),
    ]);
    return ok(res, {
      config: { fidelidadeAtiva: tenant.fidelidadeAtiva, pontosPorReal: tenant.pontosPorReal, pontosPorAtendimento: tenant.pontosPorAtendimento },
      recompensas,
      cupons,
    });
  })
);

router.patch(
  "/config",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.fidelidadeAtiva !== undefined) data.fidelidadeAtiva = toBool(b.fidelidadeAtiva);
    if (b.pontosPorReal !== undefined) data.pontosPorReal = toInt(b.pontosPorReal, 0, { min: 0, max: 1000 });
    if (b.pontosPorAtendimento !== undefined) data.pontosPorAtendimento = toInt(b.pontosPorAtendimento, 0, { min: 0, max: 100000 });
    const t = await prisma.tenant.update({ where: { id: req.auth.tenantId }, data });
    return ok(res, { fidelidadeAtiva: t.fidelidadeAtiva, pontosPorReal: t.pontosPorReal, pontosPorAtendimento: t.pontosPorAtendimento });
  })
);

function recompensaPayload(b) {
  const tipo = b.tipo === "SERVICO_DESCONTO" ? "SERVICO_DESCONTO" : "SERVICO_GRATIS";
  return {
    nome: requireText(b.nome, "Nome"),
    tipo,
    servicoId: textOrNull(b.servicoId),
    descontoPct: tipo === "SERVICO_DESCONTO" ? toInt(b.descontoPct, 0, { min: 1, max: 100 }) : 0,
    pontosCusto: toInt(b.pontosCusto, 0, { min: 1 }),
    ativo: b.ativo === undefined ? true : toBool(b.ativo),
  };
}

router.post("/recompensas", asyncHandler(async (req, res) => ok(res, await prisma.recompensa.create({ data: { tenantId: req.auth.tenantId, ...recompensaPayload(req.body || {}) } }))));
router.patch(
  "/recompensas/:id",
  asyncHandler(async (req, res) => {
    const r = await prisma.recompensa.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!r) throw notFound("Recompensa nao encontrada.");
    return ok(res, await prisma.recompensa.update({ where: { id: r.id }, data: recompensaPayload({ ...r, ...req.body }) }));
  })
);

function cupomPayload(b, tenantId) {
  const tipo = b.tipo === "VALOR" ? "VALOR" : "PERCENTUAL";
  const valor = toInt(b.valor, 0, { min: 1, max: tipo === "PERCENTUAL" ? 100 : 100000000 });
  return {
    tenantId,
    codigo: requireText(b.codigo, "Codigo").toUpperCase().replace(/\s+/g, ""),
    tipo,
    valor,
    clienteId: textOrNull(b.clienteId),
    validade: isDateStr(b.validade) ? b.validade : null,
    limiteUsos: b.limiteUsos ? toInt(b.limiteUsos, 0, { min: 1 }) : null,
    ativo: b.ativo === undefined ? true : toBool(b.ativo),
  };
}

router.post(
  "/cupons",
  asyncHandler(async (req, res) => {
    const data = cupomPayload(req.body || {}, req.auth.tenantId);
    if (await prisma.cupom.findUnique({ where: { tenantId_codigo: { tenantId: req.auth.tenantId, codigo: data.codigo } } })) throw badRequest("Ja existe um cupom com este codigo.");
    return ok(res, await prisma.cupom.create({ data }));
  })
);
router.patch(
  "/cupons/:id",
  asyncHandler(async (req, res) => {
    const c = await prisma.cupom.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!c) throw notFound("Cupom nao encontrado.");
    const data = cupomPayload({ ...c, ...req.body }, req.auth.tenantId);
    const outro = await prisma.cupom.findUnique({ where: { tenantId_codigo: { tenantId: req.auth.tenantId, codigo: data.codigo } } });
    if (outro && outro.id !== c.id) throw badRequest("Ja existe um cupom com este codigo.");
    return ok(res, await prisma.cupom.update({ where: { id: c.id }, data }));
  })
);

router.get(
  "/extrato/:clienteId",
  asyncHandler(async (req, res) => {
    const cliente = await prisma.cliente.findFirst({ where: { id: req.params.clienteId, tenantId: req.auth.tenantId } });
    if (!cliente) throw notFound("Cliente nao encontrado.");
    const movimentos = await prisma.movimentoPontos.findMany({ where: { clienteId: cliente.id }, orderBy: { createdAt: "desc" } });
    const ganhos = movimentos.filter((m) => m.pontos > 0).reduce((a, m) => a + m.pontos, 0);
    const usados = movimentos.filter((m) => m.pontos < 0).reduce((a, m) => a - m.pontos, 0);
    return ok(res, { cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone }, saldo: cliente.pontos, ganhos, usados, movimentos });
  })
);

// Saldos de todos os clientes (extrato geral)
router.get(
  "/saldos",
  asyncHandler(async (req, res) => {
    const busca = textOrEmpty(req.query.busca);
    const clientes = await prisma.cliente.findMany({
      where: { tenantId: req.auth.tenantId, mescladoEmId: null, ...(busca ? { OR: [{ nome: { contains: busca, mode: "insensitive" } }, { telefone: { contains: busca.replace(/\D/g, "") || busca } }] } : { pontos: { not: 0 } }) },
      select: { id: true, nome: true, telefone: true, pontos: true },
      orderBy: { pontos: "desc" },
      take: 200,
    });
    return ok(res, clientes);
  })
);

router.post(
  "/ajuste",
  asyncHandler(async (req, res) => {
    const { clienteId, pontos, descricao } = req.body || {};
    const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, tenantId: req.auth.tenantId } });
    if (!cliente) throw notFound("Cliente nao encontrado.");
    const valor = toInt(pontos, 0);
    if (!valor) throw badRequest("Informe os pontos (positivo ou negativo).");
    if (cliente.pontos + valor < 0) throw badRequest("O saldo nao pode ficar negativo.");
    return ok(res, await fidelidade.movimentar(null, { tenantId: req.auth.tenantId, clienteId, tipo: "AJUSTE", pontos: valor, descricao: textOrNull(descricao) || "Ajuste manual" }));
  })
);

module.exports = router;
