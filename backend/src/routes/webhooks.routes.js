const express = require("express");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const env = require("../config/env");
const orchestrator = require("../agents/orchestrator");
const pagamentos = require("../services/pagamentos/pagamento.service");
const { getAgenteConfig } = require("../services/whatsapp/whatsapp.service");
const { log } = require("../lib/helpers");

const router = express.Router();

// ---------- Mercado Pago ----------

function assinaturaValida(req, dataId) {
  if (!env.mpWebhookSecret) return true;
  const signature = String(req.headers["x-signature"] || "");
  const requestId = String(req.headers["x-request-id"] || "");
  const parts = Object.fromEntries(signature.split(",").map((p) => p.trim().split("=")));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto.createHmac("sha256", env.mpWebhookSecret).update(manifest).digest("hex");
  const recebido = Buffer.from(String(parts.v1));
  return recebido.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), recebido);
}

router.post("/mercadopago", async (req, res) => {
  const tenantId = String(req.query.tenant || "");
  const tipo = req.body?.type || req.query.type || req.query.topic;
  const paymentId = req.body?.data?.id || req.query["data.id"] || req.query.id;
  if (tipo !== "payment" || !paymentId) return res.status(200).json({ success: true, ignorado: true });
  if (!assinaturaValida(req, paymentId)) return res.status(401).json({ success: false, error: "Assinatura invalida." });
  try {
    const r = await pagamentos.processarWebhookMercadoPago({ tenantId, paymentId });
    return res.status(200).json({ success: true, data: r });
  } catch (error) {
    log("webhooks.mp", "erro", { tenantId, paymentId, erro: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ---------- WhatsApp ----------

// Verificacao do webhook da Meta
router.get("/whatsapp/:slug/meta", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { slug: req.params.slug } });
  if (!tenant) return res.sendStatus(404);
  const config = await getAgenteConfig(tenant.id);
  const token = req.query["hub.verify_token"];
  if (req.query["hub.mode"] === "subscribe" && token && token === config.whatsappConfig?.verifyToken) {
    return res.status(200).send(String(req.query["hub.challenge"] || ""));
  }
  return res.sendStatus(403);
});

router.post("/whatsapp/:slug/:provider", async (req, res) => {
  const provider = req.params.provider === "meta" ? "meta" : "uazapi";
  try {
    const resultados = await orchestrator.processarWebhook({
      tenantSlug: req.params.slug,
      provider,
      payload: req.body,
      headers: req.headers,
      query: req.query,
      rawBody: req.rawBody || null,
    });
    return res.status(200).json({ success: true, data: resultados });
  } catch (error) {
    log("webhooks.whatsapp", "erro", { slug: req.params.slug, provider, erro: error.message });
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

module.exports = router;
