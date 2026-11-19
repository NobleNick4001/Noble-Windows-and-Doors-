// Counts the Mine tab shows. Each section registers its own number.
// The Mine tab bubble is the sum, so it matches the chips inside Mine.

const sources = {};

export function registerAttention(name, fn) {
  sources[name] = fn;
}

export function attention(name) {
  const fn = sources[name];
  const n = fn ? Number(fn()) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function mineAttentionTotal(leadsN, followN) {
  const leads = Math.max(0, Number(leadsN) || 0);
  const follow = Math.max(0, Number(followN) || 0);
  return leads + follow;
}
