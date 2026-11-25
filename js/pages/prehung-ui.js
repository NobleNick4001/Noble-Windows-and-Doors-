import { h, fmt, data, estimates, toast, uid, store, linePriceText } from '../core.js';
import { roomLabelProps } from './milgard-ui.js';
import { openBrand } from './calculator.js';
import { icon } from '../icons.js';
import { drawingEl } from '../drawings.js';
import {
  isPrehungLine, normalizePrehungSheet, defaultPrehungSheet, pricePrehung, stylesFor,
  prehungSummary, applyPrehungSheet, setPrehungWidth, setPrehungChoice, applySheetAdders,
  migratePrehungEstimate, handingOf,
} from '../prehung.js';

const draft = Object.assign(
  { widthId: '2-6', handing: 'lhi', label: '' },
  store.get('nwd.prehung.draft', {}),
);
const saveDraft = () => store.set('nwd.prehung.draft', {
  widthId: draft.widthId, handing: draft.handing, label: draft.label,
});

function catalog() { return data.prehung; }

function sheetOf(estimate) {
  const cat = catalog();
  if (estimate?.prehung) return normalizePrehungSheet(cat, estimate.prehung);
  const first = (estimate?.lines || []).find(isPrehungLine);
  if (first?.prehung) return normalizePrehungSheet(cat, first.prehung);
  const saved = store.get('nwd.prehung.sheet', null);
  if (saved) return normalizePrehungSheet(cat, saved);
  return defaultPrehungSheet(cat);
}

function rememberSheet(spec) {
  store.set('nwd.prehung.sheet', spec);
}

