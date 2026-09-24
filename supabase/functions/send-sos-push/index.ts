// Supabase Edge Function — send-sos-push
// Lê push_subscriptions no Supabase e dispara Web Push para cada dispositivo,
// excluindo o dispositivo que disparou o SOS (excludeId).
//
// Segredos necessários (supabase secrets set ...):
//   VAPID_PUBLIC_KEY   → chave pública VAPID (base64url)
//   VAPID_PRIVATE_KEY  → chave privada VAPID (base64url)
//   VAPID_SUBJECT      → mailto: ou URL do projeto
//   SUPABASE_URL       → injetado automaticamente pelo Supabase
//   SUPABASE_SERVICE_ROLE_KEY → injetado automaticamente

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:defesacivil@ourobranco.mg.gov.br'

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(JSON.stringify({ error: 'VAPID keys não configuradas' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    const body = await req.json()
    const { id, agente, lat, lng, bateria, excludeId } = body

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, serviceRoleKey)

    const { data: subs, error } = await sb
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payload = JSON.stringify({
      tipo: 'sos',
      id,
      agente,
      lat: lat ?? null,
      lng: lng ?? null,
      bateria: bateria ?? null,
      timestamp: Date.now(),
    })

    const envios = (subs ?? [])
      .filter((s: any) => s.id !== excludeId)
      .map(async (s: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          )
        } catch (e: any) {
          // Subscription expirada ou inválida — remove do banco
          if (e?.statusCode === 410 || e?.statusCode === 404) {
            await sb.from('push_subscriptions').delete().eq('id', s.id).catch(() => {})
          }
        }
      })

    await Promise.allSettled(envios)

    return new Response(JSON.stringify({ ok: true, enviados: envios.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
