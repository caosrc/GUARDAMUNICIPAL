import { normalizarNomeAgente } from './types'
import type { Ocorrencia } from './types'
import type { CurralDados, CurralRegistro } from './components/Curral'
import type { ProconRegistro } from './components/Procon'
import { savePending, getCachedOcorrencias } from './offline'
import { supabase, supabaseDisponivel } from './supabaseClient'
import { wsSend } from './wsClient'

// Redimensiona e recomprime um base64 para no máximo maxW pixels de largura
// em WebP para manter as fotos leves no banco sem perder tanta qualidade.
async function comprimirFoto(dataUrl: string, maxW = 1280, qualidade = 0.78): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl
  if (dataUrl.startsWith('data:image/webp')) return dataUrl
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxW) {
        height = Math.round((height * maxW) / width)
        width = maxW
      }
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return }
        ctx.drawImage(img, 0, 0, width, height)
        const webp = canvas.toDataURL('image/webp', qualidade)
        resolve(webp.startsWith('data:image/webp') ? webp : dataUrl)
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

async function comprimirFotos(fotos: unknown[]): Promise<string[]> {
  if (!Array.isArray(fotos) || fotos.length === 0) return []
  const result: string[] = []
  for (const f of fotos) {
    result.push(typeof f === 'string' ? await comprimirFoto(f) : '')
  }
  return result
}

function localOffline(dados: Omit<Ocorrencia, 'id' | 'created_at'>, localId: number): Ocorrencia {
  return {
    ...(dados as object),
    id: -Number(localId),
    created_at: new Date().toISOString(),
    _offline: true,
    _localId: Number(localId),
  } as unknown as Ocorrencia
}

function buildPayload(dados: Omit<Ocorrencia, 'id' | 'created_at'>) {
  return {
    tipo: dados.tipo ?? null,
    natureza: dados.natureza ?? null,
    subnatureza: dados.subnatureza ?? null,
    nivel_risco: dados.nivel_risco ?? 'baixo',
    status_oc: dados.status_oc ?? 'ativo',
    fotos: Array.isArray(dados.fotos) ? dados.fotos : [],
    lat: dados.lat ?? null,
    lng: dados.lng ?? null,
    endereco: dados.endereco ?? null,
    proprietario: dados.proprietario ?? null,
    telefone_proprietario: dados.telefone_proprietario ?? null,
    situacao: dados.situacao ?? null,
    recomendacao: dados.recomendacao ?? null,
    conclusao: dados.conclusao ?? null,
    data_ocorrencia: dados.data_ocorrencia ?? null,
    hora_inicio: dados.hora_inicio ?? null,
    hora_fim: dados.hora_fim ?? null,
    horas_total: dados.horas_total ?? null,
    horas_sobreaviso: dados.horas_sobreaviso ?? null,
    agentes: Array.isArray(dados.agentes) ? dados.agentes.map(normalizarNomeAgente) : [],
    responsavel_registro: dados.responsavel_registro ? normalizarNomeAgente(dados.responsavel_registro) : null,
    vistorias: Array.isArray(dados.vistorias) ? dados.vistorias : [],
    focos_incendio: Array.isArray((dados as any).focos_incendio) ? (dados as any).focos_incendio : null,
    poligono_area_queimada: Array.isArray((dados as any).poligono_area_queimada) ? (dados as any).poligono_area_queimada : null,
    chuva: dados.chuva ?? null,
    metragem_lona: dados.metragem_lona ?? null,
  }
}

