// Mercado Pago: a SMG cobrando a mensalidade do estabelecimento no cartao (conta da SMG,
// MP_PLATAFORMA_ACCESS_TOKEN). Mesmo caminho do Gestor SMG varejo, que veio de teste real:
//
// 1. Plano associado (preapproval_plan) e obrigatorio: assinatura avulsa por API e recusada
//    pelo antifraude com cc_rejected_high_risk.
// 2. O cliente assina pelo LINK do plano (init_point), na pagina do Mercado Pago. Pela API
//    com card_token o mesmo cartao foi recusado; pelo link, aprovado.
// 3. Na volta o Mercado Pago acrescenta ?preapproval_id= na URL de retorno: e assim que a
//    assinatura e amarrada a conta, sempre consultando o status na API (nunca confiando na URL).
const axios = require("axios");
const env = require("../../config/env");
const { createAppError } = require("../../lib/errors");
const { log } = require("../../lib/helpers");

// Nome proprio: o plano e reaproveitado entre assinantes e nao pode colidir com o do varejo.
const NOME_PLANO = "SMG Agendamentos - Assinatura mensal";
const urlRetorno = () => `${env.publicAppUrl}/assinar/retorno`;

async function chamar(caminho, { method = "GET", body } = {}) {
  if (!env.mpPlataformaAccessToken) throw createAppError("Pagamento no cartão indisponível no momento.", 503);
  const r = await axios({
    method,
    url: `https://api.mercadopago.com${caminho}`,
    data: body,
    timeout: 30000,
    headers: { Authorization: `Bearer ${env.mpPlataformaAccessToken}`, "Content-Type": "application/json" },
    validateStatus: () => true,
  });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.data || {} };
}

function mensagemErro(r, padrao) {
  const b = r.body || {};
  const causa = Array.isArray(b.cause) && b.cause.length ? b.cause[0]?.description : null;
  return causa || b.message || b.error || `${padrao} (HTTP ${r.status})`;
}

let planoEmCache = null;

async function garantirPlano() {
  const valor = env.planoMensalValor;
  if (planoEmCache && planoEmCache.valor === valor) return planoEmCache;

  const busca = await chamar("/preapproval_plan/search?status=active");
  if (busca.ok) {
    const existente = (busca.body?.results || []).find(
      (p) => p?.reason === NOME_PLANO && Number(p?.auto_recurring?.transaction_amount) === Number(valor)
    );
    if (existente?.id) {
      if (existente.back_url !== urlRetorno()) {
        await chamar(`/preapproval_plan/${existente.id}`, { method: "PUT", body: { back_url: urlRetorno() } });
      }
      planoEmCache = { id: existente.id, valor, initPoint: existente.init_point || "" };
      return planoEmCache;
    }
  }

  const criado = await chamar("/preapproval_plan", {
    method: "POST",
    body: {
      reason: NOME_PLANO,
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: valor, currency_id: "BRL" },
      back_url: urlRetorno(),
      payment_methods_allowed: { payment_types: [{ id: "credit_card" }], payment_methods: [] },
    },
  });
  if (!criado.ok || !criado.body?.id) throw createAppError(mensagemErro(criado, "Não foi possível preparar o plano de assinatura"), 400);
  planoEmCache = { id: criado.body.id, valor, initPoint: criado.body.init_point || "" };
  log("mp.assinatura", "plano_criado", { id: criado.body.id, valor });
  return planoEmCache;
}

async function linkAssinatura() {
  const plano = await garantirPlano();
  return plano.initPoint || `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=${plano.id}`;
}

async function statusAssinatura(preapprovalId) {
  const r = await chamar(`/preapproval/${encodeURIComponent(preapprovalId)}`);
  if (!r.ok) return null;
  return {
    id: r.body.id,
    status: r.body.status, // pending | authorized | paused | cancelled
    proximoVencimento: r.body.next_payment_date || null,
    planoId: r.body.preapproval_plan_id || null,
  };
}

const assinaturaAtiva = (status) => status === "authorized";
const assinaturaEncerrada = (status) => status === "cancelled";
const assinaturaPausada = (status) => status === "paused";

async function cancelarAssinatura(preapprovalId) {
  const r = await chamar(`/preapproval/${encodeURIComponent(preapprovalId)}`, { method: "PUT", body: { status: "cancelled" } });
  if (!r.ok) throw createAppError(mensagemErro(r, "Não foi possível cancelar a assinatura"), 400);
  return r.body.status;
}

module.exports = { garantirPlano, linkAssinatura, statusAssinatura, assinaturaAtiva, assinaturaEncerrada, assinaturaPausada, cancelarAssinatura };
