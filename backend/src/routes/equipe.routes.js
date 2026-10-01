const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
const env = require("../config/env");
const metricas = require("../services/metricas.service");
const google = require("../services/google-calendar.service");
const { jornadaDoFuncionamento } = require("../services/tenant.service");
const { enviarTexto } = require("../services/whatsapp/whatsapp.service");
const { requireAba, requireDono } = require("../middleware/auth");
const { badRequest, notFound, conflict, forbidden } = require("../lib/errors");
const { asyncHandler, ok, requireText, textOrNull, toInt, normalizePhone, textOrEmpty } = require("../lib/helpers");
const { parsePeriod, isDateStr, isTimeStr, zonedToUtc, addDays, todayStr, monthRange } = require("../lib/time");

const router = express.Router();

// ---------- Google Calendar do proprio profissional (qualquer perfil com profissional vinculado) ----------

router.get(
  "/meu-google",
  asyncHandler(async (req, res) => {
    if (!req.auth.profissionalId) throw badRequest("Seu usuario nao esta vinculado a um profissional.");
    const prof = await prisma.profissional.findUnique({ where: { id: req.auth.profissionalId } });
    return ok(res, { configurado: google.configurado(), conectado: prof.googleConectado, email: prof.googleEmail, sincronizadoEm: prof.googleSyncEm });
  })
);
router.get(
  "/meu-google/conectar",
  asyncHandler(async (req, res) => {
    if (!req.auth.profissionalId) throw badRequest("Seu usuario nao esta vinculado a um profissional.");
    return ok(res, { url: google.urlConexao(req.auth.profissionalId) });
  })
);
router.post(
  "/meu-google/sincronizar",
  asyncHandler(async (req, res) => ok(res, { eventos: await google.sincronizarProfissional(req.auth.profissionalId) }))
);
router.delete(
  "/meu-google",
  asyncHandler(async (req, res) => {
    await google.desconectar(req.auth.profissionalId);
    return ok(res, { desconectado: true });
  })
);

// ---------- aba Equipe ----------

router.use(requireAba("equipe"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const mes = monthRange(todayStr(tenant.timezone));
    const [profissionais, d] = await Promise.all([
      prisma.profissional.findMany({ where: { tenantId }, include: { usuario: { select: { id: true, email: true, perfil: true, ativo: true } } }, orderBy: { nome: "asc" } }),
      metricas.desempenho({ tenantId, from: mes.from, to: mes.to }),
    ]);
    return ok(
      res,
      profissionais.map((p) => {
        const cap = d.capacidade.porProfissional.find((x) => x.profissionalId === p.id);
        const rank = d.profissionais.find((x) => x.profissionalId === p.id);
        return {
          ...p,
          googleRefreshToken: undefined,
          indicadoresMes: {
            ocupacao: cap?.taxa ?? 0,
            servicos: rank?.servicos ?? 0,
            faturamento: rank?.faturamento ?? 0,
            progressoMetaServicos: metricas.pct(rank?.servicos ?? 0, p.metaServicosMes),
            progressoMetaValor: metricas.pct(rank?.faturamento ?? 0, p.metaValorMes),
          },
        };
      })
    );
  })
);

function payload(body) {
  const data = {};
  if (body.nome !== undefined) data.nome = requireText(body.nome, "Nome");
  if (body.telefone !== undefined) data.telefone = normalizePhone(body.telefone) || null;
  if (body.email !== undefined) data.email = textOrNull(body.email)?.toLowerCase() || null;
  if (body.cor !== undefined) data.cor = textOrEmpty(body.cor) || "#007f64";
  if (body.ativo !== undefined) data.ativo = Boolean(body.ativo);
  if (body.remuneracaoTipo !== undefined) data.remuneracaoTipo = body.remuneracaoTipo === "FIXO" ? "FIXO" : "COMISSAO";
  if (body.comissaoPct !== undefined) data.comissaoPct = toInt(body.comissaoPct, 0, { min: 0, max: 100 });
  if (body.valorFixo !== undefined) data.valorFixo = toInt(body.valorFixo, 0, { min: 0 });
  if (body.metaServicosMes !== undefined) data.metaServicosMes = toInt(body.metaServicosMes, 0, { min: 0 });
  if (body.metaValorMes !== undefined) data.metaValorMes = toInt(body.metaValorMes, 0, { min: 0 });
  return data;
}

