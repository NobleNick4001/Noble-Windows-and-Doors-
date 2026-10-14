// Core helpers, data loading, settings, estimate store, pricing.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return e;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const fmt = (n) => money.format(n || 0);
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------- storage ----------
const store = {
  get(key, def) { try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { toast('Could not save (storage full?)'); } },
};
export { store };

export function toast(msg) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- data ----------
export const data = { rates: null, variableRates: null, options: null, gallery: null, settingsDefault: null, install: null, obscureGlass: null, frameTypes: null, promos: null, agreement: null };
export let settings = {};

async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

export async function loadData() {
  [data.rates, data.variableRates, data.options, data.gallery, data.settingsDefault, data.install, data.obscureGlass, data.frameTypes, data.promos, data.agreement] = await Promise.all([
    getJSON('data/rates.json'), getJSON('data/variable-rates.json'), getJSON('data/options.json'), getJSON('assets/gallery/gallery.json'), getJSON('data/settings.default.json'), getJSON('data/install.json'), getJSON('data/obscure-glass.json'), getJSON('data/frame-types.json'), getJSON('data/promos.json'), getJSON('data/purchase-agreement.json'),
  ]);
  if (data.obscureGlass?.sections) {
    data.obscureGlass.patterns = data.obscureGlass.sections.flatMap((s) => (s.patterns || []).map((p) => ({ ...p, brand: p.brand || s.brand })));
  }
  loadSettings();
}
function deepMerge(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(a?.[k] || {}, v) : v;
  return o;
}
export function loadSettings() { settings = deepMerge(data.settingsDefault, store.get('nwd.settings', {})); return settings; }
export function saveSettings(s) { settings = s; store.set('nwd.settings', s); }

// ---------- pricing ----------
export const brandById = (id) => data.rates.brands.find((b) => b.id === id);
export const typeName = (id) => data.rates.types.find((t) => t.id === id)?.name || id;
export const colorById = (id) => data.rates.colors.find((c) => c.id === id);
export const colorName = (id) => colorById(id)?.name || id;

// Stored p75/max already include this margin (customer = cost / 0.60). Selling margin is data/rates.json grossMargin.
const QUOTED_MARGIN = 0.40;
export function marginFactor() {
  const g = Number(data.rates?.grossMargin);
  const margin = Number.isFinite(g) && g >= 0 && g < 1 ? g : QUOTED_MARGIN;
  return (1 - QUOTED_MARGIN) / (1 - margin);
}
export function getRate(brandId, series, color, type, rateSet = settings.rateSet) {
  const b = brandById(brandId);
  let r = b?.rates?.[`${series}|${color}|${type}`];
  if (!r) { // derived color (e.g. Adobe = white/white x multiplier; always flagged estimated)
    const d = b?.derivedColors?.[color]; const base = d && b.rates[`${series}|${d.from}|${type}`]; const m = d?.multiplier ?? 1;
    if (base) r = { p75: base.p75 * m, max: base.max * m, estimated: true, n: 0 };
  }
  if (!r) return null;
  const stored = rateSet === 'max' ? r.max : r.p75;
  return { rate: stored * marginFactor(), estimated: !!r.estimated, raw: r };
}
const roundMoney = (n) => settings.roundToDollar ? Math.round(n) : Math.round(n * 100) / 100;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function optionDef(id) {
  const hit = [...data.options.glass, ...data.options.frame].find((o) => o.id === id);
  if (hit) return hit;
  const p = data.obscureGlass?.patterns?.find((o) => o.id === id);
  return p ? { ...p, price: p.price || { type: 'included', amount: 0 } } : undefined;
}
export function optionPrice(opt, base, w, h) {
  const p = opt?.price || { type: 'included' };
  if (p.type === 'perWindow') return p.amount || 0;
  if (p.type === 'percent') return base * (p.amount || 0) / 100;
  if (p.type === 'perSqFt') return (w * h / 144) * (p.amount || 0);
  return 0;
}

