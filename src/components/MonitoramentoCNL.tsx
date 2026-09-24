import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './MonitoramentoCNL.css'

export type EstacaoCNL = {
  id: number
  uf: string
  cidade: string
  nome: string
  codigo: string
  ultimoValor: number | null
  dataHora: string
  precipitacaoAtual: number | null
  precipitacaoDataHora: string
  precipitacaoDiaria: PrecipitacaoDia[]
  acumulados: {
    umaHora: number | null
    seisHoras: number | null
    dozeHoras: number | null
    vinteQuatroHoras: number | null
    quarentaEOitoHoras: number | null
    setentaEDuasHoras: number | null
    noventaESeisHoras: number | null
  }
}

type PrecipitacaoDia = {
  data: string
  total: number
  pontos: number
  ultimaDataHora: string
}

export type LeituraCNL = EstacaoCNL & {
  latitude: number | null
  longitude: number | null
  tipo: string
  status: string
  cotas: CotasCNL
}

type CotasCNL = {
  atencao: number | null
  alerta: number | null
  transbordamento: number | null
}

export type PontoSerie = {
  data: string
  hora: string
  valor: number
}

export type PontoNivel = {
  dataHora: string
  valor: number
}

type NivelAtual = PontoNivel & {
  qualificacao?: string
}

type DadosCNL = {
  sucesso: boolean
  estacao: LeituraCNL
  estacoes: EstacaoCNL[]
  serie: PontoSerie[]
  serieChuvaCentro?: PontoSerie[]
  estacaoChuvaCentro?: { nome: string; codigo?: string } | null
  nivelAtual: NivelAtual | null
  serieNivel: PontoNivel[]
  cotasConfiguradas?: boolean
  atualizadoEm: string
  fonte: string
  aviso?: string
}

type Props = {
  onAbrirMapa?: (latitude: number, longitude: number, nome: string) => void
}

type ControleAlertaSonoro = {
  contexto: AudioContext
  osciladores: OscillatorNode[]
  timer: number | null
}

const INTERVALO_ATUALIZACAO = 5 * 60 * 1000
const FUSO_HORARIO = 'America/Sao_Paulo'
const DURACAO_ALERTA_SONORO_MS = 5000
const CHAVE_CACHE_MONITORAMENTO = 'monitoramento-cnl-cache-v1'

function lerCacheMonitoramento(): DadosCNL | null {
  try {
    const bruto = window.localStorage.getItem(CHAVE_CACHE_MONITORAMENTO)
    if (!bruto) return null
    const dados = JSON.parse(bruto) as DadosCNL
    if (
      dados?.sucesso !== true ||
      !dados.estacao ||
      !Array.isArray(dados.estacoes) ||
      !Array.isArray(dados.serie) ||
      !Array.isArray(dados.serieNivel)
    ) return null
    return dados
  } catch {
    return null
  }
}

function formatarMm(valor: number | null | undefined): string {
  return valor == null || !Number.isFinite(valor) ? '—' : `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mm`
}

function formatarCota(valor: number | null | undefined): string {
  return valor == null || !Number.isFinite(valor) ? '—' : `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m`
}

function formatarDiaPrecipitacao(data: string): string {
  const partes = data.split('-')
  return partes.length === 3 ? `${partes[2]}/${partes[1]}` : data
}

function formatarDataHora(iso?: string): string {
  if (!iso) return '—'
  const data = parseDataCemaden(iso)
  return data
    ? data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: FUSO_HORARIO })
    : iso
}

function parseDataCemaden(valor: string): Date | null {
  const texto = String(valor || '').trim()
  const brasileiro = texto.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (brasileiro) {
    const ano = Number(brasileiro[3].length === 2 ? `20${brasileiro[3]}` : brasileiro[3])
    const data = new Date(Date.UTC(ano, Number(brasileiro[2]) - 1, Number(brasileiro[1]), Number(brasileiro[4]), Number(brasileiro[5]), Number(brasileiro[6] || 0)))
    return Number.isNaN(data.getTime()) ? null : data
  }
  const isoSemFuso = texto.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/)
  const data = new Date(isoSemFuso ? `${isoSemFuso[1]}T${isoSemFuso[2]}Z` : texto)
  return Number.isNaN(data.getTime()) ? null : data
}

function estadoEstacao(dataHora: string): 'atualizada' | 'atencao' | 'sem-dados' {
  const data = parseDataCemaden(dataHora)
  if (!data) return 'sem-dados'
  const horas = (Date.now() - data.getTime()) / (60 * 60 * 1000)
  if (horas <= 3) return 'atualizada'
  if (horas <= 24) return 'atencao'
  return 'sem-dados'
}

function rotuloEstado(estado: ReturnType<typeof estadoEstacao>): string {
  if (estado === 'atualizada') return 'Atualizada'
  if (estado === 'atencao') return 'Atenção'
  return 'Sem dados recentes'
}

