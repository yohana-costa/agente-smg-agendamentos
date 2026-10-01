// Agente de Gestao (documento Agentes de IA, secao 3): funcionario do estabelecimento no WhatsApp.
// Cada ferramenta declara modulo + acao; so sao expostas as permitidas para o numero autorizado.
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const disponibilidade = require("../../services/disponibilidade.service");
const agendamentoService = require("../../services/agendamento.service");
const bloqueioService = require("../../services/bloqueio.service");
const metricas = require("../../services/metricas.service");
const vendaService = require("../../services/venda.service");
const { encontrarOuCriarCliente } = require("../../services/cliente.service");
const { zonedParts, todayStr, dayRangeUtc, parsePeriod, WEEKDAY_NAMES, formatDateBr } = require("../../lib/time");
const { brl, normalizePhone } = require("../../lib/helpers");

const MODULOS = ["agenda", "clientes", "servicos", "produtos", "equipe", "financeiro", "desempenho"];

const reais = (v) => Math.round(Number(v || 0) * 100);

function buildSystemPrompt({ tenant, autorizado, ferramentas }) {
  return [
    `Voce e o Agente de Gestao de ${tenant.nome}: funciona como um funcionario do estabelecimento dentro do WhatsApp.`,
    `Voce esta falando com ${autorizado.nome} (numero autorizado).`,
    `Hoje e ${WEEKDAY_NAMES[zonedParts(new Date(), tenant.timezone).weekday]}, ${formatDateBr(new Date(), tenant.timezone)} (${todayStr(tenant.timezone)}).`,
    "",
    "Regras:",
    "- Use apenas dados retornados pelas ferramentas. Nunca invente numeros, nomes ou horarios.",
    "- Para alterar dados, confirme o pedido em uma frase antes quando houver ambiguidade (ex.: qual profissional, qual cliente).",
    "- Se a pessoa pedir algo que nao esta entre suas ferramentas, diga que este numero nao tem permissao ou que a acao nao esta disponivel pelo WhatsApp.",
    "- Cancelamentos: mostre a regra e o valor a devolver (consultar primeiro) e so execute com confirmacao.",
    "- Valores monetarios nas ferramentas sao em reais (ex.: 49.90). Respostas curtas, organizadas em listas quando util.",
    "",
    `Ferramentas disponiveis para este numero: ${ferramentas.join(", ") || "nenhuma"}.`,
  ].join("\n");
}

function resumoAg(a) {
  return {
    id: a.id,
    data: a.data,
    hora: `${a.hora}-${a.horaFim}`,
    cliente: a.cliente?.nome,
    telefone: a.cliente?.telefone,
    servicos: a.servicos.map((s) => s.nome).join(" + "),
    profissional: a.profissional?.nome,
    status: a.pendenteFinalizacao ? "PENDENTE_FINALIZACAO" : a.status,
    pagamento: a.situacaoPagamento,
    valor: brl(a.valorTotal),
  };
}

