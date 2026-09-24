import { wsSend } from './wsClient'
import { mensagemErroGps } from './utils'
import { normalizarNomeAgente } from './types'

// ── Serviço de GPS GLOBAL (singleton) ────────────────────────────────────
// Mantém o watchPosition ativo INDEPENDENTE de qual aba do app o usuário
// está vendo. Antes, o watch vivia dentro de MapaOcorrencias e morria toda
// vez que o agente trocava pra "Lista" / "Checklist", o que fazia outros
// agentes deixarem de ver o marcador mesmo com o GPS supostamente ligado.
//
// Garantias:
//   • ativarGps() é seguro de chamar a qualquer momento (idempotente)
//   • desativarGps() faz untrack imediato + broadcast 'gps-off' para que
//     outros agentes removam o marcador na hora (sem esperar timeout do
//     Presence)
//   • Ao chamar ativarGps(), tentamos uma posição rápida cacheada em
//     paralelo ao watchPosition — assim outros agentes te veem em segundos
//     em vez de esperar o GPS travar (5-30s no celular)
//   • pagehide (fechar aba/voltar pra home no celular) → notificação
//     síncrona de saída

export type StatusGps = 'inativo' | 'aguardando' | 'ativo' | 'erro'

export interface PosicaoGps {
  lat: number
  lng: number
  precisao: number
  velocidade: number | null
  timestamp: number
}

export interface EstadoGps {
  status: StatusGps
  posicao: PosicaoGps | null
  erro: string | null
}

type Listener = (estado: EstadoGps) => void

let watchId: number | null = null
let estado: EstadoGps = { status: 'inativo', posicao: null, erro: null }
const listeners = new Set<Listener>()

// Heartbeat: enquanto o GPS estiver ativo, reenviamos a última posição a cada
// 5s. Isso atualiza o `last_seen` na tabela `locations` e impede que outros
// clientes considerem o agente expirado (TTL = 10s no wsClient/MapaOcorrencias).
let heartbeatId: ReturnType<typeof setInterval> | null = null
const HEARTBEAT_MS = 5_000

// Identidade do dispositivo — espelha a lógica que existia em MapaOcorrencias
function getDispositivoId(): string {
  let id = sessionStorage.getItem('defesacivil-device-id')
  if (!id) {
    id = Math.random().toString(36).substring(2, 9).toUpperCase()
    sessionStorage.setItem('defesacivil-device-id', id)
  }
  return id
}

function getNomeAgente(): string {
  const nome = (
    sessionStorage.getItem('defesacivil-agente-sessao') ||
    localStorage.getItem('defesacivil-device-nome') ||
    `Equipe ${getDispositivoId()}`
  )
  return normalizarNomeAgente(nome)
}

function notificar() {
  for (const l of listeners) {
    try { l(estado) } catch { /* ignore */ }
  }
}

function setEstado(parcial: Partial<EstadoGps>) {
  estado = { ...estado, ...parcial }
  notificar()
}

function enviarPosicao(p: PosicaoGps) {
  wsSend({
    tipo: 'posicao',
    id: getDispositivoId(),
    nome: getNomeAgente(),
    lat: p.lat,
    lng: p.lng,
    precisao: p.precisao,
    velocidade: p.velocidade,
  })
}

function aceitarPosicao(pos: GeolocationPosition, origem: 'rapida' | 'watch') {
  const nova: PosicaoGps = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    precisao: pos.coords.accuracy,
    velocidade: pos.coords.speed,
    timestamp: pos.timestamp || Date.now(),
  }

  // Se já temos uma posição mais recente do watch, ignora a "rápida cacheada"
  if (origem === 'rapida' && estado.posicao && estado.posicao.timestamp >= nova.timestamp) {
    return
  }
  // Se a posição cacheada é muito antiga (>2min), não usa — evita mostrar
  // localização errada se o agente se moveu desde a última vez
  if (origem === 'rapida' && Date.now() - nova.timestamp > 2 * 60 * 1000) {
    return
  }

  setEstado({ status: 'ativo', posicao: nova, erro: null })
  enviarPosicao(nova)
}

