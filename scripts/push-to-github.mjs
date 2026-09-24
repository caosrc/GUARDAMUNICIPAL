#!/usr/bin/env node
/**
 * push-to-github.mjs
 * Envia as alterações locais para o GitHub usando a API REST (sem git push).
 * Uso: node scripts/push-to-github.mjs "mensagem do commit"
 */

import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const TOKEN = process.env.GITHUB_TOKEN
if (!TOKEN) {
  console.error('❌ GITHUB_TOKEN não configurado.')
  process.exit(1)
}

const REPO = 'caosrc/defesacivil'
const BRANCH = 'main'
const API = 'https://api.github.com'

const mensagem = process.argv[2] || 'Atualização via Replit'

async function ghFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `token ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      ...opts.headers,
    },
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`GitHub API ${path}: ${res.status} — ${json.message || JSON.stringify(json)}`)
  }
  return json
}

// Pega os arquivos modificados/adicionados em relação ao origin/main
function getArquivosAlterados() {
  try {
    const out = execSync('git diff --name-only origin/main HEAD', { encoding: 'utf8' }).trim()
    const staged = execSync('git diff --name-only HEAD', { encoding: 'utf8' }).trim()
    const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' }).trim()

    const arquivos = new Set([
      ...out.split('\n').filter(Boolean),
      ...staged.split('\n').filter(Boolean),
      ...untracked.split('\n').filter(Boolean),
    ])
    return [...arquivos]
  } catch {
    return []
  }
}

async function main() {
  console.log(`📤 Enviando alterações para github.com/${REPO} (branch: ${BRANCH})...`)

  // Pega SHA do último commit do branch no GitHub
  const refData = await ghFetch(`/repos/${REPO}/git/ref/heads/${BRANCH}`)
  const baseCommitSha = refData.object.sha
  console.log(`   Base commit: ${baseCommitSha.slice(0, 7)}`)

  // Pega a árvore base
  const commitData = await ghFetch(`/repos/${REPO}/git/commits/${baseCommitSha}`)
  const baseTreeSha = commitData.tree.sha

  const arquivos = getArquivosAlterados()

  if (arquivos.length === 0) {
    console.log('✅ Nenhuma alteração para enviar.')
    process.exit(0)
  }

  console.log(`   Arquivos alterados (${arquivos.length}):`)
  arquivos.forEach(f => console.log(`     • ${f}`))

  // Cria blobs para cada arquivo alterado
  const treeItems = []
  for (const filePath of arquivos) {
    let content
    try {
      content = readFileSync(filePath)
    } catch {
      console.warn(`   ⚠️  Arquivo não encontrado localmente (pode ter sido removido): ${filePath}`)
      // Marca para deleção
      treeItems.push({ path: filePath, mode: '100644', type: 'blob', sha: null })
      continue
    }

    const blob = await ghFetch(`/repos/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: content.toString('base64'),
        encoding: 'base64',
      }),
    })
    treeItems.push({ path: filePath, mode: '100644', type: 'blob', sha: blob.sha })
  }

  // Cria nova tree
  const newTree = await ghFetch(`/repos/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  })

  // Cria novo commit
  const newCommit = await ghFetch(`/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: mensagem,
      tree: newTree.sha,
      parents: [baseCommitSha],
    }),
  })

  // Atualiza o branch
  await ghFetch(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha }),
  })

  console.log(`✅ Push realizado! Commit: ${newCommit.sha.slice(0, 7)}`)
  console.log(`   O Netlify irá detectar e iniciar o redeploy automaticamente.`)
  console.log(`   Acompanhe em: https://app.netlify.com`)
}

main().catch(err => {
  console.error('❌ Erro:', err.message)
  process.exit(1)
})
