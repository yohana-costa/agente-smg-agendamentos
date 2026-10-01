const express = require("express");
const env = require("../config/env");
const google = require("../services/google-calendar.service");
const mpOauth = require("../services/pagamentos/mercadopago-oauth.service");
const { log } = require("../lib/helpers");

const router = express.Router();

// Callback do OAuth do Google Calendar (cada profissional conecta o proprio Google)
router.get("/google/callback", async (req, res) => {
  try {
    await google.trocarCodigo(String(req.query.code || ""), String(req.query.state || ""));
    return res.redirect(`${env.publicAppUrl}/app/agenda?google=conectado`);
  } catch (error) {
    log("google", "callback_erro", { erro: error.message });
    return res.redirect(`${env.publicAppUrl}/app/agenda?google=erro`);
  }
});

// Callback do OAuth do Mercado Pago (Configuracoes > Pagamentos > Conectar)
router.get("/mercadopago/callback", async (req, res) => {
  const destino = `${env.publicAppUrl}/app/configuracoes?tab=pagamentos`;
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    await mpOauth.finalizarConexao(String(req.query.code || ""), String(req.query.state || ""));
    return res.redirect(`${destino}&mp=ok`);
  } catch (error) {
    log("mp.oauth", "callback_erro", { erro: error.message });
    return res.redirect(`${destino}&mp=erro`);
  }
});

module.exports = router;
