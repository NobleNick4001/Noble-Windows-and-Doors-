// PRL dealer formulas, the shared 45% customer step, and the AX650 install schedule.
import { readFileSync } from 'node:fs';
import { data, priceWindow, installUnit, totals, dealerToCustomer, quoteLine, compactWindowLine } from '../js/core.js';
import { prlQuote, prlQuoteMessage } from '../js/prl.js';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
data.rates = load('data/rates.json');
data.variableRates = load('data/variable-rates.json');
data.options = load('data/options.json');
data.install = load('data/install.json');
data.promos = load('data/promos.json');
data.ax650 = load('data/milgard-ax650.json');
data.prl = load('data/prl.json');

const errs = [];
const check = (ok, msg) => { if (!ok) errs.push(msg); };
const near = (actual, expected, msg) => check(Math.abs(Number(actual) - expected) < 0.02, `${msg}: ${actual} != ${expected}`);
const money = (n) => Math.round(Number(n) * 100) / 100;

function line(extra = {}) {
  return {
    brand: 'prl', series: 'max', type: 'multislide', panels: 3, color: 'bronze-anodized',
    w: 144, h: 96, qty: 1, unitsPerLine: 1, glass: 'sb70', rolling: 'bottom',
    thermal: false, nailOn: false, finish: 'bronze', layout: 'standard',
    screen: false, bifoldThermal: false, label: 'Family room',
    install: { type: 'prl', surcharges: [] },
    ...extra,
  };
}

const sq = (w, h) => w * h / 144;
const aRaw = 1451.53 * 3 + 30.81 * sq(144, 96) - 1236.96;
const a = line();
const aq = prlQuote(data.prl, a);
near(aq.raw, aRaw, '3-panel 144x96 formula');
check(aq.cost === 6075, '3-panel 144x96 dealer ' + aq.cost);
const ap = priceWindow(a);
near(ap.unit, money(6075 / (1 - data.rates.grossMargin)), '3-panel customer');
near(dealerToCustomer(6075), 6075 / 0.55, 'dealerToCustomer is dealer / 0.55');
check(installUnit(a.install, a) === 2000, '3-panel install ' + installUnit(a.install, a));

const bRaw = (1451.53 * 4 + 30.81 * sq(192, 96) - 1236.96) * 1.21 + 455;
const b = line({ panels: 4, w: 192, thermal: true, nailOn: true });
const bq = prlQuote(data.prl, b);
near(bq.raw, bRaw, 'thermal then nail-on');
check(bq.cost === Math.round(bRaw), '4-panel thermal nail-on dealer ' + bq.cost);
check(Math.abs(bRaw - ((1451.53 * 4 + 30.81 * sq(192, 96) - 1236.96 + 455) * 1.21)) > 1, 'nail-on is not inside the thermal multiplier');
const bp = priceWindow(b);
near(bp.unit, money(bq.cost / 0.55), '4-panel customer');
check(installUnit(b.install, b) === 2500, '4-panel install');

const cRaw = 1392.99 * 4 + 25.99 * sq(144, 96);
const c = line({ series: 'bifold', type: 'bifold', panels: 4, rolling: 'top' });
const cq = prlQuote(data.prl, c);
near(cq.raw, cRaw, 'bifold formula');
check(cq.cost === 8067, 'bifold 4-panel 144x96 dealer ' + cq.cost);
const cp = priceWindow(c);
near(cp.unit, money(8067 / 0.55), 'bifold customer');
check(installUnit(c.install, c) === 2500, 'bifold install');
const bottom = prlQuote(data.prl, line({ series: 'bifold', type: 'bifold', panels: 4, rolling: 'bottom' }));
near(bottom.raw, cRaw * 1.0555, 'bottom-rolling factor');
check(bottom.cost === Math.round(cRaw * 1.0555), 'bottom-rolling dealer ' + bottom.cost);

