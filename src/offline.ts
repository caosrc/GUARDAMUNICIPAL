// Armazenamento offline usando IndexedDB
// Guarda ocorrências pendentes quando offline e sincroniza quando voltar online

const DB_NAME = 'defesacivil-db'
const DB_VERSION = 2
const PENDING_STORE = 'pending'
const CACHE_STORE = 'ocorrencias-cache'
const FOTOS_CAMPO_STORE = 'fotos-campo-pendentes'

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
      // v2: store dedicado para fotos de campo pendentes de sync com Supabase
      if (!db.objectStoreNames.contains(FOTOS_CAMPO_STORE)) {
        const fotoStore = db.createObjectStore(FOTOS_CAMPO_STORE, { keyPath: 'localId', autoIncrement: true })
        fotoStore.createIndex('planoId', 'planoId', { unique: false })
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

export function removePending(localId: number): Promise<void> {
  return getDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PENDING_STORE, 'readwrite')
        tx.objectStore(PENDING_STORE).delete(localId)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(new Error('Transaction aborted'))
      })
  )
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

export function clearAllPending(): Promise<void> {
  return getDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PENDING_STORE, 'readwrite')
        tx.objectStore(PENDING_STORE).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
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
// Fotos de campo pendentes de sync com Supabase (IndexedDB v2)
// Garante que fotos tiradas offline não sejam perdidas.
// ------------------------------------------------------------------

export interface FotoCampoPendente {
  localId?: number
  planoId: string
  foto: object
  savedAt: string
}

/** Salva uma foto geolocada no IndexedDB para sync posterior. Retorna o localId gerado. */
export function saveFotoCampoPendente(planoId: string, foto: object): Promise<number> {
  return run(FOTOS_CAMPO_STORE, 'readwrite', (s) =>
    s.add({ planoId, foto, savedAt: new Date().toISOString() } as FotoCampoPendente)
  ) as Promise<number>
}

/** Busca todas as fotos pendentes de um planejamento específico. */
export function getFotosCampoPendentes(planoId: string): Promise<FotoCampoPendente[]> {
  return getDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(FOTOS_CAMPO_STORE, 'readonly')
        const idx = tx.objectStore(FOTOS_CAMPO_STORE).index('planoId')
        const req = idx.getAll(planoId)
        req.onsuccess = () => resolve(req.result as FotoCampoPendente[])
        req.onerror = () => reject(req.error)
      })
  )
}

/** Remove uma foto pendente pelo localId (após sync bem-sucedido). */
export function removeFotoCampoPendente(localId: number): Promise<void> {
  return getDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(FOTOS_CAMPO_STORE, 'readwrite')
        tx.objectStore(FOTOS_CAMPO_STORE).delete(localId)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
  )
}

/** Remove TODAS as fotos pendentes de um planejamento (após sync bem-sucedido). */
export function clearFotosCampoPendentesPlano(planoId: string): Promise<void> {
  return getDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(FOTOS_CAMPO_STORE, 'readwrite')
        const idx = tx.objectStore(FOTOS_CAMPO_STORE).index('planoId')
        const req = idx.getAllKeys(planoId)
        req.onsuccess = () => {
          const keys = req.result
          keys.forEach((k) => tx.objectStore(FOTOS_CAMPO_STORE).delete(k))
          tx.oncomplete = () => resolve()
        }
        req.onerror = () => reject(req.error)
        tx.onerror = () => reject(tx.error)
      })
  )
}

// ------------------------------------------------------------------
// Geocodificação via Nominatim (online) ou fallback offline
// ------------------------------------------------------------------

// Bairros / pontos de referência de Conselheiro Lafaiete para geocodificação offline
const REFERENCIAS_CONSELHEIRO_LAFAIETE: Record<string, { lat: number; lng: number }> = {
  'centro':         { lat: -20.6604, lng: -43.7863 },
  'são sebastião':  { lat: -20.6530, lng: -43.7800 },
  'santa matilde':  { lat: -20.6680, lng: -43.7750 },
  'queluz':         { lat: -20.6560, lng: -43.7960 },
  'chapada':        { lat: -20.6490, lng: -43.8020 },
  'progresso':      { lat: -20.6700, lng: -43.7900 },
  'carijós':        { lat: -20.6620, lng: -43.7710 },
  'siderúrgico':    { lat: -20.6740, lng: -43.8090 },
  'prefeito':       { lat: -20.6604, lng: -43.7863 },
  'praça':          { lat: -20.6604, lng: -43.7863 },
  'cemitério':      { lat: -20.6650, lng: -43.7820 },
  'escola':         { lat: -20.6600, lng: -43.7870 },
  'hospital':       { lat: -20.6610, lng: -43.7840 },
  'prefeitura':     { lat: -20.6604, lng: -43.7863 },
  'câmara':         { lat: -20.6604, lng: -43.7863 },
}

// Retorna coordenadas por referência offline ou null
function geocodificarOffline(endereco: string): { lat: number; lng: number } | null {
  const lower = endereco.toLowerCase()
  for (const [chave, coords] of Object.entries(REFERENCIAS_CONSELHEIRO_LAFAIETE)) {
    if (lower.includes(chave)) return coords
  }
  return null
}

