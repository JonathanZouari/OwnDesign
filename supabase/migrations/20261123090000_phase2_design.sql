-- Phase 2: design brief, finish selections, inspiration assets, moodboard, AI consultant.
-- Same access model as phase 1: signed-in users may only READ rows RLS lets them see;
-- every write goes through the backend (service role) after validation and an RLS-scoped check.

create table public.project_briefs (
  project_id uuid primary key references public.projects on delete cascade,
  brief jsonb not null check (jsonb_typeof(brief) = 'object' and pg_column_size(brief) < 65536),
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);

create table public.finish_selections (
  project_id uuid not null references public.projects on delete cascade,
  room_id text not null check (room_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  surface text not null check (surface in ('floor', 'walls', 'ceiling', 'cabinets')),
  material_id text not null check (material_id ~ '^[a-z0-9-]{1,40}$'),
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  primary key (project_id, room_id, surface)
);

create table public.inspiration_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  kind text not null check (kind in ('inspiration', 'existing_item')),
  storage_path text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  caption text not null default '' check (char_length(caption) <= 200),
  check (storage_path like project_id::text || '/%'),
  uploaded_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index inspiration_assets_project_idx on public.inspiration_assets (project_id);

create table public.moodboard_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  kind text not null check (kind in ('asset', 'style', 'material')),
  ref text not null check (char_length(ref) between 1 and 40), -- style or material id; the asset id for kind 'asset'
  asset_id uuid references public.inspiration_assets on delete cascade,
  check ((kind = 'asset') = (asset_id is not null)),
  position integer not null check (position >= 0),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (project_id, kind, ref)
);
create index moodboard_items_project_idx on public.moodboard_items (project_id, position);

-- One conversation per project and user. The assistant never changes the plan.
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table public.ai_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now()
);
create index ai_conversations_user_idx on public.ai_conversations (user_id);
create index inspiration_assets_uploader_idx on public.inspiration_assets (uploaded_by);
create index project_briefs_updater_idx on public.project_briefs (updated_by);
create index finish_selections_updater_idx on public.finish_selections (updated_by);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, id);

alter table public.project_briefs enable row level security;
alter table public.finish_selections enable row level security;
alter table public.inspiration_assets enable row level security;
alter table public.moodboard_items enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

revoke all on public.project_briefs, public.finish_selections, public.inspiration_assets,
  public.moodboard_items, public.ai_conversations, public.ai_messages from anon, authenticated;
grant select on public.project_briefs, public.finish_selections, public.inspiration_assets,
  public.moodboard_items, public.ai_conversations, public.ai_messages to authenticated;
grant select, insert, update, delete on public.project_briefs, public.finish_selections,
  public.inspiration_assets, public.moodboard_items, public.ai_conversations to service_role;
grant select, insert on public.ai_messages to service_role;
grant usage on sequence public.ai_messages_id_seq to service_role;
revoke update, delete, truncate on public.ai_messages from service_role;

-- Subqueries are filtered by the caller's RLS on projects: the client of the project
-- and the members of its studio see the project's design data, nobody else.
create policy briefs_select_via_project on public.project_briefs
  for select to authenticated using (project_id in (select id from public.projects));
create policy finishes_select_via_project on public.finish_selections
  for select to authenticated using (project_id in (select id from public.projects));
create policy assets_select_via_project on public.inspiration_assets
  for select to authenticated using (project_id in (select id from public.projects));
create policy moodboard_select_via_project on public.moodboard_items
  for select to authenticated using (project_id in (select id from public.projects));
-- A conversation is private to the user who holds it.
create policy conversations_select_own on public.ai_conversations
  for select to authenticated
  using (user_id = (select auth.uid()) and project_id in (select id from public.projects));
create policy messages_select_via_conversation on public.ai_messages
  for select to authenticated using (conversation_id in (select id from public.ai_conversations));

-- Private bucket for uploads. No storage policies: users never touch it directly;
-- the backend uploads and hands out short-lived signed URLs after an access check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-assets', 'project-assets', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

revoke all on sequence public.ai_messages_id_seq from anon, authenticated;

-- Deleting a project or a user cascades away asset rows, which would orphan the files.
-- The trigger queues each path; the backend removes queued files from storage.
create table public.storage_deletions (
  path text primary key,
  queued_at timestamptz not null default now()
);
alter table public.storage_deletions enable row level security;
revoke all on public.storage_deletions from anon, authenticated;
grant select, delete on public.storage_deletions to service_role;

create function public.queue_asset_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.storage_deletions (path) values (old.storage_path) on conflict do nothing;
  return old;
end $$;
revoke all on function public.queue_asset_deletion() from public, anon, authenticated;

create trigger inspiration_assets_queue_delete after delete on public.inspiration_assets
  for each row execute function public.queue_asset_deletion();
