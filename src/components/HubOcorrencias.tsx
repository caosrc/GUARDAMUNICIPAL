import type { CategoriaOcorrencia } from '../types'

interface Props {
  total: number
  ativos: number
  altos: number
  online: boolean
  agente: string
  onNova: (categoria?: CategoriaOcorrencia) => void
  onAtivos: () => void
  onHistorico: () => void
  onMapa: () => void
  onPatrulhamento: () => void
  onRelatorios: () => void
  onInfo: (mensagem: string) => void
}

type AcaoModulo =
  | { tipo: 'acao'; rotulo: string; descricao: string; marca: string; onClick: () => void; destaque?: boolean }
  | { tipo: 'categoria'; rotulo: string; descricao: string; marca: string; categoria: CategoriaOcorrencia }
  | { tipo: 'info'; rotulo: string; descricao: string; marca: string; mensagem: string }

export default function HubOcorrencias({
  total,
  ativos,
  altos,
  online,
  agente,
  onNova,
  onAtivos,
  onHistorico,
  onMapa,
  onPatrulhamento,
  onRelatorios,
  onInfo,
}: Props) {
  const modulos: AcaoModulo[] = [
    { tipo: 'acao', rotulo: 'Em andamento', descricao: 'Acompanhar atendimentos ativos', marca: 'AT', onClick: onAtivos, destaque: true },
    { tipo: 'acao', rotulo: 'Histórico', descricao: 'Consultar registros encerrados', marca: 'HI', onClick: onHistorico },
    { tipo: 'acao', rotulo: 'Mapa operacional', descricao: 'Ocorrências e equipes no território', marca: 'MP', onClick: onMapa },
    { tipo: 'acao', rotulo: 'Patrulhamento', descricao: 'Rondas, equipes e presença', marca: 'PT', onClick: onPatrulhamento },
    { tipo: 'categoria', rotulo: 'Abordagem', descricao: 'Registrar uma abordagem', marca: 'AB', categoria: 'seguranca' },
    { tipo: 'categoria', rotulo: 'Trânsito', descricao: 'Acidente, infração ou veículo', marca: 'TR', categoria: 'transito' },
    { tipo: 'categoria', rotulo: 'Patrimônio', descricao: 'Proteger bens e próprios públicos', marca: 'PA', categoria: 'patrimonio' },
    { tipo: 'categoria', rotulo: 'Escolas', descricao: 'Ações no entorno escolar', marca: 'ES', categoria: 'escolas' },
    { tipo: 'categoria', rotulo: 'Eventos', descricao: 'Apoio e controle de acesso', marca: 'EV', categoria: 'eventos' },
    { tipo: 'categoria', rotulo: 'Apoio a órgãos', descricao: 'PM, Bombeiros, SAMU e outros', marca: 'AP', categoria: 'apoio' },
    { tipo: 'info', rotulo: 'Pessoas e locais', descricao: 'Cadastros vinculados à ocorrência', marca: 'PL', mensagem: 'O cadastro de pessoas e locais será vinculado ao formulário da ocorrência.' },
    { tipo: 'acao', rotulo: 'Relatórios', descricao: 'Exportações e indicadores do turno', marca: 'RE', onClick: onRelatorios },
  ]

  return (
    <section className="oc-hub" aria-labelledby="oc-hub-titulo">
      <div className="oc-hub-topline">
        <span className="oc-hub-kicker">CENTRAL OPERACIONAL</span>
        <span className={`oc-hub-presenca ${online ? 'online' : 'offline'}`}>
          <i aria-hidden="true" /> {online ? 'Conectado' : 'Modo offline'}
        </span>
      </div>
      <div className="oc-hub-intro">
        <div>
          <h1 id="oc-hub-titulo">Ocorrências</h1>
          <p>Comando de atendimentos da Guarda Municipal</p>
          <span className="oc-hub-agente">Plantão de {agente || 'equipe'} · Conselheiro Lafaiete</span>
        </div>
        <button className="oc-hub-nova" onClick={() => onNova()}>
          <span className="oc-hub-nova-plus" aria-hidden="true">+</span>
          <span><strong>Nova ocorrência</strong><small>Abrir atendimento</small></span>
        </button>
      </div>

      <div className="oc-hub-metricas" aria-label="Resumo do plantão">
        <button onClick={onAtivos}><strong>{ativos}</strong><span>em atendimento</span></button>
        <button onClick={onHistorico}><strong>{total}</strong><span>no histórico</span></button>
        <button onClick={onAtivos} className={altos > 0 ? 'critico' : ''}><strong>{altos}</strong><span>prioridade alta</span></button>
      </div>

      <div className="oc-hub-section-heading">
        <div><span className="oc-hub-kicker">ACESSO RÁPIDO</span><strong>Operação da Guarda</strong></div>
        <span>{modulos.length} módulos</span>
      </div>
      <div className="oc-hub-modulos">
        {modulos.map((modulo) => {
          const click = modulo.tipo === 'acao'
            ? modulo.onClick
            : modulo.tipo === 'categoria'
              ? () => onNova(modulo.categoria)
              : () => onInfo(modulo.mensagem)
          return (
            <button
              key={modulo.rotulo}
              className={`oc-hub-modulo ${modulo.destaque ? 'destaque' : ''} ${modulo.tipo === 'info' ? 'informativo' : ''}`}
              onClick={click}
            >
              <span className="oc-hub-modulo-marca">{modulo.marca}</span>
              <span className="oc-hub-modulo-copy"><strong>{modulo.rotulo}</strong><small>{modulo.descricao}</small></span>
              <span className="oc-hub-modulo-seta" aria-hidden="true">›</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}