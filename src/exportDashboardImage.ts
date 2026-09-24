// Renderiza o painel de ocorrências como imagem PNG (base64) para incorporar
// no Excel como Dashboard visual. Mantém o mesmo "look & feel" do componente
// Dashboard.tsx do app: cards de KPI, donuts, barras horizontais e sparkbars.

import type { Ocorrencia } from './types'
import { NATUREZA_COR, NATUREZA_ICONE } from './types'

// ── Helpers de extração ──────────────────────────────────────────
function extrairBairro(endereco: string | null | undefined): string {
  if (!endereco) return 'Não informado'
  let s = endereco.trim()
  s = s.replace(/,?\s*Conselheiro Lafaiete.*$/i, '')
  s = s.replace(/\s*-\s*MG.*$/i, '')
  s = s.replace(/\s*\d{5}-?\d{3}.*$/, '')
  if (s.includes(' - ')) {
    const partes = s.split(' - ').map(p => p.trim()).filter(Boolean)
    if (partes.length >= 2) return capitalizar(partes[partes.length - 1])
  }
  if (s.includes(',')) {
    const partes = s.split(',').map(p => p.trim()).filter(Boolean)
    if (partes.length >= 2) {
      const ultimo = partes[partes.length - 1]
      if (!/^\d+$/.test(ultimo)) return capitalizar(ultimo)
      if (partes.length >= 3) return capitalizar(partes[partes.length - 2])
    }
  }
  return capitalizar(s) || 'Não informado'
}

function capitalizar(t: string): string {
  return t.toLowerCase().replace(/\b\p{L}/gu, l => l.toUpperCase()).slice(0, 32)
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ── Computa as estatísticas (mesmo cálculo do Dashboard.tsx) ──────
interface DashStats {
  total: number
  porNivel: { alto: number; medio: number; baixo: number }
  porStatus: { ativo: number; resolvido: number }
  bairros: { label: string; valor: number }[]
  naturezas: { label: string; valor: number; icone: string; cor: string }[]
  dias: { dia: string; n: number; iso: string }[]
  pctResolvido: number
}

function calcularStats(ocorrencias: Ocorrencia[]): DashStats {
  const total = ocorrencias.length
  const porNivel = {
    alto: ocorrencias.filter(o => o.nivel_risco === 'alto').length,
    medio: ocorrencias.filter(o => o.nivel_risco === 'medio').length,
    baixo: ocorrencias.filter(o => o.nivel_risco === 'baixo').length,
  }
  const porStatus = {
    ativo: ocorrencias.filter(o => o.status_oc === 'ativo').length,
    resolvido: ocorrencias.filter(o => o.status_oc === 'resolvido').length,
  }

  const bairroMap = new Map<string, number>()
  for (const o of ocorrencias) {
    const b = extrairBairro(o.endereco)
    bairroMap.set(b, (bairroMap.get(b) ?? 0) + 1)
  }
  const bairros = [...bairroMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, valor]) => ({ label, valor }))

  const natMap = new Map<string, number>()
  for (const o of ocorrencias) {
    natMap.set(o.natureza, (natMap.get(o.natureza) ?? 0) + 1)
  }
  const naturezas = [...natMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, valor]) => ({
      label,
      valor,
      icone: NATUREZA_ICONE[label] ?? '📋',
      cor: NATUREZA_COR[label] ?? '#2563eb',
    }))

  const hoje = new Date()
  const dias: { dia: string; n: number; iso: string }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(hoje)
    d.setDate(d.getDate() - i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    dias.push({ iso, dia: String(d.getDate()).padStart(2, '0'), n: 0 })
  }
  const idx = new Map(dias.map((d, i) => [d.iso, i]))
  for (const o of ocorrencias) {
    const dt = new Date(o.created_at)
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const i = idx.get(iso)
    if (i !== undefined) dias[i].n++
  }

  const pctResolvido = porStatus.ativo + porStatus.resolvido > 0
    ? (porStatus.resolvido / (porStatus.ativo + porStatus.resolvido)) * 100
    : 0

  return { total, porNivel, porStatus, bairros, naturezas, dias, pctResolvido }
}

