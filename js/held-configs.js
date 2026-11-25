// Configurations with no real price. They stay out of the quote builder until
// Window Quoting sends a rate. Do not invent a number. To turn one back on,
// delete it from this file after the price is in the pricing data.
//
// Removed on purpose:
// - Milgard styles that are Not available or Price pending for every color.
// - Milgard colors that are Not available or Price pending on a style that
//   does have a price in another color.
// - Glass, grids, and PureView on double-hung, double-casement, and arch
//   styles. Those chips do not change the price.
// - Equal-leg arch top (archtop). It is not on the style list and the
//   placeholder rate is $0.
// - IWC Clear Anodized, Mojave Beige, and White on 8200 and 8900.
// - PRL choices that say "Get a PRL quote" (6+ panels, other finishes,
//   pocket, 90-degree corner, bifold screen, thermal bifold, Energy
//   Advantage on a bifold). Bronze anodized multi-slide and bifold, 3 to 5
//   panels, stay on the quote.
// - $0 extras: Permit, Haul-away / disposal, Interior / exterior trim,
//   Grids (Colonial), and Grids (Prairie).

export const HELD_MILGARD_STYLES = {
  V250: ['dcasement', 'arch_xox', 'arch_sh', 'arch_hr', 'archtop'],
  V300: ['arch_xox', 'arch_hr', 'archtop'],
  V400: ['arch_sh', 'archtop'],
  A250: ['archtop'],
};

export const HELD_MILGARD_COLORS = [
  { series: ['V250', 'V300', 'V400'], types: ['dshung'], colors: ['bronze', 'bb'] },
  { series: ['V300', 'V400'], types: ['dcasement'], colors: ['bronze', 'bb'] },
  { series: ['V250', 'V300', 'V400'], types: ['arch_xo'], colors: ['bronze'] },
  { series: ['V300'], types: ['arch_sh'], colors: ['bronze'] },
  { series: ['V400'], types: ['arch_xox'], colors: ['bronze'] },
  { series: ['V400'], types: ['arch_hr'], colors: ['bronze', 'bw', 'bb'] },
];

// These upgrades are selectable on the style and do not change its price.
export const HELD_MILGARD_UPGRADES = ['dshung', 'dcasement', 'arch_xo', 'arch_xox', 'arch_sh', 'arch_hr', 'archtop'];

export const HELD_IWC_COLORS = ['clear-anodized', 'mojave-beige', 'white'];

export const HELD_PRL = [
  'panels-6',
  'finish-other',
  'layout-pocket',
  'layout-corner',
  'bifold-screen',
  'bifold-thermal',
  'bifold-energy-advantage',
];

export const DROPPED_EXTRAS = ['Permit', 'Haul-away / disposal', 'Interior / exterior trim', 'Grids (Colonial)', 'Grids (Prairie)'];

const WINDOW_COLORS = {
  A250: ['clear-anodized', 'bronze-anodized'],
  vinyl: ['ww', 'adobe', 'bronze', 'bw', 'bb'],
};

export function milgardStyleHeld(series, type) {
  return (HELD_MILGARD_STYLES[series] || []).includes(type);
}

export function milgardColorHeld(series, type, color) {
  return HELD_MILGARD_COLORS.some((row) => row.series.includes(series) && row.types.includes(type) && row.colors.includes(color));
}

export function milgardUpgradesHeld(type) {
  return HELD_MILGARD_UPGRADES.includes(type);
}

export function milgardStyleOffered(product, series, type) {
  if (product === 'door') return true;
  if (milgardStyleHeld(series, type)) return false;
  const palette = WINDOW_COLORS[series] || WINDOW_COLORS.vinyl;
  return palette.some((color) => !milgardColorHeld(series, type, color));
}

export function iwcColorHeld(color) {
  return HELD_IWC_COLORS.includes(color);
}

export function droppedExtra(extra) {
  const label = String(extra?.label || '');
  if (!DROPPED_EXTRAS.includes(label)) return false;
  return !(Number(extra?.amount) > 0);
}
