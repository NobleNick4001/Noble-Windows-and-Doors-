import { h, fmt, data, settings, estimates, toast, uid, totals, priceWindow, installUnit, quoteTotalRows, captureView, restoreView, linePriceText, rowAmountText, compactWindowLine } from '../core.js';
import { prlQuote, prlLimits, prlQuoteMessage, PRL_QUOTE_LABEL } from '../prl.js';
import { drawingEl } from '../drawings.js';
import { icon } from '../icons.js';
import { roomLabelProps } from './milgard-ui.js';

const decimal = (raw) => {
  const cleaned = String(raw ?? '').replace(/[^0-9.]/g, '');
  const i = cleaned.indexOf('.');
  return i < 0 ? cleaned : cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, '');
};

function cleanPrlChoices(p) {
  const bifold = p.product === 'bifold';
  const panels = Number(p.panels);
  // 6+ panels, other finishes, pocket, corners, bifold screens, thermal
  // bifolds, and Energy Advantage on a bifold have no price. See held-configs.js.
  return {
    product: bifold ? 'bifold' : 'multislide',
    panels: panels === 4 || panels === 5 ? panels : 3,
    thermal: !bifold && !!p.thermal,
    nailOn: !bifold && !!p.nailOn,
    glass: !bifold && p.glass === 'ea' ? 'ea' : 'sb70',
    rolling: bifold && p.rolling === 'bottom' ? 'bottom' : 'top',
    finish: 'bronze',
    layout: 'standard',
    screen: false,
    bifoldThermal: false,
  };
}

export function prlChoices(calc) {
  const p = calc?.prl && typeof calc.prl === 'object' ? calc.prl : {};
  return cleanPrlChoices(p);
}

export function prlLineFrom(calc) {
  const s = prlChoices(calc);
  const bifold = s.product === 'bifold';
  return {
    brand: 'prl',
    series: bifold ? 'bifold' : 'max',
    type: s.product,
    panels: s.panels,
    color: 'bronze-anodized',
    w: parseFloat(calc.w),
    h: parseFloat(calc.h),
    qty: Math.max(1, parseInt(calc.qty, 10) || 1),
    unitsPerLine: 1,
    options: [],
    addons: [],
    thermal: !bifold && s.thermal,
    nailOn: !bifold && s.nailOn,
    glass: s.glass,
    rolling: bifold ? s.rolling : 'bottom',
    finish: s.finish,
    layout: s.layout,
    screen: bifold && s.screen,
    bifoldThermal: bifold && s.bifoldThermal,
    install: { type: 'prl', surcharges: [], headerFeet: '', writeIn: null, override: null, custom: null, frameType: null },
  };
}

function choicesFromLine(line) {
  const bifold = line?.type === 'bifold' || line?.series === 'bifold';
  return cleanPrlChoices({
    product: bifold ? 'bifold' : 'multislide',
    panels: line?.panels,
    thermal: line?.thermal,
    nailOn: line?.nailOn,
    glass: line?.glass,
    rolling: line?.rolling,
  });
}

function applyChoices(target, s) {
  const bifold = s.product === 'bifold';
  target.series = bifold ? 'bifold' : 'max';
  target.type = s.product;
  target.panels = s.panels;
  target.color = 'bronze-anodized';
  target.thermal = !bifold && s.thermal;
  target.nailOn = !bifold && s.nailOn;
  target.glass = s.glass;
  target.rolling = bifold ? s.rolling : 'bottom';
  target.finish = s.finish;
  target.layout = s.layout;
  target.screen = bifold && s.screen;
  target.bifoldThermal = bifold && s.bifoldThermal;
  target.unitsPerLine = 1;
}

function box(id, label, on, hold, onclick) {
  return h('button', {
    type: 'button',
    id,
    class: 'labor-box' + (on ? ' on' : '') + (hold ? ' hold' : ''),
    onclick,
  }, label, hold ? h('small', {}, PRL_QUOTE_LABEL) : null);
}

