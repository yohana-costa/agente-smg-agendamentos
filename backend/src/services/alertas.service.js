// Assistente pessoal: avisos para a dona/equipe pelo WhatsApp conectado do estabelecimento.
//
// Regra da Meta (API oficial, ex.: Datafy): texto livre so dentro de 24h depois que a pessoa
// mandou mensagem para o numero; fora disso, so template aprovado (e pago). Por isso:
//  - todo dia sai UM template (resumo diario) com o botao "Ver alertas";
//  - tocar no botao (ou escrever "alertas") abre a janela e entrega tudo que estava pendente;
//  - com a janela aberta, cada aviso vai na hora, como texto, de graca;
//  - com a janela fechada, so o urgente (duvida da IA, atendimento humano) usa o template
//    "urgente"; o resto espera o proximo resumo ou o "Ver alertas".
// Uazapi nao tem essa regra: tudo vai como texto.
// Os avisos tambem ficam no painel (tabela Alerta), independente do WhatsApp.
const prisma = require("../lib/prisma");
const { normalizePhone, log, brl } = require("../lib/helpers");
const { todayStr, dayRangeUtc, addDays, zonedParts } = require("../lib/time");
const { getAgenteConfig, obterConversa, registrarMensagem, enviarTexto } = require("./whatsapp/whatsapp.service");
const { sendMetaTemplate, criarTemplateMeta, listarTemplatesMeta } = require("./whatsapp/providers");

const TIPOS = ["NOVO_AGENDAMENTO", "CANCELAMENTO", "EQUIPE", "RESUMO_DIARIO"];
const TEMPLATE_RESUMO = "smg_resumo_diario";
const TEMPLATE_URGENTE = "smg_alerta_urgente";
const JANELA_MS = 23.5 * 3600 * 1000; // margem de 30 min antes das 24h da Meta

const PALAVRAS_VER = /^(ver alertas|alertas|avisos|ver avisos|resumo)$/i;

// ---------- numeros ----------

// Celular brasileiro chega com ou sem o 9 depois do DDD.
function variantes(telefone) {
  const d = normalizePhone(telefone);
  const v = new Set([d]);
  if (/^55\d{2}9\d{8}$/.test(d)) v.add(d.slice(0, 4) + d.slice(5));
  if (/^55\d{2}\d{8}$/.test(d)) v.add(d.slice(0, 4) + "9" + d.slice(4));
  return v;
}

function numerosDeAlerta(config) {
  return [...new Set((config.alertasNumeros || []).map(normalizePhone).filter(Boolean))];
}

function ehNumeroDeAlerta(config, telefone) {
  const alvo = variantes(telefone);
  return numerosDeAlerta(config).some((n) => [...variantes(n)].some((x) => alvo.has(x)));
}

function tipoAtivo(config, tipo) {
  return tipo === "TESTE" || (config.alertasTipos || TIPOS).includes(tipo);
}

const usaTemplate = (config) => config.whatsappProvider === "meta";

async function janelaAberta(tenantId, config, numero) {
  if (!usaTemplate(config)) return true;
  const ultima = await prisma.mensagem.findFirst({
    where: {
      autor: "CLIENTE",
      createdAt: { gt: new Date(Date.now() - JANELA_MS) },
      conversa: { tenantId, telefone: { in: [...variantes(numero)] } },
    },
    select: { id: true },
  });
  return Boolean(ultima);
}

// ---------- envio ----------

async function enviarTextoAlerta(tenantId, numero, texto) {
  return enviarTexto(tenantId, numero, texto, { autor: "SISTEMA", canal: "GESTAO" });
}

async function enviarTemplateAlerta(tenantId, config, numero, nome, params, resumoTexto) {
  const r = await sendMetaTemplate(config.whatsappConfig, { to: numero, name: nome, params });
  const conversa = await obterConversa(tenantId, numero, "GESTAO");
  await registrarMensagem(conversa, { autor: "SISTEMA", texto: resumoTexto, externalId: r.externalId });
  return r;
}

const umaLinha = (t) => String(t || "").replace(/\s+/g, " ").trim();

function textoCompleto(alerta) {
  return `🔔 ${alerta.titulo}\n${alerta.texto}`;
}

