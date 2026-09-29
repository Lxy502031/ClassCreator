# ClassCreator

Standalone lesson booking and management website. The public calendar and private administrator tools use the existing Crafts Galore Supabase project so its lesson settings and bookings stay intact.

## Pages

- `/` — public schedule, calendar, and reservation form
- `/admin.html` — administrator-only schedule management and booking list

The admin page requires a confirmed Supabase user with `app_metadata.role = "admin"`. Database row-level security continues to enforce access; the page check is not the only protection.

## Local preview

Run a static server from this directory on port 8100 (for example, `python -m http.server 8100`) and open `http://localhost:8100/`. The booking Edge Function allows this local origin.

## Supabase

The frontend uses the public anon key in `supabase-config.js`; do not put a service-role key or provider API key in the website. The lesson tables and migrations are retained in `supabase/migrations` for reference. They are already applied to the shared production project; do not run `supabase db push` from this repository against that project.

Deploy the Edge Function from this repository when intentionally updating the shared backend:

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