// Detecta se a resposta é do Express/API (JSON) e não uma página HTML de redirect
function respostaExpressValida(res: Response): boolean {
  const ct = res.headers.get('content-type') || ''
  return !ct.includes('text/html')
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

// Campos leves para listagem/mapa — exclui fotos e vistorias (base64 pesado)
const CAMPOS_LISTA_OCORRENCIA =
  'id,tipo,natureza,subnatureza,nivel_risco,status_oc,lat,lng,endereco,proprietario,telefone_proprietario,situacao,recomendacao,conclusao,data_ocorrencia,hora_inicio,hora_fim,horas_total,horas_sobreaviso,agentes,responsavel_registro,focos_incendio,poligono_area_queimada,chuva,metragem_lona,created_at'

// Fallback sem colunas que podem não existir em Supabase mais antigo
const CAMPOS_LISTA_OCORRENCIA_BASE =
  'id,tipo,natureza,subnatureza,nivel_risco,status_oc,lat,lng,endereco,proprietario,telefone_proprietario,situacao,recomendacao,conclusao,data_ocorrencia,agentes,responsavel_registro,focos_incendio,poligono_area_queimada,created_at'
const CAMPOS_LISTA_OCORRENCIA_LEGADO =
  'id,tipo,natureza,subnatureza,nivel_risco,status_oc,lat,lng,endereco,proprietario,situacao,recomendacao,conclusao,data_ocorrencia,agentes,responsavel_registro,focos_incendio,poligono_area_queimada,created_at'

function isColumnMissingError(e: unknown): boolean {
  if (e instanceof Error) {
    return e.message.includes('does not exist') || e.message.includes('42703') || e.message.includes('schema cache')
  }
  // Supabase retorna plain objects {code, message} — não são instâncias de Error
  if (e && typeof e === 'object') {
    const err = e as Record<string, unknown>
    const code = String(err.code ?? '')
    const message = String(err.message ?? '')
    // PGRST204 = coluna não encontrada no schema cache do PostgREST
    return code === '42703' || code === 'PGRST204' || message.includes('does not exist') || message.includes('schema cache') || message.includes('column')
  }
  const s = String(e)
  return s.includes('does not exist') || s.includes('42703') || s.includes('schema cache')
}

export async function listarOcorrencias(): Promise<Ocorrencia[]> {
  // Supabase direto quando disponível (Netlify)
  if (supabaseDisponivel) {
    try {
      const { data, error } = await supabase
        .from('ocorrencias')
        .select(CAMPOS_LISTA_OCORRENCIA)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) {
        // Colunas ainda não adicionadas ao Supabase — tenta query base sem hora_*
        if (isColumnMissingError(error)) {
          console.warn('[api] Supabase sem colunas hora_* — usando query base. Execute o SQL de migração no Supabase.')
          const { data: data2, error: error2 } = await supabase
            .from('ocorrencias')
            .select(CAMPOS_LISTA_OCORRENCIA_BASE)
            .order('created_at', { ascending: false })
            .limit(500)
          if (error2 && isColumnMissingError(error2)) {
            const { data: dataLegado, error: errorLegado } = await supabase
              .from('ocorrencias')
              .select(CAMPOS_LISTA_OCORRENCIA_LEGADO)
              .order('created_at', { ascending: false })
              .limit(500)
            if (errorLegado) throw new Error(errorLegado.message)
            return (dataLegado || []).map((item) => ({
              ...item,
              agentes: Array.isArray(item.agentes) ? item.agentes.map(normalizarNomeAgente) : [],
              responsavel_registro: item.responsavel_registro ? normalizarNomeAgente(item.responsavel_registro) : null,
            })) as Ocorrencia[]
          }
          if (error2) throw new Error(error2.message)
      return (data2 || []).map((item) => ({
        ...item,
        agentes: Array.isArray(item.agentes) ? item.agentes.map(normalizarNomeAgente) : [],
        responsavel_registro: item.responsavel_registro ? normalizarNomeAgente(item.responsavel_registro) : null,
      })) as Ocorrencia[]
        }
        throw new Error(error.message)
      }
      return (data || []).map((item) => ({
        ...item,
        agentes: Array.isArray(item.agentes) ? item.agentes.map(normalizarNomeAgente) : [],
        responsavel_registro: item.responsavel_registro ? normalizarNomeAgente(item.responsavel_registro) : null,
      })) as Ocorrencia[]
    } catch (e) {
      if (isColumnMissingError(e)) {
        try {
          const { data: data2, error: error2 } = await supabase
            .from('ocorrencias')
            .select(CAMPOS_LISTA_OCORRENCIA_BASE)
            .order('created_at', { ascending: false })
            .limit(500)
          if (!error2) return (data2 || []).map((item) => ({
              ...item,
              agentes: Array.isArray(item.agentes) ? item.agentes.map(normalizarNomeAgente) : [],
              responsavel_registro: item.responsavel_registro ? normalizarNomeAgente(item.responsavel_registro) : null,
            })) as Ocorrencia[]
          if (isColumnMissingError(error2)) {
            const { data: dataLegado, error: errorLegado } = await supabase
              .from('ocorrencias')
              .select(CAMPOS_LISTA_OCORRENCIA_LEGADO)
              .order('created_at', { ascending: false })
              .limit(500)
            if (!errorLegado) return (dataLegado || []).map((item) => ({
                ...item,
                agentes: Array.isArray(item.agentes) ? item.agentes.map(normalizarNomeAgente) : [],
                responsavel_registro: item.responsavel_registro ? normalizarNomeAgente(item.responsavel_registro) : null,
              })) as Ocorrencia[]
          }
        } catch { /* segue para Express */ }
      }
      console.warn('[api] listarOcorrencias Supabase falhou:', e)
    }
  }

  // Express (Replit)
  try {
    const res = await fetch('/api/ocorrencias')
    if (respostaExpressValida(res)) {
      const data = await res.json()
      return (data || []).map((item) => ({
        ...item,
        agentes: Array.isArray(item.agentes) ? item.agentes.map(normalizarNomeAgente) : [],
        responsavel_registro: item.responsavel_registro ? normalizarNomeAgente(item.responsavel_registro) : null,
      })) as Ocorrencia[]
    }
  } catch { /* cai para cache offline */ }

  // Fallback offline
  console.warn('[api] listarOcorrencias — usando cache offline')
  return (await getCachedOcorrencias()) as Ocorrencia[]
}

