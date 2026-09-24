---
name: Bootstrap do sandbox
description: Regra de inicialização para serviços Vite em artefatos isolados
---

O workflow de um artefato isolado não deve depender das dependências instaladas pelo aplicativo principal; a própria inicialização do serviço precisa preparar o `node_modules` do artefato.

**Why:** O workflow do sandbox pode iniciar sem executar o `npm install` do projeto raiz, fazendo comandos locais como `vite` falharem mesmo quando o pacote está declarado corretamente no `package.json`.

**How to apply:** Ao configurar ou recuperar um preview de artefato, mantenha o bootstrap de dependências no comando do serviço e use `--no-package-lock` quando essa for a convenção do workspace.