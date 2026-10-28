// OneLink prices must match the grid and must never land under the OneLink observation.
// Run: node tools/check_onelink.mjs
import { readFileSync } from 'node:fs';
import { milgardQuote, engineFor, styleLimits, isMilgardDoorLine, A250_WINDOW_STYLES } from '../js/milgard.js';
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

// A250 aluminum windows: $ per inch of (W + H). Clear and Bronze Anodized are the same price.
const a250 = (type, w, h, color, extra = {}) => materialUnitPrice({ brand: 'milgard', series: 'A250', type, color, w, h, grids: 'none', obscure: 'none', ...extra });
const A250_RATE = { picture: 15.27, hslider: 20.07, xox: 23.60, vslider: 19.33, casement: 25.24 };
for (const [type, rate] of Object.entries(A250_RATE)) {
  const w = type === 'xox' ? 72 : type === 'casement' ? 30 : 36, hh = 48;
  near(a250(type, w, hh, 'bronze-anodized'), rate * (w + hh), `A250 ${type} bronze`, 0.01);
  near(a250(type, w, hh, 'clear-anodized'), a250(type, w, hh, 'bronze-anodized'), `A250 ${type} clear = bronze`, 0.001);
}
near(a250('picture', 48, 48, 'bronze-anodized'), 1465.92, 'A250 picture 48x48 bronze', 0.01);
near(a250('vslider', 35, 59, 'clear-anodized'), 1817.02, 'A250 single hung 35x59 clear', 0.01);
near(a250('picture', 48, 48, 'bronze-anodized', { tempered: true }), 1465.92 * 1.6, 'A250 tempered picture', 0.01);
near(a250('picture', 48, 48, 'bronze-anodized', { tempered: true, obscure: 'p516' }), 1465.92 * 2.3, 'A250 tempered + obscure picture', 0.01);
near(a250('casement', 30, 48, 'clear-anodized', { tempered: true }), 25.24 * 78 * 1.2, 'A250 tempered casement', 0.01);
near(a250('picture', 72, 60, 'clear-anodized'), 15.27 * 132 * 1.6, 'A250 picture over 25 sq ft is tempered', 0.01);
near(a250('picture', 48, 48, 'bronze-anodized', { grids: 'flat', pureview: true, frame: 'zbar' }), 1465.92, 'A250 ignores grids, PureView, Z-bar', 0.01);
check(priceWindow({ brand: 'milgard', series: 'A250', type: 'picture', color: 'bronze-anodized', w: 48, h: 48, qty: 1 })?.mode === 'onelink', 'A250 window uses the A250 rate');
check(milgardQuote(data.milgardOnelink, { brand: 'milgard', series: 'A250', type: 'awning', w: 30, h: 24 }) === null, 'A250 awning is not priced');
check(milgardQuote(data.milgardOnelink, { brand: 'milgard', series: 'A250', type: 'hslider', w: 48, h: 36, tempered: true }).errors.length > 0, 'A250 slider tempered is refused');
const a250Job = totals({ lines: [{ brand: 'milgard', series: 'A250', type: 'picture', color: 'bronze-anodized', w: 48, h: 48, qty: 1, unit: 1465.92, install: { type: 'standard', surcharges: [] } }], extras: [], promoCode: '', stuccoRepair: { on: false } });
near(a250Job.labor, 360, 'A250 window labor is the usual $360', 0.01);

