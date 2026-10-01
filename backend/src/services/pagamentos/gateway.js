// Gateway SMG -> Mercado Pago.
// O link enviado ao cliente aponta sempre para o checkout proprio da SMG (/pagamento/:id),
// que gera o Pix (QR code) ou redireciona para o checkout de cartao do Mercado Pago.
// Cada estabelecimento usa o token da PROPRIA conta, obtido pelo botao "Conectar" (OAuth).
// Sem conta conectada: em producao o pagamento online fica indisponivel ("desconectado");
// fora de producao vira "simulado" (checkout com botao de teste) para desenvolvimento.
const axios = require("axios");
const crypto = require("crypto");
const env = require("../../config/env");
const oauth = require("./mercadopago-oauth.service");
const { createAppError } = require("../../lib/errors");
const { log } = require("../../lib/helpers");

const MP_BASE = "https://api.mercadopago.com";

// Token global do .env so fora de producao: em producao ele mandaria o dinheiro de todos os
// estabelecimentos para uma unica conta.
function tokenGlobal() {
  return env.nodeEnv === "production" ? "" : env.mpAccessToken;
}

function accessTokenFor(tenant) {
  return (tenant?.mpAccessToken || tokenGlobal() || "").trim();
}

function modo(tenant) {
  if (accessTokenFor(tenant)) return "mercadopago";
  return env.pagamentoSimuladoPermitido ? "simulado" : "desconectado";
}

function exigirConectado(tenant) {
  if (modo(tenant) === "desconectado") {
    throw createAppError("Pagamento online indisponível: o estabelecimento ainda não conectou o Mercado Pago.", 400);
  }
}

async function tokenParaChamada(tenant) {
  if (tenant?.mpAccessToken) return oauth.tokenValido(tenant);
  return tokenGlobal();
}

/**
 * Comissao da SMG (mesma regra do Gestor SMG varejo).
 * Vai para o dono da APLICACAO que emitiu o token OAuth; token de outra aplicacao (colado na mao
 * ou de app antigo) nao e cobrado, para nao mandar a comissao para a conta errada.
 */
function comissaoPlataforma(token, valorReais) {
  const pct = env.mpTaxaPlataformaPct;
  if (!pct || pct <= 0 || !env.mpClientId) return undefined;
  const appDoToken = String(token || "").split("-")[1] || "";
  if (appDoToken !== env.mpClientId) return undefined;
  const v = Math.round(valorReais * (pct / 100) * 100) / 100;
  return v > 0 ? v : undefined;
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

async function mpRequest(tenant, method, path, data, { idempotencyKey, token: tokenPronto } = {}) {
  const token = tokenPronto || (await tokenParaChamada(tenant));
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
  exigirConectado(tenant);
  if (modo(tenant) === "simulado") {
    const fake = `00020126SIMULADO-SMG-${pagamento.id}-${pagamento.valorBruto}5204000053039865802BR6304`;
    return { gatewayRef: `sim_pix_${pagamento.id}`, pixCopiaCola: fake, pixQrCode: null };
  }
  const token = await tokenParaChamada(tenant);
  const valorReais = Number((pagamento.valorBruto / 100).toFixed(2));
  // O Mercado Pago recusa Pix com menos de 30 min de validade. A reserva do horario continua
  // sendo de 15 min no sistema; pagamento que chega depois e tratado em confirmarPorPagamento.
  const minimo = Date.now() + env.mpPixValidadeMinutos * 60000;
  const validade = new Date(Math.max(expiraEm ? new Date(expiraEm).getTime() : 0, minimo));
  const comissao = comissaoPlataforma(token, valorReais);
  const body = {
    transaction_amount: valorReais,
    description: descricao || "Agendamento",
    payment_method_id: "pix",
    external_reference: pagamento.id,
    notification_url: notificationUrl(tenant.id),
    payer: { email: email || tenant.email || "cliente@smgcompany.com.br" },
    date_of_expiration: validade.toISOString().replace("Z", "-00:00"),
    ...(comissao ? { application_fee: comissao } : {}),
  };
  const data = await mpRequest(tenant, "post", "/v1/payments", body, { token, idempotencyKey: `pix-${pagamento.id}-${pagamento.valorBruto}` });
  const tx = data?.point_of_interaction?.transaction_data || {};
  return { gatewayRef: String(data.id), pixCopiaCola: tx.qr_code || null, pixQrCode: tx.qr_code_base64 || null };
}

// Cartao: preferencia do Checkout Pro (o cliente paga na pagina do Mercado Pago).
async function criarCheckoutCartao(tenant, pagamento, { descricao, expiraEm }) {
  exigirConectado(tenant);
  if (modo(tenant) === "simulado") {
    return { gatewayRef: `sim_pref_${pagamento.id}`, url: `${linkCheckout(pagamento.id)}?simular=cartao` };
  }
  const token = await tokenParaChamada(tenant);
  const valorReais = Number((pagamento.valorBruto / 100).toFixed(2));
  const comissao = comissaoPlataforma(token, valorReais);
  const body = {
    items: [{ title: descricao || "Agendamento", quantity: 1, currency_id: "BRL", unit_price: valorReais }],
    // Checkout Pro: a comissao do marketplace vai na preferencia.
    ...(comissao ? { marketplace_fee: comissao } : {}),
    external_reference: pagamento.id,
    notification_url: notificationUrl(tenant.id),
    back_urls: { success: linkCheckout(pagamento.id), pending: linkCheckout(pagamento.id), failure: linkCheckout(pagamento.id) },
    auto_return: "approved",
    payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 },
    ...(expiraEm ? { expires: true, expiration_date_to: new Date(expiraEm).toISOString().replace("Z", "-00:00") } : {}),
  };
  const data = await mpRequest(tenant, "post", "/checkout/preferences", body, { token });
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

// Cancela no Mercado Pago um Pix ainda nao pago, para o cliente nao conseguir pagar um
// agendamento que ja foi cancelado. Melhor esforco: se falhar, confirmarPorPagamento devolve.
async function cancelarCobranca(tenant, pagamento) {
  const ref = String(pagamento.gatewayRef || "");
  if (!ref || ref.startsWith("sim_") || modo(tenant) !== "mercadopago" || pagamento.forma !== "PIX") return false;
  try {
    await mpRequest(tenant, "put", `/v1/payments/${encodeURIComponent(ref)}`, { status: "cancelled" });
    return true;
  } catch (error) {
    log("gateway.mp", "cancelar_cobranca_falhou", { pagamentoId: pagamento.id, erro: error.message });
    return false;
  }
}

module.exports = { modo, exigirConectado, linkCheckout, taxaEstimada, criarPix, criarCheckoutCartao, consultarPagamento, reembolsar, cancelarCobranca };
