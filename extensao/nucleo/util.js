/**
 * Utilidades compartilhadas por todos os adaptadores.
 */
(function (root) {
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Espera até a condição devolver algo verdadeiro, ou desiste no limite. */
  async function ate(condicao, limite = 20000) {
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

  function normalizar(texto) {
    return (texto || "")
      .replace(/ /g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  const REGEX_CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/;

  /** Sigla do tribunal e grau a partir da URL. Serve para PJe e SEEU. */
  function origemPelaUrl(href) {
    try {
      const url = new URL(href);
      const host = url.hostname;
      const m = host.match(/\b(tj[a-z]{2}|trt\d{1,2}|trf\d{1,2})\b/i);
      const grau = /pje2g|\/2g\//i.test(href) ? "2" : /pje1g|\/1g\//i.test(href) ? "1" : null;
      return { tribunal: m ? m[1].toUpperCase() : null, grau };
    } catch (erro) {
      return { tribunal: null, grau: null };
    }
  }

  /**
   * Busca uma página respeitando a codificação declarada.
   *
   * O SEEU serve ISO-8859-1. Usar response.text() direto corromperia todo
   * acento em silêncio — nome de parte, rótulo, tudo. Por isso a decodificação
   * é explícita, a partir do charset do cabeçalho.
   */
  async function buscarDocumento(url, charsetPadrao = "utf-8") {
    const resposta = await fetch(url, { credentials: "include" });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

    const tipo = resposta.headers.get("content-type") || "";
    const m = tipo.match(/charset=([\w-]+)/i);
    const charset = (m ? m[1] : charsetPadrao).toLowerCase();

    const buffer = await resposta.arrayBuffer();
    const html = new TextDecoder(charset).decode(buffer);
    return new DOMParser().parseFromString(html, "text/html");
  }

  /**
   * Código do tribunal embutido no número CNJ (o par J.TR).
   *
   * Serve para sistemas nacionais como o SEEU, onde o domínio não revela o
   * tribunal. Devolve só o código: traduzir para sigla exigiria a tabela do
   * CNJ, que não foi conferida aqui — e inventar sigla seria pior que omitir.
   */
  function codigoTribunalDoNumero(numero) {
    const m = String(numero || "").match(/\.(\d)\.(\d{2})\./);
    return m ? `${m[1]}.${m[2]}` : null;
  }

  root.PjeExtUtil = {
    esperar, ate, toast, normalizar, origemPelaUrl, buscarDocumento,
    codigoTribunalDoNumero, REGEX_CNJ
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PjeExtUtil;
  }
})(typeof window !== "undefined" ? window : globalThis);
