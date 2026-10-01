// Portal do cliente (area logada). Unico lugar onde o cliente ve o proprio historico.
const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
const disponibilidade = require("../services/disponibilidade.service");
const agendamentoService = require("../services/agendamento.service");
const { requireCliente } = require("../middleware/auth");
const { notFound, badRequest } = require("../lib/errors");
const { asyncHandler, ok, requireText, textOrEmpty, textOrNull } = require("../lib/helpers");

const router = express.Router();
router.use(requireCliente);

function resumo(a) {
  return {
    id: a.id,
    data: a.data,
    hora: a.hora,
    horaFim: a.horaFim,
    status: a.status,
    servicos: a.servicos.map((s) => ({ nome: s.nome, preco: s.preco })),
    produtos: a.produtos.map((p) => ({ nome: p.nome, quantidade: p.quantidade, precoUnit: p.precoUnit })),
    profissional: a.profissional?.nome,
    valorTotal: a.valorTotal,
    situacaoPagamento: a.situacaoPagamento,
    linkPagamento: a.linkPagamento,
    segundosRestantesReserva: a.segundosRestantesReserva,
  };
}

async function meuAgendamento(req) {
  const ag = await prisma.agendamento.findFirst({ where: { id: req.params.id, clienteId: req.cliente.id } });
  if (!ag) throw notFound("Agendamento nao encontrado.");
  return ag;
}

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const { cliente, tenant } = req;
    return ok(res, {
      cliente: { nome: cliente.nome, telefone: cliente.telefone, email: cliente.email, pontos: cliente.pontos },
      estabelecimento: { nome: tenant.nome, slug: tenant.slug, corPrimaria: tenant.siteCorPrimaria, logoUrl: tenant.siteLogoUrl, fidelidadeAtiva: tenant.fidelidadeAtiva },
    });
  })
);

router.get(
  "/agendamentos",
  asyncHandler(async (req, res) => {
    const ags = await prisma.agendamento.findMany({
      where: { clienteId: req.cliente.id, status: { in: ["AGUARDANDO_PAGAMENTO", "CONFIRMADO", "EM_ATENDIMENTO"] }, fimIntervalo: { gte: new Date() } },
      include: agendamentoService.INCLUDE_COMPLETO,
      orderBy: { inicio: "asc" },
    });
    return ok(res, ags.map((a) => resumo(agendamentoService.serializar(a, req.tenant))));
  })
);

router.get(
  "/historico",
  asyncHandler(async (req, res) => {
    const ags = await prisma.agendamento.findMany({
      where: { clienteId: req.cliente.id, status: "CONCLUIDO" },
      include: agendamentoService.INCLUDE_COMPLETO,
      orderBy: { inicio: "desc" },
    });
    return ok(res, ags.map((a) => resumo(agendamentoService.serializar(a, req.tenant))));
  })
);

