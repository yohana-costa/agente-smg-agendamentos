// Ciclo de vida do agendamento (escopo 4.2 a 4.9, 6.3 a 6.7).
const prisma = require("../lib/prisma");
const env = require("../config/env");
const events = require("../lib/events");
const disponibilidade = require("./disponibilidade.service");
const pagamentos = require("./pagamentos/pagamento.service");
const politica = require("./politica.service");
const fidelidade = require("./fidelidade.service");
const { encontrarOuCriarCliente } = require("./cliente.service");
const { dispararAutomacao } = require("./automacao.service");
const { enviarTexto } = require("./whatsapp/whatsapp.service");
const { badRequest, notFound, conflict, createAppError } = require("../lib/errors");
const { addMinutes, zonedParts, zonedToUtc, addDays, isDateStr, formatDateBr, formatTimeBr } = require("../lib/time");
const { brl, log, textOrNull, toInt } = require("../lib/helpers");

const INCLUDE_COMPLETO = {
  cliente: true,
  profissional: { select: { id: true, nome: true, cor: true } },
  servicos: { orderBy: { ordem: "asc" } },
  produtos: true,
  pagamentos: { orderBy: { createdAt: "asc" } },
  reembolsos: true,
};

// ---------- serializacao ----------

function situacaoPagamento(ag) {
  const aprovados = (ag.pagamentos || []).filter((p) => ["APROVADO", "REEMBOLSADO_PARCIAL", "REEMBOLSADO"].includes(p.status));
  if (ag.status === "AGUARDANDO_PAGAMENTO") return "AGUARDANDO";
  if (aprovados.some((p) => p.modo === "ONLINE")) return "PAGO_ONLINE";
  if (aprovados.some((p) => p.modo === "LOCAL")) return "PAGO_LOCAL";
  if (ag.modoPagamento === "LOCAL") return "PAGAR_NO_LOCAL";
  if (ag.valorTotal === 0) return "SEM_COBRANCA";
  return "AGUARDANDO";
}

function serializar(ag, tenant) {
  const tolerancia = tenant?.toleranciaPendenteMin ?? 10;
  const agora = Date.now();
  const pendenteFinalizacao =
    ["CONFIRMADO", "EM_ATENDIMENTO"].includes(ag.status) && agora > addMinutes(ag.fim, tolerancia).getTime();
  const tz = tenant?.timezone || "America/Sao_Paulo";
  const p = zonedParts(ag.inicio, tz);
  return {
    ...ag,
    data: p.date,
    hora: p.time,
    horaFim: zonedParts(ag.fim, tz).time,
    horaFimIntervalo: zonedParts(ag.fimIntervalo, tz).time,
    pendenteFinalizacao,
    situacaoPagamento: situacaoPagamento(ag),
    segundosRestantesReserva:
      ag.status === "AGUARDANDO_PAGAMENTO" && ag.expiraEm ? Math.max(0, Math.floor((new Date(ag.expiraEm) - agora) / 1000)) : null,
    linkPagamento: (ag.pagamentos || []).find((x) => x.status === "PENDENTE")?.linkPagamento || null,
  };
}

async function obter(tenantId, id) {
  const ag = await prisma.agendamento.findFirst({ where: { id, tenantId }, include: INCLUDE_COMPLETO });
  if (!ag) throw notFound("Agendamento nao encontrado.");
  return ag;
}

async function obterSerializado(tenantId, id) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return serializar(await obter(tenantId, id), tenant);
}

function notificarAgenda(tenantId, agendamentoId, acao) {
  events.publish(tenantId, "agenda.atualizada", { agendamentoId, acao });
}

// ---------- criacao ----------

function parseInicio({ inicio, data, hora }, tz) {
  if (inicio) {
    const d = new Date(inicio);
    if (Number.isNaN(d.getTime())) throw badRequest("Data/hora de inicio invalida.");
    return d;
  }
  if (isDateStr(data) && /^\d{2}:\d{2}$/.test(String(hora || ""))) return zonedToUtc(data, hora, tz);
  throw badRequest("Informe data e horario do agendamento.");
}

async function lockProfissional(tx, profissionalId) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `agenda:${profissionalId}`);
}

async function sobreposicoes(tx, { tenantId, profissionalId, inicio, fimIntervalo, excluirId }) {
  return tx.agendamento.findMany({
    where: {
      tenantId,
      profissionalId,
      id: excluirId ? { not: excluirId } : undefined,
      status: { in: disponibilidade.STATUS_OCUPAM },
      inicio: { lt: fimIntervalo },
      fimIntervalo: { gt: inicio },
      OR: [{ status: { not: "AGUARDANDO_PAGAMENTO" } }, { expiraEm: { gt: new Date() } }, { expiraEm: null }],
    },
    select: { id: true },
  });
}

