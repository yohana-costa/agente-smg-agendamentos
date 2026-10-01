// Criacao de estabelecimento (onboarding) com configuracoes padrao.
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
const { garantirAutomacoes } = require("./automacao.service");
const { badRequest, conflict } = require("../lib/errors");
const { requireText, normalizePhone, textOrEmpty } = require("../lib/helpers");

const FUNCIONAMENTO_PADRAO = [
  { diaSemana: 0, aberto: false, inicio: "09:00", fim: "18:00" },
  { diaSemana: 1, aberto: true, inicio: "09:00", fim: "19:00" },
  { diaSemana: 2, aberto: true, inicio: "09:00", fim: "19:00" },
  { diaSemana: 3, aberto: true, inicio: "09:00", fim: "19:00" },
  { diaSemana: 4, aberto: true, inicio: "09:00", fim: "19:00" },
  { diaSemana: 5, aberto: true, inicio: "09:00", fim: "19:00" },
  { diaSemana: 6, aberto: true, inicio: "09:00", fim: "14:00" },
];

function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function slugDisponivel(base) {
  let slug = slugify(base) || "estabelecimento";
  let n = 1;
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}

function jornadaDoFuncionamento(horarios) {
  return horarios.map((h) => ({
    diaSemana: h.diaSemana,
    trabalha: h.aberto,
    inicio: h.inicio,
    fim: h.fim,
    pausas: h.aberto && h.fim > "14:00" ? [{ inicio: "12:00", fim: "13:00" }] : [],
  }));
}

async function criarEstabelecimento(body) {
  const nomeEstabelecimento = requireText(body.nomeEstabelecimento, "Nome do estabelecimento");
  const nome = requireText(body.nome, "Seu nome");
  const email = requireText(body.email, "E-mail").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Informe um e-mail valido.");
  const senha = textOrEmpty(body.senha);
  if (senha.length < 6) throw badRequest("A senha deve ter pelo menos 6 caracteres.");
  if (await prisma.usuario.findUnique({ where: { email } })) throw conflict("Ja existe um usuario com este e-mail.");

  const slug = await slugDisponivel(body.slug || nomeEstabelecimento);
  const senhaHash = await bcrypt.hash(senha, 10);
  const telefone = normalizePhone(body.telefone) || null;

  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        nome: nomeEstabelecimento,
        slug,
        email,
        telefone,
        documento: textOrEmpty(body.documento) || null,
        siteTitulo: nomeEstabelecimento,
        // Assinatura pela landing: a conta nasce bloqueada e so libera quando o pagamento confirma.
        ...(body.pendentePagamento ? { ativo: false, statusAssinatura: "PENDENTE_PAGAMENTO" } : {}),
        horarios: { create: FUNCIONAMENTO_PADRAO },
      },
    });
    // Sempre equipe: o dono tambem e cadastrado como profissional.
    const profissional = await tx.profissional.create({
      data: { tenantId: t.id, nome, email, telefone, jornada: { create: jornadaDoFuncionamento(FUNCIONAMENTO_PADRAO) } },
    });
    await tx.usuario.create({ data: { tenantId: t.id, nome, email, senhaHash, perfil: "DONO", profissionalId: profissional.id } });
    await tx.agenteConfig.create({ data: { tenantId: t.id, personaNome: "Assistente", numeroEscalonamento: telefone } });
    return t;
  });
  await garantirAutomacoes(tenant.id);
  return tenant;
}

module.exports = { criarEstabelecimento, FUNCIONAMENTO_PADRAO, jornadaDoFuncionamento, slugify };
