import { h, fmt, esc, data, settings, typeName, colorById, brandById, optionDef, priceWindow, installUnit, installLabel, defaultInstall, estimates, totals, toast, uid } from '../core.js';
import { icon, frameKeyFor, stepper, installEditor } from './calculator.js';

const open = new Set(); // line ids being edited
const fdate = (t) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

function lineDesc(l) { return `${brandById(l.brand)?.name || l.brand} ${l.series} ${typeName(l.type)}, ${colorById(l.color)?.name || l.color}`; }
function optNames(l) { return (l.options || []).map((id) => optionDef(id)?.name).filter(Boolean); }
function reprice(l) {
  const p = priceWindow({ brand: l.brand, series: l.series, color: l.color, type: l.type, w: l.w, h: l.h, qty: l.qty, options: l.options });
  if (p) { l.unitBase = p.unitBase; l.optionsEach = p.optionsEach; l.unit = p.unit; l.rate = p.rate; l.rateSet = settings.rateSet; l.estimated = p.estimated; }
  l.installUnit = installUnit(l.install);
}

export function render(root) {
  const e = estimates.current();
  e.extras ||= [];
  const wrap = h('div', { class: 'page est' });
  const save = () => { estimates.persist(); };
  const rerender = () => render(root);

  wrap.append(h('div', { class: 'row between wrap' }, h('div', {}, h('h1', {}, 'Estimate'), h('div', { class: 'muted' }, `${e.number} · ${fdate(e.created)}`)),
    h('div', { class: 'row wrap gap' },
      h('button', { class: 'btn', onclick: () => { estimates.startNew(); rerender(); } }, '+ New'),
      h('button', { class: 'btn', onclick: () => { if (!e.lines.length && !e.customer.name) return toast('Nothing to duplicate yet'); save(); estimates.duplicate(e.id); toast('Duplicated'); rerender(); } }, 'Duplicate'),
      h('a', { class: 'btn primary', id: 'btn-print', href: '#/estimate/print' }, 'Print / PDF'))));

  // customer
  const cf = (key, label, type = 'text', ph = '') => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type, id: 'c-' + key, value: e.customer[key], placeholder: ph, autocomplete: 'off', oninput: (ev) => { e.customer[key] = ev.target.value; save(); } }));
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Customer'), h('div', { class: 'cols2' }, cf('name', 'Name'), cf('phone', 'Phone', 'tel'), cf('email', 'Email', 'email'), cf('address', 'Job address'))));

  // lines
  const lines = h('div', { class: 'card' }, h('h3', {}, 'Windows'));
  if (!e.lines.length) lines.append(h('p', { class: 'muted' }, 'No windows yet. ', h('a', { href: '#/calculator' }, 'Add one from the calculator →')));
  e.lines.forEach((l, idx) => {
    const isOpen = open.has(l.id);
    const row = h('div', { class: 'lineitem' },
      h('div', { class: 'li-main' }, icon(l.type, frameKeyFor(l.color), 'tyicon sm'),
        h('div', { class: 'li-text' }, h('b', {}, l.label), h('div', { class: 'muted' }, `${lineDesc(l)} · ${l.w}" × ${l.h}"`), optNames(l).length ? h('div', { class: 'fine' }, optNames(l).join(' · ')) : null,
          h('div', { class: 'fine' }, `Install: ${installLabel(l.install)}`)),
        h('div', { class: 'li-price' }, h('div', {}, `${l.qty} × ${fmt(l.unit)}`), h('div', { class: 'muted' }, `+ install ${l.qty} × ${fmt(l.installUnit)}`), h('b', {}, fmt((l.unit + l.installUnit) * l.qty)))),
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn sm', onclick: () => { isOpen ? open.delete(l.id) : open.add(l.id); rerender(); } }, isOpen ? 'Done' : 'Edit'),
        h('button', { class: 'btn sm', onclick: () => { const c = JSON.parse(JSON.stringify(l)); c.id = uid(); e.lines.splice(idx + 1, 0, c); save(); rerender(); } }, 'Copy'),
        h('button', { class: 'btn sm danger', onclick: () => { e.lines.splice(idx, 1); save(); rerender(); } }, 'Remove')));
    if (isOpen) {
      const upd = (full) => { reprice(l); save(); full ? rerender() : refreshTotals(); };
      row.append(h('div', { class: 'edit' },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Room / label'), h('input', { type: 'text', value: l.label, oninput: (ev) => { l.label = ev.target.value; save(); } })),
        h('div', { class: 'grid3' }, stepper('Width', l.w, (v) => { l.w = parseFloat(v) || 0; reprice(l); save(); }, { unit: 'in' }), stepper('Height', l.h, (v) => { l.h = parseFloat(v) || 0; reprice(l); save(); }, { unit: 'in' }), stepper('Qty', l.qty, (v) => { l.qty = parseInt(v) || 1; save(); }, { min: 1 })),
        h('div', { class: 'cols2' }, h('div', {}, h('b', {}, 'Glass'), data.options.glass.map((o) => optCheck(l, o))), h('div', {}, h('b', {}, 'Frame / extras'), data.options.frame.map((o) => optCheck(l, o)))),
        h('b', {}, 'Installation'), installEditor(l.install, (full) => { reprice(l); save(); if (full) rerender(); }, 'li-' + l.id),
        h('button', { class: 'btn primary', onclick: () => { reprice(l); save(); open.delete(l.id); rerender(); } }, 'Save line')));
    }
    lines.append(row);
  });
  function optCheck(l, o) { return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: l.options.includes(o.id) ? 'checked' : null, onchange: (ev) => { l.options = ev.target.checked ? [...l.options, o.id] : l.options.filter((x) => x !== o.id); if (o.id === 'obscure' && !ev.target.checked) { const ids = new Set((data.obscureGlass?.patterns || []).map((p) => p.id)); l.options = l.options.filter((id) => !ids.has(id)); } } }), h('span', {}, o.name)); }
  lines.append(h('a', { class: 'btn', href: '#/calculator' }, '+ Add window'));
  wrap.append(lines);

  // job extras
  const ex = h('div', { class: 'card' }, h('h3', {}, 'Additional job items (permit, haul-away, trim…)'));
  e.extras.forEach((x, i) => ex.append(h('div', { class: 'row gap nowrap extra' },
    h('input', { type: 'text', value: x.label, 'aria-label': 'Item', oninput: (ev) => { x.label = ev.target.value; save(); } }),
    h('input', { type: 'text', inputmode: 'decimal', class: 'amt', value: x.amount, 'aria-label': 'Amount', oninput: (ev) => { x.amount = ev.target.value.replace(/[^0-9.-]/g, ''); save(); refreshTotals(); } }),
    h('button', { class: 'btn sm danger', onclick: () => { e.extras.splice(i, 1); save(); rerender(); } }, '✕'))));
  ex.append(h('div', { class: 'chips' }, data.install.jobExtras.map((x) => h('button', { class: 'chip', onclick: () => { e.extras.push({ id: uid(), label: x.name, amount: x.amount }); save(); rerender(); } }, '+ ' + x.name)), h('button', { class: 'chip', id: 'btn-custom-extra', onclick: () => { e.extras.push({ id: uid(), label: 'Custom item', amount: 0 }); save(); rerender(); } }, '+ Custom')));
  wrap.append(ex);

  // totals
  const tot = h('div', { class: 'card totals', id: 'totals' });
  function refreshTotals() {
    const t = totals(e); tot.replaceChildren(
      h('div', { class: 'line' }, h('span', {}, `Windows (${t.count})`), h('b', { id: 't-win' }, fmt(t.windows))),
      h('div', { class: 'line' }, h('span', {}, 'Installation / labor'), h('b', { id: 't-inst' }, fmt(t.install))),
      t.extras ? h('div', { class: 'line' }, h('span', {}, 'Additional items'), h('b', {}, fmt(t.extras))) : null,
      h('div', { class: 'line strong' }, h('span', {}, 'Subtotal'), h('b', { id: 't-sub' }, fmt(t.subtotal))),
      h('div', { class: 'line' }, h('span', { class: 'row gap' }, 'Tax %', h('input', { type: 'text', class: 'taxin', id: 't-taxpct', inputmode: 'decimal', value: e.taxPct, oninput: (ev) => { e.taxPct = parseFloat(ev.target.value) || 0; save(); const t2 = totals(e); $tax.textContent = fmt(t2.tax); $tot.textContent = fmt(t2.total); $lbl.textContent = totLabel(t2); } })), h('b', {}, h('span', { id: 't-tax' }, fmt(t.tax)))),
      h('div', { class: 'line big2' }, h('span', { id: 't-lbl' }, totLabel(t)), h('b', { id: 't-total' }, fmt(t.total))));
    var $tax = $('#t-tax', tot), $tot = $('#t-total', tot), $lbl = $('#t-lbl', tot);
  }
  const totLabel = (t) => (e.taxPct ? 'Total with tax' : 'Total (before tax)');
  function $(s, r) { return r.querySelector(s); }
  refreshTotals();
  wrap.append(tot);
  wrap.append(h('div', { class: 'card' }, h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Notes (shown on estimate)'), h('textarea', { rows: 3, id: 'e-notes', oninput: (ev) => { e.notes = ev.target.value; save(); } }, e.notes)),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Estimate valid for (days)'), h('input', { type: 'text', inputmode: 'numeric', value: e.validDays, oninput: (ev) => { e.validDays = parseInt(ev.target.value) || 30; save(); } }))));
  root.replaceChildren(wrap);
}

