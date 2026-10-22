/* Extração de texto de arquivos DOCX, XLSX e PDF, inteiramente no navegador.
 * Cada extrator devolve [{location, text}].
 */
(function () {
  const L = (globalThis.LGPD = globalThis.LGPD || {});
  const SUPPORTED = new Set([".docx", ".xlsx", ".pdf"]);
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  const extOf = (name) => {
    const i = name.lastIndexOf(".");
    return i < 0 ? "" : name.slice(i).toLowerCase();
  };

  const parseXml = (s) => new DOMParser().parseFromString(s, "application/xml");
  const kids = (el, tag) => [...el.children].filter((c) => c.localName === tag && c.namespaceURI === W);

  function paraText(p) {
    let out = "";
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === W) {
          if (c.localName === "t") out += c.textContent;
          else if (c.localName === "tab") out += "\t";
          else if (c.localName === "br" || c.localName === "cr") out += "\n";
          else if (c.localName !== "pPr" && c.localName !== "rPr") walk(c);
        } else walk(c);
      }
    };
    walk(p);
    return out;
  }

  async function extractDocx(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const docFile = zip.file("word/document.xml");
    if (!docFile) throw new Error("DOCX inválido");
    const body = parseXml(await docFile.async("string")).getElementsByTagNameNS(W, "body")[0];
    const out = [];
    let pi = 0;
    let ti = 0;
    for (const el of body.children) {
      if (el.namespaceURI !== W) continue;
      if (el.localName === "p") {
        pi++;
        const t = paraText(el);
        if (t.trim()) out.push({ location: `parágrafo ${pi}`, text: t });
      } else if (el.localName === "tbl") {
        ti++;
        kids(el, "tr").forEach((tr, r) => {
          for (const tc of kids(tr, "tc")) {
            const t = kids(tc, "p").map(paraText).join("\n");
            if (t.trim()) out.push({ location: `tabela ${ti}, linha ${r + 1}`, text: t });
          }
        });
      }
    }
    const parts = Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n)).sort();
    let s = 0;
    for (const name of parts) {
      s++;
      const label = name.includes("header") ? "cabeçalho" : "rodapé";
      const doc = parseXml(await zip.file(name).async("string"));
      for (const p of doc.getElementsByTagNameNS(W, "p")) {
        const t = paraText(p);
        if (t.trim()) out.push({ location: `${label} (seção ${s})`, text: t });
      }
    }
    return out;
  }

  async function extractXlsx(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const out = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws || !ws["!ref"]) continue;
      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell || cell.v === undefined || cell.v === null || cell.v === "") continue;
          const text = cell.t === "d" ? cell.w || cell.v.toISOString() : String(cell.v);
          out.push({ location: `planilha '${name}', linha ${r + 1}, coluna ${c + 1}`, text });
        }
      }
    }
    return out;
  }

  async function extractPdf(file) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    } catch (e) {
      if (e && e.name === "PasswordException") throw new Error("PDF protegido por senha");
      throw e;
    }
    const out = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        let text = "";
        for (const it of content.items) text += it.str + (it.hasEOL ? "\n" : "");
        if (text.trim()) out.push({ location: `página ${n}`, text });
        page.cleanup();
      }
    } finally {
      pdf.destroy();
    }
    return out;
  }

  const EXTRACTORS = { ".docx": extractDocx, ".xlsx": extractXlsx, ".pdf": extractPdf };

  const extract = (file) => EXTRACTORS[extOf(file.name)](file);

  Object.assign(L, { SUPPORTED, extOf, extract });
})();
