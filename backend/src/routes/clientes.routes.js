const express = require("express");
const prisma = require("../lib/prisma");
const metricas = require("../services/metricas.service");
const agendamentoService = require("../services/agendamento.service");
const { encontrarOuCriarCliente } = require("../services/cliente.service");
const { badRequest, notFound, forbidden } = require("../lib/errors");
const { asyncHandler, ok, textOrEmpty, textOrNull, requirePhone, toInt } = require("../lib/helpers");

const router = express.Router();

// Profissional ve apenas clientes que atendeu ou que tem agendamento com ele.
function escopo(req) {
  if (req.auth.perfil !== "PROFISSIONAL") return {};
  return { agendamentos: { some: { profissionalId: req.auth.profissionalId || "__nenhum__" } } };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth;
    const busca = textOrEmpty(req.query.busca);
    const segmento = textOrEmpty(req.query.segmento).toUpperCase();
    const digits = busca.replace(/\D/g, "");
    const where = {
      tenantId,
      mescladoEmId: null,
      ...escopo(req),
      ...(busca ? { OR: [{ nome: { contains: busca, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ telefone: { contains: digits } }] : [])] } : {}),
    };
    const clientes = await prisma.cliente.findMany({ where, orderBy: { nome: "asc" }, take: 2000 });
    const seg = await metricas.segmentosClientes(tenantId, { profissionalId: req.auth.perfil === "PROFISSIONAL" ? req.auth.profissionalId : undefined });
    let lista = clientes.map((c) => ({ ...c, senhaHash: undefined, ...(seg.porCliente[c.id] || { segmento: "ATIVO" }) }));
    if (segmento) lista = lista.filter((c) => c.segmento === segmento);
    const pagina = toInt(req.query.pagina, 1, { min: 1 });
    const porPagina = 50;
    return ok(res, {
      total: lista.length,
      pagina,
      porPagina,
      contagem: seg.contagem,
      clientes: lista.slice((pagina - 1) * porPagina, pagina * porPagina),
    });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    // Sem telefone (opcional no painel): cria so pelo nome. Com telefone, segue a regra de
    // identificacao pelo numero (o mesmo numero reaproveita o cadastro).
    if (!String(req.body?.telefone || "").replace(/\D/g, "")) {
      const nome = textOrEmpty(req.body?.nome);
      if (!nome) throw badRequest("Informe o nome do cliente.");
      const criado = await prisma.cliente.create({ data: { tenantId: req.auth.tenantId, nome, observacoes: textOrNull(req.body?.observacoes) } });
      return ok(res, { ...criado, senhaHash: undefined, jaExistia: false });
    }
    const telefone = requirePhone(req.body?.telefone);
    const existente = await prisma.cliente.findUnique({ where: { tenantId_telefone: { tenantId: req.auth.tenantId, telefone } } });
    let cliente = await encontrarOuCriarCliente(req.auth.tenantId, { telefone, nome: req.body?.nome });
    const obs = textOrNull(req.body?.observacoes);
    if (obs) {
      // cliente existente: acrescenta a observacao em vez de substituir
      const observacoes = existente?.observacoes ? `${existente.observacoes}\n${obs}` : obs;
      cliente = await prisma.cliente.update({ where: { id: cliente.id }, data: { observacoes } });
    }
    return ok(res, { ...cliente, senhaHash: undefined, jaExistia: Boolean(existente) });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const cliente = await prisma.cliente.findFirst({ where: { id: req.params.id, tenantId, ...escopo(req) } });
    if (!cliente) throw notFound("Cliente nao encontrado.");
    const agendamentos = await prisma.agendamento.findMany({
      where: { clienteId: cliente.id, ...(req.auth.perfil === "PROFISSIONAL" ? { profissionalId: req.auth.profissionalId } : {}) },
      include: agendamentoService.INCLUDE_COMPLETO,
      orderBy: { inicio: "desc" },
    });
    const concluidos = agendamentos.filter((a) => a.status === "CONCLUIDO");
    const totalGasto = concluidos.reduce((acc, a) => acc + a.valorTotal, 0);
    let frequenciaDias = null;
    if (concluidos.length >= 2) {
      const primeiro = concluidos[concluidos.length - 1].inicio;
      const ultimo = concluidos[0].inicio;
      frequenciaDias = Math.round((new Date(ultimo) - new Date(primeiro)) / 86400000 / (concluidos.length - 1));
    }
    const seg = await metricas.segmentosClientes(tenantId, { profissionalId: req.auth.perfil === "PROFISSIONAL" ? req.auth.profissionalId : undefined });
    const movimentos = tenant.fidelidadeAtiva
      ? await prisma.movimentoPontos.findMany({ where: { clienteId: cliente.id }, orderBy: { createdAt: "desc" }, take: 100 })
      : [];
    return ok(res, {
      cliente: { ...cliente, senhaHash: undefined },
      segmento: seg.porCliente[cliente.id] || null,
      indicadores: {
        totalGasto,
        visitas: concluidos.length,
        frequenciaDias,
        noShows: agendamentos.filter((a) => a.status === "NO_SHOW").length,
        cancelamentos: agendamentos.filter((a) => a.status === "CANCELADO" && !a.expirado).length,
        ultimoAtendimento: concluidos[0]?.inicio || null,
        proximoRetorno: concluidos[0]?.retornoSugerido || null,
      },
      historico: agendamentos.map((a) => agendamentoService.serializar(a, tenant)),
      fidelidade: tenant.fidelidadeAtiva ? { saldo: cliente.pontos, extrato: movimentos } : null,
    });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.auth.perfil === "PROFISSIONAL") throw forbidden("Apenas dono e recepcao podem editar cadastros.");
    const cliente = await prisma.cliente.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!cliente) throw notFound("Cliente nao encontrado.");
    const data = {};
    if (req.body.nome !== undefined) data.nome = textOrEmpty(req.body.nome) || cliente.nome;
    if (req.body.email !== undefined) data.email = textOrNull(req.body.email);
    if (req.body.observacoes !== undefined) data.observacoes = textOrNull(req.body.observacoes);
    // Telefone vazio na edicao: mantem o que ja existe (nao apaga o numero sem querer).
    if (req.body.telefone !== undefined && String(req.body.telefone || "").replace(/\D/g, "")) {
      const telefone = requirePhone(req.body.telefone);
      if (telefone !== cliente.telefone) {
        const outro = await prisma.cliente.findUnique({ where: { tenantId_telefone: { tenantId: req.auth.tenantId, telefone } } });
        if (outro) throw badRequest("Ja existe outro cliente com este telefone. Use Mesclar cadastros.");
        data.telefone = telefone;
      }
    }
    const atualizado = await prisma.cliente.update({ where: { id: cliente.id }, data });
    return ok(res, { ...atualizado, senhaHash: undefined });
  })
);

