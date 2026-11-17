import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  APP_REDIRECT, RATE, allowsPasswordChange, amrMethods, buildAccountList, callerIsAdmin,
  callerMayUseApp, generateTempPassword, metadataForUpdate, passwordError, publicPasswordFailure,
  recoveryFromHash, recoveryRedirect, responseBody, takeSlot, toPublicAccount, validEmail,
} from './password.js';

const admin = {
  userId: '11111111-1111-1111-1111-111111111111',
  email: 'mgr@noblewandd.com',
  profile: { id: '11111111-1111-1111-1111-111111111111', email: 'mgr@noblewandd.com', role: 'admin' },
  allowRow: { email: 'mgr@noblewandd.com', role: 'admin', revoked_at: null },
};

test('admin matches the allowlist and the profile', () => {
  assert.equal(callerIsAdmin(admin), true);
  assert.equal(callerIsAdmin({ ...admin, profile: { ...admin.profile, role: 'sales' } }), false);
  assert.equal(callerIsAdmin({ ...admin, allowRow: { ...admin.allowRow, role: 'sales' } }), false);
  assert.equal(callerIsAdmin({ ...admin, allowRow: { ...admin.allowRow, revoked_at: '2026-01-01' } }), false);
  assert.equal(callerIsAdmin({ ...admin, email: 'eric@noblewandd.com' }), false);
  assert.equal(callerIsAdmin({ ...admin, userId: '22222222-2222-2222-2222-222222222222' }), false);
  assert.equal(callerMayUseApp({ ...admin, profile: { ...admin.profile, role: 'sales' }, allowRow: { ...admin.allowRow, role: 'sales' } }), true);
  assert.equal(callerIsAdmin({ ...admin, profile: { ...admin.profile, role: 'sales' }, allowRow: { ...admin.allowRow, role: 'sales' } }), false);
});

test('password rules meet an 8 character mixed Supabase policy', () => {
  assert.match(passwordError('Ab1!'), /8/);
  assert.match(passwordError('alllowercase1!'), /uppercase/);
  assert.match(passwordError('ALLUPPERCASE1!'), /lowercase/);
  assert.match(passwordError('NoDigits!!'), /number/);
  assert.match(passwordError('NoSymbol1a'), /symbol/);
  assert.equal(passwordError('GoodPass1!'), '');
  assert.equal(validEmail('alex@example.com'), true);
  assert.equal(validEmail('not an email'), false);
});

test('generated passwords pass the rules and are not reused by a fixed roller', () => {
  let n = 0;
  const seq = () => {
    n += 1;
    return (n % 97) / 97;
  };
  const a = generateTempPassword(seq);
  const b = generateTempPassword(seq);
  assert.equal(passwordError(a), '');
  assert.equal(passwordError(b), '');
  assert.equal(a.length, 16);
  assert.notEqual(a, b);
  for (let i = 0; i < 20; i++) assert.equal(passwordError(generateTempPassword()), '');
});

test('reset links only return to this app', () => {
  assert.equal(recoveryRedirect('https://evil.example/steal'), APP_REDIRECT);
  assert.equal(recoveryRedirect('https://noblenick4001.github.io/Noble-Windows-and-Doors-/index.html'), APP_REDIRECT);
  assert.equal(recoveryRedirect('http://localhost:8080/index.html?x=1#/accounts'), 'http://localhost:8080/');
  assert.equal(recoveryRedirect(''), APP_REDIRECT);
});

test('recovery hash is recognized and app routes are not', () => {
  assert.equal(recoveryFromHash('#/accounts'), null);
  assert.equal(recoveryFromHash('#access_token=abc&type=signup'), null);
  const hit = recoveryFromHash('#access_token=' + 'a'.repeat(24) + '&refresh_token=' + 'b'.repeat(12) + '&type=recovery');
  assert.equal(hit.access_token, 'a'.repeat(24));
  assert.equal(hit.refresh_token, 'b'.repeat(12));
});

test('only a temporary-password flag or a recovery session can set a new password', () => {
  assert.equal(allowsPasswordChange(true, ['password']), true);
  assert.equal(allowsPasswordChange(false, ['password']), false);
  assert.equal(allowsPasswordChange(false, ['recovery']), true);
  const header = 'Bearer aaa.' + Buffer.from(JSON.stringify({ amr: [{ method: 'recovery' }] })).toString('base64url') + '.ccc';
  assert.deepEqual(amrMethods(header), ['recovery']);
  assert.deepEqual(amrMethods('not-a-jwt'), []);
});

