-- Invites expire after 14 days, can be revoked, and a studio has at most one open invite per email address.
alter table public.studio_invites
  add column expires_at timestamptz not null default now() + interval '14 days',
  add column revoked_at timestamptz;

-- The API now stores addresses lower-case and compares them that way.
update public.studio_invites set client_email = lower(client_email) where client_email <> lower(client_email);

-- Older duplicates (same studio, same address, not accepted) would break the unique index below: keep the newest open.
update public.studio_invites as old
set revoked_at = now()
where old.accepted_at is null
  and old.revoked_at is null
  and exists (
    select 1 from public.studio_invites as newer
    where newer.studio_id = old.studio_id
      and lower(newer.client_email) = lower(old.client_email)
      and newer.accepted_at is null
      and newer.revoked_at is null
      and (newer.created_at, newer.id) > (old.created_at, old.id)
  );

-- One open invite per client and studio: a double click or a resend reuses it instead of minting a second link.
create unique index studio_invites_one_open_idx on public.studio_invites (studio_id, lower(client_email))
  where accepted_at is null and revoked_at is null;

-- create_project checks "has this user accepted an invite to this studio?".
create index studio_invites_accepted_idx on public.studio_invites (accepted_by, studio_id) where accepted_by is not null;
