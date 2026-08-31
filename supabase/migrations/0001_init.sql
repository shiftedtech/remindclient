-- RemindClient — Stage 1: auth + student CRUD
-- RLS is enabled on every table in this, the first migration.
-- Run this once in the Supabase SQL editor (project fkzaohvigtgacmtqwsmt).

create extension if not exists pgcrypto;

-- ---------- promo_codes (global lookup, NOT coach-owned) ----------
create table public.promo_codes (
  code        text primary key,
  trial_days  int  not null check (trial_days between 1 and 3650),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.promo_codes enable row level security;
-- Deliberately ZERO policies: no client (anon or authenticated) can read or
-- write promo codes. Only the SECURITY DEFINER signup trigger below reads it.

insert into public.promo_codes (code, trial_days) values ('TEACH3', 90);

-- ---------- profiles (one row per coach) ----------
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text,
  paynow_number  text,
  template_text  text,
  trial_ends_at  timestamptz not null default (now() + interval '14 days'),
  paid_until     timestamptz,
  promo_code     text references public.promo_codes(code),
  created_at     timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "own profile: select" on public.profiles
  for select using (id = auth.uid());
create policy "own profile: insert" on public.profiles
  for insert with check (id = auth.uid());
create policy "own profile: update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
-- no delete policy: profiles die with the auth user (cascade)

-- ---------- students ----------
create table public.students (
  id               uuid primary key default gen_random_uuid(),
  coach_id         uuid not null default auth.uid()
                     references auth.users(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  payer_name       text,
  payer_contact    text,
  fee_amount       numeric(10,2) not null default 0 check (fee_amount >= 0),
  due_day          int check (due_day between 1 and 31),
  lesson_slot      text,
  telegram_chat_id text,                                     -- stage 4, unused now
  ics_token        uuid not null default gen_random_uuid(),  -- stage 5, unused now
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (id, coach_id)          -- lets payments FK-enforce same-owner rows
);
alter table public.students enable row level security;
create index students_coach_id_idx on public.students (coach_id);

create policy "own students: select" on public.students
  for select using (coach_id = auth.uid());
create policy "own students: insert" on public.students
  for insert with check (coach_id = auth.uid());
create policy "own students: update" on public.students
  for update using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "own students: delete" on public.students
  for delete using (coach_id = auth.uid());

-- ---------- payments (created here; driven in stage 2) ----------
create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null default auth.uid()
                references auth.users(id) on delete cascade,
  student_id  uuid not null,
  month       date not null check (extract(day from month) = 1),
  amount      numeric(10,2) not null default 0 check (amount >= 0),
  status      text not null default 'due' check (status in ('due','paid')),
  paid_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (student_id, month),
  foreign key (student_id, coach_id)
    references public.students (id, coach_id) on delete cascade
);
alter table public.payments enable row level security;
create index payments_coach_month_idx on public.payments (coach_id, month);

create policy "own payments: select" on public.payments
  for select using (coach_id = auth.uid());
create policy "own payments: insert" on public.payments
  for insert with check (coach_id = auth.uid());
create policy "own payments: update" on public.payments
  for update using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "own payments: delete" on public.payments
  for delete using (coach_id = auth.uid());

-- ---------- signup: create profile + apply trial ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := nullif(upper(trim(new.raw_user_meta_data->>'promo_code')), '');
  v_days int;
begin
  if v_code is not null then
    select trial_days into v_days
      from public.promo_codes
     where code = v_code and active;
  end if;

  if v_days is null then           -- no code, or unknown/inactive code
    v_days := 14;
    v_code := null;
  end if;

  insert into public.profiles (id, full_name, promo_code, trial_ends_at)
  values (new.id,
          nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
          v_code,
          now() + make_interval(days => v_days))
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
