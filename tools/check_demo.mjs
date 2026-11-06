// Builds the offline demo and checks it does not call live services.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'demo-dist');
const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };

const build = spawnSync(process.execPath, ['tools/build_demo.mjs'], { cwd: root, encoding: 'utf8' });
if (build.stdout) process.stdout.write(build.stdout);
if (build.status !== 0) {
  if (build.stderr) process.stderr.write(build.stderr);
  console.error('demo build failed');
  process.exit(1);
}

const textExt = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.mjs', '.txt']);
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

const files = walk(out);
let banner = false;
const banned = [
  [/supabase\.co/i, 'supabase.co'],
  [/intuit\.com/i, 'intuit.com'],
  [/hubspot\.com/i, 'hubspot.com'],
  [/hubapi\.com/i, 'hubapi.com'],
  [/https?:\/\/[^'"\s]*hubspot/i, 'hubspot'],
];
for (const path of files) {
  const ext = path.slice(path.lastIndexOf('.'));
  if (!textExt.has(ext)) continue;
  const text = readFileSync(path, 'utf8');
  if (text.includes('DEMO - fake data, no real invoices')) banner = true;
  for (const [re, label] of banned) {
    if (re.test(text)) fail(relative(out, path) + ' mentions ' + label);
  }
}
if (!banner) fail('demo banner is missing');
const app = readFileSync(join(out, 'js/app.js'), 'utf8');
if (/serviceWorker\.register/.test(app)) fail('demo registers a service worker');
const cloud = readFileSync(join(out, 'js/cloud.js'), 'utf8');
for (const needle of ['enableCardPayment', 'refreshQboPayment', 'recordOfflineDeposit', 'buildInvoice', 'demo-pay.html']) {
  if (!cloud.includes(needle)) fail('demo cloud is missing ' + needle);
}
if (!files.some((path) => path.endsWith('demo-pay.html'))) fail('local pay page is missing');

if (process.exitCode) console.error('demo check failed');
else console.log('demo check ok');
