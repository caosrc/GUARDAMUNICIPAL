// Armazenamento offline usando IndexedDB
// Guarda ocorrências pendentes quando offline e sincroniza quando voltar online

const DB_NAME = 'defesacivil-db'
const DB_VERSION = 1
const PENDING_STORE = 'pending'
const CACHE_STORE = 'ocorrencias-cache'

let _db: IDBDatabase | null = null

function getDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: 'localId', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'id' })
      }
    }
  })
}

function run<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return getDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        const req = fn(store)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

// Fila de pendentes (offline → servidor)
export function savePending(data: object): Promise<IDBValidKey> {
  return run(PENDING_STORE, 'readwrite', (s) =>
    s.add({ ...data, _savedAt: new Date().toISOString() })
  )
}

export function getPending(): Promise<any[]> {
  return getDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(PENDING_STORE, 'readonly')
        const req = tx.objectStore(PENDING_STORE).getAll()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

export function removePending(localId: number): Promise<undefined> {
  return run(PENDING_STORE, 'readwrite', (s) => s.delete(localId)) as Promise<undefined>
}

export function updatePending(localId: number, data: object): Promise<void> {
  return getDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(PENDING_STORE, 'readwrite')
        const store = tx.objectStore(PENDING_STORE)
        const getReq = store.get(localId)
        getReq.onsuccess = () => {
          const existing = getReq.result
          if (!existing) { reject(new Error('Não encontrado')); return }
          const putReq = store.put({ ...existing, ...data })
          putReq.onsuccess = () => resolve()
          putReq.onerror = () => reject(putReq.error)
        }
        getReq.onerror = () => reject(getReq.error)
      })
  )
}

export function countPending(): Promise<number> {
  return getDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(PENDING_STORE, 'readonly')
        const req = tx.objectStore(PENDING_STORE).count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

// Cache de ocorrências (para leitura offline)
export function cacheOcorrencias(items: object[]): Promise<void> {
  return getDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite')
        const store = tx.objectStore(CACHE_STORE)
        store.clear()
        items.forEach((item) => store.put(item))
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
  )
}

export function getCachedOcorrencias(): Promise<any[]> {
  return getDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readonly')
        const req = tx.objectStore(CACHE_STORE).getAll()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

export function addToCache(item: object & { id: number }): Promise<IDBValidKey> {
  return run(CACHE_STORE, 'readwrite', (s) => s.put(item))
}

// ------------------------------------------------------------------
// Geocodificação via Nominatim (online) ou fallback offline
// ------------------------------------------------------------------

// Bairros / pontos de referência de Ouro Branco para geocodificação offline
const REFERENCIAS_OURO_BRANCO: Record<string, { lat: number; lng: number }> = {
  'centro':         { lat: -20.5195, lng: -43.6983 },
  'bairro novo':    { lat: -20.5150, lng: -43.6950 },
  'progresso':      { lat: -20.5220, lng: -43.7020 },
  'são francisco':  { lat: -20.5180, lng: -43.6960 },
  'ipanema':        { lat: -20.5230, lng: -43.7010 },
  'santa rita':     { lat: -20.5160, lng: -43.7040 },
  'prefeito':       { lat: -20.5195, lng: -43.6983 },
  'praça':          { lat: -20.5195, lng: -43.6983 },
  'cemitério':      { lat: -20.5250, lng: -43.6970 },
  'usp':            { lat: -20.5120, lng: -43.6900 },
  'usina':          { lat: -20.5050, lng: -43.6870 },
  'belgo':          { lat: -20.5050, lng: -43.6870 },
  'arcelor':        { lat: -20.5050, lng: -43.6870 },
  'escola':         { lat: -20.5200, lng: -43.6990 },
  'hospital':       { lat: -20.5210, lng: -43.7000 },
  'prefeitura':     { lat: -20.5195, lng: -43.6983 },
  'câmara':         { lat: -20.5195, lng: -43.6983 },
}

// Retorna coordenadas por referência offline ou null
function geocodificarOffline(endereco: string): { lat: number; lng: number } | null {
  const lower = endereco.toLowerCase()
  for (const [chave, coords] of Object.entries(REFERENCIAS_OURO_BRANCO)) {
    if (lower.includes(chave)) return coords
  }
  return null
}

export async function geocodificarEndereco(endereco: string): Promise<{ lat: number; lng: number } | null> {
  // Tenta online via Nominatim
  if (navigator.onLine) {
    const query = encodeURIComponent(`${endereco}, Ouro Branco, MG, Brasil`)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=br`,
        { headers: { 'User-Agent': 'DefesaCivilOuroBranco/1.0 (defesacivil@ourobranco.mg.gov.br)' } }
      )
      const data = await res.json()
      if (data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
      }
    } catch {
      // cai no fallback
    }
  }

  // Fallback offline: busca em referências locais
  return geocodificarOffline(endereco)
}

// ------------------------------------------------------------------
// Gerenciamento do cache de mapa (via Service Worker)
// ------------------------------------------------------------------

export type ProgressoMapa = {
  total: number
  concluido: number
  erros: number
  status: 'iniciando' | 'andamento' | 'concluido' | 'erro'
}

// Envia mensagem ao SW para pré-cachear tiles de Ouro Branco
// Chama onProgresso com atualizações até status === 'concluido'
export function baixarMapaOffline(
  onProgresso: (p: ProgressoMapa) => void,
  zooms = [10, 11, 12, 13, 14, 15]
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      reject(new Error('Service Worker não disponível'))
      return
    }

    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (msg?.tipo === 'PROGRESSO_MAPA') {
        onProgresso({
          total: msg.total,
          concluido: msg.concluido,
          erros: msg.erros ?? 0,
          status: msg.status,
        })
        if (msg.status === 'concluido') {
          navigator.serviceWorker.removeEventListener('message', handler)
          resolve()
        }
      }
    }

    navigator.serviceWorker.addEventListener('message', handler)
    navigator.serviceWorker.controller.postMessage({
      tipo: 'CACHEAR_MAPA_OURO_BRANCO',
      zooms,
    })
  })
}

// Consulta quantos tiles estão no cache
export function obterInfoCacheMapa(): Promise<number> {
  return new Promise((resolve) => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      resolve(0)
      return
    }
    const handler = (event: MessageEvent) => {
      if (event.data?.tipo === 'INFO_CACHE_MAPA_RESP') {
        navigator.serviceWorker.removeEventListener('message', handler)
        resolve(event.data.totalTiles ?? 0)
      }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    navigator.serviceWorker.controller.postMessage({ tipo: 'INFO_CACHE_MAPA' })
  })
}

// Limpa o cache de tiles
export function limparCacheMapa(): Promise<void> {
  return new Promise((resolve) => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      resolve()
      return
    }
    const handler = (event: MessageEvent) => {
      if (event.data?.tipo === 'CACHE_MAPA_LIMPO') {
        navigator.serviceWorker.removeEventListener('message', handler)
        resolve()
      }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    navigator.serviceWorker.controller.postMessage({ tipo: 'LIMPAR_CACHE_MAPA' })
  })
}
