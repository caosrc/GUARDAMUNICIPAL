import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Registra o Service Worker para suporte offline
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Verifica atualizações do SW a cada 30 minutos
        setInterval(() => reg.update(), 30 * 60 * 1000)

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            // Novo SW instalado e pronto — recarrega silenciosamente quando a aba fica ativa
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ tipo: 'SKIP_WAITING' })
            }
          })
        })
      })
      .catch(() => {
        // falha silenciosa — app funciona sem SW
      })

    // Recarrega quando o SW muda (novo SW ativado)
    let swRefreshado = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!swRefreshado) {
        swRefreshado = true
        // não força reload automático, deixa o usuário continuar
      }
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
