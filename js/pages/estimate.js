import { h, fmt, esc, data, settings, typeName, colorById, brandById, priceWindow, installUnit, addonNames, installLabel, defaultInstall, estimates, totals, summaryLines, stuccoState, windowCount, findPromo, parsePercentDiscount, toast, uid, lineOptionNames, compactWindowLine, windowSections, needsFrameWarning, FRAME_TYPE_WARNING, browserOffline, OFFLINE_MESSAGE, captureView, restoreView, linePriceText, PRICE_PENDING_LABEL, seriesColorIds, sizeLimitText, isIntegralType, FLUSH_FIN_NOTE } from '../core.js';
import { isMilgardDoorLine, doorColorLabel, PENDING_WINDOW_STYLES } from '../milgard.js';
import { doorInstallEditor, milgardLineEditor } from './milgard-ui.js';
import { markPresented, preparePresented, applyHubspotChoice, userId, refreshEstimates, sendEstimateEmail, canSeeAllEstimates, isAdmin } from '../cloud.js';
import { contractPay, makeEstimatePdf } from '../pdf.js';
import { icon } from '../icons.js';
import { stepper, installEditor, upgradeEditor, customPriceFields } from './calculator.js';
import { drawingEl } from '../drawings.js';

const open = new Set(); // line ids being edited
const promoUi = { forId: null, draft: '', dirty: false, error: '' };
const pctUi = { forId: null, draft: '', dirty: false, error: '' };
const hubUi = { estimateId: null, matches: [], autoId: null, busy: false, intent: null };
const sendUi = { busy: false, error: '', confirm: '' };
const fdate = (t) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

function lineDesc(l) {
  const custom = l.customDescription ? `${l.customDescription} — ` : '';
  const mull = Number(l.unitsPerLine) > 1 ? ` · ${l.unitsPerLine} units` : '';
  const color = isMilgardDoorLine(l) ? (doorColorLabel(l.series, l.color) || colorById(l.color)?.name || l.color) : (colorById(l.color)?.name || l.color);
  const head = l.shape === 'eyebrow' ? ' eyebrow' : '';
  return `${custom}${brandById(l.brand)?.name || l.brand} ${l.series} ${typeName(l.type)}${head}, ${color}${mull}`;
}
function optNames(l) { return lineOptionNames(l); }
function lineFlags(l) {
  const flags = [];
  if (l.provisional) flags.push(h('div', { class: 'provisional-flag', id: 'provisional-' + (l.id || 'line') }, 'Provisional price'));
  if ((l.addons || []).includes('flush_fin_trim')) flags.push(h('div', { class: 'note flush-fin-note', id: 'flush-fin-' + (l.id || 'line') }, FLUSH_FIN_NOTE));
  return flags;
}
export function compactWindowList(lines, { always = false, id = 'compact-windows' } = {}) {
  const root = h('div', { class: 'sh-compact' + (always ? ' always' : ''), id });
  for (const section of windowSections(lines)) {
    root.append(h('div', { class: 'sh-brand' }, section.brandName));
    for (const l of section.lines) {
      const row = compactWindowLine(l);
      root.append(h('div', { class: 'win-card' },
        drawingEl(l, 'win-drawing', { boxW: 132, boxH: 112 }),
        h('div', { class: 'win-copy' },
          h('div', { class: 'win-top' }, h('span', { class: 'win-title' }, row.title), h('b', { class: 'win-price' + (row.priceText ? ' pending-price' : '') }, row.priceText || fmt(row.price))),
          h('div', { class: 'win-sub' }, row.detail))));
    }
  }
  return root;
}
function paintSize(l) {
  const err = document.getElementById('size-err-edit-' + l.id);
  if (err) {
    err.textContent = l.sizeError || '';
    err.hidden = !l.sizeError;
  }
  const rowErr = document.getElementById('size-err-' + l.id);
  if (rowErr) {
    rowErr.textContent = l.sizeError || '';
    rowErr.hidden = !l.sizeError;
  }
  const price = document.getElementById('li-price-' + l.id);
  if (price) price.textContent = linePriceText(l);
}
function reprice(l) {
  if (isIntegralType(l)) l.unitsPerLine = 1;
  const p = priceWindow(l);
  if (p && !p.blocked && p.unit != null) {
    l.unitBase = p.unitBase; l.optionsEach = p.optionsEach; l.unit = p.unit; l.rate = p.rate; l.rateSet = settings.rateSet; l.estimated = p.estimated; l.pricingMode = p.mode; l.pricePending = !!p.pricePending;
    l.provisional = !!p.provisional; l.unavailable = false;
    l.unpriced = false; l.sizeError = '';
  } else {
    l.unitBase = 0; l.optionsEach = 0; l.unit = 0; l.pricePending = false; l.provisional = false;
    l.unavailable = !!(p && p.unavailable);
    l.unpriced = !!(p && p.blocked);
    l.sizeError = p?.unavailable ? 'Not available' : (p?.blocked ? p.errors.join(' ') : '');
  }
  l.installUnit = installUnit(l.install, l);
}
const MILGARD_OPTION_TYPES = ['hslider', 'xox', 'vslider', 'picture', 'casement', 'awning', ...PENDING_WINDOW_STYLES];
function usesMilgardEditor(l) {
  return l.pricingMode === 'onelink' || (l.brand === 'milgard' && (isMilgardDoorLine(l) || MILGARD_OPTION_TYPES.includes(l.type)));
}
async function presentEstimate(rerender) {
  if (hubUi.busy) return;
  hubUi.busy = true;
  const current = estimates.current();
  try {
    const prep = await preparePresented(current);
    if (!prep.ok) return;
    if (!prep.ready) {
      hubUi.estimateId = current.id;
      hubUi.matches = prep.matches || [];
      hubUi.autoId = prep.autoId || null;
      return;
    }
    hubUi.estimateId = null;
    await markPresented(current);
  } finally {
    hubUi.busy = false;
    rerender();
  }
}

