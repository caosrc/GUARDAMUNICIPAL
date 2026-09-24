/* This module intentionally exports form data factories alongside its component. */
/* eslint-disable react-refresh/only-export-components */

export type OrgaoOperacional = 'defesa-civil' | 'curral' | 'procon'

export type CurralStatusOcorrencia = 'encontrado' | 'a_caminho' | 'no_curral' | 'encerrado'

export interface CurralOcorrenciaCampos {
  especie: string
  porte: string
  sexo: string
  identificacao: string
  localDescricao: string
  observacoes: string
  status: CurralStatusOcorrencia
}

export interface ProconIrregularidadeOcorrencia {
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

export interface ProconOcorrenciaCampos {
  tipoVisita: string
  tipoDocumento: string
  numeroProcesso: string
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  inscricaoEstadual: string
  telefone: string
  email: string
  responsavelEstabelecimento: string
  cargoEstabelecimento: string
  cep: string
  complemento: string
  municipio: string
  uf: string
  motivos: string[]
  motivoOutro: string
  descricaoMotivo: string
  estabelecimentoFuncionando: string
  responsavelPresente: string
  responsavelEncontrado: string
  cargoResponsavel: string
  itensVerificados: string[]
  irregularidades: ProconIrregularidadeOcorrencia[]
  responsavelInformado: string
  manifestacao: string
  observacoesAgente: string
  resultado: string[]
  prazoDias: string
  dataLimite: string
  novaVisita: string
  assinaturaResponsavel: string
  responsavelRecusou: boolean
}

export const novoCurralOcorrencia = (): CurralOcorrenciaCampos => ({
  especie: '',
  porte: '',
  sexo: '',
  identificacao: '',
  localDescricao: '',
  observacoes: '',
  status: 'encontrado',
})

export const novaProconOcorrencia = (): ProconOcorrenciaCampos => ({
  tipoVisita: '',
  tipoDocumento: 'termo_constatacao',
  numeroProcesso: '',
  razaoSocial: '',
  nomeFantasia: '',
  cnpj: '',
  inscricaoEstadual: '',
  telefone: '',
  email: '',
  responsavelEstabelecimento: '',
  cargoEstabelecimento: '',
  cep: '',
  complemento: '',
  municipio: '',
  uf: '',
  motivos: [],
  motivoOutro: '',
  descricaoMotivo: '',
  estabelecimentoFuncionando: 'nao_informado',
  responsavelPresente: 'nao_informado',
  responsavelEncontrado: '',
  cargoResponsavel: '',
  itensVerificados: [],
  irregularidades: [],
  responsavelInformado: 'nao_informado',
  manifestacao: '',
  observacoesAgente: '',
  resultado: [],
  prazoDias: '',
  dataLimite: '',
  novaVisita: 'nao_informado',
  assinaturaResponsavel: '',
  responsavelRecusou: false,
})

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

interface Props {
  orgao: OrgaoOperacional
  curral: CurralOcorrenciaCampos
  onCurralChange: (dados: CurralOcorrenciaCampos) => void
  procon: ProconOcorrenciaCampos
  onProconChange: (dados: ProconOcorrenciaCampos) => void
}

function Campo({
  label,
  value,
  onChange,
  placeholder,
  wide = false,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  wide?: boolean
  type?: string
}) {
  return (
    <label className={`orgao-field${wide ? ' orgao-field-wide' : ''}`}>
      <span>{label}</span>
      <input className="campo-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}

function Texto({
  label,
  value,
  onChange,
  placeholder,
  wide = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  wide?: boolean
}) {
  return (
    <label className={`orgao-field${wide ? ' orgao-field-wide' : ''}`}>
      <span>{label}</span>
      <textarea className="campo-textarea" rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}

function Escolhas({
  items,
  selecionados,
  onToggle,
}: {
  items: string[][]
  selecionados: string[]
  onToggle: (valor: string) => void
}) {
  return (
    <div className="orgao-choice-grid">
      {items.map(([value, label]) => (
        <label className={`orgao-choice ${selecionados.includes(value) ? 'selected' : ''}`} key={value}>
          <input type="checkbox" checked={selecionados.includes(value)} onChange={() => onToggle(value)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}

function CampoSimNao({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <fieldset className="orgao-fieldset">
      <legend>{label}</legend>
      <div className="orgao-segmented">
        {['sim', 'nao'].map((item) => (
          <label className={value === item ? 'selected' : ''} key={item}>
            <input type="radio" checked={value === item} onChange={() => onChange(item)} />
            <span>{item === 'sim' ? 'Sim' : 'Não'}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function campoIrregularidadeVazio(): ProconIrregularidadeOcorrencia {
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

export default function CamposOrgao({ orgao, curral, onCurralChange, procon, onProconChange }: Props) {
  if (orgao === 'curral') {
    const atualizarCurral = (campo: keyof CurralOcorrenciaCampos, valor: string) => {
      onCurralChange({ ...curral, [campo]: valor } as CurralOcorrenciaCampos)
    }

    return (
      <section className="orgao-extra orgao-extra-curral" data-testid="section-campos-curral">
        <div className="orgao-extra-heading">
          <span className="orgao-extra-icon">🐎</span>
          <div>
            <span className="orgao-extra-kicker">Perguntas do Curral</span>
            <h3>Dados do animal e da captura</h3>
            <p>As respostas serão salvas na mesma ocorrência criada pelo botão +.</p>
          </div>
        </div>
        <div className="orgao-field-grid">
          <Campo label="Espécie" value={curral.especie} onChange={(valor) => atualizarCurral('especie', valor)} placeholder="Ex.: bovino, equino, cão" wide />
          <label className="orgao-field">
            <span>Porte</span>
            <select className="campo-select" value={curral.porte} onChange={(e) => atualizarCurral('porte', e.target.value)}>
              <option value="">Selecionar</option>
              <option value="pequeno">Pequeno</option>
              <option value="medio">Médio</option>
              <option value="grande">Grande</option>
            </select>
          </label>
          <label className="orgao-field">
            <span>Sexo</span>
            <select className="campo-select" value={curral.sexo} onChange={(e) => atualizarCurral('sexo', e.target.value)}>
              <option value="">Não informado</option>
              <option value="femea">Fêmea</option>
              <option value="macho">Macho</option>
            </select>
          </label>
          <Campo label="Identificação visível" value={curral.identificacao} onChange={(valor) => atualizarCurral('identificacao', valor)} placeholder="Brinco, marca, cor ou característica" wide />
          <Campo label="Descrição do local / propriedade" value={curral.localDescricao} onChange={(valor) => atualizarCurral('localDescricao', valor)} placeholder="Ponto de referência ou propriedade" wide />
          <label className="orgao-field">
            <span>Status do atendimento</span>
            <select className="campo-select" value={curral.status} onChange={(e) => atualizarCurral('status', e.target.value)}>
              <option value="encontrado">Encontrado</option>
              <option value="a_caminho">A caminho</option>
              <option value="no_curral">No curral</option>
              <option value="encerrado">Encerrado</option>
            </select>
          </label>
          <Texto label="Condição do animal, risco no local ou orientação dada" value={curral.observacoes} onChange={(valor) => atualizarCurral('observacoes', valor)} />
        </div>
      </section>
    )
  }

  if (orgao !== 'procon') return null

  const atualizar = <K extends keyof ProconOcorrenciaCampos>(campo: K, valor: ProconOcorrenciaCampos[K]) => {
    onProconChange({ ...procon, [campo]: valor })
  }
  const alternar = (campo: 'motivos' | 'itensVerificados' | 'resultado', valor: string) => {
    const atual = procon[campo]
    atualizar(campo, atual.includes(valor) ? atual.filter((item) => item !== valor) : [...atual, valor])
  }
  const atualizarIrregularidade = (id: string, campo: keyof ProconIrregularidadeOcorrencia, valor: string) => {
    atualizar('irregularidades', procon.irregularidades.map((item) => item.id === id ? { ...item, [campo]: valor } : item))
  }
  const enderecoProcon = [procon.cep, procon.complemento, procon.municipio, procon.uf].filter(Boolean).join(' · ')

  return (
    <section className="orgao-extra orgao-extra-procon" data-testid="section-campos-procon">
      <div className="orgao-extra-heading">
        <span className="orgao-extra-icon">P</span>
        <div>
          <span className="orgao-extra-kicker">Perguntas do Procon</span>
          <h3>Dados da fiscalização</h3>
          <p>O atendimento será registrado como uma única ocorrência, junto com o formulário padrão.</p>
        </div>
      </div>

      <div className="orgao-extra-block">
        <h4>Identificação da visita</h4>
        <div className="orgao-field-grid">
          <label className="orgao-field">
            <span>Tipo de visita</span>
            <select className="campo-select" value={procon.tipoVisita} onChange={(e) => atualizar('tipoVisita', e.target.value)}>
              <option value="">Selecionar</option>
              {['Rotina', 'Fiscalização', 'Denúncia', 'Operação especial', 'Retorno', 'Outro'].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="orgao-field">
            <span>Documento a emitir</span>
            <select className="campo-select" value={procon.tipoDocumento} onChange={(e) => atualizar('tipoDocumento', e.target.value)}>
              <option value="termo_constatacao">Termo de constatação</option>
              <option value="auto_infracao">Auto de infração</option>
              <option value="auto_apreensao">Auto de apreensão</option>
              <option value="relatorio_visita">Relatório de visita</option>
            </select>
          </label>
          <Campo label="Número do processo ou fiscalização" value={procon.numeroProcesso} onChange={(valor) => atualizar('numeroProcesso', valor)} placeholder="Opcional" wide />
        </div>
      </div>

      <div className="orgao-extra-block">
        <h4>Estabelecimento</h4>
        <div className="orgao-field-grid">
          <Campo label="Razão social" value={procon.razaoSocial} onChange={(valor) => atualizar('razaoSocial', valor)} placeholder="Nome registrado da empresa" wide />
          <Campo label="Nome fantasia" value={procon.nomeFantasia} onChange={(valor) => atualizar('nomeFantasia', valor)} placeholder="Nome comercial" />
          <Campo label="CNPJ" value={procon.cnpj} onChange={(valor) => atualizar('cnpj', valor)} placeholder="00.000.000/0000-00" />
          <Campo label="Inscrição estadual" value={procon.inscricaoEstadual} onChange={(valor) => atualizar('inscricaoEstadual', valor)} />
          <Campo label="Telefone" value={procon.telefone} onChange={(valor) => atualizar('telefone', valor)} />
          <Campo label="E-mail" value={procon.email} onChange={(valor) => atualizar('email', valor)} type="email" />
          <Campo label="Responsável pelo estabelecimento" value={procon.responsavelEstabelecimento} onChange={(valor) => atualizar('responsavelEstabelecimento', valor)} />
          <Campo label="Cargo" value={procon.cargoEstabelecimento} onChange={(valor) => atualizar('cargoEstabelecimento', valor)} />
          <Campo label="CEP" value={procon.cep} onChange={(valor) => atualizar('cep', valor)} placeholder="00000-000" />
          <Campo label="Complemento" value={procon.complemento} onChange={(valor) => atualizar('complemento', valor)} placeholder="Loja, sala" />
          <Campo label="Município" value={procon.municipio} onChange={(valor) => atualizar('municipio', valor)} />
          <Campo label="UF" value={procon.uf} onChange={(valor) => atualizar('uf', valor.toUpperCase())} />
        </div>
        {enderecoProcon && <p className="orgao-helper">Complemento do endereço: {enderecoProcon}</p>}
      </div>

      <div className="orgao-extra-block">
        <h4>Motivo da visita</h4>
        <Escolhas items={MOTIVOS} selecionados={procon.motivos} onToggle={(valor) => alternar('motivos', valor)} />
        <div className="orgao-field-grid">
          <Campo label="Outro motivo" value={procon.motivoOutro} onChange={(valor) => atualizar('motivoOutro', valor)} placeholder="Se não encontrou a opção" wide />
          <Texto label="Descrição do motivo" value={procon.descricaoMotivo} onChange={(valor) => atualizar('descricaoMotivo', valor)} placeholder="Ordem, denúncia ou situação que originou a visita." />
        </div>
      </div>

      <div className="orgao-extra-block">
        <h4>Constatações</h4>
        <div className="orgao-question-grid">
          <CampoSimNao label="Estabelecimento em funcionamento?" value={procon.estabelecimentoFuncionando} onChange={(valor) => atualizar('estabelecimentoFuncionando', valor)} />
          <CampoSimNao label="Responsável presente?" value={procon.responsavelPresente} onChange={(valor) => atualizar('responsavelPresente', valor)} />
        </div>
        <div className="orgao-field-grid">
          <Campo label="Nome do responsável encontrado" value={procon.responsavelEncontrado} onChange={(valor) => atualizar('responsavelEncontrado', valor)} />
          <Campo label="Cargo" value={procon.cargoResponsavel} onChange={(valor) => atualizar('cargoResponsavel', valor)} />
        </div>
        <span className="orgao-subheading">Itens verificados</span>
        <Escolhas items={ITENS_VERIFICADOS.map((item) => [item, item])} selecionados={procon.itensVerificados} onToggle={(valor) => alternar('itensVerificados', valor)} />
      </div>

      <div className="orgao-extra-block">
        <div className="orgao-block-heading">
          <div>
            <h4>Irregularidades</h4>
            <p>Adicione cada irregularidade encontrada separadamente.</p>
          </div>
          <button type="button" className="orgao-add-button" onClick={() => atualizar('irregularidades', [...procon.irregularidades, campoIrregularidadeVazio()])}>+ Adicionar</button>
        </div>
        {procon.irregularidades.length === 0 && <p className="orgao-empty">Nenhuma irregularidade adicionada.</p>}
        {procon.irregularidades.map((item, index) => (
          <div className="orgao-irregularidade" key={item.id}>
            <div className="orgao-irregularidade-heading">
              <strong>Irregularidade {index + 1}</strong>
              <button type="button" onClick={() => atualizar('irregularidades', procon.irregularidades.filter((irregularidade) => irregularidade.id !== item.id))}>Remover</button>
            </div>
            <div className="orgao-field-grid">
              <label className="orgao-field">
                <span>Categoria</span>
                <select className="campo-select" value={item.categoria} onChange={(e) => atualizarIrregularidade(item.id, 'categoria', e.target.value)}>
                  <option value="">Selecionar</option>
                  {CATEGORIAS.map((categoria) => <option key={categoria}>{categoria}</option>)}
                </select>
              </label>
              <Campo label="Produto" value={item.produto} onChange={(valor) => atualizarIrregularidade(item.id, 'produto', valor)} />
              <Campo label="Marca" value={item.marca} onChange={(valor) => atualizarIrregularidade(item.id, 'marca', valor)} />
              <Campo label="Preço" value={item.preco} onChange={(valor) => atualizarIrregularidade(item.id, 'preco', valor)} />
              <Campo label="Quantidade" value={item.quantidade} onChange={(valor) => atualizarIrregularidade(item.id, 'quantidade', valor)} />
              <Campo label="Lote" value={item.lote} onChange={(valor) => atualizarIrregularidade(item.id, 'lote', valor)} />
              <Texto label="Descrição da irregularidade" value={item.descricao} onChange={(valor) => atualizarIrregularidade(item.id, 'descricao', valor)} />
              <Texto label="Observação" value={item.observacao} onChange={(valor) => atualizarIrregularidade(item.id, 'observacao', valor)} />
            </div>
          </div>
        ))}
      </div>

      <div className="orgao-extra-block">
        <h4>Manifestação e resultado</h4>
        <div className="orgao-question-grid">
          <CampoSimNao label="Responsável foi informado?" value={procon.responsavelInformado} onChange={(valor) => atualizar('responsavelInformado', valor)} />
          <CampoSimNao label="Nova visita necessária?" value={procon.novaVisita} onChange={(valor) => atualizar('novaVisita', valor)} />
        </div>
        <div className="orgao-field-grid">
          <Texto label="Manifestação do responsável" value={procon.manifestacao} onChange={(valor) => atualizar('manifestacao', valor)} />
          <Texto label="Observações do agente" value={procon.observacoesAgente} onChange={(valor) => atualizar('observacoesAgente', valor)} />
        </div>
        <span className="orgao-subheading">Resultado da fiscalização</span>
        <Escolhas items={RESULTADOS.map((item) => [item, item])} selecionados={procon.resultado} onToggle={(valor) => alternar('resultado', valor)} />
        <div className="orgao-field-grid">
          <Campo label="Prazo para regularização (dias)" value={procon.prazoDias} onChange={(valor) => atualizar('prazoDias', valor)} type="number" />
          <Campo label="Data limite" value={procon.dataLimite} onChange={(valor) => atualizar('dataLimite', valor)} type="date" />
        </div>
      </div>

      <div className="orgao-extra-block">
        <h4>Assinaturas</h4>
        <div className="orgao-field-grid">
          <Campo label="Nome do responsável" value={procon.assinaturaResponsavel} onChange={(valor) => atualizar('assinaturaResponsavel', valor)} />
          <label className="orgao-choice orgao-choice-inline">
            <input type="checkbox" checked={procon.responsavelRecusou} onChange={(e) => atualizar('responsavelRecusou', e.target.checked)} />
            <span>Responsável recusou-se a assinar</span>
          </label>
        </div>
      </div>
    </section>
  )
}

export function nomesCamposOrgao(orgao: OrgaoOperacional, curral: CurralOcorrenciaCampos, procon: ProconOcorrenciaCampos): string {
  if (orgao === 'curral') {
    const statusCurral = {
      encontrado: 'Encontrado',
      a_caminho: 'A caminho',
      no_curral: 'No curral',
      encerrado: 'Encerrado',
    }[curral.status]
    return [
      '[CURRAL]',
      `Espécie: ${curral.especie || 'Não informada'}`,
      `Porte: ${curral.porte || 'Não informado'}`,
      `Sexo: ${curral.sexo || 'Não informado'}`,
      `Identificação visível: ${curral.identificacao || 'Não informada'}`,
      `Local da captura: ${curral.localDescricao || 'Não informado'}`,
      `Status do atendimento: ${statusCurral}`,
      `Observações: ${curral.observacoes || 'Nenhuma'}`,
    ].join('\n')
  }

  if (orgao === 'procon') {
    const documentoProcon = {
      termo_constatacao: 'Termo de constatação',
      auto_infracao: 'Auto de infração',
      auto_apreensao: 'Auto de apreensão',
      relatorio_visita: 'Relatório de visita',
    }[procon.tipoDocumento] || procon.tipoDocumento
    const motivosProcon = procon.motivos.map((motivo) => MOTIVOS.find(([valor]) => valor === motivo)?.[1] || motivo)
    const estadoSimNao = (valor: string) => valor === 'sim' ? 'Sim' : valor === 'nao' ? 'Não' : 'Não informado'
    const irregularidades = procon.irregularidades.length
      ? procon.irregularidades.map((item, index) => [
        `Irregularidade ${index + 1}:`,
        `Categoria: ${item.categoria || 'Não informada'}`,
        `Descrição: ${item.descricao || 'Não informada'}`,
        `Produto: ${item.produto || 'Não informado'} · Marca: ${item.marca || 'Não informada'}`,
        `Preço: ${item.preco || 'Não informado'} · Quantidade: ${item.quantidade || 'Não informada'} · Lote: ${item.lote || 'Não informado'}`,
        `Observação: ${item.observacao || 'Nenhuma'}`,
      ].join('\n')).join('\n')
      : 'Nenhuma irregularidade adicionada.'
    return [
      '[PROCON]',
      `Tipo de visita: ${procon.tipoVisita || 'Não informado'}`,
      `Documento: ${documentoProcon}`,
      `Processo/fiscalização: ${procon.numeroProcesso || 'Não informado'}`,
      `Razão social: ${procon.razaoSocial || 'Não informada'}`,
      `Nome fantasia: ${procon.nomeFantasia || 'Não informado'}`,
      `CNPJ: ${procon.cnpj || 'Não informado'} · Inscrição estadual: ${procon.inscricaoEstadual || 'Não informada'}`,
      `Telefone: ${procon.telefone || 'Não informado'} · E-mail: ${procon.email || 'Não informado'}`,
      `Responsável: ${procon.responsavelEstabelecimento || 'Não informado'} · Cargo: ${procon.cargoEstabelecimento || 'Não informado'}`,
      `CEP: ${procon.cep || 'Não informado'} · Complemento: ${procon.complemento || 'Não informado'}`,
      `Município/UF: ${procon.municipio || 'Não informado'} / ${procon.uf || 'Não informado'}`,
      `Motivos: ${motivosProcon.join(', ') || procon.motivoOutro || 'Não informado'}`,
      `Descrição do motivo: ${procon.descricaoMotivo || 'Não informada'}`,
      `Estabelecimento funcionando: ${estadoSimNao(procon.estabelecimentoFuncionando)}`,
      `Responsável presente: ${estadoSimNao(procon.responsavelPresente)}`,
      `Responsável encontrado: ${procon.responsavelEncontrado || 'Não informado'} · Cargo: ${procon.cargoResponsavel || 'Não informado'}`,
      `Itens verificados: ${procon.itensVerificados.join(', ') || 'Nenhum informado'}`,
      irregularidades,
      `Responsável informado: ${estadoSimNao(procon.responsavelInformado)}`,
      `Manifestação: ${procon.manifestacao || 'Não informada'}`,
      `Observações do agente: ${procon.observacoesAgente || 'Nenhuma'}`,
      `Resultado: ${procon.resultado.join(', ') || 'Não informado'}`,
      `Prazo: ${procon.prazoDias || 'Não informado'} dias · Data limite: ${procon.dataLimite || 'Não informada'}`,
      `Nova visita: ${estadoSimNao(procon.novaVisita)}`,
      `Assinatura: ${procon.responsavelRecusou ? 'Recusada pelo responsável' : procon.assinaturaResponsavel || 'Não informada'}`,
    ].join('\n')
  }

  return ''
}