/**
 * Cria agendamento.
 * pagamento: "LINK" (envia link pelo WhatsApp), "PIX" (QR na tela), "LOCAL" (dinheiro/maquininha no local),
 *            "ONLINE" (site/agente: checkout SMG).
 */
async function criar(input) {
  const {
    tenantId,
    origem = "MANUAL",
    servicoIds,
    profissionalId,
    produtos = [],
    observacoes,
    encaixe = false,
    cupomCodigo,
    recompensaId,
    ignorarAgendamentoId = null,
  } = input;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw notFound("Estabelecimento nao encontrado.");
  const formaPagamento = origem === "MANUAL" ? input.pagamento || "LOCAL" : "ONLINE";
  if (!["LINK", "PIX", "LOCAL", "ONLINE"].includes(formaPagamento)) throw badRequest("Forma de pagamento invalida.");
  if (origem !== "MANUAL" && encaixe) throw badRequest("Encaixe so pode ser feito pelo estabelecimento.");

  const servicos = await disponibilidade.resolverServicos(tenantId, servicoIds);
  if (!profissionalId) throw badRequest("Escolha o profissional.");
  const habilitados = disponibilidade.profissionaisHabilitados(servicos);
  if (!habilitados.includes(profissionalId)) throw badRequest("Este profissional nao realiza todos os servicos escolhidos.");

  const inicio = parseInicio(input, tenant.timezone);
  const horarios = disponibilidade.calcularHorarios(inicio, servicos);

  if (origem !== "MANUAL") {
    if (inicio.getTime() < Date.now()) throw badRequest("Horário no passado.");
    const valido = await disponibilidade.validarHorarioOferecido({ tenantId, servicos, profissionalId, inicio, excluirAgendamentoId: ignorarAgendamentoId || undefined });
    if (!valido) throw conflict("Este horário não está mais disponível. Escolha outro horário.");
  } else {
    const conflitos = await disponibilidade.verificarConflitos({ tenantId, profissionalId, inicio, fimIntervalo: horarios.fimIntervalo });
    if (conflitos.length && !encaixe) {
      throw conflict("O horario escolhido tem conflitos. Confirme o encaixe para continuar.", { conflitos, requerEncaixe: true });
    }
  }

  // produtos (order bump)
  const produtosValidos = [];
  if (produtos.length) {
    if (!tenant.venderProdutos) throw badRequest("A venda de produtos esta desativada.");
    for (const item of produtos) {
      const quantidade = toInt(item.quantidade, 1, { min: 1, max: 99 });
      const produto = await prisma.produto.findFirst({ where: { id: item.produtoId, tenantId, ativo: true } });
      if (!produto) throw badRequest("Produto invalido.");
      if (produto.estoque < quantidade) throw badRequest(`Estoque insuficiente para ${produto.nome}.`);
      produtosValidos.push({ produto, quantidade });
    }
  }

  const resultado = await prisma.$transaction(
    async (tx) => {
      await lockProfissional(tx, profissionalId);
      if (!encaixe) {
        const choques = await sobreposicoes(tx, { tenantId, profissionalId, inicio: horarios.inicio, fimIntervalo: horarios.fimIntervalo, excluirId: ignorarAgendamentoId });
        if (choques.length) throw conflict("Este horário acabou de ser ocupado. Escolha outro horário.");
      }

      const cliente = input.clienteId
        ? await tx.cliente.findFirst({ where: { id: input.clienteId, tenantId } })
        : await encontrarOuCriarCliente(tenantId, input.cliente || {}, tx);
      if (!cliente) throw badRequest("Cliente nao encontrado.");

      const itensServico = servicos.map((s, ordem) => ({
        servicoId: s.id,
        nome: s.nome,
        preco: s.preco,
        duracaoMin: s.duracaoMin,
        intervaloMin: s.intervaloMin,
        ordem,
      }));
      const valorServicos = itensServico.reduce((acc, s) => acc + s.preco, 0);
      const valorProdutos = produtosValidos.reduce((acc, p) => acc + p.produto.preco * p.quantidade, 0);

      let desconto = 0;
      let cupomId = null;
      if (recompensaId) {
        if (!tenant.fidelidadeAtiva) throw badRequest("Programa de fidelidade desativado.");
        const r = await fidelidade.aplicarRecompensa(tx, { tenantId, recompensaId, clienteId: cliente.id, itensServico });
        desconto += r.desconto;
      }
      if (cupomCodigo) {
        const r = await fidelidade.aplicarCupom(tx, { tenantId, codigo: cupomCodigo, clienteId: cliente.id, subtotal: valorServicos + valorProdutos - desconto });
        desconto += r.desconto;
        cupomId = r.cupom.id;
      }
      const valorTotal = Math.max(0, valorServicos + valorProdutos - desconto);
      const precisaPagamentoOnline = formaPagamento !== "LOCAL" && valorTotal > 0;

      const agendamento = await tx.agendamento.create({
        data: {
          tenantId,
          clienteId: cliente.id,
          profissionalId,
          inicio: horarios.inicio,
          fim: horarios.fim,
          fimIntervalo: horarios.fimIntervalo,
          status: precisaPagamentoOnline ? "AGUARDANDO_PAGAMENTO" : "CONFIRMADO",
          origem,
          modoPagamento: formaPagamento === "LOCAL" ? "LOCAL" : "ONLINE",
          valorServicos,
          valorProdutos,
          desconto,
          valorTotal,
          cupomId,
          recompensaId: recompensaId || null,
          expiraEm: precisaPagamentoOnline ? addMinutes(new Date(), env.reservaMinutos) : null,
          encaixe: Boolean(encaixe),
          observacoes: textOrNull(observacoes),
          servicos: { create: itensServico },
          produtos: {
            create: produtosValidos.map((p) => ({ produtoId: p.produto.id, nome: p.produto.nome, quantidade: p.quantidade, precoUnit: p.produto.preco })),
          },
        },
      });

      let pagamento = null;
      if (precisaPagamentoOnline) {
        pagamento = await pagamentos.criarPagamentoOnline(tx, {
          tenantId,
          clienteId: cliente.id,
          agendamentoId: agendamento.id,
          valor: valorTotal,
          origem: origem === "MANUAL" ? "MANUAL" : origem,
          descricao: itensServico.map((s) => s.nome).join(" + "),
        });
      }
      return { agendamento, pagamento, cliente };
    },
    { timeout: 20000 }
  );

  log("agenda", "criado", { tenantId, agendamentoId: resultado.agendamento.id, origem, formaPagamento, encaixe });

  if (resultado.agendamento.status === "CONFIRMADO" && origem !== "MANUAL") {
    await baixarEstoqueAgendamento(resultado.agendamento.id);
    await dispararAutomacao("CONFIRMACAO", resultado.agendamento.id);
  }
  if (formaPagamento === "PIX" && resultado.pagamento) {
    await pagamentos.gerarPix(resultado.pagamento.id);
  }
  if (formaPagamento === "LINK" && resultado.pagamento) {
    const ag = await obter(tenantId, resultado.agendamento.id);
    await enviarTexto(
      tenantId,
      resultado.cliente.telefone,
      `Oi, ${resultado.cliente.nome.split(" ")[0]}! Seu horário de ${ag.servicos.map((s) => s.nome).join(" + ")} em ${formatDateBr(ag.inicio, tenant.timezone)} às ${formatTimeBr(
        ag.inicio,
        tenant.timezone
      )} está reservado por ${env.reservaMinutos} minutos. Valor: ${brl(ag.valorTotal)}. Pague aqui para confirmar: ${resultado.pagamento.linkPagamento}`,
      { autor: "SISTEMA", clienteId: resultado.cliente.id }
    );
  }
  if (resultado.agendamento.status === "CONFIRMADO" && origem === "MANUAL") {
    await baixarEstoqueAgendamento(resultado.agendamento.id);
  }

  notificarAgenda(tenantId, resultado.agendamento.id, "criado");
  return obterSerializado(tenantId, resultado.agendamento.id);
}