export async function geocodificarEndereco(endereco: string): Promise<{ lat: number; lng: number } | null> {
  // Tenta online via Nominatim
  if (navigator.onLine) {
    const query = encodeURIComponent(`${endereco}, Conselheiro Lafaiete, MG, Brasil`)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=br`,
        { headers: { 'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)' } }
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

async function obterServiceWorkerAtivo(): Promise<ServiceWorker> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker não disponível')
  }

  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller

  try {
    const registro = await navigator.serviceWorker.ready
    const worker = navigator.serviceWorker.controller || registro.active
    if (worker) return worker
  } catch {
    // O erro abaixo dá uma mensagem única para a interface.
  }

  throw new Error('Service Worker ainda não está pronto')
}

/** Solicita ao navegador que preserve os caches offline contra limpeza automática. */
export async function solicitarArmazenamentoPersistente(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

// Envia mensagem ao SW para pré-cachear tiles de Conselheiro Lafaiete
// Chama onProgresso com atualizações até status === 'concluido'.
// Por padrão cobre raio de 10 km e zooms 11..17 (cidade + entorno imediato).
export function baixarMapaOffline(
  onProgresso: (p: ProgressoMapa) => void,
  zooms = [11, 12, 13, 14, 15, 16],
  raioKm = 10
): Promise<void> {
  return (async () => {
    const worker = await obterServiceWorkerAtivo()
    await new Promise<void>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const msg = event.data
        if (msg?.tipo !== 'PROGRESSO_MAPA') return
        onProgresso({
          total: msg.total,
          concluido: msg.concluido,
          erros: msg.erros ?? 0,
          status: msg.status,
        })
        if (msg.status === 'concluido') {
          navigator.serviceWorker.removeEventListener('message', handler)
          resolve()
        } else if (msg.status === 'erro') {
          navigator.serviceWorker.removeEventListener('message', handler)
          reject(new Error('Falha ao salvar os tiles do mapa'))
        }
      }

      navigator.serviceWorker.addEventListener('message', handler)
      worker.postMessage({
        tipo: 'CACHEAR_MAPA_CONSELHEIRO_LAFAIETE',
        zooms,
        raioKm,
      })
    })
  })()
}

// ── Malha viária (Overpass) — para autocomplete + rota offline ────
export type ProgressoMalha = {
  status: 'iniciando' | 'concluido' | 'erro'
  bytes?: number
  mensagem?: string
}

export function baixarMalhaViariaOffline(
  onProgresso: (p: ProgressoMalha) => void,
  raioM = 10000
): Promise<void> {
  return (async () => {
    const worker = await obterServiceWorkerAtivo()
    await new Promise<void>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const msg = event.data
        if (msg?.tipo !== 'PROGRESSO_MALHA') return
        onProgresso({
          status: msg.status,
          bytes: msg.bytes,
          mensagem: msg.mensagem,
        })
        if (msg.status === 'concluido') {
          navigator.serviceWorker.removeEventListener('message', handler)
          resolve()
        } else if (msg.status === 'erro') {
          navigator.serviceWorker.removeEventListener('message', handler)
          reject(new Error(msg.mensagem || 'Falha ao baixar malha viária'))
        }
      }
      navigator.serviceWorker.addEventListener('message', handler)
      worker.postMessage({
        tipo: 'BAIXAR_MALHA_VIARIA',
        raioM,
      })
    })
  })()
}

export function obterInfoMalhaViaria(): Promise<{ baixada: boolean; bytes: number }> {
  return (async () => {
    let worker: ServiceWorker
    try {
      worker = await obterServiceWorkerAtivo()
    } catch {
      return { baixada: false, bytes: 0 }
    }
    return new Promise((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data?.tipo !== 'INFO_MALHA_VIARIA_RESP') return
        navigator.serviceWorker.removeEventListener('message', handler)
        resolve({
          baixada: !!event.data.baixada,
          bytes: Number(event.data.bytes) || 0,
        })
      }
      navigator.serviceWorker.addEventListener('message', handler)
      worker.postMessage({ tipo: 'INFO_MALHA_VIARIA' })
    })
  })()
}

// Consulta quantos tiles estão no cache
export function obterInfoCacheMapa(): Promise<number> {
  return (async () => {
    let worker: ServiceWorker
    try {
      worker = await obterServiceWorkerAtivo()
    } catch {
      return 0
    }
    return new Promise<number>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data?.tipo !== 'INFO_CACHE_MAPA_RESP') return
        navigator.serviceWorker.removeEventListener('message', handler)
        resolve(Number(event.data.totalTiles) || 0)
      }
      navigator.serviceWorker.addEventListener('message', handler)
      worker.postMessage({ tipo: 'INFO_CACHE_MAPA' })
    })
  })()
}

// Limpa o cache de tiles
export function limparCacheMapa(): Promise<void> {
  return (async () => {
    let worker: ServiceWorker
    try {
      worker = await obterServiceWorkerAtivo()
    } catch {
      return
    }
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data?.tipo !== 'CACHE_MAPA_LIMPO') return
        navigator.serviceWorker.removeEventListener('message', handler)
        resolve()
      }
      navigator.serviceWorker.addEventListener('message', handler)
      worker.postMessage({ tipo: 'LIMPAR_CACHE_MAPA' })
    })
  })()
}