// Liga a pergunta da IA a mensagem que foi para a doutora: quando ela responde citando essa
// mensagem, o orchestrator acha a conversa da cliente por consultaMsgId.
async function amarrarConsulta(alerta, externalId) {
  if (alerta.conversaId && externalId) {
    await prisma.conversa.update({ where: { id: alerta.conversaId }, data: { consultaMsgId: externalId } }).catch(() => null);
  }
}

/**
 * Registra um aviso (sempre aparece no painel) e tenta entregar no WhatsApp.
 * Nunca lanca erro: aviso que falha fica pendente para o proximo "Ver alertas".
 */
async function registrarAlerta(tenantId, { tipo, titulo, texto, urgente = false, conversaId = null }) {
  try {
    const config = await getAgenteConfig(tenantId);
    const alerta = await prisma.alerta.create({ data: { tenantId, tipo, titulo, texto, urgente, conversaId } });
    if (!tipoAtivo(config, tipo)) return alerta;
    const numeros = numerosDeAlerta(config);
    if (!numeros.length) return alerta;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { nome: true } });
    let entregue = false;
    let template = false;
    for (const numero of numeros) {
      try {
        if (await janelaAberta(tenantId, config, numero)) {
          const r = await enviarTextoAlerta(tenantId, numero, textoCompleto(alerta));
          if (r.enviado) {
            entregue = true;
            await amarrarConsulta(alerta, r.externalId);
          }
        } else if (urgente) {
          const r = await enviarTemplateAlerta(tenantId, config, numero, TEMPLATE_URGENTE, [tenant?.nome || "estabelecimento", umaLinha(`${titulo}: ${texto}`).slice(0, 300)], `[Template urgente] ${titulo}`);
          template = true;
          await amarrarConsulta(alerta, r.externalId);
        }
      } catch (error) {
        log("alertas", "envio_falhou", { tenantId, tipo, numero, erro: error.message });
      }
    }
    if (entregue || template) {
      await prisma.alerta.update({ where: { id: alerta.id }, data: entregue ? { enviadoEm: new Date() } : { templateEm: new Date() } });
    }
    return alerta;
  } catch (error) {
    log("alertas", "registrar_falhou", { tenantId, tipo, erro: error.message });
    return null;
  }
}

// ---------- resumo diario ----------

async function montarResumo(tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { nome: true, timezone: true } });
  const tz = tenant?.timezone || "America/Sao_Paulo";
  const hoje = todayStr(tz);
  const ontem = addDays(hoje, -1);
  const rHoje = dayRangeUtc(hoje, tz);
  const rOntem = dayRangeUtc(ontem, tz);

  const [deHoje, concluidosOntem, aguardando, produtosBaixos, materiais, pendentes] = await Promise.all([
    prisma.agendamento.findMany({
      where: { tenantId, status: { in: ["CONFIRMADO", "EM_ATENDIMENTO"] }, inicio: { gte: rHoje.start, lt: rHoje.end } },
      select: { inicio: true },
      orderBy: { inicio: "asc" },
    }),
    prisma.agendamento.findMany({
      where: { tenantId, status: "CONCLUIDO", inicio: { gte: rOntem.start, lt: rOntem.end } },
      select: { valorTotal: true },
    }),
    prisma.agendamento.count({ where: { tenantId, status: "AGUARDANDO_PAGAMENTO", expiraEm: { gt: new Date() } } }),
    prisma.produto.findMany({ where: { tenantId, ativo: true, estoqueMinimo: { gt: 0 } }, select: { nome: true, estoque: true, estoqueMinimo: true } }),
    prisma.material.findMany({ where: { tenantId, ativo: true, minimo: { gt: 0 } }, select: { nome: true, quantidade: true, minimo: true } }),
    prisma.alerta.count({ where: { tenantId, enviadoEm: null, tipo: { not: "RESUMO_DIARIO" }, createdAt: { gt: new Date(Date.now() - 3 * 86400000) } } }),
  ]);

  const baixos = [
    ...produtosBaixos.filter((p) => p.estoque <= p.estoqueMinimo).map((p) => p.nome),
    ...materiais.filter((m) => m.quantidade <= m.minimo).map((m) => m.nome),
  ];
  const faturamentoOntem = concluidosOntem.reduce((s, a) => s + a.valorTotal, 0);
  const primeiro = deHoje[0] ? zonedParts(deHoje[0].inicio, tz).time : null;

  const linhas = [
    `📋 Resumo de hoje (${hoje.slice(8, 10)}/${hoje.slice(5, 7)})`,
    `• Atendimentos hoje: ${deHoje.length}${primeiro ? ` (o primeiro às ${primeiro})` : ""}`,
    `• Ontem: ${concluidosOntem.length} atendimento(s) concluído(s), ${brl(faturamentoOntem)}`,
    aguardando ? `• Aguardando pagamento: ${aguardando}` : "",
    baixos.length ? `• Estoque baixo: ${baixos.slice(0, 8).join(", ")}${baixos.length > 8 ? "…" : ""}` : "",
    pendentes ? `• Avisos pendentes: ${pendentes} (seguem abaixo)` : "",
  ].filter(Boolean);

  const partes = [`${deHoje.length} atendimento(s) hoje`];
  if (baixos.length) partes.push(`${baixos.length} item(ns) com estoque baixo`);
  if (pendentes) partes.push(`${pendentes} aviso(s)`);
  const linhaCurta = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : partes[0];

  return { nome: tenant?.nome || "estabelecimento", texto: linhas.join("\n"), linhaCurta };
}

