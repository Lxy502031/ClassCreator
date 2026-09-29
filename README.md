# ClassCreator

Standalone lesson booking and management website. The public calendar and private administrator tools use the existing Crafts Galore Supabase project so its lesson settings and bookings stay intact.

## Pages

- `/` — public schedule, calendar, and reservation form
- `/admin.html` — administrator-only weekly and date-specific schedule controls, student capacity, and editable bookings

The admin page requires a confirmed Supabase user authorized by the database administrator list. The original primary administrator also retains the existing `app_metadata.role = "admin"` check. Database row-level security continues to enforce access; the page check is not the only protection.

The administrator can edit the regular weekly days and hours, session length, capacity (1–50 students), booking horizon, class details, and whether bookings are open. One-off date overrides can add sessions outside the weekly schedule, change hours/length/capacity for a particular date, or close a date. Upcoming bookings can be edited or rescheduled to a valid, available session, or cancelled. The footer’s subtle “Studio sign-in” link opens the protected admin page; the link’s low visibility is only a convenience, not an access control.

To add another studio administrator, first create and verify their Supabase Auth account, then sign in to the admin page and add their verified email under “Studio administrators.” Administrators can remove other added administrators; the original primary administrator cannot be removed.

## Local preview

Run a static server from this directory on port 8100 (for example, `python -m http.server 8100`) and open `http://localhost:8100/`. The booking Edge Function allows this local origin.

## Supabase

The frontend uses the public anon key in `supabase-config.js`; do not put a service-role key or provider API key in the website. The lesson tables and migrations are retained in `supabase/migrations` for reference. Apply these migrations in order in the Supabase SQL Editor before using the updated admin tools or availability endpoint:

1. `20260929030000_expand_lesson_scheduling_controls.sql` adds capacity, date overrides, and editable/reschedulable bookings.
2. `20260929040000_manage_lesson_admins.sql` adds administrator management and updates database authorization.

Do not run `supabase db push` from this repository against the shared project.

After the database migration is applied, deploy the Edge Function from this repository to update the public booking error message:

```powershell
npx supabase functions deploy lesson-booking --project-ref ulahmnqqafztbcyzfuej --no-verify-jwt
```

### Resend email

Add these secrets in Supabase → Edge Functions → Secrets:

- `RESEND_API_KEY`: a Resend key with **Sending access**
- `LESSON_FROM_EMAIL`: `onboarding@resend.dev` for Resend's test sender, or an address on a verified custom domain for real student confirmations
- `LESSON_TEST_RECIPIENT`: the email address associated with the Resend account for test sends only
- `LESSON_SITE_URL`: the deployed ClassCreator site origin, when available

When `LESSON_TEST_RECIPIENT` is set, confirmation messages are routed only to that fixed test inbox, never to the student-provided address. The booking page explicitly says this is test delivery. Remove that secret only when a verified custom sending domain is ready and real student email delivery is intended. Resend's test sender cannot send to arbitrary students.

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the Edge Function. Never add secret values to this repository or paste them into source files.
