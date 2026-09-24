import express from 'express'
import cors from 'cors'
import compression from 'compression'
import pg from 'pg'
import JSZip from 'jszip'
import webpush from 'web-push'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { createServer } from 'http'
import WebSocket, { WebSocketServer } from 'ws'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { handler as planetFocosHandler } from '../netlify/functions/planet-focos.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const execFileAsync = promisify(execFile)
const pythonBin = process.env.PYTHON_BIN
  || (existsSync(join(__dirname, '..', '.pythonlibs', 'bin', 'python'))
    ? join(__dirname, '..', '.pythonlibs', 'bin', 'python')
    : 'python3')

// ── PostgreSQL local do Replit ─────────────────────────────────────────────
// O banco do app original no Supabase não é compartilhado com esta cópia.
const dbUrl = process.env.DATABASE_URL
console.log('🗄️  Banco: Replit PostgreSQL')
const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: false,
})

async function query(sql, params = []) {
  const client = await pool.connect()
  try {
    const result = await client.query(sql, params)
    return result
  } finally {
    client.release()
  }
}

const app = express()
const httpServer = createServer(app)

app.use(compression())
app.use(cors({
  origin: true,
  credentials: true,
}))
app.use(express.json({ limit: '100mb' }))

// ── VAPID (Web Push) ──
// Strip any base64 padding (=) that web-push does not accept
function stripBase64Padding(key) {
  return (key || '').replace(/=+$/, '')
}
const VAPID_PUBLIC_KEY = stripBase64Padding(process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || '')
const VAPID_PRIVATE_KEY = stripBase64Padding(process.env.VAPID_PRIVATE_KEY || '')
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:defesacivilob@gmail.com'
let vapidConfigured = false
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    vapidConfigured = true
    console.log('[VAPID] configurado com sucesso')
  } catch (e) {
    console.warn('[VAPID] configuração inválida:', e?.message || e)
  }
}

app.get('/api/vapid-public-key', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY })
})

app.get('/api/radar-icon', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'attached_assets', 'image_1787161275303.png'))
})

// ── WebSocket — Rastreamento em tempo real ──────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

const todosConectados = new Set()
const dispositivosOnline = new Map()
const agentesOnline = new Map()
const prontidaoAtivos = new Map() // id → { nome, planoId, ts }
const ONLINE_TTL_MS = 60 * 1000
const PRONTIDAO_TTL_MS = 5 * 60 * 1000 // 5 min sem renovar → expirar
const radarEventosNotificados = new Set()

// Endpoint REST para leitura inicial da lista de agentes online
// (independente de timing do WebSocket)
function getAgentesOnlineAtivos() {
  const agora = Date.now()
  const lista = []
  for (const [id, info] of agentesOnline) {
    if (agora - info.ts <= ONLINE_TTL_MS) lista.push({ id, nome: info.nome })
  }
  return lista
}

function emitirOnlineSync() {
  const agora = Date.now()
  const agentes = []
  for (const [id, info] of agentesOnline) {
    if (agora - info.ts > ONLINE_TTL_MS) continue
    agentes.push({ id, nome: info.nome })
  }
  broadcastParaTodos({ tipo: 'online_sync', agentes })
}

function broadcastParaTodos(payload, excluirWs = null) {
  const mensagem = payload && typeof payload === 'object' && !('id' in payload) && !('ts' in payload)
    ? { ...payload, ts: Date.now() }
    : payload
  const json = JSON.stringify(mensagem)
  for (const ws of todosConectados) {
    if (ws !== excluirWs && ws.readyState === 1) {
      ws.send(json)
    }
  }
}

const sosAtivos = new Map()
const SOS_TTL_MS = 60 * 60 * 1000

async function enviarPushSosServidor(msg) {
  if (!vapidConfigured) return
  if (!msg || !msg.id || !msg.agente) return
  try {
    const result = await query('SELECT id, endpoint, p256dh, auth, agente FROM push_subscriptions')
    const subs = result.rows
    if (!subs.length) return
    const localPart = msg.lat != null && msg.lng != null
      ? `📍 ${Number(msg.lat).toFixed(4)}, ${Number(msg.lng).toFixed(4)}`
      : 'Localização em apuração'
    const payload = JSON.stringify({
      title: '🆘 SOS — CODAP',
      body: `${msg.agente} acionou o SOS! ${localPart}`,
      tag: `sos-${msg.id}`,
      sosId: msg.id,
      url: '/',
    })
    const removidos = []
    await Promise.all(subs.map(async (s) => {
      if (msg.deviceId && s.id === msg.deviceId) return
      if (s.agente && msg.agente && s.agente === msg.agente) return
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 30, urgency: 'high' },
        )
      } catch (err) {
        const status = err && err.statusCode
        if (status === 404 || status === 410) removidos.push(s.id)
        else console.warn('[SOS-push] erro:', s.id, status)
      }
    }))
    if (removidos.length > 0) {
      await query('DELETE FROM push_subscriptions WHERE id = ANY($1)', [removidos])
    }
  } catch (e) {
    console.warn('[SOS-push] falha geral:', e?.message || e)
  }
}

// ── Envio de push para agentes específicos (escala, confirmação, evento) ─────
async function enviarPushParaAgentes(agentesAlvo, payloadJson, excluirAgente = null) {
  if (!vapidConfigured || !agentesAlvo || agentesAlvo.length === 0) return 0
  try {
    const result = await query('SELECT id, endpoint, p256dh, auth, agente FROM push_subscriptions')
    let subs = result.rows
    subs = subs.filter(s => {
      if (!s.agente) return false
      if (excluirAgente && s.agente === excluirAgente) return false
      return agentesAlvo.includes(s.agente)
    })
    const removidos = []
    let enviados = 0
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          typeof payloadJson === 'string' ? payloadJson : JSON.stringify(payloadJson),
          { TTL: 60 * 60 * 24, urgency: 'normal' }
        )
        enviados++
      } catch (err) {
        const status = err && err.statusCode
        if (status === 404 || status === 410) removidos.push(s.id)
        else console.warn('[push-agentes] erro:', s.id, status)
      }
    }))
    if (removidos.length > 0) {
      await query('DELETE FROM push_subscriptions WHERE id = ANY($1)', [removidos])
    }
    return enviados
  } catch (e) {
    console.warn('[push-agentes] falha geral:', e?.message || e)
    return 0
  }
}

// ── Notifica agentes escalados no dia do evento ────────────────────────────
async function notificarEventosDoDia() {
  if (!vapidConfigured) return
  try {
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const result = await query(
      "SELECT id, nome, agentes_defesa_civil FROM planejamentos WHERE data_inicio = $1 AND tipo = 'evento' AND status NOT IN ('cancelado', 'concluido')",
      [hoje]
    )
    for (const p of result.rows) {
      const agentes = Array.isArray(p.agentes_defesa_civil) ? p.agentes_defesa_civil : []
      if (!agentes.length) continue
      const payload = JSON.stringify({
        title: `📸 Evento hoje: ${p.nome}`,
        body: 'Registre fotos do evento no aplicativo CODAP!',
        tag: `evento-dia-${p.id}-${hoje}`,
        tipo: 'evento_dia',
        url: '/',
      })
      const n = await enviarPushParaAgentes(agentes, payload)
      console.log(`[scheduler] evento-dia "${p.nome}": ${n} notificação(ões) enviada(s)`)
    }

    const radar = await query(
      `SELECT id, texto, data, hora, agentes_envolvidos, confirmacoes_agentes
       FROM radar_bilhetes
       WHERE data = $1 AND tipo = 'notificacao' AND concluido = FALSE`,
      [hoje]
    )
    for (const registro of radar.rows) {
      const confirmacoes = Array.isArray(registro.confirmacoes_agentes) ? registro.confirmacoes_agentes : []
      const agentes = (Array.isArray(registro.agentes_envolvidos) ? registro.agentes_envolvidos : [])
        .filter((nome) => confirmacoes.some((item) => item?.agente === nome && item?.confirmado === true))
      const chave = `${registro.id}-${hoje}`
      if (!agentes.length || radarEventosNotificados.has(chave)) continue
      const payload = JSON.stringify({
        title: '📅 Radar Codap — evento hoje',
        body: `${registro.hora || 'Horário não informado'} · ${registro.texto}`,
        tag: `radar-evento-dia-${chave}`,
        tipo: 'radar_evento_dia',
        url: '/',
      })
      const n = await enviarPushParaAgentes(agentes, payload)
      radarEventosNotificados.add(chave)
      console.log(`[scheduler] Radar Codap "${registro.texto}": ${n} notificação(ões) enviada(s)`)
    }
  } catch (e) {
    console.warn('[scheduler] notificarEventosDoDia:', e?.message)
  }
}

function processarSos(msg, wsRemetente = null) {
  if (!msg || !msg.id) return
  const existente = sosAtivos.get(msg.id)
  if (existente) {
    const fundido = { ...existente, ...msg }
    sosAtivos.set(msg.id, fundido)
    broadcastParaTodos(fundido, wsRemetente)
  } else {
    const novo = { ...msg, visualizadores: [], mensagens: [] }
    sosAtivos.set(msg.id, novo)
    broadcastParaTodos(msg, wsRemetente)
    enviarPushSosServidor(msg).catch(() => {})
    // Persiste no banco de dados
    query(
      `INSERT INTO sos_ativos_db (id, agente, lat, lng, bateria, audio, timestamp, visualizadores, mensagens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET agente=$2, lat=$3, lng=$4, bateria=$5, audio=COALESCE($6, sos_ativos_db.audio), timestamp=$7`,
      [msg.id, msg.agente || '', msg.lat ?? null, msg.lng ?? null, msg.bateria ?? null,
       msg.audio ?? null, msg.timestamp || Date.now(), JSON.stringify([]), JSON.stringify([])]
    ).catch(e => console.warn('[SOS-DB] erro ao salvar:', e?.message))
  }
}

function processarSosAudio(msg, wsRemetente = null) {
  if (!msg || !msg.id || !msg.audio) return
  const existente = sosAtivos.get(msg.id)
  if (existente) {
    sosAtivos.set(msg.id, { ...existente, audio: msg.audio })
    // Atualiza áudio no banco
    query('UPDATE sos_ativos_db SET audio=$1 WHERE id=$2', [msg.audio, msg.id])
      .catch(e => console.warn('[SOS-DB] erro ao atualizar áudio:', e?.message))
  }
  broadcastParaTodos(msg, wsRemetente)
}

function processarSosCancelar(msg, wsRemetente = null) {
  if (!msg || !msg.id) return
  sosAtivos.delete(msg.id)
  broadcastParaTodos(msg, wsRemetente)
  // Remove do banco de dados
  query('DELETE FROM sos_ativos_db WHERE id=$1', [msg.id])
    .catch(e => console.warn('[SOS-DB] erro ao remover:', e?.message))
}

wss.on('connection', (ws) => {
  todosConectados.add(ws)
  let dispositivoId = null
  let onlineId = null

  const posicoeAtuais = []
  for (const [id, d] of dispositivosOnline) {
    if (d.lat !== null && d.lat !== undefined) {
      posicoeAtuais.push({ id, nome: d.nome, lat: d.lat, lng: d.lng, precisao: d.precisao, velocidade: d.velocidade })
    }
  }
  if (posicoeAtuais.length > 0) {
    ws.send(JSON.stringify({ tipo: 'posicoes_iniciais', posicoes: posicoeAtuais }))
  }

  const agora = Date.now()
  const sosValidos = []
  for (const [, alerta] of sosAtivos) {
    if (agora - alerta.timestamp < SOS_TTL_MS) sosValidos.push(alerta)
  }
  if (sosValidos.length > 0) {
    ws.send(JSON.stringify({ tipo: 'sos_persistidos', alertas: sosValidos }))
  }

  const agentesAtuais = []
  for (const [id, info] of agentesOnline) {
    if (Date.now() - info.ts <= ONLINE_TTL_MS) agentesAtuais.push({ id, nome: info.nome })
  }
  ws.send(JSON.stringify({ tipo: 'online_sync', agentes: agentesAtuais }))

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())

      if (msg.tipo === 'posicao') {
        dispositivoId = msg.id
        dispositivosOnline.set(dispositivoId, {
          ws,
          nome: msg.nome || `Equipe ${msg.id}`,
          lat: msg.lat,
          lng: msg.lng,
          precisao: msg.precisao || 0,
          velocidade: msg.velocidade ?? null,
          ts: Date.now(),
        })
        broadcastParaTodos({
          tipo: 'posicao',
          id: msg.id,
          nome: msg.nome || `Equipe ${msg.id}`,
          lat: msg.lat,
          lng: msg.lng,
          precisao: msg.precisao || 0,
          velocidade: msg.velocidade ?? null,
        }, ws)
      }

      if (msg.tipo === 'parar') {
        const idParar = msg.id || dispositivoId
        if (dispositivosOnline.has(idParar)) {
          dispositivosOnline.delete(idParar)
          broadcastParaTodos({ tipo: 'remover', id: idParar })
        }
      }

      if (msg.tipo === 'ping') {
        ws.send(JSON.stringify({ tipo: 'pong' }))
      }

      if (msg.tipo === 'checklists_ferramental_atualizados') {
        broadcastChecklistsFerramentalAtualizados()
      }

      if (msg.tipo === 'materiais_atualizados') {
        broadcastMateriaisAtualizados()
      }

      if (msg.tipo === 'online') {
        const id = String(msg.id || '')
        const nome = String(msg.nome || `Equipe ${id.slice(0, 4)}`)
        if (id) {
          onlineId = id
          agentesOnline.set(id, { nome, ts: Date.now() })
          emitirOnlineSync()
        }
      }
      if (msg.tipo === 'offline') {
        const id = String(msg.id || onlineId || '')
        if (id && agentesOnline.has(id)) {
          agentesOnline.delete(id)
          emitirOnlineSync()
        }
      }

      if (msg.tipo === 'online_ping') {
        const id = String(msg.id || onlineId || '')
        if (id && agentesOnline.has(id)) {
          const info = agentesOnline.get(id)
          info.ts = Date.now()
          agentesOnline.set(id, info)
        }
      }

      if (msg.tipo === 'solicitar_online') {
        const lista = []
        for (const [id, info] of agentesOnline) {
          if (Date.now() - info.ts <= ONLINE_TTL_MS) lista.push({ id, nome: info.nome })
        }
        ws.send(JSON.stringify({ tipo: 'online_sync', agentes: lista }))
      }

      if (msg.tipo === 'solicitar_estado') {
        const posicoes = []
        for (const [id, d] of dispositivosOnline) {
          if (d.lat !== null && d.lat !== undefined) {
            posicoes.push({ id, nome: d.nome, lat: d.lat, lng: d.lng, precisao: d.precisao, velocidade: d.velocidade })
          }
        }
        if (posicoes.length > 0) {
          ws.send(JSON.stringify({ tipo: 'posicoes_iniciais', posicoes }))
        }
        const agoraEstado = Date.now()
        const sosValidos = []
        for (const [, alerta] of sosAtivos) {
          if (agoraEstado - alerta.timestamp < SOS_TTL_MS) sosValidos.push(alerta)
        }
        if (sosValidos.length > 0) {
          ws.send(JSON.stringify({ tipo: 'sos_persistidos', alertas: sosValidos }))
        }
      }

      if (msg.tipo === 'sos') processarSos(msg, ws)
      if (msg.tipo === 'sos-audio') processarSosAudio(msg, ws)
      if (msg.tipo === 'sos-cancelar') processarSosCancelar(msg, ws)
      if (msg.tipo === 'radar_notificacao_agente') {
        broadcastParaTodos(msg, ws)
      }

      if (msg.tipo === 'sos-visualizar') {
        const { id, agente } = msg
        if (id && agente) {
          const existente = sosAtivos.get(id)
          if (existente) {
            const vizs = Array.isArray(existente.visualizadores) ? existente.visualizadores : []
            if (!vizs.includes(agente)) {
              const atualizados = [...vizs, agente]
              sosAtivos.set(id, { ...existente, visualizadores: atualizados })
              broadcastParaTodos({ tipo: 'sos-visualizado', id, visualizadores: atualizados }, null)
              // Persiste no banco
              query('UPDATE sos_ativos_db SET visualizadores=$1 WHERE id=$2',
                [JSON.stringify(atualizados), id])
                .catch(e => console.warn('[SOS-DB] erro ao atualizar visualizadores:', e?.message))
            } else {
              // Já visualizou, mas envia o estado atual para o agente que reconectou
              if (vizs.length > 0) {
                broadcastParaTodos({ tipo: 'sos-visualizado', id, visualizadores: vizs }, null)
              }
            }
          }
        }
      }

      if (msg.tipo === 'sos-mensagem') {
        processarSosMensagem(msg).catch(() => {})
      }

      if (msg.tipo === 'prontidao') {
        const pid = String(msg.id || '')
        const pNome = String(msg.nome || `Equipe ${pid.slice(0, 4)}`)
        const pPlanoId = String(msg.planoId || '')
        if (pid && pPlanoId) {
          prontidaoAtivos.set(pid, { nome: pNome, planoId: pPlanoId, ts: Date.now() })
          broadcastParaTodos({ tipo: 'prontidao', id: pid, nome: pNome, planoId: pPlanoId, ativo: true }, ws)
        }
      }

      if (msg.tipo === 'prontidao_sair') {
        const pid = String(msg.id || '')
        if (pid && prontidaoAtivos.has(pid)) {
          const info = prontidaoAtivos.get(pid)
          prontidaoAtivos.delete(pid)
          broadcastParaTodos({ tipo: 'prontidao_sair', id: pid, planoId: info.planoId }, ws)
        }
      }
    } catch { /* ignora mensagens malformadas */ }
  })

  // Envia prontidões ativas para o novo cliente
  const prontidoesAtuais = []
  const agoraPront = Date.now()
  for (const [id, d] of prontidaoAtivos) {
    if (agoraPront - d.ts <= PRONTIDAO_TTL_MS) {
      prontidoesAtuais.push({ id, nome: d.nome, planoId: d.planoId })
    } else {
      prontidaoAtivos.delete(id)
    }
  }
  if (prontidoesAtuais.length > 0) {
    ws.send(JSON.stringify({ tipo: 'prontidao_iniciais', agentes: prontidoesAtuais }))
  }

  ws.on('close', () => {
    todosConectados.delete(ws)
    if (dispositivoId) {
      dispositivosOnline.delete(dispositivoId)
      broadcastParaTodos({ tipo: 'remover', id: dispositivoId })
    }
    if (onlineId && agentesOnline.has(onlineId)) {
      agentesOnline.delete(onlineId)
      emitirOnlineSync()
    }
    // Remove prontidão ao desconectar
    if (dispositivoId && prontidaoAtivos.has(dispositivoId)) {
      const info = prontidaoAtivos.get(dispositivoId)
      prontidaoAtivos.delete(dispositivoId)
      broadcastParaTodos({ tipo: 'prontidao_sair', id: dispositivoId, planoId: info.planoId })
    }
  })

  ws.on('error', () => {
    todosConectados.delete(ws)
    if (dispositivoId) dispositivosOnline.delete(dispositivoId)
    if (onlineId) agentesOnline.delete(onlineId)
    if (dispositivoId && prontidaoAtivos.has(dispositivoId)) {
      prontidaoAtivos.delete(dispositivoId)
    }
  })
})

