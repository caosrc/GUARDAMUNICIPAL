import { useState, useCallback, useMemo, useEffect } from 'react'
import { getAgenteLogado } from './Login'
import ModalSenha from './ModalSenha'
import './EscalaAgentes.css'

// ── Constantes ────────────────────────────────────────────────────
const AGENTES_ESCALA = [
  { nome: 'Valteir',   cor: '#2563eb', iniciais: 'VA' },
  { nome: 'Arthur',    cor: '#16a34a', iniciais: 'AR' },
  { nome: 'Gustavo',   cor: '#dc2626', iniciais: 'GU' },
  { nome: 'Vânia',     cor: '#9333ea', iniciais: 'VÂ' },
  { nome: 'Graça',     cor: '#ea580c', iniciais: 'GR' },
  { nome: 'Talita',    cor: '#0891b2', iniciais: 'TA' },
  { nome: 'Cristiane', cor: '#db2777', iniciais: 'CR' },
  { nome: 'Dyonathan', cor: '#b45309', iniciais: 'DY' },
  { nome: 'Sócrates',  cor: '#475569', iniciais: 'SÓ' },
]

// Apenas estes 6 participam do sobreaviso
const AGENTES_SOBREAVISO = [
  { nome: 'Valteir',   cor: '#2563eb', iniciais: 'VA' },
  { nome: 'Arthur',    cor: '#16a34a', iniciais: 'AR' },
  { nome: 'Gustavo',   cor: '#dc2626', iniciais: 'GU' },
  { nome: 'Vânia',     cor: '#9333ea', iniciais: 'VÂ' },
  { nome: 'Graça',     cor: '#ea580c', iniciais: 'GR' },
  { nome: 'Dyonathan', cor: '#b45309', iniciais: 'DY' },
]

const AGENTE_MAP: Record<string, { cor: string; iniciais: string }> = {}
AGENTES_ESCALA.forEach(ag => { AGENTE_MAP[ag.nome] = { cor: ag.cor, iniciais: ag.iniciais } })

const DIAS_SEMANA_HDR  = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const HORAS_POR_SEMANA_SOBREAVISO = 16
const HORAS_POR_DIA_SOBREAVISO = 14

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

function ehFeriadoOuDomingo(chave: string): boolean {
  const [y, m, d] = chave.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getDay() === 0) return true
  const mmdd = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return FERIADOS_FIXOS.has(mmdd)
}

function multiplicadorDia(chave: string): number {
  return ehFeriadoOuDomingo(chave) ? 2 : 1.5
}

// Retorna os 7 dias (Seg–Dom) de uma semana dado o Monday
function diasDaSemana(seg: string): string[] {
  const [y, m, d] = seg.split('-').map(Number)
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(y, m - 1, d)
    dt.setDate(dt.getDate() + i)
    return chaveData(dt.getFullYear(), dt.getMonth(), dt.getDate())
  })
}

// ── Tipos ─────────────────────────────────────────────────────────
type TipoEscala = 'adm' | 'sobreaviso'

interface Ferias {
  agente: string
  inicio: string
  fim: string
}

interface EscalaData {
  adm: Record<string, string[]>
  sobreaviso: Record<string, string[]>                      // legado — mantido por compat
  sobreavisoSemanal: Record<string, string[]>               // segunda-feira (YYYY-MM-DD) → lista de agentes
  ferias: Ferias[]
  horasSobreaviso: Record<string, Record<string, number>>   // legado
  horasTrabalhadasSobreaviso: Record<string, Record<string, number>> // agente → { data: horas }
}

// ── Storage ───────────────────────────────────────────────────────
const STORAGE_KEY = 'escala-data-v3'

function normalizarSemanal(raw: Record<string, string | string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(raw)) {
    out[k] = Array.isArray(v) ? v : (v ? [v] : [])
  }
  return out
}

