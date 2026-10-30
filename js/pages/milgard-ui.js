import { h, fmt, data, settings, estimates, toast, uid, totals, priceWindow, installUnit, addonUnit, installLabel, addonNames, defaultInstall, typeName, colorById, quoteTotalRows, captureView, restoreView, linePriceText, PRICE_PENDING_LABEL } from '../core.js';
import { isMilgardDoorLine, milgardQuote, DOOR_CONFIG, doorColorChoices, doorColorLabel, A250_WINDOW_COLORS, A250_WINDOW_STYLES, a250GlassOptions, styleLimits } from '../milgard.js';
import { drawingEl } from '../drawings.js';
import { icon } from '../icons.js';

const WINDOW_SERIES = [['V250', 'V250'], ['V300', 'V300'], ['V400', 'V400'], ['A250', 'A250 aluminum']];
const DOOR_SERIES = [['V300', 'V300'], ['V400', 'V400'], ['A250', 'A250 aluminum']];
const STYLES = {
  window: [['hslider', 'XO'], ['xox', 'XOX'], ['vslider', 'Single hung'], ['dshung', 'Double Single Hung'], ['picture', 'Picture'], ['casement', 'Casement'], ['dcasement', 'Double casement'], ['awning', 'Awning'], ['arch_xo', 'Arch / eyebrow XO'], ['arch_xox', 'Arch / eyebrow XOX'], ['arch_sh', 'Arch single hung'], ['arch_hr', 'Half-round single hung']],
  door: [['2panel', '2-panel XO'], ['3panel', '3-panel'], ['4panel', '4-panel OXXO']],
};
const COLORS = [['ww', 'White'], ['adobe', 'Adobe'], ['bronze', 'Bronze'], ['bw', 'Black ext'], ['bb', 'Black/Black']];
const GRIDS = [['none', 'None'], ['flat', 'Flat'], ['sculptured', 'Sculptured'], ['perimeter', 'Perimeter']];
const OBSCURE = [['none', 'Clear'], ['p516', 'P516'], ['satin', 'Satin Etch']];
const FRAMES = [['zbar', 'Z-bar'], ['nailfin', 'Nail fin'], ['block', 'Block']];
const FRAME_LABOR = { zbar: 'standard', nailfin: 'stucco-fin', block: 'block' };
const A250_NOTE = 'A250 aluminum: Clear Anodized and Bronze Anodized are the same price. Priced per inch of width + height from Milgard A250 quotes. No grids or PureView.';
// Window styles and colors for a series (A250 windows have their own short lists).
const windowStyles = (series) => series === 'A250' ? STYLES.window.filter(([id]) => A250_WINDOW_STYLES.includes(id)) : STYLES.window;
const windowColors = (series) => series === 'A250' ? A250_WINDOW_COLORS : COLORS;
const stylesFor = (calc) => calc.product === 'door' ? STYLES.door : windowStyles(calc.series);
// Clear upgrades an A250 window style has no price for.
function trimA250(obj) {
  if (obj.series !== 'A250' || DOOR_CONFIG[obj.type]) return;
  const g = a250GlassOptions(data.milgardOnelink, obj.type);
  obj.grids = 'none';
  obj.pureview = false;
  if (!g.obscure) obj.obscure = 'none';
  if (!g.tempered && !g.obscure) obj.tempered = false;
}

const decimal = (raw) => {
  const cleaned = String(raw ?? '').replace(/[^0-9.]/g, '');
  const i = cleaned.indexOf('.');
  return i < 0 ? cleaned : cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, '');
};

