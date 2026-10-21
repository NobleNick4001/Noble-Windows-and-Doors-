import { h, fmt, data, estimates, toast, installUnit, installType, defaultInstall } from '../core.js';
import { applyFrameType, currentFrameType } from './calculator.js';

/*
 * Frame-type pictures are original SVG cross-sections drawn for this screen.
 * No manufacturer figure is embedded.
 *
 * Looked for a diagram we are allowed to reuse, and did not find one that
 * shows these three stucco installs:
 * - Milgard and Andersen installation guides. Copyrighted by the manufacturers.
 *   No reuse grant that covers copying a figure into this app. Not used.
 * - AAMA 2410-13 (flush-fin / mounting-flange install figures). The published
 *   practice says it may not be reproduced or distributed without written
 *   consent. Not used.
 * - Anlin, 1st Windows, and OSI/Henkel install drawings. Commercial copyright,
 *   no reuse license found. Not used.
 * - Wikimedia Commons, File:Aluminium_window_detail.png, ProfDEH, 2016-02-25.
 *   CC BY-SA 3.0 and GFDL 1.2 or later. A brick-cavity aluminum window, not a
 *   stucco retrofit, block frame, or nail fin. Not used.
 * - Wikimedia Commons, File:Box_window_section_drawing.jpg, Christophe Krief.
 *   CC BY-SA 4.0. A box/bay window, not these installs. Not used.
 * - Wikimedia Commons double-glazed unit diagram (NcLean) and Passivhaus
 *   Fenster Beispiele (GFDL, Passivhaus Institut). Glass build-up, not how
 *   the frame meets the wall. Not used.
 *
 * Each drawing is a cut through the top of the window. Left is inside the
 * house. Orange is the piece that is different: the Z-bar, or the nail fin.
 * Parts labeled on the drawing: drywall, stud, sheathing, stucco, the old
 * frame (or the old frame removed), the new window, sealant, and trim.
 */

function types() { return data.frameTypes?.types || []; }

function liveEstimate() {
  if (!estimates.currentId()) return null;
  return estimates.current();
}
function latestLine() {
  const e = liveEstimate();
  if (!e?.lines?.length) return null;
  return e.lines[e.lines.length - 1];
}
function selectedId() {
  return latestLine()?.install?.frameType || currentFrameType();
}
function linesOf(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}
function priceLabel(n) {
  const text = fmt(n);
  return text.endsWith('.00') ? text.slice(0, -3) : text;
}

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'Helvetica, Arial, sans-serif';

