-- Hi8ctane 2.4 · month-1 metrics, computed from the database (no tracking needed).
-- Run after schema.sql. Views live in their own schema, not exposed through the API:
-- read them with the service role (a small admin page) or straight in the Supabase SQL editor.
-- Weeks are Monday-Sunday, Amsterdam time. Definitions: analytics/EVENTS.md.

create schema if not exists metrics;
revoke all on schema metrics from public, anon, authenticated;

-- One row per crew with what happened to it.
create view metrics.crew_outcomes as
select v.id as crew_id, v.sport, s.name as spot,
       date_trunc('week', v.starts_at at time zone 'Europe/Amsterdam')::date as week,
       v.starts_at, v.status, v.call, v.called_by is null and v.call is not null as call_by_system,
       v.merged_into is not null as merged,
       (select min(m.joined_at) from crew_members m where m.crew_id = v.id and m.profile_id <> v.host_id) - v.created_at as time_to_first_join,
       count(m.*) filter (where m.booking not in ('waitlist')
                            and not (m.booking = 'cancelled' and m.cancelled_at < v.cutoff_at)
                            and m.booking <> 'called_off') as committed,      -- still in at the cut-off
       count(m.*) filter (where m.checked_in_at is not null) as checked_in,
       count(m.*) filter (where m.booking = 'no_show') as no_shows,
       count(m.*) filter (where m.booking = 'cancelled' and m.cancelled_at < v.cutoff_at) as cancels_free,
       count(m.*) filter (where m.booking = 'cancelled' and m.cancelled_at >= v.cutoff_at) as cancels_late,
       count(m.*) filter (where m.late_min is not null) as ran_late,
       count(m.*) filter (where m.waitlisted_at is not null) as waitlisted,
       count(m.*) filter (where m.promoted_at is not null) as promoted,
       count(m.*) filter (where m.ride = 'need') as needed_seat,
       count(m.*) filter (where m.ride = 'need' and (m.car_id is not null or m.booking = 'no_show')) as got_seat
from crews v
join spots s on s.id = v.spot_id
left join crew_members m on m.crew_id = v.id
group by v.id, s.name;

-- The weekly scorecard. "Rode" = closed crew with 2+ people checked in.
create view metrics.weekly as
with c as (select * from metrics.crew_outcomes),
cars_w as (
  select date_trunc('week', v.starts_at at time zone 'Europe/Amsterdam')::date as week,
         count(*) as cars_offered,
         count(*) filter (where k.status = 'cancelled' and v.call is distinct from 'off' and v.merged_into is null) as driver_drops,
         sum(k.seats) as seats_offered
  from cars k join crews v on v.id = k.crew_id group by 1),
money as (
  select date_trunc('week', v.starts_at at time zone 'Europe/Amsterdam')::date as week,
         sum(x.amt) as shared_eur, sum(x.amt) filter (where x.paid) as settled_eur, count(*) as paid_seats
  from (select m.crew_id, m.share_eur as amt, m.paid_at is not null as paid from crew_members m
        where m.ride = 'need' and coalesce(m.share_eur, 0) > 0 and m.booking in ('done','here','in','late','no_show')
        union all
        select d.crew_id, d.amount_eur, d.paid_at is not null from seat_debts d where d.refilled_by is null) x
  join crews v on v.id = x.crew_id where v.status = 'done' group by 1)
select c.week,
       count(*) as crews_posted,
       count(*) filter (where c.status = 'done' and c.checked_in >= 2) as crews_rode,
       count(*) filter (where c.call = 'go') as called_go,
       count(*) filter (where c.call = 'off' and not c.merged) as called_off,
       count(*) filter (where c.merged) as merged,
       sum(c.checked_in) as rider_sessions,
       round(100.0 * sum(c.checked_in) filter (where c.status = 'done') / nullif(sum(c.committed) filter (where c.status = 'done'), 0)) as checkin_rate_pct,
       round(100.0 * sum(c.no_shows) / nullif(sum(c.committed) filter (where c.status = 'done'), 0)) as no_show_rate_pct,
       round(100.0 * sum(c.ran_late) / nullif(sum(c.committed) filter (where c.status = 'done'), 0)) as late_rate_pct,
       sum(c.cancels_free) as cancels_free, sum(c.cancels_late) as cancels_late,
       sum(c.waitlisted) as waitlisted, sum(c.promoted) as promoted_from_waitlist,
       round(100.0 * sum(c.got_seat) / nullif(sum(c.needed_seat), 0)) as seat_found_pct,
       round(100.0 * count(*) filter (where c.status = 'done' and c.committed >= 3) / nullif(count(*) filter (where c.status = 'done'), 0)) as crews_3plus_pct,
       percentile_cont(0.5) within group (order by extract(epoch from c.time_to_first_join) / 60) as median_min_to_first_join,
       w.cars_offered, w.seats_offered, w.driver_drops,
       m.shared_eur, m.settled_eur,
       round(0.50 * coalesce(m.paid_seats, 0), 2) as fee_at_50c_eur      -- what a 50-cent fee per paid seat would have made
from c
left join cars_w w on w.week = c.week
left join money m on m.week = c.week
group by c.week, w.cars_offered, w.seats_offered, w.driver_drops, m.shared_eur, m.settled_eur, m.paid_seats
order by c.week desc;

-- Retention: of riders whose first check-in was in a given week, how many checked in again within 14 / 30 days.
create view metrics.retention as
with s as (
  select m.profile_id, m.checked_in_at as at from crew_members m where m.checked_in_at is not null),
f as (select profile_id, min(at) as first_at from s group by profile_id)
select date_trunc('week', f.first_at at time zone 'Europe/Amsterdam')::date as cohort_week,
       count(*) as new_riders,
       count(*) filter (where exists (select 1 from s where s.profile_id = f.profile_id and s.at > f.first_at + interval '1 hour'
                                      and s.at <= f.first_at + interval '14 days')) as back_within_14d,
       count(*) filter (where exists (select 1 from s where s.profile_id = f.profile_id and s.at > f.first_at + interval '1 hour'
                                      and s.at <= f.first_at + interval '30 days')) as back_within_30d
from f group by 1 order by 1 desc;

-- Lifetime funnel from the database side (link opens and taps come from analytics events).
create view metrics.funnel as
select (select count(*) from profiles) as riders_signed_up,
       (select count(*) from profiles where is_guest) as still_guests,
       (select count(distinct profile_id) from crew_members) as joined_a_crew,
       (select count(distinct profile_id) from crew_members where checked_in_at is not null) as checked_in_once,
       (select count(*) from (select profile_id from crew_members where checked_in_at is not null
                              group by profile_id having count(*) >= 2) x) as checked_in_twice,
       (select count(distinct host_id) from crews) as hosted_a_crew,
       (select count(distinct driver_id) from cars) as offered_a_car;

-- Riders to call personally this week (concierge ops): repeat no-shows and people stuck on a waitlist.
create view metrics.follow_up as
select p.rider_name, r.no_shows_60d, r.points,
       (select count(*) from crew_members m where m.profile_id = p.id and m.booking = 'waitlist') as waiting_now
from profiles p join reliability r on r.profile_id = p.id
where r.no_shows_60d >= 1
   or exists (select 1 from crew_members m join crews v on v.id = m.crew_id
              where m.profile_id = p.id and m.booking = 'waitlist' and v.starts_at > now())
order by r.no_shows_60d desc;

grant usage on schema metrics to service_role;
grant select on all tables in schema metrics to service_role;
