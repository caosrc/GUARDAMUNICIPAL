import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMapEvents, useMap, Circle, Polyline, CircleMarker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Ocorrencia } from '../types'
import { NATUREZA_ICONE, NATUREZA_COR, NATUREZAS, normalizarNomeAgente } from '../types'
import {
  baixarMapaOffline,
  solicitarArmazenamentoPersistente,
  obterInfoCacheMapa,
  limparCacheMapa,
  baixarMalhaViariaOffline,
  obterInfoMalhaViaria,
  type ProgressoMapa,
  type ProgressoMalha,
} from '../offline'
import {
  buscarRuas,
  roteamentoLocal,
  malhaDisponivel,
  preAquecerMalha,
  descartarMalhaEmMemoria,
} from '../malhaViaria'
import { wsOn, wsSend, wsOnOpen } from '../wsClient'
import type { SosAlerta } from '../sos'
import {
  retomarGps as retomarGpsGlobal,
  subscribeGps,
  getEstadoGps,
} from '../gpsService'


interface DadosRadarChuva {
  host: string
  path: string
  tileUrl?: string
  frameTime: number
  atualizadoEm: string
  fonte: string
  tipoQuadro?: 'observado'
  cache?: boolean
  erroAtualizacao?: boolean
}

interface EstacaoCemadenMapa {
  id: number
  nome: string
  codigo: string
  latitude: number | null
  longitude: number | null
  precipitacaoAtual: number | null
  precipitacaoDataHora: string
}

// Serviço público NOAA/NNVL com imagens infravermelhas diárias do GOES.
// A variável de ambiente continua disponível para substituir a fonte padrão.
const GOES_CLOUD_TILE_URL = String(
  import.meta.env.VITE_GOES_CLOUD_TILES_URL
    || 'https://gis.nnvl.noaa.gov/arcgis/rest/services/GOES/GOES_current/ImageServer/tile/{z}/{y}/{x}',
).trim()
const ESTIMATIVA_CEMADEN_RAIO_METROS = 10_000
const CEMADEN_ESTACOES_ESPERADAS = new Set([4146, 4144, 3121, 6622, 4145, 4143, 4142])

function templateTilesHttpsValido(url: string): boolean {
  return /^https:\/\//i.test(url) && ['{z}', '{x}', '{y}'].every(token => url.includes(token))
}

function intensidadeCemaden(valor: number): { cor: string; alpha: number } {
  if (!Number.isFinite(valor) || valor <= 0) return { cor: '#38bdf8', alpha: 0 }
  if (valor <= 2) return { cor: '#38bdf8', alpha: 0.46 }
  if (valor <= 10) return { cor: '#22c55e', alpha: 0.48 }
  if (valor <= 30) return { cor: '#facc15', alpha: 0.5 }
  if (valor <= 50) return { cor: '#f97316', alpha: 0.54 }
  if (valor <= 80) return { cor: '#ef4444', alpha: 0.58 }
  return { cor: '#a855f7', alpha: 0.62 }
}

function valorChuvaFormatado(valor: number | null): string {
  return valor == null || !Number.isFinite(valor)
    ? 'Sem leitura'
    : `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`
}

function valorChuvaMarcadorFormatado(valor: number | null): string {
  const valorSeguro = valor != null && Number.isFinite(valor) ? valor : 0
  return `${valorSeguro.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`
}

function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const raioTerra = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return 2 * raioTerra * Math.asin(Math.sqrt(a))
}

function situacaoChuva(valor: number | null): string {
  if (valor == null || !Number.isFinite(valor) || valor <= 0) return 'Sem chuva'
  if (valor <= 2) return 'Fraca'
  if (valor <= 10) return 'Moderada'
  if (valor <= 30) return 'Forte'
  if (valor <= 80) return 'Muito forte'
  return 'Extrema'
}

function horaChuva(iso?: string | null): string {
  if (!iso) return '—'
  const data = new Date(iso)
  return Number.isNaN(data.getTime())
    ? '—'
    : data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function dataCemadenMapa(valor?: string | null): Date | null {
  const texto = String(valor || '').trim()
  if (!texto) return null
  const brasileiro = texto.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (brasileiro) {
    const ano = Number(brasileiro[3].length === 2 ? `20${brasileiro[3]}` : brasileiro[3])
    const data = new Date(Date.UTC(
      ano,
      Number(brasileiro[2]) - 1,
      Number(brasileiro[1]),
      Number(brasileiro[4]),
      Number(brasileiro[5]),
      Number(brasileiro[6] || 0),
    ))
    return Number.isNaN(data.getTime()) ? null : data
  }
  const isoSemFuso = texto.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/)
  const data = new Date(isoSemFuso ? `${isoSemFuso[1]}T${isoSemFuso[2]}Z` : texto)
  return Number.isNaN(data.getTime()) ? null : data
}

function idadeLeituraCemadenHoras(valor?: string | null): number | null {
  const data = dataCemadenMapa(valor)
  if (!data) return null
  return Math.max(0, (Date.now() - data.getTime()) / (60 * 60 * 1000))
}

function statusLeituraCemaden(valor?: string | null): 'atualizada' | 'atrasada' | 'sem-dados' {
  const idade = idadeLeituraCemadenHoras(valor)
  if (idade == null) return 'sem-dados'
  if (idade <= 3) return 'atualizada'
  if (idade <= 24) return 'atrasada'
  return 'sem-dados'
}

function dataHoraCemadenFormatada(valor?: string | null): string {
  const data = dataCemadenMapa(valor)
  return data
    ? data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
    : valor || 'Sem horário'
}

function CemadenIntensityLayer({
  estacoes,
  opacidade,
}: {
  estacoes: EstacaoCemadenMapa[]
  opacidade: number
}) {
  const map = useMap()

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.className = 'mapa-cemaden-superficie'
    canvas.setAttribute('aria-hidden', 'true')
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '430',
      opacity: String(opacidade),
    })
    map.getContainer().appendChild(canvas)
    const contexto = canvas.getContext('2d')
    if (!contexto) return () => canvas.remove()

    const pontos = estacoes
      .filter((estacao) =>
        Number.isFinite(estacao.latitude) &&
        Number.isFinite(estacao.longitude) &&
        Number.isFinite(estacao.precipitacaoAtual) &&
        (estacao.precipitacaoAtual || 0) >= 0,
      )
      .map((estacao) => ({
        lat: estacao.latitude as number,
        lng: estacao.longitude as number,
        valor: estacao.precipitacaoAtual as number,
      }))
    const centro = CONSELHEIRO_LAFAIETE
    const raio = ESTIMATIVA_CEMADEN_RAIO_METROS
    const passos = 72

    const desenhar = () => {
      const tamanho = map.getSize()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(tamanho.x * dpr))
      canvas.height = Math.max(1, Math.round(tamanho.y * dpr))
      contexto.setTransform(dpr, 0, 0, dpr, 0, 0)
      contexto.clearRect(0, 0, tamanho.x, tamanho.y)
      if (pontos.length === 0) return

      const deltaLat = raio / 111_320
      const deltaLng = raio / (111_320 * Math.cos(centro[0] * Math.PI / 180))
      const noroeste = map.latLngToContainerPoint([centro[0] + deltaLat, centro[1] - deltaLng])
      const sudeste = map.latLngToContainerPoint([centro[0] - deltaLat, centro[1] + deltaLng])
      const largura = sudeste.x - noroeste.x
      const altura = sudeste.y - noroeste.y
      if (largura <= 0 || altura <= 0) return

      const centroTela = map.latLngToContainerPoint(centro)
      const bordaTela = map.latLngToContainerPoint([centro[0] + deltaLat, centro[1]])
      const raioTela = Math.abs(centroTela.y - bordaTela.y)
      contexto.save()
      contexto.beginPath()
      contexto.arc(centroTela.x, centroTela.y, raioTela, 0, Math.PI * 2)
      contexto.clip()

      const larguraCelula = largura / passos + 1
      const alturaCelula = altura / passos + 1
      for (let y = 0; y < passos; y += 1) {
        for (let x = 0; x < passos; x += 1) {
          const lat = centro[0] + deltaLat * (1 - (y + 0.5) * 2 / passos)
          const lng = centro[1] + deltaLng * ((x + 0.5) * 2 / passos - 1)
          let numerador = 0
          let denominador = 0
          for (const ponto of pontos) {
            const distancia = distanciaMetros(lat, lng, ponto.lat, ponto.lng)
            if (distancia < 1) {
              numerador = ponto.valor
              denominador = 1
              break
            }
            const peso = 1 / (distancia * distancia)
            numerador += ponto.valor * peso
            denominador += peso
          }
          const valor = denominador > 0 ? numerador / denominador : 0
          const estilo = intensidadeCemaden(valor)
          if (estilo.alpha === 0) continue
          contexto.globalAlpha = estilo.alpha
          contexto.fillStyle = estilo.cor
          contexto.fillRect(
            noroeste.x + x * largura / passos,
            noroeste.y + y * altura / passos,
            larguraCelula,
            alturaCelula,
          )
        }
      }
      contexto.restore()
      contexto.globalAlpha = 1
    }

    let frame = 0
    const agendarDesenho = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(desenhar)
    }
    map.on('move zoom resize', agendarDesenho)
    agendarDesenho()
    return () => {
      window.cancelAnimationFrame(frame)
      map.off('move zoom resize', agendarDesenho)
      canvas.remove()
    }
  }, [estacoes, map, opacidade])

  return null
}

