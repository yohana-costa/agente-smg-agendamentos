# Gestor SMG Agendamentos — Escopo do Sistema

Sep 30, 2026 · @Matheus Ruffato

## 1. Visão do produto

O Gestor SMG Agendamentos é um SaaS multi-tenant, construído do zero, para qualquer negócio que vive de atendimento com hora marcada: salões, barbearias, clínicas, consultórios, estética, dentistas e similares.

Este documento descreve o front-end: o que existe em cada tela e como cada coisa funciona para o usuário. Lógica de back-end e cálculos por trás dos indicadores ficam a critério do desenvolvimento.

O produto é entregue em três partes, cada uma com seu documento:

- Sistema (este documento)
- Agentes de IA: Atendimento e Gestão, ambos via WhatsApp e conectados à base do sistema
- Site público e Portal do cliente

Princípios que valem para todas as telas:

- Tudo se resume a serviço. O sistema não usa nenhum termo de um segmento específico. Cada negócio cria seus próprios serviços, categorias e nomes.
- O dono configura, a SMG não customiza. Regras de reembolso, prazos, comissões, pontos, mensagens e persona do agente são configurações do próprio usuário.
- Sempre equipe. Mesmo quando o negócio tem uma única pessoa, ela se cadastra como profissional. Novos profissionais podem ser adicionados a qualquer momento.
- Pagamento antecipado. Agendamentos feitos pelo site ou pelo agente só são confirmados após o pagamento, para reduzir no-show.
- Pagamentos pelo gateway próprio da SMG, conectado ao Mercado Pago.

## 2. Perfis de acesso

São quatro perfis. Cada um tem login próprio.

- Dono: acesso total ao sistema. Pode também estar cadastrado como profissional.
- Recepção: toda a operação do dia a dia (Visão Geral sem financeiro, Agenda, Clientes, Atendimento e recebimentos do Financeiro). Não acessa Configurações nem o financeiro geral.
- Profissional: a própria agenda, os próprios clientes e o próprio desempenho. Não acessa configurações nem o financeiro geral. Se pode ver a agenda dos colegas (só leitura) é definido em permissões.
- Cliente final: acessa apenas o Portal do cliente, descrito no documento do Site.

Os limites exatos de cada perfil podem ser ajustados pelo dono em Configurações > Usuários e permissões.

## 3. Estrutura do sidebar

Ordem das abas:

1. Visão Geral
2. Agenda
3. Clientes
4. Serviços / Produtos
5. Equipe
6. Financeiro
7. Desempenho
8. Atendimento
9. Fidelidade
10. Agentes de IA
11. Automações
12. Configurações

Cada perfil vê apenas as abas liberadas para ele.

## 4. Regras gerais do sistema

Estas regras aparecem em várias abas, no site e nos agentes. Estão descritas aqui uma vez.

### 4.1 Identificação do cliente

- O cliente é identificado apenas pelo telefone. O nome não é usado para vincular cadastros, porque nomes se repetem.
- Todo agendamento feito pelo site, pelo agente ou manualmente procura o telefone na base. Se existir, vincula ao mesmo cliente. Se não existir, cria um cadastro novo.
- Nenhum dado de um cadastro existente é exibido para quem não está logado no Portal do cliente.
- Se o telefone já existe e o nome informado é diferente, o nome é atualizado.

### 4.2 Pagamento antecipado e reserva do horário

- Agendamentos feitos pelo site ou pelo agente entram com status Aguardando pagamento. O horário fica reservado por 15 minutos.
- 5 minutos após a criação, o cliente recebe pelo WhatsApp um lembrete de que o pagamento está pendente e de que faltam 10 minutos para o cancelamento automático.
- Aos 15 minutos sem pagamento, o agendamento é cancelado automaticamente e o horário volta a ficar disponível.
- Pagamento confirmado muda o status para Confirmado.

### 4.3 Formas de pagamento

- Online: pelo gateway da SMG (Pix e cartão), sempre pelo sistema.
- No local: apenas dinheiro ou maquininha de cartão. Disponível só em agendamentos e vendas criados manualmente pelo estabelecimento.
- Pix feito no local também passa pelo sistema: a recepção gera o QR code na tela.

