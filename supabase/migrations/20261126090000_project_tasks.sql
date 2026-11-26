-- Client tasks: the studio's designer asks ("Measure the bedroom"), the project's client marks it done.
-- Same access model as before: signed-in users may only READ rows RLS lets them see;
-- every write goes through the backend (service role) after validation and an RLS-scoped check.

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  title text not null,
  details text not null default '',
  status text not null default 'open',
  client_note text not null default '',
  created_by uuid references auth.users on delete set null,
  done_by uuid references auth.users on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_tasks_title_length check (char_length(title) between 1 and 120 and btrim(title) <> ''),
  constraint project_tasks_details_length check (char_length(details) <= 1000),
  constraint project_tasks_note_length check (char_length(client_note) <= 500),
  constraint project_tasks_status check (status in ('open', 'done')),
  constraint project_tasks_done_at_matches_status check ((status = 'done') = (done_at is not null)),
  -- done_by may be null on a done task (the user was deleted), never set on an open one.
  constraint project_tasks_open_not_done_by check (status = 'done' or done_by is null),
  constraint project_tasks_done_after_create check (done_at is null or done_at >= created_at)
);
-- Serves the project list (status, newest first), the client inbox (status = 'open'),
-- the quota count and the cascade on project delete.
create index project_tasks_project_status_idx on public.project_tasks (project_id, status, created_at desc);
create index project_tasks_creator_idx on public.project_tasks (created_by);
create index project_tasks_done_by_idx on public.project_tasks (done_by);

alter table public.project_tasks enable row level security;
revoke all on public.project_tasks from anon, authenticated;
grant select on public.project_tasks to authenticated;
grant select, insert, update, delete on public.project_tasks to service_role;

-- The subquery is filtered by the caller's RLS on projects: the project's client and the members of
-- its studio see its tasks, nobody else.
create policy tasks_select_via_project on public.project_tasks
  for select to authenticated using (project_id in (select id from public.projects));

-- The API checks the limit first; the trigger is the final word for parallel inserts.
-- Locking the project row queues inserts for one project; NO KEY UPDATE does not block foreign-key
-- checks of other child tables. The cap counts done tasks too: the designer deletes old ones.
create function public.enforce_task_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects where id = new.project_id for no key update;
  if (select count(*) from public.project_tasks where project_id = new.project_id) >= 200 then
    raise exception 'task quota reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.enforce_task_quota() from public, anon, authenticated;

create trigger project_tasks_quota before insert on public.project_tasks
  for each row execute function public.enforce_task_quota();

-- A task never moves to another project (that would skip the quota and cross tenants), and its
-- author and creation time are fixed. Keeps updated_at current.
create function public.guard_task_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- created_by may only become null: that is the cascade when its user is deleted.
  if new.project_id <> old.project_id or new.created_at <> old.created_at
     or (new.created_by is distinct from old.created_by and new.created_by is not null) then
    raise exception 'immutable task column' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.guard_task_update() from public, anon, authenticated;

create trigger project_tasks_guard before update on public.project_tasks
  for each row execute function public.guard_task_update();