// ── Cache de ícones no nível do módulo ──────────────────────────
// Evita recriar objetos DivIcon a cada render — o Leaflet compara por
// referência e só atualiza o DOM quando o objeto muda. Com o cache,
// somente os marcadores realmente alterados (selecionado/desselecionado)
// causam atualização no DOM, em vez de todos os N marcadores.
const _ICONES_CACHE = new Map<string, L.DivIcon>()
function getIconeCache(natureza: string, selecionado: boolean, semGps: boolean): L.DivIcon {
  const key = `${natureza}|${selecionado}|${semGps}`
  if (!_ICONES_CACHE.has(key)) _ICONES_CACHE.set(key, criarIcone(natureza, selecionado, semGps))
  return _ICONES_CACHE.get(key)!
}

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

// Nome do dispositivo = nome do agente logado na sessão
function getNomeAgente(): string {
  const nome = (
    sessionStorage.getItem('defesacivil-agente-sessao') ||
    localStorage.getItem('defesacivil-device-nome') ||
    `Equipe ${getDispositivoId()}`
  )
  return normalizarNomeAgente(nome)
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
    CONSELHEIRO_LAFAIETE[0] + r * Math.cos(angle),
    CONSELHEIRO_LAFAIETE[1] + r * Math.sin(angle),
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

// Distância em km entre dois pontos (haversine)
function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

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

function criarIconeSos() {
  return L.divIcon({
    className: '',
    html: '<span class="mapa-sos-marker" aria-label="Alerta SOS">🆘</span>',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -22],
  })
}

