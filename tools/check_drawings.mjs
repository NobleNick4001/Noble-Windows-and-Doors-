// Scaled elevations: every quoted style, several sizes, aspect ratio held (or capped).
import { windowDrawingSVG, fitDrawing, archRiseInches, canonicalType, DRAWING_TYPES, ASPECT_CAP } from '../js/drawings.js';
import { formatInches } from '../js/core.js';

let failed = 0;
const fail = (msg) => { failed++; console.error('FAIL', msg); };
const near = (a, b, tol, msg) => { if (Math.abs(a - b) > tol) fail(`${msg}: ${a} vs ${b}`); };

const quoted = [
  ['picture', {}],
  ['vslider', {}],
  ['dshung', {}],
  ['twin_vslider', {}],
  ['hslider', {}],
  ['hslider', { hand: 'OX' }],
  ['xox', {}],
  ['casement', {}],
  ['casement', { hand: 'Right' }],
  ['dcasement', {}],
  ['twin_casement', {}],
  ['awning', {}],
  ['hvb', {}],
  ['2panel', { brand: 'milgard', series: 'V300' }],
  ['3panel', { brand: 'milgard', series: 'V300' }],
  ['4panel', { brand: 'milgard', series: 'V300' }],
  ['patio_door_2p', { brand: 'andersen' }],
  ['archtop', { brand: 'milgard' }],
  ['arch', { brand: 'milgard' }],
  ['arch', { brand: 'andersen' }],
  ['halfround', {}],
  ['arch_sh', { brand: 'andersen' }],
  ['specialty_arch', { brand: 'andersen' }],
  ['arch_xo', {}],
  ['arch_xo', { hand: 'OX', leg: 40 }],
  ['arch_xox', {}],
  ['eyebrow_xo', {}],
  ['eyebrow_xox', {}],
  ['swing', {}],
  ['custom_supplier', {}],
];

for (const id of ['picture', 'vslider', 'hslider', 'xox', 'casement', 'awning', '2panel', '4panel', 'arch_sh', 'specialty_arch', 'archtop', 'arch_xo']) {
  if (!DRAWING_TYPES.includes(id) && id !== '2panel') fail('missing drawing type ' + id);
}

const sizes = [[36, 48], [72, 36], [24, 60], [59.5, 59.5], [48, 71], [30, 48]];
for (const [type, extra] of quoted) {
  for (const [w, h] of sizes) {
    const drawn = windowDrawingSVG({ type, w, h, ...extra }, { boxW: 220, boxH: 188 });
    if (!drawn.svg.includes('<svg') || !drawn.svg.includes('class="frame"') || !drawn.svg.includes('class="glass')) fail(`${type} ${w}x${h} svg incomplete`);
    if (!drawn.svg.includes(formatInches(w)) || !drawn.svg.includes(formatInches(h))) fail(`${type} ${w}x${h} missing dimension text`);
    const ratio = drawn.dw / drawn.dh;
    const real = w / h;
    const expect = real > ASPECT_CAP ? ASPECT_CAP : real < 1 / ASPECT_CAP ? 1 / ASPECT_CAP : real;
    near(ratio, expect, 0.02, `${type} ${w}x${h} aspect`);
    if (drawn.capped) fail(`${type} ${w}x${h} should not cap a normal size`);
    if (canonicalType({ type, ...extra }) === 'hslider' && extra.hand === 'OX' && !drawn.svg.includes('data-op="slide-left"')) fail('OX slider arrow should point left');
    if (type === 'hslider' && !extra.hand && !drawn.svg.includes('data-op="slide-right"')) fail('XO slider arrow should point right');
  }
}

const wide = windowDrawingSVG({ type: 'picture', w: 200, h: 12 }, { boxW: 220, boxH: 188 });
const tall = windowDrawingSVG({ type: 'picture', w: 10, h: 180 }, { boxW: 220, boxH: 188 });
if (wide.capped !== true || tall.capped !== true) fail('extreme ratios should cap');
near(wide.dw / wide.dh, ASPECT_CAP, 0.02, 'wide cap');
near(tall.dw / tall.dh, 1 / ASPECT_CAP, 0.02, 'tall cap');
if (!wide.svg.includes(formatInches(200)) || !tall.svg.includes(formatInches(180))) fail('capped drawings still show the real size');

