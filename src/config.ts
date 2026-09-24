export function netlifyFn(_name: string): string {
  return `/api/${_name}`
}

export const SUPABASE_CONFIGURADO = Boolean(
  String(import.meta.env.VITE_SUPABASE_URL || '').trim() &&
  String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim() &&
  String(import.meta.env.VITE_USE_SUPABASE || '').toLowerCase() === 'true',
)
