-- Plan B end-to-end test: one Saturday (31 Oct 2026, Amsterdam time) replayed with a fake clock.
-- Run with test/run.sh. Every check raises an error on failure; the last line prints PLAN B: ALL CHECKS PASSED.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;
\o /dev/null

-- helpers: users are md5(name)::uuid; act(name) switches the API user; ok() asserts
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'CHECK FAILED: %', label; end if; end $$;
create function pg_temp.u(n text) returns uuid language sql immutable as $$ select md5(n)::uuid $$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$ select v from ids where ids.k = $1 $$;

-- riders
insert into auth.users (id, email)
  select pg_temp.u(n), n || '@example.test' from unnest(array['frankie','marta','joost','sam','lena','tim','kim','noor','bo','ana','solo','eve','dee','pia','quin','ray','sol']) n;
insert into profiles (id, rider_name, is_adult, is_guest)
  select pg_temp.u(n), initcap(n), true, false from unnest(array['frankie','marta','joost','sam','lena','tim','kim','noor','bo','ana','solo','eve','dee','pia','quin','ray','sol']) n;
\i seed_spots.sql
update planb.settings set test_clock = true;

-- forecast (KNMI seamless) for the afternoon: Wijk aan Zee 21 kt SW, Zandvoort 12 kt, IJmuiden 18 kt
insert into forecast_hours (spot_id, valid_at, model, wind_kts, gust_kts, dir_deg)
  select s.id, g, 'knmi_seamless',
         case s.slug when 'wijk-aan-zee' then 21 when 'zandvoort' then 12 else 18 end,
         case s.slug when 'wijk-aan-zee' then 27 when 'zandvoort' then 15 else 22 end, 225
  from spots s, generate_series(timestamptz '2026-10-31 10:00+01', timestamptz '2026-10-31 19:00+01', interval '1 hour') g
  where s.slug <> 'schoorl';

-- ── 1. The rules: call and cut-off times ─────────────────────────────────────────────────────
select pg_temp.ok((select call_at = '2026-10-31 11:00+01' and cutoff_at = '2026-10-31 12:00+01' from plan_b_times('2026-10-31 14:00+01')), 'afternoon: call 3 h, cut-off 2 h before');
select pg_temp.ok((select call_at = '2026-10-31 20:00+01' and cutoff_at = '2026-10-31 21:00+01' from plan_b_times('2026-11-01 08:30+01')), 'morning: call 20:00, cut-off 21:00 the evening before');
select pg_temp.ok((select call_at = '2026-10-24 20:00+02' from plan_b_times('2026-10-25 08:30+01')), 'clocks go back: call still 20:00 local (summer time)');
select pg_temp.ok((select cutoff_at = '2026-10-31 11:00+01' from plan_b_times('2026-10-31 14:00+01', 3)), 'cancel 3 h before');

-- ── 2. 09:00 · crews, cars, riders ───────────────────────────────────────────────────────────
set hi8.now = '2026-10-31 09:00+01';
select set_config('request.jwt.claim.sub', pg_temp.u('frankie')::text, false); set role authenticated;
insert into ids select 'A', start_crew('kite', (select id from spots where slug = 'wijk-aan-zee'), '2026-10-31 14:00+01', 'meet');
select set_config('request.jwt.claim.sub', pg_temp.u('solo')::text, false);
insert into ids select 'B', start_crew('kite', (select id from spots where slug = 'ijmuiden'), '2026-10-31 14:30+01', 'meet');
select set_config('request.jwt.claim.sub', pg_temp.u('dee')::text, false);
insert into ids select 'D', start_crew('kite', (select id from spots where slug = 'zandvoort'), '2026-10-31 15:00+01', 'meet', p_merge_if_alone => false);
select set_config('request.jwt.claim.sub', pg_temp.u('eve')::text, false);
insert into ids select 'C', start_crew('surf', (select id from spots where slug = 'zandvoort'), '2026-11-01 08:30+01', 'meet');
select set_config('request.jwt.claim.sub', pg_temp.u('quin')::text, false);
insert into ids select 'E', start_crew('wing', (select id from spots where slug = 'ijmuiden'), '2026-10-31 15:00+01', 'meet', p_merge_if_alone => false);
insert into ids select 'carQ', offer_car(pg_temp.id('E'), '2026-10-31 13:30+01', 'Haarlem station', 1, 30, 0);
select set_config('request.jwt.claim.sub', pg_temp.u('pia')::text, false);
insert into ids select 'carP', offer_car(pg_temp.id('E'), '2026-10-31 13:15+01', 'A''dam Zuid', 2, 70, 6);
select set_config('request.jwt.claim.sub', pg_temp.u('ray')::text, false);
select join_crew(pg_temp.id('E'), 'need', pg_temp.id('carP'));
select set_config('request.jwt.claim.sub', pg_temp.u('sol')::text, false);
select join_crew(pg_temp.id('E'), 'need', pg_temp.id('carP'));

