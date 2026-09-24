-- Execute no SQL Editor do projeto Supabase usado pelo Netlify.
-- A operação é idempotente e pode ser executada mais de uma vez.
CREATE TABLE IF NOT EXISTS public.monitoramento_cnl_cotas (
  id INTEGER PRIMARY KEY,
  atencao DOUBLE PRECISION NOT NULL,
  alerta DOUBLE PRECISION NOT NULL,
  transbordamento DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitoramento_cnl_cotas_ordem
    CHECK (atencao >= 0 AND atencao < alerta AND alerta < transbordamento)
);

ALTER TABLE public.monitoramento_cnl_cotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cotas cnl abertas" ON public.monitoramento_cnl_cotas;
CREATE POLICY "cotas cnl abertas"
  ON public.monitoramento_cnl_cotas
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE public.monitoramento_cnl_cotas TO anon, authenticated;