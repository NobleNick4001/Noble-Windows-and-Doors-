// Invoice math for the QuickBooks deposit flow. No network and no pricing.
// Deposit and balance cents come from the signed snapshot when it adds up.
// Otherwise this uses the same contractPay split as js/pdf.js.
// QuickBooks items and the NON tax code are resolved by the edge function
// from env (see docs/quickbooks-setup.md). This file does not hardcode item ids.

export function cents(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100);
}

export function dollars(centsValue) {
  return Number((Math.round(Number(centsValue) || 0) / 100).toFixed(2));
}

// Same cents split as contractPay in js/pdf.js. Do not change one without the other.
export function contractPay(total, depositPct = 60) {
  const centsTotal = Math.round((Number(total) || 0) * 100);
  const deposit = Math.round(centsTotal * (Number(depositPct) || 0) / 100);
  const balance = centsTotal - deposit;
  return {
    total: centsTotal / 100,
    deposit: deposit / 100,
    balance: balance / 100,
    totalCents: centsTotal,
    depositCents: deposit,
    balanceCents: balance,
  };
}

export function payFrom(total, depositPct = 60, snapshot) {
  const pct = Number(depositPct);
  const percent = Number.isFinite(pct) ? pct : 60;
  if (snapshot && snapshot.deposit != null && snapshot.balance != null && snapshot.total != null) {
    const totalCents = cents(snapshot.total);
    const depositCents = cents(snapshot.deposit);
    const balanceCents = cents(snapshot.balance);
    if (depositCents + balanceCents === totalCents) {
      return {
        total: totalCents / 100,
        deposit: depositCents / 100,
        balance: balanceCents / 100,
        totalCents,
        depositCents,
        balanceCents,
        source: 'snapshot',
      };
    }
    const again = contractPay(snapshot.total, percent);
    return { ...again, source: 'snapshot-total' };
  }
  return { ...contractPay(total, percent), source: 'contractPay' };
}

export function money(centsValue) {
  const n = Math.trunc(Number(centsValue) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const dollarsPart = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return sign + '$' + dollarsPart + '.' + frac;
}

export function depositNotice(pay, depositPct = 60) {
  const pct = Number(depositPct);
  const percent = Number.isFinite(pct) ? pct : 60;
  const rest = 100 - percent;
  return `${percent}% deposit of ${money(pay.depositCents)} due now, remaining ${money(pay.balanceCents)} (${rest}%) due at completion of work`;
}

export const FEE_LABEL = {
  deposit: 'Card processing fee (4%) — deposit',
  final: 'Card processing fee (4%) — final payment',
};

export function feeCentsFor(baseCents) {
  return Math.round((Math.round(Number(baseCents) || 0)) * 4 / 100);
}

function describeLine(line) {
  const qty = Number(line?.qty) || 1;
  const product = [line?.brand, line?.series, line?.type].filter(Boolean).join(' ');
  const size = (line?.w || line?.h) ? `${line.w}" x ${line.h}"` : '';
  const bits = [line?.label, product, line?.customDescription, size].filter(Boolean);
  if (qty > 1) bits.push('Qty ' + qty);
  return bits.join(' — ') || 'Window';
}

function applyDrift(lines, delta) {
  if (!delta) return;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].kind !== 'tax') {
      lines[i].amountCents += delta;
      return;
    }
  }
  if (lines.length) lines[lines.length - 1].amountCents += delta;
}

