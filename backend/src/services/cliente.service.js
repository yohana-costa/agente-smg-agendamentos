// Identificacao do cliente (escopo 4.1): somente pelo telefone; o nome nunca vincula cadastros.
const prisma = require("../lib/prisma");
const { requirePhone, textOrEmpty } = require("../lib/helpers");
const { badRequest } = require("../lib/errors");

async function encontrarOuCriarCliente(tenantId, { telefone, nome }, tx) {
  const db = tx || prisma;
  const phone = requirePhone(telefone);
  const nomeLimpo = textOrEmpty(nome);
  const existente = await db.cliente.findUnique({ where: { tenantId_telefone: { tenantId, telefone: phone } } });
  if (existente) {
    // telefone existente com nome diferente: atualiza o nome
    if (nomeLimpo && nomeLimpo !== existente.nome) {
      return db.cliente.update({ where: { id: existente.id }, data: { nome: nomeLimpo } });
    }
    return existente;
  }
  if (!nomeLimpo) throw badRequest("Informe o nome do cliente.");
  return db.cliente.create({ data: { tenantId, telefone: phone, nome: nomeLimpo } });
}

module.exports = { encontrarOuCriarCliente };
