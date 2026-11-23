-- The API checks the per-project image limit first, but parallel uploads could all pass that check.
-- The trigger makes the database the final word: it locks the project row, so inserts for one project queue up.
create function public.enforce_asset_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects where id = new.project_id for update;
  if (select count(*) from public.inspiration_assets where project_id = new.project_id) >= 30 then
    raise exception 'asset quota reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.enforce_asset_quota() from public, anon, authenticated;

create trigger inspiration_assets_quota before insert on public.inspiration_assets
  for each row execute function public.enforce_asset_quota();
