const express = require("express");
const env = require("../config/env");
const google = require("../services/google-calendar.service");
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

module.exports = router;