setInterval(() => {
  const limite = Date.now() - 90 * 1000
  for (const [id, d] of dispositivosOnline) {
    if (d.ts < limite || d.ws.readyState !== 1) {
      dispositivosOnline.delete(id)
      broadcastParaTodos({ tipo: 'remover', id })
    }
  }
  let mudouOnline = false
  const limiteOnline = Date.now() - ONLINE_TTL_MS
  for (const [id, info] of agentesOnline) {
    if (info.ts < limiteOnline) {
      agentesOnline.delete(id)
      mudouOnline = true
    }
  }
  if (mudouOnline) emitirOnlineSync()
}, 15 * 1000)

// ── Report generation helpers ──────────────────────────────────────────────
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function textoDoParagrafo(paragrafo) {
  return (paragrafo.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) || [])
    .map((trecho) => trecho.replace(/^<w:t\b[^>]*>|<\/w:t>$/g, ''))
    .join('')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function atributosTexto(atributos) {
  return atributos.replace(/\s+xml:space="[^"]*"/g, '')
}

function substituirTextoDoParagrafo(documentXml, localizar, novoTexto) {
  let encontrado = false
  return documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragrafo) => {
    if (encontrado || !localizar(textoDoParagrafo(paragrafo))) return paragrafo
    const textos = paragrafo.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) || []
    if (!textos.length) return paragrafo
    encontrado = true
    let primeiro = true
    return paragrafo.replace(/<w:t\b([^>]*)>[\s\S]*?<\/w:t>/g, (_trecho, atributos) => {
      if (!primeiro) return ''
      primeiro = false
      return `<w:t${atributosTexto(atributos)} xml:space="preserve">${xmlEscape(novoTexto)}</w:t>`
    })
  })
}

const NOMES_COMPLETOS_ASSINATURA = {
  Rosane: 'Rosane Felisbina Coelho',
  Lucas: 'Lucas Hilário de Carvalho',
  Junior: 'Junior Clayton Glauberto',
}

const NOME_COORDENADOR = 'Alexandre Dantte Barbosa'

function normalizarAgenteRelatorio(nome) {
  const valor = String(nome || '').trim()
  return ({
    A: 'Alexandre',
    B: 'Arthur',
    C: 'Lucas',
    D: 'Junior',
    E: 'Rosane',
    'Moisés': 'Alexandre',
    Valteir: 'Arthur',
  })[valor] || valor
}

function nomesAssinaturaRelatorio(ocorrencia) {
  const agente = normalizarAgenteRelatorio(ocorrencia.responsavel_registro)
  return {
    responsavel: agente === 'Alexandre'
      ? ''
      : NOMES_COMPLETOS_ASSINATURA[agente] || agente,
    coordenador: NOME_COORDENADOR,
  }
}

function formatarDataCurta(data = new Date()) {
  return data.toLocaleDateString('pt-BR')
}

function formatarDataExtenso(data = new Date()) {
  return `${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}`
}

function decimalParaGms(valor, positivo, negativo) {
  const absoluto = Math.abs(Number(valor))
  const graus = Math.floor(absoluto)
  const minutosFloat = (absoluto - graus) * 60
  const minutos = Math.floor(minutosFloat)
  const segundos = ((minutosFloat - minutos) * 60).toFixed(2).replace('.', ',')
  return `${graus}° ${minutos}' ${segundos}" ${Number(valor) >= 0 ? positivo : negativo}`
}

function formatarCoordenadas(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return 'Não informadas'
  return `${decimalParaGms(lat, 'N', 'S')}, ${decimalParaGms(lng, 'L', 'O')}`
}

function limparNomeArquivo(valor, fallback) {
  const limpo = String(valor || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return limpo || fallback
}

function nomeRua(endereco) {
  const texto = String(endereco || '').trim()
  if (!texto) return 'Endereco'
  return texto.split(',')[0].trim() || texto
}

function relatorioFileName(ocorrencia) {
  const numero = limparNomeArquivo(ocorrencia.id, 'numero')
  const rua = limparNomeArquivo(nomeRua(ocorrencia.endereco), 'Nome_da_Rua')
  const requerente = limparNomeArquivo(ocorrencia.proprietario, 'Nome_do_requerente')
  return `RelVist_${numero}_${rua}_${requerente}.docx`
}

function getRelatorioTemplatePath() {
  const templatePublico = join(__dirname, '..', 'public', 'relatorio-vistoria-template.docx')
  if (existsSync(templatePublico)) return templatePublico

  const assetsPath = join(__dirname, '..', 'attached_assets')
  const arquivos = readdirSync(assetsPath)
    .filter((nome) => /^Modelo_.*\.docx$/i.test(nome))
    .sort()
  if (!arquivos.length) throw new Error('Modelo de relatório não encontrado')
  return join(assetsPath, arquivos[arquivos.length - 1])
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/)
  if (!match) return null
  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1]
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpeg'
  return { mime, extension, buffer: Buffer.from(match[2], 'base64') }
}

function imageDrawingXml(rId, index) {
  const cx = 2880000
  const cy = 3420000
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${200 + index}" name="Foto ${index}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="0"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${300 + index}" name="Foto ${index}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

function captionFiguraXml(numero, descricao) {
  const descRun = descricao
    ? `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${xmlEscape(descricao)}</w:t></w:r>`
    : ''
  return `<w:p><w:pPr><w:pStyle w:val="2024"/><w:pBdr></w:pBdr><w:spacing/><w:ind/><w:jc w:val="center"/><w:rPr><w:highlight w:val="none"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">Figura </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> SEQ Figura \\* Arabic </w:instrText><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve">${numero} </w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve">- </w:t></w:r>${descRun}</w:p>`
}

async function gerarRelatorioVistoria(ocorrencia) {
  const template = readFileSync(getRelatorioTemplatePath())
  const zip = await JSZip.loadAsync(template)
  const hoje = new Date()
  const natureza = ocorrencia.natureza || 'Não informada'
  const requerente = ocorrencia.proprietario || 'Não informado'
  const endereco = ocorrencia.endereco || 'Não informado'
  let documentXml = await zip.file('word/document.xml').async('string')

  const situacao = ocorrencia.situacao || ''
  const recomendacao = ocorrencia.recomendacao || ''
  const conclusao = ocorrencia.conclusao || ''
  const assinaturas = nomesAssinaturaRelatorio(ocorrencia)

  const substituicoes = {
    '"data 1"': formatarDataCurta(hoje),
    '"Nome do requerente"': xmlEscape(requerente),
    '"Natureza da Ocorrência"': xmlEscape(natureza),
    'Natureza da Ocorrência': xmlEscape(natureza),
    '"data 2"': xmlEscape(formatarDataExtenso(hoje)),
    '"Endereço"': xmlEscape(endereco),
    '"coordenadas do local"': xmlEscape(formatarCoordenadas(ocorrencia.lat, ocorrencia.lng)),
    'coordenadas do local': xmlEscape(formatarCoordenadas(ocorrencia.lat, ocorrencia.lng)),
    '(informações da situação descrita na ocorrência, quadro 9)': xmlEscape(situacao),
    '(informações da recomendação descrita na ocorrência, quadro 10)': xmlEscape(recomendacao),
    '(informações da situação descrita na conclusão, quadro 11)': xmlEscape(conclusao),
  }

  for (const [alvo, valor] of Object.entries(substituicoes)) {
    documentXml = documentXml.split(alvo).join(valor)
  }

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

  if (ocorrencia.tipo === 'Vistoria Ambiental') {
    documentXml = documentXml
      .split('Cristiane Caroline Campos Lopes').join('Talita Oliveira de Ara\u00FAjo')
    const paragrafoCargo = '<w:p><w:pPr><w:keepNext w:val="false" /><w:keepLines w:val="false" /><w:pageBreakBefore w:val="false" /><w:widowControl w:val="true" /><w:pBdr></w:pBdr><w:spacing w:after="0" /><w:ind /><w:jc w:val="center" /><w:rPr><w:rFonts w:hint="default" w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" /><w:sz w:val="20" /><w:szCs w:val="20" /></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:hint="default" w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" /><w:sz w:val="20" /><w:szCs w:val="20" /></w:rPr><w:t>Analista Ambiental</w:t></w:r></w:p>'
    documentXml = documentXml.replace(
      /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?Engenheira Civil - (?:(?!<\/w:p>)[\s\S])*?<\/w:p>/,
      paragrafoCargo
    )
  } else {
    documentXml = substituirTextoDoParagrafo(
      documentXml,
      (texto) => texto.trimStart().startsWith('Engenheiro(a) Civil -')
        || texto.trimStart().startsWith('Engenheira Civil -'),
      'Agente - Coordenadoria Municipal de Proteção e Defesa Civil',
    )
      .split('Talita Oliveira de Ara\u00FAjo').join('Cristiane Caroline Campos Lopes')
      .split('Talita Oliveira de Araújo').join('Cristiane Caroline Campos Lopes')
      .split('Analista Ambiental').join('Engenheira Civil - CODAP')
  }

  documentXml = documentXml
    .replace(/[“”]/g, '')
    .replace(/,\s*Zona Rural de Olaria/g, '')
    .replace(/\s+Zona Rural de Olaria,\s*coordenadas/g, ' coordenadas')
    .replace(/\s*descreva a conclus.o\.?/gi, '')

  let relsXml = await zip.file('word/_rels/document.xml.rels').async('string')
  const contentTypesFile = zip.file('[Content_Types].xml')
  let contentTypesXml = await contentTypesFile.async('string')
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]))
  let proximoId = Math.max(0, ...ids) + 1

  const fotos = Array.isArray(ocorrencia.fotos) ? ocorrencia.fotos : []
  const descricoes = Array.isArray(ocorrencia.descricoes_fotos) ? ocorrencia.descricoes_fotos : []
  const imagensFotos = []
  fotos.forEach((foto) => {
    const imagem = parseDataUrl(foto)
    if (!imagem) return
    imagensFotos.push({ imagem, numero: imagensFotos.length + 1, descricao: descricoes[imagensFotos.length] || '' })
  })

  function cellFotoXml(content, width, gridSpan = 1) {
    const span = gridSpan > 1 ? `<w:gridSpan w:val="${gridSpan}"/>` : ''
    return `<w:tc><w:tcPr><w:tcBorders><w:top w:val="none" w:color="000000" w:sz="4" w:space="0"/><w:left w:val="none" w:color="000000" w:sz="4" w:space="0"/><w:bottom w:val="none" w:color="000000" w:sz="4" w:space="0"/><w:right w:val="none" w:color="000000" w:sz="4" w:space="0"/></w:tcBorders>${span}<w:tcW w:w="${width}" w:type="dxa"/><w:textDirection w:val="lrTb"/><w:noWrap w:val="false"/></w:tcPr>${content}</w:tc>`
  }

  const tabelaFotosRegex = /<w:tbl\b[\s\S]*?SEQ Figura[\s\S]*?<\/w:tbl>/
  const tabelaFotos = documentXml.match(tabelaFotosRegex)?.[0]
  if (tabelaFotos && imagensFotos.length === 0) {
    documentXml = documentXml.replace(tabelaFotos, '')
  } else if (tabelaFotos) {
    const tabelaCabecalho = tabelaFotos.match(/^[\s\S]*?<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)?.[0]
    if (!tabelaCabecalho) throw new Error('Modelo de relatório inválido (tabela de fotos sem grade).')
    const linhasFotos = []
    for (let i = 0; i < imagensFotos.length; i += 2) {
      const primeira = imagensFotos[i]
      const primeiraRid = `rId${proximoId++}`
      const primeiroTarget = `media/relatorio_foto_${primeira.numero}.${primeira.imagem.extension}`
      zip.file(`word/${primeiroTarget}`, primeira.imagem.buffer)
      relsXml = relsXml.replace(
        '</Relationships>',
        `<Relationship Id="${primeiraRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${primeiroTarget}" /></Relationships>`
      )
      if (!contentTypesXml.includes(`Extension="${primeira.imagem.extension}"`)) {
        contentTypesXml = contentTypesXml.replace(
          '</Types>',
          `<Default Extension="${primeira.imagem.extension}" ContentType="${primeira.imagem.mime}"/></Types>`
        )
      }
      const primeiraCelula = cellFotoXml(
        `${imageDrawingXml(primeiraRid, primeira.numero)}${captionFiguraXml(primeira.numero, primeira.descricao)}`,
        imagensFotos[i + 1] ? 4960 : 9921,
        imagensFotos[i + 1] ? 1 : 2,
      )
      let celulas = primeiraCelula
      if (imagensFotos[i + 1]) {
        const segunda = imagensFotos[i + 1]
        const segundaRid = `rId${proximoId++}`
        const segundoTarget = `media/relatorio_foto_${segunda.numero}.${segunda.imagem.extension}`
        zip.file(`word/${segundoTarget}`, segunda.imagem.buffer)
        relsXml = relsXml.replace(
          '</Relationships>',
          `<Relationship Id="${segundaRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${segundoTarget}" /></Relationships>`
        )
        if (!contentTypesXml.includes(`Extension="${segunda.imagem.extension}"`)) {
          contentTypesXml = contentTypesXml.replace(
            '</Types>',
            `<Default Extension="${segunda.imagem.extension}" ContentType="${segunda.imagem.mime}"/></Types>`
          )
        }
        celulas += cellFotoXml(
          `${imageDrawingXml(segundaRid, segunda.numero)}${captionFiguraXml(segunda.numero, segunda.descricao)}`,
          4961,
        )
      }
      linhasFotos.push(`<w:tr><w:trPr><w:trHeight w:val="6052"/></w:trPr>${celulas}</w:tr>`)
    }
    documentXml = documentXml.replace(tabelaFotos, `${tabelaCabecalho}${linhasFotos.join('')}</w:tbl>`)
  }

  documentXml = documentXml.replace(/<w:tc>([\s\S]*?)<\/w:tc>/g, (match, content) => {
    if (!content.includes('<w:drawing>')) return match
    const cleaned = content.replace(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, (para) => {
      const hasText = /<w:t[^>]*>[^<]/.test(para)
      const hasDrawing = para.includes('<w:drawing>')
      return (hasText || hasDrawing) ? para : ''
    })
    return `<w:tc>${cleaned}</w:tc>`
  })

  zip.file('word/document.xml', documentXml)
  zip.file('word/_rels/document.xml.rels', relsXml)
  zip.file('[Content_Types].xml', contentTypesXml)
  return zip.generateAsync({ type: 'nodebuffer' })
}

