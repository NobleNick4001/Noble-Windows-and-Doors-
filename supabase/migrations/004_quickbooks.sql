-- QuickBooks Online connection and the one invoice stored on each signed estimate.
-- Tokens are service-role only. The browser never reads this table.
-- Run this in the Supabase SQL editor. Shipping the app does not apply it.

create table if not exists public.qbo_connection (
  id integer primary key default 1 check (id = 1),
  realm_id text not null,
  company_name text,
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.qbo_oauth_state (
  state text primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

alter table public.qbo_connection enable row level security;
alter table public.qbo_oauth_state enable row level security;

-- No policies. authenticated and anon have no grants, so the client cannot read tokens.
revoke all on public.qbo_connection from anon, authenticated, public;
revoke all on public.qbo_oauth_state from anon, authenticated, public;
grant select, insert, update, delete on public.qbo_connection to service_role;
grant select, insert, update, delete on public.qbo_oauth_state to service_role;

alter table public.estimates add column if not exists qbo_customer_id text;
alter table public.estimates add column if not exists qbo_invoice_id text;
alter table public.estimates add column if not exists qbo_doc_number text;
alter table public.estimates add column if not exists qbo_payment_link text;
alter table public.estimates add column if not exists qbo_invoice_state text;
alter table public.estimates add column if not exists qbo_invoice_error text;
alter table public.estimates add column if not exists qbo_notice text;
alter table public.estimates add column if not exists qbo_deposit_cents integer;
alter table public.estimates add column if not exists qbo_balance_cents integer;
alter table public.estimates add column if not exists qbo_total_cents integer;
alter table public.estimates add column if not exists qbo_amount_due_cents integer;
alter table public.estimates add column if not exists qbo_paid_cents integer;
alter table public.estimates add column if not exists qbo_fee_deposit_cents integer;
alter table public.estimates add column if not exists qbo_fee_final_cents integer;
alter table public.estimates add column if not exists qbo_card_on boolean;
alter table public.estimates add column if not exists qbo_attachment_id text;
alter table public.estimates add column if not exists qbo_offline_payment_id text;
alter table public.estimates add column if not exists qbo_offline_final_payment_id text;
alter table public.estimates add column if not exists qbo_synced_at timestamptz;

-- qbo_deposit_cents / qbo_balance_cents are the signed contract split (60/40), not the live balance.
-- qbo_amount_due_cents is Invoice.Balance from QuickBooks (remaining open on the same invoice).
-- qbo_fee_deposit_cents and qbo_fee_final_cents are null until that stage's card fee exists.
-- A later completion screen can call the same invoice: refresh balance, enable-card stage=final,
-- or record-payment purpose=final. Those columns are unused by the current screen.
