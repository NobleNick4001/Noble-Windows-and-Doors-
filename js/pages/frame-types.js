import { h, fmt, data, estimates, toast, installUnit, installType, defaultInstall } from '../core.js';
import { applyFrameType, currentFrameType } from './calculator.js';

/*
 * Frame-type pictures are original drawings made for this screen.
 * No manufacturer figure is embedded.
 *
 * Two pictures per install, plus a simple side slice:
 * - Outside, from the yard: tan stucco (or block), gray old frame, white new
 *   window, orange on the part that is different.
 * - Side slice: a chunky cartoon cut with at most four plain labels.
 *
 * Looked for a diagram we are allowed to reuse, and did not find one of these
 * three installs:
 * - Milgard and Andersen installation guides. Copyrighted by the manufacturers.
 *   No reuse grant that covers copying a figure into this app. Not used.
 * - AAMA 2410-13 (flush-fin / mounting-flange figures). The published practice
 *   says it may not be reproduced or distributed without written consent. Not used.
 * - Anlin, 1st Windows, and OSI/Henkel install drawings. Commercial copyright,
 *   no reuse license found. Not used.
 * - Wikimedia Commons, File:Aluminium_window_detail.png, ProfDEH, 2016-02-25.
 *   CC BY-SA 3.0 and GFDL 1.2 or later. A brick-cavity aluminum window. Not used.
 * - Wikimedia Commons, File:Box_window_section_drawing.jpg, Christophe Krief.
 *   CC BY-SA 4.0. A box/bay window. Not used.
 * - Wikimedia Commons double-glazed unit diagram (NcLean) and Passivhaus
 *   Fenster Beispiele (GFDL, Passivhaus Institut). Glass build-up, not an
 *   install. Not used.
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
function priceLabel(n) {
  const text = fmt(n);
  return text.endsWith('.00') ? text.slice(0, -3) : text;
}

const NS = 'http://www.w3.org/2000/svg';
const STUCCO = '#e7d2aa';
const SPECK = '#dcc296';
const PATCH = '#f6e7c8';
const BLOCK = '#d7cec2';
const MORTAR = '#c3b7a6';
const OLD = '#8e99a4';
const WHITE = '#f7fafc';
const GLASS = '#7ec8ea';
const GLASS_OLD = '#a9c6d6';
const ORANGE = '#f28c28';
const WOOD = '#e0b07a';
const NAVY = '#0e3a63';

let seq = 0;
function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
}
function svgEl(label, w, h) {
  return el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label });
}
function rect(parent, x, y, w, h, fill, rx = 0) {
  return el('rect', { x, y, width: w, height: h, rx, fill }, parent);
}
function clipGroup(svg, w, h, rx) {
  const id = 'ftc' + (++seq);
  const defs = el('defs', {}, svg);
  const cp = el('clipPath', { id }, defs);
  el('rect', { width: w, height: h, rx }, cp);
  return el('g', { 'clip-path': `url(#${id})` }, svg);
}
const SPECKS = [[18, 22], [78, 14], [150, 24], [186, 48], [24, 78], [176, 96], [14, 140], [168, 150], [40, 196], [150, 188], [100, 210]];
function stuccoWall(svg, w = 200, h = 230) {
  const g = clipGroup(svg, w, h, 18);
  rect(g, 0, 0, w, h, STUCCO);
  SPECKS.forEach(([x, y]) => el('circle', { cx: x, cy: y, r: 8, fill: SPECK }, g));
  return g;
}
function blockWall(svg, w = 200, h = 230) {
  const g = clipGroup(svg, w, h, 18);
  rect(g, 0, 0, w, h, BLOCK);
  for (let y = 28; y < h; y += 34) rect(g, 0, y, w, 4, MORTAR);
  for (let row = 0, y = 0; y < h; y += 34, row++) {
    const start = row % 2 ? 18 : 62;
    for (let x = start; x < w; x += 76) rect(g, x, y, 4, 34, MORTAR);
  }
  return g;
}
function panes(parent, x, y, w, h, old) {
  rect(parent, x, y, w, h, old ? GLASS_OLD : GLASS, 4);
  rect(parent, x + w * 0.5, y + 3, w * 0.5 - 3, h - 6, old ? '#c5d7e2' : '#d7f0fb');
  rect(parent, x + w * 0.46, y, Math.max(7, w * 0.08), h, old ? '#d5dde2' : WHITE);
}
function shadow(parent, x, y, w, h) {
  rect(parent, x + 5, y + 6, w, h, 'rgba(90,60,20,.18)', 8);
}

function outsideRetro(after) {
  const svg = svgEl(after
    ? 'Stucco wall unchanged. The old frame is still there, the new window sits inside it, and an orange Z-bar covers the edge.'
    : 'Stucco wall with the old window.', 200, 230);
  const g = stuccoWall(svg);
  if (!after) {
    shadow(g, 36, 34, 128, 162);
    rect(g, 36, 34, 128, 162, OLD, 6);
    panes(g, 52, 50, 96, 130, true);
    return svg;
  }
  shadow(g, 28, 26, 144, 178);
  rect(g, 28, 26, 144, 178, ORANGE, 8);
  rect(g, 48, 46, 104, 138, OLD, 6);
  rect(g, 66, 64, 68, 102, WHITE, 4);
  panes(g, 76, 78, 48, 74, false);
  return svg;
}
function outsideBlock(after) {
  const svg = svgEl(after
    ? 'Block wall, not cut. The new window is sealed into the opening. No fin sticks out.'
    : 'Block wall with the old window.', 200, 230);
  const g = blockWall(svg);
  shadow(g, 40, 36, 120, 158);
  if (!after) {
    rect(g, 40, 36, 120, 158, OLD, 6);
    panes(g, 54, 52, 92, 126, true);
    return svg;
  }
  rect(g, 40, 36, 120, 158, ORANGE, 8);
  rect(g, 52, 48, 96, 134, WHITE, 6);
  panes(g, 64, 64, 72, 102, false);
  return svg;
}
function outsideNail(patched) {
  const svg = svgEl(patched
    ? 'The stucco is patched and painted. The fin is hidden and the new window is in place.'
    : 'A band of stucco is cut back. The orange fin is nailed to the wood around the new window.', 200, 230);
  const g = stuccoWall(svg);
  if (!patched) {
    rect(g, 22, 18, 156, 194, WOOD, 8);
    rect(g, 40, 36, 120, 158, ORANGE, 6);
    rect(g, 58, 54, 84, 122, WHITE, 4);
    panes(g, 68, 68, 64, 94, false);
    [[49, 48], [151, 48], [49, 116], [151, 116], [49, 180], [151, 180]].forEach(([x, y]) => {
      el('circle', { cx: x, cy: y, r: 4.5, fill: NAVY }, g);
    });
    return svg;
  }
  rect(g, 24, 20, 152, 190, PATCH, 10);
  shadow(g, 46, 42, 108, 146);
  rect(g, 46, 42, 108, 146, WHITE, 6);
  panes(g, 58, 58, 84, 114, false);
  return svg;
}
function outside(kind) {
  if (kind === 'block') return [outsideBlock(false), outsideBlock(true)];
  if (kind === 'nailfin') return [outsideNail(false), outsideNail(true)];
  return [outsideRetro(false), outsideRetro(true)];
}

function sideRetro() {
  const svg = svgEl('Side slice. The old frame stays, the new window sits inside it, the orange Z-bar covers the gap, and the stucco is untouched.', 360, 168);
  rect(svg, 0, 0, 360, 168, '#e7f2fb', 16);
  rect(svg, 16, 36, 210, 108, '#e8c98a', 16);
  rect(svg, 176, 18, 168, 136, STUCCO, 18);
  rect(svg, 70, 50, 112, 80, OLD, 10);
  rect(svg, 92, 66, 64, 48, WHITE, 8);
  panes(svg, 102, 74, 44, 32, false);
  rect(svg, 156, 36, 118, 36, ORANGE, 10);
  rect(svg, 156, 58, 40, 78, ORANGE, 10);
  return svg;
}
function sideBlock() {
  const svg = svgEl('Side slice. The new window is sealed into the block. Nothing sticks out past the wall, and the stucco is not cut.', 360, 168);
  rect(svg, 0, 0, 360, 168, '#e7f2fb', 16);
  rect(svg, 16, 22, 328, 128, BLOCK, 18);
  for (let y = 48; y < 140; y += 28) rect(svg, 16, y, 328, 4, MORTAR);
  rect(svg, 112, 36, 136, 100, ORANGE, 14);
  rect(svg, 128, 52, 104, 68, WHITE, 10);
  panes(svg, 142, 64, 76, 44, false);
  return svg;
}
function sideNail() {
  const svg = svgEl('Side slice. The stucco is cut back, the orange fin is nailed on, then a patch covers it.', 360, 168);
  rect(svg, 0, 0, 360, 168, '#e7f2fb', 16);
  rect(svg, 16, 50, 250, 80, WOOD, 14);
  rect(svg, 28, 62, 72, 56, WHITE, 8);
  panes(svg, 38, 72, 52, 36, false);
  rect(svg, 96, 58, 90, 24, ORANGE, 8);
  [114, 138, 162].forEach((x) => el('circle', { cx: x, cy: 70, r: 5, fill: NAVY }, svg));
  rect(svg, 248, 20, 96, 132, STUCCO, 16);
  rect(svg, 176, 28, 110, 116, PATCH, 16);
  return svg;
}
function side(kind) {
  if (kind === 'block') return sideBlock();
  if (kind === 'nailfin') return sideNail();
  return sideRetro();
}

function iconBox(draw) {
  const svg = el('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' });
  rect(svg, 0, 0, 64, 64, '#fff3e4', 16);
  draw(svg);
  return svg;
}
function icon(kind, index) {
  if (kind === 'block') {
    if (index === 0) return iconBox((s) => { rect(s, 10, 14, 44, 36, BLOCK, 4); rect(s, 22, 22, 20, 20, OLD, 2); });
    if (index === 1) return iconBox((s) => { rect(s, 10, 14, 44, 36, BLOCK, 4); rect(s, 22, 22, 20, 20, WHITE, 2); panes(s, 26, 26, 12, 12, false); });
    return iconBox((s) => { rect(s, 10, 14, 44, 36, BLOCK, 4); rect(s, 20, 20, 24, 24, ORANGE, 3); rect(s, 26, 26, 12, 12, WHITE, 2); });
  }
  if (kind === 'nailfin') {
    if (index === 0) return iconBox((s) => { rect(s, 8, 12, 48, 40, STUCCO, 4); rect(s, 16, 18, 32, 28, WOOD, 3); });
    if (index === 1) return iconBox((s) => { rect(s, 8, 28, 48, 14, WOOD, 3); rect(s, 14, 22, 22, 18, WHITE, 2); rect(s, 32, 24, 20, 8, ORANGE, 2); });
    return iconBox((s) => { rect(s, 8, 12, 48, 40, STUCCO, 4); rect(s, 18, 20, 28, 24, PATCH, 3); rect(s, 24, 26, 16, 12, WHITE, 2); });
  }
  if (index === 0) return iconBox((s) => { rect(s, 14, 12, 36, 40, OLD, 4); panes(s, 22, 20, 20, 24, true); });
  if (index === 1) return iconBox((s) => { rect(s, 12, 12, 40, 40, OLD, 4); rect(s, 22, 22, 20, 20, WHITE, 3); panes(s, 26, 26, 12, 12, false); });
  return iconBox((s) => { rect(s, 10, 10, 44, 44, ORANGE, 6); rect(s, 20, 20, 24, 24, OLD, 3); rect(s, 26, 26, 12, 12, WHITE, 2); });
}

const SWATCH = { old: OLD, new: '#ffffff', orange: ORANGE, stucco: STUCCO, block: BLOCK, wood: WOOD, patch: PATCH, none: 'transparent' };

function tag(item) {
  const dot = h('i', { class: 'ft-swatch' + (item.swatch === 'none' ? ' none' : '') });
  if (item.swatch !== 'none') dot.style.background = SWATCH[item.swatch] || STUCCO;
  return h('span', { class: 'ft-tag' }, dot, item.text);
}
function pictures(ft) {
  const caps = ft.outside || ['Before', 'After'];
  const pair = h('div', { class: 'ft-pair' }, outside(ft.diagram).map((pic, i) => h('figure', {}, pic, h('figcaption', {}, caps[i] || ''))));
  const labels = h('div', { class: 'ft-tags' }, (ft.sideLabels || []).slice(0, 4).map(tag));
  return h('div', { class: 'ft-visual' },
    h('div', { class: 'ft-kicker' }, 'From the outside'),
    pair,
    h('div', { class: 'ft-kicker' }, 'From the side'),
    h('div', { class: 'ft-side' }, side(ft.diagram), labels));
}
function steps(ft) {
  const lines = ft.steps || [];
  return h('div', { class: 'ft-steps' }, lines.slice(0, 3).map((text, i) => h('div', { class: 'ft-step' },
    h('span', { class: 'ft-num' }, String(i + 1)),
    icon(ft.diagram, i),
    h('p', {}, text))));
}
function facts(ft, labor) {
  const c = ft.compare || {};
  const cells = [
    ['Stucco', c.stucco || ''],
    ['Mess', c.mess || ''],
    ['Time', c.time || ''],
    ['Price', priceLabel(labor.price)],
  ];
  return h('div', { class: 'ft-facts', id: 'ft-facts-' + ft.id }, cells.map(([k, v], i) => {
    const hot = i === 3 || v === 'Yes' || v === 'More' || v === 'Longer';
    return h('div', { class: 'ft-fact' + (i === 3 ? ' price' : '') }, h('span', {}, k), h('b', { class: hot && i !== 3 ? 'hot' : '' }, v));
  }));
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
  const close = h('button', { type: 'button', class: 'btn primary', id: 'ft-zoom-close', onclick: () => stop() }, 'Close');
  openEl = h('div', { class: 'ft-zoom', id: 'ft-zoom', role: 'dialog', 'aria-modal': 'true', 'aria-label': ft.name },
    h('div', { class: 'ft-zoom-bar' }, h('h2', {}, ft.name), close),
    h('div', { class: 'ft-zoom-stage' }, pictures(ft), steps(ft), facts(ft, installType(ft.installType))));
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
    list.append(h('article', { class: 'card ft-card' + (chosen === ft.id ? ' on' : ''), id: 'ft-card-' + ft.id, 'data-frame': ft.id },
      h('h2', {}, ft.name),
      h('p', { class: 'ft-one' }, ft.desc || ''),
      h('button', {
        type: 'button', class: 'ft-pics', id: 'ft-diagram-' + ft.id,
        'aria-label': 'Enlarge the ' + ft.name + ' pictures',
        onclick: () => openZoom(ft),
      }, pictures(ft), h('span', { class: 'ft-tap' }, 'Tap to enlarge')),
      h('div', { class: 'ft-kicker' }, 'What we do'),
      steps(ft),
      facts(ft, labor),
      h('p', { class: 'fine' }, 'Install labor: ', labor.name),
      status,
      btn));
  });
  return h('div', { class: 'ft' },
    h('p', { class: 'og-lead' }, 'Orange is the part that is different. The stucco color stays the same when we do not cut it.'),
    list);
}
