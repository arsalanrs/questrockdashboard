-- Full-detail capture: add the last few loan columns Shape exposes but we weren't storing,
-- plus the document-health tables used by the executive dashboard + AI chat.
-- All additive, nullable, idempotent.

-- 1. Extra loan columns ----------------------------------------------------

alter table public.loans add column if not exists property_city text null;
alter table public.loans add column if not exists property_zip text null;
alter table public.loans add column if not exists property_address text null;
alter table public.loans add column if not exists mailing_city text null;
alter table public.loans add column if not exists mailing_zip text null;
alter table public.loans add column if not exists mailing_address text null;
alter table public.loans add column if not exists subject_property_type text null;
alter table public.loans add column if not exists occupancy_type text null;
alter table public.loans add column if not exists documentation_type text null;
alter table public.loans add column if not exists is_self_employed boolean null;
alter table public.loans add column if not exists birth_date date null;
alter table public.loans add column if not exists marital_status text null;
alter table public.loans add column if not exists home_phone text null;
alter table public.loans add column if not exists work_phone text null;
alter table public.loans add column if not exists co_borrower_first_name text null;
alter table public.loans add column if not exists co_borrower_last_name text null;
alter table public.loans add column if not exists co_borrower_email text null;
alter table public.loans add column if not exists co_borrower_phone text null;
alter table public.loans add column if not exists loan_officer_email text null;
alter table public.loans add column if not exists apr_bps int null;
alter table public.loans add column if not exists lendingpad_status_raw text null;
-- (lendingpad_status_raw / _at already exist from an earlier migration but 'if not exists' is safe.)
alter table public.loans add column if not exists lendingpad_status_at timestamptz null;

-- 2. loan_documents --------------------------------------------------------
-- Mirrors LendingPad's document metadata endpoint. We never store actual files;
-- just the existence record so the AI can reason about "what is / isn't there".

create table if not exists public.loan_documents (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  source text not null default 'lendingpad',
  external_id text not null,
  name text not null,
  category text null,
  uploaded_at timestamptz null,
  matched_requirement_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loan_id, source, external_id)
);

create index if not exists loan_documents_loan_idx on public.loan_documents (loan_id);
create index if not exists loan_documents_category_idx on public.loan_documents (category);

alter table public.loan_documents enable row level security;

drop policy if exists loan_documents_select on public.loan_documents;
create policy loan_documents_select on public.loan_documents
for select using (public.current_user_role() in ('executive', 'admin'));

drop policy if exists loan_documents_service on public.loan_documents;
create policy loan_documents_service on public.loan_documents
for all using (auth.role() = 'service_role');

-- 3. required_document_templates + loan_document_status view ---------------
-- Canonical "what docs should this loan have?" reference. Everything nullable
-- except doc_name so an entry can be global (match_any) or filtered by loan_type /
-- loan_purpose / documentation_type / is_self_employed.

