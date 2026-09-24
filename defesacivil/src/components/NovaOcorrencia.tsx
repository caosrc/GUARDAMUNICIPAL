import { useState, useRef } from 'react'
import { TIPOS_OCORRENCIA, NATUREZAS, AGENTES } from '../types'
import type { NivelRisco, StatusOc } from '../types'
import { criarOcorrencia } from '../api'
import { savePending, geocodificarEndereco } from '../offline'
import { formatarCoordenadas, adicionarMarcaDagua, mensagemErroGps } from '../utils'

interface Props {
  onSalvo: (offline: boolean) => void
  onVoltar: () => void
  isOnline: boolean
}

export default function NovaOcorrencia({ onSalvo, onVoltar, isOnline }: Props) {
  const hoje = new Date().toISOString().split('T')[0]
  const [tipo, setTipo] = useState('')
  const [tipoOutro, setTipoOutro] = useState('')
  const [natureza, setNatureza] = useState('')
  const [subnatureza, setSubnatureza] = useState('')
  const [nivelRisco, setNivelRisco] = useState<NivelRisco>('baixo')
  const [statusOc, setStatusOc] = useState<StatusOc>('ativo')
  const [dataOcorrencia, setDataOcorrencia] = useState(hoje)
  const [fotos, setFotos] = useState<string[]>([])
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [endereco, setEndereco] = useState('')
  const [proprietario, setProprietario] = useState('')
  const [situacao, setSituacao] = useState('')
  const [recomendacao, setRecomendacao] = useState('')
  const [conclusao, setConclusao] = useState('')
  const [agentes, setAgentes] = useState<string[]>(() => {
    const agenteLogado = sessionStorage.getItem('defesacivil-agente-sessao')
    return agenteLogado ? [agenteLogado] : []
  })
  const [buscandoGps, setBuscandoGps] = useState(false)
  const [geocodificando, setGeocodificando] = useState(false)
  const [geoMsg, setGeoMsg] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const cameraRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)

  const precisaSubnatureza = natureza === 'Queda de Estrutura' || natureza === 'Apreensão e Captura de Animal'
  const labelSubnatureza = natureza === 'Queda de Estrutura' ? 'Qual é a estrutura?' : 'Qual é o animal?'

  function obterGps() {
    if (!navigator.geolocation) { setErro('Geolocalização não disponível.'); return }
    setErro('')
    setGeoMsg('')
    setBuscandoGps(true)
    // IMPORTANTE: no iOS o getCurrentPosition deve ser chamado de forma
    // síncrona dentro do handler do gesto do usuário. Qualquer await
    // antes desta chamada faz o iOS bloquear a permissão.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(parseFloat(pos.coords.latitude.toFixed(6)))
        setLng(parseFloat(pos.coords.longitude.toFixed(6)))
        setGeoMsg('✅ GPS obtido com sucesso!')
        setErro('')
        setBuscandoGps(false)
      },
      (err) => {
        setErro(mensagemErroGps(err))
        setBuscandoGps(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
    )
  }

  async function localizarEndereco() {
    if (!endereco.trim()) { setErro('Digite um endereço para localizar.'); return }
    setGeocodificando(true)
    setGeoMsg('')
    const resultado = await geocodificarEndereco(endereco)
    setGeocodificando(false)
    if (resultado) {
      setLat(resultado.lat)
      setLng(resultado.lng)
      const origem = navigator.onLine ? '' : ' (referência offline)'
      setGeoMsg(`✅ Localizado${origem}: ${formatarCoordenadas(resultado.lat, resultado.lng)}`)
    } else {
      setGeoMsg(navigator.onLine
        ? '⚠️ Endereço não encontrado. Tente ser mais específico.'
        : '⚠️ Sem conexão. Use o GPS ou tente novamente com sinal.')
    }
  }

  function adicionarFotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        if (ev.target?.result) {
          const comMarca = await adicionarMarcaDagua(ev.target.result as string, lat, lng)
          setFotos((prev) => [...prev, comMarca])
        }
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  async function salvar() {
    if (!tipo) { setErro('Selecione o tipo de ocorrência.'); return }
    if (!natureza) { setErro('Selecione a natureza da ocorrência.'); return }
    if (precisaSubnatureza && !subnatureza.trim()) {
      setErro(`Informe: ${labelSubnatureza}`)
      return
    }
    if (!lat && !endereco.trim()) {
      setErro('Informe a localização (GPS ou endereço).')
      return
    }
    setErro('')
    setSalvando(true)

    // If address provided but no GPS yet, try to geocode now
    let finalLat = lat
    let finalLng = lng
    if (!finalLat && endereco.trim() && navigator.onLine) {
      const geo = await geocodificarEndereco(endereco)
      if (geo) { finalLat = geo.lat; finalLng = geo.lng }
    }

    const tipoFinal = tipo === 'Outro' ? (tipoOutro.trim() || 'Outro') : tipo

    const payload = {
      tipo: tipoFinal,
      natureza,
      subnatureza: precisaSubnatureza ? subnatureza : null,
      nivel_risco: nivelRisco,
      status_oc: statusOc,
      data_ocorrencia: dataOcorrencia || null,
      fotos,
      lat: finalLat,
      lng: finalLng,
      endereco: endereco || null,
      proprietario: proprietario || null,
      situacao: situacao || null,
      recomendacao: recomendacao || null,
      conclusao: conclusao || null,
      agentes,
      responsavel_registro: sessionStorage.getItem('defesacivil-agente-sessao') || null,
    }

    if (isOnline) {
      try {
        await criarOcorrencia(payload as any)
        setSalvando(false)
        onSalvo(false)
      } catch {
        // Network failed even though we thought online — save offline
        await savePending(payload)
        setSalvando(false)
        onSalvo(true)
      }
    } else {
      // Offline: save locally
      await savePending(payload)
      setSalvando(false)
      onSalvo(true)
    }
  }

  return (
    <div className="tela">
      <header className="header">
        <button className="btn-voltar" onClick={onVoltar}>‹</button>
        <div className="header-logo-mini">
          <img src="/logo-dc.jpg" alt="Defesa Civil" className="logo-img-mini" />
          <span className="header-titulo-texto">Nova Ocorrência</span>
        </div>
        <div style={{ width: 36 }}>
          {!isOnline && <span title="Sem conexão — salvo localmente" style={{ fontSize: '1.2rem' }}>📵</span>}
        </div>
      </header>

      {!isOnline && (
        <div className="offline-banner">
          📵 Sem conexão — a ocorrência será salva localmente
        </div>
      )}

      <div className="form-scroll">
        <div className="form-card">
          <h2 className="form-titulo">Registrar Ocorrência</h2>

          {/* 1 - Tipo */}
          <div className="campo">
            <label className="campo-label">1 — Tipo de Ocorrência</label>
            <select className="campo-select" value={tipo} onChange={(e) => { setTipo(e.target.value); setTipoOutro(''); setNatureza('') }}>
              <option value="">Selecione...</option>
              {TIPOS_OCORRENCIA.map((t) => <option key={t}>{t}</option>)}
            </select>
            {tipo === 'Outro' && (
              <input
                className="campo-input"
                style={{ marginTop: '0.5rem' }}
                type="text"
                placeholder="Descreva o tipo de ocorrência..."
                value={tipoOutro}
                onChange={(e) => setTipoOutro(e.target.value)}
              />
            )}
          </div>

          {/* 2 - Natureza */}
          {tipo && (
            <div className="campo campo-animado">
              <label className="campo-label">2 — Natureza da Ocorrência</label>
              <select className="campo-select" value={natureza} onChange={(e) => { setNatureza(e.target.value); setSubnatureza('') }}>
                <option value="">Selecione...</option>
                {NATUREZAS.map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
          )}

          {/* 2b - Subnatureza condicional */}
          {precisaSubnatureza && (
            <div className="campo campo-animado campo-sub">
              <label className="campo-label campo-label-sub">↳ {labelSubnatureza}</label>
              <input
                className="campo-input"
                type="text"
                placeholder={natureza === 'Queda de Estrutura' ? 'Ex: muro, teto, parede...' : 'Ex: cachorro, capivara...'}
                value={subnatureza}
                onChange={(e) => setSubnatureza(e.target.value)}
              />
            </div>
          )}

          {/* 3 - Nível de Risco */}
          <div className="campo">
            <label className="campo-label">3 — Nível de Risco</label>
            <div className="toggle-group">
              {(['baixo', 'medio', 'alto'] as NivelRisco[]).map((n) => (
                <button
                  key={n}
                  className={`toggle-btn toggle-${n} ${nivelRisco === n ? 'ativo' : ''}`}
                  onClick={() => setNivelRisco(n)}
                >
                  {n === 'baixo' ? 'Baixo' : n === 'medio' ? 'Médio' : 'Alto'}
                </button>
              ))}
            </div>
          </div>

          {/* 4 - Status */}
          <div className="campo">
            <label className="campo-label">4 — Status</label>
            <div className="toggle-group">
              {(['ativo', 'resolvido'] as StatusOc[]).map((s) => (
                <button
                  key={s}
                  className={`toggle-btn toggle-status-${s} ${statusOc === s ? 'ativo' : ''}`}
                  onClick={() => setStatusOc(s)}
                >
                  {s === 'ativo' ? 'Ativo' : 'Resolvido'}
                </button>
              ))}
            </div>
          </div>

          {/* 5 - Data da ocorrência */}
          <div className="campo">
            <label className="campo-label">5 — Data da Ocorrência</label>
            <input
              className="campo-input"
              type="date"
              value={dataOcorrencia}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setDataOcorrencia(e.target.value)}
            />
          </div>

          {/* 6 - Fotos */}
          <div className="campo">
            <label className="campo-label">6 — Fotos</label>
            <div className="fotos-area">
              {fotos.map((f, i) => (
                <div key={i} className="foto-wrap">
                  <img src={f} alt="" className="foto-thumb" />
                  <button className="foto-del" onClick={() => setFotos((p) => p.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
            <div className="fotos-botoes">
              <button className="btn-foto-camera" onClick={() => cameraRef.current?.click()}>
                <span>📷</span>
                <span>Tirar Foto</span>
              </button>
              <button className="btn-foto-galeria" onClick={() => galeriaRef.current?.click()}>
                <span>🖼️</span>
                <span>Carregar Foto</span>
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={adicionarFotos} />
            <input ref={galeriaRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={adicionarFotos} />
          </div>

          {/* 6 - Localização */}
          <div className="campo">
            <label className="campo-label">7 — Localização</label>

            {/* GPS */}
            <div className="gps-row">
              <div className="gps-info">
                <span>📍</span>
                {lat
                  ? <span className="gps-val">{formatarCoordenadas(lat, lng)}</span>
                  : <span className="gps-vazio">Sem GPS</span>}
              </div>
              <button className="btn-gps" onClick={obterGps} disabled={buscandoGps}>
                {buscandoGps ? '⏳' : 'Obter GPS'}
              </button>
            </div>

            {/* Address + geocode button */}
            <div className="endereco-row">
              <input
                className="campo-input endereco-input"
                type="text"
                placeholder="Rua, nº, Bairro... (Ouro Branco)"
                value={endereco}
                onChange={(e) => { setEndereco(e.target.value); setGeoMsg('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') localizarEndereco() }}
              />
              <button
                className="btn-geocode"
                onClick={localizarEndereco}
                disabled={geocodificando || !endereco.trim()}
                title="Localizar endereço no mapa"
              >
                {geocodificando ? '⏳' : '🗺️'}
              </button>
            </div>
            {geoMsg && (
              <div className={`geo-msg ${geoMsg.startsWith('✅') ? 'geo-ok' : 'geo-warn'}`}>
                {geoMsg}
              </div>
            )}
            {erro.includes('GPS') && (
              <div className="gps-permissao-dica">
                No celular: toque no cadeado/ícone do site, abra Permissões, marque Localização como Permitir e depois toque em “Obter GPS” novamente.
              </div>
            )}
            <div className="geo-dica">
              💡 Digite o endereço e toque em 🗺️ para marcar no mapa automaticamente
            </div>
          </div>

          {/* 7 - Proprietário */}
          <div className="campo">
            <label className="campo-label">8 — Proprietário / Morador</label>
            <input
              className="campo-input"
              type="text"
              placeholder="Nome completo"
              value={proprietario}
              onChange={(e) => setProprietario(e.target.value)}
            />
          </div>

          {/* 9 - Situação */}
          <div className="campo">
            <label className="campo-label">9 — Situação</label>
            <textarea
              className="campo-textarea"
              placeholder="Descreva a situação da ocorrência..."
              rows={4}
              value={situacao}
              onChange={(e) => setSituacao(e.target.value)}
            />
          </div>

          {/* 10 - Recomendação */}
          <div className="campo">
            <label className="campo-label">10 — Recomendação</label>
            <textarea
              className="campo-textarea"
              placeholder="Descreva a recomendação..."
              rows={4}
              value={recomendacao}
              onChange={(e) => setRecomendacao(e.target.value)}
            />
          </div>

          {/* 11 - Conclusão */}
          <div className="campo">
            <label className="campo-label">11 — Conclusão</label>
            <textarea
              className="campo-textarea"
              placeholder="Descreva a conclusão..."
              rows={4}
              value={conclusao}
              onChange={(e) => setConclusao(e.target.value)}
            />
          </div>

          {/* 12 - Agentes Empenhados */}
          <div className="campo">
            <label className="campo-label">12 — Agentes Empenhados na Ocorrência</label>
            <div className="agentes-lista">
              {AGENTES.map((nome) => (
                <label key={nome} className="agente-item">
                  <input
                    type="checkbox"
                    className="agente-checkbox"
                    checked={agentes.includes(nome)}
                    onChange={(e) => {
                      if (e.target.checked) setAgentes((p) => [...p, nome])
                      else setAgentes((p) => p.filter((a) => a !== nome))
                    }}
                  />
                  <span className="agente-nome">{nome}</span>
                </label>
              ))}
            </div>
          </div>

          {erro && <div className="erro-msg">⚠️ {erro}</div>}
        </div>
      </div>

      <div className="footer-fixo">
        <button className="btn-salvar" onClick={salvar} disabled={salvando}>
          {salvando ? '⏳ Salvando...' : isOnline ? '💾  Salvar Ocorrência' : '📥  Salvar Offline'}
        </button>
      </div>
    </div>
  )
}
