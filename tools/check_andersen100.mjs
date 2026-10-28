// Every Andersen iQ point in tools/andersen100_check.csv must price at or above
// the CSV customer price. The app price is the iQ formula, rounded up.
// Usage: node tools/check_andersen100.mjs
import { readFileSync } from 'fs';
import { data, materialUnitPrice, priceWindow, installUnit } from '../js/core.js';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
data.rates = load('data/rates.json');
data.variableRates = load('data/variable-rates.json');
data.options = load('data/options.json');
data.install = load('data/install.json');
data.promos = load('data/promos.json');
data.milgardOnelink = load('data/milgard-onelink.json');

function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell !== ''));
}

function colorId(raw) {
  const s = String(raw || '').trim();
  if (/Black\/Black|Black ext\/Black|Black int/i.test(s)) return 'bb';
  if (/Black ext/i.test(s)) return 'bw';
  if (/Sandtone/i.test(s)) return 'sandtone';
  if (/Terratone/i.test(s)) return 'terratone';
  if (/Dark Bronze/i.test(s)) return 'dkbronze';
  if (/^White/i.test(s)) return 'ww';
  throw new Error('unmapped color: ' + raw);
}

const errs = [];
const check = (ok, msg) => { if (!ok) errs.push(msg); };

const table = parseCSV(readFileSync('tools/andersen100_check.csv', 'utf8'));
const header = table[0];
const idx = Object.fromEntries(header.map((name, i) => [name, i]));
const points = table.slice(1).map((r) => ({
  type: r[idx.type],
  fin: r[idx.fin],
  color: r[idx.color],
  w: Number(r[idx.w]),
  h: Number(r[idx.h]),
  real: Number(r[idx.real_customer]),
  formula: Number(r[idx.formula_price]),
  old: r[idx.old_app_price] === '' ? null : Number(r[idx.old_app_price]),
  oldPct: r[idx.old_vs_real_pct] === '' ? null : Number(r[idx.old_vs_real_pct]),
}));

check(points.length === 122, `expected 122 iQ points, got ${points.length}`);

function lineFor(p, extra = {}) {
  return {
    brand: 'andersen', series: '100', type: p.type, color: colorId(p.color),
    w: p.w, h: p.h, qty: 1, unitsPerLine: 1,
    addons: p.fin === 'flush' ? ['flush_fin_trim'] : [],
    options: [],
    ...extra,
  };
}

let minOver = Infinity;
for (const p of points) {
  const where = `${p.type} ${p.fin} ${p.color} ${p.w}x${p.h}`;
  let id;
  try { id = colorId(p.color); } catch (e) { errs.push(e.message); continue; }
  const unit = materialUnitPrice(lineFor(p));
  check(typeof unit === 'number', `${where} did not price`);
  if (typeof unit !== 'number') continue;
  check(unit + 1e-9 >= p.real, `${where} app $${unit} is under Andersen customer $${p.real}`);
  if (p.type === 'specialty_arch') {
    const ui = p.w + p.h;
    const core = 12.76 * ui;
    const pre = p.fin === 'flush' ? core * 1.0476 + 0.14 : core;
    const expected = Math.ceil(pre - 1e-6);
    check(unit === expected, `${where} app $${unit} != arch formula $${expected} (was sheet $${p.formula})`);
  } else {
    check(unit === p.formula, `${where} app $${unit} != formula $${p.formula}`);
  }
  minOver = Math.min(minOver, unit - p.real);
  const shown = priceWindow({ ...lineFor(p), qty: 2 });
  check(shown && shown.unit === unit && shown.total === unit * 2, `${where} quantity did not stay separate from the unit price`);
}

// Out of range sizes are blocked. Do not extrapolate a negative base.
const blocked = [
  { type: 'vslider', w: 10, h: 10, label: 'single hung under the minimum' },
  { type: 'vslider', w: 60, h: 48, label: 'single hung over the width' },
  { type: 'casement', w: 36, h: 48, label: 'casement 36x48' },
  { type: 'picture', w: 80, h: 80, label: 'picture 80x80' },
  { type: 'patio_door_2p', w: 72, h: 96, label: 'door 72x96' },
  { type: 'awning', w: 30, h: 48, label: 'awning over the height' },
  { type: 'hslider', w: 23.5, h: 10, label: 'XO under the height' },
  { type: 'arch_sh', w: 30, h: 20, label: 'arch single hung short side' },
];
for (const b of blocked) {
  const line = { brand: 'andersen', series: '100', type: b.type, color: 'ww', w: b.w, h: b.h, addons: [] };
  const unit = materialUnitPrice(line);
  const shown = priceWindow(line);
  check(unit == null, `${b.label} priced at ${unit}`);
  check(shown && shown.blocked && shown.errors?.length, `${b.label} needs a limit message`);
  check(shown?.unit == null, `${b.label} still returned a unit`);
}

