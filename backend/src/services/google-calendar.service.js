// Google Calendar: cada profissional conecta o proprio Google pelo seu login.
// Eventos sincronizados ocupam a agenda (aparecem como "Ocupado" para os demais perfis).
const axios = require("axios");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const env = require("../config/env");
const { createAppError } = require("../lib/errors");
const { log } = require("../lib/helpers");

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly openid email";

function configurado() {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

function redirectUri() {
  return `${env.publicApiUrl}/api/integracoes/google/callback`;
}

function urlConexao(profissionalId) {
  if (!configurado()) throw createAppError("Integracao com Google Calendar nao configurada no servidor (GOOGLE_CLIENT_ID/SECRET).", 400);
  const state = jwt.sign({ pid: profissionalId }, env.jwtSecret, { expiresIn: "15m" });
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPE,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function trocarCodigo(code, state) {
  const { pid } = jwt.verify(state, env.jwtSecret);
  const { data } = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({ code, client_id: env.googleClientId, client_secret: env.googleClientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" })
  );
  let email = null;
  if (data.id_token) email = jwt.decode(data.id_token)?.email || null;
  await prisma.profissional.update({
    where: { id: pid },
    data: { googleConectado: true, googleRefreshToken: data.refresh_token, googleEmail: email, googleCalendarId: "primary" },
  });
  await sincronizarProfissional(pid).catch((error) => log("google", "sync_inicial_falhou", { pid, erro: error.message }));
  return pid;
}

async function accessToken(refreshToken) {
  const { data } = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({ refresh_token: refreshToken, client_id: env.googleClientId, client_secret: env.googleClientSecret, grant_type: "refresh_token" })
  );
  return data.access_token;
}

async function sincronizarProfissional(profissionalId) {
  const prof = await prisma.profissional.findUnique({ where: { id: profissionalId } });
  if (!prof?.googleConectado || !prof.googleRefreshToken || !configurado()) return 0;
  const token = await accessToken(prof.googleRefreshToken);
  const timeMin = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
  const { data } = await axios.get(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(prof.googleCalendarId || "primary")}/events`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 2500 },
  });
  const eventos = (data.items || []).filter((e) => e.status !== "cancelled" && e.transparency !== "transparent");
  const ids = [];
  for (const e of eventos) {
    const inicio = e.start?.dateTime || (e.start?.date ? `${e.start.date}T00:00:00-03:00` : null);
    const fim = e.end?.dateTime || (e.end?.date ? `${e.end.date}T00:00:00-03:00` : null);
    if (!inicio || !fim) continue;
    ids.push(e.id);
    await prisma.eventoExterno.upsert({
      where: { profissionalId_externalId: { profissionalId, externalId: e.id } },
      update: { titulo: e.summary || null, inicio: new Date(inicio), fim: new Date(fim) },
      create: { profissionalId, externalId: e.id, titulo: e.summary || null, inicio: new Date(inicio), fim: new Date(fim) },
    });
  }
  await prisma.eventoExterno.deleteMany({ where: { profissionalId, externalId: { notIn: ids }, fim: { gt: new Date(timeMin) } } });
  await prisma.profissional.update({ where: { id: profissionalId }, data: { googleSyncEm: new Date() } });
  return eventos.length;
}

async function desconectar(profissionalId) {
  await prisma.eventoExterno.deleteMany({ where: { profissionalId } });
  await prisma.profissional.update({ where: { id: profissionalId }, data: { googleConectado: false, googleRefreshToken: null, googleEmail: null } });
}

async function sincronizarTodos() {
  if (!configurado()) return;
  const limite = new Date(Date.now() - env.googleSyncMinutes * 60000);
  const profs = await prisma.profissional.findMany({
    where: { googleConectado: true, OR: [{ googleSyncEm: null }, { googleSyncEm: { lt: limite } }] },
    select: { id: true },
  });
  for (const p of profs) {
    await sincronizarProfissional(p.id).catch((error) => log("google", "sync_falhou", { profissionalId: p.id, erro: error.message }));
  }
}

module.exports = { configurado, urlConexao, trocarCodigo, sincronizarProfissional, sincronizarTodos, desconectar };