export function ChartaChuva({
  pontos,
  estacao,
  mostrarControles = false,
}: {
  pontos: PontoSerie[]
  estacao?: { nome: string; codigo?: string } | null
  mostrarControles?: boolean
}) {
  const [periodo, setPeriodo] = useState<6 | 12 | 24>(24)
  const pontosVisiveis = pontos.slice(-periodo)
  const largura = 900
  const altura = 330
  const margem = { topo: 42, direita: 20, baixo: 58, esquerda: 56 }
  const acumulados = pontosVisiveis.reduce<number[]>((totais, ponto) => {
    totais.push((totais.at(-1) || 0) + ponto.valor)
    return totais
  }, [])
  const maior = Math.max(...acumulados, 1)
  const areaLargura = largura - margem.esquerda - margem.direita
  const areaAltura = altura - margem.topo - margem.baixo
  const pontoX = (indice: number) => margem.esquerda + (pontosVisiveis.length <= 1 ? areaLargura / 2 : indice * areaLargura / (pontosVisiveis.length - 1))
  const escalaY = (valor: number) => margem.topo + areaAltura - (valor / maior) * areaAltura
  const pontosSvg = acumulados.map((valor, indice) => {
    const x = pontoX(indice)
    const y = escalaY(valor)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const dataMaisRecente = pontosVisiveis.at(-1)?.data
  const larguraBarra = Math.max(4, Math.min(22, areaLargura / Math.max(pontosVisiveis.length, 1) * .58))

  if (pontosVisiveis.length === 0) {
    return <div className="cnl-grafico-vazio">A estação ainda não retornou pontos horários para o período.</div>
  }

  return (
    <div className="cnl-grafico-wrap">
      {mostrarControles && (
        <div className="cnl-chuva-controles">
          <label>Horas:
            <select value={periodo} onChange={(evento) => setPeriodo(Number(evento.target.value) as 6 | 12 | 24)}>
              <option value={6}>6</option>
              <option value={12}>12</option>
              <option value={24}>24</option>
            </select>
          </label>
        </div>
      )}
        <svg className="cnl-grafico cnl-grafico-chuva" viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" role="img" aria-label={`Precipitação acumulada em ${periodo} horas${estacao?.nome ? ` na estação ${estacao.nome}` : ''}`}>
        <text x={largura / 2} y="18" textAnchor="middle" className="cnl-grafico-chuva-titulo">
          {`Precipitação Acumulada em ${periodo}h${estacao?.nome ? ` | Estação: ${estacao.nome}${estacao.codigo ? ` (${estacao.codigo})` : ''}` : ''}`}
        </text>
        {[0, 0.25, 0.5, 0.75, 1].map((proporcao) => {
          const y = escalaY(maior * proporcao)
          return (
            <g key={proporcao}>
              <line x1={margem.esquerda} x2={largura - margem.direita} y1={y} y2={y} className="cnl-grafico-grade" />
              <text x={margem.esquerda - 9} y={y + 4} textAnchor="end" className="cnl-grafico-label">{formatarMm(maior * proporcao)}</text>
            </g>
          )
        })}
        {pontosVisiveis.map((ponto, indice) => {
          const x = pontoX(indice)
          const y = margem.topo + areaAltura
          const alturaBarra = Math.max(0, (ponto.valor / maior) * areaAltura)
          return (
            <rect
              key={`${ponto.data}-${ponto.hora}-${indice}`}
              x={x - larguraBarra / 2}
              y={y - alturaBarra}
              width={larguraBarra}
              height={alturaBarra}
              rx="1"
              className={`cnl-grafico-chuva-bar${ponto.data === dataMaisRecente ? ' cnl-grafico-chuva-bar-atual' : ''}`}
            >
              <title>{`${formatarPontoChuva(ponto)} · chuva da hora: ${formatarMm(ponto.valor)}`}</title>
            </rect>
          )
        })}
        <polyline points={pontosSvg} className="cnl-grafico-linha cnl-grafico-linha-chuva" />
        {pontosVisiveis.map((ponto, indice) => {
          const x = pontoX(indice)
          const y = escalaY(acumulados[indice])
          const rotuloY = Math.max(margem.topo + 30, y - 9)
          const hora = formatarHoraPontoChuva(ponto)
          return (
            <g key={`${ponto.data}-${ponto.hora}-${indice}`}>
              <circle cx={x} cy={y} r="4" className="cnl-grafico-ponto cnl-grafico-ponto-chuva">
                <title>{`${formatarPontoChuva(ponto)} · chuva: ${formatarMm(ponto.valor)} · acumulado: ${formatarMm(acumulados[indice])}`}</title>
              </circle>
              <text x={x} y={rotuloY} textAnchor="middle" className="cnl-grafico-label cnl-grafico-label-chuva">
                {formatarMm(acumulados[indice])}
              </text>
              <text x={x} y={altura - margem.baixo + 18} textAnchor="end" className="cnl-grafico-label cnl-grafico-label-data" transform={`rotate(-42 ${x} ${altura - margem.baixo + 18})`}>
                {hora}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="cnl-chuva-legenda">
        <span><i className="cnl-chuva-legenda-bar" /> Chuva por hora</span>
        <span><i className="cnl-chuva-legenda-linha" /> Acumulado</span>
        <small>Valores em milímetros · horário informado pelo CEMADEN</small>
      </div>
    </div>
  )
}

function formatarPontoChuva(ponto?: PontoSerie): string {
  if (!ponto) return '—'
  const hora = ponto.hora.match(/\d{1,2}/)?.[0]
  return hora ? formatarDataHora(`${ponto.data} ${hora.padStart(2, '0')}:00`) : ponto.hora
}

function formatarHoraPontoChuva(ponto: PontoSerie): string {
  const hora = ponto.hora.match(/\d{1,2}/)?.[0]
  return hora ? `${hora.padStart(2, '0')}h` : ponto.hora
}

function formatarRotuloEixoNivel(dataHora?: string): string {
  if (!dataHora) return '—'
  const data = parseDataCemaden(dataHora)
  if (!data) return dataHora
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: FUSO_HORARIO,
  }).replace(',', '')
}

function formatarDataNivel(dataHora: string): string {
  const data = parseDataCemaden(dataHora)
  if (!data) return dataHora
  return data.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: FUSO_HORARIO,
  })
}

function formatarHoraNivel(dataHora: string): string {
  const data = parseDataCemaden(dataHora)
  if (!data) return '—'
  return data.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: FUSO_HORARIO,
  })
}