// ---------- variable material model (data/variable-rates.json) ----------
// Values in that file are already selling prices at 45%. Do not apply marginFactor().
const GLASS_IDS = ['tempered', 'tempered_lower', 'laminated', 'obscure'];
const ADDON_NAMES = {
  tempered: 'Tempered (safety) glass',
  tempered_lower: 'Tempered (lower sash only)',
  zbar: 'Standard Z-Bar (retrofit frame)',
  laminated: 'Laminated glass',
  obscure: 'Obscured glass',
  grids: 'Grids (flat colonial)',
  flush_fin_trim: 'Flush fin + interior trim',
  grilles_gbg: 'Grilles between the glass',
  truscene: 'TruScene screen',
};
const finite = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const lineUnits = (line) => { const n = Number(line?.unitsPerLine ?? line?.units ?? 1); return n > 0 ? n : 1; };

function classifyLine(line) {
  if (!line || line.type === 'custom_supplier' || line.customSupplier) return { mode: 'custom' };
  const vr = data.variableRates;
  if (!vr) return { mode: 'fallback' };
  let brand = line.brand;
  let series = line.series;
  let type = line.type;
  if (brand === 'iwc_window') { brand = 'iwc'; series = series || '8200'; }
  if (brand === 'iwc_door') { brand = 'iwc'; series = series || '8900'; }
  if (brand === 'andersen') {
    const A = vr.andersen;
    if (!A || series !== A.series) return { mode: 'fallback' };
    if ((A.keepExisting || []).includes(type)) return { mode: 'fallback' };
    const typeDef = A.types?.[type];
    const colorDef = A.colors?.[line.color];
    if (!typeDef || !colorDef) return { mode: 'fallback' };
    return { mode: 'variable', family: 'andersen', typeDef, colorDef, addons: A.addons || {} };
  }
  if (brand === 'milgard') {
    const S = vr.milgard?.[series];
    const typeDef = S?.types?.[type];
    if (typeDef && (S.colorsFitted || []).includes(line.color)) {
      const adj = Number(S.colorAdjust?.[line.color]?.[type]) || 0;
      return { mode: 'variable', family: 'milgard', typeDef, colorDef: { ratio: 1, adjustPerUnit: adj }, addons: S.addons || {} };
    }
    return { mode: 'fallback' };
  }
  if (brand === 'iwc') {
    const win = vr.iwc?.windows?.[series];
    if (win?.types?.[type] && (win.colorsFitted || []).includes(line.color)) {
      return { mode: 'variable', family: 'iwc', typeDef: win.types[type], colorDef: { ratio: 1, adjustPerUnit: 0 }, addons: {}, includes: win.types[type].includes || null };
    }
    const door = vr.iwc?.doors?.[series];
    const cfg = line.doorConfig || type;
    if (door?.configs?.[cfg] && (door.colorsFitted || []).includes(line.color)) {
      return { mode: 'variable', family: 'iwc', typeDef: door.configs[cfg], colorDef: { ratio: 1, adjustPerUnit: 0 }, addons: {}, includes: door.includes || null };
    }
    return { mode: 'custom' };
  }
  return { mode: 'fallback' };
}

export function isCustomLine(line) {
  if (!line) return false;
  if (line.type === 'custom_supplier' || line.customSupplier) return true;
  return classifyLine(line).mode === 'custom';
}
export function lineAddonDefs(line) {
  const model = classifyLine(line);
  return model.mode === 'variable' ? (model.addons || {}) : null;
}
export function addonName(id, def) { return def?.name || ADDON_NAMES[id] || id; }
export function lineOptionNames(line) {
  const fromOpt = (line?.options || []).map((id) => optionDef(id)?.name).filter(Boolean);
  const fromAdd = (line?.addons || []).map((id) => addonName(id)).filter((n) => n && !fromOpt.includes(n));
  return [...fromAdd, ...fromOpt];
}

