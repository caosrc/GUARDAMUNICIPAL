export type NivelRisco = 'baixo' | 'medio' | 'alto'
export type StatusOc = 'ativo' | 'resolvido'

export type CategoriaOcorrencia =
  | 'seguranca'
  | 'patrimonio'
  | 'transito'
  | 'perturbacao'
  | 'pessoas'
  | 'escolas'
  | 'espaco-publico'
  | 'eventos'
  | 'meio-ambiente'
  | 'defesa-civil'
  | 'animais'
  | 'atendimento-social'
  | 'fiscalizacao'
  | 'apoio'
  | 'outros'

export interface CategoriaGuarda {
  id: CategoriaOcorrencia
  titulo: string
  descricao: string
  natureza: string
  tipo: string
  sigla: string
}

export const CATEGORIAS_GUARDA: CategoriaGuarda[] = [
  { id: 'seguranca', titulo: 'Segurança', descricao: 'Furto, ameaça e agressão', natureza: 'Ameaça', tipo: 'Diligência', sigla: 'SEG' },
  { id: 'patrimonio', titulo: 'Patrimônio público', descricao: 'Dano, vandalismo e invasão', natureza: 'Dano ao patrimônio público', tipo: 'Diligência', sigla: 'PAT' },
  { id: 'transito', titulo: 'Trânsito', descricao: 'Acidentes e infrações', natureza: 'Acidente de Trânsito', tipo: 'Apoio', sigla: 'TRÂ' },
  { id: 'perturbacao', titulo: 'Perturbação', descricao: 'Conflitos e sossego', natureza: 'Perturbação do sossego', tipo: 'Diligência', sigla: 'PER' },
  { id: 'pessoas', titulo: 'Pessoas', descricao: 'Desaparecidos e vulneráveis', natureza: 'Pessoa em situação de vulnerabilidade', tipo: 'Apoio', sigla: 'PES' },
  { id: 'escolas', titulo: 'Escolas', descricao: 'Proteção do entorno escolar', natureza: 'Ocorrência escolar', tipo: 'Diligência', sigla: 'ESC' },
  { id: 'espaco-publico', titulo: 'Espaço público', descricao: 'Praças, parques e próprios', natureza: 'Dano ao patrimônio público', tipo: 'Vistoria de Engenharia', sigla: 'ESP' },
  { id: 'eventos', titulo: 'Eventos', descricao: 'Apoio e controle de acesso', natureza: 'Apoio a evento', tipo: 'Apoio', sigla: 'EVE' },
  { id: 'meio-ambiente', titulo: 'Meio ambiente', descricao: 'Descarte e dano ambiental', natureza: 'Dano ambiental', tipo: 'Vistoria Ambiental', sigla: 'AMB' },
  { id: 'defesa-civil', titulo: 'Defesa Civil', descricao: 'Riscos e emergências', natureza: 'Risco estrutural', tipo: 'Vistoria de Engenharia', sigla: 'DC' },
  { id: 'animais', titulo: 'Animais', descricao: 'Animal solto ou ferido', natureza: 'Animal solto', tipo: 'Diligência', sigla: 'ANI' },
  { id: 'atendimento-social', titulo: 'Atendimento social', descricao: 'Apoio e vulnerabilidade', natureza: 'Atendimento social', tipo: 'Apoio', sigla: 'SOC' },
  { id: 'fiscalizacao', titulo: 'Fiscalização', descricao: 'Comércio e posturas', natureza: 'Fiscalização municipal', tipo: 'Fiscalização', sigla: 'FIS' },
  { id: 'apoio', titulo: 'Apoio a órgãos', descricao: 'PM, Bombeiros, SAMU e outros', natureza: 'Apoio a órgão', tipo: 'Apoio', sigla: 'APO' },
  { id: 'outros', titulo: 'Outros', descricao: 'Atendimento não enquadrado', natureza: '', tipo: 'Outro', sigla: 'OUT' },
]

export interface VistoriaAdicional {
  data: string
  observacao: string
  fotos: string[]
  agente: string | null
  status?: StatusOc
}

