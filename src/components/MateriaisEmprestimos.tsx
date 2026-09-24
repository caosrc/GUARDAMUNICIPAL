import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { getAgenteLogado } from './Login'
import { parseExcelPatrimonio, type ItemImportado, type ResultadoParse } from '../importarExcelPatrimonio'
import { matApi, type MatChecklistFerramenta } from '../matApi'
import { supabase, supabaseDisponivel } from '../supabaseClient'
import { ehFerramentalPorLitro, ehFerramentalSomenteQuantidade } from '../ferramentalUtils'

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface Material {
  id: string
  nome: string
  categoria: 'escritorio' | 'ferramental' | null
  descricao: string | null
  observacoes: string | null
  foto_thumb: string | null        // miniatura — presente na listagem
  foto?: string | null             // foto original — carregada só no detalhe
  foto_placa?: string | null       // foto da placa  — carregada só no detalhe
  quantidade: number | null
  tipo?: 'escritorio' | 'ferramental'
  created_at: string
}

interface ChecklistFerramenta {
  id: number
  quantidade_verificada: number
  condicao: 'boa' | 'media' | 'ruim' | 'quantidade'
  justificativa_falta: string | null
  realizado_por: string | null
  realizado_em: string
}

interface Emprestimo {
  id: number
  material_id: string
  material_codigo: string
  material_nome: string
  responsavel: string
  cpf: string | null
  secretaria: string | null
  prazo_dias: number
  quantidade: number | null
  data_emprestimo: string
  data_devolucao_prevista: string | null
  condicao_equipamento: string | null
  observacoes: string | null
  agente_emprestador: string | null
  assinatura_data: string | null
  devolvido_em: string | null
  devolvido_obs: string | null
  devolvido_recebedor: string | null
  devolvido_foto: string | null
  tipo: 'emprestimo' | 'manutencao'
  created_at: string
}

interface EquipamentoCampo {
  id: number
  material_id: string | null
  material_nome: string | null
  fotos: string[] | null
  latitude: number | null
  longitude: number | null
  rua: string | null
  numero: string | null
  bairro: string | null
  observacao: string | null
  quantidade: number | null
  prazo_dias: number | null
  data_recolha_prevista: string | null
  status: 'ativo' | 'devolvido'
  agente: string | null
  created_at: string
}

type Modo =
  | 'inicial'
  | 'patrimonioMenu'
  | 'materiais'
  | 'detalheMaterial'
  | 'checklistFerramenta'
  | 'formMaterial'
  | 'editarMaterial'
  | 'emprestimos'
  | 'escolhaTipo'
  | 'novoEmprestimo'
  | 'devolucao'
  | 'campo'
  | 'formCampo'
  | 'detalheCampo'

