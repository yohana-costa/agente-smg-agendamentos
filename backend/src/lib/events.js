// Barramento de eventos em memoria por estabelecimento, usado pelo SSE (/api/eventos/stream)
// para atualizar agenda, atendimento e pendencias em tempo real sem recarregar a pagina.
const { EventEmitter } = require("events");

const bus = new EventEmitter();
bus.setMaxListeners(0);

function publish(tenantId, type, payload = {}) {
  if (!tenantId) return;
  bus.emit(`tenant:${tenantId}`, { type, payload, at: new Date().toISOString() });
}

function subscribe(tenantId, listener) {
  const channel = `tenant:${tenantId}`;
  bus.on(channel, listener);
  return () => bus.off(channel, listener);
}

module.exports = { publish, subscribe };
