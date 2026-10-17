// Milgard OneLink pricing. Customer price = OneLink cost / 0.55, rounded up to the
// next grid size so a quote is never under OneLink. Grids and door tables live in
// data/milgard-onelink.json. A250 aluminum windows are priced per inch of width + height
// from data/milgard-onelink.json "a250Windows". Andersen and IWC do not use this module.
const COLOR = {
  ww: 'white', white: 'white', adobe: 'adobe', bronze: 'bronze',
  bw: 'black_ext', black_ext: 'black_ext', bb: 'black_black', black_black: 'black_black',
};
export const WINDOW_SERIES = ['V250', 'V300', 'V400', 'A250'];
export const DOOR_SERIES = ['V300', 'V400', 'A250'];
export const DOOR_CONFIG = { '2panel': 'XO', '3panel': 'XOO', '4panel': 'OXXO' };
export const WINDOW_STYLES = ['hslider', 'xox', 'vslider', 'picture', 'casement', 'awning'];
// [line color id, label, doorColors rule key]. White and both A250 anodized finishes use the White door price.
export const VINYL_DOOR_COLORS = [
  ['ww', 'White', 'white'],
  ['adobe', 'Adobe', 'adobe'],
  ['bw', 'Black / White', 'black_white'],
  ['bb', 'Black / Black', 'black_black'],
  ['door-dark', 'Classic Brown / Espresso / Bronze', 'dark'],
];
export const A250_DOOR_COLORS = [
  ['bronze-anodized', 'Bronze Anodized', 'white'],
  ['clear-anodized', 'Clear Anodized', 'white'],
];
// A250 windows: two anodized finishes, same price.
export const A250_WINDOW_COLORS = [
  ['clear-anodized', 'Clear Anodized'],
  ['bronze-anodized', 'Bronze Anodized'],
];
export const A250_WINDOW_STYLES = ['hslider', 'xox', 'vslider', 'picture', 'casement'];
// What glass upgrades are priced for an A250 window style (from the Milgard A250 quote).
export function a250GlassOptions(D, style) {
  const A = D?.a250Windows || {};
  return { tempered: !!A.temperedFactor?.[style], obscure: !!A.temperedObscureFactor?.[style] };
}
export function doorColorChoices(series) {
  return series === 'A250' ? A250_DOOR_COLORS : VINYL_DOOR_COLORS;
}
export function doorColorLabel(series, colorId) {
  return doorColorChoices(series).find((c) => c[0] === colorId)?.[1] || '';
}
export function doorColorRuleKey(series, colorId) {
  return doorColorChoices(series).find((c) => c[0] === colorId)?.[2] || 'white';
}