async function baixarEstoqueAgendamento(agendamentoId) {
  const itens = await prisma.agendamentoProduto.findMany({ where: { agendamentoId, estoqueBaixado: false } });
  for (const item of itens) {
    await prisma.produto.update({ where: { id: item.produtoId }, data: { estoque: { decrement: item.quantidade } } });
    await prisma.agendamentoProduto.update({ where: { id: item.id }, data: { estoqueBaixado: true } });
  }
}

// ---------- pagamento confirmado / expiracao ----------

async function confirmarPorPagamento(agendamentoId) {
  const ag = await prisma.agendamento.findUnique({ where: { id: agendamentoId }, include: { pagamentos: true } });
  if (!ag) return;

  if (ag.status === "AGUARDANDO_PAGAMENTO") {
    await prisma.agendamento.update({ where: { id: ag.id }, data: { status: "CONFIRMADO", expiraEm: null } });
    await baixarEstoqueAgendamento(ag.id);
    await dispararAutomacao("CONFIRMACAO", ag.id);
    notificarAgenda(ag.tenantId, ag.id, "confirmado");
    return;
  }

  // Pagamento que chegou para um agendamento ja cancelado pelo estabelecimento ou pelo cliente
  // (o Pix continuava valido no Mercado Pago): nao ha horario para confirmar, devolve tudo.
  if (["CANCELADO", "NO_SHOW"].includes(ag.status) && !ag.expirado) {
    const tenant = await prisma.tenant.findUnique({ where: { id: ag.tenantId } });
    const pagos = await prisma.pagamento.findMany({ where: { agendamentoId: ag.id, status: "APROVADO", pagoEm: { gte: ag.canceladoEm || new Date(0) } } });
    for (const p of pagos) {
      await pagamentos.reembolsar({ pagamento: p, tenant, valor: p.valorBruto, regra: "ESTABELECIMENTO", percentual: 100, agendamentoId: ag.id });
    }
    log("agenda", "pagamento_apos_cancelamento_reembolsado", { agendamentoId: ag.id, pagamentos: pagos.length });
    return;
  }

  // Pagamento que chegou depois da expiracao: reativa se o horario continuar livre; senao, devolve integralmente.
  if (ag.status === "CANCELADO" && ag.expirado) {
    const conflitos = await disponibilidade.verificarConflitos({
      tenantId: ag.tenantId,
      profissionalId: ag.profissionalId,
      inicio: ag.inicio,
      fimIntervalo: ag.fimIntervalo,
      excluirAgendamentoId: ag.id,
    });
    if (!conflitos.length && new Date(ag.inicio) > new Date()) {
      await prisma.agendamento.update({ where: { id: ag.id }, data: { status: "CONFIRMADO", expirado: false, canceladoEm: null, motivoCancelamento: null } });
      await baixarEstoqueAgendamento(ag.id);
      await dispararAutomacao("CONFIRMACAO", ag.id);
      notificarAgenda(ag.tenantId, ag.id, "confirmado");
    } else {
      const tenant = await prisma.tenant.findUnique({ where: { id: ag.tenantId } });
      const pagos = await prisma.pagamento.findMany({ where: { agendamentoId: ag.id, status: "APROVADO" } });
      for (const p of pagos) {
        await pagamentos.reembolsar({ pagamento: p, tenant, valor: p.valorBruto, regra: "ESTABELECIMENTO", percentual: 100, agendamentoId: ag.id });
      }
      log("agenda", "pagamento_apos_expiracao_reembolsado", { agendamentoId: ag.id });
    }
  }
}

