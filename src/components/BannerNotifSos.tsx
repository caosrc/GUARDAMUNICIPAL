import { useState, useEffect } from 'react'
import { pedirPermissaoEInscrever, pushSuportado } from '../pushNotifications'
import './BannerNotifSos.css'

const SESSION_DISPENSADO = 'defesacivil-notif-banner-dispensado'

type Status = 'ativo' | 'concedido' | 'negado' | 'sem-suporte' | 'desconhecido' | null

interface Props {
  statusNotif: Status
  onAtivado: () => void
  agente: string
}

function detectarNavegador(): 'ios-safari' | 'android-chrome' | 'chrome' | 'firefox' | 'edge' | 'safari' | 'outro' {
  const ua = navigator.userAgent
  const isIOS = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  const isFirefox = /Firefox/i.test(ua)
  const isEdge = /Edg\//i.test(ua)
  const isChrome = /Chrome/i.test(ua) && !isEdge
  const isSafari = /Safari/i.test(ua) && !isChrome && !isEdge

  if (isIOS && isSafari) return 'ios-safari'
  if (isIOS && isChrome) return 'chrome'
  if (isAndroid && isChrome) return 'android-chrome'
  if (isFirefox) return 'firefox'
  if (isEdge) return 'edge'
  if (isChrome) return 'chrome'
  if (isSafari) return 'safari'
  return 'outro'
}

function InstrucoesDesbloqueio() {
  const nav = detectarNavegador()

  const passos: { emoji: string; texto: string }[] = (() => {
    switch (nav) {
      case 'ios-safari':
        return [
          { emoji: '1️⃣', texto: 'Abra o app no Safari do iPhone/iPad' },
          { emoji: '2️⃣', texto: 'Toque em "Compartilhar" (ícone ↑) na barra inferior' },
          { emoji: '3️⃣', texto: 'Toque em "Adicionar à Tela de Início"' },
          { emoji: '4️⃣', texto: 'Abra o app instalado e ative as notificações' },
        ]
      case 'android-chrome':
        return [
          { emoji: '1️⃣', texto: 'Toque no ícone de cadeado 🔒 na barra de endereço' },
          { emoji: '2️⃣', texto: 'Toque em "Permissões" ou "Configurações do site"' },
          { emoji: '3️⃣', texto: 'Toque em "Notificações" e selecione "Permitir"' },
          { emoji: '4️⃣', texto: 'Atualize a página e toque em "Ativar SOS"' },
        ]
      case 'chrome':
        return [
          { emoji: '1️⃣', texto: 'Clique no cadeado 🔒 à esquerda da barra de endereço' },
          { emoji: '2️⃣', texto: 'Clique em "Notificações"' },
          { emoji: '3️⃣', texto: 'Selecione "Permitir" no menu suspenso' },
          { emoji: '4️⃣', texto: 'Atualize a página e toque em "Ativar SOS"' },
        ]
      case 'edge':
        return [
          { emoji: '1️⃣', texto: 'Clique no cadeado 🔒 na barra de endereço' },
          { emoji: '2️⃣', texto: 'Clique em "Permissões para este site"' },
          { emoji: '3️⃣', texto: 'Em "Notificações", selecione "Permitir"' },
          { emoji: '4️⃣', texto: 'Atualize a página e toque em "Ativar SOS"' },
        ]
      case 'firefox':
        return [
          { emoji: '1️⃣', texto: 'Clique no ícone de cadeado 🔒 na barra de endereço' },
          { emoji: '2️⃣', texto: 'Clique em "Limpar permissões" ou "Mais informações"' },
          { emoji: '3️⃣', texto: 'Em Permissões, remova o bloqueio de Notificações' },
          { emoji: '4️⃣', texto: 'Atualize a página e toque em "Ativar SOS"' },
        ]
      case 'safari':
        return [
          { emoji: '1️⃣', texto: 'No menu Safari, clique em "Configurações para este site"' },
          { emoji: '2️⃣', texto: 'Em "Notificações", selecione "Permitir"' },
          { emoji: '3️⃣', texto: 'Atualize a página e toque em "Ativar SOS"' },
        ]
      default:
        return [
          { emoji: '1️⃣', texto: 'Abra as configurações do seu navegador' },
          { emoji: '2️⃣', texto: 'Encontre "Permissões de site" ou "Privacidade"' },
          { emoji: '3️⃣', texto: 'Localize este endereço e permita Notificações' },
          { emoji: '4️⃣', texto: 'Atualize a página e toque em "Ativar SOS"' },
        ]
    }
  })()

  return (
    <div className="bns-instrucoes">
      <div className="bns-instrucoes-titulo">Como desbloquear notificações:</div>
      {passos.map((p, i) => (
        <div key={i} className="bns-passo">
          <span className="bns-passo-emoji">{p.emoji}</span>
          <span className="bns-passo-texto">{p.texto}</span>
        </div>
      ))}
    </div>
  )
}

export default function BannerNotifSos({ statusNotif, onAtivado, agente }: Props) {
  const [dispensado, setDispensado] = useState(false)
  const [ativando, setAtivando] = useState(false)
  const [mostrarInstrucoes, setMostrarInstrucoes] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_DISPENSADO) === '1') {
      setDispensado(true)
    }
  }, [])

  if (!pushSuportado()) return null
  if (statusNotif === 'ativo' || statusNotif === 'sem-suporte' || statusNotif === null) return null
  if (dispensado) return null

  function dispensar() {
    sessionStorage.setItem(SESSION_DISPENSADO, '1')
    setDispensado(true)
  }

  async function ativar() {
    if (ativando) return
    setAtivando(true)
    try {
      const resultado = await pedirPermissaoEInscrever(agente)
      if (resultado === 'ok') {
        onAtivado()
      } else if (resultado === 'negado') {
        setMostrarInstrucoes(true)
      }
    } finally {
      setAtivando(false)
    }
  }

  const bloqueado = statusNotif === 'negado'

  return (
    <div className={`bns-banner ${bloqueado ? 'bns-banner--bloqueado' : 'bns-banner--inativo'}`}>
      <div className="bns-cabecalho">
        <span className="bns-icone">{bloqueado ? '🔕' : '🔔'}</span>
        <div className="bns-textos">
          <strong className="bns-titulo">
            {bloqueado ? 'Notificações de SOS bloqueadas' : 'Ative as notificações de SOS'}
          </strong>
          <span className="bns-sub">
            {bloqueado
              ? 'Você não receberá alertas quando outros agentes acionarem SOS.'
              : 'Receba alertas instantâneos quando um agente acionar o SOS.'}
          </span>
        </div>
        <button className="bns-fechar" onClick={dispensar} title="Dispensar">✕</button>
      </div>

      {bloqueado ? (
        <>
          <button
            className="bns-btn-instrucoes"
            onClick={() => setMostrarInstrucoes(v => !v)}
          >
            {mostrarInstrucoes ? '▲ Ocultar instruções' : '▼ Ver como desbloquear'}
          </button>
          {mostrarInstrucoes && <InstrucoesDesbloqueio />}
        </>
      ) : (
        <button
          className="bns-btn-ativar"
          onClick={ativar}
          disabled={ativando}
        >
          {ativando ? '⏳ Ativando...' : '🔔 Ativar notificações de SOS'}
        </button>
      )}
    </div>
  )
}
