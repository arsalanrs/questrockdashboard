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

Schedules in [`vercel.json`](../vercel.json) use **UTC**. Current jobs: **13:00** and **13:30 UTC** daily — that is **8:00 AM / 8:30 AM Eastern Standard Time (EST, UTC−5)**. When the US is on **daylight time (EDT, UTC−4)**, the same UTC run happens at **9:00 AM / 9:30 AM** local Eastern. Vercel cron has no timezone field; adjust the hour twice a year if you need exactly 8:00 AM local Eastern year-round (e.g. use **12:00 UTC** during EDT for 8 AM Eastern).

Both routes support **GET** (for Vercel Cron) and **POST** (for manual / tools).

#### Shape sync modes (`/api/sync/shape`)

| Method | Default behavior |
|--------|-------------------|
| **GET** (cron) | **Incremental:** Shape `updatedDateRange` from the stored watermark (with a 1-day overlap) so status and other field changes on existing records are picked up without scanning ~2 years of creations daily. First run with no watermark uses a **30-day** `updatedDateRange` bootstrap window. |
| **POST** | **`mode` in JSON body** (default **`full`** for backward compatibility): **`full`** uses `createdDateRange` (~2 years, or **`dateFrom` / `dateTo`** if both sent). **`incremental`** uses the same watermark path as GET. |

After a successful run (either mode), the app updates the **`shape_sync_watermark`** row so the next incremental window advances. **`truncate_sync_data`** (admin “clear sync data”) truncates that table too so the next incremental run bootstraps again.

If `CRON_SECRET` is set in the Vercel project, **Vercel Cron** automatically sends **`Authorization: Bearer <CRON_SECRET>`** on scheduled runs. The app also accepts **`x-cron-secret: <same value>`** for external schedulers.

If `CRON_SECRET` is unset, only a **signed-in admin** can trigger sync (cron cannot authenticate).

## Shape / Supabase / OpenAI

See comments in [`.env.local.example`](../.env.local.example) for `SHAPE_*`, `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, etc. Use the same names in Vercel.
