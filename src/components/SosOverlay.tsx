import { useEffect, useRef, useState } from 'react'
import { useSosListener, tocarSirene, pararSirene, vibrarLongo, rotaParaResgate, iniciarGravacaoAudio, type SosAlerta, type GravacaoHandle } from '../sos'
import { wsSend, wsOnOpen } from '../wsClient'
import { getAgenteLogado } from './Login'
import './SosOverlay.css'

function formatarHoraMsg(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function formatarHora(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function tempoDecorrido(ts: number, agora: number) {
  const seg = Math.max(0, Math.floor((agora - ts) / 1000))
  if (seg < 60) return `há ${seg}s`
  const min = Math.floor(seg / 60)
  if (min < 60) return `há ${min}min`
  return `há ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

export default function SosOverlay() {
  const { alertas, dispensar } = useSosListener()
  const [agora, setAgora] = useState(Date.now())
  const tocandoRef = useRef(false)

  useEffect(() => {
    if (alertas.length > 0 && !tocandoRef.current) {
      tocarSirene()
      vibrarLongo()
      tocandoRef.current = true
    }
    if (alertas.length === 0 && tocandoRef.current) {
      pararSirene()
      tocandoRef.current = false
    }
  }, [alertas.length])

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => () => pararSirene(), [])

  if (alertas.length === 0) return null

  return (
    <div className="sos-overlay">
      {alertas.map((a) => (
        <SosCard
          key={a.id}
          alerta={a}
          agora={agora}
          onDispensar={() => dispensar(a.id)}
          onSilenciar={() => { pararSirene(); tocandoRef.current = false }}
        />
      ))}
    </div>
  )
}

function SosCard({
  alerta,
  agora,
  onDispensar,
  onSilenciar,
}: {
  alerta: SosAlerta
  agora: number
  onDispensar: () => void
  onSilenciar: () => void
}) {
  const temGps = alerta.lat != null && alerta.lng != null
  const [textoMsg, setTextoMsg] = useState('')
  const [modoResposta, setModoResposta] = useState<'texto' | 'audio'>('texto')
  const [gravando, setGravando] = useState(false)
  const [segundos, setSegundos] = useState(10)
  const [audioGravado, setAudioGravado] = useState<string | null>(null)
  const gravacaoRef = useRef<GravacaoHandle | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const agente = getAgenteLogado()
    if (agente) {
      wsSend({ tipo: 'sos-visualizar', id: alerta.id, agente })
    }
    const offOpen = wsOnOpen(() => {
      const ag = getAgenteLogado()
      if (ag) wsSend({ tipo: 'sos-visualizar', id: alerta.id, agente: ag })
    })
    return offOpen
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerta.id])

  useEffect(() => {
    if (msgsRef.current) {
      msgsRef.current.scrollTop = msgsRef.current.scrollHeight
    }
  }, [alerta.mensagens?.length])

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      if (gravacaoRef.current) try { gravacaoRef.current.abortar() } catch {}
    }
  }, [])

  function enviarMensagemTexto() {
    const agente = getAgenteLogado()
    const txt = textoMsg.trim()
    if (!txt || !agente) return
    wsSend({ tipo: 'sos-mensagem', id: alerta.id, agente, texto: txt, ts: Date.now() })
    setTextoMsg('')
  }

  async function iniciarGravacao() {
    const agente = getAgenteLogado()
    if (!agente) return
    setGravando(true)
    setSegundos(10)
    setAudioGravado(null)

    const handle = await iniciarGravacaoAudio(10000)
    if (!handle) {
      setGravando(false)
      return
    }
    gravacaoRef.current = handle

    let rest = 10
    tickRef.current = setInterval(() => {
      rest -= 1
      setSegundos(rest)
      if (rest <= 0 && tickRef.current) clearInterval(tickRef.current)
    }, 1000)

    const audio = await handle.audioPromise
    if (tickRef.current) clearInterval(tickRef.current)
    setGravando(false)
    gravacaoRef.current = null

    if (audio) {
      setAudioGravado(audio)
    }
  }

  function cancelarGravacao() {
    if (tickRef.current) clearInterval(tickRef.current)
    if (gravacaoRef.current) try { gravacaoRef.current.abortar() } catch {}
    gravacaoRef.current = null
    setGravando(false)
    setAudioGravado(null)
  }

  function enviarAudio() {
    const agente = getAgenteLogado()
    if (!audioGravado || !agente) return
    wsSend({ tipo: 'sos-mensagem', id: alerta.id, agente, texto: '', audio: audioGravado, ts: Date.now() })
    setAudioGravado(null)
    setModoResposta('texto')
  }

  function descartarAudio() {
    setAudioGravado(null)
  }

  return (
    <div className="sos-card">
      <div className="sos-card-pisca" />
      <div className="sos-card-conteudo">
        <div className="sos-card-titulo">
          <span className="sos-icone">🚨</span>
          <div>
            <div className="sos-tit">SOS CRÍTICO</div>
            <div className="sos-sub">{alerta.agente.toUpperCase()} pediu socorro</div>
          </div>
        </div>

        <div className="sos-info">
          <div className="sos-info-linha">
            <span>🕒 Acionado às {formatarHora(alerta.timestamp)} ({tempoDecorrido(alerta.timestamp, agora)})</span>
          </div>
          {alerta.bateria != null && (
            <div className="sos-info-linha">
              <span>🔋 Bateria: <strong>{alerta.bateria}%</strong></span>
            </div>
          )}
          {temGps ? (
            <div className="sos-info-linha">
              <span>📍 GPS: <strong>{alerta.lat!.toFixed(5)}, {alerta.lng!.toFixed(5)}</strong></span>
            </div>
          ) : (
            <div className="sos-info-linha sos-info-erro">
              <span>📍 GPS indisponível</span>
            </div>
          )}
          {alerta.visualizadores && alerta.visualizadores.length > 0 && (
            <div className="sos-info-linha">
              <span>👁️ Visto por: <strong>{alerta.visualizadores.join(', ')}</strong></span>
            </div>
          )}
          {alerta.audio ? (
            <div className="sos-info-audio">
              <span>🎙️ Mensagem do agente:</span>
              <audio
                controls
                src={alerta.audio}
                preload="auto"
                onPlay={onSilenciar}
              />
            </div>
          ) : (
            <div className="sos-info-linha sos-info-aguarde">
              <span>🎙️ Sem áudio (microfone do agente não autorizado)</span>
            </div>
          )}
        </div>

        <div className="sos-chat">
          <div className="sos-chat-titulo">💬 Responder para {alerta.agente}</div>

          {(alerta.mensagens ?? []).filter(m => !(m.audio && m.agente === getAgenteLogado())).length > 0 && (
            <div className="sos-chat-msgs" ref={msgsRef}>
              {(alerta.mensagens ?? [])
                .filter(m => !(m.audio && m.agente === getAgenteLogado()))
                .map((m, i) => (
                  <div key={i} className="sos-chat-msg">
                    <span className="sos-chat-msg-hora">{formatarHoraMsg(m.ts)}</span>
                    <strong className="sos-chat-msg-agente">{m.agente}</strong>
                    {m.audio
                      ? <audio controls src={m.audio} style={{ height: 32, maxWidth: '100%', marginTop: 4, display: 'block' }} />
                      : <span className="sos-chat-msg-txt">{m.texto}</span>
                    }
                  </div>
                ))}
            </div>
          )}

          <div className="sos-chat-modo-toggle">
            <button
              className={`sos-chat-modo-btn${modoResposta === 'texto' ? ' ativo' : ''}`}
              onClick={() => { setModoResposta('texto'); cancelarGravacao() }}
            >
              💬 Texto
            </button>
            <button
              className={`sos-chat-modo-btn${modoResposta === 'audio' ? ' ativo' : ''}`}
              onClick={() => { setModoResposta('audio'); setTextoMsg('') }}
            >
              🎙️ Áudio (10s)
            </button>
          </div>

          {modoResposta === 'texto' ? (
            <div className="sos-chat-row">
              <input
                className="sos-chat-input"
                type="text"
                placeholder="Digite sua mensagem…"
                value={textoMsg}
                onChange={(e) => setTextoMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && enviarMensagemTexto()}
              />
              <button
                className="sos-chat-btn"
                onClick={enviarMensagemTexto}
                disabled={!textoMsg.trim()}
              >
                Enviar
              </button>
            </div>
          ) : (
            <div className="sos-audio-resposta">
              {!gravando && !audioGravado && (
                <button className="sos-audio-gravar-btn" onClick={iniciarGravacao}>
                  🎙️ Pressionar para gravar (10s)
                </button>
              )}
              {gravando && (
                <div className="sos-audio-gravando">
                  <div className="sos-fab-gravando-dot" style={{ display: 'inline-block', marginRight: 8 }} />
                  <span>Gravando… <strong>{segundos}s</strong></span>
                  <button className="sos-audio-cancelar-btn" onClick={cancelarGravacao}>Cancelar</button>
                </div>
              )}
              {audioGravado && !gravando && (
                <div className="sos-audio-preview">
                  <audio controls src={audioGravado} style={{ maxWidth: '100%', height: 36 }} />
                  <div className="sos-audio-preview-acoes">
                    <button className="sos-chat-btn" onClick={enviarAudio}>📤 Enviar áudio</button>
                    <button className="sos-audio-cancelar-btn" onClick={descartarAudio}>🗑️ Descartar</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sos-botoes">
          {temGps && (
            <button
              className="sos-btn sos-btn-primario"
              onClick={() => rotaParaResgate(alerta.lat!, alerta.lng!)}
            >
              🗺️ Traçar rota de resgate
            </button>
          )}
          <button className="sos-btn sos-btn-secundario" onClick={onDispensar}>
            ✅ Dispensar alerta
          </button>
        </div>
        <div className="sos-rodape">Ativo por até 1 hora ou até ser dispensado</div>
      </div>
    </div>
  )
}
