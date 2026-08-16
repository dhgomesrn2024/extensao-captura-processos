/**
 * Testes do parser do SEEU.
 *
 * O documento é montado à mão reproduzindo a estrutura observada na página
 * real: tabela #informacoesProcessuais com rótulo na 1ª célula e valor na 2ª,
 * e tabela de movimentações com cabeçalho Seq. | Data | Evento | ... .
 *
 * Rodar: node teste/seeu.teste.js
 */
require("../nucleo/util.js"); // define PjeExtUtil, usado pelo parser
const seeu = require("../adaptadores/seeu/parser.js");

let falhas = 0;
function conferir(descricao, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(
    `${ok ? "ok  " : "FALHA"} ${descricao}${ok ? "" : `\n      esperado: ${JSON.stringify(esperado)}\n      obtido:   ${JSON.stringify(obtido)}`}`
  );
}

/** Monta um documento mínimo com a mesma superfície que o parser usa. */
function documentoFalso({ capa = [], movimentos = null, semCapa = false } = {}) {
  const celula = (texto) => ({ textContent: texto });
  const linha = (celulas) => ({ cells: celulas.map(celula) });

  const tabelaCapa = { id: "informacoesProcessuais", rows: capa.map(linha) };

  const tabelas = semCapa ? [] : [tabelaCapa];

  if (movimentos) {
    tabelas.push({
      id: "movimentacoes",
      rows: [linha(["Seq.", "Data", "Evento", "Ações Auto.", "Movimentado Por"]), ...movimentos.map(linha)]
    });
  }

  return {
    querySelector: (sel) => (sel === "#informacoesProcessuais" && !semCapa ? tabelaCapa : null),
    querySelectorAll: () => tabelas
  };
}

const CONFIG = { oabNumero: "99999", oabUf: "RN" };
const URL = "https://seeu.pje.jus.br/seeu/processoDetalhe.do";

const CAPA_PADRAO = [
  ["Juízo:", "VARA DE EXECUÇÃO PENAL DA COMARCA DE NATAL"],
  ["Sentenciado:", "FULANO DE TAL EXEMPLO (CPF: 000.000.000-00)"],
  ["Nome da Mãe:", "MARIA EXEMPLO"],
  ["Advogados/Defensoria:", "ADV EXEMPLO - RN99999"],
  ["Status BNMP:", "Sem mandado ativo"],
  ["Classe Processual:", "Execução da Pena (Pena Privativa de Liberdade)"],
  ["Assunto Principal:", "Pena Privativa de Liberdade"],
  ["Nível de Sigilo:", "0 - Público"],
  ["Local de Prisão:", "PENITENCIÁRIA EXEMPLO"],
  ["Sumário da Pena:", "12 anos e 6 meses"],
  ["Situação Atual:", "EM EXECUÇÃO"],
  ["Início:", "01/02/2020"],
  ["Término:", "01/08/2032"],
  ["Progressão de Regime:", "15/03/2027"],
  ["Saída Temporária:", "20/12/2026"],
  ["Livramento Condicional:", "10/06/2028"]
];

const CONTEXTO = {
  numero_processo: "0000001-02.2002.8.20.0001",
  autoridade: "O ESTADO DO RIO GRANDE DO NORTE",
  executado: "FULANO DE TAL EXEMPLO",
  distribuicao: "20/02/2019",
  classe: "Execução da Pena",
  grau: "1"
};

console.log("\n— capa da execução penal —");
const doc = documentoFalso({
  capa: CAPA_PADRAO,
  movimentos: [
    ["102", "14/08/2026", "Juntada de Petição", "", "Advogado"],
    ["101", "02/07/2026", "Expedição de Guia", "", "Servidor"]
  ]
});
const r = seeu.parsearDetalhe(doc, CONFIG, URL, CONTEXTO);

conferir("número vem da listagem", r.numero_processo, "0000001-02.2002.8.20.0001");
conferir("fonte", r.fonte, "SEEU");
conferir("órgão julgador do Juízo", r.orgao_julgador, "VARA DE EXECUÇÃO PENAL DA COMARCA DE NATAL");
conferir("classe da capa", r.classe, "Execução da Pena (Pena Privativa de Liberdade)");
conferir("assunto", r.assunto, "Pena Privativa de Liberdade");
conferir("sigilo", r.segredo_justica, "0 - Público");
conferir("grau vem do contexto quando a URL não diz", r.grau, "1");
conferir("código do tribunal sai do número", r.tribunal_codigo, "8.20");

