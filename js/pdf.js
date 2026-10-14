// Builds the contract PDF and the estimate PDF in the browser (no server).
import { fmt, totals, summaryLines, settings, data, compactWindowLine, windowSections } from './core.js';

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function chunk(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + chunk(n % 100) : '');
}
function words(n) {
  if (!n) return 'zero';
  const parts = [];
  for (const [name, v] of [['billion', 1e9], ['million', 1e6], ['thousand', 1e3]]) {
    if (n >= v) { parts.push(chunk(Math.floor(n / v)) + ' ' + name); n %= v; }
  }
  if (n) parts.push(chunk(n));
  return parts.join(' ');
}
export function moneyWords(amount) {
  const cents = Math.round(Math.abs(Number(amount) || 0) * 100);
  const dollars = Math.floor(cents / 100);
  const c = String(cents % 100).padStart(2, '0');
  const text = words(dollars);
  return text.charAt(0).toUpperCase() + text.slice(1) + ` and ${c}/100`;
}
export function contractPay(total, depositPct = 60) {
  const cents = Math.round((Number(total) || 0) * 100);
  const deposit = Math.round(cents * (Number(depositPct) || 0) / 100);
  return { total: cents / 100, deposit: deposit / 100, balance: (cents - deposit) / 100 };
}

