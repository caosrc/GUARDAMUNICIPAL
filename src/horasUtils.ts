import { supabase, supabaseDisponivel } from './supabaseClient'

const FERIADOS_FIXOS_SET = new Set([
  '01-01', '04-21', '05-01', '09-07', '10-12',
  '11-02', '11-15', '11-20', '12-25',
])

function chaveDataDt(dt: Date): string {
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function ehFimDeSemanaOuFeriado(chave: string, feriadosCustom: string[] = []): boolean {
  if (feriadosCustom.includes(chave)) return true
  const [y, m, d] = chave.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = dt.getDay()
  if (dow === 0 || dow === 6) return true
  const mmdd = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return FERIADOS_FIXOS_SET.has(mmdd)
}

// Domingo ou feriado (dom = 0, feriados fixos e custom)
function ehDomingoOuFeriado(chave: string, feriadosCustom: string[] = []): boolean {
  if (feriadosCustom.includes(chave)) return true
  const [y, m, d] = chave.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getDay() === 0) return true
  const mmdd = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return FERIADOS_FIXOS_SET.has(mmdd)
}

// Sábado comum (que não seja feriado)
function ehSabadoComumUtils(chave: string, feriadosCustom: string[] = []): boolean {
  if (ehDomingoOuFeriado(chave, feriadosCustom)) return false
  const [y, m, d] = chave.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() === 6
}

export interface JornadaAgente {
  inicio: string
  fim: string
}

// Jornada normal em dias que não são domingo ou feriado.
// Arthur não foi alterado nesta regra e mantém a jornada comercial anterior.
export const JORNADAS_AGENTES: Record<string, JornadaAgente> = {
  Alexandre: { inicio: '08:00', fim: '16:00' },
  Rosane: { inicio: '08:00', fim: '16:00' },
  Lucas: { inicio: '07:00', fim: '13:00' },
  Junior: { inicio: '13:00', fim: '18:00' },
  Arthur: { inicio: '07:00', fim: '17:00' },
}

const JORNADA_PADRAO: JornadaAgente = { inicio: '07:00', fim: '17:00' }

export function obterJornadaAgente(nome: string | null | undefined): JornadaAgente {
  return JORNADAS_AGENTES[String(nome ?? '').trim()] ?? JORNADA_PADRAO
}

function minutosHora(hora: string): number | null {
  const [h, m] = String(hora || '').split(':').map(Number)
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

function adicionarDias(chave: string, dias: number): string {
  const [y, m, d] = chave.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + dias)
  return chaveDataDt(dt)
}

/**
 * Calcula as horas de uma ocorrência que ficaram fora da jornada normal
 * de um agente. Domingos e feriados continuam contando integralmente, como
 * na regra anterior do banco de horas.
 */
export function calcularHorasForaJornada(
  dataStr: string,
  horaInicio: string,
  horaFim: string,
  jornada: JornadaAgente,
  feriadosCustom: string[] = [],
): number {
  const inicio = minutosHora(horaInicio)
  const fimInformado = minutosHora(horaFim)
  const jornadaInicio = minutosHora(jornada.inicio)
  const jornadaFim = minutosHora(jornada.fim)
  if (!dataStr || inicio == null || fimInformado == null || jornadaInicio == null || jornadaFim == null) return 0

  let fim = fimInformado
  if (fim === inicio) return 0
  if (fim <= inicio) fim += 24 * 60

  let extrasMin = 0
  const diasAbrangidos = Math.ceil((fim - inicio) / (24 * 60))
  for (let deslocamento = 0; deslocamento <= diasAbrangidos; deslocamento++) {
    const inicioDia = deslocamento * 24 * 60
    const segmentoInicio = Math.max(inicio, inicioDia)
    const segmentoFim = Math.min(fim, inicioDia + 24 * 60)
    if (segmentoFim <= segmentoInicio) continue

    const chaveDia = adicionarDias(dataStr, deslocamento)
    if (ehDomingoOuFeriado(chaveDia, feriadosCustom)) {
      extrasMin += segmentoFim - segmentoInicio
      continue
    }

    let janelaInicio = inicioDia + jornadaInicio
    let janelaFim = inicioDia + jornadaFim
    if (janelaFim <= janelaInicio) janelaFim += 24 * 60
    const dentroDaJornada = Math.max(
      0,
      Math.min(segmentoFim, janelaFim) - Math.max(segmentoInicio, janelaInicio),
    )
    extrasMin += (segmentoFim - segmentoInicio) - dentroDaJornada
  }

  return Math.round((extrasMin / 60) * 100) / 100
}

