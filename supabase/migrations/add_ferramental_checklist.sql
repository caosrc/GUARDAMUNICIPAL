-- Categorias do Patrimônio e histórico de checklist de ferramental.
ALTER TABLE public.materiais
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'escritorio';

ALTER TABLE public.materiais
  DROP CONSTRAINT IF EXISTS materiais_categoria_check;

ALTER TABLE public.materiais
  ADD CONSTRAINT materiais_categoria_check
  CHECK (categoria IN ('escritorio', 'ferramental'));

CREATE TABLE IF NOT EXISTS public.checklists_ferramental (
  id BIGSERIAL PRIMARY KEY,
  ferramenta_id TEXT NOT NULL REFERENCES public.materiais(id) ON DELETE CASCADE,
  quantidade_cadastrada INTEGER NOT NULL CHECK (quantidade_cadastrada > 0),
  quantidade_conferida INTEGER NOT NULL CHECK (
    quantidade_conferida >= 0 AND quantidade_conferida <= quantidade_cadastrada
  ),
  condicao TEXT NOT NULL CHECK (condicao IN ('boa', 'media', 'ruim')),
  item_faltante TEXT,
  justificativa TEXT,
  realizado_por TEXT,
  data_checklist TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS checklists_ferramental_ferramenta_idx
  ON public.checklists_ferramental (ferramenta_id, data_checklist DESC);

-- Permite que o app web leia e registre checklists usando a chave anon.
ALTER TABLE public.checklists_ferramental ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checklists ferramental leitura" ON public.checklists_ferramental;
CREATE POLICY "checklists ferramental leitura"
  ON public.checklists_ferramental
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "checklists ferramental inserção" ON public.checklists_ferramental;
CREATE POLICY "checklists ferramental inserção"
  ON public.checklists_ferramental
  FOR INSERT
  WITH CHECK (true);

GRANT SELECT, INSERT ON TABLE public.checklists_ferramental TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.checklists_ferramental_id_seq TO anon, authenticated;

-- Serragem é controlada pela quantidade de sacos, sem condição Boa/Média/Ruim.
ALTER TABLE public.checklists_ferramental
  DROP CONSTRAINT IF EXISTS checklists_ferramental_condicao_check;

ALTER TABLE public.checklists_ferramental
  ADD CONSTRAINT checklists_ferramental_condicao_check
  CHECK (condicao IN ('boa', 'media', 'ruim', 'quantidade'));