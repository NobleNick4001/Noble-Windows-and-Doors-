// Shared by the browser and the account-passwords edge function.
// No secrets, no Deno-only APIs, and no password storage.

export const APP_REDIRECT = 'https://noblenick4001.github.io/Noble-Windows-and-Doors-/';
export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_HINT = 'At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a symbol.';

const SYMBOLS = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '!@#$%^&*';
const RECOVERY_METHODS = new Set(['recovery', 'otp', 'magiclink', 'invite']);

export const RATE = {
  all: { limit: 40, windowMs: 10 * 60 * 1000 },
  list: { limit: 30, windowMs: 10 * 60 * 1000 },
  send_reset: { limit: 8, windowMs: 10 * 60 * 1000 },
  set_temp: { limit: 8, windowMs: 10 * 60 * 1000 },
  complete_change: { limit: 8, windowMs: 10 * 60 * 1000 },
  hourlyActor: 12,
  hourlyTarget: 5,
};

export function validEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim().toLowerCase());
}

export function passwordError(password) {
  const value = String(password ?? '');
  if (value.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (value.length > 72) return 'Use at most 72 characters.';
  if (!/[a-z]/.test(value)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Include an uppercase letter.';
  if (!/[0-9]/.test(value)) return 'Include a number.';
  if (!SYMBOLS.test(value)) return 'Include a symbol such as ! or #.';
  return '';
}

function randomIndex(length, random) {
  const roll = random();
  const n = Math.floor(roll * length);
  return n >= length ? length - 1 : n;
}

export function generateTempPassword(random = cryptoRandom) {
  const pick = (set) => set[randomIndex(set.length, random)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  const all = LOWER + UPPER + DIGIT + SYMBOL;
  while (chars.length < 16) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    const swap = chars[i];
    chars[i] = chars[j];
    chars[j] = swap;
  }
  return chars.join('');
}

function cryptoRandom() {
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  return Math.random();
}

export function recoveryRedirect(requested) {
  let url;
  try { url = new URL(String(requested || '')); } catch { return APP_REDIRECT; }
  if (url.origin === 'https://noblenick4001.github.io' && url.pathname.startsWith('/Noble-Windows-and-Doors-')) {
    return APP_REDIRECT;
  }
  if (url.origin === 'http://localhost:8080' || url.origin === 'http://127.0.0.1:8080') return url.origin + '/';
  return APP_REDIRECT;
}

export function recoveryFromHash(hash) {
  const body = String(hash || '').replace(/^#/, '');
  if (!body || body.startsWith('/')) return null;
  const params = new URLSearchParams(body);
  if (params.get('type') !== 'recovery') return null;
  const access_token = params.get('access_token') || '';
  const refresh_token = params.get('refresh_token') || '';
  if (access_token.length < 20 || refresh_token.length < 10) return null;
  return { access_token, refresh_token };
}

export function amrMethods(header) {
  const token = String(header || '').replace(/^Bearer\s+/i, '').trim();
  const part = token.split('.')[1];
  if (!part) return [];
  try {
    const pad = part.length % 4 === 0 ? '' : '='.repeat(4 - (part.length % 4));
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + pad));
    if (!Array.isArray(json.amr)) return [];
    return json.amr.map((item) => (typeof item === 'string' ? item : item && item.method)).filter((m) => typeof m === 'string');
  } catch {
    return [];
  }
}

export function allowsPasswordChange(mustChange, methods) {
  if (mustChange === true) return true;
  return (methods || []).some((method) => RECOVERY_METHODS.has(method));
}

export function callerMayUseApp({ userId, email, profile, allowRow }) {
  const address = String(email || '').trim().toLowerCase();
  if (!userId || !address || !profile || !allowRow) return false;
  if (String(profile.id || '') !== String(userId)) return false;
  if (String(profile.email || '').trim().toLowerCase() !== address) return false;
  if (String(allowRow.email || '').trim().toLowerCase() !== address) return false;
  if (allowRow.revoked_at) return false;
  if (profile.role !== 'admin' && profile.role !== 'sales') return false;
  if (allowRow.role !== 'admin' && allowRow.role !== 'sales') return false;
  return true;
}

export function callerIsAdmin(args) {
  return callerMayUseApp(args) && args.profile.role === 'admin' && args.allowRow.role === 'admin';
}

export function takeSlot(buckets, key, limit, windowMs, now = Date.now()) {
  const prev = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (prev.length >= limit) {
    buckets.set(key, prev);
    return false;
  }
  prev.push(now);
  buckets.set(key, prev);
  return true;
}

export function metadataForUpdate(current, mustChange) {
  const next = {};
  const src = current && typeof current === 'object' ? current : {};
  for (const [key, value] of Object.entries(src)) {
    if (/password|token|hash|secret|encrypted/i.test(key)) continue;
    next[key] = value;
  }
  next.must_change_password = mustChange === true;
  return next;
}

export function publicPasswordFailure(message, password) {
  const raw = String(message || '');
  let out = 'Could not update the password.';
  if (/pwned|leaked|known password|hibp/i.test(raw)) out = 'That password is too easy to guess. Choose a different one.';
  else if (/weak|short|length|character|symbol|uppercase|lowercase|digit|number/i.test(raw)) {
    out = 'That password does not meet the sign-in rules. Use 8 or more characters with upper and lower case, a number, and a symbol.';
  }
  if (password && out.includes(password)) return 'Could not update the password.';
  return out;
}

const PUBLIC_KEYS = ['email', 'full_name', 'role', 'created_at', 'last_sign_in_at', 'signed_up', 'revoked', 'must_change_password', 'on_list'];

export function toPublicAccount(row) {
  const email = String(row?.email || '').trim().toLowerCase();
  const out = {
    email,
    full_name: String(row?.full_name || '').trim(),
    role: row?.role === 'admin' ? 'admin' : 'sales',
    created_at: row?.created_at || null,
    last_sign_in_at: row?.last_sign_in_at || null,
    signed_up: row?.signed_up === true,
    revoked: row?.revoked === true,
    must_change_password: row?.must_change_password === true,
    on_list: row?.on_list === true,
  };
  for (const key of Object.keys(out)) {
    if (!PUBLIC_KEYS.includes(key)) delete out[key];
  }
  return out;
}

export function buildAccountList({ allowed = [], profiles = [], authUsers = [] } = {}) {
  const authByEmail = new Map();
  for (const user of authUsers) {
    const email = String(user?.email || '').trim().toLowerCase();
    if (!email) continue;
    authByEmail.set(email, {
      created_at: user.created_at || null,
      last_sign_in_at: user.last_sign_in_at || null,
      must_change_password: user?.app_metadata?.must_change_password === true,
    });
  }
  const profileByEmail = new Map();
  for (const row of profiles) {
    const email = String(row?.email || '').trim().toLowerCase();
    if (email) profileByEmail.set(email, row);
  }
  const seen = new Set();
  const rows = [];
  const push = (email, allow) => {
    if (!email || seen.has(email)) return;
    seen.add(email);
    const profile = profileByEmail.get(email);
    const auth = authByEmail.get(email);
    const role = allow?.role === 'admin' || allow?.role === 'sales'
      ? allow.role
      : (profile?.role === 'admin' ? 'admin' : 'sales');
    rows.push(toPublicAccount({
      email,
      full_name: allow?.full_name || profile?.full_name || '',
      role,
      created_at: auth?.created_at || allow?.created_at || profile?.created_at || null,
      last_sign_in_at: auth?.last_sign_in_at || null,
      signed_up: Boolean(auth),
      revoked: Boolean(allow?.revoked_at),
      must_change_password: auth?.must_change_password === true,
      on_list: Boolean(allow),
    }));
  };
  for (const row of allowed) push(String(row?.email || '').trim().toLowerCase(), row);
  for (const email of authByEmail.keys()) push(email, null);
  rows.sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email) || a.email.localeCompare(b.email));
  return rows;
}

const RESPONSE_KEYS = new Set(['ok', 'error', 'people', 'email', 'temporaryPassword', 'signedOut']);

export function responseBody(status, body) {
  const out = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!RESPONSE_KEYS.has(key)) continue;
    if (key === 'temporaryPassword') {
      if (status === 200 && typeof value === 'string' && value) out.temporaryPassword = value;
      continue;
    }
    if (key === 'people' && Array.isArray(value)) {
      out.people = value.map((row) => toPublicAccount(row));
      continue;
    }
    if (key === 'email') {
      out.email = String(value || '').trim().toLowerCase();
      continue;
    }
    if (key === 'signedOut') {
      out.signedOut = value === true;
      continue;
    }
    if (typeof value === 'string' || value === true) out[key] = value;
  }
  return out;
}
