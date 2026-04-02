revoke all privileges on table public.jobs from anon, authenticated;
revoke all privileges on table public.card_payloads from anon, authenticated;
revoke all privileges on table public.roster_payloads from anon, authenticated;
revoke all privileges on table public.site_telemetry_events from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

drop policy if exists "jobs_service_role_select" on public.jobs;
drop policy if exists "jobs_service_role_insert" on public.jobs;
drop policy if exists "jobs_service_role_update" on public.jobs;
drop policy if exists "jobs_service_role_delete" on public.jobs;

create policy "jobs_service_role_select"
on public.jobs
for select
to service_role
using (true);

create policy "jobs_service_role_insert"
on public.jobs
for insert
to service_role
with check (true);

create policy "jobs_service_role_update"
on public.jobs
for update
to service_role
using (true)
with check (true);

create policy "jobs_service_role_delete"
on public.jobs
for delete
to service_role
using (true);

drop policy if exists "card_payloads_service_role_select" on public.card_payloads;
drop policy if exists "card_payloads_service_role_insert" on public.card_payloads;
drop policy if exists "card_payloads_service_role_update" on public.card_payloads;
drop policy if exists "card_payloads_service_role_delete" on public.card_payloads;

create policy "card_payloads_service_role_select"
on public.card_payloads
for select
to service_role
using (true);

create policy "card_payloads_service_role_insert"
on public.card_payloads
for insert
to service_role
with check (true);

create policy "card_payloads_service_role_update"
on public.card_payloads
for update
to service_role
using (true)
with check (true);

create policy "card_payloads_service_role_delete"
on public.card_payloads
for delete
to service_role
using (true);

drop policy if exists "roster_payloads_service_role_select" on public.roster_payloads;
drop policy if exists "roster_payloads_service_role_insert" on public.roster_payloads;
drop policy if exists "roster_payloads_service_role_update" on public.roster_payloads;
drop policy if exists "roster_payloads_service_role_delete" on public.roster_payloads;

create policy "roster_payloads_service_role_select"
on public.roster_payloads
for select
to service_role
using (true);

create policy "roster_payloads_service_role_insert"
on public.roster_payloads
for insert
to service_role
with check (true);

create policy "roster_payloads_service_role_update"
on public.roster_payloads
for update
to service_role
using (true)
with check (true);

create policy "roster_payloads_service_role_delete"
on public.roster_payloads
for delete
to service_role
using (true);

drop policy if exists "site_telemetry_events_service_role_select" on public.site_telemetry_events;
drop policy if exists "site_telemetry_events_service_role_insert" on public.site_telemetry_events;
drop policy if exists "site_telemetry_events_service_role_update" on public.site_telemetry_events;
drop policy if exists "site_telemetry_events_service_role_delete" on public.site_telemetry_events;

create policy "site_telemetry_events_service_role_select"
on public.site_telemetry_events
for select
to service_role
using (true);

create policy "site_telemetry_events_service_role_insert"
on public.site_telemetry_events
for insert
to service_role
with check (true);

create policy "site_telemetry_events_service_role_update"
on public.site_telemetry_events
for update
to service_role
using (true)
with check (true);

create policy "site_telemetry_events_service_role_delete"
on public.site_telemetry_events
for delete
to service_role
using (true);