// ── DB init — cria tabelas se não existirem ─────────────────────────────────
async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS ocorrencias (
      id BIGSERIAL PRIMARY KEY,
      tipo TEXT,
      natureza TEXT,
      subnatureza TEXT,
      nivel_risco TEXT,
      status_oc TEXT DEFAULT 'ativo',
      fotos JSONB DEFAULT '[]',
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      endereco TEXT,
      proprietario TEXT,
      telefone_proprietario TEXT,
      situacao TEXT,
      recomendacao TEXT,
      conclusao TEXT,
      data_ocorrencia TEXT,
      agentes JSONB DEFAULT '[]',
      responsavel_registro TEXT,
      vistorias JSONB DEFAULT '[]',
      focos_incendio JSONB DEFAULT NULL,
      chuva NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS focos_incendio JSONB DEFAULT NULL`)
  await query(`ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS poligono_area_queimada JSONB DEFAULT NULL`)
  await query(`ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS chuva NUMERIC`)
  await query(`ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS hora_inicio VARCHAR(5)`)
  await query(`ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS hora_fim VARCHAR(5)`)
  await query(`ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS horas_total NUMERIC(5,2)`)
  await query(`ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS horas_sobreaviso NUMERIC(5,2)`)
  await query(`ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS telefone_proprietario TEXT`)

  await query(`
    CREATE TABLE IF NOT EXISTS escala_estado (
      id INTEGER PRIMARY KEY,
      data JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS checklists_viatura (
      id BIGSERIAL PRIMARY KEY,
      data_checklist TEXT,
      km TEXT,
      placa TEXT,
      motorista TEXT,
      fotos_avarias JSONB DEFAULT '[]',
      foto_frontal TEXT,
      foto_traseira TEXT,
      foto_direita TEXT,
      foto_esquerda TEXT,
      itens JSONB DEFAULT '{}',
      observacoes TEXT,
      assinatura_data TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS materiais (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL DEFAULT 'escritorio',
      descricao TEXT,
      observacoes TEXT,
      foto TEXT,
      foto_placa TEXT,
      foto_thumb TEXT,
      quantidade INTEGER NOT NULL DEFAULT 1,
      tipo TEXT NOT NULL DEFAULT 'escritorio',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  // Garante que todas as colunas de foto existam em tabelas criadas com schema antigo
  await query(`ALTER TABLE materiais ADD COLUMN IF NOT EXISTS foto TEXT`)
  await query(`ALTER TABLE materiais ADD COLUMN IF NOT EXISTS foto_placa TEXT`)
  await query(`ALTER TABLE materiais ADD COLUMN IF NOT EXISTS foto_thumb TEXT`)
  await query(`ALTER TABLE materiais ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'escritorio'`)
  await query(`ALTER TABLE materiais ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'escritorio'`)

  await query(`
    CREATE TABLE IF NOT EXISTS checklists_ferramentas (
      id BIGSERIAL PRIMARY KEY,
      ferramenta_id TEXT NOT NULL REFERENCES materiais(id) ON DELETE CASCADE,
      quantidade_verificada INTEGER NOT NULL,
      condicao TEXT NOT NULL,
      justificativa_falta TEXT,
      realizado_por TEXT,
      realizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS checklists_ferramental (
      id BIGSERIAL PRIMARY KEY,
      ferramenta_id TEXT NOT NULL REFERENCES materiais(id) ON DELETE CASCADE,
      quantidade_cadastrada INTEGER NOT NULL,
      quantidade_conferida INTEGER NOT NULL,
      condicao TEXT NOT NULL CHECK (condicao IN ('boa', 'media', 'ruim')),
      item_faltante TEXT,
      justificativa TEXT,
      realizado_por TEXT,
      data_checklist TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  // A serragem é controlada por quantidade de sacos, sem classificação de condição.
  await query(`ALTER TABLE checklists_ferramental DROP CONSTRAINT IF EXISTS checklists_ferramental_condicao_check`)
  await query(`ALTER TABLE checklists_ferramental ADD CONSTRAINT checklists_ferramental_condicao_check CHECK (condicao IN ('boa', 'media', 'ruim', 'quantidade'))`)

  await query(`
    CREATE TABLE IF NOT EXISTS emprestimos (
      id BIGSERIAL PRIMARY KEY,
      material_id TEXT NOT NULL REFERENCES materiais(id) ON DELETE CASCADE,
      material_codigo TEXT NOT NULL,
      material_nome TEXT NOT NULL,
      responsavel TEXT NOT NULL,
      cpf TEXT,
      secretaria TEXT,
      prazo_dias INTEGER NOT NULL DEFAULT 7,
      quantidade INTEGER NOT NULL DEFAULT 1,
      data_emprestimo TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data_devolucao_prevista DATE,
      condicao_equipamento TEXT,
      observacoes TEXT,
      agente_emprestador TEXT,
      assinatura_data TEXT,
      devolvido_em TIMESTAMPTZ,
      devolvido_obs TEXT,
      devolvido_recebedor TEXT,
      devolvido_foto TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      agente TEXT,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS monitoramento_cnl_cotas (
      id INTEGER PRIMARY KEY,
      atencao DOUBLE PRECISION NOT NULL,
      alerta DOUBLE PRECISION NOT NULL,
      transbordamento DOUBLE PRECISION NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS equipamentos_campo (
      id BIGSERIAL PRIMARY KEY,
      material_id TEXT REFERENCES materiais(id) ON DELETE SET NULL,
      material_nome TEXT,
      fotos JSONB,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      rua TEXT,
      numero TEXT,
      bairro TEXT,
      observacao TEXT,
      quantidade INTEGER NOT NULL DEFAULT 1,
      prazo_dias INTEGER,
      data_recolha_prevista DATE,
      status TEXT NOT NULL DEFAULT 'ativo',
      agente TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS sos_ativos_db (
      id TEXT PRIMARY KEY,
      agente TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      bateria INTEGER,
      audio TEXT,
      timestamp BIGINT NOT NULL,
      visualizadores JSONB DEFAULT '[]',
      mensagens JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`ALTER TABLE emprestimos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'emprestimo'`)

  await query(`
    CREATE TABLE IF NOT EXISTS planejamentos (
      id TEXT PRIMARY KEY,
      tipo TEXT,
      nome TEXT,
      descricao TEXT,
      local TEXT,
      data_inicio TEXT,
      data_fim TEXT,
      horario TEXT,
      horario_fim TEXT,
      publico_estimado TEXT,
      status TEXT DEFAULT 'planejamento',
      equipe JSONB DEFAULT '[]',
      agentes_defesa_civil JSONB DEFAULT '[]',
      materiais JSONB DEFAULT '[]',
      itens_mapa JSONB DEFAULT '[]',
      pontos_extras JSONB DEFAULT '[]',
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      observacoes TEXT,
      risco TEXT,
      criado_por TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await query(`ALTER TABLE planejamentos ADD COLUMN IF NOT EXISTS confirmacoes_agentes JSONB DEFAULT '[]'`)
  await query(`ALTER TABLE planejamentos ADD COLUMN IF NOT EXISTS fotos_evento JSONB DEFAULT '[]'`)
  await query(`ALTER TABLE planejamentos ADD COLUMN IF NOT EXISTS conclusao TEXT`)
  await query(`ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS descricoes_fotos JSONB DEFAULT '[]'`)
  await query(`
    CREATE TABLE IF NOT EXISTS curral_registros (
      id BIGSERIAL PRIMARY KEY,
      especie TEXT NOT NULL,
      porte TEXT NOT NULL,
      sexo TEXT,
      identificacao TEXT,
      local_descricao TEXT NOT NULL,
      observacoes TEXT,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      precisao_gps DOUBLE PRECISION,
      capturado_em TEXT NOT NULL,
      fotos JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'encontrado',
      criado_por TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS procon_relatorios (
      id TEXT PRIMARY KEY,
      tipo_documento TEXT NOT NULL DEFAULT 'termo_constatacao',
      numero_processo TEXT,
      status TEXT NOT NULL DEFAULT 'pendente',
      dados JSONB NOT NULL,
      criado_por TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS radar_bilhetes (
      id TEXT PRIMARY KEY,
      texto TEXT NOT NULL,
      data TEXT NOT NULL,
      hora TEXT NOT NULL,
      prioridade TEXT NOT NULL DEFAULT 'normal',
      concluido BOOLEAN NOT NULL DEFAULT FALSE,
      criado_por TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      agentes_envolvidos TEXT[] NOT NULL DEFAULT '{}'
    )
  `)
  await query(`ALTER TABLE radar_bilhetes ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'lembrete'`)
  await query(`ALTER TABLE radar_bilhetes ADD COLUMN IF NOT EXISTS agentes_envolvidos TEXT[] NOT NULL DEFAULT '{}'`)
  await query(`ALTER TABLE radar_bilhetes ADD COLUMN IF NOT EXISTS confirmacoes_agentes JSONB NOT NULL DEFAULT '[]'`)

  console.log('[DB] Tabelas verificadas/criadas com sucesso')

  // Notifica agentes sobre eventos do dia (ao iniciar e a cada 6h)
  setTimeout(() => notificarEventosDoDia().catch(() => {}), 8000)
  setInterval(() => notificarEventosDoDia().catch(() => {}), 6 * 60 * 60 * 1000)

  // Carrega SOS ainda válidos do banco ao iniciar
  try {
    const limiteTs = Date.now() - SOS_TTL_MS
    const result = await query(
      'SELECT * FROM sos_ativos_db WHERE timestamp > $1',
      [limiteTs]
    )
    for (const row of result.rows) {
      sosAtivos.set(row.id, {
        tipo: 'sos',
        id: row.id,
        agente: row.agente,
        lat: row.lat,
        lng: row.lng,
        bateria: row.bateria,
        audio: row.audio,
        timestamp: Number(row.timestamp),
        visualizadores: Array.isArray(row.visualizadores) ? row.visualizadores : [],
        mensagens: Array.isArray(row.mensagens) ? row.mensagens : [],
      })
    }
    if (result.rows.length > 0) {
      console.log(`[SOS] ${result.rows.length} alerta(s) ativo(s) carregado(s) do banco`)
    }
    // Limpa SOS expirados do banco
    await query('DELETE FROM sos_ativos_db WHERE timestamp <= $1', [limiteTs]).catch(() => {})
  } catch (e) {
    console.warn('[SOS] erro ao carregar alertas do banco:', e?.message)
  }
}

function broadcastOcorrenciasAtualizadas() {
  broadcastParaTodos({ tipo: 'ocorrencias_atualizadas' })
}

// ── Ocorrências ─────────────────────────────────────────────────────────────

// Busca fotos e vistorias em lote (para exportação Excel) — aceita ?ids=1,2,3
app.get('/api/ocorrencias/fotos-lote', async (req, res) => {
  try {
    const raw = (req.query.ids || '').toString().trim()
    if (!raw) return res.json([])
    const ids = raw.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0)
    if (ids.length === 0) return res.json([])
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    const result = await query(
      `SELECT id, fotos, vistorias FROM ocorrencias WHERE id IN (${placeholders})`,
      ids
    )
    res.json(result.rows)
  } catch (err) {
    console.error('GET /api/ocorrencias/fotos-lote error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/ocorrencias', async (req, res) => {
  try {
    // Exclui fotos e vistorias (base64 pesado) da listagem — carregados sob demanda ao abrir
    const result = await query(
      `SELECT id, tipo, natureza, subnatureza, nivel_risco, status_oc,
               lat, lng, endereco, proprietario, telefone_proprietario, situacao, recomendacao, conclusao,
              data_ocorrencia, hora_inicio, hora_fim, horas_total, horas_sobreaviso,
              agentes, responsavel_registro, focos_incendio, poligono_area_queimada, chuva,
              created_at
       FROM ocorrencias ORDER BY created_at DESC`
    )
    res.json(result.rows)
  } catch (err) {
    console.error('GET /api/ocorrencias error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/ocorrencias', async (req, res) => {
  const { tipo, natureza, subnatureza, nivel_risco, status_oc, fotos, descricoes_fotos, lat, lng, endereco, proprietario, telefone_proprietario, situacao, recomendacao, conclusao, data_ocorrencia, agentes, responsavel_registro, vistorias, focos_incendio, poligono_area_queimada, chuva } = req.body
  try {
    const result = await query(
      `INSERT INTO ocorrencias (tipo, natureza, subnatureza, nivel_risco, status_oc, fotos, descricoes_fotos, lat, lng, endereco, proprietario, situacao, recomendacao, conclusao, data_ocorrencia, agentes, responsavel_registro, vistorias, focos_incendio, poligono_area_queimada, chuva, telefone_proprietario)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [tipo, natureza, subnatureza || null, nivel_risco, status_oc || 'ativo',
       JSON.stringify(Array.isArray(fotos) ? fotos : []),
       JSON.stringify(Array.isArray(descricoes_fotos) ? descricoes_fotos : []),
       lat || null, lng || null, endereco || null, proprietario || null,
       situacao || null, recomendacao || null, conclusao || null,
       data_ocorrencia || null,
       JSON.stringify(Array.isArray(agentes) ? agentes : []),
       responsavel_registro || null,
       JSON.stringify(Array.isArray(vistorias) ? vistorias : []),
       Array.isArray(focos_incendio) && focos_incendio.length ? JSON.stringify(focos_incendio) : null,
       Array.isArray(poligono_area_queimada) && poligono_area_queimada.length ? JSON.stringify(poligono_area_queimada) : null,
       chuva != null && chuva !== '' ? Number(chuva) : null,
       telefone_proprietario || null]
    )
    broadcastOcorrenciasAtualizadas()
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/ocorrencias error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/ocorrencias/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM ocorrencias WHERE id = $1', [req.params.id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Não encontrado' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/ocorrencias/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' })
  const { tipo, natureza, subnatureza, nivel_risco, status_oc, fotos, descricoes_fotos, lat, lng, endereco, proprietario, telefone_proprietario, situacao, recomendacao, conclusao, data_ocorrencia, hora_inicio, hora_fim, horas_total, horas_sobreaviso, agentes, vistorias, focos_incendio, poligono_area_queimada, chuva, created_at } = req.body
  console.log(`PUT /api/ocorrencias/${id} — tipo=${tipo} natureza=${natureza}`)
  try {
    const result = await query(
      `UPDATE ocorrencias SET tipo=$1, natureza=$2, subnatureza=$3, nivel_risco=$4, status_oc=$5,
       fotos=$6, descricoes_fotos=$7, lat=$8, lng=$9, endereco=$10, proprietario=$11, situacao=$12, recomendacao=$13,
       conclusao=$14, data_ocorrencia=$15, hora_inicio=$16, hora_fim=$17,
       horas_total=$18, horas_sobreaviso=$19,
       agentes=$20, vistorias=$21, focos_incendio=$22,
       poligono_area_queimada=$23, chuva=$24, telefone_proprietario=$25, created_at=COALESCE($26, created_at)
       WHERE id=$27 RETURNING *`,
      [tipo, natureza, subnatureza || null, nivel_risco, status_oc,
       JSON.stringify(Array.isArray(fotos) ? fotos : []),
       JSON.stringify(Array.isArray(descricoes_fotos) ? descricoes_fotos : []),
       lat != null && lat !== '' ? lat : null,
       lng != null && lng !== '' ? lng : null,
       endereco || null, proprietario || null,
       situacao || null, recomendacao || null, conclusao || null,
       data_ocorrencia || null,
       hora_inicio || null, hora_fim || null,
       horas_total != null ? horas_total : null,
       horas_sobreaviso != null ? horas_sobreaviso : null,
       JSON.stringify(Array.isArray(agentes) ? agentes : []),
       JSON.stringify(Array.isArray(vistorias) ? vistorias : []),
       Array.isArray(focos_incendio) && focos_incendio.length ? JSON.stringify(focos_incendio) : null,
       Array.isArray(poligono_area_queimada) && poligono_area_queimada.length ? JSON.stringify(poligono_area_queimada) : null,
        chuva != null && chuva !== '' ? Number(chuva) : null,
         telefone_proprietario || null,
         created_at || null,
       id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Ocorrência não encontrada' })
    console.log(`PUT /api/ocorrencias/${id} — salvo com sucesso`)
    broadcastOcorrenciasAtualizadas()
    return res.json(result.rows[0])
  } catch (err) {
    console.error('PUT /api/ocorrencias error:', err)
    return res.status(500).json({ error: err.message })
  }
})

app.delete('/api/ocorrencias/:id', async (req, res) => {
  try {
    await query('DELETE FROM ocorrencias WHERE id = $1', [req.params.id])
    broadcastOcorrenciasAtualizadas()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Curral Regional ──────────────────────────────────────────────────────────
app.get('/api/curral', async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, especie, porte, sexo, identificacao, local_descricao,
              observacoes, latitude, longitude, precisao_gps, capturado_em,
              jsonb_array_length(COALESCE(fotos, '[]'::jsonb)) AS fotos_count,
              status, criado_por, created_at
       FROM curral_registros
       ORDER BY created_at DESC
       LIMIT 500`
    )
    res.json(result.rows)
  } catch (err) {
    console.error('GET /api/curral error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/curral', async (req, res) => {
  const {
    especie, porte, sexo, identificacao, local_descricao, observacoes,
    latitude, longitude, precisao_gps, capturado_em, fotos, status, criado_por,
  } = req.body || {}
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!String(especie || '').trim() || !String(porte || '').trim() || !String(local_descricao || '').trim()) {
    return res.status(400).json({ error: 'Espécie, porte e descrição do local são obrigatórios.' })
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'A localização GPS do animal é obrigatória e inválida.' })
  }
  const fotosSeguras = Array.isArray(fotos)
    ? fotos.filter((foto) => typeof foto === 'string' && foto.startsWith('data:image/')).slice(0, 6)
    : []
  const statusPermitidos = new Set(['encontrado', 'a_caminho', 'no_curral', 'encerrado'])
  const statusSeguro = statusPermitidos.has(status) ? status : 'encontrado'
  try {
    const result = await query(
      `INSERT INTO curral_registros
        (especie, porte, sexo, identificacao, local_descricao, observacoes,
         latitude, longitude, precisao_gps, capturado_em, fotos, status, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        String(especie).trim(), String(porte).trim(), sexo || null, identificacao || null,
        String(local_descricao).trim(), observacoes || null, lat, lng,
        Number.isFinite(Number(precisao_gps)) ? Number(precisao_gps) : null,
        String(capturado_em || new Date().toISOString()), JSON.stringify(fotosSeguras),
        statusSeguro, criado_por || null,
      ]
    )
    broadcastParaTodos({ tipo: 'curral_atualizado' })
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/curral error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/curral/:id', async (req, res) => {
  const {
    especie, porte, sexo, identificacao, local_descricao, observacoes,
    latitude, longitude, precisao_gps, capturado_em, fotos, status,
  } = req.body || {}
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!String(especie || '').trim() || !String(porte || '').trim() || !String(local_descricao || '').trim()) {
    return res.status(400).json({ error: 'Espécie, porte e descrição do local são obrigatórios.' })
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'A localização GPS do animal é obrigatória e inválida.' })
  }
  const fotosSeguras = Array.isArray(fotos)
    ? fotos.filter((foto) => typeof foto === 'string' && foto.startsWith('data:image/')).slice(0, 6)
    : []
  const statusPermitidos = new Set(['encontrado', 'a_caminho', 'no_curral', 'encerrado'])
  const statusSeguro = statusPermitidos.has(status) ? status : 'encontrado'
  try {
    const result = await query(
      `UPDATE curral_registros
       SET especie = $1, porte = $2, sexo = $3, identificacao = $4,
           local_descricao = $5, observacoes = $6, latitude = $7, longitude = $8,
           precisao_gps = $9, capturado_em = $10, fotos = $11, status = $12
       WHERE id = $13
       RETURNING *`,
      [
        String(especie).trim(), String(porte).trim(), sexo || null, identificacao || null,
        String(local_descricao).trim(), observacoes || null, lat, lng,
        Number.isFinite(Number(precisao_gps)) ? Number(precisao_gps) : null,
        String(capturado_em || new Date().toISOString()), JSON.stringify(fotosSeguras),
        statusSeguro, req.params.id,
      ]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Registro do Curral não encontrado.' })
    broadcastParaTodos({ tipo: 'curral_atualizado' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('PUT /api/curral/:id error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/procon', async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, status, dados, created_at, atualizado_em
       FROM procon_relatorios
       ORDER BY created_at DESC
       LIMIT 100`
    )
    res.json(result.rows)
  } catch (err) {
    console.error('GET /api/procon error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/procon', async (req, res) => {
  const { id, status, criado_por, dados } = req.body || {}
  if (!id || !dados || typeof dados !== 'object') {
    return res.status(400).json({ error: 'Documento Procon inválido.' })
  }
  const statusSeguro = new Set(['rascunho', 'pendente', 'finalizado', 'enviado']).has(status) ? status : 'pendente'
  const identificacao = dados.identificacao || {}
  try {
    const result = await query(
      `INSERT INTO procon_relatorios
        (id, tipo_documento, numero_processo, status, dados, criado_por, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         tipo_documento = EXCLUDED.tipo_documento,
         numero_processo = EXCLUDED.numero_processo,
         status = EXCLUDED.status,
         dados = EXCLUDED.dados,
         atualizado_em = NOW()
       RETURNING id, status, dados, created_at, atualizado_em`,
      [
        String(id),
        identificacao.tipoDocumento || 'termo_constatacao',
        identificacao.numeroProcesso || null,
        statusSeguro,
        JSON.stringify({ ...dados, id: String(id), status: statusSeguro }),
        criado_por || identificacao.agente || null,
      ]
    )
    broadcastParaTodos({ tipo: 'procon_atualizado' })
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/procon error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/procon/:id/enviar', async (req, res) => {
  try {
    const result = await query(
      `UPDATE procon_relatorios
       SET status = 'enviado',
           dados = jsonb_set(COALESCE(dados, '{}'::jsonb), '{status}', '"enviado"'::jsonb),
           atualizado_em = NOW()
       WHERE id = $1
       RETURNING id, status, dados, created_at, atualizado_em`,
      [req.params.id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Documento Procon não encontrado.' })
    broadcastParaTodos({ tipo: 'procon_atualizado' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('PUT /api/procon/:id/enviar error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Planejamentos ────────────────────────────────────────────────────────────
app.get('/api/planejamentos', async (_req, res) => {
  try {
    const result = await query('SELECT * FROM planejamentos ORDER BY criado_em DESC')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/planejamentos', async (req, res) => {
  try {
    const p = req.body
    console.log(`[planejamentos POST] id=${p.id} status=${p.status} conclusao=${p.conclusao ?? ''}`)
    // Se a atividade já existe e está concluída, preserva status e conclusão
    await query(
      `INSERT INTO planejamentos (id, tipo, nome, descricao, local, data_inicio, data_fim, horario, horario_fim, publico_estimado, status, equipe, agentes_defesa_civil, materiais, itens_mapa, pontos_extras, lat, lng, observacoes, risco, criado_por, criado_em, conclusao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       ON CONFLICT (id) DO UPDATE SET
         tipo=$2, nome=$3, descricao=$4, local=$5, data_inicio=$6, data_fim=$7,
         horario=$8, horario_fim=$9, publico_estimado=$10,
         status=CASE WHEN planejamentos.status='concluido' THEN planejamentos.status ELSE $11 END,
         equipe=$12, agentes_defesa_civil=$13, materiais=$14, itens_mapa=$15, pontos_extras=$16,
         lat=$17, lng=$18, observacoes=$19, risco=$20, criado_por=$21,
         conclusao=CASE WHEN planejamentos.status='concluido' THEN planejamentos.conclusao ELSE $23 END`,
      [p.id, p.tipo, p.nome, p.descricao, p.local, p.data_inicio, p.data_fim, p.horario, p.horario_fim,
       p.publico_estimado, p.status,
       JSON.stringify(p.equipe || []), JSON.stringify(p.agentes_defesa_civil || []),
       JSON.stringify(p.materiais || []), JSON.stringify(p.itens_mapa || []),
       JSON.stringify(p.pontos_extras || []),
       p.lat, p.lng, p.observacoes, p.risco, p.criado_por, p.criado_em || new Date().toISOString(),
       p.conclusao || null]
    )
    broadcastParaTodos({ tipo: 'planejamentos_atualizados' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/planejamentos/:id/status', async (req, res) => {
  try {
    const { id } = req.params
    const { status, conclusao } = req.body
    // UPDATE atômico: só altera se não estiver concluído (ou se estiver confirmando a própria conclusão)
    const result = await query(
      `UPDATE planejamentos
         SET status=$1, conclusao=$2
       WHERE id=$3
         AND (status <> 'concluido' OR $1 = 'concluido')
       RETURNING id, status, conclusao`,
      [status, conclusao ?? null, id]
    )
    if (result.rowCount === 0) {
      // Nenhuma linha atualizada — verifica se o registro existe
      const existe = await query(`SELECT status FROM planejamentos WHERE id=$1`, [id])
      if (!existe.rows[0]) return res.status(404).json({ error: 'Planejamento não encontrado' })
      return res.status(409).json({ error: 'Atividade já concluída — status não pode ser alterado.' })
    }
    broadcastParaTodos({ tipo: 'planejamentos_atualizados' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/planejamentos/:id', async (req, res) => {
  try {
    await query('DELETE FROM planejamentos WHERE id = $1', [req.params.id])
    broadcastParaTodos({ tipo: 'planejamentos_atualizados' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Radar Codap — lembretes e notificações compartilhados entre os agentes ─
app.get('/api/radar-bilhetes', async (_req, res) => {
  try {
    const result = await query('SELECT * FROM radar_bilhetes ORDER BY data ASC, hora ASC, criado_em ASC')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/radar-bilhetes', async (req, res) => {
  try {
    const { id, texto, data, hora, prioridade, criado_por, tipo = 'lembrete', agentes_envolvidos = [] } = req.body
    if (!id || !texto?.trim() || !data || !hora || !criado_por) return res.status(400).json({ error: 'Registro incompleto' })
    const agentes = Array.isArray(agentes_envolvidos) ? agentes_envolvidos.filter(Boolean) : []
    if (agentes.length === 0) return res.status(400).json({ error: 'Marque pelo menos um agente para receber o registro.' })
    const result = await query(
      `INSERT INTO radar_bilhetes (id, texto, data, hora, prioridade, criado_por, tipo, agentes_envolvidos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         texto = EXCLUDED.texto,
         data = EXCLUDED.data,
         hora = EXCLUDED.hora,
         prioridade = EXCLUDED.prioridade,
          tipo = EXCLUDED.tipo,
          agentes_envolvidos = EXCLUDED.agentes_envolvidos
       RETURNING *`,
      [id, texto.trim(), data, hora, prioridade || 'normal', criado_por, tipo === 'notificacao' ? 'notificacao' : 'lembrete', agentes]
    )
    broadcastParaTodos({ tipo: 'radar_bilhetes_atualizados' })
    res.status(201).json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/radar-bilhetes/:id/confirmar', async (req, res) => {
  try {
    const agente = typeof req.body?.agente === 'string' ? req.body.agente.trim() : ''
    const confirmado = req.body?.confirmado === true
    if (!agente) return res.status(400).json({ error: 'Agente obrigatório' })

    const existente = await query(
      'SELECT * FROM radar_bilhetes WHERE id = $1',
      [req.params.id],
    )
    const registro = existente.rows[0]
    if (!registro) return res.status(404).json({ error: 'Notificação não encontrada' })

    const envolvidos = Array.isArray(registro.agentes_envolvidos) ? registro.agentes_envolvidos : []
    if (!envolvidos.includes(agente)) {
      return res.status(403).json({ error: 'Este agente não foi marcado na notificação' })
    }

    const confirmacoesAtuais = Array.isArray(registro.confirmacoes_agentes)
      ? registro.confirmacoes_agentes
      : []
    const entrada = { agente, confirmado, confirmedAt: new Date().toISOString() }
    const indice = confirmacoesAtuais.findIndex((item) => item?.agente === agente)
    const confirmacoes = [...confirmacoesAtuais]
    if (indice >= 0) confirmacoes[indice] = entrada
    else confirmacoes.push(entrada)

    const atualizado = await query(
      `UPDATE radar_bilhetes
       SET confirmacoes_agentes = $1::jsonb
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(confirmacoes), req.params.id],
    )
    const registroAtualizado = atualizado.rows[0]

    broadcastParaTodos({
      tipo: 'radar_confirmacao',
      id: req.params.id,
      agente,
      confirmado,
      criadoPor: registro.criado_por,
      confirmacoesAgentes: confirmacoes,
    })

    if (registro.criado_por && registro.criado_por !== agente) {
      const payload = {
        title: confirmado ? '✅ Radar Codap — presença confirmada' : '❌ Radar Codap — presença recusada',
        body: confirmado
          ? `${agente} confirmou presença: ${registro.texto}`
          : `${agente} informou que não poderá ir: ${registro.texto}`,
        tag: `radar-confirmacao-${req.params.id}-${agente.replace(/\s+/g, '-')}`,
        tipo: 'radar_confirmacao',
        url: '/',
      }
      enviarPushParaAgentes([registro.criado_por], payload, agente).catch(() => {})
    }

    res.json(registroAtualizado)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/radar-bilhetes/:id/ciente', async (req, res) => {
  try {
    const agente = typeof req.body?.agente === 'string' ? req.body.agente.trim() : ''
    if (!agente) return res.status(400).json({ error: 'Agente obrigatório' })

    const existente = await query('SELECT * FROM radar_bilhetes WHERE id = $1', [req.params.id])
    const registro = existente.rows[0]
    if (!registro) return res.status(404).json({ error: 'Lembrete não encontrado' })

    const envolvidos = Array.isArray(registro.agentes_envolvidos) ? registro.agentes_envolvidos : []
    if (!envolvidos.includes(agente)) {
      return res.status(403).json({ error: 'Este agente não foi marcado no lembrete' })
    }

    const confirmacoesAtuais = Array.isArray(registro.confirmacoes_agentes)
      ? registro.confirmacoes_agentes
      : []
    const confirmacoes = [
      ...confirmacoesAtuais.filter((item) => item?.agente !== agente),
      { agente, confirmado: true, confirmedAt: new Date().toISOString() },
    ]
    const atualizado = await query(
      `UPDATE radar_bilhetes
       SET confirmacoes_agentes = $1::jsonb
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(confirmacoes), req.params.id],
    )

    broadcastParaTodos({
      tipo: 'radar_bilhetes_atualizados',
      id: req.params.id,
      agente,
    })
    res.json(atualizado.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/push/radar', async (req, res) => {
  try {
    const { agentes, texto, data, hora, prioridade, remetente, notificacaoId } = req.body || {}
    if (!Array.isArray(agentes) || agentes.length === 0 || !texto) return res.json({ enviados: 0 })
    const payload = {
      title: `🔔 Radar Codap — novo ${req.body?.registroTipo === 'lembrete' ? 'lembrete' : 'aviso'}`,
      body: `${data || ''} às ${hora || ''} · ${texto}`,
      tag: `radar-${notificacaoId || Date.now()}`,
      tipo: 'radar_notificacao',
      url: '/',
      prioridade: prioridade || 'normal',
      remetente: remetente || '',
    }
    const enviados = await enviarPushParaAgentes(agentes, payload, remetente || null)
    res.json({ enviados })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/atividades-dia', async (req, res) => {
  try {
    const data = String(req.query.data || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: 'Data inválida' })
    const checklists = await query(
      `SELECT id, data_checklist, km, placa, motorista, itens, created_at
       FROM checklists_viatura WHERE data_checklist::text LIKE $1 ORDER BY created_at DESC`,
      [`${data}%`],
    )
    const checklistsFerramentas = await query(
      `SELECT cf.id, cf.ferramenta_id, cf.quantidade_cadastrada, cf.quantidade_conferida,
              cf.condicao, cf.item_faltante, cf.justificativa, cf.realizado_por, cf.data_checklist, cf.created_at,
              m.nome AS ferramenta_nome
       FROM checklists_ferramental cf
       LEFT JOIN materiais m ON m.id = cf.ferramenta_id
       WHERE cf.data_checklist::date = $1::date
       ORDER BY cf.created_at DESC`,
      [data],
    )
    const ferramentasCatalogo = await query(
      `SELECT id, nome, quantidade
       FROM materiais
       WHERE categoria = 'ferramental'
       ORDER BY nome ASC`,
    )
    const ocorrencias = await query(
      `SELECT id, natureza, endereco, agentes, responsavel_registro, created_at, hora_inicio
       FROM ocorrencias
       WHERE (data_ocorrencia::text LIKE $1 OR created_at::date = $2::date)
       ORDER BY created_at DESC`,
      [`${data}%`, data],
    )
    res.json({
      checklists: checklists.rows.map(row => ({
        ...row,
        agente: row.motorista || 'Agente não informado',
        hora: String(row.data_checklist || '').includes('T')
          ? String(row.data_checklist).slice(11, 16)
          : new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        nivelCombustivel: row.itens?.nivelCombustivel || '',
      })),
      checklistsFerramentas: checklistsFerramentas.rows.map(row => ({
        id: row.id,
        ferramentaId: row.ferramenta_id,
        agente: row.realizado_por || 'Agente não informado',
        ferramentaNome: row.ferramenta_nome || 'Ferramenta não informada',
        quantidadeCadastrada: Number(row.quantidade_cadastrada || 0),
        quantidadeConferida: Number(row.quantidade_conferida || 0),
        condicao: row.condicao || '',
        itemFaltante: row.item_faltante || '',
        justificativa: row.justificativa || '',
        data_checklist: row.data_checklist,
        created_at: row.created_at,
      })),
      ferramentasCatalogo: ferramentasCatalogo.rows.map(row => ({
        id: row.id,
        nome: row.nome,
        quantidade: Number(row.quantidade || 1),
      })),
      ocorrencias: ocorrencias.rows.map(row => ({
        ...row,
        agente: row.responsavel_registro || (Array.isArray(row.agentes) ? row.agentes[0] : null) || 'Agente não informado',
        hora: row.hora_inicio || new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/radar-bilhetes/:id', async (req, res) => {
  try {
    const agente = typeof req.body?.agente === 'string' ? req.body.agente.trim() : ''
    const concluido = typeof req.body?.concluido === 'boolean' ? req.body.concluido : null
    const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : null
    const data = typeof req.body?.data === 'string' ? req.body.data.trim() : null
    const hora = typeof req.body?.hora === 'string' ? req.body.hora.trim() : null
    const prioridade = typeof req.body?.prioridade === 'string' ? req.body.prioridade.trim() : null
    const agentesEnvolvidos = Array.isArray(req.body?.agentes_envolvidos)
      ? req.body.agentes_envolvidos.map(String)
      : null
    const result = await query(
      `UPDATE radar_bilhetes
       SET texto=COALESCE($1, texto),
           data=COALESCE($2, data),
           hora=COALESCE($3, hora),
           prioridade=COALESCE($4, prioridade),
           concluido=COALESCE($5, concluido),
           agentes_envolvidos=COALESCE($6::text[], agentes_envolvidos)
       WHERE id=$7
         AND (criado_por=$8 OR ($8='Arthur' AND criado_por='J'))
       RETURNING *`,
      [texto, data, hora, prioridade, concluido, agentesEnvolvidos, req.params.id, agente]
    )
    if (!result.rows[0]) return res.status(403).json({ error: 'Somente o agente que criou o bilhete pode alterá-lo' })
    broadcastParaTodos({ tipo: 'radar_bilhetes_atualizados' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/radar-bilhetes/:id', async (req, res) => {
  try {
    const agente = typeof req.body?.agente === 'string' ? req.body.agente.trim() : ''
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : ''
    const registro = await query('SELECT criado_por FROM radar_bilhetes WHERE id=$1', [req.params.id])
    if (!registro.rows[0]) return res.status(404).json({ error: 'Lembrete não encontrado' })
    const criador = String(registro.rows[0].criado_por || '')
    const senhasAgentes = {
      A: '301067', B: '1234', C: '0620', D: '8228', E: '1210',
      F: '1122', G: '1234', H: '1950', I: '2806', J: '3004', Arthur: '1234',
    }
    const podeGerenciar = criador === agente || (agente === 'Arthur' && criador === 'J')
    if (!podeGerenciar || senhasAgentes[agente] !== senha) {
      return res.status(403).json({ error: 'Informe a senha do agente autorizado a gerenciar este registro' })
    }
    const result = await query(
      `DELETE FROM radar_bilhetes
       WHERE id=$1 AND (criado_por=$2 OR ($2='Arthur' AND criado_por='J'))
       RETURNING id`,
      [req.params.id, agente],
    )
    if (!result.rows[0]) return res.status(403).json({ error: 'Somente o agente que criou o bilhete pode apagá-lo' })
    broadcastParaTodos({ tipo: 'radar_bilhetes_atualizados' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Confirmação de presença no planejamento ───────────────────────────────
app.post('/api/planejamentos/:id/confirmar', async (req, res) => {
  try {
    const { agente, confirmado, criador } = req.body
    const { id } = req.params
    const result = await query('SELECT confirmacoes_agentes, nome FROM planejamentos WHERE id = $1', [id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Planejamento não encontrado' })
    let confirmacoes = Array.isArray(result.rows[0].confirmacoes_agentes) ? result.rows[0].confirmacoes_agentes : []
    const idx = confirmacoes.findIndex(c => c.agente === agente)
    const entrada = { agente, confirmado, confirmedAt: new Date().toISOString() }
    if (idx >= 0) confirmacoes[idx] = entrada
    else confirmacoes.push(entrada)
    await query('UPDATE planejamentos SET confirmacoes_agentes = $1 WHERE id = $2', [JSON.stringify(confirmacoes), id])
    broadcastParaTodos({ tipo: 'planejamentos_atualizados' })
    if (criador) {
      const planoNome = result.rows[0].nome || 'Planejamento'
      const payload = JSON.stringify({
        title: confirmado ? '✅ Presença confirmada' : '❌ Presença recusada',
        body: confirmado
          ? `${agente} confirmou presença em: ${planoNome}`
          : `${agente} não poderá comparecer em: ${planoNome}`,
        tag: `confirmacao-${id}-${agente.replace(/\s+/g, '-')}`,
        tipo: 'confirmacao',
        url: '/',
      })
      enviarPushParaAgentes([criador], payload, agente).catch(() => {})
    }
    res.json({ success: true, confirmacoes })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Fotos do evento — PUT substitui tudo atomicamente ────────────────────
app.put('/api/planejamentos/:id/fotos', async (req, res) => {
  try {
    const { fotos } = req.body
    const { id } = req.params
    const result = await query('SELECT id FROM planejamentos WHERE id = $1', [id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Planejamento não encontrado' })
    const arr = Array.isArray(fotos) ? fotos : []
    await query('UPDATE planejamentos SET fotos_evento = $1 WHERE id = $2', [JSON.stringify(arr), id])
    broadcastParaTodos({ tipo: 'planejamentos_atualizados' })
    res.json({ success: true, fotos: arr })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST legado — mantido por compatibilidade (append) ────────────────────
app.post('/api/planejamentos/:id/fotos', async (req, res) => {
  try {
    const { fotos } = req.body
    const { id } = req.params
    const result = await query('SELECT fotos_evento FROM planejamentos WHERE id = $1', [id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Planejamento não encontrado' })
    const existentes = Array.isArray(result.rows[0].fotos_evento) ? result.rows[0].fotos_evento : []
    const todas = [...existentes, ...(Array.isArray(fotos) ? fotos : [])]
    await query('UPDATE planejamentos SET fotos_evento = $1 WHERE id = $2', [JSON.stringify(todas), id])
    broadcastParaTodos({ tipo: 'planejamentos_atualizados' })
    res.json({ success: true, fotos: todas })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Remover foto individual do evento ────────────────────────────────────
app.delete('/api/planejamentos/:id/fotos/:idx', async (req, res) => {
  try {
    const { id, idx } = req.params
    const result = await query('SELECT fotos_evento FROM planejamentos WHERE id = $1', [id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Planejamento não encontrado' })
    const fotos = Array.isArray(result.rows[0].fotos_evento) ? result.rows[0].fotos_evento : []
    fotos.splice(Number(idx), 1)
    await query('UPDATE planejamentos SET fotos_evento = $1 WHERE id = $2', [JSON.stringify(fotos), id])
    broadcastParaTodos({ tipo: 'planejamentos_atualizados' })
    res.json({ success: true, fotos })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Push: notificar agentes escalados ────────────────────────────────────
app.post('/api/push/escala', async (req, res) => {
  try {
    const { agentes, planoNome, planoId, remetente, planoTipo, planoData, planoHorario } = req.body
    if (!Array.isArray(agentes) || agentes.length === 0) return res.json({ enviados: 0 })
    const tipoLabel = { evento: 'Evento', operacao: 'Operação', simulado: 'Simulado', emergencia: 'Emergência' }[planoTipo] || 'Planejamento'
    const dataInfo = planoData ? ` — ${new Date(planoData + 'T12:00:00').toLocaleDateString('pt-BR')}` : ''
    const horarioInfo = planoHorario ? ` às ${planoHorario}` : ''
    const remetenteInfo = remetente ? `${remetente} convocou você` : 'Você foi escalado'
    const notifBody = `${remetenteInfo} para o ${tipoLabel}: ${planoNome}${dataInfo}${horarioInfo}. Confirme sua presença no app.`
    const payload = JSON.stringify({
      title: '🗓️ Convocação — CODAP',
      body: notifBody,
      tag: `escala-${planoId}`,
      tipo: 'escala',
      url: '/',
    })
    const enviados = await enviarPushParaAgentes(agentes, payload, remetente || null)
    res.json({ enviados })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Escala ──────────────────────────────────────────────────────────────────
app.get('/api/escala', async (_req, res) => {
  try {
    const result = await query('SELECT data, updated_at FROM escala_estado WHERE id = 1')
    if (!result.rows[0]) return res.json(null)
    // Inclui updated_at junto com os dados para que o cliente possa comparar timestamps
    res.json({ ...result.rows[0].data, updated_at: result.rows[0].updated_at })
  } catch (err) {
    console.error('GET /api/escala error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/escala', async (req, res) => {
  try {
    const data = req.body && typeof req.body === 'object' ? req.body : {}
    await query(
      `INSERT INTO escala_estado (id, data, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
      [JSON.stringify(data)]
    )
    broadcastParaTodos({ tipo: 'escala_atualizada' })
    res.json({ success: true })
  } catch (err) {
    console.error('PUT /api/escala error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/health', (req, res) => res.json({ ok: true }))

// ── Focos de Incêndio — NASA FIRMS + Earth Engine ─────────────────────────
// Fontes: GOES-19 ABI · VIIRS-SNPP · VIIRS-NOAA20 · VIIRS-NOAA21 ·
//          MODIS Terra · MODIS Aqua
//
// Cache para resposta rápida:
//   Polar → TTL 25 min (VIIRS + MODIS, sobrevoo ~2×/dia — não muda tão rápido)
//   GOES-19 → Earth Engine mantém a coleção com cadência de 10 min e o
//              resultado do monitoramento fica em cache por 30 min.
let polarCache = { data: null, ts: 0 }
let earthEngineCache = { data: null, ts: 0 }
let earthEngineMonitoramentoCache = { data: null, ts: 0 }
const POLAR_TTL = 25 * 60 * 1000   // 25 min
const FOCOS_PERIODO_DIAS = 3
// O GOES-19 atualiza o produto de fogo a cada ~10 minutos. O cache não
// pode ser maior que essa cadência, senão o mapa continua mostrando dados
// antigos mesmo com a autenticação do Earth Engine funcionando.
const EARTH_ENGINE_TTL = 10 * 60 * 1000
const EARTH_ENGINE_MONITORAMENTO_TTL = 10 * 60 * 1000

const FONTES_FOGO_CATALOGO = [
  {
    id: 'goes-19-fire',
    nome: 'GOES-R / GOES-19 ABI',
    descricao: 'Evolução temporal do fogo pelo produto Fire/Hot Spot Characterization.',
    frequencia: '10 min',
    tipo: 'Earth Engine',
  },
  {
    id: 'viirs-noaa20-fire',
    nome: 'NOAA-20 VIIRS',
    descricao: 'Focos de alta resolução espacial em passagem orbital.',
    frequencia: 'NRT',
    tipo: 'NASA FIRMS',
  },
  {
    id: 'viirs-snpp-fire',
    nome: 'S-NPP VIIRS',
    descricao: 'Focos de alta resolução espacial em passagem orbital.',
    frequencia: 'NRT',
    tipo: 'NASA FIRMS',
  },
  {
    id: 'modis-terra-fire',
    nome: 'Terra MODIS',
    descricao: 'Confirmação e complemento das detecções de fogo ativo.',
    frequencia: 'NRT',
    tipo: 'NASA FIRMS',
  },
  {
    id: 'modis-aqua-fire',
    nome: 'Aqua MODIS',
    descricao: 'Confirmação e complemento das detecções de fogo ativo.',
    frequencia: 'NRT',
    tipo: 'NASA FIRMS',
  },
]

// Polígono oficial simplificado do município de Conselheiro Lafaiete - MG
// (IBGE 3118304; redução preservando a forma do limite municipal).
const CONSELHEIRO_LAFAIETE_POLIGONO = [
  [-20.65880, -43.92390], [-20.65840, -43.91770], [-20.66480, -43.91540],
  [-20.66000, -43.90870], [-20.66650, -43.90290], [-20.66530, -43.89400],
  [-20.67210, -43.88520], [-20.67170, -43.88030], [-20.67660, -43.87510],
  [-20.68940, -43.87180], [-20.69090, -43.86950], [-20.68940, -43.86370],
  [-20.69910, -43.85290], [-20.70150, -43.85260], [-20.70490, -43.85660],
  [-20.70840, -43.85560], [-20.71070, -43.85010], [-20.71340, -43.84950],
  [-20.70930, -43.84740], [-20.70990, -43.84570], [-20.72000, -43.83920],
  [-20.72250, -43.83200], [-20.72630, -43.83240], [-20.73310, -43.82660],
  [-20.73710, -43.80610], [-20.74160, -43.80280], [-20.74660, -43.80260],
  [-20.75190, -43.80770], [-20.75620, -43.82030], [-20.77250, -43.81940],
  [-20.78360, -43.80440], [-20.78440, -43.79690], [-20.79050, -43.79290],
  [-20.79560, -43.79290], [-20.80100, -43.77280], [-20.79580, -43.76840],
  [-20.78960, -43.76850], [-20.78380, -43.75980], [-20.77890, -43.75800],
  [-20.77390, -43.75690], [-20.76710, -43.76120], [-20.76330, -43.75820],
  [-20.75490, -43.76070], [-20.75830, -43.75520], [-20.75580, -43.74170],
  [-20.74750, -43.72980], [-20.74410, -43.71910], [-20.73870, -43.71730],
  [-20.73030, -43.70910], [-20.72880, -43.70060], [-20.72290, -43.69490],
  [-20.72350, -43.69210], [-20.71320, -43.69190], [-20.70970, -43.69720],
  [-20.70390, -43.69920], [-20.69720, -43.69780], [-20.69480, -43.69410],
  [-20.68310, -43.69450], [-20.67120, -43.68820], [-20.66290, -43.68800],
  [-20.64710, -43.70170], [-20.64360, -43.70230], [-20.63930, -43.71050],
  [-20.63600, -43.70900], [-20.63700, -43.70600], [-20.63390, -43.69720],
  [-20.62580, -43.69020], [-20.63090, -43.68090], [-20.62150, -43.67880],
  [-20.61470, -43.68010], [-20.60790, -43.68750], [-20.59780, -43.68990],
  [-20.59610, -43.70170], [-20.58810, -43.71430], [-20.58820, -43.72000],
  [-20.59270, -43.72780], [-20.59180, -43.73260], [-20.60050, -43.74300],
  [-20.59880, -43.74570], [-20.58680, -43.75600], [-20.57970, -43.75880],
  [-20.57620, -43.75710], [-20.57590, -43.75930], [-20.56880, -43.76180],
  [-20.56720, -43.76770], [-20.57010, -43.77350], [-20.56390, -43.77420],
  [-20.56130, -43.78110], [-20.55280, -43.78320], [-20.55340, -43.78670],
  [-20.53800, -43.79980], [-20.54560, -43.80950], [-20.54760, -43.80860],
  [-20.55010, -43.81290], [-20.55580, -43.81330], [-20.57080, -43.80940],
  [-20.57360, -43.81150], [-20.57770, -43.80450], [-20.58630, -43.80570],
  [-20.59220, -43.79890], [-20.59290, -43.80960], [-20.59810, -43.81170],
  [-20.59240, -43.82250], [-20.60360, -43.83050], [-20.60480, -43.83490],
  [-20.60180, -43.83680], [-20.60130, -43.84510], [-20.60380, -43.85080],
  [-20.61290, -43.85480], [-20.61850, -43.87270], [-20.61080, -43.88340],
  [-20.59830, -43.88880], [-20.60010, -43.89330], [-20.59550, -43.89670],
  [-20.59350, -43.90360], [-20.59800, -43.90380], [-20.60360, -43.90950],
  [-20.60490, -43.90640], [-20.61260, -43.90830], [-20.61730, -43.91380],
  [-20.62460, -43.91660], [-20.62980, -43.92600], [-20.63620, -43.92890],
  [-20.63760, -43.92760], [-20.64200, -43.92990], [-20.64420, -43.92360],
  [-20.64990, -43.92590], [-20.65480, -43.92240],
]

function pontoNoCidade(lat, lng) {
  const poly = CONSELHEIRO_LAFAIETE_POLIGONO
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]
    const [yj, xj] = poly[j]
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function fonteFirmsPorSatelite(fonteNome, satelite) {
  const nome = String(satelite || '').toLowerCase()
  if (fonteNome === 'MODIS') {
    if (nome.includes('aqua')) return 'MODIS-AQUA'
    if (nome.includes('terra')) return 'MODIS-TERRA'
    return 'MODIS'
  }
  if (fonteNome === 'VIIRS-N20') return 'VIIRS-NOAA20'
  if (fonteNome === 'VIIRS-N21') return 'VIIRS-NOAA21'
  if (fonteNome === 'VIIRS-SNPP') return 'VIIRS-SNPP'
  return fonteNome
}

function parsearFirmsCsv(csv, fonteNome) {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',')
  const idx = (name) => headers.indexOf(name)
  return lines.slice(1).map(line => {
    const cols = line.split(',')
    const confRaw = (cols[idx('confidence')] || 'n').trim()
    let confidence = 'n'
    const confNum = parseInt(confRaw)
    if (!isNaN(confNum)) {
      if (fonteNome === 'MODIS') {
        // MODIS: 0-100 % de confiança
        confidence = confNum >= 70 ? 'h' : confNum >= 30 ? 'n' : 'l'
      } else {
        // GOES: 10/11=high, 30=nominal, 31-33=low; >65=high (G19FRP range)
        confidence = confNum <= 11 ? 'h' : confNum <= 30 ? 'n' : confNum <= 65 ? 'l' : 'h'
      }
    } else {
      const c0 = confRaw.toLowerCase()[0]
      confidence = c0 === 'h' ? 'h' : c0 === 'l' ? 'l' : 'n'
    }
    const satelite = cols[idx('satellite')] || fonteNome
    return {
      lat:      parseFloat(cols[idx('latitude')]),
      lng:      parseFloat(cols[idx('longitude')]),
      confidence,
      frp:      parseFloat(cols[idx('frp')]) || 0,
      data:     cols[idx('acq_date')] || '',
      hora:     cols[idx('acq_time')] || '',
      satelite,
      fonte:    fonteFirmsPorSatelite(fonteNome, satelite),
    }
  }).filter(f => !isNaN(f.lat) && !isNaN(f.lng))
}

function montarCatalogoFontesFogo(focos, earthEngine, fontesFirms = []) {
  const fontesPresentes = new Set(fontesFirms)
  const camadasEE = new Map((earthEngine?.camadas || []).map(camada => [camada.id, camada]))
  const focosPorFonte = focos.reduce((acc, foco) => {
    acc.set(foco.fonte, (acc.get(foco.fonte) || 0) + 1)
    return acc
  }, new Map())

  return FONTES_FOGO_CATALOGO.map(fonte => {
    const camada = camadasEE.get(fonte.id)
    const fonteFirms = {
      'viirs-noaa20-fire': 'VIIRS-NOAA20',
      'viirs-snpp-fire': 'VIIRS-SNPP',
      'modis-terra-fire': 'MODIS-TERRA',
      'modis-aqua-fire': 'MODIS-AQUA',
    }[fonte.id]
    const disponivel = Boolean(
      (fonteFirms && fontesPresentes.has(fonteFirms)) ||
      (camada && camada.url),
    )
    return {
      ...fonte,
      disponivel,
      quantidade: (fonteFirms
        ? focosPorFonte.get(fonteFirms)
        : focos.filter(foco => String(foco.fonte).includes(fonte.id.replace('-fire', '').toUpperCase())).length) || 0,
      atualizadoEm: camada?.url ? earthEngine.atualizadoEm : null,
    }
  })
}

// Remove focos duplicados detectados por múltiplos satélites no mesmo ponto.
// Distância < 0.01° (~1 km) = mesmo foco; mantém o de maior FRP.
function deduplicarFocos(focos) {
  const out = []
  for (const f of focos) {
    const dup = out.find(r => Math.abs(r.lat - f.lat) < 0.01 && Math.abs(r.lng - f.lng) < 0.01)
    if (dup) { if (f.frp > dup.frp) Object.assign(dup, f) }
    else out.push({ ...f })
  }
  return out
}

async function buscarFocosEarthEngine() {
  if (!process.env.EARTH_ENGINE_SERVICE_ACCOUNT_JSON) {
    return { configurado: false, erro: 'EARTH_ENGINE_SERVICE_ACCOUNT_JSON não configurada' }
  }

  const agora = Date.now()
  if (earthEngineCache.data && agora - earthEngineCache.ts < EARTH_ENGINE_TTL) {
    return { ...earthEngineCache.data, cache: 'hit' }
  }

  try {
    const { stdout } = await execFileAsync(
      pythonBin,
      [join(__dirname, 'earth-engine-focos.py')],
      {
        env: process.env,
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
      },
    )
    const dados = JSON.parse(stdout)
    const resultado = {
      focos: Array.isArray(dados.focos)
        ? dados.focos.filter(f => pontoNoCidade(f.lat, f.lng))
        : [],
      camadas: Array.isArray(dados.camadas) ? dados.camadas : [],
      disponibilidade: Array.isArray(dados.disponibilidade) ? dados.disponibilidade : [],
      fonte: 'EARTH-ENGINE-MULTISATELITE',
      projeto: dados.projeto || null,
      periodo: dados.periodo || null,
      configurado: true,
    }
    earthEngineCache = { data: resultado, ts: agora }
    return resultado
  } catch (e) {
    const detalhe = e?.stderr?.trim() || e?.message || 'falha desconhecida'
    console.warn('[earth-engine] consulta falhou:', detalhe)
    return { configurado: false, erro: detalhe }
  }
}

async function buscarMonitoramentoEarthEngine() {
  if (!process.env.EARTH_ENGINE_SERVICE_ACCOUNT_JSON) {
    return { configurado: false, erro: 'EARTH_ENGINE_SERVICE_ACCOUNT_JSON não configurada' }
  }

  const agora = Date.now()
  if (earthEngineMonitoramentoCache.data && agora - earthEngineMonitoramentoCache.ts < EARTH_ENGINE_MONITORAMENTO_TTL) {
    return { ...earthEngineMonitoramentoCache.data, cache: 'hit' }
  }

  try {
    const { stdout } = await execFileAsync(
      pythonBin,
      [join(__dirname, 'earth-engine-focos.py'), 'monitoramento'],
      {
        env: process.env,
        timeout: 90000,
        maxBuffer: 5 * 1024 * 1024,
      },
    )
    const dados = JSON.parse(stdout)
    const resultado = {
      camadas: Array.isArray(dados.camadas) ? dados.camadas : [],
      indicadores: Array.isArray(dados.indicadores) ? dados.indicadores : [],
      erros: Array.isArray(dados.erros) ? dados.erros : [],
      semDados: Array.isArray(dados.semDados) ? dados.semDados : [],
      disponibilidade: Array.isArray(dados.disponibilidade) ? dados.disponibilidade : [],
      projeto: dados.projeto || null,
      periodo: dados.periodo || null,
      atualizadoEm: dados.atualizadoEm || new Date().toISOString(),
      configurado: true,
    }
    earthEngineMonitoramentoCache = { data: resultado, ts: agora }
    return resultado
  } catch (e) {
    const detalhe = e?.stderr?.trim() || e?.message || 'falha desconhecida'
    console.warn('[earth-engine-monitoramento] consulta falhou:', detalhe)
    return { configurado: false, camadas: [], indicadores: [], erros: [detalhe] }
  }
}

app.get('/api/monitoramento-incendio', async (_req, res) => {
  try {
    const resultado = await buscarMonitoramentoEarthEngine()
    res.json(resultado)
  } catch (e) {
    console.warn('[monitoramento-incendio]', e?.message)
    res.status(502).json({ configurado: false, camadas: [], indicadores: [], erros: [e?.message || 'falha desconhecida'] })
  }
})

// ── Planet — imagens de satélite sob demanda ────────────────────────────────
// Reutiliza o mesmo handler do Netlify para manter os contratos idênticos nos
// dois ambientes e manter PLANET_API_KEY exclusivamente no servidor.
app.get('/api/planet-focos', async (req, res) => {
  try {
    const resultado = await planetFocosHandler({
      httpMethod: req.method,
      queryStringParameters: req.query,
    })
    res.status(resultado.statusCode || 200)
    for (const [nome, valor] of Object.entries(resultado.headers || {})) {
      res.setHeader(nome, valor)
    }
    res.send(resultado.body || '')
  } catch (e) {
    console.warn('[planet-focos]', e?.message || e)
    res.status(502).json({
      configurado: true,
      fonte: 'PLANET',
      imagens: [],
      quantidade: 0,
      erro: e?.message || 'Falha na Planet API',
    })
  }
})

app.get('/api/focos-incendio', async (_req, res) => {
  try {
    const firmsKey = process.env.FIRMS_MAP_KEY
    const earthEngine = await buscarFocosEarthEngine()
    const earthEngineFocos = earthEngine.focos || []
    const earthEngineFontes = earthEngine.configurado
      ? (earthEngine.camadas || [])
        .filter(camada => camada.url)
        .map(camada => camada.nome)
      : []

    if (!firmsKey) {
      return res.json({
        focos: earthEngineFocos,
        configurado: earthEngine.configurado,
        fontes: earthEngineFontes,
        fontesMonitoramento: {
          firms: false,
          earthEngine: {
            configurado: earthEngine.configurado,
            erro: earthEngine.erro || null,
          },
        catalogo: montarCatalogoFontesFogo(
          earthEngineFocos,
          earthEngine,
          [],
        ),
        },
        msg: 'FIRMS_MAP_KEY não configurada',
      })
    }

    const now = Date.now()
    const polarOk = polarCache.data && now - polarCache.ts < POLAR_TTL

    // Cache polar válido → retorna sem chamar NASA.
    if (polarOk) {
      const focos = deduplicarFocos([
        ...polarCache.data.focos,
        ...earthEngineFocos,
      ])
      const fontesFirms = polarCache.data.fontes
      return res.json({
        focos,
        configurado: true,
        fontes: [...new Set([
          ...fontesFirms,
          ...earthEngineFontes,
        ])],
        atualizadoEm: polarCache.data.atualizadoEm,
        fontesMonitoramento: {
          firms: true,
          earthEngine: {
            configurado: earthEngine.configurado,
            erro: earthEngine.erro || null,
          },
          catalogo: montarCatalogoFontesFogo(
            focos,
            earthEngine,
            fontesFirms,
          ),
        },
        cache: 'hit',
      })
    }

    // bbox: oeste,sul,leste,norte — IBGE 3145901 com margem ~5 km
    const bbox = '-43.95,-20.83,-43.66,-20.51'
    const base = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}`
    const SIG = 8000 // timeout por satélite (ms)

    // Busca apenas o que precisa de atualização
    const tarefas = []
    if (!polarOk) {
      tarefas.push(
        fetch(`${base}/VIIRS_SNPP_NRT/${bbox}/${FOCOS_PERIODO_DIAS}`,   { signal: AbortSignal.timeout(SIG) }).then(r => ({ r, nome: 'VIIRS-SNPP',  label: 'VIIRS-SNPP'  })),
        fetch(`${base}/VIIRS_NOAA20_NRT/${bbox}/${FOCOS_PERIODO_DIAS}`, { signal: AbortSignal.timeout(SIG) }).then(r => ({ r, nome: 'VIIRS-N20',   label: 'VIIRS-NOAA20' })),
        fetch(`${base}/VIIRS_NOAA21_NRT/${bbox}/${FOCOS_PERIODO_DIAS}`, { signal: AbortSignal.timeout(SIG) }).then(r => ({ r, nome: 'VIIRS-N21',   label: 'VIIRS-NOAA21' })),
        fetch(`${base}/MODIS_NRT/${bbox}/${FOCOS_PERIODO_DIAS}`,          { signal: AbortSignal.timeout(SIG) }).then(r => ({ r, nome: 'MODIS',       label: 'MODIS'        })),
      )
    }

    const resultados = await Promise.allSettled(tarefas)
    let novosPolar = [], fontesPolar = []
    const brutos = {}

    for (const res of resultados) {
      if (res.status !== 'fulfilled') { console.warn('[focos-incendio] fetch falhou:', res.reason?.message); continue }
      const { r, nome, label } = res.value
      if (!r.ok) continue
      const focos = parsearFirmsCsv(await r.text(), nome)
      brutos[nome] = focos.length
      novosPolar.push(...focos)
      if (nome === 'MODIS') {
        // O CSV combinado do FIRMS traz a coluna satellite, permitindo
        // separar Terra e Aqua mesmo em uma única requisição.
        fontesPolar.push('MODIS-TERRA', 'MODIS-AQUA')
      } else {
        fontesPolar.push(fonteFirmsPorSatelite(nome, label))
      }
    }

    // Atualiza o cache polar apenas quando a NASA respondeu a pelo menos
    // uma das fontes. Assim, uma falha transitória não apaga a última leitura.
    if (!polarOk && fontesPolar.length > 0) {
      const fp = novosPolar.filter(f => pontoNoCidade(f.lat, f.lng))
      polarCache = { data: { focos: fp, fontes: fontesPolar }, ts: now }
    }

    const allFocos = [
      ...(polarCache.data?.focos || []),
      ...earthEngineFocos,
    ]
    const allFontes = [
      ...(polarCache.data?.fontes || []),
      ...earthEngineFontes,
    ]
    const focos = deduplicarFocos(allFocos)
    const atualizadoEm = new Date().toISOString()

    console.log(
      `[focos-incendio] SNPP:${brutos['VIIRS-SNPP']??'-'} N20:${brutos['VIIRS-N20']??'-'} N21:${brutos['VIIRS-N21']??'-'} MODIS:${brutos['MODIS']??'-'} → Conselheiro Lafaiete: ${focos.length}`
    )
    res.json({
      focos,
      configurado: true,
      fontes: [...new Set(allFontes)],
      atualizadoEm,
      fontesMonitoramento: {
        firms: true,
        earthEngine: {
          configurado: earthEngine.configurado,
          erro: earthEngine.erro || null,
        },
        catalogo: montarCatalogoFontesFogo(
          focos,
          earthEngine,
          allFontes,
        ),
      },
    })
  } catch (e) {
    console.warn('[focos-incendio]', e?.message)
    res.status(502).json({ focos: [], configurado: true, fontes: [], erro: e?.message })
  }
})

// ── SOS ─────────────────────────────────────────────────────────────────────
async function processarSosMensagem(msg) {
  const { id, agente, texto, audio, ts } = msg
  if (!id || !agente || (!texto && !audio)) return
  let existente = sosAtivos.get(id)
  if (!existente) {
    try {
      const r = await query('SELECT * FROM sos_ativos_db WHERE id=$1', [id])
      if (r.rows[0]) {
        const row = r.rows[0]
        existente = {
          id: row.id, agente: row.agente,
          lat: row.lat != null ? Number(row.lat) : null,
          lng: row.lng != null ? Number(row.lng) : null,
          bateria: row.bateria != null ? Number(row.bateria) : null,
          audio: row.audio ?? null,
          timestamp: Number(row.timestamp),
          visualizadores: Array.isArray(row.visualizadores) ? row.visualizadores : [],
          mensagens: Array.isArray(row.mensagens) ? row.mensagens : [],
        }
        sosAtivos.set(id, existente)
      }
    } catch (e) { console.warn('[SOS-MSG] fallback DB:', e?.message) }
  }
  if (!existente) return
  const msgs = Array.isArray(existente.mensagens) ? existente.mensagens : []
  const nova = { agente, texto: texto || '', ts: ts || Date.now() }
  if (audio) nova.audio = audio
  const novas = [...msgs, nova]
  sosAtivos.set(id, { ...existente, mensagens: novas })
  broadcastParaTodos({ tipo: 'sos-nova-mensagem', id, mensagens: novas }, null)
  query('UPDATE sos_ativos_db SET mensagens=$1 WHERE id=$2', [JSON.stringify(novas), id])
    .catch(e => console.warn('[SOS-DB] erro ao atualizar mensagens:', e?.message))
}

app.post('/api/sos', (req, res) => {
  const msg = req.body
  if (!msg || typeof msg !== 'object' || !msg.tipo || !msg.id) {
    return res.status(400).json({ error: 'Mensagem SOS inválida' })
  }
  try {
    if (msg.tipo === 'sos') processarSos(msg, null)
    else if (msg.tipo === 'sos-audio') processarSosAudio(msg, null)
    else if (msg.tipo === 'sos-cancelar') processarSosCancelar(msg, null)
    else if (msg.tipo === 'sos-mensagem') { processarSosMensagem(msg).catch(() => {}) }
    else return res.status(400).json({ error: `Tipo SOS desconhecido: ${msg.tipo}` })
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/sos error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Relatório de Vistoria ────────────────────────────────────────────────────
app.post('/api/relatorio-vistoria', async (req, res) => {
  try {
    let ocorrencia = req.body
    if (!ocorrencia || typeof ocorrencia !== 'object') {
      return res.status(400).json({ error: 'Dados da ocorrência não informados' })
    }
    if (ocorrencia.id && Number(ocorrencia.id) > 0) {
      try {
        const result = await query('SELECT * FROM ocorrencias WHERE id = $1', [Number(ocorrencia.id)])
        if (result.rows[0]) ocorrencia = result.rows[0]
      } catch (dbErr) {
        console.warn('Não foi possível buscar dados frescos do banco:', dbErr.message)
      }
    }
    const buffer = await gerarRelatorioVistoria(ocorrencia)
    const filename = relatorioFileName(ocorrencia)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.send(buffer)
  } catch (err) {
    console.error('POST /api/relatorio-vistoria error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Checklists Viatura ───────────────────────────────────────────────────────
app.get('/api/checklists/meses', async (req, res) => {
  try {
    const result = await query(
      `SELECT DISTINCT SUBSTRING(data_checklist, 1, 7) AS mes
       FROM checklists_viatura
       WHERE data_checklist IS NOT NULL AND LENGTH(data_checklist) >= 7
       ORDER BY mes DESC`
    )
    res.json(result.rows.map(r => r.mes).filter(Boolean))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/checklists', async (req, res) => {
  const CAMPOS_LEVES = 'id, data_checklist, km, placa, motorista, itens, observacoes, created_at, tem_foto_frontal, tem_foto_traseira, tem_foto_direita, tem_foto_esquerda'
  const SQL_LEVE = `SELECT id, data_checklist, km, placa, motorista, itens, observacoes, created_at,
    (foto_frontal IS NOT NULL AND foto_frontal <> '') AS tem_foto_frontal,
    (foto_traseira IS NOT NULL AND foto_traseira <> '') AS tem_foto_traseira,
    (foto_direita IS NOT NULL AND foto_direita <> '') AS tem_foto_direita,
    (foto_esquerda IS NOT NULL AND foto_esquerda <> '') AS tem_foto_esquerda
    FROM checklists_viatura`
  try {
    const { mes } = req.query
    let result
    if (mes) {
      result = await query(`${SQL_LEVE} WHERE data_checklist LIKE $1 ORDER BY created_at DESC`, [`${mes}%`])
    } else {
      result = await query(`${SQL_LEVE} ORDER BY created_at DESC`)
    }
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Busca fotos de múltiplos checklists em lote (para exportação Excel)
app.get('/api/checklists/fotos-lote', async (req, res) => {
  try {
    const raw = String(req.query.ids || '')
    const ids = raw.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0)
    if (ids.length === 0) return res.json([])
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    const result = await query(
      `SELECT id, foto_frontal, foto_traseira, foto_direita, foto_esquerda, fotos_avarias
       FROM checklists_viatura WHERE id IN (${placeholders})`,
      ids
    )
    res.json(result.rows)
  } catch (err) {
    console.error('GET /api/checklists/fotos-lote error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/checklists/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM checklists_viatura WHERE id = $1', [req.params.id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Checklist não encontrado' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/checklists', async (req, res) => {
  const { data_checklist, km, placa, motorista, fotos_avarias, foto_frontal, foto_traseira, foto_direita, foto_esquerda, itens, observacoes, assinatura_data } = req.body
  try {
    const result = await query(
      `INSERT INTO checklists_viatura (data_checklist, km, placa, motorista, fotos_avarias, foto_frontal, foto_traseira, foto_direita, foto_esquerda, itens, observacoes, assinatura_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [data_checklist, km || null, placa || null, motorista || null,
       JSON.stringify(Array.isArray(fotos_avarias) ? fotos_avarias : []),
       foto_frontal || null, foto_traseira || null, foto_direita || null, foto_esquerda || null,
       JSON.stringify(itens || {}), observacoes || null, assinatura_data || null]
    )
    broadcastParaTodos({ tipo: 'checklist_atualizado' })
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/checklists error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/checklists/:id', async (req, res) => {
  try {
    await query('DELETE FROM checklists_viatura WHERE id = $1', [req.params.id])
    broadcastParaTodos({ tipo: 'checklist_atualizado' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Materiais ────────────────────────────────────────────────────────────────
function broadcastMateriaisAtualizados() {
  broadcastParaTodos({ tipo: 'materiais_atualizados' })
}
function broadcastEmprestimosAtualizados() {
  broadcastParaTodos({ tipo: 'emprestimos_atualizados' })
}
function broadcastChecklistsFerramentalAtualizados() {
  broadcastParaTodos({ tipo: 'checklists_ferramental_atualizados' })
}

// Retorna lista de agentes online no momento (via REST, sem depender de timing do WS)
app.get('/api/agentes-online', (_req, res) => {
  res.json(getAgentesOnlineAtivos())
})

// Lista leve — SEM foto e foto_placa (só thumbnail) para não travar o carregamento
app.get('/api/materiais', async (_req, res) => {
  try {
    const result = await query(
      "SELECT id, nome, categoria, descricao, observacoes, foto_thumb, quantidade, tipo, created_at FROM materiais ORDER BY id" 
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Fotos em lote para exportação Excel — aceita ?ids=cod1,cod2,...
app.get('/api/materiais/fotos-lote', async (req, res) => {
  try {
    const raw = (req.query.ids || '').toString().trim()
    if (!raw) return res.json([])
    const ids = raw.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length === 0) return res.json([])
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    const result = await query(
      `SELECT id, foto, foto_placa FROM materiais WHERE id IN (${placeholders})`,
      ids
    )
    res.json(result.rows)
  } catch (err) {
    console.error('GET /api/materiais/fotos-lote error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Detalhe completo — inclui foto e foto_placa (carregado só quando o usuário abre o item)
app.get('/api/materiais/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM materiais WHERE id = $1', [req.params.id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Material não encontrado' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/materiais', async (req, res) => {
  const { id, nome, categoria, descricao, observacoes, foto, foto_placa, foto_thumb, quantidade, tipo } = req.body || {}
  if (!id || !nome) return res.status(400).json({ error: 'id e nome obrigatórios' })
  try {
    const result = await query(
      `INSERT INTO materiais (id, nome, categoria, descricao, observacoes, foto, foto_placa, foto_thumb, quantidade, tipo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, nome, categoria, descricao, observacoes, foto_thumb, quantidade, tipo, created_at`,
      [String(id).trim(), String(nome).trim(),
       categoria === 'ferramental' ? 'ferramental' : 'escritorio',
       descricao || null, observacoes || null,
       foto || null, foto_placa || null, foto_thumb || null, Math.max(1, quantidade || 1),
       tipo === 'ferramental' ? 'ferramental' : 'escritorio']
    )
    broadcastMateriaisAtualizados()
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Já existe material com código "${id}".` })
    console.error('POST /api/materiais error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/materiais/:id', async (req, res) => {
  const { nome, categoria, descricao, observacoes, foto, foto_placa, foto_thumb, quantidade, tipo } = req.body || {}
  const sets = []
  const vals = []
  let idx = 1
  if (typeof nome === 'string') { sets.push(`nome=$${idx++}`); vals.push(nome.trim()) }
  if (categoria !== undefined) {
    sets.push(`categoria=$${idx++}`)
    vals.push(categoria === 'ferramental' ? 'ferramental' : 'escritorio')
  }
  if (descricao !== undefined) { sets.push(`descricao=$${idx++}`); vals.push(descricao || null) }
  if (observacoes !== undefined) { sets.push(`observacoes=$${idx++}`); vals.push(observacoes || null) }
  if (foto !== undefined) { sets.push(`foto=$${idx++}`); vals.push(foto || null) }
  if (foto_placa !== undefined) { sets.push(`foto_placa=$${idx++}`); vals.push(foto_placa || null) }
  if (foto_thumb !== undefined) { sets.push(`foto_thumb=$${idx++}`); vals.push(foto_thumb || null) }
  if (quantidade !== undefined) { sets.push(`quantidade=$${idx++}`); vals.push(Math.max(1, quantidade || 1)) }
  if (tipo !== undefined) { sets.push(`tipo=$${idx++}`); vals.push(tipo === 'ferramental' ? 'ferramental' : 'escritorio') }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' })
  vals.push(req.params.id)
  try {
    const result = await query(
      `UPDATE materiais SET ${sets.join(', ')} WHERE id=$${idx}
       RETURNING id, nome, categoria, descricao, observacoes, foto_thumb, quantidade, tipo, created_at`,
      vals
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Material não encontrado' })
    broadcastMateriaisAtualizados()
    res.json(result.rows[0])
  } catch (err) {
    console.error('PATCH /api/materiais error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/ferramentas/:id/checklists', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM checklists_ferramental WHERE ferramenta_id=$1 ORDER BY data_checklist DESC',
      [req.params.id]
    )
    res.json(result.rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/ferramentas/:id/checklists', async (req, res) => {
  const { quantidade_verificada, condicao, justificativa_falta, realizado_por } = req.body || {}
  const qtd = Number(quantidade_verificada)
  if (!Number.isInteger(qtd) || qtd < 0 || !['boa', 'media', 'ruim'].includes(condicao)) {
    return res.status(400).json({ error: 'Quantidade e condição são obrigatórias' })
  }
  try {
    const result = await query(
      `INSERT INTO checklists_ferramentas
       (ferramenta_id, quantidade_verificada, condicao, justificativa_falta, realizado_por)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, qtd, condicao, justificativa_falta || null, realizado_por || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/materiais/:id', async (req, res) => {
  try {
    await query('DELETE FROM materiais WHERE id = $1', [req.params.id])
    broadcastMateriaisAtualizados()
    broadcastEmprestimosAtualizados()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Checklists de ferramental ────────────────────────────────────────────────
app.get('/api/ferramentas/:id/checklists', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM checklists_ferramental WHERE ferramenta_id = $1 ORDER BY data_checklist DESC',
      [req.params.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/ferramentas/checklists', async (req, res) => {
  const {
    ferramenta_id, ferramenta_nome, quantidade_cadastrada, quantidade_conferida,
    condicao, item_faltante, justificativa, realizado_por, data_checklist,
  } = req.body || {}
  const cadastrada = Number(quantidade_cadastrada)
  const conferida = Number(quantidade_conferida)
  if (!ferramenta_id || !Number.isInteger(cadastrada) || cadastrada < 1 ||
      !Number.isInteger(conferida) || conferida < 0 || conferida > cadastrada) {
    return res.status(400).json({ error: 'Informe quantidades válidas para o checklist.' })
  }
  try {
    let ferramenta = await query(
      "SELECT id, nome FROM materiais WHERE id = $1 AND categoria = 'ferramental'",
      [ferramenta_id]
    )
    if (!ferramenta.rows[0] && ferramenta_nome) {
      await query(
        `INSERT INTO materiais (id, nome, categoria, tipo, quantidade)
         VALUES ($1, $2, 'ferramental', 'ferramental', $3)
         ON CONFLICT (id) DO NOTHING`,
        [String(ferramenta_id), String(ferramenta_nome).trim() || String(ferramenta_id), cadastrada]
      )
      ferramenta = await query(
        "SELECT id, nome FROM materiais WHERE id = $1 AND categoria = 'ferramental'",
        [ferramenta_id]
      )
    }
    if (!ferramenta.rows[0]) return res.status(404).json({ error: 'Ferramental não encontrado.' })
    const nomeFerramenta = String(ferramenta.rows[0].nome || ferramenta_nome || '')
    const nomeNormalizado = nomeFerramenta
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const ehSerragem = /serragem/i.test(nomeFerramenta)
    const ehPorLitro = nomeNormalizado === 'OLEO' ||
      nomeNormalizado.includes('OLEO 2 TEMPO STIHL') ||
      nomeNormalizado.includes('DC GASOLINA') ||
      nomeNormalizado.includes('OLEO LUBRIFICANTE')
    if (ehSerragem && condicao !== 'quantidade') {
      return res.status(400).json({ error: 'Serragem deve ser registrada somente pela quantidade de sacos.' })
    }
    if (ehPorLitro && condicao !== 'quantidade') {
      return res.status(400).json({ error: 'Este item deve ser registrado somente pela quantidade em litros.' })
    }
    if (!ehSerragem && !ehPorLitro && !['boa', 'media', 'ruim'].includes(condicao)) {
      return res.status(400).json({ error: 'Informe a condição da ferramenta.' })
    }
    if (!ehSerragem && !ehPorLitro && conferida < cadastrada &&
        !String(item_faltante || '').trim() && !String(justificativa || '').trim()) {
      return res.status(400).json({ error: 'Informe onde está o item ou justifique a falta.' })
    }
    const result = await query(
      `INSERT INTO checklists_ferramental
        (ferramenta_id, quantidade_cadastrada, quantidade_conferida, condicao,
         item_faltante, justificativa, realizado_por, data_checklist)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [ferramenta_id, cadastrada, conferida, condicao,
       conferida < cadastrada ? String(item_faltante).trim() : null,
       conferida < cadastrada ? String(justificativa).trim() : null,
       realizado_por ? String(realizado_por).trim() : null,
       data_checklist || new Date().toISOString()]
    )
    broadcastChecklistsFerramentalAtualizados()
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/ferramentas/checklists error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Empréstimos ──────────────────────────────────────────────────────────────
app.get('/api/emprestimos', async (_req, res) => {
  try {
    const result = await query('SELECT * FROM emprestimos ORDER BY created_at DESC')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/emprestimos', async (req, res) => {
  const { material_id, material_codigo, material_nome, responsavel, cpf, secretaria, prazo_dias, quantidade, data_devolucao_prevista, condicao_equipamento, observacoes, agente_emprestador, assinatura_data, tipo } = req.body || {}
  if (!material_id || !responsavel) {
    return res.status(400).json({ error: 'material_id e responsavel obrigatórios' })
  }
  try {
    const tipoValido = tipo === 'manutencao' ? 'manutencao' : 'emprestimo'
    const result = await query(
      `INSERT INTO emprestimos (material_id, material_codigo, material_nome, responsavel, cpf, secretaria, prazo_dias, quantidade, data_devolucao_prevista, condicao_equipamento, observacoes, agente_emprestador, assinatura_data, tipo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [material_id, material_codigo || material_id, material_nome || '',
       String(responsavel).trim(), cpf || null, secretaria || null,
       Number(prazo_dias) || 7, Math.max(1, quantidade || 1),
       data_devolucao_prevista || null, condicao_equipamento || null,
       observacoes || null, agente_emprestador || null, assinatura_data || null, tipoValido]
    )
    broadcastEmprestimosAtualizados()
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/emprestimos error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/emprestimos/:id/devolver', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' })
  const { devolvido_em, devolvido_obs, devolvido_recebedor, devolvido_foto } = req.body || {}
  try {
    const result = await query(
      `UPDATE emprestimos SET devolvido_em=$1, devolvido_obs=$2, devolvido_recebedor=$3, devolvido_foto=$4
       WHERE id=$5 RETURNING *`,
      [devolvido_em || new Date().toISOString(), devolvido_obs || null,
       devolvido_recebedor || null, devolvido_foto || null, id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Empréstimo não encontrado' })
    broadcastEmprestimosAtualizados()
    res.json(result.rows[0])
  } catch (err) {
    console.error('PATCH /api/emprestimos error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Generic PATCH for emprestimos (devolução via /api/emprestimos/:id)
app.patch('/api/emprestimos/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' })
  const { devolvido_em, devolvido_obs, devolvido_recebedor, devolvido_foto } = req.body || {}
  try {
    const result = await query(
      `UPDATE emprestimos SET devolvido_em=$1, devolvido_obs=$2, devolvido_recebedor=$3, devolvido_foto=$4
       WHERE id=$5 RETURNING *`,
      [devolvido_em || new Date().toISOString(), devolvido_obs || null,
       devolvido_recebedor || null, devolvido_foto || null, id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Empréstimo não encontrado' })
    broadcastEmprestimosAtualizados()
    res.json(result.rows[0])
  } catch (err) {
    console.error('PATCH /api/emprestimos/:id error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Equipamentos em Campo ────────────────────────────────────────────────────
app.get('/api/equipamentos-campo', async (_req, res) => {
  try {
    const result = await query('SELECT * FROM equipamentos_campo ORDER BY created_at DESC')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/equipamentos-campo', async (req, res) => {
  const { material_id, material_nome, fotos, latitude, longitude, rua, numero, bairro, observacao, quantidade, prazo_dias, data_recolha_prevista, status, agente } = req.body || {}
  if (!material_id) return res.status(400).json({ error: 'material_id obrigatório' })
  try {
    const result = await query(
      `INSERT INTO equipamentos_campo (material_id, material_nome, fotos, latitude, longitude, rua, numero, bairro, observacao, quantidade, prazo_dias, data_recolha_prevista, status, agente)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [material_id, material_nome || null,
       fotos ? JSON.stringify(fotos) : null,
       latitude ?? null, longitude ?? null,
       rua || null, numero || null, bairro || null, observacao || null,
       Math.max(1, quantidade || 1), prazo_dias || null,
       data_recolha_prevista || null, status || 'ativo', agente || null]
    )
    broadcastParaTodos({ tipo: 'campo_atualizado' })
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/equipamentos-campo error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/equipamentos-campo/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' })
  const { status, latitude, longitude } = req.body || {}
  try {
    let result
    if (latitude !== undefined || longitude !== undefined) {
      // Atualização de GPS
      result = await query(
        'UPDATE equipamentos_campo SET latitude=$1, longitude=$2 WHERE id=$3 RETURNING *',
        [latitude ?? null, longitude ?? null, id]
      )
    } else {
      result = await query(
        'UPDATE equipamentos_campo SET status=$1 WHERE id=$2 RETURNING *',
        [status || 'devolvido', id]
      )
    }
    if (!result.rows[0]) return res.status(404).json({ error: 'Registro não encontrado' })
    broadcastParaTodos({ tipo: 'campo_atualizado' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/equipamentos-campo/:id', async (req, res) => {
  try {
    await query('DELETE FROM equipamentos_campo WHERE id = $1', [req.params.id])
    broadcastParaTodos({ tipo: 'campo_atualizado' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Push subscriptions ───────────────────────────────────────────────────────
app.post('/api/push-subscriptions', async (req, res) => {
  const { id, agente, endpoint, p256dh, auth } = req.body || {}
  if (!id || !endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'id, endpoint, p256dh e auth obrigatórios' })
  }
  try {
    await query(
      `INSERT INTO push_subscriptions (id, agente, endpoint, p256dh, auth, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (id) DO UPDATE SET agente=$2, endpoint=$3, p256dh=$4, auth=$5, updated_at=NOW()`,
      [String(id), agente || null, endpoint, p256dh, auth]
    )
    res.json({ success: true })
  } catch (err) {
    console.error('POST /api/push-subscriptions error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/push-subscriptions/:id', async (req, res) => {
  try {
    await query('DELETE FROM push_subscriptions WHERE id = $1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Send SOS Push ────────────────────────────────────────────────────────────
app.post('/api/send-sos-push', async (req, res) => {
  if (!vapidConfigured) {
    return res.status(503).json({ error: 'VAPID keys não configuradas no servidor' })
  }
  const body = req.body || {}
  if (!body.id || !body.agente) {
    return res.status(400).json({ error: 'id e agente obrigatórios' })
  }
  let subs
  try {
    const result = await query('SELECT id, endpoint, p256dh, auth, agente FROM push_subscriptions')
    subs = result.rows
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
  const localPart = body.lat != null && body.lng != null
    ? `📍 ${Number(body.lat).toFixed(5)}, ${Number(body.lng).toFixed(5)}`
    : 'Localização indisponível'
  const payload = JSON.stringify({
    title: '🆘 SOS — CODAP',
    body: `${body.agente} acionou o SOS. ${localPart}`,
    tag: `sos-${body.id}`,
    sosId: body.id,
    url: '/',
  })
  const enviados = []
  const removidos = []
  await Promise.all(subs.map(async (s) => {
    if (body.excludeId && s.id === body.excludeId) return
    if (body.agente && s.agente && s.agente === body.agente) return
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 30, urgency: 'high' },
      )
      enviados.push(s.id)
    } catch (err) {
      const status = err && err.statusCode
      if (status === 404 || status === 410) removidos.push(s.id)
      else console.warn('[send-sos-push] erro envio:', s.id, status)
    }
  }))
  if (removidos.length > 0) {
    await query('DELETE FROM push_subscriptions WHERE id = ANY($1)', [removidos])
  }
  res.json({ enviados: enviados.length, removidos: removidos.length })
})

// ── SOS Ativos (REST fallback para wsClient) ─────────────────────────────────
app.get('/api/sos-ativos', async (_req, res) => {
  try {
    const limiteTs = Date.now() - SOS_TTL_MS
    const result = await query('SELECT * FROM sos_ativos_db WHERE timestamp > $1', [limiteTs])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Tiles proxy ──────────────────────────────────────────────────────────────
const OSM_SUBDOMAINS = ['a', 'b', 'c']
let _osmIdx = 0

app.get('/api/tiles/:z/:x/:y', async (req, res) => {
  const { z, x, y } = req.params
  const sub = OSM_SUBDOMAINS[_osmIdx++ % 3]
  const tileUrl = `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`
  try {
    const response = await fetch(tileUrl, {
      headers: {
        'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)',
        'Accept': 'image/png,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) { res.status(response.status).end(); return }
    const buffer = await response.arrayBuffer()
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
    res.end(Buffer.from(buffer))
  } catch {
    res.status(503).end()
  }
})

// ── Geocode proxy ────────────────────────────────────────────────────────────
const geocodeCache = new Map()
const GEOCODE_TTL_MS = 60 * 60 * 1000

app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.json([])
  const chave = q.toLowerCase()
  const agora = Date.now()
  const cached = geocodeCache.get(chave)
  if (cached && (agora - cached.ts) < GEOCODE_TTL_MS) return res.json(cached.data)
  try {
    const queryFinal = /conselheiro lafaiete|mg|minas/i.test(q) ? q : `${q}, Conselheiro Lafaiete, MG, Brasil`
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(queryFinal)}&format=json&limit=6&addressdetails=0&countrycodes=br&accept-language=pt-BR`
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)', 'Accept-Language': 'pt-BR' },
    })
    if (!resp.ok) return res.status(502).json({ erro: 'Nominatim retornou ' + resp.status })
    const data = await resp.json()
    const arr = Array.isArray(data) ? data : []
    const simplificado = arr.map(d => ({
      display: d.display_name,
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
    })).filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lng))
    geocodeCache.set(chave, { ts: agora, data: simplificado })
    res.json(simplificado)
  } catch (err) {
    console.error('Erro no geocode:', err.message)
    res.status(503).json({ erro: 'Geocodificação indisponível' })
  }
})

// ── Route proxy ──────────────────────────────────────────────────────────────
app.get('/api/rota', async (req, res) => {
  const from = String(req.query.from || '').split(',').map(parseFloat)
  const to = String(req.query.to || '').split(',').map(parseFloat)
  if (from.length !== 2 || to.length !== 2 || from.some(n => !Number.isFinite(n)) || to.some(n => !Number.isFinite(n))) {
    return res.status(400).json({ erro: 'Parâmetros from/to inválidos (use lat,lng)' })
  }
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`
    const resp = await fetch(url, { headers: { 'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)' } })
    if (!resp.ok) return res.status(502).json({ erro: 'OSRM retornou ' + resp.status })
    const json = await resp.json()
    const r = json?.routes?.[0]
    if (!r) return res.status(404).json({ erro: 'Sem rota disponível' })
    const coords = (r.geometry.coordinates || []).map(([lng, lat]) => [lat, lng])
    res.json({ coords, km: r.distance / 1000, min: Math.round(r.duration / 60) })
  } catch (err) {
    console.error('Erro na rota:', err.message)
    res.status(503).json({ erro: 'Roteamento indisponível' })
  }
})

// ── Weather / Previsão horária ────────────────────────────────────────────────
const CONSELHEIRO_LAFAIETE_LAT = -20.6604
const CONSELHEIRO_LAFAIETE_LON = -43.7863
const INMET_ESTACAO_OB = 'A513'

let climaCache = null
let climaCacheTs = 0
const CLIMA_TTL_MS = 10 * 60 * 1000

async function buscarPrevisaoOpenMeteo() {
  const params = new URLSearchParams({
    latitude: String(CONSELHEIRO_LAFAIETE_LAT),
    longitude: String(CONSELHEIRO_LAFAIETE_LON),

    timezone: 'America/Sao_Paulo',
    forecast_days: '7',

    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'precipitation_probability',
      'precipitation',
      'rain',
      'showers',
      'weather_code',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m'
    ].join(','),

    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'precipitation',
      'rain',
      'showers',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m'
    ].join(','),

    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'rain_sum',
      'precipitation_hours',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'wind_gusts_10m_max'
    ].join(','),

    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm'
  })

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`

  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10000)
  })

  if (!resp.ok) {
    throw new Error(`Open-Meteo: ${resp.status}`)
  }

  const json = await resp.json()

  if (!json?.hourly?.time) {
    throw new Error('Resposta horária inválida da Open-Meteo')
  }

  const h = json.hourly
  const atual = json.current

  const horas = h.time.map((time, i) => ({
    time,

    temperatura: h.temperature_2m?.[i] ?? null,
    umidade: h.relative_humidity_2m?.[i] ?? null,

    probabilidadeChuva:
      h.precipitation_probability?.[i] ?? null,

    precipitacao:
      h.precipitation?.[i] ?? 0,

    chuva:
      h.rain?.[i] ?? 0,

    pancadas:
      h.showers?.[i] ?? 0,

    codigoTempo:
      h.weather_code?.[i] ?? null,

    vento:
      h.wind_speed_10m?.[i] ?? null,

    direcaoVento:
      h.wind_direction_10m?.[i] ?? null,

    rajada:
      h.wind_gusts_10m?.[i] ?? null
  }))

  // Maior precipitação horária
  const maiorPrecipitacao = [...horas]
    .filter(x => Number.isFinite(x.precipitacao))
    .sort((a, b) => b.precipitacao - a.precipitacao)[0] ?? null

  // Maior vento sustentado
  const maiorVento = [...horas]
    .filter(x => Number.isFinite(x.vento))
    .sort((a, b) => b.vento - a.vento)[0] ?? null

  // Maior rajada
  const maiorRajada = [...horas]
    .filter(x => Number.isFinite(x.rajada))
    .sort((a, b) => b.rajada - a.rajada)[0] ?? null

  // Menor umidade
  const menorUmidade = [...horas]
    .filter(x => Number.isFinite(x.umidade))
    .sort((a, b) => a.umidade - b.umidade)[0] ?? null

  // Maior probabilidade de chuva
  const maiorProbabilidadeChuva = [...horas]
    .filter(x => Number.isFinite(x.probabilidadeChuva))
    .sort((a, b) => b.probabilidadeChuva - a.probabilidadeChuva)[0] ?? null

  return {
    local: 'Conselheiro Lafaiete - MG',
    latitude: CONSELHEIRO_LAFAIETE_LAT,
    longitude: CONSELHEIRO_LAFAIETE_LON,

    timezone: json.timezone,

    atualizadoEm: new Date().toISOString(),

    atual: atual ? {
      time: atual.time ?? null,
      temperatura: atual.temperature_2m ?? null,
      umidade: atual.relative_humidity_2m ?? null,
      precipitacao: atual.precipitation ?? null,
      chuva: atual.rain ?? null,
      pancadas: atual.showers ?? null,
      codigoTempo: atual.weather_code ?? null,
      vento: atual.wind_speed_10m ?? null,
      rajada: atual.wind_gusts_10m ?? null,
    } : null,

    horas,

    diario: json.daily ?? null,

    extremos: {
      maiorPrecipitacao,
      maiorVento,
      maiorRajada,
      menorUmidade,
      maiorProbabilidadeChuva
    },

    fonte: 'Open-Meteo'
  }
}

app.get('/api/tempo', async (_req, res) => {
  try {
    const agora = Date.now()

    if (
      climaCache &&
      (agora - climaCacheTs) < CLIMA_TTL_MS
    ) {
      return res.json({
        ...climaCache,
        cache: true
      })
    }

    const previsao = await buscarPrevisaoOpenMeteo()

    climaCache = previsao
    climaCacheTs = agora

    res.json(previsao)

  } catch (err) {
    console.error(
      'Erro ao buscar previsão climática:',
      err?.message || err
    )

    if (climaCache) {
      return res.json({
        ...climaCache,
        cache: true,
        erroAtualizacao: true
      })
    }

    res.status(503).json({
      erro: 'Serviço climático indisponível'
    })
  }
})

// ── Monitoramento CNL / CEMADEN ────────────────────────────────────────────
// A página pública do CEMADEN usa dois serviços: um catálogo com os
// acumulados mais recentes e o MapaInterativoWS para a série horária.
const CNL_ESTACAO_ID = 6622
const CNL_ESTACAO_CHUVA_CENTRO_ID = 3121
const CNL_ESTACAO_CHUVA_CENTRO_CODIGO = '311830401H'
const CNL_ESTACOES_CHUVA_IDS = new Set([4146, 4144, 3121, 6622, 4145, 4143, 4142])
const CNL_CATALOGO_URL = 'https://resources.cemaden.gov.br/graficos/interativo/getJson2.php?uf=MG'
const CNL_RECURSOS_URL = 'https://mapservices.cemaden.gov.br/MapaInterativoWS/resources'
const CNL_NIVEL_URL = 'https://resources.cemaden.gov.br/graficos/cemaden/hidro/resources/json/MedidaResource.php?est=6622&sen=20&pag=24'
const CNL_FONTE_URL = `https://resources.cemaden.gov.br/graficos/interativo/grafico_CEMADEN.php?idpcd=${CNL_ESTACAO_ID}&uf=MG`
const CNL_FUSO_HORARIO = 'America/Sao_Paulo'
const CNL_COTAS_CHAVE = 1
let monitoramentoCnlCache = null
let monitoramentoCnlCacheTs = 0
const MONITORAMENTO_CNL_TTL_MS = 2 * 60 * 1000

function numeroCemaden(valor) {
  if (valor == null || valor === '') return null
  const numero = Number(valor)
  return Number.isFinite(numero) && valor !== '-' ? numero : null
}

function normalizarEstacaoCnl(estacao) {
  return {
    id: Number(estacao.idestacao),
    uf: String(estacao.uf || 'MG'),
    cidade: String(estacao.cidade || ''),
    nome: String(estacao.nomeestacao || ''),
    codigo: String(estacao.codEstacao || ''),
    ultimoValor: numeroCemaden(estacao.ultimovalor),
    dataHora: String(estacao.datahoraUltimovalor || ''),
    precipitacaoAtual: numeroCemaden(estacao.acc1hr),
    precipitacaoDataHora: String(estacao.datahoraUltimovalor || ''),
    precipitacaoDiaria: [],
    acumulados: {
      umaHora: numeroCemaden(estacao.acc1hr),
      seisHoras: numeroCemaden(estacao.acc6hr),
      dozeHoras: numeroCemaden(estacao.acc12hr),
      vinteQuatroHoras: numeroCemaden(estacao.acc24hr),
      quarentaEOitoHoras: numeroCemaden(estacao.acc48hr),
      setentaEDuasHoras: numeroCemaden(estacao.acc72hr),
      noventaESeisHoras: numeroCemaden(estacao.acc96hr),
    },
  }
}

function horaCemadenParaNumero(valor) {
  const match = String(valor || '').match(/^(\d{1,2})h$/)
  return match ? Number(match[1]) : null
}

function extrairPontosChuvaCnl(payload) {
  const horarios = Array.isArray(payload?.horarios) ? payload.horarios : []
  const datas = Array.isArray(payload?.datas) ? payload.datas : []
  const acumulados = Array.isArray(payload?.acumulados) ? payload.acumulados : []
  const pontos = []

  acumulados.forEach((linha, indiceData) => {
    if (!Array.isArray(linha)) return
    linha.forEach((valor, indiceHora) => {
      const numero = numeroCemaden(valor)
      const data = String(datas[indiceData] || '')
      const hora = String(horarios[indiceHora] || '')
      const horaNumero = horaCemadenParaNumero(hora)
      if (numero == null || !data || horaNumero == null) return
      pontos.push({
        data,
        hora,
        valor: numero,
        dataHora: `${data} ${hora}`,
        dataHoraMs: dataCemadenParaMs(`${data} ${String(horaNumero).padStart(2, '0')}:00`),
      })
    })
  })
  return pontos.sort((a, b) => a.dataHoraMs - b.dataHoraMs)
}

function montarSerieHorariaCnl(payload) {
  return extrairPontosChuvaCnl(payload)
    .slice(-24)
    .map(({ data, hora, valor }) => ({ data, hora, valor }))
}

function dataCemadenParaMs(valor) {
  const texto = String(valor || '').trim()
  const brasileiro = texto.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})/)
  if (brasileiro) {
    const ano = Number(brasileiro[3].length === 2 ? `20${brasileiro[3]}` : brasileiro[3])
    return Date.UTC(ano, Number(brasileiro[2]) - 1, Number(brasileiro[1]), Number(brasileiro[4]), Number(brasileiro[5]))
  }
  const isoSemFuso = texto.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/)
  if (isoSemFuso) return Date.parse(`${isoSemFuso[1]}T${isoSemFuso[2]}Z`)
  return Date.parse(texto)
}

function chaveDiaBrasilia(dataHoraMs) {
  if (!Number.isFinite(dataHoraMs)) return ''
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: CNL_FUSO_HORARIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(dataHoraMs))
  const valores = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]))
  return `${valores.year}-${valores.month}-${valores.day}`
}

function montarPrecipitacaoDiariaCnl(payload) {
  const dias = new Map()
  extrairPontosChuvaCnl(payload).forEach((ponto) => {
    const data = chaveDiaBrasilia(ponto.dataHoraMs)
    if (!data) return
    const dia = dias.get(data) || {
      data,
      total: 0,
      pontos: 0,
      ultimaDataHora: '',
      ultimaDataHoraMs: -Infinity,
    }
    dia.total += ponto.valor
    dia.pontos += 1
    if (ponto.dataHoraMs >= dia.ultimaDataHoraMs) {
      dia.ultimaDataHora = `${ponto.data} ${ponto.hora}`
      dia.ultimaDataHoraMs = ponto.dataHoraMs
    }
    dias.set(data, dia)
  })
  return [...dias.values()]
    .sort((a, b) => a.data.localeCompare(b.data))
    .map(({ ultimaDataHoraMs, ...dia }) => ({
      ...dia,
      total: Number(dia.total.toFixed(2)),
    }))
}

function anexarChuvaAtualNaSerie(serie, estacao, dataHoraFallback = '') {
  const valor = numeroCemaden(estacao?.acc1hr)
  const dataHora = String(estacao?.datahoraUltimovalor || dataHoraFallback || '')
  if (valor == null || !dataHora) return serie
  const brasileiro = dataHora.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2})/)
  if (!brasileiro) return serie
  const ano = brasileiro[3].length === 2 ? `20${brasileiro[3]}` : brasileiro[3]
  const pontoAtual = {
    data: `${brasileiro[1]}/${brasileiro[2]}/${ano}`,
    hora: `${Number(brasileiro[4])}h`,
    valor,
  }
  const atualizado = Array.isArray(serie) ? [...serie] : []
  const ultimo = atualizado.at(-1)
  if (ultimo?.data === pontoAtual.data && ultimo?.hora === pontoAtual.hora) {
    atualizado[atualizado.length - 1] = pontoAtual
  } else {
    atualizado.push(pontoAtual)
  }
  return atualizado.slice(-24)
}

function normalizarMedidaNivelCnl(medida) {
  const valorBruto = numeroCemaden(medida?.valor)
  const offset = numeroCemaden(medida?.offset)
  const nivel = valorBruto != null && offset != null
    ? Number((offset - valorBruto).toFixed(2))
    : null
  return {
    dataHora: String(medida?.datahora || ''),
    valor: nivel,
    valorBruto,
    offset,
    qualificacao: String(medida?.qualificacao || ''),
    cotas: {
      atencao: numeroCemaden(medida?.cota_atencao),
      alerta: numeroCemaden(medida?.cota_alerta),
      transbordamento: numeroCemaden(medida?.cota_transbordamento),
    },
  }
}

function montarSerieNivelCnl(medidas) {
  return (Array.isArray(medidas) ? medidas : [])
    .map(normalizarMedidaNivelCnl)
    .filter((medida) => medida.valor != null)
    .slice(-24)
    .map((medida) => ({ dataHora: medida.dataHora, valor: medida.valor }))
}

function anexarNivelAtualNaSerie(serie, nivelAtual) {
  const historico = Array.isArray(serie) ? [...serie] : []
  if (!nivelAtual || nivelAtual.valor == null) return historico

  const ultimo = historico.at(-1)
  const atualMs = dataCemadenParaMs(nivelAtual.dataHora)
  const ultimoMs = dataCemadenParaMs(ultimo?.dataHora)
  if (!ultimo || (Number.isFinite(atualMs) && (!Number.isFinite(ultimoMs) || atualMs > ultimoMs))) {
    historico.push({ dataHora: nivelAtual.dataHora, valor: nivelAtual.valor })
  } else if (Number.isFinite(atualMs) && Number.isFinite(ultimoMs) && atualMs === ultimoMs) {
    historico[historico.length - 1] = { dataHora: nivelAtual.dataHora, valor: nivelAtual.valor }
  }
  return historico.slice(-24)
}

function cotasCnlValidas(cotas) {
  const valores = [cotas?.atencao, cotas?.alerta, cotas?.transbordamento]
  return valores.every((valor) => Number.isFinite(valor) && valor >= 0 && valor <= 100)
    && cotas.atencao < cotas.alerta
    && cotas.alerta < cotas.transbordamento
}

function cotasCnlNumericas(cotas) {
  return {
    atencao: Number(cotas.atencao),
    alerta: Number(cotas.alerta),
    transbordamento: Number(cotas.transbordamento),
  }
}

async function buscarCotasCnlConfiguradas() {
  const resultado = await query(`
    SELECT atencao, alerta, transbordamento
    FROM monitoramento_cnl_cotas
    WHERE id = $1
  `, [CNL_COTAS_CHAVE])
  const registro = resultado.rows[0]
  return registro ? cotasCnlNumericas(registro) : null
}

app.put('/api/monitoramento-cnl/cotas', async (req, res) => {
  const cotas = cotasCnlNumericas(req.body || {})
  if (!cotasCnlValidas(cotas)) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Informe cotas numéricas entre 0 e 100, em ordem crescente: Atenção < Alerta < Transbordamento.',
    })
  }

  try {
    const resultado = await query(`
      INSERT INTO monitoramento_cnl_cotas (id, atencao, alerta, transbordamento, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE SET
        atencao = EXCLUDED.atencao,
        alerta = EXCLUDED.alerta,
        transbordamento = EXCLUDED.transbordamento,
        updated_at = NOW()
      RETURNING atencao, alerta, transbordamento, updated_at
    `, [CNL_COTAS_CHAVE, cotas.atencao, cotas.alerta, cotas.transbordamento])
    monitoramentoCnlCache = null
    monitoramentoCnlCacheTs = 0
    return res.json({
      sucesso: true,
      cotas: cotasCnlNumericas(resultado.rows[0]),
      atualizadoEm: resultado.rows[0].updated_at,
    })
  } catch (erro) {
    console.error('[CNL] Falha ao salvar cotas:', erro?.message || erro)
    return res.status(500).json({ sucesso: false, erro: 'Não foi possível salvar as cotas de acompanhamento.' })
  }
})

app.get('/api/monitoramento-cnl', async (_req, res) => {
  const agora = Date.now()
  if (monitoramentoCnlCache && agora - monitoramentoCnlCacheTs < MONITORAMENTO_CNL_TTL_MS) {
    return res.json({ ...monitoramentoCnlCache, cache: true })
  }

  const controlador = new AbortController()
  const timeout = setTimeout(() => controlador.abort(), 15000)
  try {
    const [catalogoResposta, horarioResposta, nivelResposta] = await Promise.all([
      fetch(CNL_CATALOGO_URL, {
        signal: controlador.signal,
        headers: { 'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)' },
      }),
      fetch(`${CNL_RECURSOS_URL}/horario/${CNL_ESTACAO_ID}/23`, {
        signal: controlador.signal,
        headers: { 'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)' },
      }).catch(() => null),
      fetch(CNL_NIVEL_URL, {
        signal: controlador.signal,
        headers: { 'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)' },
      }).catch(() => null),
    ])
    if (!catalogoResposta.ok) throw new Error(`CEMADEN respondeu catálogo ${catalogoResposta.status}`)
    const catalogo = await catalogoResposta.json()
    let horario = {}
    let medidasNivel = []
    let avisoSerie = ''
    if (horarioResposta?.ok) {
      try {
        horario = await horarioResposta.json()
      } catch {
        avisoSerie = 'Série horária de chuva indisponível nesta atualização.'
      }
    } else {
      avisoSerie = 'Série horária de chuva indisponível nesta atualização.'
    }
    if (nivelResposta?.ok) {
      try {
        medidasNivel = await nivelResposta.json()
      } catch {
        avisoSerie = [avisoSerie, 'Série hidrológica indisponível; usando a leitura mais recente do catálogo.'].filter(Boolean).join(' ')
      }
    } else {
      avisoSerie = [avisoSerie, 'Série hidrológica indisponível; usando a leitura mais recente do catálogo.'].filter(Boolean).join(' ')
    }
    const estacaoCatalogo = Array.isArray(catalogo)
      ? catalogo.find((item) => Number(item?.idestacao) === CNL_ESTACAO_ID)
      : null
    const estacaoHorario = horario?.estacao || {}
    if (!estacaoCatalogo || !estacaoHorario) throw new Error('Estação Rio Bananeiras não encontrada no CEMADEN')
    const estacoesCatalogo = (Array.isArray(catalogo) ? catalogo : [])
      .filter((item) =>
        Number(item?.codibge) === Number(estacaoCatalogo.codibge) &&
        CNL_ESTACOES_CHUVA_IDS.has(Number(item?.idestacao)),
      )
    const chuvaPayloads = new Map([[CNL_ESTACAO_ID, horario]])
    const falhasChuva = []
    const respostasChuva = await Promise.allSettled(
      estacoesCatalogo
        .map((item) => Number(item?.idestacao))
        .filter((id) => Number.isFinite(id) && id !== CNL_ESTACAO_ID)
        .map(async (id) => {
          const resposta = await fetch(`${CNL_RECURSOS_URL}/horario/${id}/96`, {
            signal: controlador.signal,
            headers: { 'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)' },
          })
          if (!resposta.ok) throw new Error(`estação ${id} respondeu ${resposta.status}`)
          return { id, payload: await resposta.json() }
        }),
    )
    respostasChuva.forEach((resultado) => {
      if (resultado.status === 'fulfilled') {
        chuvaPayloads.set(resultado.value.id, resultado.value.payload)
      } else {
        falhasChuva.push(resultado.reason?.message || 'estação sem resposta')
      }
    })
    const nivelMedidas = (Array.isArray(medidasNivel) ? medidasNivel : [])
      .map(normalizarMedidaNivelCnl)
      .filter((medida) => medida.valor != null)
    const ultimaMedidaNivel = nivelMedidas.at(-1) || null
    const nivelCatalogo = numeroCemaden(estacaoCatalogo.ultimovalor)
    const dataNivelCatalogo = dataCemadenParaMs(estacaoCatalogo.datahoraUltimovalor)
    const dataUltimaMedidaNivel = dataCemadenParaMs(ultimaMedidaNivel?.dataHora)
    // A série hidrológica é a fonte da cota instantânea (offset - leitura).
    // O catálogo resumido pode ficar com zero mesmo quando a medição detalhada
    // mais recente está disponível; por isso ele só entra como fallback.
    const nivelAtual = ultimaMedidaNivel || (nivelCatalogo != null
      ? {
          dataHora: String(estacaoCatalogo.datahoraUltimovalor || ''),
          valor: nivelCatalogo,
          qualificacao: 'catálogo CEMADEN',
        }
      : null)

    const cotasOficiais = {
      atencao: numeroCemaden(estacaoHorario.cotaAtencao),
      alerta: numeroCemaden(estacaoHorario.cotaAlerta),
      transbordamento: numeroCemaden(estacaoHorario.cotaTransbordamento),
    }
    const cotasConfiguradas = await buscarCotasCnlConfiguradas()
    const cotas = cotasConfiguradas || cotasOficiais

    const dadosChuvaPorEstacao = new Map(
      [...chuvaPayloads.entries()].map(([id, payload]) => {
        const pontos = extrairPontosChuvaCnl(payload)
        return [id, {
          pontos,
          diaria: montarPrecipitacaoDiariaCnl(payload),
        }]
      }),
    )
    const estacaoCentroCatalogo = estacoesCatalogo.find((item) => Number(item?.idestacao) === CNL_ESTACAO_CHUVA_CENTRO_ID)
    const estacaoCentroId = Number(estacaoCentroCatalogo?.idestacao)
    const payloadCentro = Number.isFinite(estacaoCentroId) ? chuvaPayloads.get(estacaoCentroId) : null
    const estacaoChuvaCentro = estacaoCentroCatalogo && payloadCentro
      ? {
          nome: String(estacaoCentroCatalogo.nomeestacao || payloadCentro.estacao?.nome || 'Centro'),
          codigo: CNL_ESTACAO_CHUVA_CENTRO_CODIGO,
        }
      : null
    const serieChuvaCentro = payloadCentro ? montarSerieHorariaCnl(payloadCentro) : []
    const estacoes = estacoesCatalogo
      .map(normalizarEstacaoCnl)
      .map((item) => {
        const chuva = dadosChuvaPorEstacao.get(item.id)
        const ultimaChuva = chuva?.pontos.at(-1)
        const estacaoOficial = chuvaPayloads.get(item.id)?.estacao || {}
        return {
          ...item,
          codigo: String(estacaoOficial.codEstacao || item.codigo || item.id),
          latitude: numeroCemaden(estacaoOficial.latitude),
          longitude: numeroCemaden(estacaoOficial.longitude),
          dataHora: item.dataHora || item.precipitacaoDataHora,
          precipitacaoAtual: item.precipitacaoAtual ?? ultimaChuva?.valor ?? null,
          precipitacaoDataHora: item.precipitacaoDataHora || ultimaChuva?.dataHora || '',
          precipitacaoDiaria: chuva?.diaria || [],
        }
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    const base = normalizarEstacaoCnl(estacaoCatalogo)
    const chuvaPrincipal = dadosChuvaPorEstacao.get(CNL_ESTACAO_ID)
    const dataHoraChuvaPrincipal = base.precipitacaoDataHora || nivelAtual?.dataHora || ''
    const estacao = {
      ...base,
      ultimoValor: nivelAtual?.valor ?? base.ultimoValor,
      dataHora: nivelAtual?.dataHora || base.dataHora,
      precipitacaoAtual: base.precipitacaoAtual ?? chuvaPrincipal?.pontos.at(-1)?.valor ?? null,
      precipitacaoDataHora: dataHoraChuvaPrincipal,
      precipitacaoDiaria: chuvaPrincipal?.diaria || [],
      codigo: String(estacaoHorario.codEstacao || base.codigo || ''),
      latitude: numeroCemaden(estacaoHorario.latitude),
      longitude: numeroCemaden(estacaoHorario.longitude),
      tipo: String(estacaoHorario.idTipoestacao?.descricao || 'Hidrológica'),
      status: String(estacaoHorario.status || 'UNKNOWN'),
      cotas,
    }

    const serieNivel = anexarNivelAtualNaSerie(montarSerieNivelCnl(medidasNivel), nivelAtual)
    const serieChuva = anexarChuvaAtualNaSerie(montarSerieHorariaCnl(horario), estacaoCatalogo, nivelAtual?.dataHora)
    monitoramentoCnlCache = {
      sucesso: true,
      estacao,
      estacoes,
      serie: serieChuva,
      nivelAtual,
      serieNivel,
      cotasConfiguradas: Boolean(cotasConfiguradas),
      atualizadoEm: new Date().toISOString(),
      fonte: CNL_FONTE_URL,
      estacaoChuvaCentro,
      serieChuvaCentro,
      aviso: [
        'Nível calculado pelo recurso oficial MedidaResource do CEMADEN: offset - valor.',
        avisoSerie,
        falhasChuva.length ? `Precipitação diária indisponível para ${falhasChuva.length} estação(ões) neste ciclo.` : '',
      ].filter(Boolean).join(' '),
    }
    monitoramentoCnlCacheTs = agora
    res.set('Cache-Control', 'no-store')
    return res.json(monitoramentoCnlCache)
  } catch (erro) {
    console.error('[CNL] Falha ao consultar CEMADEN:', erro?.message || erro)
    if (monitoramentoCnlCache) {
      return res.json({ ...monitoramentoCnlCache, cache: true, erroAtualizacao: true })
    }
    return res.status(503).json({
      sucesso: false,
      erro: 'Não foi possível consultar o monitoramento do CEMADEN.',
    })
  } finally {
    clearTimeout(timeout)
  }
})

// ── Radar de chuva ao vivo (RainViewer) ─────────────────────────────────────
// O RainViewer fornece os tiles de radar sem chave. O servidor busca apenas os
// metadados e o navegador solicita os tiles diretamente ao host informado pela
// própria API, sempre usando o último quadro disponível.
let radarChuvaCache = null
let radarChuvaCacheTs = 0
const RADAR_CHUVA_TTL_MS = 2 * 60 * 1000

app.get('/api/radar-chuva', async (_req, res) => {
  try {
    const agora = Date.now()
    if (radarChuvaCache && (agora - radarChuvaCacheTs) < RADAR_CHUVA_TTL_MS) {
      return res.json({ ...radarChuvaCache, cache: true })
    }

    const resposta = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!resposta.ok) throw new Error(`RainViewer: ${resposta.status}`)

    const dados = await resposta.json()
    const host = typeof dados?.host === 'string' ? dados.host.replace(/\/$/, '') : ''
    const validarQuadro = quadro => (
      Number.isFinite(Number(quadro?.time)) &&
      typeof quadro?.path === 'string' &&
      quadro.path.startsWith('/v2/')
    )
    const quadrosObservados = (Array.isArray(dados?.radar?.past) ? dados.radar.past : [])
      .filter(validarQuadro)
    const ultimo = quadrosObservados.at(-1)

    if (!host || !ultimo) throw new Error('RainViewer não retornou quadros de radar')

    radarChuvaCache = {
      host,
      path: ultimo.path,
      tileUrl: `${host}${ultimo.path}/256/{z}/{x}/{y}/2/1_0.png`,
      frameTime: Number(ultimo.time),
      atualizadoEm: new Date(Number(ultimo.time) * 1000).toISOString(),
      fonte: 'RainViewer',
      tipoQuadro: 'observado',
    }
    radarChuvaCacheTs = agora
    return res.json(radarChuvaCache)
  } catch (err) {
    console.error('Erro no radar de chuva:', err?.message || err)
    if (radarChuvaCache) {
      return res.json({ ...radarChuvaCache, cache: true, erroAtualizacao: true })
    }
    return res.status(503).json({ erro: 'Radar de chuva indisponível' })
  }
})

// ── RRQPE NOAA ──────────────────────────────────────────────────────────────
// O produto original é NetCDF georreferenciado. Sem um serviço explícito de
// rasterização para tiles HTTPS, ele permanece desativado e nunca é tratado
// como uma camada GOES ou como uma URL XYZ configurada por engano.
app.get('/api/rrqpe', (_req, res) => {
  return res.json({
    disponivel: false,
    fonte: 'RRQPE NOAA',
    mensagem: 'RRQPE NOAA: indisponível no mapa no momento. O produto NetCDF ainda não possui serviço de rasterização para tiles HTTPS.',
  })
})

// Limite oficial do município, usado para destacar a área de Conselheiro Lafaiete sobre
// o radar. Mantemos cache longo para não sobrecarregar o Nominatim.
let limiteConselheiroLafaieteCache = null
let limiteConselheiroLafaieteCacheTs = 0
const LIMITE_CONSELHEIRO_LAFAIETE_TTL_MS = 24 * 60 * 60 * 1000

app.get('/api/limite-conselheiro-lafaiete', async (_req, res) => {
  try {
    const agora = Date.now()
    if (limiteConselheiroLafaieteCache && (agora - limiteConselheiroLafaieteCacheTs) < LIMITE_CONSELHEIRO_LAFAIETE_TTL_MS) {
      return res.json(limiteConselheiroLafaieteCache)
    }

    const params = new URLSearchParams({
      format: 'jsonv2',
      polygon_geojson: '1',
      limit: '1',
      country: 'Brazil',
      state: 'Minas Gerais',
      city: 'Conselheiro Lafaiete',
    })
    const resposta = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: {
        'User-Agent': 'CODAP/1.0 (Conselheiro Lafaiete, MG)',
        'Accept-Language': 'pt-BR',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!resposta.ok) throw new Error(`Nominatim: ${resposta.status}`)

    const locais = await resposta.json()
    const geojson = locais?.[0]?.geojson
    if (!geojson || !['Polygon', 'MultiPolygon'].includes(geojson.type)) {
      throw new Error('Limite municipal não encontrado')
    }

    limiteConselheiroLafaieteCache = geojson
    limiteConselheiroLafaieteCacheTs = agora
    return res.json(geojson)
  } catch (err) {
    console.error('Erro no limite de Conselheiro Lafaiete:', err?.message || err)
    if (limiteConselheiroLafaieteCache) return res.json(limiteConselheiroLafaieteCache)
    return res.status(503).json({ erro: 'Limite municipal indisponível' })
  }
})

// ── Serve frontend build ─────────────────────────────────────────────────────
const distPath = join(__dirname, '..', 'dist')
if (existsSync(distPath)) {
  const assetsPath = join(distPath, 'assets')
  // Uma aba aberta antes de um novo build pode continuar referenciando o hash
  // anterior do chunk pesado do ExcelJS. Servir o chunk atual evita que a
  // exportação quebre até a aba receber o novo bundle.
  app.get(/^\/assets\/exceljs\.min-[^/]+\.js$/, (_req, res, next) => {
    const excelChunk = readdirSync(assetsPath).find(nome => /^exceljs\.min-.+\.js$/.test(nome))
    if (!excelChunk) return next()
    res.type('application/javascript').sendFile(join(assetsPath, excelChunk))
  })
  app.use('/assets', express.static(assetsPath, { maxAge: '1y', immutable: true }))
  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      }
    },
  }))
  app.get(/(.*)/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.sendFile(join(distPath, 'index.html'))
  })
}

const PORT = parseInt(process.env.PORT || '5000', 10)

try {
  await initDb()
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`API CODAP rodando na porta ${PORT}`)
    console.log(`WebSocket de rastreamento ativo em ws://0.0.0.0:${PORT}/ws`)
  })
  httpServer.on('error', (err) => {
    console.error('Server error:', err)
    process.exit(1)
  })
} catch (err) {
  console.error('Erro ao inicializar o servidor:', err)
  process.exit(1)
}