async function confirmHubspot(e, choice, rerender) {
  if (hubUi.busy) return;
  hubUi.busy = true;
  const sending = hubUi.intent === 'send';
  try {
    applyHubspotChoice(e, choice);
    hubUi.estimateId = null;
    hubUi.matches = [];
    hubUi.intent = null;
    if (sending) await deliverEstimate(e, rerender);
    else await markPresented(e);
  } finally {
    hubUi.busy = false;
    rerender();
  }
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) bin += String.fromCharCode(...bytes.subarray(i, i + size));
  return btoa(bin);
}

async function deliverEstimate(e, rerender) {
  if (sendUi.busy) return;
  sendUi.busy = true;
  sendUi.error = '';
  rerender();
  try {
    const pdfBase64 = await blobToBase64(await makeEstimatePdf(e));
    const sent = await sendEstimateEmail(e, pdfBase64);
    if (!sent.ok) {
      sendUi.error = sent.error || 'Email failed. The estimate was not marked presented.';
      toast(sendUi.error);
      return;
    }
    const who = sent.data?.sent_to || e.customer?.email || '';
    if (e.status === 'signed') {
      estimates.save(e);
      toast(`Emailed ${who}.`);
      return;
    }
    const hub = await markPresented(e, { followUp: true, quiet: true });
    if (hub?.ok && hub.data?.task_error) toast(`Emailed ${who}. The follow-up task was not created.`);
    else if (hub?.ok) toast(`Emailed ${who} and marked presented.`);
    else toast(`Emailed ${who} and marked presented. HubSpot sync is not available yet.`);
  } catch (err) {
    console.error(err);
    sendUi.error = 'Email failed. The estimate was not marked presented.';
    toast(sendUi.error);
  } finally {
    sendUi.busy = false;
    rerender();
  }
}

function askToSend(e, rerender) {
  if (browserOffline()) {
    sendUi.error = OFFLINE_MESSAGE;
    toast(sendUi.error);
    rerender();
    return;
  }
  const email = String(e.customer?.email || '').trim();
  if (!email || !email.includes('@')) {
    sendUi.error = 'Enter the client email before sending.';
    toast(sendUi.error);
    rerender();
    return;
  }
  sendUi.error = '';
  sendUi.confirm = email;
  rerender();
}

async function confirmedSend(e, rerender) {
  if (hubUi.busy || sendUi.busy) return;
  sendUi.confirm = '';
  hubUi.busy = true;
  rerender();
  try {
    const prep = await preparePresented(e);
    if (!prep.ok) return;
    if (!prep.ready) {
      hubUi.intent = 'send';
      hubUi.estimateId = e.id;
      hubUi.matches = prep.matches || [];
      hubUi.autoId = prep.autoId || null;
      return;
    }
    await deliverEstimate(e, rerender);
  } finally {
    hubUi.busy = false;
    rerender();
  }
}

function hubspotPicker(e, rerender) {
  if (hubUi.estimateId !== e.id || !hubUi.matches.length) return null;
  return h('div', { class: 'modal', id: 'hubspot-match' },
    h('div', { class: 'modal-card hubspot-match' },
      h('h3', {}, 'HubSpot lead'),
      h('p', { class: 'muted' }, hubUi.intent === 'send'
        ? 'A similar contact is already in HubSpot. Confirm that lead before the estimate is emailed.'
        : 'A similar contact is already in HubSpot. Confirm that lead, or start a new one.'),
      ...hubUi.matches.map((m) => h('div', { class: 'match' + (m.id === hubUi.autoId ? ' best' : '') },
        h('b', {}, m.name || 'Unnamed contact'),
        h('span', { class: 'fine' }, m.confident ? ' Likely match' : ' Possible match'),
        h('div', {}, m.phone || 'No phone'),
        h('div', {}, m.email || 'No email'),
        m.deal
          ? h('div', { class: 'fine' }, `Open deal: ${m.deal.name || m.deal.id}${m.deal.amount ? ' · $' + m.deal.amount : ''}`)
          : h('div', { class: 'fine' }, 'No open deal yet. A new deal will be created.'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => confirmHubspot(e, { match: m }, rerender) }, 'Use this lead'))),
      h('button', { type: 'button', class: 'btn', id: 'hubspot-new-lead', onclick: () => confirmHubspot(e, { createNew: true, matches: hubUi.matches }, rerender) }, 'New lead')));
}

