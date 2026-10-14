-- Record when an estimate PDF was emailed. The send-estimate function writes these
-- with the service role after the provider accepts the message.
alter table public.estimates add column if not exists sent_at timestamptz;
alter table public.estimates add column if not exists sent_to text;

grant select, insert, update on public.estimates to service_role;
grant select, insert, update on public.contracts to service_role;
grant select, update on public.profiles to service_role;
