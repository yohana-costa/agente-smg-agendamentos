// Indicadores (abas Visao Geral, Financeiro, Desempenho, Equipe e segmentos de Clientes).
const prisma = require("../lib/prisma");
const disponibilidade = require("./disponibilidade.service");
const { zonedParts, daysBetween, addDays, todayStr, rangeUtc, monthRange, zonedToUtc } = require("../lib/time");

const STATUS_REALIZADO = ["CONCLUIDO"];

function minutos(a, b) {
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
}

function pct(parte, total) {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
}

// ---------- capacidade / ocupacao ----------

async function capacidade({ tenantId, from, to, profissionalId }) {
  const dias = daysBetween(from, to);
  const porProfissional = {};
  const porDiaSemana = Array.from({ length: 7 }, (_, i) => ({ diaSemana: i, disponiveis: 0, ocupados: 0 }));
  let diasFechadosForaRotina = 0;
  let minutosPerdidosFechamento = 0;

  for (const dia of dias) {
    const ctx = await disponibilidade.carregarContexto(tenantId, dia, profissionalId ? [profissionalId] : undefined);
    if (ctx.diaFechado) diasFechadosForaRotina += 1;
    for (const prof of ctx.profissionais) {
      const r = await disponibilidade.minutosDisponiveisDia(ctx, prof);
      if (ctx.diaFechado) minutosPerdidosFechamento += disponibilidade.minutosJanelaSemFechamento(ctx, prof);
      porProfissional[prof.id] = porProfissional[prof.id] || { profissionalId: prof.id, nome: prof.nome, disponiveis: 0, ocupados: 0 };
      porProfissional[prof.id].disponiveis += r.disponiveis;
      porDiaSemana[ctx.weekday].disponiveis += r.disponiveis;
    }
  }
  return { porProfissional, porDiaSemana, diasFechadosForaRotina, minutosPerdidosFechamento };
}

async function agendamentosPeriodo({ tenantId, start, end, profissionalId, servicoId, status }) {
  return prisma.agendamento.findMany({
    where: {
      tenantId,
      inicio: { gte: start, lt: end },
      ...(profissionalId ? { profissionalId } : {}),
      ...(servicoId ? { servicos: { some: { servicoId } } } : {}),
      ...(status ? { status: { in: status } } : {}),
    },
    include: { servicos: true, produtos: true, profissional: { select: { id: true, nome: true } } },
  });
}

