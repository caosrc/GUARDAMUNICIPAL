import type { CellValue as ExcelCellValue, Workbook as ExcelWorkbook } from 'exceljs'
import type { Ocorrencia } from './types'
import { converterParaJpeg, parseDateLocal } from './utils'

export interface ChecklistExportData {
  id: number
  data_checklist: string
  km: string | null
  placa: string | null
  motorista: string | null
  fotos_avarias: string[]
  foto_frontal: string | null
  foto_traseira: string | null
  foto_direita: string | null
  foto_esquerda: string | null
  itens: Record<string, string> | null
  observacoes: string | null
  assinatura_data: string | null
  created_at: string
}

const AZUL = '1a4b8c'
const LARANJA = 'E05F00'
const CINZA_CLARO = 'f3f4f6'
const BRANCO = 'FFFFFF'

const FOTO_W = 120  // largura da miniatura em pixels
const FOTO_H = 90   // altura da miniatura em pixels
const FOTO_COL_W = 17  // largura da coluna em caracteres (≈ 120px)
const ROW_H_PX_TO_PT = 0.75  // 1pt ≈ 1.33px

// Converte uma URL de imagem em data URL base64.
async function urlParaBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// Normaliza uma foto (base64 ou URL) para { base64, ext } pronto para o ExcelJS
async function normalizarFoto(foto: string): Promise<{ base64: string; ext: 'jpeg' | 'png' } | null> {
  if (!foto) return null
  let dataUrl = foto
  if (foto.startsWith('http://') || foto.startsWith('https://')) {
    const fetched = await urlParaBase64(foto)
    if (!fetched) return null
    dataUrl = fetched
  }
  dataUrl = await converterParaJpeg(dataUrl)
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  const ext: 'png' | 'jpeg' = dataUrl.startsWith('data:image/png') ? 'png' : 'jpeg'
  return { base64, ext }
}

function nivelLabel(n: string) {
  return n === 'alto' ? 'Alto 🔴' : n === 'medio' ? 'Médio 🟡' : 'Baixo 🟢'
}
function statusLabel(s: string) {
  return s === 'ativo' ? 'Ativo' : 'Resolvido'
}

function calcularAreaM2(pontos: { lat: number; lng: number }[]): number {
  if (pontos.length < 3) return 0
  const toRad = (d: number) => d * Math.PI / 180
  const R = 6371000
  const lat0 = pontos[0].lat
  const lng0 = pontos[0].lng
  const pts = pontos.map(p => ({
    x: (p.lng - lng0) * Math.cos(toRad(lat0)) * R * toRad(1),
    y: (p.lat - lat0) * R * toRad(1),
  }))
  let area = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

function formatarAreaExcel(m2: number): string {
  if (m2 < 1) return '< 1 m²'
  if (m2 < 10000) return `${Math.round(m2).toLocaleString('pt-BR')} m²`
  const ha = m2 / 10000
  return `${ha.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`
}

function extrairBairroExcel(endereco: string | null): string {
  if (!endereco) return 'Não informado'
  let s = endereco.trim()
  s = s.replace(/,?\s*Conselheiro Lafaiete.*$/i, '')
  s = s.replace(/\s*-\s*MG.*$/i, '')
  s = s.replace(/\s*\d{5}-?\d{3}.*$/, '')
  if (s.includes(' - ')) {
    const partes = s.split(' - ').map(p => p.trim()).filter(Boolean)
    if (partes.length >= 2) return partes[partes.length - 1]
  }
  if (s.includes(',')) {
    const partes = s.split(',').map(p => p.trim()).filter(Boolean)
    if (partes.length >= 2) {
      const ultimo = partes[partes.length - 1]
      if (!/^\d+$/.test(ultimo)) return ultimo
      if (partes.length >= 3) return partes[partes.length - 2]
    }
  }
  return s || 'Não informado'
}

function extrairRuaExcel(endereco: string | null): string {
  if (!endereco) return 'Não informada'
  const limpo = endereco.trim().replace(/,?\s*Conselheiro Lafaiete.*$/i, '').replace(/\s*-\s*MG.*$/i, '')
  const primeiraParte = limpo.split(',')[0]?.trim() || limpo.split(' - ')[0]?.trim() || limpo
  return primeiraParte.replace(/\s+\d{1,5}\s*$/, '').trim() || 'Não informada'
}

function definirLinkInterno(cell: any, sheetName: string, row: number, tooltip: string) {
  cell.hyperlink = {
    target: `#'${sheetName.replace(/'/g, "''")}'!A${row}`,
    tooltip,
  }
  cell.font = { ...(cell.font || {}), color: { argb: '2563EB' }, underline: true }
}

function adicionarAbaDetalhamento(wb: ExcelWorkbook, ocorrencias: Ocorrencia[]): Map<string, number> {
  const ws = wb.addWorksheet('🔎 Detalhamento')
  const links = new Map<string, number>()
  ws.columns = [
    { width: 10 }, { width: 18 }, { width: 18 }, { width: 28 }, { width: 28 },
    { width: 16 }, { width: 14 }, { width: 42 }, { width: 30 },
  ]
  ws.mergeCells('A1:I1')
  ws.getCell('A1').value = '🔎 OCORRÊNCIAS POR CATEGORIA'
  ws.getCell('A1').font = { bold: true, size: 15, color: { argb: BRANCO } }
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  ws.getCell('A1').alignment = { horizontal: 'center' }
  ws.getCell('A2').value = 'Clique nos itens do Dashboard para abrir diretamente o grupo correspondente.'
  ws.getCell('A2').font = { italic: true, color: { argb: '64748b' } }
  ws.mergeCells('A2:I2')
  let row = 4
  const groups: Array<[string, string, (o: Ocorrencia) => string]> = [
    ['🏷️ Atividade / tipo', 'tipo', o => o.tipo || 'Não informado'],
    ['📋 Natureza', 'natureza', o => o.natureza || 'Não informado'],
    ['🏘️ Bairro', 'bairro', o => extrairBairroExcel(o.endereco)],
    ['🛣️ Rua', 'rua', o => extrairRuaExcel(o.endereco)],
    ['📌 Status', 'status', o => statusLabel(o.status_oc)],
    ['⚠️ Risco', 'risco', o => nivelLabel(o.nivel_risco)],
  ]
  for (const [title, kind, keyFor] of groups) {
    const values = [...new Set(ocorrencias.map(keyFor))].sort()
    for (const value of values) {
      const key = `${kind}:${value}`
      ws.mergeCells(`A${row}:I${row}`)
      ws.getCell(`A${row}`).value = `${title} — ${value}`
      ws.getCell(`A${row}`).font = { bold: true, color: { argb: BRANCO } }
      ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0f766e' } }
      links.set(key, row)
      row++
      const headers = ['ID', 'Data', 'Tipo', 'Natureza', 'Bairro', 'Rua', 'Status', 'Endereço', 'Situação']
      headers.forEach((header, index) => {
        const cell = ws.getCell(row, index + 1)
        cell.value = header
        cell.font = { bold: true, color: { argb: '475569' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_CLARO } }
      })
      row++
      ocorrencias.filter(o => keyFor(o) === value).forEach(o => {
        const bairro = extrairBairroExcel(o.endereco)
        const rua = extrairRuaExcel(o.endereco)
        ;[o.id, parseDateLocal(o.data_ocorrencia)?.toLocaleDateString('pt-BR') ?? '—',
          o.tipo || 'Não informado', o.natureza || 'Não informado', bairro, rua,
          statusLabel(o.status_oc), o.endereco || '—', o.situacao || '—',
        ].forEach((v, index) => ws.getCell(row, index + 1).value = v as ExcelCellValue)
        ws.getRow(row).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
          cell.alignment = { vertical: 'top', wrapText: columnNumber >= 8 } as any
        })
        row++
      })
      row++
    }
  }
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 9 } }
  ws.views = [{ state: 'frozen', ySplit: 2 }]
  return links
}

