// AX650 customer prices from OneLink quote MQPASG000219-1. The 45% margin is already
// in the stored amounts. This checks every band, both edges of each band, and that
// priceWindow does not apply another margin.
import { readFileSync } from 'node:fs';
import { data, priceWindow, totals, summaryLines, installLabel, rowAmountText, INSTALL_TBD } from '../js/core.js';
import { parseInches, ax650Quote } from '../js/ax650.js';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
data.rates = load('data/rates.json');
data.variableRates = load('data/variable-rates.json');
data.options = load('data/options.json');
data.install = load('data/install.json');
data.promos = load('data/promos.json');
data.settingsDefault = load('data/settings.default.json');
data.ax650 = load('data/milgard-ax650.json');

const errs = [];
const check = (ok, msg) => { if (!ok) errs.push(msg); };
const near = (actual, expected, msg) => check(Math.abs(Number(actual) - expected) < 0.001, `${msg}: ${actual} != ${expected}`);

const PRICE = {
  stack3: [13995.43, 15392.38, 19541.43],
  stack4: [20482.47, 21710.20, 27708.14],
  bifold3: [16495.21, 19714.15, 22250.91],
  bifold4: [22375.55, 25255.48, 27877.83],
};
const WIDTH = {
  stack3: 120,
  stack4: 180,
  bifold3: 110,
  bifold4: 130,
};
const EDGES = {
  stack3: [107.5, 179.5],
  stack4: [141 + 15 / 16, 237 + 15 / 16],
  bifold3: [106 + 1 / 16, 117.5],
  bifold4: [117.5, 141.5],
};

function line(type, w, h, extra = {}) {
  return { brand: 'milgard', series: 'AX650', type, color: 'ww', w, h, qty: 1, pocket: false, ...extra };
}
function price(type, w, h, extra) {
  return priceWindow(line(type, w, h, extra));
}

check(parseInches('141 15/16') === 141 + 15 / 16, '141 15/16');
check(parseInches('237 15/16') === 237 + 15 / 16, '237 15/16');
check(parseInches('106 1/16') === 106 + 1 / 16, '106 1/16');
check(parseInches('107 1/2') === 107.5, '107 1/2');
check(parseInches('107.5') === 107.5, 'decimal 107.5');
check(parseInches('119 1/2') === 119.5, '119 1/2');
check(parseInches('79 1/2') === 79.5, '79 1/2');

for (const [type, bands] of Object.entries(PRICE)) {
  const [wmin, wmax] = EDGES[type];
  const samples = [
    [80, 0],
    [79.5, 0],
    [80.01, 1],
    [96, 1],
    [96.01, 2],
    [119.5, 2],
  ];
  for (const [h, band] of samples) {
    const p = price(type, WIDTH[type], h);
    check(!p.blocked, `${type} ${h} should price`);
    near(p?.unit, bands[band], `${type} height ${h} band ${band + 1}`);
    for (const color of ['ww', 'warmtone', 'bronze-anodized', 'satin-anodized']) {
      near(price(type, WIDTH[type], h, { color }).unit, bands[band], `${type} ${color} ${h}`);
    }
  }
  near(price(type, wmin, 80).unit, bands[0], `${type} min width`);
  near(price(type, wmax, 80).unit, bands[0], `${type} max width`);
  near(price(type, ' ' + wmin, '80').unit, bands[0], `${type} numeric string width`);
  check(price(type, wmin - 0.01, 80).blocked, `${type} width just under min`);
  check(price(type, wmax + 0.01, 80).blocked, `${type} width just over max`);
  const low = price(type, WIDTH[type], 79.49);
  const high = price(type, WIDTH[type], 119.51);
  check(low.blocked && /Height must be 79 1\/2" to 119 1\/2"/.test(low.errors.join(' ')), `${type} 79.49 rejected`);
  check(high.blocked && /Height must be/.test(high.errors.join(' ')), `${type} 119.51 rejected`);
}

