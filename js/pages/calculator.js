import { h, fmt, data, settings, brandById, typeName, colorById, priceWindow, installUnit, addonUnit, addonNames, installLabel, installType, defaultInstall, estimates, toast, store, uid, totals, quoteTotalRows, lineAddonDefs, isAutoAddon, addonName, addonPriceHint, setLineAddon, fittedIncludes, isCustomLine, needsFrameWarning, FRAME_TYPE_WARNING, captureView, restoreView, seriesColorIds, sizeLimitText, isIntegralType } from '../core.js';
import { renderMilgard, roomLabelProps } from './milgard-ui.js';
import { frameSVG } from '../frames.js';
import { drawingEl } from '../drawings.js';

const calc = Object.assign({ brand: 'milgard', series: 'V250', type: 'hslider', color: 'ww', w: '', h: '', qty: 1, unitsPerLine: 1, label: '', options: null, addons: [], supplierPrice: '', customDescription: '', details: false, install: null }, store.get('nwd.calc', {}));
const persist = () => store.set('nwd.calc', calc);

function knownOptionIds() {
  const ids = new Set([...(data.options.glass || []), ...(data.options.frame || [])].map((o) => o.id));
  (data.obscureGlass?.patterns || []).forEach((p) => ids.add(p.id));
  return ids;
}
function defaultOptions() {
  return [...data.options.glass, ...data.options.frame].filter((o) => o.defaultOn).map((o) => o.id);
}
function normalize() {
  const b = brandById(calc.brand) || data.rates.brands[0]; calc.brand = b.id;
  if (!calc.install) calc.install = defaultInstall();
  if (!Array.isArray(calc.install.surcharges)) calc.install.surcharges = [];
  const known = knownOptionIds();
  if (!calc.options) calc.options = defaultOptions();
  else calc.options = calc.options.filter((id) => known.has(id));
  if (!Array.isArray(calc.addons)) calc.addons = [];
  if (!(Number(calc.unitsPerLine) > 0)) calc.unitsPerLine = 1;
  if (isIntegralType(calc)) calc.unitsPerLine = 1;
  if (!b.series.length) return b;
  let s = b.series.find((x) => x.id === calc.series); if (!s) { s = b.series[0]; calc.series = s.id; }
  if (calc.type !== 'custom_supplier' && !s.types.includes(calc.type)) calc.type = s.types[0];
  const colors = seriesColorIds(calc.brand, calc.series, calc.type);
  if (!colors.includes(calc.color)) calc.color = colors[0] || s.colors[0];
  const defs = lineAddonDefs(calc);
  if (defs) calc.addons = calc.addons.filter((id) => defs[id]);
  return b;
}

export function icon(type, color = 'white', cls = 'tyicon') {
  const d = h('span', { class: cls }); d.innerHTML = frameSVG(type, color, 1.0, { size: 90, glassOpacity: 0.5 }); return d;
}
export const frameKeyFor = (colorId) => colorById(colorId)?.frame || 'white';

function obscureIds() { return new Set((data.obscureGlass?.patterns || []).map((p) => p.id)); }
export function applyObscurePattern(patternId) {
  if (!calc.options) calc.options = defaultOptions();
  const ids = obscureIds();
  calc.options = calc.options.filter((id) => !ids.has(id));
  if (!calc.options.includes('obscure')) calc.options.push('obscure');
  calc.options.push(patternId);
  persist();
}
export function currentObscurePattern() {
  const ids = obscureIds();
  return (calc.options || []).find((id) => ids.has(id)) || null;
}
export function applyFrameType(frameId) {
  if (!calc.install) calc.install = defaultInstall();
  const ft = (data.frameTypes?.types || []).find((t) => t.id === frameId);
  if (!ft) return;
  calc.install.frameType = ft.id;
  if (ft.installType) calc.install.type = ft.installType;
  persist();
}
export function currentFrameType() { return calc.install?.frameType || null; }

