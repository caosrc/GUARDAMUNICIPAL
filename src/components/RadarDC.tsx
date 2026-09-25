import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Pane, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import './RadarDC.css'
import './RadarDCResponsive.css'
import 'leaflet/dist/leaflet.css'
import { getAgenteLogado } from './Login'
import { agentePodeGerenciarCriacao, getSenhaAgente } from '../types'
import { wsOn, wsSend } from '../wsClient'
import { supabase, supabaseDisponivel } from '../supabaseClient'
import { AGENTES } from '../types'
import { ehFerramentalPorLitro } from '../ferramentalUtils'
import { ChartaChuva, GraficoNivel, type EstacaoCNL, type LeituraCNL, type PontoNivel, type PontoSerie } from './MonitoramentoCNL'
import './MonitoramentoCNL.css'
import ModalSenha from './ModalSenha'

type Prioridade = 'normal' | 'importante' | 'urgente'
type ConfirmacaoRadar = { agente: string; confirmado: boolean; confirmedAt?: string }
type RegistroRadar = {
  id: string; texto: string; data: string; hora: string; prioridade: Prioridade
  concluido: boolean; criadoPor: string; criadoEm: string; tipo: 'lembrete' | 'notificacao'
  agentesEnvolvidos: string[]; confirmacoesAgentes: ConfirmacaoRadar[]
}
type Atividade = {
  id: number; agente: string; hora: string; placa?: string; natureza?: string
  endereco?: string; km?: string | number; nivelCombustivel?: string
  itens?: unknown; fotoCarregada?: boolean; created_at: string
}
type AtividadeFerramenta = {
  id: number; ferramentaId: string; agente: string; ferramentaNome: string
  quantidadeCadastrada?: number; quantidadeConferida?: number
  condicao: 'boa' | 'media' | 'ruim' | 'quantidade' | string; itemFaltante?: string; justificativa?: string
  data_checklist: string; created_at: string
}
type FerramentaCatalogo = { id: string; nome: string; quantidade: number }
type ResumoFerramental = {
  agente: string; tiposVerificados: number; totalTipos: number
  itensConferidos: number; itensCadastrados: number
  boa: number; media: number; ruim: number
  ferramentasRuins: string[]; faltantes: string[]; semChecklist: string[]; serragemAlertas: string[]; litrosAlertas: string[]
}

type DiaPrevisao = { data: string; codigo: number; temperaturaMax: number; temperaturaMin: number; precipitacao: number; probabilidade: number; umidade: number; vento: number; rajada: number }
type HoraPrevisao = { time: string; codigo: number; temperatura: number; probabilidade: number; precipitacao: number; vento: number }
type TempoDC = { atual: { codigo: number; temperatura: number; chuva: number; vento: number; rajada: number; umidade: number }; horas: HoraPrevisao[]; dias: DiaPrevisao[] }
type EstadoVisualTempo = 'normal' | 'quente' | 'frio' | 'chuva' | 'trovoada' | 'seco' | 'baixa-umidade'
type CenaClima = 'nublado' | 'chuva-fraca' | 'ensolarado' | 'chuva-forte' | 'nuvem-e-sol' | 'raios' | 'frio' | 'chuva-frio'
type DadosRadarCNL = {
  estacao: LeituraCNL
  estacoes: RadarEstacaoCNL[]
  serie: PontoSerie[]
  serieChuvaCentro?: PontoSerie[]
  estacaoChuvaCentro?: { nome: string; codigo?: string } | null
  serieNivel: PontoNivel[]
}
type RadarEstacaoCNL = EstacaoCNL & {
  latitude: number | null
  longitude: number | null
}

type DadosRadarChuvaLive = {
  host: string
  path: string
  tileUrl?: string
  frameTime: number
  atualizadoEm: string
  erroAtualizacao?: boolean
}

const CONSELHEIRO_LAFAIETE = { latitude: -20.6604, longitude: -43.7863 }
const RADAR_MAP_CENTER: [number, number] = [CONSELHEIRO_LAFAIETE.latitude, CONSELHEIRO_LAFAIETE.longitude]
const RADAR_MAP_ZOOM = 12
const RADAR_CHUVA_RAIO_METROS = 10_000
// Serviço público NOAA/NNVL com imagens infravermelhas diárias do GOES.
// A variável de ambiente continua disponível para trocar a fonte sem alterar o código.
const GOES_CLOUD_TILE_URL = String(
  import.meta.env.VITE_GOES_CLOUD_TILES_URL
    || 'https://gis.nnvl.noaa.gov/arcgis/rest/services/GOES/GOES_current/ImageServer/tile/{z}/{y}/{x}',
).trim()
const nomesTempo: Record<number, string> = { 0: 'Céu limpo', 1: 'Predominantemente limpo', 2: 'Parcialmente nublado', 3: 'Nublado', 45: 'Neblina', 48: 'Neblina com gelo', 51: 'Garoa leve', 53: 'Garoa moderada', 55: 'Garoa intensa', 61: 'Chuva leve', 63: 'Chuva moderada', 65: 'Chuva forte', 71: 'Neve leve', 73: 'Neve moderada', 75: 'Neve forte', 80: 'Pancadas leves', 81: 'Pancadas moderadas', 82: 'Pancadas fortes', 95: 'Trovoada', 96: 'Trovoada com granizo', 99: 'Trovoada forte' }
function horarioNoturno(time?: string) {
  const hora = Number(time?.slice(11, 13))
  return Number.isFinite(hora) && (hora >= 18 || hora < 6)
}
function iconeTempo(codigo: number, time?: string) {
  const noturno = horarioNoturno(time)
  if (codigo >= 95) return '⛈️'
  if (codigo >= 80) return '🌦️'
  if (codigo >= 51) return '🌧️'
  if (codigo >= 45) return '🌫️'
  if (codigo >= 2) return noturno ? '☁️' : '⛅'
  return noturno ? '🌙' : '☀️'
}
function estadosVisuaisTempo(tempo: TempoDC): EstadoVisualTempo[] {
  const atual = tempo.atual
  const hoje = tempo.dias[0]
  const proximasHoras = tempo.horas.slice(0, 6)
  const maiorProbabilidade = Math.max(
    hoje?.probabilidade || 0,
    ...proximasHoras.map(hora => hora.probabilidade || 0),
  )
  const haTrovoada = atual.codigo >= 95 || proximasHoras.some(hora => hora.codigo >= 95)
  const haChuva = atual.codigo >= 51 || atual.chuva > 0.1 || maiorProbabilidade >= 60
  const estaQuente = atual.temperatura >= 30 || (hoje && atual.temperatura - hoje.temperaturaMin >= 8)
  const estaFrio = atual.temperatura <= 17 || (hoje && hoje.temperaturaMax - atual.temperatura >= 8)
  const estaSeco = !haChuva && atual.temperatura >= 28 && atual.umidade <= 45
  const umidadeBaixa = atual.umidade <= 45
  const estados: EstadoVisualTempo[] = []
  if (haTrovoada) estados.push('trovoada')
  else if (haChuva) estados.push('chuva')
  if (estaQuente) estados.push('quente')
  if (estaFrio) estados.push('frio')
  if (estaSeco) estados.push('seco')
  if (umidadeBaixa) estados.push('baixa-umidade')
  return estados.length > 0 ? estados : ['normal']
}
function cenaClimaTempo(tempo: TempoDC): { tipo: CenaClima; caminho: string; nome: string } {
  const codigo = tempo.atual.codigo
  const estaChovendo = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 80, 81, 82].includes(codigo)
    || tempo.atual.chuva > 0.1
  // A cena grande do cartão acompanha a condição atual, não apenas a
  // previsão do dia. Os códigos seguem a classificação WMO usada pelo
  // Open-Meteo.
  if ([95, 96, 99].includes(codigo)) {
    return { tipo: 'raios', caminho: '/weather-scenes/raios.jpg', nome: 'COM RAIOS' }
  }
  if (estaChovendo && tempo.atual.temperatura <= 17) {
    return { tipo: 'chuva-frio', caminho: '/weather-scenes/chuva-frio.jpg', nome: 'CHUVA E FRIO' }
  }
  if ([65, 67, 75, 82].includes(codigo) || tempo.atual.chuva >= 4) {
    return { tipo: 'chuva-forte', caminho: '/weather-scenes/chuva-forte.jpg', nome: 'CHUVA FORTE' }
  }
  if (tempo.atual.temperatura <= 17) {
    return { tipo: 'frio', caminho: '/weather-scenes/frio.jpg', nome: 'FRIO' }
  }
  if (estaChovendo) {
    return { tipo: 'chuva-fraca', caminho: '/weather-scenes/chuva-fraca.jpg', nome: 'CHUVA FRACA' }
  }
  if ([3, 45, 48].includes(codigo)) {
    return { tipo: 'nublado', caminho: '/weather-scenes/nublado.jpg', nome: 'NUBLADO' }
  }
  if ([1, 2].includes(codigo)) {
    return { tipo: 'nuvem-e-sol', caminho: '/weather-scenes/nuvem-e-sol.jpg', nome: 'COM NUVEM E SOL' }
  }
  return { tipo: 'ensolarado', caminho: '/weather-scenes/ensolarado.jpg', nome: 'ENSOLARADO' }
}
function dataTempo(data: string) { return new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }

const STORAGE_KEY = 'defesacivil-radar-dc-v2'
const RADAR_TICKER_SPEED = 1.5
const prioridadeConfig: Record<Prioridade, { label: string; emoji: string }> = {
  normal: { label: 'Normal', emoji: '🟢' },
  importante: { label: 'Importante', emoji: '🟠' },
  urgente: { label: 'Urgente', emoji: '🔴' },
}

function dataLocalISO(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}
function hoje() { return dataLocalISO() }
function horaAgora() { return new Date().toTimeString().slice(0, 5) }
function dataBonita(data: string) {
  return data ? new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '') : 'Sem data'
}
function lerConfirmacoes(valor: unknown): ConfirmacaoRadar[] {
  let dados = valor
  if (typeof dados === 'string') {
    try { dados = JSON.parse(dados) } catch { return [] }
  }
  if (!Array.isArray(dados)) return []
  return dados
    .filter(item => item && typeof item === 'object' && typeof item.agente === 'string')
    .map(item => ({ agente: String(item.agente), confirmado: item.confirmado === true, confirmedAt: typeof item.confirmedAt === 'string' ? item.confirmedAt : undefined }))
}
function disparar(nome: string, detail: unknown) {
  window.dispatchEvent(new CustomEvent(nome, { detail }))
}