// ── Componentes SVG ──────────────────────────────────────────────
function svgDonut(
  cx: number, cy: number, raio: number, espessura: number,
  segmentos: { valor: number; cor: string }[],
  centroNum: string | number, centroLbl: string,
): string {
  const total = segmentos.reduce((s, x) => s + x.valor, 0) || 1
  const circ = 2 * Math.PI * raio
  let acumulado = 0
  const arcs = segmentos.map((s) => {
    const frac = s.valor / total
    if (frac === 0) return ''
    const dash = frac * circ
    const offset = -acumulado * circ
    acumulado += frac
    return `<circle cx="${cx}" cy="${cy}" r="${raio}" fill="none"
      stroke="${s.cor}" stroke-width="${espessura}"
      stroke-dasharray="${dash} ${circ - dash}"
      stroke-dashoffset="${offset}"
      transform="rotate(-90 ${cx} ${cy})"
      stroke-linecap="butt"/>`
  }).join('')
  return `
    <circle cx="${cx}" cy="${cy}" r="${raio}" fill="none" stroke="#f1f5f9" stroke-width="${espessura}"/>
    ${arcs}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="${raio * 0.55}" font-weight="800" fill="#0f172a"
      font-family="Segoe UI, Arial, sans-serif">${escapeXml(String(centroNum))}</text>
    <text x="${cx}" y="${cy + raio * 0.42}" text-anchor="middle" font-size="${raio * 0.20}" fill="#64748b" font-weight="600"
      font-family="Segoe UI, Arial, sans-serif">${escapeXml(centroLbl)}</text>
  `
}

function svgLegenda(
  x: number, y: number, larg: number, alturaItem: number,
  itens: { lbl: string; n: number; c: string; pct: number }[],
): string {
  return itens.map((it, i) => {
    const yi = y + i * alturaItem
    return `
      <circle cx="${x + 8}" cy="${yi + alturaItem / 2}" r="6" fill="${it.c}"/>
      <text x="${x + 24}" y="${yi + alturaItem / 2 + 5}" font-size="14" fill="#334155" font-weight="600"
        font-family="Segoe UI, Arial, sans-serif">${escapeXml(it.lbl)}</text>
      <text x="${x + larg - 6}" y="${yi + alturaItem / 2 + 5}" font-size="14" fill="#0f172a" font-weight="700" text-anchor="end"
        font-family="Segoe UI, Arial, sans-serif">${it.n}<tspan fill="#94a3b8" font-weight="500" font-size="12"> (${it.pct.toFixed(1)}%)</tspan></text>
    `
  }).join('')
}

