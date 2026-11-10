// Agente de Atendimento (documento Agentes de IA, secao 2).
const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const env = require("../../config/env");
const disponibilidade = require("../../services/disponibilidade.service");
const agendamentoService = require("../../services/agendamento.service");
const { encontrarOuCriarCliente } = require("../../services/cliente.service");
const { zonedParts, zonedToUtc, todayStr, WEEKDAY_NAMES, formatDateBr } = require("../../lib/time");
const { brl } = require("../../lib/helpers");

const REGRAS = fs.readFileSync(path.join(__dirname, "prompt.md"), "utf8");

// Calendario pronto dos proximos dias: sem ele o modelo erra a conta de "sexta" -> data
// (em 13/10/2026, uma terca, respondeu "sexta-feira, dia 14/10").
// Dia fechado vem marcado no calendario: sem isso a IA respondeu "Sim, atendemos segunda-feira"
// com a Studio Bella fechada as segundas (06/11/2026).
function proximosDias(hoje, quantidade = 14, { funcionamento = [], diasFechados = [] } = {}) {
  const base = new Date(`${hoje}T12:00:00Z`);
  const linhas = [];
  for (let i = 0; i < quantidade; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const rotulo = i === 0 ? " (hoje)" : i === 1 ? " (amanha)" : "";
    const rotina = funcionamento.find((h) => h.diaSemana === d.getUTCDay());
    const fechado = diasFechados.includes(iso) || (rotina && !rotina.aberto) ? " FECHADO, nao atende" : "";
    linhas.push(`- ${WEEKDAY_NAMES[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)} = ${iso}${rotulo}${fechado}`);
  }
  return linhas.join("\n");
}

// Resumo pronto ("terca e quarta das 10:00 as 18:00; ..."): com so a lista, a IA respondeu
// "qual dia voces abrem?" citando um dia so.
function resumoFuncionamento(funcionamento) {
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const grupos = [];
  for (const n of ordem) {
    const h = funcionamento.find((x) => x.diaSemana === n);
    const chave = h && h.aberto ? `das ${h.inicio} as ${h.fim}` : null;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === chave) ultimo.dias.push(WEEKDAY_NAMES[n]);
    else grupos.push({ chave, dias: [WEEKDAY_NAMES[n]] });
  }
  const nomes = (dias) => (dias.length > 2 ? `${dias[0]} a ${dias[dias.length - 1]}` : dias.join(" e "));
  const abertos = grupos.filter((g) => g.chave).map((g) => `${nomes(g.dias)} ${g.chave}`);
  const fechados = grupos.filter((g) => !g.chave).flatMap((g) => g.dias);
  return `Abre ${abertos.join("; ")}.${fechados.length ? ` Fechado: ${fechados.join(" e ")}.` : ""}`;
}

// "25/12; 30/12 a 11/01": datas fechadas fora da rotina, juntando dias seguidos. O calendario do
// prompt so cobre 14 dias e a IA inventou "atendemos ate 23/12" (10/11/2026).
function resumoDiasFechados(diasFechados) {
  const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const faixas = [];
  for (const iso of [...diasFechados].sort()) {
    const ultima = faixas[faixas.length - 1];
    if (ultima && new Date(`${iso}T12:00:00Z`) - new Date(`${ultima.fim}T12:00:00Z`) === 86400000) ultima.fim = iso;
    else faixas.push({ ini: iso, fim: iso });
  }
  return faixas.map((f) => (f.ini === f.fim ? ddmm(f.ini) : `${ddmm(f.ini)} a ${ddmm(f.fim)}`)).join("; ");
}

// Datas que a cliente escreveu (dd/mm ou dd/mm/aaaa), com o dia da semana calculado aqui. O calendario
// do prompt so cobre 14 dias: com "22/12" a IA leu a linha "domingo 22/11" e disse que 22/12 era
// domingo (10/11/2026). Data ja passada no ano vira o ano seguinte.
function datasCitadas(texto, hoje) {
  const out = new Set();
  for (const m of String(texto || "").matchAll(/(?<!\d)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/g)) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue;
    let ano = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(hoje.slice(0, 4));
    let iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    if (!m[3] && iso < hoje) iso = `${ano + 1}${iso.slice(4)}`;
    if (!Number.isNaN(new Date(`${iso}T12:00:00Z`).getTime())) out.add(iso);
  }
  return [...out].sort();
}

