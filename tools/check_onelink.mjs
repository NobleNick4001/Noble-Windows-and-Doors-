// OneLink prices must match the grid and must never land under the OneLink observation.
// Run: node tools/check_onelink.mjs
import { readFileSync } from 'node:fs';
import { data, materialUnitPrice, priceWindow, installUnit, addonUnit, totals } from '../js/core.js';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
data.rates = load('data/rates.json');
data.variableRates = load('data/variable-rates.json');
data.options = load('data/options.json');
data.install = load('data/install.json');
data.promos = load('data/promos.json');
data.milgardOnelink = load('data/milgard-onelink.json');

const csv = (name) => {
  const text = readFileSync(new URL('./onelink/' + name, import.meta.url), 'utf8').trim();
  const [head, ...rows] = text.split(/\r?\n/);
  const keys = head.split(',');
  return rows.filter(Boolean).map((row) => {
    const cells = row.split(',');
    return Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? '']));
  });
};
const num = (v) => Number(v);
const cust = (list) => list * 0.417 / 0.55;
const errs = [];
const check = (ok, msg) => { if (!ok) errs.push(msg); };
const near = (actual, expected, msg, tol = 0.05) => check(Math.abs(actual - expected) <= tol, `${msg}: ${actual} != ${expected}`);
const notUnder = (actual, floor, msg) => check(actual >= floor - 0.05, `${msg}: ${actual} is under OneLink ${floor}`);

const STYLE = {
  'XO/OX slider': 'hslider', Picture: 'picture', 'Single hung': 'vslider',
  Casement: 'casement', Awning: 'awning', 'XOX slider': 'xox',
  hslider: 'hslider', vslider: 'vslider', picture: 'picture', casement: 'casement', awning: 'awning',
  xo: 'hslider', sh: 'vslider',
};

const win = (series, style, w, h, extra = {}) => materialUnitPrice({
  brand: 'milgard', series, type: style, color: 'ww', w, h, grids: 'none', obscure: 'none', ...extra,
});

let windows = 0;
for (const row of csv('validation.csv')) {
  windows++;
  const style = STYLE[row.type];
  const w = num(row.W), h = num(row.H);
  const price = win('V250', style, w, h);
  const where = `V250 ${row.type} ${w}x${h}`;
  notUnder(price, cust(num(row.fiberglass_list)), where);
  const sq = w * h / 144;
  if (!(style === 'picture' && sq > 25)) near(price, cust(num(row.grid_list)), where + ' grid', 0.08);
}
check(windows === 106, 'validation.csv rows ' + windows);

for (const row of csv('v300_v400_validation.csv')) {
  const price = win(row.series, STYLE[row.style], num(row.W), num(row.H));
  notUnder(price, num(row.obs45), `${row.series} ${row.style} ${row.W}x${row.H}`);
}

const DOOR = { XO: '2panel', XOO: '3panel', OXXO: '4panel' };
for (const row of csv('door_validation.csv')) {
  const price = win(row.series, DOOR[row.config], num(row.W), num(row.H));
  notUnder(price, num(row.obs_price45), `${row.series} ${row.config} ${row.W}x${row.H}`);
}

for (const row of csv('pureview_validation.csv')) {
  const w = num(row.W), h = num(row.H), style = STYLE[row.style];
  const delta = win('V250', style, w, h, { pureview: true }) - win('V250', style, w, h);
  notUnder(delta, cust(num(row.obs_list_delta)), `PureView ${row.style} ${w}x${h}`);
}

const baseSize = (sq) => ({ w: sq * 144 / 24, h: 24 });
for (const row of csv('upcharge_validation.csv')) {
  const sq = num(row.sqft);
  const { w, h } = baseSize(sq);
  const style = row.upcharge === 'black_ext_picture' ? 'picture' : STYLE[row.style];
  const extra = {};
  if (row.upcharge === 'bronze') extra.color = 'bronze';
  else if (row.upcharge === 'black_ext' || row.upcharge === 'black_ext_picture') extra.color = 'bw';
  else if (row.upcharge === 'black_black') extra.color = 'bb';
  else if (row.upcharge === 'adobe') extra.color = 'adobe';
  else if (row.upcharge.startsWith('grids_')) extra.grids = row.upcharge.slice(6);
  else if (row.upcharge === 'zbar') extra.frame = 'zbar';
  else if (row.upcharge === 'block') extra.frame = 'block';
  else if (row.upcharge === 'tempered') extra.tempered = true;
  else if (row.upcharge === 'obscure_p516') extra.obscure = 'p516';
  else if (row.upcharge === 'obscure_satin_etch') extra.obscure = 'satin';
  const withUp = win('V250', style, w, h, extra);
  const plain = win('V250', style, w, h);
  const floor = cust(num(row.obs_list_delta));
  if (row.upcharge === 'adobe' || (row.upcharge === 'tempered' && style === 'picture' && sq > 25)) {
    notUnder(withUp, plain + Math.min(0, floor), `${row.upcharge} ${style} ${sq} sq ft`);
  } else {
    notUnder(withUp - plain, floor, `${row.upcharge} ${style} ${sq} sq ft`);
  }
}

