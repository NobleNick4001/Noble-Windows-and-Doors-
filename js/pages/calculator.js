import { h, fmt, data, settings, brandById, typeName, colorById, priceWindow, installUnit, addonUnit, addonNames, installLabel, installType, defaultInstall, estimates, toast, store, uid, totals, summaryLines } from '../core.js';
import { frameSVG } from '../frames.js';

const calc = Object.assign({ brand: 'milgard', series: 'V250', type: 'hslider', color: 'ww', w: '', h: '', qty: 1, label: '', options: null, details: false, install: null }, store.get('nwd.calc', {}));
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
  if (!b.series.length) return b;
  let s = b.series.find((x) => x.id === calc.series); if (!s) { s = b.series[0]; calc.series = s.id; }
  if (!s.types.includes(calc.type)) calc.type = s.types[0];
  if (!s.colors.includes(calc.color)) calc.color = s.colors[0];
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

export function stepper(label, value, onChange, { step = 1, min = 0, unit = '', id } = {}) {
  const input = h('input', { type: 'text', inputmode: 'decimal', id, value: value ?? '', placeholder: '0', 'aria-label': label,
    oninput: (e) => onChange(e.target.value.replace(/[^0-9.]/g, '')) });
  const bump = (d) => { const v = Math.max(min, (parseFloat(input.value) || 0) + d); input.value = Math.round(v * 100) / 100; onChange(String(input.value)); };
  return h('label', { class: 'field stepper' }, h('span', { class: 'lbl' }, label, unit && h('em', {}, ' ' + unit)),
    h('div', { class: 'row nowrap' }, h('button', { type: 'button', class: 'btn sq', onclick: () => bump(-step) }, '−'), input, h('button', { type: 'button', class: 'btn sq', onclick: () => bump(step) }, '+')));
}