const EIGHTH_UNI = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
const EIGHTH_ASCII = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];
// 37.75 → 37¾″. Eighths that are not a clean fraction stay as a short decimal.
export function formatInches(value, { ascii = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const mark = ascii ? '"' : '″';
  const glyphs = ascii ? EIGHTH_ASCII : EIGHTH_UNI;
  let whole = Math.floor(abs + 1e-9);
  const frac = abs - whole;
  const eighth = Math.round(frac * 8);
  if (Math.abs(frac * 8 - eighth) < 0.02) {
    if (eighth === 8) return `${sign}${whole + 1}${mark}`;
    if (eighth === 0) return `${sign}${whole}${mark}`;
    const glyph = glyphs[eighth];
    if (ascii) return `${sign}${whole ? whole + ' ' : ''}${glyph}${mark}`;
    return `${sign}${whole || ''}${glyph}${mark}`;
  }
  const rounded = Math.round(abs * 100) / 100;
  return `${sign}${rounded}${mark}`;
}
// "White / White" → "White". "Black / White" stays so the two sides stay distinct.
export function shortColorName(name) {
  const raw = String(name ?? '').trim();
  const parts = raw.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => p.toLowerCase() === parts[0].toLowerCase())) return parts[0];
  return raw;
}
function seriesLabel(line) {
  const brand = brandById(line?.brand);
  return brand?.series?.find((s) => s.id === line?.series)?.name || line?.series || '';
}
export function compactWindowLine(line, { includeBrand = false, ascii = false } = {}) {
  line = line || {};
  const brandName = brandById(line.brand)?.name || line.brand || '';
  const custom = String(line.customDescription || '').trim();
  const product = [includeBrand ? brandName : '', custom, seriesLabel(line), typeName(line.type)].filter(Boolean).join(' ');
  const title = `${line.label || 'Window'} — ${product}`.trim();
  const times = ascii ? 'x' : '×';
  const bits = [`${formatInches(line.w, { ascii })} ${times} ${formatInches(line.h, { ascii })}`, shortColorName(colorName(line.color)), ...lineOptionNames(line)];
  if (Number(line.unitsPerLine) > 1) bits.push(`${line.unitsPerLine} units`);
  bits.push(`Qty ${Number(line.qty) || 1}`);
  return {
    title,
    detail: bits.filter(Boolean).join(' · '),
    price: (Number(line.unit) || 0) * (Number(line.qty) || 0),
    brandName: brandName || 'Windows',
  };
}
export function windowSections(lines) {
  const groups = [];
  const index = new Map();
  for (const line of lines || []) {
    const name = brandById(line.brand)?.name || line.brand || 'Windows';
    if (!index.has(name)) {
      index.set(name, groups.length);
      groups.push({ brandName: name, lines: [] });
    }
    groups[index.get(name)].lines.push(line);
  }
  return groups;
}
export function addonPriceHint(def) {
  if (!def) return '';
  if (def.type === 'percentOfWindow') return `+${def.amount}%`;
  if (def.type === 'perWindow') return `+${fmt(def.amount)}`;
  if (def.type === 'perUI') return `+$${def.amount}/UI`;
  if (def.type === 'perSqFt') return `+$${def.amount}/sq ft`;
  if (def.type === 'perWindowPlusPerSqFt') return `+${fmt(def.amount)} + $${def.perSqFt}/sq ft` + (def.max ? ` (max ${fmt(def.max)})` : '');
  if (def.type === 'perWindowPlusPerUI') return `+${fmt(def.amount)} + $${def.perUI}/UI`;
  return '';
}
export function fittedIncludes(line) {
  const inc = classifyLine(line).includes;
  if (!inc) return '';
  return 'Included in the price: ' + (Array.isArray(inc) ? inc.join(', ') : inc) + '.';
}
export function variableRateInfo(brand, series, color, type) {
  const model = classifyLine({ brand, series, color, type });
  if (model.mode !== 'variable') return null;
  const t = model.typeDef;
  const c = model.colorDef || {};
  return {
    base: t.base || 0, perUI: t.perUI || 0, perSqFt: t.perSqFt || 0,
    ratio: c.ratio ?? 1, adjustPerUnit: c.adjustPerUnit || 0, provisional: !!t.provisional,
  };
}
export function setLineAddon(line, id, on) {
  line.addons ||= [];
  line.options ||= [];
  const glass = GLASS_IDS.includes(id);
  if (on) {
    if (!line.addons.includes(id)) line.addons.push(id);
    if (glass && !line.options.includes(id)) line.options.push(id);
  } else {
    line.addons = line.addons.filter((x) => x !== id);
    if (glass) {
      line.options = line.options.filter((x) => x !== id);
      if (id === 'obscure') {
        const ids = new Set((data.obscureGlass?.patterns || []).map((p) => p.id));
        line.options = line.options.filter((x) => !ids.has(x));
      }
    }
    if (id === 'grids') line.options = line.options.filter((x) => x !== 'grids-colonial');
  }
}