select set_config('request.jwt.claim.sub', pg_temp.u('marta')::text, false);
insert into ids select 'carM', offer_car(pg_temp.id('A'), '2026-10-31 12:15+01', 'Sloterdijk P+R', 3, 64, 8);
select set_config('request.jwt.claim.sub', pg_temp.u('joost')::text, false);
insert into ids select 'carJ', offer_car(pg_temp.id('A'), '2026-10-31 12:40+01', 'Haarlem station', 2, 42, 8);
select set_config('request.jwt.claim.sub', pg_temp.u('sam')::text, false);
select join_crew(pg_temp.id('A'), 'need', pg_temp.id('carM'));
select set_config('request.jwt.claim.sub', pg_temp.u('lena')::text, false);
select join_crew(pg_temp.id('A'), 'need', pg_temp.id('carM'));
select set_config('request.jwt.claim.sub', pg_temp.u('tim')::text, false);
select join_crew(pg_temp.id('A'), 'need', pg_temp.id('carM'));
select set_config('request.jwt.claim.sub', pg_temp.u('noor')::text, false);
select join_crew(pg_temp.id('A'), 'need', pg_temp.id('carJ'));
select set_config('request.jwt.claim.sub', pg_temp.u('kim')::text, false);
create temp table r_kim as select join_crew(pg_temp.id('A'), 'need', pg_temp.id('carM')) as s;  -- Marta full: Joost has 1 seat
reset role;

select pg_temp.ok((select s = 'in' from r_kim), 'Kim joins: Marta is full so she gets Joost''s last seat');
select pg_temp.ok((select car_id = pg_temp.id('carJ') from crew_members where profile_id = pg_temp.u('kim')), 'Kim sits in Joost''s car');
select pg_temp.ok((select seats_left = 0 from crew_seats where crew_id = pg_temp.id('A')), 'crew A has no seats left');
select pg_temp.ok((select each_eur = 4.08 and trip_cost_eur = 16.32 from car_seats where car_id = pg_temp.id('carM')), 'Marta''s car: 64 km x 0.13 + 8 parking = 16.32, 4.08 each');
select pg_temp.ok((select call_at = '2026-10-31 20:00+01' from crews where id = pg_temp.id('C')), 'early surf crew gets the evening call');

-- Kim moves back to the waitlist for Marta's car? No: a new rider, Ana, arrives later. First Bo joins: no seats, waitlist.
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.u('bo')::text, false);
create temp table r_bo as select join_crew(pg_temp.id('A'), 'need') as s;
reset role;
select pg_temp.ok((select s = 'waitlist' from r_bo), 'Bo: no free seat, waitlist #1');

-- ── 3. 10:30 · Lena can't go (before the 12:00 cut-off): free, Bo gets her seat automatically ──
set hi8.now = '2026-10-31 10:30+01';
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.u('lena')::text, false);
create temp table r_lena as select cancel_booking(pg_temp.id('A')) as j;
reset role;
select pg_temp.ok((select (j->>'free')::boolean and (j->>'owes_eur')::numeric = 0 from r_lena), 'Lena cancels free before the cut-off');
select pg_temp.ok((select booking = 'in' and car_id = pg_temp.id('carM') and promoted_at is not null from crew_members where profile_id = pg_temp.u('bo') and crew_id = pg_temp.id('A')), 'Bo promoted into Marta''s car');
select pg_temp.ok((select count(*) = 1 from notifications where profile_id = pg_temp.u('bo') and kind = 'promoted'), 'Bo is told he has a seat');
select pg_temp.ok((select count(*) = 1 from notifications where profile_id = pg_temp.u('marta') and kind = 'seat_refilled'), 'Marta is told the seat is refilled');
select pg_temp.ok((select each_eur = 4.08 from car_seats where car_id = pg_temp.id('carM')), 'split unchanged: still 4.08');

