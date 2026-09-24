import { useState, useEffect, useRef } from 'react'
import { adicionarMarcaDagua, salvarFotoNoDispositivo } from '../utils'
import type { ChecklistExportData } from '../exportExcel'
import { buscarFotosChecklists } from '../api'
import ModalSenha from './ModalSenha'
import { wsOn, wsSend } from '../wsClient'
import { supabase, supabaseDisponivel } from '../supabaseClient'
import { AGENTES, getSenhaAgente, normalizarNomeAgente } from '../types'
import { getAgenteLogado } from './Login'

const MOTORISTAS = AGENTES
const CHECKLIST_LOCAL_KEY = 'checklists-pendentes-v1'

function carregarChecklistsLocais(): ChecklistData[] {
  try {
    const raw = localStorage.getItem(CHECKLIST_LOCAL_KEY)
    if (!raw) return []
    return JSON.parse(raw) as ChecklistData[]
  } catch { return [] }
}

function salvarChecklistLocal(payload: Omit<ChecklistData, 'id' | 'created_at'>) {
  const pendentes = carregarChecklistsLocais()
  const item = { ...payload, id: -(Date.now()), created_at: new Date().toISOString(), _local: true } as unknown as ChecklistData
  pendentes.unshift(item)
  localStorage.setItem(CHECKLIST_LOCAL_KEY, JSON.stringify(pendentes.slice(0, 50)))
  return item
}

function removerChecklistLocal(id: number) {
  const pendentes = carregarChecklistsLocais().filter(c => (c as unknown as Record<string, unknown>).id !== id)
  localStorage.setItem(CHECKLIST_LOCAL_KEY, JSON.stringify(pendentes))
}

