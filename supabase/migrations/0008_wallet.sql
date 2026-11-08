-- Hi8ctane 0008: the wallet and the Hi8 Pass (2.10).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0007. Safe to run again.
--
-- Riders top up a wallet (€10, €20 or €50 by iDEAL, Bizum, Bancontact or card, through Stripe) and pay their
-- seat from it, so a €4 seat doesn't pay a card fee of its own. The seat money is held until the crew has
-- ridden, then it goes to the driver's wallet; called off, left, or moved to another car = straight back.
-- Drivers withdraw to their bank through Stripe. The Hi8 Pass (€3.99 a month or €39 a year, by SEPA direct
-- debit or card) waives the Hi8 fee on every seat.
--
-- Nothing is charged until you switch it on, after the Stripe keys are in (see site/README.md):
--   update public.app_settings set value = 'true' where key = 'payments_live';
-- Money is in cents everywhere. The wallet holds at most €100.

-- ---------------------------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('payments_live',    'false'),
  ('fee_min_cents',    '49'),
  ('pass_month_cents', '399'),
  ('pass_year_cents',  '3900'),
  ('topup_cents',      '[1000, 2000, 5000]'),
  ('wallet_max_cents', '10000')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------------------------
-- every euro in and out of a wallet, one row each: the balance is the sum
create table if not exists public.wallet_ledger (
  id          bigint generated always as identity primary key,
  email       text not null,
  kind        text not null check (kind in ('topup', 'seat', 'refund', 'earning', 'payout', 'adjust')),
  cents       int not null,
  crew_id     uuid,
  ref         text unique,                       -- Stripe's id for top-ups and payouts: never counted twice
  note        text check (note is null or char_length(note) <= 140),
  created_at  timestamptz not null default now()
);
create index if not exists wallet_ledger_email on public.wallet_ledger (email, created_at desc);

-- a seat paid from the wallet: held until the crew has ridden
create table if not exists public.seat_payments (
  id           bigint generated always as identity primary key,
  crew_id      uuid not null references public.crews (id) on delete cascade,
  rider_email  text not null,
  driver_email text not null,
  share_cents  int not null check (share_cents >= 0),
  fee_cents    int not null default 0 check (fee_cents >= 0),
  waived       text check (waived in ('pass', 'pilot')),
  status       text not null default 'held' check (status in ('held', 'released', 'refunded')),
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create unique index if not exists seat_payments_once on public.seat_payments (crew_id, rider_email) where status <> 'refunded';

create table if not exists public.passes (
  email        text primary key,
  plan         text not null check (plan in ('month', 'year')),
  status       text not null,                    -- Stripe's subscription status: active, trialing, past_due, canceled…
  until        timestamptz,
  stripe_sub   text,
  stripe_cus   text,
  updated_at   timestamptz not null default now()
);

-- drivers' Stripe accounts for payouts (Stripe keeps their bank details, never us)
create table if not exists public.payout_accounts (
  email        text primary key,
  stripe_acct  text not null,
  ready        boolean not null default false,
  updated_at   timestamptz not null default now()
);

alter table public.wallet_ledger enable row level security;
alter table public.seat_payments enable row level security;
alter table public.passes enable row level security;
alter table public.payout_accounts enable row level security;
revoke all on public.wallet_ledger, public.seat_payments, public.passes, public.payout_accounts from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default);
$$;
create or replace function public.hi8_payments_live() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from public.app_settings where key = 'payments_live'), false);
$$;
create or replace function public.hi8_balance(p_email text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cents), 0)::int from public.wallet_ledger where email = lower(p_email);
$$;
create or replace function public.hi8_has_pass(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.passes where email = lower(p_email) and status in ('active', 'trialing') and (until is null or until > now()));
$$;

