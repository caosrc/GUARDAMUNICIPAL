export const handler = async (event) => {
  const q = String(event.queryStringParameters?.q || '').trim()
  if (q.length < 2) return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' }
  try {
    const query = /conselheiro lafaiete|mg|minas/i.test(q) ? q : `${q}, Conselheiro Lafaiete, MG, Brasil`
    const params = new URLSearchParams({
      q: query, format: 'json', limit: '6', addressdetails: '0', countrycodes: 'br', 'accept-language': 'pt-BR',
    })
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)', 'Accept-Language': 'pt-BR' },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Nominatim: ${response.status}`)
    const dados = await response.json()
    const resultado = (Array.isArray(dados) ? dados : []).map(item => ({
      display: item.display_name,
      lat: Number(item.lat),
      lng: Number(item.lon),
    })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng))
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }, body: JSON.stringify(resultado) }
  } catch (error) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ erro: 'Geocodificação indisponível', detalhe: error?.message }) }
  }
}