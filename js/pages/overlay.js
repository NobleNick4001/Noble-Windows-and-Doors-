import { h, toast, estimates, uid } from '../core.js';

const MAXPX = 1400;
const SAVE_MAX = 1400;
const S = {
  photo: null,
  name: 'photo',
  manifest: null,
  series: 'V300',
  type: 'hslider',
  color: 'white',
  frame: '',
  zbar: false,
  opacity: 1,
  original: false,
  corners: null,
  drag: null,
  coarse: false,
};
const images = new Map();
let manifestPromise = null;

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('data/overlay/manifest.json').then((r) => {
      if (!r.ok) throw new Error('manifest ' + r.status);
      return r.json();
    });
  }
  return manifestPromise;
}

function frameId(asset) {
  return (asset && asset.frame) || '';
}

function typesFor(series) {
  const ids = new Set(S.manifest.assets.filter((a) => a.series === series).map((a) => a.type));
  return S.manifest.types.filter((t) => ids.has(t.id));
}

function framesFor(series, type) {
  const ids = new Set(S.manifest.assets.filter((a) => a.series === series && a.type === type).map(frameId));
  const meta = S.manifest.frames || [{ id: '', name: 'Product photo' }];
  return meta.filter((f) => ids.has(f.id));
}

function colorsFor(series, type, frame) {
  const ids = new Set(S.manifest.assets.filter((a) => a.series === series && a.type === type && frameId(a) === frame && !a.zbar).map((a) => a.color));
  return S.manifest.colors.filter((c) => ids.has(c.id));
}

function hasZbar(series, type, color, frame) {
  return S.manifest.assets.some((a) => a.series === series && a.type === type && a.color === color && frameId(a) === frame && a.zbar);
}

function snap() {
  const types = typesFor(S.series);
  if (!types.some((t) => t.id === S.type)) S.type = types[0] ? types[0].id : S.type;
  const frames = framesFor(S.series, S.type);
  if (!frames.some((f) => f.id === (S.frame || ''))) S.frame = frames[0] ? frames[0].id : '';
  const colors = colorsFor(S.series, S.type, S.frame || '');
  if (!colors.some((c) => c.id === S.color)) S.color = colors[0] ? colors[0].id : S.color;
  if (!hasZbar(S.series, S.type, S.color, S.frame || '')) S.zbar = false;
}

function assetRow() {
  const m = S.manifest;
  if (!m) return null;
  const frame = S.frame || '';
  const match = (a, wanted) => a.series === S.series && a.type === S.type && a.color === S.color && frameId(a) === wanted && !!a.zbar === !!S.zbar;
  return m.assets.find((a) => match(a, frame)) || (frame ? m.assets.find((a) => match(a, '')) : null) || null;
}

function windowImage() {
  const row = assetRow();
  if (!row) return null;
  let im = images.get(row.file);
  if (!im) {
    im = new Image();
    im.onload = () => draw();
    im.src = row.file;
    images.set(row.file, im);
  }
  return im;
}