export function render(root) {
  const cat = catalog();
  if (!cat) {
    root.replaceChildren(h('div', { class: 'card' }, 'Prehung door prices did not load.'));
    return;
  }
  const estimate = estimates.current();
  if (migratePrehungEstimate(cat, estimate)) estimates.persist();
  const sheet = sheetOf(estimate);
  const priced = pricePrehung(cat, sheet);
  const locationOk = String(draft.label || '').trim().length > 0;
  const widths = cat.widths || [];
  if (!widths.some((item) => item.id === draft.widthId)) draft.widthId = widths[0]?.id || '';
  const handings = cat.handings || [];
  if (!handings.some((item) => item.id === draft.handing)) draft.handing = handings[0]?.id || '';

  const wrap = h('div', { class: 'page calc calc-milgard door-sheet' });
  wrap.append(h('h1', {}, 'Prehung Doors'));
  wrap.append(h('div', { class: 'tabs seg', id: 'brand-tabs' },
    ...data.rates.brands.map((brand) => h('button', {
      type: 'button', class: 'seg-btn',
      onclick: () => { openBrand(brand.id); location.hash = '#/calculator'; },
    }, brand.name, brand.status !== 'active' && h('small', {}, ' soon'))),
    h('button', { type: 'button', class: 'seg-btn on', id: 'tab-prehung' }, 'Prehung Doors')));

  const setSheet = (patch) => {
    const next = normalizePrehungSheet(cat, { ...sheet, ...patch });
    estimate.prehung = next;
    rememberSheet(next);
    const lineKeys = new Set(['core', 'style', 'height', 'double']);
    const affectsLines = Object.keys(patch).some((key) => !lineKeys.has(key));
    if (affectsLines) {
      for (const line of estimate.lines) {
        if (!isPrehungLine(line)) continue;
        applySheetAdders(cat, line, next);
      }
      estimates.persist();
    }
    render(root);
  };
  const toggleList = (key, id) => {
    const cur = new Set(sheet[key] || []);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    setSheet({ [key]: [...cur] });
  };

  const menu = h('div', { class: 'card', id: 'door-menu' });
  menu.append(h('h3', {}, 'Next door starts as'));
  menu.append(h('p', { class: 'fine' }, 'Style, core, height, and single or double are the starting point for the next door. Change them on each line. Jamb, options, and labor apply to every door, and the price follows that door’s height and core.'));
  menu.append(h('div', { class: 'lbl' }, 'Style'));
  menu.append(h('div', { class: 'style-tiles' }, stylesFor(cat, sheet.core).map((style) => h('button', {
    type: 'button',
    class: 'door-tile' + (style.id === sheet.style ? ' on' : ''),
    id: 'style-' + style.id,
    onclick: () => setSheet({ style: style.id }),
  }, h('img', { src: style.image?.[sheet.core] || '', alt: '' }), h('span', {}, style.name)))));
  menu.append(chipRow('Core', cat.cores, sheet.core, (id) => setSheet({ core: id }), 'core-'));
  menu.append(chipRow('Height', cat.heights, sheet.height, (id) => setSheet({ height: id }), 'height-'));
  menu.append(chipRow('Pair', [{ id: 'single', label: 'Single' }, { id: 'double', label: 'Double' }], sheet.double ? 'double' : 'single', (id) => setSheet({ double: id === 'double' }), 'pair-default-'));
  menu.append(h('div', { class: 'lbl' }, 'Every door'));
  menu.append(chipRow('Jamb', (cat.jambs || []).map((jamb) => ({
    id: jamb.id,
    label: jamb.name,
  })), sheet.jamb, (id) => setSheet({ jamb: id }), 'jamb-'));

  const optionBoxes = h('div', { class: 'labor-boxes', id: 'door-options' });
  for (const opt of cat.options || []) {
    const on = (sheet.options || []).includes(opt.id);
    optionBoxes.append(h('button', {
      type: 'button', class: 'labor-box' + (on ? ' on' : ''), id: 'opt-' + opt.id,
      onclick: () => toggleList('options', opt.id),
    }, opt.name));
  }
  menu.append(h('div', { class: 'lbl' }, 'Options'), optionBoxes);
  menu.append(h('p', { class: 'fine' }, 'A double is priced on top of that door. Cut-down follows the door’s core. The jamb add and the ball-catch credit follow the door’s height.'));

  const laborBoxes = h('div', { class: 'labor-boxes', id: 'door-labor' });
  for (const item of cat.labor || []) {
    const on = (sheet.labor || []).includes(item.id);
    laborBoxes.append(h('button', {
      type: 'button', class: 'labor-box' + (on ? ' on' : ''), id: 'labor-' + item.id,
      onclick: () => toggleList('labor', item.id),
    }, item.name));
  }
  menu.append(h('div', { class: 'lbl' }, 'Labor'), laborBoxes);
  wrap.append(menu);

  const roomMsg = h('p', {
    class: 'warn', id: 'room-required', hidden: locationOk ? true : null,
  }, 'Enter a location (e.g. Kitchen)');
  const setRoom = (value) => {
    draft.label = value;
    saveDraft();
    const ok = String(value || '').trim().length > 0;
    roomMsg.hidden = ok;
    const btn = document.getElementById('btn-add-door');
    if (btn) {
      btn.disabled = !ok;
      btn.title = ok ? '' : 'Enter a location (e.g. Kitchen)';
    }
  };
  const addCard = h('div', { class: 'card', id: 'door-add' });
  addCard.append(h('h3', {}, 'Add a door'));
  addCard.append(chipRow('Width', widths, draft.widthId, (id) => { draft.widthId = id; saveDraft(); render(root); }, 'width-'));
  addCard.append(h('div', { class: 'lbl' }, 'Handing'));
  addCard.append(h('div', { class: 'hand-picks' }, handings.map((hand) => h('button', {
    type: 'button',
    class: 'chip pick' + (hand.id === draft.handing ? ' on' : ''),
    id: 'hand-' + hand.id,
    onclick: () => { draft.handing = hand.id; saveDraft(); render(root); },
  }, hand.name))));
  addCard.append(h('label', { class: 'field room-label' },
    h('span', { class: 'lbl' }, 'Room / location'),
    h('input', {
      type: 'text', id: 'in-label', value: draft.label || '', placeholder: 'e.g. Kitchen',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
      ...roomLabelProps(() => draft.label || '', setRoom),
    }),
    roomMsg));
  const dock = h('div', { class: 'card price price-dock', id: 'door-price-dock' },
    h('div', { class: 'big', id: 'door-price' }, fmt(priced.material)),
    h('div', { class: 'sub' }, 'this door'),
    h('button', {
      type: 'button', class: 'btn primary xl', id: 'btn-add-door',
      disabled: locationOk ? null : true,
      title: locationOk ? '' : 'Enter a location (e.g. Kitchen)',
      onclick: () => addDoor(root),
    }, icon('plus'), 'Add'));
  wrap.append(addCard);
  wrap.append(dock);

  const list = h('div', { class: 'card', id: 'door-lines' });
  list.append(h('h3', {}, 'Doors on this estimate'));
  const doors = (estimate.lines || []).filter(isPrehungLine);
  if (!doors.length) list.append(h('p', { class: 'muted', id: 'door-empty' }, 'No doors on this estimate yet.'));
  doors.forEach((line) => {
    const summary = prehungSummary(cat, line);
    const choose = (patch) => {
      setPrehungChoice(cat, line, patch);
      estimates.persist();
      render(root);
    };
    list.append(h('div', { class: 'door-line', id: 'sheet-door-' + line.id },
      drawingEl(line, 'line-drawing', { boxW: 168, boxH: 220 }),
      h('div', { class: 'qdraw-txt' },
        h('b', {}, line.label || 'Door'),
        h('div', { class: 'muted' }, summary.title),
        h('div', { class: 'fine' }, summary.detail)),
      h('b', { class: 'door-total' }, linePriceText(line)),
      h('button', {
        type: 'button', class: 'x', 'aria-label': 'Remove door',
        onclick: () => {
          estimate.lines = estimate.lines.filter((item) => item.id !== line.id);
          estimates.persist();
          render(root);
        },
      }, icon('x')),
      lineChoices(cat, line, 'door-' + line.id + '-', choose)));
  });
  if (doors.length) {
    const labor = doors.reduce((sum, line) => sum + (Number(line.installUnit) || 0) * (Number(line.qty) || 1), 0);
    list.append(h('div', { class: 'line strong', id: 'door-install' },
      h('span', {}, 'Installation'), h('b', {}, fmt(labor))));
    list.append(h('p', { class: 'fine' }, 'Installation is one combined price for these doors. The estimate rolls it in with any window labor.'));
    list.append(h('a', { class: 'btn', href: '#/estimate', id: 'btn-open-est' }, 'Open estimate'));
  }
  wrap.append(list);
  root.replaceChildren(wrap);
}

