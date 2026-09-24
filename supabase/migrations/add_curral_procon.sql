-- Tabelas usadas pelas abas Curral e Procon quando o app roda no Netlify.
-- Execute no SQL Editor do Supabase uma vez.

CREATE TABLE IF NOT EXISTS public.curral_registros (
  id BIGSERIAL PRIMARY KEY,
  especie TEXT NOT NULL,
  porte TEXT NOT NULL,
  sexo TEXT,
  identificacao TEXT,
  local_descricao TEXT NOT NULL,
  observacoes TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  precisao_gps DOUBLE PRECISION,
  capturado_em TEXT NOT NULL,
  fotos JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'encontrado',
  criado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.curral_registros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "curral aberto" ON public.curral_registros;
CREATE POLICY "curral aberto"
  ON public.curral_registros FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS curral_registros_created_at_idx
  ON public.curral_registros (created_at DESC);

CREATE TABLE IF NOT EXISTS public.monitoramento_cnl_cotas (
  id INTEGER PRIMARY KEY,
  atencao DOUBLE PRECISION NOT NULL,
  alerta DOUBLE PRECISION NOT NULL,
  transbordamento DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.monitoramento_cnl_cotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cotas cnl abertas" ON public.monitoramento_cnl_cotas;
CREATE POLICY "cotas cnl abertas"
  ON public.monitoramento_cnl_cotas FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.radar_bilhetes
  ADD COLUMN IF NOT EXISTS confirmacoes_agentes JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.procon_relatorios (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pendente',
  dados JSONB NOT NULL,
  criado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.procon_relatorios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "procon aberto" ON public.procon_relatorios;
CREATE POLICY "procon aberto"
  ON public.procon_relatorios FOR ALL USING (true) WITH CHECK (true);