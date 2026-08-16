/**
 * Adaptador do PJe.
 *
 * Fase 1 percorre a árvore do ACERVO (comarca -> caixa de entrada) e colhe de
 * cada linha o número do processo e a URL de detalhe. Essa fase é obrigatória
 * porque a URL traz um token "ca" por processo que NÃO pode ser construído:
 * só existe na listagem.
 */
(() => {
  const { esperar, ate, toast, origemPelaUrl, buscarDocumento, REGEX_CNJ } = PjeExtUtil;

  const LIMITE_ESPERA_MS = 20000;

  function linksDaListagem() {
    const grau = origemPelaUrl(location.href).grau;

    return [...document.querySelectorAll("a")]
      .map((a) => {
        const texto = (a.textContent || "").replace(/\s+/g, " ").trim();
        const numero = (texto.match(REGEX_CNJ) || [])[0];
        if (!numero) return null;

        const onclick = a.getAttribute("onclick") || "";
        const m = onclick.match(/window\.open\('([^']+)'/);
        if (!m) return null;

        return { numero_processo: numero, url_detalhe: m[1], rotulo_listagem: texto, grau };
      })
      .filter(Boolean);
  }

  /**
   * O paginador do acervo. A página tem mais de um rich-datascr (há outro para
   * a tabela de histórico), então é preciso escolher o que pertence ao acervo —
   * o script de inicialização do RichFaces carrega o nome do form.
   */
  function paginadorDoAcervo() {
    return (
      [...document.querySelectorAll("div.rich-datascr")].find((d) =>
        /formAcervo/.test(d.textContent || "")
      ) || null
    );
  }

  function estadoDaPaginacao() {
    const paginador = paginadorDoAcervo();
    if (!paginador) return { atual: null, paginas: [] };

    const ativa = paginador.querySelector("td.rich-datascr-act");
    const paginas = [...paginador.querySelectorAll("td.rich-datascr-inact")].filter((td) =>
      /^\d+$/.test((td.textContent || "").trim())
    );

    return {
      atual: ativa && /^\d+$/.test((ativa.textContent || "").trim()) ? Number(ativa.textContent.trim()) : null,
      paginas
    };
  }

  function primeiroNumeroDaListagem() {
    const primeiro = linksDaListagem()[0];
    return primeiro ? primeiro.numero_processo : null;
  }

  /**
   * Colhe a página atual e as seguintes. Qualquer tropeço encerra a paginação
   * em silêncio, com o que já foi colhido: a conferência de completude da
   * comarca é que vai acusar a falta.
   */
  async function colherTodasAsPaginas(acumular, log) {
    acumular(linksDaListagem());

    for (let volta = 0; volta < 100; volta += 1) {
      try {
        const { atual, paginas } = estadoDaPaginacao();
        if (atual === null) break;

        const proxima = paginas.find((td) => Number((td.textContent || "").trim()) === atual + 1);
        if (!proxima) break;

        const antes = primeiroNumeroDaListagem();
        proxima.click();

        const mudou = await ate(() => {
          const agora = primeiroNumeroDaListagem();
          return agora && agora !== antes ? agora : null;
        }, 15000);

        if (!mudou) break;

        await esperar(700);
        acumular(linksDaListagem());
      } catch (erro) {
        await log("pje", "paginação interrompida", {
          erro: erro instanceof Error ? erro.message : String(erro)
        });
        break;
      }
    }
  }

  function ativarAbaAcervo() {
    const aba = [...document.querySelectorAll("a, td, span")].find(
      (el) => (el.textContent || "").trim().toUpperCase() === "ACERVO"
    );
    if (aba) aba.click();
    return !!aba;
  }

  function nosDeComarca() {
    return [...document.querySelectorAll("a")].filter(
      (a) => a.id && a.id.includes(":trAc:") && a.id.endsWith("::jNd")
    );
  }

  function contagemDeclarada(textoNo) {
    const m = (textoNo || "").match(/(\d+)\s*$/);
    return m ? Number(m[1]) : null;
  }

  function rotuloDoNo(no) {
    return (no.textContent || "").replace(/\s+/g, " ").trim();
  }

  /**
   * A view do painel ainda está de pé?
   *
   * O PJe descarta o ViewState e redireciona para home.seam quando a view
   * envelhece. Depois disso nenhum clique na árvore funciona, e insistir só
   * gasta tempo — melhor encerrar a fase 1 com o que já foi colhido.
   */
  function viewViva() {
    return /painel_usuario/i.test(location.pathname) && nosDeComarca().length > 0;
  }

  function acharNoPorRotulo(rotulo) {
    return nosDeComarca().find((n) => rotuloDoNo(n) === rotulo) || null;
  }

  async function colherComarca(rotulo, registrar, log) {
    const no = acharNoPorRotulo(rotulo);
    if (!no) throw new Error("nó da comarca não encontrado na árvore");

    const prefixo = no.id.replace(/::jNd$/, "");
    no.click();

    const caixas = await ate(() => {
      const achadas = [...document.querySelectorAll("a")].filter(
        (a) => a.id && a.id.startsWith(`${prefixo}:`) && a.id.endsWith("::cxItem")
      );
      return achadas.length ? achadas : null;
    }, LIMITE_ESPERA_MS);

    if (!caixas) throw new Error("caixa de entrada não abriu");

    let novos = 0;

    for (const caixa of caixas) {
      caixa.click();
      await ate(() => linksDaListagem().length > 0, 12000);
      await esperar(900); // deixa a tabela terminar de renderizar
      await colherTodasAsPaginas((itens) => {
        novos += registrar(itens);
      }, log);
    }

    return novos;
  }

  /**
   * Fase 1. Cada comarca é isolada: se uma falhar, vira aviso e as demais
   * seguem. O que já foi colhido é gravado a cada comarca, então uma execução
   * interrompida retoma sem refazer o que deu certo.
   */
  async function coletar(ctx) {
    const { salvarEstado, lerEstado, log } = ctx;

    ativarAbaAcervo();
    await ate(() => nosDeComarca().length > 0, LIMITE_ESPERA_MS);

    const anteriorBruto = await lerEstado();

    // Retoma sempre que a coleta anterior não fechou — inclusive quando ela
    // terminou "concluída em parte", que é justamente o caso a aproveitar.
    const anterior = anteriorBruto && anteriorBruto.fase1_completa !== true ? anteriorBruto : null;

    const colhidos = new Map(((anterior && anterior.links) || []).map((l) => [l.numero_processo, l]));
    const concluidas = new Set((anterior && anterior.comarcas_concluidas) || []);
    const avisos = [];

    // Os rótulos são fotografados antes: a árvore é reconstruída a cada clique
    // e os ids mudam, mas o texto da comarca continua o mesmo.
    const rotulos = nosDeComarca().map(rotuloDoNo);

    await salvarEstado({
      fase: "colhendo",
      total_comarcas: rotulos.length,
      comarca_atual: 0,
      links: [...colhidos.values()],
      comarcas_concluidas: [...concluidas],
      avisos: []
    });

    let interrompida = null;

    for (let i = 0; i < rotulos.length; i += 1) {
      const rotulo = rotulos[i];

      if (concluidas.has(rotulo)) {
        await salvarEstado({ comarca_atual: i + 1 });
        continue;
      }

      if (!viewViva()) {
        interrompida = `a sessão do PJe expirou após ${i} de ${rotulos.length} comarcas`;
        avisos.push({ comarca: rotulo, aviso: `não percorrida: ${interrompida}` });
        break;
      }

      const esperado = contagemDeclarada(rotulo);
      toast(`Colhendo ${i + 1}/${rotulos.length}: ${rotulo}`);

      try {
        const daComarca = await colherComarca(
          rotulo,
          (itens) => {
            let novos = 0;
            for (const item of itens) {
              if (!colhidos.has(item.numero_processo)) {
                colhidos.set(item.numero_processo, Object.assign({ comarca: rotulo }, item));
                novos += 1;
              }
            }
            return novos;
          },
          log
        );

        if (esperado !== null && daComarca < esperado) {
          avisos.push({ comarca: rotulo, aviso: `colhidos ${daComarca} de ${esperado} declarados` });
        } else {
          concluidas.add(rotulo);
        }
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        avisos.push({ comarca: rotulo, aviso: `falhou: ${mensagem}` });
        await log("pje", "comarca falhou", { comarca: rotulo, erro: mensagem });

        // Uma comarca pode falhar sozinha; a view inteira cair é outra coisa.
        if (!viewViva()) {
          interrompida = `a sessão do PJe caiu ao percorrer ${rotulo}`;
          break;
        }
      }

      await salvarEstado({
        comarca_atual: i + 1,
        links: [...colhidos.values()],
        comarcas_concluidas: [...concluidas],
        avisos
      });
    }

    if (interrompida) {
      avisos.push({
        comarca: "(geral)",
        aviso: `fase 1 encerrada antes do fim: ${interrompida}. Recarregue o painel e rode de novo para completar — o que já foi colhido é aproveitado.`
      });
      await log("pje", "fase 1 interrompida", { motivo: interrompida });
    }

    await salvarEstado({
      links: [...colhidos.values()],
      comarcas_concluidas: [...concluidas],
      avisos,
      fase1_completa: !interrompida
    });

    return { links: [...colhidos.values()], avisos, interrompida };
  }

  PjeExtAdaptadores.registrar({
    id: "PJe",
    nome: "PJe",
    pagina: "o Painel do Advogado do PJe",
    parserVersao: PjeParser.VERSAO_PARSER,
    detecta: (url) => /painel_usuario/i.test(url),
    coletar,
    buscarDetalhe: (link) => buscarDocumento(new URL(link.url_detalhe, location.origin).href, "utf-8"),
    parsear: (doc, config, url) => PjeParser.parsearDetalhe(doc, config, new URL(url, location.origin).href)
  });
})();
