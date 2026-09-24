// Netlify Function — Focos de Incêndio (NASA FIRMS)
// Satélites: VIIRS-SNPP · VIIRS-NOAA20 · VIIRS-NOAA21 · MODIS · GOES (geoest.)
// Espelha a lógica de server/index.js para o deploy no Netlify.

// Polígono oficial do município de Ouro Branco - MG (IBGE 3145901)
// Fonte: servicodados.ibge.gov.br — resolução 5 (29 vértices)
const OURO_BRANCO_POLIGONO = [
  [-20.58410, -43.60130],
  [-20.59710, -43.62220],
  [-20.58790, -43.63630],
  [-20.59360, -43.65400],
  [-20.62150, -43.67870],
  [-20.59990, -43.68800],
  [-20.58820, -43.72000],
  [-20.60100, -43.74160],
  [-20.56720, -43.76480],
  [-20.56960, -43.77440],
  [-20.53800, -43.79980],
  [-20.53410, -43.79190],
  [-20.54800, -43.75790],
  [-20.56440, -43.73460],
  [-20.55200, -43.70290],
  [-20.53830, -43.71100],
  [-20.52150, -43.74400],
  [-20.51240, -43.73640],
  [-20.49950, -43.76630],
  [-20.46020, -43.74780],
  [-20.46140, -43.71210],
  [-20.43150, -43.68740],
  [-20.43330, -43.66160],
  [-20.47150, -43.62430],
  [-20.48700, -43.58930],
  [-20.50870, -43.58010],
  [-20.54090, -43.59760],
  [-20.56200, -43.60060],
  [-20.57520, -43.59010],
]

function pontoNoCidade(lat, lng) {
  const poly = OURO_BRANCO_POLIGONO
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]
    const [yj, xj] = poly[j]
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function parsearFirmsCsv(csv, fonteNome) {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',')
  const idx = (name) => headers.indexOf(name)
  return lines.slice(1).map(line => {
    const cols = line.split(',')
    const confRaw = (cols[idx('confidence')] || 'n').trim()
    let confidence = 'n'
    const confNum = parseInt(confRaw)
    if (!isNaN(confNum)) {
      if (fonteNome === 'MODIS') {
        confidence = confNum >= 70 ? 'h' : confNum >= 30 ? 'n' : 'l'
      } else {
        // GOES: 10/11=high, 30=nominal, 31-33=low; >65=high (G19FRP range)
        confidence = confNum <= 11 ? 'h' : confNum <= 30 ? 'n' : confNum <= 65 ? 'l' : 'h'
      }
    } else {
      const c0 = confRaw.toLowerCase()[0]
      confidence = c0 === 'h' ? 'h' : c0 === 'l' ? 'l' : 'n'
    }
    return {
      lat:      parseFloat(cols[idx('latitude')]),
      lng:      parseFloat(cols[idx('longitude')]),
      confidence,
      frp:      parseFloat(cols[idx('frp')]) || 0,
      data:     cols[idx('acq_date')] || '',
      hora:     cols[idx('acq_time')] || '',
      satelite: cols[idx('satellite')] || fonteNome,
      fonte:    fonteNome,
    }
  }).filter(f => !isNaN(f.lat) && !isNaN(f.lng))
}

function deduplicarFocos(focos) {
  const out = []
  for (const f of focos) {
    const dup = out.find(r => Math.abs(r.lat - f.lat) < 0.01 && Math.abs(r.lng - f.lng) < 0.01)
    if (dup) { if (f.frp > dup.frp) Object.assign(dup, f) }
    else out.push({ ...f })
  }
  return out
}

export const handler = async () => {
  const firmsKey = process.env.FIRMS_MAP_KEY
  if (!firmsKey) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ focos: [], configurado: false, fontes: [], msg: 'FIRMS_MAP_KEY não configurada' }),
    }
  }

  // bbox: oeste,sul,leste,norte — IBGE 3145901 com margem ~5 km
  const bbox = '-43.85,-20.67,-43.53,-20.38'
  const base = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}`
  const SIG = 8000 // timeout por satélite (ms)

  try {
    const [resSnpp, resN20, resN21, resMod, resGoes] = await Promise.allSettled([
      fetch(`${base}/VIIRS_SNPP_NRT/${bbox}/1`,   { signal: AbortSignal.timeout(SIG) }),
      fetch(`${base}/VIIRS_NOAA20_NRT/${bbox}/1`, { signal: AbortSignal.timeout(SIG) }),
      fetch(`${base}/VIIRS_NOAA21_NRT/${bbox}/1`, { signal: AbortSignal.timeout(SIG) }),
      fetch(`${base}/MODIS_NRT/${bbox}/1`,          { signal: AbortSignal.timeout(SIG) }),
      fetch(`${base}/GOES_NRT/${bbox}/1`,           { signal: AbortSignal.timeout(SIG) }),
    ])

    const fontes = []

    const processar = async (r, nome, label) => {
      if (r.status === 'fulfilled' && r.value.ok) {
        const f = parsearFirmsCsv(await r.value.text(), nome)
        fontes.push(label)
        return f
      }
      return []
    }

    const grupos = await Promise.all([
      processar(resSnpp, 'VIIRS-SNPP',  'VIIRS-SNPP'),
      processar(resN20,  'VIIRS-N20',   'VIIRS-NOAA20'),
      processar(resN21,  'VIIRS-N21',   'VIIRS-NOAA21'),
      processar(resMod,  'MODIS',       'MODIS'),
      processar(resGoes, 'GOES',        'GOES'),
    ])

    const todos = grupos.flat().filter(f => pontoNoCidade(f.lat, f.lng))
    const focos = deduplicarFocos(todos)

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // GOES atualiza a cada ~10 min → CDN cache 5 min é suficiente
        'Cache-Control': 'public, max-age=60, must-revalidate',
      },
      body: JSON.stringify({ focos, configurado: true, fontes, atualizadoEm: new Date().toISOString() }),
    }
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ focos: [], configurado: true, fontes: [], erro: e?.message }),
    }
  }
}