function svgKpiCard(
  x: number, y: number, w: number, h: number,
  rotulo: string, valor: string | number, subtitulo: string,
  cor: string,
): string {
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="white" stroke="#e2e8f0" stroke-width="1"/>
      <rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${cor}"/>
      <text x="${x + 22}" y="${y + 32}" font-size="14" fill="#64748b" font-weight="700" letter-spacing="1"
        font-family="Segoe UI, Arial, sans-serif">${escapeXml(rotulo.toUpperCase())}</text>
      <text x="${x + 22}" y="${y + 84}" font-size="48" fill="${cor}" font-weight="800"
        font-family="Segoe UI, Arial, sans-serif">${escapeXml(String(valor))}</text>
      <text x="${x + 22}" y="${y + 112}" font-size="13" fill="#94a3b8" font-weight="500"
        font-family="Segoe UI, Arial, sans-serif">${escapeXml(subtitulo)}</text>
    </g>
  `
}

function svgBarrasHorizontais(
  x: number, y: number, w: number, h: number,
  titulo: string,
  itens: { label: string; valor: number; icone?: string; cor?: string }[],
  corPadrao: string,
  vazioMsg: string,
): string {
  const max = Math.max(...itens.map(i => i.valor), 1)
  const total = itens.reduce((s, i) => s + i.valor, 0) || 1

  let conteudo = ''
  if (itens.length === 0) {
    conteudo = `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" font-size="14" fill="#94a3b8"
      font-family="Segoe UI, Arial, sans-serif">${escapeXml(vazioMsg)}</text>`
  } else {
    const barH = 26
    const rowH = barH + 14
    const padTop = 56
    const labelLarg = 220
    const trackX = x + 24 + labelLarg + 12
    const trackLarg = w - (24 + labelLarg + 12) - 110 // 110 reservados para o número à direita

    conteudo = itens.map((it, i) => {
      const ry = y + padTop + i * rowH
      const cor = it.cor ?? corPadrao
      const pct = (it.valor / max)
      const fillW = Math.max(4, trackLarg * pct)
      const pctTotal = (it.valor / total) * 100
      const labelTexto = it.icone ? `${it.icone}  ${it.label}` : it.label
      return `
        <text x="${x + 24}" y="${ry + barH / 2 + 5}" font-size="13" fill="#1e293b" font-weight="600"
          font-family="Segoe UI, Arial, sans-serif">${escapeXml(labelTexto.length > 30 ? labelTexto.slice(0, 30) + '…' : labelTexto)}</text>
        <rect x="${trackX}" y="${ry}" width="${trackLarg}" height="${barH}" rx="6" fill="#f1f5f9"/>
        <rect x="${trackX}" y="${ry}" width="${fillW}" height="${barH}" rx="6" fill="${cor}"/>
        <text x="${trackX + trackLarg + 14}" y="${ry + barH / 2 + 5}" font-size="14" fill="#0f172a" font-weight="700"
          font-family="Segoe UI, Arial, sans-serif">${it.valor}<tspan fill="#94a3b8" font-weight="500" font-size="12"> (${pctTotal.toFixed(1)}%)</tspan></text>
      `
    }).join('')
  }

  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="white" stroke="#e2e8f0" stroke-width="1"/>
      <text x="${x + 24}" y="${y + 32}" font-size="16" fill="#0f172a" font-weight="700"
        font-family="Segoe UI, Arial, sans-serif">${escapeXml(titulo)}</text>
      ${conteudo}
    </g>
  `
}

