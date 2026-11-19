-- A user may own at most one studio. The API checks this first, but two simultaneous
-- requests could both pass that check; the index makes the database the final word.
create unique index studio_memberships_one_owner_per_user
  on public.studio_memberships (user_id)
  where role = 'owner';

-- The table-level revoke in the previous migration does not cover the identity sequence.
revoke all on sequence public.audit_events_id_seq from anon, authenticated;
