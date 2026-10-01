// Automacoes (aba Automacoes): mensagens automaticas ao cliente pelo WhatsApp do estabelecimento.
const prisma = require("../lib/prisma");
const env = require("../config/env");
const { enviarTexto } = require("./whatsapp/whatsapp.service");
const { formatDateBr, formatTimeBr } = require("../lib/time");
const { brl, log } = require("../lib/helpers");

const AUTOMACOES_PADRAO = [
  {
    tipo: "LEMBRETE_PAGAMENTO",
    disparoMin: 5,
    texto:
      "Oi, {cliente}! Seu agendamento de {servicos} em {data} às {hora} ainda está aguardando pagamento. Faltam {minutos_restantes} minutos para o cancelamento automático. Pague aqui: {link_pagamento}",
  },
  {
    tipo: "CONFIRMACAO",
    disparoMin: 0,
    texto: "Pagamento confirmado! ✅ {cliente}, seu agendamento de {servicos} com {profissional} está confirmado para {data} às {hora}. Até lá!",
  },
  {
    tipo: "LEMBRETE_ATENDIMENTO",
    disparoMin: 1440,
    texto: "Oi, {cliente}! Passando para lembrar do seu horario de {servicos} com {profissional} em {data} às {hora}.",
  },
  {
    tipo: "POS_ATENDIMENTO",
    disparoMin: 120,
    texto: "Obrigado pela visita, {cliente}! Esperamos que tenha gostado. Qualquer coisa, é só chamar por aqui.",
  },
  {
    tipo: "AVISO_RETORNO",
    disparoMin: 0,
    texto: "Oi, {cliente}! Já está na hora do seu retorno de {servicos}. Agende pelo link: {link_site}",
  },
  {
    tipo: "AVISO_REAGENDAMENTO",
    disparoMin: 0,
    texto: "{cliente}, seu agendamento de {servicos} foi reagendado para {data} às {hora} com {profissional}.",
  },
  {
    tipo: "AVISO_CANCELAMENTO",
    disparoMin: 0,
    texto: "{cliente}, seu agendamento de {servicos} em {data} às {hora} foi cancelado. {reembolso}",
  },
];

async function garantirAutomacoes(tenantId) {
  for (const a of AUTOMACOES_PADRAO) {
    await prisma.automacao.upsert({
      where: { tenantId_tipo: { tenantId, tipo: a.tipo } },
      update: {},
      create: { tenantId, ...a },
    });
  }
}

function renderTemplate(texto, vars) {
  return String(texto || "").replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ""));
}

function varsAgendamento(agendamento, tenant, extras = {}) {
  const tz = tenant.timezone;
  const pagamentoPendente = (agendamento.pagamentos || []).find((p) => p.status === "PENDENTE");
  return {
    cliente: agendamento.cliente?.nome?.split(" ")[0] || "",
    cliente_nome: agendamento.cliente?.nome || "",
    servicos: (agendamento.servicos || []).map((s) => s.nome).join(" + "),
    profissional: agendamento.profissional?.nome || "",
    data: formatDateBr(agendamento.inicio, tz),
    hora: formatTimeBr(agendamento.inicio, tz),
    valor: brl(agendamento.valorTotal),
    estabelecimento: tenant.nome,
    link_pagamento: pagamentoPendente?.linkPagamento || "",
    link_site: `${env.publicAppUrl}/s/${tenant.slug}`,
    minutos_restantes: agendamento.expiraEm ? Math.max(0, Math.ceil((new Date(agendamento.expiraEm) - Date.now()) / 60000)) : "",
    reembolso: "",
    ...extras,
  };
}

async function carregarAgendamento(agendamentoId) {
  return prisma.agendamento.findUnique({
    where: { id: agendamentoId },
    include: { cliente: true, profissional: true, servicos: { orderBy: { ordem: "asc" } }, pagamentos: true, tenant: true },
  });
}

/**
 * Envia uma automacao uma unica vez por referencia (AutomacaoEnvio garante idempotencia).
 * Retorna false quando desativada, ja enviada ou sem dados.
 */
async function dispararAutomacao(tipo, agendamentoId, { extras = {}, referencia, unicaVez = true } = {}) {
  const agendamento = await carregarAgendamento(agendamentoId);
  if (!agendamento) return false;
  const tenant = agendamento.tenant;
  const automacao = await prisma.automacao.findUnique({ where: { tenantId_tipo: { tenantId: tenant.id, tipo } } });
  if (!automacao || !automacao.ativo) return false;

  const ref = referencia || agendamentoId;
  if (unicaVez) {
    try {
      await prisma.automacaoEnvio.create({ data: { tenantId: tenant.id, tipo, referencia: ref } });
    } catch (_error) {
      return false; // ja enviada
    }
  }

  const texto = renderTemplate(automacao.texto, varsAgendamento(agendamento, tenant, extras));
  const r = await enviarTexto(tenant.id, agendamento.cliente.telefone, texto, { autor: "SISTEMA", clienteId: agendamento.clienteId });
  if (unicaVez && !r.enviado) {
    await prisma.automacaoEnvio.updateMany({ where: { tipo, referencia: ref }, data: { sucesso: false, erro: r.motivo || null } });
  }
  log("automacoes", "disparo", { tipo, agendamentoId, enviado: r.enviado, motivo: r.motivo });
  return true;
}

module.exports = { AUTOMACOES_PADRAO, garantirAutomacoes, renderTemplate, varsAgendamento, dispararAutomacao };
