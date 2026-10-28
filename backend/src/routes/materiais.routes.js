// Materiais de uso interno (aba Servicos / Produtos > Materiais): o que a clinica usa e nao vende
// (ferramentas, descartaveis, insumos). Estoque proprio, com historico de cada movimento.
const express = require("express");
const prisma = require("../lib/prisma");
const { requireAba } = require("../middleware/auth");
const { badRequest, notFound } = require("../lib/errors");
const { asyncHandler, ok, requireText, textOrNull, toInt, toBool } = require("../lib/helpers");

const router = express.Router();
const acesso = requireAba("servicos");

// Quantidade com ate 3 casas (ex.: 0,5 frasco), sem lixo de ponto flutuante.
function qtd(v, rotulo, { min = 0 } = {}) {
  const n = Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < min) throw badRequest(`Informe ${rotulo} valida.`);
  return Math.round(n * 1000) / 1000;
}

const comAlerta = (m) => ({ ...m, abaixoDoMinimo: m.minimo > 0 && m.quantidade <= m.minimo });

async function doTenant(req) {
  const m = await prisma.material.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!m) throw notFound("Material nao encontrado.");
  return m;
}

router.get(
  "/",
  acesso,
  asyncHandler(async (req, res) => {
    const materiais = await prisma.material.findMany({ where: { tenantId: req.auth.tenantId }, orderBy: { nome: "asc" } });
    return ok(res, materiais.map(comAlerta));
  })
);

router.post(
  "/",
  acesso,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const quantidade = b.quantidade === undefined || b.quantidade === "" ? 0 : qtd(b.quantidade, "a quantidade");
    const material = await prisma.$transaction(async (tx) => {
      const m = await tx.material.create({
        data: {
          tenantId: req.auth.tenantId,
          nome: requireText(b.nome, "Nome"),
          unidade: textOrNull(b.unidade) || "un",
          quantidade,
          minimo: b.minimo === undefined || b.minimo === "" ? 0 : qtd(b.minimo, "a quantidade minima"),
          custo: toInt(b.custo, 0, { min: 0 }),
          observacao: textOrNull(b.observacao),
        },
      });
      if (quantidade > 0) {
        await tx.materialMovimento.create({
          data: { tenantId: m.tenantId, materialId: m.id, tipo: "ENTRADA", quantidade, saldo: quantidade, observacao: "Cadastro", usuarioNome: req.auth.nome },
        });
      }
      return m;
    });
    return ok(res, comAlerta(material));
  })
);

router.patch(
  "/:id",
  acesso,
  asyncHandler(async (req, res) => {
    const m = await doTenant(req);
    const b = req.body || {};
    const data = {};
    if (b.nome !== undefined) data.nome = requireText(b.nome, "Nome");
    if (b.unidade !== undefined) data.unidade = textOrNull(b.unidade) || "un";
    if (b.minimo !== undefined) data.minimo = b.minimo === "" ? 0 : qtd(b.minimo, "a quantidade minima");
    if (b.custo !== undefined) data.custo = toInt(b.custo, 0, { min: 0 });
    if (b.observacao !== undefined) data.observacao = textOrNull(b.observacao);
    if (b.ativo !== undefined) data.ativo = toBool(b.ativo, true);
    return ok(res, comAlerta(await prisma.material.update({ where: { id: m.id }, data })));
  })
);

// ENTRADA soma, SAIDA (uso) subtrai, CORRECAO define a quantidade contada.
router.post(
  "/:id/movimento",
  acesso,
  asyncHandler(async (req, res) => {
    const m = await doTenant(req);
    const tipo = String(req.body?.tipo || "");
    if (!["ENTRADA", "SAIDA", "CORRECAO"].includes(tipo)) throw badRequest("Tipo de movimento invalido.");
    const quantidade = qtd(req.body?.quantidade, "a quantidade", { min: 0 });
    if (tipo !== "CORRECAO" && quantidade <= 0) throw badRequest("A quantidade precisa ser maior que zero.");
    const atualizado = await prisma.$transaction(async (tx) => {
      const atual = await tx.material.findUnique({ where: { id: m.id } });
      const bruto = tipo === "ENTRADA" ? atual.quantidade + quantidade : tipo === "SAIDA" ? atual.quantidade - quantidade : quantidade;
      if (bruto < 0) throw badRequest(`So ha ${String(atual.quantidade).replace(".", ",")} ${atual.unidade} em estoque.`);
      const saldo = Math.round(bruto * 1000) / 1000;
      await tx.materialMovimento.create({
        data: { tenantId: atual.tenantId, materialId: atual.id, tipo, quantidade, saldo, observacao: textOrNull(req.body?.observacao), usuarioNome: req.auth.nome },
      });
      return tx.material.update({ where: { id: atual.id }, data: { quantidade: saldo } });
    });
    return ok(res, comAlerta(atualizado));
  })
);

router.get(
  "/:id/movimentos",
  acesso,
  asyncHandler(async (req, res) => {
    const m = await doTenant(req);
    return ok(res, await prisma.materialMovimento.findMany({ where: { materialId: m.id }, orderBy: { createdAt: "desc" }, take: 100 }));
  })
);

module.exports = router;