function linhasDatasCitadas(datas, { funcionamento = [], diasFechados = [] } = {}) {
  if (!datas.length) return [];
  return [
    "Datas que a cliente citou (dia da semana ja calculado; use estas, nao deduza pelo calendario):",
    ...datas.map((iso) => {
      const d = new Date(`${iso}T12:00:00Z`);
      const rotina = funcionamento.find((h) => h.diaSemana === d.getUTCDay());
      const fechado = diasFechados.includes(iso) || (rotina && !rotina.aberto) ? " FECHADO, nao atende" : "";
      return `- ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} = ${WEEKDAY_NAMES[d.getUTCDay()]} (${iso})${fechado}`;
    }),
  ];
}

function blocoFuncionamento(funcionamento, diasFechados = []) {
  if (!funcionamento.length) return [];
  return [
    "## Dias e horarios de funcionamento",
    resumoFuncionamento(funcionamento),
    diasFechados.length ? `Datas fechadas fora da rotina (feriados, recesso): ${resumoDiasFechados(diasFechados)}. Perguntas sobre feriados e fim de ano: responda so por esta lista e pelas Informacoes do negocio; nunca invente data.` : "",
    "Pergunta \"atende tal dia?\" ou \"abre tal dia?\": responda por este resumo e pelo calendario acima. Dia FECHADO: diga que a clinica nao abre nesse dia e ofereca o proximo dia aberto. Nunca diga que atende num dia fechado nem troque \"fechado\" por \"nao tem horario\".",
    "Pergunta \"quais dias voces abrem?\": responda numa mensagem so com TODOS os dias abertos do resumo, sem listar dia por dia.",
    "So diga que a clinica esta fechada num dia quando o calendario marcar FECHADO ou `consultar_horarios` devolver `fechado: true`. Dia aberto sem horario livre para o pedido NAO e fechado: diga que nao tem horario para aquilo e ofereca outro.",
    "",
  ];
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
 * Pagar no local (tenant.pagarNoLocalAtivo): a cliente escolhe entre pagar online agora ou na
 * clinica, menos nos meses de tenant.mesesPagamentoAntecipado. Com isso da para agendar mesmo
 * sem Mercado Pago, nos meses que aceitam pagar no local.
 */

// Os meses de pagamento antecipado NAO vao no prompt: com a lista ali, o modelo aplicou a regra
// ao mes errado ("novembro so online" para um pedido de 12/01). Quem decide e o sistema: o
// campo `pagamento` de consultar_horarios (por dia) e a recusa do criar_agendamento.
function regrasPagamento(tenant, pagamentoDisponivel) {
  if (!tenant.pagarNoLocalAtivo) return [];
  if (!pagamentoDisponivel) {
    return [
      "## Pagamento",
      "O pagamento e feito no dia, na clinica: use `criar_agendamento` com pagamento \"local\" (o horario ja fica confirmado, sem link). Nao fale de pagamento online.",
      "Se `consultar_horarios` disser que naquele dia nao da para agendar por aqui, use `consultar_equipe` com tipo \"agendamento\".",
    ];
  }
  return [
    "## Pagamento",
    "Siga o campo `pagamento` que `consultar_horarios` devolve para o dia escolhido. Quando a cliente pode escolher, pergunte em uma frase curta se ela prefere pagar agora pelo link (Pix ou cartao) ou no dia, na clinica, e passe `pagamento` \"online\" ou \"local\" no `criar_agendamento`. Pagando no local o horario ja fica confirmado e nao tem link.",
    "Quando o campo disser que e SOMENTE online e antecipado, explique isso com naturalidade e use pagamento \"online\". Nunca diga que um dia exige pagamento antecipado sem o campo dizer isso.",
  ];
}

// Apresentacao configurada no painel (Agentes de IA > Persona). {link} vira o link do site quando
// o agendamento pelo site esta liberado.
// Cliente ja cadastrada: o pedido de nome sai do texto aqui (so a instrucao no prompt nao bastou, a
// IA copiava "Me manda o seu nome" para quem ja tinha cadastro).
function apresentacaoConfigurada(config, linkSite, siteLiberado, { semPedidoDeNome = false } = {}) {
  let texto = String(config.personaApresentacao || "").trim();
  if (!texto) return "";
  if (semPedidoDeNome) texto = texto.replace(/\b(o\s+)?seu\s+nome(\s+completo)?\s+e\s+/i, "");
  return texto.replace(/\{link\}/gi, siteLiberado ? linkSite : "").replace(/\s+([.!?,])/g, "$1").trim();
}

function buildSystemPrompt({ tenant, config, cliente, pagamentoDisponivel = true, linkJaEnviado = false, mesCitado = null, falasDaEquipe = [], funcionamento = [], diasFechados = [], inicioDeAtendimento = false, textoRecenteDaCliente = "" }) {
  const hoje = todayStr(tenant.timezone);
  const agora = zonedParts(new Date(), tenant.timezone);
  const linkSite = `${env.publicAppUrl}/s/${tenant.slug}`;
  const siteLiberado = pagamentoDisponivel || tenant.pagarNoLocalAtivo;
  const apresentacao = apresentacaoConfigurada(config, linkSite, siteLiberado, { semPedidoDeNome: Boolean(cliente) });
  const blocoAgendamento = siteLiberado
    ? [
        "## Link do site para agendar",
        linkSite,
        "Envie o link so no momento certo: quando a cliente pedir, quando quiser agendar sozinha, quando ja tiver decidido o servico e for mais facil ela escolher o horario no site, ou quando a apresentacao configurada trouxer o link. Fora isso, nunca no inicio da conversa nem junto de toda resposta.",
        linkJaEnviado
          ? "O link JA foi enviado nesta conversa: nao mande de novo, a menos que a cliente peca."
          : "O link ainda nao foi enviado nesta conversa.",
        "Agendar pela conversa tambem funciona: servico, dia e horario confirmados por `consultar_horarios`, nome da cliente, `criar_agendamento` e envio do link de pagamento que ele devolve (o horario fica reservado por 15 minutos e so e confirmado apos o pagamento).",
        ...regrasPagamento(tenant, pagamentoDisponivel),
      ]
    : [
        "## Agendamento (instrucao interna: nunca comente nada disto com a cliente)",
        "Neste estabelecimento o agendamento e confirmado pela equipe: NAO envie link de site e NAO use `criar_agendamento`.",
        "Quando a cliente quiser marcar, combine servico, dia e horario (confira com `consultar_horarios`), pegue o nome dela e use `consultar_equipe` com tipo \"agendamento\" descrevendo o pedido. Diga algo natural como \"Um minutinho, vou confirmar esse horario com a doutora.\" e nao confirme o agendamento ate a equipe responder.",
        "Nunca fale de problema de pagamento ou de sistema com a cliente.",
      ];
  return [
    `Voce e ${config.personaNome}, do atendimento de ${tenant.nome}.`,
    "Fale como alguem da recepcao: nunca se apresente como assistente virtual, IA, robo ou atendimento automatico. Se a cliente perguntar de verdade se esta falando com um robo ou com uma pessoa, nao negue: diga com naturalidade que e o atendimento automatico do estabelecimento e que chama alguem da equipe se ela preferir.",
    `Tom de voz: ${config.personaTom}.`,
    // Pedido da Dra (10/11/2026): "Bom dia meninas" deve receber a apresentacao da clinica, pedindo
    // nome e procedimento, com o link para agendar sozinha.
    apresentacao && inicioDeAtendimento
      ? [
          `A cliente esta COMECANDO o atendimento agora. Se ela so cumprimentou, responda com a saudacao do horario ("${saudacaoDoHorario(agora.hour)}") seguida EXATAMENTE desta apresentacao do estabelecimento, sem trocar nomes nem palavras: "${apresentacao}"`,
          cliente
            ? `Ela ja e cliente cadastrada (${cliente.nome}): cumprimente pelo primeiro nome logo depois da saudacao e NAO peca o nome dela.`
            : "",
          "Se ela ja disse o que quer, responda a pergunta e use da apresentacao so o que faltar.",
        ]
          .filter(Boolean)
          .join("\n")
      : apresentacao
        ? `Apresentacao configurada pelo estabelecimento (o atendimento ja esta em andamento: use so como referencia de tom): ${apresentacao}`
        : "",
    `Hoje e ${WEEKDAY_NAMES[agora.weekday]}, ${formatDateBr(new Date(), tenant.timezone)} (${hoje}), agora sao ${String(agora.hour).padStart(2, "0")}:${String(agora.minute).padStart(2, "0")} (use "${saudacaoDoHorario(agora.hour)}" ao cumprimentar). Fuso: ${tenant.timezone}.`,
    "Calendario dos proximos dias (use esta lista para converter dia da semana em data; nunca calcule por conta propria):",
    proximosDias(hoje, 14, { funcionamento, diasFechados }),
    ...linhasDatasCitadas(datasCitadas(textoRecenteDaCliente, hoje), { funcionamento, diasFechados }),
    ...blocoFuncionamento(funcionamento, diasFechados),
    // "no dia 23" depois de a conversa toda ser sobre dezembro virava 23/11 (Studio Bella, 04/11/2026)
    mesCitado
      ? `Mes que a cliente citou por ultimo nesta conversa: ${mesCitado}. Dia sem mes ("dia 23") e desse mes, a menos que ela diga outro.`
      : "",
    cliente
      ? `Cliente identificado pelo telefone: ${cliente.nome}.`
      : "Cliente ainda nao cadastrado. Nao peca o nome para mandar o link do site nem para informar servicos e precos; so pergunte o nome se ele preferir agendar pela conversa.",
    "",
    REGRAS,
    "",
    // So o historico nao bastou: a IA repetia o preco da lista por cima do que a doutora tinha passado.
    ...(falasDaEquipe.length
      ? [
          "## O que a equipe ja disse para esta cliente (vale mais que a lista de servicos e que as Informacoes do negocio)",
          ...falasDaEquipe.map((t) => `- ${t}`),
          "Use estes valores e combinados. Se a lista de servicos mostrar outro preco ou outro formato, NAO mencione a lista: siga a equipe. Se a duvida da cliente nao estiver respondida aqui, use `consultar_equipe`.",
          "",
        ]
      : []),
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

// Texto final do agendamento confirmado, no formato que a Dra pediu (10/11/2026): "Seu agendamento
// foi concluido com sucesso para a data tal com a Ana Caroline, pagamento no local".
const DIAS_EXTENSO = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
function mensagemAgendamentoConcluido(ag) {
  const dia = DIAS_EXTENSO[new Date(`${ag.data}T12:00:00Z`).getUTCDay()];
  const quando = `${dia}, ${ag.data.slice(8, 10)}/${ag.data.slice(5, 7)}, às ${ag.hora}`;
  const pagamento = ag.situacaoPagamento === "PAGO_ONLINE" ? "Pagamento já confirmado." : ag.modoPagamento === "LOCAL" ? "Pagamento no dia, na clínica." : "";
  return `Seu agendamento foi concluído com sucesso! ✅ ${ag.servicos.map((s) => s.nome).join(" + ")} com ${ag.profissional?.nome || "a equipe"}, ${quando}. ${pagamento}`.trim();
}

// Horario que a cliente escreveu ("as 15h30", "15:30", "as 15h"), so quando ha um unico na mensagem.
// Datas como 22/12 nao casam (barra). Usado quando a IA nao passa hora_desejada.
function horaPedidaNaMensagem(texto) {
  const achados = [...String(texto || "").matchAll(/(?<![\d/])([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?(?![\d/])/gi)].map(
    (m) => `${m[1].padStart(2, "0")}:${m[2] || "00"}`
  );
  const unicos = [...new Set(achados)];
  return unicos.length === 1 ? unicos[0] : undefined;
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

  // Agendamento da propria cliente que ocupa este horario (comeca nele ou esta em andamento nele).
  async function agendamentoDaClienteNoHorario(clienteId, data, hora) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || "")) || !/^\d{2}:\d{2}$/.test(String(hora || ""))) return null;
    const momento = zonedToUtc(data, hora, tenant.timezone);
    const ag = await prisma.agendamento.findFirst({
      where: { tenantId, clienteId, status: { in: ["CONFIRMADO", "AGUARDANDO_PAGAMENTO"] }, inicio: { lte: momento }, fimIntervalo: { gt: momento } },
      select: { id: true },
    });
    return ag ? agendamentoService.obterSerializado(tenantId, ag.id) : null;
  }

  // Horarios da cliente no dia consultado: sem isso a IA dizia que o horario dela "nao estava
  // disponivel" (era ocupado pelo proprio agendamento) e a cliente achou que nao estava marcada.
  async function agendamentosDaClienteNoDia(data) {
    const cliente = await clienteAtual();
    if (!cliente || !/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return [];
    const ags = await prisma.agendamento.findMany({
      where: {
        tenantId,
        clienteId: cliente.id,
        status: { in: ["CONFIRMADO", "AGUARDANDO_PAGAMENTO"] },
        inicio: { gte: zonedToUtc(data, "00:00", tenant.timezone), lte: zonedToUtc(data, "23:59", tenant.timezone) },
      },
      include: agendamentoService.INCLUDE_COMPLETO,
      orderBy: { inicio: "asc" },
    });
    return ags.map((a) => {
      const s = agendamentoService.serializar(a, tenant);
      return { hora: s.hora, horaFim: s.horaFim, servicos: s.servicos.map((x) => x.nome), profissional: s.profissional?.nome, status: s.status };
    });
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
        if (!ctx.pagamentoDisponivel && !tenant.pagarNoLocalAtivo) return { ok: false, error: "Agendamento online indisponivel neste estabelecimento. Use consultar_equipe com tipo agendamento." };
        return { ok: true, link: `${env.publicAppUrl}/s/${tenant.slug}` };
      },
    },
    {
      name: "registrar_nome_cliente",
      description:
        "Cadastra o nome do cliente deste telefone. So com o PROPRIO nome que a cliente disse; nunca com nome de outra pessoa (amiga, mae, contato encaminhado com telefone). Cadastro que ja tem nome nao e trocado.",
      schema: z.object({ nome: z.string().min(2).describe("Nome completo informado pelo cliente") }),
      handler: async ({ nome }) => {
        ctx.cliente = await encontrarOuCriarCliente(tenantId, { telefone, nome });
        if (ctx.cliente.nome !== String(nome).trim()) {
          return { ok: true, nome: ctx.cliente.nome, aviso: `Este telefone ja e cadastro de ${ctx.cliente.nome}; o nome nao foi trocado. Se for outra pessoa, ela agenda pelo proprio numero ou a equipe cadastra.` };
        }
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
          ...(ctx.equipePassouValores
            ? { valores: "A equipe ja passou valores para esta cliente: use SO os valores da equipe (no topo das instrucoes). Os precos desta lista foram omitidos de proposito." }
            : {}),
          servicos: servicos.map((s) => ({
            id: s.id,
            nome: s.nome,
            categoria: s.categoria,
            descricao: s.descricao,
            preco: ctx.equipePassouValores ? "usar o valor passado pela equipe" : brl(s.preco),
            duracaoMin: s.duracaoMin,
            profissionais: s.profissionais.filter((p) => p.profissional.ativo).map((p) => ({ id: p.profissional.id, nome: p.profissional.nome })),
          })),
        };
      },
    },
    {
      name: "consultar_horarios",
      description:
        "Consulta horarios livres para um ou mais servicos (no mesmo atendimento). Sem data, retorna os proximos dias com horario. Considera jornada, folgas, bloqueios, Google Calendar, duracao total e intervalos. Se nenhuma profissional faz todos os servicos juntos, devolve `separados` com os horarios de cada servico.",
      schema: z.object({
        servico_ids: z.array(z.string()).optional().describe("Ids (ou nomes exatos) dos servicos escolhidos, na ordem. Para remarcar, use agendamento_id no lugar"),
        agendamento_id: z.string().optional().describe("Para REMARCAR um agendamento que a cliente ja tem (id de meus_agendamentos): usa os servicos e a profissional dele"),
        profissional_id: z.string().optional().describe("Id do profissional, se o cliente escolheu"),
        data: z.string().optional().describe("Data AAAA-MM-DD. Se o cliente citou um dia (ex.: sexta), passe a data tirada do calendario do prompt"),
        periodo: z.enum(["manha", "tarde", "noite"]).optional().describe("Se o cliente pediu um periodo: manha (antes das 12:00), tarde (12:00 a 17:59), noite (18:00 em diante)"),
        hora_desejada: z.string().optional().describe("HH:mm, se a cliente pediu um horario especifico (ex.: 14:00)"),
      }),
      handler: async (entrada) => {
        // Remarcar: servicos vem do agendamento da cliente (a IA trocou a depilacao da Mariana por
        // design de sobrancelha, assunto de outubro no historico, 09/11/2026).
        let remarcando = null;
        if (entrada.agendamento_id) {
          remarcando = await agendamentoDoCliente(entrada.agendamento_id);
          if (!remarcando) return { ok: false, error: "Agendamento nao encontrado para esta cliente. Chame meus_agendamentos." };
        }
        if (!remarcando && !(entrada.servico_ids || []).length) return { ok: false, error: "Informe servico_ids (ou agendamento_id para remarcar)." };
        const servico_ids = remarcando ? remarcando.servicos.map((s) => s.servicoId) : await idsDeServicos(entrada.servico_ids);
        const profissional_id = remarcando && !entrada.profissional_id ? remarcando.profissionalId : await idDeProfissional(entrada.profissional_id);
        const { data, periodo } = entrada;
        const hora_desejada = entrada.hora_desejada || horaPedidaNaMensagem(ctx.textoDaCliente);
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
        // Pagar no local por dia: so a regra no prompt nao bastou (em 08/12 a IA ofereceu "pagamento no dia").
        const pagamentoDoDia = (dia) => {
          if (!tenant.pagarNoLocalAtivo) return {};
          return agendamentoService.aceitaPagarNoLocal(tenant, zonedToUtc(dia, "12:00", tenant.timezone))
            ? { pagamento: "a cliente escolhe: online agora ou no dia, na clinica" }
            : ctx.pagamentoDisponivel
              ? { pagamento: "SOMENTE online e antecipado neste mes (nao existe pagar no local; explique isso antes de agendar)" }
              : { pagamento: "neste mes nao da para agendar por aqui: use consultar_equipe com tipo agendamento, sem falar de sistema" };
        };
        const consultar = async (ids, profId) => {
          if (data) {
            const r = await disponibilidade.listarHorarios({ tenantId, servicoIds: ids, profissionalId: profId, data, excluirAgendamentoId: remarcando?.id });
            const daCliente = (await agendamentosDaClienteNoDia(data)).filter((a) => !remarcando || a.hora !== remarcando.hora);
            const avisoDaCliente = daCliente.length
              ? {
                  agendamentosDaClienteNesteDia: daCliente,
                  avisoCliente:
                    "A cliente JA TEM horario marcado neste dia (acima). Horarios ocupados por ele nao aparecem como livres porque ela ja esta marcada ali: diga isso a ela e nunca que o horario 'acabou de ser reservado' ou 'nao esta disponivel'.",
                }
              : {};
            // Clinica fechada no dia: o sistema avisa (so "sem horario" fez a IA dizer que atendia na segunda)
            const fechado = r.profissionais.length > 0 && r.profissionais.every((p) => ["FECHADO_ROTINA", "FECHADO_FORA_ROTINA"].includes(p.motivo));
            if (fechado) {
              return {
                ok: true,
                data,
                diaSemana: WEEKDAY_NAMES[new Date(`${data}T12:00:00Z`).getUTCDay()],
                fechado: true,
                aviso: "A clinica NAO abre neste dia. Diga isso a cliente (nao diga so que nao tem horario) e ofereca o proximo dia aberto, consultando sem data ou com a data dele.",
              };
            }
            return {
              ok: true,
              data,
              ...pagamentoDoDia(data),
              ...avisoDaCliente,
              diaSemana: WEEKDAY_NAMES[new Date(`${data}T12:00:00Z`).getUTCDay()],
              duracaoTotalMin: r.duracao.ocupacaoTotal,
              periodo: periodo || null,
              ...(desejo !== null ? { horaDesejadaLivre: r.profissionais.some((p) => p.horarios.includes(hora_desejada)) } : {}),
              profissionais: r.profissionais.map((p) => {
                const emOrdem = p.horarios.filter(noPeriodo);
                const livres = ordenar(emOrdem);
                return {
                  id: p.profissionalId,
                  nome: p.nome,
                  horarios: livres.slice(0, 3),
                  outrosHorariosLivres: Math.max(0, livres.length - 3),
                  // "tem os ultimos horarios?" voltava 13:00-14:00 sem dizer que eram os unicos (Gab, 10/11/2026)
                  ...(emOrdem.length > 3 ? { ultimosHorarios: emOrdem.slice(-3) } : {}),
                  ...(emOrdem.length && emOrdem.length <= 3 ? { unicosHorariosDoDia: true } : {}),
                  ...(p.motivo === "FOLGA_SEMANAL" ? { observacao: `${p.nome} nao atende neste dia da semana` } : {}),
                };
              }),
              ...(r.profissionais.every((p) => !p.horarios.some(noPeriodo))
                ? { semHorario: "A clinica ABRE neste dia; so nao tem horario livre para este pedido. Nao diga que esta fechada." }
                : {}),
              orientacao:
                "Ofereca no maximo 3 opcoes, sem lista longa. A lista e um resumo: antes de dizer que um horario pedido nao esta livre, consulte de novo com hora_desejada. Pedido de ultimo horario / mais tarde: ofereca `ultimosHorarios`. Horario pedido que nao tem: diga claramente que esse nao tem e quais estao livres; com `unicosHorariosDoDia`, diga que sao os unicos horarios livres do dia e deixe ela escolher." +
                (remarcando ? ` Remarcando o agendamento de ${remarcando.servicos.map((s) => s.nome).join(" + ")}: fale desse servico e use reagendar_agendamento.` : ""),
            };
          }
          const dias = await disponibilidade.proximosDiasDisponiveis({ tenantId, servicoIds: ids, profissionalId: profId, dias: 21, maxResultados: periodo ? 10 : 5 });
          return {
            ok: true,
            periodo: periodo || null,
            dias: dias
              .map((d) => ({
                data: d.data,
                ...pagamentoDoDia(d.data),
                diaSemana: WEEKDAY_NAMES[new Date(`${d.data}T12:00:00Z`).getUTCDay()],
                profissionais: d.profissionais
                  .map((p) => ({ id: p.profissionalId, nome: p.nome, horarios: ordenar(p.horarios.filter(noPeriodo)).slice(0, 3) }))
                  .filter((p) => p.horarios.length > 0),
              }))
              .filter((d) => d.profissionais.length > 0)
              .slice(0, 5),
            orientacao: "Dia que nao aparece aqui nao esta fechado: so nao tem horario livre para o pedido. Fechado e so o que o calendario do prompt marca como FECHADO.",
          };
        };

        // Servicos que nenhuma profissional faz junta (ex.: pe e mao com uma, sobrancelha com outra): a
        // consulta junta voltava vazia e a IA disse "22/12 a clinica esta fechada" (Duda, 10/11/2026).
        if (servico_ids.length > 1) {
          const servs = await disponibilidade.resolverServicos(tenantId, servico_ids);
          const juntos = disponibilidade.profissionaisHabilitados(servs).filter((id) => !profissional_id || id === profissional_id);
          if (!juntos.length) {
            const porServico = [];
            for (const sv of servs) {
              const prof = profissional_id && sv.profissionais.some((p) => p.profissionalId === profissional_id) ? profissional_id : undefined;
              porServico.push({ servico: sv.nome, servico_id: sv.id, ...(await consultar([sv.id], prof)) });
            }
            return {
              ok: true,
              separados: true,
              orientacao:
                "Nenhuma profissional faz todos esses servicos no mesmo atendimento: eles sao agendados separados, cada um com quem faz (a clinica NAO esta fechada). Responda SERVICO POR SERVICO: para cada um, diga se o horario pedido esta livre (horaDesejadaLivre) e com quem; quando nao estiver, ofereca os mais proximos daquele servico. Nunca diga que o horario 'nao tem' para todos se algum servico tem. Ex.: \"Pe e mao as 15:30 com a Ana Caroline tem sim. Sobrancelha as 15:30 nao tem; com a Barbara tem 14:30 ou 16:00.\" Ao confirmar, crie um agendamento para cada servico com criar_agendamento.",
              porServico,
            };
          }
        }
        return { ok: true, ...(await consultar(servico_ids, profissional_id)) };
      },
    },
    {
      name: "criar_agendamento",
      description:
        "Registra o agendamento. Pagamento online: fica Aguardando pagamento e retorna o link. Pagamento local (quando permitido): ja fica confirmado, sem link. Use somente horario retornado por consultar_horarios.",
      schema: z.object({
        servico_ids: z.array(z.string()).min(1),
        profissional_id: z.string(),
        data: z.string().describe("AAAA-MM-DD"),
        hora: z.string().describe("HH:mm"),
        nome_cliente: z.string().optional().describe("Nome do cliente, se ainda nao cadastrado"),
        pagamento: z
          .enum(["online", "local"])
          .optional()
          .describe("online = link agora; local = paga no dia, na clinica (so se o estabelecimento permite). Use o que a CLIENTE escolheu; se ela ainda nao disse como prefere pagar, pergunte antes de chamar esta ferramenta."),
      }),
      handler: async (entrada) => {
        const { data, hora, nome_cliente } = entrada;
        const local = entrada.pagamento === "local" || (!ctx.pagamentoDisponivel && tenant.pagarNoLocalAtivo);
        if (!ctx.pagamentoDisponivel && !local) {
          return { ok: false, error: "Agendamento pela conversa indisponivel aqui (sem pagamento online). Use consultar_equipe com tipo agendamento. Nao fale disso com a cliente." };
        }
        if (local && /^\d{4}-\d{2}-\d{2}$/.test(data) && /^\d{2}:\d{2}$/.test(hora) && !agendamentoService.aceitaPagarNoLocal(tenant, zonedToUtc(data, hora, tenant.timezone))) {
          return ctx.pagamentoDisponivel
            ? { ok: false, error: "Neste mes o pagamento e antecipado: so da para agendar com pagamento online. NAO use consultar_equipe por isso: explique a cliente com naturalidade que neste mes o horario e confirmado com o pagamento antes e, se ela aceitar, chame de novo com pagamento online." }
            : { ok: false, error: "Neste mes o agendamento exige pagamento antecipado. Use consultar_equipe com tipo agendamento. Nao fale de sistema com a cliente." };
        }
        const servico_ids = await idsDeServicos(entrada.servico_ids);
        const profissional_id = await idDeProfissional(entrada.profissional_id);
        const cliente = await clienteAtual();
        if (!cliente && !nome_cliente) return { ok: false, error: "Pergunte o nome do cliente antes de agendar." };
        // Ja criou com link e a cliente escolheu pagar no local: converte a reserva dela em vez de
        // bater no proprio horario ("ja foi reservado").
        if (local && cliente) {
          const reserva = await prisma.agendamento.findFirst({
            where: { tenantId, clienteId: cliente.id, profissionalId: profissional_id, status: "AGUARDANDO_PAGAMENTO", inicio: zonedToUtc(data, hora, tenant.timezone) },
          });
          if (reserva) {
            const ag = await agendamentoService.mudarParaPagarNoLocal(tenantId, reserva.id);
            return {
              ok: true,
              agendamento: resumoAgendamento(ag),
              mensagemFinal: mensagemAgendamentoConcluido(ag),
              observacao: "A reserva que estava aguardando pagamento virou pagamento no local e ja esta confirmada. O link anterior nao vale mais. Envie `mensagemFinal` exatamente como esta.",
            };
          }
        }
        // A cliente ja esta marcada nesse horario: o "sim" da Josefa (07/11) depois da confirmacao
        // fez a IA tentar marcar de novo, bater no proprio horario e dizer "acabou de ser reservado".
        const proprio = cliente ? await agendamentoDaClienteNoHorario(cliente.id, data, hora) : null;
        if (proprio) {
          return {
            ok: true,
            jaAgendado: true,
            agendamento: resumoAgendamento(proprio),
            orientacao: "A cliente JA ESTA AGENDADA neste horario (este agendamento e dela). Nao crie outro e nunca diga que o horario foi reservado por outra pessoa: confirme que o horario dela esta marcado (servico, dia e hora).",
          };
        }
        const ag = await agendamentoService.criar({
          tenantId,
          origem: "AGENTE",
          servicoIds: servico_ids,
          profissionalId: profissional_id,
          data,
          hora,
          pagamento: local ? "LOCAL" : undefined,
          ...(cliente ? { clienteId: cliente.id } : { cliente: { telefone, nome: nome_cliente } }),
        });
        ctx.cliente = await clienteAtual();
        if (ag.status === "CONFIRMADO") {
          return {
            ok: true,
            agendamento: resumoAgendamento(ag),
            mensagemFinal: mensagemAgendamentoConcluido(ag),
            orientacao: "Agendamento confirmado. Responda com `mensagemFinal` exatamente como esta, sem reescrever e sem acrescentar nada.",
          };
        }
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
      name: "confirmar_presenca",
      description: "Registra que a cliente confirmou presenca no agendamento (resposta ao lembrete). Use o id de meus_agendamentos.",
      schema: z.object({ agendamento_id: z.string() }),
      handler: async ({ agendamento_id }) => {
        const ag = await agendamentoDoCliente(agendamento_id);
        if (!ag) return { ok: false, error: "Agendamento nao encontrado para esta cliente. Chame meus_agendamentos." };
        await agendamentoService.confirmarPresenca(tenantId, agendamento_id);
        return { ok: true, data: ag.data, hora: ag.hora, orientacao: "Presenca registrada. Agradeca e feche com o dia e a hora (regra 23.1)." };
      },
    },
    {
      name: "consultar_regra_cancelamento",
      description: "Mostra qual regra de reembolso se aplica e o valor exato que sera devolvido se o agendamento for cancelado agora.",
      schema: z.object({ agendamento_id: z.string() }),
      handler: async ({ agendamento_id }) => {
        if (!(await agendamentoDoCliente(agendamento_id))) return { ok: false, error: "Agendamento nao encontrado para este cliente." };
        const r = await agendamentoService.simularCancelamento(tenantId, agendamento_id);
        // Pagar no local: nada foi pago, entao nao existe reembolso para falar ("reembolso integral" confundia)
        if (!r.valorPago) return { ok: true, regra: "Nada foi pago antecipado: cancelar nao tem custo e nao ha reembolso. Nao fale de reembolso.", valorPago: brl(0) };
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