// ── Export single occurrence with photos ──────────────────────────────────────
export async function exportarOcorrenciaExcel(o: Ocorrencia): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CODAP - Conselheiro Lafaiete'
  wb.created = new Date()
  wb.calcProperties = { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true }

  const ws = wb.addWorksheet('Ocorrência', {
    pageSetup: { orientation: 'landscape', fitToPage: true },
  })

  ws.columns = [
    { width: 28 },
    { width: 38 },
    { width: 4 },
    { width: 32 },
    { width: 32 },
  ]

  ws.mergeCells('A1:E1')
  const titleCell = ws.getCell('A1')
  titleCell.value = 'CODAP — CONSELHEIRO LAFAIETE — RELATÓRIO DE OCORRÊNCIA'
  titleCell.font = { bold: true, size: 14, color: { argb: BRANCO } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 32

  ws.mergeCells('A2:E2')
  const subCell = ws.getCell('A2')
  subCell.value = `Ocorrência #${o.id} — Gerado em ${new Date().toLocaleString('pt-BR')}`
  subCell.font = { italic: true, size: 10, color: { argb: '6b7280' } }
  subCell.alignment = { horizontal: 'center' }
  ws.getRow(2).height = 18

  let row = 4

  function secao(titulo: string) {
    ws.mergeCells(`A${row}:B${row}`)
    const c = ws.getCell(`A${row}`)
    c.value = titulo
    c.font = { bold: true, size: 10, color: { argb: BRANCO } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LARANJA } }
    c.alignment = { horizontal: 'left', indent: 1 }
    ws.getRow(row).height = 20
    row++
  }

  function linha(label: string, valor: string | null | undefined) {
    const lCell = ws.getCell(`A${row}`)
    const vCell = ws.getCell(`B${row}`)
    lCell.value = label
    lCell.font = { bold: true, size: 10 }
    lCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_CLARO.replace('#', '') } }
    lCell.alignment = { vertical: 'top', indent: 1 }
    vCell.value = valor || '—'
    vCell.font = { size: 10 }
    vCell.alignment = { vertical: 'top', wrapText: true }
    vCell.border = { bottom: { style: 'thin', color: { argb: 'e5e7eb' } } }
    lCell.border = { bottom: { style: 'thin', color: { argb: 'e5e7eb' } } }
    ws.getRow(row).height = 18
    row++
  }

  secao('IDENTIFICAÇÃO')
  linha('ID', String(o.id))
  linha('Data da Ocorrência', parseDateLocal(o.data_ocorrencia)?.toLocaleDateString('pt-BR') ?? '—')
  linha('Registrado em', o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : '—')
  linha('Tipo', o.tipo)
  linha('Natureza', o.natureza)
  if (o.subnatureza) linha('Detalhe', o.subnatureza)
  linha('Nível de Risco', nivelLabel(o.nivel_risco))
  linha('Status', statusLabel(o.status_oc))

  row++
  secao('LOCALIZAÇÃO')
  linha('Endereço', o.endereco)
  linha('Latitude', o.lat != null ? String(o.lat) : null)
  linha('Longitude', o.lng != null ? String(o.lng) : null)

  row++
  secao('RESPONSÁVEL')
  linha('Proprietário / Morador', o.proprietario)
  linha('DDD e telefone', o.telefone_proprietario)

  row++
  secao('SITUAÇÃO')
  const obsCell = ws.getCell(`A${row}`)
  ws.mergeCells(`A${row}:B${row + 3}`)
  obsCell.value = o.situacao || '—'
  obsCell.font = { size: 10 }
  obsCell.alignment = { vertical: 'top', wrapText: true, indent: 1 }
  ws.getRow(row).height = 18
  row += 4

  if (o.recomendacao) {
    row++
    secao('RECOMENDAÇÃO')
    const recCell = ws.getCell(`A${row}`)
    ws.mergeCells(`A${row}:B${row + 3}`)
    recCell.value = o.recomendacao
    recCell.font = { size: 10 }
    recCell.alignment = { vertical: 'top', wrapText: true, indent: 1 }
    ws.getRow(row).height = 18
    row += 4
  }

  if (o.conclusao) {
    row++
    secao('CONCLUSÃO')
    const conCell = ws.getCell(`A${row}`)
    ws.mergeCells(`A${row}:B${row + 3}`)
    conCell.value = o.conclusao
    conCell.font = { size: 10 }
    conCell.alignment = { vertical: 'top', wrapText: true, indent: 1 }
    ws.getRow(row).height = 18
    row += 4
  }

  // ── Vistorias adicionais (Interdição de Imóvel) ──
  const vistoriasAdic = Array.isArray(o.vistorias) ? o.vistorias : []
  if (vistoriasAdic.length > 0) {
    row++
    ws.mergeCells(`A${row}:E${row}`)
    const vistoriasHeader = ws.getCell(`A${row}`)
    vistoriasHeader.value = `VISTORIAS ADICIONAIS (${vistoriasAdic.length})`
    vistoriasHeader.font = { bold: true, size: 10, color: { argb: BRANCO } }
    vistoriasHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'B91C1C' } }
    vistoriasHeader.alignment = { horizontal: 'left', indent: 1 }
    ws.getRow(row).height = 20
    row++

    vistoriasAdic.forEach((v, vIdx) => {
      const dataFmt = v.data ? new Date(v.data).toLocaleString('pt-BR') : '—'
      linha(`Vistoria #${vIdx + 1} — Data`, dataFmt)
      if (v.agente) linha(`Vistoria #${vIdx + 1} — Agente`, v.agente)
      const obsCellV = ws.getCell(`A${row}`)
      ws.mergeCells(`A${row}:B${row + 2}`)
      obsCellV.value = v.observacao || '—'
      obsCellV.font = { size: 10 }
      obsCellV.alignment = { vertical: 'top', wrapText: true, indent: 1 }
      ws.getRow(row).height = 18
      row += 3

      if (Array.isArray(v.fotos) && v.fotos.length > 0) {
        const ROW_H_PT_V = Math.round(FOTO_H / ROW_H_PX_TO_PT)
        let fRow = row
        let col = 3
        for (let i = 0; i < v.fotos.length; i++) {
          const fb = v.fotos[i]
          const data = fb.includes(',') ? fb.split(',')[1] : fb
          const ext = fb.startsWith('data:image/png') ? 'png' : 'jpeg'
          try {
            const imageId = wb.addImage({ base64: data, extension: ext })
            ws.addImage(imageId, {
              tl: { col, row: fRow - 1 },
              ext: { width: FOTO_W, height: FOTO_H },
            })
            ws.getRow(fRow).height = ROW_H_PT_V
          } catch { /* ignora */ }
          col++
          if (col > 4) { col = 3; fRow++; ws.getRow(fRow).height = ROW_H_PT_V }
        }
        row = fRow + 1
      }
      row++
    })
  }

  if (o.fotos && o.fotos.length > 0) {
    row++
    ws.mergeCells(`A${row}:E${row}`)
    const fotosHeader = ws.getCell(`A${row}`)
    fotosHeader.value = `FOTOS DO REGISTRO (${o.fotos.length})`
    fotosHeader.font = { bold: true, size: 10, color: { argb: BRANCO } }
    fotosHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    fotosHeader.alignment = { horizontal: 'left', indent: 1 }
    ws.getRow(row).height = 20
    row++

    const ROW_H_PT = Math.round(FOTO_H / ROW_H_PX_TO_PT)
    let fotoRow = row
    let col = 3

    for (let i = 0; i < o.fotos.length; i++) {
      const fotoBase64 = o.fotos[i]
      const base64Data = fotoBase64.includes(',') ? fotoBase64.split(',')[1] : fotoBase64
      const ext = fotoBase64.startsWith('data:image/png') ? 'png' : 'jpeg'

      try {
        const imageId = wb.addImage({ base64: base64Data, extension: ext })
        ws.addImage(imageId, {
          tl: { col: col, row: fotoRow - 1 },
          ext: { width: FOTO_W, height: FOTO_H },
        })
        ws.getRow(fotoRow).height = ROW_H_PT
      } catch {
        // ignora imagem inválida
      }

      col++
      if (col > 4) {
        col = 3
        fotoRow++
        ws.getRow(fotoRow).height = ROW_H_PT
      }
    }
  }

  ws.getCell('A1').border = {
    top: { style: 'medium', color: { argb: AZUL } },
    left: { style: 'medium', color: { argb: AZUL } },
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ocorrencia_${o.id}_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}


