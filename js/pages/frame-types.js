import { h, fmt, data, settings, estimates, toast, installUnit, installType, defaultInstall } from '../core.js';
import { applyFrameType, currentFrameType } from './calculator.js';

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

const NS = 'http://www.w3.org/2000/svg';
function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
}
function txt(x, y, text, parent, extra = {}) {
  const t = el('text', { x, y, fill: '#0e3a63', 'font-family': 'Helvetica, Arial, sans-serif', 'font-size': '15', 'font-weight': '700', ...extra }, parent);
  t.textContent = text;
  return t;
}

function baseSvg(label) {
  const svg = el('svg', { viewBox: '0 0 680 320', role: 'img', 'aria-label': label });
  el('rect', { width: '680', height: '320', fill: '#e7f2fb' }, svg);
  txt(20, 32, 'INSIDE', svg);
  txt(560, 32, 'OUTSIDE', svg);
  return svg;
}
function wall(svg, { studW = 120, studX = 70 } = {}) {
  el('rect', { x: 24, y: 108, width: 40, height: 168, fill: '#fbfaf7', stroke: '#0e3a63', 'stroke-width': '2' }, svg);
  txt(44, 100, 'drywall', svg, { 'text-anchor': 'middle', 'font-size': '12', 'font-weight': '600' });
  el('rect', { x: studX, y: 108, width: studW, height: 168, fill: '#e4c48a', stroke: '#0e3a63', 'stroke-width': '2' }, svg);
  txt(studX + studW / 2, 198, 'stud', svg, { 'text-anchor': 'middle', 'font-size': '14' });
}

function diagram(kind) {
  if (kind === 'block') return diagramBlock();
  if (kind === 'nailfin') return diagramFin();
  return diagramZ();
}

