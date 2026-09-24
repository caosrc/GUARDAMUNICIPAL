import { useState } from 'react'
import { MapContainer, TileLayer, Polygon, Marker, useMapEvents, CircleMarker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

;(function fixLeafletIcon() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  })
})()

const CONSELHEIRO_LAFAIETE_CENTER: [number, number] = [-20.6604, -43.7863]

export type PontoPoligono = { lat: number; lng: number }

export function calcularAreaM2(pontos: PontoPoligono[]): number {
  if (pontos.length < 3) return 0
  const toRad = (d: number) => d * Math.PI / 180
  const R = 6371000
  const lat0 = pontos[0].lat
  const lng0 = pontos[0].lng
  const pts = pontos.map(p => ({
    x: (p.lng - lng0) * Math.cos(toRad(lat0)) * R * toRad(1),
    y: (p.lat - lat0) * R * toRad(1),
  }))
  let area = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

export function formatarArea(m2: number): string {
  if (m2 < 1) return '< 1 m²'
  if (m2 < 10000) return `${Math.round(m2).toLocaleString('pt-BR')} m²`
  const ha = m2 / 10000
  return `${ha.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`
}

function PoligonoMapClick({ onAdd }: { onAdd: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onAdd(e.latlng.lat, e.latlng.lng) } })
  return null
}

interface EditandoVertice {
  idx: number
  lat: string
  lng: string
}

interface Props {
  pontos: PontoPoligono[]
  onChange: (pontos: PontoPoligono[]) => void
  focoLat?: number | null
  focoLng?: number | null
}

