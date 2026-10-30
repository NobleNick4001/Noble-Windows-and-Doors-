import { h, data, settings, estimates, toast, priceWindow, installUnit } from '../core.js';
import { icon } from '../icons.js';
import { applyObscurePattern, currentObscurePattern } from './calculator.js';

let openEl = null;
let onKey = null;

export function stop() {
  if (onKey) document.removeEventListener('keydown', onKey);
  onKey = null;
  if (openEl) openEl.remove();
  openEl = null;
  document.body.style.overflow = '';
}

function sections() { return data.obscureGlass?.sections || []; }
function patterns() {
  const fromSections = sections().flatMap((s) => s.patterns || []);
  return fromSections.length ? fromSections : (data.obscureGlass?.patterns || []);
}
function patternIdSet() { return new Set(patterns().map((p) => p.id)); }

function liveEstimate() {
  if (!estimates.currentId()) return null;
  return estimates.current();
}
function latestLine() {
  const e = liveEstimate();
  if (!e?.lines?.length) return null;
  return e.lines[e.lines.length - 1];
}

function selectedPatternId() {
  const ids = patternIdSet();
  const line = latestLine();
  const fromLine = line?.options?.find((id) => ids.has(id));
  return fromLine || currentObscurePattern();
}

function dots(n, light) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  return h('span', { class: 'og-dots' + (light ? ' light' : ''), 'aria-label': `Privacy ${v} of 5` },
    [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= v ? 'on' : '' })));
}

function sceneBody(sky) {
  return `
    <rect width="400" height="260" fill="url(#${sky})"/>
    <circle cx="328" cy="46" r="22" fill="#ffe08a"/>
    <ellipse cx="78" cy="52" rx="34" ry="14" fill="#fff" opacity=".9"/>
    <ellipse cx="104" cy="48" rx="22" ry="12" fill="#fff" opacity=".85"/>
    <path d="M0 168 C70 142 120 150 180 166 C250 186 300 150 400 162 V260 H0 Z" fill="#b7d48f"/>
    <path d="M0 198 C90 180 150 190 230 204 C310 218 350 196 400 202 V260 H0 Z" fill="#6aaa4e"/>
    <rect x="168" y="132" width="100" height="72" fill="#f6f1e8"/>
    <polygon points="156,132 218,86 280,132" fill="#c4553a"/>
    <rect x="206" y="166" width="24" height="38" fill="#6b4630"/>
    <rect x="180" y="146" width="22" height="18" fill="#8ecae6" stroke="#fff" stroke-width="3"/>
    <rect x="234" y="146" width="22" height="18" fill="#8ecae6" stroke="#fff" stroke-width="3"/>
    <rect x="86" y="154" width="12" height="48" fill="#6b4630"/>
    <circle cx="92" cy="140" r="28" fill="#2f7d3a"/>
    <circle cx="74" cy="152" r="18" fill="#3d9148"/>
    <circle cx="110" cy="154" r="16" fill="#246b32"/>
    <path d="M218 204 L232 260 L258 260 L232 204 Z" fill="#e4d3b0"/>`;
}

function filterInner(kind) {
  const turb = (freq, oct, seed, scale, type = 'turbulence') =>
    `<feTurbulence type="${type}" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}" result="n"/>
     <feDisplacementMap in="SourceGraphic" in2="n" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>`;
  switch (kind) {
    case 'rain': return `<feTurbulence type="turbulence" baseFrequency="0.012 0.22" numOctaves="2" seed="4" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="16" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feGaussianBlur in="d" stdDeviation="0.6 0.15"/>`;
    case 'gluechip': return turb('0.045', 4, 8, 9, 'fractalNoise');
    case 'reed': return turb('0.42 0.008', 2, 2, 7);
    case 'satin': return `<feGaussianBlur stdDeviation="7"/>`;
    case 'cord': return turb('0.07 0.02', 2, 5, 8);
    case 'aquatex': return turb('0.55 0.45', 2, 6, 4);
    case 'pebble': return turb('0.09', 3, 9, 8, 'fractalNoise');
    case 'flemish': return turb('0.022', 2, 11, 14, 'fractalNoise');
    case 'narrowreed': return turb('0.85 0.01', 2, 3, 6);
    case 'gray': return `<feGaussianBlur stdDeviation="1.5"/>`;
    case 'bronze': return `<feGaussianBlur stdDeviation="1.5"/>`;
    default: return `<feGaussianBlur stdDeviation="6"/>`;
  }
}

