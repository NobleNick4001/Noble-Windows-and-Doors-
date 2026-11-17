// Admin account list, reset email, and temporary password.
// SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are injected
// by Supabase when this function is deployed. Do not paste the service role key here.
// The function never reads, logs, or returns a password hash or an existing password.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  RATE, allowsPasswordChange, amrMethods, buildAccountList, callerIsAdmin, callerMayUseApp,
  metadataForUpdate, passwordError, publicPasswordFailure, recoveryRedirect, responseBody,
  takeSlot, validEmail,
} from './password.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const buckets = new Map();

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(responseBody(status, body)), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function limited(userId: string, action: string) {
  const now = Date.now();
  const all = RATE.all;
  const rule = RATE[action] || RATE.all;
  if (!takeSlot(buckets, userId + ':all', all.limit, all.windowMs, now)) return true;
  if (!takeSlot(buckets, userId + ':' + action, rule.limit, rule.windowMs, now)) return true;
  return false;
}

async function hourlyCount(admin, column: string, value: string, action: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from('admin_auth_audit')
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
    .eq('action', action)
    .gte('created_at', since);
  if (error) return null;
  return count || 0;
}

async function overHourlyLimit(admin, action: string, actorEmail: string, targetEmail: string) {
  const actorCount = await hourlyCount(admin, 'actor_email', actorEmail, action);
  if (actorCount != null && actorCount >= RATE.hourlyActor) return true;
  if (!targetEmail || action === 'complete_change') return false;
  const targetCount = await hourlyCount(admin, 'target_email', targetEmail, action);
  return targetCount != null && targetCount >= RATE.hourlyTarget;
}

async function audit(admin, row: { actorId: string; actorEmail: string; targetEmail: string; action: string }) {
  const { error } = await admin.from('admin_auth_audit').insert({
    actor_id: row.actorId,
    actor_email: row.actorEmail,
    target_email: row.targetEmail || null,
    action: row.action,
  });
  if (error) console.error('audit insert failed');
}

async function listAuthUsers(admin) {
  const users = [];
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { error };
    const batch = data?.users || [];
    for (const user of batch) {
      users.push({
        email: user.email || '',
        created_at: user.created_at || null,
        last_sign_in_at: user.last_sign_in_at || null,
        app_metadata: { must_change_password: user.app_metadata?.must_change_password === true },
      });
    }
    if (batch.length < 200) break;
  }
  return { users };
}

