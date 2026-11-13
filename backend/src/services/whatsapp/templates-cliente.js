// Templates de utilidade para as automacoes que vao para a cliente no WhatsApp oficial (Meta).
// Fora da janela de 24h a Meta aceita texto livre na hora e descarta depois (erro 131047):
// a mensagem aparecia no Atendimento sem ter chegado. Template aprovado chega.
const LEMBRETE = "smg_lembrete_horario";
const AVISO = "smg_aviso_agendamento";
// Lembrete com botoes (pedido da Dra, 10/11/2026): a cliente toca em Confirmar ou Cancelar. O toque
// chega no webhook como texto do botao. Enquanto a Meta nao aprovar, o lembrete sai pelo LEMBRETE.
const LEMBRETE_CONFIRMAR = "smg_lembrete_confirmar";
// Mesmo lembrete com o ✅ e o ❌ no texto (pedido da Dra, 13/11/2026): emoji so cabe no corpo.
// Enquanto a Meta nao aprovar, sai o LEMBRETE_CONFIRMAR.
const LEMBRETE_CONFIRMAR_EMOJI = "smg_lembrete_confirmar_emoji";
const BOTAO_CONFIRMAR = "Confirmar"; // a Meta nao aceita emoji em botao
const BOTAO_CANCELAR = "Cancelar";

const MODELOS_CLIENTE = [
  {
    name: LEMBRETE_CONFIRMAR_EMOJI,
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Olá, {{1}}! Passando para lembrar do seu horário de {{2}} com {{3}} em {{4}} às {{5}}, no {{6}}. Você confirma a sua presença? ✅ Toque em Confirmar se você vem. ❌ Toque em Cancelar se não puder vir.",
        example: { body_text: [["Ana", "Escova lisa", "Bárbara", "06/11/2026", "14:00", "Studio Bella"]] },
      },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: BOTAO_CONFIRMAR }, { type: "QUICK_REPLY", text: BOTAO_CANCELAR }] },
    ],
  },
  {
    name: LEMBRETE_CONFIRMAR,
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Olá, {{1}}! Passando para lembrar do seu horário de {{2}} com {{3}} em {{4}} às {{5}}, no {{6}}. Você confirma a sua presença?",
        example: { body_text: [["Ana", "Escova lisa", "Bárbara", "06/11/2026", "14:00", "Studio Bella"]] },
      },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: BOTAO_CONFIRMAR }, { type: "QUICK_REPLY", text: BOTAO_CANCELAR }] },
    ],
  },
  {
    name: LEMBRETE,
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Olá, {{1}}! Passando para lembrar do seu horário de {{2}} com {{3}} em {{4}} às {{5}}, no {{6}}. Se precisar remarcar, é só responder esta mensagem.",
        example: { body_text: [["Ana", "Escova lisa", "Bárbara", "06/11/2026", "14:00", "Studio Bella"]] },
      },
    ],
  },
  {
    name: AVISO,
    language: "pt_BR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Olá, {{1}}! Atualização do seu agendamento no {{2}}: {{3}} Se tiver alguma dúvida, é só responder esta mensagem.",
        example: { body_text: [["Ana", "Studio Bella", "seu horário de Escova lisa foi remarcado para 07/11/2026 às 15:00 com Bárbara."]] },
      },
    ],
  },
];

// Mesma limpeza que sendMetaTemplate faz em cada variavel (a Meta recusa quebra de linha).
const limpar = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 900) || "-";

// Pos-atendimento e retorno ficam de fora: sao promocionais e a Meta nao aprova como utilidade.
function templateDaAutomacao(tipo, vars, texto) {
  const cliente = vars.cliente || "tudo bem";
  if (tipo === "LEMBRETE_ATENDIMENTO") {
    const params = [cliente, vars.servicos || "atendimento", vars.profissional || "a equipe", vars.data, vars.hora, vars.estabelecimento].map(limpar);
    return { name: LEMBRETE_CONFIRMAR_EMOJI, params, alternativas: [LEMBRETE_CONFIRMAR, LEMBRETE] };
  }
  if (["CONFIRMACAO", "AVISO_REAGENDAMENTO", "AVISO_CANCELAMENTO", "LEMBRETE_PAGAMENTO"].includes(tipo)) {
    return { name: AVISO, params: [cliente, vars.estabelecimento, texto].map(limpar) };
  }
  return null;
}

// Texto que a cliente recebe, para registrar no Atendimento igual ao que chegou.
function textoDoTemplate(name, params) {
  const modelo = MODELOS_CLIENTE.find((m) => m.name === name);
  const corpo = modelo?.components.find((c) => c.type === "BODY")?.text || "";
  const botoes = modelo?.components.find((c) => c.type === "BUTTONS")?.buttons || [];
  const texto = corpo.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");
  return botoes.length ? `${texto} [Botões: ${botoes.map((b) => b.text).join(" | ")}]` : texto;
}

module.exports = { MODELOS_CLIENTE, LEMBRETE_CONFIRMAR, BOTAO_CONFIRMAR, BOTAO_CANCELAR, templateDaAutomacao, textoDoTemplate };
