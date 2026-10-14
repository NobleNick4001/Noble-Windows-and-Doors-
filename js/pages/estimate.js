import { h, fmt, esc, data, settings, typeName, colorById, brandById, optionDef, priceWindow, installUnit, addonNames, installLabel, defaultInstall, estimates, totals, summaryLines, stuccoState, windowCount, findPromo, toast, uid, addonName } from '../core.js';
import { markPresented, preparePresented, applyHubspotChoice, userId, refreshEstimates } from '../cloud.js';
import { contractPay } from '../pdf.js';
import { icon, frameKeyFor, stepper, installEditor, upgradeEditor, customPriceFields } from './calculator.js';

const open = new Set(); // line ids being edited
const promoUi = { forId: null, draft: '', dirty: false, error: '' };
const hubUi = { estimateId: null, matches: [], autoId: null, busy: false };
const fdate = (t) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

function lineDesc(l) {
  const custom = l.customDescription ? `${l.customDescription} — ` : '';
  const mull = Number(l.unitsPerLine) > 1 ? ` · ${l.unitsPerLine} units` : '';
  return `${custom}${brandById(l.brand)?.name || l.brand} ${l.series} ${typeName(l.type)}, ${colorById(l.color)?.name || l.color}${mull}`;
}
function optNames(l) {
  const fromOpt = (l.options || []).map((id) => optionDef(id)?.name).filter(Boolean);
  const fromAdd = (l.addons || []).map((id) => addonName(id)).filter((n) => n && !fromOpt.includes(n));
  return [...fromAdd, ...fromOpt];
}
function reprice(l) {
  const p = priceWindow(l);
  if (p) { l.unitBase = p.unitBase; l.optionsEach = p.optionsEach; l.unit = p.unit; l.rate = p.rate; l.rateSet = settings.rateSet; l.estimated = p.estimated; l.pricingMode = p.mode; }
  else { l.unitBase = 0; l.optionsEach = 0; l.unit = 0; }
  l.installUnit = installUnit(l.install);
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
  try {
    applyHubspotChoice(e, choice);
    hubUi.estimateId = null;
    hubUi.matches = [];
    await markPresented(e);
  } finally {
    hubUi.busy = false;
    rerender();
  }
}

