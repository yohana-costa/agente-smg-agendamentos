// Bloqueios de horario e fechamento de dias (escopo 6.8).
// Se o periodo ja tiver agendamentos, lista os afetados e exige uma decisao para cada um
// (reagendar ou cancelar com reembolso integral). Os clientes sao avisados automaticamente.
const prisma = require("../lib/prisma");
const events = require("../lib/events");
const agendamentoService = require("./agendamento.service");
const { badRequest, conflict } = require("../lib/errors");
const { zonedToUtc, zonedParts, isDateStr, isTimeStr, dayRangeUtc, addDays, weekdayOf } = require("../lib/time");
const { textOrNull } = require("../lib/helpers");

const ATIVOS = ["AGUARDANDO_PAGAMENTO", "CONFIRMADO"];

async function afetadosPorPeriodo({ tenantId, profissionalId, inicio, fim, semanal, tz }) {
  const base = { tenantId, status: { in: ATIVOS }, ...(profissionalId ? { profissionalId } : {}) };
  if (!semanal) {
    return prisma.agendamento.findMany({
      where: { ...base, inicio: { lt: fim }, fimIntervalo: { gt: inicio } },
      include: { cliente: true, servicos: true, profissional: { select: { nome: true } } },
      orderBy: { inicio: "asc" },
    });
  }
  // semanal: verifica as ocorrencias das proximas 26 semanas
  const ini = zonedParts(inicio, tz);
  const fimP = zonedParts(fim, tz);
  const futuros = await prisma.agendamento.findMany({
    where: { ...base, inicio: { gte: inicio } },
    include: { cliente: true, servicos: true, profissional: { select: { nome: true } } },
    orderBy: { inicio: "asc" },
  });
  return futuros.filter((a) => {
    const p = zonedParts(a.inicio, tz);
    const pf = zonedParts(a.fimIntervalo, tz);
    if (p.weekday !== ini.weekday) return false;
    return p.minutesOfDay < fimP.minutesOfDay && (pf.date > p.date ? 1440 : pf.minutesOfDay) > ini.minutesOfDay;
  });
}

function resumoAfetado(a, tz) {
  const p = zonedParts(a.inicio, tz);
  return {
    id: a.id,
    data: p.date,
    hora: p.time,
    cliente: a.cliente.nome,
    telefone: a.cliente.telefone,
    servicos: a.servicos.map((s) => s.nome).join(" + "),
    profissional: a.profissional.nome,
    status: a.status,
  };
}

// decisoes: [{ agendamentoId, acao: "CANCELAR" | "REAGENDAR", data, hora, profissionalId }]
async function aplicarDecisoes(tenantId, afetados, decisoes = []) {
  const faltando = afetados.filter((a) => !decisoes.find((d) => d.agendamentoId === a.id));
  if (faltando.length) return { pendentes: faltando };

  // valida todos os reagendamentos antes de aplicar qualquer decisao (evita aplicacao parcial)
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  for (const d of decisoes) {
    if (d.acao !== "REAGENDAR" || !afetados.find((a) => a.id === d.agendamentoId)) continue;
    if (!isDateStr(d.data) || !isTimeStr(d.hora)) throw badRequest("Informe nova data e horario para reagendar.");
    if (d.encaixe) continue;
    const ag = await agendamentoService.obter(tenantId, d.agendamentoId);
    const inicio = zonedToUtc(d.data, d.hora, tenant.timezone);
    const { fimIntervalo } = require("./disponibilidade.service").calcularHorarios(inicio, ag.servicos);
    const conflitos = await require("./disponibilidade.service").verificarConflitos({
      tenantId,
      profissionalId: d.profissionalId || ag.profissionalId,
      inicio,
      fimIntervalo,
      excluirAgendamentoId: ag.id,
    });
    if (conflitos.length) {
      throw conflict(`O novo horario de ${ag.cliente.nome} (${d.data} ${d.hora}) tem conflitos. Escolha outro horario ou marque encaixe.`, { conflitos, agendamentoId: ag.id });
    }
  }

  const resultados = [];
  for (const d of decisoes) {
    if (!afetados.find((a) => a.id === d.agendamentoId)) continue;
    if (d.acao === "CANCELAR") {
      const r = await agendamentoService.cancelar(tenantId, d.agendamentoId, { porEstabelecimento: true, motivo: "Horario bloqueado pelo estabelecimento" });
      resultados.push({ agendamentoId: d.agendamentoId, acao: "CANCELAR", reembolso: r.reembolso.valor });
    } else if (d.acao === "REAGENDAR") {
      if (!isDateStr(d.data) || !isTimeStr(d.hora)) throw badRequest("Informe nova data e horario para reagendar.");
      await agendamentoService.reagendar(tenantId, d.agendamentoId, { data: d.data, hora: d.hora, profissionalId: d.profissionalId, porCliente: false, encaixe: Boolean(d.encaixe) });
      resultados.push({ agendamentoId: d.agendamentoId, acao: "REAGENDAR", data: d.data, hora: d.hora });
    } else {
      throw badRequest("Decisao invalida: use CANCELAR ou REAGENDAR.");
    }
  }
  return { pendentes: [], resultados };
}