### 4.4 Cancelamento, no-show e reembolso

Três regras, todas configuradas pelo dono em Configurações > Políticas:

1. Cancelamento dentro do prazo: reembolso integral. O dono define o prazo, em horas ou dias antes do horário. Exemplo: prazo de 3 horas em um agendamento às 13h significa cancelar até 9h59.
2. Cancelamento fora do prazo: reembolso do percentual escolhido pelo dono (de 0% a 100%).
3. No-show: reembolso do percentual escolhido pelo dono (de 0% a 100%). Cancelar depois do horário marcado conta como no-show.

Como o reembolso é aplicado:

- O percentual é calculado sobre o valor total que o cliente pagou.
- As taxas do gateway saem da parte que fica com o estabelecimento.
- O reembolso é executado automaticamente assim que o cancelamento ou o no-show é registrado.
- Antes de confirmar um cancelamento ou no-show, a tela sempre mostra qual regra se aplica e o valor exato que será devolvido.

### 4.5 Reagendamento

- O cliente pode reagendar a qualquer momento, pelo portal ou pelo agente.
- Dentro do prazo de cancelamento: o pagamento acompanha o novo horário.
- Fora do prazo: aplica-se a regra de cancelamento fora do prazo (reembolso do percentual configurado) e o novo horário exige um novo pagamento.
- Reagendamento feito pelo estabelecimento mantém o pagamento vinculado.
- O cliente é avisado automaticamente da nova data.

### 4.6 Ciclo de status do agendamento

1. Aguardando pagamento
2. Confirmado
3. Em atendimento (botão Iniciar)
4. Concluído (botão Finalizar)

Status de saída: Cancelado e No-show.

Status de alerta: Pendente de finalização. Aparece quando o atendimento passa do horário previsto de término mais a tolerância (padrão de 10 minutos, configurável) sem ser finalizado.

### 4.7 Duração dos serviços

- Ao cadastrar um serviço, o profissional informa a duração média. Ela é usada na agenda desde o primeiro dia.
- Os botões Iniciar e Finalizar registram a duração real de cada atendimento.
- A duração real só entra na média quando Iniciar e Finalizar foram clicados no momento certo. Atendimentos que viraram Pendente de finalização, ou que foram finalizados sem Iniciar, ficam fora da média.
- Quando existe média real, o sistema mostra a duração informada e a real lado a lado e sugere atualizar. A troca nunca é automática.

### 4.8 Intervalo após o serviço

- Cada serviço tem uma duração e um intervalo após o serviço (tempo de preparo, limpeza ou deslocamento). Os dois são definidos no cadastro do serviço.
- O agendamento ocupa duração + intervalo na agenda. Exemplo: serviço de 40 minutos com 10 de intervalo ocupa 50 minutos.
- Nenhum agendamento feito pelo site ou pelo agente pode começar dentro de um intervalo.
- Se o agendamento for reagendado ou cancelado, o intervalo acompanha.
- O intervalo conta como tempo ocupado na taxa de ocupação.

### 4.9 Vários serviços no mesmo agendamento

- Um agendamento pode ter quantos serviços o cliente quiser, em sequência, com o mesmo profissional.
- A duração total é a soma das durações e intervalos dos serviços escolhidos.
- O pagamento é único para o agendamento inteiro.

### 4.10 Horários oferecidos

- O site e o agente oferecem horários em intervalos fixos. Padrão de 1 hora, configurável pelo dono.
- Só aparecem horários em que cabem a duração total e o intervalo, dentro da jornada do profissional, sem bloqueios e sem eventos do Google Calendar.

## 5. Aba Visão Geral

Primeira tela após o login. Mostra o que precisa de ação agora e um resumo do período. A análise completa fica na aba Desempenho.

- Agenda do dia: próximos atendimentos com horário, cliente, serviço, profissional e status.
- Pendências, cada uma clicável e levando direto ao item:
  - agendamentos aguardando pagamento;
  - atendimentos pendentes de finalização;
  - escalonamentos do agente aguardando resposta humana.
- Resumo do período: faturamento e quantidade de atendimentos.
- Progresso da meta do mês, em serviços e em valor.
- Alertas: ocupação baixa, no-show em alta, produto com estoque baixo.

