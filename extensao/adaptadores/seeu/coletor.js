/**
 * Adaptador do SEEU.
 *
 * Estrutura conferida na página:
 *
 *   topo (/seeu/)
 *    └ mainFrame
 *       └ userMainFrame  →  /seeu/processosAdvogado.do   (a listagem)
 *
 * Frameset clássico (Struts), não RichFaces. A listagem é plana e paginada,
 * 20 por página, e o link de cada processo é href real terminando em .do —
 * sem token de acesso, ao contrário do PJe.
 *
 * Duas diferenças que obrigam código próprio:
 *
 *   1. o conteúdo vive dentro de frames aninhados, e o script é injetado no
 *      topo, então é preciso descer até o frame certo;
 *   2. as páginas são servidas em ISO-8859-1 — decodificar como UTF-8
 *      corromperia todo acento em silêncio.
 */
(() => {
  const { esperar, ate, toast, buscarDocumento, origemPelaUrl, REGEX_CNJ } = PjeExtUtil;

  const LIMITE_ESPERA_MS = 20000;

  /** Desce nos frames até achar o documento da listagem. */
  function documentoDaListagem(janela = window, profundidade = 0) {
    if (profundidade > 4) return null;

    try {
      const doc = janela.document;
      if (doc && /processosAdvogado/i.test(doc.location.pathname)) return doc;

      for (let i = 0; i < janela.frames.length; i += 1) {
        const achado = documentoDaListagem(janela.frames[i], profundidade + 1);
        if (achado) return achado;
      }
    } catch (erro) {
      // frame de outra origem: ignora e segue
    }
    return null;
  }

  /**
   * Uma linha da listagem traz mais do que o link: Autoridade, Executado,
   * classe e data. A capa do SEEU não declara os dois polos, então esses
   * dados da linha são o que permite montar polo ativo e passivo.
   */
  function linhaDoProcesso(ancora, doc) {
    const numero = ((ancora.textContent || "").match(REGEX_CNJ) || [])[0];
    if (!numero) return null;

    const href = ancora.getAttribute("href") || "";
    if (!href || href.startsWith("javascript")) return null;

    let linha = ancora;
    while (linha && linha.tagName !== "TR") linha = linha.parentElement;

    const celulas = linha ? Array.from(linha.cells || []) : [];
    const textoDe = (i) => (celulas[i] ? (celulas[i].textContent || "").replace(/\s+/g, " ").trim() : "");

    // A célula de partes traz "Autoridade: X ... Executado: Y"
    const blocoPartes = celulas.map((_, i) => textoDe(i)).find((t) => /Autoridade\s*:/i.test(t)) || "";
    const mAutoridade = blocoPartes.match(/Autoridade\s*:\s*(.*?)(?:\s*Executado\s*:|$)/i);
    const mExecutado = blocoPartes.match(/Executado\s*:\s*(.*)$/i);

    const textoLinha = celulas.map((_, i) => textoDe(i)).join(" | ");
    const mData = textoLinha.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
    const mClasse = textoLinha.match(/Execução da Pena[^|]*/i);

    return {
      numero_processo: numero,
      url_detalhe: new URL(href, doc.location.href).href,
      autoridade: mAutoridade ? mAutoridade[1].trim() : null,
      executado: mExecutado ? mExecutado[1].trim() : null,
      distribuicao: mData ? mData[0] : null,
      classe: mClasse ? mClasse[0].trim() : null,
      grau: origemPelaUrl(location.href).grau || "1"
    };
  }

  function linksDaListagem() {
    const doc = documentoDaListagem();
    if (!doc) return [];

    return Array.from(doc.querySelectorAll("a"))
      .map((a) => linhaDoProcesso(a, doc))
      .filter(Boolean);
  }

  function primeiroNumero() {
    const primeiro = linksDaListagem()[0];
    return primeiro ? primeiro.numero_processo : null;
  }

  /** "48 registro(s) encontrado(s), exibindo de 1 até 20" */
  function totalDeclarado() {
    const doc = documentoDaListagem();
    if (!doc || !doc.body) return null;
    const m = (doc.body.textContent || "").match(/(\d+)\s+registro/i);
    return m ? Number(m[1]) : null;
  }

  /** Âncoras de página: textos numéricos, acionadas por JavaScript. */
  function ancorasDePagina() {
    const doc = documentoDaListagem();
    if (!doc) return [];
    return Array.from(doc.querySelectorAll("a")).filter((a) =>
      /^\d{1,3}$/.test((a.textContent || "").trim())
    );
  }

  /**
   * Percorre as páginas seguintes. A paginação do SEEU é JavaScript que
   * submete o formulário, então o caminho é clicar e esperar a listagem
   * trocar — não dá para montar URL.
   */
  async function colherTodasAsPaginas(acumular, log) {
    acumular(linksDaListagem());

    const visitadas = new Set(["1"]);

    for (let volta = 0; volta < 50; volta += 1) {
      try {
        const proxima = ancorasDePagina().find((a) => !visitadas.has((a.textContent || "").trim()));
        if (!proxima) break;

        const rotulo = (proxima.textContent || "").trim();
        visitadas.add(rotulo);

        const antes = primeiroNumero();
        proxima.click();

        const mudou = await ate(() => {
          const agora = primeiroNumero();
          return agora && agora !== antes ? agora : null;
        }, 15000);

        if (!mudou) break;

        await esperar(700);
        acumular(linksDaListagem());
      } catch (erro) {
        await log("seeu", "paginação interrompida", {
          erro: erro instanceof Error ? erro.message : String(erro)
        });
        break;
      }
    }
  }

  /**
   * Fase 1. A listagem já vem filtrada por Situação = Ativo, que é o recorte
   * combinado; o adaptador não mexe no filtro de propósito.
   */
  async function coletar(ctx) {
    const { salvarEstado, log } = ctx;

    const doc = await ate(() => documentoDaListagem(), LIMITE_ESPERA_MS);
    if (!doc) {
      throw new Error("Abra a lista de processos do SEEU (Ações 1º Grau) antes de migrar.");
    }

    await ate(() => linksDaListagem().length > 0, LIMITE_ESPERA_MS);

    const colhidos = new Map();
    const avisos = [];
    const esperado = totalDeclarado();

    await salvarEstado({
      fase: "colhendo",
      total_comarcas: 1,
      comarca_atual: 0,
      links: [],
      comarcas_concluidas: [],
      avisos: []
    });

    toast("Colhendo a lista de processos do SEEU...");

    await colherTodasAsPaginas((itens) => {
      let novos = 0;
      for (const item of itens) {
        if (!colhidos.has(item.numero_processo)) {
          colhidos.set(item.numero_processo, item);
          novos += 1;
        }
      }
      return novos;
    }, log);

    if (esperado !== null && colhidos.size < esperado) {
      avisos.push({
        comarca: "SEEU (situação: ativo)",
        aviso: `colhidos ${colhidos.size} de ${esperado} declarados`
      });
    }

    await salvarEstado({
      comarca_atual: 1,
      links: [...colhidos.values()],
      comarcas_concluidas: ["SEEU"],
      avisos,
      fase1_completa: true
    });

    await log("seeu", "fase 1 concluída", { colhidos: colhidos.size, esperado });

    return { links: [...colhidos.values()], avisos, interrompida: null };
  }

  PjeExtAdaptadores.registrar({
    id: "SEEU",
    nome: "SEEU",
    pagina: "a lista de processos do SEEU",
    parserVersao: SeeuParser.VERSAO_PARSER,
    detecta: (url) => /\/seeu\//i.test(url),
    coletar,
    // ISO-8859-1: sem isso, todo acento vem corrompido e ninguém percebe.
    buscarDetalhe: (link) => buscarDocumento(link.url_detalhe, "iso-8859-1"),
    parsear: (doc, config, url, link) => SeeuParser.parsearDetalhe(doc, config, url, link)
  });
})();