export function makeEngine(D) {
  const p45 = (l) => l * 0.417 / 0.55;
  function interpMaxH(c, w) {
    if (!c) return Infinity;
    if (w <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (w <= c[i][0]) {
        const [a, b] = c[i - 1], [x, y] = c[i];
        return b + (y - b) * (w - a) / (x - a);
      }
    }
    return c[c.length - 1][1];
  }
  function limits(series, style) {
    const L = D.limits[style];
    return Object.assign({}, L.all, (L[series] || {}));
  }
  function validate(series, style, w, h) {
    const L = limits(series, style), e = [];
    if (!(w > 0 && h > 0)) return ['Enter width and height'];
    if (w < L.wmin || w > L.wmax) e.push(`Width must be ${L.wmin}–${L.wmax}"`);
    const mh = Math.min(L.hmax, interpMaxH(L.curve, w));
    if (h < L.hmin || h > mh) e.push(`Height must be ${L.hmin}–${+mh.toFixed(2)}" at ${w}" wide`);
    return e;
  }
  function formula45(style, w, h) {
    const f = D.fits[style];
    return p45((f.base + f.perUI * (w + h) + f.perSqFt * w * h / 144) * f.safety);
  }
  function base250(style, w, h) {
    const g = D.grids[style];
    const Wi = g.W.findIndex((x) => x >= w), Hi = g.H.findIndex((x) => x >= h);
    if (Wi >= 0 && Hi >= 0) return { v: g.price45[Hi][Wi], src: 'grid', cell: [g.W[Wi], g.H[Hi]] };
    return { v: formula45(style, w, h), src: 'formula' };
  }
  function lin(r, sq) { return r.flat + r.perSqFt * sq; }
  // A250 aluminum window: customer rate per inch of (W + H). Clear and Bronze Anodized are the same price.
  // Tempered and tempered + obscure are multiples of the plain price; types without data are refused.
  function a250Window(style, w, h, o) {
    const A = D.a250Windows;
    const sq = w * h / 144, items = [], notes = [], errors = validate('A250', style, w, h);
    const base = A.perUI[style] * (w + h);
    items.push(['base', base]);
    const obscure = o.obscure && o.obscure !== 'none';
    const forced = style === 'picture' && sq > D.temperedForceSqFt;
    const tf = A.temperedFactor?.[style], of = A.temperedObscureFactor?.[style];
    if (obscure) {
      if (of) {
        items.push(['tempered_obscure', base * (of - 1)]);
        notes.push('A250 obscure glass is priced as tempered + obscure');
      } else errors.push('Obscure glass is not priced for this A250 style');
    } else if (o.tempered || forced) {
      if (tf) items.push(['tempered', base * (tf - 1)]);
      else errors.push('Tempered glass is not priced for this A250 style');
      if (forced) notes.push('Tempered required above 25 sq ft (included)');
    }
    return { items, notes, errors, material: items.reduce((s, i) => s + i[1], 0), limits: limits('A250', style) };
  }
  function window(series, style, w, h, o) {
    o = o || {};
    if (series === 'A250') return a250Window(style, w, h, o);
    const sq = w * h / 144, items = [], notes = [];
    const b = base250(style, w, h);
    let base = b.v;
    if (style === 'picture' && sq > D.temperedForceSqFt) {
      const t = formula45('picture', w, h) + lin(D.up.tempered, sq);
      if (t > base) base = t;
      notes.push('Tempered required above 25 sq ft (included)');
    }
    if (series !== 'V250') base += p45(D.v300.a + D.v300.b * (w + h));
    if (series === 'V400') {
      base *= (D.v4t[style] || D.v4f);
      if (style === 'casement' && w > 36) base *= D.v4wide;
    }
    items.push(['base', base]);
    const c = o.color || 'white';
    if (c !== 'white' && c !== 'adobe') {
      let k = c;
      if (c === 'black_ext' && style === 'picture') k = 'black_ext_picture';
      items.push([c, lin(D.up[k], sq)]);
    }
    if (c === 'adobe') notes.push('Adobe priced as White (forces Adobe interior)');
    if (o.grids && o.grids !== 'none') items.push(['grids', lin(D.up['grids_' + o.grids], sq)]);
    if (o.tempered && !(style === 'picture' && sq > D.temperedForceSqFt)) items.push(['tempered', lin(D.up.tempered, sq)]);
    if (o.obscure && o.obscure !== 'none') items.push(['obscure', lin(D.up['obscure_' + (o.obscure === 'p516' ? 'p516' : 'satin_etch')], sq)]);
    if (o.pureview && style !== 'picture') {
      const ss = sq * (['casement', 'awning'].includes(style) ? 1 : 0.5);
      items.push(['pureview', D.pv.flat + D.pv.perScreenSqFt * ss]);
    }
    if (o.frame === 'zbar') items.push(['zbar', lin(D.up.zbar, sq)]);
    if (o.frame === 'block') items.push(['block', D.up.block.flat]);
    return { items, notes, errors: validate(series, style, w, h), material: items.reduce((s, i) => s + i[1], 0), limits: limits(series, style) };
  }
  function standardDoor(series, cfg, w, h) {
    const sd = D.doorsStd && D.doorsStd[series + '_' + cfg];
    if (!sd?.rows) return null;
    const key = Object.keys(sd.rows).find((k) => Math.abs(Number(k) - h) < 0.001);
    if (!key) return null;
    const exact = (sd.exactW || []).some((x) => Math.abs(Number(x) - w) < 0.001);
    if (!(w <= Number(sd.continuousMaxW) + 0.001 || exact)) return null;
    const cell = sd.rows[key].find((pair) => Number(pair[0]) + 0.001 >= w);
    return cell ? Number(cell[1]) : null;
  }
  function door(series, cfg, w, h, o) {
    o = o || {};
    const m = D.doors[series + '_' + cfg];
    const L = D.doorLimits[series + '_' + cfg];
    const e = [];
    if (!(w > 0 && h > 0)) e.push('Enter width and height');
    else {
      if (w < L.wmin || w > L.wmax) e.push(`Width must be ${L.wmin}–${L.wmax}"`);
      if (h < L.hmin || h > L.hmax) e.push(`Height must be ${L.hmin}–${L.hmax}"`);
    }
    const j = m.heightBrackets.findIndex((x) => h <= x);
    const jj = j < 0 ? m.heightBrackets.length - 1 : j;
    const i = m.widthSteps.findIndex((x) => x >= w);
    const custom = i >= 0
      ? m.price45[i][jj]
      : m.price45[m.price45.length - 1][jj] + m.perInchBeyondLast * (w - m.widthSteps[m.widthSteps.length - 1]);
    const standard = standardDoor(series, cfg, w, h);
    const v = standard != null ? standard : custom;
    const items = [['base', v]];
    const ruleKey = o.doorColor || 'white';
    const rule = series === 'A250' || ruleKey === 'white' ? null : D.doorColors?.[series]?.[ruleKey];
    if (rule) {
      const k = Number(rule.k?.[cfg]);
      const raw = k * (Number(rule.flat) + Number(rule.perW) * w + Number(rule.perH) * h);
      const up = Number.isFinite(raw) ? Math.max(0, Math.ceil(raw)) : 0;
      if (up) items.push(['color', up]);
    }
    if (o.pureview && series !== 'A250') items.push(['pureview', D.doorPV]);
    const notes = [];
    if (w > 0 && h > 0) notes.push(standard != null ? 'Standard net frame size' : 'Custom size. Net frame rounds up on the custom grid.');
    if (ruleKey === 'adobe') notes.push('Adobe interior');
    if (ruleKey === 'dark') notes.push('White interior');
    if (h > 82 && h < 84) notes.push('82–84" tall uses the tall-door price');
    if (cfg === 'XOO') notes.push('Field Glaze = Milgard to Glaze');
    return { items, notes, errors: e, material: items.reduce((s, it) => s + it[1], 0), limits: L };
  }
  return { window, door, validate, limits };
}

