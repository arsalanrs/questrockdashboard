# Dashboard capabilities checklist

Living inventory of what the QuestRock / QRdashboard app **does today**, what is **partial**, and what is **not implemented** yet. Based on the codebase as of this document’s last update.

---

## Legend

- [x] **Done** — implemented and wired for intended use  
- [~] **Partial** — exists but stubbed, placeholder UI, API/UI mismatch, or env-dependent  
- [ ] **Not done** — no meaningful implementation or explicitly out of scope below  

---

## 1. Application shell & access

| Status | Capability |
|--------|------------|
| [x] | Supabase Auth login (`/login`) and session refresh via middleware |
| [x] | Protected routes: `/dashboard/*`, `/admin/*` (unauthenticated → `/login?redirectTo=…`) |
| [x] | App user profile from `public.users` (role, team, active flag); inactive users bounced |
| [x] | Root `/` redirects to `/dashboard/lo` |
| [x] | Dashboard chrome: QuestRock branding, glass-style header, sign out |
| [x] | Role-gated nav links (Loan Officer always; Manager / Processor / Closer / Executive / Admin per `lib/permissions.ts`) |
| [ ] | **Advisor** page (`/dashboard/advisor`) is **not linked** in the main nav (direct URL only) |

**Roles in code:** `executive`, `manager`, `loan_officer`, `processor`, `closer`, `admin`

---

## 2. Loan Officer dashboard (`/dashboard/lo`)

| Status | Capability |
|--------|------------|
| [x] | Load loans (up to 2000) with nested `loan_stage_events`, `conditions` (open/cleared counts) |
| [x] | SLA thresholds from `sla_thresholds`; hours in current stage vs max hours |
| [x] | Flag logic: SLA exceeded (red), restructure/eSign risk (green), closing soon (orange), open conditions (yellow) |
| [x] | Contingency / lock “approaching” helpers (finance, appraisal contingency, lock expiration) |
| [x] | **Command center** slice: loans whose Shape `status_raw` maps to command-center statuses |
| [x] | **Pre-pipeline** slice: leads/apps not yet in command-center flow (with drill-down UI) |
| [x] | **Pitch queue** slice by status set |
| [x] | **Micro pipeline**: stage columns, counts, volume, turn-time copy, expand row → loan table |
| [x] | **Macro pipeline**: rolled-up stages with micro keys |
| [x] | **Appraisal tracker**: ordered vs not received |
| [x] | **Leaderboard** (with exclusions for certain statuses) |
| [x] | **Production / speed** style metrics (MTD volume, closings, averages, funnel timing) |
| [x] | Stat cards and action-oriented table views |
| [x] | Links to Shape (when `shape_record_id` present), LendingPad login URL, Teams (hardcoded URLs in components) |
| [x] | **View-as** (`?viewAs=<user id>`): executives/admins can impersonate another LO/manager/executive’s **loan list** (admin client fetch) |
| [~] | Micro pipeline **side panel**: borrower summary + external links; **no** DB-backed checklist component in panel (static `DOC_CHECKLISTS` in `lib/loan-status-groups` only) |

---

## 3. Manager dashboard (`/dashboard/manager`)

| Status | Capability |
|--------|------------|
| [x] | Team-scoped loans via RLS + `teams` / manager assignment |
| [x] | Stat cards, pipeline summary |
| [x] | LO ranking (MTD volume / closings) |
| [x] | “Stuck” loans (SLA exceeded) |
| [x] | Upcoming closings |

---

## 4. Executive dashboard (`/dashboard/executive`)

| Status | Capability |
|--------|------------|
| [x] | Loads up to 5000 loans (admin client) + LO name list for filters |
| [x] | **ExecutiveFilters** client UI: revenue/volume, funnel, sources, UTM, state, QuestRock lifecycle gates |
| [x] | Pie charts (dynamic import) for breakdowns |
| [x] | Validation launch / e-sign / appraisal payment fields where present on `loans` |

---

## 5. Processor dashboard (`/dashboard/processor`)