function carregarDados(): EscalaData {
  try {
    // Tenta v3 primeiro
    const rawV3 = localStorage.getItem(STORAGE_KEY)
    if (rawV3) {
      const p = JSON.parse(rawV3)
      return {
        adm: p.adm ?? {},
        sobreaviso: p.sobreaviso ?? {},
        sobreavisoSemanal: normalizarSemanal(p.sobreavisoSemanal ?? {}),
        ferias: p.ferias ?? [],
        horasSobreaviso: p.horasSobreaviso ?? {},
        horasTrabalhadasSobreaviso: p.horasTrabalhadasSobreaviso ?? {},
      }
    }
    // Migra v2
    const rawV2 = localStorage.getItem('escala-data-v2')
    if (rawV2) {
      const p = JSON.parse(rawV2)
      return {
        adm: p.adm ?? {},
        sobreaviso: p.sobreaviso ?? {},
        sobreavisoSemanal: normalizarSemanal(p.sobreavisoSemanal ?? {}),
        ferias: p.ferias ?? [],
        horasSobreaviso: p.horasSobreaviso ?? {},
        horasTrabalhadasSobreaviso: p.horasTrabalhadasSobreaviso ?? {},
      }
    }
  } catch { /* */ }
  return { adm: {}, sobreaviso: {}, sobreavisoSemanal: {}, ferias: [], horasSobreaviso: {}, horasTrabalhadasSobreaviso: {} }
}

function salvarDados(data: EscalaData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
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

function diaAnterior(chave: string): string {
  const [y, m, d] = chave.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - 1)
  return chaveData(date.getFullYear(), date.getMonth(), date.getDate())
}

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

// Semanas de sobreaviso feitas por um agente → banco de horas (fixo + horas trabalhadas com multiplicador)
function calcularBancoHoras(
  agente: string,
  sobreavisoDiario: Record<string, string[]>,
  horasTrabalhadasSobreaviso: Record<string, Record<string, number>> = {}
): number {
  const horasFlat = Object.values(sobreavisoDiario)
    .filter(lista => lista.includes(agente)).length * HORAS_POR_DIA_SOBREAVISO
  const horasAgente = horasTrabalhadasSobreaviso[agente] ?? {}
  const horasExtras = Object.entries(horasAgente).reduce((acc, [data, h]) => {
    return acc + (h * multiplicadorDia(data))
  }, 0)
  return horasFlat + horasExtras
}

// Folgas do agente: segunda da semana APÓS cada sobreaviso
function folgasDoAgente(agente: string, sobreavisoDiario: Record<string, string[]>): string[] {
  return Object.entries(sobreavisoDiario)
    .filter(([, lista]) => lista.includes(agente))
    .map(([data]) => proximoDia(data))
}

// ── Modal: escalar agentes para um dia de sobreaviso (Moisés) ─────
interface ModalSemanaProps {
  data: string
  agentesSelecionados: string[]
  ferias: Ferias[]
  onSalvar: (agentes: string[]) => void
  onFechar: () => void
}

