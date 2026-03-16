-- Set Arsalan (arsalanr839@gmail.com) to admin so he sees Admin nav and correct role.
UPDATE public.users
SET role = 'admin'
WHERE email = 'arsalanr839@gmail.com';
