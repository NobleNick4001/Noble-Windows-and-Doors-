// Scaled window and door elevations for quote lines.
// Drawn from the entered width, height, and style. No external images.
// Proportions follow the real size. Extreme ratios are capped so a sliver still reads.
// Arch rise uses the same rules the price checks already imply:
//   equal-leg / half-round: rise = width / 2 (a semicircle)
//   Andersen arch single hung and specialty arch: rise = width / 4
//   eyebrow: rise = width / 8
//   an entered leg height or bottom-window height wins over those defaults
import { h, formatInches } from './core.js';
import { DOOR_CONFIG } from './milgard.js';

export const ASPECT_CAP = 4;

const GLASS = '#d7f6fb';
const INK = '#111111';
const FRAME = '#ffffff';

const ARCH_BODY = {
  archtop: 'picture',
  arch: 'picture',
  halfround: 'picture',
  specialty_arch: 'picture',
  eyebrow: 'picture',
  arch_sh: 'hung',
  arch_hr: 'hung',
  arch_xo: 'xo',
  arch_xox: 'xox',
  eyebrow_xo: 'xo',
  eyebrow_xox: 'xox',
  arch_over_xo: 'xo',
  arch_over_xox: 'xox',
};

export function canonicalType(line) {
  let t = String(line?.type || 'picture').trim().toLowerCase().replace(/\s+/g, '_');
  if (t === 'patio_door_2p' || t === 'patio' || t === 'patio_door') t = '2panel';
  if (t === 'twin_vslider' || t === 'double_single_hung' || t === 'twin') t = 'dshung';
  if (t === 'twin_casement' || t === 'double_casement') t = 'dcasement';
  if (t === 'single_hung' || t === 'singlehung' || t === 'sh') t = 'vslider';
  if (t === 'xo' || t === 'slider' || t === 'horizontal_slider') t = 'hslider';
  if (t === 'half-round' || t === 'half_round' || t === 'roundtop') t = 'halfround';
  if (t === 'archxo' || t === 'xo_arch' || t === 'arch_top_xo') t = 'arch_xo';
  if (t === 'archxox' || t === 'xox_arch') t = 'arch_xox';
  if (t === 'eyebrow_picture') t = 'eyebrow';
  if (t === 'half_round_sh' || t === 'halfround_sh') t = 'arch_hr';
  if ((t === 'arch' || t === 'archtop') && line?.brand === 'andersen') t = 'specialty_arch';
  if (t === 'swing' || t === 'entry' || t === 'hinged' || t === 'entry_door') t = 'swing';
  return t;
}

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
  if (v == null) return 0;
  const s = String(v).replace(/″/g, '"').replace(/[“”]/g, '"').trim();
  if (!s) return 0;
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sizeOf(line) {
  const w = num(line?.w) || 36;
  const h = num(line?.h) || 48;
  return { w, h };
}

function isArch(type) {
  return Object.prototype.hasOwnProperty.call(ARCH_BODY, type);
}
function shapeName(line) {
  return String(line?.shape || line?.head || line?.archShape || '').trim().toLowerCase();
}
function wantsEyebrow(line, type) {
  if (shapeName(line) === 'eyebrow' || type.startsWith('eyebrow')) return true;
  return /eyebrow/.test(String(line?.customDescription || ''));
}
// Andersen equal-leg arch is a segment: rise about one quarter of the width.
// Milgard arch XO / XOX / half-round / arch single hung use the equal-leg leg,
// which is overall height minus half the width.
function andersenSegment(line, type) {
  if (type === 'specialty_arch') return true;
  if (line?.brand !== 'andersen') return false;
  return type === 'arch_sh' || type === 'arch' || type === 'archtop' || type === 'arch_over_xo' || type === 'arch_over_xox';
}

