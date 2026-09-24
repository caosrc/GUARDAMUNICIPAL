-- Migração: adicionar campos de quantidade e prazo às tabelas
-- Execute este SQL no Supabase SQL Editor: https://app.supabase.com → SQL Editor

-- Adiciona a quantidade total no catálogo de materiais (padrão = 1)
ALTER TABLE materiais
  ADD COLUMN IF NOT EXISTS quantidade INTEGER NOT NULL DEFAULT 1;

-- Adiciona quantidade no registro de empréstimo (quantas unidades foram emprestadas)
ALTER TABLE emprestimos
  ADD COLUMN IF NOT EXISTS quantidade INTEGER NOT NULL DEFAULT 1;

-- Adiciona quantidade e prazo no registro de equipamento em campo
ALTER TABLE equipamentos_campo
  ADD COLUMN IF NOT EXISTS quantidade INTEGER NOT NULL DEFAULT 1;

ALTER TABLE equipamentos_campo
  ADD COLUMN IF NOT EXISTS prazo_dias INTEGER DEFAULT NULL;

ALTER TABLE equipamentos_campo
  ADD COLUMN IF NOT EXISTS data_recolha_prevista DATE DEFAULT NULL;