// V300 Trinsic XO: 72" tall at every width, 17.75–84" wide. Heights over 60" use the tall sheet.
const Eng = engineFor(data.milgardOnelink);
const xoLim = Eng.limits('V300', 'hslider');
check(xoLim.wmin === 17.75 && xoLim.wmax === 84 && xoLim.hmin === 11.5 && xoLim.hmax === 72 && !xoLim.curve, 'V300 XO limits ' + JSON.stringify(xoLim));
check(Eng.limits('V250', 'hslider').wmax === 95.5 && Eng.limits('V250', 'hslider').hmax === 71.5, 'V250 XO limits unchanged');
check(Eng.validate('V300', 'hslider', 17.75, 11.5).length === 0, 'V300 XO minimum allowed');
check(Eng.validate('V300', 'hslider', 84, 72).length === 0, 'V300 XO 84x72 allowed');
check(Eng.validate('V300', 'hslider', 36, 72).length === 0 && Eng.validate('V300', 'hslider', 60, 72).length === 0, 'V300 height max stays 72 at other widths');
check(Eng.validate('V300', 'hslider', 48, 72.01).some((e) => /Height/.test(e)), 'V300 over 72 blocked');
check(Eng.validate('V300', 'hslider', 84.01, 60).some((e) => /Width/.test(e)), 'V300 over 84 blocked');
check(Eng.validate('V300', 'hslider', 17.74, 48).some((e) => /Width/.test(e)), 'V300 under 17.75 blocked');
near(win('V300', 'hslider', 48, 59.5), 871.91, 'V300 XO white 48x59.5', 0.01);
near(win('V300', 'hslider', 48, 60), 872.67, 'V300 XO white 48x60', 0.01);
near(win('V300', 'hslider', 48, 66), 1117.56, 'V300 XO white 48x66', 0.01);
near(win('V300', 'hslider', 48, 72), 1126.66, 'V300 XO white 48x72', 0.01);
near(win('V300', 'hslider', 48, 61), 1117.56, 'V300 just over 60 uses the 66in tier', 0.01);
near(win('V300', 'hslider', 48, 67), 1126.66, 'V300 just over 66 uses the 72in tier', 0.01);
near(win('V300', 'hslider', 48, 48), 709.79, 'V300 48x48 unchanged', 0.02);
near(win('V300', 'hslider', 48, 54), 980.95, 'V300 48x54 unchanged', 0.02);
near(win('V300', 'hslider', 48, 55), 797.95, 'V300 48x55 unchanged', 0.02);
near(win('V300', 'hslider', 36, 24), 484.62, 'V300 36x24 unchanged', 0.02);
near(win('V300', 'hslider', 42, 59.5), 974.64, 'V300 42x59.5 already above the sheet', 0.02);
near(win('V250', 'hslider', 48, 59.5), 639.90, 'V250 48x59.5 unchanged', 0.02);
near(win('V400', 'hslider', 48, 60), 876.40, 'V400 48x60 unchanged', 0.02);
const tallSheet = csv('v300_xo_tall.csv').filter((row) => row.h !== '59.5');
check(tallSheet.length === 18, 'tall sheet rows ' + tallSheet.length);
for (const row of tallSheet) {
  const price = win('V300', 'hslider', num(row.w), num(row.h));
  notUnder(price, num(row.customer_price), `V300 XO ${row.w}x${row.h} sheet floor`);
  if (num(row.h) > 60) near(price, num(row.customer_price), `V300 XO ${row.w}x${row.h} tall tier`, 0.01);
}
const zbar = materialUnitPrice({ brand: 'milgard', series: 'V300', type: 'hslider', color: 'ww', w: 48, h: 59.5, frame: 'zbar' });
check(zbar > 871.91, 'Z-bar material stays on top of the white price ' + zbar);
const black = win('V300', 'hslider', 48, 66, { color: 'bw' });
check(black > 1117.56, 'tall tier still adds color ' + black);
check(installUnit({ type: 'standard', surcharges: [] }) === 360, 'retrofit labor 360');
check(installUnit({ type: 'block', surcharges: [] }) === 380, 'block labor 380');
check(installUnit({ type: 'stucco-fin', surcharges: [] }) === 400, 'nail fin labor 400');
check(addonUnit({ type: 'standard', surcharges: ['oversize'] }) === 85, 'large unit 85');
check(addonUnit({ type: 'standard', surcharges: ['second-story'] }) === 75, 'two-story 75');

// A250 single hung: 24" rough opening is 23.5" net frame. Other series stay put.
const sh = Eng.limits('A250', 'vslider');
check(sh.wmin === 11.5 && sh.wmax === 47.5 && sh.hmin === 23.5 && sh.hmax === 71.5, 'A250 single hung limits ' + JSON.stringify(sh));
check(/24/.test(sh.hintH) && /23\.5/.test(sh.hintH), 'A250 hint names the rough opening');
check(Eng.validate('A250', 'vslider', 30, 23).some((e) => /Height/.test(e)), 'A250 23in blocked');
check(Eng.validate('A250', 'vslider', 30, 20).some((e) => /Height/.test(e)), 'A250 20in blocked');
check(Eng.validate('A250', 'vslider', 30, 17.5).some((e) => /Height/.test(e)), 'A250 old 17.5in minimum blocked');
check(Eng.validate('A250', 'vslider', 30, 23.5).length === 0, 'A250 23.5 net frame allowed');
check(Eng.validate('A250', 'vslider', 30, 24).length === 0, 'A250 24in allowed');
check(Eng.validate('A250', 'vslider', 11.5, 23.5).length === 0, 'A250 narrow minimum allowed');
check(Eng.validate('A250', 'vslider', 11.49, 48).some((e) => /Width/.test(e)), 'A250 under 11.5 blocked');
check(Eng.validate('A250', 'vslider', 47.5, 71.5).length === 0, 'A250 max net frame allowed');
check(Eng.validate('A250', 'vslider', 48, 48).some((e) => /Width/.test(e)), 'A250 48 net frame blocked');
check(Eng.validate('A250', 'vslider', 30, 72).some((e) => /Height/.test(e)), 'A250 72 net frame blocked');
check(Eng.validate('V250', 'vslider', 30, 18).length === 0, 'V250 single hung minimum unchanged');
check(Eng.limits('V300', 'vslider').hmin === 23.5 && Eng.limits('V300', 'vslider').hmax === 96 && Eng.limits('V300', 'vslider').wmax === 48, 'V300 single hung limits unchanged');
check(Eng.limits('A250', 'hslider').hmin === 11.5, 'A250 slider minimum unchanged');

