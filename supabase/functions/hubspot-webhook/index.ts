// Optional HubSpot webhook. JWT is off. Every request must pass signature v3
// using HUBSPOT_CLIENT_SECRET. A bad signature is rejected and nothing is written.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hubspotSignatureOk } from '../_shared/hubspot-sign.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const raw = await req.text();
  const url = new URL(req.url);
  const ok = await hubspotSignatureOk({
    method: req.method,
    uri: url.href,
    body: raw,
    timestamp: req.headers.get('x-hubspot-request-timestamp'),
    signature: req.headers.get('x-hubspot-signature-v3'),
    secret: Deno.env.get('HUBSPOT_CLIENT_SECRET') ?? '',
  });
  if (!ok) return new Response('Unauthorized', { status: 401 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return new Response('Supabase service role is not available', { status: 500 });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let events = [];
  try { events = JSON.parse(raw); } catch { events = []; }
  const count = Array.isArray(events) ? events.length : 0;
  await admin.from('assistant_audit').insert({
    action: 'hubspot.webhook',
    detail: { count, accepted: true },
  });
  return Response.json({ ok: true, count });
});
