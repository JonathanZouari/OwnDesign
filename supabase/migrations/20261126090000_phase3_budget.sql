-- Phase 3: budget and shopping list. Same access model as phase 2:
-- signed-in users may only READ rows RLS lets them see; every write goes through the backend (service role).

create table public.budget_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  position integer not null check (position between 0 and 299),
  kind text not null check (kind in ('furniture', 'finish', 'custom')),
  ref text check (ref ~ '^[A-Za-z0-9_|-]{1,60}$'),
  label text not null check (char_length(label) between 1 and 80),
  qty numeric(10, 2) not null check (qty >= 0 and qty <= 100000),
  unit text not null check (unit in ('item', 'm2')),
  unit_price integer not null check (unit_price between 0 and 100000000),
  note text not null default '' check (char_length(note) <= 200),
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  check ((kind = 'custom') = (ref is null)),
  unique (project_id, kind, ref)
);
create index budget_items_project_idx on public.budget_items (project_id, position);
create index budget_items_updater_idx on public.budget_items (updated_by);

alter table public.budget_items enable row level security;
revoke all on public.budget_items from anon, authenticated;
grant select on public.budget_items to authenticated;
grant select, insert, update, delete on public.budget_items to service_role;

-- Filtered by the caller's RLS on projects: the client of the project and the members of its studio.
create policy budget_select_via_project on public.budget_items
  for select to authenticated using (project_id in (select id from public.projects));