function ensure(calc) {
  if (calc.product !== 'window' && calc.product !== 'door') calc.product = DOOR_CONFIG[calc.type] ? 'door' : 'window';
  if (!calc.grids) calc.grids = 'none';
  if (!calc.obscure) calc.obscure = 'none';
  if (!calc.frame) calc.frame = 'zbar';
  if (!calc.install) calc.install = defaultInstall();
  if (!Array.isArray(calc.install.surcharges)) calc.install.surcharges = [];
  if (!Array.isArray(calc.doorAddons)) calc.doorAddons = [];
  if (calc.headerFeet == null) calc.headerFeet = '';
  if (calc.writeInDesc == null) calc.writeInDesc = '';
  if (calc.writeInAmt == null) calc.writeInAmt = '';
  const series = (calc.product === 'door' ? DOOR_SERIES : WINDOW_SERIES).map((x) => x[0]);
  if (!series.includes(calc.series)) calc.series = series[0];
  const styles = stylesFor(calc).map((x) => x[0]);
  if (!styles.includes(calc.type)) calc.type = styles[0];
  if (calc.product === 'door') {
    const choices = doorColorChoices(calc.series);
    if (!choices.some((c) => c[0] === calc.color)) calc.color = choices[0][0];
  } else {
    const choices = windowColors(calc.series);
    if (!choices.some((c) => c[0] === calc.color)) calc.color = choices[0][0];
    trimA250(calc);
  }
  if (calc.product === 'window' && calc.install.type !== 'custom') {
    calc.install.type = FRAME_LABOR[calc.frame] || 'standard';
    calc.install.frameType = calc.frame;
  }
  if (calc.type === 'arch_xo' || calc.type === 'arch_xox') {
    if (calc.shape !== 'eyebrow') calc.shape = 'arch';
  }
}

export function installFromCalc(calc) {
  if (calc.product === 'door') {
    return {
      type: 'door', surcharges: [...calc.doorAddons], headerFeet: calc.headerFeet,
      writeIn: { description: calc.writeInDesc || '', amount: calc.writeInAmt || '' },
      override: null, custom: null, frameType: null,
    };
  }
  return {
    type: calc.install?.type || 'standard',
    surcharges: [...(calc.install?.surcharges || [])],
    override: calc.install?.override ?? null,
    custom: calc.install?.custom ?? null,
    frameType: calc.install?.type === 'custom' ? (calc.frame || null) : (calc.frame || 'zbar'),
    headerFeet: '', writeIn: null,
  };
}

function draftLine(calc) {
  const door = calc.product === 'door';
  return {
    brand: 'milgard', series: calc.series, type: calc.type, color: door ? (calc.color || 'ww') : calc.color,
    w: parseFloat(calc.w), h: parseFloat(calc.h), qty: Math.max(1, parseInt(calc.qty, 10) || 1),
    unitsPerLine: 1, grids: door ? 'none' : calc.grids, obscure: door ? 'none' : calc.obscure,
    tempered: door ? false : !!calc.tempered, pureview: !!calc.pureview,
    frame: door ? '' : calc.frame, install: installFromCalc(calc),
    shape: (!door && (calc.type === 'arch_xo' || calc.type === 'arch_xox') && calc.shape === 'eyebrow') ? 'eyebrow' : '',
  };
}

function optionIds(calc) {
  if (calc.product === 'door') return calc.pureview ? ['pureview'] : [];
  const ids = [];
  if (calc.tempered) ids.push('tempered');
  if (calc.obscure === 'p516') ids.push('obscure', 'milgard-p516');
  if (calc.obscure === 'satin') ids.push('obscure', 'milgard-satin');
  if (calc.grids === 'flat') ids.push('grids-colonial');
  if (calc.pureview) ids.push('pureview');
  return ids;
}
function addonIds(calc) {
  if (calc.product === 'door') return calc.pureview ? ['pureview'] : [];
  const ids = [];
  if (calc.tempered) ids.push('tempered');
  if (calc.obscure && calc.obscure !== 'none') ids.push('obscure');
  if (calc.grids === 'flat') ids.push('grids');
  if (calc.pureview) ids.push('pureview');
  return ids;
}

function seg(label, items, current, onPick) {
  return h('div', {},
    h('div', { class: 'lbl' }, label),
    h('div', { class: 'chips' }, items.map(([id, name]) => h('button', {
      type: 'button', class: 'chip pick' + (id === current ? ' on' : ''), id: 'pick-' + label.toLowerCase().replace(/\s+/g, '-') + '-' + id,
      onclick: () => onPick(id),
    }, name))));
}

