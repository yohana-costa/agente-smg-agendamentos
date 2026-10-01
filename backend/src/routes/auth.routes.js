const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
const { criarEstabelecimento } = require("../services/tenant.service");
const { signUsuarioToken, requireAuth, resolvePermissoes } = require("../middleware/auth");
const { createAppError } = require("../lib/errors");
const { asyncHandler, ok, textOrEmpty } = require("../lib/helpers");

const router = express.Router();

function sessao(usuario, tenant) {
  return {
    token: signUsuarioToken(usuario),
    usuario: perfilUsuario(usuario, tenant),
  };
}

function perfilUsuario(usuario, tenant) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    profissionalId: usuario.profissionalId,
    permissoes: resolvePermissoes(tenant, usuario.perfil),
    tenant: {
      id: tenant.id,
      nome: tenant.nome,
      slug: tenant.slug,
      timezone: tenant.timezone,
      venderProdutos: tenant.venderProdutos,
      fidelidadeAtiva: tenant.fidelidadeAtiva,
    },
  };
}

// Cria estabelecimento + usuario dono (que tambem e profissional).
router.post(
  "/registrar",
  asyncHandler(async (req, res) => {
    const tenant = await criarEstabelecimento(req.body || {});
    const usuario = await prisma.usuario.findFirst({ where: { tenantId: tenant.id, perfil: "DONO" } });
    return ok(res, sessao(usuario, tenant));
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = textOrEmpty(req.body?.email).toLowerCase();
    const senha = textOrEmpty(req.body?.senha);
    const usuario = await prisma.usuario.findUnique({ where: { email }, include: { tenant: true } });
    if (!usuario || !usuario.ativo || !(await bcrypt.compare(senha, usuario.senhaHash))) {
      throw createAppError("E-mail ou senha invalidos.", 401);
    }
    await prisma.usuario.update({ where: { id: usuario.id }, data: { ultimoLoginEm: new Date() } });
    return ok(res, sessao(usuario, usuario.tenant));
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.auth.usuarioId } });
    return ok(res, perfilUsuario(usuario, req.auth.tenant));
  })
);

router.post(
  "/senha",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.auth.usuarioId } });
    if (!(await bcrypt.compare(textOrEmpty(req.body?.senhaAtual), usuario.senhaHash))) throw createAppError("Senha atual incorreta.", 400);
    const nova = textOrEmpty(req.body?.novaSenha);
    if (nova.length < 6) throw createAppError("A nova senha deve ter pelo menos 6 caracteres.", 400);
    await prisma.usuario.update({ where: { id: usuario.id }, data: { senhaHash: await bcrypt.hash(nova, 10) } });
    return ok(res, { alterada: true });
  })
);

module.exports = router;
