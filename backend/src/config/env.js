const dotenv = require("dotenv");

dotenv.config();

function text(value, fallback = "") {
  const raw = String(value ?? "").trim();
  return raw || fallback;
}

function int(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

const env = {
  nodeEnv: text(process.env.NODE_ENV, "development"),
  port: int(process.env.PORT, 3355, { min: 1 }),
  databaseUrl: text(process.env.DATABASE_URL),
  redisUrl: text(process.env.REDIS_URL),

  jwtSecret: text(process.env.JWT_SECRET, "dev-secret-troque-em-producao"),
  jwtExpiresIn: text(process.env.JWT_EXPIRES_IN, "7d"),

  // URL publica do frontend (site, portal, checkout simulado). Usada nos links enviados ao cliente.
  publicAppUrl: text(process.env.PUBLIC_APP_URL, "http://localhost:5176").replace(/\/+$/, ""),
  // URL publica da API (webhooks Mercado Pago / WhatsApp / Google OAuth).
  publicApiUrl: text(process.env.PUBLIC_API_URL, "http://localhost:3355").replace(/\/+$/, ""),

  // Pagamentos. Cada estabelecimento conecta a PROPRIA conta Mercado Pago pelo botao "Conectar"
  // (OAuth, mesmo modelo do Gestor SMG varejo). MP_ACCESS_TOKEN global so vale fora de producao.
  mpAccessToken: text(process.env.MP_ACCESS_TOKEN),
  // App da plataforma no Mercado Pago (o mesmo do Gestor SMG varejo) para o OAuth.
  mpClientId: text(process.env.MP_CLIENT_ID),
  mpClientSecret: text(process.env.MP_CLIENT_SECRET),
  mpOauthRedirectUri: text(process.env.MP_OAUTH_REDIRECT_URI),
  // Comissao da SMG sobre cada pagamento online (application_fee / marketplace_fee). 0 = sem comissao.
  mpTaxaPlataformaPct: Number(process.env.MP_TAXA_PLATAFORMA_PCT || 0),
  // Pix: o Mercado Pago exige no minimo 30 minutos de validade (a reserva do horario continua de 15).
  mpPixValidadeMinutos: int(process.env.MP_PIX_VALIDADE_MINUTOS, 30, { min: 30, max: 1440 }),
  // Modo simulado (botao "Simular pagamento" no checkout): nunca em producao.
  pagamentoSimuladoPermitido:
    text(process.env.PAGAMENTO_SIMULADO, "") === "true" ||
    (text(process.env.PAGAMENTO_SIMULADO, "") !== "false" && text(process.env.NODE_ENV, "development") !== "production"),
  mpWebhookSecret: text(process.env.MP_WEBHOOK_SECRET),
  gatewayTaxaPixPct: Number(process.env.GATEWAY_TAXA_PIX_PCT || 0.99),
  gatewayTaxaCartaoPct: Number(process.env.GATEWAY_TAXA_CARTAO_PCT || 4.98),

  // Reserva de horario aguardando pagamento
  reservaMinutos: int(process.env.RESERVA_MINUTOS, 15, { min: 2, max: 120 }),
  lembretePagamentoMinutos: int(process.env.LEMBRETE_PAGAMENTO_MINUTOS, 5, { min: 1, max: 60 }),

  schedulerIntervalSeconds: int(process.env.SCHEDULER_INTERVAL_SECONDS, 30, { min: 5, max: 600 }),
  schedulerEnabled: text(process.env.SCHEDULER_ENABLED, "true") !== "false",

  // IA (mesmo modelo do Gestor SMG varejo: OpenAI via LangChain)
  openaiApiKey: text(process.env.OPENAI_API_KEY),
  openaiModel: text(process.env.OPENAI_MODEL, "gpt-4o-mini"),
  openaiBaseUrl: text(process.env.OPENAI_BASE_URL, "https://api.openai.com/v1"),
  // Transcricao dos audios recebidos no WhatsApp (mesmo modelo do Gestor SMG varejo)
  openaiTranscribeModel: text(process.env.OPENAI_TRANSCRIBE_MODEL, "gpt-4o-mini-transcribe"),
  agentBufferSeconds: int(process.env.AGENT_BUFFER_SECONDS, 6, { min: 0, max: 60 }),
  agentHistoryLimit: int(process.env.AGENT_HISTORY_LIMIT, 30, { min: 4, max: 200 }),

  // WhatsApp (padroes; credenciais ficam por estabelecimento em AgenteConfig.whatsappConfig)
  uazapiBaseUrl: text(process.env.UAZAPI_BASE_URL),
  metaGraphBaseUrl: text(process.env.META_GRAPH_BASE_URL, "https://graph.facebook.com/v23.0"),
  // Quando true, mensagens nao sao enviadas de verdade (apenas registradas em log/conversa).
  whatsappDryRun: text(process.env.WHATSAPP_DRY_RUN, "false") === "true",

  // Google Calendar
  googleClientId: text(process.env.GOOGLE_CLIENT_ID),
  googleClientSecret: text(process.env.GOOGLE_CLIENT_SECRET),
  googleSyncMinutes: int(process.env.GOOGLE_SYNC_MINUTES, 10, { min: 1, max: 1440 }),
};

module.exports = env;
