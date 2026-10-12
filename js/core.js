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
export const data = { rates: null, options: null, gallery: null, settingsDefault: null, install: null, obscureGlass: null, frameTypes: null };
export let settings = {};

async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

export async function loadData() {
  [data.rates, data.options, data.gallery, data.settingsDefault, data.install, data.obscureGlass, data.frameTypes] = await Promise.all([
    getJSON('data/rates.json'), getJSON('data/options.json'), getJSON('assets/gallery/gallery.json'), getJSON('data/settings.default.json'), getJSON('data/install.json'), getJSON('data/obscure-glass.json'), getJSON('data/frame-types.json'),
  ]);
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

export function getRate(brandId, series, color, type, rateSet = settings.rateSet) {
  const b = brandById(brandId);
  let r = b?.rates?.[`${series}|${color}|${type}`];
  if (!r) { // derived color (e.g. Adobe = black/black x multiplier; always flagged estimated)
    const d = b?.derivedColors?.[color]; const base = d && b.rates[`${series}|${d.from}|${type}`]; const m = d?.multiplier ?? 1;
    if (base) r = { p75: base.p75 * m, max: base.max * m, estimated: true, n: 0 };
  }
  if (!r) return null;
  return { rate: rateSet === 'max' ? r.max : r.p75, estimated: !!r.estimated, raw: r };
}
const roundMoney = (n) => settings.roundToDollar ? Math.round(n) : Math.round(n * 100) / 100;

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
// ---------- installation / labor (separate from window price) ----------
export const installType = (id) => data.install.types.find((t) => t.id === id) || data.install.types[0];
export const defaultInstall = () => ({ type: data.install.defaultType, surcharges: [], override: null, custom: null, frameType: null });
export const frameTypeById = (id) => data.frameTypes?.types?.find((t) => t.id === id);
// inst = {type, surcharges[], override (number|null), custom (number|null for 'custom' type)}
export function installUnit(inst) {
  inst = inst || defaultInstall();
  if (inst.override != null && inst.override !== '' && !isNaN(inst.override)) return roundMoney(Number(inst.override));
  const t = installType(inst.type);
  const base = t.custom && inst.custom != null && inst.custom !== '' ? Number(inst.custom) || 0 : t.price;
  const sur = (inst.surcharges || []).reduce((s, id) => s + (data.install.surcharges.find((x) => x.id === id)?.amount || 0), 0);
  return roundMoney(base + sur);
}
export function installLabel(inst) {
  inst = inst || defaultInstall(); const t = installType(inst.type);
  const frame = frameTypeById(inst.frameType);
  const sur = (inst.surcharges || []).map((id) => data.install.surcharges.find((x) => x.id === id)?.name).filter(Boolean);
  const name = frame ? `${frame.name} (${t.name})` : t.name;
  return name + (sur.length ? ' + ' + sur.join(', ') : '');
}
// Returns {unitBase, optionsEach, unit, total, rate, wh}
export function priceWindow({ brand, series, color, type, w, h, qty = 1, options = [] }) {
  const rr = getRate(brand, series, color, type);
  if (!rr || !(w > 0) || !(h > 0)) return null;
  const wh = w + h;
  const unitBase = roundMoney(wh * rr.rate);
  const optionsEach = roundMoney(options.reduce((s, id) => s + optionPrice(optionDef(id), unitBase, w, h), 0));
  const unit = roundMoney(unitBase + optionsEach);
  return { rate: rr.rate, estimated: rr.estimated, wh, unitBase, optionsEach, unit, total: roundMoney(unit * qty) };
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
      customer: { name: '', address: '', phone: '', email: '' }, lines: [], extras: [], notes: '', taxPct: settings.taxPct, validDays: settings.validDays, saved: false };
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
    if (e.lines.length || (e.extras || []).length || e.customer.name || e.customer.address || e.customer.phone || e.customer.email || e.notes) this.save(e);
  },
  duplicate(id) {
    const src = this.all()[id]; if (!src) return null;
    const c = JSON.parse(JSON.stringify(src)); c.id = uid(); c.number = this.nextNumber(); c.created = Date.now();
    c.lines.forEach((l) => (l.id = uid())); c.customer.name = c.customer.name ? c.customer.name + ' (copy)' : '';
    this.save(c); this._cur = c; this.setCurrent(c.id); return c;
  },
};
export function totals(e) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const windows = r2(e.lines.reduce((s, l) => s + l.unit * l.qty, 0));
  const install = r2(e.lines.reduce((s, l) => s + (l.installUnit || 0) * l.qty, 0));
  const extras = r2((e.extras || []).reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const subtotal = r2(windows + install + extras);
  const taxable = (settings.taxOn === 'all') ? subtotal : windows;
  const tax = r2(taxable * (e.taxPct || 0) / 100);
  return { windows, install, extras, subtotal, taxable, tax, total: r2(subtotal + tax), count: e.lines.reduce((s, l) => s + l.qty, 0) };
}
