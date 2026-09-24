import JSZip from 'jszip'
import type { Ocorrencia } from './types'
import { normalizarNomeAgente } from './types'
import { converterParaJpeg } from './utils'

// Versão explícita evita que o navegador reutilize um modelo DOCX antigo do cache.
const TEMPLATE_URL = '/relatorio-vistoria-template.docx?v=modelo-1789057943437'

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function textoDoParagrafo(paragrafo: string): string {
  return (paragrafo.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) ?? [])
    .map((trecho) => trecho.replace(/^<w:t\b[^>]*>|<\/w:t>$/g, ''))
    .join('')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function atributosTexto(atributos: string): string {
  return atributos.replace(/\s+xml:space="[^"]*"/g, '')
}

function substituirTextoDoParagrafo(
  documentXml: string,
  localizar: (texto: string) => boolean,
  novoTexto: string,
  incluirParagrafosVazios = false,
): string {
  let encontrado = false
  return documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragrafo) => {
    if (encontrado || !localizar(textoDoParagrafo(paragrafo))) return paragrafo
    const textos = paragrafo.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) ?? []
    if (!incluirParagrafosVazios && textos.length === 0) return paragrafo
    encontrado = true
    let primeiro = true
    return paragrafo.replace(/<w:t\b([^>]*)>[\s\S]*?<\/w:t>/g, (_trecho, atributos: string) => {
      if (!primeiro) return ''
      primeiro = false
      return `<w:t${atributosTexto(atributos)} xml:space="preserve">${xmlEscape(novoTexto)}</w:t>`
    })
  })
}

function substituirPrimeiroParagrafoApos(
  documentXml: string,
  marcador: string,
  novoTexto: string,
): string {
  let aposMarcador = false
  let preenchido = false
  return documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragrafo) => {
    const texto = textoDoParagrafo(paragrafo)
    if (texto.includes(marcador)) {
      aposMarcador = true
      return paragrafo
    }
    if (!aposMarcador || preenchido) return paragrafo

    const textos = paragrafo.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) ?? []
    const vazio = texto.trim() === ''
    if (!vazio && !texto.includes('(informações da')) return paragrafo

    preenchido = true
    if (textos.length === 0) {
      const insercao = `<w:r><w:t xml:space="preserve">${xmlEscape(novoTexto)}</w:t></w:r>`
      return paragrafo.replace('</w:p>', `${insercao}</w:p>`)
    }
    let primeiro = true
    return paragrafo.replace(/<w:t\b([^>]*)>[\s\S]*?<\/w:t>/g, (_trecho, atributos: string) => {
      if (!primeiro) return ''
      primeiro = false
      return `<w:t${atributosTexto(atributos)} xml:space="preserve">${xmlEscape(novoTexto)}</w:t>`
    })
  })
}

function formatarDataCurta(data: Date = new Date()): string {
  return data.toLocaleDateString('pt-BR')
}

function formatarDataExtenso(data: Date = new Date()): string {
  return `${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}`
}

function decimalParaGms(valor: number | null | undefined, positivo: string, negativo: string): string {
  const absoluto = Math.abs(Number(valor))
  const graus = Math.floor(absoluto)
  const minutosFloat = (absoluto - graus) * 60
  const minutos = Math.floor(minutosFloat)
  const segundos = ((minutosFloat - minutos) * 60).toFixed(2).replace('.', ',')
  return `${graus}° ${minutos}' ${segundos}" ${Number(valor) >= 0 ? positivo : negativo}`
}

function formatarCoordenadas(lat: number | null | undefined, lng: number | null | undefined): string {
  if (lat == null || lng == null) return 'Não informadas'
  return `${decimalParaGms(lat, 'N', 'S')}, ${decimalParaGms(lng, 'L', 'O')}`
}

