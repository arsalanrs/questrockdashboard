-- ─────────────────────────────────────────────────────────────────────────────
-- QuestRock Org Update — June 2026
--
-- Roster:
--   Executives/Admins : Bill Medley, Ray Conway, Nikk Smith
--   Managers          : Bastian Johnston (Team T-Rex)
--                       Tashawna Chisholm (Team Pumps and Profit)
--                       Jason Friday (Director of Growth)
--   Loan Officers     : Tyler Johnson  (Team T-Rex)
--                       Stephen Curry  (Team T-Rex)
--                       Gregory Bethea Jr (Team T-Rex)
--                       Zachary Davis  (Team T-Rex)
--
-- No longer with QuestRock (deactivated): Chamell Scardina, Matt Icard,
--                                          Jessica Sherard
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Update roles for known users ──────────────────────────────────────────

UPDATE public.users SET role = 'executive', is_active = true
  WHERE full_name ILIKE '%Bill Medley%'    OR email ILIKE '%bill%questrock%';

UPDATE public.users SET role = 'executive', is_active = true
  WHERE full_name ILIKE '%Ray Conway%'     OR email ILIKE '%ray%questrock%';

UPDATE public.users SET role = 'executive', is_active = true
  WHERE full_name ILIKE '%Nikk Smith%'     OR email ILIKE '%nikk%questrock%';

UPDATE public.users SET role = 'manager', is_active = true
  WHERE full_name ILIKE '%Bastian Johnston%';

UPDATE public.users SET role = 'manager', is_active = true
  WHERE full_name ILIKE '%Tashawna Chisholm%';

UPDATE public.users SET role = 'manager', is_active = true
  WHERE full_name ILIKE '%Jason Friday%'   OR email ILIKE 'jfriday@questrock.com';

UPDATE public.users SET role = 'loan_officer', is_active = true
  WHERE full_name ILIKE '%Tyler Johnson%';

UPDATE public.users SET role = 'loan_officer', is_active = true
  WHERE full_name ILIKE '%Stephen Curry%';


-- ── 2. Deactivate users no longer with QuestRock ─────────────────────────────
-- Sets is_active = false so they can no longer log in, but preserves all
-- historical loan records and assignments (see query below to find their loans).

UPDATE public.users SET is_active = false
  WHERE full_name ILIKE '%Chamell Scardina%';

UPDATE public.users SET is_active = false
  WHERE full_name ILIKE '%Matt Icard%';

UPDATE public.users SET is_active = false
  WHERE full_name ILIKE '%Jessica Sherard%';


-- ── 3. Create teams ────────────────────────────────────────────────────────────

INSERT INTO public.teams (name)
  VALUES ('Team T-Rex')
  ON CONFLICT (name) DO NOTHING;

INSERT INTO public.teams (name)
  VALUES ('Team Pumps and Profit')
  ON CONFLICT (name) DO NOTHING;


-- ── 4. Set team managers ───────────────────────────────────────────────────────

UPDATE public.teams
  SET manager_user_id = (
    SELECT id FROM public.users WHERE full_name ILIKE '%Bastian Johnston%' LIMIT 1
  )
  WHERE name = 'Team T-Rex';

UPDATE public.teams
  SET manager_user_id = (
    SELECT id FROM public.users WHERE full_name ILIKE '%Tashawna Chisholm%' LIMIT 1
  )
  WHERE name = 'Team Pumps and Profit';

-- ── 5. Assign managers + their LOs to teams ────────────────────────────────────

-- Team T-Rex: Bastian + Tyler + Stephen
INSERT INTO public.team_members (team_id, user_id)
  SELECT t.id, u.id
  FROM public.teams t
  CROSS JOIN public.users u
  WHERE t.name = 'Team T-Rex'
    AND (
      u.full_name ILIKE '%Bastian Johnston%'
      OR u.full_name ILIKE '%Tyler Johnson%'
      OR u.full_name ILIKE '%Stephen Curry%'
    )
  ON CONFLICT (team_id, user_id) DO NOTHING;

-- Team Pumps and Profit: Tashawna only for now (add LOs as they join)
INSERT INTO public.team_members (team_id, user_id)
  SELECT t.id, u.id
  FROM public.teams t
  CROSS JOIN public.users u
  WHERE t.name = 'Team Pumps and Profit'
    AND u.full_name ILIKE '%Tashawna Chisholm%'
  ON CONFLICT (team_id, user_id) DO NOTHING;


-- ── 6. Set primary_team_id on affected LOs ─────────────────────────────────────

UPDATE public.users
  SET primary_team_id = (SELECT id FROM public.teams WHERE name = 'Team T-Rex' LIMIT 1)
  WHERE full_name ILIKE '%Bastian Johnston%'
     OR full_name ILIKE '%Tyler Johnson%'
     OR full_name ILIKE '%Stephen Curry%';

UPDATE public.users
  SET primary_team_id = (SELECT id FROM public.teams WHERE name = 'Team Pumps and Profit' LIMIT 1)
  WHERE full_name ILIKE '%Tashawna Chisholm%';


-- ── 7. Remove deactivated users from all teams ─────────────────────────────────

DELETE FROM public.team_members
  WHERE user_id IN (
    SELECT id FROM public.users
    WHERE full_name ILIKE ANY (ARRAY['%Chamell Scardina%','%Matt Icard%','%Jessica Sherard%'])
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNOSTIC: Run these two queries in Supabase SQL editor to verify after applying.
-- ─────────────────────────────────────────────────────────────────────────────

-- Query 1: Check current user roles
-- SELECT full_name, email, role, is_active FROM public.users ORDER BY role, full_name;

-- Query 2: Loans still assigned to deactivated users — review and reassign these.
-- SELECT l.id, l.shape_record_id, l.borrower_first_name, l.borrower_last_name,
--        l.current_stage, l.assigned_loan_officer_name, u.full_name AS lo_name, u.is_active
-- FROM public.loans l
-- JOIN public.users u ON u.id = l.assigned_loan_officer_user_id
-- WHERE u.is_active = false
-- ORDER BY l.lead_created_at DESC;