async function criarBloqueio(tenantId, body) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const tz = tenant.timezone;
  const { profissionalId, data, horaInicio, horaFim, motivo, semanal = false, decisoes = [] } = body;
  if (!profissionalId) throw badRequest("Escolha o profissional.");
  if (!isDateStr(data) || !isTimeStr(horaInicio) || !isTimeStr(horaFim)) throw badRequest("Informe data, hora inicial e hora final.");
  const dataFim = isDateStr(body.dataFim) && !semanal ? body.dataFim : data;
  const inicio = zonedToUtc(data, horaInicio, tz);
  const fim = zonedToUtc(dataFim, horaFim, tz);
  if (fim <= inicio) throw badRequest("O fim do bloqueio deve ser depois do inicio.");
  const prof = await prisma.profissional.findFirst({ where: { id: profissionalId, tenantId } });
  if (!prof) throw badRequest("Profissional invalido.");

  const afetados = await afetadosPorPeriodo({ tenantId, profissionalId, inicio, fim, semanal, tz });
  const decisao = await aplicarDecisoes(tenantId, afetados, decisoes);
  if (decisao.pendentes.length) {
    throw conflict("Ha agendamentos neste periodo. Decida reagendar ou cancelar cada um.", {
      afetados: decisao.pendentes.map((a) => resumoAfetado(a, tz)),
      requerDecisao: true,
    });
  }
  const bloqueio = await prisma.bloqueio.create({
    data: { tenantId, profissionalId, inicio, fim, motivo: textOrNull(motivo), semanal: Boolean(semanal) },
  });
  events.publish(tenantId, "agenda.atualizada", { bloqueioId: bloqueio.id, acao: "bloqueio" });
  return { bloqueio, resultados: decisao.resultados || [] };
}

async function fecharDia(tenantId, { data, motivo, decisoes = [] }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const tz = tenant.timezone;
  if (!isDateStr(data)) throw badRequest("Data invalida.");
  const { start, end } = dayRangeUtc(data, tz);
  const afetados = await afetadosPorPeriodo({ tenantId, inicio: start, fim: end, semanal: false, tz });
  const decisao = await aplicarDecisoes(tenantId, afetados, decisoes);
  if (decisao.pendentes.length) {
    throw conflict("Ha agendamentos neste dia. Decida reagendar ou cancelar cada um.", {
      afetados: decisao.pendentes.map((a) => resumoAfetado(a, tz)),
      requerDecisao: true,
    });
  }
  const dia = await prisma.diaFechado.upsert({
    where: { tenantId_data: { tenantId, data } },
    update: { motivo: textOrNull(motivo) },
    create: { tenantId, data, motivo: textOrNull(motivo) },
  });
  events.publish(tenantId, "agenda.atualizada", { acao: "dia_fechado", data });
  return { dia, resultados: decisao.resultados || [] };
}

// Ocorrencias de bloqueios (incluindo semanais) num intervalo de datas, para desenhar a agenda.
async function listarOcorrencias(tenantId, from, to, profissionalIds) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const tz = tenant.timezone;
  const { end } = dayRangeUtc(to, tz);
  const { start } = dayRangeUtc(from, tz);
  const bloqueios = await prisma.bloqueio.findMany({
    where: {
      tenantId,
      ...(profissionalIds?.length ? { profissionalId: { in: profissionalIds } } : {}),
      OR: [{ semanal: false, inicio: { lt: end }, fim: { gt: start } }, { semanal: true, inicio: { lt: end } }],
    },
  });
  const out = [];
  for (const b of bloqueios) {
    if (!b.semanal) {
      out.push({ ...b, ocorrenciaInicio: b.inicio, ocorrenciaFim: b.fim });
      continue;
    }
    const ini = zonedParts(b.inicio, tz);
    const fimP = zonedParts(b.fim, tz);
    let cursor = from > ini.date ? from : ini.date;
    while (cursor <= to) {
      if (weekdayOf(cursor) === ini.weekday) {
        out.push({ ...b, ocorrenciaInicio: zonedToUtc(cursor, ini.time, tz), ocorrenciaFim: zonedToUtc(cursor, fimP.time, tz) });
      }
      cursor = addDays(cursor, 1);
    }
  }
  return out;
}

module.exports = { criarBloqueio, fecharDia, listarOcorrencias, afetadosPorPeriodo };