function limparNomeArquivo(valor: unknown, fallback: string): string {
  const limpo = String(valor || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return limpo || fallback
}

function nomeRua(endereco: string | null | undefined): string {
  const texto = String(endereco || '').trim()
  if (!texto) return 'Endereco'
  return texto.split(',')[0].trim() || texto
}

function nomeBairro(endereco: string | null | undefined): string {
  const partes = String(endereco || '').split(',').map(p => p.trim())
  return partes.slice(2).join(' ').trim()
}

function formatarEnderecoRelatorio(endereco: string | null | undefined): string {
  const texto = String(endereco || '').trim()
  if (!texto) return 'Não informado'
  const partes = texto.split(',').map(p => p.trim())
  if (partes.length >= 3) {
    const bairro = partes.slice(2).join(', ').trim()
    if (bairro) {
      return partes.slice(0, 2).join(', ') + ', Bairro ' + bairro
    }
  }
  return texto
}

const NOMES_COMPLETOS_ASSINATURA: Record<string, string> = {
  Rosane: 'Rosane Felisbina Coelho',
  Lucas: 'Lucas Hilário de Carvalho',
  Junior: 'Junior Clayton Glauberto',
}

const NOME_COORDENADOR = 'Alexandre Dantte Barbosa'

function nomesAssinatura(ocorrencia: Ocorrencia): { responsavel: string; coordenador: string } {
  const agente = normalizarNomeAgente(ocorrencia.responsavel_registro || '')
  return {
    // Alexandre assina somente como coordenador, nunca na assinatura da equipe.
    responsavel: agente === 'Alexandre'
      ? ''
      : NOMES_COMPLETOS_ASSINATURA[agente] || agente,
    coordenador: NOME_COORDENADOR,
  }
}

export function relatorioFileName(ocorrencia: Ocorrencia): string {
  const numero = limparNomeArquivo(ocorrencia.id, 'numero')
  const rua = limparNomeArquivo(nomeRua(ocorrencia.endereco), 'Nome_da_Rua')
  const bairro = limparNomeArquivo(nomeBairro(ocorrencia.endereco), '')
  const requerente = limparNomeArquivo(ocorrencia.proprietario, 'Nome_do_requerente')
  const partes: string[] = ['RelVist', numero, rua]
  if (bairro) partes.push(bairro)
  partes.push(requerente)
  return partes.join('_') + '.docx'
}

interface ImagemDataUrl {
  mime: string
  extension: 'png' | 'jpeg'
  bytes: Uint8Array
}

async function parseDataUrl(dataUrl: string): Promise<ImagemDataUrl | null> {
  const normalizada = await converterParaJpeg(String(dataUrl || ''))
  const match = normalizada.match(/^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/)
  if (!match) return null
  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1]
  const extension = mime === 'image/png' ? 'png' : 'jpeg'
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { mime, extension, bytes }
}

function imageDrawingXml(rId: string, index: number): string {
  const cx = 2880000
  const cy = 3420000
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${200 + index}" name="Foto ${index}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="0"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${300 + index}" name="Foto ${index}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

let templateCache: ArrayBuffer | null = null

async function carregarTemplate(): Promise<ArrayBuffer> {
  if (templateCache) return templateCache
  const res = await fetch(TEMPLATE_URL, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`Não foi possível carregar o modelo do relatório (${res.status}). Verifique sua conexão.`)
  }
  templateCache = await res.arrayBuffer()
  return templateCache
}

