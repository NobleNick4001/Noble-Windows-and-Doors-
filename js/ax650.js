// Milgard AX650 stacking and bifold doors.
// Amounts in data/milgard-ax650.json are final customer prices from OneLink quote
// MQPASG000219-1. The 45% margin is already included. applyMargin is false, so this
// module returns those amounts unchanged. It does not call marginFactor().
const EPS = 1e-6;
const UNI = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };

export const AX650_SERIES = 'AX650';

// Customer install price. applyMargin must stay false, so this is not marked up.
// PRL doors use this same schedule, by panel count, through ax650PanelInstall.
export function ax650PanelInstall(cat, panels) {
  const book = ax650Catalog(cat);
  const labor = book?.install;
  const n = Number(panels) || 0;
  if (!book || !labor || labor.applyMargin !== false || labor.pricesAre !== 'customer' || n < 1) return 0;
  return Math.round(((Number(labor.flat) || 0) + (Number(labor.perPanel) || 0) * n) * 100) / 100;
}
export function ax650Install(cat, line) {
  return ax650PanelInstall(cat, ax650Model(ax650Catalog(cat), line?.type)?.panels);
}

export function isAx650Line(line) {
  return !!(line && line.brand === 'milgard' && String(line.series) === AX650_SERIES);
}

export function ax650Catalog(cat) {
  return cat && cat.pricesAre === 'customer' && Array.isArray(cat.models) ? cat : null;
}

export function ax650Model(cat, type) {
  const id = String(type || '');
  return (ax650Catalog(cat)?.models || []).find((m) => m.id === id) || null;
}

export function ax650ColorName(cat, colorId) {
  return ax650Catalog(cat)?.colors?.find((c) => c.id === colorId)?.name || '';
}

// Digits, one decimal, spaces, a slash, and the eighths the other size fields print.
export function inchField(raw) {
  const cleaned = String(raw ?? '').replace(/[^0-9.\s/½¼¾⅛⅜⅝⅞]/g, '').replace(/\s+/g, ' ');
  const i = cleaned.indexOf('.');
  return i < 0 ? cleaned : cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, '');
}

// Same decimal the other builders accept, plus a mixed fraction such as 141 15/16 or 107 1/2.
export function parseInches(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  let s = String(raw ?? '').trim().replace(/["″”“]/g, '');
  if (!s) return NaN;
  s = s.replace(/[½¼¾⅛⅜⅝⅞]/g, (ch) => ` ${UNI[ch]}`).replace(/\s+/g, ' ').trim();
  const mixed = s.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const den = Number(mixed[3]);
    if (!den) return NaN;
    return Number(mixed[1]) + Number(mixed[2]) / den;
  }
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const den = Number(frac[2]);
    if (!den) return NaN;
    return Number(frac[1]) / den;
  }
  if (!/^\d+(?:\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function formatInchLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  let whole = Math.floor(abs + 1e-9);
  const sixteenths = Math.round((abs - whole) * 16);
  if (Math.abs((abs - whole) * 16 - sixteenths) < 0.02) {
    let num = sixteenths;
    if (num === 16) return `${sign}${whole + 1}"`;
    if (num === 0) return `${sign}${whole}"`;
    let den = 16;
    while (num % 2 === 0 && den % 2 === 0) { num /= 2; den /= 2; }
    const frac = `${num}/${den}`;
    return whole ? `${sign}${whole} ${frac}"` : `${sign}${frac}"`;
  }
  const rounded = Math.round(abs * 1000) / 1000;
  return `${sign}${rounded}"`;
}

function cents(n) {
  return Math.round(Number(n) * 100) / 100;
}

function inRange(n, min, max) {
  return n >= Number(min) - EPS && n <= Number(max) + EPS;
}

export function ax650BandIndex(cat, h) {
  const bands = ax650Catalog(cat)?.height?.bands || [];
  for (let i = 0; i < bands.length; i++) {
    if (h <= Number(bands[i].upTo) + EPS) return i;
  }
  return -1;
}

const KIND_LABEL = { stacking: 'Stacking', pocket: 'Pocket', bifold: 'Bifold' };

export function ax650Groups(cat) {
  const groups = [];
  for (const model of ax650Catalog(cat)?.models || []) {
    let group = groups.find((g) => g.kind === model.kind);
    if (!group) {
      group = { kind: model.kind, name: KIND_LABEL[model.kind] || model.kind, models: [] };
      groups.push(group);
    }
    group.models.push(model);
  }
  return groups;
}

export function ax650Description(cat, line) {
  const model = ax650Model(cat, line?.type);
  const w = parseInches(line?.w);
  const h = parseInches(line?.h);
  return {
    style: model?.name || String(line?.type || 'AX650'),
    color: ax650ColorName(cat, line?.color) || 'White',
    glass: ax650Catalog(cat)?.glass || 'Tempered SunCoatMAX',
    daylight: !!model?.width?.daylight,
    size: `${formatInchLabel(w)} × ${formatInchLabel(h)}`,
  };
}

// Customer price for one door. No margin is applied when applyMargin is false.
export function ax650Quote(cat, line) {
  const book = ax650Catalog(cat);
  const empty = { errors: [], notes: [], material: 0, band: null, unsized: true, pricePending: false, unavailable: false, limits: null };
  if (!book) return { ...empty, unsized: false, errors: ['AX650 prices did not load.'] };
  if (book.applyMargin !== false || book.pricesAre !== 'customer') {
    return { ...empty, unsized: false, errors: ['AX650 prices are customer prices and cannot be marked up again.'] };
  }
  const model = ax650Model(book, line?.type);
  const height = book.height || {};
  const limits = model ? {
    wmin: model.width.min, wmax: model.width.max, hmin: height.min, hmax: height.max,
    hintW: model.width.label, hintH: height.label,
  } : null;
  if (!model) return { ...empty, unsized: false, limits, errors: ['This AX650 model is not offered.'] };
  const w = parseInches(line?.w);
  const h = parseInches(line?.h);
  if (!(w > 0) || !(h > 0)) return { ...empty, limits };
  const errors = [];
  if (!inRange(w, model.width.min, model.width.max)) {
    errors.push(`Width must be ${model.width.label} for ${model.name}`);
  }
  if (!inRange(h, height.min, height.max)) {
    errors.push(`Height must be ${height.label}`);
  }
  const band = errors.length ? -1 : ax650BandIndex(book, h);
  if (!errors.length && (band < 0 || book.models.find((m) => m.id === model.id).customerPrice[band] == null)) {
    errors.push(`Height must be ${height.label}`);
  }
  if (errors.length) return { ...empty, unsized: false, errors, limits };
  const material = cents(model.customerPrice[band]);
  return {
    errors: [], notes: [], material, band: band + 1, unsized: false,
    pricePending: false, unavailable: false, limits,
  };
}
