// Emails each rep their own due and overdue follow-ups. JWT is off.
// Callers must send header x-cron-secret matching the CRON_SECRET env var.
// This function never emails a customer.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildDigestHtml, digestPlan, digestSubject, secretMatches } from '../_shared/assistant.js';
import { mailEnv, sendHtml } from '../_shared/outbound.js';

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
  const env = mailEnv((key) => Deno.env.get(key) ?? '');
  const now = new Date();

  const [{ data: reps, error: repErr }, { data: followUps, error: fuErr }] = await Promise.all([
    admin.from('profiles').select('id, email, full_name, role'),
    admin.from('follow_ups').select('id, owner_id, estimate_id, due_at, status, estimates(customer_name, total_amount)').eq('status', 'open'),
  ]);
  if (repErr) return json(500, { ok: false, error: repErr.message });
  if (fuErr) return json(500, { ok: false, error: fuErr.message });

  const plans = digestPlan({ reps: reps || [], followUps: followUps || [], now });
  const sent: string[] = [];
  const errors: { to: string; error: string }[] = [];
  for (const plan of plans) {
    const owner = (reps || []).find((rep: any) => String(rep.email || '').trim().toLowerCase() === plan.to);
    if (!owner) continue;
    try {
      await sendHtml({
        env,
        to: plan.to,
        subject: digestSubject(now),
        html: buildDigestHtml({ repName: plan.repName, items: plan.items, now }),
      });
      sent.push(plan.to);
      await admin.from('assistant_audit').insert({
        actor_id: owner.id,
        action: 'digest.sent',
        detail: { to: plan.to, count: plan.items.length },
      });
    } catch (err) {
      errors.push({ to: plan.to, error: err instanceof Error ? err.message : 'Email failed' });
    }
  }
  return json(200, { ok: errors.length === 0, sent, errors });
});