export function buildInvoice({ lines = [], extras = [], totals = {}, pay, depositPct = 60, descriptions = [] } = {}) {
  if (!pay || pay.totalCents == null) throw new Error('pay.totalCents is required');
  const priced = [];
  const windowLines = [];
  (lines || []).forEach((line, i) => {
    const qty = Number(line?.qty) || 0;
    const unitCents = cents(line?.unit);
    if (!qty && !unitCents) return;
    const amountCents = unitCents * (qty || 1);
    const custom = descriptions[i] ? String(descriptions[i]).trim() : '';
    windowLines.push({
      kind: 'window',
      description: custom || describeLine(line),
      qty: qty || 1,
      amountCents,
      itemKey: 'sales',
    });
  });
  const windowTarget = cents(totals.windows);
  const windowSum = windowLines.reduce((sum, line) => sum + line.amountCents, 0);
  if (windowLines.length) applyDrift(windowLines, windowTarget - windowSum);
  else if (windowTarget) {
    windowLines.push({ kind: 'window', description: 'Windows & doors', qty: 1, amountCents: windowTarget, itemKey: 'sales' });
  }
  priced.push(...windowLines);

  const discount = cents(totals.discount);
  if (discount) {
    priced.push({
      kind: 'discount',
      description: totals.discountLabel || 'Discount',
      qty: 1,
      amountCents: -discount,
      itemKey: 'sales',
    });
  }
  const percentOff = cents(totals.percentDiscountAmount);
  if (percentOff) {
    priced.push({
      kind: 'discount',
      description: totals.percentDiscountLabel || 'Additional discount',
      qty: 1,
      amountCents: -percentOff,
      itemKey: 'sales',
    });
  }
  const labor = cents(totals.labor);
  if (labor) priced.push({ kind: 'labor', description: 'Installation / Labor', qty: 1, amountCents: labor, itemKey: 'sales' });
  const shipping = cents(totals.shipping);
  if (shipping) priced.push({ kind: 'shipping', description: 'Shipping & Handling', qty: 1, amountCents: shipping, itemKey: 'sales' });

  const extraLines = [];
  (extras || []).forEach((extra) => {
    const amountCents = cents(extra?.amount);
    if (!amountCents && !String(extra?.label || '').trim()) return;
    extraLines.push({
      kind: 'extra',
      description: extra.label || 'Additional item',
      qty: 1,
      amountCents,
      itemKey: 'sales',
    });
  });
  const extraTarget = cents(totals.extras);
  const extraSum = extraLines.reduce((sum, line) => sum + line.amountCents, 0);
  if (extraLines.length) applyDrift(extraLines, extraTarget - extraSum);
  else if (extraTarget) extraLines.push({ kind: 'extra', description: 'Additional items', qty: 1, amountCents: extraTarget, itemKey: 'sales' });
  priced.push(...extraLines);

  const taxPct = totals.taxPct != null ? totals.taxPct : 9.1;
  const taxCents = cents(totals.tax);
  priced.push({ kind: 'tax', description: `Sales Tax (${taxPct}%)`, qty: 1, amountCents: taxCents, itemKey: 'tax' });

  const beforeTaxAlign = priced.reduce((sum, line) => sum + line.amountCents, 0);
  applyDrift(priced, pay.totalCents - beforeTaxAlign);

  const notice = depositNotice(pay, depositPct);
  const all = [{ kind: 'notice', description: notice, qty: 0, amountCents: 0, itemKey: null }, ...priced];
  const totalCents = priced.reduce((sum, line) => sum + line.amountCents, 0);
  return {
    notice,
    lines: all,
    totalCents,
    depositCents: pay.depositCents,
    balanceCents: pay.balanceCents,
  };
}

export function findFeeLine(lines, stage) {
  const label = FEE_LABEL[stage];
  if (!label) return null;
  return (lines || []).find((line) => (line.kind === 'fee' && line.stage === stage) || line.description === label || line.Description === label) || null;
}

export function addStageFee(lines, stage, baseCents) {
  const label = FEE_LABEL[stage];
  if (!label) throw new Error('stage must be deposit or final');
  const existing = findFeeLine(lines, stage);
  if (existing) {
    const feeCents = existing.amountCents != null ? existing.amountCents : cents(existing.Amount);
    return { lines: lines || [], added: false, feeCents, baseCents: Math.round(Number(baseCents) || 0), label };
  }
  const base = Math.round(Number(baseCents) || 0);
  const feeCents = feeCentsFor(base);
  const fee = { kind: 'fee', stage, description: label, qty: 1, amountCents: feeCents, itemKey: 'fee' };
  return { lines: [...(lines || []), fee], added: true, feeCents, baseCents: base, label };
}

