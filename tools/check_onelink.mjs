// OneLink prices must match the grid and must never land under the OneLink observation.
// Run: node tools/check_onelink.mjs
import { readFileSync } from 'node:fs';
import { data, materialUnitPrice, priceWindow, installUnit, addonUnit, totals, quoteLine, quoteTotalRows } from '../js/core.js';

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
  ['door', 'V300', '2panel', 71.5, 79.5, {}, 2152.48],
  ['door', 'V300', '2panel', 72, 80, {}, 2761.30],
  ['door', 'V300', '2panel', 84, 79.5, {}, 2825.87],
  ['door', 'V400', '2panel', 71.5, 79.5, {}, 2439.08],
  ['door', 'V400', '2panel', 72, 80, {}, 3072.72],
  ['door', 'V400', '2panel', 96, 95.5, {}, 4333.45],
  ['door', 'A250', '2panel', 71.5, 79.5, {}, 2509.10],
  ['door', 'A250', '2panel', 72, 80, {}, 3256.00],
  ['door', 'V300', '3panel', 108, 80, {}, 5439.20],
  ['door', 'V300', '3panel', 144, 95.5, {}, 6847.14],
  ['door', 'A250', '2panel', 72, 93, {}, 3577.20],
  ['door', 'V300', '4panel', 120, 80, {}, 6374.79],
  ['door', 'V300', '4panel', 190, 80, {}, 6402.09],
  ['door', 'V400', '4panel', 192, 95.5, {}, 9223.68],
  ['door', 'A250', '4panel', 190.75, 84, {}, 10032.00],
  ['door', 'V300', '2panel', 72, 80, { pureview: true }, 2932.65],
  ['door', 'V300', '2panel', 71.5, 79.5, { pureview: true }, 2282.13],
  ['door', 'V400', '2panel', 96, 95.5, { pureview: true }, 4463.10],
];
for (const [kind, series, type, w, h, extra, obs] of cases) {
  const line = { brand: 'milgard', series, type, color: extra.color || 'ww', w, h, ...extra };
  const price = materialUnitPrice(line);
  notUnder(price, obs, `${series} ${type} ${w}x${h} ${JSON.stringify(extra)}`);
}
near(win('V250', 'hslider', 36, 24), 347.38, 'V250 XO 36x24 grid', 0.02);
near(win('V300', '2panel', 71.5, 79.5), 2152.48, 'V300 standard net frame 71.5x79.5', 0.02);
near(win('V300', '2panel', 72, 80), 2803, 'V300 custom net frame 72x80', 0.02);
near(win('V400', '2panel', 71.5, 79.5), 2439.08, 'V400 standard net frame 71.5x79.5', 0.02);
check(win('V300', '2panel', 72, 80, { pureview: true }) - win('V300', '2panel', 72, 80) >= 130, 'PureView toggle adds about $130');

