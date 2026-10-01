# Gestor SMG Agendamentos

SaaS multi-tenant para negócios com hora marcada (salões, barbearias, clínicas, estética, consultórios…).
Construído sobre a mesma base do **Gestor SMG varejo** (`smg-system`): Node 20 + Express + Prisma/PostgreSQL no backend,
React 19 + Vite + TypeScript com CSS próprio no frontend, agentes de IA com LangChain/OpenAI e WhatsApp via Uazapi ou Meta.

Especificações: [docs/escopo-sistema.md](docs/escopo-sistema.md), [docs/agentes-ia.md](docs/agentes-ia.md), [docs/site-e-portal.md](docs/site-e-portal.md).

## Estrutura

```
backend/
  prisma/schema.prisma        modelo de dados (multi-tenant por tenantId; dinheiro em centavos)
  prisma/seed.js              estabelecimento demo
  src/
    services/
      disponibilidade.service  motor de horários (jornada, pausas, folgas, bloqueios, dias fechados, Google, intervalos, grade)
      agendamento.service      ciclo de status, reserva de 15 min, iniciar/finalizar, cancelar/no-show, reagendar, duração real
      politica.service         regras de reembolso (dentro/fora do prazo, no-show, estabelecimento)
      pagamentos/              gateway SMG -> Mercado Pago (Pix, cartão, reembolso) com modo simulado
      bloqueio.service         bloqueios/fechamentos com decisão por agendamento afetado
      metricas.service         Desempenho, Financeiro, Visão Geral e segmentos de clientes
      automacao.service        mensagens automáticas (templates com {placeholders})
      scheduler.service        expiração de reservas, lembretes, pós-atendimento, retorno, retomada de pausas, sync Google
      whatsapp/                providers Uazapi e Meta (mesmos do SMG varejo)
      google-calendar.service  OAuth por profissional + sincronização de eventos
    agents/
      atendimento/             Agente de Atendimento (tools + prompt)
      gestao/                  Agente de Gestão (tools com permissão por número autorizado)
      orchestrator.js          webhook, roteamento por número, debounce, pausa/retorno, escalonamento, simulador
    routes/                    API REST (/api/*) — sistema, público (site), portal, checkout, webhooks
frontend/
  src/pages/sistema/           as 12 abas do sistema
  src/pages/publico/           Site (/s/:slug), Portal do cliente (/s/:slug/portal) e Checkout (/pagamento/:id)
  src/lib, src/components      cliente de API, roteador, auth, SSE, componentes de UI
```

## Rodando localmente

Pré-requisitos: Node 20 e PostgreSQL.

```bash
# backend
cd backend
cp .env.example .env          # ajuste DATABASE_URL
npm install
npx prisma db push
npm run seed                  # cria o "Studio Demo"
npm run dev                   # http://localhost:3355

# frontend
cd ../frontend
npm install
npm run dev                   # http://localhost:5176 (proxy /api -> 3355)
```

Logins do demo (senha `123456` em desenvolvimento; em produção o seed só roda com `SEED_SENHA` definida): `dono@demo.com`, `recepcao@demo.com`, `ana@demo.com` (profissional).
Site público: http://localhost:5176/s/demo · Portal: http://localhost:5176/s/demo/portal

Teste de fumaça (com a API rodando e o seed recém-criado): `npm run test:e2e` no backend.

### Docker

```bash
cp backend/.env.example backend/.env
docker compose up -d --build   # frontend em :8089, API em :3355
```

## Integrações

| Integração | Como configurar | Sem configuração |
|---|---|---|
| Mercado Pago | Botão **Conectar Mercado Pago** em Configurações > Pagamentos (OAuth, mesmo app do Gestor SMG varejo): `MP_CLIENT_ID`, `MP_CLIENT_SECRET` e o redirect `{PUBLIC_API_URL}/api/integracoes/mercadopago/callback` cadastrado no app. Comissão da SMG: `MP_TAXA_PLATAFORMA_PCT` | Produção: pagamento online indisponível até conectar. Desenvolvimento: modo **simulado** (botões "Simular pagamento"); `PAGAMENTO_SIMULADO` força ligado/desligado |
| WhatsApp | Aba Agentes de IA > Conexão (Uazapi: baseUrl + instanceToken; Meta: accessToken + phoneNumberId, App Secret opcional). Webhook: a URL mostrada na tela, **com o `?token=` no final** (sem ele o webhook recusa) | Mensagens ficam registradas nas conversas, sem envio. `WHATSAPP_DRY_RUN=true` força isso. Áudios recebidos são transcritos (`OPENAI_TRANSCRIBE_MODEL`) |
| IA (agentes) | `OPENAI_API_KEY` (modelo padrão `gpt-4o-mini`, igual ao SMG varejo) | Agentes indisponíveis (aviso na aba Agentes de IA) |
| Google Calendar | `GOOGLE_CLIENT_ID/SECRET`, redirect `{PUBLIC_API_URL}/api/integracoes/google/callback` | Integração oculta |

## Decisões de implementação

- **Um número de WhatsApp por estabelecimento**: mensagens de números autorizados vão para o Agente de Gestão; as demais, para o Agente de Atendimento.
- **Pausa do agente**: ao escalar, quando um humano responde pelo sistema ou direto no WhatsApp (detectado pelo eco `fromMe`). Retorno automático após o tempo configurado.
- **Duração**: o agendamento ocupa a soma de (duração + intervalo) de todos os serviços; a faixa hachurada é o intervalo após o último serviço.
- **Duração real**: entra na média só quando Iniciar foi clicado e Finalizar ocorreu antes de virar Pendente de finalização. Com vários serviços, o tempo real é distribuído proporcionalmente.
- **Reembolso integral x taxa do gateway (ponto 17 do escopo)**: virou configuração em Configurações > Políticas. Padrão: estabelecimento absorve a taxa.
- **Pagamento após expiração**: se o Pix chegar depois dos 15 min, o agendamento é reativado se o horário continuar livre; senão o valor é devolvido integralmente.
- **Código do portal**: enviado por WhatsApp. Envio por SMS não implementado (exige provedor de SMS).
- Fora da v1 (conforme escopo): agendamento recorrente e entrega de produtos.
