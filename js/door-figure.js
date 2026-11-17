// Plain door photo. A double is the same slab twice, the right one mirrored.
// Handing is written as text on the line, not drawn on the picture.
import { h, data } from './core.js';
import { prehungImage, prehungSummary } from './prehung.js';

function slabEl(src, alt, mirror) {
  return h('div', { class: 'slab-wrap' }, h('img', { src, alt, class: mirror ? 'mirror' : null }));
}

export function prehungFigureEl(line, catalog = data.prehung) {
  const spec = line?.prehung || {};
  const src = prehungImage(catalog, spec);
  const pair = !!spec.double;
  const alt = prehungSummary(catalog, line).title || 'Prehung door';
  return h('div', {
    class: 'door-figure' + (pair ? ' pair' : ''),
    'data-pair': pair ? '1' : '0',
    'aria-label': alt,
  }, h('div', { class: 'door-slabs' + (pair ? ' pair' : '') },
    slabEl(src, alt, false),
    pair ? slabEl(src, alt, true) : null));
}

function loadPhoto(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

export async function renderPrehungPng(line, catalog = data.prehung) {
  const spec = line?.prehung || {};
  const src = prehungImage(catalog, spec);
  if (!src || typeof document === 'undefined') return null;
  const img = await loadPhoto(src);
  const pair = !!spec.double;
  const boxW = 335;
  const boxH = 750;
  const canvas = document.createElement('canvas');
  canvas.width = boxW;
  canvas.height = boxH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, boxW, boxH);
  const gap = pair ? 10 : 0;
  const slots = pair ? 2 : 1;
  const slotW = (boxW - gap * (slots - 1)) / slots;
  const scale = Math.min(slotW / img.width, boxH / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const totalW = dw * slots + gap * (slots - 1);
  const ox = (boxW - totalW) / 2;
  const oy = (boxH - dh) / 2;
  const draw = (x, mirror) => {
    ctx.save();
    if (mirror) {
      ctx.translate(x + dw, oy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, dw, dh);
    } else {
      ctx.drawImage(img, x, oy, dw, dh);
    }
    ctx.restore();
  };
  draw(ox, false);
  if (pair) draw(ox + dw + gap, true);
  return { url: canvas.toDataURL('image/png'), w: boxW, h: boxH, fmt: 'PNG' };
}