/**
 * Calcula as horas que devem entrar no banco de horas de uma ocorrência.
 *
 * Regra:
 * - Domingo ou feriado: TODAS as horas da ocorrência contam (×1,5 aplicado na Escala).
 * - Demais dias: somente as horas fora da jornada normal do agente contam.
 * Nenhum multiplicador é aplicado aqui — apenas a quantidade de horas qualificadas.
 */
export function calcularHorasOcorrenciaBanco(
  dataStr: string,
  horaInicio: string,
  horaFim: string,
  feriadosCustom: string[] = [],
  agente?: string | null,
): number {
  if (!dataStr || !horaInicio || !horaFim) return 0
  return calcularHorasForaJornada(
    dataStr,
    horaInicio,
    horaFim,
    obterJornadaAgente(agente),
    feriadosCustom,
  )
}

/**
 * Retorna o tipo de situação especial da ocorrência para exibir no resumo de horas.
 */
export function tipoDiaOcorrencia(
  dataStr: string,
  horaInicio: string,
  feriadosCustom: string[] = [],
): 'domingo_feriado' | 'sabado' | 'sobreaviso' | 'normal' {
  if (!dataStr) return 'normal'
  if (ehDomingoOuFeriado(dataStr, feriadosCustom)) return 'domingo_feriado'
  if (ehSabadoComumUtils(dataStr, feriadosCustom)) return 'sabado'
  if (horaInicio) {
    const [h, m] = horaInicio.split(':').map(Number)
    if (!isNaN(h) && (h * 60 + (m || 0)) >= 17 * 60) return 'sobreaviso'
  }
  return 'normal'
}

function minutesSobravisoNoDia(
  _chave: string,
  deMin: number,
  ateMin: number,
  _feriadosCustom: string[] = [],
): number {
  if (ateMin <= deMin) return 0
  const overlap = (a: number, b: number, c: number, d: number) =>
    Math.max(0, Math.min(b, d) - Math.max(a, c))
  let sb = 0
  sb += overlap(deMin, ateMin, 0, 7 * 60)
  sb += overlap(deMin, ateMin, 17 * 60, 24 * 60)
  return sb
}

export function calcularHorasSobreaviso(
  dataStr: string,
  horaInicio: string,
  horaFim: string,
  feriadosCustom: string[] = [],
): number {
  if (!dataStr || !horaInicio || !horaFim) return 0
  const [hI, mI] = horaInicio.split(':').map(Number)
  const [hF, mF] = horaFim.split(':').map(Number)
  if (isNaN(hI) || isNaN(mI) || isNaN(hF) || isNaN(mF)) return 0
  const inicioMin = hI * 60 + mI
  const fimMin = hF * 60 + mF
  if (inicioMin === fimMin) return 0

  const [ano, mes, dia] = dataStr.split('-').map(Number)
  let totalMin = 0

  if (fimMin > inicioMin) {
    totalMin = minutesSobravisoNoDia(dataStr, inicioMin, fimMin, feriadosCustom)
  } else {
    totalMin = minutesSobravisoNoDia(dataStr, inicioMin, 24 * 60, feriadosCustom)
    const dtNext = new Date(ano, mes - 1, dia)
    dtNext.setDate(dtNext.getDate() + 1)
    const chave2 = chaveDataDt(dtNext)
    totalMin += minutesSobravisoNoDia(chave2, 0, fimMin, feriadosCustom)
  }

  return Math.round(totalMin * 100 / 60) / 100
}

/**
 * Retorna o multiplicador de horas conforme o dia da semana e feriados.
 * - Domingo ou feriado (incluindo sábado que cai em feriado): × 2
 * - Sábado comum (não feriado): × 1,5
 * - Demais dias: × 1
 * Os feriados municipais marcados pelo Moisés (feriadosCustom) têm o mesmo peso que dom/feriado fixo (× 2).
 */
export function multiplicadorDia(dataStr: string, feriadosCustom: string[] = []): number {
  if (!dataStr) return 1
  if (ehDomingoOuFeriado(dataStr, feriadosCustom)) return 2
  if (ehSabadoComumUtils(dataStr, feriadosCustom)) return 1.5
  return 1
}

