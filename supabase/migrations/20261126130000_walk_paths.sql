-- "How we move": a walking path traced in the client's browser from a short video, drawn over one still
-- frame, plus notes pinned on it. The video never reaches the server; only the frame and the points do.
-- Same access model as phase 2: users READ through RLS, every write goes through the backend.

create table public.walk_paths (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  label text not null default '' check (char_length(label) <= 80),
  storage_path text not null unique check (storage_path like project_id::text || '/walk/%'),
  -- [[x, y], ...] with x and y as fractions of the frame (0..1), in walking order.
  points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 2 and 600),
  width integer not null check (width between 1 and 4096),   -- frame size, for the image's aspect ratio
  height integer not null check (height between 1 and 4096),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index walk_paths_project_idx on public.walk_paths (project_id, created_at);
create index walk_paths_creator_idx on public.walk_paths (created_by);

create table public.walk_path_notes (
  id uuid primary key default gen_random_uuid(),
  path_id uuid not null references public.walk_paths on delete cascade,
  x real not null check (x between 0 and 1),
  y real not null check (y between 0 and 1),
  text text not null check (char_length(text) between 1 and 280),
  author_role text not null check (author_role in ('client', 'designer')),
  author_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index walk_path_notes_path_idx on public.walk_path_notes (path_id, created_at);
create index walk_path_notes_author_idx on public.walk_path_notes (author_id);

alter table public.walk_paths enable row level security;
alter table public.walk_path_notes enable row level security;
revoke all on public.walk_paths, public.walk_path_notes from anon, authenticated;
grant select on public.walk_paths, public.walk_path_notes to authenticated;
grant select, insert, delete on public.walk_paths, public.walk_path_notes to service_role;

-- The client of the project and the members of its studio see its paths and notes, nobody else.
create policy walk_paths_select_via_project on public.walk_paths
  for select to authenticated using (project_id in (select id from public.projects));
create policy walk_path_notes_select_via_path on public.walk_path_notes
  for select to authenticated using (path_id in (select id from public.walk_paths));

-- Deleting a path (or its project) queues the frame image for removal, like inspiration images.
create trigger walk_paths_queue_delete after delete on public.walk_paths
  for each row execute function public.queue_asset_deletion();

-- Final word on the per-project limit (10), so parallel uploads cannot race past the API's check.
create function public.enforce_walk_path_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects where id = new.project_id for update;
  if (select count(*) from public.walk_paths where project_id = new.project_id) >= 10 then
    raise exception 'walk path quota reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.enforce_walk_path_quota() from public, anon, authenticated;

create trigger walk_paths_quota before insert on public.walk_paths
  for each row execute function public.enforce_walk_path_quota();
