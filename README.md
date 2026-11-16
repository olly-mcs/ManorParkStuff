# Manor Park Dates

A simple month-by-month calendar for Theo's and Ruby's school dates.

- **Upload a PDF** (letters, newsletters) or **paste an email**. The dates it finds come up for review:
  tap **✓** to add one or **✕** to skip it, pick **Theo / Ruby / Both**, and star anything important.
- Anything mentioning **Year 3** or **Sycamore** class is tagged Theo, and **Year 1** or **Hazel** class is tagged Ruby. Dates that only mention other
  years or classes (Reception, Y2, Willow, Cedar…) are labelled so they're easy to skip, and **Add all** leaves them out.
- Lines under a date in a pasted email are kept as **notes**. If the date is already on the calendar,
  ✓ adds the notes to it instead of making a copy.
- **School dinners:** upload Theo's and Ruby's dinner PDFs separately. Every date in the PDF is a school dinner day,
  and every other weekday in the weeks it covers is a packed lunch day (INSET days and holidays on the calendar are left out).
  You check the days before saving. Each school day on the calendar then shows "Theo: School dinner / Packed lunch" and
  the same for Ruby; tap one to switch it. The next school day's lunches are shown at the top of the page.
- Anything in the next 7 days is **flagged** at the top until you press **Close flag**.
- **Email reminders** go to two addresses each morning: one when a date is a week away, and one the day before.
- The site is behind a **family password**. The dates and email addresses are stored on the server, not in the page.

## Setting it up on Netlify (one time)

1. In Netlify: **Add new site → Import an existing project → GitHub → olly-mcs/ManorParkStuff**.
   Leave the build settings as they are (they come from `netlify.toml`) and deploy.
2. Go to **Site configuration → Environment variables** and add:

   | Name | What to put |
   | --- | --- |
   | `APP_PASSWORD` | The family password for signing in. Changing it signs everyone out. |
   | `NOTIFY_EMAILS` | The two addresses, separated by a comma: `one@example.com, two@example.com` |
   | `RESEND_API_KEY` | From [resend.com](https://resend.com) (free plan is plenty) → API Keys |
   | `REMINDER_FROM` | Who the email is from, e.g. `Manor Park Dates <reminders@yourdomain.com>` |

   Resend only sends to other people from a domain you've verified there (Resend → Domains),
   so `REMINDER_FROM` must use that domain.
3. **Deploys → Trigger deploy** so the settings take effect.
4. Open the site, sign in, and press **Send a test email** at the bottom of the page.

The email addresses are only ever in Netlify's settings. They're not in this repository or the web page,
and the page never shows them.

## How it fits together

| What | File |
| --- | --- |
| Page | `index.html`, `styles.css` |
| Calendar, review, sign-in screen | `app.js` |
| Finding dates in text; Theo = Year 3 / Sycamore, Ruby = Year 1 / Hazel | `parser.js` (`CHILD_YEARS`, `CHILD_CLASSES`) |
| PDF reader (pdf.js 3.11.174, Apache 2.0) | `vendor/` |
| Sign-in, saving dates, test email | `netlify/functions/api.mjs` |
| Daily reminder emails (06:30 UTC) | `netlify/functions/daily-reminders.mjs` |
| Shared server code | `netlify/lib/common.mjs` |

Dates are stored with Netlify Blobs. **Download backup** saves a copy as a file, and **Restore backup** loads one.

Opened without Netlify (for example `python3 -m http.server`), the page runs in preview mode:
no sign-in, dates saved in that browser only, and no emails.

```bash
npm install
npm test          # checks the date finder
npx netlify dev   # runs the site with sign-in and storage locally
```