export async function gerarRelatorioVistoria(ocorrencia: Ocorrencia): Promise<Blob> {
  const template = await carregarTemplate()
  const zip = await JSZip.loadAsync(template)
  const hoje = ocorrencia.created_at ? new Date(ocorrencia.created_at) : new Date()
  const natureza = ocorrencia.natureza || 'Não informada'
  const requerente = ocorrencia.proprietario || 'Não informado'
  const endereco = ocorrencia.endereco || 'Não informado'
  const protocolo = String(ocorrencia.id || '').trim() || 'Não informado'
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('Modelo de relatório inválido (document.xml ausente).')
  let documentXml = await docFile.async('string')

  const situacao = String(ocorrencia.situacao || '').trim()
  const recomendacao = String(ocorrencia.recomendacao || '').trim()
  const conclusao = String(ocorrencia.conclusao || '').trim()
  const dataExtenso = formatarDataExtenso(hoje)
  const enderecoFormatado = formatarEnderecoRelatorio(ocorrencia.endereco)
  const coordenadas = formatarCoordenadas(ocorrencia.lat, ocorrencia.lng)
  const assinaturas = nomesAssinatura(ocorrencia)
  const ehAlexandre = normalizarNomeAgente(ocorrencia.responsavel_registro || '') === 'Alexandre'
  const textoSituacao = situacao ? `Durante a vistoria, ${situacao}` : 'Durante a vistoria,'
  const textoConclusao = conclusao
    ? `Diante de todas as informações presentes nesse relatório conclui-se que ${conclusao.replace(/[.!?]+$/, '')}. Faz-se necessário que se atente às recomendações listadas nesse relatório para garantir o bem estar, segurança e a tranquilidade de todos.`
    : 'Diante de todas as informações presentes nesse relatório. Faz-se necessário que se atente às recomendações listadas nesse relatório para garantir o bem estar, segurança e a tranquilidade de todos.'

  // O modelo enviado é um documento preenchido como exemplo. Estes trechos
  // transformam o exemplo em campos sem alterar a diagramação do arquivo.
  documentXml = substituirTextoDoParagrafo(
    documentXml,
    (texto) => texto.startsWith('Conselheiro Lafaiete,'),
    `Conselheiro Lafaiete, ${formatarDataCurta(hoje)}`,
  )
  documentXml = substituirTextoDoParagrafo(
    documentXml,
    (texto) => texto.startsWith('Protocolo:'),
    `Protocolo: ${protocolo}`,
  )
  documentXml = substituirTextoDoParagrafo(
    documentXml,
    (texto) => texto.startsWith('REQUERENTE:'),
    `REQUERENTE: ${requerente}`,
  )
  documentXml = substituirTextoDoParagrafo(
    documentXml,
    (texto) => texto.trimStart().startsWith('Análise de segurança de'),
    `Análise de segurança de ${natureza}`,
  )
  documentXml = substituirTextoDoParagrafo(
    documentXml,
    (texto) => texto.trimStart().startsWith('Foi promovida vistoria em'),
    `Foi promovida vistoria em ${dataExtenso} pela equipe da Coordenadoria Municipal de Proteção e Defesa Civil do município de Conselheiro Lafaiete, conforme solicitação supramencionada na ${enderecoFormatado}, coordenadas ${coordenadas}.`,
  )
  documentXml = substituirTextoDoParagrafo(
    documentXml,
    (texto) => texto.trimStart().startsWith('Durante a vistoria,'),
    textoSituacao,
  )
  documentXml = substituirPrimeiroParagrafoApos(documentXml, 'Recomendação:', recomendacao)
  documentXml = substituirTextoDoParagrafo(
    documentXml,
    (texto) => texto.startsWith('Diante de todas as informações presentes'),
    textoConclusao,
  )
  documentXml = substituirTextoDoParagrafo(
    documentXml,
    (texto) => {
      const nome = texto.trim()
      return nome === 'Nome' || nome === '“Nome completo do agente”' || nome === '"Nome completo do agente"'
    },
    assinaturas.responsavel,
  )
  documentXml = substituirTextoDoParagrafo(
    documentXml,
    (texto) => texto.trim() === 'Nome',
    assinaturas.coordenador,
  )

  const substituicoes: Record<string, string> = {
    '“data 1”': formatarDataCurta(hoje),
    '“Nome do requerente”': xmlEscape(requerente),
    '“Natureza da Ocorrência”': xmlEscape(natureza),
    'Natureza da Ocorrência': xmlEscape(natureza),
    '“data 2”': xmlEscape(formatarDataExtenso(hoje)),
    '\u201cEndere\u00e7o\u201d': xmlEscape(enderecoFormatado),
    '"coordenadas do local"': xmlEscape(coordenadas),
    'coordenadas do local': xmlEscape(coordenadas),
    '(informações da situação descrita na ocorrência, quadro 9)': xmlEscape(situacao),
    '(informações da recomendação descrita na ocorrência, quadro 10)': xmlEscape(recomendacao),
    '(informações da situação descrita na conclusão, quadro 11)': xmlEscape(conclusao),
  }

  for (const [alvo, valor] of Object.entries(substituicoes)) {
    documentXml = documentXml.split(alvo).join(valor)
  }

  if (ocorrencia.tipo === 'Vistoria Ambiental') {
    const paragrafoCargo = '<w:p><w:pPr><w:keepNext w:val="false" /><w:keepLines w:val="false" /><w:pageBreakBefore w:val="false" /><w:widowControl w:val="true" /><w:pBdr></w:pBdr><w:spacing w:after="0" /><w:ind /><w:jc w:val="center" /><w:rPr><w:rFonts w:hint="default" w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" /><w:sz w:val="20" /><w:szCs w:val="20" /></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:hint="default" w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" /><w:sz w:val="20" /><w:szCs w:val="20" /></w:rPr><w:t>Analista Ambiental</w:t></w:r></w:p>'
    documentXml = documentXml.replace(
      /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?Engenheiro\(a\) Civil - (?:(?!<\/w:p>)[\s\S])*?<\/w:p>/,
      paragrafoCargo
    )
  } else {
    documentXml = substituirTextoDoParagrafo(
      documentXml,
      (texto) => texto.trimStart().startsWith('Engenheiro(a) Civil -')
        || texto.trimStart().startsWith('Engenheira Civil -'),
      ehAlexandre ? '' : 'Agente - Coordenadoria Municipal de Proteção e Defesa Civil',
    ).split('Analista Ambiental').join('Engenheira Civil - CODAP')
  }

  // O modelo pode conter nomes de exemplo em trechos que não são
  // identificados como parágrafos isolados. Eles nunca devem ser levados
  // para o arquivo salvo.
  documentXml = documentXml
    .split('Cristiane Caroline Campos Lopes').join('Nome')
    .split('Moisés Pinto dos Santos').join('Nome')
    .split('Talita Oliveira de Ara\u00FAjo').join('Nome')
    .split('Talita Oliveira de Araújo').join('Nome')

  documentXml = documentXml
    .replace(/[“”]/g, '')
    .replace(/,\s*Zona Rural de Olaria/g, '')
    .replace(/\s+Zona Rural de Olaria,\s*coordenadas/g, 'coordenadas')
    .replace(/,\s{2,}coordenadas/g, ', coordenadas')
    .replace(/ {2,}coordenadas/g, ' coordenadas')
    .replace(/\s*descreva a conclus.o\.?/gi, '')

  const relsFile = zip.file('word/_rels/document.xml.rels')
  if (!relsFile) throw new Error('Modelo de relatório inválido (rels ausente).')
  let relsXml = await relsFile.async('string')

  const contentTypesFile = zip.file('[Content_Types].xml')
  if (!contentTypesFile) throw new Error('Modelo de relatório inválido (Content_Types ausente).')
  let contentTypesXml = await contentTypesFile.async('string')

  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]))
  let proximoId = Math.max(0, ...ids) + 1

  const fotos = Array.isArray(ocorrencia.fotos) ? ocorrencia.fotos : []
  const descricoes = Array.isArray(ocorrencia.descricoes_fotos) ? ocorrencia.descricoes_fotos : []

  function adicionarImagem(imagem: ImagemDataUrl, numero: number): string {
    const rId = `rId${proximoId++}`
    const target = `media/relatorio_foto_${numero}.${imagem.extension}`
    zip.file(`word/${target}`, imagem.bytes)
    relsXml = relsXml.replace(
      '</Relationships>',
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}" /></Relationships>`
    )
    if (!contentTypesXml.includes(`Extension="${imagem.extension}"`)) {
      contentTypesXml = contentTypesXml.replace(
        '</Types>',
        `<Default Extension="${imagem.extension}" ContentType="${imagem.mime}"/></Types>`
      )
    }
    return rId
  }

  function captionFiguraXml(numero: number, descricao: string): string {
    const descRun = descricao
      ? `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${xmlEscape(descricao)}</w:t></w:r>`
      : ''
    return `<w:p><w:pPr><w:pStyle w:val="2024"/><w:pBdr></w:pBdr><w:spacing/><w:ind/><w:jc w:val="center"/><w:rPr><w:highlight w:val="none"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">Figura </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> SEQ Figura \\* Arabic </w:instrText><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve">${numero} </w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve">- </w:t></w:r>${descRun}</w:p>`
  }

  function cellFotoXml(content: string, width: number, gridSpan = 1): string {
    const span = gridSpan > 1 ? `<w:gridSpan w:val="${gridSpan}"/>` : ''
    return `<w:tc><w:tcPr><w:tcBorders><w:top w:val="none" w:color="000000" w:sz="4" w:space="0"/><w:left w:val="none" w:color="000000" w:sz="4" w:space="0"/><w:bottom w:val="none" w:color="000000" w:sz="4" w:space="0"/><w:right w:val="none" w:color="000000" w:sz="4" w:space="0"/></w:tcBorders>${span}<w:tcW w:w="${width}" w:type="dxa"/><w:textDirection w:val="lrTb"/><w:noWrap w:val="false"/></w:tcPr>${content}</w:tc>`
  }

  const imagensFotos: Array<{ imagem: ImagemDataUrl; numero: number; descricao: string }> = []
  for (const foto of fotos) {
    const imagem = await parseDataUrl(foto)
    if (!imagem) continue
    imagensFotos.push({
      imagem,
      numero: imagensFotos.length + 1,
      descricao: descricoes[imagensFotos.length] ?? '',
    })
  }

  const tabelaFotosRegex = /<w:tbl\b[\s\S]*?SEQ Figura[\s\S]*?<\/w:tbl>/
  const tabelaFotos = documentXml.match(tabelaFotosRegex)?.[0]
  if (tabelaFotos) {
    if (imagensFotos.length === 0) {
      documentXml = documentXml.replace(tabelaFotos, '')
    } else {
      const tabelaCabecalho = tabelaFotos.match(/^[\s\S]*?<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)?.[0]
      if (!tabelaCabecalho) throw new Error('Modelo de relatório inválido (tabela de fotos sem grade).')

      const linhasFotos: string[] = []
      for (let i = 0; i < imagensFotos.length; i += 2) {
        const primeira = imagensFotos[i]
        const primeiraRid = adicionarImagem(primeira.imagem, primeira.numero)
        const primeiraCelula = cellFotoXml(
          `${imageDrawingXml(primeiraRid, primeira.numero)}${captionFiguraXml(primeira.numero, primeira.descricao)}`,
          imagensFotos[i + 1] ? 4960 : 9921,
          imagensFotos[i + 1] ? 1 : 2,
        )
        let celulas = primeiraCelula
        if (imagensFotos[i + 1]) {
          const segunda = imagensFotos[i + 1]
          const segundaRid = adicionarImagem(segunda.imagem, segunda.numero)
          celulas += cellFotoXml(
            `${imageDrawingXml(segundaRid, segunda.numero)}${captionFiguraXml(segunda.numero, segunda.descricao)}`,
            4961,
          )
        }
        linhasFotos.push(`<w:tr><w:trPr><w:trHeight w:val="6052"/></w:trPr>${celulas}</w:tr>`)
      }
      documentXml = documentXml.replace(tabelaFotos, `${tabelaCabecalho}${linhasFotos.join('')}</w:tbl>`)
    }
  }

  documentXml = documentXml.replace(/<w:tc>([\s\S]*?)<\/w:tc>/g, (match, content: string) => {
    if (!content.includes('<w:drawing>')) return match
    const cleaned = content.replace(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, (para: string) => {
      const hasText = /<w:t[^>]*>[^<]/.test(para)
      const hasDrawing = para.includes('<w:drawing>')
      return (hasText || hasDrawing) ? para : ''
    })
    return `<w:tc>${cleaned}</w:tc>`
  })

  zip.file('word/document.xml', documentXml)
  zip.file('word/_rels/document.xml.rels', relsXml)
  zip.file('[Content_Types].xml', contentTypesXml)

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}
