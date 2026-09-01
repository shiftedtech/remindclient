// RemindClient — Stage 1: auth + student CRUD (+ weekly lesson days, WhatsApp reminder).
// Only dependency: supabase-js v2 from a pinned CDN build. No build step.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let user = null;
let profile = null;
let students = [];
let mode = 'signin';        // 'signin' | 'signup'
let calCursor = startOfMonth(new Date());
let query = '';
let overrides = new Map();  // "studentId|YYYY-MM-DD" -> 'add' | 'cancel'
let payments = new Map();   // studentId -> payment row for the displayed month
let pickerMode = 'weekly';  // 'weekly' = recurring schedule, 'date' = one-off
let pickerDow = null;       // weekday open in the picker
let pickerDate = null;      // { key: 'YYYY-MM-DD', y, m, d, dow } when mode = 'date'

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

const DEFAULT_TEMPLATE =
  "Hi {payer}! Hope {student} is doing well. Just a heads up before our next lesson — "
  + "{month}'s fee is {amount}, due on the {due_day}. PayNow to {paynow} whenever you're "
  + "free. No rush at all, and thank you for your support! 🙏";

/* ------------------------------------------------------------------ utils */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) =>
  'S$' + Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const ordinal = (d) => {
  const n = Number(d);
  if (!n) return '';
  const rest = n % 100;
  const suffix = (rest >= 11 && rest <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  return n + suffix;
};

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
const days = (s) => Array.isArray(s?.lesson_days) ? s.lesson_days : [];
const ymd = (y, m, d) => y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const ovKey = (id, key) => id + '|' + key;

// Weekly schedule, adjusted by any one-off change for that exact date.
const monthKey = (d) => ymd(d.getFullYear(), d.getMonth(), 1);
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

// Paid / Overdue / Due soon / Due, for the month currently on screen.
function statusOf(s) {
  const row = payments.get(s.id);
  if (row?.status === 'paid') return 'paid';
  if (!s.due_day) return 'none';

  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  const due = new Date(y, m, Math.min(Number(s.due_day), daysIn(y, m)));
  const today = new Date(); today.setHours(0, 0, 0, 0);

  if (today > due) return 'overdue';
  if ((due - today) / 86400000 <= 7) return 'soon';
  return 'due';
}

const STATUS_TEXT = { paid: 'Paid', overdue: 'Overdue', soon: 'Due soon', due: 'Due', none: '—' };

function hasLessonOn(s, key, dow) {
  const o = overrides.get(ovKey(s.id, key));
  if (o === 'cancel') return false;
  if (o === 'add') return true;
  return days(s).includes(dow);
}
function lessonsOn(key, dow) { return students.filter((s) => hasLessonOn(s, key, dow)); }
const dayLabels = (s) => days(s).slice().sort().map((d) => DOW_SHORT[d]).join(', ');

let toastTimer;
function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
}

const fail = (err, what) => {
  console.error(what, err);
  toast(err?.message || ('Could not ' + what + '.'), 'bad');
};

/* ------------------------------------------------------------------- auth */
function setMode(next) {
  mode = next;
  $('tabSignIn').classList.toggle('is-active', mode === 'signin');
  $('tabSignUp').classList.toggle('is-active', mode === 'signup');
  document.querySelectorAll('.signup-only').forEach((el) => { el.hidden = mode !== 'signup'; });
  $('promoField').hidden = true;              // collapsed again on every tab switch
  $('authSubmit').textContent = mode === 'signin' ? 'Sign in' : 'Create account';
  $('password').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
}

$('tabSignIn').onclick = () => setMode('signin');
$('tabSignUp').onclick = () => setMode('signup');

$('promoToggle').onclick = () => {
  const f = $('promoField');
  f.hidden = !f.hidden;
  if (!f.hidden) $('promoCode').focus();
};

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) return toast('Email and password are required.', 'bad');

  const btn = $('authSubmit');
  btn.disabled = true;
  try {
    if (mode === 'signin') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: location.href.split('#')[0],
          data: {
            full_name: $('fullName').value.trim(),
            promo_code: $('promoCode').value.trim().toUpperCase(),
          },
        },
      });
      if (error) throw error;
      if (!data.session) toast('Check your email to confirm your account.', 'ok');
    }
  } catch (err) {
    fail(err, mode === 'signin' ? 'sign in' : 'create your account');
  } finally {
    btn.disabled = false;
  }
});

