/**
 * Teste de carga: os arquivos carregam, na ordem em que são injetados, e o
 * adaptador se registra.
 *
 * Existe porque a ordem de injeção é onde uma refatoração quebra em silêncio —
 * um global renomeado só aparece quando a extensão roda no navegador de
 * verdade. Este teste pegou exatamente isso.
 *
 * Rodar: node teste/carga.teste.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.join(__dirname, "..");

// Mesma ordem de popup.js -> chrome.scripting.executeScript
const ORDEM = [
  "nucleo/logger.js",
  "nucleo/util.js",
  "nucleo/estado.js",
  "nucleo/adaptadores.js",
  "adaptadores/pje/parser.js",
  "adaptadores/pje/coletor.js"
];

const URL_PJE = "https://pje1g.tjrn.jus.br/pje/Painel/painel_usuario/advogado.seam";

function ambienteFalso() {
  const ctx = {
    document: {
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, remove() {} }),
      body: { appendChild() {} }
    },
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: { sendMessage() {} }
    },
    fetch: async () => ({
      ok: true,
      headers: { get: () => "text/html; charset=utf-8" },
      arrayBuffer: async () => new ArrayBuffer(0)
    }),
    DOMParser: function () {
      this.parseFromString = () => ({ body: { textContent: "" } });
    },
    console,
    setTimeout,
    TextDecoder,
    URL,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Error,
    Promise,
    Set,
    Map,
    require
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.location = { href: URL_PJE, origin: "https://pje1g.tjrn.jus.br", pathname: "/pje/Painel/painel_usuario/advogado.seam" };
  return vm.createContext(ctx);
}

let falhas = 0;
function conferir(descricao, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHA"} ${descricao}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`}`);
}

const ctx = ambienteFalso();

console.log("\n— carga na ordem de injeção —");
for (const arquivo of ORDEM) {
  try {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, arquivo), "utf8"), ctx, { filename: arquivo });
    console.log(`ok   ${arquivo}`);
  } catch (erro) {
    falhas += 1;
    console.log(`FALHA ${arquivo} — ${erro.message}`);
    break;
  }
}

console.log("\n— registro do adaptador —");
const pje = ctx.PjeExtAdaptadores && ctx.PjeExtAdaptadores.paraUrl(URL_PJE);
conferir("um adaptador registrado", (ctx.PjeExtAdaptadores.listar() || []).length, 1);
conferir("detecta o painel do PJe", pje && pje.id, "PJe");
conferir("não reivindica página alheia", !!ctx.PjeExtAdaptadores.paraUrl("https://example.com"), false);
conferir("expõe a versão do parser", pje && pje.parserVersao, ctx.PjeParser.VERSAO_PARSER);
conferir(
  "cumpre o contrato",
  pje && ["coletar", "buscarDetalhe", "parsear"].every((k) => typeof pje[k] === "function"),
  true
);

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} teste(s) falharam.\n`);
process.exit(falhas === 0 ? 0 : 1);