function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
}
function txt(parent, x, y, text, o = {}) {
  const t = el('text', {
    x, y,
    fill: o.fill || '#0e3a63',
    'font-family': FONT,
    'font-size': o.size || 15,
    'font-weight': o.weight || 700,
    'text-anchor': o.anchor || 'start',
  }, parent);
  if (o.rotate) t.setAttribute('transform', `rotate(${o.rotate} ${x} ${y})`);
  t.textContent = text;
  return t;
}
function vlabel(parent, x, y, text, o = {}) {
  return txt(parent, x, y, text, { ...o, anchor: 'middle', rotate: -90 });
}
function box(parent, x, y, w, h, fill, extra = {}) {
  return el('rect', { x, y, width: w, height: h, fill, stroke: '#0e3a63', 'stroke-width': 2, ...extra }, parent);
}
function pill(parent, x, y, text, o = {}) {
  const size = Number(o.size || 14);
  const w = Math.round(text.length * size * 0.58 + 16);
  const h = size + 10;
  let left = x;
  if (o.anchor === 'middle') left = x - w / 2;
  if (o.anchor === 'end') left = x - w;
  if (left + w > 508) left = 508 - w;
  if (left < 4) left = 4;
  el('rect', {
    x: left, y: y - size + 1, width: w, height: h, rx: 8,
    fill: o.bg || '#ffffff', stroke: o.stroke || '#0e3a63', 'stroke-width': 1.5,
  }, parent);
  txt(parent, left + w / 2, y, text, { size, anchor: 'middle', fill: o.fill || '#0e3a63' });
}
function leader(parent, x1, y1, x2, y2) {
  el('line', { x1, y1, x2, y2, stroke: '#0e3a63', 'stroke-width': 1.6 }, parent);
  el('circle', { cx: x1, cy: y1, r: 4, fill: '#f28c28', stroke: '#0e3a63', 'stroke-width': 1.2 }, parent);
}
function bead(parent, x, y) {
  el('path', {
    d: `M ${x - 14} ${y + 3} C ${x - 6} ${y - 9}, ${x + 4} ${y + 10}, ${x + 16} ${y - 3}`,
    fill: 'none', stroke: '#16324f', 'stroke-width': 7, 'stroke-linecap': 'round',
  }, parent);
}
function pane(parent, x, y, w, h) {
  el('rect', { x, y, width: w, height: h, fill: '#d7eefb', stroke: '#1d75bc', 'stroke-width': 2 }, parent);
  const inset = Math.min(6, Math.round(Math.min(w, h) / 6));
  el('rect', {
    x: x + inset, y: y + inset, width: Math.max(8, w - inset * 2), height: Math.max(8, h - inset * 2),
    fill: '#c5e4f6', stroke: '#1d75bc', 'stroke-width': 1.4,
  }, parent);
  el('line', {
    x1: x + 7, y1: y + h - 12, x2: x + Math.max(16, w * 0.42), y2: y + 10,
    stroke: '#ffffff', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.95,
  }, parent);
}
function scene(label) {
  const svg = el('svg', { viewBox: '0 0 520 620', role: 'img', 'aria-label': label });
  el('rect', { width: 520, height: 620, fill: '#e7f2fb' }, svg);
  txt(svg, 16, 32, 'INSIDE', { size: 16 });
  txt(svg, 500, 32, 'OUTSIDE', { size: 16, anchor: 'end' });
  return svg;
}
function wall(svg, { stucco = true } = {}) {
  box(svg, 28, 86, 58, 156, '#f7f4ee');
  vlabel(svg, 57, 150, 'drywall', { size: 15 });
  box(svg, 86, 64, 168, 156, '#e4c48a');
  txt(svg, 150, 156, 'stud', { size: 18, anchor: 'middle' });
  box(svg, 254, 64, 26, 156, '#d7c09a');
  vlabel(svg, 267, 142, 'sheathing', { size: 14 });
  if (stucco) {
    box(svg, 280, 54, 132, 176, '#ead9bc');
    txt(svg, 318, 92, 'stucco', { size: 16, anchor: 'middle' });
  }
}
function interiorTrim(svg) {
  el('path', {
    d: 'M 8 196 H 150 V 222 H 40 V 392 H 8 Z',
    fill: '#f7f1e4', stroke: '#0e3a63', 'stroke-width': 2,
  }, svg);
  vlabel(svg, 24, 318, 'trim', { size: 15 });
}
function caption(svg, text) {
  txt(svg, 260, 598, text, { size: 15, anchor: 'middle', weight: 700 });
}
function newWindow(svg, x, y, w, h) {
  box(svg, x, y, w, h, '#f7fafc', { 'stroke-width': 3 });
  const rail = Math.max(16, Math.round(Math.min(w, h) * 0.16));
  pane(svg, x + rail, y + rail + 6, w - rail * 2, h - rail * 2 - 14);
}

function diagramZ() {
  const svg = scene('Cross-section of a retrofit window. The new window sits in the old frame, and the Z-bar laps the stucco.');
  wall(svg);
  el('path', {
    d: 'M 132 210 H 312 V 470 H 284 V 238 H 160 V 470 H 132 Z',
    fill: '#c5ced6', stroke: '#0e3a63', 'stroke-width': 2,
  }, svg);
  vlabel(svg, 146, 360, 'old frame', { size: 14 });
  newWindow(svg, 172, 258, 96, 184);
  leader(svg, 220, 360, 220, 498);
  pill(svg, 220, 516, 'new window', { anchor: 'middle' });
  el('path', {
    d: 'M 262 252 H 424 V 108 H 356 V 228 H 286 V 446 H 262 Z',
    fill: '#f28c28', stroke: '#c4530a', 'stroke-width': 2,
  }, svg);
  leader(svg, 390, 168, 436, 168);
  pill(svg, 508, 174, 'Z-bar', { anchor: 'end', fill: '#c4530a', stroke: '#c4530a' });
  bead(svg, 338, 124);
  leader(svg, 338, 112, 436, 100);
  pill(svg, 508, 106, 'sealant', { anchor: 'end' });
  bead(svg, 166, 268);
  interiorTrim(svg);
  caption(svg, 'Old frame stays. The Z-bar laps the stucco.');
  return svg;
}