function quoteText(l) {
  const qty = Number(l.qty) || 1;
  if (l.brand !== 'milgard') return `${qty}× ${l.series || ''} ${typeName(l.type)} ${l.w}×${l.h}`;
  const door = isMilgardDoorLine(l);
  const style = door
    ? ({ '2panel': '2-panel', '3panel': '3-panel', '4panel': '4-panel OXXO' }[l.type] + ' patio door')
    : (data.milgardOnelink?.names?.[l.type] || typeName(l.type));
  const extra = [];
  if (door) {
    const name = doorColorLabel(l.series, l.color);
    if (name && (l.series === 'A250' || l.color !== 'ww')) extra.push(name);
  } else if (l.color && l.color !== 'ww') extra.push(colorById(l.color)?.name || l.color);
  if (l.grids && l.grids !== 'none') extra.push(l.grids + ' grids');
  if (l.obscure && l.obscure !== 'none') extra.push(l.obscure === 'satin' ? 'Satin Etch' : 'P516');
  if (l.tempered) extra.push('tempered');
  if (l.pureview) extra.push('PureView');
  if (!door && l.shape === 'eyebrow') extra.push('eyebrow');
  if (!door && l.frame === 'zbar') extra.push('Z-bar');
  if (!door && l.frame === 'block') extra.push('block');
  return `${qty}× ${l.series} ${style} ${l.w}×${l.h}${extra.length ? ' · ' + extra.join(', ') : ''}`;
}

function focusRoom() {
  requestAnimationFrame(() => {
    const el = document.getElementById('in-label');
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    el.scrollIntoView({ block: 'center' });
  });
}

// Keep the last room filled. Focus selects it so the next keystrokes replace it.
// Blur with an empty field, or with no typing, puts the previous room back.
export function roomLabelProps(get, set) {
  return {
    onfocus(e) {
      const el = e.target;
      el.dataset.roomPrev = el.value;
      el.dataset.roomEdited = '';
      setTimeout(() => {
        if (document.activeElement !== el || el.dataset.roomEdited === '1') return;
        try { el.setSelectionRange(0, el.value.length); } catch { /* ignore */ }
      }, 10);
    },
    onmouseup(e) {
      if (e.target.dataset.roomEdited === '1') return;
      e.preventDefault();
    },
    oninput(e) {
      e.target.dataset.roomEdited = '1';
      set(e.target.value);
    },
    onblur(e) {
      const el = e.target;
      const prev = el.dataset.roomPrev ?? '';
      const edited = el.dataset.roomEdited === '1';
      const now = String(el.value || '').trim();
      const next = !edited || !now ? prev : now;
      el.value = next;
      el.dataset.roomEdited = '';
      set(next);
    },
  };
}

