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

// Double casement and equal-leg arch top: placeholder rates, one edit site.
const pending = data.milgardOnelink.pendingWindows;
check(pending && pending.pricePending === true, 'pendingWindows is the placeholder block');
check(pending.styles.dcasement.perUI === 0 && pending.styles.archtop.perUI === 0, 'placeholder perUI stays 0 until a real rate is entered');
const dc = styleLimits(data.milgardOnelink, 'V400', 'dcasement');
check(dc.sashWmin === 14 && dc.sashWmax === 36 && dc.sashes === 2 && dc.wmin === 28 && dc.wmax === 72 && dc.hmin === 17.5 && dc.hmax === 72, 'double casement uses casement limits per sash ' + JSON.stringify(dc));
check(dc.wmax !== 42, 'double casement does not use the V400 single-casement width exception');
const arch400 = styleLimits(data.milgardOnelink, 'V400', 'archtop');
const arch250 = styleLimits(data.milgardOnelink, 'V250', 'archtop');
check(arch400.hmax === 78, 'V400 arch top overall height max ' + arch400.hmax);
check(arch250.hmax === 96 && arch250.wmin === 14, 'other series arch top stays a placeholder ' + JSON.stringify(arch250));
const quoteOf = (series, type, w, h, extra = {}) => milgardQuote(data.milgardOnelink, { brand: 'milgard', series, type, color: 'ww', w, h, ...extra });
const dcOk = quoteOf('V250', 'dcasement', 30, 48);
check(dcOk.pricePending === true && dcOk.errors.length === 0 && dcOk.material === 0, '30x48 double casement is allowed and pending');
check(dcOk.notes.some((n) => /Price pending/.test(n)), 'pending note is on the quote');
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
check(!A250_WINDOW_STYLES.includes('dcasement') && !A250_WINDOW_STYLES.includes('archtop'), 'A250 style list hides the new types');
const pendingLine = { brand: 'milgard', series: 'V250', type: 'dcasement', color: 'ww', w: 30, h: 48, qty: 1 };
const pendingPrice = priceWindow(pendingLine);
check(pendingPrice.pricePending === true && pendingPrice.unit === 0 && pendingPrice.mode === 'onelink', 'screen stores $0 while the price is pending');
check(!isMilgardDoorLine(pendingLine), 'double casement is a window');
for (const type of ['dcasement', 'archtop']) {
  const line = { brand: 'milgard', series: 'V300', type, w: 36, h: 48 };
  check(installUnit({ type: 'standard', surcharges: [] }, line) === 360, type + ' retrofit labor');
  check(installUnit({ type: 'block', surcharges: [] }, line) === 380, type + ' block labor');
  check(installUnit({ type: 'stucco-fin', surcharges: [] }, line) === 400, type + ' nail fin labor');
  check(addonUnit({ type: 'standard', surcharges: ['oversize'] }, line) === 85, type + ' large');
  check(addonUnit({ type: 'standard', surcharges: ['second-story'] }, line) === 75, type + ' two-story');
}
const live = data.milgardOnelink;
const ready = JSON.parse(JSON.stringify(live));
ready.pendingWindows.pricePending = false;
ready.pendingWindows.styles.dcasement.perUI = 12.5;
data.milgardOnelink = ready;
const real = milgardQuote(ready, { brand: 'milgard', series: 'V300', type: 'dcasement', color: 'ww', w: 30, h: 48, tempered: true, grids: 'flat' });
check(real.pricePending === false && Math.abs(real.material - 78 * 12.5) < 0.001, 'real perUI is (W+H) x rate and ignores option upcharges ' + real.material);
const readyShown = priceWindow({ brand: 'milgard', series: 'V300', type: 'dcasement', color: 'ww', w: 30, h: 48, qty: 2 });
check(readyShown.pricePending === false && Math.abs(readyShown.unit - 975) < 0.001, 'priceWindow uses the real perUI once pending is off ' + readyShown.unit);
data.milgardOnelink = live;

if (errs.length) {
  console.log('FAILED', errs.length);
  for (const e of errs) console.log(' -', e);
  process.exit(1);
}
console.log(`ok  OneLink ${windows} windows, doors, PureView, upcharges. V250 XO 36x24 $${win('V250', 'hslider', 36, 24).toFixed(2)}  V300 standard 71.5x79.5 $${win('V300', '2panel', 71.5, 79.5).toFixed(2)}  V300 custom 72x80 $${win('V300', '2panel', 72, 80).toFixed(2)}`);
