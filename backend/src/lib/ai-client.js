// Cliente de IA no mesmo modelo do Gestor SMG varejo: OpenAI via LangChain com tool calling.
const { ChatOpenAI } = require("@langchain/openai");
const { DynamicStructuredTool } = require("@langchain/core/tools");
const { SystemMessage, HumanMessage, AIMessage, ToolMessage } = require("@langchain/core/messages");
const env = require("../config/env");
const { createAppError } = require("./errors");
const { log } = require("./helpers");

const MAX_STEPS = 8;

function normalizeContent(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("")
      .trim();
  }
  return String(content || "").trim();
}

/**
 * tools: [{ name, description, schema (zod object), handler(input) }]
 * history: [{ role: "user" | "assistant", content }]
 * shouldStop(): quando true apos uma tool, encerra o loop (ex.: escalonamento ja enviou a mensagem).
 */
async function gerarResposta({ systemPrompt, history = [], tools = [], shouldStop }) {
  if (!env.openaiApiKey) {
    throw createAppError("OPENAI_API_KEY nao configurada: o agente de IA esta indisponivel.", 503);
  }
  const model = new ChatOpenAI({
    apiKey: env.openaiApiKey,
    model: env.openaiModel,
    temperature: 0.2,
    configuration: { baseURL: env.openaiBaseUrl },
  });

  const usedTools = [];
  const lcTools = tools.map(
    (t) =>
      new DynamicStructuredTool({
        name: t.name,
        description: t.description,
        schema: t.schema,
        func: async (input) => {
          try {
            const result = await t.handler(input || {});
            usedTools.push({ name: t.name, input, ok: result?.ok !== false });
            return typeof result === "string" ? result : JSON.stringify(result);
          } catch (error) {
            usedTools.push({ name: t.name, input, ok: false, error: error.message });
            return JSON.stringify({ ok: false, error: error.message, detalhes: error.details || null });
          }
        },
      })
  );
  const toolMap = new Map(lcTools.map((t) => [t.name, t]));
  const runnable = lcTools.length ? model.bindTools(lcTools) : model;

  const messages = [
    new SystemMessage(systemPrompt),
    ...history.map((m) => (m.role === "assistant" ? new AIMessage(m.content) : new HumanMessage(m.content))),
  ];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const ai = await runnable.invoke(messages);
    messages.push(ai);
    const calls = ai.tool_calls || [];
    if (!calls.length) {
      return { text: normalizeContent(ai.content), usedTools };
    }
    for (const call of calls) {
      const tool = toolMap.get(call.name);
      const output = tool ? await tool.invoke(call.args) : JSON.stringify({ ok: false, error: `Ferramenta ${call.name} inexistente.` });
      messages.push(new ToolMessage({ content: String(output), tool_call_id: call.id }));
    }
    if (typeof shouldStop === "function" && shouldStop()) {
      return { text: "", usedTools, stopped: true };
    }
  }
  log("ai-client", "limite_iteracoes", { usedTools: usedTools.map((t) => t.name) });
  throw createAppError("O agente excedeu o limite de passos.", 502);
}

module.exports = { gerarResposta };
