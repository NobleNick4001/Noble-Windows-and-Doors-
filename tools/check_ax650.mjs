// AX650 customer prices. The 45% margin is already in the stored amounts.
// Each band is flat for any allowed width. Pocket is its own model, not an adder.
import { readFileSync } from 'node:fs';
import { data, priceWindow, totals, summaryLines, installLabel, rowAmountText, INSTALL_TBD } from '../js/core.js';
import { parseInches } from '../js/ax650.js';

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
  stack2: [11492.22, 12643.57, 14636.36],
  stack3: [16637.12, 17611.28, 20988.34],
  stack4: [22381.90, 23689.86, 28206.98],
  pocket2: [12098.76, 12667.46, 15251.52],
  pocket3: [17726.08, 18645.83, 20174.10],
  pocket4: [22565.72, 23774.13, 28591.87],
  bifold3: [17320.23, 19715.01, 22251.89],
  bifold4: [23136.01, 25256.59, 27879.05],
  bifold5: [30047.82, 35436.50, 40298.36],
};
const EDGES = {
  stack2: [71.5, 119.5],
  stack3: [107.5, 179.5],
  stack4: [141 + 15 / 16, 237 + 15 / 16],
  pocket2: [70.25, 120 + 7 / 16],
  pocket3: [104 + 5 / 8, 176 + 5 / 8],
  pocket4: [139 + 1 / 16, 235 + 1 / 16],
  bifold3: [106 + 1 / 16, 117.5],
  bifold4: [117.5, 141.5],
  bifold5: [176.25, 198],
};

function line(type, w, h, extra = {}) {
  return { brand: 'milgard', series: 'AX650', type, color: 'ww', w, h, qty: 1, pocket: false, ...extra };
}
function price(type, w, h, extra) {
  return priceWindow(line(type, w, h, extra));
}

check(parseInches('141 15/16') === 141 + 15 / 16, '141 15/16');
check(parseInches('120 7/16') === 120 + 7 / 16, '120 7/16');
check(parseInches('104 5/8') === 104 + 5 / 8, '104 5/8');
check(parseInches('139 1/16') === 139 + 1 / 16, '139 1/16');
check(parseInches('176 1/4') === 176.25, '176 1/4');
check(data.ax650.pocket == null, 'no pocket adder');

for (const [type, bands] of Object.entries(PRICE)) {
  const [wmin, wmax] = EDGES[type];
  const mid = (wmin + wmax) / 2;
  const samples = [[79.5, 0], [80, 0], [80.01, 1], [96, 1], [96.01, 2], [119.5, 2]];
  for (const [h, band] of samples) {
    const p = price(type, mid, h);
    check(!p.blocked, `${type} ${h} should price`);
    near(p?.unit, bands[band], `${type} height ${h} band ${band + 1}`);
    near(price(type, wmin, h).unit, bands[band], `${type} min width is the same band price at ${h}`);
    near(price(type, wmax, h).unit, bands[band], `${type} max width is the same band price at ${h}`);
    for (const color of ['ww', 'warmtone', 'bronze-anodized', 'satin-anodized']) {
      near(price(type, mid, h, { color }).unit, bands[band], `${type} ${color} ${h}`);
    }
  }
  check(price(type, wmin - 0.01, 80).blocked, `${type} width just under min`);
  check(price(type, wmax + 0.01, 80).blocked, `${type} width just over max`);
  check(price(type, mid, 79.49).blocked, `${type} 79.49 rejected`);
  check(price(type, mid, 119.51).blocked, `${type} 119.51 rejected`);
  near(price(type, mid, 80, { pocket: true }).unit, bands[0], `${type} ignores a leftover pocket flag`);
}

near(price('stack3', 120, 80).unit, 16637.12, 'stacking 3 at 120x80');
near(price('pocket4', 180, 90).unit, 23774.13, 'pocket 4 at 180x90');
near(price('bifold5', 190, 110).unit, 40298.36, 'bifold 5 at 190x110');
const widthMsg = price('stack3', 100, 80);
check(widthMsg.blocked && widthMsg.errors[0] === 'Width must be 107 1/2" to 179 1/2" for 3-panel stacking', 'stacking width message: ' + widthMsg.errors.join(' | '));

const raw = data.ax650.models.find((m) => m.id === 'stack3').customerPrice[0];
const quoted = price('stack3', 120, 80).unit;
near(quoted, raw, 'engine returns the stored customer price');
check(Math.abs(quoted - raw / 0.55) > 1, 'engine does not divide by 0.55');

const axLine = line('stack3', 120, 80);
axLine.unit = quoted;
axLine.install = { type: 'ax650', pending: true, surcharges: [] };
check(installLabel(axLine.install, axLine) === INSTALL_TBD, 'AX650 install label is TBD');
const only = totals({ lines: [axLine], extras: [], stuccoRepair: { on: false }, promoCode: '', percentDiscount: 0 });
const installRow = summaryLines(only).find((r) => r.id === 'install');
check(rowAmountText(installRow) === 'TBD', 'Installation displays TBD, not ' + rowAmountText(installRow));
near(only.windows, 16637.12, 'door price is in the material total');
near(only.tax, 1513.98, 'tax on the door');
near(only.total, 18301.10, 'total excludes unknown labor');

if (errs.length) {
  console.log('FAILED');
  for (const e of errs) console.log(' -', e);
  process.exit(1);
}
console.log('ok  AX650 replacement customer prices, flat bands, pocket models, and Installation TBD');
