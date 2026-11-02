-- Day-zero checks on a plain Postgres 16 (see run.sh). Every check raises on failure.
\set ON_ERROR_STOP on
set role service_role;

do $$
declare r json; i int;
begin
  -- first rider in Amsterdam gets plate 1
  r := public.join_waitlist('amsterdam', 'Frankie', 'Frankie@Example.com', 'west', array['kite','mtb'], '{"kite":"regular"}', false, null, '{}', true, 'instagram', null);
  assert (r->>'plate')::int = 1, 'first plate is 1: ' || r::text;
  assert (r->>'existing')::boolean = false, 'new signup';
  -- same email, other case: same row, same plate, sports merged, captain turned on
  r := public.join_waitlist('amsterdam', 'Frankie', ' frankie@example.com ', null, array['surf'], '{"surf":"rookie"}', true, 'kite', array['sat']);
  assert (r->>'plate')::int = 1 and (r->>'existing')::boolean, 'existing keeps plate: ' || r::text;
  assert (select sports from public.signups where email = 'frankie@example.com') = array['kite','mtb','surf'], 'sports merged';
  assert (select levels->>'surf' from public.signups where email = 'frankie@example.com') = 'rookie', 'levels merged';
  assert (r->>'captains')::int = 1, 'captain counted';
  -- plates count per city
  r := public.join_waitlist('barcelona', 'Núria', 'nuria@example.com');
  assert (r->>'plate')::int = 1, 'Barcelona starts at 1';
  r := public.join_waitlist('amsterdam', 'Marta', 'marta@example.com');
  assert (r->>'plate')::int = 2, 'second Amsterdam plate';
  -- the same person in two cities is two signups
  r := public.join_waitlist('lisbon', 'Frankie', 'frankie@example.com', null, '{}', '{}', true);
  assert (r->>'plate')::int = 1 and (r->>'status') = 'soon' and (r->>'captains')::int = 1, 'lisbon signup: ' || r::text;
  -- plates stop at 100
  for i in 3..101 loop perform public.join_waitlist('amsterdam', 'Rider', 'rider' || i || '@example.com'); end loop;
  assert (select plate from public.signups where email = 'rider100@example.com') = 100, 'plate 100 given';
  assert (select plate from public.signups where email = 'rider101@example.com') is null, 'no plate 101';
  r := public.public_counts();
  assert (select (c->>'plates_left')::int from json_array_elements(r->'cities') c where c->>'slug' = 'amsterdam') = 0, 'no plates left';
  assert (select (c->>'riders')::int from json_array_elements(r->'cities') c where c->>'slug' = 'amsterdam') = 101, 'riders counted';
  -- bad input is refused by the table checks
  begin perform public.join_waitlist('amsterdam', 'X', 'not-an-email'); assert false, 'bad email accepted';
  exception when check_violation then null; end;
  begin perform public.join_waitlist('amsterdam', 'X', 'x@example.com', null, array['golf']); assert false, 'bad sport accepted';
  exception when check_violation then null; end;
  begin perform public.join_waitlist('atlantis', 'X', 'x@example.com'); assert false, 'unknown city accepted';
  exception when sqlstate 'P0002' then null; end;
  -- RSVP: waiver required, one row per email, counter
  begin perform public.rsvp_night('Sam', 'sam@example.com', 'kite-wing', 'sants', false); assert false, 'no waiver accepted';
  exception when sqlstate '22023' then null; end;
  r := public.rsvp_night('Sam', 'sam@example.com', 'kite-wing', 'sants', true, true);
  assert (r->>'going')::int = 1 and not (r->>'existing')::boolean, 'first rsvp';
  r := public.rsvp_night('Sam', 'SAM@example.com', 'mtb', 'gracia', true);
  assert (r->>'going')::int = 1 and (r->>'existing')::boolean, 'rsvp updated, not doubled';
  assert (select session from public.night_rsvps where email = 'sam@example.com') = 'mtb', 'session changed';
  begin perform public.rsvp_night('Sam', 'sam2@example.com', 'golf', 'sants', true); assert false, 'bad session accepted';
  exception when check_violation then null; end;
  assert ((public.public_counts())->'night'->>'going')::int = 1, 'night count';
  -- erase
  r := public.erase_email('frankie@example.com');
  assert (r->>'signups_deleted')::int = 2, 'erased both cities';
  raise notice 'DAY ZERO: ALL CHECKS PASSED';
end $$;

-- the public (anon) role can't touch any of it
reset role;
set role anon;
do $$ begin
  begin perform public.public_counts(); raise exception 'anon could call public_counts';
  exception when insufficient_privilege then null; end;
  begin perform public.join_waitlist('amsterdam', 'X', 'x@example.com'); raise exception 'anon could join';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.signups; raise exception 'anon could read signups';
  exception when insufficient_privilege then null; end;
  raise notice 'DAY ZERO: ANON LOCKED OUT';
end $$;
reset role;