// Ultima conferencia no Mercado Pago antes de liberar a reserva: se o cliente pagou e o
// webhook nao chegou, a aprovacao confirma aqui e a expiracao abaixo nao pega o registro.
async function conferirPagamentosAntesDeExpirar(filtro) {
  const pendentes = await prisma.pagamento.findMany({ where: { ...filtro, status: "PENDENTE", gateway: "mercadopago" }, select: { id: true } });
  for (const { id } of pendentes) {
    await pagamentos
      .sincronizarPagamento(id, { forcar: true })
      .catch((e) => log("pagamentos", "conferencia_antes_de_expirar_falhou", { pagamentoId: id, erro: e.message }));
  }
}

async function expirarReservas() {
  const vencidos = await prisma.agendamento.findMany({
    where: { status: "AGUARDANDO_PAGAMENTO", expiraEm: { lt: new Date() } },
    select: { id: true, tenantId: true, recompensaId: true, clienteId: true },
  });
  for (const ag of vencidos) {
    await conferirPagamentosAntesDeExpirar({ agendamentoId: ag.id });
    const r = await prisma.agendamento.updateMany({
      where: { id: ag.id, status: "AGUARDANDO_PAGAMENTO" },
      data: { status: "CANCELADO", expirado: true, canceladoEm: new Date(), motivoCancelamento: "Pagamento nao realizado no prazo da reserva." },
    });
    if (!r.count) continue;
    await prisma.pagamento.updateMany({ where: { agendamentoId: ag.id, status: "PENDENTE" }, data: { status: "EXPIRADO" } });
    await fidelidade.estornarRecompensa({ ...ag });
    log("agenda", "reserva_expirada", { agendamentoId: ag.id });
    notificarAgenda(ag.tenantId, ag.id, "expirado");
  }
  return vencidos.length;
}

// ---------- operacao: iniciar / finalizar ----------

async function iniciar(tenantId, id) {
  const ag = await obter(tenantId, id);
  if (ag.status !== "CONFIRMADO") throw badRequest("So e possivel iniciar um agendamento confirmado.");
  await prisma.agendamento.update({ where: { id }, data: { status: "EM_ATENDIMENTO", iniciadoEm: new Date() } });
  notificarAgenda(tenantId, id, "iniciado");
  return obterSerializado(tenantId, id);
}