async function sincronizarChecklistsPendentes(): Promise<number> {
  const todos = carregarChecklistsLocais()
  const pendentes = todos.filter(c => (c as unknown as Record<string, unknown>)._local === true)
  if (!pendentes.length) return 0
  let sincronizados = 0
  for (const item of pendentes) {
    const { id, created_at, _local, ...payload } = item as unknown as Record<string, unknown>
    void _local; void created_at
    try {
      if (supabaseDisponivel) {
        const { error } = await supabase.from('checklists_viatura').insert(payload)
        if (error) continue
      } else {
        const res = await fetch('/api/checklists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) continue
      }
      removerChecklistLocal(id as number)
      sincronizados++
    } catch {
      // sem conexão ainda, tenta no próximo evento online
    }
  }
  return sincronizados
}

type Opc3 = 'bom' | 'medio' | 'ruim' | ''
type OpcSN = 'sim' | 'nao' | 'na' | ''
type NivelCombustivel = '' | 'E' | '1/4' | '1/2' | '3/4' | 'F'
type FotoOrigem = 'camera' | 'carregada'
type FotoVeiculo = 'frontal' | 'traseira' | 'direita' | 'esquerda'

const NIVEIS_COMBUSTIVEL: { v: Exclude<NivelCombustivel, ''>; label: string }[] = [
  { v: 'E', label: 'E' },
  { v: '1/4', label: '1/4' },
  { v: '1/2', label: '1/2' },
  { v: '3/4', label: '3/4' },
  { v: 'F', label: 'F' },
]

interface Itens {
  limpezaExterna: Opc3; limpezaInterna: Opc3; pneus: Opc3; estepe: Opc3
  ltzPlaca: OpcSN; ltzDirLuz: OpcSN; ltzDirLuzRe: OpcSN; ltzDirFreio: OpcSN; ltzDirSeta: OpcSN
  ltzEsqLuz: OpcSN; ltzEsqLuzRe: OpcSN; ltzEsqFreio: OpcSN; ltzEsqSeta: OpcSN
  ldzPlaca: OpcSN; ldzDirFarolAlto: OpcSN; ldzDirFarolBaixo: OpcSN; ldzDirNeblina: OpcSN
  ldzEsqFarolAlto: OpcSN; ldzEsqFarolBaixo: OpcSN; ldzEsqSeta: OpcSN; ldzEsqNeblina: OpcSN
  segAlarme: OpcSN; segBuzina: OpcSN; segChaveRoda: OpcSN; segCintos: OpcSN
  segDocumentos: OpcSN; segExtintor: OpcSN; segLimpadores: OpcSN; segMacaco: OpcSN
  segPainel: OpcSN; segRetrovisorInterno: OpcSN; segRetrovisorDireito: OpcSN
  segRetrovisorEsquerdo: OpcSN; segTravas: OpcSN; segTriangulo: OpcSN
  emerIluminacaoGiroflex: OpcSN; emerMultimidia: OpcSN; emerSirene: OpcSN; emerStrobo: OpcSN
  motAcelerador: OpcSN; motAguaLimpador: OpcSN; motAguaRadiador: OpcSN
  motEmbreagem: OpcSN; motFreio: OpcSN; motFreioMao: OpcSN
  motOleoFreio: OpcSN; motOleoMoto: OpcSN; motTanquePartida: OpcSN
  nivelCombustivel?: NivelCombustivel
  _fotosCarregadas?: FotoVeiculo[]
}

function itensIniciais(): Itens {
  return {
    limpezaExterna: '', limpezaInterna: '', pneus: '', estepe: '',
    ltzPlaca: '', ltzDirLuz: '', ltzDirLuzRe: '', ltzDirFreio: '', ltzDirSeta: '',
    ltzEsqLuz: '', ltzEsqLuzRe: '', ltzEsqFreio: '', ltzEsqSeta: '',
    ldzPlaca: '', ldzDirFarolAlto: '', ldzDirFarolBaixo: '', ldzDirNeblina: '',
    ldzEsqFarolAlto: '', ldzEsqFarolBaixo: '', ldzEsqSeta: '', ldzEsqNeblina: '',
    segAlarme: '', segBuzina: '', segChaveRoda: '', segCintos: '', segDocumentos: '',
    segExtintor: '', segLimpadores: '', segMacaco: '', segPainel: '',
    segRetrovisorInterno: '', segRetrovisorDireito: '', segRetrovisorEsquerdo: '',
    segTravas: '', segTriangulo: '',
    emerIluminacaoGiroflex: '', emerMultimidia: '', emerSirene: '', emerStrobo: '',
    motAcelerador: '', motAguaLimpador: '', motAguaRadiador: '', motEmbreagem: '',
    motFreio: '', motFreioMao: '', motOleoFreio: '', motOleoMoto: '', motTanquePartida: '',
    nivelCombustivel: '',
  }
}

function NivelCombustivelGauge({
  valor, onChange,
}: { valor: NivelCombustivel; onChange?: (v: NivelCombustivel) => void }) {
  const readOnly = !onChange
  return (
    <div className="ck-comb">
      <div className="ck-comb-titulo">NÍVEL DE COMBUSTÍVEL</div>
      <div className="ck-comb-bar">
        {NIVEIS_COMBUSTIVEL.map(n => {
          const ativo = valor === n.v
          return (
            <button
              key={n.v}
              type="button"
              className={`ck-comb-cell${ativo ? ' ck-comb-cell-ativo' : ''}`}
              style={readOnly ? { cursor: 'default' } : undefined}
              onClick={() => { if (onChange) onChange(ativo ? '' : n.v) }}
              disabled={readOnly}
            >
              {n.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type ChecklistData = ChecklistExportData

function normalizarChecklist(c: ChecklistData): ChecklistData {
  return {
    ...c,
    motorista: c.motorista ? normalizarNomeAgente(c.motorista) : c.motorista,
  }
}

type Modo = 'lista' | 'form' | 'detalhe'

const OPT_BMR = ['bom', 'medio', 'ruim']
const OPT_SN = ['sim', 'nao', 'na']

const ITENS_PDF: [keyof Itens, string, 'bmr' | 'sn'][] = [
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
  ['emerIluminacaoGiroflex', 'Iluminação Giroflex', 'sn'],
  ['emerMultimidia', 'Multimídia', 'sn'],
  ['emerSirene', 'Sirene', 'sn'],
  ['emerStrobo', 'Strobo', 'sn'],
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


function CarFront() {
  return (
    <svg viewBox="0 0 120 75" fill="none" xmlns="http://www.w3.org/2000/svg" width="72" height="45">
      <rect x="6" y="28" width="108" height="40" rx="7" fill="#cbd5e1"/>
      <path d="M28 28 L38 8 L82 8 L92 28 Z" fill="#b8c4ce"/>
      <path d="M32 28 L41 11 L79 11 L88 28 Z" fill="#bfdbfe" opacity="0.9"/>
      <rect x="7" y="32" width="24" height="13" rx="5" fill="#fde68a"/>
      <rect x="89" y="32" width="24" height="13" rx="5" fill="#fde68a"/>
      <rect x="40" y="55" width="40" height="9" rx="3" fill="#94a3b8"/>
      <rect x="6" y="50" width="14" height="16" rx="4" fill="#b8c4ce"/>
      <rect x="100" y="50" width="14" height="16" rx="4" fill="#b8c4ce"/>
    </svg>
  )
}

function CarRear() {
  return (
    <svg viewBox="0 0 120 75" fill="none" xmlns="http://www.w3.org/2000/svg" width="72" height="45">
      <rect x="6" y="28" width="108" height="40" rx="7" fill="#cbd5e1"/>
      <path d="M28 28 L38 8 L82 8 L92 28 Z" fill="#b8c4ce"/>
      <path d="M34 28 L43 12 L77 12 L86 28 Z" fill="#bfdbfe" opacity="0.9"/>
      <rect x="7" y="32" width="24" height="13" rx="5" fill="#fca5a5"/>
      <rect x="89" y="32" width="24" height="13" rx="5" fill="#fca5a5"/>
      <rect x="40" y="57" width="40" height="7" rx="2" fill="#94a3b8"/>
      <rect x="6" y="50" width="14" height="16" rx="4" fill="#b8c4ce"/>
      <rect x="100" y="50" width="14" height="16" rx="4" fill="#b8c4ce"/>
    </svg>
  )
}

function CarSide({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 160 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="90" height="45"
      style={flip ? { transform: 'scaleX(-1)' } : {}}>
      <path d="M12 54 L12 36 L48 14 L112 14 L142 36 L148 54 Z" fill="#cbd5e1"/>
      <path d="M50 36 L58 17 L110 17 L120 36 Z" fill="#bfdbfe" opacity="0.9"/>
      <line x1="78" y1="17" x2="78" y2="36" stroke="#94a3b8" strokeWidth="2.5"/>
      <circle cx="36" cy="60" r="14" fill="#64748b"/>
      <circle cx="36" cy="60" r="7" fill="#94a3b8"/>
      <circle cx="122" cy="60" r="14" fill="#64748b"/>
      <circle cx="122" cy="60" r="7" fill="#94a3b8"/>
      <rect x="3" y="44" width="11" height="16" rx="4" fill="#b8c4ce"/>
      <rect x="146" y="44" width="11" height="16" rx="4" fill="#b8c4ce"/>
    </svg>
  )
}

function redimensionarImagem(dataUrl: string, maxW: number, maxH: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let w = img.width; let h = img.height
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h)
        w = Math.round(w * ratio); h = Math.round(h * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      const result = canvas.toDataURL('image/jpeg', 0.45)
      canvas.width = 0; canvas.height = 0
      resolve(result)
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

interface FotoSlotHProps {
  label: string
  foto: string | null
  onFoto: (b64: string, origem: FotoOrigem) => void
  children: React.ReactNode
}

function FotoSlotH({ label, foto, onFoto, children }: FotoSlotHProps) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)

  async function processarArquivo(file: File, origem: FotoOrigem) {
    return new Promise<void>((resolve) => {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        if (ev.target?.result) {
          const redim = await redimensionarImagem(ev.target.result as string, 800, 600)
          const comMarca = await adicionarMarcaDagua(redim, null, null, 800, 0.45)
          onFoto(comMarca, origem)
          salvarFotoNoDispositivo(comMarca)
        }
        resolve()
      }
      reader.readAsDataURL(file)
    })
  }

  function handleCamera(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processarArquivo(file, 'camera')
    e.target.value = ''
  }

  function handleGaleria(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processarArquivo(file, 'carregada')
    e.target.value = ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleCamera} />
      <input ref={galeriaRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleGaleria} />
      <div className="ck-foto-slot" onClick={() => cameraRef.current?.click()}>
        {foto ? (
          <>
            <img src={foto} alt={label} className="ck-foto-img" />
            <span className="ck-foto-nome">{label}</span>
          </>
        ) : (
          <div className="ck-foto-empty">
            <div className="ck-foto-icon">{children}</div>
            <span className="ck-foto-label">{label}</span>
            <span className="ck-foto-hint">📷</span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => galeriaRef.current?.click()}
        style={{
          background: 'none', border: 'none', color: '#1a4b8c',
          fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline',
          padding: '0.1rem 0.3rem',
        }}
      >
        📁 Carregar foto
      </button>
    </div>
  )
}

function RadioDot({ value, atual, onChange }: { value: string; atual: string; onChange: (v: string) => void }) {
  const ativo = atual === value
  return (
    <div
      className={`ck-dot${ativo ? ` ck-dot-${value}` : ''}`}
      onClick={(e) => { e.stopPropagation(); onChange(ativo ? '' : value) }}
    />
  )
}

function CkRow({ label, campo, itens, onChange, opcoes }: {
  label: string; campo: keyof Itens; itens: Itens
  onChange: (k: keyof Itens, v: string) => void; opcoes: string[]
}) {
  return (
    <div className="ck-row">
      <span className="ck-row-label">{label}</span>
      {opcoes.map(o => (
        <div key={o} className="ck-row-cell">
          <RadioDot value={o} atual={itens[campo] as string} onChange={(v) => onChange(campo, v)} />
        </div>
      ))}
    </div>
  )
}

function CkSecRow({ label }: { label: string }) {
  return <div className="ck-sec-row">{label}</div>
}

function CkHeader({ cols }: { cols: string[] }) {
  return (
    <div className="ck-header-row">
      <span className="ck-row-label" />
      {cols.map(c => <span key={c} className="ck-header-cell">{c}</span>)}
    </div>
  )
}

function formatarData(iso: string) {
  const dataIso = String(iso || '').split('T')[0]
  const [y, m, d] = dataIso.split('-')
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const dt = new Date(Number(y), Number(m) - 1, Number(d), 12)
  return `${dias[dt.getDay()]}, ${d}/${m}/${y}`
}

function dataLocalInput(data = new Date()) {
  const y = data.getFullYear()
  const m = String(data.getMonth() + 1).padStart(2, '0')
  const d = String(data.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dataCurta(iso: string) {
  const dataIso = String(iso || '').split('T')[0]
  const [y, m, d] = dataIso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : '—'
}

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function mesLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-')
  return `${MESES_PT[Number(m) - 1]} ${y}`
}

export default function ChecklistViatura({ abrirId }: { abrirId?: number | null } = {}) {
  const [modo, setModo] = useState<Modo>('lista')
  const [checklists, setChecklists] = useState<ChecklistData[]>([])
  const [carregando, setCarregando] = useState(true)
  const [selecionado, setSelecionado] = useState<ChecklistData | null>(null)
  const [fotoAmpliada, setFotoAmpliada] = useState<{ src: string; label: string } | null>(null)

  const [mesesArquivo, setMesesArquivo] = useState<string[]>([])
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(null)
  const [checklistsArquivo, setChecklistsArquivo] = useState<ChecklistData[]>([])
  const [carregandoArquivo, setCarregandoArquivo] = useState(false)
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false)
  const [excelProgresso, setExcelProgresso] = useState<string | null>(null)

  const hoje = dataLocalInput()
  const mesAtual = hoje.substring(0, 7)
  const [data, setData] = useState(hoje)
  const [km, setKm] = useState('')
  const [placa, setPlaca] = useState('RUA4A46')
  const [editandoPlaca, setEditandoPlaca] = useState(false)
  const [motorista, setMotorista] = useState('')
  const [motoristaOutro, setMotoristaOutro] = useState(false)
  const [fotosAvarias, setFotosAvarias] = useState<string[]>([])
  const [fotoFrontal, setFotoFrontal] = useState<string | null>(null)
  const [fotoTraseira, setFotoTraseira] = useState<string | null>(null)
  const [fotoDireita, setFotoDireita] = useState<string | null>(null)
  const [fotoEsquerda, setFotoEsquerda] = useState<string | null>(null)
  const [itens, setItens] = useState<Itens>(itensIniciais())
  const [observacoes, setObservacoes] = useState('')
  const [assinaturaData, setAssinaturaData] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [pedindoSenhaDeletar, setPedindoSenhaDeletar] = useState<number | null>(null)
  const agenteLogadoCk = getAgenteLogado()
  const senhaAgenteCk = getSenhaAgente(agenteLogadoCk)

  useEffect(() => {
    if (!fotoAmpliada) return
    const fecharComEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFotoAmpliada(null)
    }
    document.addEventListener('keydown', fecharComEsc)
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', fecharComEsc)
      document.body.style.overflow = overflowAnterior
    }
  }, [fotoAmpliada])

  function solicitarDeletar(id: number) {
    if (senhaAgenteCk) {
      setPedindoSenhaDeletar(id)
    } else {
      deletar(id)
    }
  }

  const avariaRef = useRef<HTMLInputElement>(null)
  const avariaGaleriaRef = useRef<HTMLInputElement>(null)
  const assinaturaRef = useRef<HTMLCanvasElement>(null)
  const assinandoRef = useRef(false)

  function setItem(k: keyof Itens, v: string) {
    setItens(prev => ({ ...prev, [k]: v }))
  }

  function atualizarFotoVeiculo(campo: FotoVeiculo, setFoto: (foto: string) => void) {
    return (foto: string, origem: FotoOrigem) => {
      setFoto(foto)
      setItens(prev => {
        const atuais = prev._fotosCarregadas || []
        const atualizados = origem === 'carregada'
          ? [...new Set([...atuais, campo])]
          : atuais.filter(item => item !== campo)
        return { ...prev, _fotosCarregadas: atualizados.length > 0 ? atualizados : undefined }
      })
    }
  }

  function respostaExpressValida(res: Response): boolean {
    if (!res.ok) return false
    const ct = res.headers.get('content-type') || ''
    return !ct.includes('text/html')
  }

  async function carregarChecklistCompleto(id: number): Promise<ChecklistData | null> {
    if (supabaseDisponivel) {
      try {
        const { data, error } = await supabase
          .from('checklists_viatura')
          .select('*')
          .eq('id', id)
          .single()
        if (error || !data) return null
        return normalizarChecklist(data as ChecklistData)
      } catch { return null }
    }
    try {
      const res = await fetch(`/api/checklists/${id}`)
      if (!res.ok) return null
      return await res.json() as ChecklistData
    } catch { return null }
  }

  async function abrirDetalhe(c: ChecklistData) {
    setSelecionado(c)
    setModo('detalhe')
    if ((c as Record<string, unknown>)._local) return
    setCarregandoDetalhe(true)
    const completo = await carregarChecklistCompleto(c.id)
    if (completo) setSelecionado(completo)
    setCarregandoDetalhe(false)
  }

  async function carregar() {
    setCarregando(true)
    const locais = carregarChecklistsLocais().map(normalizarChecklist)
    if (supabaseDisponivel) {
      try {
        const { data } = await supabase
          .from('checklists_viatura')
          .select('id, data_checklist, km, placa, motorista, itens, observacoes, created_at')
          .order('created_at', { ascending: false })
          .limit(100)
        const servidor = (Array.isArray(data) ? data : []).map(item => normalizarChecklist(item as ChecklistData))
        setChecklists([...locais, ...servidor])
      } catch (e) {
        console.warn('[Checklist] erro ao carregar:', e)
        setChecklists(locais)
      }
      setCarregando(false)
      return
    }
    try {
      const res = await fetch('/api/checklists')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const servidor = (Array.isArray(data) ? data : []).map(item => normalizarChecklist(item as ChecklistData))
      setChecklists([...locais, ...servidor])
    } catch (e) {
      console.warn('[Checklist] erro ao carregar:', e)
      setChecklists(locais)
    }
    setCarregando(false)
  }

  async function carregarMeses() {
    if (supabaseDisponivel) {
      try {
        const { data } = await supabase
          .from('checklists_viatura')
          .select('data_checklist')
          .order('data_checklist', { ascending: false })
        if (data) {
          const todos = [...new Set(
            (data as { data_checklist: string }[])
              .map(r => (r.data_checklist || '').substring(0, 7))
              .filter(m => m && m.length === 7)
          )].sort().reverse()
          setMesesArquivo(todos.filter(m => m < mesAtual))
        }
      } catch { /* silencioso */ }
      return
    }
    try {
      const res = await fetch('/api/checklists/meses')
      if (!res.ok) return
      const data: string[] = await res.json()
      setMesesArquivo(data.filter(m => m < mesAtual))
    } catch { /* silencioso */ }
  }

  async function carregarArquivo(mes: string) {
    setCarregandoArquivo(true)
    setMesSelecionado(mes)

    // Fallback imediato: filtra dos checklists já carregados em memória
    const doEstado = checklists.filter(c => (c.data_checklist || '').startsWith(mes))
    if (doEstado.length > 0) setChecklistsArquivo(doEstado.map(normalizarChecklist))

    if (supabaseDisponivel) {
      try {
        // Usa gte/lt para correspondência de intervalo de datas mais robusta
        const anoNum = Number(mes.slice(0, 4))
        const mesNum = Number(mes.slice(5, 7))
        const mesNextNum = mesNum === 12 ? 1 : mesNum + 1
        const anoNext = mesNum === 12 ? anoNum + 1 : anoNum
        const mesNext = `${anoNext}-${String(mesNextNum).padStart(2, '0')}`

        const { data, error } = await supabase
          .from('checklists_viatura')
          .select('id, data_checklist, km, placa, motorista, itens, observacoes, created_at')
          .gte('data_checklist', `${mes}-01`)
          .lt('data_checklist', `${mesNext}-01`)
          .order('created_at', { ascending: false })

        if (error) {
          console.error('[Checklist] carregarArquivo Supabase error:', error.message)
          // mantém o fallback do estado se já havia dados
        } else {
          setChecklistsArquivo((Array.isArray(data) ? data : doEstado).map(item => normalizarChecklist(item as ChecklistData)))
        }
      } catch (e) {
        console.error('[Checklist] carregarArquivo exceção:', e)
      }
      setCarregandoArquivo(false)
      return
    }
    try {
      const res = await fetch(`/api/checklists?mes=${mes}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setChecklistsArquivo((Array.isArray(data) ? data : []).map(item => normalizarChecklist(item as ChecklistData)))
    } catch { if (doEstado.length === 0) setChecklistsArquivo([]) }
    setCarregandoArquivo(false)
  }

  // Exporta Excel do checklist buscando fotos completas antes de gerar o arquivo
  async function exportarExcelComFotos(lista: ChecklistData[], nomeArquivo?: string) {
    if (excelProgresso !== null) return
    const { exportarChecklistExcel } = await import('../exportExcel')
    try {
      const ids = lista.map(c => c.id).filter(id => typeof id === 'number' && id > 0)
      setExcelProgresso(`⏳ Buscando fotos… 0/${ids.length}`)
      const fotosMap = await buscarFotosChecklists(ids)
      setExcelProgresso(`⏳ Gerando planilha…`)
      const listaCompleta: ChecklistData[] = lista.map(c => ({
        ...c,
        foto_frontal: fotosMap[c.id]?.foto_frontal ?? c.foto_frontal ?? null,
        foto_traseira: fotosMap[c.id]?.foto_traseira ?? c.foto_traseira ?? null,
        foto_direita: fotosMap[c.id]?.foto_direita ?? c.foto_direita ?? null,
        foto_esquerda: fotosMap[c.id]?.foto_esquerda ?? c.foto_esquerda ?? null,
        fotos_avarias: fotosMap[c.id]?.fotos_avarias ?? c.fotos_avarias ?? [],
      }))
      await exportarChecklistExcel(listaCompleta, nomeArquivo)
    } finally {
      setExcelProgresso(null)
    }
  }

  useEffect(() => { carregar(); carregarMeses() }, [])

  useEffect(() => {
    if (abrirId == null || !checklists.length) return
    const encontrado = checklists.find(c => c.id === abrirId)
    if (encontrado) abrirDetalhe(encontrado)
  }, [abrirId, checklists])

  // Atualiza em tempo real quando outro agente salva ou apaga um checklist
  useEffect(() => {
    const off = wsOn('checklist_atualizado', () => { carregar(); carregarMeses() })
    return off
  }, [])

  // Sincroniza checklists salvos offline quando a conexão voltar
  useEffect(() => {
    async function aoVoltar() {
      const n = await sincronizarChecklistsPendentes()
      if (n > 0) carregar()
    }
    // Tenta sincronizar na montagem (caso já esteja online e tenha pendentes)
    aoVoltar()
    window.addEventListener('online', aoVoltar)
    return () => window.removeEventListener('online', aoVoltar)
  }, [])

  useEffect(() => {
    if (modo !== 'form') return
    setTimeout(() => ajustarCanvasAssinatura(), 50)
  }, [modo])

  function resetForm() {
    setData(hoje); setKm(''); setPlaca('RUA4A46'); setEditandoPlaca(false)
    setMotorista(''); setMotoristaOutro(false)
    setFotosAvarias([]); setFotoFrontal(null); setFotoTraseira(null)
    setFotoDireita(null); setFotoEsquerda(null)
    setItens(itensIniciais()); setObservacoes(''); setAssinaturaData(''); setErro('')
    const canvas = assinaturaRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }

  function ajustarCanvasAssinatura() {
    const canvas = assinaturaRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    const width = Math.max(1, Math.floor(rect.width * ratio))
    const height = Math.max(1, Math.floor(rect.height * ratio))
    if (canvas.width === width && canvas.height === height) return
    canvas.width = width
    canvas.height = height
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
    const canvas = assinaturaRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
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

  function htmlEscape(v: unknown) {
    return String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch] || ch))
  }

  function exportarChecklistPdf(c: ChecklistData) {
    const it = (c.itens || {}) as Record<string, string>
    const gruposPdf = [
      { titulo: 'Conservação', opcoes: ['bom', 'medio', 'ruim'], labels: ['Bom', 'Médio', 'Ruim'], campos: ITENS_PDF.filter(([, , tipo]) => tipo === 'bmr') },
      { titulo: 'Luzes Traseiras e Dianteiras', opcoes: ['sim', 'nao', 'na'], labels: ['Sim', 'Não', 'N/A'], campos: ITENS_PDF.filter(([campo]) => String(campo).startsWith('ltz') || String(campo).startsWith('ldz')) },
      { titulo: 'Segurança', opcoes: ['sim', 'nao', 'na'], labels: ['Sim', 'Não', 'N/A'], campos: ITENS_PDF.filter(([campo]) => String(campo).startsWith('seg')) },
      { titulo: 'Emergência', opcoes: ['sim', 'nao', 'na'], labels: ['Sim', 'Não', 'N/A'], campos: ITENS_PDF.filter(([campo]) => String(campo).startsWith('emer')) },
      { titulo: 'Motor', opcoes: ['sim', 'nao', 'na'], labels: ['Sim', 'Não', 'N/A'], campos: ITENS_PDF.filter(([campo]) => String(campo).startsWith('mot')) },
    ]
    const tabelasItens = gruposPdf.map((grupo) => `
      <h2>${htmlEscape(grupo.titulo)}</h2>
      <table class="check-table">
        <thead><tr><th>Item</th>${grupo.labels.map((label) => `<th>${label}</th>`).join('')}</tr></thead>
        <tbody>
          ${grupo.campos.map(([campo, label]) => {
            const valor = it[campo] || ''
            return `<tr><td>${htmlEscape(label)}</td>${grupo.opcoes.map((opcao) => `<td class="box-cell"><span class="check-box ${valor === opcao ? `marked marked-${opcao}` : ''}">${valor === opcao ? '✓' : ''}</span></td>`).join('')}</tr>`
          }).join('')}
        </tbody>
      </table>
    `).join('')
    const fotos = [
      ['Esquerda', c.foto_esquerda],
      ['Frontal', c.foto_frontal],
      ['Traseira', c.foto_traseira],
      ['Direita', c.foto_direita],
    ].filter(([, foto]) => foto).map(([label, foto]) => `<div><img src="${foto}" /><span>${htmlEscape(label)}</span></div>`).join('')
    const avarias = (c.fotos_avarias || []).map((foto, i) => `<div><img src="${foto}" /><span>Avaria ${i + 1}</span></div>`).join('')
    const win = window.open('', '_blank')
    if (!win) {
      alert('Permita pop-ups para gerar o PDF do checklist.')
      return
    }
    win.document.write(`<!doctype html><html><head><title>Checklist ${c.id}</title><style>
      body{font-family:Arial,sans-serif;color:#111827;margin:18px;max-width:820px}h1{background:#1a4b8c;color:white;padding:10px;font-size:17px;text-align:center;margin:0 0 10px}h2{color:#1a4b8c;border-bottom:2px solid #1a4b8c;font-size:13px;margin:12px 0 6px}.info{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.box{border:1px solid #d1d5db;padding:6px;border-radius:6px}.label{font-size:10px;color:#6b7280;text-transform:uppercase}.valor{font-weight:bold;margin-top:2px;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:5px;page-break-inside:avoid;table-layout:fixed}td,th{border:1px solid #d1d5db;padding:3px 4px;font-size:11px;line-height:1.15}th{background:#eff6ff;color:#1a4b8c}.check-table th:first-child,.check-table td:first-child{width:46%;font-weight:600;text-align:left}.check-table th:not(:first-child),.box-cell{text-align:center;width:18%}.check-box{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1.5px solid #9ca3af;border-radius:3px;font-size:10px;font-weight:bold;color:white;line-height:1}.marked-bom,.marked-sim{background:#16a34a;border-color:#15803d}.marked-medio{background:#f59e0b;border-color:#d97706}.marked-ruim,.marked-nao{background:#dc2626;border-color:#b91c1c}.marked-na{background:#6b7280;border-color:#4b5563}.fotos{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}.fotos div{border:1px solid #d1d5db;padding:5px;text-align:center}.fotos img{max-width:100%;max-height:160px;object-fit:contain}.assinatura{border:1px solid #111827;height:105px;display:flex;align-items:center;justify-content:center}.assinatura img{max-height:95px;max-width:100%}.obs{white-space:pre-wrap;border:1px solid #d1d5db;padding:6px;min-height:42px;font-size:12px}@media print{button{display:none}body{margin:8mm;max-width:none}h2{break-after:avoid}.check-table{font-size:10px}td,th{padding:2.5px 3px}.check-box{width:12px;height:12px;font-size:9px}.info{gap:5px}}
    </style></head><body>
      <button onclick="window.print()" style="position:fixed;right:16px;top:16px;padding:10px 14px;background:#166534;color:white;border:0;border-radius:8px;font-weight:bold">Salvar em PDF</button>
      <h1>CODAP — CONSELHEIRO LAFAIETE — CHECKLIST DA VIATURA #${htmlEscape(c.id)}</h1>
      <div class="info">
        <div class="box"><div class="label">Data</div><div class="valor">${htmlEscape(dataCurta(c.data_checklist))}</div></div>
        <div class="box"><div class="label">Motorista</div><div class="valor">${htmlEscape(c.motorista || '—')}</div></div>
        <div class="box"><div class="label">Placa</div><div class="valor">${htmlEscape(c.placa || '—')}</div></div>
        <div class="box"><div class="label">KM</div><div class="valor">${htmlEscape(c.km || '—')}</div></div>
        <div class="box" style="grid-column:1 / -1"><div class="label">Nível de Combustível</div><div class="valor">⛽ ${htmlEscape(it.nivelCombustivel || '—')}</div></div>
      </div>
      ${tabelasItens}
      <h2>Fotos do veículo</h2><div class="fotos">${fotos || '<p>Sem fotos do veículo.</p>'}</div>
      <h2>Fotos de avaria</h2><div class="fotos">${avarias || '<p>Sem fotos de avaria.</p>'}</div>
      <h2>Observações</h2><div class="obs">${htmlEscape(c.observacoes || '—')}</div>
      <h2>Assinatura</h2><div class="assinatura">${c.assinatura_data ? `<img src="${c.assinatura_data}" />` : 'Sem assinatura'}</div>
    </body></html>`)
    win.document.close()
    win.focus()
  }

  function adicionarAvaria(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        if (ev.target?.result) {
          const redim = await redimensionarImagem(ev.target.result as string, 1200, 900)
          const comMarca = await adicionarMarcaDagua(redim)
          setFotosAvarias(p => [...p, comMarca])
          salvarFotoNoDispositivo(comMarca)
        }
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  async function salvar() {
    const nomeMotorista = motorista.trim()
    if (!nomeMotorista) { setErro('Informe o motorista.'); return }
    setSalvando(true); setErro('')
    const payload = {
      data_checklist: data,
      km: km || null,
      placa: placa || null,
      motorista: nomeMotorista || null,
      fotos_avarias: fotosAvarias,
      foto_frontal: fotoFrontal,
      foto_traseira: fotoTraseira,
      foto_direita: fotoDireita,
      foto_esquerda: fotoEsquerda,
      itens,
      observacoes: observacoes || null,
      assinatura_data: assinaturaData || null,
    }
    try {
      if (supabaseDisponivel) {
        const { error } = await supabase.from('checklists_viatura').insert(payload)
        if (error) throw new Error(error.message)
        wsSend({ tipo: 'checklist_atualizado' })
      } else {
        const saveRes = await fetch('/api/checklists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!saveRes.ok) { const e = await saveRes.json().catch(() => ({})); throw new Error(e.error || 'Falha ao salvar') }
      }
      await carregar(); resetForm(); setModo('lista')
    } catch (e: unknown) {
      // Fallback: salvar localmente para não perder o checklist
      try {
        salvarChecklistLocal(payload)
        await carregar()
        resetForm()
        setModo('lista')
        setErro('⚠️ Sem conexão com o servidor — checklist salvo localmente. Aparecerá na lista com marcação pendente.')
      } catch {
        setErro(`Erro ao salvar: ${(e as Error)?.message ?? 'tente novamente'}`)
      }
    }
    setSalvando(false)
  }

  async function deletar(id: number) {
    if (id < 0) {
      removerChecklistLocal(id)
      setSelecionado(null); setModo('lista'); await carregar()
      return
    }
    try {
      if (supabaseDisponivel) {
        const { error } = await supabase.from('checklists_viatura').delete().eq('id', id)
        if (error) throw new Error(error.message)
        wsSend({ tipo: 'checklist_atualizado' })
      } else {
        const r = await fetch(`/api/checklists/${id}`, { method: 'DELETE' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
      }
    } catch (e) {
      console.error('[Checklist] erro ao excluir:', e)
      alert('Erro ao excluir checklist. Verifique sua conexão e tente novamente.')
      return
    }
    setSelecionado(null); setModo('lista'); await carregar()
  }

  if (modo === 'form') {
    return (
      <div className="tela">
        <header className="header">
          <button className="btn-voltar" onClick={() => { resetForm(); setModo('lista') }}>‹</button>
          <div className="header-logo-mini">
            <span style={{ fontSize: '1.3rem' }}>🚗</span>
            <span className="header-titulo-texto">Checklist da Viatura</span>
          </div>
          <div style={{ width: 36 }} />
        </header>

        <div className="form-scroll">
          <div className="form-card" style={{ padding: '0.4rem', gap: 0 }}>

            {/* ── Cabeçalho: Motorista / Data / Placa ── */}
            <div className="ck-header-fields">
              <div className="ck-hf-row">
                <div className="ck-hf-field" style={{ flex: 2 }}>
                  <label className="ck-hf-label">Motorista</label>
                  {motoristaOutro ? (
                    <input
                      className="ck-hf-input"
                      type="text"
                      placeholder="Digite o nome do motorista"
                      value={motorista}
                      autoFocus
                      onChange={e => setMotorista(e.target.value)}
                    />
                  ) : (
                    <select
                      className="ck-hf-input"
                      value={motorista}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '__outro__') {
                          setMotoristaOutro(true)
                          setMotorista('')
                        } else {
                          setMotorista(v)
                        }
                      }}
                    >
                      <option value="">— Selecionar —</option>
                      {MOTORISTAS.map(n => <option key={n} value={n}>{n}</option>)}
                      <option value="__outro__">Outro…</option>
                    </select>
                  )}
                  {motoristaOutro && (
                    <button
                      type="button"
                      className="ck-motorista-voltar"
                      onClick={() => { setMotoristaOutro(false); setMotorista('') }}
                      title="Voltar para a lista"
                    >
                      ↺
                    </button>
                  )}
                </div>
                <div className="ck-hf-field" style={{ flex: 1 }}>
                  <label className="ck-hf-label">Data</label>
                  <input className="ck-hf-input" type="date" value={data} max={hoje}
                    onChange={e => setData(e.target.value)} />
                </div>
              </div>
              <div className="ck-hf-row">
                <div className="ck-hf-field" style={{ flex: 1 }}>
                  <label className="ck-hf-label">Placa</label>
                  {editandoPlaca ? (
                    <input
                      className="ck-hf-input"
                      type="text"
                      placeholder="Ex: ABC-1234"
                      value={placa}
                      autoFocus
                      onChange={e => setPlaca(e.target.value.toUpperCase())}
                      onBlur={() => setEditandoPlaca(false)}
                      onKeyDown={e => { if (e.key === 'Enter') setEditandoPlaca(false) }}
                    />
                  ) : (
                    <span
                      className="ck-placa-badge"
                      onClick={() => setEditandoPlaca(true)}
                    >
                      {placa || '—'}
                    </span>
                  )}
                </div>
                <div className="ck-hf-field" style={{ flex: 1 }}>
                  <label className="ck-hf-label">KM</label>
                  <input className="ck-hf-input" type="text" inputMode="numeric" placeholder="Ex: 52.340"
                    value={km} onChange={e => setKm(e.target.value)} />
                </div>
              </div>
            </div>

            {/* ── Nível de Combustível ── */}
            <NivelCombustivelGauge
              valor={(itens.nivelCombustivel ?? '') as NivelCombustivel}
              onChange={(v) => setItem('nivelCombustivel', v)}
            />

            {/* ── Fotos do Veículo ── */}
            <div className="ck-section-title">FOTOS DO VEÍCULO</div>
            <div className="ck-fotos-4col">
              <FotoSlotH label="Esquerda" foto={fotoEsquerda} onFoto={atualizarFotoVeiculo('esquerda', setFotoEsquerda)}><CarSide /></FotoSlotH>
              <FotoSlotH label="Frontal" foto={fotoFrontal} onFoto={atualizarFotoVeiculo('frontal', setFotoFrontal)}><CarFront /></FotoSlotH>
              <FotoSlotH label="Traseira" foto={fotoTraseira} onFoto={atualizarFotoVeiculo('traseira', setFotoTraseira)}><CarRear /></FotoSlotH>
              <FotoSlotH label="Direita" foto={fotoDireita} onFoto={atualizarFotoVeiculo('direita', setFotoDireita)}><CarSide flip /></FotoSlotH>
            </div>

            {/* ── Fotos de Avaria ── */}
            <div className="ck-section-title">FOTOS DE AVARIA</div>
            <div
              className="ck-avaria-slot"
              onClick={() => fotosAvarias.length === 0 && avariaRef.current?.click()}
            >
              {fotosAvarias.length === 0 ? (
                <div className="ck-foto-empty">
                  <span style={{ fontSize: '1.8rem' }}>🔧</span>
                  <span className="ck-foto-label">Adicionar foto de avaria</span>
                  <span className="ck-foto-hint">📷 Toque para fotografar</span>
                </div>
              ) : (
                <div className="ck-avaria-grid">
                  {fotosAvarias.map((f, i) => (
                    <div key={i} className="foto-wrap">
                      <img src={f} alt="" className="foto-thumb" />
                      <button className="foto-del" onClick={e => { e.stopPropagation(); setFotosAvarias(p => p.filter((_, j) => j !== i)) }}>✕</button>
                    </div>
                  ))}
                  <button className="btn-add-foto-mini" onClick={e => { e.stopPropagation(); avariaRef.current?.click() }}>
                    + foto
                  </button>
                </div>
              )}
              <input ref={avariaRef} type="file" accept="image/*" multiple capture="environment"
                style={{ display: 'none' }} onChange={adicionarAvaria} />
              <input ref={avariaGaleriaRef} type="file" accept="image/*" multiple
                style={{ display: 'none' }} onChange={adicionarAvaria} />
            </div>
            <div style={{ textAlign: 'center', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); avariaGaleriaRef.current?.click() }}
                style={{
                  background: 'none', border: 'none', color: '#1a4b8c',
                  fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline',
                  padding: '0.1rem 0.3rem',
                }}
              >
                📁 Carregar foto
              </button>
            </div>

            {/* ── Conservação ── */}
            <div className="ck-table-wrap" style={{ marginTop: '0.75rem' }}>
              <CkHeader cols={['Bom', 'Médio', 'Ruim']} />
              <CkRow label="Limpeza Externa" campo="limpezaExterna" itens={itens} onChange={setItem} opcoes={OPT_BMR} />
              <CkRow label="Limpeza Interna" campo="limpezaInterna" itens={itens} onChange={setItem} opcoes={OPT_BMR} />
              <CkRow label="Pneus" campo="pneus" itens={itens} onChange={setItem} opcoes={OPT_BMR} />
              <CkRow label="Estepe" campo="estepe" itens={itens} onChange={setItem} opcoes={OPT_BMR} />
            </div>

            {/* ── Luzes Traseiras | Dianteiras ── */}
            <div className="ck-2col" style={{ marginTop: '0.75rem' }}>
              <div className="ck-table-wrap ck-with-side">
                <div className="ck-side-label">Luzes Traseiras</div>
                <div style={{ flex: 1 }}>
                  <CkHeader cols={['Sim', 'Não', 'N/A']} />
                  <CkRow label="Da placa" campo="ltzPlaca" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkSecRow label="Direita" />
                  <CkRow label="Luz" campo="ltzDirLuz" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Luz de ré" campo="ltzDirLuzRe" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Luz de freio" campo="ltzDirFreio" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Seta" campo="ltzDirSeta" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkSecRow label="Esquerda" />
                  <CkRow label="Luz" campo="ltzEsqLuz" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Luz de ré" campo="ltzEsqLuzRe" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Luz de freio" campo="ltzEsqFreio" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Seta" campo="ltzEsqSeta" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                </div>
              </div>

              <div className="ck-table-wrap ck-with-side">
                <div className="ck-side-label">Luzes Dianteiras</div>
                <div style={{ flex: 1 }}>
                  <CkHeader cols={['Sim', 'Não', 'N/A']} />
                  <CkRow label="Da placa" campo="ldzPlaca" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkSecRow label="Direita" />
                  <CkRow label="Farol alto" campo="ldzDirFarolAlto" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Farol baixo" campo="ldzDirFarolBaixo" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Neblina" campo="ldzDirNeblina" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkSecRow label="Esquerda" />
                  <CkRow label="Farol alto" campo="ldzEsqFarolAlto" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Farol baixo" campo="ldzEsqFarolBaixo" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Seta" campo="ldzEsqSeta" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Neblina" campo="ldzEsqNeblina" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                </div>
              </div>
            </div>

            {/* ── Segurança | Motor ── */}
            <div className="ck-2col" style={{ marginTop: '0.75rem' }}>
              <div className="ck-table-wrap ck-with-side">
                <div className="ck-side-label">Segurança</div>
                <div style={{ flex: 1 }}>
                  <CkHeader cols={['Sim', 'Não', 'N/A']} />
                  <CkRow label="Alarme" campo="segAlarme" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Buzina" campo="segBuzina" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Chave de Roda" campo="segChaveRoda" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Cintos" campo="segCintos" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Documentos" campo="segDocumentos" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Extintor" campo="segExtintor" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Limpadores" campo="segLimpadores" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Macaco" campo="segMacaco" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Painel" campo="segPainel" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Retrovisor Int." campo="segRetrovisorInterno" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Retrovisor Dir." campo="segRetrovisorDireito" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Retrovisor Esq." campo="segRetrovisorEsquerdo" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Travas" campo="segTravas" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Triângulo" campo="segTriangulo" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                </div>
              </div>

              <div className="ck-table-wrap ck-with-side">
                <div className="ck-side-label">Motor</div>
                <div style={{ flex: 1 }}>
                  <CkHeader cols={['Sim', 'Não', 'N/A']} />
                  <CkRow label="Acelerador" campo="motAcelerador" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Água limpador" campo="motAguaLimpador" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Água radiador" campo="motAguaRadiador" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Embreagem" campo="motEmbreagem" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Freio" campo="motFreio" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Freio de mão" campo="motFreioMao" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Óleo do freio" campo="motOleoFreio" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Óleo do motor" campo="motOleoMoto" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                  <CkRow label="Tanque/Partida" campo="motTanquePartida" itens={itens} onChange={setItem} opcoes={OPT_SN} />
                </div>
              </div>
            </div>

            {/* ── Emergência ── */}
            <div className="ck-table-wrap ck-emergencia" style={{ marginTop: '0.75rem' }}>
              <div className="ck-section-title" style={{ marginBottom: 0, borderRadius: 0 }}>EMERGÊNCIA</div>
              <CkHeader cols={['Sim', 'Não', 'N/A']} />
              <CkRow label="Iluminação Giroflex" campo="emerIluminacaoGiroflex" itens={itens} onChange={setItem} opcoes={OPT_SN} />
              <CkRow label="Multimídia" campo="emerMultimidia" itens={itens} onChange={setItem} opcoes={OPT_SN} />
              <CkRow label="Sirene" campo="emerSirene" itens={itens} onChange={setItem} opcoes={OPT_SN} />
              <CkRow label="Strobo" campo="emerStrobo" itens={itens} onChange={setItem} opcoes={OPT_SN} />
            </div>

            {/* ── Observações ── */}
            <div className="campo" style={{ marginTop: '0.75rem' }}>
              <label className="campo-label">📝 Observações</label>
              <textarea className="campo-textarea" rows={3}
                placeholder="Observações adicionais sobre a viatura..."
                value={observacoes} onChange={e => setObservacoes(e.target.value)} />
            </div>

            <div className="campo ck-assinatura-campo">
              <label className="campo-label">✍️ Assinatura do responsável</label>
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

            <button className="btn-salvar ck-salvar-final" onClick={salvar} disabled={salvando}>
              {salvando ? '⏳ Salvando checklist...' : '💾 Salvar Checklist'}
            </button>

            {erro && <div className="erro-msg">⚠️ {erro}</div>}
          </div>
        </div>

        <div className="footer-fixo">
          <button className="btn-salvar" onClick={salvar} disabled={salvando}>
            {salvando ? '⏳ Salvando...' : '💾 Salvar Checklist'}
          </button>
        </div>
      </div>
    )
  }

  if (modo === 'detalhe' && selecionado) {
    const c = selecionado
    const it = (c.itens as unknown as Itens | null) || itensIniciais()
    const fotos4 = [
      { label: 'Esquerda', foto: c.foto_esquerda, icone: <CarSide /> },
      { label: 'Frontal', foto: c.foto_frontal, icone: <CarFront /> },
      { label: 'Traseira', foto: c.foto_traseira, icone: <CarRear /> },
      { label: 'Direita', foto: c.foto_direita, icone: <CarSide flip /> },
    ]

    function CkRowRO({ label, valor, opcoes }: { label: string; valor: string; opcoes: string[] }) {
      const labelMap: Record<string, string> = { bom: 'Bom', medio: 'Médio', ruim: 'Ruim', sim: 'Sim', nao: 'Não', na: 'N/A' }
      const colorMap: Record<string, string> = { bom: '#15803d', medio: '#d97706', ruim: '#dc2626', sim: '#15803d', nao: '#dc2626', na: '#6b7280' }
      return (
        <div className="ck-row">
          <span className="ck-row-label">{label}</span>
          {opcoes.map(o => (
            <div key={o} className="ck-row-cell">
              <div className={`ck-dot${valor === o ? ` ck-dot-${o}` : ''}`} style={{ cursor: 'default' }} />
            </div>
          ))}
          {valor && (
            <span style={{ fontSize: '0.7rem', color: colorMap[valor], fontWeight: 700, marginLeft: 4 }}>
              {labelMap[valor] || valor}
            </span>
          )}
        </div>
      )
    }

    return (
      <>
      <div className="tela">
        <header className="header">
          <button className="btn-voltar" onClick={() => { setSelecionado(null); setModo('lista') }}>‹</button>
          <div className="header-logo-mini">
            <span style={{ fontSize: '1.3rem' }}>🚗</span>
            <span className="header-titulo-texto">Checklist #{c.id}</span>
          </div>
          <button className="btn-deletar-header" onClick={() => solicitarDeletar(c.id)}>🗑️</button>
        </header>

        <div className="form-scroll">
          <div className="form-card" style={{ padding: '0.4rem', gap: 0 }}>
            <div className="ck-detalhe-info">
              <span className="ck-det-data">{formatarData(c.data_checklist)}</span>
              {c.motorista && <span className="ck-det-badge">👤 {c.motorista}</span>}
              {c.placa && <span className="ck-det-badge">🚘 {c.placa}</span>}
              {c.km && <span className="ck-det-badge">🔢 {c.km} km</span>}
              {it.nivelCombustivel && <span className="ck-det-badge">⛽ {it.nivelCombustivel}</span>}
            </div>

            {it.nivelCombustivel && (
              <NivelCombustivelGauge valor={it.nivelCombustivel as NivelCombustivel} />
            )}

            <div className="ck-section-title" style={{ marginTop: '0.5rem' }}>FOTOS DO VEÍCULO</div>
            {carregandoDetalhe
              ? <div className="carregando" style={{ padding: '1rem', textAlign: 'center' }}>⏳ Carregando fotos...</div>
              : <div className="ck-fotos-4col">
                  {fotos4.map(({ label, foto, icone }) => (
                    <div
                      key={label}
                      className="ck-foto-slot"
                      style={{ cursor: foto ? 'zoom-in' : 'default' }}
                      onClick={() => foto && setFotoAmpliada({ src: foto, label })}
                      role={foto ? 'button' : undefined}
                      tabIndex={foto ? 0 : undefined}
                      onKeyDown={event => {
                        if (foto && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault()
                          setFotoAmpliada({ src: foto, label })
                        }
                      }}
                    >
                      {foto
                        ? <><img src={foto} alt={label} className="ck-foto-img" /><span className="ck-foto-nome">{label}</span></>
                        : <div className="ck-foto-empty">{icone}<span className="ck-foto-label">{label}</span></div>}
                    </div>
                  ))}
                </div>
            }

            {c.fotos_avarias?.length > 0 && (
              <>
                <div className="ck-section-title">FOTOS DE AVARIA ({c.fotos_avarias.length})</div>
                <div className="ck-avaria-slot" style={{ cursor: 'default' }}>
                  <div className="ck-avaria-grid">
                    {c.fotos_avarias.map((f, i) => (
                      <button
                        key={i}
                        type="button"
                        className="ck-avaria-thumb"
                        onClick={() => setFotoAmpliada({ src: f, label: `Avaria ${i + 1}` })}
                        aria-label={`Ampliar foto de avaria ${i + 1}`}
                      >
                        <img src={f} alt={`Avaria ${i + 1}`} />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="ck-table-wrap" style={{ marginTop: '0.75rem' }}>
              <CkHeader cols={['Bom', 'Médio', 'Ruim']} />
              <CkRowRO label="Limpeza Externa" valor={it.limpezaExterna} opcoes={OPT_BMR} />
              <CkRowRO label="Limpeza Interna" valor={it.limpezaInterna} opcoes={OPT_BMR} />
              <CkRowRO label="Pneus" valor={it.pneus} opcoes={OPT_BMR} />
              <CkRowRO label="Estepe" valor={it.estepe} opcoes={OPT_BMR} />
            </div>

            <div className="ck-2col" style={{ marginTop: '0.75rem' }}>
              <div className="ck-table-wrap ck-with-side">
                <div className="ck-side-label">Luzes Traseiras</div>
                <div style={{ flex: 1 }}>
                  <CkHeader cols={['S', 'N', 'N/A']} />
                  <CkRowRO label="Da placa" valor={it.ltzPlaca} opcoes={OPT_SN} />
                  <CkSecRow label="Direita" />
                  <CkRowRO label="Luz" valor={it.ltzDirLuz} opcoes={OPT_SN} />
                  <CkRowRO label="Luz de ré" valor={it.ltzDirLuzRe} opcoes={OPT_SN} />
                  <CkRowRO label="Luz de freio" valor={it.ltzDirFreio} opcoes={OPT_SN} />
                  <CkRowRO label="Seta" valor={it.ltzDirSeta} opcoes={OPT_SN} />
                  <CkSecRow label="Esquerda" />
                  <CkRowRO label="Luz" valor={it.ltzEsqLuz} opcoes={OPT_SN} />
                  <CkRowRO label="Luz de ré" valor={it.ltzEsqLuzRe} opcoes={OPT_SN} />
                  <CkRowRO label="Luz de freio" valor={it.ltzEsqFreio} opcoes={OPT_SN} />
                  <CkRowRO label="Seta" valor={it.ltzEsqSeta} opcoes={OPT_SN} />
                </div>
              </div>
              <div className="ck-table-wrap ck-with-side">
                <div className="ck-side-label">Luzes Dianteiras</div>
                <div style={{ flex: 1 }}>
                  <CkHeader cols={['S', 'N', 'N/A']} />
                  <CkRowRO label="Da placa" valor={it.ldzPlaca} opcoes={OPT_SN} />
                  <CkSecRow label="Direita" />
                  <CkRowRO label="Farol alto" valor={it.ldzDirFarolAlto} opcoes={OPT_SN} />
                  <CkRowRO label="Farol baixo" valor={it.ldzDirFarolBaixo} opcoes={OPT_SN} />
                  <CkRowRO label="Neblina" valor={it.ldzDirNeblina} opcoes={OPT_SN} />
                  <CkSecRow label="Esquerda" />
                  <CkRowRO label="Farol alto" valor={it.ldzEsqFarolAlto} opcoes={OPT_SN} />
                  <CkRowRO label="Farol baixo" valor={it.ldzEsqFarolBaixo} opcoes={OPT_SN} />
                  <CkRowRO label="Seta" valor={it.ldzEsqSeta} opcoes={OPT_SN} />
                  <CkRowRO label="Neblina" valor={it.ldzEsqNeblina} opcoes={OPT_SN} />
                </div>
              </div>
            </div>

            <div className="ck-2col" style={{ marginTop: '0.75rem' }}>
              <div className="ck-table-wrap ck-with-side">
                <div className="ck-side-label">Segurança</div>
                <div style={{ flex: 1 }}>
                  <CkHeader cols={['S', 'N', 'N/A']} />
                  {(['segAlarme','segBuzina','segChaveRoda','segCintos','segDocumentos','segExtintor',
                    'segLimpadores','segMacaco','segPainel','segRetrovisorInterno','segRetrovisorDireito',
                    'segRetrovisorEsquerdo','segTravas','segTriangulo'] as (keyof Itens)[]).map((k) => {
                    const labels: Record<string,string> = {
                      segAlarme:'Alarme',segBuzina:'Buzina',segChaveRoda:'Chave de Roda',segCintos:'Cintos',
                      segDocumentos:'Documentos',segExtintor:'Extintor',segLimpadores:'Limpadores',
                      segMacaco:'Macaco',segPainel:'Painel',segRetrovisorInterno:'Retrovisor Int.',
                      segRetrovisorDireito:'Retrovisor Dir.',segRetrovisorEsquerdo:'Retrovisor Esq.',
                      segTravas:'Travas',segTriangulo:'Triângulo',
                    }
                    return <CkRowRO key={k} label={labels[k]} valor={it[k] as string} opcoes={OPT_SN} />
                  })}
                </div>
              </div>
              <div className="ck-table-wrap ck-with-side">
                <div className="ck-side-label">Motor</div>
                <div style={{ flex: 1 }}>
                  <CkHeader cols={['S', 'N', 'N/A']} />
                  {(['motAcelerador','motAguaLimpador','motAguaRadiador','motEmbreagem','motFreio',
                    'motFreioMao','motOleoFreio','motOleoMoto','motTanquePartida'] as (keyof Itens)[]).map((k) => {
                    const labels: Record<string,string> = {
                      motAcelerador:'Acelerador',motAguaLimpador:'Água limpador',motAguaRadiador:'Água radiador',
                      motEmbreagem:'Embreagem',motFreio:'Freio',motFreioMao:'Freio de mão',
                      motOleoFreio:'Óleo do freio',motOleoMoto:'Óleo do motor',motTanquePartida:'Tanque/Partida',
                    }
                    return <CkRowRO key={k} label={labels[k]} valor={it[k] as string} opcoes={OPT_SN} />
                  })}
                </div>
              </div>
            </div>

            <div className="ck-table-wrap ck-emergencia" style={{ marginTop: '0.75rem' }}>
              <div className="ck-section-title" style={{ marginBottom: 0, borderRadius: 0 }}>EMERGÊNCIA</div>
              <CkHeader cols={['S', 'N', 'N/A']} />
              {([
                ['emerIluminacaoGiroflex', 'Iluminação Giroflex'],
                ['emerMultimidia', 'Multimídia'],
                ['emerSirene', 'Sirene'],
                ['emerStrobo', 'Strobo'],
              ] as [keyof Itens, string][]).map(([k, label]) => (
                <CkRowRO key={k} label={label} valor={it[k] as string} opcoes={OPT_SN} />
              ))}
            </div>

            {c.observacoes && (
              <div className="campo" style={{ marginTop: '0.75rem' }}>
                <label className="campo-label">📝 Observações</label>
                <div className="cl-obs-text">{c.observacoes}</div>
              </div>
            )}

            <div className="campo" style={{ marginTop: '0.75rem' }}>
              <label className="campo-label">✍️ Assinatura</label>
              <div className="ck-assinatura-detalhe">
                {c.assinatura_data ? <img src={c.assinatura_data} alt="Assinatura" /> : <span>Sem assinatura registrada</span>}
              </div>
            </div>

            <button className="btn-relatorio" onClick={() => exportarChecklistPdf(c)}>
              📄 Exportar este checklist em PDF
            </button>
          </div>
        </div>
      </div>
      {fotoAmpliada && (
        <div
          className="ck-foto-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Foto ampliada: ${fotoAmpliada.label}`}
          onClick={() => setFotoAmpliada(null)}
        >
          <button
            type="button"
            className="ck-foto-lightbox-fechar"
            onClick={() => setFotoAmpliada(null)}
            aria-label="Fechar foto ampliada"
          >
            ✕
          </button>
          <div className="ck-foto-lightbox-conteudo" onClick={event => event.stopPropagation()}>
            <img src={fotoAmpliada.src} alt={fotoAmpliada.label} className="ck-foto-lightbox-img" />
            <span>{fotoAmpliada.label}</span>
          </div>
        </div>
      )}
      {pedindoSenhaDeletar !== null && senhaAgenteCk && (
        <ModalSenha
          titulo="Excluir Checklist"
          senhaCorreta={senhaAgenteCk}
          onCancelar={() => setPedindoSenhaDeletar(null)}
          onConfirmar={() => { const id = pedindoSenhaDeletar!; setPedindoSenhaDeletar(null); deletar(id) }}
        />
      )}
      </>
    )
  }

  function renderCardChecklist(c: ChecklistData) {
    const isLocal = (c as unknown as Record<string, unknown>)._local === true
    return (
      <button key={c.id} className={`oc-card ${isLocal ? 'oc-card-offline' : ''}`} onClick={() => abrirDetalhe(c)}>
        <div className="oc-card-esq"><span className="oc-emoji">🚗</span></div>
        <div className="oc-card-corpo">
          <div className="oc-card-top">
            <span className="oc-natureza">{formatarData(c.data_checklist)}</span>
            {isLocal && <span className="oc-offline-tag" title="Salvo localmente — não sincronizado com servidor">📵</span>}
            <span className="oc-seta">›</span>
          </div>
          <div className="oc-card-meta">
            {c.motorista && <span>👤 {c.motorista}</span>}
            {c.placa && <span>🚘 {c.placa}</span>}
            {c.km && <span>🔢 {c.km} km</span>}
            {(c.foto_frontal || c.foto_traseira || c.foto_direita || c.foto_esquerda
              || (c as Record<string,unknown>).tem_foto_frontal || (c as Record<string,unknown>).tem_foto_traseira
              || (c as Record<string,unknown>).tem_foto_direita || (c as Record<string,unknown>).tem_foto_esquerda)
              && <span>📷 fotos</span>}
          </div>
        </div>
      </button>
    )
  }

  const checklistsMesAtual = checklists.filter(c =>
    (c.data_checklist || '').startsWith(mesAtual)
  )

  if (mesSelecionado !== null) {
    return (
      <div className="conteudo-viatura">
        <div className="cl-lista-header">
          <div>
            <h2 className="cl-titulo">📁 {mesLabel(mesSelecionado)}</h2>
            <div className="cl-subtitulo">Arquivo de checklists</div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {checklistsArquivo.length > 0 && (
              <button
                className="btn-excel-global"
                onClick={() => exportarExcelComFotos(checklistsArquivo, `checklists_${mesSelecionado}`)}
                disabled={excelProgresso !== null}
                title={excelProgresso ?? 'Exportar para Excel com fotos'}
                style={{ opacity: excelProgresso !== null ? 0.7 : 1, minWidth: excelProgresso ? '12rem' : undefined, fontSize: excelProgresso ? '0.75rem' : undefined }}
              >
                {excelProgresso ?? '📊 Excel'}
              </button>
            )}
            <button className="btn-voltar-arquivo" onClick={() => { setMesSelecionado(null); setChecklistsArquivo([]) }}>
              ← Voltar
            </button>
          </div>
        </div>

        {carregandoArquivo ? (
          <div className="carregando">⏳ Carregando...</div>
        ) : checklistsArquivo.length === 0 ? (
          <div className="lista-vazia">
            <div style={{ fontSize: '2.5rem' }}>📂</div>
            <div>Nenhum checklist em {mesLabel(mesSelecionado)}.</div>
          </div>
        ) : (
          <div className="lista">
            {checklistsArquivo.map(c => renderCardChecklist(c))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="conteudo-viatura">
      <div className="cl-lista-header">
        <div>
          <h2 className="cl-titulo">Checklists da Viatura</h2>
          <div className="cl-subtitulo">{mesLabel(mesAtual)}</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {checklistsMesAtual.length > 0 && (
            <button
              className="btn-excel-global"
              onClick={() => exportarExcelComFotos(checklistsMesAtual, `checklists_${mesAtual}`)}
              disabled={excelProgresso !== null}
              title={excelProgresso ?? 'Exportar para Excel com fotos'}
              style={{ opacity: excelProgresso !== null ? 0.7 : 1, minWidth: excelProgresso ? '12rem' : undefined, fontSize: excelProgresso ? '0.75rem' : undefined }}
            >
              {excelProgresso ?? '📊 Excel'}
            </button>
          )}
          <button className="btn-novo-checklist" onClick={() => { resetForm(); setModo('form') }}>
            + Novo
          </button>
        </div>
      </div>

      {carregando ? (
        <div className="carregando">⏳ Carregando checklists...</div>
      ) : checklistsMesAtual.length === 0 ? (
        <div className="lista-vazia">
          <div style={{ fontSize: '3rem' }}>🚗</div>
          <div>Nenhum checklist em {mesLabel(mesAtual)}.</div>
          <button className="btn-nova-vazia" onClick={() => { resetForm(); setModo('form') }}>+ Novo Checklist</button>
        </div>
      ) : (
        <div className="lista">
          {checklistsMesAtual.map(c => renderCardChecklist(c))}
        </div>
      )}

      {mesesArquivo.length > 0 && (
        <div className="ck-arquivo">
          <div className="ck-arquivo-titulo">📁 Meses anteriores</div>
          <div className="ck-arquivo-lista">
            {mesesArquivo.map(mes => (
              <button
                key={mes}
                className="ck-arquivo-mes"
                onClick={() => carregarArquivo(mes)}
              >
                <span className="ck-arquivo-mes-nome">{mesLabel(mes)}</span>
                <span className="ck-arquivo-seta">›</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
