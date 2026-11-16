// The app's private API. Everything except sign-in needs the session cookie.
import {
  json, checkPassword, makeSessionCookie, clearCookie, isSignedIn, env,
  loadEvents, saveEvents, buildEmail, sendEmail, recipients,
} from '../lib/common.mjs';

const MAX_EVENTS = 2000;

function cleanEvent(e) {
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const isoOk = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!e || !isoOk(e.date) || !str(e.title, 200).trim()) return null;
  return {
    id: str(e.id, 40) || Math.random().toString(36).slice(2),
    title: str(e.title, 200).trim(),
    date: e.date,
    endDate: isoOk(e.endDate) ? e.endDate : null,
    who: ['theo', 'ruby', 'both'].includes(e.who) ? e.who : 'both',
    important: !!e.important,
    flagClosed: !!e.flagClosed,
    notes: str(e.notes, 1000),
    source: str(e.source, 200),
    added: str(e.added, 40),
  };
}

// School dinners: { theo: { "2026-11-16": "dinner" | "packed" }, ruby: { ... } }
function cleanMeals(m) {
  const out = { theo: {}, ruby: {} };
  for (const child of ['theo', 'ruby']) {
    const days = m && typeof m[child] === 'object' ? m[child] : {};
    for (const [date, v] of Object.entries(days).slice(0, 800)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && (v === 'dinner' || v === 'packed')) out[child][date] = v;
    }
  }
  return out;
}

// Menus: { theo: { "2026-11-16": { main, dessert } }, ruby: { ... } }
function cleanMenus(m) {
  const out = { theo: {}, ruby: {} };
  const str = v => (typeof v === 'string' ? v.slice(0, 160) : undefined);
  for (const child of ['theo', 'ruby']) {
    const days = m && typeof m[child] === 'object' ? m[child] : {};
    for (const [date, v] of Object.entries(days).slice(0, 800)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !v || typeof v !== 'object') continue;
      const main = str(v.main), dessert = str(v.dessert);
      if (main || dessert) out[child][date] = { ...(main && { main }), ...(dessert && { dessert }) };
    }
  }
  return out;
}

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  if (!env('APP_PASSWORD')) {
    return json({ error: 'The site has no password yet. Set APP_PASSWORD in Netlify, then redeploy.' }, 503);
  }

  if (route === 'login' && req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch {}
    if (!checkPassword(body.password)) {
      await new Promise(r => setTimeout(r, 1200)); // slows down guessing
      return json({ error: 'That password isn’t right.' }, 401);
    }
    return json({ ok: true }, 200, { 'Set-Cookie': makeSessionCookie() });
  }

  if (route === 'logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
  }

  if (!isSignedIn(req)) return json({ error: 'Please sign in.' }, 401);

  if (route === 'session') {
    return json({ ok: true, emailReady: !!(env('RESEND_API_KEY') && env('REMINDER_FROM') && recipients().length), recipients: recipients().length });
  }

  if (route === 'events' && req.method === 'GET') {
    return json(await loadEvents());
  }

  if (route === 'events' && req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Bad data' }, 400); }
    if (!Array.isArray(body?.events)) return json({ error: 'Bad data' }, 400);
    const events = body.events.slice(0, MAX_EVENTS).map(cleanEvent).filter(Boolean);
    await saveEvents({ events, meals: cleanMeals(body.meals), menus: cleanMenus(body.menus) });
    return json({ ok: true, count: events.length });
  }

  if (route === 'test-email' && req.method === 'POST') {
    try {
      const sample = {
        week: [{ ev: { title: 'Test reminder: this is what a week-ahead email looks like', date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), who: 'both' }, n: 5 }],
        tomorrow: [],
      };
      const email = buildEmail(sample, env('URL'));
      const n = await sendEmail({ ...email, subject: 'Manor Park: test email' });
      return json({ ok: true, sentTo: n });
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }

  return json({ error: 'Not found' }, 404);
};

export const config = { path: '/api/*' };