-- ── 4. 11:00 · the call for crew A (forecast 21 kt SW): GO ──────────────────────────────────
set hi8.now = '2026-10-31 11:00+01';
select plan_b_tick();
select pg_temp.ok((select call = 'go' and status = 'on' and called_by is null from crews where id = pg_temp.id('A')), 'crew A called GO by the forecast');
select pg_temp.ok((select count(*) = 8 from notifications where crew_id = pg_temp.id('A') and kind = 'call_go'), 'all 8 riders and drivers in crew A hear IT''S ON');

-- ── 5. 11:30 · crew B (Solo alone at IJmuiden 14:30) merges into crew A ──────────────────────
set hi8.now = '2026-10-31 11:30+01';
select plan_b_tick();
select pg_temp.ok((select merged_into = pg_temp.id('A') and status = 'off' from crews where id = pg_temp.id('B')), 'lonely crew B merged into A (same sport, 4 km, 30 min apart)');
select pg_temp.ok((select booking = 'in' from crew_members where crew_id = pg_temp.id('A') and profile_id = pg_temp.u('solo')), 'Solo is now in crew A');

-- ── 6. 11:40 · Sam is running 8 min late: covered by the 10 min wait ────────────────────────
set hi8.now = '2026-10-31 11:40+01';
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.u('sam')::text, false);
create temp table r_sam as select running_late(pg_temp.id('A'), 8) as j;
create temp table r_sam2 as select running_late(pg_temp.id('A'), 25) as j;   -- what "MORE" would say
reset role;
select pg_temp.ok((select j->>'state' = 'covered' and (j->>'wait_until')::timestamptz = '2026-10-31 12:23+01' from r_sam), 'Sam late 8 min: Marta waits till 12:23');
select pg_temp.ok((select j->>'state' = 'too_late' and jsonb_array_length(j->'alternatives') = 0 from r_sam2), '25 min late: beyond the wait, no free seat in another car');
select pg_temp.ok((select count(*) = 1 from notifications where profile_id = pg_temp.u('marta') and kind = 'late'), 'Marta sees Sam''s ETA');

-- ── 7. 12:00 · cut-off: splits freeze; crews D (12 kt) and E (18 kt wing) get their call ────
set hi8.now = '2026-10-31 12:00+01';
select plan_b_tick();
select pg_temp.ok((select bool_and(share_eur = 4.08) from crew_members where car_id = pg_temp.id('carM') and ride = 'need'), 'Marta''s riders frozen at 4.08');
select pg_temp.ok((select share_eur = 4.48 from crew_members where profile_id = pg_temp.u('noor') and crew_id = pg_temp.id('A')), 'Joost''s car frozen: 42 km x 0.13 + 8 = 13.46, 3 people, 4.48 each');
select pg_temp.ok((select call = 'off' and call_reason like '12 kt%' from crews where id = pg_temp.id('D')), 'crew D called off: 12 kt is too light');
select pg_temp.ok((select call = 'go' from crews where id = pg_temp.id('E')), 'wing crew E called GO at 18 kt');

-- ── 8. 12:05 · Tim cancels after the cut-off: he owes 4.08 unless someone takes the seat ─────
set hi8.now = '2026-10-31 12:05+01';
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.u('tim')::text, false);
create temp table r_tim as select cancel_booking(pg_temp.id('A')) as j;
reset role;
select pg_temp.ok((select not (j->>'free')::boolean and (j->>'owes_eur')::numeric = 4.08 from r_tim), 'Tim cancels late: owes 4.08');

