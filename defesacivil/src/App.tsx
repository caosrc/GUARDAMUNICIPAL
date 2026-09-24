import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import './App.css'
import Login, { estaLogado, agenteEscolhido } from './components/Login'
import type { Ocorrencia, NivelRisco } from './types'
import { NATUREZA_ICONE } from './types'
import { listarOcorrencias, criarOcorrencia } from './api'
import { cacheOcorrencias, getCachedOcorrencias, getPending, removePending, countPending } from './offline'

const MapaOcorrencias = lazy(() => import('./components/MapaOcorrencias'))
const NovaOcorrencia = lazy(() => import('./components/NovaOcorrencia'))
const DetalheOcorrencia = lazy(() => import('./components/DetalheOcorrencia'))
const ChecklistViatura = lazy(() => import('./components/ChecklistViatura'))
const EscalaAgentes = lazy(() => import('./components/EscalaAgentes'))

type Aba = 'lista' | 'mapa' | 'nova' | 'viatura' | 'escala'

function dataLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hojeStr(): string {
  return dataLocal(new Date().toISOString())
}

function formatarDataExibicao(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-')
  return `${d}/${m}/${y}`
}

function NivelBadge({ nivel }: { nivel: NivelRisco }) {
  return (
    <span className={`nivel-badge nivel-${nivel}`}>
      {nivel === 'baixo' ? '🟢 Baixo' : nivel === 'medio' ? '🟡 Médio' : '🔴 Alto'}
    </span>
  )
}


const LazyFallback = () => <div className="carregando">⏳ Carregando...</div>

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function BannerInstalar() {
  const [promptEvento, setPromptEvento] = useState<BeforeInstallPromptEvent | null>(null)
  const [descartado, setDescartado] = useState(() => localStorage.getItem('pwa-instalar-descartado') === '1')
  const [ios, setIos] = useState(false)
  const [instalado, setInstalado] = useState(false)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    setInstalado(standalone)
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone)

    const handler = (e: Event) => {
      e.preventDefault()
      setPromptEvento(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    const instaladoHandler = () => {
      setInstalado(true)
      setDescartado(true)
      localStorage.setItem('pwa-instalar-descartado', '1')
    }
    window.addEventListener('appinstalled', instaladoHandler)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', instaladoHandler)
    }
  }, [])

  if (instalado || descartado || (!promptEvento && !ios)) return null

  async function instalar() {
    if (!promptEvento) {
      setDescartado(true)
      localStorage.setItem('pwa-instalar-descartado', '1')
      return
    }
    await promptEvento.prompt()
    const { outcome } = await promptEvento.userChoice
    if (outcome === 'accepted') {
      setDescartado(true)
      localStorage.setItem('pwa-instalar-descartado', '1')
    }
    setPromptEvento(null)
  }

  function descartar() {
    setDescartado(true)
    localStorage.setItem('pwa-instalar-descartado', '1')
  }

  return (
    <div className="pwa-banner">
      <div className="pwa-banner-icone">
        <img src="/logo-dc.jpg" alt="" />
      </div>
      <div className="pwa-banner-texto">
        <strong>Instale no celular</strong>
        <span>
          {ios
            ? 'No iPhone: toque em Compartilhar e depois “Adicionar à Tela de Início”.'
            : 'Crie o ícone do app na tela inicial para acessar mais rápido.'}
        </span>
      </div>
      <button className="pwa-banner-btn" onClick={instalar}>Instalar</button>
      <button className="pwa-banner-fechar" onClick={descartar}>✕</button>
    </div>
  )
}

