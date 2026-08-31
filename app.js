// RemindClient — Stage 1: auth + student CRUD.
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
let selectedDay = null;     // day-of-month filter from the calendar
let query = '';

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
      // Email confirmation ON => no session yet.
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
  // Safety net: if the signup trigger didn't run (e.g. a user created before
  // the migration), create the row now with the default 14-day trial.
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
  const days = (t) => Math.ceil((t - now) / 86400000);

  if (paid > now) return { text: 'Paid · ' + days(paid) + 'd left', kind: '' };
  if (trial > now) {
    const d = days(trial);
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
  $('pTemplate').value = profile?.template_text ?? '';
  renderPlan();
  $('settingsDialog').showModal();
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
    .select('id, name, payer_name, payer_contact, fee_amount, due_day, lesson_slot')
    .order('name', { ascending: true });
  if (error) return fail(error, 'load your students');
  students = data ?? [];
  renderAll();
}

function visibleStudents() {
  const q = query.trim().toLowerCase();
  return students.filter((s) => {
    if (selectedDay && Number(s.due_day) !== selectedDay) return false;
    if (!q) return true;
    return [s.name, s.payer_name, s.payer_contact, s.lesson_slot]
      .some((v) => String(v ?? '').toLowerCase().includes(q));
  });
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
    + '<span class="sub truncate">' + esc(s.lesson_slot || '—') + '</span>'
    + '</li>').join('');
}

/* ------------------------------------------------------------- calendar */
const DOW = [
  ['sun', 'sunday'], ['mon', 'monday'], ['tue', 'tuesday'], ['wed', 'wednesday'],
  ['thu', 'thursday'], ['fri', 'friday'], ['sat', 'saturday'],
];

// lesson_slot is free text, so we look for a weekday word in it. No match => not listed.
function lessonsToday() {
  const today = new Date().getDay();
  const [short, long] = DOW[today];
  return students.filter((s) => {
    const t = String(s.lesson_slot ?? '').toLowerCase();
    return t.includes(long) || new RegExp('\\b' + short).test(t);
  });
}

function renderCalendar() {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  const today = new Date();

  $('calMonth').textContent = calCursor.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;   // Monday-first grid
  const dueDays = new Set(students.map((s) => Number(s.due_day)).filter(Boolean));

  let html = '';
  for (let i = 0; i < lead; i++) html += '<span></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = sameMonth(calCursor, today) && d === today.getDate();
    const cls = [isToday ? 'today' : '', selectedDay === d ? 'is-sel' : ''].filter(Boolean).join(' ');
    html += '<button type="button" class="' + cls + '" data-day="' + d + '">' + d
      + (dueDays.has(d) ? '<i class="dot"></i>' : '') + '</button>';
  }
  $('calGrid').innerHTML = html;
}

function renderSidebar() {
  const today = lessonsToday();
  $('todayList').innerHTML = today.length
    ? today.map((s) => '<li><span class="truncate">' + esc(s.name) + '</span>'
        + '<span class="t">' + esc(s.lesson_slot ?? '') + '</span></li>').join('')
    : '<li class="none">No lessons found for today.</li>';

  const total = students.reduce((sum, s) => sum + Number(s.fee_amount || 0), 0);
  $('monthSummary').textContent = students.length
    ? students.length + ' students · ' + money(total) + ' expected'
    : 'No students yet.';
}

function renderFilterBar() {
  const on = selectedDay !== null;
  $('filterBar').hidden = !on;
  if (on) $('filterLabel').textContent = 'Showing students due on the ' + ordinal(selectedDay);
}

function renderAll() {
  renderStudents();
  renderCalendar();
  renderSidebar();
  renderFilterBar();
}

$('calGrid').addEventListener('click', (e) => {
  const day = e.target.closest('button')?.dataset.day;
  if (!day) return;
  selectedDay = selectedDay === Number(day) ? null : Number(day);
  renderAll();
});

$('calPrev').onclick = () => { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1); renderCalendar(); };
$('calNext').onclick = () => { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1); renderCalendar(); };
$('clearFilter').onclick = () => { selectedDay = null; renderAll(); };

$('search').addEventListener('input', (e) => { query = e.target.value; renderStudents(); });

/* ------------------------------------------------------- add / edit / del */
function openStudent(s) {
  $('studentDialogTitle').textContent = s ? 'Edit student' : 'Add student';
  $('studentId').value = s?.id ?? '';
  $('sName').value = s?.name ?? '';
  $('sPayerName').value = s?.payer_name ?? '';
  $('sPayerContact').value = s?.payer_contact ?? '';
  $('sFee').value = s?.fee_amount ?? '';
  $('sDueDay').value = s?.due_day ?? '';
  $('sLessonSlot').value = s?.lesson_slot ?? '';
  $('deleteBtn').hidden = !s;
  $('studentDialog').showModal();
}

$('addBtn').onclick = () => openStudent(null);

$('studentList').addEventListener('click', (e) => {
  const id = e.target.closest('li')?.dataset.id;
  if (id) openStudent(students.find((s) => s.id === id));
});

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
    lesson_slot: $('sLessonSlot').value.trim() || null,
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
    profile = null;
    students = [];
    $('studentList').innerHTML = '';
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
