const express = require("express");
const prisma = require("../lib/prisma");
const disponibilidade = require("../services/disponibilidade.service");
const agendamentoService = require("../services/agendamento.service");
const bloqueioService = require("../services/bloqueio.service");
const { forbidden, badRequest } = require("../lib/errors");
const { asyncHandler, ok, toBool, textOrNull } = require("../lib/helpers");
const { isDateStr, daysBetween, dayRangeUtc, rangeUtc, weekdayOf, zonedToUtc, monthRange, zonedParts, todayStr } = require("../lib/time");

const router = express.Router();

// ---------- escopo por perfil ----------

function profissionaisVisiveis(req, solicitados) {
  const { perfil, profissionalId, permissoes } = req.auth;
  if (perfil === "PROFISSIONAL" && !permissoes.verAgendaColegas) return [profissionalId || "__nenhum__"];
  return solicitados;
}

function assertPodeEditar(req, profissionalId) {
  if (req.auth.perfil === "PROFISSIONAL" && req.auth.profissionalId !== profissionalId) {
    throw forbidden("Voce so pode alterar a sua propria agenda.");
  }
}

async function carregarParaEditar(req, id) {
  const ag = await prisma.agendamento.findFirst({ where: { id, tenantId: req.auth.tenantId }, select: { profissionalId: true } });
  if (!ag) throw badRequest("Agendamento nao encontrado.");
  assertPodeEditar(req, ag.profissionalId);
  return ag;
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---------- visualizacoes ----------

// Dia / Semana / Lista: tudo o que ocupa a capacidade no intervalo.
router.get(
  "/visao",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const tz = tenant.timezone;
    const de = isDateStr(req.query.de) ? req.query.de : todayStr(tz);
    const ate = isDateStr(req.query.ate) ? req.query.ate : de;
    const dias = daysBetween(de, ate);
    if (dias.length > 42) throw badRequest("Intervalo maximo de 42 dias.");

    let profissionalIds = profissionaisVisiveis(req, csv(req.query.profissionalIds));
    const profissionais = await prisma.profissional.findMany({
      where: { tenantId, ativo: true, ...(profissionalIds.length ? { id: { in: profissionalIds } } : {}) },
      select: { id: true, nome: true, cor: true },
      orderBy: { nome: "asc" },
    });
    profissionalIds = profissionais.map((p) => p.id);

    const { start, end } = rangeUtc(de, ate, tz);
    const status = csv(req.query.status);
    const mostrarCancelados = toBool(req.query.mostrarCancelados);
    const statusFiltro = status.length ? status : mostrarCancelados ? undefined : { notIn: ["CANCELADO"] };

    const [agendamentos, bloqueios, eventos, diasFechados, horarios] = await Promise.all([
      prisma.agendamento.findMany({
        where: {
          tenantId,
          profissionalId: { in: profissionalIds },
          inicio: { lt: end },
          fimIntervalo: { gt: start },
          ...(statusFiltro ? { status: Array.isArray(statusFiltro) ? { in: statusFiltro } : statusFiltro } : {}),
          ...(req.query.servicoId ? { servicos: { some: { servicoId: String(req.query.servicoId) } } } : {}),
        },
        include: agendamentoService.INCLUDE_COMPLETO,
        orderBy: { inicio: "asc" },
      }),
      bloqueioService.listarOcorrencias(tenantId, de, ate, profissionalIds),
      prisma.eventoExterno.findMany({ where: { profissionalId: { in: profissionalIds }, inicio: { lt: end }, fim: { gt: start } } }),
      prisma.diaFechado.findMany({ where: { tenantId, data: { gte: de, lte: ate } } }),
      prisma.horarioFuncionamento.findMany({ where: { tenantId } }),
    ]);

    const estrutura = [];
    for (const data of dias) {
      const horario = horarios.find((h) => h.diaSemana === weekdayOf(data));
      const fechado = diasFechados.find((d) => d.data === data);
      estrutura.push({
        data,
        fechadoRotina: !horario || !horario.aberto,
        fechadoForaRotina: fechado ? { id: fechado.id, motivo: fechado.motivo } : null,
        funcionamento: horario?.aberto ? { inicio: horario.inicio, fim: horario.fim } : null,
        profissionais: await disponibilidade.estruturaDia(tenantId, data, profissionalIds),
      });
    }

    const meuId = req.auth.profissionalId;
    return ok(res, {
      de,
      ate,
      profissionais: profissionais.map((p) => ({ ...p, somenteLeitura: req.auth.perfil === "PROFISSIONAL" && p.id !== meuId })),
      dias: estrutura,
      agendamentos: agendamentos.map((a) => agendamentoService.serializar(a, tenant)),
      bloqueios: [
        ...bloqueios.map((b) => ({
          id: b.id,
          profissionalId: b.profissionalId,
          inicio: b.ocorrenciaInicio,
          fim: b.ocorrenciaFim,
          motivo: b.motivo,
          semanal: b.semanal,
          ausencia: false,
        })),
        // folgas/ausencias programadas (gerenciadas na aba Equipe) aparecem como bloqueio cinza
        ...(
          await prisma.ausencia.findMany({ where: { profissionalId: { in: profissionalIds }, inicio: { lt: end }, fim: { gt: start } } })
        ).map((a) => ({ id: a.id, profissionalId: a.profissionalId, inicio: a.inicio, fim: a.fim, motivo: `Ausência${a.motivo ? `: ${a.motivo}` : ""}`, semanal: false, ausencia: true })),
      ],
      // o proprio profissional ve o titulo; os demais perfis veem apenas "Ocupado"
      eventos: eventos.map((e) => ({ id: e.id, profissionalId: e.profissionalId, inicio: e.inicio, fim: e.fim, titulo: e.profissionalId === meuId ? e.titulo || "Ocupado" : "Ocupado" })),
    });
  })
);

