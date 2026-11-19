# Lead assignment pipeline

Design for the sales-app lead queue. GitHub Pages publishes the static app. Supabase changes below are run by hand after merge. This file does not apply them.

## App

Six tabs stay Quote, Doors, Brochures, Estimate, Mine, More. Service worker cache is `nwd-sales-v72-leads-autopull`.

Reps open New Leads inside Mine. The Mine badge counts their leads that are not marked Called. Admins open Leads under More, assign a rep, and can Refresh. Presented still opens an estimate and the existing presented trigger creates the follow-up.

The call deadline is `public.lead_call_plan`. America/Phoenix, close exclusive:

- Monday–Friday 7:00 AM–6:00 PM, 1 hour
- Saturday–Sunday 10:00 AM–4:00 PM, 4 hours

Assigned outside a window, the clock starts at the next opening. Leftover time continues at the next opening.

## Automatic HubSpot pull

`lead-sla` runs every 5 minutes from pg_cron. It has `verify_jwt = false` and requires the `x-cron-secret` header, checked against `CRON_SECRET` the same way as the daily digest. `hubspot-sync` stays `verify_jwt = true`. The admin Refresh button still calls `hubspot-sync` action `pull-unassigned`.

On each cron run, `lead-sla` also pulls unassigned HubSpot leads when the current Phoenix time is inside the same business-hours windows. The hours check is in `inLeadWindow` (`supabase/functions/_shared/lead-clock.js`), so the cron expression stays `*/5 * * * *`. Outside those hours the pull is skipped. Overdue admin texts still run on every call, after `call_due_at` has passed, once per lead.

The pull reuses `pullUnassigned`. It dedupes on HubSpot contact id and deal id. An already-assigned lead is not updated. The pull does not send a text.

## Post-merge Supabase steps

Do these by hand. A Pages publish does not run them.

### 1. Migration

Run `supabase/migrations/009_leads.sql` once in the SQL editor.

### 2. Deploy functions

| Function | `verify_jwt` | Command |
| --- | --- | --- |
| `hubspot-sync` | `true` | `supabase functions deploy hubspot-sync` |
| `lead-sla` | `false` | `supabase functions deploy lead-sla --no-verify-jwt` |

`hubspot-sync` actions: `pull-unassigned` (admin Refresh), `assign-lead`, `retry-lead-text`, `lead-appointment`, `lead-lost`.

`lead-sla`: cron only. Header `x-cron-secret` must match `CRON_SECRET`. During Phoenix business hours it pulls unassigned leads. Every run texts admins for leads past `call_due_at`.

### 3. Secrets

Set in the Supabase function environment. Do not commit them.

| Secret | Use |
| --- | --- |
| `QUO_API_KEY` | Quo Authorization header. Staff numbers only. |
| `QUO_FROM_NUMBER` | Company line, E.164. |
| `HUBSPOT_TOKEN` | Already used. Owner write-back and both pulls. |
| `CRON_SECRET` | Already used. `lead-sla` compares `x-cron-secret` to this. |
| `HUBSPOT_INBOX_OWNER_ID` | Optional. Owner id that counts as the unassigned inbox, plus a blank owner. |
| `HUBSPOT_INBOX_STAGE_LABEL` | Optional. Deal stage label for a new lead. If unset, appointment, presentation, and closed stages are skipped. |

### 4. Cron SQL

After `lead-sla` is deployed, `pg_cron` and `pg_net` are enabled, and Vault secret `cron_secret` matches `CRON_SECRET`, run:

`supabase/schedule/pg_cron_lead_sla.sql`

That schedules `lead-sla` every 5 minutes. Running the file again replaces that job. It is not a migration.