const lineFrameType = (line) => line?.install?.frameType || line?.frameType || null;
export const FRAME_TYPE_WARNING = 'Select frame type — Z-bar adds material cost';
const MILGARD_FRAME_SERIES = new Set(['V250', 'V300', 'V400']);
export function needsFrameWarning(line) {
  if (!line || line.brand !== 'milgard' || !MILGARD_FRAME_SERIES.has(line.series)) return false;
  return !lineFrameType(line);
}
// Add-ons with auto:"frameType:<id>" are charged from the frame choice, never from a checkbox.
export function isAutoAddon(def) { return typeof def?.auto === 'string'; }
function chosenAddonIds(line, addonDefs) {
  const ids = new Set();
  for (const id of line.addons || []) if (addonDefs[id] && !isAutoAddon(addonDefs[id])) ids.add(id);
  for (const id of line.options || []) {
    if (addonDefs[id]) ids.add(id);
    if (id === 'grids-colonial' && addonDefs.grids) ids.add('grids');
  }
  for (const id of [...ids]) if (isAutoAddon(addonDefs[id])) ids.delete(id);
  const ft = lineFrameType(line);
  for (const [id, def] of Object.entries(addonDefs)) if (isAutoAddon(def) && ft && def.auto === `frameType:${ft}`) ids.add(id);
  // Full-unit tempered covers the lower sash.
  if (ids.has('tempered')) ids.delete('tempered_lower');
  return [...ids];
}
const capAddon = (A, v) => (A.max > 0 ? Math.min(v, A.max) : v);
function variableRaw(model, line) {
  const w = finite(line.w), h = finite(line.h);
  const ui = w + h, sqft = w * h / 144;
  const t = model.typeDef;
  const ratio = model.colorDef?.ratio ?? 1;
  const adjust = model.colorDef?.adjustPerUnit || 0;
  const core = (t.base || 0) + (t.perUI || 0) * ui + (t.perSqFt || 0) * sqft;
  let scaledPerUI = 0, extra = 0;
  for (const id of chosenAddonIds(line, model.addons)) {
    const A = model.addons[id];
    if (A.type === 'perUI' && A.scaledByColor) scaledPerUI += A.amount || 0;
    else if (A.type === 'perUI') extra += (A.amount || 0) * ui;
    else if (A.type === 'perWindow') extra += A.amount || 0;
    else if (A.type === 'perSqFt') extra += capAddon(A, (A.amount || 0) * sqft);
    else if (A.type === 'perWindowPlusPerSqFt') extra += capAddon(A, (A.amount || 0) + (A.perSqFt || 0) * sqft);
    else if (A.type === 'perWindowPlusPerUI') extra += capAddon(A, (A.amount || 0) + (A.perUI || 0) * ui);
    else if (A.type === 'percentOfWindow') extra += (A.amount || 0) / 100 * core * ratio;
  }
  const colored = (core + scaledPerUI * ui) * ratio + adjust;
  const units = lineUnits(line);
  return { raw: (colored + extra) * units, core, ui, sqft, ratio, adjust, colored, extra, units, typeDef: t, scaledPerUI };
}
function strayOptionExtra(line, model, base, w, h) {
  const opts = line.options || [];
  if (!opts.length || !data.options) return 0;
  const consumed = new Set(chosenAddonIds(line, model.addons));
  if (consumed.has('grids')) consumed.add('grids-colonial');
  // Glass percents are charged only from this series' addon map.
  // IWC prices already include tempered glass, so a leftover 12% must not stack.
  let extra = 0;
  for (const id of opts) {
    if (consumed.has(id) || GLASS_IDS.includes(id)) continue;
    extra += optionPrice(optionDef(id), base, w, h) || 0;
  }
  return extra * lineUnits(line);
}
// One material unit (factory-mull units included, quantity not included).
// Rounded once, to the cent, or to the dollar when that setting is on.
function buildMaterial(line) {
  line = line || {};
  const model = classifyLine(line);
  const w = finite(line.w), h = finite(line.h);
  if (model.mode === 'custom') {
    if (line.supplierPrice === '' || line.supplierPrice == null) return null;
    const n = Number(line.supplierPrice);
    if (!Number.isFinite(n)) return null;
    const unit = roundMoney(n * lineUnits(line));
    return { mode: 'custom', unit, unitBase: unit, optionsEach: 0, rate: null, estimated: false, wh: w + h, fromQuotes: false, detail: null };
  }
  if (!(w > 0) || !(h > 0)) return null;
  if (model.mode === 'variable') {
    const d = variableRaw(model, line);
    const unit = roundMoney(d.raw + strayOptionExtra(line, model, d.colored, w, h));
    const coreRounded = roundMoney(d.colored);
    return {
      mode: 'variable', unit, unitBase: coreRounded, optionsEach: roundMoney(unit - coreRounded),
      rate: null, estimated: false, wh: d.ui, fromQuotes: true, provisional: !!model.typeDef.provisional, detail: d,
    };
  }
  const rr = getRate(line.brand, line.series, line.color, line.type);
  if (!rr) return null;
  const wh = w + h;
  const unitBase = roundMoney(wh * rr.rate);
  const optionsEach = roundMoney((line.options || []).reduce((s, id) => s + optionPrice(optionDef(id), unitBase, w, h), 0));
  const units = lineUnits(line);
  const unit = units === 1 ? roundMoney(unitBase + optionsEach) : roundMoney((unitBase + optionsEach) * units);
  return { mode: 'fallback', unit, unitBase, optionsEach, rate: rr.rate, estimated: !!rr.estimated, wh, fromQuotes: false, detail: null };
}
export function materialUnitPrice(line) {
  const built = buildMaterial(line);
  return built ? built.unit : null;
}
// ---------- installation / labor (separate from window price and from add-ons) ----------
export const installType = (id) => data.install.types.find((t) => t.id === id) || data.install.types[0];
export const defaultInstall = () => ({ type: data.install.defaultType, surcharges: [], override: null, custom: null, frameType: null });
export const frameTypeById = (id) => data.frameTypes?.types?.find((t) => t.id === id);
const surchargeDef = (id) => data.install?.surcharges?.find((x) => x.id === id);
// inst = {type, surcharges[], override (number|null), custom (number|null for 'custom' type)}
// Labor only. Per-window add-ons are addonUnit and are not folded into this price.
export function installUnit(inst) {
  inst = inst || defaultInstall();
  if (inst.override != null && inst.override !== '' && !isNaN(inst.override)) return roundMoney(Number(inst.override));
  const t = installType(inst.type);
  const base = t.custom && inst.custom != null && inst.custom !== '' ? Number(inst.custom) || 0 : t.price;
  return roundMoney(base);
}
export function addonNames(inst) {
  return (inst?.surcharges || []).map((id) => surchargeDef(id)?.name).filter(Boolean);
}
export function addonUnit(inst) {
  const sur = (inst?.surcharges || []).reduce((s, id) => s + (Number(surchargeDef(id)?.amount) || 0), 0);
  return roundMoney(sur);
}
export function installLabel(inst) {
  inst = inst || defaultInstall(); const t = installType(inst.type);
  const frame = frameTypeById(inst.frameType);
  return frame ? `${frame.name} (${t.name})` : t.name;
}
export function windowCount(e) {
  return (e?.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
}
// Optional estimate line. qty null follows the window count until the rep types a quantity.
export function stuccoState(e) {
  const def = data.install?.stuccoRepair || { name: 'Stucco repair & paint', price: 650 };
  const rec = e?.stuccoRepair || {};
  const on = !!rec.on;
  const count = windowCount(e);
  const follows = rec.qty == null || rec.qty === '';
  const qty = on ? (follows ? count : Math.max(0, parseInt(rec.qty, 10) || 0)) : 0;
  const unit = Number(def.price) || 0;
  return { on, follows: on && follows, name: def.name, unit, qty, total: r2(unit * qty) };
}
// Returns {unitBase, optionsEach, unit, total, rate, wh, mode}
export function priceWindow(line) {
  const built = buildMaterial(line || {});
  if (!built) return null;
  const qty = parseInt(line?.qty, 10) || 1;
  return { ...built, total: roundMoney(built.unit * qty) };
}

// ---------- estimates ----------
export const estimates = {
  all() { return store.get('nwd.estimates', {}); },
  list() { return Object.values(this.all()).sort((a, b) => b.updated - a.updated); },
  save(e) { const all = this.all(); e.updated = Date.now(); all[e.id] = e; store.set('nwd.estimates', all); },
  remove(id) { const all = this.all(); delete all[id]; store.set('nwd.estimates', all); if (this.currentId() === id) store.set('nwd.currentId', null); },
  currentId() { return store.get('nwd.currentId', null); },
  setCurrent(id) { store.set('nwd.currentId', id); },
  nextNumber() {
    const n = store.get('nwd.counter', 0) + 1; store.set('nwd.counter', n);
    const d = new Date(); const p = (x) => String(x).padStart(2, '0');
    return `NWD-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${String(n).padStart(3, '0')}`;
  },
  blank() {
    return { id: uid(), number: this.nextNumber(), created: Date.now(), updated: Date.now(),
      customer: { name: '', address: '', phone: '', email: '' }, lines: [], extras: [], stuccoRepair: { on: false, qty: null }, notes: '', promoCode: '', percentDiscount: 0, taxPct: settings.taxPct, validDays: settings.validDays, saved: false };
  },
  // current draft: loaded or created on demand (not persisted until it has content)
  current() {
    if (this._cur && this._cur.id === this.currentId()) return this._cur;
    const id = this.currentId();
    const found = id && this.all()[id];
    this._cur = found || this.blank();
    this.setCurrent(this._cur.id);
    return this._cur;
  },
  open(id) { const e = this.all()[id]; if (!e) return null; this._cur = e; this.setCurrent(id); return e; },
  startNew() { this._cur = this.blank(); this.setCurrent(this._cur.id); return this._cur; },
  persist() {
    const e = this._cur; if (!e) return;
    const has = e.lines.length || (e.extras || []).length || e.stuccoRepair?.on || e.customer.name || e.customer.address || e.customer.phone || e.customer.email || e.notes || e.promoCode || Number(e.percentDiscount) > 0 || e.contract;
    if (has || this.all()[e.id]) this.save(e);
  },
  duplicate(id) {
    const src = this.all()[id]; if (!src) return null;
    const c = JSON.parse(JSON.stringify(src)); c.id = uid(); c.number = this.nextNumber(); c.created = Date.now();
    c.lines.forEach((l) => (l.id = uid())); c.customer.name = c.customer.name ? c.customer.name + ' (copy)' : '';
    delete c.contract;
    delete c.remoteId;
    delete c.ownerId;
    delete c.hubspotContactId;
    delete c.hubspotDealId;
    delete c.hubspotChoice;
    delete c.hubspotPossibleMatch;
    delete c.presentedAt;
    delete c.signedAt;
    delete c.contractRowId;
    c.status = 'draft';
    this.save(c); this._cur = c; this.setCurrent(c.id); return c;
  },
};
export function findPromo(code) {
  const key = String(code || '').trim().toUpperCase();
  if (!key) return null;
  return (data.promos?.codes || []).find((c) => String(c.code || '').trim().toUpperCase() === key) || null;
}
// Fixed on every estimate. Promo codes and the write-in percent do not discount shipping.
// Tax is 9.1% of materials after the promo and the write-in percent, not labor or shipping.
export const SHIPPING_HANDLING = 150;
export const SALES_TAX_PCT = 9.1;
export const MAX_PERCENT_DISCOUNT = 10;

// Applied percent is never above 10. Negatives and blank values are 0.
export function clampPercentDiscount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_PERCENT_DISCOUNT, n);
}

