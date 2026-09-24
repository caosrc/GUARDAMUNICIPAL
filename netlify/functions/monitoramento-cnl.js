const CATALOGO = 'https://resources.cemaden.gov.br/graficos/interativo/getJson2.php?uf=MG'
const RECURSOS = 'https://mapservices.cemaden.gov.br/MapaInterativoWS/resources'
const NIVEL = 'https://resources.cemaden.gov.br/graficos/cemaden/hidro/resources/json/MedidaResource.php?est=6622&sen=20&pag=24'
const FONTE = 'https://resources.cemaden.gov.br/graficos/interativo/grafico_CEMADEN.php?idpcd=6622&uf=MG'
const CNL_ID = 6622
const CNL_ESTACAO_CHUVA_CENTRO_ID = 3121
const CNL_ESTACAO_CHUVA_CENTRO_CODIGO = '311830401H'
const ESTACOES_CHUVA_IDS = new Set([4146, 4144, 3121, 6622, 4145, 4143, 4142])
const COTAS_PADRAO = { atencao: 2.55, alerta: 3.4, transbordamento: 4.25 }
let monitoramentoCnlCache = null
let monitoramentoCnlCacheTs = 0
const MONITORAMENTO_CNL_CACHE_MAX_STALE_MS = 15 * 60 * 1000

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
  body: JSON.stringify(body),
})
const number = value => value == null || value === '-' || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null)

function configurarSupabase() {
  const url = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const key = String(process.env.VITE_SUPABASE_ANON_KEY || '')
  if (!url || !key) return null
  return { endpoint: `${url}/rest/v1/monitoramento_cnl_cotas`, headers: { apikey: key, Authorization: `Bearer ${key}` } }
}

async function buscarCotas() {
  const supabase = configurarSupabase()
  if (!supabase) return { cotas: COTAS_PADRAO, configuradas: false }
  try {
    const response = await fetch(`${supabase.endpoint}?id=eq.1&select=atencao,alerta,transbordamento`, { headers: supabase.headers, signal: AbortSignal.timeout(2500) })
    if (!response.ok) return { cotas: COTAS_PADRAO, configuradas: false }
    const row = (await response.json())?.[0]
    const cotas = { atencao: number(row?.atencao), alerta: number(row?.alerta), transbordamento: number(row?.transbordamento) }
    const validas = Object.values(cotas).every(value => value != null) && cotas.atencao < cotas.alerta && cotas.alerta < cotas.transbordamento
    return validas ? { cotas, configuradas: true } : { cotas: COTAS_PADRAO, configuradas: false }
  } catch { return { cotas: COTAS_PADRAO, configuradas: false } }
}

function extrairSerie(payload) {
  const datas = Array.isArray(payload?.datas) ? payload.datas : []
  const horarios = Array.isArray(payload?.horarios) ? payload.horarios : []
  const pontos = []
  ;(payload?.acumulados || []).forEach((linha, dataIndex) => {
    if (!Array.isArray(linha)) return
    linha.forEach((valor, hourIndex) => {
      const n = number(valor)
      if (n != null && datas[dataIndex] && horarios[hourIndex]) {
        pontos.push({ data: datas[dataIndex], hora: horarios[hourIndex], valor: n })
      }
    })
  })
  return pontos
}

function diaria(serie) {
  const porDia = new Map()
  for (const ponto of serie) {
    const match = String(ponto.data).match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    const chave = match ? `${match[3]}-${match[2]}-${match[1]}` : ponto.data
    const atual = porDia.get(chave) || { data: chave, total: 0, pontos: 0, ultimaDataHora: '' }
    atual.total = Number((atual.total + ponto.valor).toFixed(2))
    atual.pontos += 1
    atual.ultimaDataHora = `${ponto.data} ${ponto.hora}`
    porDia.set(chave, atual)
  }
  return [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data))
}

function serieHoraria(serie) {
  return serie.slice(-24)
}

function normalizar(item, payload) {
  const serie = extrairSerie(payload)
  const ultimo = serie.at(-1)
  const dadosEstacao = payload?.estacao || {}
  return {
    id: Number(item.idestacao),
    uf: String(item.uf || 'MG'),
    cidade: String(item.cidade || 'CONSELHEIRO LAFAIETE'),
    nome: String(item.nomeestacao || ''),
    codigo: String(dadosEstacao.codEstacao || item.codEstacao || ''),
    latitude: number(dadosEstacao.latitude),
    longitude: number(dadosEstacao.longitude),
    ultimoValor: number(item.ultimovalor),
    dataHora: String(item.datahoraUltimovalor || ''),
    precipitacaoAtual: number(item.acc1hr) ?? ultimo?.valor ?? null,
    precipitacaoDataHora: String(item.datahoraUltimovalor || ''),
    precipitacaoDiaria: diaria(serie),
    acumulados: {
      umaHora: number(item.acc1hr),
      seisHoras: number(item.acc6hr),
      dozeHoras: number(item.acc12hr),
      vinteQuatroHoras: number(item.acc24hr),
      quarentaEOitoHoras: number(item.acc48hr),
      setentaEDuasHoras: number(item.acc72hr),
      noventaESeisHoras: number(item.acc96hr),
    },
  }
}