export function render(root) {
  sendUi.confirm = '';
  const view = captureView();
  const e = estimates.current();
  e.extras ||= [];
  e.stuccoRepair ||= { on: false, qty: null };
  e.promoCode ??= '';
  e.percentDiscount ??= 0;
  if (promoUi.forId !== e.id) { promoUi.forId = e.id; promoUi.draft = e.promoCode; promoUi.dirty = false; promoUi.error = ''; }
  if (pctUi.forId !== e.id) { pctUi.forId = e.id; pctUi.draft = e.percentDiscount ? String(e.percentDiscount) : ''; pctUi.dirty = false; pctUi.error = ''; }
  const wrap = h('div', { class: 'page est' });
  const save = () => { estimates.persist(); };
  const rerender = () => render(root);

  const signed = e.status === 'signed' || (e.contract?.signatures?.p1a && e.contract?.signatures?.p1b);
  const statusWord = e.status === 'signed' ? 'Signed' : e.status === 'presented' ? 'Presented' : 'Draft';
  wrap.append(h('div', { class: 'row between wrap' }, h('div', {}, h('h1', {}, 'Estimate'), h('div', { class: 'muted' }, `${e.number} · ${fdate(e.created)} · ${statusWord}`), signed ? h('div', { class: 'fine', id: 'agreement-signed' }, 'Agreement signed') : null),
    h('div', { class: 'row wrap gap' },
      h('button', { class: 'btn', onclick: () => { estimates.startNew(); rerender(); } }, icon('plus'), 'New'),
      h('button', { class: 'btn', onclick: () => { if (!e.lines.length && !e.customer.name && !(e.overlays || []).length) return toast('Nothing to duplicate yet'); save(); estimates.duplicate(e.id); toast('Duplicated'); rerender(); } }, 'Duplicate'),
      h('button', { type: 'button', class: 'btn', id: 'btn-presented', disabled: e.status === 'signed' || hubUi.busy ? true : null, onclick: () => presentEstimate(rerender) }, 'Mark presented'),
      h('a', { class: 'btn', id: 'btn-contract', href: '#/estimate/contract' }, 'Agreement'),
      h('a', { class: 'btn', id: 'btn-print', href: '#/estimate/print' }, 'Print / PDF'))));
  wrap.append(h('a', { class: 'btn primary xl', id: 'btn-present', href: '#/estimate/present' }, 'Present'));
  const picker = hubspotPicker(e, rerender);
  if (picker) wrap.append(picker);

  // customer
  const cf = (key, label, type = 'text', ph = '') => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type, id: 'c-' + key, value: e.customer[key], placeholder: ph, autocomplete: 'off', oninput: (ev) => { e.customer[key] = ev.target.value; if (!e.hubspotContactId) delete e.hubspotChoice; save(); } }));
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Customer'), h('div', { class: 'cols2' }, cf('name', 'Name'), cf('phone', 'Phone', 'tel'), cf('email', 'Email', 'email'), cf('address', 'Job address'))));

  // lines
  const lines = h('div', { class: 'card' }, h('h3', {}, 'Windows'));
  if (e.lines.some((l) => l.pricePending)) lines.append(h('p', { class: 'warn', id: 'price-pending-banner' }, 'One or more windows say Price pending. That is a placeholder, not a OneLink price, and it is left out of the total until a real rate is entered.'));
  if (e.lines.some((l) => l.unpriced)) lines.append(h('p', { class: 'warn', id: 'size-block-banner' }, 'One or more Andersen sizes are outside the iQ limits and are not priced. Change the size before presenting this estimate.'));
  if (!e.lines.length) lines.append(h('p', { class: 'muted' }, 'No windows yet. ', h('a', { href: '#/calculator' }, 'Add one from the calculator →')));
  e.lines.forEach((l, idx) => {
    const isOpen = open.has(l.id);
    const row = h('div', { class: 'lineitem' },
      h('div', { class: 'li-main' },
        drawingEl(l, 'line-drawing', { boxW: 168, boxH: 142 }),
        h('div', { class: 'li-text' }, h('b', {}, l.label), h('div', { class: 'muted' }, `${lineDesc(l)} · ${l.w}" × ${l.h}"`), optNames(l).length ? h('div', { class: 'fine' }, optNames(l).join(' · ')) : null,
          h('div', { class: 'fine' }, `Install: ${installLabel(l.install, l)}`),
          needsFrameWarning(l) ? h('div', { class: 'warn frame-warn', id: 'frame-warn-' + l.id }, FRAME_TYPE_WARNING) : null,
          l.sizeError ? h('div', { class: 'warn size-err', id: 'size-err-' + l.id }, l.sizeError) : null,
          addonNames(l.install, l).length ? h('div', { class: 'fine' }, `Add-ons: ${addonNames(l.install, l).join(', ')}`) : null,
          ...lineFlags(l)),
        h('div', { class: 'li-price' }, h('b', { id: 'li-price-' + l.id, class: (l.pricePending || l.unpriced || l.unavailable) ? 'pending-price' : '' }, linePriceText(l)))),
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn sm', onclick: () => { isOpen ? open.delete(l.id) : open.add(l.id); rerender(); } }, isOpen ? 'Done' : 'Edit'),
        h('button', { class: 'btn sm', onclick: () => { const c = JSON.parse(JSON.stringify(l)); c.id = uid(); e.lines.splice(idx + 1, 0, c); save(); rerender(); } }, 'Copy'),
        h('button', { class: 'btn sm danger', onclick: () => { e.lines.splice(idx, 1); save(); rerender(); } }, 'Remove')));
      if (isOpen) {
      const upd = (full) => { reprice(l); save(); full ? rerender() : refreshTotals(); };
      const seriesDef = brandById(l.brand)?.series?.find((s) => s.id === l.series);
      row.append(h('div', { class: 'edit' },
        seriesDef && h('b', {}, 'Window type'),
        seriesDef && h('div', { class: 'chips' }, [...seriesDef.types, 'custom_supplier'].map((t) => h('button', { type: 'button', class: 'chip' + (t === l.type ? ' on' : ''), onclick: () => {
          l.type = t;
          const nextColors = seriesColorIds(l.brand, l.series, t);
          if (nextColors.length && !nextColors.includes(l.color)) l.color = nextColors[0];
          if (isIntegralType(l)) l.unitsPerLine = 1;
          upd(true);
        } }, typeName(t)))),
        h('div', { class: 'room-size' },
          h('label', { class: 'field room-label' }, h('span', { class: 'lbl' }, 'Room / label'), h('input', {
            type: 'text', id: 'room-' + l.id, value: l.label || '', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
            oninput: (ev) => {
              l.label = ev.target.value;
              const title = row.querySelector('.li-text b');
              if (title) title.textContent = ev.target.value;
              save();
            },
          })),
          h('div', { class: 'grid3' }, stepper(isMilgardDoorLine(l) ? 'Net frame width' : 'Width', l.w, (v) => { l.w = parseFloat(v) || 0; reprice(l); save(); refreshTotals(); paintSize(l); }, { unit: 'in', pattern: '[0-9]*[.]?[0-9]*' }), stepper(isMilgardDoorLine(l) ? 'Net frame height' : 'Height', l.h, (v) => { l.h = parseFloat(v) || 0; reprice(l); save(); refreshTotals(); paintSize(l); }, { unit: 'in', pattern: '[0-9]*[.]?[0-9]*' }), stepper('Qty', l.qty, (v) => { l.qty = parseInt(v) || 1; reprice(l); save(); refreshTotals(); syncStuccoQty(); }, { min: 1 }))),
        sizeLimitText(l) ? h('p', { class: 'fine' }, sizeLimitText(l)) : null,
        h('p', { class: 'warn size-err', id: 'size-err-edit-' + l.id, hidden: l.sizeError ? null : true }, l.sizeError || ''),
        isIntegralType(l)
          ? h('p', { class: 'fine' }, 'This twin is priced as one combined unit at the overall size. Use quantity for a second twin.')
          : stepper('Units in this line', l.unitsPerLine || 1, (v) => { l.unitsPerLine = parseInt(v, 10) || 1; reprice(l); save(); refreshTotals(); }, { min: 1 }),
        customPriceFields(l, () => { reprice(l); save(); refreshTotals(); }, 'li-' + l.id),
        seriesDef && !isMilgardDoorLine(l) && h('b', {}, 'Frame color'),
        seriesDef && !isMilgardDoorLine(l) && h('div', { class: 'swatches' }, seriesColorIds(l.brand, l.series, l.type).map((c) => { const cd = colorById(c); return h('button', { type: 'button', class: 'swatch' + (c === l.color ? ' on' : ''), onclick: () => { l.color = c; upd(true); } }, h('i', { style: cd ? `background:${cd.swatch}` : '' }), h('span', {}, cd?.name || c)); })),
        usesMilgardEditor(l)
          ? milgardLineEditor(l, () => { reprice(l); save(); rerender(); }, 'opt-' + l.id + '-')
          : upgradeEditor(l, () => { reprice(l); save(); rerender(); }, 'opt-' + l.id + '-'),
        h('b', {}, 'Installation'),
        isMilgardDoorLine(l)
          ? doorInstallEditor(l, (full) => { reprice(l); save(); full ? rerender() : refreshTotals(); }, 'li-' + l.id + '-')
          : installEditor(l.install, (full) => { reprice(l); save(); full ? rerender() : refreshTotals(); }, 'li-' + l.id, l),
        h('button', { class: 'btn primary', onclick: () => { reprice(l); save(); open.delete(l.id); rerender(); } }, 'Save line')));
    }
    lines.append(row);
  });
  lines.append(h('a', { class: 'btn', href: '#/calculator' }, '+ Add window'));
  wrap.append(lines);

  const stDef = data.install.stuccoRepair || { name: 'Stucco repair & paint', price: 650 };
  const stNow = stuccoState(e);
  function syncStuccoQty() {
    if (!e.stuccoRepair.on || e.stuccoRepair.qty != null) return;
    const input = document.getElementById('stucco-qty');
    const next = windowCount(e);
    if (input && document.activeElement !== input) input.value = String(next);
    const lab = document.getElementById('stucco-line-total');
    const live = stuccoState(e);
    if (lab) lab.textContent = fmt(live.total);
    const qtyLbl = document.getElementById('stucco-qty-lbl');
    if (qtyLbl) qtyLbl.textContent = `${live.qty} × ${fmt(live.unit)}`;
  }
  const stuccoCard = h('div', { class: 'card', id: 'stucco-card' },
    h('h3', {}, stDef.name),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', id: 'stucco-on', checked: e.stuccoRepair.on ? 'checked' : null, onchange: (ev) => { e.stuccoRepair.on = ev.target.checked; save(); rerender(); } }),
      h('span', {}, `Include ${stDef.name}`),
      h('em', {}, ` ${fmt(stDef.price)} / window`)),
    e.stuccoRepair.on && h('div', { class: 'grid2' },
      stepper('Quantity', stNow.qty, (v) => {
        e.stuccoRepair.qty = v === '' ? 0 : (parseInt(v, 10) || 0);
        save();
        const live = stuccoState(e);
        const lab = document.getElementById('stucco-line-total');
        if (lab) lab.textContent = fmt(live.total);
        const qtyLbl = document.getElementById('stucco-qty-lbl');
        if (qtyLbl) qtyLbl.textContent = `${live.qty} × ${fmt(live.unit)}`;
        refreshTotals();
      }, { min: 0, step: 1, id: 'stucco-qty' }),
      h('div', { class: 'line' }, h('span', { id: 'stucco-qty-lbl' }, `${stNow.qty} × ${fmt(stNow.unit)}`), h('b', { id: 'stucco-line-total' }, fmt(stNow.total)))),
    h('p', { class: 'fine' }, e.stuccoRepair.on && e.stuccoRepair.qty == null
      ? 'Quantity starts at the window count and follows it until you change it. Promo codes do not apply.'
      : 'Optional. Promo codes do not apply to stucco repair.'));
  wrap.append(stuccoCard);

  // job extras
  const ex = h('div', { class: 'card' }, h('h3', {}, 'Additional job items (permit, haul-away, trim…)'));
  e.extras.forEach((x, i) => ex.append(h('div', { class: 'row gap nowrap extra' },
    h('input', { type: 'text', value: x.label, 'aria-label': 'Item', oninput: (ev) => { x.label = ev.target.value; save(); } }),
    h('input', { type: 'text', inputmode: 'decimal', class: 'amt', value: x.amount, 'aria-label': 'Amount', oninput: (ev) => { x.amount = ev.target.value.replace(/[^0-9.-]/g, ''); save(); refreshTotals(); } }),
    h('button', { class: 'btn sm danger', 'aria-label': 'Remove item', onclick: () => { e.extras.splice(i, 1); save(); rerender(); } }, icon('x')))));
  ex.append(h('div', { class: 'chips' }, data.install.jobExtras.map((x) => h('button', { class: 'chip', onclick: () => { e.extras.push({ id: uid(), label: x.name, amount: x.amount }); save(); rerender(); } }, '+ ' + x.name)), h('button', { class: 'chip', id: 'btn-custom-extra', onclick: () => { e.extras.push({ id: uid(), label: 'Custom item', amount: 0 }); save(); rerender(); } }, '+ Custom')));
  wrap.append(ex);

  function applyPromo() {
    const raw = (promoUi.dirty ? promoUi.draft : (document.getElementById('promo-code')?.value || '')).trim();
    if (!raw) { e.promoCode = ''; promoUi.draft = ''; promoUi.dirty = false; promoUi.error = ''; save(); rerender(); return; }
    const promo = findPromo(raw);
    if (!promo) { promoUi.draft = raw; promoUi.dirty = true; promoUi.error = 'That code is not valid.'; rerender(); document.getElementById('promo-code')?.focus(); return; }
    e.promoCode = promo.code; promoUi.draft = promo.code; promoUi.dirty = false; promoUi.error = ''; save(); rerender();
  }
  function removePromo() { e.promoCode = ''; promoUi.draft = ''; promoUi.dirty = false; promoUi.error = ''; save(); rerender(); }
  const applied = findPromo(e.promoCode);
  const promoNote = totals(e).promo?.note;
  const promoError = promoUi.error || (e.promoCode && !applied ? 'That code is not valid.' : '');
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Promo code'),
    h('div', { class: 'promo-row' },
      h('input', { type: 'text', id: 'promo-code', value: promoUi.dirty ? promoUi.draft : e.promoCode, placeholder: 'Enter code', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
        oninput: (ev) => { promoUi.draft = ev.target.value; promoUi.dirty = true; promoUi.error = ''; const n = document.getElementById('promo-error'); if (n) n.remove(); },
        onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); applyPromo(); } } }),
      h('button', { type: 'button', class: 'btn', id: 'promo-apply', onclick: applyPromo }, 'Apply')),
    promoError && h('p', { class: 'warn', id: 'promo-error' }, promoError),
    applied && h('div', { class: 'row between wrap gap', id: 'promo-applied' }, h('span', {}, `${applied.code} · ${applied.label}`), h('button', { type: 'button', class: 'btn sm', id: 'promo-remove', onclick: removePromo }, 'Remove')),
    applied && promoNote && h('p', { class: 'fine', id: 'promo-note' }, promoNote),
    h('p', { class: 'fine' }, 'Applies to the window price, including glass. Does not apply to installation, add-ons, stucco repair, shipping, or a custom unit entered at the supplier price. The additional discount below is applied after this code. Sales tax is 9.1% of the materials after both.')));

  function showPercentError(message) {
    pctUi.error = message;
    let node = document.getElementById('percent-discount-error');
    if (!message) { node?.remove(); return; }
    if (!node) {
      node = h('p', { class: 'warn', id: 'percent-discount-error' }, message);
      document.getElementById('percent-discount')?.closest('.card')?.append(node);
    } else node.textContent = message;
  }
  wrap.append(h('div', { class: 'card', id: 'percent-discount-card' },
    h('h3', {}, 'Additional discount'),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Percent off materials (0–10%)'),
      h('input', { type: 'text', inputmode: 'decimal', id: 'percent-discount', placeholder: '0', autocomplete: 'off',
        value: pctUi.dirty ? pctUi.draft : (e.percentDiscount ? String(e.percentDiscount) : ''),
        oninput: (ev) => {
          pctUi.draft = ev.target.value;
          pctUi.dirty = true;
          const parsed = parsePercentDiscount(ev.target.value);
          if (!parsed.ok) { showPercentError(parsed.error); e.percentDiscount = 0; save(); refreshTotals(); return; }
          showPercentError('');
          if (parsed.clamped) { ev.target.value = '0'; pctUi.draft = '0'; }
          e.percentDiscount = parsed.value;
          save();
          refreshTotals();
        } })),
    pctUi.error && h('p', { class: 'warn', id: 'percent-discount-error' }, pctUi.error),
    h('p', { class: 'fine' }, 'Taken off windows and doors after the promo code. 0–10% only. Amounts over 10% are not applied. Labor and the $150 shipping charge are not discounted.')));

  // totals
  const tot = h('div', { class: 'card totals', id: 'totals' });
  function refreshTotals() {
    const t = totals(e);
    const idFor = { windows: 't-win', discount: 't-discount', percentDiscount: 't-pdisc', install: 't-inst', shipping: 't-ship', extras: 't-extras', tax: 't-tax' };
    const pay = contractPay(t.total, payPct());
    tot.replaceChildren(...summaryLines(t).map((row) => h('div', { class: 'line' + (row.discount ? ' discount' : '') }, h('span', { id: row.id === 'discount' ? 't-discount-lbl' : null }, row.id === 'windows' ? `Windows (${t.count})` : row.label), h('b', { id: idFor[row.id] }, fmt(row.amount)))),
      h('div', { class: 'line big2' }, h('span', {}, 'Total'), h('b', { id: 't-total' }, fmt(t.total))),
      h('div', { class: 'line' }, h('span', {}, `Deposit (${payPct()}%)`), h('b', { id: 't-deposit' }, fmt(pay.deposit))),
      h('div', { class: 'line' }, h('span', {}, `Final (${100 - payPct()}%)`), h('b', { id: 't-final' }, fmt(pay.balance))));
  }
  const payPct = () => Number(data.agreement?.depositPct) || 60;
  refreshTotals();
  wrap.append(tot);
  wrap.append(overlayCard(e, save, rerender));
  wrap.append(h('div', { class: 'card' }, h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Notes (shown on estimate)'), h('textarea', { rows: 3, id: 'e-notes', oninput: (ev) => { e.notes = ev.target.value; save(); } }, e.notes)),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Estimate valid for (days)'), h('input', { type: 'text', inputmode: 'numeric', value: e.validDays, oninput: (ev) => { e.validDays = parseInt(ev.target.value) || 30; save(); } }))));
  root.replaceChildren(wrap);
  restoreView(view);
}

