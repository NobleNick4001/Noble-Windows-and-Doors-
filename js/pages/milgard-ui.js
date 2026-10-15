import { h, fmt, data, settings, estimates, toast, uid, totals, priceWindow, installUnit, addonUnit, installLabel, addonNames, defaultInstall, typeName, colorById, quoteTotalRows } from '../core.js';
import { isMilgardDoorLine, milgardQuote, engineFor, DOOR_CONFIG, WINDOW_STYLES, doorColorChoices, doorColorLabel } from '../milgard.js';

const WINDOW_SERIES = [['V250', 'V250'], ['V300', 'V300'], ['V400', 'V400']];
const DOOR_SERIES = [['V300', 'V300'], ['V400', 'V400'], ['A250', 'A250 aluminum']];
const STYLES = {
  window: [['hslider', 'XO'], ['xox', 'XOX'], ['vslider', 'Single hung'], ['picture', 'Picture'], ['casement', 'Casement'], ['awning', 'Awning']],
  door: [['2panel', '2-panel XO'], ['3panel', '3-panel'], ['4panel', '4-panel OXXO']],
};
const COLORS = [['ww', 'White'], ['adobe', 'Adobe'], ['bronze', 'Bronze'], ['bw', 'Black ext'], ['bb', 'Black/Black']];
const GRIDS = [['none', 'None'], ['flat', 'Flat'], ['sculptured', 'Sculptured'], ['perimeter', 'Perimeter']];
const OBSCURE = [['none', 'Clear'], ['p516', 'P516'], ['satin', 'Satin Etch']];
const FRAMES = [['zbar', 'Z-bar'], ['nailfin', 'Nail fin'], ['block', 'Block']];
const FRAME_LABOR = { zbar: 'standard', nailfin: 'stucco-fin', block: 'block' };

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
  const styles = STYLES[calc.product].map((x) => x[0]);
  if (!styles.includes(calc.type)) calc.type = styles[0];
  if (calc.product === 'door') {
    const choices = doorColorChoices(calc.series);
    if (!choices.some((c) => c[0] === calc.color)) calc.color = choices[0][0];
  } else if (!COLORS.some((c) => c[0] === calc.color)) calc.color = 'ww';
  if (calc.product === 'window' && calc.install.type !== 'custom') {
    calc.install.type = FRAME_LABOR[calc.frame] || 'standard';
    calc.install.frameType = calc.frame;
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
  if (!door && l.frame === 'zbar') extra.push('Z-bar');
  if (!door && l.frame === 'block') extra.push('block');
  return `${qty}× ${l.series} ${style} ${l.w}×${l.h}${extra.length ? ' · ' + extra.join(', ') : ''}`;
}