async function adicionarProduto(tenantId, id, { produtoId, quantidade }) {
  const ag = await obter(tenantId, id);
  if (!["EM_ATENDIMENTO", "CONFIRMADO"].includes(ag.status)) throw badRequest("Produtos so podem ser adicionados durante o atendimento.");
  const qtd = toInt(quantidade, 1, { min: 1, max: 99 });
  const produto = await prisma.produto.findFirst({ where: { id: produtoId, tenantId, ativo: true } });
  if (!produto) throw badRequest("Produto invalido.");
  if (produto.estoque < qtd) throw badRequest(`Estoque insuficiente para ${produto.nome}.`);
  await prisma.agendamentoProduto.create({
    data: { agendamentoId: id, produtoId, nome: produto.nome, quantidade: qtd, precoUnit: produto.preco, adicionadoNoAtendimento: true },
  });
  await prisma.agendamento.update({
    where: { id },
    data: { valorProdutos: { increment: produto.preco * qtd }, valorTotal: { increment: produto.preco * qtd } },
  });
  notificarAgenda(tenantId, id, "produto");
  return obterSerializado(tenantId, id);
}

// Valor ainda nao pago do agendamento (ex.: pagamento no local ou produtos adicionados no atendimento).
function valorEmAberto(ag) {
  const pago = (ag.pagamentos || [])
    .filter((p) => ["APROVADO", "REEMBOLSADO_PARCIAL", "REEMBOLSADO"].includes(p.status))
    .reduce((acc, p) => acc + p.valorBruto, 0);
  return Math.max(0, ag.valorTotal - pago);
}

function sugerirRetorno(ag, tenant) {
  const dias = Math.max(0, ...ag.servicos.map((s) => s.retornoDias || 0));
  if (!dias) return null;
  return addDays(zonedParts(new Date(), tenant.timezone).date, dias);
}

async function previaFinalizacao(tenantId, id) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const ag = await obter(tenantId, id);
  const servicosCad = await prisma.servico.findMany({ where: { id: { in: ag.servicos.map((s) => s.servicoId) } }, select: { id: true, retornoDias: true } });
  const comRetorno = ag.servicos.map((s) => ({ ...s, retornoDias: servicosCad.find((c) => c.id === s.servicoId)?.retornoDias || 0 }));
  return {
    agendamento: serializar(ag, tenant),
    valorEmAberto: valorEmAberto(ag),
    retornoSugerido: sugerirRetorno({ ...ag, servicos: comRetorno }, tenant),
  };
}

/**
 * Finaliza o atendimento (escopo 6.5).
 * body: { servicosRealizados?: [itemId], produtosAdicionais?: [{produtoId, quantidade}],
 *         formaPagamento?: "DINHEIRO"|"MAQUININHA"|"PIX", retorno?: { acao: "ACEITAR"|"ALTERAR"|"SEM", data } }
 */
