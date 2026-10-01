// Orquestrador dos agentes de IA no WhatsApp.
// - Numeros autorizados (aba Agentes de IA > Gestao) falam com o Agente de Gestao.
// - Demais numeros falam com o Agente de Atendimento.
// - Mensagens em sequencia sao agrupadas (debounce) antes de responder.
// - Pausa por conversa: escalonamento, ou humano mandando mensagem (sistema ou direto no WhatsApp).
const prisma = require("../lib/prisma");
const env = require("../config/env");
const events = require("../lib/events");
const { gerarResposta } = require("../lib/ai-client");
const { normalizePhone, log } = require("../lib/helpers");
const { addMinutes } = require("../lib/time");
const { getAgenteConfig, obterConversa, registrarMensagem, enviarTexto } = require("../services/whatsapp/whatsapp.service");
const { parseUazapi, parseMeta } = require("../services/whatsapp/providers");
const { textoDaMidia } = require("../services/whatsapp/midia.service");
const atendimentoAgent = require("./atendimento/agent");
const gestaoAgent = require("./gestao/agent");

const timers = new Map();
const running = new Set();

// ---------- pausa ----------

function pausaAtiva(conversa) {
  return conversa.status !== "ATIVO" && conversa.pausadoAte && new Date(conversa.pausadoAte) > new Date();
}

async function pausar(conversa, { escalonar = false, motivo = null } = {}) {
  const config = await getAgenteConfig(conversa.tenantId);
  const data = {
    status: escalonar ? "ESCALONADO" : "PAUSADO",
    pausadoAte: addMinutes(new Date(), config.tempoRetornoMin || 15),
  };
  if (escalonar) Object.assign(data, { escalonamentoPendente: true, motivoEscalonamento: motivo, escalonadoEm: new Date() });
  const atualizada = await prisma.conversa.update({ where: { id: conversa.id }, data });
  events.publish(conversa.tenantId, "conversa.status", { conversaId: conversa.id, status: atualizada.status });
  return atualizada;
}

async function devolverAoAgente(conversaId) {
  const conversa = await prisma.conversa.update({
    where: { id: conversaId },
    data: { status: "ATIVO", pausadoAte: null, escalonamentoPendente: false },
  });
  events.publish(conversa.tenantId, "conversa.status", { conversaId, status: "ATIVO" });
  return conversa;
}

// Retorno automatico apos o tempo configurado (chamado pelo scheduler).
async function retomarPausasVencidas() {
  const vencidas = await prisma.conversa.findMany({ where: { status: { not: "ATIVO" }, pausadoAte: { lt: new Date() } }, select: { id: true, tenantId: true } });
  for (const c of vencidas) {
    await prisma.conversa.update({ where: { id: c.id }, data: { status: "ATIVO", pausadoAte: null } });
    events.publish(c.tenantId, "conversa.status", { conversaId: c.id, status: "ATIVO" });
  }
  return vencidas.length;
}

// Humano respondeu pelo sistema (aba Atendimento).
async function enviarMensagemHumano(conversaId, texto, usuarioNome) {
  const conversa = await prisma.conversa.findUnique({ where: { id: conversaId } });
  if (!conversa) throw Object.assign(new Error("Conversa nao encontrada."), { statusCode: 404 });
  const r = await enviarTexto(conversa.tenantId, conversa.telefone, texto, { autor: "HUMANO", canal: conversa.canal });
  await pausar(conversa);
  await prisma.conversa.update({ where: { id: conversaId }, data: { escalonamentoPendente: false } });
  log("agentes", "mensagem_humano", { conversaId, usuarioNome, enviado: r.enviado });
  return r;
}

// ---------- escalonamento ----------

async function escalar(conversa, motivo, { tenant, config, simulacao = false }) {
  await enviarTexto(tenant.id, conversa.telefone, config.mensagemEscalonamento, { autor: "AGENTE", simulacao });
  if (config.numeroEscalonamento && !simulacao) {
    const cliente = conversa.clienteId ? await prisma.cliente.findUnique({ where: { id: conversa.clienteId } }) : null;
    const nome = cliente?.nome || conversa.nomeContato || "Cliente";
    await enviarTexto(
      tenant.id,
      config.numeroEscalonamento,
      `⚠️ Atendimento precisa de atencao humana.\nCliente: ${nome} (${conversa.telefone})\nMotivo: ${motivo}\nResponda pela aba Atendimento ou direto no WhatsApp.`,
      { autor: "SISTEMA", registrar: false }
    );
  }
  await pausar(conversa, { escalonar: true, motivo });
  log("agentes", "escalonado", { conversaId: conversa.id, motivo });
}

