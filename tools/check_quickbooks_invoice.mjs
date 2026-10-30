// QuickBooks invoice math. No network. Deposit cents come from contractPay / the signed snapshot.
import { readFileSync } from 'node:fs';
import {
  addStageFee, applyFeeState, applyPaymentState, buildInvoice, contractPay, depositNotice,
  dollars, feeCentsFor, findFeeLine, invoicePayload, money, needsSendForLink, payFrom, paymentView,
} from '../supabase/functions/quickbooks-invoice/invoice.js';

const fail = (msg) => { console.error('FAIL', msg); process.exitCode = 1; };
const eq = (actual, expected, msg) => {
  if (actual !== expected) fail(msg + ' — ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected));
};
const has = (text, needle, msg) => {
  if (!String(text).includes(needle)) fail(msg + ' — missing ' + needle);
};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const pdf = read('../js/pdf.js');
has(pdf, 'const cents = Math.round((Number(total) || 0) * 100);', 'pdf.js contractPay still rounds total cents');
has(pdf, 'const deposit = Math.round(cents * (Number(depositPct) || 0) / 100);', 'pdf.js contractPay still rounds the deposit');
has(pdf, 'balance: (cents - deposit) / 100', 'pdf.js contractPay balance is the remainder');
const invoiceSrc = read('../supabase/functions/quickbooks-invoice/invoice.js');
has(invoiceSrc, 'const centsTotal = Math.round((Number(total) || 0) * 100);', 'invoice contractPay uses the same total rounding');
has(invoiceSrc, 'const deposit = Math.round(centsTotal * (Number(depositPct) || 0) / 100);', 'invoice contractPay uses the same deposit rounding');
has(invoiceSrc, 'AllowOnlineCreditCardPayment: false', 'new invoices are ACH only');

function pdfPay(total, depositPct = 60) {
  const cents = Math.round((Number(total) || 0) * 100);
  const deposit = Math.round(cents * (Number(depositPct) || 0) / 100);
  return { totalCents: cents, depositCents: deposit, balanceCents: cents - deposit };
}

for (const total of [3144.46, 10, 10.01, 0.01, 0, 8888.33, 109.1]) {
  const a = contractPay(total, 60);
  const b = pdfPay(total, 60);
  eq(a.totalCents, b.totalCents, 'total cents ' + total);
  eq(a.depositCents, b.depositCents, 'deposit cents ' + total);
  eq(a.balanceCents, b.balanceCents, 'balance cents ' + total);
  eq(a.depositCents + a.balanceCents, a.totalCents, 'split adds up ' + total);
}

const quote = contractPay(3144.46, 60);
eq(quote.depositCents, 188668, 'spot-check deposit cents');
eq(quote.balanceCents, 125778, 'spot-check balance cents');
eq(money(quote.depositCents), '$1,886.68', 'deposit text amount');
eq(money(quote.balanceCents), '$1,257.78', 'balance text amount');
const notice = depositNotice(quote, 60);
eq(notice, '60% deposit of $1,886.68 due now, remaining $1,257.78 (40%) due at completion of work', 'deposit notice');

const snap = payFrom(1, 60, { total: 3144.46, deposit: 1886.68, balance: 1257.78 });
eq(snap.source, 'snapshot', 'signed snapshot is reused');
eq(snap.depositCents, quote.depositCents, 'snapshot deposit matches contractPay');
eq(snap.balanceCents, quote.balanceCents, 'snapshot balance matches contractPay');
const fallback = payFrom(999, 60, { total: 10, deposit: 1, balance: 1 });
eq(fallback.source, 'snapshot-total', 'a snapshot that does not add up uses contractPay on the signed total');
eq(fallback.depositCents, pdfPay(10, 60).depositCents, 'fallback deposit');

const built = buildInvoice({
  lines: [{ label: 'Living room', brand: 'Milgard', series: 'V300', type: 'slider', w: 36, h: 48, qty: 2, unit: 1008 }],
  extras: [],
  totals: {
    windows: 2016,
    discount: 0,
    labor: 795,
    shipping: 150,
    extras: 0,
    tax: 183.46,
    taxPct: 9.1,
    total: 3144.46,
  },
  pay: quote,
  depositPct: 60,
  descriptions: ['Living room — Milgard V300 slider'],
});
eq(built.lines[0].kind, 'notice', 'first line is the deposit notice');
eq(built.lines[0].amountCents, 0, 'notice does not change the total');
eq(built.lines[0].description, notice, 'notice uses the existing deposit');
eq(built.lines[1].description, 'Living room — Milgard V300 slider', 'customer description is kept');
eq(built.totalCents, quote.totalCents, 'full invoice total equals the estimate total');
eq(built.lines.filter((line) => line.kind !== 'notice').reduce((sum, line) => sum + line.amountCents, 0), quote.totalCents, 'priced lines add up');
eq(built.lines.some((line) => /Less:/.test(line.description)), false, 'no balance credit line');
const tax = built.lines.find((line) => line.kind === 'tax');
eq(tax.amountCents, 18346, 'tax line is the quoted tax');
eq(tax.description, 'Sales Tax (9.1%)', 'tax label');
eq(built.lines.find((line) => line.kind === 'labor').description, 'Installation / Labor', 'labor label');
eq(built.lines.find((line) => line.kind === 'shipping').amountCents, 15000, 'shipping');

const drifted = buildInvoice({
  lines: [
    { label: 'A', qty: 1, unit: 33.33 },
    { label: 'B', qty: 1, unit: 33.33 },
    { label: 'C', qty: 1, unit: 33.33 },
  ],
  extras: [{ label: 'Permit', amount: 50 }],
  totals: { windows: 100, discount: 0, labor: 0, shipping: 0, extras: 50, tax: 9.1, taxPct: 9.1, total: 159.1 },
  pay: contractPay(159.1, 60),
  depositPct: 60,
});
eq(drifted.totalCents, contractPay(159.1, 60).totalCents, 'penny drift still matches the signed total');
eq(drifted.lines.find((line) => line.kind === 'tax').amountCents, 910, 'tax is not used to absorb rounding');
eq(drifted.lines.filter((line) => line.kind === 'window').reduce((sum, line) => sum + line.amountCents, 0), 10000, 'windows reconcile to the quoted subtotal');

const items = {
  sales: { id: 'sales', name: 'Windows and doors' },
  fee: { id: 'fee', name: 'Card processing fee' },
  tax: { id: 'tax', name: 'Sales tax' },
};
const payload = invoicePayload({ built, customerId: '42', email: 'a@b.com', docNumber: 'NWD-1', items, taxCode: 'NON' });
eq(payload.AllowOnlineACHPayment, true, 'ACH on');
eq(payload.AllowOnlineCreditCardPayment, false, 'card off by default');
eq(Object.prototype.hasOwnProperty.call(payload, 'Deposit'), false, 'Invoice.Deposit is not a deposit request');
eq(payload.CustomerMemo.value, notice, 'memo repeats the deposit sentence');
eq(payload.Line[0].DetailType, 'DescriptionOnly', 'notice is not a priced line');
const salesSum = payload.Line.filter((line) => line.DetailType === 'SalesItemLineDetail').reduce((sum, line) => sum + Math.round(line.Amount * 100), 0);
eq(salesSum, built.totalCents, 'QuickBooks amounts add up to the estimate');
eq(payload.Line.every((line) => line.DetailType !== 'SalesItemLineDetail' || line.SalesItemLineDetail.TaxCodeRef.value === 'NON'), true, 'lines are non-taxable so QuickBooks does not add tax');
eq(Math.round(dollars(188668) * 100), 188668, 'cents round trip');
eq(Math.round(dollars(-10050) * 100), -10050, 'negative cents round trip');

eq(feeCentsFor(188668), 7547, '4% of the deposit');
eq(money(7547), '$75.47', 'deposit fee label amount');
const withDepositFee = addStageFee(built.lines, 'deposit', quote.depositCents);
eq(withDepositFee.added, true, 'deposit fee is added once');
eq(withDepositFee.feeCents, 7547, 'deposit fee cents');
eq(withDepositFee.lines.at(-1).description, 'Card processing fee (4%) — deposit', 'deposit fee is labeled with its stage');
const again = addStageFee(withDepositFee.lines, 'deposit', quote.depositCents);
eq(again.added, false, 'pressing Pay by card twice does not add a second deposit fee');
eq(again.lines.filter((line) => line.kind === 'fee').length, 1, 'one deposit fee line');
eq(again.feeCents, 7547, 'the original fee is kept');

let state = {
  lines: built.lines,
  depositCents: quote.depositCents,
  balanceCents: quote.balanceCents,
  totalCents: built.totalCents,
  amountDueCents: built.totalCents,
  paidCents: 0,
  feeDepositCents: null,
  feeFinalCents: null,
  cardOn: false,
};
const depositFee = applyFeeState(state, 'deposit');
eq(depositFee.added, true, 'state records the deposit fee');
eq(depositFee.state.totalCents, quote.totalCents + 7547, 'invoice total grows by the deposit fee only');
eq(depositFee.state.amountDueCents, quote.totalCents + 7547, 'open balance includes the new fee');
state = depositFee.state;
const depositFeeAgain = applyFeeState(state, 'deposit');
eq(depositFeeAgain.added, false, 'stored deposit fee blocks a duplicate');
eq(depositFeeAgain.state.totalCents, state.totalCents, 'total does not grow on the second press');

const paidDeposit = applyPaymentState(state, quote.depositCents + 7547);
eq(paidDeposit.amountDueCents, quote.balanceCents, 'after the deposit and its fee, the open balance is the 40%');
eq(paymentView(paidDeposit).depositReceived, true, 'deposit is received once that amount is paid');
state = { ...state, ...paidDeposit, lines: state.lines };
const finalFee = applyFeeState(state, 'final');
eq(finalFee.baseCents, quote.balanceCents, 'final fee uses the remaining balance');
eq(finalFee.feeCents, feeCentsFor(quote.balanceCents), '4% of the remaining balance');
eq(finalFee.feeCents, 5031, 'final fee cents');
eq(findFeeLine(finalFee.state.lines, 'final').description, 'Card processing fee (4%) — final payment', 'final fee is labeled with its stage');
eq(finalFee.state.lines.filter((line) => line.kind === 'fee').length, 2, 'deposit and final fees are separate');
const finalAgain = applyFeeState(finalFee.state, 'final');
eq(finalAgain.added, false, 'final fee is not added twice');
eq(finalAgain.state.totalCents, finalFee.state.totalCents, 'second final press does not change the total');
eq(needsSendForLink({}), true, 'missing link asks for a send');
eq(needsSendForLink({ InvoiceLink: 'https://pay.example/1' }), false, 'a link is enough');

const fn = read('../supabase/functions/quickbooks-invoice/index.ts');
for (const needle of [
  'Do not send Invoice.Deposit',
  'AllowOnlineACHPayment: true',
  'AllowOnlineCreditCardPayment: true',
  'include=invoiceLink',
  '/send?sendTo',
  'QBO_MOCK',
  'not_connected',
  'com.intuit.quickbooks.accounting',
  'refresh_token: data.refresh_token || connection.refresh_token',
  'companyinfo',
  "action === 'enable-card'",
  "action === 'refresh'",
  "action === 'record-payment'",
  'stage',
  'auth.getUser',
  "profile?.role !== 'admin'",
]) {
  has(fn, needle, 'quickbooks function');
}
if (/Less: balance due/.test(fn) || /Create final invoice/.test(fn)) fail('final-invoice flow should be gone');
has(read('../supabase/config.toml'), '[functions.quickbooks-invoice]\nverify_jwt = true', 'function verifies the JWT');
has(read('../sw.js'), "const CACHE = 'nwd-sales-v56-pay-by-card';", 'cache name');
has(read('../sw.js'), 'js/vendor/qrcode.js', 'QR library is precached');
has(read('../js/pay.js'), 'Pay by card', 'pay button');
has(read('../js/pay.js'), 'Refresh payment status', 'refresh button');
has(read('../js/cloud.js'), "addOps(e.remoteId, ['contract', 'signed', 'qbo'])", 'queue includes QuickBooks');
has(read('../js/pages/contract.js'), 'recordSigned(e, { pdfBase64 })', 'signing passes the contract PDF');
has(read('../supabase/migrations/004_quickbooks.sql'), 'enable row level security', 'token table is locked');
has(read('../supabase/migrations/004_quickbooks.sql'), 'qbo_deposit_cents', 'deposit cents are stored');
has(read('../supabase/migrations/004_quickbooks.sql'), 'qbo_balance_cents', 'balance cents are stored');
if (/Create final invoice/.test(read('../js/pay.js') + read('../js/pages/contract.js') + read('../js/pages/estimate.js'))) fail('Create final invoice button should be gone');

if (process.exitCode) console.error('quickbooks invoice check failed');
else console.log('quickbooks invoice check ok');
