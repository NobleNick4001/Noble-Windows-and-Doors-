// Generates simple SVG window frames per type/color for icons and the photo overlay.
export const FRAME_COLORS = {
  white: { frame: '#f6f6f3', edge: '#9a9a96', inner: '#dcdcd8' },
  black: { frame: '#16161a', edge: '#000000', inner: '#3a3a40' },
  bronze: { frame: '#5b4636', edge: '#2e231a', inner: '#7a6150' },
  adobe: { frame: '#C8A27A', edge: '#7d5f3f', inner: '#b08b62' },
  sandtone: { frame: '#CBBBA0', edge: '#8d7d66', inner: '#ddd0bc' },
  terratone: { frame: '#8A6A4F', edge: '#5c4634', inner: '#a8886c' },
  dkbronze: { frame: '#4a3b2f', edge: '#2a211a', inner: '#6b5746' },
};
export function frameColors(c) {
  if (typeof c === 'string' && c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const sh = (k) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join('');
    return { frame: c, edge: sh(0.55), inner: sh(0.8) };
  }
  return FRAME_COLORS[c] || FRAME_COLORS.white;
}

// Returns an SVG string. Drawn in a W x H box (px units, proportional to the real window).
export function frameSVG(type, colorKey = 'white', aspect = 1.2, { glassOpacity = 0.28, size = 600, label = false } = {}) {
  const W = aspect >= 1 ? size : size * aspect;
  const H = aspect >= 1 ? size / aspect : size;
  const fc = frameColors(colorKey);
  const t = Math.max(8, Math.min(W, H) * 0.075); // frame thickness
  const st = Math.max(5, t * 0.62); // sash thickness
  const e = fc.edge, f = fc.frame, i = fc.inner;
  const glass = `fill="#bfe3f5" fill-opacity="${glassOpacity}"`;
  const rect = (x, y, w, hh, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="${fill}" stroke="${e}" stroke-width="1.5" ${extra}/>`;
  let body = '';
  const isArch = type === 'arch' || type === 'archtop';
  const archR = W / 2;
  if (isArch) {
    // arch-top: rectangle body with semicircular head (head radius = W/2, capped)
    const r = Math.min(W / 2, H * 0.45);
    const top = H - (H - r); // placeholder to keep readability
    const path = (ins) => {
      const x0 = ins, x1 = W - ins, rr = r - ins, yTop = ins + 0;
      return `M${x0},${H - ins} L${x0},${r} A${rr},${rr} 0 0 1 ${x1},${r} L${x1},${H - ins} Z`;
    };
    body += `<path d="${path(0)}" fill="${f}" stroke="${e}" stroke-width="1.5"/>`;
    body += `<path d="${path(t)}" ${glass} stroke="${e}" stroke-width="1.5"/>`;
    // glass shine + muntin
    body += `<line x1="${t}" y1="${r}" x2="${W - t}" y2="${r}" stroke="${f}" stroke-width="${st * 0.7}"/>`;
    body += `<line x1="${W / 2}" y1="${t}" x2="${W / 2}" y2="${r}" stroke="${f}" stroke-width="${st * 0.5}"/>`;
  } else {
    body += rect(0, 0, W, H, f);
    const gx = t, gy = t, gw = W - 2 * t, gh = H - 2 * t;
    if (type === 'picture') {
      body += rect(gx, gy, gw, gh, 'none') + `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" ${glass}/>`;
    } else if (type === 'hslider') {
      const half = gw / 2;
      body += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" ${glass} stroke="${e}" stroke-width="1.5"/>`;
      // left sash (fixed) and right sash (operable) with meeting rail
      body += rect(gx, gy, half + st / 2, st, i) + rect(gx, gy + gh - st, half + st / 2, st, i) + rect(gx, gy, st, gh, i);
      body += rect(gx + half - st / 2, gy, st, gh, f) + rect(gx + half - st / 2 + st, gy, half - st / 2, st, i, 'opacity=".001"');
      body += rect(gx + half + st / 2, gy, half - st / 2, st, i) + rect(gx + half + st / 2, gy + gh - st, half - st / 2, st, i) + rect(gx + gw - st, gy, st, gh, i);
      body += rect(gx + half - st / 2, gy, st * 1.3, gh, f);
      const ay = H / 2;
      body += `<path d="M${gx + gw * 0.62},${ay} h${gw * 0.2} m-${st * 1.2},-${st * 0.9} l${st * 1.2},${st * 0.9} l-${st * 1.2},${st * 0.9}" stroke="${e}" stroke-width="2.5" fill="none" opacity=".55"/>`;
    } else if (type === 'vslider') {
      const half = gh / 2;
      body += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" ${glass} stroke="${e}" stroke-width="1.5"/>`;
      body += rect(gx, gy, gw, st, i) + rect(gx, gy, st, half + st / 2, i) + rect(gx + gw - st, gy, st, half + st / 2, i);
      body += rect(gx, gy + half - st / 2, gw, st * 1.3, f);
      body += rect(gx, gy + gh - st, gw, st, i) + rect(gx, gy + half + st / 2, st, half - st / 2, i) + rect(gx + gw - st, gy + half + st / 2, st, half - st / 2, i);
      const ax = W / 2;
      body += `<path d="M${ax},${gy + gh * 0.62} v${gh * 0.2} m-${st * 0.9},-${st * 1.2} l${st * 0.9},${st * 1.2} l${st * 0.9},-${st * 1.2}" stroke="${e}" stroke-width="2.5" fill="none" opacity=".55"/>`;
    } else if (type === 'casement' || type === 'dcasement') {
      body += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" ${glass} stroke="${e}" stroke-width="1.5"/>`;
      body += rect(gx, gy, gw, st, i) + rect(gx, gy + gh - st, gw, st, i) + rect(gx, gy, st, gh, i) + rect(gx + gw - st, gy, st, gh, i);
      if (type === 'dcasement') {
        const half = gw / 2;
        const midL = gx + half - st * 0.2;
        const midR = gx + half + st * 0.2;
        body += rect(gx + half - st * 0.45, gy, st * 1.2, gh, f);
        body += `<path d="M${midL},${gy + gh / 2} L${gx + st},${gy + st} M${midL},${gy + gh / 2} L${gx + st},${gy + gh - st}" stroke="${e}" stroke-width="2" stroke-dasharray="8 6" fill="none" opacity=".6"/>`;
        body += `<path d="M${midR},${gy + gh / 2} L${gx + gw - st},${gy + st} M${midR},${gy + gh / 2} L${gx + gw - st},${gy + gh - st}" stroke="${e}" stroke-width="2" stroke-dasharray="8 6" fill="none" opacity=".6"/>`;
      } else {
        // hinge-side triangle (hinge on left): lines from right-middle to left corners
        body += `<path d="M${gx + gw - st},${gy + gh / 2} L${gx + st},${gy + st} M${gx + gw - st},${gy + gh / 2} L${gx + st},${gy + gh - st}" stroke="${e}" stroke-width="2" stroke-dasharray="8 6" fill="none" opacity=".6"/>`;
        body += `<rect x="${gx + gw - st - 4}" y="${gy + gh / 2 - 14}" width="9" height="28" rx="3" fill="${e}" opacity=".7"/>`;
      }
    } else if (type === 'awning') {
      body += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" ${glass} stroke="${e}" stroke-width="1.5"/>`;
      body += rect(gx, gy, gw, st, i) + rect(gx, gy + gh - st, gw, st, i) + rect(gx, gy, st, gh, i) + rect(gx + gw - st, gy, st, gh, i);
      body += `<path d="M${gx + gw / 2},${gy + gh - st} L${gx + st},${gy + st} M${gx + gw / 2},${gy + gh - st} L${gx + gw - st},${gy + st}" stroke="${e}" stroke-width="2" stroke-dasharray="8 6" fill="none" opacity=".6"/>`;
      body += `<rect x="${gx + gw / 2 - 14}" y="${gy + gh - st - 6}" width="28" height="9" rx="3" fill="${e}" opacity=".7"/>`;
    } else if (type === 'hvb') {
      const split = gy + gh * 0.58;
      body += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" ${glass} stroke="${e}" stroke-width="1.5"/>`;
      body += rect(gx, gy, gw, st, i) + rect(gx, gy, st, split - gy, i) + rect(gx + gw - st, gy, st, split - gy, i);
      body += rect(gx, split - st / 2, gw, st * 1.2, f);
      body += rect(gx, split + st / 2, gw, st, i) + rect(gx, gy + gh - st, gw, st, i) + rect(gx, split, st, gy + gh - split, i) + rect(gx + gw - st, split, st, gy + gh - split, i);
      body += `<path d="M${gx + gw / 2},${gy + gh - st} L${gx + st},${split + st} M${gx + gw / 2},${gy + gh - st} L${gx + gw - st},${split + st}" stroke="${e}" stroke-width="2" stroke-dasharray="7 5" fill="none" opacity=".6"/>`;
    } else if (type === '2panel' || type === '3panel' || type === '4panel') {
      const n = type === '4panel' ? 4 : type === '3panel' ? 3 : 2;
      body += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" ${glass} stroke="${e}" stroke-width="1.5"/>`;
      body += rect(gx, gy, gw, st, i) + rect(gx, gy + gh - st, gw, st, i);
      for (let k = 0; k < n; k++) {
        const x = gx + (gw / n) * k;
        body += rect(x, gy, st, gh, i);
        if (k > 0) body += rect(x - st * 0.35, gy, st * 1.15, gh, f);
      }
      body += rect(gx + gw - st, gy, st, gh, i);
    } else if (type === 'custom_supplier') {
      body += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" ${glass} stroke="${e}" stroke-width="1.5" stroke-dasharray="8 6"/>`;
      body += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="Helvetica,Arial" font-size="${Math.max(14, W * 0.08)}" fill="${e}">$</text>`;
    } else if (type === 'xox') {
      const third = gw / 3;
      body += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" ${glass} stroke="${e}" stroke-width="1.5"/>`;
      body += rect(gx, gy, gw, st, i) + rect(gx, gy + gh - st, gw, st, i) + rect(gx, gy, st, gh, i) + rect(gx + gw - st, gy, st, gh, i);
      body += rect(gx + third - st * 0.35, gy, st * 1.2, gh, f);
      body += rect(gx + third * 2 - st * 0.35, gy, st * 1.2, gh, f);
      const ay = H / 2;
      body += `<path d="M${gx + third * 0.62},${ay} h${-third * 0.28} m${st},${-st * 0.7} l${-st},${st * 0.7} l${st},${st * 0.7}" stroke="${e}" stroke-width="2.2" fill="none" opacity=".55"/>`;
      body += `<path d="M${gx + third * 2.38},${ay} h${third * 0.28} m${-st},${-st * 0.7} l${st},${st * 0.7} l${-st},${st * 0.7}" stroke="${e}" stroke-width="2.2" fill="none" opacity=".55"/>`;
    }
  }
  const lbl = label ? `<text x="${W / 2}" y="${H + 24}" text-anchor="middle" font-family="Helvetica,Arial" font-size="18" fill="#333">${label}</text>` : '';
  const vh = label ? H + 34 : H;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${vh}" width="${W}" height="${vh}">${body}${lbl}</svg>`;
}
export const frameDataURL = (type, color, aspect, opts) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(frameSVG(type, color, aspect, opts));
