import { h, fmt, data, settings, saveSettings, brandById, typeName, colorName, installType, frameTypeById, estimates, totals, toast } from '../core.js';
import { mountSignature } from '../sign.js';
import { makeContractPdf, makeEstimatePdf, moneyWords, contractPay } from '../pdf.js';

const fdate = (t) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

function isDoor(l) {
  const name = `${typeName(l.type)} ${l.series || ''}`.toLowerCase();
  return name.includes('door');
}
function colorPhrase(id) {
  const name = colorName(id) || 'selected';
  return name.split('/')[0].trim().toLowerCase() + ' frames';
}
function installPhrase(inst) {
  const frame = frameTypeById(inst?.frameType);
  const raw = (frame?.name || installType(inst?.type)?.name || 'install').toLowerCase();
  if (raw.includes('retrofit')) return 'retrofit install';
  if (raw.includes('block')) return 'block frame install';
  if (raw.includes('nail') || raw.includes('full frame') || raw.includes('stucco')) return 'full frame install';
  return raw.includes('install') ? raw : raw + ' install';
}
function listPhrase(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]}, and ${items[1]}`;
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}
export function buildSpec(e) {
  const describe = (lines, noun) => {
    const groups = new Map();
    for (const l of lines) {
      const brand = brandById(l.brand)?.name || l.brand || 'windows';
      const series = brandById(l.brand)?.series?.find((s) => s.id === l.series)?.name || l.series || '';
      const key = [brand, series, colorPhrase(l.color), installPhrase(l.install)].join('|');
      groups.set(key, (groups.get(key) || 0) + (Number(l.qty) || 0));
    }
    const bits = [...groups.entries()].filter(([, n]) => n > 0).map(([key, n]) => {
      const [brand, series, color, install] = key.split('|');
      const word = n === 1 ? noun.replace(/s$/, '') : noun;
      return `${n} ${word} with new ${brand} ${series} with ${color} and ${install}`.replace(/\s+/g, ' ').trim();
    });
    return bits.length ? `Remove and replace ${listPhrase(bits)}.` : '';
  };
  const lines = e.lines || [];
  const doors = lines.filter(isDoor);
  const windows = lines.filter((l) => !isDoor(l));
  const parts = [describe(windows, 'windows'), describe(doors, 'doors')].filter(Boolean);
  return (parts.join(' ') || 'Work to be confirmed.') + ' Labor and materials. Does not include paint.';
}

function blankContract() {
  return { specsEdited: false, specifications: '', completionDate: '', submittedBy: settings.salesperson || '', initials: '', signatures: { p1a: '', p1b: '', p2a: '', p2b: '' }, signedOn: {} };
}
function contractOf(e) {
  e.contract ||= blankContract();
  e.contract.signatures ||= { p1a: '', p1b: '', p2a: '', p2b: '' };
  e.contract.signedOn ||= {};
  if (!e.contract.specsEdited) e.contract.specifications = buildSpec(e);
  if (!e.contract.submittedBy && settings.salesperson) e.contract.submittedBy = settings.salesperson;
  return e.contract;
}

function licenseLines(c) {
  return String(c?.license || '').split('\n').map((s) => s.trim()).filter(Boolean);
}
function sheetHead() {
  const c = settings.company;
  return h('div', { class: 'sh-head' }, h('img', { src: 'assets/noble-logo-trim.png', alt: c.name, class: 'sh-logo' }),
    h('div', { class: 'sh-co' }, h('b', {}, c.name), h('div', {}, c.address), h('div', {}, c.phone), c.email && h('div', {}, c.email), ...licenseLines(c).map((line) => h('div', {}, line)), c.hours && h('div', {}, c.hours)));
}
function field(label, value, { id, edit, oninput, multiline, type = 'text' } = {}) {
  const control = edit
    ? (multiline
      ? h('textarea', { id, rows: 4, oninput }, value || '')
      : h('input', { type, id, value: value || '', oninput }))
    : h('div', { class: 'ag-value', id }, value || '—');
  return h('label', { class: 'ag-field' }, h('span', { class: 'ag-lbl' }, label), control);
}
function sigBox(key, label, optional, c) {
  const canvas = h('canvas', { class: 'sig-pad', id: 'sig-' + key, 'aria-label': label + ' signature' });
  const date = h('div', { class: 'fine', id: 'date-' + key }, 'Date: ' + fdate(c.signedOn[key] || Date.now()));
  const box = h('div', { class: 'sig-box' + (key === 'initials' ? ' initials' : ''), id: 'box-' + key },
    h('div', { class: 'row between' }, h('b', {}, label), optional ? h('span', { class: 'fine' }, 'Optional') : null),
    h('p', { class: 'fine' }, 'Sign with a finger. Date is filled in for you.'),
    canvas,
    date,
    h('button', { type: 'button', class: 'btn sm', id: 'clear-' + key, onclick: () => { pads[key]?.clear(); } }, 'Clear'));
  box._canvas = canvas;
  box._key = key;
  return box;
}
const pads = {};

function downloadBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

export function render(root) {
  const e = estimates.current();
  const c = contractOf(e);
  const a = data.agreement;
  const pay = () => contractPay(totals(e).total, a.depositPct);
  const save = () => { estimates.save(e); };
  Object.keys(pads).forEach((k) => delete pads[k]);

  const spec = field('Specifications of work needed:', c.specifications, { id: 'contract-spec', edit: true, multiline: true, oninput: (ev) => { c.specsEdited = true; c.specifications = ev.target.value; save(); } });
  const page1 = h('div', { class: 'sheet contract', id: 'contract-page-1' },
    sheetHead(),
    h('h1', { class: 'sh-title' }, a.title.toUpperCase()),
    h('div', { class: 'fine' }, 'Estimate # ' + e.number),
    field('Submitted by:', c.submittedBy, { id: 'submitted-by', edit: true, oninput: (ev) => { c.submittedBy = ev.target.value; settings.salesperson = ev.target.value; saveSettings(settings); save(); } }),
    field('Contract submitted to:', e.customer.name, { id: 'ag-name', edit: true, oninput: (ev) => { e.customer.name = ev.target.value; save(); } }),
    field('Property address:', e.customer.address, { id: 'ag-address', edit: true, oninput: (ev) => { e.customer.address = ev.target.value; save(); } }),
    field('Home Phone and/ or cell phone:', e.customer.phone, { id: 'ag-phone', edit: true, type: 'tel', oninput: (ev) => { e.customer.phone = ev.target.value; save(); } }),
    field('Email Address:', e.customer.email, { id: 'ag-email', edit: true, type: 'email', oninput: (ev) => { e.customer.email = ev.target.value; save(); } }),
    spec,
    h('button', { type: 'button', class: 'link', id: 'spec-rebuild', onclick: () => { c.specsEdited = false; c.specifications = buildSpec(e); const box = document.getElementById('contract-spec'); if (box) box.value = c.specifications; save(); } }, 'Rebuild summary from the estimate'),
    field('Estimated completion date:', c.completionDate, { id: 'ag-complete', edit: true, type: 'date', oninput: (ev) => { c.completionDate = ev.target.value; save(); } }),
    h('div', { class: 'ag-money' },
      h('div', { class: 'line' }, h('span', {}, 'Project Total Cost'), h('b', { id: 'contract-total' }, fmt(pay().total))),
      h('div', { class: 'line' }, h('span', {}, a.depositLabel), h('b', { id: 'contract-deposit' }, fmt(pay().deposit))),
      h('div', { class: 'line' }, h('span', {}, a.balanceLabel), h('b', { id: 'contract-balance' }, fmt(pay().balance)))),
    h('p', {}, a.promise),
    h('p', { id: 'contract-words' }, h('b', {}, moneyWords(pay().total) + ' Dollars (' + fmt(pay().total) + ').')),
    h('p', {}, h('b', {}, a.payNote)),
    h('p', {}, a.initialLead),
    sigBox('initials', 'Initials', false, c),
    h('p', {}, a.initialRest),
    h('p', {}, a.ack),
    sigBox('p1a', 'Purchaser 1', false, c),
    sigBox('p2a', 'Purchaser 2', true, c));

  const page2 = h('div', { class: 'sheet contract', id: 'contract-page-2' },
    sheetHead(),
    h('h2', { class: 'sh-title' }, a.termsTitle),
    h('ol', { class: 'terms-list' }, a.clauses.map((clause) => h('li', {}, clause))),
    sigBox('p1b', 'Purchaser 1', false, c),
    sigBox('p2b', 'Purchaser 2', true, c));

  const fallback = h('div', { id: 'send-fallback' });
  const stale = c.snapshot && Math.round(c.snapshot.total * 100) !== Math.round(pay().total * 100)
    ? h('p', { class: 'warn', id: 'contract-stale' }, `Last saved total was ${fmt(c.snapshot.total)}. The estimate is now ${fmt(pay().total)}. Sending again updates the contract.`)
    : null;
  const actions = h('div', { class: 'card noprint' },
    h('h3', {}, 'Sign and send'),
    h('p', { class: 'fine' }, 'Purchaser 1 signs page 1 and page 2. Purchaser 2 is optional. Email uses the share sheet on iPhone and iPad so Mail can attach both PDFs. The customer address is copied for you to paste.'),
    stale,
    h('button', { type: 'button', class: 'btn primary xl', id: 'btn-send', onclick: () => send(e, c, a) }, 'Email contract and estimate'),
    fallback,
    h('a', { class: 'btn', href: '#/estimate', id: 'btn-back-est' }, '← Back to estimate'));

  const wrap = h('div', { class: 'page contract-page' },
    h('div', { class: 'noprint row between wrap' }, h('h1', {}, 'Purchase agreement'), h('a', { class: 'btn', href: '#/estimate' }, '← Estimate')),
    page1, page2, actions);
  root.replaceChildren(wrap);

  wrap.querySelectorAll('.sig-box').forEach((box) => {
    const key = box._key;
    const canvas = box._canvas;
    pads[key] = mountSignature(canvas, {
      value: key === 'initials' ? c.initials : c.signatures[key],
      onChange: (url) => {
        if (key === 'initials') c.initials = url;
        else c.signatures[key] = url;
        c.signedOn[key] = url ? new Date().toISOString() : '';
        const el = document.getElementById('date-' + key);
        if (el) el.textContent = 'Date: ' + fdate(c.signedOn[key] || Date.now());
        save();
      },
    });
  });
}

async function send(e, c, a) {
  const sig = c.signatures;
  if (!sig.p1a || !sig.p1b) {
    toast('Purchaser 1 needs to sign page 1 and page 2.');
    document.getElementById(!sig.p1a ? 'sig-p1a' : 'sig-p1b')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const p2 = [sig.p2a, sig.p2b].filter(Boolean).length;
  if (p2 === 1) {
    toast('Purchaser 2 should sign both pages, or clear the extra signature.');
    return;
  }
  const btn = document.getElementById('btn-send');
  btn.disabled = true;
  try {
    const pay = contractPay(totals(e).total, a.depositPct);
    const model = {
      agreement: a, company: settings.company, number: e.number, customer: e.customer,
      submittedBy: c.submittedBy, specifications: c.specifications, completionDate: c.completionDate,
      pay, words: moneyWords(pay.total), initials: c.initials, signatures: sig, signedOn: c.signedOn,
    };
    const contractBlob = await makeContractPdf(model);
    const estimateBlob = await makeEstimatePdf(e);
    c.snapshot = { at: Date.now(), total: pay.total, deposit: pay.deposit, balance: pay.balance, customer: { ...e.customer }, specifications: c.specifications, submittedBy: c.submittedBy };
    estimates.save(e);
    await deliver(e, contractBlob, estimateBlob, pay);
  } catch (err) {
    console.error(err);
    toast('Could not create the PDFs.');
  } finally {
    btn.disabled = false;
  }
}

// Web Share cannot set Mail's To: line. A one-tap send would POST the two PDFs
// to a small worker (Resend, Amazon SES, or similar) that emails the customer.
async function deliver(e, contractBlob, estimateBlob, pay) {
  const email = (e.customer.email || '').trim();
  const name = e.customer.name || '';
  const subject = `Noble Windows & Doors — ${e.number}`;
  const body = `Hello ${name},\n\nYour purchase agreement and estimate ${e.number} are attached.\n\nTotal: ${fmt(pay.total)}\nDeposit (65%): ${fmt(pay.deposit)}\nBalance due on completion (35%): ${fmt(pay.balance)}\n\n${settings.company.name}\n${settings.company.phone}`;
  const files = [
    new File([contractBlob], `Noble-contract-${e.number}.pdf`, { type: 'application/pdf' }),
    new File([estimateBlob], `Noble-estimate-${e.number}.pdf`, { type: 'application/pdf' }),
  ];
  let copied = false;
  if (email && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(email); copied = true; } catch { /* share text still shows the address */ }
  }
  const shareText = body + (email ? `\n\nCustomer email: ${email}` : '');
  if (navigator.share && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: subject, text: shareText });
      toast(copied ? 'Customer email copied. Paste it in Mail.' : 'Share sheet opened.');
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  downloadBlob(files[0], files[0].name);
  downloadBlob(files[1], files[1].name);
  const href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\nAttach the two PDFs that were just downloaded.')}`;
  const box = document.getElementById('send-fallback');
  if (box) {
    box.replaceChildren(
      h('p', {}, 'Both PDFs downloaded. This browser cannot attach them from the share sheet. Open the email and attach the two files.'),
      h('a', { class: 'btn primary', id: 'mailto-fallback', href }, email ? `Email ${email}` : 'Open email'));
  }
  toast(copied ? 'PDFs downloaded. Customer email copied.' : 'PDFs downloaded.');
}