$('googleBtn').onclick = async () => {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.href.split('#')[0] },
  });
  if (error) fail(error, 'sign in with Google');
};

$('signOutBtn').onclick = async () => { await sb.auth.signOut(); };

/* --------------------------------------------------------------- profile */
async function loadProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) return fail(error, 'load your profile');

  profile = data;
  if (!profile) {
    const { data: created, error: insErr } = await sb
      .from('profiles')
      .insert({ id: user.id, full_name: user.user_metadata?.full_name ?? null })
      .select()
      .single();
    if (insErr) return fail(insErr, 'set up your profile');
    profile = created;
  }
  renderPlan();
}

function planStatus() {
  const now = Date.now();
  const paid = profile?.paid_until ? new Date(profile.paid_until).getTime() : 0;
  const trial = profile?.trial_ends_at ? new Date(profile.trial_ends_at).getTime() : 0;
  const left = (t) => Math.ceil((t - now) / 86400000);

  if (paid > now) return { text: 'Paid · ' + left(paid) + 'd left', kind: '' };
  if (trial > now) {
    const d = left(trial);
    return { text: 'Trial · ' + d + 'd left', kind: d <= 3 ? 'warn' : '' };
  }
  return { text: 'Trial ended', kind: 'bad' };
}

function renderPlan() {
  const s = planStatus();
  const chip = $('trialChip');
  chip.textContent = s.text;
  chip.className = 'chip ' + s.kind;
  $('planLine').textContent = profile?.promo_code
    ? s.text + ' (promo ' + profile.promo_code + ' applied).'
    : s.text + '.';
}

$('settingsBtn').onclick = () => {
  $('pFullName').value = profile?.full_name ?? '';
  $('pPayNow').value = profile?.paynow_number ?? '';
  $('pTemplate').value = profile?.template_text?.trim() || DEFAULT_TEMPLATE;
  renderPlan();
  $('settingsDialog').showModal();
};

$('resetTemplate').onclick = () => {
  $('pTemplate').value = DEFAULT_TEMPLATE;
  $('pTemplate').focus();
};

$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const patch = {
    full_name: $('pFullName').value.trim() || null,
    paynow_number: $('pPayNow').value.trim() || null,
    template_text: $('pTemplate').value.trim() || null,
  };
  const { data, error } = await sb.from('profiles').update(patch).eq('id', user.id).select().single();
  if (error) return fail(error, 'save your profile');
  profile = data;
  renderPlan();
  $('settingsDialog').close();
  toast('Profile saved.', 'ok');
});

/* -------------------------------------------------------------- students */
async function loadStudents() {
  const { data, error } = await sb
    .from('students')
    .select('*')   // '*' so the app still loads if 0002 has not been run yet
    .order('name', { ascending: true });
  if (error) return fail(error, 'load your students');
  students = data ?? [];
  await Promise.all([loadOverrides(), loadPayments()]);
  renderAll();
}

async function loadPayments() {
  payments = new Map();
  const key = monthKey(calCursor);

  // Create this month's rows on first sight, so the dashboard is never empty.
  // Browsing a past month shows history as it was; it never back-fills.
  const now = new Date();
  if (key >= monthKey(now) && students.length) {
    const rows = students.map((s) => ({
      student_id: s.id, month: key, amount: Number(s.fee_amount || 0), status: 'due',
    }));
    const { error } = await sb.from('payments')
      .upsert(rows, { onConflict: 'student_id,month', ignoreDuplicates: true });
    if (error) console.warn('could not create this month rows', error.message);
  }

  const { data, error } = await sb
    .from('payments')
    .select('id, student_id, month, amount, status, paid_at')
    .eq('month', key);
  if (error) return console.warn('payments unavailable', error.message);
  (data ?? []).forEach((r) => payments.set(r.student_id, r));
}

