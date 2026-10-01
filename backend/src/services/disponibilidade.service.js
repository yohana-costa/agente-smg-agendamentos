// Motor de disponibilidade da agenda (escopo 4.8, 4.9, 4.10, 6.2, 6.3).
// Trabalha em "minutos do dia" no fuso do estabelecimento para cada data.
const prisma = require("../lib/prisma");
const { badRequest } = require("../lib/errors");
const {
  zonedParts,
  zonedToUtc,
  timeToMinutes,
  minutesToTime,
  isDateStr,
  addDays,
  addMinutes,
  weekdayOf,
  dayRangeUtc,
  todayStr,
} = require("../lib/time");

const STATUS_OCUPAM = ["AGUARDANDO_PAGAMENTO", "CONFIRMADO", "EM_ATENDIMENTO", "CONCLUIDO"];

// ---------- duracao ----------

// servicos: [{ duracaoMin, intervaloMin }] na ordem do atendimento.
// Ocupacao = soma de (duracao + intervalo) de todos os servicos.
// "fim" = fim do atendimento (sem o ultimo intervalo); "fimIntervalo" = fim da ocupacao.
function calcularDuracao(servicos = []) {
  const duracaoServicos = servicos.reduce((acc, s) => acc + Number(s.duracaoMin || 0), 0);
  const intervalos = servicos.reduce((acc, s) => acc + Number(s.intervaloMin || 0), 0);
  const ultimoIntervalo = servicos.length ? Number(servicos[servicos.length - 1].intervaloMin || 0) : 0;
  return {
    duracaoServicos,
    intervalos,
    duracaoAtendimento: duracaoServicos + intervalos - ultimoIntervalo,
    ocupacaoTotal: duracaoServicos + intervalos,
    ultimoIntervalo,
  };
}

function calcularHorarios(inicio, servicos) {
  const d = calcularDuracao(servicos);
  return {
    inicio: new Date(inicio),
    fim: addMinutes(inicio, d.duracaoAtendimento),
    fimIntervalo: addMinutes(inicio, d.ocupacaoTotal),
    ...d,
  };
}

// ---------- intervalos (em minutos do dia) ----------

function subtract(windows, busy) {
  let result = windows.map((w) => ({ ...w }));
  for (const b of busy) {
    const next = [];
    for (const w of result) {
      if (b.fim <= w.inicio || b.inicio >= w.fim) {
        next.push(w);
        continue;
      }
      if (b.inicio > w.inicio) next.push({ inicio: w.inicio, fim: b.inicio });
      if (b.fim < w.fim) next.push({ inicio: b.fim, fim: w.fim });
    }
    result = next;
  }
  return result.filter((w) => w.fim > w.inicio);
}

function intersect(a, b) {
  const out = [];
  for (const x of a) {
    for (const y of b) {
      const inicio = Math.max(x.inicio, y.inicio);
      const fim = Math.min(x.fim, y.fim);
      if (fim > inicio) out.push({ inicio, fim });
    }
  }
  return out;
}

// Converte um intervalo UTC para minutos do dia local (recortado ao dia).
function toDayMinutes(inicio, fim, dateStr, tz) {
  const { start, end } = dayRangeUtc(dateStr, tz);
  const s = Math.max(new Date(inicio).getTime(), start.getTime());
  const e = Math.min(new Date(fim).getTime(), end.getTime());
  if (e <= s) return null;
  const dayStart = start.getTime();
  return { inicio: Math.round((s - dayStart) / 60000), fim: Math.round((e - dayStart) / 60000) };
}

// ---------- contexto do dia ----------

