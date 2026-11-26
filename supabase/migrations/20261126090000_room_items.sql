-- Room items: the things already in the home, added by hand or confirmed from a YOLOv8 scan of a photo.
-- Same access model as the rest: signed-in users only READ what RLS shows them;
-- the backend writes with the service role after validation and an RLS-scoped check.

-- Lets an item reference a photo only of its own project (composite foreign key below).
alter table public.inspiration_assets add constraint inspiration_assets_id_project_key unique (id, project_id);

create table public.room_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  room_id text check (room_id ~ '^[A-Za-z0-9_-]{1,40}$'), -- a room of the plan; null means the whole home
  label text not null check (char_length(label) between 1 and 80 and btrim(label) <> ''),
  category text not null check (category in
    ('seating', 'sleeping', 'tables', 'storage', 'appliances', 'electronics', 'decor', 'plants', 'bathroom', 'other')),
  color_hex text check (color_hex ~ '^#[0-9a-f]{6}$'),
  confidence real check (confidence between 0 and 1),
  source text not null check (source in ('scan', 'manual')),
  asset_id uuid, -- the photo it was found in
  foreign key (asset_id, project_id) references public.inspiration_assets (id, project_id) on delete set null (asset_id),
  box jsonb check (box is null or (
    jsonb_typeof(box) = 'array' and jsonb_array_length(box) = 4
    and jsonb_typeof(box->0) = 'number' and jsonb_typeof(box->1) = 'number'
    and jsonb_typeof(box->2) = 'number' and jsonb_typeof(box->3) = 'number'
    and (box->>0)::numeric between 0 and 1 and (box->>1)::numeric between 0 and 1
    and (box->>2)::numeric between 0 and 1 and (box->>3)::numeric between 0 and 1)),
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index room_items_project_idx on public.room_items (project_id, created_at);
create index room_items_asset_idx on public.room_items (asset_id, project_id) where asset_id is not null;
create index room_items_creator_idx on public.room_items (created_by);

alter table public.room_items enable row level security;
revoke all on public.room_items from anon, authenticated;
grant select on public.room_items to authenticated;
grant select, insert, update, delete on public.room_items to service_role;
revoke truncate, references, trigger on public.room_items from service_role;

-- The client of the project and the members of its studio see its items, nobody else.
create policy room_items_select_via_project on public.room_items
  for select to authenticated using (project_id in (select id from public.projects));

-- The API checks the per-project limit first; parallel inserts could all pass that check.
-- Locking the project row queues inserts for one project, so the database has the final word.
create function public.enforce_room_item_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects where id = new.project_id for no key update;
  if (select count(*) from public.room_items where project_id = new.project_id) >= 200 then
    raise exception 'room item quota reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.enforce_room_item_quota() from public, anon, authenticated;

create trigger room_items_quota before insert on public.room_items
  for each row execute function public.enforce_room_item_quota();

-- An item never moves to another project (that would also slip past the quota).
create function public.freeze_room_item_project() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id <> old.project_id then
    raise exception 'an item cannot move to another project' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.freeze_room_item_project() from public, anon, authenticated;

create trigger room_items_frozen_project before update of project_id on public.room_items
  for each row execute function public.freeze_room_item_project();
