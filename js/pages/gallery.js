import { h, data, settings } from '../core.js';
import { icon } from '../icons.js';

let timer = null;
let group = 'all';
export function stop() { clearInterval(timer); timer = null; }

function slides() { return data.gallery?.slides || []; }
function groups() { return data.gallery?.groups || []; }
function visible() {
  const all = slides();
  if (group === 'all') return all;
  return all.filter((s) => s.group === group);
}
function installLabel(s) {
  const t = s.installType;
  if (!t || t === 'unspecified') return '';
  if (t === 'newConstruction') return 'New construction';
  return t;
}
function metaLine(s) {
  const bits = [];
  if (s.brand) bits.push(s.series && s.series !== 'n/a' ? `${s.brand} ${s.series}` : s.brand);
  else if (s.series && s.series !== 'n/a') bits.push(s.series);
  const inst = installLabel(s);
  if (inst) bits.push(inst);
  return bits.join(' · ');
}
function labelOf(s) { return s.caption || s.title || ''; }

export function render(root) {
  const list = visible();
  const wrap = h('div', { class: 'page gal' }, h('div', { class: 'row between wrap' }, h('h1', {}, 'Gallery'), h('button', { class: 'btn primary', id: 'btn-slideshow', onclick: () => startShow(0) }, icon('play'), 'Start slideshow')));
  wrap.append(h('div', { class: 'chips', id: 'gal-filters' },
    h('button', { type: 'button', class: 'chip' + (group === 'all' ? ' on' : ''), onclick: () => { group = 'all'; render(root); } }, 'All'),
    ...groups().map((g) => h('button', { type: 'button', class: 'chip' + (group === g.id ? ' on' : ''), onclick: () => { group = g.id; render(root); } }, g.label))));
  if (!list.length) wrap.append(h('p', { class: 'muted' }, 'No photos in this filter.'));
  wrap.append(h('div', { class: 'thumbs' }, list.map((s, i) => h('button', { type: 'button', class: 'thumb', onclick: () => startShow(i) },
    h('img', { src: 'assets/gallery/' + s.src, alt: labelOf(s), loading: 'lazy', decoding: 'async', width: String(s.w || 400), height: String(s.h || 300) }),
    h('span', { class: 'cap' }, labelOf(s)),
    metaLine(s) ? h('span', { class: 'meta' }, metaLine(s)) : null))));
  root.replaceChildren(wrap);
}

export function startShow(start = 0) {
  const list = visible();
  if (!list.length) return;
  let i = start, playing = true, uiOn = true, x0 = null;
  const img = h('img', { class: 'ss-img', alt: '' });
  const cap = h('div', { class: 'ss-cap' });
  const dots = h('div', { class: 'ss-dots' });
  const play = h('button', { class: 'ss-btn', id: 'ss-play', 'aria-label': 'Pause', onclick: (e) => { e.stopPropagation(); toggle(); } }, icon('pause'));
  const close = h('button', { class: 'ss-btn ss-close', id: 'ss-close', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); end(); } }, icon('x'));
  const ov = h('div', { class: 'ss', id: 'slideshow' }, img, close, h('div', { class: 'ss-bar' }, play, cap, dots));
  const show = (n) => {
    i = (n + list.length) % list.length;
    const s = list[i];
    img.classList.remove('in');
    img.alt = labelOf(s);
    const modest = !!(s.lowRes && s.w && s.h);
    img.classList.toggle('modest', modest);
    if (modest) {
      img.style.setProperty('--nat-w', s.w + 'px');
      img.style.setProperty('--nat-h', s.h + 'px');
    } else {
      img.style.removeProperty('--nat-w');
      img.style.removeProperty('--nat-h');
    }
    img.src = 'assets/gallery/' + s.src;
    void img.offsetWidth;
    img.classList.add('in');
    const meta = metaLine(s);
    cap.replaceChildren(h('b', {}, labelOf(s)), meta ? h('span', {}, meta) : null);
    if (list.length > 10) dots.replaceChildren(h('span', { class: 'ss-count' }, `${i + 1} / ${list.length}`));
    else dots.replaceChildren(...list.map((_, k) => h('i', { class: k === i ? 'on' : '' })));
  };
  const restart = () => { clearInterval(timer); if (playing) timer = setInterval(() => show(i + 1), (settings.slideshowSeconds || 5) * 1000); };
  const toggle = () => { playing = !playing; play.replaceChildren(icon(playing ? 'pause' : 'play')); play.setAttribute('aria-label', playing ? 'Pause' : 'Play'); restart(); };
  const end = () => { clearInterval(timer); timer = null; document.removeEventListener('keydown', key); ov.remove(); if (document.fullscreenElement) document.exitFullscreen?.(); };
  const key = (e) => { if (e.key === 'ArrowRight') { show(i + 1); restart(); } else if (e.key === 'ArrowLeft') { show(i - 1); restart(); } else if (e.key === 'Escape') end(); else if (e.key === ' ') { e.preventDefault(); toggle(); } };
  ov.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; x0 = e.clientX; });
  ov.addEventListener('pointerup', (e) => {
    if (x0 == null) return; const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) { show(dx < 0 ? i + 1 : i - 1); restart(); return; }
    const third = ov.clientWidth / 3;
    if (e.clientX < third) { show(i - 1); restart(); } else if (e.clientX > 2 * third) { show(i + 1); restart(); } else { uiOn = !uiOn; ov.classList.toggle('hideui', !uiOn); }
  });
  document.addEventListener('keydown', key);
  document.body.append(ov); show(i); restart();
  try { ov.requestFullscreen?.(); } catch {}
}