-- what a rider's seat costs now: the share of the driver's car, plus the Hi8 fee unless waived
create or replace function public.hi8_seat_price(p_crew uuid, p_email text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.crew_members; d public.crew_members; n int; share int; fee int := 0; waived text := null; pct numeric;
begin
  select * into m from public.crew_members where crew_id = p_crew and lower(email) = lower(p_email);
  if m.member_id is null or m.car_with is null then return null; end if;
  select * into d from public.crew_members where crew_id = p_crew and member_id = m.car_with;
  if d.member_id is null or d.trip_cost is null then return null; end if;
  select count(*) into n from public.crew_members where crew_id = p_crew and car_with = d.member_id;
  share := round(d.trip_cost * 100 / (n + 1));
  pct := coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'ride_fee_pct'), 15);
  if public.hi8_has_pass(p_email) then waived := 'pass';
  elsif coalesce((select value = 'true'::jsonb from public.app_settings where key = 'fee_live'), false) then
    fee := greatest(round(share * pct / 100), public.hi8_int('fee_min_cents', 49));
  else waived := 'pilot';
  end if;
  return jsonb_build_object('share_cents', share, 'fee_cents', fee, 'total_cents', share + fee, 'waived', waived, 'driver', d.email);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. What riders call
-- ---------------------------------------------------------------------------------------------
-- hi8_wallet: your balance, your Pass, what's held, the last moves
create or replace function public.hi8_wallet(p_key uuid) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); ps public.passes;
begin
  select * into ps from public.passes where email = em;
  return json_build_object(
    'live', public.hi8_payments_live(),
    'balance_cents', public.hi8_balance(em),
    'max_cents', public.hi8_int('wallet_max_cents', 10000),
    'topups', coalesce((select value from public.app_settings where key = 'topup_cents'), '[1000, 2000, 5000]'::jsonb),
    'pass', case when ps.email is null then null else json_build_object('plan', ps.plan, 'status', ps.status, 'until', ps.until, 'active', public.hi8_has_pass(em)) end,
    'pass_month_cents', public.hi8_int('pass_month_cents', 399), 'pass_year_cents', public.hi8_int('pass_year_cents', 3900),
    'held_cents', (select coalesce(sum(share_cents + fee_cents), 0) from public.seat_payments where rider_email = em and status = 'held'),
    'pending_cents', (select coalesce(sum(share_cents), 0) from public.seat_payments where driver_email = em and status = 'held'),
    'payout_ready', coalesce((select ready from public.payout_accounts where email = em), false),
    'seats', (select coalesce(json_agg(json_build_object('code', c.code, 'status', sp.status, 'cents', sp.share_cents + sp.fee_cents)), '[]'::json)
              from public.seat_payments sp join public.crews c on c.id = sp.crew_id where sp.rider_email = em and sp.status = 'held'),
    'ledger', (select coalesce(json_agg(json_build_object('at', l.created_at, 'kind', l.kind, 'cents', l.cents, 'note', l.note) order by l.created_at desc), '[]'::json)
               from (select * from public.wallet_ledger where email = em order by created_at desc limit 20) l));
end $$;

