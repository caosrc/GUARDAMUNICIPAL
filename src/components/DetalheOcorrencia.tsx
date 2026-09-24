import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import type { Ocorrencia, NivelRisco, StatusOc, VistoriaAdicional } from '../types'
import { exportarPastaOcorrencia, nomePastaOcorrencia } from '../exportarPasta'
import { NATUREZA_ICONE, NATUREZA_COR, TIPOS_OCORRENCIA, NATUREZAS, AGENTES, agentePodeGerenciarCriacao, getSenhaAgente, normalizarNomeAgente } from '../types'
import { deletarOcorrencia, atualizarOcorrencia, buscarOcorrenciaCompleta } from '../api'
import { geocodificarEndereco, updatePending } from '../offline'
import { exportarOcorrenciaExcel } from '../exportExcel'
import { formatarCoordenadas, parseDateLocal, mensagemErroGps, adicionarMarcaDagua, salvarFotoNoDispositivo } from '../utils'
import ModalSenha from './ModalSenha'
import PoligonoAreaQueimada, { calcularAreaM2, formatarArea, type PontoPoligono } from './PoligonoAreaQueimada'
import { calcularHorasTotal, calcularHorasOcorrenciaBanco, formatarHoras, carregarFeriadosCustom } from '../horasUtils'
import { getAgenteLogado } from './Login'

interface Props {
  ocorrencia: Ocorrencia
  onFechar: () => void
  onDeletado: () => void
  onAtualizado: (o: Ocorrencia) => void
}

type DmsEdicao = {
  graus: string
  minutos: string
  segundos: string
  direcao: string
}

/** Converte ISO UTC para o formato esperado pelo input datetime-local (horário local). */
function isoParaDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function decimalParaPartesGms(valor: number | null, positivo: string, negativo: string): DmsEdicao {
  if (valor == null) return { graus: '', minutos: '', segundos: '', direcao: negativo }
  const absoluto = Math.abs(valor)
  let graus = Math.floor(absoluto)
  const minutosFloat = (absoluto - graus) * 60
  let minutos = Math.floor(minutosFloat)
  let segundosNum = Math.round((minutosFloat - minutos) * 6000) / 100
  if (segundosNum >= 60) {
    segundosNum = 0
    minutos += 1
  }
  if (minutos >= 60) {
    minutos = 0
    graus += 1
  }
  const segundos = segundosNum.toFixed(2).replace('.', ',')
  return {
    graus: String(graus),
    minutos: String(minutos),
    segundos,
    direcao: valor >= 0 ? positivo : negativo,
  }
}

function partesGmsParaDecimal(partes: DmsEdicao, negativo: string, limiteGraus: number, label: string): number | null {
  const temValor = partes.graus.trim() || partes.minutos.trim() || partes.segundos.trim()
  if (!temValor) return null

  const graus = Number(partes.graus.replace(',', '.'))
  const minutos = Number((partes.minutos || '0').replace(',', '.'))
  const segundos = Number((partes.segundos || '0').replace(',', '.'))

  if (!Number.isFinite(graus) || !Number.isFinite(minutos) || !Number.isFinite(segundos)) {
    throw new Error(`${label}: informe apenas números em graus, minutos e segundos.`)
  }
  if (!Number.isInteger(graus) || !Number.isInteger(minutos) || graus < 0 || graus > limiteGraus || minutos < 0 || minutos >= 60 || segundos < 0 || segundos >= 60) {
    throw new Error(`${label}: confira os valores de graus, minutos e segundos.`)
  }

  const sinal = partes.direcao === negativo ? -1 : 1
  return parseFloat((sinal * (graus + minutos / 60 + segundos / 3600)).toFixed(6))
}