/**
 * Carrega a lista de feriados municipais/locais marcados pelo Moisés na escala.
 * Tenta o localStorage primeiro (síncrono / rápido) e depois confirma com o servidor.
 */
export async function carregarFeriadosCustom(): Promise<string[]> {
  // 1. localStorage — resposta imediata
  try {
    const raw = localStorage.getItem('escala-data-v3')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.feriadosCustom) && parsed.feriadosCustom.length > 0) {
        return parsed.feriadosCustom as string[]
      }
    }
  } catch { /* ignora */ }

  if (supabaseDisponivel) {
    try {
      const { data, error } = await supabase
        .from('escala_estado')
        .select('data')
        .eq('id', 1)
        .single()
      if (!error && Array.isArray((data?.data as { feriadosCustom?: unknown } | null)?.feriadosCustom)) {
        return (data.data as { feriadosCustom: string[] }).feriadosCustom
      }
    } catch { /* ignora */ }
    return []
  }

  // 2. Servidor — fonte de verdade (Moisés pode ter adicionado de outro dispositivo)
  try {
    const res = await fetch('/api/escala')
    if (res.ok) {
      const json = await res.json()
      if (Array.isArray(json?.feriadosCustom)) return json.feriadosCustom as string[]
    }
  } catch { /* ignora */ }

  return []
}

export function calcularHorasTotal(horaInicio: string, horaFim: string): number {
  if (!horaInicio || !horaFim) return 0
  const [hI, mI] = horaInicio.split(':').map(Number)
  const [hF, mF] = horaFim.split(':').map(Number)
  if (isNaN(hI) || isNaN(mI) || isNaN(hF) || isNaN(mF)) return 0
  const inicioMin = hI * 60 + mI
  const fimMin = hF * 60 + mF
  const diff = fimMin >= inicioMin ? fimMin - inicioMin : 24 * 60 - inicioMin + fimMin
  return Math.round(diff * 100 / 60) / 100
}