-- 12:06 · Ana joins and takes Tim's seat: Tim is off the hook, Ana pays 4.08
set hi8.now = '2026-10-31 12:06+01';
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.u('ana')::text, false);
select join_crew(pg_temp.id('A'), 'need');
reset role;
select pg_temp.ok((select car_id = pg_temp.id('carM') and share_eur = 4.08 from crew_members where profile_id = pg_temp.u('ana')), 'Ana takes Tim''s seat at 4.08');
select pg_temp.ok((select refilled_by = pg_temp.u('ana') from seat_debts where profile_id = pg_temp.u('tim')), 'Tim''s debt cleared by the refill');
select pg_temp.ok((select cancel_free from crew_members where profile_id = pg_temp.u('tim') and crew_id = pg_temp.id('A')), 'Tim''s cancel now counts as free');

-- 12:07 · Joost raises his seats to 3 and Lena comes back: a new seat after the freeze lowers everyone's share
set hi8.now = '2026-10-31 12:07+01';
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.u('joost')::text, false);
select offer_car(pg_temp.id('A'), '2026-10-31 12:40+01', 'Haarlem station', 3, 42, 8);
select set_config('request.jwt.claim.sub', pg_temp.u('lena')::text, false);
select join_crew(pg_temp.id('A'), 'need', pg_temp.id('carJ'));
reset role;
select pg_temp.ok((select share_eur = 3.36 from crew_members where profile_id = pg_temp.u('noor') and crew_id = pg_temp.id('A')), 'Noor''s share goes down: 13.46 / 4 = 3.36');
select pg_temp.ok((select share_eur = 3.36 from crew_members where profile_id = pg_temp.u('lena') and crew_id = pg_temp.id('A')), 'Lena pays the new lower share');
select pg_temp.ok((select sum(share_eur) <= 13.46 from split_shares(pg_temp.id('carJ'))), 'never more than the trip cost');

-- ── 9. Pickup 12:15 · Sam checks in; Marta must wait the max before marking Bo a no-show ─────
set hi8.now = '2026-10-31 12:20+01';
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.u('sam')::text, false);
select check_in(pg_temp.id('A'));
select set_config('request.jwt.claim.sub', pg_temp.u('marta')::text, false);
do $$ begin perform mark_no_show((select v from ids where k = 'A'), md5('bo')::uuid); raise exception 'no error';
exception when others then if sqlerrm <> 'still_waiting' then raise exception 'expected still_waiting, got %', sqlerrm; end if; end $$;
set hi8.now = '2026-10-31 12:26+01';
select mark_no_show(pg_temp.id('A'), pg_temp.u('bo'));
select check_in(pg_temp.id('A'), pg_temp.u('ana'));                           -- Marta vouches for Ana
select set_config('request.jwt.claim.sub', pg_temp.u('joost')::text, false);
set hi8.now = '2026-10-31 12:45+01';
select check_in(pg_temp.id('A'), pg_temp.u('noor'));
reset role;
select pg_temp.ok((select booking = 'no_show' and share_eur = 4.08 from crew_members where profile_id = pg_temp.u('bo') and crew_id = pg_temp.id('A')), 'Bo: no-show, still owes 4.08');
select pg_temp.ok((select points = -30 from reliability_events where profile_id = pg_temp.u('bo') and kind = 'no_show'), 'Bo loses 30 points');

-- ── 10. Crew E, 12:30 · Pia can't drive after the call: Ray moves to Quin, Sol waits ────────
set hi8.now = '2026-10-31 12:30+01';
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.u('pia')::text, false);
create temp table r_pia as select driver_cant_drive(pg_temp.id('E')) as j;
reset role;
select pg_temp.ok((select (j->>'moved')::int = 1 and (j->>'waitlist')::int = 1 from r_pia), 'one rider moved, one on the waitlist');
select pg_temp.ok((select car_id = pg_temp.id('carQ') from crew_members where profile_id = pg_temp.u('ray')), 'Ray moved to Quin''s car');
select pg_temp.ok((select booking = 'waitlist' from crew_members where profile_id = pg_temp.u('sol')), 'Sol on the waitlist (front of the queue)');
select pg_temp.ok((select points = -20 from reliability_events where profile_id = pg_temp.u('pia')), 'Pia dropped after the call: -20');