export function renderMilgard(root, { calc, persist, rerender }) {
  const view = captureView();
  ensure(calc);
  const wrap = h('div', { class: 'page calc calc-milgard' });
  wrap.append(h('h1', {}, 'Price Calculator'));
  wrap.append(h('div', { class: 'tabs seg' }, data.rates.brands.map((b) => h('button', {
    type: 'button', class: 'seg-btn' + (b.id === 'milgard' ? ' on' : ''),
    onclick: () => { calc.brand = b.id; persist(); rerender(); },
  }, b.name, b.status !== 'active' && h('small', {}, ' soon')))));

  const priceEl = h('div', { class: 'big', id: 'price-window' }, '—');
  const unitEl = h('div', { class: 'sub', id: 'price-unit' }, 'per unit');
  const notesEl = h('div', { id: 'price-notes' });
  const errEl = h('div', { class: 'size-err', id: 'size-err' });
  const wHint = h('div', { class: 'fine', id: 'size-w-hint' });
  const hHint = h('div', { class: 'fine', id: 'size-h-hint' });
  const addBtn = h('button', { type: 'button', class: 'btn primary xl', id: 'btn-add' }, icon('plus'), 'Add to quote');
  const quoteEl = h('div', { id: 'quote-body' });
  const doorLaborEl = h('div', { class: 'labor-box on', id: 'door-labor-box' });

  const setKind = (kind) => {
    calc.product = kind;
    if (kind === 'door' && !DOOR_SERIES.some((s) => s[0] === calc.series)) calc.series = 'V300';
    if (kind === 'window' && !WINDOW_SERIES.some((s) => s[0] === calc.series)) calc.series = 'V250';
    const styles = stylesFor(calc).map((s) => s[0]);
    if (!styles.includes(calc.type)) calc.type = styles[0];
    persist(); rerender();
  };

  const left = h('div', { class: 'card' });
  left.append(h('h3', {}, '1 · Product'));
  left.append(h('p', { class: 'fine' }, 'SunCoatMAX, high heat bead where available, and Full Lifetime where available are included. Windows include a standard fiberglass screen. Doors include an upgraded fiberglass screen. Door sizes are the net frame, not the rough opening.'));
  left.append(seg('Product', [['window', 'Window'], ['door', 'Patio door']], calc.product, setKind));
  left.append(seg('Series', calc.product === 'door' ? DOOR_SERIES : WINDOW_SERIES, calc.series, (id) => { calc.series = id; persist(); rerender(); }));
  left.append(seg('Style', stylesFor(calc), calc.type, (id) => { calc.type = id; persist(); rerender(); }));
  if (calc.product === 'window' && (calc.type === 'arch_xo' || calc.type === 'arch_xox')) {
    left.append(seg('Head', [['arch', 'Arch'], ['eyebrow', 'Eyebrow']], calc.shape === 'eyebrow' ? 'eyebrow' : 'arch', (id) => { calc.shape = id; persist(); rerender(); }));
    left.append(h('p', { class: 'fine', id: 'arch-head-note' }, 'Arch and eyebrow are the same price. Arch uses a semicircle: the leg, and the bottom window, are the height minus half the width. An eyebrow rise is one eighth of the width.'));
  }
  const a250Win = calc.product === 'window' && calc.series === 'A250';
  const glass = a250Win ? a250GlassOptions(data.milgardOnelink, calc.type) : { tempered: true, obscure: true };
  if (a250Win) left.append(h('p', { class: 'fine', id: 'a250-note' }, A250_NOTE));
  const roomMsg = h('p', { class: 'warn', id: 'room-required', hidden: String(calc.label || '').trim() ? true : null }, 'Enter a location (e.g. Kitchen)');
  const setRoom = (v) => { calc.label = v; persist(); update(); };
  const roomField = h('label', { class: 'field room-label' }, h('span', { class: 'lbl' }, 'Room / location'), h('input', {
    type: 'text', id: 'in-label', value: calc.label || '', placeholder: 'e.g. Kitchen',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    ...roomLabelProps(() => calc.label || '', setRoom),
  }), roomMsg);

  const sizeAttrs = { type: 'text', inputmode: 'decimal', pattern: '[0-9]*[.]?[0-9]*', placeholder: '0' };
  const onSize = (assign) => (e) => {
    const cleaned = decimal(e.target.value);
    if (e.target.value !== cleaned) e.target.value = cleaned;
    assign(cleaned);
    persist();
    update();
  };
  const wInput = h('input', { ...sizeAttrs, id: 'in-w', value: calc.w ?? '', oninput: onSize((v) => { calc.w = v; }) });
  const hInput = h('input', { ...sizeAttrs, id: 'in-h', value: calc.h ?? '', oninput: onSize((v) => { calc.h = v; }) });
  const sizeLabel = calc.product === 'door' ? 'net frame' : '';
  left.append(h('div', { class: 'room-size' },
    roomField,
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, sizeLabel ? 'Net frame width (in)' : 'Width (in)'), wInput, wHint),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, sizeLabel ? 'Net frame height (in)' : 'Height (in)'), hInput, hHint))));
  left.append(errEl);

  if (calc.product === 'door') {
    left.append(seg('Color', doorColorChoices(calc.series), calc.color, (id) => { calc.color = id; persist(); rerender(); }));
  }
  if (calc.product === 'window') {
    left.append(seg('Color', windowColors(calc.series), calc.color, (id) => { calc.color = id; persist(); rerender(); }));
    if (!a250Win) left.append(seg('Grids', GRIDS, calc.grids, (id) => { calc.grids = id; persist(); rerender(); }));
    if (glass.obscure) left.append(seg('Obscure glass', OBSCURE, calc.obscure, (id) => { calc.obscure = id; persist(); rerender(); }));
    left.append(seg('Frame', FRAMES, calc.frame, (id) => {
      calc.frame = id;
      calc.install.type = FRAME_LABOR[id];
      calc.install.frameType = id;
      persist(); rerender();
    }));
  }

  const toggles = h('div', {});
  if (calc.product === 'window' && glass.tempered) {
    toggles.append(h('label', { class: 'check' }, h('input', {
      type: 'checkbox', id: 'opt-tempered', checked: calc.tempered ? 'checked' : null,
      onchange: (e) => { calc.tempered = e.target.checked; persist(); update(); },
    }), h('span', {}, 'Tempered glass')));
  }
  const showPV = !(calc.product === 'window' && calc.type === 'picture') && calc.series !== 'A250';
  if (showPV) {
    toggles.append(h('label', { class: 'check' }, h('input', {
      type: 'checkbox', id: 'opt-pureview', checked: calc.pureview ? 'checked' : null,
      onchange: (e) => { calc.pureview = e.target.checked; persist(); update(); },
    }), h('span', {}, 'PureView screen'), h('em', {}, calc.product === 'door' ? ' +$137' : '')));
  }
  if (toggles.childNodes.length) left.append(h('div', { class: 'lbl' }, 'Upgrades'), toggles);
  left.append(h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Qty'), h('input', {
    type: 'text', inputmode: 'numeric', id: 'in-q', value: calc.qty || 1,
    oninput: (e) => { calc.qty = e.target.value.replace(/[^0-9]/g, ''); persist(); update(); },
  })));

  left.append(h('h3', {}, 'Installation'));
  if (calc.product === 'window') left.append(windowLabor(calc, persist, rerender, update));
  else left.append(doorLabor(calc, persist, rerender, update, doorLaborEl));

  const drawHost = h('div', { id: 'calc-drawing' });
  const right = h('div', { class: 'col sticky' },
    h('div', { class: 'card price' }, h('h3', {}, '2 · Price'), drawHost, priceEl, unitEl, notesEl, addBtn),
    h('div', { class: 'card' }, h('h3', {}, '3 · Quote'), quoteEl));
  wrap.append(h('div', { class: 'two' }, left, right));
  root.replaceChildren(wrap);

  addBtn.onclick = () => addLine();
  update();
  restoreView(view);

  function limitsNow() {
    const D = data.milgardOnelink;
    if (!D) return null;
    if (calc.product === 'door') return D.doorLimits[calc.series + '_' + DOOR_CONFIG[calc.type]] || null;
    return styleLimits(D, calc.series, calc.type);
  }

  function update() {
    const L = limitsNow();
    const bounded = !!(L && (L.wmin != null || L.wmax != null || L.hmin != null || L.hmax != null || L.hintW || L.hintH));
    wHint.textContent = bounded ? (L.hintW || (L.wmin != null ? `Allowed ${L.wmin}–${L.wmax}"` : '')) : '';
    hHint.textContent = bounded ? (L.hintH || (L.hmin != null ? `Allowed ${L.hmin}–${L.hmax}"${L.curve ? ' (max shrinks on wide units)' : ''}` : '')) : '';
    const line = draftLine(calc);
    const q = milgardQuote(data.milgardOnelink, line);
    const sized = line.w > 0 && line.h > 0;
    const unavailable = !!q?.unavailable;
    const errors = !unavailable && sized && q ? q.errors : [];
    errEl.textContent = errors.join(' ');
    const locationOk = String(calc.label || '').trim().length > 0;
    roomMsg.hidden = locationOk;
    addBtn.disabled = unavailable || !sized || errors.length > 0 || !locationOk;
    addBtn.title = unavailable ? 'Not available' : (locationOk ? '' : 'Enter a location (e.g. Kitchen)');
    const qty = line.qty;
    priceEl.classList.remove('pending');
    if (unavailable) {
      priceEl.textContent = 'Not available';
      priceEl.classList.add('pending');
      unitEl.textContent = 'this combination cannot be added';
    } else if (!sized || !q || errors.length) {
      priceEl.textContent = '—';
      unitEl.textContent = 'per unit';
    } else if (q.pricePending) {
      priceEl.textContent = PRICE_PENDING_LABEL;
      priceEl.classList.add('pending');
      unitEl.textContent = 'not a real OneLink price';
    } else {
      const each = Math.round(q.material * 100) / 100;
      priceEl.textContent = fmt(each * qty);
      unitEl.textContent = qty > 1 ? `${qty} × ${fmt(each)}` : 'per unit';
    }
    const noteNodes = [];
    if (q?.provisional && sized && !errors.length && !unavailable) noteNodes.push(h('div', { class: 'provisional-flag', id: 'provisional-flag' }, 'Provisional price'));
    for (const n of q?.notes || []) {
      if (unavailable && n === 'Not available') continue;
      noteNodes.push(h('div', { class: 'note' }, n));
    }
    notesEl.replaceChildren(...noteNodes);
    drawHost.replaceChildren(...(sized ? [drawingEl(line, 'calc-drawing', { boxW: 240, boxH: 200 })] : []));
    if (calc.product === 'door') {
      const base = data.install.doors.panels[calc.type] || 0;
      const tall = line.h > data.install.doors.tallOverInches;
      const who = calc.type === '2panel' ? '2-panel' : calc.type === '3panel' ? '3-panel' : '4-panel';
      doorLaborEl.innerHTML = `${who} slider install<small>${fmt(base)}${tall ? ` + ${fmt(data.install.doors.tallAdd)} over 7 ft` : ''} / door</small>`;
    }
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
        h('span', { class: 'qdraw-txt' }, quoteText(l), l.provisional ? h('div', { class: 'provisional-flag' }, 'Provisional price') : null),
        h('span', { class: 'row nowrap' }, h('b', { class: l.pricePending || l.unavailable ? 'pending-price' : '' }, linePriceText(l)),
          h('button', { type: 'button', class: 'x', 'aria-label': 'Remove line', onclick: () => { e.lines.splice(i, 1); estimates.persist(); update(); } }, icon('x')))));
    });
    for (const row of quoteTotalRows(t)) {
      quoteEl.append(h('div', {
        class: 'line' + (row.strong ? ' strong' : '') + (row.discount ? ' discount' : ''),
        id: row.id === 'materialsSub' ? 'materials-subtotal' : row.id === 'install' ? 'quote-install' : row.id === 'tax' ? 'quote-tax' : row.id === 'shipping' ? 'quote-shipping' : null,
      }, h('span', {}, row.label), h('b', {}, fmt(row.amount))));
    }
    quoteEl.append(h('div', { class: 'line strong' }, h('span', {}, 'Total'), h('b', { id: 'quote-total' }, fmt(t.total))));
    quoteEl.append(h('a', { class: 'btn', href: '#/estimate', id: 'btn-open-est' }, 'Open estimate'));
  }

  function addLine() {
    const location = String(calc.label || '').trim();
    const line = draftLine(calc);
    const q = milgardQuote(data.milgardOnelink, line);
    if (!location || !q || q.unavailable || q.errors.length || !(line.w > 0) || !(line.h > 0)) return;
    const p = priceWindow(line);
    if (!p || p.blocked || p.unit == null) return;
    const e = estimates.current();
    const inst = installFromCalc(calc);
    e.lines.push({
      id: uid(), label: location,
      brand: 'milgard', series: calc.series, type: calc.type, color: line.color,
      w: line.w, h: line.h, qty: line.qty, unitsPerLine: 1,
      options: optionIds(calc), addons: addonIds(calc),
      grids: line.grids, obscure: line.obscure, tempered: line.tempered, pureview: line.pureview, frame: line.frame,
      shape: line.shape || '',
      supplierPrice: null, customDescription: '',
      unitBase: p.unit, optionsEach: 0, unit: p.unit, rate: p.rate, rateSet: settings.rateSet,
      estimated: false, pricingMode: 'onelink', pricePending: !!p.pricePending, provisional: !!p.provisional, unavailable: false,
      install: inst, installUnit: installUnit(inst, line),
    });
    estimates.persist();
    calc.w = '';
    calc.h = '';
    persist();
    toast(`Added to ${e.number}`);
    rerender();
    focusRoom();
  }
}