async function finalizar(tenantId, id, body = {}) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  let ag = await obter(tenantId, id);
  if (!["CONFIRMADO", "EM_ATENDIMENTO"].includes(ag.status)) throw badRequest("Este agendamento nao pode ser finalizado.");

  // servicos efetivamente realizados
  if (Array.isArray(body.servicosRealizados) && body.servicosRealizados.length) {
    const removidos = ag.servicos.filter((s) => !body.servicosRealizados.includes(s.id));
    if (removidos.length === ag.servicos.length) throw badRequest("Confirme pelo menos um servico realizado.");
    if (removidos.length) {
      const reducao = removidos.reduce((acc, s) => acc + s.preco, 0);
      await prisma.agendamentoServico.deleteMany({ where: { id: { in: removidos.map((s) => s.id) } } });
      await prisma.agendamento.update({
        where: { id },
        data: { valorServicos: { decrement: reducao }, valorTotal: Math.max(0, ag.valorTotal - reducao) },
      });
    }
  }
  for (const p of body.produtosAdicionais || []) {
    await adicionarProduto(tenantId, id, p);
  }
  ag = await obter(tenantId, id);

  // pagamento do que estiver em aberto
  const emAberto = valorEmAberto(ag);
  if (emAberto > 0) {
    const forma = body.formaPagamento;
    if (!forma) throw badRequest("Informe a forma de pagamento do valor em aberto.", { valorEmAberto: emAberto });
    if (forma === "PIX") {
      const pg = await pagamentos.criarPagamentoOnline(null, { tenantId, clienteId: ag.clienteId, agendamentoId: id, valor: emAberto, origem: "MANUAL", descricao: "Pix no local" });
      await prisma.pagamento.update({ where: { id: pg.id }, data: { modo: "LOCAL" } });
      await pagamentos.gerarPix(pg.id);
    } else {
      await pagamentos.registrarPagamentoLocal(null, { tenantId, clienteId: ag.clienteId, agendamentoId: id, valor: emAberto, forma, origem: "MANUAL" });
    }
  }

  // duracao real: so entra na media quando Iniciar e Finalizar foram clicados no momento certo
  const finalizadoEm = new Date();
  const limite = addMinutes(ag.fim, tenant.toleranciaPendenteMin);
  // "No momento certo" vale para as duas pontas: Iniciar clicado muito antes do horario (ex.: no dia
  // anterior, por engano) gravaria uma duracao falsa e puxaria a media do servico para baixo.
  const MARGEM_INICIO_MIN = 30;
  const iniciouNoHorario = Boolean(ag.iniciadoEm) && new Date(ag.iniciadoEm) >= addMinutes(ag.inicio, -MARGEM_INICIO_MIN);
  const duracaoValida = iniciouNoHorario && finalizadoEm <= limite;
  if (duracaoValida) {
    const real = Math.max(1, Math.round((finalizadoEm - new Date(ag.iniciadoEm)) / 60000));
    const previsto = ag.servicos.reduce((acc, s) => acc + s.duracaoMin, 0) || 1;
    for (const s of ag.servicos) {
      await prisma.agendamentoServico.update({ where: { id: s.id }, data: { duracaoRealMin: Math.round((real * s.duracaoMin) / previsto) } });
    }
  }

  // retorno sugerido
  let retornoSugerido = null;
  const retorno = body.retorno || {};
  if (retorno.acao === "ALTERAR" && isDateStr(retorno.data)) retornoSugerido = zonedToUtc(retorno.data, "09:00", tenant.timezone);
  else if (retorno.acao !== "SEM") {
    const previa = await previaFinalizacao(tenantId, id);
    if (previa.retornoSugerido) retornoSugerido = zonedToUtc(previa.retornoSugerido, "09:00", tenant.timezone);
  }

  await prisma.agendamento.update({
    where: { id },
    data: { status: "CONCLUIDO", finalizadoEm, duracaoValida, retornoSugerido },
  });
  await baixarEstoqueAgendamento(id);

  const final = await obter(tenantId, id);
  const pago = final.pagamentos.filter((p) => p.status === "APROVADO").reduce((acc, p) => acc + p.valorBruto, 0);
  await fidelidade.creditarAtendimento(final, tenant, pago);

  notificarAgenda(tenantId, id, "finalizado");
  return serializar(final, tenant);
}

// ---------- cancelamento / no-show ----------

async function simularCancelamento(tenantId, id, { tipo = "CANCELAMENTO", porEstabelecimento = false } = {}) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const ag = await obter(tenantId, id);
  return politica.calcularReembolso({ agendamento: ag, pagamentos: ag.pagamentos, tenant, tipo, porEstabelecimento });
}

async function cancelar(tenantId, id, { tipo = "CANCELAMENTO", porEstabelecimento = false, motivo, notificar = true } = {}) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const ag = await obter(tenantId, id);
  if (["CANCELADO", "NO_SHOW", "CONCLUIDO"].includes(ag.status)) throw badRequest("Este agendamento nao pode mais ser cancelado.");
  if (tipo === "NO_SHOW" && ag.status !== "CONFIRMADO") throw badRequest("No-show so pode ser registrado em agendamento confirmado.");

  const calculo = politica.calcularReembolso({ agendamento: ag, pagamentos: ag.pagamentos, tenant, tipo, porEstabelecimento });
  // Escopo 4.4: cancelar depois do horario marcado conta como no-show (regra E status).
  const novoStatus = tipo === "NO_SHOW" || (calculo.regra === "NO_SHOW" && ag.status === "CONFIRMADO") ? "NO_SHOW" : "CANCELADO";

  await prisma.agendamento.update({
    where: { id },
    data: { status: novoStatus, canceladoEm: new Date(), motivoCancelamento: textOrNull(motivo) },
  });
  await pagamentos.cancelarCobrancasPendentes({ tenant, agendamentoId: id });

  // reembolso automatico distribuido entre os pagamentos aprovados
  let restante = calculo.valor;
  const reembolsos = [];
  for (const p of ag.pagamentos.filter((x) => ["APROVADO", "REEMBOLSADO_PARCIAL"].includes(x.status))) {
    if (restante <= 0) break;
    const parte = Math.min(restante, p.valorBruto - p.valorReembolsado);
    const r = await pagamentos.reembolsar({ pagamento: p, tenant, valor: parte, regra: calculo.regra, percentual: calculo.percentual, agendamentoId: id });
    if (r) reembolsos.push(r);
    restante -= parte;
  }

  // devolve produtos ao estoque se ja tinham sido baixados
  for (const item of ag.produtos.filter((x) => x.estoqueBaixado)) {
    await prisma.produto.update({ where: { id: item.produtoId }, data: { estoque: { increment: item.quantidade } } });
  }
  await prisma.agendamentoProduto.updateMany({ where: { agendamentoId: id }, data: { estoqueBaixado: false } });
  if (novoStatus === "CANCELADO") await fidelidade.estornarRecompensa(ag);

  if (notificar && novoStatus === "CANCELADO") {
    const textoReembolso = calculo.valor > 0 ? `Valor a ser devolvido: ${brl(calculo.valor)}.` : "";
    await dispararAutomacao("AVISO_CANCELAMENTO", id, { extras: { reembolso: textoReembolso } });
  }
  log("agenda", novoStatus === "NO_SHOW" ? "no_show" : "cancelado", { tenantId, id, regra: calculo.regra, valor: calculo.valor });
  notificarAgenda(tenantId, id, novoStatus.toLowerCase());
  return { agendamento: await obterSerializado(tenantId, id), reembolso: calculo, reembolsos };
}

