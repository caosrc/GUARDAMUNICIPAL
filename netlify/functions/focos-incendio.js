// Netlify Function — Focos de Incêndio (NASA FIRMS)
// Satélites: VIIRS-SNPP · VIIRS-NOAA20 · VIIRS-NOAA21 · MODIS · GOES (geoest.)
// Espelha a lógica de server/index.js para o deploy no Netlify.

// Polígono oficial simplificado de Conselheiro Lafaiete - MG (IBGE 3118304).
// Coordenadas em [latitude, longitude], compatíveis com o filtro do servidor.
const CONSELHEIRO_LAFAIETE_POLIGONO = [
  [-20.65880, -43.92390], [-20.65840, -43.91770], [-20.66480, -43.91540],
  [-20.66000, -43.90870], [-20.66650, -43.90290], [-20.66530, -43.89400],
  [-20.67210, -43.88520], [-20.67170, -43.88030], [-20.67660, -43.87510],
  [-20.68940, -43.87180], [-20.69090, -43.86950], [-20.68940, -43.86370],
  [-20.69910, -43.85290], [-20.70150, -43.85260], [-20.70490, -43.85660],
  [-20.70840, -43.85560], [-20.71070, -43.85010], [-20.71340, -43.84950],
  [-20.70930, -43.84740], [-20.70990, -43.84570], [-20.72000, -43.83920],
  [-20.72250, -43.83200], [-20.72630, -43.83240], [-20.73310, -43.82660],
  [-20.73710, -43.80610], [-20.74160, -43.80280], [-20.74660, -43.80260],
  [-20.75190, -43.80770], [-20.75620, -43.82030], [-20.77250, -43.81940],
  [-20.78360, -43.80440], [-20.78440, -43.79690], [-20.79050, -43.79290],
  [-20.79560, -43.79290], [-20.80100, -43.77280], [-20.79580, -43.76840],
  [-20.78960, -43.76850], [-20.78380, -43.75980], [-20.77890, -43.75800],
  [-20.77390, -43.75690], [-20.76710, -43.76120], [-20.76330, -43.75820],
  [-20.75490, -43.76070], [-20.75830, -43.75520], [-20.75580, -43.74170],
  [-20.74750, -43.72980], [-20.74410, -43.71910], [-20.73870, -43.71730],
  [-20.73030, -43.70910], [-20.72880, -43.70060], [-20.72290, -43.69490],
  [-20.72350, -43.69210], [-20.71320, -43.69190], [-20.70970, -43.69720],
  [-20.70390, -43.69920], [-20.69720, -43.69780], [-20.69480, -43.69410],
  [-20.68310, -43.69450], [-20.67120, -43.68820], [-20.66290, -43.68800],
  [-20.64710, -43.70170], [-20.64360, -43.70230], [-20.63930, -43.71050],
  [-20.63600, -43.70900], [-20.63700, -43.70600], [-20.63390, -43.69720],
  [-20.62580, -43.69020], [-20.63090, -43.68090], [-20.62150, -43.67880],
  [-20.61470, -43.68010], [-20.60790, -43.68750], [-20.59780, -43.68990],
  [-20.59610, -43.70170], [-20.58810, -43.71430], [-20.58820, -43.72000],
  [-20.59270, -43.72780], [-20.59180, -43.73260], [-20.60050, -43.74300],
  [-20.59880, -43.74570], [-20.58680, -43.75600], [-20.57970, -43.75880],
  [-20.57620, -43.75710], [-20.57590, -43.75930], [-20.56880, -43.76180],
  [-20.56720, -43.76770], [-20.57010, -43.77350], [-20.56390, -43.77420],
  [-20.56130, -43.78110], [-20.55280, -43.78320], [-20.55340, -43.78670],
  [-20.53800, -43.79980], [-20.54560, -43.80950], [-20.54760, -43.80860],
  [-20.55010, -43.81290], [-20.55580, -43.81330], [-20.57080, -43.80940],
  [-20.57360, -43.81150], [-20.57770, -43.80450], [-20.58630, -43.80570],
  [-20.59220, -43.79890], [-20.59290, -43.80960], [-20.59810, -43.81170],
  [-20.59240, -43.82250], [-20.60360, -43.83050], [-20.60480, -43.83490],
  [-20.60180, -43.83680], [-20.60130, -43.84510], [-20.60380, -43.85080],
  [-20.61290, -43.85480], [-20.61850, -43.87270], [-20.61080, -43.88340],
  [-20.59830, -43.88880], [-20.60010, -43.89330], [-20.59550, -43.89670],
  [-20.59350, -43.90360], [-20.59800, -43.90380], [-20.60360, -43.90950],
  [-20.60490, -43.90640], [-20.61260, -43.90830], [-20.61730, -43.91380],
  [-20.62460, -43.91660], [-20.62980, -43.92600], [-20.63620, -43.92890],
  [-20.63760, -43.92760], [-20.64200, -43.92990], [-20.64420, -43.92360],
  [-20.64990, -43.92590], [-20.65480, -43.92240],
]

function pontoNoCidade(lat, lng) {
  const poly = CONSELHEIRO_LAFAIETE_POLIGONO
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

  // bbox: oeste,sul,leste,norte — Conselheiro Lafaiete com margem ~5 km
  const bbox = '-43.95,-20.83,-43.66,-20.51'
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