-- ── 11. Security: riders can't edit state, hosts can't fake a call, outsiders see nothing ────
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.u('sam')::text, false);
do $$ begin update crew_members set booking = 'here' where profile_id = md5('sam')::uuid; raise exception 'no error';
exception when insufficient_privilege then null; end $$;
do $$ begin insert into crew_members (crew_id, profile_id, ride) values ((select v from ids where k = 'C'), md5('sam')::uuid, 'need'); raise exception 'no error';
exception when insufficient_privilege then null; end $$;
do $$ begin perform plan_b_tick(); raise exception 'no error';
exception when insufficient_privilege then null; end $$;
select pg_temp.ok((select count(*) = 0 from notifications where profile_id <> md5('sam')::uuid), 'Sam only sees his own notifications');
select pg_temp.ok((select count(*) = 0 from seat_debts), 'Sam can''t see Tim''s debt');
update crew_members set one_way = true where crew_id = pg_temp.id('A') and profile_id = pg_temp.u('sam');   -- allowed
update crew_members set one_way = false where crew_id = pg_temp.id('A') and profile_id = pg_temp.u('sam');
select set_config('request.jwt.claim.sub', pg_temp.u('frankie')::text, false);
do $$ begin update crews set call = 'off' where host_id = md5('frankie')::uuid; raise exception 'no error';
exception when insufficient_privilege then null; end $$;
update crews set notes = 'Pink flag north of the lifeguard post' where id = pg_temp.id('A');
select set_config('request.jwt.claim.sub', pg_temp.u('marta')::text, false);
select pg_temp.ok((select count(*) = 1 from seat_debts), 'Marta (the driver) sees the debt on her car');
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin perform 1 from cars; raise exception 'no error';
exception when insufficient_privilege then null; end $$;
reset role;

-- ── 12. 18:00 · session closes: points and pay-after ────────────────────────────────────────
set hi8.now = '2026-10-31 18:00+01';
select plan_b_tick();
select pg_temp.ok((select status = 'done' from crews where id = pg_temp.id('A')), 'crew A closed');
select pg_temp.ok((select points = 15 from reliability_events where profile_id = pg_temp.u('sam') and kind = 'showed_up'), 'Sam +15 for showing up');
select pg_temp.ok((select points = 10 from reliability_events where profile_id = pg_temp.u('marta') and kind = 'drove'), 'Marta +10 for driving');
select pg_temp.ok((select count(*) = 0 from reliability_events where profile_id = pg_temp.u('tim')), 'Tim: refilled, no penalty');
select pg_temp.ok((select count(*) = 0 from reliability_events where profile_id = pg_temp.u('lena') and kind = 'showed_up'), 'Lena never checked in: no points');
select pg_temp.ok((select (payload->>'share_eur')::numeric = 4.08 from notifications where profile_id = pg_temp.u('bo') and kind = 'pay_after'), 'Bo is asked for his 4.08');
select pg_temp.ok((select count(*) = 0 from notifications where profile_id = pg_temp.u('tim') and kind = 'pay_after'), 'Tim owes nothing');
select pg_temp.ok((select points from reliability where profile_id = pg_temp.u('bo')) = -30, 'reliability view sums points');
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.u('marta')::text, false);
select mark_paid(pg_temp.id('A'), pg_temp.u('sam'));
reset role;
select pg_temp.ok((select paid_at is not null from crew_members where profile_id = pg_temp.u('sam') and crew_id = pg_temp.id('A')), 'Marta ticks Sam paid');

-- ── 13. Called off = nobody pays ───────────────────────────────────────────────────────────
select pg_temp.ok((select bool_and(booking = 'called_off') from crew_members where crew_id = pg_temp.id('D')), 'crew D: everyone called off');
select pg_temp.ok((select count(*) = 0 from notifications where crew_id = pg_temp.id('D') and kind = 'pay_after'), 'crew D: nobody pays');

\o
\echo PLAN B: ALL CHECKS PASSED
