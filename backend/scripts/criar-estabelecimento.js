// Cria um estabelecimento novo (com o usuario dono) pela linha de comando.
// Mesmo caminho da tela de cadastro: services/tenant.service -> criarEstabelecimento.
//
// Uso (dentro do container do backend):
//   NOME_ESTABELECIMENTO="Studio X" NOME_DONO="Fulano" EMAIL="fulano@x.com" \
//   SENHA="uma-senha-forte" TELEFONE="98999999999" npm run criar-estabelecimento
const { criarEstabelecimento } = require("../src/services/tenant.service");
const prisma = require("../src/lib/prisma");

async function main() {
  const dados = {
    nomeEstabelecimento: process.env.NOME_ESTABELECIMENTO,
    nome: process.env.NOME_DONO,
    email: process.env.EMAIL,
    senha: process.env.SENHA,
    telefone: process.env.TELEFONE,
  };
  const faltando = Object.entries({ NOME_ESTABELECIMENTO: dados.nomeEstabelecimento, NOME_DONO: dados.nome, EMAIL: dados.email, SENHA: dados.senha })
    .filter(([, v]) => !String(v || "").trim())
    .map(([k]) => k);
  if (faltando.length) throw new Error(`Informe: ${faltando.join(", ")}`);

  const tenant = await criarEstabelecimento(dados);
  console.log(`Estabelecimento criado: ${tenant.nome}`);
  console.log(`Login: ${String(dados.email).toLowerCase()} (senha a que voce informou)`);
  console.log(`Site: /s/${tenant.slug}`);
}

main()
  .catch((e) => {
    console.error("Erro:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