function windowLabor(calc, persist, rerender, update) {
  const box = h('div', { class: 'labor-boxes', id: 'win-labor' });
  for (const t of data.install.types) {
    const on = calc.install.type === t.id;
    box.append(h('button', {
      type: 'button', class: 'labor-box' + (on ? ' on' : ''), id: 'labor-' + t.id,
      onclick: () => {
        calc.install.type = t.id;
        if (t.id === 'standard') calc.frame = calc.install.frameType = 'zbar';
        else if (t.id === 'stucco-fin') calc.frame = calc.install.frameType = 'nailfin';
        else if (t.id === 'block') calc.frame = calc.install.frameType = 'block';
        persist(); rerender();
      },
    }, t.name, h('small', {}, t.custom ? 'type a price' : `${fmt(t.price)} / window`)));
  }
  const custom = calc.install.type === 'custom'
    ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Custom labor price (each)'), h('input', {
      type: 'text', inputmode: 'decimal', id: 'labor-custom', value: calc.install.custom ?? '', placeholder: '$',
      oninput: (e) => { calc.install.custom = decimal(e.target.value); persist(); update(); },
    }))
    : null;
  const adds = h('div', { class: 'labor-boxes' });
  for (const s of data.install.surcharges) {
    const on = (calc.install.surcharges || []).includes(s.id);
    adds.append(h('button', {
      type: 'button', class: 'chip pick labor-add' + (on ? ' on' : ''), id: 'addon-' + s.id,
      onclick: () => {
        const cur = new Set(calc.install.surcharges || []);
        if (cur.has(s.id)) cur.delete(s.id); else cur.add(s.id);
        calc.install.surcharges = [...cur];
        persist(); rerender();
      },
    }, `${s.name} · ${fmt(s.amount)}`));
  }
  return h('div', {}, box, custom, h('div', { class: 'lbl' }, 'Add-ons'), adds);
}

