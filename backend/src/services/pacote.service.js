// Pacotes de sessoes (ex.: 4 manicures por R$ 120).
//
// - O estabelecimento cadastra o pacote (Servicos/Produtos > Pacotes).
// - Vende para o cliente pelo painel (ficha do cliente): o pagamento entra no caixa NA VENDA.
// - Cada agendamento coberto consome uma sessao: o servico entra com preco 0 (ja foi pago) e
//   valorPacote = valor da sessao, que e a base da comissao do profissional.
// - Cancelou o agendamento ou o servico nao foi realizado: a sessao volta para o saldo.
//   No-show consome a sessao (mesma logica de quem perde o horario pago).
const prisma = require("../lib/prisma");
const { badRequest, notFound } = require("../lib/errors");
const { log, requireText, textOrNull, toInt } = require("../lib/helpers");

const FORMAS_VENDA = ["DINHEIRO", "MAQUININHA", "PIX"];

function serializarPacote(p) {
  return {
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    preco: p.preco,
    validadeDias: p.validadeDias,
    ativo: p.ativo,
    itens: (p.itens || []).map((i) => ({ id: i.id, servicoId: i.servicoId, nome: i.servico?.nome || "", quantidade: i.quantidade, precoServico: i.servico?.preco ?? 0 })),
    vendidos: p._count?.vendidos ?? undefined,
  };
}

async function listarPacotes(tenantId, { apenasAtivos = false } = {}) {
  const lista = await prisma.pacote.findMany({
    where: { tenantId, ...(apenasAtivos ? { ativo: true } : {}) },
    include: { itens: { include: { servico: { select: { nome: true, preco: true } } } }, _count: { select: { vendidos: true } } },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });
  return lista.map(serializarPacote);
}

async function salvarPacote(tenantId, id, body = {}) {
  const nome = requireText(body.nome, "Nome do pacote");
  const preco = toInt(body.preco, 0, { min: 0 });
  const validadeDias = body.validadeDias === null || body.validadeDias === "" || body.validadeDias === undefined ? null : toInt(body.validadeDias, 0, { min: 1, max: 3650 });
  const itensBrutos = Array.isArray(body.itens) ? body.itens : [];
  const porServico = new Map();
  for (const i of itensBrutos) {
    const q = toInt(i?.quantidade, 0, { min: 0, max: 500 });
    if (i?.servicoId && q > 0) porServico.set(String(i.servicoId), (porServico.get(String(i.servicoId)) || 0) + q);
  }
  if (!porServico.size) throw badRequest("Inclua pelo menos um serviço com a quantidade de sessões.");
  const servicos = await prisma.servico.findMany({ where: { tenantId, id: { in: [...porServico.keys()] } }, select: { id: true } });
  if (servicos.length !== porServico.size) throw badRequest("Serviço inválido no pacote.");

  const data = { nome, descricao: textOrNull(body.descricao), preco, validadeDias, ativo: body.ativo === undefined ? true : Boolean(body.ativo) };
  const itens = [...porServico].map(([servicoId, quantidade]) => ({ servicoId, quantidade }));
  const pacote = await prisma.$transaction(async (tx) => {
    if (id) {
      const atual = await tx.pacote.findFirst({ where: { id, tenantId } });
      if (!atual) throw notFound("Pacote não encontrado.");
      // Editar o pacote nao mexe em quem ja comprou: o saldo de cada cliente foi copiado na venda.
      await tx.pacoteItem.deleteMany({ where: { pacoteId: id } });
      return tx.pacote.update({ where: { id }, data: { ...data, itens: { create: itens } } });
    }
    return tx.pacote.create({ data: { tenantId, ...data, itens: { create: itens } } });
  });
  return (await listarPacotes(tenantId)).find((p) => p.id === pacote.id);
}

// ---------- pacotes do cliente ----------

function statusCalculado(pc) {
  if (pc.status === "CANCELADO") return "CANCELADO";
  const restante = pc.saldos.reduce((acc, s) => acc + Math.max(0, s.total - s.usado), 0);
  if (restante <= 0) return "FINALIZADO";
  if (pc.validoAte && new Date(pc.validoAte) < new Date()) return "VENCIDO";
  return "ATIVO";
}

