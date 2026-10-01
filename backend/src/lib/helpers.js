const { badRequest } = require("./errors");

function textOrEmpty(value) {
  return String(value ?? "").trim();
}

function textOrNull(value) {
  const text = textOrEmpty(value);
  return text || null;
}

// Telefone: apenas digitos. Numeros brasileiros sem DDI ganham 55.
function normalizePhone(value) {
  let digits = String(value ?? "").split("@")[0].replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits;
}

function requirePhone(value, label = "Telefone") {
  const phone = normalizePhone(value);
  if (phone.length < 12) throw badRequest(`${label} invalido. Informe DDD e numero.`);
  return phone;
}

function requireText(value, label) {
  const text = textOrEmpty(value);
  if (!text) throw badRequest(`${label} e obrigatorio.`);
  return text;
}

function toInt(value, fallback = 0, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "sim", "yes", "on"].includes(String(value).toLowerCase());
}

function pick(source = {}, keys = []) {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function brl(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function ok(res, data, extra = {}) {
  return res.json({ success: true, data, ...extra });
}

function log(scope, event, payload = {}) {
  console.log(`[${scope}][${new Date().toISOString()}][${event}]`, payload);
}

module.exports = {
  textOrEmpty,
  textOrNull,
  normalizePhone,
  requirePhone,
  requireText,
  toInt,
  toBool,
  pick,
  brl,
  asyncHandler,
  ok,
  log,
};
