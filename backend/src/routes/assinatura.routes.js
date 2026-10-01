// Assinatura da plataforma pela landing (/assinar). Rotas publicas.
const express = require("express");
const assinaturas = require("../services/assinatura/assinatura.service");
const { createAppError } = require("../lib/errors");
const { asyncHandler, ok } = require("../lib/helpers");

const router = express.Router();

// Freio simples por IP: cada tentativa cria cliente/cobranca no gateway.
const tentativas = new Map();
function limitar(max, janelaMs) {
  return (req, _res, next) => {
    const ip = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
    const chave = `${req.path}:${ip}`;
    const agora = Date.now();
    const lista = (tentativas.get(chave) || []).filter((t) => agora - t < janelaMs);
    if (lista.length >= max) return next(createAppError("Muitas tentativas. Aguarde alguns minutos e tente de novo.", 429));
    lista.push(agora);
    tentativas.set(chave, lista);
    if (tentativas.size > 5000) tentativas.clear();
    return next();
  };
}

router.get("/plano", (_req, res) => ok(res, assinaturas.plano()));

router.post(
  "/assinar",
  limitar(6, 15 * 60000),
  asyncHandler(async (req, res) => ok(res, await assinaturas.iniciarAssinatura(req.body || {})))
);

router.post(
  "/retomar",
  limitar(10, 15 * 60000),
  asyncHandler(async (req, res) => ok(res, await assinaturas.retomar(req.body || {})))
);

router.post(
  "/vincular",
  limitar(20, 15 * 60000),
  asyncHandler(async (req, res) => ok(res, await assinaturas.vincularPreapproval(req.body?.referencia, req.body?.preapprovalId)))
);

router.get(
  "/status/:ref",
  asyncHandler(async (req, res) => ok(res, await assinaturas.statusCheckout(req.params.ref)))
);

module.exports = router;
