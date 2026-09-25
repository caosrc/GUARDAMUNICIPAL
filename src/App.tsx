import { useState, useEffect, useCallback, useMemo, lazy, Suspense, useRef, Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import './App.css'
import Login, { estaLogado, agenteEscolhido, orgaoEscolhido, getAgenteLogado, getOrgaoSelecionado } from './components/Login'
import type { Ocorrencia, NivelRisco, CategoriaOcorrencia } from './types'
import { NATUREZA_ICONE, normalizarNomeAgente } from './types'
import { listarOcorrencias, enviarOcorrenciaServidor, listarRegistrosCurral, ApiError } from './api'
import { wsOn, wsAnunciarOnline } from './wsClient'
import { supabase, supabaseDisponivel } from './supabaseClient'
import { matApi } from './matApi'
import { EVT_ROTA_RESGATE } from './sos'
import { useSosListener } from './sos'
import type { SosAlerta } from './sos'
import { ativarGps } from './gpsService'
import { registrarPushSeNecessario, pedirPermissaoEInscrever, getStatusNotificacoes } from './pushNotifications'
import AgentesOnline from './components/AgentesOnline'
import BotaoSos from './components/BotaoSos'
import BannerNotifSos from './components/BannerNotifSos'
import BannerConvocacao from './components/BannerConvocacao'
import BannerRadarNotificacao from './components/BannerRadarNotificacao'
import { cacheOcorrencias, getCachedOcorrencias, getPending, removePending, countPending, clearAllPending } from './offline'
import { calcularAreaM2, formatarArea } from './components/PoligonoAreaQueimada'
import type { CurralRegistro } from './components/Curral'
import HubOcorrencias from './components/HubOcorrencias'

interface EquipamentoCampoMapa {
  id: number
  material_nome: string | null
  latitude: number | null
  longitude: number | null
  rua: string | null
  bairro: string | null
  observacao: string | null
  status: string
}

const CHAVE_RECARREGAMENTO_CHUNK = 'codap-recarregou-chunk-desatualizado'

function carregarChunkComRecuperacao<T>(importador: () => Promise<T>): Promise<T> {
  return importador()
    .then((modulo) => {
      try { sessionStorage.removeItem(CHAVE_RECARREGAMENTO_CHUNK) } catch { /* armazenamento indisponível */ }
      return modulo
    })
    .catch((erro) => {
      const mensagem = erro instanceof Error ? erro.message : String(erro)
      const erroDeChunk = /dynamically imported module|importing a module script failed|loading chunk/i.test(mensagem)
      if (!erroDeChunk || typeof window === 'undefined') throw erro

      let jaRecarregou = false
      try {
        jaRecarregou = sessionStorage.getItem(CHAVE_RECARREGAMENTO_CHUNK) === '1'
        if (!jaRecarregou) sessionStorage.setItem(CHAVE_RECARREGAMENTO_CHUNK, '1')
      } catch {
        // Sem sessionStorage, o ErrorBoundary ainda exibirá uma recuperação manual.
      }
      if (jaRecarregou) throw erro

      // O HTML novo aponta para os hashes atuais. A recarga resolve abas abertas
      // durante uma publicação sem criar um loop infinito.
      window.location.reload()
      return new Promise<T>(() => {})
    })
}

const MapaOcorrencias = lazy(() => carregarChunkComRecuperacao(() => import('./components/MapaOcorrencias')))
const NovaOcorrencia = lazy(() => carregarChunkComRecuperacao(() => import('./components/NovaOcorrencia')))
const DetalheOcorrencia = lazy(() => carregarChunkComRecuperacao(() => import('./components/DetalheOcorrencia')))
const ChecklistViatura = lazy(() => carregarChunkComRecuperacao(() => import('./components/ChecklistViatura')))
const EscalaAgentes = lazy(() => carregarChunkComRecuperacao(() => import('./components/EscalaAgentes')))
const Dashboard = lazy(() => carregarChunkComRecuperacao(() => import('./components/Dashboard')))
const SosOverlay = lazy(() => carregarChunkComRecuperacao(() => import('./components/SosOverlay')))
const MateriaisEmprestimos = lazy(() => carregarChunkComRecuperacao(() => import('./components/MateriaisEmprestimos')))
const Planejamento = lazy(() => carregarChunkComRecuperacao(() => import('./components/Planejamento')))

type Aba = 'lista' | 'mapa' | 'nova' | 'viatura' | 'escala' | 'materiais' | 'planejamento'
const ABAS_VALIDAS: Aba[] = ['lista', 'mapa', 'nova', 'viatura', 'escala', 'materiais', 'planejamento']
const NOMES_ORGAOS = {
  'defesa-civil': 'Guarda Municipal',
  curral: 'Curral',
  procon: 'Procon',
} as const

function chaveLocalizacaoData(lat: number | null, lng: number | null, data: string | null | undefined): string | null {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lng !== 'number' || !Number.isFinite(lng)) return null
  return `${lat.toFixed(5)}|${lng.toFixed(5)}|${String(data ?? '').slice(0, 10)}`
}

function idCurralNoMapa(id: string | number): number {
  const numero = Number(id)
  if (Number.isFinite(numero)) return -1_000_000_000 - Math.abs(Math.trunc(numero))
  const texto = String(id)
  let hash = 0
  for (let i = 0; i < texto.length; i++) hash = ((hash << 5) - hash + texto.charCodeAt(i)) | 0
  return -1_500_000_000 - Math.abs(hash)
}

function curralParaOcorrenciaMapa(registro: CurralRegistro): Ocorrencia {
  const capturadoEm = registro.capturadoEm || new Date().toISOString()
  const detalhes = [
    registro.especie ? `Espécie: ${registro.especie}` : '',
    registro.porte ? `Porte: ${registro.porte}` : '',
    registro.sexo ? `Sexo: ${registro.sexo}` : '',
    registro.observacoes || '',
  ].filter(Boolean).join(' · ')

  return {
    id: idCurralNoMapa(registro.id),
    tipo: 'Diligência · Curral',
    natureza: 'Captura de animal',
    subnatureza: registro.porte ? `Porte: ${registro.porte}` : null,
    nivel_risco: 'baixo',
    status_oc: registro.status === 'encerrado' ? 'resolvido' : 'ativo',
    fotos: [],
    lat: registro.latitude,
    lng: registro.longitude,
    endereco: registro.localDescricao || null,
    proprietario: registro.identificacao || null,
    situacao: detalhes || null,
    recomendacao: 'Registro de apreensão de animal realizado pelo Curral.',
    conclusao: registro.status === 'encerrado' ? 'Atendimento encerrado.' : null,
    data_ocorrencia: capturadoEm.slice(0, 10) || null,
    hora_inicio: capturadoEm.slice(11, 16) || null,
    hora_fim: null,
    horas_total: null,
    horas_sobreaviso: null,
    created_at: capturadoEm,
    agentes: registro.criadoPor ? [normalizarNomeAgente(registro.criadoPor)] : [],
    responsavel_registro: registro.criadoPor ? normalizarNomeAgente(registro.criadoPor) : null,
    vistorias: [],
    focos_incendio: null,
    poligono_area_queimada: null,
    origem: 'curral',
  }
}

function dataLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hojeStr(): string {
  return dataLocal(new Date().toISOString())
}

function formatarDataExibicao(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-')
  return `${d}/${m}/${y}`
}

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function formatarItemData(d: string): string {
  if (d === 'todas') return 'Todas as datas'
  if (d.length === 7) {
    const [y, m] = d.split('-')
    return `${MESES_PT[parseInt(m) - 1]} ${y}`
  }
  return d === hojeStr() ? `Hoje — ${formatarDataExibicao(d)}` : formatarDataExibicao(d)
}

function NivelBadge({ nivel }: { nivel: NivelRisco }) {
  return (
    <span className={`nivel-badge nivel-${nivel}`}>
      {nivel === 'baixo' ? '🟢 Baixo' : nivel === 'medio' ? '🟡 Médio' : '🔴 Alto'}
    </span>
  )
}


const LazyFallback = () => <div className="carregando">⏳ Carregando...</div>

class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { erro: string | null }
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props)
    this.state = { erro: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { erro: error?.message ?? 'Erro desconhecido' }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }
  render() {
    if (this.state.erro) {
      const mensagem = this.state.erro
      const erroDeChunk = /dynamically imported module|importing a module script failed|loading chunk/i.test(mensagem)
      return this.props.fallback ?? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#c00' }}>
          <div style={{ fontSize: '2rem' }}>⚠️</div>
          <strong>Algo deu errado</strong>
          <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.5rem' }}>{mensagem}</p>
          <button onClick={() => erroDeChunk ? window.location.reload() : this.setState({ erro: null })} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem' }}>
            {erroDeChunk ? 'Atualizar aplicativo' : 'Tentar novamente'}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function BannerInstalar() {
  // Lê o evento capturado globalmente antes do React montar (index.html)
  const [promptEvento, setPromptEvento] = useState<BeforeInstallPromptEvent | null>(
    () => (window as Window & { __pwaInstallPrompt__?: BeforeInstallPromptEvent }).__pwaInstallPrompt__ ?? null
  )
  const [descartado, setDescartado] = useState(() => sessionStorage.getItem('pwa-instalar-descartado') === '1')
  const [ios, setIos] = useState(false)
  const [instalado, setInstalado] = useState(false)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) { setInstalado(true); return }

    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent))

    // Captura caso o evento chegue depois do React montar
    const onPromptReady = () => {
      const w = window as Window & { __pwaInstallPrompt__?: BeforeInstallPromptEvent }
      if (w.__pwaInstallPrompt__) setPromptEvento(w.__pwaInstallPrompt__)
    }
    window.addEventListener('pwa-prompt-ready', onPromptReady)
    const onInstalled = () => setInstalado(true)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('pwa-prompt-ready', onPromptReady)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Só mostra se: tem prompt nativo disponível OU é iOS (que nunca dispara o evento)
  if (instalado || descartado || (!promptEvento && !ios)) return null

  async function instalar() {
    if (promptEvento) {
      await promptEvento.prompt()
      const { outcome } = await promptEvento.userChoice
      if (outcome === 'accepted') {
        setInstalado(true)
        return
      }
      setPromptEvento(null)
    }
    setDescartado(true)
    sessionStorage.setItem('pwa-instalar-descartado', '1')
  }

  function descartar() {
    setDescartado(true)
    sessionStorage.setItem('pwa-instalar-descartado', '1')
  }

  return (
    <div className="pwa-banner">
      <div className="pwa-banner-icone">
         <div className="pwa-banner-icone-texto">GM</div>
      </div>
      <div className="pwa-banner-texto">
        <strong>Instale o app</strong>
        <span>
          {ios
            ? 'Toque em Compartilhar ↑ e depois “Adicionar à Tela de Início”.'
            : 'Adicione na tela inicial para receber alertas mesmo com o app fechado.'}
        </span>
      </div>
      {promptEvento
        ? <button className="pwa-banner-btn" onClick={instalar}>Instalar</button>
        : <button className="pwa-banner-btn" onClick={descartar}>Ok, entendi</button>
      }
      <button className="pwa-banner-fechar" onClick={descartar}>✕</button>
    </div>
  )
}

