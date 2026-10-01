const express = require("express");
const metricas = require("../services/metricas.service");
const { asyncHandler, ok } = require("../lib/helpers");
const { parsePeriod, daysBetween } = require("../lib/time");
const { badRequest } = require("../lib/errors");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const p = parsePeriod(req.query, req.auth.tenant.timezone);
    if (daysBetween(p.from, p.to).length > 400) throw badRequest("Periodo maximo de 400 dias.");
    // o profissional ve apenas os proprios indicadores
    const profissionalId = req.auth.perfil === "PROFISSIONAL" ? req.auth.profissionalId || "__nenhum__" : req.query.profissionalId ? String(req.query.profissionalId) : undefined;
    const r = await metricas.desempenho({
      tenantId: req.auth.tenantId,
      from: p.from,
      to: p.to,
      profissionalId,
      servicoId: req.query.servicoId ? String(req.query.servicoId) : undefined,
    });
    return ok(res, r);
  })
);

module.exports = router;
