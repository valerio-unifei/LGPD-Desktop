"""Listagem de documentos e varredura de dados sensíveis."""
from __future__ import annotations

import csv
import os
import string
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator, Optional

from .extractors import SUPPORTED, extract
from .patterns import PATTERNS, Pattern, find_matches, mask

SKIP_DIRS = {
    "windows", "program files", "program files (x86)", "programdata", "appdata",
    "$recycle.bin", "system volume information", "node_modules", ".git", ".venv",
    "venv", "__pycache__", "site-packages",
}
MAX_FILE_BYTES = 200 * 1024 * 1024


@dataclass
class Finding:
    file: str
    location: str
    pattern: str
    category: str
    risk: str
    masked: str


@dataclass
class FileResult:
    path: str
    size: int
    findings: list[Finding] = field(default_factory=list)
    error: Optional[str] = None


def fixed_drives() -> list[str]:
    drives = []
    try:
        import ctypes

        mask_bits = ctypes.windll.kernel32.GetLogicalDrives()
        for i, letter in enumerate(string.ascii_uppercase):
            root = f"{letter}:\\"
            if mask_bits & (1 << i) and ctypes.windll.kernel32.GetDriveTypeW(root) == 3:
                drives.append(root)
    except Exception:
        pass
    return drives


def list_documents(
    roots: list[str],
    extensions: set[str] = SUPPORTED,
    stop: Optional[threading.Event] = None,
) -> Iterator[Path]:
    """Percorre as pastas e gera os documentos suportados."""
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
            if stop and stop.is_set():
                return
            dirnames[:] = [d for d in dirnames if d.lower() not in SKIP_DIRS]
            for name in filenames:
                if name.startswith("~$"):  # temporários do Office
                    continue
                if os.path.splitext(name)[1].lower() in extensions:
                    yield Path(dirpath) / name


def scan_file(path: Path, patterns: list[Pattern] = PATTERNS) -> FileResult:
    try:
        size = path.stat().st_size
    except OSError as exc:
        return FileResult(str(path), 0, error=str(exc))
    result = FileResult(str(path), size)
    if size > MAX_FILE_BYTES:
        result.error = "arquivo muito grande (ignorado)"
        return result
    seen: set[tuple[str, str, str]] = set()
    try:
        for location, text in extract(path):
            for pat, value, _pos in find_matches(text, patterns):
                key = (location, pat.name, value)
                if key in seen:
                    continue
                seen.add(key)
                result.findings.append(
                    Finding(str(path), location, pat.name, pat.category, pat.risk, mask(value, pat.name))
                )
    except Exception as exc:  # arquivo corrompido, protegido, etc.
        result.error = f"{type(exc).__name__}: {exc}"
    return result


def scan(
    roots: list[str],
    patterns: list[Pattern] = PATTERNS,
    on_file: Optional[Callable[[Path], None]] = None,
    on_result: Optional[Callable[[FileResult], None]] = None,
    stop: Optional[threading.Event] = None,
) -> int:
    count = 0
    for path in list_documents(roots, stop=stop):
        if stop and stop.is_set():
            break
        if on_file:
            on_file(path)
        res = scan_file(path, patterns)
        count += 1
        if on_result:
            on_result(res)
    return count


def export_csv(findings: list[Finding], dest: str) -> None:
    with open(dest, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Arquivo", "Localização", "Tipo de dado", "Categoria", "Risco", "Valor (mascarado)"])
        for x in findings:
            w.writerow([x.file, x.location, x.pattern, x.category, x.risk, x.masked])