const seriesId = (name) => name.startsWith('V300') ? 'V300' : name.startsWith('V400') ? 'V400' : name.startsWith('A250') ? 'A250' : '';
const configType = (name) => name.startsWith('2-panel') ? '2panel' : name.startsWith('3-panel') ? '3panel' : name.startsWith('4-panel') ? '4panel' : '';
const doorColorId = (series, ext, interior) => {
  if (series === 'A250') return ext === 'Clear Anodized' ? 'clear-anodized' : 'bronze-anodized';
  if (ext === 'White') return 'ww';
  if (ext === 'Adobe') return 'adobe';
  if (ext === 'Black' && interior === 'White') return 'bw';
  if (ext === 'Black' && interior === 'Black') return 'bb';
  return 'door-dark';
};
const colorRows = csv('door_colors.csv');
const baseObs = new Map();
for (const row of colorRows) {
  const series = seriesId(row.series);
  const base = series === 'A250' ? row.ext_color === 'Clear Anodized' : row.ext_color === 'White' && row.int_color === 'White';
  if (base) baseObs.set(`${series}|${configType(row.config)}|${row.width}|${row.height}`, num(row.customer_price));
}
for (const row of colorRows) {
  const series = seriesId(row.series);
  const type = configType(row.config);
  const color = doorColorId(series, row.ext_color, row.int_color);
  const w = num(row.width), h = num(row.height);
  const price = materialUnitPrice({ brand: 'milgard', series, type, color, w, h });
  const where = `${series} ${type} ${w}x${h} ${row.ext_color}/${row.int_color}`;
  notUnder(price, num(row.customer_price), where);
  const observedBase = baseObs.get(`${series}|${type}|${row.width}|${row.height}`);
  if (observedBase != null && color !== 'ww' && series !== 'A250') {
    const white = materialUnitPrice({ brand: 'milgard', series, type, color: 'ww', w, h });
    notUnder(price - white, num(row.customer_price) - observedBase, where + ' upcharge');
  }
  if (series === 'A250') {
    const other = color === 'clear-anodized' ? 'bronze-anodized' : 'clear-anodized';
    near(price, materialUnitPrice({ brand: 'milgard', series, type, color: other, w, h }), where + ' anodized match', 0.001);
  }
}
const whiteDoor = materialUnitPrice({ brand: 'milgard', series: 'V300', type: '2panel', color: 'ww', w: 72, h: 80 });
const blackDoor = materialUnitPrice({ brand: 'milgard', series: 'V300', type: '2panel', color: 'bb', w: 72, h: 80 });
near(whiteDoor, 2803, 'V300 white door base', 0.02);
near(blackDoor, 2803 + 818, 'V300 black/black door', 0.02);
check(blackDoor >= 2969.59, 'black/black not under OneLink ' + blackDoor);
const named = quoteLine({ brand: 'milgard', series: 'V300', type: '2panel', color: 'bb', w: 72, h: 80 });
check(named.details.includes('Black / Black'), 'quote color ' + named.details.join(' | '));
const anod = quoteLine({ brand: 'milgard', series: 'A250', type: '2panel', color: 'clear-anodized', w: 72, h: 80 });
check(anod.details.includes('Clear Anodized'), 'A250 quote color');
check(!quoteLine({ brand: 'milgard', series: 'V250', type: 'hslider', color: 'ww', w: 36, h: 24 }).details.includes('Classic Brown'), 'window color names stay');

const quoteJob = totals({
  lines: [
    { brand: 'milgard', series: 'V250', type: 'hslider', color: 'ww', w: 36, h: 24, qty: 1, unit: 382.10, install: { type: 'standard', surcharges: [] } },
    { brand: 'milgard', series: 'V300', type: '2panel', color: 'bb', w: 72, h: 80, qty: 1, unit: blackDoor, install: { type: 'door', surcharges: [] } },
  ],
  extras: [], promoCode: '', stuccoRepair: { on: false },
});
const quoteRows = quoteTotalRows(quoteJob);
check(quoteRows.map((r) => r.label).join('|') === 'Windows & doors|Tax 9.1% (materials only)|Shipping|Materials subtotal|Installation', 'quote row order ' + quoteRows.map((r) => r.label).join('|'));
near(quoteRows.find((r) => r.id === 'windows').amount, 382.10 + blackDoor, 'quote materials', 0.02);
near(quoteRows.find((r) => r.id === 'install').amount, 360 + 850, 'quote installation is labor only', 0.02);
near(quoteRows.find((r) => r.id === 'materialsSub').amount, quoteJob.taxable + quoteJob.tax + quoteJob.shipping, 'materials subtotal', 0.02);
near(quoteJob.materialsSub + quoteJob.labor, quoteJob.total, 'total is materials subtotal plus installation', 0.02);
near(quoteJob.tax, Math.round(quoteJob.windows * 0.091 * 100) / 100, 'tax is 9.1% of materials', 0.02);
check(quoteRows.find((r) => r.id === 'install').amount !== quoteRows.find((r) => r.id === 'windows').amount, 'installation is not the material total');

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
console.log(`ok  OneLink ${windows} windows, doors, PureView, upcharges. V250 XO 36x24 $${win('V250', 'hslider', 36, 24).toFixed(2)}  V300 standard 71.5x79.5 $${win('V300', '2panel', 71.5, 79.5).toFixed(2)}  V300 custom 72x80 $${win('V300', '2panel', 72, 80).toFixed(2)}`);
