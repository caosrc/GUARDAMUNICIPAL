import { useEffect, useState } from 'react'
import { getAgenteLogado } from './Login'
import { wsOn } from '../wsClient'
import { supabase, supabaseDisponivel } from '../supabaseClient'

interface NotificacaoRadar {
  id: string
  texto: string
  data: string
  hora: string
  prioridade: string
  criadoPor: string
  tipo: 'confirmacao' | 'eventoHoje'
  confirmacoesAgentes: Array<{ agente: string; confirmado: boolean }>
}

function tocarSininho() {
  try {
    if (!window.AudioContext) return
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

function formatarData(data: string) {
  if (!data) return 'Data não informada'
  const [ano, mes, dia] = data.split('-')
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : data
}

function dataLocalISO(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function lerConfirmacoes(valor: unknown): Array<{ agente: string; confirmado: boolean }> {
  let dados = valor
  if (typeof dados === 'string') {
    try { dados = JSON.parse(dados) } catch { return [] }
  }
  if (!Array.isArray(dados)) return []
  return dados
    .filter(item => item && typeof item === 'object' && typeof item.agente === 'string')
    .map(item => ({ agente: String(item.agente), confirmado: item.confirmado === true }))
}

export default function BannerRadarNotificacao() {
  const [fila, setFila] = useState<NotificacaoRadar[]>([])
  const [respondendo, setRespondendo] = useState(false)
  const agente = getAgenteLogado() || ''

  useEffect(() => {
    let ativo = true
    const buscarPendentes = async () => {
      try {
        let rows: Array<Record<string, unknown>> = []
        if (supabaseDisponivel) {
          const result = await supabase
            .from('radar_bilhetes')
            .select('id,texto,data,hora,prioridade,criado_por,tipo,agentes_envolvidos,confirmacoes_agentes')
            .eq('concluido', false)
            .eq('tipo', 'notificacao')
            .order('criado_em', { ascending: false })
          if (result.error) throw result.error
          rows = (result.data || []) as Array<Record<string, unknown>>
        } else {
          const response = await fetch('/api/radar-bilhetes')
          if (!response.ok) return
          rows = await response.json() as Array<Record<string, unknown>>
        }

        const hoje = dataLocalISO()
        const novas: NotificacaoRadar[] = []
        rows.forEach(row => {
          if (row.tipo !== 'notificacao') return
          const envolvidos = Array.isArray(row.agentes_envolvidos)
            ? row.agentes_envolvidos.map(String)
            : Array.isArray(row.agentesEnvolvidos) ? row.agentesEnvolvidos.map(String) : []
          if (Boolean(row.concluido) || !agente || !envolvidos.includes(agente)) return
          const confirmacoesAgentes = lerConfirmacoes(row.confirmacoes_agentes)
          const minhaConfirmacao = confirmacoesAgentes.find(item => item.agente === agente)
          const base = {
            id: String(row.id),
             texto: String(row.texto || 'Nova convocação no Radar DC'),
            data: String(row.data || ''),
            hora: String(row.hora || ''),
            prioridade: String(row.prioridade || 'normal'),
             criadoPor: String(row.criado_por || row.criadoPor || 'Equipe Defesa Civil'),
            confirmacoesAgentes,
          }

          if (!minhaConfirmacao) {
            novas.push({ ...base, tipo: 'confirmacao' })
            return
          }

          const lembreteDoDia = minhaConfirmacao.confirmado && base.data === hoje
          const chaveDoDia = `defesacivil-radar-evento-dia-${base.id}-${hoje}`
          if (lembreteDoDia && !localStorage.getItem(chaveDoDia)) {
            localStorage.setItem(chaveDoDia, '1')
            novas.push({ ...base, tipo: 'eventoHoje' })
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('📅 Radar DC — evento hoje', {
                body: `${base.hora || 'Horário não informado'} · ${base.texto}`,
                tag: `radar-evento-dia-${base.id}-${hoje}`,
              })
            }
          }
        })

        if (!ativo) return
        let entrouNaFila = false
        setFila(prev => {
          const chavesNovas = new Set(novas.map(nova => `${nova.id}-${nova.tipo}`))
          const entradas = novas.filter(nova => !prev.some(item => item.id === nova.id && item.tipo === nova.tipo))
          entrouNaFila = entradas.length > 0
          return [
            ...prev.filter(item => chavesNovas.has(`${item.id}-${item.tipo}`)),
            ...entradas,
          ]
        })
        if (entrouNaFila) {
          tocarSininho()
        }
      } catch { /* realtime/servidor pode estar temporariamente indisponível */ }
    }

    const off = wsOn('radar_notificacao_agente', (mensagem) => {
      if (mensagem.registroTipo !== 'notificacao') return
      const envolvidos = Array.isArray(mensagem.agentesEnvolvidos)
        ? mensagem.agentesEnvolvidos.map(String)
        : []
      if (!agente || !envolvidos.includes(agente) || String(mensagem.criadoPor) === agente) return

      const nova: NotificacaoRadar = {
        id: String(mensagem.id || `${mensagem.data}-${mensagem.hora}-${mensagem.texto}`),
        texto: String(mensagem.texto || 'Nova convocação no Radar DC'),
        data: String(mensagem.data || ''),
        hora: String(mensagem.hora || ''),
        prioridade: String(mensagem.prioridade || 'normal'),
        criadoPor: String(mensagem.criadoPor || 'Equipe Defesa Civil'),
        tipo: 'confirmacao',
        confirmacoesAgentes: [],
      }
      setFila(prev => prev.some(item => item.id === nova.id && item.tipo === nova.tipo) ? prev : [...prev, nova])
      tocarSininho()
    })
    buscarPendentes()
    const timer = window.setInterval(buscarPendentes, 10000)
    return () => { ativo = false; off(); window.clearInterval(timer) }
  }, [agente])

  function fecharAtual() {
    setFila(prev => prev.slice(1))
  }

  function abrirRadar() {
    window.dispatchEvent(new CustomEvent('dc:abrir-radar'))
    if (atual?.tipo === 'eventoHoje') fecharAtual()
  }

  async function responder(confirmado: boolean) {
    const atual = fila[0]
    if (!atual || atual.tipo !== 'confirmacao' || !agente || respondendo) return
    setRespondendo(true)
    try {
      if (supabaseDisponivel) {
        const { data, error } = await supabase
          .from('radar_bilhetes')
          .select('confirmacoes_agentes')
          .eq('id', atual.id)
          .single()
        if (error) throw new Error(error.message)
        const confirmacoes = Array.isArray(data?.confirmacoes_agentes)
          ? data.confirmacoes_agentes as Array<{ agente: string; confirmado: boolean }>
          : []
        const novas = confirmacoes.filter(item => item.agente !== agente)
        novas.push({ agente, confirmado })
        const { error: updateError } = await supabase
          .from('radar_bilhetes')
          .update({ confirmacoes_agentes: novas })
          .eq('id', atual.id)
        if (updateError) throw new Error(updateError.message)
      } else {
        const response = await fetch(`/api/radar-bilhetes/${encodeURIComponent(atual.id)}/confirmar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agente, confirmado }),
        })
        if (!response.ok) {
          const detalhe = await response.json().catch(() => null) as { error?: string } | null
          throw new Error(detalhe?.error || 'Não foi possível registrar sua resposta.')
        }
      }
      if (confirmado && atual.data === dataLocalISO()) {
        localStorage.setItem(`defesacivil-radar-evento-dia-${atual.id}-${dataLocalISO()}`, '1')
      }
      setFila(prev => prev.filter(item => item.id !== atual.id))
    } catch (error) {
      window.dispatchEvent(new CustomEvent('dc:toast', {
        detail: { mensagem: error instanceof Error ? error.message : 'Não foi possível registrar sua resposta.' },
      }))
    } finally {
      setRespondendo(false)
    }
  }

  const atual = fila[0]
  if (!atual) return null

  return (
    <div className="radar-convocacao-overlay" role="alertdialog" aria-label="Nova convocação do Radar DC">
      <div className="radar-convocacao-card">
        <div className="radar-convocacao-header">
          <span className="radar-convocacao-sino">{atual.tipo === 'eventoHoje' ? '📅' : '🔔'}</span>
          <div>
            <strong>{atual.tipo === 'eventoHoje' ? 'Evento hoje no Radar DC' : 'Você foi marcado no Radar DC'}</strong>
            <small>{atual.tipo === 'eventoHoje' ? 'Lembrete da presença confirmada' : 'Confirme se poderá comparecer'}</small>
          </div>
          {atual.tipo === 'eventoHoje' && <button type="button" className="radar-convocacao-fechar" onClick={fecharAtual} aria-label="Fechar lembrete">×</button>}
        </div>
        <div className="radar-convocacao-body">
          <div className="radar-convocacao-info">
            <span>📅 {formatarData(atual.data)}</span>
            <span>⏰ {atual.hora || 'Horário não informado'}</span>
          </div>
          <p>{atual.texto}</p>
          <small>{atual.tipo === 'eventoHoje' ? `Enviado por ${atual.criadoPor} · sua presença está confirmada` : `Enviado por ${atual.criadoPor} · prioridade ${atual.prioridade}`}</small>
        </div>
        {atual.tipo === 'confirmacao' ? (
          <div className="radar-convocacao-actions radar-convocacao-confirmacao">
            <button type="button" className="radar-convocacao-recusar" onClick={() => responder(false)} disabled={respondendo}>{respondendo ? 'Registrando...' : 'Não vou'}</button>
            <button type="button" className="radar-convocacao-aceitar" onClick={() => responder(true)} disabled={respondendo}>{respondendo ? 'Registrando...' : 'Vou participar'}</button>
          </div>
        ) : (
          <div className="radar-convocacao-actions">
            <button type="button" className="radar-convocacao-abrir" onClick={abrirRadar}>Abrir Radar DC</button>
          </div>
        )}
        {fila.length > 1 && <div className="radar-convocacao-fila">+ {fila.length - 1} notificação(ões) aguardando</div>}
      </div>
    </div>
  )
}