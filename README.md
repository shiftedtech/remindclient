# RemindClient

Payment + lesson reminders for freelance tutors, coaches and instructors in SG/MY.
By [ShiftedTech](https://github.com/shiftedtech).

**Stage 1 (this build): auth + student CRUD.** Dashboard, WhatsApp reminders, the
Telegram bot and ICS feeds come in later stages.

---

## What's in here

```
index.html                       auth screen + students screen (one page)
app.js                           supabase client, auth, profile, student CRUD
styles.css                       mobile-first, no framework
config.js                        Supabase URL + anon key (public by design)
manifest.webmanifest, sw.js      PWA: installable, offline shell
icons/                           192 / 512 app icons
supabase/migrations/0001_init.sql   schema + RLS + signup trigger
Survey/                          the live validation survey (untouched)
```

No build step, no npm, no bundler. One dependency, loaded from a pinned CDN URL
inside `app.js`: `@supabase/supabase-js@2.45.4`.

---

## Setup — do this once

### 1. Run the migration

Supabase dashboard → project `fkzaohvigtgacmtqwsmt` → **SQL Editor** → New query →
paste the entire contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**.

That creates `profiles`, `students`, `payments`, `promo_codes` — each with RLS
**enabled** and `coach_id = auth.uid()` policies — inserts the `TEACH3` promo row
(90 days), and installs the signup trigger that gives every new coach a 14-day trial.

Verify in **Table Editor**: all four tables should show the green **RLS enabled** badge.

### 2. Turn on the auth providers

**Authentication → Providers → Email**: enabled (it is by default).
While testing solo, you can turn *Confirm email* **off** so signups log you straight
in. Turn it back **on** before you send the launch email — otherwise anyone can sign
up with someone else's address.

**Authentication → Providers → Google**: toggle on, then paste a Client ID and
Client Secret from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
→ Create Credentials → OAuth client ID → Web application. In that Google client, set

- Authorised JavaScript origins: `http://localhost:8000` and your deployed origin
- Authorised redirect URI: `https://fkzaohvigtgacmtqwsmt.supabase.co/auth/v1/callback`

(Supabase shows you that exact callback URL on the Google provider page — copy it from there.)

### 3. Set the redirect URLs

**Authentication → URL Configuration**:

- **Site URL**: your deployed URL, e.g. `https://shiftedtech.github.io/remindclient/`
- **Redirect URLs**: add both
  - `http://localhost:8000/**`
  - `https://shiftedtech.github.io/remindclient/**`

Without these, Google sign-in and email confirmation bounce back to the wrong place.

### 4. Config values

Already filled in at [`config.js`](config.js) — nothing to change unless you switch projects:

| Value | Where it lives | Notes |
|---|---|---|
| `SUPABASE_URL` | `config.js` | `https://fkzaohvigtgacmtqwsmt.supabase.co` |
| `SUPABASE_ANON_KEY` | `config.js` | Public by design. RLS is the real boundary. |

**The anon key is the only key that may ever appear in this repo.** The
`service_role` key and the @RemindClientBot token belong in Supabase Edge Function
secrets only — never in `config.js`, never in any committed file.

---

## Run it locally

ES modules need a real HTTP server — opening `index.html` from disk will fail on CORS.

```sh
python -m http.server 8000
# then open http://localhost:8000
```

## Deploy

**GitHub Pages** — push to `shiftedtech/RemindClient`, then Settings → Pages →
Source: *Deploy from a branch* → `main` / root. Everything is static and relative-pathed.

**Netlify** — drag the folder in, or connect the repo. No build command, publish
directory `.`.

Afterwards, add the live URL to Supabase **URL Configuration** (step 3) and to the
Google OAuth client's authorised origins (step 2).

---

## Test it end to end

1. Open the app → **Create account** → enter your name, email, password, promo code `TEACH3`.
2. Sign in. The top-right chip should read **Trial · 90d left**.
   (Sign up without a code and it reads **Trial · 14d left**.)
3. **+ Add student** → name + fee → Save. Edit it, then delete it.
4. **Settings** → save your name, PayNow number and default message template.
5. Check RLS actually works: in the Supabase SQL editor run `select * from students;`
   You'll see every row there (the SQL editor bypasses RLS) — but a second coach
   account in the app will only ever see its own. Worth signing up a throwaway
   second account once to see the list come back empty.

---

## Notes for later stages

- **Idle pause.** A free-tier project with no traffic for ~1 week gets paused, which
  breaks logins until you resume it in the dashboard. Once real users are on, that's
  moot; before then, either use it yourself regularly or point a free cron
  (cron-job.org) at the app URL daily.
- `payments`, `students.telegram_chat_id` and `students.ics_token` exist in the
  schema but nothing writes to them yet — they're stage 2, 4 and 5.
- `trial_ends_at` / `paid_until` are displayed but **do not gate anything yet**.
  The access check (`paid_until > now()` OR trial active) lands with the dashboard
  in stage 2.
- `promo_codes` has RLS on with **zero policies**, so no client can read or write it.
  Only the `SECURITY DEFINER` signup trigger touches it; an unknown or inactive code
  silently falls back to 14 days. Adding a new code is one `insert` in the SQL editor,
  no code change.
