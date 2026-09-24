import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './Curral.css'

export type CurralStatus = 'encontrado' | 'a_caminho' | 'no_curral' | 'encerrado'

export interface CurralDados {
  especie: string
  porte: string
  sexo: string
  identificacao: string
  localDescricao: string
  observacoes: string
  latitude: number | null
  longitude: number | null
  precisaoGps: number | null
  capturadoEm: string
  fotos: string[]
  status: CurralStatus
}

export interface CurralRegistro extends CurralDados {
  id: string | number
  fotosCount?: number
  criadoPor?: string | null
}

export interface CurralProps {
  registros?: CurralRegistro[]
  carregandoLista?: boolean
  erroLista?: string | null
  onSalvar: (dados: CurralDados, ocorrenciaId?: number | null) => void | Promise<void>
  onAtualizarRegistro?: (id: string | number, dados: CurralDados) => void | Promise<void>
  onCapturarGps?: (dados: CurralDados) => void | Promise<number | null>
  onAtualizarLista: () => void | Promise<void>
  onVoltar: () => void
}

type GpsStatus = 'inativo' | 'aguardando' | 'ativo' | 'indisponivel' | 'negado' | 'erro'
type GmsHemisphere = 'S' | 'W'
type GmsPart = { graus: string; minutos: string; segundos: string; hemisferio: GmsHemisphere }

const GMS_VAZIO: GmsPart = { graus: '', minutos: '', segundos: '', hemisferio: 'S' }

function decimalParaGms(valor: number | null, latitude: boolean): GmsPart {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    return { ...GMS_VAZIO, hemisferio: latitude ? 'S' : 'W' }
  }
  const absoluto = Math.abs(valor)
  const graus = Math.floor(absoluto)
  const minutosDecimais = (absoluto - graus) * 60
  const minutos = Math.floor(minutosDecimais)
  const segundos = (minutosDecimais - minutos) * 60
  const hemisferio = latitude ? 'S' : 'W'
  return { graus: String(graus), minutos: String(minutos), segundos: segundos.toFixed(2), hemisferio }
}

function gmsParaDecimal(parte: GmsPart, latitude: boolean): number | null {
  if (!parte.graus.trim() && !parte.minutos.trim() && !parte.segundos.trim()) return null
  const graus = Number(parte.graus.replace(',', '.'))
  const minutos = Number(parte.minutos.replace(',', '.'))
  const segundos = Number(parte.segundos.replace(',', '.'))
  const limiteGraus = latitude ? 90 : 180
  if (!Number.isFinite(graus) || !Number.isFinite(minutos) || !Number.isFinite(segundos)
    || graus < 0 || graus > limiteGraus || minutos < 0 || minutos >= 60 || segundos < 0 || segundos >= 60
    || graus === limiteGraus && (minutos > 0 || segundos > 0)) return null
  const absoluto = graus + minutos / 60 + segundos / 3600
  return -absoluto
}

function comprimirFoto(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return Promise.resolve(dataUrl)
  return new Promise((resolve) => {
    const imagem = new Image()
    imagem.onload = () => {
      const maxLargura = 1280
      const escala = Math.min(1, maxLargura / imagem.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(imagem.width * escala))
      canvas.height = Math.max(1, Math.round(imagem.height * escala))
      const contexto = canvas.getContext('2d')
      if (!contexto) {
        resolve(dataUrl)
        return
      }
      contexto.drawImage(imagem, 0, 0, canvas.width, canvas.height)
      const webp = canvas.toDataURL('image/webp', 0.82)
      resolve(webp.startsWith('data:image/webp') ? webp : dataUrl)
    }
    imagem.onerror = () => resolve(dataUrl)
    imagem.src = dataUrl
  })
}

const novoRegistro = (): CurralDados => ({
  especie: '',
  porte: '',
  sexo: '',
  identificacao: '',
  localDescricao: '',
  observacoes: '',
  latitude: null,
  longitude: null,
  precisaoGps: null,
  capturadoEm: new Date().toISOString().slice(0, 16),
  fotos: [],
  status: 'encontrado',
})