async function desempenho({ tenantId, from, to, profissionalId, servicoId }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const tz = tenant.timezone;
  const { start, end } = rangeUtc(from, to, tz);
  const ags = await agendamentosPeriodo({ tenantId, start, end, profissionalId, servicoId });

  const cap = await capacidade({ tenantId, from, to, profissionalId });
  const ocupam = ags.filter((a) => ["CONFIRMADO", "EM_ATENDIMENTO", "CONCLUIDO"].includes(a.status));
  const porFaixa = {};
  for (const a of ocupam) {
    const m = minutos(a.inicio, a.fimIntervalo);
    const p = zonedParts(a.inicio, tz);
    if (cap.porProfissional[a.profissionalId]) cap.porProfissional[a.profissionalId].ocupados += m;
    cap.porDiaSemana[p.weekday].ocupados += m;
    const faixa = `${String(p.hour).padStart(2, "0")}:00`;
    porFaixa[faixa] = (porFaixa[faixa] || 0) + m;
  }
  const disponiveisTotal = Object.values(cap.porProfissional).reduce((acc, p) => acc + p.disponiveis, 0);
  const ocupadosTotal = Object.values(cap.porProfissional).reduce((acc, p) => acc + p.ocupados, 0);

  const concluidos = ags.filter((a) => STATUS_REALIZADO.includes(a.status));
  const noShows = ags.filter((a) => a.status === "NO_SHOW");
  const cancelados = ags.filter((a) => a.status === "CANCELADO" && !a.expirado);
  const expirados = ags.filter((a) => a.status === "CANCELADO" && a.expirado);
  const validos = ags.filter((a) => !(a.status === "CANCELADO" && a.expirado));

  // capacidade em servicos: minutos disponiveis / ocupacao media por servico
  const itensConcluidos = concluidos.flatMap((a) => a.servicos);
  const servicosAtivos = await prisma.servico.findMany({ where: { tenantId, ativo: true } });
  const mediaOcupacao = itensConcluidos.length
    ? itensConcluidos.reduce((acc, s) => acc + s.duracaoMin + s.intervaloMin, 0) / itensConcluidos.length
    : servicosAtivos.length
      ? servicosAtivos.reduce((acc, s) => acc + s.duracaoMin + s.intervaloMin, 0) / servicosAtivos.length
      : 60;
  const metaServicos = profissionalId
    ? (await prisma.profissional.findUnique({ where: { id: profissionalId } }))?.metaServicosMes || 0
    : tenant.metaServicosMes;

  // servicos
  const porServico = {};
  for (const a of concluidos) {
    for (const s of a.servicos) {
      if (servicoId && s.servicoId !== servicoId) continue;
      porServico[s.servicoId] = porServico[s.servicoId] || { servicoId: s.servicoId, nome: s.nome, quantidade: 0, faturamento: 0, duracaoInformada: s.duracaoMin, somaReal: 0, qtdReal: 0 };
      const x = porServico[s.servicoId];
      x.quantidade += 1;
      x.faturamento += s.preco;
      if (a.duracaoValida && s.duracaoRealMin) {
        x.somaReal += s.duracaoRealMin;
        x.qtdReal += 1;
      }
    }
  }
  for (const s of servicosAtivos) {
    if (porServico[s.id]) porServico[s.id].duracaoInformada = s.duracaoMin;
  }
  const servicosLista = Object.values(porServico).map((s) => ({
    servicoId: s.servicoId,
    nome: s.nome,
    quantidade: s.quantidade,
    faturamento: s.faturamento,
    duracaoInformada: s.duracaoInformada,
    duracaoRealMedia: s.qtdReal ? Math.round(s.somaReal / s.qtdReal) : null,
  }));

  // clientes
  const clientesNoPeriodo = [...new Set(concluidos.map((a) => a.clienteId))];
  const anteriores = await prisma.agendamento.groupBy({
    by: ["clienteId"],
    where: { tenantId, clienteId: { in: clientesNoPeriodo }, status: "CONCLUIDO", inicio: { lt: start } },
  });
  const comHistorico = new Set(anteriores.map((x) => x.clienteId));
  const visitasPorCliente = concluidos.reduce((acc, a) => ({ ...acc, [a.clienteId]: (acc[a.clienteId] || 0) + 1 }), {});
  const recorrentes = clientesNoPeriodo.filter((id) => comHistorico.has(id) || visitasPorCliente[id] > 1);
  const segmentos = await segmentosClientes(tenantId, { profissionalId });

  // produtos
  let produtos = null;
  if (tenant.venderProdutos) {
    const vendas = await prisma.vendaItem.findMany({ where: { venda: { tenantId, status: "PAGO", createdAt: { gte: start, lt: end } } } });
    const agProds = concluidos.flatMap((a) => a.produtos);
    const mapa = {};
    for (const i of [...vendas, ...agProds]) {
      mapa[i.produtoId] = mapa[i.produtoId] || { produtoId: i.produtoId, nome: i.nome, quantidade: 0, faturamento: 0 };
      mapa[i.produtoId].quantidade += i.quantidade;
      mapa[i.produtoId].faturamento += i.quantidade * i.precoUnit;
    }
    const lista = Object.values(mapa).sort((a, b) => b.quantidade - a.quantidade);
    produtos = { maisVendidos: lista, faturamento: lista.reduce((acc, p) => acc + p.faturamento, 0) };
  }

  // profissionais
  const rankingMap = {};
  for (const p of Object.values(cap.porProfissional)) {
    rankingMap[p.profissionalId] = { profissionalId: p.profissionalId, nome: p.nome, servicos: 0, faturamento: 0, ocupacao: pct(p.ocupados, p.disponiveis) };
  }
  for (const a of concluidos) {
    const r = rankingMap[a.profissionalId] || (rankingMap[a.profissionalId] = { profissionalId: a.profissionalId, nome: a.profissional.nome, servicos: 0, faturamento: 0, ocupacao: 0 });
    r.servicos += a.servicos.length;
    r.faturamento += a.valorTotal;
  }

  // receita
  const faturamento = concluidos.reduce((acc, a) => acc + a.valorTotal, 0);
  const origem = { SITE: 0, AGENTE: 0, MANUAL: 0 };
  for (const a of validos) origem[a.origem] += 1;
  const procura = { diasSemana: Array(7).fill(0), horarios: {} };
  for (const a of validos) {
    const p = zonedParts(a.inicio, tz);
    procura.diasSemana[p.weekday] += 1;
    const h = `${String(p.hour).padStart(2, "0")}:00`;
    procura.horarios[h] = (procura.horarios[h] || 0) + 1;
  }

  return {
    periodo: { de: from, ate: to },
    capacidade: {
      taxaOcupacao: pct(ocupadosTotal, disponiveisTotal),
      horasDisponiveis: Math.round(disponiveisTotal / 6) / 10,
      horasOcupadas: Math.round(ocupadosTotal / 6) / 10,
      porProfissional: Object.values(cap.porProfissional).map((p) => ({ ...p, taxa: pct(p.ocupados, p.disponiveis) })),
      porDiaSemana: cap.porDiaSemana.map((d) => ({ ...d, taxa: pct(d.ocupados, d.disponiveis) })),
      porFaixaHorario: Object.entries(porFaixa)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([faixa, ocupados]) => ({ faixa, horasOcupadas: Math.round(ocupados / 6) / 10 })),
      capacidadeServicos: Math.floor(disponiveisTotal / mediaOcupacao),
      metaServicos,
      servicosRealizados: itensConcluidos.length,
      horasPerdidasNoShow: Math.round(noShows.reduce((acc, a) => acc + minutos(a.inicio, a.fimIntervalo), 0) / 6) / 10,
      diasFechadosForaRotina: cap.diasFechadosForaRotina,
      horasPerdidasFechamento: Math.round(cap.minutosPerdidosFechamento / 6) / 10,
      horasOciosas: Math.round(Math.max(0, disponiveisTotal - ocupadosTotal) / 6) / 10,
    },
    comparecimento: {
      total: validos.length,
      noShows: noShows.length,
      taxaNoShow: pct(noShows.length, concluidos.length + noShows.length),
      cancelamentos: cancelados.length,
      taxaCancelamento: pct(cancelados.length, validos.length),
      expiradosSemPagamento: expirados.length,
    },
    clientes: {
      atendidos: clientesNoPeriodo.length,
      novos: clientesNoPeriodo.length - recorrentes.length,
      recorrentes: recorrentes.length,
      taxaRecorrencia: pct(recorrentes.length, clientesNoPeriodo.length),
      retornoAtrasado: segmentos.contagem.RETORNO_ATRASADO,
      inativos: segmentos.contagem.INATIVO,
    },
    servicos: {
      maisRealizados: [...servicosLista].sort((a, b) => b.quantidade - a.quantidade),
      maisFaturam: [...servicosLista].sort((a, b) => b.faturamento - a.faturamento),
      duracao: servicosLista.filter((s) => s.duracaoRealMedia !== null),
    },
    produtos,
    profissionais: Object.values(rankingMap).sort((a, b) => b.faturamento - a.faturamento),
    receita: {
      faturamento,
      atendimentos: concluidos.length,
      ticketMedio: concluidos.length ? Math.round(faturamento / concluidos.length) : 0,
      evolucaoMensal: await evolucaoMensal(tenantId, tz, profissionalId),
      origem,
      procura,
    },
  };
}