function doorLabor(calc, persist, rerender, update, doorLaborEl) {
  const adds = h('div', { class: 'labor-boxes', id: 'door-addons' });
  for (const s of data.install.doors.addons) {
    const on = calc.doorAddons.includes(s.id);
    const price = s.per === 'linearFoot' ? `${fmt(s.amount)} / ft` : fmt(s.amount);
    adds.append(h('button', {
      type: 'button', class: 'chip pick labor-add' + (on ? ' on' : ''), id: 'door-addon-' + s.id,
      onclick: () => {
        const cur = new Set(calc.doorAddons);
        if (cur.has(s.id)) cur.delete(s.id); else cur.add(s.id);
        calc.doorAddons = [...cur];
        persist(); rerender();
      },
    }, `${s.name} · ${price}`));
  }
  const feet = h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Header linear feet'), h('input', {
    type: 'text', inputmode: 'decimal', id: 'header-feet', value: calc.headerFeet ?? '', placeholder: '0',
    oninput: (e) => {
      const cleaned = decimal(e.target.value);
      if (e.target.value !== cleaned) e.target.value = cleaned;
      calc.headerFeet = cleaned;
      // Keep the input mounted. A full redraw on the first digit drops the rest of a decimal.
      if ((Number(cleaned) || 0) > 0 && !calc.doorAddons.includes('door-header')) {
        calc.doorAddons.push('door-header');
        document.getElementById('door-addon-door-header')?.classList.add('on');
      }
      persist();
      update();
    },
  }));
  const write = h('div', { class: 'grid2' },
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Write-in (optional)'), h('input', {
      type: 'text', id: 'write-desc', value: calc.writeInDesc || '', placeholder: 'Description',
      oninput: (e) => { calc.writeInDesc = e.target.value; persist(); update(); },
    })),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Write-in price'), h('input', {
      type: 'text', inputmode: 'decimal', id: 'write-amt', value: calc.writeInAmt ?? '', placeholder: '$',
      oninput: (e) => { calc.writeInAmt = decimal(e.target.value); persist(); update(); },
    })));
  return h('div', {}, h('div', { class: 'labor-boxes' }, doorLaborEl), h('div', { class: 'lbl' }, 'Add-ons'), adds, feet, write);
}

