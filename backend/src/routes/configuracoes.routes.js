// Aba Configuracoes (acesso exclusivo do dono).
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
const env = require("../config/env");
const gateway = require("../services/pagamentos/gateway");
const mpOauth = require("../services/pagamentos/mercadopago-oauth.service");
const google = require("../services/google-calendar.service");
const { ABAS, PERMISSOES_PADRAO, resolvePermissoes } = require("../middleware/auth");
const { slugify } = require("../services/tenant.service");
const { badRequest, conflict, notFound } = require("../lib/errors");
const { asyncHandler, ok, requireText, textOrNull, toInt, toBool, normalizePhone, textOrEmpty } = require("../lib/helpers");
const { isTimeStr } = require("../lib/time");

const router = express.Router();

function semSegredos(tenant) {
  const { mpAccessToken, mpRefreshToken, ...resto } = tenant;
  return { ...resto, mpAccessTokenConfigurado: Boolean(mpAccessToken) };
}

function dadosPagamento(tenant) {
  return {
    modo: gateway.modo(tenant),
    conectado: Boolean(tenant.mpAccessToken),
    // conectado pelo botao (OAuth) ou por token colado antes desta versao
    viaOauth: Boolean(tenant.mpRefreshToken),
    contaId: tenant.mpUserId || null,
    oauthDisponivel: mpOauth.configurado(),
  };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, include: { horarios: { orderBy: { diaSemana: "asc" } } } });
    return ok(res, {
      empresa: { nome: tenant.nome, documento: tenant.documento, telefone: tenant.telefone, email: tenant.email, endereco: tenant.endereco, timezone: tenant.timezone, slug: tenant.slug },
      funcionamento: tenant.horarios,
      politicas: {
        prazoCancelamentoMin: tenant.prazoCancelamentoMin,
        reembolsoForaPrazoPct: tenant.reembolsoForaPrazoPct,
        reembolsoNoShowPct: tenant.reembolsoNoShowPct,
        reembolsoIntegralDescontaTaxa: tenant.reembolsoIntegralDescontaTaxa,
      },
      agenda: { toleranciaPendenteMin: tenant.toleranciaPendenteMin, intervaloSlotsMin: tenant.intervaloSlotsMin },
      metas: { metaServicosMes: tenant.metaServicosMes, metaValorMes: tenant.metaValorMes },
      pagamentos: dadosPagamento(tenant),
      site: {
        url: `${env.publicAppUrl}/s/${tenant.slug}`,
        siteTitulo: tenant.siteTitulo,
        siteDescricao: tenant.siteDescricao,
        siteCorPrimaria: tenant.siteCorPrimaria,
        siteLogoUrl: tenant.siteLogoUrl,
        siteBannerUrl: tenant.siteBannerUrl,
      },
      integracoes: { googleConfigurado: google.configurado() },
      plano: { plano: tenant.plano, ativo: tenant.ativo, desde: tenant.createdAt },
    });
  })
);

router.patch(
  "/empresa",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.nome !== undefined) data.nome = requireText(b.nome, "Nome");
    for (const k of ["documento", "email", "endereco"]) if (b[k] !== undefined) data[k] = textOrNull(b[k]);
    if (b.telefone !== undefined) data.telefone = normalizePhone(b.telefone) || null;
    if (b.timezone !== undefined) data.timezone = textOrEmpty(b.timezone) || "America/Sao_Paulo";
    return ok(res, semSegredos(await prisma.tenant.update({ where: { id: req.auth.tenantId }, data })));
  })
);

// [{ diaSemana, aberto, inicio, fim }] — dias fechados da rotina nao contam como capacidade perdida
router.put(
  "/funcionamento",
  asyncHandler(async (req, res) => {
    const dias = Array.isArray(req.body?.funcionamento) ? req.body.funcionamento : [];
    for (const d of dias) {
      const diaSemana = toInt(d.diaSemana, -1);
      if (diaSemana < 0 || diaSemana > 6) throw badRequest("Dia da semana invalido.");
      if (d.aberto && (!isTimeStr(d.inicio) || !isTimeStr(d.fim) || d.fim <= d.inicio)) throw badRequest("Horario de funcionamento invalido.");
      await prisma.horarioFuncionamento.upsert({
        where: { tenantId_diaSemana: { tenantId: req.auth.tenantId, diaSemana } },
        update: { aberto: Boolean(d.aberto), inicio: d.inicio || "09:00", fim: d.fim || "18:00" },
        create: { tenantId: req.auth.tenantId, diaSemana, aberto: Boolean(d.aberto), inicio: d.inicio || "09:00", fim: d.fim || "18:00" },
      });
    }
    require("../lib/events").publish(req.auth.tenantId, "agenda.atualizada", { acao: "funcionamento" });
    return ok(res, await prisma.horarioFuncionamento.findMany({ where: { tenantId: req.auth.tenantId }, orderBy: { diaSemana: "asc" } }));
  })
);

