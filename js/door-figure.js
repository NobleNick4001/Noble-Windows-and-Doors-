// Door photo plus a swing mark. The same geometry is drawn on screen and in the PDF.
// Outside view: Left Hand hinges on the left, Right Hand on the right.
// Inswing (dashed arc) opens away from you. Outswing (solid arc) opens toward you.
// On a pair, the handing names the active leaf. The other leaf is fixed.
import { h, data } from './core.js';
import { handingOf, handingLabel, prehungImage, prehungSummary } from './prehung.js';

const INK = '#0b1f3a';
const ARC = '#f15a22';

function hingeSide(side) {
  return side === 'left';
}

// Fractions of a 100 by 160 slab. Shared by the SVG overlay and the PDF canvas.
function slabMarks(mark, { active, side }) {
  const left = hingeSide(side);
  const x = left ? 6 : 94;
  const hinges = [36, 80, 124].map((y) => ({
    x1: left ? 1 : 88, y1: y, x2: left ? 11 : 99, y2: y,
  }));
  const cy = 146;
  const r = 16;
  const arc = active ? {
    x, cy, r,
    endX: left ? x + r : x - r,
    sweep: left ? 1 : 0,
    dashed: mark.swing === 'in',
  } : null;
  return { hinges, arc, fixed: active ? '' : 'Fixed' };
}

function overlaySvg(mark, opts) {
  const { hinges, arc, fixed } = slabMarks(mark, opts);
  const lines = hinges.map((seg) => `<line x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`).join('');
  let curve = '';
  if (arc) {
    const dash = arc.dashed ? ' stroke-dasharray="5 3.5"' : '';
    curve = `<path d="M ${arc.x} ${arc.cy - arc.r} A ${arc.r} ${arc.r} 0 0 ${arc.sweep} ${arc.endX} ${arc.cy}" fill="none" stroke="${ARC}" stroke-width="3.4" stroke-linecap="round" vector-effect="non-scaling-stroke"${dash}/>`;
    curve += `<polygon points="${arc.endX},${arc.cy + 5} ${arc.endX - 4.2},${arc.cy - 2} ${arc.endX + 4.2},${arc.cy - 2}" fill="${ARC}"/>`;
  }
  const tag = fixed ? `<text x="50" y="152" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#5c6770">${fixed}</text>` : '';
  return `<svg viewBox="0 0 100 160" preserveAspectRatio="none" aria-hidden="true">${lines}${curve}${tag}</svg>`;
}

function slabEl(src, alt, mirror, mark, active, side) {
  return h('div', { class: 'slab-wrap' },
    h('img', { src, alt, class: mirror ? 'mirror' : null }),
    h('div', { class: 'swing-overlay', html: overlaySvg(mark, { active, side }) }));
}

export function prehungFigureEl(line, catalog = data.prehung) {
  const spec = line?.prehung || {};
  const src = prehungImage(catalog, spec);
  const mark = handingOf(line?.handing);
  const pair = !!spec.double;
  const alt = prehungSummary(catalog, line).title || 'Prehung door';
  const label = handingLabel(line);
  const slabs = h('div', { class: 'door-slabs' + (pair ? ' pair' : '') },
    slabEl(src, alt, false, mark, !pair || mark.active === 'left', pair ? 'left' : mark.hand),
    pair ? slabEl(src, alt, true, mark, mark.active === 'right', 'right') : null);
  return h('div', {
    class: 'door-figure' + (pair ? ' pair' : ''),
    'data-handing': line?.handing || '',
    'data-pair': pair ? '1' : '0',
    'aria-label': `${alt}. ${label}`,
  }, slabs, h('div', { class: 'hand-tag' }, label));
}

function loadPhoto(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

function paintMarks(ctx, x, y, w, h, mark, opts) {
  const { hinges, arc, fixed } = slabMarks(mark, opts);
  const px = (n) => x + (n / 100) * w;
  const py = (n) => y + (n / 160) * h;
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(3, w * 0.035);
  for (const seg of hinges) {
    ctx.beginPath();
    ctx.moveTo(px(seg.x1), py(seg.y1));
    ctx.lineTo(px(seg.x2), py(seg.y2));
    ctx.stroke();
  }
  if (arc) {
    ctx.beginPath();
    ctx.strokeStyle = ARC;
    ctx.lineWidth = Math.max(4, w * 0.045);
    ctx.setLineDash(arc.dashed ? [w * 0.06, w * 0.04] : []);
    const start = -Math.PI / 2;
    const end = arc.sweep ? 0 : Math.PI;
    ctx.arc(px(arc.x), py(arc.cy), (arc.r / 100) * w, start, end, !arc.sweep);
    ctx.stroke();
    ctx.setLineDash([]);
    const ax = px(arc.endX);
    const ay = py(arc.cy);
    const s = Math.max(5, w * 0.045);
    ctx.fillStyle = ARC;
    ctx.beginPath();
    ctx.moveTo(ax, ay + s);
    ctx.lineTo(ax - s * 0.85, ay - s * 0.35);
    ctx.lineTo(ax + s * 0.85, ay - s * 0.35);
    ctx.closePath();
    ctx.fill();
  }
  if (fixed) {
    ctx.fillStyle = '#5c6770';
    ctx.font = `700 ${Math.max(12, w * 0.11)}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fixed, x + w / 2, y + h * 0.95);
  }
}

export async function renderPrehungPng(line, catalog = data.prehung) {
  const spec = line?.prehung || {};
  const src = prehungImage(catalog, spec);
  if (!src || typeof document === 'undefined') return null;
  const img = await loadPhoto(src);
  const mark = handingOf(line?.handing);
  const pair = !!spec.double;
  const slabW = 280;
  const slabH = 460;
  const gap = 16;
  const pad = 10;
  const labelH = 64;
  const width = pad * 2 + slabW * (pair ? 2 : 1) + (pair ? gap : 0);
  const height = pad + slabH + labelH;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const drawSlab = (sx, mirror, active, side) => {
    if (mirror) {
      ctx.save();
      ctx.translate(sx + slabW, pad);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, slabW, slabH);
      ctx.restore();
    } else {
      ctx.drawImage(img, sx, pad, slabW, slabH);
    }
    paintMarks(ctx, sx, pad, slabW, slabH, mark, { active, side });
  };
  drawSlab(pad, false, !pair || mark.active === 'left', pair ? 'left' : mark.hand);
  if (pair) drawSlab(pad + slabW + gap, true, mark.active === 'right', 'right');
  ctx.fillStyle = INK;
  ctx.font = '700 28px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(handingLabel(line), width / 2, pad + slabH + labelH / 2);
  return { url: canvas.toDataURL('image/png'), w: width, h: height, fmt: 'PNG' };
}