function ModalEscalarSemana({ data, agentesSelecionados, ferias, onSalvar, onFechar }: ModalSemanaProps) {
  const [escolhidos, setEscolhidos] = useState<string[]>(agentesSelecionados)
  const folgaDiaSeguinte = proximoDia(data)

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
              {fmtDataCurta(data)} 17h → {fmtDataCurta(folgaDiaSeguinte)} 07h
            </div>
          </div>
          <button className="escala-modal-fechar" onClick={onFechar}>✕</button>
        </div>

        <div className="sb-semana-info-box">
          <span>⏰</span>
          <span>Pode selecionar mais de um agente. Quem ficar de sobreaviso neste dia entra de folga no dia seguinte.</span>
        </div>

        <div className="sb-modal-counter">
          {escolhidos.length === 0
            ? 'Nenhum selecionado'
            : `${escolhidos.length} selecionado${escolhidos.length > 1 ? 's' : ''}`}
        </div>

        <div className="escala-modal-lista">
          {AGENTES_SOBREAVISO.map(ag => {
            const emFerias = agenteEmFerias(ag.nome, data, ferias)
            const ativo = escolhidos.includes(ag.nome)
            return (
              <button
                key={ag.nome}
                className={`escala-modal-agente ${ativo ? 'selecionado' : ''} ${emFerias ? 'em-ferias' : ''}`}
                style={ativo ? { background: ag.cor, borderColor: ag.cor, color: '#fff' } : { borderColor: ag.cor }}
                onClick={() => !emFerias && toggle(ag.nome)}
                disabled={emFerias}
              >
                <span className="escala-modal-iniciais" style={{ background: ativo ? 'rgba(255,255,255,0.25)' : ag.cor }}>
                  {ag.iniciais}
                </span>
                <span className="escala-modal-agente-nome">{ag.nome}</span>
                {ativo && <span className="sb-modal-check">✓</span>}
                {emFerias && <span className="escala-modal-ferias-tag">🌴 Férias</span>}
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

function PainelEscalasSemanas({ sobreavisoSemanal, ferias, onEscalar }: PainelSemanasProps) {
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

// ── Calendário Sobreaviso por dia ─────────────────────────────────
interface CalendarioSobreavisoProps {
  ano: number
  mes: number
  sobreavisoDiario: Record<string, string[]>
  hoje: string
  editando: boolean
  onDiaClick: (chave: string) => void
}

function CalendarioSobreaviso({ ano, mes, sobreavisoDiario, hoje, editando, onDiaClick }: CalendarioSobreavisoProps) {
  const total = diasNoMes(ano, mes)
  const inicio = primeiroDiaSemana(ano, mes)

  const celulas: (number | null)[] = [
    ...Array(inicio).fill(null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ]

  return (
    <div className="escala-calendario-bloco escala-bloco-sobreaviso">
      <div className="escala-bloco-header">
        <span className="escala-bloco-icone">📟</span>
        <span className="escala-bloco-titulo">Sobreaviso</span>
      </div>
      <div className="escala-cal-grid">
        {DIAS_SEMANA_HDR.map((d, i) => (
          <div key={i} className="escala-cal-diahdr">{d}</div>
        ))}
        {celulas.map((dia, i) => {
          if (dia === null) return <div key={`v-${i}`} className="escala-cal-vazio sb-vazio" />

          const chave = chaveData(ano, mes, dia)
          const agentes = sobreavisoDiario[chave] ?? []
          const isHoje = chave === hoje

          const primeiraInfo = agentes.length > 0 ? AGENTE_MAP[agentes[0]] : null

          return (
            <button
              key={chave}
              className={`escala-cal-dia sb-dia ${isHoje ? 'hoje' : ''} ${agentes.length > 0 ? 'tem-agente' : ''} ${editando ? 'editavel' : ''}`}
              style={primeiraInfo ? { backgroundColor: primeiraInfo.cor + '10', borderBottom: `2px solid ${primeiraInfo.cor}35` } : {}}
              onClick={() => editando && onDiaClick(chave)}
            >
              <span className="escala-cal-num">{dia}</span>
              <div className="sb-nomes-dia">
                {agentes.map(nome => {
                  const info = AGENTE_MAP[nome]
                  return info ? (
                    <span
                      key={nome}
                      className="sb-nome-dia"
                      style={{ color: info.cor }}
                      title={`${nome} de sobreaviso`}
                    >
                      {nome}
                    </span>
                  ) : null
                })}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Banco de Horas: visão do agente ──────────────────────────────
interface BancoHorasAgenteProps {
  agente: string
  sobreavisoSemanal: Record<string, string[]>
  horasTrabalhadasSobreaviso: Record<string, Record<string, number>>
  onUpdateHoras: (data: string, horas: number) => void
}

function BancoHorasAgente({ agente, sobreavisoSemanal, horasTrabalhadasSobreaviso, onUpdateHoras }: BancoHorasAgenteProps) {
  const info = AGENTE_MAP[agente]
  const hoje = hojeStr()

  const totalHoras = calcularBancoHoras(agente, sobreavisoSemanal, horasTrabalhadasSobreaviso)

  // Folgas futuras
  const folgas = folgasDoAgente(agente, sobreavisoSemanal)
  const proximaFolga = folgas.find(f => f >= hoje) ?? null

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
  const horasAgente = horasTrabalhadasSobreaviso[agente] ?? {}

  // Soma de horas extras de uma semana específica
  function horasExtrasDaSemana(seg: string): number {
    return diasDaSemana(seg).reduce((acc, data) => {
      const h = horasAgente[data] ?? 0
      return acc + (h * multiplicadorDia(data))
    }, 0)
  }

  return (
    <div className="bh-card">
      <div className="bh-card-header">
        <span className="bh-card-iniciais" style={{ background: info?.cor ?? '#64748b' }}>
          {info?.iniciais ?? agente.slice(0, 2).toUpperCase()}
        </span>
        <div className="bh-card-info">
          <span className="bh-card-nome">{agente}</span>
          <span className="bh-card-subtitulo">Banco de Horas — Sobreaviso</span>
        </div>
        <div className="bh-card-total">
          <span className="bh-card-horas">{totalHoras % 1 === 0 ? totalHoras : totalHoras.toFixed(1)}</span>
          <span className="bh-card-h">h</span>
        </div>
      </div>

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

      {semanasDoAgente.length === 0 ? (
        <p className="bh-card-vazio">Nenhum dia de sobreaviso registrado ainda.</p>
      ) : (
        <div className="bh-semanas-lista">
          {semanasDoAgente.map(seg => {
            const dias = [seg]
            const aberta = semanaAberta === seg
            const horasExtras = horasExtrasDaSemana(seg)
            const totalSemana = HORAS_POR_DIA_SOBREAVISO + horasExtras

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
                    <span className="bh-semana-base">Base: {HORAS_POR_DIA_SOBREAVISO}h</span>
                    {horasExtras > 0 && (
                      <span className="bh-semana-extra">+ {horasExtras % 1 === 0 ? horasExtras : horasExtras.toFixed(1)}h extras</span>
                    )}
                    <span className="bh-semana-total">= {totalSemana % 1 === 0 ? totalSemana : totalSemana.toFixed(1)}h</span>
                  </div>
                  <span className="bh-semana-chevron">{aberta ? '▲' : '▼'}</span>
                </button>

                {aberta && (
                  <div className="bh-semana-dias">
                    <p className="bh-semana-instrucao">
                      Informe as horas que você foi acionado neste dia. Seg–Sáb ×1,5 · Dom/Feriado ×2
                    </p>
                    {dias.map(data => {
                      const [y, m, d] = data.split('-').map(Number)
                      const dow = new Date(y, m - 1, d).getDay()
                      const nomeDia = DIAS_SEMANA_NOMES[dow]
                      const isFerOuDom = ehFeriadoOuDomingo(data)
                      const mult = multiplicadorDia(data)
                      const hInput = horasAgente[data] ?? 0
                      const hCalc = hInput * mult

                      return (
                        <div key={data} className={`bh-dia-row ${isFerOuDom ? 'feriado-dom' : ''}`}>
                          <div className="bh-dia-info">
                            <span className="bh-dia-nome">{nomeDia}</span>
                            <span className="bh-dia-data">{String(d).padStart(2,'0')}/{String(m).padStart(2,'0')}</span>
                            {isFerOuDom && <span className="bh-dia-badge">×2</span>}
                            {!isFerOuDom && <span className="bh-dia-badge mult15">×1,5</span>}
                          </div>
                          <div className="bh-dia-input-wrap">
                            <input
                              type="number"
                              min={0}
                              max={24}
                              step={0.5}
                              value={hInput === 0 ? '' : hInput}
                              placeholder="0"
                              className="bh-dia-input"
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0
                                onUpdateHoras(data, Math.min(24, Math.max(0, val)))
                              }}
                            />
                            <span className="bh-dia-input-h">h</span>
                          </div>
                          {hInput > 0 && (
                            <span className="bh-dia-calc">
                              = {hCalc % 1 === 0 ? hCalc : hCalc.toFixed(1)}h
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Banco de Horas: painel do Moisés ─────────────────────────────
interface BancoHorasMoisesProps {
  sobreavisoSemanal: Record<string, string[]>
  horasTrabalhadasSobreaviso: Record<string, Record<string, number>>
}

function BancoHorasMoises({ sobreavisoSemanal, horasTrabalhadasSobreaviso }: BancoHorasMoisesProps) {
  const hoje = hojeStr()

  const lista = useMemo(() => {
    return AGENTES_SOBREAVISO.map(ag => {
      const total = calcularBancoHoras(ag.nome, sobreavisoSemanal, horasTrabalhadasSobreaviso)
      const semanas = Object.values(sobreavisoSemanal).filter(lista => lista.includes(ag.nome)).length
      const desobreaviso = (sobreavisoSemanal[hoje] ?? []).includes(ag.nome)
      const folgas = folgasDoAgente(ag.nome, sobreavisoSemanal)
      const temFolga = folgas.includes(hoje)
      return { ...ag, total, semanas, desobreaviso, temFolga }
    }).sort((a, b) => b.total - a.total)
  }, [sobreavisoSemanal, horasTrabalhadasSobreaviso, hoje])

  const totalGeral = lista.reduce((s, ag) => s + ag.total, 0)

  return (
    <div className="bh-moises-painel">
      <div className="bh-moises-header">
        <span className="bh-moises-titulo">⏱️ Banco de Horas — Sobreaviso</span>
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
                <span className="bh-moises-badge-folga" title="De folga esta semana">🏠</span>
              )}
              <div className="bh-moises-horas-info">
                <span className="bh-moises-h">{ag.total % 1 === 0 ? ag.total : ag.total.toFixed(1)}h</span>
                <span className="bh-moises-semanas">{ag.semanas} dia{ag.semanas === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="bh-moises-rodape">
        16h por semana de sobreaviso · Seg–Sáb ×1,5 · Dom/Feriado ×2
      </div>
    </div>
  )
}

// ── Modal seleção de agentes por dia ADM (Moisés) ────────────────
interface ModalDiaProps {
  data: string
  tipo: TipoEscala
  selecionados: string[]
  ferias: Ferias[]
  onSalvar: (agentes: string[]) => void
  onFechar: () => void
}

function ModalDia({ data, tipo, selecionados, ferias, onSalvar, onFechar }: ModalDiaProps) {
  const [escolhidos, setEscolhidos] = useState<string[]>(selecionados)
  const [, mesStr, diaStr] = data.split('-')
  const label = `${diaStr}/${mesStr} — Plantão ADM`

  function toggle(nome: string) {
    setEscolhidos(prev => prev.includes(nome) ? prev.filter(n => n !== nome) : [...prev, nome])
  }

  return (
    <div className="escala-modal-overlay" onClick={onFechar}>
      <div className="escala-modal" onClick={e => e.stopPropagation()}>
        <div className="escala-modal-header">
          <span className="escala-modal-titulo">{label}</span>
          <button className="escala-modal-fechar" onClick={onFechar}>✕</button>
        </div>
        <p className="escala-modal-sub">Selecione quem está escalado:</p>
        <div className="escala-modal-lista">
          {AGENTES_ESCALA.map(ag => {
            const emFerias = agenteEmFerias(ag.nome, data, ferias)
            const ativo = escolhidos.includes(ag.nome)
            return (
              <button
                key={ag.nome}
                className={`escala-modal-agente ${ativo ? 'selecionado' : ''} ${emFerias ? 'em-ferias' : ''}`}
                style={ativo ? { background: ag.cor, borderColor: ag.cor, color: '#fff' } : { borderColor: ag.cor }}
                onClick={() => toggle(ag.nome)}
                disabled={emFerias}
              >
                <span className="escala-modal-iniciais" style={{ background: ativo ? 'rgba(255,255,255,0.25)' : ag.cor }}>
                  {ag.iniciais}
                </span>
                <span className="escala-modal-agente-nome">{ag.nome}</span>
                {emFerias && <span className="escala-modal-ferias-tag">🌴 Férias</span>}
              </button>
            )
          })}
        </div>
        <div className="escala-modal-acoes">
          <button className="escala-modal-limpar" onClick={() => setEscolhidos([])}>Limpar</button>
          <button className="escala-modal-salvar" onClick={() => onSalvar(escolhidos)}>Salvar</button>
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
      <div className="escala-ferias-titulo"><span>🌴</span> Férias / Folga prolongada</div>
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

// ── Calendário ADM ────────────────────────────────────────────────
interface CalendarioProps {
  ano: number
  mes: number
  dados: Record<string, string[]>
  sobreavisoDiario: Record<string, string[]>
  ferias: Ferias[]
  hoje: string
  editando: boolean
  onDiaClick: (chave: string) => void
}

function CalendarioADM({ ano, mes, dados, sobreavisoDiario, ferias, hoje, editando, onDiaClick }: CalendarioProps) {
  const total = diasNoMes(ano, mes)
  const inicio = primeiroDiaSemana(ano, mes)

  const trailingCount = (7 - ((inicio + total) % 7)) % 7

  function agentesEmFolga(chave: string): string[] {
    const mapa = sobreavisoDiario ?? {}
    const lista = mapa[diaAnterior(chave)]
    return Array.isArray(lista) ? lista : []
  }

  function diaUtil(chave: string): boolean {
    const [y, m, d] = chave.split('-').map(Number)
    const dow = new Date(y, m - 1, d).getDay()
    return dow >= 1 && dow <= 5
  }

  function sabadoDomingoOuFeriado(chave: string): boolean {
    const [y, m, d] = chave.split('-').map(Number)
    const dow = new Date(y, m - 1, d).getDay()
    if (dow === 0 || dow === 6) return true
    const mmdd = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return FERIADOS_FIXOS.has(mmdd)
  }

  return (
    <div className="escala-calendario-bloco escala-bloco-adm">
      <div className="escala-bloco-header">
        <span className="escala-bloco-icone">🏢</span>
        <span className="escala-bloco-titulo">ADM</span>
      </div>
      <div className="escala-cal-grid">
        {DIAS_SEMANA_HDR.map((d, i) => (
          <div key={i} className="escala-cal-diahdr">{d}</div>
        ))}

        {/* Células vazias de cabeça (antes do dia 1) */}
        {Array.from({ length: inicio }).map((_, i) => (
          <div key={`lead-${i}`} className="escala-cal-vazio" />
        ))}

        {/* Células de dias */}
        {Array.from({ length: total }, (_, i) => i + 1).map(dia => {
          const chave = chaveData(ano, mes, dia)
          const isHoje = chave === hoje
          const folgas = diaUtil(chave)
            ? agentesEmFolga(chave).filter(nome => !agenteEmFerias(nome, chave, ferias))
            : []
          const temFolga = folgas.length > 0

          return (
            <button
              key={chave}
              className={`escala-cal-dia ${isHoje ? 'hoje' : ''} ${temFolga ? 'tem-folga' : ''} ${editando ? 'editavel' : ''}`}
              onClick={() => editando && onDiaClick(chave)}
            >
              <span className="escala-cal-num">{dia}</span>
              {temFolga && (
                <div className="escala-adm-folgas" title={folgas.join(', ')}>
                  <span className="escala-adm-folga-label">Folga:</span>
                  {folgas.map(nome => {
                    const info = AGENTE_MAP[nome]
                    return (
                      <span
                        key={nome}
                        className="escala-adm-folga-nome"
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
          <div key={`tail-${i}`} className="escala-cal-vazio" />
        ))}
      </div>
    </div>
  )
}

// ── Legenda ───────────────────────────────────────────────────────
function Legenda({ ferias, mes, ano }: { ferias: Ferias[]; mes: number; ano: number }) {
  const mesStr = String(mes + 1).padStart(2, '0')
  const anoStr = String(ano)

  const { ativos, deFerias } = useMemo(() => {
    const deFerias: Array<{ ag: typeof AGENTES_ESCALA[0]; periodos: Ferias[] }> = []
    const ativos: typeof AGENTES_ESCALA = []
    AGENTES_ESCALA.forEach(ag => {
      const periodos = ferias.filter(f =>
        f.agente === ag.nome &&
        f.inicio <= `${anoStr}-${mesStr}-31` &&
        f.fim >= `${anoStr}-${mesStr}-01`
      )
      if (periodos.length > 0) deFerias.push({ ag, periodos })
      else ativos.push(ag)
    })
    return { ativos, deFerias }
  }, [ferias, mes, ano, mesStr, anoStr])

  return (
    <div className="escala-legenda">
      <span className="escala-legenda-titulo">Legenda</span>
      <div className="escala-legenda-lista">
        {ativos.map(ag => (
          <div key={ag.nome} className="escala-legenda-item">
            <span className="escala-legenda-cor" style={{ background: ag.cor }} />
            <span className="escala-legenda-nome">{ag.nome}</span>
          </div>
        ))}
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
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────
export default function EscalaAgentes() {
  const agora = new Date()
  const [ano, setAno] = useState(agora.getFullYear())
  const [mes, setMes] = useState(agora.getMonth())
  const [dados, setDados] = useState<EscalaData>(carregarDados)
  const [editando, setEditando] = useState(false)
  const [pedirSenha, setPedirSenha] = useState(false)
  const [modalDia, setModalDia] = useState<string | null>(null)
  const [modalSemana, setModalSemana] = useState<string | null>(null)

  const hoje = hojeStr()
  const agenteLogado = getAgenteLogado()
  const isMoises = agenteLogado === 'Moisés'
  const isSobreaviso = AGENTES_SOBREAVISO.some(a => a.nome === agenteLogado)

  useEffect(() => {
    // Migrar dados da versão antiga se existir
    const old = localStorage.getItem('escala-data-v1')
    if (old && !localStorage.getItem(STORAGE_KEY)) {
      try {
        const p = JSON.parse(old)
        const migrado: EscalaData = {
          adm: p.adm ?? {},
          sobreaviso: p.sobreaviso ?? {},
          sobreavisoSemanal: {},
          ferias: p.ferias ?? [],
          horasSobreaviso: p.horasSobreaviso ?? {},
        }
        salvarDados(migrado)
        setDados(migrado)
      } catch { /* */ }
    }
  }, [])

  function mesAnterior() {
    if (mes === 0) { setAno(a => a - 1); setMes(11) }
    else setMes(m => m - 1)
  }

  function proximoMes() {
    if (mes === 11) { setAno(a => a + 1); setMes(0) }
    else setMes(m => m + 1)
  }

  const onDiaClick = useCallback((chave: string) => {
    setModalDia(chave)
  }, [])

  function salvarDiaADM(agentes: string[]) {
    if (!modalDia) return
    const novoAdm = { ...dados.adm }
    if (agentes.length === 0) delete novoAdm[modalDia]
    else novoAdm[modalDia] = agentes
    const novos = { ...dados, adm: novoAdm }
    setDados(novos)
    salvarDados(novos)
    setModalDia(null)
  }

  function salvarSobreavisoDia(agentes: string[]) {
    if (!modalSemana) return
    const novoSobreaviso = { ...dados.sobreaviso }
    if (agentes.length === 0) delete novoSobreaviso[modalSemana]
    else novoSobreaviso[modalSemana] = agentes
    const novos = { ...dados, sobreaviso: novoSobreaviso }
    setDados(novos)
    salvarDados(novos)
    setModalSemana(null)
  }

  function onFeriasChange(novasFerias: Ferias[]) {
    const novos = { ...dados, ferias: novasFerias }
    setDados(novos)
    salvarDados(novos)
  }

  function atualizarHorasTrabalhadasSobreaviso(data: string, horas: number) {
    const agenteHoras = { ...(dados.horasTrabalhadasSobreaviso[agenteLogado] ?? {}) }
    if (horas === 0) {
      delete agenteHoras[data]
    } else {
      agenteHoras[data] = horas
    }
    const novos = {
      ...dados,
      horasTrabalhadasSobreaviso: {
        ...dados.horasTrabalhadasSobreaviso,
        [agenteLogado]: agenteHoras,
      },
    }
    setDados(novos)
    salvarDados(novos)
  }

  return (
    <div className="escala-wrap">
      <div className="escala-em-desenvolvimento">🚧 Em desenvolvimento...</div>
      <div className="escala-nav-mes">
        <button className="escala-nav-btn" onClick={mesAnterior}>‹</button>
        <span className="escala-nav-label">{MESES[mes]} {ano}</span>
        <button className="escala-nav-btn" onClick={proximoMes}>›</button>
      </div>

      {isMoises && (
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
      )}

      {pedirSenha && (
        <ModalSenha
          titulo="Editar Escala"
          senhaCorreta="2026"
          onConfirmar={() => { setPedirSenha(false); setEditando(true) }}
          onCancelar={() => setPedirSenha(false)}
        />
      )}

      {editando && isMoises && (
        <div className="escala-edit-aviso">
          Toque em qualquer dia no Sobreaviso para editar a escala diária. Quem ficar de sobreaviso folga no dia seguinte no ADM.
        </div>
      )}

      {/* Calendário ADM */}
      <CalendarioADM
        ano={ano} mes={mes}
        dados={dados.adm}
        sobreavisoDiario={dados.sobreaviso}
        ferias={dados.ferias}
        hoje={hoje}
        editando={editando && isMoises}
        onDiaClick={onDiaClick}
      />

      {/* Calendário Sobreaviso com nomes */}
      <CalendarioSobreaviso
        ano={ano} mes={mes}
        sobreavisoDiario={dados.sobreaviso}
        hoje={hoje}
        editando={editando && isMoises}
        onDiaClick={(chave) => setModalSemana(chave)}
      />

      <Legenda ferias={dados.ferias} mes={mes} ano={ano} />

      {/* Banco de Horas — agente individual (sobreaviso) */}
      {!isMoises && isSobreaviso && (
        <BancoHorasAgente
          agente={agenteLogado}
          sobreavisoSemanal={dados.sobreaviso}
          horasTrabalhadasSobreaviso={dados.horasTrabalhadasSobreaviso}
          onUpdateHoras={atualizarHorasTrabalhadasSobreaviso}
        />
      )}

      {/* Banco de Horas — Moisés vê todos */}
      {isMoises && (
        <BancoHorasMoises
          sobreavisoSemanal={dados.sobreaviso}
          horasTrabalhadasSobreaviso={dados.horasTrabalhadasSobreaviso}
        />
      )}

      {/* Painel de férias — só Moisés em edição */}
      {editando && isMoises && (
        <PainelFerias ferias={dados.ferias} onChange={onFeriasChange} />
      )}

      {/* Modal ADM por dia */}
      {modalDia && (
        <ModalDia
          data={modalDia}
          tipo="adm"
          selecionados={dados.adm[modalDia] ?? []}
          ferias={dados.ferias}
          onSalvar={salvarDiaADM}
          onFechar={() => setModalDia(null)}
        />
      )}

      {/* Modal sobreaviso diário */}
      {modalSemana && (
        <ModalEscalarSemana
          data={modalSemana}
          agentesSelecionados={dados.sobreaviso[modalSemana] ?? []}
          ferias={dados.ferias}
          onSalvar={salvarSobreavisoDia}
          onFechar={() => setModalSemana(null)}
        />
      )}
    </div>
  )
}
