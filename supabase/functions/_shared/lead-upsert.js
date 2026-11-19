// Decide how a HubSpot pull writes one lead.
// An assigned lead is left alone. An invalid lead is left alone, and a
// dismissed lead is left alone, so a later pull cannot put either back on
// the list. A new HubSpot id is inserted.
// An unassigned lead may refresh contact fields. Owner, stage, deadline, and
// text columns are never part of a pull write.

export function leadUpsertPlan(existing, row, syncedAt) {
  if (existing?.owner_id) return { action: 'skip' };
  if (existing?.stage === 'invalid' || existing?.stage === 'dismissed') return { action: 'skip' };
  const synced_at = syncedAt;
  if (!existing) {
    return {
      action: 'insert',
      values: {
        hubspot_contact_id: row.hubspot_contact_id || null,
        hubspot_deal_id: row.hubspot_deal_id || null,
        name: row.name,
        phone: row.phone,
        email: row.email,
        address: row.address,
        notes: row.notes,
        source: row.source,
        stage: 'new',
        synced_at,
      },
    };
  }
  return {
    action: 'update',
    id: existing.id,
    values: {
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      notes: row.notes || existing.notes,
      source: row.source,
      hubspot_contact_id: row.hubspot_contact_id || existing.hubspot_contact_id,
      hubspot_deal_id: row.hubspot_deal_id || existing.hubspot_deal_id,
      synced_at,
    },
  };
}
