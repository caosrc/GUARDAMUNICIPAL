import JSZip from 'jszip'
import type { Ocorrencia } from './types'
import { gerarRelatorioVistoria } from './relatorioVistoria'

const MESES = [
  'janeiro','fevereiro','março','abril','maio','junho',
  'julho','agosto','setembro','outubro','novembro','dezembro',
]

function limparNomeArquivo(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^-+|-+$/g, '')
    .trim()
}

export function nomePastaOcorrencia(o: Ocorrencia): string {
  const partes = (o.endereco ?? '').split(',')
  const rua = partes[0]?.trim() ?? ''
  const numero = partes[1]?.trim() ?? ''
  const endParcial = numero ? `${rua}, ${numero}` : rua || 'Sem endereco'
  const proprietario = o.proprietario || 'Sem proprietario'
  const natureza = o.natureza || 'Ocorrencia'
  return limparNomeArquivo(`${endParcial} - ${proprietario} - ${natureza}`)
}

function dataFormatadaBR(dateStr: string | null | undefined): string {
  if (!dateStr) return '00-00-0000'
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return '00-00-0000'
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}

function dataExtenso(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
}

function decimalParaGms(valor: number, pos: string, neg: string): string {
  const abs = Math.abs(valor)
  const graus = Math.floor(abs)
  const mf = (abs - graus) * 60
  const min = Math.floor(mf)
  const seg = ((mf - min) * 60).toFixed(2).replace('.', ',')
  return `${graus}° ${min}' ${seg}" ${valor >= 0 ? pos : neg}`
}

function formatarCoords(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return 'Nao informadas'
  return `${decimalParaGms(lat, 'N', 'S')}, ${decimalParaGms(lng, 'L', 'O')}`
}

function xmlEsc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function par(texto: string, negrito = false): string {
  const rPr = negrito
    ? '<w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>'
    : '<w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>'
  return `<w:p><w:pPr><w:spacing w:after="100"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(texto)}</w:t></w:r></w:p>`
}

function parVazio(): string {
  return `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>`
}

function bloco(icone: string, label: string, valor: string): string {
  if (!valor || !valor.trim()) return ''
  return par(`${icone}  ${label}`, true) + par(valor) + parVazio()
}

function gerarDocxXml(o: Ocorrencia): string {
  const horaDisplay = o.hora_inicio && o.hora_fim
    ? `${o.hora_inicio} → ${o.hora_fim}`
    : o.hora_inicio
      ? `Inicio: ${o.hora_inicio}`
      : ''

  let duracaoStr = ''
  if (o.horas_total != null && Number(o.horas_total) > 0) {
    const h = Math.floor(Number(o.horas_total))
    const m = Math.round((Number(o.horas_total) - h) * 60)
    duracaoStr = ` (${h > 0 ? h + 'h' : ''}${m > 0 ? m + 'min' : ''} de ocorrencia)`
  }

  const semSobreaviso = Number(o.horas_sobreaviso) === 0 && o.horas_total != null && Number(o.horas_total) > 0
  const agentesStr = Array.isArray(o.agentes) && o.agentes.length > 0 ? o.agentes.join(', ') : ''

  const paragrafos = [
    par('Relatorio Simplificado de Ocorrencia', true),
    par('CODAP — Conselheiro Lafaiete, MG', true),
    parVazio(),
    o.data_ocorrencia
      ? bloco('📅', 'Data da Ocorrencia', dataExtenso(o.data_ocorrencia))
      : '',
    horaDisplay
      ? bloco('🕐', 'Horario da Ocorrencia', horaDisplay + duracaoStr) +
        (semSobreaviso ? par('   Horario comercial — sem horas de sobreaviso') + parVazio() : '')
      : '',
    (o.lat && o.lng)
      ? bloco('🛰️', 'Coordenadas GPS', formatarCoords(o.lat, o.lng))
      : '',
    o.endereco ? bloco('📍', 'Endereco', o.endereco) : '',
    o.proprietario ? bloco('👤', 'Proprietario / Morador', o.proprietario) : '',
    o.natureza ? bloco('📋', 'Natureza da Ocorrencia', o.natureza) : '',
    o.situacao ? bloco('📝', 'Situacao', o.situacao) : '',
    o.recomendacao ? bloco('💡', 'Recomendacao', o.recomendacao) : '',
    o.conclusao ? bloco('✅', 'Conclusao', o.conclusao) : '',
    o.responsavel_registro
      ? bloco('🪪', 'Responsavel pelo Registro', o.responsavel_registro)
      : '',
    agentesStr ? bloco('👷', 'Agentes Empenhados', agentesStr) : '',
  ].join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragrafos}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
    </w:sectPr>
  </w:body>