// Rise of the curved head, in inches. An entered leg or bottom-window height is the
// rectangle under the springline. Otherwise arch XO/XOX use height − width/2.
export function archRiseInches(line) {
  const type = canonicalType(line || {});
  if (!isArch(type)) return 0;
  const { w, h } = sizeOf(line);
  const explicit = num(line?.rise);
  const bottom = num(line?.bottomHeight ?? line?.bottomWindow ?? line?.bottom ?? line?.unitHeight);
  const leg = num(line?.legHeight ?? line?.leg);
  let rise = 0;
  if (explicit) rise = explicit;
  else if (bottom && bottom < h) rise = h - bottom;
  else if (leg && leg < h) rise = h - leg;
  else if (wantsEyebrow(line, type)) rise = w / 8;
  else if (andersenSegment(line, type)) rise = w / 4;
  else rise = w / 2;
  rise = Math.min(Math.max(rise, 0), w / 2, h);
  if (rise < Math.min(h, w) * 0.04) rise = Math.min(h, w) * 0.04;
  return rise;
}

export function fitDrawing(wIn, hIn, maxW, maxH, cap = ASPECT_CAP) {
  const w = Math.max(Number(wIn) || 0, 0.01);
  const h = Math.max(Number(hIn) || 0, 0.01);
  let dw = w;
  let dh = h;
  let capped = false;
  if (dw / dh > cap) { dw = dh * cap; capped = true; }
  else if (dh / dw > cap) { dh = dw * cap; capped = true; }
  const scale = Math.min(maxW / dw, maxH / dh);
  return { wIn: w, hIn: h, dw: dw * scale, dh: dh * scale, scale, capped, cap };
}

function handing(line, fallback) {
  const raw = String(line?.hand || line?.handing || line?.operation || line?.config || '').trim().toUpperCase();
  if (!raw) return fallback;
  if (raw === 'OX' || raw === 'RIGHT' || raw === 'R') return 'OX';
  if (raw === 'XO' || raw === 'LEFT' || raw === 'L') return 'XO';
  if (['XOX', 'OXXO', 'XOO', 'OXO', 'XXO', 'OXX'].includes(raw)) return raw;
  return fallback;
}

function patternFor(type, line) {
  if (type === 'hslider' || type === '2panel' || type === 'arch_xo' || type === 'eyebrow_xo') return handing(line, 'XO');
  if (type === 'xox' || type === 'arch_xox' || type === 'eyebrow_xox') return 'XOX';
  if (type === '3panel') return handing(line, DOOR_CONFIG['3panel'] || 'XOO');
  if (type === '4panel') return handing(line, DOOR_CONFIG['4panel'] || 'OXXO');
  return '';
}

// X slides toward the neighboring fixed panel. OXXO vents slide out onto the fixed ends.
function ventOp(pattern, i) {
  if (pattern[i] !== 'X') return '';
  const leftO = pattern[i - 1] === 'O';
  const rightO = pattern[i + 1] === 'O';
  if (rightO && !leftO) return 'slide-right';
  if (leftO && !rightO) return 'slide-left';
  if (leftO && rightO) return i < pattern.length / 2 ? 'slide-left' : 'slide-right';
  return i < pattern.length / 2 ? 'slide-right' : 'slide-left';
}

function splitPanes(x, y, w, h, pattern, rail) {
  const n = pattern.length;
  const each = (w - rail * (n - 1)) / n;
  const panes = [];
  const rails = [];
  for (let i = 0; i < n; i++) {
    const px = x + i * (each + rail);
    panes.push({ x: px, y, w: each, h, op: ventOp(pattern, i) });
    if (i > 0) rails.push({ x: px - rail, y, w: rail, h });
  }
  return { panes, rails };
}

function hungPanes(x, y, w, h, rail) {
  const each = (h - rail) / 2;
  return {
    panes: [
      { x, y, w, h: each, op: '' },
      { x, y: y + each + rail, w, h: each, op: 'slide-up' },
    ],
    rails: [{ x, y: y + each, w, h: rail }],
  };
}

