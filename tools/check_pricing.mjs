// Spot-check the sales pricing rules. Run: node tools/check_pricing.mjs
import { readFileSync } from 'node:fs';
import { data, settings, priceWindow, totals, stuccoState, installUnit, addonUnit, summaryLines, parsePercentDiscount, clampPercentDiscount } from '../js/core.js';
import { contractPay } from '../js/pdf.js';

const read = (name) => JSON.parse(readFileSync(new URL('../data/' + name, import.meta.url), 'utf8'));
data.rates = read('rates.json');
data.options = read('options.json');
data.install = read('install.json');
data.promos = read('promos.json');
data.agreement = read('purchase-agreement.json');
data.frameTypes = read('frame-types.json');
data.obscureGlass = { patterns: [{ id: 'satin', name: 'Satin Etch' }] };
settings.rateSet = 'p75';
settings.roundToDollar = false;
settings.taxOn = 'windows';
settings.taxPct = 0;

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => {
  if (Math.abs(actual - expected) > 0.001) fail(`${msg}: got ${actual}, expected ${expected}`);
};

const byId = (id) => data.install.types.find((t) => t.id === id);
eq(byId('standard').price, 360, 'retrofit');
eq(byId('stucco-fin').price, 400, 'nail fin');
eq(byId('block').price, 380, 'block');
if (byId('standard').name !== 'Retrofit/Jump frame') fail('retrofit name');
if (byId('stucco-fin').name !== 'R&R stucco / nailing fin') fail('nail fin name');
if (byId('block').name !== 'Block frame install') fail('block name');
if (data.frameTypes.types.find((t) => t.id === 'zbar').installType !== 'standard') fail('zbar should be retrofit');
eq(data.install.surcharges.find((s) => s.id === 'second-story').amount, 75, '2nd story');
eq(data.install.surcharges.find((s) => s.id === 'difficult-access').amount, 75, 'access');
eq(data.install.surcharges.find((s) => s.id === 'oversize').amount, 85, 'oversize');
eq(data.install.stuccoRepair.price, 650, 'stucco');
const glass = data.options.glass.map((g) => g.id);
if (glass.join(',') !== 'laminated,tempered,obscure') fail('glass list ' + glass.join(','));
for (const g of data.options.glass) {
  if (g.price.type !== 'percent' || g.price.amount !== 12) fail(g.id + ' should be 12%');
}

// Synthetic rate so (50+50) inches prices at exactly $1,000 before glass.
const stored = 1000 * 0.55 / (100 * 0.60);
data.rates.brands[0].rates['V250|ww|hslider'] = { p75: stored, max: stored, estimated: false, n: 5 };

function line(extra) {
  const p = priceWindow({ brand: 'milgard', series: 'V250', color: 'ww', type: 'hslider', w: 50, h: 50, qty: 1, options: extra.options });
  return { id: extra.id, label: extra.label, qty: 1, unit: p.unit, unitBase: p.unitBase, optionsEach: p.optionsEach, options: extra.options, install: extra.install };
}
const retrofit = (surcharges) => ({ type: 'standard', surcharges, override: null, custom: null, frameType: 'zbar' });

const tempered = line({ id: 'a', label: 'Window 1', options: ['tempered'], install: retrofit(['second-story']) });
const plain = line({ id: 'b', label: 'Window 2', options: ['tempered'], install: retrofit([]) });
eq(tempered.unitBase, 1000, 'window cost');
eq(tempered.optionsEach, 120, 'tempered 12%');
eq(tempered.unit, 1120, 'window with glass');
eq(installUnit(tempered.install), 360, 'labor each');
eq(addonUnit(tempered.install), 75, 'one 2nd story');
eq(addonUnit(plain.install), 0, 'no add-on');

const e = { lines: [tempered, plain], extras: [], promoCode: 'NOBLE10', taxPct: 0, stuccoRepair: { on: false, qty: null } };
const t = totals(e);
eq(t.windows, 2240, 'windows before discount');
eq(t.discount, 224, 'NOBLE10');
eq(t.windows - t.discount, 2016, 'windows after NOBLE10');
eq(t.install, 720, 'labor');
eq(t.addons, 75, 'add-on');
eq(t.stucco, 0, 'no stucco');
eq(t.labor, 795, 'client labor rolls in the add-on');
eq(t.shipping, 150, 'shipping is $150');
eq(t.taxable, 2016, 'tax base is materials after the promo');
eq(t.tax, 183.46, '9.1% of $2,016');
eq(t.total, 3144.46, 'total');
eq(data.agreement.depositPct, 60, 'deposit percent');
const pay = contractPay(t.total, data.agreement.depositPct);
eq(pay.deposit, 1886.68, 'deposit is 60%');
eq(pay.balance, 1257.78, 'final is 40%');
eq(pay.deposit + pay.balance, pay.total, 'deposit plus final');

const stacked = priceWindow({ brand: 'milgard', series: 'V250', color: 'ww', type: 'hslider', w: 50, h: 50, qty: 1, options: ['laminated', 'tempered', 'obscure', 'satin'] });
eq(stacked.optionsEach, 360, 'three glass options stack at 36%, pattern is free');
const two = priceWindow({ brand: 'milgard', series: 'V250', color: 'ww', type: 'hslider', w: 50, h: 50, qty: 2, options: ['laminated', 'tempered'] });
eq(two.optionsEach, 240, 'two glass options are 24%');

