// Signs a revoked rep out of every device. Admin JWT required.
// SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are injected
// by Supabase when this function is deployed. Do not paste the service role key here.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !service) return json(500, { error: 'Sign-out function is not configured.' });

  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.email) return json(401, { error: 'Sign in required.' });

  const callerEmail = userData.user.email.trim().toLowerCase();
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller, error: callerErr } = await admin
    .from('allowed_users')
    .select('role, revoked_at')
    .eq('email', callerEmail)
    .maybeSingle();
  if (callerErr) return json(500, { error: 'Could not check the admin account.' });
  if (!caller || caller.role !== 'admin' || caller.revoked_at) return json(403, { error: 'Only an admin can revoke access.' });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return json(400, { error: 'Email is required.' });
  if (email === callerEmail) return json(400, { error: 'You cannot revoke your own access.' });

  const { data: existing, error: readErr } = await admin
    .from('allowed_users')
    .select('email, revoked_at')
    .eq('email', email)
    .maybeSingle();
  if (readErr) return json(500, { error: 'Could not read the allowlist.' });
  if (!existing) return json(404, { error: 'That email is not on the allowlist.' });

  if (!existing.revoked_at) {
    const { error: revokeErr } = await admin
      .from('allowed_users')
      .update({ revoked_at: new Date().toISOString() })
      .eq('email', email);
    if (revokeErr) return json(500, { error: 'Could not revoke that email.' });
  }

  const { error: dropErr } = await admin.rpc('drop_sessions_for_email', { p_email: email });
  if (dropErr) return json(500, { error: 'Revoked, but sessions could not be cleared.', detail: dropErr.message });

  return json(200, { ok: true, email, signedOut: true });
});