function serializarPacoteCliente(pc) {
  return {
    id: pc.id,
    pacoteId: pc.pacoteId,
    nome: pc.nome,
    valorPago: pc.valorPago,
    compradoEm: pc.compradoEm,
    validoAte: pc.validoAte,
    status: statusCalculado(pc),
    saldos: pc.saldos.map((s) => ({ id: s.id, servicoId: s.servicoId, nome: s.nomeServico, total: s.total, usado: s.usado, restante: Math.max(0, s.total - s.usado) })),
  };
}

async function pacotesDoCliente(tenantId, clienteId) {
  const lista = await prisma.pacoteCliente.findMany({
    where: { tenantId, clienteId },
    include: { saldos: true },
    orderBy: { compradoEm: "desc" },
  });
  return lista.map(serializarPacoteCliente);
}

/**
 * Venda do pacote no balcao. O valor (com ou sem desconto) e rateado entre as sessoes pelo
 * preco de tabela de cada servico: e esse valor por sessao que vira base de comissao.
 */
async function venderPacote(tenantId, clienteId, { pacoteId, valor, forma } = {}) {
  if (!FORMAS_VENDA.includes(forma)) throw badRequest("Escolha a forma de pagamento: dinheiro, maquininha ou Pix.");
  const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, tenantId } });
  if (!cliente) throw notFound("Cliente não encontrado.");
  const pacote = await prisma.pacote.findFirst({ where: { id: pacoteId, tenantId, ativo: true }, include: { itens: { include: { servico: true } } } });
  if (!pacote) throw badRequest("Pacote inválido ou inativo.");
  const valorPago = valor === undefined || valor === null || valor === "" ? pacote.preco : toInt(valor, pacote.preco, { min: 0 });

  const tabela = pacote.itens.reduce((acc, i) => acc + i.servico.preco * i.quantidade, 0);
  const sessoes = pacote.itens.reduce((acc, i) => acc + i.quantidade, 0);
  const saldos = pacote.itens.map((i) => ({
    servicoId: i.servicoId,
    nomeServico: i.servico.nome,
    total: i.quantidade,
    valorSessao: tabela > 0 ? Math.round((valorPago * ((i.servico.preco * i.quantidade) / tabela)) / i.quantidade) : Math.round(valorPago / Math.max(1, sessoes)),
  }));

  const r = await prisma.$transaction(async (tx) => {
    const pagamento =
      valorPago > 0
        ? await tx.pagamento.create({
            data: {
              tenantId,
              clienteId,
              descricao: `Pacote: ${pacote.nome}`,
              origem: "BALCAO",
              modo: "LOCAL",
              forma,
              status: "APROVADO",
              valorBruto: valorPago,
              taxaGateway: 0,
              valorLiquido: valorPago,
              pagoEm: new Date(),
            },
          })
        : null;
    return tx.pacoteCliente.create({
      data: {
        tenantId,
        clienteId,
        pacoteId: pacote.id,
        nome: pacote.nome,
        valorPago,
        validoAte: pacote.validadeDias ? new Date(Date.now() + pacote.validadeDias * 86400000) : null,
        pagamentoId: pagamento?.id || null,
        saldos: { create: saldos },
      },
      include: { saldos: true },
    });
  });
  log("pacotes", "vendido", { tenantId, clienteId, pacote: pacote.nome, valorPago, forma });
  return serializarPacoteCliente(r);
}

/** Cancela a venda. Sem sessao usada, o pagamento sai do caixa; com sessao usada, fica (acerto manual). */
async function cancelarPacoteCliente(tenantId, id) {
  const pc = await prisma.pacoteCliente.findFirst({ where: { id, tenantId }, include: { saldos: true } });
  if (!pc) throw notFound("Pacote do cliente não encontrado.");
  if (pc.status === "CANCELADO") throw badRequest("Este pacote já está cancelado.");
  const usadas = pc.saldos.reduce((acc, s) => acc + s.usado, 0);
  await prisma.$transaction(async (tx) => {
    await tx.pacoteCliente.update({ where: { id }, data: { status: "CANCELADO", canceladoEm: new Date() } });
    if (!usadas && pc.pagamentoId) await tx.pagamento.update({ where: { id: pc.pagamentoId }, data: { status: "CANCELADO" } });
  });
  log("pacotes", "venda_cancelada", { tenantId, id, sessoesUsadas: usadas });
  return { cancelado: true, sessoesUsadas: usadas, pagamentoEstornado: !usadas && Boolean(pc.pagamentoId) };
}

