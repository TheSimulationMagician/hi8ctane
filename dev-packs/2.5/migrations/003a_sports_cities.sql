-- Hi8ctane 2.5 · migration part 1 of 2 (run on a 2.4 database).
-- New enum values have to be committed before anything can use them, so this file runs on its own:
-- in the Supabase SQL editor run this file first, then 003b_release_25.sql.
alter type sport add value if not exists 'mx';               -- motocross: track crews (Lelystad first)
alter type home_base add value if not exists 'barcelona';    -- second city
