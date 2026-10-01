const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const routes = require("./routes");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.use("/api", routes);

app.use((req, res) => {
  res.status(404).json({ success: false, error: `Rota nao encontrada: ${req.method} ${req.originalUrl}` });
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, _next) => {
  const status = Number(error.statusCode || error.status || 500);
  if (status >= 500) console.error("[app][erro]", error);
  // erros de validacao do Prisma viram 400 legiveis
  const message = status >= 500 && error.code?.startsWith?.("P") ? "Erro ao salvar os dados." : error.message || "Erro interno.";
  res.status(status).json({ success: false, error: message, details: error.details || undefined });
});

module.exports = app;
