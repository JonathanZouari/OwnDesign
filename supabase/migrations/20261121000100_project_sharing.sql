create table public.project_shares (
  project_id uuid not null references public.projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  permission text not null check (permission in ('view','save')),
  primary key (project_id, user_id)
);
create index project_shares_recipient on public.project_shares(user_id, project_id);
alter table public.project_shares enable row level security;
revoke all on public.project_shares from public, anon, authenticated;
grant select on public.project_shares to authenticated;
grant select, insert, update, delete on public.project_shares to service_role;
create policy own_project_shares on public.project_shares for select to authenticated
  using (user_id = (select auth.uid()));
create policy shared_projects on public.projects for select to authenticated
  using (id in (select project_id from public.project_shares));