async function carregarContexto(tenantId, dateStr, profissionalIds) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw badRequest("Estabelecimento nao encontrado.");
  const tz = tenant.timezone;
  const { start, end } = dayRangeUtc(dateStr, tz);
  const weekday = weekdayOf(dateStr);
  const profFilter = profissionalIds?.length ? { in: profissionalIds } : undefined;

  const [horario, diaFechado, profissionais, ausencias, bloqueios, eventos, agendamentos] = await Promise.all([
    prisma.horarioFuncionamento.findUnique({ where: { tenantId_diaSemana: { tenantId, diaSemana: weekday } } }),
    prisma.diaFechado.findUnique({ where: { tenantId_data: { tenantId, data: dateStr } } }),
    prisma.profissional.findMany({
      where: { tenantId, ativo: true, ...(profFilter ? { id: profFilter } : {}) },
      include: { jornada: { where: { diaSemana: weekday } } },
      orderBy: { nome: "asc" },
    }),
    prisma.ausencia.findMany({
      where: { profissional: { tenantId }, ...(profFilter ? { profissionalId: profFilter } : {}), inicio: { lt: end }, fim: { gt: start } },
    }),
    prisma.bloqueio.findMany({
      where: {
        tenantId,
        ...(profFilter ? { profissionalId: profFilter } : {}),
        OR: [{ semanal: false, inicio: { lt: end }, fim: { gt: start } }, { semanal: true, inicio: { lt: end } }],
      },
    }),
    prisma.eventoExterno.findMany({
      where: { profissional: { tenantId }, ...(profFilter ? { profissionalId: profFilter } : {}), inicio: { lt: end }, fim: { gt: start } },
    }),
    prisma.agendamento.findMany({
      where: {
        tenantId,
        ...(profFilter ? { profissionalId: profFilter } : {}),
        status: { in: STATUS_OCUPAM },
        inicio: { lt: end },
        fimIntervalo: { gt: start },
      },
      select: { id: true, profissionalId: true, inicio: true, fim: true, fimIntervalo: true, status: true, expiraEm: true },
    }),
  ]);

  return { tenant, tz, dateStr, weekday, horario, diaFechado, profissionais, ausencias, bloqueios, eventos, agendamentos };
}

// Ocorrencia de um bloqueio no dia (considerando repeticao semanal).
function bloqueioNoDia(bloqueio, dateStr, tz) {
  if (!bloqueio.semanal) return toDayMinutes(bloqueio.inicio, bloqueio.fim, dateStr, tz);
  const ini = zonedParts(bloqueio.inicio, tz);
  if (ini.date > dateStr || ini.weekday !== weekdayOf(dateStr)) return null;
  const fim = zonedParts(bloqueio.fim, tz);
  const duracao = Math.round((new Date(bloqueio.fim) - new Date(bloqueio.inicio)) / 60000);
  const inicioMin = ini.minutesOfDay;
  const fimMin = fim.date === ini.date ? fim.minutesOfDay : Math.min(1440, inicioMin + duracao);
  return { inicio: inicioMin, fim: fimMin };
}

function janelasProfissional(ctx, profissional) {
  const { horario, diaFechado } = ctx;
  if (diaFechado) return { aberto: false, motivo: "FECHADO_FORA_ROTINA", janelas: [] };
  if (!horario || !horario.aberto) return { aberto: false, motivo: "FECHADO_ROTINA", janelas: [] };

  const jornada = profissional.jornada?.[0];
  if (!jornada || !jornada.trabalha) return { aberto: false, motivo: "FOLGA_SEMANAL", janelas: [] };

  const funcionamento = [{ inicio: timeToMinutes(horario.inicio), fim: timeToMinutes(horario.fim) }];
  const turno = [{ inicio: timeToMinutes(jornada.inicio), fim: timeToMinutes(jornada.fim) }];
  const pausas = (Array.isArray(jornada.pausas) ? jornada.pausas : [])
    .filter((p) => p && p.inicio && p.fim)
    .map((p) => ({ inicio: timeToMinutes(p.inicio), fim: timeToMinutes(p.fim), tipo: "PAUSA" }));

  const janelas = subtract(intersect(funcionamento, turno), pausas);
  return { aberto: true, motivo: null, janelas, pausas, origemGrade: turno[0].inicio };
}

function ocupacoesProfissional(ctx, profissionalId, { excluirAgendamentoId } = {}) {
  const { tz, dateStr } = ctx;
  const now = Date.now();
  const busy = [];
  for (const a of ctx.ausencias.filter((x) => x.profissionalId === profissionalId)) {
    const m = toDayMinutes(a.inicio, a.fim, dateStr, tz);
    if (m) busy.push({ ...m, tipo: "AUSENCIA", id: a.id, motivo: a.motivo });
  }
  for (const b of ctx.bloqueios.filter((x) => x.profissionalId === profissionalId)) {
    const m = bloqueioNoDia(b, dateStr, tz);
    if (m) busy.push({ ...m, tipo: "BLOQUEIO", id: b.id, motivo: b.motivo });
  }
  for (const e of ctx.eventos.filter((x) => x.profissionalId === profissionalId)) {
    const m = toDayMinutes(e.inicio, e.fim, dateStr, tz);
    if (m) busy.push({ ...m, tipo: "GOOGLE", id: e.id });
  }
  for (const ag of ctx.agendamentos.filter((x) => x.profissionalId === profissionalId)) {
    if (ag.id === excluirAgendamentoId) continue;
    // reserva expirada ainda nao processada pelo scheduler nao bloqueia horario
    if (ag.status === "AGUARDANDO_PAGAMENTO" && ag.expiraEm && new Date(ag.expiraEm).getTime() < now) continue;
    const m = toDayMinutes(ag.inicio, ag.fimIntervalo, dateStr, tz);
    if (m) busy.push({ ...m, tipo: "AGENDAMENTO", id: ag.id });
  }
  return busy;
}