// ---------- consumo no agendamento ----------

/**
 * Dentro da transacao do agendamento: para cada servico, usa uma sessao do pacote mais antigo do
 * cliente que cubra o servico. Devolve os itens ajustados (preco 0 + referencia da sessao).
 */
async function consumirNoAgendamento(tx, { tenantId, clienteId, itensServico, inicio }) {
  const ajustados = [];
  let cobertos = 0;
  for (const item of itensServico) {
    const candidatos = await tx.pacoteClienteSaldo.findMany({
      where: {
        servicoId: item.servicoId,
        pacoteCliente: { tenantId, clienteId, status: { not: "CANCELADO" }, OR: [{ validoAte: null }, { validoAte: { gte: inicio } }] },
      },
      include: { pacoteCliente: { select: { compradoEm: true } } },
    });
    candidatos.sort((a, b) => new Date(a.pacoteCliente.compradoEm) - new Date(b.pacoteCliente.compradoEm));
    let usado = null;
    for (const s of candidatos.filter((c) => c.usado < c.total)) {
      // incremento condicional: duas reservas ao mesmo tempo nao gastam a mesma sessao
      const r = await tx.pacoteClienteSaldo.updateMany({ where: { id: s.id, usado: { lt: s.total } }, data: { usado: { increment: 1 } } });
      if (r.count) {
        usado = s;
        break;
      }
    }
    if (usado) {
      cobertos += 1;
      ajustados.push({ ...item, preco: 0, pacoteSaldoId: usado.id, valorPacote: usado.valorSessao });
    } else {
      ajustados.push(item);
    }
  }
  return { itens: ajustados, cobertos };
}

/** Devolve as sessoes de pacote do agendamento (todas ou so dos itens informados). */
async function devolverDoAgendamento(agendamentoId, { itemIds } = {}) {
  const itens = await prisma.agendamentoServico.findMany({
    where: { agendamentoId, pacoteSaldoId: { not: null }, pacoteDevolvido: false, ...(itemIds ? { id: { in: itemIds } } : {}) },
  });
  for (const i of itens) {
    await prisma.$transaction([
      prisma.pacoteClienteSaldo.updateMany({ where: { id: i.pacoteSaldoId, usado: { gt: 0 } }, data: { usado: { decrement: 1 } } }),
      prisma.agendamentoServico.update({ where: { id: i.id }, data: { pacoteDevolvido: true } }),
    ]);
  }
  if (itens.length) log("pacotes", "sessoes_devolvidas", { agendamentoId, quantidade: itens.length });
  return itens.length;
}

/** Agendamento reativado (pagamento que chegou depois de expirar): consome de novo o que foi devolvido. */
async function reconsumirDoAgendamento(agendamentoId) {
  const itens = await prisma.agendamentoServico.findMany({ where: { agendamentoId, pacoteSaldoId: { not: null }, pacoteDevolvido: true } });
  for (const i of itens) {
    const saldo = await prisma.pacoteClienteSaldo.findUnique({ where: { id: i.pacoteSaldoId } });
    if (!saldo) continue;
    const r = await prisma.pacoteClienteSaldo.updateMany({ where: { id: saldo.id, usado: { lt: saldo.total } }, data: { usado: { increment: 1 } } });
    if (r.count) await prisma.agendamentoServico.update({ where: { id: i.id }, data: { pacoteDevolvido: false } });
  }
}

module.exports = {
  FORMAS_VENDA,
  listarPacotes,
  salvarPacote,
  pacotesDoCliente,
  venderPacote,
  cancelarPacoteCliente,
  consumirNoAgendamento,
  devolverDoAgendamento,
  reconsumirDoAgendamento,
};