const box = fitDrawing(72, 48, 100, 80);
near(box.dw / box.dh, 72 / 48, 0.001, 'fit keeps 72x48');
if (box.dw > 100.01 || box.dh > 80.01) fail('fit left the box');
const twin = fitDrawing(36, 24, 100, 80);
near(box.dw, twin.dw, 0.01, 'same shape, same box');
near(box.dh, twin.dh, 0.01, 'same shape, same height');

near(archRiseInches({ type: 'archtop', w: 60, h: 80 }), 30, 0.05, 'equal-leg rise is half the width');
near(archRiseInches({ type: 'archtop', w: 60, h: 80, leg: 56 }), 24, 0.05, 'leg height sets the rectangle under the arch');
near(archRiseInches({ type: 'arch_xo', w: 72, h: 84, bottomHeight: 48 }), 36, 0.05, 'bottom window height sets XO arch rise');
near(archRiseInches({ type: 'arch_sh', brand: 'andersen', w: 36, h: 60 }), 9, 0.05, 'Andersen arch single hung rise is width/4');
near(archRiseInches({ type: 'specialty_arch', brand: 'andersen', w: 48, h: 72 }), 12, 0.05, 'Andersen specialty rise is width/4');
near(archRiseInches({ type: 'arch', brand: 'andersen', w: 40, h: 60 }), 10, 0.05, 'old Andersen arch id uses the specialty rise');
near(archRiseInches({ type: 'eyebrow_xo', w: 80, h: 40 }), 10, 0.05, 'eyebrow rise is width/8');
near(archRiseInches({ type: 'halfround', w: 60, h: 30 }), 30, 0.05, 'half-round rise is the semicircle');

function ops(type, extra = {}) {
  const svg = windowDrawingSVG({ type, w: 72, h: 60, ...extra }, { boxW: 220, boxH: 188 }).svg;
  return [...svg.matchAll(/data-op="([^"]+)"/g)].map((m) => m[1]);
}
const hung = ops('vslider');
if (hung.length !== 1 || hung[0] !== 'slide-up') fail('single hung lower sash slides up ' + hung.join(','));
const twinOps = ops('dshung');
if (twinOps.filter((o) => o === 'slide-up').length !== 2) fail('double single hung has two vents ' + twinOps.join(','));
const xox = ops('xox');
if (xox.join(',') !== 'slide-right,slide-left') fail('xox vents ' + xox.join(','));
const door4 = ops('4panel', { brand: 'milgard', series: 'V300' });
if (door4.join(',') !== 'slide-left,slide-right') fail('OXXO vents ' + door4.join(','));
const door3 = ops('3panel', { brand: 'milgard', series: 'V300' });
if (door3.join(',') !== 'slide-right') fail('XOO vent ' + door3.join(','));
if (ops('picture').length) fail('picture has no vent');
if (!ops('casement').includes('casement')) fail('casement swings');
if (!ops('dcasement').includes('casement-right')) fail('double casement');
if (!ops('awning').includes('awning')) fail('awning swings');
const archXO = windowDrawingSVG({ type: 'arch_xo', w: 72, h: 84 }, { boxW: 220, boxH: 188 });
if (!archXO.svg.includes('class="glass arch"')) fail('arch XO needs a circular head');
if (!archXO.svg.includes('data-op="slide-right"')) fail('arch XO default vent is the left half');
near(archXO.rise, 36, 0.05, 'arch XO default rise');
near(archXO.bottom, 48, 0.05, 'arch XO bottom window');
const archSH = windowDrawingSVG({ type: 'arch_sh', brand: 'andersen', w: 36, h: 60 }, { boxW: 220, boxH: 188 });
if (!archSH.svg.includes('class="glass arch"') || !archSH.svg.includes('slide-up')) fail('arch single hung');
near(archSH.rise, 9, 0.05, 'arch single hung rise on the svg');
const half = windowDrawingSVG({ type: 'halfround', w: 60, h: 30 }, { boxW: 220, boxH: 188 });
if (!half.svg.includes('class="glass arch"')) fail('half-round arc');
if (half.svg.includes('data-op=')) fail('half-round is fixed');

if (failed) {
  console.error(failed + ' drawing check(s) failed');
  process.exit(1);
}
console.log('drawing check ok (' + quoted.length + ' styles)');
