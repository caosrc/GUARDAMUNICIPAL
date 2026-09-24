import { supabase, supabaseDisponivel } from './supabaseClient'
import { wsSend } from './wsClient'

export interface MatMaterial {
  id: string
  nome: string
  categoria: 'escritorio' | 'ferramental' | null
  descricao: string | null
  observacoes: string | null
  foto_thumb: string | null
  foto?: string | null
  foto_placa?: string | null
  quantidade: number | null
  created_at: string
}

export interface MatChecklistFerramenta {
  id: number
  ferramenta_id: string
  quantidade_cadastrada: number
  quantidade_conferida: number
  condicao: 'boa' | 'media' | 'ruim' | 'quantidade'
  item_faltante: string | null
  justificativa: string | null
  realizado_por: string | null
  data_checklist: string
  created_at: string
}

export interface MatEmprestimo {
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

export interface MatEquipamentoCampo {
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

function sbErr(error: { message: string } | null, contexto = ''): never {
  throw new Error((contexto ? `[${contexto}] ` : '') + (error?.message ?? 'Erro desconhecido'))
}

function tabelaSupabaseAusente(error: { code?: string; message?: string } | null): boolean {
  return error?.code === 'PGRST205' ||
    /could not find the table|schema cache/i.test(error?.message ?? '')
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options)
  const ct = res.headers.get('content-type') || ''
  if (!res.ok || ct.includes('text/html')) {
    const detalhe = ct.includes('application/json')
      ? await res.json().catch(() => null) as { error?: string } | null
      : null
    throw new Error(detalhe?.error || (ct.includes('text/html') ? 'API Express não disponível' : `Erro HTTP ${res.status}`))
  }
  return res.json()
}

export const matApi = {
  async listarMateriais(): Promise<MatMaterial[]> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('materiais')
        .select('id, nome, categoria, descricao, observacoes, foto_thumb, quantidade, created_at')
        .order('id', { ascending: true })
      if (error) sbErr(error, 'listarMateriais')
      return (data ?? []) as MatMaterial[]
    }
    return apiFetch<MatMaterial[]>('/api/materiais')
  },

  async buscarMaterial(id: string): Promise<MatMaterial> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('materiais')
        .select('*')
        .eq('id', id)
        .single()
      if (error) sbErr(error, 'buscarMaterial')
      return data as MatMaterial
    }
    return apiFetch<MatMaterial>(`/api/materiais/${encodeURIComponent(id)}`)
  },

  async criarMaterial(material: {
    id: string
    nome: string
    categoria?: 'escritorio' | 'ferramental'
    descricao?: string | null
    observacoes?: string | null
    foto_thumb?: string | null
    foto?: string | null
    foto_placa?: string | null
    quantidade?: number
  }): Promise<MatMaterial> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('materiais')
        .insert(material)
        .select()
        .single()
      if (error) {
        if (error.code === '23505') {
          const e = new Error(`Já existe um material com código "${material.id}".`) as Error & { status: number }
          e.status = 409
          throw e
        }
        sbErr(error, 'criarMaterial')
      }
      wsSend({ tipo: 'materiais_atualizados' })
      return data as MatMaterial
    }
    return apiFetch<MatMaterial>('/api/materiais', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(material),
    })
  },

  async atualizarMaterial(
    id: string,
    campos: Partial<{
      nome: string
      categoria: 'escritorio' | 'ferramental'
      descricao: string | null
      observacoes: string | null
      foto_thumb: string | null
      foto: string | null
      foto_placa: string | null
      quantidade: number
    }>
  ): Promise<MatMaterial> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('materiais')
        .update(campos)
        .eq('id', id)
        .select()
        .single()
      if (error) sbErr(error, 'atualizarMaterial')
      wsSend({ tipo: 'materiais_atualizados' })
      return data as MatMaterial
    }
    return apiFetch<MatMaterial>(`/api/materiais/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campos),
    })
  },

  async excluirMaterial(id: string): Promise<void> {
    if (supabaseDisponivel) {
      const { error } = await supabase.from('materiais').delete().eq('id', id)
      if (error) sbErr(error, 'excluirMaterial')
      wsSend({ tipo: 'materiais_atualizados' })
      return
    }
    await apiFetch<unknown>(`/api/materiais/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async listarChecklistsFerramenta(ferramentaId: string): Promise<MatChecklistFerramenta[]> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('checklists_ferramental')
        .select('id,ferramenta_id,quantidade_cadastrada,quantidade_conferida,condicao,item_faltante,justificativa,realizado_por,data_checklist,created_at')
        .eq('ferramenta_id', ferramentaId)
        .order('data_checklist', { ascending: false })
      if (error) sbErr(error, 'listarChecklistsFerramenta')
      return (data ?? []) as MatChecklistFerramenta[]
    }
    return apiFetch<MatChecklistFerramenta[]>(
      `/api/ferramentas/${encodeURIComponent(ferramentaId)}/checklists`,
    )
  },

  async criarChecklistFerramenta(checklist: {
    ferramenta_id: string
    ferramenta_nome?: string
    quantidade_cadastrada: number
    quantidade_conferida: number
    condicao: 'boa' | 'media' | 'ruim' | 'quantidade'
    item_faltante?: string | null
    justificativa?: string | null
    realizado_por?: string | null
    data_checklist?: string
  }): Promise<MatChecklistFerramenta> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('checklists_ferramental')
        .insert(checklist)
        .select()
        .single()
      if (error) sbErr(error, 'criarChecklistFerramenta')
      return data as MatChecklistFerramenta
    }
    return apiFetch<MatChecklistFerramenta>('/api/ferramentas/checklists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checklist),
    })
  },

  async listarEmprestimos(): Promise<MatEmprestimo[]> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('emprestimos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) sbErr(error, 'listarEmprestimos')
      return (data ?? []) as MatEmprestimo[]
    }
    return apiFetch<MatEmprestimo[]>('/api/emprestimos')
  },

  async criarEmprestimo(emp: {
    material_id: string
    material_codigo: string
    material_nome: string
    responsavel: string
    cpf?: string | null
    secretaria?: string | null
    prazo_dias: number
    quantidade?: number
    data_devolucao_prevista?: string | null
    condicao_equipamento?: string | null
    observacoes?: string | null
    agente_emprestador?: string | null
    assinatura_data?: string | null
    tipo: 'emprestimo' | 'manutencao'
  }): Promise<MatEmprestimo> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('emprestimos')
        .insert({ ...emp, data_emprestimo: new Date().toISOString() })
        .select()
        .single()
      if (error) sbErr(error, 'criarEmprestimo')
      return data as MatEmprestimo
    }
    return apiFetch<MatEmprestimo>('/api/emprestimos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emp),
    })
  },

  async registrarDevolucao(
    id: number,
    campos: {
      devolvido_em: string
      devolvido_obs?: string | null
      devolvido_recebedor: string
      devolvido_foto?: string | null
    }
  ): Promise<MatEmprestimo> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('emprestimos')
        .update(campos)
        .eq('id', id)
        .select()
        .single()
      if (error) sbErr(error, 'registrarDevolucao')
      return data as MatEmprestimo
    }
    return apiFetch<MatEmprestimo>(`/api/emprestimos/${id}/devolver`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campos),
    })
  },

  async listarCampo(): Promise<MatEquipamentoCampo[]> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('equipamentos_campo')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) sbErr(error, 'listarCampo')
      return (data ?? []) as MatEquipamentoCampo[]
    }
    return apiFetch<MatEquipamentoCampo[]>('/api/equipamentos-campo')
  },

  async criarCampo(campo: {
    material_id: string
    material_nome: string
    fotos?: string[] | null
    latitude?: number | null
    longitude?: number | null
    rua?: string | null
    numero?: string | null
    bairro?: string | null
    observacao?: string | null
    quantidade?: number
    prazo_dias?: number | null
    data_recolha_prevista?: string | null
    status: 'ativo'
    agente?: string | null
  }): Promise<MatEquipamentoCampo> {
    if (supabaseDisponivel) {
      const { data, error } = await supabase
        .from('equipamentos_campo')
        .insert(campo)
        .select()
        .single()
      if (error) sbErr(error, 'criarCampo')
      return data as MatEquipamentoCampo
    }
    return apiFetch<MatEquipamentoCampo>('/api/equipamentos-campo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campo),
    })
  },

  async devolverCampo(id: number): Promise<void> {
    if (supabaseDisponivel) {
      const { error } = await supabase
        .from('equipamentos_campo')
        .update({ status: 'devolvido' })
        .eq('id', id)
      if (error) sbErr(error, 'devolverCampo')
      return
    }
    await apiFetch<unknown>(`/api/equipamentos-campo/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'devolvido' }),
    })
  },

  async atualizarGpsCampo(id: number, latitude: number | null, longitude: number | null): Promise<void> {
    if (supabaseDisponivel) {
      const { error } = await supabase
        .from('equipamentos_campo')
        .update({ latitude, longitude })
        .eq('id', id)
      if (error) sbErr(error, 'atualizarGpsCampo')
      return
    }
    await apiFetch<unknown>(`/api/equipamentos-campo/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude, longitude }),
    })
  },

  async excluirCampo(id: number): Promise<void> {
    if (supabaseDisponivel) {
      const { error } = await supabase.from('equipamentos_campo').delete().eq('id', id)
      if (error) sbErr(error, 'excluirCampo')
      return
    }
    await apiFetch<unknown>(`/api/equipamentos-campo/${id}`, { method: 'DELETE' })
  },
}