export default function DetalheOcorrencia({ ocorrencia: oc, onFechar, onDeletado, onAtualizado }: Props) {
  const [o, setO] = useState<Ocorrencia>(oc)

  // Busca fotos e vistorias sempre ao abrir — a listagem não as carrega para não pesar
  const [fotosCarregadasDoServidor, setFotosCarregadasDoServidor] = useState(false)
  useEffect(() => {
    if (oc._offline) return
    setFotosCarregadasDoServidor(false)
    buscarOcorrenciaCompleta(oc.id).then((completa) => {
      if (!completa) { setFotosCarregadasDoServidor(true); return }
      setO((prev) => ({
        ...prev,
        fotos: completa.fotos ?? prev.fotos ?? [],
        vistorias: completa.vistorias ?? prev.vistorias ?? [],
        focos_incendio: completa.focos_incendio ?? prev.focos_incendio ?? null,
        poligono_area_queimada: completa.poligono_area_queimada ?? prev.poligono_area_queimada ?? null,
      }))
      setFotosCarregadasDoServidor(true)
    }).catch(() => { setFotosCarregadasDoServidor(true) })
  }, [oc.id])

  const [feriadosCustom, setFeriadosCustom] = useState<string[]>([])
  useEffect(() => {
    carregarFeriadosCustom().then(setFeriadosCustom).catch(() => {})
  }, [])

  const [editando, setEditando] = useState(false)
  const [pedindoSenha, setPedindoSenha] = useState<'editar' | 'deletar' | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [geocodificando, setGeocodificando] = useState(false)
  const [geoMsg, setGeoMsg] = useState('')
  const [erroEdit, setErroEdit] = useState('')
  const [fotoAmpliada, setFotoAmpliada] = useState<number | null>(null)
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false)
  const [gerandoPasta, setGerandoPasta] = useState(false)
  const [eDescricoesFotos, setEDescricoesFotos] = useState<string[]>([])
  const [eFotos, setEFotos] = useState<string[]>(Array.isArray(o.fotos) ? o.fotos : [])
  const [eFotoAmpliada, setEFotoAmpliada] = useState<number | null>(null)
  const [fotosCarregando, setFotosCarregando] = useState(0)
  const camEditRef = useRef<HTMLInputElement>(null)
  const galEditRef = useRef<HTMLInputElement>(null)

  // ── Permissão: somente quem registrou pode editar/excluir ──
  const agenteLogado = getAgenteLogado()
  const responsavel = normalizarNomeAgente((o.responsavel_registro || '').trim())
  // Se a ocorrência não tem responsável registrado (legado), libera para todos.
  const podeEditar = !responsavel || agentePodeGerenciarCriacao(responsavel, agenteLogado)
  // Senha individual do agente logado (null = sem senha, acesso direto)
  const senhaAgenteLogado = getSenhaAgente(agenteLogado)

  function solicitarOuExecutar(acao: 'editar' | 'deletar') {
    if (senhaAgenteLogado) {
      setPedindoSenha(acao)
    } else {
      if (acao === 'editar') iniciarEdicao()
      else confirmarDelete()
    }
  }

  // ── Nova Vistoria (Interdição de Imóvel) ──
  const [novaVistoriaAberta, setNovaVistoriaAberta] = useState(false)
  const [novaVistoriaObs, setNovaVistoriaObs] = useState('')
  const [novaVistoriaFotos, setNovaVistoriaFotos] = useState<string[]>([])
  const [novaVistoriaStatus, setNovaVistoriaStatus] = useState<StatusOc>('ativo')
  const [novaVistoriaData, setNovaVistoriaData] = useState<string>('')
  const [salvandoVistoria, setSalvandoVistoria] = useState(false)
  const [erroVistoria, setErroVistoria] = useState('')
  const [vistoriaFotoAmpliada, setVistoriaFotoAmpliada] = useState<{ vIdx: number; fIdx: number } | null>(null)
  const camVistoriaRef = useRef<HTMLInputElement>(null)
  const galVistoriaRef = useRef<HTMLInputElement>(null)

  const ehInterdicaoImovel = o.natureza === 'Interdição de Imóvel'
  const vistoriasSalvas: VistoriaAdicional[] = Array.isArray(o.vistorias) ? o.vistorias : []

  // Detecta se o tipo salvo é um valor personalizado ("Outro")
  const tipoEhOutro = !TIPOS_OCORRENCIA.includes(o.tipo) || o.tipo === 'Outro'

  const [eTipo, setETipo] = useState(tipoEhOutro ? 'Outro' : o.tipo)
  const [eTipoOutro, setETipoOutro] = useState(tipoEhOutro && o.tipo !== 'Outro' ? o.tipo : '')
  const [eNatureza, setENatureza] = useState(o.natureza)
  const [eSubnatureza, setESubnatureza] = useState(o.subnatureza ?? '')
  const [eChuva, setEChuva] = useState(o.chuva != null ? String(o.chuva) : '')
  const [eMetragemLona, setEMetragemLona] = useState(o.metragem_lona != null ? String(o.metragem_lona) : '')
  const [eNivel, setENivel] = useState<NivelRisco>(o.nivel_risco)
  const [eStatus, setEStatus] = useState<StatusOc>(o.status_oc)
  const [eDataOcorrencia, setEDataOcorrencia] = useState(o.data_ocorrencia ?? '')
  const [eHoraInicio, setEHoraInicio] = useState(o.hora_inicio ?? '')
  const [eHoraFim, setEHoraFim] = useState(o.hora_fim ?? '')
  const ehIncendioOc = o.natureza === 'Incêndio em Área Urbana' || o.natureza === 'Incêndio em Área Rural'
  const ehIncendioEdicao = eNatureza === 'Incêndio em Área Urbana' || eNatureza === 'Incêndio em Área Rural'
  const [ePoligonoArea, setEPoligonoArea] = useState<PontoPoligono[]>(
    Array.isArray(o.poligono_area_queimada) ? o.poligono_area_queimada : []
  )
  const _endParts = (o.endereco ?? '').split(', ')
  const [eRua, setERua] = useState(_endParts[0] ?? '')
  const [eNumero, setENumero] = useState(_endParts[1] ?? '')
  const [eBairro, setEBairro] = useState(_endParts.slice(2).join(', ') ?? '')
  const eEndereco = [eRua, eNumero, eBairro].filter(Boolean).join(', ')
  const [eLatDms, setELatDms] = useState<DmsEdicao>(decimalParaPartesGms(o.lat, 'N', 'S'))
  const [eLngDms, setELngDms] = useState<DmsEdicao>(decimalParaPartesGms(o.lng, 'L', 'O'))
  const [eProprietario, setEProprietario] = useState(o.proprietario ?? '')
  const [eTelefoneProprietario, setETelefoneProprietario] = useState(o.telefone_proprietario ?? '')
  const [eSituacao, setESituacao] = useState(o.situacao ?? '')
  const [eRecomendacao, setERecomendacao] = useState(o.recomendacao ?? '')
  const [eConclusao, setEConclusao] = useState(o.conclusao ?? '')
  const [eAgentes, setEAgentes] = useState<string[]>(Array.isArray(o.agentes) ? o.agentes.map(normalizarNomeAgente) : [])
  const [eCreatedAt, setECreatedAt] = useState(() => isoParaDatetimeLocal(o.created_at))

  const precisaSubnatureza = eNatureza === 'Queda de Estrutura' || eNatureza === 'Apreensão e Captura de Animal'
  const labelSubnatureza = eNatureza === 'Queda de Estrutura' ? 'Qual é a estrutura?' : 'Qual é o animal?'
  const precisaPrecipitacaoEdicao = eNatureza === 'Inundação' || eNatureza === 'Alagamento'
  const precisaMetragemLonaEdicao = eNatureza === 'Entrega de Lona'
  const icone = NATUREZA_ICONE[o.natureza] ?? '📋'
  const cor = NATUREZA_COR[o.natureza] ?? '#1a4b8c'
  const dataFormatada = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : ''

  function iniciarEdicao() {
    const eh = !TIPOS_OCORRENCIA.includes(o.tipo) || o.tipo === 'Outro'
    setETipo(eh ? 'Outro' : o.tipo)
    setETipoOutro(eh && o.tipo !== 'Outro' ? o.tipo : '')
    setENatureza(o.natureza)
    setESubnatureza(o.subnatureza ?? '')
    setEChuva(o.chuva != null ? String(o.chuva) : '')
    setEMetragemLona(o.metragem_lona != null ? String(o.metragem_lona) : '')
    setENivel(o.nivel_risco)
    setEStatus(o.status_oc)
    setEDataOcorrencia(o.data_ocorrencia ?? '')
    setEHoraInicio(o.hora_inicio ?? '')
    setEHoraFim(o.hora_fim ?? '')
    setEPoligonoArea(Array.isArray(o.poligono_area_queimada) ? o.poligono_area_queimada : [])
    const partes = (o.endereco ?? '').split(', ')
    setERua(partes[0] ?? '')
    setENumero(partes[1] ?? '')
    setEBairro(partes.slice(2).join(', '))
    setELatDms(decimalParaPartesGms(o.lat, 'N', 'S'))
    setELngDms(decimalParaPartesGms(o.lng, 'L', 'O'))
    setEProprietario(o.proprietario ?? '')
    setETelefoneProprietario(o.telefone_proprietario ?? '')
    setESituacao(o.situacao ?? '')
    setERecomendacao(o.recomendacao ?? '')
    setEConclusao(o.conclusao ?? '')
    setEAgentes(Array.isArray(o.agentes) ? o.agentes.map(normalizarNomeAgente) : [])
    setECreatedAt(isoParaDatetimeLocal(o.created_at))
    setEFotos(Array.isArray(o.fotos) ? [...o.fotos] : [])
    setEDescricoesFotos(Array.isArray(o.descricoes_fotos) ? [...o.descricoes_fotos] : [])
    setEFotoAmpliada(null)
    setFotosCarregando(0)
    setGeoMsg('')
    setErroEdit('')
    setEditando(true)
  }

  function adicionarFotosEdicao(e: React.ChangeEvent<HTMLInputElement>, camera = false) {
    const files = e.target.files
    if (!files) return
    setFotosCarregando((n) => n + files.length)
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        try {
          if (ev.target?.result) {
            const resultado = await adicionarMarcaDagua(ev.target.result as string, o.lat ?? null, o.lng ?? null, 1280, 0.70, camera)
            setEFotos((prev) => [...prev, resultado])
            if (camera) salvarFotoNoDispositivo(resultado)
          }
        } finally {
          setFotosCarregando((n) => Math.max(0, n - 1))
        }
      }
      reader.onerror = () => setFotosCarregando((n) => Math.max(0, n - 1))
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  function cancelarEdicao() {
    setEditando(false)
    setGeoMsg('')
    setErroEdit('')
  }

  async function localizarEndereco() {
    if (!eEndereco.trim()) return
    setGeocodificando(true)
    setGeoMsg('')
    const res = await geocodificarEndereco(eEndereco)
    setGeocodificando(false)
    if (res) {
      setELatDms(decimalParaPartesGms(res.lat, 'N', 'S'))
      setELngDms(decimalParaPartesGms(res.lng, 'L', 'O'))
      setGeoMsg(`✅ ${formatarCoordenadas(res.lat, res.lng)}`)
    } else {
      setGeoMsg('⚠️ Endereço não encontrado')
    }
  }

  async function salvarEdicao() {
    const tipoFinal = eTipo === 'Outro' ? (eTipoOutro.trim() || 'Outro') : eTipo
    if (!tipoFinal) { setErroEdit('Selecione o tipo.'); return }
    if (!eNatureza) { setErroEdit('Selecione a natureza.'); return }
    if (precisaMetragemLonaEdicao && (!eMetragemLona.trim() || Number(eMetragemLona) < 0)) {
      setErroEdit('Informe a quantidade de metros de lona.')
      return
    }

    let finalLat: number | null
    let finalLng: number | null
    try {
      finalLat = partesGmsParaDecimal(eLatDms, 'S', 90, 'Latitude')
      finalLng = partesGmsParaDecimal(eLngDms, 'O', 180, 'Longitude')
    } catch (err) {
      setErroEdit(err instanceof Error ? err.message : 'Confira as coordenadas.')
      return
    }
    if ((finalLat == null || finalLng == null) && (finalLat != null || finalLng != null)) {
      setErroEdit('Informe latitude e longitude completas, ou limpe as duas coordenadas.')
      return
    }
    if (finalLat == null && eEndereco.trim() && navigator.onLine) {
      const geo = await geocodificarEndereco(eEndereco)
      if (geo) { finalLat = geo.lat; finalLng = geo.lng }
    }

    setSalvando(true)
    setErroEdit('')
    try {
      const horasTotalBruto = (eHoraInicio && eHoraFim) ? calcularHorasTotal(eHoraInicio, eHoraFim) : null
      const horasTotal = horasTotalBruto  // horas brutas, sem multiplicador
      // Horas que entram no banco: dom/feriado = todas as horas; seg–sáb = sobreaviso 17h–7h (sem mult)
      const horasBancoAgentes = eAgentes.map((agente) => (
        eHoraInicio && eHoraFim && eDataOcorrencia
          ? calcularHorasOcorrenciaBanco(eDataOcorrencia, eHoraInicio, eHoraFim, feriadosCustom, agente)
          : 0
      ))
      const horasBanco = horasBancoAgentes.length > 0
        ? Math.max(...horasBancoAgentes)
        : (eHoraInicio && eHoraFim && eDataOcorrencia
          ? calcularHorasOcorrenciaBanco(eDataOcorrencia, eHoraInicio, eHoraFim, feriadosCustom)
          : null)

      const dadosEditados = {
        tipo: tipoFinal,
        natureza: eNatureza,
        created_at: eCreatedAt ? new Date(eCreatedAt).toISOString() : o.created_at,
        subnatureza: precisaSubnatureza ? eSubnatureza || null : null,
        chuva: precisaPrecipitacaoEdicao && eChuva !== '' ? Number(eChuva) : null,
        metragem_lona: precisaMetragemLonaEdicao && eMetragemLona !== '' ? Number(eMetragemLona) : null,
        nivel_risco: eNivel,
        status_oc: eStatus,
        data_ocorrencia: eDataOcorrencia || null,
        hora_inicio: eHoraInicio || null,
        hora_fim: eHoraFim || null,
        horas_total: horasTotal,
        horas_sobreaviso: horasBanco,
        fotos: eFotos,
        descricoes_fotos: eDescricoesFotos,
        lat: finalLat,
        lng: finalLng,
        endereco: eEndereco || null,
        proprietario: eProprietario || null,
        telefone_proprietario: eTelefoneProprietario.trim() || null,
        situacao: eSituacao || null,
        recomendacao: eRecomendacao || null,
        conclusao: eConclusao || null,
        agentes: eAgentes,
        focos_incendio: Array.isArray(o.focos_incendio) && o.focos_incendio.length > 0 ? o.focos_incendio : null,
        vistorias: Array.isArray(o.vistorias) ? o.vistorias : [],
        poligono_area_queimada: ehIncendioEdicao && ePoligonoArea.length >= 3 ? ePoligonoArea : null,
      }
      let atualizado: Ocorrencia
      if (o._offline && o._localId != null) {
        await updatePending(o._localId, dadosEditados)
        atualizado = { ...o, ...dadosEditados }
      } else {
        atualizado = await atualizarOcorrencia(o.id, dadosEditados)
      }

      setO(atualizado)
      onAtualizado(atualizado)
      setEditando(false)
    } catch (err) {
      console.error('salvarEdicao error:', err)
      setErroEdit(err instanceof Error ? `Erro: ${err.message}` : 'Erro ao salvar. Tente novamente.')
    }
    setSalvando(false)
  }

  async function exportarKMZ() {
    const pol = Array.isArray((o as any).poligono_area_queimada)
      ? (o as any).poligono_area_queimada as { lat: number; lng: number }[]
      : []
    const temPoligono = pol.length >= 3

    const ehIncendioKmz = o.natureza === 'Incêndio em Área Urbana' || o.natureza === 'Incêndio em Área Rural'
    const areaQueimadaTexto = (temPoligono && ehIncendioKmz)
      ? `<b>Área Queimada:</b> ${formatarArea(calcularAreaM2(pol))}<br/>`
      : ''

    const descricao = `<![CDATA[
        <b>Tipo:</b> ${o.tipo}<br/>
        <b>Natureza:</b> ${o.natureza}${o.subnatureza ? ` (${o.subnatureza})` : ''}<br/>
        <b>Nível de Risco:</b> ${o.nivel_risco}<br/>
        <b>Status:</b> ${o.status_oc}<br/>
        ${o.endereco ? `<b>Endereço:</b> ${o.endereco}<br/>` : ''}
        ${o.proprietario ? `<b>Proprietário:</b> ${o.proprietario}<br/>` : ''}
        ${o.situacao ? `<b>Situação:</b> ${o.situacao}<br/>` : ''}
        ${areaQueimadaTexto}<b>Data:</b> ${dataFormatada}
      ]]>`

    const poligonoPlacemark = temPoligono ? `
    <Placemark>
      <name>🔥 Área Queimada — ${o.natureza}${o.endereco ? ' · ' + o.endereco : ''}</name>
      <description>${descricao}</description>
      <styleUrl>#areaQueimada</styleUrl>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${[...pol, pol[0]].map(p => `${p.lng},${p.lat},0`).join(' ')}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>` : ''

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>CODAP — Conselheiro Lafaiete — Ocorrência #${o.id}</name>
    <Style id="areaQueimada">
      <LineStyle>
        <color>ff0000ff</color>
        <width>2.5</width>
      </LineStyle>
      <PolyStyle>
        <color>660000ff</color>
      </PolyStyle>
    </Style>
    <Placemark>
      <name>${o.natureza}</name>
      <description>${descricao}</description>
      ${o.lat && o.lng ? `<Point><coordinates>${o.lng},${o.lat},0</coordinates></Point>` : ''}
    </Placemark>
    ${poligonoPlacemark}
  </Document>
</kml>`
    const zip = new JSZip()
    zip.file('ocorrencia.kml', kml)
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ocorrencia_${o.id}.kmz`
    a.click()
    URL.revokeObjectURL(url)
  }

  function abrirNovaVistoria() {
    setNovaVistoriaObs('')
    setNovaVistoriaFotos([])
    setNovaVistoriaStatus('ativo')
    setNovaVistoriaData(new Date().toISOString())
    setErroVistoria('')
    setNovaVistoriaAberta(true)
  }

  function cancelarNovaVistoria() {
    setNovaVistoriaAberta(false)
    setNovaVistoriaObs('')
    setNovaVistoriaFotos([])
    setErroVistoria('')
  }

  function adicionarFotosVistoria(e: React.ChangeEvent<HTMLInputElement>, camera = false) {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        if (ev.target?.result) {
          const resultado = await adicionarMarcaDagua(ev.target.result as string, o.lat, o.lng, 1280, 0.70, camera)
          setNovaVistoriaFotos((prev) => [...prev, resultado])
          if (camera) salvarFotoNoDispositivo(resultado)
        }
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  async function salvarNovaVistoria() {
    if (!novaVistoriaObs.trim() && novaVistoriaFotos.length === 0) {
      setErroVistoria('Informe ao menos uma observação ou foto da nova vistoria.')
      return
    }
    setErroVistoria('')
    setSalvandoVistoria(true)
    try {
      const nova: VistoriaAdicional = {
        data: novaVistoriaData || new Date().toISOString(),
        observacao: novaVistoriaObs.trim(),
        fotos: novaVistoriaFotos,
        agente: getAgenteLogado() || null,
        status: novaVistoriaStatus,
      }
      const vistoriasAtualizadas = [...vistoriasSalvas, nova]
      // IMPORTANTE: aqui SÓ atualizamos o campo `vistorias`. Não tocamos em
      // `status_oc`, `nivel_risco` ou qualquer outro campo da ocorrência
      // original — o status marcado na Nova Vistoria é independente do
      // status da ocorrência principal.
      const dadosUpdate = {
        vistorias: vistoriasAtualizadas,
      }
      let atualizado: Ocorrencia
      if (o._offline && o._localId != null) {
        await updatePending(o._localId, dadosUpdate)
        atualizado = { ...o, vistorias: vistoriasAtualizadas }
      } else {
        const retorno = await atualizarOcorrencia(o.id, dadosUpdate)
        // Garantia extra: preserva os campos originais da ocorrência (status,
        // nível, etc.) mesmo que o retorno do banco trouxer algo diferente.
        atualizado = { ...o, ...retorno, status_oc: o.status_oc, nivel_risco: o.nivel_risco, vistorias: vistoriasAtualizadas }
      }
      setO(atualizado)
      onAtualizado(atualizado)
      setNovaVistoriaAberta(false)
      setNovaVistoriaObs('')
      setNovaVistoriaFotos([])
    } catch (err) {
      console.error(err)
      setErroVistoria('Erro ao salvar nova vistoria. Tente novamente.')
    } finally {
      setSalvandoVistoria(false)
    }
  }

  async function salvarRelatorio() {
    setGerandoRelatorio(true)
    try {
      const { gerarRelatorioVistoria, relatorioFileName } = await import('../relatorioVistoria')
      const blob = await gerarRelatorioVistoria(o)
      const filename = relatorioFileName(o)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao salvar relatório')
    } finally {
      setGerandoRelatorio(false)
    }
  }

  async function baixarPasta() {
    setGerandoPasta(true)
    try {
      await exportarPastaOcorrencia(o)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao gerar pasta')
    } finally {
      setGerandoPasta(false)
    }
  }

  async function confirmarDelete() {
    if (!confirm(`Excluir ocorrência #${o.id}? Esta ação não pode ser desfeita.`)) return
    await deletarOcorrencia(o.id)
    onDeletado()
  }

  const totalFotos = o.fotos?.length ?? 0

  return (
    <>
      <div className="modal-overlay" onClick={editando ? undefined : onFechar}>
        <div className="modal-box" onClick={(e) => e.stopPropagation()}>

          {/* ── Header ── */}
          <div className="modal-header" style={{ background: cor }}>
            <div className="modal-titulo">
              <span className="modal-icone">{icone}</span>
              <div>
                <div className="modal-natureza">{o.natureza}</div>
                <div className="modal-tipo">{o.tipo} — #{o.id}</div>
              </div>
            </div>
            <div className="modal-header-acoes">
              {!editando && (
                <button
                  className="btn-pasta-header"
                  onClick={baixarPasta}
                  disabled={gerandoPasta || !fotosCarregadasDoServidor}
                  title={`Baixar pasta: ${nomePastaOcorrencia(o)}`}
                >
                  {gerandoPasta ? '⏳' : '📁'}
                </button>
              )}
              {!editando && podeEditar && (
                <button className="btn-editar-header" onClick={() => solicitarOuExecutar('editar')} title="Editar ocorrência">
                  ✏️
                </button>
              )}
              <button className="btn-fechar" onClick={editando ? cancelarEdicao : onFechar}>✕</button>
            </div>
          </div>

          {/* ── Corpo ── */}
          <div className="modal-corpo">

            {!editando ? (
              <>
                <div className="info-badges">
                  <span className={`nivel-badge nivel-${o.nivel_risco}`}>
                    {o.nivel_risco === 'baixo' ? '🟢 Baixo' : o.nivel_risco === 'medio' ? '🟡 Médio' : '🔴 Alto'}
                  </span>
                  <span className={`status-badge status-${o.status_oc}`}>
                    {o.status_oc === 'ativo' ? '🔴 Ativo' : '✅ Resolvido'}
                  </span>
                </div>

                {o.subnatureza && <InfoRow icone="↳" label="Detalhe" valor={o.subnatureza} />}
                {o.chuva != null && (
                  <InfoRow icone="🌧️" label="Precipitação de chuva" valor={`${Number(o.chuva).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm`} />
                )}
                {o.metragem_lona != null && (
                  <InfoRow icone="🟦" label="Quantidade de metros de lona" valor={`${Number(o.metragem_lona).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m`} />
                )}

                {o.data_ocorrencia && (
                  <InfoRow icone="📅" label="Data da Ocorrência"
                    valor={parseDateLocal(o.data_ocorrencia)?.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) ?? '—'}
                  />
                )}

                {(o.hora_inicio || o.hora_fim) && (
                  <div className="info-row">
                    <span className="info-icone">🕐</span>
                    <div>
                      <div className="info-label">Horário da Ocorrência</div>
                      <div className="info-valor">
                        {o.hora_inicio && o.hora_fim
                          ? `${o.hora_inicio} → ${o.hora_fim}`
                          : o.hora_inicio ? `Início: ${o.hora_inicio}` : `Fim: ${o.hora_fim}`
                        }
                        {o.horas_total != null && o.horas_total > 0 && (
                          <span style={{ marginLeft: '0.6rem', color: '#6b7280' }}>({formatarHoras(Number(o.horas_total))} de ocorrência)</span>
                        )}
                      </div>
                      {o.horas_total != null && o.horas_total > 0 && Number(o.horas_sobreaviso) > 0 && (
                        <div className="info-valor" style={{ color: '#1d4ed8', fontWeight: 700, marginTop: '0.15rem' }}>
                          ⏱ {formatarHoras(Number(o.horas_total))} de ocorrência — lançado no banco de horas
                        </div>
                      )}
                      {o.horas_sobreaviso === 0 && o.horas_total != null && o.horas_total > 0 && (
                        <div className="info-valor" style={{ color: '#9ca3af', marginTop: '0.15rem' }}>
                          ☀️ Horário comercial — sem horas de sobreaviso
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(o.lat && o.lng) && (
                  <InfoRow icone="🛰️" label="Coordenadas GPS" valor={formatarCoordenadas(o.lat, o.lng)} />
                )}
                {o.endereco && (
                  <InfoRow icone="📍" label="Endereço" valor={o.endereco} />
                )}
                {!o.lat && !o.lng && !o.endereco && (
                  <InfoRow icone="📍" label="Localização" valor="Não informada" />
                )}

                {/* ── Focos de Incêndio ── */}
                {Array.isArray(o.focos_incendio) && o.focos_incendio.length > 0 && (
                  <div className="focos-incendio-detalhe">
                    <div className="detalhe-label-row">🔥 Focos de Incêndio ({o.focos_incendio.length})</div>
                    {o.focos_incendio.map((foco, idx) => (
                      <div key={idx} className="foco-detalhe-item">
                        <span className="foco-detalhe-num">Foco {idx + 1}</span>
                        <span className="foco-detalhe-coords">{formatarCoordenadas(foco.lat, foco.lng)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Área Queimada ── */}
                {Array.isArray(o.poligono_area_queimada) && o.poligono_area_queimada.length >= 3 && (() => {
                  const area = calcularAreaM2(o.poligono_area_queimada!)
                  return (
                    <div className="area-queimada-detalhe">
                      <div className="detalhe-label-row">🔶 Área Queimada</div>
                      <div className="area-queimada-resultado">
                        <span className="area-queimada-icone">📐</span>
                        <span className="area-queimada-valor">{formatarArea(area)}</span>
                        <span className="area-queimada-vertices">({o.poligono_area_queimada!.length} vértices)</span>
                      </div>
                    </div>
                  )
                })()}

                {o.proprietario && <InfoRow icone="👤" label="Proprietário / Morador" valor={o.proprietario} />}
                {o.telefone_proprietario && <InfoRow icone="📞" label="Telefone do Proprietário / Morador" valor={o.telefone_proprietario} />}
                {o.situacao && <InfoRow icone="📝" label="Situação" valor={o.situacao} />}
                {o.recomendacao && <InfoRow icone="💡" label="Recomendação" valor={o.recomendacao} />}
                {o.conclusao && <InfoRow icone="✅" label="Conclusão" valor={o.conclusao} />}
                {o.responsavel_registro && (
                  <InfoRow icone="🪪" label="Responsável pelo Registro" valor={normalizarNomeAgente(o.responsavel_registro!)} destaque />
                )}
                {Array.isArray(o.agentes) && o.agentes.length > 0 && (
                  <InfoRow icone="👷" label="Agentes Empenhados" valor={o.agentes.map(normalizarNomeAgente).join(', ')} />
                )}
                <InfoRow icone="🕐" label="Registrado em" valor={dataFormatada} />

                {!fotosCarregadasDoServidor && !oc._offline && (
                  <div className="fotos-detalhe">
                    <div className="detalhe-label-row">🖼️ Carregando fotos...</div>
                  </div>
                )}
                {fotosCarregadasDoServidor && totalFotos > 0 && (
                  <div className="fotos-detalhe">
                    <div className="detalhe-label-row">🖼️ Fotos ({totalFotos}) — toque para ampliar</div>
                    <div className="fotos-grid">
                      {o.fotos.map((f, i) => (
                        <div key={i} className="foto-item">
                          <button
                            className="foto-btn"
                            onClick={() => setFotoAmpliada(i)}
                            title="Ampliar foto"
                          >
                            <img src={f} alt={`Foto ${i + 1}`} className="foto-detalhe" />
                          </button>
                          {o.descricoes_fotos?.[i] && (
                            <p className="foto-legenda-view">Figura {i + 1} — {o.descricoes_fotos[i]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Histórico de Novas Vistorias (Interdição de Imóvel) ── */}
                {ehInterdicaoImovel && vistoriasSalvas.length > 0 && (
                  <div className="vistorias-historico">
                    <div className="detalhe-label-row">
                      🔍 Vistorias adicionais ({vistoriasSalvas.length})
                    </div>
                    {vistoriasSalvas.map((v, idx) => (
                      <div key={idx} className="vistoria-card">
                        <div className="vistoria-cabecalho">
                          <strong>Vistoria #{idx + 1}</strong>
                          <span className="vistoria-data">
                            {new Date(v.data).toLocaleString('pt-BR')}
                          </span>
                        </div>
                        {v.status && (
                          <div className={`vistoria-status vistoria-status--${v.status}`}>
                            {v.status === 'resolvido' ? '✅ Resolvido' : '🟠 Ativo'}
                          </div>
                        )}
                        {v.agente && (
                          <div className="vistoria-agente">👤 {normalizarNomeAgente(v.agente)}</div>
                        )}
                        {v.observacao && (
                          <div className="vistoria-obs">{v.observacao}</div>
                        )}
                        {Array.isArray(v.fotos) && v.fotos.length > 0 && (
                          <div className="fotos-grid">
                            {v.fotos.map((f, fIdx) => (
                              <button
                                key={fIdx}
                                className="foto-btn"
                                onClick={() => setVistoriaFotoAmpliada({ vIdx: idx, fIdx })}
                                title="Ampliar foto"
                              >
                                <img src={f} alt={`Vistoria ${idx + 1} foto ${fIdx + 1}`} className="foto-detalhe" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Formulário inline para Nova Vistoria ── */}
                {ehInterdicaoImovel && novaVistoriaAberta && (
                  <div className="vistoria-nova-card">
                    <div className="detalhe-label-row">➕ Nova Vistoria</div>

                    <div className="campo">
                      <label className="campo-label">📅 Data e hora da vistoria</label>
                      <div className="vistoria-data-auto">
                        {novaVistoriaData
                          ? new Date(novaVistoriaData).toLocaleString('pt-BR')
                          : new Date().toLocaleString('pt-BR')}
                        <span className="vistoria-data-tag">automático</span>
                      </div>
                    </div>

                    <div className="campo">
                      <label className="campo-label">🚦 Status</label>
                      <div className="vistoria-status-opcoes">
                        <button
                          type="button"
                          className={`vistoria-status-btn ${novaVistoriaStatus === 'ativo' ? 'ativo-sel' : ''}`}
                          onClick={() => setNovaVistoriaStatus('ativo')}
                        >
                          🟠 Ativo
                        </button>
                        <button
                          type="button"
                          className={`vistoria-status-btn ${novaVistoriaStatus === 'resolvido' ? 'resolvido-sel' : ''}`}
                          onClick={() => setNovaVistoriaStatus('resolvido')}
                        >
                          ✅ Resolvido
                        </button>
                      </div>
                    </div>

                    <div className="campo">
                      <label className="campo-label">Fotos da nova vistoria</label>
                      <div className="fotos-area">
                        {novaVistoriaFotos.map((f, i) => (
                          <div key={i} className="foto-wrap">
                            <img src={f} alt="" className="foto-thumb" />
                            <button
                              className="foto-del"
                              onClick={() => setNovaVistoriaFotos((p) => p.filter((_, j) => j !== i))}
                            >✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="fotos-botoes">
                        <button className="btn-foto-camera" onClick={() => camVistoriaRef.current?.click()}>
                          <span>📷</span><span>Tirar Foto</span>
                        </button>
                        <button className="btn-foto-galeria" onClick={() => galVistoriaRef.current?.click()}>
                          <span>🖼️</span><span>Carregar Foto</span>
                        </button>
                      </div>
                      <input ref={camVistoriaRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => adicionarFotosVistoria(e, true)} />
                      <input ref={galVistoriaRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => adicionarFotosVistoria(e, false)} />
                    </div>
                    <div className="campo">
                      <label className="campo-label">📝 Observação</label>
                      <textarea
                        className="campo-textarea"
                        rows={4}
                        placeholder="Descreva o que foi observado nesta nova vistoria..."
                        value={novaVistoriaObs}
                        onChange={(e) => setNovaVistoriaObs(e.target.value)}
                      />
                    </div>
                    {erroVistoria && <div className="erro-msg">⚠️ {erroVistoria}</div>}
                    <div className="vistoria-nova-acoes">
                      <button className="btn-cancelar-edit" onClick={cancelarNovaVistoria} disabled={salvandoVistoria}>
                        Cancelar
                      </button>
                      <button className="btn-salvar-edit" onClick={salvarNovaVistoria} disabled={salvandoVistoria}>
                        {salvandoVistoria ? '⏳ Salvando...' : '💾 Salvar Nova Vistoria'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="edit-form">
                <div className="edit-secao-titulo">✏️ Editar Ocorrência</div>

                {/* Tipo */}
                <div className="campo campo-edit">
                  <label className="campo-label">Tipo</label>
                  <select className="campo-select" value={eTipo} onChange={(e) => { setETipo(e.target.value); setETipoOutro('') }}>
                    {TIPOS_OCORRENCIA.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  {eTipo === 'Outro' && (
                    <input
                      className="campo-input"
                      style={{ marginTop: '0.5rem' }}
                      type="text"
                      placeholder="Descreva o tipo de ocorrência..."
                      value={eTipoOutro}
                      onChange={(e) => setETipoOutro(e.target.value)}
                    />
                  )}
                </div>

                {/* Natureza */}
                <div className="campo campo-edit">
                  <label className="campo-label">Natureza</label>
                  <select className="campo-select" value={eNatureza} onChange={(e) => { setENatureza(e.target.value); setESubnatureza('') }}>
                    {NATUREZAS.map((n) => <option key={n}>{n}</option>)}
                  </select>
                </div>

                {precisaPrecipitacaoEdicao && (
                  <div className="campo campo-edit campo-sub">
                    <label className="campo-label campo-label-sub">↳ Precipitação de chuva (mm)</label>
                    <input
                      className="campo-input"
                      type="number"
                      min="0"
                      step="0.1"
                      inputMode="decimal"
                      placeholder="Informe o volume de chuva"
                      value={eChuva}
                      onChange={(e) => setEChuva(e.target.value)}
                    />
                  </div>
                )}

                {precisaMetragemLonaEdicao && (
                  <div className="campo campo-edit campo-sub">
                    <label className="campo-label campo-label-sub">↳ Quantidade de metros de lona</label>
                    <input
                      className="campo-input"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="Informe a metragem em metros"
                      value={eMetragemLona}
                      onChange={(e) => setEMetragemLona(e.target.value)}
                    />
                  </div>
                )}

                {precisaSubnatureza && (
                  <div className="campo campo-edit campo-sub">
                    <label className="campo-label campo-label-sub">↳ {labelSubnatureza}</label>
                    <input className="campo-input" type="text" value={eSubnatureza} onChange={(e) => setESubnatureza(e.target.value)} />
                  </div>
                )}

                {/* Nível de risco */}
                <div className="campo campo-edit">
                  <label className="campo-label">Nível de Risco</label>
                  <div className="toggle-group">
                    {(['baixo', 'medio', 'alto'] as NivelRisco[]).map((n) => (
                      <button key={n} className={`toggle-btn toggle-${n} ${eNivel === n ? 'ativo' : ''}`} onClick={() => setENivel(n)}>
                        {n === 'baixo' ? 'Baixo' : n === 'medio' ? 'Médio' : 'Alto'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Status */}
                <div className="campo campo-edit">
                  <label className="campo-label">Status</label>
                  <div className="toggle-group">
                    {(['ativo', 'resolvido'] as StatusOc[]).map((s) => (
                      <button key={s} className={`toggle-btn toggle-status-${s} ${eStatus === s ? 'ativo' : ''}`} onClick={() => setEStatus(s)}>
                        {s === 'ativo' ? 'Ativo' : 'Resolvido'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Data da Ocorrência */}
                <div className="campo campo-edit">
                  <label className="campo-label">📅 Data da Ocorrência</label>
                  <input
                    className="campo-input"
                    type="date"
                    value={eDataOcorrencia}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setEDataOcorrencia(e.target.value)}
                  />
                </div>

                {/* Horário */}
                <div className="campo campo-edit">
                  <label className="campo-label">🕐 Horário da Ocorrência</label>
                  <div className="horario-row">
                    <div className="horario-item">
                      <label className="horario-sublabel">Início</label>
                      <input
                        className="campo-input"
                        type="time"
                        value={eHoraInicio}
                        onChange={(e) => setEHoraInicio(e.target.value)}
                      />
                    </div>
                    <div className="horario-item">
                      <label className="horario-sublabel">Fim</label>
                      <input
                        className="campo-input"
                        type="time"
                        value={eHoraFim}
                        onChange={(e) => setEHoraFim(e.target.value)}
                      />
                    </div>
                  </div>
                  {eHoraInicio && eHoraFim && (() => {
                    const totalBruto = calcularHorasTotal(eHoraInicio, eHoraFim)
                    const extrasPorAgente = eAgentes
                      .map((agente) => ({
                        agente,
                        horas: calcularHorasOcorrenciaBanco(eDataOcorrencia, eHoraInicio, eHoraFim, feriadosCustom, agente),
                      }))
                      .filter(({ horas }) => horas > 0)
                    return (
                      <div className="horario-resumo">
                        <span className="horario-total">
                          ⏱ Total: <strong>{formatarHoras(totalBruto)}</strong>
                        </span>
                        {extrasPorAgente.length > 0
                          ? <span className="horario-sobreaviso">🌙 Hora extra — {extrasPorAgente.map(({ agente, horas }) => `${agente}: ${formatarHoras(horas)}`).join(' · ')} no banco</span>
                          : <span className="horario-sem-sobreaviso">☀️ Sem horas fora da jornada no banco</span>
                        }
                        {extrasPorAgente.length > 0 && <div className="geo-dica" style={{marginTop:'0.3rem'}}>Fora da jornada individual · Dom/feriado: todas as horas · Risco alto: ×2</div>}
                      </div>
                    )
                  })()}
                </div>

                {/* Polígono da Área Queimada (apenas para incêndios) */}
                {ehIncendioEdicao && (
                  <PoligonoAreaQueimada
                    pontos={ePoligonoArea}
                    onChange={setEPoligonoArea}
                    focoLat={Array.isArray(o.focos_incendio) && o.focos_incendio.length > 0 ? o.focos_incendio[0].lat : o.lat}
                    focoLng={Array.isArray(o.focos_incendio) && o.focos_incendio.length > 0 ? o.focos_incendio[0].lng : o.lng}
                  />
                )}

                {/* Endereço */}
                <div className="campo campo-edit">
                  <label className="campo-label">📍 Endereço</label>
                  <div className="endereco-campos">
                    <div className="endereco-rua-row">
                      <input
                        className="campo-input"
                        type="text"
                        placeholder="Rua / Logradouro"
                        value={eRua}
                        onChange={(e) => { setERua(e.target.value); setGeoMsg('') }}
                      />
                      <button className="btn-geocode" onClick={localizarEndereco} disabled={geocodificando || !eEndereco.trim()} title="Localizar no mapa">
                        {geocodificando ? '⏳' : '🗺️'}
                      </button>
                    </div>
                    <div className="endereco-num-bairro-row">
                      <input
                        className="campo-input endereco-num"
                        type="text"
                        placeholder="Nº"
                        value={eNumero}
                        onChange={(e) => { setENumero(e.target.value); setGeoMsg('') }}
                      />
                      <input
                        className="campo-input endereco-bairro"
                        type="text"
                        placeholder="Bairro"
                        value={eBairro}
                        onChange={(e) => { setEBairro(e.target.value); setGeoMsg('') }}
                      />
                    </div>
                  </div>
                  {geoMsg && (
                    <div className={`geo-msg ${geoMsg.startsWith('✅') ? 'geo-ok' : 'geo-warn'}`}>{geoMsg}</div>
                  )}
                </div>

                {/* Coordenadas GPS */}
                <div className="campo campo-edit">
                  <label className="campo-label">🛰️ Coordenadas GPS</label>
                  <div className="gps-dms-edit">
                    <div className="gps-dms-linha">
                      <span className="gps-dms-label">Lat.</span>
                      <input className="campo-input gps-dms-num" type="text" inputMode="numeric" placeholder="Graus" value={eLatDms.graus} onChange={(e) => setELatDms((p) => ({ ...p, graus: e.target.value }))} />
                      <span className="gps-dms-unidade">°</span>
                      <input className="campo-input gps-dms-num" type="text" inputMode="numeric" placeholder="Min" value={eLatDms.minutos} onChange={(e) => setELatDms((p) => ({ ...p, minutos: e.target.value }))} />
                      <span className="gps-dms-unidade">'</span>
                      <input className="campo-input gps-dms-sec" type="text" inputMode="decimal" placeholder="Seg" value={eLatDms.segundos} onChange={(e) => setELatDms((p) => ({ ...p, segundos: e.target.value }))} />
                      <span className="gps-dms-unidade">"</span>
                      <select className="campo-select gps-dms-dir" value={eLatDms.direcao} onChange={(e) => setELatDms((p) => ({ ...p, direcao: e.target.value }))}>
                        <option>S</option>
                        <option>N</option>
                      </select>
                    </div>
                    <div className="gps-dms-linha">
                      <span className="gps-dms-label">Long.</span>
                      <input className="campo-input gps-dms-num" type="text" inputMode="numeric" placeholder="Graus" value={eLngDms.graus} onChange={(e) => setELngDms((p) => ({ ...p, graus: e.target.value }))} />
                      <span className="gps-dms-unidade">°</span>
                      <input className="campo-input gps-dms-num" type="text" inputMode="numeric" placeholder="Min" value={eLngDms.minutos} onChange={(e) => setELngDms((p) => ({ ...p, minutos: e.target.value }))} />
                      <span className="gps-dms-unidade">'</span>
                      <input className="campo-input gps-dms-sec" type="text" inputMode="decimal" placeholder="Seg" value={eLngDms.segundos} onChange={(e) => setELngDms((p) => ({ ...p, segundos: e.target.value }))} />
                      <span className="gps-dms-unidade">"</span>
                      <select className="campo-select gps-dms-dir" value={eLngDms.direcao} onChange={(e) => setELngDms((p) => ({ ...p, direcao: e.target.value }))}>
                        <option>O</option>
                        <option>L</option>
                      </select>
                    </div>
                  </div>
                  <div className="gps-edit-row gps-edit-row-acoes">
                    <button
                      className="btn-gps"
                      title="Obter GPS atual"
                      onClick={() => {
                        if (!navigator.geolocation) {
                          setGeoMsg('⚠️ GPS não suportado neste dispositivo.')
                          return
                        }
                        // IMPORTANTE: no iOS o getCurrentPosition deve ser chamado de forma
                        // síncrona dentro do handler do gesto do usuário.
                        navigator.geolocation.getCurrentPosition((p) => {
                          setELatDms(decimalParaPartesGms(parseFloat(p.coords.latitude.toFixed(6)), 'N', 'S'))
                          setELngDms(decimalParaPartesGms(parseFloat(p.coords.longitude.toFixed(6)), 'L', 'O'))
                          setGeoMsg('✅ GPS atualizado!')
                        }, (err) => setGeoMsg(`⚠️ ${mensagemErroGps(err)}`), { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 })
                      }}
                    >
                      📍 Usar GPS atual
                    </button>
                    <button
                      className="btn-gps btn-gps-limpar"
                      title="Limpar coordenadas"
                      onClick={() => {
                        setELatDms(decimalParaPartesGms(null, 'N', 'S'))
                        setELngDms(decimalParaPartesGms(null, 'L', 'O'))
                      }}
                    >
                      ✕ Limpar
                    </button>
                  </div>
                </div>

                {/* Proprietário */}
                <div className="campo campo-edit">
                  <label className="campo-label">👤 Proprietário / Morador</label>
                  <input
                    className="campo-input"
                    type="text"
                    placeholder="Nome completo"
                    value={eProprietario}
                    onChange={(e) => setEProprietario(e.target.value)}
                  />
                  <label className="campo-label campo-label-sub">↳ DDD e telefone</label>
                  <input
                    className="campo-input"
                    type="tel"
                    inputMode="tel"
                    maxLength={20}
                    placeholder="(31) 99999-9999"
                    value={eTelefoneProprietario}
                    onChange={(e) => setETelefoneProprietario(e.target.value)}
                  />
                </div>

                {/* Situação */}
                <div className="campo campo-edit">
                  <label className="campo-label">📝 9 — Situação</label>
                  <textarea
                    className="campo-textarea"
                    rows={3}
                    placeholder="Descreva a situação da ocorrência..."
                    value={eSituacao}
                    onChange={(e) => setESituacao(e.target.value)}
                  />
                </div>

                {/* Recomendação */}
                <div className="campo campo-edit">
                  <label className="campo-label">💡 10 — Recomendação</label>
                  <textarea
                    className="campo-textarea"
                    rows={3}
                    placeholder="Descreva a recomendação..."
                    value={eRecomendacao}
                    onChange={(e) => setERecomendacao(e.target.value)}
                  />
                </div>

                {/* Conclusão */}
                <div className="campo campo-edit">
                  <label className="campo-label">✅ 11 — Conclusão</label>
                  <textarea
                    className="campo-textarea"
                    rows={3}
                    placeholder="Descreva a conclusão..."
                    value={eConclusao}
                    onChange={(e) => setEConclusao(e.target.value)}
                  />
                </div>

                {/* Agentes Empenhados */}
                <div className="campo campo-edit">
                  <label className="campo-label">👷 12 — Agentes Empenhados na Ocorrência</label>
                  <div className="agentes-lista">
                    {AGENTES.map((nome) => (
                      <label key={nome} className="agente-item">
                        <input
                          type="checkbox"
                          className="agente-checkbox"
                          checked={eAgentes.includes(nome)}
                          onChange={(e) => {
                            if (e.target.checked) setEAgentes((p) => [...p, nome])
                            else setEAgentes((p) => p.filter((a) => a !== nome))
                          }}
                        />
                        <span className="agente-nome">{nome}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Registrado em */}
                <div className="campo campo-edit">
                  <label className="campo-label">🕐 Registrado em</label>
                  <input
                    className="campo-input"
                    type="datetime-local"
                    value={eCreatedAt}
                    onChange={(e) => setECreatedAt(e.target.value)}
                  />
                </div>

                {/* Fotos */}
                <div className="campo campo-edit">
                  <label className="campo-label">🖼️ Fotos ({eFotos.length})</label>
                  <div className="fotos-area">
                    {eFotos.map((f, i) => (
                      <div key={i} className="foto-wrap">
                        <img
                          src={f}
                          alt={`Foto ${i + 1}`}
                          className="foto-thumb"
                          onClick={() => setEFotoAmpliada(i)}
                          style={{ cursor: 'pointer' }}
                        />
                        <button
                          className="foto-del"
                          onClick={() => setEFotos((p) => p.filter((_, j) => j !== i))}
                          title="Remover foto"
                        >✕</button>
                        <input
                          className="foto-descricao-input"
                          type="text"
                          placeholder={`Legenda (opcional)`}
                          value={eDescricoesFotos[i] ?? ''}
                          onChange={e => {
                            const val = e.target.value
                            setEDescricoesFotos(prev => {
                              const next = [...prev]
                              next[i] = val
                              return next
                            })
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="fotos-botoes">
                    <button className="btn-foto-camera" onClick={() => camEditRef.current?.click()}>
                      <span>📷</span><span>Tirar Foto</span>
                    </button>
                    <button className="btn-foto-galeria" onClick={() => galEditRef.current?.click()}>
                      <span>🖼️</span><span>Carregar Foto</span>
                    </button>
                  </div>
                  <input ref={camEditRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => adicionarFotosEdicao(e, true)} />
                  <input ref={galEditRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => adicionarFotosEdicao(e, false)} />
                </div>

                {erroEdit && <div className="erro-msg">⚠️ {erroEdit}</div>}
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="modal-footer">
            {!editando ? (
              <>
                {ehInterdicaoImovel && !novaVistoriaAberta && (
                  <button className="btn-nova-vistoria" onClick={abrirNovaVistoria}>
                    ➕ Nova Vistoria
                  </button>
                )}
                {podeEditar && (
                  <button className="btn-editar" onClick={() => solicitarOuExecutar('editar')}>✏️ Editar</button>
                )}
                <button className="btn-relatorio" onClick={salvarRelatorio} disabled={gerandoRelatorio}>
                  {gerandoRelatorio ? '⏳ Salvando...' : '📄 Salvar relatório'}
                </button>
                <button className="btn-excel" onClick={() => exportarOcorrenciaExcel(o)}>📊 Excel</button>
                <button className="btn-kmz" onClick={exportarKMZ}>🌍 KMZ</button>
                {podeEditar && (
                  <button className="btn-deletar" onClick={() => solicitarOuExecutar('deletar')}>🗑️</button>
                )}
                {!podeEditar && responsavel && (
                  <span className="btn-bloqueado-info" title={`Apenas ${responsavel} pode editar ou excluir esta ocorrência.`}>
                    🔒 Edição restrita a {responsavel}
                  </span>
                )}
              </>
            ) : (
              <>
                <button className="btn-cancelar-edit" onClick={cancelarEdicao}>Cancelar</button>
                <button className="btn-salvar-edit" onClick={salvarEdicao} disabled={salvando || fotosCarregando > 0}>
                  {fotosCarregando > 0 ? `⏳ Carregando ${fotosCarregando} foto(s)...` : salvando ? '⏳ Salvando...' : '💾 Salvar alterações'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Lightbox de fotos no modo edição ── */}
      {eFotoAmpliada !== null && eFotos.length > 0 && (
        <div className="lightbox-overlay" onClick={() => setEFotoAmpliada(null)}>
          <div className="lightbox-box" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-fechar" onClick={() => setEFotoAmpliada(null)}>✕</button>
            {eFotos.length > 1 && (
              <button
                className="lightbox-nav lightbox-prev"
                onClick={() => setEFotoAmpliada((eFotoAmpliada - 1 + eFotos.length) % eFotos.length)}
              >‹</button>
            )}
            <img src={eFotos[eFotoAmpliada]} alt={`Foto ${eFotoAmpliada + 1}`} className="lightbox-img" />
            {eFotos.length > 1 && (
              <button
                className="lightbox-nav lightbox-next"
                onClick={() => setEFotoAmpliada((eFotoAmpliada + 1) % eFotos.length)}
              >›</button>
            )}
            <div className="lightbox-contador">{eFotoAmpliada + 1} / {eFotos.length}</div>
          </div>
        </div>
      )}

      {/* ── Lightbox de foto ── */}
      {fotoAmpliada !== null && totalFotos > 0 && (
        <div
          className="lightbox-overlay"
          onClick={() => setFotoAmpliada(null)}
        >
          <div className="lightbox-box" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-fechar" onClick={() => setFotoAmpliada(null)}>✕</button>
            {totalFotos > 1 && (
              <button
                className="lightbox-nav lightbox-prev"
                onClick={() => setFotoAmpliada((fotoAmpliada - 1 + totalFotos) % totalFotos)}
              >‹</button>
            )}
            <img
              src={o.fotos[fotoAmpliada]}
              alt={`Foto ${fotoAmpliada + 1}`}
              className="lightbox-img"
            />
            {totalFotos > 1 && (
              <button
                className="lightbox-nav lightbox-next"
                onClick={() => setFotoAmpliada((fotoAmpliada + 1) % totalFotos)}
              >›</button>
            )}
            <div className="lightbox-contador">{fotoAmpliada + 1} / {totalFotos}</div>
          </div>
        </div>
      )}

      {/* ── Lightbox das fotos de vistorias adicionais ── */}
      {vistoriaFotoAmpliada !== null && vistoriasSalvas[vistoriaFotoAmpliada.vIdx]?.fotos?.length > 0 && (() => {
        const v = vistoriasSalvas[vistoriaFotoAmpliada.vIdx]
        const total = v.fotos.length
        const cur = vistoriaFotoAmpliada.fIdx
        return (
          <div className="lightbox-overlay" onClick={() => setVistoriaFotoAmpliada(null)}>
            <div className="lightbox-box" onClick={(e) => e.stopPropagation()}>
              <button className="lightbox-fechar" onClick={() => setVistoriaFotoAmpliada(null)}>✕</button>
              {total > 1 && (
                <button
                  className="lightbox-nav lightbox-prev"
                  onClick={() => setVistoriaFotoAmpliada({ vIdx: vistoriaFotoAmpliada.vIdx, fIdx: (cur - 1 + total) % total })}
                >‹</button>
              )}
              <img src={v.fotos[cur]} alt={`Vistoria ${vistoriaFotoAmpliada.vIdx + 1}`} className="lightbox-img" />
              {total > 1 && (
                <button
                  className="lightbox-nav lightbox-next"
                  onClick={() => setVistoriaFotoAmpliada({ vIdx: vistoriaFotoAmpliada.vIdx, fIdx: (cur + 1) % total })}
                >›</button>
              )}
              <div className="lightbox-contador">Vistoria #{vistoriaFotoAmpliada.vIdx + 1} — {cur + 1} / {total}</div>
            </div>
          </div>
        )
      })()}

      {pedindoSenha && senhaAgenteLogado && (
        <ModalSenha
          titulo={pedindoSenha === 'editar' ? 'Editar Ocorrência' : 'Excluir Ocorrência'}
          senhaCorreta={senhaAgenteLogado}
          onCancelar={() => setPedindoSenha(null)}
          onConfirmar={() => {
            setPedindoSenha(null)
            if (pedindoSenha === 'editar') iniciarEdicao()
            else confirmarDelete()
          }}
        />
      )}
    </>
  )
}

function InfoRow({ icone, label, valor, destaque }: { icone: string; label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`info-row${destaque ? ' info-row-destaque' : ''}`}>
      <span className="info-icone">{icone}</span>
      <div>
        <div className="info-label">{label}</div>
        <div className={`info-valor${destaque ? ' info-valor-destaque' : ''}`}>{valor}</div>
      </div>
    </div>
  )
}