export function renderMilgard(root, { calc, persist, rerender }) {
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
  const addBtn = h('button', { type: 'button', class: 'btn primary xl', id: 'btn-add' }, 'Add to quote');
  const quoteEl = h('div', { id: 'quote-body' });
  const doorLaborEl = h('div', { class: 'labor-box on', id: 'door-labor-box' });

  const setKind = (kind) => {
    calc.product = kind;
    if (kind === 'door' && !DOOR_SERIES.some((s) => s[0] === calc.series)) calc.series = 'V300';
    if (kind === 'window' && !WINDOW_SERIES.some((s) => s[0] === calc.series)) calc.series = 'V250';
    const styles = STYLES[kind].map((s) => s[0]);
    if (!styles.includes(calc.type)) calc.type = styles[0];
    persist(); rerender();
  };

  const left = h('div', { class: 'card' });
  left.append(h('h3', {}, '1 · Product'));
  left.append(h('p', { class: 'fine' }, 'SunCoatMAX, high heat bead where available, and Full Lifetime where available are included. Windows include a standard fiberglass screen. Doors include an upgraded fiberglass screen.'));
  left.append(seg('Product', [['window', 'Window'], ['door', 'Patio door']], calc.product, setKind));
  left.append(seg('Series', calc.product === 'door' ? DOOR_SERIES : WINDOW_SERIES, calc.series, (id) => { calc.series = id; persist(); rerender(); }));
  left.append(seg('Style', STYLES[calc.product], calc.type, (id) => { calc.type = id; persist(); rerender(); }));

  const wInput = h('input', { type: 'text', inputmode: 'decimal', id: 'in-w', value: calc.w ?? '', placeholder: '0', oninput: (e) => { calc.w = decimal(e.target.value); persist(); update(); } });
  const hInput = h('input', { type: 'text', inputmode: 'decimal', id: 'in-h', value: calc.h ?? '', placeholder: '0', oninput: (e) => { calc.h = decimal(e.target.value); persist(); update(); } });
  left.append(h('div', { class: 'grid2' },
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Width (in)'), wInput, wHint),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Height (in)'), hInput, hHint)));
  left.append(errEl);

  if (calc.product === 'door') {
    left.append(seg('Color', doorColorChoices(calc.series), calc.color, (id) => { calc.color = id; persist(); rerender(); }));
  }
  if (calc.product === 'window') {
    left.append(seg('Color', COLORS, calc.color, (id) => { calc.color = id; persist(); rerender(); }));
    left.append(seg('Grids', GRIDS, calc.grids, (id) => { calc.grids = id; persist(); rerender(); }));
    left.append(seg('Obscure glass', OBSCURE, calc.obscure, (id) => { calc.obscure = id; persist(); rerender(); }));
    left.append(seg('Frame', FRAMES, calc.frame, (id) => {
      calc.frame = id;
      calc.install.type = FRAME_LABOR[id];
      calc.install.frameType = id;
      persist(); rerender();
    }));
  }

  const toggles = h('div', {});
  if (calc.product === 'window') {
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
  left.append(h('div', { class: 'lbl' }, 'Upgrades'), toggles);
  left.append(h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Qty'), h('input', {
    type: 'text', inputmode: 'numeric', id: 'in-q', value: calc.qty || 1,
    oninput: (e) => { calc.qty = e.target.value.replace(/[^0-9]/g, ''); persist(); update(); },
  })));
  left.append(h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Room / label (optional)'), h('input', {
    type: 'text', id: 'in-label', value: calc.label || '', placeholder: 'e.g. Kitchen slider',
    oninput: (e) => { calc.label = e.target.value; persist(); },
  })));

  left.append(h('h3', {}, 'Installation'));
  if (calc.product === 'window') left.append(windowLabor(calc, persist, rerender, update));
  else left.append(doorLabor(calc, persist, rerender, update, doorLaborEl));

  const right = h('div', { class: 'col sticky' },
    h('div', { class: 'card price' }, h('h3', {}, '2 · Price'), priceEl, unitEl, notesEl, addBtn),
    h('div', { class: 'card' }, h('h3', {}, '3 · Quote'), quoteEl));
  wrap.append(h('div', { class: 'two' }, left, right));
  root.replaceChildren(wrap);

  addBtn.onclick = () => addLine();
  update();

  function limitsNow() {
    const D = data.milgardOnelink;
    if (!D) return null;
    if (calc.product === 'door') return D.doorLimits[calc.series + '_' + DOOR_CONFIG[calc.type]] || null;
    return engineFor(D)?.limits(calc.series, calc.type) || null;
  }

  function update() {
    const L = limitsNow();
    wHint.textContent = L ? `Allowed ${L.wmin}–${L.wmax}"` : '';
    hHint.textContent = L ? `Allowed ${L.hmin}–${L.hmax}"${L.curve ? ' (max shrinks on wide units)' : ''}` : '';
    const line = draftLine(calc);
    const q = milgardQuote(data.milgardOnelink, line);
    const sized = line.w > 0 && line.h > 0;
    const errors = sized && q ? q.errors : [];
    errEl.textContent = errors.join(' ');
    addBtn.disabled = !sized || errors.length > 0;
    const qty = line.qty;
    if (!sized || !q || errors.length) {
      priceEl.textContent = '—';
      unitEl.textContent = 'per unit';
    } else {
      const each = Math.round(q.material * 100) / 100;
      priceEl.textContent = fmt(each * qty);
      unitEl.textContent = qty > 1 ? `${qty} × ${fmt(each)}` : 'per unit';
    }
    notesEl.replaceChildren(...(q?.notes || []).map((n) => h('div', { class: 'note' }, n)));
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
      quoteEl.append(h('div', { class: 'line' },
        h('span', {}, quoteText(l)),
        h('span', { class: 'row nowrap' }, h('b', {}, fmt((Number(l.unit) || 0) * (Number(l.qty) || 0))),
          h('button', { type: 'button', class: 'x', 'aria-label': 'Remove line', onclick: () => { e.lines.splice(i, 1); estimates.persist(); update(); } }, '✕'))));
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
    const line = draftLine(calc);
    const q = milgardQuote(data.milgardOnelink, line);
    if (!q || q.errors.length || !(line.w > 0) || !(line.h > 0)) return;
    const p = priceWindow(line);
    if (!p) return;
    const e = estimates.current();
    const n = e.lines.length + 1;
    const inst = installFromCalc(calc);
    e.lines.push({
      id: uid(), label: calc.label || (calc.product === 'door' ? `Door ${n}` : `Window ${n}`),
      brand: 'milgard', series: calc.series, type: calc.type, color: line.color,
      w: line.w, h: line.h, qty: line.qty, unitsPerLine: 1,
      options: optionIds(calc), addons: addonIds(calc),
      grids: line.grids, obscure: line.obscure, tempered: line.tempered, pureview: line.pureview, frame: line.frame,
      supplierPrice: null, customDescription: '',
      unitBase: p.unit, optionsEach: 0, unit: p.unit, rate: null, rateSet: settings.rateSet,
      estimated: false, pricingMode: 'onelink',
      install: inst, installUnit: installUnit(inst, line),
    });
    estimates.persist();
    calc.w = '';
    calc.h = '';
    persist();
    toast(`Added to ${e.number}`);
    rerender();
    requestAnimationFrame(() => document.getElementById('in-w')?.focus());
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
  const color = (id, label) => h('button', {
    type: 'button', class: 'chip pick' + (line.color === id ? ' on' : ''),
    onclick: () => { line.color = id; change(); },
  }, label);
  const flag = (key, id, label) => h('label', { class: 'check' }, h('input', {
    type: 'checkbox', id: idp + id, checked: line[key] ? 'checked' : null,
    onchange: (e) => { line[key] = e.target.checked; change(); },
  }), h('span', {}, label));
  return h('div', {},
    h('div', { class: 'chips' }, COLORS.map(([id, name]) => color(id, name))),
    h('div', { class: 'chips' }, GRIDS.map(([id, name]) => h('button', {
      type: 'button', class: 'chip pick' + ((line.grids || 'none') === id ? ' on' : ''),
      onclick: () => { line.grids = id; change(); },
    }, name + ' grids'))),
    h('div', { class: 'chips' }, OBSCURE.map(([id, name]) => h('button', {
      type: 'button', class: 'chip pick' + ((line.obscure || 'none') === id ? ' on' : ''),
      onclick: () => { line.obscure = id; change(); },
    }, name))),
    flag('tempered', 'tempered', 'Tempered glass'),
    line.type === 'picture' ? null : flag('pureview', 'pureview', 'PureView screen'));
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
