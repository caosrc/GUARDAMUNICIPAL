import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { getAgenteLogado } from './Login'
import ModalSenha from './ModalSenha'
import { wsOn, wsSend } from '../wsClient'
import { supabase, supabaseDisponivel } from '../supabaseClient'
import { getSenhaAgente, normalizarNomeAgente } from '../types'
import { calcularHorasOcorrenciaBanco, obterJornadaAgente } from '../horasUtils'
import type { Ocorrencia } from '../types'
import './EscalaAgentes.css'

// ── Constantes ────────────────────────────────────────────────────
// Agentes atualmente ativos que participam da escala/banco de horas.
const AGENTES_ESCALA = [
  { nome: 'Alexandre', cor: '#0f766e', iniciais: 'AL' },
  { nome: 'Arthur', cor: '#2563eb', iniciais: 'AR' },
  { nome: 'Lucas', cor: '#16a34a', iniciais: 'L' },
  { nome: 'Junior', cor: '#d97706', iniciais: 'JU' },
  { nome: 'Rosane', cor: '#db2777', iniciais: 'RO' },
]

// Todos os agentes ativos podem participar do sobreaviso.
const AGENTES_SEM_SOBREAVISO = new Set<string>()

// Quem pode ser escalado para sobreaviso = agentes operacionais
const AGENTES_SOBREAVISO = AGENTES_ESCALA.filter(ag => !AGENTES_SEM_SOBREAVISO.has(ag.nome))

// Quem só registra horas extras simples (sem sobreaviso, sem multiplicador)
const AGENTES_HORAS_EXTRAS = AGENTES_ESCALA.filter(ag => AGENTES_SEM_SOBREAVISO.has(ag.nome))

const AGENTE_MAP: Record<string, { cor: string; iniciais: string }> = {}
AGENTES_ESCALA.forEach(ag => { AGENTE_MAP[ag.nome] = { cor: ag.cor, iniciais: ag.iniciais } })

const DIAS_SEMANA_HDR  = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const HORAS_POR_SEMANA_SOBREAVISO = 16
const HORAS_POR_DIA_SOBREAVISO = 4.62
// Quantas horas cada folga marcada desconta do banco — varia por agente.
// G e H mantêm a regra de 4h; J mantém a regra de 6h da configuração anterior.
function horasPorFolga(agente: string): number {
  void agente
  return 8
}
// Usado só em textos legados/genéricos quando não há agente em contexto
const HORAS_POR_FOLGA_BANCO = 8

// Feriados nacionais fixos (MM-DD)
const FERIADOS_FIXOS = new Set([
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência do Brasil
  '10-12', // Nossa Sra. Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra
  '12-25', // Natal
])

const DIAS_SEMANA_NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function ehFeriadoOuDomingo(chave: string, feriadosCustom: string[] = []): boolean {
  if (feriadosCustom.includes(chave)) return true
  const [y, m, d] = chave.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getDay() === 0) return true
  const mmdd = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return FERIADOS_FIXOS.has(mmdd)
}

function ehSabadoComum(chave: string, feriadosCustom: string[] = []): boolean {
  if (ehFeriadoOuDomingo(chave, feriadosCustom)) return false
  const [y, m, d] = chave.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() === 6
}

function multiplicadorDia(
  chave: string,
  percDomFer: number = 100,
  percSb: number = 50,
  percSabado: number = 50,
  feriadosCustom: string[] = [],
): number {
  if (ehFeriadoOuDomingo(chave, feriadosCustom)) return 1 + percDomFer / 100
  if (ehSabadoComum(chave, feriadosCustom)) return 1 + percSabado / 100
  return 1 + percSb / 100
}

// Retorna os 7 dias (Seg–Dom) de uma semana dado o Monday
function _diasDaSemana(seg: string): string[] {
  const [y, m, d] = seg.split('-').map(Number)
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(y, m - 1, d)
    dt.setDate(dt.getDate() + i)
    return chaveData(dt.getFullYear(), dt.getMonth(), dt.getDate())
  })
}

// ── Tipos ─────────────────────────────────────────────────────────

interface Ferias {
  agente: string
  inicio: string
  fim: string
}

interface Afastamento {
  agente: string
  inicio: string
  fim: string
  motivo: string
}

interface EscalaData {
  adm: Record<string, string[]>
  sobreaviso: Record<string, string[]>                      // legado — mantido por compat
  sobreavisoSemanal: Record<string, string[]>               // segunda-feira (YYYY-MM-DD) → lista de agentes
  folgas: Record<string, string[]>                          // data (YYYY-MM-DD) → agentes em folga marcada
  ferias: Ferias[]
  afastamentos: Afastamento[]
  horasSobreaviso: Record<string, Record<string, number>>   // legado
  horasTrabalhadasSobreaviso: Record<string, Record<string, number>> // agente → { data: horas }
  justificativasSobreaviso: Record<string, Record<string, string>>   // agente → { data: justificativa do que foi feito na hora extra }
  feriadosCustom: string[]           // feriados municipais/locais: YYYY-MM-DD
  percDomingoFeriado: number         // % de aumento p/ domingo/feriado (padrão 100 → ×2)
  percSobreaviso: number             // % de aumento p/ horas acionado no sobreaviso (padrão 50 → ×1,5)
  percSabado: number
  descontosFolgaBanco: Record<string, Record<string, number>>  // legado — descontos manuais antigos
  horasExtrasSimples: Record<string, Record<string, number>>   // agente → { data: horas } — sem multiplicador
  justificativasExtrasSimples: Record<string, Record<string, string>>  // agente → { data: justificativa }
  ajustesBanco: Record<string, number>                         // agente → horas ajuste manual do Moisés (+/-)
  ajustesBancoLogs?: Record<string, Array<{data: string, delta: number, justificativa?: string}>>  // histórico de ajustes por agente
}

// ── Storage ───────────────────────────────────────────────────────
const STORAGE_KEY = 'escala-data-v3'
const LOCAL_TS_KEY = 'escala-data-v3-ts'

function normalizarSemanal(raw: Record<string, string | string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(raw)) {
    out[k] = Array.isArray(v) ? v : (v ? [v] : [])
  }
  return out
}

function normalizarListaAgentes(agentes: string[]): string[] {
  return Array.from(new Set(agentes.filter(Boolean).map(normalizarNomeAgente)))
}

function normalizarMapaPorData(raw: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [data, agentes] of Object.entries(raw)) {
    out[data] = normalizarListaAgentes([...(out[data] ?? []), ...(Array.isArray(agentes) ? agentes : [])])
  }
  return out
}

function normalizarMapaPorAgente<T>(raw: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [agente, valor] of Object.entries(raw)) {
    const nomeNovo = normalizarNomeAgente(agente)
    // Se já existir uma chave nova, ela é a fonte mais recente/confiável.
    if (!(nomeNovo in out) || agente === nomeNovo) out[nomeNovo] = valor
  }
  return out
}

function normalizarDadosAgentes(data: EscalaData): EscalaData {
  return {
    ...data,
    adm: normalizarMapaPorData(data.adm),
    sobreaviso: normalizarMapaPorData(data.sobreaviso),
    sobreavisoSemanal: normalizarMapaPorData(data.sobreavisoSemanal),
    folgas: normalizarMapaPorData(data.folgas),
    ferias: data.ferias.map((item) => ({ ...item, agente: normalizarNomeAgente(item.agente) })),
    afastamentos: data.afastamentos.map((item) => ({ ...item, agente: normalizarNomeAgente(item.agente) })),
    horasSobreaviso: normalizarMapaPorAgente(data.horasSobreaviso),
    horasTrabalhadasSobreaviso: normalizarMapaPorAgente(data.horasTrabalhadasSobreaviso),
    justificativasSobreaviso: normalizarMapaPorAgente(data.justificativasSobreaviso),
    descontosFolgaBanco: normalizarMapaPorAgente(data.descontosFolgaBanco),
    horasExtrasSimples: normalizarMapaPorAgente(data.horasExtrasSimples),
    justificativasExtrasSimples: normalizarMapaPorAgente(data.justificativasExtrasSimples),
    ajustesBanco: normalizarMapaPorAgente(data.ajustesBanco),
    ajustesBancoLogs: normalizarMapaPorAgente(data.ajustesBancoLogs ?? {}),
  }
}

function carregarDados(): EscalaData {
  try {
    // Tenta v3 primeiro
    const rawV3 = localStorage.getItem(STORAGE_KEY)
    if (rawV3) {
      const p = JSON.parse(rawV3)
      return normalizarDadosAgentes({
        adm: p.adm ?? {},
        sobreaviso: p.sobreaviso ?? {},
        sobreavisoSemanal: normalizarSemanal(p.sobreavisoSemanal ?? {}),
        folgas: normalizarSemanal(p.folgas ?? {}),
        ferias: p.ferias ?? [],
        afastamentos: p.afastamentos ?? [],
        horasSobreaviso: p.horasSobreaviso ?? {},
        horasTrabalhadasSobreaviso: p.horasTrabalhadasSobreaviso ?? {},
        justificativasSobreaviso: p.justificativasSobreaviso ?? {},
        feriadosCustom: p.feriadosCustom ?? [],
        percDomingoFeriado: p.percDomingoFeriado ?? 100,
        percSobreaviso: p.percSobreaviso ?? 50,
        percSabado: p.percSabado ?? 50,
        descontosFolgaBanco: p.descontosFolgaBanco ?? {},
        horasExtrasSimples: p.horasExtrasSimples ?? {},
        justificativasExtrasSimples: p.justificativasExtrasSimples ?? {},
        ajustesBanco: p.ajustesBanco ?? {},
        ajustesBancoLogs: p.ajustesBancoLogs ?? {},
      })
    }
    // Migra v2
    const rawV2 = localStorage.getItem('escala-data-v2')
    if (rawV2) {
      const p = JSON.parse(rawV2)
      return normalizarDadosAgentes({
        adm: p.adm ?? {},
        sobreaviso: p.sobreaviso ?? {},
        sobreavisoSemanal: normalizarSemanal(p.sobreavisoSemanal ?? {}),
        folgas: {},
        ferias: p.ferias ?? [],
        afastamentos: [],
        horasSobreaviso: p.horasSobreaviso ?? {},
        horasTrabalhadasSobreaviso: p.horasTrabalhadasSobreaviso ?? {},
        justificativasSobreaviso: p.justificativasSobreaviso ?? {},
        feriadosCustom: [],
        percDomingoFeriado: 100,
        percSobreaviso: 50,
        percSabado: 50,
        descontosFolgaBanco: {},
        horasExtrasSimples: {},
        justificativasExtrasSimples: {},
        ajustesBanco: {},
      })
    }
  } catch { /* */ }
  return normalizarDadosAgentes({ adm: {}, sobreaviso: {}, sobreavisoSemanal: {}, folgas: {}, ferias: [], afastamentos: [], horasSobreaviso: {}, horasTrabalhadasSobreaviso: {}, justificativasSobreaviso: {}, feriadosCustom: [], percDomingoFeriado: 100, percSobreaviso: 50, percSabado: 50, descontosFolgaBanco: {}, horasExtrasSimples: {}, justificativasExtrasSimples: {}, ajustesBanco: {}, ajustesBancoLogs: {} })
}

// Marca o instante da última edição local — usado para evitar que o snapshot remoto
// (carregado em segundo plano após a montagem) sobrescreva edições recentes do Moisés.
let _ultimaEdicaoLocalTs = 0
function marcarEdicaoLocal() { _ultimaEdicaoLocalTs = Date.now() }
function teveEdicaoLocalRecente(janelaMs = 60_000) {
  return _ultimaEdicaoLocalTs > 0 && (Date.now() - _ultimaEdicaoLocalTs) < janelaMs
}

// Verifica se os dados têm conteúdo real de calendário (sobreaviso, folgas ou adm)
// Evita sobrescrever dados locais ricos com snapshot remoto vazio/parcial.
function dadosTemConteudo(d: EscalaData): boolean {
  const temSobreaviso = Object.keys(d.sobreaviso ?? {}).length > 0
  const temSobreavisoSemanal = Object.keys(d.sobreavisoSemanal ?? {}).length > 0
  const temFolgas = Object.keys(d.folgas ?? {}).length > 0
  const temAdm = Object.keys(d.adm ?? {}).length > 0
  const temFerias = (d.ferias ?? []).length > 0
  const temAfastamentos = (d.afastamentos ?? []).length > 0
  const temHorasTrabalhadas = Object.keys(d.horasTrabalhadasSobreaviso ?? {}).some(
    k => Object.keys((d.horasTrabalhadasSobreaviso ?? {})[k] ?? {}).length > 0
  )
  return temSobreaviso || temSobreavisoSemanal || temFolgas || temAdm || temFerias || temAfastamentos || temHorasTrabalhadas
}

// Verifica se os dados locais têm conteúdo real
function localTemConteudo(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const p = JSON.parse(raw)
    return dadosTemConteudo(p as EscalaData)
  } catch { return false }
}

function respostaExpressValida(res: Response): boolean {
  if (!res.ok) return false
  const ct = res.headers.get('content-type') || ''
  return !ct.includes('text/html')
}

/**
 * Remove entradas com chave de data (YYYY-MM-DD) mais antigas que `mesesRetencao` meses.
 * Mantém todos os campos sem data (percents, ajustes, ferias, feriadosCustom, etc.).
 */
function podarDadosAntigos(data: EscalaData, mesesRetencao = 13): EscalaData {
  const limite = new Date()
  limite.setMonth(limite.getMonth() - mesesRetencao)
  const limiteStr = limite.toISOString().slice(0, 10)

  function podarPlano(dict: Record<string, string[]>): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const k of Object.keys(dict)) { if (k >= limiteStr) out[k] = dict[k] }
    return out
  }

  function podarAninhado<T>(dict: Record<string, Record<string, T>>): Record<string, Record<string, T>> {
    const out: Record<string, Record<string, T>> = {}
    for (const agente of Object.keys(dict)) {
      const entradas: Record<string, T> = {}
      for (const dataKey of Object.keys(dict[agente])) {
        if (dataKey >= limiteStr) entradas[dataKey] = dict[agente][dataKey]
      }
      if (Object.keys(entradas).length > 0) out[agente] = entradas
    }
    return out
  }

  return {
    ...data,
    adm:                        podarPlano(data.adm),
    sobreaviso:                 podarPlano(data.sobreaviso),
    sobreavisoSemanal:          podarPlano(data.sobreavisoSemanal),
    folgas:                     podarPlano(data.folgas),
    horasSobreaviso:            podarAninhado(data.horasSobreaviso),
    horasTrabalhadasSobreaviso: podarAninhado(data.horasTrabalhadasSobreaviso),
    justificativasSobreaviso:   podarAninhado(data.justificativasSobreaviso),
    descontosFolgaBanco:        podarAninhado(data.descontosFolgaBanco),
    horasExtrasSimples:         podarAninhado(data.horasExtrasSimples),
    justificativasExtrasSimples:podarAninhado(data.justificativasExtrasSimples),
  }
}

function salvarDados(data: EscalaData) {
  marcarEdicaoLocal()
  const now = new Date().toISOString()
  const dataNormalizada = normalizarDadosAgentes(data)
  const dataPodada = podarDadosAntigos(dataNormalizada)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataNormalizada))
  localStorage.setItem(LOCAL_TS_KEY, now)

  if (supabaseDisponivel) {
    supabase.from('escala_estado')
      .upsert({ id: 1, data: dataPodada, updated_at: now }, { onConflict: 'id' })
      .then(() => { wsSend({ tipo: 'escala_atualizada' }) })
      .catch((e: unknown) => console.warn('Falha ao salvar escala no Supabase:', e))
    return
  }

  fetch('/api/escala', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dataPodada) })
    .then(() => { wsSend({ tipo: 'escala_atualizada' }) })
    .catch((e: unknown) => console.warn('Falha ao salvar escala:', e))
}

// Versão que aguarda confirmação — usada quando precisamos dar feedback visual.
async function salvarDadosAsync(data: EscalaData): Promise<{ ok: boolean; mensagem?: string }> {
  marcarEdicaoLocal()
  const now = new Date().toISOString()
  const dataNormalizada = normalizarDadosAgentes(data)
  const dataPodada = podarDadosAntigos(dataNormalizada)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataNormalizada))
  localStorage.setItem(LOCAL_TS_KEY, now)

  if (supabaseDisponivel) {
    const { error } = await supabase
      .from('escala_estado')
      .upsert({ id: 1, data: dataPodada, updated_at: now }, { onConflict: 'id' })
    if (error) return { ok: false, mensagem: error.message }
    wsSend({ tipo: 'escala_atualizada' })
    return { ok: true }
  }

  try {
    const res = await fetch('/api/escala', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataPodada),
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); return { ok: false, mensagem: e.error || 'Falha ao salvar' } }
    wsSend({ tipo: 'escala_atualizada' })
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, mensagem: (e as Error)?.message || 'Falha ao salvar escala' }
  }
}

function parseEscalaRow(p: Partial<EscalaData> & Record<string, unknown>): EscalaData {
  return normalizarDadosAgentes({
    adm: (p.adm as EscalaData['adm']) ?? {},
    sobreaviso: (p.sobreaviso as EscalaData['sobreaviso']) ?? {},
    sobreavisoSemanal: normalizarSemanal((p.sobreavisoSemanal as Record<string, string | string[]>) ?? {}),
    folgas: normalizarSemanal((p.folgas as Record<string, string | string[]>) ?? {}),
    ferias: (p.ferias as EscalaData['ferias']) ?? [],
    afastamentos: (p.afastamentos as EscalaData['afastamentos']) ?? [],
    horasSobreaviso: (p.horasSobreaviso as EscalaData['horasSobreaviso']) ?? {},
    horasTrabalhadasSobreaviso: (p.horasTrabalhadasSobreaviso as EscalaData['horasTrabalhadasSobreaviso']) ?? {},
    justificativasSobreaviso: (p.justificativasSobreaviso as EscalaData['justificativasSobreaviso']) ?? {},
    feriadosCustom: (p.feriadosCustom as EscalaData['feriadosCustom']) ?? [],
    percDomingoFeriado: (p.percDomingoFeriado as number) ?? 100,
    percSobreaviso: (p.percSobreaviso as number) ?? 50,
    percSabado: (p.percSabado as number) ?? 50,
    descontosFolgaBanco: (p.descontosFolgaBanco as EscalaData['descontosFolgaBanco']) ?? {},
    horasExtrasSimples: (p.horasExtrasSimples as EscalaData['horasExtrasSimples']) ?? {},
    justificativasExtrasSimples: (p.justificativasExtrasSimples as EscalaData['justificativasExtrasSimples']) ?? {},
    ajustesBanco: (p.ajustesBanco as EscalaData['ajustesBanco']) ?? {},
    ajustesBancoLogs: (p.ajustesBancoLogs as EscalaData['ajustesBancoLogs']) ?? {},
  })
}

async function carregarDadosRemoto(): Promise<{ dados: EscalaData; updatedAt: string } | null> {
  // Supabase — só quando explicitamente habilitado (ex: Netlify)
  if (supabaseDisponivel) {
    try {
      const { data } = await supabase
        .from('escala_estado')
        .select('data, updated_at')
        .eq('id', 1)
        .single()
      if (data?.data) {
        return {
          dados: parseEscalaRow(data.data as Partial<EscalaData> & Record<string, unknown>),
          updatedAt: (data.updated_at as string) ?? '',
        }
      }
      // Supabase sem dados: não consulte o Express, pois ele não existe no Netlify.
      return null
    } catch {
      return null
    }
  }

  if (supabaseDisponivel) return null

  // Express API (Replit PostgreSQL)
  try {
    const res = await fetch('/api/escala')
    if (!respostaExpressValida(res)) return null
    const result = await res.json()
    if (!result) return null
    return {
      dados: parseEscalaRow(result as Partial<EscalaData> & Record<string, unknown>),
      updatedAt: (result.updated_at as string) ?? '',
    }
  } catch { return null }
}

// ── Helpers de data ───────────────────────────────────────────────
function chaveData(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function diasNoMes(ano: number, mes: number): number {
  return new Date(ano, mes + 1, 0).getDate()
}

function primeiroDiaSemana(ano: number, mes: number): number {
  return new Date(ano, mes, 1).getDay()
}

function hojeStr(): string {
  const d = new Date()
  return chaveData(d.getFullYear(), d.getMonth(), d.getDate())
}

function hojeComOffset(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return chaveData(d.getFullYear(), d.getMonth(), d.getDate())
}

// Data mínima permitida para lançamento de horas (hoje - 7 dias)
function prazoLancamentoMin(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return chaveData(d.getFullYear(), d.getMonth(), d.getDate())
}

function fmtDataLonga(str: string) {
  const [y, m, d] = str.split('-')
  return `${d}/${m}/${y}`
}

function fmtDataCurta(str: string) {
  const [, m, d] = str.split('-')
  return `${d}/${m}`
}

// Retorna a data da segunda-feira da semana que contém 'chave'
function segundaDaSemana(chave: string): string {
  const [y, m, d] = chave.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay() // 0=Dom
  const diasAteSegunda = dow === 0 ? 6 : dow - 1
  date.setDate(date.getDate() - diasAteSegunda)
  return chaveData(date.getFullYear(), date.getMonth(), date.getDate())
}

// Retorna a segunda-feira seguinte à data informada
function proximaSegunda(chave: string): string {
  const [y, m, d] = chave.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + 7)
  return chaveData(date.getFullYear(), date.getMonth(), date.getDate())
}

