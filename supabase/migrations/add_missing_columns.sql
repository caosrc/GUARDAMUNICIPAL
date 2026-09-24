-- Migração: adicionar todas as colunas novas que estão faltando no Supabase
-- Execute no Supabase: https://app.supabase.com → SQL Editor → colar e clicar em Run

-- ── ocorrencias ─────────────────────────────────────────────────────────────
ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS focos_incendio JSONB DEFAULT NULL;
ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS poligono_area_queimada JSONB DEFAULT NULL;
ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS chuva NUMERIC;
ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS hora_inicio VARCHAR(5);
ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS hora_fim VARCHAR(5);
ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS horas_total NUMERIC(5,2);
ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS horas_sobreaviso NUMERIC(5,2);
ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS descricoes_fotos JSONB DEFAULT '[]';
ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS telefone_proprietario TEXT;

-- ── materiais ────────────────────────────────────────────────────────────────
ALTER TABLE materiais ADD COLUMN IF NOT EXISTS foto TEXT;
ALTER TABLE materiais ADD COLUMN IF NOT EXISTS foto_placa TEXT;
ALTER TABLE materiais ADD COLUMN IF NOT EXISTS foto_thumb TEXT;
ALTER TABLE materiais ADD COLUMN IF NOT EXISTS quantidade INTEGER NOT NULL DEFAULT 1;

-- ── emprestimos ──────────────────────────────────────────────────────────────
ALTER TABLE emprestimos ADD COLUMN IF NOT EXISTS quantidade INTEGER NOT NULL DEFAULT 1;
ALTER TABLE emprestimos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'emprestimo';

-- ── equipamentos_campo ───────────────────────────────────────────────────────
ALTER TABLE equipamentos_campo ADD COLUMN IF NOT EXISTS quantidade INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equipamentos_campo ADD COLUMN IF NOT EXISTS prazo_dias INTEGER DEFAULT NULL;
ALTER TABLE equipamentos_campo ADD COLUMN IF NOT EXISTS data_recolha_prevista DATE DEFAULT NULL;

-- ── planejamentos ────────────────────────────────────────────────────────────
ALTER TABLE planejamentos ADD COLUMN IF NOT EXISTS confirmacoes_agentes JSONB DEFAULT '[]';
ALTER TABLE planejamentos ADD COLUMN IF NOT EXISTS fotos_evento JSONB DEFAULT '[]';
ALTER TABLE planejamentos ADD COLUMN IF NOT EXISTS horario_fim TEXT;
ALTER TABLE planejamentos ADD COLUMN IF NOT EXISTS pontos_extras JSONB DEFAULT '[]';