function lineChoices(cat, line, idPrefix, onChange) {
  const spec = line.prehung || {};
  const hands = (cat.handings || []).map((hand) => ({ id: hand.id, label: handingOf(hand.id).short }));
  return h('div', { class: 'door-controls' },
    chipRow('', cat.cores, spec.core, (id) => onChange({ core: id }), idPrefix + 'core-'),
    chipRow('', cat.heights, spec.height, (id) => onChange({ height: id }), idPrefix + 'height-'),
    chipRow('', [{ id: 'single', label: 'Single' }, { id: 'double', label: 'Double' }], spec.double ? 'double' : 'single', (id) => onChange({ double: id === 'double' }), idPrefix + 'pair-'),
    chipRow('', stylesFor(cat, spec.core), spec.style, (id) => onChange({ style: id }), idPrefix + 'style-'),
    chipRow('', hands, line.handing, (id) => { line.handing = id; onChange({}); }, idPrefix + 'hand-'));
}

function chipRow(label, items, current, onPick, idPrefix) {
  return h('div', {},
    label ? h('div', { class: 'lbl' }, label) : null,
    h('div', { class: 'chips' }, (items || []).map((item) => h('button', {
      type: 'button',
      class: 'chip pick' + (item.id === current ? ' on' : ''),
      id: idPrefix + item.id,
      onclick: () => onPick(item.id),
    }, item.label || item.name))));
}

function focusRoom() {
  requestAnimationFrame(() => {
    const el = document.getElementById('in-label');
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    el.scrollIntoView({ block: 'center' });
  });
}

function addDoor(root) {
  const cat = catalog();
  const location = String(draft.label || '').trim();
  if (!location || !draft.widthId || !draft.handing) return;
  const estimate = estimates.current();
  const sheet = sheetOf(estimate);
  estimate.prehung = sheet;
  rememberSheet(sheet);
  const line = applyPrehungSheet(cat, { id: uid(), label: location, handing: draft.handing, qty: 1 }, sheet);
  setPrehungWidth(cat, line, draft.widthId);
  estimate.lines.push(line);
  estimates.persist();
  saveDraft();
  toast(`${location} added · ${linePriceText(line)}`);
  render(root);
  focusRoom();
}

export function prehungEstimateRow(line, idx, estimate, { save, rerender, open }) {
  const cat = catalog();
  const summary = prehungSummary(cat, line);
  const isOpen = open.has(line.id);
  const row = h('div', { class: 'lineitem', id: 'door-line-' + line.id },
    h('div', { class: 'li-main' },
      drawingEl(line, 'line-drawing', { boxW: 168, boxH: 142 }),
      h('div', { class: 'li-text' },
        h('b', {}, line.label || 'Door'),
        h('div', { class: 'muted' }, summary.title),
        h('div', { class: 'fine' }, summary.detail)),
      h('div', { class: 'li-price' }, h('b', { id: 'li-price-' + line.id }, linePriceText(line)))),
    h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn sm', onclick: () => { isOpen ? open.delete(line.id) : open.add(line.id); rerender(); } }, isOpen ? 'Done' : 'Edit'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => {
        const copy = JSON.parse(JSON.stringify(line));
        copy.id = uid();
        estimate.lines.splice(idx + 1, 0, copy);
        save();
        rerender();
      } }, 'Copy'),
      h('button', { type: 'button', class: 'btn sm danger', onclick: () => { estimate.lines.splice(idx, 1); save(); rerender(); } }, 'Remove')));
  if (isOpen) {
    const setLabel = (value) => {
      line.label = value;
      const title = row.querySelector('.li-text b');
      if (title) title.textContent = value;
      save();
    };
    row.append(h('div', { class: 'edit' },
      h('label', { class: 'field room-label' }, h('span', { class: 'lbl' }, 'Room / location'), h('input', {
        type: 'text', id: 'room-' + line.id, value: line.label || '',
        autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
        oninput: (ev) => setLabel(ev.target.value),
      })),
      chipRow('Width', cat?.widths, line.widthId, (id) => { setPrehungWidth(cat, line, id); save(); rerender(); }, 'edit-width-' + line.id + '-'),
      lineChoices(cat, line, 'edit-' + line.id + '-', (patch) => {
        if (patch && Object.keys(patch).length) setPrehungChoice(cat, line, patch);
        save();
        rerender();
      }),
      h('p', { class: 'fine' }, 'Jamb, options, and labor are set on Prehung Doors and apply to every door. The price uses this door’s height and core.')));
  }
  return row;
}
