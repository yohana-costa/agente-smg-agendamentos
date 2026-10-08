// Cadastro de pacotes de sessoes (Servicos/Produtos > Pacotes). A venda fica em /clientes/:id/pacotes.
const express = require("express");
const prisma = require("../lib/prisma");
const events = require("../lib/events");
const { requireAba } = require("../middleware/auth");
const { notFound } = require("../lib/errors");
const { asyncHandler, ok, toBool } = require("../lib/helpers");
const pacoteService = require("../services/pacote.service");

const router = express.Router();
// leitura tambem para quem usa a agenda (vender/usar pacote no atendimento); escrita so com a aba Servicos
const leitura = requireAba("servicos", "agenda", "clientes");
const escrita = requireAba("servicos");

router.get(
  "/",
  leitura,
  asyncHandler(async (req, res) => ok(res, await pacoteService.listarPacotes(req.auth.tenantId, { apenasAtivos: toBool(req.query.ativos) })))
);

router.post(
  "/",
  escrita,
  asyncHandler(async (req, res) => {
    const p = await pacoteService.salvarPacote(req.auth.tenantId, null, req.body || {});
    events.publish(req.auth.tenantId, "catalogo.atualizado", { pacoteId: p.id });
    return ok(res, p);
  })
);

router.patch(
  "/:id",
  escrita,
  asyncHandler(async (req, res) => {
    const atual = await prisma.pacote.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId }, include: { itens: true } });
    if (!atual) throw notFound("Pacote nao encontrado.");
    // so ativar/desativar sem mandar o resto
    if (Object.keys(req.body || {}).length === 1 && req.body.ativo !== undefined) {
      await prisma.pacote.update({ where: { id: atual.id }, data: { ativo: toBool(req.body.ativo) } });
      return ok(res, (await pacoteService.listarPacotes(req.auth.tenantId)).find((p) => p.id === atual.id));
    }
    const p = await pacoteService.salvarPacote(req.auth.tenantId, atual.id, req.body || {});
    events.publish(req.auth.tenantId, "catalogo.atualizado", { pacoteId: p.id });
    return ok(res, p);
  })
);

module.exports = router;
