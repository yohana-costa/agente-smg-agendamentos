// Auto-assinatura pela landing (/assinar), no mesmo modelo do Gestor SMG varejo.
//
// A conta (estabelecimento + dono) nasce JA na hora do checkout, mas bloqueada
// (ativo=false, statusAssinatura=PENDENTE_PAGAMENTO): nao loga, o site nao aparece.
// So quando o primeiro pagamento confirma ela e liberada. Assim nao existe conta
// usando o sistema sem pagar, e a cobranca ja nasce amarrada a ela.
//
// Confirmacao NUNCA confia no que chega do navegador ou do webhook: sempre consulta o
// status no Asaas / Mercado Pago. Por isso a verificacao periodica (scheduler) basta
// sozinha, e o webhook do Asaas so adianta.
const bcrypt = require("bcryptjs");
const prisma = require("../../lib/prisma");
const env = require("../../config/env");
const asaas = require("./asaas");
const mp = require("./mp-assinatura");
const { criarEstabelecimento } = require("../tenant.service");
const { signUsuarioToken } = require("../../middleware/auth");
const { badRequest, conflict, notFound, createAppError } = require("../../lib/errors");
const { log, textOrEmpty } = require("../../lib/helpers");

const DIAS_TOLERANCIA_ATRASO = 5;

function plano() {
  return {
    valor: env.planoMensalValor,
    pix: Boolean(env.asaasApiKey),
    cartao: Boolean(env.mpPlataformaAccessToken),
  };
}

async function iniciarAssinatura(dados) {
  const metodo = dados.metodo === "CREDIT_CARD" ? "CREDIT_CARD" : dados.metodo === "PIX" ? "PIX" : null;
  if (!metodo) throw badRequest("Escolha Pix ou cartão.");
  if (!plano()[metodo === "PIX" ? "pix" : "cartao"]) throw createAppError(metodo === "PIX" ? "Pix indisponível no momento. Tente no cartão." : "Cartão indisponível no momento. Tente no Pix.", 503);
  if (!textOrEmpty(dados.nomeEstabelecimento)) throw badRequest("Informe o nome do estabelecimento.");
  if (!textOrEmpty(dados.nome)) throw badRequest("Informe seu nome.");
  const email = textOrEmpty(dados.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Informe um e-mail válido.");
  if (textOrEmpty(dados.senha).length < 6) throw badRequest("A senha deve ter pelo menos 6 caracteres.");
  if (String(dados.telefone || "").replace(/\D/g, "").length < 10) throw badRequest("Informe um WhatsApp com DDD.");
  const cpfCnpj = String(dados.cpfCnpj || "").replace(/\D/g, "");
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) throw badRequest("Informe um CPF ou CNPJ válido.");
  if (await prisma.usuario.findUnique({ where: { email } })) throw conflict("Este e-mail já tem conta. Faça login.");

  // 1) Cobranca no gateway primeiro: se falhar aqui, nada foi criado no nosso banco.
  let pix = null;
  let asaasCustomerId = null;
  let asaasAuthorizationId = null;
  let linkPagamento = null;
  if (metodo === "PIX") {
    const cliente = await asaas.criarCliente({ nome: dados.nome || dados.nomeEstabelecimento, email, cpfCnpj, telefone: dados.telefone });
    asaasCustomerId = cliente.id;
    const auth = await asaas.criarAutorizacaoPixAutomatico({
      clienteId: cliente.id,
      valor: env.planoMensalValor,
      descricao: `SMG Agendamentos ${dados.nomeEstabelecimento || ""}`,
    });
    asaasAuthorizationId = auth.id;
    pix = { imagem: auth.encodedImage, copiaCola: auth.payload };
  } else {
    linkPagamento = await mp.linkAssinatura();
  }

  // 2) Conta local, bloqueada ate o pagamento confirmar.
  const tenant = await criarEstabelecimento({ ...dados, email, documento: cpfCnpj, pendentePagamento: true });
  const assinatura = await prisma.assinaturaPlataforma.create({
    data: {
      tenantId: tenant.id,
      metodo,
      valor: env.planoMensalValor,
      asaasCustomerId,
      asaasAuthorizationId,
      pixQrCode: pix?.imagem || null,
      pixCopiaCola: pix?.copiaCola || null,
    },
  });
  log("assinatura", "iniciada", { tenantId: tenant.id, metodo });
  return { referencia: assinatura.id, metodo, pix, linkPagamento };
}

