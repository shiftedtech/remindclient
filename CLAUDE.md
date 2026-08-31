# RemindClient — Project Brief (CLAUDE.md)

App by **ShiftedTech** (GitHub org: `shiftedtech`) · Founder: Fahmy Mahamud · IG: @careershifttechguy
One-liner: **Payment + lesson reminders for freelance tutors, coaches and instructors in SG/MY.**
Tagline direction (not final): "Never chase a payment. Never get a no-show."

## Status
- Validation survey LIVE: `shiftedtech.github.io/remindclientsurvey/` (repo `shiftedtech/remindclientsurvey`, single HTML + Supabase insert + guide.pdf lead magnet). Do not modify unless asked.
- Telegram bot username **@RemindClientBot** claimed via BotFather (dormant, no code yet). Token is SECRET — must only ever live in Supabase Edge Function secrets, never in repo/client code.
- This repo = the actual app. Survey results (see "Open questions") may reorder feature priorities.

## Product spec — v1
Paid-only with trial. No free tier.
- Default trial: 14 days. Promo code **TEACH3** = 90-day trial (survey respondents). Promo codes live in a `promo_codes` table (code, trial_days, active) so new codes need no code changes.
- Price: S$10/month or S$60/year. **No Stripe in v1** — payments collected manually via PayNow; owner marks payment received, which extends `paid_until` by 1 or 12 months. Access check everywhere = `paid_until > now()` OR trial active.

### Core features (build order)
1. **Auth + student CRUD** — Supabase Auth (email + Google). Tables with RLS `coach_id = auth.uid()` on EVERY table. Coach profile: name, PayNow number, default message template.
2. **Dashboard** — per month: each student → fee, due day, next lesson slot, status chip (Paid / Due / Overdue), running total "Collected S$X / S$Y". One-tap **mark as paid** (most frequent action — make it instant). Monthly rollover job on the 1st creates the new month's payment rows.
3. **One-tap WhatsApp reminder** — per student `wa.me/<payer>?text=<prefilled>` with amount, month, PayNow details, next lesson. Sent from the tutor's own phone (manual tap = free, ToS-clean).
4. **Telegram auto-reminders (paid feature)** — bot @RemindClientBot. Per-student deep link `t.me/RemindClientBot?start=<token>` links a parent's chat_id to that student. Daily Edge Function cron: payment reminders (N days before due, on due date, overdue) + lesson reminders (day before / hours before). Cadence coach-configurable, defaults gentle (reminder-fatigue risk: parents muting the bot kills the channel).
5. **Per-family ICS calendar feed** — tokenized, revocable URL per family containing ONLY their lessons (pattern proven in founder's sgmclean crew-scheduling app). Calendar = passive schedule + native pre-lesson alerts; NOT for urgent changes (ICS pull refresh can lag hours on Google). Urgent/targeted messages always go via bot or wa.me.
6. **Payment history + CSV export** (paid) — tax-time feature.

### Explicitly OUT of v1
Stripe/any payment processing in-app, invoicing/receipts, WhatsApp Business API auto-send (roadmap: future premium tier ~S$15–20 once demand covers Meta per-message fees), native iOS/Android, multi-coach orgs/centres (future: custom builds for tuition centres — the services revenue lane).

## Architecture
- **Frontend:** simple web app (founder's style: pragmatic, minimal deps; single-file or light Vite is fine), deployed on GitHub Pages or Netlify under the shiftedtech org. PWA manifest for home-screen install.
- **Backend:** Supabase free tier — Auth, Postgres + RLS, Edge Functions (Telegram webhook, daily reminder cron, monthly rollover cron), Storage if needed.
- **Draft schema:** `profiles` (coach) · `students` (coach_id, name, payer_name, payer_contact, fee_amount, due_day, lesson_slot, telegram_chat_id nullable, ics_token) · `payments` (student_id, month, status, paid_at) · `promo_codes` · coach fields: paid_until, trial_ends_at, template_text.
- **Existing Supabase project** htyosvhcfuayqlhsznrk currently hosts the survey table (`survey_responses` + `survey_flat` view) and sgmclean tables — decide at build time whether app shares it or gets its own project (free tier pauses idle projects after ~1 week; shared project stays awake).

## Founder context & constraints
- Career-switcher (facilities/mechanical → data engineering); building in public on IG @careershifttechguy. Values honest, practical advice; will call out inaccuracies.
- Budget-sensitive: everything on free tiers until revenue. Claude usage: plan in chat, execute in Code in short focused bursts.
- Dogfooding: founder will use RemindClient itself to track HIS OWN subscribers (annual/monthly/trial status) — his customers are "students," his bot chases renewals.
- Key adoption lesson from his sgmclean project: users rejected a tool that "felt like extra work." Every feature must REDUCE taps; one-time setup only. When in doubt, fewer features, less friction.
- ACRA sole-prop registration deferred until revenue is real (needed later for Stripe/corporate PayNow).

## Funnel (already live)
IG story → survey (email captured, channel preference asked) → guide.pdf (product story, dashboard mockup, both reminder channels explained, pricing, TEACH3 code on last page) → founder personally emails each respondent → launch email when app ships.

## Open questions — answer from survey data before locking build order
1. "One chore to remove forever" ranking → does payment chasing or lesson reminding win? (Reorders features 3–5.)
2. Channel preference (WhatsApp/Telegram/SMS/Email) → how hard to push the Telegram linking flow vs lean on wa.me + ICS.
3. Interest split at S$10 ("worth it" / "try free then decide" / "only if free") → pricing confidence.

## Working agreements for Claude Code sessions
- Read this file fully before any work. Ask before adding dependencies or paid services.
- RLS on every table from the first migration — never "add security later."
- Secrets (bot token, service keys) only in Supabase secrets / env — never committed. The Supabase anon key is the ONLY key allowed in client code.
- Small shippable increments matching the build order above; each stage independently demoable.
