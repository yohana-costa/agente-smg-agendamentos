// Agente de Atendimento (documento Agentes de IA, secao 2).
const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const env = require("../../config/env");
const disponibilidade = require("../../services/disponibilidade.service");
const agendamentoService = require("../../services/agendamento.service");
const { encontrarOuCriarCliente } = require("../../services/cliente.service");
const { zonedParts, todayStr, WEEKDAY_NAMES, formatDateBr } = require("../../lib/time");
const { brl } = require("../../lib/helpers");

const REGRAS = fs.readFileSync(path.join(__dirname, "prompt.md"), "utf8");

function buildSystemPrompt({ tenant, config, cliente }) {
  const hoje = todayStr(tenant.timezone);
  return [
    `Voce e ${config.personaNome}, assistente virtual de ${tenant.nome}.`,
    `Tom de voz: ${config.personaTom}.`,
    `Forma de se apresentar: ${config.personaApresentacao}`,
    `Hoje e ${WEEKDAY_NAMES[zonedParts(new Date(), tenant.timezone).weekday]}, ${formatDateBr(new Date(), tenant.timezone)} (${hoje}). Fuso: ${tenant.timezone}.`,
    cliente ? `Cliente identificado pelo telefone: ${cliente.nome}.` : "Cliente ainda nao cadastrado (pergunte o nome antes de agendar).",
    "",
    REGRAS,
    "",
    "## Informacoes do negocio (configuradas pelo estabelecimento)",
    config.informacoesNegocio?.trim() || "(nenhuma informacao adicional cadastrada)",
    tenant.endereco ? `Endereco: ${tenant.endereco}` : "",
  ].join("\n");
}

function resumoAgendamento(ag) {
  return {
    id: ag.id,
    data: ag.data,
    hora: ag.hora,
    servicos: ag.servicos.map((s) => s.nome),
    profissional: ag.profissional?.nome,
    status: ag.status,
    valor: brl(ag.valorTotal),
    linkPagamento: ag.linkPagamento,
    minutosParaExpirar: ag.segundosRestantesReserva !== null ? Math.ceil(ag.segundosRestantesReserva / 60) : null,
  };
}