// ---------- reagendamento ----------

/**
 * Reagendamento (escopo 4.5 e 6.7).
 * porCliente=true (portal/agente): so horarios oferecidos; fora do prazo aplica regra de cancelamento
 * fora do prazo e cria novo agendamento com novo pagamento.
 * porCliente=false (estabelecimento): mantem pagamento vinculado; permite encaixe confirmado.
 */
async function simularReagendamento(tenantId, id, { porCliente = true } = {}) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const ag = await obter(tenantId, id);
  if (!porCliente) return { mantemPagamento: true, exigeNovoPagamento: false, descricao: "Reagendamento pelo estabelecimento mantem o pagamento vinculado." };
  const calc = politica.calcularReembolso({ agendamento: ag, pagamentos: ag.pagamentos, tenant, tipo: "CANCELAMENTO" });
  if (calc.regra === "DENTRO_PRAZO" || ag.status === "AGUARDANDO_PAGAMENTO") {
    return { mantemPagamento: true, exigeNovoPagamento: false, descricao: "Dentro do prazo: o pagamento acompanha o novo horário." };
  }
  return {
    mantemPagamento: false,
    exigeNovoPagamento: true,
    reembolso: calc,
    descricao: `Fora do prazo: ${calc.descricao} O novo horário exige um novo pagamento.`,
  };
}

async function reagendar(tenantId, id, input) {
  const { porCliente = false, encaixe = false } = input;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const ag = await obter(tenantId, id);
  if (!["AGUARDANDO_PAGAMENTO", "CONFIRMADO"].includes(ag.status)) throw badRequest("Este agendamento nao pode ser reagendado.");

  const profissionalId = input.profissionalId || ag.profissionalId;
  const servicos = await disponibilidade.resolverServicos(
    tenantId,
    ag.servicos.map((s) => s.servicoId),
    { apenasAtivos: false }
  );
  if (!disponibilidade.profissionaisHabilitados(servicos).includes(profissionalId)) {
    throw badRequest("Este profissional nao realiza todos os servicos do agendamento.");
  }
  // usa a duracao gravada no agendamento (nao muda se o cadastro do servico mudou)
  const itens = ag.servicos.map((s) => ({ duracaoMin: s.duracaoMin, intervaloMin: s.intervaloMin }));
  const inicio = parseInicio(input, tenant.timezone);
  const horarios = disponibilidade.calcularHorarios(inicio, itens);

  if (porCliente) {
    const valido = await disponibilidade.validarHorarioOferecido({
      tenantId,
      servicos: servicos.map((s, i) => ({ ...s, duracaoMin: itens[i].duracaoMin, intervaloMin: itens[i].intervaloMin })),
      profissionalId,
      inicio,
      excluirAgendamentoId: id,
    });
    if (!valido) throw conflict("Este horário não está disponível. Escolha outro horário.");

    const simulacao = await simularReagendamento(tenantId, id, { porCliente: true });
    if (simulacao.exigeNovoPagamento) {
      // Cria o novo horario ANTES de cancelar o antigo: se o horario for tomado nesse meio
      // tempo, o cliente continua com o agendamento original e nada e devolvido a toa.
      const novo = await criar({
        tenantId,
        origem: input.origem || "SITE",
        clienteId: ag.clienteId,
        servicoIds: ag.servicos.map((s) => s.servicoId),
        profissionalId,
        inicio: inicio.toISOString(),
        produtos: ag.produtos.filter((p) => !p.adicionadoNoAtendimento).map((p) => ({ produtoId: p.produtoId, quantidade: p.quantidade })),
        observacoes: ag.observacoes,
        ignorarAgendamentoId: id,
      });
      // aplica a regra de cancelamento fora do prazo no agendamento antigo
      await cancelar(tenantId, id, { tipo: "CANCELAMENTO", motivo: "Reagendado pelo cliente fora do prazo", notificar: false });
      return { agendamento: novo, novoAgendamento: true, reembolso: simulacao.reembolso };
    }
  } else {
    const conflitos = await disponibilidade.verificarConflitos({ tenantId, profissionalId, inicio, fimIntervalo: horarios.fimIntervalo, excluirAgendamentoId: id });
    if (conflitos.length && !encaixe) {
      throw conflict("O novo horario tem conflitos. Confirme o encaixe para continuar.", { conflitos, requerEncaixe: true });
    }
  }

  await prisma.$transaction(async (tx) => {
    await lockProfissional(tx, profissionalId);
    if (!encaixe) {
      const choques = await sobreposicoes(tx, { tenantId, profissionalId, inicio: horarios.inicio, fimIntervalo: horarios.fimIntervalo, excluirId: id });
      if (choques.length) throw conflict("Este horário acabou de ser ocupado. Escolha outro horário.");
    }
    await tx.agendamento.update({
      where: { id },
      data: { inicio: horarios.inicio, fim: horarios.fim, fimIntervalo: horarios.fimIntervalo, profissionalId, encaixe: Boolean(encaixe) || ag.encaixe },
    });
  });

  await dispararAutomacao("AVISO_REAGENDAMENTO", id, { referencia: `${id}:${horarios.inicio.toISOString()}` });
  // permite novo lembrete antes do atendimento no novo horario
  await prisma.automacaoEnvio.deleteMany({ where: { tipo: "LEMBRETE_ATENDIMENTO", referencia: id } });
  notificarAgenda(tenantId, id, "reagendado");
  return { agendamento: await obterSerializado(tenantId, id), novoAgendamento: false };
}