test('account list drops hashes, tokens, and existing passwords', () => {
  const secret = 'existing-password-should-not-leak';
  const people = buildAccountList({
    allowed: [
      { email: 'Alex@Example.com', full_name: 'Alex Rivera', role: 'sales', revoked_at: null, created_at: '2026-03-01' },
      { email: 'new@example.com', full_name: 'New Rep', role: 'sales', revoked_at: null, created_at: '2026-10-01' },
    ],
    profiles: [{ email: 'alex@example.com', full_name: 'Wrong', role: 'admin', created_at: '2026-01-01' }],
    authUsers: [{
      email: 'alex@example.com',
      created_at: '2026-03-12',
      last_sign_in_at: '2026-11-01',
      encrypted_password: '$2a$10$should-not-appear',
      recovery_token: 'token-should-not-appear',
      password: secret,
      app_metadata: { provider: 'email', must_change_password: true, password: secret },
    }],
  });
  const blob = JSON.stringify(people);
  assert.equal(blob.includes(secret), false);
  assert.equal(blob.includes('should-not-appear'), false);
  assert.equal(blob.includes('encrypted_password'), false);
  assert.equal(people.length, 2);
  assert.equal(people[0].email, 'alex@example.com');
  assert.equal(people[0].full_name, 'Alex Rivera');
  assert.equal(people[0].role, 'sales');
  assert.equal(people[0].created_at, '2026-03-12');
  assert.equal(people[0].must_change_password, true);
  assert.equal(people[1].signed_up, false);
  assert.equal(people[1].last_sign_in_at, null);
  const shaped = toPublicAccount({ ...people[0], encrypted_password: 'nope', password: secret });
  assert.equal(JSON.stringify(shaped).includes(secret), false);
  assert.equal(Object.hasOwn(shaped, 'encrypted_password'), false);
});

test('responses keep a new temporary password once and drop everything else secret', () => {
  const body = responseBody(200, {
    ok: true,
    temporaryPassword: 'GoodPass1!',
    password: 'GoodPass1!',
    encrypted_password: 'hash',
    people: [{ email: 'a@example.com', full_name: 'A', role: 'sales', password: 'hidden' }],
  });
  assert.equal(body.temporaryPassword, 'GoodPass1!');
  assert.equal(body.password, undefined);
  assert.equal(body.encrypted_password, undefined);
  assert.equal(JSON.stringify(body.people).includes('hidden'), false);
  assert.equal(responseBody(400, { temporaryPassword: 'GoodPass1!', error: 'no' }).temporaryPassword, undefined);
});

test('metadata updates the flag and does not copy a password field', () => {
  const next = metadataForUpdate({ provider: 'email', providers: ['email'], password: 'nope', must_change_password: false }, true);
  assert.equal(next.provider, 'email');
  assert.deepEqual(next.providers, ['email']);
  assert.equal(next.password, undefined);
  assert.equal(next.must_change_password, true);
  assert.equal(metadataForUpdate(null, false).must_change_password, false);
});

test('failure text never echoes the password', () => {
  const password = 'GoodPass1!';
  assert.equal(publicPasswordFailure('Password is known to be leaked', password).includes(password), false);
  assert.match(publicPasswordFailure('Password should be at least 6 characters'), /8 or more/);
  assert.equal(publicPasswordFailure('GoodPass1! was rejected', password), 'Could not update the password.');
});

test('rate limit blocks the next call in the window', () => {
  const buckets = new Map();
  const now = 1_000_000;
  for (let i = 0; i < RATE.set_temp.limit; i++) assert.equal(takeSlot(buckets, 'user:set_temp', RATE.set_temp.limit, RATE.set_temp.windowMs, now), true);
  assert.equal(takeSlot(buckets, 'user:set_temp', RATE.set_temp.limit, RATE.set_temp.windowMs, now + 1), false);
  assert.equal(takeSlot(buckets, 'user:set_temp', RATE.set_temp.limit, RATE.set_temp.windowMs, now + RATE.set_temp.windowMs), true);
});

test('the function reads the service role from the environment and does not log passwords', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(src, /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/);
  assert.equal(src.includes('eyJ'), false);
  assert.equal(src.includes('console.log'), false);
  assert.equal(src.includes('encrypted_password'), false);
  assert.match(src, /responseBody/);
  assert.match(src, /must_change_password/);
  const migration = readFileSync(new URL('../../migrations/004_admin_auth_audit.sql', import.meta.url), 'utf8');
  assert.match(migration, /enable row level security/);
  const table = migration.slice(migration.indexOf('create table'), migration.indexOf(');') + 2);
  assert.equal(/password|token|hash|secret/i.test(table), false);
});
