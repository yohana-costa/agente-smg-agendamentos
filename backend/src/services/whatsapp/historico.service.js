// Historico da coexistencia (Datafy / Meta Cloud API), mesmo desenho do Adega do Prado.
//
// Quando o numero e conectado por coexistencia, as conversas antigas ficam so no app do
// celular. Um pedido unico (POST /v1/{phone_number_id}/smb_app_data, em ate 24h da conexao)
// faz a Meta mandar ate 180 dias de conversa pelo webhook, com field "history", em milhares
// de blocos fora de ordem.
//
// O pedido nao se repete, entao perder um bloco e perder aquela parte do historico:
//  - o bloco cru e GRAVADO antes de responder: se o banco falhar, o webhook devolve 500 e a
//    Datafy reenvia (10s, 1min, 5min, 30min);
//  - idempotente pelo x-datafy-delivery-id (sem ele, pelo hash do corpo);
//  - virar conversa e outra etapa (processarPendentes), que pode ser refeita sem duplicar,
//    porque cada mensagem e conferida pelo wamid (externalId).
//
// Mensagem ANTIGA chegando pelo canal normal (messages / message_echoes com mais de 1h) e
// tratada igual: no Adega a midia do historico chegou assim, e tratada como mensagem de agora
// pausou o agente e entrou com a data de hoje. Reentrega da Datafy chega em no maximo ~36 min.
const crypto = require("crypto");
const prisma = require("../../lib/prisma");
const events = require("../../lib/events");
const { normalizePhone, log } = require("../../lib/helpers");

const IDADE_MAXIMA_AO_VIVO_S = 60 * 60;
const LOTE = 25;

function valoresDoEvento(payload) {
  if (Array.isArray(payload?.entry)) return payload.entry.flatMap((e) => (e?.changes || []).map((c) => c?.value || {}));
  if (Array.isArray(payload?.changes)) return payload.changes.map((c) => c?.value || {});
  if (payload?.value && typeof payload.value === "object") return [payload.value];
  return [];
}

function ehEventoHistorico(payload) {
  if (payload?.field === "history") return true;
  const changes = [...(payload?.entry || []).flatMap((e) => e?.changes || []), ...(payload?.changes || [])];
  if (changes.some((c) => c?.field === "history")) return true;
  return valoresDoEvento(payload).some((v) => Array.isArray(v?.history));
}

function ehEntregaAntiga(payload) {
  const itens = valoresDoEvento(payload).flatMap((v) => [...(v?.messages || []), ...(v?.message_echoes || [])]);
  if (itens.length === 0) return false;
  const agora = Date.now() / 1000;
  return itens.every((m) => {
    const ts = Number(m?.timestamp);
    return Number.isFinite(ts) && ts > 0 && agora - ts > IDADE_MAXIMA_AO_VIVO_S;
  });
}

async function guardarBruto({ tenantId, payload, headers = {} }) {
  const deliveryId = String(headers["x-datafy-delivery-id"] || "").trim();
  const chave = deliveryId || "sha256:" + crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const blocos = valoresDoEvento(payload).flatMap((v) => (Array.isArray(v?.history) ? v.history : []));
  const meta = blocos[0]?.metadata || {};
  const numero = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  const existente = await prisma.whatsappHistoricoBruto.findUnique({ where: { tenantId_chave: { tenantId, chave } }, select: { id: true } });
  if (!existente) {
    await prisma.whatsappHistoricoBruto.create({
      data: { tenantId, chave, phase: numero(meta.phase), chunkOrder: numero(meta.chunk_order), progress: numero(meta.progress), payload },
    });
  }
  const threads = blocos.flatMap((b) => b?.threads || []);
  log("whatsapp.historico", existente ? "bloco_repetido" : "bloco_gravado", {
    tenantId,
    phase: meta.phase,
    chunkOrder: meta.chunk_order,
    progress: meta.progress,
    conversas: threads.length,
    mensagens: threads.reduce((s, t) => s + (t?.messages?.length || 0), 0),
  });
  if (Number(meta.progress) === 100) log("whatsapp.historico", "progress_100", { tenantId });
}

// ---------- bloco cru -> conversa ----------

const ROTULO = {
  media_placeholder: "[Mídia do histórico: o arquivo não é sincronizado]",
  image: "[Imagem]",
  video: "[Vídeo]",
  audio: "[Áudio]",
  voice: "[Áudio]",
  document: "[Documento]",
  sticker: "[Figurinha]",
  location: "[Localização]",
  contacts: "[Contato]",
};

function textoDe(m) {
  const texto = [m?.text?.body, m?.button?.text, m?.interactive?.button_reply?.title, m?.interactive?.list_reply?.title]
    .map((v) => String(v || "").trim())
    .find(Boolean);
  if (texto) return texto;
  const legenda = String(m?.image?.caption || m?.video?.caption || m?.document?.caption || "").trim();
  const rotulo = ROTULO[m?.type] || (m?.type ? `[${m.type}]` : "");
  return [rotulo, legenda].filter(Boolean).join(" ");
}

