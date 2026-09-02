-- =============================================================================
-- Migration: Fix handle_new_user trigger + admin credit assignment
-- Date: 2026-09-02
-- =============================================================================
-- This migration:
--   1. Creates/updates is_designated_admin() helper function
--   2. Creates/updates handle_new_user() trigger on auth.users INSERT
--   3. Ensures admin email gets credits=250, finder_credits=250
--   4. Uses UPSERT so profiles are never lost if row already exists
--   5. Also handles existing users who never got a profile row (backfill)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper function: is_designated_admin
--    Checks if an email belongs to a designated administrator.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_designated_admin(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(_email) = lower('mk654491931@gmail.com');
$$;

COMMENT ON FUNCTION public.is_designated_admin(text) IS
  'Returns true if the given email is a designated admin. Update the email list here when needed.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger function: handle_new_user
--    Fires on every INSERT into auth.users.
--    - Creates a public.profiles row (UPSERT to avoid duplicates)
--    - Assigns admin credits (250/250) for designated admin emails
--    - Grants the "admin" role to designated admin users
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_email  text;
  _user_name   text;
  _is_admin    boolean;
  _admin_credits constant integer := 250;
  _default_credits constant integer := 0;
  _default_finder_credits constant integer := 0;
BEGIN
  -- Extract email from the new auth user record
  _user_email := lower(COALESCE(NEW.email, ''));
  _user_name  := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    ''
  );
  _is_admin := public.is_designated_admin(_user_email);

  -- ── UPSERT profiles row ──────────────────────────────────────────────
  -- Using INSERT ... ON CONFLICT so the trigger never fails if a row
  -- already exists (e.g. created by the signup server function before
  -- the auth user was fully committed, or on a re-trigger scenario).
  INSERT INTO public.profiles (
    id,
    email,
    credits,
    finder_credits,
    credits_spent,
    sim_credits,
    subscription_tier,
    language,
    currency,
    notifications_enabled,
    onboarding_completed,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    _user_email,
    CASE WHEN _is_admin THEN _admin_credits ELSE _default_credits END,
    CASE WHEN _is_admin THEN _admin_credits ELSE _default_finder_credits END,
    0,
    0,
    CASE WHEN _is_admin THEN 'Business' ELSE 'Free' END,
    'en',
    'USD',
    true,
    false,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Only update email if it changed (don't overwrite existing data)
    email = EXCLUDED.email,
    -- Bump credits to admin level if this is the admin (never downgrade)
    credits = GREATEST(
      public.profiles.credits,
      CASE WHEN public.is_designated_admin(EXCLUDED.email)
        THEN _admin_credits
        ELSE public.profiles.credits
      END
    ),
    finder_credits = GREATEST(
      public.profiles.finder_credits,
      CASE WHEN public.is_designated_admin(EXCLUDED.email)
        THEN _admin_credits
        ELSE public.profiles.finder_credits
      END
    ),
    -- Promote to Business tier if admin
    subscription_tier = CASE
      WHEN public.is_designated_admin(EXCLUDED.email)
        THEN 'Business'
      ELSE public.profiles.subscription_tier
    END,
    updated_at = now();

  -- ── Grant admin role ─────────────────────────────────────────────────
  IF _is_admin THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Trigger on auth.users INSERT: creates/updates profiles row. '
  'Designated admin emails get 250 credits + 250 finder_credits + Business tier + admin role.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger: attach handle_new_user to auth.users
--    DROP IF EXISTS first to avoid duplicate trigger errors.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill: ensure the admin user has a profiles row and correct credits
--    This handles the case where the admin already signed up but the trigger
--    was missing or broken.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  _admin_user_id uuid;
  _admin_credits constant integer := 250;
BEGIN
  -- Find the auth user with the admin email
  SELECT id INTO _admin_user_id
  FROM auth.users
  WHERE lower(email) = lower('mk654491931@gmail.com')
  LIMIT 1;

  IF _admin_user_id IS NULL THEN
    -- Admin hasn't signed up yet; nothing to backfill.
    RETURN;
  END IF;

  -- Ensure the profile row exists
  INSERT INTO public.profiles (
    id,
    email,
    credits,
    finder_credits,
    credits_spent,
    sim_credits,
    subscription_tier,
    language,
    currency,
    notifications_enabled,
    onboarding_completed,
    created_at,
    updated_at
  ) VALUES (
    _admin_user_id,
    lower('mk654491931@gmail.com'),
    _admin_credits,
    _admin_credits,
    0,
    0,
    'Business',
    'en',
    'USD',
    true,
    false,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    credits = GREATEST(public.profiles.credits, _admin_credits),
    finder_credits = GREATEST(public.profiles.finder_credits, _admin_credits),
    subscription_tier = 'Business',
    email = lower('mk654491931@gmail.com'),
    updated_at = now();

  -- Ensure admin role exists
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_admin_user_id, 'admin')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Backfill complete for admin user % (credits: %, finder_credits: %)',
    _admin_user_id, _admin_credits, _admin_credits;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Ensure public_id and referral_code are populated (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.profiles
SET
  public_id = COALESCE(public_id, public.gen_public_id()),
  referral_code = COALESCE(referral_code, public.gen_referral_code())
WHERE public_id IS NULL OR referral_code IS NULL;
