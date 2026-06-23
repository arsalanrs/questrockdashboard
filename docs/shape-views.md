# Shape Pipeline Views

QRdashboard mirrors Nikk's Shape saved views as the primary LO and manager pipeline experience.

## Record-type tabs

| Tab | Shape record types | Views |
|-----|-------------------|-------|
| **Leads** | `Leads` | New Leads & Follow-Up Queue, Long Term Nurture |
| **Applications** | `Applications` | Pre-App Sent/Started/Completed, Docs Requested/Received |
| **Loans** | `Loans` | Verification, Package Out, Pipeline Visibility (11), Closing, Anniversaries, Leads to Advance |
| **All Records** | all | Branch Builder queues; text/email engagement deferred (Phase 1b) |

## Global exclusions

Applied in sync (`lib/shape-api/sync.ts`) and view queries (`lib/shape-views/global-filters.ts`):

- Sources: `zWebLead - VISIT`, `zWebLead - Visit`, `zCRM Import`, `Test Lead`, `Inbound Shape Call`
- Record types: Referral Partner, Referral Partners, Contact

## Status normalization

Shape bulk export often stores short statuses (`App Sent`). Nikk's saved views use prefixed labels (`Lead Status - App Sent`, `POS Status - …`). `lib/shape-views/status-normalize.ts` strips prefixes and normalizes en-dashes before matching.

Optional columns on `loans`:

- `portal_status_raw` — POS / portal column when distinct from `status_raw`
- `conversion_date` — Shape conversion date
- `last_status_change_at` — preferred sort key for pipeline visibility; falls back to `shape_last_updated_at`

## Sort fields

| View sort | Column |
|-----------|--------|
| `created` asc/desc | `lead_created_at` |
| `conversion` desc | `conversion_date` → `application_completed_at` |
| `last_status_change` | `last_status_change_at` → `shape_last_updated_at` |

## Access control

- **LO** (`/dashboard/lo`): RLS — assigned loans only
- **Manager** (`/dashboard/manager`): team scope via RLS + optional LO filter dropdown
- **Admin view-as** (`?viewAs=<user-id>`): executive/admin only

## 90-day window

Default fetch: `lead_created_at >= 90d ago OR shape_last_updated_at >= 90d ago`, max 2000 rows. Anniversary and funded sub-views apply additional date filters in view rules.

## Clean rebuild (Phase 0)

1. `POST /api/admin/reset-loans` (admin or `CRON_SECRET`) — wipes loans + children, resets watermark
2. Admin Import → **Clean 90-day rebuild** — reset + Shape sync (90d) + LendingPad sync
3. Or CLI: `node scripts/reset-operational-loans.mjs --confirm`

## Reconciliation

```bash
node scripts/reconcile-shape-views.mjs
node scripts/reconcile-shape-views.mjs --lo=<assigned_loan_officer_user_id>
```

Compare Supabase status histograms to Nikk's Shape view counts. Fix gaps in `stage_mapping` and sync field map as needed.

## Code layout

```
lib/shape-views/
  global-filters.ts
  status-normalize.ts
  views-leads.ts
  views-applications.ts
  views-loans.ts
  views-all-records.ts
  query-loans.ts
  index.ts
```

## Deferred (Phase 1b)

**Recent Text/Email Engagement** — requires Shape activity fields not yet confirmed in bulk export. View shows placeholder until fields are added to `lib/shape-api/fields.ts`.