async function acharAssinatura(referencia) {
  const ref = String(referencia || "");
  if (!ref) return null;
  return prisma.assinaturaPlataforma.findFirst({
    where: { OR: [{ id: ref }, { asaasAuthorizationId: ref }, { mercadoPagoPreapprovalId: ref }] },
    include: { tenant: true },
  });
}

async function liberar(assinatura, extras = {}) {
  await prisma.assinaturaPlataforma.update({
    where: { id: assinatura.id },
    data: { status: "ATIVA", confirmadaEm: assinatura.confirmadaEm || new Date(), verificadaEm: new Date(), ...extras },
  });
  if (!assinatura.tenant.ativo || assinatura.tenant.statusAssinatura !== "ATIVO") {
    await prisma.tenant.update({ where: { id: assinatura.tenantId }, data: { ativo: true, statusAssinatura: "ATIVO" } });
    log("assinatura", "conta_liberada", { tenantId: assinatura.tenantId });
  }
}

// Mensalidade atrasada ou cartao recusado: bloqueia o acesso, mas a assinatura continua
// (o gateway ainda tenta cobrar). Paga a pendencia, a verificacao libera de novo.
async function bloquearPorPagamento(assinatura, motivo) {
  await prisma.assinaturaPlataforma.update({ where: { id: assinatura.id }, data: { verificadaEm: new Date() } });
  if (assinatura.tenant.statusAssinatura !== "PENDENTE_PAGAMENTO") {
    await prisma.tenant.update({ where: { id: assinatura.tenantId }, data: { ativo: false, statusAssinatura: "PENDENTE_PAGAMENTO" } });
    log("assinatura", "conta_bloqueada_pagamento", { tenantId: assinatura.tenantId, motivo });
  }
}

async function encerrar(assinatura, motivo) {
  await prisma.assinaturaPlataforma.update({ where: { id: assinatura.id }, data: { status: "CANCELADA", verificadaEm: new Date() } });
  if (assinatura.tenant.statusAssinatura !== "SUSPENSO") {
    await prisma.tenant.update({ where: { id: assinatura.tenantId }, data: { ativo: false, statusAssinatura: "SUSPENSO" } });
    log("assinatura", "conta_suspensa", { tenantId: assinatura.tenantId, motivo });
  }
}

/**
 * Consulta o gateway e acerta a conta. Idempotente: polling da tela, webhook e
 * scheduler podem chamar ao mesmo tempo sem problema.
 */