// ---------- horarios oferecidos (site/agente/tela) ----------

async function resolverServicos(tenantId, servicoIds, { apenasAtivos = true } = {}) {
  const ids = [...new Set((servicoIds || []).map(String).filter(Boolean))];
  if (!ids.length) throw badRequest("Escolha pelo menos um servico.");
  const servicos = await prisma.servico.findMany({
    where: { tenantId, id: { in: ids }, ...(apenasAtivos ? { ativo: true } : {}) },
    include: { profissionais: true },
  });
  if (servicos.length !== ids.length) throw badRequest("Servico invalido ou inativo.");
  // mantem a ordem escolhida
  return ids.map((id) => servicos.find((s) => s.id === id));
}

function profissionaisHabilitados(servicos) {
  let ids = null;
  for (const s of servicos) {
    const set = new Set(s.profissionais.map((p) => p.profissionalId));
    ids = ids === null ? set : new Set([...ids].filter((id) => set.has(id)));
  }
  return [...(ids || [])];
}

async function listarHorarios({ tenantId, servicoIds, profissionalId, data, excluirAgendamentoId, servicos: servicosPre }) {
  if (!isDateStr(data)) throw badRequest("Data invalida. Use AAAA-MM-DD.");
  const servicos = servicosPre || (await resolverServicos(tenantId, servicoIds));
  let habilitados = profissionaisHabilitados(servicos);
  if (profissionalId) habilitados = habilitados.filter((id) => id === profissionalId);
  if (!habilitados.length) return { data, duracao: calcularDuracao(servicos), profissionais: [] };

  const ctx = await carregarContexto(tenantId, data, habilitados);
  const duracao = calcularDuracao(servicos);
  const passo = Math.max(5, ctx.tenant.intervaloSlotsMin || 60);
  const hoje = todayStr(ctx.tz);
  const agoraMin = data === hoje ? zonedParts(new Date(), ctx.tz).minutesOfDay : data < hoje ? 1440 : -1;

  const profissionais = ctx.profissionais.map((prof) => {
    const dia = janelasProfissional(ctx, prof);
    if (!dia.aberto) return { profissionalId: prof.id, nome: prof.nome, cor: prof.cor, horarios: [], motivo: dia.motivo };
    const livres = subtract(dia.janelas, ocupacoesProfissional(ctx, prof.id, { excluirAgendamentoId }));
    const horarios = [];
    const origem = dia.origemGrade;
    for (let t = origem; t + duracao.ocupacaoTotal <= 1440; t += passo) {
      if (t <= agoraMin) continue;
      const cabe = livres.some((w) => t >= w.inicio && t + duracao.ocupacaoTotal <= w.fim);
      if (cabe) horarios.push(minutesToTime(t));
    }
    return { profissionalId: prof.id, nome: prof.nome, cor: prof.cor, horarios };
  });

  return { data, duracao, profissionais };
}

// Proximos dias com horario livre (usado pelo agente e pelo site para navegar no calendario).
async function proximosDiasDisponiveis({ tenantId, servicoIds, profissionalId, aPartirDe, dias = 14, maxResultados = 7 }) {
  const servicos = await resolverServicos(tenantId, servicoIds);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  let cursor = isDateStr(aPartirDe) ? aPartirDe : todayStr(tenant.timezone);
  const result = [];
  for (let i = 0; i < dias && result.length < maxResultados; i += 1) {
    const r = await listarHorarios({ tenantId, servicos, profissionalId, data: cursor });
    const comHorario = r.profissionais.filter((p) => p.horarios.length);
    if (comHorario.length) result.push({ data: cursor, profissionais: comHorario });
    cursor = addDays(cursor, 1);
  }
  return result;
}

// Valida se um inicio exato e um horario oferecido (site/agente nunca fazem encaixe).
async function validarHorarioOferecido({ tenantId, servicos, profissionalId, inicio, excluirAgendamentoId }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const p = zonedParts(inicio, tenant.timezone);
  const r = await listarHorarios({ tenantId, servicos, profissionalId, data: p.date, excluirAgendamentoId });
  const prof = r.profissionais.find((x) => x.profissionalId === profissionalId);
  return Boolean(prof && prof.horarios.includes(p.time));
}