// Geometry in inches, origin at the top-left of the outer frame.
export function drawingModel(line) {
  const type = canonicalType(line || {});
  const { w, h } = sizeOf(line);
  const face = Math.min(3.15, Math.max(1.15, Math.min(w, h) * 0.09));
  const railT = Math.min(face * 0.95, Math.max(0.85, face * 0.72));
  const rise = archRiseInches({ ...line, type, w, h });
  const arch = isArch(type);
  const bodyKind = arch ? ARCH_BODY[type] : null;
  const leg = arch ? Math.max(0, h - rise) : 0;
  const spring = arch ? rise : 0;
  const panes = [];
  const rails = [];
  const gx = face;
  const gw = Math.max(0.8, w - face * 2);
  let gy = face;
  let gh = Math.max(0.8, h - face * 2);
  if (arch && leg > Math.max(1.25, h * 0.05)) {
    rails.push({ x: 0, y: spring - railT / 2, w, h: railT, spring: true });
    gy = spring + railT / 2;
    gh = Math.max(0.6, h - face - gy);
  }
  const kind = arch ? (leg > Math.max(1.25, h * 0.05) ? bodyKind : 'picture') : type;
  const casementHand = handing(line, 'XO');

  if (!arch || leg > Math.max(1.25, h * 0.05)) {
    if (kind === 'hung' || kind === 'vslider') {
      const hung = hungPanes(gx, gy, gw, gh, railT);
      panes.push(...hung.panes);
      rails.push(...hung.rails);
    } else if (kind === 'dshung') {
      const eachW = (gw - railT) / 2;
      rails.push({ x: gx + eachW, y: arch ? spring : 0, w: railT, h: arch ? h - spring : h });
      for (const side of [0, 1]) {
        const hung = hungPanes(gx + side * (eachW + railT), gy, eachW, gh, railT);
        panes.push(...hung.panes);
        rails.push(...hung.rails);
      }
    } else if (kind === 'xo' || kind === 'xox' || kind === 'hslider' || kind === 'xox' || kind === '2panel' || kind === '3panel' || kind === '4panel') {
      const pattern = (kind === 'xo') ? handing(line, 'XO') : (kind === 'xox' ? 'XOX' : patternFor(kind, line));
      const split = splitPanes(gx, gy, gw, gh, pattern, railT);
      panes.push(...split.panes);
      for (const bar of split.rails) rails.push({ ...bar, y: arch ? spring : 0, h: arch ? h - spring : h });
    } else if (kind === 'casement' || kind === 'swing') {
      const op = casementHand === 'OX' ? 'casement-right' : 'casement';
      panes.push({ x: gx, y: gy, w: gw, h: gh, op });
    } else if (kind === 'dcasement') {
      const each = (gw - railT) / 2;
      rails.push({ x: gx + each, y: arch ? spring : 0, w: railT, h: arch ? h - spring : h });
      panes.push({ x: gx, y: gy, w: each, h: gh, op: 'casement' });
      panes.push({ x: gx + each + railT, y: gy, w: each, h: gh, op: 'casement-right' });
    } else if (kind === 'awning') {
      panes.push({ x: gx, y: gy, w: gw, h: gh, op: 'awning' });
    } else if (kind === 'hvb') {
      const vent = (gh - railT) / 3;
      const pic = vent * 2;
      rails.push({ x: gx, y: gy + pic, w: gw, h: railT });
      panes.push({ x: gx, y: gy, w: gw, h: pic, op: '' });
      panes.push({ x: gx, y: gy + pic + railT, w: gw, h: vent, op: 'awning' });
    } else {
      panes.push({ x: gx, y: gy, w: gw, h: gh, op: '' });
    }
  }

  return {
    type, w, h, face, rail: railT, rise, leg, arch,
    bottom: arch ? leg : h,
    panes, rails,
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const r1 = (n) => Math.round(n * 10) / 10;

function archRadius(chord, rise) {
  if (!(rise > 0) || !(chord > 0)) return 0;
  return (chord * chord) / (8 * rise) + rise / 2;
}

// Points along a true circular arc from the left springline to the right, bulging up.
function archSamples(x, springY, chord, rise, steps = 28) {
  const radius = archRadius(chord, rise);
  const cx = x + chord / 2;
  const cy = springY + (radius - rise);
  const left = Math.atan2(radius - rise, -chord / 2);
  const right = Math.atan2(radius - rise, chord / 2);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = left + (right - left) * (i / steps);
    pts.push([cx + radius * Math.cos(a), cy - radius * Math.sin(a)]);
  }
  return pts;
}

function pathOf(pts, close) {
  if (!pts.length) return '';
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p[0])},${r1(p[1])}`).join(' ');
  return close ? `${d} Z` : d;
}

function outerPath(x, y, w, h, rise) {
  if (!(rise > 0.4)) return '';
  const spring = y + rise;
  const arc = archSamples(x, spring, w, rise);
  const pts = [[x, y + h], [x, spring], ...arc, [x + w, y + h]];
  return pathOf(pts, true);
}

function glassArchPath(x, springY, chord, rise) {
  if (!(rise > 0.4) || !(chord > 1)) return '';
  const arc = archSamples(x, springY, chord, rise);
  return pathOf([...arc, [x + chord, springY], [x, springY]], true);
}

function arrowPoints(cx, cy, dir, len) {
  const head = len * 0.48;
  const th = len * 0.3;
  const hh = len * 0.46;
  const x0 = -len / 2;
  const x1 = len / 2;
  const neck = x1 - head;
  const local = [
    [x0, -th / 2], [neck, -th / 2], [neck, -hh / 2], [x1, 0],
    [neck, hh / 2], [neck, th / 2], [x0, th / 2],
  ];
  const rot = { right: 0, left: Math.PI, up: -Math.PI / 2, down: Math.PI / 2 }[dir] || 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return local.map(([px, py]) => [cx + px * c - py * s, cy + px * s + py * c]);
}

function swingPath(p, op) {
  const m = Math.min(p.w, p.h) * 0.14;
  if (op === 'casement') return `M${r1(p.x + p.w - m)},${r1(p.y + p.h / 2)} L${r1(p.x + m)},${r1(p.y + m)} M${r1(p.x + p.w - m)},${r1(p.y + p.h / 2)} L${r1(p.x + m)},${r1(p.y + p.h - m)}`;
  if (op === 'casement-right') return `M${r1(p.x + m)},${r1(p.y + p.h / 2)} L${r1(p.x + p.w - m)},${r1(p.y + m)} M${r1(p.x + m)},${r1(p.y + p.h / 2)} L${r1(p.x + p.w - m)},${r1(p.y + p.h - m)}`;
  if (op === 'awning') return `M${r1(p.x + p.w / 2)},${r1(p.y + p.h - m)} L${r1(p.x + m)},${r1(p.y + m)} M${r1(p.x + p.w / 2)},${r1(p.y + p.h - m)} L${r1(p.x + p.w - m)},${r1(p.y + m)}`;
  return '';
}

export function windowDrawingSVG(line, opts = {}) {
  const boxW = opts.boxW || 220;
  const boxH = opts.boxH || 188;
  const model = drawingModel(line || {});
  const compact = boxW < 150;
  const gutterL = compact ? 26 : 42;
  const gutterB = compact ? 18 : 30;
  const pad = compact ? 3 : 5;
  const fit = fitDrawing(model.w, model.h, boxW - gutterL - pad * 2, boxH - gutterB - pad, ASPECT_CAP);
  const ox = gutterL + (boxW - gutterL - pad - fit.dw) / 2;
  const oy = pad + (boxH - gutterB - pad - fit.dh) / 2;
  const sx = fit.dw / model.w;
  const sy = fit.dh / model.h;
  const X = (inches) => ox + inches * sx;
  const Y = (inches) => oy + inches * sy;
  const facePx = model.face * ((sx + sy) / 2);
  const sw = Math.max(1.05, Math.min(2.1, facePx * 0.16));
  const parts = [];
  parts.push(`<rect width="${boxW}" height="${boxH}" fill="#ffffff"/>`);

  const risePx = model.arch ? model.rise * sy : 0;
  if (model.arch && risePx > 1) {
    parts.push(`<path class="frame" d="${outerPath(ox, oy, fit.dw, fit.dh, risePx)}" fill="${FRAME}" stroke="${INK}" stroke-width="${r1(sw)}" stroke-linejoin="round"/>`);
    const groove = model.face * 0.4;
    const gRise = Math.max(0, (model.rise - groove) * sy);
    if (gRise > 2) {
      parts.push(`<path class="groove" d="${outerPath(X(groove), Y(groove), (model.w - groove * 2) * sx, (model.h - groove) * sy, gRise)}" fill="none" stroke="${INK}" stroke-width="${r1(sw * 0.7)}" stroke-linejoin="round"/>`);
    }
    const inset = model.face;
    const chord = model.w - inset * 2;
    const hasBody = model.leg > Math.max(1.25, model.h * 0.05);
    const iRiseIn = hasBody ? Math.max(0.4, model.rise - inset) : Math.max(0.4, model.rise - inset * 2);
    const springIn = hasBody ? model.rise : model.h - inset;
    const gPath = glassArchPath(X(inset), Y(springIn), chord * sx, iRiseIn * sy);
    if (gPath) parts.push(`<path class="glass arch" d="${gPath}" fill="${GLASS}" stroke="${INK}" stroke-width="${r1(sw * 0.85)}" stroke-linejoin="round"/>`);
  } else {
    parts.push(`<rect class="frame" x="${r1(ox)}" y="${r1(oy)}" width="${r1(fit.dw)}" height="${r1(fit.dh)}" fill="${FRAME}" stroke="${INK}" stroke-width="${r1(sw)}"/>`);
    const g = model.face * 0.4;
    parts.push(`<rect class="groove" x="${r1(X(g))}" y="${r1(Y(g))}" width="${r1((model.w - g * 2) * sx)}" height="${r1((model.h - g * 2) * sy)}" fill="none" stroke="${INK}" stroke-width="${r1(sw * 0.7)}"/>`);
  }

  for (const p of model.panes) {
    if (p.w < 0.3 || p.h < 0.3) continue;
    parts.push(`<rect class="glass" x="${r1(X(p.x))}" y="${r1(Y(p.y))}" width="${r1(p.w * sx)}" height="${r1(p.h * sy)}" fill="${GLASS}" stroke="${INK}" stroke-width="${r1(Math.max(0.8, sw * 0.65))}"/>`);
  }
  for (const bar of model.rails) {
    if (bar.w <= 0 || bar.h <= 0) continue;
    const x = bar.x <= 0 ? ox : X(bar.x);
    const y = bar.y <= 0 ? oy : Y(bar.y);
    const bw = bar.x <= 0 && bar.w >= model.w - 0.01 ? fit.dw : bar.w * sx;
    const bh = bar.h >= model.h - 0.01 ? fit.dh : bar.h * sy;
    parts.push(`<rect class="rail" x="${r1(x)}" y="${r1(y)}" width="${r1(bw)}" height="${r1(bh)}" fill="${FRAME}" stroke="${INK}" stroke-width="${r1(sw * 0.85)}"/>`);
  }
  for (const p of model.panes) {
    const px = X(p.x);
    const py = Y(p.y);
    const pw = p.w * sx;
    const ph = p.h * sy;
    if (p.op === 'slide-left' || p.op === 'slide-right' || p.op === 'slide-up' || p.op === 'slide-down') {
      const dir = p.op.replace('slide-', '');
      const len = Math.min(dir === 'up' || dir === 'down' ? ph : pw, dir === 'up' || dir === 'down' ? ph * 0.42 : pw * 0.42, 36);
      if (len < 7 || pw < 10 || ph < 10) continue;
      const pts = arrowPoints(px + pw / 2, py + ph / 2, dir, len);
      parts.push(`<polygon class="vent" data-op="${p.op}" points="${pts.map((q) => `${r1(q[0])},${r1(q[1])}`).join(' ')}" fill="${INK}"/>`);
    } else if (p.op === 'casement' || p.op === 'casement-right' || p.op === 'awning') {
      if (pw < 12 || ph < 12) continue;
      const d = swingPath({ x: px, y: py, w: pw, h: ph }, p.op);
      if (d) parts.push(`<path class="swing" data-op="${p.op}" d="${d}" fill="none" stroke="${INK}" stroke-width="${r1(Math.max(1.15, sw))}" stroke-linecap="round"/>`);
    }
  }

  const wLabel = formatInches(model.w);
  const hLabel = formatInches(model.h);
  const font = Math.max(compact ? 7 : 9, Math.min(compact ? 10 : 13, fit.dw * 0.16, fit.dh * 0.16));
  const dimY = oy + fit.dh + (compact ? 12 : 16);
  const tick = compact ? 3 : 4.5;
  parts.push(`<g class="dim" fill="none" stroke="${INK}" stroke-width="${r1(Math.max(0.7, sw * 0.55))}">`);
  parts.push(`<line x1="${r1(ox)}" y1="${r1(oy + fit.dh)}" x2="${r1(ox)}" y2="${r1(dimY + tick)}"/>`);
  parts.push(`<line x1="${r1(ox + fit.dw)}" y1="${r1(oy + fit.dh)}" x2="${r1(ox + fit.dw)}" y2="${r1(dimY + tick)}"/>`);
  parts.push(`<line x1="${r1(ox)}" y1="${r1(dimY)}" x2="${r1(ox + fit.dw)}" y2="${r1(dimY)}"/>`);
  parts.push(`<polyline points="${r1(ox + 1)},${r1(dimY - 2.4)} ${r1(ox)},${r1(dimY)} ${r1(ox + 1)},${r1(dimY + 2.4)}" fill="${INK}" stroke="none"/>`);
  parts.push(`<polyline points="${r1(ox + fit.dw - 1)},${r1(dimY - 2.4)} ${r1(ox + fit.dw)},${r1(dimY)} ${r1(ox + fit.dw - 1)},${r1(dimY + 2.4)}" fill="${INK}" stroke="none"/>`);
  const dimX = ox - (compact ? 11 : 16);
  parts.push(`<line x1="${r1(ox)}" y1="${r1(oy)}" x2="${r1(dimX - tick)}" y2="${r1(oy)}"/>`);
  parts.push(`<line x1="${r1(ox)}" y1="${r1(oy + fit.dh)}" x2="${r1(dimX - tick)}" y2="${r1(oy + fit.dh)}"/>`);
  parts.push(`<line x1="${r1(dimX)}" y1="${r1(oy)}" x2="${r1(dimX)}" y2="${r1(oy + fit.dh)}"/>`);
  parts.push(`<polyline points="${r1(dimX - 2.4)},${r1(oy + 1)} ${r1(dimX)},${r1(oy)} ${r1(dimX + 2.4)},${r1(oy + 1)}" fill="${INK}" stroke="none"/>`);
  parts.push(`<polyline points="${r1(dimX - 2.4)},${r1(oy + fit.dh - 1)} ${r1(dimX)},${r1(oy + fit.dh)} ${r1(dimX + 2.4)},${r1(oy + fit.dh - 1)}" fill="${INK}" stroke="none"/>`);
  parts.push(`</g>`);
  parts.push(`<text class="dim dim-w" x="${r1(ox + fit.dw / 2)}" y="${r1(dimY + font * 0.95)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${r1(font)}" fill="${INK}">${esc(wLabel)}</text>`);
  const ty = oy + fit.dh / 2;
  parts.push(`<text class="dim dim-h" x="${r1(dimX - font * 0.35)}" y="${r1(ty)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${r1(font)}" fill="${INK}" transform="rotate(-90 ${r1(dimX - font * 0.35)} ${r1(ty)})">${esc(hLabel)}</text>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${boxW} ${boxH}" width="${boxW}" height="${boxH}" role="img" aria-label="${esc(wLabel)} by ${esc(hLabel)}" data-type="${esc(model.type)}" data-dw="${r1(fit.dw)}" data-dh="${r1(fit.dh)}" data-win="${model.w}" data-hin="${model.h}" data-capped="${fit.capped ? '1' : '0'}" data-rise="${r1(model.rise)}" data-leg="${r1(model.leg)}" data-bottom="${r1(model.bottom)}">${parts.join('')}</svg>`;
  return { svg, ...fit, type: model.type, rise: model.rise, leg: model.leg, bottom: model.bottom, wLabel, hLabel };
}

export function drawingEl(line, className, box) {
  const drawn = windowDrawingSVG(line, box);
  return h('div', { class: className, html: drawn.svg });
}

// Styles the calculator can quote, plus the arch shapes those lines draw.
export const DRAWING_TYPES = [
  'picture', 'vslider', 'dshung', 'twin_vslider', 'hslider', 'xox',
  'casement', 'dcasement', 'twin_casement', 'awning', 'hvb',
  '2panel', '3panel', '4panel', 'patio_door_2p',
  'archtop', 'arch', 'halfround', 'arch_sh', 'arch_hr', 'specialty_arch',
  'arch_xo', 'arch_xox', 'eyebrow', 'eyebrow_xo', 'eyebrow_xox',
  'arch_over_xo', 'arch_over_xox',
  'swing', 'custom_supplier',
];