const qty2 = { ...tempered, qty: 2, install: retrofit(['second-story', 'difficult-access', 'oversize']) };
eq(addonUnit(qty2.install) * qty2.qty, (75 + 75 + 85) * 2, 'add-ons times quantity');

const withStucco = { ...e, stuccoRepair: { on: true, qty: null } };
const ts = totals(withStucco);
eq(stuccoState(withStucco).qty, 2, 'stucco qty defaults to window count');
eq(ts.stucco, 1300, 'stucco 650 x 2');
eq(ts.discount, 224, 'promo ignores stucco');
eq(ts.labor, 795 + 1300, 'stucco rolls into Installation / Labor');
eq(ts.tax, 183.46, 'stucco is not taxed');
eq(ts.shipping, 150, 'promo does not change shipping');
eq(ts.total, 3144.46 + 1300, 'stucco adds on');
const explicit = totals({ ...e, stuccoRepair: { on: true, qty: 1 } });
eq(explicit.stucco, 650, 'stucco own quantity');
eq(explicit.discount, 224, 'promo ignores explicit stucco');

const bogo = totals({ ...e, lines: Array.from({ length: 5 }, (_, i) => ({ ...plain, id: 'w' + i, install: retrofit(i === 0 ? ['second-story'] : []) })), promoCode: 'NOBLEBOGO' });
eq(bogo.discount, 1120, 'bogo frees one window including glass');
eq(bogo.install, 360 * 5, 'bogo leaves labor');
eq(bogo.addons, 75, 'bogo leaves the add-on');

const five = totals({ ...e, promoCode: 'NOBLE5' });
eq(five.discount, 112, 'NOBLE5 is 5% of windows with glass');
eq(five.install, 720, 'NOBLE5 leaves labor');
eq(five.addons, 75, 'NOBLE5 leaves add-ons');

const rows = summaryLines(t);
const labels = rows.map((r) => r.id).join(',');
if (labels !== 'windows,discount,install,shipping,tax') fail('summary lines ' + labels);
const rowById = Object.fromEntries(rows.map((r) => [r.id, r]));
eq(rowById.install.label, 'Installation / Labor', 'labor label');
eq(rowById.install.amount, 795, 'one labor line');
eq(rowById.shipping.label, 'Shipping & Handling', 'shipping label');
eq(rowById.shipping.amount, 150, 'shipping line');
eq(rowById.tax.label, 'Sales Tax (9.1%)', 'tax label');
eq(rowById.tax.amount, 183.46, 'tax line');
const withExtra = totals({ ...e, extras: [{ amount: 200 }] });
eq(withExtra.tax, 183.46, 'extras are not taxed');
eq(withExtra.total, 3144.46 + 200, 'extras add after tax');

const fiveOff = totals({ ...e, percentDiscount: 5 });
eq(fiveOff.percentDiscountAmount, 100.8, '5% after NOBLE10 is $100.80');
eq(fiveOff.discount, 224, 'promo stays on its own line');
eq(fiveOff.labor, 795, 'percent discount leaves labor');
eq(fiveOff.shipping, 150, 'percent discount leaves shipping');
eq(fiveOff.taxable, 1915.2, 'tax base after promo then percent');
eq(fiveOff.tax, 174.28, '9.1% of $1,915.20');
eq(fiveOff.total, 3034.48, 'total after 5% materials discount');
const fivePay = contractPay(fiveOff.total, 60);
eq(fivePay.deposit, 1820.69, '60% of the discounted total');
eq(fivePay.balance, 1213.79, '40% final');
const fiveRows = summaryLines(fiveOff).map((r) => r.id).join(',');
if (fiveRows !== 'windows,discount,percentDiscount,install,shipping,tax') fail('percent line missing ' + fiveRows);
eq(summaryLines(fiveOff).find((r) => r.id === 'percentDiscount').amount, -100.8, 'percent line amount');
eq(summaryLines(fiveOff).find((r) => r.id === 'percentDiscount').label, 'Additional discount (5%)', 'percent line label');

eq(clampPercentDiscount(15), 10, 'stored percent cannot exceed 10');
eq(clampPercentDiscount(-4), 0, 'negative percent clamps to 0');
const over = parsePercentDiscount('12');
if (over.ok || over.error !== 'Discount cannot be more than 10%.') fail('12% should be rejected');
eq(parsePercentDiscount('10').value, 10, '10% is allowed');
eq(parsePercentDiscount('-2').value, 0, 'negative entry clamps');
eq(totals({ ...e, percentDiscount: 15 }).percentDiscountAmount, 201.6, 'a stored 15% is clamped to 10% of $2,016');

if (process.exitCode) console.error('pricing check failed');
else console.log('pricing check ok', { windowsNet: 2016, labor: 795, shipping: 150, tax: 183.46, total: 3144.46, deposit: 1886.68, final: 1257.78, with5pct: 3034.48 });
