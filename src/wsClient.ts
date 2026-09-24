import { dispararPushSos } from './pushNotifications'
import { supabase, supabaseDisponivel } from './supabaseClient'
import { normalizarNomeAgente } from './types'

type WsHandler = (msg: Record<string, unknown>) => void
type OpenHandler = () => void

const handlers = new Map<string, Set<WsHandler>>()
const openHandlers = new Set<OpenHandler>()

let ws: WebSocket | null = null
let isOpen = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null

function iniciarPingOnline() {
  if (pingTimer) clearInterval(pingTimer)
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const id = getMeuId()
      const nome = getMeuNome()
      ws.send(JSON.stringify({ tipo: 'online_ping', id, nome }))
    }
  }, 30_000)
}

// Mapa local de agentes online para o path Supabase Realtime
const sbAgentesOnline = new Map<string, { nome: string; ts: number }>()
const SB_ONLINE_TTL = 75_000

function emitirSbOnlineSync() {
  const agora = Date.now()
  const agentes: { id: string; nome: string }[] = []
  for (const [id, info] of sbAgentesOnline) {
    if (agora - info.ts <= SB_ONLINE_TTL) agentes.push({ id, nome: info.nome })
    else sbAgentesOnline.delete(id)
  }
  dispatch('online_sync', { tipo: 'online_sync', agentes })
}

// Deduplicação de mensagens recebidas por ambos os transportes
const recentMsgIds = new Set<string>()
function novaMsg(key: string): boolean {
  if (recentMsgIds.has(key)) return false
  recentMsgIds.add(key)
  if (recentMsgIds.size > 200) {
    const primeiro = recentMsgIds.values().next().value
    if (primeiro) recentMsgIds.delete(primeiro)
  }
  return true
}

function getMeuId(): string {
  let id = sessionStorage.getItem('defesacivil-device-id')
  if (!id) {
    id = localStorage.getItem('defesacivil-device-id') || ''
    if (!id) {
      id = Math.random().toString(36).substring(2, 9).toUpperCase()
    }
    sessionStorage.setItem('defesacivil-device-id', id)
  }
  try {
    if (localStorage.getItem('defesacivil-device-id') !== id) {
      localStorage.setItem('defesacivil-device-id', id)
    }
  } catch { /* ignore */ }
  return id
}

function getMeuNome(): string {
  const nome = (
    sessionStorage.getItem('defesacivil-agente-sessao') ||
    localStorage.getItem('defesacivil-device-nome') ||
    `Equipe ${getMeuId()}`
  )
  return normalizarNomeAgente(nome)
}

function dispatch(tipo: string, msg: Record<string, unknown>) {
  const set = handlers.get(tipo)
  if (set) set.forEach(h => { try { h(msg) } catch { /* ignore */ } })
  const all = handlers.get('*')
  if (all) all.forEach(h => { try { h(msg) } catch { /* ignore */ } })
  try {
    window.dispatchEvent(new MessageEvent('ws-message', { data: JSON.stringify(msg) }))
  } catch { /* ignore */ }
}

function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return

  ws = new WebSocket(getWsUrl())

  ws.onopen = () => {
    isOpen = true
    const id = getMeuId()
    const nome = getMeuNome()
    ws!.send(JSON.stringify({ tipo: 'online', id, nome }))
    openHandlers.forEach(h => { try { h() } catch { /* ignore */ } })
    iniciarPingOnline()
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as Record<string, unknown>
      const tipo = msg.tipo as string
      if (!tipo) return
      const dedupKey = `${tipo}-${msg.id ?? msg.ts ?? JSON.stringify(msg).slice(0, 60)}`
      if (!novaMsg(dedupKey)) return
      dispatch(tipo, msg)
    } catch { /* ignore */ }
  }

  ws.onclose = () => {
    isOpen = false
    ws = null
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, 3000)
    }
  }

  ws.onerror = () => {
    ws?.close()
  }
}

// ─── Supabase Realtime broadcast (Netlify — sem servidor WS) ─────────────────

let sbChannel: ReturnType<typeof supabase.channel> | null = null
let sbPresenceTracked = false