A recepção vê esta aba sem os números financeiros. O profissional vê apenas os próprios dados.

## 6. Aba Agenda

Tela central da operação. Mostra a capacidade de cada profissional e tudo o que ocupa essa capacidade.

### 6.1 Visualizações

- Dia: uma coluna por profissional, lado a lado. Visão padrão.
- Semana: um profissional por vez, ou todos sobrepostos por cor.
- Mês: quantidade de atendimentos por dia e dias fechados marcados.
- Lista: todos os agendamentos em linha, para tratar pendências.
- Filtros em todas as visões: profissional, serviço e status.
- Navegação: botão Hoje, setas de avançar e voltar, seletor de data.

### 6.2 O que aparece no calendário

- Bloco de agendamento: cliente, serviço(s), horário, cor por status e ícone da situação do pagamento (pago online, pagar no local, aguardando).
- Faixa de intervalo: logo após cada bloco, com visual diferente (hachurado).
- Bloqueios manuais: em cinza, com o motivo.
- Eventos do Google Calendar: em cinza, com ícone do Google. O próprio profissional vê o título do evento. Os demais perfis veem apenas Ocupado.
- Fora da jornada (antes da abertura, depois do fechamento, pausas fixas): área apagada e não clicável.
- Dia fechado: diferencia visualmente fechado da rotina e fechado fora da rotina.
- Aguardando pagamento: mostra contador do tempo restante da reserva.
- Cancelados: ocultos por padrão, com opção Mostrar cancelados.

### 6.3 Criar agendamento

Pelo botão Novo agendamento ou clicando em um horário vago (horário e profissional já vêm preenchidos).

1. Cliente: busca por telefone ou nome. Se não existir, cadastro rápido na mesma tela (nome e telefone).
2. Serviços: um ou vários. A tela mostra a duração total e os intervalos.
3. Profissional: só aparecem os habilitados para todos os serviços escolhidos.
4. Data e horário: só aparecem horários livres onde cabe a duração total.
5. Produtos relacionados aos serviços: aparecem como sugestão opcional.
6. Pagamento, em três opções:
   - Enviar link: o cliente recebe pelo WhatsApp e o agendamento entra como Aguardando pagamento.
   - Pix agora: gera o QR code na tela.
   - Pagar no local: dinheiro ou maquininha.
7. Observações: campo livre.

Encaixe: a recepção pode forçar um horário que conflita com outro agendamento ou com um intervalo. O sistema avisa do conflito e pede confirmação. O site e o agente nunca fazem encaixe.

### 6.4 Painel do agendamento

Abre ao clicar em um bloco. Mostra os dados do agendamento, o pagamento e um resumo do cliente (último atendimento, total de visitas, no-shows anteriores, observações).

Botões por status:

- Aguardando pagamento: Reenviar link, Registrar pagamento no local, Cancelar.
- Confirmado: Iniciar, Reagendar, Cancelar, No-show.
- Em atendimento: Finalizar, Adicionar produto.
- Pendente de finalização: Finalizar.
- Concluído, Cancelado e No-show: só consulta.

### 6.5 Finalizar atendimento

- Confirma os serviços realizados.
- Permite adicionar produtos vendidos na hora.
- Se o pagamento era no local, registra a forma (dinheiro ou maquininha).
- Mostra o retorno sugerido para o cliente, com base no retorno recomendado do serviço. O profissional pode aceitar, alterar a data, agendar o próximo na hora ou deixar sem previsão.
- É possível finalizar sem ter clicado em Iniciar.

### 6.6 Cancelar e no-show

- Antes de confirmar, a tela mostra qual regra se aplica e o valor exato que será devolvido.
- Após a confirmação, o reembolso é automático e o horário é liberado.

### 6.7 Reagendar

- Arrastando o bloco para outro horário ou pelo botão Reagendar.
- Só aceita horários em que cabem a duração total e o intervalo.
- O pagamento continua vinculado e o cliente é avisado automaticamente.

### 6.8 Bloqueios e fechamentos

