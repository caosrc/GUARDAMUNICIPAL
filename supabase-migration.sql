-- ============================================================
-- Defesa Civil Ouro Branco — Supabase Schema Migration
-- Execute no SQL Editor do painel Supabase
-- ============================================================

-- Ocorrências
CREATE TABLE IF NOT EXISTS ocorrencias (
  id                              BIGSERIAL PRIMARY KEY,
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  tipo                            TEXT,
  natureza                        TEXT,
  subnatureza                     TEXT,
  nivel_risco                     TEXT,
  status_oc                       TEXT DEFAULT 'ativo',
  fotos                           JSONB DEFAULT '[]',
  lat                             DOUBLE PRECISION,
  lng                             DOUBLE PRECISION,
  endereco                        TEXT,
  proprietario                    TEXT,
  telefone_proprietario           TEXT,
  situacao                        TEXT,
  recomendacao                    TEXT,
  conclusao                       TEXT,
  data_ocorrencia                 TEXT,
  agentes                         JSONB DEFAULT '[]',
  responsavel_registro            TEXT,
  vistorias                       JSONB DEFAULT '[]'
);

ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS telefone_proprietario TEXT;

-- Escala / banco de horas (linha única, id=1)
CREATE TABLE IF NOT EXISTS escala_estado (
  id          INT PRIMARY KEY DEFAULT 1,
  data        JSONB,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Checklists de viatura
CREATE TABLE IF NOT EXISTS checklists_viatura (
  id               BIGSERIAL PRIMARY KEY,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  data_checklist   TEXT,
  km               TEXT,
  placa            TEXT,
  motorista        TEXT,
  fotos_avarias    JSONB DEFAULT '[]',
  foto_frontal     TEXT,
  foto_traseira    TEXT,
  foto_direita     TEXT,
  foto_esquerda    TEXT,
  itens            JSONB DEFAULT '{}',
  observacoes      TEXT,
  assinatura_data  TEXT
);

-- Materiais / patrimônio
CREATE TABLE IF NOT EXISTS materiais (
  id           TEXT PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  nome         TEXT NOT NULL,
  descricao    TEXT,
  observacoes  TEXT,
  foto         TEXT,
  foto_thumb   TEXT,
  foto_placa   TEXT,
  quantidade   INT DEFAULT 1
);

-- Empréstimos de materiais
CREATE TABLE IF NOT EXISTS emprestimos (
  id                      BIGSERIAL PRIMARY KEY,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  material_id             TEXT REFERENCES materiais(id) ON DELETE CASCADE,
  material_codigo         TEXT,
  material_nome           TEXT,
  responsavel             TEXT NOT NULL,
  cpf                     TEXT,
  secretaria              TEXT,
  prazo_dias              INT DEFAULT 7,
  quantidade              INT DEFAULT 1,
  data_devolucao_prevista TEXT,
  condicao_equipamento    TEXT,
  observacoes             TEXT,
  agente_emprestador      TEXT,
  assinatura_data         TEXT,
  tipo                    TEXT DEFAULT 'emprestimo',
  devolvido_em            TIMESTAMPTZ,
  devolvido_obs           TEXT,
  devolvido_recebedor     TEXT,
  devolvido_foto          TEXT
);

-- Push subscriptions (notificações)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  agente      TEXT,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL
);

-- Equipamentos em campo
CREATE TABLE IF NOT EXISTS equipamentos_campo (
  id                      BIGSERIAL PRIMARY KEY,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  material_id             TEXT,
  material_nome           TEXT,
  fotos                   JSONB,
  latitude                DOUBLE PRECISION,
  longitude               DOUBLE PRECISION,
  rua                     TEXT,
  numero                  TEXT,
  bairro                  TEXT,
  observacao              TEXT,
  quantidade              INT DEFAULT 1,
  prazo_dias              INT,
  data_recolha_prevista   TEXT,
  status                  TEXT DEFAULT 'ativo',
  agente                  TEXT
);

-- SOS ativos em tempo real
CREATE TABLE IF NOT EXISTS sos_ativos_db (
  id             TEXT PRIMARY KEY,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  agente         TEXT,
  lat            DOUBLE PRECISION,
  lng            DOUBLE PRECISION,
  bateria        INT,
  audio          TEXT,
  timestamp      BIGINT,
  visualizadores JSONB DEFAULT '[]',
  mensagens      JSONB DEFAULT '[]'
);

-- ============================================================
-- Desabilitar RLS (app não usa autenticação Supabase)
-- ============================================================
ALTER TABLE ocorrencias         DISABLE ROW LEVEL SECURITY;
ALTER TABLE escala_estado        DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklists_viatura   DISABLE ROW LEVEL SECURITY;
ALTER TABLE materiais            DISABLE ROW LEVEL SECURITY;
ALTER TABLE emprestimos          DISABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions   DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipamentos_campo   DISABLE ROW LEVEL SECURITY;
ALTER TABLE sos_ativos_db        DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Habilitar Realtime nas tabelas necessárias
-- (Execute separadamente se precisar)
-- ============================================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE sos_ativos_db;
-- ALTER PUBLICATION supabase_realtime ADD TABLE ocorrencias;
