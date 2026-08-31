// RemindClient — Stage 1: auth + student CRUD.
// Only dependency: supabase-js v2 from a pinned CDN build. No build step.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let user = null;
let profile = null;
let students = [];
let mode = 'signin';   // 'signin' | 'signup'

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
  $('authSubmit').textContent = mode === 'signin' ? 'Sign in' : 'Create account';
  $('password').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
}

$('tabSignIn').onclick = () => setMode('signin');
$('tabSignUp').onclick = () => setMode('signup');

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

$('signOutBtn').onclick = async () => {
  await sb.auth.signOut();
};

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
  renderStudents();
}

function renderStudents() {
  const list = $('studentList');
  $('studentCount').textContent = students.length ? '(' + students.length + ')' : '';
  $('emptyState').hidden = students.length > 0;

  list.innerHTML = students.map((s) => {
    const bits = [
      s.fee_amount ? '<span class="money">' + money(s.fee_amount) + '</span>' : '',
      s.due_day ? 'due ' + ordinal(s.due_day) : '',
      s.lesson_slot ? esc(s.lesson_slot) : '',
    ].filter(Boolean).join(' · ');
    const payer = [s.payer_name, s.payer_contact].filter(Boolean).map(esc).join(' · ');

    return '<li class="student" data-id="' + s.id + '">'
      + '<div class="name">' + esc(s.name) + '</div>'
      + (payer ? '<div class="meta">' + payer + '</div>' : '')
      + (bits ? '<div class="meta">' + bits + '</div>' : '')
      + '<div class="actions">'
      + '<button class="link" data-edit="' + s.id + '" type="button">Edit</button>'
      + '<button class="link danger" data-del="' + s.id + '" type="button">Delete</button>'
      + '</div></li>';
  }).join('');
}

function openStudent(s) {
  $('studentDialogTitle').textContent = s ? 'Edit student' : 'Add student';
  $('studentId').value = s?.id ?? '';
  $('sName').value = s?.name ?? '';
  $('sPayerName').value = s?.payer_name ?? '';
  $('sPayerContact').value = s?.payer_contact ?? '';
  $('sFee').value = s?.fee_amount ?? '';
  $('sDueDay').value = s?.due_day ?? '';
  $('sLessonSlot').value = s?.lesson_slot ?? '';
  $('studentDialog').showModal();
}

$('addBtn').onclick = () => openStudent(null);

$('studentList').addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;

  if (editId) return openStudent(students.find((s) => s.id === editId));

  if (delId) {
    const s = students.find((x) => x.id === delId);
    if (!confirm('Delete ' + (s?.name ?? 'this student') + '? This cannot be undone.')) return;
    const { error } = await sb.from('students').delete().eq('id', delId);
    if (error) return fail(error, 'delete that student');
    students = students.filter((x) => x.id !== delId);
    renderStudents();
    toast('Student deleted.');
  }
});

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
