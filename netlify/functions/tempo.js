const LAT = -20.6604
const LNG = -43.7863

function resposta(statusCode, body, cache = 'public, max-age=300, stale-while-revalidate=600') {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
    body: JSON.stringify(body),
  }
}

export const handler = async () => {
  try {
    const params = new URLSearchParams({
      latitude: String(LAT),
      longitude: String(LNG),
      timezone: 'America/Sao_Paulo',
      forecast_days: '7',
      wind_speed_unit: 'kmh',
      precipitation_unit: 'mm',
      current: 'temperature_2m,relative_humidity_2m,precipitation,rain,showers,weather_code,wind_speed_10m,wind_gusts_10m',
      hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,rain,showers,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,precipitation_hours,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max',
    })
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Open-Meteo: ${response.status}`)
    const json = await response.json()
    const h = json.hourly || {}
    const horas = (h.time || []).map((time, i) => ({
      time,
      temperatura: h.temperature_2m?.[i] ?? null,
      umidade: h.relative_humidity_2m?.[i] ?? null,
      probabilidadeChuva: h.precipitation_probability?.[i] ?? null,
      precipitacao: h.precipitation?.[i] ?? 0,
      chuva: h.rain?.[i] ?? 0,
      pancadas: h.showers?.[i] ?? 0,
      codigoTempo: h.weather_code?.[i] ?? null,
      vento: h.wind_speed_10m?.[i] ?? null,
      direcaoVento: h.wind_direction_10m?.[i] ?? null,
      rajada: h.wind_gusts_10m?.[i] ?? null,
    }))
    const maior = (campo, comparar) => horas.filter(x => Number.isFinite(x[campo])).sort(comparar)[0] || null
    return resposta(200, {
      local: 'Conselheiro Lafaiete - MG',
      latitude: LAT,
      longitude: LNG,
      timezone: json.timezone,
      atualizadoEm: new Date().toISOString(),
      atual: json.current ? {
        time: json.current.time ?? null,
        temperatura: json.current.temperature_2m ?? null,
        umidade: json.current.relative_humidity_2m ?? null,
        precipitacao: json.current.precipitation ?? null,
        chuva: json.current.rain ?? null,
        pancadas: json.current.showers ?? null,
        codigoTempo: json.current.weather_code ?? null,
        vento: json.current.wind_speed_10m ?? null,
        rajada: json.current.wind_gusts_10m ?? null,
      } : null,
      horas,
      diario: json.daily ?? null,
      extremos: {
        maiorPrecipitacao: maior('precipitacao', (a, b) => b.precipitacao - a.precipitacao),
        maiorVento: maior('vento', (a, b) => b.vento - a.vento),
        maiorRajada: maior('rajada', (a, b) => b.rajada - a.rajada),
        menorUmidade: maior('umidade', (a, b) => a.umidade - b.umidade),
        maiorProbabilidadeChuva: maior('probabilidadeChuva', (a, b) => b.probabilidadeChuva - a.probabilidadeChuva),
      },
      fonte: 'Open-Meteo',
    })
  } catch (error) {
    return resposta(503, { erro: 'Serviço climático indisponível', detalhe: error?.message }, 'no-store')
  }
}