function syncFlags(line) {
  const dropA = new Set(['tempered', 'obscure', 'grids', 'pureview']);
  const dropO = new Set(['tempered', 'obscure', 'grids-colonial', 'pureview', 'milgard-p516', 'milgard-satin']);
  line.addons = (line.addons || []).filter((id) => !dropA.has(id));
  line.options = (line.options || []).filter((id) => !dropO.has(id));
  if (line.tempered) { line.addons.push('tempered'); line.options.push('tempered'); }
  if (line.obscure === 'p516') { line.addons.push('obscure'); line.options.push('obscure', 'milgard-p516'); }
  if (line.obscure === 'satin') { line.addons.push('obscure'); line.options.push('obscure', 'milgard-satin'); }
  if (line.grids === 'flat') { line.addons.push('grids'); line.options.push('grids-colonial'); }
  if (line.pureview) { line.addons.push('pureview'); line.options.push('pureview'); }
}

export function milgardLineEditor(line, onChange, idp = 'mg-') {
  const change = () => { syncFlags(line); onChange(); };
  if (isMilgardDoorLine(line)) {
    const colors = h('div', { class: 'chips', id: idp + 'door-colors' }, doorColorChoices(line.series).map(([id, name]) => h('button', {
      type: 'button', class: 'chip pick' + (line.color === id ? ' on' : ''), id: idp + 'color-' + id,
      onclick: () => { line.color = id; change(); },
    }, name)));
    const extra = line.series === 'A250'
      ? h('p', { class: 'fine' }, 'A250 includes the standard fiberglass screen. Bronze Anodized and Clear Anodized are the same price.')
      : h('label', { class: 'check' }, h('input', {
        type: 'checkbox', id: idp + 'pureview', checked: line.pureview ? 'checked' : null,
        onchange: (e) => { line.pureview = e.target.checked; change(); },
      }), h('span', {}, 'PureView screen'), h('em', {}, ' +$137'));
    return h('div', {}, colors, extra);
  }
  const a250 = line.series === 'A250';
  if (a250) {
    const before = [line.grids, line.obscure, line.tempered, line.pureview].join('|');
    trimA250(line);
    // A style change can leave an upgrade A250 has no price for. Drop it and reprice once.
    if ([line.grids, line.obscure, line.tempered, line.pureview].join('|') !== before) { syncFlags(line); queueMicrotask(onChange); }
  }
  const glass = a250 ? a250GlassOptions(data.milgardOnelink, line.type) : { tempered: true, obscure: true };
  const color = (id, label) => h('button', {
    type: 'button', class: 'chip pick' + (line.color === id ? ' on' : ''),
    onclick: () => { line.color = id; change(); },
  }, label);
  const flag = (key, id, label) => h('label', { class: 'check' }, h('input', {
    type: 'checkbox', id: idp + id, checked: line[key] ? 'checked' : null,
    onchange: (e) => { line[key] = e.target.checked; change(); },
  }), h('span', {}, label));
  return h('div', {},
    h('div', { class: 'chips' }, windowColors(line.series).map(([id, name]) => color(id, name))),
    a250 ? null : h('div', { class: 'chips' }, GRIDS.map(([id, name]) => h('button', {
      type: 'button', class: 'chip pick' + ((line.grids || 'none') === id ? ' on' : ''),
      onclick: () => { line.grids = id; change(); },
    }, name + ' grids'))),
    glass.obscure ? h('div', { class: 'chips' }, OBSCURE.map(([id, name]) => h('button', {
      type: 'button', class: 'chip pick' + ((line.obscure || 'none') === id ? ' on' : ''),
      onclick: () => { line.obscure = id; change(); },
    }, name))) : null,
    glass.tempered ? flag('tempered', 'tempered', 'Tempered glass') : null,
    a250 ? h('p', { class: 'fine' }, A250_NOTE) : null,
    line.type === 'picture' || a250 ? null : flag('pureview', 'pureview', 'PureView screen'));
}

