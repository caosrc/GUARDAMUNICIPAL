import { useState, useEffect, useCallback } from 'react'
import { getNomeAgenteGlobal } from '../gpsService'
import { wsOn } from '../wsClient'
import { supabase, supabaseDisponivel } from '../supabaseClient'
import { normalizarNomeAgente } from '../types'

interface ConfirmacaoAgente {
  agente: string
  confirmado: boolean
  confirmedAt?: string
}

interface PlanoResumido {
  id: string
  tipo: string
  nome: string
  local: string
  dataInicio: string
  horario: string
  horarioFim: string
  criadoPor: string
  risco: string
  descricao: string
  confirmacoes: ConfirmacaoAgente[]
  agentesDefesaCivil: string[]
}

const TIPOS_CONFIG: Record<string, { label: string; emoji: string; cor: string }> = {
  evento:     { label: 'Evento',      emoji: '🎪', cor: '#1a6bbf' },
  operacao:   { label: 'Operação',    emoji: '🚨', cor: '#dc2626' },
  simulado:   { label: 'Simulado',    emoji: '⛑️', cor: '#7c3aed' },
  emergencia: { label: 'Emergencial', emoji: '⚠️', cor: '#ea580c' },
}

function nomeCorresponde(agLista: string, agLogado: string): boolean {
  if (!agLista || !agLogado) return false
  const nomeLista = normalizarNomeAgente(agLista)
  const nomeLogado = normalizarNomeAgente(agLogado)
  if (nomeLista === nomeLogado) return true
  const pL = nomeLista.trim().toLowerCase().split(' ')[0]
  const pA = nomeLogado.trim().toLowerCase().split(' ')[0]
  return pL === pA && pL.length > 2
}

async function buscarPlanosComPendencia(agente: string): Promise<PlanoResumido[]> {
  try {
    let rows: Record<string, unknown>[]
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('planejamentos')
        .select('*')
        .order('criado_em', { ascending: false })
        .limit(200)
      if (error) return []
      rows = (data ?? []) as Record<string, unknown>[]
    } else {
      const res = await fetch('/api/planejamentos')
      if (!res.ok) return []
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('text/html')) return []
      rows = await res.json()
    }
    if (!Array.isArray(rows)) return []

    const pendentes: PlanoResumido[] = []
    for (const row of rows) {
      const agentes = (row.agentes_defesa_civil as string[]) ?? []
      const estaEscalado = agentes.some(ag => nomeCorresponde(ag, agente))
      if (!estaEscalado) continue

      const confirmacoes = (row.confirmacoes_agentes as ConfirmacaoAgente[]) ?? []
      const minhaConf = confirmacoes.find(c => nomeCorresponde(c.agente, agente))
      if (minhaConf !== undefined) continue

      const status = (row.status as string) ?? ''
      if (status === 'cancelado' || status === 'concluido') continue

      pendentes.push({
        id: row.id as string,
        tipo: (row.tipo as string) ?? 'evento',
        nome: (row.nome as string) ?? 'Planejamento',
        local: (row.local as string) ?? '',
        dataInicio: (row.data_inicio as string) ?? '',
        horario: (row.horario as string) ?? '',
        horarioFim: (row.horario_fim as string) ?? '',
        criadoPor: row.criado_por ? normalizarNomeAgente(String(row.criado_por)) : '',
        risco: (row.risco as string) ?? 'baixo',
        descricao: (row.descricao as string) ?? '',
        confirmacoes,
        agentesDefesaCivil: agentes.map(normalizarNomeAgente),
      })
    }
    return pendentes
  } catch {
    return []
  }
}