- Bloquear horário: profissional, período, motivo, pontual ou repetido toda semana.
- Fechar dia: em um dia de funcionamento normal, entra como fechado fora da rotina e aparece no indicador de capacidade perdida. Os dias fechados da rotina são definidos em Configurações e não contam como perda.
- Conflito: se o período bloqueado já tiver agendamentos, o sistema lista os afetados e pede uma decisão para cada um (reagendar ou cancelar com reembolso integral). Os clientes são avisados automaticamente.

### 6.9 Visibilidade e atualização

- Dono e recepção veem e editam a agenda de todos.
- O profissional opera a própria agenda. Ver a dos colegas em modo leitura é configurável.
- Agendamentos feitos pelo site e pelo agente aparecem na agenda na hora, sem recarregar a página.

## 7. Aba Clientes

Base única de clientes do estabelecimento, alimentada pelo site, pelos agentes e pelos cadastros manuais.

### 7.1 Lista

- Busca por nome ou telefone.
- Segmentos, calculados a partir do retorno recomendado de cada serviço:
  - Ativos
  - Retorno próximo
  - Retorno atrasado
  - Inativos
- Botão para cadastrar cliente manualmente (nome e telefone).

### 7.2 Ficha do cliente

- Dados cadastrais.
- Histórico de atendimentos: data, serviços, profissional, valor e status.
- Total gasto e frequência de visitas.
- Último atendimento e próximo retorno sugerido.
- Quantidade de no-shows e de cancelamentos.
- Saldo e extrato de pontos (quando Fidelidade estiver ativa).
- Observações.
- Atalho para criar um agendamento para esse cliente.

### 7.3 Mesclar cadastros duplicados

- Permite unir dois cadastros da mesma pessoa (por exemplo, quando ela usou outro número em algum momento).
- O usuário escolhe qual telefone e quais dados ficam. O histórico dos dois cadastros é unido.

### 7.4 Visibilidade

Dono e recepção veem todos os clientes. O profissional vê apenas os clientes que atendeu ou que têm agendamento com ele.

## 8. Aba Serviços / Produtos

Uma única aba com duas tabs internas: Serviços e Produtos. Tudo o que é alterado aqui é atualizado automaticamente no site.

### 8.1 Tab Serviços

Catálogo livre. Cada negócio cria os próprios serviços e categorias, com os nomes do seu segmento.

Campos de cada serviço:

- Nome e categoria.
- Descrição (aparece no site).
- Preço.
- Duração média, informada pelo profissional no cadastro.
- Intervalo após o serviço.
- Profissionais habilitados a realizar o serviço.
- Retorno recomendado, em dias (opcional). Usado para sugerir o próximo retorno e para os segmentos de clientes.
- Produtos relacionados (order bump): produtos escolhidos pelo profissional para serem sugeridos junto com o serviço no agendamento.
- Ativo ou inativo. Serviço inativo não aparece no site nem para o agente.

Na listagem de serviços, cada um mostra a duração informada e a duração real média, com a opção de atualizar a duração informada.

### 8.2 Tab Produtos

No topo da tab existe a chave Vender produtos (ativado ou desativado). Desativado, a aba de produtos some do site e os produtos não aparecem como sugestão nos agendamentos.

Campos de cada produto:

- Nome e descrição.
- Quantidade em estoque.
- Custo.
- Preço de venda.
- Quantidade mínima para alerta de estoque baixo.
- Ativo ou inativo.

Estoque:

- Toda venda pelo site baixa o estoque automaticamente.
- Botão Registrar venda para vendas feitas no balcão, com pagamento no local (dinheiro ou maquininha) ou Pix pelo sistema. Também baixa o estoque.
- Ajuste manual da quantidade (entrada de mercadoria ou correção).

Vendas:

- Lista de vendas de produtos, com origem (site ou balcão).
- Produtos comprados pelo site são apenas para retirada no local. Cada venda do site tem a marcação Retirado, para a recepção registrar a entrega.

## 9. Aba Equipe

Cadastro, configuração e resultados de cada profissional. Se o negócio tem um único profissional (inclusive o próprio dono), a aba mostra só ele.

### 9.1 Lista de profissionais

- Todos os profissionais com status (ativo ou inativo) e indicadores resumidos do mês.
- Botão Adicionar profissional, que envia o convite de acesso com login próprio.

### 9.2 Cadastro do profissional