const cases = [
  ['win', 'V250', 'hslider', 36, 24, {}, 347.25],
  ['win', 'V250', 'hslider', 72, 60, {}, 810.50],
  ['win', 'V250', 'picture', 60, 60, { tempered: true }, 1053.11],
  ['win', 'V250', 'picture', 60, 60, { color: 'bw' }, 879.17],
  ['win', 'V250', 'hslider', 36, 24, { pureview: true }, 367.72],
  ['win', 'V300', 'hslider', 95.5, 53.5, {}, 1182.01],
  ['win', 'V400', 'casement', 40, 60, {}, 1162.33],
  ['door', 'V300', '2panel', 72, 80, {}, 2932.65],
  ['door', 'V300', '3panel', 144, 95.5, {}, 6847.14],
  ['door', 'V400', '2panel', 96, 95.5, {}, 4463.10],
  ['door', 'A250', '2panel', 72, 93, {}, 3577.20],
  ['door', 'V300', '4panel', 120, 80, {}, 6374.79],
  ['door', 'V300', '4panel', 190, 80, {}, 6402.09],
  ['door', 'V400', '4panel', 192, 95.5, {}, 9223.68],
  ['door', 'A250', '4panel', 190.75, 84, {}, 10032.00],
  ['door', 'V300', '2panel', 72, 80, { pureview: true }, 2932.65 + 131.17],
];
for (const [kind, series, type, w, h, extra, obs] of cases) {
  const line = { brand: 'milgard', series, type, color: extra.color || 'ww', w, h, ...extra };
  const price = materialUnitPrice(line);
  notUnder(price, obs, `${series} ${type} ${w}x${h} ${JSON.stringify(extra)}`);
  if (kind === 'door' && !extra.pureview && obs === 2932.65) near(price, 2932.65, 'V300 door 72x80', 0.02);
}
near(win('V250', 'hslider', 36, 24), 347.38, 'V250 XO 36x24 grid', 0.02);
near(win('V300', '2panel', 72, 80), 2932.65, 'V300 XO door 72x80', 0.02);

const shown = priceWindow({ brand: 'milgard', series: 'V250', type: 'hslider', color: 'ww', w: 36, h: 24, qty: 2 });
check(shown && shown.mode === 'onelink' && shown.total === Math.round(shown.unit * 2 * 100) / 100, 'linePrice qty');

const tall = { brand: 'milgard', series: 'V400', type: '4panel', w: 144, h: 90, qty: 1, unit: 1000, install: { surcharges: ['door-second-story', 'door-stucco', 'door-header', 'door-cutdown'], headerFeet: 1.25, writeIn: { description: 'Extra', amount: 75 } } };
check(installUnit(tall.install, tall) === 1350, '4-panel tall labor ' + installUnit(tall.install, tall));
const add = addonUnit(tall.install, tall);
near(add, 300 + 650 + 850 * 1.25 + 1500 + 75, 'door add-ons', 0.02);
const job = totals({ lines: [tall], extras: [], promoCode: '', stuccoRepair: { on: false } });
near(job.labor, 1350 + add, 'combined installation', 0.02);
check(job.shipping === 150 && job.taxPct === 9.1, 'shipping and tax unchanged');
check(!JSON.stringify(data.rates.brands.find((b) => b.id === 'milgard').series).includes('V350'), 'no V350');

if (errs.length) {
  console.log('FAILED', errs.length);
  for (const e of errs) console.log(' -', e);
  process.exit(1);
}
console.log(`ok  OneLink ${windows} windows, doors, PureView, upcharges. V250 XO 36x24 $${win('V250', 'hslider', 36, 24).toFixed(2)}  V300 XO door 72x80 $${win('V300', '2panel', 72, 80).toFixed(2)}`);