function conectarSupabaseRealtime() {
  if (!supabaseDisponivel) return
  if (sbChannel) return

  const id = getMeuId()
  const nome = getMeuNome()

  sbChannel = supabase.channel('defesa-civil', {
    config: { broadcast: { self: false }, presence: { key: id } },
  })

  sbChannel
    .on('broadcast', { event: 'msg' }, ({ payload }: { payload: Record<string, unknown> }) => {
      const tipo = payload?.tipo as string
      if (!tipo) return

      // Atualização instantânea de agentes online/offline sem esperar o presence sync
      if (tipo === 'online' && payload.id) {
        const agId = String(payload.id)
        const agNome = String(payload.nome || agId)
        sbAgentesOnline.set(agId, { nome: agNome, ts: Date.now() })
        emitirSbOnlineSync()
        // Não deduplica — também despacha normalmente para outros handlers
      }
      if (tipo === 'offline' && payload.id) {
        sbAgentesOnline.delete(String(payload.id))
        emitirSbOnlineSync()
        return
      }
      if (tipo === 'remover' && payload.id) {
        sbAgentesOnline.delete(String(payload.id))
        emitirSbOnlineSync()
        return
      }
      if (tipo === 'parar' && payload.id) {
        sbAgentesOnline.delete(String(payload.id))
        emitirSbOnlineSync()
        dispatch('remover', { tipo: 'remover', id: payload.id })
        return
      }

      const dedupKey = buildDedupKey(tipo, payload)
      if (!novaMsg(dedupKey)) return
      dispatch(tipo, payload)
    })
    .on('presence', { event: 'sync' }, () => {
      if (!sbChannel) return
      const state = sbChannel.presenceState()
      const agentes: { id: string; nome: string }[] = []
      sbAgentesOnline.clear()
      for (const [presId, arr] of Object.entries(state)) {
        const first = (arr as Array<Record<string, unknown>>)[0] ?? {}
        const agNome = (first.nome as string) || `Equipe ${presId.slice(0, 4)}`
        sbAgentesOnline.set(presId, { nome: agNome, ts: Date.now() })
        agentes.push({ id: presId, nome: agNome })
      }
      dispatch('online_sync', { tipo: 'online_sync', agentes })
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }: { key: string; newPresences: Array<Record<string, unknown>> }) => {
      const agNome = (newPresences[0]?.nome as string) || `Equipe ${key.slice(0, 4)}`
      sbAgentesOnline.set(key, { nome: agNome, ts: Date.now() })
      emitirSbOnlineSync()
      dispatch('agente_entrou', { tipo: 'agente_entrou', id: key, nome: agNome })
    })
    .on('presence', { event: 'leave' }, ({ key, leftPresences }: { key: string; leftPresences: Array<Record<string, unknown>> }) => {
      sbAgentesOnline.delete(key)
      emitirSbOnlineSync()
      const agNome = (leftPresences[0]?.nome as string) || `Equipe ${key.slice(0, 4)}`
      dispatch('agente_saiu', { tipo: 'agente_saiu', id: key, nome: agNome })
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && sbChannel && !sbPresenceTracked) {
        sbPresenceTracked = true
        // Envia broadcast de online imediatamente — mais rápido que o presence sync
        sbChannel.send({
          type: 'broadcast',
          event: 'msg',
          payload: { tipo: 'online', id, nome },
        }).catch(() => {})
        await sbChannel.track({ nome })
        openHandlers.forEach(h => { try { h() } catch { /* ignore */ } })
        loadSosAtivos().catch(() => {})
      }
    })
}

function sbBroadcast(msg: Record<string, unknown>) {
  if (!sbChannel || !supabaseDisponivel) return
  sbChannel.send({ type: 'broadcast', event: 'msg', payload: msg }).catch(() => {})
}

// ─── SOS persistidos ─────────────────────────────────────────────────────────

