-- The consultant's daily cap must hold under parallel requests and across all of a user's projects.
-- reserve_ai_message takes a per-user lock, counts the user's messages of the last 24 hours in every
-- conversation, and inserts the user message only if the cap allows. It runs BEFORE the paid call, so
-- in-flight requests count. release_ai_message removes a reservation when the call failed.
create function public.reserve_ai_message(p_conversation uuid, p_user uuid, p_content text, p_cap int)
returns bigint language plpgsql security definer set search_path = '' as $$
declare used int; new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select count(*) into used
    from public.ai_messages m join public.ai_conversations c on c.id = m.conversation_id
   where c.user_id = p_user and m.role = 'user' and m.created_at > now() - interval '1 day';
  if used >= p_cap then
    raise exception 'daily message cap reached' using errcode = 'P0001';
  end if;
  insert into public.ai_messages (conversation_id, role, content) values (p_conversation, 'user', p_content)
    returning id into new_id;
  return new_id;
end $$;

create function public.release_ai_message(p_id bigint) returns void
language sql security definer set search_path = '' as $$
  delete from public.ai_messages where id = p_id and role = 'user';
$$;

revoke all on function public.reserve_ai_message(uuid, uuid, text, int), public.release_ai_message(bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_message(uuid, uuid, text, int), public.release_ai_message(bigint)
  to service_role;