// Adicionar profissional: cria o cadastro e envia convite de acesso com login proprio.
router.post(
  "/",
  requireDono,
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const body = req.body || {};
    const data = payload({ ...body, nome: body.nome });
    const email = data.email;
    if (email && (await prisma.usuario.findUnique({ where: { email } }))) throw conflict("Ja existe um usuario com este e-mail.");
    const horarios = await prisma.horarioFuncionamento.findMany({ where: { tenantId }, orderBy: { diaSemana: "asc" } });

    const profissional = await prisma.profissional.create({
      data: { tenantId, ...data, jornada: { create: jornadaDoFuncionamento(horarios) } },
    });
    if (Array.isArray(body.servicoIds) && body.servicoIds.length) {
      const servicos = await prisma.servico.findMany({ where: { tenantId, id: { in: body.servicoIds } }, select: { id: true } });
      await prisma.servicoProfissional.createMany({ data: servicos.map((s) => ({ servicoId: s.id, profissionalId: profissional.id })) });
    }

    let convite = null;
    if (email) {
      const senhaTemporaria = crypto.randomBytes(4).toString("hex");
      await prisma.usuario.create({
        data: { tenantId, nome: profissional.nome, email, senhaHash: await bcrypt.hash(senhaTemporaria, 10), perfil: "PROFISSIONAL", profissionalId: profissional.id },
      });
      const texto = `Ola, ${profissional.nome.split(" ")[0]}! Voce foi convidado(a) para a equipe de ${tenant.nome} no Gestor SMG Agendamentos.\nAcesse: ${env.publicAppUrl}/login\nE-mail: ${email}\nSenha temporaria: ${senhaTemporaria}`;
      const envio = profissional.telefone ? await enviarTexto(tenantId, profissional.telefone, texto, { registrar: false }) : { enviado: false };
      convite = { email, senhaTemporaria, enviadoWhatsApp: envio.enviado };
    }
    return ok(res, { profissional, convite });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const p = await prisma.profissional.findFirst({
      where: { id: req.params.id, tenantId: req.auth.tenantId },
      include: {
        jornada: { orderBy: { diaSemana: "asc" } },
        ausencias: { where: { fim: { gte: new Date() } }, orderBy: { inicio: "asc" } },
        servicos: { select: { servicoId: true } },
        usuario: { select: { id: true, email: true, perfil: true, ativo: true } },
      },
    });
    if (!p) throw notFound("Profissional nao encontrado.");
    return ok(res, { ...p, googleRefreshToken: undefined, servicoIds: p.servicos.map((s) => s.servicoId), servicos: undefined, googleConfigurado: google.configurado() });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const p = await prisma.profissional.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!p) throw notFound("Profissional nao encontrado.");
    if (req.auth.perfil !== "DONO" && req.auth.profissionalId !== p.id) throw forbidden("Voce so pode editar o seu proprio cadastro.");
    const body = req.body || {};
    const data = payload(body);
    if (data.email && data.email !== p.email) {
      const outro = await prisma.usuario.findUnique({ where: { email: data.email } });
      if (outro && outro.profissionalId !== p.id) throw conflict("Ja existe um usuario com este e-mail.");
      await prisma.usuario.updateMany({ where: { profissionalId: p.id }, data: { email: data.email } });
    }
    // remuneracao e metas sao definidas pelo dono
    if (req.auth.perfil !== "DONO") {
      for (const k of ["remuneracaoTipo", "comissaoPct", "valorFixo", "metaServicosMes", "metaValorMes", "ativo"]) delete data[k];
    }
    const atualizado = await prisma.profissional.update({ where: { id: p.id }, data });
    if (Array.isArray(body.servicoIds)) {
      const servicos = await prisma.servico.findMany({ where: { tenantId: req.auth.tenantId, id: { in: body.servicoIds } }, select: { id: true } });
      await prisma.servicoProfissional.deleteMany({ where: { profissionalId: p.id } });
      await prisma.servicoProfissional.createMany({ data: servicos.map((s) => ({ servicoId: s.id, profissionalId: p.id })) });
    }
    if (body.ativo === false) await prisma.usuario.updateMany({ where: { profissionalId: p.id, perfil: "PROFISSIONAL" }, data: { ativo: false } });
    if (body.ativo === true) await prisma.usuario.updateMany({ where: { profissionalId: p.id, perfil: "PROFISSIONAL" }, data: { ativo: true } });
    return ok(res, { ...atualizado, googleRefreshToken: undefined });
  })
);