let bound = null;
let engine = null;
export function engineFor(D) {
  if (!D) return null;
  if (bound !== D) { bound = D; engine = makeEngine(D); }
  return engine;
}

export function isMilgardDoorLine(line) {
  if (!line || line.brand !== 'milgard') return false;
  if (!DOOR_SERIES.includes(line.series)) return false;
  return !!DOOR_CONFIG[line.type];
}

export function optionsFromLine(line) {
  const color = COLOR[line?.color] || 'white';
  let grids = 'none';
  if (line?.grids && line.grids !== 'none') grids = line.grids;
  else if ((line?.addons || []).includes('grids') || (line?.options || []).includes('grids-colonial')) grids = 'flat';
  let obscure = 'none';
  if (line?.obscure && line.obscure !== 'none') obscure = line.obscure === 'satin_etch' ? 'satin' : line.obscure;
  else if ((line?.addons || []).includes('obscure') || (line?.options || []).includes('obscure')) obscure = 'p516';
  const tempered = !!(line?.tempered || (line?.addons || []).includes('tempered') || (line?.options || []).includes('tempered'));
  const pureview = !!(line?.pureview || (line?.addons || []).includes('pureview'));
  const frame = line?.frame || line?.install?.frameType || '';
  const o = { color, grids, obscure, tempered, pureview, doorColor: 'white' };
  if (isMilgardDoorLine(line)) o.doorColor = doorColorRuleKey(line.series, line.color);
  if (frame === 'zbar' || frame === 'block') o.frame = frame;
  return o;
}

// Null when this line is not an OneLink window or door (arch, half-vent, other brands).
export function milgardQuote(D, line) {
  const E = engineFor(D);
  if (!E || !line || line.brand !== 'milgard' || line.type === 'custom_supplier' || line.customSupplier) return null;
  const w = Number(line.w), h = Number(line.h);
  if (isMilgardDoorLine(line)) {
    const cfg = DOOR_CONFIG[line.type];
    if (!D.doors?.[line.series + '_' + cfg]) return null;
    return { kind: 'door', cfg, ...E.door(line.series, cfg, w, h, optionsFromLine(line)) };
  }
  if (!WINDOW_SERIES.includes(line.series) || !D.grids?.[line.type]) return null;
  if (line.series === 'A250' && !D.a250Windows?.perUI?.[line.type]) return null;
  return { kind: 'window', ...E.window(line.series, line.type, w, h, optionsFromLine(line)) };
}