// Rejects anything over 10%. A negative entry clamps to 0.
export function parsePercentDiscount(raw) {
  const text = String(raw ?? '').trim().replace(/%$/, '').trim();
  if (!text || text === '.' || text === '-' || text === '-.') return { ok: true, value: 0, error: '' };
  const pending = text.endsWith('.') ? text.slice(0, -1) : text;
  if (!/^-?\d*\.?\d+$/.test(pending)) return { ok: false, value: 0, error: 'Enter a discount from 0 to 10%.' };
  const n = Number(pending);
  if (!Number.isFinite(n)) return { ok: false, value: 0, error: 'Enter a discount from 0 to 10%.' };
  if (n < 0) return { ok: true, value: 0, error: '', clamped: true };
  if (n > MAX_PERCENT_DISCOUNT) return { ok: false, value: 0, error: 'Discount cannot be more than 10%.' };
  return { ok: true, value: n, error: '' };
}
// Discount off window cost including glass upcharges. Labor only when that code's appliesToLabor is true.
// Add-ons, stucco repair, and shipping are never discounted.
export function promoResult(e, windows = 0, install = 0) {
  const entered = String(e?.promoCode || '').trim();
  const empty = { applied: false, invalid: false, amount: 0, windowAmount: 0, laborAmount: 0, label: '', note: '', promo: null };
  if (!entered) return empty;
  const promo = findPromo(entered);
  if (!promo) return { ...empty, invalid: true, error: 'That code is not valid.' };
  const lines = e.lines || [];
  const eligible = (l) => promo.appliesToCustom || !isCustomLine(l);
  const priced = lines.filter(eligible);
  let windowAmount = 0, laborAmount = 0, note = '';
  if (promo.type === 'percent') {
    const pct = Number(promo.percent) || 0;
    const base = r2(priced.reduce((s, l) => s + (Number(l.unit) || 0) * (Number(l.qty) || 0), 0));
    windowAmount = r2(base * pct / 100);
    if (promo.appliesToLabor) laborAmount = r2(install * pct / 100);
  } else if (promo.type === 'bogo') {
    const buy = Number(promo.buy) || 0, get = Number(promo.get) || 0, group = buy + get;
    const count = priced.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const freeN = group > 0 && get > 0 ? Math.floor(count / group) * get : 0;
    if (freeN < 1) note = `Needs ${group} or more windows. One free window per ${group} (the cheapest window price, including glass).`;
    else {
      const units = [];
      for (const l of priced) for (let i = 0; i < (Number(l.qty) || 0); i++) units.push({ material: Number(l.unit) || 0, labor: installUnit(l.install) });
      units.sort((a, b) => a.material - b.material);
      for (const u of units.slice(0, freeN)) { windowAmount += u.material; if (promo.appliesToLabor) laborAmount += u.labor; }
      windowAmount = r2(windowAmount); laborAmount = r2(laborAmount);
    }
  }
  const amount = r2(windowAmount + laborAmount);
  return { applied: true, invalid: false, amount, windowAmount, laborAmount, label: `Discount (${promo.code} · ${promo.label})`, note, promo };
}
export function totals(e) {
  const lines = e.lines || [];
  const qtyOf = (l) => Number(l.qty) || 0;
  const windows = r2(lines.reduce((s, l) => s + (Number(l.unit) || 0) * qtyOf(l), 0));
  const install = r2(lines.reduce((s, l) => s + installUnit(l.install) * qtyOf(l), 0));
  const addons = r2(lines.reduce((s, l) => s + addonUnit(l.install) * qtyOf(l), 0));
  const stucco = stuccoState(e);
  const extras = r2((e.extras || []).reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const promo = promoResult(e, windows, install);
  const discount = promo.amount;
  const labor = r2(install + addons + stucco.total);
  const shipping = SHIPPING_HANDLING;
  const afterPromo = Math.max(0, r2(windows - promo.windowAmount));
  const percentDiscount = clampPercentDiscount(e?.percentDiscount);
  const percentDiscountAmount = r2(afterPromo * percentDiscount / 100);
  const percentDiscountLabel = `Additional discount (${percentDiscount}%)`;
  const taxable = Math.max(0, r2(afterPromo - percentDiscountAmount));
  const tax = r2(taxable * SALES_TAX_PCT / 100);
  const subtotal = r2(windows + labor + extras + shipping - discount - percentDiscountAmount);
  return {
    windows, install, addons, labor, shipping, stucco: stucco.total, stuccoName: stucco.name, stuccoQty: stucco.qty, stuccoUnit: stucco.unit, stuccoOn: stucco.on,
    extras, discount, discountLabel: promo.label, promo, percentDiscount, percentDiscountAmount, percentDiscountLabel,
    subtotal, taxable, tax, taxPct: SALES_TAX_PCT, total: r2(subtotal + tax),
    count: lines.reduce((s, l) => s + qtyOf(l), 0),
  };
}
// Client-facing rows: itemized materials stay on the window lines. Labor, add-ons, and stucco are one Installation / Labor amount.
// includeMaterials false skips the window subtotal and the two material discounts when those rows are already printed above the totals.
const MATERIAL_SUMMARY = new Set(['windows', 'discount', 'percentDiscount']);
export function summaryLines(t, { includeMaterials = true } = {}) {
  const rows = [{ id: 'windows', label: 'Windows subtotal', amount: t.windows }];
  if (t.discount) rows.push({ id: 'discount', label: t.discountLabel || 'Discount', amount: -t.discount, discount: true });
  if (t.percentDiscountAmount) rows.push({ id: 'percentDiscount', label: t.percentDiscountLabel || 'Additional discount', amount: -t.percentDiscountAmount, discount: true });
  rows.push({ id: 'install', label: 'Installation / Labor', amount: t.labor });
  rows.push({ id: 'shipping', label: 'Shipping & Handling', amount: t.shipping });
  if (t.extras) rows.push({ id: 'extras', label: 'Additional items', amount: t.extras });
  rows.push({ id: 'tax', label: `Sales Tax (${SALES_TAX_PCT}%)`, amount: t.tax });
  return includeMaterials ? rows : rows.filter((row) => !MATERIAL_SUMMARY.has(row.id));
}