console.log("\n— contrato compartilhado com o PJe —");
conferir("polo ativo é a autoridade", r.polo_ativo.map((p) => p.papel), ["AUTORIDADE"]);
conferir("polo passivo é o executado", r.polo_passivo.map((p) => p.papel), ["EXECUTADO"]);
conferir("nome do executado sem o CPF", r.polo_passivo[0].nome, "FULANO DE TAL EXEMPLO");
conferir("CPF extraído para o campo próprio", r.polo_passivo[0].documento, { tipo: "CPF", valor: "000.000.000-00" });
conferir("executado é cliente", r.polo_passivo[0].is_cliente, true);
conferir("advogado com OAB estruturada", r.polo_passivo[0].advogados[0].oab.numero, "99999");
conferir("um cliente identificado", r.qtd_clientes, 1);
conferir("cliente nomeado", r.clientes[0].nome, "FULANO DE TAL EXEMPLO");

console.log("\n— bloco aditivo da execução penal —");
conferir("situação atual", r.execucao_penal.situacao_atual, "EM EXECUÇÃO");
conferir("início da pena", r.execucao_penal.pena_inicio, "01/02/2020");
conferir("término da pena", r.execucao_penal.pena_termino, "01/08/2032");
conferir("progressão de regime", r.execucao_penal.beneficios.progressao_regime, "15/03/2027");
conferir("saída temporária", r.execucao_penal.beneficios.saida_temporaria, "20/12/2026");
conferir("livramento condicional", r.execucao_penal.beneficios.livramento_condicional, "10/06/2028");
conferir("nome da mãe", r.execucao_penal.nome_da_mae, "MARIA EXEMPLO");

console.log("\n— movimentações —");
conferir("duas movimentações lidas", r.movimentos.length, 2);
conferir("primeira movimentação", r.movimentos[0], {
  sequencial: "102",
  data: "14/08/2026",
  evento: "Juntada de Petição",
  movimentado_por: "Advogado"
});
conferir("contagem no diagnóstico", r.diagnostico.qtd_movimentos, 2);

console.log("\n— advogados estruturados —");
const advs = seeu.listarAdvogados("FULANO DE TAL - RN00987 / ADV EXEMPLO - RN99999");
conferir("dois advogados separados por barra", advs.length, 2);
conferir("nome sem a OAB", advs[1].nome, "ADV EXEMPLO");
conferir("OAB com UF e número sem zeros", advs[1].oab, { uf: "RN", numero: "99999", sufixo: null, original: "RN99999" });
conferir("sufixo preservado", seeu.listarAdvogados("BELTRANO - SP123456A")[0].oab.sufixo, "A");
conferir("texto sem OAB não inventa", seeu.listarAdvogados("DEFENSORIA PUBLICA")[0].oab, null);

console.log("\n— OAB em formatos diferentes —");
const formatos = ["ADV EXEMPLO - RN99999", "ADV EXEMPLO 99999", "ADV EXEMPLO - 99999/RN", "ADV EXEMPLO (99999)"];
formatos.forEach((formato) => {
  const d = documentoFalso({ capa: CAPA_PADRAO.map((l) => (l[0] === "Advogados/Defensoria:" ? [l[0], formato] : l)) });
  const rr = seeu.parsearDetalhe(d, CONFIG, URL, CONTEXTO);
  conferir(`reconhece "${formato}"`, rr.polo_passivo[0].is_cliente, true);
});

const outraOab = documentoFalso({
  capa: CAPA_PADRAO.map((l) => (l[0] === "Advogados/Defensoria:" ? [l[0], "OUTRO ADVOGADO 99999"] : l))
});
conferir("não marca cliente com OAB alheia", seeu.parsearDetalhe(outraOab, CONFIG, URL, CONTEXTO).qtd_clientes, 0);

const zeros = documentoFalso({
  capa: CAPA_PADRAO.map((l) => (l[0] === "Advogados/Defensoria:" ? [l[0], "ADV EXEMPLO 099999"] : l))
});
conferir("ignora zeros à esquerda", seeu.parsearDetalhe(zeros, CONFIG, URL, CONTEXTO).qtd_clientes, 1);

console.log("\n— ausência declarada, nunca silenciosa —");
const semCapa = seeu.parsearDetalhe(documentoFalso({ semCapa: true }), CONFIG, URL, CONTEXTO);
conferir("sem capa cai para o contexto da listagem", semCapa.polo_passivo[0].nome, "FULANO DE TAL EXEMPLO");
conferir("capa ausente é registrada", semCapa.diagnostico.capa_encontrada, false);
conferir("e pede revisão manual", semCapa.diagnostico.revisar_manualmente, true);
conferir("sem movimentos não inventa", semCapa.movimentos, []);

try {
  seeu.parsearDetalhe(documentoFalso({ capa: CAPA_PADRAO }), CONFIG, URL, {});
  conferir("recusa registro sem número", "não lançou", "erro");
} catch (erro) {
  conferir("recusa registro sem número", /número do processo/i.test(erro.message), true);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} teste(s) falharam.\n`);
process.exit(falhas === 0 ? 0 : 1);