// Jornada semanal: [{ diaSemana, trabalha, inicio, fim, pausas: [{inicio, fim}] }]
router.put(
  "/:id/jornada",
  asyncHandler(async (req, res) => {
    const p = await prisma.profissional.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!p) throw notFound("Profissional nao encontrado.");
    const dias = Array.isArray(req.body?.jornada) ? req.body.jornada : [];
    for (const d of dias) {
      const diaSemana = toInt(d.diaSemana, -1);
      if (diaSemana < 0 || diaSemana > 6) throw badRequest("Dia da semana invalido.");
      if (d.trabalha && (!isTimeStr(d.inicio) || !isTimeStr(d.fim) || d.fim <= d.inicio)) throw badRequest("Horario de jornada invalido.");
      const pausas = (Array.isArray(d.pausas) ? d.pausas : []).filter((x) => isTimeStr(x.inicio) && isTimeStr(x.fim) && x.fim > x.inicio);
      await prisma.jornadaProfissional.upsert({
        where: { profissionalId_diaSemana: { profissionalId: p.id, diaSemana } },
        update: { trabalha: Boolean(d.trabalha), inicio: d.inicio || "08:00", fim: d.fim || "18:00", pausas },
        create: { profissionalId: p.id, diaSemana, trabalha: Boolean(d.trabalha), inicio: d.inicio || "08:00", fim: d.fim || "18:00", pausas },
      });
    }
    require("../lib/events").publish(req.auth.tenantId, "agenda.atualizada", { acao: "jornada" });
    return ok(res, await prisma.jornadaProfissional.findMany({ where: { profissionalId: p.id }, orderBy: { diaSemana: "asc" } }));
  })
);

// Folgas e ausencias programadas (dias inteiros ou periodo com horario)
router.post(
  "/:id/ausencias",
  asyncHandler(async (req, res) => {
    const { tenant } = req.auth;
    const p = await prisma.profissional.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!p) throw notFound("Profissional nao encontrado.");
    const { dataInicio, dataFim, horaInicio, horaFim, motivo } = req.body || {};
    if (!isDateStr(dataInicio)) throw badRequest("Informe a data inicial.");
    const fimData = isDateStr(dataFim) ? dataFim : dataInicio;
    const inicio = zonedToUtc(dataInicio, isTimeStr(horaInicio) ? horaInicio : "00:00", tenant.timezone);
    const fim = isTimeStr(horaFim) ? zonedToUtc(fimData, horaFim, tenant.timezone) : zonedToUtc(addDays(fimData, 1), "00:00", tenant.timezone);
    if (fim <= inicio) throw badRequest("Periodo invalido.");
    const conflitos = await prisma.agendamento.count({
      where: { profissionalId: p.id, status: { in: ["AGUARDANDO_PAGAMENTO", "CONFIRMADO"] }, inicio: { lt: fim }, fimIntervalo: { gt: inicio } },
    });
    const ausencia = await prisma.ausencia.create({ data: { profissionalId: p.id, inicio, fim, motivo: textOrNull(motivo) } });
    require("../lib/events").publish(req.auth.tenantId, "agenda.atualizada", { acao: "ausencia" });
    return ok(res, { ausencia, agendamentosNoPeriodo: conflitos });
  })
);

