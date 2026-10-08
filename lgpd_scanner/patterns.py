"""Padrões REGEX e validadores para identificação de dados pessoais (LGPD)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Optional

PESSOAL = "Dado pessoal"
SENSIVEL = "Dado pessoal sensível (art. 5º, II)"


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def valid_cpf(s: str) -> bool:
    d = _digits(s)
    if len(d) != 11 or d == d[0] * 11:
        return False
    for n in (9, 10):
        soma = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        if (soma * 10 % 11) % 10 != int(d[n]):
            return False
    return True


def valid_cnpj(s: str) -> bool:
    d = _digits(s)
    if len(d) != 14 or d == d[0] * 14:
        return False
    pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    pesos2 = [6] + pesos1
    for pesos, pos in ((pesos1, 12), (pesos2, 13)):
        r = sum(int(x) * p for x, p in zip(d, pesos)) % 11
        if (0 if r < 2 else 11 - r) != int(d[pos]):
            return False
    return True


def valid_pis(s: str) -> bool:
    d = _digits(s)
    if len(d) != 11 or d == d[0] * 11:
        return False
    pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    r = 11 - sum(int(x) * p for x, p in zip(d, pesos)) % 11
    return (0 if r >= 10 else r) == int(d[10])


def valid_luhn(s: str) -> bool:
    d = _digits(s)
    if not 13 <= len(d) <= 19 or d == d[0] * len(d):
        return False
    total = 0
    for i, ch in enumerate(reversed(d)):
        n = int(ch)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return total % 10 == 0


def valid_date(s: str) -> bool:
    m = re.match(r"(\d{2})[/.-](\d{2})[/.-](\d{4})", s)
    if not m:
        return False
    dia, mes, ano = map(int, m.groups())
    return 1 <= dia <= 31 and 1 <= mes <= 12 and 1900 <= ano <= 2100


def valid_phone(s: str) -> bool:
    # 11 dígitos sem formatação que formam um CPF válido são tratados como CPF
    return not (s.isdigit() and valid_cpf(s))


def valid_ipv4(s: str) -> bool:
    parts = s.split(".")
    return (
        len(parts) == 4
        and all(p.isdigit() and int(p) <= 255 for p in parts)
        and s not in ("0.0.0.0", "127.0.0.1")
    )


@dataclass(frozen=True)
class Pattern:
    name: str
    category: str
    regex: re.Pattern
    validator: Optional[Callable[[str], bool]] = None
    risk: str = "Médio"  # Baixo | Médio | Alto
    group: int = 0  # grupo da regex que contém o dado


def _p(name, category, rx, validator=None, risk="Médio", group=0, flags=0):
    return Pattern(name, category, re.compile(rx, flags), validator, risk, group)


_I = re.IGNORECASE
_B = r"(?<![\w.])"  # evita capturar parte de números/códigos maiores
_E = r"(?![\w])"

PATTERNS: list[Pattern] = [
    _p("CPF", PESSOAL, _B + r"\d{3}\.?\d{3}\.?\d{3}-?\d{2}" + _E, valid_cpf, "Alto"),
    _p("CNPJ", PESSOAL, _B + r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}" + _E, valid_cnpj, "Baixo"),
    _p(
        "RG", PESSOAL,
        r"\b(?:RG|Identidade|Registro Geral)\b[^\w\n]{0,6}(?:n[º°o.]*\s*)?(\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx])",
        None, "Alto", 1, _I,
    ),
    _p(
        "CNH", PESSOAL,
        r"\b(?:CNH|Carteira de Habilita[çc][ãa]o)\b[^\w\n]{0,6}(?:n[º°o.]*\s*)?(\d{11})\b",
        None, "Alto", 1, _I,
    ),
    _p(
        "Título de eleitor", PESSOAL,
        r"\bT[ií]tulo (?:de )?Eleitor\b[^\w\n]{0,6}(?:n[º°o.]*\s*)?(\d{4}\s?\d{4}\s?\d{4})\b",
        None, "Alto", 1, _I,
    ),
    _p("PIS/PASEP/NIT", PESSOAL, _B + r"\d{3}\.?\d{5}\.?\d{2}-?\d" + _E, valid_pis, "Alto"),
    _p(
        "Passaporte", PESSOAL,
        r"\bPassaporte\b[^\w\n]{0,6}(?:n[º°o.]*\s*)?([A-Z]{2}\d{6})\b",
        None, "Alto", 1, _I,
    ),
    _p("E-mail", PESSOAL, r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b"),
    _p(
        "Telefone", PESSOAL,
        r"(?<![\w])(?:\+?55\s?)?(?:\(?[1-9]{2}\)?\s?)(?:9\s?\d{4}|[2-5]\d{3})[-\s]?\d{4}(?![\w])",
                valid_phone,
            ),
    _p("CEP", PESSOAL, _B + r"\d{5}-\d{3}" + _E, None, "Baixo"),
    _p("Cartão de crédito", PESSOAL, r"(?<![\w-])(?:\d{4}[ -]?){3}\d{1,4}(?![\w-])", valid_luhn, "Alto"),
    _p(
        "Data de nascimento", PESSOAL,
        r"\b(?:nascimento|nasc\.?|nascido(?:\(a\))?\s+em)\b[^\d\n]{0,12}(\d{2}[/.-]\d{2}[/.-]\d{4})",
        valid_date, "Médio", 1, _I,
    ),
    _p(
        "Conta bancária / agência", PESSOAL,
        r"\b(?:ag[êe]ncia|conta(?: corrente| poupan[çc]a)?|c/c)\b[^\d\n]{0,8}(\d{3,12}(?:-[\dXx])?)",
        None, "Alto", 1, _I,
    ),
    _p(
        "Chave PIX aleatória", PESSOAL,
        r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
        None, "Médio", 0, _I,
    ),
    _p("Endereço IP (IPv4)", PESSOAL, _B + r"(?:\d{1,3}\.){3}\d{1,3}" + _E, valid_ipv4, "Baixo"),
    _p(
        "Placa de veículo", PESSOAL,
        r"\bplaca\b[^\w\n]{0,6}([A-Z]{3}-?\d[A-Z0-9]\d{2})\b", None, "Baixo", 1, _I,
    ),
    _p(
        "Endereço residencial", PESSOAL,
        r"\b(?:Rua|Av\.?|Avenida|Travessa|Alameda|Rodovia|Estrada|Pra[çc]a)\s+[A-Za-zÀ-ú][\wÀ-ú .'-]{2,60},?\s*(?:n[º°o.]*\s*)?\d{1,5}\b",
    ),
    _p(
        "Valor monetário", PESSOAL,
        r"(?<![\w])R\$\s?\d+(?:\.\d{3})*(?:,\d{1,2})?(?![\w])|(?<![\w.,])\d+(?:\.\d{3})*(?:,\d{2})?\s+reais\b",
        None, "Baixo", 0, _I,
    ),
    # --- Dados sensíveis (art. 5º, II) por contexto/palavras-chave ---
    _p(
        "Saúde (CID / diagnóstico)", SENSIVEL,
        r"\b(?:CID(?:-?10)?[\s:.-]*[A-TV-Z]\d{2}(?:\.\d)?|diagn[óo]stic[oa]\s*:\s*\S[^\n]{2,60}|HIV|soropositivo|c[âa]ncer|depress[ãa]o|esquizofrenia|transtorno bipolar|tuberculose|hepatite\s+[A-C])\b",
        None, "Alto", 0, _I,
    ),
    _p(
        "Origem racial/étnica", SENSIVEL,
        r"\b(?:cor|ra[çc]a|etnia)\s*[:/-]\s*(?:branc[oa]|pret[oa]|pard[oa]|amarel[oa]|ind[ií]gena)\b",
        None, "Alto", 0, _I,
    ),
    _p("Convicção religiosa", SENSIVEL, r"\breligi[ãa]o\s*[:/-]\s*[A-Za-zÀ-ú]{4,25}", None, "Alto", 0, _I),
    _p(
        "Filiação sindical/política", SENSIVEL,
        r"\b(?:filiad[oa]\s+(?:ao|à|a)\s+(?:sindicato|partido)\b[^\n]{0,40}|partido\s+pol[ií]tico\s*:\s*\S[^\n]{0,30})",
        None, "Alto", 0, _I,
    ),
    _p(
        "Orientação sexual", SENSIVEL,
        r"\borienta[çc][ãa]o\s+sexual\s*[:/-]\s*[A-Za-zÀ-ú]{4,25}", None, "Alto", 0, _I,
    ),
    _p(
        "Dado biométrico/genético", SENSIVEL,
        r"\b(?:biometria|impress[ãa]o digital|reconhecimento facial|exame de DNA|dado gen[ée]tico)\b",
        None, "Médio", 0, _I,
    ),
]


def mask(value: str, name: str) -> str:
    """Oculta parcialmente o dado para que o relatório não replique informação sensível."""
    v = value.strip()
    if name == "E-mail":
        user, _, dom = v.partition("@")
        return f"{user[:1]}***@{dom}"
    if name in ("CPF", "CNPJ", "PIS/PASEP/NIT", "Cartão de crédito"):
        keep = 4 if name == "Cartão de crédito" else 2
        total, seen, out = len(_digits(v)), 0, []
        for ch in v:
            if ch.isdigit():
                seen += 1
                out.append(ch if seen > total - keep else "*")
            else:
                out.append(ch)
        return "".join(out)
    if len(v) > 40:
        v = v[:40] + "…"
    if len(v) <= 4:
        return "*" * len(v)
    return v[:2] + "*" * (len(v) - 4) + v[-2:]


def find_matches(text: str, patterns: list[Pattern] | None = None):
    """Gera (Pattern, valor, posição) para cada ocorrência validada."""
    for pat in patterns or PATTERNS:
        for m in pat.regex.finditer(text):
            val = m.group(pat.group)
            if not val:
                continue
            if pat.validator and not pat.validator(val):
                continue
            yield pat, val, m.start(pat.group)

