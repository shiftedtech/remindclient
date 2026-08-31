-- RemindClient — recurring weekly lesson days.
-- Replaces the free-text students.lesson_slot for scheduling purposes.
-- Run this in the Supabase SQL editor after 0001_init.sql.

alter table public.students
  add column if not exists lesson_days smallint[] not null default '{}';

-- 0 = Sunday … 6 = Saturday (matches JavaScript's Date.getDay()).
alter table public.students
  drop constraint if exists students_lesson_days_valid;

alter table public.students
  add constraint students_lesson_days_valid
  check (lesson_days <@ array[0,1,2,3,4,5,6]::smallint[]);

-- lesson_slot is intentionally kept: it still holds any free text already
-- entered, and stage 5 (ICS feeds) will want a time of day alongside the day.
-- No new RLS needed — a new column inherits the policies already on students.
