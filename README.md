# ClassCreator

Standalone lesson booking and management website. The public calendar and private administrator tools use the existing Crafts Galore Supabase project so its lesson settings and bookings stay intact.

## Pages

- `/` — public schedule, calendar, and reservation form
- `/admin.html` — administrator-only weekly and date-specific schedule controls, student capacity, and editable bookings
- The home page also has separate teacher and student product galleries. Students can create an account and submit products; uploads are validated for file type and size and published without an automated image review.

The admin page requires a confirmed Supabase user authorized by the database administrator list. The original primary administrator also retains the existing `app_metadata.role = "admin"` check. Database row-level security continues to enforce access; the page check is not the only protection.

The administrator can edit the regular weekly days and hours, session length, capacity (1–50 students), booking horizon, class details, and whether bookings are open. One-off date overrides can add sessions outside the weekly schedule, change hours/length/capacity for a particular date, or close a date. Upcoming bookings can be edited or rescheduled to a valid, available session, or cancelled. The footer’s subtle “Studio sign-in” link opens the protected admin page; the link’s low visibility is only a convenience, not an access control.

To add another studio administrator, first create and verify their Supabase Auth account, then sign in to the admin page and add their verified email under “Studio administrators.” Administrators can remove other added administrators; the original primary administrator cannot be removed.

## Local preview

Run a static server from this directory on port 8100 (for example, `python -m http.server 8100`) and open `http://localhost:8100/`. The booking Edge Function allows this local origin.

## Supabase

The frontend uses the public anon key in `supabase-config.js`; do not put a service-role key or provider API key in the website. The lesson tables and migrations are retained in `supabase/migrations` for reference. Apply these migrations in order in the Supabase SQL Editor before using the updated admin tools or availability endpoint:

1. `20260929030000_expand_lesson_scheduling_controls.sql` adds capacity, date overrides, and editable/reschedulable bookings.
2. `20260929040000_manage_lesson_admins.sql` adds administrator management and updates database authorization.
3. `20260930010000_student_product_gallery.sql` adds the public product galleries, image storage, student upload limits, and gallery permissions.

Do not run `supabase db push` from this repository against the shared project.

### Product galleries

Apply the gallery migration in the Supabase SQL Editor after the listed lesson migrations. In Supabase Authentication settings, enable student email/password sign-up and email confirmation; add the production website URL and local preview URL to the allowed redirect URLs. Students create their own accounts with a display name, confirm their email, and sign in to submit a JPEG, PNG, or WebP image (up to 5 MB) with a description. The name on their account is shown with the product. Student products are published without an automated image review. Each account can submit up to 10 products per 24 hours.

Set `SITE_URL` to the production site's origin for the function's origin check, then deploy the function:

```powershell
npx supabase functions deploy gallery-submit --project-ref ulahmnqqafztbcyzfuej --no-verify-jwt
```

The teacher can add or remove products in the new **Qingqing’s creations** panel on `/admin.html`. Student image files are checked for supported formats and signatures, but their product descriptions are not automatically verified.

Automated image review is currently disabled in `supabase/functions/gallery-submit/index.ts` so submissions do not depend on OpenAI API availability. To restore it later, enable `IMAGE_CHECK_ENABLED` and configure `OPENAI_API_KEY` as a Supabase Edge Function secret.

After the database migration is applied, deploy the Edge Function from this repository to update the public booking error message:

```powershell
npx supabase functions deploy lesson-booking --project-ref ulahmnqqafztbcyzfuej --no-verify-jwt
```

### Free Gmail confirmation email

The recommended no-domain setup uses Google Apps Script to send confirmations from the administrator's Gmail account. Consumer Google accounts currently have a 100-recipient daily MailApp quota; the included script caps this integration at 90 sends per UTC day to leave some headroom. Google can change quotas, and delivery is subject to Gmail spam controls.

1. Sign in to the Gmail account you want students to see as the sender.
2. Open [Google Apps Script](https://script.google.com/) and create a new project.
3. Copy `google-apps-script/Code.gs` into the script editor.
4. In **Project Settings → Script Properties**, add `BOOKING_EMAIL_TOKEN` with a long random secret value. Generate it locally, for example: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Do not paste the value into chat, GitHub, or this repository.
5. Select **Deploy → New deployment → Web app**. Set **Execute as** to your account and **Who has access** to **Anyone**, then deploy and authorize the requested Gmail permissions. Anyone can reach the endpoint, but only requests with the secret token are accepted.
6. Copy the deployed Web app URL (ending in `/exec`). In Supabase → **Edge Functions → Secrets**, set `GOOGLE_APPS_SCRIPT_URL` to that URL and `GOOGLE_APPS_SCRIPT_TOKEN` to the same secret used in Script Properties.
7. Deploy the `lesson-booking` Edge Function using the command above. New reservations will send a confirmation to the student's email address; test with an address you control before relying on it.

The site sends through Google Apps Script when both Google secrets are configured; otherwise it falls back to Resend if configured. Never add provider keys or tokens to the website or commit them. Resend's free transactional email plan includes up to 3,000 emails/month (100/day), but sending requires a domain you own and verify; a `netlify.app` subdomain is not a substitute for a domain with DNS control.

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the Edge Function. Never add secret values to this repository or paste them into source files.