export function prlOptionEditor(state, onPick, idp = 'prl-') {
  const bifold = state.product === 'bifold';
  const set = (patch) => onPick({ ...state, ...patch });
  const panels = [3, 4, 5].map((n) => box(idp + 'panels-' + n, String(n), state.panels === n, false, () => set({ panels: n })));
  const root = h('div', { id: idp + 'options' },
    h('div', { class: 'lbl' }, 'Product'),
    h('div', { class: 'labor-boxes', id: idp + 'product' },
      box(idp + 'product-multislide', 'Multi-slide', !bifold, false, () => set({ product: 'multislide' })),
      box(idp + 'product-bifold', 'Bifold', bifold, false, () => set({ product: 'bifold' }))),
    h('div', { class: 'lbl' }, 'Panels'),
    h('div', { class: 'labor-boxes', id: idp + 'panels' }, panels),
    h('p', { class: 'fine' }, 'Bronze anodized, straight run. Other finishes, pockets, and corners are not priced yet.'));
  if (bifold) {
    root.append(
      h('div', { class: 'lbl' }, 'Bifold'),
      h('div', { class: 'labor-boxes', id: idp + 'rolling' },
        box(idp + 'rolling-top', 'Top-hung', state.rolling !== 'bottom', false, () => set({ rolling: 'top' })),
        box(idp + 'rolling-bottom', 'Bottom-rolling', state.rolling === 'bottom', false, () => set({ rolling: 'bottom' }))),
      h('div', { class: 'lbl' }, 'Glass'),
      h('div', { class: 'labor-boxes', id: idp + 'glass' },
        box(idp + 'glass-sb70', 'Solarban 70', true, false, () => set({ glass: 'sb70' }))));
  } else {
    root.append(
      h('div', { class: 'lbl' }, 'Multi-slide'),
      h('div', { class: 'labor-boxes', id: idp + 'thermal' },
        box(idp + 'thermal-off', 'Standard', !state.thermal, false, () => set({ thermal: false })),
        box(idp + 'thermal-on', 'Max Thermal', state.thermal, false, () => set({ thermal: true })),
        box(idp + 'nailon', 'Nail-on screen', state.nailOn, false, () => set({ nailOn: !state.nailOn }))),
      h('div', { class: 'lbl' }, 'Glass'),
      h('div', { class: 'labor-boxes', id: idp + 'glass' },
        box(idp + 'glass-sb70', 'Solarban 70', state.glass !== 'ea', false, () => set({ glass: 'sb70' })),
        box(idp + 'glass-ea', 'Energy Advantage', state.glass === 'ea', false, () => set({ glass: 'ea' }))));
  }
  return root;
}

export function prlLineEditor(line, onChange, idp = 'prl-') {
  const state = choicesFromLine(line);
  return h('div', {},
    prlOptionEditor(state, (next) => { applyChoices(line, next); onChange(); }, idp),
    h('p', { class: 'fine', id: idp + 'limits' }, prlLimits(data.prl, line)?.text || ''));
}

function quoteText(l) {
  return compactWindowLine(l).title;
}