async function evolucaoMensal(tenantId, tz, profissionalId) {
  const hoje = todayStr(tz);
  const meses = [];
  let cursor = monthRange(hoje).from;
  for (let i = 0; i < 12; i += 1) {
    const r = monthRange(cursor);
    meses.unshift(r);
    cursor = monthRange(addDays(r.from, -1)).from;
  }
  const { start } = rangeUtc(meses[0].from, meses[0].from, tz);
  const ags = await prisma.agendamento.findMany({
    where: { tenantId, status: "CONCLUIDO", inicio: { gte: start }, ...(profissionalId ? { profissionalId } : {}) },
    select: { inicio: true, valorTotal: true },
  });
  return meses.map((m) => {
    const doMes = ags.filter((a) => {
      const d = zonedParts(a.inicio, tz).date;
      return d >= m.from && d <= m.to;
    });
    return { mes: m.from.slice(0, 7), faturamento: doMes.reduce((acc, a) => acc + a.valorTotal, 0), atendimentos: doMes.length };
  });
}

// ---------- segmentos de clientes ----------

const DIAS_PROXIMO = 7;

function classificar({ ultimoAtendimento, retornoPrevisto, proximoAgendamento, criadoEm }, hoje) {
  if (proximoAgendamento) return "ATIVO";
  if (!ultimoAtendimento) {
    const diasCadastro = (new Date(hoje) - new Date(criadoEm)) / 86400000;
    return diasCadastro > 90 ? "INATIVO" : "ATIVO";
  }
  const diasDesdeUltimo = (new Date(hoje) - new Date(ultimoAtendimento)) / 86400000;
  if (!retornoPrevisto) return diasDesdeUltimo > 180 ? "INATIVO" : "ATIVO";
  const ciclo = Math.max(1, (new Date(retornoPrevisto) - new Date(ultimoAtendimento)) / 86400000);
  const diasParaRetorno = (new Date(retornoPrevisto) - new Date(hoje)) / 86400000;
  if (diasParaRetorno > DIAS_PROXIMO) return "ATIVO";
  if (diasParaRetorno >= 0) return "RETORNO_PROXIMO";
  if (-diasParaRetorno > Math.max(60, ciclo)) return "INATIVO";
  return "RETORNO_ATRASADO";
}