// Busca dados completos de uma ocorrência (incluindo fotos e vistorias)
// Chamado pelo DetalheOcorrencia ao abrir, para não sobrecarregar o select da listagem
export async function buscarOcorrenciaCompleta(id: number): Promise<Ocorrencia | null> {
  if (supabaseDisponivel) {
    try {
      const { data, error } = await supabase
        .from('ocorrencias')
        .select('fotos,vistorias,focos_incendio,poligono_area_queimada')
        .eq('id', id)
        .single()
      if (error) return null
      return data as unknown as Ocorrencia
    } catch { return null }
  }
  try {
    const res = await fetch(`/api/ocorrencias/${id}`)
    if (respostaExpressValida(res)) return await res.json()
  } catch { /* ignore */ }
  return null
}

export async function enviarOcorrenciaServidor(
  dados: Omit<Ocorrencia, 'id' | 'created_at'>
): Promise<Ocorrencia> {
  // Supabase direto quando disponível (Netlify) — não tenta Express para evitar
  // que o redirect catch-all do Netlify sirva HTML antes de chegarmos aqui.
  if (supabaseDisponivel) {
    try {
      // Comprime fotos antes de enviar para manter o payload abaixo do limite de
      // 10 MB do PostgREST. Uma foto de celular (4000x3000 px) ocupa ~4-7 MB em
      // base64; com 3+ fotos o INSERT falha com timeout. Comprimimos para ≤1280 px
      // de largura e qualidade 0.72 (~150-300 KB/foto), mantendo boa qualidade visual.
      const fotosComprimidas = await comprimirFotos(Array.isArray(dados.fotos) ? dados.fotos : [])
      const dadosComprimidos = { ...dados, fotos: fotosComprimidas }
      const payload = buildPayload(dadosComprimidos)

      let { data, error } = await supabase
        .from('ocorrencias')
        .insert(payload)
        .select()
        .single()

      // Se falhar por coluna inexistente, remove colunas novas e tenta com schema base
      if (error && isColumnMissingError(error)) {
        console.warn('[api] Supabase insert: coluna ausente, tentando schema base.', error.message)
        const {
            hora_inicio: _hi, hora_fim: _hf, horas_total: _ht, horas_sobreaviso: _hs,
           focos_incendio: _fi, poligono_area_queimada: _paq, descricoes_fotos: _df, chuva: _chuva, metragem_lona: _metragemLona,
          ...payloadBase
        } = payload as Record<string, unknown>
         void _hi; void _hf; void _ht; void _hs; void _fi; void _paq; void _df; void _chuva; void _metragemLona
        const r2 = await supabase.from('ocorrencias').insert(payloadBase).select().single()
        data = r2.data
        error = r2.error
      }

      if (error) {
        console.error('[api] Supabase insert error:', error)
        const detalhe = error.code ? `[${error.code}] ${error.message}` : error.message
        throw new ApiError(500, detalhe)
      }
      if (!data) throw new ApiError(500, 'Supabase retornou resposta inválida')
      wsSend({ tipo: 'ocorrencias_atualizadas' })
      return data as Ocorrencia
    } catch (e) {
      if (e instanceof ApiError) throw e
      // Erro de rede ou inesperado — propaga com mensagem clara
      const msg = e instanceof Error ? e.message : String(e)
      throw new ApiError(503, `Erro ao salvar no Supabase: ${msg}`)
    }
  }

  // Comprime fotos antes de enviar pelo Express (mesmo tratamento do caminho Supabase)
  const fotosExpressComprimidas = await comprimirFotos(Array.isArray(dados.fotos) ? dados.fotos : [])
  const dadosComprimidos = { ...dados, fotos: fotosExpressComprimidas }
  const payload = buildPayload(dadosComprimidos)

  // Express (Replit)
  try {
    const res = await fetch('/api/ocorrencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (respostaExpressValida(res)) {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new ApiError(res.status, err.error || res.statusText)
      }
      const data = await res.json()
      if (!data) throw new ApiError(500, 'Servidor retornou resposta inválida')
      return data as Ocorrencia
    }
  } catch (e) {
    if (e instanceof ApiError) throw e
  }

  throw new ApiError(503, 'Servidor indisponível')
}

