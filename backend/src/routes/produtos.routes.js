const express = require("express");
const prisma = require("../lib/prisma");
const vendaService = require("../services/venda.service");
const { requireAba } = require("../middleware/auth");
const { badRequest, notFound } = require("../lib/errors");
const { asyncHandler, ok, requireText, textOrNull, toInt, toBool } = require("../lib/helpers");
const { parsePeriod } = require("../lib/time");

const router = express.Router();
const escrita = requireAba("servicos");
// vendas no balcao e marcacao de retirada tambem podem ser feitas pela recepcao (agenda)
const operacao = requireAba("servicos", "agenda");

router.get(
  "/",
  operacao,
  asyncHandler(async (req, res) => {
    const produtos = await prisma.produto.findMany({ where: { tenantId: req.auth.tenantId }, orderBy: { nome: "asc" } });
    return ok(res, { venderProdutos: req.auth.tenant.venderProdutos, produtos: produtos.map((p) => ({ ...p, estoqueBaixo: p.estoque <= p.estoqueMinimo })) });
  })
);

// chave "Vender produtos" no topo da tab Produtos
router.patch(
  "/config",
  escrita,
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.update({ where: { id: req.auth.tenantId }, data: { venderProdutos: toBool(req.body?.venderProdutos) } });
    return ok(res, { venderProdutos: tenant.venderProdutos });
  })
);

function payload(body, parcial = false) {
  const data = {};
  if (!parcial || body.nome !== undefined) data.nome = requireText(body.nome, "Nome");
  if (body.descricao !== undefined) data.descricao = textOrNull(body.descricao);
  if (!parcial || body.preco !== undefined) data.preco = toInt(body.preco, 0, { min: 0 });
  if (body.custo !== undefined) data.custo = toInt(body.custo, 0, { min: 0 });
  if (body.estoque !== undefined) data.estoque = toInt(body.estoque, 0, { min: 0 });
  if (body.estoqueMinimo !== undefined) data.estoqueMinimo = toInt(body.estoqueMinimo, 0, { min: 0 });
  if (body.ativo !== undefined) data.ativo = toBool(body.ativo, true);
  return data;
}

router.post(
  "/",
  escrita,
  asyncHandler(async (req, res) => ok(res, await prisma.produto.create({ data: { tenantId: req.auth.tenantId, ...payload(req.body || {}) } })))
);

router.patch(
  "/:id",
  escrita,
  asyncHandler(async (req, res) => {
    const p = await prisma.produto.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!p) throw notFound("Produto nao encontrado.");
    return ok(res, await prisma.produto.update({ where: { id: p.id }, data: payload(req.body || {}, true) }));
  })
);

// Ajuste manual: ENTRADA (soma) ou CORRECAO (define a quantidade)
router.post(
  "/:id/ajuste",
  escrita,
  asyncHandler(async (req, res) => {
    const p = await prisma.produto.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!p) throw notFound("Produto nao encontrado.");
    const quantidade = toInt(req.body?.quantidade, NaN);
    if (!Number.isFinite(quantidade)) throw badRequest("Informe a quantidade.");
    if (req.body?.tipo !== "CORRECAO" && quantidade <= 0) throw badRequest("A entrada de mercadoria deve ser maior que zero.");
    const estoque = req.body?.tipo === "CORRECAO" ? Math.max(0, quantidade) : Math.max(0, p.estoque + quantidade);
    return ok(res, await prisma.produto.update({ where: { id: p.id }, data: { estoque } }));
  })
);

router.get(
  "/vendas",
  operacao,
  asyncHandler(async (req, res) => {
    const p = parsePeriod(req.query, req.auth.tenant.timezone);
    const vendas = await prisma.venda.findMany({
      where: {
        tenantId: req.auth.tenantId,
        createdAt: { gte: p.start, lt: p.end },
        ...(req.query.origem ? { origem: String(req.query.origem) } : {}),
        ...(req.query.pendentesRetirada === "true" ? { origem: "SITE", status: "PAGO", retirado: false } : {}),
      },
      include: { itens: true, cliente: { select: { id: true, nome: true, telefone: true } }, pagamentos: true },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, vendas);
  })
);

// Registrar venda no balcao: dinheiro, maquininha ou Pix pelo sistema
router.post(
  "/vendas",
  operacao,
  asyncHandler(async (req, res) => {
    const { itens, forma, clienteId, cliente } = req.body || {};
    if (!["DINHEIRO", "MAQUININHA", "PIX"].includes(forma)) throw badRequest("Forma de pagamento invalida.");
    return ok(res, await vendaService.criarVenda({ tenantId: req.auth.tenantId, origem: "BALCAO", itens, forma, clienteId, cliente }));
  })
);

router.post(
  "/vendas/:id/retirado",
  operacao,
  asyncHandler(async (req, res) => {
    const v = await prisma.venda.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!v) throw notFound("Venda nao encontrada.");
    if (v.status !== "PAGO") throw badRequest("So vendas pagas podem ser marcadas como retiradas.");
    const retirado = req.body?.retirado === undefined ? true : toBool(req.body.retirado);
    return ok(res, await prisma.venda.update({ where: { id: v.id }, data: { retirado, retiradoEm: retirado ? new Date() : null } }));
  })
);

module.exports = router;
