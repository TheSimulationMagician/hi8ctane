# Month-1 measurement (Hi8ctane 2.4)

Two sources, on purpose: the **database** says what really happened (who joined, showed up, paid) and needs no tracking; **analytics events** cover what the database can't see (link opens, taps, drop-offs between screens). Use PostHog EU (funnels and retention built in) in cookieless mode, or Plausible with custom properties. Identify signed-in and guest riders with their Supabase user id after the first join, and mention it in the privacy policy.

## The scorecard (every Monday)

North star: **crews that rode per week** (a closed crew with 2+ people checked in). Everything else explains why it went up or down.

| Metric | Definition | Source | Target |
|---|---|---|---|
| Crews that rode | closed crews with 2+ check-ins, per week | `metrics.weekly.crews_rode` | 30 by 15 Nov (game plan); 10 for gate 1 (roadmap) |
| Riders signed up | profiles (guests included) | `metrics.funnel` | 100 by 15 Nov |
| Check-in rate | checked in ÷ still in at the cut-off, closed crews | `metrics.weekly.checkin_rate_pct` | 60% (game plan's show-up rate) |
| No-show rate | no-shows ÷ still in at the cut-off | `no_show_rate_pct` | under 10% (suggested) |
| Late rate | riders who tapped RUNNING LATE ÷ still in at the cut-off | `late_rate_pct` | watch; high = pickups too early |
| Seats found | riders who needed a seat and got one ÷ riders who needed a seat | `seat_found_pct` | 80%+ (suggested); low = recruit drivers |
| Waitlist refills | promoted from waitlist; late cancels | `promoted_from_waitlist`, `cancels_late` | watch |
| Crews with 3+ | closed crews with 3+ people ÷ closed crews | `crews_3plus_pct` | 50%+ (suggested) |
| Time to first join | minutes from posting a crew to the first other rider | `median_min_to_first_join` | under 60 min (suggested) |
| Calls | GO / OFF / merged per week | `called_go`, `called_off`, `merged` | watch OFF calls that riders say were wrong |
| Driver drops | cars cancelled by their driver (not by the call) | `driver_drops` | under 1 in 10 cars (suggested) |
| Ride again | first check-in cohort back within 14 / 30 days | `metrics.retention` | 30% ride a 2nd time (roadmap gate 2) |
| Link → I'M IN | crew links opened that end in a join | events below | 30%+ (suggested) |
| Shared outside the app | crew link opens from WhatsApp or Instagram | `crew_link_opened` | 50 by 15 Nov (game plan) |
| Money moved | € in splits, € settled | `shared_eur`, `settled_eur` | shows the value riders get |
| 50-cent fee test | what €0.50 per paid seat would have made | `fee_at_50c_eur` | for the pricing decision, not charged |

"Suggested" targets are new; the others come from the game plan (Oct 15 – Nov 15) and the roadmap gates in the deploy pack doc. Read the views with the service role, never from the browser: `select * from metrics.weekly;`, `metrics.retention`, `metrics.funnel`, `metrics.follow_up` (repeat no-shows and riders stuck on a waitlist, to call personally).

## Events

Send from the browser unless marked *server*; server events come from the RPC result or the tick, so they can't be lost when someone closes the tab. Keep names exactly as written.

| Event | When | Properties |
|---|---|---|
| `landing_viewed` | landing loads | `hero` (h24b / h25b / h26b), `ref` |
| `crew_link_opened` | /s/[code] loads (*server* too) | `crew_id`, `source` (whatsapp, instagram, direct), `inviter_id` |
| `invite_submitted` | first name + WhatsApp sent | `crew_id`, `level` |
| `im_in_tapped` | I'M IN | `crew_id`, `ride` (drive, need, meet) |
| `crew_joined` | *server*, join_crew result | `crew_id`, `state` (in, waitlist), `ride`, `guest` |
| `crew_started` | *server*, start_crew | `sport`, `spot`, `days_ahead`, `ride`, `seconds_to_start` (the crew timer), `rules_changed` |
| `car_offered` | *server*, offer_car | `crew_id`, `seats`, `max_wait_min`, `round_trip_km` |
| `seat_tapped` | empty seat tapped on the crew page | `crew_id`, `car_id` |
| `chat_message_sent` | message sent | `crew_id`, `kind` (text, quick) |
| `crew_shared` | SEND IT / SEND TO A MATE | `crew_id`, `channel` (share_sheet, whatsapp, copy) |
| `late_reported` | running_late result | `crew_id`, `minutes`, `outcome` (covered, too_late) |
| `ride_switched` | switch_car | `crew_id`, `after_cutoff` |
| `cancel_opened` | CAN'T GO opened | `crew_id`, `before_cutoff` |
| `cancel_kept` | KEEP MY SEAT | `crew_id` |
| `cancel_confirmed` | cancel_booking result | `crew_id`, `free`, `minutes_to_start` |
| `waitlist_joined` / `waitlist_left` | waitlist taps | `crew_id` |
| `waitlist_promoted` | *server*, promote | `crew_id`, `minutes_waited` |
| `checked_in` | check_in | `crew_id`, `by` (self, driver), `minutes_from_pickup` |
| `no_show_marked` | *server* | `crew_id` |
| `driver_dropped` | *server* | `crew_id`, `after_call`, `moved`, `waitlist` |
| `call_made` | *server* | `crew_id`, `call` (go, off), `by` (system, host), `overridden` |
| `crews_merged` | *server* | `from`, `into` |
| `payment_request_sent` | driver sends a request | `crew_id`, `riders` |
| `share_settled` | *server*, mark_paid | `crew_id`, `amount_eur`, `hours_after` |
| `rider_report_sent` | "how was it vs the forecast" | `spot`, `vs_forecast` |
| `profile_completed` | guest links Google or email | `crews_before` |
| `partner_link_clicked` | Rent here / lessons | `partner`, `spot`, `sport` |
| `waitlist_feature_joined` | Market or Rent & Learn email | `feature` |
| `push_enabled` | push permission granted | `platform` (ios_home_screen, android, desktop) |
| `radio_played` | Hi8 Radio | `show` |
| `pass_interest` | pricing test: tapped a Crew Pass price | `price_shown`, `plan` (month, season, year) |

Funnels to build on day one: `crew_link_opened → im_in_tapped → crew_joined → checked_in`, and `landing_viewed → crew_started`. Retention: `checked_in` repeated within 14 and 30 days.
