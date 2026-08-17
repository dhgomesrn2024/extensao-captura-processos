/**
 * Parser do SEEU (execução penal).
 *
 * Escrito a partir da estrutura real observada no SEEU nacional acessado pelo
 * TJRN, não por suposição. O que foi conferido na página:
 *
 *   - a capa é a tabela #informacoesProcessuais, rótulo na 1ª célula e valor
 *     na 2ª — bem mais estável que o texto corrido do PJe
 *   - vocabulário: Juízo, Sentenciado, Advogados/Defensoria, Classe
 *     Processual, Assunto Principal, Nível de Sigilo, Situação Atual,
 *     Início, Término, Progressão de Regime, Saída Temporária,
 *     Livramento Condicional
 *   - as movimentações vêm na própria página, em tabela com cabeçalho
 *     Seq. | Data | Evento | Ações Auto. | Movimentado Por
 *
 * O domínio é outro: aqui não há polo ativo e passivo declarados na capa, e
 * sim um sentenciado. Os polos são montados a partir da listagem, que traz
 * Autoridade e Executado — assim o registro continua cabendo no mesmo
 * contrato do PJe, e o que é próprio da execução penal entra à parte, em
 * `execucao_penal`, sem alterar campo existente.
 */
(function (root) {
  /**
   * 1 - primeira versão: capa, partes a partir da listagem, benefícios e
   *     movimentações.
   * 2 - advogados estruturados (nome + OAB com UF), depois de conferir o
   *     formato real no acervo: "NOME - RN99999", vários separados por " / ".
   * 3 - remove o script embutido nas células. Sem isso, classe, assunto e
   *     sigilo vinham com 600 caracteres de JavaScript e com o token de
   *     sessão `_tj` junto, que ia parar no JSON exportado.
   */
  const VERSAO_PARSER = 3;

  /**
   * A página do SEEU exibe no máximo 500 movimentos. Ao bater exatamente
   * nesse número, o histórico está cortado — e isso precisa ser dito, não
   * suposto completo.
   */
  const LIMITE_MOVIMENTOS_NA_PAGINA = 500;

  const util = () =>
    typeof PjeExtUtil !== "undefined" ? PjeExtUtil : require("../../nucleo/util.js");

  const normalizar = (t) =>
    (t || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

  /**
   * Texto de uma célula, sem o script que o SEEU embute dentro dela.
   *
   * Várias células trazem um `AjaxJspTag.Callout` de ajuda, e `textContent`
   * inclui o código. Sem remover, "Execução da Pena" virava 600 caracteres de
   * JavaScript — e junto vinha o token de sessão `_tj`, que acabava dentro do
   * JSON exportado.
   */
  function textoDaCelula(celula) {
    if (!celula) return "";

    if (typeof celula.cloneNode === "function" && typeof celula.querySelectorAll === "function") {
      const copia = celula.cloneNode(true);
      copia.querySelectorAll("script, style").forEach((n) => n.remove());
      return limparRuido(copia.textContent);
    }

    return limparRuido(celula.textContent);
  }

  /**
   * Segunda barreira, no texto.
   *
   * Vale mesmo quando o script não veio como elemento: corta no início do
   * código e remove qualquer token de sessão que tenha sobrado. Token de
   * sessão não pode sair daqui em hipótese alguma.
   */
  function limparRuido(texto) {
    return normalizar(
      String(texto || "")
        .split(/\bnew\s+AjaxJspTag\b|\boverlib\b|\bfunction\s*\(/)[0]
        .replace(/[?&]_tj=[^"'\s&]*/gi, "")
    );
  }

  /** Lê a tabela de capa como pares rótulo → valor. */
  function lerCapa(doc) {
    const tabela = doc.querySelector("#informacoesProcessuais");
    if (!tabela) return null;

    const pares = new Map();
    for (const linha of Array.from(tabela.rows || [])) {
      const celulas = Array.from(linha.cells || []);
      if (celulas.length < 2) continue;

      const rotulo = textoDaCelula(celulas[0]).replace(/:$/, "").toLowerCase();
      if (!rotulo) continue;
      if (!pares.has(rotulo)) pares.set(rotulo, textoDaCelula(celulas[1]));
    }
    return pares;
  }

  const valor = (capa, rotulo) => {
    const v = capa ? capa.get(rotulo.toLowerCase()) : null;
    return v || null;
  };

  /**
   * Advogados de "Advogados/Defensoria".
   *
   * Formato conferido no acervo real: `NOME COMPLETO - RN99999`, e vários
   * separados por " / ". A OAB vem colada à UF, como no PJe.
   *
   * A extração da OAB é feita por grupos de dígitos, e não pelo separador:
   * assim continua funcionando se o formato variar entre tribunais.
   */
  function listarAdvogados(texto) {
    return String(texto || "")
      .split(" / ")
      .map((pedaco) => normalizar(pedaco))
      .filter(Boolean)
      .map((pedaco) => {
        const m = pedaco.match(/\b([A-Z]{2})\s*(\d{2,6})\s*([A-Z]?)\b/);
        const nome = normalizar(pedaco.replace(/\s*[-–]\s*[A-Z]{2}\s*\d{2,6}\s*[A-Z]?\s*$/, "")) || null;
        return {
          nome: nome || pedaco,
          oab: m
            ? { uf: m[1].toUpperCase(), numero: normalizarOab(m[2]), sufixo: m[3] || null, original: m[0] }
            : null
        };
      });
  }

  function numerosDeOab(texto) {
    return [...String(texto || "").matchAll(/\d{2,6}/g)]
      .map((m) => m[0].replace(/^0+/, ""))
      .filter(Boolean);
  }

  function normalizarOab(numero) {
    if (!numero) return null;
    const d = String(numero).replace(/\D/g, "").replace(/^0+/, "");
    return d || null;
  }

  function ehMeuAdvogado(textoAdvogados, config) {
    const alvo = normalizarOab(config && config.oabNumero);
    if (!alvo) return false;
    return numerosDeOab(textoAdvogados).includes(alvo);
  }

  /** Extrai CPF/CNPJ de um texto de parte, se houver. */
  function documentoDe(texto) {
    const m = String(texto || "").match(/\b(CPF|CNPJ)\s*:?\s*([\d.\-/]+)/i);
    if (m) return { tipo: m[1].toUpperCase(), valor: m[2] };
    const solto = String(texto || "").match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/);
    return solto ? { tipo: "CPF", valor: solto[0] } : null;
  }

  /** Nome sem o documento nem parênteses de complemento. */
  function nomeLimpo(texto) {
    return (
      normalizar(
        String(texto || "")
          .replace(/\b(CPF|CNPJ)\s*:?\s*[\d.\-/]+/gi, "")
          .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "")
          .replace(/\(\s*\)/g, "")
          .replace(/[-–]\s*$/, "")
      ) || null
    );
  }

  /** Movimentações: tabela cujo cabeçalho tem "Evento". */
  function lerMovimentos(doc) {
    const tabelas = Array.from(doc.querySelectorAll("table"));

    for (const tabela of tabelas) {
      const linhas = Array.from(tabela.rows || []);
      if (linhas.length < 2) continue;

      const cabecalho = Array.from(linhas[0].cells || []).map((c) => textoDaCelula(c).toLowerCase());
      const iData = cabecalho.findIndex((c) => c.startsWith("data"));
      const iEvento = cabecalho.findIndex((c) => c.startsWith("evento"));
      if (iData < 0 || iEvento < 0) continue;

      const iSeq = cabecalho.findIndex((c) => c.startsWith("seq"));
      const iPor = cabecalho.findIndex((c) => c.includes("movimentado"));

      const movimentos = [];
      for (const linha of linhas.slice(1)) {
        const celulas = Array.from(linha.cells || []);
        if (celulas.length <= iEvento) continue;

        const data = textoDaCelula(celulas[iData]);
        const evento = textoDaCelula(celulas[iEvento]);
        if (!data && !evento) continue;

        movimentos.push({
          sequencial: iSeq >= 0 ? textoDaCelula(celulas[iSeq]) || null : null,
          data: data || null,
          evento: evento || null,
          movimentado_por: iPor >= 0 ? textoDaCelula(celulas[iPor]) || null : null
        });
      }

      if (movimentos.length) return movimentos;
    }

    return [];
  }

  /**
   * Monta o registro.
   *
   * `contexto` traz o que veio da listagem (autoridade, executado), porque a
   * capa do SEEU não declara os dois polos.
   */
  function parsearDetalhe(doc, config, urlOrigem, contexto) {
    const ctx = contexto || {};
    const capa = lerCapa(doc);

    const numero = ctx.numero_processo || null;
    if (!numero) throw new Error("SEEU: número do processo não informado pela listagem.");

    const advogados = valor(capa, "Advogados/Defensoria");
    const sentenciado = valor(capa, "Sentenciado") || ctx.executado || null;
    const souAdvogado = ehMeuAdvogado(advogados, config);

    const listaAdvogados = listarAdvogados(advogados);

    const parteAtiva = ctx.autoridade
      ? [{ nome: normalizar(ctx.autoridade), papel: "AUTORIDADE", papel_incomum: false, documento: null, advogados: [], is_cliente: false }]
      : [];

    const partePassiva = sentenciado
      ? [
          {
            nome: nomeLimpo(sentenciado),
            papel: "EXECUTADO",
            papel_incomum: false,
            documento: documentoDe(sentenciado),
            advogados: listaAdvogados,
            is_cliente: souAdvogado
          }
        ]
      : [];

    const clientes = partePassiva
      .filter((p) => p.is_cliente)
      .map((p) => ({ nome: p.nome, papel: p.papel, polo: "passivo" }));

    const origem = util().origemPelaUrl(urlOrigem || "");
    const movimentos = lerMovimentos(doc);

    // Mesmo princípio do PJe: ausência declarada, nunca silenciosa.
    const statusPassivo = partePassiva.length ? "ok" : capa ? "sem_partes_cadastradas" : "nao_interpretado";
    const statusAtivo = parteAtiva.length ? "ok" : "sem_partes_cadastradas";

    return {
      numero_processo: numero,
      classe: valor(capa, "Classe Processual") || ctx.classe || null,
      classe_codigo: null,
      assunto: valor(capa, "Assunto Principal") || null,
      assunto_codigo: null,
      jurisdicao: null,
      orgao_julgador: valor(capa, "Juízo"),
      competencia: null,
      cargo_judicial: null,
      autuacao: ctx.distribuicao || null,
      ultima_distribuicao: ctx.distribuicao || null,
      valor_causa: null,
      segredo_justica: valor(capa, "Nível de Sigilo"),
      justica_gratuita: null,
      tutela_liminar: null,
      prioridade: null,

      polo_ativo: parteAtiva,
      polo_passivo: partePassiva,
      clientes,
      qtd_clientes: clientes.length,

      // Bloco aditivo: quem consome o padrão do PJe simplesmente ignora.
      execucao_penal: {
        sentenciado: nomeLimpo(sentenciado),
        nome_da_mae: valor(capa, "Nome da Mãe"),
        advogados_defensoria: advogados,
        status_bnmp: valor(capa, "Status BNMP"),
        local_prisao: valor(capa, "Local de Prisão"),
        ultimo_local_prisao_sisdepen: valor(capa, "Último Local Prisão SISDEPEN"),
        sumario_pena: valor(capa, "Sumário da Pena"),
        situacao_atual: valor(capa, "Situação Atual"),
        pena_inicio: valor(capa, "Início"),
        pena_termino: valor(capa, "Término"),
        beneficios: {
          progressao_regime: valor(capa, "Progressão de Regime"),
          saida_temporaria: valor(capa, "Saída Temporária"),
          livramento_condicional: valor(capa, "Livramento Condicional")
        }
      },

      movimentos,

      diagnostico: {
        polo_ativo: { status: statusAtivo, linhas_analisadas: parteAtiva.length },
        polo_passivo: { status: statusPassivo, linhas_analisadas: partePassiva.length },
        papeis_incomuns: [],
        capa_encontrada: !!capa,
        qtd_movimentos: movimentos.length,
        movimentos_truncados: movimentos.length >= LIMITE_MOVIMENTOS_NA_PAGINA,
        revisar_manualmente: !capa || statusPassivo !== "ok"
      },

      fonte: "SEEU",
      tribunal: origem.tribunal,
      tribunal_codigo: util().codigoTribunalDoNumero(numero),
      grau: origem.grau || ctx.grau || null,
      parser_versao: VERSAO_PARSER,
      extraido_em: new Date().toISOString()
    };
  }

  const api = {
    VERSAO_PARSER,
    lerCapa,
    lerMovimentos,
    listarAdvogados,
    limparRuido,
    LIMITE_MOVIMENTOS_NA_PAGINA,
    numerosDeOab,
    ehMeuAdvogado,
    nomeLimpo,
    documentoDe,
    parsearDetalhe
  };

  root.SeeuParser = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