async function loadOverrides() {
  overrides = new Map();
  const from = ymd(calCursor.getFullYear(), calCursor.getMonth(), 1) ;
  const { data, error } = await sb
    .from('lesson_overrides')
    .select('student_id, on_date, action')
    .gte('on_date', from);
  // Missing table just means 0003 hasn't been run — the weekly schedule still works.
  if (error) return console.warn('lesson_overrides unavailable', error.message);
  (data ?? []).forEach((o) => overrides.set(ovKey(o.student_id, o.on_date), o.action));
}

// The list is only ever narrowed by the search box — never by the calendar.
function visibleStudents() {
  const q = query.trim().toLowerCase();
  if (!q) return students;
  return students.filter((s) => [s.name, s.payer_name, s.payer_contact]
    .some((v) => String(v ?? '').toLowerCase().includes(q)));
}

function renderStudents() {
  const shown = visibleStudents();
  $('studentCount').textContent = shown.length === students.length
    ? students.length + (students.length === 1 ? ' student' : ' students')
    : shown.length + ' of ' + students.length;

  $('emptyState').hidden = students.length > 0;
  document.querySelector('.table').hidden = students.length === 0;

  $('studentList').innerHTML = shown.map((s) =>
    '<li data-id="' + s.id + '">'
    + '<span class="nm truncate">' + esc(s.name) + '</span>'
    + '<span class="sub truncate">' + esc(s.payer_name || s.payer_contact || '—') + '</span>'
    + '<span class="num">' + (s.fee_amount ? money(s.fee_amount) : '—') + '</span>'
    + '<span class="num sub">' + (s.due_day ? ordinal(s.due_day) : '—') + '</span>'
    + '<span class="sub truncate">' + (dayLabels(s) || '—') + '</span>'
    + '</li>').join('');
}

function statusCell(s) {
  const st = statusOf(s);
  if (st === 'none') return '<span class="st-wrap sub">&mdash;</span>';
  const label = st === 'paid' ? 'Paid' : 'Mark paid';
  const title = st === 'paid' ? 'Paid \u2014 tap to undo' : STATUS_TEXT[st] + ' \u2014 tap to mark paid';
  return '<span class="st-wrap"><button type="button" class="st ' + st
    + '" data-pay="' + s.id + '" title="' + title + '">' + label + '</button></span>';
}

// One tap, applied immediately. The write happens behind it; if it fails the
// chip goes back to where it was.
async function togglePaid(id) {
  const s = students.find((x) => x.id === id);
  if (!s) return;

  const key = monthKey(calCursor);
  const row = payments.get(id);
  const nowPaid = row?.status !== 'paid';
  const patch = { status: nowPaid ? 'paid' : 'due', paid_at: nowPaid ? new Date().toISOString() : null };

  const before = row ? { ...row } : null;
  payments.set(id, { ...(row ?? { student_id: id, month: key, amount: Number(s.fee_amount || 0) }), ...patch });
  renderStudents();
  renderSidebar();
  renderCalendar();

  const { error } = row
    ? await sb.from('payments').update(patch).eq('id', row.id)
    : await sb.from('payments').insert({
        student_id: id, month: key, amount: Number(s.fee_amount || 0), ...patch,
      });

  if (error) {
    if (before) payments.set(id, before); else payments.delete(id);
    renderStudents(); renderSidebar(); renderCalendar();
    return fail(error, 'save that payment');
  }
  if (!row) await loadPayments();   // pick up the id of the row we just made
}

