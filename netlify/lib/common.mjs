// Shared server code: sign-in cookies, the private data store, and reminder emails.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const COOKIE = 'mpd_session';
const SESSION_DAYS = 60;
const TZ = 'Europe/London';

/* ---------- Settings (all from Netlify environment variables) ---------- */
export function env(name) {
  return (globalThis.Netlify?.env?.get(name) ?? process.env[name] ?? '').trim();
}
function sessionSecret() {
  // Changing APP_PASSWORD signs everyone out, because the secret is derived from it.
  const explicit = env('SESSION_SECRET');
  const pw = env('APP_PASSWORD');
  if (!explicit && !pw) return null;
  return explicit || crypto.createHash('sha256').update('manor-park-dates:' + pw).digest('hex');
}

/* ---------- Sign-in ---------- */
export function checkPassword(given) {
  const real = env('APP_PASSWORD');
  if (!real || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

export function makeSessionCookie() {
  const secret = sessionSecret();
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const sig = crypto.createHmac('sha256', secret).update(String(exp)).digest('base64url');
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}
export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function isSignedIn(req) {
  const secret = sessionSecret();
  if (!secret) return false;
  const raw = (req.headers.get('cookie') || '')
    .split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = crypto.createHmac('sha256', secret).update(exp).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- Data ---------- */
const store = () => getStore({ name: 'manor-park-dates', consistency: 'strong' });

export async function loadEvents() {
  const data = await store().get('events', { type: 'json' });
  return Array.isArray(data?.events) ? data : { events: [] };
}
export async function saveEvents(data) {
  await store().setJSON('events', { events: data.events, savedAt: new Date().toISOString() });
}
async function loadSentLog() {
  return (await store().get('reminders-sent', { type: 'json' })) || {};
}
async function saveSentLog(log) {
  // Forget entries older than 60 days so the log stays small.
  const cutoff = Date.now() - 60 * 86400000;
  for (const [k, v] of Object.entries(log)) if (Date.parse(v) < cutoff) delete log[k];
  await store().setJSON('reminders-sent', log);
}

/* ---------- Dates ---------- */
export function londonToday() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
function longDate(iso) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(iso + 'T00:00:00Z'));
}
const WHO = { theo: 'Theo', ruby: 'Ruby', both: 'Theo & Ruby' };

/* ---------- Reminders ----------
   "Week" reminder: once, when a date is 2 to 7 days away (so dates added late still get one).
   "Tomorrow" reminder: once, the day before. The log is keyed on the event's date, so moving
   a date sends fresh reminders. */
export function dueReminders(events, log, today = londonToday()) {
  const week = [], tomorrow = [];
  for (const ev of events) {
    if (!ev?.date || !ev.title) continue;
    const n = daysBetween(today, ev.date);
    const k7 = `${ev.id}:${ev.date}:week`, k1 = `${ev.id}:${ev.date}:tomorrow`;
    if (n === 1 && !log[k1]) tomorrow.push({ ev, key: k1 });
    else if (n >= 2 && n <= 7 && !log[k7]) week.push({ ev, key: k7, n });
  }
  const order = (a, b) => a.ev.date.localeCompare(b.ev.date) || (b.ev.important ? 1 : 0) - (a.ev.important ? 1 : 0);
  return { week: week.sort(order), tomorrow: tomorrow.sort(order) };
}

export function recipients() {
  return env('NOTIFY_EMAILS').split(/[,;\s]+/).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 2);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function buildEmail({ week, tomorrow }, siteUrl) {
  const parts = [];
  if (tomorrow.length) parts.push(tomorrow.length === 1 ? `Tomorrow: ${tomorrow[0].ev.title}` : `${tomorrow.length} things tomorrow`);
  if (week.length) parts.push(`${week.length} coming up this week`);
  const subject = 'Manor Park: ' + parts.join(' · ');

  const row = ({ ev, n }) => {
    const who = WHO[ev.who] || WHO.both;
    const colour = ev.who === 'theo' ? '#2459b8' : ev.who === 'ruby' ? '#a8245e' : '#1f5a3c';
    const when = longDate(ev.date) + (ev.endDate ? ` to ${longDate(ev.endDate)}` : '') + (n ? ` (in ${n} days)` : '');
    return `<tr><td style="padding:10px 12px;border-left:4px solid ${colour};background:#f5f7f4">
      <div style="font:700 11px/1.4 Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${colour}">${esc(who)}</div>
      <div style="font:${ev.important ? 700 : 600} 16px/1.4 Arial,sans-serif;color:#18231c">${ev.important ? '★ ' : ''}${esc(ev.title)}</div>
      <div style="font:14px/1.4 Arial,sans-serif;color:#5b6b60">${esc(when)}${ev.notes ? ' · ' + esc(ev.notes) : ''}</div>
    </td></tr><tr><td style="height:6px"></td></tr>`;
  };
  const section = (title, items) => items.length
    ? `<h2 style="font:700 18px/1.3 Arial,sans-serif;color:#18231c;margin:20px 0 8px">${title}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${items.map(row).join('')}</table>`
    : '';
  const html = `<div style="max-width:560px;margin:0 auto;padding:16px">
    <div style="font:700 22px/1.2 Arial,sans-serif;color:#1f5a3c">Manor Park Dates</div>
    ${section('Tomorrow', tomorrow)}
    ${section('Coming up in the next week', week)}
    ${siteUrl ? `<p style="font:14px/1.5 Arial,sans-serif;margin-top:20px"><a href="${esc(siteUrl)}" style="color:#1f5a3c">Open the calendar</a></p>` : ''}
  </div>`;

  const line = ({ ev, n }) => `- ${WHO[ev.who] || WHO.both}: ${ev.important ? '[IMPORTANT] ' : ''}${ev.title}, ${longDate(ev.date)}${n ? ` (in ${n} days)` : ''}${ev.notes ? ` (${ev.notes})` : ''}`;
  const text = ['Manor Park Dates', '',
    ...(tomorrow.length ? ['TOMORROW', ...tomorrow.map(line), ''] : []),
    ...(week.length ? ['COMING UP IN THE NEXT WEEK', ...week.map(line), ''] : []),
    siteUrl || ''].join('\n');
  return { subject, html, text };
}

export async function sendEmail({ subject, html, text }) {
  const key = env('RESEND_API_KEY');
  const from = env('REMINDER_FROM');
  const to = recipients();
  if (!key || !from || !to.length) {
    throw new Error('Email is not set up. Add RESEND_API_KEY, REMINDER_FROM and NOTIFY_EMAILS in Netlify.');
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!res.ok) throw new Error(`The email service said no (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return to.length;
}

/** Runs the daily check. Returns a summary; never includes email addresses. */
export async function runReminders({ dryRun = false } = {}) {
  const { events } = await loadEvents();
  const log = await loadSentLog();
  const due = dueReminders(events, log);
  const count = due.week.length + due.tomorrow.length;
  if (!count) return { sent: 0, week: 0, tomorrow: 0 };
  if (!dryRun) {
    await sendEmail(buildEmail(due, env('URL')));
    const now = new Date().toISOString();
    for (const d of [...due.week, ...due.tomorrow]) log[d.key] = now;
    // A "tomorrow" email also covers the week reminder, so it isn't sent late.
    for (const d of due.tomorrow) log[`${d.ev.id}:${d.ev.date}:week`] = now;
    await saveSentLog(log);
  }
  return { sent: dryRun ? 0 : 1, week: due.week.length, tomorrow: due.tomorrow.length };
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