export function render(root) {
  const e = estimates.current();
  e.extras ||= [];
  e.stuccoRepair ||= { on: false, qty: null };
  e.promoCode ??= '';
  if (promoUi.forId !== e.id) { promoUi.forId = e.id; promoUi.draft = e.promoCode; promoUi.dirty = false; promoUi.error = ''; }
  const wrap = h('div', { class: 'page est' });
  const save = () => { estimates.persist(); };
  const rerender = () => render(root);

  const signed = e.status === 'signed' || (e.contract?.signatures?.p1a && e.contract?.signatures?.p1b);
  const statusWord = e.status === 'signed' ? 'Signed' : e.status === 'presented' ? 'Presented' : 'Draft';
  wrap.append(h('div', { class: 'row between wrap' }, h('div', {}, h('h1', {}, 'Estimate'), h('div', { class: 'muted' }, `${e.number} · ${fdate(e.created)} · ${statusWord}`), signed ? h('div', { class: 'fine', id: 'agreement-signed' }, 'Agreement signed') : null),
    h('div', { class: 'row wrap gap' },
      h('button', { class: 'btn', onclick: () => { estimates.startNew(); rerender(); } }, '+ New'),
      h('button', { class: 'btn', onclick: () => { if (!e.lines.length && !e.customer.name) return toast('Nothing to duplicate yet'); save(); estimates.duplicate(e.id); toast('Duplicated'); rerender(); } }, 'Duplicate'),
      h('button', { type: 'button', class: 'btn', id: 'btn-presented', disabled: e.status === 'signed' || hubUi.busy ? true : null, onclick: () => presentEstimate(rerender) }, 'Mark presented'),
      h('a', { class: 'btn primary', id: 'btn-contract', href: '#/estimate/contract' }, 'Agreement'),
      h('a', { class: 'btn', id: 'btn-print', href: '#/estimate/print' }, 'Print / PDF'))));

  if (hubUi.estimateId === e.id && hubUi.matches.length) {
    wrap.append(h('div', { class: 'card hubspot-match', id: 'hubspot-match' },
      h('h3', {}, 'HubSpot lead'),
      h('p', { class: 'muted' }, 'A similar contact is already in HubSpot. Confirm that lead, or start a new one.'),
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

  // customer
  const cf = (key, label, type = 'text', ph = '') => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type, id: 'c-' + key, value: e.customer[key], placeholder: ph, autocomplete: 'off', oninput: (ev) => { e.customer[key] = ev.target.value; if (!e.hubspotContactId) delete e.hubspotChoice; save(); } }));
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Customer'), h('div', { class: 'cols2' }, cf('name', 'Name'), cf('phone', 'Phone', 'tel'), cf('email', 'Email', 'email'), cf('address', 'Job address'))));

  // lines
  const lines = h('div', { class: 'card' }, h('h3', {}, 'Windows'));
  if (!e.lines.length) lines.append(h('p', { class: 'muted' }, 'No windows yet. ', h('a', { href: '#/calculator' }, 'Add one from the calculator →')));
  e.lines.forEach((l, idx) => {
    const isOpen = open.has(l.id);
    const row = h('div', { class: 'lineitem' },
      h('div', { class: 'li-main' }, icon(l.type, frameKeyFor(l.color), 'tyicon sm'),
        h('div', { class: 'li-text' }, h('b', {}, l.label), h('div', { class: 'muted' }, `${lineDesc(l)} · ${l.w}" × ${l.h}"`), optNames(l).length ? h('div', { class: 'fine' }, optNames(l).join(' · ')) : null,
          h('div', { class: 'fine' }, `Install: ${installLabel(l.install)}`),
          addonNames(l.install).length ? h('div', { class: 'fine' }, `Add-ons: ${addonNames(l.install).join(', ')}`) : null),
        h('div', { class: 'li-price' }, h('div', {}, `${l.qty} × ${fmt(l.unit)}`), h('b', {}, fmt(l.unit * l.qty)))),
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn sm', onclick: () => { isOpen ? open.delete(l.id) : open.add(l.id); rerender(); } }, isOpen ? 'Done' : 'Edit'),
        h('button', { class: 'btn sm', onclick: () => { const c = JSON.parse(JSON.stringify(l)); c.id = uid(); e.lines.splice(idx + 1, 0, c); save(); rerender(); } }, 'Copy'),
        h('button', { class: 'btn sm danger', onclick: () => { e.lines.splice(idx, 1); save(); rerender(); } }, 'Remove')));
      if (isOpen) {
      const upd = (full) => { reprice(l); save(); full ? rerender() : refreshTotals(); };
      const seriesDef = brandById(l.brand)?.series?.find((s) => s.id === l.series);
      row.append(h('div', { class: 'edit' },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Room / label'), h('input', { type: 'text', value: l.label, oninput: (ev) => { l.label = ev.target.value; save(); } })),
        h('div', { class: 'grid3' }, stepper('Width', l.w, (v) => { l.w = parseFloat(v) || 0; reprice(l); save(); refreshTotals(); }, { unit: 'in' }), stepper('Height', l.h, (v) => { l.h = parseFloat(v) || 0; reprice(l); save(); refreshTotals(); }, { unit: 'in' }), stepper('Qty', l.qty, (v) => { l.qty = parseInt(v) || 1; reprice(l); save(); refreshTotals(); syncStuccoQty(); }, { min: 1 })),
        stepper('Units in this line', l.unitsPerLine || 1, (v) => { l.unitsPerLine = parseInt(v, 10) || 1; reprice(l); save(); refreshTotals(); }, { min: 1 }),
        customPriceFields(l, () => { reprice(l); save(); refreshTotals(); }, 'li-' + l.id),
        seriesDef && h('b', {}, 'Window type'),
        seriesDef && h('div', { class: 'chips' }, [...seriesDef.types, 'custom_supplier'].map((t) => h('button', { type: 'button', class: 'chip' + (t === l.type ? ' on' : ''), onclick: () => { l.type = t; upd(true); } }, typeName(t)))),
        seriesDef && h('b', {}, 'Frame color'),
        seriesDef && h('div', { class: 'swatches' }, seriesDef.colors.map((c) => { const cd = colorById(c); return h('button', { type: 'button', class: 'swatch' + (c === l.color ? ' on' : ''), onclick: () => { l.color = c; upd(true); } }, h('i', { style: cd ? `background:${cd.swatch}` : '' }), h('span', {}, cd?.name || c)); })),
        upgradeEditor(l, () => { reprice(l); save(); rerender(); }, 'opt-' + l.id + '-'),
        h('b', {}, 'Installation'), installEditor(l.install, (full) => { reprice(l); save(); full ? rerender() : refreshTotals(); }, 'li-' + l.id),
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
    h('button', { class: 'btn sm danger', onclick: () => { e.extras.splice(i, 1); save(); rerender(); } }, '✕'))));
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
    h('p', { class: 'fine' }, 'Applies to the window price, including glass. Does not apply to installation, add-ons, stucco repair, shipping, or a custom unit entered at the supplier price. Sales tax is 9.1% of the materials after this discount.')));

  // totals
  const tot = h('div', { class: 'card totals', id: 'totals' });
  function refreshTotals() {
    const t = totals(e);
    const idFor = { windows: 't-win', discount: 't-discount', install: 't-inst', shipping: 't-ship', extras: 't-extras', tax: 't-tax' };
    const pay = contractPay(t.total, payPct());
    tot.replaceChildren(...summaryLines(t).map((row) => h('div', { class: 'line' + (row.discount ? ' discount' : '') }, h('span', { id: row.id === 'discount' ? 't-discount-lbl' : null }, row.id === 'windows' ? `Windows (${t.count})` : row.label), h('b', { id: idFor[row.id] }, fmt(row.amount)))),
      h('div', { class: 'line big2' }, h('span', {}, 'Total'), h('b', { id: 't-total' }, fmt(t.total))),
      h('div', { class: 'line' }, h('span', {}, `Deposit (${payPct()}%)`), h('b', { id: 't-deposit' }, fmt(pay.deposit))),
      h('div', { class: 'line' }, h('span', {}, `Final (${100 - payPct()}%)`), h('b', { id: 't-final' }, fmt(pay.balance))));
  }
  const payPct = () => Number(data.agreement?.depositPct) || 65;
  refreshTotals();
  wrap.append(tot);
  wrap.append(h('div', { class: 'card' }, h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Notes (shown on estimate)'), h('textarea', { rows: 3, id: 'e-notes', oninput: (ev) => { e.notes = ev.target.value; save(); } }, e.notes)),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Estimate valid for (days)'), h('input', { type: 'text', inputmode: 'numeric', value: e.validDays, oninput: (ev) => { e.validDays = parseInt(ev.target.value) || 30; save(); } }))));
  root.replaceChildren(wrap);
}