function allTools(ctx) {
  const { tenant } = ctx;
  const tenantId = tenant.id;
  const tz = tenant.timezone;

  return [
    // ---------- agenda ----------
    {
      modulo: "agenda",
      acao: "consultar",
      name: "consultar_agenda",
      description: "Agenda de um dia (padrao: hoje), opcionalmente de um profissional.",
      schema: z.object({ data: z.string().optional().describe("AAAA-MM-DD"), profissional_id: z.string().optional() }),
      handler: async ({ data, profissional_id }) => {
        const dia = data || todayStr(tz);
        const { start, end } = dayRangeUtc(dia, tz);
        const ags = await prisma.agendamento.findMany({
          where: { tenantId, inicio: { gte: start, lt: end }, status: { notIn: ["CANCELADO"] }, ...(profissional_id ? { profissionalId: profissional_id } : {}) },
          include: agendamentoService.INCLUDE_COMPLETO,
          orderBy: { inicio: "asc" },
        });
        return { ok: true, data: dia, agendamentos: ags.map((a) => resumoAg(agendamentoService.serializar(a, tenant))) };
      },
    },
    {
      modulo: "agenda",
      acao: "consultar",
      name: "horarios_livres",
      description: "Horarios livres para servicos numa data.",
      schema: z.object({ servico_ids: z.array(z.string()).min(1), data: z.string(), profissional_id: z.string().optional() }),
      handler: async ({ servico_ids, data, profissional_id }) => {
        const r = await disponibilidade.listarHorarios({ tenantId, servicoIds: servico_ids, data, profissionalId: profissional_id });
        return { ok: true, profissionais: r.profissionais.map((p) => ({ id: p.profissionalId, nome: p.nome, horarios: p.horarios })) };
      },
    },
    {
      modulo: "agenda",
      acao: "alterar",
      name: "criar_agendamento",
      description: "Cria agendamento manual. pagamento: LOCAL (dinheiro/maquininha no local) ou LINK (envia link de pagamento ao cliente). encaixe=true forca horario com conflito.",
      schema: z.object({
        cliente_telefone: z.string(),
        cliente_nome: z.string().optional(),
        servico_ids: z.array(z.string()).min(1),
        profissional_id: z.string(),
        data: z.string(),
        hora: z.string(),
        pagamento: z.enum(["LOCAL", "LINK"]).default("LOCAL"),
        encaixe: z.boolean().optional(),
        observacoes: z.string().optional(),
      }),
      handler: async (i) => {
        const ag = await agendamentoService.criar({
          tenantId,
          origem: "MANUAL",
          cliente: { telefone: i.cliente_telefone, nome: i.cliente_nome },
          servicoIds: i.servico_ids,
          profissionalId: i.profissional_id,
          data: i.data,
          hora: i.hora,
          pagamento: i.pagamento,
          encaixe: Boolean(i.encaixe),
          observacoes: i.observacoes,
        });
        return { ok: true, agendamento: resumoAg(ag) };
      },
    },
    {
      modulo: "agenda",
      acao: "alterar",
      name: "reagendar_agendamento",
      description: "Remarca um agendamento (mantem o pagamento; o cliente e avisado automaticamente).",
      schema: z.object({ agendamento_id: z.string(), data: z.string(), hora: z.string(), profissional_id: z.string().optional(), encaixe: z.boolean().optional() }),
      handler: async (i) => {
        const r = await agendamentoService.reagendar(tenantId, i.agendamento_id, {
          data: i.data,
          hora: i.hora,
          profissionalId: i.profissional_id,
          porCliente: false,
          encaixe: Boolean(i.encaixe),
        });
        return { ok: true, agendamento: resumoAg(r.agendamento) };
      },
    },
    {
      modulo: "agenda",
      acao: "consultar",
      name: "consultar_regra_cancelamento",
      description: "Mostra regra e valor a devolver se cancelar ou marcar no-show agora.",
      schema: z.object({ agendamento_id: z.string(), tipo: z.enum(["CANCELAMENTO", "NO_SHOW"]).default("CANCELAMENTO") }),
      handler: async ({ agendamento_id, tipo }) => {
        const r = await agendamentoService.simularCancelamento(tenantId, agendamento_id, { tipo });
        return { ok: true, regra: r.descricao, valorPago: brl(r.valorPago), valorDevolvido: brl(r.valor) };
      },
    },
    {
      modulo: "agenda",
      acao: "alterar",
      name: "cancelar_agendamento",
      description: "Cancela ou registra no-show (reembolso automatico conforme politica). So apos mostrar a regra e confirmar.",
      schema: z.object({ agendamento_id: z.string(), tipo: z.enum(["CANCELAMENTO", "NO_SHOW"]).default("CANCELAMENTO"), motivo: z.string().optional(), confirmado: z.boolean() }),
      handler: async ({ agendamento_id, tipo, motivo, confirmado }) => {
        if (!confirmado) return { ok: false, error: "Mostre a regra e o valor e peca confirmacao antes." };
        const r = await agendamentoService.cancelar(tenantId, agendamento_id, { tipo, motivo });
        return { ok: true, status: r.agendamento.status, valorDevolvido: brl(r.reembolso.valor) };
      },
    },
    {
      modulo: "agenda",
      acao: "alterar",
      name: "iniciar_atendimento",
      description: "Marca o atendimento como iniciado (botao Iniciar). So para agendamento confirmado.",
      schema: z.object({ agendamento_id: z.string() }),
      handler: async ({ agendamento_id }) => {
        const a = await agendamentoService.iniciar(tenantId, agendamento_id);
        return { ok: true, status: a.status };
      },
    },
    {
      modulo: "agenda",
      acao: "alterar",
      name: "finalizar_atendimento",
      description:
        "Finaliza o atendimento (botao Finalizar). Se houver valor em aberto (pagamento no local), informe a forma: DINHEIRO ou MAQUININHA. O retorno sugerido do servico e aceito automaticamente.",
      schema: z.object({ agendamento_id: z.string(), forma_pagamento: z.enum(["DINHEIRO", "MAQUININHA"]).optional() }),
      handler: async ({ agendamento_id, forma_pagamento }) => {
        const previa = await agendamentoService.previaFinalizacao(tenantId, agendamento_id);
        if (previa.valorEmAberto > 0 && !forma_pagamento) {
          return { ok: false, error: `Ha ${brl(previa.valorEmAberto)} em aberto. Pergunte se foi pago em dinheiro ou maquininha.` };
        }
        const a = await agendamentoService.finalizar(tenantId, agendamento_id, { formaPagamento: forma_pagamento, retorno: { acao: "ACEITAR" } });
        return { ok: true, status: a.status, retornoSugerido: a.retornoSugerido ? formatDateBr(a.retornoSugerido, tz) : null };
      },
    },
    {
      modulo: "agenda",
      acao: "alterar",
      name: "bloquear_horario",
      description:
        "Bloqueia um periodo na agenda de um profissional. Se houver agendamentos afetados, retorna a lista; reenvie com 'decisoes' (CANCELAR ou REAGENDAR com data/hora) para cada um.",
      schema: z.object({
        profissional_id: z.string(),
        data: z.string(),
        hora_inicio: z.string(),
        hora_fim: z.string(),
        motivo: z.string().optional(),
        semanal: z.boolean().optional(),
        decisoes: z
          .array(z.object({ agendamento_id: z.string(), acao: z.enum(["CANCELAR", "REAGENDAR"]), data: z.string().optional(), hora: z.string().optional() }))
          .optional(),
      }),
      handler: async (i) => {
        try {
          const r = await bloqueioService.criarBloqueio(tenantId, {
            profissionalId: i.profissional_id,
            data: i.data,
            horaInicio: i.hora_inicio,
            horaFim: i.hora_fim,
            motivo: i.motivo,
            semanal: Boolean(i.semanal),
            decisoes: (i.decisoes || []).map((d) => ({ agendamentoId: d.agendamento_id, acao: d.acao, data: d.data, hora: d.hora })),
          });
          return { ok: true, bloqueioId: r.bloqueio.id, decisoesAplicadas: r.resultados };
        } catch (error) {
          if (error.details?.requerDecisao) return { ok: false, error: error.message, afetados: error.details.afetados };
          throw error;
        }
      },
    },
    {
      modulo: "agenda",
      acao: "alterar",
      name: "fechar_dia",
      description: "Fecha um dia fora da rotina. Se houver agendamentos, retorna a lista para decisao (igual bloquear_horario).",
      schema: z.object({
        data: z.string(),
        motivo: z.string().optional(),
        decisoes: z
          .array(z.object({ agendamento_id: z.string(), acao: z.enum(["CANCELAR", "REAGENDAR"]), data: z.string().optional(), hora: z.string().optional() }))
          .optional(),
      }),
      handler: async (i) => {
        try {
          const r = await bloqueioService.fecharDia(tenantId, {
            data: i.data,
            motivo: i.motivo,
            decisoes: (i.decisoes || []).map((d) => ({ agendamentoId: d.agendamento_id, acao: d.acao, data: d.data, hora: d.hora })),
          });
          return { ok: true, data: r.dia.data, decisoesAplicadas: r.resultados };
        } catch (error) {
          if (error.details?.requerDecisao) return { ok: false, error: error.message, afetados: error.details.afetados };
          throw error;
        }
      },
    },
    // ---------- clientes ----------
    {
      modulo: "clientes",
      acao: "consultar",
      name: "buscar_cliente",
      description: "Busca clientes por nome ou telefone e retorna historico resumido.",
      schema: z.object({ termo: z.string() }),
      handler: async ({ termo }) => {
        const digits = normalizePhone(termo);
        const clientes = await prisma.cliente.findMany({
          where: {
            tenantId,
            mescladoEmId: null,
            OR: [{ nome: { contains: termo, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ telefone: { contains: termo.replace(/\D/g, "") } }] : [])],
          },
          take: 10,
          include: { agendamentos: { where: { status: "CONCLUIDO" }, orderBy: { inicio: "desc" }, take: 3, include: { servicos: true } } },
        });
        return {
          ok: true,
          clientes: clientes.map((c) => ({
            id: c.id,
            nome: c.nome,
            telefone: c.telefone,
            pontos: c.pontos,
            ultimos: c.agendamentos.map((a) => ({ data: zonedParts(a.inicio, tz).date, servicos: a.servicos.map((s) => s.nome).join(" + ") })),
          })),
        };
      },
    },
    {
      modulo: "clientes",
      acao: "consultar",
      name: "clientes_por_segmento",
      description: "Lista clientes de um segmento: ATIVO, RETORNO_PROXIMO, RETORNO_ATRASADO ou INATIVO.",
      schema: z.object({ segmento: z.enum(["ATIVO", "RETORNO_PROXIMO", "RETORNO_ATRASADO", "INATIVO"]) }),
      handler: async ({ segmento }) => {
        const seg = await metricas.segmentosClientes(tenantId);
        const ids = Object.entries(seg.porCliente).filter(([, v]) => v.segmento === segmento).map(([id]) => id);
        const clientes = await prisma.cliente.findMany({ where: { id: { in: ids.slice(0, 50) } }, select: { id: true, nome: true, telefone: true } });
        return { ok: true, total: ids.length, clientes: clientes.map((c) => ({ ...c, retornoSugerido: seg.porCliente[c.id].retornoSugerido })) };
      },
    },
    {
      modulo: "clientes",
      acao: "alterar",
      name: "cadastrar_cliente",
      description: "Cadastra cliente (ou atualiza o nome se o telefone ja existir).",
      schema: z.object({ nome: z.string(), telefone: z.string(), observacoes: z.string().optional() }),
      handler: async ({ nome, telefone, observacoes }) => {
        const c = await encontrarOuCriarCliente(tenantId, { nome, telefone });
        if (observacoes) await prisma.cliente.update({ where: { id: c.id }, data: { observacoes } });
        return { ok: true, cliente: { id: c.id, nome: c.nome, telefone: c.telefone } };
      },
    },
    // ---------- servicos ----------
    {
      modulo: "servicos",
      acao: "consultar",
      name: "listar_servicos",
      description: "Lista servicos (ativos e inativos) com preco, duracao, intervalo e profissionais.",
      schema: z.object({}),
      handler: async () => {
        const servicos = await prisma.servico.findMany({ where: { tenantId }, include: { profissionais: { include: { profissional: { select: { nome: true } } } } }, orderBy: { nome: "asc" } });
        return {
          ok: true,
          servicos: servicos.map((s) => ({
            id: s.id,
            nome: s.nome,
            categoria: s.categoria,
            preco: brl(s.preco),
            duracaoMin: s.duracaoMin,
            intervaloMin: s.intervaloMin,
            ativo: s.ativo,
            profissionais: s.profissionais.map((p) => p.profissional.nome),
          })),
        };
      },
    },
    {
      modulo: "servicos",
      acao: "alterar",
      name: "cadastrar_servico",
      description: "Cadastra um servico. Valores em reais.",
      schema: z.object({
        nome: z.string(),
        categoria: z.string().optional(),
        descricao: z.string().optional(),
        preco_reais: z.number(),
        duracao_min: z.number().int().positive(),
        intervalo_min: z.number().int().min(0).default(0),
        retorno_dias: z.number().int().optional(),
        profissional_ids: z.array(z.string()).optional().describe("Padrao: todos os profissionais ativos"),
      }),
      handler: async (i) => {
        const profs = i.profissional_ids?.length ? i.profissional_ids : (await prisma.profissional.findMany({ where: { tenantId, ativo: true }, select: { id: true } })).map((p) => p.id);
        const s = await prisma.servico.create({
          data: {
            tenantId,
            nome: i.nome,
            categoria: i.categoria || null,
            descricao: i.descricao || null,
            preco: reais(i.preco_reais),
            duracaoMin: i.duracao_min,
            intervaloMin: i.intervalo_min || 0,
            retornoDias: i.retorno_dias || null,
            profissionais: { create: profs.map((profissionalId) => ({ profissionalId })) },
          },
        });
        return { ok: true, servicoId: s.id };
      },
    },
    {
      modulo: "servicos",
      acao: "alterar",
      name: "atualizar_servico",
      description: "Atualiza preco, duracao, intervalo, retorno ou ativa/desativa um servico.",
      schema: z.object({
        servico_id: z.string(),
        preco_reais: z.number().optional(),
        duracao_min: z.number().int().optional(),
        intervalo_min: z.number().int().optional(),
        retorno_dias: z.number().int().optional(),
        ativo: z.boolean().optional(),
        nome: z.string().optional(),
      }),
      handler: async (i) => {
        const s = await prisma.servico.findFirst({ where: { id: i.servico_id, tenantId } });
        if (!s) return { ok: false, error: "Servico nao encontrado." };
        await prisma.servico.update({
          where: { id: s.id },
          data: {
            ...(i.preco_reais !== undefined ? { preco: reais(i.preco_reais) } : {}),
            ...(i.duracao_min !== undefined ? { duracaoMin: i.duracao_min } : {}),
            ...(i.intervalo_min !== undefined ? { intervaloMin: i.intervalo_min } : {}),
            ...(i.retorno_dias !== undefined ? { retornoDias: i.retorno_dias } : {}),
            ...(i.ativo !== undefined ? { ativo: i.ativo } : {}),
            ...(i.nome ? { nome: i.nome } : {}),
          },
        });
        return { ok: true };
      },
    },
    // ---------- produtos ----------
    {
      modulo: "produtos",
      acao: "consultar",
      name: "estoque_produtos",
      description: "Lista produtos com estoque, preco e alerta de estoque baixo.",
      schema: z.object({}),
      handler: async () => {
        const produtos = await prisma.produto.findMany({ where: { tenantId }, orderBy: { nome: "asc" } });
        return {
          ok: true,
          produtos: produtos.map((p) => ({ id: p.id, nome: p.nome, estoque: p.estoque, minimo: p.estoqueMinimo, baixo: p.estoque <= p.estoqueMinimo, preco: brl(p.preco), ativo: p.ativo })),
        };
      },
    },
    {
      modulo: "produtos",
      acao: "alterar",
      name: "ajustar_estoque",
      description: "Ajusta o estoque: entrada de mercadoria (quantidade positiva) ou correcao (nova_quantidade).",
      schema: z.object({ produto_id: z.string(), entrada: z.number().int().optional(), nova_quantidade: z.number().int().min(0).optional() }),
      handler: async ({ produto_id, entrada, nova_quantidade }) => {
        const p = await prisma.produto.findFirst({ where: { id: produto_id, tenantId } });
        if (!p) return { ok: false, error: "Produto nao encontrado." };
        const estoque = nova_quantidade !== undefined ? nova_quantidade : p.estoque + (entrada || 0);
        await prisma.produto.update({ where: { id: p.id }, data: { estoque } });
        return { ok: true, estoque };
      },
    },
    {
      modulo: "produtos",
      acao: "alterar",
      name: "registrar_venda_balcao",
      description: "Registra venda de produtos no balcao (dinheiro ou maquininha).",
      schema: z.object({
        itens: z.array(z.object({ produto_id: z.string(), quantidade: z.number().int().positive() })).min(1),
        forma: z.enum(["DINHEIRO", "MAQUININHA"]),
        cliente_telefone: z.string().optional(),
        cliente_nome: z.string().optional(),
      }),
      handler: async (i) => {
        const r = await vendaService.criarVenda({
          tenantId,
          origem: "BALCAO",
          forma: i.forma,
          itens: i.itens.map((x) => ({ produtoId: x.produto_id, quantidade: x.quantidade })),
          cliente: i.cliente_telefone ? { telefone: i.cliente_telefone, nome: i.cliente_nome } : null,
        });
        return { ok: true, vendaId: r.venda.id, total: brl(r.venda.valorTotal) };
      },
    },
    {
      modulo: "produtos",
      acao: "alterar",
      name: "cadastrar_produto",
      description: "Cadastra um produto novo. Valores em reais.",
      schema: z.object({
        nome: z.string().min(2),
        preco_reais: z.number().positive(),
        estoque: z.number().int().min(0).default(0),
        custo_reais: z.number().min(0).optional(),
        estoque_minimo: z.number().int().min(0).optional(),
        descricao: z.string().optional(),
      }),
      handler: async (i) => {
        const p = await prisma.produto.create({
          data: {
            tenantId,
            nome: i.nome.trim(),
            preco: reais(i.preco_reais),
            estoque: i.estoque || 0,
            custo: reais(i.custo_reais || 0),
            estoqueMinimo: i.estoque_minimo || 0,
            descricao: i.descricao || null,
          },
        });
        return { ok: true, produtoId: p.id, nome: p.nome, preco: brl(p.preco), estoque: p.estoque };
      },
    },
    // ---------- equipe ----------
    {
      modulo: "equipe",
      acao: "consultar",
      name: "listar_profissionais",
      description: "Lista profissionais (id, nome, ativo).",
      schema: z.object({}),
      handler: async () => ({ ok: true, profissionais: await prisma.profissional.findMany({ where: { tenantId }, select: { id: true, nome: true, ativo: true } }) }),
    },
    // ---------- financeiro ----------
    {
      modulo: "financeiro",
      acao: "consultar",
      name: "resultado_financeiro",
      description: "Faturamento, reembolsos, taxas, comissoes, despesas e resultado do periodo (padrao: mes atual).",
      schema: z.object({ de: z.string().optional(), ate: z.string().optional() }),
      handler: async ({ de, ate }) => {
        const p = parsePeriod({ de, ate }, tz);
        const r = await metricas.resultadoFinanceiro({ tenantId, ...p });
        return {
          ok: true,
          periodo: `${p.from} a ${p.to}`,
          faturamento: brl(r.faturamento),
          reembolsos: brl(r.reembolsos),
          taxas: brl(r.taxas),
          comissoes: brl(r.comissoes),
          despesas: brl(r.despesas),
          resultado: brl(r.resultado),
          metaMes: { meta: brl(r.metaMes.meta), realizado: brl(r.metaMes.realizado), progresso: `${r.metaMes.progresso}%` },
        };
      },
    },
    {
      modulo: "financeiro",
      acao: "consultar",
      name: "comissoes_profissionais",
      description: "Valor a pagar a cada profissional no periodo (comissao ou valor fixo) e se ja foi pago. Padrao: mes atual.",
      schema: z.object({ de: z.string().optional(), ate: z.string().optional() }),
      handler: async ({ de, ate }) => {
        const p = parsePeriod({ de, ate }, tz);
        const lista = await metricas.comissoes({ tenantId, ...p });
        return {
          ok: true,
          periodo: `${p.from} a ${p.to}`,
          comissoes: lista.map((c) => ({ profissional: c.nome, servicos: c.servicosRealizados, valor: brl(c.valor), paga: c.paga })),
        };
      },
    },
    {
      modulo: "financeiro",
      acao: "alterar",
      name: "registrar_despesa",
      description: "Registra uma despesa. Valor em reais.",
      schema: z.object({ categoria: z.string(), valor_reais: z.number().positive(), descricao: z.string().optional(), data: z.string().optional() }),
      handler: async (i) => {
        const d = await prisma.despesa.create({
          data: { tenantId, categoria: i.categoria, descricao: i.descricao || null, valor: reais(i.valor_reais), data: i.data || todayStr(tz) },
        });
        return { ok: true, despesaId: d.id };
      },
    },
    // ---------- desempenho ----------
    {
      modulo: "desempenho",
      acao: "consultar",
      name: "relatorio_desempenho",
      description: "Relatorio de desempenho do periodo: ocupacao, no-show, clientes, servicos, profissionais e receita.",
      schema: z.object({ de: z.string().optional(), ate: z.string().optional(), profissional_id: z.string().optional() }),
      handler: async ({ de, ate, profissional_id }) => {
        const p = parsePeriod({ de, ate }, tz);
        const r = await metricas.desempenho({ tenantId, from: p.from, to: p.to, profissionalId: profissional_id });
        return {
          ok: true,
          periodo: `${p.from} a ${p.to}`,
          ocupacao: `${r.capacidade.taxaOcupacao}%`,
          capacidadeServicos: r.capacidade.capacidadeServicos,
          metaServicos: r.capacidade.metaServicos,
          servicosRealizados: r.capacidade.servicosRealizados,
          horasPerdidasNoShow: r.capacidade.horasPerdidasNoShow,
          taxaNoShow: `${r.comparecimento.taxaNoShow}%`,
          taxaCancelamento: `${r.comparecimento.taxaCancelamento}%`,
          expiradosSemPagamento: r.comparecimento.expiradosSemPagamento,
          clientes: r.clientes,
          topServicos: r.servicos.maisRealizados.slice(0, 5).map((s) => `${s.nome}: ${s.quantidade}`),
          profissionais: r.profissionais.map((x) => `${x.nome}: ${x.servicos} servicos, ${brl(x.faturamento)}, ocupacao ${x.ocupacao}%`),
          faturamento: brl(r.receita.faturamento),
          ticketMedio: brl(r.receita.ticketMedio),
          origem: r.receita.origem,
        };
      },
    },
  ];
}

function permitido(permissoes, tool) {
  const lista = Array.isArray(permissoes?.[tool.acao]) ? permissoes[tool.acao] : [];
  // quem pode alterar um modulo tambem pode consulta-lo
  if (tool.acao === "consultar" && Array.isArray(permissoes?.alterar) && permissoes.alterar.includes(tool.modulo)) return true;
  return lista.includes(tool.modulo);
}

function buildTools(ctx) {
  const permissoes = ctx.autorizado.permissoes || {};
  // referencias basicas (ids de profissionais/servicos) sao liberadas para quem tem qualquer permissao de agenda
  const temAgenda = (permissoes.consultar || []).concat(permissoes.alterar || []).includes("agenda");
  const referencias = ["listar_profissionais", "listar_servicos"];
  return allTools(ctx).filter((t) => permitido(permissoes, t) || (temAgenda && referencias.includes(t.name)));
}

module.exports = { MODULOS, buildSystemPrompt, buildTools };
