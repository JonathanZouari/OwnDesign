-- Budget / shopping list: one estimate per project, made of ordered line items.
-- Same access model as phase 2: signed-in users may only READ rows RLS lets them see;
-- every write goes through the backend (service role), and the list is replaced atomically by replace_estimate.

create table public.project_estimates (
  project_id uuid primary key references public.projects on delete cascade,
  currency text not null check (currency in ('USD', 'EUR', 'GBP', 'ILS')),
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);

create table public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project_estimates (project_id) on delete cascade,
  position integer not null check (position between 0 and 199),
  category text not null check (category in ('furniture', 'finish', 'lighting', 'textile', 'appliance', 'other')),
  name text not null check (char_length(name) between 1 and 120),
  room text check (char_length(room) <= 60),
  quantity numeric(10, 2) not null check (quantity > 0 and quantity <= 10000),
  unit text not null check (unit in ('unit', 'm2', 'm', 'set')),
  unit_price integer not null check (unit_price between 0 and 100000000),
  source text not null check (source in ('synthetic', 'user')),
  note text not null default '' check (char_length(note) <= 200),
  unique (project_id, position)
);
create index estimate_items_project_idx on public.estimate_items (project_id);
create index project_estimates_updater_idx on public.project_estimates (updated_by);

alter table public.project_estimates enable row level security;
alter table public.estimate_items enable row level security;

revoke all on public.project_estimates, public.estimate_items from anon, authenticated;
grant select on public.project_estimates, public.estimate_items to authenticated;
grant select, insert, update, delete on public.project_estimates, public.estimate_items to service_role;

-- Subqueries are filtered by the caller's RLS on projects: the client of the project
-- and the members of its studio see the estimate, nobody else.
create policy estimates_select_via_project on public.project_estimates
  for select to authenticated using (project_id in (select id from public.projects));
create policy estimate_items_select_via_project on public.estimate_items
  for select to authenticated using (project_id in (select id from public.projects));

-- Replaces the whole list in one transaction. A per-project advisory lock serializes parallel saves, so two
-- calls never interleave; any failing row (a check constraint, a bad type) rolls the whole call back.
create function public.replace_estimate(p_project uuid, p_user uuid, p_currency text, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a json array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'too many items (max 200)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_project::text, 0));

  insert into public.project_estimates (project_id, currency, updated_by, updated_at)
  values (p_project, p_currency, p_user, now())
  on conflict (project_id) do update
    set currency = excluded.currency, updated_by = excluded.updated_by, updated_at = now();

  delete from public.estimate_items where project_id = p_project;

  insert into public.estimate_items
    (project_id, position, category, name, room, quantity, unit, unit_price, source, note)
  select p_project, (e.ord - 1)::int, r.category, r.name, r.room, r.quantity, r.unit, r.unit_price, r.source,
         coalesce(r.note, '')
    from jsonb_array_elements(p_items) with ordinality as e(item, ord)
    cross join lateral jsonb_populate_record(null::public.estimate_items, e.item) as r;
end $$;
revoke all on function public.replace_estimate(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_estimate(uuid, uuid, text, jsonb) to service_role;
