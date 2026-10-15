import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
let failed = 0;
const fail = (msg) => { failed++; console.error('FAIL', msg); };
const ok = (msg) => console.log('OK  ', msg);

const manifest = JSON.parse(read('data/overlay/manifest.json'));
if (!Array.isArray(manifest.assets) || manifest.assets.length !== 90) fail('manifest should list 90 overlays, got ' + (manifest.assets || []).length);
else ok('90 overlay assets');

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
  ['andersen100_picture_black.webp', false, ''],
  ['andersen100_picture_white.webp', true, 'Recolored from the installed black Andersen 100 picture window.'],
  ['andersen100_picture_sandtone.webp', true, 'Recolored from the installed black Andersen 100 picture window.'],
  ['andersen100_picture_terratone.webp', true, 'Recolored from the installed black Andersen 100 picture window.'],
  ['andersen100_picture_dkbronze.webp', true, 'Recolored from the installed black Andersen 100 picture window.'],
  ['V300_hslider_black_block.webp', false, ''],
  ['V300_hslider_white_block.webp', true, 'Recolored from the installed black V300 block-frame slider.'],
  ['V300_hslider_adobe_block.webp', true, 'Recolored from the installed black V300 block-frame slider.'],
  ['V300_hslider_bronze_block.webp', true, 'Recolored from the installed black V300 block-frame slider.'],
  ['V300_vslider_black_block.webp', false, ''],
  ['V300_vslider_white_block.webp', true, 'Recolored from the installed black V300 block-frame single hung.'],
  ['V300_vslider_adobe_block.webp', true, 'Recolored from the installed black V300 block-frame single hung.'],
  ['V300_vslider_bronze_block.webp', true, 'Recolored from the installed black V300 block-frame single hung.'],
  ['andersen100_hslider_black_nailfin.webp', false, ''],
  ['andersen100_hslider_white_nailfin.webp', true, 'Recolored from the installed black Andersen 100 nail-fin slider.'],
  ['andersen100_hslider_sandtone_nailfin.webp', true, 'Recolored from the installed black Andersen 100 nail-fin slider.'],
  ['andersen100_hslider_terratone_nailfin.webp', true, 'Recolored from the installed black Andersen 100 nail-fin slider.'],
  ['andersen100_hslider_dkbronze_nailfin.webp', true, 'Recolored from the installed black Andersen 100 nail-fin slider.'],
];
for (const [name, approximate, note] of installed) {
  const row = manifest.assets.find((a) => a.file === `data/overlay/${name}`);
  if (!row) { fail('missing installed overlay ' + name); continue; }
  if (!!row.approximate !== approximate) fail(name + ' approximate flag');
  if ((row.note || '') !== note) fail(name + ' note');
  if (row.zbar) fail(name + ' should not be a z-bar');
  if (name.includes('_block') && row.frame !== 'block') fail(name + ' frame');
  if (name.includes('_nailfin') && row.frame !== 'nailfin') fail(name + ' frame');
  if (name.startsWith('andersen100_picture') && row.frame) fail(name + ' picture has no separate frame file');
  const file = join(root, row.file);
  const head = readFileSync(file).subarray(0, 12);
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WEBP') fail(name + ' is not webp');
  bytes += statSync(file).size;
}
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
if (!page.includes('frameId(a) === frame') && !page.includes("frameId(a) === wanted")) fail('overlay lookup should match the selected frame');
else ok('overlay lookup matches frame');
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