-- hi8_pay_seat: pay your seat in the driver's car from your wallet; held until the crew has ridden
create or replace function public.hi8_pay_seat(p_key uuid, p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; pr jsonb; bal int;
begin
  if not public.hi8_payments_live() then raise exception 'payments_off' using errcode = '22023', hint = 'Paying in the app opens soon. Pay the driver directly for now.'; end if;
  select * into c from public.crews where code = upper(p_code);
  if c.id is null then raise exception 'no_crew' using errcode = '22023'; end if;
  if c.status <> 'on' or c.day < public.hi8_today(c.city) then raise exception 'crew_past' using errcode = '22023', hint = 'This crew is over or called off.'; end if;
  pr := public.hi8_seat_price(c.id, em);
  if pr is null then raise exception 'not_ready' using errcode = '22023', hint = 'Your driver hasn''t added what the car costs yet.'; end if;
  if exists (select 1 from public.seat_payments where crew_id = c.id and rider_email = em and status <> 'refunded') then
    raise exception 'already_paid' using errcode = '22023', hint = 'Your seat is already paid.';
  end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || em));
  bal := public.hi8_balance(em);
  if bal < (pr->>'total_cents')::int then
    raise exception 'no_funds' using errcode = '22023', detail = ((pr->>'total_cents')::int - bal)::text, hint = 'Top up your wallet first.';
  end if;
  insert into public.wallet_ledger (email, kind, cents, crew_id, note)
    values (em, 'seat', -(pr->>'total_cents')::int, c.id, left('Seat · ' || public.hi8_crew_line(c), 140));
  insert into public.seat_payments (crew_id, rider_email, driver_email, share_cents, fee_cents, waived)
    values (c.id, em, lower(pr->>'driver'), (pr->>'share_cents')::int, (pr->>'fee_cents')::int, pr->>'waived');
  update public.crew_members set paid_at = now() where crew_id = c.id and lower(email) = em;
  return public.hi8_crew(c.code, p_key);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Settling: after the ride the driver is paid; called off, left or moved = money back
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_refund_seat(sp public.seat_payments, p_why text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.seat_payments set status = 'refunded', settled_at = now() where id = sp.id and status = 'held';
  if found then
    insert into public.wallet_ledger (email, kind, cents, crew_id, note) values (sp.rider_email, 'refund', sp.share_cents + sp.fee_cents, sp.crew_id, left(p_why, 140));
    update public.crew_members set paid_at = null where crew_id = sp.crew_id and lower(email) = sp.rider_email;
  end if;
end $$;

-- the day after a crew (or 3 hours after it ends), held seats go to the drivers
create or replace function public.hi8_release_seats() returns int
language plpgsql security definer set search_path = public as $$
declare sp public.seat_payments; n int := 0;
begin
  for sp in select s.* from public.seat_payments s join public.crews c on c.id = s.crew_id
            where s.status = 'held' and c.status = 'on'
              and (c.day + coalesce(c.end_time, c.start_time + interval '3 hours') + interval '3 hours') < public.hi8_city_now(c.city)
            for update of s skip locked loop
    update public.seat_payments set status = 'released', settled_at = now() where id = sp.id;
    insert into public.wallet_ledger (email, kind, cents, crew_id, note)
      values (sp.driver_email, 'earning', sp.share_cents, sp.crew_id, left('Seat in your car · ' || public.hi8_name(sp.rider_email), 140));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.hi8_on_crew_money() returns trigger
language plpgsql security definer set search_path = public as $$
declare sp public.seat_payments;
begin
  if new.status = 'off' and old.status <> 'off' then
    for sp in select * from public.seat_payments where crew_id = new.id and status = 'held' loop
      perform public.hi8_refund_seat(sp, 'Refund · the crew was called off');
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists hi8_crew_money on public.crews;
create trigger hi8_crew_money after update of status on public.crews for each row execute function public.hi8_on_crew_money();

create or replace function public.hi8_on_member_money() returns trigger
language plpgsql security definer set search_path = public as $$
declare sp public.seat_payments; who text; drv text;
begin
  if tg_op = 'DELETE' then
    for sp in select * from public.seat_payments where crew_id = old.crew_id and status = 'held'
              and (rider_email = lower(old.email) or driver_email = lower(old.email)) loop
      perform public.hi8_refund_seat(sp, case when sp.rider_email = lower(old.email) then 'Refund · you left the crew' else 'Refund · your driver left the crew' end);
    end loop;
    return old;
  end if;
  if new.car_with is distinct from old.car_with then   -- moved to another car, or out of one
    select lower(email) into drv from public.crew_members where member_id = old.car_with;
    for sp in select * from public.seat_payments where crew_id = new.crew_id and status = 'held' and rider_email = lower(new.email) and driver_email = drv loop
      perform public.hi8_refund_seat(sp, 'Refund · you changed cars');
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists hi8_member_money on public.crew_members;
create trigger hi8_member_money after delete or update of car_with on public.crew_members for each row execute function public.hi8_on_member_money();

-- ---------------------------------------------------------------------------------------------
-- 6. What the Stripe functions call (service role only: supabase/functions/stripe-*)
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_key_owner(p_key uuid) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  return json_build_object('email', em, 'balance_cents', public.hi8_balance(em), 'live', public.hi8_payments_live(),
    'max_cents', public.hi8_int('wallet_max_cents', 10000), 'topups', (select value from public.app_settings where key = 'topup_cents'),
    'pass', public.hi8_has_pass(em), 'pass_month_cents', public.hi8_int('pass_month_cents', 399), 'pass_year_cents', public.hi8_int('pass_year_cents', 3900), 'stripe_cus', (select stripe_cus from public.passes where email = em),
    'stripe_acct', (select stripe_acct from public.payout_accounts where email = em), 'payout_ready', coalesce((select ready from public.payout_accounts where email = em), false));
end $$;

-- a paid top-up (Stripe's checkout.session.completed); the same Stripe id twice counts once
create or replace function public.hi8_topup_paid(p_email text, p_cents int, p_ref text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if p_cents <= 0 or p_cents > 10000 then raise exception 'bad_amount' using errcode = '22023'; end if;
  insert into public.wallet_ledger (email, kind, cents, ref, note) values (lower(p_email), 'topup', p_cents, p_ref, 'Top-up')
  on conflict (ref) do nothing;
  return json_build_object('ok', true, 'balance_cents', public.hi8_balance(p_email));
end $$;

create or replace function public.hi8_pass_update(p_email text, p_plan text, p_status text, p_until timestamptz, p_sub text, p_cus text) returns json
language sql security definer set search_path = public as $$
  insert into public.passes (email, plan, status, until, stripe_sub, stripe_cus, updated_at)
  values (lower(p_email), p_plan, p_status, p_until, p_sub, p_cus, now())
  on conflict (email) do update set plan = excluded.plan, status = excluded.status, until = excluded.until,
    stripe_sub = coalesce(excluded.stripe_sub, passes.stripe_sub), stripe_cus = coalesce(excluded.stripe_cus, passes.stripe_cus), updated_at = now()
  returning json_build_object('ok', true, 'active', public.hi8_has_pass(p_email));
$$;

create or replace function public.hi8_payout_account(p_email text, p_acct text, p_ready boolean) returns json
language sql security definer set search_path = public as $$
  insert into public.payout_accounts (email, stripe_acct, ready, updated_at) values (lower(p_email), p_acct, p_ready, now())
  on conflict (email) do update set stripe_acct = excluded.stripe_acct, ready = excluded.ready, updated_at = now()
  returning json_build_object('ok', true, 'ready', ready);
$$;

-- a withdrawal: the whole balance leaves the wallet before the transfer, and comes back if the transfer fails
create or replace function public.hi8_payout_start(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := lower(p_email); bal int; id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('wallet:' || em));
  bal := public.hi8_balance(em);
  if bal < 500 then raise exception 'payout_min' using errcode = '22023', hint = 'You can withdraw from €5.'; end if;
  insert into public.wallet_ledger (email, kind, cents, note) values (em, 'payout', -bal, 'Withdrawn to your bank') returning wallet_ledger.id into id;
  return json_build_object('ledger_id', id, 'cents', bal);
end $$;
create or replace function public.hi8_payout_done(p_ledger bigint, p_ref text, p_ok boolean) returns json
language plpgsql security definer set search_path = public as $$
declare l public.wallet_ledger;
begin
  select * into l from public.wallet_ledger where id = p_ledger and kind = 'payout';
  if l.id is null then raise exception 'no_payout' using errcode = '22023'; end if;
  if p_ok then update public.wallet_ledger set ref = p_ref where id = l.id;
  else insert into public.wallet_ledger (email, kind, cents, note) values (l.email, 'adjust', -l.cents, 'Withdrawal failed: back in your wallet');
  end if;
  return json_build_object('ok', p_ok);
end $$;

-- erase_email (from 0006): wallets are kept for bookkeeping (7 years) but no longer tied to a person
create or replace function public.erase_email(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; em text := lower(trim(p_email)); anon text := 'erased:' || md5(lower(trim(p_email)));
begin
  update public.crews set status = 'off', off_reason = 'The captain left Hi8ctane', host_email = 'erased' where lower(host_email) = em;
  delete from public.crew_members where lower(email) = em; get diagnostics e = row_count;
  update public.crew_messages set email = null, kind = 'edit', body = '(message removed)' where lower(email) = em;
  update public.spot_reports set email = null, note = null where lower(email) = em;
  delete from public.crew_alerts where email = em; get diagnostics h = row_count;
  delete from public.plan_leads where email = em; get diagnostics i = row_count;
  update public.wallet_ledger set email = anon where email = em;
  update public.seat_payments set rider_email = anon where rider_email = em;
  update public.seat_payments set driver_email = anon where driver_email = em;
  delete from public.passes where email = em;
  delete from public.payout_accounts where email = em;
  delete from public.city_requests where lower(email) = em; get diagnostics f = row_count;
  delete from public.signups where lower(email) = em; get diagnostics a = row_count;
  delete from public.night_rsvps where lower(email) = em; get diagnostics b = row_count;
  delete from public.rider_keys where lower(email) = em; get diagnostics c = row_count;
  delete from public.partner_leads where lower(contact) = em; get diagnostics d = row_count;
  delete from public.outbox where to_email = em; get diagnostics g = row_count;
  return json_build_object('signups_deleted', a, 'rsvps_deleted', b, 'keys_deleted', c, 'partner_leads_deleted', d,
                           'crew_memberships_deleted', e, 'city_requests_deleted', f, 'emails_deleted', g, 'alerts_deleted', h,
                           'plan_leads_deleted', i, 'wallet_anonymised', true);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. The hourly release, and who may call what
-- ---------------------------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hi8-release-seats', '7 * * * *', 'select public.hi8_release_seats()');
  end if;
end $$;

revoke execute on function public.hi8_int(text, int) from public, anon, authenticated;
revoke execute on function public.hi8_payments_live() from public, anon, authenticated;
revoke execute on function public.hi8_balance(text) from public, anon, authenticated;
revoke execute on function public.hi8_has_pass(text) from public, anon, authenticated;
revoke execute on function public.hi8_seat_price(uuid, text) from public, anon, authenticated;
revoke execute on function public.hi8_refund_seat(public.seat_payments, text) from public, anon, authenticated;
revoke execute on function public.hi8_release_seats() from public, anon, authenticated;
revoke execute on function public.hi8_on_crew_money() from public, anon, authenticated;
revoke execute on function public.hi8_on_member_money() from public, anon, authenticated;
revoke execute on function public.hi8_key_owner(uuid) from public, anon, authenticated;
revoke execute on function public.hi8_topup_paid(text, int, text) from public, anon, authenticated;
revoke execute on function public.hi8_pass_update(text, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke execute on function public.hi8_payout_account(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.hi8_payout_start(text) from public, anon, authenticated;
revoke execute on function public.hi8_payout_done(bigint, text, boolean) from public, anon, authenticated;
revoke execute on function public.erase_email(text) from public, anon, authenticated;
revoke execute on function public.hi8_wallet(uuid) from public;
revoke execute on function public.hi8_pay_seat(uuid, text) from public;
grant execute on function public.hi8_wallet(uuid) to anon, authenticated;
grant execute on function public.hi8_pay_seat(uuid, text) to anon, authenticated;
grant execute on function public.hi8_key_owner(uuid) to service_role;
grant execute on function public.hi8_topup_paid(text, int, text) to service_role;
grant execute on function public.hi8_pass_update(text, text, text, timestamptz, text, text) to service_role;
grant execute on function public.hi8_payout_account(text, text, boolean) to service_role;
grant execute on function public.hi8_payout_start(text) to service_role;
grant execute on function public.hi8_payout_done(bigint, text, boolean) to service_role;
grant execute on function public.hi8_release_seats() to service_role;
grant execute on function public.erase_email(text) to service_role;

-- The money, from the SQL editor:
--   select email, sum(cents) / 100.0 as euros from public.wallet_ledger group by email order by 2 desc;   -- wallets
--   select status, count(*), sum(share_cents) / 100.0 as shares, sum(fee_cents) / 100.0 as fees from public.seat_payments group by status;
--   select * from public.passes order by updated_at desc;

notify pgrst, 'reload schema';
