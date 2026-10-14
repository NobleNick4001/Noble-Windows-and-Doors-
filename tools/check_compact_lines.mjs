// Compact client lines and the Milgard frame-type warning. Run: node tools/check_compact_lines.mjs
import { readFileSync } from 'node:fs';
import { data, settings, formatInches, shortColorName, compactWindowLine, windowSections, needsFrameWarning, FRAME_TYPE_WARNING } from '../js/core.js';

const read = (name) => JSON.parse(readFileSync(new URL('../data/' + name, import.meta.url), 'utf8'));
data.rates = read('rates.json');
data.options = read('options.json');
data.install = read('install.json');
data.frameTypes = read('frame-types.json');
settings.rateSet = 'p75';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => { if (actual !== expected) fail(`${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); };

if (FRAME_TYPE_WARNING !== 'Select frame type — Z-bar adds material cost') fail('warning copy');
eq(formatInches(45), '45″', 'whole inches');
eq(formatInches(37.75), '37¾″', 'three quarter');
eq(formatInches(12.25), '12¼″', 'quarter');
eq(formatInches(0.5), '½″', 'bare half');
eq(formatInches(37.3), '37.3″', 'non-eighth stays decimal');
eq(formatInches(37.75, { ascii: true }), '37 3/4"', 'pdf fraction');
eq(formatInches(45, { ascii: true }), '45"', 'pdf whole');

eq(shortColorName('White / White'), 'White', 'same-side color');
eq(shortColorName('Black / White'), 'Black / White', 'mixed color stays');
eq(shortColorName('Dark Bronze / Dark Bronze'), 'Dark Bronze', 'same dark bronze');
eq(shortColorName('Bronze Anodized'), 'Bronze Anodized', 'single color');

const kitchen = compactWindowLine({
  label: 'Kitchen', brand: 'milgard', series: 'V300', type: 'hslider', color: 'ww',
  w: 45, h: 37.75, qty: 1, unit: 624.55, options: ['screen'], install: { frameType: null },
});
eq(kitchen.title, 'Kitchen — V300 Horizontal Slider', 'title drops Milgard');
eq(kitchen.detail, '45″ × 37¾″ · White · Screen · Qty 1', 'detail');
eq(kitchen.price, 624.55, 'line total');
eq(kitchen.brandName, 'Milgard', 'section brand');
if (kitchen.title.includes('Milgard') || kitchen.detail.includes('Milgard')) fail('brand leaked into the row');
if (kitchen.detail.includes('White / White') || kitchen.detail.includes('Glass')) fail('color or glass upcharge leaked');

const branded = compactWindowLine({ label: 'Kitchen', brand: 'milgard', series: 'V300', type: 'hslider', color: 'ww', w: 45, h: 36, qty: 1, unit: 10 }, { includeBrand: true });
if (!branded.title.includes('Milgard')) fail('includeBrand should keep the brand');

const mixed = compactWindowLine({ label: 'Office', brand: 'milgard', series: 'V300', type: 'hslider', color: 'bw', w: 30, h: 40, qty: 2, unit: 100, options: [] });
eq(mixed.detail, '30″ × 40″ · Black / White · Qty 2', 'mixed color and qty');
eq(mixed.price, 200, 'qty times unit');
const bare = compactWindowLine({ label: 'Hall', brand: 'milgard', series: 'V250', type: 'picture', color: 'ww', w: 20, h: 20, qty: 1, unit: 1, options: [] });
if (bare.detail.includes('Screen')) fail('screen must not be invented');
const mull = compactWindowLine({ label: 'Bay', brand: 'milgard', series: 'V300', type: 'hslider', color: 'ww', w: 36, h: 48, qty: 1, unit: 1, unitsPerLine: 3, options: ['screen'] });
if (!mull.detail.includes('3 units')) fail('mull count missing');

const sections = windowSections([
  { brand: 'milgard', series: 'V300' },
  { brand: 'andersen', series: '100' },
  { brand: 'milgard', series: 'V250' },
]);
eq(sections.map((s) => s.brandName).join(','), 'Milgard,Andersen', 'brand groups');
eq(sections[0].lines.length, 2, 'milgard lines stay together');

const open = { brand: 'milgard', series: 'V300', install: { frameType: null } };
const zbar = { brand: 'milgard', series: 'V250', install: { frameType: 'zbar' } };
if (!needsFrameWarning(open) || !needsFrameWarning({ brand: 'milgard', series: 'V400' }) || !needsFrameWarning({ brand: 'milgard', series: 'V250', frameType: '' })) fail('missing frame should warn');
if (needsFrameWarning(zbar) || needsFrameWarning({ brand: 'milgard', series: 'A250' }) || needsFrameWarning({ brand: 'andersen', series: '100' }) || needsFrameWarning({ brand: 'iwc', series: '8200' })) fail('frame warning on the wrong line');

const calc = readFileSync(new URL('../js/pages/calculator.js', import.meta.url), 'utf8');
const est = readFileSync(new URL('../js/pages/estimate.js', import.meta.url), 'utf8');
const pdf = readFileSync(new URL('../js/pdf.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../js/pages/contract.js', import.meta.url), 'utf8');
if (!calc.includes('FRAME_TYPE_WARNING') || !calc.includes("id: 'frame-warn'")) fail('calculator should show the frame warning');
if (!est.includes('FRAME_TYPE_WARNING') || !est.includes("'frame-warn-' + l.id")) fail('estimate lines should show the frame warning');
if (!est.includes("class: 'sh-table sh-wide'") || !est.includes('compactWindowList')) fail('desktop table should stay, with a compact list');
if (!pdf.includes('writeCompactWindows') || !pdf.includes('ascii: true')) fail('pdf should use the compact lines');
if (!contract.includes('compactWindowList') || !contract.includes('lines: e.lines')) fail('agreement should list the windows');
if (!css.includes('max-width:600px') || !css.includes('.sheet .sh-wide{display:none}') || !css.includes('.sheet .sh-compact{display:block!important}')) fail('narrow and print css');
if (!est.includes('includeMaterials: false') || !pdf.includes('includeMaterials: false')) fail('print and pdf should not repeat the material totals');
if (contract.includes('includeMaterials: false')) fail('agreement summary should keep the single material block');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
if (!html.includes('viewport-fit=cover')) fail('viewport should use viewport-fit=cover');
if (!html.includes('apple-mobile-web-app-status-bar-style') || !html.includes('black-translucent')) fail('status bar style should stay black-translucent with the safe-area padding');
if (!css.includes('padding-top:calc(.3rem + env(safe-area-inset-top))')) fail('phone header should keep the status-bar inset');
if (!css.includes('calc(.2rem + env(safe-area-inset-bottom))')) fail('bottom nav should keep the home-indicator inset');

if (!process.exitCode) console.log('compact lines ok');