async function findAuthUser(admin, email: string) {
  const { data, error } = await admin.rpc('auth_user_id', { p_email: email });
  if (error || !data) return { error: error || null, user: null };
  const got = await admin.auth.admin.getUserById(data);
  if (got.error || !got.data?.user) return { error: got.error || null, user: null };
  const user = got.data.user;
  if (String(user.email || '').trim().toLowerCase() !== email) return { error: null, user: null };
  return { error: null, user };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !service) return json(500, { error: 'Account function is not configured.' });

  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.id || !userData.user.email) return json(401, { error: 'Sign in required.' });

  const callerId = userData.user.id;
  const callerEmail = userData.user.email.trim().toLowerCase();

  let action = '';
  let email = '';
  let password = '';
  let redirectTo = '';
  try {
    const text = await req.text();
    if (text.length > 8000) return json(413, { error: 'Request is too large.' });
    const body = text ? JSON.parse(text) : {};
    action = String(body.action || '');
    email = String(body.email || '').trim().toLowerCase();
    password = typeof body.password === 'string' ? body.password : '';
    redirectTo = typeof body.redirectTo === 'string' ? body.redirectTo : '';
  } catch {
    return json(400, { error: 'Request could not be read.' });
  }

  if (!['list', 'send_reset', 'set_temp', 'complete_change'].includes(action)) {
    return json(400, { error: 'Unknown action.' });
  }
  if (limited(callerId, action)) return json(429, { error: 'Too many attempts. Wait a few minutes and try again.' });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: profile, error: profileErr }, { data: allowRow, error: allowErr }] = await Promise.all([
    admin.from('profiles').select('id, email, role').eq('id', callerId).maybeSingle(),
    admin.from('allowed_users').select('email, role, revoked_at').eq('email', callerEmail).maybeSingle(),
  ]);
  if (profileErr || allowErr) return json(500, { error: 'Could not check this account.' });

  const caller = { userId: callerId, email: callerEmail, profile, allowRow };
  if (action !== 'complete_change' && !callerIsAdmin(caller)) return json(403, { error: 'Only an admin can do that.' });
  if (action === 'complete_change' && !callerMayUseApp(caller)) return json(403, { error: 'This account cannot change a password.' });

  if (action === 'list') {
    const [allowed, profiles, authUsers] = await Promise.all([
      admin.from('allowed_users').select('email, full_name, role, revoked_at, created_at'),
      admin.from('profiles').select('email, full_name, role, created_at'),
      listAuthUsers(admin),
    ]);
    if (allowed.error || profiles.error || authUsers.error) return json(500, { error: 'Could not load accounts.' });
    const people = buildAccountList({
      allowed: allowed.data || [],
      profiles: profiles.data || [],
      authUsers: authUsers.users || [],
    });
    return json(200, { ok: true, people });
  }

  if (await overHourlyLimit(admin, action, callerEmail, action === 'complete_change' ? callerEmail : email)) {
    return json(429, { error: 'Too many attempts. Wait a few minutes and try again.' });
  }

  if (action === 'complete_change') {
    const problem = passwordError(password);
    if (problem) return json(400, { error: problem });
    const got = await admin.auth.admin.getUserById(callerId);
    if (got.error || !got.data?.user) return json(500, { error: 'Could not update the password.' });
    const mustChange = got.data.user.app_metadata?.must_change_password === true;
    if (!allowsPasswordChange(mustChange, amrMethods(authHeader))) {
      return json(403, { error: 'Open the reset link or sign in with the temporary password first.' });
    }
    const updated = await admin.auth.admin.updateUserById(callerId, {
      password,
      app_metadata: metadataForUpdate(got.data.user.app_metadata, false),
    });
    const failure = updated.error ? publicPasswordFailure(updated.error.message, password) : '';
    password = '';
    if (failure) return json(400, { error: failure });
    await audit(admin, { actorId: callerId, actorEmail: callerEmail, targetEmail: callerEmail, action });
    return json(200, { ok: true });
  }

  if (!validEmail(email)) return json(400, { error: 'Email is required.' });
  if (action === 'set_temp' && email === callerEmail) return json(400, { error: 'Use a reset email for your own account.' });

  const found = await findAuthUser(admin, email);
  if (found.error) return json(500, { error: 'Could not find that account.' });
  if (!found.user) return json(404, { error: 'That person has not created an account yet.' });

  if (action === 'send_reset') {
    const redirect = recoveryRedirect(redirectTo);
    const endpoint = new URL('/auth/v1/recover', url);
    endpoint.searchParams.set('redirect_to', redirect);
    const sent = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      body: JSON.stringify({ email }),
    });
    await sent.text().catch(() => '');
    if (sent.status === 429) return json(429, { error: 'Reset emails are temporarily limited. Wait and try again.' });
    if (!sent.ok) {
      return json(502, { error: 'The reset link could not be sent. Add this site under Authentication → URL Configuration → Redirect URLs, then try again.' });
    }
    await audit(admin, { actorId: callerId, actorEmail: callerEmail, targetEmail: email, action });
    return json(200, { ok: true, email });
  }

  const problem = passwordError(password);
  if (problem) return json(400, { error: problem });
  const temporaryPassword = password;
  const updated = await admin.auth.admin.updateUserById(found.user.id, {
    password: temporaryPassword,
    app_metadata: metadataForUpdate(found.user.app_metadata, true),
  });
  password = '';
  if (updated.error) return json(400, { error: publicPasswordFailure(updated.error.message, temporaryPassword) });

  const { error: dropErr } = await admin.rpc('drop_sessions_for_email', { p_email: email });
  await audit(admin, { actorId: callerId, actorEmail: callerEmail, targetEmail: email, action });
  return json(200, {
    ok: true,
    email,
    temporaryPassword,
    signedOut: !dropErr,
  });
});
