// Midia recebida no WhatsApp (mesma ideia do Gestor SMG varejo): audio vira texto pela
// transcricao da OpenAI; imagem vira um aviso para o agente, com a legenda se houver.
// Sem isso o cliente que manda audio simplesmente ficava sem resposta.
const axios = require("axios");
const env = require("../../config/env");
const { downloadUazapiMedia, downloadMetaMedia } = require("./providers");
const { log } = require("../../lib/helpers");

const AUDIO_FALHOU = "[O cliente enviou um áudio que não foi possível ouvir. Peça, com educação, para ele escrever a mensagem.]";

function extensao(mimeType) {
  if (/mpeg|mp3/.test(mimeType)) return "mp3";
  if (/mp4|m4a|aac/.test(mimeType)) return "m4a";
  if (/wav/.test(mimeType)) return "wav";
  if (/webm/.test(mimeType)) return "webm";
  return "ogg";
}

async function transcrever(buffer, mimeType) {
  if (!env.openaiApiKey) return null;
  const tipo = String(mimeType || "audio/ogg").split(";")[0];
  const form = new FormData();
  form.append("model", env.openaiTranscribeModel);
  form.append("language", "pt");
  form.append("response_format", "json");
  // FormData/Blob nativos do Node 20 (axios 1.x envia direto, sem depender do pacote form-data)
  form.append("file", new Blob([buffer], { type: tipo }), `audio.${extensao(tipo)}`);
  const r = await axios.post(`${env.openaiBaseUrl.replace(/\/$/, "")}/audio/transcriptions`, form, {
    headers: { Authorization: `Bearer ${env.openaiApiKey}` },
    timeout: 120000,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) {
    log("midia", "transcricao_erro", { status: r.status, erro: JSON.stringify(r.data).slice(0, 300) });
    return null;
  }
  return String(r.data?.text || "").trim() || null;
}

/** Texto que o agente vai ler no lugar da midia. */
async function textoDaMidia(config, evento) {
  const { tipo, id } = evento.media || {};
  const legenda = String(evento.text || "").trim();
  if (tipo === "IMAGEM") {
    return legenda ? `[O cliente enviou uma imagem com a legenda]: ${legenda}` : "[O cliente enviou uma imagem sem texto.]";
  }
  if (tipo !== "AUDIO" || !id) return legenda;
  try {
    const wc = config.whatsappConfig || {};
    const arquivo = evento.provider === "meta" ? await downloadMetaMedia(wc, id) : await downloadUazapiMedia(wc, id);
    const texto = await transcrever(arquivo.buffer, arquivo.mimeType);
    return texto ? `[Áudio do cliente, transcrito]: ${texto}` : AUDIO_FALHOU;
  } catch (error) {
    log("midia", "audio_falhou", { provider: evento.provider, erro: error.message });
    return AUDIO_FALHOU;
  }
}

module.exports = { textoDaMidia };
