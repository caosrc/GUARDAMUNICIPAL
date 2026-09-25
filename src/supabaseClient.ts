type DisabledSupabaseClient = {
  from: (...args: unknown[]) => any
  channel: (...args: unknown[]) => any
  removeChannel: (...args: unknown[]) => any
  functions: { invoke: (...args: unknown[]) => any }
}

const supabaseDisabled = (): never => {
  throw new Error('Este aplicativo usa somente a API local do servidor.')
}

// Esta cópia do aplicativo é exclusivamente local e não possui conexão
// com o projeto Supabase usado por outro aplicativo.
export const supabaseDisponivel = false

export const supabase = {
  from: supabaseDisabled,
  channel: supabaseDisabled,
  removeChannel: supabaseDisabled,
  functions: { invoke: supabaseDisabled },
} as DisabledSupabaseClient
