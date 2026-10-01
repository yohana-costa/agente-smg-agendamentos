// Verifica a sintaxe e o carregamento (require) de todos os modulos do backend sem precisar de banco.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..", "src");
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) files.push(full);
  }
})(root);

for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
// carrega a arvore de rotas inteira para pegar erros de require/exports
require(path.join(root, "app.js"));
console.log(`[check] ${files.length} arquivos OK`);
process.exit(0);
