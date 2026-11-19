-- Phase 1 core schema.
-- Access model: signed-in users may only READ, and only rows RLS lets them see.
-- All writes go through the backend (service role) after it has validated the
-- payload and confirmed access with an RLS-scoped read. There are deliberately
-- no insert/update/delete policies or grants for `authenticated`.

create table public.studios (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table public.studio_memberships (
  studio_id uuid not null references public.studios on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'designer')),
  created_at timestamptz not null default now(),
  primary key (studio_id, user_id)
);
create index studio_memberships_user_idx on public.studio_memberships (user_id);

create table public.studio_invites (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios on delete cascade,
  client_email text not null check (char_length(client_email) <= 320),
  client_name text not null check (char_length(client_name) between 1 and 80),
  token text not null unique,
  created_by uuid references auth.users on delete set null,
  accepted_by uuid references auth.users on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index studio_invites_studio_idx on public.studio_invites (studio_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios on delete cascade,
  client_user_id uuid not null references auth.users on delete cascade,
  client_email text check (char_length(client_email) <= 320), -- copied from the verified JWT so designers can see who the client is
  name text not null check (char_length(name) between 1 and 80),
  property_type text not null check (property_type in ('existing', 'new_build')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'archived')),
  created_at timestamptz not null default now()
);
create index projects_studio_idx on public.projects (studio_id);
create index projects_client_idx on public.projects (client_user_id);

-- Immutable snapshots: the current plan of a project is its highest version_no.
create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  version_no integer not null check (version_no > 0),
  label text not null default '' check (char_length(label) <= 80),
  author_id uuid references auth.users on delete set null,
  author_role text not null check (author_role in ('client', 'designer')),
  geometry jsonb not null,
  created_at timestamptz not null default now(),
  unique (project_id, version_no)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  studio_id uuid references public.studios on delete cascade,
  project_id uuid references public.projects on delete set null,
  actor_id uuid references auth.users on delete set null,
  action text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_events_studio_idx on public.audit_events (studio_id, created_at desc);

alter table public.studios enable row level security;
alter table public.studio_memberships enable row level security;
alter table public.studio_invites enable row level security;
alter table public.projects enable row level security;
alter table public.plan_versions enable row level security;
alter table public.audit_events enable row level security;

revoke all on public.studios, public.studio_memberships, public.studio_invites,
  public.projects, public.plan_versions, public.audit_events from anon, authenticated;
grant select on public.studios, public.studio_memberships, public.studio_invites,
  public.projects, public.plan_versions, public.audit_events to authenticated;
grant select, insert, update, delete on public.studios, public.studio_memberships,
  public.studio_invites, public.projects, public.plan_versions to service_role;
grant select, insert on public.audit_events to service_role;

-- Subqueries inside policies are themselves filtered by the caller's RLS,
-- so each policy below builds on the ones above it without recursion.

create policy memberships_select_own on public.studio_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy projects_select_client_or_member on public.projects
  for select to authenticated
  using (
    client_user_id = (select auth.uid())
    or studio_id in (select studio_id from public.studio_memberships)
  );

create policy studios_select_member_or_client on public.studios
  for select to authenticated
  using (
    id in (select studio_id from public.studio_memberships)
    or id in (select studio_id from public.projects)
  );

create policy plan_versions_select_via_project on public.plan_versions
  for select to authenticated
  using (project_id in (select id from public.projects));

create policy invites_select_member on public.studio_invites
  for select to authenticated
  using (studio_id in (select studio_id from public.studio_memberships));

create policy audit_select_member on public.audit_events
  for select to authenticated
  using (studio_id in (select studio_id from public.studio_memberships));