router.patch(
  "/politicas",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.prazoCancelamentoMin !== undefined) data.prazoCancelamentoMin = toInt(b.prazoCancelamentoMin, 0, { min: 0, max: 60 * 24 * 60 });
    if (b.reembolsoForaPrazoPct !== undefined) data.reembolsoForaPrazoPct = toInt(b.reembolsoForaPrazoPct, 0, { min: 0, max: 100 });
    if (b.reembolsoNoShowPct !== undefined) data.reembolsoNoShowPct = toInt(b.reembolsoNoShowPct, 0, { min: 0, max: 100 });
    if (b.reembolsoIntegralDescontaTaxa !== undefined) data.reembolsoIntegralDescontaTaxa = toBool(b.reembolsoIntegralDescontaTaxa);
    return ok(res, semSegredos(await prisma.tenant.update({ where: { id: req.auth.tenantId }, data })));
  })
);

router.patch(
  "/agenda",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.toleranciaPendenteMin !== undefined) data.toleranciaPendenteMin = toInt(b.toleranciaPendenteMin, 10, { min: 0, max: 240 });
    if (b.intervaloSlotsMin !== undefined) data.intervaloSlotsMin = toInt(b.intervaloSlotsMin, 60, { min: 5, max: 240 });
    return ok(res, semSegredos(await prisma.tenant.update({ where: { id: req.auth.tenantId }, data })));
  })
);

router.patch(
  "/metas",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.metaServicosMes !== undefined) data.metaServicosMes = toInt(b.metaServicosMes, 0, { min: 0 });
    if (b.metaValorMes !== undefined) data.metaValorMes = toInt(b.metaValorMes, 0, { min: 0 });
    return ok(res, semSegredos(await prisma.tenant.update({ where: { id: req.auth.tenantId }, data })));
  })
);

// "Conectar Mercado Pago" (OAuth, igual ao Gestor SMG varejo): o dono autoriza a propria conta
// no site do Mercado Pago e volta para Configuracoes > Pagamentos. Nao se cola token na mao.
router.get(
  "/pagamentos/conectar",
  asyncHandler(async (req, res) => ok(res, mpOauth.iniciarConexao(req.auth.tenantId)))
);

router.post(
  "/pagamentos/desconectar",
  asyncHandler(async (req, res) => {
    await mpOauth.desconectar(req.auth.tenantId);
    const t = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } });
    return ok(res, dadosPagamento(t));
  })
);

router.patch(
  "/site",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const data = {};
    for (const k of ["siteTitulo", "siteDescricao", "siteLogoUrl", "siteBannerUrl"]) if (b[k] !== undefined) data[k] = textOrNull(b[k]);
    if (b.siteCorPrimaria !== undefined) data.siteCorPrimaria = /^#[0-9a-fA-F]{6}$/.test(b.siteCorPrimaria) ? b.siteCorPrimaria : "#007f64";
    if (b.slug !== undefined) {
      const slug = slugify(b.slug);
      if (!slug) throw badRequest("Link invalido.");
      const outro = await prisma.tenant.findUnique({ where: { slug } });
      if (outro && outro.id !== req.auth.tenantId) throw conflict("Este link ja esta em uso.");
      data.slug = slug;
    }
    return ok(res, semSegredos(await prisma.tenant.update({ where: { id: req.auth.tenantId }, data })));
  })
);

// ---------- usuarios e permissoes ----------

router.get(
  "/usuarios",
  asyncHandler(async (req, res) => {
    const usuarios = await prisma.usuario.findMany({
      where: { tenantId: req.auth.tenantId },
      select: { id: true, nome: true, email: true, perfil: true, ativo: true, profissionalId: true, ultimoLoginEm: true, createdAt: true },
      orderBy: { nome: "asc" },
    });
    const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } });
    return ok(res, {
      usuarios,
      abas: ABAS,
      permissoes: { RECEPCAO: resolvePermissoes(tenant, "RECEPCAO"), PROFISSIONAL: resolvePermissoes(tenant, "PROFISSIONAL") },
      padrao: PERMISSOES_PADRAO,
    });
  })
);