export function renderPrl(root, { calc, persist, rerender }) {
  const view = captureView();
  calc.prl = prlChoices(calc);
  if (!calc.install) calc.install = { type: 'prl', surcharges: [] };
  const wrap = h('div', { class: 'page calc calc-milgard' });
  wrap.append(h('h1', {}, 'Price Calculator'));
  wrap.append(h('div', { class: 'tabs seg' }, ...data.rates.brands.map((b) => h('button', {
    type: 'button', class: 'seg-btn' + (b.id === 'prl' ? ' on' : ''),
    onclick: () => { calc.brand = b.id; persist(); rerender(); },
  }, b.name, b.status !== 'active' && h('small', {}, ' soon'))), h('button', {
    type: 'button', class: 'seg-btn', id: 'tab-prehung', onclick: () => { location.hash = '#/doors'; },
  }, 'Prehung Doors')));

  const priceEl = h('div', { class: 'big', id: 'price-window' }, '—');
  const unitEl = h('div', { class: 'sub', id: 'price-unit' }, 'this door');
  const notesEl = h('div', { id: 'price-notes' });
  const warnEl = h('p', { class: 'warn size-err', id: 'prl-warn', hidden: true });
  const wHint = h('div', { class: 'fine', id: 'size-w-hint' });
  const hHint = h('div', { class: 'fine', id: 'size-h-hint' });
  const addBtn = h('button', { type: 'button', class: 'btn primary xl', id: 'btn-add' }, icon('plus'), 'Add');
  const quoteEl = h('div', { id: 'quote-body' });
  const installEl = h('div', { class: 'labor-box on', id: 'prl-install' }, 'Installation', h('small', {}, ''));

  const roomMsg = h('p', { class: 'warn', id: 'room-required', hidden: String(calc.label || '').trim() ? true : null }, 'Enter a location (e.g. Family room)');
  const setRoom = (v) => { calc.label = v; persist(); update(); };
  const onSize = (key) => (e) => {
    const cleaned = decimal(e.target.value);
    if (e.target.value !== cleaned) e.target.value = cleaned;
    calc[key] = cleaned;
    persist();
    update();
  };
  const sizeAttrs = { type: 'text', inputmode: 'decimal', pattern: '[0-9]*', enterkeyhint: 'next', placeholder: '0', autocomplete: 'off' };

  const left = h('div', { class: 'card' });
  left.append(h('h3', {}, '1 · Product'));
  left.append(h('p', { class: 'fine' }, 'Opening size, in inches. Bronze anodized is the priced finish.'));
  left.append(prlOptionEditor(calc.prl, (next) => { calc.prl = next; persist(); rerender(); }));
  left.append(h('div', { class: 'room-size' },
    h('label', { class: 'field room-label' }, h('span', { class: 'lbl' }, 'Room / location'), h('input', {
      type: 'text', id: 'in-label', value: calc.label || '', placeholder: 'e.g. Family room',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
      ...roomLabelProps(() => calc.label || '', setRoom),
    }), roomMsg),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Width (in)'), h('input', { ...sizeAttrs, id: 'in-w', value: calc.w ?? '', oninput: onSize('w') }), wHint),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Height (in)'), h('input', { ...sizeAttrs, id: 'in-h', value: calc.h ?? '', oninput: onSize('h') }), hHint))));
  left.append(warnEl);
  left.append(h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Qty'), h('input', {
    type: 'text', inputmode: 'numeric', pattern: '[0-9]*', id: 'in-q', value: calc.qty || 1,
    oninput: (e) => { calc.qty = e.target.value.replace(/[^0-9]/g, ''); persist(); update(); },
  })));
  left.append(h('h3', {}, 'Installation'));
  left.append(h('div', { class: 'labor-boxes' }, installEl));

  const drawHost = h('div', { id: 'calc-drawing' });
  const right = h('div', { class: 'col sticky' },
    h('div', { class: 'card price price-dock' }, h('h3', {}, '2 · Price'), drawHost, priceEl, unitEl, notesEl, addBtn),
    h('div', { class: 'card' }, h('h3', {}, '3 · Quote'), quoteEl));
  wrap.append(h('div', { class: 'two' }, left, right));
  root.replaceChildren(wrap);
  addBtn.onclick = () => addLine();
  update();
  restoreView(view);

  function update() {
    const line = prlLineFrom(calc);
    const q = prlQuote(data.prl, line);
    const limits = q.limits;
    wHint.textContent = limits?.hintW || '';
    hHint.textContent = limits?.hintH || '';
    const sized = line.w > 0 && line.h > 0;
    const blocked = !!(q.quoteRequired || (sized && q.errors.length));
    const messages = [];
    if (q.quoteRequired) messages.push(prlQuoteMessage(q));
    if (sized && q.errors.length) messages.push(q.errors.join(' '));
    warnEl.hidden = !messages.length;
    warnEl.textContent = messages.join(' ');
    const locationOk = String(calc.label || '').trim().length > 0;
    roomMsg.hidden = locationOk;
    const priced = sized && !blocked && q.cost != null;
    addBtn.disabled = !priced || !locationOk;
    addBtn.title = !locationOk ? 'Enter a location (e.g. Family room)' : (blocked ? (q.quoteRequired ? PRL_QUOTE_LABEL : 'Outside the quoted range') : '');
    const qty = line.qty;
    priceEl.classList.remove('pending');
    const p = priced ? priceWindow(line) : null;
    if (q.quoteRequired) {
      priceEl.textContent = PRL_QUOTE_LABEL;
      priceEl.classList.add('pending');
      unitEl.textContent = 'not priced';
    } else if (!priced) {
      priceEl.textContent = '—';
      unitEl.textContent = sized ? 'Outside the quoted range' : 'Enter width and height';
    } else {
      priceEl.textContent = fmt(p.unit * qty);
      unitEl.textContent = qty > 1 ? `${qty} × ${fmt(p.unit)}` : 'this door';
    }
    const showInstall = line.panels >= 3 && line.panels <= 5 && !q.quoteRequired && !q.errors.length;
    installEl.textContent = showInstall ? 'Installation' : 'Installation not quoted';
    const noteNodes = (priced ? q.notes : []).map((n) => h('p', { class: 'fine', id: 'prl-note' }, n));
    notesEl.replaceChildren(...noteNodes);
    drawHost.replaceChildren(...(sized ? [drawingEl(line, 'calc-drawing', { boxW: 240, boxH: 200 })] : []));
    drawQuote();
  }

  function drawQuote() {
    const e = estimates.current();
    const t = totals(e);
    quoteEl.replaceChildren();
    if (!e.lines.length) {
      quoteEl.append(h('p', { class: 'muted' }, 'No lines yet'));
      return;
    }
    e.lines.forEach((l, i) => {
      quoteEl.append(h('div', { class: 'line qdraw' },
        drawingEl(l, 'qdraw-art', { boxW: 108, boxH: 92 }),
        h('span', { class: 'qdraw-txt' }, quoteText(l)),
        h('span', { class: 'row nowrap' }, h('b', { class: l.quoteRequired || l.unpriced ? 'pending-price' : '' }, linePriceText(l)),
          h('button', { type: 'button', class: 'x', 'aria-label': 'Remove line', onclick: () => { e.lines.splice(i, 1); estimates.persist(); update(); } }, icon('x')))));
    });
    for (const row of quoteTotalRows(t)) {
      quoteEl.append(h('div', {
        class: 'line' + (row.strong ? ' strong' : '') + (row.discount ? ' discount' : ''),
        id: row.id === 'install' ? 'quote-install' : row.id === 'tax' ? 'quote-tax' : row.id === 'shipping' ? 'quote-shipping' : null,
      }, h('span', {}, row.label), h('b', { id: row.id === 'install' ? 'quote-install-amt' : null }, rowAmountText(row))));
    }
    quoteEl.append(h('div', { class: 'line strong' }, h('span', {}, 'Total'), h('b', { id: 'quote-total' }, fmt(t.total))));
    quoteEl.append(h('a', { class: 'btn', href: '#/estimate', id: 'btn-open-est' }, 'Open estimate'));
  }

  function addLine() {
    const location = String(calc.label || '').trim();
    const line = prlLineFrom(calc);
    const q = prlQuote(data.prl, line);
    if (!location || q.quoteRequired || q.errors.length || !(line.w > 0) || !(line.h > 0)) return;
    const p = priceWindow(line);
    if (!p || p.blocked || p.unit == null) return;
    const e = estimates.current();
    e.lines.push({
      id: uid(), label: location,
      brand: 'prl', series: line.series, type: line.type, panels: line.panels, color: line.color,
      w: line.w, h: line.h, qty: line.qty, unitsPerLine: 1,
      options: [], addons: [],
      thermal: line.thermal, nailOn: line.nailOn, glass: line.glass, rolling: line.rolling,
      finish: line.finish, layout: line.layout, screen: line.screen, bifoldThermal: line.bifoldThermal,
      supplierPrice: null, customDescription: '',
      unitBase: p.unit, optionsEach: 0, unit: p.unit, rate: null, rateSet: settings.rateSet,
      estimated: false, pricingMode: 'prl', pricePending: false, provisional: false,
      unavailable: false, quoteRequired: false, unpriced: false,
      install: line.install, installUnit: installUnit(line.install, line),
    });
    estimates.persist();
    calc.w = '';
    calc.h = '';
    persist();
    toast(`${location} added · ${fmt(p.unit * line.qty)}`);
    rerender();
  }
}