function proximoDia(chave: string): string {
  const [y, m, d] = chave.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + 1)
  return chaveData(date.getFullYear(), date.getMonth(), date.getDate())
}

function _diaAnterior(chave: string): string {
  const [y, m, d] = chave.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - 1)
  return chaveData(date.getFullYear(), date.getMonth(), date.getDate())
}
void _diaAnterior;

// Retorna N segundas-feiras a partir de 'inicio'
function listarSegundas(inicioChave: string, quantidade: number): string[] {
  const lista: string[] = []
  let [y, m, d] = inicioChave.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  for (let i = 0; i < quantidade; i++) {
    lista.push(chaveData(date.getFullYear(), date.getMonth(), date.getDate()))
    date.setDate(date.getDate() + 7)
  }
  return lista
}

function agenteEmFerias(nome: string, chave: string, ferias: Ferias[]): boolean {
  return ferias.some(f => f.agente === nome && chave >= f.inicio && chave <= f.fim)
}

function agenteAfastado(nome: string, chave: string, afastamentos: Afastamento[]): boolean {
  return afastamentos.some(a => a.agente === nome && chave >= a.inicio && chave <= a.fim)
}

// Folgas marcadas para o agente (datas YYYY-MM-DD) — ordenadas crescente
function folgasDoAgente(agente: string, folgas: Record<string, string[]>): string[] {
  return Object.entries(folgas)
    .filter(([, lista]) => lista.includes(agente))
    .map(([data]) => data)
    .sort()
}

// Banco de horas total do agente — só conta dias de sobreaviso que JÁ passaram
// e desconta toda folga marcada (passada ou futura) imediatamente
function calcularBancoHoras(
  agente: string,
  sobreavisoDiario: Record<string, string[]>,
  horasTrabalhadasSobreaviso: Record<string, Record<string, number>> = {},
  percDomFer: number = 100,
  percSb: number = 50,
  percSabado: number = 50,
  feriadosCustom: string[] = [],
  descontosFolgaBanco: Record<string, Record<string, number>> = {},
  folgas: Record<string, string[]> = {},
  hoje: string = hojeStr(),
): number {
  // Conta APENAS os dias de sobreaviso já passados (data < hoje)
  const diasSobreavisoPassados = Object.entries(sobreavisoDiario)
    .filter(([data, lista]) => lista.includes(agente) && data < hoje).length
  const horasFlat = diasSobreavisoPassados * HORAS_POR_DIA_SOBREAVISO
  const horasAgente = horasTrabalhadasSobreaviso[agente] ?? {}
  const horasExtras = Object.entries(horasAgente).reduce((acc, [data, h]) => {
    return acc + (h * multiplicadorDia(data, percDomFer, percSb, percSabado, feriadosCustom))
  }, 0)
  const descontosLegado = Object.values(descontosFolgaBanco[agente] ?? {}).reduce((acc, h) => acc + h, 0)
  // Toda folga marcada (passada ou futura) já desconta do banco —
  // quantidade de horas por folga depende do agente (4h Talita/Cristiane,
  // 6h Sócrates, 8h demais).
  const descontosFolgas = folgasDoAgente(agente, folgas).length * horasPorFolga(agente)
  return horasFlat + horasExtras - descontosLegado - descontosFolgas
}

// ── Modal: escalar agentes para um dia de sobreaviso (Moisés) ─────
interface ModalSemanaProps {
  data: string
  agentesSelecionados: string[]
  ferias: Ferias[]
  afastamentos: Afastamento[]
  onSalvar: (agentes: string[]) => void
  onFechar: () => void
}

