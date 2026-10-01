// Tarefas periodicas (setInterval em processo, mesmo padrao do wf2-scheduler do Gestor SMG varejo).
const prisma = require("../lib/prisma");
const env = require("../config/env");
const agendamentoService = require("./agendamento.service");
const vendaService = require("./venda.service");
const google = require("./google-calendar.service");
const { dispararAutomacao } = require("./automacao.service");
const { retomarPausasVencidas } = require("../agents/orchestrator");
const assinaturas = require("./assinatura/assinatura.service");
const { addMinutes } = require("../lib/time");
const { log } = require("../lib/helpers");

let running = false;
let timer = null;
let ultimoGoogle = 0;
let ultimaAssinatura = 0;

async function automacoesAtivas(tipo) {
  return prisma.automacao.findMany({ where: { tipo, ativo: true }, select: { tenantId: true, disparoMin: true } });
}

async function jaEnviadas(tipo, ids) {
  if (!ids.length) return new Set();
  const envios = await prisma.automacaoEnvio.findMany({ where: { tipo, referencia: { in: ids } }, select: { referencia: true } });
  return new Set(envios.map((e) => e.referencia));
}

async function lembretesPagamento(agora) {
  for (const a of await automacoesAtivas("LEMBRETE_PAGAMENTO")) {
    const ags = await prisma.agendamento.findMany({
      where: { tenantId: a.tenantId, status: "AGUARDANDO_PAGAMENTO", createdAt: { lte: addMinutes(agora, -a.disparoMin) }, expiraEm: { gt: agora } },
      select: { id: true },
    });
    const enviados = await jaEnviadas("LEMBRETE_PAGAMENTO", ags.map((x) => x.id));
    for (const ag of ags.filter((x) => !enviados.has(x.id))) await dispararAutomacao("LEMBRETE_PAGAMENTO", ag.id);
  }
}

async function lembretesAtendimento(agora) {
  for (const a of await automacoesAtivas("LEMBRETE_ATENDIMENTO")) {
    const ags = await prisma.agendamento.findMany({
      where: { tenantId: a.tenantId, status: "CONFIRMADO", inicio: { gt: agora, lte: addMinutes(agora, a.disparoMin) } },
      select: { id: true },
    });
    const enviados = await jaEnviadas("LEMBRETE_ATENDIMENTO", ags.map((x) => x.id));
    for (const ag of ags.filter((x) => !enviados.has(x.id))) await dispararAutomacao("LEMBRETE_ATENDIMENTO", ag.id);
  }
}

async function posAtendimento(agora) {
  for (const a of await automacoesAtivas("POS_ATENDIMENTO")) {
    const ags = await prisma.agendamento.findMany({
      where: {
        tenantId: a.tenantId,
        status: "CONCLUIDO",
        finalizadoEm: { lte: addMinutes(agora, -a.disparoMin), gt: addMinutes(agora, -a.disparoMin - 1440) },
      },
      select: { id: true },
    });
    const enviados = await jaEnviadas("POS_ATENDIMENTO", ags.map((x) => x.id));
    for (const ag of ags.filter((x) => !enviados.has(x.id))) await dispararAutomacao("POS_ATENDIMENTO", ag.id);
  }
}

async function avisosRetorno(agora) {
  for (const a of await automacoesAtivas("AVISO_RETORNO")) {
    const ags = await prisma.agendamento.findMany({
      where: {
        tenantId: a.tenantId,
        status: "CONCLUIDO",
        retornoSugerido: { lte: addMinutes(agora, a.disparoMin), gt: addMinutes(agora, -7 * 1440) },
      },
      select: { id: true, clienteId: true, inicio: true },
    });
    const enviados = await jaEnviadas("AVISO_RETORNO", ags.map((x) => x.id));
    for (const ag of ags.filter((x) => !enviados.has(x.id))) {
      // nao avisa quem ja voltou ou ja tem horario marcado
      const depois = await prisma.agendamento.count({
        where: { clienteId: ag.clienteId, inicio: { gt: ag.inicio }, status: { in: ["AGUARDANDO_PAGAMENTO", "CONFIRMADO", "EM_ATENDIMENTO", "CONCLUIDO"] } },
      });
      if (depois) {
        await prisma.automacaoEnvio.create({ data: { tenantId: a.tenantId, tipo: "AVISO_RETORNO", referencia: ag.id, sucesso: false, erro: "cliente_ja_retornou" } }).catch(() => {});
        continue;
      }
      await dispararAutomacao("AVISO_RETORNO", ag.id);
    }
  }
}

async function tick() {
  if (running) return;
  running = true;
  const agora = new Date();
  const etapas = [
    ["expirar_reservas", () => agendamentoService.expirarReservas()],
    ["expirar_vendas", () => vendaService.expirarVendas()],
    ["lembrete_pagamento", () => lembretesPagamento(agora)],
    ["lembrete_atendimento", () => lembretesAtendimento(agora)],
    ["pos_atendimento", () => posAtendimento(agora)],
    ["aviso_retorno", () => avisosRetorno(agora)],
    ["retomar_pausas", () => retomarPausasVencidas()],
  ];
  // Assinaturas da plataforma (Pix Automatico / cartao): no maximo 1x por minuto.
  if (Date.now() - ultimaAssinatura > 60000) {
    ultimaAssinatura = Date.now();
    etapas.push(["assinaturas", () => assinaturas.verificarTodas()]);
  }
  if (Date.now() - ultimoGoogle > env.googleSyncMinutes * 60000) {
    ultimoGoogle = Date.now();
    etapas.push(["google_sync", () => google.sincronizarTodos()]);
  }
  try {
    for (const [nome, fn] of etapas) {
      try {
        await fn();
      } catch (error) {
        log("scheduler", "erro_etapa", { etapa: nome, erro: error.message });
      }
    }
  } finally {
    running = false;
  }
}

function start() {
  if (!env.schedulerEnabled || timer) return;
  timer = setInterval(tick, env.schedulerIntervalSeconds * 1000);
  log("scheduler", "iniciado", { intervaloSegundos: env.schedulerIntervalSeconds });
  setTimeout(tick, 3000);
}

module.exports = { start, tick };
