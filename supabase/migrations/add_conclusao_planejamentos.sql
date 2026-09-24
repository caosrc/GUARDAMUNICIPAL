-- Adiciona coluna conclusao na tabela planejamentos
-- Execute no SQL Editor do Supabase: https://app.supabase.com → SQL Editor
ALTER TABLE planejamentos ADD COLUMN IF NOT EXISTS conclusao TEXT;
