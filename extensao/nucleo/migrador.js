/**
 * Migrador — orquestra as duas fases, sem saber de que sistema se trata.
 *
 *   Fase 1  o adaptador percorre a listagem e colhe as URLs de detalhe
 *   Fase 2  o núcleo busca cada URL e manda o adaptador interpretar
 *
 * A fase 2 é genérica de propósito: buscar e guardar é igual em todo sistema.
 * O que varia — navegação, codificação, vocabulário — fica no adaptador.
 */
(() => {
  if (window.__pjeMigradorRodando) {
    console.log("[PJE-EXT] Migração já está em andamento nesta aba.");
    return;
  }

  window.__pjeMigradorRodando = true;

  const { esperar, toast } = PjeExtUtil;
  const { chaveDoProcesso, lerEstado, salvarEstado, lerProcessos, salvarProcessos, lerConfig } = PjeExtEstado;

  const PAUSA_ENTRE_FETCHES_MS = 400;

  /** Fase 2: busca e interpreta cada processo colhido. */
  async function detalharProcessos(adaptador, links, config) {
    const mapa = await lerProcessos();
    const erros = [];

    for (let i = 0; i < links.length; i += 1) {
      const link = links[i];
      const chave = chaveDoProcesso(adaptador.id, link.grau, link.numero_processo);
      const jaSalvo = mapa[chave];

      // Só pula o que já foi extraído pela versão atual do parser: corrigir o
      // parser precisa refazer os registros antigos, não herdá-los.
      if (jaSalvo && jaSalvo.classe && jaSalvo.parser_versao === adaptador.parserVersao) {
        continue;
      }

      toast(`Detalhando ${i + 1}/${links.length}: ${link.numero_processo}`);

      try {
        const doc = await adaptador.buscarDetalhe(link);
        const dados = adaptador.parsear(doc, config, link.url_detalhe, link);
        mapa[chaveDoProcesso(adaptador.id, dados.grau || link.grau, link.numero_processo)] = Object.assign(
          { comarca: link.comarca || null },
          dados
        );
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        erros.push({ numero_processo: link.numero_processo, erro: mensagem });
        mapa[chave] = {
          numero_processo: link.numero_processo,
          comarca: link.comarca || null,
          fonte: adaptador.id,
          grau: link.grau || null,
          erro: mensagem,
          extraido_em: new Date().toISOString()
        };
      }

      await salvarProcessos(mapa);
      await salvarEstado({ fase: "detalhando", detalhados: i + 1, total_links: links.length, erros });
      await esperar(PAUSA_ENTRE_FETCHES_MS);
    }

    return { total: Object.keys(mapa).length, erros };
  }

  async function executar() {
    try {
      const adaptador = PjeExtAdaptadores.paraUrl(location.href);

      if (!adaptador) {
        const onde = PjeExtAdaptadores.listar()
          .map((a) => a.pagina || a.nome)
          .join(" ou ");
        throw new Error(`Esta página não é reconhecida. Abra ${onde}.`);
      }

      await pjeExtLog("migrador", "início", { url: location.href, adaptador: adaptador.id });

      const config = await lerConfig();

      // Sem OAB, nenhum cliente é identificado — e a migração terminaria com
      // centenas de registros silenciosamente vazios no campo que mais importa.
      // Já aconteceu: uma reinstalação apagou a configuração e a corrida
      // produziu 20 processos com zero clientes, sem um único aviso.
      if (!config || !String(config.oabNumero || "").trim()) {
        throw new Error("Informe a OAB no popup antes de migrar — sem ela nenhum cliente é identificado.");
      }

      const contexto = { salvarEstado, lerEstado, toast, log: pjeExtLog };

      const { links, avisos, interrompida, completa } = await adaptador.coletar(contexto);

      // A completude é do adaptador: só ele sabe quantos processos deveriam
      // existir. Antes o núcleo sobrescrevia com !interrompida, e o envelope
      // dizia "coleta completa" enquanto o aviso dizia 26 de 48.
      const coletaCompleta = completa !== false && !interrompida;

      await pjeExtLog("migrador", "fase 1 encerrada", {
        adaptador: adaptador.id,
        qtdLinks: links.length,
        avisos: avisos.length,
        completa: coletaCompleta,
        interrompida: interrompida || null
      });

      if (links.length === 0) {
        throw new Error("Nenhum processo encontrado.");
      }

      // Mesmo com a fase 1 incompleta, vale detalhar o que foi colhido: a fase 2
      // não depende da navegação, e o que já está em mãos não se perde.
      const { erros } = await detalharProcessos(adaptador, links, config);

      await salvarEstado({
        fase: "concluido",
        concluido_em: new Date().toISOString(),
        avisos,
        erros,
        fase1_completa: coletaCompleta
      });
      await pjeExtLog("migrador", "fase 2 concluída", { erros: erros.length });

      toast(
        coletaCompleta
          ? `Migração concluída: ${links.length} processos. Baixe o JSON no popup.`
          : `Parcial: ${links.length} processos. ${interrompida || "a coleta não fechou"}. Confira os avisos no JSON.`,
        !coletaCompleta
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
