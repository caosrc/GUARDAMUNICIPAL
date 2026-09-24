export type NivelRisco = 'baixo' | 'medio' | 'alto'
export type StatusOc = 'ativo' | 'resolvido'

export interface Ocorrencia {
  id: number
  tipo: string
  natureza: string
  subnatureza: string | null
  nivel_risco: NivelRisco
  status_oc: StatusOc
  fotos: string[]
  lat: number | null
  lng: number | null
  endereco: string | null
  proprietario: string | null
  situacao: string | null
  recomendacao: string | null
  conclusao: string | null
  data_ocorrencia: string | null
  created_at: string
  agentes: string[]
  responsavel_registro: string | null
  _offline?: boolean
  _localId?: number
}

export const AGENTES = ['Moisés', 'Valteir', 'Arthur', 'Gustavo', 'Vânia', 'Graça', 'Talita', 'Cristiane', 'Dyonathan', 'Sócrates']

export const TIPOS_OCORRENCIA = ['Diligência', 'Vistoria de Engenharia', 'Vistoria Ambiental', 'Apoio', 'Outro']

export const NATUREZAS = [
  'Árvore Gerando Risco (Caída ou Não)',
  'Rompimento de Cabo de Energia',
  'Rompimento de Cabo de Telefonia',
  'Queda de Poste (Total ou Parcial)',
  'Óleo na Pista',
  'Incêndio em Área Urbana',
  'Incêndio em Área Rural',
  'Alagamento',
  'Inundação',
  'Queda de Estrutura',
  'Deslizamento de Massa/Rocha',
  'Processo Erosivo',
  'Apreensão e Captura de Animal',
  'Abelhas/Marimbondo',
  'Vistoria Residencial',
  'Talude em Risco',
]

export const NATUREZA_ICONE: Record<string, string> = {
  'Árvore Gerando Risco (Caída ou Não)': '🌳',
  'Rompimento de Cabo de Energia': '⚡',
  'Rompimento de Cabo de Telefonia': '📡',
  'Queda de Poste (Total ou Parcial)': '🏗️',
  'Óleo na Pista': '🛢️',
  'Incêndio em Área Urbana': '🔥',
  'Incêndio em Área Rural': '🔥',
  'Alagamento': '💧',
  'Inundação': '🌊',
  'Queda de Estrutura': '🏚️',
  'Deslizamento de Massa/Rocha': '⛰️',
  'Processo Erosivo': '🏔️',
  'Apreensão e Captura de Animal': '🐾',
  'Abelhas/Marimbondo': '🐝',
  'Vistoria Residencial': '🏠',
  'Talude em Risco': '🪨',
}

export const NATUREZA_COR: Record<string, string> = {
  'Árvore Gerando Risco (Caída ou Não)': '#16a34a',
  'Rompimento de Cabo de Energia': '#eab308',
  'Rompimento de Cabo de Telefonia': '#7c3aed',
  'Queda de Poste (Total ou Parcial)': '#6b7280',
  'Óleo na Pista': '#78350f',
  'Incêndio em Área Urbana': '#dc2626',
  'Incêndio em Área Rural': '#ea580c',
  'Alagamento': '#2563eb',
  'Inundação': '#0284c7',
  'Queda de Estrutura': '#9f1239',
  'Deslizamento de Massa/Rocha': '#92400e',
  'Processo Erosivo': '#b45309',
  'Apreensão e Captura de Animal': '#7c3aed',
  'Abelhas/Marimbondo': '#ca8a04',
  'Vistoria Residencial': '#0f766e',
  'Talude em Risco': '#854d0e',
}