// ── Dashboard Analytics Sheet (100% editável e orientado por fórmulas) ────────
async function adicionarAbaDashboard(wb: ExcelWorkbook, ocorrencias: Ocorrencia[], detalheLinks: Map<string, number>): Promise<void> {
  const ws = wb.addWorksheet('📊 Dashboard', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  })
  const dataSheet = "'Ocorrências'"
  const ultimaLinha = Math.max(3, ocorrencias.length + 2)
  const ordenarPorFrequencia = (valores: string[]) => {
    const frequencias = new Map<string, number>()
    valores.forEach(valor => frequencias.set(valor, (frequencias.get(valor) ?? 0) + 1))
    return [...frequencias.keys()].sort((a, b) =>
      (frequencias.get(b) ?? 0) - (frequencias.get(a) ?? 0) || a.localeCompare(b, 'pt-BR'))
  }
  const tipos = ordenarPorFrequencia(ocorrencias.map(o => o.tipo || 'Não informado'))
  const naturezas = ordenarPorFrequencia(ocorrencias.map(o => o.natureza || 'Não informado'))
  const bairros = ordenarPorFrequencia(ocorrencias.map(o => extrairBairroExcel(o.endereco)))
  const ruas = ordenarPorFrequencia(ocorrencias.map(o => extrairRuaExcel(o.endereco)))

  ws.columns = [
    { width: 30 }, { width: 16 }, { width: 16 }, { width: 18 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
  ]
  ws.mergeCells('A1:H1')
  ws.getCell('A1').value = '📊 DASHBOARD DE OCORRÊNCIAS — PAINEL EDITÁVEL'
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: BRANCO } }
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 30

  ws.mergeCells('A2:H2')
  ws.getCell('A2').value = 'Altere as células amarelas para filtrar por atividade ou bairro. As tabelas e os gráficos recalculam ao abrir o arquivo.'
  ws.getCell('A2').font = { italic: true, size: 10, color: { argb: '475569' } }
  ws.getCell('A2').alignment = { horizontal: 'center' }

  ws.getCell('A4').value = 'Atividade / tipo'
  ws.getCell('A5').value = 'Bairro'
  ;['A4', 'A5'].forEach(ref => {
    ws.getCell(ref).font = { bold: true, color: { argb: AZUL } }
  })
  ws.getCell('B4').value = 'Todos'
  ws.getCell('B5').value = 'Todos'
  ;['B4', 'B5'].forEach(ref => {
    ws.getCell(ref).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2CC' } }
    ws.getCell(ref).font = { bold: true, color: { argb: '7c4a03' } }
    ws.getCell(ref).alignment = { horizontal: 'center' }
  })
  ws.getCell('D4').value = 'Opções de atividade: Todos ou um tipo existente na aba Ocorrências'
  ws.getCell('D5').value = 'Opções de bairro: Todos ou edite a coluna Bairro na aba Ocorrências'
  ;['D4', 'D5'].forEach(ref => {
    ws.getCell(ref).font = { italic: true, size: 9, color: { argb: '64748b' } }
  })

  const totalFormula = `IF(AND($B$4="Todos",$B$5="Todos"),COUNTA(${dataSheet}!$A$3:$A$${ultimaLinha}),IF($B$4="Todos",COUNTIF(${dataSheet}!$T$3:$T$${ultimaLinha},$B$5),IF($B$5="Todos",COUNTIF(${dataSheet}!$D$3:$D$${ultimaLinha},$B$4),COUNTIFS(${dataSheet}!$D$3:$D$${ultimaLinha},$B$4,${dataSheet}!$T$3:$T$${ultimaLinha},$B$5))))`
  const countFor = (column: string, value: string, extraFilter = true) => {
    const matching = ocorrencias.filter(o => {
      const bairro = extrairBairroExcel(o.endereco)
      const rua = extrairRuaExcel(o.endereco)
      const columnValue = column === 'D' ? (o.tipo || 'Não informado')
        : column === 'E' ? (o.natureza || 'Não informado')
          : column === 'H' ? statusLabel(o.status_oc)
            : column === 'T' ? bairro
              : rua
      return columnValue === value &&
        (!extraFilter || (ws.getCell('B4').value === 'Todos' || o.tipo === ws.getCell('B4').value) &&
          (ws.getCell('B5').value === 'Todos' || bairro === ws.getCell('B5').value))
    }).length
    return matching
  }
  const formulaCell = (ref: string, formula: string, result: number) => {
    ws.getCell(ref).value = { formula, result } as any
    ws.getCell(ref).numFmt = '0'
    ws.getCell(ref).font = { bold: true, size: 18, color: { argb: AZUL } }
    ws.getCell(ref).alignment = { horizontal: 'center', vertical: 'middle' }
  }
  const baseTotal = ocorrencias.length
  const resolvidos = ocorrencias.filter(o => o.status_oc === 'resolvido').length
  const ativos = baseTotal - resolvidos
  const altos = ocorrencias.filter(o => o.nivel_risco === 'alto').length
  const formulaComFiltros = (column: string, value: string) =>
    `IF(AND($B$4="Todos",$B$5="Todos"),COUNTIF(${dataSheet}!$${column}$3:$${column}$${ultimaLinha},"${value}"),IF($B$4="Todos",COUNTIFS(${dataSheet}!$${column}$3:$${column}$${ultimaLinha},"${value}",${dataSheet}!$T$3:$T$${ultimaLinha},$B$5),IF($B$5="Todos",COUNTIFS(${dataSheet}!$${column}$3:$${column}$${ultimaLinha},"${value}",${dataSheet}!$D$3:$D$${ultimaLinha},$B$4),COUNTIFS(${dataSheet}!$${column}$3:$${column}$${ultimaLinha},"${value}",${dataSheet}!$D$3:$D$${ultimaLinha},$B$4,${dataSheet}!$T$3:$T$${ultimaLinha},$B$5))))`
  const kpis: [string, string, string, number][] = [
    ['D7', 'Total', totalFormula, baseTotal],
    ['E7', 'Ativas', formulaComFiltros('H', 'Ativo'), ativos],
    ['F7', 'Resolvidas', formulaComFiltros('H', 'Resolvido'), resolvidos],
    ['G7', 'Risco alto', formulaComFiltros('G', 'Alto 🔴'), altos],
  ]
  kpis.forEach(([ref, label, formula, result]) => {
    const labelCell = ws.getCell(ref.replace('7', '6'))
    labelCell.value = label
    labelCell.font = { bold: true, color: { argb: '64748b' } }
    labelCell.alignment = { horizontal: 'center' }
    formulaCell(ref, formula, result)
    ws.getCell(ref).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } }
  })
  ws.getRow(6).height = 20
  ws.getRow(7).height = 32

  const secao = (row: number, title: string, color = AZUL) => {
    ws.mergeCells(`A${row}:C${row}`)
    ws.getCell(`A${row}`).value = title
    ws.getCell(`A${row}`).font = { bold: true, color: { argb: BRANCO } }
    ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
  }
  const cabecalho = (row: number, labels: string[]) => labels.forEach((label, i) => {
    const cell = ws.getCell(row, i + 1)
    cell.value = label
    cell.font = { bold: true, color: { argb: '475569' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_CLARO } }
  })
  const linha = (row: number, label: string, formula: string, result: number, columns = ['A', 'B', 'C'], totalRef = '$D$7', linkKey?: string) => {
    const [labelCol, countCol, pctCol, graphCol] = columns
    ws.getCell(`${labelCol}${row}`).value = label
    const detailRow = linkKey ? detalheLinks.get(linkKey) : undefined
    if (detailRow) definirLinkInterno(ws.getCell(`${labelCol}${row}`), '🔎 Detalhamento', detailRow, `Abrir ocorrências: ${label}`)
    ws.getCell(`${countCol}${row}`).value = { formula, result } as any
    ws.getCell(`${pctCol}${row}`).value = { formula: `IFERROR(${countCol}${row}/${totalRef},0)`, result: result / Math.max(baseTotal, 1) } as any
    ws.getCell(`${pctCol}${row}`).numFmt = '0.0%'
    if (graphCol) {
      ws.getCell(`${graphCol}${row}`).value = { formula: `IFERROR(REPT("█",ROUND(${countCol}${row}/MAX(${totalRef},1)*24,0)),"")`, result: result > 0 ? '█'.repeat(Math.min(24, Math.round(result / Math.max(baseTotal, 1) * 24))) : '' } as any
      ws.getCell(`${graphCol}${row}`).font = { color: { argb: '2563EB' }, size: 10 }
      ws.getCell(`${graphCol}${row}`).alignment = { horizontal: 'left' }
    }
    columns.forEach(col => {
      ws.getCell(`${col}${row}`).border = { bottom: { style: 'hair', color: { argb: 'dbeafe' } } }
      if (col !== labelCol) ws.getCell(`${col}${row}`).alignment = { horizontal: 'center' }
    })
  }

  secao(10, '🏷️ Por atividade / tipo')
  cabecalho(11, ['Atividade', 'Quantidade', '% do filtro', 'Gráfico'])
  tipos.forEach((tipo, i) => linha(12 + i, tipo,
    `IF($B$5="Todos",COUNTIF(${dataSheet}!$D$3:$D$${ultimaLinha},A${12 + i}),COUNTIFS(${dataSheet}!$D$3:$D$${ultimaLinha},A${12 + i},${dataSheet}!$T$3:$T$${ultimaLinha},$B$5))`,
    countFor('D', tipo), ['A', 'B', 'C', 'D'], '$D$7', `tipo:${tipo}`))

  const bairroInicio = 10
  // A tabela de bairros ocupa E:G, para ficar lado a lado com atividades.
  ws.mergeCells(`E${bairroInicio}:G${bairroInicio}`)
  ws.getCell(`E${bairroInicio}`).value = '🏘️ Bairros com mais ocorrências'
  ws.getCell(`E${bairroInicio}`).font = { bold: true, color: { argb: BRANCO } }
  ws.getCell(`E${bairroInicio}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0f766e' } }
  ;['E', 'F', 'G', 'H'].forEach((col, i) => {
    ws.getCell(`${col}11`).value = ['Bairro', 'Quantidade', '% do filtro', 'Gráfico'][i]
    ws.getCell(`${col}11`).font = { bold: true, color: { argb: '475569' } }
    ws.getCell(`${col}11`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_CLARO } }
  })
  bairros.forEach((bairro, i) => {
    const row = 12 + i
    linha(row, bairro, `IF($B$4="Todos",COUNTIF(${dataSheet}!$T$3:$T$${ultimaLinha},E${row}),COUNTIFS(${dataSheet}!$T$3:$T$${ultimaLinha},E${row},${dataSheet}!$D$3:$D$${ultimaLinha},$B$4))`, countFor('T', bairro), ['E', 'F', 'G', 'H'], '$D$7', `bairro:${bairro}`)
  })

  const detalhesRow = Math.max(12 + tipos.length, 12 + bairros.length) + 2
  secao(detalhesRow, '📋 Naturezas mais frequentes', '7c3aed')
  ws.mergeCells(`E${detalhesRow}:G${detalhesRow}`)
  ws.getCell(`E${detalhesRow}`).value = '🛣️ Por rua'
  ws.getCell(`E${detalhesRow}`).font = { bold: true, color: { argb: BRANCO } }
  ws.getCell(`E${detalhesRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'b45309' } }
  cabecalho(detalhesRow + 1, ['Natureza', 'Quantidade', '% do filtro', 'Gráfico'])
  ;['E', 'F', 'G', 'H'].forEach((col, i) => {
    ws.getCell(`${col}${detalhesRow + 1}`).value = ['Rua', 'Quantidade', '% do filtro', 'Gráfico'][i]
    ws.getCell(`${col}${detalhesRow + 1}`).font = { bold: true, color: { argb: '475569' } }
    ws.getCell(`${col}${detalhesRow + 1}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_CLARO } }
  })
  naturezas.forEach((natureza, i) => {
    const row = detalhesRow + 2 + i
    linha(row, natureza, `IF($B$5="Todos",COUNTIF(${dataSheet}!$E$3:$E$${ultimaLinha},A${row}),COUNTIFS(${dataSheet}!$E$3:$E$${ultimaLinha},A${row},${dataSheet}!$T$3:$T$${ultimaLinha},$B$5))`, countFor('E', natureza), ['A', 'B', 'C', 'D'], '$D$7', `natureza:${natureza}`)
  })
  ruas.forEach((rua, i) => {
    const row = detalhesRow + 2 + i
    linha(row, rua, `IF($B$4="Todos",COUNTIF(${dataSheet}!$U$3:$U$${ultimaLinha},E${row}),COUNTIFS(${dataSheet}!$U$3:$U$${ultimaLinha},E${row},${dataSheet}!$D$3:$D$${ultimaLinha},$B$4))`, countFor('U', rua), ['E', 'F', 'G', 'H'], '$D$7', `rua:${rua}`)
  })

  const statusRow = Math.max(detalhesRow + 2 + naturezas.length, detalhesRow + 2 + ruas.length) + 2
  secao(statusRow, '📌 Status no filtro')
  cabecalho(statusRow + 1, ['Status', 'Quantidade', '% do filtro', 'Gráfico'])
  ;['Ativo', 'Resolvido'].forEach((status, i) => {
    const row = statusRow + 2 + i
    linha(row, status, `IF(AND($B$4="Todos",$B$5="Todos"),COUNTIF(${dataSheet}!$H$3:$H$${ultimaLinha},A${row}),IF($B$4="Todos",COUNTIFS(${dataSheet}!$H$3:$H$${ultimaLinha},A${row},${dataSheet}!$T$3:$T$${ultimaLinha},$B$5),IF($B$5="Todos",COUNTIFS(${dataSheet}!$H$3:$H$${ultimaLinha},A${row},${dataSheet}!$D$3:$D$${ultimaLinha},$B$4),COUNTIFS(${dataSheet}!$H$3:$H$${ultimaLinha},A${row},${dataSheet}!$D$3:$D$${ultimaLinha},$B$4,${dataSheet}!$T$3:$T$${ultimaLinha},$B$5))))`,
       status === 'Resolvido' ? resolvidos : ativos, ['A', 'B', 'C', 'D'], '$D$7', `status:${status}`)
  })
  ws.mergeCells(`E${statusRow}:H${statusRow}`)
  ws.getCell(`E${statusRow}`).value = '⚠️ Nível de risco'
  ws.getCell(`E${statusRow}`).font = { bold: true, color: { argb: BRANCO } }
  ws.getCell(`E${statusRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'dc2626' } }
  ;['E', 'F', 'G', 'H'].forEach((col, i) => {
    ws.getCell(`${col}${statusRow + 1}`).value = ['Risco', 'Quantidade', '% do filtro', 'Gráfico'][i]
    ws.getCell(`${col}${statusRow + 1}`).font = { bold: true, color: { argb: '475569' } }
    ws.getCell(`${col}${statusRow + 1}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_CLARO } }
  })
  ;[['Baixo 🟢', '059669'], ['Médio 🟡', 'd97706'], ['Alto 🔴', 'dc2626']].forEach(([risco, cor], i) => {
    const row = statusRow + 2 + i
    linha(row, risco, formulaComFiltros('G', risco), ocorrencias.filter(o => nivelLabel(o.nivel_risco) === risco).length, ['E', 'F', 'G', 'H'], '$D$7', `risco:${risco}`)
    ws.getCell(`E${row}`).font = { bold: true, color: { argb: cor } }
  })

  ws.mergeCells(`A${statusRow + 6}:H${statusRow + 6}`)
  ws.getCell(`A${statusRow + 6}`).value = 'Os gráficos são barras proporcionais geradas por fórmula. Edite Tipo, Natureza, Endereço/Bairro, Rua ou os filtros amarelos na aba Ocorrências e pressione F9 para recalcular.'
  ws.getCell(`A${statusRow + 6}`).font = { italic: true, size: 9, color: { argb: '64748b' } }
  ws.getCell(`A${statusRow + 6}`).alignment = { wrapText: true }
  ws.views = [{ state: 'frozen', ySplit: 5 }]
  ws.autoFilter = { from: { row: 11, column: 1 }, to: { row: 11, column: 7 } }
}

// ── Export all occurrences (tabular) with embedded photo thumbnails ───────────
function textoExcel(valor: unknown, padrao = '—'): string | number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  if (typeof valor !== 'string') return padrao
  // Excel não aceita alguns caracteres de controle presentes em textos
  // antigos e isso pode fazer o writeBuffer falhar.
  const limpo = valor.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim()
  return limpo || padrao
}

function criarImagemDashboard(
  risco: { label: string; quantidade: number; cor: string }[],
  status: { label: string; quantidade: number; cor: string }[],
  tipos: { label: string; quantidade: number; cor: string }[],
  ultimosDias: { label: string; quantidade: number }[],
): string | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 1100
  canvas.height = 900
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const totalRisco = Math.max(risco.reduce((s, i) => s + i.quantidade, 0), 1)
  const totalStatus = Math.max(status.reduce((s, i) => s + i.quantidade, 0), 1)

  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#1a4b8c'
  ctx.fillRect(0, 0, canvas.width, 64)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 26px Arial'
  ctx.fillText('Dashboard de Ocorrências', 28, 40)

  const card = (x: number, y: number, w: number, h: number, title: string) => {
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 14)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#0f172a'
    ctx.font = 'bold 18px Arial'
    ctx.fillText(title, x + 18, y + 30)
  }
  const donut = (x: number, y: number, radius: number, dados: { label: string; quantidade: number; cor: string }[], total: number) => {
    let inicio = -Math.PI / 2
    dados.forEach(item => {
      const fatia = (item.quantidade / total) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.arc(x, y, radius, inicio, inicio + fatia)
      ctx.closePath()
      ctx.fillStyle = `#${item.cor}`
      ctx.fill()
      inicio += fatia
    })
    ctx.beginPath()
    ctx.arc(x, y, radius * 0.58, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.fillStyle = '#0f172a'
    ctx.font = 'bold 30px Arial'
    ctx.textAlign = 'center'
    ctx.fillText(String(dados.reduce((s, i) => s + i.quantidade, 0)), x, y + 8)
    ctx.font = '14px Arial'
    ctx.fillStyle = '#64748b'
    ctx.fillText('ocorrências', x, y + 30)
    ctx.textAlign = 'left'
  }
  const legenda = (x: number, y: number, dados: { label: string; quantidade: number; cor: string }[], total: number) => {
    ctx.font = '14px Arial'
    dados.forEach((item, i) => {
      const yy = y + i * 24
      ctx.fillStyle = `#${item.cor}`
      ctx.beginPath()
      ctx.arc(x + 6, yy - 5, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#475569'
      ctx.fillText(item.label, x + 20, yy)
      ctx.textAlign = 'right'
      ctx.fillText(`${item.quantidade} (${((item.quantidade / total) * 100).toFixed(1)}%)`, x + 220, yy)
      ctx.textAlign = 'left'
    })
  }

  card(20, 84, 520, 300, 'Por nível de risco')
  donut(175, 235, 112, risco, totalRisco)
  legenda(300, 180, risco, totalRisco)
  card(560, 84, 520, 300, 'Status')
  donut(715, 235, 112, status, totalStatus)
  legenda(840, 180, status, totalStatus)

  card(20, 408, 1060, 250, 'Tipos de ocorrência mais frequentes')
  const maxTipo = Math.max(...tipos.map(i => i.quantidade), 1)
  tipos.slice(0, 8).forEach((item, i) => {
    const yy = 455 + i * 24
    ctx.fillStyle = '#334155'
    ctx.font = '14px Arial'
    ctx.fillText(item.label.slice(0, 28), 38, yy + 14)
    ctx.fillStyle = `#${item.cor}`
    ctx.fillRect(250, yy, Math.max(4, (item.quantidade / maxTipo) * 700), 18)
    ctx.fillStyle = '#334155'
    ctx.fillText(String(item.quantidade), 965, yy + 14)
  })

  card(20, 682, 1060, 190, 'Últimos 14 dias')
  const maxDia = Math.max(...ultimosDias.map(i => i.quantidade), 1)
  ultimosDias.forEach((item, i) => {
    const barW = 48
    const gap = 20
    const h = Math.max(item.quantidade > 0 ? 8 : 2, (item.quantidade / maxDia) * 100)
    const x = 45 + i * (barW + gap)
    ctx.fillStyle = '#2563eb'
    ctx.fillRect(x, 735 + 100 - h, barW, h)
    ctx.fillStyle = '#64748b'
    ctx.font = '12px Arial'
    ctx.textAlign = 'center'
    ctx.fillText(item.label, x + barW / 2, 855)
    ctx.textAlign = 'left'
  })
  return canvas.toDataURL('image/png').split(',')[1] ?? null
}

function xmlEscapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function referenciaPlanilha(nome: string): string {
  return `'${nome.replace(/'/g, "''")}'`
}

function cacheCategoriasXml(categorias: string[]): string {
  return `<c:strCache><c:ptCount val="${categorias.length}"/>${categorias
    .map((categoria, index) => `<c:pt idx="${index}"><c:v>${xmlEscapar(categoria)}</c:v></c:pt>`)
    .join('')}</c:strCache>`
}

function cacheNumerosXml(valores: number[]): string {
  return `<c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="${valores.length}"/>${valores
    .map((valor, index) => `<c:pt idx="${index}"><c:v>${valor}</c:v></c:pt>`)
    .join('')}</c:numCache>`
}

function criarGraficoBarrasXml(
  titulo: string,
  categorias: string[],
  valores: number[],
  colunaCategorias: string,
  colunaValores: string,
  ultimaLinha: number,
  cor: string,
): string {
  const sheet = referenciaPlanilha('📈 Gráficos')
  const categoriasRef = `${sheet}!$${colunaCategorias}$4:$${colunaCategorias}$${ultimaLinha}`
  const valoresRef = `${sheet}!$${colunaValores}$4:$${colunaValores}$${ultimaLinha}`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <c:date1904 val="0"/><c:lang val="pt-BR"/><c:roundedCorners val="0"/>
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="pt-BR" sz="1400"/><a:t>${xmlEscapar(titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>
    <c:plotArea><c:layout/>
      <c:barChart>
        <c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>
        <c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Quantidade</c:v></c:tx>
          <c:spPr><a:solidFill><a:srgbClr val="${cor}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${cor}"/></a:solidFill></a:ln></c:spPr>
          <c:invertIfNegative val="0"/>
          <c:cat><c:strRef><c:f>${categoriasRef}</c:f>${cacheCategoriasXml(categorias)}</c:strRef></c:cat>
          <c:val><c:numRef><c:f>${valoresRef}</c:f>${cacheNumerosXml(valores)}</c:numRef></c:val>
          <c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/></c:dLbls>
        </c:ser>
        <c:gapWidth val="35"/><c:overlap val="0"/><c:axId val="-201"/><c:axId val="202"/>
      </c:barChart>
      <c:catAx><c:axId val="-201"/><c:scaling><c:orientation val="max"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="202"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:catAx>
      <c:valAx><c:axId val="202"/><c:scaling><c:orientation val="min"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:numFmt formatCode="0" sourceLinked="1"/><c:crossAx val="-201"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>
    </c:plotArea>
    <c:plotVisOnly val="1"/><c:dispBlanksAs val="zero"/><c:showDLblsOverMax val="0"/>
  </c:chart>
</c:chartSpace>`
}

function proximoNumeroArquivo(zip: any, padrao: RegExp): number {
  const usados = Object.keys(zip.files)
    .map(nome => nome.match(padrao))
    .filter(Boolean)
    .map(match => Number(match?.[1]))
    .filter(Number.isFinite)
  return Math.max(0, ...usados) + 1
}

async function adicionarGraficosNativosAoXlsx(
  buffer: ArrayBuffer | Uint8Array,
  categoriasBairro: string[],
  valoresBairro: number[],
  categoriasNatureza: string[],
  valoresNatureza: number[],
): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const drawingNumber = proximoNumeroArquivo(zip, /^xl\/drawings\/drawing(\d+)\.xml$/)
  const chartNumber = proximoNumeroArquivo(zip, /^xl\/charts\/chart(\d+)\.xml$/)
  const sheetNumber = Object.keys(zip.files)
    .map(nome => nome.match(/^xl\/worksheets\/sheet(\d+)\.xml$/))
    .filter(Boolean)
    .map(match => Number(match?.[1]))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0]
  if (!sheetNumber) throw new Error('Não foi possível localizar a aba de gráficos no Excel.')

  const sheetPath = `xl/worksheets/sheet${sheetNumber}.xml`
  const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`
  const sheetXml = await zip.file(sheetPath)?.async('string')
  const contentTypesPath = '[Content_Types].xml'
  const contentTypesXml = await zip.file(contentTypesPath)?.async('string')
  if (!sheetXml || !contentTypesXml) throw new Error('O arquivo Excel foi gerado sem os metadados esperados.')

  const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>27</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Gráfico de bairros"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>
  <xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>29</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>53</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="3" name="Gráfico de naturezas"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId2"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>`
  const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNumber}.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNumber + 1}.xml"/></Relationships>`
  const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNumber}.xml"/></Relationships>`
  const contentTypesAdicionais = [
    `<Override PartName="/xl/drawings/drawing${drawingNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.drawing+xml"/>`,
    `<Override PartName="/xl/charts/chart${chartNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
    `<Override PartName="/xl/charts/chart${chartNumber + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
  ].join('')

  zip.file(sheetPath, sheetXml.replace('</worksheet>', '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></worksheet>'))
  zip.file(sheetRelsPath, sheetRelsXml)
  zip.file(`xl/drawings/drawing${drawingNumber}.xml`, drawingXml)
  zip.file(`xl/drawings/_rels/drawing${drawingNumber}.xml.rels`, drawingRelsXml)
  zip.file(`xl/charts/chart${chartNumber}.xml`, criarGraficoBarrasXml('Quantidade de ocorrências por bairro', categoriasBairro, valoresBairro, 'K', 'L', categoriasBairro.length + 3, '2563EB'))
  zip.file(`xl/charts/chart${chartNumber + 1}.xml`, criarGraficoBarrasXml('Natureza das ocorrências', categoriasNatureza, valoresNatureza, 'N', 'O', categoriasNatureza.length + 3, '3B82F6'))
  zip.file(contentTypesPath, contentTypesXml.replace('</Types>', `${contentTypesAdicionais}</Types>`))
  return zip.generateAsync({ type: 'uint8array' })
}

async function exportarOcorrenciasSemFotos(
  ocorrencias: Ocorrencia[],
  onProgresso?: (atual: number, total: number) => void,
): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CODAP - Conselheiro Lafaiete'
  wb.created = new Date()
  wb.calcProperties = { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true }

  const ws = wb.addWorksheet('Ocorrências')
  const cabecalhos = [
    'ID', 'Data Ocorrência', 'Registrado em', 'Tipo', 'Natureza', 'Detalhe',
    'Nível de Risco', 'Status', 'Endereço', 'Latitude', 'Longitude',
    'Proprietário', 'DDD e telefone', 'Situação', 'Recomendação', 'Conclusão',
    'Vistorias Adicionais (qtd)', 'Última Vistoria', 'Observações das Vistorias',
    'Bairro (editável)', 'Rua (editável)',
  ]
  ws.columns = [6, 16, 20, 24, 28, 22, 16, 14, 36, 14, 14, 28, 22, 44, 44, 44, 18, 18, 60, 24, 30]
    .map(width => ({ width }))

  const titulo = ws.getCell('A1')
  ws.mergeCells(1, 1, 1, cabecalhos.length)
  titulo.value = `CODAP — CONSELHEIRO LAFAIETE — OCORRÊNCIAS — Gerado em ${new Date().toLocaleString('pt-BR')}`
  titulo.font = { bold: true, size: 12, color: { argb: BRANCO } }
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LARANJA } }
  titulo.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 26

  const header = ws.getRow(2)
  cabecalhos.forEach((valor, index) => {
    const cell = header.getCell(index + 1)
    cell.value = valor
    cell.font = { bold: true, size: 10, color: { argb: BRANCO } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  header.height = 24
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cabecalhos.length } }
  ws.views = [{ state: 'frozen', ySplit: 2 }]

  ocorrencias.forEach((o, index) => {
    const vistorias = Array.isArray(o.vistorias) ? o.vistorias : []
    const ultima = vistorias[vistorias.length - 1] as { data?: unknown } | undefined
    const ultimaData = ultima?.data ? new Date(String(ultima.data)) : null
    const ultimaVistoria = ultimaData && !Number.isNaN(ultimaData.getTime())
      ? ultimaData.toLocaleDateString('pt-BR')
      : '—'
    const observacoes = vistorias.map((v, i) => {
      const item = v as { data?: unknown; agente?: unknown; observacao?: unknown }
      const data = item.data ? new Date(String(item.data)) : null
      const dataTexto = data && !Number.isNaN(data.getTime()) ? data.toLocaleDateString('pt-BR') : '—'
      const agente = item.agente ? ` [${textoExcel(item.agente)}]` : ''
      return `#${i + 1} ${dataTexto}${agente}: ${textoExcel(item.observacao)}`
    }).join('\n') || '—'
    const row = ws.getRow(index + 3)
    ;[
      textoExcel(o.id, ''),
      textoExcel(parseDateLocal(o.data_ocorrencia)?.toLocaleDateString('pt-BR')),
      textoExcel(o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : ''),
      textoExcel(o.tipo), textoExcel(o.natureza), textoExcel(o.subnatureza),
      textoExcel(nivelLabel(o.nivel_risco)), textoExcel(statusLabel(o.status_oc)),
      textoExcel(o.endereco), textoExcel(o.lat), textoExcel(o.lng),
      textoExcel(o.proprietario), textoExcel(o.telefone_proprietario), textoExcel(o.situacao), textoExcel(o.recomendacao),
       textoExcel(o.conclusao), vistorias.length, ultimaVistoria, observacoes,
       extrairBairroExcel(o.endereco), extrairRuaExcel(o.endereco),
    ].forEach((valor, column) => { row.getCell(column + 1).value = valor as ExcelCellValue })
    row.height = 18
    row.eachCell({ includeEmpty: true }, cell => {
      cell.alignment = { vertical: 'top', wrapText: cell.column === 13 || cell.column === 14 || cell.column === 15 || cell.column === 18 }
      if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'f0f4ff' } }
    })
    onProgresso?.(index + 1, ocorrencias.length)
  })

  // Tabela estruturada: permite filtrar, editar e incluir novas linhas sem
  // perder a organização da base usada pelos relatórios.
  ws.addTable({
    name: 'TabelaOcorrencias',
    ref: `A2:U${Math.max(2, ocorrencias.length + 2)}`,
    headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: cabecalhos.map(name => ({ name, filterButton: true })),
    rows: ocorrencias.map((_, index) => (
      Array.from({ length: cabecalhos.length }, (_, column) => ws.getCell(index + 3, column + 1).value)
    )),
  })

  // Dashboard editável: os números são fórmulas para recalcular quando o
  // usuário filtrar/editar a aba Ocorrências no Excel.
  const dash = wb.addWorksheet('📊 Dashboard')
  dash.columns = [30, 16, 16, 42, 30, 16, 16, 42].map(width => ({ width }))
  dash.mergeCells('A1:H1')
  dash.getCell('A1').value = '📊 DASHBOARD DE OCORRÊNCIAS'
  dash.getCell('A1').font = { bold: true, size: 16, color: { argb: BRANCO } }
  dash.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  dash.getCell('A1').alignment = { horizontal: 'center' }
  dash.getCell('A2').value = 'Edite os dados na aba Ocorrências e pressione F9 para atualizar as fórmulas.'
  dash.mergeCells('A2:H2')
  dash.getCell('A2').font = { italic: true, color: { argb: '64748b' } }
  const ultimaLinha = Math.max(3, ocorrencias.length + 2)
  const base = `'Ocorrências'!$A$3:$R$${ultimaLinha}`
  const coluna = (letra: string) => `'Ocorrências'!$${letra}$3:$${letra}$${ultimaLinha}`
  const criterio = (valor: string) => `"${valor.replace(/"/g, '""')}"`
  const formula = (ref: string, valor: string, result: number) => {
    const cell = dash.getCell(ref)
    cell.value = { formula: valor, result } as any
    cell.font = { bold: true, size: 16, color: { argb: AZUL } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } }
  }
  dash.getCell('A4').value = 'Total'
  dash.getCell('B4').value = 'Ativas'
  dash.getCell('C4').value = 'Resolvidas'
  dash.getCell('D4').value = 'Risco alto'
  ;['A4', 'B4', 'C4', 'D4'].forEach(ref => {
    dash.getCell(ref).font = { bold: true, color: { argb: '64748b' } }
    dash.getCell(ref).alignment = { horizontal: 'center' }
  })
  formula('A5', `COUNTA(${coluna('A')})`, ocorrencias.length)
  formula('B5', `COUNTIF(${coluna('H')},${criterio('Ativo')})`, ocorrencias.filter(o => o.status_oc === 'ativo').length)
  formula('C5', `COUNTIF(${coluna('H')},${criterio('Resolvido')})`, ocorrencias.filter(o => o.status_oc === 'resolvido').length)
  formula('D5', `COUNTIF(${coluna('G')},${criterio('Alto 🔴')})`, ocorrencias.filter(o => o.nivel_risco === 'alto').length)
  dash.getRow(5).height = 30

  const tabela = (
    titulo: string,
    inicio: number,
    itens: { label: string; quantidade: number; cor: string }[],
    colunaDados: string,
  ) => {
    dash.mergeCells(`A${inicio}:D${inicio}`)
    dash.getCell(`A${inicio}`).value = titulo
    dash.getCell(`A${inicio}`).font = { bold: true, color: { argb: BRANCO } }
    dash.getCell(`A${inicio}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    ;['Categoria', 'Quantidade', '% do total', 'Gráfico'].forEach((label, i) => {
      const cell = dash.getCell(inicio + 1, i + 1)
      cell.value = label
      cell.font = { bold: true, color: { argb: '475569' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_CLARO } }
    })
    itens.forEach((item, index) => {
      const row = inicio + 2 + index
      dash.getCell(`A${row}`).value = item.label
      dash.getCell(`B${row}`).value = { formula: `COUNTIF(${coluna(colunaDados)},${criterio(item.label)})`, result: item.quantidade } as any
      dash.getCell(`C${row}`).value = { formula: `IFERROR(B${row}/$A$5,0)`, result: item.quantidade / Math.max(ocorrencias.length, 1) } as any
      dash.getCell(`C${row}`).numFmt = '0.0%'
      dash.getCell(`D${row}`).value = { formula: `IFERROR(REPT("█",ROUND(B${row}/MAX($A$5,1)*24,0)),"")`, result: '█'.repeat(Math.min(24, Math.round(item.quantidade / Math.max(ocorrencias.length, 1) * 24))) } as any
      dash.getCell(`D${row}`).font = { bold: true, color: { argb: item.cor } }
    })
  }

  const porNivel = [
    { label: 'Alto 🔴', quantidade: ocorrencias.filter(o => o.nivel_risco === 'alto').length, cor: 'dc2626' },
    { label: 'Médio 🟡', quantidade: ocorrencias.filter(o => o.nivel_risco === 'medio').length, cor: 'd97706' },
    { label: 'Baixo 🟢', quantidade: ocorrencias.filter(o => o.nivel_risco === 'baixo').length, cor: '059669' },
  ]
  const porStatus = [
    { label: 'Ativo', quantidade: ocorrencias.filter(o => o.status_oc === 'ativo').length, cor: 'dc2626' },
    { label: 'Resolvido', quantidade: ocorrencias.filter(o => o.status_oc === 'resolvido').length, cor: '059669' },
  ]
  tabela('⚠️ Por nível de risco', 8, porNivel, 'G')
  tabela('📌 Por status', 15, porStatus, 'H')

  dash.mergeCells('F8:H8')
  dash.getCell('F8').value = '🏷️ Por atividade / tipo'
  dash.getCell('F8').font = { bold: true, color: { argb: BRANCO } }
  dash.getCell('F8').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0f766e' } }
  ;['Tipo', 'Quantidade', 'Gráfico'].forEach((label, i) => {
    dash.getCell(9, i + 6).value = label
    dash.getCell(9, i + 6).font = { bold: true, color: { argb: '475569' } }
    dash.getCell(9, i + 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_CLARO } }
  })
  const tipos = [...new Set(ocorrencias.map(o => o.tipo || 'Não informado'))].sort()
  tipos.forEach((tipo, index) => {
    const row = 10 + index
    const qtd = ocorrencias.filter(o => (o.tipo || 'Não informado') === tipo).length
    dash.getCell(`F${row}`).value = tipo
    dash.getCell(`G${row}`).value = { formula: `COUNTIF(${coluna('D')},${criterio(tipo)})`, result: qtd } as any
    dash.getCell(`H${row}`).value = { formula: `IFERROR(REPT("█",ROUND(G${row}/MAX($A$5,1)*24,0)),"")`, result: '█'.repeat(Math.min(24, Math.round(qtd / Math.max(ocorrencias.length, 1) * 24))) } as any
    dash.getCell(`H${row}`).font = { bold: true, color: { argb: '2563EB' } }
  })
  dash.views = [{ state: 'frozen', ySplit: 5 }]

  // Gráficos nativos do Excel: as fórmulas da tabela auxiliar recalculam
  // quando o usuário edita a aba Ocorrências, sem transformar o gráfico em PNG.
  const bairros = [...new Set(ocorrencias.map(o => extrairBairroExcel(o.endereco)))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const naturezas = [...new Set(ocorrencias.map(o => o.natureza || 'Não informado'))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const graficos = wb.addWorksheet('📈 Gráficos')
  graficos.columns = [32, 16, 4, 42, 16, 4, 18, 18, 18, 18, 28, 16, 4, 42, 16].map(width => ({ width }))
  graficos.mergeCells('A1:I1')
  graficos.getCell('A1').value = '📈 GRÁFICOS DINÂMICOS DE OCORRÊNCIAS'
  graficos.getCell('A1').font = { bold: true, size: 16, color: { argb: BRANCO } }
  graficos.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  graficos.getCell('A1').alignment = { horizontal: 'center' }
  graficos.mergeCells('A2:I2')
  graficos.getCell('A2').value = 'Edite a aba Ocorrências e pressione F9 para recalcular. Os gráficos são objetos editáveis do Excel.'
  graficos.getCell('A2').font = { italic: true, color: { argb: '64748b' } }

  const preencherTabelaGrafico = (
    nomeTabela: string,
    titulo: string,
    colunaCategoria: string,
    colunaQuantidade: string,
    inicioColuna: number,
    itens: string[],
    origemColuna: string,
  ) => {
    graficos.addTable({
      name: nomeTabela,
      ref: `${colunaCategoria}3`,
      headerRow: true,
      style: { theme: 'TableStyleMedium4', showRowStripes: true },
      columns: [{ name: titulo, filterButton: true }, { name: 'Quantidade', filterButton: false }],
      rows: itens.map(item => [item, 0]),
    })
    itens.forEach((item, index) => {
      const row = index + 4
      graficos.getCell(`${colunaQuantidade}${row}`).value = {
        formula: `COUNTIF('Ocorrências'!$${origemColuna}:$${origemColuna},${colunaCategoria}${row})`,
        result: ocorrencias.filter(o => (
          origemColuna === 'T' ? extrairBairroExcel(o.endereco) : (o.natureza || 'Não informado')
        ) === item).length,
      } as any
    })
  }
  preencherTabelaGrafico('TabelaBairros', 'Bairro', 'K', 'L', 11, bairros, 'T')
  preencherTabelaGrafico('TabelaNaturezas', 'Natureza', 'N', 'O', 14, naturezas, 'E')
  graficos.views = [{ state: 'frozen', ySplit: 3 }]

  const buffer = await wb.xlsx.writeBuffer()
  const bufferComGraficos = await adicionarGraficosNativosAoXlsx(
    buffer,
    bairros,
    bairros.map(bairro => ocorrencias.filter(o => extrairBairroExcel(o.endereco) === bairro).length),
    naturezas,
    naturezas.map(natureza => ocorrencias.filter(o => (o.natureza || 'Não informado') === natureza).length),
  )
  const blob = new Blob([bufferComGraficos], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `codap_conselheiro_lafaiete_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportarTodasExcel(
  ocorrencias: Ocorrencia[],
  onProgresso?: (atual: number, total: number) => void,
): Promise<void> {
  return exportarOcorrenciasSemFotos(ocorrencias, onProgresso)

  /* Implementação analítica anterior mantida temporariamente para referência. */
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CODAP - Conselheiro Lafaiete'
  wb.created = new Date()
  wb.calcProperties = { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true }

  const ws = wb.addWorksheet('Ocorrências')

  // A exportação em massa não incorpora imagens; isso mantém o arquivo leve
  // e evita que fotos grandes impeçam a geração do Excel.
  const maxFotos = 0
   // Colunas extras: 15 base + bairro/rua editáveis + 3 vistorias + 1 área queimada
   const COLS_BASE = 15 + 2 + 3 + 1
  const totalCols = COLS_BASE + maxFotos

  // ── Linha 1: título ───────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, totalCols)
  const titulo = ws.getCell('A1')
  titulo.value = `CODAP — CONSELHEIRO LAFAIETE — TODAS AS OCORRÊNCIAS — Gerado em ${new Date().toLocaleString('pt-BR')}`
  titulo.font = { bold: true, size: 12, color: { argb: BRANCO } }
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LARANJA } }
  titulo.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 26

  // ── Linha 2: cabeçalhos das colunas ──────────────────────────────────────
  const cabecalhos = [
    'ID', 'Data Ocorrência', 'Registrado em', 'Tipo', 'Natureza', 'Detalhe',
     'Nível de Risco', 'Status', 'Endereço', 'Latitude', 'Longitude',
    'Proprietário', 'Situação', 'Recomendação', 'Conclusão',
    'Vistorias Adicionais (qtd)', 'Última Vistoria', 'Observações das Vistorias',
     'Área Queimada', 'Bairro (editável)', 'Rua (editável)',
    ...Array.from({ length: maxFotos }, (_, i) => `Foto ${i + 1}`),
  ]

  const larguras = [6, 16, 20, 14, 26, 20, 14, 12, 32, 12, 12, 26, 40, 40, 40,
     14, 18, 50, 20, 24, 30,
    ...Array(maxFotos).fill(FOTO_COL_W)]

  ws.columns = larguras.map((w) => ({ width: w }))

  const headerRow = ws.getRow(2)
  cabecalhos.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 10, color: { argb: BRANCO } }
     // Cols 16-18 = Vistorias; 19 = Área Queimada; 20/21 = Bairro/Rua; >= 22 = Fotos
    let bg = AZUL
    if (i >= 15 && i < 18) bg = 'B91C1C'
    else if (i === 18) bg = 'D97706'
     else if (i === 19) bg = 'D97706'
     else if (i === 20 || i === 21) bg = '0f766e'
     else if (i >= 22) bg = LARANJA
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: BRANCO } } }
  })
  headerRow.height = 22

  // ── Filtro e freeze ───────────────────────────────────────────────────────
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: totalCols } }
  ws.views = [{ state: 'frozen', ySplit: 2 }]

  // ── Linhas de dados (começam na linha 3) ─────────────────────────────────
  const LINHA_INICIO = 3  // primeira linha de dados (1-indexed)

  for (let idx = 0; idx < ocorrencias.length; idx++) {
    const o = ocorrencias[idx]
    onProgresso?.(idx + 1, ocorrencias.length)
    const linhaNum = LINHA_INICIO + idx
    const r = ws.getRow(linhaNum)

    const vAdic = Array.isArray(o.vistorias) ? o.vistorias : []
    const ultimaV = vAdic.length > 0 ? vAdic[vAdic.length - 1] : null
    const ultimaVistoriaTxt = ultimaV
      ? new Date(ultimaV.data).toLocaleDateString('pt-BR')
      : '—'
    const obsVistoriasTxt = vAdic.length > 0
      ? vAdic.map((v, i) => {
          const d = new Date(v.data).toLocaleDateString('pt-BR')
          const ag = v.agente ? ` [${v.agente}]` : ''
          const fc = Array.isArray(v.fotos) && v.fotos.length > 0 ? ` (📷 ${v.fotos.length})` : ''
          return `#${i + 1} ${d}${ag}${fc}: ${v.observacao || '—'}`
        }).join('\n')
      : '—'

    const polPontos = Array.isArray((o as any).poligono_area_queimada) && (o as any).poligono_area_queimada.length >= 3
      ? (o as any).poligono_area_queimada as { lat: number; lng: number }[]
      : null
    const areaQueimadaTxt = polPontos ? formatarAreaExcel(calcularAreaM2(polPontos)) : '—'

    const valores = [
      o.id,
      parseDateLocal(o.data_ocorrencia)?.toLocaleDateString('pt-BR') ?? '—',
      o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : '—',
      o.tipo,
      o.natureza,
      o.subnatureza || '—',
      nivelLabel(o.nivel_risco),
      statusLabel(o.status_oc),
      o.endereco || '—',
      o.lat ?? '—',
      o.lng ?? '—',
      o.proprietario || '—',
      o.situacao || '—',
      o.recomendacao || '—',
      o.conclusao || '—',
      vAdic.length,
      ultimaVistoriaTxt,
      obsVistoriasTxt,
      areaQueimadaTxt,
      extrairBairroExcel(o.endereco),
      extrairRuaExcel(o.endereco),
    ]

    valores.forEach((v, i) => { r.getCell(i + 1).value = v as ExcelCellValue })

    r.height = 18

    const isEven = idx % 2 === 1
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: 10 }
      cell.alignment = { vertical: 'middle', wrapText: false }
      if (isEven) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'f0f4ff' } }
    })

    // Wrap text na coluna de observações das vistorias (col 18)
    r.getCell(18).alignment = { vertical: 'top', wrapText: true }

    // Destaque para qtd de vistorias se houver
    if (vAdic.length > 0) {
      r.getCell(16).font = { bold: true, size: 10, color: { argb: 'B91C1C' } }
      r.getCell(16).alignment = { horizontal: 'center', vertical: 'middle' }
    }

    // Cor do nível de risco (coluna 7)
    const nivelCell = r.getCell(7)
    if (o.nivel_risco === 'alto') nivelCell.font = { bold: true, size: 10, color: { argb: 'dc2626' } }
    else if (o.nivel_risco === 'medio') nivelCell.font = { bold: true, size: 10, color: { argb: 'd97706' } }
    else nivelCell.font = { bold: true, size: 10, color: { argb: '059669' } }

  }

  // ── Abas analíticas e de detalhamento ─────────────────────────────
  const detalheLinks = adicionarAbaDetalhamento(wb, ocorrencias)
  await adicionarAbaDashboard(wb, ocorrencias, detalheLinks)

  // Ativa a aba de dados como padrão ao abrir
  ws.state = 'visible'

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `codap_conselheiro_lafaiete_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Em listas grandes a criação do Blob pode terminar no mesmo ciclo do
  // clique; revogar imediatamente pode cancelar o download em alguns browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Export checklists da viatura ──────────────────────────────────────────────
export async function exportarChecklistExcel(checklists: ChecklistExportData[], nomeArquivo?: string): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CODAP - Conselheiro Lafaiete'
  wb.created = new Date()

  const ws = wb.addWorksheet('Checklists', {
    pageSetup: { orientation: 'landscape', fitToPage: true },
  })

  const LABELS_BMR: Record<string, string> = { bom: 'Bom', medio: 'Médio', ruim: 'Ruim' }
  const LABELS_SN: Record<string, string> = { sim: 'Sim', nao: 'Não', na: 'N/A' }

  const ITENS_LABELS: [string, string, 'bmr' | 'sn'][] = [
    ['limpezaExterna', 'Limpeza Externa', 'bmr'],
    ['limpezaInterna', 'Limpeza Interna', 'bmr'],
    ['pneus', 'Pneus', 'bmr'],
    ['estepe', 'Estepe', 'bmr'],
    ['ltzPlaca', 'Luz Placa (Tras.)', 'sn'],
    ['ltzDirLuz', 'Luz Tras. Dir.', 'sn'],
    ['ltzDirLuzRe', 'Luz Ré Dir.', 'sn'],
    ['ltzDirFreio', 'Freio Dir.', 'sn'],
    ['ltzDirSeta', 'Seta Tras. Dir.', 'sn'],
    ['ltzEsqLuz', 'Luz Tras. Esq.', 'sn'],
    ['ltzEsqLuzRe', 'Luz Ré Esq.', 'sn'],
    ['ltzEsqFreio', 'Freio Esq.', 'sn'],
    ['ltzEsqSeta', 'Seta Tras. Esq.', 'sn'],
    ['ldzPlaca', 'Luz Placa (Diant.)', 'sn'],
    ['ldzDirFarolAlto', 'Farol Alto Dir.', 'sn'],
    ['ldzDirFarolBaixo', 'Farol Baixo Dir.', 'sn'],
    ['ldzDirNeblina', 'Neblina Dir.', 'sn'],
    ['ldzEsqFarolAlto', 'Farol Alto Esq.', 'sn'],
    ['ldzEsqFarolBaixo', 'Farol Baixo Esq.', 'sn'],
    ['ldzEsqSeta', 'Seta Diant. Esq.', 'sn'],
    ['ldzEsqNeblina', 'Neblina Esq.', 'sn'],
    ['segAlarme', 'Alarme', 'sn'],
    ['segBuzina', 'Buzina', 'sn'],
    ['segChaveRoda', 'Chave de Roda', 'sn'],
    ['segCintos', 'Cintos', 'sn'],
    ['segDocumentos', 'Documentos', 'sn'],
    ['segExtintor', 'Extintor', 'sn'],
    ['segLimpadores', 'Limpadores', 'sn'],
    ['segMacaco', 'Macaco', 'sn'],
    ['segPainel', 'Painel', 'sn'],
    ['segRetrovisorInterno', 'Retrovisor Int.', 'sn'],
    ['segRetrovisorDireito', 'Retrovisor Dir.', 'sn'],
    ['segRetrovisorEsquerdo', 'Retrovisor Esq.', 'sn'],
    ['segTravas', 'Travas', 'sn'],
    ['segTriangulo', 'Triângulo', 'sn'],
    ['motAcelerador', 'Acelerador', 'sn'],
    ['motAguaLimpador', 'Água Limpador', 'sn'],
    ['motAguaRadiador', 'Água Radiador', 'sn'],
    ['motEmbreagem', 'Embreagem', 'sn'],
    ['motFreio', 'Freio', 'sn'],
    ['motFreioMao', 'Freio de Mão', 'sn'],
    ['motOleoFreio', 'Óleo Freio', 'sn'],
    ['motOleoMoto', 'Óleo Motor', 'sn'],
    ['motTanquePartida', 'Tanque/Partida', 'sn'],
  ]

  const fotosFixas = ['Foto Esquerda', 'Foto Frontal', 'Foto Traseira', 'Foto Direita']
  const maxAvarias = checklists.reduce((max, c) => Math.max(max, c.fotos_avarias?.length ?? 0), 0)
  const fotosAvariasHeaders = Array.from({ length: maxAvarias }, (_, i) => `Foto Avaria ${i + 1}`)
  const fotoHeaders = [...fotosFixas, ...fotosAvariasHeaders]
  const totalCols = 9 + ITENS_LABELS.length + fotoHeaders.length
  const FOTO_CHECKLIST_SIZE = 110
  const FOTO_CHECKLIST_COL_W = 16
  const FOTO_CHECKLIST_ROW_H = Math.round(FOTO_CHECKLIST_SIZE / ROW_H_PX_TO_PT)

  ws.mergeCells(1, 1, 1, totalCols)
  const titulo = ws.getCell('A1')
  titulo.value = `CODAP — CONSELHEIRO LAFAIETE — CHECKLISTS DA VIATURA — Gerado em ${new Date().toLocaleString('pt-BR')}`
  titulo.font = { bold: true, size: 12, color: { argb: BRANCO } }
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  titulo.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 26

  const cabecalhos = [
    'ID', 'Data', 'Motorista', 'Placa', 'KM', 'Combustível', 'Avarias', 'Assinado', 'Observações',
    ...ITENS_LABELS.map(([, label]) => label),
    ...fotoHeaders,
  ]
  const larguras = [
    5, 12, 14, 10, 10, 11, 8, 10, 28,
    ...Array(ITENS_LABELS.length).fill(14),
    ...Array(fotoHeaders.length).fill(FOTO_CHECKLIST_COL_W),
  ]
  ws.columns = larguras.map(w => ({ width: w }))

  const headerRow = ws.getRow(2)
  cabecalhos.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 9, color: { argb: BRANCO } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i < 9 ? AZUL : i < 9 + ITENS_LABELS.length ? LARANJA : '166534' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: BRANCO } } }
  })
  headerRow.height = 36

  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: totalCols } }
  ws.views = [{ state: 'frozen', ySplit: 2 }]

  for (let idx = 0; idx < checklists.length; idx++) {
    const c = checklists[idx]
    const linhaNum = 3 + idx
    const r = ws.getRow(linhaNum)
    const it = c.itens || {}
    const [y,m,d] = String(c.data_checklist || '').split('T')[0].split('-')
    const fotosLinha = [
      c.foto_esquerda,
      c.foto_frontal,
      c.foto_traseira,
      c.foto_direita,
      ...(c.fotos_avarias || []),
    ]

    const valores = [
      c.id,
      `${d}/${m}/${y}`,
      c.motorista || '—',
      c.placa || '—',
      c.km || '—',
      it.nivelCombustivel || '—',
      c.fotos_avarias?.length ?? 0,
      c.assinatura_data ? 'Sim' : 'Não',
      c.observacoes || '—',
      ...ITENS_LABELS.map(([campo, , tipo]) => {
        const v = it[campo] || ''
        return tipo === 'bmr' ? (LABELS_BMR[v] || '—') : (LABELS_SN[v] || '—')
      }),
      ...fotoHeaders.map((_, fotoIdx) => fotosLinha[fotoIdx] ? 'Foto' : '—'),
    ]

    valores.forEach((v, i) => { r.getCell(i + 1).value = v as ExcelCellValue })

    r.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.font = { size: 9 }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      if (colNum <= 2) cell.alignment = { ...cell.alignment, horizontal: 'left' }
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'f0f4ff' } }

      if (colNum > 9 && colNum <= 9 + ITENS_LABELS.length) {
        const itenIdx = colNum - 10
        const [campo, , tipo] = ITENS_LABELS[itenIdx]
        const raw = it[campo] || ''
        if (tipo === 'bmr') {
          if (raw === 'bom') cell.font = { size: 9, bold: true, color: { argb: '15803d' } }
          else if (raw === 'medio') cell.font = { size: 9, bold: true, color: { argb: 'd97706' } }
          else if (raw === 'ruim') cell.font = { size: 9, bold: true, color: { argb: 'dc2626' } }
        } else {
          if (raw === 'sim') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'd1fae5' } }
          else if (raw === 'nao') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'fee2e2' } }
          else if (raw === 'na') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'f3f4f6' } }
        }
      }

      if (colNum > 9 + ITENS_LABELS.length) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
        cell.border = {
          top: { style: 'thin', color: { argb: 'd1d5db' } },
          left: { style: 'thin', color: { argb: 'd1d5db' } },
          bottom: { style: 'thin', color: { argb: 'd1d5db' } },
          right: { style: 'thin', color: { argb: 'd1d5db' } },
        }
      }
    })

    const temFoto = fotosLinha.some(Boolean)
    r.height = temFoto ? FOTO_CHECKLIST_ROW_H : 16

    for (let fotoIdx = 0; fotoIdx < fotosLinha.length; fotoIdx++) {
      const foto = fotosLinha[fotoIdx]
      if (!foto) continue
      const normalizada = await normalizarFoto(foto)
      if (!normalizada) continue
      const colIdx = 9 + ITENS_LABELS.length + fotoIdx
      try {
        const imageId = wb.addImage({ base64: normalizada.base64, extension: normalizada.ext })
        ws.addImage(imageId, {
          tl: { col: colIdx, row: linhaNum - 1 },
          ext: { width: FOTO_CHECKLIST_SIZE, height: FOTO_CHECKLIST_SIZE },
        })
      } catch {
        // ignora imagem inválida
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nomeArquivo ?? `checklists_viatura_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}`}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
