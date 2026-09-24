/**
 * Malha viária local (offline) — CODAP de Conselheiro Lafaiete
 *
 * Carrega o JSON da Overpass que o Service Worker pré-baixou
 * (`/__malha-viaria__`), constrói um grafo de nós e arestas das ruas e
 * oferece:
 *   - `buscarRuas(query)`     → autocomplete por nome de rua (offline)
 *   - `roteamentoLocal(a,b)`  → menor caminho (Dijkstra) sobre a malha
 *   - `vizinhoMaisProximo()`  → nó da rede mais próximo de uma coordenada
 *
 * Tudo roda 100% no navegador; não exige internet depois que a malha
 * foi baixada uma vez (via `baixarMalhaViaria` em `src/offline.ts`).
 */

export type LatLng = { lat: number; lng: number }

export type ResultadoRua = {
  nome: string
  display: string
  lat: number
  lng: number
}

type No = { id: number; lat: number; lng: number }
type Aresta = { para: number; custo: number; nomeRua?: string }

type Malha = {
  nos: Map<number, No>
  vizinhos: Map<number, Aresta[]>
  ruas: Map<string, { lat: number; lng: number; tipo: string }>
  nomesRua: string[]
}

let _malha: Malha | null = null
let _carregando: Promise<Malha | null> | null = null

// ── Distância haversine em metros ─────────────────────────────────
function distanciaM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const toRad = (g: number) => (g * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Custos relativos por tipo de via (oneway respeitado)
const CUSTO_TIPO: Record<string, number> = {
  motorway: 0.9,
  trunk: 0.95,
  primary: 1.0,
  secondary: 1.05,
  tertiary: 1.1,
  unclassified: 1.2,
  residential: 1.3,
  living_street: 1.5,
  service: 1.6,
  track: 2.0,
  path: 3.0,
  footway: 5.0,
  pedestrian: 4.0,
  steps: 8.0,
}

// ── Carrega a malha (lê do Service Worker) e indexa em memória ────
async function carregar(): Promise<typeof _malha> {
  if (_malha) return _malha
  if (_carregando) return _carregando

  _carregando = (async () => {
    let raw: any
    try {
      const resp = await fetch('/__malha-viaria__')
      if (!resp.ok) {
        _carregando = null
        return null
      }
      raw = await resp.json()
    } catch {
      _carregando = null
      return null
    }

    if (!raw || !Array.isArray(raw.elements)) {
      _carregando = null
      return null
    }

    const nos = new Map<number, No>()
    const vizinhos = new Map<number, Aresta[]>()
    const ruas = new Map<string, { lat: number; lng: number; tipo: string }>()

    // 1. Nodes
    for (const el of raw.elements) {
      if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
        nos.set(el.id, { id: el.id, lat: el.lat, lng: el.lon })
      }
    }

    // 2. Ways → arestas + índice de ruas
    for (const el of raw.elements) {
      if (el.type !== 'way' || !Array.isArray(el.nodes) || el.nodes.length < 2) continue
      const tags = el.tags || {}
      const tipo: string = tags.highway || 'unclassified'
      // Ignora vias inadequadas para roteamento de viatura (mas mantemos
      // service e residential — viatura entra em rua local).
      if (tipo === 'proposed' || tipo === 'construction') continue
      const fator = CUSTO_TIPO[tipo] ?? 1.5
      const oneway = tags.oneway === 'yes' || tags.oneway === 'true' || tags.oneway === '1'
      const onewayInverso = tags.oneway === '-1' || tags.oneway === 'reverse'
      const nome: string | undefined = tags.name || tags['name:pt'] || tags.ref
      let acumPos: { lat: number; lng: number } | null = null
      let pontosNoMeio = 0

      for (let i = 0; i < el.nodes.length - 1; i++) {
        const a = nos.get(el.nodes[i])
        const b = nos.get(el.nodes[i + 1])
        if (!a || !b) continue
        const dist = distanciaM(a.lat, a.lng, b.lat, b.lng)
        const custo = dist * fator

        if (!onewayInverso) {
          if (!vizinhos.has(a.id)) vizinhos.set(a.id, [])
          vizinhos.get(a.id)!.push({ para: b.id, custo, nomeRua: nome })
        }
        if (!oneway) {
          if (!vizinhos.has(b.id)) vizinhos.set(b.id, [])
          vizinhos.get(b.id)!.push({ para: a.id, custo, nomeRua: nome })
        }

        // Centro aproximado da rua (média dos nós)
        acumPos = acumPos
          ? { lat: acumPos.lat + a.lat, lng: acumPos.lng + a.lng }
          : { lat: a.lat, lng: a.lng }
        pontosNoMeio++
      }

      if (nome) {
        const chave = nome.toLowerCase()
        if (!ruas.has(chave) && acumPos && pontosNoMeio > 0) {
          ruas.set(chave, {
            lat: acumPos.lat / pontosNoMeio,
            lng: acumPos.lng / pontosNoMeio,
            tipo,
          })
        }
      }
    }

    const nomesRua = Array.from(ruas.keys()).sort()
    _malha = { nos, vizinhos, ruas, nomesRua }
    _carregando = null
    return _malha
  })()

  return _carregando
}

