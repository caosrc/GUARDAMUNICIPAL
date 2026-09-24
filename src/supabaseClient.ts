import { createClient } from '@supabase/supabase-js'

type DisabledSupabaseClient = {
  from: (...args: unknown[]) => any
  channel: (...args: unknown[]) => any
  removeChannel: (...args: unknown[]) => any
  functions: { invoke: (...args: unknown[]) => any }
}

const supabaseDisabled = (): never => {
  throw new Error('Supabase está desativado nesta cópia do aplicativo.')
}

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
const usarSupabase = String(import.meta.env.VITE_USE_SUPABASE || '').toLowerCase() === 'true'

// O build do Netlify injeta essas variáveis VITE_* no frontend. No Replit,
// quando elas não existem, o app continua usando o servidor Express local.
export const supabaseDisponivel = usarSupabase && Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = supabaseDisponivel
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : ({
      from: supabaseDisabled,
      channel: supabaseDisabled,
      removeChannel: supabaseDisabled,
      functions: { invoke: supabaseDisabled },
    } as DisabledSupabaseClient)