const twin = { brand: 'andersen', series: '100', type: 'twin_vslider', color: 'ww', w: 40, h: 48, addons: [] };
const twinOnce = materialUnitPrice(twin);
const twinDoubled = materialUnitPrice({ ...twin, unitsPerLine: 2, units: 2 });
check(twinOnce === 1006 && twinDoubled === twinOnce, `twin 40x48 should be one combined unit $${twinOnce}`);

const arch = materialUnitPrice({ brand: 'andersen', series: '100', type: 'arch', color: 'ww', w: 36, h: 48, addons: [] });
const specialty = materialUnitPrice({ brand: 'andersen', series: '100', type: 'specialty_arch', color: 'ww', w: 36, h: 48, addons: [] });
check(arch === specialty && arch === 1072, `old arch id should match specialty arch $${arch}`);

const archFlush = materialUnitPrice({ brand: 'andersen', series: '100', type: 'arch_sh', color: 'ww', w: 36, h: 48, addons: ['flush_fin_trim'] });
const archNail = materialUnitPrice({ brand: 'andersen', series: '100', type: 'arch_sh', color: 'ww', w: 36, h: 48, addons: [] });
check(archFlush === archNail && archNail === 1151, `arch single hung flush fin is the same price $${archNail}`);

const doorSand = priceWindow({ brand: 'andersen', series: '100', type: 'patio_door_2p', color: 'sandtone', w: 72, h: 80, addons: [] });
check(doorSand?.blocked && /not priced/i.test(doorSand.errors.join(' ')), 'patio door sandtone should be blocked');

const sh = { brand: 'andersen', series: '100', type: 'vslider', color: 'ww', w: 36, h: 48, addons: [] };
check(installUnit({ type: 'standard', surcharges: [] }, sh) === 360, 'jump frame labor stays $360');
check(installUnit({ type: 'stucco-fin', surcharges: [] }, sh) === 400, 'nail fin labor stays $400');
check(installUnit({ type: 'block', surcharges: [] }, sh) === 380, 'block labor stays $380');
const door = { brand: 'andersen', series: '100', type: 'patio_door_2p', color: 'ww', w: 72, h: 80, addons: [] };
check(installUnit({ type: 'standard', surcharges: [] }, door) === 360, 'door labor stays a separate install line');
check(materialUnitPrice(door) === 3315, 'patio door 72x80 white');

const grille = materialUnitPrice({ ...sh, addons: ['grilles_gbg'] });
const tempered = materialUnitPrice({ ...sh, addons: ['tempered'] });
check(grille > materialUnitPrice(sh), 'grilles still add');
check(tempered > materialUnitPrice(sh), 'tempered still adds 12%');

