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

// Calendario pronto dos proximos dias: sem ele o modelo erra a conta de "sexta" -> data
// (em 13/10/2026, uma terca, respondeu "sexta-feira, dia 14/10").
function proximosDias(hoje, quantidade = 14) {
  const base = new Date(`${hoje}T12:00:00Z`);
  const linhas = [];
  for (let i = 0; i < quantidade; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const rotulo = i === 0 ? " (hoje)" : i === 1 ? " (amanha)" : "";
    linhas.push(`- ${WEEKDAY_NAMES[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)} = ${iso}${rotulo}`);
  }
  return linhas.join("\n");
}

function saudacaoDoHorario(hora) {
  if (hora >= 5 && hora < 12) return "bom dia";
  if (hora >= 12 && hora < 18) return "boa tarde";
  return "boa noite";
}

/**
 * pagamentoDisponivel: o estabelecimento conectou o Mercado Pago. Sem ele, cliente (site ou
 * agente) nao consegue concluir agendamento, porque o sistema exige pagamento online; entao o
 * agente nao manda o link do site e leva o pedido para a equipe confirmar.
 * linkJaEnviado: o link do site ja apareceu na conversa (nao repetir).
 */
function buildSystemPrompt({ tenant, config, cliente, pagamentoDisponivel = true, linkJaEnviado = false }) {
  const hoje = todayStr(tenant.timezone);
  const agora = zonedParts(new Date(), tenant.timezone);
  const linkSite = `${env.publicAppUrl}/s/${tenant.slug}`;
  const blocoAgendamento = pagamentoDisponivel
    ? [
        "## Link do site para agendar",
        linkSite,
        "Envie o link so no momento certo: quando a cliente pedir, quando quiser agendar sozinha ou quando ja tiver decidido o servico e for mais facil ela escolher o horario no site. Nunca no inicio da conversa nem junto de toda resposta.",
        linkJaEnviado
          ? "O link JA foi enviado nesta conversa: nao mande de novo, a menos que a cliente peca."
          : "O link ainda nao foi enviado nesta conversa.",
        "Agendar pela conversa tambem funciona: servico, dia e horario confirmados por `consultar_horarios`, nome da cliente, `criar_agendamento` e envio do link de pagamento que ele devolve (o horario fica reservado por 15 minutos e so e confirmado apos o pagamento).",
      ]
    : [
        "## Agendamento (instrucao interna: nunca comente nada disto com a cliente)",
        "Neste estabelecimento o agendamento e confirmado pela equipe: NAO envie link de site e NAO use `criar_agendamento`.",
        "Quando a cliente quiser marcar, combine servico, dia e horario (confira com `consultar_horarios`), pegue o nome dela e use `consultar_equipe` com tipo \"agendamento\" descrevendo o pedido. Diga algo natural como \"Um minutinho, vou confirmar esse horario com a doutora.\" e nao confirme o agendamento ate a equipe responder.",
        "Nunca fale de problema de pagamento ou de sistema com a cliente.",
      ];
  return [
    `Voce e ${config.personaNome}, assistente virtual de ${tenant.nome}.`,
    `Tom de voz: ${config.personaTom}.`,
    config.personaApresentacao
      ? `Apresentacao configurada pelo estabelecimento (use so como referencia de tom; a recepcao continua curta, como na regra 7): ${config.personaApresentacao}`
      : "",
    `Hoje e ${WEEKDAY_NAMES[agora.weekday]}, ${formatDateBr(new Date(), tenant.timezone)} (${hoje}), agora sao ${String(agora.hour).padStart(2, "0")}:${String(agora.minute).padStart(2, "0")} (use "${saudacaoDoHorario(agora.hour)}" ao cumprimentar). Fuso: ${tenant.timezone}.`,
    "Calendario dos proximos dias (use esta lista para converter dia da semana em data; nunca calcule por conta propria):",
    proximosDias(hoje),
    cliente
      ? `Cliente identificado pelo telefone: ${cliente.nome}.`
      : "Cliente ainda nao cadastrado. Nao peca o nome para mandar o link do site nem para informar servicos e precos; so pergunte o nome se ele preferir agendar pela conversa.",
    "",
    REGRAS,
    "",
    "## Informacoes do negocio (configuradas pelo estabelecimento)",
    config.informacoesNegocio?.trim() || "(nenhuma informacao adicional cadastrada)",
    tenant.endereco ? `Endereco: ${tenant.endereco}` : "",
    "",
    ...blocoAgendamento,
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

  // O historico guarda so o texto das mensagens, nao o resultado das ferramentas: a partir da 2a
  // mensagem o modelo costuma passar o NOME do servico/profissional em vez do id. Aceita os dois.
  const semAcento = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  async function idsDeServicos(lista) {
    const servicos = await prisma.servico.findMany({ where: { tenantId, ativo: true }, select: { id: true, nome: true } });
    return (lista || []).map((v) => {
      if (servicos.some((x) => x.id === v)) return v;
      const alvo = semAcento(v);
      const achado = servicos.find((x) => semAcento(x.nome) === alvo) || servicos.find((x) => semAcento(x.nome).includes(alvo) || alvo.includes(semAcento(x.nome)));
      return achado ? achado.id : v;
    });
  }
  async function idDeProfissional(v) {
    if (!v) return v;
    const profs = await prisma.profissional.findMany({ where: { tenantId, ativo: true }, select: { id: true, nome: true } });
    if (profs.some((x) => x.id === v)) return v;
    const alvo = semAcento(v);
    const achado = profs.find((x) => semAcento(x.nome) === alvo) || profs.find((x) => semAcento(x.nome).startsWith(alvo));
    return achado ? achado.id : v;
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
      description: "Retorna o link do site para a cliente agendar sozinha. Use so quando ela pedir o link ou quiser agendar sozinha, e nunca se o link ja foi enviado na conversa.",
      schema: z.object({}),
      handler: async () => {
        if (!ctx.pagamentoDisponivel) return { ok: false, error: "Agendamento online indisponivel neste estabelecimento. Use consultar_equipe com tipo agendamento." };
        return { ok: true, link: `${env.publicAppUrl}/s/${tenant.slug}` };
      },
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
      description:
        "Lista servicos ativos com preco, duracao e profissionais habilitados. Passe `busca` com o que a cliente procura (ex.: \"unha\", \"labial\", \"depilacao\") para receber so os servicos ligados ao interesse dela.",
      schema: z.object({ busca: z.string().optional().describe("Palavra ou trecho do servico/categoria que a cliente procura") }),
      handler: async ({ busca } = {}) => {
        const todos = await prisma.servico.findMany({
          where: { tenantId, ativo: true },
          include: { profissionais: { include: { profissional: { select: { id: true, nome: true, ativo: true } } } } },
          orderBy: [{ categoria: "asc" }, { nome: "asc" }],
        });
        // Filtro por palavra (sem acento); sem resultado, devolve so as categorias para o
        // agente perguntar, em vez da lista inteira.
        const termos = semAcento(busca).split(/\s+/).filter((t) => t.length >= 3);
        const servicos = termos.length
          ? todos.filter((s) => {
              const alvo = semAcento(`${s.nome} ${s.categoria || ""} ${s.descricao || ""}`);
              return termos.some((t) => alvo.includes(t) || alvo.includes(t.replace(/s$/, "")));
            })
          : todos;
        if (termos.length && servicos.length === 0) {
          return { ok: true, servicos: [], aviso: "Nenhum servico com esse termo.", categorias: [...new Set(todos.map((s) => s.categoria).filter(Boolean))] };
        }
        return {
          ok: true,
          ...(termos.length ? {} : { aviso: "Lista completa: NAO mande para a cliente; mostre so o que interessa a ela." }),
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
        servico_ids: z.array(z.string()).min(1).describe("Ids (ou nomes exatos) dos servicos escolhidos, na ordem"),
        profissional_id: z.string().optional().describe("Id do profissional, se o cliente escolheu"),
        data: z.string().optional().describe("Data AAAA-MM-DD. Se o cliente citou um dia (ex.: sexta), passe a data tirada do calendario do prompt"),
        periodo: z.enum(["manha", "tarde", "noite"]).optional().describe("Se o cliente pediu um periodo: manha (antes das 12:00), tarde (12:00 a 17:59), noite (18:00 em diante)"),
        hora_desejada: z.string().optional().describe("HH:mm, se a cliente pediu um horario especifico (ex.: 14:00)"),
      }),
      handler: async (entrada) => {
        const servico_ids = await idsDeServicos(entrada.servico_ids);
        const profissional_id = await idDeProfissional(entrada.profissional_id);
        const { data, periodo, hora_desejada } = entrada;
        // Horarios mais proximos do pedido primeiro; a lista volta curta para nao virar "textao".
        const minutos = (h) => Number(String(h).slice(0, 2)) * 60 + Number(String(h).slice(3, 5));
        const desejo = /^\d{2}:\d{2}$/.test(String(hora_desejada || "")) ? minutos(hora_desejada) : null;
        const ordenar = (lista) => (desejo === null ? lista : [...lista].sort((a, b) => Math.abs(minutos(a) - desejo) - Math.abs(minutos(b) - desejo)));
        // Filtro no sistema: so a regra no prompt nao bastou (pedido "sexta a tarde" voltava com 09:00).
        const noPeriodo = (h) => {
          if (!periodo) return true;
          const hora = Number(String(h).slice(0, 2));
          return periodo === "manha" ? hora < 12 : periodo === "tarde" ? hora >= 12 && hora < 18 : hora >= 18;
        };
        if (data) {
          const r = await disponibilidade.listarHorarios({ tenantId, servicoIds: servico_ids, profissionalId: profissional_id, data });
          return {
            ok: true,
            data,
            diaSemana: WEEKDAY_NAMES[new Date(`${data}T12:00:00Z`).getUTCDay()],
            duracaoTotalMin: r.duracao.ocupacaoTotal,
            periodo: periodo || null,
            ...(desejo !== null ? { horaDesejadaLivre: r.profissionais.some((p) => p.horarios.includes(hora_desejada)) } : {}),
            profissionais: r.profissionais.map((p) => {
              const livres = ordenar(p.horarios.filter(noPeriodo));
              return { id: p.profissionalId, nome: p.nome, horarios: livres.slice(0, 3), outrosHorariosLivres: Math.max(0, livres.length - 3) };
            }),
            orientacao:
              "Ofereca no maximo 3 opcoes, sem lista longa. A lista e um resumo: antes de dizer que um horario pedido nao esta livre, consulte de novo com hora_desejada.",
          };
        }
        const dias = await disponibilidade.proximosDiasDisponiveis({ tenantId, servicoIds: servico_ids, profissionalId: profissional_id, dias: 21, maxResultados: periodo ? 10 : 5 });
        return {
          ok: true,
          periodo: periodo || null,
          dias: dias
            .map((d) => ({
              data: d.data,
              diaSemana: WEEKDAY_NAMES[new Date(`${d.data}T12:00:00Z`).getUTCDay()],
              profissionais: d.profissionais
                .map((p) => ({ id: p.profissionalId, nome: p.nome, horarios: ordenar(p.horarios.filter(noPeriodo)).slice(0, 3) }))
                .filter((p) => p.horarios.length > 0),
            }))
            .filter((d) => d.profissionais.length > 0)
            .slice(0, 5),
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
      handler: async (entrada) => {
        if (!ctx.pagamentoDisponivel) {
          return { ok: false, error: "Agendamento pela conversa indisponivel aqui (sem pagamento online). Use consultar_equipe com tipo agendamento. Nao fale disso com a cliente." };
        }
        const servico_ids = await idsDeServicos(entrada.servico_ids);
        const profissional_id = await idDeProfissional(entrada.profissional_id);
        const { data, hora, nome_cliente } = entrada;
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
      name: "consultar_equipe",
      description:
        "Leva uma pergunta ou pedido para a equipe (a doutora) responder: informacao que nao esta no sistema, pergunta clinica, pedido de agendamento sem pagamento online, reclamacao ou assunto fora de agendamentos. A equipe recebe a pergunta e a resposta volta para esta conversa como nota interna. Depois de chamar, NAO responda mais nada: a mensagem_cliente ja e enviada.",
      schema: z.object({
        tipo: z
          .enum(["duvida", "agendamento", "atendimento_humano"])
          .describe("duvida: algo para a equipe responder; agendamento: pedido de horario para confirmar; atendimento_humano: reclamacao ou assunto que precisa de uma pessoa"),
        pergunta: z.string().describe("O que a equipe precisa responder ou confirmar, com os detalhes (servico, dia, horario, nome da cliente) em uma frase"),
        mensagem_cliente: z
          .string()
          .describe("Mensagem curta e natural para a cliente enquanto isso, ex.: \"Um minutinho, vou confirmar isso com a doutora.\" Nunca diga que vai transferir o atendimento."),
      }),
      handler: async ({ tipo, pergunta, mensagem_cliente }) => {
        ctx.escalonamento = { motivo: pergunta, tipo, mensagemCliente: mensagem_cliente };
        return { ok: true, mensagem: "Pergunta enviada para a equipe. Nao envie mais mensagens." };
      },
    },
  ];
}

module.exports = { buildSystemPrompt, buildTools };
