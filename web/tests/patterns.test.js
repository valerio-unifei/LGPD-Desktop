const test = require("node:test");
const assert = require("node:assert");
require("../js/patterns.js");
require("../js/sanitizer.js");
const L = globalThis.LGPD;

const names = (t) => new Set(L.findMatches(t).map((m) => m.pat.name));
const TEXT =
  "CPF 529.982.247-25, RG: 12.345.678-9, tel (35) 99876-5432, Rua das Flores, 123, " +
  "valor R$ 1.500,00. CPF 529.982.247-25.\n Diagnóstico: depressão grave.";

test("validators", () => {
  assert.ok(L.validCpf("529.982.247-25"));
  assert.ok(!L.validCpf("111.111.111-11"));
  assert.ok(!L.validCpf("529.982.247-24"));
  assert.ok(L.validCnpj("11.222.333/0001-81"));
  assert.ok(L.validLuhn("4111 1111 1111 1111"));
});

test("detection", () => {
  const t = "CPF 529.982.247-25, email joao@exemplo.com.br, tel (11) 98765-4321, " +
    "RG: 12.345.678-9, Data de nascimento: 05/03/1990, CEP 01310-100, " +
    "cartão 4111 1111 1111 1111, CID F32.1, Rua das Flores, 123";
  const found = names(t);
  for (const n of ["CPF", "E-mail", "Telefone", "RG", "Data de nascimento", "CEP", "Cartão de crédito",
    "Saúde (CID / diagnóstico)", "Endereço residencial"]) assert.ok(found.has(n), n);
});

test("no false positive", () => {
  assert.ok(!names("Protocolo 123.456.789-00 e 11111111111").has("CPF"));
});

test("mask", () => {
  assert.strictEqual(L.mask("529.982.247-25", "CPF"), "***.***.***-25");
  assert.strictEqual(L.mask("joao@x.com", "E-mail"), "j***@x.com");
});

test("sanitize roundtrip", () => {
  const mapping = {};
  const clean = L.sanitizeText(TEXT, mapping, { n: 0 });
  for (const o of ["529.982.247-25", "12.345.678-9", "99876-5432", "1.500,00", "Rua das Flores, 123"])
    assert.ok(!clean.includes(o), o);
  assert.strictEqual(Object.keys(mapping).filter((k) => k.startsWith("CPF")).length, 1);
  const r = L.restoreText(clean, mapping);
  assert.strictEqual(r.text, TEXT);
  assert.strictEqual(r.count, 7);
});

test("restore after LLM edits masked text", () => {
  const mapping = {};
  const clean = L.sanitizeText("CPF 529.982.247-25", mapping, { n: 0 });
  assert.strictEqual(L.restoreText(clean.replace(/\*\*/g, "xx"), mapping).text, "CPF 529.982.247-25");
});