function MarcadoresSos({ alertas }: { alertas: SosAlerta[] }) {
  const map = useMap()
  const ultimoAlertaFocado = useRef<string | null>(null)
  const alertaMaisRecente = alertas
    .filter(alerta => Number.isFinite(alerta.lat) && Number.isFinite(alerta.lng))
    .reduce<SosAlerta | null>((maisRecente, atual) =>
      !maisRecente || atual.timestamp > maisRecente.timestamp ? atual : maisRecente, null)

  useEffect(() => {
    if (!alertaMaisRecente || alertaMaisRecente.id === ultimoAlertaFocado.current) return
    ultimoAlertaFocado.current = alertaMaisRecente.id
    map.flyTo(
      [alertaMaisRecente.lat!, alertaMaisRecente.lng!],
      Math.max(map.getZoom(), 16),
      { duration: 0.8 },
    )
  }, [alertaMaisRecente?.id, map])

  return (
    <>
      {alertas
        .filter(alerta => Number.isFinite(alerta.lat) && Number.isFinite(alerta.lng))
        .map(alerta => (
          <Marker
            key={`sos-${alerta.id}`}
            position={[alerta.lat!, alerta.lng!]}
            icon={criarIconeSos()}
            zIndexOffset={2500}
          >
            <Popup>
              <div style={{ minWidth: 180, fontFamily: 'inherit' }}>
                <strong style={{ display: 'block', color: '#b91c1c', marginBottom: 4 }}>
                  🆘 SOS de {normalizarNomeAgente(alerta.agente)}
                </strong>
                <div style={{ fontSize: '0.76rem', color: '#6b7280', marginBottom: 8 }}>
                  {new Date(alerta.timestamp).toLocaleString('pt-BR')}
                </div>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${alerta.lat},${alerta.lng}&travelmode=driving`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    borderRadius: 6,
                    padding: '7px 10px',
                    background: '#b91c1c',
                    color: '#fff',
                    textDecoration: 'none',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                  }}
                >
                  ↗ Navegar até o agente
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
    </>
  )
}

// Centraliza no destino quando ele muda — usado pela busca de endereço.
function FocoDestino({ destino, rota }: {
  destino: { lat: number; lng: number } | null
  rota: [number, number][]
}) {
  const map = useMap()
  useEffect(() => {
    if (!destino) return
    if (rota.length >= 2) {
      // Ajusta o zoom para mostrar o trajeto inteiro
      const bounds = L.latLngBounds(rota.map(p => L.latLng(p[0], p[1])))
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 })
    } else {
      map.flyTo([destino.lat, destino.lng], Math.max(map.getZoom(), 16), { duration: 1 })
    }
  }, [destino, rota, map])
  return null
}

// Ícone do pino de destino (estilo Google Maps)
function criarIconeDestino() {
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;">
      <div style="
        background:#dc2626;width:42px;height:42px;
        border-radius:50% 50% 50% 0;transform:rotate(-45deg);
        border:3px solid white;
        box-shadow:0 0 0 3px #dc262655, 0 4px 12px rgba(0,0,0,0.5);
        display:flex;align-items:center;justify-content:center;
      "><span style="transform:rotate(45deg);font-size:22px;line-height:1;">📍</span></div>
    </div>`,
    iconSize: [42, 48],
    iconAnchor: [21, 48],
    popupAnchor: [0, -48],
  })
}

// Ícone de cone para equipamentos em campo
function criarIconeCone(nome?: string | null, selecionado = false) {
  const size = selecionado ? 44 : 36
  const primeiroNome = nome ? nome.split(/[\s,/-]/)[0].slice(0, 10) : 'Campo'
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;text-align:center;">
      <div style="
        background:#ea580c;width:${size}px;height:${size}px;
        border-radius:50% 50% 50% 0;transform:rotate(-45deg);
        border:${selecionado ? '3px solid white' : '2px solid white'};
        box-shadow:${selecionado ? '0 0 0 3px #ea580c, 0 4px 12px rgba(0,0,0,0.5)' : '0 2px 6px rgba(0,0,0,0.35)'};
        display:flex;align-items:center;justify-content:center;
      "><span style="transform:rotate(45deg);font-size:${selecionado ? 20 : 16}px;line-height:1;">🚧</span></div>
      <div style="
        position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);
        background:rgba(234,88,12,0.9);color:white;font-size:8px;padding:1px 4px;
        border-radius:3px;white-space:nowrap;font-family:sans-serif;font-weight:700;
      ">${primeiroNome}</div>
    </div>`,
    iconSize: [size, size + 18],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -(size + 4)],
  })
}

// ── Viewport culling: rastreia bounds do mapa ────────────────────
// Dispara onChange só no fim do movimento/zoom (moveend/zoomend) para
// evitar recalcular a lista de marcadores visíveis a cada pixel arrastado.
function BoundsTracker({ onChange }: { onChange: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({
    moveend: () => onChange(map.getBounds()),
    zoomend: () => onChange(map.getBounds()),
  })
  useEffect(() => { onChange(map.getBounds()) }, []) // captura bounds iniciais
  return null
}

// ── Tipos ───────────────────────────────────────────────────────
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

interface Props {
  ocorrencias: Ocorrencia[]
  onSelecionar: (o: Ocorrencia) => void
  /** Destino vindo de fora (ex: "Traçar rota de resgate" do SOS). Quando definido,
   *  o mapa centraliza no ponto e calcula a rota automaticamente.
   *  Quando soMostrar=true, apenas centraliza no ponto sem traçar rota. */
  destinoExterno?: { lat: number; lng: number; nome?: string; soMostrar?: boolean } | null
  /** Callback chamado depois que o destinoExterno foi consumido — para limpar no pai. */
  onDestinoExternoConsumido?: () => void
  /** Equipamentos em campo para exibir no mapa. */
  equipamentosCampo?: EquipamentoCampoMapa[]
  /** Alertas SOS ativos com localização GPS. */
  alertasSos: SosAlerta[]
  /** Abre o detalhe de um equipamento em campo no Patrimônio. */
  onVerDetalheCampo?: (equipId: number) => void
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

function nomeDiaSemana(dateStr: string): string {
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const d = new Date(dateStr + 'T12:00:00')
  return dias[d.getDay()]
}

// Centro de Conselheiro Lafaiete; zoom 12 enquadra a cidade e suas ruas.
const CONSELHEIRO_LAFAIETE: [number, number] = [-20.6604, -43.7863]
const RAIO_RADAR_CHUVA_METROS = 10_000
const MAX_ZOOM_MAPA_PADRAO = 19
// Acima deste nível a cobertura Esri da região exibe "Map data not yet available".
const MAX_ZOOM_SATELITE = 18

const MAX_TRILHA = 300

function LimiteZoomCamada({ camada }: { camada: CamadaMapa }) {
  const map = useMap()

  useEffect(() => {
    const maxZoom = camada === 'satelite' ? MAX_ZOOM_SATELITE : MAX_ZOOM_MAPA_PADRAO
    map.setMaxZoom(maxZoom)

    if (map.getZoom() > maxZoom) {
      map.setZoom(maxZoom, { animate: false })
    }
  }, [camada, map])

  return null
}

// ── Componente principal ────────────────────────────────────────
export default function MapaOcorrencias({ ocorrencias, onSelecionar, destinoExterno, onDestinoExternoConsumido, equipamentosCampo = [], alertasSos, onVerDetalheCampo }: Props) {
  const mostrarPainelChuva = false
  const [selecionada, setSelecionada] = useState<Ocorrencia | null>(null)
  const [legendaAberta, setLegendaAberta] = useState(false)
  const [camadaMapa, setCamadaMapa] = useState<CamadaMapa>('padrao')
  const [mostrarChuva, setMostrarChuva] = useState(false)
  const [painelChuvaAberto, setPainelChuvaAberto] = useState(false)
  const [radarChuva, setRadarChuva] = useState<DadosRadarChuva | null>(null)
  const [radarChuvaCarregando, setRadarChuvaCarregando] = useState(false)
  const [radarChuvaErro, setRadarChuvaErro] = useState<string | null>(null)
  const [mostrarNuvensGoes, setMostrarNuvensGoes] = useState(false)
  const [mostrarIntensidadeCemaden, setMostrarIntensidadeCemaden] = useState(false)
  const [opacidadeNuvensGoes, setOpacidadeNuvensGoes] = useState(0.5)
  const [opacidadeRadar, setOpacidadeRadar] = useState(0.72)
  const [opacidadeCemaden, setOpacidadeCemaden] = useState(0.52)
  const [estacoesCemaden, setEstacoesCemaden] = useState<EstacaoCemadenMapa[]>([])
  const [cemadenAtualizadoEm, setCemadenAtualizadoEm] = useState<string | null>(null)
  const [cemadenCarregando, setCemadenCarregando] = useState(false)
  const [cemadenErro, setCemadenErro] = useState<string | null>(null)
  const [mostrarOcorrencias, setMostrarOcorrencias] = useState(false)
  const [mostrarMateriais, setMostrarMateriais] = useState(false)
  const [painelMaterialAberto, setPainelMaterialAberto] = useState(false)
  const [submenuFiltroAberto, setSubmenuFiltroAberto] = useState(false)
  const [naturezasOcultas, setNaturezasOcultas] = useState<Set<string>>(new Set())
  const [mapaBounds, setMapaBounds] = useState<L.LatLngBounds | null>(null)

  // Busca de endereço + rota (estilo Google Maps)
  const [enderecoBusca, setEnderecoBusca] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState<Array<{ display: string; lat: number; lng: number }>>([])
  const [buscandoEndereco, setBuscandoEndereco] = useState(false)
  const [destino, setDestino] = useState<{ lat: number; lng: number; nome: string } | null>(null)
  const [rota, setRota] = useState<[number, number][]>([])
  const [rotaInfo, setRotaInfo] = useState<{ km: number; min: number } | null>(null)
  const [calculandoRota, setCalculandoRota] = useState(false)

  // GPS local
  const [statusGps, setStatusGps] = useState<StatusGps>('inativo')
  const [erroGps, setErroGps] = useState<string | null>(null)
  const [posicaoAtual, setPosicaoAtual] = useState<[number, number] | null>(null)
  const [precisao, setPrecisao] = useState<number>(0)
  const [ultimaAtualizacaoGps, setUltimaAtualizacaoGps] = useState<number | null>(null)
  const [velocidade, setVelocidade] = useState<number | null>(null)
  const [trilha, setTrilha] = useState<[number, number][]>([])
  const [seguir, setSeguir] = useState(true)
  const watchIdRef = useRef<number | null>(null)

  // Dispositivos remotos (outros celulares)
  const [dispositivos, setDispositivos] = useState<Map<string, DispositivoRemoto>>(new Map())
  const [statusWs, setStatusWs] = useState<StatusWs>('desconectado')
  const [painelEquipesAberto, setPainelEquipesAberto] = useState(false)
  const wsConectadoRef = useRef(false) // tracks if WS has connected at least once
  const ultimaPosicaoRef = useRef<{ lat: number; lng: number; precisao: number; velocidade: number | null } | null>(null)
  const proxIndiceRef = useRef(0)
  const indicesRef = useRef<Map<string, number>>(new Map())

  // Nome e ID do dispositivo local — usa o agente escolhido no login da sessão
  const [nomeLocal] = useState(() => getNomeAgente())
  const nomeLocalRef = useRef(nomeLocal)
  const dispositivoId = useRef(getDispositivoId())


  // ── Chuva ao vivo — RainViewer + estimativa interpolada CEMADEN ──
  const buscarRadarChuva = useCallback(async () => {
    setRadarChuvaCarregando(true)
    setRadarChuvaErro(null)
    try {
      const respostaRadar = await fetch(`/api/radar-chuva?_ts=${Date.now()}`, { cache: 'no-store' })
      if (!respostaRadar.ok) throw new Error('Radar indisponível')

      const dadosRadar = await respostaRadar.json()
      setRadarChuva({
        host: typeof dadosRadar?.host === 'string' ? dadosRadar.host : '',
        path: typeof dadosRadar?.path === 'string' ? dadosRadar.path : '',
        tileUrl: typeof dadosRadar?.tileUrl === 'string' ? dadosRadar.tileUrl : undefined,
        frameTime: Number(dadosRadar?.frameTime),
        atualizadoEm: typeof dadosRadar?.atualizadoEm === 'string' ? dadosRadar.atualizadoEm : '',
        fonte: typeof dadosRadar?.fonte === 'string' ? dadosRadar.fonte : 'RainViewer',
         tipoQuadro: 'observado',
        cache: dadosRadar?.cache === true,
        erroAtualizacao: dadosRadar?.erroAtualizacao === true,
      })

    } catch {
      setRadarChuvaErro('Não foi possível atualizar o radar agora.')
    } finally {
      setRadarChuvaCarregando(false)
    }
  }, [])

  useEffect(() => {
    if (!mostrarChuva) return
    buscarRadarChuva()
    const intervalo = setInterval(buscarRadarChuva, 5 * 60 * 1000)
    const atualizarAoVoltar = () => {
      if (document.visibilityState === 'visible') buscarRadarChuva()
    }
    document.addEventListener('visibilitychange', atualizarAoVoltar)
    return () => {
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', atualizarAoVoltar)
    }
  }, [mostrarChuva, buscarRadarChuva])

  const buscarCemadenMapa = useCallback(async () => {
    setCemadenCarregando(true)
    setCemadenErro(null)
    try {
      const resposta = await fetch(`/api/monitoramento-cnl?_ts=${Date.now()}`, { cache: 'no-store' })
      const dados = await resposta.json().catch(() => ({}))
      if (!resposta.ok || !dados?.sucesso) throw new Error(typeof dados?.erro === 'string' ? dados.erro : 'CEMADEN indisponível')
      const estacoes = (Array.isArray(dados?.estacoes) ? dados.estacoes : [])
        .filter((estacao: EstacaoCemadenMapa) => CEMADEN_ESTACOES_ESPERADAS.has(Number(estacao?.id)))
        .map((estacao: EstacaoCemadenMapa) => ({
          id: Number(estacao.id),
          nome: String(estacao.nome || ''),
          codigo: String(estacao.codigo || ''),
          latitude: Number.isFinite(Number(estacao.latitude)) ? Number(estacao.latitude) : null,
          longitude: Number.isFinite(Number(estacao.longitude)) ? Number(estacao.longitude) : null,
          precipitacaoAtual: Number.isFinite(Number(estacao.precipitacaoAtual))
            ? Number(estacao.precipitacaoAtual)
            : null,
          precipitacaoDataHora: String(estacao.precipitacaoDataHora || ''),
        }))
      setEstacoesCemaden(estacoes)
      setCemadenAtualizadoEm(typeof dados?.atualizadoEm === 'string' ? dados.atualizadoEm : null)
    } catch (erro) {
      setCemadenErro(erro instanceof Error && erro.message ? erro.message : 'Não foi possível consultar o CEMADEN agora.')
    } finally {
      setCemadenCarregando(false)
    }
  }, [])

  useEffect(() => {
    if (!mostrarIntensidadeCemaden && !painelChuvaAberto) return
    buscarCemadenMapa()
    const intervalo = setInterval(buscarCemadenMapa, 5 * 60 * 1000)
    const atualizarAoVoltar = () => {
      if (document.visibilityState === 'visible') buscarCemadenMapa()
    }
    document.addEventListener('visibilitychange', atualizarAoVoltar)
    return () => {
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', atualizarAoVoltar)
    }
  }, [mostrarIntensidadeCemaden, painelChuvaAberto, buscarCemadenMapa])

  // Mapa offline — inicializa tiles do localStorage para mostrar status imediatamente
  const [statusOffline, setStatusOffline] = useState<StatusOffline>('idle')
  const [estaOnline, setEstaOnline] = useState(() => navigator.onLine)
  const [progressoMapa, setProgressoMapa] = useState<ProgressoMapa | null>(null)
  const [tilesCacheados, setTilesCacheados] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('dc_tiles_count') || '0') || 0 } catch { return 0 }
  })
  const [painelOfflineAberto, setPainelOfflineAberto] = useState(false)

  // Malha viária offline (ruas + roteamento local) — inicializa do localStorage
  const [malhaInfo, setMalhaInfo] = useState<{ baixada: boolean; bytes: number }>(() => {
    try {
      const s = localStorage.getItem('dc_malha_info')
      return s ? JSON.parse(s) : { baixada: false, bytes: 0 }
    } catch { return { baixada: false, bytes: 0 } }
  })
  const [statusMalha, setStatusMalha] = useState<'idle' | 'baixando' | 'concluido' | 'erro'>('idle')
  const [progressoMalha, setProgressoMalha] = useState<ProgressoMalha | null>(null)

  useEffect(() => {
    const ficouOnline = () => setEstaOnline(true)
    const ficouOffline = () => setEstaOnline(false)
    window.addEventListener('online', ficouOnline)
    window.addEventListener('offline', ficouOffline)
    return () => {
      window.removeEventListener('online', ficouOnline)
      window.removeEventListener('offline', ficouOffline)
    }
  }, [])

  // Mantém ref sempre atualizada com o nome atual
  useEffect(() => { nomeLocalRef.current = nomeLocal }, [nomeLocal])


  const comGeo = useMemo(() => ocorrencias.filter((o) => o.lat && o.lng), [ocorrencias])
  const semGeo = ocorrencias.length - comGeo.length

  // Persiste contagem de tiles no localStorage para mostrar status entre recargas
  useEffect(() => {
    try { localStorage.setItem('dc_tiles_count', String(tilesCacheados)) } catch { /* ignora */ }
  }, [tilesCacheados])

  // Persiste info da malha no localStorage
  useEffect(() => {
    try { localStorage.setItem('dc_malha_info', JSON.stringify(malhaInfo)) } catch { /* ignora */ }
  }, [malhaInfo])

  // Verifica tiles: ao mudar statusOffline e também quando o SW ficar pronto
  useEffect(() => {
    obterInfoCacheMapa()
      .then((total) => {
        setTilesCacheados(total)
        if (total > 0) setStatusOffline('concluido')
      })
      .catch(() => {})
  }, [statusOffline])

  // Verifica ao montar — aguarda SW controller disponível para leitura correta
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const verificar = () => {
      obterInfoCacheMapa().then(n => {
        if (n > 0) {
          setTilesCacheados(n)
          setStatusOffline('concluido')
        }
      }).catch(() => {})
      obterInfoMalhaViaria().then(info => {
        if (info.baixada) setMalhaInfo(info)
      }).catch(() => {})
    }
    if (navigator.serviceWorker.controller) {
      verificar()
    } else {
      navigator.serviceWorker.ready.then(verificar).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Carrega info da malha viária (e pré-aquece em segundo plano)
  useEffect(() => {
    obterInfoMalhaViaria()
      .then((info) => {
        setMalhaInfo(info)
        if (info.baixada) preAquecerMalha()
      })
      .catch(() => {})
  }, [statusMalha])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelecionada(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── WebSocket — Rastreamento em tempo real ───────────────────────
  const getIndice = useCallback((id: string) => {
    if (!indicesRef.current.has(id)) {
      indicesRef.current.set(id, proxIndiceRef.current++)
    }
    return indicesRef.current.get(id)!
  }, [])

  useEffect(() => {
    setStatusWs('conectando')

    const offPosicao = wsOn('posicao', (msg) => {
      wsConectadoRef.current = true
      setStatusWs('conectado')
      const id = msg.id as string
      if (!id || id === dispositivoId.current) return
      const lat = msg.lat as number | null
      const lng = msg.lng as number | null
      if (lat == null || lng == null) return
      setDispositivos(prev => {
        const next = new Map(prev)
        next.set(id, {
          id,
          nome: (msg.nome as string) || `Equipe ${id}`,
          lat,
          lng,
          precisao: (msg.precisao as number) ?? 0,
          velocidade: (msg.velocidade as number | null) ?? null,
          ultimaVez: Date.now(),
          indice: getIndice(id),
        })
        return next
      })
    })

    const offPosicoes = wsOn('posicoes_iniciais', (msg) => {
      wsConectadoRef.current = true
      setStatusWs('conectado')
      const posicoes = msg.posicoes as Array<{
        id: string; nome: string; lat: number; lng: number; precisao: number; velocidade: number | null
      }>
      if (!Array.isArray(posicoes)) return
      setDispositivos(() => {
        const next = new Map<string, DispositivoRemoto>()
        for (const p of posicoes) {
          if (p.id === dispositivoId.current) continue
          next.set(p.id, {
            id: p.id,
            nome: p.nome || `Equipe ${p.id}`,
            lat: p.lat,
            lng: p.lng,
            precisao: p.precisao ?? 0,
            velocidade: p.velocidade ?? null,
            ultimaVez: Date.now(),
            indice: getIndice(p.id),
          })
        }
        return next
      })
    })

    const offRemover = wsOn('remover', (msg) => {
      const id = msg.id as string
      if (!id) return
      setDispositivos(prev => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    })

    // Sempre que o WS abre (inclusive depois de reconectar):
    //  1. Pede o estado atual ao servidor — assim, mesmo que o mapa seja
    //     aberto DEPOIS que o WS já tinha conectado, o agente recebe as
    //     posições atuais dos demais imediatamente.
    //  2. Reenvia a própria última posição conhecida, garantindo que os
    //     outros agentes voltem a ver o marcador após uma queda curta de rede
    //     (o servidor faz broadcast de "remover" no fechamento da conexão).
    const offOpen = wsOnOpen(() => {
      setStatusWs('conectado')
      wsConectadoRef.current = true
      wsSend({ tipo: 'solicitar_estado' })
      const ultima = ultimaPosicaoRef.current
      if (ultima) {
        wsSend({
          tipo: 'posicao',
          id: dispositivoId.current,
          nome: nomeLocalRef.current,
          lat: ultima.lat,
          lng: ultima.lng,
          precisao: ultima.precisao,
          velocidade: ultima.velocidade,
        })
      }
    })

    return () => {
      offPosicao()
      offPosicoes()
      offRemover()
      offOpen()
    }
  }, [getIndice])

  // ── Anti-fantasma: varredura periódica ───────────────────────────
  // Mesmo que o broadcast 'gps-off' falhe (rede ruim, app crashou, bateria
  // morreu), qualquer dispositivo cujo último heartbeat tenha mais de 10s
  // some do mapa. O heartbeat de `gpsService` reenvia a posição a cada 5s,
  // então o limite de 10s dá uma margem de uma atualização perdida.
  useEffect(() => {
    const TTL = 10_000
    const interval = setInterval(() => {
      setDispositivos(prev => {
        const agora = Date.now()
        let mudou = false
        const next = new Map(prev)
        for (const [id, d] of prev) {
          if (agora - d.ultimaVez > TTL) {
            next.delete(id)
            mudou = true
          }
        }
        return mudou ? next : prev
      })
    }, 3_000)
    return () => clearInterval(interval)
  }, [])

  const enviarPosicao = useCallback((lat: number, lng: number, prec: number, vel: number | null) => {
    ultimaPosicaoRef.current = { lat, lng, precisao: prec, velocidade: vel }
    wsSend({
      tipo: 'posicao',
      id: dispositivoId.current,
      nome: nomeLocalRef.current,
      lat, lng,
      precisao: prec,
      velocidade: vel,
    })
  }, [])

  // ── GPS (via gpsService global) ───────────────────────────────
  // O GPS vive num singleton fora deste componente — assim continua ativo
  // mesmo quando o agente troca pra aba "Lista" ou "Checklist". Aqui só
  // espelhamos o estado do serviço para a UI do mapa.
  useEffect(() => {
    const off = subscribeGps((est) => {
      setStatusGps(est.status)
      setErroGps(est.erro)
      if (est.posicao) {
        const coords: [number, number] = [est.posicao.lat, est.posicao.lng]
        setPosicaoAtual(coords)
        setPrecisao(est.posicao.precisao)
        setUltimaAtualizacaoGps(est.posicao.timestamp)
        setVelocidade(est.posicao.velocidade)
        // Trilha: só adiciona ponto se moveu mais de 3 metros
        setTrilha((prev) => {
          if (prev.length > 0) {
            const ultimo = prev[prev.length - 1]
            const distM = distanciaKm(ultimo[0], ultimo[1], coords[0], coords[1]) * 1000
            if (distM < 3) return prev
          }
          const nova = [...prev, coords]
          return nova.length > MAX_TRILHA ? nova.slice(nova.length - MAX_TRILHA) : nova
        })
        ultimaPosicaoRef.current = {
          lat: est.posicao.lat,
          lng: est.posicao.lng,
          precisao: est.posicao.precisao,
          velocidade: est.posicao.velocidade,
        }
      } else if (est.status === 'inativo') {
        setPosicaoAtual(null)
        setTrilha([])
        setVelocidade(null)
        setUltimaAtualizacaoGps(null)
        setSeguir(true)
        ultimaPosicaoRef.current = null
      }
    })
    return off
  }, [])

  function centralizarOuTentarGps() {
    const est = getEstadoGps()
    setSeguir(true)
    if (est.status !== 'ativo' || !est.posicao) retomarGpsGlobal()
  }

  // ── Mapa offline ──────────────────────────────────────────────
  async function iniciarDownloadMapa() {
    if (statusOffline === 'baixando') return
    setStatusOffline('baixando')
    setProgressoMapa(null)
    try {
      // Evita que o navegador descarte os tiles sob pressão de armazenamento.
      await solicitarArmazenamentoPersistente()
      // Tiles num raio de 10 km do centro de Conselheiro Lafaiete.
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

  // ── Malha viária offline (ruas + roteamento Dijkstra local) ───
  async function iniciarDownloadMalha() {
    if (statusMalha === 'baixando') return
    setStatusMalha('baixando')
    setProgressoMalha(null)
    try {
      await baixarMalhaViariaOffline((p) => {
        setProgressoMalha(p)
        if (p.status === 'concluido') setStatusMalha('concluido')
      })
      // Recarrega o índice em memória com a nova malha
      descartarMalhaEmMemoria()
      preAquecerMalha()
    } catch {
      setStatusMalha('erro')
    }
  }

  // ── Busca de endereço (autocomplete offline-first) ──────────────
  // Estratégia:
  //   1. Busca local na malha viária baixada (instantâneo, offline)
  //   2. Em paralelo, se online, consulta o Nominatim direto (sem proxy)
  //      restringindo o viewbox ao território de Conselheiro Lafaiete
  //   3. Mescla resultados (locais primeiro, sem duplicatas)
  const buscaTokenRef = useRef(0)
  const buscarEndereco = useCallback(async (texto: string) => {
    const q = texto.trim()
    const meuToken = ++buscaTokenRef.current
    if (q.length < 2) { setResultadosBusca([]); setBuscandoEndereco(false); return }
    setBuscandoEndereco(true)

    // 1. Local (offline-first)
    let locais: Array<{ display: string; lat: number; lng: number }> = []
    try {
      const ruas = await buscarRuas(q, 8)
      locais = ruas.map((r) => ({ display: r.display, lat: r.lat, lng: r.lng }))
    } catch { /* ignora */ }

    if (meuToken !== buscaTokenRef.current) return

    // Se já tem resultados locais bons, mostra imediatamente enquanto a rede
    // ainda está completando — UX mais responsiva.
    if (locais.length > 0) setResultadosBusca(locais)

    // 2. Nominatim direto (chama de fora porque em produção não há proxy)
    if (navigator.onLine) {
      try {
        // Viewbox abrangendo Conselheiro Lafaiete e o território municipal.
        // Formato Nominatim: lonMin,latMax,lonMax,latMin (canto NW e SE)
        const viewbox = '-43.90,-20.57,-43.67,-20.75'
        const queryFinal = /conselheiro lafaiete|mg|minas/i.test(q) ? q : `${q}, Conselheiro Lafaiete, MG, Brasil`
        // Detecta se a query parece "rua + número" (ex.: "Rua das Flores, 123" ou "Av X 45")
        // Se sim, pede `addressdetails=1` para o Nominatim devolver o número do imóvel
        const temNumero = /\b\d{1,5}\b/.test(q)
        const url =
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(queryFinal)}` +
          `&format=json&limit=10&countrycodes=br&accept-language=pt-BR` +
          `&viewbox=${viewbox}&bounded=0&addressdetails=${temNumero ? 1 : 0}`
        const resp = await fetch(url, { headers: { 'Accept': 'application/json' } })
        if (meuToken !== buscaTokenRef.current) return
        if (resp.ok) {
          const data = await resp.json()
          const remotos: Array<{ display: string; lat: number; lng: number }> = (Array.isArray(data) ? data : [])
            .map((d: any) => ({
              display: String(d.display_name ?? ''),
              lat: parseFloat(d.lat),
              lng: parseFloat(d.lon),
            }))
            .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng))

          // Mescla: locais primeiro, depois remotos não duplicados (≥30 m)
          const out = [...locais]
          for (const r of remotos) {
            const existe = out.some(
              (o) => Math.abs(o.lat - r.lat) < 3e-4 && Math.abs(o.lng - r.lng) < 3e-4
            )
            if (!existe) out.push(r)
            if (out.length >= 10) break
          }
          if (meuToken === buscaTokenRef.current) setResultadosBusca(out)
        }
      } catch { /* offline ou bloqueado, mantém os locais */ }
    }

    if (meuToken === buscaTokenRef.current) setBuscandoEndereco(false)
  }, [])

  // Quando um destino é escolhido, o input passa a refletir o nome dele;
  // suprimimos o autocomplete enquanto o texto bater com o destino atual.
  const ignorarBuscaRef = useRef(false)
  // Debounce: dispara a busca 280 ms depois da última digitação
  useEffect(() => {
    const q = enderecoBusca.trim()
    if (q.length < 2) {
      setResultadosBusca([])
      setBuscandoEndereco(false)
      return
    }
    if (ignorarBuscaRef.current) {
      ignorarBuscaRef.current = false
      return
    }
    const t = setTimeout(() => buscarEndereco(q), 280)
    return () => clearTimeout(t)
  }, [enderecoBusca, buscarEndereco])

  // Calcula rota do ponto atual (GPS ou centro de Conselheiro Lafaiete) até o destino.
  // Estratégia: tenta roteamento local (Dijkstra na malha baixada) primeiro
  // — funciona offline e é instantâneo. Se não houver malha, cai para
  // OSRM público; se também falhar, desenha linha reta como último recurso.
  const calcularRota = useCallback(async (origem: [number, number], dest: { lat: number; lng: number }) => {
    setCalculandoRota(true)
    try {
      // 1. Roteamento local (offline)
      if (await malhaDisponivel()) {
        const rotaLoc = await roteamentoLocal(
          { lat: origem[0], lng: origem[1] },
          { lat: dest.lat, lng: dest.lng }
        )
        if (rotaLoc && rotaLoc.coords.length >= 2) {
          setRota(rotaLoc.coords)
          setRotaInfo({ km: rotaLoc.km, min: rotaLoc.min })
          return
        }
      }

      // 2. OSRM público (online) — não exige nosso backend
      if (navigator.onLine) {
        try {
          const url = `https://router.project-osrm.org/route/v1/driving/${origem[1]},${origem[0]};${dest.lng},${dest.lat}?overview=full&geometries=geojson`
          const resp = await fetch(url)
          if (resp.ok) {
            const json = await resp.json()
            const r = json?.routes?.[0]
            if (r) {
              const coords = (r.geometry?.coordinates || []).map(
                ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
              )
              if (coords.length >= 2) {
                setRota(coords)
                setRotaInfo({ km: r.distance / 1000, min: Math.round(r.duration / 60) })
                return
              }
            }
          }
        } catch { /* segue p/ fallback */ }
      }

      // 3. Linha reta (último recurso)
      setRota([origem, [dest.lat, dest.lng]])
      const km = distanciaKm(origem[0], origem[1], dest.lat, dest.lng)
      setRotaInfo({ km, min: Math.round((km / 30) * 60) })
    } finally {
      setCalculandoRota(false)
    }
  }, [])

  function escolherDestino(r: { display: string; lat: number; lng: number }) {
    const dest = { lat: r.lat, lng: r.lng, nome: r.display }
    setDestino(dest)
    setResultadosBusca([])
    // Invalida buscas pendentes e suprime a próxima execução do debounce
    // para que o autocomplete não reabra a lista ao trocar o texto do input
    // para o nome do destino selecionado.
    buscaTokenRef.current++
    ignorarBuscaRef.current = true
    setEnderecoBusca(r.display.split(',')[0])
    const origem: [number, number] = posicaoAtual ?? CONSELHEIRO_LAFAIETE
    calcularRota(origem, dest)
  }

  function limparBuscaERota() {
    setDestino(null)
    setRota([])
    setRotaInfo(null)
    setEnderecoBusca('')
    setResultadosBusca([])
  }

  // Recalcula a rota se a posição GPS mudar enquanto há um destino ativo
  useEffect(() => {
    if (!destino) return
    if (!posicaoAtual) return
    // Recalcula a cada movimento significativo (>50m) para evitar flood
    const ultimoPonto = rota[0]
    if (ultimoPonto) {
      const d = distanciaKm(ultimoPonto[0], ultimoPonto[1], posicaoAtual[0], posicaoAtual[1]) * 1000
      if (d < 50) return
    }
    calcularRota(posicaoAtual, destino)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posicaoAtual?.[0], posicaoAtual?.[1], destino])

  // Quando o pai envia um destino externo (botão "Traçar rota de resgate" do SOS),
  // posiciona o pino, traça a rota a partir da posição GPS atual (ou do centro de
  // Conselheiro Lafaiete como fallback) e avisa o pai que já consumiu o destino.
  // Quando soMostrar=true (botão "Ver no Mapa" de equipamento em campo), apenas
  // centraliza no ponto sem calcular rota.
  useEffect(() => {
    if (!destinoExterno) return
    const dest = {
      lat: destinoExterno.lat,
      lng: destinoExterno.lng,
      nome: destinoExterno.nome || (destinoExterno.soMostrar ? 'Equipamento em Campo' : 'Local do SOS'),
    }
    setDestino(dest)
    setEnderecoBusca(dest.nome)
    setResultadosBusca([])
    buscaTokenRef.current++
    ignorarBuscaRef.current = true
    if (destinoExterno.soMostrar) {
      setRota([])
      setRotaInfo(null)
    } else {
      const origem: [number, number] = posicaoAtual ?? CONSELHEIRO_LAFAIETE
      calcularRota(origem, dest)
    }
    onDestinoExternoConsumido?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinoExterno?.lat, destinoExterno?.lng])

  // ── Misc ──────────────────────────────────────────────────────
  function selecionarOc(o: Ocorrencia) {
    setSelecionada((prev) => (prev?.id === o.id ? null : o))
  }

  function alternarNatureza(n: string) {
    setNaturezasOcultas(prev => {
      const novo = new Set(prev)
      if (novo.has(n)) novo.delete(n); else novo.add(n)
      return novo
    })
  }

  function direcaoVento(graus: number | null): string {
    if (graus == null) return '–'
    const dirs = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO']
    return dirs[Math.round(graus / 45) % 8]
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
  const intensidadeEstimada = useMemo(() => {
    const valores = estacoesCemaden
      .filter(estacao => statusLeituraCemaden(estacao.precipitacaoDataHora) === 'atualizada')
      .map(estacao => estacao.precipitacaoAtual)
      .filter((valor): valor is number => Number.isFinite(valor))
    return valores.length > 0 ? Math.max(...valores) : null
  }, [estacoesCemaden])

  // ── Viewport culling ─────────────────────────────────────────────
  // Só renderiza marcadores dentro da área visível do mapa + 15% de margem.
  // Ocorrências sem GPS ficam sempre visíveis (posição virtual perto do centro).
  const ocorrenciasVisiveis = useMemo(() => {
    const filtradas = ocorrencias.filter(o => !naturezasOcultas.has(o.natureza))
    if (!mapaBounds) return filtradas
    const ne = mapaBounds.getNorthEast()
    const sw = mapaBounds.getSouthWest()
    const latPad = (ne.lat - sw.lat) * 0.15
    const lngPad = (ne.lng - sw.lng) * 0.15
    return filtradas.filter(o => {
      if (!(o.lat && o.lng)) return true  // sem GPS → sempre mostra
      return (
        o.lat >= sw.lat - latPad && o.lat <= ne.lat + latPad &&
        o.lng >= sw.lng - lngPad && o.lng <= ne.lng + lngPad
      )
    })
  }, [ocorrencias, naturezasOcultas, mapaBounds])

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="mapa-wrapper">
      <MapContainer
        center={CONSELHEIRO_LAFAIETE}
        zoom={12}
        minZoom={8}
        // O mapa pode ser arrastado livremente para consultar outras regiões.
        dragging={true}
        style={{ width: '100%', height: '100%' }}
        zoomControl={true}
        whenReady={() => {}}
      >
        <LimiteZoomCamada camada={camadaMapa} />
        <MarcadoresSos alertas={alertasSos} />
        {camadaMapa === 'padrao' ? (
          <TileLayer
            key="mapa-padrao"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            subdomains={['a', 'b', 'c']}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxZoom={MAX_ZOOM_MAPA_PADRAO}
            maxNativeZoom={estaOnline ? MAX_ZOOM_MAPA_PADRAO : 16}
            keepBuffer={2}
            updateWhenZooming={false}
            updateWhenIdle={true}
          />
        ) : (
          <TileLayer
            key="mapa-satelite"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution='Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics'
            maxNativeZoom={MAX_ZOOM_SATELITE}
            maxZoom={MAX_ZOOM_SATELITE}
            keepBuffer={2}
            updateWhenZooming={false}
            updateWhenIdle={true}
          />
        )}
        {mostrarNuvensGoes && templateTilesHttpsValido(GOES_CLOUD_TILE_URL) && (
          <Pane name="nuvensGoesPane" style={{ zIndex: 410 }}>
            <TileLayer
              key={`nuvens-goes-${GOES_CLOUD_TILE_URL}`}
              url={GOES_CLOUD_TILE_URL}
              opacity={opacidadeNuvensGoes}
              attribution='Imagens de nuvens &copy; <a href="https://gis.nnvl.noaa.gov/arcgis/rest/services/GOES/GOES_current/ImageServer" target="_blank" rel="noreferrer">NOAA / GOES</a>'
              maxNativeZoom={8}
              maxZoom={19}
              tileSize={256}
              updateWhenZooming={false}
              updateWhenIdle={true}
            />
          </Pane>
        )}
        {mostrarChuva && radarChuva && (
          <Pane name="radarRainViewerPane" style={{ zIndex: 420 }}>
            <TileLayer
              key={`radar-chuva-${radarChuva.frameTime}`}
              url={radarChuva.tileUrl || `${radarChuva.host}${radarChuva.path}/256/{z}/{x}/{y}/2/1_0.png`}
              opacity={opacidadeRadar}
              attribution='Weather data by <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>'
              maxNativeZoom={7}
              maxZoom={19}
              tileSize={256}
              updateWhenZooming={false}
              updateWhenIdle={true}
            />
          </Pane>
        )}
        {mostrarIntensidadeCemaden && (
          <CemadenIntensityLayer estacoes={estacoesCemaden} opacidade={opacidadeCemaden} />
        )}
        {mostrarChuva && estacoesCemaden
          .filter(estacao => estacao.latitude != null && estacao.longitude != null)
          .map(estacao => {
            const estadoLeitura = statusLeituraCemaden(estacao.precipitacaoDataHora)
            const cor = estadoLeitura === 'atualizada'
              ? intensidadeCemaden(estacao.precipitacaoAtual ?? 0).cor
              : '#94a3b8'
            return (
              <CircleMarker
                key={`cemaden-estacao-${estacao.id}`}
                center={[estacao.latitude!, estacao.longitude!]}
                radius={9}
                pathOptions={{
                  color: '#ffffff',
                  weight: 2,
                  fillColor: cor,
                  fillOpacity: 0.95,
                }}
              >
                <Tooltip
                  permanent
                  direction="top"
                  offset={[0, -8]}
                  opacity={0.96}
                  className="mapa-chuva-estacao-tooltip"
                >
                  {valorChuvaMarcadorFormatado(estacao.precipitacaoAtual)}
                </Tooltip>
                <Popup>
                  <div style={{ minWidth: 190, fontFamily: 'inherit' }}>
                    <strong style={{ display: 'block', marginBottom: 4 }}>
                      🌧️ {estacao.nome || 'Estação CEMADEN'}
                    </strong>
                    <div style={{ fontSize: '0.8rem', color: '#374151', marginBottom: 3 }}>
                      <strong>Última hora:</strong> {valorChuvaFormatado(estacao.precipitacaoAtual)}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: estadoLeitura === 'atualizada' ? '#166534' : '#b45309', marginBottom: 3 }}>
                      {estadoLeitura === 'atualizada'
                        ? situacaoChuva(estacao.precipitacaoAtual)
                        : estadoLeitura === 'atrasada' ? 'Leitura atrasada' : 'Sem dados recentes'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                      Leitura: {dataHoraCemadenFormatada(estacao.precipitacaoDataHora)} · CEMADEN
                    </div>
                    {estacao.codigo && (
                      <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 3 }}>
                        Estação {estacao.codigo}
                      </div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
        {mostrarChuva && (
          <Circle
            center={CONSELHEIRO_LAFAIETE}
            radius={RAIO_RADAR_CHUVA_METROS}
            pathOptions={{
              color: '#1d4ed8',
              weight: 2,
              opacity: 0.95,
              dashArray: '7 5',
              fillColor: '#60a5fa',
              fillOpacity: 0.04,
            }}
          >
            <Popup>
              <strong>Área de observação da chuva</strong>
              <br />
              Raio de 10 km a partir do centro de Conselheiro Lafaiete
            </Popup>
          </Circle>
        )}
        {mostrarChuva && (
          <CircleMarker
            center={CONSELHEIRO_LAFAIETE}
            radius={5}
            pathOptions={{
              color: '#0f172a',
              weight: 2,
              fillColor: '#f8fafc',
              fillOpacity: 1,
            }}
          >
            <Popup>
              <strong>Centro da área de observação</strong>
              <br />
              Conselheiro Lafaiete — raio de 10 km
            </Popup>
          </CircleMarker>
        )}

        <MapClickHandler onMapClick={() => setSelecionada(null)} />
        <BoundsTracker onChange={setMapaBounds} />

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

        {/* Rota até o destino buscado */}
        {rota.length >= 2 && (
          <Polyline
            positions={rota}
            pathOptions={{ color: '#2563eb', weight: 6, opacity: 0.85 }}
          />
        )}

        {/* Pino do destino buscado */}
        {destino && (
          <Marker position={[destino.lat, destino.lng]} icon={criarIconeDestino()} zIndexOffset={2000}>
            <Popup>
              <div style={{ minWidth: 180, fontFamily: 'inherit' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 4 }}>📍 Destino</div>
                <div style={{ fontSize: '0.78rem', color: '#374151', marginBottom: 6 }}>{destino.nome}</div>
                {rotaInfo && (
                  <div style={{ fontSize: '0.78rem', color: '#1e40af', fontWeight: 700 }}>
                    🚗 {rotaInfo.km.toFixed(1)} km · ⏱ {rotaInfo.min} min
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        )}

        {destino && <FocoDestino destino={destino} rota={rota} />}

        {/* Ocorrências — ícones individuais, viewport culling ativo */}
        {mostrarOcorrencias && ocorrenciasVisiveis.map(o => {
          const temGps = !!(o.lat && o.lng)
          const pos: [number, number] = temGps ? [o.lat!, o.lng!] : coordsSemGps(o.id)
          return (
            <Marker
              key={o.id}
              position={pos}
              icon={getIconeCache(o.natureza, selecionada?.id === o.id, !temGps)}
              eventHandlers={{ click: (e) => { e.originalEvent?.stopPropagation?.(); selecionarOc(o) } }}
            />
          )
        })}

        {/* Equipamentos em Campo — cone laranja */}
        {mostrarMateriais && equipamentosCampo.filter(c => c.status === 'ativo' && c.latitude && c.longitude).map((c) => (
          <Marker
            key={c.id}
            position={[c.latitude!, c.longitude!]}
            icon={criarIconeCone(c.material_nome)}
          >
            <Popup>
              <div style={{ minWidth: 180, fontFamily: 'inherit' }}>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: 4 }}>
                  🚧 {c.material_nome ?? 'Equipamento em Campo'}
                </div>
                {(c.rua || c.bairro) && (
                  <div style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: 4 }}>
                    📍 {[c.rua, c.bairro].filter(Boolean).join(' — ')}
                  </div>
                )}
                {c.observacao && (
                  <div style={{ fontSize: '0.78rem', marginBottom: 4 }}>
                    {c.observacao}
                  </div>
                )}
                <div style={{ fontSize: '0.72rem', color: '#ea580c', fontWeight: 600, marginBottom: 8 }}>● Ativo em campo</div>
                {onVerDetalheCampo && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onVerDetalheCampo(c.id) }}
                    style={{
                      width: '100%', background: '#ea580c', color: 'white',
                      border: 'none', borderRadius: 6, padding: '6px 0',
                      fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem',
                    }}
                  >
                    Ver detalhes completos
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
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
        {mostrarPainelChuva && (
        <div className="mapa-chuva-wrap">
          <button
            className={`mapa-camada-btn mapa-chuva-btn ${mostrarChuva ? 'ativo' : ''}`}
            onClick={() => {
              const proximoEstado = !mostrarChuva
              setMostrarChuva(proximoEstado)
              setPainelChuvaAberto(proximoEstado)
            }}
            aria-pressed={mostrarChuva}
            title="Mostrar radar de chuva ao vivo em Conselheiro Lafaiete"
          >
            🌧️ Chuva
          </button>
          {painelChuvaAberto && (
            <div className="mapa-chuva-painel">
              <div className="mapa-chuva-painel-header">
                <div>
                  <strong>🌧️ Chuva ao vivo</strong>
                  <span>Conselheiro Lafaiete, MG · área tracejada = raio de observação de 10 km</span>
                </div>
                <button
                  onClick={() => setPainelChuvaAberto(false)}
                  aria-label="Fechar painel de chuva"
                >✕</button>
              </div>
              <div className="mapa-chuva-fontes">
                <button
                  className={`mapa-chuva-fonte-btn ${mostrarNuvensGoes ? 'ativo' : ''}`}
                  onClick={() => setMostrarNuvensGoes(v => !v)}
                  aria-pressed={mostrarNuvensGoes}
                  disabled={!templateTilesHttpsValido(GOES_CLOUD_TILE_URL)}
                  title={templateTilesHttpsValido(GOES_CLOUD_TILE_URL)
                    ? 'Mostrar imagens de nuvens GOES'
                    : 'Configure VITE_GOES_CLOUD_TILES_URL com um template HTTPS de tiles'}
                >
                  ☁️ Nuvens GOES
                </button>
                <span>
                  {templateTilesHttpsValido(GOES_CLOUD_TILE_URL)
                    ? 'Imagem de nuvens · independente da chuva'
                    : 'Fonte de tiles GOES não configurada'}
                </span>
              </div>
              <div className="mapa-chuva-fontes">
                <button
                  className={`mapa-chuva-fonte-btn ${mostrarChuva ? 'ativo' : ''}`}
                  onClick={() => setMostrarChuva(v => !v)}
                  aria-pressed={mostrarChuva}
                >
                  🌧️ Radar RainViewer
                </button>
                <span>Precipitação observada · atualização automática a cada 5 min</span>
              </div>
              <div className="mapa-chuva-fontes">
                <button
                  className={`mapa-chuva-fonte-btn ${mostrarIntensidadeCemaden ? 'ativo' : ''}`}
                  onClick={() => setMostrarIntensidadeCemaden(v => !v)}
                  aria-pressed={mostrarIntensidadeCemaden}
                >
                  🌈 Estações CEMADEN
                </button>
                <span>Leituras oficiais · acumulado na última hora (mm)</span>
              </div>
              <div className="mapa-chuva-opacidades">
                <label>
                  Nuvens <input type="range" min="0.35" max="0.70" step="0.05" value={opacidadeNuvensGoes} onChange={e => setOpacidadeNuvensGoes(Number(e.target.value))} />
                  <output>{Math.round(opacidadeNuvensGoes * 100)}%</output>
                </label>
                <label>
                  Radar <input type="range" min="0.35" max="0.90" step="0.05" value={opacidadeRadar} onChange={e => setOpacidadeRadar(Number(e.target.value))} />
                  <output>{Math.round(opacidadeRadar * 100)}%</output>
                </label>
                <label>
                   Superfície <input type="range" min="0.35" max="0.70" step="0.05" value={opacidadeCemaden} onChange={e => setOpacidadeCemaden(Number(e.target.value))} />
                  <output>{Math.round(opacidadeCemaden * 100)}%</output>
                </label>
              </div>
              {radarChuvaCarregando && !radarChuva && (
                <div className="mapa-chuva-status">⏳ Carregando o último quadro do radar…</div>
              )}
              {radarChuvaErro && (
                <div className="mapa-chuva-status mapa-chuva-status--erro">{radarChuvaErro}</div>
              )}
              <div className="mapa-chuva-resumo">
                <div>
                  <span className="mapa-chuva-resumo-label">Radar</span>
                  <strong>
                    {radarChuva ? horaChuva(radarChuva.atualizadoEm) : '—'}
                    <small className="mapa-chuva-quadro-tipo">RainViewer · observado</small>
                  </strong>
                </div>
                <div>
                  <span className="mapa-chuva-resumo-label">CEMADEN</span>
                  <strong>
                    {horaChuva(cemadenAtualizadoEm)}
                    <small className="mapa-chuva-quadro-tipo">última atualização</small>
                  </strong>
                </div>
                <div>
                  <span className="mapa-chuva-resumo-label">Nuvens</span>
                  <strong>
                    {templateTilesHttpsValido(GOES_CLOUD_TILE_URL) ? 'Fonte configurada' : 'Indisponível'}
                    <small className="mapa-chuva-quadro-tipo">
                      {templateTilesHttpsValido(GOES_CLOUD_TILE_URL)
                        ? 'GOES · horário não informado pela fonte'
                        : 'sem tiles HTTPS'}
                    </small>
                  </strong>
                </div>
                <div>
                  <span className="mapa-chuva-resumo-label">Maior leitura (1h)</span>
                  <strong className={intensidadeEstimada && intensidadeEstimada > 0 ? 'chovendo' : ''}>
                    {valorChuvaFormatado(intensidadeEstimada)}
                    <small className="mapa-chuva-quadro-tipo">{situacaoChuva(intensidadeEstimada)}</small>
                  </strong>
                </div>
              </div>
              <div className="mapa-chuva-legenda">
                <span><i className="chuva-cor chuva-cor--fraca" /> fraca</span>
                <span><i className="chuva-cor chuva-cor--moderada" /> moderada</span>
                <span><i className="chuva-cor chuva-cor--forte" /> forte</span>
                <span><i className="chuva-cor chuva-cor--muito-forte" /> muito forte</span>
                <span><i className="chuva-cor chuva-cor--intensa" /> intensa</span>
                <span><i className="chuva-cor chuva-cor--extrema" /> extrema</span>
              </div>
              <p className="mapa-chuva-ajuda">
                O radar mostra a chuva que já foi observada se deslocando em direção à cidade.
                Para acompanhar se ela está chegando, observe as áreas coloridas se aproximando do círculo tracejado de 10 km.
                Ele não calcula sozinho o horário de chegada nem substitui uma previsão meteorológica.
                Os pontos no mapa são leituras reais das estações CEMADEN de Lafaiete, em mm acumulados na última hora.
                A superfície colorida é uma interpolação entre essas estações e não uma medição contínua.
              </p>
              {cemadenCarregando && <div className="mapa-chuva-status">⏳ Atualizando estações CEMADEN…</div>}
              {cemadenErro && <div className="mapa-chuva-status mapa-chuva-status--erro">{cemadenErro}. O mapa continua disponível.</div>}
              <div className="mapa-chuva-rodape">
                <span>{radarChuva?.erroAtualizacao ? 'Último radar salvo' : 'Weather data by RainViewer'}</span>
                <button
                  onClick={() => {
                    buscarRadarChuva()
                    buscarCemadenMapa()
                  }}
                  disabled={radarChuvaCarregando || cemadenCarregando}
                >
                  {radarChuvaCarregando || cemadenCarregando ? '⏳' : '↻'} Atualizar
                </button>
              </div>
            </div>
          )}
        </div>
        )}
        <button
          className={`mapa-camada-btn ${mostrarMateriais ? 'ativo' : ''}`}
          onClick={() => {
            if (mostrarMateriais) {
              setMostrarMateriais(false)
              setPainelMaterialAberto(false)
            } else {
              setMostrarMateriais(true)
              setPainelMaterialAberto(true)
            }
          }}
          title={`${equipamentosCampo.filter(c => c.status === 'ativo').length} em campo`}
        >
          🚧 Material{equipamentosCampo.filter(c => c.status === 'ativo').length > 0 ? ` (${equipamentosCampo.filter(c => c.status === 'ativo').length})` : ''}
        </button>
        <div className={`mapa-ocorr-wrap ${submenuFiltroAberto ? 'filtro-aberto' : ''}`}>
          <button
            className={`mapa-camada-btn ${mostrarOcorrencias ? 'ativo' : ''}`}
            onClick={() => {
              if (!mostrarOcorrencias) setMostrarOcorrencias(true)
              setSubmenuFiltroAberto(v => !v)
              setSelecionada(null)
            }}
            aria-pressed={mostrarOcorrencias}
            aria-expanded={submenuFiltroAberto}
            title="Mostrar ocorrências e abrir filtro por natureza"
          >
            📋 Ocorrências {submenuFiltroAberto && '▾'}
          </button>

          {submenuFiltroAberto && (
            <div className="mapa-ocorr-submenu" onClick={(e) => e.stopPropagation()}>
              <div className="mapa-ocorr-submenu-header">
                <span>Filtrar tipos</span>
                <button onClick={() => setSubmenuFiltroAberto(false)} aria-label="Fechar">✕</button>
              </div>

              <div className="mapa-ocorr-submenu-acoes">
                <button onClick={() => { setMostrarOcorrencias(true); setNaturezasOcultas(new Set()) }}>
                  ✓ Marcar todas
                </button>
                <button onClick={() => setNaturezasOcultas(new Set(NATUREZAS))}>
                  ✕ Desmarcar todas
                </button>
                <button
                  className={mostrarOcorrencias ? 'mapa-ocorr-submenu-toggle on' : 'mapa-ocorr-submenu-toggle off'}
                  onClick={() => setMostrarOcorrencias(v => !v)}
                >
                  {mostrarOcorrencias ? '👁 Ocultar todas' : '👁‍🗨 Mostrar no mapa'}
                </button>
              </div>

              <div className="mapa-ocorr-submenu-lista">
                {NATUREZAS.map(n => {
                  const visivel = !naturezasOcultas.has(n)
                  const total = ocorrencias.filter(o => o.natureza === n).length
                  return (
                    <label key={n} className={`mapa-ocorr-submenu-item ${visivel ? '' : 'desativado'}`}>
                      <input
                        type="checkbox"
                        checked={visivel}
                        onChange={() => alternarNatureza(n)}
                      />
                      <span
                        className="mapa-ocorr-submenu-cor"
                        style={{ background: NATUREZA_COR[n] ?? '#1a4b8c' }}
                      >
                        {NATUREZA_ICONE[n] ?? '📋'}
                      </span>
                      <span className="mapa-ocorr-submenu-nome">{n}</span>
                      <span className="mapa-ocorr-submenu-qtd">{total}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Painel de equipamentos em campo — aparece quando o botão Material está ativo */}
      {mostrarMateriais && painelMaterialAberto && (
        <div className="mapa-material-painel">
          <div className="mapa-material-painel-header">
            <span>🚧 Equipamentos em Campo</span>
            <button className="mapa-material-painel-fechar" onClick={() => setPainelMaterialAberto(false)}>✕</button>
          </div>
          {equipamentosCampo.filter(c => c.status === 'ativo').length === 0 ? (
            <p className="mapa-material-painel-vazio">Nenhum equipamento ativo em campo.</p>
          ) : (
            <div className="mapa-material-painel-lista">
              {equipamentosCampo.filter(c => c.status === 'ativo').map(c => (
                <div key={c.id} className="mapa-material-painel-item">
                  <span className="mapa-material-painel-nome">🚧 {c.material_nome ?? 'Equipamento'}</span>
                  {(c.rua || c.bairro) ? (
                    <span className="mapa-material-painel-local">📍 {[c.rua, c.bairro].filter(Boolean).join(' — ')}</span>
                  ) : (
                    <span className="mapa-material-painel-sem-gps">📍 Localização não informada</span>
                  )}
                  {c.observacao && (
                    <span className="mapa-material-painel-obs">{c.observacao}</span>
                  )}
                  {!(c.latitude && c.longitude) && (
                    <span className="mapa-material-painel-sem-pin">Sem GPS — não aparece no mapa</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Barra de busca de endereço (estilo Google Maps, com autocomplete) */}
      <div className="mapa-busca">
        <div className="mapa-busca-input-wrap">
          <span className="mapa-busca-icone">{buscandoEndereco ? '⏳' : '🔍'}</span>
          <input
            type="text"
            className="mapa-busca-input"
            placeholder="Digite a rua e o número (ex.: Rua das Flores, 123)"
            value={enderecoBusca}
            onChange={(e) => setEnderecoBusca(e.target.value)}
            autoComplete="off"
          />
          {(enderecoBusca || destino) && (
            <button
              className="mapa-busca-limpar"
              onClick={limparBuscaERota}
              title="Limpar busca e rota"
            >✕</button>
          )}
        </div>

        {!estaOnline && !malhaInfo.baixada && (
          <div className="mapa-busca-aviso">
            📵 Sem internet e sem mapa de ruas salvo. Conecte ou baixe o mapa offline.
          </div>
        )}
        {!estaOnline && malhaInfo.baixada && (
          <div className="mapa-busca-aviso" style={{ background: '#dcfce7', borderColor: '#86efac', color: '#166534' }}>
            📵 Sem internet — buscando nas ruas salvas offline.
          </div>
        )}

        {resultadosBusca.length > 0 && (
          <div className="mapa-busca-resultados">
            {resultadosBusca.map((r, i) => (
              <button
                key={i}
                className="mapa-busca-resultado"
                onClick={() => escolherDestino(r)}
              >
                <span className="mapa-busca-resultado-icone">📍</span>
                <span className="mapa-busca-resultado-texto">{r.display}</span>
              </button>
            ))}
          </div>
        )}

        {destino && rotaInfo && (
          <div className="mapa-rota-info">
            {calculandoRota ? (
              <span>⏳ Calculando rota…</span>
            ) : (
              <>
                <span className="mapa-rota-info-titulo">🚗 Rota até o destino</span>
                <span className="mapa-rota-info-stats">
                  {rotaInfo.km.toFixed(1)} km · {rotaInfo.min} min
                </span>
                <span className="mapa-rota-info-origem">
                  {posicaoAtual ? 'Saindo da sua posição GPS' : 'Saindo do centro de Conselheiro Lafaiete — ative o GPS para rota real'}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Botão GPS */}
      <button
        className={`mapa-gps-btn mapa-gps-btn--${statusGps}`}
        onClick={centralizarOuTentarGps}
        title={statusGps === 'ativo' ? 'Centralizar na posição do agente' : 'Tentar GPS novamente'}
        aria-label={statusGps === 'ativo' ? 'Centralizar na posição atual do agente' : 'Ativar ou tentar novamente o GPS'}
      >
        {statusGps === 'aguardando' ? (
          <span className="mapa-gps-spinner" />
        ) : (
          <span className="mapa-gps-icon">
            {statusGps === 'ativo' ? '📡' : statusGps === 'erro' ? '⚠️' : '🛰️'}
          </span>
        )}
        <span className="mapa-gps-label">
          {statusGps === 'inativo' && 'Ativar GPS'}
          {statusGps === 'aguardando' && 'Aguardando…'}
          {statusGps === 'ativo' && 'Minha posição'}
          {statusGps === 'erro' && 'Tentar GPS'}
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
                <span className="mapa-equipe-nome">{nomeLocal} <em>(você)</em></span>
                <span className="mapa-equipe-status">
                  {statusGps === 'ativo'
                    ? '🟢 GPS atualizado; visível para todos'
                    : statusGps === 'aguardando'
                      ? '🟡 Atualizando sua posição…'
                      : statusGps === 'erro'
                        ? '🔴 GPS indisponível; mantendo a última posição'
                        : '⚪ GPS aguardando ativação'}
                </span>
              </div>
            </div>

            {/* Outros dispositivos */}
            {dispositivosArray.length === 0 && statusGps !== 'ativo' && (
              <div className="mapa-offline-info mapa-offline-info--aviso">
                Você já está conectado e vai ver as outras equipes que ativarem o GPS. Para aparecer no mapa dos colegas, ative seu GPS.
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
            <span>📥 Mapa Offline — Conselheiro Lafaiete</span>
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
                disabled={!estaOnline}
              >
                {estaOnline
                  ? tilesCacheados > 0 ? '🔄 Atualizar mapa offline' : '📥 Salvar mapa de Conselheiro Lafaiete'
                  : '📵 Sem conexão para baixar'}
              </button>
            )}
            {tilesCacheados > 0 && statusOffline !== 'baixando' && (
              <button className="mapa-offline-btn-limpar" onClick={limparMapa}>
                🗑 Apagar mapa salvo
              </button>
            )}
            <div className="mapa-offline-aviso">
              Cobre raio de 10 km ao redor do centro de Conselheiro Lafaiete — MG (cidade + entorno imediato). O GPS funciona offline pelo hardware do aparelho.
            </div>

            {/* ── Malha viária offline (ruas + roteamento) ── */}
            <div style={{ height: 1, background: '#e5e7eb', margin: '12px 0' }} />
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1a4b8c', marginBottom: 6 }}>
              🛣️ Ruas e roteamento offline
            </div>

            {malhaInfo.baixada && (
              <div className="mapa-offline-info">
                ✅ Malha viária salva ({(malhaInfo.bytes / (1024 * 1024)).toFixed(1)} MB) — busca de endereços e rota funcionam offline
              </div>
            )}
            {!malhaInfo.baixada && statusMalha !== 'baixando' && (
              <div className="mapa-offline-info mapa-offline-info--aviso">
                📵 Ruas não salvas. Sem internet, a busca de endereço não vai funcionar.
              </div>
            )}
            {statusMalha === 'baixando' && (
              <div className="mapa-offline-progresso">
                <div className="mapa-offline-barra-wrap">
                  <div
                    className="mapa-offline-barra"
                    style={{
                      width: progressoMalha?.status === 'concluido' ? '100%' : '60%',
                      transition: 'width 0.6s ease',
                    }}
                  />
                </div>
                <div className="mapa-offline-pct">
                  {progressoMalha?.status === 'iniciando' && 'Baixando ruas da Overpass…'}
                  {progressoMalha?.status === 'concluido' &&
                    `Concluído (${((progressoMalha.bytes ?? 0) / (1024 * 1024)).toFixed(1)} MB)`}
                </div>
              </div>
            )}
            {statusMalha === 'erro' && (
              <div className="mapa-offline-info mapa-offline-info--aviso">
                ⚠️ {progressoMalha?.mensagem || 'Falha ao baixar a malha viária. Tente novamente.'}
              </div>
            )}
            {statusMalha !== 'baixando' && (
              <button
                className="mapa-offline-btn-acao"
                onClick={iniciarDownloadMalha}
                disabled={!estaOnline}
                style={{ marginTop: 6 }}
              >
                {estaOnline
                  ? malhaInfo.baixada ? '🔄 Atualizar ruas offline' : '📥 Baixar ruas e endereços'
                  : '📵 Sem conexão para baixar'}
              </button>
            )}
            <div className="mapa-offline-aviso">
              Baixa a base de ruas/estradas (raio 10 km) da OpenStreetMap.
              Permite buscar endereços e calcular rotas sem internet.
            </div>
          </div>
        </div>
      )}

      {/* Painel GPS ativo */}
      {posicaoAtual && statusGps !== 'inativo' && (
        <div className={`mapa-gps-info mapa-gps-info--${statusGps}`}>
          <div className="mapa-gps-info-row">
            <span className={`mapa-gps-info-dot mapa-gps-info-dot--${statusGps}`} />
            <span className="mapa-gps-info-text">
              {statusGps === 'ativo'
                ? precisao > 75
                  ? 'Ao vivo · precisão baixa'
                  : velocidadeKmh !== null ? `${velocidadeKmh} km/h` : 'GPS ao vivo'
                : statusGps === 'aguardando' ? 'Atualizando posição…' : 'Última posição mantida'}
            </span>
            <span className="mapa-gps-info-sep">·</span>
            <span className="mapa-gps-info-text">±{Math.round(precisao)} m</span>
            {ultimaAtualizacaoGps != null && statusGps !== 'ativo' && (
              <>
                <span className="mapa-gps-info-sep">·</span>
                <span className="mapa-gps-info-text">
                  {Math.max(0, Math.floor((Date.now() - ultimaAtualizacaoGps) / 1000))}s atrás
                </span>
              </>
            )}
            {statusGps === 'ativo' && (
              <>
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
            <strong>⚠️ Localização indisponível</strong>
            <span>{erroGps}</span>
            <small>Depois de liberar no navegador/celular, toque no botão GPS novamente.</small>
          </div>
          <button onClick={() => setErroGps(null)} aria-label="Fechar aviso de localização">✕</button>
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
            {selecionada.situacao && <div className="mapa-painel-end">📝 {selecionada.situacao}</div>}
            <div className="mapa-painel-data">🕐 {new Date(selecionada.created_at).toLocaleString('pt-BR')}</div>
            {selecionada.origem === 'curral' ? (
              <div className="mapa-painel-end" style={{ marginTop: 8, color: '#7c3aed', fontWeight: 700 }}>
                🐾 Registro completo disponível na aba Curral.
              </div>
            ) : (
              <button className="mapa-painel-btn" onClick={() => { onSelecionar(selecionada); setSelecionada(null) }}>
                Ver detalhes completos →
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
