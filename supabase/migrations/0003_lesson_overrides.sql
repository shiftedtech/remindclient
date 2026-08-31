-- RemindClient — one-off changes to the weekly lesson schedule.
--
-- students.lesson_days holds the RECURRING weekly schedule (set from the
-- M T W T F S S header). This table holds EXCEPTIONS for a single date:
--   'add'    -> an extra lesson on that date only
--   'cancel' -> the usual weekly lesson does not happen that date
--
-- Effective lessons on a date =
--   (students whose lesson_days contains that weekday, minus 'cancel' rows)
--   plus ('add' rows for that date)
--
-- Run this in the Supabase SQL editor after 0002_lesson_days.sql.

create table if not exists public.lesson_overrides (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null default auth.uid()
                references auth.users(id) on delete cascade,
  student_id  uuid not null,
  on_date     date not null,
  action      text not null check (action in ('add', 'cancel')),
  created_at  timestamptz not null default now(),
  unique (student_id, on_date),
  foreign key (student_id, coach_id)
    references public.students (id, coach_id) on delete cascade
);

alter table public.lesson_overrides enable row level security;
create index if not exists lesson_overrides_coach_date_idx
  on public.lesson_overrides (coach_id, on_date);

create policy "own overrides: select" on public.lesson_overrides
  for select using (coach_id = auth.uid());
create policy "own overrides: insert" on public.lesson_overrides
  for insert with check (coach_id = auth.uid());
create policy "own overrides: update" on public.lesson_overrides
  for update using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "own overrides: delete" on public.lesson_overrides
  for delete using (coach_id = auth.uid());