async function reenviarLink(tenantId, id) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const ag = await obter(tenantId, id);
  if (ag.status !== "AGUARDANDO_PAGAMENTO") throw badRequest("Este agendamento nao esta aguardando pagamento.");
  const pagamento = ag.pagamentos.find((p) => p.status === "PENDENTE");
  if (!pagamento) throw createAppError("Cobranca pendente nao encontrada.", 404);
  const minutos = Math.max(0, Math.ceil((new Date(ag.expiraEm) - Date.now()) / 60000));
  await enviarTexto(
    tenantId,
    ag.cliente.telefone,
    `Oi, ${ag.cliente.nome.split(" ")[0]}! Segue o link para pagamento do seu agendamento de ${ag.servicos.map((s) => s.nome).join(" + ")} em ${formatDateBr(
      ag.inicio,
      tenant.timezone
    )} às ${formatTimeBr(ag.inicio, tenant.timezone)} (${brl(ag.valorTotal)}). A reserva expira em ${minutos} minutos: ${pagamento.linkPagamento}`,
    { autor: "SISTEMA", clienteId: ag.clienteId }
  );
  return { enviado: true };
}

async function registrarPagamentoNoLocal(tenantId, id, { forma }) {
  const ag = await obter(tenantId, id);
  if (ag.status !== "AGUARDANDO_PAGAMENTO") throw badRequest("Este agendamento nao esta aguardando pagamento.");
  const pendente = ag.pagamentos.find((p) => p.status === "PENDENTE");
  if (pendente) await prisma.pagamento.update({ where: { id: pendente.id }, data: { status: "CANCELADO" } });
  if (forma === "PIX") {
    const pg = await pagamentos.criarPagamentoOnline(null, { tenantId, clienteId: ag.clienteId, agendamentoId: id, valor: ag.valorTotal, origem: "MANUAL", descricao: "Pix no local" });
    await prisma.pagamento.update({ where: { id: pg.id }, data: { modo: "LOCAL" } });
    await pagamentos.gerarPix(pg.id);
    return obterSerializado(tenantId, id);
  }
  const pg = await pagamentos.registrarPagamentoLocal(null, { tenantId, clienteId: ag.clienteId, agendamentoId: id, valor: ag.valorTotal, forma, origem: "MANUAL" });
  await prisma.agendamento.update({ where: { id }, data: { modoPagamento: "LOCAL" } });
  await confirmarPorPagamento(id, pg);
  return obterSerializado(tenantId, id);
}

module.exports = {
  INCLUDE_COMPLETO,
  serializar,
  obter,
  obterSerializado,
  criar,
  confirmarPorPagamento,
  expirarReservas,
  iniciar,
  adicionarProduto,
  previaFinalizacao,
  finalizar,
  simularCancelamento,
  cancelar,
  simularReagendamento,
  reagendar,
  reenviarLink,
  registrarPagamentoNoLocal,
  valorEmAberto,
};
