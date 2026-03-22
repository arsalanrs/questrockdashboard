# Environment variables (local and Vercel)

Secrets belong in **Vercel Project → Settings → Environment Variables** for production/preview, and in **`.env.local`** on your machine (never commit `.env.local`; it is gitignored).

## Local (`.env.local`)

1. Copy the template: `cp .env.local.example .env.local`
2. Fill in values from Vercel (or from Supabase / Shape / LendingPad consoles).
3. Restart `npm run dev` after changes.

## Vercel

1. Open your project on [vercel.com](https://vercel.com) → **Settings** → **Environment Variables**.
2. Add each name exactly as in [`.env.local.example`](../.env.local.example) (case-sensitive).
3. Set **Production**, **Preview**, and/or **Development** as needed (most teams use Production + Preview for app secrets).
4. Redeploy the app (**Deployments** → ⋮ on latest → **Redeploy**) so new variables apply to serverless functions and cron routes.

### LendingPad (read-only API)

| Variable | Notes |
|----------|--------|
| `LENDINGPAD_API_URL` | Base URL only, no trailing slash (e.g. `https://testapi.lendingpad.com` or your tenant URL). |
| `LENDINGPAD_USERNAME` | Web API Basic auth username. |
| `LENDINGPAD_PASSWORD` | Web API Basic auth password. |
| `LENDINGPAD_CONTACT_ID` | UUID from Postman / LendingPad setup. |
| `LENDINGPAD_COMPANY_ID` | UUID from Postman / LendingPad setup. |
| `LENDINGPAD_LIST_USER_ID` | UUID for `GET /integrations/list/loans` and admin **list-loans** route. |
| `LENDINGPAD_SYNC_MAX_LOANS` | Optional; default 150 loans per conditions sync. |

Same values can be pasted into `.env.local` for local testing of `/api/sync/lendingpad` and LendingPad routes.

### Cron (`/api/sync/shape`, `/api/sync/lendingpad`)

Both routes support **GET** (for Vercel Cron) and **POST** (for manual / tools).

If `CRON_SECRET` is set in the Vercel project, **Vercel Cron** automatically sends **`Authorization: Bearer <CRON_SECRET>`** on scheduled runs. The app also accepts **`x-cron-secret: <same value>`** for external schedulers.

If `CRON_SECRET` is unset, only a **signed-in admin** can trigger sync (cron cannot authenticate).

## Shape / Supabase / OpenAI

See comments in [`.env.local.example`](../.env.local.example) for `SHAPE_*`, `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, etc. Use the same names in Vercel.
