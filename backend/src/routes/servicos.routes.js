const express = require("express");
const prisma = require("../lib/prisma");
const events = require("../lib/events");
const { requireAba } = require("../middleware/auth");
const { badRequest, notFound } = require("../lib/errors");
const { asyncHandler, ok, requireText, textOrNull, toInt, toBool } = require("../lib/helpers");

const router = express.Router();

// leitura liberada para quem acessa agenda (formularios); escrita exige a aba Servicos/Produtos
const leitura = requireAba("servicos", "agenda");
const escrita = requireAba("servicos");

async function mediasReais(tenantId) {
  const itens = await prisma.agendamentoServico.groupBy({
    by: ["servicoId"],
    where: { agendamento: { tenantId, status: "CONCLUIDO", duracaoValida: true }, duracaoRealMin: { not: null } },
    _avg: { duracaoRealMin: true },
    _count: { duracaoRealMin: true },
  });
  return Object.fromEntries(itens.map((i) => [i.servicoId, { media: Math.round(i._avg.duracaoRealMin), amostras: i._count.duracaoRealMin }]));
}

function payload(body, parcial = false) {
  const data = {};
  if (!parcial || body.nome !== undefined) data.nome = requireText(body.nome, "Nome");
  if (body.categoria !== undefined) data.categoria = textOrNull(body.categoria);
  if (body.descricao !== undefined) data.descricao = textOrNull(body.descricao);
  if (!parcial || body.preco !== undefined) data.preco = toInt(body.preco, 0, { min: 0 });
  if (!parcial || body.duracaoMin !== undefined) {
    data.duracaoMin = toInt(body.duracaoMin, 0, { min: 0 });
    if (data.duracaoMin < 5) throw badRequest("Informe a duracao media (minimo 5 minutos).");
  }
  if (body.intervaloMin !== undefined) data.intervaloMin = toInt(body.intervaloMin, 0, { min: 0, max: 600 });
  if (body.retornoDias !== undefined) data.retornoDias = body.retornoDias === null || body.retornoDias === "" ? null : toInt(body.retornoDias, 0, { min: 1 });
  if (body.ativo !== undefined) data.ativo = toBool(body.ativo, true);
  return data;
}

router.get(
  "/",
  leitura,
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth;
    const servicos = await prisma.servico.findMany({
      where: { tenantId },
      include: { profissionais: { select: { profissionalId: true } }, relacionados: { select: { produtoId: true } } },
      orderBy: [{ categoria: "asc" }, { nome: "asc" }],
    });
    const medias = await mediasReais(tenantId);
    return ok(
      res,
      servicos.map((s) => ({
        ...s,
        profissionalIds: s.profissionais.map((p) => p.profissionalId),
        produtoIds: s.relacionados.map((r) => r.produtoId),
        profissionais: undefined,
        relacionados: undefined,
        duracaoRealMedia: medias[s.id]?.media ?? null,
        amostrasDuracaoReal: medias[s.id]?.amostras ?? 0,
      }))
    );
  })
);

router.get(
  "/categorias",
  leitura,
  asyncHandler(async (req, res) => {
    const rows = await prisma.servico.findMany({ where: { tenantId: req.auth.tenantId, categoria: { not: null } }, distinct: ["categoria"], select: { categoria: true } });
    return ok(res, rows.map((r) => r.categoria).sort());
  })
);

async function vincular(tenantId, servicoId, { profissionalIds, produtoIds }) {
  if (Array.isArray(profissionalIds)) {
    const validos = await prisma.profissional.findMany({ where: { tenantId, id: { in: profissionalIds } }, select: { id: true } });
    await prisma.servicoProfissional.deleteMany({ where: { servicoId } });
    if (validos.length) await prisma.servicoProfissional.createMany({ data: validos.map((p) => ({ servicoId, profissionalId: p.id })) });
  }
  if (Array.isArray(produtoIds)) {
    const validos = await prisma.produto.findMany({ where: { tenantId, id: { in: produtoIds } }, select: { id: true } });
    await prisma.servicoProduto.deleteMany({ where: { servicoId } });
    if (validos.length) await prisma.servicoProduto.createMany({ data: validos.map((p) => ({ servicoId, produtoId: p.id })) });
  }
}

router.post(
  "/",
  escrita,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const servico = await prisma.servico.create({ data: { tenantId: req.auth.tenantId, ...payload(body) } });
    await vincular(req.auth.tenantId, servico.id, body);
    events.publish(req.auth.tenantId, "catalogo.atualizado", { servicoId: servico.id });
    return ok(res, servico);
  })
);

router.patch(
  "/:id",
  escrita,
  asyncHandler(async (req, res) => {
    const atual = await prisma.servico.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!atual) throw notFound("Servico nao encontrado.");
    const servico = await prisma.servico.update({ where: { id: atual.id }, data: payload(req.body || {}, true) });
    await vincular(req.auth.tenantId, servico.id, req.body || {});
    events.publish(req.auth.tenantId, "catalogo.atualizado", { servicoId: servico.id });
    return ok(res, servico);
  })
);

// A troca da duracao informada pela media real nunca e automatica: so por este botao.
router.post(
  "/:id/aplicar-duracao-real",
  escrita,
  asyncHandler(async (req, res) => {
    const atual = await prisma.servico.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!atual) throw notFound("Servico nao encontrado.");
    const medias = await mediasReais(req.auth.tenantId);
    if (!medias[atual.id]) throw badRequest("Ainda nao ha duracao real registrada para este servico.");
    const servico = await prisma.servico.update({ where: { id: atual.id }, data: { duracaoMin: medias[atual.id].media } });
    events.publish(req.auth.tenantId, "catalogo.atualizado", { servicoId: servico.id });
    return ok(res, servico);
  })
);

module.exports = router;