- Dados básicos.
- Serviços que ele realiza.
- Jornada semanal: dias de trabalho, horários e pausas fixas.
- Folgas e ausências programadas.
- Google Calendar: status da conexão. Cada profissional conecta o próprio Google pelo seu login.
- Remuneração, definida pelo dono:
  - comissão em percentual sobre os serviços realizados (o dono define o percentual); ou
  - valor fixo (o dono define o valor).
- Meta individual do mês, em quantidade de serviços e em valor.

### 9.3 Resultados do profissional

Dentro da ficha de cada profissional, filtrável por período:

- Taxa de ocupação.
- Serviços realizados.
- Faturamento gerado.
- Comissão ou valor a receber no período.
- Progresso da meta individual.

## 10. Aba Financeiro

Tudo o que entrou, saiu e sobrou no período. Filtro de período no topo.

### 10.1 Recebimentos

- Lista de todos os recebimentos de serviços e de produtos.
- Para cada um: data, cliente, origem (site, agente, manual ou balcão), forma de pagamento (online, dinheiro ou maquininha), valor bruto, taxa do gateway e valor líquido.
- Registro manual de outros recebimentos.

### 10.2 Reembolsos

- Lista de reembolsos executados: data, cliente, agendamento, regra aplicada (cancelamento dentro do prazo, fora do prazo ou no-show) e valor devolvido.

### 10.3 Despesas

- Cadastro de despesas com data, categoria, descrição e valor.
- Categorias criadas pelo próprio usuário.

### 10.4 Comissões

- Valor a pagar a cada profissional no período, conforme a remuneração configurada na aba Equipe.
- Marcação de comissão paga.

### 10.5 Resultado do período

- Faturamento, reembolsos, taxas, comissões, despesas e resultado final.
- Progresso da meta geral do mês em valor.

### 10.6 Visibilidade

A recepção acessa apenas Recebimentos. O profissional não acessa esta aba.

## 11. Aba Desempenho

Visão completa do desempenho do negócio. A Visão Geral traz só o resumo; aqui ficam todos os indicadores. Filtros no topo: período, profissional e serviço.

### 11.1 Capacidade e ocupação

- Taxa de ocupação: horas ocupadas em relação às horas disponíveis reais. Geral, por profissional, por dia da semana e por faixa de horário.
- Horas disponíveis reais consideram jornada, folgas, bloqueios e eventos do Google Calendar. Não há número de capacidade informado manualmente.
- Capacidade em serviços x meta x realizado. Exemplo de leitura: você comportava cerca de 180 serviços este mês, a meta era 150 e foram feitos 120.
- Horas perdidas com no-show: capacidade que estava vendida e virou ociosidade.
- Dias fechados fora da rotina e a capacidade perdida com eles, separados da ociosidade por falta de cliente.

### 11.2 Comparecimento

- Taxa de no-show.
- Taxa de cancelamento, separada da de no-show.
- Agendamentos que expiraram sem pagamento.

### 11.3 Clientes

- Recorrência: clientes que voltaram no período.
- Novos clientes x clientes recorrentes.
- Clientes com retorno atrasado e clientes inativos.

### 11.4 Serviços

- Serviços mais realizados.
- Serviços que mais faturam.
- Duração real x duração informada por serviço.

### 11.5 Produtos

Aparece só quando Vender produtos está ativado.

- Produtos mais vendidos.
- Faturamento com produtos.

### 11.6 Profissionais

- Ranking por serviços realizados, faturamento e ocupação.

### 11.7 Receita

- Faturamento e evolução mês a mês.
- Ticket médio.
- Origem dos agendamentos: site, agente de atendimento ou manual.
- Dias e horários mais procurados.

### 11.8 Visibilidade

O profissional vê apenas os próprios indicadores. A recepção não acessa esta aba.

## 12. Aba Atendimento

Central das conversas do Agente de Atendimento no WhatsApp. Serve para acompanhar o agente e para o humano assumir quando necessário.

### 12.1 Lista de conversas

- Cada conversa vinculada ao cliente pelo telefone.
- Status de cada conversa: agente ativo, pausado ou escalonado.
- Filtro Escalonamentos pendentes, com o motivo informado pelo agente.

