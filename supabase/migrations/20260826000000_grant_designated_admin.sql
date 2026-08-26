-- Existing designated account: make the grant idempotent for already-created users.
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'admin'::public.app_role
FROM public.profiles p
WHERE lower(btrim(coalesce(p.email, ''))) = 'mk654491931@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

UPDATE public.profiles
SET credits = GREATEST(credits, 250),
    updated_at = now()
WHERE lower(btrim(coalesce(email, ''))) = 'mk654491931@gmail.com';