/* ------------------------------------------------------------- calendar */
// A tool for seeing which students come on which day. It never filters the list.
function renderCalendar() {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  const today = new Date();

  $('calMonth').textContent = calCursor.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;   // Monday-first grid
  const perDow = {};
  students.forEach((s) => days(s).forEach((d) => { perDow[d] = (perDow[d] || 0) + 1; }));

  let html = '';
  for (let i = 0; i < lead; i++) html += '<span></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(y, m, d).getDay();
    const key = ymd(y, m, d);
    const count = lessonsOn(key, dow).length;
    const edited = students.some((s) => overrides.has(ovKey(s.id, key)));
    const dueHere = students.filter((s) => Number(s.due_day) === d);
    const sts = dueHere.map(statusOf);
    const ring = !dueHere.length ? ''
      : sts.includes('overdue') ? 'r-over'
      : sts.includes('soon') ? 'r-soon'
      : sts.every((x) => x === 'paid') ? 'r-paid' : 'r-due';
    const cls = [
      sameMonth(calCursor, today) && d === today.getDate() ? 'today' : '',
      ring,
      edited ? 'adj' : '',
    ].filter(Boolean).join(' ');
    const title = [
      count ? count + (count === 1 ? ' lesson' : ' lessons') : 'No lessons',
      dueHere.length ? dueHere.length + ' payment due' : '',
      edited ? 'changed for this date' : '',
    ].filter(Boolean).join(' \u00b7 ');
    html += '<button type="button" class="' + cls + '" data-date="' + d + '" title="' + title + '">'
      + d + (count ? '<i class="dot"></i>' : '') + '</button>';
  }
  $('calGrid').innerHTML = html;

  $('calDow').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('has', !!perDow[Number(b.dataset.dow)]);
  });
}

function renderSidebar() {
  const now = new Date();
  const todays = lessonsOn(ymd(now.getFullYear(), now.getMonth(), now.getDate()), now.getDay());
  $('todayList').innerHTML = todays.length
    ? todays.map((s) => '<li><span class="truncate">' + esc(s.name) + '</span>'
        + '<span class="t">' + (s.fee_amount ? money(s.fee_amount) : '') + '</span></li>').join('')
    : '<li class="none">No lessons today.</li>';

  if (!students.length) {
    $('monthTitle').textContent = 'This month';
    $('monthSummary').textContent = 'No students yet.';
    $('collectBar').hidden = true;
    return;
  }

  let expected = 0, collected = 0;
  const tally = { paid: 0, overdue: 0, soon: 0, due: 0, none: 0 };
  students.forEach((s) => {
    const row = payments.get(s.id);
    const amt = Number(row?.amount ?? s.fee_amount ?? 0);
    expected += amt;
    const st = statusOf(s);
    tally[st] += 1;
    if (st === 'paid') collected += amt;
  });

  $('monthTitle').textContent = calCursor.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
  $('monthSummary').textContent = 'Collected ' + money(collected) + ' / ' + money(expected);

  $('collectBar').hidden = false;
  $('collectFill').style.width = (expected ? Math.round((collected / expected) * 100) : 0) + '%';
  $('monthTally').innerHTML =
    '<span class="tl paid">' + tally.paid + ' paid</span>'
    + '<span class="tl overdue">' + tally.overdue + ' overdue</span>'
    + '<span class="tl due">' + (tally.due + tally.soon) + ' due</span>';
}

function renderAll() {
  renderStudents();
  renderCalendar();
  renderSidebar();
}

async function goMonth(delta) {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + delta, 1);
  await Promise.all([loadOverrides(), loadPayments()]);
  renderAll();
}
$('calPrev').onclick = () => goMonth(-1);
$('calNext').onclick = () => goMonth(1);
$('search').addEventListener('input', (e) => { query = e.target.value; renderStudents(); });

/* ------------------------------------- who has lessons: weekly vs one-off */
function renderPicker() {
  if (!students.length) {
    $('lessonPicker').innerHTML = '<li class="none">Add a student first.</li>';
    return;
  }
  $('lessonPicker').innerHTML = students.map((s) => {
    const on = pickerMode === 'weekly'
      ? days(s).includes(pickerDow)
      : hasLessonOn(s, pickerDate.key, pickerDate.dow);
    const o = pickerMode === 'date' ? overrides.get(ovKey(s.id, pickerDate.key)) : null;
    const tag = o === 'add' ? '<em class="tag">one-off</em>'
      : o === 'cancel' ? '<em class="tag">cancelled</em>' : '';
    return '<li><label><input type="checkbox" data-id="' + s.id + '"' + (on ? ' checked' : '') + '>'
      + '<span class="truncate">' + esc(s.name) + '</span>' + tag + '</label></li>';
  }).join('');
}