router.get(
  "/pontos",
  asyncHandler(async (req, res) => {
    if (!req.tenant.fidelidadeAtiva) return ok(res, { ativo: false });
    const [movimentos, recompensas] = await Promise.all([
      prisma.movimentoPontos.findMany({ where: { clienteId: req.cliente.id }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.recompensa.findMany({ where: { tenantId: req.tenant.id, ativo: true }, include: { servico: { select: { nome: true } } }, orderBy: { pontosCusto: "asc" } }),
    ]);
    return ok(res, {
      ativo: true,
      saldo: req.cliente.pontos,
      movimentos,
      recompensas: recompensas.map((r) => ({ ...r, disponivel: req.cliente.pontos >= r.pontosCusto })),
    });
  })
);

router.patch(
  "/perfil",
  asyncHandler(async (req, res) => {
    const data = {};
    if (req.body?.nome !== undefined) data.nome = requireText(req.body.nome, "Nome");
    if (req.body?.email !== undefined) data.email = textOrNull(req.body.email);
    const c = await prisma.cliente.update({ where: { id: req.cliente.id }, data });
    return ok(res, { nome: c.nome, telefone: c.telefone, email: c.email });
  })
);

router.post(
  "/senha",
  asyncHandler(async (req, res) => {
    if (!(await bcrypt.compare(textOrEmpty(req.body?.senhaAtual), req.cliente.senhaHash || ""))) throw badRequest("Senha atual incorreta.");
    const nova = textOrEmpty(req.body?.novaSenha);
    if (nova.length < 6) throw badRequest("A nova senha deve ter pelo menos 6 caracteres.");
    await prisma.cliente.update({ where: { id: req.cliente.id }, data: { senhaHash: await bcrypt.hash(nova, 10) } });
    return ok(res, { alterada: true });
  })
);

// Antes de confirmar, mostra a regra de reembolso e o valor que sera devolvido.
router.get(
  "/agendamentos/:id/simular-cancelamento",
  asyncHandler(async (req, res) => {
    await meuAgendamento(req);
    return ok(res, await agendamentoService.simularCancelamento(req.tenant.id, req.params.id));
  })
);

router.post(
  "/agendamentos/:id/cancelar",
  asyncHandler(async (req, res) => {
    await meuAgendamento(req);
    const r = await agendamentoService.cancelar(req.tenant.id, req.params.id, { tipo: "CANCELAMENTO", motivo: "Cancelado pelo cliente no portal" });
    return ok(res, { status: r.agendamento.status, reembolso: r.reembolso });
  })
);

router.get(
  "/agendamentos/:id/simular-reagendamento",
  asyncHandler(async (req, res) => {
    await meuAgendamento(req);
    return ok(res, await agendamentoService.simularReagendamento(req.tenant.id, req.params.id, { porCliente: true }));
  })
);

router.get(
  "/agendamentos/:id/horarios",
  asyncHandler(async (req, res) => {
    const ag = await meuAgendamento(req);
    const completo = await agendamentoService.obter(req.tenant.id, ag.id);
    const servicos = await disponibilidade.resolverServicos(
      req.tenant.id,
      completo.servicos.map((s) => s.servicoId),
      { apenasAtivos: false }
    );
    const r = await disponibilidade.listarHorarios({
      tenantId: req.tenant.id,
      servicos: servicos.map((s, i) => ({ ...s, duracaoMin: completo.servicos[i].duracaoMin, intervaloMin: completo.servicos[i].intervaloMin })),
      profissionalId: req.query.profissionalId ? String(req.query.profissionalId) : ag.profissionalId,
      data: String(req.query.data || ""),
      excluirAgendamentoId: ag.id,
    });
    return ok(res, r);
  })
);

// Dias com horario livre para reagendar (mesmos servicos/profissional)
router.get(
  "/agendamentos/:id/dias",
  asyncHandler(async (req, res) => {
    const ag = await meuAgendamento(req);
    const completo = await agendamentoService.obter(req.tenant.id, ag.id);
    const dias = await disponibilidade.proximosDiasDisponiveis({
      tenantId: req.tenant.id,
      servicoIds: completo.servicos.map((s) => s.servicoId),
      profissionalId: req.query.profissionalId ? String(req.query.profissionalId) : ag.profissionalId,
      aPartirDe: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.de || "")) ? String(req.query.de) : undefined,
      dias: 31,
      maxResultados: 31,
    });
    return ok(res, dias.map((d) => d.data));
  })
);

router.post(
  "/agendamentos/:id/reagendar",
  asyncHandler(async (req, res) => {
    await meuAgendamento(req);
    const r = await agendamentoService.reagendar(req.tenant.id, req.params.id, {
      data: req.body?.data,
      hora: req.body?.hora,
      profissionalId: req.body?.profissionalId,
      porCliente: true,
      origem: "SITE",
    });
    return ok(res, { agendamento: resumo(r.agendamento), novoAgendamento: r.novoAgendamento, reembolso: r.reembolso || null });
  })
);

module.exports = router;
