"""Sanitização LGPD reversível: gera um .md com dados parcialmente ocultos e permite restaurá-los.

Cada dado detectado vira um marcador `[[TIPO-N: valor parcialmente oculto]]`. O dado original fica
num arquivo de mapeamento local (`<nome>.md.lgpd-map.json`) que NÃO deve ser enviado ao LLM.
A reversão troca cada marcador (pelo identificador TIPO-N) pelo valor original, mesmo que o LLM
tenha alterado o texto oculto dentro do marcador.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .extractors import extract
from .patterns import PATTERNS, SENSIVEL, Pattern, find_matches

MAP_SUFFIX = ".lgpd-map.json"
RESTORED_SUFFIX = "_restaurado"

_CODES = {
    "CPF": "CPF", "CNPJ": "CNPJ", "RG": "RG", "CNH": "CNH", "Telefone": "TEL",
    "Endereço residencial": "END", "Valor monetário": "VALOR", "E-mail": "EMAIL", "CEP": "CEP",
}
TOKEN_RE = re.compile(r"\[\[([A-Z]+-\d+):[^\]]*\]\]")


def _code(pat: Pattern) -> str:
    if pat.name in _CODES:
        return _CODES[pat.name]
    return "SENSIVEL" if pat.category == SENSIVEL else "DADO"


def _mask_digits(v: str, keep: int) -> str:
    total, seen, out = sum(c.isdigit() for c in v), 0, []
    for ch in v:
        if ch.isdigit():
            seen += 1
            out.append(ch if seen > total - keep else "*")
        else:
            out.append(ch)
    return "".join(out)


def _mask_words(v: str, keep_first: int = 1) -> str:
    words = v.split()
    return " ".join(w if i < keep_first else "*" * len(w) for i, w in enumerate(words))


def partial_mask(value: str, pat: Pattern) -> str:
    """Oculta parcialmente o valor mantendo o formato, sem truncar o texto."""
    v = value.strip()
    if pat.name == "E-mail":
        user, _, dom = v.partition("@")
        return f"{user[:1]}***@{dom}"
    if pat.name in ("CPF", "CNPJ", "RG", "CNH", "PIS/PASEP/NIT", "Telefone", "CEP"):
        return _mask_digits(v, 2 if pat.name != "Telefone" else 4)
    if pat.name == "Cartão de crédito":
        return _mask_digits(v, 4)
    if pat.name == "Valor monetário":
        return re.sub(r"\d", "*", v)
    if pat.name == "Endereço residencial":
        return re.sub(r"\d", "*", _mask_words(v, 1))
    if pat.category == SENSIVEL:
        return _mask_words(v, 1) if " " in v else v[:1] + "*" * (len(v) - 1)
    if len(v) <= 4:
        return "*" * len(v)
    return v[:2] + "*" * (len(v) - 4) + v[-2:]


def sanitize_text(text: str, mapping: dict[str, str], counter: list[int], patterns=PATTERNS) -> str:
    """Substitui as ocorrências por marcadores; `mapping` (id -> original) é preenchido."""
    spans = []
    for pat, value, start in find_matches(text, patterns):
        spans.append((start, start + len(value), pat, value))
    spans.sort(key=lambda s: (s[0], -(s[1] - s[0])))
    reverse = {(code, orig): tid for tid, orig in mapping.items() for code in [tid.rsplit("-", 1)[0]]}
    out, pos = [], 0
    for start, end, pat, value in spans:
        if start < pos:  # sobreposição com um dado já tratado
            continue
        code = _code(pat)
        tid = reverse.get((code, value))
        if tid is None:
            counter[0] += 1
            tid = f"{code}-{counter[0]}"
            mapping[tid] = value
            reverse[(code, value)] = tid
        masked = partial_mask(value, pat).replace("]", "*").replace("\n", " ")
        out.append(text[pos:start])
        out.append(f"[[{tid}: {masked}]]")
        pos = end
    out.append(text[pos:])
    return "".join(out)


def sanitized_paths(path: Path) -> tuple[Path, Path]:
    md = path.with_suffix(".md")
    return md, md.with_name(md.name + MAP_SUFFIX)


def sanitize_file(path: Path, patterns=PATTERNS) -> tuple[Path, Path, int]:
    """Gera `<nome>.md` e o mapa de reversão. Retorna (md, mapa, nº de dados substituídos)."""
    path = Path(path)
    mapping: dict[str, str] = {}
    counter = [0]
    lines = [f"# {path.name}", ""]
    for location, text in extract(path):
        clean = sanitize_text(text, mapping, counter, patterns).strip()
        if not clean:
            continue
        if location.startswith("parágrafo"):
            lines += [clean, ""]
        else:
            lines += [f"**[{location}]** {clean}", ""]
    md, map_path = sanitized_paths(path)
    md.write_text("\n".join(lines), encoding="utf-8")
    map_path.write_text(
        json.dumps({"source": path.name, "mapping": mapping}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return md, map_path, len(mapping)


def restore_text(text: str, mapping: dict[str, str]) -> tuple[str, int]:
    count = 0

    def repl(m: re.Match) -> str:
        nonlocal count
        original = mapping.get(m.group(1))
        if original is None:
            return m.group(0)
        count += 1
        return original

    return TOKEN_RE.sub(repl, text), count


def restore_file(md_path: Path, map_path: Path | None = None, dest: Path | None = None) -> tuple[Path, int]:
    """Reverte a sanitização de um .md (original ou processado por LLM). Retorna (arquivo, nº restaurados)."""
    md_path = Path(md_path)
    if map_path is None:
        stem = md_path.stem[: -len(RESTORED_SUFFIX)] if md_path.stem.endswith(RESTORED_SUFFIX) else md_path.stem
        map_path = md_path.with_name(stem + ".md" + MAP_SUFFIX)
    mapping = json.loads(Path(map_path).read_text(encoding="utf-8"))["mapping"]
    restored, count = restore_text(md_path.read_text(encoding="utf-8"), mapping)
    dest = Path(dest) if dest else md_path.with_name(md_path.stem + RESTORED_SUFFIX + ".md")
    dest.write_text(restored, encoding="utf-8")
    return dest, count
