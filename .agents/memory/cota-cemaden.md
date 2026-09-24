---
name: Cota CEMADEN
description: Particularidade das fontes públicas do CEMADEN usadas para a cota instantânea de Rio Bananeiras.
---

A cota instantânea deve priorizar a série hidrológica detalhada do CEMADEN, calculada como `offset - valor`. O catálogo resumido pode publicar `ultimovalor: 0` com horário mais recente enquanto a série detalhada já informa a leitura correta de aproximadamente 0,3 m.

**Why:** Comparar apenas o horário do catálogo fazia o aplicativo substituir uma medição hidrológica válida por zero e exibir um nível incorreto no gráfico e nos cartões.

**How to apply:** Ao ajustar a integração da estação 6622, use o catálogo apenas como fallback quando não houver medida detalhada válida; mantenha a série detalhada como referência do nível.