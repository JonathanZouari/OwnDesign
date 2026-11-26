-- Analyses of inspiration images: the objects YOLOv8 found and the image's main colours.
-- One row per image, replaced when the image is analysed again. Same access model as the rest:
-- users READ through RLS; the backend writes with the service role after an RLS-scoped check.

create table public.asset_analyses (
  asset_id uuid primary key,
  project_id uuid not null references public.projects on delete cascade,
  foreign key (asset_id, project_id) references public.inspiration_assets (id, project_id) on delete cascade,
  objects jsonb not null default '[]' check (case when jsonb_typeof(objects) = 'array' then jsonb_array_length(objects) <= 30 else false end),
  palette jsonb not null check (case when jsonb_typeof(palette) = 'array' then jsonb_array_length(palette) between 1 and 5 else false end),
  model text not null check (char_length(model) between 1 and 40),
  analysed_by uuid references auth.users on delete set null,
  analysed_at timestamptz not null default now(),
  check (pg_column_size(objects) + pg_column_size(palette) < 16384)
);
create index asset_analyses_project_idx on public.asset_analyses (project_id);
create index asset_analyses_analyst_idx on public.asset_analyses (analysed_by);

alter table public.asset_analyses enable row level security;
revoke all on public.asset_analyses from anon, authenticated;
grant select on public.asset_analyses to authenticated;
grant select, insert, update, delete on public.asset_analyses to service_role;
revoke truncate, references, trigger on public.asset_analyses from service_role;

-- The client of the project and the members of its studio see its analyses, nobody else.
create policy asset_analyses_select_via_project on public.asset_analyses
  for select to authenticated using (project_id in (select id from public.projects));

-- Only inspiration images are analysed; an analysis never moves to another image or project.
create function public.check_asset_analysis() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.asset_id <> old.asset_id or new.project_id <> old.project_id) then
    raise exception 'an analysis cannot move to another image' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    new.analysed_at := now(); -- a re-analysis is dated when it happens
  end if;
  if not exists (select 1 from public.inspiration_assets where id = new.asset_id and kind = 'inspiration') then
    raise exception 'only inspiration images are analysed' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.check_asset_analysis() from public, anon, authenticated;

create trigger asset_analyses_check before insert or update on public.asset_analyses
  for each row execute function public.check_asset_analysis();
