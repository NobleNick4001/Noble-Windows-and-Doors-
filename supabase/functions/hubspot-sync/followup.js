// Follow-up task due date and title. No network.
// Business days are counted on the Phoenix calendar (UTC-7, no daylight saving).

export const PHOENIX_MS = 7 * 60 * 60 * 1000;

export function phoenixParts(from) {
  const shifted = new Date(new Date(from).getTime() - PHOENIX_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    dow: shifted.getUTCDay(),
  };
}

function phoenixDate(from) {
  const p = phoenixParts(from);
  return new Date(Date.UTC(p.year, p.month, p.day));
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

// Prefer the id Nick stored on the rep. Fall back to the current email match.
export function resolveTaskOwner({ hubspotOwnerId, owners, email } = {}) {
  const id = String(hubspotOwnerId || '').trim();
  if (id) return { ownerId: id, source: 'profile' };
  const owner = matchOwner(owners, email);
  if (owner?.id) return { ownerId: String(owner.id), source: 'email' };
  return { ownerId: null, source: 'email' };
}

// An open follow-up that already has a HubSpot task is not created again.
export function shouldCreateFollowUp(existing) {
  if (!existing || existing.status !== 'open') return true;
  return !String(existing.hubspot_task_id || '').trim();
}

export function estimateNotes(estimate) {
  const doc = estimate?.document;
  if (doc && typeof doc === 'object' && doc.notes != null) return String(doc.notes);
  if (estimate?.notes != null) return String(estimate.notes);
  return '';
}

// Short note stored when an estimate is marked presented.
export function presentedFollowUpNote(estimate) {
  const amount = moneyLabel(estimate?.total_amount);
  const presentedAt = estimate?.presented_at || estimate?.presentedAt || '';
  const when = presentedAt
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(presentedAt))
    : '';
  const head = when ? `Presented ${amount} estimate on ${when}` : `Presented ${amount} estimate`;
  const extra = estimateNotes(estimate).trim();
  return extra ? `${head}\n${extra}` : head;
}

export function plainEngagement(text) {
  return String(text || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, 500);
}

export function engagementBody(kind, properties) {
  const p = properties || {};
  if (kind === 'notes') return plainEngagement(p.hs_note_body);
  if (kind === 'calls') return plainEngagement(p.hs_call_body || p.hs_call_title);
  if (kind === 'emails') {
    const subject = String(p.hs_email_subject || '').trim();
    const text = plainEngagement(p.hs_email_text || '');
    if (subject && text) return plainEngagement(`${subject}\n${text}`);
    return plainEngagement(text || subject);
  }
  return '';
}

export function pickLatestEngagement(items) {
  const usable = (items || []).filter((item) => String(item?.body || '').trim());
  usable.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return usable[0] || null;
}

// Latest HubSpot note, call, or email wins when it is at least as new as the present.
// Otherwise the note is the estimate itself.
export function followUpNoteFromInteraction({ estimate, engagement } = {}) {
  const fallback = presentedFollowUpNote(estimate);
  const body = String(engagement?.body || '').trim();
  if (!body) return fallback;
  const at = engagement?.at ? new Date(engagement.at).getTime() : NaN;
  const presented = estimate?.presented_at ? new Date(estimate.presented_at).getTime() : NaN;
  if (Number.isFinite(presented) && (!Number.isFinite(at) || presented > at)) return fallback;
  return body;
}

// One open follow-up per non-deleted presented estimate. Won and lost are skipped.
export function planFollowUpBackfill({ estimates, openFollowUps, engagementByEstimateId } = {}) {
  const openByEstimate = new Map();
  for (const row of openFollowUps || []) {
    if ((row?.status || 'open') === 'open' && row.estimate_id) openByEstimate.set(row.estimate_id, row);
  }
  const plans = [];
  for (const estimate of estimates || []) {
    if (!estimate?.id || estimate.deleted_at) continue;
    if (estimate.status !== 'presented' || estimate.won_at || estimate.lost_at) continue;
    const note = followUpNoteFromInteraction({
      estimate,
      engagement: engagementByEstimateId?.[estimate.id] || null,
    });
    const open = openByEstimate.get(estimate.id);
    if (!open) {
      plans.push({ action: 'insert', estimateId: estimate.id, ownerId: estimate.owner_id, note });
      continue;
    }
    if (String(open.note || '') !== note) plans.push({ action: 'update', id: open.id, note });
  }
  return plans;
}
