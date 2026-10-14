// Runs every tools/validation.json line through the app pricing function.
// Usage: node tools/check_variable_rates.mjs
import { readFileSync } from 'fs';
import { data, materialUnitPrice, priceWindow, getRate, totals, installUnit } from '../js/core.js';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
data.rates = load('data/rates.json');
data.variableRates = load('data/variable-rates.json');
data.options = load('data/options.json');
data.install = load('data/install.json');
data.promos = load('data/promos.json');

const validation = load('tools/validation.json');
const lines = validation.lines || [];
const errs = [];
const check = (ok, msg) => { if (!ok) errs.push(msg); };

check(lines.length === 169, `expected 169 validation lines, got ${lines.length}`);

for (const line of lines) {
  const unit = materialUnitPrice(line);
  const where = `${line.source} #${line.line} ${line.brand} ${line.series} ${line.type} ${line.color} ${line.w}x${line.h}`;
  check(typeof unit === 'number' && Number.isFinite(unit), where + ' did not price');
  if (typeof unit !== 'number') continue;
  check(unit >= line.expectedMinUnitPrice - 0.005, `${where} price ${unit} < minimum ${line.expectedMinUnitPrice}`);
  check(Math.abs(unit - line.modelUnitPrice) <= 0.02, `${where} price ${unit} != model ${line.modelUnitPrice}`);
  // The screen uses the same builder.
  const shown = priceWindow({ ...line, qty: 1 });
  check(shown && shown.unit === unit, where + ' priceWindow diverged from materialUnitPrice');
}

// Janice Williams V300 White Z-bar quote: Z-bar comes from the frame type, not a checkbox.
const jw = { brand: 'milgard', series: 'V300', type: 'hslider', color: 'ww', w: 45, h: 37.75, addons: [] };
check(materialUnitPrice({ ...jw, install: { frameType: 'zbar' } }) >= 677.06, 'V300 white HV with Z-bar clears the quote');
check(Math.abs(materialUnitPrice({ ...jw, install: { frameType: 'zbar' } }) - materialUnitPrice({ ...jw, install: { frameType: 'block' } }) - 38.17) <= 0.02, 'Z-bar adds $5.40 + $0.396/UI');
check(materialUnitPrice({ ...jw, addons: ['zbar'] }) === materialUnitPrice(jw), 'Z-bar cannot be checked by hand');
const sh = { brand: 'milgard', series: 'V300', type: 'vslider', color: 'ww', w: 28.25, h: 57, install: { frameType: 'zbar' } };
check(materialUnitPrice({ ...sh, addons: ['tempered', 'tempered_lower'] }) === materialUnitPrice({ ...sh, addons: ['tempered'] }), 'full tempered covers lower sash');
check(materialUnitPrice({ ...sh, addons: ['tempered_lower'] }) < materialUnitPrice({ ...sh, addons: ['tempered'] }), 'lower sash tempered is cheaper');
const jwTotal = [1,2,3,5,6].length * materialUnitPrice({ ...jw, install: { frameType: 'zbar' } }) + materialUnitPrice({ ...jw, w: 29, install: { frameType: 'zbar' } })
  + materialUnitPrice({ ...sh, w: 12.25, h: 38.25, addons: ['tempered', 'obscure'] }) + 2 * materialUnitPrice({ ...sh, addons: ['tempered_lower'] });
check(jwTotal >= 6095.78, 'Janice Williams material subtotal ' + jwTotal);

// Spot checks called out in the spec.
const spot = (line, expect, label) => {
  const unit = materialUnitPrice(line);
  check(Math.abs(unit - expect) <= 0.02, `${label} ${unit} != ${expect}`);
};
spot({ brand: 'andersen', series: '100', type: 'hslider', color: 'bb', w: 71.5, h: 59.5, addons: [] }, 1232.87, 'Lupler V2 line 100');
spot({ brand: 'milgard', series: 'V300', type: 'picture', color: 'adobe', w: 47.5, h: 47.5, addons: [] }, 583.05, 'V300 Adobe picture 47.5');
const oxxo = materialUnitPrice({ brand: 'iwc_door', series: '8900', type: '4panel', color: 'bronze-anodized', w: 191.5, h: 83.5, addons: [] });
check(oxxo >= 10848.84 - 0.005, 'IWC OXXO should clear the quote minimum ' + oxxo);
check(Math.abs(oxxo - 10848.86) <= 0.001, 'IWC OXXO model price ' + oxxo);
spot({ brand: 'andersen', series: '100', type: 'hslider', color: 'ww', w: 70, h: 60, addons: [] }, 1032.63, 'Andersen XO white 70x60');