export function renderPrint(root) {
  const e = estimates.current(); const t = totals(e); const c = settings.company;
  const valid = new Date(e.created + (e.validDays || 30) * 86400000);
  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'sh-head' }, h('img', { src: 'assets/noble-logo-trim.png', alt: 'Noble Windows & Doors LLC', class: 'sh-logo' }),
      h('div', { class: 'sh-co' }, h('b', {}, c.name), h('div', {}, c.address), h('div', {}, c.phone), c.email && h('div', {}, c.email), c.website && h('div', {}, c.website), c.license && h('div', {}, 'Lic. ' + c.license))),
    h('h1', { class: 'sh-title' }, 'ESTIMATE'),
    h('div', { class: 'sh-meta' }, h('div', {}, h('b', {}, 'Prepared for'), h('div', {}, e.customer.name || '—'), h('div', {}, e.customer.address), h('div', {}, e.customer.phone), h('div', {}, e.customer.email)),
      h('div', { class: 'r' }, h('div', {}, h('b', {}, 'Estimate #: '), e.number), h('div', {}, h('b', {}, 'Date: '), fdate(e.created)), h('div', {}, h('b', {}, 'Valid through: '), fdate(valid)))));
  // windows table
  const tw = h('table', { class: 'sh-table' }, h('thead', {}, h('tr', {}, ['Location', 'Window', 'Size (W × H)', 'Qty', 'Each', 'Total'].map((x, i) => h('th', { class: i > 2 ? 'r' : '' }, x)))));
  const tb = h('tbody'); e.lines.forEach((l) => tb.append(h('tr', {}, h('td', {}, h('b', {}, l.label)), h('td', {}, lineDesc(l), optNames(l).length ? h('div', { class: 'fine' }, optNames(l).join(', ')) : null), h('td', {}, `${l.w}" × ${l.h}"`), h('td', { class: 'r' }, l.qty), h('td', { class: 'r' }, fmt(l.unit)), h('td', { class: 'r' }, fmt(l.unit * l.qty)))));
  tb.append(h('tr', { class: 'sub' }, h('td', { colspan: 5, class: 'r' }, 'Windows subtotal'), h('td', { class: 'r' }, fmt(t.windows)))); tw.append(tb);
  sheet.append(h('h3', {}, 'Windows (materials)'), tw);
  const ti = h('table', { class: 'sh-table' }, h('thead', {}, h('tr', {}, ['Location', 'Installation', 'Qty', 'Each', 'Total'].map((x, i) => h('th', { class: i > 1 ? 'r' : '' }, x)))));
  const ib = h('tbody'); e.lines.forEach((l) => ib.append(h('tr', {}, h('td', {}, l.label), h('td', {}, installLabel(l.install)), h('td', { class: 'r' }, l.qty), h('td', { class: 'r' }, fmt(l.installUnit)), h('td', { class: 'r' }, fmt(l.installUnit * l.qty)))));
  ib.append(h('tr', { class: 'sub' }, h('td', { colspan: 4, class: 'r' }, 'Installation / labor subtotal'), h('td', { class: 'r' }, fmt(t.install)))); ti.append(ib);
  sheet.append(h('h3', {}, 'Installation / labor'), ti);
  if (e.extras.length) {
    const tx = h('table', { class: 'sh-table' }); e.extras.forEach((x) => tx.append(h('tr', {}, h('td', {}, x.label), h('td', { class: 'r' }, fmt(Number(x.amount) || 0)))));
    tx.append(h('tr', { class: 'sub' }, h('td', { class: 'r' }, 'Additional items subtotal'), h('td', { class: 'r' }, fmt(t.extras))));
    sheet.append(h('h3', {}, 'Additional items'), tx);
  }
  sheet.append(h('div', { class: 'sh-totals' },
    h('div', { class: 'line' }, h('span', {}, 'Windows'), h('b', {}, fmt(t.windows))), h('div', { class: 'line' }, h('span', {}, 'Installation / labor'), h('b', {}, fmt(t.install))),
    t.extras ? h('div', { class: 'line' }, h('span', {}, 'Additional items'), h('b', {}, fmt(t.extras))) : null,
    h('div', { class: 'line' }, h('span', {}, 'Subtotal'), h('b', {}, fmt(t.subtotal))),
    e.taxPct ? h('div', { class: 'line' }, h('span', {}, `Tax (${e.taxPct}%${settings.taxOn === 'all' ? '' : ' on windows'})`), h('b', {}, fmt(t.tax))) : null,
    h('div', { class: 'line big2' }, h('span', {}, e.taxPct ? 'TOTAL' : 'TOTAL (before tax)'), h('b', {}, fmt(t.total))),
    !e.taxPct && h('div', { class: 'fine r' }, 'Sales tax not included.')));
  if (e.notes) sheet.append(h('h3', {}, 'Notes'), h('p', { class: 'pre' }, e.notes));
  sheet.append(h('h3', {}, 'Terms'), h('p', { class: 'pre fine' }, settings.terms),
    h('div', { class: 'sig' }, h('div', {}, 'Accepted by (signature) ______________________________'), h('div', {}, 'Date ______________')));
  root.replaceChildren(h('div', { class: 'page printpage' },
    h('div', { class: 'noprint row gap wrap' }, h('a', { class: 'btn', href: '#/estimate' }, '← Back to estimate'), h('button', { class: 'btn primary', id: 'btn-do-print', onclick: () => window.print() }, 'Print / Save as PDF'), h('span', { class: 'muted' }, 'On iPad: tap Print, then pinch-out on the preview (or Share → Save to Files) to save a PDF.')), sheet));
}

