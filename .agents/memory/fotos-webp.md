---
name: Fotos WebP
description: Regra de armazenamento e compatibilidade para imagens novas do aplicativo.
---

Novas fotos devem ser redimensionadas e armazenadas em WebP quando o navegador oferecer suporte; fotos antigas em JPEG/PNG continuam válidas e carregáveis.

**Why:** WebP reduz bastante o payload enviado ao Supabase e o espaço ocupado sem exigir migração destrutiva do acervo existente.

**How to apply:** Ao adicionar novos fluxos de fotos, use a conversão WebP antes de persistir. Em exportações para Excel/DOCX, converta a cópia em memória para JPEG quando o formato de destino não aceitar WebP.