function buildTools(ctx) {
  const { tenant, telefone } = ctx;
  const tenantId = tenant.id;

  async function clienteAtual() {
    if (ctx.cliente) return ctx.cliente;
    ctx.cliente = await prisma.cliente.findUnique({ where: { tenantId_telefone: { tenantId, telefone } } });
    return ctx.cliente;
  }

  async function agendamentoDoCliente(id) {
    const cliente = await clienteAtual();
    if (!cliente) return null;
    const ag = await prisma.agendamento.findFirst({ where: { id, tenantId, clienteId: cliente.id } });
    return ag ? agendamentoService.obterSerializado(tenantId, id) : null;
  }

  return [
    {
      name: "link_site_agendamento",
      description: "Retorna o link do site para o cliente agendar sozinho. Use SEMPRE primeiro quando o cliente quiser agendar.",
      schema: z.object({}),
      handler: async () => ({ ok: true, link: `${env.publicAppUrl}/s/${tenant.slug}` }),
    },
    {
      name: "registrar_nome_cliente",
      description: "Cadastra ou atualiza o nome do cliente deste telefone.",
      schema: z.object({ nome: z.string().min(2).describe("Nome completo informado pelo cliente") }),
      handler: async ({ nome }) => {
        ctx.cliente = await encontrarOuCriarCliente(tenantId, { telefone, nome });
        return { ok: true, nome: ctx.cliente.nome };
      },
    },
    {
      name: "listar_servicos",
      description: "Lista servicos ativos com preco, duracao e profissionais habilitados.",
      schema: z.object({}),
      handler: async () => {
        const servicos = await prisma.servico.findMany({
          where: { tenantId, ativo: true },
          include: { profissionais: { include: { profissional: { select: { id: true, nome: true, ativo: true } } } } },
          orderBy: [{ categoria: "asc" }, { nome: "asc" }],
        });
        return {
          ok: true,
          servicos: servicos.map((s) => ({
            id: s.id,
            nome: s.nome,
            categoria: s.categoria,
            descricao: s.descricao,
            preco: brl(s.preco),
            duracaoMin: s.duracaoMin,
            profissionais: s.profissionais.filter((p) => p.profissional.ativo).map((p) => ({ id: p.profissional.id, nome: p.profissional.nome })),
          })),
        };
      },
    },
    {
      name: "consultar_horarios",
      description:
        "Consulta horarios livres para um ou mais servicos (no mesmo atendimento). Sem data, retorna os proximos dias com horario. Considera jornada, folgas, bloqueios, Google Calendar, duracao total e intervalos.",
      schema: z.object({
        servico_ids: z.array(z.string()).min(1).describe("Ids dos servicos escolhidos, na ordem"),
        profissional_id: z.string().optional().describe("Id do profissional, se o cliente escolheu"),
        data: z.string().optional().describe("Data AAAA-MM-DD"),
      }),
      handler: async ({ servico_ids, profissional_id, data }) => {
        if (data) {
          const r = await disponibilidade.listarHorarios({ tenantId, servicoIds: servico_ids, profissionalId: profissional_id, data });
          return {
            ok: true,
            data,
            duracaoTotalMin: r.duracao.ocupacaoTotal,
            profissionais: r.profissionais.map((p) => ({ id: p.profissionalId, nome: p.nome, horarios: p.horarios })),
          };
        }
        const dias = await disponibilidade.proximosDiasDisponiveis({ tenantId, servicoIds: servico_ids, profissionalId: profissional_id, dias: 21, maxResultados: 5 });
        return {
          ok: true,
          dias: dias.map((d) => ({
            data: d.data,
            diaSemana: WEEKDAY_NAMES[new Date(`${d.data}T12:00:00Z`).getUTCDay()],
            profissionais: d.profissionais.map((p) => ({ id: p.profissionalId, nome: p.nome, horarios: p.horarios.slice(0, 8) })),
          })),
        };
      },
    },
    {
      name: "criar_agendamento",
      description:
        "Registra o agendamento com status Aguardando pagamento e retorna o link de pagamento. Use somente horario retornado por consultar_horarios.",
      schema: z.object({
        servico_ids: z.array(z.string()).min(1),
        profissional_id: z.string(),
        data: z.string().describe("AAAA-MM-DD"),
        hora: z.string().describe("HH:mm"),
        nome_cliente: z.string().optional().describe("Nome do cliente, se ainda nao cadastrado"),
      }),
      handler: async ({ servico_ids, profissional_id, data, hora, nome_cliente }) => {
        const cliente = await clienteAtual();
        if (!cliente && !nome_cliente) return { ok: false, error: "Pergunte o nome do cliente antes de agendar." };
        const ag = await agendamentoService.criar({
          tenantId,
          origem: "AGENTE",
          servicoIds: servico_ids,
          profissionalId: profissional_id,
          data,
          hora,
          ...(cliente ? { clienteId: cliente.id } : { cliente: { telefone, nome: nome_cliente } }),
        });
        ctx.cliente = await clienteAtual();
        return { ok: true, agendamento: resumoAgendamento(ag), reservaMinutos: env.reservaMinutos };
      },
    },
    {
      name: "meus_agendamentos",
      description: "Lista os proximos agendamentos deste cliente (pelo telefone).",
      schema: z.object({}),
      handler: async () => {
        const cliente = await clienteAtual();
        if (!cliente) return { ok: true, agendamentos: [] };
        const ags = await prisma.agendamento.findMany({
          where: { tenantId, clienteId: cliente.id, status: { in: ["AGUARDANDO_PAGAMENTO", "CONFIRMADO"] }, inicio: { gte: new Date() } },
          include: agendamentoService.INCLUDE_COMPLETO,
          orderBy: { inicio: "asc" },
        });
        return { ok: true, agendamentos: ags.map((a) => resumoAgendamento(agendamentoService.serializar(a, tenant))) };
      },
    },
    {
      name: "consultar_regra_cancelamento",
      description: "Mostra qual regra de reembolso se aplica e o valor exato que sera devolvido se o agendamento for cancelado agora.",
      schema: z.object({ agendamento_id: z.string() }),
      handler: async ({ agendamento_id }) => {
        if (!(await agendamentoDoCliente(agendamento_id))) return { ok: false, error: "Agendamento nao encontrado para este cliente." };
        const r = await agendamentoService.simularCancelamento(tenantId, agendamento_id);
        return { ok: true, regra: r.descricao, valorPago: brl(r.valorPago), valorDevolvido: brl(r.valor) };
      },
    },
    {
      name: "cancelar_agendamento",
      description: "Cancela o agendamento aplicando a politica. So use depois de informar a regra e o valor e o cliente confirmar.",
      schema: z.object({ agendamento_id: z.string(), cliente_confirmou: z.boolean().describe("true somente se o cliente confirmou apos ver a regra e o valor") }),
      handler: async ({ agendamento_id, cliente_confirmou }) => {
        if (!cliente_confirmou) return { ok: false, error: "Informe a regra e o valor e peca a confirmacao do cliente antes." };
        if (!(await agendamentoDoCliente(agendamento_id))) return { ok: false, error: "Agendamento nao encontrado para este cliente." };
        const r = await agendamentoService.cancelar(tenantId, agendamento_id, { tipo: "CANCELAMENTO", motivo: "Cancelado pelo cliente via WhatsApp", notificar: false });
        return { ok: true, valorDevolvido: brl(r.reembolso.valor), regra: r.reembolso.descricao };
      },
    },
    {
      name: "consultar_regra_reagendamento",
      description: "Informa se o reagendamento mantem o pagamento (dentro do prazo) ou se exige novo pagamento e qual valor sera devolvido (fora do prazo).",
      schema: z.object({ agendamento_id: z.string() }),
      handler: async ({ agendamento_id }) => {
        if (!(await agendamentoDoCliente(agendamento_id))) return { ok: false, error: "Agendamento nao encontrado para este cliente." };
        const r = await agendamentoService.simularReagendamento(tenantId, agendamento_id, { porCliente: true });
        return { ok: true, ...r, valorDevolvido: r.reembolso ? brl(r.reembolso.valor) : null };
      },
    },
    {
      name: "reagendar_agendamento",
      description: "Reagenda para um novo horario retornado por consultar_horarios. So use depois de informar a regra e o cliente confirmar.",
      schema: z.object({
        agendamento_id: z.string(),
        data: z.string().describe("AAAA-MM-DD"),
        hora: z.string().describe("HH:mm"),
        cliente_confirmou: z.boolean(),
      }),
      handler: async ({ agendamento_id, data, hora, cliente_confirmou }) => {
        if (!cliente_confirmou) return { ok: false, error: "Informe a regra e peca a confirmacao do cliente antes." };
        if (!(await agendamentoDoCliente(agendamento_id))) return { ok: false, error: "Agendamento nao encontrado para este cliente." };
        const r = await agendamentoService.reagendar(tenantId, agendamento_id, { data, hora, porCliente: true, origem: "AGENTE" });
        return {
          ok: true,
          novoPagamentoNecessario: r.novoAgendamento,
          agendamento: resumoAgendamento(r.agendamento),
          valorDevolvido: r.reembolso ? brl(r.reembolso.valor) : null,
        };
      },
    },
    {
      name: "status_pagamento",
      description: "Consulta o status de um agendamento e do pagamento.",
      schema: z.object({ agendamento_id: z.string() }),
      handler: async ({ agendamento_id }) => {
        const ag = await agendamentoDoCliente(agendamento_id);
        if (!ag) return { ok: false, error: "Agendamento nao encontrado para este cliente." };
        return { ok: true, agendamento: resumoAgendamento(ag), situacaoPagamento: ag.situacaoPagamento };
      },
    },
    {
      name: "escalar_para_humano",
      description:
        "Encaminha para uma pessoa da equipe quando a informacao nao esta no sistema ou o assunto esta fora de agendamentos. Depois de chamar, NAO responda mais nada.",
      schema: z.object({ motivo: z.string().describe("Resumo curto do que o cliente precisa") }),
      handler: async ({ motivo }) => {
        ctx.escalonamento = { motivo };
        return { ok: true, mensagem: "Escalonamento registrado. Nao envie mais mensagens." };
      },
    },
  ];
}

module.exports = { buildSystemPrompt, buildTools };
