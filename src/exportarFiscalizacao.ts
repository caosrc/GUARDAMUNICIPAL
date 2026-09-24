import type { CurralRegistro } from './components/Curral'
import type { ProconRegistro } from './components/Procon'

type ExportResult = { total: number; pontos: number; semGps: number }
type ModuloFiscalizacao = 'curral' | 'procon'

function baixarArquivo(conteudo: BlobPart, nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function texto(valor: unknown) {
  return valor === null || valor === undefined || valor === '' ? 'Não informado' : String(valor)
}

function dataBr(valor: string) {
  if (!valor) return 'Não informado'
  const data = new Date(valor)
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleString('pt-BR')
}

function nomeDocumento(tipo?: string) {
  return ({
    relatorio_visita: 'Relatório de visita',
    termo_constatacao: 'Termo de constatação',
    auto_infracao: 'Auto de infração',
    auto_apreensao: 'Auto de apreensão',
  } as Record<string, string>)[tipo || ''] || 'Documento Procon'
}

function statusProcon(status?: string) {
  return status === 'enviado' ? 'Enviado ao órgão' : status === 'pendente' ? 'Aguardando envio' : status === 'finalizado' ? 'Finalizado' : 'Rascunho'
}

function curralRows(registros: CurralRegistro[]) {
  return registros.map((registro) => [
    'Curral',
    registro.id,
    registro.status,
    registro.especie,
    registro.porte,
    registro.sexo,
    registro.identificacao,
    registro.localDescricao,
    dataBr(registro.capturadoEm),
    registro.latitude,
    registro.longitude,
    registro.precisaoGps ? `${Math.round(registro.precisaoGps)} m` : '',
    registro.observacoes,
    registro.fotos.length,
  ])
}

function proconRows(relatorios: ProconRegistro[]) {
  return relatorios.map((registro) => [
    'Procon',
    registro.id,
    statusProcon(registro.status),
    nomeDocumento(registro.identificacao.tipoDocumento),
    registro.identificacao.numero,
    registro.identificacao.numeroProcesso,
    registro.identificacao.tipoVisita,
    registro.estabelecimento.nomeFantasia || registro.estabelecimento.razaoSocial,
    registro.estabelecimento.cnpj,
    registro.estabelecimento.responsavel,
    registro.endereco.logradouro ? `${registro.endereco.logradouro}, ${registro.endereco.numero}` : '',
    registro.endereco.municipio,
    registro.endereco.uf,
    dataBr(registro.identificacao.horaInicio),
    registro.localizacao.latitude,
    registro.localizacao.longitude,
    registro.irregularidades.length,
    registro.resultado.itens.join('; '),
    registro.identificacao.agente,
    registro.fotos.length,
    registro.documentos.length,
  ])
}

function ajustarLarguras(planilha: { columns: Array<{ width?: number }> }, linhas: unknown[][]) {
  planilha.columns.forEach((coluna, indice) => {
    const maior = linhas.reduce((tamanho, linha) => Math.max(tamanho, String(linha[indice] ?? '').length), 10)
    coluna.width = Math.min(42, maior + 2)
  })
}

export async function exportarFiscalizacaoExcel(registrosCurral: CurralRegistro[], relatoriosProcon: ProconRegistro[], modulo?: ModuloFiscalizacao) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CODAP'
  workbook.created = new Date()
  const exportarCurral = modulo !== 'procon'
  const exportarProcon = modulo !== 'curral'

  const curralHeaders = ['Módulo', 'ID', 'Status', 'Espécie', 'Porte', 'Sexo', 'Identificação', 'Local da apreensão', 'Capturado em', 'Latitude', 'Longitude', 'Precisão GPS', 'Observações', 'Fotos']
  const proconHeaders = ['Módulo', 'ID', 'Status', 'Documento', 'Número', 'Processo', 'Tipo de visita', 'Estabelecimento', 'CNPJ', 'Responsável', 'Endereço', 'Município', 'UF', 'Início', 'Latitude', 'Longitude', 'Irregularidades', 'Resultado', 'Agente', 'Fotos', 'Documentos']
  const criarPlanilha = (nome: string, titulo: string, headers: string[], linhas: unknown[][]) => {
    const sheet = workbook.addWorksheet(nome)
    sheet.addRow([titulo])
    sheet.mergeCells(1, 1, 1, headers.length)
    sheet.getRow(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A4B5C' } }
    sheet.addRow(headers)
    sheet.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE05F00' } }
    linhas.forEach((linha) => sheet.addRow(linha))
    sheet.views = [{ state: 'frozen', ySplit: 2 }]
    ajustarLarguras(sheet, [headers, ...linhas])
    return sheet
  }

  const resumo = workbook.addWorksheet('Resumo')
  const resumoLinhas = [
    ['RELATÓRIO DE FISCALIZAÇÃO CODAP'],
    ['Gerado em', dataBr(new Date().toISOString())],
  ]
  if (exportarCurral) resumoLinhas.push(['Registros Curral', registrosCurral.length])
  if (exportarProcon) resumoLinhas.push(['Registros Procon', relatoriosProcon.length])
  resumoLinhas.push(['Total de registros', (exportarCurral ? registrosCurral.length : 0) + (exportarProcon ? relatoriosProcon.length : 0)])
  resumo.addRows(resumoLinhas)
  resumo.getRow(1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  resumo.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A4B5C' } }
  resumo.getColumn(1).width = 30
  resumo.getColumn(2).width = 28
  if (exportarCurral) criarPlanilha('Curral', 'OCORRÊNCIAS DO CURRAL — UMA LINHA POR REGISTRO', curralHeaders, curralRows(registrosCurral))
  if (exportarProcon) criarPlanilha('Procon', 'AÇÕES DO PROCON — UMA LINHA POR DOCUMENTO', proconHeaders, proconRows(relatoriosProcon))

  const buffer = await workbook.xlsx.writeBuffer()
  const nomeArquivo = modulo ? `${modulo}_codap` : 'fiscalizacao_codap'
  baixarArquivo(buffer, `${nomeArquivo}_${new Date().toISOString().slice(0, 10)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  return { total: (exportarCurral ? registrosCurral.length : 0) + (exportarProcon ? relatoriosProcon.length : 0) }
}

function escapeXml(valor: unknown) {
  return texto(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function paragrafo(conteudo: string, estilo = '') {
  return `<w:p>${estilo ? `<w:pPr><w:pStyle w:val="${estilo}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${escapeXml(conteudo)}</w:t></w:r></w:p>`
}

function tabela(headers: string[], linhas: unknown[][]) {
  const largura = Math.max(1200, Math.floor(9000 / headers.length))
  const linha = (celulas: unknown[], cabecalho = false) => `<w:tr>${celulas.map((celula) => `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/></w:tcPr><w:p><w:r>${cabecalho ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(celula)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8C6C8"/><w:left w:val="single" w:sz="4" w:color="B8C6C8"/><w:bottom w:val="single" w:sz="4" w:color="B8C6C8"/><w:right w:val="single" w:sz="4" w:color="B8C6C8"/><w:insideH w:val="single" w:sz="4" w:color="D8E0E0"/><w:insideV w:val="single" w:sz="4" w:color="D8E0E0"/></w:tblBorders></w:tblPr>${linha(headers, true)}${linhas.map((item) => linha(item)).join('')}</w:tbl>`
}

export async function exportarFiscalizacaoDocx(registrosCurral: CurralRegistro[], relatoriosProcon: ProconRegistro[], modulo?: ModuloFiscalizacao) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const exportarCurral = modulo !== 'procon'
  const exportarProcon = modulo !== 'curral'
  const total = (exportarCurral ? registrosCurral.length : 0) + (exportarProcon ? relatoriosProcon.length : 0)
  const todasLinhas = [
    ...(exportarCurral ? curralRows(registrosCurral) : []),
    ...(exportarProcon ? proconRows(relatoriosProcon) : []),
  ]
  const cabecalho = ['Módulo', 'ID', 'Status', 'Documento / espécie', 'Número / processo', 'Estabelecimento / local', 'Data', 'Latitude', 'Longitude']
  const linhas = [
    ...(exportarCurral ? registrosCurral.map((registro) => ['Curral', registro.id, registro.status, registro.especie, '', registro.localDescricao, dataBr(registro.capturadoEm), registro.latitude, registro.longitude]) : []),
    ...(exportarProcon ? relatoriosProcon.map((registro) => ['Procon', registro.id, statusProcon(registro.status), nomeDocumento(registro.identificacao.tipoDocumento), `${registro.identificacao.numero}${registro.identificacao.numeroProcesso ? ` / ${registro.identificacao.numeroProcesso}` : ''}`, registro.estabelecimento.nomeFantasia || registro.estabelecimento.razaoSocial, dataBr(registro.identificacao.horaInicio), registro.localizacao.latitude, registro.localizacao.longitude]) : []),
  ]
  const detalhes = [
    ...(exportarCurral ? [paragrafo('Detalhamento do Curral', 'Heading1'), tabela(['ID', 'Espécie', 'Porte', 'Sexo', 'Identificação', 'Local', 'Data', 'GPS', 'Observações'], registrosCurral.map((registro) => [registro.id, registro.especie, registro.porte, registro.sexo, registro.identificacao, registro.localDescricao, dataBr(registro.capturadoEm), `${texto(registro.latitude)}, ${texto(registro.longitude)}`, registro.observacoes]))] : []),
    ...(exportarProcon ? [paragrafo('Detalhamento do Procon', 'Heading1'), tabela(['ID', 'Documento', 'Número', 'Processo', 'Estabelecimento', 'Município', 'Data', 'Irregularidades', 'Resultado'], relatoriosProcon.map((registro) => [registro.id, nomeDocumento(registro.identificacao.tipoDocumento), registro.identificacao.numero, registro.identificacao.numeroProcesso, registro.estabelecimento.nomeFantasia || registro.estabelecimento.razaoSocial, registro.endereco.municipio, dataBr(registro.identificacao.horaInicio), registro.irregularidades.length, registro.resultado.itens.join('; ')]))] : []),
  ].join('')
  const nomeRelatorio = modulo === 'curral' ? 'RELATÓRIO DO CURRAL — CODAP' : modulo === 'procon' ? 'RELATÓRIO DO PROCON — CODAP' : 'RELATÓRIO DE FISCALIZAÇÃO — CODAP'
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragrafo(nomeRelatorio, 'Title')}${paragrafo(`Gerado em ${dataBr(new Date().toISOString())}. ${total} registro(s) exportado(s).`)}${paragrafo('Registros linha a linha', 'Heading1')}${tabela(cabecalho, linhas)}${detalhes}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/document.xml', documentXml)
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1A4B5C"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="1A4B5C"/></w:rPr></w:style></w:styles>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`)
  const buffer = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const nomeArquivo = modulo ? `${modulo}_codap` : 'fiscalizacao_codap'
  baixarArquivo(buffer, `${nomeArquivo}_${new Date().toISOString().slice(0, 10)}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  return { total }
}

function kmlTexto(valor: unknown) {
  return texto(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function placemark(nome: string, descricao: string, latitude: number | null, longitude: number | null) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return ''
  return `<Placemark><name>${kmlTexto(nome)}</name><description><![CDATA[${descricao.replace(/]]>/g, ']]&gt;')}]></description><Point><coordinates>${longitude},${latitude},0</coordinates></Point></Placemark>`
}

export async function exportarFiscalizacaoKmz(registrosCurral: CurralRegistro[], relatoriosProcon: ProconRegistro[], modulo?: ModuloFiscalizacao): Promise<ExportResult> {
  const JSZip = (await import('jszip')).default
  const exportarCurral = modulo !== 'procon'
  const exportarProcon = modulo !== 'curral'
  const registrosParaExportar = exportarCurral ? registrosCurral : []
  const relatoriosParaExportar = exportarProcon ? relatoriosProcon : []
  let pontos = 0
  let semGps = 0
  const curralPlacemarks = registrosParaExportar.map((registro) => {
    const item = placemark(
      `${registro.especie || 'Animal'} — ${registro.id}`,
      `<b>Curral</b><br/>Espécie: ${kmlTexto(registro.especie)}<br/>Porte: ${kmlTexto(registro.porte)}<br/>Sexo: ${kmlTexto(registro.sexo)}<br/>Identificação: ${kmlTexto(registro.identificacao)}<br/>Local: ${kmlTexto(registro.localDescricao)}<br/>Data: ${kmlTexto(dataBr(registro.capturadoEm))}<br/>Status: ${kmlTexto(registro.status)}<br/>Observações: ${kmlTexto(registro.observacoes)}`,
      registro.latitude,
      registro.longitude,
    )
    item ? pontos++ : semGps++
    return item
  }).join('')
  const proconPlacemarks = relatoriosParaExportar.map((registro) => {
    const nome = registro.estabelecimento.nomeFantasia || registro.estabelecimento.razaoSocial || 'Ação Procon'
    const item = placemark(
      `${nome} — ${registro.identificacao.numero}`,
      `<b>Procon</b><br/>Documento: ${kmlTexto(nomeDocumento(registro.identificacao.tipoDocumento))}<br/>Número: ${kmlTexto(registro.identificacao.numero)}<br/>Processo: ${kmlTexto(registro.identificacao.numeroProcesso)}<br/>Estabelecimento: ${kmlTexto(nome)}<br/>Endereço: ${kmlTexto(registro.endereco.logradouro)} ${kmlTexto(registro.endereco.numero)}<br/>Município: ${kmlTexto(registro.endereco.municipio)} / ${kmlTexto(registro.endereco.uf)}<br/>Data: ${kmlTexto(dataBr(registro.identificacao.horaInicio))}<br/>Irregularidades: ${registro.irregularidades.length}<br/>Status: ${kmlTexto(statusProcon(registro.status))}<br/>Agente: ${kmlTexto(registro.identificacao.agente)}`,
      registro.localizacao.latitude,
      registro.localizacao.longitude,
    )
    item ? pontos++ : semGps++
    return item
  }).join('')
  const nomeMapa = modulo === 'curral' ? 'Curral CODAP' : modulo === 'procon' ? 'Procon CODAP' : 'Fiscalização CODAP'
  const pastas = [
    ...(exportarCurral ? [`<Folder><name>Curral — animais apreendidos</name>${curralPlacemarks}</Folder>`] : []),
    ...(exportarProcon ? [`<Folder><name>Procon — ações de fiscalização</name>${proconPlacemarks}</Folder>`] : []),
  ].join('')
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${nomeMapa}</name><description>Registros georreferenciados exportados pelo CODAP para consulta no Google Earth.</description>${pastas}</Document></kml>`
  const zip = new JSZip()
  zip.file('fiscalizacao.kml', kml)
  const buffer = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.google-earth.kmz' })
  const nomeArquivo = modulo ? `${modulo}_codap` : 'fiscalizacao_codap'
  baixarArquivo(buffer, `${nomeArquivo}_${new Date().toISOString().slice(0, 10)}.kmz`, 'application/vnd.google-earth.kmz')
  return { total: registrosParaExportar.length + relatoriosParaExportar.length, pontos, semGps }
}