const offered = data.rates.brands.find((b) => b.id === 'andersen').series[0].types;
check(!offered.includes('3panel') && !offered.includes('4panel'), 'no 3- or 4-panel Andersen door in the picker');
check(offered.includes('twin_vslider'), 'Andersen twin single hung stays selectable');
check(data.rates.types.find((t) => t.id === 'twin_vslider')?.name === 'Double Single Hung', 'Andersen twin single hung is labeled Double Single Hung');
check(data.variableRates.andersen.types.twin_vslider.name === 'Double Single Hung', 'Andersen size-limit name is Double Single Hung');
check(data.variableRates.andersen.types.twin_vslider.base === -41.67 && data.variableRates.andersen.types.twin_vslider.perUI === 11.8955, 'Andersen twin formula is unchanged');
check(data.variableRates.andersen.types.vslider.base === 2.79 && data.variableRates.andersen.types.hslider.base === -48.55, 'single hung and XO formulas stay put');
check(data.variableRates.andersen.types.xox.limits.w[0] === 47.5 && data.variableRates.andersen.types.xox.limits.w[1] === 143.5, 'standalone XOX width stays 47.5–143.5');
const archSpec = data.variableRates.andersen.types.specialty_arch;
check(archSpec.base === 0 && archSpec.perUI === 12.76 && archSpec.flushFin.factor === 1.0476 && archSpec.flushFin.adder === 0.14, 'equal-leg arch formula is 0 + 12.76 per UI, flush fin unchanged');
check(!data.variableRates.andersen.types.eyebrow && !offered.includes('eyebrow') && !offered.includes('arch_over_xo'), 'Andersen has no eyebrow and arch-over is not a stored formula');
const archBig = materialUnitPrice({ brand: 'andersen', series: '100', type: 'specialty_arch', color: 'ww', w: 71.5, h: 71.5, addons: [] });
const archBigFlush = materialUnitPrice({ brand: 'andersen', series: '100', type: 'specialty_arch', color: 'ww', w: 71.5, h: 71.5, addons: ['flush_fin_trim'] });
check(archBig >= 1816 && archBig === 1825, `arch 71.5x71.5 nail fin $${archBig}`);
check(archBigFlush >= 1902.4 && archBigFlush === 1912, `arch 71.5x71.5 flush fin $${archBigFlush}`);
const over = priceWindow({ brand: 'andersen', series: '100', type: 'arch_over_xo', color: 'ww', w: 71.5, h: 60, qty: 1, addons: ['flush_fin_trim'], options: [] });
check(over?.combo && !over.blocked && over.parts?.length === 2, 'arch over XO prices as two lines');
check(over?.parts?.[0]?.line?.type === 'specialty_arch' && over?.parts?.[1]?.line?.type === 'hslider', 'arch over XO is the equal-leg arch plus the XO');
check(over?.parts?.[0]?.line?.unitsPerLine === 1 && over?.parts?.[1]?.line?.unitsPerLine === 1, 'arch over XO has no mull charge');
check(over?.parts?.[0]?.line?.w === 71.5 && Math.abs(over.parts[0].line.h - 71.5 / 4) < 1e-6, 'arch rise is about one quarter of the width');
check(over?.parts?.[1]?.line?.w === 71.5 && over.parts[1].line.h === 60, 'XO keeps the entered width and height');
const overXox = priceWindow({ brand: 'andersen', series: '100', type: 'arch_over_xox', color: 'bw', w: 72, h: 60, addons: [], options: [] });
check(overXox?.combo && overXox.parts[1].line.type === 'xox', 'arch over XOX is the arch plus the XOX');
check(overXox?.parts?.[0]?.unit === materialUnitPrice({ brand: 'andersen', series: '100', type: 'specialty_arch', color: 'bw', w: 72, h: 18, addons: [] }), 'black/white adder is on the arch line');
check(overXox?.parts?.[1]?.unit === materialUnitPrice({ brand: 'andersen', series: '100', type: 'xox', color: 'bw', w: 72, h: 60, addons: [] }), 'black/white adder is on the XOX line');
check(overXox.parts[0].unit > materialUnitPrice({ brand: 'andersen', series: '100', type: 'specialty_arch', color: 'ww', w: 72, h: 18, addons: [] }), 'black arch line is above white');
const tooNarrow = priceWindow({ brand: 'andersen', series: '100', type: 'arch_over_xox', color: 'ww', w: 48, h: 60, addons: [] });
check(tooNarrow?.blocked && /width/i.test(tooNarrow.errors.join(' ')), 'arch over XOX under 59.5 is blocked');

if (errs.length) {
  console.log('FAILED');
  for (const e of errs) console.log(' -', e);
  process.exit(1);
}

const names = {
  vslider: 'Single hung', picture: 'Picture', hslider: 'Gliding XO', xox: 'Gliding XOX',
  casement: 'Casement', awning: 'Awning', twin_vslider: 'Double Single Hung', twin_casement: 'Twin casement',
  arch_sh: 'Arch single hung', specialty_arch: 'Specialty arch', patio_door_2p: 'Patio door 2-panel',
};
const common = [
  ['vslider', 'nail', 30, 36], ['vslider', 'nail', 36, 48], ['vslider', 'nail', 40, 48], ['vslider', 'flush', 36, 48],
  ['twin_vslider', 'nail', 35.5, 23.5], ['twin_vslider', 'nail', 40, 48], ['twin_vslider', 'nail', 56, 60],
  ['picture', 'nail', 30, 36], ['picture', 'flush', 30, 36], ['picture', 'flush', 11.5, 11.5],
  ['hslider', 'nail', 23.5, 11.5], ['hslider', 'nail', 30, 36], ['hslider', 'nail', 48, 54],
  ['xox', 'nail', 48, 54], ['xox', 'nail', 72, 71.5], ['xox', 'nail', 143.5, 71.5],
  ['casement', 'nail', 30, 36], ['casement', 'nail', 35.5, 71.5],
  ['awning', 'nail', 30, 30], ['awning', 'nail', 40, 35.5],
  ['twin_casement', 'nail', 40, 48], ['twin_casement', 'nail', 56, 60],
  ['arch_sh', 'nail', 30, 48], ['arch_sh', 'nail', 36, 60],
  ['specialty_arch', 'nail', 36, 48], ['specialty_arch', 'flush', 36, 48],
  ['patio_door_2p', 'nail', 60, 80], ['patio_door_2p', 'nail', 72, 80], ['patio_door_2p', 'nail', 95.25, 80],
];
console.log('COMMON');
for (const [type, fin, w, h] of common) {
  const p = points.find((row) => row.type === type && row.fin === fin && colorId(row.color) === 'ww' && row.w === w && row.h === h);
  const unit = materialUnitPrice(lineFor({ type, fin, color: 'White', w, h }));
  const old = p?.old == null ? '—' : p.old.toFixed(0);
  const real = p ? p.real.toFixed(0) : '—';
  console.log([names[type], fin, `${w}x${h}`, old, unit, real].join('\t'));
}
console.log(`ok  ${points.length} iQ points, all >= Andersen customer (closest $${minOver.toFixed(2)} over)`);
