// The room label stays in the block directly above the measurement fields.
// Run: node tools/check_room_label.mjs
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const errs = [];
const fail = (msg) => errs.push(msg);
const mil = read('js/pages/milgard-ui.js');
const calc = read('js/pages/calculator.js');
const est = read('js/pages/estimate.js');
const css = read('css/styles.css');
const sw = read('sw.js');

function before(src, a, b, label) {
  const ia = src.indexOf(a);
  const ib = src.indexOf(b);
  if (ia < 0 || ib < 0 || ia > ib) fail(label + ' room label is not before the measurements');
}
before(mil, "class: 'field room-label'", "id: 'in-w'", 'milgard');
before(calc, "class: 'field room-label'", "id: 'in-w'", 'calculator');
before(est, "class: 'field room-label'", "class: 'grid3'", 'estimate');
if (!mil.includes("class: 'room-size'") || !calc.includes("class: 'room-size'") || !est.includes("class: 'room-size'")) fail('room and size must share a room-size wrapper');
if (mil.includes("getElementById('in-w')?.focus()") || mil.includes('getElementById("in-w")?.focus()')) fail('adding a line must not focus the width field');
if (!mil.includes("getElementById('in-label')")) fail('adding a line should focus the room label');
if (mil.includes("calc.label = ''")) fail('adding a line must keep the room location');
if (!mil.includes("calc.w = ''") || !mil.includes("calc.h = ''")) fail('width and height still clear after add');
if (!mil.includes('Enter a location (e.g. Kitchen)')) fail('blank location needs the inline message');
if (!mil.includes("pattern: '[0-9]*[.]?[0-9]*'")) fail('width and height use the decimal pattern');
if (!mil.includes("inputmode: 'decimal'")) fail('width and height use a decimal keypad');
if (!mil.includes('setSelectionRange')) fail('focusing the location selects the text');
if (!calc.includes('Enter a location (e.g. Kitchen)')) fail('other brands require a location too');
if (calc.includes("calc.label = ''")) fail('other brands must keep the room location');
if (!calc.includes("pattern: '[0-9]*[.]?[0-9]*'")) fail('other width and height inputs use the decimal pattern');
if (!est.includes("pattern: '[0-9]*[.]?[0-9]*'")) fail('estimate width and height inputs use the decimal pattern');
if (!css.includes('.room-size>.room-label{order:0}') || !css.includes('.room-label{scroll-margin-top:96px}')) fail('css should pin the room label above the size fields');
if (!sw.includes("const CACHE = 'nwd-sales-v56-pay-by-card'")) fail('service worker cache should be nwd-sales-v56-pay-by-card');
if (!est.includes("id: 'room-' + l.id")) fail('each estimate line needs its own room field id');

if (errs.length) {
  console.log('FAILED', errs.length);
  for (const e of errs) console.log(' -', e);
  process.exit(1);
}
console.log('ok  room label stays above the measurements');