function legacyOptionCheck(line, o, onChange, idp) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', id: idp + o.id, checked: (line.options || []).includes(o.id) ? 'checked' : null, onchange: (e) => {
    line.options = e.target.checked ? [...(line.options || []), o.id] : (line.options || []).filter((x) => x !== o.id);
    if (o.id === 'obscure' && !e.target.checked) {
      const ids = new Set((data.obscureGlass?.patterns || []).map((p) => p.id));
      line.options = line.options.filter((id) => !ids.has(id));
    }
    onChange();
  } }), h('span', {}, o.name), o.price?.type !== 'included' && o.price?.amount ? h('em', {}, ' +' + (o.price.type === 'percent' ? o.price.amount + '%' : fmt(o.price.amount))) : null);
}
export function upgradeEditor(line, onChange, idp = 'opt-') {
  if (line.type === 'custom_supplier' || (isCustomLine(line) && !lineAddonDefs(line))) {
    return h('p', { class: 'fine' }, 'Custom unit: the supplier price is the material price. Glass and grid upcharges are not added.');
  }
  const defs = lineAddonDefs(line);
  if (!defs) {
    return h('div', { class: 'cols2' },
      h('div', {}, h('b', {}, 'Glass'), data.options.glass.map((o) => legacyOptionCheck(line, o, onChange, idp))),
      h('div', {}, h('b', {}, 'Frame / extras'), data.options.frame.map((o) => legacyOptionCheck(line, o, onChange, idp))));
  }
  const autoOn = Object.entries(defs).filter(([, d]) => isAutoAddon(d) && d.auto === `frameType:${line.install?.frameType}`);
  const entries = Object.entries(defs).filter(([, d]) => !isAutoAddon(d));
  if (!entries.length) return h('p', { class: 'fine' }, fittedIncludes(line) || 'No extra glass upcharges on this series.');
  const GL = ['tempered', 'tempered_lower', 'laminated', 'obscure'];
  const glass = entries.filter(([id]) => GL.includes(id));
  const extra = entries.filter(([id]) => !GL.includes(id));
  const mk = ([id, def]) => {
    const on = (line.addons || []).includes(id) || (line.options || []).includes(id) || (id === 'grids' && (line.options || []).includes('grids-colonial'));
    return h('label', { class: 'check' }, h('input', { type: 'checkbox', id: idp + id, checked: on ? 'checked' : null, onchange: (e) => { setLineAddon(line, id, e.target.checked); onChange(); } }), h('span', {}, addonName(id, def)), h('em', {}, ' ' + addonPriceHint(def)));
  };
  return h('div', {},
    h('div', { class: 'cols2' }, h('div', {}, h('b', {}, 'Glass'), glass.map(mk)), h('div', {}, h('b', {}, 'Upgrades'), extra.map(mk))),
    autoOn.length ? h('p', { class: 'fine', id: idp + '-auto-addons' }, 'Added for the frame type: ' + autoOn.map(([id, d]) => `${addonName(id, d)} ${addonPriceHint(d)}`).join(', ') + '.') : null,
    fittedIncludes(line) ? h('p', { class: 'fine' }, fittedIncludes(line)) : null);
}
export function customPriceFields(line, onChange, idp = 'in') {
  if (line.type !== 'custom_supplier' && !isCustomLine(line)) return null;
  return h('div', { class: 'custom-price' },
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Unit description'), h('input', { type: 'text', id: idp + '-custom-desc', value: line.customDescription || '', placeholder: 'e.g. V400 Tuscany composite slider', oninput: (e) => { line.customDescription = e.target.value; onChange(); } })),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Supplier price ($ per unit)'), h('input', { type: 'text', inputmode: 'decimal', id: idp + '-supplier', value: line.supplierPrice ?? '', placeholder: 'customer price from the supplier', oninput: (e) => { line.supplierPrice = e.target.value.replace(/[^0-9.]/g, ''); onChange(); } })),
    h('p', { class: 'fine' }, 'Used as the customer material price. Promo codes do not discount this line unless the code says so.'));
}
function mathText(p, w, h) {
  if (p.mode === 'custom') return 'Supplier price, used as entered.';
  if (p.mode !== 'variable' || !p.detail) {
    return `(${w} + ${h}) = ${p.wh}" × $${p.rate.toFixed(4)}/in = ${fmt(p.unitBase)}` + (p.optionsEach ? ` + glass ${fmt(p.optionsEach)}` : '');
  }
  const d = p.detail, t = d.typeDef;
  const bits = [];
  if (t.base) bits.push(fmt(t.base));
  if (t.perUI) bits.push(`$${t.perUI} × ${d.ui}"`);
  if (t.perSqFt) bits.push(`$${t.perSqFt} × ${(d.sqft).toFixed(2)} sq ft`);
  let s = bits.join(' + ') || '$0';
  if (d.flush) s = `(${s}) × ${d.flushFactor} + ${fmt(d.flushAdder)}`;
  if (d.scaledPerUI) s = `(${s} + $${d.scaledPerUI}/UI × ${d.ui}")`;
  if (d.ratio !== 1) s = `(${s}) × ${d.ratio}`;
  if (d.colorAdder) s += ` + color ${fmt(d.colorAdder)}`;
  else if (d.adjust) s += ` ${d.adjust < 0 ? '−' : '+'} ${fmt(Math.abs(d.adjust))}`;
  if (d.extra) s += ` + add-ons ${fmt(d.extra)}`;
  if (d.units !== 1) s += ` × ${d.units} units`;
  if (d.roundedUp) s += ', rounded up';
  return `${s} = ${fmt(p.unit)}`;
}

