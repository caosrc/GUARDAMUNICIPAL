---
name: Gráficos nativos em Excel
description: Estratégia para gerar gráficos editáveis em planilhas ExcelJS no navegador.
---

Quando uma exportação ExcelJS precisar de gráficos editáveis, gerar as tabelas auxiliares com fórmulas e inserir os objetos de gráfico no pacote XLSX via OOXML/JSZip, em vez de entregar imagens PNG.

**Why:** O ExcelJS usado pelo projeto não cria gráficos nativos diretamente; imagens não acompanham edições dos dados.

**How to apply:** Manter referências de série ligadas às células auxiliares, habilitar recálculo automático do workbook e evitar confundir gráficos nativos com dashboards rasterizados.