// ---------- processamento ----------

function quebrarMensagem(texto) {
  return String(texto || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 4);
}

async function historico(conversaId) {
  const msgs = await prisma.mensagem.findMany({ where: { conversaId }, orderBy: { createdAt: "desc" }, take: env.agentHistoryLimit });
  return msgs
    .reverse()
    .map((m) => ({
      role: m.autor === "CLIENTE" ? "user" : "assistant",
      content: m.autor === "HUMANO" ? `[Atendente humano]: ${m.texto}` : m.autor === "SISTEMA" ? `[Mensagem automatica do sistema]: ${m.texto}` : m.texto,
    }));
}

async function processarConversa(conversaId, { simulacao = false } = {}) {
  if (running.has(conversaId)) {
    agendar(conversaId, { simulacao });
    return null;
  }
  running.add(conversaId);
  try {
    const conversa = await prisma.conversa.findUnique({ where: { id: conversaId }, include: { tenant: true } });
    if (!conversa) return null;
    const tenant = conversa.tenant;
    const config = await getAgenteConfig(tenant.id);
    const enviarOpts = { autor: "AGENTE", canal: conversa.canal, simulacao };

    if (conversa.canal === "ATENDIMENTO") {
      if (!config.atendimentoAtivo) return null;
      if (pausaAtiva(conversa)) {
        log("agentes", "conversa_pausada", { conversaId });
        return null;
      }
      if (conversa.status !== "ATIVO") await devolverAoAgente(conversaId);

      const ctx = { tenant, config, telefone: conversa.telefone, cliente: null, escalonamento: null };
      ctx.cliente = conversa.clienteId ? await prisma.cliente.findUnique({ where: { id: conversa.clienteId } }) : null;
      const r = await gerarResposta({
        systemPrompt: atendimentoAgent.buildSystemPrompt({ tenant, config, cliente: ctx.cliente }),
        history: await historico(conversaId),
        tools: atendimentoAgent.buildTools(ctx),
        shouldStop: () => Boolean(ctx.escalonamento),
      });
      if (ctx.cliente && !conversa.clienteId) await prisma.conversa.update({ where: { id: conversaId }, data: { clienteId: ctx.cliente.id } });
      if (ctx.escalonamento) {
        await escalar(conversa, ctx.escalonamento.motivo, { tenant, config, simulacao });
        return { escalonado: true, motivo: ctx.escalonamento.motivo, usedTools: r.usedTools };
      }
      for (const parte of quebrarMensagem(r.text)) await enviarTexto(tenant.id, conversa.telefone, parte, enviarOpts);
      return { texto: r.text, usedTools: r.usedTools };
    }

    // GESTAO
    if (!config.gestaoAtivo) return null;
    const autorizado = await prisma.numeroAutorizado.findUnique({ where: { tenantId_telefone: { tenantId: tenant.id, telefone: conversa.telefone } } });
    if (!autorizado || !autorizado.ativo) return null;
    const ctx = { tenant, autorizado };
    const tools = gestaoAgent.buildTools(ctx);
    const r = await gerarResposta({
      systemPrompt: gestaoAgent.buildSystemPrompt({ tenant, autorizado, ferramentas: tools.map((t) => t.name) }),
      history: await historico(conversaId),
      tools,
    });
    for (const parte of quebrarMensagem(r.text)) await enviarTexto(tenant.id, conversa.telefone, parte, enviarOpts);
    return { texto: r.text, usedTools: r.usedTools };
  } catch (error) {
    log("agentes", "erro_processamento", { conversaId, erro: error.message });
    if (simulacao) throw error;
    return null;
  } finally {
    running.delete(conversaId);
  }
}

function agendar(conversaId, opts = {}) {
  clearTimeout(timers.get(conversaId));
  timers.set(
    conversaId,
    setTimeout(() => {
      timers.delete(conversaId);
      processarConversa(conversaId, opts).catch(() => {});
    }, env.agentBufferSeconds * 1000)
  );
}

// ---------- entrada (webhook) ----------

async function mensagemPropria(conversa, evento) {
  if (evento.messageId) {
    const porId = await prisma.mensagem.findFirst({ where: { externalId: evento.messageId, conversaId: conversa.id } });
    if (porId) return true;
  }
  // provedores podem devolver id diferente no eco: compara texto recente enviado pelo sistema/agente
  const recente = await prisma.mensagem.findFirst({
    where: { conversaId: conversa.id, autor: { in: ["AGENTE", "SISTEMA", "HUMANO"] }, texto: evento.text, createdAt: { gt: new Date(Date.now() - 5 * 60000) } },
  });
  return Boolean(recente);
}

