import { useMemo, useState } from 'react'
import type { Ocorrencia } from '../types'
import { NATUREZA_COR, NATUREZA_ICONE } from '../types'

interface Props {
  ocorrencias: Ocorrencia[]
}

function extrairBairro(endereco: string | null): string {
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

function Donut({
  segmentos,
  tamanho = 150,
  espessura = 26,
  centro,
}: {
  segmentos: { label: string; valor: number; cor: string }[]
  tamanho?: number
  espessura?: number
  centro?: { num: number; rotulo: string }
}) {
  const total = segmentos.reduce((s, x) => s + x.valor, 0) || 1
  const r = (tamanho - espessura) / 2
  const cx = tamanho / 2
  const cy = tamanho / 2
  const circ = 2 * Math.PI * r
  let acumulado = 0

  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={espessura} />
      {segmentos.map((s, i) => {
        const frac = s.valor / total
        if (frac === 0) return null
        const dash = frac * circ
        const offset = -acumulado * circ
        acumulado += frac
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.cor}
            strokeWidth={espessura}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
          />
        )
      })}
      {centro && (
        <>
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={tamanho * 0.22} fontWeight="700" fill="#0f172a">
            {centro.num}
          </text>
          <text x={cx} y={cy + tamanho * 0.14} textAnchor="middle" fontSize={tamanho * 0.085} fill="#64748b" fontWeight="600">
            {centro.rotulo}
          </text>
        </>
      )}
    </svg>
  )
}

function BarrasHorizontais({
  itens,
  cor = '#2563eb',
}: {
  itens: { label: string; valor: number; icone?: string; cor?: string }[]
  cor?: string
}) {
  const max = Math.max(...itens.map(i => i.valor), 1)
  const total = itens.reduce((s, i) => s + i.valor, 0) || 1
  return (
    <div className="dash-bars">
      {itens.map((it, i) => {
        const pct = (it.valor / max) * 100
        const pctTotal = (it.valor / total) * 100
        return (
          <div key={i} className="dash-bar-row">
            <div className="dash-bar-label">
              {it.icone && <span className="dash-bar-icone">{it.icone}</span>}
              <span className="dash-bar-text">{it.label}</span>
            </div>
            <div className="dash-bar-track">
              <div className="dash-bar-fill" style={{ width: `${pct}%`, background: it.cor ?? cor }} />
              <span className="dash-bar-valor">{it.valor} <span className="dash-bar-pct">({pctTotal.toFixed(1)}%)</span></span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MiniSparkBars({ valores, cor = '#2563eb' }: { valores: { dia: string; n: number }[]; cor?: string }) {
  const max = Math.max(...valores.map(v => v.n), 1)
  return (
    <div className="dash-spark">
      {valores.map((v, i) => (
        <div key={i} className="dash-spark-col" title={`${v.dia}: ${v.n}`}>
          <div className="dash-spark-bar" style={{ height: `${(v.n / max) * 100}%`, background: cor }} />
          <span className="dash-spark-lbl">{v.dia}</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard({ ocorrencias }: Props) {
  const [aberto, setAberto] = useState(false)

  const stats = useMemo(() => {
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

    return { total, porNivel, porStatus, bairros, naturezas, dias }
  }, [ocorrencias])

  const pctResolvido = stats.porStatus.ativo + stats.porStatus.resolvido > 0
    ? (stats.porStatus.resolvido / (stats.porStatus.ativo + stats.porStatus.resolvido)) * 100
    : 0

  return (
    <div className="dashboard-box">
      <button className="dashboard-toggle" onClick={() => setAberto(v => !v)}>
        <span>📊 Dashboard de Ocorrências</span>
        <span className="dashboard-toggle-meta">
          {stats.total} no total · {pctResolvido.toFixed(0)}% resolvidas
        </span>
        <span className={`dashboard-toggle-seta ${aberto ? 'aberto' : ''}`}>▾</span>
      </button>

      {aberto && (
        <div className="dashboard-conteudo">
          <div className="dashboard-grid">
            <div className="dashboard-card">
              <div className="dashboard-card-titulo">Por nível de risco</div>
              <div className="dashboard-donut-wrap">
                <Donut
                  segmentos={[
                    { label: 'Alto', valor: stats.porNivel.alto, cor: '#dc2626' },
                    { label: 'Médio', valor: stats.porNivel.medio, cor: '#f59e0b' },
                    { label: 'Baixo', valor: stats.porNivel.baixo, cor: '#16a34a' },
                  ]}
                  centro={{ num: stats.total, rotulo: 'ocorrências' }}
                />
                <div className="dashboard-legenda">
                  {[
                    { l: 'Alto', n: stats.porNivel.alto, c: '#dc2626' },
                    { l: 'Médio', n: stats.porNivel.medio, c: '#f59e0b' },
                    { l: 'Baixo', n: stats.porNivel.baixo, c: '#16a34a' },
                  ].map(s => {
                    const pct = stats.total > 0 ? (s.n / stats.total) * 100 : 0
                    return (
                      <div key={s.l} className="dashboard-legenda-item">
                        <span className="dashboard-legenda-bola" style={{ background: s.c }} />
                        <span className="dashboard-legenda-lbl">{s.l}</span>
                        <span className="dashboard-legenda-val">{s.n} <span className="dashboard-legenda-pct">({pct.toFixed(1)}%)</span></span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="dashboard-card">
              <div className="dashboard-card-titulo">Status</div>
              <div className="dashboard-donut-wrap">
                <Donut
                  segmentos={[
                    { label: 'Ativo', valor: stats.porStatus.ativo, cor: '#ef4444' },
                    { label: 'Resolvido', valor: stats.porStatus.resolvido, cor: '#10b981' },
                  ]}
                  centro={{ num: Math.round(pctResolvido), rotulo: '% resolvidas' }}
                />
                <div className="dashboard-legenda">
                  {[
                    { l: '🔴 Ativos', n: stats.porStatus.ativo, c: '#ef4444' },
                    { l: '✅ Resolvidos', n: stats.porStatus.resolvido, c: '#10b981' },
                  ].map(s => {
                    const tot = stats.porStatus.ativo + stats.porStatus.resolvido
                    const pct = tot > 0 ? (s.n / tot) * 100 : 0
                    return (
                      <div key={s.l} className="dashboard-legenda-item">
                        <span className="dashboard-legenda-bola" style={{ background: s.c }} />
                        <span className="dashboard-legenda-lbl">{s.l}</span>
                        <span className="dashboard-legenda-val">{s.n} <span className="dashboard-legenda-pct">({pct.toFixed(1)}%)</span></span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="dashboard-card dashboard-card-largo">
              <div className="dashboard-card-titulo">🏘️ Top bairros com mais ocorrências</div>
              {stats.bairros.length === 0 ? (
                <div className="dashboard-vazio">Sem dados de endereço.</div>
              ) : (
                <BarrasHorizontais itens={stats.bairros} cor="#2563eb" />
              )}
            </div>

            <div className="dashboard-card dashboard-card-largo">
              <div className="dashboard-card-titulo">📋 Naturezas mais frequentes</div>
              {stats.naturezas.length === 0 ? (
                <div className="dashboard-vazio">Sem ocorrências.</div>
              ) : (
                <BarrasHorizontais itens={stats.naturezas} />
              )}
            </div>

            <div className="dashboard-card dashboard-card-largo">
              <div className="dashboard-card-titulo">📈 Últimos 14 dias</div>
              <MiniSparkBars valores={stats.dias} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
