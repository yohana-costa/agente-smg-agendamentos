// Automacoes (aba Automacoes): mensagens automaticas ao cliente pelo WhatsApp do estabelecimento.
const prisma = require("../lib/prisma");
const env = require("../config/env");
const { enviarTexto, getAgenteConfig, obterConversa, registrarMensagem } = require("./whatsapp/whatsapp.service");
const { sendMetaTemplate } = require("./whatsapp/providers");
const { templateDaAutomacao, textoDoTemplate } = require("./whatsapp/templates-cliente");
const { janelaAberta } = require("./alertas.service");
const { formatDateBr, formatTimeBr } = require("../lib/time");
const { brl, log, normalizePhone } = require("../lib/helpers");

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
    // com sinal (meses antecipados) o que falta pagar agora e so o sinal da cobranca pendente
    valor: brl(pagamentoPendente ? pagamentoPendente.valorBruto : agendamento.valorTotal),
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

// WhatsApp oficial com a janela de 24h fechada: so template aprovado chega. Texto livre a Meta
// aceita na hora e descarta depois, e a mensagem ficava no Atendimento como se tivesse ido.
// O lembrete vai sempre por template no WhatsApp oficial (mesmo com a janela aberta): so o template
// tem os botoes Confirmar / Cancelar. Template ainda nao aprovado: cai no lembrete antigo ou no texto.
async function enviarAoCliente(tenantId, agendamento, tipo, vars, texto) {
  const telefone = normalizePhone(agendamento.cliente?.telefone);
  const config = await getAgenteConfig(tenantId);
  const sempreTemplate = tipo === "LEMBRETE_ATENDIMENTO";
  const enviarComoTexto = () => enviarTexto(tenantId, agendamento.cliente?.telefone, texto, { autor: "SISTEMA", clienteId: agendamento.clienteId });
  if (!telefone || config.whatsappProvider !== "meta" || env.whatsappDryRun) return enviarComoTexto();
  const janela = await janelaAberta(tenantId, config, telefone);
  if (janela && !sempreTemplate) return enviarComoTexto();
  const t = templateDaAutomacao(tipo, vars, texto);
  if (!t) return janela ? enviarComoTexto() : { enviado: false, motivo: "fora_da_janela_24h_sem_template" };
  const erros = [];
  for (const nome of [t.name, t.alternativa].filter(Boolean)) {
    try {
      const r = await sendMetaTemplate(config.whatsappConfig, { to: telefone, name: nome, params: t.params });
      const conversa = await obterConversa(tenantId, telefone, "ATENDIMENTO", { clienteId: agendamento.clienteId });
      await registrarMensagem(conversa, { autor: "SISTEMA", texto: textoDoTemplate(nome, t.params), externalId: r.externalId });
      return { enviado: true, externalId: r.externalId, template: nome };
    } catch (error) {
      erros.push(`template ${nome}: ${error.message}`);
    }
  }
  if (janela) return enviarComoTexto();
  return { enviado: false, motivo: erros.join(" | ") };
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

  const vars = varsAgendamento(agendamento, tenant, extras);
  let texto = renderTemplate(automacao.texto, vars);
  // Pagar no local: a confirmacao sai sem pagamento, entao o "Pagamento confirmado!" do texto padrao mentiria.
  if (tipo === "CONFIRMACAO" && agendamento.modoPagamento === "LOCAL") {
    texto = texto.replace(/^\s*Pagamento confirmado!?\s*/i, "Agendamento confirmado! ").replace(/\s*$/, " O pagamento é feito no dia, na clínica.");
  }
  const r = await enviarAoCliente(tenant.id, agendamento, tipo, vars, texto);
  if (unicaVez && !r.enviado) {
    await prisma.automacaoEnvio.updateMany({ where: { tipo, referencia: ref }, data: { sucesso: false, erro: r.motivo || null } });
  }
  log("automacoes", "disparo", { tipo, agendamentoId, enviado: r.enviado, motivo: r.motivo, template: r.template });
  return true;
}

module.exports = { AUTOMACOES_PADRAO, garantirAutomacoes, renderTemplate, varsAgendamento, dispararAutomacao };
