import { h, data, settings } from '../core.js';

let timer = null;
export function stop() { clearInterval(timer); timer = null; }

export function render(root) {
  const slides = data.gallery.slides;
  const wrap = h('div', { class: 'page gal' }, h('div', { class: 'row between wrap' }, h('h1', {}, 'Gallery'), h('button', { class: 'btn primary', id: 'btn-slideshow', onclick: () => startShow(0) }, '▶ Start slideshow')));
  if (slides.every((s) => s.placeholder)) wrap.append(h('div', { class: 'card note' }, h('b', {}, 'Add photos here. '), 'These are placeholder tiles. Copy installed-window photos into ', h('code', {}, 'assets/gallery/'), ' and list them in ', h('code', {}, 'assets/gallery/gallery.json'), '.'));
  wrap.append(h('div', { class: 'thumbs' }, slides.map((s, i) => h('button', { class: 'thumb', onclick: () => startShow(i) }, h('img', { src: 'assets/gallery/' + s.src, alt: s.title, loading: 'lazy' }), h('span', {}, s.title)))));
  root.replaceChildren(wrap);
}

export function startShow(start = 0) {
  const slides = data.gallery.slides; let i = start, playing = true, uiOn = true, x0 = null;
  const img = h('img', { class: 'ss-img', alt: '' });
  const cap = h('div', { class: 'ss-cap' });
  const dots = h('div', { class: 'ss-dots' });
  const play = h('button', { class: 'ss-btn', id: 'ss-play', 'aria-label': 'Play/pause', onclick: (e) => { e.stopPropagation(); toggle(); } }, '❚❚');
  const close = h('button', { class: 'ss-btn ss-close', id: 'ss-close', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); end(); } }, '✕');
  const ov = h('div', { class: 'ss', id: 'slideshow' }, img, close, h('div', { class: 'ss-bar' }, play, cap, dots));
  const show = (n, dir = 0) => { i = (n + slides.length) % slides.length; const s = slides[i]; img.classList.remove('in'); img.src = 'assets/gallery/' + s.src; void img.offsetWidth; img.classList.add('in');
    cap.replaceChildren(h('b', {}, s.title), h('span', {}, s.caption || '')); dots.replaceChildren(...slides.map((_, k) => h('i', { class: k === i ? 'on' : '' }))); };
  const restart = () => { clearInterval(timer); if (playing) timer = setInterval(() => show(i + 1), (settings.slideshowSeconds || 5) * 1000); };
  const toggle = () => { playing = !playing; play.textContent = playing ? '❚❚' : '▶'; restart(); };
  const end = () => { clearInterval(timer); timer = null; document.removeEventListener('keydown', key); ov.remove(); if (document.fullscreenElement) document.exitFullscreen?.(); };
  const key = (e) => { if (e.key === 'ArrowRight') { show(i + 1); restart(); } else if (e.key === 'ArrowLeft') { show(i - 1); restart(); } else if (e.key === 'Escape') end(); else if (e.key === ' ') toggle(); };
  ov.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  ov.addEventListener('pointerup', (e) => {
    if (x0 == null) return; const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) { show(dx < 0 ? i + 1 : i - 1); restart(); return; }
    const third = ov.clientWidth / 3; // tap left third = prev, right third = next, middle = toggle controls
    if (e.clientX < third) { show(i - 1); restart(); } else if (e.clientX > 2 * third) { show(i + 1); restart(); } else { uiOn = !uiOn; ov.classList.toggle('hideui', !uiOn); }
  });
  document.addEventListener('keydown', key);
  document.body.append(ov); show(i); restart();
  try { ov.requestFullscreen?.(); } catch {}
}
