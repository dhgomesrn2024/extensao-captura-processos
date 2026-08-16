/**
 * Migrador do acervo do PJe.
 *
 * Duas fases, desenhadas em cima da estrutura real do painel do advogado:
 *
 *   Fase 1 - percorre a árvore do ACERVO (comarca -> caixa de entrada) e colhe,
 *            de cada linha, o número do processo e a URL de detalhe. A URL traz
 *            um token "ca" por processo que NÃO pode ser construído: só existe
 *            na listagem, por isso essa fase é obrigatória.
 *
 *   Fase 2 - busca cada URL de detalhe com fetch na própria sessão logada
 *            (sem abrir aba) e extrai os dados com PjeCore.
 *
 * O progresso é gravado em chrome.storage.local a cada passo: o popup pode ser
 * fechado, e uma execução interrompida continua de onde parou.
 */
(() => {
  if (window.__pjeMigradorRodando) {
    console.log("[PJE-EXT] Migração já está em andamento nesta aba.");
    return;
  }

  window.__pjeMigradorRodando = true;

  const PAUSA_ENTRE_FETCHES_MS = 400;
  const LIMITE_ESPERA_MS = 20000;

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  async function ate(condicao, limite = LIMITE_ESPERA_MS) {
    const inicio = Date.now();
    while (Date.now() - inicio < limite) {
      const valor = condicao();
      if (valor) return valor;
      await esperar(250);
    }
    return null;
  }

  function toast(mensagem, erro = false) {
    const anterior = document.getElementById("pje-migrador-toast");
    if (anterior) anterior.remove();

    const el = document.createElement("div");
    el.id = "pje-migrador-toast";
    el.textContent = mensagem;
    Object.assign(el.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "2147483647",
      maxWidth: "420px",
      padding: "12px 14px",
      borderRadius: "8px",
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      color: "#fff",
      background: erro ? "#b42318" : "#027a48",
      boxShadow: "0 8px 24px rgba(0,0,0,.18)"
    });
    document.body.appendChild(el);
  }

  async function salvarEstado(patch) {
    const { migracao } = await chrome.storage.local.get("migracao");
    const novo = Object.assign({}, migracao || {}, patch);
    await chrome.storage.local.set({ migracao: novo });
    chrome.runtime.sendMessage({ type: "pje-migrador:progresso", estado: novo });
    return novo;
  }

  function linksDaListagem() {
    return [...document.querySelectorAll("a")]
      .map((a) => {
        const texto = (a.textContent || "").replace(/\s+/g, " ").trim();
        const numero = (texto.match(PjeCore.REGEX_CNJ) || [])[0];
        if (!numero) return null;

        const onclick = a.getAttribute("onclick") || "";
        const m = onclick.match(/window\.open\('([^']+)'/);
        if (!m) return null;

        return { numero_processo: numero, url_detalhe: m[1], rotulo_listagem: texto };
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
   * Colhe a página atual e todas as seguintes, se houver paginador.
   *
   * Qualquer tropeço aqui encerra a paginação em silêncio, com o que já foi
   * colhido: a conferência de completude da comarca é que vai acusar a falta.
   */
  async function colherTodasAsPaginas(acumular) {
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
        await pjeExtLog("migrador", "paginação interrompida", {
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

  /** Colhe uma comarca. Devolve quantos processos novos entraram. */
  async function colherComarca(rotulo, registrar) {
    const no = acharNoPorRotulo(rotulo);
    if (!no) throw new Error("nó da comarca não encontrado na árvore");

    const prefixo = no.id.replace(/::jNd$/, "");
    no.click();

    const caixas = await ate(() => {
      const achadas = [...document.querySelectorAll("a")].filter(
        (a) => a.id && a.id.startsWith(`${prefixo}:`) && a.id.endsWith("::cxItem")
      );
      return achadas.length ? achadas : null;
    });

    if (!caixas) throw new Error("caixa de entrada não abriu");

    let novos = 0;

    for (const caixa of caixas) {
      caixa.click();
      await ate(() => linksDaListagem().length > 0, 12000);
      await esperar(900); // deixa a tabela terminar de renderizar

      await colherTodasAsPaginas((itens) => {
        novos += registrar(itens);
      });
    }

    return novos;
  }

  /**
   * Fase 1: percorre a árvore e colhe as URLs de detalhe.
   *
   * Cada comarca é isolada: se uma falhar, vira aviso e as demais seguem. O
   * que já foi colhido é gravado a cada comarca, então uma execução
   * interrompida retoma sem refazer o que deu certo.
   */
  async function colherAcervo() {
    ativarAbaAcervo();
    await ate(() => nosDeComarca().length > 0);

    const { migracao } = await chrome.storage.local.get("migracao");

    // Retoma sempre que a coleta anterior não fechou — inclusive quando ela
    // terminou "concluída em parte", que é justamente o caso a aproveitar.
    const anterior = migracao && migracao.fase1_completa !== true ? migracao : null;

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

      let daComarca = 0;

      try {
        daComarca = await colherComarca(rotulo, (itens) => {
          let novos = 0;
          for (const item of itens) {
            if (!colhidos.has(item.numero_processo)) {
              colhidos.set(item.numero_processo, Object.assign({ comarca: rotulo }, item));
              novos += 1;
            }
          }
          return novos;
        });

        if (esperado !== null && daComarca < esperado) {
          avisos.push({
            comarca: rotulo,
            aviso: `colhidos ${daComarca} de ${esperado} declarados`
          });
        } else {
          concluidas.add(rotulo);
        }
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        avisos.push({ comarca: rotulo, aviso: `falhou: ${mensagem}` });
        await pjeExtLog("migrador", "comarca falhou", { comarca: rotulo, erro: mensagem });

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
      await pjeExtLog("migrador", "fase 1 interrompida", { motivo: interrompida });
    }

    await salvarEstado({
      links: [...colhidos.values()],
      comarcas_concluidas: [...concluidas],
      avisos,
      fase1_completa: !interrompida
    });

    return { links: [...colhidos.values()], avisos, interrompida };
  }

  /**
   * Chave do registro.
   *
   * O número CNJ não basta: uma apelação no 2º grau conserva o número do
   * processo de origem, então migrar o 2º grau sobre o 1º sobrescreveria os
   * registros de mesmo número. Grau + número mantém os dois lados.
   */
  function chaveDoProcesso(numero) {
    const grau = PjeCore.tribunalPelaUrl(location.href).grau || "?";
    return `${grau}:${numero}`;
  }

  /** Fase 2: busca e interpreta cada processo. */
  async function detalharProcessos(links, config) {
    const { processos } = await chrome.storage.local.get("processos");
    const mapa = processos || {};
    const erros = [];

    for (let i = 0; i < links.length; i += 1) {
      const link = links[i];
      const chave = chaveDoProcesso(link.numero_processo);

      const jaSalvo = mapa[chave];

      // Só pula o que já foi extraído pela versão atual do parser: corrigir o
      // parser precisa refazer os registros antigos, não herdá-los.
      if (jaSalvo && jaSalvo.classe && jaSalvo.parser_versao === PjeCore.VERSAO_PARSER) {
        continue;
      }

      toast(`Detalhando ${i + 1}/${links.length}: ${link.numero_processo}`);

      try {
        const resposta = await fetch(link.url_detalhe, { credentials: "include" });
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

        const html = await resposta.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const dados = PjeCore.parsearDetalhe(doc, config, new URL(link.url_detalhe, location.origin).href);

        mapa[chave] = Object.assign({ comarca: link.comarca }, dados);
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        erros.push({ numero_processo: link.numero_processo, erro: mensagem });
        mapa[chave] = {
          numero_processo: link.numero_processo,
          comarca: link.comarca,
          grau: PjeCore.tribunalPelaUrl(location.href).grau,
          erro: mensagem,
          extraido_em: new Date().toISOString()
        };
      }

      await chrome.storage.local.set({ processos: mapa });
      await salvarEstado({ fase: "detalhando", detalhados: i + 1, total_links: links.length, erros });
      await esperar(PAUSA_ENTRE_FETCHES_MS);
    }

    return { total: Object.keys(mapa).length, erros };
  }

  async function executar() {
    try {
      await pjeExtLog("migrador", "início", { url: location.href });

      if (!/painel_usuario/i.test(location.pathname)) {
        throw new Error("Abra o Painel do Advogado antes de migrar.");
      }

      const { advogadoConfig } = await chrome.storage.local.get("advogadoConfig");
      const { links, avisos, interrompida } = await colherAcervo();

      await pjeExtLog("migrador", "fase 1 encerrada", {
        qtdLinks: links.length,
        avisos: avisos.length,
        interrompida: interrompida || null
      });

      if (links.length === 0) {
        throw new Error("Nenhum processo encontrado no acervo.");
      }

      // Mesmo com a fase 1 incompleta, vale detalhar o que foi colhido: a fase 2
      // não depende da árvore, e o que já está em mãos não se perde.
      const { erros } = await detalharProcessos(links, advogadoConfig);

      await salvarEstado({
        fase: "concluido",
        concluido_em: new Date().toISOString(),
        avisos,
        erros,
        fase1_completa: !interrompida
      });
      await pjeExtLog("migrador", "fase 2 concluída", { erros: erros.length });

      toast(
        interrompida
          ? `Parcial: ${links.length} processos. ${interrompida}. Rode de novo para completar.`
          : `Migração concluída: ${links.length} processos. Baixe o JSON no popup.`,
        !!interrompida
      );
      chrome.runtime.sendMessage({
        type: "pje-migrador:fim",
        ok: true,
        total: links.length,
        erros,
        avisos,
        interrompida: interrompida || null
      });
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await pjeExtLog("migrador", "falha", { erro: mensagem, stack: erro instanceof Error ? erro.stack : null });
      await salvarEstado({ fase: "erro", erro: mensagem });
      toast(mensagem, true);
      chrome.runtime.sendMessage({ type: "pje-migrador:fim", ok: false, erro: mensagem });
    } finally {
      delete window.__pjeMigradorRodando;
    }
  }

  executar();
})();