// ── Pré-aquece a malha em segundo plano ───────────────────────────
export function preAquecerMalha(): void {
  carregar().catch(() => {})
}

// ── Há malha disponível? ──────────────────────────────────────────
export async function malhaDisponivel(): Promise<boolean> {
  const m = await carregar()
  return !!m && m.nos.size > 0
}

// ── Normaliza texto p/ busca (acentos + caixa) ────────────────────
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Autocomplete por nome de rua (totalmente offline) ─────────────
export async function buscarRuas(query: string, limite = 8): Promise<ResultadoRua[]> {
  const q = normalizar(query)
  if (q.length < 2) return []
  const m = await carregar()
  if (!m) return []

  const tokens = q.split(' ').filter(Boolean)
  const resultados: Array<ResultadoRua & { score: number }> = []

  for (const nomeOriginal of m.nomesRua) {
    const norm = normalizar(nomeOriginal)
    let score = 0
    let bate = true
    for (const t of tokens) {
      if (norm.includes(t)) {
        score += norm.startsWith(t) ? 3 : 1
      } else {
        bate = false
        break
      }
    }
    if (!bate) continue
    const pos = m.ruas.get(nomeOriginal)
    if (!pos) continue
    resultados.push({
      nome: nomeOriginal,
      display: `${nomeOriginal.replace(/\b\w/g, (c) => c.toUpperCase())} — Conselheiro Lafaiete, MG`,
      lat: pos.lat,
      lng: pos.lng,
      score,
    })
    if (resultados.length > limite * 4) break
  }

  resultados.sort((a, b) => b.score - a.score)
  return resultados.slice(0, limite).map(({ score: _, ...r }) => r)
}

// ── Vizinho mais próximo (busca linear simples; ok p/ <100k nós) ──
async function vizinhoMaisProximo(lat: number, lng: number): Promise<number | null> {
  const m = await carregar()
  if (!m) return null
  let melhorId: number | null = null
  let melhorDist = Infinity
  for (const no of m.nos.values()) {
    const d = (no.lat - lat) ** 2 + (no.lng - lng) ** 2
    if (d < melhorDist) {
      melhorDist = d
      melhorId = no.id
    }
  }
  return melhorId
}

// ── Heap binário (min-heap) p/ Dijkstra ───────────────────────────
class MinHeap {
  private dados: Array<{ id: number; custo: number }> = []
  push(item: { id: number; custo: number }) {
    this.dados.push(item)
    this.subir(this.dados.length - 1)
  }
  pop(): { id: number; custo: number } | undefined {
    if (this.dados.length === 0) return undefined
    const topo = this.dados[0]
    const fim = this.dados.pop()!
    if (this.dados.length > 0) {
      this.dados[0] = fim
      this.descer(0)
    }
    return topo
  }
  get tamanho() {
    return this.dados.length
  }
  private subir(i: number) {
    while (i > 0) {
      const pai = (i - 1) >> 1
      if (this.dados[pai].custo <= this.dados[i].custo) break
      ;[this.dados[pai], this.dados[i]] = [this.dados[i], this.dados[pai]]
      i = pai
    }
  }
  private descer(i: number) {
    const n = this.dados.length
    while (true) {
      const l = 2 * i + 1
      const r = 2 * i + 2
      let menor = i
      if (l < n && this.dados[l].custo < this.dados[menor].custo) menor = l
      if (r < n && this.dados[r].custo < this.dados[menor].custo) menor = r
      if (menor === i) break
      ;[this.dados[menor], this.dados[i]] = [this.dados[i], this.dados[menor]]
      i = menor
    }
  }
}

