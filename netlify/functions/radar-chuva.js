export const handler = async () => {
  try {
    const response = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`RainViewer: ${response.status}`)
    const dados = await response.json()
    const host = typeof dados?.host === 'string' ? dados.host.replace(/\/$/, '') : ''
    const valido = quadro => Number.isFinite(Number(quadro?.time)) &&
      typeof quadro?.path === 'string' && quadro.path.startsWith('/v2/')
    const observados = (dados?.radar?.past || []).filter(valido)
    const ultimo = observados.at(-1)
    if (!host || !ultimo) throw new Error('RainViewer não retornou quadros de radar')
    const tileUrl = `${host}${ultimo.path}/256/{z}/{x}/{y}/2/1_0.png`
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
      body: JSON.stringify({
        host,
        path: ultimo.path,
        tileUrl,
        frameTime: Number(ultimo.time),
        atualizadoEm: new Date(Number(ultimo.time) * 1000).toISOString(),
        fonte: 'RainViewer',
        tipoQuadro: 'observado',
      }),
    }
  } catch (error) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ erro: 'Radar de chuva indisponível', detalhe: error?.message }),
    }
  }
}