// Mesclar cadastros duplicados: o historico dos dois e unido no cadastro mantido.
router.post(
  "/mesclar",
  asyncHandler(async (req, res) => {
    if (req.auth.perfil === "PROFISSIONAL") throw forbidden();
    const { tenantId } = req.auth;
    const { manterId, removerId, telefone, nome, email, observacoes } = req.body || {};
    if (!manterId || !removerId || manterId === removerId) throw badRequest("Escolha dois cadastros diferentes.");
    const [manter, remover] = await Promise.all([
      prisma.cliente.findFirst({ where: { id: manterId, tenantId } }),
      prisma.cliente.findFirst({ where: { id: removerId, tenantId } }),
    ]);
    if (!manter || !remover) throw notFound("Cliente nao encontrado.");
    const telefoneFinal = telefone ? requirePhone(telefone) : manter.telefone;
    if (![manter.telefone, remover.telefone].includes(telefoneFinal)) throw badRequest("O telefone mantido deve ser um dos dois cadastros.");

    await prisma.$transaction(async (tx) => {
      for (const model of ["agendamento", "pagamento", "venda", "reembolso", "movimentoPontos", "conversa"]) {
        if (model === "conversa") {
          const conversas = await tx.conversa.findMany({ where: { clienteId: remover.id } });
          for (const c of conversas) await tx.conversa.update({ where: { id: c.id }, data: { clienteId: manter.id } });
          continue;
        }
        await tx[model].updateMany({ where: { clienteId: remover.id }, data: { clienteId: manter.id } });
      }
      await tx.cupom.updateMany({ where: { clienteId: remover.id }, data: { clienteId: manter.id } });
      // libera o telefone do removido (unico por estabelecimento)
      await tx.cliente.update({
        where: { id: remover.id },
        data: { telefone: `mesclado-${remover.id}`, mescladoEmId: manter.id, pontos: 0, portalAtivo: false },
      });
      await tx.cliente.update({
        where: { id: manter.id },
        data: {
          telefone: telefoneFinal,
          nome: textOrEmpty(nome) || manter.nome,
          email: email !== undefined ? textOrNull(email) : manter.email || remover.email,
          observacoes: observacoes !== undefined ? textOrNull(observacoes) : [manter.observacoes, remover.observacoes].filter(Boolean).join("\n") || null,
          pontos: manter.pontos + remover.pontos,
          senhaHash: manter.senhaHash || remover.senhaHash,
          portalAtivo: manter.portalAtivo || remover.portalAtivo,
        },
      });
    });
    return ok(res, { mantidoId: manter.id });
  })
);

module.exports = router;
