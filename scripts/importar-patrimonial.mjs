// Script de importação do Controle Patrimonial para o Supabase
// Uso: node scripts/importar-patrimonial.mjs
//
// Lê a planilha, redimensiona as fotos e faz upsert no Supabase.

import ExcelJS from 'exceljs'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY
const ARQUIVO_XLSX = 'attached_assets/Controle_Patrimonial_Defesa_Civil_1777588558302.xlsx'
const MAX_PX = 900       // tamanho máximo (largura/altura) após redimensionar
const JPEG_QUALITY = 78  // qualidade JPEG 0-100

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não encontrados.')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

// ── 1. Ler planilha ──────────────────────────────────────────────────────────
console.log('📂 Lendo planilha...')
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(ARQUIVO_XLSX)

const ws1 = wb.worksheets[0]  // Controle Patrimonial D.C.
const ws2 = wb.worksheets[1]  // Fotos

// ── 2. Ler itens (sheet1) ───────────────────────────────────────────────────
const itens = []
ws1.eachRow((row, rowIndex) => {
  if (rowIndex === 1) return // cabeçalho
  const patrim = row.getCell(1).value
  const nome   = row.getCell(2).value
  const descr  = row.getCell(3).value
  const local  = row.getCell(4).value
  const status = row.getCell(6).value
  if (!patrim || !nome) return
  const id = String(patrim).trim()
  const nomeStr = String(nome).trim()
  const descrStr = [descr, local].filter(Boolean).map(v => String(v).trim()).join(' — ') || null
  const obsStr = status ? String(status).trim() : null
  itens.push({ id, nome: nomeStr, descricao: descrStr, observacoes: obsStr })
})
console.log(`✅ ${itens.length} itens lidos da aba "Controle Patrimonial D.C."`)

// ── 3. Ler fotos (sheet2) ────────────────────────────────────────────────────
async function bufferParaBase64Jpeg(buffer) {
  try {
    const out = await sharp(buffer)
      .resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
    return 'data:image/jpeg;base64,' + out.toString('base64')
  } catch {
    return null
  }
}

// Mapa: patrimônio → { foto_placa, foto }
const fotosPorId = {}
const imgs = ws2.getImages()
console.log(`🖼️  Processando ${imgs.length} imagens...`)

let processadas = 0
for (const img of imgs) {
  const nRow = img.range?.tl?.nativeRow  // 0-indexed
  const nCol = img.range?.tl?.nativeCol  // 0-indexed (1=colB=placa, 2=colC=item)
  if (nRow == null || nCol == null) continue
  const excelRow = nRow + 1
  const patrim = String(ws2.getRow(excelRow).getCell(1).value ?? '').trim()
  if (!patrim || patrim === 'null' || patrim === '') continue

  const imgData = wb.getImage(img.imageId)
  if (!imgData?.buffer) continue

  const b64 = await bufferParaBase64Jpeg(imgData.buffer)
  if (!b64) continue

  if (!fotosPorId[patrim]) fotosPorId[patrim] = {}
  if (nCol === 1) fotosPorId[patrim].foto_placa = b64   // coluna B = placa
  if (nCol === 2) fotosPorId[patrim].foto = b64          // coluna C = item

  processadas++
  if (processadas % 10 === 0) process.stdout.write(`  ${processadas}/${imgs.length}...\r`)
}
console.log(`✅ ${processadas} fotos processadas`)

// ── 4. Montar registros finais (deduplicar por id) ──────────────────────────
const mapaItens = new Map()
for (const item of itens) {
  mapaItens.set(item.id, item)  // última ocorrência prevalece
}
const registros = [...mapaItens.values()].map(item => ({
  id: item.id,
  nome: item.nome,
  descricao: item.descricao,
  observacoes: item.observacoes,
  foto: fotosPorId[item.id]?.foto ?? null,
  foto_placa: fotosPorId[item.id]?.foto_placa ?? null,
}))
const duplicatas = itens.length - mapaItens.size
if (duplicatas > 0) console.log(`⚠️  ${duplicatas} número(s) de patrimônio duplicados ignorados`)

const comFoto = registros.filter(r => r.foto || r.foto_placa).length
console.log(`📋 ${registros.length} registros para importar (${comFoto} com fotos)`)

// ── 5. Upsert em lotes no Supabase ──────────────────────────────────────────
const LOTE = 20
let criados = 0, atualizados = 0, erros = 0

for (let i = 0; i < registros.length; i += LOTE) {
  const lote = registros.slice(i, i + LOTE)
  const { error } = await sb
    .from('materiais')
    .upsert(lote, { onConflict: 'id', ignoreDuplicates: false })

  if (error) {
    console.error(`\n❌ Erro no lote ${i}-${i + LOTE}:`, error.message)
    erros += lote.length
  } else {
    criados += lote.length
  }
  process.stdout.write(`  Enviado ${Math.min(i + LOTE, registros.length)}/${registros.length}...\r`)
}

console.log(`\n✅ Importação concluída!`)
console.log(`   Upserted: ${criados}  |  Erros: ${erros}`)
