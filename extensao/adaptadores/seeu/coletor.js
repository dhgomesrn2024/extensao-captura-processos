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

  // Nomes reais do formulário da listagem, conferidos na página.
  const FORM = "processosAdvogadoForm";
  const CAMPO_TAMANHO = "processosAdvogadoPageSize";
  const CAMPO_PAGINA = "processosAdvogadoPageNumber";
  const TAMANHO_MAXIMO = 500;

  function formularioDaListagem() {
    const doc = documentoDaListagem();
    if (!doc) return null;
    return doc.forms[FORM] || doc.forms[0] || null;
  }

  /** "48 registro(s) encontrado(s), exibindo de 1 até 20" -> [1, 20] */
  function faixaExibida() {
    const doc = documentoDaListagem();
    if (!doc || !doc.body) return null;
    const m = (doc.body.textContent || "").match(/exibindo de (\d+) at[eé] (\d+)/i);
    return m ? [Number(m[1]), Number(m[2])] : null;
  }

  /**
   * Submete o formulário e espera a listagem trocar.
   *
   * É preciso submeter, e não clicar: a paginação do SEEU são âncoras com
   * href `javascript:`, e content script roda em mundo isolado, de onde esse
   * tipo de navegação não dispara. `form.submit()` funciona.
   */
  async function submeterEEsperar(ajustar, condicao) {
    const form = formularioDaListagem();
    if (!form) return false;

    ajustar(form);
    form.submit();

    // Duas condições, e a primeira é a que faltava: a listagem só está pronta
    // quando o número de linhas alcança a faixa que a própria página declara
    // ("exibindo de 1 até 48"). Sem isso, lê-se o DOM no meio da navegação e
    // volta-se com menos processos do que existem — silenciosamente.
    const pronta = await ate(() => {
      if (!documentoDaListagem()) return null;

      const faixa = faixaExibida();
      if (!faixa) return null;

      const previstos = faixa[1] - faixa[0] + 1;
      if (linksDaListagem().length < previstos) return null;

      return condicao(faixa) ? faixa : null;
    }, 30000);

    return !!pronta;
  }

  /**
   * Traz tudo numa página só, ampliando o tamanho da página.
   *
   * Muito mais robusto que percorrer páginas: uma submissão, um estado, nada
   * de âncora que muda de lugar a cada carga.
   */
  async function trazerTudoNumaPagina(esperado) {
    const form = formularioDaListagem();
    if (!form || !form.elements[CAMPO_TAMANHO]) return false;

    const alvoFim = Math.min(esperado || TAMANHO_MAXIMO, TAMANHO_MAXIMO);

    return submeterEEsperar(
      (f) => {
        f.elements[CAMPO_TAMANHO].value = String(TAMANHO_MAXIMO);
        if (f.elements[CAMPO_PAGINA]) f.elements[CAMPO_PAGINA].value = "1";
      },
      (faixa) => faixa[1] >= alvoFim
    );
  }

  /**
   * Reserva: percorre por número de página, também por submissão.
   *
   * O critério de parada é o início da faixa avançar — e não o fim alcançar o
   * total, que já é verdadeiro logo após a ampliação e faria desistir na
   * primeira volta.
   */
  async function percorrerPaginas(acumular, colhidos, esperado, log) {
    for (let pagina = 2; pagina <= 50; pagina += 1) {
      if (esperado && colhidos() >= esperado) break;

      const anterior = faixaExibida();
      const form = formularioDaListagem();
      if (!form || !form.elements[CAMPO_PAGINA]) break;

      const ok = await submeterEEsperar(
        (f) => {
          f.elements[CAMPO_PAGINA].value = String(pagina);
        },
        (faixa) => !anterior || faixa[0] !== anterior[0]
      );

      if (!ok) {
        await log("seeu", "paginação parou", { pagina });
        break;
      }

      acumular(linksDaListagem());
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

    const registrar = (itens) => {
      let novos = 0;
      for (const item of itens) {
        if (!colhidos.has(item.numero_processo)) {
          colhidos.set(item.numero_processo, item);
          novos += 1;
        }
      }
      return novos;
    };

    // Primeiro tenta trazer tudo de uma vez; só pagina se ainda faltar.
    const ampliou = await trazerTudoNumaPagina(esperado);
    registrar(linksDaListagem());
    await log("seeu", "ampliação da página", { ampliou, esperado, colhidos: colhidos.size });

    if (esperado !== null && colhidos.size < esperado) {
      await percorrerPaginas(registrar, () => colhidos.size, esperado, log);
      await log("seeu", "após paginação de reserva", { colhidos: colhidos.size, esperado });
    }

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
      fase1_completa: esperado === null || colhidos.size >= esperado
    });

    const completa = esperado === null || colhidos.size >= esperado;

    await log("seeu", "fase 1 concluída", { colhidos: colhidos.size, esperado });

    return { links: [...colhidos.values()], avisos, interrompida: null, completa };
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