// Mes: quantidade de atendimentos por dia e dias fechados.
router.get(
  "/mes",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const tz = tenant.timezone;
    const ref = /^\d{4}-\d{2}$/.test(String(req.query.mes || "")) ? `${req.query.mes}-01` : todayStr(tz);
    const { from, to } = monthRange(ref);
    const { start, end } = rangeUtc(from, to, tz);
    const profIds = profissionaisVisiveis(req, csv(req.query.profissionalIds));
    const [ags, fechados, horarios] = await Promise.all([
      prisma.agendamento.findMany({
        where: { tenantId, inicio: { gte: start, lt: end }, status: { notIn: ["CANCELADO"] }, ...(profIds.length ? { profissionalId: { in: profIds } } : {}) },
        select: { inicio: true, status: true },
      }),
      prisma.diaFechado.findMany({ where: { tenantId, data: { gte: from, lte: to } } }),
      prisma.horarioFuncionamento.findMany({ where: { tenantId } }),
    ]);
    const dias = daysBetween(from, to).map((data) => {
      const h = horarios.find((x) => x.diaSemana === weekdayOf(data));
      const f = fechados.find((x) => x.data === data);
      const doDia = ags.filter((a) => zonedParts(a.inicio, tz).date === data);
      return {
        data,
        atendimentos: doDia.length,
        aguardandoPagamento: doDia.filter((a) => a.status === "AGUARDANDO_PAGAMENTO").length,
        fechadoRotina: !h || !h.aberto,
        fechadoForaRotina: f ? { id: f.id, motivo: f.motivo } : null,
      };
    });
    return ok(res, { mes: from.slice(0, 7), dias });
  })
);

