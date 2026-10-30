// Core helpers, data loading, settings, estimate store, pricing.
import { isMilgardDoorLine, milgardQuote, doorColorLabel } from './milgard.js';
export { isMilgardDoorLine };
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

// Keep the caret and scroll when a form is rebuilt. Safari scrolls to the top
// and drops the keyboard if the focused input is destroyed.
export function captureView() {
  const y = window.scrollY || 0;
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement || !el.id) return { y };
  const snap = { y, id: el.id };
  if (typeof el.selectionStart === 'number') {
    snap.start = el.selectionStart;
    snap.end = el.selectionEnd;
  }
  return snap;
}
export function restoreView(snap) {
  if (!snap) return;
  if (snap.id) {
    const el = document.getElementById(snap.id);
    if (el && typeof el.focus === 'function') {
      try { el.focus({ preventScroll: true }); } catch { /* older webviews */ }
      if (typeof snap.start === 'number' && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(snap.start, snap.end ?? snap.start); } catch { /* number inputs */ }
      }
    }
  }
  if (typeof snap.y === 'number') window.scrollTo(0, snap.y);
}
export const PRICE_PENDING_LABEL = 'Price pending';
export const NOT_AVAILABLE_LABEL = 'Not available';
export const FLUSH_FIN_NOTE = 'Flush fin is only for installs into an existing aluminum frame with at least 3/8 inch of exterior surface. Not for tear-out replacements or openings over 3 stories above grade.';
export function linePriceText(line) {
  if (line?.unavailable) return NOT_AVAILABLE_LABEL;
  if (line?.pricePending) return PRICE_PENDING_LABEL;
  if (line?.unpriced) return 'Not priced';
  return fmt((Number(line?.unit) || 0) * (Number(line?.qty) || 0));
}

// ---------- data ----------
export const data = { rates: null, variableRates: null, options: null, gallery: null, settingsDefault: null, install: null, obscureGlass: null, frameTypes: null, promos: null, agreement: null, milgardOnelink: null };
export const OFFLINE_MESSAGE = "You're offline, try again when connected";
export function browserOffline() { return typeof navigator !== 'undefined' && navigator.onLine === false; }
export let settings = {};

async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

