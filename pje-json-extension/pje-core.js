/**
 * Núcleo de parsing do PJe.
 *
 * Escrito a partir da estrutura real observada no PJe 1º grau do TJRN
 * (página listProcessoCompletoAdvogado.seam), não de suposição:
 *
 *   "Classe judicial"        -> "PROCEDIMENTO COMUM CÍVEL (7)"
 *   "Assunto"                -> "Adjudicação Compulsória (10450)"
 *   "Órgão julgador"         -> "Vara Única da Comarca de Angicos"
 *   "Polo ativo"
 *      "FULANO DE TAL - CPF: 000.000.000-00 (AUTOR)"
 *      "BELTRANA - OAB RN0016581A - CPF: 000.000.000-00 (ADVOGADO)"
 *
 * Regra central: dentro de um polo, só valem as linhas que terminam com o
 * papel entre parênteses. O que vem depois disso é outra seção da página.
 */
(function (root) {
  /**
   * Muda sempre que o parser passa a extrair algo diferente. O migrador
   * reprocessa registros gravados com versão anterior, para que uma correção
   * não fique escondida atrás de dados antigos já salvos.
   *
   * 2 - delimita o polo pelo próximo cabeçalho de seção em vez de parar na
   *     primeira linha sem papel (antes truncava listas de partes) e passa a
   *     exigir papel em caixa alta.
   * 3 - registra o diagnóstico de cada polo, separando "não há parte
   *     cadastrada" de "não consegui interpretar".
   * 4 - marca papel fora da lista conhecida como `papel_incomum` em vez de
   *     descartar a linha. Descartar derrubava "REPRESENTANTE/NOTICIANTE",
   *     que é parte real, com CPF e advogado constituído.
   * 5 - recupera parte institucional listada sem papel (delegacia, MP) em vez
   *     de deixar o polo vazio, com guarda contra texto de placeholder e
   *     endereço.
   */
  const VERSAO_PARSER = 5;

  const REGEX_CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/;
  const REGEX_CNJ_GLOBAL = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;

  // Papéis que representam a própria parte (não seu advogado).
  const PAPEL_ADVOGADO = /^(ADVOGAD[OA]|PROCURADOR(A)?|DEFENSOR(A)?( P[UÚ]BLIC[OA])?)$/i;

  /**
   * Papéis processuais já observados no acervo (1º e 2º graus do TJRN).
   *
   * Serve só para sinalizar: um papel fora desta lista pode ser papel novo, ou
   * pode ser código de unidade que o PJe põe entre parênteses no fim do nome
   * ("DELEGACIA X (DEAM/ZLOS)"). A parte é mantida e marcada como incomum —
   * descartar sairia mais caro, porque perderia parte real em silêncio.
   */
  const PAPEIS_CONHECIDOS = new Set([
    "AUTOR", "AUTORA", "AUTORES", "AUTOR DO FATO", "REU", "RÉU", "REUS", "RÉUS",
    "REQUERENTE", "REQUERENTES", "REQUERIDO", "REQUERIDA", "REQUERIDOS",
    "ACUSADO", "ACUSADA", "INVESTIGADO", "INVESTIGADA", "FLAGRANTEADO", "FLAGRANTEADA",
    "VÍTIMA", "VITIMA", "PACIENTE", "AUTORIDADE", "CUSTOS LEGIS",
    "APELANTE", "APELADO", "APELADA", "AGRAVANTE", "AGRAVADO", "AGRAVADA",
    "RECORRENTE", "RECORRIDO", "RECORRIDA", "JUIZO RECORRENTE",
    "IMPETRANTE", "IMPETRADO", "IMPETRADA",
    "EXEQUENTE", "EXECUTADO", "EXECUTADA",
    "SUSCITANTE", "SUSCITADO", "TERCEIRO INTERESSADO",
    "REPRESENTANTE / ASSISTENTE PROCESSUAL", "REPRESENTANTE/NOTICIANTE",
    "NOTICIANTE", "NOTICIADO", "INTERESSADO", "INTERESSADA",
    "EMBARGANTE", "EMBARGADO", "IMPUGNANTE", "IMPUGNADO",
    "ASSISTENTE", "LITISCONSORTE", "PERITO", "TESTEMUNHA"
  ]);

  function normalizar(texto) {
    return (texto || "")
      .replace(/ /g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  /**
   * Converte um Document em linhas de texto.
   *
   * Usa body.textContent quebrado por newline: verificado contra a página real
   * do PJe, que emite cada rótulo e cada parte em sua própria linha no HTML.
   * Se isso render poucas linhas (layout diferente), cai para os nós de texto.
   */
  function linhasDoDocumento(doc) {
    const bruto = doc && doc.body ? doc.body.textContent || "" : "";
    let linhas = bruto
      .split("\n")
      .map(normalizar)
      .filter(Boolean);

    if (linhas.length < 20 && doc && doc.body && typeof doc.createTreeWalker === "function") {
      const porNo = [];
      const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
      let no;
      while ((no = walker.nextNode())) {
        const t = normalizar(no.nodeValue);
        if (t) porNo.push(t);
      }
      if (porNo.length > linhas.length) {
        linhas = porNo;
      }
    }

    return linhas;
  }

  /** Valor de um rótulo que fica sozinho numa linha, com o valor na linha seguinte. */
  function valorDoRotulo(linhas, rotulos) {
    const alvos = rotulos.map((r) => r.toLowerCase());

    for (let i = 0; i < linhas.length; i += 1) {
      const atual = linhas[i].toLowerCase().replace(/:$/, "");

      if (alvos.includes(atual)) {
        const proxima = linhas[i + 1];
        if (proxima && !alvos.includes(proxima.toLowerCase().replace(/:$/, ""))) {
          return proxima;
        }
      }

      for (const alvo of alvos) {
        if (atual.startsWith(`${alvo}:`)) {
          const valor = normalizar(linhas[i].slice(alvo.length + 1));
          if (valor) return valor;
        }
      }
    }

    return null;
  }

  /** Separa "PROCEDIMENTO COMUM CÍVEL (7)" em nome + código. */
  function separarCodigo(valor) {
    if (!valor) return { nome: null, codigo: null };
    const m = valor.match(/^(.*?)\s*\((\d+)\)\s*$/);
    return m ? { nome: normalizar(m[1]), codigo: m[2] } : { nome: valor, codigo: null };
  }

  function normalizarOab(numero) {
    if (!numero) return null;
    const digitos = String(numero).replace(/\D/g, "").replace(/^0+/, "");
    return digitos || null;
  }

  /**
   * Interpreta uma linha de parte. Retorna null se a linha não for uma parte
   * (é assim que sabemos onde o bloco do polo termina).
   */
  function parsearLinhaParte(linha) {
    const mPapel = linha.match(/\(([^()]{2,40})\)\s*$/);
    if (!mPapel) return null;

    const papel = normalizar(mPapel[1]);

    // Papel no PJe vem em caixa alta (AUTOR, REU, CUSTOS LEGIS,
    // "REPRESENTANTE / ASSISTENTE PROCESSUAL"). Caixa mista indica nome de
    // unidade entre parênteses — "(DEAM/Parnamirim)" — e não um papel.
    if (!/^[A-ZÀ-Ÿ][A-ZÀ-Ÿ0-9\s./-]*$/.test(papel)) return null;

    const resto = normalizar(linha.slice(0, mPapel.index));
    if (!resto) return null;

    // OAB no formato real do PJe: "OAB RN0016581A"
    const mOab = resto.match(/\bOAB\s*([A-Z]{2})\s*(\d+)\s*([A-Z]?)\b/i);
    const oab = mOab
      ? {
          uf: mOab[1].toUpperCase(),
          numero: normalizarOab(mOab[2]),
          sufixo: mOab[3] ? mOab[3].toUpperCase() : null,
          original: normalizar(mOab[0])
        }
      : null;

    const mDoc = resto.match(/\b(CPF|CNPJ)\s*:?\s*([\d.\-/]+)/i);
    const documento = mDoc ? { tipo: mDoc[1].toUpperCase(), valor: mDoc[2] } : null;

    const nome = normalizar(resto.split(/\s+-\s+/)[0]);

    return {
      nome: nome || null,
      papel,
      papel_incomum: !PAPEIS_CONHECIDOS.has(papel),
      eh_advogado: PAPEL_ADVOGADO.test(papel),
      oab,
      documento
    };
  }

  function mesmaOab(oab, config) {
    if (!oab || !config) return false;
    const numeroConfig = normalizarOab(config.oabNumero);
    if (!numeroConfig || !oab.numero) return false;
    if (numeroConfig !== oab.numero) return false;
    if (config.oabUf && oab.uf) {
      return String(config.oabUf).toUpperCase() === oab.uf;
    }
    return true;
  }

  // Texto que o PJe usa quando o polo está mesmo vazio: nunca é nome de parte.
  const PLACEHOLDER_DE_POLO = /^(n[ãa]o h[áa]|nenhum|sem parte|n[ãa]o (existe|consta|definid)|vazio)/i;

  // Linha de endereço não é nome de parte.
  const PARECE_ENDERECO = /^(rua|av\.?|avenida|travessa|pra[çc]a|rodovia|estrada|bairro|cep\b)|\bcep\b|\d{5}-?\d{3}/i;

  /** Cabeçalhos que encerram um bloco de polo. */
  const FIM_DE_BLOCO = /^(polo (ativo|passivo)|outros interessados|expedientes|movimenta|documentos|anexos|audi[êe]ncias|peti[çc][õo]es)/i;

  function montarPartes(bloco, config) {
    const partes = [];

    for (const linha of bloco) {
      const item = parsearLinhaParte(linha);
      if (!item) continue; // ruído entre as partes (endereços, rótulos internos)

      if (item.eh_advogado) {
        const anterior = partes[partes.length - 1];
        if (!anterior) continue;

        anterior.advogados.push({
          nome: item.nome,
          oab: item.oab,
          documento: item.documento
        });

        if (mesmaOab(item.oab, config)) {
          anterior.is_cliente = true;
        }
        continue;
      }

      partes.push({
        nome: item.nome,
        papel: item.papel,
        papel_incomum: item.papel_incomum,
        documento: item.documento,
        advogados: [],
        is_cliente: false
      });
    }

    return partes;
  }

  /**
   * Lê um polo.
   *
   * O cabeçalho aparece mais de uma vez (há um rótulo de aba com o mesmo texto
   * antes da seção real), e uma parte institucional pode ocupar várias linhas,
   * com o papel só na última. Por isso o bloco é delimitado pelo próximo
   * cabeçalho de seção e, dentro dele, valem as linhas que trazem papel —
   * em vez de parar na primeira linha que não casa.
   */
  function analisarPolo(linhas, cabecalho, config) {
    const alvo = cabecalho.toLowerCase();
    let localizada = false;

    // Tamanho do bloco da última ocorrência do cabeçalho: a primeira costuma
    // ser o rótulo de aba, cujo "bloco" engloba os campos do cabeçalho do
    // processo e não diz nada sobre as partes.
    let ultimoBloco = 0;
    let ultimoBlocoLinhas = [];

    for (let inicio = 0; inicio < linhas.length; inicio += 1) {
      if (linhas[inicio].toLowerCase().replace(/:$/, "") !== alvo) continue;

      localizada = true;

      let fim = linhas.length;
      for (let i = inicio + 1; i < linhas.length; i += 1) {
        const atual = linhas[i].toLowerCase().replace(/:$/, "");
        if (atual === alvo) continue;
        if (FIM_DE_BLOCO.test(atual)) {
          fim = i;
          break;
        }
      }

      const bloco = linhas.slice(inicio + 1, fim);
      ultimoBloco = bloco.length;
      ultimoBlocoLinhas = bloco;

      const partes = montarPartes(bloco, config);
      if (partes.length) {
        return { partes, status: "ok", linhas_analisadas: bloco.length };
      }
    }

    if (!localizada) {
      return { partes: [], status: "secao_ausente", linhas_analisadas: 0 };
    }

    // Bloco com conteúdo e nenhuma parte reconhecida costuma ser parte
    // institucional — delegacia ou MP — que o PJe listou sem declarar o papel
    // entre parênteses. Nas mesmas classes, os processos lidos com sucesso
    // trazem exatamente esse tipo de parte, então descartar apagaria parte real.
    // O nome é recuperado, o papel fica null e o processo segue sinalizado.
    if (ultimoBloco > 0 && ultimoBlocoLinhas.length) {
      const candidata = ultimoBlocoLinhas.find(
        (l) => !PLACEHOLDER_DE_POLO.test(l) && !PARECE_ENDERECO.test(l) && l.length >= 4
      );

      if (candidata) {
        return {
          partes: [
            {
              nome: normalizar(candidata.split(/\s+-\s+/)[0]),
              papel: null,
              papel_incomum: true,
              documento: null,
              advogados: [],
              is_cliente: false,
              papel_nao_declarado: true
            }
          ],
          status: "parte_sem_papel",
          linhas_analisadas: ultimoBloco
        };
      }
    }

    // Seção existe. Bloco praticamente vazio significa polo sem parte
    // cadastrada — normal em alvará e divórcio consensual. Bloco com conteúdo
    // que não virou nenhuma parte é falha de leitura, e precisa ser conferido
    // à mão em vez de passar por polo vazio.
    return {
      partes: [],
      status: ultimoBloco <= 1 ? "sem_partes_cadastradas" : "nao_interpretado",
      linhas_analisadas: ultimoBloco
    };
  }

  function parsearPolo(linhas, cabecalho, config) {
    return analisarPolo(linhas, cabecalho, config).partes;
  }

  function numeroCnj(linhas) {
    for (const linha of linhas) {
      const m = linha.match(REGEX_CNJ);
      if (m) return m[0];
    }
    return null;
  }

  function todosOsNumerosCnj(texto) {
    return [...new Set((texto || "").match(REGEX_CNJ_GLOBAL) || [])];
  }

  function tribunalPelaUrl(href) {
    try {
      const host = new URL(href).hostname;
      const m = host.match(/\b(tj[a-z]{2}|trt\d{1,2}|trf\d{1,2})\b/i);
      const grau = /pje2g|\/2g\//i.test(href) ? "2" : /pje1g|\/1g\//i.test(href) ? "1" : null;
      return { tribunal: m ? m[1].toUpperCase() : null, grau };
    } catch (erro) {
      return { tribunal: null, grau: null };
    }
  }

  /** Monta o registro de um processo a partir da página de detalhe. */
  function parsearDetalhe(doc, config, urlOrigem) {
    const linhas = linhasDoDocumento(doc);
    const numero = numeroCnj(linhas);

    if (!numero) {
      throw new Error("Página de detalhe sem número de processo reconhecível.");
    }

    const classe = separarCodigo(valorDoRotulo(linhas, ["Classe judicial", "Classe"]));
    const assunto = separarCodigo(valorDoRotulo(linhas, ["Assunto"]));
    const analiseAtivo = analisarPolo(linhas, "Polo ativo", config);
    const analisePassivo = analisarPolo(linhas, "Polo passivo", config);
    const poloAtivo = analiseAtivo.partes;
    const poloPassivo = analisePassivo.partes;
    const origem = tribunalPelaUrl(urlOrigem || (doc.location ? doc.location.href : ""));

    const clientes = [...poloAtivo, ...poloPassivo]
      .filter((p) => p.is_cliente)
      .map((p) => ({ nome: p.nome, papel: p.papel, polo: poloAtivo.includes(p) ? "ativo" : "passivo" }));

    const incomuns = [...poloAtivo, ...poloPassivo].filter((p) => p.papel_incomum).map((p) => p.papel);
    const revisar =
      [analiseAtivo, analisePassivo].some(
        (a) => a.status === "nao_interpretado" || a.status === "secao_ausente" || a.status === "parte_sem_papel"
      ) ||
      incomuns.length > 0;

    return {
      numero_processo: numero,
      classe: classe.nome,
      classe_codigo: classe.codigo,
      assunto: assunto.nome,
      assunto_codigo: assunto.codigo,
      jurisdicao: valorDoRotulo(linhas, ["Jurisdição"]),
      orgao_julgador: valorDoRotulo(linhas, ["Órgão julgador", "Orgão julgador"]),
      competencia: valorDoRotulo(linhas, ["Competência"]),
      cargo_judicial: valorDoRotulo(linhas, ["Cargo judicial"]),
      autuacao: valorDoRotulo(linhas, ["Autuação"]),
      ultima_distribuicao: valorDoRotulo(linhas, ["Última distribuição"]),
      valor_causa: valorDoRotulo(linhas, ["Valor da causa"]),
      segredo_justica: valorDoRotulo(linhas, ["Segredo de justiça?"]),
      justica_gratuita: valorDoRotulo(linhas, ["Justiça gratuita?"]),
      tutela_liminar: valorDoRotulo(linhas, ["Tutela/liminar?"]),
      prioridade: valorDoRotulo(linhas, ["Prioridade?"]),
      polo_ativo: poloAtivo,
      polo_passivo: poloPassivo,
      clientes,
      qtd_clientes: clientes.length,
      diagnostico: {
        polo_ativo: { status: analiseAtivo.status, linhas_analisadas: analiseAtivo.linhas_analisadas },
        polo_passivo: { status: analisePassivo.status, linhas_analisadas: analisePassivo.linhas_analisadas },
        papeis_incomuns: [...new Set(incomuns)],
        revisar_manualmente: revisar
      },
      fonte: "PJe",
      tribunal: origem.tribunal,
      grau: origem.grau,
      parser_versao: VERSAO_PARSER,
      extraido_em: new Date().toISOString()
    };
  }

  const api = {
    VERSAO_PARSER,
    linhasDoDocumento,
    valorDoRotulo,
    separarCodigo,
    parsearLinhaParte,
    parsearPolo,
    analisarPolo,
    parsearDetalhe,
    normalizarOab,
    mesmaOab,
    numeroCnj,
    todosOsNumerosCnj,
    tribunalPelaUrl,
    REGEX_CNJ
  };

  root.PjeCore = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