export type RotaLocal = {
  coords: Array<[number, number]>
  km: number
  min: number
}

// ── Roteamento Dijkstra local (offline) ───────────────────────────
export async function roteamentoLocal(
  origem: LatLng,
  destino: LatLng
): Promise<RotaLocal | null> {
  const m = await carregar()
  if (!m) return null

  const [idOrig, idDest] = await Promise.all([
    vizinhoMaisProximo(origem.lat, origem.lng),
    vizinhoMaisProximo(destino.lat, destino.lng),
  ])
  if (idOrig == null || idDest == null) return null
  if (idOrig === idDest) {
    const no = m.nos.get(idOrig)!
    const distM = distanciaM(origem.lat, origem.lng, destino.lat, destino.lng)
    return {
      coords: [
        [origem.lat, origem.lng],
        [no.lat, no.lng],
        [destino.lat, destino.lng],
      ],
      km: distM / 1000,
      min: Math.max(1, Math.round((distM / 1000) / 30 * 60)),
    }
  }

  const distancias = new Map<number, number>()
  const anteriores = new Map<number, number>()
  const heap = new MinHeap()
  distancias.set(idOrig, 0)
  heap.push({ id: idOrig, custo: 0 })

  let achou = false
  while (heap.tamanho > 0) {
    const atual = heap.pop()!
    if (atual.id === idDest) { achou = true; break }
    const distAtual = distancias.get(atual.id)!
    if (atual.custo > distAtual) continue
    const arestas = m.vizinhos.get(atual.id)
    if (!arestas) continue
    for (const a of arestas) {
      const nova = distAtual + a.custo
      const dPrev = distancias.get(a.para)
      if (dPrev == null || nova < dPrev) {
        distancias.set(a.para, nova)
        anteriores.set(a.para, atual.id)
        heap.push({ id: a.para, custo: nova })
      }
    }
  }

  if (!achou) return null

  // Reconstrói o caminho
  const idsCaminho: number[] = []
  let cur: number | undefined = idDest
  while (cur != null) {
    idsCaminho.push(cur)
    cur = anteriores.get(cur)
  }
  idsCaminho.reverse()

  const coords: Array<[number, number]> = [[origem.lat, origem.lng]]
  let metros = 0
  let prev: No | null = null
  for (const id of idsCaminho) {
    const n = m.nos.get(id)
    if (!n) continue
    if (prev) metros += distanciaM(prev.lat, prev.lng, n.lat, n.lng)
    coords.push([n.lat, n.lng])
    prev = n
  }
  coords.push([destino.lat, destino.lng])

  // Adiciona conexões de "última perna" (origem → 1º nó, último nó → destino)
  if (idsCaminho.length > 0) {
    const primeiro = m.nos.get(idsCaminho[0])
    const ultimo = m.nos.get(idsCaminho[idsCaminho.length - 1])
    if (primeiro) metros += distanciaM(origem.lat, origem.lng, primeiro.lat, primeiro.lng)
    if (ultimo) metros += distanciaM(ultimo.lat, ultimo.lng, destino.lat, destino.lng)
  }

  const km = metros / 1000
  // Velocidade média estimada: 35 km/h em malha urbana mista
  const min = Math.max(1, Math.round((km / 35) * 60))
  return { coords, km, min }
}

// ── Limpa cache em memória (após nova baixa da malha) ─────────────
export function descartarMalhaEmMemoria(): void {
  _malha = null
  _carregando = null
}