export function GraficoNivel({ pontos, estacao, mostrarTooltip = true, mostrarFonte = true, mostrarLeituraAtual = false }: { pontos: PontoNivel[]; estacao: LeituraCNL; mostrarTooltip?: boolean; mostrarFonte?: boolean; mostrarLeituraAtual?: boolean }) {
  const [periodo, setPeriodo] = useState<6 | 12 | 24>(24)
  const [dataHoraSelecionada, setDataHoraSelecionada] = useState<string | null>(null)
  const [dataHoraEmFoco, setDataHoraEmFoco] = useState<string | null>(null)
  const pontosVisiveis = pontos.slice(-periodo)
  const largura = 900
  const altura = 370
  const margem = { topo: 98, direita: 20, baixo: 72, esquerda: 56 }
  const valores = pontosVisiveis.map((ponto) => ponto.valor)
  const maiorValor = Math.max(...valores, 0)
  const maior = Math.max(0.4, Math.ceil((maiorValor * 1.15) / 0.1) * 0.1)
  const areaLargura = largura - margem.esquerda - margem.direita
  const areaAltura = altura - margem.topo - margem.baixo
  const escalaY = (valor: number) => margem.topo + areaAltura - (valor / maior) * areaAltura
  const pontoX = (indice: number) => margem.esquerda + (pontosVisiveis.length <= 1 ? areaLargura / 2 : indice * areaLargura / (pontosVisiveis.length - 1))
  const pontosSvg = pontosVisiveis.map((ponto, indice) => `${pontoX(indice).toFixed(1)},${escalaY(ponto.valor).toFixed(1)}`).join(' ')
  const areaSvg = pontosVisiveis.length > 0
    ? `${margem.esquerda},${margem.topo + areaAltura} ${pontosSvg} ${pontoX(pontosVisiveis.length - 1)},${margem.topo + areaAltura}`
    : ''
  const intervaloRotulo = Math.max(1, Math.ceil(pontosVisiveis.length / 8))
  const ultimoPonto = pontosVisiveis.at(-1)
  const pontoSelecionado = pontosVisiveis.find((ponto) => ponto.dataHora === dataHoraSelecionada) || ultimoPonto
  const pontoEmFoco = pontosVisiveis.find((ponto) => ponto.dataHora === dataHoraEmFoco) || pontoSelecionado
  const indiceSelecionado = pontoEmFoco ? pontosVisiveis.indexOf(pontoEmFoco) : -1
  const pontoSelecionadoX = indiceSelecionado >= 0 ? pontoX(indiceSelecionado) : 0
  const pontoSelecionadoY = pontoEmFoco ? escalaY(pontoEmFoco.valor) : 0

  if (pontos.length === 0) {
    return <div className="cnl-grafico-vazio">A estação ainda não retornou pontos de nível para o período.</div>
  }

  return (
    <div className="cnl-grafico-cemaden">
      <div className="cnl-grafico-cemaden-controles">
        <label htmlFor="cnl-periodo-nivel">Período:</label>
        <select id="cnl-periodo-nivel" value={periodo} onChange={(evento) => setPeriodo(Number(evento.target.value) as 6 | 12 | 24)}>
          <option value={6}>6 horas</option>
          <option value={12}>12 horas</option>
          <option value={24}>24 horas</option>
        </select>
      </div>
      <div className="cnl-grafico-cemaden-cabecalho">
        <strong>MUNICÍPIO: {estacao.cidade.toUpperCase() || 'CONSELHEIRO LAFAIETE'}/MG</strong>
        <span>Estação: {estacao.nome} ({estacao.codigo || `CEMADEN ${estacao.id}`})</span>
        {mostrarLeituraAtual && <strong className="cnl-grafico-leitura-atual">Leitura atual: {formatarCota(ultimoPonto?.valor)}</strong>}
        {mostrarFonte && <small>Fonte: Estações Hidrológicas - Cemaden · Horário de Brasília</small>}
      </div>
      <div className="cnl-grafico-wrap">
        <svg className="cnl-grafico cnl-grafico-nivel-cemaden" viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" role="img" aria-label={`Nível do ${estacao.nome} nas últimas ${periodo} horas`}>
          <defs>
            <linearGradient id="cnl-agua-gradiente" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#8fc0e9" />
              <stop offset="100%" stopColor="#73aee0" />
            </linearGradient>
            <pattern id="cnl-agua-ondas" width="34" height="12" patternUnits="userSpaceOnUse">
              <path d="M0 6 C5 2, 12 2, 17 6 S29 10, 34 6" fill="none" stroke="#fff" strokeOpacity="0.2" strokeWidth="1" />
            </pattern>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((proporcao) => {
            const y = margem.topo + areaAltura - proporcao * areaAltura
            return (
              <g key={proporcao}>
                <line x1={margem.esquerda} x2={largura - margem.direita} y1={y} y2={y} className="cnl-grafico-grade" />
                <text x={margem.esquerda - 9} y={y + 4} textAnchor="end" className="cnl-grafico-label">
                  {(maior * proporcao).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                </text>
              </g>
            )
          })}
          <text x="14" y={margem.topo + areaAltura / 2} textAnchor="middle" className="cnl-grafico-eixo-y">Nível (m)</text>
          <polygon points={areaSvg} fill="url(#cnl-agua-gradiente)" className="cnl-grafico-area-nivel" />
          <polygon points={areaSvg} fill="url(#cnl-agua-ondas)" className="cnl-grafico-area-ondas" aria-hidden="true" />
          <polyline points={pontosSvg} className="cnl-grafico-linha cnl-grafico-linha-nivel" />
          {pontosVisiveis.map((ponto, indice) => {
            const x = pontoX(indice)
            const y = escalaY(ponto.valor)
            const mostrarRotulo = indice === 0 || indice === pontosVisiveis.length - 1 || indice % intervaloRotulo === 0
            const selecionado = ponto.dataHora === pontoSelecionado?.dataHora
            const selecionarPonto = () => setDataHoraSelecionada(ponto.dataHora)
            return (
              <g key={`${ponto.dataHora}-${indice}`}>
                <g
                  className={`cnl-grafico-ponto-clicavel${selecionado ? ' cnl-grafico-ponto-selecionado' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Selecionar leitura de ${formatarDataNivel(ponto.dataHora)} às ${formatarHoraNivel(ponto.dataHora)}, nível ${formatarCota(ponto.valor)}`}
                  onClick={selecionarPonto}
                    onMouseEnter={() => setDataHoraEmFoco(ponto.dataHora)}
                    onMouseLeave={() => setDataHoraEmFoco(null)}
                  onKeyDown={(evento) => {
                    if (evento.key === 'Enter' || evento.key === ' ') {
                      evento.preventDefault()
                      selecionarPonto()
                    }
                  }}
                >
                  <circle cx={x} cy={y} r="10" className="cnl-grafico-ponto-area-clique" />
                  <circle cx={x} cy={y} r="3.5" className="cnl-grafico-ponto cnl-grafico-ponto-nivel">
                    <title>{`${formatarRotuloEixoNivel(ponto.dataHora)} · ${formatarCota(ponto.valor)}`}</title>
                  </circle>
                </g>
                {mostrarRotulo && (
                  <text x={x} y={margem.topo + areaAltura + 16} textAnchor="end" className="cnl-grafico-label cnl-grafico-label-data" transform={`rotate(-42 ${x} ${margem.topo + areaAltura + 16})`}>
                    {formatarRotuloEixoNivel(ponto.dataHora)}
                  </text>
                )}
              </g>
            )
          })}
          {mostrarTooltip && pontoSelecionado && (
            <g className="cnl-grafico-tooltip">
              <line x1={pontoSelecionadoX} x2={pontoSelecionadoX} y1={pontoSelecionadoY - 7} y2="91" />
              <rect x="530" y="8" width="350" height="86" rx="7" />
              <text x="546" y="27" className="cnl-grafico-tooltip-titulo">Leitura selecionada</text>
              <text x="546" y="45">{formatarDataNivel(pontoEmFoco.dataHora)}</text>
              <text x="546" y="61">Hora: {formatarHoraNivel(pontoEmFoco.dataHora)} · Horário de Brasília</text>
              <text x="546" y="80" className="cnl-grafico-tooltip-valor">Cota medida: {formatarCota(pontoEmFoco.valor)}</text>
            </g>
          )}
        </svg>
      </div>
      <div className="cnl-grafico-cemaden-legenda"><span className="cnl-legenda-area" /> Nível (m) · Clique nas bolinhas para consultar cada leitura</div>
    </div>
  )
}

