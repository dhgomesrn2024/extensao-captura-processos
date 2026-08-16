/**
 * Testes do parser contra amostras com a estrutura real do PJe/TJRN.
 * Rodar: node teste/parser.teste.js
 */
const fs = require("fs");
const path = require("path");
require("../nucleo/util.js"); // define PjeExtUtil, usado pelo parser
const core = require("../adaptadores/pje/parser.js");

const CONFIG = { oabNumero: "99999", oabUf: "RN" };
let falhas = 0;

function conferir(descricao, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHA"} ${descricao}${ok ? "" : `\n      esperado: ${JSON.stringify(esperado)}\n      obtido:   ${JSON.stringify(obtido)}`}`);
}

function carregar(nomeArquivo) {
  const texto = fs.readFileSync(path.join(__dirname, "..", "samples", nomeArquivo), "utf8");
  const doc = { body: { textContent: texto } };
  const url = "https://pje1g.tjrn.jus.br/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam?id=1234567";
  return core.parsearDetalhe(doc, CONFIG, url);
}

console.log("\n— processo cível, advogado no polo ativo —");
const civel = carregar("detalhe-pje-real.txt");
conferir("número do processo", civel.numero_processo, "0000004-05.2020.8.20.0001");
conferir("classe sem o código", civel.classe, "PROCEDIMENTO COMUM CÍVEL");
conferir("código da classe", civel.classe_codigo, "7");
conferir("assunto", civel.assunto, "Adjudicação Compulsória");
conferir("órgão julgador", civel.orgao_julgador, "Vara Única da Comarca de Angicos");
conferir("valor da causa", civel.valor_causa, "R$ 12.000,00");
conferir("tribunal pela URL", civel.tribunal, "TJRN");
conferir("grau pela URL", civel.grau, "1");
conferir("uma parte no polo ativo", civel.polo_ativo.length, 1);
conferir("três advogados na parte ativa", civel.polo_ativo[0].advogados.length, 3);
conferir("OAB sem zeros à esquerda", civel.polo_ativo[0].advogados[1].oab.numero, "99999");
conferir("parte ativa é cliente", civel.polo_ativo[0].is_cliente, true);
conferir("parte passiva não é cliente", civel.polo_passivo[0].is_cliente, false);
conferir("polo passivo para antes da tabela", civel.polo_passivo.length, 1);
conferir("um cliente identificado", civel.clientes.map((c) => c.nome), ["FULANO DE TAL COSTA"]);

console.log("\n— ação penal com três réus, advogado do segundo —");
const criminal = carregar("detalhe-criminal-multirreu.txt");
conferir("classe", criminal.classe, "AÇÃO PENAL - PROCEDIMENTO ORDINÁRIO");
conferir("assunto", criminal.assunto, "Roubo");
conferir("autor é o MP", criminal.polo_ativo.map((p) => p.papel), ["AUTOR"]);
conferir("MP identificado por CNPJ", criminal.polo_ativo[0].documento.tipo, "CNPJ");
conferir("três réus no polo passivo", criminal.polo_passivo.length, 3);
conferir("advogado do 1º réu não é o configurado", criminal.polo_passivo[0].is_cliente, false);
conferir("2º réu é o cliente", criminal.polo_passivo[1].is_cliente, true);
conferir("3º réu, sem advogado, não é cliente", criminal.polo_passivo[2].is_cliente, false);
conferir("3º réu não tem advogado atribuído", criminal.polo_passivo[2].advogados.length, 0);
conferir("apenas um cliente entre os três réus", criminal.clientes.length, 1);
conferir("cliente é o 2º réu", criminal.clientes[0].nome, "REU SEGUNDO EXEMPLO");

console.log("\n— parte institucional em várias linhas, com parênteses aninhados —");
const mp = carregar("detalhe-mp-multilinha.txt");
conferir("polo ativo não fica vazio", mp.polo_ativo.length > 0, true);
conferir("papel do polo ativo", mp.polo_ativo.map((p) => p.papel), ["AUTOR"]);
conferir("parênteses aninhados não viram parte", mp.polo_ativo.length, 1);
conferir("réu capturado no polo passivo", mp.polo_passivo[0].papel, "REU");
conferir("réu é o cliente", mp.polo_passivo[0].is_cliente, true);
conferir("unidade em caixa mista não vira papel", mp.polo_passivo.map((p) => p.papel), ["REU"]);

