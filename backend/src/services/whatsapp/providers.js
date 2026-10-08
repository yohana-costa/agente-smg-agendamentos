// Providers de WhatsApp (mesmos do Gestor SMG varejo): Uazapi e Meta Cloud API.
//
// Datafy: reimplementa o contrato da Meta Cloud API num host proprio (mesmo corpo de
// requisicao), entao e o provider "meta" com graphBaseUrl = https://cloud.datafyapi.com.br/v1.
// Diferencas tratadas aqui (validadas no Adega do Prado e no assist-proto em 09/2026):
//  - o webhook entrega so o elemento de `changes` ({ field, value }), sem o `entry`;
//  - o metadado da midia sai de {raiz}/media/{id} (sem o /v1), nao de /{id};
//  - nao faz o handshake de verify_token (o GET de saude precisa responder 200).
const axios = require("axios");
const env = require("../../config/env");
const { normalizePhone, textOrEmpty, log } = require("../../lib/helpers");
const { createAppError } = require("../../lib/errors");

function uazapiConfig(config = {}) {
  const baseUrl = textOrEmpty(config.baseUrl || env.uazapiBaseUrl).replace(/\/+$/, "");
  const instanceToken = textOrEmpty(config.instanceToken);
  if (!baseUrl || !instanceToken) throw createAppError("WhatsApp (Uazapi) nao configurado: informe baseUrl e instanceToken.", 400);
  return { baseUrl, instanceToken, sendMessagePath: textOrEmpty(config.sendMessagePath) || "/send/text" };
}

async function sendUazapiText(config, { to, text }) {
  const cfg = uazapiConfig(config);
  const destination = normalizePhone(to);
  const variants = [
    { number: destination, text },
    { number: destination, phone: destination, chatId: `${destination}@s.whatsapp.net`, text, message: text, type: "text" },
  ];
  const attempts = [];
  for (const payload of variants) {
    const response = await axios.post(`${cfg.baseUrl}${cfg.sendMessagePath}`, payload, {
      timeout: 30000,
      headers: { "Content-Type": "application/json", token: cfg.instanceToken },
      validateStatus: () => true,
    });
    attempts.push({ status: response.status, message: response?.data?.error || response?.data?.message || null });
    if (response.status >= 200 && response.status < 300) {
      const data = response.data || {};
      return { provider: "uazapi", externalId: String(data.messageid || data.id || data?.message?.messageid || "") || null };
    }
  }
  throw createAppError(`Falha ao enviar mensagem via Uazapi (status ${attempts[attempts.length - 1]?.status}).`, 502, { attempts });
}

function metaConfig(config = {}) {
  const accessToken = textOrEmpty(config.accessToken);
  const phoneNumberId = textOrEmpty(config.phoneNumberId);
  if (!accessToken || !phoneNumberId) throw createAppError("WhatsApp (Meta) nao configurado: informe accessToken e phoneNumberId.", 400);
  return { accessToken, phoneNumberId, graphBaseUrl: (textOrEmpty(config.graphBaseUrl) || env.metaGraphBaseUrl).replace(/\/+$/, "") };
}

