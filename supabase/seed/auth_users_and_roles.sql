-- =============================================================================
-- QuestRock Unified SSO — User Seed Script
-- =============================================================================
-- Run this in the Supabase SQL Editor AFTER creating all users in
-- Authentication → Users with password: WelcomeToQuestRock1!
--
-- Users to create first (Auth → Users → Invite or Add user):
--   arashid@questrock.com
--   bmedley@questrock.com
--   nikksmith@questrock.com
--   rayconway@questrock.com
--   bastianjohnston@questrock.com
--   jfriday@questrock.com
--   tchisholm@questrock.com
--   tjohnson@questrock.com
--   scurry@questrock.com
--   gbethea@questrock.com
--   zdavis@questrock.com
-- =============================================================================

-- 1. Set full names (use real full names so existing ILIKE migrations still match)
UPDATE public.users SET full_name = 'Arsalan Rashid'    WHERE email = 'arashid@questrock.com';
UPDATE public.users SET full_name = 'Bill Medley'       WHERE email = 'bmedley@questrock.com';
UPDATE public.users SET full_name = 'Nikk Smith'        WHERE email = 'nikksmith@questrock.com';
UPDATE public.users SET full_name = 'Ray Conway'        WHERE email = 'rayconway@questrock.com';
UPDATE public.users SET full_name = 'Bastian Johnston'  WHERE email = 'bastianjohnston@questrock.com';
UPDATE public.users SET full_name = 'Jason Friday'      WHERE email = 'jfriday@questrock.com';
UPDATE public.users SET full_name = 'Tashawna Chisholm' WHERE email = 'tchisholm@questrock.com';
UPDATE public.users SET full_name = 'Tyler Johnson'     WHERE email = 'tjohnson@questrock.com';
UPDATE public.users SET full_name = 'Stephen Curry'     WHERE email = 'scurry@questrock.com';
UPDATE public.users SET full_name = 'Gregory Bethea Jr' WHERE email = 'gbethea@questrock.com';
UPDATE public.users SET full_name = 'Zachary Davis'     WHERE email = 'zdavis@questrock.com';

-- 2. Assign roles
-- 'executive' is the top-level role in the schema (Ray, Bill, Nikk, Arsalan)
UPDATE public.users SET role = 'executive'
  WHERE email IN (
    'arashid@questrock.com',
    'bmedley@questrock.com',
    'nikksmith@questrock.com',
    'rayconway@questrock.com'
  );

UPDATE public.users SET role = 'manager'
  WHERE email IN (
    'bastianjohnston@questrock.com',
    'jfriday@questrock.com',
    'tchisholm@questrock.com'
  );

UPDATE public.users SET role = 'loan_officer'
  WHERE email IN (
    'tjohnson@questrock.com',
    'scurry@questrock.com',
    'gbethea@questrock.com',
    'zdavis@questrock.com'
  );

-- 3. Mark all active
UPDATE public.users SET is_active = true
  WHERE email IN (
    'arashid@questrock.com','bmedley@questrock.com','nikksmith@questrock.com',
    'rayconway@questrock.com','bastianjohnston@questrock.com','jfriday@questrock.com',
    'tchisholm@questrock.com','tjohnson@questrock.com','scurry@questrock.com',
    'gbethea@questrock.com','zdavis@questrock.com'
  );

-- 4. Create teams
INSERT INTO public.teams (name) VALUES ('Team T-Rex'), ('Team Pumps and Profit')
  ON CONFLICT (name) DO NOTHING;

-- 5. Assign team managers
UPDATE public.teams
  SET manager_user_id = (SELECT id FROM public.users WHERE email = 'bastianjohnston@questrock.com')
  WHERE name = 'Team T-Rex';

UPDATE public.teams
  SET manager_user_id = (SELECT id FROM public.users WHERE email = 'tchisholm@questrock.com')
  WHERE name = 'Team Pumps and Profit';

-- 6. Team T-Rex members: Bastian + Tyler + Stephen + Gregory + Zachary
INSERT INTO public.team_members (team_id, user_id)
  SELECT t.id, u.id
  FROM public.teams t
  CROSS JOIN public.users u
  WHERE t.name = 'Team T-Rex'
    AND u.email IN (
      'bastianjohnston@questrock.com',
      'tjohnson@questrock.com',
      'scurry@questrock.com',
      'gbethea@questrock.com',
      'zdavis@questrock.com'
    )
  ON CONFLICT (team_id, user_id) DO NOTHING;

-- 7. Team Pumps and Profit members: Tashawna
INSERT INTO public.team_members (team_id, user_id)
  SELECT t.id, u.id
  FROM public.teams t
  CROSS JOIN public.users u
  WHERE t.name = 'Team Pumps and Profit'
    AND u.email = 'tchisholm@questrock.com'
  ON CONFLICT (team_id, user_id) DO NOTHING;

-- 8. Set primary_team_id on team members
UPDATE public.users
  SET primary_team_id = (SELECT id FROM public.teams WHERE name = 'Team T-Rex' LIMIT 1)
  WHERE email IN (
    'bastianjohnston@questrock.com',
    'tjohnson@questrock.com',
    'scurry@questrock.com',
    'gbethea@questrock.com',
    'zdavis@questrock.com'
  );

UPDATE public.users
  SET primary_team_id = (SELECT id FROM public.teams WHERE name = 'Team Pumps and Profit' LIMIT 1)
  WHERE email = 'tchisholm@questrock.com';

-- 9. Verify — shows each user with their team membership
SELECT
  u.email,
  u.full_name,
  u.role,
  u.is_active,
  t.name AS team
FROM public.users u
LEFT JOIN public.team_members tm ON tm.user_id = u.id
LEFT JOIN public.teams t ON t.id = tm.team_id
WHERE u.email LIKE '%questrock.com'
ORDER BY u.role, u.full_name;