// Double casement is base + perUI. Arch top stays a placeholder.
const pending = data.milgardOnelink.pendingWindows;
check(pending && pending.pricePending === true, 'pendingWindows block still flags unpriced styles');
check(pending.styles.archtop.perUI === 0 && pending.styles.archtop.pricePending == null, 'arch top stays a placeholder');
check(pending.styles.dcasement.pricePending === false, 'double casement style is priced');
check(pending.styles.dcasement.rates.V300.ww.base === 665.69 && pending.styles.dcasement.rates.V300.ww.perUI === 8.54, 'V300 white rate');
check(pending.styles.dcasement.rates.V300.bw.base === 1159 && pending.styles.dcasement.rates.V300.bw.perUI === 9.56, 'V300 black/white rate');
check(pending.styles.dcasement.rates.V400.ww.base === 751.66 && pending.styles.dcasement.rates.V400.ww.perUI === 9.74, 'V400 white rate');
check(pending.styles.dcasement.rates.V400.bw.base === 1329 && pending.styles.dcasement.rates.V400.bw.perUI === 10.59, 'V400 black/white rate');
check(!pending.styles.dcasement.rates.V250, 'V250 Style Line has no double casement rate');
const dc = styleLimits(data.milgardOnelink, 'V400', 'dcasement');
check(dc.sashWmin === 14.25 && dc.sashWmax === 36 && dc.sashes === 2 && dc.wmin === 28.5 && dc.wmax === 72 && dc.hmin === 17.5 && dc.hmax === 72, 'double casement limits ' + JSON.stringify(dc));
check(dc.wmax !== 42, 'double casement does not use the V400 single-casement width exception');
const arch400 = styleLimits(data.milgardOnelink, 'V400', 'archtop');
const arch250 = styleLimits(data.milgardOnelink, 'V250', 'archtop');
check(arch400.hmax === 78, 'V400 arch top overall height max ' + arch400.hmax);
check(arch250.hmax === 96 && arch250.wmin === 14, 'other series arch top stays a placeholder ' + JSON.stringify(arch250));
const quoteOf = (series, type, w, h, extra = {}) => milgardQuote(data.milgardOnelink, { brand: 'milgard', series, type, color: 'ww', w, h, ...extra });
const dcPending = quoteOf('V250', 'dcasement', 30, 48);
check(dcPending.pricePending === true && dcPending.errors.length === 0 && dcPending.material === 0, 'V250 30x48 double casement is allowed and pending');
check(dcPending.notes.some((n) => /Price pending/.test(n)), 'pending note is on the quote');
check(quoteOf('V300', 'dcasement', 28, 48).errors.some((e) => /sash/.test(e)), '28in overall is under 28.5');
check(quoteOf('V300', 'dcasement', 28.5, 48).errors.length === 0, '28.5in overall is allowed');
check(quoteOf('V300', 'dcasement', 72, 72).errors.length === 0, '72x72 double casement is allowed');
check(quoteOf('V300', 'dcasement', 72.01, 48).errors.some((e) => /sash/.test(e)), 'over 72 wide is blocked');
check(quoteOf('V250', 'dcasement', 20, 48).errors.some((e) => /sash/.test(e)), '20in overall is too narrow per sash');
check(quoteOf('V250', 'dcasement', 80, 48).errors.some((e) => /sash/.test(e)), '80in overall is too wide per sash');
check(quoteOf('V250', 'dcasement', 30, 17).errors.some((e) => /Height/.test(e)), 'double casement height 17 blocked');
check(quoteOf('V250', 'dcasement', 30, 17.5).errors.length === 0, 'double casement height 17.5 allowed');
check(quoteOf('V250', 'dcasement', 30, 72).errors.length === 0, 'double casement height 72 allowed');
check(quoteOf('V250', 'dcasement', 30, 80).errors.some((e) => /Height/.test(e)), 'double casement height 80 blocked');
check(quoteOf('V400', 'archtop', 36, 78).errors.length === 0, 'V400 arch 36x78 allowed');
check(quoteOf('V400', 'archtop', 36, 79).errors.some((e) => /Height/.test(e)), 'V400 arch over 78 blocked');
check(quoteOf('V300', 'archtop', 36, 78).errors.length === 0, 'non-V400 arch 78 allowed on the placeholder');
check(quoteOf('V300', 'archtop', 36, 97).errors.some((e) => /Height/.test(e)), 'non-V400 arch over placeholder max blocked');
check(quoteOf('V250', 'archtop', 60, 30).errors.some((e) => /equal-leg/.test(e)), 'short arch is not an equal-leg arch over a unit');
check(quoteOf('A250', 'dcasement', 30, 48) == null, 'A250 does not price the new styles');
check(quoteOf('A250', 'dshung', 60, 48) == null, 'A250 does not price Double Single Hung');
check(!A250_WINDOW_STYLES.includes('dcasement') && !A250_WINDOW_STYLES.includes('archtop') && !A250_WINDOW_STYLES.includes('dshung'), 'A250 style list hides the new types');
const pendingLine = { brand: 'milgard', series: 'V250', type: 'dcasement', color: 'ww', w: 30, h: 48, qty: 1 };
const pendingPrice = priceWindow(pendingLine);
check(pendingPrice.pricePending === true && pendingPrice.unit === 0 && pendingPrice.mode === 'onelink', 'screen stores $0 while the price is pending');
check(!isMilgardDoorLine(pendingLine), 'double casement is a window');
const sheet = csv('double_casement_1020.csv');
check(sheet.length === 20, 'double casement sheet rows ' + sheet.length);
const seriesOf = { 'V300 Trinsic': 'V300', 'V400 Tuscany': 'V400' };
const colorOf = { 'White/White': 'ww', 'Black/White': 'bw' };
for (const row of sheet) {
  const price = materialUnitPrice({
    brand: 'milgard', series: seriesOf[row.series], type: 'dcasement', color: colorOf[row.color],
    w: num(row.w), h: num(row.h),
  });
  check(price + 0.001 >= num(row.customer_price_45), `${row.series} ${row.color} ${row.w}x${row.h}: ${price} is under OneLink ${row.customer_price_45}`);
}
const dcLine = (series, color, w, h, extra = {}) => ({ brand: 'milgard', series, type: 'dcasement', color, w, h, qty: 1, ...extra });
const white30 = materialUnitPrice(dcLine('V300', 'ww', 40, 48));
const adobe30 = materialUnitPrice(dcLine('V300', 'adobe', 40, 48));
check(white30 > 0 && white30 === adobe30, 'Adobe uses the White double casement price ' + adobe30);
check(quoteOf('V300', 'dcasement', 40, 48).notes.some((n) => /Adobe/.test(n)) === false, 'white quote does not mention Adobe');
const adobeQuote = milgardQuote(data.milgardOnelink, dcLine('V400', 'adobe', 40, 48));
check(adobeQuote.pricePending === false && adobeQuote.notes.some((n) => /Adobe priced as White/.test(n)), 'Adobe note on Tuscany');
for (const color of ['bronze', 'bb']) {
  const pendingColor = priceWindow(dcLine('V300', color, 40, 48));
  check(pendingColor.pricePending === true && pendingColor.unit === 0, color + ' double casement stays pending');
}
const withGlass = materialUnitPrice(dcLine('V300', 'bw', 48, 54, { tempered: true, grids: 'flat', obscure: 'p516', frame: 'zbar' }));
const bare = materialUnitPrice(dcLine('V300', 'bw', 48, 54));
check(withGlass === bare && bare > 0, 'glass grids and frame do not change the double casement price ' + withGlass);
check(quoteOf('V400', 'archtop', 36, 60).pricePending === true && quoteOf('V400', 'archtop', 36, 60).material === 0, 'arch top price stays pending');
for (const type of ['dcasement', 'dshung', 'archtop']) {
  const line = { brand: 'milgard', series: 'V300', type, w: 36, h: 48 };
  check(installUnit({ type: 'standard', surcharges: [] }, line) === 360, type + ' retrofit labor');
  check(installUnit({ type: 'block', surcharges: [] }, line) === 380, type + ' block labor');
  check(installUnit({ type: 'stucco-fin', surcharges: [] }, line) === 400, type + ' nail fin labor');
  check(addonUnit({ type: 'standard', surcharges: ['oversize'] }, line) === 85, type + ' large');
  check(addonUnit({ type: 'standard', surcharges: ['second-story'] }, line) === 75, type + ' two-story');
}
// Double Single Hung: two single hungs mulled as one unit. Customer price is base + perUI × (W+H).
const dsh = pending.styles.dshung;
check(dsh.pricePending === false && dsh.name === 'Double Single Hung', 'double single hung style is priced');
check(dsh.rates.V250.ww.base === -57 && dsh.rates.V250.ww.perUI === 8.81 && dsh.rates.V250.ww.min === 566, 'V250 white rate and minimum');
check(dsh.rates.V250.bw.base === 505 && dsh.rates.V250.bw.perUI === 8.01 && dsh.rates.V250.bw.min == null, 'V250 black/white rate');
check(dsh.rates.V300.ww.base === -30 && dsh.rates.V300.ww.perUI === 9.75, 'V300 white rate');
check(dsh.rates.V300.bw.base === 305 && dsh.rates.V300.bw.perUI === 11.69, 'V300 black/white rate');
check(dsh.rates.V400.ww.base === 83 && dsh.rates.V400.ww.perUI === 10.15, 'V400 white rate');
check(dsh.rates.V400.bw.base === 390 && dsh.rates.V400.bw.perUI === 12.96, 'V400 black/white rate');
check(!dsh.rates.V250.bb && !dsh.rates.V300.bb && !dsh.rates.V400.bb, 'no Black/Black double single hung rate');
const lim = (series) => styleLimits(data.milgardOnelink, series, 'dshung');
check(lim('V250').wmin === 20 && lim('V250').wmax === 90 && lim('V250').hmin === 17.5 && lim('V250').hmax === 84 && !lim('V250').sashes, 'V250 overall limits');
check(lim('V300').wmin === 19 && lim('V300').wmax === 90 && lim('V300').hmin === 23.5 && lim('V300').hmax === 78, 'V300 height is 23.5–78');
check(lim('V400').wmin === 24 && lim('V400').wmax === 96 && lim('V400').hmin === 23.5 && lim('V400').hmax === 86, 'V400 overall limits');
const dshLine = (series, color, w, h, extra = {}) => ({ brand: 'milgard', series, type: 'dshung', color, w, h, qty: 1, ...extra });
const dshMaterial = (series, color, w, h) => milgardQuote(data.milgardOnelink, dshLine(series, color, w, h));
const spot = dshMaterial('V300', 'ww', 60, 48);
check(spot.errors.length === 0 && spot.pricePending === false && Math.abs(spot.material - (-30 + 9.75 * 108)) < 0.001, 'V300 white 60x48 ' + spot.material);
check(Math.abs(materialUnitPrice(dshLine('V300', 'ww', 60, 48)) - 1023) < 0.001, 'V300 white 60x48 customer unit');
check(Math.abs(dshMaterial('V300', 'bw', 60, 48).material - (305 + 11.69 * 108)) < 0.001, 'V300 black/white 60x48');
check(Math.abs(dshMaterial('V400', 'ww', 60, 48).material - (83 + 10.15 * 108)) < 0.001, 'V400 white 60x48');
check(Math.abs(dshMaterial('V400', 'bw', 60, 48).material - (390 + 12.96 * 108)) < 0.001, 'V400 black/white 60x48');
check(Math.abs(dshMaterial('V250', 'bw', 60, 48).material - (505 + 8.01 * 108)) < 0.001, 'V250 black/white 60x48');
check(Math.abs(dshMaterial('V250', 'ww', 60, 48).material - (-57 + 8.81 * 108)) < 0.001, 'V250 white 60x48 is above the floor');
const floored = dshMaterial('V250', 'ww', 30, 40);
check(floored.errors.length === 0 && floored.material === 566 && (-57 + 8.81 * 70) < 566, 'V250 white 30x40 uses the $566 minimum');
check(Math.abs(dshMaterial('V250', 'ww', 30, 41).material - (-57 + 8.81 * 71)) < 0.001, 'V250 white just over the floor is not clamped');
check(dshMaterial('V300', 'adobe', 60, 48).material === spot.material && dshMaterial('V300', 'adobe', 60, 48).notes.some((n) => /Adobe priced as White/.test(n)), 'Adobe uses the White price');
check(materialUnitPrice(dshLine('V250', 'adobe', 30, 40)) === 566, 'Adobe uses the V250 White minimum');
for (const color of ['bronze', 'bb']) {
  const pendingColor = priceWindow(dshLine('V300', color, 60, 48));
  check(pendingColor.pricePending === true && pendingColor.unit === 0, color + ' double single hung stays pending');
}
const dshGlass = materialUnitPrice(dshLine('V300', 'ww', 60, 48, { tempered: true, grids: 'flat', obscure: 'p516', frame: 'zbar' }));
check(dshGlass === materialUnitPrice(dshLine('V300', 'ww', 60, 48)), 'glass grids and frame do not change the double single hung price');
check(installUnit({ type: 'standard', surcharges: [] }, dshLine('V300', 'ww', 60, 48)) === 360, 'labor stays off the material price');
check(dshMaterial('V250', 'ww', 19.99, 48).errors.some((e) => /Width/.test(e)), 'V250 under 20 wide blocked');
check(dshMaterial('V250', 'ww', 20, 48).errors.length === 0 && dshMaterial('V250', 'ww', 90, 84).errors.length === 0, 'V250 20 and 90x84 allowed');
check(dshMaterial('V250', 'ww', 90.01, 48).errors.some((e) => /Width/.test(e)), 'V250 over 90 wide blocked');
check(dshMaterial('V250', 'ww', 40, 17.49).errors.some((e) => /Height/.test(e)) && dshMaterial('V250', 'ww', 40, 84.01).errors.some((e) => /Height/.test(e)), 'V250 height outside 17.5–84 blocked');
check(dshMaterial('V300', 'ww', 18.99, 48).errors.some((e) => /Width/.test(e)), 'V300 under 19 wide blocked');
check(dshMaterial('V300', 'ww', 19, 23.5).errors.length === 0 && dshMaterial('V300', 'ww', 90, 78).errors.length === 0, 'V300 19x23.5 and 90x78 allowed');
check(dshMaterial('V300', 'ww', 40, 23.49).errors.some((e) => /Height/.test(e)) && dshMaterial('V300', 'ww', 40, 78.01).errors.some((e) => /Height/.test(e)), 'V300 height outside 23.5–78 blocked');
check(dshMaterial('V300', 'ww', 90.01, 48).errors.some((e) => /Width/.test(e)), 'V300 width stops at 90');
check(dshMaterial('V400', 'ww', 23.99, 48).errors.some((e) => /Width/.test(e)) && dshMaterial('V400', 'ww', 24, 23.5).errors.length === 0, 'V400 width starts at 24 and height at 23.5');
check(dshMaterial('V400', 'ww', 96, 86).errors.length === 0, 'V400 96x86 allowed');
check(dshMaterial('V400', 'ww', 96.01, 48).errors.some((e) => /Width/.test(e)) && dshMaterial('V400', 'ww', 40, 86.01).errors.some((e) => /Height/.test(e)), 'V400 over max blocked');
check(dshMaterial('V400', 'ww', 40, 23.49).errors.some((e) => /Height/.test(e)), 'V400 under 23.5 tall blocked');
const milgardBrand = data.rates.brands.find((b) => b.id === 'milgard');
for (const id of ['V250', 'V300', 'V400']) check(milgardBrand.series.find((s) => s.id === id).types.includes('dshung'), id + ' offers Double Single Hung');
check(!milgardBrand.series.find((s) => s.id === 'A250').types.includes('dshung'), 'A250 series list hides Double Single Hung');
check(data.rates.types.find((t) => t.id === 'dshung')?.name === 'Double Single Hung', 'Milgard type label');
check(data.milgardOnelink.names.dshung === 'Double Single Hung', 'quote name');
const live = data.milgardOnelink;
const ready = JSON.parse(JSON.stringify(live));
ready.pendingWindows.styles.dcasement.rates.V300.ww = { base: 10, perUI: 12.5 };
data.milgardOnelink = ready;
const real = milgardQuote(ready, { brand: 'milgard', series: 'V300', type: 'dcasement', color: 'ww', w: 30, h: 48, tempered: true, grids: 'flat' });
check(real.pricePending === false && Math.abs(real.material - (10 + 78 * 12.5)) < 0.001, 'base + perUI ignores option upcharges ' + real.material);
const readyShown = priceWindow({ brand: 'milgard', series: 'V300', type: 'dcasement', color: 'ww', w: 30, h: 48, qty: 2 });
check(readyShown.pricePending === false && Math.abs(readyShown.unit - (10 + 78 * 12.5)) < 0.001, 'priceWindow uses base + perUI ' + readyShown.unit);
data.milgardOnelink = live;

