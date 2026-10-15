import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
let failed = 0;
const fail = (msg) => { failed++; console.error('FAIL', msg); };
const ok = (msg) => console.log('OK  ', msg);

const manifest = JSON.parse(read('data/overlay/manifest.json'));
if (!Array.isArray(manifest.assets) || manifest.assets.length !== 75) fail('manifest should list 75 overlays, got ' + (manifest.assets || []).length);
else ok('75 overlay assets');

const colors = ['white', 'adobe', 'black', 'bronze'];
const types = ['hslider', 'vslider', 'picture'];
let bytes = 0;
for (const series of ['V250', 'V300', 'V400']) {
  for (const type of types) {
    for (const color of colors) {
      for (const zbar of [false, true]) {
        const name = `${series}_${type}_${color}${zbar ? '_zbar' : ''}.webp`;
        const row = manifest.assets.find((a) => a.file === `data/overlay/${name}`);
        if (!row) { fail('missing manifest row ' + name); continue; }
        if (row.series !== series || row.type !== type || row.color !== color || row.zbar !== zbar) fail('row fields ' + name);
        const file = join(root, row.file);
        const head = readFileSync(file).subarray(0, 12);
        if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WEBP') fail(name + ' is not webp');
        bytes += statSync(file).size;
        const picture = type === 'picture';
        const hung = series === 'V400' && type === 'vslider';
        if (picture && !row.note.includes('meeting rail removed')) fail(name + ' should say the picture rail was removed');
        if (hung && !row.note.includes('turned horizontal')) fail(name + ' should say the V400 single hung is built from the slider');
        if (zbar && !row.note.includes('Z-bar')) fail(name + ' should say Z-bar is approximate');
        if ((picture || hung || zbar) && !row.approximate) fail(name + ' should be approximate');
        if (!picture && !hung && !zbar && row.approximate) fail(name + ' is a real exterior photo');
      }
    }
  }
}
const installed = [
  ['andersen100_picture_black.webp', 'andersen100', 'picture', '', 'black'],
  ['V300_hslider_black_block.webp', 'V300', 'hslider', 'block', 'black'],
  ['andersen100_hslider_black_nailfin.webp', 'andersen100', 'hslider', 'nailfin', 'black'],
];
const banned = [
  'andersen100_picture_white.webp',
  'andersen100_picture_sandtone.webp',
  'andersen100_picture_terratone.webp',
  'andersen100_picture_dkbronze.webp',
  'V300_hslider_white_block.webp',
  'V300_hslider_adobe_block.webp',
  'V300_hslider_bronze_block.webp',
  'V300_vslider_black_block.webp',
  'V300_vslider_white_block.webp',
  'andersen100_hslider_white_nailfin.webp',
  'andersen100_hslider_sandtone_nailfin.webp',
];
for (const [name, series, type, frame, color] of installed) {
  const row = manifest.assets.find((a) => a.file === `data/overlay/${name}`);
  if (!row) { fail('missing installed overlay ' + name); continue; }
  if (row.approximate) fail(name + ' should be a real photo');
  if (row.note) fail(name + ' should not carry a recolor note');
  if (row.zbar) fail(name + ' should not be a z-bar');
  if (row.series !== series || row.type !== type || (row.frame || '') !== frame || row.color !== color) fail(name + ' fields');
  const file = join(root, row.file);
  const head = readFileSync(file).subarray(0, 12);
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WEBP') fail(name + ' is not webp');
  bytes += statSync(file).size;
}
const listed = manifest.assets.map((a) => a.file).join(' ');
for (const token of banned) {
  if (listed.includes(token)) fail('recolor or single-hung block overlay still listed: ' + token);
}
if (manifest.colors.some((c) => ['sandtone', 'terratone', 'dkbronze'].includes(c.id))) fail('overlay color list should not add recolor-only colors');
else ok('only real installed photos were added');
const seriesIds = manifest.series.map((s) => s.id);
if (!seriesIds.includes('andersen100')) fail('Andersen 100 should be an overlay series');
else ok('Andersen 100 is in the overlay series list');
if ((manifest.frames || []).map((f) => f.id).join(',') !== ',block,nailfin') fail('frame list should be product photo, block, nail fin');
else ok('frame list');

if (bytes > 6 * 1024 * 1024) fail('overlay webps are ' + bytes + ' bytes');
else ok('overlay webps ' + (bytes / 1024).toFixed(0) + 'KB');

const colorNames = Object.fromEntries(manifest.colors.map((c) => [c.id, c.name]));
if (colorNames.white !== 'White / White' || colorNames.adobe !== 'Adobe' || colorNames.black !== 'Black / Black' || colorNames.bronze !== 'Bronze Anodized') {
  fail('overlay colors should use the app color names');
} else ok('color names match the app');

const page = read('js/pages/overlay.js');
for (const needle of ['ov-zbar', 'ov-op', 'ov-save', 'estimates.save', 'e.overlays', 'warp(', 'Show original photo', 'data/overlay/manifest.json', 'pick-frame-block', 'pick-frame-nailfin', 'S.frame']) {
  if (!page.includes(needle)) fail('overlay.js missing ' + needle);
}
if (!page.includes("match(a, '')")) fail('overlay lookup should fall back to the product photo');
else ok('overlay lookup matches frame and falls back');
ok('overlay page warps, sets opacity, and saves onto the estimate');

const pdf = read('js/pdf.js');
if (!pdf.includes('e.overlays') || !pdf.includes('Window overlay') || !pdf.includes("addImage(shot.image, 'JPEG'")) fail('estimate PDF should embed overlay photos');
else ok('pdf embeds overlays');

const estimate = read('js/pages/estimate.js');
if (!estimate.includes('id: \'sh-overlays\'') || !estimate.includes('id: \'overlay-card\'')) fail('estimate screen and print sheet should show overlays');
else ok('estimate shows overlays');

const sw = read('sw.js');
if (!sw.includes('data/overlay/manifest.json') || !sw.includes('manifest?.assets')) fail('service worker should cache overlay files from the manifest');
else ok('service worker caches the manifest list');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('overlay checks passed');
