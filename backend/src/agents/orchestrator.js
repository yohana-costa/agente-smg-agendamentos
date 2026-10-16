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
const historicoCoex = require("../services/whatsapp/historico.service");
const atendimentoAgent = require("./atendimento/agent");
const gateway = require("../services/pagamentos/gateway");
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

// Notas guardadas como mensagem SISTEMA que o agente le de outro jeito (ver historico()).
const PREFIXO_AUTOMATICA = "[WhatsApp automatico] ";
const PREFIXO_NOTA = "[Nota interna] ";

const ROTULO_CONSULTA = { duvida: "Duvida", agendamento: "Pedido de horario", atendimento_humano: "Precisa de atendimento" };

// consultar_equipe: a cliente recebe a mensagem natural escrita pelo agente ("Um minutinho, vou
// confirmar isso com a doutora."), e a pergunta vai para o numero de escalonamento. Quando a
// doutora responde citando essa mensagem, a resposta volta como nota interna e o agente segue
// a conversa (ver responderConsulta).
async function escalar(conversa, motivo, { tenant, config, simulacao = false, tipo = "atendimento_humano", mensagemCliente = null }) {
  await enviarTexto(tenant.id, conversa.telefone, mensagemCliente || config.mensagemEscalonamento, { autor: "AGENTE", simulacao });
  let consultaMsgId = null;
  const destino = normalizePhone(config.numeroEscalonamento);
  const mesmoNumero = destino && [...variantesTelefone(destino)].some((v) => variantesTelefone(config.whatsappNumero).has(v));
  if (destino && mesmoNumero) log("agentes", "escalonamento_para_o_proprio_numero", { tenantId: tenant.id });
  if (destino && !mesmoNumero && !simulacao) {
    const cliente = conversa.clienteId ? await prisma.cliente.findUnique({ where: { id: conversa.clienteId } }) : null;
    const nome = cliente?.nome || conversa.nomeContato || "Cliente";
    const r = await enviarTexto(
      tenant.id,
      destino,
      `${ROTULO_CONSULTA[tipo] || "Atendimento"} de ${nome} (${conversa.telefone}):\n${motivo}\n\nResponda ESTA mensagem (segure e toque em Responder) que eu repasso para a cliente. Ou fale com ela direto pela aba Atendimento.`,
      { autor: "SISTEMA", registrar: false }
    );
    consultaMsgId = r.externalId || null;
  }
  await pausar(conversa, { escalonar: true, motivo });
  if (consultaMsgId) await prisma.conversa.update({ where: { id: conversa.id }, data: { consultaMsgId } });
  log("agentes", "escalonado", { conversaId: conversa.id, tipo, motivo });
}

// Resposta da equipe vinda do numero de escalonamento. Casa pela mensagem citada; sem citacao,
// so se houver uma unica pergunta pendente. Devolve null quando a mensagem nao e resposta.
async function responderConsulta(tenant, config, evento) {
  const destino = normalizePhone(config.numeroEscalonamento);
  if (!destino) return null;
  const doEscalonamento = [...variantesTelefone(evento.contato)].some((v) => variantesTelefone(destino).has(v));
  if (!doEscalonamento) return null;
  const pendentes = await prisma.conversa.findMany({
    where: { tenantId: tenant.id, canal: "ATENDIMENTO", escalonamentoPendente: true },
    orderBy: { escalonadoEm: "desc" },
  });
  if (pendentes.length === 0) return null;
  if (evento.media && !evento.text) evento.text = await textoDaMidia(config, evento);
  if (!evento.text) return null;
  let alvo = evento.quotedId ? pendentes.find((c) => c.consultaMsgId && c.consultaMsgId === evento.quotedId) : null;
  if (!alvo && pendentes.length === 1) alvo = pendentes[0];
  if (!alvo) {
    await enviarTexto(tenant.id, destino, "Tem mais de uma pergunta esperando resposta. Responda segurando a mensagem da pergunta e tocando em Responder, para eu saber de qual cliente e.", {
      autor: "SISTEMA",
      registrar: false,
    });
    return { ignorado: "consulta_ambigua" };
  }
  await registrarMensagem(alvo, { autor: "SISTEMA", texto: `${PREFIXO_NOTA}Resposta da equipe: ${evento.text}` });
  await prisma.conversa.update({ where: { id: alvo.id }, data: { escalonamentoPendente: false, consultaMsgId: null } });
  await devolverAoAgente(alvo.id);
  log("agentes", "consulta_respondida", { conversaId: alvo.id });
  processarConversa(alvo.id).catch(() => {});
  return { consultaRespondida: alvo.id };
}