async function loadSosAtivos() {
  try {
    const limiteTs = Date.now() - 60 * 60 * 1000
    let alertas: Record<string, unknown>[] = []
    const res = await fetch('/api/sos-ativos').catch(() => null)
    if (res?.ok) {
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('text/html')) {
        const data = await res.json()
        alertas = Array.isArray(data) ? data : []
      }
    }
    if (alertas.length === 0 && supabaseDisponivel) {
      const { data } = await supabase
        .from('sos_ativos_db')
        .select('id,agente,lat,lng,bateria,timestamp,visualizadores,mensagens')
        .gt('timestamp', limiteTs)
        .limit(20)
      alertas = data ?? []
    }
    const filtrados = alertas
      .filter((row) => Number(row.timestamp) > limiteTs)
      .map((row) => ({
        tipo: 'sos',
        id: row.id,
        agente: row.agente,
        lat: row.lat,
        lng: row.lng,
        bateria: row.bateria,
        audio: row.audio,
        timestamp: Number(row.timestamp),
        visualizadores: Array.isArray(row.visualizadores) ? row.visualizadores : [],
        mensagens: Array.isArray(row.mensagens) ? row.mensagens : [],
      }))
    if (filtrados.length > 0) {
      dispatch('sos_persistidos', { tipo: 'sos_persistidos', alertas: filtrados })
    }
  } catch (e) {
    console.warn('[wsClient] erro ao carregar SOS ativos:', e)
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

export function wsOn(tipo: string, handler: WsHandler): () => void {
  if (!handlers.has(tipo)) handlers.set(tipo, new Set())
  handlers.get(tipo)!.add(handler)
  connect()
  conectarSupabaseRealtime()
  return () => { handlers.get(tipo)?.delete(handler) }
}

export function wsOnOpen(handler: OpenHandler): () => void {
  openHandlers.add(handler)
  if (isOpen || sbPresenceTracked) {
    queueMicrotask(() => { try { handler() } catch { /* ignore */ } })
  } else {
    connect()
    conectarSupabaseRealtime()
  }
  return () => { openHandlers.delete(handler) }
}

export function wsSend(msg: Record<string, unknown>): void {
  connect()
  conectarSupabaseRealtime()
  const tipo = (msg as { tipo?: string }).tipo
  if (!tipo) return
  // Eventos de invalidação não têm ID próprio. O timestamp diferencia
  // alterações consecutivas e ainda permite deduplicar WS + Supabase.
  const mensagem = msg.id == null && msg.ts == null
    ? { ...msg, ts: Date.now() }
    : msg

  if (tipo === 'sos') {
    const { id, agente, lat, lng, bateria } = mensagem as Record<string, unknown>
    dispararPushSos({
      id: id as string,
      agente: agente as string,
      lat: lat as number | null,
      lng: lng as number | null,
      bateria: bateria as number | null,
    }).catch(() => {})
  }

  const dedupKey = buildDedupKey(tipo, mensagem)
  novaMsg(dedupKey)

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(mensagem))
  }

  sbBroadcast(mensagem)
}

// Chave de deduplicação específica por tipo de mensagem
function buildDedupKey(tipo: string, payload: Record<string, unknown>): string {
  // sos-mensagem: cada mensagem é identificada pelo alertaId + timestamp do envio
  // (evita que mensagens subsequentes ao mesmo alerta sejam descartadas)
  if (tipo === 'sos-mensagem') {
    return `sos-mensagem-${payload.id}-${payload.ts}`
  }
  return `${tipo}-${payload.id ?? payload.ts ?? JSON.stringify(payload).slice(0, 60)}`
}

export function wsConnect() {
  connect()
  conectarSupabaseRealtime()
  loadSosAtivos().catch(() => {})
}

export function wsAnunciarOnline() {
  connect()
  conectarSupabaseRealtime()
  const id = getMeuId()
  const nome = getMeuNome()
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ tipo: 'online', id, nome }))
  }
  // Broadcast Supabase imediato para outros verem online sem esperar presence
  sbBroadcast({ tipo: 'online', id, nome })
  if (sbChannel && sbPresenceTracked) {
    sbChannel.track({ nome }).catch(() => {})
  }
}

export function wsDisconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (ws) {
    const id = getMeuId()
    try { ws.send(JSON.stringify({ tipo: 'offline', id })) } catch { /* ignore */ }
    ws.close()
    ws = null
    isOpen = false
  }
  if (sbChannel) {
    const id = getMeuId()
    // Broadcast offline imediato — mais rápido que esperar o heartbeat expirar
    sbChannel.send({
      type: 'broadcast',
      event: 'msg',
      payload: { tipo: 'offline', id },
    }).catch(() => {})
    sbChannel.untrack().catch(() => {})
    sbChannel.unsubscribe().catch(() => {})
    sbChannel = null
    sbPresenceTracked = false
    sbAgentesOnline.clear()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try {
      const id = getMeuId()
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: 'offline', id }))
      }
      if (sbChannel) {
        sbChannel.send({
          type: 'broadcast',
          event: 'msg',
          payload: { tipo: 'offline', id },
        }).catch(() => {})
        sbChannel.untrack().catch(() => {})
      }
    } catch { /* ignore */ }
  })
}
