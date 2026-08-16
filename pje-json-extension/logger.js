(function (root) {
  const STORAGE_KEY = "debugLog";
  const MAX_ENTRIES = 300;

  function safeSerialize(data) {
    try {
      return JSON.parse(JSON.stringify(data));
    } catch (error) {
      return String(data);
    }
  }

  async function pjeExtLog(source, message, data) {
    const entry = {
      ts: new Date().toISOString(),
      source,
      message,
      data: data === undefined ? null : safeSerialize(data)
    };

    console.log(`[PJE-EXT][${source}] ${message}`, data !== undefined ? data : "");

    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const log = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
      log.push(entry);

      while (log.length > MAX_ENTRIES) {
        log.shift();
      }

      await chrome.storage.local.set({ [STORAGE_KEY]: log });
    } catch (error) {
      console.error("[PJE-EXT] Falha ao gravar log.", error);
    }
  }

  root.pjeExtLog = pjeExtLog;
})(typeof window !== "undefined" ? window : globalThis);