function iniciarHeartbeat() {
  if (heartbeatId !== null) return
  heartbeatId = setInterval(() => {
    if (estado.status !== 'ativo' || !estado.posicao) return
    enviarPosicao(estado.posicao)
  }, HEARTBEAT_MS)
}

function pararHeartbeat() {
  if (heartbeatId !== null) {
    clearInterval(heartbeatId)
    heartbeatId = null
  }
}

export function ativarGps() {
  if (!navigator.geolocation) {
    setEstado({ status: 'erro', erro: 'GPS não suportado neste dispositivo.' })
    return
  }

  // Idempotente: se já está ativo/aguardando, não recria o watch
  if (watchId !== null) {
    setEstado({ status: estado.posicao ? 'ativo' : 'aguardando', erro: null })
    return
  }

  setEstado({ status: 'aguardando', erro: null, posicao: null })

  // IMPORTANTE: no iOS o watchPosition deve ser chamado de forma SÍNCRONA
  // dentro do gesto do usuário. Nada de await antes.
  watchId = navigator.geolocation.watchPosition(
    (pos) => aceitarPosicao(pos, 'watch'),
    (err) => {
      // TIMEOUT (3) → o watch continua, é só "ainda não conseguiu" → não desliga
      if (err.code === err.TIMEOUT) {
        setEstado({ erro: 'Procurando sinal de GPS… (céu aberto melhora a precisão)' })
      } else {
        setEstado({ status: 'erro', erro: mensagemErroGps(err) })
      }
    },
    { enableHighAccuracy: true, timeout: 60000, maximumAge: 0 }
  )

  // Em paralelo: tenta uma posição rápida cacheada (até 30s velha) para
  // que outros agentes te vejam em segundos enquanto o GPS preciso trava.
  // Se o watch entregar antes, essa é descartada (timestamp mais velho).
  navigator.geolocation.getCurrentPosition(
    (pos) => aceitarPosicao(pos, 'rapida'),
    () => { /* silencioso — o watch é a fonte oficial */ },
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 30000 }
  )

  // Heartbeat: reenvia a posição a cada 5s pra atualizar last_seen na
  // tabela `locations` e impedir expiração nos outros clientes.
  iniciarHeartbeat()
}

export function desativarGps() {
  pararHeartbeat()
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
  setEstado({ status: 'inativo', posicao: null, erro: null })
  // wsSend('parar') no wsClient marca is_active=false na tabela `locations`
  // E faz broadcast 'gps-off' imediato — outros agentes removem o marcador
  // na hora, sem esperar a expiração de 10s.
  wsSend({ tipo: 'parar', id: getDispositivoId() })
}

export function toggleGps() {
  if (estado.status === 'ativo' || estado.status === 'aguardando') desativarGps()
  else ativarGps()
}

export function getEstadoGps(): EstadoGps {
  return estado
}

export function subscribeGps(listener: Listener): () => void {
  listeners.add(listener)
  // Notifica o estado atual imediatamente (síncrono — o consumidor já
  // sai com o snapshot correto sem precisar de useEffect extra)
  try { listener(estado) } catch { /* ignore */ }
  return () => { listeners.delete(listener) }
}

export function getDispositivoIdGlobal(): string {
  return getDispositivoId()
}

export function getNomeAgenteGlobal(): string {
  return getNomeAgente()
}

// ── Aviso ao fechar aba / sair do app no celular ─────────────────────────
// pagehide cobre fechamento de aba E "voltar pra home" no iOS/Android.
// Sem isso, o Presence do Supabase aguarda timeout (~30s) pra emitir leave
// e o agente vira "fantasma" no mapa dos outros por meio minuto.
if (typeof window !== 'undefined') {
  const aoSair = () => {
    if (watchId !== null) {
      try { wsSend({ tipo: 'parar', id: getDispositivoId() }) } catch { /* ignore */ }
    }
  }
  window.addEventListener('pagehide', aoSair)
  window.addEventListener('beforeunload', aoSair)
}
