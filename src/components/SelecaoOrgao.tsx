import type { Orgao } from './Login'
import { selecionarOrgao } from './Login'

interface Props {
  onSelecionar: (orgao: Orgao) => void
}

const opcoes: Array<{
  id: Orgao
  icone: string
  logo?: string
  nome: string
  descricao: string
  destaque: string
}> = [
  {
    id: 'defesa-civil',
    icone: '🛡️',
    logo: '/defesa-civil-logo.png',
    nome: 'Defesa Civil',
    descricao: 'Ocorrências, monitoramento e operações de campo.',
    destaque: 'Operações gerais',
  },
]

export default function SelecaoOrgao({ onSelecionar }: Props) {
  function escolher(orgao: Orgao) {
    selecionarOrgao(orgao)
    onSelecionar(orgao)
  }

  return (
    <main className="login-tela selecao-orgao-tela">
      <section className="login-box selecao-orgao-box">
        <div className="login-logo-wrap">
          <img className="login-logo" src="/defesa-civil-logo.png" alt="Defesa Civil" />
        </div>
        <div className="login-titulo">Escolha o órgão</div>
        <div className="login-subtitulo">Entre no ambiente de trabalho que deseja acessar</div>

        <div className="selecao-orgao-lista">
          {opcoes.map((opcao) => (
            <button
              key={opcao.id}
              type="button"
              className={`selecao-orgao-card selecao-orgao-card--${opcao.id}`}
              onClick={() => escolher(opcao.id)}
            >
              {opcao.logo ? (
                <img className="selecao-orgao-icone selecao-orgao-logo" src={opcao.logo} alt="" />
              ) : (
                <span className="selecao-orgao-icone" aria-hidden="true">{opcao.icone}</span>
              )}
              <span className="selecao-orgao-texto">
                <strong>{opcao.nome}</strong>
                <small>{opcao.descricao}</small>
                <em>{opcao.destaque}</em>
              </span>
              <span className="selecao-orgao-seta" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}