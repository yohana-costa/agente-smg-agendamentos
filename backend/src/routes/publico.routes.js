// Site publico do estabelecimento + cadastro/login do Portal do cliente.
// Nenhum dado de cadastro existente e exibido aqui: o historico so aparece no portal, apos login.
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
const env = require("../config/env");
const disponibilidade = require("../services/disponibilidade.service");
const agendamentoService = require("../services/agendamento.service");
const vendaService = require("../services/venda.service");
const { descreverPrazo } = require("../services/politica.service");
const { encontrarOuCriarCliente } = require("../services/cliente.service");
const { enviarTexto } = require("../services/whatsapp/whatsapp.service");
const { signClienteToken } = require("../middleware/auth");
const { notFound, badRequest, createAppError } = require("../lib/errors");
const { asyncHandler, ok, requirePhone, requireText, textOrEmpty, textOrNull } = require("../lib/helpers");
const { isDateStr, addMinutes } = require("../lib/time");

const router = express.Router();

async function tenantPorSlug(slug) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: String(slug || "") } });
  if (!tenant || !tenant.ativo) throw notFound("Estabelecimento não encontrado.");
  return tenant;
}

function politicaTexto(t) {
  const partes = [`Cancelamento até ${descreverPrazo(t.prazoCancelamentoMin)} antes do horário: reembolso integral.`];
  partes.push(`Cancelamento fora desse prazo: reembolso de ${t.reembolsoForaPrazoPct}% do valor pago.`);
  partes.push(`Não comparecimento (no-show): reembolso de ${t.reembolsoNoShowPct}% do valor pago. Cancelar depois do horário marcado conta como no-show.`);
  partes.push("Reagendamento dentro do prazo mantém o pagamento; fora do prazo segue a regra de cancelamento e exige novo pagamento.");
  return partes.join(" ");
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

router.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const t = await tenantPorSlug(req.params.slug);
    const [servicos, profissionais, produtos] = await Promise.all([
      prisma.servico.findMany({
        where: { tenantId: t.id, ativo: true },
        include: { profissionais: { where: { profissional: { ativo: true } }, select: { profissionalId: true } }, relacionados: { select: { produtoId: true } } },
        orderBy: [{ categoria: "asc" }, { nome: "asc" }],
      }),
      prisma.profissional.findMany({ where: { tenantId: t.id, ativo: true }, select: { id: true, nome: true, cor: true }, orderBy: { nome: "asc" } }),
      t.venderProdutos ? prisma.produto.findMany({ where: { tenantId: t.id, ativo: true }, orderBy: { nome: "asc" } }) : [],
    ]);
    return ok(res, {
      estabelecimento: {
        nome: t.nome,
        slug: t.slug,
        endereco: t.endereco,
        telefone: t.telefone,
        titulo: t.siteTitulo || t.nome,
        descricao: t.siteDescricao,
        corPrimaria: t.siteCorPrimaria,
        logoUrl: t.siteLogoUrl,
        bannerUrl: t.siteBannerUrl,
      },
      servicos: servicos
        .filter((s) => s.profissionais.length)
        .map((s) => ({
          id: s.id,
          nome: s.nome,
          categoria: s.categoria,
          descricao: s.descricao,
          preco: s.preco,
          duracaoMin: s.duracaoMin,
          intervaloMin: s.intervaloMin,
          profissionalIds: s.profissionais.map((p) => p.profissionalId),
          produtoIds: s.relacionados.map((r) => r.produtoId),
        })),
      profissionais,
      venderProdutos: t.venderProdutos,
      produtos: produtos.map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, disponivel: p.estoque > 0, estoque: p.estoque })),
      fidelidadeAtiva: t.fidelidadeAtiva,
      politica: {
        texto: politicaTexto(t),
        prazoCancelamentoMin: t.prazoCancelamentoMin,
        reembolsoForaPrazoPct: t.reembolsoForaPrazoPct,
        reembolsoNoShowPct: t.reembolsoNoShowPct,
      },
      reservaMinutos: env.reservaMinutos,
    });
  })
);

