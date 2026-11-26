-- Existing-item detection (specs/item-detection.md): only the items a user accepts are stored.
-- Detections themselves are returned to the browser and never kept.
create table public.owned_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  -- The detected class, from the fixed list in backend/app/detection/classes.py.
  item_class text not null check (item_class in (
    'couch', 'chair', 'bed', 'dining table', 'tv', 'toilet', 'sink', 'refrigerator', 'oven',
    'microwave', 'potted plant', 'vase', 'clock', 'book')),
  quantity integer not null check (quantity between 1 and 20),
  -- The photo it was found in; the item stays when the photo is deleted.
  source_asset_id uuid references public.inspiration_assets on delete set null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index owned_items_project_idx on public.owned_items (project_id, created_at);
create index owned_items_asset_idx on public.owned_items (source_asset_id);
create index owned_items_creator_idx on public.owned_items (created_by);

alter table public.owned_items enable row level security;
revoke all on public.owned_items from anon, authenticated;
grant select on public.owned_items to authenticated;
grant select, insert, delete on public.owned_items to service_role;
-- Supabase's default privileges give service_role everything on new tables; an accepted item is never edited.
revoke update, truncate, references, trigger on public.owned_items from service_role;

-- Same rule as the other design data: whoever sees the project sees its items.
create policy owned_items_select_via_project on public.owned_items
  for select to authenticated using (project_id in (select id from public.projects));

-- Private bucket for the detection model. No storage policies: only the backend (service key) reads it.
-- 50 MB matches Supabase's default per-file limit; the int8 model is about 39 MB.
insert into storage.buckets (id, name, public, file_size_limit)
values ('models', 'models', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Adds a line to the brief's existing items in one statement, under a row lock, so it never overwrites a brief
-- saved at the same moment (the backend's read-modify-write of the whole document could). Raises P0001 when the
-- result would pass p_max characters. p_default is the empty brief used when the project has none yet.
create function public.append_existing_items(p_project uuid, p_line text, p_user uuid, p_max int, p_default jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current text; next text; result jsonb;
begin
  insert into public.project_briefs (project_id, brief, updated_by) values (p_project, p_default, p_user)
    on conflict (project_id) do nothing;
  select coalesce(brief->>'existing_items', '') into current
    from public.project_briefs where project_id = p_project for update;
  next := case when btrim(current) = '' then p_line else rtrim(current) || E'\n' || p_line end;
  if char_length(next) > p_max then
    raise exception 'existing items would be too long' using errcode = 'P0001';
  end if;
  update public.project_briefs
     set brief = jsonb_set(brief, '{existing_items}', to_jsonb(next)), updated_by = p_user, updated_at = now()
   where project_id = p_project
  returning brief into result;
  return result;
end $$;
revoke all on function public.append_existing_items(uuid, text, uuid, int, jsonb) from public, anon, authenticated;
grant execute on function public.append_existing_items(uuid, text, uuid, int, jsonb) to service_role;