// Fallback: unfitted combinations stay on stored p75 × marginFactor.
function fallbackUnit(line) {
  const rr = getRate(line.brand, line.series, line.color, line.type);
  return Math.round((line.w + line.h) * rr.rate * 100) / 100;
}
for (const line of [
  { brand: 'andersen', series: '100', type: 'awning', color: 'ww', w: 36, h: 24, options: [] },
  { brand: 'milgard', series: 'V250', type: 'hslider', color: 'ww', w: 48, h: 36, options: [] },
  { brand: 'milgard', series: 'V300', type: 'picture', color: 'bb', w: 72, h: 60, options: [] },
]) {
  const unit = materialUnitPrice(line);
  const old = fallbackUnit(line);
  check(unit === old, `${line.brand} ${line.series} ${line.type} ${line.color} ${unit} != fallback ${old}`);
  check(priceWindow(line).mode === 'fallback', `${line.series} ${line.type} should stay on the old rate`);
}

// IWC White is not fitted: custom supplier line, not a variable price.
const iwcWhite = { brand: 'iwc', series: '8200', type: 'hslider', color: 'white', w: 47.5, h: 47.5 };
check(materialUnitPrice(iwcWhite) == null, 'IWC White should not invent a rate');
check(priceWindow(iwcWhite) == null, 'IWC White waits for a supplier price');
const iwcCustom = priceWindow({ ...iwcWhite, supplierPrice: 999 });
check(iwcCustom && iwcCustom.mode === 'custom' && iwcCustom.unit === 999, 'IWC White uses the supplier price as-is');
const bronze = materialUnitPrice({ brand: 'iwc', series: '8200', type: 'hslider', color: 'bronze-anodized', w: 47.5, h: 47.5 });
check(bronze !== 999 && bronze > 0, 'IWC Bronze Anodized stays on the fit');

// Labor is unchanged, and promos discount material only (not labor, add-ons, or custom units).
check(installUnit({ type: 'standard', surcharges: [] }) === 360, 'retrofit labor');
check(installUnit({ type: 'stucco-fin', surcharges: [] }) === 400, 'nailing fin labor');
check(installUnit({ type: 'block', surcharges: [] }) === 380, 'block labor');
const job = {
  lines: [
    { qty: 1, unit: 1120, type: 'hslider', brand: 'milgard', series: 'V250', color: 'ww', install: { type: 'standard', surcharges: ['second-story'] } },
    { qty: 1, unit: 1120, type: 'hslider', brand: 'milgard', series: 'V250', color: 'ww', install: { type: 'standard', surcharges: [] } },
  ],
  promoCode: 'NOBLE10', taxPct: 0, extras: [], stuccoRepair: { on: false, qty: null },
};
const t = totals(job);
check(t.windows === 2240, 'window material ' + t.windows);
check(t.discount === 224, 'NOBLE10 material discount ' + t.discount);
check(t.install === 720, 'labor untouched ' + t.install);
check(t.addons === 75, 'add-on untouched ' + t.addons);
check(t.labor === 795, 'client labor is install plus add-on ' + t.labor);
check(t.shipping === 150, 'shipping stays $150 with a promo ' + t.shipping);
check(t.taxable === 2016, 'tax base excludes labor and shipping ' + t.taxable);
check(t.tax === 183.46, 'sales tax 9.1% ' + t.tax);
check(t.subtotal === 2961, 'pre-tax subtotal ' + t.subtotal);
check(t.total === 3144.46, 'total with shipping and tax ' + t.total);

const mixed = {
  lines: [
    { qty: 1, unit: 1000, type: 'hslider', brand: 'milgard', series: 'V250', color: 'ww', install: { type: 'standard', surcharges: [] } },
    { qty: 1, unit: 5000, type: 'custom_supplier', supplierPrice: 5000, brand: 'milgard', series: 'V400', color: 'ww', install: { type: 'standard', surcharges: [] } },
  ],
  promoCode: 'NOBLE10', taxPct: 0, extras: [], stuccoRepair: { on: false, qty: null },
};
const tm = totals(mixed);
check(tm.windows === 6000, 'custom still counts as material ' + tm.windows);
check(tm.discount === 100, 'NOBLE10 skips the custom unit ' + tm.discount);
check(tm.install === 720, 'custom labor still priced ' + tm.install);
check(tm.taxable === 5900, 'custom unit stays in the tax base ' + tm.taxable);
check(tm.tax === 536.9, 'tax on custom materials ' + tm.tax);
check(tm.shipping === 150, 'shipping on a custom-unit estimate ' + tm.shipping);

if (errs.length) {
  console.log('FAILED');
  for (const e of errs) console.log(' -', e);
  process.exit(1);
}
let minOver = Infinity; for (const l of lines) minOver = Math.min(minOver, materialUnitPrice(l) - l.expectedMinUnitPrice);
console.log(`ok  ${lines.length} validation lines, all >= quote (min margin $${minOver.toFixed(2)})  Andersen XO white 70x60 $1,032.63  labor $360 separate`);
