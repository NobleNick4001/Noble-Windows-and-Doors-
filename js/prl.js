// PRL Max multi-slide and PRL bifold.
// data/prl.json holds dealer amounts. Customer price is applied in core.js with
// dealerToCustomer(), the same dealer / (1 - grossMargin) method Andersen and
// Milgard use. This module does not apply that margin and does not price labor.
import { ax650PanelInstall } from './ax650.js';

const EPS = 1e-6;
export const PRL_BRAND = 'prl';
export const PRL_QUOTE_LABEL = 'Get a PRL quote';

export function isPrlLine(line) {
  return !!(line && line.brand === PRL_BRAND);
}

export function prlBook(book) {
  return book && book.pricesAre === 'dealer' && book.products?.multislide && book.products?.bifold ? book : null;
}

export function prlProduct(book, line) {
  const cat = prlBook(book);
  const id = line?.type === 'bifold' || line?.series === 'bifold' ? 'bifold' : 'multislide';
  return cat?.products?.[id] || null;
}

function inRange(n, min, max) {
  return n >= Number(min) - EPS && n <= Number(max) + EPS;
}

function panelsOf(line) {
  const n = Number(line?.panels);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function sizeOf(line) {
  const w = typeof line?.w === 'number' ? line.w : parseFloat(line?.w);
  const h = typeof line?.h === 'number' ? line.h : parseFloat(line?.h);
  return {
    w: Number.isFinite(w) ? w : NaN,
    h: Number.isFinite(h) ? h : NaN,
  };
}

// Dealer amount from the sheet's Calculator formulas.
// Multi-slide: (per panel × panels + per sq ft × sq ft + constant) × thermal × glass, then the nail-on screen.
// Bifold: (per panel × panels + per sq ft × sq ft) × bottom-rolling when that option is on.
// The published lookup rounds that result to the nearest dollar. raw is the unrounded formula.
export function prlDealerAmount(book, line) {
  const spec = prlProduct(book, line);
  const panels = panelsOf(line);
  const { w, h } = sizeOf(line);
  if (!spec || !panels || !(w > 0) || !(h > 0)) return null;
  const sqft = w * h / 144;
  let raw = spec.perPanel * panels + spec.perSqFt * sqft + (Number(spec.constant) || 0);
  if (spec.id === 'multislide') {
    if (line?.thermal) raw *= Number(spec.thermalFactor) || 1;
    if (line?.glass === 'ea') raw *= Number(book?.glass?.ea?.factor) || 1;
    if (line?.nailOn) raw += Number(spec.nailOnScreen) || 0;
  } else if (line?.rolling === 'bottom') {
    raw *= Number(spec.bottomRollingFactor) || 1;
  }
  if (!Number.isFinite(raw)) return null;
  return { raw, cost: Math.round(raw), sqft };
}

function quoteReasons(book, line, spec) {
  const reasons = [];
  const panels = panelsOf(line);
  if (line?.finish === 'other') reasons.push('Finishes other than bronze anodized');
  if (line?.layout === 'pocket') reasons.push('Pocket units');
  if (line?.layout === 'corner') reasons.push('90-degree corner units');
  if (panels > (spec?.panels?.max || 5)) reasons.push('6 or more panels');
  if (spec?.id === 'bifold' && line?.screen) reasons.push('Bifold screens');
  if (spec?.id === 'bifold' && line?.bifoldThermal) reasons.push('Thermal bifolds');
  if (spec?.id === 'bifold' && line?.glass === 'ea') reasons.push('Energy Advantage glass on a bifold');
  if (spec?.id === 'multislide' && line?.glass === 'ea' && !(book?.glass?.ea?.products || []).includes('multislide')) {
    reasons.push('Energy Advantage glass');
  }
  return reasons;
}

function rangeErrors(spec, panels, w, h, skipPanels) {
  const errors = [];
  if (!spec) return ['This PRL door is not offered.'];
  const name = spec.name;
  if (!skipPanels && (panels < spec.panels.min || panels > spec.panels.max)) {
    errors.push(`${name} is quoted for ${spec.panels.min} to ${spec.panels.max} panels.`);
  }
  if (!inRange(w, spec.width.min, spec.width.max)) {
    errors.push(`${name} width must be ${spec.width.min} to ${spec.width.max} in.`);
  }
  if (!inRange(h, spec.height.min, spec.height.max)) {
    errors.push(`${name} height must be ${spec.height.min} to ${spec.height.max} in.`);
  }
  if (errors.length) errors.push('Outside the quoted range. This opening is not quoted.');
  return errors;
}

export function prlLimits(book, line) {
  const spec = prlProduct(book, line);
  if (!spec) return null;
  return {
    wmin: spec.width.min,
    wmax: spec.width.max,
    hmin: spec.height.min,
    hmax: spec.height.max,
    hintW: `${spec.width.min}–${spec.width.max} in`,
    hintH: `${spec.height.min}–${spec.height.max} in`,
    text: `${spec.name}: ${spec.panels.min} to ${spec.panels.max} panels, ${spec.width.min} to ${spec.width.max} in wide, ${spec.height.min} to ${spec.height.max} in tall.`,
  };
}

export function prlDescription(book, line) {
  const spec = prlProduct(book, line);
  const panels = panelsOf(line);
  const glassName = line?.glass === 'ea'
    ? (prlBook(book)?.glass?.ea?.name || 'Energy Advantage')
    : (prlBook(book)?.glass?.sb70?.name || 'Solarban 70');
  const hang = spec?.id === 'bifold'
    ? (line?.rolling === 'bottom' ? 'Bottom-rolling' : 'Top-hung')
    : 'Bottom-rolling';
  const details = ['Bronze anodized', hang, glassName];
  if (line?.thermal) details.push('Max Thermal');
  if (line?.nailOn) details.push('Nail-on screen');
  const even = spec?.id === 'bifold' && panels % 2 === 0 && panels >= spec.panels.min && panels <= spec.panels.max;
  return {
    title: `PRL ${spec?.id === 'bifold' ? 'bifold' : 'Max multi-slide'}${panels ? `, ${panels}-panel` : ''}`,
    details,
    glass: glassName,
    note: even ? 'Even panel count, stacking one way: no man door and no exterior key.' : '',
  };
}

// Install uses the AX650 customer schedule (flat + per panel). No margin is added.
export function prlInstall(axCat, line) {
  return ax650PanelInstall(axCat, panelsOf(line));
}

export function prlQuoteMessage(q) {
  if (!q?.quoteRequired) return '';
  const why = (q.quoteReasons || []).filter(Boolean);
  if (!why.length) return PRL_QUOTE_LABEL;
  return `${PRL_QUOTE_LABEL}. Not priced: ${why.join('; ')}.`;
}

export function prlQuote(book, line) {
  const cat = prlBook(book);
  const spec = prlProduct(cat, line);
  const limits = prlLimits(cat, line);
  const empty = {
    errors: [], notes: [], cost: null, raw: null, unsized: true,
    quoteRequired: false, quoteReasons: [], limits,
  };
  if (!cat || !spec) return { ...empty, unsized: false, errors: ['PRL prices did not load.'] };
  const reasons = quoteReasons(cat, line, spec);
  const panels = panelsOf(line);
  const { w, h } = sizeOf(line);
  if (!(w > 0) || !(h > 0)) {
    return { ...empty, quoteRequired: reasons.length > 0, quoteReasons: reasons };
  }
  const tooManyPanels = panels > spec.panels.max;
  const errors = rangeErrors(spec, panels, w, h, tooManyPanels);
  if (reasons.length) {
    return { ...empty, unsized: false, quoteRequired: true, quoteReasons: reasons, errors };
  }
  if (errors.length) return { ...empty, unsized: false, errors };
  const amount = prlDealerAmount(cat, line);
  if (!amount) return { ...empty, unsized: false, errors: ['This opening is not quoted.'] };
  const described = prlDescription(cat, line);
  return {
    errors: [],
    notes: described.note ? [described.note] : [],
    cost: amount.cost,
    raw: amount.raw,
    sqft: amount.sqft,
    unsized: false,
    quoteRequired: false,
    quoteReasons: [],
    limits,
  };
}
