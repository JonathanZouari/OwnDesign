-- Invite history: the last email attempt per invite, and which invite replaced one whose address was corrected.
alter table public.studio_invites
  add column last_send_at timestamptz,
  add column last_send_status text check (last_send_status in ('sent', 'failed', 'not_configured', 'daily_limit')),
  add column replaced_by uuid references public.studio_invites on delete set null;

-- An invite is replaced at most once, so retrying a correction finds the replacement instead of making another.
create unique index studio_invites_replaced_by_idx on public.studio_invites (replaced_by) where replaced_by is not null;

-- Correct an invite's address in one transaction: cancel the original (its link stops working), point it at a new
-- invite for the corrected address, and return the new invite's id. Idempotent: a second call returns the same id.
-- The caller (the API, with the service key) has already checked that the user is a member of the invite's studio.
create function public.correct_invite(
  p_invite uuid, p_email text, p_name text, p_token text, p_expires timestamptz, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  original public.studio_invites;
  replacement uuid;
begin
  select * into original from public.studio_invites where id = p_invite for update;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if original.replaced_by is not null then
    if (select client_email from public.studio_invites where id = original.replaced_by) = lower(p_email) then
      return original.replaced_by; -- the same correction again: a double click or a retry
    end if;
    raise exception 'invite already corrected' using errcode = 'P0001';
  end if;
  if original.accepted_at is not null or original.revoked_at is not null then
    raise exception 'invite not open' using errcode = 'P0001';
  end if;
  if original.client_email = lower(p_email) then
    raise exception 'same address' using errcode = '22023';
  end if;

  update public.studio_invites set revoked_at = now() where id = p_invite;

  -- The corrected address may already have an open invite in this studio: reuse it rather than mint a second link.
  select id into replacement from public.studio_invites
  where studio_id = original.studio_id and client_email = lower(p_email) and accepted_at is null and revoked_at is null;
  if replacement is null then
    insert into public.studio_invites (studio_id, client_email, client_name, token, created_by, expires_at)
    values (original.studio_id, lower(p_email), p_name, p_token, p_actor, p_expires)
    returning id into replacement;
  else
    update public.studio_invites set expires_at = p_expires, client_name = p_name where id = replacement;
  end if;

  update public.studio_invites set replaced_by = replacement where id = p_invite;
  return replacement;
end $$;
revoke all on function public.correct_invite(uuid, text, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.correct_invite(uuid, text, text, text, timestamptz, uuid) to service_role;
