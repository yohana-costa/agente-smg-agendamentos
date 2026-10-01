# Gestor SMG Agendamentos — Agentes de IA

Sep 30, 2026 · @Matheus Ruffato

## 1. Princípios comuns aos dois agentes

O produto inclui dois agentes de IA que operam pelo WhatsApp: o Agente de Atendimento, que fala com os clientes finais, e o Agente de Gestão, que fala com a equipe do estabelecimento.

- Os dois estão conectados diretamente à base de dados do sistema, no mesmo modelo do Gestor SMG varejo.
- O único contexto dos agentes é o que está no sistema: serviços, produtos, agenda, clientes e as configurações feitas pelo próprio estabelecimento (persona e informações do negócio).
- Os agentes nunca inventam informação. O que não está no sistema, eles não respondem.
- Tudo o que os agentes fazem fica registrado no sistema, seguindo as mesmas regras das telas: políticas de reembolso, jornada, bloqueios e horários oferecidos.
- A configuração dos dois fica na aba Agentes de IA do sistema.

## 2. Agente de Atendimento

Responsável apenas por agendamentos. Ele não vende: informa horários disponíveis, registra o agendamento no sistema e confirma o pagamento. É um agente propositalmente simples.

### 2.1 Identificação do cliente

- Ao receber uma mensagem, o agente procura o telefone na base de clientes.
- Se encontrar, usa o mesmo cadastro e registra tudo no histórico desse cliente. Nunca cria um cliente novo para um telefone que já existe.
- Se não encontrar, cria o cadastro com o telefone e o nome informado.

### 2.2 Prioridade: link do site

- Sempre que alguém quiser agendar, o agente envia primeiro o link do site para o cliente agendar por lá. O objetivo é reduzir o volume de mensagens.
- O agendamento feito pelo site já fica vinculado ao mesmo cliente pelo telefone.

### 2.3 Agendamento pelo WhatsApp

Se o cliente preferir agendar pela conversa:

1. Informa os serviços disponíveis e os profissionais habilitados. O cliente pode escolher vários serviços no mesmo agendamento.
2. Informa os dias e horários disponíveis. Considera a jornada de cada profissional, folgas, bloqueios, dias fechados, eventos do Google Calendar, a duração total dos serviços, o intervalo após o serviço e o intervalo de horários oferecidos configurado.
3. Registra o agendamento no sistema com status Aguardando pagamento.
4. Envia o link de pagamento.
5. 5 minutos depois, se o pagamento não foi feito, avisa que está pendente e que faltam 10 minutos para o cancelamento automático.
6. Aos 15 minutos sem pagamento, o agendamento é cancelado automaticamente e o horário é liberado.
7. Com o pagamento confirmado, atualiza o status para Confirmado e confirma ao cliente.

### 2.4 Reagendamento e cancelamento

- O agente pode reagendar e cancelar seguindo as políticas configuradas pelo estabelecimento.
- Antes de confirmar, informa ao cliente qual regra se aplica e o valor que será devolvido.
- Dentro do prazo, o reagendamento mantém o pagamento. Fora do prazo, aplica o reembolso configurado e o novo horário exige novo pagamento.

### 2.5 Escalonamento para humano

O agente escala sempre que:

- não tem a informação no sistema para responder; ou
- o assunto está fora do escopo de agendamento.

Nesses casos, ele não tenta resolver nem responde a dúvida. O fluxo é:

1. Envia ao cliente a mensagem de escalonamento configurada, informando que o atendimento está sendo encaminhado para uma pessoa qualificada.
2. Notifica pelo WhatsApp o número configurado para escalonamentos, informando qual cliente precisa de atenção.
3. Marca a conversa como escalonada na aba Atendimento.
4. Pausa naquela conversa.

### 2.6 Pausa e retorno

- O agente pausa naquela conversa quando escala, ou quando um humano manda mensagem para o cliente, mesmo sem escalonamento prévio.
- Ele volta a responder sozinho depois do tempo definido pelo estabelecimento (5, 10, 15, 20 minutos ou outro valor).
- O humano também pode devolver a conversa ao agente a qualquer momento pela aba Atendimento.

### 2.7 O que o estabelecimento configura

- Persona: nome, tom de voz e forma de se apresentar.
- Informações do negócio que o agente pode usar.
- Mensagem de escalonamento.
- Número que recebe as notificações de escalonamento.
- Tempo de retorno após a pausa.

## 3. Agente de Gestão

Funciona como um funcionário do estabelecimento dentro do WhatsApp, no mesmo modelo do agente de gestão do Gestor SMG varejo.

### 3.1 O que faz

- Tudo o que um usuário consegue fazer dentro do sistema, a pessoa pode pedir ao agente pela conversa.
- Preenche e atualiza dados no sistema a pedido da pessoa. Exemplos: criar ou remarcar um agendamento, bloquear um horário, registrar uma despesa, cadastrar um serviço.
- Consulta informações do sistema. Exemplos: agenda do dia, faturamento da semana, clientes com retorno atrasado.
- Gera relatórios a partir dos dados do sistema.

### 3.2 Quem pode usar

- Apenas números de WhatsApp autorizados na aba Agentes de IA.
- Cada número autorizado tem permissões definidas pelo dono: o que aquele número pode consultar e alterar pelo agente.
- Mensagens de números não autorizados não são atendidas por este agente.
