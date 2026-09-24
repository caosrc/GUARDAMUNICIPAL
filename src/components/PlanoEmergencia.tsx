import { useState, useEffect, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Polyline, Circle } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { AGENTES } from '../types'
import './PlanoEmergencia.css'

delete (L.Icon.Default.prototype as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ── Tipos ──────────────────────────────────────────────────────────────
type SubAba = 'planos' | 'mapa' | 'abrigos' | 'equipes' | 'contatos' | 'recursos' | 'checklist'

type TipoEmergencia = 'enchente' | 'deslizamento' | 'incendio' | 'barragem' | 'vendaval' | 'produtos' | 'evento' | 'outro'
type StatusPlano = 'rascunho' | 'ativo' | 'operacao' | 'concluido' | 'arquivado'
type NivelRisco = 'baixo' | 'medio' | 'alto' | 'critico'

interface PlanoEmerg {
  id: string
  tipo: TipoEmergencia
  nome: string
  descricao: string
  areaAfetada: string
  status: StatusPlano
  risco: NivelRisco
  responsavel: string
  equipes: string[]
  populacaoAfetada: string
  observacoes: string
  lat: number | null
  lng: number | null
  criadoEm: string
  atualizadoEm: string
}

interface Abrigo {
  id: string
  nome: string
  endereco: string
  capacidade: string
  tipo: string
  agua: boolean
  energia: boolean
  banheiro: boolean
  acessibilidade: boolean
  responsavel: string
  telefone: string
  lat: number | null
  lng: number | null
  ativo: boolean
  obs: string
}

interface Equipe {
  id: string
  nome: string
  orgao: string
  emoji: string
  responsavel: string
  telefone: string
  missao: string
  membros: string[]
  setor: string
}

interface Contato {
  id: string
  nome: string
  cargo: string
  orgao: string
  telefone: string
  telefone2: string
  emoji: string
  prioridade: number
}

interface Recurso {
  id: string
  nome: string
  emoji: string
  categoria: string
  quantidade: number
  unidade: string
  localizacao: string
  disponivel: boolean
  obs: string
}

interface CheckItem {
  id: string
  texto: string
  categoria: string
  feito: boolean
  responsavel: string
}

interface ItemMapaOp {
  id: string
  tipo: string
  emoji: string
  lat: number
  lng: number
  label: string
  cor?: string
}

// ── Dados padrão ──────────────────────────────────────────────────────
const CONTATOS_PADRAO: Contato[] = [
  { id: 'c1', nome: 'SAMU', cargo: 'Emergência Médica', orgao: 'SAMU', telefone: '192', telefone2: '', emoji: '🚑', prioridade: 1 },
  { id: 'c2', nome: 'Bombeiros', cargo: 'Emergência', orgao: 'Corpo de Bombeiros', telefone: '193', telefone2: '', emoji: '🚒', prioridade: 1 },
  { id: 'c3', nome: 'Polícia Militar', cargo: 'Segurança Pública', orgao: 'PM-MG', telefone: '190', telefone2: '', emoji: '🚓', prioridade: 1 },
  { id: 'c4', nome: 'Defesa Civil Estadual', cargo: 'Coordenação', orgao: 'SEDEC-MG', telefone: '199', telefone2: '', emoji: '🛡️', prioridade: 2 },
  { id: 'c5', nome: 'Hospital Regional', cargo: 'Pronto-Socorro', orgao: 'Saúde Municipal', telefone: '(31) 3741-9000', telefone2: '', emoji: '🏥', prioridade: 2 },
]

const CHECKLIST_PADRAO: CheckItem[] = [
  { id: 'ck1', texto: 'Acionar equipe operacional', categoria: 'Ativação', feito: false, responsavel: '' },
  { id: 'ck2', texto: 'Confirmar disponibilidade de viaturas', categoria: 'Ativação', feito: false, responsavel: '' },
  { id: 'ck3', texto: 'Abrir abrigo principal', categoria: 'Abrigos', feito: false, responsavel: '' },
  { id: 'ck4', texto: 'Verificar suprimentos de água e alimentação', categoria: 'Abrigos', feito: false, responsavel: '' },
  { id: 'ck5', texto: 'Interditar vias de risco', categoria: 'Segurança', feito: false, responsavel: '' },
  { id: 'ck6', texto: 'Emitir alerta à população', categoria: 'Comunicação', feito: false, responsavel: '' },
  { id: 'ck7', texto: 'Acionar Defesa Civil Estadual', categoria: 'Comunicação', feito: false, responsavel: '' },
  { id: 'ck8', texto: 'Registrar início da operação', categoria: 'Registro', feito: false, responsavel: '' },
  { id: 'ck9', texto: 'Atualizar mapa operacional', categoria: 'Registro', feito: false, responsavel: '' },
  { id: 'ck10', texto: 'Verificar comunicação rádio', categoria: 'Comunicação', feito: false, responsavel: '' },
]

const RECURSOS_PADRAO: Recurso[] = [
  { id: 'r1', nome: 'Tendas de Campanha', emoji: '⛺', categoria: 'Estrutura', quantidade: 4, unidade: 'un', localizacao: 'Depósito Central', disponivel: true, obs: '' },
  { id: 'r2', nome: 'Coletes Salva-Vidas', emoji: '🦺', categoria: 'Segurança', quantidade: 20, unidade: 'un', localizacao: 'Depósito Central', disponivel: true, obs: '' },
  { id: 'r3', nome: 'Rádios Comunicação', emoji: '📻', categoria: 'Comunicação', quantidade: 8, unidade: 'un', localizacao: 'Sede DC', disponivel: true, obs: '' },
  { id: 'r4', nome: 'Gerador de Energia', emoji: '⚡', categoria: 'Infraestrutura', quantidade: 2, unidade: 'un', localizacao: 'Depósito Central', disponivel: true, obs: '' },
  { id: 'r5', nome: 'Cones de Sinalização', emoji: '🟧', categoria: 'Sinalização', quantidade: 50, unidade: 'un', localizacao: 'Depósito Central', disponivel: true, obs: '' },
  { id: 'r6', nome: 'Kit Primeiros Socorros', emoji: '🏥', categoria: 'Saúde', quantidade: 10, unidade: 'kit', localizacao: 'Sede DC', disponivel: true, obs: '' },
]

const EQUIPES_PADRAO: Equipe[] = [
  { id: 'eq1', nome: 'CODAP', orgao: 'Prefeitura Municipal', emoji: '🛡️', responsavel: 'Coordenação CODAP', telefone: '(31) 0000-0000', missao: 'Coordenação geral e avaliação de risco', membros: [], setor: 'Coordenação' },
  { id: 'eq2', nome: 'Corpo de Bombeiros', orgao: 'CBMMG', emoji: '🚒', responsavel: 'Cap. Bombeiros', telefone: '193', missao: 'Busca, resgate e combate a incêndio', membros: [], setor: 'Resgate' },
  { id: 'eq3', nome: 'SAMU', orgao: 'Saúde Municipal', emoji: '🚑', responsavel: 'Coord. SAMU', telefone: '192', missao: 'Atendimento pré-hospitalar', membros: [], setor: 'Saúde' },
  { id: 'eq4', nome: 'Polícia Militar', orgao: 'PM-MG', emoji: '🚓', responsavel: 'Sgt. PM', telefone: '190', missao: 'Segurança e isolamento de área', membros: [], setor: 'Segurança' },
]

// ── Utils ──────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const agora = () => new Date().toISOString()

const TIPO_LABELS: Record<TipoEmergencia, string> = {
  enchente: '🌊 Enchente',
  deslizamento: '⛰️ Deslizamento',
  incendio: '🔥 Incêndio',
  barragem: '💧 Barragem',
  vendaval: '🌪️ Vendaval',
  produtos: '☣️ Prod. Perigosos',
  evento: '🎪 Evento',
  outro: '📋 Outro',
}

const STATUS_LABELS: Record<StatusPlano, string> = {
  rascunho: 'Rascunho',
  ativo: 'Ativo',
  operacao: 'Em Operação',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
}

const RISCO_LABELS: Record<NivelRisco, string> = {
  baixo: '🟢 Baixo',
  medio: '🟡 Médio',
  alto: '🔴 Alto',
  critico: '⚫ Crítico',
}

// ── Mapa: clique para pegar coordenadas ───────────────────────────────
function PickerClick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

function MapClickOp({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

// ── Ícone emoji no mapa ───────────────────────────────────────────────
function emojiIcon(emoji: string) {
  return L.divIcon({
    html: `<div style="font-size:22px;line-height:1;filter:drop-shadow(1px 1px 2px rgba(0,0,0,0.5))">${emoji}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    className: '',
  })
}

// ── Itens do mapa operacional ─────────────────────────────────────────
const ITENS_MAPA_OP = [
  { tipo: 'abrigo',     emoji: '🏠', label: 'Abrigo' },
  { tipo: 'hospital',   emoji: '🏥', label: 'Hospital' },
  { tipo: 'ponto',      emoji: '📍', label: 'Ponto de Apoio' },
  { tipo: 'risco',      emoji: '⚠️', label: 'Área de Risco' },
  { tipo: 'interdição', emoji: '🚧', label: 'Interdição' },
  { tipo: 'rota',       emoji: '🛣️', label: 'Rota Fuga' },
  { tipo: 'bombeiros',  emoji: '🚒', label: 'Bombeiros' },
  { tipo: 'samu',       emoji: '🚑', label: 'SAMU' },
  { tipo: 'pm',         emoji: '🚓', label: 'PM' },
  { tipo: 'tenda',      emoji: '⛺', label: 'Tenda' },
  { tipo: 'hidrante',   emoji: '🚿', label: 'Hidrante' },
  { tipo: 'encontro',   emoji: '🟩', label: 'Ponto Encontro' },
]

// ═══════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════
export default function PlanoEmergencia() {
  const [subAba, setSubAba] = useState<SubAba>('planos')

  // ── Estado dos dados ─────────────────────────────────────────────────
  const [planos, setPlanos] = useState<PlanoEmerg[]>([])
  const [abrigos, setAbrigos] = useState<Abrigo[]>([])
  const [equipes, setEquipes] = useState<Equipe[]>(EQUIPES_PADRAO)
  const [contatos, setContatos] = useState<Contato[]>(CONTATOS_PADRAO)
  const [recursos, setRecursos] = useState<Recurso[]>(RECURSOS_PADRAO)
  const [checklist, setChecklist] = useState<CheckItem[]>(CHECKLIST_PADRAO)
  const [itensMapaOp, setItensMapaOp] = useState<ItemMapaOp[]>([])

  // ── Modais ───────────────────────────────────────────────────────────
  const [modalPlano, setModalPlano] = useState(false)
  const [modalAbrigo, setModalAbrigo] = useState(false)
  const [modalContato, setModalContato] = useState(false)
  const [modalRecurso, setModalRecurso] = useState(false)
  const [modalEquipe, setModalEquipe] = useState(false)
  const [modalCheckItem, setModalCheckItem] = useState(false)

  // ── Edição ───────────────────────────────────────────────────────────
  const [editPlano, setEditPlano] = useState<PlanoEmerg | null>(null)
  const [editAbrigo, setEditAbrigo] = useState<Abrigo | null>(null)
  const [editContato, setEditContato] = useState<Contato | null>(null)
  const [editRecurso, setEditRecurso] = useState<Recurso | null>(null)
  const [editEquipe, setEditEquipe] = useState<Equipe | null>(null)

  // ── Mapa operacional ─────────────────────────────────────────────────
  const [itemMapaSelecionado, setItemMapaSelecionado] = useState<string | null>(null)
  const [labelNovoItem, setLabelNovoItem] = useState('')

  // ── Centro do mapa (Conselheiro Lafaiete MG) ─────────────────────────
  const CENTER: [number, number] = [-20.6604, -43.7863]

  // ── Persistência ─────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const p = localStorage.getItem('dc-planos-emerg-v1')
      if (p) setPlanos(JSON.parse(p))
      const a = localStorage.getItem('dc-abrigos-v1')
      if (a) setAbrigos(JSON.parse(a))
      const eq = localStorage.getItem('dc-equipes-v1')
      if (eq) setEquipes(JSON.parse(eq))
      const ct = localStorage.getItem('dc-contatos-v1')
      if (ct) setContatos(JSON.parse(ct))
      const rc = localStorage.getItem('dc-recursos-v1')
      if (rc) setRecursos(JSON.parse(rc))
      const ck = localStorage.getItem('dc-checklist-v1')
      if (ck) setChecklist(JSON.parse(ck))
      const mp = localStorage.getItem('dc-mapa-op-v1')
      if (mp) setItensMapaOp(JSON.parse(mp))
    } catch { /* ignora */ }
  }, [])

  const salvarPlanos = useCallback((lista: PlanoEmerg[]) => {
    setPlanos(lista)
    localStorage.setItem('dc-planos-emerg-v1', JSON.stringify(lista))
  }, [])
  const salvarAbrigos = useCallback((lista: Abrigo[]) => {
    setAbrigos(lista)
    localStorage.setItem('dc-abrigos-v1', JSON.stringify(lista))
  }, [])
  const salvarEquipes = useCallback((lista: Equipe[]) => {
    setEquipes(lista)
    localStorage.setItem('dc-equipes-v1', JSON.stringify(lista))
  }, [])
  const salvarContatos = useCallback((lista: Contato[]) => {
    setContatos(lista)
    localStorage.setItem('dc-contatos-v1', JSON.stringify(lista))
  }, [])
  const salvarRecursos = useCallback((lista: Recurso[]) => {
    setRecursos(lista)
    localStorage.setItem('dc-recursos-v1', JSON.stringify(lista))
  }, [])
  const salvarChecklist = useCallback((lista: CheckItem[]) => {
    setChecklist(lista)
    localStorage.setItem('dc-checklist-v1', JSON.stringify(lista))
  }, [])
  const salvarMapaOp = useCallback((lista: ItemMapaOp[]) => {
    setItensMapaOp(lista)
    localStorage.setItem('dc-mapa-op-v1', JSON.stringify(lista))
  }, [])

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO: PLANOS
  // ══════════════════════════════════════════════════════════════════════
  const [formPlano, setFormPlano] = useState<Partial<PlanoEmerg>>({})

  function abrirModalPlano(p?: PlanoEmerg) {
    setEditPlano(p ?? null)
    setFormPlano(p ? { ...p } : {
      tipo: 'enchente', status: 'rascunho', risco: 'medio',
      nome: '', descricao: '', areaAfetada: '', responsavel: '',
      equipes: [], populacaoAfetada: '', observacoes: '', lat: null, lng: null,
    })
    setModalPlano(true)
  }

  function salvarFormPlano() {
    if (!formPlano.nome?.trim()) return
    const now = agora()
    if (editPlano) {
      salvarPlanos(planos.map(p => p.id === editPlano.id
        ? { ...p, ...formPlano, atualizadoEm: now } as PlanoEmerg : p))
    } else {
      const novo: PlanoEmerg = {
        id: uid(), criadoEm: now, atualizadoEm: now,
        tipo: formPlano.tipo ?? 'outro',
        nome: formPlano.nome ?? '',
        descricao: formPlano.descricao ?? '',
        areaAfetada: formPlano.areaAfetada ?? '',
        status: formPlano.status ?? 'rascunho',
        risco: formPlano.risco ?? 'medio',
        responsavel: formPlano.responsavel ?? '',
        equipes: formPlano.equipes ?? [],
        populacaoAfetada: formPlano.populacaoAfetada ?? '',
        observacoes: formPlano.observacoes ?? '',
        lat: formPlano.lat ?? null,
        lng: formPlano.lng ?? null,
      }
      salvarPlanos([novo, ...planos])
    }
    setModalPlano(false)
  }

  function excluirPlano(id: string) {
    if (!confirm('Excluir este plano?')) return
    salvarPlanos(planos.filter(p => p.id !== id))
  }

  function alterarStatusPlano(id: string, status: StatusPlano) {
    salvarPlanos(planos.map(p => p.id === id ? { ...p, status, atualizadoEm: agora() } : p))
  }

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO: ABRIGOS
  // ══════════════════════════════════════════════════════════════════════
  const [formAbrigo, setFormAbrigo] = useState<Partial<Abrigo>>({})
  const [pickingAbrigo, setPickingAbrigo] = useState(false)

  function abrirModalAbrigo(a?: Abrigo) {
    setEditAbrigo(a ?? null)
    setFormAbrigo(a ? { ...a } : {
      nome: '', endereco: '', capacidade: '', tipo: 'Escola',
      agua: true, energia: true, banheiro: true, acessibilidade: false,
      responsavel: '', telefone: '', lat: null, lng: null, ativo: true, obs: '',
    })
    setPickingAbrigo(false)
    setModalAbrigo(true)
  }

  function salvarFormAbrigo() {
    if (!formAbrigo.nome?.trim()) return
    if (editAbrigo) {
      salvarAbrigos(abrigos.map(a => a.id === editAbrigo.id ? { ...a, ...formAbrigo } as Abrigo : a))
    } else {
      const novo: Abrigo = {
        id: uid(), nome: formAbrigo.nome ?? '', endereco: formAbrigo.endereco ?? '',
        capacidade: formAbrigo.capacidade ?? '', tipo: formAbrigo.tipo ?? 'Outro',
        agua: formAbrigo.agua ?? false, energia: formAbrigo.energia ?? false,
        banheiro: formAbrigo.banheiro ?? false, acessibilidade: formAbrigo.acessibilidade ?? false,
        responsavel: formAbrigo.responsavel ?? '', telefone: formAbrigo.telefone ?? '',
        lat: formAbrigo.lat ?? null, lng: formAbrigo.lng ?? null,
        ativo: formAbrigo.ativo ?? true, obs: formAbrigo.obs ?? '',
      }
      salvarAbrigos([novo, ...abrigos])
    }
    setModalAbrigo(false)
  }

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO: CONTATOS
  // ══════════════════════════════════════════════════════════════════════
  const [formContato, setFormContato] = useState<Partial<Contato>>({})

  function abrirModalContato(c?: Contato) {
    setEditContato(c ?? null)
    setFormContato(c ? { ...c } : {
      nome: '', cargo: '', orgao: '', telefone: '', telefone2: '',
      emoji: '📞', prioridade: 3,
    })
    setModalContato(true)
  }

  function salvarFormContato() {
    if (!formContato.nome?.trim()) return
    if (editContato) {
      salvarContatos(contatos.map(c => c.id === editContato.id ? { ...c, ...formContato } as Contato : c))
    } else {
      salvarContatos([...contatos, { id: uid(), nome: formContato.nome ?? '', cargo: formContato.cargo ?? '',
        orgao: formContato.orgao ?? '', telefone: formContato.telefone ?? '',
        telefone2: formContato.telefone2 ?? '', emoji: formContato.emoji ?? '📞',
        prioridade: formContato.prioridade ?? 3 }])
    }
    setModalContato(false)
  }

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO: RECURSOS
  // ══════════════════════════════════════════════════════════════════════
  const [formRecurso, setFormRecurso] = useState<Partial<Recurso>>({})

  function abrirModalRecurso(r?: Recurso) {
    setEditRecurso(r ?? null)
    setFormRecurso(r ? { ...r } : {
      nome: '', emoji: '📦', categoria: 'Geral', quantidade: 1,
      unidade: 'un', localizacao: '', disponivel: true, obs: '',
    })
    setModalRecurso(true)
  }

  function salvarFormRecurso() {
    if (!formRecurso.nome?.trim()) return
    if (editRecurso) {
      salvarRecursos(recursos.map(r => r.id === editRecurso.id ? { ...r, ...formRecurso } as Recurso : r))
    } else {
      salvarRecursos([...recursos, { id: uid(), nome: formRecurso.nome ?? '', emoji: formRecurso.emoji ?? '📦',
        categoria: formRecurso.categoria ?? 'Geral', quantidade: formRecurso.quantidade ?? 1,
        unidade: formRecurso.unidade ?? 'un', localizacao: formRecurso.localizacao ?? '',
        disponivel: formRecurso.disponivel ?? true, obs: formRecurso.obs ?? '' }])
    }
    setModalRecurso(false)
  }

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO: EQUIPES
  // ══════════════════════════════════════════════════════════════════════
  const [formEquipe, setFormEquipe] = useState<Partial<Equipe>>({})

  function abrirModalEquipe(eq?: Equipe) {
    setEditEquipe(eq ?? null)
    setFormEquipe(eq ? { ...eq } : {
      nome: '', orgao: '', emoji: '👥', responsavel: '', telefone: '',
      missao: '', membros: [], setor: '',
    })
    setModalEquipe(true)
  }

  function salvarFormEquipe() {
    if (!formEquipe.nome?.trim()) return
    if (editEquipe) {
      salvarEquipes(equipes.map(e => e.id === editEquipe.id ? { ...e, ...formEquipe } as Equipe : e))
    } else {
      salvarEquipes([...equipes, { id: uid(), nome: formEquipe.nome ?? '', orgao: formEquipe.orgao ?? '',
        emoji: formEquipe.emoji ?? '👥', responsavel: formEquipe.responsavel ?? '',
        telefone: formEquipe.telefone ?? '', missao: formEquipe.missao ?? '',
        membros: formEquipe.membros ?? [], setor: formEquipe.setor ?? '' }])
    }
    setModalEquipe(false)
  }

  function toggleMembroEquipe(equipeId: string, membro: string) {
    salvarEquipes(equipes.map(e => {
      if (e.id !== equipeId) return e
      const membros = e.membros.includes(membro)
        ? e.membros.filter(m => m !== membro)
        : [...e.membros, membro]
      return { ...e, membros }
    }))
  }

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO: CHECKLIST
  // ══════════════════════════════════════════════════════════════════════
  const [formCheckItem, setFormCheckItem] = useState({ texto: '', categoria: '', responsavel: '' })

  function toggleCheck(id: string) {
    salvarChecklist(checklist.map(c => c.id === id ? { ...c, feito: !c.feito } : c))
  }

  function adicionarCheckItem() {
    if (!formCheckItem.texto.trim()) return
    const novo: CheckItem = {
      id: uid(), texto: formCheckItem.texto, categoria: formCheckItem.categoria || 'Geral',
      responsavel: formCheckItem.responsavel, feito: false,
    }
    salvarChecklist([...checklist, novo])
    setFormCheckItem({ texto: '', categoria: '', responsavel: '' })
    setModalCheckItem(false)
  }

  function resetChecklist() {
    if (!confirm('Resetar todos os itens do checklist?')) return
    salvarChecklist(checklist.map(c => ({ ...c, feito: false })))
  }

  const checkFeitos = checklist.filter(c => c.feito).length
  const checkPct = checklist.length ? Math.round((checkFeitos / checklist.length) * 100) : 0

  // ══════════════════════════════════════════════════════════════════════
  // SEÇÃO: MAPA OPERACIONAL
  // ══════════════════════════════════════════════════════════════════════
  function adicionarItemMapa(lat: number, lng: number) {
    if (!itemMapaSelecionado) return
    const tipo = ITENS_MAPA_OP.find(i => i.tipo === itemMapaSelecionado)
    if (!tipo) return
    const novo: ItemMapaOp = {
      id: uid(), tipo: tipo.tipo, emoji: tipo.emoji,
      label: labelNovoItem || tipo.label, lat, lng,
    }
    salvarMapaOp([...itensMapaOp, novo])
    setItemMapaSelecionado(null)
    setLabelNovoItem('')
  }

  function removerItemMapa(id: string) {
    salvarMapaOp(itensMapaOp.filter(i => i.id !== id))
  }

  // ══════════════════════════════════════════════════════════════════════
  // RENDER SEÇÕES
  // ══════════════════════════════════════════════════════════════════════

  function renderPlanos() {
    return (
      <>
        {planos.length === 0 && (
          <div className="pe-empty">
            <div className="pe-empty-emoji">📋</div>
            <p>Nenhum plano cadastrado.<br />Toque em + para criar o primeiro plano.</p>
          </div>
        )}
        {planos.map(p => (
          <div className="pe-card" key={p.id}>
            <div className="pe-card-header">
              <div className="pe-card-header-left">
                <span className="pe-card-emoji">{TIPO_LABELS[p.tipo].split(' ')[0]}</span>
                <div>
                  <p className="pe-card-title">{p.nome}</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                    <span className={`pe-tipo-badge ${p.tipo}`}>{TIPO_LABELS[p.tipo].replace(/^\S+\s/, '')}</span>
                    <span className={`pe-status ${p.status}`}>{STATUS_LABELS[p.status]}</span>
                    <span className={`pe-risco ${p.risco}`}>{RISCO_LABELS[p.risco]}</span>
                  </div>
                </div>
              </div>
              <div className="pe-card-actions">
                <button className="pe-btn-icon" onClick={() => abrirModalPlano(p)} title="Editar">✏️</button>
                <button className="pe-btn-icon" onClick={() => excluirPlano(p.id)} title="Excluir">🗑️</button>
              </div>
            </div>
            <div className="pe-card-body">
              {p.descricao && <p style={{ fontSize: '0.85rem', color: '#555', margin: '0 0 8px' }}>{p.descricao}</p>}
              <div className="pe-info-grid">
                {p.areaAfetada && (
                  <div className="pe-info-item">
                    <div className="pe-info-label">Área afetada</div>
                    <div className="pe-info-value">{p.areaAfetada}</div>
                  </div>
                )}
                {p.populacaoAfetada && (
                  <div className="pe-info-item">
                    <div className="pe-info-label">Pop. afetada</div>
                    <div className="pe-info-value">{p.populacaoAfetada}</div>
                  </div>
                )}
                {p.responsavel && (
                  <div className="pe-info-item">
                    <div className="pe-info-label">Responsável</div>
                    <div className="pe-info-value">{p.responsavel}</div>
                  </div>
                )}
                {p.equipes.length > 0 && (
                  <div className="pe-info-item">
                    <div className="pe-info-label">Equipes</div>
                    <div className="pe-info-value">{p.equipes.length} acionada(s)</div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {(['rascunho', 'ativo', 'operacao', 'concluido', 'arquivado'] as StatusPlano[])
                  .filter(s => s !== p.status)
                  .map(s => (
                    <button key={s} className="pe-btn pe-btn-secondary pe-btn-sm"
                      onClick={() => alterarStatusPlano(p.id, s)}>
                      → {STATUS_LABELS[s]}
                    </button>
                  ))
                }
              </div>
            </div>
          </div>
        ))}
        <button className="pe-fab" onClick={() => abrirModalPlano()}>+</button>
      </>
    )
  }

  function renderMapa() {
    return (
      <>
        <div style={{ marginBottom: 10 }}>
          <div className="pe-section-title">Adicionar ao mapa</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {ITENS_MAPA_OP.map(it => (
              <button key={it.tipo}
                className={`pe-btn pe-btn-sm ${itemMapaSelecionado === it.tipo ? 'pe-btn-primary' : 'pe-btn-secondary'}`}
                onClick={() => setItemMapaSelecionado(prev => prev === it.tipo ? null : it.tipo)}>
                {it.emoji} {it.label}
              </button>
            ))}
          </div>
          {itemMapaSelecionado && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input
                  className="pe-form-group"
                  style={{ flex: 1, border: '1.5px solid #e0e3e8', borderRadius: 8, padding: '8px 12px', fontSize: '0.85rem' }}
                  placeholder="Rótulo opcional (ex: Abrigo Escola X)"
                  value={labelNovoItem}
                  onChange={e => setLabelNovoItem(e.target.value)}
                />
              </div>
              <div className="pe-mapa-instrucao">
                📍 Toque no mapa para posicionar o item selecionado
              </div>
            </>
          )}
        </div>
        <div className="pe-mapa-container">
          <MapContainer center={CENTER} zoom={14} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            {itemMapaSelecionado && <MapClickOp onPick={adicionarItemMapa} />}
            {itensMapaOp.map(item => (
              <Marker key={item.id} position={[item.lat, item.lng]} icon={emojiIcon(item.emoji)}>
                <Popup>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.2rem' }}>{item.emoji}</div>
                    <strong>{item.label}</strong>
                    <br />
                    <button
                      onClick={() => removerItemMapa(item.id)}
                      style={{ background: '#f8d7da', border: 'none', borderRadius: 6,
                        padding: '4px 10px', marginTop: 6, cursor: 'pointer', color: '#721c24', fontSize: '0.8rem' }}>
                      🗑️ Remover
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
        {itensMapaOp.length > 0 && (
          <>
            <div className="pe-section-title" style={{ marginTop: 14 }}>Itens no mapa ({itensMapaOp.length})</div>
            <div className="pe-lista-inline">
              {itensMapaOp.map(item => (
                <div key={item.id} className="pe-tag">
                  {item.emoji} {item.label}
                  <button className="pe-tag-remove" onClick={() => removerItemMapa(item.id)}>×</button>
                </div>
              ))}
            </div>
          </>
        )}
      </>
    )
  }

  function renderAbrigos() {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: '0.85rem', color: '#666' }}>
            {abrigos.filter(a => a.ativo).length} abrigo(s) ativo(s) — capacidade total:{' '}
            {abrigos.filter(a => a.ativo).reduce((s, a) => s + (parseInt(a.capacidade) || 0), 0)} pessoas
          </span>
        </div>
        {abrigos.length === 0 && (
          <div className="pe-empty">
            <div className="pe-empty-emoji">🏠</div>
            <p>Nenhum abrigo cadastrado.<br />Toque em + para adicionar.</p>
          </div>
        )}
        {abrigos.map(a => (
          <div className="pe-card" key={a.id}>
            <div className="pe-card-header">
              <div className="pe-card-header-left">
                <span className="pe-card-emoji">🏠</span>
                <div>
                  <p className="pe-card-title">{a.nome}</p>
                  <p className="pe-card-subtitle">{a.tipo} · {a.endereco}</p>
                </div>
              </div>
              <div className="pe-card-actions">
                <span className={`pe-status ${a.ativo ? 'ativo' : 'arquivado'}`}>
                  {a.ativo ? 'Ativo' : 'Inativo'}
                </span>
                <button className="pe-btn-icon" onClick={() => abrirModalAbrigo(a)}>✏️</button>
                <button className="pe-btn-icon" onClick={() => salvarAbrigos(abrigos.filter(x => x.id !== a.id))}>🗑️</button>
              </div>
            </div>
            <div className="pe-card-body">
              <div className="pe-info-grid">
                <div className="pe-info-item">
                  <div className="pe-info-label">Capacidade</div>
                  <div className="pe-info-value">{a.capacidade || '—'} pessoas</div>
                </div>
                {a.responsavel && (
                  <div className="pe-info-item">
                    <div className="pe-info-label">Responsável</div>
                    <div className="pe-info-value">{a.responsavel}</div>
                  </div>
                )}
                {a.telefone && (
                  <div className="pe-info-item">
                    <div className="pe-info-label">Telefone</div>
                    <div className="pe-info-value">
                      <a href={`tel:${a.telefone}`} className="pe-contato-tel">{a.telefone}</a>
                    </div>
                  </div>
                )}
              </div>
              <div className="pe-abrigo-grid">
                <div className="pe-abrigo-feat">
                  <span className={a.agua ? 'ok' : 'nao'}>{a.agua ? '✅' : '❌'}</span> Água
                </div>
                <div className="pe-abrigo-feat">
                  <span className={a.energia ? 'ok' : 'nao'}>{a.energia ? '✅' : '❌'}</span> Energia
                </div>
                <div className="pe-abrigo-feat">
                  <span className={a.banheiro ? 'ok' : 'nao'}>{a.banheiro ? '✅' : '❌'}</span> Banheiro
                </div>
                <div className="pe-abrigo-feat">
                  <span className={a.acessibilidade ? 'ok' : 'nao'}>{a.acessibilidade ? '✅' : '❌'}</span> Acessibilidade
                </div>
              </div>
              {a.obs && <p style={{ fontSize: '0.78rem', color: '#777', margin: '8px 0 0' }}>{a.obs}</p>}
            </div>
          </div>
        ))}
        <button className="pe-fab" onClick={() => abrirModalAbrigo()}>+</button>
      </>
    )
  }

  function renderEquipes() {
    return (
      <>
        {equipes.map(eq => (
          <div className="pe-card" key={eq.id}>
            <div className="pe-card-header">
              <div className="pe-card-header-left">
                <span className="pe-card-emoji">{eq.emoji}</span>
                <div>
                  <p className="pe-card-title">{eq.nome}</p>
                  <p className="pe-card-subtitle">{eq.orgao} · {eq.setor}</p>
                </div>
              </div>
              <div className="pe-card-actions">
                <button className="pe-btn-icon" onClick={() => abrirModalEquipe(eq)}>✏️</button>
                <button className="pe-btn-icon" onClick={() => salvarEquipes(equipes.filter(e => e.id !== eq.id))}>🗑️</button>
              </div>
            </div>
            <div className="pe-card-body">
              {eq.missao && (
                <p style={{ fontSize: '0.82rem', color: '#c0392b', fontStyle: 'italic', margin: '0 0 10px' }}>
                  🎯 {eq.missao}
                </p>
              )}
              <div className="pe-info-grid">
                {eq.responsavel && (
                  <div className="pe-info-item">
                    <div className="pe-info-label">Responsável</div>
                    <div className="pe-info-value">{eq.responsavel}</div>
                  </div>
                )}
                {eq.telefone && (
                  <div className="pe-info-item">
                    <div className="pe-info-label">Contato</div>
                    <div className="pe-info-value">
                      <a href={`tel:${eq.telefone}`} className="pe-contato-tel">{eq.telefone}</a>
                    </div>
                  </div>
                )}
              </div>
              <div className="pe-section-title" style={{ marginTop: 10 }}>Agentes do CODAP</div>
              <div className="pe-lista-inline">
                {AGENTES.map(ag => (
                  <button key={ag}
                    className={`pe-btn pe-btn-sm ${eq.membros.includes(ag) ? 'pe-btn-primary' : 'pe-btn-secondary'}`}
                    onClick={() => toggleMembroEquipe(eq.id, ag)}>
                    {eq.membros.includes(ag) ? '✓ ' : ''}{ag}
                  </button>
                ))}
              </div>
              {eq.membros.length > 0 && (
                <p style={{ fontSize: '0.75rem', color: '#888', marginTop: 6 }}>
                  {eq.membros.length} agente(s) selecionado(s)
                </p>
              )}
            </div>
          </div>
        ))}
        <button className="pe-fab" onClick={() => abrirModalEquipe()}>+</button>
      </>
    )
  }

  function renderContatos() {
    const ordenados = [...contatos].sort((a, b) => a.prioridade - b.prioridade)
    const p1 = ordenados.filter(c => c.prioridade === 1)
    const p2 = ordenados.filter(c => c.prioridade === 2)
    const p3 = ordenados.filter(c => c.prioridade >= 3)

    const renderGrupo = (label: string, lista: Contato[]) => lista.length === 0 ? null : (
      <>
        <div className="pe-section-title">{label}</div>
        <div className="pe-card">
          <div style={{ padding: '0 16px' }}>
            {lista.map(c => (
              <div className="pe-contato-item" key={c.id}>
                <div className="pe-contato-avatar">{c.emoji}</div>
                <div className="pe-contato-info">
                  <div className="pe-contato-nome">{c.nome}</div>
                  <div className="pe-contato-cargo">{c.cargo} · {c.orgao}</div>
                  {c.telefone2 && <div style={{ fontSize: '0.72rem', color: '#aaa' }}>{c.telefone2}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <a href={`tel:${c.telefone}`} className="pe-contato-tel">📞 {c.telefone}</a>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="pe-btn-icon" style={{ fontSize: '0.8rem' }} onClick={() => abrirModalContato(c)}>✏️</button>
                    <button className="pe-btn-icon" style={{ fontSize: '0.8rem' }} onClick={() => salvarContatos(contatos.filter(x => x.id !== c.id))}>🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    )

    return (
      <>
        {renderGrupo('🔴 Emergência imediata', p1)}
        {renderGrupo('🟡 Prioridade secundária', p2)}
        {renderGrupo('⚪ Outros contatos', p3)}
        {contatos.length === 0 && (
          <div className="pe-empty">
            <div className="pe-empty-emoji">📞</div>
            <p>Nenhum contato cadastrado.</p>
          </div>
        )}
        <button className="pe-fab" onClick={() => abrirModalContato()}>+</button>
      </>
    )
  }

  function renderRecursos() {
    const categorias = [...new Set(recursos.map(r => r.categoria))]
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: '0.85rem', color: '#666' }}>
            {recursos.filter(r => r.disponivel).length} de {recursos.length} disponíveis
          </span>
        </div>
        {categorias.map(cat => (
          <div key={cat}>
            <div className="pe-section-title">{cat}</div>
            <div className="pe-card">
              <div style={{ padding: '0 16px' }}>
                {recursos.filter(r => r.categoria === cat).map(r => (
                  <div className="pe-recurso-item" key={r.id}>
                    <span className="pe-recurso-emoji">{r.emoji}</span>
                    <div className="pe-recurso-info">
                      <div className="pe-recurso-nome">{r.nome}</div>
                      <div className="pe-recurso-meta">
                        {r.localizacao && `📍 ${r.localizacao}`}
                        {!r.disponivel && <span style={{ color: '#e74c3c', marginLeft: 6 }}>● Indisponível</span>}
                      </div>
                    </div>
                    <div className="pe-recurso-qtd">{r.quantidade} {r.unidade}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button className="pe-btn-icon" onClick={() => abrirModalRecurso(r)}>✏️</button>
                      <button className="pe-btn-icon" onClick={() => salvarRecursos(recursos.filter(x => x.id !== r.id))}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        {recursos.length === 0 && (
          <div className="pe-empty">
            <div className="pe-empty-emoji">📦</div>
            <p>Nenhum recurso cadastrado.</p>
          </div>
        )}
        <button className="pe-fab" onClick={() => abrirModalRecurso()}>+</button>
      </>
    )
  }

  function renderChecklist() {
    const categorias = [...new Set(checklist.map(c => c.categoria))]
    return (
      <>
        <div className="pe-card" style={{ padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1a1a2e' }}>
              Progresso: {checkFeitos}/{checklist.length} ({checkPct}%)
            </span>
            <button className="pe-btn pe-btn-secondary pe-btn-sm" onClick={resetChecklist}>↺ Resetar</button>
          </div>
          <div className="pe-progress-bar">
            <div className="pe-progress-fill" style={{ width: `${checkPct}%` }} />
          </div>
        </div>
        {categorias.map(cat => (
          <div key={cat}>
            <div className="pe-section-title">{cat}</div>
            <div className="pe-card">
              <div style={{ padding: '0 16px' }}>
                {checklist.filter(c => c.categoria === cat).map(item => (
                  <div className="pe-checklist-item" key={item.id}>
                    <input type="checkbox" checked={item.feito} onChange={() => toggleCheck(item.id)} />
                    <span className={`pe-checklist-texto ${item.feito ? 'feito' : ''}`}>{item.texto}</span>
                    {item.responsavel && (
                      <span style={{ fontSize: '0.7rem', color: '#aaa', flexShrink: 0 }}>{item.responsavel}</span>
                    )}
                    <button className="pe-btn-icon" style={{ fontSize: '0.8rem' }}
                      onClick={() => salvarChecklist(checklist.filter(c => c.id !== item.id))}>🗑️</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        <button className="pe-fab" onClick={() => setModalCheckItem(true)}>+</button>
      </>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // MODAIS
  // ══════════════════════════════════════════════════════════════════════

  function ModalPlano() {
    const [pickingLoc, setPickingLoc] = useState(false)
    const selEquipes = (formPlano.equipes ?? [])

    return (
      <div className="pe-modal-overlay" onClick={e => e.target === e.currentTarget && setModalPlano(false)}>
        <div className="pe-modal">
          <div className="pe-modal-handle" />
          <div className="pe-modal-title">
            🚨 {editPlano ? 'Editar Plano' : 'Novo Plano de Emergência'}
          </div>

          <div className="pe-form-group">
            <label>Tipo de Emergência</label>
            <select value={formPlano.tipo ?? 'enchente'}
              onChange={e => setFormPlano(f => ({ ...f, tipo: e.target.value as TipoEmergencia }))}>
              {Object.entries(TIPO_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div className="pe-form-group">
            <label>Nome do Plano *</label>
            <input placeholder="Ex: Deslizamento zona rural de Conselheiro Lafaiete"
              value={formPlano.nome ?? ''}
              onChange={e => setFormPlano(f => ({ ...f, nome: e.target.value }))} />
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Nível de Risco</label>
              <select value={formPlano.risco ?? 'medio'}
                onChange={e => setFormPlano(f => ({ ...f, risco: e.target.value as NivelRisco }))}>
                <option value="baixo">🟢 Baixo</option>
                <option value="medio">🟡 Médio</option>
                <option value="alto">🔴 Alto</option>
                <option value="critico">⚫ Crítico</option>
              </select>
            </div>
            <div className="pe-form-group">
              <label>Status</label>
              <select value={formPlano.status ?? 'rascunho'}
                onChange={e => setFormPlano(f => ({ ...f, status: e.target.value as StatusPlano }))}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pe-form-group">
            <label>Descrição</label>
            <textarea placeholder="Descrição do cenário de emergência..."
              value={formPlano.descricao ?? ''}
              onChange={e => setFormPlano(f => ({ ...f, descricao: e.target.value }))} />
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Área afetada</label>
              <input placeholder="Bairros, setores..."
                value={formPlano.areaAfetada ?? ''}
                onChange={e => setFormPlano(f => ({ ...f, areaAfetada: e.target.value }))} />
            </div>
            <div className="pe-form-group">
              <label>Pop. afetada (est.)</label>
              <input placeholder="Ex: 500 pessoas"
                value={formPlano.populacaoAfetada ?? ''}
                onChange={e => setFormPlano(f => ({ ...f, populacaoAfetada: e.target.value }))} />
            </div>
          </div>

          <div className="pe-form-group">
            <label>Responsável</label>
            <select value={formPlano.responsavel ?? ''}
              onChange={e => setFormPlano(f => ({ ...f, responsavel: e.target.value }))}>
              <option value="">— Selecionar —</option>
              {AGENTES.map(ag => <option key={ag} value={ag}>{ag}</option>)}
            </select>
          </div>

          <div className="pe-form-group">
            <label>Equipes acionadas</label>
            <div className="pe-lista-inline" style={{ marginTop: 4 }}>
              {equipes.map(eq => (
                <button key={eq.id}
                  className={`pe-btn pe-btn-sm ${selEquipes.includes(eq.nome) ? 'pe-btn-primary' : 'pe-btn-secondary'}`}
                  onClick={() => {
                    const novo = selEquipes.includes(eq.nome)
                      ? selEquipes.filter(e => e !== eq.nome)
                      : [...selEquipes, eq.nome]
                    setFormPlano(f => ({ ...f, equipes: novo }))
                  }}>
                  {eq.emoji} {eq.nome}
                </button>
              ))}
            </div>
          </div>

          <div className="pe-form-group">
            <label>Localização no mapa (opcional)</label>
            {!pickingLoc ? (
              <button className="pe-btn pe-btn-secondary" style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setPickingLoc(true)}>
                📍 {formPlano.lat ? `${formPlano.lat.toFixed(4)}, ${formPlano.lng?.toFixed(4)}` : 'Toque para definir localização'}
              </button>
            ) : (
              <>
                <div className="pe-mapa-instrucao">📍 Toque no mapa para definir o ponto</div>
                <div className="pe-mapa-picker">
                  <MapContainer center={CENTER} zoom={13} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <PickerClick onPick={(lat, lng) => {
                      setFormPlano(f => ({ ...f, lat, lng }))
                      setPickingLoc(false)
                    }} />
                    {formPlano.lat && <Marker position={[formPlano.lat, formPlano.lng!]} />}
                  </MapContainer>
                </div>
              </>
            )}
          </div>

          <div className="pe-form-group">
            <label>Observações</label>
            <textarea placeholder="Observações gerais..."
              value={formPlano.observacoes ?? ''}
              onChange={e => setFormPlano(f => ({ ...f, observacoes: e.target.value }))} />
          </div>

          <div className="pe-form-actions">
            <button className="pe-btn pe-btn-secondary" onClick={() => setModalPlano(false)}>Cancelar</button>
            <button className="pe-btn pe-btn-primary" onClick={salvarFormPlano}>
              {editPlano ? '💾 Salvar' : '✅ Criar Plano'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function ModalAbrigo() {
    return (
      <div className="pe-modal-overlay" onClick={e => e.target === e.currentTarget && setModalAbrigo(false)}>
        <div className="pe-modal">
          <div className="pe-modal-handle" />
          <div className="pe-modal-title">🏠 {editAbrigo ? 'Editar Abrigo' : 'Novo Abrigo'}</div>

          <div className="pe-form-group">
            <label>Nome do Abrigo *</label>
            <input placeholder="Ex: Escola Estadual João XXIII"
              value={formAbrigo.nome ?? ''}
              onChange={e => setFormAbrigo(f => ({ ...f, nome: e.target.value }))} />
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Tipo</label>
              <select value={formAbrigo.tipo ?? 'Escola'}
                onChange={e => setFormAbrigo(f => ({ ...f, tipo: e.target.value }))}>
                {['Escola', 'Ginásio', 'Igreja', 'Centro Comunitário', 'Pavilhão', 'Outro'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="pe-form-group">
              <label>Capacidade (pessoas)</label>
              <input type="number" placeholder="300"
                value={formAbrigo.capacidade ?? ''}
                onChange={e => setFormAbrigo(f => ({ ...f, capacidade: e.target.value }))} />
            </div>
          </div>

          <div className="pe-form-group">
            <label>Endereço</label>
            <input placeholder="Rua, número, bairro"
              value={formAbrigo.endereco ?? ''}
              onChange={e => setFormAbrigo(f => ({ ...f, endereco: e.target.value }))} />
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Responsável</label>
              <input placeholder="Nome"
                value={formAbrigo.responsavel ?? ''}
                onChange={e => setFormAbrigo(f => ({ ...f, responsavel: e.target.value }))} />
            </div>
            <div className="pe-form-group">
              <label>Telefone</label>
              <input placeholder="(31) 00000-0000"
                value={formAbrigo.telefone ?? ''}
                onChange={e => setFormAbrigo(f => ({ ...f, telefone: e.target.value }))} />
            </div>
          </div>

          <div className="pe-section-title">Infraestrutura</div>
          {[
            { key: 'agua', label: '💧 Água' },
            { key: 'energia', label: '⚡ Energia elétrica' },
            { key: 'banheiro', label: '🚻 Banheiros' },
            { key: 'acessibilidade', label: '♿ Acessibilidade' },
            { key: 'ativo', label: '✅ Ativo / disponível' },
          ].map(({ key, label }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: '0.88rem', cursor: 'pointer' }}>
              <input type="checkbox"
                checked={!!(formAbrigo as Record<string, unknown>)[key]}
                onChange={e => setFormAbrigo(f => ({ ...f, [key]: e.target.checked }))}
                style={{ width: 18, height: 18, accentColor: '#c0392b' }} />
              {label}
            </label>
          ))}

          <div className="pe-form-group">
            <label>Observações</label>
            <textarea placeholder="Informações adicionais..."
              value={formAbrigo.obs ?? ''}
              onChange={e => setFormAbrigo(f => ({ ...f, obs: e.target.value }))} />
          </div>

          <div className="pe-form-actions">
            <button className="pe-btn pe-btn-secondary" onClick={() => setModalAbrigo(false)}>Cancelar</button>
            <button className="pe-btn pe-btn-primary" onClick={salvarFormAbrigo}>
              {editAbrigo ? '💾 Salvar' : '✅ Adicionar'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function ModalContato() {
    return (
      <div className="pe-modal-overlay" onClick={e => e.target === e.currentTarget && setModalContato(false)}>
        <div className="pe-modal">
          <div className="pe-modal-handle" />
          <div className="pe-modal-title">📞 {editContato ? 'Editar Contato' : 'Novo Contato'}</div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Emoji</label>
              <input placeholder="📞" maxLength={2}
                value={formContato.emoji ?? ''}
                onChange={e => setFormContato(f => ({ ...f, emoji: e.target.value }))} />
            </div>
            <div className="pe-form-group" style={{ flex: 3 }}>
              <label>Nome *</label>
              <input placeholder="Ex: Hospital Municipal"
                value={formContato.nome ?? ''}
                onChange={e => setFormContato(f => ({ ...f, nome: e.target.value }))} />
            </div>
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Cargo / Função</label>
              <input placeholder="Ex: Coord. Emergências"
                value={formContato.cargo ?? ''}
                onChange={e => setFormContato(f => ({ ...f, cargo: e.target.value }))} />
            </div>
            <div className="pe-form-group">
              <label>Órgão / Empresa</label>
              <input placeholder="Ex: Prefeitura"
                value={formContato.orgao ?? ''}
                onChange={e => setFormContato(f => ({ ...f, orgao: e.target.value }))} />
            </div>
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Telefone *</label>
              <input placeholder="(31) 9 0000-0000"
                value={formContato.telefone ?? ''}
                onChange={e => setFormContato(f => ({ ...f, telefone: e.target.value }))} />
            </div>
            <div className="pe-form-group">
              <label>Telefone 2</label>
              <input placeholder="Opcional"
                value={formContato.telefone2 ?? ''}
                onChange={e => setFormContato(f => ({ ...f, telefone2: e.target.value }))} />
            </div>
          </div>

          <div className="pe-form-group">
            <label>Prioridade</label>
            <select value={formContato.prioridade ?? 3}
              onChange={e => setFormContato(f => ({ ...f, prioridade: Number(e.target.value) }))}>
              <option value={1}>🔴 1 — Emergência imediata</option>
              <option value={2}>🟡 2 — Prioridade secundária</option>
              <option value={3}>⚪ 3 — Outros contatos</option>
            </select>
          </div>

          <div className="pe-form-actions">
            <button className="pe-btn pe-btn-secondary" onClick={() => setModalContato(false)}>Cancelar</button>
            <button className="pe-btn pe-btn-primary" onClick={salvarFormContato}>
              {editContato ? '💾 Salvar' : '✅ Adicionar'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function ModalRecurso() {
    const emojis = ['📦', '⛺', '🚿', '🦺', '📻', '⚡', '🟧', '🏥', '🚗', '🚢', '🛶', '⛽', '🔦', '🧰', '🍱', '💊']
    return (
      <div className="pe-modal-overlay" onClick={e => e.target === e.currentTarget && setModalRecurso(false)}>
        <div className="pe-modal">
          <div className="pe-modal-handle" />
          <div className="pe-modal-title">📦 {editRecurso ? 'Editar Recurso' : 'Novo Recurso'}</div>

          <div className="pe-form-group">
            <label>Ícone</label>
            <div className="pe-lista-inline">
              {emojis.map(e => (
                <button key={e}
                  className={`pe-btn pe-btn-sm ${formRecurso.emoji === e ? 'pe-btn-primary' : 'pe-btn-secondary'}`}
                  style={{ fontSize: '1.2rem', padding: '4px 8px' }}
                  onClick={() => setFormRecurso(f => ({ ...f, emoji: e }))}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="pe-form-group">
            <label>Nome do Recurso *</label>
            <input placeholder="Ex: Coletes salva-vidas"
              value={formRecurso.nome ?? ''}
              onChange={e => setFormRecurso(f => ({ ...f, nome: e.target.value }))} />
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Categoria</label>
              <select value={formRecurso.categoria ?? 'Geral'}
                onChange={e => setFormRecurso(f => ({ ...f, categoria: e.target.value }))}>
                {['Estrutura', 'Segurança', 'Comunicação', 'Infraestrutura', 'Sinalização', 'Saúde', 'Alimentação', 'Transporte', 'Geral'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="pe-form-group">
              <label>Unidade</label>
              <select value={formRecurso.unidade ?? 'un'}
                onChange={e => setFormRecurso(f => ({ ...f, unidade: e.target.value }))}>
                {['un', 'kit', 'cx', 'lt', 'kg', 'par', 'rolo', 'pacote'].map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Quantidade</label>
              <input type="number" min={0}
                value={formRecurso.quantidade ?? ''}
                onChange={e => setFormRecurso(f => ({ ...f, quantidade: Number(e.target.value) }))} />
            </div>
            <div className="pe-form-group">
              <label>Localização</label>
              <input placeholder="Ex: Depósito Central"
                value={formRecurso.localizacao ?? ''}
                onChange={e => setFormRecurso(f => ({ ...f, localizacao: e.target.value }))} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, fontSize: '0.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={formRecurso.disponivel ?? true}
              onChange={e => setFormRecurso(f => ({ ...f, disponivel: e.target.checked }))}
              style={{ width: 18, height: 18, accentColor: '#c0392b' }} />
            ✅ Disponível para uso
          </label>

          <div className="pe-form-actions">
            <button className="pe-btn pe-btn-secondary" onClick={() => setModalRecurso(false)}>Cancelar</button>
            <button className="pe-btn pe-btn-primary" onClick={salvarFormRecurso}>
              {editRecurso ? '💾 Salvar' : '✅ Adicionar'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function ModalEquipe() {
    return (
      <div className="pe-modal-overlay" onClick={e => e.target === e.currentTarget && setModalEquipe(false)}>
        <div className="pe-modal">
          <div className="pe-modal-handle" />
          <div className="pe-modal-title">👥 {editEquipe ? 'Editar Equipe' : 'Nova Equipe'}</div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Emoji</label>
              <input placeholder="🛡️" maxLength={2}
                value={formEquipe.emoji ?? ''}
                onChange={e => setFormEquipe(f => ({ ...f, emoji: e.target.value }))} />
            </div>
            <div className="pe-form-group" style={{ flex: 3 }}>
              <label>Nome da Equipe *</label>
              <input placeholder="Ex: Corpo de Bombeiros"
                value={formEquipe.nome ?? ''}
                onChange={e => setFormEquipe(f => ({ ...f, nome: e.target.value }))} />
            </div>
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Órgão</label>
              <input placeholder="Ex: CBMMG"
                value={formEquipe.orgao ?? ''}
                onChange={e => setFormEquipe(f => ({ ...f, orgao: e.target.value }))} />
            </div>
            <div className="pe-form-group">
              <label>Setor / Função</label>
              <input placeholder="Ex: Resgate"
                value={formEquipe.setor ?? ''}
                onChange={e => setFormEquipe(f => ({ ...f, setor: e.target.value }))} />
            </div>
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Responsável</label>
              <input placeholder="Nome do líder"
                value={formEquipe.responsavel ?? ''}
                onChange={e => setFormEquipe(f => ({ ...f, responsavel: e.target.value }))} />
            </div>
            <div className="pe-form-group">
              <label>Telefone</label>
              <input placeholder="(31) 9 0000-0000"
                value={formEquipe.telefone ?? ''}
                onChange={e => setFormEquipe(f => ({ ...f, telefone: e.target.value }))} />
            </div>
          </div>

          <div className="pe-form-group">
            <label>Missão</label>
            <textarea placeholder="Descreva a missão desta equipe..."
              value={formEquipe.missao ?? ''}
              onChange={e => setFormEquipe(f => ({ ...f, missao: e.target.value }))} />
          </div>

          <div className="pe-form-actions">
            <button className="pe-btn pe-btn-secondary" onClick={() => setModalEquipe(false)}>Cancelar</button>
            <button className="pe-btn pe-btn-primary" onClick={salvarFormEquipe}>
              {editEquipe ? '💾 Salvar' : '✅ Criar Equipe'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function ModalCheckItem() {
    return (
      <div className="pe-modal-overlay" onClick={e => e.target === e.currentTarget && setModalCheckItem(false)}>
        <div className="pe-modal">
          <div className="pe-modal-handle" />
          <div className="pe-modal-title">✅ Novo Item do Checklist</div>

          <div className="pe-form-group">
            <label>Tarefa *</label>
            <input placeholder="Ex: Acionar equipe de resgate"
              value={formCheckItem.texto}
              onChange={e => setFormCheckItem(f => ({ ...f, texto: e.target.value }))} />
          </div>

          <div className="pe-form-row">
            <div className="pe-form-group">
              <label>Categoria</label>
              <select value={formCheckItem.categoria}
                onChange={e => setFormCheckItem(f => ({ ...f, categoria: e.target.value }))}>
                {['Ativação', 'Abrigos', 'Segurança', 'Comunicação', 'Registro', 'Saúde', 'Logística', 'Geral'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="pe-form-group">
              <label>Responsável</label>
              <select value={formCheckItem.responsavel}
                onChange={e => setFormCheckItem(f => ({ ...f, responsavel: e.target.value }))}>
                <option value="">— Qualquer —</option>
                {AGENTES.map(ag => <option key={ag} value={ag}>{ag}</option>)}
              </select>
            </div>
          </div>

          <div className="pe-form-actions">
            <button className="pe-btn pe-btn-secondary" onClick={() => setModalCheckItem(false)}>Cancelar</button>
            <button className="pe-btn pe-btn-primary" onClick={adicionarCheckItem}>✅ Adicionar</button>
          </div>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // RENDER PRINCIPAL
  // ══════════════════════════════════════════════════════════════════════
  const TABS: { id: SubAba; emoji: string; label: string }[] = [
    { id: 'planos',    emoji: '📄', label: 'Planos' },
    { id: 'mapa',      emoji: '🗺️', label: 'Mapa' },
    { id: 'abrigos',   emoji: '🏠', label: 'Abrigos' },
    { id: 'equipes',   emoji: '👥', label: 'Equipes' },
    { id: 'contatos',  emoji: '📞', label: 'Contatos' },
    { id: 'recursos',  emoji: '📦', label: 'Recursos' },
    { id: 'checklist', emoji: '✅', label: 'Checklist' },
  ]

  return (
    <div className="pe-container">
      <div className="pe-header">
        <div className="pe-header-top">
          <span style={{ fontSize: '1.4rem' }}>🚨</span>
          <h1>Plano de Emergência</h1>
          <span className="pe-badge">Centro de Crise</span>
        </div>
        <div className="pe-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`pe-tab ${subAba === t.id ? 'ativo' : ''}`}
              onClick={() => setSubAba(t.id)}>
              <span>{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pe-body">
        {subAba === 'planos'    && renderPlanos()}
        {subAba === 'mapa'     && renderMapa()}
        {subAba === 'abrigos'  && renderAbrigos()}
        {subAba === 'equipes'  && renderEquipes()}
        {subAba === 'contatos' && renderContatos()}
        {subAba === 'recursos' && renderRecursos()}
        {subAba === 'checklist' && renderChecklist()}
      </div>

      {modalPlano    && <ModalPlano />}
      {modalAbrigo   && <ModalAbrigo />}
      {modalContato  && <ModalContato />}
      {modalRecurso  && <ModalRecurso />}
      {modalEquipe   && <ModalEquipe />}
      {modalCheckItem && <ModalCheckItem />}
    </div>
  )
}