router.get(
  "/:slug/horarios",
  asyncHandler(async (req, res) => {
    const t = await tenantPorSlug(req.params.slug);
    const r = await disponibilidade.listarHorarios({
      tenantId: t.id,
      servicoIds: csv(req.query.servicoIds),
      profissionalId: req.query.profissionalId ? String(req.query.profissionalId) : undefined,
      data: String(req.query.data || ""),
    });
    return ok(res, r);
  })
);

// Proximos dias com horario livre (para destacar no calendario do site)
router.get(
  "/:slug/dias",
  asyncHandler(async (req, res) => {
    const t = await tenantPorSlug(req.params.slug);
    const dias = await disponibilidade.proximosDiasDisponiveis({
      tenantId: t.id,
      servicoIds: csv(req.query.servicoIds),
      profissionalId: req.query.profissionalId ? String(req.query.profissionalId) : undefined,
      aPartirDe: isDateStr(req.query.de) ? req.query.de : undefined,
      dias: 31,
      maxResultados: 31,
    });
    return ok(res, dias.map((d) => d.data));
  })
);

// Fluxo de agendamento do site: reserva por 15 minutos com status Aguardando pagamento.
router.post(
  "/:slug/agendamentos",
  asyncHandler(async (req, res) => {
    const t = await tenantPorSlug(req.params.slug);
    const b = req.body || {};
    const ag = await agendamentoService.criar({
      tenantId: t.id,
      origem: "SITE",
      cliente: { nome: requireText(b.cliente?.nome, "Nome"), telefone: requirePhone(b.cliente?.telefone) },
      servicoIds: b.servicoIds,
      profissionalId: b.profissionalId,
      data: b.data,
      hora: b.hora,
      produtos: Array.isArray(b.produtos) ? b.produtos : [],
      cupomCodigo: textOrNull(b.cupom),
    });
    const pagamento = ag.pagamentos.find((p) => p.status === "PENDENTE");
    return ok(res, {
      agendamentoId: ag.id,
      status: ag.status,
      valorTotal: ag.valorTotal,
      expiraEm: ag.expiraEm,
      pagamentoId: pagamento?.id || null,
      linkPagamento: pagamento?.linkPagamento || null,
    });
  })
);

// Compra de produtos pelo site (retirada no local)
router.post(
  "/:slug/pedidos",
  asyncHandler(async (req, res) => {
    const t = await tenantPorSlug(req.params.slug);
    const b = req.body || {};
    const r = await vendaService.criarVenda({
      tenantId: t.id,
      origem: "SITE",
      itens: b.itens,
      cliente: { nome: requireText(b.cliente?.nome, "Nome"), telefone: requirePhone(b.cliente?.telefone) },
    });
    return ok(res, { vendaId: r.venda.id, valorTotal: r.venda.valorTotal, pagamentoId: r.pagamento.id, linkPagamento: r.pagamento.linkPagamento, expiraEm: r.venda.expiraEm });
  })
);

// ---------- Portal do cliente: criacao de conta e login ----------

// Envia codigo de verificacao por WhatsApp para o telefone informado.
router.post(
  "/:slug/portal/codigo",
  asyncHandler(async (req, res) => {
    const t = await tenantPorSlug(req.params.slug);
    const telefone = requirePhone(req.body?.telefone);
    const finalidade = req.body?.finalidade === "SENHA" ? "SENHA" : "CADASTRO";
    const recentes = await prisma.codigoVerificacao.count({ where: { tenantId: t.id, telefone, createdAt: { gt: addMinutes(new Date(), -10) } } });
    if (recentes >= 5) throw createAppError("Muitas tentativas. Aguarde alguns minutos.", 429);
    if (finalidade === "SENHA") {
      const c = await prisma.cliente.findUnique({ where: { tenantId_telefone: { tenantId: t.id, telefone } } });
      if (!c?.portalAtivo) throw badRequest("Não existe conta no portal para este telefone.");
    }
    const codigo = String(crypto.randomInt(100000, 999999));
    await prisma.codigoVerificacao.create({ data: { tenantId: t.id, telefone, codigo, finalidade, expiraEm: addMinutes(new Date(), 10) } });
    const envio = await enviarTexto(t.id, telefone, `${t.nome}: seu código de verificação é ${codigo}. Ele expira em 10 minutos.`, { registrar: false });
    return ok(res, {
      enviado: envio.enviado,
      // em desenvolvimento (sem WhatsApp configurado) o codigo volta na resposta para permitir testar
      ...(env.nodeEnv !== "production" && !envio.enviado ? { codigoDev: codigo } : {}),
    });
  })
);

