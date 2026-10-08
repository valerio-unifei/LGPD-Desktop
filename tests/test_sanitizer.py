import tempfile
import unittest
from pathlib import Path

from lgpd_scanner.sanitizer import restore_file, restore_text, sanitize_file, sanitize_text

TEXT = (
    "CPF 529.982.247-25, RG: 12.345.678-9, tel (35) 99876-5432, Rua das Flores, 123, "
    "valor R$ 1.500,00. CPF 529.982.247-25.\n Diagnóstico: depressão grave."
)


class SanitizerTest(unittest.TestCase):
    def test_roundtrip(self):
        mapping, counter = {}, [0]
        clean = sanitize_text(TEXT, mapping, counter)
        for original in ("529.982.247-25", "12.345.678-9", "99876-5432", "1.500,00", "Rua das Flores, 123"):
            self.assertNotIn(original, clean)
        self.assertEqual(len([k for k in mapping if k.startswith("CPF")]), 1)  # mesmo CPF, mesmo id
        restored, n = restore_text(clean, mapping)
        self.assertEqual(restored, TEXT)
        self.assertEqual(n, 7)

    def test_restore_after_llm_edits_masked_text(self):
        mapping, counter = {}, [0]
        clean = sanitize_text("CPF 529.982.247-25", mapping, counter)
        edited = clean.replace("**", "xx")
        self.assertEqual(restore_text(edited, mapping)[0], "CPF 529.982.247-25")

    def test_file(self):
        import docx

        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "doc.docx"
            document = docx.Document()
            document.add_paragraph(TEXT)
            document.save(str(src))
            md, mp, n = sanitize_file(src)
            self.assertEqual(md.name, "doc.md")
            self.assertNotIn("529.982.247-25", md.read_text(encoding="utf-8"))
            dest, count = restore_file(md)
            self.assertEqual(count, n + 1)  # CPF aparece duas vezes
            self.assertIn("529.982.247-25", dest.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
