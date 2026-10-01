const express = require("express");
const { requireAuth, requireAba, requireDono } = require("../middleware/auth");

const router = express.Router();

router.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok", at: new Date().toISOString() } }));

// publicas
router.use("/auth", require("./auth.routes"));
router.use("/publico", require("./publico.routes"));
router.use("/portal", require("./portal.routes"));
router.use("/checkout", require("./checkout.routes"));
router.use("/assinatura", require("./assinatura.routes"));
router.use("/webhooks", require("./webhooks.routes"));
router.use("/integracoes", require("./integracoes.routes"));

// autenticadas (sistema)
router.use("/eventos", requireAuth, require("./eventos.routes"));
router.use("/visao-geral", requireAuth, requireAba("visao-geral"), require("./visao-geral.routes"));
router.use("/agenda", requireAuth, requireAba("agenda"), require("./agenda.routes"));
router.use("/clientes", requireAuth, requireAba("clientes"), require("./clientes.routes"));
router.use("/servicos", requireAuth, require("./servicos.routes"));
router.use("/produtos", requireAuth, require("./produtos.routes"));
router.use("/equipe", requireAuth, require("./equipe.routes"));
router.use("/financeiro", requireAuth, requireAba("financeiro"), require("./financeiro.routes"));
router.use("/desempenho", requireAuth, requireAba("desempenho"), require("./desempenho.routes"));
router.use("/atendimento", requireAuth, requireAba("atendimento"), require("./atendimento.routes"));
router.use("/fidelidade", requireAuth, requireAba("fidelidade"), require("./fidelidade.routes"));
router.use("/agentes", requireAuth, requireAba("agentes"), require("./agentes.routes"));
router.use("/automacoes", requireAuth, requireAba("automacoes"), require("./automacoes.routes"));
router.use("/configuracoes", requireAuth, requireDono, require("./configuracoes.routes"));

module.exports = router;
