import { useEffect, useRef, useState } from 'react'
import { wsOn, wsSend, wsOnOpen } from './wsClient'
import { getAgenteLogado } from './components/Login'

export interface SosMensagem {
  agente: string
  texto: string
  audio?: string | null
  ts: number
}

export interface SosAlerta {
  id: string
  agente: string
  lat: number | null
  lng: number | null
  bateria: number | null
  audio: string | null
  timestamp: number
  visualizadores?: string[]
  mensagens?: SosMensagem[]
}

const TTL_MS = 60 * 60 * 1000

async function lerBateria(): Promise<number | null> {
  try {
    const nav: any = navigator
    if (typeof nav.getBattery === 'function') {
      const bat = await nav.getBattery()
      return Math.round((bat.level ?? 0) * 100)
    }
  } catch {}
  return null
}

// Leitura de GPS otimizada para o SOS.
function lerGps(): Promise<{ lat: number; lng: number; precisa: boolean } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    let resolvido = false
    let melhorCache: { lat: number; lng: number } | null = null

    const finalizar = (valor: { lat: number; lng: number; precisa: boolean } | null) => {
      if (resolvido) return
      resolvido = true
      resolve(valor)
    }

    const timerLimite = setTimeout(() => {
      if (melhorCache) finalizar({ ...melhorCache, precisa: false })
      else finalizar(null)
    }, 8000)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        melhorCache = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      },
      () => {},
      { enableHighAccuracy: false, timeout: 2500, maximumAge: 10000 },
    )

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timerLimite)
        finalizar({ lat: pos.coords.latitude, lng: pos.coords.longitude, precisa: true })
      },
      () => {
        clearTimeout(timerLimite)
        if (melhorCache) finalizar({ ...melhorCache, precisa: false })
        else finalizar(null)
      },
      { enableHighAccuracy: true, timeout: 7500, maximumAge: 0 },
    )
  })
}

// Handle retornado por `iniciarGravacaoAudio`.
export type GravacaoHandle = {
  audioPromise: Promise<string | null>
  abortar: () => void
}

// Abre o microfone e começa a gravar.
// Bitrate fixo em 24kbps (qualidade de voz).
export async function iniciarGravacaoAudio(durMs = 10000): Promise<GravacaoHandle | null> {
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return null
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const tipos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    const mime = tipos.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
    const opts: MediaRecorderOptions = { audioBitsPerSecond: 24000 }
    if (mime) opts.mimeType = mime
    const rec = new MediaRecorder(stream, opts)
    const pedacos: BlobPart[] = []
    let abortado = false
    rec.ondataavailable = (e) => { if (e.data.size > 0) pedacos.push(e.data) }

    const audioPromise = new Promise<string | null>((resolve) => {
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (abortado) return resolve(null)
        const blob = new Blob(pedacos, { type: mime || 'audio/webm' })
        if (blob.size === 0) return resolve(null)
        const reader = new FileReader()
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      }
    })

    rec.start()
    const timer = setTimeout(() => { try { rec.stop() } catch {} }, durMs)

    return {
      audioPromise,
      abortar: () => {
        abortado = true
        clearTimeout(timer)
        try { rec.stop() } catch {}
      },
    }
  } catch (e) {
    console.warn('[SOS] sem permissão de áudio:', e)
    return null
  }
}

function enviarSosTodosOsCanais(payload: Record<string, unknown>) {
  try { wsSend(payload) } catch { /* ignore */ }
}

// Status reportado durante o SOS.
export type FaseSos = 'gravando' | 'audio_falhou'
export interface StatusSos {
  fase: FaseSos
  segundosRestantes?: number
}

const DURACAO_AUDIO_MS = 10_000

export type DisparoEmCurso = {
  alertaEnviado: Promise<SosAlerta | null>
  alerta: Promise<SosAlerta | null>
  abortar: () => void
}