// Reusable install editor (calculator + estimate line editing). inst is mutated; onChange called after.
export function installEditor(inst, onChange, idp = 'inst') {
  const t = installType(inst.type);
  const frames = data.frameTypes?.types || [];
  const priceLabel = (x) => x.custom ? x.name : `${x.name} — ${fmt(x.price)}${x.placeholder ? ' (placeholder)' : ''}`;
  return h('div', { class: 'install-ed' },
    frames.length ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Frame type'),
      h('select', { id: idp + '-frame', onchange: (e) => {
        const id = e.target.value;
        inst.frameType = id || null;
        const ft = frames.find((f) => f.id === id);
        if (ft?.installType) inst.type = ft.installType;
        onChange(true);
      } }, h('option', { value: '', selected: !inst.frameType ? 'selected' : null }, 'Not set'), frames.map((f) => h('option', { value: f.id, selected: f.id === inst.frameType ? 'selected' : null }, f.name)))) : null,
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

export function render(root) {
  const brand = normalize();
  const wrap = h('div', { class: 'page calc' });
  const tabs = h('div', { class: 'tabs seg' }, data.rates.brands.map((b) => h('button', { class: 'seg-btn' + (b.id === calc.brand ? ' on' : ''), onclick: () => { calc.brand = b.id; persist(); rerender(); } }, b.name, b.status !== 'active' && h('small', {}, ' soon'))));
  wrap.append(h('h1', {}, 'Price Calculator'), tabs);

  if (brand.status !== 'active' || !brand.series.length) {
    wrap.append(h('div', { class: 'card soon' }, h('h2', {}, `${brand.name} rates coming soon`),
      h('p', {}, `The ${brand.name} rate table hasn't been loaded yet. When Nick has the quotes, the rates drop into `, h('code', {}, 'data/rates.json'), ' and this tab turns on automatically — no code changes needed.')));
    root.replaceChildren(wrap); return;
  }
  const series = brand.series.find((s) => s.id === calc.series);
  const args = () => ({ brand: calc.brand, series: calc.series, color: calc.color, type: calc.type, w: parseFloat(calc.w), h: parseFloat(calc.h), qty: parseInt(calc.qty) || 1, options: calc.options });

  const left = h('div', { class: 'col' });
  left.append(
    h('div', { class: 'card' }, h('h3', {}, 'Series'), h('div', { class: 'chips' }, brand.series.map((s) => h('button', { class: 'chip' + (s.id === calc.series ? ' on' : ''), onclick: () => { calc.series = s.id; persist(); rerender(); } }, s.name)))),
    h('div', { class: 'card' }, h('h3', {}, 'Window type'), h('div', { class: 'tiles' }, series.types.map((t) => h('button', { class: 'tile' + (t === calc.type ? ' on' : ''), onclick: () => { calc.type = t; persist(); rerender(); } }, icon(t, frameKeyFor(calc.color)), h('span', {}, typeName(t)))))),
    h('div', { class: 'card' }, h('h3', {}, 'Frame color'), h('div', { class: 'swatches' }, series.colors.map((c) => { const cd = colorById(c); return h('button', { class: 'swatch' + (c === calc.color ? ' on' : ''), onclick: () => { calc.color = c; persist(); rerender(); } }, h('i', { style: `background:${cd.swatch}` }), h('span', {}, cd.name)); }))),
    h('div', { class: 'card' }, h('h3', {}, 'Size'),
      h('div', { class: 'grid3' }, stepper('Width', calc.w, (v) => { calc.w = v; persist(); update(); }, { unit: 'in', step: 1, id: 'in-w' }), stepper('Height', calc.h, (v) => { calc.h = v; persist(); update(); }, { unit: 'in', step: 1, id: 'in-h' }), stepper('Qty', calc.qty, (v) => { calc.qty = v; persist(); update(); }, { step: 1, min: 1, id: 'in-q' })),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Room / label (optional)'), h('input', { type: 'text', id: 'in-label', value: calc.label, placeholder: 'e.g. Master bedroom, Kitchen sink', oninput: (e) => { calc.label = e.target.value; persist(); } }))),
    optionsCard(),
    h('details', { class: 'card', open: true }, h('summary', {}, h('h3', { style: 'display:inline' }, 'Installation / labor')),
      installEditor(calc.install, (rerenderNeeded) => { persist(); rerenderNeeded ? rerender() : update(); }, 'calc-inst')),
  );

  const priceBox = h('div', { class: 'card price', id: 'pricebox' });
  const right = h('div', { class: 'col sticky' }, priceBox, miniEstimate());
  wrap.append(h('div', { class: 'two' }, left, right));
  root.replaceChildren(wrap);

  function optionsCard() {
    const mk = (o) => h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'opt-' + o.id, checked: calc.options.includes(o.id) ? 'checked' : null, onchange: (e) => { calc.options = e.target.checked ? [...calc.options, o.id] : calc.options.filter((x) => x !== o.id); if (o.id === 'obscure' && !e.target.checked) calc.options = calc.options.filter((id) => !obscureIds().has(id)); persist(); update(); } }), h('span', {}, o.name), o.price.type !== 'included' && o.price.amount ? h('em', {}, ' +' + (o.price.type === 'percent' ? o.price.amount + '%' : fmt(o.price.amount))) : null);
    return h('details', { class: 'card', open: true }, h('summary', {}, h('h3', { style: 'display:inline' }, 'Glass & frame options')),
      h('div', { class: 'cols2' }, h('div', {}, h('b', {}, 'Glass'), data.options.glass.map(mk)), h('div', {}, h('b', {}, 'Frame / extras'), data.options.frame.map(mk))));
  }

  function update() {
    const p = priceWindow(args());
    priceBox.replaceChildren();
    const summary = `${brand.name} ${calc.series} · ${typeName(calc.type)} · ${colorById(calc.color).name}`;
    priceBox.append(h('div', { class: 'eyebrow' }, summary));
    if (!p) { priceBox.append(h('div', { class: 'big muted' }, '—'), h('p', { class: 'muted' }, 'Enter width and height to see the price.')); return; }
    const qty = parseInt(calc.qty) || 1, inst = installUnit(calc.install), add = addonUnit(calc.install);
    const each = p.unit + inst + add;
    const warn = (parseFloat(calc.w) < 12 || parseFloat(calc.h) < 12 || parseFloat(calc.w) > 144 || parseFloat(calc.h) > 144);
    priceBox.append(...[
      h('div', { class: 'big', id: 'price-window' }, fmt(p.unit)), h('div', { class: 'sub' }, p.optionsEach ? 'window price (materials, incl. glass) · each' : 'window price (materials) · each'),
      h('div', { class: 'line' }, h('span', {}, 'Installation / labor (each)'), h('b', { id: 'price-install' }, fmt(inst))),
      add ? h('div', { class: 'line' }, h('span', { id: 'price-addon-lbl' }, 'Add-ons (each) · ' + addonNames(calc.install).join(', ')), h('b', { id: 'price-addons' }, fmt(add))) : null,
      h('div', { class: 'line strong' }, h('span', {}, add ? 'Window + install + add-ons, each' : 'Window + install, each'), h('b', { id: 'price-each' }, fmt(each))),
      qty > 1 && h('div', { class: 'line' }, h('span', {}, `× ${qty} windows`), h('b', { id: 'price-total' }, fmt(each * qty))),
      h('div', { class: 'fine' }, 'Before tax'),
      warn && h('p', { class: 'warn' }, 'Check the size — it is outside the usual range (12"–144").'),
      h('button', { class: 'link', onclick: () => { calc.details = !calc.details; persist(); update(); } }, calc.details ? 'Hide math' : 'Show math'),
      calc.details && h('div', { class: 'math' }, `(${calc.w} + ${calc.h}) = ${p.wh}" × $${p.rate.toFixed(4)}/in = ${fmt(p.unitBase)}`, p.optionsEach ? ` + glass ${fmt(p.optionsEach)}` : '', ` · install: ${installLabel(calc.install)} = ${fmt(inst)}`, add ? ` · add-ons ${fmt(add)}` : ''),
      h('button', { class: 'btn primary xl', id: 'btn-add', onclick: addToEstimate }, '+ Add to estimate'),
      h('p', { class: 'fine' }, 'Window price includes glass upcharges. Installation and add-ons are separate. Sales tax not included.')].filter(Boolean));
  }
  function addToEstimate() {
    const a = args(); const p = priceWindow(a);
    if (!p) return;
    const e = estimates.current();
    e.lines.push({ id: uid(), label: calc.label || `Window ${e.lines.length + 1}`, brand: calc.brand, series: calc.series, type: calc.type, color: calc.color, w: a.w, h: a.h, qty: a.qty, options: [...calc.options], unitBase: p.unitBase, optionsEach: p.optionsEach, unit: p.unit, rate: p.rate, rateSet: settings.rateSet, estimated: p.estimated,
      install: JSON.parse(JSON.stringify(calc.install)), installUnit: installUnit(calc.install) });
    estimates.persist(); calc.label = ''; persist(); toast(`Added to ${e.number}`); rerender();
  }
  function miniEstimate() {
    const e = estimates.current(); const t = totals(e);
    return h('div', { class: 'card mini' }, h('div', { class: 'row between' }, h('b', {}, 'Current estimate'), h('span', { class: 'muted' }, e.number)),
      e.lines.length ? h('div', {}, ...summaryLines(t).map((row) => h('div', { class: 'line' + (row.discount ? ' discount' : '') }, h('span', {}, row.id === 'windows' ? `${t.count} window${t.count === 1 ? '' : 's'} · windows` : row.label), h('b', {}, fmt(row.amount)))), h('div', { class: 'line strong' }, h('span', {}, 'Subtotal (before tax)'), h('b', {}, fmt(t.subtotal))), h('a', { class: 'btn', href: '#/estimate', id: 'btn-open-est' }, 'Open estimate →')) : h('p', { class: 'muted' }, 'No windows added yet.'));
  }
  const rerender = () => render(root);
  update();
}
