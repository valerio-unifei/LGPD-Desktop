# LGPD Desktop

Ferramenta desktop (Python + Tkinter) para Windows 11 que lista documentos **DOCX, XLSX e PDF**, extrai o conteúdo e procura dados pessoais/sensíveis da LGPD (Lei 13.709/2018) usando REGEX.

## Uso
```powershell
pip install -r requirements.txt
python -m lgpd_scanner
```
1. Escolha as pastas (padrão: seu perfil; também há "Todos os discos").
2. Clique em **Iniciar varredura**. A aba *Documentos listados* mostra todos os arquivos; *Dados encontrados* mostra as ocorrências (duplo clique abre o arquivo no Explorer).
3. **Exportar CSV** gera o relatório.

## O que é detectado
- **Dados pessoais:** CPF, CNPJ, RG, CNH, título de eleitor, PIS/NIT, passaporte, e-mail, telefone, CEP, cartão de crédito, data de nascimento, conta/agência, chave PIX, IP, placa, endereço.
- **Dados sensíveis (art. 5º, II):** saúde (CID, diagnósticos), origem racial/étnica, religião, filiação sindical/política, orientação sexual, biometria/genética.

Para reduzir falsos positivos, CPF/CNPJ/PIS usam dígitos verificadores, cartões usam Luhn, e RG/CNH/título etc. exigem palavra de contexto. Os valores são exibidos e exportados **mascarados**. Os padrões ficam em [lgpd_scanner/patterns.py](lgpd_scanner/patterns.py).

## Limitações
PDFs escaneados (imagem) não possuem texto e exigem OCR (não incluso); PDFs com senha e arquivos corrompidos são reportados como erro. Formatos antigos (.doc/.xls) não são suportados.

## Testes
```powershell
python -m unittest discover -s tests -t .
```
