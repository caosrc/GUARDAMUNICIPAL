import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap, Circle } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getAgenteLogado } from './Login'
import { AGENTES, getSenhaAgente, normalizarNomeAgente } from '../types'
import { wsOn, wsSend } from '../wsClient'
import { ativarGps, desativarGps, subscribeGps, getEstadoGps, getDispositivoIdGlobal, getNomeAgenteGlobal } from '../gpsService'
import { supabase, supabaseDisponivel } from '../supabaseClient'
import { saveFotoCampoPendente, getFotosCampoPendentes, removeFotoCampoPendente, clearFotosCampoPendentesPlano } from '../offline'
import { salvarFotoNoDispositivo } from '../utils'
import RadarGM, { type RadarPatrulhamentoDraft } from './RadarDC'

const ORGAOS_EMPENHO: { categoria: string; emoji: string; orgaos: { emoji: string; nome: string }[] }[] = [
  { categoria: 'Segurança Pública', emoji: '🚔', orgaos: [
    { emoji: '🚓', nome: 'Polícia Militar' },
    { emoji: '🚔', nome: 'Polícia Rodoviária' },
    { emoji: '👮', nome: 'Guarda Municipal' },
    { emoji: '🚨', nome: 'Polícia Civil' },
    { emoji: '🛡️', nome: 'Defesa Social' },
    { emoji: '🎖️', nome: 'Exército Brasileiro' },
    { emoji: '🛰️', nome: 'Inteligência/NIA' },
    { emoji: '🐕', nome: 'Canil Operacional' },
    { emoji: '🚁', nome: 'Apoio Aéreo' },
  ]},
  { categoria: 'Resgate e Emergência', emoji: '🚒', orgaos: [
    { emoji: '🚒', nome: 'Corpo de Bombeiros' },
    { emoji: '🚑', nome: 'SAMU' },
    { emoji: '🧯', nome: 'Brigada de Incêndio' },
    { emoji: '⛑️', nome: 'Defesa Civil' },
    { emoji: '🏥', nome: 'Equipe Médica' },
    { emoji: '🩺', nome: 'Vigilância Sanitária' },
    { emoji: '🛟', nome: 'Resgate Aquático' },
  ]},
  { categoria: 'Prefeitura', emoji: '🏛️', orgaos: [
    { emoji: '🏛️', nome: 'Prefeitura Municipal' },
    { emoji: '🚧', nome: 'Secretaria de Obras' },
    { emoji: '🌳', nome: 'Meio Ambiente' },
    { emoji: '🚦', nome: 'Trânsito' },
    { emoji: '💡', nome: 'Iluminação Pública' },
    { emoji: '🚛', nome: 'Limpeza Urbana' },
    { emoji: '🏠', nome: 'Habitação' },
    { emoji: '👨‍👩‍👧', nome: 'Assistência Social' },
    { emoji: '🏫', nome: 'Educação' },
    { emoji: '🩹', nome: 'Secretaria de Saúde' },
  ]},
  { categoria: 'Infraestrutura', emoji: '🏗️', orgaos: [
    { emoji: '💧', nome: 'COPASA' },
    { emoji: '⚡', nome: 'CEMIG' },
    { emoji: '📡', nome: 'Telecomunicações' },
    { emoji: '🛣️', nome: 'DER' },
    { emoji: '🚜', nome: 'Máquinas Pesadas' },
    { emoji: '🏗️', nome: 'Engenharia Municipal' },
    { emoji: '🌉', nome: 'Infraestrutura' },
  ]},
  { categoria: 'Empresas Privadas', emoji: '🏭', orgaos: [
    { emoji: '🏭', nome: 'Empresa Privada' },
    { emoji: '🚛', nome: 'Transportadora' },
    { emoji: '⛏️', nome: 'Mineração' },
    { emoji: '🏗️', nome: 'Construtora' },
    { emoji: '🚜', nome: 'Terraplanagem' },
    { emoji: '🛠️', nome: 'Manutenção Industrial' },
    { emoji: '🔌', nome: 'Energia Privada' },
  ]},
  { categoria: 'Apoio Operacional', emoji: '📦', orgaos: [
    { emoji: '🍞', nome: 'Alimentação' },
    { emoji: '🥤', nome: 'Distribuição Água' },
    { emoji: '⛺', nome: 'Apoio Logístico' },
    { emoji: '📦', nome: 'Almoxarifado' },
    { emoji: '🔋', nome: 'Geradores' },
    { emoji: '📢', nome: 'Comunicação' },
    { emoji: '📻', nome: 'Rádio Operação' },
  ]},
  { categoria: 'Eventos', emoji: '🎪', orgaos: [
    { emoji: '🎪', nome: 'Organização Evento' },
    { emoji: '🎤', nome: 'Produção Evento' },
    { emoji: '🎫', nome: 'Controle Acesso' },
    { emoji: '🧍', nome: 'Segurança Privada' },
    { emoji: '🚧', nome: 'Equipe Montagem' },
    { emoji: '🎵', nome: 'Apoio Técnico' },
  ]},
  { categoria: 'Trânsito e Mobilidade', emoji: '🚦', orgaos: [
    { emoji: '🚦', nome: 'Agentes de Trânsito' },
    { emoji: '🚌', nome: 'Transporte Público' },
    { emoji: '🚕', nome: 'Apoio Mobilidade' },
    { emoji: '🚧', nome: 'Interdição Viária' },
    { emoji: '🛣️', nome: 'Rotas Alternativas' },
  ]},
  { categoria: 'Ambiental', emoji: '🌱', orgaos: [
    { emoji: '🌧️', nome: 'Monitoramento Climático' },
    { emoji: '🌊', nome: 'Recursos Hídricos' },
    { emoji: '⛰️', nome: 'Geologia' },
    { emoji: '🌱', nome: 'Defesa Ambiental' },
    { emoji: '🪨', nome: 'Monitoramento Encostas' },
  ]},
  { categoria: 'Apoio Humanitário', emoji: '🤝', orgaos: [
    { emoji: '🏠', nome: 'Abrigos' },
    { emoji: '🍲', nome: 'Cozinha Solidária' },
    { emoji: '👶', nome: 'Apoio Crianças' },
    { emoji: '🛏️', nome: 'Assistência Humanitária' },
    { emoji: '🧥', nome: 'Distribuição Roupas' },
    { emoji: '🐶', nome: 'Resgate Animal' },
  ]},
  { categoria: 'Comunicação e Tecnologia', emoji: '📡', orgaos: [
    { emoji: '📡', nome: 'Centro Operacional' },
    { emoji: '🖥️', nome: 'Monitoramento' },
    { emoji: '📹', nome: 'Videomonitoramento' },
    { emoji: '🛰️', nome: 'Drone Operacional' },
    { emoji: '📱', nome: 'TI/Comunicação' },
    { emoji: '🔊', nome: 'Carro de Som' },
  ]},
  { categoria: 'Saúde', emoji: '🏥', orgaos: [
    { emoji: '🏥', nome: 'Hospital' },
    { emoji: '🩺', nome: 'UPA' },
    { emoji: '💉', nome: 'Vacinação' },
    { emoji: '🚑', nome: 'Ambulância Particular' },
    { emoji: '🧪', nome: 'Laboratório' },
  ]},
]
import './Planejamento.css'

const PlanoEmergencia = lazy(() => import('./PlanoEmergencia'))

// Corrige ícones do Leaflet com Vite
delete (L.Icon.Default.prototype as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ── Tipos ──────────────────────────────────────────────────────────────
type TipoPlano = 'evento' | 'operacao' | 'simulado' | 'emergencia'
type SubAbaPlanejamento = TipoPlano | 'radar'
type StatusPlano = 'planejado' | 'em_curso' | 'concluido' | 'cancelado'

interface MaterialPlano {
  id: string
  nome: string
  quantidade: number
  unidade: string
}

interface ItemMapa {
  id: string
  tipo: string
  emoji: string
  lat: number
  lng: number
  obs?: string
}

interface PontoExtra {
  id: string
  lat: number
  lng: number
  label: string
}

interface ConfirmacaoAgente {
  agente: string
  confirmado: boolean
  confirmedAt?: string
}

interface FotoGeolocada {
  id: string
  foto: string
  thumb?: string
  lat: number | null
  lng: number | null
  agente: string
  timestamp: number
  status?: 'salvo' | 'pendente'
  _localId?: number
}

interface Plano {
  id: string
  tipo: TipoPlano
  nome: string
  descricao: string
  local: string
  dataInicio: string
  dataFim: string
  horario: string
  horarioFim: string
  publicoEstimado: string
  status: StatusPlano
  equipe: string[]
  agentesDefesaCivil?: string[]
  materiais: MaterialPlano[]
  itensMapa: ItemMapa[]
  pontosExtras: PontoExtra[]
  lat: number | null
  lng: number | null
  observacoes: string
  risco: 'baixo' | 'medio' | 'alto'
  criadoPor: string
  criadoEm: string
  confirmacoes?: ConfirmacaoAgente[]
  fotosEvento?: (string | FotoGeolocada)[]
  conclusao?: string
}

// ── Conversão GMS (Graus, Minutos, Segundos) ─────────────────────────────
function decimalParaGMS(decimal: number, tipo: 'lat' | 'lng'): string {
  const abs = Math.abs(decimal)
  const graus = Math.floor(abs)
  const minRaw = (abs - graus) * 60
  const minutos = Math.floor(minRaw)
  const segundos = ((minRaw - minutos) * 60).toFixed(1)
  const dir = tipo === 'lat' ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'L' : 'O')
  return `${graus}°${minutos}'${segundos}"${dir}`
}

function gmsParaDecimal(gms: string): number | null {
  const s = gms.trim().replace(',', '.')
  const m = s.match(/^(\d+)[°\s](\d+)['´\s](\d+\.?\d*)["'`\s]*([NSnsEeOoWwLl])?/)
  if (!m) {
    const d = parseFloat(s)
    return isNaN(d) ? null : d
  }
  const dec = parseInt(m[1]) + parseInt(m[2]) / 60 + parseFloat(m[3]) / 3600
  return (m[4] && 'SsOoWw'.includes(m[4])) ? -dec : dec
}

// ── Mapeamento Plano ↔ Supabase ─────────────────────────────────────────
function planoParaSB(p: Plano): Record<string, unknown> {
  return {
    id: p.id, tipo: p.tipo, nome: p.nome, descricao: p.descricao, local: p.local,
    data_inicio: p.dataInicio, data_fim: p.dataFim, horario: p.horario,
    horario_fim: p.horarioFim, publico_estimado: p.publicoEstimado,
    status: p.status, equipe: p.equipe,
    agentes_defesa_civil: (p.agentesDefesaCivil ?? []).map(normalizarNomeAgente),
    materiais: p.materiais, itens_mapa: p.itensMapa, pontos_extras: p.pontosExtras,
    lat: p.lat, lng: p.lng, observacoes: p.observacoes, risco: p.risco,
    criado_por: p.criadoPor, criado_em: p.criadoEm,
    conclusao: p.conclusao ?? null,
  }
}

function sbParaPlano(row: Record<string, unknown>): Plano {
  return {
    id: row.id as string, tipo: row.tipo as TipoPlano, nome: row.nome as string,
    descricao: (row.descricao as string) ?? '', local: (row.local as string) ?? '',
    dataInicio: (row.data_inicio as string) ?? '', dataFim: (row.data_fim as string) ?? '',
    horario: (row.horario as string) ?? '', horarioFim: (row.horario_fim as string) ?? '',
    publicoEstimado: (row.publico_estimado as string) ?? '',
    status: (row.status as StatusPlano) ?? 'planejado',
    equipe: (row.equipe as string[]) ?? [],
    agentesDefesaCivil: Array.isArray(row.agentes_defesa_civil)
      ? (row.agentes_defesa_civil as string[]).map(normalizarNomeAgente)
      : [],
    materiais: (row.materiais as MaterialPlano[]) ?? [],
    itensMapa: (row.itens_mapa as ItemMapa[]) ?? [],
    pontosExtras: (row.pontos_extras as PontoExtra[]) ?? [],
    lat: (row.lat as number) ?? null, lng: (row.lng as number) ?? null,
    observacoes: (row.observacoes as string) ?? '',
    risco: (row.risco as 'baixo' | 'medio' | 'alto') ?? 'baixo',
    criadoPor: row.criado_por ? normalizarNomeAgente(String(row.criado_por)) : '',
    criadoEm: row.criado_em instanceof Date
      ? row.criado_em.toISOString()
      : ((row.criado_em as string) ?? new Date().toISOString()),
    confirmacoes: (row.confirmacoes_agentes as ConfirmacaoAgente[]) ?? [],
    fotosEvento: (row.fotos_evento as (string | FotoGeolocada)[]) ?? [],
    conclusao: (row.conclusao as string) ?? '',
  }
}

// ── Constantes ──────────────────────────────────────────────────────────
const STORAGE_KEY = 'defesacivil-planejamentos-v1'

// Registra o momento em que cada plano foi salvo localmente.
// carregarDoServidor usa isso para não sobrescrever dados salvos recentemente.
const planosProtegidos = new Map<string, number>() // id → timestamp (ms)

const TIPOS_CONFIG: Record<TipoPlano, {
  label: string
  emoji: string
  cor: string
  descricao: string
  exemploNome: string
  descricaoPlaceholder: string
  atividades: string[]
}> = {
  evento: {
    label: 'Eventos',
    emoji: '🎪',
    cor: '#1a6bbf',
    descricao: 'Prevenção, ordenamento, trânsito e proteção do patrimônio durante eventos.',
    exemploNome: 'Apoio preventivo — evento na Praça Central',
    descricaoPlaceholder: 'Informe público previsto, pontos de controle, circulação, rotas de emergência e órgãos de apoio.',
    atividades: [
      'Definir postos de patrulhamento e pontos de presença',
      'Organizar acessos, filas e circulação segura',
      'Mapear saídas de emergência e pontos de encontro',
      'Planejar bloqueios, desvios e apoio ao trânsito',
      'Proteger prédios e equipamentos municipais no entorno',
    ],
  },
  operacao: {
    label: 'Operações',
    emoji: '🚨',
    cor: '#dc2626',
    descricao: 'Patrulhamento preventivo, proteção de próprios públicos e apoio a ações municipais.',
    exemploNome: 'Operação de proteção escolar — bairro',
    descricaoPlaceholder: 'Registre objetivo, setores, equipes e viaturas, comunicação e órgãos parceiros.',
    atividades: [
      'Planejar patrulhamento preventivo por setor',
      'Proteger escolas e outros próprios municipais',
      'Apoiar fiscalização e operações intersetoriais',
      'Definir pontos de encontro, comunicação e responsáveis',
      'Registrar critérios de encerramento e resultados',
    ],
  },
  simulado: {
    label: 'Patrulhamento',
    emoji: '🛡️',
    cor: '#7c3aed',
    descricao: 'Treinamento de equipes, comunicação por rádio e resposta coordenada.',
    exemploNome: 'Simulado de evacuação — prédio público',
    descricaoPlaceholder: 'Descreva o cenário, os objetivos, os participantes, a sequência do exercício e a avaliação.',
    atividades: [
      'Treinar acionamento de equipes e comunicação por rádio',
      'Exercitar isolamento seguro de uma área',
      'Simular evacuação e orientação do público',
      'Treinar integração com Bombeiros, SAMU, PM e Defesa Civil',
      'Registrar tempos de resposta e lições aprendidas',
    ],
  },
  emergencia: {
    label: 'Emergencial',
    emoji: '⚠️',
    cor: '#ea580c',
    descricao: 'Mobilização da Guarda para proteger pessoas e áreas públicas e apoiar a resposta municipal.',
    exemploNome: 'Resposta emergencial — proteção de área',
    descricaoPlaceholder: 'Descreva a situação, a área, as medidas de segurança e a coordenação com os órgãos responsáveis.',
    atividades: [
      'Acionar a equipe e confirmar viaturas e comunicação',
      'Organizar o perímetro e apoiar interdições de segurança',
      'Orientar a circulação e proteger acessos a áreas públicas',
      'Acionar o órgão competente e registrar as atualizações',
      'Documentar ocorrências, decisões e passagem de serviço',
    ],
  },
}

const STATUS_CONFIG: Record<StatusPlano, { label: string; emoji: string; classe: string }> = {
  planejado: { label: 'Planejado',  emoji: '📋', classe: 'planejado' },
  em_curso:  { label: 'Em curso',   emoji: '🟢', classe: 'em_curso'  },
  concluido: { label: 'Concluído',  emoji: '✅', classe: 'concluido' },
  cancelado: { label: 'Cancelado',  emoji: '❌', classe: 'cancelado' },
}

// Título da seção de fotos no PDF/Excel — varia conforme o tipo do planejamento
const LABEL_FOTOS_TIPO: Record<TipoPlano, string> = {
  evento:     'Fotos do Evento',
  operacao:   'Fotos da Operação',
  simulado:   'Fotos do Simulado',
  emergencia: 'Fotos do Emergencial',
}

const ITENS_POSICIONAR = [
  { tipo: 'tenda',       emoji: '⛺', label: 'Tenda' },
  { tipo: 'barraca',     emoji: '🏕️', label: 'Barraca' },
  { tipo: 'banheiro',    emoji: '🚻', label: 'Banheiro' },
  { tipo: 'agua',        emoji: '💧', label: 'Água' },
  { tipo: 'gerador',     emoji: '⚡', label: 'Gerador' },
  { tipo: 'pm',          emoji: '🚓', label: 'PM' },
  { tipo: 'guarda',      emoji: '🚔', label: 'G.M.' },
  { tipo: 'bombeiro',    emoji: '🚒', label: 'Bombeiro' },
  { tipo: 'samu',        emoji: '🚑', label: 'SAMU' },
  { tipo: 'interdicao',  emoji: '🚧', label: 'Interdição' },
  { tipo: 'cone',        emoji: '🔶', label: 'Cone' },
  { tipo: 'info',        emoji: '📢', label: 'Info' },
  { tipo: 'alimentacao', emoji: '🍞', label: 'Alimentação' },
  { tipo: 'medico',      emoji: '🏥', label: 'Apoio Méd.' },
  { tipo: 'extintor',    emoji: '🧯', label: 'Extintor' },
  { tipo: 'abrigo',      emoji: '🏠', label: 'Abrigo' },
]

const RISCO_CONFIG = {
  baixo: { label: 'Baixo', cor: '#16a34a', bg: '#dcfce7' },
  medio: { label: 'Médio', cor: '#d97706', bg: '#fef3c7' },
  alto:  { label: 'Alto',  cor: '#dc2626', bg: '#fee2e2' },
}

function getEmojiMaterial(nome: string): string {
  const n = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/tenda|barraca|acampamento/.test(n)) return '⛺'
  if (/extintor/.test(n)) return '🧯'
  if (/gerador|energia/.test(n)) return '⚡'
  if (/cone/.test(n)) return '🔶'
  if (/banheiro|sanitari|wc|toalet/.test(n)) return '🚻'
  if (/agua|hidrat|caixa.*agua|ponto.*agua/.test(n)) return '💧'
  if (/copo|garrafa/.test(n)) return '🥤'
  if (/ambulancia|samu/.test(n)) return '🚑'
  if (/posto.*medic|medic|saude/.test(n)) return '🏥'
  if (/maca|leito|cama/.test(n)) return '🛏️'
  if (/dea|desfibrilador/.test(n)) return '❤️'
  if (/kit|primeiros.*socorro|socorros/.test(n)) return '🧰'
  if (/epi|colete|capacete|vestimenta/.test(n)) return '🦺'
  if (/radio|ht|walkie/.test(n)) return '📻'
  if (/iluminac|luz|reflet|lampada/.test(n)) return '💡'
  if (/fita|zebrada|barreira|bloqueio/.test(n)) return '🚧'
  if (/grade/.test(n)) return '🚏'
  if (/cavalete/.test(n)) return '🐴'
  if (/placa|sinalizac|sinalizacao/.test(n)) return '🪧'
  if (/palco|microfone|som|audio/.test(n)) return '🎤'
  if (/cadeira/.test(n)) return '🪑'
  if (/mesa/.test(n)) return '🪑'
  if (/abrigo|casa/.test(n)) return '🏠'
  if (/alimentac|comida|refeic|marmita|lanche|genero/.test(n)) return '🍞'
  if (/bombeir/.test(n)) return '🚒'
  if (/policia|pm|viatura.*policia/.test(n)) return '🚓'
  if (/guarda.*municipal|guarda/.test(n)) return '🚔'
  if (/computador|notebook|tablet/.test(n)) return '💻'
  if (/caminhao|caminhão|caminhonete/.test(n)) return '🚚'
  if (/moto/.test(n)) return '🏍️'
  if (/carro|veiculo|veículo/.test(n)) return '🚗'
  if (/maquina|equipamento/.test(n)) return '⚙️'
  if (/lona|cobertura/.test(n)) return '🏕️'
  if (/corda|cabo/.test(n)) return '🪢'
  if (/pá|enxada|ferramenta/.test(n)) return '⛏️'
  return '📦'
}

const PRE_LISTAS: { nome: string; emoji: string; itens: { emoji: string; label: string }[] }[] = [
  { nome: 'Segurança', emoji: '🛡️', itens: [
    { emoji: '🟧', label: 'Cones' },
    { emoji: '🚧', label: 'Fita zebrada' },
    { emoji: '🐴', label: 'Cavaletes' },
    { emoji: '🚏', label: 'Grades' },
    { emoji: '💡', label: 'Iluminação' },
    { emoji: '🧯', label: 'Extintores' },
    { emoji: '📻', label: 'Rádio HT' },
    { emoji: '🦺', label: 'EPI' },
    { emoji: '🛑', label: 'Barreiras' },
  ]},
  { nome: 'Trânsito', emoji: '🚦', itens: [
    { emoji: '🚧', label: 'Bloqueio de vias' },
    { emoji: '↪️',  label: 'Desvio' },
    { emoji: '🪧', label: 'Sinalização' },
    { emoji: '🪧', label: 'Placas' },
    { emoji: '🔶', label: 'Cones refletivos' },
    { emoji: '🚓', label: 'Viatura trânsito' },
    { emoji: '🗺️', label: 'Rota alternativa' },
  ]},
  { nome: 'Saúde', emoji: '🏥', itens: [
    { emoji: '🚑', label: 'Ambulância' },
    { emoji: '🚑', label: 'SAMU' },
    { emoji: '🏥', label: 'Posto médico' },
    { emoji: '🛏️', label: 'Maca' },
    { emoji: '❤️', label: 'DEA' },
    { emoji: '🧰', label: 'Kit primeiros socorros' },
    { emoji: '💧', label: 'Água potável' },
  ]},
  { nome: 'Estrutura', emoji: '🏗️', itens: [
    { emoji: '⛺', label: 'Tendas' },
    { emoji: '🏕️', label: 'Barracas' },
    { emoji: '🪑', label: 'Cadeiras' },
    { emoji: '🪑', label: 'Mesas' },
    { emoji: '🎤', label: 'Palco' },
    { emoji: '⚡', label: 'Gerador' },
    { emoji: '💡', label: 'Iluminação' },
    { emoji: '🚻', label: 'Banheiro químico' },
  ]},
  { nome: 'Apoio Operacional', emoji: '🤝', itens: [
    { emoji: '🤲', label: 'Apoio social' },
    { emoji: '🏘️', label: 'Vizinhança' },
    { emoji: '🙋', label: 'Voluntários' },
    { emoji: '🧑‍⚕️', label: 'Assistência social' },
  ]},
  { nome: 'Hidratação', emoji: '💧', itens: [
    { emoji: '🚰', label: 'Ponto de água' },
    { emoji: '🗃️', label: "Caixa d'água" },
    { emoji: '🥤', label: 'Copos' },
    { emoji: '💧', label: 'Distribuição água' },
  ]},
  { nome: 'Comunicação', emoji: '📡', itens: [
    { emoji: '📻', label: 'Rádio HT' },
    { emoji: '📡', label: 'Repetidora' },
    { emoji: '🌐', label: 'Internet' },
    { emoji: '📶', label: 'Ponto Wi-Fi' },
    { emoji: '📢', label: 'Megafone' },
    { emoji: '🔊', label: 'Carro som' },
  ]},
  { nome: 'Clima/Chuva', emoji: '🌧️', itens: [
    { emoji: '🟦', label: 'Lona' },
    { emoji: '🏠', label: 'Abrigo' },
    { emoji: '🌊', label: 'Drenagem' },
    { emoji: '💦', label: 'Bomba água' },
    { emoji: '🌡️', label: 'Monitoramento clima' },
  ]},
  { nome: 'Evacuação', emoji: '🚪', itens: [
    { emoji: '🏃', label: 'Rota fuga' },
    { emoji: '🚪', label: 'Saída emergência' },
    { emoji: '📍', label: 'Ponto encontro' },
    { emoji: '🔦', label: 'Iluminação emergência' },
  ]},
  { nome: 'Logística', emoji: '⚙️', itens: [
    { emoji: '⛽', label: 'Combustível' },
    { emoji: '🍱', label: 'Alimentação equipes' },
    { emoji: '🔌', label: 'Energia' },
    { emoji: '🔋', label: 'Carregadores' },
    { emoji: '🔧', label: 'Ferramentas' },
  ]},
]

const CONSELHEIRO_LAFAIETE_CENTER: [number, number] = [-20.6604, -43.7863]
// Coordenada padrão para fotos sem GPS: 20° 30' 54,72" S  43° 41' 27,64" W
const LAT_FOTO_PADRAO = -(20 + 30 / 60 + 54.72 / 3600)  // -20.51520
const LNG_FOTO_PADRAO = -(43 + 41 / 60 + 27.64 / 3600)  // -43.69101

// ── Persistência ────────────────────────────────────────────────────────
function carregarPlanos(): Plano[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return (JSON.parse(raw) as Plano[]).map(plano => ({
      ...plano,
      agentesDefesaCivil: (plano.agentesDefesaCivil ?? []).map(normalizarNomeAgente),
      criadoPor: plano.criadoPor ? normalizarNomeAgente(plano.criadoPor) : '',
      confirmacoes: (plano.confirmacoes ?? []).map(confirmacao => ({
        ...confirmacao,
        agente: normalizarNomeAgente(confirmacao.agente),
      })),
    }))
  } catch { return [] }
}

function salvarPlanos(planos: Plano[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(planos)) } catch { /* ignore */ }
}

function gerarId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// Decompõe decimal em componentes GMS para preencher campos do formulário de edição
function decomporDecimalGMS(decimal: number, tipo: 'lat' | 'lng') {
  const abs = Math.abs(decimal)
  const graus = Math.floor(abs)
  const minDecimal = (abs - graus) * 60
  const minutos = Math.floor(minDecimal)
  const segundos = Math.round((minDecimal - minutos) * 60 * 10) / 10
  const direcao = tipo === 'lat' ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'L' : 'O')
  return { graus, minutos, segundos, direcao }
}

// Converte componentes GMS separados para decimal (oposto de decomporDecimalGMS)
function gmsComponentesParaDecimal(graus: number, minutos: number, segundos: number, direcao: string): number {
  const decimal = graus + minutos / 60 + segundos / 3600
  return (direcao === 'S' || direcao === 'O') ? -decimal : decimal
}

// Alias legível para decimalParaGMS (que já existe) — usado nos popups e no PDF
const formatarGMS = decimalParaGMS

function formatarData(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function pluralMat(n: number): string {
  return n === 1 ? '1 material' : `${n} materiais`
}

// ── Ícone personalizado para itens no mapa ──────────────────────────────
function criarIconeEmoji(emoji: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:1.6rem;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))">${emoji}</div>`,
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  })
}

