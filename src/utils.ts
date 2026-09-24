export function parseDateLocal(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

export function decimalParaGms(valor: number, positivo: string, negativo: string): string {
  const absoluto = Math.abs(valor)
  const graus = Math.floor(absoluto)
  const minutosFloat = (absoluto - graus) * 60
  const minutos = Math.floor(minutosFloat)
  const segundos = ((minutosFloat - minutos) * 60).toFixed(2).replace('.', ',')
  const direcao = valor >= 0 ? positivo : negativo
  return `${graus}° ${minutos}' ${segundos}" ${direcao}`
}

export function formatarCoordenadas(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return 'Sem GPS'
  return `${decimalParaGms(lat, 'N', 'S')}  ${decimalParaGms(lng, 'L', 'O')}`
}

export async function gpsBloqueadoNoNavegador(): Promise<boolean> {
  try {
    const permissions = (navigator as any).permissions
    if (!permissions?.query) return false
    const status = await permissions.query({ name: 'geolocation' })
    return status.state === 'denied'
  } catch {
    return false
  }
}

export function mensagemErroGps(err?: GeolocationPositionError | null): string {
  if (err?.code === 1) {
    return 'Permissão de GPS negada. Para permitir, libere Localização nas permissões deste site/app e toque no botão GPS novamente.'
  }
  if (err?.code === 2) {
    return 'GPS indisponível no momento. Verifique se a localização do celular está ligada e tente novamente.'
  }
  if (err?.code === 3) {
    return 'Tempo esgotado ao obter GPS. Toque novamente para tentar de novo.'
  }
  return 'Não foi possível obter GPS. Toque novamente para tentar ou informe o endereço.'
}

function gmsCompacto(valor: number, positivo: string, negativo: string): string {
  const absoluto = Math.abs(valor)
  const graus = Math.floor(absoluto)
  const minutosFloat = (absoluto - graus) * 60
  const minutos = Math.floor(minutosFloat)
  const segundos = Math.round((minutosFloat - minutos) * 60)
  const direcao = valor >= 0 ? positivo : negativo
  return `${graus}°${minutos}'${segundos}"${direcao}`
}

async function obterGpsAtual(): Promise<{ lat: number; lng: number } | null> {
  if (!navigator.geolocation) return null
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 30000 }
    )
  })
}

const MESES_ABR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export async function adicionarMarcaDagua(
  dataUrl: string,
  lat?: number | null,
  lng?: number | null,
  maxWidth = 1280,
  qualidade = 0.70,
  comMarca = true,
): Promise<string> {
  let useLat = lat ?? null
  let useLng = lng ?? null

  if (comMarca && (useLat == null || useLng == null)) {
    const gps = await obterGpsAtual()
    if (gps) { useLat = gps.lat; useLng = gps.lng }
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let drawW = img.width
      let drawH = img.height
      if (drawW > maxWidth) {
        drawH = Math.round(drawH * maxWidth / drawW)
        drawW = maxWidth
      }
      const canvas = document.createElement('canvas')
      canvas.width = drawW
      canvas.height = drawH
      const ctx = canvas.getContext('2d')!

      ctx.drawImage(img, 0, 0, drawW, drawH)

      if (comMarca) {
        const agora = new Date()
        const dia = agora.getDate().toString().padStart(2, '0')
        const mes = MESES_ABR[agora.getMonth()]
        const ano = agora.getFullYear()
        const hora = agora.toTimeString().slice(0, 8)
        const dataHora = `${dia} de ${mes}. de ${ano} ${hora}`

        const linhas: string[] = [dataHora]
        if (useLat != null && useLng != null) {
          linhas.push(`${gmsCompacto(useLat, 'N', 'S')} ${gmsCompacto(useLng, 'L', 'O')}`)
        }
        linhas.push('Defesa Civil - Conselheiro Lafaiete')

        const fontSize = Math.max(14, Math.round(drawW * 0.022))
        const lineHeight = fontSize * 1.45
        const margem = Math.round(drawW * 0.022)

        ctx.font = `bold ${fontSize}px Arial, sans-serif`
        ctx.textAlign = 'right'
        ctx.shadowColor = 'rgba(0,0,0,1)'
        ctx.shadowBlur = 8
        ctx.shadowOffsetX = 1
        ctx.shadowOffsetY = 1
        ctx.fillStyle = '#ffffff'

        const baseY = drawH - margem - (linhas.length - 1) * lineHeight
        const baseX = drawW - margem

        linhas.forEach((linha, i) => {
          ctx.fillText(linha, baseX, baseY + i * lineHeight)
        })
      }

      const webp = canvas.toDataURL('image/webp', qualidade)
      const result = webp.startsWith('data:image/webp')
        ? webp
        : canvas.toDataURL('image/jpeg', qualidade)
      canvas.width = 0; canvas.height = 0
      resolve(result)
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/**
 * Redimensiona uma imagem para armazenamento e codifica novas fotos em WebP.
 * Imagens antigas ou navegadores sem suporte a WebP continuam funcionando.
 */
export function converterParaWebp(
  dataUrl: string,
  maxW = 1280,
  maxH = 1280,
  qualidade = 0.82,
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:')) return Promise.resolve(dataUrl)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let width = img.width
      let height = img.height
      const escala = Math.min(1, maxW / width, maxH / height)
      if (escala < 1) {
        width = Math.max(1, Math.round(width * escala))
        height = Math.max(1, Math.round(height * escala))
      }
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return }
        ctx.drawImage(img, 0, 0, width, height)
        const webp = canvas.toDataURL('image/webp', qualidade)
        canvas.width = 0
        canvas.height = 0
        resolve(webp.startsWith('data:image/webp') ? webp : dataUrl)
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

// Formatos de documentos como DOCX/ExcelJS não aceitam WebP em todos os
// leitores. A conversão acontece apenas na exportação; o Supabase mantém WebP.
export function converterParaJpeg(dataUrl: string, qualidade = 0.88): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/webp')) return Promise.resolve(dataUrl)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return }
        ctx.drawImage(img, 0, 0)
        const jpeg = canvas.toDataURL('image/jpeg', qualidade)
        canvas.width = 0
        canvas.height = 0
        resolve(jpeg)
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

// Salva a foto (base64) como arquivo no celular/dispositivo disparando um download.
// Só chamar para fotos capturadas pela câmera — fotos da galeria já estão no celular.
export async function salvarFotoNoDispositivo(dataUrl: string, prefixo = 'DefesaCivil-OB'): Promise<void> {
  try {
    const agora = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const ts = `${agora.getFullYear()}${pad(agora.getMonth() + 1)}${pad(agora.getDate())}-${pad(agora.getHours())}${pad(agora.getMinutes())}${pad(agora.getSeconds())}`
    const nomeArquivo = `${prefixo}-${ts}.webp`
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = nomeArquivo
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 3000)
  } catch {
    // Nunca bloquear o fluxo principal se o save falhar
  }
}
