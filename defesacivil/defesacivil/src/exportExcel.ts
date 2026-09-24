import type { CellValue as ExcelCellValue } from 'exceljs'
import type { Ocorrencia } from './types'
import { parseDateLocal } from './utils'

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

function nivelLabel(n: string) {
  return n === 'alto' ? 'Alto 🔴' : n === 'medio' ? 'Médio 🟡' : 'Baixo 🟢'
}
function statusLabel(s: string) {
  return s === 'ativo' ? 'Ativo' : 'Resolvido'
}

// ── Export single occurrence with photos ──────────────────────────────────────
export async function exportarOcorrenciaExcel(o: Ocorrencia): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Defesa Civil Ouro Branco'
  wb.created = new Date()

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
  titleCell.value = 'DEFESA CIVIL OURO BRANCO — RELATÓRIO DE OCORRÊNCIA'
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

// ── Export all occurrences (tabular) with embedded photo thumbnails ───────────
export async function exportarTodasExcel(ocorrencias: Ocorrencia[]): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Defesa Civil Ouro Branco'
  wb.created = new Date()

  const ws = wb.addWorksheet('Ocorrências')

  const maxFotos = ocorrencias.reduce((max, o) => Math.max(max, o.fotos?.length ?? 0), 0)
  const totalCols = 15 + maxFotos

  // ── Linha 1: título ───────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, totalCols)
  const titulo = ws.getCell('A1')
  titulo.value = `DEFESA CIVIL OURO BRANCO — TODAS AS OCORRÊNCIAS — Gerado em ${new Date().toLocaleString('pt-BR')}`
  titulo.font = { bold: true, size: 12, color: { argb: BRANCO } }
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LARANJA } }
  titulo.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 26

  // ── Linha 2: cabeçalhos das colunas ──────────────────────────────────────
  const cabecalhos = [
    'ID', 'Data Ocorrência', 'Registrado em', 'Tipo', 'Natureza', 'Detalhe',
    'Nível de Risco', 'Status', 'Endereço', 'Latitude', 'Longitude',
    'Proprietário', 'Situação', 'Recomendação', 'Conclusão',
    ...Array.from({ length: maxFotos }, (_, i) => `Foto ${i + 1}`),
  ]

  const larguras = [6, 16, 20, 14, 26, 20, 14, 12, 32, 12, 12, 26, 40, 40, 40,
    ...Array(maxFotos).fill(FOTO_COL_W)]

  ws.columns = larguras.map((w) => ({ width: w }))

  const headerRow = ws.getRow(2)
  cabecalhos.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 10, color: { argb: BRANCO } }
    cell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: i >= 15 ? LARANJA : AZUL },
    }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: BRANCO } } }
  })
  headerRow.height = 22

  // ── Filtro e freeze ───────────────────────────────────────────────────────
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: totalCols } }
  ws.views = [{ state: 'frozen', ySplit: 2 }]

  // ── Linhas de dados (começam na linha 3) ─────────────────────────────────
  const ROW_H_PT = Math.round(FOTO_H / ROW_H_PX_TO_PT)
  const LINHA_INICIO = 3  // primeira linha de dados (1-indexed)

  ocorrencias.forEach((o, idx) => {
    const temFotos = o.fotos && o.fotos.length > 0
    const linhaNum = LINHA_INICIO + idx
    const r = ws.getRow(linhaNum)

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
    ]

    valores.forEach((v, i) => { r.getCell(i + 1).value = v as ExcelCellValue })

    r.height = temFotos ? ROW_H_PT : 18

    const isEven = idx % 2 === 1
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: 10 }
      cell.alignment = { vertical: 'middle', wrapText: false }
      if (isEven) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'f0f4ff' } }
    })

    // Cor do nível de risco (coluna 7)
    const nivelCell = r.getCell(7)
    if (o.nivel_risco === 'alto') nivelCell.font = { bold: true, size: 10, color: { argb: 'dc2626' } }
    else if (o.nivel_risco === 'medio') nivelCell.font = { bold: true, size: 10, color: { argb: 'd97706' } }
    else nivelCell.font = { bold: true, size: 10, color: { argb: '059669' } }

    // Incorpora fotos — linha 0-indexed = linhaNum - 1
    if (temFotos) {
      o.fotos!.forEach((fotoBase64, fotoIdx) => {
        const base64Data = fotoBase64.includes(',') ? fotoBase64.split(',')[1] : fotoBase64
        const ext = fotoBase64.startsWith('data:image/png') ? 'png' : 'jpeg'
        const colIdx = 15 + fotoIdx  // 0-indexed: coluna 16 em diante

        try {
          const imageId = wb.addImage({ base64: base64Data, extension: ext })
          ws.addImage(imageId, {
            tl: { col: colIdx, row: linhaNum - 1 },
            ext: { width: FOTO_W, height: FOTO_H },
          })
        } catch {
          // ignora imagem inválida
        }
      })
    }
  })

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `defesacivil_ourobranco_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Export checklists da viatura ──────────────────────────────────────────────
export async function exportarChecklistExcel(checklists: ChecklistExportData[]): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Defesa Civil Ouro Branco'
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
  const totalCols = 8 + ITENS_LABELS.length + fotoHeaders.length
  const FOTO_CHECKLIST_SIZE = 110
  const FOTO_CHECKLIST_COL_W = 16
  const FOTO_CHECKLIST_ROW_H = Math.round(FOTO_CHECKLIST_SIZE / ROW_H_PX_TO_PT)

  ws.mergeCells(1, 1, 1, totalCols)
  const titulo = ws.getCell('A1')
  titulo.value = `DEFESA CIVIL OURO BRANCO — CHECKLISTS DA VIATURA — Gerado em ${new Date().toLocaleString('pt-BR')}`
  titulo.font = { bold: true, size: 12, color: { argb: BRANCO } }
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  titulo.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 26

  const cabecalhos = [
    'ID', 'Data', 'Motorista', 'Placa', 'KM', 'Avarias', 'Assinado', 'Observações',
    ...ITENS_LABELS.map(([, label]) => label),
    ...fotoHeaders,
  ]
  const larguras = [
    5, 12, 14, 10, 10, 8, 10, 28,
    ...Array(ITENS_LABELS.length).fill(14),
    ...Array(fotoHeaders.length).fill(FOTO_CHECKLIST_COL_W),
  ]
  ws.columns = larguras.map(w => ({ width: w }))

  const headerRow = ws.getRow(2)
  cabecalhos.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 9, color: { argb: BRANCO } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i < 8 ? AZUL : i < 8 + ITENS_LABELS.length ? LARANJA : '166534' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: BRANCO } } }
  })
  headerRow.height = 36

  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: totalCols } }
  ws.views = [{ state: 'frozen', ySplit: 2 }]

  checklists.forEach((c, idx) => {
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

      if (colNum > 8 && colNum <= 8 + ITENS_LABELS.length) {
        const itenIdx = colNum - 9
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

      if (colNum > 8 + ITENS_LABELS.length) {
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

    fotosLinha.forEach((fotoBase64, fotoIdx) => {
      if (!fotoBase64) return
      const base64Data = fotoBase64.includes(',') ? fotoBase64.split(',')[1] : fotoBase64
      const ext = fotoBase64.startsWith('data:image/png') ? 'png' : 'jpeg'
      const colIdx = 8 + ITENS_LABELS.length + fotoIdx
      try {
        const imageId = wb.addImage({ base64: base64Data, extension: ext })
        ws.addImage(imageId, {
          tl: { col: colIdx, row: linhaNum - 1 },
          ext: { width: FOTO_CHECKLIST_SIZE, height: FOTO_CHECKLIST_SIZE },
        })
      } catch {
        // ignora imagem inválida
      }
    })
  })

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `checklists_viatura_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
