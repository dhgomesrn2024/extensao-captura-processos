/**
 * Testes das garantias do export.
 *
 * Rodar: node teste/exportacao.teste.js
 */
const e = require("../nucleo/exportacao.js");

let falhas = 0;
function conferir(descricao, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(
    `${ok ? "ok  " : "FALHA"} ${descricao}${ok ? "" : `\n      esperado: ${JSON.stringify(esperado)}\n      obtido:   ${JSON.stringify(obtido)}`}`
  );
}

// Registro do PJe: nunca teve movimentações.
const DO_PJE = {
  numero_processo: "0000004-05.2020.8.20.0001",
  fonte: "PJe",
  classe: "PROCEDIMENTO COMUM CÍVEL",
  polo_ativo: [{ nome: "FULANO", advogados: [] }],
  polo_passivo: [],
  clientes: [{ nome: "FULANO" }]
};

// Registro do SEEU: tem histórico e bloco próprio.
const DO_SEEU = {
  numero_processo: "0000001-02.2002.8.20.0001",
  fonte: "SEEU",
  classe: "Execução da Pena",
  execucao_penal: { situacao_atual: "EM EXECUÇÃO" },
  movimentos: [
    { sequencial: "2", data: "14/08/2026", evento: "Juntada" },
    { sequencial: "1", data: "02/07/2026", evento: "Guia" }
  ]
};

console.log("\n— escolha de incluir ou não as movimentações —");
const comTudo = e.prepararProcessos([DO_PJE, DO_SEEU], true);
conferir("com movimentações, o histórico vem", comTudo[1].movimentos.length, 2);
conferir("e nada é marcado como omitido", comTudo[1].movimentos_omitidos, undefined);

const enxuto = e.prepararProcessos([DO_PJE, DO_SEEU], false);
conferir("sem movimentações, o histórico sai", enxuto[1].movimentos, undefined);
conferir("mas a omissão é declarada", enxuto[1].movimentos_omitidos, true);
conferir("e a quantidade é preservada", enxuto[1].qtd_movimentos, 2);
conferir("o resto do registro fica intacto", enxuto[1].execucao_penal, { situacao_atual: "EM EXECUÇÃO" });

console.log("\n— o PJe não é afetado —");
conferir("registro do PJe passa igual, com movimentações", comTudo[0], DO_PJE);
conferir("e igual também sem movimentações", enxuto[0], DO_PJE);
conferir("não ganha marca de omissão", enxuto[0].movimentos_omitidos, undefined);
conferir("não ganha contagem falsa", enxuto[0].qtd_movimentos, undefined);

console.log("\n— o original não é alterado —");
conferir("o registro do SEEU na memória continua com o histórico", DO_SEEU.movimentos.length, 2);

console.log("\n— contagem para informar a escolha —");
conferir("soma as movimentações do acervo", e.contarMovimentos([DO_PJE, DO_SEEU]), 2);
conferir("acervo só do PJe soma zero", e.contarMovimentos([DO_PJE]), 0);
conferir("lista vazia não quebra", e.contarMovimentos([]), 0);

console.log("\n— token de sessão nunca sai —");
const comToken = {
  numero_processo: "1",
  classe: "X",
  url: "/seeu/ajaxUtils.do?_tj=c31c048f2b62f2b2",
  movimentos: [{ evento: "Y", link: "/pje/x.seam;jsessionid=ABC?ca=token999" }],
  aninhado: { fundo: ["a?_tj=segredo", "limpo"] }
};
const limpo = e.prepararProcessos([comToken], true)[0];
conferir("token na raiz sai", /_tj/.test(JSON.stringify(limpo)), false);
conferir("token dentro de array aninhado sai", /segredo/.test(JSON.stringify(limpo)), false);
conferir("ca e jsessionid saem", /ca=token999|jsessionid/.test(JSON.stringify(limpo)), false);
conferir("o texto legítimo permanece", limpo.classe, "X");
conferir("também limpa quando as movimentações são omitidas", /_tj/.test(JSON.stringify(e.prepararProcessos([comToken], false))), false);

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} teste(s) falharam.\n`);
process.exit(falhas === 0 ? 0 : 1);