function criarIconePrincipal(): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:28px;height:28px;background:#1a4b8c;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
    className: '',
    iconAnchor: [14, 14],
    popupAnchor: [0, -18],
  })
}

function criarIconeEu(nome: string): L.DivIcon {
  const iniciais = nome.split(' ').map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('') || 'EU'
  const primeiroNome = nome.split(' ')[0] || nome
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;">
      <div style="
        background:#d97706;width:38px;height:38px;border-radius:50%;
        border:3px solid white;
        box-shadow:0 0 0 3px #d97706,0 3px 12px rgba(0,0,0,0.45);
        display:flex;align-items:center;justify-content:center;
        color:white;font-weight:900;font-size:12px;font-family:sans-serif;
      ">${iniciais}</div>
      <div style="position:absolute;bottom:-17px;left:50%;transform:translateX(-50%);
        background:rgba(217,119,6,0.95);color:white;font-size:7px;padding:1px 5px;
        border-radius:3px;white-space:nowrap;font-family:sans-serif;max-width:64px;
        overflow:hidden;text-overflow:ellipsis;font-weight:800;line-height:1.4;">
        ${primeiroNome}
      </div>
    </div>`,
    iconSize: [38, 56],
    iconAnchor: [19, 38],
    popupAnchor: [0, -42],
  })
}

function criarIconeCentro(): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center">
      <div style="width:20px;height:20px;background:rgba(26,75,140,0.18);border:2.5px dashed #1a4b8c;border-radius:50%;display:flex;align-items:center;justify-content:center">
        <div style="width:5px;height:5px;background:#1a4b8c;border-radius:50%"></div>
      </div>
    </div>`,
    className: '',
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  })
}

// ── Componente de clique no mapa ────────────────────────────────────────
function criarIconeAgente(nome: string): L.DivIcon {
  const iniciais = nome.split(' ').map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('') || '?'
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;">
      <div style="
        background:#059669;width:36px;height:36px;border-radius:50%;
        border:2.5px solid white;
        box-shadow:0 0 0 2.5px #059669,0 3px 10px rgba(0,0,0,0.4);
        display:flex;align-items:center;justify-content:center;
        color:white;font-weight:800;font-size:12px;font-family:sans-serif;
        letter-spacing:-0.02em;
      ">${iniciais}</div>
      <div style="position:absolute;bottom:-16px;left:50%;transform:translateX(-50%);
        background:rgba(5,150,105,0.92);color:white;font-size:7px;padding:1px 5px;
        border-radius:3px;white-space:nowrap;font-family:sans-serif;max-width:64px;
        overflow:hidden;text-overflow:ellipsis;font-weight:700;line-height:1.4;">
        ${nome.split(' ')[0]}
      </div>
    </div>`,
    iconSize: [36, 54],
    iconAnchor: [18, 36],
    popupAnchor: [0, -40],
  })
}

function criarIconeAgentePlanejado(nome: string): L.DivIcon {
  const iniciais = nome.split(' ').map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('') || '?'
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;">
      <div style="
        background:#1a4b8c;width:36px;height:36px;border-radius:50%;
        border:2.5px solid white;
        box-shadow:0 0 0 2.5px #1a4b8c,0 3px 10px rgba(0,0,0,0.4);
        display:flex;align-items:center;justify-content:center;
        color:white;font-weight:800;font-size:12px;font-family:sans-serif;
        letter-spacing:-0.02em;
      ">${iniciais}</div>
      <div style="position:absolute;bottom:-16px;left:50%;transform:translateX(-50%);
        background:rgba(26,75,140,0.92);color:white;font-size:7px;padding:1px 5px;
        border-radius:3px;white-space:nowrap;font-family:sans-serif;max-width:64px;
        overflow:hidden;text-overflow:ellipsis;font-weight:700;line-height:1.4;">
        ${nome.split(' ')[0]}
      </div>
    </div>`,
    iconSize: [36, 54],
    iconAnchor: [18, 36],
    popupAnchor: [0, -40],
  })
}

function criarIconeCone(): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:36px;height:44px;display:flex;align-items:flex-end;justify-content:center;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.45))">
      <svg viewBox="0 0 36 46" width="34" height="42" xmlns="http://www.w3.org/2000/svg">
        <polygon points="18,2 33,40 3,40" fill="#e85d04" stroke="none"/>
        <rect x="8" y="28" width="20" height="3.5" rx="1.5" fill="white" opacity="0.92"/>
        <rect x="11" y="20" width="14" height="3" rx="1.5" fill="white" opacity="0.92"/>
        <rect x="2" y="40" width="32" height="5" rx="2.5" fill="#555" stroke="none"/>
      </svg>
    </div>`,
    className: '',
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -46],
  })
}

function criarIconeFoto(thumb: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5))">
      <div style="width:54px;height:54px;border-radius:8px;overflow:hidden;border:3px solid #1a4b8c;background:#e2e8f0">
        <img src="${thumb}" style="width:100%;height:100%;object-fit:cover"/>
      </div>
      <div style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:14px solid #1a4b8c;margin-top:-1px"></div>
    </div>`,
    iconSize: [54, 70],
    iconAnchor: [27, 70],
    popupAnchor: [0, -74],
  })
}

async function criarThumbnail(b64: string, maxDim = 120): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * ratio)
      canvas.height = Math.round(img.height * ratio)
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(b64); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.75))
    }
    img.onerror = () => resolve(b64)
    img.src = b64
  })
}

function FlyToGpsOnKey({ posicao, flyKey }: { posicao: { lat: number; lng: number } | null; flyKey: number }) {
  const map = useMap()
  const prevKey = useRef(-1)
  useEffect(() => {
    if (!posicao || flyKey === prevKey.current) return
    prevKey.current = flyKey
    map.flyTo([posicao.lat, posicao.lng], Math.max(map.getZoom(), 16), { duration: 1.2 })
  }, [flyKey, posicao, map])
  return null
}

function MapInvalidateSize({ trigger }: { trigger?: unknown }) {
  const map = useMap()
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 200)
    return () => clearTimeout(id)
  }, [map, trigger])
  return null
}