// ─── Helpers ───────────────────────────────────────────────────────────────
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function dataExtenso(d: Date): string {
  return `Conselheiro Lafaiete, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
}

function formatarDataBr(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
  return d.toLocaleDateString('pt-BR')
}

function formatarCpf(v: string): string {
  const num = v.replace(/\D/g, '').slice(0, 11)
  if (num.length <= 3) return num
  if (num.length <= 6) return `${num.slice(0, 3)}.${num.slice(3)}`
  if (num.length <= 9) return `${num.slice(0, 3)}.${num.slice(3, 6)}.${num.slice(6)}`
  return `${num.slice(0, 3)}.${num.slice(3, 6)}.${num.slice(6, 9)}-${num.slice(9)}`
}

function htmlEscape(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c] || c
  ))
}

function calcularDevolucaoPrevista(prazoDias: number, base: Date = new Date()): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + prazoDias)
  return d
}

function statusEmprestimo(e: Emprestimo): 'devolvido' | 'atrasado' | 'proximo' | 'no_prazo' {
  if (e.devolvido_em) return 'devolvido'
  if (!e.data_devolucao_prevista) return 'no_prazo'
  const prevista = new Date(e.data_devolucao_prevista + 'T23:59:59')
  const hoje = new Date()
  const diffDias = Math.ceil((prevista.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDias < 0) return 'atrasado'
  if (diffDias <= 2) return 'proximo'
  return 'no_prazo'
}

function redimensionarImagem(dataUrl: string, maxW: number, maxH: number, qualidade = 0.65): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let w = img.width, h = img.height
      if (w > maxW) { h = (h * maxW) / w; w = maxW }
      if (h > maxH) { w = (w * maxH) / h; h = maxH }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const webp = canvas.toDataURL('image/webp', qualidade)
      resolve(webp.startsWith('data:image/webp') ? webp : dataUrl)
    }
    img.src = dataUrl
  })
}

// Gera miniatura pequena para a listagem (sem baixar a foto grande)
function gerarThumbnail(dataUrl: string): Promise<string> {
  return redimensionarImagem(dataUrl, 120, 120, 0.5)
}

async function lerArquivoComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('falha ao ler arquivo'))
    r.readAsDataURL(file)
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
interface MateriaisProps {
  onIrParaMapa?: (lat: number, lng: number, nome?: string) => void
  abrirCampoId?: number | null
  onAbrirCampoIdConsumido?: () => void
  resetSignal?: number
  onMenuPrincipalChange?: (noMenu: boolean) => void
}

export default function MateriaisEmprestimos({
  onIrParaMapa,
  abrirCampoId,
  onAbrirCampoIdConsumido,
  resetSignal = 0,
  onMenuPrincipalChange,
}: MateriaisProps = {}) {
  const [modo, setModo] = useState<Modo>('inicial')
  const [carregando, setCarregando] = useState(true)
  const [materiais, setMateriais] = useState<Material[]>([])
  const [emprestimos, setEmprestimos] = useState<Emprestimo[]>([])
  const [equipamentosCampo, setEquipamentosCampo] = useState<EquipamentoCampo[]>([])
  const [materialSelecionado, setMaterialSelecionado] = useState<Material | null>(null)
  const [categoriaPatrimonio, setCategoriaPatrimonio] = useState<'escritorio' | 'ferramental'>('escritorio')
  const [emprestimoSelecionado, setEmprestimoSelecionado] = useState<Emprestimo | null>(null)
  const [campoSelecionado, setCampoSelecionado] = useState<EquipamentoCampo | null>(null)
  const [mostrarDevolvidos, setMostrarDevolvidos] = useState(false)
  const [abaCampo, setAbaCampo] = useState<'ativos' | 'devolvidos'>('ativos')
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'disponivel' | 'emprestado'>('todos')
  const [toast, setToast] = useState('')
  const [mostrarImport, setMostrarImport] = useState(false)
  const [notificacoesPrazo, setNotificacoesPrazo] = useState<Emprestimo[]>([])
  const [tipoOperacao, setTipoOperacao] = useState<'emprestimo' | 'manutencao'>('emprestimo')
  const [exportandoCatalogo, setExportandoCatalogo] = useState(false)

  useEffect(() => {
    onMenuPrincipalChange?.(modo === 'inicial')
  }, [modo, onMenuPrincipalChange])

  useEffect(() => {
    if (resetSignal === 0) return
    setModo('inicial')
    setMaterialSelecionado(null)
    setEmprestimoSelecionado(null)
    setCampoSelecionado(null)
    setMostrarImport(false)
    setBusca('')
    setFiltroStatus('todos')
  }, [resetSignal])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const [rm, re, rc] = await Promise.all([
        matApi.listarMateriais().catch(() => []),
        matApi.listarEmprestimos().catch(() => []),
        matApi.listarCampo().catch(() => []),
      ])
      setMateriais(rm as unknown as Material[])
      setEmprestimos(re as unknown as Emprestimo[])
      setEquipamentosCampo(rc as unknown as EquipamentoCampo[])
    } catch (err) {
      console.warn('[Materiais] erro ao carregar:', err)
    }
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // Navega direto para o Detalhe em Campo quando abrirCampoId é recebido do mapa
  useEffect(() => {
    if (!abrirCampoId || carregando) return
    const equip = equipamentosCampo.find(c => c.id === abrirCampoId)
    if (equip) {
      setCampoSelecionado(equip)
      setAbaCampo('ativos')
      setModo('detalheCampo')
      onAbrirCampoIdConsumido?.()
    }
  }, [abrirCampoId, equipamentosCampo, carregando])

  // Verifica prazos vencidos/hoje e dispara notificação do navegador
  useEffect(() => {
    if (emprestimos.length === 0 && equipamentosCampo.length === 0) return
    const hoje = new Date().toISOString().slice(0, 10)

    const empVencidos = emprestimos.filter(e =>
      !e.devolvido_em &&
      e.data_devolucao_prevista &&
      e.data_devolucao_prevista <= hoje
    )
    const campoVencidos = equipamentosCampo.filter(c =>
      c.status === 'ativo' &&
      c.data_recolha_prevista &&
      c.data_recolha_prevista <= hoje
    )

    if (empVencidos.length === 0 && campoVencidos.length === 0) return
    if (!('Notification' in window)) return

    async function mostrarNotificacao(title: string, options: NotificationOptions) {
      try {
        new Notification(title, options)
      } catch {
        try {
          const reg = await navigator.serviceWorker.ready
          await reg.showNotification(title, options)
        } catch { /* ignore */ }
      }
    }

    function disparar() {
      empVencidos.forEach(e => {
        mostrarNotificacao('📦 Prazo de devolução — Defesa Civil', {
          body: `${e.material_nome} emprestado a ${e.responsavel} está no prazo de devolução.`,
          tag: `emp-prazo-${e.id}`,
          icon: '/icon-192.png',
        })
      })
      campoVencidos.forEach(c => {
        mostrarNotificacao('🚧 Prazo de recolha — Defesa Civil', {
          body: `${c.material_nome ?? 'Equipamento'} em campo atingiu o prazo de recolha.`,
          tag: `campo-prazo-${c.id}`,
          icon: '/icon-192.png',
        })
      })
    }

    if (Notification.permission === 'granted') {
      disparar()
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => { if (p === 'granted') disparar() })
    }
  }, [emprestimos, equipamentosCampo])

  // Realtime via WebSocket: recarrega quando o servidor sinaliza atualização.
  useEffect(() => {
    function onMsg(e: Event) {
      try {
        const m = JSON.parse((e as MessageEvent).data)
        if (m?.tipo === 'materiais_atualizados' || m?.tipo === 'emprestimos_atualizados' || m?.tipo === 'campo_atualizado') {
          carregar()
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('ws-message', onMsg)
    return () => window.removeEventListener('ws-message', onMsg)
  }, [carregar])

  // mapa materialId → empréstimo ativo (não devolvido)
  const emprestimoAtivoPorMaterial = useMemo(() => {
    const m = new Map<string, Emprestimo>()
    for (const e of emprestimos) {
      if (!e.devolvido_em && !m.has(e.material_id)) m.set(e.material_id, e)
    }
    return m
  }, [emprestimos])

  function emprestimoAtivoDe(materialId: string): Emprestimo | undefined {
    return emprestimoAtivoPorMaterial.get(materialId)
  }

  // Calcula quantidade disponível de um material
  // disponível = total - em empréstimo ativo - em campo ativo
  function qtdDisponivel(mat: Material): number {
    const total = mat.quantidade ?? 1
    const emprestada = emprestimos
      .filter(e => e.material_id === mat.id && !e.devolvido_em)
      .reduce((s, e) => s + (e.quantidade ?? 1), 0)
    const campo = equipamentosCampo
      .filter(c => c.material_id === mat.id && c.status === 'ativo')
      .reduce((s, c) => s + (c.quantidade ?? 1), 0)
    return Math.max(0, total - emprestada - campo)
  }

  // ─── Notificações de prazo ───────────────────────────────────────────────
  useEffect(() => {
    const hoje = new Date().toISOString().slice(0, 10)
    const vencendoHoje = emprestimos.filter((e) =>
      !e.devolvido_em &&
      e.data_devolucao_prevista &&
      e.data_devolucao_prevista.slice(0, 10) === hoje
    )
    setNotificacoesPrazo(vencendoHoje)
  }, [emprestimos])

  // ─── TELA INICIAL ────────────────────────────────────────────────────────
  if (modo === 'inicial') {
    const totalMateriais = materiais.length
    const totalEmprestados = emprestimoAtivoPorMaterial.size
    const totalAtrasados = emprestimos.filter((e) => statusEmprestimo(e) === 'atrasado').length
    const totalCampoAtivos = equipamentosCampo.filter(c => c.status === 'ativo').length

    return (
      <div className="mat-tela mat-inicial">
        {toast && <div className="toast">{toast}</div>}

        {notificacoesPrazo.length > 0 && (
          <div className="mat-notif-prazo" onClick={() => { setMostrarDevolvidos(false); setModo('emprestimos') }}>
            <span className="mat-notif-icone">⏰</span>
            <div className="mat-notif-texto">
              <strong>Prazo de devolução hoje!</strong>
              <div>
                {notificacoesPrazo.map(e => (
                  <span key={e.id} className="mat-notif-item">{e.material_nome} → {e.responsavel}</span>
                ))}
              </div>
            </div>
            <span className="mat-notif-seta">›</span>
          </div>
        )}

        <div className="mat-header-inicial">
          <span className="mat-emoji-grande">📦</span>
          <h2>Materiais e Equipamentos</h2>
          <p>Controle de empréstimo e devolução</p>
        </div>

        <div className="mat-resumo">
          <div className="mat-resumo-item">
            <span className="mat-resumo-num">{totalMateriais}</span>
            <span className="mat-resumo-label">Cadastrados</span>
          </div>
          <div className="mat-resumo-item mat-resumo-empr">
            <span className="mat-resumo-num">{totalEmprestados}</span>
            <span className="mat-resumo-label">Emprestados</span>
          </div>
          <div className="mat-resumo-item mat-resumo-atr">
            <span className="mat-resumo-num">{totalAtrasados}</span>
            <span className="mat-resumo-label">Atrasados</span>
          </div>
        </div>

        <div className="mat-botoes-grandes">
          <button className="mat-btn-grande mat-btn-azul" onClick={() => setModo('patrimonioMenu')}>
            <span className="mat-btn-emoji">📋</span>
            <span className="mat-btn-titulo">Patrimônio</span>
            <span className="mat-btn-sub">Catálogo e cadastro</span>
          </button>

          <button className="mat-btn-grande mat-btn-laranja" onClick={() => { setMostrarDevolvidos(false); setModo('emprestimos') }}>
            <span className="mat-btn-emoji">🔄</span>
            <span className="mat-btn-titulo">Empréstimos e Manutenção</span>
            <span className="mat-btn-sub">{totalEmprestados} ativo(s){totalAtrasados > 0 ? ` · ${totalAtrasados} atrasado(s)` : ''}</span>
          </button>

          <button className="mat-btn-grande mat-btn-verde" onClick={() => { setAbaCampo('ativos'); setModo('campo') }}>
            <span className="mat-btn-emoji">🚧</span>
            <span className="mat-btn-titulo">Equipamentos em Campo</span>
            <span className="mat-btn-sub">{totalCampoAtivos > 0 ? `${totalCampoAtivos} ativo(s) na cidade` : 'Rastreie o que está implantado'}</span>
          </button>
        </div>
      </div>
    )
  }

  if (modo === 'patrimonioMenu') {
    return (
      <div className="mat-tela">
        <div className="mat-subheader"><button className="btn-voltar" onClick={() => setModo('inicial')}>‹</button><h2>📋 Patrimônio</h2><span style={{ width: '2rem' }} /></div>
        <div className="mat-categoria-grid">
          <button className="mat-categoria-card" onClick={() => { setCategoriaPatrimonio('escritorio'); setBusca(''); setModo('materiais') }}>
            <span>🗂️</span><strong>Materiais de Escritório</strong><small>Cadastro e estoque de materiais</small>
          </button>
          <button className="mat-categoria-card mat-categoria-ferramenta" onClick={() => { setCategoriaPatrimonio('ferramental'); setBusca(''); setModo('materiais') }}>
            <span>🛠️</span><strong>Ferramental</strong><small>Ferramentas e checklists de condição</small>
          </button>
        </div>
      </div>
    )
  }

  // ─── LISTA DE MATERIAIS ──────────────────────────────────────────────────
  if (modo === 'materiais') {
    const materiaisDaCategoria = materiais.filter(m => (m.categoria ?? 'escritorio') === categoriaPatrimonio)
    const buscaLow = busca.trim().toLowerCase()
    const totalDisponiveis = materiaisDaCategoria.filter(m => !emprestimoAtivoDe(m.id)).length
    const totalEmprestadosFiltro = materiaisDaCategoria.filter(m => !!emprestimoAtivoDe(m.id)).length
    const filtrados = materiaisDaCategoria.filter((m) => {
      if (buscaLow && !m.id.toLowerCase().includes(buscaLow) && !m.nome.toLowerCase().includes(buscaLow)) return false
      if (filtroStatus === 'disponivel' && emprestimoAtivoDe(m.id)) return false
      if (filtroStatus === 'emprestado' && !emprestimoAtivoDe(m.id)) return false
      return true
    })
    return (
      <div className="mat-tela">
        {toast && <div className="toast">{toast}</div>}
        <div className="mat-subheader">
          <button className="btn-voltar" onClick={() => { setBusca(''); setModo('patrimonioMenu') }}>‹</button>
          <h2>{categoriaPatrimonio === 'ferramental' ? '🧰 Ferramental' : '📋 Materiais de Escritório'} ({materiaisDaCategoria.length})</h2>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              className="mat-btn-exportar"
              title="Exportar catálogo em Excel"
              disabled={exportandoCatalogo}
              onClick={async () => {
                if (exportandoCatalogo) return
                setExportandoCatalogo(true)
                try {
                  await exportarMateriaisExcel(materiais, emprestimos)
                } catch {
                  alert('Falha ao gerar Excel.')
                } finally {
                  setExportandoCatalogo(false)
                }
              }}
            >{exportandoCatalogo ? '⏳' : '📊'}</button>
            <button className="mat-btn-add" onClick={() => { setMaterialSelecionado(null); setModo('formMaterial') }}>+</button>
          </div>
        </div>

        <div className="mat-categoria-menu">
          <label htmlFor="categoria-patrimonio">Patrimônio</label>
          <select
            id="categoria-patrimonio"
            className="campo-select"
            value={categoriaPatrimonio}
            onChange={(e) => {
              setCategoriaPatrimonio(e.target.value as 'escritorio' | 'ferramental')
              setBusca('')
              setFiltroStatus('todos')
            }}
          >
            <option value="escritorio">📋 Materiais de Escritório</option>
            <option value="ferramental">🧰 Ferramental</option>
          </select>
        </div>

        <div className="mat-busca-wrap">
          <input
            className="busca-input"
            type="text"
            placeholder="🔍 Buscar por código ou nome..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <div className="mat-filtros-wrap">
            <button
            className={`mat-filtro-pill ${filtroStatus === 'todos' ? 'ativo' : ''}`}
            onClick={() => setFiltroStatus('todos')}
            >Todos ({materiaisDaCategoria.length})</button>
          <button
            className={`mat-filtro-pill mat-filtro-verde ${filtroStatus === 'disponivel' ? 'ativo' : ''}`}
            onClick={() => setFiltroStatus('disponivel')}
          >✅ Disponível ({totalDisponiveis})</button>
          <button
            className={`mat-filtro-pill mat-filtro-laranja ${filtroStatus === 'emprestado' ? 'ativo' : ''}`}
            onClick={() => setFiltroStatus('emprestado')}
          >🔄 Emprestado ({totalEmprestadosFiltro})</button>
        </div>


        {carregando ? (
          <div className="carregando">⏳ Carregando...</div>
        ) : filtrados.length === 0 ? (
          <div className="lista-vazia">
            <div style={{ fontSize: '3rem' }}>📦</div>
            <div>
              {busca || filtroStatus !== 'todos'
                ? 'Nenhum material encontrado para este filtro.'
                : 'Nenhum material cadastrado ainda.'}
            </div>
            {!busca && filtroStatus !== 'todos' && (
              <button className="btn-nova-vazia" onClick={() => { setBusca(''); setFiltroStatus('todos') }}>
                Limpar filtros
              </button>
            )}
            {!busca && filtroStatus === 'todos' && (
              <button className="btn-nova-vazia" onClick={() => { setMaterialSelecionado(null); setModo('formMaterial') }}>
                + Cadastrar {categoriaPatrimonio === 'ferramental' ? 'ferramental' : 'material de escritório'}
              </button>
            )}
          </div>
        ) : (
          <div className="mat-lista">
             {filtrados.map((m) => {
              const empr = emprestimoAtivoDe(m.id)
              const total = m.quantidade ?? 1
              const disp = qtdDisponivel(m)
               return (
                 <div key={m.id} className="mat-card" role="button" tabIndex={0} onClick={() => { setMaterialSelecionado(m); setModo('detalheMaterial') }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMaterialSelecionado(m); setModo('detalheMaterial') } }}>
                  <div className="mat-card-foto">
                    {m.foto_thumb
                      ? <img src={m.foto_thumb} alt={m.nome} loading="lazy" />
                      : <span>📦</span>}
                  </div>
                  <div className="mat-card-corpo">
                    <div className="mat-card-codigo">{m.id}</div>
                    <div className="mat-card-nome">{m.nome}</div>
                    <div className={`mat-card-status mat-status-${disp > 0 ? 'disponivel' : 'emprestado'}`}>
                      {disp > 0
                        ? `✅ ${disp}/${total} disponível${disp !== 1 ? 'is' : ''}`
                        : empr
                          ? `❌ Tudo emprestado a ${empr.responsavel}`
                          : '❌ Nenhum disponível'}
                    </div>
                  </div>
                  <div className="mat-card-qtd-badge" style={{
                    background: disp > 0 ? '#dcfce7' : '#fef2f2',
                    color: disp > 0 ? '#15803d' : '#991b1b',
                  }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>{disp}</span>
                    <span style={{ fontSize: '0.65rem', lineHeight: 1 }}>disp</span>
                  </div>
                   {categoriaPatrimonio === 'ferramental' ? (
                     <button
                       type="button"
                       className="mat-btn-checklist"
                       onClick={(e) => { e.stopPropagation(); setMaterialSelecionado(m); setModo('checklistFerramenta') }}
                     >Checklist</button>
                   ) : null}
                   <span className="mat-card-seta">›</span>
                 </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ─── DETALHE DO MATERIAL ─────────────────────────────────────────────────
  if (modo === 'detalheMaterial' && materialSelecionado) {
    return (
      <DetalheMaterial
        material={materialSelecionado}
        emprestimoAtivo={emprestimoAtivoDe(materialSelecionado.id)}
        onVoltar={() => setModo('materiais')}
        onChecklist={materialSelecionado.tipo === 'ferramental' ? () => setModo('checklistFerramenta') : undefined}
        onEditar={() => setModo('editarMaterial')}
        onExcluir={async () => {
          if (!confirm(`Excluir definitivamente o material "${materialSelecionado.nome}"?\nIsso apaga TODOS os empréstimos relacionados.`)) return
          try {
            await matApi.excluirMaterial(materialSelecionado.id)
          } catch (err: unknown) {
            alert('Erro: ' + ((err as Error)?.message || 'falha de rede')); return
          }
          showToast('🗑️ Material excluído.')
          await carregar()
          setMaterialSelecionado(null)
          setModo('materiais')
        }}
      />
    )
  }

  // ─── FORMULÁRIO DE NOVO MATERIAL ─────────────────────────────────────────
  if (modo === 'formMaterial') {
    return (
      <FormMaterial
        existentes={materiais.map((m) => m.id)}
        categoria={categoriaPatrimonio}
        onCancelar={() => setModo('materiais')}
        onSalvo={async () => {
          showToast('✅ Material cadastrado!')
          await carregar()
          setModo('materiais')
        }}
      />
    )
  }

  // ─── EDITAR MATERIAL ─────────────────────────────────────────────────────
  if (modo === 'editarMaterial' && materialSelecionado) {
    return (
      <FormMaterial
        existentes={materiais.map((m) => m.id)}
        tipo={materialSelecionado.tipo || categoriaPatrimonio}
        materialInicial={materialSelecionado}
          categoria={materialSelecionado.categoria === 'ferramental' ? 'ferramental' : 'escritorio'}
        onCancelar={() => setModo('detalheMaterial')}
        onSalvo={async (atualizado) => {
          if (atualizado) setMaterialSelecionado(atualizado)
          showToast('✅ Material atualizado!')
          await carregar()
          setModo('detalheMaterial')
        }}
      />
    )
  }

  if (modo === 'checklistFerramenta' && materialSelecionado) {
    return (
      <ChecklistFerramenta
        ferramenta={materialSelecionado}
        onCancelar={() => setModo('materiais')}
        onSalvo={async () => {
          showToast('✅ Checklist da ferramenta registrado!')
          setModo('detalheMaterial')
        }}
      />
    )
  }

  // ─── LISTA DE EMPRÉSTIMOS ────────────────────────────────────────────────
  if (modo === 'emprestimos') {
    const filtrados = emprestimos.filter((e) => mostrarDevolvidos ? !!e.devolvido_em : !e.devolvido_em)
    return (
      <div className="mat-tela">
        {toast && <div className="toast">{toast}</div>}
        <div className="mat-subheader">
          <button className="btn-voltar" onClick={() => setModo('inicial')}>‹</button>
          <h2>🔄 Empréstimos e Manutenção</h2>
          <button className="mat-btn-add" onClick={() => setModo('escolhaTipo')} disabled={materiais.length === 0}>+</button>
        </div>

        <div className="mat-toggle-row">
          <button
            className={`mat-toggle-btn ${!mostrarDevolvidos ? 'ativo' : ''}`}
            onClick={() => setMostrarDevolvidos(false)}
          >
            🔴 Ativos ({emprestimos.filter((e) => !e.devolvido_em).length})
          </button>
          <button
            className={`mat-toggle-btn ${mostrarDevolvidos ? 'ativo' : ''}`}
            onClick={() => setMostrarDevolvidos(true)}
          >
            ✅ Devolvidos ({emprestimos.filter((e) => !!e.devolvido_em).length})
          </button>
        </div>

        {carregando ? (
          <div className="carregando">⏳ Carregando...</div>
        ) : filtrados.length === 0 ? (
          <div className="lista-vazia">
            <div style={{ fontSize: '3rem' }}>🔄</div>
            <div>
              {mostrarDevolvidos ? 'Nenhuma devolução registrada ainda.' : 'Nenhum empréstimo ativo no momento.'}
            </div>
            {!mostrarDevolvidos && materiais.length > 0 && (
              <button className="btn-nova-vazia" onClick={() => setModo('escolhaTipo')}>+ Registrar empréstimo ou manutenção</button>
            )}
          </div>
        ) : (
          <div className="mat-lista">
            {filtrados.map((e) => {
              const st = statusEmprestimo(e)
              return (
                <div key={e.id} className={`mat-card-empr mat-empr-${st}`}>
                  <div className="mat-empr-cab">
                    <div>
                      <div className="mat-empr-mat">📦 {e.material_codigo} — {e.material_nome}{(e.quantidade ?? 1) > 1 ? ` (${e.quantidade} un.)` : ''}</div>
                      <div className="mat-empr-quem">👤 {e.responsavel}{e.secretaria ? ` · ${e.secretaria}` : ''}</div>
                    </div>
                    <span className={`mat-empr-tag mat-empr-tag-${st}`}>
                      {st === 'devolvido' ? '✅ Devolvido' :
                       st === 'atrasado' ? '🔴 Atrasado' :
                       st === 'proximo' ? '🟡 Vence em breve' : '🟢 No prazo'}
                    </span>
                  </div>
                  <div className="mat-empr-meta">
                    <span>📅 Saiu: {formatarDataBr(e.data_emprestimo)}</span>
                    {e.devolvido_em
                      ? <span>↩️ Devolvido: {formatarDataBr(e.devolvido_em)}</span>
                      : <span>⏰ Devolução prevista: {formatarDataBr(e.data_devolucao_prevista)} ({e.prazo_dias} dia{e.prazo_dias !== 1 ? 's' : ''})</span>
                    }
                  </div>
                  <div className="mat-empr-acoes">
                    <button className="mat-btn-acao" onClick={() => gerarTermoEmprestimoPdf(e, e.tipo === 'manutencao' ? 'manutencao' : 'emprestimo')}>
                      📄 Gerar Termo
                    </button>
                    {!e.devolvido_em && (
                      <button className="mat-btn-acao mat-btn-acao-verde" onClick={() => { setEmprestimoSelecionado(e); setModo('devolucao') }}>
                        ↩️ Registrar Devolução
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ─── ESCOLHA DE TIPO (Empréstimo ou Manutenção) ──────────────────────────
  if (modo === 'escolhaTipo') {
    return (
      <div className="mat-tela">
        {toast && <div className="toast">{toast}</div>}
        <div className="mat-subheader">
          <button className="btn-voltar" onClick={() => setModo('emprestimos')}>‹</button>
          <h2>📋 Nova Operação</h2>
          <span style={{ width: '2rem' }} />
        </div>
        <div className="mat-form" style={{ gap: '1.2rem', paddingTop: '1.5rem' }}>
          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.88rem', fontWeight: 600 }}>
            Selecione o tipo de operação:
          </p>
          <button
            className="mat-btn-grande mat-btn-laranja"
            onClick={() => { setTipoOperacao('emprestimo'); setModo('novoEmprestimo') }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.8rem 1rem', gap: '0.5rem', width: '100%' }}
          >
            <span style={{ fontSize: '2.5rem' }}>🔄</span>
            <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>Empréstimo</span>
            <span style={{ fontSize: '0.78rem', opacity: 0.85 }}>Equipamento cedido com prazo de devolução</span>
          </button>
          <button
            className="mat-btn-grande mat-btn-verde"
            onClick={() => { setTipoOperacao('manutencao'); setModo('novoEmprestimo') }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.8rem 1rem', gap: '0.5rem', width: '100%' }}
          >
            <span style={{ fontSize: '2.5rem' }}>🔧</span>
            <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>Manutenção</span>
            <span style={{ fontSize: '0.78rem', opacity: 0.85 }}>Envio para conserto ou revisão técnica</span>
          </button>
        </div>
      </div>
    )
  }

  // ─── NOVO EMPRÉSTIMO (formulário + termo) ────────────────────────────────
  if (modo === 'novoEmprestimo') {
    return (
      <FormNovoEmprestimo
        materiais={materiais}
        emprestimos={emprestimos}
        equipamentos={equipamentosCampo}
        tipoOperacao={tipoOperacao}
        onCancelar={() => setModo('escolhaTipo')}
        onSalvo={async (novo) => {
          showToast(tipoOperacao === 'manutencao' ? '✅ Manutenção registrada!' : '✅ Empréstimo registrado!')
          await carregar()
          gerarTermoEmprestimoPdf(novo, tipoOperacao)
          setModo('emprestimos')
        }}
      />
    )
  }

  // ─── REGISTRAR DEVOLUÇÃO ─────────────────────────────────────────────────
  if (modo === 'devolucao' && emprestimoSelecionado) {
    return (
      <FormDevolucao
        emprestimo={emprestimoSelecionado}
        onCancelar={() => { setEmprestimoSelecionado(null); setModo('emprestimos') }}
        onSalvo={async () => {
          showToast('✅ Devolução registrada!')
          await carregar()
          setEmprestimoSelecionado(null)
          setModo('emprestimos')
        }}
      />
    )
  }

  // ─── EQUIPAMENTOS EM CAMPO (lista) ───────────────────────────────────────
  if (modo === 'campo') {
    const ativos    = equipamentosCampo.filter(c => c.status === 'ativo')
    const devolvidos = equipamentosCampo.filter(c => c.status === 'devolvido')
    const lista = abaCampo === 'ativos' ? ativos : devolvidos

    return (
      <div className="mat-tela">
        {toast && <div className="toast">{toast}</div>}
        <div className="mat-subheader">
          <button className="btn-voltar" onClick={() => setModo('inicial')}>‹</button>
          <h2>🚧 Equipamentos em Campo</h2>
          <button className="mat-btn-add" onClick={() => setModo('formCampo')}>+</button>
        </div>

        <div className="mat-toggle-row">
          <button
            className={`mat-toggle-btn ${abaCampo === 'ativos' ? 'ativo' : ''}`}
            onClick={() => setAbaCampo('ativos')}
          >🔴 Ativos ({ativos.length})</button>
          <button
            className={`mat-toggle-btn ${abaCampo === 'devolvidos' ? 'ativo' : ''}`}
            onClick={() => setAbaCampo('devolvidos')}
          >✅ Devolvidos ({devolvidos.length})</button>
        </div>

        {lista.length === 0 ? (
          <div className="lista-vazia">
            <div style={{ fontSize: '3rem' }}>🚧</div>
            <div>{abaCampo === 'ativos' ? 'Nenhum equipamento ativo no campo.' : 'Nenhum equipamento devolvido ainda.'}</div>
            {abaCampo === 'ativos' && (
              <button className="btn-nova-vazia" onClick={() => setModo('formCampo')}>+ Registrar em campo</button>
            )}
          </div>
        ) : (
          <div className="mat-lista">
            {lista.map(c => (
              <button key={c.id} className="mat-card mat-card-campo" onClick={() => { setCampoSelecionado(c); setModo('detalheCampo') }}>
                <div className="mat-card-foto mat-card-foto-campo">
                  {c.fotos && c.fotos[0]
                    ? <img src={c.fotos[0]} alt={c.material_nome ?? ''} />
                    : <span>🚧</span>}
                </div>
                <div className="mat-card-corpo">
                  <div className="mat-card-codigo">{c.material_id ?? '—'}</div>
                  <div className="mat-card-nome">{c.material_nome ?? 'Sem material'}{(c.quantidade ?? 1) > 1 ? <span style={{ fontSize: '0.75rem', fontWeight: 600, marginLeft: '0.3rem', color: '#b45309' }}>{c.quantidade} un.</span> : null}</div>
                  {(c.rua || c.bairro) && (
                    <div className="mat-card-status" style={{ color: '#374151', fontSize: '0.8rem' }}>
                      📍 {[c.rua, c.numero, c.bairro].filter(Boolean).join(', ')}
                    </div>
                  )}
                  <div className={`mat-card-status ${c.status === 'ativo' ? 'mat-status-emprestado' : 'mat-status-disponivel'}`}>
                    {c.status === 'ativo' ? '🔴 Em campo' : '✅ Devolvido'}
                  </div>
                </div>
                {c.latitude && c.longitude && (
                  <span className="mat-campo-gps-badge" title="Tem GPS">📡</span>
                )}
                <span className="mat-card-seta">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── FORM CAMPO ───────────────────────────────────────────────────────────
  if (modo === 'formCampo') {
    return (
      <FormCampo
        materiais={materiais}
        onCancelar={() => setModo('campo')}
        onSalvo={async () => {
          showToast('✅ Equipamento registrado em campo!')
          await carregar()
          setModo('campo')
        }}
      />
    )
  }

  // ─── DETALHE CAMPO ────────────────────────────────────────────────────────
  if (modo === 'detalheCampo' && campoSelecionado) {
    return (
      <DetalheCampo
        item={campoSelecionado}
        onVoltar={() => { setCampoSelecionado(null); setModo('campo') }}
        onIrParaMapa={onIrParaMapa}
        onDevolver={async () => {
          try {
            await matApi.devolverCampo(campoSelecionado.id)
          } catch (err: unknown) {
            alert('Erro: ' + ((err as Error)?.message || 'falha de rede')); return
          }
          showToast('✅ Equipamento marcado como devolvido!')
          await carregar()
          setCampoSelecionado(null)
          setModo('campo')
        }}
        onExcluir={async () => {
          if (!confirm('Excluir este registro de equipamento em campo?')) return
          await matApi.excluirCampo(campoSelecionado.id).catch(() => {})
          showToast('🗑️ Registro excluído.')
          await carregar()
          setCampoSelecionado(null)
          setModo('campo')
        }}
        onGpsAtualizado={(lat, lng) => {
          setCampoSelecionado(prev => prev ? { ...prev, latitude: lat, longitude: lng } : prev)
          showToast('📡 Coordenadas GPS atualizadas!')
          carregar()
        }}
      />
    )
  }

  return null
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTES
// ═══════════════════════════════════════════════════════════════════════════

function DetalheMaterial({
  material, emprestimoAtivo, onVoltar, onEditar, onExcluir, onChecklist,
}: {
  material: Material
  emprestimoAtivo: Emprestimo | undefined
  onVoltar: () => void
  onEditar: () => void
  onChecklist?: () => void
  onExcluir: () => void
  onChecklist?: () => void
}) {
  // Busca fotos em alta resolução só quando o usuário abre o detalhe
  const [fotoCompleta, setFotoCompleta] = useState<{ foto: string | null; foto_placa: string | null } | null>(null)
  const [carregandoFoto, setCarregandoFoto] = useState(false)

  useEffect(() => {
    let cancelado = false
    async function buscarFotos() {
      setCarregandoFoto(true)
      try {
        const matData = await matApi.buscarMaterial(material.id)
        if (!cancelado) setFotoCompleta({ foto: matData.foto ?? null, foto_placa: matData.foto_placa ?? null })
      } catch { /* silencioso */ } finally {
        if (!cancelado) setCarregandoFoto(false)
      }
    }
    buscarFotos()
    return () => { cancelado = true }
  }, [material.id])

  // Usa foto_thumb como fallback se o detalhe não tiver foto em alta resolução
  const temFoto = fotoCompleta
    ? (fotoCompleta.foto || fotoCompleta.foto_placa || material.foto_thumb)
    : material.foto_thumb

  return (
    <div className="mat-tela">
      <div className="mat-subheader">
        <button className="btn-voltar" onClick={onVoltar}>‹</button>
        <h2>{material.categoria === 'ferramental' ? '🧰' : '📦'} {material.id}</h2>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {onChecklist && (
            <button className="mat-btn-checklist" onClick={onChecklist} title="Fazer checklist da ferramenta">✓ Checklist</button>
          )}
          <button className="mat-btn-editar" onClick={onEditar} title="Editar material">✏️</button>
          <button className="mat-btn-excluir" onClick={onExcluir} title="Excluir material">🗑️</button>
        </div>
      </div>

      <div className="mat-detalhe">
        {/* Enquanto carrega as fotos grandes, mostra o thumbnail ou indicador */}
        {carregandoFoto && !fotoCompleta && material.foto_thumb && (
          <div className="mat-detalhe-fotos">
            <div className="mat-detalhe-foto-wrap" style={{ opacity: 0.6 }}>
              <span className="mat-foto-label">📸 Carregando foto...</span>
              <img src={material.foto_thumb} alt={material.nome} style={{ filter: 'blur(2px)' }} />
            </div>
          </div>
        )}

        {/* Fotos completas carregadas */}
        {fotoCompleta && temFoto && (
          <div className="mat-detalhe-fotos">
            {fotoCompleta.foto_placa && (
              <div className="mat-detalhe-foto-wrap">
                <span className="mat-foto-label">🏷️ Placa do patrimônio</span>
                <img src={fotoCompleta.foto_placa} alt="Placa do patrimônio" />
              </div>
            )}
            {(fotoCompleta.foto || (!fotoCompleta.foto && !fotoCompleta.foto_placa && material.foto_thumb)) && (
              <div className="mat-detalhe-foto-wrap">
                <span className="mat-foto-label">📸 Foto do item</span>
                <img src={fotoCompleta.foto || material.foto_thumb || ''} alt={material.nome} />
              </div>
            )}
          </div>
        )}

        <div className="mat-detalhe-bloco">
          <span className="mat-detalhe-label">Nome</span>
          <span className="mat-detalhe-valor">{material.nome}</span>
        </div>

        <div className="mat-detalhe-bloco">
          <span className="mat-detalhe-label">Categoria</span>
          <span className="mat-detalhe-valor">{material.categoria === 'ferramental' ? 'Ferramental' : 'Materiais de Escritório'}</span>
        </div>

        <div className="mat-detalhe-bloco">
          <span className="mat-detalhe-label">Quantidade em estoque</span>
          <span className="mat-detalhe-valor">{material.quantidade ?? 1}</span>
        </div>

        {material.descricao && (
          <div className="mat-detalhe-bloco">
            <span className="mat-detalhe-label">Descrição</span>
            <span className="mat-detalhe-valor">{material.descricao}</span>
          </div>
        )}

        {material.observacoes && (
          <div className="mat-detalhe-bloco">
            <span className="mat-detalhe-label">Observações</span>
            <span className="mat-detalhe-valor">{material.observacoes}</span>
          </div>
        )}

        <div className={`mat-detalhe-status ${emprestimoAtivo ? 'mat-status-emprestado' : 'mat-status-disponivel'}`}>
          {emprestimoAtivo ? (
            <>
              <strong>❌ Emprestado</strong>
              <div>Para: <strong>{emprestimoAtivo.responsavel}</strong></div>
              {emprestimoAtivo.secretaria && <div>Secretaria: {emprestimoAtivo.secretaria}</div>}
              <div>Devolução prevista: <strong>{formatarDataBr(emprestimoAtivo.data_devolucao_prevista)}</strong> ({emprestimoAtivo.prazo_dias} dias)</div>
              <button className="mat-btn-acao" style={{ marginTop: '0.7rem' }} onClick={() => gerarTermoEmprestimoPdf(emprestimoAtivo)}>
                📄 Gerar Termo deste empréstimo
              </button>
            </>
          ) : (
            <strong>✅ Disponível</strong>
          )}
        </div>

        {material.categoria === 'ferramental' && (
          <HistoricoChecklists
            ferramentaId={material.id}
            ferramentaNome={material.nome}
            quantidadeCadastrada={material.quantidade ?? 1}
          />
        )}
      </div>
    </div>
  )
}

function HistoricoChecklists({ ferramentaId, ferramentaNome, quantidadeCadastrada }: {
  ferramentaId: string
  ferramentaNome: string
  quantidadeCadastrada: number
}) {
  const [checklists, setChecklists] = useState<MatChecklistFerramenta[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false
    matApi.listarChecklistsFerramenta(ferramentaId)
      .then((data) => { if (!cancelado) setChecklists(data) })
      .catch(() => { if (!cancelado) setChecklists([]) })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [ferramentaId])

  return (
    <div className="mat-checklist-historico">
      <div className="mat-checklist-historico-titulo">🧾 Histórico de checklists</div>
      {carregando ? (
        <div className="campo-label-sub">Carregando histórico...</div>
      ) : checklists.length === 0 ? (
        <div className="campo-label-sub">Nenhum checklist realizado ainda.</div>
      ) : (
        <div className="mat-checklist-lista">
          {checklists.map((checklist) => {
            const faltantes = Math.max(0, checklist.quantidade_cadastrada - checklist.quantidade_conferida)
            const ehSerragem = /serragem/i.test(ferramentaNome)
            const ehPorLitro = ehFerramentalPorLitro(ferramentaNome)
            const ehSomenteQuantidade = ehFerramentalSomenteQuantidade(ferramentaNome)
            return (
              <div key={checklist.id} className={`mat-checklist-registro condicao-${checklist.condicao}`}>
                <div className="mat-checklist-registro-cab">
                  <strong>{formatarDataBr(checklist.data_checklist)}</strong>
                  {ehPorLitro
                    ? <span className="mat-condicao-pill">Por litro</span>
                    : ehSerragem || ehSomenteQuantidade || checklist.condicao === 'quantidade'
                    ? <span className="mat-condicao-pill">Por quantidade</span>
                    : <span className={`mat-condicao-pill condicao-${checklist.condicao}`}>
                      {checklist.condicao === 'boa' ? 'Boa' : checklist.condicao === 'media' ? 'Média' : 'Ruim'}
                    </span>}
                </div>
                <div className="mat-checklist-registro-qtd">
                  {ehPorLitro ? 'Litros encontrados' : ehSerragem ? 'Sacos de serragem' : 'Quantidade de itens encontrada'}: {checklist.quantidade_conferida}/{checklist.quantidade_cadastrada || quantidadeCadastrada}
                  {ehPorLitro || ehSomenteQuantidade
                    ? (checklist.quantidade_conferida < 10 ? ' · Repor estoque de óleo/combustível' : '')
                    : ehSerragem
                      ? (checklist.quantidade_conferida <= 2 ? ' · Repor serragem' : '')
                    : (faltantes > 0 ? ` · ${faltantes} item(ns) faltante(s)` : ' · Todos os itens encontrados')}
                </div>
                {!ehSerragem && !ehPorLitro && !ehSomenteQuantidade && faltantes > 0 && (
                  <div className="mat-checklist-falta">
                    <strong>Item faltante:</strong> {checklist.item_faltante || 'Não informado'}
                    {checklist.justificativa ? <><br /><strong>Justificativa:</strong> {checklist.justificativa}</> : null}
                  </div>
                )}
                {checklist.realizado_por && <div className="campo-label-sub">Registrado por {checklist.realizado_por}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FormMaterial({
  existentes, categoria, materialInicial, onCancelar, onSalvo,
}: {
  existentes: string[]
  categoria: 'escritorio' | 'ferramental'
  materialInicial?: Material
  tipo?: 'escritorio' | 'ferramental'
  onCancelar: () => void
  onSalvo: (atualizado?: Material) => void
}) {
  const editando = !!materialInicial
  const [codigo, setCodigo] = useState(materialInicial?.id ?? '')
  const [nome, setNome] = useState(materialInicial?.nome ?? '')
  const [descricao, setDescricao] = useState(materialInicial?.descricao ?? '')
  const [observacoes, setObservacoes] = useState(materialInicial?.observacoes ?? '')
  // foto e fotoThumb só são preenchidos quando o usuário escolhe uma NOVA foto.
  // fotoAlterada=false => não inclui foto no PATCH, preservando a existente no banco.
  const [foto, setFoto] = useState<string | null>(null)
  const [fotoThumb, setFotoThumb] = useState<string | null>(materialInicial?.foto_thumb ?? null)
  const [fotoAlterada, setFotoAlterada] = useState(false)
  const [quantidade, setQuantidade] = useState<number | ''>(materialInicial ? (materialInicial.quantidade ?? 1) : '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const raw = await lerArquivoComoDataUrl(file)
      const [redim, thumb] = await Promise.all([
        redimensionarImagem(raw, 600, 600),
        gerarThumbnail(raw),
      ])
      setFoto(redim)
      setFotoThumb(thumb)
      setFotoAlterada(true)
    } catch {
      alert('Não consegui carregar a foto. Tente outra.')
    }
    e.target.value = ''
  }

  function removerFoto() {
    setFoto(null)
    setFotoThumb(null)
    setFotoAlterada(true)
  }

  async function salvar() {
    const nm = nome.trim()
    if (!nm) { setErro(`Informe o nome ${tipo === 'ferramental' ? 'da ferramenta' : 'do material'}.`); return }
    const quantidadeValida = typeof quantidade === 'number' && Number.isInteger(quantidade) && quantidade >= 1
    if (!quantidadeValida) { setErro('Informe uma quantidade em estoque maior que zero.'); return }
    setSalvando(true); setErro('')
    try {
      if (editando && materialInicial) {
        const patchBody: Record<string, unknown> = {
          nome: nm,
          descricao: descricao.trim() || null,
          observacoes: observacoes.trim() || null,
           quantidade,
          tipo,
        }
        // Só inclui foto/thumb se o usuário trocou ou removeu a foto
        if (fotoAlterada) {
          patchBody.foto = foto
          patchBody.foto_thumb = fotoThumb
        }
        const patchData = await matApi.atualizarMaterial(
          materialInicial.id,
          patchBody as Parameters<typeof matApi.atualizarMaterial>[1]
        )
        onSalvo(patchData as unknown as Material)
      } else {
        const cod = codigo.trim().toUpperCase()
        if (!cod) { setErro('Informe o código do material.'); setSalvando(false); return }
        if (existentes.includes(cod)) { setErro(`Já existe um material com código "${cod}".`); setSalvando(false); return }
        await matApi.criarMaterial({
          id: cod,
          nome: nm,
           categoria,
          descricao: descricao.trim() || null,
          observacoes: observacoes.trim() || null,
          foto,
          foto_thumb: fotoThumb,
           quantidade,
        })
        onSalvo()
      }
    } catch (e: any) {
      setErro(`Erro ao salvar: ${e?.message ?? 'tente novamente'}`)
    }
    setSalvando(false)
  }

  return (
    <div className="mat-tela">
      <div className="mat-subheader">
        <button className="btn-voltar" onClick={onCancelar}>‹</button>
        <h2>{editando
          ? `✏️ Editar ${categoria === 'ferramental' ? 'Ferramental' : 'Material de Escritório'}`
          : `➕ Novo ${categoria === 'ferramental' ? 'Ferramental' : 'Material de Escritório'}`}</h2>
        <span style={{ width: '2rem' }} />
      </div>

      <div className="mat-form">
        {!editando && (
          <div className="campo">
            <label className="campo-label">Código *</label>
            <input
              className="campo-input"
              type="text"
              placeholder="Ex: DC-001"
              value={codigo}
              onChange={(e) => { setCodigo(e.target.value); setErro('') }}
              autoCapitalize="characters"
            />
              <span className="campo-label-sub">Identificador único do item.</span>
          </div>
        )}

        {editando && (
          <div className="campo">
            <label className="campo-label">Código</label>
            <input className="campo-input" type="text" value={codigo} disabled style={{ opacity: 0.5 }} />
            <span className="campo-label-sub">O código não pode ser alterado.</span>
          </div>
        )}

        <div className="campo">
             <label className="campo-label">Nome *</label>
          <input
            className="campo-input"
            type="text"
               placeholder={categoria === 'ferramental' ? 'Ex: Furadeira' : 'Ex: Papel A4'}
            value={nome}
            onChange={(e) => { setNome(e.target.value); setErro('') }}
          />
        </div>

        <div className="campo">
          <label className="campo-label">Quantidade em estoque *</label>
          <input
            className="campo-input"
            type="number"
            min={1}
            max={9999}
            value={quantidade}
             onChange={(e) => {
               const valor = e.target.value
               setQuantidade(valor === '' ? '' : Math.max(1, parseInt(valor) || 1))
             }}
          />
          <span className="campo-label-sub">Quantas unidades deste item existem no total.</span>
        </div>

        <div className="campo">
          <label className="campo-label">Descrição</label>
          <textarea
            className="campo-textarea"
            placeholder="Marca, modelo, características..."
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </div>

        <div className="campo">
          <label className="campo-label">Observações</label>
          <textarea
            className="campo-textarea"
            placeholder="Cuidados, defeitos conhecidos, etc."
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
          />
        </div>

        <div className="campo">
          <label className="campo-label">Foto</label>
          {/* Mostra nova foto escolhida, ou o thumbnail existente (ao editar), ou botões para adicionar */}
          {foto || (editando && fotoThumb && !fotoAlterada) ? (
            <div className="mat-foto-preview">
              <img
                src={foto || fotoThumb || ''}
                alt="material"
                style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 8 }}
              />
              {editando && !fotoAlterada ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label className="mat-foto-remover" style={{ cursor: 'pointer', textAlign: 'center' }}>
                    Trocar foto
                    <input type="file" accept="image/*" onChange={escolherFoto} style={{ display: 'none' }} />
                  </label>
                  <button type="button" className="mat-foto-remover" onClick={removerFoto}>Remover foto</button>
                </div>
              ) : (
                <button type="button" className="mat-foto-remover" onClick={removerFoto}>Remover foto</button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <label className="btn-add-foto" style={{ cursor: 'pointer' }}>
                <span className="btn-foto-emoji">📷</span>
                <span>Tirar Foto</span>
                <input type="file" accept="image/*" capture="environment" onChange={escolherFoto} style={{ display: 'none' }} />
              </label>
              <label className="btn-add-foto" style={{ cursor: 'pointer' }}>
                <span className="btn-foto-emoji">🖼️</span>
                <span>Galeria</span>
                <input type="file" accept="image/*" onChange={escolherFoto} style={{ display: 'none' }} />
              </label>
            </div>
          )}
        </div>

        {erro && <div className="login-erro" style={{ marginBottom: '0.8rem' }}>{erro}</div>}

        <button className="btn-salvar" onClick={salvar} disabled={salvando}>
           {salvando ? '⏳ Salvando...' : editando ? '💾 Salvar Alterações' : `💾 Salvar ${categoria === 'ferramental' ? 'Ferramental' : 'Material'}`}
        </button>
      </div>
    </div>
  )
}

function ChecklistFerramenta({
  ferramenta, onCancelar, onSalvo,
}: {
  ferramenta: Material
  onCancelar: () => void
  onSalvo: (checklist: MatChecklistFerramenta) => void
}) {
  const quantidadeCadastrada = Math.max(1, ferramenta.quantidade ?? 1)
  const ehSerragem = /serragem/i.test(ferramenta.nome)
  const ehPorLitro = ehFerramentalPorLitro(ferramenta.nome)
  const ehSomenteQuantidade = ehFerramentalSomenteQuantidade(ferramenta.nome)
  const ehControlePorQuantidade = ehSerragem || ehPorLitro || ehSomenteQuantidade
  const mostrarCondicao = !ehControlePorQuantidade
  const ehEstoqueLiquido = ehPorLitro || ehSomenteQuantidade
  const [quantidadeConferida, setQuantidadeConferida] = useState(quantidadeCadastrada)
  const [condicao, setCondicao] = useState<'boa' | 'media' | 'ruim' | ''>('')
  const [itemFaltante, setItemFaltante] = useState('')
  const [justificativa, setJustificativa] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const quantidadeFaltante = Math.max(0, quantidadeCadastrada - quantidadeConferida)

  async function salvar() {
    if (mostrarCondicao && !condicao) { setErro('Marque a condição da ferramenta.'); return }
    if (mostrarCondicao && quantidadeConferida < quantidadeCadastrada &&
        !itemFaltante.trim() && !justificativa.trim()) {
      setErro('Informe onde está o item ou justifique a falta.')
      return
    }
    setSalvando(true)
    setErro('')
    try {
      const checklist = await matApi.criarChecklistFerramenta({
        ferramenta_id: ferramenta.id,
         ferramenta_nome: ferramenta.nome,
        quantidade_cadastrada: quantidadeCadastrada,
        quantidade_conferida: quantidadeConferida,
         condicao: ehControlePorQuantidade ? 'quantidade' : condicao as 'boa' | 'media' | 'ruim',
         item_faltante: mostrarCondicao && quantidadeFaltante > 0 ? itemFaltante.trim() : null,
         justificativa: mostrarCondicao && quantidadeFaltante > 0 ? justificativa.trim() : null,
        realizado_por: getAgenteLogado() || null,
      })
      onSalvo(checklist)
    } catch (e: any) {
      setErro(`Erro ao salvar: ${e?.message ?? 'tente novamente'}`)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="mat-tela">
      <div className="mat-subheader">
        <button className="btn-voltar" onClick={onCancelar}>‹</button>
        <h2>🧰 Checklist da ferramenta</h2>
        <span style={{ width: '2rem' }} />
      </div>

      <div className="mat-form">
        <div className="mat-checklist-identificacao">
          <span className="mat-card-codigo">{ferramenta.id}</span>
          <strong>{ferramenta.nome}</strong>
          <span className="campo-label-sub">
            {ehSomenteQuantidade
              ? 'Informe a quantidade de itens encontrada'
              : ehPorLitro
              ? 'Informe a quantidade disponível em litros'
              : ehSerragem
                ? 'Informe a quantidade de sacos em estoque'
                : 'Conferência de estoque e condição'}
          </span>
        </div>

        <div className="campo">
          <label className="campo-label">Quantidade cadastrada</label>
          <input className="campo-input" type="number" value={quantidadeCadastrada} disabled />
        </div>

        <div className="campo">
          <label className="campo-label">
            {ehSomenteQuantidade
              ? 'Quantidade de itens encontrada *'
              : ehPorLitro
              ? 'Quantidade em litros encontrada *'
              : ehSerragem
                ? 'Quantidade de sacos de serragem encontrada *'
                : 'Quantidade de itens encontrada *'}
          </label>
          <input
            className="campo-input"
            type="number"
            min={0}
            max={quantidadeCadastrada}
            value={quantidadeConferida}
            onChange={(e) => {
              const valor = Math.min(quantidadeCadastrada, Math.max(0, parseInt(e.target.value, 10) || 0))
              setQuantidadeConferida(valor)
              setErro('')
            }}
          />
          <span className={`campo-label-sub ${quantidadeFaltante > 0 ? 'mat-checklist-alerta' : ''}`}>
            {quantidadeFaltante > 0
              ? `Atenção: ${quantidadeFaltante} item(ns) a menos que o cadastrado.`
              : 'Todos os itens cadastrados foram encontrados.'}
          </span>
        </div>

        {mostrarCondicao && quantidadeFaltante > 0 && (
          <div className="mat-checklist-falta-form">
            <div className="mat-checklist-falta-form-titulo">⚠️ Item faltante</div>
            <div className="campo">
              <label className="campo-label">Onde está o item faltante?</label>
              <input
                className="campo-input"
                type="text"
                placeholder="Ex: Em manutenção, com o agente João..."
                value={itemFaltante}
                onChange={(e) => { setItemFaltante(e.target.value); setErro('') }}
              />
            </div>
            <div className="campo">
              <label className="campo-label">Justificativa (se não souber onde está)</label>
              <textarea
                className="campo-textarea"
                placeholder="Explique o motivo da falta."
                value={justificativa}
                onChange={(e) => { setJustificativa(e.target.value); setErro('') }}
              />
            </div>
          </div>
        )}

        {mostrarCondicao && <div className="campo">
          <label className="campo-label">Condição da ferramenta *</label>
          <div className="mat-condicao-opcoes">
            {([
              ['boa', '✅ Boa', 'Em perfeito estado de uso'],
              ['media', '⚠️ Média', 'Apresenta sinais de uso'],
              ['ruim', '❌ Ruim', 'Precisa de reparo ou substituição'],
            ] as const).map(([valor, titulo, descricao]) => (
              <label key={valor} className={`mat-condicao-opcao ${condicao === valor ? `selecionada condicao-${valor}` : ''}`}>
                <input
                  type="radio"
                  name="condicao-ferramenta"
                  value={valor}
                  checked={condicao === valor}
                  onChange={() => { setCondicao(valor); setErro('') }}
                />
                <span>
                  <strong>{titulo}</strong>
                  <small>{descricao}</small>
                </span>
              </label>
            ))}
          </div>
        </div>}

        {ehEstoqueLiquido && quantidadeConferida < 10 && (
          <div className="mat-checklist-alerta" role="status">
            ⚠️ Atenção: estoque baixo ({quantidadeConferida} {ehPorLitro ? `litro${quantidadeConferida === 1 ? '' : 's'}` : `item${quantidadeConferida === 1 ? '' : 'ns'}`}). O Radar Codap mostrará uma notificação em “Checklists de ferramentas”.
          </div>
        )}

        {ehSerragem && quantidadeConferida <= 2 && (
          <div className="mat-checklist-alerta" role="status">
            ⚠️ Atenção: estoque baixo. O Radar Codap mostrará a mensagem “Repor serragem”.
          </div>
        )}

        {erro && <div className="login-erro" style={{ marginBottom: '0.8rem' }}>{erro}</div>}

        <button className="btn-salvar" onClick={salvar} disabled={salvando}>
          {salvando ? '⏳ Registrando...' : '✅ Salvar checklist'}
        </button>
      </div>
    </div>
  )
}

function FormNovoEmprestimo({
  materiais, emprestimos, equipamentos, tipoOperacao, onCancelar, onSalvo,
}: {
  materiais: Material[]
  emprestimos: Emprestimo[]
  equipamentos: EquipamentoCampo[]
  tipoOperacao: 'emprestimo' | 'manutencao'
  onCancelar: () => void
  onSalvo: (novo: Emprestimo) => void
}) {
  const [materialId, setMaterialId] = useState('')
  const [quantidade, setQuantidade] = useState(1)
  const [responsavel, setResponsavel] = useState('')
  const [cpf, setCpf] = useState('')
  const [secretaria, setSecretaria] = useState('')
  const [prazoDias, setPrazoDias] = useState<number | ''>('' )
  const [condicao, setCondicao] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [assinaturaData, setAssinaturaData] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const agente = getAgenteLogado() || ''
  const material = materiais.find((m) => m.id === materialId)
  const dataPrevista = useMemo(() => typeof prazoDias === 'number' && prazoDias >= 1 ? calcularDevolucaoPrevista(prazoDias) : null, [prazoDias])

  // ── Assinatura digital (canvas) ──
  const assinaturaRef = useRef<HTMLCanvasElement>(null)
  const assinandoRef = useRef(false)

  useEffect(() => { setTimeout(() => ajustarCanvasAssinatura(), 50) }, [])

  function ajustarCanvasAssinatura() {
    const canvas = assinaturaRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    const w = Math.max(1, Math.floor(rect.width * ratio))
    const h = Math.max(1, Math.floor(rect.height * ratio))
    if (canvas.width === w && canvas.height === h) return
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
  }

  function pontoAssinatura(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = assinaturaRef.current!
    const rect = canvas.getBoundingClientRect()
    const toque = 'touches' in e ? e.touches[0] || e.changedTouches[0] : null
    const me = e as React.MouseEvent<HTMLCanvasElement>
    const x = (toque ? toque.clientX : me.clientX) - rect.left
    const y = (toque ? toque.clientY : me.clientY) - rect.top
    return { x, y }
  }

  function iniciarAssinatura(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    ajustarCanvasAssinatura()
    const ctx = assinaturaRef.current?.getContext('2d')
    if (!ctx) return
    const p = pontoAssinatura(e)
    assinandoRef.current = true
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  function moverAssinatura(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!assinandoRef.current) return
    e.preventDefault()
    const ctx = assinaturaRef.current?.getContext('2d')
    if (!ctx) return
    const p = pontoAssinatura(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    setAssinaturaData(assinaturaRef.current?.toDataURL('image/png') || '')
  }

  function finalizarAssinatura() {
    if (!assinandoRef.current) return
    assinandoRef.current = false
    setAssinaturaData(assinaturaRef.current?.toDataURL('image/png') || '')
  }

  function limparAssinatura() {
    const canvas = assinaturaRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setAssinaturaData('')
  }

  async function salvar() {
    if (!material) { setErro('Selecione um material.'); return }
    if (!responsavel.trim()) { setErro('Informe o nome de quem está pegando.'); return }
    if (!prazoDias || prazoDias < 1) { setErro('Prazo deve ser de pelo menos 1 dia.'); return }
    if (!assinaturaData) { setErro('A assinatura digital é obrigatória.'); return }
    setSalvando(true); setErro('')
    try {
      const dataPrev = dataPrevista ? dataPrevista.toISOString().slice(0, 10) : null
      const empData = await matApi.criarEmprestimo({
        material_id: material.id,
        material_codigo: material.id,
        material_nome: material.nome,
        responsavel: responsavel.trim(),
        cpf: cpf.trim() || null,
        secretaria: secretaria.trim() || null,
        prazo_dias: typeof prazoDias === 'number' ? prazoDias : 7,
        quantidade: Math.max(1, quantidade),
        data_devolucao_prevista: dataPrev,
        condicao_equipamento: condicao.trim() || null,
        observacoes: observacoes.trim() || null,
        agente_emprestador: agente || null,
        assinatura_data: assinaturaData,
        tipo: tipoOperacao,
      })
      onSalvo(empData as unknown as Emprestimo)
    } catch (e: any) {
      setErro(`Erro ao salvar: ${e?.message ?? 'tente novamente'}`)
    }
    setSalvando(false)
  }

  return (
    <div className="mat-tela">
      <div className="mat-subheader">
        <button className="btn-voltar" onClick={onCancelar}>‹</button>
        <h2>{tipoOperacao === 'manutencao' ? '🔧 Nova Manutenção' : '➕ Novo Empréstimo'}</h2>
        <span style={{ width: '2rem' }} />
      </div>

      <div className="mat-form">
        {materiais.length === 0 ? (
          <div className="lista-vazia" style={{ padding: '2rem 1rem' }}>
            <div style={{ fontSize: '2.5rem' }}>📦</div>
            <div>Nenhum material disponível para empréstimo.</div>
          </div>
        ) : (
          <>
            <div className="campo">
              <label className="campo-label">Material *</label>
              <select
                className="campo-select"
                value={materialId}
                onChange={(e) => {
                  setMaterialId(e.target.value)
                  setQuantidade(1)
                  setErro('')
                }}
              >
                <option value="">— Escolha o item —</option>
                {([
                  { categoria: 'escritorio' as const, label: '📋 Materiais de Escritório' },
                  { categoria: 'ferramental' as const, label: '🧰 Ferramental' },
                ]).map((grupo) => {
                  const itens = materiais.filter((m) => (m.categoria ?? 'escritorio') === grupo.categoria)
                  if (itens.length === 0) return null
                  return (
                    <optgroup key={grupo.categoria} label={grupo.label}>
                      {itens.map((m) => {
                        const disp = m.quantidade != null
                          ? Math.max(0, (m.quantidade ?? 1)
                              - emprestimos.filter(e2 => e2.material_id === m.id && !e2.devolvido_em).reduce((s, e2) => s + (e2.quantidade ?? 1), 0)
                              - equipamentos.filter(c => c.material_id === m.id && c.status === 'ativo').reduce((s, c) => s + (c.quantidade ?? 1), 0))
                          : null
                        const label = disp != null ? `${m.id} — ${m.nome} (${disp} disp.)` : `${m.id} — ${m.nome}`
                        return <option key={m.id} value={m.id} disabled={disp === 0}>{label}</option>
                      })}
                    </optgroup>
                  )
                })}
              </select>
            </div>

            {materialId && (
              <div className="campo">
                <label className="campo-label">Quantidade a emprestar *</label>
                <input
                  className="campo-input"
                  type="number"
                  min={1}
                  max={
                    (() => {
                      const mat = materiais.find(m => m.id === materialId)
                      if (!mat || mat.quantidade == null) return 9999
                      return Math.max(1, (mat.quantidade ?? 1)
                        - emprestimos.filter(e2 => e2.material_id === materialId && !e2.devolvido_em).reduce((s, e2) => s + (e2.quantidade ?? 1), 0)
                        - equipamentos.filter(c => c.material_id === materialId && c.status === 'ativo').reduce((s, c) => s + (c.quantidade ?? 1), 0))
                    })()
                  }
                  value={quantidade}
                  onChange={(e) => setQuantidade(Math.max(1, parseInt(e.target.value) || 1))}
                />
                <span className="campo-label-sub">Quantas unidades serão emprestadas.</span>
              </div>
            )}

            <div className="campo">
              <label className="campo-label">Para (responsável) *</label>
              <input
                className="campo-input"
                type="text"
                placeholder="Nome de quem está pegando"
                value={responsavel}
                onChange={(e) => { setResponsavel(e.target.value); setErro('') }}
              />
            </div>

            <div className="campo">
              <label className="campo-label">CPF</label>
              <input
                className="campo-input"
                type="text"
                inputMode="numeric"
                placeholder="000.000.000-00"
                value={cpf}
                onChange={(e) => setCpf(formatarCpf(e.target.value))}
                maxLength={14}
              />
            </div>

            <div className="campo">
              <label className="campo-label">Secretaria / Órgão</label>
              <input
                className="campo-input"
                type="text"
                placeholder="Ex: Secretaria de Obras"
                value={secretaria}
                onChange={(e) => setSecretaria(e.target.value)}
              />
            </div>

            <div className="campo">
              <label className="campo-label">Prazo (em dias) *</label>
              <input
                className="campo-input"
                type="number"
                min={1}
                max={365}
                value={prazoDias}
                onChange={(e) => { const v = e.target.value; setPrazoDias(v === '' ? '' : Math.max(1, parseInt(v) || 1)) }}
              />
              {dataPrevista && (
                <span className="campo-label-sub">
                  📅 Devolução prevista: <strong>{dataPrevista.toLocaleDateString('pt-BR')}</strong>
                </span>
              )}
            </div>

            <div className="campo">
              <label className="campo-label">Condição do equipamento</label>
              <textarea
                className="campo-textarea"
                placeholder="Ex: Em perfeito estado de funcionamento, sem avarias visíveis."
                value={condicao}
                onChange={(e) => setCondicao(e.target.value)}
              />
            </div>

            <div className="campo">
              <label className="campo-label">Observações</label>
              <textarea
                className="campo-textarea"
                placeholder="Anotações internas (opcional)"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
              />
            </div>

            <div className="campo">
              <label className="campo-label">Emprestador (cedente)</label>
              <input className="campo-input" type="text" value={agente} disabled />
              <span className="campo-label-sub">Preenchido automaticamente com o agente logado.</span>
            </div>

            <div className="campo">
              <label className="campo-label">Assinatura de quem pegou *</label>
              <div className="ck-assinatura-box">
                <canvas
                  ref={assinaturaRef}
                  className="ck-assinatura-canvas"
                  onMouseDown={iniciarAssinatura}
                  onMouseMove={moverAssinatura}
                  onMouseUp={finalizarAssinatura}
                  onMouseLeave={finalizarAssinatura}
                  onTouchStart={iniciarAssinatura}
                  onTouchMove={moverAssinatura}
                  onTouchEnd={finalizarAssinatura}
                />
                {!assinaturaData && <span className="ck-assinatura-placeholder">Assine aqui com o dedo</span>}
              </div>
              <button type="button" className="ck-assinatura-limpar" onClick={limparAssinatura}>Limpar assinatura</button>
            </div>

            {agente && (
              <div className="campo">
                <label className="campo-label">Cedente (emprestador) — nome impresso</label>
                <div className="ck-assinatura-box" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 56, background: '#f0f4ff' }}>
                  <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1a4b8c', letterSpacing: '0.03em' }}>{agente}</span>
                </div>
                <span className="campo-label-sub">Nome do agente que está cedendo o equipamento.</span>
              </div>
            )}

            {erro && <div className="login-erro" style={{ marginBottom: '0.8rem' }}>{erro}</div>}

            <button className="btn-salvar" onClick={salvar} disabled={salvando}>
              {salvando ? '⏳ Registrando...' : tipoOperacao === 'manutencao' ? '✅ Registrar Manutenção + Gerar Termo' : '✅ Registrar Empréstimo + Gerar Termo'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function FormDevolucao({
  emprestimo, onCancelar, onSalvo,
}: {
  emprestimo: Emprestimo
  onCancelar: () => void
  onSalvo: () => void
}) {
  const hoje = new Date().toISOString().slice(0, 10)
  const agente = getAgenteLogado() || ''
  const [data, setData] = useState(hoje)
  const [obs, setObs] = useState('')
  const [recebedor, setRecebedor] = useState(agente)
  const [foto, setFoto] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const raw = await lerArquivoComoDataUrl(file)
      const redim = await redimensionarImagem(raw, 600, 600)
      setFoto(redim)
    } catch {
      alert('Não consegui carregar a foto.')
    }
    e.target.value = ''
  }

  async function salvar() {
    if (!recebedor.trim()) { setErro('Informe quem recebeu o equipamento.'); return }
    setSalvando(true); setErro('')
    try {
      await matApi.registrarDevolucao(emprestimo.id, {
        devolvido_em: new Date(data + 'T12:00:00').toISOString(),
        devolvido_obs: obs.trim() || null,
        devolvido_recebedor: recebedor.trim(),
        devolvido_foto: foto,
      })
      onSalvo()
    } catch (e: any) {
      setErro(`Erro ao salvar: ${e?.message ?? 'tente novamente'}`)
    }
    setSalvando(false)
  }

  return (
    <div className="mat-tela">
      <div className="mat-subheader">
        <button className="btn-voltar" onClick={onCancelar}>‹</button>
        <h2>↩️ Registrar Devolução</h2>
        <span style={{ width: '2rem' }} />
      </div>

      <div className="mat-form">
        <div className="mat-empr-cab" style={{ marginBottom: '1rem' }}>
          <div>
            <div className="mat-empr-mat">📦 {emprestimo.material_codigo} — {emprestimo.material_nome}</div>
            <div className="mat-empr-quem">👤 {emprestimo.responsavel}{emprestimo.secretaria ? ` · ${emprestimo.secretaria}` : ''}</div>
          </div>
        </div>

        <div className="campo">
          <label className="campo-label">Data da devolução *</label>
          <input className="campo-input" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>

        <div className="campo">
          <label className="campo-label">Observação</label>
          <textarea
            className="campo-textarea"
            placeholder="Ex: Equipamento devolvido em perfeito estado."
            value={obs}
            onChange={(e) => setObs(e.target.value)}
          />
        </div>

        <div className="campo">
          <label className="campo-label">Foto da devolução</label>
          {foto ? (
            <div className="mat-foto-preview">
              <img src={foto} alt="devolução" />
              <button type="button" className="mat-foto-remover" onClick={() => setFoto(null)}>Remover foto</button>
            </div>
          ) : (
            <label className="btn-add-foto">
              <span className="btn-foto-emoji">📷</span>
              <span>Adicionar foto (opcional)</span>
              <input type="file" accept="image/*" capture="environment" onChange={escolherFoto} style={{ display: 'none' }} />
            </label>
          )}
        </div>

        <div className="campo">
          <label className="campo-label">Quem recebeu *</label>
          <input
            className="campo-input"
            type="text"
            value={recebedor}
            onChange={(e) => { setRecebedor(e.target.value); setErro('') }}
          />
          <span className="campo-label-sub">Por padrão é o agente logado.</span>
        </div>

        {erro && <div className="login-erro" style={{ marginBottom: '0.8rem' }}>{erro}</div>}

        <button className="btn-salvar" onClick={salvar} disabled={salvando}>
          {salvando ? '⏳ Salvando...' : '✅ Confirmar Devolução'}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTAR CATÁLOGO DE MATERIAIS EM EXCEL
// ═══════════════════════════════════════════════════════════════════════════
async function exportarMateriaisExcel(materiais: Material[], emprestimos: Emprestimo[]) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CODAP - Conselheiro Lafaiete'
  wb.created = new Date()

  // ── Busca fotos em lote ──────────────────────────────────────────────────
  // Busca no PostgreSQL local; foto_thumb carregada na listagem é o fallback.
  type FotoLote = { id: string; foto: string | null; foto_placa: string | null; foto_thumb?: string | null }
  let fotosMap = new Map<string, FotoLote>()
  const ids = materiais.map(m => m.id)
  try {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('materiais')
        .select('id,foto,foto_placa,foto_thumb')
        .in('id', ids)
      if (error) throw new Error(error.message)
      for (const f of (data ?? []) as FotoLote[]) {
        fotosMap.set(f.id, { id: f.id, foto: f.foto || null, foto_placa: f.foto_placa || null, foto_thumb: f.foto_thumb || null })
      }
    } else {
      const idsStr = ids.join(',')
      const resLocal = await fetch(`/api/materiais/fotos-lote?ids=${encodeURIComponent(idsStr)}`)
      if (resLocal.ok) {
        const dados: FotoLote[] = await resLocal.json()
        for (const f of dados) {
          fotosMap.set(f.id, {
            id: f.id,
            foto: f.foto || null,
            foto_placa: f.foto_placa || null,
            foto_thumb: f.foto_thumb || null,
          })
        }
      }
    }
  } catch { /* continua com foto_thumb em memória se falhar */ }

  // Usa foto_thumb (já carregado na listagem) como fallback final
  const temFotoCol   = materiais.some(m => !!(fotosMap.get(m.id)?.foto || fotosMap.get(m.id)?.foto_thumb || m.foto_thumb))
  const temPlacaCol  = materiais.some(m => !!fotosMap.get(m.id)?.foto_placa)

  // ── Aba 1: Catálogo de Materiais ───────────────────────────────────────
  const ws1 = wb.addWorksheet('Catálogo')
  const colunas: Partial<ExcelJS.Column>[] = [
    { header: 'Código',        key: 'codigo',      width: 16 },
    { header: 'Nome',          key: 'nome',         width: 32 },
    { header: 'Quantidade',    key: 'quantidade',   width: 12 },
    { header: 'Descrição',     key: 'descricao',    width: 36 },
    { header: 'Observações',   key: 'observacoes',  width: 36 },
    { header: 'Status',        key: 'status',       width: 16 },
    { header: 'Cadastrado em', key: 'cadastrado',   width: 18 },
  ]
  if (temFotoCol)  colunas.push({ header: 'Foto',         key: 'foto',       width: 14 })
  if (temPlacaCol) colunas.push({ header: 'Foto (Placa)', key: 'foto_placa', width: 14 })
  ws1.columns = colunas

  const headerRow1 = ws1.getRow(1)
  headerRow1.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A4B8C' } }
  headerRow1.alignment = { vertical: 'middle', horizontal: 'center' }
  headerRow1.height = 22

  const IMG_W  = 90   // px — largura da imagem na célula
  const IMG_H  = 90   // px — altura da imagem na célula
  const ROW_H_PT = 68 // pontos Excel (~90 px) — altura mínima para caber a imagem

  // Índices de coluna 0-based para posicionamento das imagens
  const colIdxFoto      = temFotoCol  ? colunas.findIndex(c => c.key === 'foto')       : -1
  const colIdxFotoPlaca = temPlacaCol ? colunas.findIndex(c => c.key === 'foto_placa') : -1

  const empAtivos = emprestimos.filter(e => !e.devolvido_em)

  materiais.forEach((m, idx) => {
    const emprestado = empAtivos.some(e => e.material_id === m.id || e.material_codigo === m.id)
    const dataRow = ws1.addRow({
      codigo:      m.id,
      nome:        m.nome,
      quantidade:  m.quantidade ?? 1,
      descricao:   m.descricao ?? '',
      observacoes: m.observacoes ?? '',
      status:      emprestado ? 'Emprestado' : 'Disponível',
      cadastrado:  m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR') : '',
    })
    dataRow.getCell('status').font = { color: { argb: emprestado ? 'FFDC2626' : 'FF16A34A' } }

    const fotos = fotosMap.get(m.id)
    // linha 1-based no Excel: header=1, primeira linha de dados=2
    const excelRow = idx + 2

    function embedFoto(dataUrl: string | null | undefined, colIdx: number) {
      if (!dataUrl || colIdx < 0) return
      try {
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
        const ext: 'jpeg' | 'png' = dataUrl.startsWith('data:image/png') ? 'png' : 'jpeg'
        const imgId = wb.addImage({ base64, extension: ext })
        ws1.addImage(imgId, {
          tl: { col: colIdx, row: excelRow - 1 },
          ext: { width: IMG_W, height: IMG_H },
        })
        ws1.getRow(excelRow).height = ROW_H_PT
      } catch { /* ignora imagem inválida */ }
    }

    embedFoto(fotos?.foto || fotos?.foto_thumb || m.foto_thumb, colIdxFoto)
    embedFoto(fotos?.foto_placa,          colIdxFotoPlaca)
  })

  const ultimaColLetra = String.fromCharCode(64 + colunas.length)
  ws1.autoFilter = { from: 'A1', to: `${ultimaColLetra}1` }

  // ── Aba 2: Histórico de Empréstimos ──────────────────────────────────────
  const ws2 = wb.addWorksheet('Empréstimos')
  ws2.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Código', key: 'codigo', width: 14 },
    { header: 'Material', key: 'material', width: 28 },
    { header: 'Tipo', key: 'tipo', width: 14 },
    { header: 'Responsável', key: 'responsavel', width: 24 },
    { header: 'Secretaria', key: 'secretaria', width: 22 },
    { header: 'Qtd', key: 'qtd', width: 8 },
    { header: 'Saída', key: 'saida', width: 14 },
    { header: 'Devolução Prevista', key: 'prevista', width: 18 },
    { header: 'Devolvido em', key: 'devolvido', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Agente', key: 'agente', width: 18 },
  ]

  const headerRow2 = ws2.getRow(1)
  headerRow2.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } }
  headerRow2.alignment = { vertical: 'middle', horizontal: 'center' }
  headerRow2.height = 22

  emprestimos.forEach(e => {
    const devolvido = !!e.devolvido_em
    const row = ws2.addRow({
      id: e.id,
      codigo: e.material_codigo,
      material: e.material_nome,
      tipo: e.tipo === 'manutencao' ? 'Manutenção' : 'Empréstimo',
      responsavel: e.responsavel,
      secretaria: e.secretaria ?? '',
      qtd: e.quantidade ?? 1,
      saida: e.data_emprestimo ? new Date(e.data_emprestimo).toLocaleDateString('pt-BR') : '',
      prevista: e.data_devolucao_prevista ? new Date(e.data_devolucao_prevista).toLocaleDateString('pt-BR') : '',
      devolvido: e.devolvido_em ? new Date(e.devolvido_em).toLocaleDateString('pt-BR') : '',
      status: devolvido ? 'Devolvido' : 'Ativo',
      agente: e.agente_emprestador ?? '',
    })
    row.getCell('status').font = { color: { argb: devolvido ? 'FF16A34A' : 'FFDC2626' } }
  })

  ws2.autoFilter = { from: 'A1', to: 'L1' }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `materiais-dc-${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// ═══════════════════════════════════════════════════════════════════════════
// GERAÇÃO DO TERMO DE EMPRÉSTIMO (PDF via window.print)
// ═══════════════════════════════════════════════════════════════════════════
function gerarTermoEmprestimoPdf(e: Emprestimo, tipoOperacao: 'emprestimo' | 'manutencao' = 'emprestimo') {
  const dataE = new Date(e.data_emprestimo)
  const win = window.open('', '_blank')
  if (!win) {
    alert('Permita pop-ups neste site para gerar o termo.')
    return
  }
  const css = `
    body{font-family:'Times New Roman',Georgia,serif;color:#111827;margin:0;padding:30px 40px;max-width:800px;margin:auto;line-height:1.55}
    .cabecalho{display:flex;align-items:center;gap:14px;border-bottom:3px double #1a4b8c;padding-bottom:10px;margin-bottom:18px}
    .cabecalho img{width:64px;height:64px;object-fit:contain}
    .cabecalho-textos strong{display:block;font-size:15px;color:#1a4b8c;letter-spacing:0.5px}
    .cabecalho-textos span{font-size:11px;color:#374151}
    h1{text-align:center;font-size:20px;letter-spacing:2px;margin:18px 0 22px;color:#1a4b8c;text-transform:uppercase}
    .linha{margin:0.55rem 0;font-size:14px}
    .linha strong{display:inline-block;min-width:130px;color:#374151;font-weight:bold}
    .condicao-box{border:1px solid #6b7280;border-radius:4px;padding:12px 14px;margin:18px 0;background:#f9fafb;min-height:80px}
    .condicao-box strong{display:block;margin-bottom:6px;color:#1a4b8c;font-size:13px}
    .condicao-box p{margin:0;font-size:13px;white-space:pre-wrap}
    .local-data{margin-top:34px;text-align:right;font-size:14px}
    .assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:50px}
    .assinatura{text-align:center}
    .assinatura .img-wrap{height:80px;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid #111827;margin-bottom:6px}
    .assinatura img{max-height:75px;max-width:100%;object-fit:contain}
    .assinatura strong{font-size:13px;display:block;margin-top:4px}
    .assinatura .nome{font-size:12px;color:#374151;margin-top:2px}
    .rodape{margin-top:40px;font-size:10px;color:#6b7280;text-align:center;border-top:1px solid #d1d5db;padding-top:8px}
    button{position:fixed;right:18px;top:18px;padding:10px 16px;background:#166534;color:white;border:0;border-radius:8px;font-weight:bold;cursor:pointer;font-family:Arial,sans-serif;font-size:14px}
    @media print{button{display:none}body{margin:0;padding:18mm}}
  `
  const html = `<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"/><title>${tipoOperacao === 'manutencao' ? 'Termo de Manutenção' : 'Termo de Empréstimo'} #${e.id}</title>
<style>${css}</style>
</head><body>
  <button onclick="window.print()">🖨️ Salvar em PDF</button>
  <div class="cabecalho">
    <span style="font-size:22px;font-weight:900;color:#1a4b8c">C</span>
    <div class="cabecalho-textos">
      <strong>DEFESA CIVIL — CONSELHEIRO LAFAIETE — MG</strong>
      <span>Sistema operacional de campo</span>
    </div>
  </div>

  <h1>${tipoOperacao === 'manutencao' ? 'Termo de Entrega para Manutenção' : 'Termo de Empréstimo'}</h1>

  <div class="linha"><strong>${tipoOperacao === 'manutencao' ? 'Equipamento:' : 'Empréstimo de:'}</strong> ${htmlEscape(e.material_nome)}${e.material_codigo ? ` (cód. ${htmlEscape(e.material_codigo)})` : ''}${(e.quantidade ?? 1) > 1 ? ` — Qtd: ${e.quantidade}` : ''}</div>
  <div class="linha"><strong>Para:</strong> ${htmlEscape(e.responsavel)}</div>
  <div class="linha"><strong>CPF nº:</strong> ${htmlEscape(e.cpf || '—')}</div>
  <div class="linha"><strong>Secretaria:</strong> ${htmlEscape(e.secretaria || '—')}</div>
  <div class="linha"><strong>Prazo:</strong> ${e.prazo_dias} dia${e.prazo_dias !== 1 ? 's' : ''}${e.data_devolucao_prevista ? ` (devolução prevista até ${formatarDataBr(e.data_devolucao_prevista)})` : ''}</div>

  <div class="condicao-box">
    <strong>O equipamento encontra-se nas seguintes condições:</strong>
    <p>${htmlEscape(e.condicao_equipamento || '—')}</p>
  </div>

  <div class="local-data">${htmlEscape(dataExtenso(dataE))}.</div>

  <div class="assinaturas">
    <div class="assinatura">
      <div class="img-wrap" style="align-items:center;justify-content:center;padding-bottom:8px">
        <span style="font-size:13px;font-style:italic;color:#374151">${htmlEscape(e.agente_emprestador || '—')}</span>
      </div>
      <strong>${tipoOperacao === 'manutencao' ? 'Responsável (cedente)' : 'Emprestador (cedente)'}</strong>
      <div class="nome">${htmlEscape(e.agente_emprestador || '—')}</div>
    </div>
    <div class="assinatura">
      <div class="img-wrap">
        ${e.assinatura_data ? `<img src="${e.assinatura_data}" alt="assinatura"/>` : ''}
      </div>
      <strong>${tipoOperacao === 'manutencao' ? 'Recebedor (manutenção)' : 'Emprestado (solicitante)'}</strong>
      <div class="nome">${htmlEscape(e.responsavel)}</div>
    </div>
  </div>

  ${e.observacoes ? `<div class="condicao-box" style="margin-top:30px"><strong>Observações:</strong><p>${htmlEscape(e.observacoes)}</p></div>` : ''}

  <div class="rodape">Termo gerado pelo aplicativo Defesa Civil — registro nº ${e.id}.</div>
</body></html>`
  win.document.write(html)
  win.document.close()
  win.focus()
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL DE IMPORTAÇÃO DE EXCEL (Controle Patrimonial)
// ════════════════════════════════════════════════════════════════════════════
function ImportarExcelModal({
  onFechar,
  onConcluido,
}: {
  onFechar: () => void
  onConcluido: (mensagem: string) => void
}) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [analisando, setAnalisando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoParse | null>(null)
  const [erro, setErro] = useState('')
  const [idsExistentes, setIdsExistentes] = useState<Set<string>>(new Set())
  const [atualizarExistentes, setAtualizarExistentes] = useState(true)

  const [importando, setImportando] = useState(false)
  const [progressoAtual, setProgressoAtual] = useState(0)
  const [progressoLabel, setProgressoLabel] = useState('')

  // Carrega lista atual de materiais para detectar duplicatas
  useEffect(() => {
    matApi.listarMateriais().then((data) => {
      if (Array.isArray(data)) {
        setIdsExistentes(new Set(data.map((m: { id: string }) => m.id)))
      }
    }).catch(() => { /* ignore */ })
  }, [])

  async function selecionarArquivo(f: File) {
    setArquivo(f)
    setErro('')
    setResultado(null)
    setAnalisando(true)
    try {
      const r = await parseExcelPatrimonio(f)
      if (r.itens.length === 0) {
        setErro('Nenhum item válido encontrado na planilha. Confira se há códigos preenchidos na coluna A.')
      } else {
        setResultado(r)
      }
    } catch (e) {
      console.error('[ImportarExcel] erro de parse:', e)
      setErro('Não foi possível ler a planilha. Verifique se o arquivo é um .xlsx válido.')
    }
    setAnalisando(false)
  }

  async function confirmarImport() {
    if (!resultado) return
    setImportando(true)
    setErro('')

    const total = resultado.itens.length
    let criados = 0
    let atualizados = 0
    let ignorados = 0
    let falhas = 0

    for (let i = 0; i < total; i++) {
      const item = resultado.itens[i]
      setProgressoAtual(i + 1)
      setProgressoLabel(`${item.id} — ${item.nome}`)

      const jaExiste = idsExistentes.has(item.id)

      try {
        if (!jaExiste) {
          try {
            await matApi.criarMaterial({ id: item.id, nome: item.nome, descricao: item.descricao ?? null, observacoes: item.observacoes ?? null, foto: item.foto ?? null })
            criados++
          } catch (e: unknown) {
            if ((e as { status?: number })?.status === 409) ignorados++
            else { falhas++; console.warn('[ImportarExcel] falha ao criar', item.id, e) }
          }
        } else if (atualizarExistentes) {
          await matApi.atualizarMaterial(item.id, { nome: item.nome, descricao: item.descricao ?? null, observacoes: item.observacoes ?? null, foto: item.foto ?? null })
          atualizados++
        } else {
          ignorados++
        }
      } catch (e) {
        console.warn('[ImportarExcel] falha em', item.id, e)
        falhas++
      }
    }

    setImportando(false)
    const partes: string[] = []
    if (criados) partes.push(`${criados} criado(s)`)
    if (atualizados) partes.push(`${atualizados} atualizado(s)`)
    if (ignorados) partes.push(`${ignorados} ignorado(s)`)
    if (falhas) partes.push(`${falhas} falha(s)`)
    onConcluido(`✅ Importação concluída — ${partes.join(', ')}`)
  }

  const novosCount = resultado
    ? resultado.itens.filter((i) => !idsExistentes.has(i.id)).length
    : 0
  const existentesCount = resultado ? resultado.itens.length - novosCount : 0
  const comFotoCount = resultado
    ? resultado.itens.filter((i) => i.foto).length
    : 0

  function listarItens(itens: ItemImportado[]) {
    return itens.map((it) => {
      const existe = idsExistentes.has(it.id)
      return (
        <div key={it.id} className="mat-import-preview-item">
          <div className="mat-import-preview-foto">
            {it.foto ? <img src={it.foto} alt={it.nome} /> : '📦'}
          </div>
          <div className="mat-import-preview-info">
            <div className="mat-import-preview-cod">{it.id}</div>
            <div className="mat-import-preview-nome">{it.nome}</div>
          </div>
          <span className={`mat-import-preview-status${existe ? ' existente' : ''}`}>
            {existe ? 'já existe' : 'novo'}
          </span>
        </div>
      )
    })
  }

  return (
    <div className="mat-import-overlay" onClick={(e) => { if (e.target === e.currentTarget && !importando) onFechar() }}>
      <div className="mat-import-modal">
        <div className="mat-import-head">
          <h3>📥 Importar do Excel</h3>
          <button onClick={onFechar} disabled={importando} aria-label="Fechar">✕</button>
        </div>

        <div className="mat-import-body">
          {!resultado && !analisando && (
            <>
              <div className="mat-import-info">
                Selecione a planilha <strong>Controle Patrimonial</strong> (.xlsx).
                <br />
                Cada linha da primeira aba vira um material; as fotos da aba <strong>“Fotos”</strong> são associadas pelo número do patrimônio.
              </div>
              <label className="mat-import-drop">
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) selecionarArquivo(f)
                  }}
                />
                <div className="mat-import-drop-icon">📊</div>
                <div className="mat-import-drop-text">Clique para escolher um arquivo</div>
                <div className="mat-import-drop-sub">apenas arquivos .xlsx</div>
              </label>
            </>
          )}

          {analisando && (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#1a4b8c' }}>
              ⏳ Analisando planilha e extraindo fotos…
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.4rem' }}>
                Pode demorar alguns segundos para arquivos grandes.
              </div>
            </div>
          )}

          {erro && <div className="mat-import-erro">{erro}</div>}

          {resultado && !importando && (
            <>
              <div className="mat-import-resumo">
                <h4>📋 Resumo da planilha</h4>
                <div className="mat-import-resumo-grid">
                  <div><strong>{resultado.itens.length}</strong>itens encontrados</div>
                  <div><strong>{comFotoCount}</strong>com foto</div>
                  <div><strong>{novosCount}</strong>novos</div>
                  <div><strong>{existentesCount}</strong>já cadastrados</div>
                </div>
              </div>

              {existentesCount > 0 && (
                <label className="mat-import-checkbox">
                  <input
                    type="checkbox"
                    checked={atualizarExistentes}
                    onChange={(e) => setAtualizarExistentes(e.target.checked)}
                  />
                  Atualizar nome / descrição / foto dos {existentesCount} itens já cadastrados
                </label>
              )}

              <div className="mat-import-preview">
                {listarItens(resultado.itens)}
              </div>
            </>
          )}

          {importando && (
            <div className="mat-import-progresso">
              <div className="mat-import-progresso-text">
                Importando {progressoAtual} de {resultado!.itens.length}…
              </div>
              <div className="mat-import-progresso-barra">
                <div
                  className="mat-import-progresso-fill"
                  style={{ width: `${(progressoAtual / resultado!.itens.length) * 100}%` }}
                />
              </div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.3rem' }}>
                {progressoLabel}
              </div>
            </div>
          )}
        </div>

        <div className="mat-import-foot">
          <button className="mat-btn-cancelar" onClick={onFechar} disabled={importando}>
            {resultado ? 'Cancelar' : 'Fechar'}
          </button>
          {resultado && (
            <button
              className="mat-btn-confirmar"
              onClick={confirmarImport}
              disabled={importando || (!atualizarExistentes && novosCount === 0)}
            >
              {importando ? 'Importando…' : `Importar ${atualizarExistentes ? resultado.itens.length : novosCount} item(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── DMS GPS helpers (Graus, Minutos, Segundos) ─────────────────────────────
type DmsEdicao = { graus: string; minutos: string; segundos: string; direcao: string }

const DMS_LAT_VAZIO: DmsEdicao = { graus: '', minutos: '', segundos: '', direcao: 'S' }
const DMS_LNG_VAZIO: DmsEdicao = { graus: '', minutos: '', segundos: '', direcao: 'O' }

function decimalParaPartesGms(valor: number | null, positivo: string, negativo: string): DmsEdicao {
  if (valor == null) return { graus: '', minutos: '', segundos: '', direcao: negativo }
  const abs = Math.abs(valor)
  let g = Math.floor(abs)
  const mf = (abs - g) * 60
  let m = Math.floor(mf)
  let sn = Math.round((mf - m) * 6000) / 100
  if (sn >= 60) { sn = 0; m += 1 }
  if (m >= 60) { m = 0; g += 1 }
  return {
    graus: String(g),
    minutos: String(m),
    segundos: sn.toFixed(2).replace('.', ','),
    direcao: valor >= 0 ? positivo : negativo,
  }
}

function partesGmsParaDecimal(
  partes: DmsEdicao,
  negativo: string,
  limiteGraus: number,
  label: string
): number | null {
  const temValor = partes.graus.trim() || partes.minutos.trim() || partes.segundos.trim()
  if (!temValor) return null
  const g = Number(partes.graus.replace(',', '.'))
  const m = Number((partes.minutos || '0').replace(',', '.'))
  const s = Number((partes.segundos || '0').replace(',', '.'))
  if (!Number.isFinite(g) || !Number.isFinite(m) || !Number.isFinite(s))
    throw new Error(`${label}: informe apenas números em graus, minutos e segundos.`)
  if (!Number.isInteger(g) || !Number.isInteger(m) || g < 0 || g > limiteGraus || m < 0 || m >= 60 || s < 0 || s >= 60)
    throw new Error(`${label}: confira os valores de graus, minutos e segundos.`)
  const sinal = partes.direcao === negativo ? -1 : 1
  return parseFloat((sinal * (g + m / 60 + s / 3600)).toFixed(6))
}

// ─── FORM CAMPO ─────────────────────────────────────────────────────────────
function FormCampo({
  materiais,
  onCancelar,
  onSalvo,
}: {
  materiais: Material[]
  onCancelar: () => void
  onSalvo: () => void
}) {
  const agente = getAgenteLogado() || ''
  const [materialId, setMaterialId] = useState('')
  const [materialNome, setMaterialNome] = useState('')
  const [quantidade, setQuantidade] = useState(1)
  const [prazoCampoDias, setPrazoCampoDias] = useState<number | ''>('' )
  const [fotos, setFotos] = useState<string[]>([])
  const [latDms, setLatDms] = useState<DmsEdicao>(DMS_LAT_VAZIO)
  const [lngDms, setLngDms] = useState<DmsEdicao>(DMS_LNG_VAZIO)
  const [obtendoGps, setObtendoGps] = useState(false)
  const [erroGps, setErroGps] = useState('')
  const [rua, setRua] = useState('')
  const [numero, setNumero] = useState('')
  const [bairro, setBairro] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const fotoInputRef = useRef<HTMLInputElement>(null)

  const temGps = !!(latDms.graus.trim() || lngDms.graus.trim())

  function handleMaterial(id: string) {
    setMaterialId(id)
    const m = materiais.find(x => x.id === id)
    setMaterialNome(m?.nome ?? '')
    setQuantidade(1)
  }

  async function adicionarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    for (const file of files) {
      try {
        const raw = await lerArquivoComoDataUrl(file)
        const redim = await redimensionarImagem(raw, 700, 700)
        setFotos(prev => [...prev, redim])
      } catch { /* ignora */ }
    }
    e.target.value = ''
  }

  function obterGps() {
    setObtendoGps(true)
    setErroGps('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatDms(decimalParaPartesGms(pos.coords.latitude, 'N', 'S'))
        setLngDms(decimalParaPartesGms(pos.coords.longitude, 'L', 'O'))
        setObtendoGps(false)
      },
      (err) => {
        setErroGps('Não foi possível obter o GPS: ' + err.message)
        setObtendoGps(false)
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  async function salvar() {
    if (!materialId) { setErro('Selecione o material.'); return }
    setSalvando(true); setErro('')
    try {
      let latitude: number | null = null
      let longitude: number | null = null
      try {
        latitude = partesGmsParaDecimal(latDms, 'S', 90, 'Latitude')
        longitude = partesGmsParaDecimal(lngDms, 'O', 180, 'Longitude')
      } catch (e: any) {
        setErro(e?.message ?? 'Coordenadas inválidas')
        setSalvando(false)
        return
      }
      const dataRecolha = new Date()
      dataRecolha.setDate(dataRecolha.getDate() + Math.max(1, typeof prazoCampoDias === 'number' ? prazoCampoDias : 1))
      await matApi.criarCampo({
        material_id: materialId,
        material_nome: materialNome,
        fotos: fotos.length > 0 ? fotos : null,
        latitude,
        longitude,
        rua: rua.trim() || null,
        numero: numero.trim() || null,
        bairro: bairro.trim() || null,
        observacao: observacao.trim() || null,
        quantidade: Math.max(1, quantidade),
        prazo_dias: typeof prazoCampoDias === 'number' ? Math.max(1, prazoCampoDias) : null,
        data_recolha_prevista: dataRecolha.toISOString().slice(0, 10),
        status: 'ativo',
        agente,
      })
      onSalvo()
    } catch (e: any) {
      setErro('Erro ao salvar: ' + (e?.message ?? 'tente novamente'))
    }
    setSalvando(false)
  }

  return (
    <div className="mat-tela">
      <div className="mat-subheader">
        <button className="btn-voltar" onClick={onCancelar}>‹</button>
        <h2>🚧 Registrar em Campo</h2>
        <span style={{ width: '2rem' }} />
      </div>

      <div className="mat-form">
        <div className="campo">
          <label className="campo-label">Material *</label>
          <select className="campo-select" value={materialId} onChange={(e) => { handleMaterial(e.target.value); setErro('') }}>
            <option value="">— Escolha o material —</option>
            {([
              { categoria: 'escritorio' as const, label: '📋 Materiais de Escritório' },
              { categoria: 'ferramental' as const, label: '🧰 Ferramental' },
            ]).map((grupo) => {
              const itens = materiais.filter((m) => (m.categoria ?? 'escritorio') === grupo.categoria)
              if (itens.length === 0) return null
              return (
                <optgroup key={grupo.categoria} label={grupo.label}>
                  {itens.map((m) => (
                    <option key={m.id} value={m.id}>{m.id} — {m.nome}</option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        </div>

        {materialId && (
          <div className="campo">
            <label className="campo-label">Quantidade em campo *</label>
            <input
              className="campo-input"
              type="number"
              min={1}
              max={materiais.find(m => m.id === materialId)?.quantidade ?? 9999}
              value={quantidade}
              onChange={(e) => setQuantidade(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <span className="campo-label-sub">Quantas unidades estão sendo enviadas ao campo.</span>
          </div>
        )}

        <div className="campo">
          <label className="campo-label">Prazo em campo (dias) *</label>
          <input
            className="campo-input"
            type="number"
            min={1}
            max={365}
            value={prazoCampoDias}
            onChange={(e) => { const v = e.target.value; setPrazoCampoDias(v === '' ? '' : Math.max(1, parseInt(v) || 1)) }}
          />
          {typeof prazoCampoDias === 'number' && prazoCampoDias >= 1 && (
            <span className="campo-label-sub">
              Recolha prevista: {(() => {
                const d = new Date()
                d.setDate(d.getDate() + prazoCampoDias)
                return d.toLocaleDateString('pt-BR')
              })()}
            </span>
          )}
        </div>

        <div className="campo">
          <label className="campo-label">Fotos</label>
          <div className="fotos-grid">
            {fotos.map((f, i) => (
              <div key={i} className="foto-thumb-wrap">
                <img src={f} alt="" className="foto-thumb" />
                <button className="foto-remover" onClick={() => setFotos(prev => prev.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="foto-add-btn" onClick={() => fotoInputRef.current?.click()}>
              <span>📷</span>
              <span>Adicionar foto</span>
            </button>
          </div>
          <input ref={fotoInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={adicionarFoto} />
        </div>

        <div className="campo">
          <label className="campo-label">Localização GPS</label>
          <button className="mat-btn-acao mat-btn-acao-gps" onClick={obterGps} disabled={obtendoGps} style={{ marginBottom: '0.6rem' }}>
            {obtendoGps ? '⏳ Obtendo GPS automático...' : '📡 Obter GPS pelo celular'}
          </button>
          {erroGps && <div className="campo-erro">{erroGps}</div>}

          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.35rem', marginTop: '0.1rem' }}>
            Ou informe manualmente em Graus, Minutos e Segundos (GMS):
          </div>

          {/* Latitude */}
          <div style={{ marginBottom: '0.4rem' }}>
            <div style={{ fontSize: '0.72rem', color: '#374151', marginBottom: '0.2rem', fontWeight: 600 }}>Latitude</div>
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="campo-input" type="number" placeholder="G" min={0} max={90} style={{ width: '3.8rem', flex: 'none' }}
                value={latDms.graus}
                onChange={e => setLatDms(p => ({ ...p, graus: e.target.value }))}
              />
              <span style={{ color: '#374151' }}>°</span>
              <input
                className="campo-input" type="number" placeholder="M" min={0} max={59} style={{ width: '3.8rem', flex: 'none' }}
                value={latDms.minutos}
                onChange={e => setLatDms(p => ({ ...p, minutos: e.target.value }))}
              />
              <span style={{ color: '#374151' }}>'</span>
              <input
                className="campo-input" type="text" placeholder="S" style={{ width: '4.8rem', flex: 'none' }}
                value={latDms.segundos}
                onChange={e => setLatDms(p => ({ ...p, segundos: e.target.value }))}
              />
              <span style={{ color: '#374151' }}>"</span>
              <select
                className="campo-select" style={{ width: '3.5rem', flex: 'none', padding: '0.4rem 0.2rem' }}
                value={latDms.direcao}
                onChange={e => setLatDms(p => ({ ...p, direcao: e.target.value }))}
              >
                <option value="S">S</option>
                <option value="N">N</option>
              </select>
            </div>
          </div>

          {/* Longitude */}
          <div>
            <div style={{ fontSize: '0.72rem', color: '#374151', marginBottom: '0.2rem', fontWeight: 600 }}>Longitude</div>
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="campo-input" type="number" placeholder="G" min={0} max={180} style={{ width: '3.8rem', flex: 'none' }}
                value={lngDms.graus}
                onChange={e => setLngDms(p => ({ ...p, graus: e.target.value }))}
              />
              <span style={{ color: '#374151' }}>°</span>
              <input
                className="campo-input" type="number" placeholder="M" min={0} max={59} style={{ width: '3.8rem', flex: 'none' }}
                value={lngDms.minutos}
                onChange={e => setLngDms(p => ({ ...p, minutos: e.target.value }))}
              />
              <span style={{ color: '#374151' }}>'</span>
              <input
                className="campo-input" type="text" placeholder="S" style={{ width: '4.8rem', flex: 'none' }}
                value={lngDms.segundos}
                onChange={e => setLngDms(p => ({ ...p, segundos: e.target.value }))}
              />
              <span style={{ color: '#374151' }}>"</span>
              <select
                className="campo-select" style={{ width: '3.5rem', flex: 'none', padding: '0.4rem 0.2rem' }}
                value={lngDms.direcao}
                onChange={e => setLngDms(p => ({ ...p, direcao: e.target.value }))}
              >
                <option value="O">O</option>
                <option value="L">L</option>
              </select>
            </div>
          </div>

          {temGps && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#15803d', fontWeight: 600 }}>
                📡 GPS informado
              </span>
              <button
                className="mat-btn-acao"
                style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                onClick={() => { setLatDms(DMS_LAT_VAZIO); setLngDms(DMS_LNG_VAZIO); setErroGps('') }}
              >
                Limpar
              </button>
            </div>
          )}
        </div>

        <div className="campo">
          <label className="campo-label">Endereço</label>
          <input className="campo-input" type="text" placeholder="Rua / Av." value={rua} onChange={(e) => setRua(e.target.value)} />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
            <input className="campo-input" style={{ flex: '0 0 5rem' }} type="text" placeholder="Nº" value={numero} onChange={(e) => setNumero(e.target.value)} />
            <input className="campo-input" style={{ flex: 1 }} type="text" placeholder="Bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} />
          </div>
        </div>

        <div className="campo">
          <label className="campo-label">Observação</label>
          <textarea className="campo-textarea" placeholder="Descreva o local, condição do equipamento, etc." value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </div>

        {erro && <div className="mat-form-erro">{erro}</div>}

        <button className="mat-btn-confirmar" onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando…' : '✅ Registrar em Campo'}
        </button>
      </div>
    </div>
  )
}

// ─── DETALHE CAMPO ───────────────────────────────────────────────────────────
function DetalheCampo({
  item,
  onVoltar,
  onIrParaMapa,
  onDevolver,
  onExcluir,
  onGpsAtualizado,
}: {
  item: EquipamentoCampo
  onVoltar: () => void
  onIrParaMapa?: (lat: number, lng: number, nome?: string) => void
  onDevolver: () => void
  onExcluir: () => void
  onGpsAtualizado?: (lat: number | null, lng: number | null) => void
}) {
  const [fotoIdx, setFotoIdx] = useState(0)
  const [lightboxAberto, setLightboxAberto] = useState(false)
  const fotos = item.fotos ?? []

  // GPS editing state
  const [editandoGps, setEditandoGps] = useState(false)
  const [latDms, setLatDms] = useState<DmsEdicao>(() => decimalParaPartesGms(item.latitude ?? null, 'N', 'S'))
  const [lngDms, setLngDms] = useState<DmsEdicao>(() => decimalParaPartesGms(item.longitude ?? null, 'L', 'O'))
  const [obtendoGps, setObtendoGps] = useState(false)
  const [erroGps, setErroGps] = useState('')
  const [salvandoGps, setSalvandoGps] = useState(false)

  function abrirEdicaoGps() {
    setLatDms(decimalParaPartesGms(item.latitude ?? null, 'N', 'S'))
    setLngDms(decimalParaPartesGms(item.longitude ?? null, 'L', 'O'))
    setErroGps('')
    setEditandoGps(true)
  }

  function obterGpsAtual() {
    setObtendoGps(true)
    setErroGps('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatDms(decimalParaPartesGms(pos.coords.latitude, 'N', 'S'))
        setLngDms(decimalParaPartesGms(pos.coords.longitude, 'L', 'O'))
        setObtendoGps(false)
      },
      (err) => {
        setErroGps('Não foi possível obter o GPS: ' + err.message)
        setObtendoGps(false)
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  async function salvarGps() {
    setSalvandoGps(true)
    setErroGps('')
    try {
      const lat = partesGmsParaDecimal(latDms, 'S', 90, 'Latitude')
      const lng = partesGmsParaDecimal(lngDms, 'O', 180, 'Longitude')
      await matApi.atualizarGpsCampo(item.id, lat, lng)
      onGpsAtualizado?.(lat, lng)
      setEditandoGps(false)
    } catch (e: any) {
      setErroGps(e?.message ?? 'Erro ao salvar GPS')
    }
    setSalvandoGps(false)
  }

  // Helper: formata decimal para GMS legível
  function fmtGms(lat: number, lng: number) {
    return `${decimalParaPartesGms(lat, 'N', 'S').graus}°${decimalParaPartesGms(lat, 'N', 'S').minutos}'${decimalParaPartesGms(lat, 'N', 'S').segundos}"${decimalParaPartesGms(lat, 'N', 'S').direcao}  ${decimalParaPartesGms(lng, 'L', 'O').graus}°${decimalParaPartesGms(lng, 'L', 'O').minutos}'${decimalParaPartesGms(lng, 'L', 'O').segundos}"${decimalParaPartesGms(lng, 'L', 'O').direcao}`
  }

  return (
    <div className="mat-tela">
      <div className="mat-subheader">
        <button className="btn-voltar" onClick={onVoltar}>‹</button>
        <h2>🚧 Detalhe em Campo</h2>
        <button className="mat-btn-excluir" onClick={onExcluir} title="Excluir registro">🗑️</button>
      </div>

      <div className="mat-detalhe">
        {fotos.length > 0 && (
          <div className="mat-campo-fotos-wrap">
            <img
              src={fotos[fotoIdx]}
              alt=""
              className="mat-campo-foto-principal"
              onClick={() => setLightboxAberto(true)}
              title="Clique para ampliar"
            />
            {fotos.length > 1 && (
              <div className="mat-campo-fotos-miniaturas">
                {fotos.map((f, i) => (
                  <button key={i} className={`mat-campo-miniatura ${fotoIdx === i ? 'ativa' : ''}`} onClick={() => setFotoIdx(i)}>
                    <img src={f} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {lightboxAberto && fotos.length > 0 && (
          <div className="mat-lightbox-overlay" onClick={() => setLightboxAberto(false)}>
            <button className="mat-lightbox-fechar" onClick={() => setLightboxAberto(false)}>✕</button>
            <img src={fotos[fotoIdx]} alt="" onClick={e => e.stopPropagation()} />
          </div>
        )}

        <div className="mat-detalhe-bloco">
          <span className="mat-detalhe-label">Material</span>
          <span className="mat-detalhe-valor">{item.material_id} — {item.material_nome}</span>
        </div>

        <div className={`mat-detalhe-status ${item.status === 'ativo' ? 'mat-status-emprestado' : 'mat-status-disponivel'}`}>
          {item.status === 'ativo' ? <strong>🔴 Em campo (Ativo)</strong> : <strong>✅ Devolvido</strong>}
        </div>

        {(item.rua || item.bairro) && (
          <div className="mat-detalhe-bloco">
            <span className="mat-detalhe-label">Endereço</span>
            <span className="mat-detalhe-valor">{[item.rua, item.numero, item.bairro].filter(Boolean).join(', ')}</span>
          </div>
        )}

        {/* GPS — exibição em GMS com edição */}
        <div className="mat-detalhe-bloco">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
            <span className="mat-detalhe-label" style={{ margin: 0 }}>GPS</span>
            {!editandoGps && (
              <button
                className="mat-btn-acao"
                style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem' }}
                onClick={abrirEdicaoGps}
              >
                ✏️ Editar
              </button>
            )}
          </div>

          {!editandoGps ? (
            item.latitude && item.longitude ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
                <div>
                  <div className="mat-detalhe-valor" style={{ fontSize: '0.82rem' }}>
                    {fmtGms(item.latitude, item.longitude)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                    {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}
                  </div>
                </div>
                {onIrParaMapa && (
                  <button className="mat-btn-acao mat-btn-acao-gps" onClick={() => onIrParaMapa(item.latitude!, item.longitude!, item.material_nome || undefined)}>
                    🗺️ Ver no Mapa
                  </button>
                )}
              </div>
            ) : (
              <span className="mat-detalhe-valor" style={{ color: '#9ca3af', fontSize: '0.82rem' }}>Sem GPS registrado</span>
            )
          ) : (
            <div style={{ marginTop: '0.3rem' }}>
              <button
                className="mat-btn-acao mat-btn-acao-gps"
                onClick={obterGpsAtual}
                disabled={obtendoGps}
                style={{ marginBottom: '0.6rem', fontSize: '0.8rem' }}
              >
                {obtendoGps ? '⏳ Obtendo...' : '📡 Obter GPS pelo celular'}
              </button>

              <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: '0.4rem' }}>
                Ou informe manualmente em GMS:
              </div>

              {/* Latitude DMS */}
              <div style={{ marginBottom: '0.4rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#374151', fontWeight: 600, marginBottom: '0.15rem' }}>Latitude</div>
                <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="campo-input" type="number" placeholder="G" min={0} max={90} style={{ width: '3.5rem', flex: 'none' }}
                    value={latDms.graus} onChange={e => setLatDms(p => ({ ...p, graus: e.target.value }))} />
                  <span>°</span>
                  <input className="campo-input" type="number" placeholder="M" min={0} max={59} style={{ width: '3.5rem', flex: 'none' }}
                    value={latDms.minutos} onChange={e => setLatDms(p => ({ ...p, minutos: e.target.value }))} />
                  <span>'</span>
                  <input className="campo-input" type="text" placeholder="S" style={{ width: '4.5rem', flex: 'none' }}
                    value={latDms.segundos} onChange={e => setLatDms(p => ({ ...p, segundos: e.target.value }))} />
                  <span>"</span>
                  <select className="campo-select" style={{ width: '3.2rem', flex: 'none', padding: '0.3rem 0.2rem' }}
                    value={latDms.direcao} onChange={e => setLatDms(p => ({ ...p, direcao: e.target.value }))}>
                    <option value="S">S</option>
                    <option value="N">N</option>
                  </select>
                </div>
              </div>

              {/* Longitude DMS */}
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#374151', fontWeight: 600, marginBottom: '0.15rem' }}>Longitude</div>
                <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="campo-input" type="number" placeholder="G" min={0} max={180} style={{ width: '3.5rem', flex: 'none' }}
                    value={lngDms.graus} onChange={e => setLngDms(p => ({ ...p, graus: e.target.value }))} />
                  <span>°</span>
                  <input className="campo-input" type="number" placeholder="M" min={0} max={59} style={{ width: '3.5rem', flex: 'none' }}
                    value={lngDms.minutos} onChange={e => setLngDms(p => ({ ...p, minutos: e.target.value }))} />
                  <span>'</span>
                  <input className="campo-input" type="text" placeholder="S" style={{ width: '4.5rem', flex: 'none' }}
                    value={lngDms.segundos} onChange={e => setLngDms(p => ({ ...p, segundos: e.target.value }))} />
                  <span>"</span>
                  <select className="campo-select" style={{ width: '3.2rem', flex: 'none', padding: '0.3rem 0.2rem' }}
                    value={lngDms.direcao} onChange={e => setLngDms(p => ({ ...p, direcao: e.target.value }))}>
                    <option value="O">O</option>
                    <option value="L">L</option>
                  </select>
                </div>
              </div>

              {erroGps && <div className="campo-erro" style={{ marginBottom: '0.4rem' }}>{erroGps}</div>}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="mat-btn-confirmar" style={{ flex: 1, padding: '0.5rem' }} onClick={salvarGps} disabled={salvandoGps}>
                  {salvandoGps ? 'Salvando…' : '💾 Salvar GPS'}
                </button>
                <button className="mat-btn-acao" style={{ padding: '0.5rem 0.8rem' }} onClick={() => { setEditandoGps(false); setErroGps('') }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>

        {item.observacao && (
          <div className="mat-detalhe-bloco">
            <span className="mat-detalhe-label">Observação</span>
            <span className="mat-detalhe-valor">{item.observacao}</span>
          </div>
        )}

        {item.agente && (
          <div className="mat-detalhe-bloco">
            <span className="mat-detalhe-label">Registrado por</span>
            <span className="mat-detalhe-valor">{item.agente}</span>
          </div>
        )}

        <div className="mat-detalhe-bloco">
          <span className="mat-detalhe-label">Data</span>
          <span className="mat-detalhe-valor">{new Date(item.created_at).toLocaleDateString('pt-BR')}</span>
        </div>

        {item.status === 'ativo' && (
          <button className="mat-btn-confirmar" style={{ marginTop: '0.5rem' }} onClick={onDevolver}>
            ✅ Marcar como Devolvido
          </button>
        )}
      </div>
    </div>
  )
}