function diagramBlock() {
  const svg = scene('Cross-section of a block frame screwed into an open rough opening, with no fin past the wall.');
  wall(svg);
  el('rect', {
    x: 124, y: 206, width: 196, height: 270,
    fill: 'none', stroke: '#5c6b78', 'stroke-width': 2.4, 'stroke-dasharray': '7 5',
  }, svg);
  newWindow(svg, 146, 246, 128, 196);
  leader(svg, 210, 340, 210, 492);
  pill(svg, 210, 510, 'new window', { anchor: 'middle' });
  el('line', { x1: 186, y1: 268, x2: 186, y2: 118, stroke: '#c4530a', 'stroke-width': 4, 'stroke-linecap': 'round' }, svg);
  el('rect', { x: 178, y: 262, width: 16, height: 8, rx: 1.5, fill: '#c4530a' }, svg);
  el('line', { x1: 230, y1: 268, x2: 230, y2: 118, stroke: '#c4530a', 'stroke-width': 4, 'stroke-linecap': 'round' }, svg);
  el('rect', { x: 222, y: 262, width: 16, height: 8, rx: 1.5, fill: '#c4530a' }, svg);
  pill(svg, 168, 108, 'screws', { fill: '#c4530a', stroke: '#c4530a', anchor: 'middle', size: 13 });
  bead(svg, 196, 226);
  leader(svg, 214, 220, 430, 220);
  pill(svg, 508, 226, 'sealant', { anchor: 'end' });
  box(svg, 286, 214, 46, 158, '#f7f1e4');
  vlabel(svg, 309, 300, 'exterior trim', { size: 13 });
  leader(svg, 400, 280, 430, 280);
  pill(svg, 508, 286, 'no fin', { anchor: 'end', fill: '#c4530a', stroke: '#c4530a' });
  interiorTrim(svg);
  pill(svg, 222, 556, 'old frame removed', { anchor: 'middle' });
  caption(svg, 'Old frame is gone. No fin past the wall.');
  return svg;
}

function diagramFin() {
  const svg = scene('Cross-section of a nail-fin window. The fin is nailed to the sheathing and stucco covers it.');
  wall(svg, { stucco: false });
  el('rect', {
    x: 120, y: 206, width: 200, height: 268,
    fill: 'none', stroke: '#5c6b78', 'stroke-width': 2.4, 'stroke-dasharray': '7 5',
  }, svg);
  el('rect', { x: 276, y: 112, width: 108, height: 128, fill: '#f28c28', stroke: '#c4530a', 'stroke-width': 2 }, svg);
  [126, 144, 162].forEach((y) => {
    el('line', { x1: 262, y1: y, x2: 312, y2: y, stroke: '#0e3a63', 'stroke-width': 2.6 }, svg);
    el('circle', { cx: 312, cy: y, r: 4.5, fill: '#0e3a63' }, svg);
  });
  vlabel(svg, 294, 208, 'nail fin', { size: 14 });
  box(svg, 318, 54, 110, 176, '#ead9bc');
  txt(svg, 373, 100, 'stucco', { size: 16, anchor: 'middle' });
  newWindow(svg, 150, 240, 140, 186);
  leader(svg, 220, 330, 220, 492);
  pill(svg, 220, 510, 'new window', { anchor: 'middle' });
  bead(svg, 292, 124);
  leader(svg, 300, 112, 430, 112);
  pill(svg, 508, 118, 'sealant', { anchor: 'end' });
  interiorTrim(svg);
  pill(svg, 220, 556, 'old frame removed', { anchor: 'middle' });
  caption(svg, 'Fin is nailed on, then stucco covers it.');
  return svg;
}

function diagram(kind) {
  if (kind === 'block') return diagramBlock();
  if (kind === 'nailfin') return diagramFin();
  return diagramZ();
}

let openEl = null;
let onKey = null;