export default function PoligonoAreaQueimada({ pontos, onChange, focoLat, focoLng }: Props) {
  const [mostrarMapa, setMostrarMapa] = useState(false)
  const [buscandoGps, setBuscandoGps] = useState(false)
  const [erroGps, setErroGps] = useState('')
  const [editando, setEditando] = useState<EditandoVertice | null>(null)
  const [satelite, setSatelite] = useState(false)

  const areaM2 = calcularAreaM2(pontos)

  function adicionarVerticeGps() {
    if (!navigator.geolocation) { setErroGps('Geolocalização não disponível'); return }
    setBuscandoGps(true)
    setErroGps('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6))
        const lng = parseFloat(pos.coords.longitude.toFixed(6))
        onChange([...pontos, { lat, lng }])
        setBuscandoGps(false)
      },
      () => { setErroGps('Erro ao obter GPS. Verifique as permissões.'); setBuscandoGps(false) },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  function removerVertice(idx: number) {
    if (editando?.idx === idx) setEditando(null)
    onChange(pontos.filter((_, i) => i !== idx))
  }

  function iniciarEdicao(idx: number) {
    const p = pontos[idx]
    setEditando({ idx, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) })
  }

  function confirmarEdicao() {
    if (!editando) return
    const lat = parseFloat(editando.lat.replace(',', '.'))
    const lng = parseFloat(editando.lng.replace(',', '.'))
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return
    const novos = pontos.map((p, i) => i === editando.idx ? { lat, lng } : p)
    onChange(novos)
    setEditando(null)
  }

  const centerLat = focoLat ?? pontos[0]?.lat ?? CONSELHEIRO_LAFAIETE_CENTER[0]
  const centerLng = focoLng ?? pontos[0]?.lng ?? CONSELHEIRO_LAFAIETE_CENTER[1]

  return (
    <div className="poligono-area-section">
      <div className="poligono-area-titulo">🔶 Área Queimada (Polígono)</div>

      <div className="poligono-btns">
        <button type="button" className="btn-poligono-gps" onClick={adicionarVerticeGps} disabled={buscandoGps}>
          {buscandoGps ? '⏳ Aguardando GPS...' : '📍 Vértice por GPS'}
        </button>
        <button type="button" className="btn-poligono-mapa" onClick={() => setMostrarMapa(true)}>
          🗺️ Desenhar no Mapa
        </button>
      </div>

      {erroGps && <div className="poligono-erro">{erroGps}</div>}

      {pontos.length === 0 && (
        <div className="poligono-dica">
          Marque os vértices da área queimada caminhando pelo local (GPS) ou desenhando no mapa
        </div>
      )}
      {pontos.length > 0 && pontos.length < 3 && (
        <div className="poligono-dica">
          Adicione mais {3 - pontos.length} vértice{3 - pontos.length > 1 ? 's' : ''} para calcular a área
        </div>
      )}

      {pontos.length > 0 && (
        <div className="poligono-vertices">
          {pontos.map((p, idx) => (
            <div key={idx}>
              <div className="poligono-vertice-item">
                <span className="poligono-vertice-num">V{idx + 1}</span>
                <span className="poligono-vertice-coords">
                  {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                </span>
                <button
                  type="button"
                  className="btn-editar-vertice"
                  onClick={() => editando?.idx === idx ? setEditando(null) : iniciarEdicao(idx)}
                  title="Editar coordenadas"
                  style={{
                    background: editando?.idx === idx ? '#2563eb' : '#f59e0b',
                    color: 'white', border: 'none', borderRadius: 6,
                    padding: '0.18rem 0.45rem', fontSize: '0.78rem', cursor: 'pointer',
                    fontWeight: 700, lineHeight: 1.4,
                  }}
                >
                  ✏️
                </button>
                <button type="button" className="btn-remover-vertice" onClick={() => removerVertice(idx)} title="Remover vértice">
                  ✕
                </button>
              </div>

              {editando?.idx === idx && (
                <div style={{
                  background: '#1e3a5f', borderRadius: 8, padding: '0.6rem 0.75rem',
                  margin: '0.2rem 0 0.35rem 0', display: 'flex', flexDirection: 'column', gap: '0.4rem',
                }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <label style={{ color: '#93c5fd', fontSize: '0.75rem', fontWeight: 700, width: 28 }}>Lat</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editando.lat}
                      onChange={e => setEditando({ ...editando, lat: e.target.value })}
                      style={{
                        flex: 1, background: '#0f172a', color: 'white', border: '1.5px solid #3b82f6',
                        borderRadius: 6, padding: '0.3rem 0.5rem', fontSize: '0.82rem',
                      }}
                      placeholder="-20.526400"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <label style={{ color: '#93c5fd', fontSize: '0.75rem', fontWeight: 700, width: 28 }}>Lng</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editando.lng}
                      onChange={e => setEditando({ ...editando, lng: e.target.value })}
                      style={{
                        flex: 1, background: '#0f172a', color: 'white', border: '1.5px solid #3b82f6',
                        borderRadius: 6, padding: '0.3rem 0.5rem', fontSize: '0.82rem',
                      }}
                      placeholder="-43.694700"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setEditando(null)}
                      style={{
                        background: '#374151', color: 'white', border: 'none', borderRadius: 6,
                        padding: '0.28rem 0.7rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                      }}
                    >Cancelar</button>
                    <button
                      type="button"
                      onClick={confirmarEdicao}
                      style={{
                        background: '#16a34a', color: 'white', border: 'none', borderRadius: 6,
                        padding: '0.28rem 0.7rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                      }}
                    >✅ Salvar</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {pontos.length > 0 && (
            <button type="button" className="btn-limpar-poligono" onClick={() => { onChange([]); setEditando(null) }}>
              🗑️ Limpar tudo
            </button>
          )}
        </div>
      )}

      {pontos.length >= 3 && (
        <div className="poligono-area-resultado">
          <span className="poligono-area-icone">📐</span>
          <span className="poligono-area-texto">
            Área queimada estimada: <strong>{formatarArea(areaM2)}</strong>
          </span>
        </div>
      )}

      {mostrarMapa && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: '#b91c1c', color: 'white', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
            <span style={{ fontSize: '1.2rem' }}>🔶</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Desenhar Área Queimada</div>
              <div style={{ fontSize: '0.74rem', opacity: 0.88 }}>Toque no mapa para adicionar cada vértice do polígono</div>
            </div>

            {/* Botão satélite / rua */}
            <button
              type="button"
              onClick={() => setSatelite(s => !s)}
              style={{
                background: satelite ? '#1d4ed8' : 'rgba(255,255,255,0.2)',
                border: '1.5px solid rgba(255,255,255,0.45)',
                color: 'white', borderRadius: 8, padding: '0.3rem 0.75rem',
                fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.3rem',
              }}
              title={satelite ? 'Trocar para Mapa de Rua' : 'Trocar para Vista de Satélite'}
            >
              {satelite ? '🗺️ Rua' : '🛰️ Satélite'}
            </button>

            <button
              onClick={() => setMostrarMapa(false)}
              style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: 8, padding: '0.3rem 0.75rem', fontWeight: 800, fontSize: '1rem', cursor: 'pointer' }}
            >✕</button>
          </div>

          {pontos.length >= 3 && (
            <div style={{ background: '#fef3c7', borderBottom: '2px solid #fcd34d', padding: '0.4rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <span style={{ fontSize: '1rem' }}>📐</span>
              <span style={{ fontSize: '0.87rem', fontWeight: 800, color: '#92400e', flex: 1 }}>
                Área: {formatarArea(areaM2)}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#78350f', background: '#fde68a', padding: '0.15rem 0.5rem', borderRadius: 5, fontWeight: 700 }}>
                {pontos.length} vértices
              </span>
            </div>
          )}
          {pontos.length > 0 && pontos.length < 3 && (
            <div style={{ background: '#fef3c7', borderBottom: '1px solid #fcd34d', padding: '0.3rem 1rem', flexShrink: 0 }}>
              <span style={{ fontSize: '0.78rem', color: '#92400e', fontWeight: 600 }}>
                {pontos.length} vértice{pontos.length > 1 ? 's' : ''} — adicione mais {3 - pontos.length} para fechar o polígono
              </span>
            </div>
          )}

          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <MapContainer
              key={satelite ? 'sat' : 'rua'}
              center={[centerLat, centerLng]}
              zoom={focoLat ? 16 : 14}
              style={{ height: '100%', width: '100%' }}
              zoomControl={true}
            >
              {satelite ? (
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  attribution='Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
                  maxZoom={19}
                />
              ) : (
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap'
                />
              )}
              <PoligonoMapClick onAdd={(lat, lng) => onChange([...pontos, { lat, lng }])} />

              {focoLat != null && focoLng != null && (
                <Marker position={[focoLat, focoLng]} />
              )}

              {pontos.length >= 3 && (
                <Polygon
                  positions={pontos.map(p => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: '#dc2626', fillColor: '#fca5a5', fillOpacity: 0.35, weight: 2.5 }}
                />
              )}

              {pontos.map((p, idx) => (
                <CircleMarker
                  key={idx}
                  center={[p.lat, p.lng]}
                  radius={7}
                  pathOptions={{ color: '#dc2626', fillColor: idx === 0 ? '#dc2626' : 'white', fillOpacity: 1, weight: 2.5 }}
                />
              ))}
            </MapContainer>
          </div>

          <div style={{ background: '#1f2937', padding: '0.65rem 1rem', display: 'flex', gap: '0.55rem', alignItems: 'center', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => onChange(pontos.slice(0, -1))}
              disabled={pontos.length === 0}
              style={{
                background: pontos.length === 0 ? '#374151' : '#dc2626',
                color: 'white', border: 'none', borderRadius: 8,
                padding: '0.5rem 0.9rem', fontWeight: 700, fontSize: '0.82rem',
                cursor: pontos.length === 0 ? 'default' : 'pointer',
                opacity: pontos.length === 0 ? 0.45 : 1,
              }}
            >↩ Desfazer</button>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={pontos.length === 0}
              style={{
                background: '#374151', color: 'white', border: 'none', borderRadius: 8,
                padding: '0.5rem 0.9rem', fontWeight: 700, fontSize: '0.82rem',
                cursor: pontos.length === 0 ? 'default' : 'pointer',
                opacity: pontos.length === 0 ? 0.45 : 1,
              }}
            >🗑️ Limpar</button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setMostrarMapa(false)}
              style={{ background: '#16a34a', color: 'white', border: 'none', borderRadius: 8, padding: '0.55rem 1.3rem', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer' }}
            >✅ Confirmar</button>
          </div>
        </div>
      )}
    </div>
  )
}