export interface Ocorrencia {
  id: number
  tipo: string
  natureza: string
  subnatureza: string | null
  nivel_risco: NivelRisco
  status_oc: StatusOc
  fotos: string[]
  descricoes_fotos?: string[] | null
  lat: number | null
  lng: number | null
  endereco: string | null
  proprietario: string | null
  telefone_proprietario?: string | null
  situacao: string | null
  recomendacao: string | null
  conclusao: string | null
  data_ocorrencia: string | null
  hora_inicio: string | null
  hora_fim: string | null
  horas_total: number | null
  horas_sobreaviso: number | null
  created_at: string
  agentes: string[]
  responsavel_registro: string | null
  vistorias: VistoriaAdicional[] | null
  focos_incendio?: { lat: number; lng: number }[] | null
  poligono_area_queimada?: { lat: number; lng: number }[] | null
  chuva?: number | null
  metragem_lona?: number | null
  origem?: 'curral'
  _offline?: boolean
  _localId?: number
}

/** Agentes atualmente disponíveis no acesso e nas telas operacionais. */
export const AGENTES = ['Agente 1', 'Agente 2', 'Agente 3', 'Agente 4', 'Agente 5']

/** Compatibilidade para sessões e escalas criadas antes da anonimização dos nomes. */
export const AGENTES_LEGADOS_PARA_NOVOS: Record<string, string> = {
  A: 'Agente 1',
  B: 'Agente 2',
  C: 'Agente 3',
  D: 'Agente 4',
  E: 'Agente 5',
  Alexandre: 'Agente 1',
  Arthur: 'Agente 2',
  Lucas: 'Agente 3',
  Junior: 'Agente 4',
  Rosane: 'Agente 5',
  'Moisés': 'Agente 1',
  Valteir: 'Agente 2',
}

export function normalizarNomeAgente(nome: string): string {
  const valor = String(nome ?? '').trim()
  return AGENTES_LEGADOS_PARA_NOVOS[valor] ?? valor
}

/** Agente 2 também administra registros criados pelo agente legado J. */
export function agentePodeGerenciarCriacao(criador: string | null | undefined, agente: string | null | undefined): boolean {
  const nomeCriador = String(criador ?? '').trim()
  const nomeAgente = normalizarNomeAgente(String(agente ?? '').trim())
  return nomeCriador === nomeAgente
    || (nomeAgente === 'Agente 2' && nomeCriador === 'J')
}

export const AGENTE_SENHAS: Record<string, string> = {
  'Agente 1': '4668',
  'Agente 2': '1234',
  'Agente 3': '0356',
  'Agente 4': '1234',
  'Agente 5': '1969',
  // Mantidos para sessões antigas que ainda carreguem a identificação A–J.
  A: '1234',
  B: '1234',
  C: '1234',
  D: '1234',
  E: '1234',
  F: '1234',
  G: '1234',
  H: '1234',
  I: '1234',
  J: '1234',
}

export function getSenhaAgente(nome: string): string | null {
  return AGENTE_SENHAS[normalizarNomeAgente(nome)] ?? null
}

export const TIPOS_OCORRENCIA = ['Diligência', 'Vistoria de Engenharia', 'Vistoria Ambiental', 'Apoio', 'Outro']

export const NATUREZAS = [
  'Furto',
  'Tentativa de furto',
  'Roubo',
  'Ameaça',
  'Agressão',
  'Dano ao patrimônio público',
  'Vandalismo',
  'Invasão de próprio público',
  'Acidente de Trânsito',
  'Infração de Trânsito',
  'Veículo abandonado',
  'Perturbação do sossego',
  'Pessoa desaparecida',
  'Pessoa em situação de vulnerabilidade',
  'Ocorrência escolar',
  'Apoio a evento',
  'Dano ambiental',
  'Risco estrutural',
  'Animal solto',
  'Atendimento social',
  'Fiscalização municipal',
  'Apoio a órgão',
  'Incêndio em Área Urbana',
  'Incêndio em Área Rural',
  'Vistoria Preventiva',
  'Sistema de Drenagem',
  'Precariedade em residência',
  'Pavimentação',
  'Inundação',
  'Infiltrações',
  'Hidrológico/Geológico',
  'Hidrológico/Estrutural',
  'Hidrológico',
  'Geológico',
  'Estrutural/Geológico',
  'Estrutural',
  'Corte/poda árvores',
  'Colisão veículo/residência',
  'Alagamento',
  'Entrega de Lona',
]

