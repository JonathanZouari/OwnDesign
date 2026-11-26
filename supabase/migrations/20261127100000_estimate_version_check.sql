-- Optimistic concurrency for the shopping list: replace_estimate can refuse to overwrite a list that changed
-- since the caller read it.
--
-- p_check false (default): replaces unconditionally, so existing calls with the four original named arguments
-- behave as before. p_check true: p_base must equal the current project_estimates.updated_at (null = "no list
-- saved yet"), otherwise nothing is written and the call raises SQLSTATE PT409. PostgREST turns a PTxyz code
-- into HTTP status xyz and returns the code unchanged in the error body.
--
-- The four-argument function is dropped, not kept beside the new one: two candidates would make a
-- four-argument call ambiguous.

drop function public.replace_estimate(uuid, uuid, text, jsonb);

create function public.replace_estimate(p_project uuid, p_user uuid, p_currency text, p_items jsonb,
                                        p_check boolean default false, p_base timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_current timestamptz;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a json array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'too many items (max 200)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_project::text, 0));

  -- Read after the lock: under read committed this sees whatever the previous holder committed.
  if p_check then
    select e.updated_at into v_current from public.project_estimates as e where e.project_id = p_project;
    if v_current is distinct from p_base then
      raise exception 'the shopping list was changed since it was read' using errcode = 'PT409';
    end if;
  end if;

  -- updated_at is the version, so it must move forward on every replace. now() is the transaction start, which
  -- can be older than the value written by a call that started later but got the lock first. The greatest()
  -- also covers a server clock that steps backwards.
  insert into public.project_estimates as e (project_id, currency, updated_by, updated_at)
  values (p_project, p_currency, p_user, clock_timestamp())
  on conflict (project_id) do update
    set currency = excluded.currency, updated_by = excluded.updated_by,
        updated_at = greatest(clock_timestamp(), e.updated_at + interval '1 microsecond');

  delete from public.estimate_items where project_id = p_project;

  insert into public.estimate_items
    (project_id, position, category, name, room, quantity, unit, unit_price, source, note)
  select p_project, (e.ord - 1)::int, r.category, r.name, r.room, r.quantity, r.unit, r.unit_price, r.source,
         coalesce(r.note, '')
    from jsonb_array_elements(p_items) with ordinality as e(item, ord)
    cross join lateral jsonb_populate_record(null::public.estimate_items, e.item) as r;
end $$;
revoke all on function public.replace_estimate(uuid, uuid, text, jsonb, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_estimate(uuid, uuid, text, jsonb, boolean, timestamptz) to service_role;
