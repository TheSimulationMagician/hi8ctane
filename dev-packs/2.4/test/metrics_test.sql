-- Checks the month-1 views against the Saturday replayed in plan_b_test.sql.
\set ON_ERROR_STOP 1
\o /dev/null
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'CHECK FAILED: %', label; end if; end $$;
select pg_temp.ok((select crews_posted = 5 and crews_rode = 1 and called_go = 2 and called_off = 1 and merged = 1 from metrics.weekly where week = '2026-10-26'), 'crews: 5 posted, 1 rode, 2 go, 1 off, 1 merged');
select pg_temp.ok((select rider_sessions = 3 and checkin_rate_pct = 27 and no_show_rate_pct = 9 and late_rate_pct = 9 from metrics.weekly where week = '2026-10-26'), 'check-ins 3 of 11 committed, 1 no-show, 1 late');
select pg_temp.ok((select cancels_late = 1 and waitlisted = 2 and promoted_from_waitlist = 1 and seat_found_pct = 78 from metrics.weekly where week = '2026-10-26'), 'late cancel, waitlist, seats found 7 of 9');
select pg_temp.ok((select cars_offered = 4 and seats_offered = 9 and driver_drops = 1 from metrics.weekly where week = '2026-10-26'), 'cars: 4 offered, 9 seats, 1 driver drop');
select pg_temp.ok((select shared_eur = 22.32 and settled_eur = 4.08 and fee_at_50c_eur = 3.00 from metrics.weekly where week = '2026-10-26'), 'money: 22.32 shared, 4.08 settled, 50c fee = 3.00');
select pg_temp.ok((select new_riders = 3 and back_within_14d = 0 from metrics.retention where cohort_week = '2026-10-26'), 'retention cohort: 3 new riders');
select pg_temp.ok((select joined_a_crew = 17 and checked_in_once = 3 from metrics.funnel), 'funnel: 17 joined, 3 checked in');
\o
\echo METRICS: ALL CHECKS PASSED