/** Resumo completo + avisos pendentes como texto (janela aberta). */
async function entregarTudo(tenantId, numero) {
  const resumo = await montarResumo(tenantId);
  await enviarTextoAlerta(tenantId, numero, resumo.texto);
  const pendentes = await prisma.alerta.findMany({
    where: { tenantId, enviadoEm: null, tipo: { not: "RESUMO_DIARIO" }, createdAt: { gt: new Date(Date.now() - 3 * 86400000) } },
    orderBy: { createdAt: "asc" },
  });
  // Cada aviso numa mensagem: os de duvida precisam ser citados na resposta da doutora.
  for (const alerta of pendentes) {
    const r = await enviarTextoAlerta(tenantId, numero, textoCompleto(alerta));
    if (r.enviado) {
      await prisma.alerta.update({ where: { id: alerta.id }, data: { enviadoEm: new Date() } });
      await amarrarConsulta(alerta, r.externalId);
    }
  }
  return { avisos: pendentes.length };
}

async function enviarResumoDiario(tenantId, { forcar = false } = {}) {
  const config = await getAgenteConfig(tenantId);
  const numeros = numerosDeAlerta(config);
  if (!numeros.length || (!forcar && !tipoAtivo(config, "RESUMO_DIARIO"))) return { enviados: 0 };
  const resumo = await montarResumo(tenantId);
  let enviados = 0;
  for (const numero of numeros) {
    try {
      if (await janelaAberta(tenantId, config, numero)) await entregarTudo(tenantId, numero);
      else await enviarTemplateAlerta(tenantId, config, numero, TEMPLATE_RESUMO, [resumo.nome, resumo.linhaCurta], `[Template resumo] ${resumo.linhaCurta}`);
      enviados++;
    } catch (error) {
      log("alertas", "resumo_falhou", { tenantId, numero, erro: error.message });
    }
  }
  return { enviados };
}

/** Scheduler: dispara o resumo no horario de cada estabelecimento, uma vez por dia. */
async function processarResumos() {
  const configs = await prisma.agenteConfig.findMany({
    where: { alertasNumeros: { isEmpty: false }, alertasTipos: { has: "RESUMO_DIARIO" } },
    select: { tenantId: true, alertasHoraResumo: true, alertasUltimoResumo: true, tenant: { select: { timezone: true, ativo: true } } },
  });
  for (const c of configs) {
    if (!c.tenant?.ativo) continue;
    const agora = zonedParts(new Date(), c.tenant.timezone || "America/Sao_Paulo");
    if (c.alertasUltimoResumo === agora.date || agora.time < (c.alertasHoraResumo || "08:00")) continue;
    // marca antes de enviar: dois ticks seguidos nao mandam dois resumos
    await prisma.agenteConfig.update({ where: { tenantId: c.tenantId }, data: { alertasUltimoResumo: agora.date } });
    await enviarResumoDiario(c.tenantId);
  }
}

// ---------- mensagem que chega de um numero de alerta ----------

/**
 * Chamado pelo orchestrator para mensagens recebidas. "Ver alertas" (botao do template) ou
 * "alertas" entrega o resumo e os pendentes. Devolve null quando nao e com o assistente.
 */
