# Gestor SMG Agendamentos — Site e Portal do Cliente

Sep 30, 2026 · @Matheus Ruffato

## 1. Visão do site

O site é a página pública do estabelecimento e o canal principal de agendamento. O Agente de Atendimento envia o link do site para o cliente agendar por lá.

- 100% integrado ao sistema. Tudo o que é alterado nas tabs Serviços e Produtos do sistema aparece automaticamente no site.
- Duas abas: Serviços e Produtos. A aba Produtos só aparece se o estabelecimento ativou Vender produtos no sistema.
- Visual, textos e link são configurados no sistema, em Configurações > Site.
- O desenvolvimento de um site mais trabalhado é um serviço à parte, contratado separadamente. Os fluxos descritos neste documento são os que o site precisa suportar.

## 2. Aba Serviços: agendamento

O cliente agenda sem precisar ter conta.

### 2.1 Fluxo

1. Escolher um ou vários serviços. Cada serviço mostra nome, descrição, preço e duração.
2. Escolher o profissional, entre os habilitados para todos os serviços escolhidos.
3. Escolher data e horário. Só aparecem horários livres onde cabem a duração total e os intervalos, em intervalos fixos configurados pelo estabelecimento (padrão de 1 hora).
4. Ver os produtos relacionados aos serviços escolhidos (order bump), com opção de adicionar ao pedido. Só aparece se Vender produtos estiver ativado.
5. Informar nome e telefone.
6. Ver o resumo: serviços, profissional, data, horário, produtos, valor total e a política de cancelamento e reembolso do estabelecimento.
7. Pagar online (Pix ou cartão).

### 2.2 Reserva do horário

- Ao concluir o passo 6, o horário fica reservado por 15 minutos com status Aguardando pagamento.
- A tela mostra o tempo restante.
- 5 minutos depois, se não houver pagamento, o cliente recebe um lembrete pelo WhatsApp.
- Aos 15 minutos sem pagamento, o agendamento é cancelado e o horário é liberado.

### 2.3 Após o pagamento

- Tela de confirmação com os dados do agendamento.
- Confirmação enviada pelo WhatsApp.
- Convite para criar conta no Portal do cliente.

### 2.4 Vínculo com o cadastro

- O agendamento é vinculado ao cliente pelo telefone. Se o telefone já existe na base, entra no mesmo cadastro; se não, cria um novo.
- Nenhum dado do cadastro existente é mostrado no site. O histórico só aparece dentro do Portal do cliente, após login.

## 3. Aba Produtos

Só aparece quando o estabelecimento ativou Vender produtos no sistema.

- Catálogo com nome, descrição e preço de venda de cada produto ativo.
- Produtos sem estoque não podem ser comprados.
- Compra com pagamento online (Pix ou cartão). A venda baixa o estoque automaticamente no sistema.
- Entrega: apenas retirada no local. A informação aparece de forma clara antes do pagamento.
- Após o pagamento, o cliente recebe a confirmação da compra pelo WhatsApp.

## 4. Portal do cliente

Área logada do cliente final. É o único lugar onde o cliente vê o próprio histórico.

### 4.1 Criação de conta

1. O cliente informa nome, telefone e senha.
2. Aviso na tela: usar o mesmo telefone usado nos agendamentos, para que o histórico seja encontrado.
3. O sistema envia um código de verificação por WhatsApp ou SMS para o telefone informado.
4. Com o código confirmado, a conta é criada e todos os agendamentos anteriores daquele telefone são vinculados automaticamente.
5. Se o nome informado for diferente do nome já cadastrado para aquele telefone, o nome é atualizado.

A vinculação é feita apenas pelo telefone verificado. O nome nunca é usado para encontrar cadastros.

### 4.2 Login

- Telefone e senha.
- Esqueci minha senha: novo código por WhatsApp ou SMS.

### 4.3 Áreas do portal

- Meus agendamentos: próximos agendamentos, com opção de reagendar ou cancelar. Antes de confirmar, a tela mostra qual regra de reembolso se aplica e o valor que será devolvido.
- Histórico: todos os atendimentos já realizados, com data, serviços, profissional e valor.
- Pontos e recompensas: saldo de pontos e recompensas disponíveis. Só aparece se o estabelecimento ativou a Fidelidade.
- Perfil: dados do cliente e alteração de senha.
- Botão Novo agendamento, que leva ao fluxo de agendamento do site.