function ModalEscalarSemana({ data, agentesSelecionados, ferias, afastamentos, onSalvar, onFechar }: ModalSemanaProps) {
  const [escolhidos, setEscolhidos] = useState<string[]>(agentesSelecionados)
  const fimTurno = proximoDia(data)

  function toggle(nome: string) {
    setEscolhidos(prev =>
      prev.includes(nome) ? prev.filter(n => n !== nome) : [...prev, nome]
    )
  }

  return (
    <div className="escala-modal-overlay" onClick={onFechar}>
      <div className="escala-modal" onClick={e => e.stopPropagation()}>
        <div className="escala-modal-header">
          <div>
            <div className="escala-modal-titulo">📟 Escalar Sobreaviso</div>
            <div className="escala-modal-sub">
              {fmtDataCurta(data)} 17h → {fmtDataCurta(fimTurno)} 07h
            </div>
          </div>
          <button className="escala-modal-fechar" onClick={onFechar}>✕</button>
        </div>

        <div className="sb-semana-info-box">
          <span>⏰</span>
          <span>Pode selecionar mais de um agente para este dia de sobreaviso.</span>
        </div>

        <div className="sb-modal-counter">
          {escolhidos.length === 0
            ? 'Nenhum selecionado'
            : `${escolhidos.length} selecionado${escolhidos.length > 1 ? 's' : ''}`}
        </div>

        <div className="escala-modal-lista">
          {AGENTES_SOBREAVISO.map(ag => {
            const emFerias = agenteEmFerias(ag.nome, data, ferias)
            const emAfastamento = agenteAfastado(ag.nome, data, afastamentos)
            const bloqueado = emFerias || emAfastamento
            const ativo = escolhidos.includes(ag.nome)
            return (
              <button
                key={ag.nome}
                className={`escala-modal-agente ${ativo ? 'selecionado' : ''} ${emFerias ? 'em-ferias' : ''} ${emAfastamento ? 'em-afastamento' : ''}`}
                style={ativo ? { background: ag.cor, borderColor: ag.cor, color: '#fff' } : { borderColor: ag.cor }}
                onClick={() => !bloqueado && toggle(ag.nome)}
                disabled={bloqueado}
              >
                <span className="escala-modal-iniciais" style={{ background: ativo ? 'rgba(255,255,255,0.25)' : ag.cor }}>
                  {ag.iniciais}
                </span>
                <span className="escala-modal-agente-nome">{ag.nome}</span>
                {ativo && <span className="sb-modal-check">✓</span>}
                {emFerias && <span className="escala-modal-ferias-tag">🌴 Férias</span>}
                {emAfastamento && <span className="escala-modal-ferias-tag escala-modal-afastamento-tag">🏥 Afastado</span>}
              </button>
            )
          })}
        </div>

        <div className="escala-modal-acoes">
          <button className="escala-modal-limpar" onClick={() => { setEscolhidos([]); onSalvar([]) }}>
            Limpar
          </button>
          <button
            className="escala-modal-salvar"
            onClick={() => onSalvar(escolhidos)}
            disabled={escolhidos.length === 0}
          >
            Confirmar {escolhidos.length > 0 ? `(${escolhidos.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Painel de Escalas Semanais (Moisés) ──────────────────────────
interface PainelSemanasProps {
  sobreavisoSemanal: Record<string, string[]>
  ferias: Ferias[]
  onEscalar: (seg: string) => void
}

function _PainelEscalasSemanas({ sobreavisoSemanal, ferias: _ferias, onEscalar }: PainelSemanasProps) {
  const hoje = hojeStr()
  const segHoje = segundaDaSemana(hoje)

  // Segunda 2 semanas antes até 8 semanas à frente
  const [y, m, d] = segHoje.split('-').map(Number)
  const inicioLista = new Date(y, m - 1, d)
  inicioLista.setDate(inicioLista.getDate() - 14)
  const inicioChave = chaveData(inicioLista.getFullYear(), inicioLista.getMonth(), inicioLista.getDate())

  const semanas = listarSegundas(inicioChave, 12)

  return (
    <div className="sb-semanas-painel">
      <div className="sb-semanas-header">
        <span className="sb-semanas-titulo">📋 Escalas Semanais — Sobreaviso</span>
        <span className="sb-semanas-subtitulo">Toque para editar</span>
      </div>
      <div className="sb-semanas-lista">
        {semanas.map(seg => {
          const proxSeg = proximaSegunda(seg)
          const agentes = sobreavisoSemanal[seg] ?? []
          const isSemanaAtual = seg === segHoje
          const isFutura = seg > segHoje

          return (
            <button
              key={seg}
              className={`sb-semana-row ${isSemanaAtual ? 'atual' : ''} ${isFutura ? 'futura' : 'passada'}`}
              onClick={() => onEscalar(seg)}
            >
              <div className="sb-semana-periodo">
                <span className="sb-semana-datas">
                  Seg {fmtDataCurta(seg)} 17h → Seg {fmtDataCurta(proxSeg)} 07h
                </span>
                {isSemanaAtual && <span className="sb-semana-tag-atual">Semana atual</span>}
              </div>
              <div className="sb-semana-direita">
                {agentes.length > 0 ? (
                  <div className="sb-semana-badges">
                    {agentes.map(nome => {
                      const info = AGENTE_MAP[nome]
                      return info ? (
                        <span
                          key={nome}
                          className="sb-semana-agente-badge"
                          style={{ background: info.cor + '20', color: info.cor, borderColor: info.cor }}
                        >
                          <span className="sb-semana-agente-cor" style={{ background: info.cor }} />
                          <span className="sb-semana-agente-nome">{nome}</span>
                        </span>
                      ) : null
                    })}
                  </div>
                ) : (
                  <span className="sb-semana-vago">— vago —</span>
                )}
                <span className="sb-semana-editar">✏️</span>
              </div>
            </button>
          )
        })}
      </div>
      <div className="sb-semana-legenda-bh">
        ℹ️ Cada semana de sobreaviso gera <strong>{HORAS_POR_SEMANA_SOBREAVISO}h</strong> no banco de horas e folga na semana seguinte (Seg–Sex).
      </div>
    </div>
  )
}

// ── Horas automáticas de ocorrências ─────────────────────────────
interface HoraOcorrenciaItem {
  ocorrenciaId: number
  data: string
  natureza: string
  endereco: string | null
  horaInicio: string | null
  horasBruto: number
  multiplicador: number
  horasComMult: number
  motivo: 'fora_jornada'
}

function ehHorarioNoturno(horaInicio: string | null): boolean {
  if (!horaInicio) return false
  const h = Number(horaInicio.split(':')[0])
  return h >= 17 || h < 7
}

function ehEntradaDeOcorrencia(justificativa: string): boolean {
  const just = (justificativa ?? '').trim()
  if (!just) return false
  const partes = just.split('; ').map(p => p.trim()).filter(Boolean)
  return partes.length > 0 && partes.every(p => p.startsWith('Oc.#'))
}

function filtrarHorasManuais(
  horasTrabalhadasSobreaviso: Record<string, Record<string, number>>,
  justificativasSobreaviso: Record<string, Record<string, string>>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const [agente, porData] of Object.entries(horasTrabalhadasSobreaviso)) {
    for (const [data, horas] of Object.entries(porData)) {
      const just = justificativasSobreaviso[agente]?.[data] ?? ''
      if (!ehEntradaDeOcorrencia(just)) {
        if (!out[agente]) out[agente] = {}
        out[agente][data] = horas
      }
    }
  }
  return out
}

function computarHorasOcorrencias(
  agente: string,
  ocorrencias: Ocorrencia[],
  feriadosCustom: string[],
  percDomFer: number,
  percSobreaviso: number,
  _percSabado: number,
): { total: number; itens: HoraOcorrenciaItem[] } {
  const itens: HoraOcorrenciaItem[] = []
  for (const oc of ocorrencias) {
    if (!oc.data_ocorrencia) continue
    if (!oc.agentes.includes(agente)) continue

    // Recalcula com a jornada individual. O valor salvo é usado apenas como
    // fallback para ocorrências antigas que ainda não têm horário preenchido.
    const horas = oc.hora_inicio && oc.hora_fim
      ? calcularHorasOcorrenciaBanco(
        oc.data_ocorrencia,
        oc.hora_inicio,
        oc.hora_fim,
        feriadosCustom,
        agente,
      )
      : (oc.horas_sobreaviso ?? 0)
    if (horas <= 0) continue

    const data = oc.data_ocorrencia
    const ehDomFer = ehFeriadoOuDomingo(data, feriadosCustom)
    // Domingo/feriado OU ferido (risco alto) → ×2 (percDomFer); demais → ×1,5 (percSobreaviso)
    const ehFerido = oc.nivel_risco === 'alto'
    const multiplicador = (ehDomFer || ehFerido)
      ? 1 + percDomFer / 100
      : 1 + percSobreaviso / 100

    itens.push({
      ocorrenciaId: oc.id,
      data,
      natureza: oc.natureza,
      endereco: oc.endereco,
      horaInicio: oc.hora_inicio,
      horasBruto: horas,
      multiplicador,
      horasComMult: +(horas * multiplicador).toFixed(2),
      motivo: 'fora_jornada',
    })
  }
  const total = +(itens.reduce((acc, item) => acc + item.horasComMult, 0)).toFixed(2)
  return { total, itens }
}

// ── Banco de Horas: visão do agente ──────────────────────────────
interface BancoHorasAgenteProps {
  agente: string
  sobreavisoSemanal: Record<string, string[]>
  horasTrabalhadasSobreaviso: Record<string, Record<string, number>>
  justificativasSobreaviso: Record<string, Record<string, string>>
  descontosFolgaBanco: Record<string, Record<string, number>>
  folgas: Record<string, string[]>
  percDomingoFeriado: number
  percSobreaviso: number
  percSabado: number
  feriadosCustom: string[]
  onUpdateHoras: (data: string, horas: number) => void
  onUpdateJustificativa: (data: string, justificativa: string) => void
  editavel?: boolean
  hideSobreaviso?: boolean
  hideTotalRow?: boolean
  ajusteBanco?: number
  ocorrencias?: Ocorrencia[]
}

function fmtH(h: number): string {
  return h % 1 === 0 ? String(h) : h.toFixed(1)
}

function BancoHorasAgente({ agente, sobreavisoSemanal, horasTrabalhadasSobreaviso, justificativasSobreaviso, descontosFolgaBanco, folgas, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom, onUpdateHoras, onUpdateJustificativa, editavel = true, hideSobreaviso = false, hideTotalRow = false, ajusteBanco = 0, ocorrencias = [] }: BancoHorasAgenteProps) {
  const info = AGENTE_MAP[agente]
  const hoje = hojeStr()
  const horasAgente = horasTrabalhadasSobreaviso[agente] ?? {}
  const justificativasAgente = justificativasSobreaviso[agente] ?? {}
  const descontosAgente = descontosFolgaBanco[agente] ?? {}

  // ── Navegação mensal ──────────────────────────────────────────
  const agora = new Date()
  const [viewYear, setViewYear] = useState(agora.getFullYear())
  const [viewMonth, setViewMonth] = useState(agora.getMonth())
  const mesPfx = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`

  function navMes(delta: number) {
    let nm = viewMonth + delta
    let ny = viewYear
    if (nm < 0) { nm = 11; ny-- }
    if (nm > 11) { nm = 0; ny++ }
    setViewMonth(nm); setViewYear(ny)
    setSemanaAberta(null)
  }

  // Folgas marcadas para o agente — toda folga marcada já desconta do banco
  const folgasAgente = folgasDoAgente(agente, folgas)
  const proximaFolga = folgasAgente.find(f => f >= hoje) ?? null
  const folgasConsumidas = folgasAgente

  // Dias de sobreaviso deste agente, ordenados mais recentes primeiro
  const semanasDoAgente = useMemo(() => {
    return Object.entries(sobreavisoSemanal)
      .filter(([, lista]) => lista.includes(agente))
      .map(([seg]) => seg)
      .sort((a, b) => b.localeCompare(a))
  }, [agente, sobreavisoSemanal])

  // Semana aberta para editar horas (expandida)
  const [semanaAberta, setSemanaAberta] = useState<string | null>(null)

  const estaDesobreaviso = (sobreavisoSemanal[hoje] ?? []).includes(agente)

  // ── Horas automáticas de ocorrências ──────────────────────────
  const { itens: itensOcorrencias } = useMemo(() => {
    return computarHorasOcorrencias(agente, ocorrencias, feriadosCustom, percDomingoFeriado, percSobreaviso, percSabado)
  }, [agente, ocorrencias, feriadosCustom, percDomingoFeriado, percSobreaviso, percSabado])

  // Entradas manuais apenas (exclui as que vieram de sincronizarHorasEscala via ocorrências)
  const horasAgenteManuais = useMemo(() => {
    const filtrado = filtrarHorasManuais(horasTrabalhadasSobreaviso, justificativasSobreaviso)
    return filtrado[agente] ?? {}
  }, [horasTrabalhadasSobreaviso, justificativasSobreaviso, agente])

  // ── Helper: calcular buckets para um prefixo de mês (ou todos) ─
  function calcBuckets(pfxFrom: string, pfxTo: string) {
    const turnos = semanasDoAgente.filter(d => d >= pfxFrom && d < pfxTo && d < hoje).length
    const baseSb = turnos * HORAS_POR_DIA_SOBREAVISO
    let extSb = 0
    let extFS = 0
    for (const [data, h] of Object.entries(horasAgenteManuais)) {
      if (data < pfxFrom || data >= pfxTo) continue
      const mult = multiplicadorDia(data, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom)
      if (ehFeriadoOuDomingo(data, feriadosCustom) || ehSabadoComum(data, feriadosCustom)) extFS += h * mult
      else extSb += h * mult
    }
    const horasAutoOc = itensOcorrencias
      .filter(i => i.data >= pfxFrom && i.data < pfxTo)
      .reduce((acc, i) => acc + i.horasComMult, 0)
    const descFolgas = folgasConsumidas.filter(d => d >= pfxFrom && d < pfxTo).length * horasPorFolga(agente)
    const descLeg = Object.entries(descontosAgente)
      .filter(([d]) => d >= pfxFrom && d < pfxTo)
      .reduce((acc, [, h]) => acc + h, 0)
    return {
      sobreaviso: +(baseSb + extSb).toFixed(2),
      fimSemana: +extFS.toFixed(2),
      ocAuto: +horasAutoOc.toFixed(2),
      descFolgas: +(descFolgas + descLeg).toFixed(2),
      turnos,
    }
  }

  // Dados do mês visualizado
  const prox = viewMonth === 11
    ? `${viewYear + 1}-01`
    : `${viewYear}-${String(viewMonth + 2).padStart(2, '0')}`
  const mes = calcBuckets(mesPfx, prox)
  const totalMes = +(mes.sobreaviso + mes.fimSemana + mes.ocAuto - mes.descFolgas).toFixed(2)

  // Saldo acumulado de TODOS os meses anteriores ao visualizado
  const saldoAnt = (() => {
    const ant = calcBuckets('0000-00', mesPfx)
    return +(ant.sobreaviso + ant.fimSemana + ant.ocAuto - ant.descFolgas).toFixed(2)
  })()

  // Total acumulado até o final do mês visualizado (+ ajuste, mostrado no rodapé)
  const totalAcumulado = +(saldoAnt + totalMes + ajusteBanco).toFixed(2)

  // Itens filtrados para o mês
  const semanasDoMes = semanasDoAgente.filter(d => d >= mesPfx && d < prox)
  const domferDoMes = Object.entries(horasAgenteManuais)
    .filter(([data]) => data >= mesPfx && data < prox &&
      (ehFeriadoOuDomingo(data, feriadosCustom) || ehSabadoComum(data, feriadosCustom)) &&
      (horasAgenteManuais[data] ?? 0) > 0)
    .sort(([a], [b]) => b.localeCompare(a))
  const itensOcMes = itensOcorrencias.filter(i => i.data >= mesPfx && i.data < prox)
    .slice().sort((a, b) => b.data.localeCompare(a.data))
  const folgasMes = folgasConsumidas.filter(d => d >= mesPfx && d < prox)
  const descontosLegMes = Object.entries(descontosAgente)
    .filter(([d]) => d >= mesPfx && d < prox)
    .sort(([a], [b]) => b.localeCompare(a))

  // Horas de acionamento em dias úteis de uma semana específica
  function horasExtrasDaSemana(seg: string): number {
    const h = horasAgente[seg] ?? 0
    return +(h * multiplicadorDia(seg, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom)).toFixed(2)
  }

  const temConteudoMes = semanasDoMes.length > 0 || domferDoMes.length > 0 ||
    itensOcMes.length > 0 || folgasMes.length > 0 || descontosLegMes.length > 0

  return (
    <div className="bh-agente-wrap">
      {/* ── cabeçalho do agente ──────────────────────────────────── */}
      <div className="bh-agente-cabecalho">
        <span className="bh-card-iniciais" style={{ background: info?.cor ?? '#64748b' }}>
          {info?.iniciais ?? agente.slice(0, 2).toUpperCase()}
        </span>
        <div className="bh-agente-nome-wrap">
          <span className="bh-card-nome">{agente}</span>
          <span className="bh-agente-subtitulo">Banco de Horas</span>
        </div>
      </div>
      {!editavel && (
        <div className="bh-aviso-folga">
          🔒 A escala e os lançamentos de horas são editados somente por Alexandre.
        </div>
      )}

      {estaDesobreaviso && (
        <div className="bh-aviso-ativo">
          🟢 Você está de sobreaviso hoje (17h às 07h)
        </div>
      )}

      {proximaFolga && (
        <div className="bh-aviso-folga">
          🏠 Folga em {fmtDataCurta(proximaFolga)}
        </div>
      )}

      {/* ── Navegação de mês ─────────────────────────────────────── */}
      <div className="bh-mes-nav">
        <button className="bh-mes-nav-btn" onClick={() => navMes(-1)}>◀</button>
        <span className="bh-mes-nav-label">{MESES[viewMonth]} {viewYear}</span>
        <button className="bh-mes-nav-btn" onClick={() => navMes(1)}>▶</button>
      </div>

      {/* ── Saldo acumulado de meses anteriores ─────────────────── */}
      {saldoAnt !== 0 && (
        <div className="bh-saldo-anterior">
          <span className="bh-saldo-ant-label">
            📦 Saldo acumulado até {viewMonth === 0 ? `Dez/${viewYear - 1}` : `${MESES[viewMonth - 1]}/${viewYear}`}
          </span>
          <span className="bh-saldo-ant-valor" style={saldoAnt < 0 ? { color: '#dc2626' } : {}}>
            {saldoAnt >= 0 ? '+' : ''}{fmtH(saldoAnt)}h
          </span>
        </div>
      )}

      {/* ── Sobreaviso (turnos) do mês ───────────────────────────── */}
      {!hideSobreaviso && (
        <div className="bh-bloco">
          <div className="bh-bloco-header">
            <span className="bh-bloco-icone">📟</span>
            <span className="bh-bloco-titulo">Sobreaviso</span>
            <span className="bh-bloco-total">{fmtH(mes.sobreaviso)}h</span>
          </div>

          {semanasDoMes.length === 0 ? (
            <p className="bh-card-vazio">Nenhum turno de sobreaviso em {MESES[viewMonth]}.</p>
          ) : (
            <div className="bh-semanas-lista">
              {semanasDoMes.map(seg => {
                const aberta = semanaAberta === seg
                const horasExtras = horasExtrasDaSemana(seg)
                const totalSemana = (seg < hoje ? HORAS_POR_DIA_SOBREAVISO : 0) + horasExtras
                const foraDoPrazo = seg < prazoLancamentoMin()
                const [y, m, d] = seg.split('-').map(Number)
                const isFerOuDom = ehFeriadoOuDomingo(seg, feriadosCustom)
                const isSabado = ehSabadoComum(seg, feriadosCustom)
                const mult = multiplicadorDia(seg, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom)
                const hInput = horasAgente[seg] ?? 0
                const hCalc = hInput * mult
                const nomeDia = DIAS_SEMANA_NOMES[new Date(y, m - 1, d).getDay()]

                return (
                  <div key={seg} className="bh-semana-bloco">
                    <button
                      className={`bh-semana-header ${aberta ? 'aberta' : ''}`}
                      onClick={() => setSemanaAberta(aberta ? null : seg)}
                    >
                      <span className="bh-semana-titulo">
                        Sobreaviso em {fmtDataCurta(seg)}
                      </span>
                      <div className="bh-semana-resumo">
                        {seg < hoje && <span className="bh-semana-base">Base: {HORAS_POR_DIA_SOBREAVISO}h</span>}
                        {horasExtras > 0 && (
                          <span className="bh-semana-extra">+ {fmtH(horasExtras)}h extras</span>
                        )}
                        <span className="bh-semana-total">= {fmtH(totalSemana)}h</span>
                      </div>
                      <span className="bh-semana-chevron">{aberta ? '▲' : '▼'}</span>
                    </button>

                    {aberta && (
                      <div className="bh-semana-dias">
                        <p className="bh-semana-instrucao">
                          Informe as horas acionadas neste dia. Dias úteis ×{(1 + percSobreaviso / 100).toFixed(1)} · Sábado ×{(1 + percSabado / 100).toFixed(1)} · Dom/Feriado ×{(1 + percDomingoFeriado / 100).toFixed(1)}
                        </p>
                        <div className={`bh-dia-row ${isFerOuDom ? 'feriado-dom' : ''} ${isSabado ? 'sabado' : ''}`}>
                          <div className="bh-dia-top">
                            <div className="bh-dia-info">
                              <span className="bh-dia-nome">{nomeDia}</span>
                              <span className="bh-dia-data">{String(d).padStart(2,'0')}/{String(m).padStart(2,'0')}</span>
                              {isFerOuDom && <span className="bh-dia-badge">×{(1 + percDomingoFeriado / 100).toFixed(1)}</span>}
                              {isSabado && <span className="bh-dia-badge sabado">×{(1 + percSabado / 100).toFixed(1)}</span>}
                              {!isFerOuDom && !isSabado && <span className="bh-dia-badge mult15">×{(1 + percSobreaviso / 100).toFixed(1)}</span>}
                            </div>
                            {foraDoPrazo ? (
                              <span className="bh-dia-prazo-aviso" title="Prazo de 7 dias para lançamento encerrado">🔒 Prazo encerrado</span>
                            ) : (
                              <div className="bh-dia-input-wrap">
                                <input
                                  type="number" min={0} max={24} step={0.5}
                                  value={hInput === 0 ? '' : hInput}
                                  placeholder="0"
                                  className="bh-dia-input"
                                   disabled={!editavel || foraDoPrazo}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0
                                    onUpdateHoras(seg, Math.min(24, Math.max(0, val)))
                                  }}
                                />
                                <span className="bh-dia-input-h">h</span>
                              </div>
                            )}
                            {hInput > 0 && <span className="bh-dia-calc">= {fmtH(hCalc)}h</span>}
                          </div>
                          {hInput > 0 && (
                            <div className="bh-dia-justif-wrap">
                              <label className="bh-dia-justif-label">
                                📝 Justificativa <span className="bh-dia-justif-obrig">*</span>
                              </label>
                              <textarea
                                className={`bh-dia-justif-input ${(justificativasAgente[seg] ?? '').trim() ? '' : 'bh-dia-justif-vazio'}`}
                                placeholder="Descreva o que foi feito nesta hora extra..."
                                value={justificativasAgente[seg] ?? ''}
                                rows={3}
                                maxLength={500}
                                disabled={foraDoPrazo}
                                 readOnly={!editavel}
                                onChange={e => onUpdateJustificativa(seg, e.target.value)}
                              />
                              {!(justificativasAgente[seg] ?? '').trim() && (
                                <span className="bh-dia-justif-aviso">⚠ Justifique o que foi feito nesta hora extra</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Ocorrências automáticas do mês ───────────────────────── */}
      <div className="bh-bloco bh-bloco-ocauto">
        <div className="bh-bloco-header">
          <span className="bh-bloco-icone">🚒</span>
          <span className="bh-bloco-titulo">Ocorrências automáticas</span>
          <span className="bh-bloco-total">+{fmtH(mes.ocAuto)}h</span>
        </div>
        {itensOcMes.length === 0 ? (
          <p className="bh-card-vazio">Nenhuma ocorrência automática em {MESES[viewMonth]}.</p>
        ) : (
          <div className="bh-domfer-lista">
            {itensOcMes.map(item => {
              const motivoTag = `×${item.multiplicador.toFixed(1)} hora extra`
              return (
                <div key={`oc-${item.ocorrenciaId}`} className="bh-domfer-row bh-oc-auto-row">
                  <div className="bh-oc-auto-info">
                    <span className="bh-domfer-data">{fmtDataLonga(item.data)}</span>
                    {item.horaInicio && <span className="bh-oc-auto-hora">🕐 {item.horaInicio}</span>}
                    <span className="bh-oc-auto-nat">{item.natureza}</span>
                    {item.endereco && <span className="bh-oc-auto-end">📍 {item.endereco}</span>}
                  </div>
                  <div className="bh-oc-auto-calc">
                    <span className="bh-oc-auto-mult">{motivoTag}</span>
                    <span className="bh-domfer-input">{fmtH(item.horasBruto)}h</span>
                    <span className="bh-domfer-calc">= {fmtH(item.horasComMult)}h</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Folgas descontadas do mês ─────────────────────────────── */}
      <div className="bh-bloco bh-bloco-descontos">
        <div className="bh-bloco-header">
          <span className="bh-bloco-icone">🏠</span>
          <span className="bh-bloco-titulo">Folgas descontadas</span>
          <span className="bh-bloco-total">-{fmtH(mes.descFolgas)}h</span>
        </div>
        {folgasMes.length === 0 && descontosLegMes.length === 0 ? (
          <p className="bh-card-vazio">Nenhuma folga descontada em {MESES[viewMonth]}.</p>
        ) : (
          <div className="bh-domfer-lista">
            {folgasMes.slice().sort((a, b) => b.localeCompare(a)).map(data => (
              <div key={`auto-${data}`} className="bh-domfer-row desconto">
                <span className="bh-domfer-dia">Folga</span>
                <span className="bh-domfer-data">{fmtDataLonga(data)}</span>
                <span className="bh-domfer-calc">- {fmtH(horasPorFolga(agente))}h</span>
              </div>
            ))}
            {descontosLegMes.map(([data, horas]) => (
              <div key={`legado-${data}`} className="bh-domfer-row desconto">
                <span className="bh-domfer-dia">Folga</span>
                <span className="bh-domfer-data">{fmtDataLonga(data)}</span>
                <span className="bh-domfer-calc">- {fmtH(horas)}h</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Ajuste pelo coordenador ───────────────────────────────── */}
      {ajusteBanco !== 0 && (
        <div className="bh-bloco bh-bloco-ajuste">
          <div className="bh-bloco-header">
            <span className="bh-bloco-icone">⚖️</span>
            <span className="bh-bloco-titulo">Ajuste pelo coordenador</span>
            <span className="bh-bloco-total" style={{ color: ajusteBanco >= 0 ? '#16a34a' : '#dc2626' }}>
              {ajusteBanco >= 0 ? '+' : ''}{fmtH(ajusteBanco)}h
            </span>
          </div>
        </div>
      )}

      {/* ── Subtotal do mês ──────────────────────────────────────── */}
      {temConteudoMes && (
        <div className="bh-subtotal-mes">
          <span>Subtotal — {MESES[viewMonth]}</span>
          <span style={totalMes < 0 ? { color: '#dc2626' } : { color: '#16a34a' }}>
            {totalMes >= 0 ? '+' : ''}{fmtH(totalMes)}h
          </span>
        </div>
      )}

      {/* ── Total acumulado ───────────────────────────────────────── */}
      {!hideTotalRow && (
        <div className="bh-total-geral">
          <span className="bh-total-label">Total de Horas (acumulado)</span>
          <span className="bh-total-valor" style={totalAcumulado < 0 ? { color: '#dc2626' } : {}}>{fmtH(totalAcumulado)}<span className="bh-total-h">h</span></span>
        </div>
      )}
    </div>
  )
}

// ── Banco de Horas Extras (sem multiplicador) — Talita/Cristiane/Sócrates ─
interface BancoHorasExtraSimplesProps {
  agente: string
  horasExtrasSimples: Record<string, Record<string, number>>
  justificativasExtrasSimples: Record<string, Record<string, string>>
  onSalvarHora: (data: string, horas: number, justificativa?: string) => Promise<{ ok: boolean; mensagem?: string }>
  onSalvarJustificativa: (data: string, justificativa: string) => void
  editavel?: boolean
  horasOcorrencias?: number
  ajusteBanco?: number
}

function BancoHorasExtraSimples({ agente, horasExtrasSimples, justificativasExtrasSimples, onSalvarHora, onSalvarJustificativa, editavel = true, horasOcorrencias = 0, ajusteBanco = 0 }: BancoHorasExtraSimplesProps) {
  const info = AGENTE_MAP[agente]
  const horasAgente = horasExtrasSimples[agente] ?? {}
  const justifAgente = justificativasExtrasSimples[agente] ?? {}
  const [novaData, setNovaData] = useState<string>(hojeStr())
  const [novasHoras, setNovasHoras] = useState<string>('')
  const [novaJustif, setNovaJustif] = useState<string>('')
  const [erro, setErro] = useState<string>('')
  const [salvando, setSalvando] = useState(false)
  const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [editandoData, setEditandoData] = useState<string | null>(null)
  const [editandoHoras, setEditandoHoras] = useState<string>('')

  const minData = prazoLancamentoMin()
  const maxData = hojeStr()

  const totalManual = Object.values(horasAgente).reduce((acc, h) => acc + h, 0)
  const total = totalManual
  const totalCombinado = horasOcorrencias + totalManual + ajusteBanco
  const entradas = Object.entries(horasAgente).sort(([a], [b]) => b.localeCompare(a))

  function mostrarFeedback(tipo: 'ok' | 'erro', texto: string) {
    setFeedback({ tipo, texto })
    setTimeout(() => setFeedback(null), 4000)
  }

  async function salvar() {
    const h = parseFloat(novasHoras)
    if (!novaData || isNaN(h) || h <= 0) {
      setErro('Informe uma data e uma quantidade de horas válida.')
      return
    }
    if (!novaJustif.trim()) {
      setErro('A justificativa é obrigatória.')
      return
    }
    if (novaData < minData) {
      setErro(`Prazo encerrado. Só é possível lançar horas dos últimos 7 dias (a partir de ${fmtDataLonga(minData)}).`)
      return
    }
    if (novaData > maxData) {
      setErro('Não é possível lançar horas para datas futuras.')
      return
    }
    setErro('')
    setSalvando(true)
    const atual = horasAgente[novaData] ?? 0
    const resultado = await onSalvarHora(novaData, Math.min(24, atual + h), novaJustif.trim())
    setSalvando(false)
    if (resultado.ok) {
      setNovasHoras('')
      setNovaJustif('')
      mostrarFeedback('ok', `✅ ${fmtH(h)}h salvas no banco de dados (${fmtDataLonga(novaData)})`)
    } else {
      mostrarFeedback('erro', `⚠️ Salvo localmente. Falha ao enviar ao servidor: ${resultado.mensagem ?? 'erro desconhecido'}`)
    }
  }

  async function removerLinha(data: string) {
    setSalvando(true)
    await onSalvarHora(data, 0)
    setSalvando(false)
    if (editandoData === data) setEditandoData(null)
  }

  async function salvarEdicao(data: string) {
    const h = parseFloat(editandoHoras)
    if (isNaN(h) || h <= 0) {
      await removerLinha(data)
      return
    }
    setSalvando(true)
    const resultado = await onSalvarHora(data, Math.min(24, h))
    setSalvando(false)
    setEditandoData(null)
    if (resultado.ok) {
      mostrarFeedback('ok', `✅ Entrada de ${fmtDataLonga(data)} atualizada para ${fmtH(h)}h`)
    } else {
      mostrarFeedback('erro', `⚠️ Salvo localmente. Falha no servidor: ${resultado.mensagem ?? 'erro desconhecido'}`)
    }
  }

  return (
    <div className="bh-agente-wrap">
      <div className="bh-agente-cabecalho">
        <span className="bh-card-iniciais" style={{ background: info?.cor ?? '#64748b' }}>
          {info?.iniciais ?? agente.slice(0, 2).toUpperCase()}
        </span>
        <div className="bh-agente-nome-wrap">
          <span className="bh-card-nome">{agente}</span>
          <span className="bh-agente-subtitulo">Banco de Horas Extras</span>
        </div>
      </div>
      {!editavel && (
        <div className="bh-aviso-folga">
          🔒 A escala e os lançamentos de horas são editados somente por Alexandre.
        </div>
      )}

      <div className="bh-bloco">
        <div className="bh-bloco-header">
          <span className="bh-bloco-icone">⏱️</span>
          <span className="bh-bloco-titulo">Horas extras manuais (sem multiplicador)</span>
          <span className="bh-bloco-total">{fmtH(total)}h</span>
        </div>

        {editavel && <div className="escala-ferias-form" style={{ padding: '12px 14px' }}>
          <div className="escala-ferias-datas">
            <div className="escala-ferias-data-campo">
              <label>Data</label>
              <input
                type="date"
                value={novaData}
                min={minData}
                max={maxData}
                onChange={e => { setNovaData(e.target.value); setErro('') }}
              />
            </div>
            <div className="escala-ferias-data-campo">
              <label>Horas</label>
              <input
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={novasHoras}
                placeholder="0"
                onChange={e => { setNovasHoras(e.target.value); setErro('') }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b7280' }}>Justificativa <span style={{ color: '#dc2626' }}>*</span></label>
            <textarea
              className="escala-justif-textarea"
              rows={2}
              maxLength={500}
              placeholder="Ex: reunião de coordenação, vistoria emergencial..."
              value={novaJustif}
              onChange={e => setNovaJustif(e.target.value)}
            />
          </div>
          <p className="bh-prazo-aviso-texto">⏰ Prazo: até 7 dias após o dia da atividade (a partir de {fmtDataLonga(minData)})</p>
          {erro && <span className="escala-ferias-erro">{erro}</span>}
          <button className="escala-ferias-add bh-salvar-btn" onClick={salvar} disabled={salvando}>
            {salvando ? '⏳ Salvando no banco de dados…' : '💾 Salvar horas no banco de dados'}
          </button>
          {feedback && (
            <div className={`bh-salvar-feedback bh-salvar-feedback--${feedback.tipo}`}>
              {feedback.texto}
            </div>
          )}
        </div>}

        {entradas.length === 0 ? (
          <p className="bh-card-vazio">Nenhuma hora extra registrada.</p>
        ) : (
          <div className="bh-domfer-lista">
            {entradas.map(([data, h]) => {
              const isDateKey = /^\d{4}-\d{2}-\d{2}/.test(data)
              const [y, m, d] = isDateKey ? data.split('-').map(Number) : [0, 0, 0]
              const dow = isDateKey ? new Date(y, m - 1, d).getDay() : -1
              const nomeDia = isDateKey ? DIAS_SEMANA_NOMES[dow] : '—'
              const dataDisplay = isDateKey ? `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}` : data
              const justif = justifAgente[data]
              const estaEditando = editandoData === data
              return (
                <div key={data} className="bh-domfer-row bh-domfer-row--justif">
                  <div className="bh-domfer-row-topo">
                    <span className="bh-domfer-dia">{nomeDia}</span>
                    <span className="bh-domfer-data">{dataDisplay}</span>
                    {estaEditando ? (
                      <div className="bh-extra-edit-inline">
                        <input
                          type="number"
                          min={0.5}
                          max={24}
                          step={0.5}
                          className="bh-extra-edit-input"
                          value={editandoHoras}
                          autoFocus
                          onChange={e => setEditandoHoras(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') salvarEdicao(data); if (e.key === 'Escape') setEditandoData(null) }}
                        />
                        <span className="bh-domfer-input-h">h</span>
                        <button className="bh-extra-edit-ok" onClick={() => salvarEdicao(data)} disabled={salvando}>✓</button>
                        <button className="bh-extra-edit-cancel" onClick={() => setEditandoData(null)}>✕</button>
                      </div>
                    ) : (
                      <>
                        <span className="bh-domfer-input">{fmtH(h)}h</span>
                        <span className="bh-domfer-mult">×1,0</span>
                        <span className="bh-domfer-calc">= {fmtH(h)}h</span>
                        <button
                          className="bh-extra-edit-btn"
                          onClick={() => { setEditandoData(data); setEditandoHoras(String(h)) }}
                           disabled={!editavel || salvando}
                          title="Editar horas"
                        >✏️</button>
                        <button
                          className="escala-ferias-remover"
                          onClick={() => removerLinha(data)}
                           disabled={!editavel || salvando}
                          title="Remover"
                        >✕</button>
                      </>
                    )}
                  </div>
                  {justif && (
                    <div className="bh-domfer-justif">📝 {justif}</div>
                  )}
                   {!justif && !estaEditando && editavel && (
                    <div className="bh-domfer-justif-input-wrap">
                      <input
                        className="bh-domfer-justif-input"
                        type="text"
                        placeholder="Adicionar justificativa..."
                        defaultValue=""
                        onBlur={e => { if (e.target.value.trim()) onSalvarJustificativa(data, e.target.value.trim()) }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {horasOcorrencias > 0 && (
        <div className="bh-bloco" style={{ marginTop: 8 }}>
          <div className="bh-bloco-header">
            <span className="bh-bloco-icone">🚨</span>
            <span className="bh-bloco-titulo">Horas de ocorrências (sobreaviso)</span>
            <span className="bh-bloco-total">{fmtH(horasOcorrencias)}h</span>
          </div>
        </div>
      )}

      {ajusteBanco !== 0 && (
        <div className="bh-bloco bh-bloco-ajuste">
          <div className="bh-bloco-header">
            <span className="bh-bloco-icone">⚖️</span>
            <span className="bh-bloco-titulo">Ajuste pelo coordenador</span>
            <span className="bh-bloco-total" style={{ color: ajusteBanco >= 0 ? '#16a34a' : '#dc2626' }}>
              {ajusteBanco >= 0 ? '+' : ''}{fmtH(ajusteBanco)}h
            </span>
          </div>
        </div>
      )}

      <div className="bh-total-geral">
        <span className="bh-total-label">Total de Horas</span>
        <span className="bh-total-valor" style={totalCombinado < 0 ? { color: '#dc2626' } : {}}>{fmtH(totalCombinado)}<span className="bh-total-h">h</span></span>
      </div>
    </div>
  )
}

// ── Modal de Detalhes do Banco de Horas ──────────────────────────
interface ModalDetalhesBancoProps {
  agente: { nome: string; cor: string; iniciais: string }
  isExtras: boolean
  sobreavisoSemanal: Record<string, string[]>
  horasTrabalhadasSobreaviso: Record<string, Record<string, number>>
  justificativasSobreaviso: Record<string, Record<string, string>>
  horasExtrasSimples: Record<string, Record<string, number>>
  justificativasExtrasSimples: Record<string, Record<string, string>>
  folgas: Record<string, string[]>
  descontosFolgaBanco: Record<string, Record<string, number>>
  ajusteBanco: number
  ajustesBancoLogs?: Array<{data: string, delta: number, justificativa?: string}>
  percDomingoFeriado: number
  percSobreaviso: number
  percSabado: number
  feriadosCustom: string[]
  hoje: string
  onFechar: () => void
  onEditar?: () => void
  onRemoverAjuste?: (index: number) => void
  ocorrenciasItens?: HoraOcorrenciaItem[]
}

function ModalDetalhesBanco({
  agente, isExtras,
  sobreavisoSemanal, horasTrabalhadasSobreaviso, justificativasSobreaviso,
  horasExtrasSimples, justificativasExtrasSimples,
  folgas, descontosFolgaBanco, ajusteBanco, ajustesBancoLogs = [],
  percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom,
  hoje, onFechar, onEditar, onRemoverAjuste, ocorrenciasItens = [],
}: ModalDetalhesBancoProps) {
  const hojeAno = Number(hoje.slice(0, 4))
  const hojeMes = Number(hoje.slice(5, 7)) - 1
  const [viewYear, setViewYear] = useState(hojeAno)
  const [viewMonth, setViewMonth] = useState(hojeMes)
  const [ajusteExpandido, setAjusteExpandido] = useState(false)
  const [confirmandoRemocaoIdx, setConfirmandoRemocaoIdx] = useState<number | null>(null)

  const mesPfx = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`

  function navMes(delta: number) {
    let nm = viewMonth + delta
    let ny = viewYear
    if (nm < 0) { nm = 11; ny-- }
    if (nm > 11) { nm = 0; ny++ }
    setViewMonth(nm)
    setViewYear(ny)
  }

  const isSobreaviso = !isExtras

  const turnosMes = isSobreaviso
    ? Object.entries(sobreavisoSemanal)
        .filter(([data, lista]) => data.startsWith(mesPfx) && lista.includes(agente.nome))
        .sort(([a], [b]) => a.localeCompare(b))
    : []
  const horasTurnosMes = turnosMes.filter(([data]) => data < hoje).length * HORAS_POR_DIA_SOBREAVISO

  const horasOcAgenteBruto = horasTrabalhadasSobreaviso[agente.nome] ?? {}
  const justifOcAgente = justificativasSobreaviso[agente.nome] ?? {}
  // Exclui entradas que vieram de sincronizarHorasEscala (padrão "Oc.#...")
  const horasOcAgente = Object.fromEntries(
    Object.entries(horasOcAgenteBruto).filter(([data]) => !ehEntradaDeOcorrencia(justifOcAgente[data] ?? ''))
  )
  const ocsMes = Object.entries(horasOcAgente)
    .filter(([data]) => data.startsWith(mesPfx))
    .sort(([a], [b]) => a.localeCompare(b))
  const horasOcMes = ocsMes.reduce((acc, [data, h]) => {
    return acc + h * multiplicadorDia(data, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom)
  }, 0)

  const horasManAgente = horasExtrasSimples[agente.nome] ?? {}
  const justifManAgente = justificativasExtrasSimples[agente.nome] ?? {}
  const extMes = Object.entries(horasManAgente)
    .filter(([data]) => data.startsWith(mesPfx))
    .sort(([a], [b]) => a.localeCompare(b))
  const horasExtMes = extMes.reduce((acc, [, h]) => acc + h, 0)

  // Ocorrências automáticas filtradas para o mês visível
  const ocAutoMes = ocorrenciasItens
    .filter(item => item.data.startsWith(mesPfx))
    .sort((a, b) => a.data.localeCompare(b.data))
  const horasOcAutoMes = ocAutoMes.reduce((acc, item) => acc + item.horasComMult, 0)

  const folgasMes = folgasDoAgente(agente.nome, folgas)
    .filter(data => data.startsWith(mesPfx))
  const descontoFolgasMes = folgasMes.length * horasPorFolga(agente.nome)
  const descontosLegMes = Object.entries(descontosFolgaBanco[agente.nome] ?? {})
    .filter(([data]) => data.startsWith(mesPfx))
    .reduce((acc, [, h]) => acc + h, 0)

  const totalMes = horasTurnosMes + horasOcMes + horasExtMes + horasOcAutoMes - descontoFolgasMes - descontosLegMes

  const turnosTotaisPassados = isSobreaviso
    ? Object.entries(sobreavisoSemanal)
        .filter(([data, lista]) => lista.includes(agente.nome) && data < hoje).length
    : 0
  const horasTurnosTotais = turnosTotaisPassados * HORAS_POR_DIA_SOBREAVISO
  const horasOcTotal = Object.entries(horasOcAgente).reduce((acc, [data, h]) => {
    return acc + h * multiplicadorDia(data, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom)
  }, 0)
  const horasManTotal = Object.values(horasManAgente).reduce((acc, h) => acc + h, 0)
  const horasOcAutoTotal = ocorrenciasItens.reduce((acc, item) => acc + item.horasComMult, 0)
  const descontosFolgasTotal = folgasDoAgente(agente.nome, folgas).length * horasPorFolga(agente.nome)
  const descontosLegTotal = Object.values(descontosFolgaBanco[agente.nome] ?? {}).reduce((acc, h) => acc + h, 0)
  const totalGeral = horasTurnosTotais + horasOcTotal + horasManTotal + horasOcAutoTotal - descontosFolgasTotal - descontosLegTotal + ajusteBanco

  const temConteudoMes = turnosMes.length > 0 || ocsMes.length > 0 || extMes.length > 0 || folgasMes.length > 0 || ocAutoMes.length > 0

  // ── Resumo por categoria (todo o período) ────────────────────
  const manualPorCateg = { noturno: 0 }
  for (const [data, h] of Object.entries(horasOcAgente)) {
    const mult = multiplicadorDia(data, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom)
    manualPorCateg.noturno += h * mult
  }
  const autoPorCateg = {
    noturno: ocorrenciasItens.reduce((a, i) => a + i.horasComMult, 0),
  }
  const categNoturno = +(manualPorCateg.noturno + autoPorCateg.noturno).toFixed(2)
  const categManuais = horasManTotal
  const totalFolgasDesc = descontosFolgasTotal + descontosLegTotal

  // ── Saldo acumulado antes do mês visualizado ─────────────────
  const saldoAntesMes = (() => {
    const sbAnt = isSobreaviso
      ? Object.entries(sobreavisoSemanal)
          .filter(([d, lista]) => d < mesPfx && lista.includes(agente.nome) && d < hoje)
          .length * HORAS_POR_DIA_SOBREAVISO
      : 0
    const ocManAnt = Object.entries(horasOcAgente)
      .filter(([d]) => d < mesPfx)
      .reduce((acc, [d, h]) => acc + h * multiplicadorDia(d, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom), 0)
    const ocAutoAnt = ocorrenciasItens
      .filter(i => i.data < mesPfx)
      .reduce((acc, i) => acc + i.horasComMult, 0)
    const extAnt = Object.entries(horasManAgente)
      .filter(([d]) => d < mesPfx)
      .reduce((acc, [, h]) => acc + h, 0)
    const folgasAnt = folgasDoAgente(agente.nome, folgas)
      .filter(d => d < mesPfx).length * horasPorFolga(agente.nome)
    const legAnt = Object.entries(descontosFolgaBanco[agente.nome] ?? {})
      .filter(([d]) => d < mesPfx)
      .reduce((acc, [, h]) => acc + h, 0)
    return +(sbAnt + ocManAnt + ocAutoAnt + extAnt - folgasAnt - legAnt).toFixed(2)
  })()

  return (
    <div className="escala-modal-overlay" onClick={onFechar}>
      <div className="escala-modal bh-detalhe-modal" onClick={e => e.stopPropagation()}>
        <div className="escala-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="bh-edit-cor" style={{ background: agente.cor }} />
            <span className="escala-modal-titulo">{agente.nome} — Banco de Horas</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {onEditar && (
              <button className="bh-detalhe-editar-btn" onClick={onEditar} title="Ajustar total manualmente">✏️ Ajustar</button>
            )}
            <button className="escala-modal-fechar" onClick={onFechar}>✕</button>
          </div>
        </div>

        <div className="bh-detalhe-total-geral">
          <span className="bh-detalhe-total-label">Total geral no banco</span>
          <span className="bh-detalhe-total-valor" style={totalGeral < 0 ? { color: '#dc2626' } : {}}>
            {totalGeral >= 0 ? '' : '-'}{fmtH(Math.abs(totalGeral))}h
          </span>
        </div>

        <div className="bh-resumo-categorias">
          <div className="bh-resumo-categ-titulo">📊 Composição do banco de horas</div>
          <div className="bh-resumo-categ-lista">
            {isSobreaviso && horasTurnosTotais > 0 && (
              <div className="bh-resumo-categ-item">
                <span className="bh-resumo-categ-icone">📟</span>
                <span className="bh-resumo-categ-nome">Sobreaviso (turnos)</span>
                <span className="bh-resumo-categ-valor positivo">+{fmtH(horasTurnosTotais)}h</span>
              </div>
            )}
            {categNoturno > 0 && (
              <div className="bh-resumo-categ-item">
                <span className="bh-resumo-categ-icone">🌙</span>
                <span className="bh-resumo-categ-nome">Ocorrências (hora extra) ×1,5/×2</span>
                <span className="bh-resumo-categ-valor positivo">+{fmtH(categNoturno)}h</span>
              </div>
            )}
            {categManuais > 0 && (
              <div className="bh-resumo-categ-item">
                <span className="bh-resumo-categ-icone">⏱️</span>
                <span className="bh-resumo-categ-nome">Horas extras manuais</span>
                <span className="bh-resumo-categ-valor positivo">+{fmtH(categManuais)}h</span>
              </div>
            )}
            {totalFolgasDesc > 0 && (
              <div className="bh-resumo-categ-item">
                <span className="bh-resumo-categ-icone">🏠</span>
                <span className="bh-resumo-categ-nome">Folgas consumidas</span>
                <span className="bh-resumo-categ-valor negativo">-{fmtH(totalFolgasDesc)}h</span>
              </div>
            )}
            {ajusteBanco !== 0 && (
              <div className="bh-resumo-categ-item">
                <span className="bh-resumo-categ-icone">⚖️</span>
                <span className="bh-resumo-categ-nome">Ajuste do coordenador</span>
                <span className="bh-resumo-categ-valor" style={ajusteBanco >= 0 ? { color: '#16a34a' } : { color: '#dc2626' }}>
                  {ajusteBanco > 0 ? '+' : ''}{fmtH(ajusteBanco)}h
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="bh-detalhe-mes-nav">
          <button className="bh-detalhe-mes-btn" onClick={() => navMes(-1)}>◀</button>
          <span className="bh-detalhe-mes-label">{MESES[viewMonth]} {viewYear}</span>
          <button className="bh-detalhe-mes-btn" onClick={() => navMes(1)}>▶</button>
        </div>

        <div className="bh-detalhe-corpo">
          {isSobreaviso && (
            <div className="bh-detalhe-secao">
              <div className="bh-detalhe-secao-header">
                <span className="bh-detalhe-secao-titulo">📟 Turnos de sobreaviso</span>
                <span className="bh-detalhe-secao-sub">{fmtH(horasTurnosMes)}h</span>
              </div>
              {turnosMes.length === 0 ? (
                <p className="bh-detalhe-vazio">Nenhum turno neste mês.</p>
              ) : (
                <div className="bh-detalhe-lista">
                  {turnosMes.map(([seg]) => {
                    const proxSeg = proximaSegunda(seg)
                    const passado = seg < hoje
                    return (
                      <div key={seg} className={`bh-detalhe-item ${passado ? '' : 'bh-detalhe-item--futuro'}`}>
                        <div className="bh-detalhe-item-esq">
                          <span className="bh-detalhe-item-data">{fmtDataCurta(seg)} → {fmtDataCurta(proxSeg)}</span>
                          <span className="bh-detalhe-item-desc">Turno de sobreaviso ({HORAS_POR_DIA_SOBREAVISO}h base)</span>
                        </div>
                        <span className={`bh-detalhe-item-val ${passado ? 'positivo' : 'neutro'}`}>
                          {passado ? `+${fmtH(HORAS_POR_DIA_SOBREAVISO)}h` : 'a vencer'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {ocsMes.length > 0 && (
            <div className="bh-detalhe-secao">
              <div className="bh-detalhe-secao-header">
                <span className="bh-detalhe-secao-titulo">🚨 Acionamentos em ocorrências</span>
                <span className="bh-detalhe-secao-sub">{fmtH(Math.round(horasOcMes * 100) / 100)}h (c/ multiplicador)</span>
              </div>
              <div className="bh-detalhe-lista">
                {ocsMes.map(([data, h]) => {
                  const mult = multiplicadorDia(data, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom)
                  const isFerOuDom = ehFeriadoOuDomingo(data, feriadosCustom)
                  const isSab = ehSabadoComum(data, feriadosCustom)
                  const multTag = isFerOuDom
                    ? `×${mult.toFixed(1)} dom/feriado`
                    : isSab
                      ? `×${mult.toFixed(1)} sábado`
                      : `×${mult.toFixed(1)} sobreaviso`
                  const justif = justifOcAgente[data]
                  const hFinal = Math.round(h * mult * 100) / 100
                  return (
                    <div key={data} className="bh-detalhe-item bh-detalhe-item--oc">
                      <div className="bh-detalhe-item-esq">
                        <span className="bh-detalhe-item-data">{fmtDataLonga(data)}</span>
                        <span className="bh-detalhe-item-mult-tag">{multTag}</span>
                        {justif && (
                          <span className="bh-detalhe-item-desc">
                            {justif.split('; ').map((j, i) => (
                              <span key={i} className="bh-detalhe-justif-linha">📋 {j}</span>
                            ))}
                          </span>
                        )}
                      </div>
                      <div className="bh-detalhe-item-dir">
                        <span className="bh-detalhe-item-bruto">{fmtH(h)}h bruto</span>
                        <span className="bh-detalhe-item-val positivo">+{fmtH(hFinal)}h</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {ocAutoMes.length > 0 && (
            <div className="bh-detalhe-secao">
              <div className="bh-detalhe-secao-header">
                <span className="bh-detalhe-secao-titulo">🚒 Ocorrências automáticas</span>
                <span className="bh-detalhe-secao-sub">{fmtH(Math.round(horasOcAutoMes * 100) / 100)}h (c/ multiplicador)</span>
              </div>
              <div className="bh-detalhe-lista">
                {ocAutoMes.map(item => {
                  const motivoTag = `×${item.multiplicador.toFixed(1)} hora extra`
                  return (
                    <div key={`ocauto-${item.ocorrenciaId}`} className="bh-detalhe-item bh-detalhe-item--oc">
                      <div className="bh-detalhe-item-esq">
                        <span className="bh-detalhe-item-data">{fmtDataLonga(item.data)}</span>
                        <span className="bh-detalhe-item-mult-tag">{motivoTag}</span>
                        <span className="bh-detalhe-item-desc">{item.natureza}</span>
                        {item.horaInicio && (
                          <span className="bh-detalhe-item-desc">🕐 {item.horaInicio}</span>
                        )}
                        {item.endereco && (
                          <span className="bh-detalhe-item-desc">📍 {item.endereco}</span>
                        )}
                      </div>
                      <div className="bh-detalhe-item-dir">
                        <span className="bh-detalhe-item-bruto">{fmtH(item.horasBruto)}h bruto</span>
                        <span className="bh-detalhe-item-val positivo">+{fmtH(item.horasComMult)}h</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {isExtras && extMes.length > 0 && (
            <div className="bh-detalhe-secao">
              <div className="bh-detalhe-secao-header">
                <span className="bh-detalhe-secao-titulo">⏱️ Horas extras manuais</span>
                <span className="bh-detalhe-secao-sub">{fmtH(horasExtMes)}h</span>
              </div>
              <div className="bh-detalhe-lista">
                {extMes.map(([data, h]) => {
                  const justif = justifManAgente[data]
                  return (
                    <div key={data} className="bh-detalhe-item">
                      <div className="bh-detalhe-item-esq">
                        <span className="bh-detalhe-item-data">{fmtDataLonga(data)}</span>
                        {justif && <span className="bh-detalhe-item-desc">📋 {justif}</span>}
                      </div>
                      <span className="bh-detalhe-item-val positivo">+{fmtH(h)}h</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {folgasMes.length > 0 && (
            <div className="bh-detalhe-secao">
              <div className="bh-detalhe-secao-header">
                <span className="bh-detalhe-secao-titulo">🏠 Folgas descontadas</span>
                <span className="bh-detalhe-secao-sub">-{fmtH(descontoFolgasMes)}h</span>
              </div>
              <div className="bh-detalhe-lista">
                {folgasMes.map(data => (
                  <div key={data} className="bh-detalhe-item bh-detalhe-item--desc">
                    <span className="bh-detalhe-item-data">{fmtDataLonga(data)}</span>
                    <span className="bh-detalhe-item-val negativo">-{fmtH(horasPorFolga(agente.nome))}h</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!temConteudoMes && (
            <div className="bh-detalhe-vazio-mes">
              Nenhuma atividade em {MESES[viewMonth]} de {viewYear}.
            </div>
          )}

          {temConteudoMes && (
            <>
              {saldoAntesMes !== 0 && (
                <div className="bh-detalhe-saldo-anterior">
                  <span>Saldo acumulado até {viewMonth === 0 ? `Dez/${viewYear - 1}` : `${MESES[viewMonth - 1]}/${viewYear}`}</span>
                  <span style={saldoAntesMes < 0 ? { color: '#dc2626' } : { color: '#64748b' }}>
                    {saldoAntesMes >= 0 ? '+' : ''}{fmtH(saldoAntesMes)}h
                  </span>
                </div>
              )}
              <div className="bh-detalhe-subtotal">
                <span>Subtotal — {MESES[viewMonth]}</span>
                <span style={totalMes < 0 ? { color: '#dc2626' } : { color: '#16a34a' }}>
                  {totalMes >= 0 ? '+' : ''}{fmtH(Math.round(totalMes * 100) / 100)}h
                </span>
              </div>
            </>
          )}
        </div>

        {ajusteBanco !== 0 && (
          <div className="bh-detalhe-ajuste-wrap">
            <div className="bh-detalhe-ajuste">
              <span>⚖️ Ajuste manual do coordenador (total geral)</span>
              <div className="bh-detalhe-ajuste-direita">
                <span style={ajusteBanco >= 0 ? { color: '#16a34a' } : { color: '#dc2626' }}>
                  {ajusteBanco > 0 ? '+' : ''}{fmtH(ajusteBanco)}h
                </span>
                {ajustesBancoLogs.length > 0 && (
                  <button
                    type="button"
                    className={`bh-ajuste-toggle${ajusteExpandido ? ' bh-ajuste-toggle--aberto' : ''}`}
                    onClick={() => setAjusteExpandido(v => !v)}
                    title={ajusteExpandido ? 'Ocultar histórico' : 'Ver histórico de ajustes'}
                  >
                    ▾
                  </button>
                )}
              </div>
            </div>
            {ajusteExpandido && ajustesBancoLogs.length > 0 && (
              <div className="bh-ajuste-historico">
                {ajustesBancoLogs
                  .map((entrada, originalIdx) => ({ entrada, originalIdx }))
                  .sort((a, b) => b.entrada.data.localeCompare(a.entrada.data))
                  .map(({ entrada, originalIdx }) => (
                    <div key={originalIdx} className="bh-ajuste-historico-item">
                      <div className="bh-ajuste-historico-esq">
                        <span className="bh-ajuste-historico-data">
                          {fmtDataLonga(entrada.data)}
                        </span>
                        {entrada.justificativa && (
                          <span className="bh-ajuste-historico-justif">
                            {entrada.justificativa}
                          </span>
                        )}
                      </div>
                      <div className="bh-ajuste-historico-dir">
                        <span
                          className="bh-ajuste-historico-val"
                          style={entrada.delta >= 0 ? { color: '#16a34a' } : { color: '#dc2626' }}
                        >
                          {entrada.delta > 0 ? '+' : ''}{fmtH(entrada.delta)}h
                        </span>
                        {onRemoverAjuste && (
                          <button
                            type="button"
                            className="bh-ajuste-lixeira"
                            title="Apagar este ajuste"
                            onClick={() => setConfirmandoRemocaoIdx(originalIdx)}
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
      {confirmandoRemocaoIdx !== null && (
        <ModalSenha
          titulo="Confirmar exclusão de ajuste"
          senhaCorreta={getSenhaAgente('Alexandre') ?? '1234'}
          onConfirmar={() => {
            onRemoverAjuste?.(confirmandoRemocaoIdx)
            setConfirmandoRemocaoIdx(null)
          }}
          onCancelar={() => setConfirmandoRemocaoIdx(null)}
        />
      )}
    </div>
  )
}

// ── Banco de Horas: painel do Moisés ─────────────────────────────
interface BancoHorasMoisesProps {
  sobreavisoSemanal: Record<string, string[]>
  horasTrabalhadasSobreaviso: Record<string, Record<string, number>>
  justificativasSobreaviso: Record<string, Record<string, string>>
  descontosFolgaBanco: Record<string, Record<string, number>>
  folgas: Record<string, string[]>
  percDomingoFeriado: number
  percSobreaviso: number
  percSabado: number
  feriadosCustom: string[]
  horasExtrasSimples: Record<string, Record<string, number>>
  justificativasExtrasSimples: Record<string, Record<string, string>>
  ajustesBanco: Record<string, number>
  ajustesBancoLogs?: Record<string, Array<{data: string, delta: number, justificativa?: string}>>
  onAjusteChange: (agente: string, delta: number, justificativa?: string) => void
  onRemoverAjuste?: (agente: string, index: number) => void
  podeEditar: boolean
  hoje?: string
  ocorrencias?: Ocorrencia[]
}

function BancoHorasMoises({ sobreavisoSemanal, horasTrabalhadasSobreaviso, justificativasSobreaviso, descontosFolgaBanco, folgas, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom, horasExtrasSimples, justificativasExtrasSimples, ajustesBanco, ajustesBancoLogs = {}, onAjusteChange, onRemoverAjuste, podeEditar, hoje: hojeprop, ocorrencias = [] }: BancoHorasMoisesProps) {
  const hoje = hojeprop ?? hojeStr()
  const [editando, setEditando] = useState<string | null>(null)
  const [valorTemp, setValorTemp] = useState<string>('')
  const [justificativaTemp, setJustificativaTemp] = useState<string>('')
  const [detalheAgente, setDetalheAgente] = useState<string | null>(null)

  // Mapa de itens de ocorrências automáticas por agente
  const ocAutoMap = useMemo(() => {
    const map: Record<string, HoraOcorrenciaItem[]> = {}
    for (const ag of AGENTES_ESCALA) {
      const { itens } = computarHorasOcorrencias(ag.nome, ocorrencias, feriadosCustom, percDomingoFeriado, percSobreaviso, percSabado)
      map[ag.nome] = itens
    }
    return map
  }, [ocorrencias, feriadosCustom, percDomingoFeriado, percSobreaviso, percSabado])

  // horasTrabalhadasSobreaviso filtrado: exclui entradas que vieram de sincronizarHorasEscala
  const htsFiltrado = useMemo(
    () => filtrarHorasManuais(horasTrabalhadasSobreaviso, justificativasSobreaviso),
    [horasTrabalhadasSobreaviso, justificativasSobreaviso],
  )

  const lista = useMemo(() => {
    const sobreaviso = AGENTES_SOBREAVISO.map(ag => {
      const calculadoBase = calcularBancoHoras(ag.nome, sobreavisoSemanal, htsFiltrado, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom, descontosFolgaBanco, folgas, hoje)
      const horasAutoOc = (ocAutoMap[ag.nome] ?? []).reduce((acc, item) => acc + item.horasComMult, 0)
      const calculado = calculadoBase + horasAutoOc
      const ajuste = ajustesBanco[ag.nome] ?? 0
      const total = calculado + ajuste
      const horasFolga = horasPorFolga(ag.nome)
      const diasFolga = total / horasFolga
      const desobreaviso = (sobreavisoSemanal[hoje] ?? []).includes(ag.nome)
      const temFolga = (folgas[hoje] ?? []).includes(ag.nome)
      return { ...ag, total, calculado, ajuste, diasFolga, horasFolga, desobreaviso, temFolga, tipo: 'sobreaviso' as const }
    })
    const extras = AGENTES_HORAS_EXTRAS.map(ag => {
      const calculadoOc = calcularBancoHoras(ag.nome, sobreavisoSemanal, htsFiltrado, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom, descontosFolgaBanco, folgas, hoje)
      const horasManuais = horasExtrasSimples[ag.nome] ?? {}
      const horasAutoOc = (ocAutoMap[ag.nome] ?? []).reduce((acc, item) => acc + item.horasComMult, 0)
      const calculado = calculadoOc + Object.values(horasManuais).reduce((acc, h) => acc + h, 0) + horasAutoOc
      const ajuste = ajustesBanco[ag.nome] ?? 0
      const total = calculado + ajuste
      const horasFolga = horasPorFolga(ag.nome)
      const diasFolga = total / horasFolga
      return { ...ag, total, calculado, ajuste, diasFolga, horasFolga, desobreaviso: false, temFolga: false, tipo: 'extras' as const }
    })
    return [...sobreaviso, ...extras].sort((a, b) => b.total - a.total)
  }, [sobreavisoSemanal, htsFiltrado, descontosFolgaBanco, folgas, percDomingoFeriado, percSobreaviso, percSabado, feriadosCustom, horasExtrasSimples, ajustesBanco, hoje, ocAutoMap])

  const totalGeral = lista.reduce((s, ag) => s + ag.total, 0)

  function abrirEdicao(ag: { nome: string; total: number }) {
    setEditando(ag.nome)
    setValorTemp('0')
    setJustificativaTemp('')
  }

  function salvarEdicao(ag: { nome: string; ajuste: number }) {
    const delta = parseFloat(valorTemp.replace(',', '.'))
    if (!Number.isFinite(delta) || delta === 0) {
      setEditando(null)
      return
    }
    onAjusteChange(ag.nome, delta, justificativaTemp.trim() || undefined)
    setEditando(null)
  }

  function zerarAjuste(ag: { nome: string; ajuste: number }) {
    if (ag.ajuste === 0) { setEditando(null); return }
    onAjusteChange(ag.nome, -ag.ajuste, 'Zeragem manual')
    setEditando(null)
  }

  return (
    <div className="bh-moises-painel">
      <div className="bh-moises-header">
        <span className="bh-moises-titulo">⏱️ Banco de Horas</span>
        <span className="bh-moises-total">{totalGeral % 1 === 0 ? totalGeral : totalGeral.toFixed(1)}h total</span>
      </div>
      <div className="bh-moises-lista">
        {lista.map((ag, idx) => (
          <div key={ag.nome} className="bh-moises-row">
            <span className="bh-moises-rank">#{idx + 1}</span>
            <span className="bh-moises-cor" style={{ background: ag.cor }} />
            <span className="bh-moises-nome">{ag.nome}</span>
            <div className="bh-moises-direita">
              {ag.desobreaviso && (
                <span className="bh-moises-badge-ativo" title="De sobreaviso agora">🟢</span>
              )}
              {ag.temFolga && (
                <span className="bh-moises-badge-folga" title="De folga hoje">🏠</span>
              )}
              <button
                type="button"
                className="bh-moises-horas-info bh-moises-horas-edit"
                onClick={() => setDetalheAgente(ag.nome)}
                title="Clique para ver o detalhamento do banco de horas"
              >
                <span className="bh-moises-h" style={ag.total < 0 ? { color: '#dc2626' } : {}}>
                  {ag.total % 1 === 0 ? ag.total : ag.total.toFixed(1)}h
                  {ag.ajuste !== 0 && (
                    <span className="bh-moises-ajuste-badge" title={`Ajuste manual: ${ag.ajuste > 0 ? '+' : ''}${ag.ajuste}h`}>
                      {ag.ajuste > 0 ? '+' : ''}{ag.ajuste % 1 === 0 ? ag.ajuste : ag.ajuste.toFixed(1)}
                    </span>
                  )}
                </span>
                <span className="bh-moises-semanas" title={`${ag.total.toFixed(2)}h ÷ ${ag.horasFolga}h = ${ag.diasFolga.toFixed(2)} dias de folga`}>
                  {ag.diasFolga % 1 === 0 ? ag.diasFolga : ag.diasFolga.toFixed(1)} dia{ag.diasFolga === 1 ? '' : 's'} de folga 🔍
                </span>
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="bh-moises-rodape">
        {HORAS_POR_DIA_SOBREAVISO}h por dia de sobreaviso · Dias úteis ×{(1 + percSobreaviso / 100).toFixed(1)} · Sábado ×{(1 + percSabado / 100).toFixed(1)} · Dom/Feriado ×{(1 + percDomingoFeriado / 100).toFixed(1)} · folga: -8h padrão · -4h G/H · -6h J
      </div>

      {editando && (() => {
        const ag = lista.find(a => a.nome === editando)
        if (!ag) return null
        const deltaNum = parseFloat(valorTemp.replace(',', '.'))
        const deltaValido = Number.isFinite(deltaNum) ? deltaNum : 0
        const totalPreview = +(ag.calculado + ag.ajuste + deltaValido).toFixed(2)
        return (
          <div className="escala-modal-overlay" onClick={() => setEditando(null)}>
            <div className="escala-modal bh-edit-modal" onClick={e => e.stopPropagation()}>
              <div className="escala-modal-header">
                <span className="escala-modal-titulo">
                  <span className="bh-edit-cor" style={{ background: ag.cor }} />
                  Ajustar banco — {ag.nome}
                </span>
                <button className="escala-modal-fechar" onClick={() => setEditando(null)}>✕</button>
              </div>

              <div className="bh-edit-info">
                <div className="bh-edit-info-linha">
                  <span>Calculado pela escala</span>
                  <strong>{ag.calculado % 1 === 0 ? ag.calculado : ag.calculado.toFixed(2)}h</strong>
                </div>
                {ag.ajuste !== 0 && (
                  <div className="bh-edit-info-linha">
                    <span>Ajustes manuais anteriores</span>
                    <strong className={ag.ajuste > 0 ? 'positivo' : 'negativo'}>
                      {ag.ajuste > 0 ? '+' : ''}{ag.ajuste % 1 === 0 ? ag.ajuste : ag.ajuste.toFixed(2)}h
                    </strong>
                  </div>
                )}
                <div className="bh-edit-info-linha bh-edit-info-linha--destaque">
                  <span>Ajuste manual atual</span>
                  <strong className={deltaValido > 0 ? 'positivo' : deltaValido < 0 ? 'negativo' : ''}>
                    {deltaValido > 0 ? '+' : ''}{deltaValido % 1 === 0 ? deltaValido : deltaValido.toFixed(2)}h
                  </strong>
                </div>
                <div className="bh-edit-info-linha bh-edit-info-linha--total">
                  <span>Total</span>
                  <strong className={totalPreview < 0 ? 'negativo' : 'positivo'}>
                    {totalPreview > 0 ? '+' : ''}{totalPreview % 1 === 0 ? totalPreview : totalPreview.toFixed(2)}h
                  </strong>
                </div>
              </div>

              <label className="bh-edit-label">
                Ajuste manual atual (horas a somar ou subtrair)
                <input
                  type="number"
                  step="0.5"
                  inputMode="decimal"
                  className="bh-edit-input"
                  value={valorTemp}
                  onChange={e => setValorTemp(e.target.value)}
                  autoFocus
                  onFocus={e => e.target.select()}
                  placeholder="ex: +4 ou -2"
                />
              </label>

              <label className="bh-edit-label bh-edit-label--justif">
                Justificativa (opcional)
                <textarea
                  className="bh-edit-justif"
                  value={justificativaTemp}
                  onChange={e => setJustificativaTemp(e.target.value)}
                  placeholder="Ex: Horas extras do plantão 10/06..."
                  rows={2}
                  maxLength={300}
                />
              </label>

              <div className="bh-edit-acoes">
                {ag.ajuste !== 0 && (
                  <button className="bh-edit-zerar" onClick={() => zerarAjuste(ag)}>
                    Zerar ajuste
                  </button>
                )}
                <div className="bh-edit-acoes-direita">
                  <button className="bh-edit-cancelar" onClick={() => setEditando(null)}>Cancelar</button>
                  <button
                    className="bh-edit-salvar"
                    onClick={() => salvarEdicao(ag)}
                    disabled={!Number.isFinite(deltaNum) || deltaNum === 0}
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {detalheAgente && (() => {
        const ag = lista.find(a => a.nome === detalheAgente)
        if (!ag) return null
        return (
          <ModalDetalhesBanco
            agente={{ nome: ag.nome, cor: ag.cor, iniciais: ag.iniciais }}
            isExtras={ag.tipo === 'extras'}
            sobreavisoSemanal={sobreavisoSemanal}
            horasTrabalhadasSobreaviso={horasTrabalhadasSobreaviso}
            justificativasSobreaviso={justificativasSobreaviso}
            horasExtrasSimples={horasExtrasSimples}
            justificativasExtrasSimples={justificativasExtrasSimples}
            folgas={folgas}
            descontosFolgaBanco={descontosFolgaBanco}
            ajusteBanco={ag.ajuste}
            ajustesBancoLogs={ajustesBancoLogs[ag.nome] ?? []}
            percDomingoFeriado={percDomingoFeriado}
            percSobreaviso={percSobreaviso}
            percSabado={percSabado}
            feriadosCustom={feriadosCustom}
            hoje={hoje}
            onFechar={() => setDetalheAgente(null)}
            onEditar={podeEditar ? () => { setDetalheAgente(null); abrirEdicao(ag) } : undefined}
            onRemoverAjuste={podeEditar && onRemoverAjuste ? (idx) => onRemoverAjuste(ag.nome, idx) : undefined}
            ocorrenciasItens={ocAutoMap[ag.nome] ?? []}
          />
        )
      })()}
    </div>
  )
}

// ── Modal seleção de agentes por dia (Sobreaviso + Folga) ────────
interface ModalDiaProps {
  data: string
  selecionados: string[]
  folgasSelecionadas: string[]
  ferias: Ferias[]
  afastamentos: Afastamento[]
  onSalvar: (agentes: string[], folgas: string[]) => void
  onFechar: () => void
}

function ModalDia({ data, selecionados, folgasSelecionadas, ferias, afastamentos, onSalvar, onFechar }: ModalDiaProps) {
  const [escolhidos, setEscolhidos] = useState<string[]>(selecionados)
  const [folgas, setFolgas] = useState<string[]>(folgasSelecionadas)
  const [, mesStr, diaStr] = data.split('-')
  const label = `${diaStr}/${mesStr} — Escala do dia`

  function toggleSobreaviso(nome: string) {
    setEscolhidos(prev => prev.includes(nome) ? prev.filter(n => n !== nome) : [...prev, nome])
    setFolgas(prev => prev.filter(n => n !== nome))
  }

  function toggleFolga(nome: string) {
    setFolgas(prev => prev.includes(nome) ? prev.filter(n => n !== nome) : [...prev, nome])
    setEscolhidos(prev => prev.filter(n => n !== nome))
  }

  function limparTudo() {
    setEscolhidos([])
    setFolgas([])
  }

  return (
    <div className="escala-modal-overlay" onClick={onFechar}>
      <div className="escala-modal" onClick={e => e.stopPropagation()}>
        <div className="escala-modal-header">
          <span className="escala-modal-titulo">{label}</span>
          <button className="escala-modal-fechar" onClick={onFechar}>✕</button>
        </div>

        <p className="escala-modal-sub">📟 Sobreaviso (gera {HORAS_POR_DIA_SOBREAVISO}h no banco quando o dia passar):</p>
        <div className="escala-modal-lista">
          {AGENTES_SOBREAVISO.map(ag => {
            const emFerias = agenteEmFerias(ag.nome, data, ferias)
            const emAfastamento = agenteAfastado(ag.nome, data, afastamentos)
            const bloqueado = emFerias || emAfastamento
            const ativo = escolhidos.includes(ag.nome)
            return (
              <button
                key={`sb-${ag.nome}`}
                className={`escala-modal-agente ${ativo ? 'selecionado' : ''} ${emFerias ? 'em-ferias' : ''} ${emAfastamento ? 'em-afastamento' : ''}`}
                style={ativo ? { background: ag.cor, borderColor: ag.cor, color: '#fff' } : { borderColor: ag.cor }}
                onClick={() => !bloqueado && toggleSobreaviso(ag.nome)}
                disabled={bloqueado}
              >
                <span className="escala-modal-iniciais" style={{ background: ativo ? 'rgba(255,255,255,0.25)' : ag.cor }}>
                  {ag.iniciais}
                </span>
                <span className="escala-modal-agente-nome">{ag.nome}</span>
                {emFerias && <span className="escala-modal-ferias-tag">🌴 Férias</span>}
                {emAfastamento && <span className="escala-modal-ferias-tag escala-modal-afastamento-tag">🏥 Afastado</span>}
                {ativo && !bloqueado && <span className="escala-modal-ferias-tag">📟 Sobreaviso</span>}
              </button>
            )
          })}
        </div>

        <p className="escala-modal-sub" style={{ marginTop: 16 }}>🏠 Folga (desconta horas do banco ao passar do dia — varia por agente: 8h padrão, 4h G/H, 6h J):</p>
        <div className="escala-modal-lista">
          {AGENTES_ESCALA.map(ag => {
            const emFerias = agenteEmFerias(ag.nome, data, ferias)
            const emAfastamento = agenteAfastado(ag.nome, data, afastamentos)
            const bloqueado = emFerias || emAfastamento
            const ativo = folgas.includes(ag.nome)
            return (
              <button
                key={`folga-${ag.nome}`}
                className={`escala-modal-agente folga-toggle ${ativo ? 'selecionado' : ''} ${emFerias ? 'em-ferias' : ''} ${emAfastamento ? 'em-afastamento' : ''}`}
                style={ativo
                  ? { background: '#16a34a', borderColor: '#16a34a', color: '#fff' }
                  : { borderColor: ag.cor }}
                onClick={() => !bloqueado && toggleFolga(ag.nome)}
                disabled={bloqueado}
              >
                <span className="escala-modal-iniciais" style={{ background: ativo ? 'rgba(255,255,255,0.25)' : ag.cor }}>
                  {ag.iniciais}
                </span>
                <span className="escala-modal-agente-nome">{ag.nome}</span>
                {emFerias && <span className="escala-modal-ferias-tag">🌴 Férias</span>}
                {emAfastamento && <span className="escala-modal-ferias-tag escala-modal-afastamento-tag">🏥 Afastado</span>}
                {ativo && !bloqueado && <span className="escala-modal-ferias-tag">🏠 Folga</span>}
              </button>
            )
          })}
        </div>

        <div className="escala-modal-acoes">
          <button className="escala-modal-limpar" onClick={limparTudo}>Limpar</button>
          <button className="escala-modal-salvar" onClick={() => onSalvar(escolhidos, folgas)}>Salvar</button>
        </div>
      </div>
    </div>
  )
}

// ── Painel de férias ──────────────────────────────────────────────
interface PainelFeriasProps {
  ferias: Ferias[]
  onChange: (novas: Ferias[]) => void
}

function PainelFerias({ ferias, onChange }: PainelFeriasProps) {
  const hoje = hojeStr()
  const [agente, setAgente] = useState(AGENTES_ESCALA[0].nome)
  const [inicio, setInicio] = useState(hoje)
  const [fim, setFim] = useState(hoje)
  const [erro, setErro] = useState('')

  function adicionar() {
    if (inicio > fim) { setErro('A data de início deve ser anterior ou igual ao fim.'); return }
    if (ferias.some(f => f.agente === agente && f.inicio === inicio && f.fim === fim)) {
      setErro('Este período já está cadastrado.'); return
    }
    setErro('')
    onChange([...ferias, { agente, inicio, fim }])
  }

  function remover(idx: number) {
    onChange(ferias.filter((_, i) => i !== idx))
  }

  return (
    <div className="escala-ferias-painel">
      <div className="escala-ferias-titulo"><span>🌴</span> Férias</div>
      <div className="escala-ferias-form">
        <select className="escala-ferias-select" value={agente} onChange={e => { setAgente(e.target.value); setErro('') }}>
          {AGENTES_ESCALA.map(ag => <option key={ag.nome} value={ag.nome}>{ag.nome}</option>)}
        </select>
        <div className="escala-ferias-datas">
          <div className="escala-ferias-data-campo">
            <label>De</label>
            <input type="date" value={inicio} onChange={e => { setInicio(e.target.value); setErro('') }} />
          </div>
          <div className="escala-ferias-data-campo">
            <label>Até</label>
            <input type="date" value={fim} onChange={e => { setFim(e.target.value); setErro('') }} />
          </div>
        </div>
        {erro && <span className="escala-ferias-erro">{erro}</span>}
        <button className="escala-ferias-add" onClick={adicionar}>+ Adicionar período</button>
      </div>

      {ferias.length > 0 ? (
        <div className="escala-ferias-lista">
          {ferias.map((f, i) => {
            const info = AGENTE_MAP[f.agente]
            return (
              <div key={i} className="escala-ferias-item">
                <span className="escala-ferias-cor" style={{ background: info?.cor ?? '#ccc' }} />
                <span className="escala-ferias-nome">{f.agente}</span>
                <span className="escala-ferias-periodo">{fmtDataLonga(f.inicio)} → {fmtDataLonga(f.fim)}</span>
                <button className="escala-ferias-remover" onClick={() => remover(i)}>✕</button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="escala-ferias-vazio">Nenhum período de férias cadastrado.</p>
      )}
    </div>
  )
}

// ── Painel de afastamentos ────────────────────────────────────────
interface PainelAfastamentosProps {
  afastamentos: Afastamento[]
  onChange: (novos: Afastamento[]) => void
}

const MOTIVOS_AFASTAMENTO = [
  'Licença médica',
  'Licença por luto',
  'Licença maternidade/paternidade',
  'Licença sem vencimento',
  'Afastamento judicial',
  'Outro',
]

function PainelAfastamentos({ afastamentos, onChange }: PainelAfastamentosProps) {
  const hoje = hojeStr()
  const [agente, setAgente] = useState(AGENTES_ESCALA[0].nome)
  const [inicio, setInicio] = useState(hoje)
  const [fim, setFim] = useState(hoje)
  const [motivo, setMotivo] = useState(MOTIVOS_AFASTAMENTO[0])
  const [erro, setErro] = useState('')

  function adicionar() {
    if (inicio > fim) { setErro('A data de início deve ser anterior ou igual ao fim.'); return }
    if (afastamentos.some(a => a.agente === agente && a.inicio === inicio && a.fim === fim)) {
      setErro('Este período já está cadastrado.'); return
    }
    setErro('')
    onChange([...afastamentos, { agente, inicio, fim, motivo }])
  }

  function remover(idx: number) {
    onChange(afastamentos.filter((_, i) => i !== idx))
  }

  return (
    <div className="escala-ferias-painel escala-afastamento-painel">
      <div className="escala-ferias-titulo"><span>🏥</span> Afastamentos</div>
      <div className="escala-ferias-form">
        <select className="escala-ferias-select" value={agente} onChange={e => { setAgente(e.target.value); setErro('') }}>
          {AGENTES_ESCALA.map(ag => <option key={ag.nome} value={ag.nome}>{ag.nome}</option>)}
        </select>
        <select className="escala-ferias-select" value={motivo} onChange={e => { setMotivo(e.target.value); setErro('') }}>
          {MOTIVOS_AFASTAMENTO.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="escala-ferias-datas">
          <div className="escala-ferias-data-campo">
            <label>De</label>
            <input type="date" value={inicio} onChange={e => { setInicio(e.target.value); setErro('') }} />
          </div>
          <div className="escala-ferias-data-campo">
            <label>Até</label>
            <input type="date" value={fim} onChange={e => { setFim(e.target.value); setErro('') }} />
          </div>
        </div>
        {erro && <span className="escala-ferias-erro">{erro}</span>}
        <button className="escala-ferias-add escala-afastamento-add" onClick={adicionar}>+ Adicionar afastamento</button>
      </div>

      {afastamentos.length > 0 ? (
        <div className="escala-ferias-lista">
          {afastamentos.map((a, i) => {
            const info = AGENTE_MAP[a.agente]
            return (
              <div key={i} className="escala-ferias-item">
                <span className="escala-ferias-cor" style={{ background: info?.cor ?? '#ccc' }} />
                <span className="escala-ferias-nome">{a.agente}</span>
                <span className="escala-afastamento-motivo">🏥 {a.motivo}</span>
                <span className="escala-ferias-periodo">{fmtDataLonga(a.inicio)} → {fmtDataLonga(a.fim)}</span>
                <button className="escala-ferias-remover" onClick={() => remover(i)}>✕</button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="escala-ferias-vazio">Nenhum afastamento cadastrado.</p>
      )}
    </div>
  )
}

// ── Calendário Unificado (Sobreaviso + Folga em um só) ────────────
interface CalendarioUnificadoProps {
  ano: number
  mes: number
  sobreavisoDiario: Record<string, string[]>
  folgas: Record<string, string[]>
  ferias: Ferias[]
  hoje: string
  editando: boolean
  feriadosCustom: string[]
  onDiaClick: (chave: string) => void
}

function CalendarioUnificado({ ano, mes, sobreavisoDiario, folgas, ferias, hoje, editando, feriadosCustom, onDiaClick }: CalendarioUnificadoProps) {
  const total = diasNoMes(ano, mes)
  const inicio = primeiroDiaSemana(ano, mes)
  const trailingCount = (7 - ((inicio + total) % 7)) % 7

  return (
    <div className="escala-calendario-bloco escala-bloco-unificado">
      <div className="escala-cal-grid">
        {DIAS_SEMANA_HDR.map((d, i) => (
          <div key={i} className="escala-cal-diahdr">{d}</div>
        ))}

        {Array.from({ length: inicio }).map((_, i) => (
          <div key={`lead-${i}`} className="escala-cal-vazio uni-vazio" />
        ))}

        {Array.from({ length: total }, (_, i) => i + 1).map(dia => {
          const chave = chaveData(ano, mes, dia)
          const isHoje = chave === hoje
          const isFerCustom = feriadosCustom.includes(chave)
          const isFeriadoFixo = (() => {
            const [y, m, d] = chave.split('-').map(Number)
            const mmdd = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const dt = new Date(y, m - 1, d)
            return dt.getDay() === 0 || FERIADOS_FIXOS.has(mmdd)
          })()
          const sobreavisoDoDia = sobreavisoDiario[chave] ?? []
          const folgasDoDia = (folgas[chave] ?? []).filter(nome => !agenteEmFerias(nome, chave, ferias))

          return (
            <button
              key={chave}
              className={`escala-cal-dia uni-dia ${isHoje ? 'hoje' : ''} ${editando ? 'editavel' : ''} ${isFerCustom ? 'feriado-custom' : ''} ${isFeriadoFixo && !isFerCustom ? 'feriado-fixo' : ''}`}
              onClick={() => editando && onDiaClick(chave)}
            >
              <span className="escala-cal-num">{dia}</span>
              {isFerCustom && <span className="escala-cal-fer-tag">📅</span>}
              {isFeriadoFixo && !isFerCustom && <span className="escala-cal-fer-tag">🏛️</span>}

              {sobreavisoDoDia.length > 0 && (
                <div className="uni-secao uni-sobreaviso" title={`Sobreaviso: ${sobreavisoDoDia.join(', ')}`}>
                  <span className="uni-secao-label">Sobreaviso</span>
                  {sobreavisoDoDia.map(nome => {
                    const info = AGENTE_MAP[nome]
                    return (
                      <span
                        key={nome}
                        className="uni-secao-nome"
                        style={{ color: info?.cor ?? '#7c3aed' }}
                      >
                        {nome}
                      </span>
                    )
                  })}
                </div>
              )}

              {folgasDoDia.length > 0 && (
                <div className="uni-secao uni-folga" title={`Folga: ${folgasDoDia.join(', ')}`}>
                  <span className="uni-secao-label">Folga</span>
                  {folgasDoDia.map(nome => {
                    const info = AGENTE_MAP[nome]
                    return (
                      <span
                        key={nome}
                        className="uni-secao-nome"
                        style={{ color: info?.cor ?? '#166534' }}
                      >
                        {nome}
                      </span>
                    )
                  })}
                </div>
              )}
            </button>
          )
        })}

        {Array.from({ length: trailingCount }).map((_, i) => (
          <div key={`tail-${i}`} className="escala-cal-vazio uni-vazio" />
        ))}
      </div>
    </div>
  )
}

// ── Legenda ───────────────────────────────────────────────────────
interface LegendaProps {
  ferias: Ferias[]
  afastamentos: Afastamento[]
  mes: number
  ano: number
  editavel?: boolean
  onAgenteClick?: (nome: string) => void
}

function Legenda({ ferias, afastamentos, mes, ano, editavel = false, onAgenteClick }: LegendaProps) {
  const mesStr = String(mes + 1).padStart(2, '0')
  const anoStr = String(ano)

  const { ativos, deFerias, deAfastamento } = useMemo(() => {
    const deFerias: Array<{ ag: typeof AGENTES_ESCALA[0]; periodos: Ferias[] }> = []
    const deAfastamento: Array<{ ag: typeof AGENTES_ESCALA[0]; periodos: Afastamento[] }> = []
    const idsDeFerias = new Set<string>()
    const idsDeAfastamento = new Set<string>()
    AGENTES_ESCALA.forEach(ag => {
      const periodos = ferias.filter(f =>
        f.agente === ag.nome &&
        f.inicio <= `${anoStr}-${mesStr}-31` &&
        f.fim >= `${anoStr}-${mesStr}-01`
      )
      if (periodos.length > 0) { deFerias.push({ ag, periodos }); idsDeFerias.add(ag.nome) }
      const afsts = afastamentos.filter(a =>
        a.agente === ag.nome &&
        a.inicio <= `${anoStr}-${mesStr}-31` &&
        a.fim >= `${anoStr}-${mesStr}-01`
      )
      if (afsts.length > 0) { deAfastamento.push({ ag, periodos: afsts }); idsDeAfastamento.add(ag.nome) }
    })
    const ativos = AGENTES_ESCALA.filter(ag => !idsDeFerias.has(ag.nome) && !idsDeAfastamento.has(ag.nome))
    return { ativos, deFerias, deAfastamento }
  }, [ferias, afastamentos, mes, ano, mesStr, anoStr])

  return (
    <div className="escala-legenda">
      <span className="escala-legenda-titulo">
        Legenda
        {editavel && <span className="escala-legenda-dica"> — toque num agente para escalar os dias dele</span>}
      </span>
      <p className="escala-legenda-regra">
        Jornada normal · ocorrências fora deste horário entram automaticamente no banco de horas.
      </p>
      <div className="escala-legenda-lista">
        {ativos.map(ag =>
          editavel ? (
            <button
              type="button"
              key={ag.nome}
              className="escala-legenda-item escala-legenda-item--clicavel"
              onClick={() => onAgenteClick?.(ag.nome)}
              title={`Escalar dias de ${ag.nome}`}
            >
              <span className="escala-legenda-cor" style={{ background: ag.cor }} />
              <span className="escala-legenda-nome">{ag.nome}</span>
              <span className="escala-legenda-horario">
                {obterJornadaAgente(ag.nome).inicio}–{obterJornadaAgente(ag.nome).fim}
              </span>
              <span className="escala-legenda-edit-icone">✏️</span>
            </button>
          ) : (
            <div key={ag.nome} className="escala-legenda-item">
              <span className="escala-legenda-cor" style={{ background: ag.cor }} />
              <span className="escala-legenda-nome">{ag.nome}</span>
              <span className="escala-legenda-horario">
                {obterJornadaAgente(ag.nome).inicio}–{obterJornadaAgente(ag.nome).fim}
              </span>
            </div>
          )
        )}
      </div>
      {deFerias.length > 0 && (
        <div className="escala-legenda-ferias-bloco">
          <span className="escala-legenda-ferias-titulo">☀️🌊 De férias este mês</span>
          {deFerias.map(({ ag, periodos }) => (
            <div key={ag.nome} className="escala-legenda-ferias-row">
              <span className="escala-legenda-cor" style={{ background: ag.cor }} />
              <span className="escala-legenda-ferias-nome">{ag.nome}</span>
              <div className="escala-legenda-ferias-periodos">
                {periodos.map((p, i) => (
                  <span key={i} className="escala-legenda-ferias-periodo">
                    {fmtDataCurta(p.inicio)} → {fmtDataCurta(p.fim)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {deAfastamento.length > 0 && (
        <div className="escala-legenda-ferias-bloco escala-legenda-afastamento-bloco">
          <span className="escala-legenda-ferias-titulo">🏥 Afastado este mês</span>
          {deAfastamento.map(({ ag, periodos }) => (
            <div key={ag.nome} className="escala-legenda-ferias-row">
              <span className="escala-legenda-cor" style={{ background: ag.cor }} />
              <span className="escala-legenda-ferias-nome">{ag.nome}</span>
              <div className="escala-legenda-ferias-periodos">
                {periodos.map((a, i) => (
                  <span key={i} className="escala-legenda-ferias-periodo escala-legenda-afastamento-periodo">
                    {a.motivo} · {fmtDataCurta(a.inicio)} → {fmtDataCurta(a.fim)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Painel de Regras do Banco de Horas (Moisés) ───────────────────
interface PainelRegrasProps {
  percDomingoFeriado: number
  percSobreaviso: number
  percSabado: number
  onChange: (percDomFer: number, percSb: number, percSabado: number) => void
}

function PainelRegras({ percDomingoFeriado, percSobreaviso, percSabado, onChange }: PainelRegrasProps) {
  const [domFer, setDomFer] = useState(percDomingoFeriado)
  const [sb, setSb] = useState(percSobreaviso)
  const [sab, setSab] = useState(percSabado)
  const [salvo, setSalvo] = useState(false)

  function aplicar() {
    onChange(Math.max(0, domFer), Math.max(0, sb), Math.max(0, sab))
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2000)
  }

  return (
    <div className="escala-regras-painel">
      <div className="escala-regras-titulo">⚙️ Regras do Banco de Horas</div>

      <div className="escala-regras-item">
        <div className="escala-regras-label">
          <span className="escala-regras-icone">☀️</span>
          <span>Domingos e Feriados</span>
        </div>
        <div className="escala-regras-input-wrap">
          <input
            type="number" min={0} max={500} step={5}
            value={domFer}
            onChange={e => setDomFer(Number(e.target.value))}
          />
          <span className="escala-regras-pct">%</span>
        </div>
        <span className="escala-regras-ex">
          Multiplicador: ×{(1 + domFer / 100).toFixed(2)} — a cada hora acionada vale {(1 + domFer / 100).toFixed(2)}h no banco
        </span>
      </div>

      <div className="escala-regras-item">
        <div className="escala-regras-label">
          <span className="escala-regras-icone">📟</span>
          <span>Sobreaviso (dias úteis)</span>
        </div>
        <div className="escala-regras-input-wrap">
          <input
            type="number" min={0} max={500} step={5}
            value={sb}
            onChange={e => setSb(Number(e.target.value))}
          />
          <span className="escala-regras-pct">%</span>
        </div>
        <span className="escala-regras-ex">
          Multiplicador: ×{(1 + sb / 100).toFixed(2)} — a cada hora acionada vale {(1 + sb / 100).toFixed(2)}h no banco
        </span>
      </div>

      <div className="escala-regras-item">
        <div className="escala-regras-label">
          <span className="escala-regras-icone">🗓️</span>
          <span>Sábado</span>
        </div>
        <div className="escala-regras-input-wrap">
          <input
            type="number" min={0} max={500} step={5}
            value={sab}
            onChange={e => setSab(Number(e.target.value))}
          />
          <span className="escala-regras-pct">%</span>
        </div>
        <span className="escala-regras-ex">
          Multiplicador: ×{(1 + sab / 100).toFixed(2)} — a cada hora acionada no sábado vale {(1 + sab / 100).toFixed(2)}h no banco
        </span>
      </div>

      <button
        className={`escala-regras-salvar ${salvo ? 'salvo' : ''}`}
        onClick={aplicar}
      >
        {salvo ? '✅ Regras salvas!' : 'Salvar regras'}
      </button>
    </div>
  )
}

// ── Painel de Feriados Municipais / Locais (Moisés) ───────────────
interface PainelFeriadosCustomProps {
  feriados: string[]
  onChange: (novas: string[]) => void
}

function PainelFeriadosCustom({ feriados, onChange }: PainelFeriadosCustomProps) {
  const [novoFeriado, setNovoFeriado] = useState(hojeStr())
  const [erro, setErro] = useState('')

  function adicionar() {
    if (!novoFeriado) { setErro('Selecione uma data.'); return }
    if (feriados.includes(novoFeriado)) { setErro('Esta data já está marcada.'); return }
    setErro('')
    onChange([...feriados, novoFeriado].sort())
  }

  function remover(data: string) {
    onChange(feriados.filter(d => d !== data))
  }

  return (
    <div className="escala-fer-custom-painel">
      <div className="escala-fer-custom-titulo">📅 Feriados Municipais / Locais</div>
      <p className="escala-fer-custom-desc">
        Marque datas específicas como feriado para que o multiplicador ☀️ Domingos/Feriados seja aplicado no banco de horas.
      </p>
      <div className="escala-fer-custom-form">
        <input
          type="date"
          value={novoFeriado}
          onChange={e => { setNovoFeriado(e.target.value); setErro('') }}
          className="escala-fer-custom-input"
        />
        <button className="escala-fer-custom-add" onClick={adicionar}>+ Marcar feriado</button>
      </div>
      {erro && <span className="escala-fer-custom-erro">{erro}</span>}

      {feriados.length > 0 ? (
        <div className="escala-fer-custom-lista">
          {feriados.map(data => (
            <div key={data} className="escala-fer-custom-item">
              <span className="escala-fer-custom-data">🗓️ {fmtDataLonga(data)}</span>
              <button className="escala-fer-custom-remover" onClick={() => remover(data)}>✕</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="escala-fer-custom-vazio">Nenhum feriado local marcado.</p>
      )}
    </div>
  )
}

// ── Modal: calendário de um único agente (clique na legenda) ──────
// Permite ao Moisés marcar, dentro de um mês, todos os dias em que o agente
// estará de sobreaviso ou de folga.
//   • Para agentes que fazem sobreaviso: cada toque no dia cicla
//       nada → 📟 sobreaviso → 🏠 folga → nada
//   • Para agentes sem sobreaviso (Sócrates): toggle só de folga.
interface ModalAgenteCalendarioProps {
  agente: { nome: string; cor: string; iniciais: string }
  podeSobreaviso: boolean
  sobreaviso: Record<string, string[]>
  folgas: Record<string, string[]>
  ferias: Ferias[]
  afastamentos: Afastamento[]
  feriadosCustom: string[]
  anoInicial: number
  mesInicial: number
  onSalvar: (
    novoSobreaviso: Record<string, string[]>,
    novasFolgas: Record<string, string[]>
  ) => void
  onFechar: () => void
}

function ModalAgenteCalendario({
  agente, podeSobreaviso, sobreaviso, folgas, ferias, afastamentos, feriadosCustom,
  anoInicial, mesInicial, onSalvar, onFechar,
}: ModalAgenteCalendarioProps) {
  const [mes, setMes] = useState(mesInicial)
  const [ano, setAno] = useState(anoInicial)
  const hoje = hojeStr()

  // Sets locais com TODAS as datas (qualquer mês) onde este agente já tem marcação
  const [localSb, setLocalSb] = useState<Set<string>>(() => {
    const s = new Set<string>()
    for (const [data, ags] of Object.entries(sobreaviso)) {
      if (ags.includes(agente.nome)) s.add(data)
    }
    return s
  })
  const [localFolga, setLocalFolga] = useState<Set<string>>(() => {
    const s = new Set<string>()
    for (const [data, ags] of Object.entries(folgas)) {
      if (ags.includes(agente.nome)) s.add(data)
    }
    return s
  })

  function mesAnt() {
    if (mes === 0) { setAno(a => a - 1); setMes(11) }
    else setMes(m => m - 1)
  }
  function mesProx() {
    if (mes === 11) { setAno(a => a + 1); setMes(0) }
    else setMes(m => m + 1)
  }

  function clickDia(chave: string) {
    if (agenteEmFerias(agente.nome, chave, ferias)) return
    if (agenteAfastado(agente.nome, chave, afastamentos)) return
    const ehSb = localSb.has(chave)
    const ehFolga = localFolga.has(chave)
    if (podeSobreaviso) {
      if (!ehSb && !ehFolga) {
        const next = new Set(localSb); next.add(chave); setLocalSb(next)
      } else if (ehSb) {
        const a = new Set(localSb); a.delete(chave); setLocalSb(a)
        const b = new Set(localFolga); b.add(chave); setLocalFolga(b)
      } else {
        const b = new Set(localFolga); b.delete(chave); setLocalFolga(b)
      }
    } else {
      const b = new Set(localFolga)
      if (ehFolga) b.delete(chave); else b.add(chave)
      setLocalFolga(b)
    }
  }

  function limparMes() {
    const total = diasNoMes(ano, mes)
    const nSb = new Set(localSb)
    const nFolga = new Set(localFolga)
    for (let d = 1; d <= total; d++) {
      const k = chaveData(ano, mes, d)
      nSb.delete(k); nFolga.delete(k)
    }
    setLocalSb(nSb); setLocalFolga(nFolga)
  }

  function salvar() {
    // Reconstrói os mapas globais: tira o agente de todas as datas e re-adiciona
    // nas datas locais. Outros agentes em cada data ficam intactos.
    const novoSb: Record<string, string[]> = {}
    for (const [data, ags] of Object.entries(sobreaviso)) {
      const sem = ags.filter(a => a !== agente.nome)
      if (sem.length > 0) novoSb[data] = sem
    }
    for (const data of localSb) {
      novoSb[data] = [...(novoSb[data] ?? []), agente.nome]
    }
    const novasFolgas: Record<string, string[]> = {}
    for (const [data, ags] of Object.entries(folgas)) {
      const sem = ags.filter(a => a !== agente.nome)
      if (sem.length > 0) novasFolgas[data] = sem
    }
    for (const data of localFolga) {
      novasFolgas[data] = [...(novasFolgas[data] ?? []), agente.nome]
    }
    onSalvar(novoSb, novasFolgas)
  }

  const total = diasNoMes(ano, mes)
  const inicio = primeiroDiaSemana(ano, mes)
  const trailingCount = (7 - ((inicio + total) % 7)) % 7

  // Conta marcações só do mês visível (resumo do topo)
  let sbMes = 0
  let folgaMes = 0
  for (let d = 1; d <= total; d++) {
    const k = chaveData(ano, mes, d)
    if (localSb.has(k)) sbMes++
    if (localFolga.has(k)) folgaMes++
  }

  return (
    <div className="escala-modal-overlay" onClick={onFechar}>
      <div className="escala-modal modal-agente-calendario" onClick={e => e.stopPropagation()}>
        <div className="escala-modal-header">
          <span className="escala-modal-titulo">
            <span className="bh-edit-cor" style={{ background: agente.cor }} />
            Escalar {agente.nome}
          </span>
          <button className="escala-modal-fechar" onClick={onFechar}>✕</button>
        </div>

        <p className="escala-modal-sub mac-instrucoes">
          {podeSobreaviso
            ? <>Toque num dia para alternar: <b>nada → 📟 Sobreaviso → 🏠 Folga → nada</b>.</>
            : <>Toque num dia para marcar/desmarcar 🏠 <b>Folga</b>.</>}
        </p>

        <div className="mac-nav-mes">
          <button className="mac-nav-btn" onClick={mesAnt}>‹</button>
          <span className="mac-nav-label">{MESES[mes]} {ano}</span>
          <button className="mac-nav-btn" onClick={mesProx}>›</button>
        </div>

        <div className="mac-resumo">
          {podeSobreaviso && (
            <span className="mac-chip mac-chip-sb">📟 {sbMes} dia{sbMes === 1 ? '' : 's'} de sobreaviso no mês</span>
          )}
          <span className="mac-chip mac-chip-folga">🏠 {folgaMes} dia{folgaMes === 1 ? '' : 's'} de folga no mês</span>
        </div>

        <div className="mac-cal-grid">
          {DIAS_SEMANA_HDR.map((d, i) => (
            <div key={`h-${i}`} className="escala-cal-diahdr">{d}</div>
          ))}
          {Array.from({ length: inicio }).map((_, i) => (
            <div key={`l-${i}`} className="escala-cal-vazio" />
          ))}
          {Array.from({ length: total }, (_, i) => i + 1).map(dia => {
            const chave = chaveData(ano, mes, dia)
            const isSb = localSb.has(chave)
            const isFolga = localFolga.has(chave)
            const isFerias = agenteEmFerias(agente.nome, chave, ferias)
            const isHoje = chave === hoje
            const isFerCustom = feriadosCustom.includes(chave)
            const [y, m, dd] = chave.split('-').map(Number)
            const mmdd = `${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
            const isFerFixo = new Date(y, m - 1, dd).getDay() === 0 || FERIADOS_FIXOS.has(mmdd)
            const cls = ['mac-dia']
            if (isHoje) cls.push('hoje')
            if (isSb) cls.push('mac-sb')
            if (isFolga) cls.push('mac-folga')
            if (isFerias) cls.push('mac-ferias')
            if (isFerCustom) cls.push('feriado-custom')
            if (isFerFixo && !isFerCustom) cls.push('feriado-fixo')
            return (
              <button
                key={chave}
                type="button"
                className={cls.join(' ')}
                style={isSb ? { background: agente.cor, borderColor: agente.cor, color: '#fff' } : undefined}
                onClick={() => clickDia(chave)}
                disabled={isFerias}
                title={
                  isFerias ? 'Em férias' :
                  isSb ? 'Sobreaviso — toque para mudar para folga' :
                  isFolga ? 'Folga — toque para limpar' :
                  podeSobreaviso ? 'Toque para marcar como sobreaviso' : 'Toque para marcar como folga'
                }
              >
                <span className="mac-dia-num">{dia}</span>
                <span className="mac-dia-tag">
                  {isFerias ? '🌴' : isSb ? '📟' : isFolga ? '🏠' : ''}
                </span>
              </button>
            )
          })}
          {Array.from({ length: trailingCount }).map((_, i) => (
            <div key={`t-${i}`} className="escala-cal-vazio" />
          ))}
        </div>

        <div className="escala-modal-acoes">
          <button className="escala-modal-limpar" onClick={limparMes}>
            Limpar este mês
          </button>
          <div className="bh-edit-acoes-direita">
            <button className="bh-edit-cancelar" onClick={onFechar}>Cancelar</button>
            <button className="escala-modal-salvar" onClick={salvar}>Salvar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Exportação Excel da escala mensal ─────────────────────────────
async function exportarEscalaMensalExcel(dados: EscalaData, ano: number, mes: number, ocorrencias: Ocorrencia[] = []) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CODAP - Conselheiro Lafaiete'
  wb.created = new Date()

  const nomeMes = MESES[mes]
  const diasNoMes = new Date(ano, mes + 1, 0).getDate()
  const hoje = hojeStr()

  // ── helpers de formatação de data ──────────────────────────────
  function fmtD(iso: string) {
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }

  // ── Aba 1: Calendário do mês ────────────────────────────────────
  const wsCal = wb.addWorksheet(`Escala ${nomeMes}`, {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  })

  wsCal.mergeCells('A1:E1')
  const tit = wsCal.getCell('A1')
  tit.value = `Escala — ${nomeMes} de ${ano} — CODAP — Conselheiro Lafaiete`
  tit.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  tit.alignment = { vertical: 'middle', horizontal: 'center' }
  tit.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } }
  wsCal.getRow(1).height = 28

  const headerRow = wsCal.addRow(['Data', 'Dia', 'Tipo', 'Sobreaviso (📟)', 'Folga (🏠)'])
  headerRow.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A4B8C' } }
    c.alignment = { vertical: 'middle', horizontal: 'center' }
    c.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } }
  })
  headerRow.height = 22

  for (let d = 1; d <= diasNoMes; d++) {
    const chave = chaveData(ano, mes, d)
    const dt = new Date(ano, mes, d)
    const dow = dt.getDay()
    const nomeDia = DIAS_SEMANA_NOMES[dow]
    let tipo = 'Útil'
    if (ehFeriadoOuDomingo(chave, dados.feriadosCustom)) tipo = dow === 0 ? 'Domingo' : 'Feriado'
    else if (ehSabadoComum(chave, dados.feriadosCustom)) tipo = 'Sábado'

    const sobre = (dados.sobreaviso[chave] ?? []).join(', ')
    const folga = (dados.folgas[chave] ?? []).join(', ')

    const r = wsCal.addRow([
      `${String(d).padStart(2, '0')}/${String(mes + 1).padStart(2, '0')}/${ano}`,
      nomeDia,
      tipo,
      sobre || '—',
      folga || '—',
    ])
    let bg: string | null = null
    if (tipo === 'Domingo' || tipo === 'Feriado') bg = 'FFFFE4E6'
    else if (tipo === 'Sábado') bg = 'FFFFF7E0'
    r.eachCell((c, colNumber) => {
      const centro = colNumber <= 3
      c.alignment = { vertical: 'middle', horizontal: centro ? 'center' : 'left', wrapText: true }
      c.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } }
      if (bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
    })
  }

  wsCal.getColumn(1).width = 14
  wsCal.getColumn(2).width = 8
  wsCal.getColumn(3).width = 12
  wsCal.getColumn(4).width = 38
  wsCal.getColumn(5).width = 38

  // ── Aba 2: Banco de Horas — detalhado por agente ───────────────
  const wsBH = wb.addWorksheet('Banco de Horas')

  // Título da aba
  wsBH.mergeCells('A1:G1')
  const tbh = wsBH.getCell('A1')
  tbh.value = `Banco de Horas — ${nomeMes} de ${ano} — CODAP — Conselheiro Lafaiete`
  tbh.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  tbh.alignment = { vertical: 'middle', horizontal: 'center' }
  tbh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } }
  wsBH.getRow(1).height = 26

  // Cabeçalho das colunas
  const colHead = wsBH.addRow(['Agente', 'Categoria', 'Data', 'Detalhe', 'Horas brutas', 'Multiplicador', 'Horas calculadas'])
  colHead.eachCell(c => {
    c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A4B8C' } }
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    c.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } }
  })
  colHead.height = 20

  // cores de fundo para linhas de detalhe por categoria
  const CAT_BG: Record<string, string> = {
    'Sobreaviso (base)':      'FFEEF2FF',
    'Acionamento — dia útil': 'FFEEF2FF',
    'Acionamento — sábado':   'FFFFF7E0',
    'Acionamento — dom/feriado': 'FFFFE4E6',
    'Ocorrência automática':  'FFEDFCEF',
    'Hora extra manual':      'FFEEF2FF',
    'Folga descontada':       'FFFFF0F0',
    'Ajuste coordenador':     'FFFFF8E1',
  }

  function addDetalhe(
    ws: typeof wsBH,
    agente: string,
    categoria: string,
    data: string,
    detalhe: string,
    horasBrutas: number | string,
    multiplicador: number | string,
    horasCalc: number,
  ) {
    const bg = CAT_BG[categoria] ?? 'FFFFFFFF'
    const r = ws.addRow([agente, categoria, data, detalhe, horasBrutas, multiplicador, Number(horasCalc.toFixed(2))])
    r.eachCell((c, col) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      c.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } }
      c.alignment = {
        vertical: 'middle',
        horizontal: col === 1 || col === 2 || col === 4 ? 'left' : 'center',
        wrapText: true,
      }
      c.font = { size: 9 }
    })
    r.height = 16
  }

  function addAgentHeader(ws: typeof wsBH, nome: string, total: number, diasFolga: number) {
    ws.mergeCells(`A${ws.rowCount + 1}:G${ws.rowCount + 1}`)
    const r = ws.lastRow!
    r.getCell(1).value = `${nome}   —   Total: ${total.toFixed(2)}h   |   Equivale a ${diasFolga.toFixed(1)} folga(s)`
    r.getCell(1).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
    r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
    r.height = 20
  }

  function addSubtotal(ws: typeof wsBH, total: number) {
    const r = ws.addRow(['', 'SUBTOTAL DO AGENTE', '', '', '', '', Number(total.toFixed(2))])
    r.eachCell(c => {
      c.font = { bold: true, size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }
      c.alignment = { vertical: 'middle', horizontal: 'center' }
      c.border = { top: { style: 'thin', color: { argb: 'FF6EE7B7' } }, bottom: { style: 'thin', color: { argb: 'FF6EE7B7' } } }
    })
    r.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' }
    r.height = 18
    // linha vazia separadora
    ws.addRow([])
  }

  let totalGeralBH = 0

  for (const ag of AGENTES_ESCALA) {
    const ehExtra = AGENTES_SEM_SOBREAVISO.has(ag.nome)
    const horasAg = dados.horasTrabalhadasSobreaviso[ag.nome] ?? {}
    const folgasAg = folgasDoAgente(ag.nome, dados.folgas)
    const ajuste = dados.ajustesBanco?.[ag.nome] ?? 0
    const hFolga = horasPorFolga(ag.nome)

    // Ocorrências automáticas do agente
    const { itens: itensOc } = computarHorasOcorrencias(
      ag.nome, ocorrencias, dados.feriadosCustom,
      dados.percDomingoFeriado, ehExtra ? 0 : dados.percSobreaviso, dados.percSabado,
    )

    let totalAg = 0
    const linhasAg: Parameters<typeof addDetalhe>[] = []

    if (!ehExtra) {
      // ── Agentes com sobreaviso ──────────────────────────────────
      const semanasAg = Object.entries(dados.sobreavisoSemanal ?? {})
        .filter(([, lista]) => lista.includes(ag.nome))
        .map(([seg]) => seg)
        .filter(d => d < hoje)
        .sort()

      // Turnos base
      for (const seg of semanasAg) {
        linhasAg.push([wsBH, '', 'Sobreaviso (base)', fmtD(seg), 'Turno de sobreaviso', HORAS_POR_DIA_SOBREAVISO, '×1.0', HORAS_POR_DIA_SOBREAVISO])
        totalAg += HORAS_POR_DIA_SOBREAVISO
      }

      // Acionamentos manuais
      for (const [data, h] of Object.entries(horasAg).sort(([a], [b]) => a.localeCompare(b))) {
        if (!h) continue
        const isFerOuDom = ehFeriadoOuDomingo(data, dados.feriadosCustom)
        const isSabado = ehSabadoComum(data, dados.feriadosCustom)
        const mult = multiplicadorDia(data, dados.percDomingoFeriado, dados.percSobreaviso, dados.percSabado, dados.feriadosCustom)
        const hCalc = h * mult
        let cat: string
        if (isFerOuDom) cat = 'Acionamento — dom/feriado'
        else if (isSabado) cat = 'Acionamento — sábado'
        else cat = 'Acionamento — dia útil'
        linhasAg.push([wsBH, '', cat, fmtD(data), 'Acionamento em ocorrência', h, `×${mult.toFixed(1)}`, hCalc])
        totalAg += hCalc
      }
    } else {
      // ── Agentes sem sobreaviso (horas extras manuais) ──────────
      const horasManuais = dados.horasExtrasSimples?.[ag.nome] ?? {}
      for (const [data, h] of Object.entries(horasManuais).sort(([a], [b]) => a.localeCompare(b))) {
        if (!h) continue
        linhasAg.push([wsBH, '', 'Hora extra manual', fmtD(data), '', h, '×1.0', h])
        totalAg += h
      }
    }

    // Ocorrências automáticas
    for (const item of itensOc.sort((a, b) => a.data.localeCompare(b.data))) {
      const motivoTag = 'Hora extra'
      const detalhe = [item.natureza, item.endereco].filter(Boolean).join(' — ')
      linhasAg.push([wsBH, '', 'Ocorrência automática', fmtD(item.data), detalhe, item.horasBruto, `×${item.multiplicador.toFixed(1)} (${motivoTag})`, item.horasComMult])
      totalAg += item.horasComMult
    }

    // Folgas descontadas
    for (const data of folgasAg.sort()) {
      linhasAg.push([wsBH, '', 'Folga descontada', fmtD(data), `${hFolga}h descontadas`, '', '', -hFolga])
      totalAg -= hFolga
    }
    // Descontos legado
    const descLeg = dados.descontosFolgaBanco[ag.nome] ?? {}
    for (const [data, h] of Object.entries(descLeg).sort(([a], [b]) => a.localeCompare(b))) {
      if (!h) continue
      linhasAg.push([wsBH, '', 'Folga descontada', fmtD(data), `${h}h descontadas`, '', '', -h])
      totalAg -= h
    }

    // Ajuste
    if (ajuste !== 0) {
      linhasAg.push([wsBH, '', 'Ajuste coordenador', '—', ajuste > 0 ? 'Acréscimo' : 'Decréscimo', '', '', ajuste])
      totalAg += ajuste
    }

    const diasFolga = Math.max(0, totalAg) / hFolga
    totalGeralBH += totalAg

    // Escrever no worksheet
    addAgentHeader(wsBH, ag.nome, totalAg, diasFolga)
    for (const args of linhasAg) {
      addDetalhe(...args)
    }
    if (linhasAg.length === 0) {
      const r = wsBH.addRow(['', 'Sem registros neste período', '', '', '', '', ''])
      r.getCell(2).font = { italic: true, color: { argb: 'FF9CA3AF' }, size: 9 }
      r.height = 14
    }
    addSubtotal(wsBH, totalAg)
  }

  // Linha de total geral
  const totRow = wsBH.addRow(['TOTAL GERAL', '', '', '', '', '', Number(totalGeralBH.toFixed(2))])
  totRow.eachCell(c => {
    c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } }
    c.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  totRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
  totRow.height = 22

  // Larguras das colunas
  wsBH.getColumn(1).width = 18  // Agente
  wsBH.getColumn(2).width = 24  // Categoria
  wsBH.getColumn(3).width = 14  // Data
  wsBH.getColumn(4).width = 36  // Detalhe
  wsBH.getColumn(5).width = 14  // Horas brutas
  wsBH.getColumn(6).width = 20  // Multiplicador
  wsBH.getColumn(7).width = 18  // Horas calculadas

  // ── Download ────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `escala_${String(mes + 1).padStart(2, '0')}-${ano}_codap_conselheiro_lafaiete.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Componente principal ──────────────────────────────────────────
interface EscalaAgentesProps {
  ocorrencias?: Ocorrencia[]
}

export default function EscalaAgentes({ ocorrencias = [] }: EscalaAgentesProps) {
  const agora = new Date()
  const [ano, setAno] = useState(agora.getFullYear())
  const [mes, setMes] = useState(agora.getMonth())
  const [dados, setDados] = useState<EscalaData>(carregarDados)
  const [editando, setEditando] = useState(false)
  const [pedirSenha, setPedirSenha] = useState(false)
  const [modalDia, setModalDia] = useState<string | null>(null)
  // Modal por agente (clique na legenda) — substitui o clique-na-data
  const [agenteAberto, setAgenteAberto] = useState<string | null>(null)
  const valteirZeradoRef = useRef(false)
  // Simulador de dias: offset em relação ao dia atual (só visível para Moisés em modo edição)
  const [offsetDias, setOffsetDias] = useState(0)

  const hoje = hojeComOffset(offsetDias)
  const agenteLogado = getAgenteLogado()
  // Somente Alexandre pode alterar a escala e seus painéis.
  const isGestor = agenteLogado === 'Alexandre'
  const isSobreaviso = AGENTES_SOBREAVISO.some(a => a.nome === agenteLogado)
  const isHorasExtras = AGENTES_SEM_SOBREAVISO.has(agenteLogado)

  useEffect(() => {
    // Migrar dados da versão antiga se existir
    const old = localStorage.getItem('escala-data-v1')
    if (old && !localStorage.getItem(STORAGE_KEY)) {
      try {
        const p = JSON.parse(old)
        const migrado: EscalaData = normalizarDadosAgentes({
          adm: p.adm ?? {},
          sobreaviso: p.sobreaviso ?? {},
          sobreavisoSemanal: {},
          folgas: {},
          ferias: p.ferias ?? [],
          horasSobreaviso: p.horasSobreaviso ?? {},
          horasTrabalhadasSobreaviso: {},
          justificativasSobreaviso: {},
          feriadosCustom: [],
          percDomingoFeriado: 100,
          percSobreaviso: 50,
          percSabado: 50,
          descontosFolgaBanco: {},
          horasExtrasSimples: {},
          justificativasExtrasSimples: {},
          ajustesBanco: {},
        })
        salvarDados(migrado)
        setDados(migrado)
      } catch { /* */ }
    }
  }, [])

  // Sincroniza com API remota ao montar: só sobrescreve local se remoto for mais recente
  // e se o remoto tiver conteúdo real (evita apagar calendário com snapshot vazio).
  useEffect(() => {
    let cancelado = false
    carregarDadosRemoto().then(remoto => {
      if (cancelado || !remoto) return
      // Proteção 1: edição feita nesta sessão (race condition)
      if (teveEdicaoLocalRecente()) return
      // Proteção 2: local mais recente que o remoto (edição offline anterior)
      const localTs = localStorage.getItem(LOCAL_TS_KEY)
      if (localTs && remoto.updatedAt && remoto.updatedAt <= localTs) return
      // Proteção 3: não sobrescrever dados locais com conteúdo real por dados remotos vazios
      if (localTemConteudo() && !dadosTemConteudo(remoto.dados)) return
      setDados(remoto.dados)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remoto.dados))
      if (remoto.updatedAt) localStorage.setItem(LOCAL_TS_KEY, remoto.updatedAt)
    })
    return () => { cancelado = true }
  }, [])

  // Atualiza em tempo real quando outro agente salva a escala
  useEffect(() => {
    const off = wsOn('escala_atualizada', () => {
      carregarDadosRemoto().then(remoto => {
        if (!remoto) return
        if (teveEdicaoLocalRecente()) return
        const localTs = localStorage.getItem(LOCAL_TS_KEY)
        if (localTs && remoto.updatedAt && remoto.updatedAt <= localTs) return
        // Proteção: não sobrescrever dados locais com conteúdo real por dados remotos vazios
        if (localTemConteudo() && !dadosTemConteudo(remoto.dados)) return
        setDados(remoto.dados)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remoto.dados))
        if (remoto.updatedAt) localStorage.setItem(LOCAL_TS_KEY, remoto.updatedAt)
      })
    })
    return off
  }, [])

  // Reset único do banco do agente Arthur (regra herdada do antigo Valteir).
  useEffect(() => {
    if (valteirZeradoRef.current) return
    const FLAG = 'banco-valteir-zerado-2026-04'
    if (localStorage.getItem(FLAG)) { valteirZeradoRef.current = true; return }
    const calc = calcularBancoHoras(
      'Arthur', dados.sobreaviso, dados.horasTrabalhadasSobreaviso,
      dados.percDomingoFeriado, dados.percSobreaviso, dados.percSabado,
      dados.feriadosCustom, dados.descontosFolgaBanco, dados.folgas, hojeStr(),
    )
    const ajusteAtual = dados.ajustesBanco?.['Arthur'] ?? 0
    const totalAtual = calc + ajusteAtual
    if (totalAtual !== 0) {
      const novosAjustes = { ...(dados.ajustesBanco ?? {}), Arthur: -calc }
      const novos = { ...dados, ajustesBanco: novosAjustes }
      setDados(novos)
      salvarDados(novos)
    }
    localStorage.setItem(FLAG, '1')
    valteirZeradoRef.current = true
  }, [dados])

  function mesAnterior() {
    if (mes === 0) { setAno(a => a - 1); setMes(11) }
    else setMes(m => m - 1)
  }

  function proximoMes() {
    if (mes === 11) { setAno(a => a + 1); setMes(0) }
    else setMes(m => m + 1)
  }

  const onDiaClick = useCallback((chave: string) => {
    if (isGestor) setModalDia(chave)
  }, [isGestor])

  function salvarDia(agentesSobreaviso: string[], folgasDoDia: string[]) {
    if (!isGestor || !modalDia) return

    const novoSobreaviso = { ...dados.sobreaviso }
    if (agentesSobreaviso.length === 0) delete novoSobreaviso[modalDia]
    else novoSobreaviso[modalDia] = agentesSobreaviso

    const novasFolgas = { ...dados.folgas }
    if (folgasDoDia.length === 0) delete novasFolgas[modalDia]
    else novasFolgas[modalDia] = folgasDoDia

    const novos = { ...dados, sobreaviso: novoSobreaviso, folgas: novasFolgas }
    setDados(novos)
    salvarDados(novos)
    setModalDia(null)
  }

  function onFeriasChange(novasFerias: Ferias[]) {
    if (!isGestor) return
    const novos = { ...dados, ferias: novasFerias }
    setDados(novos)
    salvarDados(novos)
  }

  function onAfastamentosChange(novosAfastamentos: Afastamento[]) {
    if (!isGestor) return
    const novos = { ...dados, afastamentos: novosAfastamentos }
    setDados(novos)
    salvarDados(novos)
  }

  function onFeriadosCustomChange(novosFeriados: string[]) {
    if (!isGestor) return
    const novos = { ...dados, feriadosCustom: novosFeriados }
    setDados(novos)
    salvarDados(novos)
  }

  function onRegrasChange(percDomFer: number, percSb: number, percSabado: number) {
    if (!isGestor) return
    const novos = { ...dados, percDomingoFeriado: percDomFer, percSobreaviso: percSb, percSabado }
    setDados(novos)
    salvarDados(novos)
  }

  function atualizarHorasTrabalhadasSobreaviso(data: string, horas: number) {
    if (!isGestor) return
    const agenteHoras = { ...(dados.horasTrabalhadasSobreaviso[agenteLogado] ?? {}) }
    const agenteJustifs = { ...(dados.justificativasSobreaviso?.[agenteLogado] ?? {}) }
    if (horas === 0) {
      delete agenteHoras[data]
      // Se as horas foram zeradas, a justificativa daquele dia perde o sentido.
      delete agenteJustifs[data]
    } else {
      agenteHoras[data] = horas
    }
    const novos = {
      ...dados,
      horasTrabalhadasSobreaviso: {
        ...dados.horasTrabalhadasSobreaviso,
        [agenteLogado]: agenteHoras,
      },
      justificativasSobreaviso: {
        ...(dados.justificativasSobreaviso ?? {}),
        [agenteLogado]: agenteJustifs,
      },
    }
    setDados(novos)
    salvarDados(novos)
  }

  function atualizarJustificativaSobreaviso(data: string, justificativa: string) {
    if (!isGestor) return
    const agenteJustifs = { ...(dados.justificativasSobreaviso?.[agenteLogado] ?? {}) }
    const valor = justificativa.slice(0, 500)
    if (!valor.trim()) {
      delete agenteJustifs[data]
    } else {
      agenteJustifs[data] = valor
    }
    const novos = {
      ...dados,
      justificativasSobreaviso: {
        ...(dados.justificativasSobreaviso ?? {}),
        [agenteLogado]: agenteJustifs,
      },
    }
    setDados(novos)
    salvarDados(novos)
  }

  async function removerAjusteBanco(agente: string, index: number) {
    if (!isGestor) return
    const logsAgente = [...(dados.ajustesBancoLogs?.[agente] ?? [])]
    if (index < 0 || index >= logsAgente.length) return
    logsAgente.splice(index, 1)
    // Recalcula o total acumulado
    const novoTotal = +logsAgente.reduce((acc, e) => acc + e.delta, 0).toFixed(2)
    const novosAjustes = { ...(dados.ajustesBanco ?? {}) }
    if (novoTotal === 0) {
      delete novosAjustes[agente]
    } else {
      novosAjustes[agente] = novoTotal
    }
    const novosLogs = { ...(dados.ajustesBancoLogs ?? {}), [agente]: logsAgente }
    const novos = { ...dados, ajustesBanco: novosAjustes, ajustesBancoLogs: novosLogs }
    setDados(novos)
    const resultado = await salvarDadosAsync(novos)
    if (!resultado.ok) {
      alert(`⚠️ Remoção salva localmente, mas falhou ao enviar ao servidor: ${resultado.mensagem ?? 'erro desconhecido'}. Tente novamente.`)
    }
  }

  async function atualizarAjusteBanco(agente: string, delta: number, justificativa?: string) {
    if (!isGestor) return
    const novosAjustes = { ...(dados.ajustesBanco ?? {}) }
    const ajusteAnterior = novosAjustes[agente] ?? 0
    const novoTotal = +(ajusteAnterior + delta).toFixed(2)
    if (novoTotal === 0) {
      delete novosAjustes[agente]
    } else {
      novosAjustes[agente] = novoTotal
    }
    // Registra no histórico
    const novosLogs = { ...(dados.ajustesBancoLogs ?? {}) }
    const entrada: { data: string; delta: number; justificativa?: string } = { data: hojeStr(), delta: +delta.toFixed(2) }
    if (justificativa) entrada.justificativa = justificativa
    novosLogs[agente] = [...(novosLogs[agente] ?? []), entrada]
    const novos = { ...dados, ajustesBanco: novosAjustes, ajustesBancoLogs: novosLogs }
    setDados(novos)
    const resultado = await salvarDadosAsync(novos)
    if (!resultado.ok) {
      alert(`⚠️ Ajuste salvo localmente, mas falhou ao enviar ao servidor: ${resultado.mensagem ?? 'erro desconhecido'}. Tente novamente.`)
    }
  }

  async function salvarHoraExtraSimples(data: string, horas: number, justificativa?: string): Promise<{ ok: boolean; mensagem?: string }> {
    if (!isGestor) return { ok: false, mensagem: 'Somente Alexandre pode editar a escala.' }
    const agenteHoras = { ...(dados.horasExtrasSimples[agenteLogado] ?? {}) }
    const agenteJustifs = { ...(dados.justificativasExtrasSimples?.[agenteLogado] ?? {}) }
    if (horas === 0) {
      delete agenteHoras[data]
      delete agenteJustifs[data]
    } else {
      agenteHoras[data] = horas
      if (justificativa !== undefined) {
        const j = justificativa.trim().slice(0, 500)
        if (j) {
          agenteJustifs[data] = j
        } else {
          delete agenteJustifs[data]
        }
      }
    }
    const novos = {
      ...dados,
      horasExtrasSimples: {
        ...dados.horasExtrasSimples,
        [agenteLogado]: agenteHoras,
      },
      justificativasExtrasSimples: {
        ...(dados.justificativasExtrasSimples ?? {}),
        [agenteLogado]: agenteJustifs,
      },
    }
    setDados(novos)
    return await salvarDadosAsync(novos)
  }

  function salvarJustificativaExtraSimples(data: string, justificativa: string) {
    if (!isGestor) return
    const agenteJustifs = { ...(dados.justificativasExtrasSimples?.[agenteLogado] ?? {}) }
    const valor = justificativa.slice(0, 500)
    if (!valor.trim()) {
      delete agenteJustifs[data]
    } else {
      agenteJustifs[data] = valor
    }
    const novos = {
      ...dados,
      justificativasExtrasSimples: {
        ...(dados.justificativasExtrasSimples ?? {}),
        [agenteLogado]: agenteJustifs,
      },
    }
    setDados(novos)
    salvarDados(novos)
  }

  return (
    <div className="escala-wrap">
      <div className="escala-nav-mes">
        <button className="escala-nav-btn" onClick={mesAnterior}>‹</button>
        <span className="escala-nav-label">{MESES[mes]} {ano}</span>
        <button className="escala-nav-btn" onClick={proximoMes}>›</button>
      </div>

      {isGestor && (
        <div className="escala-acoes-moises">
          <button
            className={`escala-btn-editar ${editando ? 'ativo' : ''}`}
            onClick={() => {
              if (editando) {
                setEditando(false)
                setModalDia(null)
              } else {
                setPedirSenha(true)
              }
            }}
          >
            {editando ? '✅ Concluir edição' : '✏️ Editar escala'}
          </button>
          <button
            className="escala-btn-exportar"
            onClick={() => {
              exportarEscalaMensalExcel(dados, ano, mes, ocorrencias).catch(err => {
                console.error('Falha ao exportar Excel:', err)
                alert('Não foi possível gerar o arquivo Excel. Tente novamente.')
              })
            }}
            title={`Baixar a escala de ${MESES[mes]}/${ano} em Excel`}
          >
            📊 Exportar mês em Excel
          </button>
        </div>
      )}

      {pedirSenha && (
        <ModalSenha
          titulo="Editar Escala"
          senhaCorreta={getSenhaAgente(agenteLogado) ?? '2026'}
          onConfirmar={() => { setPedirSenha(false); setEditando(true) }}
          onCancelar={() => setPedirSenha(false)}
        />
      )}

      {/* Calendário único: Sobreaviso + Folga (visualização — edição é feita pela legenda) */}
      <CalendarioUnificado
        ano={ano} mes={mes}
        sobreavisoDiario={dados.sobreaviso}
        folgas={dados.folgas}
        ferias={dados.ferias}
        hoje={hoje}
        editando={false}
        feriadosCustom={dados.feriadosCustom}
        onDiaClick={onDiaClick}
      />

      {editando && isGestor && (
        <div className="escala-simulador-dias">
          <div className="escala-simulador-titulo">📅 Simular data</div>
          <div className="escala-simulador-controles">
            <button
              className="escala-simulador-btn"
              onClick={() => setOffsetDias(o => o - 7)}
              title="Recuar 7 dias"
            >−7d</button>
            <button
              className="escala-simulador-btn"
              onClick={() => setOffsetDias(o => o - 1)}
              title="Recuar 1 dia"
            >−1d</button>
            <div className="escala-simulador-data">
              {offsetDias === 0
                ? <span className="escala-simulador-hoje-label">Hoje</span>
                : (
                  <>
                    <span className={`escala-simulador-offset ${offsetDias > 0 ? 'futuro' : 'passado'}`}>
                      {offsetDias > 0 ? `+${offsetDias}d` : `${offsetDias}d`}
                    </span>
                    <span className="escala-simulador-data-valor">{hoje.split('-').reverse().join('/')}</span>
                  </>
                )
              }
            </div>
            <button
              className="escala-simulador-btn"
              onClick={() => setOffsetDias(o => o + 1)}
              title="Avançar 1 dia"
            >+1d</button>
            <button
              className="escala-simulador-btn"
              onClick={() => setOffsetDias(o => o + 7)}
              title="Avançar 7 dias"
            >+7d</button>
            {offsetDias !== 0 && (
              <button
                className="escala-simulador-btn escala-simulador-btn-reset"
                onClick={() => setOffsetDias(0)}
                title="Voltar para hoje"
              >↺</button>
            )}
          </div>
          {offsetDias !== 0 && (
            <div className="escala-simulador-aviso">
              ⚠️ Simulação ativa — os saldos do banco de horas refletem a data simulada.
            </div>
          )}
        </div>
      )}

      <Legenda
        ferias={dados.ferias}
        afastamentos={dados.afastamentos ?? []}
        mes={mes}
        ano={ano}
        editavel={editando && isGestor}
        onAgenteClick={(nome) => setAgenteAberto(nome)}
      />

      {/* Banco de Horas — agente individual (sobreaviso) */}
      {!isGestor && isSobreaviso && (
        <BancoHorasAgente
          agente={agenteLogado}
          sobreavisoSemanal={dados.sobreaviso}
          horasTrabalhadasSobreaviso={dados.horasTrabalhadasSobreaviso}
          justificativasSobreaviso={dados.justificativasSobreaviso ?? {}}
          descontosFolgaBanco={dados.descontosFolgaBanco}
          folgas={dados.folgas}
          percDomingoFeriado={dados.percDomingoFeriado}
          percSobreaviso={dados.percSobreaviso}
          percSabado={dados.percSabado}
          feriadosCustom={dados.feriadosCustom}
          onUpdateHoras={atualizarHorasTrabalhadasSobreaviso}
          onUpdateJustificativa={atualizarJustificativaSobreaviso}
          ajusteBanco={dados.ajustesBanco?.[agenteLogado] ?? 0}
          editavel={isGestor}
          ocorrencias={ocorrencias}
        />
      )}

      {/* Banco de Horas de Ocorrências — agentes com sobreaviso (sábado ×1,5 · domingo ×2) */}
      {!isGestor && isHorasExtras && (
        <BancoHorasAgente
          agente={agenteLogado}
          sobreavisoSemanal={dados.sobreaviso}
          horasTrabalhadasSobreaviso={dados.horasTrabalhadasSobreaviso}
          justificativasSobreaviso={dados.justificativasSobreaviso ?? {}}
          descontosFolgaBanco={dados.descontosFolgaBanco}
          folgas={dados.folgas}
          percDomingoFeriado={dados.percDomingoFeriado}
          percSobreaviso={0}
          percSabado={dados.percSabado}
          feriadosCustom={dados.feriadosCustom}
          onUpdateHoras={atualizarHorasTrabalhadasSobreaviso}
          onUpdateJustificativa={atualizarJustificativaSobreaviso}
           editavel={isGestor}
          hideSobreaviso={true}
          hideTotalRow={true}
          ajusteBanco={0}
          ocorrencias={ocorrencias}
        />
      )}

      {/* Banco de Horas Extras Manuais — agentes sem sobreaviso */}
      {!isGestor && isHorasExtras && (() => {
        const horasOc = calcularBancoHoras(
          agenteLogado, dados.sobreaviso, dados.horasTrabalhadasSobreaviso,
          dados.percDomingoFeriado, dados.percSobreaviso, dados.percSabado,
          dados.feriadosCustom, dados.descontosFolgaBanco, dados.folgas, hoje,
        )
        return (
          <BancoHorasExtraSimples
            agente={agenteLogado}
            horasExtrasSimples={dados.horasExtrasSimples}
            justificativasExtrasSimples={dados.justificativasExtrasSimples ?? {}}
            onSalvarHora={salvarHoraExtraSimples}
            onSalvarJustificativa={salvarJustificativaExtraSimples}
            editavel={isGestor}
            horasOcorrencias={horasOc}
            ajusteBanco={dados.ajustesBanco?.[agenteLogado] ?? 0}
          />
        )
      })()}

      {/* Banco de Horas — gestores veem todos */}
      {isGestor && (
        <BancoHorasMoises
          sobreavisoSemanal={dados.sobreaviso}
          horasTrabalhadasSobreaviso={dados.horasTrabalhadasSobreaviso}
          justificativasSobreaviso={dados.justificativasSobreaviso ?? {}}
          descontosFolgaBanco={dados.descontosFolgaBanco}
          folgas={dados.folgas}
          percDomingoFeriado={dados.percDomingoFeriado}
          percSobreaviso={dados.percSobreaviso}
          percSabado={dados.percSabado}
          feriadosCustom={dados.feriadosCustom}
          horasExtrasSimples={dados.horasExtrasSimples}
          justificativasExtrasSimples={dados.justificativasExtrasSimples ?? {}}
          ajustesBanco={dados.ajustesBanco ?? {}}
          ajustesBancoLogs={dados.ajustesBancoLogs ?? {}}
          onAjusteChange={atualizarAjusteBanco}
          onRemoverAjuste={removerAjusteBanco}
          podeEditar={editando}
          hoje={hoje}
          ocorrencias={ocorrencias}
        />
      )}

      {/* Painéis exclusivos do Moisés em modo edição */}
      {editando && isGestor && (
        <>
          <PainelRegras
            percDomingoFeriado={dados.percDomingoFeriado}
            percSobreaviso={dados.percSobreaviso}
            percSabado={dados.percSabado}
            onChange={onRegrasChange}
          />
          <PainelFeriadosCustom
            feriados={dados.feriadosCustom}
            onChange={onFeriadosCustomChange}
          />
          <PainelFerias ferias={dados.ferias} onChange={onFeriasChange} />
          <PainelAfastamentos afastamentos={dados.afastamentos ?? []} onChange={onAfastamentosChange} />
        </>
      )}

      {/* Modal único do dia: Sobreaviso + Folga (legado, não aberto pelo fluxo atual) */}
      {modalDia && isGestor && (
        <ModalDia
          data={modalDia}
          selecionados={dados.sobreaviso[modalDia] ?? []}
          folgasSelecionadas={dados.folgas[modalDia] ?? []}
          ferias={dados.ferias}
          afastamentos={dados.afastamentos ?? []}
          onSalvar={salvarDia}
          onFechar={() => setModalDia(null)}
        />
      )}

      {/* Modal por agente: clique na legenda → calendário do agente */}
      {agenteAberto && editando && isGestor && (() => {
        const ag = AGENTES_ESCALA.find(a => a.nome === agenteAberto)
        if (!ag) return null
        const podeSb = !AGENTES_SEM_SOBREAVISO.has(ag.nome)
        return (
          <ModalAgenteCalendario
            agente={ag}
            podeSobreaviso={podeSb}
            sobreaviso={dados.sobreaviso}
            folgas={dados.folgas}
            ferias={dados.ferias}
            afastamentos={dados.afastamentos ?? []}
            feriadosCustom={dados.feriadosCustom}
            anoInicial={ano}
            mesInicial={mes}
            onSalvar={(novoSb, novasFolgas) => {
              const novos = { ...dados, sobreaviso: novoSb, folgas: novasFolgas }
              setDados(novos)
              salvarDados(novos)
              setAgenteAberto(null)
            }}
            onFechar={() => setAgenteAberto(null)}
          />
        )
      })()}
    </div>
  )
}

void _diasDaSemana;
void _PainelEscalasSemanas;
void ModalEscalarSemana;
