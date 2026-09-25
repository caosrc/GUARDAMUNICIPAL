import { useState, useRef, useEffect } from 'react'
import { AGENTES, normalizarNomeAgente } from '../types'

function useGeolocalizacao() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')

  function obter() {
    if (!navigator.geolocation) { setErro('GPS não disponível'); return }
    setBuscando(true)
    setErro('')
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setBuscando(false) },
      () => { setErro('Sem sinal GPS'); setBuscando(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  return { pos, buscando, erro, obter }
}

const LOGIN_KEY = 'defesacivil-logado'
const AGENTE_SESSION_KEY = 'defesacivil-agente-sessao'
const AGENTE_NOME_KEY = 'defesacivil-device-nome'
const ORGAO_SESSION_KEY = 'defesacivil-orgao-sessao'
const USUARIO_CORRETO = 'lafaiete'
const SENHA_CORRETA = '1234'

export type Orgao = 'defesa-civil' | 'curral' | 'procon'

export function estaLogado(): boolean {
  return localStorage.getItem(LOGIN_KEY) === '1'
}

export function agenteEscolhido(): boolean {
  return !!sessionStorage.getItem(AGENTE_SESSION_KEY)
}

export function orgaoEscolhido(): boolean {
  return sessionStorage.getItem(ORGAO_SESSION_KEY) === 'defesa-civil'
}

export function getOrgaoSelecionado(): Orgao | null {
  const orgao = sessionStorage.getItem(ORGAO_SESSION_KEY)
  return orgao === 'defesa-civil' ? orgao : null
}

export function selecionarOrgao(orgao: Orgao) {
  sessionStorage.setItem(ORGAO_SESSION_KEY, orgao)
}

export function fazerLogout() {
  localStorage.removeItem(LOGIN_KEY)
  sessionStorage.removeItem(AGENTE_SESSION_KEY)
  sessionStorage.removeItem(ORGAO_SESSION_KEY)
}

export function getAgenteLogado(): string {
  const nome = sessionStorage.getItem(AGENTE_SESSION_KEY) || localStorage.getItem(AGENTE_NOME_KEY) || ''
  return normalizarNomeAgente(nome)
}

interface Props {
  onLogin: () => void
  apenasAgente?: boolean
}

type Etapa = 'credenciais' | 'orgao' | 'agente'

export default function Login({ onLogin, apenasAgente = false }: Props) {
  const [etapa, setEtapa] = useState<Etapa>(
    apenasAgente ? 'agente' : 'credenciais'
  )
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
        sessionStorage.removeItem(AGENTE_SESSION_KEY)
        selecionarOrgao('defesa-civil')
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
    selecionarOrgao('defesa-civil')
    sessionStorage.setItem(AGENTE_SESSION_KEY, nome)
    localStorage.setItem(AGENTE_NOME_KEY, nome)
    onLogin()
  }

  if (etapa === 'agente') {
    return (
      <div className="login-tela">
        <div className="login-box login-box--agente">
          <div className="login-logo-wrap">
            <div className="login-insignia" aria-hidden="true">GM</div>
          </div>
          <div className="login-titulo">Guarda Municipal</div>
          <div className="login-subtitulo">Sistema operacional de campo</div>

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
            <div className="login-insignia" aria-hidden="true">GM</div>
        </div>
        <div className="login-titulo">Guarda Municipal</div>
        <div className="login-subtitulo">Sistema operacional de campo</div>

        <form className="login-form" onSubmit={entrar} autoComplete="off">
          <div className="login-campo">
            <label className="login-label">Usuário</label>
            <input
              ref={usuarioRef}
              className={`login-input${erro ? ' login-input-erro' : ''}`}
               type="text"
               inputMode="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
               placeholder="Lafaiete"
              value={usuario}
              onChange={(e) => { setUsuario(e.target.value); setErro('') }}
            />
          </div>

          <div className="login-campo">
            <label className="login-label">Senha</label>
            <input
              className={`login-input${erro ? ' login-input-erro' : ''}`}
              type="password"
              autoComplete="current-password"
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
