create table public.layout_reviews (
  version_id uuid not null references public.plan_versions(id) on delete cascade,
  room_id text not null,
  item_id text not null default '',
  author_id uuid not null references auth.users(id) on delete cascade,
  author_role text not null check (author_role in ('client','designer')),
  decision text not null check (decision in ('comment','approve','revise')),
  note text not null check (length(note) <= 1200),
  updated_at timestamptz not null default now(),
  primary key(version_id, room_id, item_id, author_id)
);
alter table public.layout_reviews enable row level security;
revoke all on public.layout_reviews from public, anon, authenticated;
grant select on public.layout_reviews to authenticated;
grant select, insert, update, delete on public.layout_reviews to service_role;
create policy read_visible_layout_reviews on public.layout_reviews for select to authenticated
  using (version_id in (select id from public.plan_versions));
