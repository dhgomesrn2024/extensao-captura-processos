const oabNumeroInput = document.getElementById("oabNumero");
const oabUfInput = document.getElementById("oabUf");
const statusEl = document.getElementById("status");
const avisosEl = document.getElementById("avisos");
const revisarEl = document.getElementById("revisar");
const contadorEl = document.getElementById("contador");
const progressoEl = document.getElementById("progresso");
const migrarButton = document.getElementById("migrar");

async function carregarConfig() {
  const { advogadoConfig } = await chrome.storage.local.get("advogadoConfig");
  if (advogadoConfig) {
    oabNumeroInput.value = advogadoConfig.oabNumero || "";
    oabUfInput.value = advogadoConfig.oabUf || "";
  }
}

async function salvarConfig() {
  await chrome.storage.local.set({
    advogadoConfig: {
      oabNumero: oabNumeroInput.value.trim(),
      oabUf: oabUfInput.value.trim().toUpperCase()
    }
  });
}

async function processosSalvos() {
  const { processos } = await chrome.storage.local.get("processos");
  return processos || {};
}

function pintarProgresso(estado) {
  if (!estado) return;

  if (estado.fase === "colhendo") {
    const pct = estado.total_comarcas ? (estado.comarca_atual / estado.total_comarcas) * 50 : 0;
    progressoEl.style.width = `${pct}%`;
    statusEl.textContent = `Fase 1/2 — percorrendo comarcas (${estado.comarca_atual || 0}/${estado.total_comarcas || "?"}), ${(estado.links || []).length} processos localizados.`;
  } else if (estado.fase === "detalhando") {
    const pct = estado.total_links ? 50 + (estado.detalhados / estado.total_links) * 50 : 50;
    progressoEl.style.width = `${pct}%`;
    statusEl.textContent = `Fase 2/2 — baixando processos (${estado.detalhados || 0}/${estado.total_links || "?"}).`;
  } else if (estado.fase === "concluido") {
    progressoEl.style.width = "100%";
    statusEl.textContent =
      estado.fase1_completa === false
        ? "Concluída em parte: a coleta não fechou. Recarregue o painel e rode de novo."
        : "Migração concluída. Baixe o JSON.";
    migrarButton.disabled = false;
  } else if (estado.fase === "erro") {
    statusEl.textContent = estado.erro || "Falhou.";
    migrarButton.disabled = false;
  }

  const avisos = estado.avisos || [];
  const erros = estado.erros || [];
  const partes = [];
  if (avisos.length) partes.push(`${avisos.length} aviso(s) de completude`);
  if (erros.length) partes.push(`${erros.length} processo(s) com erro`);
  avisosEl.textContent = partes.join(" · ");
}

async function atualizarTela() {
  const mapa = await processosSalvos();
  const itens = Object.values(mapa);
  contadorEl.textContent = String(itens.length);

  const comFalha = itens.filter(
    (p) =>
      p.diagnostico &&
      ["nao_interpretado", "secao_ausente", "parte_sem_papel"].some(
        (st) => p.diagnostico.polo_ativo.status === st || p.diagnostico.polo_passivo.status === st
      )
  ).length;
  revisarEl.textContent = comFalha ? `${comFalha} processo(s) com polo a conferir` : "";

  const { migracao } = await chrome.storage.local.get("migracao");
  pintarProgresso(migracao);
}

async function migrar() {
  await salvarConfig();
  migrarButton.disabled = true;
  statusEl.textContent = "Iniciando...";
  progressoEl.style.width = "0";

  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!aba || !aba.id) {
    statusEl.textContent = "Não encontrei a aba ativa.";
    migrarButton.disabled = false;
    return;
  }

  // Qual sistema é, quem decide é o adaptador — o popup só barra o que nem
  // dá para injetar (páginas internas do Chrome).
  if (!/^https?:/i.test(aba.url || "")) {
    statusEl.textContent = "Abra o sistema do tribunal (PJe ou SEEU) nesta aba primeiro.";
    migrarButton.disabled = false;
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      files: [
        "nucleo/logger.js",
        "nucleo/util.js",
        "nucleo/estado.js",
        "nucleo/adaptadores.js",
        "adaptadores/pje/parser.js",
        "adaptadores/pje/coletor.js",
        "adaptadores/seeu/parser.js",
        "adaptadores/seeu/coletor.js",
        "nucleo/migrador.js"
      ]
    });
    statusEl.textContent = "Migração em andamento na aba do PJe. Pode fechar este popup.";
    await pjeExtLog("popup", "migrador injetado", { tabId: aba.id });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    statusEl.textContent = `Falha ao iniciar: ${mensagem}`;
    await pjeExtLog("popup", "falha ao injetar migrador", { erro: mensagem });
    migrarButton.disabled = false;
  }
}