// Weekly schedule — set once from the M T W T F S S header, repeats every week.
function openWeeklyPicker(dow) {
  pickerMode = 'weekly';
  pickerDow = dow;
  const day = DOW_LONG[dow].replace(/s$/, '');
  $('lessonDialogTitle').textContent = 'Every ' + day;
  $('lessonHint').textContent = 'Tick who has a lesson every ' + day + '. This repeats weekly — set it once.';
  renderPicker();
  $('lessonDialog').showModal();
}

// One-off change — this date only. The weekly schedule is left alone.
function openDatePicker(y, m, d) {
  pickerMode = 'date';
  pickerDate = { key: ymd(y, m, d), y, m, d, dow: new Date(y, m, d).getDay() };
  $('lessonDialogTitle').textContent = new Date(y, m, d)
    .toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  $('lessonHint').textContent = 'One-off change for this date only — your weekly schedule stays as it is.';
  renderPicker();
  $('lessonDialog').showModal();
}

$('calDow').addEventListener('click', (e) => {
  const dow = e.target.closest('button')?.dataset.dow;
  if (dow !== undefined) openWeeklyPicker(Number(dow));
});

$('calGrid').addEventListener('click', (e) => {
  const d = e.target.closest('button')?.dataset.date;
  if (d !== undefined) openDatePicker(calCursor.getFullYear(), calCursor.getMonth(), Number(d));
});

$('lessonPicker').addEventListener('change', async (e) => {
  const box = e.target;
  if (!box.dataset.id) return;
  const s = students.find((x) => x.id === box.dataset.id);
  if (!s) return;

  const ok = pickerMode === 'weekly'
    ? await saveWeekly(s, box.checked)
    : await saveOneOff(s, box.checked);

  if (!ok) { box.checked = !box.checked; return; }   // put the tick back
  renderPicker();
  renderStudents();
  renderCalendar();
  renderSidebar();
});

async function saveWeekly(s, checked) {
  const next = checked
    ? Array.from(new Set([...days(s), pickerDow])).sort()
    : days(s).filter((d) => d !== pickerDow);

  const { error } = await sb.from('students').update({ lesson_days: next }).eq('id', s.id);
  if (error) { fail(error, 'save the weekly schedule'); return false; }
  s.lesson_days = next;
  return true;
}

async function saveOneOff(s, checked) {
  const { key, dow } = pickerDate;
  const usual = days(s).includes(dow);

  // Back to normal for this date? Drop the exception rather than store a no-op.
  if (checked === usual) {
    const { error } = await sb.from('lesson_overrides')
      .delete().eq('student_id', s.id).eq('on_date', key);
    if (error) { fail(error, 'undo that change'); return false; }
    overrides.delete(ovKey(s.id, key));
    return true;
  }

  const action = checked ? 'add' : 'cancel';
  const { error } = await sb.from('lesson_overrides')
    .upsert({ student_id: s.id, on_date: key, action }, { onConflict: 'student_id,on_date' });
  if (error) { fail(error, 'save that change'); return false; }
  overrides.set(ovKey(s.id, key), action);
  return true;
}

$('lessonDone').onclick = () => $('lessonDialog').close();

/* ------------------------------------------------------- add / edit / del */
function openStudent(s) {
  $('studentDialogTitle').textContent = s ? 'Edit student' : 'Add student';
  $('studentId').value = s?.id ?? '';
  $('sName').value = s?.name ?? '';
  $('sPayerName').value = s?.payer_name ?? '';
  $('sPayerContact').value = s?.payer_contact ?? '';
  $('sFee').value = s?.fee_amount ?? '';
  $('sDueDay').value = s?.due_day ?? '';
  $('deleteBtn').hidden = !s;
  $('remindBtn').hidden = !s;
  $('studentDialog').showModal();
}

$('addBtn').onclick = () => openStudent(null);

