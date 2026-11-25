create table public.project_messages (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects on delete cascade,
  request_id uuid not null,
  author_id uuid not null references auth.users on delete cascade,
  author_role text not null check (author_role in ('client','designer')),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique(project_id,author_id,request_id)
);
create index project_messages_feed on public.project_messages(project_id,id desc);
create table public.project_message_reads (
  reader_id uuid not null references auth.users on delete cascade,
  message_id bigint not null references public.project_messages on delete cascade,
  primary key(reader_id,message_id)
);
create index project_message_reads_message on public.project_message_reads(message_id);
alter table public.project_messages enable row level security;
alter table public.project_message_reads enable row level security;
revoke all on public.project_messages,public.project_message_reads from public,anon,authenticated;
grant select on public.project_messages,public.project_message_reads to authenticated;
grant select,insert on public.project_messages,public.project_message_reads to service_role;
grant usage on sequence public.project_messages_id_seq to service_role;
create policy visible_messages on public.project_messages for select to authenticated
 using(project_id in (select id from public.projects));
create policy own_message_reads on public.project_message_reads for select to authenticated
 using(reader_id=(select auth.uid()) and message_id in (select id from public.project_messages));
create function public.project_unread_count(p_project uuid) returns bigint
 language sql stable security invoker set search_path='' as $$
 select count(*) from public.project_messages m where m.project_id=p_project and m.author_id<>(select auth.uid())
 and not exists(select 1 from public.project_message_reads r where r.reader_id=(select auth.uid()) and r.message_id=m.id);
$$;
revoke all on function public.project_unread_count(uuid) from public,anon;
grant execute on function public.project_unread_count(uuid) to authenticated;
