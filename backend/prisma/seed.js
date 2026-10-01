// Seed de demonstracao: estabelecimento "Studio Demo" (slug demo).
// Logins: SEED_DONO_EMAIL (padrao dono@demo.com) / recepcao@demo.com / ana@demo.com.
// Senha: SEED_SENHA; em desenvolvimento cai em 123456, em producao e obrigatoria (senha de demo
// publicada no README nao pode virar login valido no servidor).
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { criarEstabelecimento } = require("../src/services/tenant.service");
const { zonedToUtc, addDays, todayStr, addMinutes } = require("../src/lib/time");

const prisma = new PrismaClient();

const SENHA_DEMO = process.env.SEED_SENHA || (process.env.NODE_ENV === "production" ? "" : "123456");

async function main() {
  if (process.env.SEED_DEMO === "false") return console.log("[seed] SEED_DEMO=false, ignorado.");
  if (!SENHA_DEMO) return console.log("[seed] producao sem SEED_SENHA: demo nao criado.");
  if (await prisma.tenant.findUnique({ where: { slug: "demo" } })) return console.log("[seed] demo ja existe.");

  const SENHA = SENHA_DEMO;
  const DONO_EMAIL = (process.env.SEED_DONO_EMAIL || "dono@demo.com").toLowerCase();
  const tenant = await criarEstabelecimento({
    nomeEstabelecimento: "Studio Demo",
    slug: "demo",
    nome: "Carla Dona",
    email: DONO_EMAIL,
    senha: SENHA,
    telefone: "11999990000",
  });
  const tz = tenant.timezone;
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      endereco: "Rua das Flores, 123 - Centro",
      siteDescricao: "Beleza e bem-estar com hora marcada.",
      prazoCancelamentoMin: 180,
      reembolsoForaPrazoPct: 50,
      reembolsoNoShowPct: 0,
      metaServicosMes: 150,
      metaValorMes: 1500000,
      venderProdutos: true,
      fidelidadeAtiva: true,
    },
  });

  const dono = await prisma.usuario.findFirst({ where: { tenantId: tenant.id, perfil: "DONO" } });
  const carlaId = dono.profissionalId;
  await prisma.profissional.update({ where: { id: carlaId }, data: { cor: "#007f64", comissaoPct: 0, metaServicosMes: 70 } });

  const senhaHash = await bcrypt.hash(SENHA, 10);
  const horarios = await prisma.horarioFuncionamento.findMany({ where: { tenantId: tenant.id } });
  const ana = await prisma.profissional.create({
    data: {
      tenantId: tenant.id,
      nome: "Ana Souza",
      email: "ana@demo.com",
      telefone: "5511988887777",
      cor: "#2563eb",
      comissaoPct: 40,
      metaServicosMes: 80,
      metaValorMes: 800000,
      jornada: {
        create: horarios.map((h) => ({ diaSemana: h.diaSemana, trabalha: h.aberto && h.diaSemana !== 1, inicio: h.inicio, fim: h.fim, pausas: [{ inicio: "12:00", fim: "13:00" }] })),
      },
    },
  });
  await prisma.usuario.createMany({
    data: [
      { tenantId: tenant.id, nome: "Ana Souza", email: "ana@demo.com", senhaHash, perfil: "PROFISSIONAL", profissionalId: ana.id },
      { tenantId: tenant.id, nome: "Rita Recepção", email: "recepcao@demo.com", senhaHash, perfil: "RECEPCAO" },
    ],
  });

  const produtos = await Promise.all([
    prisma.produto.create({ data: { tenantId: tenant.id, nome: "Shampoo Reparador 300ml", preco: 5990, custo: 2800, estoque: 12, estoqueMinimo: 3 } }),
    prisma.produto.create({ data: { tenantId: tenant.id, nome: "Óleo Finalizador", preco: 4590, custo: 1900, estoque: 2, estoqueMinimo: 3 } }),
    prisma.produto.create({ data: { tenantId: tenant.id, nome: "Base Fortalecedora", preco: 2490, custo: 900, estoque: 20, estoqueMinimo: 5 } }),
  ]);

  const mk = (nome, categoria, preco, duracaoMin, intervaloMin, retornoDias, profs, prods = []) =>
    prisma.servico.create({
      data: {
        tenantId: tenant.id,
        nome,
        categoria,
        preco,
        duracaoMin,
        intervaloMin,
        retornoDias,
        descricao: `${nome} realizado por profissionais especializados.`,
        profissionais: { create: profs.map((profissionalId) => ({ profissionalId })) },
        relacionados: { create: prods.map((produtoId) => ({ produtoId })) },
      },
    });
  const corte = await mk("Corte", "Cabelo", 8000, 40, 10, 30, [carlaId, ana.id], [produtos[0].id, produtos[1].id]);
  const escova = await mk("Escova", "Cabelo", 6000, 50, 10, 15, [carlaId, ana.id], [produtos[1].id]);
  const coloracao = await mk("Coloração", "Cabelo", 18000, 90, 15, 45, [carlaId]);
  const manicure = await mk("Manicure", "Unhas", 4000, 40, 5, 14, [ana.id], [produtos[2].id]);

  await prisma.recompensa.create({ data: { tenantId: tenant.id, nome: "Escova grátis", tipo: "SERVICO_GRATIS", servicoId: escova.id, pontosCusto: 300 } });
  await prisma.cupom.create({ data: { tenantId: tenant.id, codigo: "BEMVINDO10", tipo: "PERCENTUAL", valor: 10 } });

  const nomes = [
    ["Mariana Lima", "5511911110001"],
    ["Joana Prado", "5511911110002"],
    ["Paula Reis", "5511911110003"],
    ["Bruna Alves", "5511911110004"],
    ["Fernanda Costa", "5511911110005"],
    ["Luciana Melo", "5511911110006"],
  ];
  const clientes = [];
  for (const [nome, telefone] of nomes) clientes.push(await prisma.cliente.create({ data: { tenantId: tenant.id, nome, telefone } }));

  const hoje = todayStr(tz);
  const historico = [
    { c: 0, s: [corte], p: carlaId, dias: -40, hora: "10:00" },
    { c: 0, s: [corte, escova], p: carlaId, dias: -8, hora: "14:00" },
    { c: 1, s: [manicure], p: ana.id, dias: -20, hora: "09:00" },
    { c: 2, s: [coloracao], p: carlaId, dias: -70, hora: "15:00" },
    { c: 3, s: [escova], p: ana.id, dias: -3, hora: "11:00" },
    { c: 4, s: [corte], p: ana.id, dias: -27, hora: "16:00", noShow: true },
  ];
  for (const h of historico) {
    const data = addDays(hoje, h.dias);
    const inicio = zonedToUtc(data, h.hora, tz);
    const dur = h.s.reduce((a, s) => a + s.duracaoMin + s.intervaloMin, 0);
    const valor = h.s.reduce((a, s) => a + s.preco, 0);
    const ultimoIntervalo = h.s[h.s.length - 1].intervaloMin;
    const ag = await prisma.agendamento.create({
      data: {
        tenantId: tenant.id,
        clienteId: clientes[h.c].id,
        profissionalId: h.p,
        inicio,
        fim: addMinutes(inicio, dur - ultimoIntervalo),
        fimIntervalo: addMinutes(inicio, dur),
        status: h.noShow ? "NO_SHOW" : "CONCLUIDO",
        origem: h.c % 2 ? "SITE" : "MANUAL",
        modoPagamento: h.c % 2 ? "ONLINE" : "LOCAL",
        valorServicos: valor,
        valorTotal: valor,
        iniciadoEm: h.noShow ? null : inicio,
        finalizadoEm: h.noShow ? null : addMinutes(inicio, dur - ultimoIntervalo),
        duracaoValida: !h.noShow,
        retornoSugerido: h.noShow ? null : zonedToUtc(addDays(data, Math.max(...h.s.map((s) => s.retornoDias))), "09:00", tz),
        servicos: { create: h.s.map((s, ordem) => ({ servicoId: s.id, nome: s.nome, preco: s.preco, duracaoMin: s.duracaoMin, intervaloMin: s.intervaloMin, ordem, duracaoRealMin: h.noShow ? null : s.duracaoMin + 5 })) },
      },
    });
    await prisma.pagamento.create({
      data: {
        tenantId: tenant.id,
        clienteId: clientes[h.c].id,
        agendamentoId: ag.id,
        origem: h.c % 2 ? "SITE" : "MANUAL",
        modo: h.c % 2 ? "ONLINE" : "LOCAL",
        forma: h.c % 2 ? "PIX" : "DINHEIRO",
        status: "APROVADO",
        valorBruto: valor,
        taxaGateway: h.c % 2 ? Math.round(valor * 0.0099) : 0,
        valorLiquido: h.c % 2 ? valor - Math.round(valor * 0.0099) : valor,
        gateway: h.c % 2 ? "simulado" : null,
        pagoEm: inicio,
      },
    });
  }

  // agendamentos futuros confirmados
  const futuros = [
    { c: 5, s: [corte], p: carlaId, dias: 1, hora: "10:00" },
    { c: 1, s: [manicure], p: ana.id, dias: 2, hora: "14:00" },
  ];
  for (const f of futuros) {
    const data = addDays(hoje, f.dias);
    const inicio = zonedToUtc(data, f.hora, tz);
    const s = f.s[0];
    await prisma.agendamento.create({
      data: {
        tenantId: tenant.id,
        clienteId: clientes[f.c].id,
        profissionalId: f.p,
        inicio,
        fim: addMinutes(inicio, s.duracaoMin),
        fimIntervalo: addMinutes(inicio, s.duracaoMin + s.intervaloMin),
        status: "CONFIRMADO",
        origem: "MANUAL",
        modoPagamento: "LOCAL",
        valorServicos: s.preco,
        valorTotal: s.preco,
        servicos: { create: [{ servicoId: s.id, nome: s.nome, preco: s.preco, duracaoMin: s.duracaoMin, intervaloMin: s.intervaloMin }] },
      },
    });
  }

  await prisma.despesa.createMany({
    data: [
      { tenantId: tenant.id, data: addDays(hoje, -5), categoria: "Aluguel", descricao: "Aluguel do mês", valor: 250000 },
      { tenantId: tenant.id, data: addDays(hoje, -2), categoria: "Materiais", descricao: "Tintas e descartáveis", valor: 38000 },
    ],
  });

  await prisma.agenteConfig.update({
    where: { tenantId: tenant.id },
    data: {
      personaNome: "Bia",
      personaTom: "Simpática, acolhedora e objetiva",
      personaApresentacao: "Oi! Eu sou a Bia, assistente virtual do Studio Demo. Posso te ajudar com seus agendamentos 💚",
      informacoesNegocio: "Estacionamento conveniado na rua de trás. Aceitamos Pix e cartão. Atendemos com hora marcada.",
    },
  });
  await prisma.numeroAutorizado.create({
    data: { tenantId: tenant.id, telefone: "5511999990000", nome: "Carla (dona)", permissoes: { consultar: ["agenda", "clientes", "servicos", "produtos", "equipe", "financeiro", "desempenho"], alterar: ["agenda", "clientes", "servicos", "produtos", "financeiro"] } },
  });

  console.log(`[seed] Studio Demo criado. Login: ${DONO_EMAIL} — site: /s/demo`);
}

main()
  .catch((error) => {
    console.error("[seed] erro", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