### 12.2 Conversa aberta

- Histórico completo de mensagens.
- Atalho para a ficha do cliente e para os agendamentos dele.
- Botão Assumir conversa: pausa o agente e permite responder pelo sistema.
- Botão Devolver ao agente: reativa o agente na hora.
- Quando pausada, mostra quanto tempo falta para o agente voltar sozinho.

### 12.3 Pausa do agente

O agente pausa naquela conversa em dois casos:

1. Quando ele mesmo escala para um humano.
2. Quando um humano manda mensagem para o cliente, pelo sistema ou direto pelo WhatsApp, mesmo que o agente não tenha escalado.

Depois do tempo definido pelo dono na configuração do agente, ele volta a responder naquela conversa.

## 13. Aba Fidelidade

Módulo opcional. No topo existe a chave Programa de fidelidade (ativado ou desativado). Tudo é definido pelo próprio usuário.

- Regras de pontuação: o dono define como o cliente ganha pontos.
- Recompensas: o dono cria recompensas (serviço grátis ou serviço com desconto) e quantos pontos cada uma custa.
- Cupons de desconto: para todos os clientes ou para clientes específicos.
- Extrato de pontos por cliente: pontos ganhos, usados e saldo.

O cliente vê seus pontos e recompensas no Portal do cliente.

## 14. Aba Agentes de IA

Configuração dos dois agentes. O comportamento completo está no documento Agentes de IA.

### 14.1 Sub-aba Agente de Atendimento

- Número de WhatsApp conectado.
- Persona: nome, tom de voz e forma de se apresentar.
- Informações do negócio: texto livre com o que o agente pode usar para responder, além dos dados do sistema.
- Mensagem de escalonamento: o que o agente diz ao cliente quando encaminha para um humano.
- Número que recebe as notificações de escalonamento.
- Tempo de retorno após a pausa: quanto tempo o agente espera para voltar a responder numa conversa pausada (5, 10, 15, 20 minutos ou outro valor).

### 14.2 Sub-aba Agente de Gestão

- Números de WhatsApp autorizados a falar com o agente.
- O que cada número autorizado pode fazer no sistema pelo agente.

## 15. Aba Automações

Mensagens automáticas enviadas ao cliente pelo WhatsApp do estabelecimento. Cada automação tem chave liga/desliga, momento de disparo e texto editável.

- Lembrete de pagamento pendente (5 minutos após a criação do agendamento).
- Confirmação do agendamento após o pagamento.
- Lembrete antes do atendimento.
- Pós-atendimento.
- Aviso de retorno, com base no retorno recomendado do serviço.
- Aviso de reagendamento.
- Aviso de cancelamento.

## 16. Aba Configurações

Acesso exclusivo do dono.

- Empresa: dados do estabelecimento.
- Funcionamento: dias e horários da rotina e dias fechados da rotina (por exemplo, sábado e domingo).
- Políticas:
  - prazo de cancelamento com reembolso integral (em horas ou dias);
  - percentual de reembolso para cancelamento fora do prazo;
  - percentual de reembolso para no-show.
- Agenda:
  - tolerância para Pendente de finalização (padrão 10 minutos);
  - intervalo dos horários oferecidos no site e no agente (padrão 1 hora).
- Metas: meta geral do mês em quantidade de serviços e em valor.
- Pagamentos: conexão com o gateway da SMG.
- Site: visual, textos e link da página.
- Integrações: WhatsApp e Google Calendar.
- Usuários e permissões: criar usuários de recepção e ajustar o que cada perfil acessa.
- Plano: assinatura do estabelecimento com a SMG.

## 17. Pontos para o Iury revisar e itens fora da v1

### Iury revisar

- Reembolso integral dentro do prazo: a taxa do gateway já foi cobrada no pagamento. Verificar como o Mercado Pago e o gateway da SMG tratam a taxa em um reembolso total, e definir se o estabelecimento absorve a taxa ou se o cliente recebe o valor pago menos a taxa.

### Fora da v1

- Agendamento recorrente (ex.: procedimento mensal ou trimestral já marcado em sequência). Previsto para a v2.
- Entrega de produtos comprados pelo site. Na v1 é apenas retirada no local.