// ---------- processamento ----------

// O WhatsApp nao entende markdown: [texto](url) aparece quebrado e **negrito** mostra os asteriscos.
// Converte aqui, sem depender de o modelo obedecer a instrucao do prompt.
function formatoWhatsApp(texto) {
  return String(texto || "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, rotulo, url) => (rotulo.trim() === url ? url : `${rotulo.trim()}: ${url}`))
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+/gm, "");
}

// No maximo 4 mensagens no WhatsApp. O que passa disso vai junto na ultima: cortar fazia
// sumir o fim da resposta (inclusive o link do site que o sistema acrescenta no final).
function quebrarMensagem(texto) {
  const partes = formatoWhatsApp(texto)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return partes.length <= 4 ? partes : [...partes.slice(0, 3), partes.slice(3).join("\n\n")];
}

// Frases de encerramento prontas que o modelo insiste em usar mesmo proibidas no prompt
// (teste de 15/10/2026). A frase inteira sai; se sobrar nada, nada e enviado.
const FRASES_PRONTAS = [
  /se precisar de (mais )?(alguma coisa|algo|mais alguma|ajuda|outra)/i,
  /(estou|fico|sigo|estamos|ficamos) (a|à) (sua )?disposi/i,
  /(é|e) s(ó|o) (me )?(chamar|avisar|falar|mandar mensagem)/i,
  /tenha um (ótimo|otimo|excelente|bom|lindo) (dia|tarde|fim)/i,
  /fico (muito )?feliz em (te )?ajudar/i,
  /ser(á|a) um prazer (te )?(atender|receber)/i,
  /qualquer (d(ú|u)vida|coisa),? (é|e) s(ó|o)/i,
];

function limparFrasesProntas(texto) {
  let emojis = 0;
  const paragrafos = String(texto || "")
    .split(/\n{2,}/)
    .map((par) =>
      par
        .split("\n")
        .map((linha) =>
          linha
            .split(/(?<=[.!?])\s+/)
            .filter((frase) => !FRASES_PRONTAS.some((re) => re.test(frase)))
            .join(" ")
        )
        .filter((linha) => linha.trim())
        .join("\n")
    )
    .filter((par) => par.trim());
  // no maximo 1 emoji por resposta
  return paragrafos
    .join("\n\n")
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, (e) => (++emojis > 1 ? "" : e))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

async function historico(conversaId) {
  const msgs = await prisma.mensagem.findMany({ where: { conversaId }, orderBy: { createdAt: "desc" }, take: env.agentHistoryLimit });
  return msgs.reverse().map((m) => {
    const texto = String(m.texto || "");
    if (m.autor === "SISTEMA" && texto.startsWith(PREFIXO_NOTA)) {
      return { role: "system", content: `Nota interna (a cliente NAO viu; repasse com suas palavras): ${texto.slice(PREFIXO_NOTA.length)}` };
    }
    if (m.autor === "SISTEMA" && texto.startsWith(PREFIXO_AUTOMATICA)) {
      return { role: "system", content: `Mensagem automatica do WhatsApp do estabelecimento, ja recebida pela cliente (nao repita o conteudo): ${texto.slice(PREFIXO_AUTOMATICA.length)}` };
    }
    return {
      role: m.autor === "CLIENTE" ? "user" : "assistant",
      content: m.autor === "HUMANO" ? `[Atendente humano]: ${texto}` : m.autor === "SISTEMA" ? `[Mensagem automatica do sistema]: ${texto}` : texto,
    };
  });
}