function svgSparkBars(
  x: number, y: number, w: number, h: number,
  titulo: string,
  valores: { dia: string; n: number }[],
  cor: string,
): string {
  const max = Math.max(...valores.map(v => v.n), 1)
  const padTop = 52
  const padBot = 40
  const padLado = 28
  const innerW = w - padLado * 2
  const innerH = h - padTop - padBot
  const colW = innerW / valores.length
  const barW = colW * 0.62
  const baseY = y + padTop + innerH

  const colunas = valores.map((v, i) => {
    const xb = x + padLado + colW * i + (colW - barW) / 2
    const altura = (v.n / max) * innerH
    const yb = baseY - altura
    const valorTxt = v.n > 0
      ? `<text x="${xb + barW / 2}" y="${yb - 6}" text-anchor="middle" font-size="11" fill="#0f172a" font-weight="700"
          font-family="Segoe UI, Arial, sans-serif">${v.n}</text>` : ''
    return `
      <rect x="${xb}" y="${yb}" width="${barW}" height="${Math.max(2, altura)}" rx="3"
        fill="${v.n > 0 ? cor : '#e2e8f0'}"/>
      ${valorTxt}
      <text x="${xb + barW / 2}" y="${baseY + 18}" text-anchor="middle" font-size="11" fill="#94a3b8"
        font-family="Segoe UI, Arial, sans-serif">${v.dia}</text>
    `
  }).join('')

  const total = valores.reduce((s, v) => s + v.n, 0)
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="white" stroke="#e2e8f0" stroke-width="1"/>
      <text x="${x + 24}" y="${y + 32}" font-size="16" fill="#0f172a" font-weight="700"
        font-family="Segoe UI, Arial, sans-serif">${escapeXml(titulo)}</text>
      <text x="${x + w - 24}" y="${y + 32}" text-anchor="end" font-size="13" fill="#64748b" font-weight="600"
        font-family="Segoe UI, Arial, sans-serif">${total} no período</text>
      <line x1="${x + padLado}" y1="${baseY}" x2="${x + w - padLado}" y2="${baseY}" stroke="#e2e8f0" stroke-width="1"/>
      ${colunas}
    </g>
  `
}

// ── Geração principal ────────────────────────────────────────────
function montarSvg(stats: DashStats): { svg: string; w: number; h: number } {
  const W = 1400
  // Layout com altura fixa, simétrica e enxuta:
  //  H 0–100      Cabeçalho azul
  //  120–268      4 KPIs (148px)
  //  288–548      2 donuts (260px)
  //  568–928      Top bairros (360px)
  //  948–1308     Naturezas mais frequentes (360px)
  //  1328–1568    Últimos 14 dias (240px)
  //  1568–1620    Rodapé
  const H = 1620

  const dataGer = new Date().toLocaleDateString('pt-BR')

  // Cabeçalho
  const header = `
    <rect x="0" y="0" width="${W}" height="100" fill="#1a4b8c"/>
    <rect x="0" y="100" width="${W}" height="3" fill="#E05F00"/>
    <text x="40" y="48" font-size="26" fill="white" font-weight="800"
      font-family="Segoe UI, Arial, sans-serif">📊 Painel de Ocorrências</text>
    <text x="40" y="78" font-size="14" fill="#bfdbfe" font-weight="500"
      font-family="Segoe UI, Arial, sans-serif">CODAP — Conselheiro Lafaiete, MG  ·  ${stats.total} ocorrências analisadas</text>
    <text x="${W - 40}" y="48" text-anchor="end" font-size="13" fill="#dbeafe" font-weight="600"
      font-family="Segoe UI, Arial, sans-serif">Gerado em ${dataGer}</text>
    <text x="${W - 40}" y="78" text-anchor="end" font-size="12" fill="#93c5fd"
      font-family="Segoe UI, Arial, sans-serif">Visualização similar ao painel do app</text>
  `

  // KPIs — 4 cards
  const kpiY = 120
  const kpiH = 148
  const margem = 32
  const gap = 20
  const kpiW = (W - margem * 2 - gap * 3) / 4

  const ativasPct = stats.total > 0 ? (stats.porStatus.ativo / stats.total) * 100 : 0
  const resolvidasPct = stats.total > 0 ? (stats.porStatus.resolvido / stats.total) * 100 : 0
  const altoPct = stats.total > 0 ? (stats.porNivel.alto / stats.total) * 100 : 0

  const kpis =
    svgKpiCard(margem, kpiY, kpiW, kpiH, 'Total', stats.total, 'ocorrências registradas', '#1a4b8c') +
    svgKpiCard(margem + (kpiW + gap), kpiY, kpiW, kpiH, 'Ativas', stats.porStatus.ativo, `${ativasPct.toFixed(1)}% em aberto`, '#dc2626') +
    svgKpiCard(margem + (kpiW + gap) * 2, kpiY, kpiW, kpiH, 'Resolvidas', stats.porStatus.resolvido, `${resolvidasPct.toFixed(1)}% concluídas`, '#16a34a') +
    svgKpiCard(margem + (kpiW + gap) * 3, kpiY, kpiW, kpiH, 'Alto Risco', stats.porNivel.alto, `${altoPct.toFixed(1)}% críticas`, '#E05F00')

  // Donuts — 2 cards (Nível, Status)
  const donutY = 288
  const donutH = 260
  const donutW = (W - margem * 2 - gap) / 2

  const totalNivel = stats.porNivel.alto + stats.porNivel.medio + stats.porNivel.baixo || 1
  const totalStatus = stats.porStatus.ativo + stats.porStatus.resolvido || 1

  const donut1 = (() => {
    const x = margem
    const cx = x + 130
    const cy = donutY + donutH / 2 + 12
    return `
      <g>
        <rect x="${x}" y="${donutY}" width="${donutW}" height="${donutH}" rx="14" fill="white" stroke="#e2e8f0"/>
        <text x="${x + 24}" y="${donutY + 32}" font-size="16" fill="#0f172a" font-weight="700"
          font-family="Segoe UI, Arial, sans-serif">Por nível de risco</text>
        ${svgDonut(cx, cy, 80, 26, [
          { valor: stats.porNivel.alto, cor: '#dc2626' },
          { valor: stats.porNivel.medio, cor: '#f59e0b' },
          { valor: stats.porNivel.baixo, cor: '#16a34a' },
        ], stats.total, 'ocorrências')}
        ${svgLegenda(x + 260, donutY + 70, donutW - 280, 38, [
          { lbl: '🔴 Alto', n: stats.porNivel.alto, c: '#dc2626', pct: (stats.porNivel.alto / totalNivel) * 100 },
          { lbl: '🟡 Médio', n: stats.porNivel.medio, c: '#f59e0b', pct: (stats.porNivel.medio / totalNivel) * 100 },
          { lbl: '🟢 Baixo', n: stats.porNivel.baixo, c: '#16a34a', pct: (stats.porNivel.baixo / totalNivel) * 100 },
        ])}
      </g>
    `
  })()

  const donut2 = (() => {
    const x = margem + donutW + gap
    const cx = x + 130
    const cy = donutY + donutH / 2 + 12
    return `
      <g>
        <rect x="${x}" y="${donutY}" width="${donutW}" height="${donutH}" rx="14" fill="white" stroke="#e2e8f0"/>
        <text x="${x + 24}" y="${donutY + 32}" font-size="16" fill="#0f172a" font-weight="700"
          font-family="Segoe UI, Arial, sans-serif">Status</text>
        ${svgDonut(cx, cy, 80, 26, [
          { valor: stats.porStatus.ativo, cor: '#ef4444' },
          { valor: stats.porStatus.resolvido, cor: '#10b981' },
        ], `${Math.round(stats.pctResolvido)}%`, 'resolvidas')}
        ${svgLegenda(x + 260, donutY + 88, donutW - 280, 42, [
          { lbl: '🔴 Ativos', n: stats.porStatus.ativo, c: '#ef4444', pct: (stats.porStatus.ativo / totalStatus) * 100 },
          { lbl: '✅ Resolvidos', n: stats.porStatus.resolvido, c: '#10b981', pct: (stats.porStatus.resolvido / totalStatus) * 100 },
        ])}
      </g>
    `
  })()

  // Bairros
  const bairros = svgBarrasHorizontais(
    margem, 568, W - margem * 2, 360,
    '🏘️  Top bairros com mais ocorrências',
    stats.bairros, '#2563eb',
    'Sem dados de endereço',
  )

  // Naturezas
  const naturezas = svgBarrasHorizontais(
    margem, 948, W - margem * 2, 360,
    '📋  Naturezas mais frequentes',
    stats.naturezas, '#7c3aed',
    'Sem ocorrências',
  )

  // Últimos 14 dias
  const spark = svgSparkBars(
    margem, 1328, W - margem * 2, 240,
    '📈  Últimos 14 dias',
    stats.dias, '#1a4b8c',
  )

  // Rodapé
  const footer = `
    <text x="${W / 2}" y="${H - 18}" text-anchor="middle" font-size="11" fill="#94a3b8"
      font-family="Segoe UI, Arial, sans-serif">CODAP — Conselheiro Lafaiete, MG  ·  Relatório automático gerado em ${dataGer}</text>
  `

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#f8fafc"/>
  ${header}
  ${kpis}
  ${donut1}
  ${donut2}
  ${bairros}
  ${naturezas}
  ${spark}
  ${footer}
</svg>`

  return { svg, w: W, h: H }
}

// ── SVG → PNG (via canvas do navegador) ──────────────────────────
async function svgParaPngBase64(svg: string, w: number, h: number, escala = 1.5): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Falha ao carregar SVG'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * escala)
    canvas.height = Math.round(h * escala)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D indisponível')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    return dataUrl.split(',')[1] ?? ''
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface DashboardImagem {
  base64: string
  largura: number
  altura: number
}

// API pública: gera o PNG base64 do painel (sem o prefixo data:)
export async function gerarDashboardImagem(ocorrencias: Ocorrencia[]): Promise<DashboardImagem> {
  const stats = calcularStats(ocorrencias)
  const { svg, w, h } = montarSvg(stats)
  const escala = 1.5
  const base64 = await svgParaPngBase64(svg, w, h, escala)
  return { base64, largura: Math.round(w * escala), altura: Math.round(h * escala) }
}
