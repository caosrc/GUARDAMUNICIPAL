import { useState, useRef, useEffect } from 'react'
import { AGENTES } from '../types'

const LOGIN_KEY = 'defesacivil-logado'
const AGENTE_SESSION_KEY = 'defesacivil-agente-sessao'
const AGENTE_NOME_KEY = 'defesacivil-device-nome'
const USUARIO_CORRETO = 'defesacivilob@gmail.com'
const SENHA_CORRETA = 'dc-2026'

export function estaLogado(): boolean {
  return localStorage.getItem(LOGIN_KEY) === '1'
}

export function agenteEscolhido(): boolean {
  return !!sessionStorage.getItem(AGENTE_SESSION_KEY)
}

export function fazerLogout() {
  localStorage.removeItem(LOGIN_KEY)
  sessionStorage.removeItem(AGENTE_SESSION_KEY)
}

export function getAgenteLogado(): string {
  return sessionStorage.getItem(AGENTE_SESSION_KEY) || localStorage.getItem(AGENTE_NOME_KEY) || ''
}

interface Props {
  onLogin: () => void
  apenasAgente?: boolean
}

type Etapa = 'credenciais' | 'agente'

export default function Login({ onLogin, apenasAgente = false }: Props) {
  const [etapa, setEtapa] = useState<Etapa>(apenasAgente ? 'agente' : 'credenciais')
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const usuarioRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (etapa === 'credenciais') {
      setTimeout(() => usuarioRef.current?.focus(), 100)
    }
  }, [etapa])

  function entrar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    setTimeout(() => {
      if (
        usuario.trim().toLowerCase() === USUARIO_CORRETO &&
        senha === SENHA_CORRETA
      ) {
        localStorage.setItem(LOGIN_KEY, '1')
        setEtapa('agente')
        setCarregando(false)
      } else {
        setErro('Usuário ou senha incorretos.')
        setSenha('')
        setCarregando(false)
      }
    }, 600)
  }

  function selecionarAgente(nome: string) {
    sessionStorage.setItem(AGENTE_SESSION_KEY, nome)
    localStorage.setItem(AGENTE_NOME_KEY, nome)
    onLogin()
  }

  if (etapa === 'agente') {
    return (
      <div className="login-tela">
        <div className="login-box login-box--agente">
          <div className="login-logo-wrap">
            <img src="/logo-dc.jpg" alt="Defesa Civil Ouro Branco" className="login-logo" />
          </div>
          <div className="login-titulo">Defesa Civil</div>
          <div className="login-subtitulo">Ouro Branco — MG</div>

          <div className="login-agente-titulo">Quem está acessando?</div>
          <div className="login-agente-grid">
            {AGENTES.map((nome) => (
              <button
                key={nome}
                className="login-agente-btn"
                onClick={() => selecionarAgente(nome)}
              >
                {nome}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="login-tela">
      <div className="login-box">
        <div className="login-logo-wrap">
          <img src="/logo-dc.jpg" alt="Defesa Civil Ouro Branco" className="login-logo" />
        </div>
        <div className="login-titulo">Defesa Civil</div>
        <div className="login-subtitulo">Ouro Branco — MG</div>

        <form className="login-form" onSubmit={entrar} autoComplete="off">
          <div className="login-campo">
            <label className="login-label">Usuário</label>
            <input
              ref={usuarioRef}
              className={`login-input${erro ? ' login-input-erro' : ''}`}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="email@exemplo.com"
              value={usuario}
              onChange={(e) => { setUsuario(e.target.value); setErro('') }}
            />
          </div>

          <div className="login-campo">
            <label className="login-label">Senha</label>
            <input
              className={`login-input${erro ? ' login-input-erro' : ''}`}
              type="password"
              placeholder="••••••••"
              value={senha}
              onChange={(e) => { setSenha(e.target.value); setErro('') }}
            />
          </div>

          {erro && <div className="login-erro">{erro}</div>}

          <button
            className="login-btn"
            type="submit"
            disabled={carregando || !usuario.trim() || !senha}
          >
            {carregando ? '⏳ Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
