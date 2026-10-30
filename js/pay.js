// QuickBooks payment card on a signed agreement. The invoice is the full quote.
// The amount on screen is the deposit the customer should enter. Card fee is 4% of that deposit.
import { h, fmt, totals, quoteLine, toast } from './core.js';
import { syncQuickBooks, enableCardPayment, refreshQboPayment, recordOfflineDeposit, qboStatus, startQboConnect, disconnectQbo, isAdmin } from './cloud.js';
import { feeCentsFor, money, depositNotice, payFrom } from '../supabase/functions/quickbooks-invoice/invoice.js';
import { icon } from './icons.js';

let busyAction = '';

export function quoteDescriptions(e) {
  return (e?.lines || []).map((line) => {
    const q = quoteLine(line, { ascii: true });
    const bits = [q.location, q.title, ...(q.details || []), q.size].filter(Boolean);
    const qty = Number(q.qty) || 1;
    if (qty > 1) bits.push('Qty ' + qty);
    return bits.join(' — ');
  });
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + size));
  return btoa(bin);
}

function centsOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function signedPay(e) {
  const snap = e?.contract?.snapshot;
  const pct = Number(snap?.depositPct) || 60;
  return { pct, pay: payFrom(totals(e).total, pct, snap) };
}

function depositCentsOf(e) {
  if (e?.qbo?.depositCents != null) return e.qbo.depositCents;
  const snap = e?.contract?.snapshot;
  if (snap?.deposit != null) return centsOf(snap.deposit);
  return signedPay(e).pay.depositCents;
}

function balanceCentsOf(e) {
  if (e?.qbo?.balanceCents != null) return e.qbo.balanceCents;
  const snap = e?.contract?.snapshot;
  if (snap?.balance != null) return centsOf(snap.balance);
  return signedPay(e).pay.balanceCents;
}

function showMoney(cents) {
  if (cents == null) return '—';
  return fmt(cents / 100);
}

