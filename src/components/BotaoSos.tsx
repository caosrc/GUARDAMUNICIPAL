import { useEffect, useRef, useState } from 'react'
import { dispararSos, type StatusSos, type DisparoEmCurso } from '../sos'
import { wsSend, wsOn } from '../wsClient'
import './BotaoSos.css'
import { normalizarNomeAgente } from '../types'

function getNomeAgente(): string {
  const nome = (
    sessionStorage.getItem('defesacivil-agente-sessao') ||
    localStorage.getItem('defesacivil-agente') ||
    'Agente'
  )
  return normalizarNomeAgente(nome)
}

const SEGURAR_MS = 1500
const VOLUME_HOLD_MS = 3000
const COOLDOWN_MS = 30000

interface Props {
  modo?: 'fab' | 'botao'
}

export default function BotaoSos({ modo = 'fab' }: Props) {
  const [aberto, setAberto] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [idEnviado, setIdEnviado] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [volumeProgresso, setVolumeProgresso] = useState(0)
  const [avisoRapido, setAvisoRapido] = useState<string | null>(null)
  const [statusSos, setStatusSos] = useState<StatusSos | null>(null)
  const [visualizadores, setVisualizadores] = useState<string[]>([])
  const [mensagensRecebidas, setMensagensRecebidas] = useState<{agente: string; texto: string; audio?: string | null; ts: number}[]>([])
  const msgsFabRef = useRef<HTMLDivElement>(null)
  const seguraRef = useRef<{ start: number; raf: number; timer: number } | null>(null)
  const volumeRef = useRef<{ start: number; raf: number; timer: number } | null>(null)
  const ultimoDisparoRef = useRef<number>(0)
  const disparoRef = useRef<DisparoEmCurso | null>(null)

  async function disparar() {
    setEnviando(true)
    setErro('')
    setStatusSos(null)
    setEnviado(false)
    setIdEnviado(null)
    const disparo = dispararSos(getNomeAgente(), (s) => setStatusSos(s))
    disparoRef.current = disparo
    try {
      // Mostra "enviado" assim que o SOS for transmitido (sem esperar o áudio)
      const alertaInicial = await disparo.alertaEnviado
      if (alertaInicial) {
        setIdEnviado(alertaInicial.id)
        setEnviado(true)
        setEnviando(false)
      } else {
        // abortado antes de enviar
        setEnviando(false)
        disparoRef.current = null
        return
      }
      // Aguarda o áudio em segundo plano (não bloqueia a UI)
      await disparo.alerta
    } catch (e: any) {
      setErro(e?.message || 'Falha ao enviar SOS')
      setEnviando(false)
    } finally {
      disparoRef.current = null
    }
  }

  // Disparo automático via botão de volume — abre painel direto na gravação.
  // Respeita cooldown de 30s para não disparar duas vezes seguidas.
  async function dispararAutomatico(origem: 'volume') {
    const agora = Date.now()
    if (agora - ultimoDisparoRef.current < COOLDOWN_MS) return
    ultimoDisparoRef.current = agora
    setAvisoRapido('🆘 SOS pelo volume…')
    setTimeout(() => setAvisoRapido(null), 3500)
    setAberto(true)
    setConfirmando(false)
    await disparar()
  }

  // Escuta sos-visualizado para atualizar a lista de quem viu o SOS enviado
  useEffect(() => {
    if (!idEnviado) return
    const off = wsOn('sos-visualizado', (msg) => {
      const { id, visualizadores: vizs } = msg as { id: string; visualizadores: string[] }
      if (id === idEnviado && Array.isArray(vizs)) {
        setVisualizadores(vizs)
      }
    })
    return off
  }, [idEnviado])

  // Escuta mensagens enviadas pelos receptores
  useEffect(() => {
    if (!idEnviado) return
    // sos-nova-mensagem: enviado pelo servidor Express com a lista completa atualizada
    const offNova = wsOn('sos-nova-mensagem', (msg) => {
      const { id, mensagens } = msg as { id: string; mensagens: {agente: string; texto: string; audio?: string | null; ts: number}[] }
      if (id === idEnviado && Array.isArray(mensagens)) {
        setMensagensRecebidas(mensagens)
      }
    })
    // sos-mensagem: recebido diretamente via Supabase Realtime (sem servidor Express)
    const offDireto = wsOn('sos-mensagem', (msg) => {
      const { id, agente, texto, audio, ts } = msg as Record<string, unknown>
      if (id !== idEnviado) return
      setMensagensRecebidas(prev => {
        if (prev.some(m => m.ts === (ts as number) && m.agente === agente)) return prev
        return [...prev, { agente: agente as string, texto: (texto as string) || '', audio: (audio as string | null) ?? null, ts: ts as number }]
      })
    })
    return () => { offNova(); offDireto() }
  }, [idEnviado])

  // Auto-scroll ao chegar nova mensagem
  useEffect(() => {
    if (msgsFabRef.current) {
      msgsFabRef.current.scrollTop = msgsFabRef.current.scrollHeight
    }
  }, [mensagensRecebidas.length])

  function fechar() {
    // Se ainda estiver gravando/enviando, aborta antes de fechar.
    if (disparoRef.current) {
      try { disparoRef.current.abortar() } catch {}
      disparoRef.current = null
    }
    setAberto(false)
    setConfirmando(false)
    limparSegurar()
    setEnviado(false)
    setEnviando(false)
    setIdEnviado(null)
    setErro('')
    setStatusSos(null)
    setVisualizadores([])
    setMensagensRecebidas([])
  }

  // Cancela a gravação ANTES dela terminar — nada é enviado para os outros.
  function cancelarGravacao() {
    if (disparoRef.current) {
      try { disparoRef.current.abortar() } catch {}
      disparoRef.current = null
    }
    fechar()
  }

  // Cancela um SOS já enviado — manda mensagem de cancelamento aos outros.
  function cancelarSosEnviado() {
    if (idEnviado) {
      try { wsSend({ tipo: 'sos-cancelar', id: idEnviado }) } catch {}
    }
    fechar()
  }

  function limparSegurar() {
    if (!seguraRef.current) return
    cancelAnimationFrame(seguraRef.current.raf)
    clearTimeout(seguraRef.current.timer)
    seguraRef.current = null
    setProgresso(0)
  }

  function comecarSegurar() {
    if (enviando || enviado) return
    const start = performance.now()
    const tick = () => {
      const pct = Math.min(1, (performance.now() - start) / SEGURAR_MS)
      setProgresso(pct)
      if (pct < 1 && seguraRef.current) {
        seguraRef.current.raf = requestAnimationFrame(tick)
      }
    }
    const raf = requestAnimationFrame(tick)
    const timer = window.setTimeout(() => {
      limparSegurar()
      disparar()
    }, SEGURAR_MS)
    seguraRef.current = { start, raf, timer }
  }

  // Volume menos — segurar 3 segundos dispara SOS direto.
  // Aviso: a maioria dos navegadores em celular NÃO recebe esse evento
  // porque o sistema operacional intercepta os botões físicos.
  useEffect(() => {
    function limparVolume() {
      if (!volumeRef.current) return
      cancelAnimationFrame(volumeRef.current.raf)
      clearTimeout(volumeRef.current.timer)
      volumeRef.current = null
      setVolumeProgresso(0)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'AudioVolumeDown') return
      e.preventDefault()
      if (e.repeat || volumeRef.current) return
      const start = performance.now()
      const tick = () => {
        const pct = Math.min(1, (performance.now() - start) / VOLUME_HOLD_MS)
        setVolumeProgresso(pct)
        if (pct < 1 && volumeRef.current) {
          volumeRef.current.raf = requestAnimationFrame(tick)
        }
      }
      const raf = requestAnimationFrame(tick)
      const timer = window.setTimeout(() => {
        limparVolume()
        dispararAutomatico('volume')
      }, VOLUME_HOLD_MS)
      volumeRef.current = { start, raf, timer }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'AudioVolumeDown') {
        if (volumeRef.current) {
          cancelAnimationFrame(volumeRef.current.raf)
          clearTimeout(volumeRef.current.timer)
          volumeRef.current = null
          setVolumeProgresso(0)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (volumeRef.current) {
        cancelAnimationFrame(volumeRef.current.raf)
        clearTimeout(volumeRef.current.timer)
        volumeRef.current = null
      }
    }
  }, [])


  return (
    <>
      {/* Aviso rápido quando SOS dispara por volume ou chacoalhar */}
      {avisoRapido && (
        <div className="sos-volume-indicator">
          <div className="sos-volume-fill" style={{ width: '100%' }} />
          <span className="sos-volume-txt">{avisoRapido}</span>
        </div>
      )}

      {/* Indicador visual quando volume menos está sendo segurado */}
      {volumeProgresso > 0 && !avisoRapido && (
        <div className="sos-volume-indicator">
          <div className="sos-volume-fill" style={{ width: `${volumeProgresso * 100}%` }} />
          <span className="sos-volume-txt">
            🆘 Segure… {Math.round(volumeProgresso * 100)}%
          </span>
        </div>
      )}

      <button
        className={modo === 'fab' ? 'sos-fab' : 'sos-botao-inline'}
        title="SOS Crítico — toque para abrir"
        onClick={() => { setAberto(true); setConfirmando(true) }}
        aria-label="SOS Crítico"
      >
        🆘{modo === 'botao' && <span className="sos-botao-inline-txt"> SOS</span>}
      </button>

      {aberto && (
        <div
          className={modo === 'botao' ? 'sos-fab-modal sos-fab-modal--mapa' : 'sos-fab-modal'}
          onClick={() => { if (!enviando && !enviado) fechar() }}
        >
          <div className={modo === 'botao' ? 'sos-fab-painel sos-fab-painel--mapa' : 'sos-fab-painel'} onClick={(e) => e.stopPropagation()}>
            <div className="sos-fab-tit">🆘 SOS CRÍTICO</div>

            {enviado || enviando ? (
              <>
                {enviado ? (
                  <>
                    <div className="sos-fab-ok">✅ Alerta enviado a todos os agentes</div>
                    <div className="sos-fab-vizs">
                      {visualizadores.length === 0 ? (
                        <span className="sos-fab-vizs-aguardo">👁️ Aguardando visualizações…</span>
                      ) : (
                        <span className="sos-fab-vizs-lista">
                          👁️ Visto por: <strong>{visualizadores.join(', ')}</strong>
                        </span>
                      )}
                    </div>

                    <div className="sos-fab-chat">
                      <div className="sos-fab-chat-titulo">💬 Mensagens dos agentes</div>
                      {mensagensRecebidas.length === 0 ? (
                        <div className="sos-fab-chat-vazio">Nenhuma mensagem ainda…</div>
                      ) : (
                        <div className="sos-fab-chat-msgs" ref={msgsFabRef}>
                          {mensagensRecebidas.map((m, i) => {
                            const d = new Date(m.ts)
                            const hora = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
                            return (
                              <div key={i} className="sos-fab-chat-msg">
                                <span className="sos-fab-chat-hora">{hora}</span>
                                <strong className="sos-fab-chat-agente">{m.agente}</strong>
                                {m.audio
                                  ? <audio controls src={m.audio} style={{ height: 32, maxWidth: '100%', marginTop: 4 }} />
                                  : <span className="sos-fab-chat-txt">{m.texto}</span>
                                }
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : statusSos?.fase === 'gravando' ? (
                  <div className="sos-fab-gravando" style={{ marginTop: 10 }}>
                    <div className="sos-fab-gravando-dot" />
                    <div className="sos-fab-gravando-txt">
                      🎙️ Gravando mensagem… <strong>{statusSos.segundosRestantes ?? 10}s</strong>
                    </div>
                    <div className="sos-fab-gravando-sub">
                      Fale o que está acontecendo.
                    </div>
                  </div>
                ) : statusSos?.fase === 'audio_falhou' ? (
                  <div className="sos-fab-audio-falhou">
                    ⚠️ Sem permissão de microfone — enviando alerta sem áudio…
                  </div>
                ) : (
                  <div className="sos-fab-enviando">📡 Enviando alerta…</div>
                )}

                {/* Botão de abortar a gravação (não envia nada para os outros) */}
                {!enviado && statusSos?.fase === 'gravando' && (
                  <button
                    className="sos-fab-cancelar sos-fab-cancelar--falso"
                    onClick={cancelarGravacao}
                    style={{ marginTop: 10 }}
                  >
                    🚫 Cancelar gravação (não enviar SOS)
                  </button>
                )}

                {/* Botão de "falso alarme" — só aparece DEPOIS que o SOS já foi enviado */}
                {enviado && (
                  <button
                    className="sos-fab-cancelar sos-fab-cancelar--falso"
                    onClick={cancelarSosEnviado}
                    style={{ marginTop: 10 }}
                  >
                    🚫 Falso alarme — cancelar para todos
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  className="sos-fab-disparar"
                  disabled={enviando}
                  onMouseDown={comecarSegurar}
                  onMouseUp={limparSegurar}
                  onMouseLeave={limparSegurar}
                  onTouchStart={(e) => { e.preventDefault(); comecarSegurar() }}
                  onTouchEnd={limparSegurar}
                  onTouchCancel={limparSegurar}
                >
                  <span className="sos-fab-disparar-fill" style={{ transform: `scaleX(${progresso})` }} />
                  <span className="sos-fab-disparar-txt">
                    {progresso > 0 ? `Segure… ${Math.round(progresso * 100)}%` : '👆 Segure 1,5s para disparar'}
                  </span>
                </button>
                <button className="sos-fab-cancelar" onClick={fechar} disabled={enviando}>
                  Cancelar
                </button>
                {erro && <div className="sos-fab-erro">⚠️ {erro}</div>}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