// Horarios livres (tela de novo agendamento / reagendar).
router.get(
  "/horarios",
  asyncHandler(async (req, res) => {
    // reagendamento: usa as duracoes gravadas no agendamento (aceita servico hoje inativo)
    let servicos;
    if (req.query.excluirAgendamentoId) {
      const ag = await agendamentoService.obter(req.auth.tenantId, String(req.query.excluirAgendamentoId));
      const cad = await disponibilidade.resolverServicos(req.auth.tenantId, ag.servicos.map((s) => s.servicoId), { apenasAtivos: false });
      servicos = cad.map((s, i) => ({ ...s, duracaoMin: ag.servicos[i].duracaoMin, intervaloMin: ag.servicos[i].intervaloMin }));
    }
    const r = await disponibilidade.listarHorarios({
      tenantId: req.auth.tenantId,
      servicos,
      servicoIds: csv(req.query.servicoIds),
      profissionalId: req.query.profissionalId ? String(req.query.profissionalId) : undefined,
      data: String(req.query.data || ""),
      excluirAgendamentoId: req.query.excluirAgendamentoId ? String(req.query.excluirAgendamentoId) : undefined,
    });
    return ok(res, r);
  })
);

// Conflitos de um horario especifico (para avisar antes de um encaixe).
router.post(
  "/conflitos",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const { profissionalId, servicoIds, data, hora, agendamentoId } = req.body || {};
    let itens;
    if (agendamentoId) {
      const ag = await agendamentoService.obter(tenantId, agendamentoId);
      itens = ag.servicos;
    } else {
      itens = await disponibilidade.resolverServicos(tenantId, servicoIds);
    }
    const inicio = zonedToUtc(data, hora, tenant.timezone);
    const h = disponibilidade.calcularHorarios(inicio, itens);
    const conflitos = await disponibilidade.verificarConflitos({ tenantId, profissionalId, inicio, fimIntervalo: h.fimIntervalo, excluirAgendamentoId: agendamentoId });
    return ok(res, { conflitos, duracao: { atendimento: h.duracaoAtendimento, total: h.ocupacaoTotal } });
  })
);

// ---------- agendamentos ----------

router.get(
  "/agendamentos",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const tz = tenant.timezone;
    const de = isDateStr(req.query.de) ? req.query.de : todayStr(tz);
    const ate = isDateStr(req.query.ate) ? req.query.ate : de;
    const { start, end } = rangeUtc(de, ate, tz);
    const profIds = profissionaisVisiveis(req, csv(req.query.profissionalIds));
    const status = csv(req.query.status);
    const pendentes = toBool(req.query.pendentesFinalizacao);
    const ags = await prisma.agendamento.findMany({
      where: {
        tenantId,
        inicio: { gte: start, lt: end },
        ...(profIds.length ? { profissionalId: { in: profIds } } : {}),
        ...(status.length ? { status: { in: status } } : toBool(req.query.mostrarCancelados) ? {} : { status: { not: "CANCELADO" } }),
        ...(req.query.servicoId ? { servicos: { some: { servicoId: String(req.query.servicoId) } } } : {}),
      },
      include: agendamentoService.INCLUDE_COMPLETO,
      orderBy: { inicio: "asc" },
      take: 1000,
    });
    let lista = ags.map((a) => agendamentoService.serializar(a, tenant));
    if (pendentes) lista = lista.filter((a) => a.pendenteFinalizacao);
    return ok(res, lista);
  })
);

router.post(
  "/agendamentos",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    assertPodeEditar(req, body.profissionalId);
    const ag = await agendamentoService.criar({
      tenantId: req.auth.tenantId,
      origem: "MANUAL",
      clienteId: body.clienteId,
      cliente: body.cliente,
      servicoIds: body.servicoIds,
      profissionalId: body.profissionalId,
      data: body.data,
      hora: body.hora,
      inicio: body.inicio,
      produtos: body.produtos || [],
      pagamento: body.pagamento,
      observacoes: body.observacoes,
      encaixe: toBool(body.encaixe),
      usarPacote: toBool(body.usarPacote),
      cupomCodigo: textOrNull(body.cupom),
      recompensaId: textOrNull(body.recompensaId),
    });
    return ok(res, ag);
  })
);

