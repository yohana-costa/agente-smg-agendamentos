const prisma = require("../../lib/prisma");
const events = require("../../lib/events");
const gateway = require("./gateway");
const { badRequest, notFound } = require("../../lib/errors");
const { log } = require("../../lib/helpers");

// Cria cobranca online (status PENDENTE). O link aponta para o checkout SMG.
async function criarPagamentoOnline(tx, { tenantId, clienteId, agendamentoId = null, vendaId = null, valor, origem, descricao }) {
  const db = tx || prisma;
  // Sem Mercado Pago conectado nao ha como cobrar: barra aqui, dentro da transacao, para nao
  // nascer agendamento "aguardando pagamento" que ninguem consegue pagar.
  gateway.exigirConectado(await db.tenant.findUnique({ where: { id: tenantId } }));
  const pagamento = await db.pagamento.create({
    data: { tenantId, clienteId, agendamentoId, vendaId, valorBruto: valor, origem, modo: "ONLINE", status: "PENDENTE", descricao },
  });
  return db.pagamento.update({
    where: { id: pagamento.id },
    data: { linkPagamento: gateway.linkCheckout(pagamento.id) },
  });
}

// Pagamento no local (dinheiro/maquininha): ja nasce aprovado e sem taxa de gateway.
async function registrarPagamentoLocal(tx, { tenantId, clienteId = null, agendamentoId = null, vendaId = null, valor, forma, origem = "MANUAL", descricao = null }) {
  if (!["DINHEIRO", "MAQUININHA"].includes(forma)) throw badRequest("Forma de pagamento no local deve ser dinheiro ou maquininha.");
  const db = tx || prisma;
  return db.pagamento.create({
    data: {
      tenantId,
      clienteId,
      agendamentoId,
      vendaId,
      descricao,
      origem,
      modo: "LOCAL",
      forma,
      status: "APROVADO",
      valorBruto: valor,
      taxaGateway: 0,
      valorLiquido: valor,
      gateway: null,
      pagoEm: new Date(),
    },
  });
}

async function carregar(pagamentoId) {
  const pagamento = await prisma.pagamento.findUnique({
    where: { id: pagamentoId },
    include: {
      tenant: true,
      cliente: true,
      agendamento: { include: { servicos: true, produtos: true, profissional: true } },
      venda: { include: { itens: true } },
    },
  });
  if (!pagamento) throw notFound("Pagamento nao encontrado.");
  return pagamento;
}

function descricaoPagamento(p) {
  if (p.agendamento) return `${p.tenant.nome} - ${p.agendamento.servicos.map((s) => s.nome).join(" + ")}`;
  if (p.venda) return `${p.tenant.nome} - Produtos`;
  return p.descricao || p.tenant.nome;
}

function expiracao(p) {
  return p.agendamento?.expiraEm || p.venda?.expiraEm || null;
}

async function gerarPix(pagamentoId) {
  const p = await carregar(pagamentoId);
  if (p.status !== "PENDENTE") throw badRequest("Este pagamento nao esta pendente.");
  if (p.pixCopiaCola) return p;
  const r = await gateway.criarPix(p.tenant, p, { email: p.cliente?.email, descricao: descricaoPagamento(p), expiraEm: expiracao(p) });
  return prisma.pagamento.update({
    where: { id: p.id },
    data: { gateway: gateway.modo(p.tenant), gatewayRef: r.gatewayRef, pixCopiaCola: r.pixCopiaCola, pixQrCode: r.pixQrCode, forma: "PIX" },
  });
}

async function iniciarCartao(pagamentoId) {
  const p = await carregar(pagamentoId);
  if (p.status !== "PENDENTE") throw badRequest("Este pagamento nao esta pendente.");
  const r = await gateway.criarCheckoutCartao(p.tenant, p, { descricao: descricaoPagamento(p), expiraEm: expiracao(p) });
  await prisma.pagamento.update({ where: { id: p.id }, data: { gateway: gateway.modo(p.tenant) } });
  return { url: r.url };
}

// Aprovacao idempotente. Dispara a confirmacao do agendamento ou da venda.
async function aprovarPagamento(pagamentoId, { forma, taxa, gatewayRef } = {}) {
  const atual = await prisma.pagamento.findUnique({ where: { id: pagamentoId } });
  if (!atual) throw notFound("Pagamento nao encontrado.");
  if (atual.status === "APROVADO") return atual;
  if (!["PENDENTE", "EXPIRADO", "CANCELADO"].includes(atual.status)) return atual;

  const formaFinal = forma || atual.forma || "PIX";
  const taxaFinal = Number.isFinite(taxa) ? taxa : gateway.taxaEstimada(atual.valorBruto, formaFinal);
  const pagamento = await prisma.pagamento.update({
    where: { id: pagamentoId },
    data: {
      status: "APROVADO",
      forma: formaFinal,
      taxaGateway: taxaFinal,
      valorLiquido: atual.valorBruto - taxaFinal,
      pagoEm: new Date(),
      ...(gatewayRef ? { gatewayRef } : {}),
    },
  });
  log("pagamentos", "aprovado", { pagamentoId, forma: formaFinal, valor: atual.valorBruto, statusAnterior: atual.status });

  // dependencias tardias para evitar ciclo de require
  if (pagamento.agendamentoId) {
    await require("../agendamento.service").confirmarPorPagamento(pagamento.agendamentoId, pagamento);
  }
  if (pagamento.vendaId) {
    await require("../venda.service").confirmarPorPagamento(pagamento.vendaId, pagamento);
  }
  events.publish(pagamento.tenantId, "pagamento.aprovado", { pagamentoId, agendamentoId: pagamento.agendamentoId, vendaId: pagamento.vendaId });
  return pagamento;
}

