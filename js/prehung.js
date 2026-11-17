// Interior prehung doors (Steves, OrePac Phoenix OP-PH-1122).
// Prices live in data/prehung-doors.json and are already customer prices.
// Labor is returned separately so the estimate can keep one Installation total.

export function isPrehungLine(line) {
  return !!(line && (line.brand === 'prehung' || line.pricingMode === 'prehung'));
}

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const byId = (list, id) => (list || []).find((item) => item.id === id) || null;

export function defaultPrehungSheet(catalog) {
  const labor = (catalog?.labor || []).filter((item) => item.defaultOn).map((item) => item.id);
  const core = catalog?.cores?.[0]?.id || 'solid';
  const styles = stylesFor(catalog, core);
  return {
    core,
    style: styles[0]?.id || '1-panel',
    height: catalog?.heights?.[0]?.id || '6-8',
    jamb: 'standard',
    options: [],
    double: false,
    labor: labor.length ? labor : ['install'],
  };
}

export function stylesFor(catalog, core) {
  return (catalog?.styles || []).filter((style) => (style.cores || []).includes(core));
}

export function normalizePrehungSheet(catalog, sheet) {
  const next = { ...defaultPrehungSheet(catalog), ...(sheet || {}) };
  const cores = catalog?.cores || [];
  if (!cores.some((core) => core.id === next.core)) next.core = cores[0]?.id || 'solid';
  const styles = stylesFor(catalog, next.core);
  if (!styles.some((style) => style.id === next.style)) next.style = styles[0]?.id || next.style;
  const heights = catalog?.heights || [];
  if (!heights.some((height) => height.id === next.height)) next.height = heights[0]?.id || '6-8';
  const jambs = catalog?.jambs || [];
  if (!jambs.some((jamb) => jamb.id === next.jamb)) next.jamb = jambs[0]?.id || 'standard';
  const knownOpt = new Set((catalog?.options || []).map((opt) => opt.id));
  next.options = [...new Set(next.options || [])].filter((id) => knownOpt.has(id));
  const knownLabor = new Set((catalog?.labor || []).map((item) => item.id));
  next.labor = [...new Set(next.labor || [])].filter((id) => knownLabor.has(id));
  next.double = !!next.double;
  return next;
}

export function pricePrehung(catalog, spec) {
  const sheet = normalizePrehungSheet(catalog, spec);
  const core = byId(catalog?.cores, sheet.core);
  const base = Number(core?.prices?.[sheet.height]) || 0;
  let material = base;
  material += Number(byId(catalog?.jambs, sheet.jamb)?.add?.[sheet.height]) || 0;
  const on = new Set(sheet.options);
  for (const opt of catalog?.options || []) {
    if (!on.has(opt.id)) continue;
    if (opt.addByCore) material += Number(opt.addByCore[sheet.core]) || 0;
    else if (opt.addByHeight) material += Number(opt.addByHeight[sheet.height]) || 0;
    else material += Number(opt.add) || 0;
  }
  if (sheet.double) {
    const extra = Number(catalog?.doubleDoor?.add?.[sheet.core]?.[sheet.height]) || 0;
    if (catalog?.doubleDoor?.mode === 'replace') material = material - base + extra;
    else material += extra;
  }
  const laborOn = new Set(sheet.labor);
  let labor = 0;
  for (const item of catalog?.labor || []) {
    if (laborOn.has(item.id)) labor += Number(item.price) || 0;
  }
  return { material: cents(material), labor: cents(labor), base: cents(base) };
}

export function prehungImage(catalog, spec) {
  const style = byId(catalog?.styles, spec?.style);
  return style?.image?.[spec?.core] || '';
}

export function prehungSummary(catalog, line) {
  const spec = line?.prehung || line || {};
  const core = byId(catalog?.cores, spec.core);
  const style = byId(catalog?.styles, spec.style);
  const title = [core?.name, style?.name, core?.detail].filter(Boolean).join(' · ');
  const parts = [];
  const width = byId(catalog?.widths, line?.widthId);
  const height = byId(catalog?.heights, spec.height);
  const handing = byId(catalog?.handings, line?.handing);
  if (width) parts.push(width.label);
  if (height) parts.push(height.label);
  if (handing) parts.push(handing.name);
  const jamb = byId(catalog?.jambs, spec.jamb);
  if (jamb && jamb.id !== 'standard') parts.push(`${jamb.name} jamb`);
  for (const id of spec.options || []) {
    const opt = byId(catalog?.options, id);
    if (opt) parts.push(opt.name);
  }
  if (spec.double) parts.push('Double door');
  return { title, detail: parts.join(' · '), parts };
}

export function prehungSizeText(catalog, line, { ascii = false } = {}) {
  const spec = line?.prehung || {};
  const width = byId(catalog?.widths, line?.widthId);
  const height = byId(catalog?.heights, spec.height);
  const times = ascii ? 'x' : '×';
  if (width && height) return `${width.label} ${times} ${height.label}`;
  return '';
}

export function prehungCompactLine(catalog, line, { ascii = false } = {}) {
  const summary = prehungSummary(catalog, line);
  const qty = Number(line?.qty) || 1;
  const size = prehungSizeText(catalog, line, { ascii });
  return {
    title: `${line?.label || 'Door'} — ${summary.title}`.trim(),
    detail: [size, summary.detail, `Qty ${qty}`].filter(Boolean).join(' · '),
    price: (Number(line?.unit) || 0) * qty,
    priceText: '',
    brandName: 'Prehung doors',
  };
}

export function prehungQuoteLine(catalog, line, { ascii = false } = {}) {
  const summary = prehungSummary(catalog, line);
  const qty = Number(line?.qty) || 1;
  return {
    location: line?.label || 'Door',
    title: summary.title || 'Prehung door',
    details: summary.parts,
    size: prehungSizeText(catalog, line, { ascii }),
    qty,
    price: (Number(line?.unit) || 0) * qty,
    priceText: '',
  };
}

export function applyPrehungSheet(catalog, line, sheet) {
  const spec = normalizePrehungSheet(catalog, sheet);
  const priced = pricePrehung(catalog, spec);
  const height = byId(catalog?.heights, spec.height);
  line.brand = 'prehung';
  line.series = 'interior';
  line.type = spec.style;
  line.pricingMode = 'prehung';
  line.prehung = {
    core: spec.core,
    style: spec.style,
    height: spec.height,
    jamb: spec.jamb,
    options: [...spec.options],
    double: spec.double,
    labor: [...spec.labor],
  };
  if (height) line.h = height.inches;
  line.unit = priced.material;
  line.unitBase = priced.material;
  line.optionsEach = 0;
  line.installUnit = priced.labor;
  line.install = { type: 'prehung', surcharges: [], override: null, custom: null, frameType: null };
  line.options = [];
  line.addons = [];
  line.qty = Math.max(1, parseInt(line.qty, 10) || 1);
  line.unitsPerLine = 1;
  line.pricePending = false;
  line.provisional = false;
  line.unavailable = false;
  line.unpriced = false;
  line.estimated = false;
  line.supplierPrice = null;
  line.color = '';
  return line;
}

export function setPrehungWidth(catalog, line, widthId) {
  const width = byId(catalog?.widths, widthId) || catalog?.widths?.[0];
  if (!width) return line;
  line.widthId = width.id;
  line.w = width.inches;
  return line;
}
