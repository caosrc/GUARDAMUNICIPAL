import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap, Circle, Polyline, CircleMarker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Ocorrencia } from '../types'
import { NATUREZA_ICONE, NATUREZA_COR } from '../types'
import { baixarMapaOffline, obterInfoCacheMapa, limparCacheMapa, type ProgressoMapa } from '../offline'
import { mensagemErroGps } from '../utils'

// Fix leaflet default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ── Dispositivo local ────────────────────────────────────────────
// ID usa sessionStorage → único por aba/celular (não compartilhado entre abas)
function getDispositivoId(): string {
  let id = sessionStorage.getItem('defesacivil-device-id')
  if (!id) {
    id = Math.random().toString(36).substring(2, 9).toUpperCase()
    sessionStorage.setItem('defesacivil-device-id', id)
  }
  return id
}
function getNomeDispositivo(): string {
  return localStorage.getItem('defesacivil-device-nome') || `Equipe ${getDispositivoId()}`
}
function salvarNomeDispositivo(nome: string) {
  localStorage.setItem('defesacivil-device-nome', nome.trim() || `Equipe ${getDispositivoId()}`)
}

// ── Ícones ──────────────────────────────────────────────────────
function criarIcone(natureza: string, selecionado = false, semGps = false) {
  const emoji = NATUREZA_ICONE[natureza] ?? '📋'
  const cor = NATUREZA_COR[natureza] ?? '#1a4b8c'
  const size = selecionado ? 46 : 38
  const borda = selecionado
    ? `3px solid white`
    : semGps ? `2px dashed rgba(255,255,255,0.75)` : `2px solid white`
  const etiqueta = semGps
    ? `<div style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);
        background:rgba(0,0,0,0.65);color:white;font-size:7px;padding:1px 4px;
        border-radius:3px;white-space:nowrap;font-family:sans-serif;letter-spacing:0.03em;">
        📍 sem GPS</div>`
    : ''
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;">
      <div style="
        background:${cor};width:${size}px;height:${size}px;
        border-radius:50% 50% 50% 0;transform:rotate(-45deg);
        border:${borda};
        box-shadow:${selecionado ? '0 0 0 3px ' + cor + ', 0 4px 12px rgba(0,0,0,0.5)' : '0 2px 6px rgba(0,0,0,0.35)'};
        display:flex;align-items:center;justify-content:center;
        opacity:${semGps ? 0.78 : 1};
      "><span style="transform:rotate(45deg);font-size:${selecionado ? 22 : 18}px;line-height:1;">${emoji}</span></div>
      ${etiqueta}
    </div>`,
    iconSize: [size, size + (semGps ? 20 : 0)],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -(size + 4)],
  })
}

// Posição com deslocamento em espiral para ocorrências sem GPS
function coordsSemGps(id: number): [number, number] {
  const seed = Math.abs(id ?? 0)
  const angle = (seed * 137.508) * (Math.PI / 180)
  const r = 0.0012 + (seed % 20) * 0.00015
  return [
    OURO_BRANCO[0] + r * Math.cos(angle),
    OURO_BRANCO[1] + r * Math.sin(angle),
  ]
}

function criarIconeAgente(nome: string, cor = '#1a4b8c') {
  const nomeCurto = nome.length > 12 ? nome.slice(0, 12) + '…' : nome
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
      <div style="
        background:${cor};
        color:white;
        font-size:0.65rem;
        font-weight:700;
        padding:2px 7px;
        border-radius:10px;
        white-space:nowrap;
        box-shadow:0 2px 6px rgba(0,0,0,0.35);
        font-family:sans-serif;
        letter-spacing:0.02em;
      ">${nomeCurto}</div>
      <div style="
        width:38px;height:38px;border-radius:50%;
        background:${cor};border:3px solid white;
        box-shadow:0 0 0 3px ${cor}55, 0 4px 14px rgba(0,0,0,0.4);
        display:flex;align-items:center;justify-content:center;font-size:20px;
      ">🧑</div>
    </div>`,
    iconSize: [60, 62],
    iconAnchor: [30, 62],
    popupAnchor: [0, -66],
  })
}