// Arch and eyebrow use one price per configuration. The old archtop placeholder stays pending.
const ceilDollar = (n) => Math.ceil(Number(n) - 1e-6);
const xoRaw = 433 + 10.49 * 132;
const xo400 = quoteOf('V400', 'arch_xo', 60, 72);
check(Math.abs(xoRaw - 1817.68) < 0.001, 'V400 XO 60x72 raw ' + xoRaw);
check(xo400.errors.length === 0 && xo400.pricePending === false && xo400.provisional === false && xo400.unavailable !== true && xo400.material === ceilDollar(xoRaw) && xo400.material === 1818, 'V400 arch/eyebrow XO 60x72 ' + xo400.material);
check(materialUnitPrice({ brand: 'milgard', series: 'V400', type: 'arch_xo', color: 'ww', w: 60, h: 72 }) === 1818, 'V400 XO 60x72 unit price');
const xoBw = quoteOf('V400', 'arch_xo', 60, 72, { color: 'bw' });
const xoBb = quoteOf('V400', 'arch_xo', 60, 72, { color: 'bb' });
check(xoBw.provisional === true && xoBw.material === ceilDollar(xoRaw + 562.78), 'V400 black/white arch adder ' + xoBw.material);
check(xoBb.provisional === true && xoBb.material === ceilDollar(xoRaw + 622.13), 'V400 black/black arch adder ' + xoBb.material);
const xoAdobe = quoteOf('V400', 'arch_xo', 60, 72, { color: 'adobe' });
check(xoAdobe.material === 1818 && xoAdobe.notes.some((n) => /Adobe priced as White/.test(n)), 'Adobe uses the white arch price');
check(quoteOf('V400', 'arch_xo', 60, 72, { color: 'bronze' }).pricePending === true, 'bronze arch stays pending');
check(quoteOf('V400', 'arch_xo', 25, 72).errors.some((e) => /Width/.test(e)), 'V400 XO under 26 wide blocked');
check(quoteOf('V400', 'arch_xo', 60, 40).errors.some((e) => /Height/.test(e)), 'V400 XO under 41 tall blocked');
check(quoteOf('V400', 'arch_xo', 95.5, 102).errors.length === 0 && quoteOf('V400', 'arch_xo', 96, 50).errors.some((e) => /Width/.test(e)), 'V400 XO width stops at 95.5');
const xox400 = quoteOf('V400', 'arch_xox', 60, 60);
check(xox400.errors.length === 0 && xox400.provisional === true && xox400.material === ceilDollar(765 + 10.49 * 120), 'V400 XOX provisional ' + xox400.material);
check(quoteOf('V300', 'arch_xox', 60, 60).unavailable === true && quoteOf('V250', 'arch_xox', 60, 60).unavailable === true, 'V300 and V250 arch XOX are not available');
check(quoteOf('V250', 'arch_sh', 36, 60).unavailable === true && quoteOf('V400', 'arch_sh', 36, 60).unavailable === true, 'arch single hung is not available on V250 or V400');
check(quoteOf('V300', 'arch_xox', 60, 60, { color: 'bw' }).unavailable === true && quoteOf('V250', 'arch_sh', 36, 60, { color: 'bb' }).unavailable === true, 'V300 XOX and V250 arch single hung stay not available in black');
check(quoteOf('V400', 'arch_hr', 36, 60, { color: 'bw' }).unavailable === true && quoteOf('V400', 'arch_hr', 36, 60, { color: 'bb' }).unavailable === true, 'black is not offered on V400 half-round');
const hr = quoteOf('V400', 'arch_hr', 36, 72);
check(hr.errors.length === 0 && hr.provisional === false && hr.material === ceilDollar(955 + 5.86 * 108), 'V400 half-round 36x72 ' + hr.material);
check(quoteOf('V400', 'arch_hr', 36, 107.75).errors.length === 0 && quoteOf('V400', 'arch_hr', 36, 107.76).errors.some((e) => /Height/.test(e)), 'half-round height stops at 107.75');
check(quoteOf('V400', 'arch_hr', 29.4, 60).errors.some((e) => /Width/.test(e)) && quoteOf('V400', 'arch_hr', 47.6, 60).errors.some((e) => /Width/.test(e)), 'half-round width is 29.5–47.5');
const sh300 = quoteOf('V300', 'arch_sh', 36, 60);
check(sh300.provisional === true && sh300.errors.length === 0 && sh300.material === ceilDollar(507 + 6.58 * 96), 'V300 arch single hung provisional ' + sh300.material);
const v300xo = quoteOf('V300', 'arch_xo', 36, 48);
check(v300xo.provisional === true && v300xo.material === ceilDollar(379 + 8.98 * 84), 'V300 arch XO provisional ' + v300xo.material);
const v250ok = quoteOf('V250', 'arch_xo', 36, 70);
check(v250ok.errors.length === 0 && v250ok.provisional === true && v250ok.material === ceilDollar(303 + 8.17 * 106), 'V250 arch XO 36x70 ' + v250ok.material);
check(quoteOf('V250', 'arch_xo', 36, 60).errors.some((e) => /Leg/.test(e)), 'V250 arch XO short leg is blocked');
const naPrice = priceWindow({ brand: 'milgard', series: 'V300', type: 'arch_xox', color: 'ww', w: 60, h: 60, qty: 1 });
check(naPrice?.unavailable === true && naPrice.unit == null, 'not available has no price');
for (const type of ['arch_xo', 'arch_xox', 'arch_sh', 'arch_hr']) {
  const line = { brand: 'milgard', series: 'V400', type, w: 40, h: 60 };
  check(installUnit({ type: 'standard', surcharges: [] }, line) === 360, type + ' retrofit labor');
  check(installUnit({ type: 'block', surcharges: [] }, line) === 380, type + ' block labor');
  check(installUnit({ type: 'stucco-fin', surcharges: [] }, line) === 400, type + ' nail fin labor');
  check(addonUnit({ type: 'standard', surcharges: ['oversize'] }, line) === 85, type + ' large');
  check(addonUnit({ type: 'standard', surcharges: ['second-story'] }, line) === 75, type + ' two-story');
}
check(quoteOf('V400', 'archtop', 36, 60).pricePending === true, 'old equal-leg arch top stays pending');