// Lista conflitos de um periodo (usado no agendamento manual / encaixe / reagendamento pela tela).
async function verificarConflitos({ tenantId, profissionalId, inicio, fimIntervalo, excluirAgendamentoId }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const tz = tenant.timezone;
  const dateStr = zonedParts(inicio, tz).date;
  const ctx = await carregarContexto(tenantId, dateStr, [profissionalId]);
  const prof = ctx.profissionais[0];
  const conflitos = [];
  if (!prof) {
    conflitos.push({ tipo: "PROFISSIONAL_INATIVO", descricao: "Profissional inativo ou inexistente." });
    return conflitos;
  }
  const alvo = toDayMinutes(inicio, fimIntervalo, dateStr, tz) || { inicio: 0, fim: 0 };
  const dia = janelasProfissional(ctx, prof);
  if (!dia.aberto) {
    const descricoes = {
      FECHADO_FORA_ROTINA: "Dia fechado pelo estabelecimento.",
      FECHADO_ROTINA: "Estabelecimento fechado neste dia.",
      FOLGA_SEMANAL: "Profissional nao trabalha neste dia.",
    };
    conflitos.push({ tipo: dia.motivo, descricao: descricoes[dia.motivo] });
  } else if (!dia.janelas.some((w) => alvo.inicio >= w.inicio && alvo.fim <= w.fim)) {
    conflitos.push({ tipo: "FORA_JORNADA", descricao: "Horario fora da jornada do profissional." });
  }
  const descricaoTipo = {
    AGENDAMENTO: "Conflita com outro agendamento (ou intervalo apos servico).",
    BLOQUEIO: "Conflita com um bloqueio de horario.",
    AUSENCIA: "Profissional ausente/folga.",
    GOOGLE: "Conflita com evento do Google Calendar.",
  };
  for (const b of ocupacoesProfissional(ctx, profissionalId, { excluirAgendamentoId })) {
    if (b.fim > alvo.inicio && b.inicio < alvo.fim) {
      conflitos.push({ tipo: b.tipo, id: b.id, descricao: descricaoTipo[b.tipo], motivo: b.motivo || null });
    }
  }
  return conflitos;
}

// Agenda do dia para a tela: janelas de trabalho e o que ocupa cada profissional.
async function estruturaDia(tenantId, dateStr, profissionalIds) {
  const ctx = await carregarContexto(tenantId, dateStr, profissionalIds);
  return ctx.profissionais.map((prof) => {
    const dia = janelasProfissional(ctx, prof);
    return {
      profissionalId: prof.id,
      aberto: dia.aberto,
      motivo: dia.motivo,
      janelas: dia.janelas.map((w) => ({ inicio: minutesToTime(w.inicio), fim: minutesToTime(w.fim) })),
      pausas: (dia.pausas || []).map((w) => ({ inicio: minutesToTime(w.inicio), fim: minutesToTime(w.fim) })),
    };
  });
}

// Horas disponiveis reais de um profissional num dia (minutos), descontando bloqueios/ausencias/google.
async function minutosDisponiveisDia(ctx, prof) {
  const dia = janelasProfissional(ctx, prof);
  if (!dia.aberto) return { disponiveis: 0, motivo: dia.motivo, janelaBruta: 0 };
  const bloqueiosEtc = ocupacoesProfissional(ctx, prof.id).filter((b) => b.tipo !== "AGENDAMENTO");
  const livres = subtract(dia.janelas, bloqueiosEtc);
  return {
    disponiveis: livres.reduce((acc, w) => acc + (w.fim - w.inicio), 0),
    janelaBruta: dia.janelas.reduce((acc, w) => acc + (w.fim - w.inicio), 0),
    motivo: null,
  };
}

// Janela bruta que o profissional teria se o dia nao estivesse fechado fora da rotina.
function minutosJanelaSemFechamento(ctx, prof) {
  return janelasProfissional({ ...ctx, diaFechado: null }, prof).janelas.reduce((acc, w) => acc + (w.fim - w.inicio), 0);
}

function toUtcFromLocal(dateStr, timeStr, tz) {
  return zonedToUtc(dateStr, timeStr, tz);
}

module.exports = {
  STATUS_OCUPAM,
  calcularDuracao,
  calcularHorarios,
  carregarContexto,
  janelasProfissional,
  ocupacoesProfissional,
  resolverServicos,
  profissionaisHabilitados,
  listarHorarios,
  proximosDiasDisponiveis,
  validarHorarioOferecido,
  verificarConflitos,
  estruturaDia,
  minutosDisponiveisDia,
  minutosJanelaSemFechamento,
  toUtcFromLocal,
};
