/**
 * Estado da migração e acesso ao armazenamento.
 *
 * Tudo é gravado a cada passo: o popup pode ser fechado, e uma execução
 * interrompida retoma de onde parou.
 */
(function (root) {
  /**
   * Chave do registro.
   *
   * O número CNJ não basta: uma apelação no 2º grau conserva o número do
   * processo de origem, e o mesmo número pode existir em PJe e SEEU. Fonte,
   * grau e número mantêm os três separados.
   */
  function chaveDoProcesso(fonte, grau, numero) {
    return `${fonte || "?"}:${grau || "?"}:${numero}`;
  }

  async function lerEstado() {
    const { migracao } = await chrome.storage.local.get("migracao");
    return migracao || null;
  }

  async function salvarEstado(patch) {
    const atual = await lerEstado();
    const novo = Object.assign({}, atual || {}, patch);
    await chrome.storage.local.set({ migracao: novo });
    chrome.runtime.sendMessage({ type: "pje-migrador:progresso", estado: novo });
    return novo;
  }

  async function lerProcessos() {
    const { processos } = await chrome.storage.local.get("processos");
    return processos || {};
  }

  async function salvarProcessos(mapa) {
    await chrome.storage.local.set({ processos: mapa });
  }

  async function lerConfig() {
    const { advogadoConfig } = await chrome.storage.local.get("advogadoConfig");
    return advogadoConfig || null;
  }

  root.PjeExtEstado = {
    chaveDoProcesso,
    lerEstado,
    salvarEstado,
    lerProcessos,
    salvarProcessos,
    lerConfig
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PjeExtEstado;
  }
})(typeof window !== "undefined" ? window : globalThis);
