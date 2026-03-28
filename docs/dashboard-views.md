# Dashboard views by role

For a **full capability checklist** (done / partial / not done), see [dashboard-capabilities-checklist.md](./dashboard-capabilities-checklist.md).

This document summarizes what each dashboard shows and which database tables/fields back each section. RLS restricts data by role; loan officers see only their assigned loans (and unassigned loans); managers see their team’s loans; executives see all loans.

---

## Loan Officer dashboard (`/dashboard/lo`)

| Section | What it shows | Data source |
|--------|----------------|-------------|
| **KPI cards** | Active Loans, Processing, Underwriting, Conditions Outstanding, Clear to Close, Closing Soon, Past Turn Time | `loans` (current_stage, closing_date), `loan_stage_events` (days in stage), `conditions` (open count), `sla_thresholds` (max_days per stage) |
| **Pipeline** | Counts by normalized stage (e.g. processing, underwriting, clear_to_close) | `loans.current_stage` for active (non-funded) loans |
| **Action table** | Loan #, Borrower, Stage, Days in stage, Conditions, Closing date, Flag (Red = SLA exceeded, Orange = closing within 5 days, Yellow = conditions outstanding) | Same as KPIs; flags derived from sla_thresholds, loan_stage_events, conditions |
| **Production scoreboard** | MTD volume, loans closed, average loan size, revenue (configurable bps), upcoming closings | `loans` (loan_amount_cents, closed_at, closing_date) |
| **Speed metrics** | Lead → Application, Application → Submission, Submission → CTC, CTC → Close, total days | `loans` (lead_created_at, application_completed_at, closed_at), `loan_stage_events` (entered_at per stage) |

**Tables:** `loans`, `loan_stage_events`, `conditions`, `sla_thresholds`.  
**Note:** Shape sync fills `current_stage` (from Status + stage_mapping) and basic dates. Scheduled cron hits **`GET /api/sync/shape`** and runs an **incremental** sync (`updatedDateRange` + DB watermark) so daily status changes upsert into existing `loans` rows; use **full** sync from admin import or **`POST /api/sync/shape`** with `{ "mode": "full" }` for a wide `createdDateRange` rebuild. **`conditions`** rows with `source = 'lendingpad'` are filled by `GET/POST /api/sync/lendingpad` (reads LendingPad only; no LP writes). Loans must have `lendingpad_loan_uuid` set (Shape custom field **Custom Field - LendingPad Loan ID** when mapped, or manual backfill). Other `loan_stage_events` / conditions may still come from elsewhere until fully wired.

---

## Manager dashboard (`/dashboard/manager`)

| Section | What it shows | Data source |
|--------|----------------|-------------|
| **Team performance** | Aggregates for the manager’s team(s) | `teams` (manager_user_id), `loans` scoped by RLS (assigned_loan_officer in managed team) |
| **LO ranking** | Top LOs by MTD volume and closings | `loans` (assigned_loan_officer_user_id, assigned_loan_officer_name, closed_at, loan_amount_cents) |
| **Loans stuck** | Active loans exceeding SLA (by stage), sorted by days in stage | `loans`, `loan_stage_events`, `conditions`, `sla_thresholds` |
| **Upcoming closings** | Next closings for team loans | `loans` (closing_date, current_stage) |

**Tables:** `loans`, `loan_stage_events`, `conditions`, `sla_thresholds`, `teams`.

---

## Executive dashboard (`/dashboard/executive`)

| Section | What it shows | Data source |
|--------|----------------|-------------|
| **Revenue & volume** | MTD volume, loans closed, average loan size, revenue (e.g. 250 bps), upcoming closings | `loans` (loan_amount_cents, closed_at, closing_date) |
| **Marketing ROI (funnel)** | Leads, Applications Completed, Credit Pulled, Appraisals Requested (MTD); Lead→App avg days | `loans` (lead_created_at, application_completed_at, credit_report_requested_at, appraisal_requested_at) |
| **Lead source / UTM** | Top sources and UTM campaigns (MTD leads) | `loans` (source, utm_campaign) |
| **State performance** | Loan count by property state | `loans` (property_state) |
| **QuestRock lifecycle** | Verification / Validation / Close / Fund counts; gate metrics (e-sign returned, appraisal payment, both = Validation Launch) | `loans` (`current_stage`, `esign_returned_at`, `appraisal_payment_collected_at`, generated `validation_launched_at`) |

**Tables:** `loans`.  
**Note:** Shape sync maps Source and Property State; add UTM to field-map if Shape returns it. **Validation Launch** (PDF): both `esign_returned_at` and `appraisal_payment_collected_at` must be set; `validation_launched_at` is computed in the database. Shape `trkEsignReturned` / `trkAppraisalPaymentCollected` (or matching custom fields) populate those dates when present. See [environment-variables.md](./environment-variables.md) for Vercel/local env setup including LendingPad.

---

## Processor dashboard (`/dashboard/processor`)

Shows the processing queue: loans in processing, submission, underwriting, or conditions. Uses `loans` filtered by `current_stage` in those stages, plus `loan_stage_events` (days in stage) and `conditions` (open count). RLS limits to loans in processing-related stages.

---

## Closer dashboard (`/dashboard/closer`)

Shows loans in clear_to_close or closing. Uses `loans` filtered by `current_stage`, plus `loan_stage_events` and `conditions`. RLS limits to those stages.