const widthMsg = price('stack3', 100, 80);
check(widthMsg.blocked && widthMsg.errors[0] === 'Width must be 107 1/2" to 179 1/2" for 3-panel stacking', '3-panel stacking width message: ' + widthMsg.errors.join(' | '));
check(price('stack3', '107 1/2', '80').unit === 13995.43, 'fraction width prices band 1');
check(price('stack4', '141 15/16', 80).unit === 20482.47, '141 15/16 is the 4-panel minimum');
check(price('stack4', '237 15/16', 96.01).unit === 27708.14, '237 15/16 at band 3');
check(price('bifold3', '106 1/16', 80).unit === 16495.21, '106 1/16 bifold minimum');
check(price('bifold4', '117.5', 80).unit === 22375.55, '4-panel bifold shares 117.5');
check(price('bifold3', 117.5, 80).unit === 16495.21, '3-panel bifold also allows 117.5');

const pocket = price('stack4', 180, 80, { pocket: true });
near(pocket.unit, 20482.47 + 1428.14, '4-panel pocket band 1');
near(price('stack4', 180, 90, { pocket: true }).unit, 21710.20 + 1428.14, '4-panel pocket band 2');
near(price('stack4', 180, 100, { pocket: true }).unit, 27708.14 + 1428.14, '4-panel pocket band 3');
near(price('stack3', 120, 80, { pocket: true }).unit, 13995.43, 'pocket is ignored on 3-panel stacking');
near(price('bifold4', 130, 80, { pocket: true }).unit, 22375.55, 'pocket is ignored on bifold');
check(ax650Quote(data.ax650, line('nope', 120, 80)).errors.length > 0, 'unknown model is refused');

const book = data.ax650;
check(book.applyMargin === false && book.pricesAre === 'customer', 'file says not to apply margin');
const raw = book.models[0].customerPrice[0];
const quoted = price('stack3', 120, 80).unit;
near(quoted, raw, 'engine returns the stored customer price');
check(Math.abs(quoted - raw / 0.55) > 1, 'engine does not divide by 0.55');
check(Math.abs(quoted - raw * (0.6 / 0.55)) > 1, 'engine does not run the fallback margin factor');

const axLine = line('stack3', 120, 80);
axLine.unit = quoted;
axLine.install = { type: 'ax650', pending: true, surcharges: [] };
check(installLabel(axLine.install, axLine) === INSTALL_TBD, 'AX650 install label is TBD');
const only = totals({ lines: [axLine], extras: [], stuccoRepair: { on: false }, promoCode: '', percentDiscount: 0 });
check(only.laborPending === true && only.labor === 0, 'AX650 labor is not a dollar amount');
const installRow = summaryLines(only).find((r) => r.id === 'install');
check(rowAmountText(installRow) === 'TBD', 'Installation displays TBD, not ' + rowAmountText(installRow));
check(rowAmountText(installRow) !== '$0.00', 'Installation is not $0');
near(only.windows, 13995.43, 'door price is in the material total');
near(only.tax, 1273.58, 'tax on the door');
near(only.total, 15419.01, 'total excludes unknown labor');

const mixed = totals({
  lines: [
    axLine,
    { brand: 'milgard', series: 'V300', type: 'hslider', w: 36, h: 48, qty: 1, unit: 1000, install: { type: 'standard', surcharges: [] } },
  ],
  extras: [], stuccoRepair: { on: false }, promoCode: '', percentDiscount: 0,
});
const mixedRow = summaryLines(mixed).find((r) => r.id === 'install');
check(rowAmountText(mixedRow) === '$360.00 + TBD', 'known labor stays and AX650 stays TBD: ' + rowAmountText(mixedRow));
near(mixed.labor, 360, 'mixed labor adds only the known install');

if (errs.length) {
  console.log('FAILED');
  for (const e of errs) console.log(' -', e);
  process.exit(1);
}
console.log('ok  AX650 customer prices, band edges, pocket, and Installation TBD');
