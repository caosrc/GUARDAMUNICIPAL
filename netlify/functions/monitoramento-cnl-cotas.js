function resposta(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

function configurarSupabase() {
  const url = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const key = String(process.env.VITE_SUPABASE_ANON_KEY || '')
  if (!url || !key) throw new Error('Supabase não configurado')
  return { endpoint: `${url}/rest/v1/monitoramento_cnl_cotas`, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
}

function cotasValidas(body) {
  const cotas = { atencao: Number(body?.atencao), alerta: Number(body?.alerta), transbordamento: Number(body?.transbordamento) }
  return Object.values(cotas).every(value => Number.isFinite(value) && value >= 0 && value <= 100) &&
    cotas.atencao < cotas.alerta && cotas.alerta < cotas.transbordamento ? cotas : null
}

export const handler = async event => {
  try {
    const supabase = configurarSupabase()
    if (event.httpMethod === 'PUT') {
      const cotas = cotasValidas(JSON.parse(event.body || '{}'))
      if (!cotas) return resposta(400, { sucesso: false, erro: 'Informe cotas numéricas em ordem crescente.' })
      const response = await fetch(`${supabase.endpoint}?on_conflict=id`, {
        method: 'POST',
        headers: { ...supabase.headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ id: 1, ...cotas, updated_at: new Date().toISOString() }),
      })
      if (!response.ok) {
        const detalhe = await response.text()
        throw new Error(`Supabase ${response.status}: ${detalhe.slice(0, 500)}`)
      }
      const rows = await response.json()
      const salvo = Array.isArray(rows) ? rows[0] : null
      if (!salvo) throw new Error('Supabase não retornou a cota gravada.')
      return resposta(200, {
        sucesso: true,
        cotas: {
          atencao: Number(salvo.atencao),
          alerta: Number(salvo.alerta),
          transbordamento: Number(salvo.transbordamento),
        },
      })
    }
    const response = await fetch(`${supabase.endpoint}?id=eq.1&select=atencao,alerta,transbordamento`, { headers: supabase.headers })
    if (!response.ok) throw new Error(`Supabase: ${response.status}`)
    const rows = await response.json()
    return resposta(200, { sucesso: true, cotas: rows[0] || null })
  } catch (error) {
    if (event.httpMethod === 'PUT') {
      console.error('[Monitoramento CNL] Falha ao salvar cotas:', error?.message || error)
      return resposta(500, {
        sucesso: false,
        erro: 'Não foi possível salvar as cotas. Verifique a configuração e as permissões da tabela monitoramento_cnl_cotas no Supabase.',
      })
    }
    return resposta(200, { sucesso: true, cotas: null, aviso: error?.message })
  }
}