async function segmentosClientes(tenantId, { profissionalId } = {}) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const hojeData = zonedToUtc(todayStr(tenant.timezone), "00:00", tenant.timezone);
  const clientes = await prisma.cliente.findMany({
    where: { tenantId, mescladoEmId: null, ...(profissionalId ? { agendamentos: { some: { profissionalId } } } : {}) },
    select: { id: true, createdAt: true },
  });
  const concluidos = await prisma.agendamento.findMany({
    where: { tenantId, status: "CONCLUIDO" },
    orderBy: { inicio: "desc" },
    select: { clienteId: true, inicio: true, retornoSugerido: true },
  });
  const futuros = await prisma.agendamento.findMany({
    where: { tenantId, status: { in: ["AGUARDANDO_PAGAMENTO", "CONFIRMADO"] }, inicio: { gte: new Date() } },
    select: { clienteId: true },
  });
  const ultimo = {};
  for (const a of concluidos) if (!ultimo[a.clienteId]) ultimo[a.clienteId] = a;
  const comFuturo = new Set(futuros.map((f) => f.clienteId));

  const porCliente = {};
  const contagem = { ATIVO: 0, RETORNO_PROXIMO: 0, RETORNO_ATRASADO: 0, INATIVO: 0 };
  for (const c of clientes) {
    const u = ultimo[c.id];
    const seg = classificar(
      { ultimoAtendimento: u?.inicio, retornoPrevisto: u?.retornoSugerido, proximoAgendamento: comFuturo.has(c.id), criadoEm: c.createdAt },
      hojeData
    );
    porCliente[c.id] = { segmento: seg, ultimoAtendimento: u?.inicio || null, retornoSugerido: u?.retornoSugerido || null };
    contagem[seg] += 1;
  }
  return { porCliente, contagem };
}

// ---------- financeiro ----------