const plain = (s) => String(s ?? '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/×/g, 'x').replace(/\u00a0/g, ' ');

function jsPDF() {
  const lib = window.jspdf;
  if (!lib?.jsPDF) throw new Error('PDF library did not load');
  return new lib.jsPDF({ unit: 'pt', format: 'letter', compress: true });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 320;
      const scale = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve({ data: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height, fmt: 'JPEG' });
    };
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

function writer(doc) {
  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;
  function newPage() { doc.addPage(); y = margin; }
  function need(h) { if (y + h > pageH - 36) newPage(); }
  function text(str, { size = 10, bold = false, gap = 3, indent = 0, color = [17, 17, 17] } = {}) {
    const body = plain(str);
    if (!body) { y += gap; return; }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(body, maxW - indent);
    const lh = size + 2.5;
    if (y + lines.length * lh > pageH - 36) newPage();
    doc.text(lines, margin + indent, y + size);
    y += lines.length * lh + gap;
  }
  function rule() {
    need(8);
    doc.setDrawColor(242, 140, 40);
    doc.setLineWidth(2);
    doc.line(margin, y, pageW - margin, y);
    y += 10;
  }
  function image(dataUrl, w, h) {
    if (!dataUrl) return;
    need(h + 4);
    try { doc.addImage(dataUrl, 'PNG', margin, y, w, h); } catch { return; }
    y += h + 4;
  }
  function pair(left, right, { size = 10, bold = false, gap = 0, color = [17, 17, 17] } = {}) {
    const leftBody = plain(left);
    const rightBody = plain(right);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    const rightW = rightBody ? doc.getTextWidth(rightBody) + 10 : 0;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = leftBody ? doc.splitTextToSize(leftBody, Math.max(40, maxW - rightW)) : [''];
    const lh = size + 2.5;
    if (y + lines.length * lh > pageH - 36) newPage();
    doc.setTextColor(...color);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    if (leftBody) doc.text(lines, margin, y + size);
    if (rightBody) {
      doc.setFont('helvetica', 'bold');
      doc.text(rightBody, pageW - margin, y + size, { align: 'right' });
    }
    y += Math.max(lines.length, 1) * lh + gap;
  }
  return { text, pair, rule, image, need, newPage, get y() { return y; }, set y(v) { y = v; }, margin, maxW, pageW, pageH, doc };
}

async function drawHeader(w, company) {
  let logo = null;
  try { logo = await loadImage('assets/noble-logo-trim.png'); } catch { /* header text still prints */ }
  const top = w.y;
  let textTop = top;
  if (logo) {
    const h = 34;
    const lw = Math.min(150, h * (logo.w / logo.h));
    try { w.doc.addImage(logo.data, logo.fmt || 'PNG', w.margin, top, lw, h); } catch { /* ignore */ }
    textTop = top + 2;
  }
  const lines = [company.name, company.address, company.phone, company.email, ...(String(company.license || '').split('\n').map((s) => s.trim()).filter(Boolean)), company.hours].filter(Boolean);
  w.doc.setFont('helvetica', 'normal');
  w.doc.setFontSize(8);
  w.doc.setTextColor(17, 17, 17);
  lines.forEach((line, i) => {
    w.doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
    w.doc.text(plain(line), w.pageW - w.margin, textTop + 9 + i * 10, { align: 'right' });
  });
  w.y = Math.max(top + (logo ? 40 : 0), textTop + lines.length * 10) + 6;
  w.rule();
}

const fdate = (t) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

function sigBlock(w, label, dataUrl, when) {
  w.text(label, { size: 11, bold: true, gap: 2 });
  if (dataUrl) w.image(dataUrl, Math.min(w.maxW, 280), 64);
  else {
    w.need(16);
    w.doc.setDrawColor(80, 80, 80);
    w.doc.setLineWidth(0.6);
    w.doc.line(w.margin, w.y + 10, w.margin + 220, w.y + 10);
    w.y += 16;
  }
  w.text('Date: ' + (when ? fdate(when) : fdate(Date.now())), { size: 9, gap: 8, color: [40, 40, 40] });
}

export async function makeContractPdf(model) {
  const doc = jsPDF();
  const w = writer(doc);
  const a = model.agreement;
  const co = model.company;
  await drawHeader(w, co);
  w.text(a.title, { size: 16, bold: true, gap: 6, color: [29, 117, 188] });
  w.text('Estimate # ' + model.number, { size: 10, gap: 8 });
  const row = (label, value) => w.text(label + '  ' + (value || '—'), { size: 11, gap: 4 });
  row('Submitted by:', model.submittedBy);
  row('Contract submitted to:', model.customer.name);
  row('Property address:', model.customer.address);
  row('Home Phone and/ or cell phone:', model.customer.phone);
  row('Email Address:', model.customer.email);
  w.text('Specifications of work needed:', { size: 11, bold: true, gap: 1 });
  w.text(model.specifications || '—', { size: 11, gap: 6 });
  if ((model.lines || []).length) {
    w.text('Windows', { size: 11, bold: true, gap: 2 });
    writeCompactWindows(w, model.lines);
  }
  row('Estimated completion date:', model.completionDate ? fdate(model.completionDate + 'T12:00:00') : '');
  (model.summary || []).forEach((line) => w.text(line.label + '  ' + fmt(line.amount), { size: 11, gap: 1 }));
  w.text('Project Total Cost  ' + fmt(model.pay.total), { size: 12, bold: true, gap: 3 });
  w.text(a.depositLabel + '  ' + fmt(model.pay.deposit), { size: 11, gap: 2 });
  w.text(a.balanceLabel + '  ' + fmt(model.pay.balance), { size: 11, gap: 8 });
  w.text(a.promise, { size: 10, gap: 4 });
  w.text(model.words + ' Dollars (' + fmt(model.pay.total) + ').', { size: 11, bold: true, gap: 4 });
  w.text(a.payNote, { size: 10, bold: true, gap: 6 });
  w.text(a.initialLead, { size: 10, gap: 2 });
  if (model.initials) {
    w.image(model.initials, 180, 48);
    w.text('Date: ' + fdate(model.signedOn.initials || Date.now()), { size: 9, gap: 4 });
  }
  w.text(a.initialRest, { size: 10, gap: 6 });
  w.text(a.ack, { size: 10, gap: 8 });
  sigBlock(w, 'Purchaser 1', model.signatures.p1a, model.signedOn.p1a);
  sigBlock(w, 'Purchaser 2' + (model.signatures.p2a ? '' : ' (optional)'), model.signatures.p2a, model.signedOn.p2a);

  w.newPage();
  await drawHeader(w, co);
  w.text(a.termsTitle, { size: 13, bold: true, gap: 6, color: [29, 117, 188] });
  a.clauses.forEach((clause, i) => w.text((i + 1) + '.  ' + clause, { size: 8.5, gap: 3 }));
  w.y += 6;
  sigBlock(w, 'Purchaser 1', model.signatures.p1b, model.signedOn.p1b);
  sigBlock(w, 'Purchaser 2' + (model.signatures.p2b ? '' : ' (optional)'), model.signatures.p2b, model.signedOn.p2b);
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text('Page ' + i + ' of ' + pages, w.pageW - w.margin, w.pageH - 22, { align: 'right' });
  }
  return doc.output('blob');
}

