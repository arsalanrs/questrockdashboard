-- Add Gregory Bethea Jr and Zachary Davis — loan officers on Team T-Rex (Bastian).
-- Prerequisite: create both users in Supabase Auth (Authentication → Users)
-- with password WelcomeToQuestRock1! and emails gbethea@ / zdavis@ questrock.com

UPDATE public.users SET full_name = 'Gregory Bethea Jr', role = 'loan_officer', is_active = true
  WHERE email = 'gbethea@questrock.com';

UPDATE public.users SET full_name = 'Zachary Davis', role = 'loan_officer', is_active = true
  WHERE email = 'zdavis@questrock.com';

INSERT INTO public.team_members (team_id, user_id)
  SELECT t.id, u.id
  FROM public.teams t
  CROSS JOIN public.users u
  WHERE t.name = 'Team T-Rex'
    AND u.email IN ('gbethea@questrock.com', 'zdavis@questrock.com')
  ON CONFLICT (team_id, user_id) DO NOTHING;

UPDATE public.users
  SET primary_team_id = (SELECT id FROM public.teams WHERE name = 'Team T-Rex' LIMIT 1)
  WHERE email IN ('gbethea@questrock.com', 'zdavis@questrock.com');