function prefetch(manifest) {
  for (const row of manifest.assets || []) {
    if (images.has(row.file)) continue;
    const im = new Image();
    im.src = row.file;
    images.set(row.file, im);
  }
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function bilerp(c, u, v) {
  return lerp(lerp(c[0], c[1], u), lerp(c[3], c[2], u), v);
}
function affine(src, dst) {
  const x0 = src[0], y0 = src[1], x1 = src[2], y1 = src[3], x2 = src[4], y2 = src[5];
  const dx1 = x1 - x0, dy1 = y1 - y0, dx2 = x2 - x0, dy2 = y2 - y0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-4) return null;
  const ux = dst[1].x - dst[0].x, uy = dst[1].y - dst[0].y;
  const vx = dst[2].x - dst[0].x, vy = dst[2].y - dst[0].y;
  const a = (ux * dy2 - vx * dy1) / den;
  const c = (vx * dx1 - ux * dx2) / den;
  const b = (uy * dy2 - vy * dy1) / den;
  const d = (vy * dx1 - uy * dx2) / den;
  return { a, b, c, d, e: dst[0].x - a * x0 - c * y0, f: dst[0].y - b * x0 - d * y0 };
}
function outset(pts) {
  const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
  const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
  return pts.map((p) => {
    const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * 0.8, y: p.y + (dy / len) * 0.8 };
  });
}
function warp(ctx, image, dst, alpha, n) {
  if (!image || !image.complete || !image.naturalWidth) return;
  const w = image.naturalWidth, h = image.naturalHeight;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
      const p00 = bilerp(dst, u0, v0), p10 = bilerp(dst, u1, v0), p11 = bilerp(dst, u1, v1), p01 = bilerp(dst, u0, v1);
      blit(ctx, image, [u0 * w, v0 * h, u1 * w, v0 * h, u0 * w, v1 * h], [p00, p10, p01]);
      blit(ctx, image, [u1 * w, v0 * h, u1 * w, v1 * h, u0 * w, v1 * h], [p10, p11, p01]);
    }
  }
  ctx.restore();
}
function blit(ctx, image, src, dst) {
  const m = affine(src, dst);
  if (!m) return;
  const clip = outset(dst);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(clip[0].x, clip[0].y);
  ctx.lineTo(clip[1].x, clip[1].y);
  ctx.lineTo(clip[2].x, clip[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function inQuad(p, q) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = q[j], b = q[i];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function defaultCorners(w, h) {
  return [
    { x: w * 0.28, y: h * 0.22 },
    { x: w * 0.72, y: h * 0.22 },
    { x: w * 0.72, y: h * 0.78 },
    { x: w * 0.28, y: h * 0.78 },
  ];
}

function captionFor(row) {
  const m = S.manifest;
  const series = m.series.find((s) => s.id === S.series)?.name || S.series;
  const type = m.types.find((t) => t.id === S.type)?.name || S.type;
  const color = m.colors.find((c) => c.id === S.color)?.name || S.color;
  const bits = [series, type, color];
  if (S.frame) {
    const frameName = (m.frames || []).find((f) => f.id === S.frame)?.name;
    if (frameName) bits.push(frameName);
  }
  if (S.zbar) bits.push('Z-bar');
  if (row?.approximate) bits.push('approximate');
  return bits.join(' · ');
}

export function render(root) {
  const wrap = h('div', { class: 'page ov' });
  const canvas = h('canvas', { id: 'ov-canvas', class: 'ov-canvas' });
  const ctx = canvas.getContext('2d');
  const stage = h('div', { class: 'ov-stage' }, canvas);
  const empty = h('div', { class: 'ov-empty' }, h('p', {}, 'Take a photo of the existing window, or choose one from the photo library. Then drag the corners to the opening.'));
  const controls = h('div', { class: 'card ov-controls', id: 'ov-controls' });
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, id: 'ov-file', onchange: (e) => loadFile(e.target.files[0]) });
  const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, id: 'ov-cam', onchange: (e) => loadFile(e.target.files[0]) });
  const top = h('div', { class: 'row gap wrap' },
    h('button', { class: 'btn primary', id: 'ov-take', onclick: () => camIn.click() }, 'Take photo'),
    h('button', { class: 'btn', id: 'ov-choose', onclick: () => fileIn.click() }, 'Choose photo'),
    h('button', { class: 'btn', id: 'ov-sample', onclick: sample }, 'Use sample photo'),
    fileIn, camIn);
  wrap.append(h('h1', {}, 'Window overlay'), top, h('div', { class: 'two ovtwo' }, h('div', {}, stage, empty), controls));
  root.replaceChildren(wrap);

  function loadFile(f) {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { setPhoto(im); URL.revokeObjectURL(url); };
    im.onerror = () => toast('Could not read that photo');
    im.src = url;
    S.name = (f.name || 'photo').replace(/\.[^.]+$/, '');
  }
  function setPhoto(im) {
    const sw = im.naturalWidth || im.width, sh = im.naturalHeight || im.height;
    const sc = Math.min(1, MAXPX / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * sc));
    c.height = Math.max(1, Math.round(sh * sc));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    S.photo = c;
    S.original = false;
    S.corners = defaultCorners(c.width, c.height);
    layout();
  }
  function sample() {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const g = c.getContext('2d');
    g.fillStyle = '#cbb59a';
    g.fillRect(0, 0, 1200, 900);
    for (let i = 0; i < 7000; i++) {
      g.fillStyle = `rgba(${80 + Math.random() * 50},${60 + Math.random() * 40},${40 + Math.random() * 30},.08)`;
      g.fillRect(Math.random() * 1200, Math.random() * 900, 3, 2);
    }
    g.fillStyle = '#8d7358';
    g.fillRect(0, 820, 1200, 80);
    g.fillStyle = '#9a9286';
    g.fillRect(360, 180, 500, 460);
    g.fillStyle = '#d9d4cc';
    g.fillRect(382, 202, 456, 416);
    g.fillStyle = '#6f8794';
    g.fillRect(400, 220, 200, 380);
    g.fillRect(620, 220, 200, 380);
    g.fillStyle = '#c5bfb6';
    g.fillRect(392, 400, 216, 10);
    g.fillRect(612, 400, 216, 10);
    g.fillStyle = '#b7b1a6';
    g.fillRect(352, 640, 516, 18);
    const im = new Image();
    im.onload = () => {
      setPhoto(im);
      const w = S.photo.width, h = S.photo.height;
      S.corners = [
        { x: w * 0.30, y: h * 0.20 },
        { x: w * 0.718, y: h * 0.188 },
        { x: w * 0.73, y: h * 0.72 },
        { x: w * 0.292, y: h * 0.735 },
      ];
      S.series = 'V300';
      S.type = 'hslider';
      S.color = 'white';
      S.frame = '';
      S.zbar = false;
      draw();
      syncControls();
    };
    im.src = c.toDataURL('image/jpeg', 0.85);
    S.name = 'sample';
  }

  function layout() {
    empty.style.display = S.photo ? 'none' : 'block';
    canvas.style.display = S.photo ? 'block' : 'none';
    if (S.photo) { canvas.width = S.photo.width; canvas.height = S.photo.height; }
    draw();
    syncControls();
  }
  function draw(target, forExport = false) {
    if (!S.photo) return;
    const g = target || ctx;
    g.clearRect(0, 0, S.photo.width, S.photo.height);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(S.photo, 0, 0);
    if (S.original || !S.corners) return;
    const im = windowImage();
    const n = forExport ? 22 : (S.coarse ? 8 : 16);
    warp(g, im, S.corners, S.opacity, n);
    if (!forExport) drawHandles(g);
  }
  function drawHandles(g) {
    const q = S.corners;
    if (!q) return;
    const lw = Math.max(2, S.photo.width / 420);
    g.save();
    g.strokeStyle = '#f28c28';
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) g.lineTo(q[i].x, q[i].y);
    g.closePath();
    g.stroke();
    const r = Math.max(12, S.photo.width / 70);
    q.forEach((p) => {
      g.beginPath();
      g.fillStyle = '#f28c28';
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = lw;
      g.strokeStyle = '#fff';
      g.stroke();
    });
    g.restore();
  }

  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
  };
  function hitCorner(p) {
    const r = Math.max(22, S.photo.width / 42);
    let best = -1, bestD = r * r;
    S.corners.forEach((c, i) => {
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d <= bestD) { best = i; bestD = d; }
    });
    return best;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!S.photo || S.original || !S.corners) return;
    canvas.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    const corner = hitCorner(p);
    if (corner >= 0) S.drag = { mode: 'corner', index: corner, pointer: e.pointerId };
    else if (inQuad(p, S.corners)) S.drag = { mode: 'move', pointer: e.pointerId, x: p.x, y: p.y, corners: S.corners.map((c) => ({ ...c })) };
    else S.drag = null;
    S.coarse = !!S.drag;
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!S.drag || S.drag.pointer !== e.pointerId) return;
    const p = toCanvas(e);
    if (S.drag.mode === 'corner') {
      const margin = 4;
      S.corners[S.drag.index] = {
        x: Math.min(S.photo.width - margin, Math.max(margin, p.x)),
        y: Math.min(S.photo.height - margin, Math.max(margin, p.y)),
      };
    } else {
      const dx = p.x - S.drag.x, dy = p.y - S.drag.y;
      S.corners = S.drag.corners.map((c) => ({ x: c.x + dx, y: c.y + dy }));
    }
    draw();
  });
  const up = (e) => {
    if (!S.drag || S.drag.pointer !== e.pointerId) return;
    S.drag = null;
    S.coarse = false;
    draw();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  function syncControls() {
    const m = S.manifest;
    if (!m) {
      controls.replaceChildren(h('h3', {}, 'New window'), h('p', { class: 'muted' }, 'Loading window photos…'));
      return;
    }
    snap();
    const row = assetRow();
    const chip = (id, on, label, fn) => h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), id, onclick: fn }, label);
    const types = typesFor(S.series);
    const frames = framesFor(S.series, S.type);
    const colors = colorsFor(S.series, S.type, S.frame || '');
    const showFrames = frames.some((f) => f.id);
    const frameChip = (f) => {
      const id = f.id === 'block' ? 'pick-frame-block' : f.id === 'nailfin' ? 'pick-frame-nailfin' : 'pick-frame-product';
      return chip(id, (S.frame || '') === f.id, f.name, () => { S.frame = f.id; snap(); draw(); syncControls(); });
    };
    controls.replaceChildren(
      h('h3', {}, 'New window'),
      h('b', {}, 'Series'),
      h('div', { class: 'chips', id: 'ov-series' }, m.series.map((s) => chip('pick-series-' + s.id, S.series === s.id, s.name, () => { S.series = s.id; snap(); draw(); syncControls(); }))),
      h('b', {}, 'Type'),
      h('div', { class: 'chips', id: 'ov-types' }, types.map((t) => chip('pick-type-' + t.id, S.type === t.id, t.name, () => { S.type = t.id; snap(); draw(); syncControls(); }))),
      showFrames ? h('b', {}, 'Frame') : null,
      showFrames ? h('div', { class: 'chips', id: 'ov-frames' }, frames.map(frameChip)) : null,
      h('b', {}, 'Color'),
      h('div', { class: 'swatches', id: 'ov-colors' }, colors.map((c) => h('button', {
        type: 'button', class: 'swatch' + (S.color === c.id ? ' on' : ''), id: 'pick-color-' + c.id,
        onclick: () => { S.color = c.id; snap(); draw(); syncControls(); },
      }, h('i', { style: `background:${c.swatch}` }), h('span', {}, c.name)))),
      hasZbar(S.series, S.type, S.color, S.frame || '') ? h('label', { class: 'check' }, h('input', {
        type: 'checkbox', id: 'ov-zbar', checked: S.zbar ? true : null,
        onchange: (e) => { S.zbar = e.target.checked; draw(); syncControls(); },
      }), h('span', {}, 'Z-bar')) : null,
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Opacity'), h('input', {
        type: 'range', id: 'ov-op', min: '0.15', max: '1', step: '0.01', value: String(S.opacity),
        oninput: (e) => { S.opacity = parseFloat(e.target.value); draw(); },
      })),
      h('label', { class: 'check' }, h('input', {
        type: 'checkbox', id: 'ov-original', checked: S.original ? true : null,
        onchange: (e) => { S.original = e.target.checked; draw(); },
      }), h('span', {}, 'Show original photo')),
      row?.approximate ? h('p', { class: 'ov-note', id: 'ov-note' }, row.note) : h('p', { class: 'fine', id: 'ov-note' }, 'Glass stays clear so the existing opening shows through.'),
      h('p', { class: 'fine' }, 'Drag a corner onto the opening. Drag inside the frame to move all four.'),
      h('button', { type: 'button', class: 'btn primary xl', id: 'ov-save', onclick: saveToEstimate }, 'Save to estimate'));
  }

  async function saveToEstimate() {
    if (!S.photo) return toast('Choose a photo first');
    const row = assetRow();
    if (!row) return toast('That window photo is not loaded yet');
    const im = windowImage();
    if (!im?.complete) return toast('The window photo is still loading');
    const sc = Math.min(1, SAVE_MAX / Math.max(S.photo.width, S.photo.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(S.photo.width * sc));
    c.height = Math.max(1, Math.round(S.photo.height * sc));
    const g = c.getContext('2d');
    g.scale(sc, sc);
    const was = S.original;
    S.original = false;
    draw(g, true);
    S.original = was;
    const image = c.toDataURL('image/jpeg', 0.72);
    const e = estimates.current();
    e.overlays = e.overlays || [];
    e.overlays.push({
      id: uid(),
      at: Date.now(),
      caption: captionFor(row),
      image,
      series: S.series,
      type: S.type,
      color: S.color,
      colorName: S.manifest.colors.find((c) => c.id === S.color)?.name || S.color,
      frame: S.frame || '',
      zbar: S.zbar,
      approximate: !!row.approximate,
      note: row.note || '',
    });
    estimates.save(e);
    toast('Saved to the current estimate');
  }

  layout();
  loadManifest().then((manifest) => {
    S.manifest = manifest;
    prefetch(manifest);
    syncControls();
    draw();
  }).catch(() => {
    controls.replaceChildren(h('h3', {}, 'New window'), h('p', { class: 'warn' }, 'Window photos could not be loaded. Connect once so they can be saved on this device.'));
  });
}
