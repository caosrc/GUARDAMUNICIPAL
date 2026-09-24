-- ════════════════════════════════════════════════════════════════════════════
-- Schema da aba MATERIAIS / EMPRÉSTIMOS no Supabase
-- ════════════════════════════════════════════════════════════════════════════
-- Rode este SQL UMA VEZ no SQL Editor do seu projeto Supabase.
-- Cria as tabelas, abre RLS (mesma política do resto do app: o login
-- é validado pelo próprio frontend) e habilita Realtime.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tabela de materiais ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.materiais (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  observacoes TEXT,
  foto        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS materiais_nome_idx ON public.materiais (nome);

-- ── Tabela de empréstimos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emprestimos (
  id                       BIGSERIAL PRIMARY KEY,
  material_id              TEXT NOT NULL REFERENCES public.materiais(id) ON DELETE CASCADE,
  material_codigo          TEXT NOT NULL,
  material_nome            TEXT NOT NULL,
  responsavel              TEXT NOT NULL,
  cpf                      TEXT,
  secretaria               TEXT,
  prazo_dias               INTEGER NOT NULL DEFAULT 7,
  data_emprestimo          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_devolucao_prevista  DATE,
  condicao_equipamento     TEXT,
  observacoes              TEXT,
  agente_emprestador       TEXT,
  assinatura_data          TEXT,
  devolvido_em             TIMESTAMPTZ,
  devolvido_obs            TEXT,
  devolvido_recebedor      TEXT,
  devolvido_foto           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS emprestimos_material_idx ON public.emprestimos (material_id);
CREATE INDEX IF NOT EXISTS emprestimos_ativos_idx  ON public.emprestimos (devolvido_em) WHERE devolvido_em IS NULL;
CREATE INDEX IF NOT EXISTS emprestimos_created_idx ON public.emprestimos (created_at DESC);

-- ── RLS aberta (login é validado pelo app, igual às demais tabelas) ────────
ALTER TABLE public.materiais   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emprestimos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "materiais aberta"   ON public.materiais;
DROP POLICY IF EXISTS "emprestimos aberta" ON public.emprestimos;

CREATE POLICY "materiais aberta"   ON public.materiais   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "emprestimos aberta" ON public.emprestimos FOR ALL USING (true) WITH CHECK (true);

-- ── Realtime (broadcast automático para todos os clientes conectados) ──────
ALTER PUBLICATION supabase_realtime ADD TABLE public.materiais;
ALTER PUBLICATION supabase_realtime ADD TABLE public.emprestimos;