export default function App() {
  const [logado, setLogado] = useState(estaLogado() && agenteEscolhido() && orgaoEscolhido())
  const { alertas: alertasSos, dispensar: dispensarSos } = useSosListener()
  const [orgao, setOrgao] = useState(getOrgaoSelecionado)
  const [aba, setAba] = useState<Aba>('lista')
  const abaAtualRef = useRef<Aba>('lista')
  const [materiaisResetSignal, setMateriaisResetSignal] = useState(0)
  const materiaisNoMenuRef = useRef(true)
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [selecionada, setSelecionada] = useState<Ocorrencia | null>(null)
  const [novaCategoria, setNovaCategoria] = useState<CategoriaOcorrencia | undefined>(undefined)
  const [filtroNivel, setFiltroNivel] = useState<NivelRisco | 'todos'>('todos')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativo' | 'resolvido'>('todos')
  const [filtroData, setFiltroData] = useState<string>(hojeStr())
  const [buscando, setBuscando] = useState('')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  // Destino externo enviado pelo botão "Traçar rota de resgate" do SOS.
  // Quando preenchido, o mapa abre com o pino e a rota já calculados.
  const [convPendentes, setConvPendentes] = useState(0)
  const [forceOpenConvocacao, setForceOpenConvocacao] = useState(false)
  const [destinoSos, setDestinoSos] = useState<{ lat: number; lng: number } | null>(null)
  const [destinoCampo, setDestinoCampo] = useState<{ lat: number; lng: number; nome?: string; soMostrar?: boolean } | null>(null)
  const [equipamentosCampoMapa, setEquipamentosCampoMapa] = useState<EquipamentoCampoMapa[]>([])
  const [abrirCampoId, setAbrirCampoId] = useState<number | null>(null)
  const [abrirChecklistId, setAbrirChecklistId] = useState<number | null>(null)
  const [registrosCurral, setRegistrosCurral] = useState<CurralRegistro[]>([])
  const selecionadaRef = useRef<Ocorrencia | null>(null)

  const navegarParaAba = useCallback((proxima: Aba) => {
    if (abaAtualRef.current === proxima) return
    abaAtualRef.current = proxima
    // A lista é a tela-raiz: trocar de menu cria uma entrada para que
    // o primeiro Voltar retorne às ocorrências e o segundo saia do app.
    const mudarHistorico = proxima === 'lista'
      ? window.history.replaceState.bind(window.history)
      : window.history.pushState.bind(window.history)
    mudarHistorico(
      { ...(window.history.state || {}), codapAba: proxima },
      '',
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    )
    setAba(proxima)
  }, [])

  useEffect(() => {
    selecionadaRef.current = selecionada
  }, [selecionada])

  useEffect(() => {
    const estadoInicial = window.history.state as { codapAba?: unknown } | null
    const abaInicial = ABAS_VALIDAS.includes(estadoInicial?.codapAba as Aba)
      ? estadoInicial?.codapAba as Aba
      : 'lista'
    abaAtualRef.current = abaInicial
    window.history.replaceState(
      { ...(window.history.state || {}), codapAba: abaInicial },
      '',
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    )
    setAba(abaInicial)

    const aoVoltarNoHistorico = () => {
      const abaAtual = abaAtualRef.current
      // Cada aba é uma tela interna do app. Ao pressionar Voltar, substituímos
      // a entrada antiga por "lista" em vez de deixar o navegador reabrir as
      // telas visitadas anteriormente.
      if (abaAtual !== 'lista' || selecionadaRef.current || !materiaisNoMenuRef.current) {
        materiaisNoMenuRef.current = true
        selecionadaRef.current = null
        setMateriaisResetSignal((sinal) => sinal + 1)
        setSelecionada(null)
        setAbrirChecklistId(null)
        setAbrirCampoId(null)
        setDestinoSos(null)
        setDestinoCampo(null)
        abaAtualRef.current = 'lista'
        setAba('lista')
      }

      window.history.replaceState(
        { ...(window.history.state || {}), codapAba: 'lista' },
        '',
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      )
    }
    window.addEventListener('popstate', aoVoltarNoHistorico)
    return () => window.removeEventListener('popstate', aoVoltarNoHistorico)
  }, [])

  useEffect(() => {
    function abrirChecklist(e: Event) {
      const id = (e as CustomEvent<{ id: number }>).detail?.id
      if (typeof id !== 'number') return
      setAbrirChecklistId(id)
      navegarParaAba('viatura')
    }
    function abrirOcorrencia(e: Event) {
      const id = (e as CustomEvent<{ id: number }>).detail?.id
      if (typeof id !== 'number') return
      const encontrada = ocorrencias.find(o => o.id === id)
      if (encontrada) { setSelecionada(encontrada); navegarParaAba('lista') }
    }
    function abrirRadar() {
      navegarParaAba('planejamento')
    }
    window.addEventListener('dc:abrir-checklist', abrirChecklist)
    window.addEventListener('dc:abrir-ocorrencia', abrirOcorrencia)
    window.addEventListener('dc:abrir-radar', abrirRadar)
    return () => {
      window.removeEventListener('dc:abrir-checklist', abrirChecklist)
      window.removeEventListener('dc:abrir-ocorrencia', abrirOcorrencia)
      window.removeEventListener('dc:abrir-radar', abrirRadar)
    }
  }, [ocorrencias, navegarParaAba])

  useEffect(() => {
    function aoSolicitarRota(e: Event) {
      const d = (e as CustomEvent<{ lat: number; lng: number }>).detail
      if (typeof d?.lat !== 'number' || typeof d?.lng !== 'number') return
      setDestinoSos({ lat: d.lat, lng: d.lng })
      navegarParaAba('mapa')
    }
    window.addEventListener(EVT_ROTA_RESGATE, aoSolicitarRota)
    return () => window.removeEventListener(EVT_ROTA_RESGATE, aoSolicitarRota)
  }, [navegarParaAba])

  const carregarCurral = useCallback(async () => {
    try {
      setRegistrosCurral(await listarRegistrosCurral())
    } catch (erro) {
      console.warn('[Curral] Não foi possível carregar registros legados para o mapa:', erro)
    }
  }, [])

  useEffect(() => {
    if (aba === 'mapa') carregarCurral()
  }, [aba, carregarCurral])

  useEffect(() => {
    return wsOn('curral_atualizado', () => {
      if (aba === 'mapa') carregarCurral()
    })
  }, [aba, carregarCurral])

  // Carrega equipamentos em campo para o mapa
  useEffect(() => {
    async function carregarCampo() {
      if (supabaseDisponivel) {
        try {
          const { data, error } = await supabase
            .from('equipamentos_campo')
            .select('id, material_nome, latitude, longitude, rua, bairro, observacao, status')
            .eq('status', 'ativo')
          if (error) throw new Error(error.message)
          setEquipamentosCampoMapa((data ?? []) as EquipamentoCampoMapa[])
          return
        } catch {
          setEquipamentosCampoMapa([])
          return
        }
      }
      try {
        const res = await fetch('/api/equipamentos-campo')
        const ct = res.headers.get('content-type') || ''
        if (res.ok && !ct.includes('text/html')) {
          const data = await res.json()
          const ativos = (Array.isArray(data) ? data : []).filter((e: EquipamentoCampoMapa) => e.status === 'ativo')
          setEquipamentosCampoMapa(ativos as EquipamentoCampoMapa[])
        }
      } catch { /* silencioso */ }
    }
    carregarCampo()
    // Recarrega quando o WebSocket indica atualização de campo
    const handler = (msg: MessageEvent) => {
      try {
        const m = JSON.parse(msg.data)
        if (m?.tipo === 'campo_atualizado') carregarCampo()
      } catch { /* ignore */ }
    }
    window.addEventListener('ws-message', handler as EventListener)
    return () => window.removeEventListener('ws-message', handler as EventListener)
  }, [])

  // Quando o agente entra no app, anuncia presença online e registra push
  useEffect(() => {
    if (!logado) return
    const agente = getAgenteLogado()
    if (!agente) return
    ativarGps()
    // Re-anuncia presença com o nome correto do agente (o WS pode ter conectado
    // antes do login, quando o nome ainda estava vazio)
    wsAnunciarOnline()
    // Aguarda 2s para não pedir permissão no exato momento do clique de login
    // (alguns navegadores bloqueiam permissions sem gesto recente; 2s funciona
    // porque o gesto do login ainda conta).
    const t = setTimeout(async () => {
      await registrarPushSeNecessario(agente)
      const s = await getStatusNotificacoes()
      setStatusNotif(s)
    }, 2000)
    return () => clearTimeout(t)
  }, [logado])

  // Verifica prazos vencidos de Empréstimos/Manutenção e Equipamentos em Campo
  // logo ao abrir o app (sem precisar entrar no Patrimônio)
  useEffect(() => {
    if (!logado) return
    if (!('Notification' in window)) return

    const t = setTimeout(async () => {
      try {
        const hoje = new Date().toISOString().slice(0, 10)

        let empData: unknown[]
        let campoData: unknown[]
        if (supabaseDisponivel) {
          ;[empData, campoData] = await Promise.all([
            matApi.listarEmprestimos(),
            matApi.listarCampo(),
          ])
        } else {
          const [empRes, campoRes] = await Promise.all([
            fetch('/api/emprestimos'),
            fetch('/api/equipamentos-campo'),
          ])
          empData = empRes.ok ? await empRes.json() : []
          campoData = campoRes.ok ? await campoRes.json() : []
        }

        const empVencidos = (Array.isArray(empData) ? empData : []).filter(
          (e: { devolvido_em?: string | null; data_devolucao_prevista?: string | null }) =>
            !e.devolvido_em && e.data_devolucao_prevista && e.data_devolucao_prevista <= hoje
        )
        const campoVencidos = (Array.isArray(campoData) ? campoData : []).filter(
          (c: { status?: string; data_recolha_prevista?: string | null }) =>
            c.status === 'ativo' && c.data_recolha_prevista && c.data_recolha_prevista <= hoje
        )

        if (empVencidos.length === 0 && campoVencidos.length === 0) return

        async function dispararNotif(title: string, options: NotificationOptions) {
          try {
            new Notification(title, options)
          } catch {
            try {
              const reg = await navigator.serviceWorker.ready
              await reg.showNotification(title, options)
            } catch { /* ignore */ }
          }
        }

        async function disparar() {
          for (const e of empVencidos) {
            await dispararNotif('📦 Prazo vencido — Defesa Civil', {
              body: `${e.material_nome} emprestado a ${e.responsavel} está com prazo vencido.`,
              tag: `app-emp-prazo-${e.id}`,
              icon: '/icon-192.png',
            })
          }
          for (const c of campoVencidos) {
            await dispararNotif('🚧 Recolha pendente — Defesa Civil', {
              body: `${c.material_nome ?? 'Equipamento'} em campo atingiu o prazo de recolha.`,
              tag: `app-campo-prazo-${c.id}`,
              icon: '/icon-192.png',
            })
          }
        }

        if (Notification.permission === 'granted') {
          await disparar()
        } else if (Notification.permission === 'default') {
          Notification.requestPermission().then(async (p) => {
            if (p === 'granted') await disparar()
          })
        }
      } catch { /* silencioso — não interrompe o boot */ }
    }, 4000) // aguarda 4s para não sobrecarregar no boot

    return () => clearTimeout(t)
  }, [logado])

  async function ativarNotificacoes() {
    if (ativandoNotif) return
    const agente = getAgenteLogado()
    if (!agente) return
    setAtivandoNotif(true)
    try {
      const resultado = await pedirPermissaoEInscrever(agente)
      if (resultado === 'ok') {
        setStatusNotif('ativo')
        showToast('🔔 Notificações de SOS ativadas!')
      } else if (resultado === 'negado') {
        setStatusNotif('negado')
        showToast('🔕 Notificações bloqueadas. Libere nas configurações do navegador.')
      } else if (resultado === 'sem-suporte') {
        showToast('⚠️ Este navegador não suporta notificações push.')
      } else {
        showToast('⚠️ Não foi possível ativar. Verifique se o app foi instalado e permita notificações nas configurações do navegador.')
      }
    } finally {
      setAtivandoNotif(false)
    }
  }
  const [pendingCount, setPendingCount] = useState(0)
  const [sincronizando, setSincronizando] = useState(false)
  const [sincronizandoIds, setSincronizandoIds] = useState<Set<number>>(new Set())
  const [toastMsg, setToastMsg] = useState('')
  const [excelProgresso, setExcelProgresso] = useState<string | null>(null)
  const [statusNotif, setStatusNotif] = useState<'ativo'|'concedido'|'negado'|'sem-suporte'|'desconhecido'|null>(null)
  const [ativandoNotif, setAtivandoNotif] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string, duracao = 4000) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMsg(msg)
    toastTimerRef.current = setTimeout(() => {
      setToastMsg('')
      toastTimerRef.current = null
    }, duracao)
  }

  const atualizarPendingCount = useCallback(async () => {
    const n = await countPending()
    setPendingCount(n)
  }, [])

  const carregar = useCallback(async (_forcar = false) => {
    setCarregando(true)
    let serverData: Ocorrencia[] = []
    try {
      serverData = await listarOcorrencias()
      await cacheOcorrencias(serverData)
    } catch {
      serverData = await getCachedOcorrencias()
    }
    const pending = await getPending()
    const offlineItems: Ocorrencia[] = pending.map((p) => ({
      id: -Number(p.localId),
      tipo: p.tipo ?? '',
      natureza: p.natureza ?? '',
      subnatureza: p.subnatureza ?? null,
      nivel_risco: p.nivel_risco ?? 'baixo',
      status_oc: p.status_oc ?? 'ativo',
      fotos: p.fotos ?? [],
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      endereco: p.endereco ?? null,
      proprietario: p.proprietario ?? null,
      responsavel_registro: p.responsavel_registro ? normalizarNomeAgente(p.responsavel_registro) : null,
      situacao: p.situacao ?? null,
      recomendacao: p.recomendacao ?? null,
      conclusao: p.conclusao ?? null,
      data_ocorrencia: p.data_ocorrencia ?? null,
      agentes: Array.isArray(p.agentes) ? p.agentes.map(normalizarNomeAgente) : [],
      vistorias: Array.isArray(p.vistorias) ? p.vistorias : [],
      created_at: p._savedAt ?? new Date().toISOString(),
      _offline: true,
      _localId: p.localId,
    }))
    setOcorrencias([...offlineItems, ...serverData])
    setCarregando(false)
    await atualizarPendingCount()
  }, [atualizarPendingCount])

  const sincronizar = useCallback(async (silencioso = false) => {
    if (sincronizando) return
    const pending = await getPending()
    if (pending.length === 0) return
    setSincronizando(true)
    let ok = 0
    let falhas = 0
    let ultimoErro = ''
    for (const item of pending) {
      const { localId, _savedAt, _offline, _localId, ...data } = item
      void _offline; void _localId; void _savedAt
      try {
        await enviarOcorrenciaServidor(data)
        await removePending(localId)
        ok++
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status >= 400 && err.status < 500) {
            console.error(`[sync] Item ${localId} rejeitado (${err.status}): ${err.message} — removendo da fila`)
            await removePending(localId).catch(() => {})
          } else {
            console.warn(`[sync] Item ${localId} falhou (${err.status}): ${err.message}`)
            ultimoErro = err.message
            falhas++
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`[sync] Item ${localId} falhou por erro de rede:`, err)
          ultimoErro = msg
          falhas++
        }
      }
    }
    setSincronizando(false)
    await atualizarPendingCount()
    if (ok > 0) {
      await carregar()
      // Sucesso só aparece quando o agente clicou manualmente — na auto-sync fica silencioso
      if (!silencioso) {
        showToast(falhas > 0
          ? `✅ ${ok} sincronizada(s). ⚠️ ${falhas} pendente(s) — ${ultimoErro || 'verifique a conexão'}.`
          : `✅ ${ok} ocorrência(s) sincronizadas com sucesso!`
        )
      }
    } else if (falhas > 0) {
      // Falha sempre aparece para o agente poder tomar ação, mesmo na auto-sync
      showToast(`⚠️ Falha ao sincronizar: ${ultimoErro || 'verifique a conexão e tente novamente'}.`, 8000)
    }
  }, [sincronizando, carregar, atualizarPendingCount])

  const sincronizarItem = useCallback(async (localId: number) => {
    setSincronizandoIds(prev => new Set([...prev, localId]))
    try {
      // Lê os dados BRUTOS do IndexedDB — mesma origem que criarOcorrencia usa online.
      // Evita qualquer diferença introduzida pelo mapeamento em carregar().
      const pending = await getPending()
      const item = pending.find(p => p.localId === localId)
      if (!item) throw new Error('Ocorrência não encontrada na fila de pendentes')

      // Remove campos exclusivos do IDB; mantém exatamente o que o formulário salvou.
      const { localId: _li, _savedAt: _sa, _offline: _off, _localId: _lid, id: _id, created_at: _ca, ...dados } = item as Record<string, unknown>
      void _li; void _sa; void _off; void _lid; void _id; void _ca

      // enviarOcorrenciaServidor comprime as fotos automaticamente antes de enviar
      // ao Supabase, evitando o limite de 10 MB do PostgREST (causa do timeout).
      await enviarOcorrenciaServidor(dados as Omit<Ocorrencia, 'id' | 'created_at'>)
      await removePending(localId)
      await carregar()
      showToast('✅ Ocorrência sincronizada com sucesso!')
    } catch (err) {
      const msg = err instanceof ApiError
        ? err.message
        : err instanceof Error ? err.message : 'Verifique a conexão e tente novamente'
      console.error('[sync-item] Falha ao sincronizar item', localId, ':', err)
      // Duração maior (8s) para que o agente leia o motivo do erro no celular
      showToast(`⚠️ Falha ao sincronizar: ${msg}`, 8000)
    } finally {
      setSincronizandoIds(prev => {
        const next = new Set(prev)
        next.delete(localId)
        return next
      })
    }
  }, [carregar])

  useEffect(() => {
    carregar()
  }, [carregar])

  // Sincroniza pendentes assim que o app carrega (se online e houver itens)
  useEffect(() => {
    if (!navigator.onLine) return
    countPending().then(n => { if (n > 0) sincronizar(true) }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sincroniza quando o app volta ao primeiro plano (ex: volta da tela do celular)
  useEffect(() => {
    function aoRetomarFoco() {
      if (navigator.onLine) sincronizar(true)
    }
    document.addEventListener('visibilitychange', aoRetomarFoco)
    return () => document.removeEventListener('visibilitychange', aoRetomarFoco)
  }, [sincronizar])

  // Pré-carrega TODOS os chunks lazy assim que o app abre online,
  // para que o Service Worker cacheie tudo e o app funcione 100% offline
  // mesmo em telas que o usuário ainda não visitou.
  useEffect(() => {
    if (!navigator.onLine) return
    const id = window.setTimeout(() => {
      Promise.all([
        import('./components/MapaOcorrencias'),
        import('./components/NovaOcorrencia'),
        import('./components/DetalheOcorrencia'),
        import('./components/ChecklistViatura'),
        import('./components/EscalaAgentes'),
        import('./components/Dashboard'),
        import('./components/MateriaisEmprestimos'),
        import('./components/Planejamento'),
        import('./components/MonitoramentoCNL'),
        import('./components/Curral'),
      ]).catch(() => { /* sem internet ou bloqueado, ignora */ })
    }, 1500)
    return () => window.clearTimeout(id)
  }, [])

  // Realtime: recarrega a lista quando outro usuário cria/edita/apaga uma ocorrência
  useEffect(() => {
    const off = wsOn('ocorrencias_atualizadas', () => { carregar() })
    return off
  }, [carregar])

  useEffect(() => {
    const goOnline = () => { setIsOnline(true); setTimeout(() => sincronizar(true), 800) }
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [sincronizar])

  async function exportarTudoKMZ() {
    const comGeo = ocorrencias.filter((o) => o.lat && o.lng)
    const comPoligono = ocorrencias.filter((o) => Array.isArray((o as any).poligono_area_queimada) && (o as any).poligono_area_queimada.length >= 3)
    if (!comGeo.length && !comPoligono.length) { alert('Nenhuma ocorrência com GPS para exportar.'); return }

    function kmlDescricao(o: typeof ocorrencias[0]) {
      const pol = Array.isArray((o as any).poligono_area_queimada)
        ? (o as any).poligono_area_queimada as { lat: number; lng: number }[]
        : []
      const ehIncendioKmz = o.natureza === 'Incêndio em Área Urbana' || o.natureza === 'Incêndio em Área Rural'
      const areaQueimadaTexto = (pol.length >= 3 && ehIncendioKmz)
        ? `<b>Área Queimada:</b> ${formatarArea(calcularAreaM2(pol))}<br/>`
        : ''
      return `<![CDATA[
        <b>Tipo:</b> ${o.tipo}<br/>
        <b>Natureza:</b> ${o.natureza}${o.subnatureza ? ` (${o.subnatureza})` : ''}<br/>
        <b>Nível:</b> ${o.nivel_risco}<br/>
        <b>Status:</b> ${o.status_oc}<br/>
        ${o.endereco ? `<b>Endereço:</b> ${o.endereco}<br/>` : ''}
        ${o.proprietario ? `<b>Proprietário:</b> ${o.proprietario}<br/>` : ''}
        ${areaQueimadaTexto}<b>Data:</b> ${new Date(o.created_at).toLocaleString('pt-BR')}
      ]]>`
    }

    const placemarks = comGeo.map((o) => {
      const pol = Array.isArray((o as any).poligono_area_queimada) ? (o as any).poligono_area_queimada as { lat: number; lng: number }[] : []
      const temPoligono = pol.length >= 3
      return `
    <Placemark>
      <name>${o.natureza}</name>
      <description>${kmlDescricao(o)}</description>
      <styleUrl>#ocorrencia</styleUrl>
      <Point><coordinates>${o.lng},${o.lat},0</coordinates></Point>
    </Placemark>${temPoligono ? `
    <Placemark>
      <name>🔥 Área Queimada — ${o.natureza}${o.endereco ? ' · ' + o.endereco : ''}</name>
      <description>${kmlDescricao(o)}</description>
      <styleUrl>#areaQueimada</styleUrl>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${[...pol, pol[0]].map(p => `${p.lng},${p.lat},0`).join(' ')}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>` : ''}`
    }).join('\n')

    const poligonosSemPonto = comPoligono
      .filter((o) => !o.lat || !o.lng)
      .map((o) => {
        const pol = (o as any).poligono_area_queimada as { lat: number; lng: number }[]
        return `
    <Placemark>
      <name>🔥 Área Queimada — ${o.natureza}${o.endereco ? ' · ' + o.endereco : ''}</name>
      <description>${kmlDescricao(o)}</description>
      <styleUrl>#areaQueimada</styleUrl>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${[...pol, pol[0]].map(p => `${p.lng},${p.lat},0`).join(' ')}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`
      }).join('\n')

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Defesa Civil — Conselheiro Lafaiete — Todas as Ocorrências</name>
    <Style id="areaQueimada">
      <LineStyle>
        <color>ff0000ff</color>
        <width>2.5</width>
      </LineStyle>
      <PolyStyle>
        <color>660000ff</color>
      </PolyStyle>
    </Style>
    <Style id="ocorrencia">
      <IconStyle>
        <scale>1.0</scale>
      </IconStyle>
    </Style>
    ${placemarks}
    ${poligonosSemPonto}
  </Document>
</kml>`
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('ocorrencias.kml', kml)
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `defesa_civil_conselheiro_lafaiete_${Date.now()}.kmz`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportarExcel() {
    if (excelProgresso !== null) return
    try {
      const { exportarTodasExcel } = await import('./exportExcel')
      if (ocorrenciasFiltradas.length === 0) {
        showToast('⚠️ Não há ocorrências para exportar.')
        return
      }
      setExcelProgresso(`⏳ Gerando planilha… 0/${ocorrenciasFiltradas.length}`)
      // O Excel de ocorrências é deliberadamente gerado sem fotos para não
      // bloquear o download por tempo limite ou volume de imagens.
      const ocorrenciasSemFotos = ocorrenciasFiltradas.map(o => ({ ...o, fotos: [] }))
      await exportarTodasExcel(ocorrenciasSemFotos, (atual, tot) => {
        setExcelProgresso(`⏳ Gerando planilha… ${atual}/${tot}`)
      })
    } catch (error) {
      console.error('[Excel] falha ao exportar ocorrências:', error)
      const detalhe = error instanceof Error && error.message ? ` ${error.message}` : ''
      showToast(`⚠️ Não foi possível gerar o Excel.${detalhe}`, 8000)
    } finally {
      setExcelProgresso(null)
    }
  }

  const datasDisponiveis = useMemo(() => {
    const mesAtual = hojeStr().slice(0, 7)
    const diasUnicos = new Set(ocorrencias.map((o) => dataLocal(o.created_at)))
    diasUnicos.add(hojeStr())
    const resultado: string[] = ['todas']
    const mesesPassados = new Set<string>()
    for (const d of Array.from(diasUnicos).sort((a, b) => b.localeCompare(a))) {
      const mes = d.slice(0, 7)
      if (mes >= mesAtual) {
        resultado.push(d)
      } else {
        if (!mesesPassados.has(mes)) {
          mesesPassados.add(mes)
          resultado.push(mes)
        }
      }
    }
    return resultado
  }, [ocorrencias])

  const ocorrenciasMapa = useMemo(() => {
    const registrosComGps = registrosCurral.filter((registro) =>
      typeof registro.latitude === 'number' && Number.isFinite(registro.latitude) &&
      typeof registro.longitude === 'number' && Number.isFinite(registro.longitude)
    )

    const curralMapa = registrosComGps
      .map(curralParaOcorrenciaMapa)
      .filter((registroCurral) => {
        const chaveCurral = chaveLocalizacaoData(
          registroCurral.lat,
          registroCurral.lng,
          registroCurral.data_ocorrencia,
        )
        if (!chaveCurral) return false

        // O fluxo de captura por GPS já cria uma ocorrência geral. Nesse
        // caso, mantém apenas o registro geral para não desenhar dois pinos.
        return !ocorrencias.some((ocorrencia) =>
          ocorrencia.natureza === 'Captura de animal' &&
          chaveLocalizacaoData(ocorrencia.lat, ocorrencia.lng, ocorrencia.data_ocorrencia) === chaveCurral &&
          (!registroCurral.proprietario || !ocorrencia.proprietario || registroCurral.proprietario === ocorrencia.proprietario)
        )
      })

    return [...ocorrencias, ...curralMapa]
  }, [ocorrencias, registrosCurral])

  const ocorrenciasFiltradas = useMemo(() => ocorrencias.filter((o) => {
    if (filtroData !== 'todas') {
      const dOc = dataLocal(o.created_at)
      if (filtroData.length === 10) {
        if (dOc !== filtroData) return false
      } else {
        if (!dOc.startsWith(filtroData + '-')) return false
      }
    }
    if (filtroNivel !== 'todos' && o.nivel_risco !== filtroNivel) return false
    if (filtroStatus !== 'todos' && o.status_oc !== filtroStatus) return false
    if (buscando) {
      const b = buscando.toLowerCase()
      return o.natureza.toLowerCase().includes(b) || o.tipo.toLowerCase().includes(b) ||
        (o.endereco ?? '').toLowerCase().includes(b) || (o.proprietario ?? '').toLowerCase().includes(b)
    }
    return true
  }), [ocorrencias, filtroData, filtroNivel, filtroStatus, buscando])

  const contagens = useMemo(() => ({
    alto: ocorrencias.filter((o) => o.nivel_risco === 'alto').length,
    medio: ocorrencias.filter((o) => o.nivel_risco === 'medio').length,
    baixo: ocorrencias.filter((o) => o.nivel_risco === 'baixo').length,
    ativos: ocorrencias.filter((o) => o.status_oc === 'ativo').length,
  }), [ocorrencias])

  const orgaoAtual = orgao ?? 'defesa-civil'
  const nomeOrgaoAtual = NOMES_ORGAOS[orgaoAtual]

  if (!logado) {
    return (
      <Login
        onLogin={() => {
          setOrgao(getOrgaoSelecionado())
          setLogado(true)
        }}
        apenasAgente={estaLogado() && (!agenteEscolhido() || !orgaoEscolhido())}
      />
    )
  }

  if (aba === 'nova') {
    return (
      <Suspense fallback={<LazyFallback />}>
        <NovaOcorrencia
          onSalvo={async (ocOffline) => {
            if (ocOffline) showToast('📥 Salvo localmente. Será enviado ao reconectar.')
            await carregar()
            await atualizarPendingCount()
            navegarParaAba('lista')
          }}
          onVoltar={() => navegarParaAba('lista')}
          isOnline={isOnline}
          orgao={orgaoAtual}
           categoriaInicial={novaCategoria}
        />
      </Suspense>
    )
  }

  return (
    <div className="app">
      <BannerInstalar />

      {!isOnline && (
        <div className="offline-banner">
          📵 Sem conexão — dados salvos localmente
        </div>
      )}

      {isOnline && pendingCount > 0 && (
        <div className="sync-banner">
          <span
            style={{ flex: 1, cursor: 'pointer' }}
            onClick={() => sincronizar()}
          >
            {sincronizando
              ? '⏳ Sincronizando...'
              : `🔄 ${pendingCount} ocorrência(s) pendente(s) — toque para sincronizar`}
          </span>
          {!sincronizando && (
            <button
              className="sync-banner-descartar"
              title="Descartar todas as pendências locais"
              onClick={async () => {
                if (!confirm(`Descartar ${pendingCount} ocorrência(s) salva(s) localmente? Elas NÃO serão enviadas ao servidor.`)) return
                await clearAllPending()
                await atualizarPendingCount()
                await carregar()
                showToast('🗑️ Pendências locais descartadas.')
              }}
            >
              🗑️
            </button>
          )}
        </div>
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}

      <header className="header">
        <div className="header-logo">
          <div className="marca-guarda" aria-hidden="true">GM</div>
          <div className="header-textos">
            <span className="header-nome">Guarda Municipal</span>
            <span className="header-cidade">Conselheiro Lafaiete — MG · {nomeOrgaoAtual}</span>
          </div>
        </div>
        <div className="header-direita">
          <AgentesOnline />
          {logado && convPendentes > 0 && (
            <button
              className="convoc-alerta-btn"
              title={`${convPendentes} convocação${convPendentes !== 1 ? 'ões' : ''} aguardando confirmação — clique para ver`}
              onClick={() => {
                setForceOpenConvocacao(true)
                setTimeout(() => setForceOpenConvocacao(false), 200)
              }}
            >
              📣<span className="convoc-alerta-num">{convPendentes}</span>
            </button>
          )}
          {logado && statusNotif !== 'sem-suporte' && statusNotif !== null && (
            <button
              className={`notif-bell-btn ${statusNotif === 'ativo' ? 'notif-bell-ativo' : statusNotif === 'negado' ? 'notif-bell-negado' : 'notif-bell-inativo'}`}
              title={
                statusNotif === 'ativo' ? 'Notificações de SOS ativas' :
                statusNotif === 'negado' ? 'Notificações bloqueadas — toque para ver como liberar' :
                'Toque para ativar notificações de SOS'
              }
              onClick={statusNotif !== 'ativo' ? ativarNotificacoes : undefined}
              disabled={ativandoNotif}
            >
              {statusNotif === 'ativo' ? '🔔' : statusNotif === 'negado' ? '🔕' : '🔕'}
              <span className="notif-bell-label">
                {statusNotif === 'ativo' ? 'SOS ativo' : 'Ativar SOS'}
              </span>
            </button>
          )}
          <BotaoSos modo="botao" />
        </div>
      </header>

      {logado && statusNotif !== 'ativo' && statusNotif !== 'sem-suporte' && statusNotif !== null && (
        <BannerNotifSos
          statusNotif={statusNotif}
          agente={getAgenteLogado()}
          onAtivado={async () => {
            const s = await getStatusNotificacoes()
            setStatusNotif(s)
          }}
        />
      )}

      {logado && <BannerConvocacao
        onPendentesChange={setConvPendentes}
        forceOpen={forceOpenConvocacao}
      />}

      {aba === 'lista' && (
        <div className="resumo-strip">
          <div className="resumo-item resumo-alto" onClick={() => setFiltroNivel(filtroNivel === 'alto' ? 'todos' : 'alto')}>
            <span className="resumo-num">{contagens.alto}</span>
            <span className="resumo-rotulo">Alto</span>
          </div>
          <div className="resumo-div" />
          <div className="resumo-item resumo-medio" onClick={() => setFiltroNivel(filtroNivel === 'medio' ? 'todos' : 'medio')}>
            <span className="resumo-num">{contagens.medio}</span>
            <span className="resumo-rotulo">Médio</span>
          </div>
          <div className="resumo-div" />
          <div className="resumo-item resumo-baixo" onClick={() => setFiltroNivel(filtroNivel === 'baixo' ? 'todos' : 'baixo')}>
            <span className="resumo-num">{contagens.baixo}</span>
            <span className="resumo-rotulo">Baixo</span>
          </div>
          <div className="resumo-div" />
          <div className="resumo-item resumo-total" onClick={() => { setFiltroNivel('todos'); setFiltroStatus('todos') }}>
            <span className="resumo-num">{ocorrencias.length}</span>
            <span className="resumo-rotulo">Total</span>
          </div>
        </div>
      )}

      <div className="conteudo">
        {aba === 'lista' && (
          <>
            <HubOcorrencias
              total={ocorrencias.length}
              ativos={contagens.ativos}
              altos={contagens.alto}
              online={isOnline}
              agente={getAgenteLogado()}
              onNova={(categoria) => { setNovaCategoria(categoria); navegarParaAba('nova') }}
              onAtivos={() => { setFiltroData('todas'); setFiltroStatus('ativo'); navegarParaAba('lista') }}
              onHistorico={() => { setFiltroData('todas'); setFiltroStatus('resolvido'); navegarParaAba('lista') }}
              onMapa={() => navegarParaAba('mapa')}
              onPatrulhamento={() => navegarParaAba('planejamento')}
              onRelatorios={() => document.getElementById('dashboard-ocorrencias')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              onInfo={showToast}
            />
            <div className="filtros-box">
              <div className="filtros-row filtros-data-row">
                <span className="filtros-label">📅 Data:</span>
                <select
                  className="filtro-data-select"
                  value={filtroData}
                  onChange={(e) => setFiltroData(e.target.value)}
                >
                  {datasDisponiveis.map((d) => (
                    <option key={d} value={d}>{formatarItemData(d)}</option>
                  ))}
                </select>
                {filtroData !== hojeStr() && (
                  <button className="btn-hoje" onClick={() => setFiltroData(hojeStr())}>Hoje</button>
                )}
                {filtroData === 'todas' && (
                  <span style={{ fontSize: '0.72rem', color: '#6b7280', marginLeft: '0.2rem' }}>
                    ({ocorrencias.length} total)
                  </span>
                )}
              </div>
              <input
                className="busca-input"
                type="text"
                placeholder="🔍 Buscar por natureza, local ou morador..."
                value={buscando}
                onChange={(e) => setBuscando(e.target.value)}
              />
              <div className="filtros-row">
                <span className="filtros-label">Nível:</span>
                {(['todos', 'alto', 'medio', 'baixo'] as const).map((f) => (
                  <button key={f} className={`filtro-btn ${filtroNivel === f ? 'ativo' : ''} ${f !== 'todos' ? `filtro-${f}` : ''}`} onClick={() => setFiltroNivel(f)}>
                    {f === 'todos' ? 'Todos' : f === 'alto' ? 'Alto' : f === 'medio' ? 'Médio' : 'Baixo'}
                  </button>
                ))}
                <span className="filtros-label" style={{ marginLeft: '0.4rem' }}>Status:</span>
                {(['todos', 'ativo', 'resolvido'] as const).map((s) => (
                  <button key={s} className={`filtro-btn ${filtroStatus === s ? 'ativo' : ''}`} onClick={() => setFiltroStatus(s)}>
                    {s === 'todos' ? 'Todos' : s === 'ativo' ? 'Ativos' : 'Resolvidos'}
                  </button>
                ))}
              </div>
              <div className="filtros-row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  className="btn-excel-global"
                  onClick={exportarExcel}
                  disabled={excelProgresso !== null}
                  title={excelProgresso ?? 'Exportar para Excel'}
                  style={{ opacity: excelProgresso !== null ? 0.7 : 1, minWidth: excelProgresso ? '14rem' : undefined, fontSize: excelProgresso ? '0.78rem' : undefined }}
                >
                  {excelProgresso ?? '📊 Excel'}
                </button>
                <button className="btn-kmz-global" onClick={exportarTudoKMZ}>
                  🌍 KMZ
                </button>
              </div>
            </div>

            <Suspense fallback={null}>
              <Dashboard ocorrencias={ocorrencias} />
            </Suspense>

            {carregando ? (
              <div className="carregando">⏳ Carregando ocorrências...</div>
            ) : ocorrenciasFiltradas.length === 0 ? (
              <div className="lista-vazia">
                <div style={{ fontSize: '3rem' }}>📋</div>
                <div>
                  {filtroData === hojeStr()
                    ? 'Nenhuma ocorrência registrada hoje.'
                    : filtroData === 'todas'
                    ? 'Nenhuma ocorrência registrada.'
                    : `Nenhuma ocorrência em ${formatarItemData(filtroData)}.`}
                </div>
                {filtroData === hojeStr() && (
                  <button className="btn-nova-vazia" onClick={() => navegarParaAba('nova')}>+ Registrar nova</button>
                )}
              </div>
            ) : (
              <div className="lista">
                {ocorrenciasFiltradas.map((o) => (
                  <div key={o.id} className="oc-card-wrapper">
                    <button className={`oc-card ${o._offline ? 'oc-card-offline' : ''}`} onClick={() => setSelecionada(o)}>
                      <div className="oc-card-esq">
                        <span className="oc-emoji">{NATUREZA_ICONE[o.natureza] ?? '📋'}</span>
                      </div>
                      <div className="oc-card-corpo">
                        <div className="oc-card-top">
                          <span className="oc-natureza">{o.natureza}</span>
                          {o._offline && <span className="oc-offline-tag">📵 Salvo offline</span>}
                          <span className="oc-seta">›</span>
                        </div>
                        <div className="oc-card-badges">
                          <NivelBadge nivel={o.nivel_risco} />
                          <span className={`status-badge status-${o.status_oc}`}>
                            {o.status_oc === 'ativo' ? '🔴 Ativo' : '✅ Resolvido'}
                          </span>
                        </div>
                        <div className="oc-card-meta">
                          <span>{o.tipo}</span>
                          {o.endereco && <span>📍 {o.endereco}</span>}
                          <span>🕐 {new Date(o.created_at).toLocaleDateString('pt-BR')}</span>
                          {Array.isArray(o.agentes) && o.agentes.length > 0 && (
                            <span>👤 {o.agentes.map(normalizarNomeAgente).join(', ')}</span>
                          )}
                        </div>
                      </div>
                    </button>
                    {o._offline && o._localId != null && isOnline && (
                      <button
                        className={`btn-sincronizar-item ${sincronizandoIds.has(o._localId) ? 'sincronizando' : ''}`}
                        onClick={() => sincronizarItem(o._localId!)}
                        disabled={sincronizandoIds.has(o._localId)}
                      >
                        {sincronizandoIds.has(o._localId) ? '⏳ Sincronizando...' : '☁️ Sincronizar agora'}
                      </button>
                    )}
                    {o._offline && !isOnline && (
                      <div className="btn-sincronizar-item btn-sincronizar-offline">
                        📵 Sem conexão — aguardando rede
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {aba === 'mapa' && (
          <ErrorBoundary>
            <Suspense fallback={<LazyFallback />}>
              <MapaOcorrencias
                ocorrencias={ocorrenciasMapa}
                onSelecionar={(o) => setSelecionada(o)}
                destinoExterno={destinoSos ?? destinoCampo}
                onDestinoExternoConsumido={() => { setDestinoSos(null); setDestinoCampo(null) }}
                equipamentosCampo={equipamentosCampoMapa}
                alertasSos={alertasSos}
                onVerDetalheCampo={(id) => { setAbrirCampoId(id); navegarParaAba('materiais') }}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {aba === 'viatura' && (
          <ErrorBoundary>
            <Suspense fallback={<LazyFallback />}>
              <ChecklistViatura abrirId={abrirChecklistId} />
            </Suspense>
          </ErrorBoundary>
        )}

        {aba === 'escala' && (
          <ErrorBoundary>
            <Suspense fallback={<LazyFallback />}>
              <EscalaAgentes ocorrencias={ocorrencias} />
            </Suspense>
          </ErrorBoundary>
        )}

        {aba === 'materiais' && (
          <ErrorBoundary>
            <Suspense fallback={<LazyFallback />}>
              <MateriaisEmprestimos
                onIrParaMapa={(lat, lng, nome) => {
                  setDestinoCampo({ lat, lng, nome, soMostrar: true })
                  navegarParaAba('mapa')
                }}
                abrirCampoId={abrirCampoId}
                onAbrirCampoIdConsumido={() => setAbrirCampoId(null)}
                resetSignal={materiaisResetSignal}
                onMenuPrincipalChange={(noMenu) => { materiaisNoMenuRef.current = noMenu }}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {aba === 'planejamento' && (
          <ErrorBoundary>
            <Suspense fallback={<LazyFallback />}>
              <Planejamento />
            </Suspense>
          </ErrorBoundary>
        )}

      </div>

      <nav className="bottom-nav">
        <button className={`nav-btn ${aba === 'escala' ? 'ativo' : ''}`} onClick={() => navegarParaAba('escala')}>
          <span className="nav-emoji">👥</span>
          <span>Escala</span>
        </button>
        <button className={`nav-btn ${aba === 'planejamento' ? 'ativo' : ''}`} onClick={() => navegarParaAba('planejamento')}>
          <span className="nav-emoji">📐</span>
          <span>Planejamento</span>
        </button>
        <button className={`nav-btn ${aba === 'lista' ? 'ativo' : ''}`} onClick={() => navegarParaAba('lista')}>
          <span className="nav-emoji">📋</span>
          <span>Ocorrências</span>
        </button>
        <button className="nav-btn nav-nova" onClick={() => navegarParaAba('nova')}>
          <span className="nav-nova-icone">+</span>
        </button>
        <button className={`nav-btn ${aba === 'mapa' ? 'ativo' : ''}`} onClick={() => navegarParaAba('mapa')}>
          <span className="nav-emoji">🗺️</span>
          <span>Mapa</span>
        </button>
        <button className={`nav-btn ${aba === 'viatura' ? 'ativo' : ''}`} onClick={() => navegarParaAba('viatura')}>
          <span className="nav-emoji">🚗</span>
          <span>Viatura</span>
        </button>
        <button className={`nav-btn ${aba === 'materiais' ? 'ativo' : ''}`} onClick={() => navegarParaAba('materiais')}>
          <span className="nav-emoji">📦</span>
          <span>Patrimônio</span>
        </button>
      </nav>

      {selecionada && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <DetalheOcorrencia
              ocorrencia={selecionada}
              onFechar={() => setSelecionada(null)}
              onDeletado={() => { setSelecionada(null); carregar() }}
              onAtualizado={(atualizado) => {
                setSelecionada(atualizado)
                setOcorrencias((prev) => prev.map((o) => o.id === atualizado.id ? atualizado : o))
              }}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Overlay de SOS recebido — visível em qualquer aba */}
      <ErrorBoundary>
        <Suspense fallback={null}>
          <SosOverlay alertas={alertasSos} onDispensar={dispensarSos} />
        </Suspense>
      </ErrorBoundary>
      {logado && <BannerRadarNotificacao />}
    </div>
  )
}
