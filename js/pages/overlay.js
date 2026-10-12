import { h, data, colorById, toast } from '../core.js';
import { frameDataURL, FRAME_COLORS } from '../frames.js';

const MAXPX = 1600;
const S = { photo: null, overlays: [], sel: -1, name: 'photo' }; // survives tab switches within the session
const imgCache = new Map();
function frameImg(type, color, aspect, glass, cb) {
  const key = `${type}|${color}|${aspect.toFixed(3)}|${glass}`;
  let im = imgCache.get(key);
  if (!im) { im = new Image(); im.onload = cb; im.src = frameDataURL(type, color, aspect, { size: 800, glassOpacity: glass }); imgCache.set(key, im); }
  return im;
}

export function render(root) {
  const wrap = h('div', { class: 'page ov' });
  const canvas = h('canvas', { id: 'ov-canvas', class: 'ov-canvas' });
  const ctx = canvas.getContext('2d');
  const stage = h('div', { class: 'ov-stage' }, canvas);
  const empty = h('div', { class: 'ov-empty' }, h('p', {}, 'Take a photo of the customer’s existing window, or choose one from the photo library.'));
  const controls = h('div', { class: 'card ov-controls', id: 'ov-controls' });

  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, id: 'ov-file', onchange: (e) => loadFile(e.target.files[0]) });
  const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, id: 'ov-cam', onchange: (e) => loadFile(e.target.files[0]) });
  const top = h('div', { class: 'row gap wrap' },
    h('button', { class: 'btn primary', id: 'ov-take', onclick: () => camIn.click() }, '📷 Take photo'),
    h('button', { class: 'btn', id: 'ov-choose', onclick: () => fileIn.click() }, '🖼 Choose photo'),
    h('button', { class: 'btn', id: 'ov-sample', onclick: sample }, 'Use sample photo'),
    h('span', { class: 'pill ph' }, 'PREVIEW — not to scale'), fileIn, camIn);
  wrap.append(h('h1', {}, 'Window preview'), top, h('div', { class: 'two ovtwo' }, h('div', {}, stage, empty), controls));
  root.replaceChildren(wrap);

  function loadFile(f) {
    if (!f) return; const url = URL.createObjectURL(f); const im = new Image();
    im.onload = () => { setPhoto(im); URL.revokeObjectURL(url); }; im.src = url; S.name = (f.name || 'photo').replace(/\.[^.]+$/, '');
  }
  function setPhoto(im) {
    const sc = Math.min(1, MAXPX / Math.max(im.naturalWidth || im.width, im.naturalHeight || im.height));
    const c = document.createElement('canvas'); c.width = Math.round((im.naturalWidth || im.width) * sc); c.height = Math.round((im.naturalHeight || im.height) * sc);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); S.photo = c; S.overlays = []; addOverlay(); layout();
  }
  function sample() {
    const c = document.createElement('canvas'); c.width = 1400; c.height = 1000; const g = c.getContext('2d');
    g.fillStyle = '#d8c3a5'; g.fillRect(0, 0, 1400, 1000); // stucco wall
    for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${70 + Math.random() * 50},${50 + Math.random() * 40},.07)`; g.fillRect(Math.random() * 1400, Math.random() * 1000, 3, 3); }
    g.fillStyle = '#7a5a3a'; g.fillRect(0, 900, 1400, 100);
    g.fillStyle = '#b9b2a6'; g.fillRect(430, 230, 540, 480); g.fillStyle = '#8a8f93'; g.fillRect(455, 255, 490, 430);
    g.fillStyle = '#9fc4d8'; g.fillRect(465, 265, 215, 410); g.fillRect(700, 265, 235, 410);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(480, 265); g.lineTo(560, 265); g.lineTo(480, 400); g.fill();
    g.fillStyle = '#c5beb2'; g.fillRect(425, 710, 550, 22);
    g.fillStyle = '#fff'; g.font = '30px Helvetica'; g.fillText('SAMPLE WALL — your photo goes here', 40, 60);
    const im = new Image(); im.onload = () => { setPhoto(im); S.overlays[0].w = 540; S.overlays[0].x = 700; S.overlays[0].y = 470; S.overlays[0].aspect = 540 / 480; S.overlays[0].wIn = 54; S.overlays[0].hIn = 48; draw(); syncControls(); }; im.src = c.toDataURL('image/png'); S.name = 'sample';
  }
  function addOverlay(copy) {
    const w = S.photo ? S.photo.width : 1000, hh = S.photo ? S.photo.height : 800;
    const o = copy ? { ...copy, x: copy.x + 40, y: copy.y + 40 } : { type: 'hslider', color: 'white', aspect: 1.2, wIn: 60, hIn: 50, x: w / 2, y: hh / 2, w: w * 0.35, rot: 0, opacity: 0.75 };
    S.overlays.push(o); S.sel = S.overlays.length - 1;
  }
  function layout() {
    empty.style.display = S.photo ? 'none' : 'block'; canvas.style.display = S.photo ? 'block' : 'none';
    if (S.photo) { canvas.width = S.photo.width; canvas.height = S.photo.height; }
    draw(); syncControls();
  }
  function drawOverlay(g, o, selected) {
    const oh = o.w / o.aspect; const im = frameImg(o.type, o.color, o.aspect, 0.28, () => draw());
    g.save(); g.translate(o.x, o.y); g.rotate(o.rot * Math.PI / 180); g.globalAlpha = o.opacity;
    if (im.complete && im.naturalWidth) g.drawImage(im, -o.w / 2, -oh / 2, o.w, oh);
    g.globalAlpha = 1;
    if (selected) { g.strokeStyle = '#1d75bc'; g.lineWidth = Math.max(3, canvas.width / 400); g.setLineDash([14, 10]); g.strokeRect(-o.w / 2 - 6, -oh / 2 - 6, o.w + 12, oh + 12); g.setLineDash([]); g.fillStyle = '#1d75bc'; const r = Math.max(10, canvas.width / 90); g.beginPath(); g.arc(o.w / 2 + 6, oh / 2 + 6, r, 0, 7); g.fill(); }
    g.restore();
  }
  function draw(forExport = false) {
    if (!S.photo) return;
    const g = forExport ? forExport : ctx; const w = S.photo.width, hh = S.photo.height;
    g.clearRect(0, 0, w, hh); g.drawImage(S.photo, 0, 0);
    S.overlays.forEach((o, i) => drawOverlay(g, o, !forExport && i === S.sel));
    if (forExport) { const fs = Math.max(20, w / 45); g.font = `700 ${fs}px Helvetica,Arial`; const t = 'PREVIEW — Noble Windows & Doors (not to scale)'; const tw = g.measureText(t).width; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(12, hh - fs * 2.1, tw + 24, fs * 1.6); g.fillStyle = '#fff'; g.fillText(t, 24, hh - fs * 0.9); }
  }
  // ---- touch / mouse ----
  const pts = new Map(); let gest = null;
  const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; };
  function hit(p) { for (let i = S.overlays.length - 1; i >= 0; i--) { const o = S.overlays[i]; const a = -o.rot * Math.PI / 180, dx = p.x - o.x, dy = p.y - o.y; const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a); if (Math.abs(lx) <= o.w / 2 + 12 && Math.abs(ly) <= o.w / o.aspect / 2 + 12) return i; } return -1; }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, toCanvas(e));
    if (pts.size === 1) { const i = hit(pts.get(e.pointerId)); S.sel = i; draw(); syncControls(); if (i >= 0) { const o = S.overlays[i]; const p = pts.get(e.pointerId); gest = { mode: 'drag', ox: o.x, oy: o.y, px: p.x, py: p.y }; } else gest = null; }
    else if (pts.size === 2 && S.sel >= 0) { const [a, b] = [...pts.values()]; const o = S.overlays[S.sel]; gest = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), w: o.w, rot: o.rot }; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, toCanvas(e)); if (!gest || S.sel < 0) return; const o = S.overlays[S.sel];
    if (gest.mode === 'drag' && pts.size === 1) { const p = pts.get(e.pointerId); o.x = gest.ox + p.x - gest.px; o.y = gest.oy + p.y - gest.py; }
    else if (gest.mode === 'pinch' && pts.size >= 2) { const [a, b] = [...pts.values()]; o.w = Math.max(40, gest.w * Math.hypot(a.x - b.x, a.y - b.y) / gest.d); o.rot = gest.rot + (Math.atan2(b.y - a.y, b.x - a.x) - gest.ang) * 180 / Math.PI; syncControls(true); }
    draw();
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size === 1 && gest?.mode === 'pinch') { const p = [...pts.values()][0], o = S.overlays[S.sel]; gest = { mode: 'drag', ox: o.x, oy: o.y, px: p.x, py: p.y }; } else if (pts.size === 0) gest = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { if (S.sel < 0) return; e.preventDefault(); const o = S.overlays[S.sel]; if (e.shiftKey) o.rot += e.deltaY * 0.1; else o.w = Math.max(40, o.w * (1 - e.deltaY * 0.001)); draw(); syncControls(true); }, { passive: false });

  // ---- controls ----
  function syncControls(light) {
    if (light && controls.dataset.built) { const o = S.overlays[S.sel]; if (o) { const sz = controls.querySelector('#ov-size'), ro = controls.querySelector('#ov-rot'); if (sz) sz.value = o.w; if (ro) ro.value = Math.round(o.rot); } return; }
    controls.dataset.built = 1;
    const o = S.overlays[S.sel];
    controls.replaceChildren(h('h3', {}, 'New window overlay'),
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn sm', id: 'ov-add', onclick: () => { if (!S.photo) return toast('Choose a photo first'); addOverlay(); draw(); syncControls(); } }, '+ Add window'),
        h('button', { class: 'btn sm', disabled: o ? null : 'disabled', onclick: () => { if (o) { addOverlay(o); draw(); syncControls(); } } }, 'Duplicate'),
        h('button', { class: 'btn sm danger', disabled: o ? null : 'disabled', onclick: () => { S.overlays.splice(S.sel, 1); S.sel = S.overlays.length - 1; draw(); syncControls(); } }, 'Delete'),
        h('button', { class: 'btn sm primary', id: 'ov-save', onclick: save }, '⬇ Save image')),
      o ? h('div', {},
        h('b', {}, 'Window type'), h('div', { class: 'chips' }, data.rates.types.map((t) => h('button', { class: 'chip' + (o.type === t.id ? ' on' : ''), onclick: () => { o.type = t.id; draw(); syncControls(); } }, t.name.replace(' (Single Hung)', '')))),
        h('b', {}, 'Frame color'), h('div', { class: 'row gap wrap' }, ['white', 'black', 'bronze', 'adobe'].map((c) => h('button', { class: 'swatch' + (o.color === c ? ' on' : ''), onclick: () => { o.color = c; draw(); syncControls(); } }, h('i', { style: `background:${FRAME_COLORS[c].frame}` }), h('span', {}, c[0].toUpperCase() + c.slice(1)))),
          h('label', { class: 'swatch pick' }, h('i', { style: `background:${o.color.startsWith('#') ? o.color : 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)'}` }), h('span', {}, 'Custom'), h('input', { type: 'color', id: 'ov-color', value: o.color.startsWith('#') ? o.color : '#444444', oninput: (e) => { o.color = e.target.value; draw(); } }))),
        h('div', { class: 'grid2' },
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Width (in)'), h('input', { type: 'text', inputmode: 'decimal', value: o.wIn, oninput: (e) => { const v = parseFloat(e.target.value); if (v > 0) { o.wIn = v; o.aspect = o.wIn / o.hIn; draw(); } } })),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Height (in)'), h('input', { type: 'text', inputmode: 'decimal', value: o.hIn, oninput: (e) => { const v = parseFloat(e.target.value); if (v > 0) { o.hIn = v; o.aspect = o.wIn / o.hIn; draw(); } } }))),
        slider('Opacity', 'ov-op', 0.15, 1, 0.01, o.opacity, (v) => { o.opacity = v; draw(); }),
        slider('Size', 'ov-size', 40, S.photo ? S.photo.width * 1.5 : 1500, 1, o.w, (v) => { o.w = v; draw(); }),
        slider('Rotate', 'ov-rot', -30, 30, 0.5, o.rot, (v) => { o.rot = v; draw(); }),
        h('p', { class: 'fine' }, 'Drag to move · pinch to resize and rotate (or use sliders).')) : h('p', { class: 'muted' }, S.photo ? 'Tap a window to select it, or add one.' : 'Choose a photo to begin.'));
  }
  function slider(label, id, min, max, step, val, on) { return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type: 'range', id, min, max, step, value: val, oninput: (e) => on(parseFloat(e.target.value)) })); }
  async function save() {
    if (!S.photo) return toast('Choose a photo first');
    const c = document.createElement('canvas'); c.width = S.photo.width; c.height = S.photo.height; draw(c.getContext('2d'));
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)); const file = new File([blob], `noble-preview-${S.name}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Window preview' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = h('a', { href: URL.createObjectURL(blob), download: file.name }); document.body.append(a); a.click(); a.remove(); toast('Saved image');
  }
  layout();
}