export async function loadData() {
  [data.rates, data.variableRates, data.options, data.gallery, data.settingsDefault, data.install, data.obscureGlass, data.frameTypes, data.promos, data.agreement, data.milgardOnelink] = await Promise.all([
    getJSON('data/rates.json'), getJSON('data/variable-rates.json'), getJSON('data/options.json'), getJSON('assets/gallery/gallery.json'), getJSON('data/settings.default.json'), getJSON('data/install.json'), getJSON('data/obscure-glass.json'), getJSON('data/frame-types.json'), getJSON('data/promos.json'), getJSON('data/purchase-agreement.json'), getJSON('data/milgard-onelink.json'),
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
function hasFlushFin(line) {
  return (line?.addons || []).includes('flush_fin_trim') || (line?.options || []).includes('flush_fin_trim');
}
// Andersen has no single arch-over-slider unit and no eyebrow. The quote is the
// existing equal-leg arch plus the existing XO or XOX, same width, no mull charge.
// XOX starts at 59.5 in here. The arch itself stops at 95.5, so the pair stops there.
// Standalone XOX is unchanged and still starts at 47.5.
export const ARCH_OVER = {
  arch_over_xo: { name: 'Arch over XO', base: 'hslider', baseName: 'XO', w: [23.5, 71.5], h: [11.5, 71.5] },
  arch_over_xox: { name: 'Arch over XOX', base: 'xox', baseName: 'XOX', w: [59.5, 95.5], h: [17.5, 71.5] },
};
const lineUnits = (line) => { const n = Number(line?.unitsPerLine ?? line?.units ?? 1); return n > 0 ? n : 1; };

function andersenConfig() { return data.variableRates?.andersen || null; }
function andersenTypeId(type) {
  const A = andersenConfig();
  return A?.aliases?.[type] || type;
}
export function isIntegralType(lineOrType) {
  const type = typeof lineOrType === 'string' ? lineOrType : lineOrType?.type;
  const A = andersenConfig();
  return !!A?.types?.[andersenTypeId(type)]?.integral;
}
function andersenColorTable(A, typeId) {
  if (!A) return null;
  return A.colorAdders?.[typeId] || A.colorAdders?.window || null;
}
function andersenColorAdder(A, typeId, color) {
  const n = andersenColorTable(A, typeId)?.[color];
  return typeof n === 'number' ? n : null;
}
// Colors the iQ sheet actually prices for this type. Patio doors are White, Black/White, and Black/Black.
export function seriesColorIds(brand, seriesId, type) {
  const series = brandById(brand)?.series?.find((s) => s.id === seriesId);
  const all = series?.colors || [];
  const A = andersenConfig();
  if (brand !== 'andersen' || !A || seriesId !== A.series) return all;
  const table = andersenColorTable(A, andersenTypeId(type));
  if (!table) return all;
  return all.filter((id) => typeof table[id] === 'number');
}

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
    if (ARCH_OVER[type]) {
      const spec = ARCH_OVER[type];
      return {
        mode: 'arch-over', family: 'andersen', typeId: type,
        typeDef: { name: spec.name, flushFin: { factor: 1, adder: 0 }, limits: { w: spec.w, h: spec.h } },
        colorDef: { adder: 0, ratio: 1, adjustPerUnit: 0 },
        addons: A.addons || {},
        integral: true,
      };
    }
    const typeId = andersenTypeId(type);
    const typeDef = A.types?.[typeId];
    if (!typeDef) return { mode: 'fallback' };
    const adder = andersenColorAdder(A, typeId, line.color);
    return {
      mode: 'variable', family: 'andersen', typeDef, typeId,
      colorDef: adder == null ? null : { adder, ratio: 1, adjustPerUnit: adder },
      addons: A.addons || {},
      integral: !!typeDef.integral,
      includes: typeDef.includes || null,
    };
  }
  if (brand === 'milgard') {
    if (milgardQuote(data.milgardOnelink, line)) return { mode: 'onelink' };
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
  if ((model.mode !== 'variable' && model.mode !== 'arch-over') || !model.addons) return null;
  const addons = { ...model.addons };
  if (model.family === 'andersen') {
    if (!model.typeDef?.flushFin) delete addons.flush_fin_trim;
    if (model.typeDef?.glassIncluded) {
      for (const id of [...GLASS_IDS, 'grilles_gbg', 'truscene', 'flush_fin_trim']) delete addons[id];
    }
  }
  return addons;
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
  const bits = [`${formatInches(line.w, { ascii })} ${times} ${formatInches(line.h, { ascii })}`, isMilgardDoorLine(line) ? (doorColorLabel(line.series, line.color) || colorName(line.color)) : shortColorName(colorName(line.color)), ...lineOptionNames(line)];
  if (Number(line.unitsPerLine) > 1 && !isIntegralType(line)) bits.push(`${line.unitsPerLine} units`);
  if (line.shape === 'eyebrow') bits.push('Eyebrow');
  if (line.provisional) bits.push('Provisional price');
  if (hasFlushFin(line)) bits.push(FLUSH_FIN_NOTE);
  bits.push(`Qty ${Number(line.qty) || 1}`);
  return {
    title,
    detail: bits.filter(Boolean).join(' · '),
    price: (Number(line.unit) || 0) * (Number(line.qty) || 0),
    priceText: line.unavailable ? NOT_AVAILABLE_LABEL : (line.pricePending ? PRICE_PENDING_LABEL : (line.unpriced ? 'Not priced' : '')),
    brandName: brandName || 'Windows',
  };
}
const QUOTE_FRAME = { zbar: 'Z-bar', block: 'Block frame', nailfin: 'Nailing fin' };
export function glassPackageName(line) {
  const brand = line?.brand === 'iwc_window' || line?.brand === 'iwc_door' ? 'iwc' : line?.brand;
  if (brand === 'milgard') return 'SunCoat Max Low-E (dual pane, argon)';
  if (brand === 'andersen') return 'Dual-Pane Low-E SmartSun';
  if (brand === 'iwc') return 'Xtreme Low-E';
  return '';
}
function quoteFrameName(line) {
  const id = line?.install?.frameType || line?.frameType || '';
  return QUOTE_FRAME[id] || (id ? (frameTypeById(id)?.name || String(id)) : '');
}
function obscurePatternName(line) {
  const ids = new Set([...(line?.options || []), ...(line?.addons || [])]);
  return (data.obscureGlass?.patterns || []).find((p) => ids.has(p.id))?.name || '';
}
// Customer-facing quote row. Glass package is the brand default. Tempered, obscure, and grids appear only when selected.
export function quoteLine(line, { ascii = false } = {}) {
  line = line || {};
  const brandId = line.brand === 'iwc_window' || line.brand === 'iwc_door' ? 'iwc' : line.brand;
  const brandName = brandById(line.brand)?.name || (brandId === 'iwc' ? 'IWC' : line.brand) || '';
  const custom = String(line.customDescription || '').trim();
  const product = [brandName, seriesLabel(line), typeName(line.type)].filter(Boolean).join(' ');
  const ids = new Set([...(line.addons || []), ...(line.options || [])]);
  const details = [];
  if (custom) details.push(custom);
  const color = isMilgardDoorLine(line) ? (doorColorLabel(line.series, line.color) || colorName(line.color)) : colorName(line.color);
  if (color) details.push(color);
  const frame = quoteFrameName(line);
  if (frame) details.push(frame);
  const glass = glassPackageName(line);
  if (glass) details.push(glass);
  if (ids.has('tempered')) details.push('Tempered (safety) glass');
  else if (ids.has('tempered_lower')) details.push('Tempered (lower sash only)');
  if (ids.has('laminated')) details.push('Laminated glass');
  if (ids.has('obscure')) {
    const pattern = obscurePatternName(line);
    details.push(pattern ? `Obscured glass (${pattern})` : 'Obscured glass');
  }
  if (ids.has('grids') || ids.has('grids-colonial')) details.push('Grids (flat colonial)');
  else if (ids.has('grids-prairie')) details.push('Grids (Prairie)');
  if (ids.has('grilles_gbg')) details.push('Grilles between the glass');
  if (ids.has('truscene')) details.push('TruScene screen');
  if (ids.has('flush_fin_trim')) details.push('Flush fin + interior trim');
  if (ids.has('screen')) details.push('Screen');
  if (line.pureview || ids.has('pureview')) details.push('PureView screen');
  if (line.pricePending) details.push('Price pending — not a OneLink price');
  if (line.provisional) details.push('Provisional price');
  if (line.unavailable) details.push(NOT_AVAILABLE_LABEL);
  if (hasFlushFin(line)) details.push(FLUSH_FIN_NOTE);
  if (Number(line.unitsPerLine) > 1 && !isIntegralType(line)) details.push(`${line.unitsPerLine} units`);
  const times = ascii ? 'x' : '×';
  return {
    location: line.label || 'Window',
    title: product || custom || 'Window',
    details,
    size: `${formatInches(line.w, { ascii })} ${times} ${formatInches(line.h, { ascii })}`,
    qty: Number(line.qty) || 1,
    price: (Number(line.unit) || 0) * (Number(line.qty) || 0),
    priceText: line.unavailable ? NOT_AVAILABLE_LABEL : (line.pricePending ? PRICE_PENDING_LABEL : (line.unpriced ? 'Not priced' : '')),
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
  if (def.type === 'flushFin') return 'flush-fin price';
  return '';
}
export function fittedIncludes(line) {
  const inc = classifyLine(line).includes;
  if (!inc) return '';
  return 'Included in the price: ' + (Array.isArray(inc) ? inc.join(', ') : inc) + '.';
}
export function variableRateInfo(brand, series, color, type) {
  const probe = { brand, series, color, type, w: 36, h: 48 };
  const model = classifyLine(probe);
  if (model.mode === 'onelink') {
    const q = milgardQuote(data.milgardOnelink, probe);
    if (q?.unavailable) return { onelink: true, unavailable: true };
    if (q?.pricePending) return { onelink: true, pricePending: true, perUI: q.perUI || 0, base: q.base || 0 };
    if (q?.formula) return { onelink: true, base: q.base || 0, perUI: q.perUI || 0, min: q.min || null, adder: q.adder || 0, adderSpec: q.adderSpec || null, provisional: !!q.provisional };
    return { onelink: true };
  }
  if (model.mode !== 'variable') return null;
  if (model.family === 'andersen' && !model.colorDef) return { blocked: true };
  const t = model.typeDef;
  const c = model.colorDef || {};
  return {
    base: t.base || 0, perUI: t.perUI || 0, perSqFt: t.perSqFt || 0,
    ratio: c.ratio ?? 1, adjustPerUnit: c.adjustPerUnit || c.adder || 0,
    provisional: !!t.provisional, roundUp: model.family === 'andersen',
  };
}
function limitRange(pair) {
  if (!pair) return '';
  const [min, max] = pair;
  if (min != null && max != null) return `${formatInches(min)}–${formatInches(max)}`;
  if (min != null) return `at least ${formatInches(min)}`;
  if (max != null) return `${formatInches(max)} or less`;
  return '';
}
export function sizeLimitText(line) {
  const over = ARCH_OVER[line?.type];
  if (over && line?.brand === 'andersen') {
    const w = limitRange(over.w);
    const h = limitRange(over.h);
    return `${over.name}: width ${w}, height ${h}. The arch is the same width, with a rise of about one quarter of the width. No eyebrow. No mull charge.`;
  }
  const A = andersenConfig();
  if (!A || line?.brand !== 'andersen' || line?.series !== A.series) return '';
  const typeDef = A.types?.[andersenTypeId(line.type)];
  if (!typeDef?.limits) return '';
  const bits = [];
  const w = limitRange(typeDef.limits.w);
  const h = limitRange(typeDef.limits.h);
  if (w) bits.push(`width ${w}`);
  if (h) bits.push(`height ${h}`);
  let text = `${typeDef.name}: ${bits.join(', ')}.`;
  if (typeDef.limits.rule) text += ` ${typeDef.limits.rule}.`;
  if (typeDef.integral) text += ' Priced as one combined unit at this overall size.';
  return text;
}
function andersenSizeErrors(typeDef, w, h) {
  const name = typeDef?.name || 'This unit';
  const L = typeDef?.limits || {};
  const errs = [];
  const [wmin, wmax] = L.w || [];
  const [hmin, hmax] = L.h || [];
  if (wmin != null && w < wmin - 1e-6) errs.push(`${name} width must be at least ${formatInches(wmin)} (Andersen 100 limit).`);
  if (wmax != null && w > wmax + 1e-6) errs.push(`${name} width must be ${formatInches(wmax)} or less (Andersen 100 limit).`);
  if (hmin != null && h < hmin - 1e-6) errs.push(`${name} height must be at least ${formatInches(hmin)} (Andersen 100 limit).`);
  if (hmax != null && h > hmax + 1e-6) errs.push(`${name} height must be ${formatInches(hmax)} or less (Andersen 100 limit).`);
  const rule = String(L.rule || '');
  const maxH = /H max ([0-9.]+) when W>=([0-9.]+)/i.exec(rule);
  if (maxH) {
    const cap = Number(maxH[1]);
    const at = Number(maxH[2]);
    if (w >= at - 1e-9 && h > cap + 1e-6) errs.push(`${name} height must be ${formatInches(cap)} or less when the width is ${formatInches(at)} or more.`);
  }
  const short = /short side >= ([0-9.]+)/i.exec(rule);
  if (short) {
    const minSide = Number(short[1]);
    if (h < minSide - 1e-6) errs.push(`${name} short side must be at least ${formatInches(minSide)}, so the overall height has to be at least ${formatInches(minSide)}.`);
  }
  return errs;
}
function andersenColorError(typeDef, typeId, color) {
  const table = andersenColorTable(andersenConfig(), typeId) || {};
  const names = Object.entries(table).filter(([, v]) => typeof v === 'number').map(([id]) => colorName(id));
  return `${typeDef?.name || 'This unit'} is not priced in ${colorName(color)}. Priced colors: ${names.join(', ')}.`;
}
// Next whole dollar. A hair under an integer is float dust (750.0000001), not a real fraction (750.004).
function roundUpDollar(n) {
  return Math.ceil(Number(n) - 1e-6);
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
  if (isMilgardDoorLine(line)) return false;
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
function andersenRaw(model, line) {
  const w = finite(line.w), h = finite(line.h);
  const t = model.typeDef;
  const errors = [];
  if (!model.colorDef) errors.push(andersenColorError(t, model.typeId, line.color));
  errors.push(...andersenSizeErrors(t, w, h));
  if (errors.length) return { blocked: true, errors };
  const ui = w + h, sqft = w * h / 144;
  const core = (t.base || 0) + (t.perUI || 0) * ui + (t.perSqFt || 0) * sqft;
  const flushOn = !!(t.flushFin && (line.addons || []).includes('flush_fin_trim'));
  const afterFlush = flushOn ? core * t.flushFin.factor + (Number(t.flushFin.adder) || 0) : core;
  const colorAdder = model.colorDef.adder || 0;
  const colored = afterFlush + colorAdder;
  let extra = 0;
  for (const id of chosenAddonIds(line, model.addons)) {
    if (id === 'flush_fin_trim') continue;
    if (t.glassIncluded && GLASS_IDS.includes(id)) continue;
    const A = model.addons[id];
    if (!A || A.type === 'flushFin') continue;
    if (A.type === 'perUI') extra += (A.amount || 0) * ui;
    else if (A.type === 'perWindow') extra += A.amount || 0;
    else if (A.type === 'perSqFt') extra += capAddon(A, (A.amount || 0) * sqft);
    else if (A.type === 'perWindowPlusPerSqFt') extra += capAddon(A, (A.amount || 0) + (A.perSqFt || 0) * sqft);
    else if (A.type === 'perWindowPlusPerUI') extra += capAddon(A, (A.amount || 0) + (A.perUI || 0) * ui);
    else if (A.type === 'percentOfWindow') extra += (A.amount || 0) / 100 * colored;
  }
  const stray = strayOptionExtra({ ...line, unitsPerLine: 1, units: 1 }, model, colored, w, h);
  const units = model.integral ? 1 : lineUnits(line);
  const preRound = (colored + extra + stray) * units;
  if (!(preRound > 0) || !Number.isFinite(preRound)) {
    return { blocked: true, errors: [`${t.name} is outside the priced Andersen 100 range, so it is not priced.`] };
  }
  return {
    blocked: false, unit: roundUpDollar(preRound), preRound, core, ui, sqft, afterFlush, colorAdder, colored,
    extra: extra + stray, units, flush: flushOn,
    flushFactor: flushOn ? t.flushFin.factor : null,
    flushAdder: flushOn ? (Number(t.flushFin.adder) || 0) : 0,
    ratio: 1, adjust: colorAdder, scaledPerUI: 0, typeDef: t, roundedUp: true,
  };
}
function archOverLimitErrors(spec, w, h) {
  const name = spec.name;
  const errs = [];
  const [wmin, wmax] = spec.w;
  const [hmin, hmax] = spec.h;
  if (w < wmin - 1e-6) errs.push(`${name} width must be at least ${formatInches(wmin)} (Andersen 100 limit).`);
  if (w > wmax + 1e-6) errs.push(`${name} width must be ${formatInches(wmax)} or less (Andersen 100 limit).`);
  if (h < hmin - 1e-6) errs.push(`${name} height must be at least ${formatInches(hmin)} (Andersen 100 limit).`);
  if (h > hmax + 1e-6) errs.push(`${name} height must be ${formatInches(hmax)} or less (Andersen 100 limit).`);
  return errs;
}
function buildArchOver(line) {
  const spec = ARCH_OVER[line.type];
  const w = finite(line.w), h = finite(line.h);
  const rise = Math.round(w * 0.25 * 1000) / 1000;
  const note = 'Two lines, no mull charge. Andersen has no eyebrow. The arch price assumes a rise of about one quarter of the width.';
  const errors = archOverLimitErrors(spec, w, h);
  const shared = {
    brand: 'andersen', series: line.series, color: line.color, w,
    qty: 1, unitsPerLine: 1,
    addons: [...(line.addons || [])],
    options: [...(line.options || [])],
    install: line.install,
  };
  const archLine = { ...shared, type: 'specialty_arch', h: rise, customDescription: 'Equal-leg arch, rise about 1/4 of the width' };
  const baseLine = { ...shared, type: spec.base, h, customDescription: '' };
  const archBuilt = errors.length ? null : buildMaterial(archLine);
  const baseBuilt = errors.length ? null : buildMaterial(baseLine);
  if (archBuilt?.blocked) errors.push(`Arch rise is about ${formatInches(rise)} (one quarter of the width). ${archBuilt.errors.join(' ')}`);
  if (baseBuilt?.blocked) errors.push(...baseBuilt.errors);
  const blank = { mode: 'arch-over', combo: true, blocked: true, errors, unit: null, unitBase: null, optionsEach: 0, rate: null, estimated: false, wh: w + h, fromQuotes: true, detail: null, parts: [], note, provisional: false };
  if (errors.length) return blank;
  const parts = [
    { label: `Equal-leg arch ${formatInches(w)} × ${formatInches(rise)}`, role: 'arch', ...archBuilt, line: archLine },
    { label: `${spec.baseName} ${formatInches(w)} × ${formatInches(h)}`, role: 'base', ...baseBuilt, line: baseLine },
  ];
  const unit = r2(archBuilt.unit + baseBuilt.unit);
  return {
    mode: 'arch-over', combo: true, blocked: false, errors: [], unit, unitBase: unit,
    optionsEach: r2((archBuilt.optionsEach || 0) + (baseBuilt.optionsEach || 0)),
    rate: null, estimated: false, wh: w + h, fromQuotes: true, detail: null, parts, note,
    provisional: false, flush: hasFlushFin(line),
  };
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
  if (model.mode === 'arch-over') return buildArchOver(line);
  if (model.mode === 'onelink') {
    const q = milgardQuote(data.milgardOnelink, line);
    const units = lineUnits(line);
    if (q.unavailable) {
      return {
        mode: 'onelink', blocked: true, unavailable: true, errors: [NOT_AVAILABLE_LABEL],
        unit: null, unitBase: null, optionsEach: 0, rate: null, estimated: false, wh: w + h,
        fromQuotes: false, detail: null, notes: q.notes, pricePending: false, provisional: false,
      };
    }
    const pricePending = !!q.pricePending;
    const unit = pricePending ? 0 : roundMoney(q.material * units);
    return {
      mode: 'onelink', unit, unitBase: unit, optionsEach: 0,
      rate: q.perUI ?? null, estimated: false, wh: w + h, fromQuotes: !pricePending, detail: null,
      notes: q.notes, errors: q.errors, onelink: q, pricePending, provisional: !!q.provisional,
      unavailable: false,
    };
  }
  if (model.mode === 'variable') {
    if (model.family === 'andersen') {
      const d = andersenRaw(model, line);
      if (d.blocked) {
        return { mode: 'variable', blocked: true, errors: d.errors, unit: null, unitBase: null, optionsEach: 0, rate: null, estimated: false, wh: w + h, fromQuotes: true, detail: null };
      }
      const coreRounded = roundUpDollar(d.colored * d.units);
      return {
        mode: 'variable', unit: d.unit, unitBase: coreRounded, optionsEach: d.unit - coreRounded,
        rate: null, estimated: false, wh: d.ui, fromQuotes: true, provisional: false, detail: d,
      };
    }
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
  if (!built || built.blocked || built.unit == null) return null;
  return built.unit;
}
export function linePrice(line) { return priceWindow(line); }
// ---------- installation / labor (separate from window price and from add-ons) ----------
export const installType = (id) => data.install.types.find((t) => t.id === id) || data.install.types[0];
export const defaultInstall = () => ({ type: data.install.defaultType, surcharges: [], override: null, custom: null, frameType: null });
export const frameTypeById = (id) => data.frameTypes?.types?.find((t) => t.id === id);
const surchargeDef = (id) => data.install?.surcharges?.find((x) => x.id === id);
const doorAddonDef = (id) => data.install?.doors?.addons?.find((x) => x.id === id);
const doorPanelKey = (line) => (data.install?.doors?.panels?.[line?.type] != null ? line.type : null);
// inst = {type, surcharges[], override, custom, headerFeet, writeIn:{description, amount}}
// Labor only. Add-ons, including door header footage and the write-in, are addonUnit.
export function installUnit(inst, line) {
  inst = inst || defaultInstall();
  if (inst.override != null && inst.override !== '' && !isNaN(inst.override)) return roundMoney(Number(inst.override));
  if (line && isMilgardDoorLine(line) && doorPanelKey(line)) {
    const doors = data.install.doors;
    const base = Number(doors.panels[line.type]) || 0;
    const tall = Number(line.h) > (Number(doors.tallOverInches) || 84) ? Number(doors.tallAdd) || 0 : 0;
    return roundMoney(base + tall);
  }
  const t = installType(inst.type);
  const base = t.custom && inst.custom != null && inst.custom !== '' ? Number(inst.custom) || 0 : t.price;
  return roundMoney(base);
}
export function addonNames(inst, line) {
  if (line && isMilgardDoorLine(line)) {
    const names = (inst?.surcharges || []).map((id) => {
      const def = doorAddonDef(id);
      if (!def) return '';
      if (def.per === 'linearFoot') {
        const feet = Number(inst.headerFeet) || 0;
        return `${def.name} (${feet} ft)`;
      }
      return def.name;
    }).filter(Boolean);
    const write = Number(inst?.writeIn?.amount) || 0;
    if (write || String(inst?.writeIn?.description || '').trim()) names.push(inst.writeIn.description || 'Write-in');
    return names;
  }
  return (inst?.surcharges || []).map((id) => surchargeDef(id)?.name).filter(Boolean);
}
export function addonUnit(inst, line) {
  if (line && isMilgardDoorLine(line)) {
    let sur = 0;
    for (const id of inst?.surcharges || []) {
      const def = doorAddonDef(id);
      if (!def) continue;
      if (def.per === 'linearFoot') sur += (Number(def.amount) || 0) * (Number(inst.headerFeet) || 0);
      else sur += Number(def.amount) || 0;
    }
    sur += Number(inst?.writeIn?.amount) || 0;
    return roundMoney(sur);
  }
  const sur = (inst?.surcharges || []).reduce((s, id) => s + (Number(surchargeDef(id)?.amount) || 0), 0);
  return roundMoney(sur);
}
export function installLabel(inst, line) {
  inst = inst || defaultInstall();
  if (line && isMilgardDoorLine(line) && doorPanelKey(line)) {
    const name = { '2panel': '2-panel', '3panel': '3-panel', '4panel': '4-panel' }[line.type] || 'Patio door';
    const tall = Number(line.h) > (Number(data.install?.doors?.tallOverInches) || 84) ? ', over 7 ft' : '';
    return `${name} slider install${tall}`;
  }
  const t = installType(inst.type);
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
  if (built.blocked) return { ...built, total: null };
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
    const has = e.lines.length || (e.extras || []).length || e.stuccoRepair?.on || e.customer.name || e.customer.address || e.customer.phone || e.customer.email || e.notes || e.promoCode || Number(e.percentDiscount) > 0 || e.contract || (e.overlays || []).length;
    if (has || this.all()[e.id]) this.save(e);
  },
  duplicate(id) {
    const src = this.all()[id]; if (!src) return null;
    const c = JSON.parse(JSON.stringify(src)); c.id = uid(); c.number = this.nextNumber(); c.created = Date.now();
    c.lines.forEach((l) => (l.id = uid())); c.customer.name = c.customer.name ? c.customer.name + ' (copy)' : '';
    delete c.contract;
    delete c.remoteId;
    delete c.ownerId;
    delete c.ownerName;
    delete c.hubspotContactId;
    delete c.hubspotDealId;
    delete c.hubspotChoice;
    delete c.hubspotPossibleMatch;
    delete c.presentedAt;
    delete c.signedAt;
    delete c.sentAt;
    delete c.sentTo;
    delete c.contractRowId;
    delete c.qbo;
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
      for (const l of priced) for (let i = 0; i < (Number(l.qty) || 0); i++) units.push({ material: Number(l.unit) || 0, labor: installUnit(l.install, l) });
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
  const install = r2(lines.reduce((s, l) => s + installUnit(l.install, l) * qtyOf(l), 0));
  const addons = r2(lines.reduce((s, l) => s + addonUnit(l.install, l) * qtyOf(l), 0));
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
  const materialsSub = r2(taxable + tax + shipping);
  return {
    windows, install, addons, labor, shipping, stucco: stucco.total, stuccoName: stucco.name, stuccoQty: stucco.qty, stuccoUnit: stucco.unit, stuccoOn: stucco.on,
    extras, discount, discountLabel: promo.label, promo, percentDiscount, percentDiscountAmount, percentDiscountLabel,
    subtotal, materialsSub, taxable, tax, taxPct: SALES_TAX_PCT, total: r2(subtotal + tax),
    count: lines.reduce((s, l) => s + qtyOf(l), 0),
  };
}
// On-screen quote. Materials, tax, and shipping stay together. Installation is every
// window and door labor line plus add-ons, and it is not part of the material price or the tax.
export function quoteTotalRows(t) {
  const rows = [{ id: 'windows', label: 'Windows & doors', amount: t.windows }];
  const laborOff = t.promo?.laborAmount || 0;
  const materialOff = r2((t.discount || 0) - laborOff);
  if (materialOff) rows.push({ id: 'discount', label: t.discountLabel || 'Discount', amount: -materialOff, discount: true });
  if (t.percentDiscountAmount) rows.push({ id: 'percentDiscount', label: t.percentDiscountLabel || 'Additional discount', amount: -t.percentDiscountAmount, discount: true });
  rows.push({ id: 'tax', label: `Tax ${t.taxPct}% (materials only)`, amount: t.tax });
  rows.push({ id: 'shipping', label: 'Shipping', amount: t.shipping });
  rows.push({ id: 'materialsSub', label: 'Materials subtotal', amount: t.materialsSub, strong: true });
  rows.push({ id: 'install', label: 'Installation', amount: t.labor, strong: true });
  if (laborOff) rows.push({ id: 'laborDiscount', label: t.discountLabel || 'Discount', amount: -laborOff, discount: true });
  if (t.extras) rows.push({ id: 'extras', label: 'Additional items', amount: t.extras });
  return rows;
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
