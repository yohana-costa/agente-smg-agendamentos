// Server-Sent Events: agenda, atendimento e pendencias atualizam sem recarregar a pagina.
const express = require("express");
const events = require("../lib/events");

const router = express.Router();

router.get("/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: {}\n\n`);

  const unsubscribe = events.subscribe(req.auth.tenantId, (evento) => {
    res.write(`event: ${evento.type}\ndata: ${JSON.stringify(evento)}\n\n`);
  });
  const ping = setInterval(() => res.write(`: ping\n\n`), 25000);

  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
});

module.exports = router;
