/* Padrões REGEX e validadores para identificação de dados pessoais (LGPD). Roda 100% no navegador. */
(function () {
  const L = (globalThis.LGPD = globalThis.LGPD || {});

  const PESSOAL = "Dado pessoal";
  const SENSIVEL = "Dado pessoal sensível (art. 5º, II)";

  const digits = (s) => s.replace(/\D/g, "");
  const allSame = (d) => d === d[0].repeat(d.length);

  function validCpf(s) {
    const d = digits(s);
    if (d.length !== 11 || allSame(d)) return false;
    for (const n of [9, 10]) {
      let soma = 0;
      for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
      if (((soma * 10) % 11) % 10 !== Number(d[n])) return false;
    }
    return true;
  }

  function validCnpj(s) {
    const d = digits(s);
    if (d.length !== 14 || allSame(d)) return false;
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [6, ...p1];
    for (const [pesos, pos] of [[p1, 12], [p2, 13]]) {
      let soma = 0;
      pesos.forEach((p, i) => (soma += Number(d[i]) * p));
      const r = soma % 11;
      if ((r < 2 ? 0 : 11 - r) !== Number(d[pos])) return false;
    }
    return true;
  }

  function validPis(s) {
    const d = digits(s);
    if (d.length !== 11 || allSame(d)) return false;
    const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    pesos.forEach((p, i) => (soma += Number(d[i]) * p));
    const r = 11 - (soma % 11);
    return (r >= 10 ? 0 : r) === Number(d[10]);
  }

  function validLuhn(s) {
    const d = digits(s);
    if (d.length < 13 || d.length > 19 || allSame(d)) return false;
    let total = 0;
    [...d].reverse().forEach((ch, i) => {
      let n = Number(ch);
      if (i % 2) n = n > 4 ? n * 2 - 9 : n * 2;
      total += n;
    });
    return total % 10 === 0;
  }

  function validDate(s) {
    const m = /^(\d{2})[/.-](\d{2})[/.-](\d{4})/.exec(s);
    if (!m) return false;
    const [dia, mes, ano] = m.slice(1).map(Number);
    return dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 1900 && ano <= 2100;
  }

  // 11 dígitos sem formatação que formam um CPF válido são tratados como CPF
  const validPhone = (s) => !(/^\d+$/.test(s) && validCpf(s));

  function validIpv4(s) {
    const parts = s.split(".");
    return (
      parts.length === 4 &&
      parts.every((p) => /^\d+$/.test(p) && Number(p) <= 255) &&
      s !== "0.0.0.0" &&
      s !== "127.0.0.1"
    );
  }

  // \w do Python é Unicode; em JS é ASCII. Converte \w para classes Unicode (flag "u").
  function unicodeWord(src) {
    let out = "";
    let inClass = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === "\\") {
        const nx = src[i + 1];
        if (nx === "w") out += inClass ? "\\p{L}\\p{N}_" : "[\\p{L}\\p{N}_]";
        else out += ch + nx;
        i++;
        continue;
      }
      if (ch === "[" && !inClass) inClass = true;
      else if (ch === "]" && inClass) inClass = false;
      out += ch;
    }
    return out;
  }

  function P(name, category, rx, validator = null, risk = "Médio", group = 0, ignoreCase = false) {
    return {
      name, category, validator, risk, group,
      regex: new RegExp(unicodeWord(rx), "gud" + (ignoreCase ? "i" : "")),
    };
  }

  const B = String.raw`(?<![\w.])`; // evita capturar parte de números/códigos maiores
  const E = String.raw`(?![\w])`;

  const TITLE = String.raw`(?:(?:Dr|Dra|Sr|Sra|Prof|Profa|Eng)\.?[ \t]+)?`;
  const NAME = String.raw`(\p{Lu}[\p{L}'’-]+(?:[ \t]+(?:(?:da|de|do|das|dos|e|di|del)[ \t]+)*\p{Lu}[\p{L}'’-]+){1,6})`;
  const NOME_LABEL =
    String.raw`(?<![\p{L}])(?:[Nn]ome|[Tt]itular|[Pp]residente|[Aa]valiador|[Rr]equerente|[Cc]andidato|[Ff]iador|[Rr]espons[áa]vel|[Bb]enefici[áa]rio|[Cc]olaborador|[Cc]ooperado|[Aa]uditor|[Pp]aciente|[Cc]liente|[Cc]ontratante|[Cc]ontratad[oa]|[Tt]estemunha|[Rr]epresentante|[Rr]elator|[Ss]ecret[áa]rio|[Cc]oordenador|[Pp]erito|[Mm]embro)[^:\n]{0,45}:[ \t]*` +
    TITLE + NAME + String.raw`(?![\p{L}])`;
  const NOME_SIGN = String.raw`_{5,}[ \t]*\r?\n[ \t]*` + TITLE + NAME + String.raw`[ \t]*(?:\r?\n|$)`;
  const NOT_NAMES = new Set(["secretaria", "departamento", "instituto", "comissão", "controladoria", "comitê", "conselho",
    "prefeitura", "ministério", "programa", "banco", "diretoria", "empresa", "órgão", "tribunal", "municipal", "nacional",
    "federal", "estadual", "ltda", "comitê", "gestão", "técnico", "técnica"]);
  const validName = (s) => !s.toLowerCase().split(/\s+/).some((w) => NOT_NAMES.has(w));

  const PATTERNS = [
    P("CPF", PESSOAL, B + String.raw`\d{3}\.?\d{3}\.?\d{3}-?\d{2}` + E, validCpf, "Alto"),
    P("CNPJ", PESSOAL, B + String.raw`\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}` + E, validCnpj, "Baixo"),
    P("RG", PESSOAL,
      String.raw`\b(?:RG|Identidade|Registro Geral)\b[^\w\n]{0,6}(?:n[º°o.]*\s*)?(\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx])`,
      null, "Alto", 1, true),
    P("CNH", PESSOAL,
      String.raw`\b(?:CNH|Carteira de Habilita[çc][ãa]o)(?![\w])[^\w\n]{0,6}(?:n[º°o.]*\s*)?(\d{11})\b`,
      null, "Alto", 1, true),
    P("Título de eleitor", PESSOAL,
      String.raw`(?<![\w])T[ií]tulo (?:de )?Eleitor\b[^\w\n]{0,6}(?:n[º°o.]*\s*)?(\d{4}\s?\d{4}\s?\d{4})\b`,
      null, "Alto", 1, true),
    P("PIS/PASEP/NIT", PESSOAL, B + String.raw`\d{3}\.?\d{5}\.?\d{2}-?\d` + E, validPis, "Alto"),
    P("Passaporte", PESSOAL,
      String.raw`\bPassaporte\b[^\w\n]{0,6}(?:n[º°o.]*\s*)?([A-Z]{2}\d{6})\b`, null, "Alto", 1, true),
    P("E-mail", PESSOAL, String.raw`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b`),
    P("Telefone", PESSOAL,
      String.raw`(?<![\w])0[3589]00[ -]?\d{3}[ -]?\d{4}(?![\w])`),
    P("Telefone", PESSOAL,
      String.raw`(?<![\w])(?:\+?55\s?)?(?:\(?[1-9]\d\)?\s?)(?:9\s?\d{4}[-\s]?\d{4}|[2-5]\d{3}[-\s]?\d{4}|\d{4}-\d{4})(?![\w])`,
      validPhone),
    P("CEP", PESSOAL, B + String.raw`\d{5}-\d{3}` + E, null, "Baixo"),
    P("Cartão de crédito", PESSOAL, String.raw`(?<![\w-])(?:\d{4}[ -]?){3}\d{1,4}(?![\w-])`, validLuhn, "Alto"),
    P("Data de nascimento", PESSOAL,
      String.raw`\b(?:nascimento|nasc\.?|nascido(?:\(a\))?\s+em)(?![\w])[^\d\n]{0,12}(\d{2}[/.-]\d{2}[/.-]\d{4})`,
      validDate, "Médio", 1, true),
    P("Conta bancária / agência", PESSOAL,
      String.raw`(?<![\w])(?:conta[ \t]+(?:corrente|poupan[çc]a|sal[áa]rio|pagamento|investimento|banc[áa]ria)|c/c|c/p|conta[ \t]*(?::|n[º°o.]+))[ \t]*(?:n[º°o.]*[ \t]*)?[:-]?[ \t\n]*(\d{3,12}(?:-[\dXx])?)(?![\w])`,
      null, "Alto", 1, true),
    P("Conta bancária / agência", PESSOAL,
      String.raw`(?<![\w])(?:ag[êe]ncia(?:[ \t]+banc[áa]ria)?|ag(?:\.|(?=[ \t]*:)))[ \t]*(?:n[º°o.]*[ \t]*)?[:-]?[ \t\n]*(\d{3,5}(?:-[\dXx])?)(?![\w])`,
      null, "Alto", 1, true),
    P("Chave PIX aleatória", PESSOAL,
      String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`, null, "Médio", 0, true),
    P("Endereço IP (IPv4)", PESSOAL, B + String.raw`(?:\d{1,3}\.){3}\d{1,3}` + E, validIpv4, "Baixo"),
    P("Placa de veículo", PESSOAL,
      String.raw`\bplaca\b[^\w\n]{0,6}([A-Z]{3}-?\d[A-Z0-9]\d{2})\b`, null, "Baixo", 1, true),
    P("CEP", PESSOAL, String.raw`(?<=,[ \t])\d{8}(?=[ \t]+\p{L})`, null, "Baixo"),
    P("CEP", PESSOAL, String.raw`\bCEP[ \t]*[:-]?[ \t]*(\d{5}-?\d{3})(?![\w])`, null, "Baixo", 1, true),
    // Endereço após rótulo, podendo quebrar linha, terminando em "Cidade / UF"
    P("Endereço residencial", PESSOAL,
      String.raw`(?:[Ee]ndere[çc]o|[Dd]omic[ií]lio(?![ \t]+[Bb]anc[áa]rio)|[Rr]esid[êe]ncia)[^:\n]{0,40}:[ \t\n]*([^:]{8,200}?[ \t]*/[ \t]*[A-Z]{2})(?![\p{L}])`,
      null, "Médio", 1),
    P("Endereço residencial", PESSOAL,
      String.raw`\b(?:Rua|Av\.?|Avenida|Travessa|Alameda|Rodovia|Estrada|Pra[çc]a|Largo|Ladeira|Via|Beco|Quadra|Setor|Distrito|N[úu]cleo|Col[ôo]nia|Campo|Vila|Loteamento|Conjunto|Parque|S[íi]tio|Ch[áa]cara|Fazenda|Condom[íi]nio|Residencial|Recanto|Morro|Viaduto|[ÁA]rea)\s+[A-Za-zÀ-ú][\wÀ-ú .'-]{2,60},?\s*(?:n[º°o.]*\s*)?\d{1,5}(?![-\d])\b`),
    P("Valor monetário", PESSOAL,
      String.raw`(?<![\w])R\$\s?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?(?:\s+(?:mil|milh[ãõ]es?|bilh[ãõ]es?)(?![\w]))?(?![\w])|(?<![\w])R\$\s?\d+(?:,\d{1,2})?(?:\s+(?:mil|milh[ãõ]es?|bilh[ãõ]es?)(?![\w]))?(?![\w])|(?<![\w.,])\d+(?:\.\d{3})*(?:,\d{1,2})?(?:\s+(?:mil|milh[ãõ]es?))?\s+reais\b`,
      null, "Baixo", 0, true),
    P("Valor monetário", PESSOAL,
      String.raw`(?:valor|remunera[çc][ãa]o|sal[áa]rio|honor[áa]rios|bolsa|subs[íi]dio|jeton|pagamento|renda|montante|total)[^:\n\d]{0,30}[:-][ \t]*(\d{1,3}(?:\.\d{3})*,\d{2})(?![\w])`,
      null, "Baixo", 1, true),
    // Nomes de pessoas: após rótulos (Titular, Nome, ...) e em linhas de assinatura
    P("Nome de pessoa", PESSOAL, NOME_LABEL, validName, "Médio", 1),
    P("Nome de pessoa", PESSOAL, NOME_SIGN, validName, "Médio", 1),
    // --- Dados sensíveis (art. 5º, II) por contexto/palavras-chave ---
    P("Saúde (CID / diagnóstico)", SENSIVEL,
      String.raw`(?<![\w])(?:CID(?:-?10)?[\s:.-]*[A-TV-Z]\d{2}(?:\.\d)?|diagn[óo]stic[oa]\s*:\s*\S[^\n]{2,60}|HIV|soropositivo|c[âa]ncer|depress[ãa]o|esquizofrenia|transtorno bipolar|tuberculose|hepatite\s+[A-C])\b`,
      null, "Alto", 0, true),
    P("Origem racial/étnica", SENSIVEL,
      String.raw`\b(?:cor|ra[çc]a|etnia)\s*[:/-]\s*(?:branc[oa]|pret[oa]|pard[oa]|amarel[oa]|ind[ií]gena)(?![\w])`,
      null, "Alto", 0, true),
    P("Convicção religiosa", SENSIVEL, String.raw`\breligi[ãa]o\s*[:/-]\s*[A-Za-zÀ-ú]{4,25}`, null, "Alto", 0, true),
    P("Filiação sindical/política", SENSIVEL,
      String.raw`\b(?:filiad[oa]\s+(?:ao|à|a)\s+(?:sindicato|partido)(?![\w])[^\n]{0,40}|partido\s+pol[ií]tico\s*:\s*\S[^\n]{0,30})`,
      null, "Alto", 0, true),
    P("Orientação sexual", SENSIVEL,
      String.raw`\borienta[çc][ãa]o\s+sexual\s*[:/-]\s*[A-Za-zÀ-ú]{4,25}`, null, "Alto", 0, true),
    P("Dado biométrico/genético", SENSIVEL,
      String.raw`(?<![\w])(?:biometria|impress[ãa]o digital|reconhecimento facial|exame de DNA|dado gen[ée]tico)(?![\w])`,
      null, "Médio", 0, true),
  ];

  /** Oculta parcialmente o dado para que o relatório não replique informação sensível. */
  function mask(value, name) {
    let v = value.trim();
    if (name === "E-mail") {
      const i = v.indexOf("@");
      return `${v.slice(0, 1)}***@${i < 0 ? "" : v.slice(i + 1)}`;
    }
    if (["CPF", "CNPJ", "PIS/PASEP/NIT", "Cartão de crédito"].includes(name)) {
      const keep = name === "Cartão de crédito" ? 4 : 2;
      const total = digits(v).length;
      let seen = 0;
      return [...v].map((ch) => (/\d/.test(ch) ? (++seen > total - keep ? ch : "*") : ch)).join("");
    }
    if ([...v].length > 40) v = [...v].slice(0, 40).join("") + "…";
    const chars = [...v];
    if (chars.length <= 4) return "*".repeat(chars.length);
    return chars.slice(0, 2).join("") + "*".repeat(chars.length - 4) + chars.slice(-2).join("");
  }

  /** Retorna [{pat, value, start}] para cada ocorrência validada. */
  function findMatches(text, patterns = PATTERNS) {
    const out = [];
    for (const pat of patterns) {
      pat.regex.lastIndex = 0;
      for (const m of text.matchAll(pat.regex)) {
        const val = m[pat.group];
        if (!val) continue;
        if (pat.validator && !pat.validator(val)) continue;
        out.push({ pat, value: val, start: m.indices[pat.group][0] });
      }
    }
    return out;
  }

  Object.assign(L, { PESSOAL, SENSIVEL, PATTERNS, digits, validCpf, validCnpj, validPis, validLuhn, validDate, validPhone, validIpv4, mask, findMatches });
})();
