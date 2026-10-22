/* Sanitização LGPD reversível: gera um .md com dados parcialmente ocultos e permite restaurá-los.
 *
 * Cada dado vira um marcador `[[TIPO-N: valor parcialmente oculto]]`. O dado original fica num
 * arquivo de mapeamento (`<nome>.md.lgpd-map.json`) que NÃO deve ser enviado ao LLM.
 */
(function () {
  const L = globalThis.LGPD;
  const MAP_SUFFIX = ".lgpd-map.json";
  const RESTORED_SUFFIX = "_restaurado";

  const CODES = {
    CPF: "CPF", CNPJ: "CNPJ", RG: "RG", CNH: "CNH", Telefone: "TEL",
    "Endereço residencial": "END", "Valor monetário": "VALOR", "E-mail": "EMAIL", CEP: "CEP",
  };
  const TOKEN_RE = /\[\[([A-Z]+-\d+):[^\]]*\]\]/g;

  const code = (pat) => CODES[pat.name] || (pat.category === L.SENSIVEL ? "SENSIVEL" : "DADO");

  function maskDigits(v, keep) {
    const total = (v.match(/\d/g) || []).length;
    let seen = 0;
    return [...v].map((ch) => (/\d/.test(ch) ? (++seen > total - keep ? ch : "*") : ch)).join("");
  }

  function maskWords(v, keepFirst = 1) {
    return v.split(/\s+/).filter(Boolean).map((w, i) => (i < keepFirst ? w : "*".repeat([...w].length))).join(" ");
  }

  /** Oculta parcialmente o valor mantendo o formato, sem truncar o texto. */
  function partialMask(value, pat) {
    const v = value.trim();
    const chars = [...v];
    if (pat.name === "E-mail") {
      const i = v.indexOf("@");
      return `${v.slice(0, 1)}***@${i < 0 ? "" : v.slice(i + 1)}`;
    }
    if (["CPF", "CNPJ", "RG", "CNH", "PIS/PASEP/NIT", "Telefone", "CEP"].includes(pat.name))
      return maskDigits(v, pat.name !== "Telefone" ? 2 : 4);
    if (pat.name === "Cartão de crédito") return maskDigits(v, 4);
    if (pat.name === "Valor monetário") return v.replace(/\d/g, "*");
    if (pat.name === "Endereço residencial") return maskWords(v, 1).replace(/\d/g, "*");
    if (pat.category === L.SENSIVEL)
      return /\s/.test(v) ? maskWords(v, 1) : chars[0] + "*".repeat(chars.length - 1);
    if (chars.length <= 4) return "*".repeat(chars.length);
    return chars.slice(0, 2).join("") + "*".repeat(chars.length - 4) + chars.slice(-2).join("");
  }

  /** Substitui as ocorrências por marcadores; `mapping` (id -> original) e `counter` ({n}) são atualizados. */
  function sanitizeText(text, mapping, counter, patterns = L.PATTERNS) {
    const spans = L.findMatches(text, patterns).map((m) => ({ ...m, end: m.start + m.value.length }));
    spans.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const reverse = new Map();
    for (const [tid, orig] of Object.entries(mapping)) reverse.set(tid.slice(0, tid.lastIndexOf("-")) + "\0" + orig, tid);
    let out = "";
    let pos = 0;
    for (const { start, end, pat, value } of spans) {
      if (start < pos) continue; // sobreposição com um dado já tratado
      const c = code(pat);
      const key = c + "\0" + value;
      let tid = reverse.get(key);
      if (!tid) {
        counter.n += 1;
        tid = `${c}-${counter.n}`;
        mapping[tid] = value;
        reverse.set(key, tid);
      }
      const masked = partialMask(value, pat).replace(/\]/g, "*").replace(/\n/g, " ");
      out += text.slice(pos, start) + `[[${tid}: ${masked}]]`;
      pos = end;
    }
    return out + text.slice(pos);
  }

  /** Gera o conteúdo .md e o mapa de reversão a partir de [{location, text}]. */
  function sanitizeSegments(fileName, segments, patterns = L.PATTERNS) {
    const mapping = {};
    const counter = { n: 0 };
    const lines = [`# ${fileName}`, ""];
    for (const { location, text } of segments) {
      const clean = sanitizeText(text, mapping, counter, patterns).trim();
      if (!clean) continue;
      if (location.startsWith("parágrafo")) lines.push(clean, "");
      else lines.push(`**[${location}]** ${clean}`, "");
    }
    return {
      md: lines.join("\n"),
      mapJson: JSON.stringify({ source: fileName, mapping }, null, 2),
      count: Object.keys(mapping).length,
    };
  }

  function restoreText(text, mapping) {
    let count = 0;
    const restored = text.replace(TOKEN_RE, (m, id) => {
      const original = Object.prototype.hasOwnProperty.call(mapping, id) ? mapping[id] : undefined;
      if (original === undefined) return m;
      count += 1;
      return original;
    });
    return { text: restored, count };
  }

  Object.assign(L, { MAP_SUFFIX, RESTORED_SUFFIX, partialMask, sanitizeText, sanitizeSegments, restoreText });
})();