// Column-backed idempotency. feeDepositCents / feeFinalCents null means that stage has no fee yet.
// 0 is a real fee (a zero deposit) and must not be added again.
export function applyFeeState(state, stage) {
  const key = stage === 'deposit' ? 'feeDepositCents' : stage === 'final' ? 'feeFinalCents' : '';
  if (!key) throw new Error('stage must be deposit or final');
  if (state[key] != null) {
    const baseCents = stage === 'deposit' ? state.depositCents : state.amountDueCents;
    return { state, added: false, feeCents: state[key], baseCents: Math.round(Number(baseCents) || 0) };
  }
  const baseCents = stage === 'deposit' ? state.depositCents : state.amountDueCents;
  if (baseCents == null) throw new Error('missing amount for ' + stage);
  const next = addStageFee(state.lines || [], stage, baseCents);
  if (!next.added) {
    return {
      state: { ...state, [key]: next.feeCents, cardOn: true },
      added: false,
      feeCents: next.feeCents,
      baseCents: next.baseCents,
    };
  }
  return {
    state: {
      ...state,
      lines: next.lines,
      [key]: next.feeCents,
      cardOn: true,
      totalCents: (state.totalCents || 0) + next.feeCents,
      amountDueCents: (state.amountDueCents || 0) + next.feeCents,
    },
    added: true,
    feeCents: next.feeCents,
    baseCents: next.baseCents,
  };
}

export function applyPaymentState(state, amountCents) {
  const amt = Math.round(Number(amountCents) || 0);
  const paidCents = (state.paidCents || 0) + amt;
  return {
    ...state,
    paidCents,
    amountDueCents: (state.totalCents || 0) - paidCents,
  };
}

export function paymentView({ paidCents = 0, depositCents = 0, amountDueCents = 0 } = {}) {
  const paid = Math.round(Number(paidCents) || 0);
  const deposit = Math.round(Number(depositCents) || 0);
  const due = Math.round(Number(amountDueCents) || 0);
  return {
    paidCents: paid,
    depositCents: deposit,
    amountDueCents: due,
    depositReceived: paid >= deposit,
    depositShortCents: Math.max(0, deposit - paid),
  };
}

export function toQboLines(lines, items, taxCode = 'NON') {
  return (lines || []).map((line) => {
    if (line.kind === 'notice') {
      return {
        DetailType: 'DescriptionOnly',
        Description: line.description,
        DescriptionLineDetail: {},
      };
    }
    const amount = dollars(line.amountCents);
    const item = (line.itemKey && items?.[line.itemKey]) || items?.sales;
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: amount,
      Description: line.description,
      SalesItemLineDetail: {
        ItemRef: { value: String(item?.id || ''), name: item?.name || '' },
        Qty: 1,
        UnitPrice: amount,
        TaxCodeRef: { value: taxCode },
      },
    };
  });
}

// Full-amount invoice. ACH only. Do not send Invoice.Deposit — that field records
// money already received and is not a request for the 60% deposit.
export function invoicePayload({ built, customerId, email, docNumber, items, taxCode }) {
  const payload = {
    CustomerRef: { value: String(customerId) },
    CustomerMemo: { value: built.notice },
    PrivateNote: built.notice,
    AllowOnlineACHPayment: true,
    AllowOnlineCreditCardPayment: false,
    Line: toQboLines(built.lines, items, taxCode),
  };
  if (docNumber) payload.DocNumber = docNumber;
  if (email) payload.BillEmail = { Address: email };
  return payload;
}

export function cardUpdatePayload({ invoiceId, syncToken, existingLines, feeLine, items, taxCode }) {
  return {
    Id: String(invoiceId),
    SyncToken: String(syncToken),
    sparse: true,
    AllowOnlineACHPayment: true,
    AllowOnlineCreditCardPayment: true,
    Line: [...(existingLines || []), ...toQboLines([feeLine], items, taxCode)],
  };
}

export function paymentPayload({ customerId, invoiceId, amountCents }) {
  const amount = dollars(amountCents);
  return {
    CustomerRef: { value: String(customerId) },
    TotalAmt: amount,
    Line: [{
      Amount: amount,
      LinkedTxn: [{ TxnId: String(invoiceId), TxnType: 'Invoice' }],
    }],
  };
}

export function needsSendForLink(invoice) {
  return !String(invoice?.InvoiceLink || invoice?.invoiceLink || '').trim();
}