export default function App() {
  const [logado, setLogado] = useState(estaLogado() && agenteEscolhido())
  const [aba, setAba] = useState<Aba>('lista')
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [selecionada, setSelecionada] = useState<Ocorrencia | null>(null)
  const [filtroNivel, setFiltroNivel] = useState<NivelRisco | 'todos'>('todos')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativo' | 'resolvido'>('todos')
  const [filtroData, setFiltroData] = useState<string>(hojeStr())
  const [buscando, setBuscando] = useState('')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [sincronizando, setSincronizando] = useState(false)
  const [toastMsg, setToastMsg] = useState('')

  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3500)
  }

  const atualizarPendingCount = useCallback(async () => {
    const n = await countPending()
    setPendingCount(n)
  }, [])

  const carregar = useCallback(async (forcar = false) => {
    setCarregando(true)
    let serverData: Ocorrencia[] = []
    if (navigator.onLine || forcar) {
      try {
        serverData = await listarOcorrencias()
        await cacheOcorrencias(serverData)
      } catch {
        serverData = await getCachedOcorrencias()
      }
    } else {
      serverData = await getCachedOcorrencias()
    }
    const pending = await getPending()
    const offlineItems: Ocorrencia[] = pending.map((p, i) => ({
      id: -(i + 1),
      tipo: p.tipo ?? '',
      natureza: p.natureza ?? '',
      subnatureza: p.subnatureza ?? null,
      nivel_risco: p.nivel_risco ?? 'baixo',
      status_oc: p.status_oc ?? 'ativo',
      fotos: p.fotos ?? [],
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      endereco: p.endereco ?? null,
      proprietario: p.proprietario ?? null,
      situacao: p.situacao ?? null,
      recomendacao: p.recomendacao ?? null,
      conclusao: p.conclusao ?? null,
      data_ocorrencia: p.data_ocorrencia ?? null,
      agentes: Array.isArray(p.agentes) ? p.agentes : [],
      created_at: p._savedAt ?? new Date().toISOString(),
      _offline: true,
      _localId: p.localId,
    }))
    setOcorrencias([...offlineItems, ...serverData])
    setCarregando(false)
    await atualizarPendingCount()
  }, [atualizarPendingCount])

  const sincronizar = useCallback(async () => {
    if (!navigator.onLine || sincronizando) return
    const pending = await getPending()
    if (pending.length === 0) return
    setSincronizando(true)
    showToast(`⏳ Sincronizando ${pending.length} ocorrência(s)...`)
    let ok = 0
    for (const item of pending) {
      try {
        const { localId, _savedAt, ...data } = item
        await criarOcorrencia(data)
        await removePending(localId)
        ok++
      } catch {
        // will retry next time
      }
    }
    setSincronizando(false)
    if (ok > 0) {
      showToast(`✅ ${ok} ocorrência(s) sincronizadas com sucesso!`)
      await carregar()
    }
    await atualizarPendingCount()
  }, [sincronizando, carregar, atualizarPendingCount])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    const goOnline = () => { setIsOnline(true); setTimeout(sincronizar, 800) }
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [sincronizar])

  async function exportarTudoKMZ() {
    const comGeo = ocorrencias.filter((o) => o.lat && o.lng)
    if (!comGeo.length) { alert('Nenhuma ocorrência com GPS para exportar.'); return }
    const placemarks = comGeo.map((o) => `
    <Placemark>
      <name>${o.natureza}</name>
      <description><![CDATA[
        <b>Tipo:</b> ${o.tipo}<br/>
        <b>Natureza:</b> ${o.natureza}${o.subnatureza ? ` (${o.subnatureza})` : ''}<br/>
        <b>Nível:</b> ${o.nivel_risco}<br/>
        <b>Status:</b> ${o.status_oc}<br/>
        ${o.endereco ? `<b>Endereço:</b> ${o.endereco}<br/>` : ''}
        ${o.proprietario ? `<b>Proprietário:</b> ${o.proprietario}<br/>` : ''}
        <b>Data:</b> ${new Date(o.created_at).toLocaleString('pt-BR')}
      ]]></description>
      <Point><coordinates>${o.lng},${o.lat},0</coordinates></Point>
    </Placemark>`).join('\n')
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Defesa Civil Ouro Branco — Todas as Ocorrências</name>
    ${placemarks}
  </Document>
</kml>`
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('ocorrencias.kml', kml)
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `defesacivil_ourobranco_${Date.now()}.kmz`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportarExcel() {
    const { exportarTodasExcel } = await import('./exportExcel')
    await exportarTodasExcel(ocorrenciasFiltradas)
  }

  const datasDisponiveis = useMemo(() => {
    const set = new Set(ocorrencias.map((o) => dataLocal(o.created_at)))
    set.add(hojeStr())
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [ocorrencias])

  const ocorrenciasFiltradas = useMemo(() => ocorrencias.filter((o) => {
    if (dataLocal(o.created_at) !== filtroData) return false
    if (filtroNivel !== 'todos' && o.nivel_risco !== filtroNivel) return false
    if (filtroStatus !== 'todos' && o.status_oc !== filtroStatus) return false
    if (buscando) {
      const b = buscando.toLowerCase()
      return o.natureza.toLowerCase().includes(b) || o.tipo.toLowerCase().includes(b) ||
        (o.endereco ?? '').toLowerCase().includes(b) || (o.proprietario ?? '').toLowerCase().includes(b)
    }
    return true
  }), [ocorrencias, filtroData, filtroNivel, filtroStatus, buscando])

  const contagens = useMemo(() => ({
    alto: ocorrencias.filter((o) => o.nivel_risco === 'alto').length,
    medio: ocorrencias.filter((o) => o.nivel_risco === 'medio').length,
    baixo: ocorrencias.filter((o) => o.nivel_risco === 'baixo').length,
    ativos: ocorrencias.filter((o) => o.status_oc === 'ativo').length,
  }), [ocorrencias])

  if (!logado) {
    return <Login onLogin={() => setLogado(true)} apenasAgente={estaLogado() && !agenteEscolhido()} />
  }

  if (aba === 'nova') {
    return (
      <Suspense fallback={<LazyFallback />}>
        <NovaOcorrencia
          onSalvo={async (ocOffline) => {
            if (ocOffline) showToast('📥 Salvo offline. Será enviado quando houver conexão.')
            else showToast('✅ Ocorrência salva com sucesso!')
            await carregar()
            await atualizarPendingCount()
            setAba('lista')
          }}
          onVoltar={() => setAba('lista')}
          isOnline={isOnline}
        />
      </Suspense>
    )
  }

  return (
    <div className="app">
      <BannerInstalar />

      {!isOnline && (
        <div className="offline-banner">
          📵 Sem conexão — dados salvos localmente
        </div>
      )}

      {isOnline && pendingCount > 0 && (
        <div className="sync-banner" onClick={sincronizar}>
          {sincronizando
            ? '⏳ Sincronizando...'
            : `🔄 ${pendingCount} ocorrência(s) pendente(s) — toque para sincronizar`}
        </div>
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}

      <header className="header">
        <div className="header-logo">
          <img src="/logo-dc.jpg" alt="Defesa Civil" className="logo-img" />
          <div className="header-textos">
            <span className="header-nome">Defesa Civil</span>
            <span className="header-cidade">Ouro Branco — MG</span>
          </div>
        </div>
        <div className="header-direita">
          <div className={`header-status ${isOnline ? 'online' : 'offline'}`}>
            <span className="status-dot" />
            {isOnline ? `${contagens.ativos} Ativo${contagens.ativos !== 1 ? 's' : ''}` : 'Offline'}
          </div>
        </div>
      </header>

      {aba === 'lista' && (
        <div className="resumo-strip">
          <div className="resumo-item resumo-alto" onClick={() => setFiltroNivel(filtroNivel === 'alto' ? 'todos' : 'alto')}>
            <span className="resumo-num">{contagens.alto}</span>
            <span className="resumo-rotulo">Alto</span>
          </div>
          <div className="resumo-div" />
          <div className="resumo-item resumo-medio" onClick={() => setFiltroNivel(filtroNivel === 'medio' ? 'todos' : 'medio')}>
            <span className="resumo-num">{contagens.medio}</span>
            <span className="resumo-rotulo">Médio</span>
          </div>
          <div className="resumo-div" />
          <div className="resumo-item resumo-baixo" onClick={() => setFiltroNivel(filtroNivel === 'baixo' ? 'todos' : 'baixo')}>
            <span className="resumo-num">{contagens.baixo}</span>
            <span className="resumo-rotulo">Baixo</span>
          </div>
          <div className="resumo-div" />
          <div className="resumo-item resumo-total" onClick={() => { setFiltroNivel('todos'); setFiltroStatus('todos') }}>
            <span className="resumo-num">{ocorrencias.length}</span>
            <span className="resumo-rotulo">Total</span>
          </div>
        </div>
      )}

      <div className="conteudo">
        {aba === 'lista' && (
          <>
            <div className="filtros-box">
              <div className="filtros-row filtros-data-row">
                <span className="filtros-label">📅 Data:</span>
                <select
                  className="filtro-data-select"
                  value={filtroData}
                  onChange={(e) => setFiltroData(e.target.value)}
                >
                  {datasDisponiveis.map((d) => {
                    const hoje = hojeStr()
                    const label = d === hoje
                      ? `Hoje — ${formatarDataExibicao(d)}`
                      : formatarDataExibicao(d)
                    return <option key={d} value={d}>{label}</option>
                  })}
                </select>
                {filtroData !== hojeStr() && (
                  <button className="btn-hoje" onClick={() => setFiltroData(hojeStr())}>Hoje</button>
                )}
              </div>
              <input
                className="busca-input"
                type="text"
                placeholder="🔍 Buscar por natureza, local ou morador..."
                value={buscando}
                onChange={(e) => setBuscando(e.target.value)}
              />
              <div className="filtros-row">
                <span className="filtros-label">Nível:</span>
                {(['todos', 'alto', 'medio', 'baixo'] as const).map((f) => (
                  <button key={f} className={`filtro-btn ${filtroNivel === f ? 'ativo' : ''} ${f !== 'todos' ? `filtro-${f}` : ''}`} onClick={() => setFiltroNivel(f)}>
                    {f === 'todos' ? 'Todos' : f === 'alto' ? 'Alto' : f === 'medio' ? 'Médio' : 'Baixo'}
                  </button>
                ))}
                <span className="filtros-label" style={{ marginLeft: '0.4rem' }}>Status:</span>
                {(['todos', 'ativo', 'resolvido'] as const).map((s) => (
                  <button key={s} className={`filtro-btn ${filtroStatus === s ? 'ativo' : ''}`} onClick={() => setFiltroStatus(s)}>
                    {s === 'todos' ? 'Todos' : s === 'ativo' ? 'Ativos' : 'Resolvidos'}
                  </button>
                ))}
              </div>
              <div className="filtros-row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button className="btn-excel-global" onClick={exportarExcel}>
                  📊 Excel
                </button>
                <button className="btn-kmz-global" onClick={exportarTudoKMZ}>
                  🌍 KMZ
                </button>
              </div>
            </div>

            {carregando ? (
              <div className="carregando">⏳ Carregando ocorrências...</div>
            ) : ocorrenciasFiltradas.length === 0 ? (
              <div className="lista-vazia">
                <div style={{ fontSize: '3rem' }}>📋</div>
                <div>
                  {filtroData === hojeStr()
                    ? 'Nenhuma ocorrência registrada hoje.'
                    : `Nenhuma ocorrência em ${formatarDataExibicao(filtroData)}.`}
                </div>
                {filtroData === hojeStr() && (
                  <button className="btn-nova-vazia" onClick={() => setAba('nova')}>+ Registrar nova</button>
                )}
              </div>
            ) : (
              <div className="lista">
                {ocorrenciasFiltradas.map((o) => (
                  <button key={o.id} className={`oc-card ${o._offline ? 'oc-card-offline' : ''}`} onClick={() => setSelecionada(o)}>
                    <div className="oc-card-esq">
                      <span className="oc-emoji">{NATUREZA_ICONE[o.natureza] ?? '📋'}</span>
                    </div>
                    <div className="oc-card-corpo">
                      <div className="oc-card-top">
                        <span className="oc-natureza">{o.natureza}</span>
                        {o._offline && <span className="oc-offline-tag">📵</span>}
                        <span className="oc-seta">›</span>
                      </div>
                      <div className="oc-card-badges">
                        <NivelBadge nivel={o.nivel_risco} />
                        <span className={`status-badge status-${o.status_oc}`}>
                          {o.status_oc === 'ativo' ? '🔴 Ativo' : '✅ Resolvido'}
                        </span>
                      </div>
                      <div className="oc-card-meta">
                        <span>{o.tipo}</span>
                        {o.endereco && <span>📍 {o.endereco}</span>}
                        <span>🕐 {new Date(o.created_at).toLocaleDateString('pt-BR')}</span>
                        {Array.isArray(o.agentes) && o.agentes.length > 0 && (
                          <span>👤 {o.agentes.join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {aba === 'mapa' && (
          <Suspense fallback={<LazyFallback />}>
            <MapaOcorrencias
              ocorrencias={ocorrencias}
              onSelecionar={(o) => setSelecionada(o)}
            />
          </Suspense>
        )}

        {aba === 'viatura' && (
          <Suspense fallback={<LazyFallback />}>
            <ChecklistViatura />
          </Suspense>
        )}

        {aba === 'escala' && (
          <Suspense fallback={<LazyFallback />}>
            <EscalaAgentes />
          </Suspense>
        )}
      </div>

      <nav className="bottom-nav">
        <button className={`nav-btn ${aba === 'escala' ? 'ativo' : ''}`} onClick={() => setAba('escala')}>
          <span className="nav-emoji">👥</span>
          <span>Escala</span>
        </button>
        <button className={`nav-btn ${aba === 'lista' ? 'ativo' : ''}`} onClick={() => setAba('lista')}>
          <span className="nav-emoji">📋</span>
          <span>Ocorrências</span>
        </button>
        <button className="nav-btn nav-nova" onClick={() => setAba('nova')}>
          <span className="nav-nova-icone">+</span>
        </button>
        <button className={`nav-btn ${aba === 'mapa' ? 'ativo' : ''}`} onClick={() => setAba('mapa')}>
          <span className="nav-emoji">🗺️</span>
          <span>Mapa</span>
        </button>
        <button className={`nav-btn ${aba === 'viatura' ? 'ativo' : ''}`} onClick={() => setAba('viatura')}>
          <span className="nav-emoji">🚗</span>
          <span>Viatura</span>
        </button>
      </nav>

      {selecionada && (
        <Suspense fallback={null}>
          <DetalheOcorrencia
            ocorrencia={selecionada}
            onFechar={() => setSelecionada(null)}
            onDeletado={() => { setSelecionada(null); carregar() }}
            onAtualizado={(atualizado) => {
              setSelecionada(atualizado)
              setOcorrencias((prev) => prev.map((o) => o.id === atualizado.id ? atualizado : o))
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
