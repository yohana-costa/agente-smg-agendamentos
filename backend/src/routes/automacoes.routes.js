const express = require("express");
const prisma = require("../lib/prisma");
const { garantirAutomacoes } = require("../services/automacao.service");
const { badRequest } = require("../lib/errors");
const { asyncHandler, ok, toInt, toBool, requireText } = require("../lib/helpers");

const router = express.Router();

const ORDEM = ["LEMBRETE_PAGAMENTO", "CONFIRMACAO", "LEMBRETE_ATENDIMENTO", "POS_ATENDIMENTO", "AVISO_RETORNO", "AVISO_REAGENDAMENTO", "AVISO_CANCELAMENTO"];

router.get(
  "/",
  asyncHandler(async (req, res) => {
    await garantirAutomacoes(req.auth.tenantId);
    const automacoes = await prisma.automacao.findMany({ where: { tenantId: req.auth.tenantId } });
    return ok(res, automacoes.sort((a, b) => ORDEM.indexOf(a.tipo) - ORDEM.indexOf(b.tipo)));
  })
);

router.patch(
  "/:tipo",
  asyncHandler(async (req, res) => {
    const tipo = String(req.params.tipo || "").toUpperCase();
    if (!ORDEM.includes(tipo)) throw badRequest("Automacao invalida.");
    const b = req.body || {};
    const data = {};
    if (b.ativo !== undefined) data.ativo = toBool(b.ativo);
    if (b.disparoMin !== undefined) data.disparoMin = toInt(b.disparoMin, 0, { min: 0, max: 60 * 24 * 60 });
    if (b.texto !== undefined) data.texto = requireText(b.texto, "Texto");
    await garantirAutomacoes(req.auth.tenantId);
    return ok(res, await prisma.automacao.update({ where: { tenantId_tipo: { tenantId: req.auth.tenantId, tipo } }, data }));
  })
);

module.exports = router;
