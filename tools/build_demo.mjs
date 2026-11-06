// Writes a self-contained offline demo into ./demo-dist/. No dependencies.
// Does not change the live app or its service worker.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'demo-dist');
const banner = 'DEMO - fake data, no real invoices';

rmSync(out, { recursive: true, force: true });
for (const rel of ['css', 'js', 'data', 'assets']) {
  cpSync(join(root, rel), join(out, rel), { recursive: true });
}
cpSync(join(root, 'manifest.webmanifest'), join(out, 'manifest.webmanifest'));
mkdirSync(join(out, 'supabase/functions/quickbooks-invoice'), { recursive: true });
cpSync(
  join(root, 'supabase/functions/quickbooks-invoice/invoice.js'),
  join(out, 'supabase/functions/quickbooks-invoice/invoice.js'),
);
cpSync(join(root, 'tools/demo_cloud.js'), join(out, 'js/cloud.js'));

const appPath = join(out, 'js/app.js');
const app = readFileSync(appPath, 'utf8').replace(
  /\s*if \('serviceWorker' in navigator\) navigator\.serviceWorker\.register\('sw\.js'\)\.catch\(\(\) => \{\}\);/,
  '\n  // Offline demo: do not register a service worker.',
);
writeFileSync(appPath, app);

const cssPath = join(out, 'css/styles.css');
writeFileSync(cssPath, readFileSync(cssPath, 'utf8') + `
#demo-banner{position:fixed;top:0;left:0;right:0;z-index:80;background:#f15a22;color:#14171a;text-align:center;font-weight:800;letter-spacing:.01em;padding:.45rem .7rem;padding-top:calc(.45rem + env(safe-area-inset-top));border-bottom:3px solid #14171a}
body{padding-top:calc(2.35rem + env(safe-area-inset-top))}
.top{top:calc(2.35rem + env(safe-area-inset-top))}
`);

let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace('<title>Noble Windows & Doors — Sales</title>', '<title>Noble Sales Demo</title>');
html = html.replace('content="Noble Sales"', 'content="Noble Demo"');
html = html.replace(
  '<body class="auth-locked">',
  `<body class="auth-locked">\n<div id="demo-banner">${banner}</div>`,
);
writeFileSync(join(out, 'index.html'), html);

const manifest = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8'));
manifest.name = 'Noble Sales Demo';
manifest.short_name = 'Noble Demo';
manifest.description = 'Offline demo with fake customers. No sign-in and no live invoices.';
manifest.start_url = './index.html#/saved';
writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<link rel="stylesheet" href="css/styles.css">
</head>
<body>
<div id="demo-banner">${banner}</div>
<main class="page"><div class="card">
<h1>${title}</h1>
${body}
<p><a class="btn primary" href="index.html#/saved">Back to the demo</a></p>
</div></main>
</body>
</html>
`;

writeFileSync(join(out, 'demo-pay.html'), page(
  'Demo pay page',
  `<p id="demo-pay-note">This is a local demo page. No card is charged and no invoice is sent.</p>
<p class="fine" id="demo-pay-invoice"></p>
<script>
const id = new URLSearchParams(location.search).get('invoice') || '';
const el = document.getElementById('demo-pay-invoice');
if (el) el.textContent = id ? ('Invoice ' + id) : 'No invoice id was on the link.';
</script>`,
));

writeFileSync(join(out, 'demo-connect.html'), page(
  'Demo QuickBooks',
  `<p id="qbo-company"><b>QuickBooks company: Demo Windows &amp; Doors</b></p>
<p>This demo did not contact a live company. Disconnect and connect again from Admin to try that screen.</p>`,
));

console.log('Wrote ' + out);