function licenseLines(c) {
  return String(c?.license || '').split('\n').map((s) => s.trim()).filter(Boolean);
}
export function renderPrint(root) {
  const e = estimates.current(); const t = totals(e); const c = settings.company;
  const valid = new Date(e.created + (e.validDays || 30) * 86400000);
  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'sh-head' }, h('img', { src: 'assets/noble-logo-trim.png', alt: 'Noble Windows & Doors LLC', class: 'sh-logo' }),
      h('div', { class: 'sh-co' }, h('b', {}, c.name), h('div', {}, c.address), h('div', {}, c.phone), c.email && h('div', {}, c.email), c.website && h('div', {}, c.website), c.hours && h('div', {}, c.hours), ...licenseLines(c).map((line) => h('div', {}, line)))),
    h('h1', { class: 'sh-title' }, 'ESTIMATE'),
    h('div', { class: 'sh-meta' }, h('div', {}, h('b', {}, 'Prepared for'), h('div', {}, e.customer.name || '—'), h('div', {}, e.customer.address), h('div', {}, e.customer.phone), h('div', {}, e.customer.email)),
      h('div', { class: 'r' }, h('div', {}, h('b', {}, 'Estimate #: '), e.number), h('div', {}, h('b', {}, 'Date: '), fdate(e.created)), h('div', {}, h('b', {}, 'Valid through: '), fdate(valid)))));
  // windows table
  const tw = h('table', { class: 'sh-table' }, h('thead', {}, h('tr', {}, ['Location', 'Window', 'Size (W × H)', 'Qty', 'Each', 'Total'].map((x, i) => h('th', { class: i > 2 ? 'r' : '' }, x)))));
  const tb = h('tbody'); e.lines.forEach((l) => tb.append(h('tr', {}, h('td', {}, h('b', {}, l.label)), h('td', {}, lineDesc(l), optNames(l).length ? h('div', { class: 'fine' }, optNames(l).join(', ')) : null, l.optionsEach ? h('div', { class: 'fine' }, `Glass upcharge ${fmt(l.optionsEach)} each`) : null), h('td', {}, `${l.w}" × ${l.h}"`), h('td', { class: 'r' }, l.qty), h('td', { class: 'r' }, fmt(l.unit)), h('td', { class: 'r' }, fmt(l.unit * l.qty)))));
  tb.append(h('tr', { class: 'sub' }, h('td', { colspan: 5, class: 'r' }, 'Windows subtotal'), h('td', { class: 'r' }, fmt(t.windows))));
  if (t.promo?.windowAmount) tb.append(h('tr', { class: 'sub discount', id: 'sh-discount' }, h('td', { colspan: 5, class: 'r' }, t.discountLabel), h('td', { class: 'r' }, fmt(-t.promo.windowAmount))));
  tw.append(tb);
  sheet.append(h('h3', {}, 'Windows (materials, including glass)'), tw);
  if (e.extras.length) {
    const tx = h('table', { class: 'sh-table' }); e.extras.forEach((x) => tx.append(h('tr', {}, h('td', {}, x.label), h('td', { class: 'r' }, fmt(Number(x.amount) || 0)))));
    tx.append(h('tr', { class: 'sub' }, h('td', { class: 'r' }, 'Additional items subtotal'), h('td', { class: 'r' }, fmt(t.extras))));
    sheet.append(h('h3', {}, 'Additional items'), tx);
  }
  const shId = { windows: 'sh-windows', discount: 'sh-discount-total', install: 'sh-labor', shipping: 'sh-shipping', extras: 'sh-extras', tax: 'sh-tax' };
  const pct = Number(data.agreement?.depositPct) || 65;
  const pay = contractPay(t.total, pct);
  sheet.append(h('div', { class: 'sh-totals' },
    ...summaryLines(t).map((row) => h('div', { class: 'line' + (row.discount ? ' discount' : ''), id: shId[row.id] }, h('span', {}, row.label), h('b', {}, fmt(row.amount)))),
    h('div', { class: 'line big2' }, h('span', {}, 'TOTAL'), h('b', { id: 'sh-total' }, fmt(t.total))),
    h('div', { class: 'line' }, h('span', {}, `Deposit (${pct}%)`), h('b', { id: 'sh-deposit' }, fmt(pay.deposit))),
    h('div', { class: 'line' }, h('span', {}, `Final (${100 - pct}%)`), h('b', { id: 'sh-final' }, fmt(pay.balance)))));
  if (e.notes) sheet.append(h('h3', {}, 'Notes'), h('p', { class: 'pre' }, e.notes));
  sheet.append(h('h3', {}, 'Terms'), h('p', { class: 'pre fine' }, settings.terms),
    h('div', { class: 'sig' }, h('div', {}, 'Accepted by (signature) ______________________________'), h('div', {}, 'Date ______________')));
  root.replaceChildren(h('div', { class: 'page printpage' },
    h('div', { class: 'noprint row gap wrap' }, h('a', { class: 'btn', href: '#/estimate' }, '← Back to estimate'), h('button', { class: 'btn primary', id: 'btn-do-print', onclick: () => window.print() }, 'Print / Save as PDF'), h('span', { class: 'muted' }, 'On iPad: tap Print, then pinch-out on the preview (or Share → Save to Files) to save a PDF.')), sheet));
}