export const handler = async () => {
  try {
    const [catalogoResponse, nivelResponse, cotasSalvas] = await Promise.all([
      fetch(CATALOGO, { signal: AbortSignal.timeout(6000) }),
      fetch(NIVEL, { signal: AbortSignal.timeout(6000) }).catch(() => null),
      buscarCotas(),
    ])
    if (!catalogoResponse.ok) throw new Error(`Catálogo CEMADEN: ${catalogoResponse.status}`)
    const catalogo = await catalogoResponse.json()
    let medidas = []
    let avisoNivel = ''
    if (nivelResponse?.ok) {
      try {
        medidas = await nivelResponse.json()
      } catch {
        avisoNivel = 'A série hidrológica está indisponível; a leitura do catálogo foi mantida como referência.'
      }
    } else {
      avisoNivel = 'A série hidrológica está indisponível; a leitura do catálogo foi mantida como referência.'
    }
    const principalRaw = Array.isArray(catalogo) ? catalogo.find(row => Number(row?.idestacao) === CNL_ID) : null
    if (!principalRaw) throw new Error('Estação Rio Bananeiras não encontrada')
    const estacoesCatalogo = catalogo.filter(row => ESTACOES_CHUVA_IDS.has(Number(row?.idestacao)))
    const chuva = await Promise.allSettled(estacoesCatalogo.map(async item => {
      const id = Number(item.idestacao)
      const response = await fetch(`${RECURSOS}/horario/${id}/96`, { signal: AbortSignal.timeout(2500) })
      if (!response.ok) throw new Error(`estação ${id} respondeu ${response.status}`)
      return { id, payload: await response.json() }
    }))
    const payloadPorId = new Map()
    chuva.forEach(result => { if (result.status === 'fulfilled') payloadPorId.set(result.value.id, result.value.payload) })
    const principalPayload = payloadPorId.get(CNL_ID) || {}
    const estacaoCentroCatalogo = estacoesCatalogo.find(row => Number(row?.idestacao) === CNL_ESTACAO_CHUVA_CENTRO_ID)
    const payloadCentro = payloadPorId.get(CNL_ESTACAO_CHUVA_CENTRO_ID) || {}
    const serieChuvaCentro = serieHoraria(extrairSerie(payloadCentro))
    const estacaoChuvaCentro = estacaoCentroCatalogo && serieChuvaCentro.length > 0
      ? {
          nome: String(estacaoCentroCatalogo.nomeestacao || payloadCentro.estacao?.nome || 'Centro'),
          codigo: CNL_ESTACAO_CHUVA_CENTRO_CODIGO,
        }
      : null
    const estacoes = estacoesCatalogo.map(item => normalizar(item, payloadPorId.get(Number(item.idestacao)) || {})).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    const estacaoHorario = principalPayload.estacao || {}
    const nivelSerie = (Array.isArray(medidas) ? medidas : []).map(medida => {
      const offset = number(medida?.offset)
      const bruto = number(medida?.valor)
      return { dataHora: String(medida?.datahora || ''), valor: offset != null && bruto != null ? Number((offset - bruto).toFixed(2)) : null }
    }).filter(item => item.valor != null)
    const nivelAtual = nivelSerie.at(-1) || null
    const cotasOficiais = {
      atencao: number(estacaoHorario.cotaAtencao) ?? COTAS_PADRAO.atencao,
      alerta: number(estacaoHorario.cotaAlerta) ?? COTAS_PADRAO.alerta,
      transbordamento: number(estacaoHorario.cotaTransbordamento) ?? COTAS_PADRAO.transbordamento,
    }
    const principal = normalizar(principalRaw, principalPayload)
    const estacao = {
      ...principal,
      ultimoValor: nivelAtual?.valor ?? principal.ultimoValor,
      dataHora: nivelAtual?.dataHora || principal.dataHora,
      latitude: number(estacaoHorario.latitude),
      longitude: number(estacaoHorario.longitude),
      tipo: String(estacaoHorario.idTipoestacao?.descricao || 'Hidrológica'),
      status: String(estacaoHorario.status || 'UNKNOWN'),
      cotas: cotasSalvas.configuradas ? cotasSalvas.cotas : cotasOficiais,
    }
    const dados = {
      sucesso: true,
      estacao,
      estacoes,
      serie: serieHoraria(extrairSerie(principalPayload)),
      estacaoChuvaCentro,
      serieChuvaCentro,
      nivelAtual,
      serieNivel: nivelSerie.slice(-24),
      cotasConfiguradas: cotasSalvas.configuradas,
      atualizadoEm: new Date().toISOString(),
      fonte: FONTE,
      aviso: avisoNivel,
    }
    monitoramentoCnlCache = dados
    monitoramentoCnlCacheTs = Date.now()
    return json(200, dados)
  } catch (error) {
    if (monitoramentoCnlCache && Date.now() - monitoramentoCnlCacheTs <= MONITORAMENTO_CNL_CACHE_MAX_STALE_MS) {
      return json(200, {
        ...monitoramentoCnlCache,
        cache: true,
        erroAtualizacao: true,
        aviso: 'O CEMADEN não respondeu nesta atualização. Exibindo a última consulta válida; uma nova tentativa será feita em breve.',
      })
    }
    return json(503, { sucesso: false, erro: 'Não foi possível consultar o monitoramento do CEMADEN.', detalhe: error?.message })
  }
}