const eaRaw = aRaw * 1.03;
const ea = prlQuote(data.prl, line({ glass: 'ea' }));
near(ea.raw, eaRaw, 'Energy Advantage on multi-slide');
check(!ea.quoteRequired && ea.cost === Math.round(eaRaw), 'Energy Advantage is priced on multi-slide');

const narrow = prlQuote(data.prl, line({ w: 100 }));
check(!narrow.quoteRequired && narrow.errors.some((e) => /Outside the quoted range/.test(e)) && narrow.cost == null, 'narrow opening is not quoted');
check(priceWindow(line({ w: 100 })).unit == null, 'narrow opening has no price');
check(installUnit(line({ w: 100 }).install, line({ w: 100 })) === 0, 'an unquoted opening adds no installation');

const two = prlQuote(data.prl, line({ panels: 2 }));
check(!two.quoteRequired && two.cost == null && two.errors.length > 0, '2 panels are outside the range');
const six = prlQuote(data.prl, line({ panels: 6, w: 200 }));
check(six.quoteRequired && six.cost == null && /Get a PRL quote/.test(prlQuoteMessage(six)), '6 panels say Get a PRL quote');
const sixNarrow = prlQuote(data.prl, line({ panels: 6, w: 100 }));
check(sixNarrow.quoteRequired && sixNarrow.errors.some((e) => /width/i.test(e)), '6 panels still flag a bad width');

for (const extra of [
  { finish: 'other' },
  { layout: 'pocket' },
  { layout: 'corner' },
  { series: 'bifold', type: 'bifold', rolling: 'top', screen: true },
  { series: 'bifold', type: 'bifold', rolling: 'top', bifoldThermal: true },
  { series: 'bifold', type: 'bifold', rolling: 'top', glass: 'ea' },
]) {
  const q = prlQuote(data.prl, line(extra));
  check(q.quoteRequired && q.cost == null && /Get a PRL quote/.test(prlQuoteMessage(q)), 'not priced ' + JSON.stringify(extra));
  check(priceWindow(line(extra)).unit == null, 'no customer price ' + JSON.stringify(extra));
}

check(prlQuote(data.prl, line({ w: 143, h: 80 })).cost != null, 'multi-slide minimum is quoted');
check(prlQuote(data.prl, line({ w: 287.5, h: 120 })).cost != null, 'multi-slide maximum is quoted');
check(prlQuote(data.prl, line({ w: 287.6, h: 96 })).cost == null, 'multi-slide over 287.5 is not quoted');
check(prlQuote(data.prl, line({ series: 'bifold', type: 'bifold', rolling: 'top', w: 95.5, h: 80 })).cost != null, 'bifold minimum is quoted');
check(prlQuote(data.prl, line({ series: 'bifold', type: 'bifold', rolling: 'top', w: 168, h: 119 })).cost != null, 'bifold maximum is quoted');
check(prlQuote(data.prl, line({ series: 'bifold', type: 'bifold', rolling: 'top', h: 119.1 })).cost == null, 'bifold over 119 is not quoted');

const saved = { ...a, unit: ap.unit };
const spoken = JSON.stringify(quoteLine(saved)) + JSON.stringify(compactWindowLine(saved));
check(!/margin|dealer|\bcost\b/i.test(spoken), 'quote lines do not say cost or margin');
check(quoteLine(saved).title.startsWith('PRL '), 'quote title names PRL');

const job = totals({ lines: [saved], extras: [], promoCode: '', percentDiscount: 0, stuccoRepair: { on: false } });
near(job.windows, ap.unit, 'product is the materials line');
near(job.install, 2000, 'installation is separate');
near(job.labor, 2000, 'installation total is that one price');

if (errs.length) {
  console.error(errs.join('\n'));
  process.exit(1);
}
console.log(`ok  PRL 3x144x96 dealer $${aq.cost} customer $${ap.unit} install $2000`);
console.log(`ok  PRL thermal+screen dealer $${bq.cost} customer $${bp.unit}`);
console.log(`ok  PRL bifold dealer $${cq.cost} customer $${cp.unit} bottom $${bottom.cost}`);
