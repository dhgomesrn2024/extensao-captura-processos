/**
 * Registro de adaptadores.
 *
 * Um adaptador ensina o migrador a lidar com um sistema (PJe, SEEU…). O
 * núcleo não sabe nada de árvore de comarcas, frameset ou codificação — isso
 * é responsabilidade de quem conhece a página.
 *
 * Contrato:
 *
 *   id                  identificador curto, vai no campo `fonte` do registro
 *   nome                nome legível
 *   detecta(url)        esta aba é deste sistema?
 *   pagina              onde o usuário precisa estar, para a mensagem de erro
 *   coletar(ctx)        fase 1 — devolve { links, avisos, interrompida }
 *   buscarDetalhe(link) devolve um Document já decodificado
 *   parsear(doc, cfg, url)  devolve o registro do processo
 *
 * Cada `link` precisa ter ao menos { numero_processo, url_detalhe }.
 */
(function (root) {
  const registrados = [];

  function registrar(adaptador) {
    const faltando = ["id", "nome", "detecta", "coletar", "buscarDetalhe", "parsear"].filter(
      (c) => !adaptador[c]
    );
    if (faltando.length) {
      throw new Error(`adaptador "${adaptador.id || "?"}" sem: ${faltando.join(", ")}`);
    }
    registrados.push(adaptador);
    return adaptador;
  }

  function paraUrl(url) {
    return registrados.find((a) => {
      try {
        return a.detecta(url);
      } catch (erro) {
        return false;
      }
    }) || null;
  }

  function listar() {
    return registrados.map((a) => ({ id: a.id, nome: a.nome, pagina: a.pagina || null }));
  }

  root.PjeExtAdaptadores = { registrar, paraUrl, listar };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PjeExtAdaptadores;
  }
})(typeof window !== "undefined" ? window : globalThis);
