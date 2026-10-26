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

const SAMPLE =
  "Titular Credenciado: Amanda Novais\nDocumento de Identidade (RG): 38.242.854-1 SSP/RS\n" +
  "Contato Telefônico: 79 0054-1199\n" +
  "Endereço Residencial:\nColônia Lopes, 64, Vila Santo Antônio, 50609-835 Barbosa das\nFlores / PE\n" +
  "Domicílio Bancário: Itaú (Cód. 341) | Ag.: 1434-8 | Conta Salário: 36062-8\n" +
  "Conta Poupança:\n46048-3 e remuneração de R$ 1.500,00 ou 5 mil reais\n" +
  "__________\nAmanda Novais\nCPF: 386.194.205-42\n";

test("sample-like documents: bank, address, money, names", () => {
  const found = L.findMatches(SAMPLE).map((m) => `${m.pat.name}=${m.value}`);
  for (const v of ["Conta bancária / agência=1434-8", "Conta bancária / agência=36062-8", "Conta bancária / agência=46048-3",
    "Telefone=79 0054-1199", "Valor monetário=R$ 1.500,00", "Valor monetário=5 mil reais", "Nome de pessoa=Amanda Novais",
    "Endereço residencial=Colônia Lopes, 64, Vila Santo Antônio, 50609-835 Barbosa das\nFlores / PE"])
    assert.ok(found.includes(v), v);
});

test("sanitize hides sample data and restores it", () => {
  const { md, mapJson } = L.sanitizeSegments("a.pdf", [{ location: "página 1", text: SAMPLE }]);
  for (const o of ["Amanda Novais", "36062-8", "46048-3", "1.500,00", "Colônia Lopes", "0054-1199"]) assert.ok(!md.includes(o), o);
  const restored = L.restoreText(md, JSON.parse(mapJson).mapping).text;
  assert.ok(restored.includes("Colônia Lopes, 64") && restored.includes("Conta Salário: 36062-8"));
});