function qrMarkup(text) {
  try {
    const make = window.qrcode;
    if (!text || typeof make !== 'function') return '';
    const qr = make(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (err) {
    console.error(err);
    return '';
  }
}

async function run(e, opts, action, fn, okMsg) {
  busyAction = action;
  mountPayment(e, opts);
  const res = await fn();
  busyAction = '';
  if (!res?.ok) toast(res?.error || 'QuickBooks did not accept that.');
  else if (okMsg) toast(typeof okMsg === 'function' ? okMsg(res) : okMsg);
  mountPayment(e, opts);
  return res;
}

function renderPay(e, opts) {
  const qbo = e.qbo || {};
  const { pct, pay } = signedPay(e);
  const rest = 100 - pct;
  const deposit = depositCentsOf(e);
  const balance = balanceCentsOf(e);
  const fee = qbo.feeDepositCents != null ? qbo.feeDepositCents : null;
  const cardOn = qbo.cardOn === true || fee != null;
  const enter = deposit + (fee || 0);
  const notice = qbo.notice || depositNotice(pay, pct);
  const hasInvoice = Boolean(qbo.invoiceId);
  const previewFee = feeCentsFor(deposit || 0);

  if (!hasInvoice) {
    return h('div', { class: 'card pay-card', id: 'qbo-card' },
      h('h3', {}, icon('card'), ' QuickBooks invoice'),
      h('p', { id: 'qbo-notice' }, notice),
      h('div', { class: 'pay-due-block' },
        h('div', { class: 'eyebrow' }, 'Deposit to collect'),
        h('div', { class: 'pay-due', id: 'qbo-amount' }, showMoney(deposit)),
        h('p', { class: 'fine' }, `Remaining ${showMoney(balance)} (${rest}%) stays on the same invoice and is due at completion.`)),
      qbo.error ? h('p', { class: 'warn', id: 'qbo-error' }, qbo.error) : h('p', { class: 'fine', id: 'qbo-waiting' }, 'The signed agreement is saved. The invoice is waiting on QuickBooks.'),
      h('button', {
        type: 'button',
        class: 'btn primary',
        id: 'qbo-retry',
        disabled: busyAction === 'retry' ? true : null,
        onclick: () => run(e, opts, 'retry', async () => {
          let pdfBase64 = '';
          try { if (opts.rebuildPdf) pdfBase64 = await opts.rebuildPdf(); } catch { /* invoice still creates */ }
          return syncQuickBooks(e, { pdfBase64 });
        }, (res) => res.attachmentError ? 'Invoice created. The contract PDF was not attached.' : 'QuickBooks invoice is ready.'),
      }, busyAction === 'retry' ? 'Working…' : 'Retry QuickBooks invoice'));
  }

  const feeBox = fee != null ? h('div', { class: 'pay-fee', id: 'qbo-fee' },
    h('div', { class: 'line' }, h('span', {}, 'Card processing fee (4%) — deposit'), h('b', {}, showMoney(fee))),
    h('p', { class: 'fine' }, `The card fee is 4% of the ${showMoney(deposit)} deposit. The new amount to enter is ${showMoney(enter)}. Invoice total is ${showMoney(qbo.totalCents)}.`)) : null;

  const link = qbo.paymentLink || '';
  const qr = link ? qrMarkup(link) : '';
  const paid = qbo.paidCents;
  const due = qbo.amountDueCents;
  const depositReceived = paid != null && deposit != null && paid >= deposit;

  return h('div', { class: 'card pay-card', id: 'qbo-card' },
    h('h3', {}, icon('card'), ' QuickBooks invoice'),
    h('div', { class: 'pay-ach', id: 'qbo-ach' }, cardOn ? 'Card payments are on. Bank transfer (ACH) stays on.' : 'Bank transfer (ACH) only. Card payments are off.'),
    h('p', { class: 'fine', id: 'qbo-doc' }, [qbo.docNumber ? 'Invoice ' + qbo.docNumber : '', qbo.mock ? 'Mock mode' : ''].filter(Boolean).join(' · ')),
    h('p', { id: 'qbo-notice' }, notice),
    h('div', { class: 'pay-due-block' },
      h('div', { class: 'eyebrow', id: 'qbo-amount-label' }, 'Amount to enter on the pay page'),
      h('div', { class: 'pay-due', id: 'qbo-amount' }, showMoney(enter)),
      h('p', { class: 'fine', id: 'qbo-amount-note' }, cardOn
        ? 'Ask the customer to enter this amount. It is the deposit plus the card fee. QuickBooks may allow a different amount. The rest of the invoice stays open.'
        : 'Ask the customer to enter this deposit. QuickBooks may allow a different amount. The remaining balance stays open on this invoice.')),
    fee != null ? feeBox : h('div', { class: 'pay-fee', id: 'qbo-fee-preview' },
      h('p', {}, `Pay by card adds a 4% fee of ${showMoney(previewFee)} on the ${showMoney(deposit)} deposit. The amount to enter becomes ${showMoney((deposit || 0) + previewFee)}.`),
      h('button', {
        type: 'button',
        class: 'btn primary',
        id: 'qbo-pay-card',
        disabled: busyAction === 'card' ? true : null,
        onclick: () => run(e, opts, 'card', () => enableCardPayment(e, 'deposit'), (res) => res.added === false ? 'The deposit card fee is already on this invoice.' : `Card payments are on. Fee ${money(res.feeCents)} was added.`),
      }, busyAction === 'card' ? 'Working…' : 'Pay by card')),
    h('div', { class: 'line' }, h('span', {}, 'Invoice total'), h('b', { id: 'qbo-total' }, showMoney(qbo.totalCents != null ? qbo.totalCents : pay.totalCents))),
    h('div', { class: 'line' }, h('span', {}, `Deposit (${pct}%)`), h('b', { id: 'qbo-deposit' }, showMoney(deposit))),
    h('div', { class: 'line' }, h('span', {}, `Remaining at completion (${rest}%)`), h('b', { id: 'qbo-balance' }, showMoney(balance))),
    paid != null ? h('div', { class: 'line', id: 'qbo-paid' }, h('span', {}, 'Paid on this invoice'), h('b', {}, showMoney(paid))) : null,
    due != null ? h('div', { class: 'line', id: 'qbo-remaining' }, h('span', {}, 'Invoice balance'), h('b', {}, showMoney(due))) : null,
    h('p', { class: depositReceived ? 'fine' : 'fine', id: 'qbo-deposit-received' }, depositReceived ? `Deposit received (${showMoney(deposit)}).` : 'Deposit not received yet.'),
    qbo.error ? h('p', { class: 'warn', id: 'qbo-error' }, qbo.error) : null,
    qbo.attachmentError ? h('p', { class: 'warn', id: 'qbo-attach-error' }, qbo.attachmentError) : null,
    qbo.linkNote ? h('p', { class: 'fine', id: 'qbo-link-note' }, qbo.linkNote) : null,
    fee != null ? h('p', { class: 'fine', id: 'qbo-card-on' }, 'Card payments are on for this invoice. Pressing Pay by card again does not add a second deposit fee.') : null,
    h('div', { class: 'row gap wrap' },
      h('button', {
        type: 'button',
        class: 'btn',
        id: 'qbo-refresh',
        disabled: busyAction === 'refresh' ? true : null,
        onclick: () => run(e, opts, 'refresh', () => refreshQboPayment(e), (res) => res.depositReceived ? 'Deposit received.' : 'Payment status updated.'),
      }, busyAction === 'refresh' ? 'Working…' : 'Refresh payment status'),
      !depositReceived && !qbo.offlinePaymentId ? h('button', {
        type: 'button',
        class: 'btn',
        id: 'qbo-offline-deposit',
        disabled: busyAction === 'offline' ? true : null,
        onclick: () => {
          if (!confirm(`Record an offline deposit of ${showMoney(deposit)} on this invoice?`)) return;
          run(e, opts, 'offline', () => recordOfflineDeposit(e), 'Offline deposit recorded.');
        },
      }, busyAction === 'offline' ? 'Working…' : 'Record offline deposit') : null,
      qbo.attachmentError || !link ? h('button', {
        type: 'button',
        class: 'btn',
        id: 'qbo-retry',
        disabled: busyAction === 'retry' ? true : null,
        onclick: () => run(e, opts, 'retry', async () => {
          let pdfBase64 = '';
          try { if (opts.rebuildPdf) pdfBase64 = await opts.rebuildPdf(); } catch { /* keep going */ }
          return syncQuickBooks(e, { pdfBase64 });
        }, 'Invoice updated.'),
      }, 'Retry') : null),
    link ? h('div', { class: 'pay-qr-wrap', id: 'qbo-qr' },
      h('div', { class: 'pay-qr', html: qr, role: 'img', 'aria-label': 'QuickBooks payment QR code' }),
      h('a', { class: 'btn primary', id: 'qbo-pay-now', href: link, target: '_blank', rel: 'noopener' }, 'Pay now'),
      h('p', { class: 'fine' }, 'Same payment link for the deposit and, later, the remaining balance.')) : h('p', { class: 'warn', id: 'qbo-no-link' }, 'Payment link is not available yet.'));
}

export function mountPayment(e, opts = {}) {
  const host = document.getElementById('qbo-pay');
  if (!host) return;
  host._refresh = () => mountPayment(e, opts);
  if (e?.status !== 'signed') {
    host.replaceChildren();
    return;
  }
  host.replaceChildren(renderPay(e, opts));
}

window.addEventListener('nwd-synced', () => {
  const host = document.getElementById('qbo-pay');
  if (host?._refresh) host._refresh();
});

export function callbackUrl() {
  const url = new URL('qbo-callback.html', location.href);
  url.search = '';
  url.hash = '';
  return url.href;
}

export async function renderQboConnect(host) {
  if (!host) return;
  host.replaceChildren(h('p', { class: 'fine' }, 'Checking QuickBooks…'));
  const res = await qboStatus();
  const canConnect = isAdmin();
  if (!res.ok) {
    host.replaceChildren(h('div', { class: 'card', id: 'qbo-connect' },
      h('h3', {}, 'QuickBooks'),
      h('p', { class: 'warn', id: 'qbo-company' }, res.error || 'QuickBooks status is not available yet.')));
    return;
  }
  const connected = res.connected === true && res.companyName;
  host.replaceChildren(h('div', { class: 'card', id: 'qbo-connect' },
    h('h3', {}, 'QuickBooks'),
    h('p', { id: 'qbo-company' }, connected ? `QuickBooks company: ${res.companyName}` : 'QuickBooks is not connected.'),
    res.mock ? h('p', { class: 'warn', id: 'qbo-mock' }, 'Mock mode is on. This is not a live QuickBooks company.') : null,
    h('p', { class: 'fine' }, 'Confirm this name is the Windows & Doors company. Noble General Contracting is a different QuickBooks file. Invoices are blocked until a company is connected.'),
    canConnect && res.realmId ? h('p', { class: 'fine', id: 'qbo-realm' }, 'Realm ' + res.realmId) : null,
    res.warning ? h('p', { class: 'warn' }, res.warning) : null,
    canConnect ? h('div', { class: 'row gap wrap' },
      h('button', {
        type: 'button',
        class: 'btn primary',
        id: 'qbo-connect-btn',
        onclick: async () => {
          const started = await startQboConnect();
          if (!started.ok) { toast(started.error || 'Could not start QuickBooks.'); return; }
          if (started.url) location.href = started.url;
        },
      }, connected ? 'Reconnect QuickBooks' : 'Connect QuickBooks'),
      connected ? h('button', {
        type: 'button',
        class: 'btn',
        id: 'qbo-disconnect-btn',
        onclick: async () => {
          if (!confirm('Disconnect QuickBooks on this app? Existing invoices stay in QuickBooks.')) return;
          const done = await disconnectQbo();
          if (!done.ok) toast(done.error || 'Could not disconnect.');
          else renderQboConnect(host);
        },
      }, 'Disconnect') : null) : h('p', { class: 'fine' }, 'An admin connects QuickBooks from the Admin page.')));
}