async function processarEvento(tenant, config, evento) {
  if (evento.isGroup || !evento.contato) return { ignorado: "grupo_ou_sem_contato" };
  const contato = normalizePhone(evento.contato);
  const autorizado = config.gestaoAtivo
    ? await prisma.numeroAutorizado.findUnique({ where: { tenantId_telefone: { tenantId: tenant.id, telefone: contato } } })
    : null;
  const canal = autorizado?.ativo ? "GESTAO" : "ATENDIMENTO";
  const conversa = await obterConversa(tenant.id, contato, canal, { nomeContato: evento.profileName || null });

  if (evento.fromMe) {
    if (!evento.text || (await mensagemPropria(conversa, evento))) return { ignorado: "eco" };
    // humano respondeu direto pelo WhatsApp: registra e pausa o agente nesta conversa
    await registrarMensagem(conversa, { autor: "HUMANO", texto: evento.text, externalId: evento.messageId || null });
    await pausar(conversa);
    await prisma.conversa.update({ where: { id: conversa.id }, data: { escalonamentoPendente: false } });
    return { pausado: true };
  }

  if (evento.messageId && (await prisma.mensagem.findFirst({ where: { externalId: evento.messageId, conversaId: conversa.id } }))) {
    return { ignorado: "duplicado" };
  }
  // audio e imagem viram texto para o agente (audio transcrito); antes eram ignorados
  if (evento.media) evento.text = await textoDaMidia(config, evento);
  if (!evento.text) return { ignorado: "sem_texto" };
  if (evento.profileName && !conversa.nomeContato) {
    await prisma.conversa.update({ where: { id: conversa.id }, data: { nomeContato: evento.profileName } });
  }
  await registrarMensagem(conversa, { autor: "CLIENTE", texto: evento.text, externalId: evento.messageId || null });
  agendar(conversa.id);
  return { conversaId: conversa.id, canal };
}

// Aceita o token da URL (?token=, gerado por estabelecimento), o segredo da Uazapi no header
// ou a assinatura X-Hub-Signature-256 da Meta (quando o App Secret foi informado).
function webhookAutorizado({ provider, config, headers, query, rawBody }) {
  const iguais = (a, b) => {
    const x = Buffer.from(String(a || ""));
    const y = Buffer.from(String(b || ""));
    return x.length > 0 && x.length === y.length && require("crypto").timingSafeEqual(x, y);
  };
  if (config.webhookToken && iguais(query.token, config.webhookToken)) return true;
  const wc = config.whatsappConfig || {};
  if (provider === "uazapi" && wc.webhookSecret) {
    if (iguais(headers["x-webhook-secret"] || headers["x-uazapi-secret"] || query.secret, wc.webhookSecret)) return true;
  }
  if (provider === "meta" && wc.appSecret && rawBody) {
    const assinatura = String(headers["x-hub-signature-256"] || "").replace(/^sha256=/, "");
    const esperada = require("crypto").createHmac("sha256", wc.appSecret).update(rawBody).digest("hex");
    if (iguais(assinatura, esperada)) return true;
  }
  return false;
}

async function processarWebhook({ tenantSlug, provider, payload, headers = {}, query = {}, rawBody = null }) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) throw Object.assign(new Error("Estabelecimento nao encontrado."), { statusCode: 404 });
  const config = await getAgenteConfig(tenant.id);
  if (!webhookAutorizado({ provider, config, headers, query, rawBody })) {
    throw Object.assign(new Error("Webhook nao autorizado."), { statusCode: 401 });
  }
  const eventos = provider === "meta" ? parseMeta(payload) : parseUazapi(payload);
  const resultados = [];
  for (const evento of eventos) resultados.push(await processarEvento(tenant, config, evento));
  return resultados;
}

// ---------- simulador (aba Agentes de IA) ----------

async function simular({ tenantId, telefone, texto, canal }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const contato = normalizePhone(telefone);
  const conversa = await obterConversa(tenantId, contato, canal || "ATENDIMENTO");
  await registrarMensagem(conversa, { autor: "CLIENTE", texto });
  const antes = new Date();
  const resultado = await processarConversa(conversa.id, { simulacao: true });
  const respostas = await prisma.mensagem.findMany({
    where: { conversaId: conversa.id, createdAt: { gte: antes }, autor: { not: "CLIENTE" } },
    orderBy: { createdAt: "asc" },
  });
  return { tenant: tenant.slug, conversaId: conversa.id, respostas, resultado };
}

module.exports = { processarWebhook, processarConversa, pausar, devolverAoAgente, retomarPausasVencidas, enviarMensagemHumano, simular, pausaAtiva };