export function formatarHoras(horas: number): string {
  if (!horas || horas <= 0) return '0h'
  const h = Math.floor(horas)
  const m = Math.round((horas - h) * 60)
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}min`
}

// Busca os dados atuais do servidor sem sobrescrever — para fazer merge seguro
async function buscarDadosServidorAtual(): Promise<Record<string, unknown>> {
  try {
    if (supabaseDisponivel) {
      const { data } = await supabase
        .from('escala_estado')
        .select('data')
        .eq('id', 1)
        .single()
      if (data?.data && typeof data.data === 'object') return data.data as Record<string, unknown>
    } else {
      const res = await fetch('/api/escala')
      if (res.ok) {
        const json = await res.json()
        if (json && typeof json === 'object') return json as Record<string, unknown>
      }
    }
  } catch { /* ignora — usa localStorage como base */ }
  return {}
}

export async function sincronizarHorasEscala(params: {
  agentes: string[]
  dataStr: string
  horasSobreaviso: number
  ocId: number | string
  natureza: string
  oldAgentes?: string[]
  oldDataStr?: string
  oldHorasSobreaviso?: number
}): Promise<void> {
  const { agentes, dataStr, horasSobreaviso, ocId, natureza, oldAgentes, oldDataStr, oldHorasSobreaviso } = params

  // Busca dados do servidor primeiro para não sobrescrever o calendário com localStorage vazio
  const dadosServidor = await buscarDadosServidorAtual()

  // Lê localStorage local
  let dadosLocal: Record<string, unknown>
  try {
    const raw = localStorage.getItem('escala-data-v3')
    dadosLocal = raw ? JSON.parse(raw) : {}
  } catch { dadosLocal = {} }

  // Merge: servidor tem precedência para todos os campos EXCETO horas (que vêm do local)
  // Isso preserva o calendário completo mesmo em dispositivos sem escala no localStorage
  const dados: Record<string, unknown> = { ...dadosServidor }

  // Para as horas, usa o local como base (mais atualizado neste dispositivo)
  const htsBase = (dadosLocal.horasTrabalhadasSobreaviso ?? dadosServidor.horasTrabalhadasSobreaviso ?? {}) as Record<string, Record<string, number>>
  const jsBase = (dadosLocal.justificativasSobreaviso ?? dadosServidor.justificativasSobreaviso ?? {}) as Record<string, Record<string, string>>

  const hts: Record<string, Record<string, number>> = { ...htsBase }
  const js: Record<string, Record<string, string>> = { ...jsBase }

  // Remove horas antigas se for edição — subtrai da data acumulada
  if (oldHorasSobreaviso && oldHorasSobreaviso > 0 && oldAgentes && oldDataStr) {
    for (const agente of oldAgentes) {
      if (hts[agente]?.[oldDataStr] != null) {
        const restante = Math.max(0, (hts[agente][oldDataStr] ?? 0) - oldHorasSobreaviso)
        if (restante <= 0) delete hts[agente][oldDataStr]
        else hts[agente][oldDataStr] = Math.round(restante * 100) / 100
      }
    }
  }

  // Adiciona novas horas (somente se > 0)
  if (horasSobreaviso > 0 && dataStr) {
    const justificativa = `Oc.#${ocId}: ${natureza}`
    for (const agente of agentes) {
      if (!hts[agente]) hts[agente] = {}
      hts[agente][dataStr] = Math.round(((hts[agente][dataStr] ?? 0) + horasSobreaviso) * 100) / 100
      if (!js[agente]) js[agente] = {}
      const existente = js[agente][dataStr] ?? ''
      js[agente][dataStr] = existente ? `${existente}; Oc.#${ocId}: ${natureza}` : justificativa
    }
  }

  dados.horasTrabalhadasSobreaviso = hts
  dados.justificativasSobreaviso = js

  // Atualiza localStorage com dados mesclados
  localStorage.setItem('escala-data-v3', JSON.stringify(dados))

  // Poda dados antigos (> 13 meses) antes de salvar para evitar timeout no Supabase
  const limiteDate = new Date()
  limiteDate.setMonth(limiteDate.getMonth() - 13)
  const limiteStr = limiteDate.toISOString().slice(0, 10)

  function podarAninhado(dict: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {}
    for (const ag of Object.keys(dict)) {
      const entradas: Record<string, unknown> = {}
      for (const k of Object.keys(dict[ag])) { if (k >= limiteStr) entradas[k] = dict[ag][k] }
      if (Object.keys(entradas).length > 0) out[ag] = entradas
    }
    return out
  }

  function podarPlano(dict: Record<string, unknown[]>): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {}
    for (const k of Object.keys(dict)) { if (k >= limiteStr) out[k] = dict[k] }
    return out
  }

  const dadosPodados: Record<string, unknown> = {
    ...dados,
    adm:                        podarPlano((dados.adm as Record<string, unknown[]>) ?? {}),
    sobreaviso:                 podarPlano((dados.sobreaviso as Record<string, unknown[]>) ?? {}),
    sobreavisoSemanal:          podarPlano((dados.sobreavisoSemanal as Record<string, unknown[]>) ?? {}),
    folgas:                     podarPlano((dados.folgas as Record<string, unknown[]>) ?? {}),
    horasSobreaviso:            podarAninhado((dados.horasSobreaviso as Record<string, Record<string, unknown>>) ?? {}),
    horasTrabalhadasSobreaviso: podarAninhado((dados.horasTrabalhadasSobreaviso as Record<string, Record<string, unknown>>) ?? {}),
    justificativasSobreaviso:   podarAninhado((dados.justificativasSobreaviso as Record<string, Record<string, unknown>>) ?? {}),
    descontosFolgaBanco:        podarAninhado((dados.descontosFolgaBanco as Record<string, Record<string, unknown>>) ?? {}),
    horasExtrasSimples:         podarAninhado((dados.horasExtrasSimples as Record<string, Record<string, unknown>>) ?? {}),
    justificativasExtrasSimples:podarAninhado((dados.justificativasExtrasSimples as Record<string, Record<string, unknown>>) ?? {}),
  }

  try {
    const now = new Date().toISOString()
    if (supabaseDisponivel) {
      await supabase
        .from('escala_estado')
        .upsert({ id: 1, data: dadosPodados, updated_at: now }, { onConflict: 'id' })
    } else {
      await fetch('/api/escala', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dadosPodados),
      })
    }
  } catch (e) {
    console.warn('[horasUtils] Falha ao sincronizar escala:', e)
  }
}
