// Vendas de produtos (site e balcao) e estoque (escopo 8.2).
const prisma = require("../lib/prisma");
const env = require("../config/env");
const events = require("../lib/events");
const pagamentos = require("./pagamentos/pagamento.service");
const { encontrarOuCriarCliente } = require("./cliente.service");
const { enviarTexto } = require("./whatsapp/whatsapp.service");
const { badRequest, notFound } = require("../lib/errors");
const { addMinutes } = require("../lib/time");
const { brl, toInt, log } = require("../lib/helpers");

async function validarItens(tenantId, itens) {
  if (!Array.isArray(itens) || !itens.length) throw badRequest("Adicione pelo menos um produto.");
  const validados = [];
  for (const item of itens) {
    const quantidade = toInt(item.quantidade, 1, { min: 1, max: 999 });
    const produto = await prisma.produto.findFirst({ where: { id: item.produtoId, tenantId, ativo: true } });
    if (!produto) throw badRequest("Produto invalido.");
    if (produto.estoque < quantidade) throw badRequest(`Estoque insuficiente para ${produto.nome}.`);
    validados.push({ produto, quantidade });
  }
  return validados;
}

async function baixarEstoque(vendaId) {
  const itens = await prisma.vendaItem.findMany({ where: { vendaId } });
  for (const item of itens) {
    await prisma.produto.update({ where: { id: item.produtoId }, data: { estoque: { decrement: item.quantidade } } });
  }
}

/**
 * origem SITE: pagamento online obrigatorio (reserva de estoque ate a expiracao).
 * origem BALCAO: forma DINHEIRO | MAQUININHA (aprovado na hora) ou PIX (QR pelo sistema).
 */
async function criarVenda({ tenantId, origem, itens, cliente, clienteId, forma }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant.venderProdutos) throw badRequest("A venda de produtos esta desativada.");
  const validados = await validarItens(tenantId, itens);
  const valorTotal = validados.reduce((acc, i) => acc + i.produto.preco * i.quantidade, 0);

  let clienteFinal = null;
  if (clienteId) clienteFinal = await prisma.cliente.findFirst({ where: { id: clienteId, tenantId } });
  else if (cliente?.telefone) clienteFinal = await encontrarOuCriarCliente(tenantId, cliente);
  if (origem === "SITE" && !clienteFinal) throw badRequest("Informe nome e telefone.");

  const venda = await prisma.venda.create({
    data: {
      tenantId,
      clienteId: clienteFinal?.id || null,
      origem,
      valorTotal,
      status: "AGUARDANDO_PAGAMENTO",
      expiraEm: origem === "SITE" ? addMinutes(new Date(), env.reservaMinutos) : null,
      itens: { create: validados.map((i) => ({ produtoId: i.produto.id, nome: i.produto.nome, quantidade: i.quantidade, precoUnit: i.produto.preco })) },
    },
  });

  let pagamento;
  if (origem === "SITE" || forma === "PIX") {
    pagamento = await pagamentos.criarPagamentoOnline(null, {
      tenantId,
      clienteId: clienteFinal?.id || null,
      vendaId: venda.id,
      valor: valorTotal,
      origem: origem === "SITE" ? "SITE" : "BALCAO",
      descricao: "Produtos",
    });
    if (origem === "BALCAO") {
      await prisma.pagamento.update({ where: { id: pagamento.id }, data: { modo: "LOCAL" } });
      pagamento = await pagamentos.gerarPix(pagamento.id);
    }
  } else {
    pagamento = await pagamentos.registrarPagamentoLocal(null, {
      tenantId,
      clienteId: clienteFinal?.id || null,
      vendaId: venda.id,
      valor: valorTotal,
      forma,
      origem: "BALCAO",
      descricao: "Venda no balcao",
    });
    await confirmarPorPagamento(venda.id, pagamento);
  }
  log("vendas", "criada", { tenantId, vendaId: venda.id, origem, valorTotal });
  events.publish(tenantId, "vendas.atualizada", { vendaId: venda.id });
  return { venda: await obter(tenantId, venda.id), pagamento };
}

async function confirmarPorPagamento(vendaId) {
  const venda = await prisma.venda.findUnique({ where: { id: vendaId }, include: { cliente: true, itens: true } });
  if (!venda || venda.status === "PAGO") return;
  await prisma.venda.update({ where: { id: vendaId }, data: { status: "PAGO", expiraEm: null } });
  await baixarEstoque(vendaId);
  if (venda.origem === "SITE" && venda.cliente) {
    await enviarTexto(
      venda.tenantId,
      venda.cliente.telefone,
      `Compra confirmada! ✅ ${venda.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(", ")} (${brl(venda.valorTotal)}). A retirada é feita no local.`,
      { autor: "SISTEMA", clienteId: venda.clienteId }
    );
  }
  events.publish(venda.tenantId, "vendas.atualizada", { vendaId });
}

async function expirarVendas() {
  const vencidas = await prisma.venda.findMany({ where: { status: "AGUARDANDO_PAGAMENTO", expiraEm: { lt: new Date() } }, select: { id: true } });
  for (const v of vencidas) {
    await prisma.venda.update({ where: { id: v.id }, data: { status: "CANCELADO" } });
    await prisma.pagamento.updateMany({ where: { vendaId: v.id, status: "PENDENTE" }, data: { status: "EXPIRADO" } });
  }
  return vencidas.length;
}

async function obter(tenantId, id) {
  const venda = await prisma.venda.findFirst({ where: { id, tenantId }, include: { itens: true, cliente: true, pagamentos: true } });
  if (!venda) throw notFound("Venda nao encontrada.");
  return venda;
}

module.exports = { criarVenda, confirmarPorPagamento, expirarVendas, obter };