function formatarData(data: string) {
  if (!data) return 'Data não informada'
  const valor = new Date(data)
  if (Number.isNaN(valor.getTime())) return data
  return valor.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatarCoordenada(valor: number | null, latitude: boolean) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return 'não capturada'
  const parte = decimalParaGms(valor, latitude)
  return `${parte.graus}° ${parte.minutos}' ${parte.segundos.replace('.', ',')}" ${parte.hemisferio}`
}

function rotuloStatus(status: CurralStatus) {
  const labels: Record<CurralStatus, string> = {
    encontrado: 'Encontrado',
    a_caminho: 'A caminho',
    no_curral: 'No curral',
    encerrado: 'Encerrado',
  }
  return labels[status]
}

function quantidadeFotos(registro: CurralRegistro) {
  return registro.fotosCount ?? registro.fotos.length
}

export default function Curral({
  registros = [],
  carregandoLista = false,
  erroLista = null,
  onSalvar,
  onAtualizarRegistro,
  onCapturarGps,
  onAtualizarLista,
  onVoltar,
}: CurralProps) {
  const [dados, setDados] = useState<CurralDados>(novoRegistro)
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('inativo')
  const [gpsMensagem, setGpsMensagem] = useState('')
  const [etapa, setEtapa] = useState<'formulario' | 'revisao' | 'sucesso'>('formulario')
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState('')
  const [fotoEmFoco, setFotoEmFoco] = useState<string | null>(null)
  const [ocorrenciaSalva, setOcorrenciaSalva] = useState(false)
  const [registroEditandoId, setRegistroEditandoId] = useState<string | number | null>(null)
  const [foiEdicao, setFoiEdicao] = useState(false)
  const [coordenadasGms, setCoordenadasGms] = useState<{ latitude: GmsPart; longitude: GmsPart }>({
    latitude: { ...GMS_VAZIO, hemisferio: 'S' },
    longitude: { ...GMS_VAZIO, hemisferio: 'W' },
  })
  const fotoInputRef = useRef<HTMLInputElement>(null)
  const ocorrenciaCapturaIdRef = useRef<number | null>(null)
  const criandoOcorrenciaRef = useRef(false)

  const gpsCapturado = dados.latitude !== null && dados.longitude !== null
  const textoGps = useMemo(() => {
    if (gpsStatus === 'aguardando') return 'Buscando posição do aparelho...'
    if (gpsStatus === 'ativo' && ocorrenciaSalva) return 'GPS registrado e ocorrência salva em Ocorrências'
    if (gpsStatus === 'ativo' && dados.precisaoGps) return `Posição registrada com precisão de ${Math.round(dados.precisaoGps)} m`
    if (gpsStatus === 'negado') return 'Permissão de localização negada'
    if (gpsStatus === 'indisponivel') return 'GPS indisponível neste dispositivo'
    if (gpsStatus === 'erro') return gpsMensagem || 'Não foi possível capturar o GPS'
    return gpsCapturado ? 'Local georreferenciado neste registro' : 'Local ainda não georreferenciado'
  }, [dados.precisaoGps, gpsCapturado, gpsMensagem, gpsStatus, ocorrenciaSalva])

  function atualizarCampo(campo: keyof CurralDados, valor: string) {
    setDados((anterior) => ({ ...anterior, [campo]: valor }))
    setErroSalvar('')
  }

  function capturarGps() {
    if (!navigator.geolocation) {
      setGpsStatus('indisponivel')
      setGpsMensagem('Este aparelho não oferece localização pelo navegador.')
      return
    }

    setGpsStatus('aguardando')
    setGpsMensagem('')
    navigator.geolocation.getCurrentPosition(
      (posicao) => {
        const dadosComGps = {
          ...dados,
          latitude: posicao.coords.latitude,
          longitude: posicao.coords.longitude,
          precisaoGps: posicao.coords.accuracy,
        }
        setDados((anterior) => ({
          ...anterior,
          latitude: posicao.coords.latitude,
          longitude: posicao.coords.longitude,
          precisaoGps: posicao.coords.accuracy,
        }))
        setCoordenadasGms({
          latitude: decimalParaGms(posicao.coords.latitude, true),
          longitude: decimalParaGms(posicao.coords.longitude, false),
        })
        setGpsStatus('ativo')
        if (onCapturarGps && ocorrenciaCapturaIdRef.current === null && !criandoOcorrenciaRef.current) {
          criandoOcorrenciaRef.current = true
          void Promise.resolve(onCapturarGps(dadosComGps))
            .then((id) => {
              ocorrenciaCapturaIdRef.current = typeof id === 'number' ? id : null
              setOcorrenciaSalva(typeof id === 'number')
            })
            .catch(() => {
              setOcorrenciaSalva(false)
              setGpsMensagem('GPS capturado, mas não foi possível salvar a ocorrência. Tente enviar novamente.')
            })
            .finally(() => { criandoOcorrenciaRef.current = false })
        }
      },
      (erro) => {
        if (erro.code === erro.PERMISSION_DENIED) {
          setGpsStatus('negado')
          setGpsMensagem('Permita a localização nas configurações do navegador e tente novamente.')
        } else {
          setGpsStatus('erro')
          setGpsMensagem('Não foi possível obter uma posição. Tente em uma área aberta.')
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  }

  function abrirCamera() {
    fotoInputRef.current?.click()
  }

  function adicionarFotos(evento: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(evento.target.files ?? []).slice(0, 6 - dados.fotos.length)
    if (!arquivos.length) return
    Promise.all(
      arquivos.map((arquivo) => new Promise<string>((resolve, reject) => {
        const leitor = new FileReader()
        leitor.onload = async () => resolve(await comprimirFoto(String(leitor.result)))
        leitor.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
        leitor.readAsDataURL(arquivo)
      })),
    ).then((novasFotos) => {
      setDados((anterior) => ({ ...anterior, fotos: [...anterior.fotos, ...novasFotos] }))
    }).catch(() => setErroSalvar('Uma das fotos não pôde ser adicionada. Tente novamente.'))
    evento.target.value = ''
  }

  function removerFoto(indice: number) {
    setDados((anterior) => ({ ...anterior, fotos: anterior.fotos.filter((_, posicao) => posicao !== indice) }))
  }

  function atualizarCoordenadaGms(eixo: 'latitude' | 'longitude', campo: keyof GmsPart, valor: string) {
    const parteAtualizada = { ...coordenadasGms[eixo], [campo]: valor } as GmsPart
    setCoordenadasGms((anterior) => ({ ...anterior, [eixo]: parteAtualizada }))
    const decimal = gmsParaDecimal(parteAtualizada, eixo === 'latitude')
    setDados((anterior) => ({ ...anterior, [eixo]: decimal }))
    setGpsStatus(decimal === null ? 'inativo' : 'ativo')
    setErroSalvar('')
  }

  function editarRegistro(registro: CurralRegistro) {
    setDados({ ...registro, fotos: registro.fotos ?? [] })
    setRegistroEditandoId(registro.id)
    setFoiEdicao(true)
    setCoordenadasGms({
      latitude: decimalParaGms(registro.latitude, true),
      longitude: decimalParaGms(registro.longitude, false),
    })
    setGpsStatus(registro.latitude !== null && registro.longitude !== null ? 'ativo' : 'inativo')
    setGpsMensagem('')
    setErroSalvar('')
    setEtapa('formulario')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function revisar(evento: FormEvent) {
    evento.preventDefault()
    if (dados.latitude === null || dados.longitude === null) {
      setErroSalvar('Informe latitude e longitude válidas em GMS antes de continuar.')
      return
    }
    setErroSalvar('')
    setEtapa('revisao')
  }

  async function salvar() {
    setSalvando(true)
    setErroSalvar('')
    try {
      if (registroEditandoId !== null) {
        if (!onAtualizarRegistro) throw new Error('Edição não disponível')
        await onAtualizarRegistro(registroEditandoId, dados)
      } else {
        await onSalvar(dados, ocorrenciaCapturaIdRef.current)
      }
      setEtapa('sucesso')
    } catch {
      setErroSalvar('Não foi possível enviar o registro. Confira a conexão e tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  function iniciarOutro() {
    setDados(novoRegistro())
    setRegistroEditandoId(null)
    setFoiEdicao(false)
    setCoordenadasGms({
      latitude: { ...GMS_VAZIO, hemisferio: 'S' },
      longitude: { ...GMS_VAZIO, hemisferio: 'W' },
    })
    ocorrenciaCapturaIdRef.current = null
    criandoOcorrenciaRef.current = false
    setOcorrenciaSalva(false)
    setGpsStatus('inativo')
    setGpsMensagem('')
    setErroSalvar('')
    setEtapa('formulario')
  }

  return (
    <main className="curral-shell" data-testid="page-curral">
      <header className="curral-header">
        <div className="curral-header-top">
          <button className="curral-back" type="button" onClick={onVoltar} data-testid="button-curral-voltar" aria-label="Voltar">
            ←
          </button>
        </div>
        <div className="curral-header-copy">
          <h1>Curral - Registro de apreensão de animal</h1>
        </div>
      </header>

      <div className="curral-content">
        {etapa === 'sucesso' ? (
          <section className="curral-success" data-testid="status-curral-sucesso">
            <div className="curral-success-mark" aria-hidden="true">✓</div>
            <span className="curral-kicker">{foiEdicao ? 'Registro atualizado' : 'Registro enviado'}</span>
            <h2>{foiEdicao ? 'Registro atualizado no curral' : 'Atendimento salvo no curral'}</h2>
            <p>{foiEdicao ? 'As informações do registro e a coordenada em GMS foram atualizadas.' : 'Os dados e as fotos foram entregues para a fila de acompanhamento. A coordenada ficou vinculada a este registro.'}</p>
            <div className="curral-success-meta">
              <span>{dados.especie || 'Animal'}</span>
              <strong>{dados.fotos.length} {dados.fotos.length === 1 ? 'foto' : 'fotos'}</strong>
            </div>
            <div className="curral-success-actions">
              <button className="curral-button curral-button-primary" type="button" onClick={iniciarOutro} data-testid="button-curral-novo">
                Novo registro
              </button>
              <button className="curral-button curral-button-quiet" type="button" onClick={onAtualizarLista} data-testid="button-curral-atualizar-sucesso">
                Atualizar registros
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="curral-intro">
              <div>
                <span className="curral-kicker">Atendimento rápido</span>
                <h2>Primeiro, cuide do registro.</h2>
                <p>Preencha o que puder, marque o ponto se disponível e envie para a equipe.</p>
              </div>
              <div className="curral-progress" aria-label={`Etapa ${etapa === 'formulario' ? '1' : '2'} de 2`}>
                <span className={etapa === 'formulario' ? 'active' : 'done'}>01</span>
                <i />
                <span className={etapa === 'revisao' ? 'active' : ''}>02</span>
              </div>
            </section>

            {etapa === 'formulario' ? (
              <form className="curral-form" onSubmit={revisar} data-testid="form-curral">
                <section className="curral-card curral-card-identidade">
                  <div className="curral-section-heading">
                    <span className="curral-section-number">01</span>
                    <div>
                      <h3>Identificação</h3>
                      <p>O que foi encontrado?</p>
                    </div>
                  </div>
                  <div className="curral-field-grid">
                    <label className="curral-field curral-field-wide">
                      <span>Espécie</span>
                      <input value={dados.especie} onChange={(e) => atualizarCampo('especie', e.target.value)} placeholder="Ex.: bovino, equino, cão" data-testid="input-curral-especie" />
                    </label>
                    <label className="curral-field">
                      <span>Porte</span>
                      <select value={dados.porte} onChange={(e) => atualizarCampo('porte', e.target.value)} data-testid="select-curral-porte">
                        <option value="">Selecionar</option>
                        <option value="pequeno">Pequeno</option>
                        <option value="medio">Médio</option>
                        <option value="grande">Grande</option>
                      </select>
                    </label>
                    <label className="curral-field">
                      <span>Sexo</span>
                      <select value={dados.sexo} onChange={(e) => atualizarCampo('sexo', e.target.value)} data-testid="select-curral-sexo">
                        <option value="">Não informado</option>
                        <option value="femea">Fêmea</option>
                        <option value="macho">Macho</option>
                      </select>
                    </label>
                    <label className="curral-field curral-field-wide">
                      <span>Identificação visível</span>
                      <input value={dados.identificacao} onChange={(e) => atualizarCampo('identificacao', e.target.value)} placeholder="Brinco, marca, cor ou característica" data-testid="input-curral-identificacao" />
                    </label>
                  </div>
                </section>

                <section className="curral-card curral-card-location">
                  <div className="curral-section-heading">
                    <span className="curral-section-number">02</span>
                    <div>
                      <h3>Local da captura</h3>
                      <p>Georreferencie a ocorrência</p>
                    </div>
                    <span className="curral-location-pin" aria-hidden="true">⌖</span>
                  </div>
                  <label className="curral-field">
                    <span>Descrição do local</span>
                    <input value={dados.localDescricao} onChange={(e) => atualizarCampo('localDescricao', e.target.value)} placeholder="Rua, ponto de referência ou propriedade" data-testid="input-curral-local" />
                  </label>
                  <div className={`curral-gps-box ${gpsCapturado ? 'captured' : ''} ${gpsStatus === 'negado' || gpsStatus === 'erro' || gpsStatus === 'indisponivel' ? 'warning' : ''}`} data-testid="status-curral-gps">
                    <div className="curral-gps-symbol" aria-hidden="true">+</div>
                    <div className="curral-gps-copy">
                      <strong>{gpsCapturado ? 'Local marcado no mapa' : 'Marque o ponto exato'}</strong>
                      <span>{textoGps}</span>
                      {gpsCapturado && <small>{formatarCoordenada(dados.latitude, true)} · {formatarCoordenada(dados.longitude, false)}</small>}
                    </div>
                    <button className="curral-gps-button" type="button" onClick={capturarGps} disabled={gpsStatus === 'aguardando'} data-testid="button-curral-gps">
                      {gpsStatus === 'aguardando' ? 'Buscando' : gpsCapturado ? 'Atualizar' : 'Capturar GPS'}
                    </button>
                  </div>
                  <div className="curral-gms-editor" data-testid="section-curral-coordenadas-gms">
                    <div className="curral-gms-heading">
                      <strong>Coordenadas em GMS</strong>
                      <span>Graus · minutos · segundos</span>
                    </div>
                    <div className="curral-gms-grid">
                      <div className="curral-gms-field">
                        <span>Latitude</span>
                        <div className="curral-gms-inputs">
                          <input inputMode="numeric" value={coordenadasGms.latitude.graus} onChange={(e) => atualizarCoordenadaGms('latitude', 'graus', e.target.value)} placeholder="0" aria-label="Graus da latitude" data-testid="input-curral-latitude-graus" />
                          <b>°</b>
                          <input inputMode="numeric" value={coordenadasGms.latitude.minutos} onChange={(e) => atualizarCoordenadaGms('latitude', 'minutos', e.target.value)} placeholder="0" aria-label="Minutos da latitude" data-testid="input-curral-latitude-minutos" />
                          <b>'</b>
                          <input inputMode="decimal" value={coordenadasGms.latitude.segundos} onChange={(e) => atualizarCoordenadaGms('latitude', 'segundos', e.target.value)} placeholder="0,00" aria-label="Segundos da latitude" data-testid="input-curral-latitude-segundos" />
                          <b>"</b>
                          <b className="curral-gms-fixed-hemisphere">S</b>
                        </div>
                      </div>
                      <div className="curral-gms-field">
                        <span>Longitude</span>
                        <div className="curral-gms-inputs">
                          <input inputMode="numeric" value={coordenadasGms.longitude.graus} onChange={(e) => atualizarCoordenadaGms('longitude', 'graus', e.target.value)} placeholder="0" aria-label="Graus da longitude" data-testid="input-curral-longitude-graus" />
                          <b>°</b>
                          <input inputMode="numeric" value={coordenadasGms.longitude.minutos} onChange={(e) => atualizarCoordenadaGms('longitude', 'minutos', e.target.value)} placeholder="0" aria-label="Minutos da longitude" data-testid="input-curral-longitude-minutos" />
                          <b>'</b>
                          <input inputMode="decimal" value={coordenadasGms.longitude.segundos} onChange={(e) => atualizarCoordenadaGms('longitude', 'segundos', e.target.value)} placeholder="0,00" aria-label="Segundos da longitude" data-testid="input-curral-longitude-segundos" />
                          <b>"</b>
                          <b className="curral-gms-fixed-hemisphere">W</b>
                        </div>
                      </div>
                    </div>
                    <p>Exemplo: 20° 39' 36,44&quot; S · 43° 47' 11,24&quot; W</p>
                  </div>
                  <p className="curral-gps-note">A coordenada será registrada junto deste atendimento. O navegador não insere GPS dentro da foto.</p>
                </section>

                <section className="curral-card curral-card-evidence">
                  <div className="curral-section-heading">
                    <span className="curral-section-number">03</span>
                    <div>
                      <h3>Registro visual</h3>
                      <p>Fotografe o animal e seus sinais</p>
                    </div>
                  </div>
                  <input ref={fotoInputRef} className="curral-file-input" type="file" accept="image/*" capture="environment" multiple onChange={adicionarFotos} data-testid="input-curral-fotos" />
                  <button className="curral-camera-button" type="button" onClick={abrirCamera} disabled={dados.fotos.length >= 6} data-testid="button-curral-camera">
                    <span className="curral-camera-icon" aria-hidden="true">□</span>
                    <span>
                      <strong>{dados.fotos.length ? 'Adicionar outra foto' : 'Abrir câmera'}</strong>
                      <small>{dados.fotos.length}/6 fotos · imagens ficam neste registro</small>
                    </span>
                    <b aria-hidden="true">+</b>
                  </button>
                  {dados.fotos.length > 0 && (
                    <div className="curral-photo-grid" data-testid="list-curral-fotos">
                      {dados.fotos.map((foto, indice) => (
                        <div className="curral-photo" key={`${foto.slice(-16)}-${indice}`}>
                          <button type="button" onClick={() => setFotoEmFoco(foto)} data-testid={`button-curral-foto-${indice}`} aria-label={`Ampliar foto ${indice + 1}`}>
                            <img src={foto} alt={`Registro visual ${indice + 1}`} />
                          </button>
                          <button className="curral-photo-remove" type="button" onClick={() => removerFoto(indice)} data-testid={`button-curral-remover-foto-${indice}`} aria-label={`Remover foto ${indice + 1}`}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="curral-card curral-card-notes">
                  <div className="curral-section-heading">
                    <span className="curral-section-number">04</span>
                    <div>
                      <h3>Observações</h3>
                      <p>Deixe o contexto para a próxima equipe</p>
                    </div>
                  </div>
                  <div className="curral-field">
                    <textarea value={dados.observacoes} onChange={(e) => atualizarCampo('observacoes', e.target.value)} placeholder="Condição do animal, risco no local ou orientação dada..." rows={4} data-testid="textarea-curral-observacoes" />
                  </div>
                  <label className="curral-field curral-field-time">
                    <span>Capturado em</span>
                    <input type="datetime-local" value={dados.capturadoEm} onChange={(e) => atualizarCampo('capturadoEm', e.target.value)} data-testid="input-curral-capturado-em" />
                  </label>
                </section>

                {erroSalvar && <div className="curral-error" role="alert" data-testid="status-curral-erro">{erroSalvar}</div>}
                <button className="curral-submit" type="submit" data-testid="button-curral-revisar">
                  <span>Revisar e enviar</span>
                  <b aria-hidden="true">→</b>
                </button>
              </form>
            ) : (
              <section className="curral-review" data-testid="section-curral-revisao">
                <div className="curral-review-banner">
                  <span className="curral-review-icon" aria-hidden="true">✓</span>
                  <div>
                    <strong>Confira antes de enviar</strong>
                    <p>O registro será encaminhado com os dados abaixo.</p>
                  </div>
                </div>
                <div className="curral-review-card">
                  <div className="curral-review-title"><span>{foiEdicao ? 'Edição do registro' : 'Animal'}</span><button type="button" onClick={() => setEtapa('formulario')} data-testid="button-curral-editar">Editar</button></div>
                   <h2>{dados.especie || 'Animal não identificado'}</h2>
                  <div className="curral-review-chips">
                     {dados.porte && <span>{dados.porte}</span>}
                    {dados.sexo && <span>{dados.sexo}</span>}
                    {dados.identificacao && <span>{dados.identificacao}</span>}
                  </div>
                  <dl className="curral-review-details">
                     <div><dt>Local</dt><dd>{dados.localDescricao || 'Não informado'}</dd></div>
                    <div><dt>GPS · GMS</dt><dd>{formatarCoordenada(dados.latitude, true)}, {formatarCoordenada(dados.longitude, false)}{dados.precisaoGps ? ` · ±${Math.round(dados.precisaoGps)} m` : ''}</dd></div>
                    <div><dt>Capturado em</dt><dd>{formatarData(dados.capturadoEm)}</dd></div>
                    {dados.observacoes && <div><dt>Observações</dt><dd>{dados.observacoes}</dd></div>}
                  </dl>
                  <div className="curral-review-photos">
                    <span>Fotos anexadas</span><strong>{dados.fotos.length}/6</strong>
                  </div>
                  {dados.fotos.length > 0 && <div className="curral-review-photo-strip">{dados.fotos.map((foto, indice) => <img key={`${foto.slice(-14)}-${indice}`} src={foto} alt={`Foto anexada ${indice + 1}`} />)}</div>}
                </div>
                {erroSalvar && <div className="curral-error" role="alert" data-testid="status-curral-erro-revisao">{erroSalvar}</div>}
                <div className="curral-review-actions">
                  <button className="curral-button curral-button-quiet" type="button" onClick={() => setEtapa('formulario')} data-testid="button-curral-voltar-edicao">Voltar e editar</button>
                  <button className="curral-submit" type="button" onClick={salvar} disabled={salvando} data-testid="button-curral-enviar">
                    {salvando ? 'Enviando registro...' : 'Enviar registro'} {!salvando && <b aria-hidden="true">→</b>}
                  </button>
                </div>
              </section>
            )}

            <section className="curral-recentes" data-testid="section-curral-recentes">
              <div className="curral-recentes-heading">
                <div>
                  <span className="curral-kicker">Acompanhamento</span>
                  <h2>Registros recentes</h2>
                </div>
                <button className="curral-refresh" type="button" onClick={onAtualizarLista} disabled={carregandoLista} data-testid="button-curral-atualizar">
                  <span aria-hidden="true">↻</span> {carregandoLista ? 'Atualizando' : 'Atualizar'}
                </button>
              </div>
              {erroLista ? (
                <div className="curral-list-state curral-list-error" role="alert" data-testid="status-curral-erro-lista">
                  <strong>Não foi possível carregar os registros.</strong>
                  <button type="button" onClick={onAtualizarLista} data-testid="button-curral-tentar-lista">Tentar novamente</button>
                </div>
              ) : carregandoLista ? (
                <div className="curral-skeleton-list" data-testid="status-curral-carregando">
                  <span /><span /><span />
                </div>
              ) : registros.length === 0 ? (
                <div className="curral-list-state" data-testid="status-curral-vazio">
                  <span className="curral-empty-mark" aria-hidden="true">—</span>
                  <strong>Nenhum registro por aqui</strong>
                  <p>Os próximos animais encontrados aparecerão nesta lista.</p>
                </div>
              ) : (
                <div className="curral-record-list" data-testid="list-curral-registros">
                  {registros.slice(0, 8).map((registro) => (
                    <article className="curral-record" key={registro.id} data-testid={`card-curral-registro-${registro.id}`}>
                      <div className="curral-record-stamp" aria-hidden="true">C</div>
                      <div className="curral-record-main">
                        <div className="curral-record-top">
                          <strong>{registro.especie || 'Espécie não informada'}</strong>
                          <span className={`curral-status status-${registro.status}`}>{rotuloStatus(registro.status)}</span>
                        </div>
                        <span className="curral-record-place">{registro.localDescricao || 'Local não informado'}</span>
                        <span className="curral-record-meta">{formatarData(registro.capturadoEm)} · {quantidadeFotos(registro)} {quantidadeFotos(registro) === 1 ? 'foto' : 'fotos'}</span>
                      </div>
                      <button className="curral-record-edit" type="button" onClick={() => editarRegistro(registro)} data-testid={`button-curral-editar-registro-${registro.id}`}>
                        Editar
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {fotoEmFoco && (
        <div className="curral-photo-lightbox" role="dialog" aria-modal="true" data-testid="dialog-curral-foto">
          <button type="button" onClick={() => setFotoEmFoco(null)} data-testid="button-curral-fechar-foto" aria-label="Fechar foto">×</button>
          <img src={fotoEmFoco} alt="Foto ampliada do registro" />
        </div>
      )}
    </main>
  )
}