export const handler = async (event) => {
  const from = String(event.queryStringParameters?.from || '').split(',').map(Number)
  const to = String(event.queryStringParameters?.to || '').split(',').map(Number)
  const json = body => ({ statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }, body: JSON.stringify(body) })
  if (from.length !== 2 || to.length !== 2 || [...from, ...to].some(n => !Number.isFinite(n))) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ erro: 'Parâmetros from/to inválidos (use lat,lng)' }) }
  }
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`
    const response = await fetch(url, { headers: { 'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)' }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`OSRM: ${response.status}`)
    const rota = (await response.json())?.routes?.[0]
    if (!rota) return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ erro: 'Sem rota disponível' }) }
    return json({ coords: (rota.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]), km: rota.distance / 1000, min: Math.round(rota.duration / 60) })
  } catch (error) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ erro: 'Roteamento indisponível', detalhe: error?.message }) }
  }
}