router.get(
  "/agendamentos/:id",
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth;
    const ag = await agendamentoService.obterSerializado(tenantId, req.params.id);
    if (req.auth.perfil === "PROFISSIONAL" && ag.profissionalId !== req.auth.profissionalId && !req.auth.permissoes.verAgendaColegas) {
      throw forbidden();
    }
    const [visitas, noShows, ultimo] = await Promise.all([
      prisma.agendamento.count({ where: { clienteId: ag.clienteId, status: "CONCLUIDO" } }),
      prisma.agendamento.count({ where: { clienteId: ag.clienteId, status: "NO_SHOW" } }),
      prisma.agendamento.findFirst({
        where: { clienteId: ag.clienteId, status: "CONCLUIDO", id: { not: ag.id } },
        orderBy: { inicio: "desc" },
        include: { servicos: true },
      }),
    ]);
    return ok(res, {
      ...ag,
      clienteResumo: {
        totalVisitas: visitas,
        noShows,
        observacoes: ag.cliente.observacoes,
        ultimoAtendimento: ultimo ? { data: ultimo.inicio, servicos: ultimo.servicos.map((s) => s.nome).join(" + ") } : null,
      },
    });
  })
);

const acao = (fn) =>
  asyncHandler(async (req, res) => {
    await carregarParaEditar(req, req.params.id);
    return ok(res, await fn(req));
  });

router.post("/agendamentos/:id/iniciar", acao((req) => agendamentoService.iniciar(req.auth.tenantId, req.params.id)));
router.get("/agendamentos/:id/finalizacao", acao((req) => agendamentoService.previaFinalizacao(req.auth.tenantId, req.params.id)));
router.post("/agendamentos/:id/finalizar", acao((req) => agendamentoService.finalizar(req.auth.tenantId, req.params.id, req.body || {})));
router.post("/agendamentos/:id/produtos", acao((req) => agendamentoService.adicionarProduto(req.auth.tenantId, req.params.id, req.body || {})));
router.get(
  "/agendamentos/:id/simular-cancelamento",
  acao((req) =>
    agendamentoService.simularCancelamento(req.auth.tenantId, req.params.id, {
      tipo: req.query.tipo === "NO_SHOW" ? "NO_SHOW" : "CANCELAMENTO",
      porEstabelecimento: toBool(req.query.porEstabelecimento),
    })
  )
);
router.post(
  "/agendamentos/:id/cancelar",
  acao((req) =>
    agendamentoService.cancelar(req.auth.tenantId, req.params.id, {
      tipo: req.body?.tipo === "NO_SHOW" ? "NO_SHOW" : "CANCELAMENTO",
      porEstabelecimento: toBool(req.body?.porEstabelecimento),
      motivo: req.body?.motivo,
    })
  )
);
router.post(
  "/agendamentos/:id/reagendar",
  acao(async (req) => {
    const body = req.body || {};
    if (body.profissionalId) assertPodeEditar(req, body.profissionalId);
    return agendamentoService.reagendar(req.auth.tenantId, req.params.id, {
      data: body.data,
      hora: body.hora,
      inicio: body.inicio,
      profissionalId: body.profissionalId,
      encaixe: toBool(body.encaixe),
      porCliente: false,
    });
  })
);
router.post("/agendamentos/:id/reenviar-link", acao((req) => agendamentoService.reenviarLink(req.auth.tenantId, req.params.id)));
router.post(
  "/agendamentos/:id/pagamento-local",
  acao((req) => agendamentoService.registrarPagamentoNoLocal(req.auth.tenantId, req.params.id, { forma: req.body?.forma }))
);

// ---------- bloqueios e dias fechados ----------