function overlay(kind) {
  if (kind === 'reed' || kind === 'narrowreed') {
    const step = kind === 'narrowreed' ? 7 : 12;
    const w = kind === 'narrowreed' ? 2 : 3.2;
    let bars = '';
    for (let x = 0; x < 400; x += step) bars += `<rect x="${x}" y="0" width="${w}" height="260" fill="#fff" opacity=".34"/>`;
    return bars;
  }
  if (kind === 'cord') {
    let paths = '';
    for (let x = 4; x < 400; x += 14) {
      let d = `M${x} 0`;
      for (let y = 0; y <= 260; y += 24) d += ` Q${x + 7} ${y + 12} ${x} ${y + 24}`;
      paths += `<path d="${d}" fill="none" stroke="#fff" stroke-width="2.2" opacity=".4"/>`;
    }
    return paths;
  }
  if (kind === 'aquatex') {
    let lines = '';
    for (let i = -260; i < 400; i += 8) {
      lines += `<path d="M${i} 0 L${i + 260} 260" stroke="#fff" stroke-width=".8" opacity=".28"/>`;
      lines += `<path d="M${i} 260 L${i + 260} 0" stroke="#fff" stroke-width=".8" opacity=".2"/>`;
    }
    return lines;
  }
  if (kind === 'gluechip') {
    return `<g fill="none" stroke="#fff" stroke-width="1.2" opacity=".35">
      <path d="M40 30 L120 80 L70 140 L20 90 Z"/><path d="M150 20 L230 50 L200 130 L140 100 Z"/>
      <path d="M250 40 L340 30 L360 120 L270 150 Z"/><path d="M80 160 L160 150 L190 230 L60 220 Z"/>
      <path d="M210 170 L300 180 L280 240 L190 230 Z"/></g>`;
  }
  if (kind === 'gray') return `<rect width="400" height="260" fill="#3e4650" opacity=".4"/>`;
  if (kind === 'bronze') return `<rect width="400" height="260" fill="#8a5324" opacity=".42"/>`;
  return '';
}