// ─── FLUXO DO SOS ─────────────────────────────────────────────────────────────
// 1. Abre microfone IMEDIATAMENTE e mostra contagem regressiva de 10 s.
// 2. Em paralelo, obtém GPS e bateria enquanto o agente grava.
// 3. Aguarda os 10 s completos de gravação.
// 4. SÓ ENTÃO dispara o SOS com áudio + GPS — assim os outros agentes
//    recebem o alerta completo de uma vez só.
// ─────────────────────────────────────────────────────────────────────────────
export function dispararSos(
  agente: string,
  onStatus?: (s: StatusSos) => void,
): DisparoEmCurso {
  const id = `sos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const timestamp = Date.now()

  let abortado = false
  let abortarGravacao: (() => void) | null = null

  let resolverEnviado!: (v: SosAlerta | null) => void
  const alertaEnviadoPromise = new Promise<SosAlerta | null>((res) => { resolverEnviado = res })

  const alertaFinalPromise = (async (): Promise<SosAlerta | null> => {
    // 1. Abre microfone imediatamente
    const gravacao = await iniciarGravacaoAudio(DURACAO_AUDIO_MS)
    if (abortado) { gravacao?.abortar(); resolverEnviado(null); return null }

    let audio: string | null = null

    if (gravacao) {
      abortarGravacao = gravacao.abortar

      // Mostra contagem regressiva a partir do momento que o mic está ativo
      let restantes = Math.ceil(DURACAO_AUDIO_MS / 1000)
      onStatus?.({ fase: 'gravando', segundosRestantes: restantes })
      const tick = setInterval(() => {
        restantes -= 1
        if (restantes <= 0) clearInterval(tick)
        else onStatus?.({ fase: 'gravando', segundosRestantes: restantes })
      }, 1000)

      // 2. Obtém GPS e bateria EM PARALELO enquanto o agente fala
      const [gps, bateria, audioGravado] = await Promise.all([
        lerGps(),
        lerBateria(),
        gravacao.audioPromise,
      ])
      clearInterval(tick)

      if (abortado) { resolverEnviado(null); return null }

      audio = audioGravado

      // 3. Envia o SOS completo (com áudio + GPS) após os 10 s de gravação
      const alerta: SosAlerta = {
        id, agente,
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
        bateria,
        audio,
        timestamp,
      }
      enviarSosTodosOsCanais({ tipo: 'sos', ...alerta })
      resolverEnviado(alerta)

      return alerta

    } else {
      // Sem microfone: notifica e envia somente com GPS
      onStatus?.({ fase: 'audio_falhou' })
      const [gps, bateria] = await Promise.all([lerGps(), lerBateria()])
      if (abortado) { resolverEnviado(null); return null }
      const alertaSemAudio: SosAlerta = {
        id, agente,
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
        bateria,
        audio: null,
        timestamp,
      }
      enviarSosTodosOsCanais({ tipo: 'sos', ...alertaSemAudio })
      resolverEnviado(alertaSemAudio)
      return alertaSemAudio
    }
  })()

  return {
    alertaEnviado: alertaEnviadoPromise,
    alerta: alertaFinalPromise,
    abortar: () => {
      abortado = true
      if (abortarGravacao) try { abortarGravacao() } catch {}
    },
  }
}

// ─── Persistência local de SOS já dispensados ──────────────────────────────
const STORAGE_DISPENSADOS = 'sos_dispensados_v1'

function lerDispensados(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_DISPENSADOS)
    if (!raw) return {}
    const obj = JSON.parse(raw) as Record<string, number>
    const agora = Date.now()
    let mudou = false
    for (const id of Object.keys(obj)) {
      if (typeof obj[id] !== 'number' || obj[id] < agora) {
        delete obj[id]
        mudou = true
      }
    }
    if (mudou) localStorage.setItem(STORAGE_DISPENSADOS, JSON.stringify(obj))
    return obj
  } catch { return {} }
}

function marcarDispensado(id: string) {
  try {
    const atual = lerDispensados()
    atual[id] = Date.now() + TTL_MS
    localStorage.setItem(STORAGE_DISPENSADOS, JSON.stringify(atual))
  } catch { /* ignore */ }
}

function esquecerDispensado(id: string) {
  try {
    const atual = lerDispensados()
    if (atual[id] != null) {
      delete atual[id]
      localStorage.setItem(STORAGE_DISPENSADOS, JSON.stringify(atual))
    }
  } catch { /* ignore */ }
}

function foiDispensado(id: string): boolean {
  return id in lerDispensados()
}

async function mostrarNotificacaoSos(a: SosAlerta) {
  if (typeof window === 'undefined' || !('Notification' in window)) return

  const titulo = `🚨 SOS — ${a.agente}`
  const corpo = a.lat != null
    ? 'Localização disponível. Toque para abrir o app.'
    : 'Agente precisa de socorro!'
  const opcoes: NotificationOptions = {
    body: corpo,
    tag: `sos-${a.id}`,
    icon: '/icon-192.png',
    requireInteraction: true,
  }

  async function disparar() {
    try {
      new Notification(titulo, opcoes)
    } catch {
      try {
        const reg = await navigator.serviceWorker.ready
        await reg.showNotification(titulo, opcoes)
      } catch { /* ignore */ }
    }
  }

  if (Notification.permission === 'granted') {
    disparar()
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then(p => { if (p === 'granted') disparar() })
  }
}

export function useSosListener() {
  const [alertas, setAlertas] = useState<SosAlerta[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  function adicionarAlerta(a: SosAlerta, notificar = true) {
    if (!a?.id) return
    if (foiDispensado(a.id)) return
    const meuNome = getAgenteLogado()
    if (meuNome && a.agente && a.agente === meuNome) return
    const isNovo = !timersRef.current.has(a.id)
    setAlertas((prev) => {
      const idx = prev.findIndex(x => x.id === a.id)
      if (idx >= 0) {
        const atualizado = [...prev]
        atualizado[idx] = { ...prev[idx], ...a, audio: a.audio ?? prev[idx].audio }
        return atualizado
      }
      return [...prev, a]
    })
    if (isNovo) {
      if (notificar) mostrarNotificacaoSos(a)
      const t = setTimeout(() => removerLocal(a.id), TTL_MS)
      timersRef.current.set(a.id, t)
    }
  }

  useEffect(() => {
    const offSos = wsOn('sos', (msg) => {
      adicionarAlerta(msg as unknown as SosAlerta)
    })

    const offPersistidos = wsOn('sos_persistidos', (msg) => {
      const lista = (msg as any).alertas as SosAlerta[]
      if (!Array.isArray(lista)) return
      lista.forEach(a => adicionarAlerta(a, false))
    })

    const offAudio = wsOn('sos-audio', (msg) => {
      const id = msg.id as string
      const audio = msg.audio as string
      if (!id || !audio) return
      setAlertas(prev => prev.map(x => x.id === id ? { ...x, audio } : x))
    })

    const offCancelar = wsOn('sos-cancelar', (msg) => {
      const id = msg.id as string | undefined
      if (!id) return
      esquecerDispensado(id)
      removerLocal(id)
    })

    const offVisualizado = wsOn('sos-visualizado', (msg) => {
      const { id, visualizadores } = msg as { id: string; visualizadores: string[] }
      if (!id) return
      setAlertas(prev => prev.map(a => a.id === id ? { ...a, visualizadores } : a))
    })

    const offMensagem = wsOn('sos-nova-mensagem', (msg) => {
      const { id, mensagens } = msg as { id: string; mensagens: SosMensagem[] }
      if (!id) return
      setAlertas(prev => prev.map(a => a.id === id ? { ...a, mensagens } : a))
    })

    // Fallback: sos-mensagem direto via Supabase Realtime (sem servidor Express)
    const offSosMensagemDireto = wsOn('sos-mensagem', (msg) => {
      const { id, agente, texto, audio, ts } = msg as Record<string, unknown>
      if (!id) return
      setAlertas(prev => prev.map(a => {
        if (a.id !== id) return a
        const msgs = a.mensagens ?? []
        if (msgs.some(m => m.ts === (ts as number) && m.agente === agente)) return a
        return { ...a, mensagens: [...msgs, { agente: agente as string, texto: (texto as string) || '', audio: (audio as string | null) ?? null, ts: ts as number }] }
      }))
    })

    const offOpen = wsOnOpen(() => {
      wsSend({ tipo: 'solicitar_estado' })
    })

    return () => {
      offSos()
      offPersistidos()
      offAudio()
      offCancelar()
      offVisualizado()
      offMensagem()
      offSosMensagemDireto()
      offOpen()
      timersRef.current.forEach(t => clearTimeout(t))
      timersRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function removerLocal(id: string) {
    const t = timersRef.current.get(id)
    if (t) { clearTimeout(t); timersRef.current.delete(id) }
    setAlertas(prev => prev.filter(x => x.id !== id))
  }

  function dispensar(id: string) {
    marcarDispensado(id)
    removerLocal(id)
  }

  return { alertas, dispensar }
}

let _sirene: { ctx: AudioContext; osc: OscillatorNode; gain: GainNode; lfo: number } | null = null

export function tocarSirene() {
  pararSirene()
  try {
    const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.value = 700
    gain.gain.value = 0.15
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    let alta = true
    const lfo = window.setInterval(() => {
      try {
        osc.frequency.exponentialRampToValueAtTime(alta ? 1100 : 600, ctx.currentTime + 0.18)
        alta = !alta
      } catch {}
    }, 220)
    _sirene = { ctx, osc, gain, lfo }
  } catch (e) {
    console.warn('[SOS] sem áudio:', e)
  }
}

export function pararSirene() {
  if (!_sirene) return
  try {
    clearInterval(_sirene.lfo)
    _sirene.osc.stop()
    _sirene.ctx.close()
  } catch {}
  _sirene = null
}

export function vibrarLongo() {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate([400, 150, 400, 150, 800])
    }
  } catch {}
}

export const EVT_ROTA_RESGATE = 'sos-rota-resgate'

export function rotaParaResgate(lat: number, lng: number) {
  window.dispatchEvent(new CustomEvent(EVT_ROTA_RESGATE, { detail: { lat, lng } }))
}