async function baixar(nome, dados) {
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function baixarProcessos() {
  const mapa = await processosSalvos();
  const itens = Object.values(mapa);

  if (!itens.length) {
    statusEl.textContent = "Nada capturado ainda.";
    return;
  }

  const { migracao } = await chrome.storage.local.get("migracao");

  // Duas naturezas diferentes, separadas de propósito: dado faltando é problema,
  // rótulo estranho não é. Misturar os dois faz a lista parecer pior do que é.
  const resumo = (p) => ({
    numero_processo: p.numero_processo,
    classe: p.classe,
    grau: p.grau,
    polo_ativo: p.diagnostico.polo_ativo.status,
    polo_passivo: p.diagnostico.polo_passivo.status,
    papeis_incomuns: p.diagnostico.papeis_incomuns || []
  });

  const problemaDeLeitura = (p) =>
    ["nao_interpretado", "secao_ausente", "parte_sem_papel"].includes(p.diagnostico.polo_ativo.status) ||
    ["nao_interpretado", "secao_ausente", "parte_sem_papel"].includes(p.diagnostico.polo_passivo.status);

  const comDiag = itens.filter((p) => p.diagnostico);
  const revisar = comDiag.filter(problemaDeLeitura).map(resumo);
  const soRotulo = comDiag
    .filter((p) => !problemaDeLeitura(p) && (p.diagnostico.papeis_incomuns || []).length)
    .map(resumo);

  const semCliente = itens.filter((p) => !(p.clientes || []).length).map((p) => p.numero_processo);

  const graus = [...new Set(itens.map((p) => p.grau).filter(Boolean))].sort();
  const sufixoGrau = graus.length === 1 ? `-${graus[0]}g` : graus.length ? `-${graus.join("e")}g` : "";

  await baixar(`pje-acervo${sufixoGrau}-${new Date().toISOString().slice(0, 10)}.json`, {
    gerado_em: new Date().toISOString(),
    total: itens.length,
    graus,
    total_por_grau: graus.reduce((acc, g) => Object.assign(acc, { [g]: itens.filter((p) => p.grau === g).length }), {}),
    coleta_completa: !migracao || migracao.fase1_completa !== false,
    comarcas_concluidas: (migracao && migracao.comarcas_concluidas) || [],
    avisos: (migracao && migracao.avisos) || [],
    erros: (migracao && migracao.erros) || [],
    revisar_manualmente: revisar,
    apenas_rotulo_incomum: soRotulo,
    sem_cliente_identificado: semCliente,
    processos: itens
  });
}

async function limparBase() {
  await chrome.storage.local.set({ processos: {}, migracao: null });
  statusEl.textContent = "Base limpa.";
  progressoEl.style.width = "0";
  avisosEl.textContent = "";
  atualizarTela();
}

async function baixarLog() {
  const { debugLog } = await chrome.storage.local.get("debugLog");
  if (!debugLog || !debugLog.length) {
    statusEl.textContent = "Nenhum log registrado.";
    return;
  }
  await baixar(`pje-extension-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, debugLog);
}

async function limparLog() {
  await chrome.storage.local.set({ debugLog: [] });
  statusEl.textContent = "Log limpo.";
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "pje-migrador:progresso") {
    pintarProgresso(msg.estado);
    atualizarTela();
  }
  if (msg && msg.type === "pje-migrador:fim") {
    migrarButton.disabled = false;
    atualizarTela();
  }
});

migrarButton.addEventListener("click", migrar);
document.getElementById("baixar").addEventListener("click", baixarProcessos);
document.getElementById("limpar").addEventListener("click", limparBase);
document.getElementById("baixarLog").addEventListener("click", baixarLog);
document.getElementById("limparLog").addEventListener("click", limparLog);
oabNumeroInput.addEventListener("change", salvarConfig);
oabUfInput.addEventListener("change", salvarConfig);

function mostrarVersao() {
  const ext = chrome.runtime.getManifest().version;
  const parser = typeof PjeParser !== "undefined" ? PjeParser.VERSAO_PARSER : "?";
  document.getElementById("versao").textContent = `extensão ${ext} · parser v${parser}`;
}

mostrarVersao();
carregarConfig();
atualizarTela();
setInterval(atualizarTela, 1500);