export const NATUREZA_ICONE: Record<string, string> = {
  'Furto': 'F',
  'Tentativa de furto': 'F',
  'Roubo': 'R',
  'Ameaça': 'A',
  'Agressão': 'AG',
  'Dano ao patrimônio público': 'P',
  'Vandalismo': 'V',
  'Invasão de próprio público': 'I',
  'Acidente de Trânsito': 'T',
  'Infração de Trânsito': 'T',
  'Veículo abandonado': 'V',
  'Perturbação do sossego': 'PS',
  'Pessoa desaparecida': 'PD',
  'Pessoa em situação de vulnerabilidade': 'PS',
  'Ocorrência escolar': 'E',
  'Apoio a evento': 'EV',
  'Dano ambiental': 'MA',
  'Risco estrutural': 'RE',
  'Animal solto': 'AN',
  'Atendimento social': 'AS',
  'Fiscalização municipal': 'FI',
  'Apoio a órgão': 'AP',
  'Árvore Gerando Risco (Caída ou Não)': '🌳',
  'Rompimento de Cabo de Energia': '⚡',
  'Rompimento de Cabo de Telefonia': '📡',
  'Queda de Poste (Total ou Parcial)': '🏗️',
  'Óleo na Pista': '🛢️',
  'Incêndio em Área Urbana': '🔥',
  'Incêndio em Área Rural': '🔥',
  'Alagamento': '💧',
  'Entrega de Lona': '🟦',
  'Inundação': '🌊',
  'Queda de Estrutura': '🏚️',
  'Deslizamento de Massa/Rocha': '⛰️',
  'Processo Erosivo': '🏔️',
  'Apreensão e Captura de Animal': '🐾',
  'Captura de animal': '🐾',
  'Abelhas/Marimbondo': '🐝',
  'Vistoria Residencial': '🏠',
  'Talude em Risco': '🪨',
  'Interdição de Imóvel': '🚫',
  'Interdição de Via': '🚧',
  'Sinalização de Segurança': '🚦',
  'Eventos': '🎪',
  'Apreensão de animal': '🐾',
  'Vistoria Preventiva': '🔎',
  'Sistema de Drenagem': '🕳️',
  'Precariedade em residência': '🏚️',
  'Pavimentação': '🛣️',
  'Infiltrações': '💧',
  'Hidrológico/Geológico': '🌧️',
  'Hidrológico/Estrutural': '🌧️',
  'Hidrológico': '🌧️',
  'Geológico': '⛰️',
  'Estrutural/Geológico': '🏚️',
  'Estrutural': '🏗️',
  'Corte/poda árvores': '🌳',
  'Colisão veículo/residência': '🚗',
  'Fiscalização': '⚖️',
  'Fiscalização Procon': '⚖️',
}

export const NATUREZA_COR: Record<string, string> = {
  'Furto': '#b91c1c',
  'Tentativa de furto': '#dc2626',
  'Roubo': '#991b1b',
  'Ameaça': '#be123c',
  'Agressão': '#9f1239',
  'Dano ao patrimônio público': '#c2410c',
  'Vandalismo': '#ea580c',
  'Invasão de próprio público': '#7c2d12',
  'Acidente de Trânsito': '#b45309',
  'Infração de Trânsito': '#d97706',
  'Veículo abandonado': '#a16207',
  'Perturbação do sossego': '#6d28d9',
  'Pessoa desaparecida': '#4338ca',
  'Pessoa em situação de vulnerabilidade': '#2563eb',
  'Ocorrência escolar': '#0369a1',
  'Apoio a evento': '#0f766e',
  'Dano ambiental': '#15803d',
  'Risco estrutural': '#92400e',
  'Animal solto': '#7c3aed',
  'Atendimento social': '#1d4ed8',
  'Fiscalização municipal': '#0f766e',
  'Apoio a órgão': '#334155',
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
  'Captura de animal': '#7c3aed',
  'Abelhas/Marimbondo': '#ca8a04',
  'Vistoria Residencial': '#0f766e',
  'Talude em Risco': '#854d0e',
  'Interdição de Imóvel': '#b91c1c',
  'Interdição de Via': '#c2410c',
  'Sinalização de Segurança': '#f59e0b',
  'Eventos': '#0891b2',
  'Apreensão de animal': '#7c3aed',
  'Vistoria Preventiva': '#0f766e',
  'Sistema de Drenagem': '#2563eb',
  'Precariedade em residência': '#92400e',
  'Pavimentação': '#64748b',
  'Infiltrações': '#0284c7',
  'Hidrológico/Geológico': '#0369a1',
  'Hidrológico/Estrutural': '#0e7490',
  'Hidrológico': '#0891b2',
  'Geológico': '#92400e',
  'Estrutural/Geológico': '#9f1239',
  'Estrutural': '#6b7280',
  'Corte/poda árvores': '#16a34a',
  'Colisão veículo/residência': '#ef4444',
  'Fiscalização': '#0f766e',
  'Fiscalização Procon': '#0f766e',
}