function decimalText(raw) {
  const cleaned = String(raw ?? '').replace(/[^0-9.]/g, '');
  const i = cleaned.indexOf('.');
  return i < 0 ? cleaned : cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, '');
}
export function stepper(label, value, onChange, { step = 1, min = 0, unit = '', id, pattern } = {}) {
  const input = h('input', { type: 'text', inputmode: 'decimal', pattern: pattern || null, id, value: value ?? '', placeholder: '0', 'aria-label': label,
    oninput: (e) => {
      const cleaned = decimalText(e.target.value);
      if (e.target.value !== cleaned) e.target.value = cleaned;
      onChange(cleaned);
    } });
  const bump = (d) => { const v = Math.max(min, (parseFloat(input.value) || 0) + d); input.value = Math.round(v * 100) / 100; onChange(String(input.value)); };
  return h('label', { class: 'field stepper' }, h('span', { class: 'lbl' }, label, unit && h('em', {}, ' ' + unit)),
    h('div', { class: 'row nowrap' }, h('button', { type: 'button', class: 'btn sq', onclick: () => bump(-step) }, '−'), input, h('button', { type: 'button', class: 'btn sq', onclick: () => bump(step) }, '+')));
}

// Reusable install editor (calculator + estimate line editing). inst is mutated; onChange called after.
export function installEditor(inst, onChange, idp = 'inst', line = null) {
  const t = installType(inst.type);
  const frames = data.frameTypes?.types || [];
  const priceLabel = (x) => x.custom ? x.name : `${x.name} — ${fmt(x.price)}${x.placeholder ? ' (placeholder)' : ''}`;
  const frameWarn = line && needsFrameWarning({ brand: line.brand, series: line.series, install: inst, frameType: line.frameType })
    ? h('p', { class: 'warn frame-warn', id: idp + '-frame-warn' }, FRAME_TYPE_WARNING)
    : null;
  return h('div', { class: 'install-ed' },
    frames.length ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Frame type'),
      h('select', { id: idp + '-frame', onchange: (e) => {
        const id = e.target.value;
        inst.frameType = id || null;
        const ft = frames.find((f) => f.id === id);
        if (ft?.installType) inst.type = ft.installType;
        onChange(true);
      } }, h('option', { value: '', selected: !inst.frameType ? 'selected' : null }, 'Not set'), frames.map((f) => h('option', { value: f.id, selected: f.id === inst.frameType ? 'selected' : null }, f.name))),
      frameWarn) : frameWarn,
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Install type'),
      h('select', { id: idp + '-type', onchange: (e) => {
        inst.type = e.target.value;
        const match = frames.find((f) => f.installType === inst.type);
        inst.frameType = match ? match.id : null;
        onChange(true);
      } }, data.install.types.map((x) => h('option', { value: x.id, selected: x.id === inst.type ? 'selected' : null }, priceLabel(x))))),
    t.custom && h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Custom install price ($ per window)'), h('input', { type: 'text', inputmode: 'decimal', id: idp + '-custom', value: inst.custom ?? '', oninput: (e) => { inst.custom = e.target.value.replace(/[^0-9.]/g, ''); onChange(); } })),
    h('div', { class: 'checks' }, data.install.surcharges.map((s) => h('label', { class: 'check' }, h('input', { type: 'checkbox', id: idp + '-sur-' + s.id, checked: (inst.surcharges || []).includes(s.id) ? 'checked' : null, onchange: (e) => { const cur = inst.surcharges || []; inst.surcharges = e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id); onChange(true); } }), h('span', {}, s.name), s.amount ? h('em', {}, ' +' + fmt(s.amount) + ' / window') : null))),
    h('p', { class: 'fine' }, 'Add-ons are charged per window, times this line’s quantity. Promo codes do not apply.'),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Override install price ($ per window, optional)'), h('input', { type: 'text', inputmode: 'decimal', id: idp + '-override', value: inst.override ?? '', placeholder: 'leave blank to use the price above', oninput: (e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); inst.override = v === '' ? null : v; onChange(); } })));
}