// Celular brasileiro chega com ou sem o 9 depois do DDD (55 + DDD + 9 + 8 digitos).
function variantesTelefone(telefone) {
  const d = normalizePhone(telefone);
  const v = new Set([d]);
  if (/^55\d{2}9\d{8}$/.test(d)) v.add(d.slice(0, 4) + d.slice(5));
  if (/^55\d{2}\d{8}$/.test(d)) v.add(d.slice(0, 4) + "9" + d.slice(4));
  return v;
}

function liberadoNoModoTeste(config, telefone) {
  const lista = config.numerosTesteIa || [];
  if (lista.length === 0) return true;
  const alvo = variantesTelefone(telefone);
  return lista.some((n) => [...variantesTelefone(n)].some((x) => alvo.has(x)));
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
      if (!simulacao && !liberadoNoModoTeste(config, conversa.telefone)) {
        log("agentes", "fora_do_modo_teste", { conversaId });
        return null;
      }
      if (pausaAtiva(conversa)) {
        log("agentes", "conversa_pausada", { conversaId });
        return null;
      }
      if (conversa.status !== "ATIVO") await devolverAoAgente(conversaId);

      // Sem Mercado Pago o cliente nao conclui agendamento (nem pelo site): o agente leva o pedido
      // para a equipe em vez de mandar link. O link so vai quando faz sentido e uma vez so (o
      // "link forcado" em toda resposta foi retirado a pedido do estabelecimento, 16/10/2026).
      const linkSite = `${env.publicAppUrl}/s/${tenant.slug}`;
      const pagamentoDisponivel = gateway.modo(tenant) !== "desconectado";
      const linkJaEnviado = Boolean(
        await prisma.mensagem.findFirst({ where: { conversaId, autor: { not: "CLIENTE" }, texto: { contains: linkSite } }, select: { id: true } })
      );
      const ultimaDaCliente = await prisma.mensagem.findFirst({ where: { conversaId, autor: "CLIENTE" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });

      const ctx = { tenant, config, telefone: conversa.telefone, cliente: null, escalonamento: null, pagamentoDisponivel };
      ctx.cliente = conversa.clienteId ? await prisma.cliente.findUnique({ where: { id: conversa.clienteId } }) : null;
      const r = await gerarResposta({
        systemPrompt: atendimentoAgent.buildSystemPrompt({ tenant, config, cliente: ctx.cliente, pagamentoDisponivel, linkJaEnviado }),
        history: await historico(conversaId),
        tools: atendimentoAgent.buildTools(ctx),
        shouldStop: () => Boolean(ctx.escalonamento),
        apiKey: config.openaiApiKey,
        model: config.openaiModel,
      });
      if (ctx.cliente && !conversa.clienteId) await prisma.conversa.update({ where: { id: conversaId }, data: { clienteId: ctx.cliente.id } });

      // A cliente mandou outra mensagem enquanto a resposta era gerada: essa resposta ja nasceu
      // velha (ex.: "De nada, tenha um otimo dia" depois de ela perguntar outra coisa). Descarta e
      // responde tudo junto na proxima rodada. So nao descarta se uma ferramenta ja mudou algo.
      const mudouAlgo = (r.usedTools || []).some((t) => t.ok && ["criar_agendamento", "cancelar_agendamento", "reagendar_agendamento"].includes(t.name));
      if (!simulacao && !mudouAlgo && !ctx.escalonamento && ultimaDaCliente) {
        const nova = await prisma.mensagem.findFirst({ where: { conversaId, autor: "CLIENTE", createdAt: { gt: ultimaDaCliente.createdAt } }, select: { id: true } });
        if (nova) {
          log("agentes", "resposta_descartada_nova_mensagem", { conversaId });
          agendar(conversaId);
          return { descartada: true };
        }
      }
      if (ctx.escalonamento) {
        await escalar(conversa, ctx.escalonamento.motivo, { tenant, config, simulacao, tipo: ctx.escalonamento.tipo, mensagemCliente: ctx.escalonamento.mensagemCliente });
        return { escalonado: true, motivo: ctx.escalonamento.motivo, usedTools: r.usedTools };
      }
      const texto = limparFrasesProntas(r.text);
      for (const parte of quebrarMensagem(texto)) await enviarTexto(tenant.id, conversa.telefone, parte, enviarOpts);
      return { texto, usedTools: r.usedTools };
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
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
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

// Saudacao e mensagem de ausencia do WhatsApp Business saem do celular sozinhas, segundos depois da
// mensagem da cliente, e chegavam como "humano respondeu": pausavam a IA e a cliente ficava sem
// resposta (teste de 15/10/2026). Automatica = ate 15s depois da cliente, ou ate 2 min se o mesmo
// texto ja saiu do celular em outra conversa.
async function ehMensagemAutomaticaDoCelular(conversa, texto) {
  const ultimaDaCliente = await prisma.mensagem.findFirst({ where: { conversaId: conversa.id, autor: "CLIENTE" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (!ultimaDaCliente) return false;
  const segundos = (Date.now() - new Date(ultimaDaCliente.createdAt).getTime()) / 1000;
  if (segundos <= 15) return true;
  if (segundos > 120) return false;
  const repetida = await prisma.mensagem.findFirst({
    where: {
      conversa: { tenantId: conversa.tenantId },
      conversaId: { not: conversa.id },
      autor: { in: ["HUMANO", "SISTEMA"] },
      texto: { in: [texto, `${PREFIXO_AUTOMATICA}${texto}`] },
    },
    select: { id: true },
  });
  return Boolean(repetida);
}

async function processarEvento(tenant, config, evento) {
  if (evento.isGroup || !evento.contato) return { ignorado: "grupo_ou_sem_contato" };
  const contato = normalizePhone(evento.contato);

  // Resposta da doutora/equipe a uma pergunta do agente (consultar_equipe)
  if (!evento.fromMe) {
    const consulta = await responderConsulta(tenant, config, evento);
    if (consulta) return consulta;
  }
  const autorizado = config.gestaoAtivo
    ? await prisma.numeroAutorizado.findUnique({ where: { tenantId_telefone: { tenantId: tenant.id, telefone: contato } } })
    : null;
  const canal = autorizado?.ativo ? "GESTAO" : "ATENDIMENTO";
  const conversa = await obterConversa(tenant.id, contato, canal, { nomeContato: evento.profileName || null });

  if (evento.fromMe) {
    if (!evento.text || (await mensagemPropria(conversa, evento))) return { ignorado: "eco" };
    if (await ehMensagemAutomaticaDoCelular(conversa, evento.text)) {
      await registrarMensagem(conversa, { autor: "SISTEMA", texto: `${PREFIXO_AUTOMATICA}${evento.text}`, externalId: evento.messageId || null });
      return { automatica: true };
    }
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
  // Historico da coexistencia e mensagem antiga: guarda antes de responder (erro aqui vira 500
  // e a Datafy reenvia). Nao passa pelo agente: nao pausa conversa nem gera resposta.
  if (provider === "meta" && (historicoCoex.ehEventoHistorico(payload) || historicoCoex.ehEntregaAntiga(payload))) {
    await historicoCoex.guardarBruto({ tenantId: tenant.id, payload, headers });
    setImmediate(() => historicoCoex.processarPendentes(tenant.id));
    return [{ historico: true }];
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
