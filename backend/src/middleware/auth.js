const jwt = require("jsonwebtoken");
const env = require("../config/env");
const prisma = require("../lib/prisma");
const { createAppError } = require("../lib/errors");

const ABAS = [
  "visao-geral",
  "agenda",
  "clientes",
  "servicos",
  "equipe",
  "financeiro",
  "desempenho",
  "atendimento",
  "fidelidade",
  "agentes",
  "automacoes",
  "configuracoes",
];

// Padroes do escopo (secao 2). O dono pode ajustar em Configuracoes > Usuarios e permissoes.
const PERMISSOES_PADRAO = {
  RECEPCAO: {
    abas: ["visao-geral", "agenda", "clientes", "atendimento", "financeiro"],
    verFinanceiroVisaoGeral: false,
    financeiroCompleto: false, // false = apenas Recebimentos
  },
  PROFISSIONAL: {
    abas: ["visao-geral", "agenda", "clientes", "desempenho"],
    verAgendaColegas: false,
  },
};

function resolvePermissoes(tenant, perfil) {
  if (perfil === "DONO") {
    return { abas: [...ABAS], verFinanceiroVisaoGeral: true, financeiroCompleto: true, verAgendaColegas: true };
  }
  const base = PERMISSOES_PADRAO[perfil] || { abas: [] };
  const custom = (tenant?.permissoesPerfis && tenant.permissoesPerfis[perfil]) || {};
  const merged = { ...base, ...custom };
  // Configuracoes e sempre exclusiva do dono.
  merged.abas = (Array.isArray(merged.abas) ? merged.abas : base.abas).filter(
    (aba) => ABAS.includes(aba) && aba !== "configuracoes"
  );
  return merged;
}

function signUsuarioToken(usuario) {
  return jwt.sign({ typ: "usuario", sub: usuario.id, tid: usuario.tenantId }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function signClienteToken(cliente) {
  return jwt.sign({ typ: "cliente", sub: cliente.id, tid: cliente.tenantId }, env.jwtSecret, {
    expiresIn: "30d",
  });
}

function readToken(req) {
  const header = String(req.headers.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  // EventSource nao envia headers: aceita ?token= apenas para o stream SSE.
  if (req.query?.token) return String(req.query.token);
  return "";
}

function verify(token, typ) {
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (payload.typ !== typ) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

async function requireAuth(req, _res, next) {
  try {
    const payload = verify(readToken(req), "usuario");
    if (!payload) throw createAppError("Sessao invalida ou expirada. Faca login novamente.", 401);

    const usuario = await prisma.usuario.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    });
    if (!usuario || !usuario.ativo || !usuario.tenant?.ativo) {
      throw createAppError("Usuario sem acesso.", 401);
    }

    req.auth = {
      usuarioId: usuario.id,
      tenantId: usuario.tenantId,
      tenant: usuario.tenant,
      perfil: usuario.perfil,
      nome: usuario.nome,
      profissionalId: usuario.profissionalId,
      permissoes: resolvePermissoes(usuario.tenant, usuario.perfil),
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAba(...abas) {
  return (req, _res, next) => {
    const allowed = req.auth?.permissoes?.abas || [];
    if (abas.some((aba) => allowed.includes(aba))) return next();
    return next(createAppError("Seu perfil nao tem acesso a esta area.", 403));
  };
}

function requireDono(req, _res, next) {
  if (req.auth?.perfil === "DONO") return next();
  return next(createAppError("Apenas o dono pode realizar esta acao.", 403));
}

function requirePerfil(...perfis) {
  return (req, _res, next) => {
    if (perfis.includes(req.auth?.perfil)) return next();
    return next(createAppError("Seu perfil nao pode realizar esta acao.", 403));
  };
}

// Para o perfil Profissional retorna o proprio profissionalId (escopo forcado); para os demais, null.
function profissionalScope(req) {
  return req.auth?.perfil === "PROFISSIONAL" ? req.auth.profissionalId || "__nenhum__" : null;
}

async function requireCliente(req, _res, next) {
  try {
    const payload = verify(readToken(req), "cliente");
    if (!payload) throw createAppError("Sessao do portal invalida. Faca login novamente.", 401);
    const cliente = await prisma.cliente.findUnique({ where: { id: payload.sub }, include: { tenant: true } });
    if (!cliente || !cliente.portalAtivo) throw createAppError("Conta do portal nao encontrada.", 401);
    req.cliente = cliente;
    req.tenant = cliente.tenant;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  ABAS,
  PERMISSOES_PADRAO,
  resolvePermissoes,
  signUsuarioToken,
  signClienteToken,
  requireAuth,
  requireAba,
  requireDono,
  requirePerfil,
  requireCliente,
  profissionalScope,
};