| Status | Capability |
|--------|------------|
| [x] | Queue for stages: processing, submission, underwriting, conditions (and related) |
| [x] | Pipeline overview cards with SLA exceed indicators |
| [x] | Work queue table: loan #, borrower, type, stage, hours in stage, open conditions, assigned LO, SLA badge |
| [~] | **Game Plan** section is a **placeholder** (“Select a loan above…”) — no interactive loan selection or embedded checklist |

---

## 6. Closer dashboard (`/dashboard/closer`)

| Status | Capability |
|--------|------------|
| [x] | Queue for `clear_to_close` and `closing` |
| [x] | Simple table sorted by closing date |

---

## 7. Admin “Team View” (`/dashboard/admin-view`)

| Status | Capability |
|--------|------------|
| [x] | Executive/admin only |
| [x] | **LoSelector**: pick an LO |
| [x] | Pipelined view of that LO’s loans (stages, counts, lists) |
| [~] | Optional **Shape deep link** if `NEXT_PUBLIC_SHAPE_LEAD_BASE_URL` is set |

---

## 8. Admin import & operations (`/admin/import`)

| Status | Capability |
|--------|------------|
| [x] | **CSV import** (Shape KPI-style) via form → server action |
| [x] | **JSON CSV import** API: `POST /api/import/shape-kpi` (`csvText`, admin-only) |
| [x] | **Shape API sync** preview UI + **Sync now** (full `createdDateRange` path from admin button) |
| [x] | **Clear synced data**: RPC `truncate_sync_data` (raw, loans, leads, import batches, watermark, etc.) |
| [x] | **Mock loans** generator (demo volume) |
| [x] | **Enrich** existing loans (mock fields) |
| [x] | **Seed initial org** (demo users/teams; documented password) |
| [x] | **Create team**, **create user + assign** |
| [x] | **Reset user password** (admin) |

---

## 9. AI Guideline Advisor (`/dashboard/advisor`)

| Status | Capability |
|--------|------------|
| [x] | Chat UI → `POST /api/advisor/chat` |
| [~] | **OpenAI**: works when `OPENAI_API_KEY` is set; otherwise returns a friendly “not configured” assistant message |
| [ ] | Not in main navigation |

---

## 10. Notifications (header bell)

| Status | Capability |
|--------|------------|
| [~] | **UI** polls `GET /api/notifications` every 60s |
| [~] | **API** returns `{ notifications: [...] }` with `is_read`, `title`, `body`, `created_at` |
| [ ] | **Client bug**: bell treats **entire JSON body** as an array — notifications list will not populate correctly until response shape is aligned |
| [ ] | **Mark all read** sends `PATCH` **without** `ids` body; API requires `ids: string[]` — mark-read path non-functional as wired |

---

## 11. Loan checklist & conditions (APIs & components)

| Status | Capability |
|--------|------------|
| [x] | `GET /api/loans/[loanId]/conditions` — list conditions (RLS) |
| [x] | `GET /api/loans/[loanId]/checklist` — resolve `loan_type_checklists` + merge `loan_checklist_entries` |
| [ ] | **No `PATCH`/`PUT`** on checklist route — entries cannot be updated via this API from the app |
| [ ] | **`LoanChecklist` React component** exists but is **not imported** on any page — DB-backed checklist UI not surfaced |

---

## 12. LendingPad integration

| Status | Capability |
|--------|------------|
| [x] | **Cron + manual**: `GET`/`POST /api/sync/lendingpad` → optional **`runLendingPadLoansSync`** (when `LENDINGPAD_LIST_USER_ID` set) then **`runLendingPadConditionsSync`** |
| [x] | **Loan list:** maps list/loans JSON into `loans` (`lendingpad_loan_uuid`, `lendingpad_loan_number`, borrower, amount, LP status → `current_stage` via [`lib/lendingpad/map-lp-status-to-stage.ts`](../lib/lendingpad/map-lp-status-to-stage.ts)) |
| [x] | Reads conditions for loans with `lendingpad_loan_uuid`; upserts `public.conditions` with `source = 'lendingpad'` |
| [x] | Cap: `LENDINGPAD_SYNC_MAX_LOANS` (default 150, max clamp in code) |
| [x] | **Admin** `GET /api/lendingpad/list-loans` — list LP loans for mapping |
| [x] | **Proxy-style** routes: `/api/lendingpad/loans/[id]/conditions`, `.../documents` (auth + config checks) |
| [ ] | **No write-back** to LendingPad from this app (read-only design) |