create table if not exists public.required_document_templates (
  id uuid primary key default gen_random_uuid(),
  doc_name text not null,
  doc_category text null,
  match_loan_type text null,
  match_loan_purpose text null,
  match_documentation_type text null,
  match_is_self_employed boolean null,
  match_is_veteran boolean null,
  priority smallint not null default 5,
  notes text null,
  keywords text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create index if not exists req_doc_templates_scope_idx on public.required_document_templates
  (match_loan_type, match_loan_purpose);

alter table public.required_document_templates enable row level security;

drop policy if exists req_doc_templates_select on public.required_document_templates;
create policy req_doc_templates_select on public.required_document_templates
for select using (public.current_user_role() in ('executive', 'admin'));

drop policy if exists req_doc_templates_service on public.required_document_templates;
create policy req_doc_templates_service on public.required_document_templates
for all using (auth.role() = 'service_role');

-- Seed a default required-doc list. Keywords are matched case-insensitively
-- against loan_documents.name + loan_documents.category for the "provided" check.

insert into public.required_document_templates (doc_name, doc_category, priority, keywords, notes)
values
  ('Government-issued ID', 'Borrower', 2, '{id,driver,license,passport,government}', 'Driver license or passport for every borrower.'),
  ('Social Security Card', 'Borrower', 5, '{social,ssn,ss card}', null),
  ('Two most recent pay stubs', 'Income', 2, '{paystub,pay stub,pay-stub}', 'Both borrowers, covering 30 days.'),
  ('W-2 (last 2 years)', 'Income', 2, '{w-2,w2,wage statement}', 'Last 2 years for W-2 employees.'),
  ('Two years tax returns', 'Income', 3, '{tax return,1040,schedule}', null),
  ('Two months bank statements', 'Assets', 2, '{bank statement,statement,checking,savings}', 'Most recent 60 days, all pages.'),
  ('Retirement / 401k statements', 'Assets', 6, '{401k,retirement,ira}', null),
  ('Gift letter + donor statement', 'Assets', 7, '{gift letter,gift}', 'Only if gift funds used.'),
  ('Purchase contract', 'Transaction', 2, '{purchase,contract,rpa,offer}', 'Purchase transactions only.'),
  ('Mortgage statement', 'Transaction', 3, '{mortgage statement,payoff}', 'Refi transactions only.'),
  ('Homeowners insurance declarations', 'Transaction', 3, '{insurance,homeowners,hazard,hoi,dec page}', null),
  ('Title commitment', 'Transaction', 4, '{title,commitment,prelim}', null),
  ('Appraisal report', 'Transaction', 3, '{appraisal}', null),
  ('Credit report', 'Credit', 3, '{credit report,tri-merge,tri merge}', null),
  ('Application (1003)', 'Borrower', 2, '{1003,application,urla}', null)
on conflict do nothing;

insert into public.required_document_templates
  (doc_name, doc_category, match_loan_purpose, priority, keywords, notes)
values
  ('Payoff statement', 'Transaction', 'Refinance', 2, '{payoff,mortgage statement}', null),
  ('Cash-out use-of-funds letter', 'Transaction', 'Cash Out Refinance', 5, '{use of funds,letter of explanation}', null)
on conflict do nothing;

insert into public.required_document_templates
  (doc_name, doc_category, match_is_self_employed, priority, keywords, notes)
values
  ('P&L + balance sheet (YTD)', 'Income', true, 3, '{p&l,profit and loss,balance sheet}', 'Self-employed borrowers only.'),
  ('Business tax returns (last 2 years)', 'Income', true, 3, '{business tax,1120,1065,schedule c,k-1}', null),
  ('CPA letter', 'Income', true, 6, '{cpa letter}', null)
on conflict do nothing;

insert into public.required_document_templates
  (doc_name, doc_category, match_is_veteran, priority, keywords, notes)
values
  ('VA Certificate of Eligibility (COE)', 'Borrower', true, 2, '{coe,certificate of eligibility,va}', 'VA loans only.'),
  ('DD-214', 'Borrower', true, 3, '{dd214,dd-214,separation}', null)
on conflict do nothing;

-- 4. Helper view -----------------------------------------------------------
-- loan_document_status_vw: one row per loan/required template with provided=true/false.
-- Used by the Document Health card + AI tool.

create or replace view public.loan_document_status_vw as
with loan_ctx as (
  select l.id as loan_id,
         l.loan_type,
         l.loan_purpose,
         l.documentation_type,
         l.is_self_employed,
         l.is_veteran,
         l.assigned_loan_officer_user_id,
         l.assigned_loan_officer_name,
         l.borrower_first_name,
         l.borrower_last_name,
         l.current_stage
  from public.loans l
),
matched_templates as (
  select lc.loan_id,
         lc.loan_type,
         lc.loan_purpose,
         lc.current_stage,
         lc.assigned_loan_officer_user_id,
         lc.assigned_loan_officer_name,
         lc.borrower_first_name,
         lc.borrower_last_name,
         t.id as template_id,
         t.doc_name,
         t.doc_category,
         t.priority,
         t.keywords
  from loan_ctx lc
  cross join public.required_document_templates t
  where (t.match_loan_type is null or t.match_loan_type = lc.loan_type)
    and (t.match_loan_purpose is null or t.match_loan_purpose = lc.loan_purpose)
    and (t.match_documentation_type is null or t.match_documentation_type = lc.documentation_type)
    and (t.match_is_self_employed is null or t.match_is_self_employed = coalesce(lc.is_self_employed, false))
    and (t.match_is_veteran is null or t.match_is_veteran = coalesce(lc.is_veteran, false))
),
doc_matches as (
  select mt.loan_id,
         mt.template_id,
         exists (
           select 1
           from public.loan_documents d
           where d.loan_id = mt.loan_id
             and (
               cardinality(mt.keywords) = 0
               or exists (
                 select 1 from unnest(mt.keywords) k
                 where lower(coalesce(d.name, '') || ' ' || coalesce(d.category, '')) like '%' || lower(k) || '%'
               )
             )
         ) as is_provided
  from matched_templates mt
)
select mt.loan_id,
       mt.loan_type,
       mt.loan_purpose,
       mt.current_stage,
       mt.assigned_loan_officer_user_id,
       mt.assigned_loan_officer_name,
       mt.borrower_first_name,
       mt.borrower_last_name,
       mt.template_id,
       mt.doc_name,
       mt.doc_category,
       mt.priority,
       dm.is_provided
from matched_templates mt
join doc_matches dm
  on dm.loan_id = mt.loan_id and dm.template_id = mt.template_id;

grant select on public.loan_document_status_vw to authenticated;

-- 5. Wire the new loan_documents table into truncate_sync_data() ----------

create or replace function public.truncate_sync_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate public.shape_sync_watermark;
  truncate
    public.raw_shape_kpi_leads,
    public.loan_checklist_entries,
    public.loan_documents,
    public.ownership_log,
    public.notifications,
    public.conditions,
    public.loan_stage_events,
    public.loans,
    public.leads,
    public.import_batches
  cascade;
end;
$$;