async function sendMetaText(config, { to, text }) {
  const cfg = metaConfig(config);
  const response = await axios.post(
    `${cfg.graphBaseUrl}/${encodeURIComponent(cfg.phoneNumberId)}/messages`,
    { messaging_product: "whatsapp", recipient_type: "individual", to: normalizePhone(to), type: "text", text: { body: text } },
    { timeout: 30000, headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" }, validateStatus: () => true }
  );
  if (response.status < 200 || response.status >= 300) {
    log("whatsapp.meta", "send_text.error", { status: response.status, data: response.data });
    throw createAppError(response?.data?.error?.message || `Falha ao enviar via Meta (status ${response.status}).`, 502);
  }
  return { provider: "meta", externalId: response.data?.messages?.[0]?.id || null };
}

// ---------- parsers de webhook (formato normalizado) ----------

function parseUazapi(payload) {
  let body = Array.isArray(payload) ? payload[0] || {} : payload || {};
  if (body?.body && typeof body.body === "object") body = body.body;
  const eventType = String(body?.EventType || body?.event || "").trim().toLowerCase();
  const message = body?.message || {};
  const chat = body?.chat || {};
  if (!eventType || !message) return [];
  const tipoMidia = String(message.messageType || message.mediaType || message.type || "").toLowerCase();
  const media = /audio|ptt|voice/.test(tipoMidia) ? "AUDIO" : /image/.test(tipoMidia) ? "IMAGEM" : null;
  // em midia o "content" costuma vir como objeto/URL criptografada: so legenda conta como texto
  const text = (media ? [message.caption, message.text] : [message.text, message.content, message.caption, body.text]).map(textOrEmpty).find(Boolean) || "";
  const fromMe = Boolean(message.fromMe);
  const contato = normalizePhone(
    fromMe ? message.chatid || chat.wa_chatid || chat.phone : message.sender_pn || message.chatid || message.sender || chat.wa_chatid || chat.phone
  );
  return [
    {
      provider: "uazapi",
      eventType,
      messageId: String(message.messageid || message.id || "").trim(),
      contato,
      fromMe,
      isGroup: Boolean(message.isGroup || chat.wa_isGroup),
      text,
      media: media ? { tipo: media, id: String(message.messageid || message.id || "").trim() } : null,
      profileName: textOrEmpty(message.senderName || chat.name || chat.wa_name),
    },
  ];
}

// Os tres formatos que chegam: Meta { entry: [{ changes: [{ value }] }] }, Datafy { field, value }
// e { changes: [{ value }] }. O conteudo de `value` e identico em todos.
function valoresMeta(payload) {
  if (Array.isArray(payload?.entry)) return payload.entry.flatMap((e) => (e?.changes || []).map((c) => c?.value || {}));
  if (Array.isArray(payload?.changes)) return payload.changes.map((c) => c?.value || {});
  if (payload?.value && typeof payload.value === "object") return [payload.value];
  return [];
}

function parseMeta(payload) {
  const events = [];
  for (const value of valoresMeta(payload)) {
    {
      const contacts = value.contacts || [];
      for (const message of value.messages || []) {
        const text =
          [message?.text?.body, message?.button?.text, message?.interactive?.button_reply?.title, message?.interactive?.list_reply?.title, message?.image?.caption]
            .map(textOrEmpty)
            .find(Boolean) || "";
        const tipo = String(message?.type || "");
        const media =
          tipo === "audio" || tipo === "voice"
            ? { tipo: "AUDIO", id: String(message?.audio?.id || message?.voice?.id || "") }
            : tipo === "image"
              ? { tipo: "IMAGEM", id: String(message?.image?.id || "") }
              : null;
        events.push({
          provider: "meta",
          eventType: "messages",
          messageId: String(message?.id || ""),
          contato: normalizePhone(message?.from || contacts?.[0]?.wa_id),
          fromMe: false,
          isGroup: false,
          text,
          media,
          profileName: textOrEmpty(contacts?.[0]?.profile?.name),
        });
      }
      // Mensagens enviadas pelo proprio numero via app (coexistencia) chegam como message_echoes.
      for (const echo of value.message_echoes || []) {
        events.push({
          provider: "meta",
          eventType: "echo",
          messageId: String(echo?.id || ""),
          contato: normalizePhone(echo?.to),
          fromMe: true,
          isGroup: false,
          text: textOrEmpty(echo?.text?.body),
          profileName: "",
        });
      }
    }
  }
  return events;
}

// ---------- download de midia recebida ----------

// Uazapi: POST /message/download devolve o arquivo em base64 (audio ja convertido para mp3).
async function downloadUazapiMedia(config, messageId) {
  const cfg = uazapiConfig(config);
  const r = await axios.post(
    `${cfg.baseUrl}/message/download`,
    { id: messageId, return_base64: true, generate_mp3: true },
    { timeout: 60000, headers: { "Content-Type": "application/json", token: cfg.instanceToken }, validateStatus: () => true }
  );
  const b64 = r.data?.base64Data || r.data?.base64 || r.data?.data;
  if (r.status >= 200 && r.status < 300 && typeof b64 === "string" && b64) {
    const limpo = b64.includes(",") ? b64.split(",").pop() : b64;
    return { buffer: Buffer.from(limpo, "base64"), mimeType: r.data?.mimetype || r.data?.mimeType || "audio/mpeg" };
  }
  if (r.data?.fileURL) {
    const bin = await axios.get(r.data.fileURL, { responseType: "arraybuffer", timeout: 60000 });
    return { buffer: Buffer.from(bin.data), mimeType: bin.headers["content-type"] || "audio/mpeg" };
  }
  throw createAppError(`Uazapi nao devolveu a midia (status ${r.status}).`, 502);
}

// Meta: GET /{media-id} devolve uma URL temporaria, baixada com o mesmo token.
// Intermediario (Datafy): /{media-id} repassa para a Meta e devolve uma URL que responde 401;
// a rota que funciona e /media/{id} na raiz do host, sem a versao.
async function downloadMetaMedia(config, mediaId) {
  const cfg = metaConfig(config);
  const headers = { Authorization: `Bearer ${cfg.accessToken}` };
  const intermediario = cfg.graphBaseUrl !== env.metaGraphBaseUrl.replace(/\/+$/, "");
  const urlMetadado = intermediario
    ? `${cfg.graphBaseUrl.replace(/\/v\d+(\.\d+)?$/, "")}/media/${encodeURIComponent(mediaId)}`
    : `${cfg.graphBaseUrl}/${encodeURIComponent(mediaId)}`;
  const meta = await axios.get(urlMetadado, { headers, timeout: 30000 });
  const bin = await axios.get(meta.data.url, { headers, responseType: "arraybuffer", timeout: 60000 });
  return { buffer: Buffer.from(bin.data), mimeType: meta.data.mime_type || bin.headers["content-type"] || "audio/ogg" };
}

module.exports = { sendUazapiText, sendMetaText, parseUazapi, parseMeta, downloadUazapiMedia, downloadMetaMedia };
