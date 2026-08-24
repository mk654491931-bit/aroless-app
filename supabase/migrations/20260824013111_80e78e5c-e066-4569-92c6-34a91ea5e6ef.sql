REVOKE EXECUTE ON FUNCTION public.is_admin_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gen_public_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_public_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_public_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_subscription_credits(uuid, text, integer, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gen_referral_code() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_admin_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gen_public_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_subscription_credits(uuid, text, integer, text, text) TO service_role;