async function comissoes({ tenantId, from, to, start, end, profissionalId }) {
  const profs = await prisma.profissional.findMany({ where: { tenantId, ...(profissionalId ? { id: profissionalId } : {}) }, orderBy: { nome: "asc" } });
  const ags = await prisma.agendamento.findMany({
    where: { tenantId, status: "CONCLUIDO", inicio: { gte: start, lt: end }, ...(profissionalId ? { profissionalId } : {}) },
    select: {
      profissionalId: true,
      valorServicos: true,
      desconto: true,
      valorProdutos: true,
      servicos: { select: { id: true, preco: true, valorPacote: true, pacoteSaldoId: true, pacoteDevolvido: true, servico: { select: { comissaoPct: true } } } },
    },
  });
  const pagas = await prisma.comissaoPaga.findMany({ where: { tenantId, periodoInicio: from, periodoFim: to } });
  // valor fixo e mensal: proporcional aos dias do periodo em cada mes
  const fracaoMeses = daysBetween(from, to).reduce((acc, d) => acc + 1 / Number(monthRange(d).to.slice(8, 10)), 0);
  return profs
    .filter((p) => p.ativo || ags.some((a) => a.profissionalId === p.id))
    .map((p) => {
    const doProf = ags.filter((a) => a.profissionalId === p.id);
    // Comissao item a item: a % do servico quando ele tem uma propria; senao a do profissional.
    // Servico pago com pacote usa o valor da sessao (o dinheiro entrou na venda do pacote).
    let baseServicos = 0;
    let comissao = 0;
    for (const a of doProf) {
      const fator = a.valorServicos > 0 ? Math.max(0, a.valorServicos - a.desconto) / a.valorServicos : 0;
      for (const it of a.servicos) {
        const base = it.pacoteSaldoId && !it.pacoteDevolvido ? it.valorPacote : it.preco * fator;
        const pct = it.servico?.comissaoPct ?? p.comissaoPct;
        baseServicos += base;
        comissao += (base * pct) / 100;
      }
    }
    baseServicos = Math.round(baseServicos);
    const valor = p.remuneracaoTipo === "FIXO" ? Math.round(p.valorFixo * fracaoMeses) : Math.round(comissao);
    const paga = pagas.find((x) => x.profissionalId === p.id);
    return {
      profissionalId: p.id,
      nome: p.nome,
      remuneracaoTipo: p.remuneracaoTipo,
      comissaoPct: p.comissaoPct,
      valorFixo: p.valorFixo,
      servicosRealizados: doProf.reduce((acc, a) => acc + a.servicos.length, 0),
      baseServicos,
      valor,
      paga: Boolean(paga),
      pagaEm: paga?.pagoEm || null,
    };
  });
}

async function resultadoFinanceiro({ tenantId, from, to, start, end }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const pagos = await prisma.pagamento.findMany({
    where: { tenantId, status: { in: ["APROVADO", "REEMBOLSADO", "REEMBOLSADO_PARCIAL"] }, pagoEm: { gte: start, lt: end } },
  });
  const reembolsos = await prisma.reembolso.aggregate({ where: { tenantId, status: "EXECUTADO", createdAt: { gte: start, lt: end } }, _sum: { valor: true } });
  const despesas = await prisma.despesa.aggregate({ where: { tenantId, data: { gte: from, lte: to } }, _sum: { valor: true } });
  const listaComissoes = await comissoes({ tenantId, from, to, start, end });

  const faturamento = pagos.reduce((acc, p) => acc + p.valorBruto, 0);
  const taxas = pagos.reduce((acc, p) => acc + p.taxaGateway, 0);
  const totalReembolsos = reembolsos._sum.valor || 0;
  const totalComissoes = listaComissoes.reduce((acc, c) => acc + c.valor, 0);
  const totalDespesas = despesas._sum.valor || 0;

  // meta geral do mes (sempre sobre o mes atual)
  const mes = monthRange(todayStr(tenant.timezone));
  const rm = rangeUtc(mes.from, mes.to, tenant.timezone);
  const pagosMes = await prisma.pagamento.aggregate({
    where: { tenantId, status: { in: ["APROVADO", "REEMBOLSADO_PARCIAL"] }, pagoEm: { gte: rm.start, lt: rm.end } },
    _sum: { valorBruto: true, valorReembolsado: true },
  });
  const realizadoMes = (pagosMes._sum.valorBruto || 0) - (pagosMes._sum.valorReembolsado || 0);

  return {
    faturamento,
    reembolsos: totalReembolsos,
    taxas,
    comissoes: totalComissoes,
    despesas: totalDespesas,
    resultado: faturamento - totalReembolsos - taxas - totalComissoes - totalDespesas,
    metaMes: { meta: tenant.metaValorMes, realizado: realizadoMes, progresso: pct(realizadoMes, tenant.metaValorMes) },
  };
}

module.exports = { desempenho, capacidade, segmentosClientes, classificar, comissoes, resultadoFinanceiro, pct };
