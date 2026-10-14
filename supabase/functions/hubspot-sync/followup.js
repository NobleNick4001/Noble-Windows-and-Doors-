// Follow-up task due date and title. No network.
// Business days are counted on the Phoenix calendar (UTC-7, no daylight saving).

const PHOENIX_MS = 7 * 60 * 60 * 1000;

function phoenixDate(from) {
  const shifted = new Date(from.getTime() - PHOENIX_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

export function addBusinessDays(from, days) {
  const cursor = phoenixDate(from);
  let left = Number(days) || 0;
  while (left > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return cursor;
}

// 5:00pm Phoenix on the due day. 5pm MST is midnight UTC the next calendar day.
export function followUpDue(from = new Date(), days = 2) {
  const due = addBusinessDays(from, days);
  return new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate() + 1, 0, 0, 0)).toISOString();
}

export function moneyLabel(amount) {
  const n = Number(amount);
  const value = Number.isFinite(n) ? n : 0;
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function followUpTitle(customer, total) {
  const name = String(customer || '').trim() || 'Customer';
  return `Follow up: ${name} estimate ${moneyLabel(total)}`;
}

export function matchOwner(owners, email) {
  const want = String(email || '').trim().toLowerCase();
  if (!want) return null;
  return (owners || []).find((owner) => String(owner?.email || '').trim().toLowerCase() === want) || null;
}