function glassSVG(kind, uid) {
  const sky = uid + 'sky';
  const sheen = uid + 'sheen';
  const fid = uid + 'f';
  const frame = `<rect x="7" y="7" width="386" height="246" fill="none" stroke="#f7f4ef" stroke-width="14"/>
    <rect x="14" y="14" width="372" height="232" fill="none" stroke="#d9d0c4" stroke-width="2"/>`;
  return `<svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="${sky}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6eb6e6"/><stop offset=".5" stop-color="#c5e6f8"/><stop offset="1" stop-color="#e7f4fb"/>
      </linearGradient>
      <linearGradient id="${sheen}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".1"/>
      </linearGradient>
      ${kind ? `<filter id="${fid}" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">${filterInner(kind)}</filter>` : ''}
    </defs>
    <g ${kind ? `filter="url(#${fid})"` : ''}>${sceneBody(sky)}</g>
    ${overlay(kind)}
    <rect width="400" height="260" fill="url(#${sheen})"/>
    ${frame}
  </svg>`;
}

let seq = 0;
const nextId = () => 'og' + (++seq);

function badge(p) {
  return settings.showPlaceholders && p.placeholder ? h('span', { class: 'pill ph' }, 'placeholder') : null;
}

function patternVisual(p, uid) {
  if (p?.image) return h('img', { class: 'og-photo', src: p.image, alt: '', width: '250', height: '250', decoding: 'async', draggable: 'false' });
  return h('div', { class: 'og-svg', html: glassSVG(p ? p.pattern : null, uid) });
}

function privacyRow(p) {
  if (p.privacy == null || p.privacy === '') {
    return h('div', { class: 'row wrap' }, h('span', { class: 'og-priv' }, 'Privacy'), h('span', { class: 'fine' }, 'Not set'));
  }
  return h('div', { class: 'row wrap' }, h('span', { class: 'og-priv' }, 'Privacy'), dots(p.privacy));
}

function nameBlock(p, Tag = 'b') {
  return h('div', {},
    h('div', { class: 'row wrap gap' }, h(Tag, {}, p.name), p.brand ? h('span', { class: 'og-brand' }, p.brand) : null),
    p.aka ? h('div', { class: 'fine' }, 'Also called ' + p.aka) : null);
}

function photoTile(p, chosen) {
  return h('button', {
    type: 'button', class: 'og-tile' + (p.id === chosen ? ' on' : ''), 'data-pattern': p.id,
    onclick: () => openCompare(p),
  },
    h('div', { class: 'og-pane' }, patternVisual(p, nextId())),
    h('div', { class: 'og-meta' },
      nameBlock(p),
      privacyRow(p),
      badge(p)));
}

function textRow(p) {
  const status = h('p', { class: 'fine og-status' });
  const btn = h('button', { type: 'button', class: 'btn sm' }, 'Select for this window');
  btn.addEventListener('click', () => savePattern(p, status, btn));
  return h('div', { class: 'card og-text' + (p.id === selectedPatternId() ? ' on' : ''), 'data-pattern': p.id },
    nameBlock(p),
    h('p', {}, p.desc || ''),
    p.seriesNote ? h('p', { class: 'fine' }, p.seriesNote) : null,
    p.limit ? h('p', { class: 'og-limit' }, p.limit) : null,
    privacyRow(p),
    badge(p),
    btn, status);
}

export function view() {
  const chosen = selectedPatternId();
  const secs = sections();
  const blocks = secs.length ? secs.map((sec) => h('section', { class: 'og-sec', 'data-brand': sec.brand || '' },
    h('h2', {}, sec.title || sec.brand || 'Patterns'),
    sec.lead ? h('p', { class: 'og-lead' }, sec.lead) : null,
    ...(sec.notes || []).map((n) => h('p', { class: 'fine' }, n)),
    sec.showPhotos === false
      ? h('div', { class: 'og-list' }, (sec.patterns || []).map(textRow))
      : h('div', { class: 'og-grid', id: sec.id === 'andersen' ? 'obscure-grid' : null }, (sec.patterns || []).map((p) => photoTile(p, chosen)))))
    : [h('div', { class: 'og-grid', id: 'obscure-grid' }, patterns().map((p) => photoTile(p, chosen)))];
  const obscurePrice = (data.options?.glass || []).find((o) => o.id === 'obscure');
  const pct = obscurePrice?.price?.type === 'percent' ? obscurePrice.price.amount : 0;
  return h('div', { class: 'og' },
    data.obscureGlass?.pageNote ? h('p', { class: 'og-lead' }, data.obscureGlass.pageNote) : null,
    h('p', { class: 'fine', id: 'obscure-price-note' }, pct
      ? `Obscured glass is an upcharge. Andersen and unfitted series add ${pct}% of the window price. Fitted Milgard series use their own obscure price. The pattern does not add a second charge, and it stacks with laminated and tempered glass.`
      : 'The pattern you pick does not add a second charge.'),
    settings.showPlaceholders && h('p', { class: 'fine' }, 'Privacy ratings are still placeholders. The site does not publish them. Reed is 3 and Satin Etch is 5 from the old generic list; every other pattern is blank. Edit ', h('code', {}, 'data/obscure-glass.json'), '.'),
    ...blocks);
}

function savePattern(p, statusEl, btn) {
  applyObscurePattern(p.id);
  const e = liveEstimate();
  const line = e?.lines?.length ? e.lines[e.lines.length - 1] : null;
  if (line) {
    const ids = patternIdSet();
    line.options = (line.options || []).filter((x) => !ids.has(x));
    if (!line.options.includes('obscure')) line.options.push('obscure');
    line.options.push(p.id);
    const priced = priceWindow(line);
    if (priced && !priced.blocked && priced.unit != null) {
      line.unitBase = priced.unitBase; line.optionsEach = priced.optionsEach; line.unit = priced.unit;
      line.rate = priced.rate; line.rateSet = settings.rateSet; line.estimated = priced.estimated;
    }
    line.installUnit = installUnit(line.install);
    estimates.persist();
    statusEl.textContent = `Saved on ${line.label}.`;
    toast(`${p.name} saved on ${line.label}`);
  } else {
    statusEl.textContent = 'Saved for the next window you add to the estimate.';
    toast(`${p.name} will be included on the next window you add`);
  }
  btn.textContent = 'Selected for this window';
  document.querySelectorAll('.og-tile, .og-text').forEach((el) => el.classList.toggle('on', el.getAttribute('data-pattern') === p.id));
}

function openCompare(p) {
  stop();
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  let pos = 58;
  const pat = h('div', { class: 'og-cmp-pat' }, h('div', { class: 'og-pane' }, patternVisual(p, nextId())));
  const bar = h('div', { class: 'og-cmp-bar' });
  const range = h('input', { type: 'range', min: '0', max: '100', value: String(pos), 'aria-label': `Compare clear glass with ${p.name}` });
  const setPos = (v) => {
    pos = Math.max(0, Math.min(100, v));
    pat.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
    bar.style.left = pos + '%';
    range.value = String(Math.round(pos));
  };
  range.addEventListener('input', () => setPos(Number(range.value)));
  const frame = h('div', { class: 'og-cmp-frame' },
    h('div', { class: 'og-pane' }, patternVisual(null, nextId())),
    pat, bar,
    h('span', { class: 'og-tag l' }, 'Clear'),
    h('span', { class: 'og-tag r' }, p.name));
  let drag = false;
  const move = (clientX) => {
    const r = frame.getBoundingClientRect();
    if (!r.width) return;
    setPos(((clientX - r.left) / r.width) * 100);
  };
  frame.addEventListener('pointerdown', (e) => { drag = true; frame.setPointerCapture?.(e.pointerId); move(e.clientX); });
  frame.addEventListener('pointermove', (e) => { if (drag) move(e.clientX); });
  const endDrag = () => { drag = false; };
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);
  const line = latestLine();
  const already = line?.options?.includes(p.id);
  const status = h('p', { class: 'fine', id: 'obscure-status' }, line
    ? (already ? `Already on ${line.label}.` : `Applies to ${line.label}, the latest window on this estimate.`)
    : 'No window on the estimate yet. This choice is kept for the next one you add.');
  const btn = h('button', { type: 'button', class: 'btn primary xl', id: 'btn-obscure-select' }, already ? 'Selected for this window' : 'Select for this window');
  btn.addEventListener('click', () => savePattern(p, status, btn));
  const close = h('button', { type: 'button', class: 'og-cmp-x', id: 'obscure-close', 'aria-label': 'Close', onclick: () => stop() }, icon('x'));
  const ov = h('div', { class: 'og-cmp', id: 'obscure-compare', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${p.name} compared with clear glass` },
    h('div', { class: 'og-cmp-top' }, close),
    h('div', { class: 'og-cmp-stage' }, frame),
    h('div', { class: 'og-cmp-panel' },
      h('div', { class: 'row between wrap' }, nameBlock(p, 'h2'), badge(p)),
      privacyRow(p),
      h('p', {}, p.desc || ''),
      h('div', { class: 'og-scale' }, h('span', {}, 'Clear'), h('span', {}, p.name)),
      range, status, btn));
  onKey = (e) => { if (e.key === 'Escape') stop(); };
  document.addEventListener('keydown', onKey);
  document.body.append(ov);
  openEl = ov;
  setPos(pos);
  document.body.style.overflow = 'hidden';
  void prevOverflow;
  range.focus();
}
