// Checkout SMG: pagina publica de pagamento (/pagamento/:id no frontend).
const express = require("express");
const prisma = require("../lib/prisma");
const gateway = require("../services/pagamentos/gateway");
const pagamentos = require("../services/pagamentos/pagamento.service");
const { badRequest } = require("../lib/errors");
const { asyncHandler, ok } = require("../lib/helpers");
const { zonedParts } = require("../lib/time");

const router = express.Router();

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const p = await pagamentos.carregar(req.params.id);
    const t = p.tenant;
    const expiraEm = p.agendamento?.expiraEm || p.venda?.expiraEm || null;
    const ag = p.agendamento;
    return ok(res, {
      id: p.id,
      status: p.status,
      valor: p.valorBruto,
      forma: p.forma,
      modoGateway: gateway.modo(t),
      expiraEm,
      segundosRestantes: expiraEm && p.status === "PENDENTE" ? Math.max(0, Math.floor((new Date(expiraEm) - Date.now()) / 1000)) : null,
      pix: p.pixCopiaCola ? { copiaCola: p.pixCopiaCola, qrCodeBase64: p.pixQrCode } : null,
      estabelecimento: { nome: t.nome, slug: t.slug, corPrimaria: t.siteCorPrimaria, logoUrl: t.siteLogoUrl, endereco: t.endereco },
      cliente: p.cliente ? { nome: p.cliente.nome.split(" ")[0] } : null,
      agendamento: ag
        ? {
            status: ag.status,
            data: zonedParts(ag.inicio, t.timezone).date,
            hora: zonedParts(ag.inicio, t.timezone).time,
            profissional: ag.profissional?.nome,
            servicos: ag.servicos.map((s) => ({ nome: s.nome, preco: s.preco })),
            produtos: ag.produtos.map((x) => ({ nome: x.nome, quantidade: x.quantidade, precoUnit: x.precoUnit })),
            desconto: ag.desconto,
          }
        : null,
      venda: p.venda ? { status: p.venda.status, itens: p.venda.itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, precoUnit: i.precoUnit })), retiradaNoLocal: true } : null,
    });
  })
);

function assertPendente(p) {
  if (p.status !== "PENDENTE") throw badRequest(p.status === "APROVADO" ? "Este pagamento já foi confirmado." : "Este pagamento não está mais disponível.");
  const expira = p.agendamento?.expiraEm || p.venda?.expiraEm;
  if (expira && new Date(expira) < new Date()) throw badRequest("O prazo para pagamento expirou e o horário foi liberado.");
}

router.post(
  "/:id/pix",
  asyncHandler(async (req, res) => {
    assertPendente(await pagamentos.carregar(req.params.id));
    const p = await pagamentos.gerarPix(req.params.id);
    return ok(res, { copiaCola: p.pixCopiaCola, qrCodeBase64: p.pixQrCode });
  })
);

router.post(
  "/:id/cartao",
  asyncHandler(async (req, res) => {
    assertPendente(await pagamentos.carregar(req.params.id));
    return ok(res, await pagamentos.iniciarCartao(req.params.id));
  })
);

// Somente em modo simulado (sem Mercado Pago configurado): aprova o pagamento para testes.
router.post(
  "/:id/simular",
  asyncHandler(async (req, res) => {
    const p = await pagamentos.carregar(req.params.id);
    if (gateway.modo(p.tenant) !== "simulado") throw badRequest("Simulacao disponivel apenas sem gateway configurado.");
    assertPendente(p);
    const forma = req.body?.forma === "CARTAO" ? "CARTAO" : "PIX";
    await pagamentos.aprovarPagamento(p.id, { forma });
    const atualizado = await prisma.pagamento.findUnique({ where: { id: p.id } });
    return ok(res, { status: atualizado.status });
  })
);

module.exports = router;
