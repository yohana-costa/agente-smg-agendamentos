// Asaas: a SMG cobrando a mensalidade do estabelecimento (mesma conta e mesmo fluxo do
// Gestor SMG varejo). Nao confundir com o Mercado Pago de cada loja, que recebe dos clientes dela.
//
// PIX vai por Pix Automatico: o cliente autoriza UMA vez pagando o primeiro QR e os meses
// seguintes sao debitados sozinhos pela rede Pix (paymentCreationMode SUBSCRIPTION).
const axios = require("axios");
const env = require("../../config/env");
const { createAppError } = require("../../lib/errors");
const { log } = require("../../lib/helpers");

async function chamar(caminho, { method = "GET", body } = {}) {
  if (!env.asaasApiKey) throw createAppError("Pagamento por Pix indisponível no momento (Asaas não configurado).", 503);
  const r = await axios({
    method,
    url: `${env.asaasBaseUrl}${caminho}`,
    data: body,
    timeout: 30000,
    headers: { "Content-Type": "application/json", access_token: env.asaasApiKey, "User-Agent": "SMGAgendamentos/1.0" },
    validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) {
    // O Asaas explica o problema em errors[].description ("CPF invalido" etc.)
    const desc = Array.isArray(r.data?.errors) && r.data.errors[0]?.description;
    log("asaas", "erro", { caminho, status: r.status, corpo: JSON.stringify(r.data).slice(0, 300) });
    throw createAppError(desc || "O Asaas recusou a requisição.", r.status === 401 ? 503 : 400);
  }
  return r.data;
}

async function criarCliente({ nome, email, cpfCnpj, telefone }) {
  const c = await chamar("/customers", {
    method: "POST",
    body: {
      name: nome,
      email,
      cpfCnpj: String(cpfCnpj).replace(/\D/g, ""),
      mobilePhone: String(telefone || "").replace(/\D/g, "") || undefined,
      notificationDisabled: false,
    },
  });
  return { id: c.id };
}

async function criarAutorizacaoPixAutomatico({ clienteId, valor, descricao }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const d = String(descricao).slice(0, 35);
  const a = await chamar("/pix/automatic/authorizations", {
    method: "POST",
    body: {
      customerId: clienteId,
      frequency: "MONTHLY",
      value: valor,
      paymentCreationMode: "SUBSCRIPTION",
      description: d,
      contractId: `smgag-${clienteId}-${Date.now()}`.slice(0, 35),
      startDate: hoje,
      immediateQrCode: { originalValue: valor, value: valor, expirationSeconds: 3600, description: d },
    },
  });
  return { id: a.id, status: a.status, encodedImage: a.encodedImage || null, payload: a.payload || null };
}

async function statusAutorizacaoPix(id) {
  const a = await chamar(`/pix/automatic/authorizations/${encodeURIComponent(id)}`);
  // subscriptionId: no modo SUBSCRIPTION o Asaas cria uma assinatura que gera as cobrancas mensais.
  return { id: a.id, status: a.status, subscriptionId: a.subscriptionId || null };
}

// Cancelamento pedido pelo cliente: encerra a autorizacao (o banco para de debitar) ...
async function cancelarAutorizacaoPix(id) {
  await chamar(`/pix/automatic/authorizations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ... remove a assinatura que gera as cobrancas mensais ...
async function removerAssinatura(subscriptionId) {
  await chamar(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
}

// ... e qualquer cobranca em aberto que tenha sobrado.
async function removerCobranca(paymentId) {
  await chamar(`/payments/${encodeURIComponent(paymentId)}`, { method: "DELETE" });
}

const autorizacaoPixAtiva = (status) => status === "ACTIVE";
// Autorizacao que nao volta mais: o cliente cancelou no banco ou ela expirou sem pagar.
const autorizacaoPixEncerrada = (status) => ["CANCELLED", "EXPIRED", "REFUSED", "FINISHED"].includes(String(status || "").toUpperCase());

// Cobrancas do cliente (mensalidades geradas pelo Pix Automatico), para achar atraso.
async function cobrancasDoCliente(customerId) {
  const r = await chamar(`/payments?customer=${encodeURIComponent(customerId)}&limit=50`);
  return (Array.isArray(r?.data) ? r.data : []).map((p) => ({
    id: p.id,
    status: p.status, // PENDING | RECEIVED | CONFIRMED | OVERDUE ...
    vencimento: p.dueDate || null,
    pagoEm: p.confirmedDate || p.paymentDate || p.clientPaymentDate || null,
    valor: p.value,
  }));
}

module.exports = {
  criarCliente,
  criarAutorizacaoPixAutomatico,
  statusAutorizacaoPix,
  autorizacaoPixAtiva,
  autorizacaoPixEncerrada,
  cobrancasDoCliente,
  cancelarAutorizacaoPix,
  removerAssinatura,
  removerCobranca,
};