async function validarCodigo(tenantId, telefone, codigo, finalidade) {
  const registro = await prisma.codigoVerificacao.findFirst({
    where: { tenantId, telefone, finalidade, usado: false, expiraEm: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!registro) throw badRequest("Código expirado. Solicite um novo código.");
  if (registro.tentativas >= 5) throw badRequest("Código bloqueado. Solicite um novo código.");
  if (registro.codigo !== textOrEmpty(codigo)) {
    await prisma.codigoVerificacao.update({ where: { id: registro.id }, data: { tentativas: { increment: 1 } } });
    throw badRequest("Código incorreto.");
  }
  await prisma.codigoVerificacao.update({ where: { id: registro.id }, data: { usado: true } });
}

// Cria a conta: vincula automaticamente todos os agendamentos anteriores do telefone verificado.
router.post(
  "/:slug/portal/cadastro",
  asyncHandler(async (req, res) => {
    const t = await tenantPorSlug(req.params.slug);
    const telefone = requirePhone(req.body?.telefone);
    const nome = requireText(req.body?.nome, "Nome");
    const senha = textOrEmpty(req.body?.senha);
    if (senha.length < 6) throw badRequest("A senha deve ter pelo menos 6 caracteres.");
    await validarCodigo(t.id, telefone, req.body?.codigo, "CADASTRO");
    // telefone existente com nome diferente: o nome e atualizado
    const cliente = await encontrarOuCriarCliente(t.id, { telefone, nome });
    const atualizado = await prisma.cliente.update({ where: { id: cliente.id }, data: { senhaHash: await bcrypt.hash(senha, 10), portalAtivo: true } });
    return ok(res, { token: signClienteToken(atualizado), cliente: { nome: atualizado.nome, telefone: atualizado.telefone } });
  })
);

router.post(
  "/:slug/portal/login",
  asyncHandler(async (req, res) => {
    const t = await tenantPorSlug(req.params.slug);
    const telefone = requirePhone(req.body?.telefone);
    const cliente = await prisma.cliente.findUnique({ where: { tenantId_telefone: { tenantId: t.id, telefone } } });
    if (!cliente?.portalAtivo || !cliente.senhaHash || !(await bcrypt.compare(textOrEmpty(req.body?.senha), cliente.senhaHash))) {
      throw createAppError("Telefone ou senha inválidos.", 401);
    }
    return ok(res, { token: signClienteToken(cliente), cliente: { nome: cliente.nome, telefone: cliente.telefone } });
  })
);

router.post(
  "/:slug/portal/redefinir-senha",
  asyncHandler(async (req, res) => {
    const t = await tenantPorSlug(req.params.slug);
    const telefone = requirePhone(req.body?.telefone);
    const senha = textOrEmpty(req.body?.senha);
    if (senha.length < 6) throw badRequest("A senha deve ter pelo menos 6 caracteres.");
    await validarCodigo(t.id, telefone, req.body?.codigo, "SENHA");
    const cliente = await prisma.cliente.update({
      where: { tenantId_telefone: { tenantId: t.id, telefone } },
      data: { senhaHash: await bcrypt.hash(senha, 10) },
    });
    return ok(res, { token: signClienteToken(cliente), cliente: { nome: cliente.nome, telefone: cliente.telefone } });
  })
);

module.exports = router;