// cria usuario de recepcao
router.post(
  "/usuarios",
  asyncHandler(async (req, res) => {
    const email = requireText(req.body?.email, "E-mail").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Informe um e-mail valido.");
    if (await prisma.usuario.findUnique({ where: { email } })) throw conflict("Ja existe um usuario com este e-mail.");
    const senha = textOrEmpty(req.body?.senha) || crypto.randomBytes(4).toString("hex");
    const usuario = await prisma.usuario.create({
      data: { tenantId: req.auth.tenantId, nome: requireText(req.body?.nome, "Nome"), email, senhaHash: await bcrypt.hash(senha, 10), perfil: "RECEPCAO" },
    });
    return ok(res, { id: usuario.id, email, senhaTemporaria: req.body?.senha ? null : senha });
  })
);

router.patch(
  "/usuarios/:id",
  asyncHandler(async (req, res) => {
    const u = await prisma.usuario.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!u) throw notFound("Usuario nao encontrado.");
    if (u.perfil === "DONO" && req.body?.ativo === false) throw badRequest("O dono nao pode ser desativado.");
    const data = {};
    if (req.body?.nome !== undefined) data.nome = requireText(req.body.nome, "Nome");
    if (req.body?.ativo !== undefined) data.ativo = toBool(req.body.ativo);
    let senhaTemporaria = null;
    if (req.body?.redefinirSenha) {
      senhaTemporaria = crypto.randomBytes(4).toString("hex");
      data.senhaHash = await bcrypt.hash(senhaTemporaria, 10);
    }
    await prisma.usuario.update({ where: { id: u.id }, data });
    return ok(res, { atualizado: true, senhaTemporaria });
  })
);

// { RECEPCAO: { abas, verFinanceiroVisaoGeral, financeiroCompleto }, PROFISSIONAL: { abas, verAgendaColegas } }
router.put(
  "/permissoes",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const limpar = (abas) => (Array.isArray(abas) ? abas.filter((a) => ABAS.includes(a) && a !== "configuracoes") : undefined);
    const permissoesPerfis = {
      RECEPCAO: {
        abas: limpar(b.RECEPCAO?.abas) ?? PERMISSOES_PADRAO.RECEPCAO.abas,
        verFinanceiroVisaoGeral: toBool(b.RECEPCAO?.verFinanceiroVisaoGeral),
        financeiroCompleto: toBool(b.RECEPCAO?.financeiroCompleto),
      },
      PROFISSIONAL: {
        abas: limpar(b.PROFISSIONAL?.abas) ?? PERMISSOES_PADRAO.PROFISSIONAL.abas,
        verAgendaColegas: toBool(b.PROFISSIONAL?.verAgendaColegas),
      },
    };
    const t = await prisma.tenant.update({ where: { id: req.auth.tenantId }, data: { permissoesPerfis } });
    return ok(res, { RECEPCAO: resolvePermissoes(t, "RECEPCAO"), PROFISSIONAL: resolvePermissoes(t, "PROFISSIONAL") });
  })
);

// Assinatura do estabelecimento com a SMG (so leitura; cancelar e pelo suporte).
router.get(
  "/assinatura",
  asyncHandler(async (req, res) => {
    const a = await prisma.assinaturaPlataforma.findUnique({ where: { tenantId: req.auth.tenantId } });
    return ok(res, {
      plano: req.auth.tenant.plano,
      status: req.auth.tenant.statusAssinatura,
      assinatura: a
        ? { metodo: a.metodo, valor: a.valor, status: a.status, proximoVencimento: a.proximoVencimento, confirmadaEm: a.confirmadaEm, canceladaEm: a.canceladaEm }
        : null,
      contatoWhatsapp: env.contatoWhatsapp,
    });
  })
);

// Cancelar a assinatura com a SMG (so o dono: este router ja exige requireDono).
router.post(
  "/assinatura/cancelar",
  asyncHandler(async (req, res) => {
    const assinaturas = require("../services/assinatura/assinatura.service");
    return ok(res, await assinaturas.cancelarAssinatura(req.auth.tenantId, { motivo: req.body?.motivo }));
  })
);

module.exports = router;
