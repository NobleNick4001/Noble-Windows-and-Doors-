// Reasons a lead can be marked invalid. The picker is optional.
// A blank reason is allowed. Anything else must be one of these labels.

export const INVALID_LEAD_REASONS = Object.freeze([
  'Spam/fake',
  'Wrong number',
  'Duplicate',
  'Not in service area',
  'Other',
]);

export function normalizeInvalidReason(reason) {
  const clean = String(reason ?? '').trim();
  if (!clean) return '';
  if (!INVALID_LEAD_REASONS.includes(clean)) return null;
  return clean;
}

// HubSpot marker. The deal property is the filter. The note is the short record.
export function invalidHubspotCopy(reason) {
  const clean = normalizeInvalidReason(reason);
  if (clean == null) return null;
  const marker = clean ? `Invalid lead: ${clean}` : 'Invalid lead';
  const note = clean ? `Invalid lead. ${clean}.` : 'Invalid lead.';
  return { marker, note, reason: clean };
}
