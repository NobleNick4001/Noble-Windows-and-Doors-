// Mine folder rules and who may soft-delete an estimate.
// Lost jobs stay out of All. A presented estimate (shown, follow-up, signed, won, or lost)
// can be deleted only by an admin. A draft that was never presented can still be deleted by its owner.

export const MINE_FILTERS = [
  ['all', 'All'],
  ['draft', 'Draft'],
  ['presented', 'Shown'],
  ['won', 'Won'],
  ['lost', 'Lost'],
];

const LATER = new Set(['presented', 'signed', 'won', 'lost']);

export function estimateStatus(e) {
  return e?.status || 'draft';
}

// All is every estimate that is not lost. Lost is its own chip.
export function inMineFolder(e, filter) {
  const status = estimateStatus(e);
  if (filter === 'all') return status !== 'lost';
  return status === filter;
}

export function mineSearchMatch(e, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const c = e?.customer || {};
  const hay = [c.name, c.first, c.last, c.address, c.phone, e?.number].join(' ').toLowerCase();
  return hay.includes(q);
}

// Counts follow the same folder and search rules as the list.
export function mineCounts(rows, query) {
  const counts = { all: 0, draft: 0, presented: 0, won: 0, lost: 0 };
  for (const row of rows || []) {
    if (!mineSearchMatch(row, query)) continue;
    const status = estimateStatus(row);
    if (status !== 'lost') counts.all += 1;
    if (status !== 'all' && Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
  }
  return counts;
}

// Presented or later. Follow-up is not its own status: the estimate stays "presented"
// while a follow-up is open. presented_at (and signed/won/lost timestamps) count too,
// so a row cannot be treated as a draft just because status was cleared.
export function wasPresented(e) {
  if (!e) return false;
  if (e.presentedAt || e.presented_at) return true;
  if (e.signedAt || e.signed_at || e.wonAt || e.won_at || e.lostAt || e.lost_at) return true;
  return LATER.has(estimateStatus(e));
}

export function canDeleteEstimate(e, { admin = false, uid = null } = {}) {
  if (admin) return true;
  if (!e) return false;
  if (e.ownerId && uid && e.ownerId !== uid) return false;
  if (wasPresented(e)) return false;
  return true;
}
