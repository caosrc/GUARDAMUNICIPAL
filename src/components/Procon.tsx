import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './Procon.css'
import { converterParaWebp } from '../utils'

export type ProconEtapa = 'formulario' | 'revisao' | 'sucesso'
export type ProconSimNao = 'sim' | 'nao' | 'nao_informado'
export type ProconTipoDocumento = 'relatorio_visita' | 'termo_constatacao' | 'auto_infracao' | 'auto_apreensao'

export interface ProconFoto {
  id: string
  nome: string
  dataUrl: string
  capturadaEm: string
  latitude: number | null
  longitude: number | null
  descricao: string
}

export interface ProconDocumento {
  id: string
  nome: string
  tamanho: number
  tipo: string
  dataUrl?: string
}

export interface ProconIrregularidade {
  id: string
  categoria: string
  descricao: string
  produto: string
  marca: string
  preco: string
  quantidade: string
  lote: string
  observacao: string
}

export interface ProconDados {
  identificacao: {
    numero: string
    data: string
    horaInicio: string
    horaTermino: string
    agente: string
    tipoVisita: string
    tipoDocumento: ProconTipoDocumento
    numeroProcesso: string
  }
  estabelecimento: {
    razaoSocial: string
    nomeFantasia: string
    cnpj: string
    inscricaoEstadual: string
    telefone: string
    email: string
    responsavel: string
    cargo: string
  }
  endereco: {
    cep: string
    logradouro: string
    numero: string
    complemento: string
    bairro: string
    municipio: string
    uf: string
  }
  localizacao: {
    latitude: number | null
    longitude: number | null
    precisao: number | null
    capturadaEm: string
  }
  motivos: string[]
  motivoOutro: string
  descricaoMotivo: string
  constatacoes: {
    estabelecimentoFuncionando: ProconSimNao
    responsavelPresente: ProconSimNao
    responsavelEncontrado: string
    cargoResponsavel: string
    itensVerificados: string[]
  }
  irregularidades: ProconIrregularidade[]
  fotos: ProconFoto[]
  documentos: ProconDocumento[]
  manifestacao: {
    responsavelInformado: ProconSimNao
    texto: string
    observacoesAgente: string
  }
  resultado: {
    itens: string[]
    prazoDias: string
    dataLimite: string
    novaVisita: ProconSimNao
  }
  assinaturas: {
    responsavelNome: string
    responsavelRecusou: boolean
    agenteNome: string
  }
}

export interface ProconRegistro extends ProconDados {
  id: string | number
  status?: 'rascunho' | 'finalizado' | 'pendente' | 'enviado'
}

export interface ProconProps {
  relatorios?: ProconRegistro[]
  carregandoLista?: boolean
  erroLista?: string | null
  agenteNome?: string
  onSalvar?: (dados: ProconDados) => void | Promise<ProconRegistro | void>
  onEnviar?: (id: string | number) => void | Promise<void>
  onAtualizarLista?: () => void | Promise<void>
  onVoltar?: () => void
}

type GpsStatus = 'inativo' | 'aguardando' | 'capturado' | 'negado' | 'erro' | 'indisponivel'

const MOTIVOS = [
  ['rotina', 'Fiscalização de rotina'],
  ['denuncia', 'Denúncia'],
  ['reclamacao', 'Reclamação de consumidor'],
  ['operacao', 'Operação do PROCON'],
  ['precos', 'Verificação de preços'],
  ['publicidade', 'Verificação de publicidade'],
  ['vencidos', 'Produtos vencidos'],
  ['documentacao', 'Documentação'],
  ['retorno', 'Retorno de fiscalização anterior'],
]

const ITENS_VERIFICADOS = [
  'Preços dos produtos',
  'Prazo de validade',
  'Informação ao consumidor',
  'Publicidade',
  'Forma de pagamento',
  'Produtos expostos',
  'Cartazes e comunicação visual',
  'Nota fiscal',
  'Documentação',
  'Código de Defesa do Consumidor',
  'Outros',
]

const RESULTADOS = [
  'Sem irregularidades constatadas',
  'Irregularidade constatada',
  'Orientação realizada',
  'Estabelecimento notificado',
  'Prazo para regularização',
  'Auto de infração',
  'Apreensão',
  'Retorno necessário',
  'Encaminhamento para outro setor',
]

const CATEGORIAS = ['Preço', 'Validade', 'Informação ao consumidor', 'Publicidade', 'Documentação', 'Outro']
const TIPOS_DOCUMENTO: Array<{ id: ProconTipoDocumento; nome: string; descricao: string }> = [
  { id: 'termo_constatacao', nome: 'Termo de constatação', descricao: 'Registra fatos e irregularidades' },
  { id: 'auto_infracao', nome: 'Auto de infração', descricao: 'Formaliza a infração encontrada' },
  { id: 'auto_apreensao', nome: 'Auto de apreensão', descricao: 'Registra produtos ou bens apreendidos' },
  { id: 'relatorio_visita', nome: 'Relatório de visita', descricao: 'Documenta uma fiscalização completa' },
]

