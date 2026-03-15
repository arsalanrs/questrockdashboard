-- Run this in Supabase SQL Editor AFTER creating the auth user in Dashboard.
-- 1. In Supabase: Authentication > Users > "Add user"
--    Email: arsalanr839@gmail.com
--    Password: questrock123!  (or your choice)
--    Check "Auto Confirm User"
-- 2. Run this entire script. It finds the auth user by email and adds them to public.users.

INSERT INTO public.users (id, email, full_name, role, is_active)
SELECT
  au.id,
  'arsalanr839@gmail.com',
  'Arsalan',
  'admin',
  true
FROM auth.users au
WHERE au.email = 'arsalanr839@gmail.com'
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;
