CREATE OR REPLACE FUNCTION public.lock_signup_fingerprint(lock_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(lock_key));
END;
$$;

REVOKE ALL ON FUNCTION public.lock_signup_fingerprint(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_signup_fingerprint(text) TO service_role;

CREATE OR REPLACE FUNCTION public.increment_profile_credits(_profile_id uuid, _amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET credits = credits + _amount
  WHERE id = _profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_profile_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_profile_credits(uuid, integer) TO service_role;