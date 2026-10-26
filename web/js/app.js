(function () {
  const L = globalThis.LGPD;
  const $ = (id) => document.getElementById(id);
  const RISK_ORDER = { Alto: 0, Médio: 1, Baixo: 2 };

  let files = []; // arquivos escolhidos
  let selectedFiles = new Set();
  let findings = [];
  let results = [];
  let nFiles = 0;
  let running = false;
  let stop = { stopped: false };

  const setStatus = (t) => ($("status").textContent = t);

  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // ---- arquivos ----
  function addFiles(list) {
    const known = new Set(files.map(L.relPath));
    for (const f of L.listDocuments(list)) {
      if (!known.has(L.relPath(f))) {
        files.push(f);
        known.add(L.relPath(f));
      }
    }
    renderFiles();
  }

  function renderFiles() {
    const ul = $("file-list");
    ul.replaceChildren();
    for (const f of files) {
      const li = document.createElement("li");
      li.textContent = L.relPath(f);
      if (selectedFiles.has(f)) li.classList.add("sel");
      li.onclick = () => {
        selectedFiles.has(f) ? selectedFiles.delete(f) : selectedFiles.add(f);
        renderFiles();
      };
      ul.appendChild(li);
    }
    $("count-files").textContent = `${files.length} documento(s)`;
  }

  $("in-files").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
  $("in-folder").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
  $("btn-remove").onclick = () => {
    files = files.filter((f) => !selectedFiles.has(f));
    selectedFiles.clear();
    renderFiles();
  };

  const dz = $("dropzone");
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = async (e) => {
    e.preventDefault();
    dz.classList.remove("over");
    const out = [];
    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const f = await new Promise((res, rej) => entry.file(res, rej));
        Object.defineProperty(f, "webkitRelativePath", { value: prefix + f.name });
        out.push(f);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          for (const c of batch) await walk(c, prefix + entry.name + "/");
        }
      }
    };
    const items = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (items.length) for (const it of items) await walk(it, "");
    else out.push(...e.dataTransfer.files);
    addFiles(out);
  };

  // ---- tabelas ----
  function addRow(tbody, cells, cls) {
    const tr = document.createElement("tr");
    if (cls) tr.className = cls;
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
    return tr;
  }

  function sortTable(table, idx) {
    const tb = table.tBodies[0];
    const rows = [...tb.rows];
    const dir = table.dataset.sort === String(idx) ? -1 : 1;
    table.dataset.sort = dir === 1 ? String(idx) : "";
    const val = (r) => r.cells[idx].textContent;
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      const nx = parseFloat(x), ny = parseFloat(y);
      const c = !isNaN(nx) && !isNaN(ny) ? nx - ny : x.toLowerCase().localeCompare(y.toLowerCase());
      return c * dir;
    });
    rows.forEach((r) => tb.appendChild(r));
  }
  for (const t of document.querySelectorAll("table"))
    t.tHead.querySelectorAll("th").forEach((th, i) => (th.onclick = () => sortTable(t, i)));

  for (const b of document.querySelectorAll(".tab"))
    b.onclick = () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
      for (const k of ["find", "docs", "about"]) $("tab-" + k).hidden = k !== b.dataset.tab;
    };

  $("tbl-docs").tBodies[0].onclick = (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) {
      for (const r of $("tbl-docs").tBodies[0].rows) if (r !== tr) r.classList.remove("sel");
    }
    tr.classList.toggle("sel");
  };

  // ---- varredura ----
  function addResult(r) {
    nFiles++;
    results.push(r);
    const name = r.path.split("/").pop();
    let status = "Nenhum dado encontrado";
    let cls = "";
    if (r.error) [status, cls] = [`Erro: ${r.error}`, "erro"];
    else if (r.findings.length) [status, cls] = ["Dados pessoais encontrados", "sens"];
    const tr = addRow($("tbl-docs").tBodies[0],
      [name, L.extOf(name).slice(1), (r.size / 1024).toFixed(1), r.findings.length, status, r.path], cls);
    tr.dataset.path = r.path;
    for (const f of [...r.findings].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk])) {
      findings.push(f);
      addRow($("tbl-find").tBodies[0], [f.risk, f.pattern, f.category, f.masked, f.location, f.file], f.risk);
    }
  }

  function clearResults() {
    if (running) return;
    for (const t of ["tbl-find", "tbl-docs"]) $(t).tBodies[0].replaceChildren();
    findings = [];
    results = [];
    nFiles = 0;
    setStatus("Pronto.");
  }

  $("btn-start").onclick = async () => {
    if (!files.length) return alert("Adicione ao menos um documento ou pasta.");
    clearResults();
    stop = { stopped: false };
    running = true;
    $("btn-start").disabled = true;
    $("btn-stop").disabled = false;
    $("progress").hidden = false;
    try {
      await L.scan(files, {
        stop,
        onFile: (f) => setStatus(`Analisando: ${L.relPath(f)}`),
        onResult: addResult,
      });
    } finally {
      running = false;
      $("progress").hidden = true;
      $("btn-start").disabled = false;
      $("btn-stop").disabled = true;
    }
    if (stop.stopped) return setStatus(`Varredura interrompida: ${nFiles} documento(s) analisado(s).`);
    const withData = new Set(findings.map((f) => f.file)).size;
    setStatus(`Concluído: ${nFiles} documento(s) analisado(s), ${withData} com dados pessoais, ${findings.length} ocorrência(s).`);
  };
  $("btn-stop").onclick = () => { stop.stopped = true; setStatus("Interrompendo…"); };
  $("btn-clear").onclick = clearResults;

  $("btn-export").onclick = () => {
    if (!findings.length) return alert("Não há resultados para exportar.");
    download("relatorio_lgpd.csv", L.exportCsv(findings), "text/csv;charset=utf-8");
  };

  // ---- sanitização / reversão ----
  $("btn-sanitize").onclick = async () => {
    if (running) return alert("Aguarde o fim da varredura.");
    const sel = new Set([...$("tbl-docs").tBodies[0].querySelectorAll("tr.sel")].map((r) => r.dataset.path));
    const withData = new Set(findings.map((f) => f.file));
    const paths = sel.size ? sel : withData;
    const targets = files.filter((f) => paths.has(L.relPath(f)));
    if (!targets.length) return alert("Não há documentos com dados pessoais.");

    const zip = new JSZip();
    const used = new Set();
    const done = [], errors = [];
    for (const f of targets) {
      try {
        const rel = L.relPath(f);
        const slash = rel.lastIndexOf("/") + 1;
        let base = rel.slice(0, slash) + f.name.replace(/\.[^.]*$/, "");
        if (used.has(base.toLowerCase())) base = rel.slice(0, slash) + f.name; // evita colisão a.docx / a.pdf
        used.add(base.toLowerCase());
        const { md, mapJson, count } = L.sanitizeSegments(f.name, await L.extract(f));
        zip.file(base + ".md", md);
        zip.file(base + ".md" + L.MAP_SUFFIX, mapJson);
        done.push(`${f.name}: ${count} dado(s)`);
      } catch (e) {
        errors.push(`${f.name}: ${e.message || e}`);
      }
    }
    if (done.length) download("lgpd_sanitizados.zip", await zip.generateAsync({ type: "blob" }));
    let msg = `${done.length} arquivo(s) .md gerado(s) no ZIP baixado.\n`;
    msg += "Envie ao LLM apenas o .md; mantenha o arquivo .lgpd-map.json em local seguro (contém os dados originais).";
    if (errors.length) msg += "\n\nErros:\n" + errors.slice(0, 10).join("\n");
    alert(msg);
  };

  $("in-restore").onchange = async (e) => {
    const picked = [...e.target.files];
    e.target.value = "";
    const md = picked.find((f) => /\.md$/i.test(f.name));
    let map = picked.find((f) => f.name.toLowerCase().endsWith(L.MAP_SUFFIX)) || picked.find((f) => /\.json$/i.test(f.name));
    if (!md || !map) return alert("Selecione juntos o arquivo .md e o arquivo de mapeamento (.lgpd-map.json).");
    try {
      const mapping = JSON.parse(await map.text()).mapping;
      if (!mapping || typeof mapping !== "object") throw new Error("mapa inválido");
      const { text, count } = L.restoreText(await md.text(), mapping);
      let stem = md.name.replace(/\.md$/i, "");
      if (stem.endsWith(L.RESTORED_SUFFIX)) stem = stem.slice(0, -L.RESTORED_SUFFIX.length);
      download(stem + L.RESTORED_SUFFIX + ".md", text, "text/markdown;charset=utf-8");
      alert(`${count} dado(s) restaurado(s).`);
    } catch (err) {
      alert(`Falha ao reverter: ${err.message || err}`);
    }
  };
})();