export function doorInstallEditor(line, onChange, idp = 'door-') {
  line.install ||= { type: 'door', surcharges: [], headerFeet: '', writeIn: { description: '', amount: '' } };
  const inst = line.install;
  inst.surcharges ||= [];
  inst.writeIn ||= { description: '', amount: '' };
  const adds = data.install.doors.addons.map((s) => {
    const on = inst.surcharges.includes(s.id);
    const price = s.per === 'linearFoot' ? `${fmt(s.amount)} / ft` : fmt(s.amount);
    return h('button', {
      type: 'button', class: 'chip pick labor-add' + (on ? ' on' : ''), id: idp + s.id,
      onclick: () => {
        const cur = new Set(inst.surcharges);
        if (cur.has(s.id)) cur.delete(s.id); else cur.add(s.id);
        inst.surcharges = [...cur];
        onChange(true);
      },
    }, `${s.name} · ${price}`);
  });
  return h('div', { class: 'install-ed' },
    h('p', { class: 'fine' }, installLabel(inst, line) + ' · ' + fmt(installUnit(inst, line))),
    h('div', { class: 'labor-boxes' }, adds),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Header linear feet'), h('input', {
      type: 'text', inputmode: 'decimal', id: idp + 'header-feet', value: inst.headerFeet ?? '',
      oninput: (e) => {
        const cleaned = decimal(e.target.value);
        if (e.target.value !== cleaned) e.target.value = cleaned;
        inst.headerFeet = cleaned;
        if ((Number(cleaned) || 0) > 0 && !inst.surcharges.includes('door-header')) {
          inst.surcharges.push('door-header');
          document.getElementById(idp + 'door-header')?.classList.add('on');
        }
        onChange(false);
      },
    })),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Write-in'), h('input', {
        type: 'text', id: idp + 'write-desc', value: inst.writeIn.description || '', placeholder: 'Description',
        oninput: (e) => { inst.writeIn.description = e.target.value; onChange(false); },
      })),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Write-in price'), h('input', {
        type: 'text', inputmode: 'decimal', id: idp + 'write-amt', value: inst.writeIn.amount ?? '', placeholder: '$',
        oninput: (e) => { inst.writeIn.amount = decimal(e.target.value); onChange(false); },
      }))));
}
