---
name: Banco de horas — ocorrências automáticas
description: Regras e implementação das horas extras automáticas geradas por ocorrências na Escala.
---

## Regra vigente (Jun 2026)

- **Seg–Sáb, horário sobreaviso (17h–7h)**: ×1,5 hora extra
- **Domingo ou feriado, qualquer horário**: ×1,5 hora extra sobre TODAS as horas (não só 17h–7h)
- **Risco alto (nivel_risco='alto' = "ferido")**: ×2 hora extra
- Label exibido: "×1,5 hora extra" (não mais "×1,5 sobreaviso (17h–7h)")

**Why:** solicitação do Moisés — agentes que atenderam ocorrências fora do horário normal acumulam banco multiplicado automaticamente sem lançamento manual.

## Onde fica cada peça

- `src/horasUtils.ts` → `calcularHorasOcorrenciaBanco()`: retorna as **horas qualificadas brutas** (sem multiplicador)
  - Domingo/feriado: `calcularHorasTotal` (todas as horas)
  - Outros dias: `calcularHorasSobreaviso` (apenas 17h–7h)
- `src/components/EscalaAgentes.tsx` → `computarHorasOcorrencias()`: aplica o multiplicador
  - `ehFeriadoOuDomingo` → usa `horas_total` como base (todas as horas)
  - `nivel_risco === 'alto'` → multiplicador = `1 + percDomFer/100` (padrão ×2)
  - Demais → multiplicador = `1 + percSobreaviso/100` (padrão ×1,5)
- `src/components/NovaOcorrencia.tsx` e `DetalheOcorrencia.tsx`: salvam `horas_sobreaviso` = horas brutas **sem** multiplicador

## Gotchas

- O campo `horas_sobreaviso` no banco **não** deve ter o multiplicador pré-aplicado — o multiplicador é aplicado somente em EscalaAgentes.tsx na hora de exibir
- Dados históricos no Supabase de Junho/2026 foram salvos com `horas_sobreaviso = horas_total` (sem filtro 17h-7h) — compatível com a nova lógica pois domingo/feriado usa `horas_total` de qualquer jeito
- Prop `ocorrencias?: Ocorrencia[]` em BancoHorasAgente/BancoHorasMoises — sempre verificar se está sendo propagada de App.tsx

**How to apply:** ao mexer em BancoHorasAgente ou BancoHorasMoises, sempre checar se `ocorrencias` está sendo propagado corretamente como prop. Ao alterar regras de multiplicador, alterar `computarHorasOcorrencias` em EscalaAgentes.tsx.