router.delete(
  "/ausencias/:ausenciaId",
  asyncHandler(async (req, res) => {
    const a = await prisma.ausencia.findFirst({ where: { id: req.params.ausenciaId, profissional: { tenantId: req.auth.tenantId } } });
    if (!a) throw notFound("Ausencia nao encontrada.");
    await prisma.ausencia.delete({ where: { id: a.id } });
    return ok(res, { removida: true });
  })
);

// Resultados do profissional (filtravel por periodo)
router.get(
  "/:id/resultados",
  asyncHandler(async (req, res) => {
    const { tenantId, tenant } = req.auth;
    const p = await prisma.profissional.findFirst({ where: { id: req.params.id, tenantId } });
    if (!p) throw notFound("Profissional nao encontrado.");
    const periodo = parsePeriod(req.query, tenant.timezone);
    const d = await metricas.desempenho({ tenantId, from: periodo.from, to: periodo.to, profissionalId: p.id });
    const [comissao] = await metricas.comissoes({ tenantId, ...periodo, profissionalId: p.id });
    return ok(res, {
      periodo: { de: periodo.from, ate: periodo.to },
      taxaOcupacao: d.capacidade.taxaOcupacao,
      servicosRealizados: d.capacidade.servicosRealizados,
      faturamento: d.receita.faturamento,
      remuneracao: comissao,
      meta: {
        servicos: { meta: p.metaServicosMes, realizado: d.capacidade.servicosRealizados, progresso: metricas.pct(d.capacidade.servicosRealizados, p.metaServicosMes) },
        valor: { meta: p.metaValorMes, realizado: d.receita.faturamento, progresso: metricas.pct(d.receita.faturamento, p.metaValorMes) },
      },
    });
  })
);

router.post(
  "/:id/reenviar-convite",
  requireDono,
  asyncHandler(async (req, res) => {
    const p = await prisma.profissional.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId }, include: { usuario: true } });
    if (!p?.usuario) throw badRequest("Este profissional ainda nao tem login. Informe um e-mail no cadastro.");
    if (p.usuario.perfil === "DONO") throw forbidden("O login do dono nao pode ser redefinido por aqui.");
    const senhaTemporaria = crypto.randomBytes(4).toString("hex");
    await prisma.usuario.update({ where: { id: p.usuario.id }, data: { senhaHash: await bcrypt.hash(senhaTemporaria, 10) } });
    const texto = `Ola, ${p.nome.split(" ")[0]}! Seu acesso ao Gestor SMG Agendamentos (${req.auth.tenant.nome}):\nAcesse: ${env.publicAppUrl}/login\nE-mail: ${p.usuario.email}\nSenha temporaria: ${senhaTemporaria}`;
    const envio = p.telefone ? await enviarTexto(req.auth.tenantId, p.telefone, texto, { registrar: false }) : { enviado: false };
    return ok(res, { email: p.usuario.email, senhaTemporaria, enviadoWhatsApp: envio.enviado });
  })
);

// Cria login para profissional que ainda nao tem
router.post(
  "/:id/criar-acesso",
  requireDono,
  asyncHandler(async (req, res) => {
    const p = await prisma.profissional.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId }, include: { usuario: true } });
    if (!p) throw notFound("Profissional nao encontrado.");
    if (p.usuario) throw badRequest("Este profissional ja tem login.");
    const email = requireText(req.body?.email || p.email, "E-mail").toLowerCase();
    if (await prisma.usuario.findUnique({ where: { email } })) throw conflict("Ja existe um usuario com este e-mail.");
    const senhaTemporaria = crypto.randomBytes(4).toString("hex");
    await prisma.usuario.create({
      data: { tenantId: req.auth.tenantId, nome: p.nome, email, senhaHash: await bcrypt.hash(senhaTemporaria, 10), perfil: "PROFISSIONAL", profissionalId: p.id },
    });
    await prisma.profissional.update({ where: { id: p.id }, data: { email } });
    return ok(res, { email, senhaTemporaria });
  })
);

module.exports = router;
