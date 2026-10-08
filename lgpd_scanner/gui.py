"""Interface gráfica (Tkinter) - compatível com Windows 11."""
from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from . import __version__
from .scanner import FileResult, Finding, export_csv, fixed_drives, scan

RISK_ORDER = {"Alto": 0, "Médio": 1, "Baixo": 2}

ICON_NAME = "unifei.ico"


def _icon_path() -> Path | None:
    """Localiza o ícone 'unifei.ico', tanto em execução normal quanto empacotada (PyInstaller)."""
    candidates = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass) / ICON_NAME)
    candidates.append(Path(sys.argv[0]).resolve().parent / ICON_NAME)
    candidates.append(Path(__file__).resolve().parent.parent / ICON_NAME)
    candidates.append(Path(__file__).resolve().parent / ICON_NAME)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(f"LGPD Desktop - Localizador de dados pessoais v{__version__}")
        self._set_icon()
        self.geometry("1150x700")
        self.minsize(900, 550)
        self.q: queue.Queue = queue.Queue()
        self.stop_event = threading.Event()
        self.worker: threading.Thread | None = None
        self.findings: list[Finding] = []
        self.n_files = 0
        self._build()
        self.after(100, self._poll)

    def _set_icon(self) -> None:
        icon = _icon_path()
        if icon is not None:
            try:
                self.iconbitmap(default=str(icon))
            except tk.TclError:
                pass

    def _build(self) -> None:
        style = ttk.Style(self)
        if "vista" in style.theme_names():
            style.theme_use("vista")

        top = ttk.LabelFrame(self, text="Pastas a verificar (DOCX, XLSX, PDF)")
        top.pack(fill="x", padx=8, pady=6)
        self.folders = tk.Listbox(top, height=4, selectmode="extended")
        self.folders.pack(side="left", fill="both", expand=True, padx=6, pady=6)
        btns = ttk.Frame(top)
        btns.pack(side="right", padx=6, pady=6)
        for text, cmd in (
            ("Adicionar pasta…", self._add_folder),
            ("Meus documentos", self._add_user_docs),
            ("Todos os discos", self._add_all_drives),
            ("Remover", self._remove_folder),
        ):
            ttk.Button(btns, text=text, command=cmd, width=18).pack(pady=1)
        self._add_user_docs()

        bar = ttk.Frame(self)
        bar.pack(fill="x", padx=8)
        self.btn_start = ttk.Button(bar, text="▶ Iniciar varredura", command=self._start)
        self.btn_start.pack(side="left")
        self.btn_stop = ttk.Button(bar, text="■ Parar", command=self._stop, state="disabled")
        self.btn_stop.pack(side="left", padx=4)
        ttk.Button(bar, text="Exportar CSV…", command=self._export).pack(side="left", padx=4)
        ttk.Button(bar, text="Limpar", command=self._clear).pack(side="left")
        self.progress = ttk.Progressbar(bar, mode="indeterminate", length=180)
        self.progress.pack(side="right")

        self.tabs = ttk.Notebook(self)
        self.tabs.pack(fill="both", expand=True, padx=8, pady=6)

        self.tree_find = self._make_tree(
            "Dados encontrados",
            [("risk", "Risco", 70), ("type", "Tipo de dado", 190), ("cat", "Categoria", 210),
             ("val", "Valor (mascarado)", 170), ("loc", "Localização", 200), ("file", "Arquivo", 500)],
        )
        self.tree_docs = self._make_tree(
            "Documentos listados",
            [("name", "Documento", 260), ("ext", "Tipo", 60), ("size", "Tamanho (KB)", 90),
             ("count", "Ocorrências", 90), ("status", "Situação", 220), ("path", "Caminho", 420)],
        )
        self.tree_find.tag_configure("Alto", background="#fde2e2")
        self.tree_find.tag_configure("Médio", background="#fff4d6")
        self.tree_docs.tag_configure("sens", background="#fde2e2")
        self.tree_docs.tag_configure("erro", foreground="#888888")

        self.status = tk.StringVar(value="Pronto.")
        ttk.Label(self, textvariable=self.status, relief="sunken", anchor="w").pack(fill="x", side="bottom")

    def _make_tree(self, title: str, cols) -> ttk.Treeview:
        frame = ttk.Frame(self.tabs)
        self.tabs.add(frame, text=title)
        tree = ttk.Treeview(frame, columns=[c[0] for c in cols], show="headings")
        for cid, text, width in cols:
            tree.heading(cid, text=text, command=lambda t=tree, c=cid: self._sort(t, c))
            tree.column(cid, width=width, anchor="w")
        ys = ttk.Scrollbar(frame, orient="vertical", command=tree.yview)
        xs = ttk.Scrollbar(frame, orient="horizontal", command=tree.xview)
        tree.configure(yscrollcommand=ys.set, xscrollcommand=xs.set)
        tree.grid(row=0, column=0, sticky="nsew")
        ys.grid(row=0, column=1, sticky="ns")
        xs.grid(row=1, column=0, sticky="ew")
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)
        tree.bind("<Double-1>", lambda e, t=tree: self._open_location(t))
        return tree

    @staticmethod
    def _sort(tree: ttk.Treeview, col: str) -> None:
        rows = [(tree.set(k, col), k) for k in tree.get_children("")]
        try:
            rows.sort(key=lambda r: float(r[0]))
        except ValueError:
            rows.sort(key=lambda r: r[0].lower())
        for i, (_, k) in enumerate(rows):
            tree.move(k, "", i)

    # ---- pastas ----
    def _add(self, path: str) -> None:
        if path and path not in self.folders.get(0, "end"):
            self.folders.insert("end", path)

    def _add_folder(self) -> None:
        self._add(os.path.normpath(filedialog.askdirectory(title="Escolha a pasta") or ""))

    def _add_user_docs(self) -> None:
        self._add(str(Path.home()))

    def _add_all_drives(self) -> None:
        for d in fixed_drives():
            self._add(d)

    def _remove_folder(self) -> None:
        for i in reversed(self.folders.curselection()):
            self.folders.delete(i)

    # ---- varredura ----
    def _start(self) -> None:
        roots = list(self.folders.get(0, "end"))
        if not roots:
            messagebox.showwarning("Atenção", "Adicione ao menos uma pasta.")
            return
        self._clear()
        self.stop_event.clear()
        self.btn_start.config(state="disabled")
        self.btn_stop.config(state="normal")
        self.progress.start(12)
        self.worker = threading.Thread(target=self._run, args=(roots,), daemon=True)
        self.worker.start()

    def _run(self, roots: list[str]) -> None:
        try:
            scan(
                roots,
                on_file=lambda p: self.q.put(("file", str(p))),
                on_result=lambda r: self.q.put(("result", r)),
                stop=self.stop_event,
            )
        finally:
            self.q.put(("done", None))

    def _stop(self) -> None:
        self.stop_event.set()
        self.status.set("Interrompendo…")

    def _poll(self) -> None:
        try:
            for _ in range(200):
                kind, data = self.q.get_nowait()
                if kind == "file":
                    self.status.set(f"Analisando: {data}")
                elif kind == "result":
                    self._add_result(data)
                else:
                    self._finish()
        except queue.Empty:
            pass
        self.after(100, self._poll)

    def _add_result(self, r: FileResult) -> None:
        self.n_files += 1
        p = Path(r.path)
        if r.error:
            status, tags = f"Erro: {r.error}", ("erro",)
        elif r.findings:
            status, tags = "Dados pessoais encontrados", ("sens",)
        else:
            status, tags = "Nenhum dado encontrado", ()
        self.tree_docs.insert(
            "", "end", values=(p.name, p.suffix.lower().lstrip("."), f"{r.size / 1024:.1f}",
                               len(r.findings), status, r.path), tags=tags)
        for f in sorted(r.findings, key=lambda x: RISK_ORDER[x.risk]):
            self.findings.append(f)
            self.tree_find.insert("", "end", values=(f.risk, f.pattern, f.category, f.masked, f.location, f.file),
                                  tags=(f.risk,))

    def _finish(self) -> None:
        self.progress.stop()
        self.btn_start.config(state="normal")
        self.btn_stop.config(state="disabled")
        files_with = len({f.file for f in self.findings})
        self.status.set(
            f"Concluído: {self.n_files} documento(s) analisado(s), {files_with} com dados pessoais, "
            f"{len(self.findings)} ocorrência(s)."
        )

    def _clear(self) -> None:
        if self.worker and self.worker.is_alive():
            return
        for t in (self.tree_find, self.tree_docs):
            t.delete(*t.get_children())
        self.findings.clear()
        self.n_files = 0
        self.status.set("Pronto.")

    def _export(self) -> None:
        if not self.findings:
            messagebox.showinfo("Exportar", "Não há resultados para exportar.")
            return
        dest = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV", "*.csv")],
                                            initialfile="relatorio_lgpd.csv")
        if dest:
            export_csv(self.findings, dest)
            messagebox.showinfo("Exportar", f"Relatório salvo em:\n{dest}")

    @staticmethod
    def _open_location(tree: ttk.Treeview) -> None:
        sel = tree.selection()
        if not sel:
            return
        path = tree.set(sel[0], "file" if "file" in tree["columns"] else "path")
        if os.path.exists(path):
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])


def main() -> None:
    App().mainloop()