async function tratarPedidoDeAlertas(tenant, config, evento) {
  if (!evento.text || !ehNumeroDeAlerta(config, evento.contato)) return null;
  if (!PALAVRAS_VER.test(evento.text.trim())) return null;
  const conversa = await obterConversa(tenant.id, evento.contato, "GESTAO");
  await registrarMensagem(conversa, { autor: "CLIENTE", texto: evento.text, externalId: evento.messageId || null });
  const r = await entregarTudo(tenant.id, evento.contato);
  return { alertas: "entregues", ...r };
}

/** Mensagem da doutora que nao e "ver alertas" nem resposta de duvida: nao vai para a IA de atendimento. */
async function guardarMensagemDaEquipe(tenant, evento) {
  const conversa = await obterConversa(tenant.id, evento.contato, "GESTAO");
  await registrarMensagem(conversa, { autor: "CLIENTE", texto: evento.text || "[mídia]", externalId: evento.messageId || null });
  await enviarTextoAlerta(
    tenant.id,
    evento.contato,
    'Recebido. Para ver o resumo e os avisos, toque em "Ver alertas" ou escreva "alertas". Para responder uma dúvida de cliente, segure a mensagem da dúvida e toque em Responder.'
  );
  return { alertas: "mensagem_da_equipe" };
}

// ---------- templates ----------

const MODELOS = [
  {
    name: TEMPLATE_RESUMO,
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Bom dia! O resumo do dia do {{1}} está pronto: {{2}}. Toque em Ver alertas para ver os detalhes.",
        example: { body_text: [["Studio Bella", "8 atendimentos hoje e 2 avisos"]] },
      },
      { type: "FOOTER", text: "Assistente SMG" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Ver alertas" }] },
    ],
  },
  {
    name: TEMPLATE_URGENTE,
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Aviso do {{1}}: {{2}}. Toque em Ver alertas para ver e responder.",
        example: { body_text: [["Studio Bella", "a paciente Ana pediu para falar com a doutora"]] },
      },
      { type: "FOOTER", text: "Assistente SMG" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Ver alertas" }] },
    ],
  },
];

function wabaDe(config) {
  return String(config.whatsappConfig?.wabaId || "").trim();
}

async function statusTemplates(tenantId) {
  const config = await getAgenteConfig(tenantId);
  if (!usaTemplate(config)) return { necessario: false, templates: [] };
  const wabaId = wabaDe(config);
  if (!wabaId) return { necessario: true, wabaId: null, templates: MODELOS.map((m) => ({ nome: m.name, status: "SEM_WABA" })) };
  try {
    const existentes = await listarTemplatesMeta(config.whatsappConfig, wabaId);
    return {
      necessario: true,
      wabaId,
      templates: MODELOS.map((m) => {
        const t = existentes.find((x) => x.name === m.name && x.language === m.language);
        return { nome: m.name, status: t?.status || "NAO_CRIADO", motivo: t?.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null };
      }),
    };
  } catch (error) {
    return { necessario: true, wabaId, erro: error.message, templates: MODELOS.map((m) => ({ nome: m.name, status: "DESCONHECIDO" })) };
  }
}

async function criarTemplates(tenantId) {
  const config = await getAgenteConfig(tenantId);
  if (!usaTemplate(config)) return { criados: [] };
  const wabaId = wabaDe(config);
  if (!wabaId) throw Object.assign(new Error("Informe o WABA ID do número conectado."), { statusCode: 400 });
  const atual = await statusTemplates(tenantId);
  const criados = [];
  for (const modelo of MODELOS) {
    const ja = atual.templates.find((t) => t.nome === modelo.name);
    if (ja && !["NAO_CRIADO", "DESCONHECIDO"].includes(ja.status)) continue;
    await criarTemplateMeta(config.whatsappConfig, wabaId, modelo);
    criados.push(modelo.name);
  }
  return { criados };
}

module.exports = {
  TIPOS,
  numerosDeAlerta,
  ehNumeroDeAlerta,
  registrarAlerta,
  enviarResumoDiario,
  processarResumos,
  tratarPedidoDeAlertas,
  guardarMensagemDaEquipe,
  statusTemplates,
  criarTemplates,
  montarResumo,
};