function formatarData(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

interface BannerConvocacaoProps {
  onPendentesChange?: (count: number) => void
  forceOpen?: boolean
}

export default function BannerConvocacao({ onPendentesChange, forceOpen }: BannerConvocacaoProps) {
  const [planos, setPlanos] = useState<PlanoResumido[]>([])
  const [atual, setAtual] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const [visivel, setVisivel] = useState(false)
  const [respondidos, setRespondidos] = useState<Set<string>>(new Set())

  const agente = getNomeAgenteGlobal()

  const carregar = useCallback(async () => {
    if (!agente) return
    const lista = await buscarPlanosComPendencia(agente)
    const pendentes = lista.filter(p => !respondidos.has(p.id))
    setPlanos(pendentes)
    if (pendentes.length > 0) {
      setAtual(0)
      setVisivel(true)
    }
  }, [agente, respondidos])

  useEffect(() => {
    const t = setTimeout(carregar, 1500)
    return () => clearTimeout(t)
  }, [carregar])

  useEffect(() => {
    return wsOn('planejamentos_atualizados', () => {
      carregar()
    })
  }, [carregar])

  useEffect(() => {
    onPendentesChange?.(planos.length)
  }, [planos.length, onPendentesChange])

  useEffect(() => {
    if (forceOpen && planos.length > 0) {
      setVisivel(true)
    }
  }, [forceOpen, planos.length])

  async function responder(confirmado: boolean) {
    if (!agente || salvando) return
    const plano = planos[atual]
    if (!plano) return
    setSalvando(true)
    try {
      if (supabaseDisponivel) {
        const { data, error } = await supabase
          .from('planejamentos')
          .select('confirmacoes_agentes')
          .eq('id', plano.id)
          .single()
        if (error) throw new Error(error.message)
        const confirmacoes = Array.isArray(data?.confirmacoes_agentes)
          ? data.confirmacoes_agentes as ConfirmacaoAgente[]
          : []
        const restantes = confirmacoes.filter(c => !nomeCorresponde(c.agente, agente))
        restantes.push({ agente, confirmado, confirmedAt: new Date().toISOString() })
        const { error: updateError } = await supabase
          .from('planejamentos')
          .update({ confirmacoes_agentes: restantes })
          .eq('id', plano.id)
        if (updateError) throw new Error(updateError.message)
      } else {
        await fetch(`/api/planejamentos/${plano.id}/confirmar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agente,
            confirmado,
            criador: plano.criadoPor,
          }),
        })
      }
      const novosRespondidos = new Set(respondidos).add(plano.id)
      setRespondidos(novosRespondidos)
      const restantes = planos.filter(p => !novosRespondidos.has(p.id))
      setPlanos(restantes)
      if (restantes.length === 0) {
        setVisivel(false)
      } else {
        setAtual(0)
      }
    } catch {
      // silencioso
    } finally {
      setSalvando(false)
    }
  }

  function adiar() {
    if (planos.length <= 1) {
      setVisivel(false)
      return
    }
    setAtual(prev => (prev + 1) % planos.length)
  }

  if (!visivel || planos.length === 0) return null
  const plano = planos[atual]
  if (!plano) return null

  const cfg = TIPOS_CONFIG[plano.tipo] ?? { label: plano.tipo, emoji: '📋', cor: '#1a4b8c' }

  return (
    <>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '0 0 env(safe-area-inset-bottom,0)',
      }} onClick={e => { if (e.target === e.currentTarget) adiar() }}>
        <div style={{
          background: 'white',
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.35)',
          animation: 'slideUpConv 0.32s cubic-bezier(.22,1,.36,1)',
        }}>
          {/* Cabeçalho colorido */}
          <div style={{
            background: `linear-gradient(120deg, ${cfg.cor}, ${cfg.cor}dd)`,
            borderRadius: '20px 20px 0 0',
            padding: '1.1rem 1.25rem 0.9rem',
            color: 'white',
            position: 'relative',
          }}>
            {planos.length > 1 && (
              <div style={{
                position: 'absolute', top: '0.75rem', right: '1rem',
                background: 'rgba(255,255,255,0.25)',
                borderRadius: 20, padding: '0.1rem 0.6rem',
                fontSize: '0.7rem', fontWeight: 700,
              }}>
                {atual + 1} / {planos.length}
              </div>
            )}
            <div style={{ fontSize: '0.7rem', fontWeight: 600, opacity: 0.85, marginBottom: '0.25rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              📣 Você foi convocado
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.7rem' }}>{cfg.emoji}</span>
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.2 }}>{plano.nome}</div>
                <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '0.15rem' }}>{cfg.label} · por {plano.criadoPor}</div>
              </div>
            </div>
          </div>

          {/* Corpo */}
          <div style={{ padding: '1rem 1.25rem' }}>
            {/* Infos do evento */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '1rem' }}>
              {plano.dataInicio && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <span>📅</span>
                  <span style={{ fontWeight: 700, color: '#1f2937' }}>
                    {formatarData(plano.dataInicio)}
                    {plano.horario && ` às ${plano.horario}`}
                    {plano.horarioFim && ` — ${plano.horarioFim}`}
                  </span>
                </div>
              )}
              {plano.local && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <span>📍</span>
                  <span style={{ color: '#374151' }}>{plano.local}</span>
                </div>
              )}
              {plano.descricao && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <span style={{ marginTop: '0.05rem' }}>📝</span>
                  <span style={{ color: '#6b7280', lineHeight: 1.4 }}>{plano.descricao}</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                <span>🧑‍🚒</span>
                <span style={{ color: '#374151' }}>
                  {plano.agentesDefesaCivil.length} agente{plano.agentesDefesaCivil.length !== 1 ? 's' : ''} escalado{plano.agentesDefesaCivil.length !== 1 ? 's' : ''}
                  {plano.confirmacoes.filter(c => c.confirmado).length > 0 && (
                    <span style={{ color: '#059669', fontWeight: 700 }}>
                      {' · '}{plano.confirmacoes.filter(c => c.confirmado).length} já confirmou
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Pergunta */}
            <div style={{
              background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
              border: '1.5px solid #bae6fd',
              borderRadius: 12,
              padding: '0.75rem 1rem',
              textAlign: 'center',
              marginBottom: '1rem',
            }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.15rem' }}>
                Você confirma presença nesta atividade?
              </div>
              <div style={{ fontSize: '0.73rem', color: '#0284c7' }}>
                O coordenador será notificado da sua resposta
              </div>
            </div>

            {/* Botões de ação */}
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.5rem' }}>
              <button
                onClick={() => responder(false)}
                disabled={salvando}
                style={{
                  flex: 1, padding: '0.75rem', borderRadius: 12,
                  background: '#fee2e2', color: '#dc2626',
                  border: '1.5px solid #fca5a5',
                  fontSize: '0.88rem', fontWeight: 800, cursor: salvando ? 'wait' : 'pointer',
                  opacity: salvando ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                }}
              >
                ❌ Não vou
              </button>
              <button
                onClick={() => responder(true)}
                disabled={salvando}
                style={{
                  flex: 1.6, padding: '0.75rem', borderRadius: 12,
                  background: 'linear-gradient(90deg, #065f46, #059669)',
                  color: 'white', border: 'none',
                  fontSize: '0.88rem', fontWeight: 800, cursor: salvando ? 'wait' : 'pointer',
                  opacity: salvando ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                  boxShadow: '0 2px 8px rgba(5,150,105,0.4)',
                }}
              >
                {salvando ? '⏳ Salvando...' : '✅ Confirmo presença'}
              </button>
            </div>

            {/* Adiar */}
            <button
              onClick={adiar}
              style={{
                width: '100%', padding: '0.5rem',
                background: 'transparent', border: 'none',
                color: '#9ca3af', fontSize: '0.78rem', cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {planos.length > 1 ? `Ver próxima (${planos.length - 1} pendente${planos.length - 1 !== 1 ? 's' : ''})` : 'Responder depois'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideUpConv {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