function overlayCard(e, save, rerender) {
  const shots = e.overlays || [];
  const card = h('div', { class: 'card', id: 'overlay-card' },
    h('div', { class: 'row between wrap gap' },
      h('h3', {}, 'Window overlays'),
      h('a', { class: 'btn sm', id: 'btn-add-overlay', href: '#/preview' }, 'Add window photo')));
  if (!shots.length) card.append(h('p', { class: 'fine' }, 'A before-and-after photo from Window overlay is saved here and included on the print view and the emailed PDF.'));
  shots.forEach((shot, i) => card.append(h('div', { class: 'ov-shot' },
    h('img', { src: shot.image, alt: shot.caption || 'Window overlay' }),
    h('div', { class: 'row between wrap gap' },
      h('span', {}, shot.caption || 'Window overlay'),
      h('button', { type: 'button', class: 'btn sm danger', onclick: () => { e.overlays.splice(i, 1); save(); rerender(); } }, 'Remove')),
    shot.note ? h('p', { class: 'fine' }, shot.note) : null)));
  return card;
}
function overlaySheet(e) {
  const shots = e.overlays || [];
  if (!shots.length) return null;
  return h('div', { id: 'sh-overlays' },
    h('h3', {}, 'Window overlay'),
    ...shots.map((shot) => h('figure', { class: 'sh-overlay' },
      h('img', { src: shot.image, alt: shot.caption || 'Window overlay' }),
      h('figcaption', {}, shot.caption || 'Window overlay'),
      shot.note ? h('div', { class: 'fine' }, shot.note) : null)));
}
function licenseLines(c) {
  return String(c?.license || '').split('\n').map((s) => s.trim()).filter(Boolean);
}
function estimateSheet(e) {
  const t = totals(e); const c = settings.company;
  const valid = new Date(e.created + (e.validDays || 30) * 86400000);
  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'sh-head' }, h('img', { src: 'assets/noble-logo-trim.png', alt: 'Noble Windows & Doors LLC', class: 'sh-logo' }),
      h('div', { class: 'sh-co' }, h('b', {}, c.name), h('div', {}, c.address), h('div', {}, c.phone), c.email && h('div', {}, c.email), c.website && h('div', {}, c.website), c.hours && h('div', {}, c.hours), ...licenseLines(c).map((line) => h('div', {}, line)))),
    h('h1', { class: 'sh-title' }, 'ESTIMATE'),
    h('div', { class: 'sh-meta' }, h('div', {}, h('b', {}, 'Prepared for'), h('div', {}, e.customer.name || '—'), h('div', {}, e.customer.address), h('div', {}, e.customer.phone), h('div', {}, e.customer.email)),
      h('div', { class: 'r' }, h('div', {}, h('b', {}, 'Estimate #: '), e.number), h('div', {}, h('b', {}, 'Date: '), fdate(e.created)), h('div', {}, h('b', {}, 'Valid through: '), fdate(valid)))));
  const tw = h('table', { class: 'sh-table sh-wide' }, h('thead', {}, h('tr', {}, ['Location', 'Window', 'Size (W × H)', 'Qty', 'Each', 'Total'].map((x, i) => h('th', { class: i > 2 ? 'r' : '' }, x)))));
  const tb = h('tbody'); e.lines.forEach((l) => tb.append(h('tr', {}, h('td', {}, h('b', {}, l.label)), h('td', {}, drawingEl(l, 'sheet-drawing', { boxW: 150, boxH: 128 }), lineDesc(l), optNames(l).length ? h('div', { class: 'fine' }, optNames(l).join(', ')) : null, l.pricePending ? h('div', { class: 'fine' }, PRICE_PENDING_LABEL + ' — not a OneLink price') : null, ...lineFlags(l), l.optionsEach ? h('div', { class: 'fine' }, `Glass upcharge ${fmt(l.optionsEach)} each`) : null), h('td', {}, `${l.w}" × ${l.h}"`), h('td', { class: 'r' }, l.qty), h('td', { class: 'r' }, l.unavailable ? 'Not available' : (l.pricePending ? PRICE_PENDING_LABEL : (l.unpriced ? 'Not priced' : fmt(l.unit)))), h('td', { class: 'r' }, linePriceText(l)))));
  tb.append(h('tr', { class: 'sub' }, h('td', { colspan: 5, class: 'r' }, 'Windows subtotal'), h('td', { class: 'r' }, fmt(t.windows))));
  if (t.promo?.windowAmount) tb.append(h('tr', { class: 'sub discount', id: 'sh-discount' }, h('td', { colspan: 5, class: 'r' }, t.discountLabel), h('td', { class: 'r' }, fmt(-t.promo.windowAmount))));
  if (t.percentDiscountAmount) tb.append(h('tr', { class: 'sub discount', id: 'sh-percent-discount-row' }, h('td', { colspan: 5, class: 'r' }, t.percentDiscountLabel), h('td', { class: 'r' }, fmt(-t.percentDiscountAmount))));
  tw.append(tb);
  const compact = compactWindowList(e.lines, { id: 'sh-compact' });
  const foot = h('div', { class: 'win-foot' });
  const footLine = (label, amount, extra = {}) => h('div', { class: 'win-top' + (extra.discount ? ' discount' : ''), id: extra.id || null }, h('span', {}, label), h('b', {}, fmt(amount)));
  foot.append(footLine('Windows subtotal', t.windows, { id: 'sh-compact-windows' }));
  if (t.promo?.windowAmount) foot.append(footLine(t.discountLabel, -t.promo.windowAmount, { discount: true, id: 'sh-compact-discount' }));
  if (t.percentDiscountAmount) foot.append(footLine(t.percentDiscountLabel, -t.percentDiscountAmount, { discount: true, id: 'sh-compact-percent' }));
  compact.append(foot);
  sheet.append(h('h3', {}, 'Windows (materials, including glass)'), tw, compact);
  if (e.lines.some((l) => l.pricePending)) sheet.append(h('p', { class: 'warn', id: 'sh-price-pending' }, 'Price pending is a placeholder. It is not a OneLink price and it is not included in the total.'));
  if (e.extras.length) {
    const tx = h('table', { class: 'sh-table' }); e.extras.forEach((x) => tx.append(h('tr', {}, h('td', {}, x.label), h('td', { class: 'r' }, fmt(Number(x.amount) || 0)))));
    tx.append(h('tr', { class: 'sub' }, h('td', { class: 'r' }, 'Additional items subtotal'), h('td', { class: 'r' }, fmt(t.extras))));
    sheet.append(h('h3', {}, 'Additional items'), tx);
  }
  const shId = { install: 'sh-labor', shipping: 'sh-shipping', extras: 'sh-extras', tax: 'sh-tax' };
  const pct = Number(data.agreement?.depositPct) || 60;
  const pay = contractPay(t.total, pct);
  sheet.append(h('div', { class: 'sh-totals' },
    ...summaryLines(t, { includeMaterials: false }).map((row) => h('div', { class: 'line' + (row.discount ? ' discount' : ''), id: shId[row.id] }, h('span', {}, row.label), h('b', {}, fmt(row.amount)))),
    h('div', { class: 'line big2' }, h('span', {}, 'TOTAL'), h('b', { id: 'sh-total' }, fmt(t.total))),
    h('div', { class: 'line' }, h('span', {}, `Deposit (${pct}%)`), h('b', { id: 'sh-deposit' }, fmt(pay.deposit))),
    h('div', { class: 'line' }, h('span', {}, `Final (${100 - pct}%)`), h('b', { id: 'sh-final' }, fmt(pay.balance)))));
  if (e.notes) sheet.append(h('h3', {}, 'Notes'), h('p', { class: 'pre' }, e.notes));
  const shots = overlaySheet(e);
  if (shots) sheet.append(shots);
  sheet.append(h('h3', {}, 'Terms'), h('p', { class: 'pre fine' }, settings.terms),
    h('div', { class: 'sig' }, h('div', {}, 'Accepted by (signature) ______________________________'), h('div', {}, 'Date ______________')));
  return sheet;
}
export function renderPrint(root) {
  const e = estimates.current();
  root.replaceChildren(h('div', { class: 'page printpage' },
    h('div', { class: 'noprint row gap wrap safe-top' }, h('a', { class: 'btn', href: '#/estimate' }, icon('arrow'), 'Back to estimate'), h('button', { class: 'btn primary', id: 'btn-do-print', onclick: () => window.print() }, 'Print / Save as PDF'), h('span', { class: 'muted' }, 'On iPad: tap Print, then pinch-out on the preview (or Share → Save to Files) to save a PDF.')), estimateSheet(e)));
}
export function renderPresent(root) {
  const e = estimates.current();
  const rerender = () => renderPresent(root);
  const page = h('div', { class: 'page present-page' },
    h('div', { class: 'noprint present-top safe-top' }, h('a', { class: 'btn sm', id: 'btn-present-back', href: '#/estimate' }, icon('arrow'), 'Estimate')),
    sendUi.error ? h('p', { class: 'warn', id: 'send-error' }, sendUi.error) : null,
    estimateSheet(e),
    h('div', { class: 'present-bar noprint' },
      h('a', { class: 'btn', id: 'btn-accept', href: '#/estimate/contract' }, 'Accept'),
      h('button', { type: 'button', class: 'btn primary', id: 'btn-save-send', disabled: sendUi.busy || hubUi.busy ? true : null, onclick: () => askToSend(e, rerender) }, sendUi.busy ? 'Sending…' : 'Save & Send')));
  if (sendUi.confirm) {
    page.append(h('div', { class: 'modal', id: 'send-confirm' },
      h('div', { class: 'modal-card' },
        h('h3', {}, 'Send estimate'),
        h('p', {}, 'Email this estimate PDF to'),
        h('p', {}, h('b', { id: 'send-confirm-email' }, sendUi.confirm)),
        h('div', { class: 'row gap' },
          h('button', { type: 'button', class: 'btn', id: 'send-cancel', onclick: () => { sendUi.confirm = ''; rerender(); } }, 'Cancel'),
          h('button', { type: 'button', class: 'btn primary', id: 'send-confirm-yes', onclick: () => confirmedSend(e, rerender) }, 'Send')))));
  }
  const picker = hubspotPicker(e, rerender);
  if (picker) page.append(picker);
  root.replaceChildren(page);
}

