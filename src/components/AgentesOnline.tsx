import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { wsOn } from '../wsClient'

// Mostra um pill no cabeçalho com a contagem de agentes ONLINE — qualquer
// equipe com o app aberto entra automaticamente no Presence do Supabase
// Realtime, INDEPENDENTE de GPS. Ao clicar, expande a lista com os nomes.
//
// O popover é renderizado via portal no <body> com position: fixed para
// escapar do stacking context do header (z-index: 100) — assim ele fica
// SEMPRE por cima dos menus do mapa (legenda, submenus, etc.).

interface AgenteOnline {
  id: string
  nome: string
}

export default function AgentesOnline() {
  const [agentes, setAgentes] = useState<AgenteOnline[]>([])
  const [aberto, setAberto] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const pillRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  function recalcular() {
    const r = pillRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({
      top: Math.round(r.bottom + 6),
      right: Math.round(window.innerWidth - r.right),
    })
  }

  useLayoutEffect(() => {
    if (!aberto) return
    recalcular()
    window.addEventListener('resize', recalcular)
    window.addEventListener('scroll', recalcular, true)
    return () => {
      window.removeEventListener('resize', recalcular)
      window.removeEventListener('scroll', recalcular, true)
    }
  }, [aberto])

  useEffect(() => {
    if (!aberto) return
    function onClick(e: MouseEvent) {
      const alvo = e.target as Node
      if (pillRef.current?.contains(alvo)) return
      if (popRef.current?.contains(alvo)) return
      setAberto(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [aberto])

  useEffect(() => {
    const offSync = wsOn('online_sync', (m) => {
      const lista = (m.agentes ?? []) as AgenteOnline[]
      const limpa = lista
        .filter((a) => a && a.id)
        .map((a) => ({ id: a.id, nome: a.nome || `Equipe ${a.id.slice(0, 4)}` }))
      setAgentes(limpa)
    })

    return () => { offSync() }
  }, [])

  const lista = [...agentes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  const qtd = lista.length

  return (
    <div className="agentes-online">
      <button
        ref={pillRef}
        type="button"
        className={`agentes-online-pill${qtd > 0 ? ' tem' : ''}`}
        onClick={() => setAberto(v => !v)}
        title={qtd === 0 ? 'Nenhum agente online no momento' : `${qtd} agente${qtd === 1 ? '' : 's'} online`}
      >
        <span className="ao-icone" aria-hidden>👥</span>
        <span className="ao-num">{qtd}</span>
        <span className="ao-rot">{qtd === 1 ? 'online' : 'online'}</span>
      </button>

      {aberto && pos && createPortal(
        <div
          ref={popRef}
          className="agentes-online-pop"
          style={{ top: pos.top, right: pos.right }}
        >
          <div className="ao-pop-titulo">Agentes online</div>
          {qtd === 0 ? (
            <div className="ao-pop-vazio">Nenhum agente com o app aberto no momento.</div>
          ) : (
            <ul className="ao-pop-lista">
              {lista.map(a => (
                <li key={a.id} className="ao-pop-item">
                  <span className="ao-pop-dot" />
                  <span className="ao-pop-nome">{a.nome}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="ao-pop-rodape">Atualiza em tempo real conforme cada equipe abre ou fecha o app.</div>
        </div>,
        document.body,
      )}
    </div>
  )
}
