// ════════════════════════════════════════════════════════════════════════════
// Importação de planilha de Controle Patrimonial (.xlsx) → cadastro de
// materiais do app.
//
// Formato esperado da planilha (gerado pelo modelo "Controle Patrimonial
// Defesa Civil"):
//
//   Aba 1 — "Controle Patrimonial D.C." (ou primeira aba):
//     A: Número do Patrimônio   B: Nome do Patrimônio   C: Descrição
//     D: Localização            E: Responsável          F: Status
//
//   Aba 2 — "Fotos" (ou segunda aba):
//     A: Número do Patrimônio
//     B: Foto da Placa do Patrimônio   (imagem ancorada na célula)
//     C: Foto do Item                  (imagem ancorada na célula)
//
// As fotos do Excel são imagens flutuantes ancoradas nas células — para
// extrair, abrimos o .xlsx como ZIP e cruzamos `xl/drawings/drawing*.xml`
// + `xl/media/image*.png` com a coluna A (código do patrimônio) da aba.
// ════════════════════════════════════════════════════════════════════════════

import JSZip from 'jszip'

export interface ItemImportado {
  id: string                    // código do patrimônio (coluna A)
  nome: string                  // coluna B
  descricao: string | null      // coluna C
  observacoes: string | null    // localização + responsável + status (D/E/F)
  fotoPlaca: string | null      // data URL (imagem ancorada na coluna B da aba "Fotos")
  fotoItem: string | null       // data URL (imagem ancorada na coluna C da aba "Fotos")
  foto: string | null           // foto principal escolhida (item se houver, senão placa)
}

// Redimensiona uma imagem (data URL) para no máximo maxW × maxH e devolve
// JPEG comprimido — para não estourar o banco com PNGs gigantes.
function redimensionarDataUrl(dataUrl: string, maxW = 1200, maxH = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let w = img.width, h = img.height
      if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW }
      if (h > maxH) { w = Math.round((w * maxH) / h); h = maxH }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(dataUrl); return }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

function arrayBufferParaDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as number[])
  }
  return `data:${mime};base64,${btoa(bin)}`
}

function mimePorExtensao(caminho: string): string {
  const ext = caminho.split('.').pop()?.toLowerCase() || ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/png'
}

function colLetter(ref: string): string {
  return ref.replace(/\d+/, '')
}

function lerSharedStrings(xml: string): string[] {
  const siBlocks = [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
  return siBlocks.map((m) => {
    const inner = m[1]
    const partes = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1])
    return partes.join('')
  })
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function extrairValor(cellXml: string, sharedStrings: string[]): string {
  const tMatch = cellXml.match(/\bt="([^"]+)"/)
  const t = tMatch ? tMatch[1] : 'n'
  const isMatch = cellXml.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)
  if (isMatch) return decodeXmlEntities(isMatch[1])
  const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/)
  if (!vMatch) return ''
  if (t === 's') return decodeXmlEntities(sharedStrings[parseInt(vMatch[1], 10)] || '')
  if (t === 'str') return decodeXmlEntities(vMatch[1])
  return vMatch[1]
}

interface LinhaSheet {
  _row: number
  cols: Record<string, string>
}

function lerLinhasSheet(xml: string, sharedStrings: string[]): LinhaSheet[] {
  const rowMatches = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)]
  const out: LinhaSheet[] = []
  for (const [, rowNumStr, inner] of rowMatches) {
    const cells = [...inner.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/c>)/g)]
    const cols: Record<string, string> = {}
    for (const c of cells) {
      const ref = c[1]
      const tagInteira = c[0]
      cols[colLetter(ref)] = extrairValor(tagInteira, sharedStrings)
    }
    out.push({ _row: parseInt(rowNumStr, 10), cols })
  }
  return out
}

export interface ResultadoParse {
  itens: ItemImportado[]
  totalLinhasComCodigo: number
  totalLinhasComFoto: number
  abaPrincipal: string
  abaFotos: string | null
}

