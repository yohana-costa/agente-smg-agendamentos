// Aba Atendimento: central das conversas do Agente de Atendimento no WhatsApp.
const express = require("express");
const prisma = require("../lib/prisma");
const orchestrator = require("../agents/orchestrator");
const agendamentoService = require("../services/agendamento.service");
const { notFound } = require("../lib/errors");
const { asyncHandler, ok, requireText, textOrEmpty } = require("../lib/helpers");

const router = express.Router();

function serializarConversa(c) {
  const pausada = orchestrator.pausaAtiva(c);
  return {
    id: c.id,
    canal: c.canal,
    telefone: c.telefone,
    nome: c.cliente?.nome || c.nomeContato || c.telefone,
    clienteId: c.clienteId,
    status: pausada ? c.status : "ATIVO",
    pausadoAte: pausada ? c.pausadoAte : null,
    segundosParaRetorno: pausada ? Math.max(0, Math.floor((new Date(c.pausadoAte) - Date.now()) / 1000)) : null,
    escalonamentoPendente: c.escalonamentoPendente,
    motivoEscalonamento: c.motivoEscalonamento,
    escalonadoEm: c.escalonadoEm,
    ultimaMensagemEm: c.ultimaMensagemEm,
    ultimaMensagem: c.mensagens?.[0] ? { autor: c.mensagens[0].autor, texto: c.mensagens[0].texto.slice(0, 140) } : null,
  };
}

router.get(
  "/conversas",
  asyncHandler(async (req, res) => {
    const filtro = textOrEmpty(req.query.filtro);
    const busca = textOrEmpty(req.query.busca);
    const conversas = await prisma.conversa.findMany({
      where: {
        tenantId: req.auth.tenantId,
        canal: req.query.canal === "GESTAO" ? "GESTAO" : "ATENDIMENTO",
        ...(filtro === "escalonamentos" ? { escalonamentoPendente: true } : {}),
        ...(filtro === "pausadas" ? { status: { not: "ATIVO" }, pausadoAte: { gt: new Date() } } : {}),
        ...(busca
          ? { OR: [{ telefone: { contains: busca.replace(/\D/g, "") || busca } }, { nomeContato: { contains: busca, mode: "insensitive" } }, { cliente: { nome: { contains: busca, mode: "insensitive" } } }] }
          : {}),
      },
      include: { cliente: { select: { nome: true } }, mensagens: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { ultimaMensagemEm: "desc" },
      take: 200,
    });
    return ok(res, conversas.map(serializarConversa));
  })
);

router.get(
  "/conversas/:id",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const conversa = await prisma.conversa.findFirst({
      where: { id: req.params.id, tenantId },
      include: { cliente: { select: { id: true, nome: true, telefone: true, observacoes: true } }, mensagens: { orderBy: { createdAt: "asc" }, take: 500 } },
    });
    if (!conversa) throw notFound("Conversa nao encontrada.");
    const agendamentos = conversa.clienteId
      ? await prisma.agendamento.findMany({
          where: { clienteId: conversa.clienteId, status: { in: ["AGUARDANDO_PAGAMENTO", "CONFIRMADO", "EM_ATENDIMENTO"] } },
          include: agendamentoService.INCLUDE_COMPLETO,
          orderBy: { inicio: "asc" },
        })
      : [];
    return ok(res, {
      conversa: serializarConversa({ ...conversa, mensagens: [...conversa.mensagens].reverse() }),
      cliente: conversa.cliente,
      mensagens: conversa.mensagens,
      agendamentos: agendamentos.map((a) => agendamentoService.serializar(a, tenant)),
    });
  })
);

async function carregar(req) {
  const c = await prisma.conversa.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!c) throw notFound("Conversa nao encontrada.");
  return c;
}

// Assumir conversa: pausa o agente e permite responder pelo sistema
router.post(
  "/conversas/:id/assumir",
  asyncHandler(async (req, res) => {
    const c = await carregar(req);
    const pausada = await orchestrator.pausar(c);
    return ok(res, serializarConversa(pausada));
  })
);

// Devolver ao agente: reativa na hora
router.post(
  "/conversas/:id/devolver",
  asyncHandler(async (req, res) => {
    await carregar(req);
    return ok(res, serializarConversa(await orchestrator.devolverAoAgente(req.params.id)));
  })
);

router.post(
  "/conversas/:id/mensagens",
  asyncHandler(async (req, res) => {
    await carregar(req);
    const r = await orchestrator.enviarMensagemHumano(req.params.id, requireText(req.body?.texto, "Mensagem"), req.auth.nome);
    return ok(res, r);
  })
);

router.post(
  "/conversas/:id/resolver-escalonamento",
  asyncHandler(async (req, res) => {
    await carregar(req);
    return ok(res, await prisma.conversa.update({ where: { id: req.params.id }, data: { escalonamentoPendente: false } }));
  })
);

module.exports = router;
