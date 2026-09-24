import { useState, useEffect, useRef } from 'react'

interface Props {
  titulo: string
  senhaCorreta?: string
  onConfirmar: () => void
  onCancelar: () => void
}

const SENHA_PADRAO = '093067'

export default function ModalSenha({ titulo, senhaCorreta = SENHA_PADRAO, onConfirmar, onCancelar }: Props) {
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(false)
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  function confirmar() {
    if (senha === senhaCorreta) {
      onConfirmar()
    } else {
      setErro(true)
      setSenha('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  return (
    <div className="senha-overlay" onClick={onCancelar}>
      <div className="senha-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="senha-icone">🔒</div>
        <div className="senha-titulo">{titulo}</div>
        <div className="senha-desc">Digite a senha para liberar esta ação. Use “Mostrar” para conferir antes de confirmar.</div>
        <label className="senha-label" htmlFor="senha-autorizacao">Senha de autorização</label>
        <div className={`senha-input-wrap${erro ? ' senha-input-erro' : ''}`}>
          <input
            id="senha-autorizacao"
            ref={inputRef}
            className="senha-input"
            type={mostrarSenha ? 'text' : 'password'}
            inputMode="numeric"
            placeholder="Digite a senha"
            value={senha}
            onChange={(e) => { setSenha(e.target.value); setErro(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmar() }}
            maxLength={20}
            autoComplete="current-password"
          />
          <button
            type="button"
            className="senha-toggle"
            onClick={() => setMostrarSenha((valor) => !valor)}
            aria-label={mostrarSenha ? 'Ocultar senha digitada' : 'Mostrar senha digitada'}
          >
            {mostrarSenha ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        {erro && <div className="senha-erro">Senha incorreta. Tente novamente.</div>}
        <div className="senha-acoes">
          <button className="senha-btn-cancelar" onClick={onCancelar}>Cancelar</button>
          <button className="senha-btn-confirmar" onClick={confirmar} disabled={!senha.trim()}>Confirmar</button>
        </div>
      </div>
    </div>
  )
}