function CartaoMetrica({ rotulo, valor, detalhe, classe = '' }: { rotulo: string; valor: string; detalhe: string; classe?: string }) {
  return (
    <div className={`cnl-metrica ${classe}`}>
      <span className="cnl-metrica-rotulo">{rotulo}</span>
      <strong>{valor}</strong>
      <span className="cnl-metrica-detalhe">{detalhe}</span>
    </div>
  )
}

export default function MonitoramentoCNL({ onAbrirMapa }: Props) {
  const [dados, setDados] = useState<DadosCNL | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState('')
  const [editandoCotas, setEditandoCotas] = useState(false)
  const [salvandoCotas, setSalvandoCotas] = useState(false)
  const [erroCotas, setErroCotas] = useState('')
  const [cotasSalvas, setCotasSalvas] = useState('')
  const [cotasForm, setCotasForm] = useState({ atencao: '', alerta: '', transbordamento: '' })
  const [audioBloqueado, setAudioBloqueado] = useState(false)
  const [audioAtivo, setAudioAtivo] = useState(false)
  const audioRef = useRef<ControleAlertaSonoro | null>(null)
  const alertaSonoroPendenteRef = useRef(false)
  const estadoNivelAnteriorRef = useRef<EstadoNivel | null>(null)
  const assinaturaCotasAnteriorRef = useRef('')

  const carregar = useCallback(async () => {
    setAtualizando(true)
    try {
      const resposta = await fetch('/api/monitoramento-cnl', { cache: 'no-store' })
      const corpo = await resposta.json() as DadosCNL & { erro?: string }
      if (!resposta.ok || !corpo.sucesso) throw new Error(corpo.erro || 'O CEMADEN não retornou dados.')
      setDados(corpo)
      setErro('')
      try {
        window.localStorage.setItem(CHAVE_CACHE_MONITORAMENTO, JSON.stringify(corpo))
      } catch {
        // O cache local é opcional; a consulta ao vivo continua funcionando sem espaço de armazenamento.
      }
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível consultar o CEMADEN.')
      const cache = lerCacheMonitoramento()
      setDados((anterior) => {
        const ultimoValido = anterior || cache
        return ultimoValido
          ? {
              ...ultimoValido,
              aviso: 'Não foi possível atualizar os dados do CEMADEN. Exibindo a última consulta válida; uma nova tentativa será feita em breve.',
            }
          : null
      })
    } finally {
      setCarregando(false)
      setAtualizando(false)
    }
  }, [])

  useEffect(() => {
    carregar()
    const timer = window.setInterval(carregar, INTERVALO_ATUALIZACAO)
    return () => window.clearInterval(timer)
  }, [carregar])

  useEffect(() => {
    if (!dados || editandoCotas) return
    setCotasForm({
      atencao: dados.estacao.cotas.atencao?.toString() || '',
      alerta: dados.estacao.cotas.alerta?.toString() || '',
      transbordamento: dados.estacao.cotas.transbordamento?.toString() || '',
    })
  }, [dados, editandoCotas])

  const iniciarEdicaoCotas = () => {
    if (!dados) return
    setCotasForm({
      atencao: dados.estacao.cotas.atencao?.toString() || '',
      alerta: dados.estacao.cotas.alerta?.toString() || '',
      transbordamento: dados.estacao.cotas.transbordamento?.toString() || '',
    })
    setErroCotas('')
    setCotasSalvas('')
    setEditandoCotas(true)
  }

  const salvarCotas = async () => {
    const valores = {
      atencao: Number(cotasForm.atencao.replace(',', '.')),
      alerta: Number(cotasForm.alerta.replace(',', '.')),
      transbordamento: Number(cotasForm.transbordamento.replace(',', '.')),
    }
    if (!Object.values(valores).every((valor) => Number.isFinite(valor) && valor >= 0 && valor <= 100)) {
      setErroCotas('Informe valores entre 0 e 100 metros.')
      return
    }
    if (!(valores.atencao < valores.alerta && valores.alerta < valores.transbordamento)) {
      setErroCotas('A ordem precisa ser: Atenção < Alerta < Transbordamento.')
      return
    }

    setSalvandoCotas(true)
    setErroCotas('')
    try {
      const resposta = await fetch('/api/monitoramento-cnl/cotas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(valores),
      })
      const corpo = await resposta.json() as { sucesso?: boolean; cotas?: CotasCNL; erro?: string }
      if (!resposta.ok || !corpo.sucesso || !corpo.cotas) throw new Error(corpo.erro || 'Não foi possível salvar as cotas.')
      setDados((anterior) => anterior ? {
        ...anterior,
        cotasConfiguradas: true,
        estacao: { ...anterior.estacao, cotas: corpo.cotas! },
      } : anterior)
      setEditandoCotas(false)
      setCotasSalvas('Cotas salvas para todos os agentes do monitoramento.')
    } catch (falha) {
      setErroCotas(falha instanceof Error ? falha.message : 'Não foi possível salvar as cotas.')
    } finally {
      setSalvandoCotas(false)
    }
  }

  const estadoNivelAtual = dados ? estadoNivel(dados.nivelAtual?.valor, dados.estacao.cotas) : 'sem-dados'

  const pararAlertaSonoro = useCallback(() => {
    const controle = audioRef.current
    if (!controle) return
    controle.osciladores.forEach((oscilador) => {
      try { oscilador.stop() } catch { /* já pode ter parado naturalmente */ }
    })
    if (controle.timer != null) window.clearTimeout(controle.timer)
    audioRef.current = null
  }, [])

  const prepararAudio = useCallback(async (): Promise<AudioContext | null> => {
    if (typeof window === 'undefined') return null
    const AudioContexto = window.AudioContext
      || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContexto) {
      setAudioBloqueado(true)
      return null
    }

    let contexto = audioRef.current?.contexto
    if (!contexto) {
      contexto = new AudioContexto()
      audioRef.current = { contexto, osciladores: [], timer: null }
    }

    try {
      if (contexto.state !== 'running') await contexto.resume()
    } catch {
      setAudioBloqueado(true)
      return null
    }
    if (contexto.state !== 'running') {
      setAudioBloqueado(true)
      return null
    }
    setAudioBloqueado(false)
    return contexto
  }, [])

  const tocarAlertaSonoro = useCallback(async () => {
    const contexto = await prepararAudio()
    if (!contexto) {
      alertaSonoroPendenteRef.current = true
      setAudioAtivo(false)
      return
    }

    pararAlertaSonoro()
    const osciladores: OscillatorNode[] = []
    const inicio = contexto.currentTime
    const duracao = DURACAO_ALERTA_SONORO_MS / 1000
    const intervalo = 0.62

    for (let indice = 0; indice < 8; indice += 1) {
      const inicioNota = inicio + indice * intervalo
      const fimNota = Math.min(inicio + duracao - 0.05, inicioNota + 0.24)
      const oscilador = contexto.createOscillator()
      const ganho = contexto.createGain()
      oscilador.type = 'sine'
      oscilador.frequency.setValueAtTime(indice % 2 === 0 ? 880 : 660, inicioNota)
      ganho.gain.setValueAtTime(0.0001, inicioNota)
      ganho.gain.exponentialRampToValueAtTime(0.18, inicioNota + 0.025)
      ganho.gain.exponentialRampToValueAtTime(0.0001, fimNota)
      oscilador.connect(ganho)
      ganho.connect(contexto.destination)
      oscilador.start(inicioNota)
      oscilador.stop(fimNota)
      osciladores.push(oscilador)
    }

    const timer = window.setTimeout(() => {
      if (audioRef.current?.osciladores === osciladores) {
        audioRef.current.osciladores = []
        audioRef.current.timer = null
      }
    }, DURACAO_ALERTA_SONORO_MS + 150)
    audioRef.current = { contexto, osciladores, timer }
    alertaSonoroPendenteRef.current = false
  }, [pararAlertaSonoro, prepararAudio])

  const ativarAlertasSonoros = useCallback(async () => {
    const contexto = await prepararAudio()
    if (!contexto) {
      setAudioAtivo(false)
      return
    }

    setAudioAtivo(true)
    if (alertaSonoroPendenteRef.current) {
      await tocarAlertaSonoro()
    }
  }, [prepararAudio, tocarAlertaSonoro])

  useEffect(() => () => pararAlertaSonoro(), [pararAlertaSonoro])

  useEffect(() => {
    const leitura = dados?.nivelAtual
    const cotas = dados?.estacao.cotas
    if (!leitura || leitura.valor == null || estadoNivelAtual === 'sem-dados' || !cotas) return
    const assinaturaCotas = [cotas.atencao, cotas.alerta, cotas.transbordamento].join('|')
    let estadoAnterior: EstadoNivel | null = null
    try {
      const salvo = JSON.parse(localStorage.getItem('cnl-estado-nivel-monitoramento') || 'null') as {
        estado?: EstadoNivel
        cotas?: string
      } | null
      if (salvo?.cotas === assinaturaCotas) estadoAnterior = salvo.estado || null
    } catch {
      // A referência em memória mantém o comportamento nesta sessão.
    }

    if (assinaturaCotasAnteriorRef.current === assinaturaCotas && estadoNivelAnteriorRef.current) {
      estadoAnterior = estadoNivelAnteriorRef.current
    }
    const deveAlertar = nivelMaior(estadoNivelAtual, estadoAnterior)
    estadoNivelAnteriorRef.current = estadoNivelAtual
    assinaturaCotasAnteriorRef.current = assinaturaCotas
    try {
      localStorage.setItem('cnl-estado-nivel-monitoramento', JSON.stringify({
        estado: estadoNivelAtual,
        cotas: assinaturaCotas,
      }))
    } catch {
      // O alerta visível na página continua funcionando sem localStorage.
    }

    if (!deveAlertar || estadoNivelAtual === 'normal') return
    const cotaAtingida = cotas[estadoNivelAtual]
    if (cotaAtingida == null) return

    if (audioAtivo) {
      void tocarAlertaSonoro()
    } else {
      alertaSonoroPendenteRef.current = true
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(`Rio Bananeiras · ${rotuloNivel(estadoNivelAtual)}`, {
        body: `Nível atual: ${formatarCota(leitura.valor)}. Cota de referência: ${formatarCota(cotaAtingida)}.`,
        tag: `cnl-nivel-${estadoNivelAtual}`,
      })
    }
  }, [audioAtivo, dados, estadoNivelAtual, tocarAlertaSonoro])

  const acumulado24h = useMemo(() => {
    if (!dados) return null
    return dados.estacao.acumulados.vinteQuatroHoras
  }, [dados])

  const diasPrecipitacao = useMemo(() => {
    if (!dados) return []
    return [...new Set(dados.estacoes.flatMap((estacao) => estacao.precipitacaoDiaria.map((dia) => dia.data)))]
      .sort()
      .reverse()
      .slice(0, 2)
  }, [dados])

  if (carregando && !dados) {
    return <div className="cnl-pagina"><div className="cnl-carregando">Consultando estações do CEMADEN…</div></div>
  }

  if (!dados) {
    return (
      <div className="cnl-pagina">
        <div className="cnl-erro">
          <strong>Monitoramento temporariamente indisponível</strong>
          <span>{erro || 'Não foi possível carregar a estação Rio Bananeiras.'}</span>
          <button className="cnl-btn-principal" onClick={carregar}>Tentar novamente</button>
        </div>
      </div>
    )
  }

  const { estacao } = dados
  const estadoPrincipal = estadoEstacao(estacao.dataHora)
  return (
    <div className="cnl-pagina">
      <section className="cnl-cabecalho">
        <div className="cnl-kicker"><span className="cnl-pulse" /> CNL · Centro de Monitoramento</div>
        <div className="cnl-titulo-linha">
          <div>
            <h1>Monitoramento CNL</h1>
            <p>Cheias, chuva e estações de Conselheiro Lafaiete</p>
          </div>
          <button className="cnl-btn-atualizar" onClick={carregar} disabled={atualizando} title="Atualizar agora">
            {atualizando ? '⟳' : '↻'} <span>{atualizando ? 'Consultando' : 'Atualizar'}</span>
          </button>
        </div>
        <div className="cnl-fonte-strip">
          <span>Fonte oficial: CEMADEN</span>
          <span>Última consulta: {formatarDataHora(dados.atualizadoEm)}</span>
        </div>
      </section>

      {erro && <div className="cnl-aviso-atualizacao">Não foi possível atualizar agora. Exibindo a última leitura válida.</div>}

      <section className="cnl-hero">
        <div className="cnl-hero-identidade">
          <div className="cnl-icone-agua">≋</div>
          <div>
            <span className="cnl-eyebrow">Estação hidrológica monitorada</span>
            <h2>{estacao.nome}</h2>
            <p>{estacao.cidade} · {estacao.codigo}</p>
          </div>
        </div>
        <div className={`cnl-status-principal cnl-status-${estadoPrincipal}`}>
          <span className="cnl-status-ponto" />
          <div><strong>{rotuloEstado(estadoPrincipal)}</strong><small>{formatarDataHora(estacao.dataHora) || 'Sem horário'} · Brasília</small></div>
        </div>
        <div className="cnl-hero-acoes">
          {onAbrirMapa && estacao.latitude != null && estacao.longitude != null && (
            <button className="cnl-btn-secundario" onClick={() => onAbrirMapa(estacao.latitude!, estacao.longitude!, estacao.nome)}>
              ⌖ Abrir no mapa
            </button>
          )}
          <a className="cnl-btn-secundario" href="https://resources.cemaden.gov.br/graficos/interativo/grafico_pcds.php?idpcd=6622" target="_blank" rel="noreferrer">
            Ver CEMADEN ↗
          </a>
        </div>
      </section>

      <section className="cnl-metricas">
        <CartaoMetrica
          rotulo="Nível atual do rio"
          valor={formatarCota(dados.nivelAtual?.valor)}
          detalhe={`Leitura em ${formatarDataHora(dados.nivelAtual?.dataHora)}`}
          classe="cnl-metrica-azul"
        />
        <CartaoMetrica
          rotulo="Chuva na última hora"
          valor={formatarMm(estacao.precipitacaoAtual)}
          detalhe={`Leitura em ${formatarDataHora(estacao.precipitacaoDataHora)}`}
          classe="cnl-metrica-verde"
        />
        <CartaoMetrica
          rotulo="Acumulado móvel em 24h"
          valor={formatarMm(acumulado24h)}
          detalhe="Janela móvel informada pelo CEMADEN"
          classe={acumulado24h != null && acumulado24h >= 30 ? 'cnl-metrica-laranja' : 'cnl-metrica-verde'}
        />
        <CartaoMetrica
          rotulo="Status do nível"
          valor={rotuloNivel(estadoNivelAtual)}
          detalhe={`Alerta a partir de ${formatarCota(estacao.cotas.alerta)}`}
          classe="cnl-metrica-roxa"
        />
      </section>

      <section className={`cnl-nivel-destaque cnl-nivel-${estadoNivelAtual}`}>
        <div className="cnl-nivel-icone">≋</div>
        <div className="cnl-nivel-conteudo">
          <span className="cnl-eyebrow">Leitura hidrológica em tempo real</span>
          <strong>{formatarCota(dados.nivelAtual?.valor)}</strong>
          <span>{rotuloNivel(estadoNivelAtual)} · última leitura {formatarDataHora(dados.nivelAtual?.dataHora)}</span>
        </div>
        <p>Fonte oficial CEMADEN. Atualização automática a cada 5 minutos.</p>
      </section>

      {estadoNivelAtual !== 'normal' && estadoNivelAtual !== 'sem-dados' && dados.nivelAtual && (
        <section className={`cnl-alerta cnl-alerta-${estadoNivelAtual}`} role="alert">
          <div className="cnl-alerta-icone">!</div>
          <div>
            <strong>Notificação de {rotuloNivel(estadoNivelAtual).toLowerCase()}</strong>
            <p>O nível do Rio Bananeiras está em {formatarCota(dados.nivelAtual.valor)}, atingindo a cota de {formatarCota(estacao.cotas[estadoNivelAtual])}. Acompanhe a evolução e prepare a resposta.</p>
          </div>
        </section>
      )}

      <section className="cnl-bloco">
        <div className="cnl-bloco-cabecalho">
          <div><span className="cnl-eyebrow">Chuva acumulada</span><h2>Últimas 24 horas</h2></div>
          <span className="cnl-badge-fonte">Atualização automática · 5 min</span>
        </div>
        <ChartaChuva
          pontos={dados.serieChuvaCentro || []}
          estacao={dados.estacaoChuvaCentro}
        />
      </section>

      <section className="cnl-bloco cnl-bloco-grafico-nivel">
        <div className="cnl-bloco-cabecalho">
          <div><span className="cnl-eyebrow">Cota instantânea</span><h2>Nível do Rio Bananeiras</h2></div>
          <span className="cnl-badge-fonte cnl-badge-ao-vivo"><span className="cnl-badge-ponto" /> ao vivo · 5 min · Brasília</span>
        </div>
        <GraficoNivel pontos={dados.serieNivel} estacao={estacao} />
      </section>

      <section className="cnl-bloco">
        <div className="cnl-bloco-cabecalho">
          <div><span className="cnl-eyebrow">Referência hidrológica</span><h2>Cotas de acompanhamento</h2></div>
          {!editandoCotas && <button className="cnl-btn-editar" onClick={iniciarEdicaoCotas}>✎ Editar cotas</button>}
        </div>
        {editandoCotas ? (
          <div className="cnl-cotas-editor">
            <p>Os valores atuais vieram do CEMADEN. Ajuste as referências usadas pelos alertas do aplicativo.</p>
            <div className="cnl-cotas">
              {([
                ['atencao', 'Atenção', 'começar a observar'],
                ['alerta', 'Alerta', 'preparar resposta'],
                ['transbordamento', 'Transbordamento', 'risco de cheia'],
              ] as const).map(([chave, rotulo, descricao]) => (
                <label key={chave} className={`cnl-cota cnl-cota-${chave}`}>
                  <span className="cnl-cota-linha" />
                  <span>{rotulo}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={cotasForm[chave]}
                    onChange={(evento) => setCotasForm((anterior) => ({ ...anterior, [chave]: evento.target.value }))}
                    aria-label={`Cota de ${rotulo}`}
                  />
                  <small>{descricao} · metros</small>
                </label>
              ))}
            </div>
            {erroCotas && <div className="cnl-cotas-erro" role="alert">{erroCotas}</div>}
            <div className="cnl-cotas-acoes">
              <button className="cnl-btn-cancelar" onClick={() => { setEditandoCotas(false); setErroCotas('') }} disabled={salvandoCotas}>Cancelar</button>
              <button className="cnl-btn-principal cnl-btn-salvar" onClick={salvarCotas} disabled={salvandoCotas}>{salvandoCotas ? 'Salvando…' : 'Salvar cotas'}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="cnl-cotas">
              <div className="cnl-cota cnl-cota-atencao"><span className="cnl-cota-linha" /><span>Atenção</span><strong>{formatarCota(estacao.cotas.atencao)}</strong><small>começar a observar</small></div>
              <div className="cnl-cota cnl-cota-alerta"><span className="cnl-cota-linha" /><span>Alerta</span><strong>{formatarCota(estacao.cotas.alerta)}</strong><small>preparar resposta</small></div>
              <div className="cnl-cota cnl-cota-transbordamento"><span className="cnl-cota-linha" /><span>Transbordamento</span><strong>{formatarCota(estacao.cotas.transbordamento)}</strong><small>risco de cheia</small></div>
            </div>
            <div className="cnl-cotas-rodape">
              <span>{dados.cotasConfiguradas ? 'Referências personalizadas para os alertas do aplicativo.' : 'Referências oficiais atuais do CEMADEN.'}</span>
              <span className={`cnl-audio-status ${audioBloqueado ? 'cnl-audio-status-bloqueado' : ''} ${audioAtivo ? 'cnl-audio-status-ativo' : ''}`}>
                {audioBloqueado
                  ? 'Som bloqueado pelo navegador. Clique para tentar novamente.'
                  : audioAtivo
                    ? 'Alerta sonoro ativo: 5 segundos ao subir de faixa.'
                    : 'Ative o som para alertas de mudança de cota.'}
                <button
                  type="button"
                  className={`cnl-btn-audio ${audioAtivo ? 'cnl-btn-audio-ativo' : ''}`}
                  onClick={ativarAlertasSonoros}
                  aria-pressed={audioAtivo}
                >
                  {audioAtivo ? 'Som ativo' : 'Ativar som'}
                </button>
              </span>
              {cotasSalvas && <strong>{cotasSalvas}</strong>}
            </div>
          </>
        )}
      </section>

      <section className="cnl-bloco">
        <div className="cnl-bloco-cabecalho">
          <div><span className="cnl-eyebrow">Precipitação acumulada</span><h2>Estações de Conselheiro Lafaiete</h2></div>
          <span className="cnl-badge-fonte cnl-badge-ao-vivo"><span className="cnl-badge-ponto" /> atualiza · 5 min</span>
        </div>
        <div className="cnl-tabela-chuva-wrap">
          <div className="cnl-tabela-chuva cnl-tabela-janelas" role="table" aria-label="Precipitação acumulada por estação e janela">
            <div className="cnl-tabela-chuva-linha cnl-tabela-chuva-cabecalho" role="row">
              <strong role="columnheader">Estação</strong>
              <strong role="columnheader">Último</strong>
              {['1', '6', '12', '24', '48', '72', '96'].map((janela) => <strong key={janela} role="columnheader">{janela}</strong>)}
            </div>
            {dados.estacoes.map((item) => {
              const valores = [
                item.ultimoValor,
                item.acumulados.umaHora,
                item.acumulados.seisHoras,
                item.acumulados.dozeHoras,
                item.acumulados.vinteQuatroHoras,
                item.acumulados.quarentaEOitoHoras,
                item.acumulados.setentaEDuasHoras,
                item.acumulados.noventaESeisHoras,
              ]
              return (
                <div key={item.id} className="cnl-tabela-chuva-linha" role="row">
                  <span className="cnl-tabela-chuva-estacao" role="cell">
                    <strong>{item.nome}</strong>
                    <small>{item.codigo || `CEMADEN ${item.id}`}</small>
                  </span>
                  {valores.map((valor, indice) => (
                    <span key={`${item.id}-${indice}`} role="cell" className="cnl-tabela-chuva-total">{formatarMm(valor)}</span>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
        <p className="cnl-tabela-chuva-nota">Valores oficiais do CEMADEN em milímetros. “Último” é a leitura pluviométrica mais recente; as demais colunas são acumulados móveis em horas.</p>

        {diasPrecipitacao.length > 0 && (
          <details className="cnl-diaria-detalhe">
            <summary>Ver acumulado diário por estação</summary>
            <div className="cnl-tabela-chuva-wrap">
              <div className="cnl-tabela-chuva" role="table" aria-label="Acumulado diário de precipitação por estação">
                <div className="cnl-tabela-chuva-linha cnl-tabela-chuva-cabecalho" role="row" style={{ gridTemplateColumns: `minmax(9rem, 1.6fr) repeat(${diasPrecipitacao.length}, minmax(5rem, 1fr))` }}>
                  <strong role="columnheader">Estação</strong>
                  {diasPrecipitacao.map((dia) => <strong key={dia} role="columnheader">{formatarDiaPrecipitacao(dia)}</strong>)}
                </div>
                {dados.estacoes.map((item) => (
                  <div key={item.id} className="cnl-tabela-chuva-linha" role="row" style={{ gridTemplateColumns: `minmax(9rem, 1.6fr) repeat(${diasPrecipitacao.length}, minmax(5rem, 1fr))` }}>
                    <span className="cnl-tabela-chuva-estacao" role="cell"><strong>{item.nome}</strong></span>
                    {diasPrecipitacao.map((dia) => {
                      const leitura = item.precipitacaoDiaria.find((itemDia) => itemDia.data === dia)
                      return <span key={dia} role="cell" className="cnl-tabela-chuva-total">{formatarMm(leitura?.total)}</span>
                    })}
                  </div>
                ))}
              </div>
            </div>
          </details>
        )}
      </section>

      <footer className="cnl-rodape">
        <span>Dados públicos do Centro Nacional de Monitoramento e Alertas de Desastres Naturais.</span>
        <a href={dados.fonte} target="_blank" rel="noreferrer">Abrir fonte original ↗</a>
        {dados.aviso && <small>{dados.aviso}</small>}
      </footer>
    </div>
  )
}

function estacoesAtivas(estacoes: EstacaoCNL[]): number {
  return estacoes.filter((estacao) => estadoEstacao(estacao.dataHora) !== 'sem-dados').length
}

type EstadoNivel = 'normal' | 'atencao' | 'alerta' | 'transbordamento' | 'sem-dados'

const PRIORIDADE_NIVEL: Record<EstadoNivel, number> = {
  'sem-dados': -1,
  normal: 0,
  atencao: 1,
  alerta: 2,
  transbordamento: 3,
}

function nivelMaior(atual: EstadoNivel, anterior: EstadoNivel | null): boolean {
  return PRIORIDADE_NIVEL[atual] > (anterior == null ? PRIORIDADE_NIVEL.normal : PRIORIDADE_NIVEL[anterior])
}

function estadoNivel(valor: number | null | undefined, cotas: LeituraCNL['cotas']): EstadoNivel {
  if (valor == null || !Number.isFinite(valor)) return 'sem-dados'
  if (cotas.transbordamento != null && valor >= cotas.transbordamento) return 'transbordamento'
  if (cotas.alerta != null && valor >= cotas.alerta) return 'alerta'
  if (cotas.atencao != null && valor >= cotas.atencao) return 'atencao'
  return 'normal'
}

function rotuloNivel(estado: EstadoNivel): string {
  if (estado === 'transbordamento') return 'Transbordamento'
  if (estado === 'alerta') return 'Alerta'
  if (estado === 'atencao') return 'Atenção'
  if (estado === 'normal') return 'Normal'
  return 'Sem dados'
}