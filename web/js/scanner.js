/* Varredura de documentos selecionados pelo usuário (nenhum dado sai do navegador). */
(function () {
  const L = globalThis.LGPD;
  const SKIP_DIRS = new Set([
    "windows", "program files", "program files (x86)", "programdata", "appdata", "$recycle.bin",
    "system volume information", "node_modules", ".git", ".venv", "venv", "__pycache__", "site-packages",
  ]);
  const MAX_FILE_BYTES = 200 * 1024 * 1024;

  const relPath = (f) => f.webkitRelativePath || f.name;

  /** Filtra os arquivos suportados, ignorando temporários do Office e pastas de sistema. */
  function listDocuments(files) {
    return [...files].filter((f) => {
      if (f.name.startsWith("~$") || !L.SUPPORTED.has(L.extOf(f.name))) return false;
      const dirs = relPath(f).split("/").slice(0, -1);
      return !dirs.some((d) => SKIP_DIRS.has(d.toLowerCase()));
    });
  }

  async function scanFile(file, patterns = L.PATTERNS, stop = { stopped: false }) {
    const path = relPath(file);
    const result = { path, file, size: file.size, findings: [], error: null };
    if (file.size > MAX_FILE_BYTES) {
      result.error = "arquivo muito grande (ignorado)";
      return result;
    }
    const seen = new Set();
    try {
      for (const { location, text } of await L.extract(file)) {
        if (stop.stopped) {
          result.error = "interrompido";
          break;
        }
        for (const { pat, value } of L.findMatches(text, patterns)) {
          const key = [location, pat.name, value].join("\0");
          if (seen.has(key)) continue;
          seen.add(key);
          result.findings.push({
            file: path, location, pattern: pat.name, category: pat.category, risk: pat.risk,
            masked: L.mask(value, pat.name),
          });
        }
      }
    } catch (e) {
      result.error = `${(e && e.name) || "Error"}: ${(e && e.message) || e}`;
    }
    return result;
  }

  async function scan(files, { onFile, onResult, stop = { stopped: false }, patterns = L.PATTERNS } = {}) {
    let count = 0;
    for (const file of listDocuments(files)) {
      if (stop.stopped) break;
      if (onFile) onFile(file);
      await new Promise((r) => setTimeout(r)); // deixa a interface respirar
      const res = await scanFile(file, patterns, stop);
      if (stop.stopped && res.error === "interrompido") break;
      count++;
      if (onResult) onResult(res);
    }
    return count;
  }

  function csvField(v) {
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCsv(findings) {
    const rows = [["Arquivo", "Localização", "Tipo de dado", "Categoria", "Risco", "Valor (mascarado)"]];
    for (const x of findings) rows.push([x.file, x.location, x.pattern, x.category, x.risk, x.masked]);
    return "\ufeff" + rows.map((r) => r.map(csvField).join(";")).join("\r\n") + "\r\n";
  }

  Object.assign(L, { listDocuments, scanFile, scan, exportCsv, relPath });
})();