export function stop() {
  if (onKey) document.removeEventListener('keydown', onKey);
  onKey = null;
  if (openEl) openEl.remove();
  openEl = null;
  document.body.classList.remove('ft-open');
}

function openZoom(ft) {
  stop();
  const close = h('button', {
    type: 'button', class: 'btn primary', id: 'ft-zoom-close',
    onclick: () => stop(),
  }, 'Close');
  openEl = h('div', {
    class: 'ft-zoom', id: 'ft-zoom', role: 'dialog', 'aria-modal': 'true', 'aria-label': ft.name + ' diagram',
  },
  h('div', { class: 'ft-zoom-bar' }, h('h2', {}, ft.name), close),
  h('div', { class: 'ft-zoom-stage' }, diagram(ft.diagram)));
  document.body.append(openEl);
  document.body.classList.add('ft-open');
  onKey = (e) => { if (e.key === 'Escape') stop(); };
  document.addEventListener('keydown', onKey);
  close.focus();
}

function applyToWindow(ft, status, btn) {
  applyFrameType(ft.id);
  const e = liveEstimate();
  const line = e?.lines?.length ? e.lines[e.lines.length - 1] : null;
  const labor = installType(ft.installType);
  if (line) {
    if (!line.install) line.install = defaultInstall();
    line.install.frameType = ft.id;
    if (ft.installType) line.install.type = ft.installType;
    line.installUnit = installUnit(line.install);
    estimates.persist();
    status.textContent = `Saved on ${line.label}. Install set to ${labor.name}.`;
    toast(`${ft.name} saved on ${line.label}`);
  } else {
    status.textContent = `Saved for the next window you add. Install will be ${labor.name}.`;
    toast(`${ft.name} will be used on the next window you add`);
  }
  btn.textContent = 'Selected for this window';
  document.querySelectorAll('.ft-card').forEach((card) => card.classList.toggle('on', card.getAttribute('data-frame') === ft.id));
}

export function view() {
  const chosen = selectedId();
  const list = h('div', { class: 'ft-list', id: 'frame-type-list' });
  types().forEach((ft) => {
    const labor = installType(ft.installType);
    const status = h('p', { class: 'fine', id: 'ft-status-' + ft.id }, '');
    const btn = h('button', {
      type: 'button', class: 'btn primary', id: 'btn-frame-' + ft.id,
      onclick: () => applyToWindow(ft, status, btn),
    }, chosen === ft.id ? 'Selected for this window' : 'Use for this window');
    const line = latestLine();
    status.textContent = line
      ? `Applies to ${line.label}, the latest window on this estimate.`
      : 'No window on the estimate yet. This choice is kept for the next one you add.';
    const best = linesOf(ft.bestFor);
    const sees = linesOf(ft.sees);
    list.append(h('article', { class: 'card ft-card' + (chosen === ft.id ? ' on' : ''), 'data-frame': ft.id },
      h('button', {
        type: 'button', class: 'ft-diagram', id: 'ft-diagram-' + ft.id,
        'aria-label': 'Enlarge the ' + ft.name + ' diagram',
        onclick: () => openZoom(ft),
      }, diagram(ft.diagram), h('span', { class: 'ft-tap' }, 'Tap to enlarge')),
      h('div', { class: 'ft-copy' },
        h('h2', {}, ft.name),
        h('p', { class: 'ft-one' }, ft.desc || ''),
        best.length ? h('div', { class: 'ft-best' }, h('div', { class: 'ft-k' }, 'Best for'), h('ul', {}, best.map((item) => h('li', {}, item)))) : null,
        sees.length ? h('div', { class: 'ft-see' }, h('div', { class: 'ft-k' }, 'What the homeowner sees'), h('ul', {}, sees.map((item) => h('li', {}, item)))) : null,
        h('p', { class: 'ft-price' }, h('b', {}, priceLabel(labor.price)), h('span', {}, 'labor per window')),
        h('p', { class: 'fine' }, 'Install labor: ', labor.name, labor.placeholder ? ' (placeholder price)' : ''),
        status,
        btn)));
  });
  return h('div', { class: 'ft' },
    h('p', { class: 'og-lead' }, 'Three ways the new window meets the wall. Tap a picture to make it bigger. Orange is the piece that changes.'),
    list);
}
