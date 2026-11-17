-- Optional audit of admin password actions.
-- Run this whole file once in the Supabase SQL editor. Running it again is safe.
-- Do not put passwords, hashes, tokens, or email bodies in this table.
-- The account-passwords edge function writes the rows with the service role.
-- Until this file is run, the function still works and still rate-limits each
-- running instance. The table makes the hourly limit stick across restarts.

create table if not exists public.admin_auth_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text not null,
  target_email text,
  action text not null check (action in ('send_reset', 'set_temp', 'complete_change')),
  created_at timestamptz not null default now()
);

create index if not exists admin_auth_audit_actor_created
  on public.admin_auth_audit (actor_email, action, created_at desc);

create index if not exists admin_auth_audit_target_created
  on public.admin_auth_audit (target_email, action, created_at desc);

alter table public.admin_auth_audit enable row level security;

revoke all on public.admin_auth_audit from anon, authenticated;
grant select, insert on public.admin_auth_audit to service_role;

grant usage, select on sequence public.admin_auth_audit_id_seq to service_role;