export async function criarOcorrencia(
  dados: Omit<Ocorrencia, 'id' | 'created_at'>
): Promise<Ocorrencia> {
  try {
    return await enviarOcorrenciaServidor(dados)
  } catch (e) {
    const erroMsg = e instanceof Error ? e.message : String(e)
    console.warn('[api] criarOcorrencia falhou — salvando offline:', erroMsg)
    const localId = await savePending(dados)
    const resultado = localOffline(dados, Number(localId))
    // Anexa o erro para que a UI mostre a causa quando o dispositivo está online
    if (navigator.onLine) {
      (resultado as any)._saveError = erroMsg
    }
    return resultado
  }
}

export async function atualizarOcorrencia(
  id: number,
  dados: Partial<Ocorrencia>
): Promise<Ocorrencia> {
  const { id: _i, _offline: _o, _localId: _l, ...payloadRaw } = dados as Record<string, unknown>
  void _i; void _o; void _l

  // payload começa como payloadRaw; pode ser substituído com fotos comprimidas no bloco Supabase
  let payload: Record<string, unknown> = payloadRaw

  // Supabase direto quando disponível (Netlify)
  if (supabaseDisponivel) {
    // Comprime fotos antes de enviar para evitar payload > 10 MB no Supabase
    const fotosComprimidas = await comprimirFotos(Array.isArray(payloadRaw.fotos) ? payloadRaw.fotos as unknown[] : [])
    payload = { ...payloadRaw, fotos: fotosComprimidas }

    let { data, error } = await supabase
      .from('ocorrencias')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (error && isColumnMissingError(error)) {
      // Colunas ausentes no Supabase — tenta sem elas
      const { hora_inicio: _hi, hora_fim: _hf, horas_total: _ht, horas_sobreaviso: _hs, poligono_area_queimada: _paq, descricoes_fotos: _df, chuva: _chuva, metragem_lona: _metragemLona, ...payloadBase } = payload as Record<string, unknown>
      void _hi; void _hf; void _ht; void _hs; void _paq; void _df; void _chuva; void _metragemLona
      const r2 = await supabase.from('ocorrencias').update(payloadBase).eq('id', id).select().single()
      data = r2.data
      error = r2.error
    }
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Ocorrência não encontrada')
    wsSend({ tipo: 'ocorrencias_atualizadas' })
    return data as Ocorrencia
  }

  // Express (Replit) — comprime fotos antes de enviar
  const fotosExpressAtualizadas = await comprimirFotos(Array.isArray(payloadRaw.fotos) ? payloadRaw.fotos as unknown[] : [])
  payload = { ...payloadRaw, fotos: fotosExpressAtualizadas }

  try {
    const res = await fetch(`/api/ocorrencias/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (respostaExpressValida(res)) {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || res.statusText)
      }
      const data = await res.json()
      if (!data) throw new Error('Ocorrência não encontrada')
      return data as Ocorrencia
    }
  } catch (e) {
    if (e instanceof Error && e.message) throw e
  }

  throw new Error('Servidor indisponível')
}

// Busca fotos e vistorias em lote para exportação (evita N chamadas individuais)
// Usa o endpoint do PostgreSQL local para manter os dados isolados do app original.
export async function buscarFotosOcorrencias(
  ids: number[]
): Promise<Record<number, { fotos: string[]; vistorias: unknown[] }>> {
  if (ids.length === 0) return {}

  // Evita URLs/respostas grandes demais quando o filtro "Todas as datas"
  // reúne muitas ocorrências.
  const lotes: number[][] = []
  for (let i = 0; i < ids.length; i += 50) lotes.push(ids.slice(i, i + 50))

  if (supabaseDisponivel) {
    const result: Record<number, { fotos: string[]; vistorias: unknown[] }> = {}
    for (const lote of lotes) {
      const { data, error } = await supabase
        .from('ocorrencias')
        .select('id,fotos,vistorias')
        .in('id', lote)
      if (error) throw new ApiError(503, `Falha ao buscar fotos: ${error.message}`)
      for (const row of data ?? []) {
        result[Number(row.id)] = {
          fotos: Array.isArray(row.fotos) ? row.fotos : [],
          vistorias: Array.isArray(row.vistorias) ? row.vistorias : [],
        }
      }
    }
    return result
  }

  // Endpoint servidor do PostgreSQL local.
  try {
    const result: Record<number, { fotos: string[]; vistorias: unknown[] }> = {}
    for (const lote of lotes) {
      const res = await fetch(`/api/ocorrencias/fotos-lote?ids=${lote.join(',')}`)
      if (!res.ok) throw new Error(`Falha ao buscar fotos (${res.status})`)
      const rows: { id: number; fotos: string[] | null; vistorias: unknown[] | null }[] = await res.json()
      for (const row of rows) {
        result[row.id] = {
          fotos: Array.isArray(row.fotos) ? row.fotos : [],
          vistorias: Array.isArray(row.vistorias) ? row.vistorias : [],
        }
      }
    }
    return result
  } catch { /* cai para fallbacks abaixo */ }

  return {}
}

// Busca fotos de múltiplos checklists em lote (para exportação Excel)
export async function buscarFotosChecklists(
  ids: number[]
): Promise<Record<number, { foto_frontal: string | null; foto_traseira: string | null; foto_direita: string | null; foto_esquerda: string | null; fotos_avarias: string[] }>> {
  if (ids.length === 0) return {}

  if (supabaseDisponivel) {
    const { data, error } = await supabase
      .from('checklists_viatura')
      .select('id,foto_frontal,foto_traseira,foto_direita,foto_esquerda,fotos_avarias')
      .in('id', ids)
    if (error) throw new ApiError(503, `Falha ao buscar fotos: ${error.message}`)
    const result: Record<number, { foto_frontal: string | null; foto_traseira: string | null; foto_direita: string | null; foto_esquerda: string | null; fotos_avarias: string[] }> = {}
    for (const row of data ?? []) {
      result[Number(row.id)] = {
        foto_frontal: row.foto_frontal ?? null,
        foto_traseira: row.foto_traseira ?? null,
        foto_direita: row.foto_direita ?? null,
        foto_esquerda: row.foto_esquerda ?? null,
        fotos_avarias: Array.isArray(row.fotos_avarias) ? row.fotos_avarias : [],
      }
    }
    return result
  }

  // Express (Replit)
  try {
    const res = await fetch(`/api/checklists/fotos-lote?ids=${ids.join(',')}`)
    if (res.ok) {
      const rows: { id: number; foto_frontal: string | null; foto_traseira: string | null; foto_direita: string | null; foto_esquerda: string | null; fotos_avarias: string[] | null }[] = await res.json()
      const result: Record<number, { foto_frontal: string | null; foto_traseira: string | null; foto_direita: string | null; foto_esquerda: string | null; fotos_avarias: string[] }> = {}
      for (const row of rows) {
        result[row.id] = {
          foto_frontal: row.foto_frontal ?? null,
          foto_traseira: row.foto_traseira ?? null,
          foto_direita: row.foto_direita ?? null,
          foto_esquerda: row.foto_esquerda ?? null,
          fotos_avarias: Array.isArray(row.fotos_avarias) ? row.fotos_avarias : [],
        }
      }
      return result
    }
  } catch { /* segue com vazio */ }
  return {}
}

export async function deletarOcorrencia(id: number): Promise<void> {
  // Supabase direto quando disponível (Netlify)
  if (supabaseDisponivel) {
    const { error } = await supabase.from('ocorrencias').delete().eq('id', id)
    if (error) throw new Error(error.message)
    wsSend({ tipo: 'ocorrencias_atualizadas' })
    return
  }

  // Express (Replit)
  try {
    const res = await fetch(`/api/ocorrencias/${id}`, { method: 'DELETE' })
    if (respostaExpressValida(res)) {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || res.statusText)
      }
      return
    }
  } catch (e) {
    if (e instanceof Error && e.message) throw e
  }

  throw new Error('Servidor indisponível')
}

function mapearRegistroCurral(registro: Record<string, unknown>): CurralRegistro {
  return {
    id: registro.id as string | number,
    especie: String(registro.especie ?? ''),
    porte: String(registro.porte ?? ''),
    sexo: String(registro.sexo ?? ''),
    identificacao: String(registro.identificacao ?? ''),
    localDescricao: String(registro.local_descricao ?? ''),
    observacoes: String(registro.observacoes ?? ''),
    latitude: registro.latitude == null ? null : Number(registro.latitude),
    longitude: registro.longitude == null ? null : Number(registro.longitude),
    precisaoGps: registro.precisao_gps == null ? null : Number(registro.precisao_gps),
    capturadoEm: String(registro.capturado_em ?? registro.created_at ?? ''),
    fotos: Array.isArray(registro.fotos) ? registro.fotos as string[] : [],
    fotosCount: registro.fotos_count == null ? undefined : Number(registro.fotos_count),
    criadoPor: registro.criado_por == null ? null : String(registro.criado_por),
    status: (registro.status as CurralRegistro['status']) ?? 'encontrado',
  }
}

export async function listarRegistrosCurral(): Promise<CurralRegistro[]> {
  if (supabaseDisponivel) {
    const { data, error } = await supabase
      .from('curral_registros')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => mapearRegistroCurral(row as Record<string, unknown>))
  }

  const res = await fetch('/api/curral')
  if (!res.ok) {
    const erro = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(erro.error || res.statusText)
  }
  const dados = await res.json()
  return Array.isArray(dados) ? dados.map(mapearRegistroCurral) : []
}

export async function criarRegistroCurral(dados: CurralDados, agente: string | null): Promise<CurralRegistro> {
  if (supabaseDisponivel) {
    const { data, error } = await supabase
      .from('curral_registros')
      .insert({
        especie: dados.especie,
        porte: dados.porte,
        sexo: dados.sexo || null,
        identificacao: dados.identificacao || null,
        local_descricao: dados.localDescricao,
        observacoes: dados.observacoes || null,
        latitude: dados.latitude,
        longitude: dados.longitude,
        precisao_gps: dados.precisaoGps,
        capturado_em: dados.capturadoEm,
        fotos: dados.fotos,
        status: dados.status,
        criado_por: agente,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return mapearRegistroCurral(data as Record<string, unknown>)
  }

  const res = await fetch('/api/curral', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      especie: dados.especie,
      porte: dados.porte,
      sexo: dados.sexo || null,
      identificacao: dados.identificacao || null,
      local_descricao: dados.localDescricao,
      observacoes: dados.observacoes || null,
      latitude: dados.latitude,
      longitude: dados.longitude,
      precisao_gps: dados.precisaoGps,
      capturado_em: dados.capturadoEm,
      fotos: dados.fotos,
      status: dados.status,
      criado_por: agente,
    }),
  })
  if (!res.ok) {
    const erro = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(erro.error || res.statusText)
  }
  return mapearRegistroCurral(await res.json())
}

export async function atualizarRegistroCurral(id: string | number, dados: CurralDados): Promise<CurralRegistro> {
  if (supabaseDisponivel) {
    const { data, error } = await supabase
      .from('curral_registros')
      .update({
        especie: dados.especie,
        porte: dados.porte,
        sexo: dados.sexo || null,
        identificacao: dados.identificacao || null,
        local_descricao: dados.localDescricao,
        observacoes: dados.observacoes || null,
        latitude: dados.latitude,
        longitude: dados.longitude,
        precisao_gps: dados.precisaoGps,
        capturado_em: dados.capturadoEm,
        fotos: dados.fotos,
        status: dados.status,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return mapearRegistroCurral(data as Record<string, unknown>)
  }

  const res = await fetch(`/api/curral/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      especie: dados.especie,
      porte: dados.porte,
      sexo: dados.sexo || null,
      identificacao: dados.identificacao || null,
      local_descricao: dados.localDescricao,
      observacoes: dados.observacoes || null,
      latitude: dados.latitude,
      longitude: dados.longitude,
      precisao_gps: dados.precisaoGps,
      capturado_em: dados.capturadoEm,
      fotos: dados.fotos,
      status: dados.status,
    }),
  })
  if (!res.ok) {
    const erro = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(erro.error || res.statusText)
  }
  return mapearRegistroCurral(await res.json())
}

