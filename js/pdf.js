// Builds the contract PDF and the estimate PDF in the browser (no server).
import { fmt, totals, summaryLines, settings, data, compactWindowLine, windowSections, quoteLine } from './core.js';
import { currentProfile } from './cloud.js';

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

const QUOTE_ROC = 'ROC #364772 / #364771';

function salesRep(explicit) {
  const given = String(explicit || '').trim();
  if (given) return given;
  const profile = currentProfile() || {};
  return profile.full_name || profile.email || settings.salesperson || '';
}

function customerLines(e) {
  const c = e.customer || {};
  return [c.name, c.address, c.phone, c.email].map((s) => String(s || '').trim()).filter(Boolean);
}

export async function makeEstimatePdf(e, opts = {}) {
  const doc = jsPDF();
  const margin = 36;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const right = pageW - margin;
  const width = right - margin;
  const cols = [
    { key: 'num', label: '#', w: 26, align: 'center' },
    { key: 'location', label: 'Location', w: 86, align: 'left' },
    { key: 'desc', label: 'Description', w: 214, align: 'left' },
    { key: 'size', label: 'Size', w: 86, align: 'left' },
    { key: 'qty', label: 'Qty', w: 34, align: 'center' },
    { key: 'price', label: 'Price', w: width - 26 - 86 - 214 - 86 - 34, align: 'right' },
  ];
  const t = totals(e);
  const co = settings.company || {};
  const rep = salesRep(opts.repName);
  let y = margin;

  const rule = (y0, weight = 0.6, color = [14, 58, 99]) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(weight);
    doc.line(margin, y0, right, y0);
  };
  const wrapped = (text, max, size, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    return doc.splitTextToSize(plain(text), max);
  };

  function drawLetterhead() {
    let logo = null;
    const top = y;
    let leftBottom = top;
    return loadImage('assets/noble-logo-trim.png').then((img) => { logo = img; }).catch(() => {}).then(() => {
      if (logo) {
        const h = 36;
        const lw = Math.min(150, h * (logo.w / logo.h));
        try { doc.addImage(logo.data, logo.fmt || 'JPEG', margin, top, lw, h); } catch { /* text header still prints */ }
        leftBottom = top + h + 6;
      }
      const company = [co.name || 'Noble Windows & Doors LLC', co.address, co.phone || '(623) 810-3460', QUOTE_ROC].filter(Boolean);
      company.forEach((line, i) => {
        const lines = wrapped(line, 250, i === 0 ? 11 : 8, i === 0);
        doc.setTextColor(14, 58, 99);
        doc.text(lines, margin, leftBottom + (i === 0 ? 11 : 8));
        leftBottom += lines.length * (i === 0 ? 13 : 10);
      });
      const boxW = 230;
      const boxX = right - boxW;
      const who = customerLines(e);
      const rows = [
        ['Quote #', e.number || ''],
        ['Date', fdate(e.created)],
        ['Customer', who.length ? who.join('\n') : '—'],
        ['Sales rep', rep || '—'],
      ];
      doc.setFillColor(14, 58, 99);
      doc.rect(boxX, top, boxW, 18, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text('QUOTE', boxX + boxW / 2, top + 13, { align: 'center' });
      let by = top + 18;
      rows.forEach(([label, value]) => {
        const valueLines = wrapped(value, boxW - 78, 8, false);
        const rowH = Math.max(16, valueLines.length * 10 + 6);
        doc.setDrawColor(14, 58, 99);
        doc.setLineWidth(0.6);
        doc.rect(boxX, by, boxW, rowH);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(14, 58, 99);
        doc.text(label, boxX + 6, by + 11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(17, 17, 17);
        doc.text(valueLines, boxX + 70, by + 11);
        by += rowH;
      });
      y = Math.max(leftBottom, by) + 12;
      rule(y - 6, 1.4);
    });
  }

  function headerRow() {
    let x = margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(14, 58, 99);
    cols.forEach((col) => {
      const tx = col.align === 'right' ? x + col.w - 2 : col.align === 'center' ? x + col.w / 2 : x + 2;
      doc.text(col.label.toUpperCase(), tx, y + 11, { align: col.align === 'left' ? 'left' : col.align });
      x += col.w;
    });
    y += 16;
    rule(y, 1);
    y += 6;
  }

  await drawLetterhead();
  headerRow();

  const items = (e.lines || []).map((line, i) => ({ n: i + 1, ...quoteLine(line, { ascii: true }) }));
  (e.extras || []).forEach((extra) => {
    items.push({
      n: items.length + 1,
      location: '',
      title: extra.label || 'Additional item',
      details: [],
      size: '',
      qty: 1,
      price: Number(extra.amount) || 0,
    });
  });

  function rowHeight(item) {
    const descW = cols[2].w - 6;
    const title = wrapped(item.title, descW, 9, true);
    const rest = item.details.flatMap((d) => wrapped(d, descW, 8, false));
    const loc = wrapped(item.location || '', cols[1].w - 4, 8, false);
    const size = wrapped(item.size || '', cols[3].w - 4, 8, false);
    const h = Math.max(24, title.length * 11 + rest.length * 10 + 10, loc.length * 10 + 10, size.length * 10 + 10);
    return { title, rest, loc, size, h };
  }

  items.forEach((item) => {
    const drawn = rowHeight(item);
    if (y + drawn.h > pageH - 40) {
      doc.addPage();
      y = margin;
      headerRow();
    }
    let x = margin;
    const base = y + 10;
    doc.setTextColor(17, 17, 17);
    const paint = (text, col, yy, size, bold, align) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const tx = align === 'right' ? x + col.w - 2 : align === 'center' ? x + col.w / 2 : x + 2;
      doc.text(text, tx, yy, { align: align === 'left' ? 'left' : align });
    };
    paint(String(item.n), cols[0], base, 8, false, 'center');
    x += cols[0].w;
    drawn.loc.forEach((line, i) => paint(line, cols[1], base + i * 10, 8, false, 'left'));
    x += cols[1].w;
    let dy = 0;
    drawn.title.forEach((line) => { paint(line, cols[2], base + dy, 9, true, 'left'); dy += 11; });
    drawn.rest.forEach((line) => { paint(line, cols[2], base + dy, 8, false, 'left'); dy += 10; });
    x += cols[2].w;
    drawn.size.forEach((line, i) => paint(line, cols[3], base + i * 10, 8, false, 'left'));
    x += cols[3].w;
    paint(String(item.qty), cols[4], base, 8, false, 'center');
    x += cols[4].w;
    paint(fmt(item.price), cols[5], base, 8, true, 'right');
    y += drawn.h;
    rule(y, 0.4, [197, 205, 214]);
    y += 4;
  });

  const pct = Number(data.agreement?.depositPct) || 60;
  const pay = contractPay(t.total, pct);
  const totalRows = [
    ...summaryLines(t).map((row) => ({ label: row.label, value: fmt(row.amount), strong: false })),
    { label: 'TOTAL', value: fmt(t.total), strong: true },
    { label: `Deposit (${pct}%)`, value: fmt(pay.deposit), strong: false },
    { label: `Final (${100 - pct}%)`, value: fmt(pay.balance), strong: false },
  ];
  const boxW = 250;
  const boxH = totalRows.length * 16 + 8;
  if (y + boxH > pageH - 36) { doc.addPage(); y = margin; }
  y += 8;
  totalRows.forEach((row) => {
    doc.setFont('helvetica', row.strong ? 'bold' : 'normal');
    doc.setFontSize(row.strong ? 11 : 9);
    doc.setTextColor(17, 17, 17);
    if (row.strong) { rule(y, 1.2, [17, 17, 17]); y += 4; }
    doc.text(plain(row.label), right - boxW, y + 11);
    doc.text(row.value, right, y + 11, { align: 'right' });
    y += 16;
  });
  y += 8;
  if (e.notes) {
    const notes = wrapped(e.notes, width, 8, false);
    if (y + notes.length * 10 > pageH - 36) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(14, 58, 99);
    doc.text('Notes', margin, y + 10);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(17, 17, 17);
    doc.text(notes, margin, y + 8);
    y += notes.length * 10 + 8;
  }
  const terms = wrapped(settings.terms || '', width, 7.5, false);
  if (y + 16 + terms.length * 9 > pageH - 28) { doc.addPage(); y = margin; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(14, 58, 99);
  doc.text('Terms', margin, y + 10);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(17, 17, 17);
  doc.text(terms, margin, y + 8);
  return doc.output('blob');
}
