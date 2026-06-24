-- Backfill assigned_loan_officer_user_id from stored names (comma order, suffix variants).

update public.loans l
set assigned_loan_officer_user_id = u.id
from public.users u
where l.assigned_loan_officer_user_id is null
  and l.assigned_loan_officer_name is not null
  and position(',' in l.assigned_loan_officer_name) > 0
  and lower(trim(
    split_part(l.assigned_loan_officer_name, ',', 2) || ' ' ||
    split_part(l.assigned_loan_officer_name, ',', 1)
  )) = lower(trim(u.full_name));

update public.loans l
set assigned_loan_officer_user_id = u.id
from public.users u
where l.assigned_loan_officer_user_id is null
  and l.assigned_loan_officer_name is not null
  and lower(trim(l.assigned_loan_officer_name)) = lower(trim(u.full_name));

update public.loans l
set assigned_loan_officer_user_id = u.id
from public.users u
where l.assigned_loan_officer_user_id is null
  and l.assigned_loan_officer_name is not null
  and lower(regexp_replace(trim(l.assigned_loan_officer_name), '\s+(Jr|Sr|II|III|IV)\.?$', '', 'i'))
    = lower(regexp_replace(trim(u.full_name), '\s+(Jr|Sr|II|III|IV)\.?$', '', 'i'));

-- Gregory Bethea without suffix → Gregory Bethea Jr
update public.loans l
set assigned_loan_officer_user_id = u.id
from public.users u
where l.assigned_loan_officer_user_id is null
  and lower(trim(l.assigned_loan_officer_name)) = 'gregory bethea'
  and lower(trim(u.full_name)) = 'gregory bethea jr';

-- Harrison Johnson (LP) → Tyler Johnson (app user)
update public.loans l
set assigned_loan_officer_user_id = u.id
from public.users u
where l.assigned_loan_officer_user_id is null
  and lower(trim(l.assigned_loan_officer_name)) = 'harrison johnson'
  and lower(trim(u.full_name)) = 'tyler johnson';

-- Reversed comma name: Smith Nikk → Nikk Smith
update public.loans l
set assigned_loan_officer_user_id = u.id,
    assigned_loan_officer_name = u.full_name
from public.users u
where l.assigned_loan_officer_user_id is null
  and lower(trim(l.assigned_loan_officer_name)) = 'smith nikk'
  and lower(trim(u.full_name)) in ('nikk smith', 'nikkolas smith');