async function verificar(assinatura) {
  if (assinatura.metodo === "PIX" && assinatura.asaasAuthorizationId) {
    const auth = await asaas.statusAutorizacaoPix(assinatura.asaasAuthorizationId);
    if (asaas.autorizacaoPixEncerrada(auth.status)) {
      if (assinatura.status === "ATIVA") return encerrar(assinatura, `pix_automatico_${auth.status}`);
      return prisma.assinaturaPlataforma.update({ where: { id: assinatura.id }, data: { verificadaEm: new Date() } });
    }
    if (!asaas.autorizacaoPixAtiva(auth.status)) return null; // ainda nao pagou o primeiro QR
    // Ativa: confere se ha mensalidade atrasada alem da tolerancia.
    const cobrancas = assinatura.asaasCustomerId ? await asaas.cobrancasDoCliente(assinatura.asaasCustomerId).catch(() => []) : [];
    const limite = Date.now() - DIAS_TOLERANCIA_ATRASO * 86400000;
    const atrasada = cobrancas.find((c) => c.status === "OVERDUE" && c.vencimento && new Date(`${c.vencimento}T23:59:59-03:00`).getTime() < limite);
    if (atrasada) return bloquearPorPagamento(assinatura, `mensalidade_atrasada_${atrasada.vencimento}`);
    const proxima = cobrancas.filter((c) => c.status === "PENDING" && c.vencimento).sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
    return liberar(assinatura, proxima ? { proximoVencimento: new Date(`${proxima.vencimento}T12:00:00-03:00`) } : {});
  }

  if (assinatura.metodo === "CREDIT_CARD" && assinatura.mercadoPagoPreapprovalId) {
    const st = await mp.statusAssinatura(assinatura.mercadoPagoPreapprovalId);
    if (!st) return null;
    const extras = st.proximoVencimento ? { proximoVencimento: new Date(st.proximoVencimento) } : {};
    if (mp.assinaturaAtiva(st.status)) return liberar(assinatura, extras);
    if (mp.assinaturaEncerrada(st.status)) return encerrar(assinatura, "mercado_pago_cancelled");
    if (mp.assinaturaPausada(st.status) && assinatura.status === "ATIVA") return bloquearPorPagamento(assinatura, "mercado_pago_paused");
  }
  return null;
}

/** Volta do Mercado Pago: amarra o preapproval_id a conta pendente (consultando a API). */
async function vincularPreapproval(referencia, preapprovalId) {
  const id = textOrEmpty(preapprovalId);
  if (!id) throw badRequest("Assinatura do Mercado Pago não informada.");
  const assinatura = await acharAssinatura(referencia);
  if (!assinatura || assinatura.metodo !== "CREDIT_CARD") throw notFound("Assinatura não encontrada.");

  const outra = await prisma.assinaturaPlataforma.findFirst({ where: { mercadoPagoPreapprovalId: id, NOT: { id: assinatura.id } }, select: { id: true } });
  if (outra) throw conflict("Esta assinatura já está vinculada a outra conta.");

  const st = await mp.statusAssinatura(id);
  if (!st) throw notFound("Assinatura não encontrada no Mercado Pago.");
  // So vale assinatura do NOSSO plano: senao um preapproval de outro plano (mais barato,
  // ou do varejo) liberaria a conta.
  const nosso = await mp.garantirPlano();
  if (st.planoId !== nosso.id) throw badRequest("Esta assinatura não é do plano SMG Agendamentos.");

  const atualizada = await prisma.assinaturaPlataforma.update({ where: { id: assinatura.id }, data: { mercadoPagoPreapprovalId: id }, include: { tenant: true } });
  await verificar(atualizada);
  return statusCheckout(assinatura.id);
}

/** Polling da tela do checkout. Liberada a conta, devolve o token para entrar direto. */
async function statusCheckout(referencia) {
  let assinatura = await acharAssinatura(referencia);
  if (!assinatura) throw notFound("Assinatura não encontrada.");
  if (assinatura.status !== "ATIVA") {
    await verificar(assinatura).catch((e) => log("assinatura", "verificar_falhou", { id: assinatura.id, erro: e.message }));
    assinatura = await acharAssinatura(assinatura.id);
  }
  const liberado = assinatura.tenant.ativo && assinatura.tenant.statusAssinatura === "ATIVO";
  let token = null;
  // Entrada automatica so logo apos a primeira confirmacao: a referencia nao vira uma
  // credencial permanente. Depois disso, login normal.
  const recente = assinatura.confirmadaEm && Date.now() - new Date(assinatura.confirmadaEm).getTime() < 2 * 3600000;
  if (liberado && recente) {
    const dono = await prisma.usuario.findFirst({ where: { tenantId: assinatura.tenantId, perfil: "DONO", ativo: true } });
    if (dono) token = signUsuarioToken(dono);
  }
  return {
    liberado,
    token,
    metodo: assinatura.metodo,
    pix: assinatura.metodo === "PIX" ? { imagem: assinatura.pixQrCode, copiaCola: assinatura.pixCopiaCola } : null,
  };
}