function diagramZ() {
  const svg = baseSvg('Cross-section of a Z-bar retrofit window set into the existing frame');
  wall(svg, { studW: 100, studX: 64 });
  el('path', { d: 'M164 96 h78 v150 h-78 v-22 h54 v-106 h-54 z', fill: '#c5ced6', stroke: '#0e3a63', 'stroke-width': '2' }, svg);
  txt(188, 78, 'old frame', svg, { 'font-size': '13' });
  el('rect', { x: 176, y: 78, width: 150, height: 176, fill: '#f7fafc', stroke: '#0e3a63', 'stroke-width': '3' }, svg);
  el('rect', { x: 196, y: 100, width: 110, height: 132, fill: '#c5e6f8', stroke: '#1d75bc', 'stroke-width': '2' }, svg);
  txt(251, 172, 'new window', svg, { 'text-anchor': 'middle', 'font-size': '13' });
  el('path', { d: 'M326 96 H400 V156 H348', fill: 'none', stroke: '#f28c28', 'stroke-width': '12', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  txt(408, 128, 'Z-bar', svg, { fill: '#c4530a', 'font-size': '14' });
  el('rect', { x: 430, y: 108, width: 90, height: 168, fill: '#ead9bc', stroke: '#0e3a63', 'stroke-width': '2' }, svg);
  txt(475, 198, 'stucco', svg, { 'text-anchor': 'middle', 'font-size': '13' });
  txt(340, 292, 'The orange Z hooks over the old frame. Stucco stays.', svg, { 'text-anchor': 'middle', 'font-size': '14', 'font-weight': '600' });
  return svg;
}

function diagramBlock() {
  const svg = baseSvg('Cross-section of a block frame set in an open rough opening');
  wall(svg, { studW: 110, studX: 64 });
  el('rect', { x: 200, y: 64, width: 176, height: 196, fill: '#f7fafc', stroke: '#f28c28', 'stroke-width': '10' }, svg);
  el('rect', { x: 228, y: 96, width: 120, height: 140, fill: '#c5e6f8', stroke: '#1d75bc', 'stroke-width': '2' }, svg);
  txt(288, 172, 'block frame', svg, { 'text-anchor': 'middle', 'font-size': '14' });
  el('line', { x1: 174, y1: 120, x2: 210, y2: 120, stroke: '#c4530a', 'stroke-width': '4' }, svg);
  el('circle', { cx: 168, cy: 120, r: 5, fill: '#c4530a' }, svg);
  el('line', { x1: 174, y1: 200, x2: 210, y2: 200, stroke: '#c4530a', 'stroke-width': '4' }, svg);
  el('circle', { cx: 168, cy: 200, r: 5, fill: '#c4530a' }, svg);
  txt(150, 88, 'screws', svg, { 'font-size': '13', fill: '#c4530a' });
  el('rect', { x: 420, y: 108, width: 28, height: 168, fill: '#f3eee6', stroke: '#0e3a63', 'stroke-width': '2' }, svg);
  el('rect', { x: 448, y: 108, width: 80, height: 168, fill: '#ead9bc', stroke: '#0e3a63', 'stroke-width': '2' }, svg);
  txt(488, 198, 'stucco', svg, { 'text-anchor': 'middle', 'font-size': '13' });
  txt(340, 292, 'A plain box in the opening. No fin sticks out past the wall.', svg, { 'text-anchor': 'middle', 'font-size': '14', 'font-weight': '600' });
  return svg;
}

function diagramFin() {
  const svg = baseSvg('Cross-section of a nailing-fin window with the fin under new stucco');
  wall(svg, { studW: 100, studX: 64 });
  el('rect', { x: 164, y: 108, width: 18, height: 168, fill: '#e7d3b0', stroke: '#0e3a63', 'stroke-width': '2' }, svg);
  el('rect', { x: 190, y: 70, width: 150, height: 186, fill: '#f7fafc', stroke: '#0e3a63', 'stroke-width': '3' }, svg);
  el('rect', { x: 214, y: 98, width: 104, height: 136, fill: '#c5e6f8', stroke: '#1d75bc', 'stroke-width': '2' }, svg);
  txt(265, 172, 'window', svg, { 'text-anchor': 'middle', 'font-size': '14' });
  el('rect', { x: 340, y: 118, width: 150, height: 16, fill: '#f28c28', stroke: '#c4530a', 'stroke-width': '2' }, svg);
  [370, 410, 450].forEach((x) => {
    el('line', { x1: x, y1: 104, x2: x, y2: 146, stroke: '#0e3a63', 'stroke-width': '3' }, svg);
    el('circle', { cx: x, cy: 104, r: 4, fill: '#0e3a63' }, svg);
  });
  txt(400, 96, 'nailing fin', svg, { 'text-anchor': 'middle', 'font-size': '14', fill: '#c4530a' });
  el('rect', { x: 400, y: 78, width: 150, height: 198, fill: '#ead9bc', stroke: '#0e3a63', 'stroke-width': '2', opacity: '0.92' }, svg);
  txt(475, 180, 'stucco', svg, { 'text-anchor': 'middle', 'font-size': '14' });
  txt(340, 300, 'The fin is nailed to the wall, then stucco or siding covers it.', svg, { 'text-anchor': 'middle', 'font-size': '14', 'font-weight': '600' });
  return svg;
}

function badge(on) {
  return on ? h('span', { class: 'pill ph' }, 'placeholder') : null;
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
  document.querySelectorAll('.ft-card').forEach((el) => el.classList.toggle('on', el.getAttribute('data-frame') === ft.id));
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
    if (!status.textContent) {
      status.textContent = line
        ? `Applies to ${line.label}, the latest window on this estimate.`
        : 'No window on the estimate yet. This choice is kept for the next one you add.';
    }
    list.append(h('article', { class: 'card ft-card' + (chosen === ft.id ? ' on' : ''), 'data-frame': ft.id },
      h('div', { class: 'ft-diagram' }, diagram(ft.diagram)),
      h('div', { class: 'ft-copy' },
        h('div', { class: 'row between wrap' }, h('h2', {}, ft.name), settings.showPlaceholders && ft.placeholder ? badge(true) : null),
        h('p', {}, ft.desc || ''),
        h('div', { class: 'ft-best' }, h('div', { class: 'ft-k' }, 'Best for'), h('p', {}, ft.bestFor || '')),
        h('div', { class: 'ft-split' },
          h('div', {}, h('div', { class: 'ft-k' }, 'Pros'), h('ul', {}, (ft.pros || []).map((p) => h('li', {}, p)))),
          h('div', {}, h('div', { class: 'ft-k' }, 'Cons'), h('ul', {}, (ft.cons || []).map((p) => h('li', {}, p))))),
        h('div', { class: 'ft-k' }, 'Installation'),
        h('p', {}, ft.installNote || ''),
        h('p', { class: 'fine' }, 'Linked install: ', labor.name, ' · ', fmt(labor.price), ' per window', labor.placeholder ? ' (placeholder price — edit data/install.json)' : ''),
        status,
        btn)));
  });
  return h('div', { class: 'ft' },
    h('p', { class: 'og-lead' }, 'Three ways the new window meets the wall. Orange marks the part that is different. Pick one for the window you are pricing.'),
    settings.showPlaceholders && h('p', { class: 'fine' }, 'This wording is placeholder. Edit it in ', h('code', {}, 'data/frame-types.json'), '.'),
    list);
}
