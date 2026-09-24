---
name: Ordem de callbacks React
description: Regra para evitar falhas de renderização ao declarar callbacks com dependências locais.
---

Callbacks criados durante a renderização não devem listar, nas dependências, uma constante declarada mais abaixo no mesmo componente.

**Why:** arrays de dependências são avaliados imediatamente; uma referência `const` ainda na zona temporal morta causa falha de execução antes de qualquer fallback visual aparecer.

**How to apply:** declare primeiro as funções/valores usados como dependências e só depois crie o `useCallback` que os referencia. Depois de mexer na ordem, confirme o bundle e capture o preview, não apenas o resultado do build.