export async function parseExcelPatrimonio(arquivo: File): Promise<ResultadoParse> {
  const buf = await arquivo.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)

  // 1. Mapeia rels do workbook para descobrir nome → arquivo de cada sheet
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')

  const sheetTags = [...wbXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)]
  const relMap: Record<string, string> = {}
  for (const m of wbRelsXml.matchAll(/<Relationship\s+Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap[m[1]] = m[2]
  }
  const sheets = sheetTags.map(([, name, rId]) => ({
    name: decodeXmlEntities(name),
    file: `xl/${relMap[rId]?.replace(/^\/?xl\//, '')}`.replace(/^xl\/xl\//, 'xl/'),
    rId,
  }))

  // 2. Localiza aba principal (1ª) e aba "Fotos"
  const abaPrincipal = sheets[0]
  const abaFotos = sheets.find((s) => /foto/i.test(s.name)) || sheets[1] || null

  // 3. Lê shared strings
  const ssFile = zip.file('xl/sharedStrings.xml')
  const sharedStrings = ssFile ? lerSharedStrings(await ssFile.async('string')) : []

  // 4. Lê linhas da aba principal
  const sheetMainXml = await zip.file(abaPrincipal.file)!.async('string')
  const linhasMain = lerLinhasSheet(sheetMainXml, sharedStrings)

  // 5. Mapa: código → { fotoPlacaDataUrl, fotoItemDataUrl }
  const fotosPorCodigo = new Map<string, { placa: string | null; item: string | null }>()

  if (abaFotos) {
    const sheetFotosXml = await zip.file(abaFotos.file)!.async('string')
    const linhasFotos = lerLinhasSheet(sheetFotosXml, sharedStrings)

    // linha do Excel → código do patrimônio (col A)
    const linhaParaCodigo = new Map<number, string>()
    for (const l of linhasFotos) {
      const codigo = (l.cols.A || '').trim()
      if (codigo) linhaParaCodigo.set(l._row, codigo)
    }

    // Acha o drawing da aba Fotos
    const fotosRelsPath = abaFotos.file.replace(/\.xml$/, '.xml').replace(/^xl\/worksheets\//, 'xl/worksheets/_rels/').replace(/\.xml$/, '.xml.rels')
    const fotosRelsFile = zip.file(fotosRelsPath)
    if (fotosRelsFile) {
      const fotosRelsXml = await fotosRelsFile.async('string')
      const drawingRel = [...fotosRelsXml.matchAll(/<Relationship\s+Id="[^"]+"[^>]*Type="[^"]*\/drawing"[^>]*Target="([^"]+)"/g)][0]
      if (drawingRel) {
        const drawingPath = `xl/${drawingRel[1].replace(/^\.\.\//, '')}`.replace(/xl\/xl\//, 'xl/')
        const drawingXml = await zip.file(drawingPath)!.async('string')
        const drawingRelsPath = drawingPath.replace('xl/drawings/', 'xl/drawings/_rels/') + '.rels'
        const drawingRelsXml = await zip.file(drawingRelsPath)!.async('string')

        // rId → caminho do arquivo de imagem
        const imgRels: Record<string, string> = {}
        for (const m of drawingRelsXml.matchAll(/<Relationship\s+Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
          imgRels[m[1]] = `xl/${m[2].replace(/^\.\.\//, '')}`.replace(/xl\/xl\//, 'xl/')
        }

        // Cada anchor: <xdr:from><xdr:col>N</xdr:col><xdr:row>N</xdr:row></xdr:from> ... <a:blip r:embed="rIdN"/>
        const anchors = [
          ...drawingXml.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:\1>/g),
        ]
        for (const [block] of anchors) {
          const fromMatch = block.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/)
          const blipMatch = block.match(/<a:blip[^>]*r:embed="(rId\d+)"/)
          if (!fromMatch || !blipMatch) continue
          const col0 = parseInt(fromMatch[1], 10) // 0=A, 1=B, 2=C
          const row0 = parseInt(fromMatch[2], 10) // 0-indexed
          const linhaExcel = row0 + 1
          const rid = blipMatch[1]
          const imgFile = imgRels[rid]
          if (!imgFile) continue
          const codigo = linhaParaCodigo.get(linhaExcel)
          if (!codigo) continue

          // Extrai imagem como data URL e redimensiona
          const bytes = await zip.file(imgFile)!.async('uint8array')
          const dataUrlBruto = arrayBufferParaDataUrl(bytes, mimePorExtensao(imgFile))
          const dataUrl = await redimensionarDataUrl(dataUrlBruto)

          if (!fotosPorCodigo.has(codigo)) fotosPorCodigo.set(codigo, { placa: null, item: null })
          const slot = fotosPorCodigo.get(codigo)!
          if (col0 === 1) {           // coluna B = Foto da Placa
            if (!slot.placa) slot.placa = dataUrl
          } else if (col0 === 2) {    // coluna C = Foto do Item
            if (!slot.item) slot.item = dataUrl
          } else {
            // qualquer outra coluna: usa o slot vazio
            if (!slot.item) slot.item = dataUrl
            else if (!slot.placa) slot.placa = dataUrl
          }
        }
      }
    }
  }

  // 6. Monta lista final, descartando linha 1 (cabeçalho) e linhas vazias
  const itens: ItemImportado[] = []
  let totalLinhasComFoto = 0
  for (const l of linhasMain) {
    if (l._row === 1) continue
    const id = (l.cols.A || '').trim()
    if (!id) continue
    const nome = (l.cols.B || '').trim()
    if (!nome) continue
    const descricao = (l.cols.C || '').trim()
    const localizacao = (l.cols.D || '').trim()
    const responsavel = (l.cols.E || '').trim()
    const status = (l.cols.F || '').trim()

    const partesObs: string[] = []
    if (localizacao) partesObs.push(`📍 ${localizacao}`)
    if (responsavel) partesObs.push(`👤 Responsável: ${responsavel}`)
    if (status) partesObs.push(`Status: ${status}`)
    const observacoes = partesObs.join('\n') || null

    const fotos = fotosPorCodigo.get(id) || { placa: null, item: null }
    const fotoPrincipal = fotos.item || fotos.placa
    if (fotoPrincipal) totalLinhasComFoto++

    itens.push({
      id,
      nome,
      descricao: descricao || null,
      observacoes,
      fotoPlaca: fotos.placa,
      fotoItem: fotos.item,
      foto: fotoPrincipal,
    })
  }

  return {
    itens,
    totalLinhasComCodigo: itens.length,
    totalLinhasComFoto,
    abaPrincipal: abaPrincipal.name,
    abaFotos: abaFotos?.name ?? null,
  }
}