// Cores para outros dispositivos (índice circular)
const CORES_EQUIPES = ['#dc2626', '#d97706', '#7c3aed', '#0891b2', '#059669', '#db2777']

function corParaDispositivo(_id: string, idx: number) {
  return CORES_EQUIPES[idx % CORES_EQUIPES.length]
}

// ── Componentes auxiliares ──────────────────────────────────────
function MapClickHandler({ onMapClick }: { onMapClick: () => void }) {
  useMapEvents({ click: onMapClick })
  return null
}

function GpsCenter({ position, seguir }: { position: [number, number]; seguir: boolean }) {
  const map = useMap()
  const initialRef = useRef(false)
  useEffect(() => {
    if (!initialRef.current) {
      map.flyTo(position, Math.max(map.getZoom(), 16), { duration: 1.2 })
      initialRef.current = true
    } else if (seguir) {
      map.panTo(position, { animate: true, duration: 0.5 })
    }
  }, [position, seguir, map])
  return null
}

// ── Tipos ───────────────────────────────────────────────────────
interface Props {
  ocorrencias: Ocorrencia[]
  onSelecionar: (o: Ocorrencia) => void
}

interface DispositivoRemoto {
  id: string
  nome: string
  lat: number
  lng: number
  precisao: number
  velocidade: number | null
  ultimaVez: number
  indice: number
}

type StatusGps = 'inativo' | 'aguardando' | 'ativo' | 'erro'
type StatusOffline = 'idle' | 'baixando' | 'concluido' | 'erro'
type StatusWs = 'desconectado' | 'conectando' | 'conectado'
type CamadaMapa = 'padrao' | 'satelite'

const OURO_BRANCO: [number, number] = [-20.5195, -43.6983]
const MAX_TRILHA = 300