console.log("\n— polo sem parte cadastrada (alvará) —");
const alvara = carregar("detalhe-polo-vazio.txt");
conferir("polo ativo lido", alvara.polo_ativo.length, 1);
conferir("polo passivo continua vazio", alvara.polo_passivo.length, 0);
conferir("vazio é declarado, não silencioso", alvara.diagnostico.polo_passivo.status, "sem_partes_cadastradas");
conferir("polo ativo marcado como ok", alvara.diagnostico.polo_ativo.status, "ok");
conferir("não pede revisão manual", alvara.diagnostico.revisar_manualmente, false);

console.log("\n— advogado de mais de um réu no mesmo processo —");
const multi = carregar("detalhe-multicliente.txt");
const reus = multi.polo_passivo.filter((p) => p.papel === "REU");
conferir("três réus", reus.length, 3);
conferir("1º réu é cliente", reus[0].is_cliente, true);
conferir("2º réu não é cliente", reus[1].is_cliente, false);
conferir("3º réu é cliente", reus[2].is_cliente, true);
conferir("dois clientes contados", multi.qtd_clientes, 2);
conferir("clientes nomeados", multi.clientes.map((c) => c.nome), ["PRIMEIRO REU", "TERCEIRO REU"]);
conferir("código de unidade entra sinalizado, não descartado", multi.polo_passivo.map((p) => p.papel), [
  "REU",
  "REU",
  "REU",
  "DEAM/ZLOS"
]);
conferir("só o código de unidade é marcado incomum", multi.polo_passivo.map((p) => p.papel_incomum), [
  false,
  false,
  false,
  true
]);
conferir("processo cai na revisão manual", multi.diagnostico.revisar_manualmente, true);

console.log("\n— bloco com conteúdo e nenhum papel declarado —");
const linhasSemPapel = [
  "Polo ativo",
  "ALGUMA COISA SEM PAPEL",
  "OUTRA LINHA QUALQUER",
  "MAIS UMA LINHA",
  "Polo passivo",
  "FULANO - CPF: 000.000.000-00 (REU)",
  "Expedientes"
];
const analise = core.analisarPolo(linhasSemPapel, "Polo ativo", CONFIG);
conferir("recupera a parte em vez de desistir", analise.status, "parte_sem_papel");
conferir("registra quantas linhas analisou", analise.linhas_analisadas, 3);
conferir("nome recuperado da primeira linha útil", analise.partes[0].nome, "ALGUMA COISA SEM PAPEL");

console.log("\n— papel incomum é sinalizado, nunca descartado —");
const linhasPapeis = [
  "Polo passivo",
  "ANA TEREZA DOS SANTOS - CPF: 000.000.000-00 (REPRESENTANTE/NOTICIANTE)",
  "ADV EXEMPLO - OAB RN0099999 - CPF: 111.111.111-11 (ADVOGADO)",
  "DELEGACIA ESPECIALIZADA (DEAM/ZLOS)",
  "Expedientes"
];
const comPapeis = core.analisarPolo(linhasPapeis, "Polo passivo", CONFIG);
conferir("parte real com barra é mantida", comPapeis.partes[0].papel, "REPRESENTANTE/NOTICIANTE");
conferir("e não é marcada como incomum", comPapeis.partes[0].papel_incomum, false);
conferir("cliente identificado nela", comPapeis.partes[0].is_cliente, true);
conferir("código de unidade é mantido, não descartado", comPapeis.partes.length, 2);
conferir("mas vem sinalizado como incomum", comPapeis.partes[1].papel_incomum, true);

const docPapeis = {
  body: {
    textContent: [
      "AcaoPenal 0000003-04.2016.8.20.0001",
      "Classe judicial",
      "APELAÇÃO CRIMINAL (417)",
      "Assunto",
      "Roubo (3419)",
      "Polo ativo",
      "FULANO - CPF: 000.000.000-00 (APELANTE)",
      "ADV EXEMPLO - OAB RN0099999 - CPF: 111.111.111-11 (ADVOGADO)",
      "Polo passivo",
      "DELEGACIA X (DEAM/ZN)",
      "Expedientes"
    ].join("\n")
  }
};
const comIncomum = core.parsearDetalhe(docPapeis, CONFIG, "https://pje2g.tjrn.jus.br/pje/x.seam?id=1");
conferir("grau do 2º grau pela URL", comIncomum.grau, "2");
conferir("papéis incomuns listados no diagnóstico", comIncomum.diagnostico.papeis_incomuns, ["DEAM/ZN"]);
conferir("processo entra para revisão manual", comIncomum.diagnostico.revisar_manualmente, true);

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} teste(s) falharam.\n`);
process.exit(falhas === 0 ? 0 : 1);