---

## 13. Shape integration

| Status | Capability |
|--------|------------|
| [x] | Bulk export client; field map; `loans` upsert on `shape_record_id` |
| [x] | Raw rows → `raw_shape_kpi_leads` + `import_batches` |
| [x] | Stage mapping via `stage_mapping` table; unmapped status reporting on sync result |
| [x] | **Cron `GET /api/sync/shape`**: incremental `updatedDateRange` + `shape_sync_watermark` (1-day overlap; bootstrap window when no watermark) |
| [x] | **`POST /api/sync/shape`**: `mode: "full" | "incremental"`, optional `dateFrom`/`dateTo` for full |
| [x] | **Admin sync button**: `mode: "full"` |
| [ ] | **Does not** populate `public.leads` from Shape (loans + raw only) |
| [~] | Depends on Shape API semantics for `updatedDateRange` (status-only changes must be returned by vendor) |

---

## 14. GoHighLevel (GHL)

| Status | Capability |
|--------|------------|
| [x] | `POST /api/webhooks/ghl` accepts JSON; optional `x-webhook-secret` vs `GHL_WEBHOOK_SECRET` |
| [ ] | **Stub only**: logs warning, does **not** parse payload or upsert **`leads`** |
| [ ] | `lib/ghl/client.ts` — `fetchContacts` / `fetchContact` stubs |

---

## 15. Data model & RLS (behavioral)

| Status | Capability |
|--------|------------|
| [x] | Primary operational entity for dashboards: **`loans`** |
| [x] | RLS restricts rows by role (LO sees assigned + unassigned patterns per migrations) |
| [x] | Executive dashboard uses **service role** for broad read (bypasses RLS) — intentional for exec view |
| [x] | `loan_stage_events`, `conditions`, `sla_thresholds`, `teams`, `users`, notifications, checklist tables exist in schema |
| [ ] | **`leads` table** — not fed by Shape sync in this repo; GHL not writing to it |

---

## 16. Scheduled jobs (Vercel Cron)

| Status | Capability |
|--------|------------|
| [x] | Daily `GET /api/sync/shape` (UTC schedule in `vercel.json`) |
| [x] | Daily `GET /api/sync/lendingpad` (offset schedule in `vercel.json`) |
| [ ] | **Weekly full Shape reconcile** — not scheduled (plan out-of-scope) |
| [~] | Cron auth requires `CRON_SECRET` (or admin-only manual trigger if unset) |

---

## 17. Developer / ops surfaces

| Status | Capability |
|--------|------------|
| [x] | `docs/dashboard-views.md` — view-by-role data sources |
| [x] | `docs/environment-variables.md` — env + cron + Shape modes |
| [x] | `.env.local.example` for local setup |
| [x] | Supabase migrations for schema, RLS, truncate RPC, watermark |
| [ ] | Automated **E2E or integration tests** for sync/dashboard (not enumerated in repo as a standard suite) |

---

## 18. Summary: not done or partial (quick scan)

**Not done**

- GHL webhook processing → `leads`
- GHL API client real implementation
- Nav link to AI Advisor
- Functional notifications list + mark-read (wire/API shape)
- DB checklist **editing** API and UI wired to processor “Game Plan” or LO panel
- `LoanChecklist` component mounted on a page
- Shape → `leads` pipeline
- Scheduled weekly full Shape sync
- LendingPad write operations

**Partial / env-dependent**

- AI Advisor without `OPENAI_API_KEY`
- LendingPad sync without env / without `lendingpad_loan_uuid` on loans
- Incremental Shape sync depends on vendor `updatedDateRange` behavior
- Executive admin-client read vs RLS model (by design for exec)

---

## 19. How to keep this doc current

When you add a route, table writer, or dashboard section, append a row under the right section and flip `[ ]` → `[x]` or add a `[~]` note. For intentional stubs, keep them under **Not done** with a pointer to the file (e.g. `app/api/webhooks/ghl/route.ts`).
