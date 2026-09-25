---
name: Verificação TypeScript do projeto
description: Limite atual entre a verificação de build e o typecheck completo do workspace.
---

O build Vite é o gate confiável para validar mudanças de frontend neste workspace. O typecheck completo ainda reúne diagnósticos preexistentes em vários módulos e usa opções de TypeScript incompatíveis com a versão instalada, portanto seus erros precisam ser separados dos erros introduzidos pela mudança.

**Why:** uma execução do typecheck pode falhar em arquivos não relacionados mesmo quando o bundle de produção compila e o workflow sobe normalmente.

**How to apply:** rode `npm run build` e verifique os logs do workflow após alterações; use `tsc` apenas para investigar regressões específicas, não como critério único de conclusão até a dívida existente ser tratada.