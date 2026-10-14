// Client quote wording: glass package, frame, and selected options. No network.
import { readFileSync } from 'node:fs';
import { data, settings, quoteLine, glassPackageName } from '../js/core.js';

const read = (name) => JSON.parse(readFileSync(new URL('../data/' + name, import.meta.url), 'utf8'));
data.rates = read('rates.json');
data.options = read('options.json');
data.frameTypes = read('frame-types.json');
const obscure = read('obscure-glass.json');
data.obscureGlass = obscure;
data.obscureGlass.patterns = obscure.sections.flatMap((s) => s.patterns || []);
settings.rateSet = 'p75';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => { if (actual !== expected) fail(`${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); };
const has = (list, needle, msg) => { if (!list.includes(needle)) fail(msg + ' — missing ' + needle); };

eq(glassPackageName({ brand: 'milgard' }), 'SunCoat Max Low-E (dual pane, argon)', 'Milgard glass');
eq(glassPackageName({ brand: 'andersen' }), 'Dual-Pane Low-E SmartSun', 'Andersen glass');
eq(glassPackageName({ brand: 'iwc' }), 'Xtreme Low-E', 'IWC glass');
eq(glassPackageName({ brand: 'iwc_window' }), 'Xtreme Low-E', 'IWC window brand');

const kitchen = quoteLine({
  label: 'Kitchen', brand: 'milgard', series: 'V300', type: 'hslider', color: 'ww',
  w: 45, h: 37.75, qty: 1, unit: 500,
  install: { frameType: 'zbar' }, options: ['screen'], addons: [],
});
eq(kitchen.title, 'Milgard V300 Horizontal Slider', 'milgard title');
eq(kitchen.location, 'Kitchen', 'location');
eq(kitchen.size, '45″ × 37¾″', 'size');
has(kitchen.details, 'White / White', 'color');
has(kitchen.details, 'Z-bar', 'z-bar');
has(kitchen.details, 'SunCoat Max Low-E (dual pane, argon)', 'milgard glass line');
has(kitchen.details, 'Screen', 'screen');
if (kitchen.details.some((d) => /tempered|obscure|grid/i.test(d))) fail('unselected glass options were invented');

const tempered = quoteLine({
  label: 'Master', brand: 'milgard', series: 'V300', type: 'vslider', color: 'bw',
  w: 36, h: 60, qty: 1, unit: 10, install: { frameType: 'nailfin' }, addons: ['tempered'], options: ['tempered'],
});
has(tempered.details, 'Nailing fin', 'nailing fin');
has(tempered.details, 'Tempered (safety) glass', 'tempered');
has(tempered.details, 'Black / White', 'two-tone color stays');

const bath = quoteLine({
  label: 'Bath', brand: 'milgard', series: 'V300', type: 'casement', color: 'ww',
  w: 24, h: 36, qty: 1, unit: 10, install: { frameType: 'block' },
  addons: ['obscure'], options: ['obscure', 'milgard-p516'],
});
has(bath.details, 'Block frame', 'block frame');
has(bath.details, 'Obscured glass (P516)', 'obscure pattern');

const andersen = quoteLine({
  label: 'Den', brand: 'andersen', series: '100', type: 'casement', color: 'ww',
  w: 30, h: 48, qty: 2, unit: 400, options: ['grids-colonial'],
});
eq(andersen.title, 'Andersen 100 Series Casement', 'andersen title');
eq(andersen.price, 800, 'qty times unit');
has(andersen.details, 'Dual-Pane Low-E SmartSun', 'andersen glass');
has(andersen.details, 'Grids (flat colonial)', 'grids');

const pdf = readFileSync(new URL('../js/pdf.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const est = readFileSync(new URL('../js/pages/estimate.js', import.meta.url), 'utf8');
for (const needle of ['QUOTE', 'Quote #', 'Sales rep', 'Description', 'ROC #364772 / #364771', '(623) 810-3460', 'summaryLines(t)']) {
  if (!pdf.includes(needle)) fail('pdf missing ' + needle);
}
for (const needle of ['QUOTE', 'quote-lines', 'quote-rep', 'btn-present-back', 'safe-top', 'ROC #364772 / #364771']) {
  if (!est.includes(needle)) fail('estimate page missing ' + needle);
}
for (const needle of ['.present-top', '.safe-top', 'padding-top:calc(.45rem + env(safe-area-inset-top))', 'env(safe-area-inset-top)) .75rem']) {
  if (!css.includes(needle)) fail('safe area css missing ' + needle);
}
const auth = readFileSync(new URL('../js/pages/auth.js', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../js/pages/contract.js', import.meta.url), 'utf8');
if (!auth.includes('safe-top')) fail('login needs the safe-area class');
if (!contract.includes('safe-top') || !contract.includes('btn-contract-back')) fail('contract back button needs the safe-area class');

if (process.exitCode) console.error('quote layout check failed');
else console.log('quote layout check ok');