async function processarWebhookMercadoPago({ tenantId, paymentId }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || !paymentId) return { ignorado: true };
  const info = await gateway.consultarPagamento(tenant, paymentId);
  if (!info.externalReference) return { ignorado: true };
  const pagamento = await prisma.pagamento.findFirst({ where: { id: info.externalReference, tenantId } });
  if (!pagamento) return { ignorado: true };
  if (info.status === "approved") {
    await aprovarPagamento(pagamento.id, { forma: info.forma, taxa: info.taxa, gatewayRef: info.gatewayRef });
  }
  return { ok: true, status: info.status };
}

// ---------- consulta de seguranca (polling) ----------
//
// A confirmacao principal e o webhook do Mercado Pago, mas aviso atrasado ou perdido nao
// pode deixar o horario expirar com o cliente tendo pago. Por isso a tela de pagamento e o
// scheduler tambem perguntam ao Mercado Pago. Mesma aprovacao idempotente do webhook.

const ultimaConsulta = new Map();
const INTERVALO_MINIMO_MS = 8000;

async function sincronizarPagamento(pagamentoId, { forcar = false } = {}) {
  const agora = Date.now();
  if (!forcar && agora - (ultimaConsulta.get(pagamentoId) || 0) < INTERVALO_MINIMO_MS) return { ignorado: true };
  ultimaConsulta.set(pagamentoId, agora);
  if (ultimaConsulta.size > 5000) ultimaConsulta.clear();

  const p = await prisma.pagamento.findUnique({ where: { id: pagamentoId }, include: { tenant: true } });
  // EXPIRADO entra de proposito: pagou depois do prazo, e o confirmarPorPagamento decide.
  if (!p || p.modo !== "ONLINE" || !["PENDENTE", "EXPIRADO"].includes(p.status)) return { ignorado: true };
  if (p.gateway !== "mercadopago" || gateway.modo(p.tenant) !== "mercadopago") return { ignorado: true };

  const info = await gateway.buscarAprovadoPorReferencia(p.tenant, p.id);
  if (!info) return { status: p.status };
  log("pagamentos", "aprovado_por_consulta", { pagamentoId: p.id, statusAnterior: p.status });
  await aprovarPagamento(p.id, { forma: info.forma, taxa: info.taxa, gatewayRef: info.gatewayRef });
  return { status: "APROVADO" };
}

// Scheduler: cobrancas online recentes ainda sem confirmacao (inclui as que expiraram ha pouco).
async function sincronizarPendentes() {
  const desde = new Date(Date.now() - 3 * 3600000);
  const lista = await prisma.pagamento.findMany({
    where: { modo: "ONLINE", gateway: "mercadopago", status: { in: ["PENDENTE", "EXPIRADO"] }, createdAt: { gt: desde } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  for (const { id } of lista) {
    try {
      await sincronizarPagamento(id, { forcar: true });
    } catch (error) {
      log("pagamentos", "consulta_falhou", { pagamentoId: id, erro: error.message });
    }
  }
  return lista.length;
}

// Cancela as cobrancas ainda nao pagas (no sistema e, no Pix, tambem no Mercado Pago).
async function cancelarCobrancasPendentes({ tenant, agendamentoId = null, vendaId = null }) {
  const pendentes = await prisma.pagamento.findMany({
    where: { tenantId: tenant.id, status: "PENDENTE", ...(agendamentoId ? { agendamentoId } : { vendaId }) },
  });
  for (const p of pendentes) {
    await gateway.cancelarCobranca(tenant, p);
    await prisma.pagamento.update({ where: { id: p.id }, data: { status: "CANCELADO" } });
  }
  return pendentes.length;
}

// Executa reembolso (automatico) de um pagamento aprovado.
async function reembolsar({ pagamento, tenant, valor, regra, percentual, agendamentoId }) {
  const disponivel = pagamento.valorBruto - pagamento.valorReembolsado;
  const valorFinal = Math.max(0, Math.min(valor, disponivel));
  if (valorFinal <= 0) return null;

  let gatewayRef = null;
  let status = "EXECUTADO";
  let erro = null;
  // Pix feito no local tambem passa pelo gateway (tem gatewayRef) e e devolvido por ele.
  if (pagamento.modo === "ONLINE" || pagamento.gatewayRef) {
    try {
      const r = await gateway.reembolsar(tenant, pagamento, valorFinal);
      gatewayRef = r.gatewayRef;
    } catch (error) {
      status = "FALHOU";
      erro = error.message;
    }
  } else {
    // pagamento no local: devolucao feita no caixa; o registro mantem o financeiro correto.
    erro = "Pagamento feito no local: devolva o valor no caixa.";
  }

  const reembolso = await prisma.reembolso.create({
    data: {
      tenantId: pagamento.tenantId,
      pagamentoId: pagamento.id,
      agendamentoId: agendamentoId || pagamento.agendamentoId,
      clienteId: pagamento.clienteId,
      regra,
      percentual,
      valor: valorFinal,
      status,
      gatewayRef,
      erro,
    },
  });
  if (status === "EXECUTADO") {
    const totalReembolsado = pagamento.valorReembolsado + valorFinal;
    await prisma.pagamento.update({
      where: { id: pagamento.id },
      data: {
        valorReembolsado: totalReembolsado,
        status: totalReembolsado >= pagamento.valorBruto ? "REEMBOLSADO" : "REEMBOLSADO_PARCIAL",
      },
    });
  }
  return reembolso;
}

module.exports = {
  criarPagamentoOnline,
  registrarPagamentoLocal,
  carregar,
  gerarPix,
  iniciarCartao,
  aprovarPagamento,
  processarWebhookMercadoPago,
  sincronizarPagamento,
  sincronizarPendentes,
  reembolsar,
  cancelarCobrancasPendentes,
};