</w:document>`
}

async function gerarDocxBlob(o: Ocorrencia): Promise<Uint8Array> {
  const blob = await gerarRelatorioVistoria(o)
  return new Uint8Array(await blob.arrayBuffer())
}

interface ArquivoParaSalvar {
  nome: string
  dados: Uint8Array | string
  base64?: boolean
}

function base64ParaUint8Array(base64: string): Uint8Array {
  const bin = atob(base64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

async function salvarNaPastaEscolhida(
  nomePasta: string,
  arquivos: ArquivoParaSalvar[]
): Promise<void> {
  const rootHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })

  let pastaHandle: FileSystemDirectoryHandle
  try {
    pastaHandle = await rootHandle.getDirectoryHandle(nomePasta, { create: true })
  } catch {
    pastaHandle = rootHandle
  }

  for (const arq of arquivos) {
    const fileHandle = await pastaHandle.getFileHandle(arq.nome, { create: true })
    const writable = await fileHandle.createWritable()
    const dados = typeof arq.dados === 'string' && arq.base64
      ? base64ParaUint8Array(arq.dados)
      : arq.dados
    await writable.write(dados)
    await writable.close()
  }
}

async function salvarComoZip(
  nomePasta: string,
  arquivos: ArquivoParaSalvar[]
): Promise<void> {
  const zip = new JSZip()

  for (const arq of arquivos) {
    if (typeof arq.dados === 'string' && arq.base64) {
      zip.file(arq.nome, arq.dados, { base64: true })
    } else {
      zip.file(arq.nome, arq.dados as Uint8Array)
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nomePasta}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function exportarPastaOcorrencia(o: Ocorrencia): Promise<void> {
  const nomeBase = nomePastaOcorrencia(o)
  const arquivos: ArquivoParaSalvar[] = []

  const fotos = Array.isArray(o.fotos) ? o.fotos : []
  const dataFoto = dataFormatadaBR(o.data_ocorrencia || o.created_at)
  const horaH = o.hora_inicio ? parseInt(o.hora_inicio.split(':')[0]) : 0
  const horaM = o.hora_inicio ? parseInt(o.hora_inicio.split(':')[1] ?? '0') : 0

  for (let i = 0; i < fotos.length; i++) {
    const foto = fotos[i]
    if (!foto || !foto.startsWith('data:')) continue

    const totalMin = horaH * 60 + horaM + i
    const fH = Math.floor(totalMin / 60) % 24
    const fM = totalMin % 60
    const horaStr = `${String(fH).padStart(2, '0')}h${String(fM).padStart(2, '0')}`

    const match = foto.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/)
    if (!match) continue

    const ext = match[1] === 'png' ? 'png' : 'jpg'
    arquivos.push({
      nome: `Foto ${i + 1} - ${dataFoto} - ${horaStr}.${ext}`,
      dados: match[2],
      base64: true,
    })
  }

  const docBytes = await gerarDocxBlob(o)
  arquivos.push({ nome: 'Relatorio simplificado.docx', dados: docBytes })

  await salvarComoZip(nomeBase, arquivos)
}
