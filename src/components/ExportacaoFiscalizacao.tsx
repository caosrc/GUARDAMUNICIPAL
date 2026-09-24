import { useState } from 'react'
import type { CurralRegistro } from './Curral'
import type { ProconRegistro } from './Procon'
import { exportarFiscalizacaoDocx, exportarFiscalizacaoExcel, exportarFiscalizacaoKmz } from '../exportarFiscalizacao'
import './ExportacaoFiscalizacao.css'

interface Props {
  modulo: 'curral' | 'procon'
  registrosCurral: CurralRegistro[]
  relatoriosProcon: ProconRegistro[]
}

type Formato = 'excel' | 'docx' | 'kmz' | null

export default function ExportacaoFiscalizacao({ modulo, registrosCurral, relatoriosProcon }: Props) {
  const [exportando, setExportando] = useState<Formato>(null)
  const [mensagem, setMensagem] = useState('')
  const exportarCurral = modulo === 'curral'
  const registrosSelecionados = exportarCurral ? registrosCurral : []
  const relatoriosSelecionados = exportarCurral ? [] : relatoriosProcon
  const nomeModulo = exportarCurral ? 'Curral' : 'Procon'
  const total = registrosSelecionados.length + relatoriosSelecionados.length

  async function gerar(formato: Exclude<Formato, null>) {
    if (!total) {
      setMensagem(`Nenhum registro do ${nomeModulo} carregado para exportar.`)
      return
    }
    setExportando(formato)
    setMensagem('')
    try {
      if (formato === 'excel') {
        const resultado = await exportarFiscalizacaoExcel(registrosSelecionados, relatoriosSelecionados, modulo)
        setMensagem(`${resultado.total} registro(s) do ${nomeModulo} exportado(s) em Excel.`)
      } else if (formato === 'docx') {
        const resultado = await exportarFiscalizacaoDocx(registrosSelecionados, relatoriosSelecionados, modulo)
        setMensagem(`${resultado.total} registro(s) do ${nomeModulo} exportado(s) em documento editável.`)
      } else {
        const resultado = await exportarFiscalizacaoKmz(registrosSelecionados, relatoriosSelecionados, modulo)
        setMensagem(`${resultado.pontos} ponto(s) do ${nomeModulo} incluído(s) no KMZ${resultado.semGps ? ` · ${resultado.semGps} sem GPS não incluído(s)` : ''}.`)
      }
    } catch (erro) {
      console.error('Falha na exportação da fiscalização:', erro)
      setMensagem('Não foi possível gerar o arquivo. Tente novamente.')
    } finally {
      setExportando(null)
    }
  }

  return (
    <section className="exportacao-fiscalizacao" data-testid="section-exportacao-fiscalizacao">
      <div className="exportacao-fiscalizacao-copy">
        <span className="exportacao-fiscalizacao-kicker">Relatórios operacionais</span>
        <strong>Exportar {nomeModulo}</strong>
        <span>{total} registro(s) disponível(is) para exportação</span>
      </div>
      <div className="exportacao-fiscalizacao-actions">
        <button type="button" onClick={() => void gerar('excel')} disabled={exportando !== null} data-testid="button-exportar-fiscalizacao-excel"><b>▦</b> {exportando === 'excel' ? 'Gerando...' : 'Excel'}</button>
        <button type="button" onClick={() => void gerar('docx')} disabled={exportando !== null} data-testid="button-exportar-fiscalizacao-docx"><b>▤</b> {exportando === 'docx' ? 'Gerando...' : 'Doc.'}</button>
        <button type="button" onClick={() => void gerar('kmz')} disabled={exportando !== null} data-testid="button-exportar-fiscalizacao-kmz"><b>⌖</b> {exportando === 'kmz' ? 'Gerando...' : 'KMZ'}</button>
      </div>
      {mensagem && <span className="exportacao-fiscalizacao-message" role="status">{mensagem}</span>}
    </section>
  )
}