function ownerLine(x, uid) {
  const name = x.ownerName || '';
  if (!x.ownerId || x.ownerId === uid) return name ? `You · ${name}` : 'You';
  return name || 'Another rep';
}

export function renderList(root) {
  const uid = userId();
  const seeAll = canSeeAllEstimates();
  const all = estimates.list().filter((x) => !x.deletedAt && (seeAll || !uid || !x.ownerId || x.ownerId === uid));
  const cur = estimates.currentId();
  const wrap = h('div', { class: 'page' }, h('div', { class: 'row between wrap gap' }, h('h1', {}, seeAll ? 'Estimates' : 'My estimates'), h('div', { class: 'row gap' },
    h('button', { class: 'btn', id: 'btn-refresh-estimates', onclick: async () => { await refreshEstimates(); renderList(root); } }, 'Refresh'),
    h('button', { class: 'btn primary', onclick: () => { estimates.startNew(); location.hash = '#/estimate'; } }, '+ New estimate'))));
  wrap.append(h('p', { class: 'fine' }, seeAll
    ? 'Each estimate shows the rep who owns it. You can open another rep’s estimate. Changes still save only on your own.'
    : 'Every estimate and signed agreement saves on this device and to your account, including when you are offline. Open one here on any device after you sign in.'));
  if (!all.length) wrap.append(h('div', { class: 'card muted' }, 'No estimates yet. They show up here as you build them.'));
  all.forEach((x) => {
    const t = totals(x);
    const statusWord = x.status === 'signed' ? 'Signed' : x.status === 'presented' ? 'Presented' : 'Draft';
    const mine = !x.ownerId || x.ownerId === uid || isAdmin();
    wrap.append(h('div', { class: 'card lineitem' + (x.id === cur ? ' current' : '') },
      h('div', { class: 'li-main' }, h('div', { class: 'li-text' },
        h('b', {}, x.customer.name || '(no name)'),
        h('div', { class: 'muted', id: 'estimate-owner-' + x.id }, ownerLine(x, uid)),
        h('div', { class: 'muted' }, `${x.number} · ${statusWord} · ${fdate(x.updated)} · ${t.count} window${t.count === 1 ? '' : 's'}${x.promoCode ? ' · ' + x.promoCode : ''}`),
        h('div', { class: 'fine' }, x.customer.address)), h('div', { class: 'li-price' }, h('b', {}, fmt(t.total)))),
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn sm', onclick: () => { estimates.open(x.id); location.hash = '#/estimate'; } }, 'Open'), h('button', { class: 'btn sm', onclick: () => { estimates.duplicate(x.id); location.hash = '#/estimate'; } }, 'Duplicate'),
        mine ? h('button', { class: 'btn sm danger', onclick: () => { if (confirm('Remove this estimate from your list? It is archived, not erased.')) { estimates.remove(x.id); renderList(root); } } }, 'Remove') : null)));
  });
  root.replaceChildren(wrap);
}
