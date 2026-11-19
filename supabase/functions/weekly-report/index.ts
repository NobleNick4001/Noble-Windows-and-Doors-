// Monday report for the prior Phoenix week. JWT is off.
// Callers must send header x-cron-secret matching the CRON_SECRET env var.
// The message goes to WEEKLY_REPORT_TO and WEEKLY_REPORT_CC. It never emails a customer.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildWeeklyHtml, buildWeeklyReport, hubspotAppointmentRows, reportReps, secretMatches, weekRange, weeklyRecipients, weeklySubject,
} from '../_shared/assistant.js';
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

async function hubspot(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch('https://api.hubapi.com' + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(body?.message || body?.raw || res.statusText);
  return body;
}

async function ingestMeetings(admin: any, token: string, week: { start: Date; end: Date }, profiles: any[]) {
  if (!token) return { ingested: 0, skipped: 0, error: '' };
  const meetings: any[] = [];
  let after = '';
  try {
    for (let page = 0; page < 5; page += 1) {
      const body: Record<string, unknown> = {
        filterGroups: [{
          filters: [
            { propertyName: 'hs_meeting_start_time', operator: 'GTE', value: week.start.toISOString() },
            { propertyName: 'hs_meeting_start_time', operator: 'LT', value: week.end.toISOString() },
          ],
        }],
        properties: ['hs_meeting_start_time', 'hubspot_owner_id', 'hs_meeting_title'],
        limit: 100,
      };
      if (after) body.after = after;
      const found = await hubspot(token, '/crm/v3/objects/meetings/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      meetings.push(...(found?.results || []));
      after = found?.paging?.next?.after || '';
      if (!after) break;
    }
  } catch (err) {
    return { ingested: 0, skipped: 0, error: err instanceof Error ? err.message : 'HubSpot meetings were not read' };
  }
  const planned = hubspotAppointmentRows(meetings, profiles);
  for (const row of planned.rows) {
    const { error } = await admin.from('appointments').upsert(row, { onConflict: 'hubspot_meeting_id' });
    if (error) return { ingested: planned.rows.length, skipped: planned.skipped.length, error: error.message };
  }
  return { ingested: planned.rows.length, skipped: planned.skipped.length, error: '' };
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
  const week = weekRange(new Date());
  const { data: profiles, error: profileErr } = await admin.from('profiles').select('id, email, full_name, role, hubspot_owner_id');
  if (profileErr) return json(500, { ok: false, error: profileErr.message });

  const ingest = await ingestMeetings(admin, Deno.env.get('HUBSPOT_TOKEN') ?? '', week, profiles || []);
  const [estimates, followUps, appointments, activity, leads] = await Promise.all([
    admin.from('estimates').select('id, owner_id, customer_name, status, total_amount, presented_at, signed_at, lost_at, updated_at, created_at, deleted_at'),
    admin.from('follow_ups').select('id, estimate_id, owner_id, due_at, status, completed_at, created_at, updated_at'),
    admin.from('appointments').select('id, estimate_id, owner_id, set_at, source, created_at'),
    admin.from('assistant_audit').select('estimate_id, created_at'),
    admin.from('leads').select('id, owner_id, stage, estimate_id, hubspot_contact_id, hubspot_deal_id').eq('stage', 'invalid').is('deleted_at', null),
  ]);
  const readErr = estimates.error || followUps.error || appointments.error || activity.error || leads.error;
  if (readErr) return json(500, { ok: false, error: readErr.message });

  const reps = reportReps(profiles || [], estimates.data || [], followUps.data || [], appointments.data || []);
  const report = buildWeeklyReport({
    reps,
    estimates: estimates.data || [],
    followUps: followUps.data || [],
    appointments: appointments.data || [],
    activity: activity.data || [],
    leads: leads.data || [],
  }, week);
  const recipients = weeklyRecipients({
    WEEKLY_REPORT_TO: Deno.env.get('WEEKLY_REPORT_TO') ?? '',
    WEEKLY_REPORT_CC: Deno.env.get('WEEKLY_REPORT_CC') ?? '',
  });
  try {
    const sent = await sendHtml({
      env: mailEnv((key) => Deno.env.get(key) ?? ''),
      to: recipients.to,
      cc: recipients.cc,
      subject: weeklySubject(week),
      html: buildWeeklyHtml(report),
    });
    await admin.from('assistant_audit').insert({
      action: 'report.sent',
      detail: { to: recipients.to, cc: recipients.cc, week: week.start.toISOString(), provider: sent.provider },
    });
    return json(200, { ok: true, to: recipients.to, cc: recipients.cc, ingest });
  } catch (err) {
    return json(502, { ok: false, error: err instanceof Error ? err.message : 'Email failed', ingest });
  }
});