// ── Componente principal ────────────────────────────────────────
export default function MapaOcorrencias({ ocorrencias, onSelecionar }: Props) {
  const [selecionada, setSelecionada] = useState<Ocorrencia | null>(null)
  const [legendaAberta, setLegendaAberta] = useState(false)
  const [camadaMapa, setCamadaMapa] = useState<CamadaMapa>('padrao')
  const [mostrarOcorrencias, setMostrarOcorrencias] = useState(false)

  // GPS local
  const [statusGps, setStatusGps] = useState<StatusGps>('inativo')
  const [erroGps, setErroGps] = useState<string | null>(null)
  const [posicaoAtual, setPosicaoAtual] = useState<[number, number] | null>(null)
  const [precisao, setPrecisao] = useState<number>(0)
  const [velocidade, setVelocidade] = useState<number | null>(null)
  const [trilha, setTrilha] = useState<[number, number][]>([])
  const [seguir, setSeguir] = useState(true)
  const watchIdRef = useRef<number | null>(null)

  // Dispositivos remotos (outros celulares)
  const [dispositivos, setDispositivos] = useState<Map<string, DispositivoRemoto>>(new Map())
  const [statusWs, setStatusWs] = useState<StatusWs>('desconectado')
  const [painelEquipesAberto, setPainelEquipesAberto] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const wsDesligandoRef = useRef(false)
  const proxIndiceRef = useRef(0)
  const indicesRef = useRef<Map<string, number>>(new Map())

  // Nome e ID do dispositivo local — usa o agente escolhido no login da sessão
  const [nomeLocal, setNomeLocal] = useState(() => {
    return sessionStorage.getItem('defesacivil-agente-sessao') || getNomeDispositivo()
  })
  const nomeLocalRef = useRef(nomeLocal)
  const [editandoNome, setEditandoNome] = useState(false)
  const [nomeEditando, setNomeEditando] = useState('')
  const dispositivoId = useRef(getDispositivoId())

  // Mapa offline
  const [statusOffline, setStatusOffline] = useState<StatusOffline>('idle')
  const [progressoMapa, setProgressoMapa] = useState<ProgressoMapa | null>(null)
  const [tilesCacheados, setTilesCacheados] = useState<number>(0)
  const [painelOfflineAberto, setPainelOfflineAberto] = useState(false)

  // Mantém ref sempre atualizada com o nome atual
  useEffect(() => { nomeLocalRef.current = nomeLocal }, [nomeLocal])

  const comGeo = useMemo(() => ocorrencias.filter((o) => o.lat && o.lng), [ocorrencias])
  const semGeo = ocorrencias.length - comGeo.length

  useEffect(() => {
    obterInfoCacheMapa().then(setTilesCacheados).catch(() => {})
  }, [statusOffline])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelecionada(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── WebSocket ─────────────────────────────────────────────────
  const getIndice = useCallback((id: string) => {
    if (!indicesRef.current.has(id)) {
      indicesRef.current.set(id, proxIndiceRef.current++)
    }
    return indicesRef.current.get(id)!
  }, [])

  const conectarWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return
    wsDesligandoRef.current = false
    setStatusWs('conectando')

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setStatusWs('conectado')
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)

        if (msg.tipo === 'posicoes_iniciais') {
          setDispositivos((prev) => {
            const next = new Map(prev)
            for (const p of msg.posicoes) {
              if (p.id === dispositivoId.current) continue
              next.set(p.id, { ...p, ultimaVez: Date.now(), indice: getIndice(p.id) })
            }
            return next
          })
        }

        if (msg.tipo === 'posicao') {
          if (msg.id === dispositivoId.current) return
          setDispositivos((prev) => {
            const next = new Map(prev)
            next.set(msg.id, { ...msg, ultimaVez: Date.now(), indice: getIndice(msg.id) })
            return next
          })
        }

        if (msg.tipo === 'remover') {
          setDispositivos((prev) => {
            const next = new Map(prev)
            next.delete(msg.id)
            return next
          })
        }
      } catch { /* ignora */ }
    }

    ws.onclose = () => {
      setStatusWs('desconectado')
      if (!wsDesligandoRef.current) {
        setTimeout(() => {
          if (!wsDesligandoRef.current) conectarWs()
        }, 1500)
      }
    }

    ws.onerror = () => {
      setStatusWs('desconectado')
    }
  }, [getIndice])

  useEffect(() => {
    conectarWs()
  }, [conectarWs])

  const enviarPosicao = useCallback((lat: number, lng: number, prec: number, vel: number | null) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        tipo: 'posicao',
        id: dispositivoId.current,
        nome: nomeLocalRef.current,
        lat, lng,
        precisao: prec,
        velocidade: vel,
      }))
    }
  }, [])

  // Cleanup ao desmontar
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
      wsDesligandoRef.current = true
      wsRef.current?.close()
    }
  }, [])

  // Heartbeat para manter a conexão viva
  useEffect(() => {
    const t = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ tipo: 'ping' }))
      }
    }, 30000)
    return () => clearInterval(t)
  }, [])

  // ── GPS ───────────────────────────────────────────────────────
  function ativarGps() {
    if (!navigator.geolocation) {
      setErroGps('GPS não suportado neste dispositivo.')
      setStatusGps('erro')
      return
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setStatusGps('aguardando')
    setErroGps(null)
    conectarWs()

    // IMPORTANTE: no iOS o watchPosition deve ser chamado de forma
    // síncrona dentro do handler do gesto do usuário. Qualquer await
    // antes desta chamada faz o iOS bloquear a permissão.
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        const prec = pos.coords.accuracy
        const vel = pos.coords.speed
        setPosicaoAtual(coords)
        setPrecisao(prec)
        setVelocidade(vel)
        setTrilha((prev) => {
          const nova = [...prev, coords]
          return nova.length > MAX_TRILHA ? nova.slice(nova.length - MAX_TRILHA) : nova
        })
        setErroGps(null)
        setStatusGps('ativo')
        enviarPosicao(coords[0], coords[1], prec, vel)
      },
      (err) => {
        setErroGps(mensagemErroGps(err))
        setStatusGps('erro')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
    )
  }

  function desativarGps() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ tipo: 'parar', id: dispositivoId.current }))
    }
    setStatusGps('inativo')
    setPosicaoAtual(null)
    setTrilha([])
    setVelocidade(null)
    setErroGps(null)
    setSeguir(true)
  }

  function toggleGps() {
    if (statusGps === 'ativo' || statusGps === 'aguardando') desativarGps()
    else ativarGps()
  }

  // ── Nome do dispositivo ────────────────────────────────────────
  function salvarNome() {
    const nome = nomeEditando.trim() || getNomeDispositivo()
    salvarNomeDispositivo(nome)
    setNomeLocal(getNomeDispositivo())
    setEditandoNome(false)
  }

  // ── Mapa offline ──────────────────────────────────────────────
  async function iniciarDownloadMapa() {
    if (statusOffline === 'baixando') return
    setStatusOffline('baixando')
    setProgressoMapa(null)
    try {
      await baixarMapaOffline((p) => {
        setProgressoMapa(p)
        if (p.status === 'concluido') setStatusOffline('concluido')
      })
    } catch {
      setStatusOffline('erro')
    }
  }

  async function limparMapa() {
    await limparCacheMapa()
    setTilesCacheados(0)
    setStatusOffline('idle')
    setProgressoMapa(null)
  }

  // ── Misc ──────────────────────────────────────────────────────
  function selecionarOc(o: Ocorrencia) {
    setSelecionada((prev) => (prev?.id === o.id ? null : o))
  }

  const naturezasUnicas = useMemo(() => [...new Set(comGeo.map((o) => o.natureza))], [comGeo])
  const velocidadeKmh = useMemo(
    () => velocidade != null ? Math.round(velocidade * 3.6) : null,
    [velocidade]
  )
  const porcentagem = useMemo(
    () => progressoMapa && progressoMapa.total > 0
      ? Math.round((progressoMapa.concluido / progressoMapa.total) * 100) : 0,
    [progressoMapa]
  )
  const dispositivosArray = useMemo(() => Array.from(dispositivos.values()), [dispositivos])
  const totalOnline = dispositivosArray.length + (statusGps === 'ativo' ? 1 : 0)

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="mapa-wrapper">
      <MapContainer
        center={OURO_BRANCO}
        zoom={14}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
        whenReady={() => {}}
      >
        {camadaMapa === 'padrao' ? (
          <TileLayer
            key="mapa-padrao"
            url="/api/tiles/{z}/{x}/{y}"
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

        <MapClickHandler onMapClick={() => setSelecionada(null)} />

        {/* Trilha GPS local */}
        {trilha.length >= 2 && (
          <Polyline
            positions={trilha}
            pathOptions={{ color: '#1a4b8c', weight: 4, opacity: 0.65, dashArray: '6 4' }}
          />
        )}

        {/* Círculo de precisão local */}
        {posicaoAtual && precisao > 0 && (
          <Circle
            center={posicaoAtual}
            radius={precisao}
            pathOptions={{ color: '#1a4b8c', fillColor: '#1a4b8c', fillOpacity: 0.08, weight: 1.5, opacity: 0.4 }}
          />
        )}

        {/* Marcador da viatura local */}
        {posicaoAtual && (
          <>
            <CircleMarker
              center={posicaoAtual}
              radius={22}
              pathOptions={{ color: '#1a4b8c', fillColor: 'rgba(26,75,140,0.18)', weight: 2, fillOpacity: 1 }}
            />
            <Marker position={posicaoAtual} icon={criarIconeAgente(nomeLocal, '#1a4b8c')} zIndexOffset={1000}>
              <Popup>
                <div style={{ minWidth: 155, fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 2 }}>🧑 {nomeLocal} (você)</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Precisão: ±{Math.round(precisao)} m</div>
                  {velocidadeKmh !== null && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Velocidade: {velocidadeKmh} km/h</div>
                  )}
                  <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 4 }}>
                    {posicaoAtual[0].toFixed(6)}, {posicaoAtual[1].toFixed(6)}
                  </div>
                </div>
              </Popup>
            </Marker>
            <GpsCenter position={posicaoAtual} seguir={seguir} />
          </>
        )}

        {/* Marcadores dos outros dispositivos */}
        {dispositivosArray.map((d) => {
          const cor = corParaDispositivo(d.id, d.indice)
          const velKmh = d.velocidade != null ? Math.round(d.velocidade * 3.6) : null
          const segsAtras = Math.round((Date.now() - d.ultimaVez) / 1000)
          return (
            <Marker
              key={d.id}
              position={[d.lat, d.lng]}
              icon={criarIconeAgente(d.nome, cor)}
              zIndexOffset={900}
            >
              <Popup>
                <div style={{ minWidth: 155, fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 2, color: cor }}>
                    🧑 {d.nome}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    Precisão: ±{Math.round(d.precisao)} m
                  </div>
                  {velKmh !== null && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Velocidade: {velKmh} km/h</div>
                  )}
                  <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 4 }}>
                    {d.lat.toFixed(6)}, {d.lng.toFixed(6)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#d1d5db', marginTop: 2 }}>
                    Atualizado há {segsAtras}s
                  </div>
                </div>
              </Popup>
            </Marker>
          )
        })}

        {/* Ocorrências — todas, com ou sem GPS */}
        {mostrarOcorrencias && ocorrencias.map((o) => {
          const temGps = !!(o.lat && o.lng)
          const pos: [number, number] = temGps ? [o.lat!, o.lng!] : coordsSemGps(o.id)
          return (
            <Marker
              key={o.id}
              position={pos}
              icon={criarIcone(o.natureza, selecionada?.id === o.id, !temGps)}
              eventHandlers={{
                click: (e) => { e.originalEvent.stopPropagation(); selecionarOc(o) },
              }}
            >
              <Popup>
                <div style={{ minWidth: 170, fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: 2 }}>
                    {NATUREZA_ICONE[o.natureza] ?? '📋'} {o.natureza}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: 4 }}>
                    {o.tipo} · {o.nivel_risco.charAt(0).toUpperCase() + o.nivel_risco.slice(1)}
                  </div>
                  {o.endereco && <div style={{ fontSize: '0.78rem', marginBottom: 4 }}>📍 {o.endereco}</div>}
                  {!temGps && (
                    <div style={{ fontSize: '0.72rem', color: '#b45309', marginBottom: 6 }}>
                      ⚠️ Sem coordenadas GPS — posição aproximada
                    </div>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onSelecionar(o) }}
                    style={{
                      width: '100%', background: '#E05F00', color: 'white',
                      border: 'none', borderRadius: 6, padding: '6px 0',
                      fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem',
                    }}
                  >
                    Ver detalhes completos
                  </button>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>

      {/* Top stats bar */}
      <div className="mapa-topbar">
        <div className="mapa-stat">
          <span className="mapa-stat-num">{ocorrencias.length}</span>
          <span className="mapa-stat-label">no mapa</span>
        </div>
        <div className="mapa-stat-div" />
        <div className="mapa-stat">
          <span className="mapa-stat-num" style={{ color: semGeo > 0 ? '#b45309' : undefined }}>{semGeo}</span>
          <span className="mapa-stat-label">sem GPS</span>
        </div>
        <div className="mapa-stat-div" />
        <div className="mapa-stat" style={{ cursor: 'pointer' }} onClick={() => setPainelEquipesAberto(v => !v)}>
          <span className="mapa-stat-num" style={{ color: totalOnline > 0 ? '#15803d' : undefined }}>
            {totalOnline}
          </span>
          <span className="mapa-stat-label">equipes</span>
        </div>
        <button className="mapa-legenda-btn" onClick={() => setLegendaAberta((v) => !v)}>
          🗂 Legenda
        </button>
      </div>

      <div className="mapa-camadas" aria-label="Escolher visualização do mapa">
        <button
          className={`mapa-camada-btn ${camadaMapa === 'padrao' ? 'ativo' : ''}`}
          onClick={() => setCamadaMapa('padrao')}
        >
          🗺️ Mapa
        </button>
        <button
          className={`mapa-camada-btn ${camadaMapa === 'satelite' ? 'ativo' : ''}`}
          onClick={() => setCamadaMapa('satelite')}
        >
          🛰️ Satélite
        </button>
        <button
          className={`mapa-camada-btn ${mostrarOcorrencias ? 'ativo' : ''}`}
          onClick={() => { setMostrarOcorrencias((v) => !v); setSelecionada(null) }}
        >
          📋 Ocorrências
        </button>
      </div>

      {/* Botão GPS */}
      <button
        className={`mapa-gps-btn mapa-gps-btn--${statusGps}`}
        onClick={toggleGps}
        title={statusGps === 'ativo' ? 'Desativar rastreamento GPS' : 'Ativar rastreamento GPS'}
      >
        {statusGps === 'aguardando' ? (
          <span className="mapa-gps-spinner" />
        ) : (
          <span className="mapa-gps-icon">
            {statusGps === 'ativo' ? '📡' : statusGps === 'erro' ? '⚠️' : '🛰️'}
          </span>
        )}
        <span className="mapa-gps-label">
          {statusGps === 'inativo' && 'GPS'}
          {statusGps === 'aguardando' && 'Aguardando…'}
          {statusGps === 'ativo' && 'GPS ativo'}
          {statusGps === 'erro' && 'Erro GPS'}
        </span>
      </button>

      {/* Botão download offline */}
      <button
        className={`mapa-offline-btn ${statusOffline === 'baixando' ? 'mapa-offline-btn--baixando' : statusOffline === 'concluido' ? 'mapa-offline-btn--ok' : ''}`}
        onClick={() => setPainelOfflineAberto((v) => !v)}
        title="Baixar mapa para uso offline"
      >
        <span>{statusOffline === 'baixando' ? '⏳' : statusOffline === 'concluido' ? '✅' : '📥'}</span>
        <span>{statusOffline === 'baixando' ? `${porcentagem}%` : statusOffline === 'concluido' ? 'Salvo offline' : 'Salvar offline'}</span>
      </button>

      {/* Painel equipes online */}
      {painelEquipesAberto && (
        <div className="mapa-equipes-painel">
          <div className="mapa-offline-painel-header">
            <span>📡 Equipes em campo</span>
            <button onClick={() => setPainelEquipesAberto(false)}>✕</button>
          </div>
          <div className="mapa-offline-painel-corpo">
            {/* Status WS */}
            <div className={`mapa-ws-status mapa-ws-status--${statusWs}`}>
              <span className="mapa-ws-dot" />
              {statusWs === 'conectado' ? 'Conectado ao servidor' : statusWs === 'conectando' ? 'Conectando…' : 'Desconectado'}
            </div>

            {/* Dispositivo local */}
            <div className="mapa-equipe-item mapa-equipe-item--local">
              <span className="mapa-equipe-icone" style={{ background: '#1a4b8c' }}>🧑</span>
              <div className="mapa-equipe-info">
                {editandoNome ? (
                  <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                    <input
                      className="mapa-equipe-nome-input"
                      value={nomeEditando}
                      onChange={(e) => setNomeEditando(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') salvarNome() }}
                      autoFocus
                      maxLength={20}
                      placeholder="Nome da equipe"
                    />
                    <button className="mapa-equipe-salvar" onClick={salvarNome}>✓</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span className="mapa-equipe-nome">{nomeLocal} <em>(você)</em></span>
                    <button className="mapa-equipe-editar" onClick={() => { setNomeEditando(nomeLocal); setEditandoNome(true) }}>✏️</button>
                  </div>
                )}
                <span className="mapa-equipe-status">
                  {statusGps === 'ativo' ? '🟢 GPS ativo' : statusGps === 'aguardando' ? '🟡 Aguardando GPS…' : '⚫ GPS desligado'}
                </span>
              </div>
            </div>

            {/* Outros dispositivos */}
            {dispositivosArray.length === 0 && statusGps !== 'ativo' && (
              <div className="mapa-offline-info mapa-offline-info--aviso">
                Você está conectado para ver outras equipes. Ative o GPS apenas se quiser aparecer no mapa delas.
              </div>
            )}
            {dispositivosArray.length === 0 && statusGps === 'ativo' && (
              <div className="mapa-offline-info" style={{ background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' }}>
                Aguardando outras equipes entrarem online…
              </div>
            )}
            {dispositivosArray.map((d) => {
              const cor = corParaDispositivo(d.id, d.indice)
              const segsAtras = Math.round((Date.now() - d.ultimaVez) / 1000)
              const velKmh = d.velocidade != null ? Math.round(d.velocidade * 3.6) : null
              return (
                <div key={d.id} className="mapa-equipe-item">
                  <span className="mapa-equipe-icone" style={{ background: cor }}>🧑</span>
                  <div className="mapa-equipe-info">
                    <span className="mapa-equipe-nome">{d.nome}</span>
                    <span className="mapa-equipe-status" style={{ color: '#6b7280' }}>
                      🟢 Ativo · {velKmh !== null ? `${velKmh} km/h` : 'parado'} · ±{Math.round(d.precisao)}m · {segsAtras}s atrás
                    </span>
                  </div>
                </div>
              )
            })}

            <div className="mapa-offline-aviso">
              Todas as equipes com GPS ativo aparecem aqui e no mapa em tempo real.
            </div>
          </div>
        </div>
      )}

      {/* Painel Download Mapa Offline */}
      {painelOfflineAberto && (
        <div className="mapa-offline-painel">
          <div className="mapa-offline-painel-header">
            <span>📥 Mapa Offline — Ouro Branco</span>
            <button onClick={() => setPainelOfflineAberto(false)}>✕</button>
          </div>
          <div className="mapa-offline-painel-corpo">
            <div className="mapa-offline-info" style={{ background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' }}>
              🌐 Com internet, o mapa carrega normalmente. Salve offline para usar sem conexão.
            </div>

            {tilesCacheados > 0 && (
              <div className="mapa-offline-info">
                ✅ {tilesCacheados.toLocaleString('pt-BR')} tiles salvos — mapa disponível offline
              </div>
            )}
            {tilesCacheados === 0 && statusOffline !== 'baixando' && (
              <div className="mapa-offline-info mapa-offline-info--aviso">
                📵 Mapa não salvo ainda. Sem internet o mapa ficará cinza.
              </div>
            )}
            {statusOffline === 'baixando' && progressoMapa && (
              <div className="mapa-offline-progresso">
                <div className="mapa-offline-barra-wrap">
                  <div className="mapa-offline-barra" style={{ width: `${porcentagem}%` }} />
                </div>
                <div className="mapa-offline-pct">
                  {porcentagem}% — {progressoMapa.concluido.toLocaleString('pt-BR')} / {progressoMapa.total.toLocaleString('pt-BR')} tiles
                </div>
              </div>
            )}
            {statusOffline !== 'baixando' && (
              <button
                className="mapa-offline-btn-acao"
                onClick={iniciarDownloadMapa}
                disabled={!navigator.onLine}
              >
                {navigator.onLine
                  ? tilesCacheados > 0 ? '🔄 Atualizar mapa offline' : '📥 Salvar mapa de Ouro Branco'
                  : '📵 Sem conexão para baixar'}
              </button>
            )}
            {tilesCacheados > 0 && statusOffline !== 'baixando' && (
              <button className="mapa-offline-btn-limpar" onClick={limparMapa}>
                🗑 Apagar mapa salvo
              </button>
            )}
            <div className="mapa-offline-aviso">
              Cobre apenas a área urbana de Ouro Branco — MG. O GPS funciona offline por hardware do aparelho.
            </div>
          </div>
        </div>
      )}

      {/* Painel GPS ativo */}
      {statusGps === 'ativo' && posicaoAtual && (
        <div className="mapa-gps-info">
          <div className="mapa-gps-info-row">
            <span className="mapa-gps-info-dot" />
            <span className="mapa-gps-info-text">
              {velocidadeKmh !== null ? `${velocidadeKmh} km/h` : 'Parado'}
            </span>
            <span className="mapa-gps-info-sep">·</span>
            <span className="mapa-gps-info-text">±{Math.round(precisao)} m</span>
            <span className="mapa-gps-info-sep">·</span>
            <span className="mapa-gps-info-text">{trilha.length} pts</span>
            {statusWs === 'conectado' && (
              <>
                <span className="mapa-gps-info-sep">·</span>
                <span className="mapa-gps-info-text" style={{ color: '#15803d' }}>
                  📡 {dispositivosArray.length + 1} equipe{dispositivosArray.length !== 0 ? 's' : ''}
                </span>
              </>
            )}
          </div>
          <button
            className={`mapa-gps-seguir ${seguir ? 'mapa-gps-seguir--ativo' : ''}`}
            onClick={() => setSeguir((v) => !v)}
          >
            {seguir ? '🔒 Seguindo' : '🔓 Livre'}
          </button>
        </div>
      )}

      {/* Erro GPS */}
      {statusGps === 'erro' && erroGps && (
        <div className="mapa-gps-erro">
          <div>
            <strong>⚠️ GPS não permitido</strong>
            <span>{erroGps}</span>
            <small>Depois de liberar no navegador/celular, toque no botão GPS novamente.</small>
          </div>
          <button onClick={() => setStatusGps('inativo')}>✕</button>
        </div>
      )}

      {/* Legenda */}
      {legendaAberta && (
        <div className="mapa-legenda">
          <div className="mapa-legenda-header">
            <span>Legenda</span>
            <button onClick={() => setLegendaAberta(false)}>✕</button>
          </div>
          <div className="mapa-legenda-lista">
            {naturezasUnicas.length === 0
              ? <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Nenhuma ocorrência com GPS</div>
              : naturezasUnicas.map((n) => (
                <div key={n} className="mapa-legenda-item">
                  <div className="mapa-legenda-dot" style={{ background: NATUREZA_COR[n] ?? '#1a4b8c' }}>
                    {NATUREZA_ICONE[n] ?? '📋'}
                  </div>
                  <span>{n}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Bottom panel — ocorrência selecionada */}
      {selecionada && (
        <div className="mapa-painel" onClick={(e) => e.stopPropagation()}>
          <div className="mapa-painel-handle" onClick={() => setSelecionada(null)} />
          <div className="mapa-painel-corpo">
            <div className="mapa-painel-topo">
              <div className="mapa-painel-icone" style={{ background: NATUREZA_COR[selecionada.natureza] ?? '#1a4b8c' }}>
                {NATUREZA_ICONE[selecionada.natureza] ?? '📋'}
              </div>
              <div className="mapa-painel-info">
                <div className="mapa-painel-natureza">{selecionada.natureza}</div>
                <div className="mapa-painel-tipo">{selecionada.tipo}</div>
              </div>
              <button className="mapa-painel-fechar" onClick={() => setSelecionada(null)}>✕</button>
            </div>
            <div className="mapa-painel-badges">
              <span className={`nivel-badge nivel-${selecionada.nivel_risco}`}>
                {selecionada.nivel_risco === 'baixo' ? '🟢 Baixo' : selecionada.nivel_risco === 'medio' ? '🟡 Médio' : '🔴 Alto'}
              </span>
              <span className={`status-badge status-${selecionada.status_oc}`}>
                {selecionada.status_oc === 'ativo' ? '🔴 Ativo' : '✅ Resolvido'}
              </span>
            </div>
            {selecionada.endereco && <div className="mapa-painel-end">📍 {selecionada.endereco}</div>}
            {selecionada.proprietario && <div className="mapa-painel-end">👤 {selecionada.proprietario}</div>}
            <div className="mapa-painel-data">🕐 {new Date(selecionada.created_at).toLocaleString('pt-BR')}</div>
            <button className="mapa-painel-btn" onClick={() => { onSelecionar(selecionada); setSelecionada(null) }}>
              Ver detalhes completos →
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
