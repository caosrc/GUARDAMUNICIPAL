---
name: Planejamento features
description: Push notifications, confirmação de presença, fotos e Excel no módulo Planejamento
---

# Planejamento — features de eventos (Mai 2026)

## O que foi implementado

### DB
- `confirmacoes_agentes JSONB DEFAULT '[]'` — confirmações por agente
- `fotos_evento JSONB DEFAULT '[]'` — base64 das fotos registradas no evento
- Adicionados via `ALTER TABLE IF NOT EXISTS` no `initDB` de `server/index.js`

### Server routes
- `POST /api/planejamentos/:id/confirmar` — agente confirma/cancela presença; envia push ao criador quando confirmado
- `POST /api/planejamentos/:id/fotos` — adiciona fotos (base64[]) ao evento
- `DELETE /api/planejamentos/:id/fotos/:idx` — remove foto por índice
- `POST /api/push/escala` — envia push VAPID para lista de agentes (campo `agentes`)

### Push helpers
- `enviarPushParaAgentes(agentesAlvo, payloadJson, excluirAgente?)` — filtra push_subscriptions por nome de agente e envia; limpa subs expiradas
- `notificarEventosDoDia()` — checa eventos com `data_inicio = hoje` e notifica agentes escalados; roda 8s após boot e a cada 6h

### Service Worker (sw.js)
- Push handler atualizado: lê `data.tipo` (`sos`|`escala`|`confirmacao`|`evento_dia`)
- SOS mantém vibração/requireInteraction alta
- `escala`: vibração suave, requireInteraction, ação "Confirmar presença"
- `evento_dia`: silent, ação "Abrir app"

### Planejamento.tsx
- `ConfirmacaoAgente` interface: `{ agente, confirmado, confirmedAt? }`
- `Plano` interface: campos opcionais `confirmacoes` e `fotosEvento`
- `sbParaPlano`: lê `confirmacoes_agentes` e `fotos_evento` do DB
- `planosRef` no componente principal para comparar agentes antes/depois sem dep circular
- `notificarAgentesNovos(plano)`: compara com `planosRef.current`, chama `/api/push/escala`
- `salvarPlano` e `atualizarPlano` chamam `notificarAgentesNovos`
- `exportarEventoExcel(plano)`: ExcelJS lazy-import, exporta info + agentes com status de confirmação + fotos embutidas

### UI em DetalheP
- Botão 📊 Excel no header (ao lado de 📄 PDF e ✏️)
- Card "🧑‍🚒 Confirmações de Presença": lista agentes com badge ✅/⏳, botão "Confirmar minha presença" para o agente logado
- Card "📸 Fotos do Evento": grid de fotos, upload múltiplo, remoção individual

**Why:** Solicitação do usuário para fechar o ciclo do evento (escalar → notificar → confirmar → registrar → exportar).

**How to apply:** Os novos campos são opcionais na interface, retrocompatíveis com planos antigos (fallback `?? []`).
