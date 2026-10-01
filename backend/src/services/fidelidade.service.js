// Programa de fidelidade (aba Fidelidade): pontos, recompensas e cupons definidos pelo dono.
const prisma = require("../lib/prisma");
const { badRequest } = require("../lib/errors");
const { todayStr } = require("../lib/time");

async function movimentar(tx, { tenantId, clienteId, tipo, pontos, descricao, agendamentoId = null }) {
  const db = tx || prisma;
  if (!pontos) return null;
  await db.cliente.update({ where: { id: clienteId }, data: { pontos: { increment: pontos } } });
  return db.movimentoPontos.create({ data: { tenantId, clienteId, tipo, pontos, descricao, agendamentoId } });
}

// Credita pontos quando o atendimento e concluido.
async function creditarAtendimento(agendamento, tenant, valorPago) {
  if (!tenant.fidelidadeAtiva) return null;
  const pontos = Math.floor(valorPago / 100) * (tenant.pontosPorReal || 0) + (tenant.pontosPorAtendimento || 0);
  if (pontos <= 0) return null;
  const ja = await prisma.movimentoPontos.findFirst({ where: { agendamentoId: agendamento.id, tipo: "GANHO" } });
  if (ja) return ja;
  return movimentar(null, {
    tenantId: tenant.id,
    clienteId: agendamento.clienteId,
    tipo: "GANHO",
    pontos,
    descricao: "Atendimento concluido",
    agendamentoId: agendamento.id,
  });
}

// Valida cupom e calcula o desconto sobre o subtotal (centavos).
async function aplicarCupom(tx, { tenantId, codigo, clienteId, subtotal }) {
  const db = tx || prisma;
  const cupom = await db.cupom.findUnique({ where: { tenantId_codigo: { tenantId, codigo: String(codigo).trim().toUpperCase() } } });
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!cupom || !cupom.ativo) throw badRequest("Cupom invalido.");
  if (cupom.validade && cupom.validade < todayStr(tenant.timezone)) throw badRequest("Cupom expirado.");
  if (cupom.clienteId && cupom.clienteId !== clienteId) throw badRequest("Este cupom nao e valido para este cliente.");
  if (cupom.limiteUsos && cupom.usos >= cupom.limiteUsos) throw badRequest("Cupom esgotado.");
  const desconto = cupom.tipo === "PERCENTUAL" ? Math.round((subtotal * Math.min(100, cupom.valor)) / 100) : Math.min(subtotal, cupom.valor);
  await db.cupom.update({ where: { id: cupom.id }, data: { usos: { increment: 1 } } });
  return { cupom, desconto };
}

// Resgata recompensa (debita pontos) e calcula o desconto sobre o servico correspondente.
async function aplicarRecompensa(tx, { tenantId, recompensaId, clienteId, itensServico }) {
  const db = tx || prisma;
  const recompensa = await db.recompensa.findFirst({ where: { id: recompensaId, tenantId, ativo: true } });
  if (!recompensa) throw badRequest("Recompensa invalida.");
  const cliente = await db.cliente.findUnique({ where: { id: clienteId } });
  if (!cliente || cliente.pontos < recompensa.pontosCusto) throw badRequest("Pontos insuficientes para esta recompensa.");
  const item = recompensa.servicoId ? itensServico.find((s) => s.servicoId === recompensa.servicoId) : itensServico[0];
  if (!item) throw badRequest("A recompensa vale para um servico que nao esta neste agendamento.");
  const desconto = recompensa.tipo === "SERVICO_GRATIS" ? item.preco : Math.round((item.preco * recompensa.descontoPct) / 100);
  await movimentar(db, {
    tenantId,
    clienteId,
    tipo: "USO",
    pontos: -recompensa.pontosCusto,
    descricao: `Resgate: ${recompensa.nome}`,
  });
  return { recompensa, desconto };
}

// Devolve pontos de recompensa quando o agendamento e cancelado.
async function estornarRecompensa(agendamento) {
  if (!agendamento.recompensaId) return;
  const recompensa = await prisma.recompensa.findUnique({ where: { id: agendamento.recompensaId } });
  if (!recompensa) return;
  await movimentar(null, {
    tenantId: agendamento.tenantId,
    clienteId: agendamento.clienteId,
    tipo: "AJUSTE",
    pontos: recompensa.pontosCusto,
    descricao: `Estorno de resgate (agendamento cancelado): ${recompensa.nome}`,
    agendamentoId: agendamento.id,
  });
}

module.exports = { movimentar, creditarAtendimento, aplicarCupom, aplicarRecompensa, estornarRecompensa };
