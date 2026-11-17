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
  const slabW = 280;
  const slabH = 460;
  const gap = 16;
  const pad = 10;
  const width = pad * 2 + slabW * (pair ? 2 : 1) + (pair ? gap : 0);
  const height = pad * 2 + slabH;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, pad, pad, slabW, slabH);
  if (pair) {
    ctx.save();
    ctx.translate(pad + slabW + gap + slabW, pad);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, slabW, slabH);
    ctx.restore();
  }
  return { url: canvas.toDataURL('image/png'), w: width, h: height, fmt: 'PNG' };
}
