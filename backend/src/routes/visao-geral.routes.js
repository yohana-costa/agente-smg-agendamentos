const express = require("express");
const prisma = require("../lib/prisma");
const agendamentoService = require("../services/agendamento.service");
const metricas = require("../services/metricas.service");
const { asyncHandler, ok } = require("../lib/helpers");
const { todayStr, dayRangeUtc, monthRange, rangeUtc, addDays } = require("../lib/time");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant, perfil, permissoes } = req.auth;
    const tz = tenant.timezone;
    const hoje = todayStr(tz);
    const scopeProf = perfil === "PROFISSIONAL" ? req.auth.profissionalId || "__nenhum__" : null;
    const verFinanceiro = perfil === "DONO" || (perfil === "RECEPCAO" && permissoes.verFinanceiroVisaoGeral) || perfil === "PROFISSIONAL";
    const profWhere = scopeProf ? { profissionalId: scopeProf } : {};

    // agenda do dia
    const dia = dayRangeUtc(hoje, tz);
    const agendaDia = await prisma.agendamento.findMany({
      where: { tenantId, ...profWhere, inicio: { gte: dia.start, lt: dia.end }, status: { notIn: ["CANCELADO"] } },
      include: agendamentoService.INCLUDE_COMPLETO,
      orderBy: { inicio: "asc" },
    });

    // pendencias
    const [aguardando, possiveisPendentes, escalonamentos] = await Promise.all([
      prisma.agendamento.findMany({
        where: { tenantId, ...profWhere, status: "AGUARDANDO_PAGAMENTO" },
        include: agendamentoService.INCLUDE_COMPLETO,
        orderBy: { expiraEm: "asc" },
      }),
      prisma.agendamento.findMany({
        where: { tenantId, ...profWhere, status: { in: ["CONFIRMADO", "EM_ATENDIMENTO"] }, fim: { lt: new Date() } },
        include: agendamentoService.INCLUDE_COMPLETO,
        orderBy: { inicio: "asc" },
      }),
      scopeProf
        ? []
        : prisma.conversa.findMany({
            where: { tenantId, escalonamentoPendente: true },
            include: { cliente: { select: { nome: true } } },
            orderBy: { escalonadoEm: "asc" },
          }),
    ]);
    const pendentesFinalizacao = possiveisPendentes.map((a) => agendamentoService.serializar(a, tenant)).filter((a) => a.pendenteFinalizacao);

    // resumo do mes
    const mes = monthRange(hoje);
    const rm = rangeUtc(mes.from, mes.to, tz);
    const concluidosMes = await prisma.agendamento.findMany({
      where: { tenantId, ...profWhere, status: "CONCLUIDO", inicio: { gte: rm.start, lt: rm.end } },
      select: { valorTotal: true, servicos: { select: { id: true } } },
    });
    const faturamentoMes = concluidosMes.reduce((acc, a) => acc + a.valorTotal, 0);
    const servicosMes = concluidosMes.reduce((acc, a) => acc + a.servicos.length, 0);

    let metaServicos = tenant.metaServicosMes;
    let metaValor = tenant.metaValorMes;
    if (scopeProf) {
      const prof = await prisma.profissional.findUnique({ where: { id: scopeProf } });
      metaServicos = prof?.metaServicosMes || 0;
      metaValor = prof?.metaValorMes || 0;
    }

    // alertas
    const alertas = [];
    const semana = await metricas.desempenho({ tenantId, from: hoje, to: addDays(hoje, 6), profissionalId: scopeProf || undefined }).catch(() => null);
    if (semana && semana.capacidade.horasDisponiveis > 0 && semana.capacidade.taxaOcupacao < 50) {
      alertas.push({ tipo: "OCUPACAO_BAIXA", mensagem: `Ocupação dos próximos 7 dias em ${semana.capacidade.taxaOcupacao}%.` });
    }
    const ultimos30 = await metricas.desempenho({ tenantId, from: addDays(hoje, -30), to: hoje, profissionalId: scopeProf || undefined }).catch(() => null);
    if (ultimos30 && ultimos30.comparecimento.noShows >= 2 && ultimos30.comparecimento.taxaNoShow >= 10) {
      alertas.push({ tipo: "NO_SHOW_ALTO", mensagem: `No-show de ${ultimos30.comparecimento.taxaNoShow}% nos últimos 30 dias.` });
    }
    if (tenant.venderProdutos && !scopeProf) {
      const produtos = await prisma.produto.findMany({ where: { tenantId, ativo: true }, select: { id: true, nome: true, estoque: true, estoqueMinimo: true } });
      for (const p of produtos.filter((x) => x.estoque <= x.estoqueMinimo)) {
        alertas.push({ tipo: "ESTOQUE_BAIXO", mensagem: `${p.nome}: ${p.estoque} em estoque (mínimo ${p.estoqueMinimo}).`, produtoId: p.id });
      }
    }

    return ok(res, {
      hoje,
      agendaDia: agendaDia.map((a) => agendamentoService.serializar(a, tenant)),
      pendencias: {
        aguardandoPagamento: aguardando.map((a) => agendamentoService.serializar(a, tenant)),
        pendentesFinalizacao,
        escalonamentos: escalonamentos.map((c) => ({
          id: c.id,
          telefone: c.telefone,
          nome: c.cliente?.nome || c.nomeContato || c.telefone,
          motivo: c.motivoEscalonamento,
          escalonadoEm: c.escalonadoEm,
        })),
      },
      resumo: {
        periodo: mes,
        atendimentos: concluidosMes.length,
        servicos: servicosMes,
        faturamento: verFinanceiro ? faturamentoMes : null,
      },
      meta: {
        servicos: { meta: metaServicos, realizado: servicosMes, progresso: metricas.pct(servicosMes, metaServicos) },
        valor: verFinanceiro ? { meta: metaValor, realizado: faturamentoMes, progresso: metricas.pct(faturamentoMes, metaValor) } : null,
      },
      alertas,
      mostraFinanceiro: verFinanceiro,
    });
  })
);

module.exports = router;
