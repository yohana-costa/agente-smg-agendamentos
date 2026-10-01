// Providers de WhatsApp (mesmos do Gestor SMG varejo): Uazapi e Meta Cloud API.
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
  const text = [message.text, message.content, message.caption, body.text].map(textOrEmpty).find(Boolean) || "";
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
      profileName: textOrEmpty(message.senderName || chat.name || chat.wa_name),
    },
  ];
}

function parseMeta(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const contacts = value.contacts || [];
      for (const message of value.messages || []) {
        const text =
          [message?.text?.body, message?.button?.text, message?.interactive?.button_reply?.title, message?.interactive?.list_reply?.title, message?.image?.caption]
            .map(textOrEmpty)
            .find(Boolean) || "";
        events.push({
          provider: "meta",
          eventType: "messages",
          messageId: String(message?.id || ""),
          contato: normalizePhone(message?.from || contacts?.[0]?.wa_id),
          fromMe: false,
          isGroup: false,
          text,
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

module.exports = { sendUazapiText, sendMetaText, parseUazapi, parseMeta };
