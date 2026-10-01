const prisma = require("../../lib/prisma");
const env = require("../../config/env");
const events = require("../../lib/events");
const { normalizePhone, textOrEmpty, log } = require("../../lib/helpers");
const { sendUazapiText, sendMetaText } = require("./providers");

async function getAgenteConfig(tenantId) {
  return prisma.agenteConfig.upsert({ where: { tenantId }, update: {}, create: { tenantId } });
}

function conexaoConfigurada(config) {
  const c = config?.whatsappConfig || {};
  if (config?.whatsappProvider === "meta") return Boolean(c.accessToken && c.phoneNumberId);
  return Boolean((c.baseUrl || env.uazapiBaseUrl) && c.instanceToken);
}

async function obterConversa(tenantId, telefone, canal = "ATENDIMENTO", { nomeContato, clienteId } = {}) {
  const phone = normalizePhone(telefone);
  let conversa = await prisma.conversa.findUnique({ where: { tenantId_telefone_canal: { tenantId, telefone: phone, canal } } });
  if (!conversa) {
    let cliente = null;
    if (canal === "ATENDIMENTO") {
      cliente = clienteId
        ? { id: clienteId }
        : await prisma.cliente.findUnique({ where: { tenantId_telefone: { tenantId, telefone: phone } }, select: { id: true } });
    }
    conversa = await prisma.conversa.create({
      data: { tenantId, telefone: phone, canal, clienteId: cliente?.id || null, nomeContato: nomeContato || null },
    });
  } else if (!conversa.clienteId && canal === "ATENDIMENTO") {
    const cliente = clienteId
      ? { id: clienteId }
      : await prisma.cliente.findUnique({ where: { tenantId_telefone: { tenantId, telefone: phone } }, select: { id: true } });
    if (cliente) conversa = await prisma.conversa.update({ where: { id: conversa.id }, data: { clienteId: cliente.id } });
  }
  return conversa;
}

async function registrarMensagem(conversa, { autor, texto, externalId = null }) {
  const mensagem = await prisma.mensagem.create({ data: { conversaId: conversa.id, autor, texto, externalId } });
  await prisma.conversa.update({ where: { id: conversa.id }, data: { ultimaMensagemEm: new Date() } });
  events.publish(conversa.tenantId, "conversa.mensagem", { conversaId: conversa.id, autor });
  return mensagem;
}

// Envia texto pelo WhatsApp do estabelecimento e registra na conversa.
// Nunca lanca erro por falta de configuracao: o envio fica registrado como nao entregue (log).
async function enviarTexto(tenantId, telefone, texto, { autor = "SISTEMA", canal = "ATENDIMENTO", registrar = true, clienteId, simulacao = false } = {}) {
  const to = normalizePhone(telefone);
  const body = textOrEmpty(texto);
  if (!to || !body) return { enviado: false, motivo: "destino_ou_texto_vazio" };

  const config = await getAgenteConfig(tenantId);
  let resultado = { enviado: false, motivo: "whatsapp_nao_configurado", externalId: null };

  if (simulacao) {
    resultado = { enviado: false, motivo: "simulacao", externalId: null };
  } else if (env.whatsappDryRun) {
    resultado = { enviado: false, motivo: "dry_run", externalId: null };
  } else if (conexaoConfigurada(config)) {
    try {
      const sender = config.whatsappProvider === "meta" ? sendMetaText : sendUazapiText;
      const r = await sender(config.whatsappConfig, { to, text: body });
      resultado = { enviado: true, externalId: r.externalId };
    } catch (error) {
      resultado = { enviado: false, motivo: error.message, externalId: null };
    }
  }

  log("whatsapp", resultado.enviado ? "enviado" : "nao_enviado", { tenantId, to, autor, motivo: resultado.motivo, texto: body.slice(0, 120) });

  if (registrar) {
    const conversa = await obterConversa(tenantId, to, canal, { clienteId });
    await registrarMensagem(conversa, { autor, texto: body, externalId: resultado.externalId });
  }
  return resultado;
}

module.exports = { getAgenteConfig, conexaoConfigurada, obterConversa, registrarMensagem, enviarTexto };
