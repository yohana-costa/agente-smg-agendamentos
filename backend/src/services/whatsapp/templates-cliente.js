// Templates de utilidade para as automacoes que vao para a cliente no WhatsApp oficial (Meta).
// Fora da janela de 24h a Meta aceita texto livre na hora e descarta depois (erro 131047):
// a mensagem aparecia no Atendimento sem ter chegado. Template aprovado chega.
const LEMBRETE = "smg_lembrete_horario";
const AVISO = "smg_aviso_agendamento";

const MODELOS_CLIENTE = [
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
    return { name: LEMBRETE, params: [cliente, vars.servicos || "atendimento", vars.profissional || "a equipe", vars.data, vars.hora, vars.estabelecimento].map(limpar) };
  }
  if (["CONFIRMACAO", "AVISO_REAGENDAMENTO", "AVISO_CANCELAMENTO", "LEMBRETE_PAGAMENTO"].includes(tipo)) {
    return { name: AVISO, params: [cliente, vars.estabelecimento, texto].map(limpar) };
  }
  return null;
}

// Texto que a cliente recebe, para registrar no Atendimento igual ao que chegou.
function textoDoTemplate(name, params) {
  const corpo = MODELOS_CLIENTE.find((m) => m.name === name)?.components.find((c) => c.type === "BODY")?.text || "";
  return corpo.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");
}

module.exports = { MODELOS_CLIENTE, templateDaAutomacao, textoDoTemplate };