function writeCompactWindows(w, lines) {
  for (const section of windowSections(lines)) {
    w.text(section.brandName, { size: 11, bold: true, gap: 2, color: [29, 117, 188] });
    for (const l of section.lines) {
      const row = compactWindowLine(l, { includeBrand: false, ascii: true });
      w.pair(row.title, fmt(row.price), { size: 10, bold: true, gap: 0 });
      w.text(row.detail, { size: 8, gap: 4, color: [92, 101, 112] });
    }
  }
}

export async function makeEstimatePdf(e) {
  const doc = jsPDF();
  const w = writer(doc);
  const t = totals(e);
  const co = settings.company;
  await drawHeader(w, co);
  w.text('ESTIMATE', { size: 16, bold: true, gap: 4, color: [29, 117, 188] });
  w.text('Estimate # ' + e.number, { size: 10, gap: 1 });
  w.text('Date: ' + fdate(e.created), { size: 10, gap: 1 });
  const valid = new Date(e.created + (e.validDays || 30) * 86400000);
  w.text('Valid through: ' + fdate(valid), { size: 10, gap: 6 });
  w.text('Prepared for', { size: 10, bold: true, gap: 1 });
  w.text([e.customer?.name, e.customer?.address, e.customer?.phone, e.customer?.email].filter(Boolean).join('\n') || '—', { size: 10, gap: 8 });

  w.text('Windows (materials, including glass)', { size: 12, bold: true, gap: 3, color: [29, 117, 188] });
  writeCompactWindows(w, e.lines);
  w.text('Windows subtotal  ' + fmt(t.windows), { size: 10, bold: true, gap: 2 });
  if (t.promo?.windowAmount) w.text(t.discountLabel + '  ' + fmt(-t.promo.windowAmount), { size: 10, bold: true, gap: 2 });
  if (t.percentDiscountAmount) w.text(t.percentDiscountLabel + '  ' + fmt(-t.percentDiscountAmount), { size: 10, bold: true, gap: 4 });

  if ((e.extras || []).length) {
    w.text('Additional items', { size: 12, bold: true, gap: 3, color: [29, 117, 188] });
    e.extras.forEach((x) => w.text(`${x.label}  ${fmt(Number(x.amount) || 0)}`, { size: 10, gap: 2 }));
    w.text('Additional items subtotal  ' + fmt(t.extras), { size: 10, bold: true, gap: 4 });
  }

  summaryLines(t, { includeMaterials: false }).forEach((line) => w.text(line.label + '  ' + fmt(line.amount), { size: 11, gap: 1 }));
  w.text('TOTAL  ' + fmt(t.total), { size: 13, bold: true, gap: 2 });
  const pct = Number(data.agreement?.depositPct) || 60;
  const pay = contractPay(t.total, pct);
  w.text(`Deposit (${pct}%)  ${fmt(pay.deposit)}`, { size: 11, gap: 1 });
  w.text(`Final (${100 - pct}%)  ${fmt(pay.balance)}`, { size: 11, gap: 4 });
  if (e.notes) { w.text('Notes', { size: 11, bold: true, gap: 1 }); w.text(e.notes, { size: 9, gap: 6 }); }
  w.text('Terms', { size: 11, bold: true, gap: 1 });
  w.text(settings.terms || '', { size: 8, gap: 4 });
  return doc.output('blob');
}