function focusRoom() {
  requestAnimationFrame(() => {
    const el = document.getElementById('in-label');
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    el.scrollIntoView({ block: 'center' });
  });
}

export function render(root) {
  const brand = normalize();
  if (brand.id === 'milgard') {
    renderMilgard(root, { calc, persist, rerender: () => render(root) });
    return;
  }
  const view = captureView();
  const wrap = h('div', { class: 'page calc' });
  const tabs = h('div', { class: 'tabs seg' }, data.rates.brands.map((b) => h('button', { class: 'seg-btn' + (b.id === calc.brand ? ' on' : ''), onclick: () => { calc.brand = b.id; persist(); rerender(); } }, b.name, b.status !== 'active' && h('small', {}, ' soon'))));
  wrap.append(h('h1', {}, 'Price Calculator'), tabs);

  if (brand.status !== 'active' || !brand.series.length) {
    wrap.append(h('div', { class: 'card soon' }, h('h2', {}, `${brand.name} rates coming soon`),
      h('p', {}, `The ${brand.name} rate table hasn't been loaded yet. When Nick has the quotes, the rates drop into `, h('code', {}, 'data/rates.json'), ' and this tab turns on automatically — no code changes needed.')));
    root.replaceChildren(wrap);
    restoreView(view);
    return;
  }
  const series = brand.series.find((s) => s.id === calc.series);
  const colors = seriesColorIds(calc.brand, calc.series, calc.type);
  const integral = isIntegralType(calc);
  const args = () => ({ brand: calc.brand, series: calc.series, color: calc.color, type: calc.type, w: parseFloat(calc.w), h: parseFloat(calc.h), qty: parseInt(calc.qty) || 1, unitsPerLine: integral ? 1 : (Number(calc.unitsPerLine) || 1), options: calc.options, addons: calc.addons, supplierPrice: calc.supplierPrice, customDescription: calc.customDescription, install: calc.install });

  const roomMsg = h('p', { class: 'warn', id: 'room-required', hidden: String(calc.label || '').trim() ? true : null }, 'Enter a location (e.g. Kitchen)');
  const setRoom = (v) => { calc.label = v; persist(); update(); };
  const left = h('div', { class: 'col' });
  left.append(
    h('div', { class: 'card' }, h('h3', {}, 'Series'), h('div', { class: 'chips' }, brand.series.map((s) => h('button', { class: 'chip' + (s.id === calc.series ? ' on' : ''), onclick: () => { calc.series = s.id; persist(); rerender(); } }, s.name)))),
    h('div', { class: 'card' }, h('h3', {}, series.id === '8900' ? 'Door type' : 'Window type'), h('div', { class: 'tiles' }, [...series.types, 'custom_supplier'].map((t) => h('button', { class: 'tile' + (t === calc.type ? ' on' : ''), onclick: () => { calc.type = t; persist(); rerender(); } }, icon(t, frameKeyFor(calc.color)), h('span', {}, typeName(t)))))),
    h('div', { class: 'card' }, h('h3', {}, 'Size'),
      h('div', { class: 'room-size' },
        h('label', { class: 'field room-label' }, h('span', { class: 'lbl' }, 'Room / location'), h('input', {
          type: 'text', id: 'in-label', value: calc.label || '', placeholder: 'e.g. Kitchen',
          autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
          ...roomLabelProps(() => calc.label || '', setRoom),
        }), roomMsg),
        h('div', { class: 'grid3' }, stepper('Width', calc.w, (v) => { calc.w = v; persist(); update(); }, { unit: 'in', step: 1, id: 'in-w', pattern: '[0-9]*[.]?[0-9]*' }), stepper('Height', calc.h, (v) => { calc.h = v; persist(); update(); }, { unit: 'in', step: 1, id: 'in-h', pattern: '[0-9]*[.]?[0-9]*' }), stepper('Qty', calc.qty, (v) => { calc.qty = v; persist(); update(); }, { step: 1, min: 1, id: 'in-q' }))),
      h('p', { class: 'fine', id: 'size-limit' }, sizeLimitText(args())),
      h('p', { class: 'warn size-err', id: 'size-err', hidden: true }, ''),
      integral
        ? h('p', { class: 'fine', id: 'twin-note' }, 'This is one factory twin. Enter the overall width and height. The price is for that combined unit, not two single windows. Quantity is how many twins.')
        : stepper('Units in this line', calc.unitsPerLine, (v) => { calc.unitsPerLine = v; persist(); update(); }, { step: 1, min: 1, id: 'in-units' }),
      integral ? null : h('p', { class: 'fine' }, calc.brand === 'andersen' && (calc.type === 'vslider' || calc.type === 'casement')
        ? 'A factory mull is this many separate units, each priced at this size. A factory twin is its own type and is priced once at the overall width.'
        : 'A factory mull is this many units, each priced at this size. There is no separate mull charge.'),
      customPriceFields(calc, () => { persist(); update(); })),
    h('div', { class: 'card' }, h('h3', {}, 'Frame color'), h('div', { class: 'swatches' }, colors.map((c) => { const cd = colorById(c); return h('button', { class: 'swatch' + (c === calc.color ? ' on' : ''), onclick: () => { calc.color = c; persist(); rerender(); } }, h('i', { style: `background:${cd.swatch}` }), h('span', {}, cd.name)); }))),
    h('details', { class: 'card', open: true }, h('summary', {}, h('h3', { style: 'display:inline' }, 'Glass & upgrades')),
      upgradeEditor(calc, () => { persist(); update(); }, 'opt-'),
      calc.series === 'V400' ? h('p', { class: 'fine' }, 'Composite units: choose Custom unit and enter the supplier price.') : null),
    h('details', { class: 'card', open: true }, h('summary', {}, h('h3', { style: 'display:inline' }, 'Installation / labor')),
      installEditor(calc.install, (rerenderNeeded) => { persist(); rerenderNeeded ? rerender() : update(); }, 'calc-inst', calc)),
  );

  const priceBox = h('div', { class: 'card price', id: 'pricebox' });
  const right = h('div', { class: 'col sticky' }, priceBox, miniEstimate());
  wrap.append(h('div', { class: 'two' }, left, right));
  root.replaceChildren(wrap);
  restoreView(view);

  function update() {
    const locationOk = String(calc.label || '').trim().length > 0;
    roomMsg.hidden = locationOk;
    const p = priceWindow(args());
    const blocked = !!(p && p.blocked);
    const errEl = document.getElementById('size-err');
    if (errEl) {
      errEl.textContent = blocked ? p.errors.join(' ') : '';
      errEl.hidden = !blocked;
    }
    priceBox.replaceChildren();
    const summary = `${brand.name} ${calc.series} · ${typeName(calc.type)} · ${colorById(calc.color).name}`;
    priceBox.append(h('div', { class: 'eyebrow' }, summary));
    if (parseFloat(calc.w) > 0 && parseFloat(calc.h) > 0) priceBox.append(drawingEl(args(), 'calc-drawing', { boxW: 240, boxH: 200 }));
    const frameWarn = needsFrameWarning({ brand: calc.brand, series: calc.series, install: calc.install })
      ? h('p', { class: 'warn frame-warn', id: 'frame-warn' }, FRAME_TYPE_WARNING) : null;
    if (!p || blocked) {
      const needsPrice = calc.type === 'custom_supplier' || isCustomLine(calc);
      const sized = parseFloat(calc.w) > 0 && parseFloat(calc.h) > 0;
      const msg = blocked
        ? p.errors.join(' ')
        : (needsPrice ? 'Enter the supplier’s customer price.' : sized ? 'No fitted rate for this combination. Choose Custom unit and enter the supplier price.' : 'Enter width and height to see the price.');
      priceBox.append(
        h('div', { class: 'big muted', id: 'price-window' }, '—'),
        h('p', { class: blocked ? 'warn' : 'muted', id: 'price-block' }, msg),
        blocked ? h('p', { class: 'muted' }, 'Andersen 100 is not priced outside these limits. Some formulas start from a negative base, so a size past the limit is left blank.') : null,
        frameWarn,
        h('button', { class: 'btn primary xl', id: 'btn-add', disabled: true, title: blocked ? 'Size is outside the Andersen 100 limit' : '' }, '+ Add to estimate'));
      return;
    }
    const qty = parseInt(calc.qty) || 1, inst = installUnit(calc.install), add = addonUnit(calc.install);
    const each = p.unit + inst + add;
    const width = parseFloat(calc.w), height = parseFloat(calc.h);
    const warn = (width < 12 || height < 12 || width > 144 || height > 144);
    const doorWidth = calc.series === '8900' && width > 0 && (width < 59 || width > 192);
    const door = calc.type === 'patio_door_2p';
    const noun = door ? 'Door' : 'Window';
    priceBox.append(...[
      h('div', { class: 'big', id: 'price-window' }, fmt(p.unit)), h('div', { class: 'sub' }, p.optionsEach ? `${noun.toLowerCase()} price (materials, incl. glass) · each` : `${noun.toLowerCase()} price (materials) · each`),
      h('div', { class: 'line' }, h('span', {}, 'Installation / labor (each)'), h('b', { id: 'price-install' }, fmt(inst))),
      add ? h('div', { class: 'line' }, h('span', { id: 'price-addon-lbl' }, 'Add-ons (each) · ' + addonNames(calc.install).join(', ')), h('b', { id: 'price-addons' }, fmt(add))) : null,
      h('div', { class: 'line strong' }, h('span', {}, add ? `${noun} + install + add-ons, each` : `${noun} + install, each`), h('b', { id: 'price-each' }, fmt(each))),
      qty > 1 && h('div', { class: 'line' }, h('span', {}, `× ${qty} ${door ? 'doors' : 'windows'}`), h('b', { id: 'price-total' }, fmt(each * qty))),
      h('div', { class: 'fine' }, 'Material price. The estimate adds Installation / Labor, $150 shipping, and 9.1% sales tax on materials.'),
      door ? h('p', { class: 'fine', id: 'door-includes' }, 'Includes tempered glass and the full fiberglass screen. Labor stays on its own line.') : null,
      frameWarn,
      warn && calc.brand !== 'andersen' && calc.series !== '8900' && h('p', { class: 'warn' }, 'Check the size — it is outside the usual range (12"–144").'),
      doorWidth && h('p', { class: 'warn' }, '8900 doors are quoted for widths of about 59"–192".'),
      h('button', { class: 'link', onclick: () => { calc.details = !calc.details; persist(); update(); } }, calc.details ? 'Hide math' : 'Show math'),
      calc.details && h('div', { class: 'math' }, mathText(p, calc.w, calc.h), ` · install: ${installLabel(calc.install)} = ${fmt(inst)}`, add ? ` · add-ons ${fmt(add)}` : ''),
      h('button', { class: 'btn primary xl', id: 'btn-add', disabled: locationOk ? null : true, title: locationOk ? '' : 'Enter a location (e.g. Kitchen)', onclick: addToEstimate }, '+ Add to estimate'),
      h('p', { class: 'fine' }, p.mode === 'custom'
        ? 'Supplier price is the material price. Installation is separate and rolls into the estimate’s Installation / Labor line. Promo codes do not discount this line.'
        : 'Window price includes glass upcharges. Installation and add-ons stay off this price and roll into the estimate’s Installation / Labor line.')].filter(Boolean));
  }
  function addToEstimate() {
    const location = String(calc.label || '').trim();
    const a = args(); const p = priceWindow(a);
    if (!location || !p || p.blocked || p.unit == null) return;
    const e = estimates.current();
    e.lines.push({ id: uid(), label: location, brand: calc.brand, series: calc.series, type: calc.type, color: calc.color, w: a.w || 0, h: a.h || 0, qty: a.qty, unitsPerLine: a.unitsPerLine, options: [...(calc.options || [])], addons: [...(calc.addons || [])], supplierPrice: calc.type === 'custom_supplier' || isCustomLine(calc) ? calc.supplierPrice : null, customDescription: calc.customDescription || '', unitBase: p.unitBase, optionsEach: p.optionsEach, unit: p.unit, rate: p.rate, rateSet: settings.rateSet, estimated: p.estimated, pricingMode: p.mode,
      install: JSON.parse(JSON.stringify(calc.install)), installUnit: installUnit(calc.install) });
    estimates.persist(); persist(); toast(`Added to ${e.number}`); rerender(); focusRoom();
  }
  function miniEstimate() {
    const e = estimates.current(); const t = totals(e);
    return h('div', { class: 'card mini' }, h('div', { class: 'row between' }, h('b', {}, 'Current estimate'), h('span', { class: 'muted' }, e.number)),
      e.lines.length ? h('div', {}, ...quoteTotalRows(t).map((row) => h('div', { class: 'line' + (row.strong ? ' strong' : '') + (row.discount ? ' discount' : '') }, h('span', {}, row.label), h('b', {}, fmt(row.amount)))), h('div', { class: 'line strong' }, h('span', {}, 'Total'), h('b', {}, fmt(t.total))), h('a', { class: 'btn', href: '#/estimate', id: 'btn-open-est' }, 'Open estimate →')) : h('p', { class: 'muted' }, 'No windows added yet.'));
  }
  const rerender = () => render(root);
  update();
}
