-- ════════════════════════════════════════════════════════════════════════════
-- CODAP — schema base legado do Supabase.
-- Para instalar todas as tabelas atuais de Defesa Civil, Curral e Procon,
-- execute o arquivo supabase/supabase-completo.sql no SQL Editor.
-- Projeto atual: lhmjpioaoqwkchtomnla
-- ════════════════════════════════════════════════════════════════════════════

-- ── Ocorrências ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ocorrencias (
  id          BIGSERIAL PRIMARY KEY,
  tipo        TEXT,
  natureza    TEXT,
  subnatureza TEXT,
  nivel_risco TEXT,
  status_oc   TEXT DEFAULT 'ativo',
  fotos       JSONB DEFAULT '[]',
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  endereco    TEXT,
  proprietario TEXT,
  telefone_proprietario TEXT,
  situacao    TEXT,
  recomendacao TEXT,
  conclusao   TEXT,
  data_ocorrencia TEXT,
  agentes     JSONB DEFAULT '[]',
  responsavel_registro TEXT,
  vistorias   JSONB DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ocorrencias
  ADD COLUMN IF NOT EXISTS telefone_proprietario TEXT;

ALTER TABLE public.ocorrencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ocorrencias aberta" ON public.ocorrencias;
CREATE POLICY "ocorrencias aberta" ON public.ocorrencias FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.ocorrencias;

-- ── Escala ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.escala_estado (
  id         INTEGER PRIMARY KEY,
  data       JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.escala_estado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "escala aberta" ON public.escala_estado;
CREATE POLICY "escala aberta" ON public.escala_estado FOR ALL USING (true) WITH CHECK (true);

-- ── Checklists da Viatura ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checklists_viatura (
  id              BIGSERIAL PRIMARY KEY,
  data_checklist  TEXT,
  km              TEXT,
  placa           TEXT,
  motorista       TEXT,
  fotos_avarias   JSONB DEFAULT '[]',
  foto_frontal    TEXT,
  foto_traseira   TEXT,
  foto_direita    TEXT,
  foto_esquerda   TEXT,
  itens           JSONB DEFAULT '{}',
  observacoes     TEXT,
  assinatura_data TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.checklists_viatura ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "checklists aberta" ON public.checklists_viatura;
CREATE POLICY "checklists aberta" ON public.checklists_viatura FOR ALL USING (true) WITH CHECK (true);

-- ── Materiais ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.materiais (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  observacoes TEXT,
  foto        TEXT,
  foto_placa  TEXT,
  quantidade  INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS materiais_nome_idx ON public.materiais (nome);

ALTER TABLE public.materiais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "materiais aberta" ON public.materiais;
CREATE POLICY "materiais aberta" ON public.materiais FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.materiais;

-- ── Empréstimos ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emprestimos (
  id                      BIGSERIAL PRIMARY KEY,
  material_id             TEXT NOT NULL REFERENCES public.materiais(id) ON DELETE CASCADE,
  material_codigo         TEXT NOT NULL,
  material_nome           TEXT NOT NULL,
  responsavel             TEXT NOT NULL,
  cpf                     TEXT,
  secretaria              TEXT,
  prazo_dias              INTEGER NOT NULL DEFAULT 7,
  quantidade              INTEGER NOT NULL DEFAULT 1,
  data_emprestimo         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_devolucao_prevista DATE,
  condicao_equipamento    TEXT,
  observacoes             TEXT,
  agente_emprestador      TEXT,
  assinatura_data         TEXT,
  devolvido_em            TIMESTAMPTZ,
  devolvido_obs           TEXT,
  devolvido_recebedor     TEXT,
  devolvido_foto          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS emprestimos_material_idx ON public.emprestimos (material_id);
CREATE INDEX IF NOT EXISTS emprestimos_ativos_idx   ON public.emprestimos (devolvido_em) WHERE devolvido_em IS NULL;
CREATE INDEX IF NOT EXISTS emprestimos_created_idx  ON public.emprestimos (created_at DESC);

ALTER TABLE public.emprestimos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "emprestimos aberta" ON public.emprestimos;
CREATE POLICY "emprestimos aberta" ON public.emprestimos FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.emprestimos;

-- ── Push Subscriptions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         TEXT PRIMARY KEY,
  agente     TEXT,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push aberta" ON public.push_subscriptions;
CREATE POLICY "push aberta" ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- ── Equipamentos em Campo ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipamentos_campo (
  id                    BIGSERIAL PRIMARY KEY,
  material_id           TEXT REFERENCES public.materiais(id) ON DELETE SET NULL,
  material_nome         TEXT,
  fotos                 JSONB,
  latitude              DOUBLE PRECISION,
  longitude             DOUBLE PRECISION,
  rua                   TEXT,
  numero                TEXT,
  bairro                TEXT,
  observacao            TEXT,
  quantidade            INTEGER NOT NULL DEFAULT 1,
  prazo_dias            INTEGER,
  data_recolha_prevista DATE,
  status                TEXT NOT NULL DEFAULT 'ativo',
  agente                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.equipamentos_campo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campo aberta" ON public.equipamentos_campo;
CREATE POLICY "campo aberta" ON public.equipamentos_campo FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.equipamentos_campo;

-- ── SOS Ativos (persistência entre sessões) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_ativos_db (
  id           TEXT PRIMARY KEY,
  agente       TEXT NOT NULL,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  bateria      INTEGER,
  audio        TEXT,
  timestamp    BIGINT NOT NULL,
  visualizadores JSONB DEFAULT '[]',
  mensagens    JSONB DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sos_ativos_db ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sos aberta" ON public.sos_ativos_db;
CREATE POLICY "sos aberta" ON public.sos_ativos_db FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_ativos_db;