router.get(
  "/bloqueios",
  asyncHandler(async (req, res) => {
    const profIds = profissionaisVisiveis(req, []);
    const bloqueios = await prisma.bloqueio.findMany({
      where: { tenantId: req.auth.tenantId, ...(profIds.length ? { profissionalId: { in: profIds } } : {}), OR: [{ semanal: true }, { fim: { gte: new Date() } }] },
      include: { profissional: { select: { nome: true } } },
      orderBy: { inicio: "asc" },
    });
    return ok(res, bloqueios);
  })
);

router.post(
  "/bloqueios",
  asyncHandler(async (req, res) => {
    assertPodeEditar(req, req.body?.profissionalId);
    return ok(res, await bloqueioService.criarBloqueio(req.auth.tenantId, req.body || {}));
  })
);

router.delete(
  "/bloqueios/:id",
  asyncHandler(async (req, res) => {
    const b = await prisma.bloqueio.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!b) throw badRequest("Bloqueio nao encontrado.");
    assertPodeEditar(req, b.profissionalId);
    await prisma.bloqueio.delete({ where: { id: b.id } });
    require("../lib/events").publish(req.auth.tenantId, "agenda.atualizada", { acao: "bloqueio_removido" });
    return ok(res, { removido: true });
  })
);

router.get(
  "/dias-fechados",
  asyncHandler(async (req, res) => {
    const dias = await prisma.diaFechado.findMany({
      where: { tenantId: req.auth.tenantId, data: { gte: todayStr(req.auth.tenant.timezone) } },
      orderBy: { data: "asc" },
    });
    return ok(res, dias);
  })
);

router.post(
  "/dias-fechados",
  asyncHandler(async (req, res) => {
    if (req.auth.perfil === "PROFISSIONAL") throw forbidden("Apenas dono e recepcao podem fechar dias.");
    return ok(res, await bloqueioService.fecharDia(req.auth.tenantId, req.body || {}));
  })
);

router.delete(
  "/dias-fechados/:id",
  asyncHandler(async (req, res) => {
    if (req.auth.perfil === "PROFISSIONAL") throw forbidden();
    const r = await prisma.diaFechado.deleteMany({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!r.count) throw badRequest("Dia fechado nao encontrado.");
    require("../lib/events").publish(req.auth.tenantId, "agenda.atualizada", { acao: "dia_reaberto" });
    return ok(res, { removido: true });
  })
);

// referencias para os formularios da agenda
router.get(
  "/referencias",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const [profissionais, servicos, produtos] = await Promise.all([
      prisma.profissional.findMany({ where: { tenantId, ativo: true }, select: { id: true, nome: true, cor: true }, orderBy: { nome: "asc" } }),
      prisma.servico.findMany({
        where: { tenantId, ativo: true },
        include: { profissionais: { select: { profissionalId: true } }, relacionados: { select: { produtoId: true } } },
        orderBy: [{ categoria: "asc" }, { nome: "asc" }],
      }),
      tenant.venderProdutos ? prisma.produto.findMany({ where: { tenantId, ativo: true }, orderBy: { nome: "asc" } }) : [],
    ]);
    return ok(res, {
      profissionais,
      servicos: servicos.map((s) => ({
        id: s.id,
        nome: s.nome,
        categoria: s.categoria,
        preco: s.preco,
        duracaoMin: s.duracaoMin,
        intervaloMin: s.intervaloMin,
        profissionalIds: s.profissionais.map((p) => p.profissionalId),
        produtosRelacionados: s.relacionados.map((r) => r.produtoId),
      })),
      produtos,
      venderProdutos: tenant.venderProdutos,
      intervaloSlotsMin: tenant.intervaloSlotsMin,
      toleranciaPendenteMin: tenant.toleranciaPendenteMin,
      // sem Mercado Pago conectado nao da para enviar link nem gerar Pix
      pagamentoOnline: require("../services/pagamentos/gateway").modo(tenant) !== "desconectado",
    });
  })
);

module.exports = router;
