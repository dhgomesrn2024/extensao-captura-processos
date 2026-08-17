/**
 * Preparo do JSON antes de sair da máquina.
 *
 * Vive fora do popup porque são garantias, não detalhe de interface: um token
 * de sessão vazando ou um histórico sumindo em silêncio são defeitos sérios, e
 * defeito sério merece teste.
 */
(function (root) {
  /**
   * Remove token de sessão de qualquer texto, em qualquer nível.
   *
   * O parser já limpa as células, mas o export é o ponto por onde tudo passa —
   * e um token viajando dentro de um arquivo destinado a outro sistema é
   * problema de segurança, não de qualidade de dado. Já aconteceu: 192
   * ocorrências de `_tj` num único acervo do SEEU.
   */
  function semSegredos(valor) {
    if (typeof valor === "string") {
      // O ponto e vírgula importa: o Java reescreve a sessão como
      // ";jsessionid=ABC", e não como parâmetro de consulta. Sem ele na lista,
      // a sessão do PJe atravessaria o filtro inteiro.
      return valor.replace(/[?&;](_tj|jsessionid|ca)=[^"'\s&;]*/gi, "");
    }
    if (Array.isArray(valor)) return valor.map(semSegredos);
    if (valor && typeof valor === "object") {
      return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, semSegredos(v)]));
    }
    return valor;
  }

  /**
   * Tira as movimentações de um registro.
   *
   * O histórico sai, mas o registro de que ele existe fica: omitir calado
   * faria um processo movimentado parecer parado. Registro sem movimentações
   * — como os do PJe — passa intacto.
   */
  function semMovimentos(processo) {
    if (!processo || !Array.isArray(processo.movimentos)) return processo;

    const copia = Object.assign({}, processo);
    const quantidade = copia.movimentos.length;
    delete copia.movimentos;

    copia.movimentos_omitidos = true;
    copia.qtd_movimentos = quantidade;
    return copia;
  }

  function contarMovimentos(itens) {
    return (itens || []).reduce(
      (total, p) => total + (p && Array.isArray(p.movimentos) ? p.movimentos.length : 0),
      0
    );
  }

  /** Aplica a escolha do advogado e as garantias, nessa ordem. */
  function prepararProcessos(itens, incluirMovimentos) {
    const ajustados = incluirMovimentos ? itens : (itens || []).map(semMovimentos);
    return semSegredos(ajustados);
  }

  root.PjeExtExportacao = { semSegredos, semMovimentos, contarMovimentos, prepararProcessos };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PjeExtExportacao;
  }
})(typeof window !== "undefined" ? window : globalThis);