function percentual(valor: number, total: number) {
  return total > 0 ? Math.round((valor / total) * 100) : 0
}

function formatarMmRadar(valor: number | null | undefined) {
  return valor == null || !Number.isFinite(valor)
    ? '—'
    : `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mm`
}

function formatarMmMapaRadar(valor: number | null | undefined) {
  const numero = valor != null && Number.isFinite(valor) ? valor : 0
  return `${numero.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`
}

function templateTilesHttpsValido(url: string) {
  return /^https:\/\//i.test(url) && ['{z}', '{x}', '{y}'].every(token => url.includes(token))
}

function intensidadeCemadenRadar(valor: number | null | undefined) {
  if (valor == null || !Number.isFinite(valor) || valor <= 0) return { cor: '#38bdf8', alpha: 0 }
  if (valor <= 2) return { cor: '#38bdf8', alpha: 0.48 }
  if (valor <= 10) return { cor: '#22c55e', alpha: 0.5 }
  if (valor <= 30) return { cor: '#facc15', alpha: 0.52 }
  if (valor <= 50) return { cor: '#f97316', alpha: 0.56 }
  if (valor <= 80) return { cor: '#ef4444', alpha: 0.6 }
  return { cor: '#a855f7', alpha: 0.64 }
}

function dataHoraRadar(valor?: string | null) {
  if (!valor) return 'Sem leitura'
  const brasileiro = valor.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})/)
  if (brasileiro) {
    const ano = brasileiro[3].length === 2 ? `20${brasileiro[3]}` : brasileiro[3]
    return `${brasileiro[1]}/${brasileiro[2]}/${ano} ${brasileiro[4]}:${brasileiro[5]}`
  }
  return valor
}

function RadarMapInvalidateSize({ tv }: { tv: boolean }) {
  const map = useMap()
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => map.invalidateSize())
    return () => window.cancelAnimationFrame(frame)
  }, [map, tv])
  return null
}

