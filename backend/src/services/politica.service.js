// Regras de cancelamento, no-show e reembolso (escopo 4.4 e 4.5).
const { formatDateBr, formatTimeBr, addMinutes } = require("../lib/time");

function valorPagoLiquidoCliente(pagamentos = []) {
  // valor que o cliente efetivamente pagou e ainda nao foi devolvido
  return pagamentos
    .filter((p) => ["APROVADO", "REEMBOLSADO_PARCIAL"].includes(p.status))
    .reduce((acc, p) => acc + (p.valorBruto - p.valorReembolsado), 0);
}

function descreverPrazo(minutos) {
  if (minutos % 1440 === 0) return `${minutos / 1440} dia(s)`;
  if (minutos % 60 === 0) return `${minutos / 60} hora(s)`;
  return `${minutos} minuto(s)`;
}

/**
 * Calcula a regra e o valor a devolver.
 * tipo: "CANCELAMENTO" | "NO_SHOW"
 * porEstabelecimento: cancelamento iniciado pelo estabelecimento (ex.: fechamento/bloqueio) -> reembolso integral.
 */
function calcularReembolso({ agendamento, pagamentos, tenant, tipo = "CANCELAMENTO", porEstabelecimento = false, agora = new Date() }) {
  const valorPago = valorPagoLiquidoCliente(pagamentos);
  const inicio = new Date(agendamento.inicio);
  const limite = addMinutes(inicio, -tenant.prazoCancelamentoMin);
  const tz = tenant.timezone;

  let regra;
  let percentual;
  let descricao;

  if (porEstabelecimento) {
    regra = "ESTABELECIMENTO";
    percentual = 100;
    descricao = "Cancelamento pelo estabelecimento: reembolso integral.";
  } else if (tipo === "NO_SHOW" || agora >= inicio) {
    regra = "NO_SHOW";
    percentual = tenant.reembolsoNoShowPct;
    descricao =
      tipo === "NO_SHOW"
        ? `No-show: reembolso de ${percentual}% do valor pago.`
        : `Cancelamento depois do horário marcado conta como no-show: reembolso de ${percentual}%.`;
  } else if (agora < limite) {
    regra = "DENTRO_PRAZO";
    percentual = 100;
    descricao = `Cancelamento dentro do prazo (até ${descreverPrazo(tenant.prazoCancelamentoMin)} antes, ou seja, antes de ${formatDateBr(limite, tz)} ${formatTimeBr(limite, tz)}): reembolso integral.`;
  } else {
    regra = "FORA_PRAZO";
    percentual = tenant.reembolsoForaPrazoPct;
    descricao = `Cancelamento fora do prazo de ${descreverPrazo(tenant.prazoCancelamentoMin)}: reembolso de ${percentual}% do valor pago.`;
  }

  let valor = Math.round((valorPago * percentual) / 100);
  let taxaDescontada = 0;
  if ((regra === "DENTRO_PRAZO") && tenant.reembolsoIntegralDescontaTaxa) {
    taxaDescontada = pagamentos
      .filter((p) => ["APROVADO", "REEMBOLSADO_PARCIAL"].includes(p.status) && p.modo === "ONLINE")
      .reduce((acc, p) => acc + p.taxaGateway, 0);
    valor = Math.max(0, valor - taxaDescontada);
    descricao += " A taxa do gateway e descontada do valor devolvido.";
  }

  return {
    regra,
    percentual,
    valorPago,
    valor,
    taxaDescontada,
    prazoLimite: limite.toISOString(),
    dentroDoPrazo: regra === "DENTRO_PRAZO",
    descricao,
  };
}

module.exports = { calcularReembolso, valorPagoLiquidoCliente, descreverPrazo };
