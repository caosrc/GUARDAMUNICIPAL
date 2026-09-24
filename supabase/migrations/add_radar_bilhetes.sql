-- Persistência compartilhada do Radar DC no Netlify/Supabase
CREATE TABLE IF NOT EXISTS public.radar_bilhetes (
  id TEXT PRIMARY KEY,
  texto TEXT NOT NULL,
  data TEXT NOT NULL,
  hora TEXT NOT NULL,
  prioridade TEXT NOT NULL DEFAULT 'normal',
  concluido BOOLEAN NOT NULL DEFAULT FALSE,
  criado_por TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo TEXT NOT NULL DEFAULT 'lembrete',
  agentes_envolvidos TEXT[] NOT NULL DEFAULT '{}'
);

ALTER TABLE public.radar_bilhetes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radar_bilhetes
  ADD COLUMN IF NOT EXISTS agentes_envolvidos TEXT[] NOT NULL DEFAULT '{}';

DROP POLICY IF EXISTS "radar bilhetes aberto" ON public.radar_bilhetes;
CREATE POLICY "radar bilhetes aberto"
  ON public.radar_bilhetes
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS radar_bilhetes_data_hora_idx
  ON public.radar_bilhetes (data, hora, criado_em);

-- Permite que os outros agentes recebam atualizações em tempo real.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'radar_bilhetes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.radar_bilhetes;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;