function RadarMapaTempoReal({ dadosCNL, tv }: { dadosCNL: DadosRadarCNL | null; tv: boolean }) {
  const [camadaBase, setCamadaBase] = useState<'mapa' | 'satelite'>('mapa')
  const [radarChuva, setRadarChuva] = useState<DadosRadarChuvaLive | null>(null)
  const [radarErro, setRadarErro] = useState('')
  const [radarCarregando, setRadarCarregando] = useState(false)
  const [mostrarChuva, setMostrarChuva] = useState(true)
  const [mostrarNuvens] = useState(false)

  const carregarRadarChuva = useCallback(async () => {
    setRadarCarregando(true)
    try {
      const resposta = await fetch(`/api/radar-chuva?_ts=${Date.now()}`, { cache: 'no-store' })
      const corpo = await resposta.json().catch(() => ({}))
      if (!resposta.ok || typeof corpo?.host !== 'string' || typeof corpo?.path !== 'string') {
        throw new Error('Radar indisponível')
      }
      setRadarChuva({
        host: corpo.host,
        path: corpo.path,
        tileUrl: typeof corpo.tileUrl === 'string' ? corpo.tileUrl : undefined,
        frameTime: Number(corpo.frameTime),
        atualizadoEm: typeof corpo.atualizadoEm === 'string' ? corpo.atualizadoEm : '',
        erroAtualizacao: corpo.erroAtualizacao === true,
      })
      setRadarErro('')
    } catch (error) {
      setRadarErro(error instanceof Error ? error.message : 'Radar indisponível')
    } finally {
      setRadarCarregando(false)
    }
  }, [])

  useEffect(() => {
    carregarRadarChuva()
    const timer = window.setInterval(carregarRadarChuva, 5 * 60 * 1000)
    const atualizarAoVoltar = () => {
      if (document.visibilityState === 'visible') carregarRadarChuva()
    }
    document.addEventListener('visibilitychange', atualizarAoVoltar)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', atualizarAoVoltar)
    }
  }, [carregarRadarChuva])

  const estacoes = dadosCNL?.estacoes || []
  const tileRadar = radarChuva?.tileUrl || (radarChuva ? `${radarChuva.host}${radarChuva.path}/256/{z}/{x}/{y}/2/1_0.png` : '')

  return (
    <section className="radar-live-map-card" aria-labelledby="radar-live-map-title">
      <div className="radar-live-map-heading">
        <div>
          <span className="card-label">MAPA METEOROLÓGICO</span>
          <h3 id="radar-live-map-title">Conselheiro Lafaiete em tempo real</h3>
        </div>
        <span className="radar-live-map-updated">
          {radarCarregando ? 'Atualizando…' : radarChuva?.erroAtualizacao ? 'Último quadro salvo' : 'Atualização automática · 5 min'}
        </span>
      </div>
      <div className="radar-live-map-toolbar" role="toolbar" aria-label="Controles do mapa meteorológico">
        <div className="radar-live-map-base-buttons">
          <button type="button" className={camadaBase === 'mapa' ? 'ativo' : ''} onClick={() => setCamadaBase('mapa')}>Mapa</button>
          <button type="button" className={camadaBase === 'satelite' ? 'ativo' : ''} onClick={() => setCamadaBase('satelite')}>Satélite</button>
        </div>
        <button type="button" className={`radar-live-map-layer-button ${mostrarChuva ? 'ativo chuva' : ''}`} onClick={() => setMostrarChuva(prev => !prev)} aria-pressed={mostrarChuva}>
          🌧️ Chuva {mostrarChuva ? 'ativa' : 'desativada'}
        </button>
        <button
          type="button"
          className={`radar-live-map-layer-button ${mostrarNuvens ? 'ativo nuvens' : ''}`}
          disabled
          aria-pressed={mostrarNuvens}
          title="Camada de nuvens desabilitada neste mapa"
        >
          ☁️ Nuvens
        </button>
      </div>
      <div className="radar-live-map-status">
        <span><i className="radar-live-map-status-dot radar-live-map-status-dot-rain" /> Chuva observada</span>
        <span><i className="radar-live-map-status-dot radar-live-map-status-dot-station" /> Estações CEMADEN</span>
        <span><i className="radar-live-map-status-dot radar-live-map-status-dot-area" /> Raio de 10 km</span>
        {radarErro && <strong>{radarErro}</strong>}
      </div>
      <MapContainer
        className="radar-live-map"
        center={RADAR_MAP_CENTER}
        zoom={RADAR_MAP_ZOOM}
        minZoom={8}
        maxZoom={18}
        scrollWheelZoom
        zoomControl
      >
        <RadarMapInvalidateSize tv={tv} />
        {camadaBase === 'mapa' ? (
          <TileLayer
            key="radar-live-base-map"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            subdomains={['a', 'b', 'c']}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxZoom={19}
          />
        ) : (
          <TileLayer
            key="radar-live-base-satellite"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
            maxNativeZoom={17}
            maxZoom={18}
          />
        )}
        {mostrarNuvens && templateTilesHttpsValido(GOES_CLOUD_TILE_URL) && (
          <Pane name="radarLiveClouds" style={{ zIndex: 410 }}>
            <TileLayer
              key={`radar-live-clouds-${GOES_CLOUD_TILE_URL}`}
              url={GOES_CLOUD_TILE_URL}
              opacity={0.55}
              maxNativeZoom={8}
              maxZoom={18}
              attribution='Cloud imagery &copy; <a href="https://gis.nnvl.noaa.gov/arcgis/rest/services/GOES/GOES_current/ImageServer" target="_blank" rel="noreferrer">NOAA GOES</a>'
            />
          </Pane>
        )}
        {mostrarChuva && tileRadar && (
          <Pane name="radarLiveRain" style={{ zIndex: 420 }}>
            <TileLayer
              key={`radar-live-rain-${radarChuva?.frameTime || 'none'}`}
              url={tileRadar}
              opacity={0.72}
              maxNativeZoom={7}
              maxZoom={18}
              tileSize={256}
              attribution='Weather data by <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>'
            />
          </Pane>
        )}
        {mostrarChuva && (
          <Circle
            center={RADAR_MAP_CENTER}
            radius={RADAR_CHUVA_RAIO_METROS}
            pathOptions={{ color: '#1d4ed8', weight: 2, opacity: 0.9, dashArray: '7 5', fillColor: '#60a5fa', fillOpacity: 0.05 }}
          >
            <Popup>
              <strong>Área de observação da chuva</strong>
              <br />
              Raio de 10 km a partir do centro de Conselheiro Lafaiete
            </Popup>
          </Circle>
        )}
        {mostrarChuva && estacoes.filter(estacao => Number.isFinite(estacao.latitude) && Number.isFinite(estacao.longitude)).map(estacao => {
          const intensidade = intensidadeCemadenRadar(estacao.precipitacaoAtual)
          return (
            <CircleMarker
              key={`radar-live-station-${estacao.id}`}
              center={[estacao.latitude, estacao.longitude]}
              radius={8}
              pathOptions={{ color: '#fff', weight: 2, fillColor: intensidade.cor, fillOpacity: 0.95 }}
            >
              <Tooltip permanent direction="top" offset={[0, -7]} opacity={0.96} className="radar-live-map-tooltip">
                {formatarMmMapaRadar(estacao.precipitacaoAtual)}
              </Tooltip>
              <Popup>
                <strong>🌧️ {estacao.nome || 'Estação CEMADEN'}</strong>
                <br />
                Precipitação atual: <b>{formatarMmMapaRadar(estacao.precipitacaoAtual)}</b>
                <br />
                Leitura: {dataHoraRadar(estacao.precipitacaoDataHora)}
                {estacao.codigo ? <><br />Estação {estacao.codigo}</> : null}
              </Popup>
            </CircleMarker>
          )
        })}
        {mostrarChuva && (
          <CircleMarker center={RADAR_MAP_CENTER} radius={5} pathOptions={{ color: '#0f172a', weight: 2, fillColor: '#f8fafc', fillOpacity: 1 }}>
            <Popup>
              <strong>Centro de Conselheiro Lafaiete</strong>
              <br />
              Chuva observada e estações CEMADEN atualizadas automaticamente.
            </Popup>
          </CircleMarker>
        )}
      </MapContainer>
      <div className="radar-live-map-footer">
        <span>{dadosCNL ? `${estacoes.length} estação(ões) CEMADEN` : 'Consultando estações CEMADEN…'}</span>
        <span>{radarChuva?.atualizadoEm ? `Radar: ${new Date(radarChuva.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Radar: —'}</span>
        {!templateTilesHttpsValido(GOES_CLOUD_TILE_URL) && <span>Nuvens GOES: fonte não configurada</span>}
      </div>
    </section>
  )
}

function eSerragem(nome: string) {
  return /serragem/i.test(nome)
}

function eControlePorQuantidade(nome: string) {
  return eSerragem(nome) || ehFerramentalPorLitro(nome)
}

function resumirFerramental(
  registros: AtividadeFerramenta[],
  catalogo: FerramentaCatalogo[],
): ResumoFerramental[] {
  const catalogoComCondicao = catalogo.filter(item => !eControlePorQuantidade(item.nome))
  const totalTipos = catalogoComCondicao.length || new Set(
    registros.filter(item => !eControlePorQuantidade(item.ferramentaNome)).map(item => item.ferramentaId).filter(Boolean),
  ).size
  const catalogoPorId = new Map(catalogo.map(item => [item.id, item]))
  const porAgente = new Map<string, Map<string, AtividadeFerramenta>>()

  registros.forEach(registro => {
    const nomeAgente = registro.agente || 'Agente não informado'
    const ferramentaId = registro.ferramentaId || `registro-${registro.id}`
    const registrosDoAgente = porAgente.get(nomeAgente) || new Map<string, AtividadeFerramenta>()
    const anterior = registrosDoAgente.get(ferramentaId)
    if (!anterior || new Date(registro.created_at || registro.data_checklist).getTime() >= new Date(anterior.created_at || anterior.data_checklist).getTime()) {
      registrosDoAgente.set(ferramentaId, registro)
    }
    porAgente.set(nomeAgente, registrosDoAgente)
  })

  return Array.from(porAgente.entries()).map(([agente, registrosMap]) => {
    const registrosAgente = Array.from(registrosMap.values())
    const idsVerificados = new Set(registrosAgente.filter(item => !eControlePorQuantidade(item.ferramentaNome)).map(item => item.ferramentaId))
    const boa = registrosAgente.filter(item => !eControlePorQuantidade(item.ferramentaNome) && item.condicao === 'boa').length
    const media = registrosAgente.filter(item => !eControlePorQuantidade(item.ferramentaNome) && item.condicao === 'media').length
    const ruim = registrosAgente.filter(item => !eControlePorQuantidade(item.ferramentaNome) && item.condicao === 'ruim').length
    let itensCadastrados = 0
    let itensConferidos = 0
    const ferramentasRuins: string[] = []
    const faltantes: string[] = []
    const serragemAlertas: string[] = []
    const litrosAlertas: string[] = []

    registrosAgente.forEach(registro => {
      const catalogoItem = catalogoPorId.get(registro.ferramentaId)
      const cadastrada = Number(registro.quantidadeCadastrada) > 0
        ? Number(registro.quantidadeCadastrada)
        : Math.max(1, catalogoItem?.quantidade || 1)
      const conferida = registro.quantidadeConferida == null
        ? cadastrada
        : Math.max(0, Number(registro.quantidadeConferida))
      const quantidadeFaltante = Math.max(0, cadastrada - conferida)
      itensCadastrados += cadastrada
      itensConferidos += Math.min(cadastrada, conferida)
      if (ehFerramentalPorLitro(registro.ferramentaNome)) {
        if (conferida < 10) {
          litrosAlertas.push(`${conferida} litro(s) de ${registro.ferramentaNome} — Repor estoque`)
        }
        return
      }
      if (eSerragem(registro.ferramentaNome)) {
        if (conferida <= 2) serragemAlertas.push(`${conferida} saco(s) de serragem — Repor serragem`)
        return
      }
      if (registro.condicao === 'ruim') ferramentasRuins.push(registro.ferramentaNome)
      if (quantidadeFaltante > 0) {
        const nomeItem = String(registro.ferramentaNome || 'ferramental').trim()
        const ondeEsta = String(registro.itemFaltante || '').trim()
        const justificativa = String(registro.justificativa || '').trim()
        const explicacao = ondeEsta
          ? `Onde está: ${ondeEsta}`
          : `Justificativa: ${justificativa || 'não informada'}`
        faltantes.push(
          `${quantidadeFaltante} ${nomeItem} — ${explicacao}`,
        )
      }
    })

    const semChecklist = catalogoComCondicao
      .filter(item => !idsVerificados.has(item.id))
      .map(item => item.nome)
    return {
      agente, tiposVerificados: idsVerificados.size, totalTipos, itensConferidos, itensCadastrados,
      boa, media, ruim, ferramentasRuins: [...new Set(ferramentasRuins)],
      faltantes, semChecklist, serragemAlertas: [...new Set(serragemAlertas)],
      litrosAlertas: [...new Set(litrosAlertas)],
    }
  }).sort((a, b) => a.agente.localeCompare(b.agente))
}

function temFotoCarregada(itens: unknown) {
  let dados = itens
  if (typeof dados === 'string') {
    try { dados = JSON.parse(dados) } catch { return false }
  }
  if (!dados || typeof dados !== 'object') return false
  const registro = dados as Record<string, unknown>
  const fotos = registro._fotosCarregadas ?? registro.fotosCarregadas
  return Array.isArray(fotos) && fotos.length > 0
}

function tocarSininho() {
  try {
    if (typeof window === 'undefined' || !window.AudioContext) return
    const contexto = new window.AudioContext()
    const agora = contexto.currentTime
    ;[0, 0.16, 0.32].forEach((atraso, indice) => {
      const oscilador = contexto.createOscillator()
      const ganho = contexto.createGain()
      oscilador.type = 'triangle'
      oscilador.frequency.value = [659, 880, 1175][indice]
      ganho.gain.setValueAtTime(0.0001, agora + atraso)
      ganho.gain.exponentialRampToValueAtTime(0.16, agora + atraso + 0.025)
      ganho.gain.exponentialRampToValueAtTime(0.0001, agora + atraso + 0.72)
      oscilador.connect(ganho).connect(contexto.destination)
      oscilador.start(agora + atraso)
      oscilador.stop(agora + atraso + 0.76)
    })
    window.setTimeout(() => contexto.close().catch(() => {}), 1200)
  } catch { /* áudio pode estar bloqueado até interação */ }
}

export default function RadarGM() {
  const agente = getAgenteLogado() || 'Agente GM'
  const [registros, setRegistros] = useState<RegistroRadar[]>([])
  const [dataSelecionada, setDataSelecionada] = useState(hoje())
  const [mes, setMes] = useState(() => new Date(`${hoje()}T12:00:00`))
  const [textoLembrete, setTextoLembrete] = useState('')
  const [lembreteEditorAberto, setLembreteEditorAberto] = useState(false)
  const [textoNotificacao, setTextoNotificacao] = useState('')
  const [hora, setHora] = useState(horaAgora())
  const [prioridade, setPrioridade] = useState<Prioridade>('normal')
  const [agentesEnvolvidos, setAgentesEnvolvidos] = useState<string[]>([])
  const [agentesLembrete, setAgentesLembrete] = useState<string[]>([])
  const [editorAberto, setEditorAberto] = useState(false)
  const [tv, setTv] = useState(false)
  const [atividades, setAtividades] = useState<{
    checklists: Atividade[]
    checklistsFerramentas: AtividadeFerramenta[]
    ferramentasCatalogo: FerramentaCatalogo[]
    ocorrencias: Atividade[]
  }>({ checklists: [], checklistsFerramentas: [], ferramentasCatalogo: [], ocorrencias: [] })
  const [tempo, setTempo] = useState<TempoDC | null>(null)
  const [dadosCNL, setDadosCNL] = useState<DadosRadarCNL | null>(null)
  const [horaAtual, setHoraAtual] = useState(() => new Date())
  const [erroTempo, setErroTempo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [marcandoCienteId, setMarcandoCienteId] = useState<string | null>(null)
  const [erroSalvamento, setErroSalvamento] = useState('')
  const [lembreteParaApagar, setLembreteParaApagar] = useState<RegistroRadar | null>(null)
  const [registroEmEdicao, setRegistroEmEdicao] = useState<RegistroRadar | null>(null)
  const carregadoRef = useRef(false)
  const pendentesRef = useRef(new Set<string>())
  const ocorrenciasNotificadasRef = useRef(new Set<number>())
  const atividadesAssinaturaRef = useRef('')
  const calendarioRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setHoraAtual(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const carregar = useCallback(async () => {
    try {
      let rows: Array<Record<string, unknown>>
      if (supabaseDisponivel) {
        const result = await supabase.from('radar_bilhetes').select('*').order('data', { ascending: true }).order('hora', { ascending: true }).order('criado_em', { ascending: true })
        if (result.error) throw new Error(result.error.message)
        rows = (result.data || []) as Array<Record<string, unknown>>
      } else {
        const res = await fetch('/api/radar-bilhetes')
        if (!res.ok) throw new Error('Servidor do Radar indisponível.')
        rows = await res.json() as Array<Record<string, unknown>>
      }
      const remotos: RegistroRadar[] = rows.map(row => ({
        id: String(row.id), texto: String(row.texto), data: String(row.data), hora: String(row.hora),
        prioridade: (row.prioridade as Prioridade) || 'normal', concluido: Boolean(row.concluido),
        criadoPor: String(row.criado_por), criadoEm: String(row.criado_em),
        tipo: row.tipo === 'notificacao' ? ('notificacao' as const) : ('lembrete' as const),
        agentesEnvolvidos: Array.isArray(row.agentes_envolvidos) ? row.agentes_envolvidos.map(String) : [],
        confirmacoesAgentes: lerConfirmacoes(row.confirmacoes_agentes),
      }))
      setRegistros(prev => {
        const idsRemotos = new Set(remotos.map(row => row.id))
        const aindaPendentes = prev.filter(row => pendentesRef.current.has(row.id) && !idsRemotos.has(row.id))
        return [...remotos, ...aindaPendentes]
      })
      carregadoRef.current = true
    } catch {
      try {
        setRegistros(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'))
        carregadoRef.current = true
      } catch { setRegistros([]) }
    }
  }, [])

  const notificarOcorrenciasNovas = useCallback((ocorrencias: Atividade[], avisar: boolean) => {
    ocorrencias.forEach(ocorrencia => {
      if (!avisar) { ocorrenciasNotificadasRef.current.add(ocorrencia.id); return }
      if (ocorrenciasNotificadasRef.current.has(ocorrencia.id)) return
      ocorrenciasNotificadasRef.current.add(ocorrencia.id)
      if ('Notification' in window && Notification.permission === 'granted') {
        const detalhes = [ocorrencia.hora, ocorrencia.natureza || 'Ocorrência registrada', ocorrencia.endereco || 'Endereço não informado'].join(' · ')
        new Notification('Nova ocorrência no Radar GM', { body: detalhes, tag: 'radar-ocorrencia-' + ocorrencia.id })
      }
    })
  }, [])

  const atualizarAtividadesNaTela = useCallback((dados: {
    checklists: Atividade[]
    checklistsFerramentas: AtividadeFerramenta[]
    ferramentasCatalogo: FerramentaCatalogo[]
    ocorrencias: Atividade[]
  }, avisar: boolean) => {
    const assinatura = JSON.stringify({
      checklists: dados.checklists.map(item => [item.id, item.created_at, item.hora, item.placa, item.km, item.nivelCombustivel]),
      checklistsFerramentas: dados.checklistsFerramentas.map(item => [
        item.id, item.created_at, item.agente, item.ferramentaNome, item.condicao,
        item.quantidadeCadastrada, item.quantidadeConferida, item.itemFaltante, item.justificativa,
      ]),
      ocorrencias: dados.ocorrencias.map(item => [item.id, item.created_at, item.hora, item.natureza, item.endereco]),
    })
    const mudouDesdeUmaLeituraAnterior = Boolean(atividadesAssinaturaRef.current) && atividadesAssinaturaRef.current !== assinatura
    atividadesAssinaturaRef.current = assinatura
    setAtividades(dados)
    notificarOcorrenciasNovas(dados.ocorrencias, avisar)
    if (avisar || mudouDesdeUmaLeituraAnterior) tocarSininho()
  }, [notificarOcorrenciasNovas])

  const carregarAtividades = useCallback(async (avisar = false) => {
    try {
      if (supabaseDisponivel) {
        const proximoDia = new Date(`${dataSelecionada}T12:00:00`)
        proximoDia.setDate(proximoDia.getDate() + 1)
        const proximo = dataLocalISO(proximoDia)
        const [checklistsResult, checklistsFerramentasResult, ocorrenciasResult] = await Promise.all([
          // O checklist de viatura usa data; o de ferramental usa timestamptz.
          supabase.from('checklists_viatura').select('id,data_checklist,km,placa,motorista,itens,created_at').eq('data_checklist', dataSelecionada).order('created_at', { ascending: false }),
          supabase.from('checklists_ferramental').select('id,ferramenta_id,quantidade_cadastrada,quantidade_conferida,condicao,item_faltante,realizado_por,data_checklist,created_at').gte('data_checklist', `${dataSelecionada}T00:00:00-03:00`).lt('data_checklist', `${proximo}T00:00:00-03:00`).order('created_at', { ascending: false }),
          supabase.from('ocorrencias').select('id,natureza,endereco,agentes,responsavel_registro,created_at,hora_inicio,data_ocorrencia')
            .eq('data_ocorrencia', dataSelecionada)
            .order('created_at', { ascending: false }),
        ])
        // A tabela de ferramentas pode não existir em bases Supabase antigas.
        // Ela não deve impedir o carregamento das demais atividades do Radar.
        if (!checklistsResult.error && !ocorrenciasResult.error) {
          const checklistsFerramentas = checklistsFerramentasResult.error
            ? []
            : (checklistsFerramentasResult.data || []) as Array<Record<string, unknown>>
          const materiaisResult = await supabase
            .from('materiais')
            .select('id,nome,quantidade')
            .eq('categoria', 'ferramental')
          const nomesFerramentas = new Map((materiaisResult.data || []).map(row => [String(row.id), String(row.nome)]))
          const dados = {
            checklists: (checklistsResult.data || []).map(row => ({
              ...row,
              agente: row.motorista || 'Agente não informado',
              fotoCarregada: temFotoCarregada(row.itens),
              hora: row.data_checklist?.includes('T') ? row.data_checklist.slice(11, 16) : new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
              nivelCombustivel: row.itens && typeof row.itens === 'object' && 'nivelCombustivel' in row.itens
                ? String(row.itens.nivelCombustivel || '')
                : '',
            })) as Atividade[],
            checklistsFerramentas: checklistsFerramentas.map(row => ({
              id: Number(row.id),
              ferramentaId: String(row.ferramenta_id || ''),
              agente: String(row.realizado_por || 'Agente não informado'),
              ferramentaNome: nomesFerramentas.get(String(row.ferramenta_id)) || 'Ferramenta não informada',
              quantidadeCadastrada: Number(row.quantidade_cadastrada || 0),
              quantidadeConferida: Number(row.quantidade_conferida || 0),
              condicao: String(row.condicao || ''),
              itemFaltante: String(row.item_faltante || ''),
              justificativa: String(row.justificativa || ''),
              data_checklist: String(row.data_checklist || ''),
              created_at: String(row.created_at || row.data_checklist || ''),
            })),
            ferramentasCatalogo: (materiaisResult.data || []).map(row => ({
              id: String(row.id),
              nome: String(row.nome || 'Ferramenta não informada'),
              quantidade: Math.max(1, Number(row.quantidade || 1)),
            })),
            ocorrencias: (ocorrenciasResult.data || []).map(row => ({ ...row, agente: row.responsavel_registro || (Array.isArray(row.agentes) ? row.agentes[0] : null) || 'Agente não informado', hora: row.hora_inicio || new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) })) as Atividade[],
          }
           atualizarAtividadesNaTela(dados, avisar)
          return
        }
      }
      if (!supabaseDisponivel) {
        const res = await fetch(`/api/atividades-dia?data=${dataSelecionada}`)
        const ct = res.headers.get('content-type') || ''
        if (res.ok && ct.includes('application/json')) {
          const dados = await res.json() as {
            checklists: Atividade[]
            checklistsFerramentas: AtividadeFerramenta[]
            ferramentasCatalogo: FerramentaCatalogo[]
            ocorrencias: Atividade[]
          }
          atualizarAtividadesNaTela({
              ...dados,
              checklists: dados.checklists.map(c => ({ ...c, fotoCarregada: temFotoCarregada(c.itens) })),
            }, avisar)
        }
      }
    } catch { setAtividades({ checklists: [], checklistsFerramentas: [], ferramentasCatalogo: [], ocorrencias: [] }) }
  }, [dataSelecionada, atualizarAtividadesNaTela])


  useEffect(() => {
    let ativo = true
    const carregarTempo = async () => {
      try {
        const params = new URLSearchParams({ latitude: String(CONSELHEIRO_LAFAIETE.latitude), longitude: String(CONSELHEIRO_LAFAIETE.longitude), current: 'temperature_2m,weather_code,precipitation,relative_humidity_2m,wind_speed_10m,wind_gusts_10m', hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,relative_humidity_2m_min,wind_speed_10m_max,wind_gusts_10m_max', timezone: 'America/Sao_Paulo', forecast_days: '7', wind_speed_unit: 'kmh', precipitation_unit: 'mm' })
         const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params, { cache: 'no-store' })
        if (!res.ok) throw new Error('Serviço meteorológico indisponível.')
        const json = await res.json() as { current: Record<string, number>; hourly: Record<string, Array<string | number>>; daily: Record<string, Array<string | number>> }
        if (!ativo) return
        const hourly = json.hourly || {}
        const horas = (hourly.time || []).map((time, i) => ({
          time: String(time),
          codigo: Number(hourly.weather_code?.[i] ?? 0),
          temperatura: Number(hourly.temperature_2m?.[i] ?? 0),
          probabilidade: Number(hourly.precipitation_probability?.[i] ?? 0),
          precipitacao: Number(hourly.precipitation?.[i] ?? 0),
          vento: Number(hourly.wind_speed_10m?.[i] ?? 0),
        })).filter(h => new Date(h.time).getTime() >= Date.now()).slice(0, 12)
        setTempo({
          atual: { codigo: json.current.weather_code, temperatura: json.current.temperature_2m, chuva: json.current.precipitation, vento: json.current.wind_speed_10m, rajada: json.current.wind_gusts_10m, umidade: json.current.relative_humidity_2m },
          horas,
          dias: json.daily.time.map((data, i) => ({ data: String(data), codigo: Number(json.daily.weather_code[i]), temperaturaMax: Number(json.daily.temperature_2m_max[i]), temperaturaMin: Number(json.daily.temperature_2m_min[i]), precipitacao: Number(json.daily.precipitation_sum[i]), probabilidade: Number(json.daily.precipitation_probability_max[i]), umidade: Number(json.daily.relative_humidity_2m_min[i]), vento: Number(json.daily.wind_speed_10m_max[i]), rajada: Number(json.daily.wind_gusts_10m_max[i]) }))
        })
        setErroTempo('')
      } catch (error) {
        if (ativo) setErroTempo(error instanceof Error ? error.message : 'Não foi possível carregar o tempo.')
      }
    }
     carregarTempo()
     const timer = window.setInterval(carregarTempo, 5 * 60 * 1000)
     const atualizarAoVoltar = () => {
       if (document.visibilityState === 'visible') carregarTempo()
     }
     document.addEventListener('visibilitychange', atualizarAoVoltar)
     return () => {
       ativo = false
       window.clearInterval(timer)
       document.removeEventListener('visibilitychange', atualizarAoVoltar)
     }
  }, [])

  useEffect(() => {
    let ativo = true
    const carregarNivelRio = async () => {
      try {
        const resposta = await fetch('/api/monitoramento-cnl', { cache: 'no-store' })
         const corpo = await resposta.json() as {
           sucesso?: boolean
           estacao?: LeituraCNL
           estacoes?: RadarEstacaoCNL[]
           serie?: PontoSerie[]
           serieChuvaCentro?: PontoSerie[]
           estacaoChuvaCentro?: { nome: string; codigo?: string } | null
           serieNivel?: PontoNivel[]
         }
        if (!resposta.ok || !corpo.sucesso || !corpo.estacao || !Array.isArray(corpo.serieNivel)) {
          throw new Error('Dados do Rio Bananeiras indisponíveis.')
        }
         if (ativo) {
           setDadosCNL({
             estacao: corpo.estacao,
             estacoes: Array.isArray(corpo.estacoes) ? corpo.estacoes : [corpo.estacao],
             serie: Array.isArray(corpo.serie) ? corpo.serie : [],
              serieChuvaCentro: Array.isArray(corpo.serieChuvaCentro) ? corpo.serieChuvaCentro : [],
              estacaoChuvaCentro: corpo.estacaoChuvaCentro || null,
             serieNivel: corpo.serieNivel,
           })
         }
      } catch {
        // O gráfico é complementar ao Radar; a falha não deve ocultar os registros.
      }
    }
    carregarNivelRio()
    const timer = window.setInterval(carregarNivelRio, 5 * 60 * 1000)
    return () => {
      ativo = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    carregar()
    const off = wsOn('radar_bilhetes_atualizados', () => {
      tocarSininho()
      carregar()
    })
    // Netlify não mantém um servidor WebSocket persistente. O polling mantém
    // o Radar atualizado mesmo quando o Realtime/WS não está disponível.
    const timer = window.setInterval(() => { carregar() }, 10000)
    return () => { off(); window.clearInterval(timer) }
  }, [carregar])
  useEffect(() => {
    carregarAtividades()
    const avisarAtualizacao = () => carregarAtividades(true)
    const offChecklist = wsOn('checklist_atualizado', avisarAtualizacao)
    const offFerramental = wsOn('checklists_ferramental_atualizados', avisarAtualizacao)
    const offMateriais = wsOn('materiais_atualizados', avisarAtualizacao)
    const offOcorrencias = wsOn('ocorrencias_atualizadas', avisarAtualizacao)
    const timer = window.setInterval(() => { carregarAtividades(false) }, 10000)
    return () => { offChecklist(); offFerramental(); offMateriais(); offOcorrencias(); window.clearInterval(timer) }
  }, [carregarAtividades])
  useEffect(() => {
    if (carregadoRef.current) localStorage.setItem(STORAGE_KEY, JSON.stringify(registros))
  }, [registros])

  const dias = useMemo(() => {
    const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1)
    const inicio = new Date(primeiro); inicio.setDate(1 - primeiro.getDay())
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(inicio); d.setDate(inicio.getDate() + i); return d })
  }, [mes])
  const lembretes = registros.filter(r => r.tipo === 'lembrete')
  const notificacoes = registros.filter(r => r.tipo === 'notificacao')
  const notificacoesDaData = notificacoes.filter(r => r.data === dataSelecionada)
  // Notificações vencidas continuam disponíveis no calendário como histórico,
  // mas deixam de circular no Radar a partir do dia seguinte à data marcada.
  const notificacoesDoRadar = notificacoes
    .filter(r => !r.concluido && r.data >= hoje())
    .sort((a, b) => `${a.data}${a.hora}`.localeCompare(`${b.data}${b.hora}`))
  const resumosFerramental = useMemo(
    () => resumirFerramental(atividades.checklistsFerramentas, atividades.ferramentasCatalogo),
    [atividades.checklistsFerramentas, atividades.ferramentasCatalogo],
  )
  const destaquesTempo = useMemo(() => {
    if (!tempo?.dias.length) return null
    return {
      chuva: tempo.dias.reduce((maior, dia) => dia.precipitacao > maior.precipitacao ? dia : maior),
      umidade: tempo.dias.reduce((menor, dia) => dia.umidade < menor.umidade ? dia : menor),
      rajada: tempo.dias.reduce((maior, dia) => dia.rajada > maior.rajada ? dia : maior),
    }
  }, [tempo])
  const estadosClima = useMemo(
    () => tempo ? estadosVisuaisTempo(tempo) : ['normal' as EstadoVisualTempo],
    [tempo],
  )
  const cenaClima = useMemo(
    () => tempo ? cenaClimaTempo(tempo) : null,
    [tempo],
  )
  const diasPrecipitacao = useMemo(() => {
    if (!dadosCNL) return []
    return [...new Set(dadosCNL.estacoes.flatMap(estacao => estacao.precipitacaoDiaria.map(dia => dia.data)))]
      .sort()
      .reverse()
      .slice(0, 2)
  }, [dadosCNL])
  const resumoPrecipitacao = useMemo(
    () => dadosCNL?.estacoes.map(estacao => `${estacao.nome} ${formatarMmRadar(estacao.acumulados.vinteQuatroHoras)}`).join(' | ') || '',
    [dadosCNL],
  )


  async function salvarRegistro(tipo: RegistroRadar['tipo'], texto: string, data: string, horaRegistro: string) {
    if (!texto.trim() || salvando) return
    const agentesParaRegistro = tipo === 'lembrete' ? agentesLembrete : agentesEnvolvidos
    if (agentesParaRegistro.length === 0) {
      setErroSalvamento('Marque pelo menos um agente para receber este lembrete.')
      return
    }
    if (registroEmEdicao) {
      const registroAtualizado = {
        texto: texto.trim(),
        data,
        hora: horaRegistro,
        prioridade,
        agentes_envolvidos: agentesParaRegistro,
        concluido: registroEmEdicao.concluido,
      }
      setSalvando(true)
      setErroSalvamento('')
      try {
        let row: Record<string, unknown>
        if (supabaseDisponivel) {
          const result = agentePodeGerenciarCriacao(registroEmEdicao.criadoPor, agente) && registroEmEdicao.criadoPor === 'J'
            ? await supabase.from('radar_bilhetes').update(registroAtualizado).eq('id', registroEmEdicao.id).select().single()
            : await supabase.from('radar_bilhetes').update(registroAtualizado).eq('id', registroEmEdicao.id).eq('criado_por', agente).select().single()
          if (result.error || !result.data) throw new Error(result.error?.message || 'Não foi possível atualizar o registro.')
          row = result.data as Record<string, unknown>
        } else {
          const res = await fetch(`/api/radar-bilhetes/${registroEmEdicao.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agente, ...registroAtualizado }),
          })
          if (!res.ok) {
            const detalhe = await res.json().catch(() => null) as { error?: string } | null
            throw new Error(detalhe?.error || 'Não foi possível atualizar o registro.')
          }
          row = await res.json() as Record<string, unknown>
        }
        const salvo: RegistroRadar = {
          ...registroEmEdicao,
          id: String(row.id),
          texto: String(row.texto),
          data: String(row.data),
          hora: String(row.hora),
          prioridade: (row.prioridade as Prioridade) || prioridade,
          concluido: Boolean(row.concluido),
          agentesEnvolvidos: Array.isArray(row.agentes_envolvidos) ? row.agentes_envolvidos.map(String) : agentesParaRegistro,
          confirmacoesAgentes: lerConfirmacoes(row.confirmacoes_agentes),
        }
        setRegistros(prev => prev.map(item => item.id === salvo.id ? salvo : item))
        setRegistroEmEdicao(null)
        setTextoLembrete('')
        setTextoNotificacao('')
        setAgentesLembrete([])
        setAgentesEnvolvidos([])
        setHora(horaAgora())
        setLembreteEditorAberto(false)
        setEditorAberto(false)
        if (supabaseDisponivel) wsSend({ tipo: 'radar_bilhetes_atualizados' })
      } catch (error) {
        setErroSalvamento(error instanceof Error ? error.message : 'Não foi possível atualizar o registro.')
      } finally {
        setSalvando(false)
      }
      return
    }
    const novo: RegistroRadar = {
      id: crypto.randomUUID(), texto: texto.trim(), data, hora: horaRegistro,
      prioridade, concluido: false, criadoPor: agente, criadoEm: new Date().toISOString(), tipo,
      agentesEnvolvidos: agentesParaRegistro, confirmacoesAgentes: [],
    }
    setSalvando(true)
    setErroSalvamento('')
    pendentesRef.current.add(novo.id)
    try {
      let row: Record<string, unknown>
      if (supabaseDisponivel) {
        const result = await supabase.from('radar_bilhetes').upsert({ id: novo.id, texto: novo.texto, data: novo.data, hora: novo.hora, prioridade: novo.prioridade, concluido: false, criado_por: agente, tipo, agentes_envolvidos: novo.agentesEnvolvidos }, { onConflict: 'id' }).select().single()
        if (result.error || !result.data) throw new Error(result.error?.message || 'Não foi possível salvar no banco.')
        row = result.data as Record<string, unknown>
      } else {
        const res = await fetch('/api/radar-bilhetes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...novo, criado_por: agente, tipo, agentes_envolvidos: novo.agentesEnvolvidos }),
        })
        if (!res.ok) {
          const detalhe = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(detalhe?.error || 'Não foi possível salvar o registro.')
        }
        row = await res.json() as Record<string, unknown>
      }
      const salvo: RegistroRadar = {
        id: String(row.id), texto: String(row.texto), data: String(row.data), hora: String(row.hora),
        prioridade: (row.prioridade as Prioridade) || novo.prioridade, concluido: Boolean(row.concluido),
        criadoPor: String(row.criado_por || agente), criadoEm: String(row.criado_em || novo.criadoEm),
        tipo: row.tipo === 'notificacao' ? 'notificacao' : 'lembrete',
        agentesEnvolvidos: Array.isArray(row.agentes_envolvidos) ? row.agentes_envolvidos.map(String) : novo.agentesEnvolvidos,
        confirmacoesAgentes: lerConfirmacoes(row.confirmacoes_agentes),
      }
      setRegistros(prev => [...prev.filter(r => r.id !== salvo.id && r.id !== novo.id), salvo])
      pendentesRef.current.delete(novo.id)
      if (supabaseDisponivel) wsSend({ tipo: 'radar_bilhetes_atualizados' })
      if (tipo === 'lembrete') {
        setTextoLembrete('')
        setAgentesLembrete([])
        setLembreteEditorAberto(false)
      } else {
        setTextoNotificacao('')
        setHora(horaAgora())
        setAgentesEnvolvidos([])
        setEditorAberto(false)
      }
      wsSend({
        tipo: 'radar_notificacao_agente',
        id: novo.id,
        texto: novo.texto,
        data: novo.data,
        hora: novo.hora,
        prioridade: novo.prioridade,
        criadoPor: agente,
        registroTipo: tipo,
        agentesEnvolvidos: novo.agentesEnvolvidos,
      })
      // No Netlify o bilhete já é sincronizado pelo Supabase Realtime.
      // O envio de push de Radar continua sendo responsabilidade do backend Express.
      if (!supabaseDisponivel) {
        fetch('/api/push/radar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentes: novo.agentesEnvolvidos,
            texto: novo.texto,
            data: novo.data,
            hora: novo.hora,
            prioridade: novo.prioridade,
            remetente: agente,
            notificacaoId: novo.id,
            registroTipo: tipo,
          }),
        }).catch(() => {})
      }
    } catch (error) {
      pendentesRef.current.delete(novo.id)
      setErroSalvamento(error instanceof Error ? error.message : 'Não foi possível salvar o registro.')
    } finally {
      setSalvando(false)
    }
  }

  async function remover(registro: RegistroRadar, senha?: string) {
    const id = registro.id
    setErroSalvamento('')
    try {
      if (supabaseDisponivel) {
        const result = agentePodeGerenciarCriacao(registro.criadoPor, agente) && registro.criadoPor === 'J'
          ? await supabase.from('radar_bilhetes').delete().eq('id', id)
          : await supabase.from('radar_bilhetes').delete().eq('id', id).eq('criado_por', agente)
        if (result.error) throw new Error(result.error.message)
      } else {
        const res = await fetch('/api/radar-bilhetes/' + id, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agente, senha }),
        })
        if (!res.ok) {
          const detalhe = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(detalhe?.error || 'Não foi possível remover o registro.')
        }
      }
      setRegistros(prev => prev.filter(r => r.id !== id))
      setLembreteParaApagar(null)
      if (supabaseDisponivel) wsSend({ tipo: 'radar_bilhetes_atualizados' })
    } catch (error) {
      setErroSalvamento(error instanceof Error ? error.message : 'Não foi possível remover o registro.')
    }
  }

  function iniciarEdicaoRegistro(registro: RegistroRadar) {
    if (!agentePodeGerenciarCriacao(registro.criadoPor, agente)) return
    setRegistroEmEdicao(registro)
    setPrioridade(registro.prioridade)
    setDataSelecionada(registro.data)
    setHora(registro.hora)
    if (registro.tipo === 'lembrete') {
      setTextoLembrete(registro.texto)
      setAgentesLembrete(registro.agentesEnvolvidos)
      setLembreteEditorAberto(true)
    } else {
      setTextoNotificacao(registro.texto)
      setAgentesEnvolvidos(registro.agentesEnvolvidos)
      setEditorAberto(true)
      requestAnimationFrame(() => calendarioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    }
  }

  async function marcarLembreteCiente(registro: RegistroRadar) {
    if (marcandoCienteId) return
    setMarcandoCienteId(registro.id)
    setErroSalvamento('')
    const confirmacoes = [
      ...registro.confirmacoesAgentes.filter(item => item.agente !== agente),
      { agente, confirmado: true, confirmedAt: new Date().toISOString() },
    ]
    try {
      if (supabaseDisponivel) {
        const result = await supabase
          .from('radar_bilhetes')
          .update({ confirmacoes_agentes: confirmacoes })
          .eq('id', registro.id)
          .select()
          .single()
        if (result.error) throw new Error(result.error.message)
      } else {
        const res = await fetch(`/api/radar-bilhetes/${registro.id}/ciente`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agente }),
        })
        if (!res.ok) {
          const detalhe = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(detalhe?.error || 'Não foi possível marcar o lembrete como ciente.')
        }
      }
      setRegistros(prev => prev.map(item => (
        item.id === registro.id ? { ...item, confirmacoesAgentes: confirmacoes } : item
      )))
      if (supabaseDisponivel) wsSend({ tipo: 'radar_bilhetes_atualizados' })
    } catch (error) {
      setErroSalvamento(error instanceof Error ? error.message : 'Não foi possível marcar o lembrete como ciente.')
    } finally {
      setMarcandoCienteId(null)
    }
  }

  useEffect(() => wsOn('radar_notificacao_agente', (mensagem) => {
    const envolvidos = Array.isArray(mensagem.agentesEnvolvidos) ? mensagem.agentesEnvolvidos.map(String) : []
    if (!envolvidos.includes(agente) || String(mensagem.criadoPor) === agente) return
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Radar GM — você foi envolvido', {
        body: `${String(mensagem.data || '')} às ${String(mensagem.hora || '')} · ${String(mensagem.texto || '')}`,
        tag: `radar-envolvido-${String(mensagem.id)}`,
      })
    }
  }), [agente])

  useEffect(() => wsOn('radar_confirmacao', (mensagem) => {
    if (String(mensagem.criadoPor) !== agente || !('Notification' in window) || Notification.permission !== 'granted') return
    const nome = String(mensagem.agente || 'Agente')
      const texto = String(mensagem.texto || 'notificação do Radar GM')
      new Notification(mensagem.confirmado === true ? '✅ Radar GM — presença confirmada' : '❌ Radar GM — presença recusada', {
      body: mensagem.confirmado === true ? `${nome} confirmou presença: ${texto}` : `${nome} informou que não poderá ir: ${texto}`,
      tag: `radar-confirmacao-${String(mensagem.id)}-${nome}`,
    })
  }), [agente])

  useEffect(() => {
    if (!editorAberto) return
    const fecharAoClicarFora = (event: PointerEvent) => {
      const alvo = event.target
      if (alvo instanceof Node && !calendarioRef.current?.contains(alvo)) {
        setEditorAberto(false)
      }
    }
    document.addEventListener('pointerdown', fecharAoClicarFora)
    return () => document.removeEventListener('pointerdown', fecharAoClicarFora)
  }, [editorAberto])

  useEffect(() => {
    document.body.classList.toggle('radar-tv-active', tv)
    return () => document.body.classList.remove('radar-tv-active')
  }, [tv])

  useEffect(() => {
    if (!tv) return
    let diaConhecido = hoje()
    const timer = window.setInterval(() => {
      const novoDia = hoje()
      if (novoDia === diaConhecido) return
      diaConhecido = novoDia
      setDataSelecionada(novoDia)
      setMes(new Date(`${novoDia}T12:00:00`))
    }, 15 * 1000)
    return () => window.clearInterval(timer)
  }, [tv])

  const alternarModoTv = useCallback(async () => {
    if (tv) {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {})
      }
      setTv(false)
      return
    }

    const dataAtual = hoje()
    setDataSelecionada(dataAtual)
    setMes(new Date(`${dataAtual}T12:00:00`))
    setTv(true)
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen().catch(() => {
        // O modo TV continua disponível mesmo quando o navegador bloqueia a tela cheia.
      })
    }
  }, [tv])

  useEffect(() => {
    const sincronizarTelaCheia = () => {
      if (!document.fullscreenElement) setTv(false)
    }
    document.addEventListener('fullscreenchange', sincronizarTelaCheia)
    return () => document.removeEventListener('fullscreenchange', sincronizarTelaCheia)
  }, [])

  return (
       <section className={`radar-page ${tv ? 'radar-tv' : ''}`}>
       <div className="radar-tv-launcher">
         <div className="radar-tv-launcher-copy">
            <span className="radar-tv-launcher-label">RADAR GM</span>
           <span className="radar-tv-launcher-hint">Painel operacional</span>
         </div>
          <div className="radar-tv-clock" aria-label="Hora atual">
            <span>HORA ATUAL</span>
            <strong>{horaAtual.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
          </div>
         <button
           className="radar-tv-launcher-btn"
           type="button"
           aria-pressed={tv}
           onClick={() => { void alternarModoTv() }}
         >
           {tv ? '↙ Voltar ao app' : '⛶ Modo TV — Tela cheia'}
         </button>
       </div>
        <div className="radar-dashboard">
        <div className="radar-overview">
        <section className="radar-weather radar-weather-compact radar-google-weather" aria-labelledby="radar-weather-title">
          <div className="weather-google-header">
            <div>
              <span className="weather-google-kicker">CLIMA</span>
              <h2 id="radar-weather-title">Conselheiro Lafaiete</h2>
              <p>Minas Gerais · atualização automática</p>
            </div>
            <div className="weather-google-header-actions">
              <div className="radar-clock" aria-label="Hora atual">
                <span>HORA ATUAL</span>
                <strong>{horaAtual.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
              </div>
              <span className="weather-google-menu" aria-hidden="true">⋮</span>
            </div>
          </div>
          {erroTempo && <p className="radar-weather-error" role="alert">{erroTempo}</p>}
          {!tempo && !erroTempo && <p className="radar-weather-loading">Carregando previsão...</p>}
          {tempo && (
            <>
              <div className="weather-google-body">
                <div className="weather-google-location">
                  <span className="weather-google-kicker">CLIMA</span>
                  <h2>Conselheiro Lafaiete</h2>
                  <p>Minas Gerais</p>
                  <div className="weather-google-current">
                    <div className="weather-google-temperature">
                      <span>Agora</span>
                      <strong>{Math.round(tempo.atual.temperatura)}°</strong>
                    </div>
                    <div className="weather-google-current-icon" aria-label={nomesTempo[tempo.atual.codigo] || 'Condição variável'}>
                      <span className="weather-google-sun" />
                      <span className="weather-google-cloud">{iconeTempo(tempo.atual.codigo)}</span>
                    </div>
                    <div className="weather-google-summary">
                      <strong>{nomesTempo[tempo.atual.codigo] || 'Condição variável'}</strong>
                      <span>Umidade {Math.round(tempo.atual.umidade)}% · vento {Math.round(tempo.atual.vento)} km/h</span>
                    </div>
                  </div>
                  <div className="weather-google-metrics" aria-label="Resumo das condições atuais">
                    <span>🌧️ Chuva <b>{tempo.atual.chuva.toFixed(1)} mm</b></span>
                    <span>☔ Prob. hoje <b>{tempo.dias[0]?.probabilidade ?? 0}%</b></span>
                    <span>💨 Rajadas <b>{Math.round(tempo.atual.rajada)} km/h</b></span>
                  </div>
                </div>
                <div className="weather-google-current-column">
                   <div
                     className={`weather-google-frog-scene weather-scene-${cenaClima?.tipo ?? 'ensolarado'} ${estadosClima.map(estado => `weather-state-${estado}`).join(' ')}`}
                     style={{ backgroundImage: `url(${cenaClima?.caminho ?? '/weather-scenes/ensolarado.jpg'})` }}
                     aria-label={`Sapinho em cenário ${cenaClima?.nome.toLowerCase() ?? 'ensolarado'}`}
                   />
                </div>
                <div className="weather-google-forecast-column">
                  <div className="weather-google-hours-heading">
                    <strong>Previsão por hora</strong>
                    <span>Próximas horas</span>
                  </div>
                  <div className="weather-google-hourly" aria-label="Previsão do tempo nas próximas horas">
                    {tempo.horas.slice(0, 7).map((hora, indice) => (
                      <div className="weather-google-hour" key={hora.time} title={`${nomesTempo[hora.codigo] || 'Condição variável'} · ${hora.probabilidade}% de chuva`}>
                        <strong>{indice === 0 ? 'Agora' : new Date(hora.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                        <span className="weather-google-hour-temperature">{Math.round(hora.temperatura)}°</span>
                        <span className="weather-google-hour-icon">{iconeTempo(hora.codigo, hora.time)}</span>
                        <small>{Math.round(hora.probabilidade)}%</small>
                      </div>
                    ))}
                  </div>
                  <div className="weather-google-days-heading">
                    <strong>Previsão para os próximos dias</strong>
                  </div>
                  <div className="weather-google-days" aria-label="Previsão do tempo para os próximos dias">
                    {tempo.dias.map((dia, indice) => (
                      <div className={`weather-google-day ${indice === 0 ? 'weather-google-day-today' : ''}`} key={dia.data}>
                        <b>{indice === 0 ? 'Hoje' : new Date(`${dia.data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</b>
                        <span>{iconeTempo(dia.codigo)}</span>
                        <strong>{Math.round(dia.temperaturaMax)}° <small>{Math.round(dia.temperaturaMin)}°</small></strong>
                        <em>☔ {Math.round(dia.probabilidade)}%</em>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
       <div className="radar-calendar-card" ref={calendarioRef}>
         <div className="calendar-top"><div><span>CALENDÁRIO DE NOTIFICAÇÕES</span><h2>{mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h2></div><div className="month-buttons"><button type="button" aria-label="Mês anterior" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}>‹</button><button type="button" aria-label="Próximo mês" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}>›</button></div></div>
         <div className="weekdays">{['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'].map(d => <span key={d}>{d}</span>)}</div>
         <div className="calendar-grid">{dias.map(d => { const key = dataLocalISO(d); const count = notificacoes.filter(n => n.data === key && !n.concluido).length; return <button type="button" key={key} aria-label={dataBonita(key)} className={`${d.getMonth() !== mes.getMonth() ? 'other-month ' : ''}${key === dataSelecionada ? 'selected ' : ''}${key === hoje() ? 'today' : ''}`} onClick={() => { setRegistroEmEdicao(null); setDataSelecionada(key); setEditorAberto(true) }}><span>{d.getDate()}</span>{count > 0 && <i>{count}</i>}</button> })}</div>
         <div className="calendar-legend"><span><i className="legend-red" /> notificações</span></div>
         {editorAberto && <form className="radar-calendar-editor" onSubmit={e => { e.preventDefault(); salvarRegistro('notificacao', textoNotificacao, dataSelecionada, hora) }}>
           <strong>{registroEmEdicao ? 'Editar notificação' : `Notificar em ${dataBonita(dataSelecionada)}`}</strong>
           <div className="radar-date-notifications">
             <span className="radar-date-notifications-title">Notificações desta data</span>
             {notificacoesDaData.length === 0 ? (
               <span className="radar-date-notifications-empty">Nenhuma notificação cadastrada.</span>
             ) : notificacoesDaData.map(n => (
               <div className="radar-date-notification" key={n.id}>
                 <div>
                   <b>{n.hora} · {n.prioridade}</b>
                   <span>{n.texto}</span>
                   <small>Por {n.criadoPor}</small>
                   {agentePodeGerenciarCriacao(n.criadoPor, agente) && <small className="radar-confirmacoes-status">
                     {n.agentesEnvolvidos.map(nome => {
                       const confirmacao = n.confirmacoesAgentes.find(item => item.agente === nome)
                       return `${nome}: ${confirmacao ? confirmacao.confirmado ? 'vai ✅' : 'não vai ❌' : 'aguardando…'}`
                     }).join(' · ')}
                   </small>}
                 </div>
                 {agentePodeGerenciarCriacao(n.criadoPor, agente) && (
                   <div className="radar-record-actions">
                     <button type="button" onClick={() => iniciarEdicaoRegistro(n)} aria-label={`Editar notificação: ${n.texto}`} title="Editar notificação">✏️</button>
                     <button type="button" onClick={() => setLembreteParaApagar(n)} aria-label={`Remover notificação: ${n.texto}`} title="Remover notificação">×</button>
                   </div>
                 )}
               </div>
             ))}
           </div>
           <textarea value={textoNotificacao} onChange={e => setTextoNotificacao(e.target.value)} placeholder="Escreva a notificação..." rows={3} />
           <div className="radar-form-row"><label>⏰ Hora<input type="time" value={hora} onChange={e => setHora(e.target.value)} /></label><label>Nível<select value={prioridade} onChange={e => setPrioridade(e.target.value as Prioridade)}>{Object.entries(prioridadeConfig).map(([key, c]) => <option key={key} value={key}>{c.emoji} {c.label}</option>)}</select></label></div>
           <fieldset className="radar-agentes-fieldset">
             <legend>Agentes envolvidos</legend>
             <div className="radar-agentes-grid">
               {AGENTES.map(nome => (
                 <label key={nome} className="radar-agente-option">
                   <input
                     type="checkbox"
                     checked={agentesEnvolvidos.includes(nome)}
                     onChange={e => setAgentesEnvolvidos(prev => e.target.checked ? [...prev, nome] : prev.filter(item => item !== nome))}
                   />
                   <span>{nome}</span>
                 </label>
               ))}
             </div>
           </fieldset>
           <button className="radar-add" type="submit" disabled={!textoNotificacao.trim() || salvando}>{salvando ? 'Salvando...' : registroEmEdicao ? 'Salvar alterações' : '+ Colocar no Radar GM'}</button>
           {registroEmEdicao && <button type="button" className="radar-cancel-edit" onClick={() => { setRegistroEmEdicao(null); setTextoNotificacao(''); setAgentesEnvolvidos([]); setEditorAberto(false) }}>Cancelar edição</button>}
           {erroSalvamento && <p className="radar-save-error" role="alert">{erroSalvamento}</p>}
         </form>}
       </div>
       </div>
      <div className="radar-layout">
        <div className="radar-note-card radar-bilhete-large">
          <div className="radar-note-heading">
            <div className="card-label"><span className="label-dot" /> LEMBRETE</div>
            <button
              type="button"
              className={`radar-reminder-trigger${lembreteEditorAberto ? ' ativo' : ''}`}
              onClick={() => setLembreteEditorAberto(prev => !prev)}
              aria-expanded={lembreteEditorAberto}
            >
              {lembreteEditorAberto ? 'Fechar lembrete' : 'Lembrete'} {lembreteEditorAberto ? '×' : '+'}
            </button>
          </div>
          <div className="radar-mini-list">
            {lembretes.length === 0 ? (
              <span>Nenhum lembrete criado.</span>
           ) : lembretes.map(l => (
              <div className="radar-mini-item" key={l.id}>
                 <b>{l.criadoPor === agente ? 'Criado por você' : `Criado por ${l.criadoPor}`}</b>
                <span>{l.texto}</span>
                 <div className="radar-reminder-statuses" aria-label="Status de visualização do lembrete">
                   {l.agentesEnvolvidos.map(nome => {
                     const ciente = l.confirmacoesAgentes.some(item => item.agente === nome && item.confirmado)
                     return <small key={nome}><strong>{nome}</strong>: <em className={ciente ? 'radar-reminder-read' : 'radar-reminder-unread'}>{ciente ? 'Ciente' : 'Não visualizou'}</em></small>
                   })}
                 </div>
                 {l.agentesEnvolvidos.includes(agente) && !l.confirmacoesAgentes.some(item => item.agente === agente && item.confirmado) && (
                   <button
                     type="button"
                     className="radar-reminder-ack"
                     onClick={() => marcarLembreteCiente(l)}
                     disabled={marcandoCienteId === l.id}
                   >
                     {marcandoCienteId === l.id ? 'Salvando…' : 'Marcar Ciente'}
                   </button>
                 )}
                 {agentePodeGerenciarCriacao(l.criadoPor, agente) && (
                   <div className="radar-record-actions">
                     <button type="button" onClick={() => iniciarEdicaoRegistro(l)} title="Editar lembrete" aria-label="Editar lembrete">✏️</button>
                     <button type="button" onClick={() => setLembreteParaApagar(l)} title="Apagar lembrete" aria-label="Apagar lembrete">×</button>
                   </div>
                 )}
              </div>
            ))}
          </div>
          {lembreteEditorAberto ? (
            <div className="radar-reminder-editor">
              <textarea
                value={textoLembrete}
                onChange={e => setTextoLembrete(e.target.value)}
                placeholder="Anote um lembrete..."
                rows={2}
                aria-label="Texto do lembrete"
              />
              <fieldset className="radar-agentes-fieldset radar-lembrete-agentes">
                <legend>Agentes que receberão o lembrete</legend>
                <div className="radar-agentes-grid">
                  {AGENTES.map(nome => (
                    <label key={nome} className="radar-agente-option">
                      <input type="checkbox" checked={agentesLembrete.includes(nome)} onChange={e => setAgentesLembrete(prev => e.target.checked ? [...prev, nome] : prev.filter(item => item !== nome))} />
                      <span>{nome}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button className="radar-add" onClick={() => salvarRegistro('lembrete', textoLembrete, registroEmEdicao?.data || hoje(), registroEmEdicao?.hora || horaAgora())} disabled={!textoLembrete.trim() || agentesLembrete.length === 0 || salvando}>{salvando ? 'Salvando...' : registroEmEdicao ? 'Salvar alterações' : '+ Salvar lembrete'}</button>
              {registroEmEdicao && <button type="button" className="radar-cancel-edit" onClick={() => { setRegistroEmEdicao(null); setTextoLembrete(''); setAgentesLembrete([]); setLembreteEditorAberto(false) }}>Cancelar edição</button>}
              {erroSalvamento && <p className="radar-save-error" role="alert">{erroSalvamento}</p>}
            </div>
          ) : (
            <section className="radar-cnl-inline" aria-labelledby="radar-nivel-rio-titulo">
              <div className="radar-cnl-card-heading">
                <div><span className="card-label">MONITORAMENTO HIDROLÓGICO</span><h2 id="radar-nivel-rio-titulo">Nível do Rio Bananeiras</h2></div>
                <span className="radar-cnl-live">CEMADEN · ao vivo</span>
              </div>
              {dadosCNL ? (
                 <>
                   <GraficoNivel pontos={dadosCNL.serieNivel} estacao={dadosCNL.estacao} mostrarTooltip={false} mostrarFonte={false} mostrarLeituraAtual />
                    <section className="cnl-bloco radar-cnl-rain-monitoramento" aria-labelledby="radar-chuva-24h-titulo">
                      <div className="cnl-bloco-cabecalho">
                        <div><span className="cnl-eyebrow">Chuva acumulada</span><h2 id="radar-chuva-24h-titulo">Últimas 24 horas</h2></div>
                        <span className="cnl-badge-fonte">Atualização automática · 5 min</span>
                     </div>
                     <ChartaChuva
                         pontos={dadosCNL.serieChuvaCentro || []}
                         estacao={dadosCNL.estacaoChuvaCentro}
                     />
                   </section>
                     {dadosCNL && (
                      <details className="radar-cnl-diaria-detalhe">
                         <summary className="radar-precipitacao-resumo" aria-label="Precipitação atual por estação">
                           {resumoPrecipitacao || 'Consultando precipitações...'}
                         </summary>
                         {diasPrecipitacao.length > 0 && (
                           <div className="radar-precipitacao-scroll">
                             <table className="radar-precipitacao-table radar-precipitacao-diaria-table">
                               <thead>
                                 <tr>
                                   <th>Estação</th>
                                   {diasPrecipitacao.map(dia => <th key={dia}>{dia.split('-').reverse().slice(0, 2).join('/')}</th>)}
                                 </tr>
                               </thead>
                               <tbody>
                                 {dadosCNL.estacoes.map(estacao => (
                                   <tr key={estacao.id}>
                                     <th scope="row">
                                       <strong>{estacao.nome || `Estação ${estacao.id}`}</strong>
                                       <small>{estacao.codigo || `CEMADEN ${estacao.id}`}</small>
                                     </th>
                                     {diasPrecipitacao.map(dia => {
                                       const leitura = estacao.precipitacaoDiaria.find(item => item.data === dia)
                                       return <td key={dia}>{formatarMmRadar(leitura?.total)}</td>
                                     })}
                                   </tr>
                                 ))}
                               </tbody>
                             </table>
                           </div>
                         )}
                      </details>
                    )}
                 </>
              ) : (
                <p className="radar-cnl-loading">Consultando a estação Centro…</p>
              )}
            </section>
          )}
        </div>

        <div className="radar-right-column">
        <section className="radar-activities">
         <div className="radar-list-heading"><div><span className="card-label">REGISTROS OPERACIONAIS</span><h2>Atividades de {dataBonita(dataSelecionada)}</h2></div><strong>{atividades.checklists.length + atividades.checklistsFerramentas.length + atividades.ocorrencias.length} registro(s)</strong></div>
        <div className="radar-activity-columns">
          <div><h3>🚗 Checklists do dia</h3>{atividades.checklists.length === 0 ? <div className="radar-empty">Nenhum checklist de viatura registrado.</div> : atividades.checklists.map(c => <button className="radar-activity" key={c.id} onClick={() => disparar('dc:abrir-checklist', { id: c.id })}><b>{c.agente}{c.fotoCarregada && <strong className="radar-foto-carregada">Foto Carregada</strong>}</b><span className="radar-checklist-resumo">{c.hora} - {c.placa || 'Placa não informada'} - KM {c.km || 'não informado'} - ⛽ {c.nivelCombustivel || 'não informado'}</span><em>abrir ›</em></button>)}
          <h3 className="radar-subtitulo-ferramentas">🧰 Checklists de ferramentas</h3>
          {resumosFerramental.length === 0 ? (
            <div className="radar-empty">Nenhum checklist de ferramenta registrado.</div>
          ) : (
            <div className="radar-ferramental-resumos">
              {resumosFerramental.map(resumo => (
                <article className="radar-ferramental-resumo" key={resumo.agente}>
                  <div className="radar-ferramental-cabecalho">
                    <strong>{resumo.agente}</strong>
                    <b>Ferramental {resumo.tiposVerificados}/{resumo.totalTipos}</b>
                  </div>
                   {(resumo.boa + resumo.media + resumo.ruim) > 0 && (
                     <div className="radar-ferramental-itens">
                       <span className="radar-ferramental-boa">Boa - {percentual(resumo.boa, resumo.totalTipos)}%</span>
                       <span className="radar-ferramental-media">Média - {percentual(resumo.media, resumo.totalTipos)}%</span>
                       <span className="radar-ferramental-ruim">Ruim - {percentual(resumo.ruim, resumo.totalTipos)}%</span>
                     </div>
                   )}
                  <div className="radar-ferramental-quantidade">
                     Itens/litros conferidos: {resumo.itensConferidos}/{resumo.itensCadastrados}
                  </div>
                  {resumo.ferramentasRuins.length > 0 && (
                    <div className="radar-ferramental-alerta radar-ferramental-alerta-ruim">
                      <strong>Ruim:</strong> {resumo.ferramentasRuins.join(', ')}
                    </div>
                  )}
                  {resumo.faltantes.length > 0 && (
                    <div className="radar-ferramental-alerta radar-ferramental-alerta-falta">
                      <strong>Faltando:</strong> {resumo.faltantes.join(', ')}
                    </div>
                  )}
                  {resumo.serragemAlertas.length > 0 && (
                    <div className="radar-ferramental-alerta radar-ferramental-alerta-serragem">
                      <strong>⚠️ Serragem:</strong> {resumo.serragemAlertas.join(', ')}
                    </div>
                  )}
                   {resumo.litrosAlertas.length > 0 && (
                     <div className="radar-ferramental-alerta radar-ferramental-alerta-serragem">
                       <strong>⚠️ Estoque baixo:</strong> {resumo.litrosAlertas.join(', ')}
                     </div>
                   )}
                  {resumo.semChecklist.length > 0 && (
                    <div className="radar-ferramental-alerta radar-ferramental-alerta-pendente">
                      <strong>Sem checklist:</strong> {resumo.semChecklist.slice(0, 3).join(', ')}
                      {resumo.semChecklist.length > 3 ? ` e mais ${resumo.semChecklist.length - 3}` : ''}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          </div>
          <div><h3>⚠️ Ocorrências do dia</h3>{atividades.ocorrencias.length === 0 ? <div className="radar-empty">Nenhuma ocorrência registrada.</div> : atividades.ocorrencias.map(o => <button className="radar-activity" key={o.id} onClick={() => disparar('dc:abrir-ocorrencia', { id: o.id })}><b>{o.agente}</b><span>{o.hora} · {o.natureza || 'Natureza não informada'}</span><small>{o.endereco || 'Endereço não informado'}</small><em>abrir ›</em></button>)}</div>
        </div>
         </section>
         <RadarMapaTempoReal dadosCNL={dadosCNL} tv={tv} />
       {lembreteParaApagar && (
         <ModalSenha
           titulo={`Apagar lembrete de ${lembreteParaApagar.criadoPor}`}
           senhaCorreta={getSenhaAgente(lembreteParaApagar.criadoPor) || ''}
           onCancelar={() => setLembreteParaApagar(null)}
           onConfirmar={(senha) => { void remover(lembreteParaApagar, senha) }}
         />
       )}
        </div>
      </div>
       </div>
      <div className="radar-ticker">
        <span>RADAR GM</span>
        <div className="radar-ticker-viewport">
          {(() => {
             const filaTicker = notificacoesDoRadar
            return filaTicker.length > 0 ? (
               <div className="radar-ticker-track" style={{ '--ticker-duration': `${Math.max(8 / RADAR_TICKER_SPEED, (filaTicker.length * 2.8) / RADAR_TICKER_SPEED)}s` } as React.CSSProperties}>
                {[0, 1].map(copia => (
                  <div className="radar-ticker-group" key={copia} aria-hidden={copia === 1}>
                    {filaTicker.map(n => <b key={`${copia}-${n.id}`}>● {dataBonita(n.data)} · {n.texto}</b>)}
                  </div>
                ))}
              </div>
            ) : <b className="radar-ticker-empty">Nenhuma notificação cadastrada.</b>
          })()}
        </div>
      </div>
    </section>
  )
}