function MapClickHandler({ onClique, ativo }: { onClique: (lat: number, lng: number) => void; ativo: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (ativo) {
      map.dragging.disable()
      map.getContainer().style.cursor = 'crosshair'
    } else {
      map.dragging.enable()
      map.getContainer().style.cursor = ''
    }
    return () => {
      map.dragging.enable()
      map.getContainer().style.cursor = ''
    }
  }, [ativo, map])
  useMapEvents({
    click(e) {
      if (ativo) onClique(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function FlyToMarca({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => { map.flyTo([lat, lng], 15, { duration: 1.2 }) }, [lat, lng, map])
  return null
}

function FlyToMe({ posicao, ativo }: { posicao: { lat: number; lng: number } | null | undefined; ativo: boolean }) {
  const map = useMap()
  const jaCentralizou = useRef(false)
  useEffect(() => {
    if (!ativo) { jaCentralizou.current = false; return }
    if (posicao && !jaCentralizou.current) {
      jaCentralizou.current = true
      map.flyTo([posicao.lat, posicao.lng], Math.max(map.getZoom(), 16), { duration: 1.4 })
    }
  }, [posicao, ativo, map])
  return null
}

function InputGMS({
  valor, tipo, onChange,
}: {
  valor: number | null
  tipo: 'lat' | 'lng'
  onChange: (v: number | null) => void
}) {
  const [texto, setTexto] = useState(() => valor != null ? decimalParaGMS(valor, tipo) : '')
  const [erro, setErro] = useState(false)

  useEffect(() => {
    if (valor != null) setTexto(decimalParaGMS(valor, tipo))
    else setTexto('')
  }, [valor, tipo])

  function handleBlur() {
    if (!texto.trim()) { onChange(null); setErro(false); return }
    const dec = gmsParaDecimal(texto)
    if (dec === null) { setErro(true); return }
    setErro(false)
    onChange(dec)
    setTexto(decimalParaGMS(dec, tipo))
  }

  return (
    <input
      type="text"
      value={texto}
      onChange={e => { setTexto(e.target.value); setErro(false) }}
      onBlur={handleBlur}
      placeholder={tipo === 'lat' ? "20°31'10.5\"S" : "43°41'54.3\"O"}
      style={{
        width: '100%', padding: '0.38rem 0.5rem',
        border: `1.5px solid ${erro ? '#ef4444' : '#cbd5e1'}`,
        borderRadius: 7, fontSize: '0.8rem', outline: 'none', fontFamily: 'monospace',
        background: erro ? '#fff1f2' : undefined,
      }}
    />
  )
}

// ── Modal tela-cheia para selecionar localização ─────────────────────────
function MapaPickerModal({
  lat, lng, onConfirmar, onFechar,
}: {
  lat: number | null
  lng: number | null
  onConfirmar: (lat: number, lng: number) => void
  onFechar: () => void
}) {
  const [marcado, setMarcado] = useState<{ lat: number; lng: number } | null>(
    lat && lng ? { lat, lng } : null
  )
  const centro: [number, number] = marcado
    ? [marcado.lat, marcado.lng]
    : lat && lng ? [lat, lng] : CONSELHEIRO_LAFAIETE_CENTER

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'flex', flexDirection: 'column', background: '#1a4b8c' }}>
      {/* Cabeçalho */}
      <div style={{ background: 'linear-gradient(100deg,#123b73,#1a6bbf)', color: 'white', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0, paddingTop: 'calc(0.75rem + env(safe-area-inset-top,0px))' }}>
        <button
          onClick={onFechar}
          style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: '50%', width: 38, height: 38, fontSize: '1.3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        >‹</button>
        <span style={{ fontWeight: 700, fontSize: '0.95rem', flex: 1 }}>📍 Selecionar local no mapa</span>
        {marcado && (
          <button
            onClick={() => onConfirmar(marcado.lat, marcado.lng)}
            style={{ background: '#16a34a', border: 'none', color: 'white', borderRadius: 20, padding: '0.4rem 1rem', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}
          >✓ Confirmar</button>
        )}
      </div>

      {/* Instrução */}
      <div style={{
        background: marcado ? '#fef3c7' : '#1e40af',
        color: marcado ? '#92400e' : 'white',
        padding: '0.5rem 1rem', fontSize: '0.82rem', fontWeight: 600,
        textAlign: 'center', flexShrink: 0,
      }}>
        {marcado
          ? `📍 ${decimalParaGMS(marcado.lat, 'lat')} · ${decimalParaGMS(marcado.lng, 'lng')} — Toque em outro ponto para mover`
          : '👆 Toque em qualquer ponto do mapa para marcar o local'}
      </div>

      {/* Mapa */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          center={centro}
          zoom={marcado ? 15 : 13}
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapClickHandler ativo={true} onClique={(la, ln) => setMarcado({ lat: la, lng: ln })} />
          {marcado && (
            <Marker position={[marcado.lat, marcado.lng]} icon={criarIconePrincipal()}>
              <Popup>📍 Local selecionado</Popup>
            </Marker>
          )}
          {!marcado && (
            <Marker position={CONSELHEIRO_LAFAIETE_CENTER} icon={criarIconeCentro()}>
              <Popup>🏙️ Centro de Conselheiro Lafaiete</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      {/* Rodapé com botão de confirmação */}
      {marcado && (
        <div style={{ background: 'white', padding: '0.75rem 1rem', flexShrink: 0, paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom,0px))' }}>
          <button
            onClick={() => onConfirmar(marcado.lat, marcado.lng)}
            style={{ width: '100%', background: 'linear-gradient(100deg,#123b73,#1a6bbf)', color: 'white', border: 'none', borderRadius: 10, padding: '0.85rem', fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer' }}
          >✓ Confirmar local</button>
        </div>
      )}
    </div>
  )
}

// ── Mapa do detalhe (com itens posicionáveis) ───────────────────────────
// Rastreia a posição atual do mapa e chama o callback quando muda
function MapViewTracker({ onChange }: { onChange: (center: [number, number], zoom: number) => void }) {
  const map = useMapEvents({
    moveend: () => { const c = map.getCenter(); onChange([c.lat, c.lng], map.getZoom()) },
    zoomend: () => { const c = map.getCenter(); onChange([c.lat, c.lng], map.getZoom()) },
  })
  return null
}

function MapaDetalhe({
  plano,
  onAdicionarItem,
  onRemoverItem,
  posicaoPropria,
  nomeProprio,
  fotosGeolocadas,
  onEditarFotoCoords,
  onViewChange,
}: {
  plano: Plano
  onAdicionarItem: (item: ItemMapa) => void
  onRemoverItem: (id: string) => void
  posicaoPropria?: { lat: number; lng: number; precisao: number } | null
  nomeProprio?: string
  fotosGeolocadas?: FotoGeolocada[]
  onEditarFotoCoords?: (foto: FotoGeolocada) => void
  onViewChange?: (center: [number, number], zoom: number) => void
}) {
  const [itemSelecionado, setItemSelecionado] = useState<string | null>(null)
  const [secaoAberta, setSecaoAberta] = useState<'orgaos'|'agentes'|'viaturas'|'materiais'|'icones'|null>('icones')
  const [camadaMapa, setCamadaMapa] = useState<'padrao' | 'satelite'>('padrao')
  const [novaViatura, setNovaViatura] = useState('')
  const [gpsLocalAtivo, setGpsLocalAtivo] = useState(false)
  const [posGpsLocal, setPosGpsLocal] = useState<{ lat: number; lng: number; precisao: number } | null>(null)
  const [gpsFlyKey, setGpsFlyKey] = useState(0)
  const watchIdLocalRef = useRef<number | null>(null)
  const centro: [number, number] = plano.lat && plano.lng ? [plano.lat, plano.lng] : CONSELHEIRO_LAFAIETE_CENTER

  useEffect(() => {
    return () => {
      if (watchIdLocalRef.current !== null) navigator.geolocation.clearWatch(watchIdLocalRef.current)
    }
  }, [])

  function handleGpsLocalBtn() {
    if (!navigator.geolocation) { alert('GPS não disponível neste dispositivo'); return }
    if (gpsLocalAtivo) {
      setGpsFlyKey(k => k + 1)
      return
    }
    setGpsLocalAtivo(true)
    if (watchIdLocalRef.current !== null) navigator.geolocation.clearWatch(watchIdLocalRef.current)
    watchIdLocalRef.current = navigator.geolocation.watchPosition(
      pos => {
        setPosGpsLocal({ lat: pos.coords.latitude, lng: pos.coords.longitude, precisao: pos.coords.accuracy })
        setGpsFlyKey(k => k + 1)
      },
      err => { console.warn('[GPS mapa]', err); setGpsLocalAtivo(false) },
      { enableHighAccuracy: true, maximumAge: 5000 }
    )
  }

  // ── Prontidão: rastreia quem está de prontidão + posições GPS ──────────
  const [agProntidao, setAgProntidao] = useState<Map<string, string>>(new Map()) // id → nome
  const [posicoesPront, setPosicoesPront] = useState<Map<string, { nome: string; lat: number; lng: number; precisao: number; ts: number; emProntidao: boolean }>>(new Map())
  const agProntRef = useRef(agProntidao)
  useEffect(() => { agProntRef.current = agProntidao }, [agProntidao])

  // Função auxiliar: verifica se um nome de agente pertence a este plano
  const nomeEhAgenteDoPlano = (nome: string) => {
    const agentes = plano.agentesDefesaCivil ?? []
    if (agentes.length === 0) return false
    const n = nome.toLowerCase()
    return agentes.some(ag => {
      const a = ag.toLowerCase()
      return a === n || n.startsWith(a.split(' ')[0]) || a.split(' ')[0] === n.split(' ')[0]
    })
  }

  useEffect(() => {
    const planoId = plano.id
    const meuId = getDispositivoIdGlobal()

    const offIniciais = wsOn('prontidao_iniciais', (msg) => {
      const lista = Array.isArray(msg.agentes) ? msg.agentes as { id: string; nome: string; planoId: string }[] : []
      setAgProntidao(prev => {
        const m = new Map(prev)
        for (const ag of lista) {
          if (ag.planoId === planoId) m.set(ag.id, ag.nome || ag.id)
        }
        return m
      })
    })

    const offPront = wsOn('prontidao', (msg) => {
      if (String(msg.planoId) !== planoId) return
      const id = String(msg.id)
      setAgProntidao(prev => { const m = new Map(prev); m.set(id, String(msg.nome || id)); return m })
    })

    const offSair = wsOn('prontidao_sair', (msg) => {
      if (String(msg.planoId) !== planoId) return
      const id = String(msg.id)
      setAgProntidao(prev => { const m = new Map(prev); m.delete(id); return m })
      // Só remove do mapa se não tiver GPS ativo independente
      setPosicoesPront(prev => {
        const m = new Map(prev)
        const pos = m.get(id)
        if (pos) m.set(id, { ...pos, emProntidao: false })
        return m
      })
    })

    const offPosicao = wsOn('posicao', (msg) => {
      const id = String(msg.id)
      if (id === meuId) return
      const nome = String(msg.nome || id)
      const emProntidao = agProntRef.current.has(id)
      // Aceita: agentes em prontidão deste plano OU agentes da lista do plano com GPS ativo
      if (!emProntidao && !nomeEhAgenteDoPlano(nome)) return
      setPosicoesPront(prev => {
        const m = new Map(prev)
        m.set(id, { nome, lat: Number(msg.lat), lng: Number(msg.lng), precisao: Number(msg.precisao || 0), ts: Date.now(), emProntidao })
        return m
      })
    })

    const offPosIniciais = wsOn('posicoes_iniciais', (msg) => {
      const lista = Array.isArray(msg.posicoes) ? msg.posicoes as { id: string; nome: string; lat: number; lng: number; precisao: number }[] : []
      setPosicoesPront(prev => {
        const m = new Map(prev)
        for (const p of lista) {
          if (p.id === meuId) continue
          const emProntidao = agProntRef.current.has(p.id)
          if (!emProntidao && !nomeEhAgenteDoPlano(p.nome)) continue
          m.set(p.id, { nome: p.nome, lat: p.lat, lng: p.lng, precisao: p.precisao || 0, ts: Date.now(), emProntidao })
        }
        return m
      })
    })

    const offRemover = wsOn('remover', (msg) => {
      const id = String(msg.id)
      setPosicoesPront(prev => { const m = new Map(prev); m.delete(id); return m })
    })

    const ttl = setInterval(() => {
      const limite = Date.now() - 15_000
      setPosicoesPront(prev => {
        let mudou = false
        const m = new Map(prev)
        for (const [id, p] of m) { if (p.ts < limite) { m.delete(id); mudou = true } }
        return mudou ? m : prev
      })
    }, 5000)

    return () => { offIniciais(); offPront(); offSair(); offPosicao(); offPosIniciais(); offRemover(); clearInterval(ttl) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano.id])

  function handleCliqueMapa(lat: number, lng: number) {
    if (!itemSelecionado) return
    // Check in ITENS_POSICIONAR
    const cfgIcon = ITENS_POSICIONAR.find(i => i.tipo === itemSelecionado)
    if (cfgIcon) {
      onAdicionarItem({ id: gerarId(), tipo: cfgIcon.tipo, emoji: cfgIcon.emoji, lat, lng, obs: cfgIcon.label })
      setItemSelecionado(null)
      return
    }
    // Check as organ (tipo starts with 'orgao:')
    if (itemSelecionado.startsWith('orgao:')) {
      const nomeOrgao = itemSelecionado.slice(6)
      const orgaoInfo = ORGAOS_EMPENHO.flatMap(c => c.orgaos).find(o => `${o.emoji} ${o.nome}` === nomeOrgao)
      const emoji = orgaoInfo?.emoji ?? '🏛️'
      onAdicionarItem({ id: gerarId(), tipo: 'orgao', emoji, lat, lng, obs: nomeOrgao })
      setItemSelecionado(null)
      return
    }
    // Check as material (tipo starts with 'mat:')
    if (itemSelecionado.startsWith('mat:')) {
      const nomeMat = itemSelecionado.slice(4)
      onAdicionarItem({ id: gerarId(), tipo: 'material', emoji: getEmojiMaterial(nomeMat), lat, lng, obs: nomeMat })
      setItemSelecionado(null)
      return
    }
    // Check as DC agent (tipo starts with 'agente:')
    if (itemSelecionado.startsWith('agente:')) {
      const nomeAgente = itemSelecionado.slice(7)
      onAdicionarItem({ id: gerarId(), tipo: 'agente_dc', emoji: '🧑‍🚒', lat, lng, obs: nomeAgente })
      setItemSelecionado(null)
      return
    }
    if (itemSelecionado.startsWith('viatura:')) {
      const identificacao = itemSelecionado.slice(8)
      onAdicionarItem({ id: gerarId(), tipo: 'viatura', emoji: '🚓', lat, lng, obs: identificacao })
      setItemSelecionado(null)
      return
    }
  }

  const labelSelecionado = (() => {
    if (!itemSelecionado) return ''
    if (itemSelecionado.startsWith('orgao:')) return itemSelecionado.slice(6)
    if (itemSelecionado.startsWith('mat:')) return itemSelecionado.slice(4)
    if (itemSelecionado.startsWith('agente:')) return itemSelecionado.slice(7)
    if (itemSelecionado.startsWith('viatura:')) return itemSelecionado.slice(8)
    return ITENS_POSICIONAR.find(i => i.tipo === itemSelecionado)?.label ?? ''
  })()

  return (
    <>
      {/* ── Painéis recolhíveis: Órgãos / Agentes / Materiais / Ícones ── */}
      <div style={{ background: '#f8fafc', border: '1.5px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 4, position: 'sticky', top: 0, zIndex: 999, boxShadow: '0 2px 10px rgba(0,0,0,0.13)' }}>

        {/* Banner de posicionamento ativo */}
        {itemSelecionado && (
          <div style={{ background: '#fef3c7', borderBottom: '1.5px solid #fbbf24', padding: '0.38rem 0.75rem', fontSize: '0.76rem', fontWeight: 700, color: '#92400e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📍 Toque no mapa para posicionar: <strong>{labelSelecionado}</strong></span>
            <button onClick={() => setItemSelecionado(null)} style={{ background: 'none', border: 'none', color: '#b45309', cursor: 'pointer', fontWeight: 900, fontSize: '1rem', lineHeight: 1 }}>✕</button>
          </div>
        )}

        {/* ── Seção: Órgãos Empenhados (recolhível) ── */}
        <div style={{ borderBottom: '1px solid #e5e7eb' }}>
          <button
            onClick={() => setSecaoAberta(secaoAberta === 'orgaos' ? null : 'orgaos')}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', background: secaoAberta === 'orgaos' ? 'linear-gradient(90deg,#1a3a6b,#1e40af)' : '#eef2ff', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ fontSize: '0.88rem' }}>🏛️</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 800, color: secaoAberta === 'orgaos' ? 'white' : '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Órgãos Empenhados</span>
            <span style={{ marginLeft: 'auto', background: secaoAberta === 'orgaos' ? 'rgba(255,255,255,0.22)' : '#c7d2fe', color: secaoAberta === 'orgaos' ? 'white' : '#3730a3', borderRadius: 10, fontSize: '0.62rem', fontWeight: 700, padding: '0.05rem 0.4rem' }}>
              {plano.equipe.length}
            </span>
            <span style={{ fontSize: '0.65rem', color: secaoAberta === 'orgaos' ? 'rgba(255,255,255,0.8)' : '#6b7280', fontWeight: 700, marginLeft: 2 }}>{secaoAberta === 'orgaos' ? '▲' : '▼'}</span>
          </button>
          {secaoAberta === 'orgaos' && (
            <div style={{ padding: '0.4rem 0.7rem 0.5rem' }}>
              {plano.equipe.length === 0
                ? <div style={{ fontSize: '0.72rem', color: '#9ca3af', textAlign: 'center', padding: '0.25rem 0' }}>Nenhum órgão empenhado</div>
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem' }}>
                    {plano.equipe.map(orgao => {
                      const key = `orgao:${orgao}`
                      const orgaoInfo = ORGAOS_EMPENHO.flatMap(c => c.orgaos).find(o => `${o.emoji} ${o.nome}` === orgao)
                      const emoji = orgaoInfo?.emoji ?? '🏛️'
                      const ativo = itemSelecionado === key
                      return (
                        <button key={orgao} onClick={() => setItemSelecionado(ativo ? null : key)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: ativo ? '#1e40af' : '#dbeafe', color: ativo ? 'white' : '#1e3a8a', border: ativo ? '1.5px solid #1e40af' : '1.5px solid #bfdbfe', borderRadius: 20, padding: '0.22rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', boxShadow: ativo ? '0 0 0 2px #93c5fd' : 'none' }}>
                          {orgaoInfo?.nome === 'Guarda Municipal' ? <img src="/icon-192.png" alt="" style={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 3 }} /> : <span style={{ fontSize: '0.88rem' }}>{emoji}</span>}
                          {orgaoInfo?.nome ?? orgao}{ativo && <span style={{ fontSize: '0.6rem' }}>📍</span>}
                        </button>
                      )
                    })}
                  </div>
              }
            </div>
          )}
        </div>

        {/* ── Seção: Agentes da Guarda Municipal (recolhível) ── */}
        <div style={{ borderBottom: '1px solid #e5e7eb' }}>
          <button
            onClick={() => setSecaoAberta(secaoAberta === 'agentes' ? null : 'agentes')}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', background: secaoAberta === 'agentes' ? 'linear-gradient(90deg,#065f46,#059669)' : '#f0fdf4', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ fontSize: '0.88rem' }}>🧑‍🚒</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 800, color: secaoAberta === 'agentes' ? 'white' : '#166534', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Agentes da Guarda Municipal</span>
            <span style={{ marginLeft: 'auto', background: secaoAberta === 'agentes' ? 'rgba(255,255,255,0.22)' : '#bbf7d0', color: secaoAberta === 'agentes' ? 'white' : '#166534', borderRadius: 10, fontSize: '0.62rem', fontWeight: 700, padding: '0.05rem 0.4rem' }}>
              {(plano.agentesDefesaCivil ?? []).length}
            </span>
            <span style={{ fontSize: '0.65rem', color: secaoAberta === 'agentes' ? 'rgba(255,255,255,0.8)' : '#6b7280', fontWeight: 700, marginLeft: 2 }}>{secaoAberta === 'agentes' ? '▲' : '▼'}</span>
          </button>
          {secaoAberta === 'agentes' && (
            <div style={{ padding: '0.4rem 0.7rem 0.5rem' }}>
              {(plano.agentesDefesaCivil ?? []).length === 0
                ? <div style={{ fontSize: '0.72rem', color: '#9ca3af', textAlign: 'center', padding: '0.25rem 0' }}>Nenhum agente escalado</div>
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem' }}>
                    {(plano.agentesDefesaCivil ?? []).map(ag => {
                      const key = `agente:${ag}`
                      const ativo = itemSelecionado === key
                      const conf = (plano.confirmacoes ?? []).find(c => c.agente === ag || c.agente.split(' ')[0] === ag.split(' ')[0])
                      const confirmado = conf?.confirmado === true
                      const recusou = conf !== undefined && conf.confirmado === false
                      return (
                        <button key={ag} onClick={() => setItemSelecionado(ativo ? null : key)} style={{
                          display: 'flex', alignItems: 'center', gap: '0.25rem',
                          background: ativo ? '#059669' : confirmado ? '#d1fae5' : recusou ? '#fee2e2' : '#dcfce7',
                          color: ativo ? 'white' : confirmado ? '#065f46' : recusou ? '#991b1b' : '#166534',
                          border: ativo ? '1.5px solid #059669' : confirmado ? '1.5px solid #6ee7b7' : recusou ? '1.5px solid #fca5a5' : '1.5px solid #bbf7d0',
                          borderRadius: 20, padding: '0.22rem 0.6rem', fontSize: '0.75rem', fontWeight: 700,
                          cursor: 'pointer', boxShadow: ativo ? '0 0 0 2px #6ee7b7' : 'none',
                        }}>
                          <span style={{ fontSize: '0.88rem' }}>🧑‍🚒</span>
                          {ag}
                          {confirmado && <span style={{ fontSize: '0.7rem' }}>✅</span>}
                          {recusou && <span style={{ fontSize: '0.7rem' }}>❌</span>}
                          {!conf && <span style={{ fontSize: '0.62rem', opacity: 0.6 }}>⏳</span>}
                          {ativo && <span style={{ fontSize: '0.6rem' }}>📍</span>}
                        </button>
                      )
                    })}
                  </div>
              }
            </div>
          )}
        </div>

        {/* ── Seção: Viaturas do patrulhamento (recolhível) ── */}
        <div style={{ borderBottom: '1px solid #e5e7eb' }}>
          <button
            onClick={() => setSecaoAberta(secaoAberta === 'viaturas' ? null : 'viaturas')}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', background: secaoAberta === 'viaturas' ? 'linear-gradient(90deg,#075985,#0284c7)' : '#f0f9ff', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ fontSize: '0.88rem' }}>🚓</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 800, color: secaoAberta === 'viaturas' ? 'white' : '#075985', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Viaturas do patrulhamento</span>
            <span style={{ marginLeft: 'auto', background: secaoAberta === 'viaturas' ? 'rgba(255,255,255,0.22)' : '#bae6fd', color: secaoAberta === 'viaturas' ? 'white' : '#075985', borderRadius: 10, fontSize: '0.62rem', fontWeight: 700, padding: '0.05rem 0.4rem' }}>
              {plano.itensMapa.filter(item => item.tipo === 'viatura').length}
            </span>
            <span style={{ fontSize: '0.65rem', color: secaoAberta === 'viaturas' ? 'rgba(255,255,255,0.8)' : '#6b7280', fontWeight: 700, marginLeft: 2 }}>{secaoAberta === 'viaturas' ? '▲' : '▼'}</span>
          </button>
          {secaoAberta === 'viaturas' && (
            <div style={{ padding: '0.45rem 0.7rem 0.55rem' }}>
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <input
                  value={novaViatura}
                  onChange={e => setNovaViatura(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && novaViatura.trim()) {
                      e.preventDefault()
                      setItemSelecionado(`viatura:${novaViatura.trim()}`)
                      setNovaViatura('')
                    }
                  }}
                  placeholder="Identificação ou placa (ex.: GM-01 / ABC-1234)"
                  style={{ flex: 1, minWidth: 0, padding: '0.38rem 0.55rem', border: '1.5px solid #bae6fd', borderRadius: 8, fontSize: '0.75rem', outline: 'none' }}
                />
                <button
                  type="button"
                  disabled={!novaViatura.trim()}
                  onClick={() => { setItemSelecionado(`viatura:${novaViatura.trim()}`); setNovaViatura('') }}
                  style={{ background: '#0284c7', color: 'white', border: 'none', borderRadius: 8, padding: '0.38rem 0.65rem', fontWeight: 800, fontSize: '0.75rem', cursor: novaViatura.trim() ? 'pointer' : 'not-allowed', opacity: novaViatura.trim() ? 1 : .5 }}
                >Selecionar</button>
              </div>
              <div style={{ marginTop: '0.4rem', fontSize: '0.68rem', color: '#64748b' }}>
                Depois de selecionar, toque no mapa para salvar a posição. A mesma viatura pode aparecer em vários planejamentos.
              </div>
              {plano.itensMapa.filter(item => item.tipo === 'viatura' && item.obs).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem', marginTop: '0.45rem' }}>
                  {[...new Set(plano.itensMapa.filter(item => item.tipo === 'viatura' && item.obs).map(item => item.obs!))].map(viatura => {
                    const key = `viatura:${viatura}`
                    const ativo = itemSelecionado === key
                    return (
                      <button key={viatura} type="button" onClick={() => setItemSelecionado(ativo ? null : key)} style={{ background: ativo ? '#0284c7' : '#e0f2fe', color: ativo ? 'white' : '#075985', border: `1px solid ${ativo ? '#0284c7' : '#bae6fd'}`, borderRadius: 20, padding: '0.22rem 0.55rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>
                        🚓 {viatura}{ativo && ' · 📍'}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Seção: Materiais e Recursos (recolhível) ── */}
        <div style={{ borderBottom: '1px solid #e5e7eb' }}>
          <button
            onClick={() => setSecaoAberta(secaoAberta === 'materiais' ? null : 'materiais')}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', background: secaoAberta === 'materiais' ? 'linear-gradient(90deg,#78350f,#b45309)' : '#fffbeb', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ fontSize: '0.88rem' }}>📦</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 800, color: secaoAberta === 'materiais' ? 'white' : '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Materiais e Recursos</span>
            <span style={{ marginLeft: 'auto', background: secaoAberta === 'materiais' ? 'rgba(255,255,255,0.22)' : '#fde68a', color: secaoAberta === 'materiais' ? 'white' : '#78350f', borderRadius: 10, fontSize: '0.62rem', fontWeight: 700, padding: '0.05rem 0.4rem' }}>
              {plano.materiais.length}
            </span>
            <span style={{ fontSize: '0.65rem', color: secaoAberta === 'materiais' ? 'rgba(255,255,255,0.8)' : '#6b7280', fontWeight: 700, marginLeft: 2 }}>{secaoAberta === 'materiais' ? '▲' : '▼'}</span>
          </button>
          {secaoAberta === 'materiais' && (
            <div style={{ padding: '0.4rem 0.7rem 0.5rem' }}>
              {plano.materiais.length === 0
                ? <div style={{ fontSize: '0.72rem', color: '#9ca3af', textAlign: 'center', padding: '0.25rem 0' }}>Nenhum material cadastrado</div>
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28rem' }}>
                    {plano.materiais.map(mat => {
                      const key = `mat:${mat.nome}`
                      const ativo = itemSelecionado === key
                      return (
                        <button key={mat.id} onClick={() => setItemSelecionado(ativo ? null : key)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: ativo ? '#b45309' : '#fef3c7', color: ativo ? 'white' : '#78350f', border: ativo ? '1.5px solid #b45309' : '1.5px solid #fcd34d', borderRadius: 20, padding: '0.22rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', boxShadow: ativo ? '0 0 0 2px #fde68a' : 'none' }}>
                          <span style={{ fontSize: '0.88rem' }}>{getEmojiMaterial(mat.nome)}</span>{mat.nome}{mat.quantidade > 1 && <span style={{ fontSize: '0.62rem', opacity: 0.75 }}>×{mat.quantidade}</span>}{ativo && <span style={{ fontSize: '0.6rem' }}>📍</span>}
                        </button>
                      )
                    })}
                  </div>
              }
            </div>
          )}
        </div>

      </div>

      {/* ── Mapa tático (quase tela cheia) ── */}
      <div style={{ position: 'relative', borderRadius: 12 }}>
        {/* Botões de camada — igual ao Mapa de Emergências */}
        <div className="mapa-camadas" style={{ top: 10 }}>
          <button
            className={`mapa-camada-btn ${camadaMapa === 'padrao' ? 'ativo' : ''}`}
            onClick={() => setCamadaMapa('padrao')}
          >🗺️ Mapa</button>
          <button
            className={`mapa-camada-btn ${camadaMapa === 'satelite' ? 'ativo' : ''}`}
            onClick={() => setCamadaMapa('satelite')}
          >🛰️ Satélite</button>
        </div>
        {/* Botão GPS — posição real */}
        <button
          onClick={handleGpsLocalBtn}
          title={gpsLocalAtivo ? 'Centralizar na minha localização' : 'Ativar GPS e ir para minha localização'}
          style={{
            position: 'absolute', bottom: 16, right: 16, zIndex: 800,
            background: gpsLocalAtivo ? (posGpsLocal ? 'linear-gradient(135deg,#1a4b8c,#2563eb)' : 'linear-gradient(135deg,#d97706,#f59e0b)') : 'linear-gradient(135deg,#374151,#4b5563)',
            color: 'white', border: 'none', borderRadius: 12,
            padding: '0.5rem 0.85rem', fontWeight: 800, fontSize: '0.78rem',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
            boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}
        >
          {gpsLocalAtivo
            ? posGpsLocal
              ? <>📡 <span>GPS ativo · toque para centralizar</span></>
              : <>⏳ <span>Obtendo GPS…</span></>
            : <>📡 <span>Ativar minha localização</span></>
          }
        </button>

      <div className="plan-mapa-container" style={{ borderRadius: 12, overflow: 'hidden' }}>
      <MapContainer
        center={centro}
        zoom={plano.lat && plano.lng ? 15 : 13}
        style={{ height: 'min(72dvh, 680px)', minHeight: 420, width: '100%' }}
        zoomControl={true}
        attributionControl={false}
      >
        {camadaMapa === 'padrao' ? (
          <TileLayer
            key="mapa-padrao"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            subdomains={['a', 'b', 'c']}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxZoom={19}
            keepBuffer={4}
          />
        ) : (
          <TileLayer
            key="mapa-satelite"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution='Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics'
            maxZoom={19}
            keepBuffer={4}
          />
        )}
        <MapClickHandler ativo={!!itemSelecionado} onClique={handleCliqueMapa} />
        <FlyToMe posicao={posicaoPropria} ativo={!!posicaoPropria} />
        <FlyToGpsOnKey posicao={posGpsLocal} flyKey={gpsFlyKey} />
        {plano.lat && plano.lng && (
          <Marker position={[plano.lat, plano.lng]} icon={criarIconePrincipal()}>
            <Popup><strong>{plano.nome}</strong><br />📍 Local principal</Popup>
          </Marker>
        )}
        {(plano.pontosExtras ?? []).map(p => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={criarIconeEmoji('📌')}>
            <Popup><strong>📌 {p.label || 'Ponto extra'}</strong><br />{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</Popup>
          </Marker>
        ))}
        <MapInvalidateSize trigger={itemSelecionado} />
        {onViewChange && <MapViewTracker onChange={onViewChange} />}
        {plano.itensMapa.map(item => (
          <Marker
            key={item.id}
            position={[item.lat, item.lng]}
            icon={item.tipo === 'agente_dc' ? criarIconeAgentePlanejado(item.obs || item.tipo) : item.tipo === 'cone' ? criarIconeCone() : criarIconeEmoji(item.emoji)}
          >
            <Popup>
              <div style={{ textAlign: 'center' }}>
                {item.tipo === 'agente_dc'
                  ? <span style={{ fontSize: '1.2rem' }}>🧑‍🚒</span>
                  : <span style={{ fontSize: '1.5rem' }}>{item.emoji}</span>
                }
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginTop: 4 }}>{item.obs || item.tipo}</div>
                {item.tipo === 'agente_dc' && (
                  <div style={{ fontSize: '0.72rem', color: '#1a4b8c', fontWeight: 600, marginBottom: 4 }}>👷 Agente planejado</div>
                )}
                <button
                  onClick={() => onRemoverItem(item.id)}
                  style={{ marginTop: 6, background: '#fee2e2', border: 'none', borderRadius: 6, padding: '0.2rem 0.7rem', color: '#b91c1c', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  Remover
                </button>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Agentes com GPS ativo (prontidão ou só GPS) */}
        {Array.from(posicoesPront.entries()).map(([id, p]) => (
          <Marker key={`ag-${id}`} position={[p.lat, p.lng]} icon={criarIconeAgente(p.nome)}>
            <Popup>
              <div style={{ textAlign: 'center', minWidth: 120 }}>
                <div style={{ fontSize: '1.2rem' }}>🧑‍🚒</div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{p.nome}</div>
                {p.emProntidao
                  ? <div style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600, marginTop: 2 }}>✅ Em prontidão · GPS ativo</div>
                  : <div style={{ fontSize: '0.75rem', color: '#1a4b8c', fontWeight: 600, marginTop: 2 }}>📡 GPS ativo · posição em tempo real</div>
                }
                {p.precisao > 0 && p.precisao < 500 && <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 1 }}>±{Math.round(p.precisao)}m</div>}
              </div>
            </Popup>
            {p.precisao > 0 && p.precisao < 300 && (
              <Circle center={[p.lat, p.lng]} radius={p.precisao} pathOptions={{ color: p.emProntidao ? '#059669' : '#1a4b8c', fillColor: p.emProntidao ? '#059669' : '#1a4b8c', fillOpacity: 0.1, weight: 1.5 }} />
            )}
          </Marker>
        ))}

        {/* Marcador da posição própria (quando em prontidão com GPS ativo) */}
        {posicaoPropria && (
          <Marker position={[posicaoPropria.lat, posicaoPropria.lng]} icon={criarIconeEu(nomeProprio || 'Você')}>
            <Popup>
              <div style={{ textAlign: 'center', minWidth: 120 }}>
                <div style={{ fontSize: '1.2rem' }}>📍</div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{nomeProprio || 'Você'}</div>
                <div style={{ fontSize: '0.75rem', color: '#d97706', fontWeight: 600, marginTop: 2 }}>✅ Em prontidão · Sua posição</div>
                {posicaoPropria.precisao > 0 && posicaoPropria.precisao < 500 && (
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 1 }}>±{Math.round(posicaoPropria.precisao)}m</div>
                )}
              </div>
            </Popup>
            {posicaoPropria.precisao > 0 && posicaoPropria.precisao < 300 && (
              <Circle
                center={[posicaoPropria.lat, posicaoPropria.lng]}
                radius={posicaoPropria.precisao}
                pathOptions={{ color: '#d97706', fillColor: '#d97706', fillOpacity: 0.15, weight: 2 }}
              />
            )}
          </Marker>
        )}

        {/* Marcador GPS local (botão de localização independente de prontidão) */}
        {gpsLocalAtivo && posGpsLocal && !posicaoPropria && (
          <>
            <Marker position={[posGpsLocal.lat, posGpsLocal.lng]} icon={criarIconeEu(nomeProprio || 'Você')}>
              <Popup>
                <div style={{ textAlign: 'center', minWidth: 120 }}>
                  <div style={{ fontSize: '1.2rem' }}>📡</div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{nomeProprio || 'Você'}</div>
                  <div style={{ fontSize: '0.75rem', color: '#1a4b8c', fontWeight: 600, marginTop: 2 }}>📍 Localização real (GPS ativo)</div>
                  {posGpsLocal.precisao > 0 && posGpsLocal.precisao < 500 && (
                    <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 1 }}>±{Math.round(posGpsLocal.precisao)}m</div>
                  )}
                  <div style={{ fontSize: '0.68rem', color: '#9ca3af', marginTop: 2, fontFamily: 'monospace' }}>
                    {posGpsLocal.lat.toFixed(5)}, {posGpsLocal.lng.toFixed(5)}
                  </div>
                </div>
              </Popup>
            </Marker>
            {posGpsLocal.precisao > 0 && posGpsLocal.precisao < 300 && (
              <Circle center={[posGpsLocal.lat, posGpsLocal.lng]} radius={posGpsLocal.precisao}
                pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.12, weight: 1.5 }} />
            )}
          </>
        )}

        {/* Marcadores de fotos geolocadas */}
        {(fotosGeolocadas ?? []).filter(f => f.lat != null && f.lng != null).map(f => (
          <Marker key={f.id} position={[f.lat!, f.lng!]} icon={criarIconeFoto(f.thumb || f.foto)}>
            <Popup>
              <div style={{ textAlign: 'center', minWidth: 160 }}>
                <img src={f.foto} alt="foto" style={{ width: 130, height: 130, objectFit: 'cover', borderRadius: 8, display: 'block', margin: '0 auto 6px' }} />
                <div style={{ fontSize: '0.7rem', color: '#1a4b8c', fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.5, marginTop: 4 }}>
                  📍 {formatarGMS(f.lat!, 'lat')}<br/>{'\u00A0\u00A0\u00A0'}{formatarGMS(f.lng!, 'lng')}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#374151', marginTop: 3 }}>🧑‍🚒 {f.agente}</div>
                <div style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 1 }}>
                  {new Date(f.timestamp).toLocaleString('pt-BR')}
                </div>
                {onEditarFotoCoords && (
                  <button
                    onClick={() => onEditarFotoCoords(f)}
                    style={{ marginTop: 7, width: '100%', background: '#1a4b8c', color: 'white', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 700 }}
                  >✏️ Editar coordenadas</button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {(agProntidao.size > 0 || posicoesPront.size > 0) && (
        <div style={{ background: '#f0fdf4', borderTop: '1px solid #bbf7d0', padding: '0.4rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          {/* Agentes em prontidão */}
          {agProntidao.size > 0 && (
            <>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#059669' }}>🛡️ Prontidão:</span>
              {Array.from(agProntidao.entries()).map(([id, nome]) => {
                const temGps = posicoesPront.has(id)
                return (
                  <span key={id} style={{ background: temGps ? '#dcfce7' : '#f3f4f6', color: temGps ? '#166534' : '#6b7280', borderRadius: 12, padding: '0.15rem 0.5rem', fontSize: '0.72rem', fontWeight: 600 }}>
                    {temGps ? '📡' : '📵'} {nome.split(' ')[0]}
                  </span>
                )
              })}
            </>
          )}
          {/* Agentes só com GPS (não estão em prontidão formal) */}
          {Array.from(posicoesPront.entries()).filter(([id, p]) => !p.emProntidao).length > 0 && (
            <>
              {agProntidao.size > 0 && <span style={{ color: '#d1d5db', fontSize: '0.8rem' }}>·</span>}
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1a4b8c' }}>📡 GPS ativo:</span>
              {Array.from(posicoesPront.entries())
                .filter(([, p]) => !p.emProntidao)
                .map(([id, p]) => (
                  <span key={id} style={{ background: '#dbeafe', color: '#1e40af', borderRadius: 12, padding: '0.15rem 0.5rem', fontSize: '0.72rem', fontWeight: 600 }}>
                    📡 {p.nome.split(' ')[0]}
                  </span>
                ))
              }
            </>
          )}
        </div>
      )}

    </div>
      </div>{/* fecha position:relative wrapper */}

    </>
  )
}

// ── Painel de pré-listas de materiais ──────────────────────────────────
function PreListasPanel({ onAdicionarItens }: { onAdicionarItens: (itens: string[]) => void }) {
  const [aberto, setAberto] = useState(false)
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [outrosTexto, setOutrosTexto] = useState('')

  function toggleItem(label: string) {
    setSelecionados(prev => {
      const novo = new Set(prev)
      novo.has(label) ? novo.delete(label) : novo.add(label)
      return novo
    })
  }

  function adicionarOutro() {
    const texto = outrosTexto.trim()
    if (!texto) return
    setSelecionados(prev => new Set(prev).add(texto))
    setOutrosTexto('')
  }

  function confirmar() {
    onAdicionarItens(Array.from(selecionados))
    setSelecionados(new Set())
    setOutrosTexto('')
    setCategoriaAtiva(null)
    setAberto(false)
  }

  const catAtiva = PRE_LISTAS.find(c => c.nome === categoriaAtiva)

  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        style={{ width: '100%', background: '#f0f4ff', border: '1.5px solid #bfdbfe', borderRadius: 8, padding: '0.5rem 0.85rem', fontSize: '0.82rem', fontWeight: 700, color: '#1e40af', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span>📋 Adicionar da pré-lista{selecionados.size > 0 ? ` (${selecionados.size} selecionados)` : ''}</span>
        <span style={{ fontSize: '0.7rem' }}>{aberto ? '▲ Fechar' : '▼ Abrir'}</span>
      </button>

      {aberto && (
        <div style={{ border: '1.5px solid #bfdbfe', borderTop: 'none', borderRadius: '0 0 10px 10px', background: '#f8faff', padding: '0.6rem' }}>
          {/* Botões de categoria */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.5rem' }}>
            {PRE_LISTAS.map(cat => (
              <button
                key={cat.nome}
                type="button"
                onClick={() => { setCategoriaAtiva(categoriaAtiva === cat.nome ? null : cat.nome); setOutrosTexto('') }}
                style={{
                  background: categoriaAtiva === cat.nome ? '#1e40af' : '#e0e7ff',
                  color: categoriaAtiva === cat.nome ? 'white' : '#1e40af',
                  border: 'none', borderRadius: 20,
                  padding: '0.28rem 0.65rem', fontSize: '0.73rem', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {cat.emoji} {cat.nome}
              </button>
            ))}
          </div>

          {/* Itens da categoria selecionada */}
          {catAtiva && (
            <div style={{ background: 'white', borderRadius: 8, padding: '0.5rem 0.6rem', border: '1px solid #e0e7ff', marginBottom: '0.4rem' }}>
              {catAtiva.itens.map(item => (
                <label
                  key={item.label}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', padding: '0.32rem 0.3rem', borderRadius: 6, background: selecionados.has(item.label) ? '#dbeafe' : 'transparent' }}
                >
                  <input
                    type="checkbox"
                    checked={selecionados.has(item.label)}
                    onChange={() => toggleItem(item.label)}
                    style={{ width: 16, height: 16, accentColor: '#1e40af', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '1rem', lineHeight: 1 }}>{item.emoji}</span>
                  <span style={{ fontSize: '0.82rem', color: '#1f2937' }}>{item.label}</span>
                </label>
              ))}

              {/* Separador e campo Outros */}
              <div style={{ borderTop: '1px dashed #cbd5e1', marginTop: '0.4rem', paddingTop: '0.4rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  ➕ Outros — adicionar item personalizado
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    type="text"
                    placeholder="Digite o item e pressione +"
                    value={outrosTexto}
                    onChange={e => setOutrosTexto(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarOutro() } }}
                    style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1.5px solid #cbd5e1', borderRadius: 7, fontSize: '0.82rem', outline: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={adicionarOutro}
                    style={{ background: '#1e40af', color: 'white', border: 'none', borderRadius: 7, padding: '0.4rem 0.8rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
                  >+</button>
                </div>
                {/* Mostra itens "outros" já adicionados nesta sessão */}
                {Array.from(selecionados).filter(s => !catAtiva.itens.some(i => i.label === s)).length > 0 && (
                  <div style={{ marginTop: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {Array.from(selecionados)
                      .filter(s => !catAtiva.itens.some(i => i.label === s))
                      .map(s => (
                        <span
                          key={s}
                          style={{ background: '#fef3c7', color: '#92400e', borderRadius: 12, padding: '0.18rem 0.55rem', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          ✏️ {s}
                          <button
                            type="button"
                            onClick={() => toggleItem(s)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', fontWeight: 900, fontSize: '0.75rem', padding: 0, lineHeight: 1 }}
                          >✕</button>
                        </span>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {selecionados.size > 0 && (
            <button
              type="button"
              onClick={confirmar}
              style={{ width: '100%', background: '#1a4b8c', color: 'white', border: 'none', borderRadius: 8, padding: '0.5rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
            >
              ✅ Adicionar {selecionados.size} {selecionados.size === 1 ? 'item' : 'itens'} à lista
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sistema Integrado de Resposta Operacional ───────────────────────────
function OrgaosPanel({ selecionados, onChange }: { selecionados: string[]; onChange: (v: string[]) => void }) {
  const [aberto, setAberto] = useState(false)
  const [catAtiva, setCatAtiva] = useState<string | null>(null)
  const [outrosTexto, setOutrosTexto] = useState('')

  const key = (o: { emoji: string; nome: string }) => `${o.emoji} ${o.nome}`

  function toggle(k: string) {
    onChange(selecionados.includes(k) ? selecionados.filter(x => x !== k) : [...selecionados, k])
  }

  function adicionarOutro() {
    const t = outrosTexto.trim()
    if (!t || selecionados.includes(t)) return
    onChange([...selecionados, t])
    setOutrosTexto('')
  }

  const cat = ORGAOS_EMPENHO.find(c => c.categoria === catAtiva)
  const orgaosNaLista = new Set(ORGAOS_EMPENHO.flatMap(c => c.orgaos.map(key)))
  const extras = selecionados.filter(s => !orgaosNaLista.has(s))

  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        style={{ width: '100%', background: 'linear-gradient(135deg,#1a3a6b,#1e40af)', border: 'none', borderRadius: aberto ? '10px 10px 0 0' : 10, padding: '0.5rem 0.75rem', fontSize: '0.78rem', fontWeight: 800, color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', letterSpacing: '0.01em' }}
      >
        <span>🏛️ Órgãos{selecionados.length > 0 ? ` · ${selecionados.length} selecionado${selecionados.length > 1 ? 's' : ''}` : ' — Sistema Integrado'}</span>
        <span style={{ fontSize: '0.65rem', opacity: 0.85, flexShrink: 0 }}>{aberto ? '▲ Fechar' : '▼ Abrir'}</span>
      </button>

      {aberto && (
        <div style={{ border: '2px solid #1e40af', borderTop: 'none', borderRadius: '0 0 10px 10px', background: '#f0f4ff', padding: '0.5rem' }}>

          {/* Categorias em grade compacta */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.22rem', marginBottom: '0.45rem' }}>
            {ORGAOS_EMPENHO.map(c => {
              const qtd = c.orgaos.filter(o => selecionados.includes(key(o))).length
              const ativo = catAtiva === c.categoria
              return (
                <button
                  key={c.categoria}
                  type="button"
                  onClick={() => { setCatAtiva(ativo ? null : c.categoria); setOutrosTexto('') }}
                  style={{ background: ativo ? '#1e40af' : '#dbeafe', color: ativo ? 'white' : '#1e3a8a', border: ativo ? '1.5px solid #1e40af' : '1.5px solid #bfdbfe', borderRadius: 8, padding: '0.3rem 0.4rem', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem', textAlign: 'left' }}
                >
                  <span style={{ fontSize: '0.85rem', lineHeight: 1, flexShrink: 0 }}>{c.emoji}</span>
                  <span style={{ flex: 1, lineHeight: 1.2 }}>{c.categoria}</span>
                  {qtd > 0 && <span style={{ background: ativo ? 'rgba(255,255,255,0.3)' : '#1e40af', color: 'white', borderRadius: 10, padding: '0 4px', fontSize: '0.6rem', flexShrink: 0 }}>{qtd}</span>}
                </button>
              )
            })}
          </div>

          {/* Órgãos da categoria ativa */}
          {cat && (
            <div style={{ background: 'white', borderRadius: 8, padding: '0.45rem 0.5rem', border: '1.5px solid #bfdbfe', marginBottom: '0.4rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#1e40af', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {cat.emoji} {cat.categoria}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
                {cat.orgaos.map(o => {
                  const k = key(o)
                  const sel = selecionados.includes(k)
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggle(k)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: sel ? '#1e40af' : '#f1f5ff', color: sel ? 'white' : '#1e3a8a', border: sel ? '1.5px solid #1e40af' : '1.5px solid #dbeafe', borderRadius: 7, padding: '0.3rem 0.45rem', fontSize: '0.73rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
                    >
                      {o.nome === 'Guarda Municipal' ? (
                        <img src="/icon-192.png" alt="" style={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                      ) : (
                        <span style={{ fontSize: '0.9rem', lineHeight: 1, flexShrink: 0 }}>{o.emoji}</span>
                      )}
                      <span style={{ flex: 1, lineHeight: 1.2 }}>{o.nome}</span>
                      {sel && <span style={{ fontSize: '0.65rem', opacity: 0.9, flexShrink: 0 }}>✓</span>}
                    </button>
                  )
                })}
              </div>

              {/* Outros */}
              <div style={{ borderTop: '1px dashed #cbd5e1', marginTop: '0.4rem', paddingTop: '0.35rem' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', marginBottom: '0.22rem' }}>➕ Adicionar outro órgão</div>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <input
                    type="text"
                    placeholder="Nome do órgão/empresa..."
                    value={outrosTexto}
                    onChange={e => setOutrosTexto(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarOutro() } }}
                    style={{ flex: 1, padding: '0.32rem 0.5rem', border: '1.5px solid #cbd5e1', borderRadius: 6, fontSize: '0.75rem', outline: 'none' }}
                  />
                  <button type="button" onClick={adicionarOutro} style={{ background: '#1e40af', color: 'white', border: 'none', borderRadius: 6, padding: '0.32rem 0.65rem', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>+</button>
                </div>
              </div>
            </div>
          )}

          {/* Órgãos extras (não estão na lista) */}
          {extras.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginBottom: '0.35rem' }}>
              {extras.map(s => (
                <span key={s} style={{ background: '#fef3c7', color: '#92400e', borderRadius: 10, padding: '0.18rem 0.48rem', fontSize: '0.68rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  ✏️ {s}
                  <button type="button" onClick={() => toggle(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', fontWeight: 900, fontSize: '0.7rem', padding: 0, lineHeight: 1 }}>✕</button>
                </span>
              ))}
            </div>
          )}

          {/* Selecionados resumo */}
          {selecionados.length > 0 && (
            <div style={{ background: '#eff6ff', borderRadius: 7, padding: '0.35rem 0.5rem', border: '1px solid #bfdbfe' }}>
              <div style={{ fontSize: '0.63rem', fontWeight: 700, color: '#1e40af', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>✅ Empenhados ({selecionados.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.18rem' }}>
                {selecionados.map(s => (
                  <span key={s} style={{ background: '#1e40af', color: 'white', borderRadius: 10, padding: '0.15rem 0.45rem', fontSize: '0.67rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    {s}
                    <button type="button" onClick={() => toggle(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.75)', fontWeight: 900, fontSize: '0.6rem', padding: 0, lineHeight: 1 }}>✕</button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Exportação PDF ──────────────────────────────────────────────────────
function exportarPDF(plano: Plano, mapCenter?: [number, number], mapZoom?: number) {
  const cfg = TIPOS_CONFIG[plano.tipo]
  const sc = STATUS_CONFIG[plano.status]
  const rc = RISCO_CONFIG[plano.risco]
  const agora = new Date()
  const dataEmissao = agora.toLocaleDateString('pt-BR') + ' às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const linhaInfo = (label: string, valor: string) =>
    valor ? `<tr><td class="lbl">${label}</td><td>${valor}</td></tr>` : ''

  const materiaisHtml = plano.materiais.length === 0
    ? '<p style="color:#9ca3af;font-size:11px">Nenhum material cadastrado</p>'
    : `<table class="tbl"><thead><tr><th>#</th><th>Material</th><th>Qtd</th><th>Unid.</th></tr></thead><tbody>
        ${plano.materiais.map((m, i) => `<tr><td>${i + 1}</td><td>${m.nome}</td><td>${m.quantidade}</td><td>${m.unidade}</td></tr>`).join('')}
      </tbody></table>`

  const equipeHtml = (() => {
    if (plano.equipe.length === 0) return '<p style="color:#9ca3af;font-size:11px">Nenhum órgão empenhado</p>'
    const orgaosNaLista = new Map(ORGAOS_EMPENHO.flatMap(c => c.orgaos.map(o => [`${o.emoji} ${o.nome}`, { cat: c.categoria, catEmoji: c.emoji }])))
    const grupos: Record<string, { catEmoji: string; orgaos: string[] }> = {}
    const extras: string[] = []
    plano.equipe.forEach(e => {
      const info = orgaosNaLista.get(e)
      if (info) { if (!grupos[info.cat]) grupos[info.cat] = { catEmoji: info.catEmoji, orgaos: [] }; grupos[info.cat].orgaos.push(e) }
      else extras.push(e)
    })
    const partes: string[] = []
    Object.entries(grupos).forEach(([cat, { catEmoji, orgaos }]) => {
      partes.push(`<div style="margin-bottom:6px"><div style="font-size:10px;font-weight:700;color:#1a4b8c;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">${catEmoji} ${cat}</div><div>${orgaos.map(o => `<span class="chip">${o}</span>`).join(' ')}</div></div>`)
    })
    if (extras.length > 0) partes.push(`<div style="margin-bottom:6px"><div style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">✏️ Outros</div><div>${extras.map(o => `<span class="chip" style="background:#fef3c7;color:#92400e">${o}</span>`).join(' ')}</div></div>`)
    return partes.join('')
  })()

  const itensMapaHtml = plano.itensMapa.length === 0
    ? '<p style="color:#9ca3af;font-size:11px">Nenhum item posicionado</p>'
    : plano.itensMapa.map(it => `<span class="chip">${it.emoji} ${it.obs || it.tipo}</span>`).join(' ')

  const localizacao = plano.lat && plano.lng
    ? `${plano.lat.toFixed(5)}, ${plano.lng.toFixed(5)}`
    : plano.local || '—'

  const todasFotos = (plano.fotosEvento ?? []).map(f => ({
    src: typeof f === 'string' ? f : f.foto,
    lat: typeof f !== 'string' ? f.lat : null,
    lng: typeof f !== 'string' ? f.lng : null,
    agente: typeof f !== 'string' ? f.agente : null,
    timestamp: typeof f !== 'string' ? f.timestamp : null,
  }))

  const fotosPaginasHtml = todasFotos.length === 0 ? '' : (() => {
    const paginas: string[] = []
    for (let i = 0; i < todasFotos.length; i += 4) {
      const lote = todasFotos.slice(i, i + 4)
      const numPag = Math.floor(i / 4) + 3
      paginas.push(`
        <div style="page-break-before:always;padding:20px 24px">
          <div style="border-bottom:3px solid #1a4b8c;padding-bottom:10px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:16px;font-weight:800;color:#1a4b8c">📸 ${LABEL_FOTOS_TIPO[plano.tipo]} — Página ${numPag}</div>
              <div style="font-size:11px;color:#6b7280">${plano.nome} — Guarda Municipal — Conselheiro Lafaiete</div>
            </div>
            <div style="font-size:10px;color:#9ca3af">Fotos ${i + 1}–${Math.min(i + 4, todasFotos.length)} de ${todasFotos.length}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px">
            ${lote.map((f, fi) => `
              <div style="background:#f8fafc;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;break-inside:avoid">
                <img src="${f.src}" style="width:100%;max-height:300px;object-fit:contain;display:block;background:#000"/>
                <div style="padding:8px 10px;font-size:10px;color:#374151">
                  <div style="font-weight:700;margin-bottom:3px;font-size:11px">Foto ${i + fi + 1}</div>
                  ${f.agente ? `<div style="margin-bottom:1px">🧑‍🚒 ${f.agente}</div>` : ''}
                  ${f.lat != null && f.lng != null ? `<div style="color:#1a4b8c;margin-bottom:1px;font-family:monospace">📍 ${formatarGMS(f.lat as number, 'lat')} / ${formatarGMS(f.lng as number, 'lng')}</div>` : '<div style="color:#9ca3af">📍 Sem localização GPS</div>'}
                  ${f.timestamp ? `<div style="color:#9ca3af">${new Date(f.timestamp as number).toLocaleString('pt-BR')}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `)
    }
    return paginas.join('')
  })()

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<title>${plano.nome} — Guarda Municipal — Conselheiro Lafaiete</title>
<script>window.addEventListener('afterprint', function(){ setTimeout(function(){ window.close(); }, 300); });<\/script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1f2937;padding:28px 32px}
  .header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px solid #1a4b8c;padding-bottom:12px;margin-bottom:18px}
  .header h1{font-size:18px;color:#1a4b8c;margin-bottom:4px}
  .header .sub{font-size:11px;color:#6b7280}
  .logo{font-size:2.2rem}
  .badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
  .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700}
  .badge-status{background:#dbeafe;color:#1e40af}
  .badge-risco-baixo{background:#dcfce7;color:#16a34a}
  .badge-risco-medio{background:#fef3c7;color:#d97706}
  .badge-risco-alto{background:#fee2e2;color:#dc2626}
  .section{margin-bottom:18px}
  .section h2{font-size:12px;color:#1a4b8c;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:8px}
  table.info{width:100%;border-collapse:collapse;font-size:11px}
  table.info td{padding:4px 6px;vertical-align:top}
  table.info td.lbl{font-weight:700;color:#4b5563;width:110px;white-space:nowrap}
  .tbl{width:100%;border-collapse:collapse;font-size:11px;margin-top:4px}
  .tbl th{background:#f3f4f6;text-align:left;padding:5px 8px;font-weight:700;color:#374151}
  .tbl td{padding:4px 8px;border-bottom:1px solid #f3f4f6}
  .tbl tr:nth-child(even) td{background:#fafafa}
  .chip{display:inline-block;background:#dbeafe;color:#1e40af;border-radius:10px;padding:2px 8px;font-size:10px;font-weight:600;margin:2px 2px 2px 0}
  .obs{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;font-size:11px;color:#374151;white-space:pre-wrap}
  .footer{margin-top:24px;border-top:1px solid #e5e7eb;padding-top:8px;font-size:9px;color:#9ca3af;display:flex;justify-content:space-between}
  @media print{body{padding:16px}@page{margin:12mm}}
</style></head><body>

<div class="header">
  <div>
    <h1>${cfg.emoji} ${plano.nome}</h1>
    <div class="sub">Guarda Municipal — Conselheiro Lafaiete — ${cfg.label} | Emitido em ${dataEmissao}</div>
  </div>
  <div class="logo">🛡️</div>
</div>

<div class="badges">
  <span class="badge badge-status">${sc.emoji} ${sc.label}</span>
  <span class="badge badge-risco-${plano.risco}">⚠️ Risco ${rc.label}</span>
  <span class="badge" style="background:#f3f4f6;color:#374151">📋 ${cfg.label}</span>
</div>

<div class="section">
  <h2>📋 Informações gerais</h2>
  <table class="info">
    ${linhaInfo('Nome', plano.nome)}
    ${linhaInfo('Descrição', plano.descricao)}
    ${linhaInfo('Local', plano.local)}
    ${plano.lat && plano.lng ? linhaInfo('Coordenadas', localizacao) : ''}
    ${linhaInfo('Data início', plano.dataInicio ? new Date(plano.dataInicio + 'T12:00:00').toLocaleDateString('pt-BR') : '')}
    ${plano.dataFim && plano.dataFim !== plano.dataInicio ? linhaInfo('Data fim', new Date(plano.dataFim + 'T12:00:00').toLocaleDateString('pt-BR')) : ''}
    ${plano.horario ? linhaInfo('Horário início', plano.horario) : ''}
    ${plano.horarioFim ? linhaInfo('Horário fim', plano.horarioFim) : ''}
    ${plano.publicoEstimado ? linhaInfo('Público estimado', plano.publicoEstimado + ' pessoas') : ''}
    ${linhaInfo('Criado por', plano.criadoPor + ' em ' + new Date(plano.criadoEm).toLocaleDateString('pt-BR'))}
  </table>
</div>

<div class="section">
  <h2>🏛️ Sistema Integrado de Resposta Operacional (${plano.equipe.length} órgão${plano.equipe.length !== 1 ? 's' : ''})</h2>
  ${equipeHtml}
</div>

<div class="section">
  <h2>📦 Materiais e recursos (${plano.materiais.length})</h2>
  ${materiaisHtml}
</div>

${plano.itensMapa.length > 0 ? `<div class="section">
  <h2>🗺️ Itens posicionados (${plano.itensMapa.length})</h2>
  ${itensMapaHtml}
</div>` : ''}

${plano.observacoes ? `<div class="section">
  <h2>📝 Observações</h2>
  <div class="obs">${plano.observacoes}</div>
</div>` : ''}

${plano.conclusao ? `<div class="section" style="border-left:4px solid #059669;background:#f0fdf4;padding:14px 18px;border-radius:0 8px 8px 0;margin-top:12px">
  <h2 style="color:#059669">✅ Conclusão da ${cfg.label.replace(/ções$/, 'ção').replace(/s$/, '')}</h2>
  <div class="obs" style="color:#065f46;white-space:pre-wrap">${plano.conclusao}</div>
</div>` : ''}

<div class="footer">
  <span>Guarda Municipal — Conselheiro Lafaiete — Planejamento operacional</span>
  <span>Emitido em ${dataEmissao}</span>
</div>

${(plano.lat && plano.lng) || plano.itensMapa.length > 0 || (plano.pontosExtras ?? []).length > 0 ? `
<!-- ── FOLHA DO MAPA ── -->
<div style="page-break-before:always">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<div style="padding:20px 24px 12px">
  <div style="border-bottom:3px solid #1a4b8c;padding-bottom:10px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:16px;font-weight:800;color:#1a4b8c">🗺️ Mapa de Planejamento Operacional</div>
      <div style="font-size:11px;color:#6b7280">${plano.nome} — Guarda Municipal — Conselheiro Lafaiete</div>
    </div>
    <div style="font-size:10px;color:#9ca3af">Emitido em ${dataEmissao}</div>
  </div>
</div>
<div id="map-pdf" style="height:calc(100vh - 120px);width:100%;margin:0"></div>
<script>
(function(){
  var map = L.map('map-pdf');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  var bounds = [];
  ${plano.lat && plano.lng ? `
  L.circleMarker([${plano.lat},${plano.lng}],{radius:10,color:'#1a4b8c',fillColor:'#1a4b8c',fillOpacity:1,weight:3}).addTo(map)
    .bindPopup('<strong>📍 Local principal</strong><br>${plano.nome.replace(/'/g, "\\'")}');
  bounds.push([${plano.lat},${plano.lng}]);
  ` : ''}
  ${(plano.pontosExtras ?? []).map(p => `
  L.marker([${p.lat},${p.lng}]).addTo(map)
    .bindPopup('<strong>📌 ${p.label.replace(/'/g, "\\'")}</strong>');
  bounds.push([${p.lat},${p.lng}]);
  `).join('')}
  ${plano.itensMapa.map(it => `
  L.marker([${it.lat},${it.lng}], {icon: L.divIcon({
    html:'<div style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5))">${it.emoji}</div>',
    className:'',iconSize:[38,38],iconAnchor:[19,19],popupAnchor:[0,-20]
  })}).addTo(map)
    .bindPopup('<b>${it.emoji} ${(it.obs || it.tipo).replace(/'/g, "\\'")}</b>');
  bounds.push([${it.lat},${it.lng}]);
  `).join('')}
  ${(plano.fotosEvento ?? [])
    .filter(f => typeof f !== 'string' && (f as FotoGeolocada).lat != null && (f as FotoGeolocada).lng != null)
    .map((f, fi) => {
      const foto = f as FotoGeolocada
      const imgSrc = foto.thumb || foto.foto
      const gmsLat = formatarGMS(foto.lat!, 'lat').replace(/'/g, '&#39;').replace(/"/g, '&#34;')
      const gmsLng = formatarGMS(foto.lng!, 'lng').replace(/'/g, '&#39;').replace(/"/g, '&#34;')
      const agente = foto.agente.replace(/'/g, "\\'")
      return `
  L.marker([${foto.lat},${foto.lng}], {icon: L.divIcon({
    html:'<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.55))"><div style="width:46px;height:46px;border-radius:7px;overflow:hidden;border:3px solid #dc2626;background:#e2e8f0"><img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover"/></div><div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:12px solid #dc2626;margin-top:-1px"></div></div>',
    className:'',iconSize:[46,60],iconAnchor:[23,60],popupAnchor:[0,-63]
  })}).addTo(map)
    .bindPopup('<b>&#128247; Foto ${fi + 1}</b><br><span style="font-size:10px">&#129333; ${agente}</span><br><span style="font-family:monospace;font-size:10px">${gmsLat}<br>${gmsLng}</span>');
  bounds.push([${foto.lat},${foto.lng}]);
      `
    }).join('')}
  ${mapCenter && mapZoom != null
    ? `map.setView([${mapCenter[0]},${mapCenter[1]}], ${mapZoom});`
    : `if(bounds.length > 0) {
    if(bounds.length === 1) { map.setView(bounds[0], 15); }
    else { map.fitBounds(bounds, {padding:[50,50]}); }
  } else { map.setView([-20.5195,-43.6983], 13); }`
  }
  var _printed = false;
  function _doPrint() { if(_printed) return; _printed=true; setTimeout(function(){ window.print(); }, 600); }
  map.on('load', _doPrint);
  setTimeout(_doPrint, 4500);
})();
<\/script>
</div>
` : `<script>setTimeout(function(){window.print();},1800)<\/script>`}

${fotosPaginasHtml}

</body></html>`

  const w = window.open('', '_blank')
  if (!w) { alert('Permita pop-ups para exportar o PDF'); return }
  w.document.write(html)
  w.document.close()
}

// ── Formulário de criação/edição ────────────────────────────────────────
function FormularioPlano({
  tipo,
  planoEditando,
  dataInicial,
  onSalvar,
  onFechar,
}: {
  tipo: TipoPlano
  planoEditando?: Plano | null
  dataInicial?: string
  onSalvar: (plano: Plano) => void
  onFechar: () => void
}) {
  const agente = getAgenteLogado()
  const cfg = TIPOS_CONFIG[tipo]

  const [nome, setNome] = useState(planoEditando?.nome ?? '')
  const [descricao, setDescricao] = useState(planoEditando?.descricao ?? '')
  const [local, setLocal] = useState(planoEditando?.local ?? '')
  const [dataInicio, setDataInicio] = useState(planoEditando?.dataInicio ?? dataInicial ?? '')
  const [dataFim, setDataFim] = useState(planoEditando?.dataFim ?? dataInicial ?? '')
  const [horario, setHorario] = useState(planoEditando?.horario ?? '')
  const [horarioFim, setHorarioFim] = useState(planoEditando?.horarioFim ?? '')
  const [publicoEstimado, setPublicoEstimado] = useState(planoEditando?.publicoEstimado ?? '')
  const [risco] = useState<'baixo' | 'medio' | 'alto'>(planoEditando?.risco ?? 'baixo')
  const [equipe, setEquipe] = useState<string[]>(planoEditando?.equipe ?? [])
  const [materiais, setMateriais] = useState<MaterialPlano[]>(planoEditando?.materiais ?? [])
  const [observacoes, setObservacoes] = useState(planoEditando?.observacoes ?? '')
  const [lat, setLat] = useState<number | null>(planoEditando?.lat ?? null)
  const [lng, setLng] = useState<number | null>(planoEditando?.lng ?? null)
  const [pontosExtras, setPontosExtras] = useState<PontoExtra[]>(planoEditando?.pontosExtras ?? [])
  const [novoPontoLat, setNovoPontoLat] = useState('')
  const [novoPontoLng, setNovoPontoLng] = useState('')
  const [novoPontoLabel, setNovoPontoLabel] = useState('')
  const [clickandoPonto, setClickandoPonto] = useState(false)

  const [agentesDefesaCivil, setAgentesDefesaCivil] = useState<string[]>(planoEditando?.agentesDefesaCivil ?? [])
  const [mostrarMapaModal, setMostrarMapaModal] = useState(false)

  const [novoMat, setNovoMat] = useState('')
  const [novoMatQtd, setNovoMatQtd] = useState('1')
  const [novoMatUnd, setNovoMatUnd] = useState('un')

  function adicionarMaterial() {
    if (!novoMat.trim()) return
    setMateriais(prev => [...prev, {
      id: gerarId(),
      nome: novoMat.trim(),
      quantidade: Math.max(1, parseInt(novoMatQtd) || 1),
      unidade: novoMatUnd || 'un',
    }])
    setNovoMat('')
    setNovoMatQtd('1')
  }

  function adicionarMateriais(nomes: string[]) {
    setMateriais(prev => {
      const existentes = new Set(prev.map(m => m.nome.toLowerCase()))
      const novos = nomes
        .filter(n => !existentes.has(n.toLowerCase()))
        .map(n => ({ id: gerarId(), nome: n, quantidade: 1, unidade: 'un' }))
      return [...prev, ...novos]
    })
  }

  function removerMaterial(id: string) {
    setMateriais(prev => prev.filter(m => m.id !== id))
  }

  function salvar() {
    if (!nome.trim()) return
    const plano: Plano = {
      id: planoEditando?.id ?? gerarId(),
      tipo,
      nome: nome.trim(),
      descricao: descricao.trim(),
      local: local.trim(),
      dataInicio,
      dataFim,
      horario,
      publicoEstimado,
      status: planoEditando?.status ?? 'planejado',
      equipe,
      horarioFim,
      materiais,
      itensMapa: planoEditando?.itensMapa ?? [],
      pontosExtras,
      lat,
      lng,
      observacoes: observacoes.trim(),
      risco,
      agentesDefesaCivil,
      criadoPor: planoEditando?.criadoPor ?? agente,
      criadoEm: planoEditando?.criadoEm ?? new Date().toISOString(),
      confirmacoes: planoEditando?.confirmacoes ?? [],
      fotosEvento: planoEditando?.fotosEvento ?? [],
      conclusao: planoEditando?.conclusao ?? '',
    }
    onSalvar(plano)
  }

  return (
    <div className="plan-modal-overlay" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div className="plan-modal">
        <div className="plan-modal-header">
          <span className="plan-modal-titulo">
            {cfg.emoji} {planoEditando ? 'Editar' : 'Novo'} {cfg.label.replace(/ções$/, 'ção').replace(/s$/, '')}
          </span>
          <button className="plan-modal-fechar" onClick={onFechar}>✕</button>
        </div>

        <div className="plan-modal-body">
          <div className="plan-form-secao">📋 Informações gerais</div>

          <div className="plan-form-group">
            <label className="plan-form-label">Nome *</label>
            <input
              className="plan-form-input"
              placeholder={`Ex: ${cfg.exemploNome}`}
              value={nome}
              onChange={e => setNome(e.target.value)}
            />
          </div>

          <div className="plan-form-group">
            <label className="plan-form-label">Descrição</label>
            <textarea
              className="plan-form-textarea"
              placeholder={cfg.descricaoPlaceholder}
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              rows={2}
            />
            <div style={{ marginTop: '0.6rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#475569', marginBottom: '0.35rem' }}>
                Ações da Guarda Municipal — toque para incluir na descrição
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {cfg.atividades.map(atividade => (
                  <button
                    key={atividade}
                    type="button"
                    onClick={() => setDescricao(atual => {
                      if (atual.split('\n').some(linha => linha.replace(/^[•-]\s*/, '').trim() === atividade)) return atual
                      return `${atual.trim()}${atual.trim() ? '\n' : ''}• ${atividade}`
                    })}
                    style={{
                      border: `1px solid ${cfg.cor}55`,
                      borderRadius: 999,
                      background: `${cfg.cor}0d`,
                      color: cfg.cor,
                      padding: '0.32rem 0.6rem',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    + {atividade}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="plan-form-group">
            <label className="plan-form-label">Local</label>
            <input
              className="plan-form-input"
              placeholder="Ex: Praça Central, Ginásio Municipal..."
              value={local}
              onChange={e => setLocal(e.target.value)}
            />
          </div>

          <div className="plan-form-row">
            <div className="plan-form-group">
              <label className="plan-form-label">Data início</label>
              <input className="plan-form-input" type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
            </div>
            <div className="plan-form-group">
              <label className="plan-form-label">Data fim</label>
              <input className="plan-form-input" type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} />
            </div>
          </div>

          <div className="plan-form-row">
            <div className="plan-form-group">
              <label className="plan-form-label">Horário início</label>
              <input className="plan-form-input" type="time" value={horario} onChange={e => setHorario(e.target.value)} />
            </div>
            <div className="plan-form-group">
              <label className="plan-form-label">Horário fim</label>
              <input className="plan-form-input" type="time" value={horarioFim} onChange={e => setHorarioFim(e.target.value)} />
            </div>
          </div>

          {tipo === 'evento' && (
            <div className="plan-form-group">
              <label className="plan-form-label">Público estimado</label>
              <input className="plan-form-input" placeholder="Ex: 5.000" value={publicoEstimado} onChange={e => setPublicoEstimado(e.target.value)} />
            </div>
          )}

          <div className="plan-form-secao">📍 Localização no mapa</div>

          {/* Botão que abre mapa em tela cheia */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setMostrarMapaModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', background: lat && lng ? '#dcfce7' : '#1a4b8c', color: lat && lng ? '#166534' : 'white', border: lat && lng ? '1.5px solid #86efac' : 'none', borderRadius: 20, padding: '0.45rem 1rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
            >
              🗺️ {lat && lng ? 'Mapa (mover local)' : 'Mapa'}
            </button>
            {lat && lng && (
              <button type="button" onClick={() => { setLat(null); setLng(null) }} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 700 }}>✕ Remover</button>
            )}
          </div>

          {/* Coordenadas GMS (edição manual ou exibição após mapa) */}
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 140px' }}>
              <div style={{ fontSize: '0.68rem', color: '#6b7280', fontWeight: 600, marginBottom: 2 }}>Latitude (GMS)</div>
              <InputGMS valor={lat} tipo="lat" onChange={v => setLat(v)} />
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <div style={{ fontSize: '0.68rem', color: '#6b7280', fontWeight: 600, marginBottom: 2 }}>Longitude (GMS)</div>
              <InputGMS valor={lng} tipo="lng" onChange={v => setLng(v)} />
            </div>
          </div>
          {lat && lng && (
            <div style={{ fontSize: '0.73rem', color: '#6b7280', textAlign: 'center', marginTop: -4, marginBottom: '0.4rem', fontFamily: 'monospace' }}>
              📍 {decimalParaGMS(lat, 'lat')} · {decimalParaGMS(lng, 'lng')}
            </div>
          )}

          {/* Modal tela cheia do mapa */}
          {mostrarMapaModal && (
            <MapaPickerModal
              lat={lat}
              lng={lng}
              onConfirmar={(la, ln) => { setLat(la); setLng(ln); setMostrarMapaModal(false) }}
              onFechar={() => setMostrarMapaModal(false)}
            />
          )}

          {/* Pontos extras */}
          <div style={{ background: '#f0f4ff', border: '1.5px solid #bfdbfe', borderRadius: 10, padding: '0.6rem 0.7rem', marginBottom: '0.3rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#1e40af', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              📌 Pontos adicionais de referência
            </div>

            {/* Campo clique-no-mapa para ponto extra */}
            {clickandoPonto && (
              <div style={{ background: '#fef3c7', border: '1.5px solid #fbbf24', borderRadius: 8, padding: '0.4rem 0.7rem', marginBottom: '0.4rem', fontSize: '0.8rem', fontWeight: 600, color: '#92400e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>📍 Toque no mapa acima para definir o ponto</span>
                <button type="button" onClick={() => setClickandoPonto(false)} style={{ background: 'none', border: 'none', color: '#b45309', cursor: 'pointer', fontWeight: 800 }}>✕</button>
              </div>
            )}

            {/* Formulário manual com GMS */}
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
              <div style={{ flex: '1 1 120px' }}>
                <div style={{ fontSize: '0.68rem', color: '#6b7280', fontWeight: 600, marginBottom: 2 }}>Nome/referência</div>
                <input
                  type="text"
                  placeholder="Ex: Portão A"
                  value={novoPontoLabel}
                  onChange={e => setNovoPontoLabel(e.target.value)}
                  style={{ width: '100%', padding: '0.38rem 0.5rem', border: '1.5px solid #cbd5e1', borderRadius: 7, fontSize: '0.8rem', outline: 'none' }}
                />
              </div>
              <div style={{ flex: '0 1 130px' }}>
                <div style={{ fontSize: '0.68rem', color: '#6b7280', fontWeight: 600, marginBottom: 2 }}>Latitude (GMS)</div>
                <input
                  type="text"
                  placeholder={"20°31'10\"S"}
                  value={novoPontoLat}
                  onChange={e => setNovoPontoLat(e.target.value)}
                  style={{ width: '100%', padding: '0.38rem 0.5rem', border: '1.5px solid #cbd5e1', borderRadius: 7, fontSize: '0.79rem', outline: 'none', fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ flex: '0 1 130px' }}>
                <div style={{ fontSize: '0.68rem', color: '#6b7280', fontWeight: 600, marginBottom: 2 }}>Longitude (GMS)</div>
                <input
                  type="text"
                  placeholder={"43°41'54\"O"}
                  value={novoPontoLng}
                  onChange={e => setNovoPontoLng(e.target.value)}
                  style={{ width: '100%', padding: '0.38rem 0.5rem', border: '1.5px solid #cbd5e1', borderRadius: 7, fontSize: '0.79rem', outline: 'none', fontFamily: 'monospace' }}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const la = gmsParaDecimal(novoPontoLat) ?? parseFloat(novoPontoLat.replace(',', '.'))
                  const ln = gmsParaDecimal(novoPontoLng) ?? parseFloat(novoPontoLng.replace(',', '.'))
                  if (isNaN(la) || isNaN(ln)) return
                  setPontosExtras(prev => [...prev, { id: gerarId(), lat: la, lng: ln, label: novoPontoLabel.trim() || `Ponto ${prev.length + 1}` }])
                  setNovoPontoLat(''); setNovoPontoLng(''); setNovoPontoLabel('')
                }}
                style={{ background: '#1e40af', color: 'white', border: 'none', borderRadius: 7, padding: '0.38rem 0.8rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', flexShrink: 0 }}
              >+</button>
            </div>

            {/* Lista de pontos extras */}
            {pontosExtras.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {pontosExtras.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'white', borderRadius: 7, padding: '0.3rem 0.55rem', border: '1px solid #e0e7ff' }}>
                    <span style={{ fontSize: '0.9rem' }}>📌</span>
                    <span style={{ fontWeight: 700, fontSize: '0.78rem', color: '#1e40af', flex: 1 }}>{p.label}</span>
                    <span style={{ fontSize: '0.7rem', color: '#6b7280', fontFamily: 'monospace' }}>{decimalParaGMS(p.lat, 'lat')} {decimalParaGMS(p.lng, 'lng')}</span>
                    <button
                      type="button"
                      onClick={() => setPontosExtras(prev => prev.filter(x => x.id !== p.id))}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 900, fontSize: '0.8rem', padding: 0 }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
            {pontosExtras.length === 0 && (
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center' }}>Nenhum ponto adicional. Preencha os campos acima para adicionar.</div>
            )}
          </div>

          <div className="plan-form-secao">🏛️ Órgãos Empenhados</div>
          <OrgaosPanel selecionados={equipe} onChange={setEquipe} />

          <div className="plan-form-secao">🛡️ Agentes da Guarda Municipal</div>
          <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 10, padding: '0.6rem 0.7rem', marginBottom: '0.3rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Selecione os agentes da Guarda escalados para este planejamento
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {AGENTES.map(ag => {
                const sel = agentesDefesaCivil.includes(ag)
                return (
                  <button
                    key={ag}
                    type="button"
                    onClick={() => setAgentesDefesaCivil(prev => sel ? prev.filter(a => a !== ag) : [...prev, ag])}
                    style={{
                      background: sel ? '#059669' : '#f0fdf4',
                      color: sel ? 'white' : '#166534',
                      border: sel ? '1.5px solid #059669' : '1.5px solid #bbf7d0',
                      borderRadius: 20,
                      padding: '0.32rem 0.75rem',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '0.3rem',
                      transition: 'all 0.15s',
                    }}
                  >
                    {sel && <span style={{ fontSize: '0.75rem' }}>✓</span>}
                    {ag}
                  </button>
                )
              })}
            </div>
            {agentesDefesaCivil.length > 0 && (
              <div style={{ marginTop: '0.45rem', fontSize: '0.73rem', color: '#059669', fontWeight: 600 }}>
                ✅ {agentesDefesaCivil.length} agente{agentesDefesaCivil.length > 1 ? 's' : ''} selecionado{agentesDefesaCivil.length > 1 ? 's' : ''}
              </div>
            )}
          </div>

          <div className="plan-form-secao">📦 Materiais e recursos</div>
          <PreListasPanel onAdicionarItens={adicionarMateriais} />
          {materiais.length > 0 && (
            <div className="plan-mat-lista">
              {materiais.map(m => (
                <div key={m.id} className="plan-mat-item">
                  <span className="plan-mat-item-nome">{m.nome}</span>
                  <span className="plan-mat-item-qtd">{m.quantidade} {m.unidade}</span>
                  <button className="plan-mat-item-del" onClick={() => removerMaterial(m.id)}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="plan-mat-adicionar">
            <input
              placeholder="Nome do material..."
              value={novoMat}
              onChange={e => setNovoMat(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarMaterial() } }}
            />
            <input
              className="qtd"
              type="number"
              min={1}
              placeholder="Qtd"
              value={novoMatQtd}
              onChange={e => setNovoMatQtd(e.target.value)}
            />
            <select
              style={{ width: 60, padding: '0.55rem 0.3rem', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: '0.82rem', background: '#f9fafb' }}
              value={novoMatUnd}
              onChange={e => setNovoMatUnd(e.target.value)}
            >
              <option value="un">un</option>
              <option value="kit">kit</option>
              <option value="cx">cx</option>
              <option value="rolo">rolo</option>
              <option value="lt">lt</option>
            </select>
            <button className="plan-btn-add" onClick={adicionarMaterial}>+ Add</button>
          </div>

          <div className="plan-form-secao">📝 Observações operacionais</div>
          <div className="plan-form-group">
            <textarea
              className="plan-form-textarea"
              placeholder="Pontos de atenção, contatos, orientação de serviço e informações para a passagem de equipe..."
              value={observacoes}
              onChange={e => setObservacoes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <div className="plan-modal-footer">
          <button className="plan-btn-cancelar" onClick={onFechar}>Cancelar</button>
          <button className="plan-btn-salvar" onClick={salvar} disabled={!nome.trim()}>
            💾 Salvar planejamento
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Previsão do tempo horária (Open-Meteo) ──────────────────────────────
const WMO_LABEL: Record<number, { emoji: string; desc: string }> = {
  0:  { emoji: '☀️',  desc: 'Céu limpo' },
  1:  { emoji: '🌤️', desc: 'Predominantemente limpo' },
  2:  { emoji: '⛅',  desc: 'Parcialmente nublado' },
  3:  { emoji: '☁️',  desc: 'Encoberto' },
  45: { emoji: '🌫️', desc: 'Neblina' },
  48: { emoji: '🌫️', desc: 'Neblina com gelo' },
  51: { emoji: '🌦️', desc: 'Garoa fraca' },
  53: { emoji: '🌦️', desc: 'Garoa moderada' },
  55: { emoji: '🌧️', desc: 'Garoa forte' },
  61: { emoji: '🌧️', desc: 'Chuva fraca' },
  63: { emoji: '🌧️', desc: 'Chuva moderada' },
  65: { emoji: '🌧️', desc: 'Chuva forte' },
  71: { emoji: '❄️',  desc: 'Neve fraca' },
  80: { emoji: '⛈️',  desc: 'Pancadas de chuva' },
  81: { emoji: '⛈️',  desc: 'Pancadas moderadas' },
  82: { emoji: '⛈️',  desc: 'Pancadas fortes' },
  95: { emoji: '⛈️',  desc: 'Trovoada' },
  96: { emoji: '⛈️',  desc: 'Trovoada com granizo' },
  99: { emoji: '⛈️',  desc: 'Trovoada com granizo forte' },
}

interface HoraDados { hora: number; emoji: string; desc: string; temp: number; precip: number; prob: number; umidade: number }

function PrevisaoTempoCompleta({ lat, lng, data, horario }: { lat: number; lng: number; data: string; horario?: string }) {
  const [horas, setHoras] = useState<HoraDados[]>([])
  const [status, setStatus] = useState<'carregando' | 'ok' | 'indisponivel'>('carregando')
  const [expandido, setExpandido] = useState(false)

  useEffect(() => {
    const hoje = new Date()
    const dataEvento = new Date(data + 'T12:00:00')
    const diffDias = Math.round((dataEvento.getTime() - hoje.getTime()) / 86400000)
    if (diffDias < -1 || diffDias > 16) { setStatus('indisponivel'); return }

    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=temperature_2m,precipitation_probability,precipitation,relativehumidity_2m,weathercode&timezone=America%2FSao_Paulo&start_date=${data}&end_date=${data}`)
      .then(r => r.json())
      .then(d => {
        const times: string[] = d.hourly?.time ?? []
        const temps: number[] = d.hourly?.temperature_2m ?? []
        const probs: number[] = d.hourly?.precipitation_probability ?? []
        const precips: number[] = d.hourly?.precipitation ?? []
        const umids: number[] = d.hourly?.relativehumidity_2m ?? []
        const codes: number[] = d.hourly?.weathercode ?? []
        const resultado: HoraDados[] = times.map((t, i) => {
          const hora = new Date(t).getHours()
          const wmo = WMO_LABEL[codes[i] ?? 0] ?? { emoji: '🌡️', desc: 'Variável' }
          return { hora, emoji: wmo.emoji, desc: wmo.desc, temp: temps[i] ?? 0, precip: precips[i] ?? 0, prob: probs[i] ?? 0, umidade: umids[i] ?? 0 }
        })
        setHoras(resultado)
        setStatus('ok')
      })
      .catch(() => setStatus('indisponivel'))
  }, [lat, lng, data])

  if (status === 'carregando') return (
    <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '0.4rem 0.75rem', fontSize: '0.75rem', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
      <span>🌤️</span> Buscando previsão do tempo...
    </div>
  )
  if (status === 'indisponivel' || horas.length === 0) return (
    <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.4rem 0.75rem', fontSize: '0.72rem', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
      <span>🌡️</span> Previsão indisponível para esta data
    </div>
  )

  const maxTemp = Math.max(...horas.map(h => h.temp))
  const minTemp = Math.min(...horas.map(h => h.temp))
  const maxProb = Math.max(...horas.map(h => h.prob))
  const totalPrecip = horas.reduce((s, h) => s + h.precip, 0)
  const midHour = horas[12] ?? horas[0]
  const horaEvento = horario ? parseInt(horario.split(':')[0], 10) : null
  const corFundo = maxProb > 60 ? '#eff6ff' : maxProb > 30 ? '#f0fdf4' : '#fefce8'
  const corBorda = maxProb > 60 ? '#bfdbfe' : maxProb > 30 ? '#bbf7d0' : '#fde68a'

  return (
    <div style={{ background: corFundo, border: `1.5px solid ${corBorda}`, borderRadius: 10, overflow: 'hidden' }}>
      {/* Cabeçalho */}
      <div style={{ padding: '0.3rem 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          🌤️ Previsão do Tempo no dia do Evento
        </span>
      </div>

      {/* Resumo clicável */}
      <button
        onClick={() => setExpandido(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.75rem 0.38rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }}>{midHour.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.75rem', color: '#1f2937' }}>{midHour.desc}</div>
          <div style={{ fontSize: '0.63rem', color: '#6b7280', marginTop: 1 }}>
            🌡️ {minTemp.toFixed(0)}°–{maxTemp.toFixed(0)}°C · 💧 {totalPrecip.toFixed(1)}mm · ☔ {maxProb}%
          </div>
        </div>
        <span style={{ fontSize: '0.58rem', color: '#9ca3af', fontWeight: 700, flexShrink: 0 }}>{expandido ? '▲' : '▼ Horas'}</span>
      </button>

      {/* Tabela horária */}
      {expandido && (
        <div style={{ borderTop: `1px solid ${corBorda}` }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.05)' }}>
                  <th style={{ padding: '0.2rem 0.4rem', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Hora</th>
                  <th style={{ padding: '0.2rem 0.3rem', textAlign: 'center' }}>Tempo</th>
                  <th style={{ padding: '0.2rem 0.3rem', textAlign: 'center', whiteSpace: 'nowrap' }}>🌡️</th>
                  <th style={{ padding: '0.2rem 0.3rem', textAlign: 'center', whiteSpace: 'nowrap' }}>☔</th>
                  <th style={{ padding: '0.2rem 0.3rem', textAlign: 'center', whiteSpace: 'nowrap' }}>💦</th>
                </tr>
              </thead>
              <tbody>
                {horas.map(h => {
                  const destaque = horaEvento !== null && h.hora === horaEvento
                  return (
                    <tr key={h.hora} style={{ background: destaque ? '#fef9c3' : h.hora % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)', borderLeft: destaque ? '3px solid #f59e0b' : '3px solid transparent' }}>
                      <td style={{ padding: '0.18rem 0.4rem', fontWeight: destaque ? 800 : 600, color: destaque ? '#92400e' : '#374151', whiteSpace: 'nowrap' }}>
                        {String(h.hora).padStart(2,'0')}h{destaque ? ' ⏰' : ''}
                      </td>
                      <td style={{ padding: '0.18rem 0.3rem', textAlign: 'center', fontSize: '0.85rem' }}>{h.emoji}</td>
                      <td style={{ padding: '0.18rem 0.3rem', textAlign: 'center', fontWeight: 700, color: h.temp >= 32 ? '#b91c1c' : h.temp >= 28 ? '#c2410c' : h.temp >= 22 ? '#15803d' : '#1d4ed8' }}>
                        {h.temp.toFixed(0)}°
                      </td>
                      <td style={{ padding: '0.18rem 0.3rem', textAlign: 'center', color: h.prob > 60 ? '#1d4ed8' : h.prob > 30 ? '#0891b2' : '#9ca3af', fontWeight: 600 }}>
                        {h.prob}%{h.precip > 0 ? <span style={{ fontSize: '0.55rem', display: 'block' }}>{h.precip.toFixed(1)}mm</span> : ''}
                      </td>
                      <td style={{ padding: '0.18rem 0.3rem', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>
                        {h.umidade}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '0.15rem 0.65rem', fontSize: '0.55rem', color: '#9ca3af', textAlign: 'right' }}>Fonte: Open-Meteo</div>
        </div>
      )}
    </div>
  )
}

// ── Excel export de evento com fotos ────────────────────────────────────
async function exportarEventoExcel(plano: Plano) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Guarda Municipal - Conselheiro Lafaiete'
  const ws = wb.addWorksheet('Evento', { pageSetup: { paperSize: 9, orientation: 'portrait' } })

  ws.columns = [
    { key: 'a', width: 26 },
    { key: 'b', width: 50 },
  ]

  const estiloTitulo = { font: { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1A4B8C' } }, alignment: { horizontal: 'center' as const } }
  const estiloSecao = { font: { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF059669' } } }
  const estiloLabel = { font: { bold: true, size: 9, color: { argb: 'FF374151' } }, fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF1F5F9' } } }

  const r1 = ws.addRow(['Guarda Municipal — Conselheiro Lafaiete — ' + plano.nome, ''])
  ws.mergeCells(`A${r1.number}:B${r1.number}`)
  Object.assign(r1.getCell(1), estiloTitulo)
  r1.height = 22

  ws.addRow([''])

  const rSec1 = ws.addRow(['📋 INFORMAÇÕES DO EVENTO', ''])
  ws.mergeCells(`A${rSec1.number}:B${rSec1.number}`)
  Object.assign(rSec1.getCell(1), estiloSecao)

  const info: [string, string][] = [
    ['Nome', plano.nome],
    ['Tipo', plano.tipo],
    ['Data Início', plano.dataInicio ? formatarData(plano.dataInicio) : '—'],
    ['Data Fim', plano.dataFim ? formatarData(plano.dataFim) : '—'],
    ['Horário', plano.horario ? `${plano.horario}${plano.horarioFim ? ' – ' + plano.horarioFim : ''}` : '—'],
    ['Local', plano.local || '—'],
    ['Descrição', plano.descricao || '—'],
    ['Público Estimado', plano.publicoEstimado ? plano.publicoEstimado + ' pessoas' : '—'],
    ['Status', plano.status],
    ['Risco', plano.risco],
    ['Observações', plano.observacoes || '—'],
    ['Criado por', plano.criadoPor],
    ['Criado em', new Date(plano.criadoEm).toLocaleDateString('pt-BR')],
  ]
  info.forEach(([label, val]) => {
    const r = ws.addRow([label, val])
    Object.assign(r.getCell(1), estiloLabel)
    r.getCell(2).font = { size: 9 }
    r.height = 16
  })

  ws.addRow([''])
  const rSec2 = ws.addRow(['🧑‍🚒 AGENTES ESCALADOS', ''])
  ws.mergeCells(`A${rSec2.number}:B${rSec2.number}`)
  Object.assign(rSec2.getCell(1), estiloSecao)

  const rHdr = ws.addRow(['Agente', 'Confirmação'])
  Object.assign(rHdr.getCell(1), estiloLabel)
  Object.assign(rHdr.getCell(2), estiloLabel)

  const agentes = plano.agentesDefesaCivil ?? []
  if (agentes.length === 0) {
    ws.addRow(['Nenhum agente escalado', ''])
  } else {
    agentes.forEach(ag => {
      const conf = (plano.confirmacoes ?? []).find(c => c.agente === ag)
      const status = conf?.confirmado ? `✅ Confirmado em ${conf.confirmedAt ? new Date(conf.confirmedAt).toLocaleString('pt-BR') : ''}` : '⏳ Aguardando'
      const r = ws.addRow([ag, status])
      r.getCell(2).font = { color: { argb: conf?.confirmado ? 'FF059669' : 'FFB45309' } }
    })
  }

  const fotos = plano.fotosEvento ?? []
  if (fotos.length > 0) {
    ws.addRow([''])
    const rSec3 = ws.addRow([`📸 ${(LABEL_FOTOS_TIPO[plano.tipo] ?? 'Fotos').toUpperCase()} (${fotos.length})`, ''])
    ws.mergeCells(`A${rSec3.number}:B${rSec3.number}`)
    Object.assign(rSec3.getCell(1), estiloSecao)
    ws.addRow([''])

    for (const foto of fotos) {
      const base64Data = foto.split(',')[1] ?? foto
      const ext = foto.startsWith('data:image/png') ? 'png' : 'jpeg'
      try {
        const imgId = wb.addImage({ base64: base64Data, extension: ext as 'jpeg' | 'png' })
        const startRow = ws.lastRow!.number
        ws.addRows(Array.from({ length: 20 }, () => ['', '']))
        ws.addImage(imgId, { tl: { col: 0, row: startRow }, ext: { width: 420, height: 280 } })
        ws.getRow(startRow + 1).height = 200
      } catch { /* ignora foto inválida */ }
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `evento_${plano.nome.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Tela de detalhe do planejamento ────────────────────────────────────
function DetalheP({
  plano,
  onVoltar,
  onAtualizar,
  onDeletar,
}: {
  plano: Plano
  onVoltar: () => void
  onAtualizar: (p: Plano) => void
  onDeletar: (id: string) => void
}) {
  const cfg = TIPOS_CONFIG[plano.tipo]
  const [editando, setEditando] = useState(false)
  const [planoLocal, setPlanoLocal] = useState(plano)
  const [salvandoConf, setSalvandoConf] = useState(false)
  const [carregandoFotos, setCarregandoFotos] = useState(false)
  const [exportandoExcel, setExportandoExcel] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [salvandoAuto, setSalvandoAuto] = useState(false)
  const [fotoEditando, setFotoEditando] = useState<FotoGeolocada | null>(null)
  const [editGms, setEditGms] = useState({
    latG: '0', latM: '0', latS: '0.0', latD: 'S' as 'N' | 'S',
    lngG: '0', lngM: '0', lngS: '0.0', lngD: 'O' as 'L' | 'O',
  })
  const [modalConclusao, setModalConclusao] = useState(false)
  const [textoConclusao, setTextoConclusao] = useState('')
  const [salvandoConclusao, setSalvandoConclusao] = useState(false)
  const [modalSenha, setModalSenha] = useState(false)
  const [senhaInput, setSenhaInput] = useState('')
  const [senhaErro, setSenhaErro] = useState(false)
  const acaoAposSenhaRef = useRef<(() => void) | null>(null)
  const pendentesRef = useRef<(() => Promise<void>)[]>([])
  // fotosRef mantém o array atualizado de forma SÍNCRONA para evitar race condition
  // quando várias fotos são tiradas rapidamente (planoLocal.fotosEvento fica stale no closure React)
  const fotosRef = useRef<(string | FotoGeolocada)[]>(plano.fotosEvento ?? [])
  const planoLocalRef = useRef<Plano>(plano)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputCameraRef = useRef<HTMLInputElement>(null)
  // Viewport atual do mapa — atualizado pelo MapViewTracker quando o usuário move/dá zoom
  const mapCenterRef = useRef<[number, number] | undefined>(undefined)
  const mapZoomRef = useRef<number | undefined>(undefined)
  const meuNomeAgente = getNomeAgenteGlobal()

  // Ao montar o componente: carrega fotos pendentes do IndexedDB e mescla com as do servidor
  useEffect(() => {
    getFotosCampoPendentes(plano.id).then(pendentes => {
      if (pendentes.length === 0) return
      const idsExistentes = new Set(
        (plano.fotosEvento ?? [])
          .filter((f): f is FotoGeolocada => typeof f === 'object' && f !== null && 'id' in f)
          .map(f => f.id)
      )
      const extras: FotoGeolocada[] = pendentes
        .filter(p => !idsExistentes.has((p.foto as FotoGeolocada).id))
        .map(p => ({ ...(p.foto as FotoGeolocada), status: 'pendente' as const, _localId: p.localId }))
      if (extras.length === 0) return
      const merged = [...(plano.fotosEvento ?? []), ...extras]
      fotosRef.current = merged
      setPlanoLocal(prev => ({ ...prev, fotosEvento: merged }))
    }).catch(() => {})
  // Executa só na montagem — plano.id é estável
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano.id])

  // Detecção de conexão — salva pendentes ao reconectar e sincroniza fotos de campo
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true)
      const queue = [...pendentesRef.current]
      pendentesRef.current = []
      for (const fn of queue) {
        try { await fn() } catch { /* silencioso */ }
      }
      // Sincroniza fotos de campo que ficaram pendentes no IndexedDB
      sincronizarFotosPendentes()
    }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Supabase Realtime — atualiza em tempo real quando OUTRO agente edita essa operação.
  // Não sobrescreve fotos_evento se o agente local está ativamente capturando fotos
  // (carregandoFotos=true), pois isso causaria perda de fotos recém-tiradas.
  const carregandoFotosRef = useRef(false)
  useEffect(() => { carregandoFotosRef.current = carregandoFotos }, [carregandoFotos])
  useEffect(() => { planoLocalRef.current = planoLocal }, [planoLocal])

  useEffect(() => {
    if (!supabaseDisponivel) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = (supabase.channel(`plan-rt-${planoLocal.id}`) as any)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'planejamentos', filter: `id=eq.${planoLocal.id}` },
        (payload: { new: Record<string, unknown> }) => {
          if (!payload.new) return
          const atualizado = sbParaPlano(payload.new)
          // Se estamos capturando fotos, preserva as fotos locais (em fotosRef) e só atualiza o resto
          if (carregandoFotosRef.current) {
            setPlanoLocal(prev => ({ ...atualizado, fotosEvento: fotosRef.current.length > 0 ? fotosRef.current : prev.fotosEvento }))
            onAtualizar({ ...atualizado, fotosEvento: fotosRef.current.length > 0 ? fotosRef.current : atualizado.fotosEvento ?? [] })
          } else {
            // Atualiza fotosRef com o que veio do banco (de outro agente)
            fotosRef.current = atualizado.fotosEvento ?? []
            setPlanoLocal(atualizado)
            onAtualizar(atualizado)
          }
        }
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planoLocal.id])

  // Sincroniza confirmações em tempo real quando outro agente confirma (via WS → parent → prop)
  const numConfirmados = (plano.confirmacoes ?? []).filter(c => c.confirmado).length
  useEffect(() => {
    setPlanoLocal(prev => ({
      ...prev,
      confirmacoes: plano.confirmacoes ?? prev.confirmacoes,
      fotosEvento: plano.fotosEvento ?? prev.fotosEvento,
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numConfirmados, plano.id])

  async function confirmarPresenca(novoStatus: boolean) {
    if (!meuNomeAgente) return
    setSalvandoConf(true)
    try {
      if (supabaseDisponivel) {
        const confirmacoes = (planoLocal.confirmacoes ?? [])
          .filter(c => c.agente !== meuNomeAgente)
        confirmacoes.push({
          agente: meuNomeAgente,
          confirmado: novoStatus,
          confirmedAt: new Date().toISOString(),
        })
        const { error } = await supabase
          .from('planejamentos')
          .update({ confirmacoes_agentes: confirmacoes })
          .eq('id', planoLocal.id)
        if (error) throw new Error(error.message)
        const atualizado = { ...planoLocal, confirmacoes }
        setPlanoLocal(atualizado)
        onAtualizar(atualizado)
      } else {
        const res = await fetch(`/api/planejamentos/${planoLocal.id}/confirmar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agente: meuNomeAgente, confirmado: novoStatus, criador: planoLocal.criadoPor }),
        })
        if (res.ok) {
          const data = await res.json()
          const atualizado = { ...planoLocal, confirmacoes: data.confirmacoes }
          setPlanoLocal(atualizado)
          onAtualizar(atualizado)
        }
      }
    } finally {
      setSalvandoConf(false)
    }
  }

  // Salva array COMPLETO de fotos no servidor via PUT (idempotente — substitui tudo)
  async function persistirFotos(todasFotos: (string | FotoGeolocada)[]) {
    if (supabaseDisponivel) {
      const { error } = await supabase.from('planejamentos')
        .update({ fotos_evento: todasFotos }).eq('id', planoLocal.id)
      if (error) throw new Error(error.message)
      wsSend({ tipo: 'planejamentos_atualizados' })
    } else {
      const resp = await fetch(`/api/planejamentos/${planoLocal.id}/fotos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fotos: todasFotos }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    }
  }

  // Remove campos internos (status, _localId) antes de persistir no servidor
  function prepararParaSalvar(fotos: (string | FotoGeolocada)[]): (string | FotoGeolocada)[] {
    return fotos.map(f => {
      if (typeof f !== 'object' || f === null) return f
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { status: _s, _localId: _l, ...limpo } = f
      return limpo
    })
  }

  // Sincroniza fotos pendentes do IndexedDB com o Supabase ao reconectar
  async function sincronizarFotosPendentes() {
    try {
      const pendentes = await getFotosCampoPendentes(planoLocal.id)
      if (pendentes.length === 0) return
      // Salva o array completo com todas as fotos (incluindo as pendentes) sem campos internos
      const fotasLimpas = prepararParaSalvar(fotosRef.current)
      await persistirFotos(fotasLimpas)
      // Sincronização bem-sucedida: remove do IndexedDB e atualiza status na UI
      await clearFotosCampoPendentesPlano(planoLocal.id)
      const fotasSalvas = fotosRef.current.map(f =>
        typeof f === 'object' && f !== null ? { ...f, status: 'salvo' as const, _localId: undefined } : f
      )
      fotosRef.current = fotasSalvas
      setPlanoLocal(prev => ({ ...prev, fotosEvento: fotasSalvas }))
      onAtualizar({ ...planoLocalRef.current, fotosEvento: prepararParaSalvar(fotasSalvas) })
    } catch {
      // Permanece no IndexedDB — próxima reconexão tenta de novo
    }
  }

  // Comprime uma foto base64 em WebP antes de salvar no banco.
  // O WebP mantém boa qualidade visual com menos bytes que o JPEG.
  async function comprimirFotoEvento(dataUrl: string, maxW = 800, qualidade = 0.70): Promise<string> {
    if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxW) { height = Math.round(height * maxW / width); width = maxW }
        try {
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) { resolve(dataUrl); return }
          ctx.drawImage(img, 0, 0, width, height)
          const webp = canvas.toDataURL('image/webp', qualidade)
          resolve(webp.startsWith('data:image/webp') ? webp : dataUrl)
        } catch { resolve(dataUrl) }
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    })
  }

  async function adicionarFotosEvento(files: FileList | null) {
    if (!files || files.length === 0) return
    setCarregandoFotos(true)
    try {
      const novas: FotoGeolocada[] = []
      for (const file of Array.from(files)) {
        const b64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = (e) => resolve(e.target?.result as string)
          reader.readAsDataURL(file)
        })
        const fotoComprimida = await comprimirFotoEvento(b64)
        const thumb = await criarThumbnail(fotoComprimida, 120)
        const novaFoto: FotoGeolocada = {
          id: gerarId(), foto: fotoComprimida, thumb, lat: LAT_FOTO_PADRAO, lng: LNG_FOTO_PADRAO,
          agente: meuNomeAgente || 'Agente', timestamp: Date.now(), status: 'pendente',
        }
        // Salva no IndexedDB imediatamente (funciona offline)
        const localId = await saveFotoCampoPendente(planoLocal.id, novaFoto)
        novas.push({ ...novaFoto, _localId: Number(localId) })
      }
      const todasFotos: (string | FotoGeolocada)[] = [...fotosRef.current, ...novas]
      fotosRef.current = todasFotos
      setPlanoLocal(prev => ({ ...prev, fotosEvento: todasFotos }))
      onAtualizar({ ...planoLocal, fotosEvento: prepararParaSalvar(todasFotos) })
      // Tenta salvar no servidor em background (se online)
      if (navigator.onLine) {
        try {
          await persistirFotos(prepararParaSalvar(todasFotos))
          // Sucesso: remove do IndexedDB e marca como salvo na UI
          for (const f of novas) { if (f._localId) await removeFotoCampoPendente(f._localId) }
          const fotasSalvas = fotosRef.current.map(f =>
            typeof f === 'object' && f !== null && novas.some(n => n.id === f.id)
              ? { ...f, status: 'salvo' as const, _localId: undefined } : f
          )
          fotosRef.current = fotasSalvas
          setPlanoLocal(prev => ({ ...prev, fotosEvento: fotasSalvas }))
        } catch { /* Permanece pendente no IndexedDB */ }
      }
    } finally {
      setCarregandoFotos(false)
    }
  }

  async function capturarFotoComGPS(files: FileList | null) {
    if (!files || files.length === 0) return
    setCarregandoFotos(true)
    try {
      let lat: number | null = null
      let lng: number | null = null
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 6000 })
        )
        lat = pos.coords.latitude
        lng = pos.coords.longitude
      } catch { /* GPS indisponível — usa coordenada padrão de Conselheiro Lafaiete */ }
      // Se não obteve GPS, posiciona no centro de Conselheiro Lafaiete para poder editar depois
      if (lat === null || lng === null) {
        lat = LAT_FOTO_PADRAO
        lng = LNG_FOTO_PADRAO
      }

      const novas: FotoGeolocada[] = []
      for (const file of Array.from(files)) {
        const b64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = (e) => resolve(e.target?.result as string)
          reader.readAsDataURL(file)
        })
        // Comprime: 800px / 70% qualidade → ~80-150 KB. Gera thumb para galeria.
        const fotoComprimida = await comprimirFotoEvento(b64)
        const thumb = await criarThumbnail(fotoComprimida, 120)
        // Salva no celular em background (não bloqueia o fluxo)
        salvarFotoNoDispositivo(fotoComprimida)
        const novaFoto: FotoGeolocada = {
          id: gerarId(), foto: fotoComprimida, thumb, lat, lng,
          agente: meuNomeAgente || 'Agente', timestamp: Date.now(), status: 'pendente',
        }
        // 1) Salva no IndexedDB IMEDIATAMENTE — garante que a foto não se perde se offline ou app fechar
        const localId = await saveFotoCampoPendente(planoLocal.id, novaFoto)
        novas.push({ ...novaFoto, _localId: Number(localId) })
      }

      // 2) Atualiza fotosRef e UI imediatamente (exibe badge "Pendente")
      const todasFotos: (string | FotoGeolocada)[] = [...fotosRef.current, ...novas]
      fotosRef.current = todasFotos
      setPlanoLocal(prev => ({ ...prev, fotosEvento: todasFotos }))
      onAtualizar({ ...planoLocal, fotosEvento: prepararParaSalvar(todasFotos) })

      // 3) Tenta salvar no Supabase em background (se online)
      if (navigator.onLine) {
        try {
          await persistirFotos(prepararParaSalvar(todasFotos))
          // Sucesso: remove do IndexedDB e atualiza badge para "Salvo"
          for (const f of novas) { if (f._localId) await removeFotoCampoPendente(f._localId) }
          const fotasSalvas = fotosRef.current.map(f =>
            typeof f === 'object' && f !== null && novas.some(n => n.id === (f as FotoGeolocada).id)
              ? { ...f, status: 'salvo' as const, _localId: undefined } : f
          )
          fotosRef.current = fotasSalvas
          setPlanoLocal(prev => ({ ...prev, fotosEvento: fotasSalvas }))
        } catch { /* IndexedDB garante sync posterior ao reconectar */ }
      }
    } finally {
      setCarregandoFotos(false)
      if (fileInputCameraRef.current) fileInputCameraRef.current.value = ''
    }
  }

  async function removerFotoEvento(idx: number) {
    const fotoRemovida = fotosRef.current[idx]
    const todasFotos = fotosRef.current.filter((_, i) => i !== idx)
    fotosRef.current = todasFotos
    // Se a foto estava só no IndexedDB (pendente), remove de lá também
    if (typeof fotoRemovida === 'object' && fotoRemovida._localId) {
      removeFotoCampoPendente(fotoRemovida._localId).catch(() => {})
    }
    const todasLimpas = prepararParaSalvar(todasFotos)
    if (!navigator.onLine) {
      pendentesRef.current.push(() => persistirFotos(todasLimpas))
    } else {
      try { await persistirFotos(todasLimpas) } catch { pendentesRef.current.push(() => persistirFotos(todasLimpas)) }
    }
    const atualizado = { ...planoLocal, fotosEvento: todasFotos }
    setPlanoLocal(atualizado)
    onAtualizar({ ...atualizado, fotosEvento: todasLimpas })
  }

  function pedirSenhaParaExecutar(acao: () => void) {
    const senhaEsperada = getSenhaAgente(meuNomeAgente) ?? 'dc-2026'
    if (!senhaEsperada) { acao(); return }
    acaoAposSenhaRef.current = acao
    setSenhaInput('')
    setSenhaErro(false)
    setModalSenha(true)
  }

  function confirmarSenha() {
    const senhaEsperada = getSenhaAgente(meuNomeAgente) ?? 'dc-2026'
    if (senhaInput === senhaEsperada) {
      setModalSenha(false)
      setSenhaInput('')
      setSenhaErro(false)
      acaoAposSenhaRef.current?.()
      acaoAposSenhaRef.current = null
    } else {
      setSenhaErro(true)
    }
  }

  // Abre o modal de edição de coordenadas inicializando os campos GMS com os valores atuais
  function abrirEditarFoto(foto: FotoGeolocada) {
    pedirSenhaParaExecutar(() => {
      if (foto.lat != null && foto.lng != null) {
        const lat = decomporDecimalGMS(foto.lat, 'lat')
        const lng = decomporDecimalGMS(foto.lng, 'lng')
        setEditGms({
          latG: String(lat.graus), latM: String(lat.minutos), latS: String(lat.segundos), latD: lat.direcao as 'N' | 'S',
          lngG: String(lng.graus), lngM: String(lng.minutos), lngS: String(lng.segundos), lngD: lng.direcao as 'L' | 'O',
        })
      }
      setFotoEditando(foto)
    })
  }

  async function salvarCoordenadasFoto() {
    if (!fotoEditando) return
    const novaLat = gmsComponentesParaDecimal(Number(editGms.latG), Number(editGms.latM), Number(editGms.latS), editGms.latD)
    const novaLng = gmsComponentesParaDecimal(Number(editGms.lngG), Number(editGms.lngM), Number(editGms.lngS), editGms.lngD)
    const todasFotos = fotosRef.current.map(f =>
      typeof f === 'object' && f !== null && (f as FotoGeolocada).id === fotoEditando.id
        ? { ...f, lat: novaLat, lng: novaLng } : f
    )
    fotosRef.current = todasFotos
    setPlanoLocal(prev => ({ ...prev, fotosEvento: todasFotos }))
    onAtualizar({ ...planoLocal, fotosEvento: prepararParaSalvar(todasFotos) })
    if (navigator.onLine) {
      try { await persistirFotos(prepararParaSalvar(todasFotos)) } catch { pendentesRef.current.push(() => persistirFotos(prepararParaSalvar(todasFotos))) }
    } else {
      pendentesRef.current.push(() => persistirFotos(prepararParaSalvar(todasFotos)))
    }
    setFotoEditando(null)
  }

  // ── Prontidão ───────────────────────────────────────────────────────────
  const chaveLocal = `dc-prontidao-${plano.id}`
  const [emProntidao, setEmProntidao] = useState<boolean>(() => localStorage.getItem(chaveLocal) === '1')
  const [estadoGps, setEstadoGps] = useState(() => getEstadoGps())
  const [outrosProntidao, setOutrosProntidao] = useState<{ id: string; nome: string }[]>([])

  useEffect(() => {
    const unsub = subscribeGps(setEstadoGps)
    return unsub
  }, [])

  useEffect(() => {
    const planoId = plano.id
    const meuId = getDispositivoIdGlobal()

    const offIniciais = wsOn('prontidao_iniciais', (msg) => {
      const lista = Array.isArray(msg.agentes) ? msg.agentes as { id: string; nome: string; planoId: string }[] : []
      setOutrosProntidao(lista.filter(a => a.planoId === planoId && a.id !== meuId))
    })
    const offPront = wsOn('prontidao', (msg) => {
      if (String(msg.planoId) !== planoId) return
      const id = String(msg.id)
      if (id === meuId) return
      setOutrosProntidao(prev => prev.some(a => a.id === id) ? prev : [...prev, { id, nome: String(msg.nome || id) }])
    })
    const offSair = wsOn('prontidao_sair', (msg) => {
      if (String(msg.planoId) !== planoId) return
      const id = String(msg.id)
      setOutrosProntidao(prev => prev.filter(a => a.id !== id))
    })
    const offRemover = wsOn('remover', (msg) => {
      const id = String(msg.id)
      setOutrosProntidao(prev => prev.filter(a => a.id !== id))
    })

    return () => { offIniciais(); offPront(); offSair(); offRemover() }
  }, [plano.id])

  function toggleProntidao() {
    const meuId = getDispositivoIdGlobal()
    const meuNome = getNomeAgenteGlobal()
    if (emProntidao) {
      wsSend({ tipo: 'prontidao_sair', id: meuId, planoId: plano.id })
      localStorage.removeItem(chaveLocal)
      setEmProntidao(false)
    } else {
      wsSend({ tipo: 'prontidao', id: meuId, nome: meuNome, planoId: plano.id, ativo: true })
      localStorage.setItem(chaveLocal, '1')
      setEmProntidao(true)
      if (estadoGps.status === 'inativo' || estadoGps.status === 'erro') {
        ativarGps()
      }
    }
  }

  async function mudarStatus(status: StatusPlano) {
    if (status === 'concluido') {
      setModalConclusao(true)
      setTextoConclusao(planoLocal.conclusao ?? '')
      return
    }
    const anterior = planoLocal
    const atualizado = { ...planoLocal, status }
    setPlanoLocal(atualizado)
    onAtualizar(atualizado)
    try {
      if (supabaseDisponivel) {
        const { error } = await supabase
          .from('planejamentos')
          .update({ status, conclusao: atualizado.conclusao ?? null })
          .eq('id', planoLocal.id)
        if (error) throw new Error(error.message)
        wsSend({ tipo: 'planejamentos_atualizados' })
      } else {
        const res = await fetch(`/api/planejamentos/${planoLocal.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, conclusao: atualizado.conclusao ?? null }),
        })
        if (!res.ok) {
          // Reverte estado local se o servidor recusar (ex: 409 já concluído)
          setPlanoLocal(anterior)
          onAtualizar(anterior)
        }
      }
    } catch {
      // Falha de rede — reverte para o estado anterior
      setPlanoLocal(anterior)
      onAtualizar(anterior)
    }
  }

  async function confirmarConclusao() {
    const texto = textoConclusao.trim()
    const atualizado = { ...planoLocal, status: 'concluido' as StatusPlano, conclusao: texto }
    setSalvandoConclusao(true)
    try {
      if (supabaseDisponivel) {
        // Supabase (Netlify): update direto com status e conclusao
        const { error } = await supabase
          .from('planejamentos')
          .update({ status: 'concluido', conclusao: texto })
          .eq('id', planoLocal.id)
        if (error) throw new Error(error.message)
        wsSend({ tipo: 'planejamentos_atualizados' })
      } else {
        // Express (Replit): usa o endpoint PATCH que tem proteção CASE no banco
        const res = await fetch(`/api/planejamentos/${planoLocal.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'concluido', conclusao: texto }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
    } catch (e) {
      console.error('[confirmarConclusao] Erro ao salvar:', e)
      alert('Erro ao finalizar operação. Verifique sua conexão e tente novamente.')
      setSalvandoConclusao(false)
      return
    }
    // Salvo com sucesso — atualiza estado local e fecha modal
    setPlanoLocal(atualizado)
    onAtualizar(atualizado)
    setModalConclusao(false)
    setSalvandoConclusao(false)
  }

  useEffect(() => {
    const offAdd = wsOn('plano_item_adicionado', (msg) => {
      if (String(msg.planoId) !== plano.id) return
      const item = msg.item as ItemMapa
      setPlanoLocal(prev => {
        if (prev.itensMapa.some(i => i.id === item.id)) return prev
        return { ...prev, itensMapa: [...prev.itensMapa, item] }
      })
    })
    const offRem = wsOn('plano_item_removido', (msg) => {
      if (String(msg.planoId) !== plano.id) return
      const itemId = String(msg.itemId)
      setPlanoLocal(prev => ({ ...prev, itensMapa: prev.itensMapa.filter(i => i.id !== itemId) }))
    })
    return () => { offAdd(); offRem() }
  }, [plano.id])

  function adicionarItem(item: ItemMapa) {
    const atualizado = { ...planoLocal, itensMapa: [...planoLocal.itensMapa, item] }
    setPlanoLocal(atualizado)
    onAtualizar(atualizado)
    wsSend({ tipo: 'plano_item_adicionado', planoId: plano.id, item })
  }

  function removerItem(id: string) {
    const atualizado = { ...planoLocal, itensMapa: planoLocal.itensMapa.filter(i => i.id !== id) }
    setPlanoLocal(atualizado)
    onAtualizar(atualizado)
    wsSend({ tipo: 'plano_item_removido', planoId: plano.id, itemId: id })
  }

  function atualizarQuantidadeMaterial(matId: string, novaQtd: number) {
    const qtd = Math.max(1, novaQtd)
    const atualizado = {
      ...planoLocal,
      materiais: planoLocal.materiais.map(m => m.id === matId ? { ...m, quantidade: qtd } : m),
    }
    setPlanoLocal(atualizado)
    onAtualizar(atualizado)
  }

  function removerMaterialDetalhe(matId: string) {
    const atualizado = {
      ...planoLocal,
      materiais: planoLocal.materiais.filter(m => m.id !== matId),
    }
    setPlanoLocal(atualizado)
    onAtualizar(atualizado)
  }

  function confirmarDeletar() {
    if (window.confirm(`Excluir "${planoLocal.nome}"? Esta ação não pode ser desfeita.`)) {
      onDeletar(planoLocal.id)
    }
  }

  const riscoCfg = RISCO_CONFIG[planoLocal.risco]

  return (
    <div className="plan-detalhe-overlay">
      <div className="plan-detalhe-header">
        <button className="plan-detalhe-voltar" onClick={onVoltar}>‹</button>
        <div className="plan-detalhe-titulo">
          <strong>{cfg.emoji} {planoLocal.nome}</strong>
          <span>{cfg.label}</span>
        </div>
        <div className="plan-detalhe-acoes">
          <button
            className="plan-detalhe-btn-acao"
            onClick={() => exportarPDF(planoLocal, mapCenterRef.current, mapZoomRef.current)}
            title="Exportar PDF"
            style={{ fontSize: '1rem' }}
          >📄</button>
          <button
            className="plan-detalhe-btn-acao"
            title="Exportar Excel com fotos"
            style={{ fontSize: '1rem', opacity: exportandoExcel ? 0.6 : 1 }}
            onClick={async () => {
              if (exportandoExcel) return
              setExportandoExcel(true)
              try { await exportarEventoExcel(planoLocal) } finally { setExportandoExcel(false) }
            }}
          >{exportandoExcel ? '⏳' : '📊'}</button>
          <button className="plan-detalhe-btn-acao" onClick={() => pedirSenhaParaExecutar(() => setEditando(true))} title="Editar">✏️</button>
        </div>
      </div>

      <div className="plan-detalhe-body">
        {/* Status + Risco */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {(Object.keys(STATUS_CONFIG) as StatusPlano[]).map(s => {
            const sc = STATUS_CONFIG[s]
            const jaConcluido = planoLocal.status === 'concluido'
            const isAtivo = planoLocal.status === s
            return (
              <button
                key={s}
                className={`plan-status-pill ${sc.classe} ${isAtivo ? 'ativo-pill' : ''}`}
                onClick={() => { if (!jaConcluido) mudarStatus(s) }}
                disabled={jaConcluido && !isAtivo}
                title={jaConcluido && !isAtivo ? 'Atividade concluída — status não pode ser alterado' : undefined}
                style={jaConcluido && !isAtivo ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
              >
                {sc.emoji} {sc.label}
              </button>
            )
          })}
        </div>

        {/* Info resumida */}
        {(planoLocal.local || planoLocal.dataInicio || planoLocal.descricao) && (
          <div className="plan-detalhe-card">
            <div className="plan-detalhe-card-body" style={{ padding: '0.5rem 0.85rem' }}>
              {planoLocal.local && (
                <div className="plan-detalhe-info-row">
                  <span className="plan-detalhe-info-label">📍 Local</span>
                  <span className="plan-detalhe-info-val">{planoLocal.local}</span>
                </div>
              )}
              {planoLocal.dataInicio && (
                <div className="plan-detalhe-info-row">
                  <span className="plan-detalhe-info-label">📅 Data</span>
                  <span className="plan-detalhe-info-val">
                    {formatarData(planoLocal.dataInicio)}
                    {planoLocal.dataFim && planoLocal.dataFim !== planoLocal.dataInicio && ` → ${formatarData(planoLocal.dataFim)}`}
                    {planoLocal.horario && ` · ${planoLocal.horario}${planoLocal.horarioFim ? ` – ${planoLocal.horarioFim}` : ''}`}
                  </span>
                </div>
              )}
              {planoLocal.descricao && (
                <div className="plan-detalhe-info-row">
                  <span className="plan-detalhe-info-label">📝 Desc.</span>
                  <span className="plan-detalhe-info-val">{planoLocal.descricao}</span>
                </div>
              )}
              {planoLocal.publicoEstimado && (
                <div className="plan-detalhe-info-row">
                  <span className="plan-detalhe-info-label">👥 Público</span>
                  <span className="plan-detalhe-info-val">{planoLocal.publicoEstimado} pessoas</span>
                </div>
              )}
              <div className="plan-detalhe-info-row" style={{ borderBottom: 'none' }}>
                <span className="plan-detalhe-info-label">👤 Criado</span>
                <span className="plan-detalhe-info-val">{planoLocal.criadoPor} · {new Date(planoLocal.criadoEm).toLocaleDateString('pt-BR')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Previsão do tempo horária */}
        {planoLocal.dataInicio && (
          <div style={{ position: 'relative', zIndex: 1000 }}>
            <PrevisaoTempoCompleta
              lat={planoLocal.lat ?? CONSELHEIRO_LAFAIETE_CENTER[0]}
              lng={planoLocal.lng ?? CONSELHEIRO_LAFAIETE_CENTER[1]}
              data={planoLocal.dataInicio}
              horario={planoLocal.horario}
            />
          </div>
        )}

        {/* Prontidão — strip compacto */}
        <div style={{
          background: emProntidao ? 'linear-gradient(90deg,#065f46,#059669)' : '#f1f5f9',
          border: emProntidao ? 'none' : '1.5px solid #e2e8f0',
          borderRadius: 12,
          padding: '0.45rem 0.75rem',
          display: 'flex', alignItems: 'center', gap: '0.55rem',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '0.9rem' }}>🛡️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '0.8rem', color: emProntidao ? 'white' : '#374151' }}>
                {emProntidao ? 'Em prontidão' : 'Prontidão'}
              </span>
              {emProntidao && (
                <span style={{ fontSize: '0.68rem', color: estadoGps.status === 'ativo' ? '#a7f3d0' : 'rgba(255,255,255,0.7)', fontWeight: 700 }}>
                  {estadoGps.status === 'ativo' ? '📡 GPS ativo' : estadoGps.status === 'aguardando' ? '⏳ Aguardando GPS' : '📵 GPS inativo'}
                </span>
              )}
              {outrosProntidao.length > 0 && (
                <span style={{ fontSize: '0.68rem', color: emProntidao ? 'rgba(255,255,255,0.8)' : '#6b7280' }}>
                  · {outrosProntidao.length} outro{outrosProntidao.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            {emProntidao && estadoGps.posicao && (
              <div style={{ fontSize: '0.65rem', color: '#a7f3d0', fontFamily: 'monospace', marginTop: 1, letterSpacing: '0.01em' }}>
                📍 {estadoGps.posicao.lat.toFixed(5)}, {estadoGps.posicao.lng.toFixed(5)}
                {estadoGps.posicao.precisao > 0 && estadoGps.posicao.precisao < 500 && (
                  <span style={{ opacity: 0.75, marginLeft: 4 }}>±{Math.round(estadoGps.posicao.precisao)}m</span>
                )}
              </div>
            )}
          </div>
          {emProntidao && (estadoGps.status === 'inativo' || estadoGps.status === 'erro') && (
            <button
              onClick={() => ativarGps()}
              style={{ background: '#f59e0b', color: 'white', border: 'none', borderRadius: 10, padding: '0.2rem 0.6rem', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer' }}
            >📡 GPS</button>
          )}
          <button
            onClick={toggleProntidao}
            style={{
              background: emProntidao ? 'rgba(255,255,255,0.2)' : '#1a4b8c',
              color: 'white',
              border: emProntidao ? '1.5px solid rgba(255,255,255,0.4)' : 'none',
              borderRadius: 20, padding: '0.28rem 0.75rem',
              fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0,
            }}
          >
            {emProntidao ? '🔴 Sair' : '📡 Entrar'}
          </button>
        </div>

        {/* ── Confirmações de presença ── */}
        {(planoLocal.agentesDefesaCivil ?? []).length > 0 && (
          <div className="plan-detalhe-card">
            <div className="plan-detalhe-card-header" style={{ background: 'linear-gradient(100deg,#065f46,#059669)', color: 'white', border: 'none' }}>
              🧑‍🚒 Confirmações de Presença
              <span style={{ marginLeft: 'auto', fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                {(planoLocal.confirmacoes ?? []).filter(c => c.confirmado).length}/{(planoLocal.agentesDefesaCivil ?? []).length} confirmado(s)
              </span>
            </div>
            <div style={{ padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {(planoLocal.agentesDefesaCivil ?? []).map(ag => {
                const conf = (planoLocal.confirmacoes ?? []).find(c => c.agente === ag)
                const eEu = meuNomeAgente && (ag === meuNomeAgente || ag.split(' ')[0] === meuNomeAgente.split(' ')[0])
                return (
                  <div key={ag} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', borderBottom: '1px solid #f0fdf4' }}>
                    <span style={{ fontSize: '0.88rem' }}>🧑‍🚒</span>
                    <span style={{
                      flex: 1, fontSize: '0.82rem',
                      fontWeight: (eEu || conf?.confirmado) ? 700 : 400,
                      color: conf?.confirmado ? '#059669' : '#1f2937',
                    }}>{ag}{eEu ? ' (você)' : ''}</span>
                    {conf
                      ? conf.confirmado
                        ? <span style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 700, background: '#d1fae5', borderRadius: 10, padding: '0.1rem 0.5rem' }}>✅ Confirmado</span>
                        : <span style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 700, background: '#fee2e2', borderRadius: 10, padding: '0.1rem 0.5rem' }}>❌ Recusou</span>
                      : <span style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 600, background: '#fef9c3', borderRadius: 10, padding: '0.1rem 0.5rem' }}>⏳ Aguardando</span>
                    }
                  </div>
                )
              })}

              {/* Botão de ação do agente logado */}
              {meuNomeAgente && (planoLocal.agentesDefesaCivil ?? []).some(ag => ag === meuNomeAgente || ag.split(' ')[0] === meuNomeAgente.split(' ')[0]) && (() => {
                const minhaConf = (planoLocal.confirmacoes ?? []).find(c => c.agente === meuNomeAgente || c.agente.split(' ')[0] === meuNomeAgente.split(' ')[0])
                return (
                  <button
                    onClick={() => confirmarPresenca(!(minhaConf?.confirmado))}
                    disabled={salvandoConf}
                    style={{
                      marginTop: '0.4rem',
                      background: minhaConf?.confirmado ? '#fee2e2' : 'linear-gradient(90deg,#065f46,#059669)',
                      color: minhaConf?.confirmado ? '#dc2626' : 'white',
                      border: 'none', borderRadius: 20,
                      padding: '0.35rem 1.1rem', fontSize: '0.8rem', fontWeight: 700,
                      cursor: salvandoConf ? 'wait' : 'pointer',
                      opacity: salvandoConf ? 0.7 : 1,
                      alignSelf: 'flex-start',
                    }}
                  >
                    {salvandoConf ? '⏳ Salvando...' : minhaConf?.confirmado ? '❌ Cancelar presença' : '✅ Confirmar minha presença'}
                  </button>
                )
              })()}
            </div>
          </div>
        )}

        {/* Inputs ocultos de câmera e galeria */}
        <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={e => { adicionarFotosEvento(e.target.files); if (fileInputRef.current) fileInputRef.current.value = '' }} />
        <input ref={fileInputCameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
          onChange={e => { capturarFotoComGPS(e.target.files) }} />

        {/* ── Barra de foto de campo — proeminente, no topo ── */}
        <div style={{
          background: emProntidao && estadoGps.status === 'ativo'
            ? 'linear-gradient(135deg,#0f2d5e,#1a4b8c)'
            : 'linear-gradient(135deg,#1e293b,#334155)',
          borderRadius: 14,
          padding: '0.7rem 0.9rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.55rem',
          boxShadow: emProntidao && estadoGps.status === 'ativo'
            ? '0 0 0 2px #1a4b8c, 0 4px 16px rgba(26,75,140,0.35)'
            : '0 2px 8px rgba(0,0,0,0.18)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1rem' }}>📸</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: '0.82rem', color: 'white', lineHeight: 1.2 }}>
                Registrar foto no campo
              </div>
              {emProntidao && estadoGps.posicao ? (
                <div style={{ fontSize: '0.65rem', color: '#93c5fd', fontFamily: 'monospace', marginTop: 1 }}>
                  📍 GPS: {estadoGps.posicao.lat.toFixed(5)}, {estadoGps.posicao.lng.toFixed(5)}
                  {estadoGps.posicao.precisao > 0 && estadoGps.posicao.precisao < 500 && (
                    <span style={{ opacity: 0.75, marginLeft: 4 }}>±{Math.round(estadoGps.posicao.precisao)}m</span>
                  )}
                  <span style={{ marginLeft: 6, color: '#86efac', fontWeight: 700 }}>· localização será marcada no mapa</span>
                </div>
              ) : (
                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 1 }}>
                  {emProntidao ? '⏳ Aguardando GPS para marcar localização...' : '📵 Entre em prontidão para marcar a localização no mapa'}
                </div>
              )}
            </div>
            {(planoLocal.fotosEvento ?? []).length > 0 && (
              <span style={{ background: 'rgba(255,255,255,0.15)', color: 'white', borderRadius: 20, padding: '0.15rem 0.6rem', fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                {(planoLocal.fotosEvento ?? []).length} foto{(planoLocal.fotosEvento ?? []).length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => fileInputCameraRef.current?.click()}
              disabled={carregandoFotos}
              title="Tirar foto com GPS"
              style={{
                flex: 1,
                background: carregandoFotos ? 'rgba(255,255,255,0.1)' : (emProntidao && estadoGps.status === 'ativo' ? 'linear-gradient(90deg,#2563eb,#1d4ed8)' : 'rgba(255,255,255,0.15)'),
                color: 'white',
                border: emProntidao && estadoGps.status === 'ativo' ? 'none' : '1.5px solid rgba(255,255,255,0.3)',
                borderRadius: 12,
                padding: '0.55rem 0.75rem',
                fontSize: '0.88rem',
                fontWeight: 800,
                cursor: carregandoFotos ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                boxShadow: emProntidao && estadoGps.status === 'ativo' ? '0 2px 8px rgba(37,99,235,0.5)' : 'none',
              }}
            >
              {carregandoFotos ? '⏳ Salvando...' : '📷 Tirar foto'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={carregandoFotos}
              title="Carregar foto da galeria"
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.85)',
                border: '1.5px solid rgba(255,255,255,0.25)',
                borderRadius: 12,
                padding: '0.55rem 0.75rem',
                fontSize: '0.88rem',
                fontWeight: 700,
                cursor: carregandoFotos ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
              }}
            >
              🖼️ Galeria
            </button>
          </div>
        </div>

        {/* ── Órgãos + Agentes + Materiais + Mapa + Fotos (integrado) ── */}
        <div className="plan-detalhe-card" style={{ overflow: 'visible' }}>
          <div className="plan-detalhe-card-header" style={{ background: 'linear-gradient(100deg,#123b73,#1a6bbf)', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span>🗺️ Equipe, Recursos e Mapa</span>
            {planoLocal.itensMapa.length > 0 && (
              <span style={{ fontWeight: 600, fontSize: '0.72rem', color: 'rgba(255,255,255,0.85)' }}>
                · {planoLocal.itensMapa.length} {planoLocal.itensMapa.length === 1 ? 'item' : 'itens'}
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {salvandoAuto && <span style={{ fontSize: '0.62rem', opacity: 0.8 }}>⟳</span>}
              {!isOnline && pendentesRef.current.length > 0 && (
                <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 8, padding: '1px 6px', fontSize: '0.62rem', fontWeight: 700 }}>
                  📶{pendentesRef.current.length}
                </span>
              )}
            </div>
          </div>
          <MapaDetalhe
            plano={planoLocal}
            onAdicionarItem={adicionarItem}
            onRemoverItem={removerItem}
            posicaoPropria={emProntidao && estadoGps.posicao ? estadoGps.posicao : null}
            nomeProprio={getNomeAgenteGlobal()}
            fotosGeolocadas={(planoLocal.fotosEvento ?? []).filter(
              (f): f is FotoGeolocada => typeof f === 'object' && f !== null && 'foto' in f && f.lat != null
            )}
            onEditarFotoCoords={abrirEditarFoto}
            onViewChange={(center, zoom) => { mapCenterRef.current = center; mapZoomRef.current = zoom }}
          />

          {/* ── Galeria de fotos abaixo do mapa ── */}
          <div style={{ padding: '0.6rem 0.75rem', borderTop: '1.5px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#1a3a6b' }}>📸 Fotos registradas no campo</span>
              <span style={{ background: '#dbeafe', color: '#1e3a8a', borderRadius: 10, padding: '1px 8px', fontSize: '0.68rem', fontWeight: 700 }}>
                {(planoLocal.fotosEvento ?? []).length}
              </span>
              {!isOnline && (
                <span style={{ fontSize: '0.68rem', color: '#b45309', fontWeight: 600 }}>📵 Offline</span>
              )}
            </div>

            {(planoLocal.fotosEvento ?? []).length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: '#9ca3af', textAlign: 'center', padding: '1rem 0', background: '#f8fafc', borderRadius: 10 }}>
                Nenhuma foto registrada. Use os botões <strong>📷 Tirar foto</strong> ou <strong>🖼️ Galeria</strong> acima para registrar fotos com localização GPS.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.45rem' }}>
                {(planoLocal.fotosEvento ?? []).map((fotoItem, idx) => {
                  const src = typeof fotoItem === 'string' ? fotoItem : fotoItem.foto
                  const temGps = typeof fotoItem !== 'string' && fotoItem.lat != null
                  const agente = typeof fotoItem !== 'string' ? fotoItem.agente : undefined
                  const ts = typeof fotoItem !== 'string' ? fotoItem.timestamp : undefined
                  const statusFoto = typeof fotoItem !== 'string' ? fotoItem.status : undefined
                  const ePendente = statusFoto === 'pendente'
                  return (
                    <div key={idx} style={{
                      position: 'relative', borderRadius: 8, overflow: 'hidden', aspectRatio: '1',
                      background: '#f1f5f9', boxShadow: ePendente ? '0 0 0 2px #f59e0b' : '0 1px 4px rgba(0,0,0,0.12)',
                    }}>
                      <img
                        src={src}
                        alt={`Foto ${idx + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
                        loading="lazy"
                        onClick={() => window.open(src, '_blank')}
                      />
                      <div style={{
                        position: 'absolute', top: 2, left: 2,
                        background: 'rgba(0,0,0,0.55)', color: 'white',
                        borderRadius: 4, padding: '1px 5px', fontSize: '0.6rem', fontWeight: 800,
                      }}>{idx + 1}</div>
                      {/* Badge de status de sync */}
                      {ePendente ? (
                        <div style={{
                          position: 'absolute', top: 2, left: 22,
                          background: 'rgba(217,119,6,0.92)', color: 'white',
                          borderRadius: 4, padding: '1px 4px', fontSize: '0.55rem', fontWeight: 800,
                        }} title="Aguardando conexão para salvar no servidor">📶</div>
                      ) : statusFoto === 'salvo' ? (
                        <div style={{
                          position: 'absolute', top: 2, left: 22,
                          background: 'rgba(22,163,74,0.88)', color: 'white',
                          borderRadius: 4, padding: '1px 4px', fontSize: '0.55rem', fontWeight: 800,
                        }} title="Foto salva no servidor">✓</div>
                      ) : null}
                      {temGps && (
                        <div style={{
                          position: 'absolute', bottom: ePendente ? 18 : 2, left: 2,
                          background: 'rgba(26,75,140,0.88)', color: 'white',
                          borderRadius: 4, padding: '1px 4px', fontSize: '0.58rem', fontWeight: 700,
                        }}>📍GPS</div>
                      )}
                      <button
                        onClick={() => pedirSenhaParaExecutar(() => removerFotoEvento(idx))}
                        style={{
                          position: 'absolute', top: 2, right: 2,
                          background: 'rgba(220,38,38,0.85)', color: 'white',
                          border: 'none', borderRadius: '50%', width: 20, height: 20,
                          fontSize: '0.6rem', fontWeight: 900, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          lineHeight: 1,
                        }}
                        title="Remover foto"
                      >✕</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Observações */}
        {planoLocal.observacoes && (
          <div className="plan-detalhe-card">
            <div className="plan-detalhe-card-header">📝 Observações</div>
            <p className="plan-obs-texto">{planoLocal.observacoes}</p>
          </div>
        )}

        {/* Conclusão — exibida quando status é concluído */}
        {planoLocal.status === 'concluido' && (
          <div className="plan-detalhe-card" style={{ borderColor: '#059669' }}>
            <div className="plan-detalhe-card-header" style={{ background: 'linear-gradient(100deg,#065f46,#059669)', color: 'white', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>✅ Conclusão da {TIPOS_CONFIG[planoLocal.tipo].label.replace(/ções$/, 'ção').replace(/s$/, '')}</span>
              <button
                onClick={() => pedirSenhaParaExecutar(() => { setTextoConclusao(planoLocal.conclusao ?? ''); setModalConclusao(true) })}
                style={{ background: 'rgba(255,255,255,0.22)', border: 'none', color: 'white', borderRadius: 6, padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 700 }}
              >✏️ Editar</button>
            </div>
            <div style={{ padding: '0.6rem 0.85rem' }}>
              {planoLocal.conclusao
                ? <p style={{ margin: 0, fontSize: '0.85rem', color: '#065f46', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{planoLocal.conclusao}</p>
                : <p style={{ margin: 0, fontSize: '0.82rem', color: '#9ca3af', fontStyle: 'italic' }}>Nenhuma conclusão registrada. Clique em ✏️ Editar para adicionar.</p>
              }
            </div>
          </div>
        )}

        <button className="plan-btn-deletar" onClick={() => pedirSenhaParaExecutar(confirmarDeletar)}>
          🗑️ Excluir planejamento
        </button>
      </div>

      {editando && (
        <FormularioPlano
          tipo={planoLocal.tipo}
          planoEditando={planoLocal}
          onSalvar={p => { setPlanoLocal(p); onAtualizar(p); setEditando(false) }}
          onFechar={() => setEditando(false)}
        />
      )}

      {/* ── Modal de conclusão ── */}
      {modalConclusao && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.62)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget) setModalConclusao(false) }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '1.4rem', width: '100%', maxWidth: 440, boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '1.5rem' }}>✅</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#065f46' }}>Concluir {TIPOS_CONFIG[planoLocal.tipo].label.replace(/ções$/, 'ção').replace(/s$/, '')}</div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{planoLocal.nome}</div>
              </div>
              <button onClick={() => setModalConclusao(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#6b7280' }}>✕</button>
            </div>
            <div style={{ height: 1, background: '#e5e7eb', margin: '0.85rem 0' }} />
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', display: 'block', marginBottom: '0.4rem' }}>
              Como foi a conclusão? <span style={{ color: '#9ca3af', fontWeight: 400 }}>(opcional)</span>
            </label>
            <textarea
              value={textoConclusao}
              onChange={e => setTextoConclusao(e.target.value)}
              placeholder={`Descreva como foi o encerramento da ${TIPOS_CONFIG[planoLocal.tipo].label.replace(/ções$/, 'ção').replace(/s$/, '').toLowerCase()}: ocorrências, resultados, observações finais...`}
              rows={5}
              autoFocus
              style={{ width: '100%', border: '1.5px solid #d1d5db', borderRadius: 10, padding: '0.7rem', fontSize: '0.88rem', resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem' }}>
              <button onClick={() => setModalConclusao(false)} disabled={salvandoConclusao}
                style={{ flex: 1, background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 10, padding: '0.7rem', fontSize: '0.88rem', cursor: salvandoConclusao ? 'not-allowed' : 'pointer', fontWeight: 700, opacity: salvandoConclusao ? 0.5 : 1 }}>
                Cancelar
              </button>
              <button onClick={confirmarConclusao} disabled={salvandoConclusao}
                style={{ flex: 2, background: salvandoConclusao ? '#6b7280' : 'linear-gradient(90deg,#065f46,#059669)', color: 'white', border: 'none', borderRadius: 10, padding: '0.7rem', fontSize: '0.9rem', cursor: salvandoConclusao ? 'not-allowed' : 'pointer', fontWeight: 800, boxShadow: salvandoConclusao ? 'none' : '0 3px 12px rgba(5,150,105,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', transition: 'all 0.2s' }}>
                {salvandoConclusao
                  ? <><span style={{ fontSize: '1rem' }}>⏳</span> Salvando...</>
                  : <><span style={{ fontSize: '1rem' }}>🏁</span> Finalizar Operação</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de edição de coordenadas GMS ── */}
      {fotoEditando && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.62)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget) setFotoEditando(null) }}>
          <div style={{ background: 'white', borderRadius: 16, padding: '1.25rem', width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.9rem' }}>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#1a4b8c' }}>✏️ Editar coordenadas</div>
              <button onClick={() => setFotoEditando(null)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#6b7280', lineHeight: 1 }}>✕</button>
            </div>
            <img src={fotoEditando.foto} alt="foto" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 8, marginBottom: '1rem' }} />

            {/* Latitude */}
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#374151', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Latitude</div>
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.85rem' }}>
              {[
                { label: 'Graus °', key: 'latG' as const, min: 0, max: 90, step: 1 },
                { label: "Minutos '", key: 'latM' as const, min: 0, max: 59, step: 1 },
                { label: 'Segundos "', key: 'latS' as const, min: 0, max: 59.9, step: 0.1 },
              ].map(({ label, key, min, max, step }) => (
                <div key={key} style={{ flex: key === 'latS' ? 1.3 : 1 }}>
                  <div style={{ fontSize: '0.6rem', color: '#6b7280', marginBottom: 2 }}>{label}</div>
                  <input type="number" min={min} max={max} step={step} value={editGms[key]}
                    onChange={e => setEditGms(p => ({ ...p, [key]: e.target.value }))}
                    style={{ width: '100%', border: '1.5px solid #d1d5db', borderRadius: 7, padding: '6px 7px', fontSize: '0.85rem', textAlign: 'center' }} />
                </div>
              ))}
              <div style={{ flex: 0.75 }}>
                <div style={{ fontSize: '0.6rem', color: '#6b7280', marginBottom: 2 }}>Dir.</div>
                <select value={editGms.latD} onChange={e => setEditGms(p => ({ ...p, latD: e.target.value as 'N' | 'S' }))}
                  style={{ width: '100%', border: '1.5px solid #d1d5db', borderRadius: 7, padding: '6px 4px', fontSize: '0.85rem' }}>
                  <option value="S">S</option><option value="N">N</option>
                </select>
              </div>
            </div>

            {/* Longitude */}
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#374151', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Longitude</div>
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.85rem' }}>
              {[
                { label: 'Graus °', key: 'lngG' as const, min: 0, max: 180, step: 1 },
                { label: "Minutos '", key: 'lngM' as const, min: 0, max: 59, step: 1 },
                { label: 'Segundos "', key: 'lngS' as const, min: 0, max: 59.9, step: 0.1 },
              ].map(({ label, key, min, max, step }) => (
                <div key={key} style={{ flex: key === 'lngS' ? 1.3 : 1 }}>
                  <div style={{ fontSize: '0.6rem', color: '#6b7280', marginBottom: 2 }}>{label}</div>
                  <input type="number" min={min} max={max} step={step} value={editGms[key]}
                    onChange={e => setEditGms(p => ({ ...p, [key]: e.target.value }))}
                    style={{ width: '100%', border: '1.5px solid #d1d5db', borderRadius: 7, padding: '6px 7px', fontSize: '0.85rem', textAlign: 'center' }} />
                </div>
              ))}
              <div style={{ flex: 0.75 }}>
                <div style={{ fontSize: '0.6rem', color: '#6b7280', marginBottom: 2 }}>Dir.</div>
                <select value={editGms.lngD} onChange={e => setEditGms(p => ({ ...p, lngD: e.target.value as 'L' | 'O' }))}
                  style={{ width: '100%', border: '1.5px solid #d1d5db', borderRadius: 7, padding: '6px 4px', fontSize: '0.85rem' }}>
                  <option value="O">O</option><option value="L">L</option>
                </select>
              </div>
            </div>

            {/* Prévia */}
            <div style={{ background: '#dbeafe', borderRadius: 8, padding: '7px 12px', marginBottom: '1rem', fontFamily: 'monospace', fontSize: '0.78rem', color: '#1a4b8c', fontWeight: 700, textAlign: 'center', lineHeight: 1.6 }}>
              {formatarGMS(gmsComponentesParaDecimal(Number(editGms.latG), Number(editGms.latM), Number(editGms.latS), editGms.latD), 'lat')}
              {'  '}{formatarGMS(gmsComponentesParaDecimal(Number(editGms.lngG), Number(editGms.lngM), Number(editGms.lngS), editGms.lngD), 'lng')}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setFotoEditando(null)}
                style={{ flex: 1, background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 9, padding: '0.65rem', fontSize: '0.88rem', cursor: 'pointer', fontWeight: 700 }}>
                Cancelar
              </button>
              <button onClick={salvarCoordenadasFoto}
                style={{ flex: 1.6, background: 'linear-gradient(90deg,#1a4b8c,#2563eb)', color: 'white', border: 'none', borderRadius: 9, padding: '0.65rem', fontSize: '0.88rem', cursor: 'pointer', fontWeight: 800 }}>
                💾 Salvar coordenadas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de senha ── */}
      {modalSenha && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget) { setModalSenha(false); setSenhaInput(''); setSenhaErro(false) } }}
        >
          <div style={{ background: 'white', borderRadius: 18, padding: '1.5rem', width: '100%', maxWidth: 340, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <span style={{ fontSize: '1.6rem' }}>🔐</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#1a3a6b' }}>Confirmar identidade</div>
                <div style={{ fontSize: '0.73rem', color: '#6b7280' }}>Informe sua senha para continuar</div>
              </div>
              <button onClick={() => { setModalSenha(false); setSenhaInput(''); setSenhaErro(false) }} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#6b7280' }}>✕</button>
            </div>
            <div style={{ height: 1, background: '#e5e7eb', marginBottom: '1rem' }} />
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', display: 'block', marginBottom: '0.4rem' }}>
              Senha de {meuNomeAgente || 'agente'}
            </label>
            <input
              type="password"
              value={senhaInput}
              onChange={e => { setSenhaInput(e.target.value); setSenhaErro(false) }}
              onKeyDown={e => { if (e.key === 'Enter') confirmarSenha() }}
              autoFocus
              placeholder="••••••"
              style={{
                width: '100%', border: `1.5px solid ${senhaErro ? '#dc2626' : '#d1d5db'}`, borderRadius: 10,
                padding: '0.65rem 0.8rem', fontSize: '1rem', outline: 'none', fontFamily: 'inherit',
                boxSizing: 'border-box', background: senhaErro ? '#fef2f2' : 'white',
              }}
            />
            {senhaErro && (
              <div style={{ color: '#dc2626', fontSize: '0.75rem', fontWeight: 700, marginTop: '0.35rem' }}>
                ❌ Senha incorreta. Tente novamente.
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
                onClick={() => { setModalSenha(false); setSenhaInput(''); setSenhaErro(false) }}
                style={{ flex: 1, background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 10, padding: '0.7rem', fontSize: '0.88rem', cursor: 'pointer', fontWeight: 700 }}
              >Cancelar</button>
              <button
                onClick={confirmarSenha}
                style={{ flex: 1.5, background: 'linear-gradient(90deg,#1a4b8c,#2563eb)', color: 'white', border: 'none', borderRadius: 10, padding: '0.7rem', fontSize: '0.88rem', cursor: 'pointer', fontWeight: 800 }}
              >🔓 Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Mapa compartilhado da seção (nível de lista) ────────────────────────
interface ItemMapaSecao {
  id: string
  tipo: string
  emoji: string
  label: string
  lat: number
  lng: number
}

function MapaSecaoPlanos({
  tipo,
  planos,
}: {
  tipo: TipoPlano
  planos: Plano[]
}) {
  const chave = `dc-mapa-secao-${tipo}-v1`
  const [itens, setItens] = useState<ItemMapaSecao[]>(() => {
    try { return JSON.parse(localStorage.getItem(chave) || '[]') } catch { return [] }
  })
  const [itemSelecionado, setItemSelecionado] = useState<string | null>(null)
  const [labelNovo, setLabelNovo] = useState('')
  const [aba, setAba] = useState<'icones' | 'orgaos' | 'materiais' | 'agentes'>('icones')

  const planosDoTipo = planos.filter(p => p.tipo === tipo)
  const planoCentral = planosDoTipo.find(p => p.lat && p.lng)
  const centro: [number, number] = planoCentral?.lat && planoCentral?.lng
    ? [planoCentral.lat, planoCentral.lng]
    : CONSELHEIRO_LAFAIETE_CENTER

  const todosOrgaos = [...new Set(planosDoTipo.flatMap(p => p.equipe))]
  const todosMateriais = planosDoTipo.flatMap(p => p.materiais)
  const todosAgentes = [...new Set(planosDoTipo.flatMap(p => p.agentesDefesaCivil ?? []))]

  function salvarItens(lista: ItemMapaSecao[]) {
    setItens(lista)
    localStorage.setItem(chave, JSON.stringify(lista))
  }

  function adicionarItemNoMapa(lat: number, lng: number) {
    if (!itemSelecionado) return
    const cfgIcon = ITENS_POSICIONAR.find(i => i.tipo === itemSelecionado)
    if (cfgIcon) {
      salvarItens([...itens, { id: gerarId(), tipo: cfgIcon.tipo, emoji: cfgIcon.emoji, label: labelNovo.trim() || cfgIcon.label, lat, lng }])
      setItemSelecionado(null); setLabelNovo(''); return
    }
    if (itemSelecionado.startsWith('org:')) {
      const nome = itemSelecionado.slice(4)
      const info = ORGAOS_EMPENHO.flatMap(c => c.orgaos).find(o => `${o.emoji} ${o.nome}` === nome)
      salvarItens([...itens, { id: gerarId(), tipo: 'orgao', emoji: info?.emoji ?? '🏛️', label: labelNovo.trim() || (info?.nome ?? nome), lat, lng }])
      setItemSelecionado(null); setLabelNovo(''); return
    }
    if (itemSelecionado.startsWith('mat:')) {
      const matNome = itemSelecionado.slice(4)
      salvarItens([...itens, { id: gerarId(), tipo: 'material', emoji: getEmojiMaterial(matNome), label: labelNovo.trim() || matNome, lat, lng }])
      setItemSelecionado(null); setLabelNovo(''); return
    }
    if (itemSelecionado.startsWith('ag:')) {
      const nome = itemSelecionado.slice(3)
      salvarItens([...itens, { id: gerarId(), tipo: 'agente', emoji: '🧑‍🚒', label: labelNovo.trim() || nome, lat, lng }])
      setItemSelecionado(null); setLabelNovo(''); return
    }
  }

  function removerItemSecao(id: string) {
    salvarItens(itens.filter(i => i.id !== id))
  }

  const labelSelecionado = (() => {
    if (!itemSelecionado) return ''
    if (itemSelecionado.startsWith('org:')) return itemSelecionado.slice(4)
    if (itemSelecionado.startsWith('mat:')) return itemSelecionado.slice(4)
    if (itemSelecionado.startsWith('ag:')) return itemSelecionado.slice(3)
    return ITENS_POSICIONAR.find(i => i.tipo === itemSelecionado)?.label ?? ''
  })()

  const btnStyle = (sel: boolean) => ({
    background: sel ? '#1a4b8c' : '#dbeafe',
    color: sel ? 'white' : '#1e3a8a',
    border: 'none', borderRadius: 20,
    padding: '0.25rem 0.65rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '0.2rem',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem' }}>
      {/* Toolbar ADICIONAR NO MAPA */}
      <div style={{ background: '#f0f4ff', border: '1.5px solid #bfdbfe', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#1e40af', marginBottom: '0.42rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          🗺️ Adicionar no mapa
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.45rem', flexWrap: 'wrap' }}>
          {([['icones','🗺️ Ícones'],['orgaos','🏛️ Órgãos'],['materiais','📦 Materiais'],['agentes','🛡️ Agentes GM']] as const).map(([a,l]) => (
            <button key={a} onClick={() => { setAba(a); setItemSelecionado(null) }}
              style={{ background: aba===a?'#1a4b8c':'#e0e7ff', color: aba===a?'white':'#1e3a8a', border:'none', borderRadius:20, padding:'0.22rem 0.62rem', fontSize:'0.72rem', fontWeight:700, cursor:'pointer' }}>
              {l}
            </button>
          ))}
        </div>

        {/* Conteúdo da aba */}
        {aba === 'icones' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {ITENS_POSICIONAR.map(it => (
              <button key={it.tipo} onClick={() => { setItemSelecionado(p => p===it.tipo?null:it.tipo); setLabelNovo('') }} style={btnStyle(itemSelecionado===it.tipo)}>
                <span>{it.emoji}</span>{it.label}
              </button>
            ))}
          </div>
        )}
        {aba === 'orgaos' && (
          todosOrgaos.length === 0
            ? <div style={{ fontSize:'0.78rem',color:'#9ca3af',textAlign:'center',padding:'0.4rem' }}>Nenhum órgão empenhado nos planos desta seção</div>
            : <div style={{ display:'flex',flexWrap:'wrap',gap:'0.3rem' }}>
                {todosOrgaos.map(orgao => {
                  const key = `org:${orgao}`
                  const info = ORGAOS_EMPENHO.flatMap(c=>c.orgaos).find(o=>`${o.emoji} ${o.nome}`===orgao)
                  return <button key={orgao} onClick={() => { setItemSelecionado(p=>p===key?null:key); setLabelNovo('') }} style={btnStyle(itemSelecionado===key)}>
                    <span>{info?.emoji??'🏛️'}</span>{info?.nome??orgao}
                  </button>
                })}
              </div>
        )}
        {aba === 'materiais' && (
          todosMateriais.length === 0
            ? <div style={{ fontSize:'0.78rem',color:'#9ca3af',textAlign:'center',padding:'0.4rem' }}>Nenhum material nos planos desta seção</div>
            : <div style={{ display:'flex',flexWrap:'wrap',gap:'0.3rem' }}>
                {todosMateriais.map(mat => {
                  const key = `mat:${mat.nome}`
                  return <button key={mat.id} onClick={() => { setItemSelecionado(p=>p===key?null:key); setLabelNovo('') }} style={btnStyle(itemSelecionado===key)}>
                    <span>{getEmojiMaterial(mat.nome)}</span>{mat.nome}
                  </button>
                })}
              </div>
        )}
        {aba === 'agentes' && (
          todosAgentes.length === 0
            ? <div style={{ fontSize:'0.78rem',color:'#9ca3af',textAlign:'center',padding:'0.4rem' }}>Nenhum agente nos planos desta seção</div>
            : <div style={{ display:'flex',flexWrap:'wrap',gap:'0.3rem' }}>
                {todosAgentes.map(ag => {
                  const key = `ag:${ag}`
                  return <button key={ag} onClick={() => { setItemSelecionado(p=>p===key?null:key); setLabelNovo('') }} style={btnStyle(itemSelecionado===key)}>
                    <span>🧑‍🚒</span>{ag}
                  </button>
                })}
              </div>
        )}

        {itemSelecionado && (
          <>
            <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.42rem' }}>
              <input
                style={{ flex:1, padding:'0.35rem 0.6rem', border:'1.5px solid #cbd5e1', borderRadius:7, fontSize:'0.8rem', outline:'none' }}
                placeholder={`Rótulo (ex: ${labelSelecionado} Principal)`}
                value={labelNovo}
                onChange={e => setLabelNovo(e.target.value)}
              />
            </div>
            <div style={{ background:'#fef3c7',border:'1.5px solid #fbbf24',borderRadius:8,padding:'0.38rem 0.7rem',fontSize:'0.8rem',fontWeight:600,color:'#92400e',display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'0.35rem' }}>
              <span>📍 Toque no mapa para posicionar: <strong>{labelSelecionado}</strong></span>
              <button onClick={() => { setItemSelecionado(null); setLabelNovo('') }} style={{ background:'none',border:'none',color:'#b45309',cursor:'pointer',fontWeight:800,fontSize:'0.9rem' }}>✕</button>
            </div>
          </>
        )}
      </div>

      {/* Mapa */}
      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1.5px solid #e5e7eb' }}>
        <MapContainer
          center={centro}
          zoom={planoCentral ? 15 : 13}
          style={{ height: 'min(60vh, 560px)', minHeight: 360, width: '100%' }}
          zoomControl={true}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {planoCentral && <FlyToMarca lat={centro[0]} lng={centro[1]} />}
          <MapClickHandler ativo={!!itemSelecionado} onClique={adicionarItemNoMapa} />

          {/* Marcadores dos planos */}
          {planosDoTipo.filter(p => p.lat && p.lng).map(p => (
            <Marker key={p.id} position={[p.lat!, p.lng!]} icon={criarIconePrincipal()}>
              <Popup>
                <div style={{ textAlign:'center', minWidth:100 }}>
                  <div style={{ fontWeight:700,fontSize:'0.88rem' }}>{TIPOS_CONFIG[p.tipo].emoji} {p.nome}</div>
                  {p.local && <div style={{ fontSize:'0.78rem',color:'#6b7280',marginTop:2 }}>📍 {p.local}</div>}
                  {p.dataInicio && <div style={{ fontSize:'0.73rem',color:'#9ca3af',marginTop:1 }}>📅 {formatarData(p.dataInicio)}</div>}
                  <div style={{ fontSize:'0.68rem',color:'#9ca3af',marginTop:2,fontFamily:'monospace' }}>{decimalParaGMS(p.lat!,'lat')} {decimalParaGMS(p.lng!,'lng')}</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Pontos extras dos planos */}
          {planosDoTipo.flatMap(p=>(p.pontosExtras??[]).map(pe=>({...pe,planoNome:p.nome}))).map(pe => (
            <Marker key={pe.id} position={[pe.lat,pe.lng]} icon={criarIconeEmoji('📌')}>
              <Popup>
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontWeight:700,fontSize:'0.82rem' }}>📌 {pe.label}</div>
                  <div style={{ fontSize:'0.72rem',color:'#6b7280' }}>{pe.planoNome}</div>
                </div>
              </Popup>
            </Marker>
          ))}

          <MapInvalidateSize trigger={itemSelecionado} />
          {/* Itens de mapa individuais dos planos */}
          {planosDoTipo.flatMap(p=>p.itensMapa.map(it=>({...it,planoNome:p.nome}))).map(item => (
            <Marker key={item.id} position={[item.lat,item.lng]} icon={item.tipo==='agente_dc'?criarIconeAgentePlanejado(item.obs||item.tipo):item.tipo==='cone'?criarIconeCone():criarIconeEmoji(item.emoji)}>
              <Popup>
                <div style={{ textAlign:'center' }}>
                  <span style={{ fontSize:'1.3rem' }}>{item.emoji}</span>
                  <div style={{ fontWeight:700,fontSize:'0.82rem',marginTop:2 }}>{item.obs||item.tipo}</div>
                  <div style={{ fontSize:'0.72rem',color:'#6b7280' }}>{item.planoNome}</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Itens posicionados na seção */}
          {itens.map(item => (
            <Marker key={item.id} position={[item.lat,item.lng]} icon={item.tipo==='agente'?criarIconeAgentePlanejado(item.label):item.tipo==='cone'?criarIconeCone():criarIconeEmoji(item.emoji)}>
              <Popup>
                <div style={{ textAlign:'center' }}>
                  <span style={{ fontSize:'1.3rem' }}>{item.emoji}</span>
                  <div style={{ fontWeight:700,fontSize:'0.82rem',marginTop:2 }}>{item.label}</div>
                  <button onClick={() => removerItemSecao(item.id)}
                    style={{ marginTop:6,background:'#fee2e2',border:'none',borderRadius:6,padding:'0.2rem 0.7rem',color:'#b91c1c',fontWeight:700,fontSize:'0.78rem',cursor:'pointer' }}>
                    🗑️ Remover
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {planosDoTipo.filter(p => !p.lat || !p.lng).length > 0 && (
        <div style={{ background:'#fef3c7',border:'1px solid #fcd34d',borderRadius:8,padding:'0.4rem 0.75rem',fontSize:'0.75rem',color:'#92400e' }}>
          ℹ️ {planosDoTipo.filter(p=>!p.lat||!p.lng).length} plano(s) sem localização não aparecem no mapa. Edite-os para adicionar coordenadas.
        </div>
      )}

      {itens.length > 0 && (
        <div style={{ background:'#f8fafc',border:'1.5px solid #e5e7eb',borderRadius:10,padding:'0.5rem 0.75rem' }}>
          <div style={{ fontSize:'0.7rem',fontWeight:800,color:'#1e40af',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'0.35rem' }}>
            📌 Itens posicionados ({itens.length})
          </div>
          <div style={{ display:'flex',flexWrap:'wrap',gap:'0.25rem' }}>
            {itens.map(item => (
              <span key={item.id} style={{ background:'#dbeafe',color:'#1e3a8a',borderRadius:12,padding:'0.2rem 0.55rem',fontSize:'0.75rem',fontWeight:600,display:'flex',alignItems:'center',gap:'0.3rem' }}>
                {item.emoji} {item.label}
                <button onClick={() => removerItemSecao(item.id)} style={{ background:'none',border:'none',cursor:'pointer',color:'#1e40af',fontWeight:900,fontSize:'0.7rem',padding:0,lineHeight:1 }}>✕</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Lista de planos por tipo ────────────────────────────────────────────
function ListaPlanos({
  tipo,
  planos,
  onNovo,
  onAbrir,
}: {
  tipo: TipoPlano
  planos: Plano[]
  onNovo: () => void
  onAbrir: (p: Plano) => void
}) {
  const cfg = TIPOS_CONFIG[tipo]
  const lista = planos.filter(p => p.tipo === tipo).sort((a, b) => {
    const ordem: Record<StatusPlano, number> = { em_curso: 0, planejado: 1, concluido: 2, cancelado: 3 }
    if (ordem[a.status] !== ordem[b.status]) return ordem[a.status] - ordem[b.status]
    return b.criadoEm.localeCompare(a.criadoEm)
  })

  return (
    <div className="plan-secao">
      <div className="plan-secao-header">
        <div className="plan-secao-titulo">
          <strong>{cfg.emoji} {cfg.label}</strong>
          <span>{cfg.descricao}</span>
        </div>
        <button className="plan-btn-novo" onClick={onNovo}>
          + Novo
        </button>
      </div>

      {lista.length === 0 ? (
        <div className="plan-vazio">
          <div className="plan-vazio-emoji">{cfg.emoji}</div>
          <div className="plan-vazio-texto">Nenhum {cfg.label.slice(0, -1).toLowerCase()} cadastrado ainda</div>
          <button className="plan-btn-criar-vazio" onClick={onNovo}>
            + Criar primeiro planejamento
          </button>
        </div>
      ) : (
        lista.map(p => {
          const sc = STATUS_CONFIG[p.status]
          const rc = RISCO_CONFIG[p.risco]
          const corTipo = cfg.cor
          return (
            <div key={p.id} className="plan-card" onClick={() => onAbrir(p)}>
              <div className="plan-card-topo">
                <div className="plan-card-cor" style={{ background: corTipo }} />
                <div className="plan-card-corpo">
                  <div className="plan-card-linha1">
                    <span className="plan-card-nome">{p.nome}</span>
                    <span className="plan-card-data">{p.dataInicio ? formatarData(p.dataInicio) : '—'}</span>
                  </div>
                  {p.local && (
                    <div className="plan-card-local">📍 {p.local}</div>
                  )}
                  <div className="plan-card-badges">
                    <span className={`plan-badge plan-badge-${sc.classe}`}>
                      {sc.emoji} {sc.label}
                    </span>
                    {p.risco !== 'baixo' && (
                      <span className="plan-badge plan-badge-info" style={{ background: rc.bg, color: rc.cor }}>
                        ⚠️ {rc.label}
                      </span>
                    )}
                    {p.equipe.length > 0 && (
                      <span className="plan-badge plan-badge-eq">👥 {p.equipe.length}</span>
                    )}
                    {p.materiais.length > 0 && (
                      <span className="plan-badge plan-badge-mat">📦 {p.materiais.length}</span>
                    )}
                    {p.itensMapa.length > 0 && (
                      <span className="plan-badge plan-badge-info">🗺️ {p.itensMapa.length}</span>
                    )}
                  </div>
                </div>
                <div className="plan-card-seta">›</div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ── Componente principal ────────────────────────────────────────────────
export default function Planejamento() {
  const [subAba, setSubAba] = useState<SubAbaPlanejamento>('radar')
  const [planos, setPlanos] = useState<Plano[]>(() => carregarPlanos())
  const [criando, setCriando] = useState(false)
  const [tipoCriacao, setTipoCriacao] = useState<TipoPlano>('simulado')
  const [dataInicialCriacao, setDataInicialCriacao] = useState('')
  const [aberto, setAberto] = useState<Plano | null>(null)
  const planosRef = useRef<Plano[]>([])

  useEffect(() => {
    salvarPlanos(planos)
    planosRef.current = planos
    // Mantém o plano aberto atualizado quando o WS atualiza a lista
    setAberto(prev => {
      if (!prev) return null
      const atualizado = planos.find(p => p.id === prev.id)
      return atualizado ?? prev
    })
  }, [planos])

  async function carregarDoServidor() {
    // Caminho externo desativado nesta cópia; usa o endpoint Express abaixo.
    if (supabaseDisponivel) {
      try {
        const { data, error } = await supabase
          .from('planejamentos').select('*')
          .order('criado_em', { ascending: false }).limit(500)
        if (!error && data) {
          const remote = data.map(row => sbParaPlano(row as Record<string, unknown>))
          const agora = Date.now()
          setPlanos(prev => {
            const map = new Map(prev.map(p => [p.id, p]))
            remote.forEach(r => {
              const protegidoEm = planosProtegidos.get(r.id)
              if (protegidoEm && agora - protegidoEm < 30000) return
              map.set(r.id, r)
            })
            return Array.from(map.values()).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
          })
          return
        }
      } catch { /* tenta fallback */ }
    }
    // Fallback Express (Replit sem Supabase)
    try {
      const res = await fetch('/api/planejamentos')
      if (res.ok) {
        const ct = res.headers.get('content-type') || ''
        if (!ct.includes('text/html')) {
          const rows: Record<string, unknown>[] = await res.json()
          if (Array.isArray(rows) && rows.length > 0) {
            const remote = rows.map(row => sbParaPlano(row))
            const agora = Date.now()
            setPlanos(prev => {
              const map = new Map(prev.map(p => [p.id, p]))
              remote.forEach(r => {
                const protegidoEm = planosProtegidos.get(r.id)
                if (protegidoEm && agora - protegidoEm < 30000) return
                map.set(r.id, r)
              })
              return Array.from(map.values()).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
            })
          }
        }
      }
    } catch { /* silencioso */ }
  }

  // Carrega planos do servidor ao montar e mescla com localStorage
  useEffect(() => { carregarDoServidor() }, [])

  // Atualiza em tempo real quando outro agente salva/deleta planejamento
  useEffect(() => {
    return wsOn('planejamentos_atualizados', () => { carregarDoServidor() })
  }, [])

  async function sincServidor(plano: Plano) {
    const payload = planoParaSB(plano)
    // Caminho externo desativado nesta cópia; usa o endpoint Express abaixo.
    if (supabaseDisponivel) {
      try {
        if (plano.status === 'concluido') {
          // Conclusão confirmada: upsert completo garante que status e conclusao ficam salvos
          await supabase.from('planejamentos').upsert(payload)
        } else {
          // Outros estados: atualiza somente se o registro não estiver concluído no banco
          const { data: atualizado } = await supabase
            .from('planejamentos')
            .update(payload)
            .eq('id', plano.id)
            .neq('status', 'concluido')
            .select('id')
          // Se nenhuma linha foi afetada, o registro pode ser novo → tenta inserir
          if (!atualizado || atualizado.length === 0) {
            await supabase.from('planejamentos').upsert(payload, { ignoreDuplicates: true })
          }
          wsSend({ tipo: 'planejamentos_atualizados' })
        }
      } catch { /* silencioso */ }
      return
    }
    // Fallback Express (Replit sem Supabase)
    try {
      await fetch('/api/planejamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch { /* silencioso */ }
  }

  async function deletarServidor(id: string) {
    // Caminho externo desativado nesta cópia; usa o endpoint Express abaixo.
    if (supabaseDisponivel) {
      try {
        await supabase.from('planejamentos').delete().eq('id', id)
        wsSend({ tipo: 'planejamentos_atualizados' })
      } catch { /* silencioso */ }
      return
    }
    // Fallback Express (Replit sem Supabase)
    try { await fetch(`/api/planejamentos/${id}`, { method: 'DELETE' }) } catch { /* silencioso */ }
  }

  function notificarAgentesNovos(plano: Plano) {
    const existingPlano = planosRef.current.find(p => p.id === plano.id)
    const agentesAntigos = existingPlano?.agentesDefesaCivil ?? []
    const agentesNovos = (plano.agentesDefesaCivil ?? []).filter(a => !agentesAntigos.includes(a))
    if (agentesNovos.length > 0) {
      fetch('/api/push/escala', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentes: agentesNovos,
          planoNome: plano.nome,
          planoId: plano.id,
          planoTipo: plano.tipo,
          planoData: plano.dataInicio,
          planoHorario: plano.horario,
          remetente: getNomeAgenteGlobal(),
        }),
      }).catch(() => {})
    }
  }

  const salvarPlano = useCallback((plano: Plano) => {
    notificarAgentesNovos(plano)
    setPlanos(prev => {
      const existe = prev.findIndex(p => p.id === plano.id)
      if (existe >= 0) {
        const novo = [...prev]
        novo[existe] = plano
        return novo
      }
      return [plano, ...prev]
    })
    setCriando(false)
    setTipoCriacao('simulado')
    setDataInicialCriacao('')
    setAberto(plano)
    sincServidor(plano)
  }, [])

  const salvarPatrulhamentoRadar = useCallback((draft: RadarPatrulhamentoDraft) => {
    const plano: Plano = {
      id: gerarId(),
      tipo: 'simulado',
      nome: draft.nome,
      descricao: draft.descricao,
      local: draft.local,
      dataInicio: draft.dataInicio,
      dataFim: draft.dataInicio,
      horario: draft.horario,
      horarioFim: draft.horarioFim,
      publicoEstimado: '',
      status: 'planejado',
      equipe: [],
      agentesDefesaCivil: draft.agentes.map(normalizarNomeAgente),
      materiais: [],
      itensMapa: draft.itensMapa,
      pontosExtras: [],
      lat: draft.lat,
      lng: draft.lng,
      observacoes: draft.observacoes,
      risco: 'baixo',
      criadoPor: getNomeAgenteGlobal() || getAgenteLogado() || '',
      criadoEm: new Date().toISOString(),
      confirmacoes: [],
      fotosEvento: [],
      conclusao: '',
    }
    salvarPlano(plano)
    // A tela de TV deve continuar exibindo o mapa operacional após o cadastro.
    setAberto(null)
    setSubAba('radar')
  }, [salvarPlano])

  const atualizarPlano = useCallback((plano: Plano) => {
    notificarAgentesNovos(plano)
    planosProtegidos.set(plano.id, Date.now())
    setPlanos(prev => prev.map(p => p.id === plano.id ? plano : p))
    setAberto(plano)
    sincServidor(plano)
  }, [])

  const deletarPlano = useCallback((id: string) => {
    setPlanos(prev => prev.filter(p => p.id !== id))
    setAberto(null)
    deletarServidor(id)
  }, [])

  function iniciarNovoPlano(tipo: TipoPlano, data = '') {
    setTipoCriacao(tipo)
    setDataInicialCriacao(data)
    setCriando(true)
  }

  const patrulhamentosRadar = planos
    .filter(plano => plano.tipo === 'simulado')
    .map(plano => ({
      id: plano.id,
      nome: plano.nome,
      dataInicio: plano.dataInicio,
      horario: plano.horario,
      horarioFim: plano.horarioFim,
      local: plano.local,
      lat: plano.lat,
      lng: plano.lng,
      status: plano.status,
      agentesDefesaCivil: plano.agentesDefesaCivil,
      itensMapa: plano.itensMapa,
    }))

  const totalPorTipo = (t: TipoPlano) => planos.filter(p => p.tipo === t).length

  return (
    <div className="plan-wrap">
      <div className="plan-subtabs">
        <button
          className={`plan-subtab radar-subtab ${subAba === 'radar' ? 'ativo' : ''}`}
          onClick={() => setSubAba('radar')}
        >
          <img className="radar-tab-icon" src="/icon-192.png" alt="" />
          Radar GM
        </button>
        {(['simulado', 'evento', 'operacao', 'emergencia'] as TipoPlano[]).map(t => {
          const c = TIPOS_CONFIG[t]
          const total = t !== 'emergencia' ? totalPorTipo(t) : 0
          return (
            <button
              key={t}
              className={`plan-subtab ${subAba === t ? 'ativo' : ''}`}
              onClick={() => setSubAba(t)}
            >
              <span className="st-emoji">{c.emoji}</span>
              {c.label}
              {total > 0 && (
                <span style={{
                  background: subAba === t ? '#1a4b8c' : '#e5e7eb',
                  color: subAba === t ? 'white' : '#6b7280',
                  borderRadius: '10px',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0 5px',
                  lineHeight: '1.4',
                }}>
                  {total}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {subAba === 'radar' ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
           <RadarGM
             patrulhamentos={patrulhamentosRadar}
             onNovoPatrulhamento={data => iniciarNovoPlano('simulado', data)}
             onCriarPatrulhamento={salvarPatrulhamentoRadar}
             onAbrirPatrulhamento={id => {
               const plano = planos.find(item => item.id === id)
               if (plano) setAberto(plano)
             }}
           />
        </div>
      ) : subAba === 'emergencia' ? (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Carregando...</div>}>
            <PlanoEmergencia />
          </Suspense>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.75rem', borderBottom: '1px solid #e5e7eb', background: '#f8fafc', flexShrink: 0 }}>
            <span style={{ fontSize: '0.78rem', color: '#6b7280', fontWeight: 600 }}>
              📋 {TIPOS_CONFIG[subAba].label}
            </span>
            <button
              style={{ marginLeft: 'auto', background: '#1a4b8c', color: 'white', border: 'none', borderRadius: 20, padding: '0.28rem 0.85rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
               onClick={() => iniciarNovoPlano(subAba)}
            >
              + Novo
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ListaPlanos
              tipo={subAba}
              planos={planos}
               onNovo={() => iniciarNovoPlano(subAba)}
              onAbrir={p => setAberto(p)}
            />
          </div>
        </>
      )}

      {criando && (
        <FormularioPlano
          tipo={tipoCriacao}
          dataInicial={dataInicialCriacao}
          onSalvar={salvarPlano}
          onFechar={() => { setCriando(false); setDataInicialCriacao('') }}
        />
      )}

      {subAba !== 'emergencia' && aberto && (
        <DetalheP
          plano={aberto}
          onVoltar={() => setAberto(null)}
          onAtualizar={atualizarPlano}
          onDeletar={deletarPlano}
        />
      )}
    </div>
  )
}
