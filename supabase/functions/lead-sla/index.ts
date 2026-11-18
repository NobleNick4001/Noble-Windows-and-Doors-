// Texts admins once when a lead's business-hours call deadline has passed.
// JWT is off. Callers must send x-cron-secret matching CRON_SECRET.
// This function never texts a customer.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { secretMatches } from '../_shared/assistant.js';
import { quoEnv } from '../_shared/quo.js';
import { textOverdueAdmins } from '../hubspot-sync/leads.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });
  if (!secretMatches(Deno.env.get('CRON_SECRET') ?? '', req.headers.get('x-cron-secret'))) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceKey) return json(500, { ok: false, error: 'Supabase service role is not available' });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const result = await textOverdueAdmins({ admin, env: quoEnv((key) => Deno.env.get(key) ?? '') });
  return json(result.ok ? 200 : 500, result);
});
