function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function ehFerramentalPorLitro(nome: string): boolean {
  const nomeNormalizado = normalizarNome(nome)
  return nomeNormalizado === 'OLEO' ||
    nomeNormalizado.includes('OLEO LUBRIFICANTE')
}

export function ehFerramentalSomenteQuantidade(nome: string): boolean {
  const nomeNormalizado = normalizarNome(nome)
  return nomeNormalizado.includes('OLEO 2 TEMPO STIHL') ||
    nomeNormalizado.includes('OLEO STIHL') ||
    nomeNormalizado.includes('DC GASOLINA')
}