function mapearRelatorioProcon(registro: Record<string, unknown>): ProconRegistro {
  const dados = registro.dados && typeof registro.dados === 'object'
    ? registro.dados as Record<string, unknown>
    : registro
  return {
    ...dados,
    id: registro.id ?? dados.id ?? `procon-${Date.now()}`,
    status: registro.status as ProconRegistro['status'] ?? 'pendente',
  } as ProconRegistro
}

export async function listarRelatoriosProcon(): Promise<ProconRegistro[]> {
  if (supabaseDisponivel) {
    const { data, error } = await supabase
      .from('procon_relatorios')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => mapearRelatorioProcon(row as Record<string, unknown>))
  }

  const res = await fetch('/api/procon')
  if (!res.ok) {
    const erro = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(erro.error || res.statusText)
  }
  const dados = await res.json()
  return Array.isArray(dados) ? dados.map(mapearRelatorioProcon) : []
}

export async function criarRelatorioProcon(registro: ProconRegistro): Promise<ProconRegistro> {
  if (supabaseDisponivel) {
    const { data, error } = await supabase
      .from('procon_relatorios')
      .upsert({
        id: String(registro.id),
        status: registro.status || 'pendente',
        criado_por: registro.identificacao.agente,
        dados: registro,
      }, { onConflict: 'id' })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return mapearRelatorioProcon(data as Record<string, unknown>)
  }

  const res = await fetch('/api/procon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: String(registro.id),
      status: registro.status || 'pendente',
      criado_por: registro.identificacao.agente,
      dados: registro,
    }),
  })
  if (!res.ok) {
    const erro = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(erro.error || res.statusText)
  }
  return mapearRelatorioProcon(await res.json())
}

export async function enviarRelatorioProcon(id: string | number): Promise<ProconRegistro> {
  if (supabaseDisponivel) {
    const { data, error } = await supabase
      .from('procon_relatorios')
      .update({ status: 'enviado', atualizado_em: new Date().toISOString() })
      .eq('id', String(id))
      .select()
      .single()
    if (error) throw new Error(error.message)
    return mapearRelatorioProcon(data as Record<string, unknown>)
  }

  const res = await fetch(`/api/procon/${encodeURIComponent(String(id))}/enviar`, { method: 'PUT' })
  if (!res.ok) {
    const erro = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(erro.error || res.statusText)
  }
  return mapearRelatorioProcon(await res.json())
}
