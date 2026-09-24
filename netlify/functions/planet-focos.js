const PLANET_API_URL = 'https://api.planet.com/data/v1/quick-search'

function authHeader() {
  const key = process.env.PLANET_API_KEY?.trim()

  if (!key) {
    throw new Error('PLANET_API_KEY não configurada')
  }

  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`
}

function focoPolygon(lat, lng, raioKm = 0.75) {
  const latRad = lat * Math.PI / 180
  const dLat = raioKm / 111
  const dLng = raioKm / (111 * Math.cos(latRad))

  return {
    type: 'Polygon',
    coordinates: [[
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ]],
  }
}

function dataIsoDiasAtras(dias) {
  return new Date(Date.now() - dias * 86400000).toISOString()
}

function centroDaGeometria(geometry) {
  const coords = geometry?.coordinates?.[0]

  if (!Array.isArray(coords) || coords.length === 0) {
    return null
  }

  const pontos = coords.filter(
    p => Array.isArray(p) && p.length >= 2
  )

  if (!pontos.length) return null

  const lng =
    pontos.reduce((soma, p) => soma + Number(p[0]), 0) / pontos.length

  const lat =
    pontos.reduce((soma, p) => soma + Number(p[1]), 0) / pontos.length

  return { lat, lng }
}

function normalizarImagem(item) {
  const properties = item.properties || {}
  const centro = centroDaGeometria(item.geometry)

  return {
    id: item.id,
    tipo: properties.item_type || 'PSScene',
    adquiridoEm: properties.acquired || null,
    publicadoEm: properties.published || null,
    cloudCover: properties.cloud_cover ?? null,
    cloudPercent: properties.cloud_percent ?? null,
    clearPercent: properties.clear_percent ?? null,
    clearConfidencePercent:
      properties.clear_confidence_percent ?? null,
    visiblePercent: properties.visible_percent ?? null,
    gsd: properties.gsd ?? null,
    satelliteId: properties.satellite_id || null,
    satelliteAzimuth: properties.satellite_azimuth ?? null,
    sunAzimuth: properties.sun_azimuth ?? null,
    sunElevation: properties.sun_elevation ?? null,
    viewAngle: properties.view_angle ?? null,
    groundControl: properties.ground_control ?? null,
    usableData: properties.usable_data ?? null,
    publishingStage: properties.publishing_stage || null,
    qualityCategory: properties.quality_category || null,
    geometry: item.geometry || null,
    centro,
    thumbnailUrl: item._links?.thumbnail || null,
    assetsUrl: item._links?.assets || null,
  }
}

async function buscarPlanet({
  lat,
  lng,
  dias = 3,
  raioKm = 0.75,
  maxNuvens = 0.5,
}) {
  const body = {
    item_types: ['PSScene'],
    geometry: focoPolygon(lat, lng, raioKm),
    filter: {
      type: 'AndFilter',
      config: [
        {
          type: 'DateRangeFilter',
          field_name: 'acquired',
          config: {
            gte: dataIsoDiasAtras(dias),
            lte: new Date().toISOString(),
          },
        },
        {
          type: 'RangeFilter',
          field_name: 'cloud_cover',
          config: {
            gte: 0,
            lte: maxNuvens,
          },
        },
      ],
    },
  }

  const url = new URL(PLANET_API_URL)
  url.searchParams.set('_sort', 'acquired desc')
  url.searchParams.set('_page_size', '10')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })

  const texto = await response.text()

  if (!response.ok) {
    throw new Error(
      `Planet API ${response.status}: ${texto.slice(0, 500)}`
    )
  }

  let dados

  try {
    dados = JSON.parse(texto)
  } catch {
    throw new Error(
      `Planet API retornou JSON inválido: ${texto.slice(0, 500)}`
    )
  }

  const features = Array.isArray(dados.features)
    ? dados.features
    : []

  return features.map(normalizarImagem)
}

export const handler = async (event) => {
  try {
    if (!process.env.PLANET_API_KEY?.trim()) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          configurado: false,
          imagens: [],
          quantidade: 0,
          erro: 'PLANET_API_KEY não configurada',
        }),
      }
    }

    const params = event.queryStringParameters || {}

    const lat = Number(params.lat)
    const lng = Number(params.lng)

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          erro: 'Informe lat e lng válidos',
        }),
      }
    }

    const dias = Math.min(
      Math.max(Number(params.dias) || 3, 1),
      30
    )

    const raioKm = Math.min(
      Math.max(Number(params.raioKm) || 0.75, 0.1),
      5
    )

    const maxNuvens = Math.min(
      Math.max(Number(params.maxNuvens) || 0.5, 0),
      1
    )

    const imagens = await buscarPlanet({
      lat,
      lng,
      dias,
      raioKm,
      maxNuvens,
    })

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify({
        configurado: true,
        fonte: 'PLANET',
        lat,
        lng,
        dias,
        raioKm,
        maxNuvens,
        imagens,
        quantidade: imagens.length,
        atualizadoEm: new Date().toISOString(),
      }),
    }
  } catch (e) {
    console.error('[planet-focos]', e)

    return {
      statusCode: 502,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        configurado: true,
        fonte: 'PLANET',
        imagens: [],
        quantidade: 0,
        erro: e?.message || 'Falha na Planet API',
      }),
    }
  }
}
