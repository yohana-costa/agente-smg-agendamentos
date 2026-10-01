// Gateway SMG -> Mercado Pago.
// O link enviado ao cliente aponta sempre para o checkout proprio da SMG (/pagamento/:id),
// que gera o Pix (QR code) ou redireciona para o checkout de cartao do Mercado Pago.
// Sem access token (do estabelecimento ou global), opera em modo "simulado" para desenvolvimento.
const axios = require("axios");
const crypto = require("crypto");
const env = require("../../config/env");
const { createAppError } = require("../../lib/errors");
const { log } = require("../../lib/helpers");

const MP_BASE = "https://api.mercadopago.com";

function accessTokenFor(tenant) {
  return (tenant?.mpAccessToken || env.mpAccessToken || "").trim();
}

function modo(tenant) {
  return accessTokenFor(tenant) ? "mercadopago" : "simulado";
}

function linkCheckout(pagamentoId) {
  return `${env.publicAppUrl}/pagamento/${pagamentoId}`;
}

function notificationUrl(tenantId) {
  return `${env.publicApiUrl}/api/webhooks/mercadopago?tenant=${encodeURIComponent(tenantId)}`;
}

function taxaEstimada(valor, forma) {
  const pct = forma === "CARTAO" ? env.gatewayTaxaCartaoPct : env.gatewayTaxaPixPct;
  return Math.round((valor * pct) / 100);
}

async function mpRequest(tenant, method, path, data, { idempotencyKey } = {}) {
  const token = accessTokenFor(tenant);
  const response = await axios({
    method,
    url: `${MP_BASE}${path}`,
    data,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
    },
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    log("gateway.mp", "erro", { path, status: response.status, data: response.data });
    throw createAppError(response?.data?.message || `Mercado Pago retornou status ${response.status}.`, 502, response.data);
  }
  return response.data;
}

// Pix: cria pagamento Pix e retorna QR code.
async function criarPix(tenant, pagamento, { email, descricao, expiraEm }) {
  if (modo(tenant) === "simulado") {
    const fake = `00020126SIMULADO-SMG-${pagamento.id}-${pagamento.valorBruto}5204000053039865802BR6304`;
    return { gatewayRef: `sim_pix_${pagamento.id}`, pixCopiaCola: fake, pixQrCode: null };
  }
  const body = {
    transaction_amount: Number((pagamento.valorBruto / 100).toFixed(2)),
    description: descricao || "Agendamento",
    payment_method_id: "pix",
    external_reference: pagamento.id,
    notification_url: notificationUrl(tenant.id),
    payer: { email: email || tenant.email || "cliente@smgcompany.com.br" },
    ...(expiraEm ? { date_of_expiration: new Date(expiraEm).toISOString().replace("Z", "-00:00") } : {}),
  };
  const data = await mpRequest(tenant, "post", "/v1/payments", body, { idempotencyKey: `pix-${pagamento.id}-${pagamento.valorBruto}` });
  const tx = data?.point_of_interaction?.transaction_data || {};
  return { gatewayRef: String(data.id), pixCopiaCola: tx.qr_code || null, pixQrCode: tx.qr_code_base64 || null };
}

// Cartao: preferencia do Checkout Pro (o cliente paga na pagina do Mercado Pago).
async function criarCheckoutCartao(tenant, pagamento, { descricao, expiraEm }) {
  if (modo(tenant) === "simulado") {
    return { gatewayRef: `sim_pref_${pagamento.id}`, url: `${linkCheckout(pagamento.id)}?simular=cartao` };
  }
  const body = {
    items: [{ title: descricao || "Agendamento", quantity: 1, currency_id: "BRL", unit_price: Number((pagamento.valorBruto / 100).toFixed(2)) }],
    external_reference: pagamento.id,
    notification_url: notificationUrl(tenant.id),
    back_urls: { success: linkCheckout(pagamento.id), pending: linkCheckout(pagamento.id), failure: linkCheckout(pagamento.id) },
    auto_return: "approved",
    payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 },
    ...(expiraEm ? { expires: true, expiration_date_to: new Date(expiraEm).toISOString().replace("Z", "-00:00") } : {}),
  };
  const data = await mpRequest(tenant, "post", "/checkout/preferences", body);
  return { gatewayRef: String(data.id), url: data.init_point };
}

// Consulta um pagamento no Mercado Pago (usado pelo webhook).
async function consultarPagamento(tenant, paymentId) {
  const data = await mpRequest(tenant, "get", `/v1/payments/${encodeURIComponent(paymentId)}`);
  const fee = (data.fee_details || []).reduce((acc, f) => acc + Number(f.amount || 0), 0);
  return {
    gatewayRef: String(data.id),
    status: data.status, // approved | pending | rejected | refunded | cancelled
    externalReference: data.external_reference,
    forma: data.payment_method_id === "pix" ? "PIX" : "CARTAO",
    taxa: Math.round(fee * 100),
  };
}

async function reembolsar(tenant, pagamento, valor) {
  if (valor <= 0) return { gatewayRef: null };
  const ref = String(pagamento.gatewayRef || "");
  if (modo(tenant) === "simulado" || ref.startsWith("sim_")) {
    return { gatewayRef: `sim_refund_${crypto.randomUUID()}` };
  }
  const data = await mpRequest(
    tenant,
    "post",
    `/v1/payments/${encodeURIComponent(ref)}/refunds`,
    { amount: Number((valor / 100).toFixed(2)) },
    { idempotencyKey: `refund-${pagamento.id}-${pagamento.valorReembolsado}-${valor}` }
  );
  return { gatewayRef: String(data.id) };
}

module.exports = { modo, linkCheckout, taxaEstimada, criarPix, criarCheckoutCartao, consultarPagamento, reembolsar };