$('studentList').addEventListener('click', (e) => {
  const payId = e.target.closest('[data-pay]')?.dataset.pay;
  if (payId) { e.stopPropagation(); return togglePaid(payId); }

  const id = e.target.closest('li')?.dataset.id;
  if (id) openStudent(students.find((s) => s.id === id));
});

/* ------------------------------------------------------ WhatsApp reminder */
// Digits only. A bare 8-digit local number is assumed Singapore (+65).
function waNumber(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.length === 8 ? '65' + d : d;
}

function reminderText(s) {
  const month = new Date().toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
  const map = {
    '{student}': s.name ?? '',
    '{payer}': s.payer_name || 'there',
    '{amount}': s.fee_amount ? money(s.fee_amount) : '',
    '{month}': month,
    '{due_day}': s.due_day ? ordinal(s.due_day) : '',
    '{paynow}': profile?.paynow_number ?? '',
  };
  const tpl = profile?.template_text?.trim() || DEFAULT_TEMPLATE;
  return tpl.replace(/\{(student|payer|amount|month|due_day|paynow)\}/g, (t) => map[t] ?? t);
}

$('remindBtn').onclick = () => {
  const s = students.find((x) => x.id === $('studentId').value);
  if (!s) return;

  const num = waNumber(s.payer_contact);
  if (!num) return toast("Add the payer's contact number first.", 'bad');
  if (!profile?.paynow_number) toast('Tip: add your PayNow number in Settings.', '');

  // Opened from the tutor's own phone — free, and inside WhatsApp's terms.
  window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(reminderText(s)), '_blank', 'noopener');
};

$('deleteBtn').onclick = async () => {
  const id = $('studentId').value;
  const s = students.find((x) => x.id === id);
  if (!confirm('Delete ' + (s?.name ?? 'this student') + '? This cannot be undone.')) return;

  const { error } = await sb.from('students').delete().eq('id', id);
  if (error) return fail(error, 'delete that student');
  students = students.filter((x) => x.id !== id);
  $('studentDialog').close();
  renderAll();
  toast('Student deleted.');
};

$('studentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('sName').value.trim();
  if (!name) return toast('Student name is required.', 'bad');

  const dueDay = $('sDueDay').value ? Number($('sDueDay').value) : null;
  if (dueDay !== null && (dueDay < 1 || dueDay > 31)) return toast('Due day must be 1–31.', 'bad');

  const row = {
    name,
    payer_name: $('sPayerName').value.trim() || null,
    payer_contact: $('sPayerContact').value.trim() || null,
    fee_amount: $('sFee').value ? Number($('sFee').value) : 0,
    due_day: dueDay,
  };

  const id = $('studentId').value;
  // coach_id is filled by the column default auth.uid() and enforced by RLS.
  const q = id
    ? sb.from('students').update(row).eq('id', id)
    : sb.from('students').insert(row);

  const { error } = await q;
  if (error) return fail(error, id ? 'save that student' : 'add that student');

  $('studentDialog').close();
  toast(id ? 'Student saved.' : 'Student added.', 'ok');
  await loadStudents();
});

document.querySelectorAll('dialog [data-close]').forEach((btn) => {
  btn.onclick = () => btn.closest('dialog').close();
});

/* ---------------------------------------------------------------- routing */
async function render(session) {
  user = session?.user ?? null;
  const signedIn = !!user;

  $('authView').hidden = signedIn;
  $('appView').hidden = !signedIn;
  $('whoBar').hidden = !signedIn;

  if (!signedIn) {
    // Wipe the previous coach's data out of the DOM, not just out of view.
    profile = null;
    students = [];
    overrides = new Map();
    payments = new Map();
    ['studentList', 'calGrid', 'todayList'].forEach((id) => { $(id).innerHTML = ''; });
    $('monthSummary').textContent = '';
    $('search').value = '';
    query = '';
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    return;
  }
  await Promise.all([loadProfile(), loadStudents()]);
}

sb.auth.getSession().then(({ data }) => {
  setMode('signin');
  render(data.session);
});

sb.auth.onAuthStateChange((_event, session) => { render(session); });

/* -------------------------------------------------------------------- PWA */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* non-fatal */ });
  });
}