function agoraLocal() {
  const data = new Date()
  const dois = (valor: number) => String(valor).padStart(2, '0')
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}T${dois(data.getHours())}:${dois(data.getMinutes())}`
}

function hoje() {
  return agoraLocal().slice(0, 10)
}

function gerarNumero() {
  return `2026-${String(Math.floor(100000 + Math.random() * 899999))}`
}

function novaIrregularidade(): ProconIrregularidade {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    categoria: '',
    descricao: '',
    produto: '',
    marca: '',
    preco: '',
    quantidade: '',
    lote: '',
    observacao: '',
  }
}

function novosDados(agente: string): ProconDados {
  const inicio = agoraLocal()
  return {
    identificacao: { numero: gerarNumero(), data: hoje(), horaInicio: inicio, horaTermino: '', agente, tipoVisita: '', tipoDocumento: 'termo_constatacao', numeroProcesso: '' },
    estabelecimento: { razaoSocial: '', nomeFantasia: '', cnpj: '', inscricaoEstadual: '', telefone: '', email: '', responsavel: '', cargo: '' },
    endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '' },
    localizacao: { latitude: null, longitude: null, precisao: null, capturadaEm: '' },
    motivos: [],
    motivoOutro: '',
    descricaoMotivo: '',
    constatacoes: { estabelecimentoFuncionando: 'nao_informado', responsavelPresente: 'nao_informado', responsavelEncontrado: '', cargoResponsavel: '', itensVerificados: [] },
    irregularidades: [],
    fotos: [],
    documentos: [],
    manifestacao: { responsavelInformado: 'nao_informado', texto: '', observacoesAgente: '' },
    resultado: { itens: [], prazoDias: '', dataLimite: '', novaVisita: 'nao_informado' },
    assinaturas: { responsavelNome: '', responsavelRecusou: false, agenteNome: agente },
  }
}

function formatarData(valor: string) {
  if (!valor) return 'Não informado'
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return valor
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatarCoordenada(valor: number | null) {
  return typeof valor === 'number' ? valor.toFixed(6) : 'Não capturada'
}

function tamanhoArquivo(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function rotuloStatus(status?: ProconRegistro['status']) {
  if (status === 'finalizado') return 'Finalizado'
  if (status === 'pendente') return 'Aguardando envio'
  if (status === 'enviado') return 'Enviado ao órgão'
  return 'Rascunho'
}

function nomeTipoDocumento(tipo?: ProconTipoDocumento) {
  return TIPOS_DOCUMENTO.find((item) => item.id === tipo)?.nome || 'Documento de fiscalização'
}

export default function Procon({
  relatorios = [],
  carregandoLista = false,
  erroLista = null,
  agenteNome = 'Agente não identificado',
  onSalvar,
  onEnviar,
  onAtualizarLista,
  onVoltar,
}: ProconProps) {
  const [dados, setDados] = useState<ProconDados>(() => novosDados(agenteNome))
  const [etapa, setEtapa] = useState<ProconEtapa>('formulario')
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('inativo')
  const [gpsMensagem, setGpsMensagem] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState('')
  const [secaoAberta, setSecaoAberta] = useState('identificacao')
  const [fotoEmFoco, setFotoEmFoco] = useState<ProconFoto | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [registroSalvoId, setRegistroSalvoId] = useState<string | number | null>(null)
  const [envioStatus, setEnvioStatus] = useState<'pendente' | 'enviado'>('pendente')
  const [enviando, setEnviando] = useState(false)
  const fotoInputRef = useRef<HTMLInputElement>(null)
  const documentoInputRef = useRef<HTMLInputElement>(null)

  const totalPreenchido = useMemo(() => {
    const pontos = [
      Boolean(dados.estabelecimento.razaoSocial || dados.estabelecimento.nomeFantasia),
      Boolean(dados.endereco.logradouro && dados.endereco.municipio),
      dados.motivos.length > 0,
      dados.constatacoes.itensVerificados.length > 0,
      dados.irregularidades.length > 0 || dados.resultado.itens.length > 0,
      dados.fotos.length > 0 || dados.documentos.length > 0,
      Boolean(dados.manifestacao.texto),
    ]
    return pontos.filter(Boolean).length
  }, [dados])

  function atualizarGrupo<T extends keyof ProconDados>(grupo: T, campo: keyof ProconDados[T], valor: string | boolean | number | null) {
    setDados((anterior) => ({ ...anterior, [grupo]: { ...(anterior[grupo] as object), [campo]: valor } }))
    setErroSalvar('')
  }

  function atualizarCampo(campo: keyof ProconDados, valor: string) {
    setDados((anterior) => ({ ...anterior, [campo]: valor }))
    setErroSalvar('')
  }

  function alternarLista(campo: 'motivos' | 'itensVerificados' | 'itens', valor: string) {
    setDados((anterior) => {
      const lista = campo === 'motivos' ? anterior.motivos : campo === 'itensVerificados' ? anterior.constatacoes.itensVerificados : anterior.resultado.itens
      const novaLista = lista.includes(valor) ? lista.filter((item) => item !== valor) : [...lista, valor]
      if (campo === 'motivos') return { ...anterior, motivos: novaLista }
      if (campo === 'itensVerificados') return { ...anterior, constatacoes: { ...anterior.constatacoes, itensVerificados: novaLista } }
      return { ...anterior, resultado: { ...anterior.resultado, itens: novaLista } }
    })
  }

  function capturarGps() {
    if (!navigator.geolocation) {
      setGpsStatus('indisponivel')
      setGpsMensagem('Este aparelho não oferece localização pelo navegador.')
      return
    }
    setGpsStatus('aguardando')
    setGpsMensagem('')
    navigator.geolocation.getCurrentPosition(
      (posicao) => {
        const capturadaEm = agoraLocal()
        setDados((anterior) => ({
          ...anterior,
          localizacao: {
            latitude: posicao.coords.latitude,
            longitude: posicao.coords.longitude,
            precisao: posicao.coords.accuracy,
            capturadaEm,
          },
        }))
        setGpsStatus('capturado')
      },
      (erro) => {
        if (erro.code === erro.PERMISSION_DENIED) {
          setGpsStatus('negado')
          setGpsMensagem('Permissão de localização negada. Revise as configurações do navegador.')
        } else {
          setGpsStatus('erro')
          setGpsMensagem('Não foi possível obter uma posição. Tente novamente em uma área aberta.')
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  }

  function adicionarFotos(evento: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(evento.target.files ?? []).slice(0, 8 - dados.fotos.length)
    if (!arquivos.length) return
    Promise.all(arquivos.map((arquivo) => new Promise<ProconFoto>((resolve, reject) => {
      const leitor = new FileReader()
      leitor.onload = async () => {
        const dataUrl = await converterParaWebp(String(leitor.result), 1600, 1600, 0.82)
        resolve({
          id: `${Date.now()}-${arquivo.name}-${Math.random().toString(16).slice(2)}`,
          nome: arquivo.name.replace(/\.[^.]+$/, '.webp'),
          dataUrl,
          capturadaEm: agoraLocal(),
          latitude: dados.localizacao.latitude,
          longitude: dados.localizacao.longitude,
          descricao: '',
        })
      }
      leitor.onerror = () => reject(new Error('Falha ao ler foto'))
      leitor.readAsDataURL(arquivo)
    }))).then((novasFotos) => {
      setDados((anterior) => ({ ...anterior, fotos: [...anterior.fotos, ...novasFotos] }))
    }).catch(() => setErroSalvar('Uma das fotos não pôde ser adicionada. Tente novamente.'))
    evento.target.value = ''
  }

  function adicionarDocumentos(evento: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(evento.target.files ?? []).slice(0, 6 - dados.documentos.length)
    if (!arquivos.length) return
    const novosDocumentos = arquivos.map((arquivo) => ({
      id: `${Date.now()}-${arquivo.name}-${Math.random().toString(16).slice(2)}`,
      nome: arquivo.name,
      tamanho: arquivo.size,
      tipo: arquivo.type || 'application/octet-stream',
    }))
    setDados((anterior) => ({ ...anterior, documentos: [...anterior.documentos, ...novosDocumentos] }))
    evento.target.value = ''
  }

  function atualizarFoto(id: string, descricao: string) {
    setDados((anterior) => ({ ...anterior, fotos: anterior.fotos.map((foto) => foto.id === id ? { ...foto, descricao } : foto) }))
  }

  function removerFoto(id: string) {
    setDados((anterior) => ({ ...anterior, fotos: anterior.fotos.filter((foto) => foto.id !== id) }))
    setFotoEmFoco(null)
  }

  function removerDocumento(id: string) {
    setDados((anterior) => ({ ...anterior, documentos: anterior.documentos.filter((documento) => documento.id !== id) }))
  }

  function revisar(evento: FormEvent) {
    evento.preventDefault()
    const novosAvisos: string[] = []
    if (!dados.estabelecimento.razaoSocial && !dados.estabelecimento.nomeFantasia) novosAvisos.push('Informe a razão social ou o nome fantasia do estabelecimento.')
    if (!dados.identificacao.tipoVisita) novosAvisos.push('Selecione o tipo de visita.')
    if (!dados.motivos.length && !dados.descricaoMotivo.trim()) novosAvisos.push('Informe pelo menos um motivo para a visita.')
    if (novosAvisos.length) {
      setAvisos(novosAvisos)
      setSecaoAberta(novosAvisos[0].includes('estabelecimento') ? 'estabelecimento' : novosAvisos[0].includes('tipo') ? 'identificacao' : 'motivo')
      return
    }
    setAvisos([])
    setErroSalvar('')
    setEtapa('revisao')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function salvar() {
    setSalvando(true)
    setErroSalvar('')
    try {
      const registro = onSalvar ? await onSalvar(dados) : undefined
      if (registro?.id !== undefined) setRegistroSalvoId(registro.id)
      setEnvioStatus('pendente')
      setEtapa('sucesso')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setErroSalvar('Não foi possível finalizar o relatório. Verifique a conexão e tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  async function enviarAoOrgao() {
    if (registroSalvoId === null || !onEnviar) {
      setErroSalvar('O relatório ainda não possui um protocolo de sincronização.')
      return
    }
    setEnviando(true)
    setErroSalvar('')
    try {
      await onEnviar(registroSalvoId)
      setEnvioStatus('enviado')
      await onAtualizarLista?.()
    } catch {
      setErroSalvar('Não foi possível enviar ao sistema do órgão. O relatório continua na fila de pendências.')
    } finally {
      setEnviando(false)
    }
  }

  function iniciarNovo() {
    setDados(novosDados(agenteNome))
    setRegistroSalvoId(null)
    setEnvioStatus('pendente')
    setGpsStatus('inativo')
    setGpsMensagem('')
    setAvisos([])
    setErroSalvar('')
    setSecaoAberta('identificacao')
    setEtapa('formulario')
  }

  function abrirSecao(id: string) {
    setSecaoAberta((atual) => atual === id ? '' : id)
  }

  function consultarRelatorio(relatorio: ProconRegistro) {
    const padrao = novosDados(agenteNome)
    setDados({
      ...padrao,
      ...relatorio,
      identificacao: { ...padrao.identificacao, ...relatorio.identificacao },
    })
    setRegistroSalvoId(relatorio.id)
    setEnvioStatus(relatorio.status === 'enviado' ? 'enviado' : 'pendente')
    setEtapa('revisao')
    setErroSalvar('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function enviarRelatorioExistente(relatorio: ProconRegistro) {
    consultarRelatorio(relatorio)
    if (!onEnviar) return
    setEnviando(true)
    setErroSalvar('')
    try {
      await onEnviar(relatorio.id)
      setEnvioStatus('enviado')
      await onAtualizarLista?.()
      setEtapa('sucesso')
    } catch {
      setErroSalvar('Não foi possível enviar ao sistema do órgão. O documento continua na fila de pendências.')
      setEtapa('sucesso')
    } finally {
      setEnviando(false)
    }
  }

  const gpsCapturado = dados.localizacao.latitude !== null && dados.localizacao.longitude !== null
  const textoGps = gpsStatus === 'aguardando'
    ? 'Buscando a posição do aparelho'
    : gpsStatus === 'capturado' || gpsCapturado
      ? 'Coordenada registrada neste relatório'
      : gpsMensagem || 'A coordenada ainda não foi capturada'

  return (
    <main className="procon-shell" data-testid="page-procon">
      <header className="procon-header">
        <div className="procon-header-line">
          <button className="procon-back" type="button" onClick={onVoltar} data-testid="button-procon-voltar" aria-label="Voltar">Voltar</button>
          <div className="procon-brand" aria-label="PROCON">
            <span className="procon-brand-mark">P</span>
            <span>PROCON</span>
          </div>
          <span className="procon-header-agent">{dados.identificacao.agente}</span>
        </div>
        <div className="procon-header-copy">
          <span className="procon-eyebrow">Caderno de campo / fiscalização</span>
          <h1>{nomeTipoDocumento(dados.identificacao.tipoDocumento)}</h1>
          <p>Emita o documento de fiscalização no celular, revise os dados e envie ao sistema do órgão.</p>
        </div>
        <div className="procon-header-meta">
          <span>RELATÓRIO Nº</span>
          <strong>{dados.identificacao.numero}</strong>
        </div>
      </header>

      <div className="procon-content">
        {etapa === 'sucesso' ? (
          <section className="procon-success" data-testid="status-procon-sucesso">
            <div className="procon-success-seal">OK</div>
            <span className="procon-eyebrow">{envioStatus === 'enviado' ? 'Processo sincronizado' : 'Documento pronto'}</span>
            <h2>{envioStatus === 'enviado' ? 'Enviado ao sistema do órgão.' : 'Fiscalização registrada com sucesso.'}</h2>
            <p>{envioStatus === 'enviado' ? `O ${nomeTipoDocumento(dados.identificacao.tipoDocumento).toLowerCase()} ${dados.identificacao.numero} foi enviado e já pode ser consultado pela equipe.` : `O ${nomeTipoDocumento(dados.identificacao.tipoDocumento).toLowerCase()} ${dados.identificacao.numero} está na fila de envio. Você pode transmitir agora ou consultar depois.`}</p>
            <div className="procon-success-facts">
              <div><span>Estabelecimento</span><strong>{dados.estabelecimento.nomeFantasia || dados.estabelecimento.razaoSocial || 'Não informado'}</strong></div>
              <div><span>Irregularidades</span><strong>{dados.irregularidades.length}</strong></div>
              <div><span>Evidências</span><strong>{dados.fotos.length + dados.documentos.length}</strong></div>
            </div>
            <div className="procon-success-actions">
              <button className="procon-button procon-button-primary" type="button" onClick={iniciarNovo} data-testid="button-procon-novo">Nova visita</button>
              {envioStatus !== 'enviado' && <button className="procon-button procon-button-send" type="button" onClick={enviarAoOrgao} disabled={enviando} data-testid="button-procon-enviar-orgao">{enviando ? 'Enviando...' : 'Enviar ao sistema do órgão'}</button>}
              <button className="procon-button procon-button-secondary" type="button" onClick={onAtualizarLista} data-testid="button-procon-atualizar-sucesso">Atualizar histórico</button>
            </div>
            {erroSalvar && <div className="procon-alert procon-alert-error" role="alert" data-testid="status-procon-erro-envio">{erroSalvar}</div>}
          </section>
        ) : etapa === 'revisao' ? (
          <section className="procon-review" data-testid="section-procon-revisao">
            <div className="procon-review-intro">
              <span className="procon-eyebrow">Última conferência</span>
              <h2>Revise antes de finalizar.</h2>
              <p>Confira os dados essenciais. Você ainda pode voltar para editar qualquer seção.</p>
            </div>
            <div className="procon-review-grid">
              <article className="procon-review-card procon-review-card-wide">
                <div className="procon-review-card-title"><span>Visita e local</span><button type="button" onClick={() => { setEtapa('formulario'); setSecaoAberta('identificacao') }} data-testid="button-procon-editar-visita">Editar</button></div>
                <h3>{dados.estabelecimento.nomeFantasia || dados.estabelecimento.razaoSocial || 'Estabelecimento não informado'}</h3>
                <p>{dados.endereco.logradouro || 'Endereço não informado'}{dados.endereco.numero ? `, ${dados.endereco.numero}` : ''} · {dados.endereco.municipio || 'Município não informado'}</p>
                <dl className="procon-review-details">
                  <div><dt>Documento</dt><dd>{nomeTipoDocumento(dados.identificacao.tipoDocumento)}</dd></div>
                  <div><dt>Tipo de visita</dt><dd>{dados.identificacao.tipoVisita || 'Não informado'}</dd></div>
                  <div><dt>Processo</dt><dd>{dados.identificacao.numeroProcesso || 'Sem vínculo informado'}</dd></div>
                  <div><dt>Início</dt><dd>{formatarData(dados.identificacao.horaInicio)}</dd></div>
                  <div><dt>GPS</dt><dd>{formatarCoordenada(dados.localizacao.latitude)}, {formatarCoordenada(dados.localizacao.longitude)}{dados.localizacao.precisao ? ` · ±${Math.round(dados.localizacao.precisao)} m` : ''}</dd></div>
                </dl>
              </article>
              <article className="procon-review-card">
                <div className="procon-review-card-title"><span>Motivo</span><button type="button" onClick={() => { setEtapa('formulario'); setSecaoAberta('motivo') }} data-testid="button-procon-editar-motivo">Editar</button></div>
                <p className="procon-review-list">{dados.motivos.map((motivo) => MOTIVOS.find(([id]) => id === motivo)?.[1]).filter(Boolean).join(', ') || dados.descricaoMotivo || 'Não informado'}</p>
              </article>
              <article className="procon-review-card">
                <div className="procon-review-card-title"><span>Constatações</span><button type="button" onClick={() => { setEtapa('formulario'); setSecaoAberta('constatacoes') }} data-testid="button-procon-editar-constatacoes">Editar</button></div>
                <p className="procon-review-stat">{dados.irregularidades.length}<small> irregularidades</small></p>
                <p>{dados.constatacoes.itensVerificados.length} itens verificados</p>
              </article>
              <article className="procon-review-card procon-review-card-wide">
                <div className="procon-review-card-title"><span>Evidências e manifestação</span><button type="button" onClick={() => { setEtapa('formulario'); setSecaoAberta('evidencias') }} data-testid="button-procon-editar-evidencias">Editar</button></div>
                <div className="procon-evidence-summary"><strong>{dados.fotos.length} fotos</strong><strong>{dados.documentos.length} documentos</strong><span>{dados.manifestacao.texto ? 'Manifestação registrada' : 'Sem manifestação preenchida'}</span></div>
              </article>
              <article className="procon-review-card procon-review-card-wide">
                <div className="procon-review-card-title"><span>Resultado</span><button type="button" onClick={() => { setEtapa('formulario'); setSecaoAberta('resultado') }} data-testid="button-procon-editar-resultado">Editar</button></div>
                <p className="procon-review-list">{dados.resultado.itens.join(', ') || 'Resultado ainda não informado'}</p>
                {dados.resultado.dataLimite && <p className="procon-review-muted">Data limite: {dados.resultado.dataLimite}</p>}
              </article>
            </div>
            {erroSalvar && <div className="procon-alert procon-alert-error" role="alert" data-testid="status-procon-erro-revisao">{erroSalvar}</div>}
            <div className="procon-review-actions">
              <button className="procon-button procon-button-secondary" type="button" onClick={() => setEtapa('formulario')} data-testid="button-procon-voltar-edicao">Voltar e editar</button>
              <button className="procon-button procon-button-primary" type="button" onClick={salvar} disabled={salvando} data-testid="button-procon-finalizar">{salvando ? 'Finalizando relatório' : 'Finalizar relatório'}</button>
            </div>
          </section>
        ) : (
          <>
            <section className="procon-progress-panel" aria-label="Progresso do relatório">
              <div className="procon-progress-copy"><span className="procon-eyebrow">Em preenchimento</span><strong>{totalPreenchido} de 7 blocos essenciais</strong></div>
              <div className="procon-progress-track"><span style={{ width: `${Math.max(5, (totalPreenchido / 7) * 100)}%` }} /></div>
              <button type="button" className="procon-gps-quick" onClick={capturarGps} disabled={gpsStatus === 'aguardando'} data-testid="button-procon-gps-rapido"><span className={`procon-gps-dot ${gpsCapturado ? 'is-active' : ''}`} />{gpsCapturado ? 'GPS registrado' : 'Capturar GPS'}</button>
            </section>
            {avisos.length > 0 && <div className="procon-alert procon-alert-warning" role="alert" data-testid="status-procon-validacao"><strong>Antes de revisar:</strong>{avisos.map((aviso) => <span key={aviso}>{aviso}</span>)}</div>}

            <form className="procon-form" onSubmit={revisar} data-testid="form-procon">
              <section className={`procon-card procon-section-card section-${secaoAberta === 'identificacao' ? 'open' : 'closed'}`} data-testid="section-procon-identificacao">
                <button className="procon-section-toggle" type="button" onClick={() => abrirSecao('identificacao')} data-testid="button-procon-secao-identificacao" aria-expanded={secaoAberta === 'identificacao'}>
                  <span className="procon-section-index">01</span><span><strong>Identificação da visita</strong><small>Número, horário, agente e tipo de ação</small></span><b>{secaoAberta === 'identificacao' ? 'Fechar' : 'Abrir'}</b>
                </button>
                {secaoAberta === 'identificacao' && <div className="procon-section-body">
                  <div className="procon-report-id"><span>{nomeTipoDocumento(dados.identificacao.tipoDocumento)}</span><strong>{dados.identificacao.numero}</strong><small>Identificador gerado automaticamente</small></div>
                  <div className="procon-field-grid">
                    <label className="procon-field"><span>Data <b>*</b></span><input type="date" value={dados.identificacao.data} onChange={(e) => atualizarGrupo('identificacao', 'data', e.target.value)} data-testid="input-procon-data" /></label>
                    <label className="procon-field"><span>Agente responsável</span><input value={dados.identificacao.agente} onChange={(e) => { atualizarGrupo('identificacao', 'agente', e.target.value); atualizarGrupo('assinaturas', 'agenteNome', e.target.value) }} data-testid="input-procon-agente" /></label>
                    <label className="procon-field"><span>Hora de início</span><input type="datetime-local" value={dados.identificacao.horaInicio} onChange={(e) => atualizarGrupo('identificacao', 'horaInicio', e.target.value)} data-testid="input-procon-hora-inicio" /></label>
                    <label className="procon-field"><span>Hora de término</span><input type="datetime-local" value={dados.identificacao.horaTermino} onChange={(e) => atualizarGrupo('identificacao', 'horaTermino', e.target.value)} data-testid="input-procon-hora-termino" /></label>
                    <label className="procon-field procon-field-wide"><span>Número do processo ou fiscalização</span><input value={dados.identificacao.numeroProcesso} onChange={(e) => atualizarGrupo('identificacao', 'numeroProcesso', e.target.value)} placeholder="Opcional · vincula este documento ao processo do órgão" data-testid="input-procon-numero-processo" /></label>
                  </div>
                  <fieldset className="procon-fieldset"><legend>Documento a emitir <b>*</b></legend><div className="procon-documento-grid">{TIPOS_DOCUMENTO.map((tipo) => <label className={`procon-documento-option ${dados.identificacao.tipoDocumento === tipo.id ? 'selected' : ''}`} key={tipo.id}><input type="radio" name="tipo-documento" value={tipo.id} checked={dados.identificacao.tipoDocumento === tipo.id} onChange={() => atualizarGrupo('identificacao', 'tipoDocumento', tipo.id)} data-testid={`radio-procon-documento-${tipo.id}`} /><span><strong>{tipo.nome}</strong><small>{tipo.descricao}</small></span></label>)}</div></fieldset>
                  <fieldset className="procon-fieldset"><legend>Tipo de visita <b>*</b></legend><div className="procon-option-grid procon-option-grid-six">{['Rotina', 'Fiscalização', 'Denúncia', 'Operação especial', 'Retorno', 'Outro'].map((tipo) => <label className={`procon-option ${dados.identificacao.tipoVisita === tipo ? 'selected' : ''}`} key={tipo}><input type="radio" name="tipo-visita" value={tipo} checked={dados.identificacao.tipoVisita === tipo} onChange={(e) => atualizarGrupo('identificacao', 'tipoVisita', e.target.value)} data-testid={`radio-procon-tipo-${tipo.toLowerCase().replaceAll(' ', '-')}`} /><span>{tipo}</span></label>)}</div></fieldset>
                </div>}
              </section>

              <section className={`procon-card procon-section-card section-${secaoAberta === 'estabelecimento' ? 'open' : 'closed'}`} data-testid="section-procon-estabelecimento">
                <button className="procon-section-toggle" type="button" onClick={() => abrirSecao('estabelecimento')} data-testid="button-procon-secao-estabelecimento" aria-expanded={secaoAberta === 'estabelecimento'}>
                  <span className="procon-section-index">02</span><span><strong>Estabelecimento</strong><small>Identifique quem e onde foi visitado</small></span><b>{secaoAberta === 'estabelecimento' ? 'Fechar' : 'Abrir'}</b>
                </button>
                {secaoAberta === 'estabelecimento' && <div className="procon-section-body">
                  <div className="procon-field-grid">
                    <label className="procon-field procon-field-wide"><span>Razão social</span><input value={dados.estabelecimento.razaoSocial} onChange={(e) => atualizarGrupo('estabelecimento', 'razaoSocial', e.target.value)} placeholder="Nome registrado da empresa" data-testid="input-procon-razao-social" /></label>
                    <label className="procon-field"><span>Nome fantasia</span><input value={dados.estabelecimento.nomeFantasia} onChange={(e) => atualizarGrupo('estabelecimento', 'nomeFantasia', e.target.value)} placeholder="Nome comercial" data-testid="input-procon-nome-fantasia" /></label>
                    <label className="procon-field"><span>CNPJ</span><input inputMode="numeric" value={dados.estabelecimento.cnpj} onChange={(e) => atualizarGrupo('estabelecimento', 'cnpj', e.target.value)} placeholder="00.000.000/0000-00" data-testid="input-procon-cnpj" /></label>
                    <label className="procon-field"><span>Inscrição estadual</span><input value={dados.estabelecimento.inscricaoEstadual} onChange={(e) => atualizarGrupo('estabelecimento', 'inscricaoEstadual', e.target.value)} data-testid="input-procon-inscricao" /></label>
                    <label className="procon-field"><span>Telefone</span><input inputMode="tel" value={dados.estabelecimento.telefone} onChange={(e) => atualizarGrupo('estabelecimento', 'telefone', e.target.value)} data-testid="input-procon-telefone" /></label>
                    <label className="procon-field"><span>E-mail</span><input type="email" value={dados.estabelecimento.email} onChange={(e) => atualizarGrupo('estabelecimento', 'email', e.target.value)} data-testid="input-procon-email" /></label>
                    <label className="procon-field"><span>Responsável pelo estabelecimento</span><input value={dados.estabelecimento.responsavel} onChange={(e) => atualizarGrupo('estabelecimento', 'responsavel', e.target.value)} data-testid="input-procon-responsavel" /></label>
                    <label className="procon-field"><span>Cargo</span><input value={dados.estabelecimento.cargo} onChange={(e) => atualizarGrupo('estabelecimento', 'cargo', e.target.value)} data-testid="input-procon-cargo" /></label>
                  </div>
                </div>}
              </section>

              <section className={`procon-card procon-section-card section-${secaoAberta === 'endereco' ? 'open' : 'closed'}`} data-testid="section-procon-endereco">
                <button className="procon-section-toggle" type="button" onClick={() => abrirSecao('endereco')} data-testid="button-procon-secao-endereco" aria-expanded={secaoAberta === 'endereco'}>
                  <span className="procon-section-index">03</span><span><strong>Endereço e GPS</strong><small>Onde a visita aconteceu</small></span><b>{secaoAberta === 'endereco' ? 'Fechar' : 'Abrir'}</b>
                </button>
                {secaoAberta === 'endereco' && <div className="procon-section-body">
                  <div className="procon-field-grid">
                    <label className="procon-field"><span>CEP</span><input inputMode="numeric" value={dados.endereco.cep} onChange={(e) => atualizarGrupo('endereco', 'cep', e.target.value)} placeholder="00000-000" data-testid="input-procon-cep" /></label>
                    <label className="procon-field procon-field-wide"><span>Logradouro</span><input value={dados.endereco.logradouro} onChange={(e) => atualizarGrupo('endereco', 'logradouro', e.target.value)} placeholder="Rua, avenida ou estrada" data-testid="input-procon-logradouro" /></label>
                    <label className="procon-field"><span>Número</span><input value={dados.endereco.numero} onChange={(e) => atualizarGrupo('endereco', 'numero', e.target.value)} data-testid="input-procon-numero" /></label>
                    <label className="procon-field"><span>Complemento</span><input value={dados.endereco.complemento} onChange={(e) => atualizarGrupo('endereco', 'complemento', e.target.value)} placeholder="Loja, sala" data-testid="input-procon-complemento" /></label>
                    <label className="procon-field"><span>Bairro</span><input value={dados.endereco.bairro} onChange={(e) => atualizarGrupo('endereco', 'bairro', e.target.value)} data-testid="input-procon-bairro" /></label>
                    <label className="procon-field"><span>Município</span><input value={dados.endereco.municipio} onChange={(e) => atualizarGrupo('endereco', 'municipio', e.target.value)} data-testid="input-procon-municipio" /></label>
                    <label className="procon-field procon-field-small"><span>UF</span><input maxLength={2} value={dados.endereco.uf} onChange={(e) => atualizarGrupo('endereco', 'uf', e.target.value.toUpperCase())} data-testid="input-procon-uf" /></label>
                  </div>
                  <div className={`procon-gps-card ${gpsCapturado ? 'captured' : ''} ${gpsStatus === 'negado' || gpsStatus === 'erro' || gpsStatus === 'indisponivel' ? 'warning' : ''}`} data-testid="status-procon-gps">
                    <div className="procon-gps-symbol"><span>GPS</span></div>
                    <div className="procon-gps-copy"><strong>{gpsCapturado ? 'Localização capturada' : 'Localização da visita'}</strong><span>{textoGps}</span>{gpsCapturado && <small>{formatarCoordenada(dados.localizacao.latitude)} · {formatarCoordenada(dados.localizacao.longitude)} · precisão {Math.round(dados.localizacao.precisao || 0)} m</small>}</div>
                    <button className="procon-gps-button" type="button" onClick={capturarGps} disabled={gpsStatus === 'aguardando'} data-testid="button-procon-gps">{gpsStatus === 'aguardando' ? 'Buscando' : gpsCapturado ? 'Atualizar' : 'Capturar'}</button>
                  </div>
                  <p className="procon-helper">A posição é registrada no momento da captura e vinculada ao relatório, sem rastreamento contínuo.</p>
                </div>}
              </section>

              <section className={`procon-card procon-section-card section-${secaoAberta === 'motivo' ? 'open' : 'closed'}`} data-testid="section-procon-motivo">
                <button className="procon-section-toggle" type="button" onClick={() => abrirSecao('motivo')} data-testid="button-procon-secao-motivo" aria-expanded={secaoAberta === 'motivo'}>
                  <span className="procon-section-index">04</span><span><strong>Motivo da visita</strong><small>Por que esta ação foi realizada</small></span><b>{secaoAberta === 'motivo' ? 'Fechar' : 'Abrir'}</b>
                </button>
                {secaoAberta === 'motivo' && <div className="procon-section-body"><fieldset className="procon-fieldset"><legend>Selecione todos que se aplicam</legend><div className="procon-check-grid">{MOTIVOS.map(([id, label]) => <label className={`procon-check ${dados.motivos.includes(id) ? 'selected' : ''}`} key={id}><input type="checkbox" checked={dados.motivos.includes(id)} onChange={() => alternarLista('motivos', id)} data-testid={`checkbox-procon-motivo-${id}`} /><span>{label}</span></label>)}</div></fieldset><label className="procon-field procon-field-wide"><span>Outro motivo</span><input value={dados.motivoOutro} onChange={(e) => atualizarCampo('motivoOutro', e.target.value)} placeholder="Descreva se não encontrou a opção" data-testid="input-procon-motivo-outro" /></label><label className="procon-field procon-field-wide"><span>Descrição do motivo</span><textarea rows={3} value={dados.descricaoMotivo} onChange={(e) => atualizarCampo('descricaoMotivo', e.target.value)} placeholder="Contextualize a ordem, denúncia ou situação que originou a visita." data-testid="textarea-procon-descricao-motivo" /></label></div>}
              </section>

              <section className={`procon-card procon-section-card section-${secaoAberta === 'constatacoes' ? 'open' : 'closed'}`} data-testid="section-procon-constatacoes">
                <button className="procon-section-toggle" type="button" onClick={() => abrirSecao('constatacoes')} data-testid="button-procon-secao-constatacoes" aria-expanded={secaoAberta === 'constatacoes'}>
                  <span className="procon-section-index">05</span><span><strong>Constatações</strong><small>Situação encontrada e itens verificados</small></span><b>{secaoAberta === 'constatacoes' ? 'Fechar' : 'Abrir'}</b>
                </button>
                {secaoAberta === 'constatacoes' && <div className="procon-section-body">
                  <div className="procon-question-grid">
                    <fieldset className="procon-fieldset"><legend>Estabelecimento em funcionamento?</legend><div className="procon-segmented">{(['sim', 'nao'] as ProconSimNao[]).map((valor) => <label className={dados.constatacoes.estabelecimentoFuncionando === valor ? 'selected' : ''} key={valor}><input type="radio" name="funcionando" value={valor} checked={dados.constatacoes.estabelecimentoFuncionando === valor} onChange={(e) => atualizarGrupo('constatacoes', 'estabelecimentoFuncionando', e.target.value)} data-testid={`radio-procon-funcionamento-${valor}`} /><span>{valor === 'sim' ? 'Sim' : 'Não'}</span></label>)}</div></fieldset>
                    <fieldset className="procon-fieldset"><legend>Responsável presente?</legend><div className="procon-segmented">{(['sim', 'nao'] as ProconSimNao[]).map((valor) => <label className={dados.constatacoes.responsavelPresente === valor ? 'selected' : ''} key={valor}><input type="radio" name="responsavel-presente" value={valor} checked={dados.constatacoes.responsavelPresente === valor} onChange={(e) => atualizarGrupo('constatacoes', 'responsavelPresente', e.target.value)} data-testid={`radio-procon-responsavel-${valor}`} /><span>{valor === 'sim' ? 'Sim' : 'Não'}</span></label>)}</div></fieldset>
                  </div>
                  <div className="procon-field-grid"><label className="procon-field"><span>Nome do responsável encontrado</span><input value={dados.constatacoes.responsavelEncontrado} onChange={(e) => atualizarGrupo('constatacoes', 'responsavelEncontrado', e.target.value)} data-testid="input-procon-responsavel-encontrado" /></label><label className="procon-field"><span>Cargo</span><input value={dados.constatacoes.cargoResponsavel} onChange={(e) => atualizarGrupo('constatacoes', 'cargoResponsavel', e.target.value)} data-testid="input-procon-cargo-encontrado" /></label></div>
                  <fieldset className="procon-fieldset"><legend>Itens verificados</legend><div className="procon-check-grid">{ITENS_VERIFICADOS.map((item) => <label className={`procon-check ${dados.constatacoes.itensVerificados.includes(item) ? 'selected' : ''}`} key={item}><input type="checkbox" checked={dados.constatacoes.itensVerificados.includes(item)} onChange={() => alternarLista('itensVerificados', item)} data-testid={`checkbox-procon-item-${item.toLowerCase().replaceAll(' ', '-')}`} /><span>{item}</span></label>)}</div></fieldset>
                </div>}
              </section>

              <section className={`procon-card procon-section-card section-${secaoAberta === 'irregularidades' ? 'open' : 'closed'}`} data-testid="section-procon-irregularidades">
                <button className="procon-section-toggle" type="button" onClick={() => abrirSecao('irregularidades')} data-testid="button-procon-secao-irregularidades" aria-expanded={secaoAberta === 'irregularidades'}>
                  <span className="procon-section-index">06</span><span><strong>Irregularidades</strong><small>Adicione uma ocorrência por vez</small></span><b>{secaoAberta === 'irregularidades' ? 'Fechar' : 'Abrir'}</b>
                </button>
                {secaoAberta === 'irregularidades' && <div className="procon-section-body">
                  <div className="procon-section-note"><strong>{dados.irregularidades.length ? `${dados.irregularidades.length} ocorrência${dados.irregularidades.length > 1 ? 's' : ''} registrada${dados.irregularidades.length > 1 ? 's' : ''}` : 'Nenhuma ocorrência registrada'}</strong><span>As irregularidades podem ser adicionadas, revisadas e removidas individualmente.</span></div>
                  <div className="procon-irregularity-list">{dados.irregularidades.map((item, indice) => <article className="procon-irregularity" key={item.id} data-testid={`card-procon-irregularidade-${item.id}`}><div className="procon-irregularity-head"><span>Ocorrência {String(indice + 1).padStart(2, '0')}</span><button type="button" onClick={() => setDados((anterior) => ({ ...anterior, irregularidades: anterior.irregularidades.filter((ocorrencia) => ocorrencia.id !== item.id) }))} data-testid={`button-procon-remover-irregularidade-${item.id}`}>Remover</button></div><div className="procon-field-grid"><label className="procon-field"><span>Categoria</span><select value={item.categoria} onChange={(e) => setDados((anterior) => ({ ...anterior, irregularidades: anterior.irregularidades.map((ocorrencia) => ocorrencia.id === item.id ? { ...ocorrencia, categoria: e.target.value } : ocorrencia) }))} data-testid={`select-procon-categoria-${item.id}`}><option value="">Selecionar</option>{CATEGORIAS.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}</select></label><label className="procon-field"><span>Produto</span><input value={item.produto} onChange={(e) => setDados((anterior) => ({ ...anterior, irregularidades: anterior.irregularidades.map((ocorrencia) => ocorrencia.id === item.id ? { ...ocorrencia, produto: e.target.value } : ocorrencia) }))} data-testid={`input-procon-produto-${item.id}`} /></label><label className="procon-field"><span>Marca</span><input value={item.marca} onChange={(e) => setDados((anterior) => ({ ...anterior, irregularidades: anterior.irregularidades.map((ocorrencia) => ocorrencia.id === item.id ? { ...ocorrencia, marca: e.target.value } : ocorrencia) }))} data-testid={`input-procon-marca-${item.id}`} /></label><label className="procon-field"><span>Preço encontrado</span><input inputMode="decimal" value={item.preco} onChange={(e) => setDados((anterior) => ({ ...anterior, irregularidades: anterior.irregularidades.map((ocorrencia) => ocorrencia.id === item.id ? { ...ocorrencia, preco: e.target.value } : ocorrencia) }))} placeholder="R$ 0,00" data-testid={`input-procon-preco-${item.id}`} /></label><label className="procon-field"><span>Quantidade</span><input value={item.quantidade} onChange={(e) => setDados((anterior) => ({ ...anterior, irregularidades: anterior.irregularidades.map((ocorrencia) => ocorrencia.id === item.id ? { ...ocorrencia, quantidade: e.target.value } : ocorrencia) }))} data-testid={`input-procon-quantidade-${item.id}`} /></label><label className="procon-field"><span>Lote</span><input value={item.lote} onChange={(e) => setDados((anterior) => ({ ...anterior, irregularidades: anterior.irregularidades.map((ocorrencia) => ocorrencia.id === item.id ? { ...ocorrencia, lote: e.target.value } : ocorrencia) }))} data-testid={`input-procon-lote-${item.id}`} /></label><label className="procon-field procon-field-wide"><span>Descrição da irregularidade</span><textarea rows={2} value={item.descricao} onChange={(e) => setDados((anterior) => ({ ...anterior, irregularidades: anterior.irregularidades.map((ocorrencia) => ocorrencia.id === item.id ? { ...ocorrencia, descricao: e.target.value } : ocorrencia) }))} data-testid={`textarea-procon-descricao-${item.id}`} /></label><label className="procon-field procon-field-wide"><span>Observação</span><textarea rows={2} value={item.observacao} onChange={(e) => setDados((anterior) => ({ ...anterior, irregularidades: anterior.irregularidades.map((ocorrencia) => ocorrencia.id === item.id ? { ...ocorrencia, observacao: e.target.value } : ocorrencia) }))} data-testid={`textarea-procon-observacao-${item.id}`} /></label></div></article>)}</div>
                  <button className="procon-add-button" type="button" onClick={() => setDados((anterior) => ({ ...anterior, irregularidades: [...anterior.irregularidades, novaIrregularidade()] }))} data-testid="button-procon-adicionar-irregularidade"><span>+</span> Adicionar irregularidade</button>
                </div>}
              </section>

              <section className={`procon-card procon-section-card section-${secaoAberta === 'evidencias' ? 'open' : 'closed'}`} data-testid="section-procon-evidencias">
                <button className="procon-section-toggle" type="button" onClick={() => abrirSecao('evidencias')} data-testid="button-procon-secao-evidencias" aria-expanded={secaoAberta === 'evidencias'}>
                  <span className="procon-section-index">07</span><span><strong>Evidências</strong><small>Fotos e documentos da visita</small></span><b>{secaoAberta === 'evidencias' ? 'Fechar' : 'Abrir'}</b>
                </button>
                {secaoAberta === 'evidencias' && <div className="procon-section-body">
                  <input ref={fotoInputRef} className="procon-file-input" type="file" accept="image/*" capture="environment" multiple onChange={adicionarFotos} data-testid="input-procon-fotos" />
                  <input ref={documentoInputRef} className="procon-file-input" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" multiple onChange={adicionarDocumentos} data-testid="input-procon-documentos" />
                  <div className="procon-upload-actions"><button className="procon-upload-card" type="button" onClick={() => fotoInputRef.current?.click()} disabled={dados.fotos.length >= 8} data-testid="button-procon-adicionar-foto"><span className="procon-upload-label">FOTO</span><strong>{dados.fotos.length ? 'Adicionar fotos' : 'Abrir câmera'}</strong><small>{dados.fotos.length}/8 anexadas</small></button><button className="procon-upload-card is-document" type="button" onClick={() => documentoInputRef.current?.click()} disabled={dados.documentos.length >= 6} data-testid="button-procon-adicionar-documento"><span className="procon-upload-label">DOC</span><strong>Adicionar documento</strong><small>{dados.documentos.length}/6 anexados</small></button></div>
                  {dados.fotos.length > 0 && <div className="procon-evidence-block"><div className="procon-subheading"><span>Fotos anexadas</span><small>{dados.fotos.length} de 8</small></div><div className="procon-photo-grid">{dados.fotos.map((foto, indice) => <article className="procon-photo" key={foto.id} data-testid={`card-procon-foto-${foto.id}`}><button type="button" onClick={() => setFotoEmFoco(foto)} data-testid={`button-procon-ampliar-foto-${foto.id}`} aria-label={`Ampliar foto ${indice + 1}`}><img src={foto.dataUrl} alt={foto.descricao || `Evidência ${indice + 1}`} /></button><button className="procon-photo-remove" type="button" onClick={() => removerFoto(foto.id)} data-testid={`button-procon-remover-foto-${foto.id}`} aria-label={`Remover foto ${indice + 1}`}>Remover</button><input value={foto.descricao} onChange={(e) => atualizarFoto(foto.id, e.target.value)} placeholder="Descrição da foto" data-testid={`input-procon-descricao-foto-${foto.id}`} /></article>)}</div></div>}
                  {dados.documentos.length > 0 && <div className="procon-evidence-block"><div className="procon-subheading"><span>Documentos anexados</span><small>{dados.documentos.length} de 6</small></div><div className="procon-document-list">{dados.documentos.map((documento) => <div className="procon-document" key={documento.id} data-testid={`row-procon-documento-${documento.id}`}><span className="procon-document-type">DOC</span><span><strong>{documento.nome}</strong><small>{tamanhoArquivo(documento.tamanho)}</small></span><button type="button" onClick={() => removerDocumento(documento.id)} data-testid={`button-procon-remover-documento-${documento.id}`}>Remover</button></div>)}</div></div>}
                </div>}
              </section>

              <section className={`procon-card procon-section-card section-${secaoAberta === 'manifestacao' ? 'open' : 'closed'}`} data-testid="section-procon-manifestacao">
                <button className="procon-section-toggle" type="button" onClick={() => abrirSecao('manifestacao')} data-testid="button-procon-secao-manifestacao" aria-expanded={secaoAberta === 'manifestacao'}>
                  <span className="procon-section-index">08</span><span><strong>Manifestação do responsável</strong><small>Registre o que foi declarado no local</small></span><b>{secaoAberta === 'manifestacao' ? 'Fechar' : 'Abrir'}</b>
                </button>
                {secaoAberta === 'manifestacao' && <div className="procon-section-body"><fieldset className="procon-fieldset"><legend>O responsável foi informado sobre as constatações?</legend><div className="procon-segmented">{(['sim', 'nao'] as ProconSimNao[]).map((valor) => <label className={dados.manifestacao.responsavelInformado === valor ? 'selected' : ''} key={valor}><input type="radio" name="responsavel-informado" value={valor} checked={dados.manifestacao.responsavelInformado === valor} onChange={(e) => atualizarGrupo('manifestacao', 'responsavelInformado', e.target.value)} data-testid={`radio-procon-informado-${valor}`} /><span>{valor === 'sim' ? 'Sim' : 'Não'}</span></label>)}</div></fieldset><label className="procon-field procon-field-wide"><span>Manifestação</span><textarea rows={4} value={dados.manifestacao.texto} onChange={(e) => atualizarGrupo('manifestacao', 'texto', e.target.value)} placeholder="Transcreva ou resuma a declaração do responsável." data-testid="textarea-procon-manifestacao" /></label><label className="procon-field procon-field-wide"><span>Observações do agente</span><textarea rows={3} value={dados.manifestacao.observacoesAgente} onChange={(e) => atualizarGrupo('manifestacao', 'observacoesAgente', e.target.value)} data-testid="textarea-procon-observacoes-agente" /></label></div>}
              </section>

              <section className={`procon-card procon-section-card section-${secaoAberta === 'resultado' ? 'open' : 'closed'}`} data-testid="section-procon-resultado">
                <button className="procon-section-toggle" type="button" onClick={() => abrirSecao('resultado')} data-testid="button-procon-secao-resultado" aria-expanded={secaoAberta === 'resultado'}>
                  <span className="procon-section-index">09</span><span><strong>Resultado da visita</strong><small>Encaminhamento e próximos passos</small></span><b>{secaoAberta === 'resultado' ? 'Fechar' : 'Abrir'}</b>
                </button>
                {secaoAberta === 'resultado' && <div className="procon-section-body"><fieldset className="procon-fieldset"><legend>Marque o resultado</legend><div className="procon-check-grid">{RESULTADOS.map((item) => <label className={`procon-check ${dados.resultado.itens.includes(item) ? 'selected' : ''}`} key={item}><input type="checkbox" checked={dados.resultado.itens.includes(item)} onChange={() => alternarLista('itens', item)} data-testid={`checkbox-procon-resultado-${item.toLowerCase().replaceAll(' ', '-')}`} /><span>{item}</span></label>)}</div></fieldset><div className="procon-field-grid"><label className="procon-field"><span>Prazo para regularização</span><input inputMode="numeric" value={dados.resultado.prazoDias} onChange={(e) => atualizarGrupo('resultado', 'prazoDias', e.target.value)} placeholder="Ex.: 10 dias" data-testid="input-procon-prazo" /></label><label className="procon-field"><span>Data limite</span><input type="date" value={dados.resultado.dataLimite} onChange={(e) => atualizarGrupo('resultado', 'dataLimite', e.target.value)} data-testid="input-procon-data-limite" /></label></div><fieldset className="procon-fieldset"><legend>Necessita nova visita?</legend><div className="procon-segmented">{(['sim', 'nao'] as ProconSimNao[]).map((valor) => <label className={dados.resultado.novaVisita === valor ? 'selected' : ''} key={valor}><input type="radio" name="nova-visita" value={valor} checked={dados.resultado.novaVisita === valor} onChange={(e) => atualizarGrupo('resultado', 'novaVisita', e.target.value)} data-testid={`radio-procon-nova-visita-${valor}`} /><span>{valor === 'sim' ? 'Sim' : 'Não'}</span></label>)}</div></fieldset></div>}
              </section>

              <section className={`procon-card procon-section-card section-${secaoAberta === 'assinaturas' ? 'open' : 'closed'}`} data-testid="section-procon-assinaturas">
                <button className="procon-section-toggle" type="button" onClick={() => abrirSecao('assinaturas')} data-testid="button-procon-secao-assinaturas" aria-expanded={secaoAberta === 'assinaturas'}>
                  <span className="procon-section-index">10</span><span><strong>Assinaturas</strong><small>Confirmação das partes</small></span><b>{secaoAberta === 'assinaturas' ? 'Fechar' : 'Abrir'}</b>
                </button>
                {secaoAberta === 'assinaturas' && <div className="procon-section-body"><div className="procon-field-grid"><label className="procon-field"><span>Nome do responsável</span><input value={dados.assinaturas.responsavelNome} onChange={(e) => atualizarGrupo('assinaturas', 'responsavelNome', e.target.value)} data-testid="input-procon-assinatura-responsavel" /></label><label className="procon-field"><span>Agente</span><input value={dados.assinaturas.agenteNome} onChange={(e) => atualizarGrupo('assinaturas', 'agenteNome', e.target.value)} data-testid="input-procon-assinatura-agente" /></label></div><label className="procon-check procon-sign-refusal"><input type="checkbox" checked={dados.assinaturas.responsavelRecusou} onChange={(e) => atualizarGrupo('assinaturas', 'responsavelRecusou', e.target.checked)} data-testid="checkbox-procon-recusa-assinatura" /><span>Responsável recusou-se a assinar</span></label><div className="procon-signature-preview"><div><span>Responsável</span><strong>{dados.assinaturas.responsavelRecusou ? 'Recusa registrada' : dados.assinaturas.responsavelNome || 'Aguardando assinatura digital'}</strong></div><div><span>Agente</span><strong>{dados.assinaturas.agenteNome || 'Aguardando assinatura digital'}</strong></div></div></div>}
              </section>

              {erroSalvar && <div className="procon-alert procon-alert-error" role="alert" data-testid="status-procon-erro">{erroSalvar}</div>}
              <button className="procon-submit" type="submit" data-testid="button-procon-revisar"><span>Revisar relatório</span><b>Continuar</b></button>
            </form>
          </>
        )}

        <section className="procon-history" data-testid="section-procon-historico">
          <div className="procon-history-heading"><div><span className="procon-eyebrow">Neste aparelho</span><h2>Histórico local</h2></div><button type="button" onClick={onAtualizarLista} disabled={carregandoLista} data-testid="button-procon-atualizar">{carregandoLista ? 'Atualizando' : 'Atualizar'}</button></div>
          {erroLista ? <div className="procon-list-state is-error" role="alert" data-testid="status-procon-erro-lista"><strong>Histórico indisponível.</strong><span>Não foi possível carregar os relatórios do órgão.</span><button type="button" onClick={onAtualizarLista} data-testid="button-procon-tentar-lista">Tentar novamente</button></div> : carregandoLista ? <div className="procon-skeleton-list" data-testid="status-procon-carregando"><span /><span /><span /></div> : relatorios.length === 0 ? <div className="procon-list-state" data-testid="status-procon-vazio"><span className="procon-empty-mark">--</span><strong>Nenhum documento na fila</strong><span>Autos e termos emitidos aparecerão aqui para consulta rápida.</span></div> : <div className="procon-history-list" data-testid="list-procon-relatorios">{relatorios.slice(0, 8).map((relatorio) => <article className="procon-history-row" key={relatorio.id} data-testid={`row-procon-relatorio-${relatorio.id}`}><span className="procon-history-stamp">P</span><div><strong>{relatorio.estabelecimento.nomeFantasia || relatorio.estabelecimento.razaoSocial || 'Estabelecimento não identificado'}</strong><span>{nomeTipoDocumento(relatorio.identificacao.tipoDocumento)} · {relatorio.identificacao.numero} · {relatorio.endereco.municipio || 'Município não informado'}</span><small>{formatarData(relatorio.identificacao.horaInicio)}{relatorio.identificacao.numeroProcesso ? ` · Processo ${relatorio.identificacao.numeroProcesso}` : ''}</small></div><em className={`procon-status status-${relatorio.status || 'rascunho'}`}>{rotuloStatus(relatorio.status)}</em><div className="procon-history-actions"><button type="button" onClick={() => consultarRelatorio(relatorio)} data-testid={`button-procon-consultar-${relatorio.id}`}>Consultar</button>{relatorio.status !== 'enviado' && <button type="button" onClick={() => void enviarRelatorioExistente(relatorio)} data-testid={`button-procon-enviar-${relatorio.id}`}>Enviar</button>}</div></article>)}</div>}
        </section>
      </div>

      {fotoEmFoco && <div className="procon-lightbox" role="dialog" aria-modal="true" data-testid="dialog-procon-foto"><button type="button" onClick={() => setFotoEmFoco(null)} data-testid="button-procon-fechar-foto" aria-label="Fechar foto">Fechar</button><img src={fotoEmFoco.dataUrl} alt={fotoEmFoco.descricao || 'Foto ampliada da visita'} /><div><strong>{fotoEmFoco.nome}</strong><span>{fotoEmFoco.descricao || 'Sem descrição'}</span></div></div>}
    </main>
  )
}