export function renderList(root) {
  const uid = userId();
  const all = estimates.list().filter((x) => !x.deletedAt && (!uid || !x.ownerId || x.ownerId === uid));
  const cur = estimates.currentId();
  const wrap = h('div', { class: 'page' }, h('div', { class: 'row between wrap gap' }, h('h1', {}, 'My estimates'), h('div', { class: 'row gap' },
    h('button', { class: 'btn', id: 'btn-refresh-estimates', onclick: async () => { await refreshEstimates(); renderList(root); } }, 'Refresh'),
    h('button', { class: 'btn primary', onclick: () => { estimates.startNew(); location.hash = '#/estimate'; } }, '+ New estimate'))));
  wrap.append(h('p', { class: 'fine' }, 'Every estimate and signed agreement saves on this device and to your account, including when you are offline. Open one here on any device after you sign in.'));
  if (!all.length) wrap.append(h('div', { class: 'card muted' }, 'No estimates yet. They show up here as you build them.'));
  all.forEach((x) => { const t = totals(x); const statusWord = x.status === 'signed' ? 'Signed' : x.status === 'presented' ? 'Presented' : 'Draft'; wrap.append(h('div', { class: 'card lineitem' + (x.id === cur ? ' current' : '') },
    h('div', { class: 'li-main' }, h('div', { class: 'li-text' }, h('b', {}, x.customer.name || '(no name)'), h('div', { class: 'muted' }, `${x.number} · ${statusWord} · ${fdate(x.updated)} · ${t.count} window${t.count === 1 ? '' : 's'}${x.promoCode ? ' · ' + x.promoCode : ''}`), h('div', { class: 'fine' }, x.customer.address)), h('div', { class: 'li-price' }, h('b', {}, fmt(t.total)))),
    h('div', { class: 'row gap wrap' }, h('button', { class: 'btn sm', onclick: () => { estimates.open(x.id); location.hash = '#/estimate'; } }, 'Open'), h('button', { class: 'btn sm', onclick: () => { estimates.duplicate(x.id); location.hash = '#/estimate'; } }, 'Duplicate'),
      h('button', { class: 'btn sm danger', onclick: () => { if (confirm('Remove this estimate from your list? It is archived, not erased.')) { estimates.remove(x.id); renderList(root); } } }, 'Remove')))); });
  root.replaceChildren(wrap);
}