export function renderList(root) {
  const all = estimates.list(); const cur = estimates.currentId();
  const wrap = h('div', { class: 'page' }, h('div', { class: 'row between' }, h('h1', {}, 'Saved estimates'), h('button', { class: 'btn primary', onclick: () => { estimates.startNew(); location.hash = '#/estimate'; } }, '+ New estimate')));
  if (!all.length) wrap.append(h('div', { class: 'card muted' }, 'No saved estimates yet. They save automatically on this device as you build them.'));
  all.forEach((x) => { const t = totals(x); wrap.append(h('div', { class: 'card lineitem' + (x.id === cur ? ' current' : '') },
    h('div', { class: 'li-main' }, h('div', { class: 'li-text' }, h('b', {}, x.customer.name || '(no name)'), h('div', { class: 'muted' }, `${x.number} · ${fdate(x.updated)} · ${t.count} window${t.count === 1 ? '' : 's'}`), h('div', { class: 'fine' }, x.customer.address)), h('div', { class: 'li-price' }, h('b', {}, fmt(t.total)))),
    h('div', { class: 'row gap wrap' }, h('button', { class: 'btn sm', onclick: () => { estimates.open(x.id); location.hash = '#/estimate'; } }, 'Open'), h('button', { class: 'btn sm', onclick: () => { estimates.duplicate(x.id); location.hash = '#/estimate'; } }, 'Duplicate'),
      h('button', { class: 'btn sm danger', onclick: () => { if (confirm('Delete this estimate?')) { estimates.remove(x.id); renderList(root); } } }, 'Delete')))); });
  root.replaceChildren(wrap);
}
