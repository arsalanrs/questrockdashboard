-- Ensure API (service_role) and anon can resolve the doc-status view used by exec AI tools.
-- Authenticated was already granted in 20260418000700; service_role sometimes needs explicit
-- SELECT on views in hosted Postgres configurations.

grant select on public.loan_document_status_vw to service_role;
