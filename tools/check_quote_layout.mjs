// Client quote wording: glass package, frame, and selected options. No network.
import { readFileSync } from 'node:fs';
import { data, settings, quoteLine, glassPackageName } from '../js/core.js';
import { ELEVATION_BOX, elevationModel } from '../js/pdf.js';

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
for (const needle of ['QUOTE', 'Quote #', 'Sales rep', 'Description', 'ROC #364772 / #364771', '(623) 810-3460', 'summaryLines(t)', 'drawElevation', 'ELEVATION_BOX']) {
  if (!pdf.includes(needle)) fail('pdf missing ' + needle);
}
if (pdf.includes('includeMaterials: false')) fail('emailed pdf should keep the window subtotal in the totals');
for (const needle of ['ESTIMATE', 'sh-compact', 'btn-present-back', 'safe-top', 'includeMaterials: false', 'compactWindowList']) {
  if (!est.includes(needle)) fail('present view missing ' + needle);
}
if (est.includes('quote-lines') || est.includes("class: 'sheet quote'") || est.includes('drawElevation')) fail('present view should stay the compact sheet, without elevations');
for (const needle of ['.present-top', '.safe-top', 'padding-top:calc(.45rem + env(safe-area-inset-top))', 'env(safe-area-inset-top)) .75rem']) {
  if (!css.includes(needle)) fail('safe area css missing ' + needle);
}
const auth = readFileSync(new URL('../js/pages/auth.js', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../js/pages/contract.js', import.meta.url), 'utf8');
if (!auth.includes('safe-top')) fail('login needs the safe-area class');
if (!contract.includes('safe-top') || !contract.includes('btn-contract-back')) fail('contract back button needs the safe-area class');

const big = elevationModel({ w: 72, h: 48, type: 'picture' });
const half = elevationModel({ w: 36, h: 24, type: 'picture' });
const tall = elevationModel({ w: 24, h: 36, type: 'vslider' });
eq(big.dw, half.dw, 'same shape shares the fixed box, ignoring inches');
eq(big.dh, half.dh, 'same shape shares the fixed height');
if (big.dw > ELEVATION_BOX.w + 0.01 || big.dh > ELEVATION_BOX.h + 0.01) fail('drawing left the fixed box');
if (Math.abs(big.dw / big.dh - 72 / 48) > 0.02) fail('72x48 should keep its aspect');
if (Math.abs(tall.dw / tall.dh - 24 / 36) > 0.02) fail('24x36 should keep its aspect');
if (!(big.dw / tall.dw < 2.5)) fail('a 72-inch window must not be scaled against a 24-inch window');
if (!(big.frameRatio < half.frameRatio * 0.7)) fail('a smaller unit needs a thicker frame in the same box');

const hung = elevationModel({ w: 36, h: 60, type: 'vslider' });
if (hung.panes.length !== 2) fail('single hung should be two sashes');
if (Math.abs(hung.panes[0].h - hung.panes[1].h) > 0.05) fail('single hung sashes should be equal');
if (hung.panes[1].op !== 'slide-up') fail('lower sash should be the slider');

const slider = elevationModel({ w: 60, h: 36, type: 'hslider' });
if (slider.panes.length !== 2 || Math.abs(slider.panes[0].w - slider.panes[1].w) > 0.05) fail('slider panels should split evenly');

const xox = elevationModel({ w: 72, h: 48, type: 'xox' });
if (xox.panes.length !== 3) fail('xox should be three panels');
if (Math.abs(xox.panes[0].w - xox.panes[1].w) > 0.05 || Math.abs(xox.panes[1].w - xox.panes[2].w) > 0.05) fail('xox panels should be equal');
if (xox.panes[0].op !== 'slide-right' || xox.panes[2].op !== 'slide-left' || xox.panes[1].op) fail('xox outers operate toward the fixed center');

const hvb = elevationModel({ w: 48, h: 60, type: 'hvb' });
if (hvb.panes.length !== 2) fail('half vent should be a picture over a vent');
if (Math.abs(hvb.panes[0].h / hvb.panes[1].h - 2) > 0.05) fail('picture should be twice the vent');
if (hvb.panes[1].op !== 'awning') fail('lower vent should swing as an awning');

const bathElev = elevationModel({ w: 24, h: 36, type: 'casement', options: ['obscure'], addons: ['obscure'] });
if (!bathElev.flags.obscure || bathElev.panes[0].op !== 'casement') fail('casement obscure flag');
const grid = elevationModel({ w: 36, h: 48, type: 'picture', options: ['grids-colonial'] });
const prairie = elevationModel({ w: 36, h: 48, type: 'picture', options: ['grids-prairie'] });
eq(grid.flags.grid, 'colonial', 'colonial grids');
eq(prairie.flags.grid, 'prairie', 'prairie grids');
if (elevationModel({ w: 30, h: 40, type: 'picture' }).flags.grid) fail('grids must not be invented');

if (process.exitCode) console.error('quote layout check failed');
else console.log('quote layout check ok');