function extrair(payload, numeroLoja) {
  const itens = [];
  for (const value of valoresDoEvento(payload)) {
    const loja = normalizePhone(value?.metadata?.display_phone_number) || numeroLoja;
    for (const bloco of value?.history || []) {
      for (const thread of bloco?.threads || []) {
        const contato = normalizePhone(thread?.id);
        for (const m of thread?.messages || []) {
          const daLoja = Boolean(m?.history_context?.from_me) || normalizePhone(m?.from) === loja;
          itens.push({ m, contato, autor: daLoja ? "HUMANO" : "CLIENTE" });
        }
      }
    }
    for (const m of value?.messages || []) itens.push({ m, contato: normalizePhone(m?.from), autor: "CLIENTE" });
    for (const m of value?.message_echoes || []) itens.push({ m, contato: normalizePhone(m?.to), autor: "HUMANO" });
  }
  // so conversa individual (grupo nao entra no atendimento)
  return itens.filter((x) => x.contato && x.contato.length >= 10 && x.contato.length <= 15 && x.m?.type !== "reaction");
}

async function importarLinha(tenantId, linha, numeroLoja, autorizados) {
  const porConversa = new Map();
  for (const x of extrair(linha.payload, numeroLoja)) {
    const texto = textoDe(x.m);
    const ts = Number(x.m?.timestamp);
    if (!texto || !Number.isFinite(ts) || ts <= 0) continue;
    const canal = autorizados.has(x.contato) ? "GESTAO" : "ATENDIMENTO";
    const k = `${canal}|${x.contato}`;
    if (!porConversa.has(k)) porConversa.set(k, { canal, contato: x.contato, msgs: [] });
    porConversa.get(k).msgs.push({ autor: x.autor, texto, externalId: x.m?.id ? String(x.m.id) : null, createdAt: new Date(ts * 1000) });
  }

  let criadas = 0;
  for (const { canal, contato, msgs } of porConversa.values()) {
    const { obterConversa } = require("./whatsapp.service");
    const conversa = await obterConversa(tenantId, contato, canal);
    const ids = msgs.map((m) => m.externalId).filter(Boolean);
    const jaTem = new Set(
      (await prisma.mensagem.findMany({ where: { conversaId: conversa.id, externalId: { in: ids } }, select: { externalId: true } })).map((m) => m.externalId)
    );
    const vistos = new Set();
    const novas = msgs.filter((m) => {
      if (!m.externalId) return true;
      if (jaTem.has(m.externalId) || vistos.has(m.externalId)) return false;
      vistos.add(m.externalId);
      return true;
    });
    if (novas.length === 0) continue;
    const criadaAgora = (await prisma.mensagem.count({ where: { conversaId: conversa.id } })) === 0;
    await prisma.mensagem.createMany({ data: novas.map((m) => ({ conversaId: conversa.id, ...m })) });
    criadas += novas.length;
    // Conversa que so existe pelo historico fica com a data da ultima mensagem dela (senao
    // nasceria com a data de hoje e subiria para o topo da lista). Nas demais a data so avanca.
    const maisRecente = new Date(Math.max(...novas.map((m) => m.createdAt.getTime())));
    if (criadaAgora || maisRecente > conversa.ultimaMensagemEm) {
      await prisma.conversa.update({ where: { id: conversa.id }, data: { ultimaMensagemEm: maisRecente } });
    }
  }
  return criadas;
}

// Uma fila por estabelecimento: os blocos chegam aos milhares e em paralelo.
const filas = new Map();

function processarPendentes(tenantId) {
  const anterior = filas.get(tenantId) || Promise.resolve();
  const proxima = anterior.then(() => processarAgora(tenantId)).catch((error) => log("whatsapp.historico", "erro_processar", { tenantId, erro: error.message }));
  filas.set(tenantId, proxima);
  proxima.finally(() => filas.get(tenantId) === proxima && filas.delete(tenantId));
  return proxima;
}

async function processarAgora(tenantId) {
  const config = await prisma.agenteConfig.findUnique({ where: { tenantId }, select: { whatsappNumero: true } });
  const numeroLoja = normalizePhone(config?.whatsappNumero);
  const autorizados = new Set(
    (await prisma.numeroAutorizado.findMany({ where: { tenantId, ativo: true }, select: { telefone: true } })).map((n) => n.telefone)
  );
  let total = 0;
  for (;;) {
    const linhas = await prisma.whatsappHistoricoBruto.findMany({
      where: { tenantId, processadoEm: null },
      orderBy: [{ phase: "asc" }, { chunkOrder: "asc" }, { createdAt: "asc" }],
      take: LOTE,
    });
    if (linhas.length === 0) break;
    for (const linha of linhas) {
      try {
        total += await importarLinha(tenantId, linha, numeroLoja, autorizados);
        await prisma.whatsappHistoricoBruto.update({ where: { id: linha.id }, data: { processadoEm: new Date(), erro: null } });
      } catch (error) {
        // marca como processada com o erro para nao travar a fila; reprocessar = limpar processadoEm
        await prisma.whatsappHistoricoBruto.update({ where: { id: linha.id }, data: { processadoEm: new Date(), erro: String(error.message).slice(0, 500) } });
        log("whatsapp.historico", "erro_linha", { tenantId, linha: linha.id, erro: error.message });
      }
    }
  }
  if (total) {
    log("whatsapp.historico", "importado", { tenantId, mensagens: total });
    events.publish(tenantId, "conversa.mensagem", { historico: true });
  }
  return total;
}

module.exports = { ehEventoHistorico, ehEntregaAntiga, guardarBruto, processarPendentes, extrair, textoDe };
