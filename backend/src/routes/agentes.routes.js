// Aba Agentes de IA: configuracao do Agente de Atendimento e do Agente de Gestao.
const express = require("express");
const prisma = require("../lib/prisma");
const env = require("../config/env");
const orchestrator = require("../agents/orchestrator");
const { MODULOS } = require("../agents/gestao/agent");
const { getAgenteConfig, conexaoConfigurada } = require("../services/whatsapp/whatsapp.service");
const { requireDono } = require("../middleware/auth");
const { badRequest, notFound, conflict } = require("../lib/errors");
const { asyncHandler, ok, requireText, textOrEmpty, toInt, toBool, requirePhone, normalizePhone } = require("../lib/helpers");

const router = express.Router();

function mascarar(config) {
  const c = { ...(config.whatsappConfig || {}) };
  for (const k of ["instanceToken", "accessToken", "webhookSecret"]) {
    if (c[k]) c[k] = `${String(c[k]).slice(0, 4)}••••`;
  }
  return c;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const config = await getAgenteConfig(tenantId);
    const numeros = await prisma.numeroAutorizado.findMany({ where: { tenantId }, orderBy: { nome: "asc" } });
    return ok(res, {
      config: { ...config, whatsappConfig: mascarar(config) },
      whatsappConectado: conexaoConfigurada(config),
      iaDisponivel: Boolean(env.openaiApiKey),
      webhook: {
        uazapi: `${env.publicApiUrl}/api/webhooks/whatsapp/${tenant.slug}/uazapi`,
        meta: `${env.publicApiUrl}/api/webhooks/whatsapp/${tenant.slug}/meta`,
      },
      numerosAutorizados: numeros,
      modulos: MODULOS,
    });
  })
);

// Sub-aba Agente de Atendimento
router.patch(
  "/atendimento",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.atendimentoAtivo !== undefined) data.atendimentoAtivo = toBool(b.atendimentoAtivo);
    if (b.personaNome !== undefined) data.personaNome = requireText(b.personaNome, "Nome da persona");
    if (b.personaTom !== undefined) data.personaTom = textOrEmpty(b.personaTom);
    if (b.personaApresentacao !== undefined) data.personaApresentacao = textOrEmpty(b.personaApresentacao);
    if (b.informacoesNegocio !== undefined) data.informacoesNegocio = String(b.informacoesNegocio || "").slice(0, 20000);
    if (b.mensagemEscalonamento !== undefined) data.mensagemEscalonamento = requireText(b.mensagemEscalonamento, "Mensagem de escalonamento");
    if (b.numeroEscalonamento !== undefined) data.numeroEscalonamento = b.numeroEscalonamento ? requirePhone(b.numeroEscalonamento) : null;
    if (b.tempoRetornoMin !== undefined) data.tempoRetornoMin = toInt(b.tempoRetornoMin, 15, { min: 1, max: 1440 });
    if (b.gestaoAtivo !== undefined) data.gestaoAtivo = toBool(b.gestaoAtivo);
    const config = await prisma.agenteConfig.update({ where: { tenantId: req.auth.tenantId }, data });
    return ok(res, { ...config, whatsappConfig: mascarar(config) });
  })
);

// Numero de WhatsApp conectado (credenciais do provedor)
router.patch(
  "/whatsapp",
  requireDono,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const atual = await getAgenteConfig(req.auth.tenantId);
    const provider = b.whatsappProvider === "meta" ? "meta" : "uazapi";
    const anterior = atual.whatsappConfig || {};
    const novo = { ...(provider === atual.whatsappProvider ? anterior : {}) };
    for (const k of ["baseUrl", "instanceToken", "webhookSecret", "accessToken", "phoneNumberId", "verifyToken", "graphBaseUrl"]) {
      // campos mascarados (com ••••) nao sobrescrevem o valor salvo
      if (b[k] !== undefined && !String(b[k]).includes("••••")) novo[k] = textOrEmpty(b[k]);
    }
    const config = await prisma.agenteConfig.update({
      where: { tenantId: req.auth.tenantId },
      data: { whatsappProvider: provider, whatsappNumero: b.whatsappNumero !== undefined ? normalizePhone(b.whatsappNumero) || null : atual.whatsappNumero, whatsappConfig: novo },
    });
    return ok(res, { ...config, whatsappConfig: mascarar(config), whatsappConectado: conexaoConfigurada(config) });
  })
);

// Sub-aba Agente de Gestao: numeros autorizados e permissoes por numero
function permissoesPayload(p = {}) {
  const limpar = (lista) => (Array.isArray(lista) ? lista.filter((m) => MODULOS.includes(m)) : []);
  return { consultar: limpar(p.consultar), alterar: limpar(p.alterar) };
}

router.post(
  "/numeros",
  requireDono,
  asyncHandler(async (req, res) => {
    const telefone = requirePhone(req.body?.telefone);
    if (await prisma.numeroAutorizado.findUnique({ where: { tenantId_telefone: { tenantId: req.auth.tenantId, telefone } } })) throw conflict("Numero ja autorizado.");
    return ok(
      res,
      await prisma.numeroAutorizado.create({
        data: { tenantId: req.auth.tenantId, telefone, nome: requireText(req.body?.nome, "Nome"), permissoes: permissoesPayload(req.body?.permissoes) },
      })
    );
  })
);

router.patch(
  "/numeros/:id",
  requireDono,
  asyncHandler(async (req, res) => {
    const n = await prisma.numeroAutorizado.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!n) throw notFound("Numero nao encontrado.");
    const data = {};
    if (req.body?.nome !== undefined) data.nome = requireText(req.body.nome, "Nome");
    if (req.body?.permissoes !== undefined) data.permissoes = permissoesPayload(req.body.permissoes);
    if (req.body?.ativo !== undefined) data.ativo = toBool(req.body.ativo);
    return ok(res, await prisma.numeroAutorizado.update({ where: { id: n.id }, data }));
  })
);

router.delete(
  "/numeros/:id",
  requireDono,
  asyncHandler(async (req, res) => {
    await prisma.numeroAutorizado.deleteMany({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    return ok(res, { removido: true });
  })
);

// Simulador: conversa com o agente sem WhatsApp (as respostas nao sao enviadas ao telefone)
router.post(
  "/simular",
  asyncHandler(async (req, res) => {
    const texto = requireText(req.body?.texto, "Mensagem");
    const telefone = requirePhone(req.body?.telefone || "5500000000000");
    const canal = req.body?.canal === "GESTAO" ? "GESTAO" : "ATENDIMENTO";
    if (canal === "GESTAO") {
      const autorizado = await prisma.numeroAutorizado.findUnique({ where: { tenantId_telefone: { tenantId: req.auth.tenantId, telefone } } });
      if (!autorizado) throw badRequest("Para simular o Agente de Gestao, use um numero autorizado.");
    }
    return ok(res, await orchestrator.simular({ tenantId: req.auth.tenantId, telefone, texto, canal }));
  })
);

router.delete(
  "/simular",
  asyncHandler(async (req, res) => {
    const telefone = requirePhone(req.query.telefone || "5500000000000");
    // apaga so o canal simulado (Gestao usa numero real autorizado: apaga apenas a conversa de Gestao)
    await prisma.conversa.deleteMany({ where: { tenantId: req.auth.tenantId, telefone, canal: req.query.canal === "GESTAO" ? "GESTAO" : "ATENDIMENTO" } });
    return ok(res, { limpo: true });
  })
);

module.exports = router;