// Black on V300/V250 arch is a formula adder on the White price, then round up.
// Each formula must clear the OneLink adder at every source size.
const adderOf = (base, per, u, floor = null) => {
  const raw = base + per * u;
  return floor != null && raw < floor ? floor : raw;
};
const archBlack = (series, type, color, w, h) => quoteOf(series, type, w, h, { color });
const sourcePoints = [
  ['V300', 'arch_xo', 60, 72, 174, 2.07, null, 446.27, 168, 2.54, null, 503.08],
  ['V300', 'arch_xo', 72, 84, 174, 2.07, null, 495.83, 168, 2.54, null, 564],
  ['V250', 'arch_xo', 60, 72, 165, 1.91, null, 415.55, 177, 2.25, null, 471.71],
  ['V250', 'arch_xo', 72, 84, 165, 1.91, null, 461.18, 177, 2.25, null, 525.47],
  ['V300', 'arch_sh', 36, 72, -195, 4.15, 253, 252.77, -190, 4.43, 289, 288.19],
  ['V300', 'arch_sh', 36, 84, -195, 4.15, 253, 302.51, -190, 4.43, 289, 341.27],
];
for (const [series, type, w, h, bwA, bwB, bwFloor, bwObs, bbA, bbB, bbFloor, bbObs] of sourcePoints) {
  const u = w + h;
  const bwAdd = adderOf(bwA, bwB, u, bwFloor);
  const bbAdd = adderOf(bbA, bbB, u, bbFloor);
  check(bwAdd + 1e-9 >= bwObs, `${series} ${type} ${w}x${h} black/white adder ${bwAdd} under ${bwObs}`);
  check(bbAdd + 1e-9 >= bbObs, `${series} ${type} ${w}x${h} black/black adder ${bbAdd} under ${bbObs}`);
  const white = quoteOf(series, type, w, h);
  const bw = archBlack(series, type, 'bw', w, h);
  const bb = archBlack(series, type, 'bb', w, h);
  const whiteRaw = white.base + white.perUI * u;
  if (!white.errors.length) {
    check(bw.provisional === true && bw.pricePending === false && bw.material === ceilDollar(whiteRaw + bwAdd), `${series} ${type} ${w}x${h} black/white price ${bw.material}`);
    check(bb.provisional === true && bb.material === ceilDollar(whiteRaw + bbAdd), `${series} ${type} ${w}x${h} black/black price ${bb.material}`);
    check(bw.material + 1e-9 >= ceilDollar(whiteRaw + bwObs), `${series} ${type} ${w}x${h} black/white under the source adder`);
  } else {
    check(Math.abs(bw.adder - bwAdd) < 0.001 && bw.provisional === true, `${series} ${type} ${w}x${h} adder still applies when the size is blocked ${bw.adder}`);
  }
}
const v300bw = quoteOf('V300', 'arch_xo', 60, 72, { color: 'bw' });
const v300whiteRaw = 379 + 8.98 * 132;
const v300bwAdd = 174 + 2.07 * 132;
check(v300bw.errors.length === 0 && v300bw.provisional === true && v300bw.material === ceilDollar(v300whiteRaw + v300bwAdd), 'V300 arch XO 60x72 black/white ' + v300bw.material);
check(v300bwAdd + 1e-9 >= 446.27 && Math.abs(v300bwAdd - 447.24) < 0.001, 'V300 60x72 black/white adder ' + v300bwAdd);
const v300adobe = quoteOf('V300', 'arch_xo', 60, 72, { color: 'adobe' });
check(v300adobe.material === quoteOf('V300', 'arch_xo', 60, 72).material && v300adobe.notes.some((n) => /Adobe priced as White/.test(n)), 'V300 arch Adobe stays on the white price');
check(quoteOf('V300', 'arch_xo', 60, 72, { color: 'bronze' }).pricePending === true, 'V300 arch bronze stays pending');
const shFloor = quoteOf('V300', 'arch_sh', 9.5, 41.5, { color: 'bw' });
const smallU = 9.5 + 41.5;
const underFloor = -195 + 4.15 * smallU;
check(underFloor < 253 && shFloor.errors.length === 0 && shFloor.material === ceilDollar(507 + 6.58 * smallU + 253), 'V300 arch single hung black/white uses the $253 floor ' + shFloor.material);
check(quoteOf('V400', 'arch_xo', 60, 72, { color: 'bw' }).material === ceilDollar(xoRaw + 562.78), 'V400 flat black adder still works');

if (errs.length) {
  console.log('FAILED', errs.length);
  for (const e of errs) console.log(' -', e);
  process.exit(1);
}
console.log(`ok  OneLink ${windows} windows, doors, PureView, upcharges. V250 XO 36x24 $${win('V250', 'hslider', 36, 24).toFixed(2)}  V300 standard 71.5x79.5 $${win('V300', '2panel', 71.5, 79.5).toFixed(2)}  V300 custom 72x80 $${win('V300', '2panel', 72, 80).toFixed(2)}`);
