// "Conectar Mercado Pago" via OAuth (mesmo modelo do Gestor SMG varejo).
//
// O app da plataforma (MP_CLIENT_ID/SECRET) so faz a ponte: cada estabelecimento clica em
// Conectar, autoriza a PROPRIA conta e o token devolvido e dela. O dinheiro dos agendamentos
// cai na conta do estabelecimento; a SMG recebe apenas a comissao (application_fee).
// O access token dura ~180 dias; guardamos o refresh token para renovar sozinho.
const axios = require("axios");
const jwt = require("jsonwebtoken");
const prisma = require("../../lib/prisma");
const env = require("../../config/env");
const { badRequest } = require("../../lib/errors");
const { log } = require("../../lib/helpers");

const STATE_TTL_SEGUNDOS = 15 * 60;
const RENOVAR_ANTES_MS = 24 * 60 * 60 * 1000;

function configurado() {
  return Boolean(env.mpClientId && env.mpClientSecret);
}

function redirectUri() {
  return env.mpOauthRedirectUri || `${env.publicApiUrl}/api/integracoes/mercadopago/callback`;
}

function iniciarConexao(tenantId) {
  if (!configurado()) throw badRequest("A conexão com o Mercado Pago ainda não foi configurada na plataforma.");
  const state = jwt.sign({ tenantId, tipo: "mp_oauth" }, env.jwtSecret, { expiresIn: STATE_TTL_SEGUNDOS });
  const params = new URLSearchParams({
    client_id: env.mpClientId,
    response_type: "code",
    platform_id: "mp",
    state,
    redirect_uri: redirectUri(),
  });
  return { url: `https://auth.mercadopago.com.br/authorization?${params.toString()}` };
}

async function pedirToken(body) {
  const r = await axios.post("https://api.mercadopago.com/oauth/token", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300 || !r.data?.access_token) {
    const detalhe = r.data?.message || r.data?.error || `HTTP ${r.status}`;
    throw badRequest(`Falha ao conectar com o Mercado Pago: ${detalhe}`);
  }
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token || null,
    userId: r.data.user_id != null ? String(r.data.user_id) : null,
    publicKey: r.data.public_key || null,
    expiresIn: Number(r.data.expires_in || 0),
  };
}

async function finalizarConexao(code, state) {
  let tenantId;
  try {
    const payload = jwt.verify(String(state || ""), env.jwtSecret);
    if (payload?.tipo !== "mp_oauth" || !payload?.tenantId) throw new Error("state invalido");
    tenantId = String(payload.tenantId);
  } catch (_e) {
    throw badRequest("Sessão de conexão expirada ou inválida. Conecte de novo.");
  }
  const t = await pedirToken({
    client_id: env.mpClientId,
    client_secret: env.mpClientSecret,
    grant_type: "authorization_code",
    code: String(code || ""),
    redirect_uri: redirectUri(),
  });
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      mpAccessToken: t.accessToken,
      mpRefreshToken: t.refreshToken,
      mpUserId: t.userId,
      mpPublicKey: t.publicKey,
      mpTokenExpiraEm: t.expiresIn ? new Date(Date.now() + t.expiresIn * 1000) : null,
    },
  });
  log("mp.oauth", "conectado", { tenantId, userId: t.userId });
  return { tenantId };
}

async function desconectar(tenantId) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { mpAccessToken: null, mpRefreshToken: null, mpUserId: null, mpPublicKey: null, mpTokenExpiraEm: null },
  });
  return { ok: true };
}

/**
 * Access token valido do estabelecimento, renovando pelo refresh quando falta menos de 1 dia.
 * Ponto unico chamado antes de qualquer chamada a API do Mercado Pago.
 */
async function tokenValido(tenant) {
  const atual = String(tenant?.mpAccessToken || "").trim();
  if (!atual) return "";
  const expira = tenant.mpTokenExpiraEm ? new Date(tenant.mpTokenExpiraEm).getTime() : 0;
  if (!tenant.mpRefreshToken || !expira || expira - Date.now() > RENOVAR_ANTES_MS) return atual;
  try {
    const novo = await pedirToken({
      client_id: env.mpClientId,
      client_secret: env.mpClientSecret,
      grant_type: "refresh_token",
      refresh_token: tenant.mpRefreshToken,
    });
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        mpAccessToken: novo.accessToken,
        mpRefreshToken: novo.refreshToken || tenant.mpRefreshToken,
        mpTokenExpiraEm: novo.expiresIn ? new Date(Date.now() + novo.expiresIn * 1000) : null,
      },
    });
    return novo.accessToken;
  } catch (error) {
    log("mp.oauth", "renovacao_falhou", { tenantId: tenant.id, erro: error.message });
    return atual;
  }
}

module.exports = { configurado, iniciarConexao, finalizarConexao, desconectar, tokenValido };
