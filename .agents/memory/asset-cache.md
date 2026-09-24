---
name: Cache de assets versionados
description: Compatibilidade entre abas antigas, chunks Vite com hash e fallback SPA do servidor.
---

Chunks lazy com hash podem continuar sendo solicitados por abas abertas antes de um novo build. Um fallback SPA que devolve index.html para um asset inexistente transforma a falha em erro de importação dinâmica.

**Why:** O navegador pode conservar um bundle antigo enquanto o servidor já removeu o chunk correspondente ao build anterior.

**How to apply:** Manter o service worker versionado e, para chunks críticos com nomes versionados, responder com o asset atual compatível ou com 404 explícito, nunca com HTML.