/**
 * Conta que ficou pendente (fechou a tela sem pagar, ou mensalidade atrasada): com e-mail e
 * senha corretos, devolve como pagar de novo. Pix: o mesmo QR enquanto valer; senao um novo.
 * Cartao: o link do plano de novo.
 */
async function retomar({ email, senha }) {
  const usuario = await prisma.usuario.findUnique({ where: { email: textOrEmpty(email).toLowerCase() }, include: { tenant: { include: { assinatura: true } } } });
  if (!usuario || !(await bcrypt.compare(textOrEmpty(senha), usuario.senhaHash))) throw createAppError("E-mail ou senha inválidos.", 401);
  const a = usuario.tenant.assinatura;
  if (!a) throw notFound("Este estabelecimento não tem assinatura pela landing. Fale com o suporte da SMG.");
  if (usuario.tenant.ativo) return { referencia: a.id, liberado: true };

  if (a.metodo === "PIX") {
    let auth = a.asaasAuthorizationId ? await asaas.statusAutorizacaoPix(a.asaasAuthorizationId).catch(() => null) : null;
    if (!auth || asaas.autorizacaoPixEncerrada(auth.status)) {
      // QR antigo expirou (vale 1 hora): gera outra autorizacao para a mesma conta.
      const nova = await asaas.criarAutorizacaoPixAutomatico({ clienteId: a.asaasCustomerId, valor: a.valor, descricao: `SMG Agendamentos ${usuario.tenant.nome}` });
      await prisma.assinaturaPlataforma.update({
        where: { id: a.id },
        data: { asaasAuthorizationId: nova.id, pixQrCode: nova.encodedImage, pixCopiaCola: nova.payload, status: "PENDENTE" },
      });
      return { referencia: a.id, metodo: "PIX", pix: { imagem: nova.encodedImage, copiaCola: nova.payload } };
    }
    return { referencia: a.id, metodo: "PIX", pix: { imagem: a.pixQrCode, copiaCola: a.pixCopiaCola } };
  }
  return { referencia: a.id, metodo: "CREDIT_CARD", linkPagamento: await mp.linkAssinatura() };
}

/** Scheduler: pendentes a cada passada; ativas no maximo a cada 6 horas. */
async function verificarTodas() {
  const seisHoras = new Date(Date.now() - 6 * 3600000);
  const lista = await prisma.assinaturaPlataforma.findMany({
    where: {
      OR: [
        { status: "PENDENTE", createdAt: { gt: new Date(Date.now() - 30 * 86400000) } },
        { status: "ATIVA", OR: [{ verificadaEm: null }, { verificadaEm: { lt: seisHoras } }] },
      ],
    },
    include: { tenant: true },
    take: 50,
  });
  for (const a of lista) {
    try {
      await verificar(a);
      if (a.status === "ATIVA") await prisma.assinaturaPlataforma.update({ where: { id: a.id }, data: { verificadaEm: new Date() } });
    } catch (e) {
      log("assinatura", "verificar_erro", { id: a.id, erro: e.message });
    }
  }
  return lista.length;
}

/** Webhook do Asaas: so indica QUAL assinatura olhar; o status vem da API. */
async function processarWebhookAsaas(evento) {
  const customer = evento?.payment?.customer || evento?.pixAutomaticAuthorization?.customerId || null;
  const authId = evento?.pixAutomaticAuthorization?.id || null;
  const a = await prisma.assinaturaPlataforma.findFirst({
    where: { OR: [...(authId ? [{ asaasAuthorizationId: authId }] : []), ...(customer ? [{ asaasCustomerId: customer }] : [])] },
    include: { tenant: true },
  });
  if (!a) return { ignorado: true };
  await verificar(a);
  return { ok: true };
}

module.exports = { plano, iniciarAssinatura, vincularPreapproval, statusCheckout, retomar, verificarTodas, processarWebhookAsaas };
