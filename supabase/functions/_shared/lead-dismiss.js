// Reasons an admin can dismiss a lead that was already handled outside the app.
// A blank reason is allowed. Anything else must be one of these labels.
// Dismiss does not write to HubSpot and does not send a text.

export const DISMISS_LEAD_REASONS = Object.freeze([
  'Already assigned in HubSpot',
  'Already handled',
  'Other',
]);

export function normalizeDismissReason(reason) {
  const clean = String(reason ?? '').trim();
  if (!clean) return '';
  if (!DISMISS_LEAD_REASONS.includes(clean)) return null;
  return clean;
}
